class LocalTreeSystem {
    constructor(scene, terrainSystem, altTreeSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.altTreeSystem = altTreeSystem; // Alternate tree system for side-by-side comparison
        this.trees = new Map(); // key -> tree mesh
        this.cameraPosition = new THREE.Vector3();
        this.lastCameraChunk = { x: -9999, z: -9999 };
        this.fogDistance = 40; // Legacy - for terrain compatibility
        this.chunkSize = 16;
        this.isUpdating = false;
        this.lodManager = null;
        this._treeProxies = new Map();
        this._scratchPos = new THREE.Vector3();

        // Seasonal configuration (synced with board_clean.js)
        this.seasonConfig = {
            SPRING: { treeColor: [0.7,0.9,0.5] },
            SUMMER: { treeColor: [0.4,0.8,0.3] },
            AUTUMN: { treeColor: [0.9,0.6,0.2] },
            WINTER: { treeColor: [0.8,0.8,0.9] }
        };
        this.currentSeason = 'SPRING';
        this.seasonProgress = 0;


        // Create procedural transparency textures with different densities
        this.leafTextures = {
            high: null,   // Close: many small leaves (6000, 100)
            medium: null, // Medium: fewer leaves (3000, 50)
            low: null    // Far: few large leaves (1500, 25)
        };
        // Initialize textures
        this.leafTextures.high = this.createLeafTexture(0.25, 0.0);
        this.leafTextures.medium = this.createLeafTexture(0.15, 0.0);
        this.leafTextures.low = this.createLeafTexture(0.08, 0.0);
        this.leafTexture = this.leafTextures.high; // Default to high density

        // Force texture updates
        this.leafTextures.high.needsUpdate = true;
        this.leafTextures.medium.needsUpdate = true;
        this.leafTextures.low.needsUpdate = true;
        this.yearProgress = 0.0; // Track year progress for seasonal textures

        // Tree mesh pool for reuse
        this.treePool = [];
        this.maxTreePoolSize = 100;

        // Reusable materials (simple standard materials)
        this.treeMaterials = {
            trunk: new THREE.MeshStandardMaterial({
                color: 0x8B4513,
                roughness: 0.9,
                transparent: true,
                opacity: 0.85,
                depthWrite: false
            }),
            leaves: this.createFoliageShaderMaterial(this.leafTexture)
        };

        // Tree template will be loaded asynchronously
        this.treeTemplate = null;
        this.isTemplateLoaded = false;

        // Performance tuning
        this.maxRenderDistance = 80; // Distance beyond which trees are culled
        this.animationEnabled = true; // Whether wind animation runs
        this.lodLevel = 'high'; // 'high', 'medium', 'low'

        // Wind parameter defaults (overridden by parameterSystem sliders)
        this.windExposureScale = 6.0;
        this.windShadowStrength = 1.5;
        this.windHeightPower = 2.0;

        // Initialize template asynchronously
        this.initializeTemplate();
    }

    setLodLevel(level) {
        if (['high', 'medium', 'low'].includes(level)) {
            this.lodLevel = level;
            // Adjust max render distance based on LOD
            const distances = { high: 80, medium: 60, low: 40 };
            this.maxRenderDistance = distances[level] || 80;
        }
    }

    setLODManager(lodManager) {
        if (!lodManager) return;
        this.lodManager = lodManager;
        lodManager.registerGroup('localTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: this.maxRenderDistance,
            frustumCull: true,
            getPosition: (proxy) => {
                this._scratchPos.set(proxy.x, proxy.height, proxy.z);
                return this._scratchPos;
            },
            getBoundsRadius: () => 2.0,
            onCull: (proxy, id) => this._onTreeCulled(proxy),
            onVisible: (proxy, id) => this._onTreeVisible(proxy)
        });
    }

    createFoliageShaderMaterial(texture) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                lightDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
                ambient: { value: 0.4 },
                edgeSoftness: { value: 2.2 },
                edgeStrength: { value: 0.85 },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vWorldPos;
                void main() {
                    vUv = uv;
                    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                }
            `,
            fragmentShader: `
                precision highp float;
                #include <common>
                #include <fog_pars_fragment>
                uniform sampler2D map;
                uniform vec3 lightDir;
                uniform float ambient;
                uniform float edgeSoftness;
                uniform float edgeStrength;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vWorldPos;
                void main() {
                    // Sample leaf texture (dots on transparent background)
                    vec4 texel = texture2D(map, vUv);

                    // Basic directional + ambient lighting
                    float diff = max(dot(vNormal, lightDir), 0.0);
                    vec3 litColor = texel.rgb * (ambient + diff * (1.0 - ambient));

                    // View-dependent edge falloff for puffball softness
                    // Center of sphere (facing camera) = opaque, edges = transparent
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), edgeSoftness);
                    float edgeAlpha = 1.0 - (fresnel * edgeStrength);

                    // Combine texture alpha with edge falloff
                    float finalAlpha = texel.a * edgeAlpha;

                    gl_FragColor = vec4(litColor, finalAlpha);
                    #include <fog_fragment>
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            fog: true
        });
    }

    // Depth-only "pre-pass" material: writes to the depth buffer for the
    // solid core of the foliage texture (alphaTest-style discard) without
    // writing color. The subsequent transparent main pass then depth-tests
    // against this, preventing distant (fogged) foliage from drawing on top
    // of nearer trees while preserving the soft fresnel edges of the main pass.
    createFoliageDepthPrepassMaterial(texture) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                alphaThreshold: { value: 0.5 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler2D map;
                uniform float alphaThreshold;
                varying vec2 vUv;
                void main() {
                    vec4 texel = texture2D(map, vUv);
                    if (texel.a < alphaThreshold) discard;
                    gl_FragColor = vec4(0.0);
                }
            `,
            transparent: false,
            depthWrite: true,
            depthTest: true,
            colorWrite: false,
            side: THREE.DoubleSide
        });
    }

    // Attach a depth-only pre-pass companion mesh to a foliage ball. The
    // companion shares the ball's geometry and inherits its transform (incl.
    // wind sway) by being a child of the ball.
    addFoliagePrepass(ball) {
        const prepassMat = this.createFoliageDepthPrepassMaterial(this.leafTexture);
        const prepass = new THREE.Mesh(ball.geometry, prepassMat);
        prepass.userData.isFoliagePrepass = true;
        prepass.castShadow = false;
        prepass.receiveShadow = false;
        ball.add(prepass);
        return prepass;
    }

    async initializeTemplate() {
        if (this.isTemplateLoaded) return;
        this.treeTemplate = await this.createNintendoishTree();
        this.isTemplateLoaded = true;

        // Debug: log template children
        console.log('[TREE TEMPLATE] Template has', this.treeTemplate.children.length, 'children:');
        this.treeTemplate.children.forEach((child, index) => {
            console.log(`[TREE TEMPLATE] Child ${index}:`, child.name || 'unnamed', child.type);
        });
    }

    createProceduralTree(trunkHeight = 1.5, trunkBaseRadius = 0.1) {
        const tree = new THREE.Group();

        // Create trunk: 3-sided pyramid (triangular cone) with 3 height segments
        // 3 radial segments = triangular cross-section, 3 height segments = 2 intermediate rings + base + tip
        // This gives smooth wind bending with evenly spaced vertex rings
        const trunkGeometry = new THREE.CylinderGeometry(0, trunkBaseRadius, trunkHeight, 3, 3);
        const trunkMesh = new THREE.Mesh(trunkGeometry, this.treeMaterials.trunk.clone());
        trunkMesh.position.y = trunkHeight / 2; // Half height so bottom is at y=0
        trunkMesh.name = 'trunk';
        trunkMesh.userData.isTrunk = true;
        tree.add(trunkMesh);

        // Nintendo-style foliage: low-poly spheres with radial texture falloff
        // SphereGeometry(6,4) = 48 tris per ball - low poly look with proper UVs for radial gradient
        const foliageMaterial = this.createFoliageShaderMaterial(this.leafTexture);
        const centerRadius = 0.42 + Math.random() * 0.10;
        const smallRadius = 0.22 + Math.random() * 0.07;
        const topRadius = 0.18 + Math.random() * 0.06;

        const centerGeo = new THREE.SphereGeometry(centerRadius, 6, 4);
        const smallGeo = new THREE.SphereGeometry(smallRadius, 6, 4);
        const topGeo = new THREE.SphereGeometry(topRadius, 6, 4);

        let ballIndex = 0;
        // Position canopy so trunk top (trunkHeight) is about at top of center ball
        const canopyY = trunkHeight - centerRadius * 0.85;

        // 1. Center big ball - always visible, highest LOD priority
        const centerBall = new THREE.Mesh(centerGeo, foliageMaterial.clone());
        centerBall.position.set(0, canopyY, 0);
        centerBall.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI
        );
        centerBall.userData.isFoliage = true;
        centerBall.userData.foliageIndex = ballIndex++;
        centerBall.userData.lodTier = 'center';
        centerBall.userData.originalX = centerBall.position.x;
        centerBall.userData.originalY = centerBall.position.y;
        centerBall.userData.originalZ = centerBall.position.z;
        centerBall.userData.originalRotationX = centerBall.rotation.x;
        centerBall.userData.originalRotationY = centerBall.rotation.y;
        centerBall.userData.originalRotationZ = centerBall.rotation.z;
        centerBall.userData.flutterPhase = Math.random() * Math.PI * 2;
        this.addFoliagePrepass(centerBall);
        tree.add(centerBall);

        // 2. Top ball - visible at close/medium distance
        const topBall = new THREE.Mesh(topGeo, foliageMaterial.clone());
        topBall.position.set(0, canopyY + centerRadius * 0.75, 0);
        topBall.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI
        );
        topBall.userData.isFoliage = true;
        topBall.userData.foliageIndex = ballIndex++;
        topBall.userData.lodTier = 'top';
        topBall.userData.originalX = topBall.position.x;
        topBall.userData.originalY = topBall.position.y;
        topBall.userData.originalZ = topBall.position.z;
        topBall.userData.originalRotationX = topBall.rotation.x;
        topBall.userData.originalRotationY = topBall.rotation.y;
        topBall.userData.originalRotationZ = topBall.rotation.z;
        topBall.userData.flutterPhase = Math.random() * Math.PI * 2;
        this.addFoliagePrepass(topBall);
        tree.add(topBall);

        // 3. Ring of 6 smaller balls around the center
        const ringCount = 6;
        for (let i = 0; i < ringCount; i++) {
            const angle = (i / ringCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const ringRadius = centerRadius * 0.70 + Math.random() * 0.15;
            const heightOffset = (Math.random() - 0.5) * 0.15;

            const ringBall = new THREE.Mesh(smallGeo, foliageMaterial.clone());
            ringBall.position.set(
                Math.cos(angle) * ringRadius,
                canopyY + heightOffset,
                Math.sin(angle) * ringRadius
            );
            ringBall.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI
            );
            ringBall.userData.isFoliage = true;
            ringBall.userData.foliageIndex = ballIndex++;
            ringBall.userData.lodTier = 'ring';
            ringBall.userData.originalX = ringBall.position.x;
            ringBall.userData.originalY = ringBall.position.y;
            ringBall.userData.originalZ = ringBall.position.z;
            ringBall.userData.originalRotationX = ringBall.rotation.x;
            ringBall.userData.originalRotationY = ringBall.rotation.y;
            ringBall.userData.originalRotationZ = ringBall.rotation.z;
            ringBall.userData.flutterPhase = Math.random() * Math.PI * 2;
            this.addFoliagePrepass(ringBall);
            tree.add(ringBall);
        }

        // Store original positions for wind animation
        trunkMesh.userData.originalPositions = trunkMesh.geometry.attributes.position.clone();

        console.log('[PROCEDURAL TREE] Created Nintendo tree with height', trunkHeight.toFixed(2), 'and', ballIndex, 'foliage balls');
        return tree;
    }

    createLeafTexture(density = 1.0, yearProgress = 0.0) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Fill with transparent background
        ctx.clearRect(0, 0, size, size);

        // Determine seasonal stage based on yearProgress (0-1)
        // Natural annual stages: winter(0-0.15) → buds(0.15-0.25) → bloom(0.25-0.35) → growth(0.35-0.45) → full(0.45-0.65) → summer(0.65-0.75) → early autumn(0.75-0.85) → peak autumn(0.85-0.92) → late autumn(0.92-1.0)
        let leafDensityMultiplier = 1.0;
        let blossomCount = 0;
        let blossomColor = { r: 255, g: 182, b: 193 }; // Pink
        let leafColor = { r: 34, g: 139, b: 34 }; // Forest green (default)

        if (yearProgress < 0.15) {
            // Winter dormancy: sparse branches, bare branches
            leafDensityMultiplier = 0.3;
            leafColor = { r: 100, g: 100, b: 100 }; // Gray/bare
        } else if (yearProgress < 0.25) {
            // Early spring buds: emerging
            leafDensityMultiplier = 0.3 + (yearProgress - 0.15) / 0.1 * 0.3;
            blossomCount = Math.floor((yearProgress - 0.15) / 0.1 * 50);
            blossomColor = { r: 200, g: 200, b: 255 }; // White buds
            leafColor = { r: 50, g: 150, b: 50 }; // Light green buds
        } else if (yearProgress < 0.35) {
            // Bloom: maximum blossoms
            leafDensityMultiplier = 0.6 + (yearProgress - 0.25) / 0.1 * 0.2;
            blossomCount = Math.floor(50 + (yearProgress - 0.25) / 0.1 * 100);
            blossomColor = { r: 255, g: 182, b: 193 }; // Pink blossoms
            leafColor = { r: 80, g: 160, b: 80 }; // Fresh green
        } else if (yearProgress < 0.45) {
            // Leaf growth: blossoms fading, leaves emerging
            leafDensityMultiplier = 0.8 + (yearProgress - 0.35) / 0.1 * 0.2;
            blossomCount = Math.floor(150 - (yearProgress - 0.35) / 0.1 * 100);
            leafColor = { r: 34, g: 139, b: 34 }; // Forest green
        } else if (yearProgress < 0.65) {
            // Full foliage: no blossoms
            leafDensityMultiplier = 1.0;
            blossomCount = 0;
            leafColor = { r: 34, g: 139, b: 34 }; // Forest green
        } else if (yearProgress < 0.75) {
            // Summer: full but slightly less dense
            leafDensityMultiplier = 1.0;
            blossomCount = 0;
            leafColor = { r: 50, g: 130, b: 50 }; // Darker summer green
        } else if (yearProgress < 0.85) {
            // Early autumn: full but starting to color
            leafDensityMultiplier = 0.95;
            blossomCount = 0;
            leafColor = { r: 120, g: 140, b: 50 }; // Yellow-green
        } else if (yearProgress < 0.92) {
            // Peak autumn: full, vibrant colors
            leafDensityMultiplier = 0.9;
            blossomCount = 0;
            leafColor = { r: 200, g: 120, b: 30 }; // Orange
        } else {
            // Late autumn: leaves falling
            leafDensityMultiplier = 0.9 - (yearProgress - 0.92) / 0.08 * 0.4;
            blossomCount = 0;
            leafColor = { r: 180, g: 80, b: 30 }; // Brown-orange
        }

        // Scattered leaf dots with transparent gaps - visible individual leaves
        const leafCount = Math.floor(120 * density * leafDensityMultiplier);
        const clusterCount = Math.floor(10 * density * leafDensityMultiplier);
        const leafSizeMultiplier = 1.5 / Math.sqrt(density);

        // Create scattered leaf dots with transparent gaps between them
        for (let i = 0; i < leafCount; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = (Math.random() * 10 + 5) * leafSizeMultiplier;

            // Create leaf-like shapes (ellipses)
            ctx.beginPath();
            ctx.ellipse(x, y, radius, radius * 0.65, Math.random() * Math.PI, 0, Math.PI * 2);

            // Varied opacity so some dots are fainter, creating gaps
            const opacity = Math.random() * 0.5 + 0.4;
            ctx.fillStyle = `rgba(${leafColor.r}, ${leafColor.g}, ${leafColor.b}, ${opacity})`;
            ctx.fill();
        }

        // Add small leaf clusters for grouping
        for (let i = 0; i < clusterCount; i++) {
            const cx = Math.random() * size;
            const cy = Math.random() * size;
            const clusterSize = (Math.random() * 18 + 10) * leafSizeMultiplier;

            for (let j = 0; j < 6; j++) {
                const angle = (j / 6) * Math.PI * 2 + Math.random() * 0.5;
                const clusterDist = Math.random() * clusterSize * 0.4;
                const x = cx + Math.cos(angle) * clusterDist;
                const y = cy + Math.sin(angle) * clusterDist;
                const radius = (Math.random() * 8 + 4) * leafSizeMultiplier;

                ctx.beginPath();
                ctx.ellipse(x, y, radius, radius * 0.55, angle, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${leafColor.r}, ${leafColor.g}, ${leafColor.b}, ${0.5 + Math.random() * 0.3})`;
                ctx.fill();
            }
        }

        // Add blossoms during spring
        for (let i = 0; i < blossomCount; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = Math.random() * 4 + 2;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${blossomColor.r}, ${blossomColor.g}, ${blossomColor.b}, 0.9)`;
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }


    createTaperedTrunk(height = 1.5, baseRadius = 0.1) {
        // Create 3-sided prism trunk (triangular cross-section for poplar style)
        // Using CylinderGeometry with 3 radial segments for triangular prism
        const trunkGeometry = new THREE.CylinderGeometry(baseRadius * 0.2, baseRadius, height, 3, 6);

        // Modify vertices to create tapering and root protrusions
        const positions = trunkGeometry.attributes.position;
        const vertexCount = positions.count;

        for (let i = 0; i < vertexCount; i++) {
            const y = positions.getY(i);
            const x = positions.getX(i);
            const z = positions.getZ(i);

            // Calculate tapering factor based on height and base radius
            // Base (y = -height/2): radius = baseRadius
            // Mid (y = height/6): radius = baseRadius * 0.6
            // Top (y = height/2): radius = baseRadius * 0.2
            const normalizedY = (y + height / 2) / height; // 0 at base, 1 at top
            let radius;
            if (normalizedY < 0.67) {
                // Base to mid: interpolate from baseRadius to baseRadius * 0.6
                radius = baseRadius - (normalizedY / 0.67) * (baseRadius * 0.4);
            } else {
                // Mid to top: interpolate from baseRadius * 0.6 to baseRadius * 0.2
                radius = (baseRadius * 0.6) - ((normalizedY - 0.67) / 0.33) * (baseRadius * 0.4);
            }

            // Apply tapering
            const currentRadius = Math.sqrt(x * x + z * z);
            if (currentRadius > 0.001) {
                positions.setX(i, (x / currentRadius) * radius);
                positions.setZ(i, (z / currentRadius) * radius);
            }

            // Add root protrusions at base (every other vertex on bottom ring)
            if (normalizedY < 0.1 && i % 2 === 0) {
                const angle = Math.atan2(z, x);
                const protrusion = 0.03;
                positions.setX(i, x + Math.cos(angle) * protrusion);
                positions.setZ(i, z + Math.sin(angle) * protrusion);
            }
        }

        trunkGeometry.attributes.position.needsUpdate = true;
        trunkGeometry.computeVertexNormals();

        const trunk = new THREE.Mesh(trunkGeometry, this.treeMaterials.trunk);
        trunk.castShadow = false;
        trunk.receiveShadow = false;
        return trunk;
    }

    async loadTrunkModel() {
        if (this.trunkModel) {
            return this.trunkModel.clone();
        }

        if (typeof THREE.GLTFLoader === 'undefined') {
            console.error('[TreeSystem] GLTFLoader not available, cannot load trunk model');
            return null;
        }

        try {
            const loader = new THREE.GLTFLoader();
            const gltf = await loader.loadAsync('/Models/trunk.glb');
            this.trunkModel = gltf.scene;
            console.log('[TreeSystem] Trunk model loaded successfully');
            return this.trunkModel.clone();
        } catch (error) {
            console.error('[TreeSystem] Failed to load trunk model:', error);
            return null;
        }
    }

    async createNintendoishTree() {
        // Generate random tree properties for natural variation
        // Shorter, thinner trunks that end near the top of the center foliage ball
        const trunkHeight = 1.1 + Math.random() * 0.3;
        const trunkBaseRadius = 0.02 + Math.random() * 0.025;
        const springiness = 0.5 + Math.random() * 1.0;
        const windPhase = Math.random() * Math.PI * 2;

        // Create procedural tree with random height and radius
        const tree = this.createProceduralTree(trunkHeight, trunkBaseRadius);

        // Store tree properties for wind animation
        tree.userData.windProperties = {
            height: trunkHeight,
            baseRadius: trunkBaseRadius,
            springiness: springiness,
            phase: windPhase
        };

        return tree;
    }

    // Update tree orientations for trees in a specific chunk
    updateTreeNormalsInChunk(chunkX, chunkZ) {
        const chunkSize = this.terrainSystem ? this.terrainSystem.chunkSize : 16;
        const startX = chunkX * chunkSize;
        const startZ = chunkZ * chunkSize;

        let treesUpdated = 0;
        // Iterate through all trees and update those in this chunk
        this.trees.forEach((tree, key) => {
            const [tx, tz] = key.split(',').map(Number);
            if (tx >= startX && tx < startX + chunkSize && tz >= startZ && tz < startZ + chunkSize) {
                // Tree is in this chunk, update its orientation
                if (this.terrainSystem && typeof this.terrainSystem.getNormal === 'function') {
                    const normal = this.terrainSystem.getNormal(tx + 0.5, tz + 0.5);
                    if (normal) {
                        const up = new THREE.Vector3(0, 1, 0);
                        tree.quaternion.setFromUnitVectors(up, normal);
                        treesUpdated++;
                    }
                }
            }
        });

        return treesUpdated;
    }

    // Update all tree orientations
    updateAllTreeNormals() {
        console.log(`[TREE] updateAllTreeNormals called, updating ${this.trees.size} trees`);
        let treesUpdated = 0;
        let sampleNormal = null;
        let sampleHeights = [];
        let skippedChunks = 0;
        this.trees.forEach((tree, key) => {
            const [tx, tz] = key.split(',').map(Number);

            // Get height directly from chunk data
            let height = 0;
            let hasValidChunk = false;
            if (this.terrainSystem && this.terrainSystem.chunks) {
                const chunkX = Math.floor(tx / this.terrainSystem.chunkSize);
                const chunkZ = Math.floor(tz / this.terrainSystem.chunkSize);
                const chunkKey = `${chunkX},${chunkZ}`;
                const chunk = this.terrainSystem.chunks.get(chunkKey);
                if (chunk && chunk.data) {
                    hasValidChunk = true;
                    const localX = Math.floor(tx - (chunkX * this.terrainSystem.chunkSize));
                    const localZ = Math.floor(tz - (chunkZ * this.terrainSystem.chunkSize));
                    const tileIndex = localZ * this.terrainSystem.chunkSize + localX;
                    const tile = chunk.data[tileIndex];
                    if (tile && typeof tile === 'object' && tile.height !== undefined) {
                        height = tile.height;
                    }
                }
            }

            if (sampleHeights.length < 5) {
                sampleHeights.push(`(${tx}, ${tz}): ${height.toFixed(3)}`);
            }

            // Only calculate normal if chunk data is available
            if (hasValidChunk) {
                // Calculate normal from neighboring heights
                const delta = 8.0; // Increased from 0.1 to reduce slope sensitivity
                const hCenter = height;
                const hRight = this.getHeightFromChunk(tx + delta, tz);
                const hLeft = this.getHeightFromChunk(tx - delta, tz);
                const hUp = this.getHeightFromChunk(tx, tz + delta);
                const hDown = this.getHeightFromChunk(tx, tz - delta);

                // Check if all neighboring heights are valid (not default 0)
                const hasValidNeighbors = hRight !== 0 || hLeft !== 0 || hUp !== 0 || hDown !== 0 || height !== 0;

                if (hasValidNeighbors) {
                    const dx = (hRight - hLeft) / (2 * delta);
                    const dz = (hUp - hDown) / (2 * delta);
                    const normal = new THREE.Vector3(-dx, 1, -dz);
                    normal.normalize();

                    if (!sampleNormal) sampleNormal = normal;

                    // Store terrain normal for windward/leeward calculation
                    tree.userData.terrainNormal = normal.clone();

                    const up = new THREE.Vector3(0, 1, 0);
                    tree.quaternion.setFromUnitVectors(up, normal);
                    treesUpdated++;
                } else {
                    skippedChunks++;
                }
            } else {
                skippedChunks++;
            }
        });
        console.log(`[TREE] Updated ${treesUpdated} trees total, skipped ${skippedChunks} (no chunk data), sample normal:`, sampleNormal);
        console.log(`[TREE] Sample heights:`, sampleHeights.join(', '));
    }

    // Helper to get height directly from chunk data
    getHeightFromChunk(x, z) {
        if (!this.terrainSystem || !this.terrainSystem.chunks) return 0;
        const chunkX = Math.floor(x / this.terrainSystem.chunkSize);
        const chunkZ = Math.floor(z / this.terrainSystem.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunk = this.terrainSystem.chunks.get(chunkKey);
        if (!chunk || !chunk.data) return 0;
        const localX = Math.floor(x - (chunkX * this.terrainSystem.chunkSize));
        const localZ = Math.floor(z - (chunkZ * this.terrainSystem.chunkSize));
        const tileIndex = localZ * this.terrainSystem.chunkSize + localX;
        const tile = chunk.data[tileIndex];
        if (tile && typeof tile === 'object' && tile.height !== undefined) {
            return tile.height;
        }
        return 0;
    }

    // Update tree foliage based on season
    updateTreeFoliage(season, seasonProgress, yearProgress = 0.0) {
        // Check if yearProgress changed significantly (regenerate textures)
        if (Math.abs(yearProgress - this.yearProgress) > 0.01) {
            this.yearProgress = yearProgress;
            console.log(`[TREE] Regenerating foliage textures with yearProgress=${yearProgress.toFixed(2)}`);
            // Regenerate textures with new yearProgress
            this.leafTextures = {
                high: this.createLeafTexture(0.25, yearProgress),
                medium: this.createLeafTexture(0.15, yearProgress),
                low: this.createLeafTexture(0.08, yearProgress)
            };

            // Update all tree materials to use new textures
            this.trees.forEach((tree) => {
                tree.traverse((child) => {
                    if (child.isMesh && child.userData.isFoliage && child.material) {
                        // Determine current density level based on camera distance
                        const distance = tree.position.distanceTo(this.cameraPosition);
                        let densityLevel;
                        if (distance < 20) {
                            densityLevel = 'high';
                        } else if (distance < 40) {
                            densityLevel = 'medium';
                        } else {
                            densityLevel = 'low';
                        }
                        if (child.material.uniforms && child.material.uniforms.map) {
                            child.material.uniforms.map.value = this.leafTextures[densityLevel];
                        } else {
                            child.material.map = this.leafTextures[densityLevel];
                            child.material.needsUpdate = true;
                        }
                    }
                });
            });
        }

        if (this.currentSeason !== season) {
            console.log(`[TREE] Season changed from ${this.currentSeason} to ${season}, target color: [${this.seasonConfig[season].treeColor.join(',')}]`);
        }
        this.currentSeason = season;
        this.seasonProgress = seasonProgress;

        const config = this.seasonConfig[season];
        const targetColor = new THREE.Color(...config.treeColor);

        // Update all tree foliage materials
        let treeCount = 0;
        this.trees.forEach((tree) => {
            // Skip trunk (child 0), update foliage (children 1-6)
            for (let i = 1; i < tree.children.length; i++) {
                const leaf = tree.children[i];
                if (leaf.material) {
                    // Don't tint leaf material - texture provides color
                    // Seasonal changes handled by texture regeneration
                }
            }
            treeCount++;
        });

        // Debug logging every 60 frames
        if (treeCount > 0 && treeCount % 60 === 0) {
            const sampleTree = this.trees.values().next().value;
            if (sampleTree && sampleTree.children[1] && sampleTree.children[1].material) {
                // ShaderMaterial doesn't have color property like MeshStandardMaterial
                if (sampleTree.children[1].material.color) {
                    const sampleColor = sampleTree.children[1].material.color;
                    console.log(`[TREE] Updating ${treeCount} trees, yearProgress=${yearProgress.toFixed(2)}, sample foliage color: rgb(${sampleColor.r.toFixed(2)},${sampleColor.g.toFixed(2)},${sampleColor.b.toFixed(2)})`);
                } else {
                    console.log(`[TREE] Updating ${treeCount} trees, yearProgress=${yearProgress.toFixed(2)}, sample foliage color: shader material (no color property)`);
                }
            }
        }
    }

    // Seeded random number generator for deterministic tree properties
    seededRandom(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    addTreeToTile(x, z, height) {
        const key = `${x},${z}`;
        if (this.trees.has(key)) return;

        // Wait for template to be loaded
        if (!this.isTemplateLoaded || !this.treeTemplate) {
            console.log('[TreeSystem] Template not loaded yet, skipping tree at', x, z);
            return;
        }

        // Generate deterministic seed from position
        const seed = x * 10000 + z;

        // Get tree from pool or clone template
        let tree;
        if (this.treePool.length > 0) {
            tree = this.treePool.pop();
            tree.visible = true;
            tree.userData.isTree = true; // Mark as tree for vertex profiling
            console.log(`[BRANCH DEBUG] Reused tree from pool, children: ${tree.children.length}`);
        } else {
            tree = this.treeTemplate.clone();
            tree.userData.isTree = true; // Mark as tree for vertex profiling
            console.log(`[BRANCH DEBUG] Cloned tree from template, children: ${tree.children.length}`);
            // Debug: check trunkModel children
            if (tree.children[0]) {
                console.log(`[BRANCH DEBUG] trunkModel children count after clone: ${tree.children[0].children.length}`);
                tree.children[0].children.forEach((child, i) => {
                    console.log(`[BRANCH DEBUG] trunkModel child ${i}: type=${child.type}, isMesh=${child.isMesh}, isFoliage=${child.userData.isFoliage}`);
                });
            }
        }

        // DEBUG: Log all children after cloning/pooling
        tree.children.forEach((child, index) => {
            if (child.isMesh) {
                console.log(`[BRANCH DEBUG] Tree child ${index} at ${x},${z}: isBranch=${child.userData.isBranch}, DEBUG_MARKER=${child.userData.DEBUG_BRANCH_MARKER}, scale=${child.scale.x.toFixed(1)}, visible=${child.visible}`);
            }
        });

        // Generate deterministic random properties for this tree based on position
        const trunkHeight = 1.15 + this.seededRandom(seed) * 0.25; // 1.15 to 1.40
        const trunkBaseRadius = 0.02 + this.seededRandom(seed + 1) * 0.025; // 0.02 to 0.045
        const springiness = 0.5 + this.seededRandom(seed + 2) * 1.0; // 0.5 to 1.5
        const windPhase = this.seededRandom(seed + 3) * Math.PI * 2;

        // Note: Tree geometry is created in createNintendoishTree with random height/radius
        // Wind properties here match the actual geometry for correct bend calculations

        let trunkMesh = null;

        // Ensure wind properties and original positions are set (for pooled trees)
        // Always update properties with correct seeded values for current position
        tree.userData.windProperties = {
            height: trunkHeight,
            baseRadius: trunkBaseRadius,
            springiness: springiness,
            phase: windPhase
        };

        // Ensure trunk material has correct opacity (clone material per-tree for transparency to work)
        // The trunk is now a Group containing the loaded GLB with multiple meshes
        const trunkModel = this.treeTemplate.children[0];
        let templateOriginalPositions = null;

        // Traverse the template trunk model to find the trunk mesh and its original positions
        trunkModel.traverse((child) => {
            if (child.isMesh && child.geometry && child.geometry.attributes.position) {
                if (!templateOriginalPositions && child.userData.originalPositions) {
                    templateOriginalPositions = child.userData.originalPositions;
                }
            }
        });

        // Traverse the tree's trunk model to set original positions on the actual meshes
        const treeTrunkModel = tree.children[0];
        treeTrunkModel.traverse((child) => {
            if (child.isMesh) {
                // Find the trunk mesh (first mesh with originalPositions that isn't foliage)
                if (!trunkMesh && child.geometry && child.geometry.attributes.position && !child.userData.isFoliage) {
                    trunkMesh = child;
                }
                // Ensure original positions are set for wind animation
                // For pooled trees, reset from template to get clean original positions
                if (child.geometry && child.geometry.attributes.position && templateOriginalPositions) {
                    child.userData.originalPositions = templateOriginalPositions.clone();
                    child.userData.windProperties = tree.userData.windProperties;
                    // Reset current vertex positions from original (for pooled trees)
                    child.geometry.attributes.position.copy(templateOriginalPositions);
                    child.geometry.attributes.position.needsUpdate = true;
                }
            }
        });

        // Scaling disabled - using fixed scale from template
        // Apply random height/width scaling to trunk based on wind properties
        // if (trunkMesh && tree.userData.windProperties) {
        //     const props = tree.userData.windProperties;
        //     // Calculate scale factors based on random properties vs default template values
        //     // Default template height is ~1.5, default radius is ~0.1
        //     const heightScale = props.height / 1.5;
        //     const widthScale = props.baseRadius / 0.1;
        //     trunkMesh.scale.set(widthScale, heightScale, widthScale);

        //     // Adjust foliage Y positions based on tree height
        //     // Foliage needs to be positioned relative to the scaled trunk height
        //     const defaultTrunkHeight = 1.5;
        //     const actualTrunkHeight = props.height;

        //     // Scale foliage Y positions
        //     tree.children.forEach((child, index) => {
        //         if (child.isMesh && index > 0) { // Skip trunk (index 0)
        //             // Store original Y position if not already stored
        //             if (!child.userData.originalY) {
        //                 child.userData.originalY = child.position.y;
        //             }
        //             // Scale Y position based on tree height
        //             child.position.y = child.userData.originalY * heightScale;
        //         }
        //     });
        // }

        if (trunkMesh) {
            // Clone the material so each tree has its own instance (required for transparency to work correctly)
            if (trunkMesh.material) {
                trunkMesh.material = trunkMesh.material.clone();
            } else {
                trunkMesh.material = this.treeMaterials.trunk.clone();
            }
            trunkMesh.material.opacity = 0.85;
            trunkMesh.material.transparent = true;
            trunkMesh.material.depthWrite = false;
            trunkMesh.material.blending = THREE.NormalBlending;
            trunkMesh.material.needsUpdate = true;
            console.log('[TREE] Cloned trunk material with explicit blending and set opacity to 0.85 for tree at', x, z);
        } else {
            console.log('[TREE] WARNING: No trunk mesh found for tree at', x, z);
        }

        tree.position.set(x + 0.5, height + 0.02 + 0.75, z + 0.5);
        // Random scaling disabled - using fixed scale from template
        // const scale = Math.random() * 0.2 + 0.8;
        // tree.scale.set(scale, scale, scale);

        // Orient tree to terrain normal
        if (this.terrainSystem && typeof this.terrainSystem.getNormal === 'function') {
            const normal = this.terrainSystem.getNormal(x + 0.5, z + 0.5);
            if (normal) {
                const up = new THREE.Vector3(0, 1, 0);
                tree.quaternion.setFromUnitVectors(up, normal);
                // Add random Y rotation around the normal
                tree.rotateY(Math.random() * Math.PI * 2);
            } else {
                // Fallback to random Y rotation if normal not available
                tree.rotation.y = Math.random() * Math.PI * 2;
            }
        } else {
            // Fallback to random Y rotation if terrainSystem not available
            tree.rotation.y = Math.random() * Math.PI * 2;
        }

        // Disable shadow maps on trees (remove flickering)
        tree.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = false;
            }
        });

        tree.userData.isFullGeometry = true;
        tree.userData.spawnTime = performance.now(); // Track spawn time for fade-in

        // Compute exposure like grass shader: smoothstep(0,0.5,h) * smoothstep(3.0,1.0,h)
        const h = Math.max(0, height || 0);
        const ss1 = h <= 0 ? 0 : (h >= 0.5 ? 1 : h / 0.5);
        const ss2 = h <= 1.0 ? 1 : (h >= 3.0 ? 0 : (3.0 - h) / 2.0);
        const exposure = Math.min(1, Math.max(0, ss1 * ss2));
        tree.userData.exposure = exposure;

        // Debug: log exposure calculation for first few trees
        if (this.trees.size < 5) {
            console.log(`[EXPOSURE] Tree at ${x},${z}: height=${h.toFixed(2)}, ss1=${ss1.toFixed(2)}, ss2=${ss2.toFixed(2)}, exposure=${exposure.toFixed(2)}`);
        }

        // Determine square colour from chessboard coordinates (dark vs light square)
        const isDarkSquare = (Math.floor(x) + Math.floor(z)) % 2 !== 0;

        // Store base positions and sway phases for wind animation (skip trunk = child 0)
        for (let i = 1; i < tree.children.length; i++) {
            const leaf = tree.children[i];
            leaf.userData.basePosition = leaf.position.clone();
            leaf.userData.swayPhase = Math.random() * Math.PI * 2;

            // Clone material so each tree can be tinted independently
            if (leaf.material) {
                leaf.material = leaf.material.clone();
                if (leaf.material.uniforms && leaf.material.uniforms.map) {
                    leaf.material.uniforms.map.value = this.leafTextures.high;
                } else {
                    leaf.material.map = this.leafTextures.high;
                    leaf.material.needsUpdate = true;
                }
            }
        }

        this.scene.add(tree);
        this.trees.set(key, tree);

        // Register with central LOD manager
        if (this.lodManager) {
            let proxy = this._treeProxies.get(key);
            if (!proxy) {
                proxy = {
                    x: tree.position.x,
                    z: tree.position.z,
                    height: tree.position.y,
                    key,
                    treeRef: tree
                };
                this._treeProxies.set(key, proxy);
                this.lodManager.add('localTrees', proxy, key);
            } else {
                proxy.treeRef = tree;
                proxy.x = tree.position.x;
                proxy.z = tree.position.z;
                proxy.height = tree.position.y;
            }
        }

        // Create baked geometry shadow if shadow system is available
        if (this.shadowSystem) {
            this.shadowSystem.createShadowFor(tree, 'nintendoish_tree');
        }
    }

    removeTreeFromTile(x, z, { fromLOD = false } = {}) {
        const key = `${x},${z}`;
        const tree = this.trees.get(key);
        if (tree) {
            // Remove baked shadow
            if (this.shadowSystem) {
                this.shadowSystem.removeShadowFor(tree);
            }
            // Return tree to pool instead of destroying
            this.scene.remove(tree);
            tree.visible = false;
            if (this.treePool.length < this.maxTreePoolSize) {
                this.treePool.push(tree);
            } else {
                tree.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
            }
            this.trees.delete(key);
        }
        // Unregister from LOD manager when chunk unloads (not when LOD culls)
        if (!fromLOD && this.lodManager) {
            this.lodManager.remove('localTrees', key);
            this._treeProxies.delete(key);
        }
        // Also remove from alt tree system if present
        if (this.altTreeSystem) {
            this.altTreeSystem.removeTreeFromTile(x, z);
        }
    }

    hasTreeAt(x, z) {
        return this.trees.has(`${x},${z}`);
    }

    updateWindAnimation(time) {
        // Skip wind animation if disabled for performance
        if (!this.animationEnabled) return;
        
        // Update all tree trunks with wind animation
        let animatedCount = 0;
        let skippedNoProps = 0;
        let skippedNoTrunk = 0;
        let skippedNoOriginal = 0;

        for (const tree of this.trees.values()) {
            if (!tree.userData.windProperties) {
                skippedNoProps++;
                continue;
            }

            const props = tree.userData.windProperties;
            // Find the trunk mesh (either direct child with isTrunk flag or named 'Cube' inside trunkModel)
            let trunk = null;
            if (tree.children[0] && tree.children[0].isMesh && tree.children[0].userData.isTrunk) {
                trunk = tree.children[0];
            } else if (tree.children[0] && tree.children[0].isObject3D) {
                tree.children[0].traverse((child) => {
                    if (child.isMesh && child.name === 'Cube') {
                        trunk = child;
                    }
                });
            }
            if (!trunk || !trunk.userData.originalPositions) {
                skippedNoTrunk++;
                continue;
            }

            const positions = trunk.geometry.attributes.position;
            const original = trunk.userData.originalPositions;

            // Safety check: ensure original is a BufferAttribute with getY method
            if (!original || typeof original.getY !== 'function') {
                skippedNoOriginal++;
                continue;
            }

            // Calculate bend factor based on tree properties
            // Taller trees bend more, thinner trees bend more

            // Read wind parameters from parameterSystem if available
            const ps = window.parameterSystem;
            const exposureScale = ps ? (ps.getParameter('windExposureScale')?.value ?? this.windExposureScale) : this.windExposureScale;
            const shadowStrength = ps ? (ps.getParameter('windShadowStrength')?.value ?? this.windShadowStrength) : this.windShadowStrength;
            const heightPower = ps ? (ps.getParameter('windHeightPower')?.value ?? this.windHeightPower) : this.windHeightPower;

            // Apply exposure-based wind sensitivity
            const exposure = tree.userData.exposure || 0.5;
            let exposureMultiplier = 1.0 + exposure * exposureScale; // 1.0 to (1.0 + exposureScale)x wind

        // Apply leeward/windward consideration using terrain normal vs wind direction
        if (tree.userData.terrainNormal && this.windDirection) {
            const terrainNormal = tree.userData.terrainNormal;
            const windDir = new THREE.Vector3(this.windDirection.x, 0, this.windDirection.y).normalize();
            // Dot product: positive = windward (facing wind), negative = leeward (facing away)
            const windwardFactor = Math.max(0, terrainNormal.dot(windDir));
            // Windward trees get more wind, leeward trees get less
            exposureMultiplier *= (0.5 + windwardFactor * shadowStrength); // 0.5x to (0.5 + shadowStrength)x multiplier based on windward/leeward

            // Debug: log windward factor for first few trees
            if (animatedCount < 5 && Math.floor(time * 60) % 60 === 0) {
                console.log(`[WINDWARD] Tree at ${tree.position.x.toFixed(1)},${tree.position.z.toFixed(1)}: windward=${windwardFactor.toFixed(2)}, adjustedMultiplier=${exposureMultiplier.toFixed(2)}`);
            }
        }

            // Debug: log exposure for first few trees
            if (animatedCount < 5 && Math.floor(time * 60) % 60 === 0) {
                console.log(`[WIND EXPOSURE] Tree at ${tree.position.x.toFixed(1)},${tree.position.z.toFixed(1)}: exposure=${exposure.toFixed(2)}, multiplier=${exposureMultiplier.toFixed(2)}`);
            }

            // Wind oscillation: biased in wind direction (not centered at 0)
            // Trees lean mostly in wind direction with some variation
            const windBase = 0.2; // Base wind force always in wind direction
            const windVariation = Math.sin(time * 0.5 + props.phase) * 0.1; // Slow variation around base
            const windFlutter = Math.sin(time * 2.0 + props.phase * 2) * 0.05; // Faster flutter

            // Scale bend by tree height and thickness for realistic behavior
            // Taller trees bend more, thicker trees bend less (more rigid)
            const bendHeightFactor = props.height / 1.5; // Normalize around average height
            const thicknessFactor = 0.05 / props.baseRadius; // Thinner = more bend
            const dimensionScale = bendHeightFactor * thicknessFactor;
            const bendSensitivity = 1.0; // Base sensitivity factor

            const totalBend = (windBase + windVariation + windFlutter) * bendSensitivity * exposureMultiplier * dimensionScale;

            // Debug: log wind direction for first few trees
            if (animatedCount === 0 && Math.floor(time * 60) % 60 === 0) {
                const windDirX = this.windDirection ? this.windDirection.x : 1;
                const windDirZ = this.windDirection ? this.windDirection.y : 0;
                console.log(`[WIND DIR] windDirection=${windDirX.toFixed(2)},${windDirZ.toFixed(2)}, totalBend=${totalBend.toFixed(4)}`);
            }

            // Apply bend to trunk vertices in wind direction
            for (let i = 0; i < positions.count; i++) {
                const origX = original.getX(i);
                const origY = original.getY(i);
                const origZ = original.getZ(i);

                // Normalize height (0 at base, 1 at top)
                const normalizedHeight = (origY + props.height / 2) / props.height;

                // Bend increases with height (base doesn't bend, top bends most)
                const heightBendFactor = Math.pow(normalizedHeight, heightPower); // Power-controlled bend curve

                // Apply bend in wind direction (use global wind direction if available)
                // Note: windDirection is (x, y) where y maps to Z in world space
                const windDirX = this.windDirection ? this.windDirection.x : 1;
                const windDirZ = this.windDirection ? this.windDirection.y : 0;

                const bendOffset = totalBend * heightBendFactor;

                positions.setX(i, origX + bendOffset * windDirX);
                positions.setZ(i, origZ + bendOffset * windDirZ);

                // Debug: log calculated bend direction for first tree's top vertex (last vertex)
                if (animatedCount === 0 && i === positions.count - 1 && Math.floor(time * 60) % 60 === 0) {
                    console.log(`[WIND BEND TOP] Applying bend: X=${(bendOffset * windDirX).toFixed(4)}, Z=${(bendOffset * windDirZ).toFixed(4)}`);
                }
            }

            positions.needsUpdate = true;
            trunk.geometry.computeVertexNormals();

            // Update branch positions to follow trunk deformation (re-enabled for visibility)
            // But apply much smaller bend factor to prevent excessive swaying
            for (let i = 1; i < tree.children.length; i++) {
                const child = tree.children[i];
                if (child.isMesh && child.userData.isBranch && child.userData.initialX !== undefined) {
                    // Calculate bend offset at branch height
                    const branchHeight = child.userData.initialY;
                    const normalizedHeight = (branchHeight + props.height / 2) / props.height;
                    const heightBendFactor = Math.pow(normalizedHeight, 2);
                    // REDUCED: Only 10% of the trunk bend for branches to reduce swaying
                    const branchBendOffset = totalBend * heightBendFactor * 0.1;

                    const windDirX = this.windDirection ? this.windDirection.x : 1;
                    const windDirZ = this.windDirection ? this.windDirection.y : 0;

                    // Apply reduced bend offset to initial position
                    child.position.x = child.userData.initialX + branchBendOffset * windDirX;
                    child.position.z = child.userData.initialZ + branchBendOffset * windDirZ;
                }
            }

            // Move foliage with the trunk's top bend
            // Calculate bend at the top of the trunk (heightBendFactor = 1)
            const topBendOffset = totalBend * 1.0; // Full bend at top

            // Apply this offset to all foliage meshes (children 1 and beyond)
            // Scale the bend offset by the trunk's width scale for consistency
            const widthScale = trunk.scale.x;
            const heightScale = trunk.scale.y;

            let foliageMovedCount = 0;
            for (let i = 1; i < tree.children.length; i++) {
                const foliage = tree.children[i];
                // Skip branches - they should not be animated by foliage wind
                if (foliage.userData.isBranch) continue;
                if (foliage.isMesh && foliage.userData.originalX !== undefined) {
                    // Calculate foliage height factor (0 at base, 1 at top)
                    // For Nintendo-style trees the canopy sits just below the trunk tip,
                    // so we cap at 1.0 to prevent the big sphere from lagging behind the trunk
                    const foliageHeight = foliage.userData.originalY * heightScale;
                    const heightFactor = Math.min(1.0, foliageHeight / props.height);

                    // Apply bend offset proportional to height (lower leaves move less, upper leaves move more)
                    const foliageBendOffset = topBendOffset * heightFactor;

                    // Add individual wind flutter for each foliage mesh
                    // Each foliage mesh has its own phase for independent movement
                    if (!foliage.userData.flutterPhase) {
                        foliage.userData.flutterPhase = Math.random() * Math.PI * 2;
                    }
                    
                    // Approach #2: Some planes follow trunk, others add variations
                    // Add significant phase offset based on foliage index so planes don't move in sync
                    const foliageIndex = foliage.userData.foliageIndex || 0;
                    const planeOffset = foliage.userData.planeIndex || 0;
                    const phaseOffset = (foliageIndex * 1.5) + (planeOffset * 0.75); // Increased phase offset
                    
                    let individualFlutter;
                    if (foliage.userData.followsTrunk) {
                        // First plane follows trunk directly (less CPU)
                        individualFlutter = Math.sin(time * 2.5 + foliage.userData.flutterPhase + phaseOffset) * 0.02;
                    } else {
                        // Second plane adds more variation (more movement)
                        individualFlutter = Math.sin(time * 3.5 + foliage.userData.flutterPhase + phaseOffset) * 0.03;
                    }

                    // Apply bend in wind direction (use global wind direction if available)
                    const windDirX = this.windDirection ? this.windDirection.x : 1;
                    const windDirZ = this.windDirection ? this.windDirection.y : 0;

                    // Apply horizontal bend to foliage position
                    // Add time-based variation based on foliage index to prevent sync movement
                    const timeVariation = Math.sin(time * 2.0 + foliageIndex * 0.5) * 0.03; // Time-varying offset
                    foliage.position.x = foliage.userData.originalX + (foliageBendOffset * widthScale * 1.0 * windDirX) + individualFlutter + timeVariation * windDirX;
                    foliage.position.z = foliage.userData.originalZ + (foliageBendOffset * widthScale * 1.0 * windDirZ) + timeVariation * windDirZ;

                    // Add subtle rotation flutter so tilted planes sway naturally
                    const rotFlutter = individualFlutter * 2.0; // Slightly more rotation than translation
                    foliage.rotation.x = foliage.userData.originalRotationX + rotFlutter * (Math.sin(time * 1.3 + phaseOffset) * 0.5);
                    foliage.rotation.y = foliage.userData.originalRotationY + rotFlutter * (Math.cos(time * 1.1 + phaseOffset) * 0.3);
                    foliage.rotation.z = foliage.userData.originalRotationZ + rotFlutter * (Math.sin(time * 1.7 + phaseOffset) * 0.5);

                    foliageMovedCount++;
                }
            }

            // Debug: log first tree's foliage movement
            if (animatedCount === 1 && Math.floor(time * 60) % 60 === 0) {
                console.log(`[WIND FOLIAGE] Moved ${foliageMovedCount} foliage meshes, topBendOffset=${topBendOffset.toFixed(4)}, widthScale=${widthScale.toFixed(2)}, trunk position: (${trunk.position.x.toFixed(2)},${trunk.position.y.toFixed(2)},${trunk.position.z.toFixed(2)})`);
            }

            animatedCount++;
        }
        
        // Debug log every 60 frames (show even if 0 animated)
        if (Math.floor(time * 60) % 60 === 0) {
            console.log(`[WIND] Animated ${animatedCount}/${this.trees.size} trees, skipped: noProps=${skippedNoProps}, noTrunk=${skippedNoTrunk}, noOriginal=${skippedNoOriginal}, time=${time.toFixed(2)}`);
        }
    }

    _onTreeCulled(proxy) {
        if (proxy.treeRef) {
            const [x, z] = proxy.key.split(',').map(Number);
            this.removeTreeFromTile(x, z, { fromLOD: true });
            proxy.treeRef = null;
        }
    }

    _onTreeVisible(proxy) {
        if (!proxy.treeRef) {
            const [x, z] = proxy.key.split(',').map(Number);
            const h = this.terrainSystem ? this.terrainSystem.getHeight(x, z) : proxy.height || 0;
            this.addTreeToTile(x, z, h);
        }
    }

    clearAllTrees() {
        for (const tree of this.trees.values()) {
            this.scene.remove(tree);
            tree.visible = false;
            if (this.treePool.length < this.maxTreePoolSize) {
                this.treePool.push(tree);
            }
        }
        this.trees.clear();
        if (this.lodManager) {
            for (const [key] of this._treeProxies) {
                this.lodManager.remove('localTrees', key);
            }
        }
        this._treeProxies.clear();
    }

    updateLOD(cameraPosition, camera) {
        // Update camera position for distance calculations
        this.cameraPosition.copy(cameraPosition);

        // If LODManager handles visibility, skip own frustum/distance culling
        let frustum = null;
        if (!this.lodManager) {
            const projScreenMatrix = new THREE.Matrix4();
            const broadenedFOV = (camera.fov + 5) * (Math.PI / 180);
            const aspect = camera.aspect;
            const near = camera.near;
            const far = camera.far;
            const tempMatrix = new THREE.Matrix4();
            tempMatrix.makePerspective(
                -Math.tan(broadenedFOV / 2) * near * aspect,
                 Math.tan(broadenedFOV / 2) * near * aspect,
                 Math.tan(broadenedFOV / 2) * near,
                -Math.tan(broadenedFOV / 2) * near,
                near, far
            );
            projScreenMatrix.multiplyMatrices(tempMatrix, camera.matrixWorldInverse);
            frustum = new THREE.Frustum();
            frustum.setFromProjectionMatrix(projScreenMatrix);
        }

        let visibleCount = 0;
        let culledDistance = 0;
        let culledFrustum = 0;
        const now = performance.now();

        for (const [key, tree] of this.trees) {
            const distance = tree.position.distanceTo(cameraPosition);

            if (!this.lodManager) {
                // Distance culling: hide trees beyond max distance
                if (distance > this.maxRenderDistance) {
                    tree.visible = false;
                    culledDistance++;
                    continue;
                }

                // Frustum culling: hide trees outside camera view
                if (frustum && !frustum.containsPoint(tree.position)) {
                    tree.visible = false;
                    culledFrustum++;
                    continue;
                }
            }

            tree.visible = true;
            visibleCount++;

            // --- Foliage mesh count LOD ---
            // Nintendo tree: 8 balls total (center + top + 6 ring)
            let targetFoliageCount = 8;
            if (distance >= 50)       targetFoliageCount = 1;
            else if (distance >= 40)  targetFoliageCount = 2;
            else if (distance >= 30)  targetFoliageCount = 3;
            else if (distance >= 20)  targetFoliageCount = 4;
            else if (distance >= 12)  targetFoliageCount = 6;

            // Only recompute LOD when distance has changed enough to matter
            const lastLOD = tree.userData._lastLOD || {};
            const lodDelta = Math.abs(distance - (lastLOD.distance || 0));
            if (lodDelta > 0.5 || lastLOD.targetFoliageCount !== targetFoliageCount) {
                this.applyFoliageLOD(tree, targetFoliageCount, distance);
                tree.userData._lastLOD = { distance, targetFoliageCount };
            }

            // --- Texture density LOD ---
            let densityLevel;
            if (distance < 20)       densityLevel = 'high';
            else if (distance < 40)  densityLevel = 'medium';
            else                     densityLevel = 'low';

            if (tree.userData._lastDensity !== densityLevel) {
                tree.userData._lastDensity = densityLevel;
                const targetTexture = this.leafTextures[densityLevel];
                tree.traverse((child) => {
                    if (!child.isMesh || !child.material) return;
                    if (child.material.uniforms && child.material.uniforms.map) {
                        if (child.material.uniforms.map.value !== targetTexture) {
                            child.material.uniforms.map.value = targetTexture;
                        }
                    } else if (child.material.map !== targetTexture) {
                        child.material.map = targetTexture;
                        child.material.needsUpdate = true;
                    }
                });
            }

            // --- Spawn fade: only run for trees that are actually fading in ---
            const spawnDuration = 500;
            const timeSinceSpawn = now - (tree.userData.spawnTime || 0);
            if (timeSinceSpawn < spawnDuration) {
                const spawnFade = Math.max(0, Math.min(1, timeSinceSpawn / spawnDuration));
                tree.traverse((child) => {
                    if (!child.isMesh || !child.material) return;
                    if (child === tree.children[0]) return; // skip trunk
                    if (child.userData.isFoliagePrepass) {
                        child.visible = false;
                        return;
                    }
                    child.material.opacity = spawnFade;
                    child.material.transparent = true;
                    child.material.depthWrite = false;
                    child.material.needsUpdate = true;
                });
                tree.userData._spawnComplete = false;
            } else if (!tree.userData._spawnComplete) {
                tree.userData._spawnComplete = true;
                tree.traverse((child) => {
                    if (child.userData.isFoliagePrepass) child.visible = true;
                });
            }
        }

        // Throttled debug log (once every 2 seconds)
        if (!this.lodManager && Math.floor(now / 2000) % 2 === 0) {
            console.log(`[TREE LOD] Visible: ${visibleCount}/${this.trees.size}, culled by distance: ${culledDistance}, culled by frustum: ${culledFrustum}`);
        }
    }

    applyFoliageLOD(tree, targetFoliageCount, distance) {
        // Cache foliage mesh list on the tree object so we don't rebuild it every frame.
        // Procedural trees have foliage as direct children 1-8; GLB trees have it nested.
        let foliageMeshes = tree.userData._foliageMeshes;
        if (!foliageMeshes) {
            foliageMeshes = [];
            if (tree.children[0] && tree.children[0].isMesh && tree.children[0].userData.isTrunk) {
                for (let i = 1; i < tree.children.length; i++) {
                    const c = tree.children[i];
                    if (c.isMesh && c.userData.isFoliage) foliageMeshes.push(c);
                }
            } else if (tree.children[0] && tree.children[0].isObject3D) {
                tree.children[0].traverse((child) => {
                    if (child.isMesh && child.userData.isFoliage) foliageMeshes.push(child);
                });
            }
            tree.userData._foliageMeshes = foliageMeshes;
        }

        const lodThresholds = [12, 20, 30, 40, 50];
        const transitionZone = 4.0;
        let actuallyVisible = 0;

        for (let i = 0; i < foliageMeshes.length; i++) {
            const child = foliageMeshes[i];

            // Branches are always visible (only relevant for GLB trees)
            if (child.userData.isBranch) {
                child.visible = true;
                continue;
            }

            const shouldShow = actuallyVisible < targetFoliageCount;
            if (shouldShow) {
                // Near transition point: gently fade the last visible ball(s)
                const nextThreshold = lodThresholds[targetFoliageCount - 1] || 50;
                const distanceToThreshold = nextThreshold - distance;
                let opacity = 1.0;
                if (distanceToThreshold < transitionZone && distanceToThreshold > 0) {
                    opacity = Math.max(0.3, distanceToThreshold / transitionZone);
                }
                if (child.material.opacity !== opacity) {
                    child.material.opacity = opacity;
                    child.material.transparent = true;
                    child.material.needsUpdate = true;
                }
                child.visible = true;
                actuallyVisible++;
            } else {
                // Fade out as we approach the threshold from below
                const prevThreshold = lodThresholds[targetFoliageCount - 2] || 12;
                const distFrom = distance - prevThreshold;
                let opacity = 0.0;
                if (distFrom < transitionZone && distFrom > -transitionZone) {
                    opacity = 1.0 - ((distFrom + transitionZone) / (transitionZone * 2));
                    opacity = Math.max(0, Math.min(1, opacity));
                }
                const shouldBeVisible = opacity > 0.01;
                if (child.visible !== shouldBeVisible) child.visible = shouldBeVisible;
                if (child.material.opacity !== opacity) {
                    child.material.opacity = opacity;
                    child.material.transparent = true;
                    child.material.needsUpdate = true;
                }
            }
        }

        tree.userData.foliageLOD = targetFoliageCount;
        tree.userData.lodDistance = distance;
    }

    updateCameraPosition(cameraPosition, camera) {
        this.cameraPosition.copy(cameraPosition);

        // Update LOD based on camera position
        this.updateLOD(cameraPosition, camera);

        const chunkX = Math.floor(cameraPosition.x / this.chunkSize);
        const chunkZ = Math.floor(cameraPosition.z / this.chunkSize);

        if (chunkX !== this.lastCameraChunk.x || chunkZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: chunkX, z: chunkZ };
            this.updateTreesAroundCamera();
        }
    }

    updateTreeFade() {
        // Trees are always visible within fog distance; culling handles visibility
    }

    async updateTreesFromServerData() {
        // Not used; trees are placed based on local terrain blocking
    }

    isWithinFogDistance(x, z) {
        const dx = (x + 0.5) - this.cameraPosition.x;
        const dz = (z + 0.5) - this.cameraPosition.z;
        const fogDistance = this.scene.fog ? this.scene.fog.far : 60;
        return (dx * dx + dz * dz) <= fogDistance * fogDistance;
    }

    processChunk(chunkX, chunkZ) {
        if (!this.terrainSystem) return;
        for (let x = 0; x < this.chunkSize; x++) {
            for (let z = 0; z < this.chunkSize; z++) {
                const wx = chunkX * this.chunkSize + x;
                const wz = chunkZ * this.chunkSize + z;
                if (typeof this.terrainSystem.isTileBlocked === 'function') {
                    const h = this.terrainSystem.getHeight ? this.terrainSystem.getHeight(wx, wz) : 0;
                    const waterLevel = -1.5;
                    const isAboveWater = !isNaN(h) && h !== null && h !== undefined && h >= waterLevel;
                    // Always remove trees that are underwater, even if tile is otherwise blocked
                    if (!isAboveWater && this.trees.has(`${wx},${wz}`)) {
                        this.removeTreeFromTile(wx, wz);
                        continue;
                    }
                    if (this.terrainSystem.isTileBlocked(wx, wz)) {
                        // Only add tree if terrain height is valid AND above water
                        if (isAboveWater) {
                            // Alternate between local (new) and alt (old) tree systems for side-by-side comparison
                            if (this.altTreeSystem && ((wx + wz) % 2 !== 0)) {
                                this.altTreeSystem.addTreeToTile(wx, wz);
                            } else {
                                this.addTreeToTile(wx, wz, h);
                            }
                        }
                    } else {
                        this.removeTreeFromTile(wx, wz);
                    }
                }
            }
        }
    }

    updateTreesAroundCamera() {
        if (this.isUpdating) return;
        this.isUpdating = true;

        const fogDistance = this.scene.fog ? this.scene.fog.far : 60;
        const minChunkX = Math.floor((this.cameraPosition.x - fogDistance) / this.chunkSize);
        const maxChunkX = Math.ceil((this.cameraPosition.x + fogDistance) / this.chunkSize);
        const minChunkZ = Math.floor((this.cameraPosition.z - fogDistance) / this.chunkSize);
        const maxChunkZ = Math.ceil((this.cameraPosition.z + fogDistance) / this.chunkSize);

        // Remove trees outside chunk range (return to pool via removeTreeFromTile)
        for (const [key, tree] of this.trees) {
            const [tx, tz] = key.split(',').map(Number);
            const tcX = Math.floor(tx / this.chunkSize);
            const tcZ = Math.floor(tz / this.chunkSize);
            if (tcX < minChunkX || tcX > maxChunkX || tcZ < minChunkZ || tcZ > maxChunkZ) {
                this.removeTreeFromTile(tx, tz);
            }
        }

        // Add trees in range using local terrain data (non-blocking)
        if (this.terrainSystem && typeof this.terrainSystem.isTileBlocked === 'function') {
            for (let cx = minChunkX; cx <= maxChunkX; cx++) {
                for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                    this.processChunk(cx, cz);
                }
            }
        }

        this.isUpdating = false;
    }

    getChunksInRange() {
        const fogDistance = this.scene.fog ? this.scene.fog.far : 60;
        const minChunkX = Math.floor((this.cameraPosition.x - fogDistance) / this.chunkSize);
        const maxChunkX = Math.ceil((this.cameraPosition.x + fogDistance) / this.chunkSize);
        const minChunkZ = Math.floor((this.cameraPosition.z - fogDistance) / this.chunkSize);
        const maxChunkZ = Math.ceil((this.cameraPosition.z + fogDistance) / this.chunkSize);
        const x = [], z = [];
        for (let i = minChunkX; i <= maxChunkX; i++) x.push(i);
        for (let i = minChunkZ; i <= maxChunkZ; i++) z.push(i);
        return { x, z };
    }

    updateVisibleTrees() {
        this.updateTreesAroundCamera();
    }

    removeDistantTrees() {
        this.updateTreesAroundCamera();
    }

    updateTrees(windDirection, windTime, windSpeed, camera) {
        // DEPRECATED: All wind animation is now handled by updateWindAnimation()
        // This function is kept for backward compatibility but does nothing
        // to prevent double-animation of trees.
    }
}
