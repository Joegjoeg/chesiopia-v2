var UP = window.UP || new THREE.Vector3(0, 1, 0);
window.UP = UP;

// GrowingTreeSystem
// A tree system combining TerrainTreeSystem's instanced mesh performance and wind effects
// with LocalTreeSystem's foliage textures, featuring shader-based growth animation with
// biome and seasonal modifiers.
//
// Uses separate InstancedMesh per part (trunk, branches, twigs, foliage) like TerrainTreeSystem
// to avoid geometry merging issues. Trees start at growth stage 0 and grow to full
// over 80 seconds with per-tree variation and biome/seasonal modifiers.

class GrowingTreeSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;

        this.maxTrees = 1500;
        this.treeCount = 0;
        this.treeData = []; // metadata per tree (growth stage, speed, biome modifiers, etc.)
        this.windField = new Map();
        this.parts = []; // Array of part objects {name, mesh, offset, scaleY, swayAmount}

        // Height smoothing buffer to match terrain mesh rubber sheet effect
        this._heightSmoothingFactor = 0.25;
        this._currentHeights = null;

        // Growth configuration
        this.growthDuration = 80; // seconds to full growth
        this.currentSeason = 'SUMMER';

        // Seasonal growth rate modifiers
        this.seasonGrowthModifiers = {
            SPRING: 1.2,
            SUMMER: 1.0,
            AUTUMN: 0.8,
            WINTER: 0.3
        };

        // Color palette
        this.colors = {
            trunk:   new THREE.Color(0x5a3f2a),
            branch:  new THREE.Color(0x4a3525),
            twig:    new THREE.Color(0x3a2515),
            foliage: new THREE.Color(0x5aaa32)
        };

        // Wind shader uniforms
        this.windUniforms = {
            uTime:          { value: 0 },
            uWindStrength:  { value: 0.4 },
            uWindDirection: { value: new THREE.Vector2(1, 0) }
        };

        // Growth uniform for shader-based animation
        this.growthUniforms = {
            uTime: { value: 0 }
        };

        // Create textures
        this.seasonTextures = this._generateSeasonalTextures();
        this.leafTexture = this.createLeafTexture(0.25, 0.0);
        this.barkNormalMap = this.createBarkNormalMap();

        // Create parts (separate InstancedMesh per part)
        this._createParts();
        this.parts.forEach(p => this.scene.add(p.mesh));

        // Shared scratch objects
        this._scratchMatrix = new THREE.Matrix4();
        this._scratchPos = new THREE.Vector3();
        this._scratchQuat = new THREE.Quaternion();
        this._scratchScale = new THREE.Vector3();
        this._scratchEuler = new THREE.Euler();

        console.log('[GrowingTreeSystem] Initialized with separate instanced mesh architecture');
    }

    _createParts() {
        const parts = [];

        // --- TRUNK (single cylinder) ---
        const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1.8, 12, 4); // 4 height segments for rings
        trunkGeo.translate(0, 0.9, 0); // Center at y=0.9 so base is at y=0
        const trunkMat = new THREE.MeshStandardMaterial({
            color: this.colors.trunk,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        parts.push({
            name: 'trunk',
            mesh: this._makeInstancedMesh(trunkGeo, trunkMat),
            offset: { x: 0, y: 0, z: 0 },
            scaleY: 1.0,
            swayAmount: 0.05
        });

        // --- BRANCHES (4 branches, positioned relative to trunk base) ---
        const branchConfigs = [
            { angleX: Math.PI / 4, angleZ: 0.3, height: 0.8 },
            { angleX: Math.PI / 4, angleZ: -Math.PI / 4, height: 0.6 },
            { angleX: -Math.PI / 4, angleZ: Math.PI / 4, height: 1.0 },
            { angleX: -Math.PI / 4, angleZ: -Math.PI / 4, height: 0.9 }
        ];

        for (let i = 0; i < 4; i++) {
            const base = branchConfigs[i];
            const branchGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.8, 8);
            branchGeo.translate(0, 0.4, 0);
            branchGeo.rotateX(base.angleX);
            branchGeo.rotateZ(base.angleZ);
            branchGeo.translate(0, base.height, 0);
            const branchMat = new THREE.MeshStandardMaterial({
                color: this.colors.branch,
                roughness: 0.9,
                metalness: 0.0,
                side: THREE.DoubleSide
            });
            parts.push({
                name: 'branch_' + i,
                mesh: this._makeInstancedMesh(branchGeo, branchMat),
                offset: { x: 0, y: 0, z: 0 },
                scaleY: 1.0,
                swayAmount: 0.08
            });
        }

        // --- TWIGS (8 twigs, 2 per branch) - separate mesh for each twig ---
        const twigConfigs = [];
        for (let b = 0; b < 4; b++) {
            const base = branchConfigs[b];
            for (let t = 0; t < 2; t++) {
                const twigAngleX = base.angleX + (Math.random() - 0.5) * 0.6;
                const twigAngleZ = base.angleZ + (Math.random() - 0.5) * 0.6;
                const twigHeight = base.height + 0.2 + t * 0.35;
                const attachX = Math.sin(twigAngleZ) * 0.15;
                const attachZ = -Math.sin(twigAngleX) * 0.15;
                twigConfigs.push({
                    angleX: twigAngleX,
                    angleZ: twigAngleZ,
                    height: twigHeight,
                    attachX,
                    attachZ
                });
            }
        }

        for (let i = 0; i < 8; i++) {
            const twigGeo = new THREE.CylinderGeometry(0.02, 0.04, 0.4, 6);
            twigGeo.translate(0, 0.2, 0);
            const config = twigConfigs[i];
            twigGeo.rotateX(config.angleX);
            twigGeo.rotateZ(config.angleZ);
            twigGeo.translate(config.attachX, config.height, config.attachZ);
            const twigMat = new THREE.MeshStandardMaterial({
                color: this.colors.twig,
                roughness: 0.9,
                metalness: 0.0,
                side: THREE.DoubleSide
            });
            parts.push({
                name: 'twig_' + i,
                mesh: this._makeInstancedMesh(twigGeo, twigMat),
                offset: { x: 0, y: 0, z: 0 },
                scaleY: 1.0,
                swayAmount: 0.12
            });
        }

        // --- FOLIAGE (5 foliage spheres, positioned relative to trunk base) ---
        const foliageConfigs = [
            { x: 0, y: 1.8, z: 0, s: 1.0 },           // Trunk top
        ];

        for (let b = 0; b < 4; b++) {
            const base = branchConfigs[b];
            const attachX = Math.sin(base.angleZ) * 0.15;
            const attachZ = -Math.sin(base.angleX) * 0.15;
            const midHeight = base.height + 0.55;
            const midX = attachX + Math.sin(base.angleZ) * 0.55;
            const midZ = attachZ - Math.sin(base.angleX) * 0.55;
            foliageConfigs.push({ x: midX, y: midHeight, z: midZ, s: 0.9 });
        }

        for (let i = 0; i < foliageConfigs.length; i++) {
            const scale = foliageConfigs[i].s || 1.0;
            const foliageGeo = new THREE.SphereGeometry(0.45 * scale, 8, 6);
            const pos = foliageConfigs[i];
            foliageGeo.translate(pos.x, pos.y, pos.z);
            const foliageMat = new THREE.MeshStandardMaterial({
                map: this.seasonTextures.get('summer'),
                color: 0xffffff,
                roughness: 0.9,
                metalness: 0.0,
                transparent: true,
                alphaTest: 0.05,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const foliageMesh = this._makeInstancedMesh(foliageGeo, foliageMat);
            foliageMesh.renderOrder = 2; // Draw after transparent water plane
            parts.push({
                name: 'foliage_' + i,
                mesh: foliageMesh,
                offset: { x: 0, y: 0, z: 0 },
                scaleY: 1.0,
                swayAmount: 0.15
            });
        }

        this.parts = parts;
    }

    _makeInstancedMesh(geometry, material) {
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxTrees);
        mesh.name = 'growingTree';
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.frustumCulled = false; // LOD manager handles culling
        mesh.count = 0;
        mesh.userData.isTree = true; // For vertex profile categorization
        return mesh;
    }

    _createFoliageShaderMaterial(texture, swayMult) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map:           { value: texture },
                lightDir:      { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                ambient:       { value: 0.65 },
                uWindStrength: this.windUniforms.uWindStrength,
                uSwayMult:     { value: swayMult },
                uWindHeightPower: { value: 2.0 },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                attribute float aWindMultiplier;

                uniform float uTime;
                uniform float uWindStrength;
                uniform float uSwayMult;
                uniform float uWindHeightPower;

                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;

                void main() {
                    vUv = uv;
                    mat4 localToWorld = modelMatrix * instanceMatrix;
                    vWorldNormal = normalize(mat3(localToWorld) * normal);
                    vec4 wp = localToWorld * vec4(position, 1.0);
                    float h = max(0.0, wp.y);
                    float phase = position.x * 0.5 + position.z * 0.3;
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * pow(h, uWindHeightPower) * 0.12 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * pow(h, uWindHeightPower) * 0.08 * uSwayMult * aWindMultiplier;
                    vWorldPos = wp.xyz;
                    vec4 mvPosition = viewMatrix * wp;
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

                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;

                void main() {
                    vec4 texel = texture2D(map, vUv);
                    if (texel.a < 0.05) discard;
                    vec3 n = normalize(vWorldNormal);
                    float diff = max(dot(n, lightDir), 0.0);
                    vec3 litColor = texel.rgb * (ambient + diff * (1.0 - ambient));
                    // Simple edge fade based on normal Y component
                    float edgeAlpha = smoothstep(0.0, 0.5, abs(n.y));

                    // Distance softening: desaturate + reduce contrast at 40-80 units from camera
                    float camDist = length(cameraPosition - vWorldPos);
                    float softenFactor = smoothstep(40.0, 80.0, camDist);
                    vec3 gray = vec3(dot(litColor, vec3(0.299, 0.587, 0.114)));
                    litColor = mix(litColor, gray, softenFactor * 0.45);
                    litColor = mix(litColor, vec3(0.5), softenFactor * 0.2);

                    gl_FragColor = vec4(litColor, texel.a * edgeAlpha);
                    #include <fog_fragment>
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            fog: true
        });
    }

    _generateSeasonalTextures() {
        const seasons = new Map();
        const defs = [
            { name: 'spring',  leafColor: { r: 100, g: 200,  b: 80  }, blossomColor: { r: 255, g: 182, b: 193 }, blossomChance: 0.12 },
            { name: 'summer',  leafColor: { r: 50,  g: 160,  b: 50  }, blossomColor: null,                        blossomChance: 0    },
            { name: 'autumn',  leafColor: { r: 200, g: 120,  b: 30  }, blossomColor: null,                        blossomChance: 0    },
            { name: 'winter',  leafColor: { r: 140, g: 130,  b: 120 }, blossomColor: { r: 220, g: 225, b: 235 }, blossomChance: 0.18 }
        ];

        for (const s of defs) {
            const size = 256;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);

            const lc = s.leafColor;

            // Main leaves: solid ellipses on transparent background
            for (let i = 0; i < 340; i++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const rx = 3 + Math.random() * 7;
                const ry = rx * (0.60 + Math.random() * 0.38);
                const rot = Math.random() * Math.PI;
                const opacity = 0.60 + Math.random() * 0.40;
                const r = Math.min(255, lc.r + Math.floor((Math.random() - 0.5) * 50));
                const g = Math.min(255, lc.g + Math.floor((Math.random() - 0.5) * 50));
                const b = Math.min(255, lc.b + Math.floor((Math.random() - 0.5) * 30));
                ctx.beginPath();
                ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
                ctx.fill();
            }

            // Leaf clusters
            for (let i = 0; i < 32; i++) {
                const cx = Math.random() * size;
                const cy = Math.random() * size;
                for (let j = 0; j < 6; j++) {
                    const angle = (j / 6) * Math.PI * 2 + Math.random() * 0.6;
                    const d = 4 + Math.random() * 8;
                    const x = cx + Math.cos(angle) * d;
                    const y = cy + Math.sin(angle) * d;
                    const r2 = 3 + Math.random() * 5;
                    ctx.beginPath();
                    ctx.ellipse(x, y, r2, r2 * 0.55, angle, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(${lc.r},${lc.g},${lc.b},${0.65 + Math.random() * 0.35})`;
                    ctx.fill();
                }
            }

            // Blossoms / highlights
            if (s.blossomChance > 0 && s.blossomColor) {
                const bc = s.blossomColor;
                const blossomCount = Math.floor(60 * s.blossomChance);
                for (let i = 0; i < blossomCount; i++) {
                    const x = Math.random() * size;
                    const y = Math.random() * size;
                    const r2 = 2 + Math.random() * 5;
                    ctx.beginPath();
                    ctx.arc(x, y, r2, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(${bc.r},${bc.g},${bc.b},0.9)`;
                    ctx.fill();
                }
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(2, 2);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            seasons.set(s.name, tex);
        }
        return seasons;
    }

    setSeason(season) {
        this.currentSeason = season.toUpperCase();
        const texture = this.seasonTextures.get(season.toLowerCase());
        if (texture) {
            // Update foliage materials with new texture
            for (const part of this.parts) {
                if (part.name.startsWith('foliage_')) {
                    part.mesh.material.map = texture;
                }
            }
        }
        console.log('[GrowingTreeSystem] Season set to:', this.currentSeason, 'Growth modifier:', this.seasonGrowthModifiers[this.currentSeason]);
    }

    addTree(x, z, y = 0, metadata = {}) {
        if (this.treeCount >= this.maxTrees) {
            console.warn('[GrowingTreeSystem] Max trees reached:', this.maxTrees);
            return -1;
        }

        const index = this.treeCount;

        // Use provided y if available, otherwise get from terrain system
        if (y === 0 && this.terrainSystem) {
            y = this.terrainSystem.getHeightAt(x, z);
        }

        // Reject underwater trees
        const waterLevel = this.terrainSystem ? this.terrainSystem.getWaterLevel() : -1.5;
        if (y < waterLevel + 0.05) {
            console.warn('[GrowingTreeSystem] Skipping underwater tree at', x, z, 'height:', y);
            return -1;
        }

        // Calculate biome modifiers
        const moisture = this.terrainSystem ? this.terrainSystem.getMoistureAt(x, z) : 0.5;
        const temperature = this.terrainSystem ? this.terrainSystem.getTemperatureAt(x, z) : 0.5;
        const elevation = this.terrainSystem ? this.terrainSystem.getElevationAt(x, z) : 0.5;
        const biomeModifier = (moisture + temperature) / 2;
        const nearWater = y < waterLevel + 1.0 ? 1.2 : 1.0;

        // Get wind multiplier from wind field
        const windMultiplier = this.windField.get(`${Math.floor(x)},${Math.floor(z)}`) || 1.0;

        // Per-tree variation, biased by biome metadata
        const maxScale = metadata.maxScale || 1.0;
        const growthRate = metadata.growthRate || 1.0;
        const growthSpeed = (0.8 + Math.random() * 0.4) * growthRate;
        const finalHeight = (0.8 + Math.random() * 0.4) * 1.5 * maxScale;

        const board = window.game && window.game.boardSystem;
        const normal = (board && board.getTerrainNormal) ? board.getTerrainNormal(x, z) : new THREE.Vector3(0, 1, 0);

        // Store tree data
        this.treeData.push({
            x,
            z,
            y,
            growthStage: 0.1, // Start at 0.1 to avoid zero scale (trees invisible at scale 0)
            growthSpeed,
            finalHeight,
            biomeModifier: biomeModifier * nearWater,
            windMultiplier,
            normal: normal.clone(),
            biome: metadata.biome,
            species: metadata.species
        });

        // Initialize height smoothing buffer
        if (!this._currentHeights) {
            this._currentHeights = new Float32Array(this.maxTrees);
        }
        this._currentHeights[index] = y;

        // Set matrices for all parts
        this._scratchQuat.setFromUnitVectors(UP, normal);
        this._scratchMatrix.compose(
            this._scratchPos.set(x, y, z),
            this._scratchQuat,
            this._scratchScale.set(1, 1, 1)
        );

        for (const part of this.parts) {
            part.mesh.setMatrixAt(index, this._scratchMatrix);
        }

        this.treeCount++;

        // Update all mesh counts
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
        }

        return index;
    }

    update(timeSec, windStrength, windDirection) {
        this.lastWindDirection = windDirection;
        // Update wind uniforms
        this.windUniforms.uTime.value = timeSec;
        this.windUniforms.uWindStrength.value = (windStrength != null ? windStrength : 0.8) * 0.5;
        if (windDirection != null) {
            this.windUniforms.uWindDirection.value.set(
                windDirection.x || 1,
                windDirection.y || 0
            );
        }

        // Debug: log wind strength (disabled)
        // if (Math.random() < 0.01) {
        //     console.log('[GrowingTreeSystem] Wind strength:', this.windUniforms.uWindStrength.value, 'Time:', timeSec);
        // }

        // Animate growth for all trees (use a fixed delta time approximation)
        this._animateGrowth(0.016);

        // Apply growth scaling to instance matrices
        this._applyGrowthScaling();

        // Update tree heights using terrain system or square heights
        this.updateTreeHeights();
    }

    _animateGrowth(deltaTime) {
        const seasonModifier = this.seasonGrowthModifiers[this.currentSeason] || 1.0;

        for (let i = 0; i < this.treeCount; i++) {
            const data = this.treeData[i];
            if (!data || data._lodVisible === false) continue;
            if (data.growthStage < 1.0) {
                const growthRate = (1.0 / this.growthDuration) * data.growthSpeed * data.biomeModifier * seasonModifier;
                data.growthStage = Math.min(data.growthStage + growthRate * deltaTime, 1.0);
            }
        }
    }

    _applyGrowthScaling() {
        let anyChanged = false;
        for (let i = 0; i < this.treeCount; i++) {
            const data = this.treeData[i];
            if (!data || data._lodVisible === false) continue;
            // Skip fully-grown trees that already have correct scale cached
            if (data._lastGrowthScale === data.growthStage * data.finalHeight && data.growthStage >= 1.0) {
                continue;
            }
            const growthScale = data.growthStage * data.finalHeight;
            data._lastGrowthScale = growthScale;

            // Ensure minimum scale to avoid invisible trees
            const scale = Math.max(growthScale, 0.1);

            const normal = data.normal || UP;
            this._scratchQuat.setFromUnitVectors(UP, normal);
            this._scratchMatrix.compose(
                this._scratchPos.set(data.x, data.y, data.z),
                this._scratchQuat,
                this._scratchScale.set(scale, scale, scale)
            );

            for (const part of this.parts) {
                part.mesh.setMatrixAt(i, this._scratchMatrix);
            }
            anyChanged = true;
        }

        if (anyChanged) {
            for (const part of this.parts) {
                part.mesh.instanceMatrix.needsUpdate = true;
            }
        }
    }

    updateTreeHeights() {
        // Update tree heights using terrain system or square heights depending on distance
        if (this.treeCount === 0 || !this._currentHeights) {
            return;
        }

        const board = window.game && window.game.boardSystem;
        const camera = window.game && window.game.camera;
        if (!board || !camera) {
            console.warn('[GrowingTreeSystem] No board or camera available');
            return;
        }

        const meshExtent = 96; // ±96 units from camera (192x192 vertex grid)
        const waterCutoff = (board.waterLevel != null ? board.waterLevel : -9) + 0.05;

        // Throttle distant tree updates to ~4 Hz (every 250 ms)
        const now = performance.now();
        const shouldUpdateDistant = !this._lastDistantTreeUpdate || (now - this._lastDistantTreeUpdate) > 250;

        let anyMatrixChanged = false;

        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];
            if (!tree || tree._lodVisible === false) continue;

            // Check if tree is within mesh range
            const dx = Math.abs(tree.x - camera.position.x);
            const dz = Math.abs(tree.z - camera.position.z);

            let targetHeight;
            if (dx <= meshExtent && dz <= meshExtent) {
                // Within mesh range: use terrain system (synchronous)
                targetHeight = board.getUnifiedTerrainHeight(tree.x, tree.z);
            } else {
                // Outside mesh range: keep current height; update async occasionally
                targetHeight = this._currentHeights[i] || tree.y;

                // Trigger async update in background using square heights (throttled)
                if (shouldUpdateDistant && typeof board.getSquareHeights === 'function') {
                    board.getSquareHeights(tree.x, tree.z).then(height => {
                        if (height < waterCutoff) return;
                        if (this._currentHeights && this._currentHeights[i] !== undefined) {
                            this._currentHeights[i] = height;
                            tree.y = height;
                            this.updateTreeInstanceMatrix(i, tree);
                            for (const part of this.parts) {
                                part.mesh.instanceMatrix.needsUpdate = true;
                            }
                        }
                    });
                }
            }

            // Never let an already-placed tree sink below the water line
            if (targetHeight < waterCutoff) {
                continue;
            }

            const currentHeight = this._currentHeights[i];
            const newHeight = currentHeight + (targetHeight - currentHeight) * this._heightSmoothingFactor;
            this._currentHeights[i] = newHeight;

            if (board.getTerrainNormal) {
                tree.normal = board.getTerrainNormal(tree.x, tree.z).clone();
            }

            tree.y = newHeight;

            // Only rewrite matrices if height or normal changed meaningfully
            if (Math.abs(newHeight - currentHeight) > 0.001) {
                this.updateTreeInstanceMatrix(i, tree);
                anyMatrixChanged = true;
            }
        }

        if (anyMatrixChanged) {
            for (const part of this.parts) {
                part.mesh.instanceMatrix.needsUpdate = true;
            }
        }

        if (shouldUpdateDistant) {
            this._lastDistantTreeUpdate = now;
        }
    }

    updateTreeInstanceMatrix(i, tree) {
        const growthScale = tree.growthStage * tree.finalHeight;
        const scale = Math.max(growthScale, 0.1) * this.globalTreeSizeMult;

        const normal = tree.normal || UP;
        this._scratchQuat.setFromUnitVectors(UP, normal);

        // For growing trees, all parts share the same position (tree base)
        // Apply the rotation to the instance
        this._scratchMatrix.compose(
            this._scratchPos.set(tree.x, tree.y, tree.z),
            this._scratchQuat,
            this._scratchScale.set(scale, scale, scale)
        );

        for (const part of this.parts) {
            part.mesh.setMatrixAt(i, this._scratchMatrix);
        }
    }

    setGlobalTreeSizeMult(value) {
        this.globalTreeSizeMult = value;
        for (let i = 0; i < this.treeCount; i++) {
            this.updateTreeInstanceMatrix(i, this.treeData[i]);
        }
    }

    createBarkNormalMap() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Fill with neutral gray (no bump)
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, size, size);

        // Add vertical streaks for bark texture
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * size;
            const width = Math.random() * 10 + 5;
            
            // Light streak
            ctx.fillStyle = `rgba(${128 + Math.random() * 40}, ${128 + Math.random() * 40}, ${128 + Math.random() * 40}, 0.5)`;
            ctx.fillRect(x, 0, width, size);
            
            // Dark streak offset
            ctx.fillStyle = `rgba(${128 - Math.random() * 40}, ${128 - Math.random() * 40}, ${128 - Math.random() * 40}, 0.5)`;
            ctx.fillRect(x + Math.random() * 5 - 2.5, 0, width * 0.5, size);
        }

        // Add noise
        for (let i = 0; i < 5000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const brightness = 128 + Math.random() * 60 - 30;
            ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.3)`;
            ctx.fillRect(x, y, 2, 2);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    createLeafTexture(density = 1.0, yearProgress = 0.0) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, size, size);

        // Simple leaf texture - scattered green dots
        const leafCount = Math.floor(120 * density);
        for (let i = 0; i < leafCount; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = Math.random() * 8 + 4;

            ctx.beginPath();
            ctx.ellipse(x, y, radius, radius * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);

            const opacity = Math.random() * 0.5 + 0.4;
            ctx.fillStyle = `rgba(34, 139, 34, ${opacity})`;
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    setSeason(season) {
        this.currentSeason = season.toUpperCase();
        // console.log('[GrowingTreeSystem] Season set to:', this.currentSeason, 'Growth modifier:', this.seasonGrowthModifiers[this.currentSeason]);
    }

    computeWindField() {
        const board = window.game && window.game.boardSystem;
        if (!board || !board.computeTreeWindField) {
            console.warn('[GrowingTreeSystem] No board wind field computation available');
            return;
        }
        board.computeTreeWindField(this.treeData, this.windField);
        // console.log('[GrowingTreeSystem] Wind field computed using board system for', this.windField.size, 'tiles');
    }

    recomputeWindMultipliers() {
        const ps = window.parameterSystem;
        const exposureScale = ps ? (ps.getParameter('windExposureScale')?.value ?? 6.0) : 6.0;
        const shadowStrength = ps ? (ps.getParameter('windShadowStrength')?.value ?? 1.5) : 1.5;
        const wd = this.lastWindDirection || (window.game && window.game.decorativeVisuals && window.game.decorativeVisuals.windDirection) || { x: 1, y: 0 };
        const windDir = new THREE.Vector3(wd.x, 0, wd.y).normalize();
        for (let i = 0; i < this.treeCount; i++) {
            const data = this.treeData[i];
            if (!data || data._lodVisible === false) continue;
            const normal = data.normal || new THREE.Vector3(0, 1, 0);
            const windwardFactor = Math.max(0, normal.dot(windDir));
            let mult = 1.0 + 0.5 * exposureScale;
            mult *= (0.5 + windwardFactor * shadowStrength);
            const baseMult = this.windField.get(`${Math.floor(data.x)},${Math.floor(data.z)}`) || 1.0;
            mult *= baseMult;
            data.windMultiplier = mult;
        }
    }

    clear() {
        this.treeCount = 0;
        this.treeData = [];
        for (const part of this.parts) {
            part.mesh.count = 0;
            part.mesh.instanceMatrix.needsUpdate = true;
        }
        console.log('[GrowingTreeSystem] Cleared all trees');
    }

    /** Remove a single tree by index using swap-with-last for O(1) removal. */
    removeTree(index) {
        if (index < 0 || index >= this.treeCount) return null;
        const removed = this.treeData[index];
        const lastIndex = this.treeCount - 1;
        if (index !== lastIndex) {
            const moved = this.treeData[lastIndex];
            this.treeData[index] = moved;
            this._currentHeights[index] = this._currentHeights[lastIndex];
            this.updateTreeInstanceMatrix(index, moved);
        }
        this.treeData.length = lastIndex;
        this.treeCount = lastIndex;
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
        }
        return removed;
    }

    dispose() {
        for (const part of this.parts) {
            this.scene.remove(part.mesh);
            part.mesh.geometry.dispose();
            part.mesh.material.dispose();
        }
        if (this.leafTexture) {
            this.leafTexture.dispose();
        }
        if (this.barkNormalMap) {
            this.barkNormalMap.dispose();
        }
        console.log('[GrowingTreeSystem] Disposed');
    }

    hasTreeAt(worldX, worldZ) {
        // Simple proximity check - not tracking exact positions in new architecture
        return false;
    }

    getTreeCount() {
        return this.treeCount;
    }
}
