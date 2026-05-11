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
        this._injectWindShader(trunkMat, 0.015);
        parts.push({
            name: 'trunk',
            mesh: this._makeInstancedMesh(trunkGeo, trunkMat, true),
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
            this._injectWindShader(branchMat, 0.02);
            parts.push({
                name: 'branch_' + i,
                mesh: this._makeInstancedMesh(branchGeo, branchMat, true),
                offset: { x: 0, y: 0, z: 0 },
                scaleY: 1.0,
                swayAmount: 0.08
            });
        }

        // --- TWIGS (16 twigs, 4 per branch) - separate mesh for each twig ---
        const twigConfigs = [];
        for (let b = 0; b < 4; b++) {
            const base = branchConfigs[b];
            for (let t = 0; t < 4; t++) {
                const twigAngleX = base.angleX + (Math.random() - 0.5) * 0.6;
                const twigAngleZ = base.angleZ + (Math.random() - 0.5) * 0.6;
                const twigHeight = base.height + 0.2 + t * 0.2;
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

        for (let i = 0; i < 16; i++) {
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
            this._injectWindShader(twigMat, 0.03);
            parts.push({
                name: 'twig_' + i,
                mesh: this._makeInstancedMesh(twigGeo, twigMat, true),
                offset: { x: 0, y: 0, z: 0 },
                scaleY: 1.0,
                swayAmount: 0.12
            });
        }

        // --- FOLIAGE (9 foliage spheres, positioned relative to trunk base) ---
        const foliageConfigs = [
            { x: 0, y: 1.8, z: 0 },           // Trunk top
        ];

        for (let b = 0; b < 4; b++) {
            const base = branchConfigs[b];
            const attachX = Math.sin(base.angleZ) * 0.15;
            const attachZ = -Math.sin(base.angleX) * 0.15;
            const midHeight = base.height + 0.4;
            const midX = attachX + Math.sin(base.angleZ) * 0.4;
            const midZ = attachZ - Math.sin(base.angleX) * 0.4;
            foliageConfigs.push({ x: midX, y: midHeight, z: midZ });
            const extHeight = base.height + 0.7;
            const extX = attachX + Math.sin(base.angleZ) * 0.7;
            const extZ = attachZ - Math.sin(base.angleX) * 0.7;
            foliageConfigs.push({ x: extX, y: extHeight, z: extZ });
        }

        for (let i = 0; i < foliageConfigs.length; i++) {
            const foliageGeo = new THREE.SphereGeometry(0.4, 16, 12);
            const pos = foliageConfigs[i];
            foliageGeo.translate(pos.x, pos.y, pos.z);
            const foliageMat = new THREE.MeshStandardMaterial({
                map: this.seasonTextures.get('summer'),
                color: 0xffffff,
                roughness: 0.9,
                metalness: 0.0,
                transparent: true,
                alphaTest: 0.05,
                side: THREE.DoubleSide
            });
            this._injectWindShader(foliageMat, 0.075);
            const foliageMesh = this._makeInstancedMesh(foliageGeo, foliageMat, true); // needsWind = true
            foliageMesh.renderOrder = 1; // Draw after trunk/branches
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

    _makeInstancedMesh(geometry, material, needsWind = false) {
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxTrees);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.count = 0;
        mesh.userData.isTree = true; // For vertex profile categorization

        if (needsWind) {
            // Per-instance random phase so trees don't sway in unison
            const phases = new Float32Array(this.maxTrees);
            const windMults = new Float32Array(this.maxTrees);
            for (let i = 0; i < this.maxTrees; i++) {
                phases[i] = Math.random() * Math.PI * 2;
                windMults[i] = 1.0;
            }
            mesh.geometry.setAttribute('aWindPhase',
                new THREE.InstancedBufferAttribute(phases, 1));
            mesh.geometry.setAttribute('aWindMultiplier',
                new THREE.InstancedBufferAttribute(windMults, 1));
        }

        return mesh;
    }

    _createFoliageShaderMaterial(texture, swayMult) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map:           { value: texture },
                lightDir:      { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                ambient:       { value: 0.65 },
                uWindStrength: this.windUniforms.uWindStrength,
                uSwayMult:     { value: swayMult }
            },
            vertexShader: `
                attribute float aWindMultiplier;

                uniform float uTime;
                uniform float uWindStrength;
                uniform float uSwayMult;

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
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * h * h * 0.12 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * h * h * 0.08 * uSwayMult * aWindMultiplier;
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
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
                    gl_FragColor = vec4(litColor, texel.a * edgeAlpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: true
        });
    }

    _injectWindShader(material, swayAmount) {
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.windUniforms.uTime;
            shader.uniforms.uWindStrength = this.windUniforms.uWindStrength;
            shader.uniforms.uWindDirection = this.windUniforms.uWindDirection;

            console.log('[GrowingTreeSystem] Injecting wind shader with sway amount:', swayAmount);

            shader.vertexShader = `
                uniform float uTime;
                uniform float uWindStrength;
                uniform vec2 uWindDirection;
                attribute float aWindPhase;
                attribute float aWindMultiplier;

                ${shader.vertexShader}
            `;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>

                // Wind animation (hinge from base y=0)
                float heightFromBase = max(position.y, 0.0);
                if (heightFromBase > 0.1) {
                    float windPhase = uTime * 2.0 + aWindPhase + heightFromBase * 0.5;
                    // Directional sway based on wind direction
                    float windAmount = sin(windPhase) * uWindStrength * ${swayAmount.toFixed(3)} * heightFromBase * aWindMultiplier;
                    transformed.x += windAmount * uWindDirection.x;
                    transformed.z += windAmount * uWindDirection.y;
                }
                `
            );

            console.log('[GrowingTreeSystem] Wind shader injected successfully');
        };
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
                    part.mesh.material.uniforms.map.value = texture;
                }
            }
        }
        console.log('[GrowingTreeSystem] Season set to:', this.currentSeason, 'Growth modifier:', this.seasonGrowthModifiers[this.currentSeason]);
    }

    addTree(x, z, y = 0) {
        if (this.treeCount >= this.maxTrees) {
            console.warn('[GrowingTreeSystem] Max trees reached:', this.maxTrees);
            return;
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
            return;
        }

        // Calculate biome modifiers
        const moisture = this.terrainSystem ? this.terrainSystem.getMoistureAt(x, z) : 0.5;
        const temperature = this.terrainSystem ? this.terrainSystem.getTemperatureAt(x, z) : 0.5;
        const elevation = this.terrainSystem ? this.terrainSystem.getElevationAt(x, z) : 0.5;
        const biomeModifier = (moisture + temperature) / 2;
        const nearWater = y < waterLevel + 1.0 ? 1.2 : 1.0;

        // Get wind multiplier from wind field
        const windMultiplier = this.windField.get(`${Math.floor(x)},${Math.floor(z)}`) || 1.0;

        // Per-tree variation
        const growthSpeed = 0.8 + Math.random() * 0.4;
        const finalHeight = (0.8 + Math.random() * 0.4) * 2; // 1.6 - 2.4

        // Store tree data
        this.treeData.push({
            x,
            z,
            y,
            growthStage: 0.1, // Start at 0.1 to avoid zero scale (trees invisible at scale 0)
            growthSpeed,
            finalHeight,
            biomeModifier: biomeModifier * nearWater,
            windMultiplier
        });

        // Initialize height smoothing buffer
        if (!this._currentHeights) {
            this._currentHeights = new Float32Array(this.maxTrees);
        }
        this._currentHeights[index] = y;

        // Set matrices for all parts
        this._scratchMatrix.compose(
            this._scratchPos.set(x, y, z),
            this._scratchQuat.set(0, 0, 0, 1),
            this._scratchScale.set(1, 1, 1)
        );

        for (const part of this.parts) {
            part.mesh.setMatrixAt(index, this._scratchMatrix);
            // Set wind multiplier attribute if present
            if (part.mesh.geometry.attributes.aWindMultiplier) {
                part.mesh.geometry.attributes.aWindMultiplier.setX(index, windMultiplier);
            }
        }

        this.treeCount++;

        // Update all mesh counts
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
        }

        // Update wind multiplier attributes
        for (const part of this.parts) {
            if (part.mesh.geometry.attributes.aWindMultiplier) {
                part.mesh.geometry.attributes.aWindMultiplier.needsUpdate = true;
            }
        }
    }

    update(timeSec, windStrength, windDirection) {
        // Update wind uniforms
        this.windUniforms.uTime.value = timeSec;
        this.windUniforms.uWindStrength.value = (windStrength != null ? windStrength : 0.8) * 0.5;
        if (windDirection != null) {
            this.windUniforms.uWindDirection.value.set(
                windDirection.x || 1,
                windDirection.y || 0
            );
        }

        // Debug: log wind strength
        if (Math.random() < 0.01) {
            console.log('[GrowingTreeSystem] Wind strength:', this.windUniforms.uWindStrength.value, 'Time:', timeSec);
        }

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
            if (data.growthStage < 1.0) {
                const growthRate = (1.0 / this.growthDuration) * data.growthSpeed * data.biomeModifier * seasonModifier;
                data.growthStage = Math.min(data.growthStage + growthRate * deltaTime, 1.0);
            }
        }
    }

    _applyGrowthScaling() {
        for (let i = 0; i < this.treeCount; i++) {
            const data = this.treeData[i];
            const growthScale = data.growthStage * data.finalHeight;

            // Ensure minimum scale to avoid invisible trees
            const scale = Math.max(growthScale, 0.1);

            this._scratchMatrix.compose(
                this._scratchPos.set(data.x, data.y, data.z),
                this._scratchQuat.set(0, 0, 0, 1),
                this._scratchScale.set(scale, scale, scale)
            );

            for (const part of this.parts) {
                part.mesh.setMatrixAt(i, this._scratchMatrix);
            }
        }

        for (const part of this.parts) {
            part.mesh.instanceMatrix.needsUpdate = true;
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

        if (Math.random() < 0.02) {
            console.log('[GrowingTreeSystem] updateTreeHeights called, treeCount:', this.treeCount, 'camera pos:', camera.position.x, camera.position.z);
        }

        // Throttle distant tree updates to ~4 Hz (every 250 ms)
        const now = performance.now();
        const shouldUpdateDistant = !this._lastDistantTreeUpdate || (now - this._lastDistantTreeUpdate) > 250;

        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];

            // Check if tree is within mesh range
            const dx = Math.abs(tree.x - camera.position.x);
            const dz = Math.abs(tree.z - camera.position.z);

            let targetHeight;
            if (dx <= meshExtent && dz <= meshExtent) {
                // Within mesh range: use terrain system (synchronous)
                targetHeight = board.getUnifiedTerrainHeight(tree.x, tree.z);
            } else {
                // Outside mesh range: use square heights (async - skip this frame if not ready)
                // For now, keep current height to avoid jarring updates
                targetHeight = this._currentHeights[i] || tree.y;

                // Trigger async update in background using square heights
                if (shouldUpdateDistant && typeof board.getSquareHeights === 'function') {
                    board.getSquareHeights(tree.x, tree.z).then(height => {
                        // Discard underwater height updates
                        if (height < waterCutoff) return;
                        // Update height when server response arrives
                        if (this._currentHeights && this._currentHeights[i] !== undefined) {
                            this._currentHeights[i] = height;
                            tree.y = height;
                            this.updateTreeInstanceMatrix(i, tree);
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

            // Get terrain normal at tree position (includes ripple effects)
            let finalHeight = newHeight;
            let rippleTiltX = 0;
            let rippleTiltZ = 0;

            if (board.getTerrainNormal) {
                const normal = board.getTerrainNormal(tree.x, tree.z);

                // Convert normal to tilt angles
                // Normal (nx, ny, nz) → tilt angles
                // pitch = atan2(nx, ny) (tilt forward/back)
                // roll = atan2(-nz, ny) (tilt left/right)
                rippleTiltX = Math.atan2(normal.x, normal.y);
                rippleTiltZ = Math.atan2(-normal.z, normal.y);

                if (Math.random() < 0.02) {
                    console.log('[GrowingTreeSystem] Tree', i, 'normal:', normal.x.toFixed(3), normal.y.toFixed(3), normal.z.toFixed(3), 'tiltX:', rippleTiltX.toFixed(4), 'tiltZ:', rippleTiltZ.toFixed(4));
                }
            }

            // Update the Y position in the tree data
            tree.y = finalHeight;

            if (Math.random() < 0.005 && i === 0) {
                console.log('[GrowingTreeSystem] Tree 0: current y:', tree.y.toFixed(3), 'targetHeight:', targetHeight.toFixed(3), 'finalHeight:', finalHeight.toFixed(3), 'tiltX:', rippleTiltX.toFixed(3), 'tiltZ:', rippleTiltZ.toFixed(3), 'dx:', dx.toFixed(1), 'dz:', dz.toFixed(1));
            }

            // Update the instance matrix for this tree (with terrain tilt)
            this.updateTreeInstanceMatrix(i, tree, rippleTiltX, rippleTiltZ);
        }

        if (shouldUpdateDistant) {
            this._lastDistantTreeUpdate = now;
        }
    }

    updateTreeInstanceMatrix(i, tree, rippleTiltX = 0, rippleTiltZ = 0) {
        const growthScale = tree.growthStage * tree.finalHeight;
        const scale = Math.max(growthScale, 0.1);

        // Apply ripple tilt to the rotation (entire tree as a unit around its base)
        this._scratchEuler.set(rippleTiltX, 0, rippleTiltZ);
        this._scratchQuat.setFromEuler(this._scratchEuler);

        if (Math.abs(rippleTiltX) > 0.001 || Math.abs(rippleTiltZ) > 0.001) {
            if (Math.random() < 0.05) {
                console.log('[GrowingTreeSystem] updateTreeInstanceMatrix tree', i, 'tilt applied:', rippleTiltX.toFixed(4), rippleTiltZ.toFixed(4), 'euler:', this._scratchEuler.x.toFixed(4), this._scratchEuler.y.toFixed(4), this._scratchEuler.z.toFixed(4));
            }
        }

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

        for (const part of this.parts) {
            part.mesh.instanceMatrix.needsUpdate = true;
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
        console.log('[GrowingTreeSystem] Season set to:', this.currentSeason, 'Growth modifier:', this.seasonGrowthModifiers[this.currentSeason]);
    }

    computeWindField() {
        // Use board's shared wind field computation
        const board = window.game && window.game.boardSystem;
        if (!board || !board.computeTreeWindField) {
            console.warn('[GrowingTreeSystem] No board wind field computation available');
            return;
        }

        // Pass tree data to board for wind field computation
        board.computeTreeWindField(this.treeData, this.windField);
        console.log('[GrowingTreeSystem] Wind field computed using board system for', this.windField.size, 'tiles');
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
