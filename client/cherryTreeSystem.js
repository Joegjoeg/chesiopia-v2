var UP = window.UP || new THREE.Vector3(0, 1, 0);
window.UP = UP;

// CherryTreeSystem
// Instanced cherry trees using three equally-spaced vertical planes
// around a central trunk. Each plane samples a random silhouette from
// cherrytree.png (sprite atlas) and uses it as an alpha mask, with
// a seasonal foliage texture applied as colour.

class CherryTreeSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;

        this.maxTrees = 1500;
        this.treeCount = 0;
        this.treeData = []; // {x, y, z, scale, rotY}
        this.windField = new Map();
        this.parts = [];

        this._heightSmoothingFactor = 0.25;
        this._currentHeights = null;
        this.currentSeason = 'summer';

        this.windUniforms = {
            uTime:          { value: 0 },
            uWindStrength:  { value: 0.4 },
            uWindDirection: { value: new THREE.Vector2(1, 0) }
        };

        // Atlas configuration (cols x rows grid of silhouettes)
        this.atlasCols = 8;
        this.atlasRows = 4;
        this.numSilhouettes = this.atlasCols * this.atlasRows;

        // Load the cherry tree silhouette atlas
        this.silhouetteAtlas = new THREE.TextureLoader().load('../Images/cherrytree.png');
        this.silhouetteAtlas.colorSpace = THREE.SRGBColorSpace;

        // Generate seasonal foliage textures (same style as TerrainTreeSystem)
        this.seasonTextures = this._generateSeasonalTextures();
        this.foliageTexture = this.seasonTextures.get('summer');

        // Shared per-tree wind attributes so all planes on one tree sway together
        this._sharedWindPhases = new Float32Array(this.maxTrees);
        this._sharedWindMultipliers = new Float32Array(this.maxTrees);
        for (let i = 0; i < this.maxTrees; i++) {
            this._sharedWindPhases[i] = Math.random() * Math.PI * 2;
            this._sharedWindMultipliers[i] = 1.0;
        }

        // Per-plane silhouette index for each tree
        this._silhouetteIndices = [
            new Float32Array(this.maxTrees),
            new Float32Array(this.maxTrees),
            new Float32Array(this.maxTrees)
        ];

        this._createParts();
        this.parts.forEach(p => this.scene.add(p.mesh));

        // Shared scratch objects
        this._scratchMatrix = new THREE.Matrix4();
        this._scratchPos    = new THREE.Vector3();
        this._scratchQuat   = new THREE.Quaternion();
        this._scratchScale  = new THREE.Vector3();
        this._scratchEuler  = new THREE.Euler();

        console.log('[CherryTreeSystem] Initialized (capacity ' + this.maxTrees + ')');
    }

    _createParts() {
        const parts = [];

        // --- TRUNK ---
        const trunkHeight = 1.8;
        const trunkGeo = new THREE.CylinderGeometry(0.05, 0.08, trunkHeight, 8, 4);
        trunkGeo.translate(0, trunkHeight / 2, 0);
        // Pinch all top-ring vertices into a single point
        const tPos = trunkGeo.attributes.position;
        for (let i = 0; i < tPos.count; i++) {
            if (tPos.getY(i) > trunkHeight / 2 - 0.001) {
                tPos.setX(i, 0);
                tPos.setZ(i, 0);
            }
        }
        tPos.needsUpdate = true;
        trunkGeo.computeVertexNormals();
        const trunkMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x5a3f2a),
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        parts.push({
            name: 'trunk',
            mesh: this._makeInstancedMesh(trunkGeo, trunkMat, true),
            offset: { x: 0, y: 0, z: 0 },
            scaleY: 1.0
        });

        // --- THREE VERTICAL PLANES ---
        const planeAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
        for (let i = 0; i < 3; i++) {
            const planeGeo = new THREE.PlaneGeometry(2.0, 2.4, 5, 4);
            planeGeo.translate(0, 1.2, 0); // base at y=0
            planeGeo.rotateY(planeAngles[i]);
            const planeMat = this._createPlaneShaderMaterial(0.05);
            const planeMesh = this._makeInstancedMesh(planeGeo, planeMat, true, i);
            planeMesh.renderOrder = 2; // draw after transparent water plane
            parts.push({
                name: 'plane_' + i,
                mesh: planeMesh,
                offset: { x: 0, y: 0, z: 0 },
                scaleY: 1.0,
                isPlane: true,
                planeIndex: i
            });
        }

        this.parts = parts;
    }

    _createPlaneShaderMaterial(swayMult) {
        const atlasCols = this.atlasCols;
        const atlasRows = this.atlasRows;
        return new THREE.ShaderMaterial({
            uniforms: {
                silhouetteAtlas: { value: this.silhouetteAtlas },
                foliageMap:      { value: this.foliageTexture },
                lightDir:        { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                ambient:         { value: 0.65 },
                uTime:           this.windUniforms.uTime,
                uWindStrength:   this.windUniforms.uWindStrength,
                uWindDirection:  this.windUniforms.uWindDirection,
                uSwayMult:       { value: swayMult },
                uWindHeightPower: { value: 2.0 },
                uSunIntensity:   { value: 1.0 },
                uAtlasCols:      { value: atlasCols },
                uAtlasRows:      { value: atlasRows },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                attribute float aWindPhase;
                attribute float aWindMultiplier;
                attribute float aSilhouetteIndex;

                uniform float uTime;
                uniform float uWindStrength;
                uniform vec2 uWindDirection;
                uniform float uSwayMult;
                uniform float uWindHeightPower;
                uniform float uAtlasCols;
                uniform float uAtlasRows;

                varying vec2 vAtlasUv;
                varying vec2 vFoliageUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                varying vec3 vLocalPos;
                varying float vSilhouetteIndex;

                void main() {
                    vFoliageUv = uv;
                    vLocalPos = position;
                    vSilhouetteIndex = aSilhouetteIndex;

                    // Compute atlas UV for this silhouette
                    float idx = floor(aSilhouetteIndex + 0.5);
                    float col = mod(idx, uAtlasCols);
                    float row = floor(idx / uAtlasCols);
                    // Three.js flips textures by default (flipY=true); row 0 at top of PNG maps to v=0
                    vAtlasUv = vec2(
                        (col + uv.x) / uAtlasCols,
                        (row + uv.y) / uAtlasRows
                    );

                    mat4 localToWorld = modelMatrix * instanceMatrix;
                    vWorldNormal = normalize(mat3(localToWorld) * normal);
                    vec4 wp = localToWorld * vec4(position, 1.0);
                    float hRel = max(0.0, wp.y - instanceMatrix[3][1]); float hNorm = clamp(hRel * 0.12, 0.0, 1.0);
                    float phase = aWindPhase + position.x * 0.5 + position.z * 0.3;
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.15 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.10 * uSwayMult * aWindMultiplier;
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
                uniform sampler2D silhouetteAtlas;
                uniform sampler2D foliageMap;
                uniform vec3 lightDir;
                uniform float ambient;
                uniform float uSunIntensity;

                varying vec2 vAtlasUv;
                varying vec2 vFoliageUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                varying vec3 vLocalPos;
                varying float vSilhouetteIndex;

                void main() {
                    // Sample silhouette from atlas
                    vec4 silhouette = texture2D(silhouetteAtlas, vAtlasUv);
                    float mask = 1.0 - smoothstep(0.40, 0.60, max(silhouette.r, max(silhouette.g, silhouette.b)));
                    if (mask < 0.05) discard;

                    // Sample seasonal foliage texture
                    vec4 foliage = texture2D(foliageMap, vFoliageUv * 2.0);

                    // Lighting
                    vec3 n = normalize(vWorldNormal);
                    float diff = max(dot(n, lightDir), 0.0);
                    vec3 litColor = foliage.rgb * (ambient + diff * (1.0 - ambient)) * uSunIntensity;

                    gl_FragColor = vec4(litColor, mask * foliage.a);
                    #include <fog_fragment>
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            fog: true
        });
    }

    _makeInstancedMesh(geometry, material, needsWind = false, planeIndex = -1) {
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxTrees);
        mesh.name = 'cherryTree';
        mesh.count = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // LOD manager handles culling

        if (needsWind) {
            mesh.geometry.setAttribute('aWindPhase',
                new THREE.InstancedBufferAttribute(this._sharedWindPhases, 1));
            mesh.geometry.setAttribute('aWindMultiplier',
                new THREE.InstancedBufferAttribute(this._sharedWindMultipliers, 1));
        }
        if (planeIndex >= 0) {
            mesh.geometry.setAttribute('aSilhouetteIndex',
                new THREE.InstancedBufferAttribute(this._silhouetteIndices[planeIndex], 1));
        }
        return mesh;
    }

    addTree(worldX, worldZ, terrainHeight, metadata = {}) {
        if (this.treeCount >= this.maxTrees) {
            console.warn('[CherryTreeSystem] Capacity reached (' + this.maxTrees + ')');
            return -1;
        }

        const i = this.treeCount;
        const maxScale = metadata.maxScale || 1.0;
        const scale  = (0.85 + Math.random() * 0.45) * maxScale;
        const rotY   = Math.random() * Math.PI * 2;

        const board = window.game && window.game.boardSystem;
        const normal = (board && board.getTerrainNormal) ? board.getTerrainNormal(worldX, worldZ) : new THREE.Vector3(0, 1, 0);
        this.treeData.push({ x: worldX, z: worldZ, y: terrainHeight, scale, rotY, normal: normal.clone(), biome: metadata.biome, growthRate: metadata.growthRate });

        if (!this._currentHeights) {
            this._currentHeights = new Float32Array(this.maxTrees);
        }
        this._currentHeights[i] = terrainHeight;

        const tileX = Math.floor(worldX);
        const tileZ = Math.floor(worldZ);
        const windMult = this.windField.get(`${tileX},${tileZ}`) || 1.0;

        // Assign a random silhouette to each of the 3 planes
        for (let p = 0; p < 3; p++) {
            this._silhouetteIndices[p][i] = Math.floor(Math.random() * this.numSilhouettes);
        }

        this._scratchQuat.setFromAxisAngle(UP, rotY);
        const tiltQuat = new THREE.Quaternion().setFromUnitVectors(UP, normal);
        tiltQuat.multiply(this._scratchQuat);
        this._scratchQuat.copy(tiltQuat);
        this._scratchPos.set(worldX, terrainHeight, worldZ);
        this._scratchScale.set(scale, scale, scale);
        this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);

        for (const part of this.parts) {
            part.mesh.setMatrixAt(i, this._scratchMatrix);
        }
        // Shared wind multiplier: write once since all parts use the same buffer
        this._sharedWindMultipliers[i] = windMult;

        this.treeCount++;
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
            part.mesh.instanceMatrix.needsUpdate = true;
        }
        if (this.parts[0].mesh.geometry.attributes.aWindMultiplier) {
            this.parts[0].mesh.geometry.attributes.aWindMultiplier.needsUpdate = true;
        }
        // Update silhouette attributes
        for (let p = 1; p <= 3; p++) {
            const attr = this.parts[p].mesh.geometry.attributes.aSilhouetteIndex;
            if (attr) attr.needsUpdate = true;
        }

        return i;
    }

    update(timeSec, windStrength, windDirection) {
        this.lastWindDirection = windDirection;
        this.windUniforms.uTime.value = timeSec;
        this.windUniforms.uWindStrength.value = (windStrength != null ? windStrength : 0.6) * 0.5;
        if (windDirection != null) {
            this.windUniforms.uWindDirection.value.set(
                windDirection.x || 1,
                windDirection.y || 0
            );
        }

        // Update lighting uniforms from board day/night cycle
        const bs = window.boardSystem;
        if (bs && bs.sun && bs.sun.light && bs.moon && bs.moon.light) {
            const sunInt = bs.sun.light.intensity;
            const moonInt = bs.moon.light.intensity;
            const totalIntensity = Math.max(0.15, sunInt + moonInt * 0.4);
            const sunElev = Math.sin(bs.sun.angle);
            const lightPos = sunElev > 0 ? bs.sun.light.position : bs.moon.light.position;
            const lightDir = lightPos.clone().normalize();
            const ambient = sunElev > 0 ? 0.55 : 0.2;

            for (const part of this.parts) {
                const mat = part.mesh.material;
                if (mat && mat.uniforms) {
                    if (mat.uniforms.uSunIntensity) mat.uniforms.uSunIntensity.value = totalIntensity;
                    if (mat.uniforms.lightDir) mat.uniforms.lightDir.value.copy(lightDir);
                    if (mat.uniforms.ambient) mat.uniforms.ambient.value = ambient;
                }
            }
        }

        this.updateTreeHeights();
    }

    updateTreeHeights() {
        if (this.treeCount === 0 || !this._currentHeights) return;

        const board = window.game && window.game.boardSystem;
        const camera = window.game && window.game.camera;
        if (!board || !camera) {
            console.warn('[CherryTreeSystem] No board or camera available');
            return;
        }

        const meshExtent = 96;
        const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;

        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];
            if (!tree || tree._lodVisible === false) continue;
            const dx = Math.abs(tree.x - camera.position.x);
            const dz = Math.abs(tree.z - camera.position.z);

            let targetHeight;
            if (dx <= meshExtent && dz <= meshExtent) {
                targetHeight = board.getUnifiedTerrainHeight(tree.x, tree.z);
            } else {
                targetHeight = this._currentHeights[i] || tree.y;
                if (typeof board.getSquareHeights === 'function') {
                    board.getSquareHeights(tree.x, tree.z).then(height => {
                        if (height < waterCutoff) return;
                        if (this._currentHeights && this._currentHeights[i] !== undefined) {
                            this._currentHeights[i] = height;
                            tree.y = height;
                            this.updateTreeInstanceMatrix(i, tree);
                        }
                    });
                }
            }

            if (targetHeight < waterCutoff) continue;

            const currentHeight = this._currentHeights[i];
            const newHeight = currentHeight + (targetHeight - currentHeight) * this._heightSmoothingFactor;
            this._currentHeights[i] = newHeight;

            if (board.getTerrainNormal) {
                tree.normal = board.getTerrainNormal(tree.x, tree.z).clone();
            }

            tree.y = newHeight;
            this.updateTreeInstanceMatrix(i, tree);
        }
    }

    updateTreeInstanceMatrix(i, tree) {
        const scale = tree.scale * this.globalTreeSizeMult;
        const rotY = tree.rotY;

        const normal = tree.normal || UP;
        this._scratchQuat.setFromUnitVectors(UP, normal);
        const yQuat = new THREE.Quaternion().setFromAxisAngle(UP, rotY);
        this._scratchQuat.multiply(yQuat);
        this._scratchPos.set(tree.x, tree.y, tree.z);
        this._scratchScale.set(scale, scale, scale);
        this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);

        for (const part of this.parts) {
            part.mesh.setMatrixAt(i, this._scratchMatrix);
        }

        for (const part of this.parts) {
            part.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    setGlobalTreeSizeMult(value) {
        this.globalTreeSizeMult = value;
        for (let i = 0; i < this.treeCount; i++) {
            this.updateTreeInstanceMatrix(i, this.treeData[i]);
        }
    }

    computeWindField() {
        const board = window.game && window.game.boardSystem;
        if (!board || !board.computeTreeWindField) {
            console.warn('[CherryTreeSystem] No board wind field computation available');
            return;
        }
        board.computeTreeWindField(this.treeData, this.windField);
        // console.log('[CherryTreeSystem] Wind field computed for', this.windField.size, 'tiles');
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
            this._sharedWindMultipliers[i] = mult;
        }
        for (const part of this.parts) {
            const attr = part.mesh.geometry.attributes.aWindMultiplier;
            if (attr) attr.needsUpdate = true;
        }
    }

    clear() {
        this.treeCount = 0;
        this.treeData.length = 0;
        for (const part of this.parts) {
            part.mesh.count = 0;
            part.mesh.instanceMatrix.needsUpdate = true;
        }
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
            this._sharedWindMultipliers[index] = this._sharedWindMultipliers[lastIndex];
            this._sharedWindPhases[index] = this._sharedWindPhases[lastIndex];
            for (let p = 0; p < 3; p++) {
                this._silhouetteIndices[p][index] = this._silhouetteIndices[p][lastIndex];
            }
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
        this.parts = [];
        this.treeData = [];
        this.treeCount = 0;
        if (this.silhouetteAtlas) this.silhouetteAtlas.dispose();
        for (const tex of this.seasonTextures.values()) {
            tex.dispose();
        }
    }

    hasTreeAt(worldX, worldZ) {
        const fx = Math.floor(worldX);
        const fz = Math.floor(worldZ);
        for (const t of this.treeData) {
            if (Math.floor(t.x) === fx && Math.floor(t.z) === fz) return true;
        }
        return false;
    }

    getTreeCount() {
        return this.treeCount;
    }

    // --- Seasonal foliage ---

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
        this.currentSeason = season;
        const tex = this.seasonTextures.get(season);
        if (!tex) {
            console.warn('[CherryTreeSystem] Unknown season:', season);
            return;
        }
        for (const part of this.parts) {
            if (part.isPlane && part.mesh.material && part.mesh.material.uniforms) {
                part.mesh.material.uniforms.foliageMap.value = tex;
            }
        }
        console.log('[CherryTreeSystem] Season set to', season);
    }
}
