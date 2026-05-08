// TerrainTreeSystem
// Instanced multi-blob canopy trees inspired by aerial deciduous forest.
// One InstancedMesh per "part" (trunk + 5 canopy blobs). All trees share
// the same instance index, so adding a tree at index i sets matrices on
// all 6 InstancedMeshes at slot i. Total draw calls = 6 regardless of
// tree count.

class TerrainTreeSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;

        this.maxTrees = 1500;
        this.treeCount = 0;
        this.treeData = []; // metadata per tree (for future LOD / queries)
        this.windField = new Map(); // Map<"x,z", float> wind multiplier per terrain square

        // Height smoothing buffer to match terrain mesh rubber sheet effect
        this._heightSmoothingFactor = 0.06;
        this._currentHeights = null;

        // Color palette pulled from the aerial-forest reference image
        this.colors = {
            trunk:   new THREE.Color(0x5a3f2a),
            shadow:  new THREE.Color(0x3a7a1e),
            mid:     new THREE.Color(0x5aaa32),
            bright:  new THREE.Color(0x7ac44a)
        };

        // Seasonal foliage textures (one shared texture per season for all canopy blobs)
        this.seasonTextures = this._generateSeasonalTextures();
        this.currentSeason = 'summer';

        // Wind shader uniforms (shared across all materials via onBeforeCompile closure)
        this.windUniforms = {
            uTime:          { value: 0 },
            uWindStrength:  { value: 0.6 },
            uWindDirection: { value: new THREE.Vector2(1, 0) }
        };

        this.parts = this._createParts();
        this.parts.forEach(p => this.scene.add(p.mesh));

        // Shared scratch objects (avoid GC churn in addTree loop)
        this._scratchMatrix = new THREE.Matrix4();
        this._scratchPos    = new THREE.Vector3();
        this._scratchQuat   = new THREE.Quaternion();
        this._scratchScale  = new THREE.Vector3();
        this._scratchEuler  = new THREE.Euler();

        console.log('[TerrainTreeSystem] Initialized with 6-part instanced canopy (capacity ' + this.maxTrees + ')');
    }

    updateTreeHeights() {
        // Smooth tree heights toward terrain mesh heights to match rubber sheet effect
        if (!this._currentHeights || !this.terrainSystem) return;

        const board = window.game && window.game.boardSystem;
        if (!board || typeof board.getSmoothedTerrainHeight !== 'function') return;

        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];
            const targetHeight = board.getSmoothedTerrainHeight(tree.x, tree.z);
            const currentHeight = this._currentHeights[i];
            const newHeight = currentHeight + (targetHeight - currentHeight) * this._heightSmoothingFactor;
            this._currentHeights[i] = newHeight;

            // Update the Y position in the tree data
            tree.y = newHeight;

            // Update the instance matrix for this tree
            this.updateTreeInstanceMatrix(i, tree);
        }
    }

    updateTreeInstanceMatrix(i, tree) {
        const scale = tree.scale;
        const rotY = tree.rotY;
        const cosR = Math.cos(rotY);
        const sinR = Math.sin(rotY);
        const height = tree.y;

        this._scratchEuler.set(0, rotY, 0);
        this._scratchQuat.setFromEuler(this._scratchEuler);

        for (const part of this.parts) {
            const ox = part.offset.x * scale;
            const oy = part.offset.y * scale;
            const oz = part.offset.z * scale;
            const rotatedX = ox * cosR - oz * sinR;
            const rotatedZ = ox * sinR + oz * cosR;

            this._scratchPos.set(
                tree.x + rotatedX,
                height + oy,
                tree.z + rotatedZ
            );
            this._scratchScale.set(scale, scale, scale);

            this._scratchMatrix.compose(
                this._scratchPos,
                this._scratchQuat,
                this._scratchScale
            );
            part.mesh.setMatrixAt(i, this._scratchMatrix);
        }
    }

    _createParts() {
        const parts = [];
        const texSummer = this.seasonTextures.get('summer');

        // --- TRUNK ---
        const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 6);
        const trunkMat = new THREE.MeshStandardMaterial({
            color: this.colors.trunk,
            roughness: 0.95,
            metalness: 0.0,
            flatShading: true
        });
        this._injectWindShader(trunkMat, 0.02); // trunk sways very little
        parts.push({
            name: 'trunk',
            mesh: this._makeInstancedMesh(trunkGeo, trunkMat, true),
            offset: { x: 0, y: 0.8, z: 0 },
            scaleY: 1.0
        });

        // --- CANOPY BLOBS ---
        // 5 overlapping spheres with seasonal leaf texture.
        // Darker blobs sit lower (shadow side); brighter blob crowns the top.
        const blobs = [
            { name: 'canopy_center', radius: 1.20, offset: { x:  0.00, y: 2.20, z:  0.00 }, scaleY: 0.80, color: this.colors.mid    },
            { name: 'canopy_n',      radius: 0.90, offset: { x:  0.55, y: 1.95, z:  0.55 }, scaleY: 0.75, color: this.colors.shadow },
            { name: 'canopy_e',      radius: 0.95, offset: { x: -0.65, y: 2.05, z:  0.45 }, scaleY: 0.75, color: this.colors.mid    },
            { name: 'canopy_s',      radius: 0.85, offset: { x:  0.50, y: 1.80, z: -0.65 }, scaleY: 0.75, color: this.colors.shadow },
            { name: 'canopy_top',    radius: 0.80, offset: { x:  0.05, y: 2.75, z: -0.05 }, scaleY: 0.85, color: this.colors.bright }
        ];

        for (const blob of blobs) {
            const geo = new THREE.SphereGeometry(blob.radius, 8, 6);
            const mat = this._createCanopyShaderMaterial(texSummer, blob.color, 0.09);
            const canopyMesh = this._makeInstancedMesh(geo, mat, true);
            canopyMesh.renderOrder = 1; // draw after horizon so foliage isn't overwritten
            parts.push({
                name: blob.name,
                mesh: canopyMesh,
                offset: blob.offset,
                scaleY: blob.scaleY,
                isCanopy: true
            });
        }

        return parts;
    }

    _createCanopyShaderMaterial(texture, color, swayMult) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map:           { value: texture },
                lightDir:      { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                ambient:       { value: 0.65 },
                edgeSoftness:  { value: 2.2 },
                edgeStrength:  { value: 0.88 },
                uTime:         this.windUniforms.uTime,
                uWindStrength: this.windUniforms.uWindStrength,
                uSwayMult:     { value: swayMult }
            },
            vertexShader: `
                attribute float aWindPhase;
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
                    float phase = aWindPhase + position.x * 0.5 + position.z * 0.3;
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * h * h * 0.06 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * h * h * 0.04 * uSwayMult * aWindMultiplier;
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform vec3 lightDir;
                uniform float ambient;
                uniform float edgeSoftness;
                uniform float edgeStrength;

                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;

                void main() {
                    vec4 texel = texture2D(map, vUv);
                    if (texel.a < 0.05) discard;
                    vec3 n = normalize(vWorldNormal);
                    float diff = max(dot(n, lightDir), 0.0);
                    vec3 litColor = texel.rgb * (ambient + diff * (1.0 - ambient));
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float fresnel = pow(1.0 - abs(dot(n, viewDir)), edgeSoftness);
                    float edgeAlpha = 1.0 - (fresnel * edgeStrength);
                    gl_FragColor = vec4(litColor, texel.a * edgeAlpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
    }

    _makeInstancedMesh(geometry, material, needsWind = false) {
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxTrees);
        mesh.count = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

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

    /**
     * Place a tree at world (x, z). Caller supplies terrain height.
     * Returns the instance index, or -1 if capacity is full.
     */
    addTree(worldX, worldZ, terrainHeight) {
        if (this.treeCount >= this.maxTrees) {
            console.warn('[TerrainTreeSystem] Capacity reached (' + this.maxTrees + ')');
            return -1;
        }

        const i = this.treeCount;

        // Per-tree variation
        const scale  = 0.85 + Math.random() * 0.45; // 0.85 - 1.30
        const rotY   = Math.random() * Math.PI * 2;
        const cosR   = Math.cos(rotY);
        const sinR   = Math.sin(rotY);

        this.treeData.push({ x: worldX, z: worldZ, y: terrainHeight, scale, rotY });

        // Initialize height smoothing buffer
        if (!this._currentHeights) {
            this._currentHeights = new Float32Array(this.maxTrees);
        }
        this._currentHeights[i] = terrainHeight;

        // Sample wind field for this tree
        const tileX = Math.floor(worldX);
        const tileZ = Math.floor(worldZ);
        const windMult = this.windField.get(`${tileX},${tileZ}`) || 1.0;

        this._scratchEuler.set(0, rotY, 0);
        this._scratchQuat.setFromEuler(this._scratchEuler);

        for (const part of this.parts) {
            // Rotate the offset around Y so the cluster shape follows tree rotation.
            const ox = part.offset.x * scale;
            const oy = part.offset.y * scale;
            const oz = part.offset.z * scale;
            const rotatedX = ox * cosR - oz * sinR;
            const rotatedZ = ox * sinR + oz * cosR;

            this._scratchPos.set(
                worldX + rotatedX,
                terrainHeight + oy,
                worldZ + rotatedZ
            );
            this._scratchScale.set(scale, scale * part.scaleY, scale);

            this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);
            part.mesh.setMatrixAt(i, this._scratchMatrix);

            // Set wind multiplier for this instance
            if (part.mesh.geometry.attributes.aWindMultiplier) {
                part.mesh.geometry.attributes.aWindMultiplier.setXYZ(i, windMult, 0, 0);
            }
        }

        this.treeCount++;
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
            part.mesh.instanceMatrix.needsUpdate = true;
            if (part.mesh.geometry.attributes.aWindMultiplier) {
                part.mesh.geometry.attributes.aWindMultiplier.needsUpdate = true;
            }
        }

        return i;
    }

    /**
     * Bulk fetch tree positions from the server and place them.
     * The server endpoint returns {trees: [{x, y}, ...]} where y is world Z.
     */
    async populateFromServer() {
        try {
            const response = await fetch('/api/trees');
            if (!response.ok) {
                console.warn('[TerrainTreeSystem] /api/trees returned ' + response.status);
                return;
            }
            const data = await response.json();
            const list = data.trees || [];
            console.log('[TerrainTreeSystem] Server reports ' + list.length + ' trees');

            const board = window.game && window.game.boardSystem;
            if (!board || typeof board.getUnifiedTerrainHeight !== 'function') {
                console.warn('[TerrainTreeSystem] boardSystem.getUnifiedTerrainHeight not ready; aborting populate');
                return;
            }

            const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;

            let placed = 0;
            let underwater = 0;
            for (const t of list) {
                // Server uses (x, y) for grid; that maps to world (x, z) here.
                const wx = t.x;
                const wz = t.y;
                const height = board.getUnifiedTerrainHeight(wx, wz);

                if (height < waterCutoff) { underwater++; continue; }

                // Snap tree to tile center for visual alignment with chess grid
                if (this.addTree(wx + 0.5, wz + 0.5, height) === -1) break;
                placed++;
            }

            console.log('[TerrainTreeSystem] Placed ' + placed + ' trees (' + underwater + ' skipped underwater)');

            // Compute wind field after all trees are placed
            this.computeWindField();
        } catch (err) {
            console.error('[TerrainTreeSystem] populateFromServer failed:', err);
        }
    }

    /** Remove all trees and reset for a fresh populate. */
    clear() {
        this.treeCount = 0;
        this.treeData.length = 0;
        for (const part of this.parts) {
            part.mesh.count = 0;
            part.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    dispose() {
        for (const part of this.parts) {
            this.scene.remove(part.mesh);
            part.mesh.geometry.dispose();
            part.mesh.material.dispose();
        }
        this.parts = [];
        this.treeData = [];
        this.treeCount = 0;
    }

    // ---- Public query helpers ----

    getTreeCount() { return this.treeCount; }

    hasTreeAt(worldX, worldZ) {
        const fx = Math.floor(worldX);
        const fz = Math.floor(worldZ);
        for (const t of this.treeData) {
            if (Math.floor(t.x) === fx && Math.floor(t.z) === fz) return true;
        }
        return false;
    }

    computeWindField() {
        const board = window.game && window.game.boardSystem;
        if (!board) {
            console.warn('[TerrainTreeSystem] No boardSystem for wind field computation');
            return;
        }

        const waterLevel = board.waterLevel || -1.5;
        this.windField.clear();

        // Build a grid of tree counts for density calculation
        const densityGrid = new Map();
        for (const t of this.treeData) {
            const tx = Math.floor(t.x);
            const tz = Math.floor(t.z);
            const key = `${tx},${tz}`;
            densityGrid.set(key, (densityGrid.get(key) || 0) + 1);
        }

        // Compute wind multiplier for each tile that has a tree
        for (const t of this.treeData) {
            const tx = Math.floor(t.x);
            const tz = Math.floor(t.z);
            const key = `${tx},${tz}`;
            if (this.windField.has(key)) continue;

            let windMult = 1.0;

            // Surface smoothness: check height variance in 3x3 area
            let variance = 0;
            let sum = 0;
            let count = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const h = board.getUnifiedTerrainHeight(tx + dx, tz + dz);
                    if (isFinite(h)) {
                        sum += h;
                        count++;
                    }
                }
            }
            if (count > 0) {
                const avg = sum / count;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const h = board.getUnifiedTerrainHeight(tx + dx, tz + dz);
                        if (isFinite(h)) {
                            variance += (h - avg) ** 2;
                        }
                    }
                }
                const smoothness = 1.0 / (1.0 + variance * 2);
                windMult *= 0.7 + smoothness * 0.6;
            }

            // Water boost (extra smooth surface)
            const height = board.getUnifiedTerrainHeight(tx, tz);
            if (Math.abs(height - waterLevel) < 0.3) {
                windMult *= 1.4;
            }

            // Obstacle density (more trees = less wind)
            let nearbyCount = 0;
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const nKey = `${tx+dx},${tz+dz}`;
                    nearbyCount += densityGrid.get(nKey) || 0;
                }
            }
            windMult *= Math.max(0.5, 1.0 - nearbyCount * 0.05);

            // Elevation (higher = more wind, less ground friction)
            windMult *= 1.0 + Math.max(0, height) * 0.02;

            // Clamp to reasonable range
            windMult = Math.max(0.3, Math.min(2.0, windMult));

            this.windField.set(key, windMult);
        }

        console.log('[TerrainTreeSystem] Wind field computed for', this.windField.size, 'tiles');
    }

    // ------------------------------------------------------------------
    // SEASONAL FOLIAGE
    // ------------------------------------------------------------------

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
        const tex = this.seasonTextures.get(season);
        if (!tex) {
            console.warn('[TerrainTreeSystem] Unknown season:', season);
            return;
        }
        this.currentSeason = season;
        for (const part of this.parts) {
            if (part.isCanopy && part.mesh.material) {
                const mat = part.mesh.material;
                if (mat.uniforms) {
                    mat.uniforms.map.value = tex;
                } else {
                    mat.map = tex;
                }
                mat.needsUpdate = true;
            }
        }
        console.log('[TerrainTreeSystem] Season set to', season);
    }

    // ------------------------------------------------------------------
    // WIND SHADER (injected via onBeforeCompile)
    // ------------------------------------------------------------------

    _injectWindShader(material, strengthMultiplier, isFoliage = false) {
        const u = this.windUniforms;
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime          = u.uTime;
            shader.uniforms.uWindStrength  = u.uWindStrength;
            shader.uniforms.uWindDirection = u.uWindDirection;
            shader.uniforms.uSwayMult      = { value: strengthMultiplier };

            let vertexPrefix =
                `attribute float aWindPhase;\n` +
                `attribute float aWindMultiplier;\n` +
                `uniform float uTime;\n` +
                `uniform float uWindStrength;\n` +
                `uniform vec2 uWindDirection;\n` +
                `uniform float uSwayMult;\n`;
            let fragmentPrefix = ``;

            if (isFoliage) {
                vertexPrefix   += `varying float vEdgeAlpha;\n`;
                fragmentPrefix += `varying float vEdgeAlpha;\n`;
            }

            shader.vertexShader = vertexPrefix + shader.vertexShader;
            if (isFoliage) {
                shader.fragmentShader = fragmentPrefix + shader.fragmentShader;
            }


            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                float h = max(0.0, transformed.y);
                float phase = aWindPhase + transformed.x * 0.5 + transformed.z * 0.3;
                float s1 = sin(uTime * 1.8 + phase) * uWindStrength * h * h * 0.06 * uSwayMult * aWindMultiplier;
                float s2 = cos(uTime * 2.6 + phase * 1.4) * uWindStrength * h * h * 0.04 * uSwayMult * aWindMultiplier;
                transformed.x += s1;
                transformed.z += s2;`
            );

            if (isFoliage) {
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <project_vertex>',
                    `#include <project_vertex>
                    float nDotV = clamp(dot(normalize(transformedNormal), normalize(-mvPosition.xyz)), 0.0, 1.0);
                    vEdgeAlpha = smoothstep(0.30, 0.70, nDotV);`
                );

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <opaque_fragment>',
                    `diffuseColor.a *= vEdgeAlpha;\n#include <opaque_fragment>`
                );
            }
        };
        // Ensure custom program is rebuilt when needed
        material.needsUpdate = true;
    }

    update(timeSec, windStrength, windDirection) {
        this.windUniforms.uTime.value = timeSec;
        this.windUniforms.uWindStrength.value = windStrength != null ? windStrength : 0.6;
        if (windDirection != null) {
            this.windUniforms.uWindDirection.value.set(
                windDirection.x || 1,
                windDirection.y || 0
            );
        }
    }
}
