/**
 * VoxelCloudSystem - Per-cloud voxel clusters with pyroclastic billboards
 *
 * Architecture:
 *   - World-space cloud density drives placement of discrete cloud clusters
 *   - Each cluster = 16-32 billboarded voxels scattered inside an ellipsoid
 *   - Two-level wind: whole cluster drifts (CPU), voxels jitter (GPU)
 *   - Custom shader: procedural pyroclastic density, wind ripping, edge fade
 *   - Terrain-height-aware placement
 *   - 3 LOD levels with crossfade alpha transition
 */

class VoxelCloudSystem {
    constructor(scene, terrainSystem, game) {
        this._debug = false;
        this._enabled = true;
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.game = game;

        // Grid configuration
        this.cellSize = 28;
        this.cloudBaseHeight = 45;
        this.renderRadius = 7;
        this.cloudSizeScale = 1.0;
        this.cloudDensityScale = 1.0;

        // Cloud cluster config
        this.voxelsPerCloud = { min: 16, max: 32 };
        this.cloudVolume = { x: 22, y: 9, z: 22 };
        this.rippleStrength = 1.0;

        // LOD bands: [stride, fadeStartDist, fadeEndDist, spriteScale]
        this.lodConfigs = [
            { stride: 1, fadeStart: 90,  fadeEnd: 130,  spriteScale: 1.0 },
            { stride: 2, fadeStart: 180, fadeEnd: 260,  spriteScale: 2.2 },
            { stride: 4, fadeStart: 360, fadeEnd: 500,  spriteScale: 4.8 },
        ];

        // Weather state
        this._weatherSnapshot = null;
        this._moisture = 0.5;
        this._cloudCoverage = 0.5;
        this._windSpeed = 0.5;
        this._windDirection = 0;
        this._lightBlocking = 0;
        this._jetstream = 1.0;
        this._proximityFade = 60.0;

        // Time
        this._time = 0;

        // LOD meshes and instance data
        this._lodMeshes = [];
        this._cameraPos = new THREE.Vector3();
        this._lastGridOrigin = { x: Infinity, z: Infinity };

        // Debug markers
        this._debugGroup = new THREE.Group();
        this._debugGroup.name = 'VoxelCloudDebug';
        this.scene.add(this._debugGroup);

        // Test clouds
        this._testClouds = [];
        this._cellFadeStates = new Map();
        this._mesh = null;

        // Build LOD meshes
        this._initLodMeshes();

        if (this._debug) console.log('[VoxelCloudSystem] Initialized (cluster mode)');
    }

    // ------------------------------------------------------------------
    // LOD mesh setup
    // ------------------------------------------------------------------
    _initLodMeshes() {
        let totalMaxCount = 0;
        const lodMaxCounts = [];

        for (let lodIndex = 0; lodIndex < this.lodConfigs.length; lodIndex++) {
            const cfg = this.lodConfigs[lodIndex];
            const stride = cfg.stride;

            const cellsX = Math.ceil((this.renderRadius * 2 + 1) / stride);
            const cellsZ = Math.ceil((this.renderRadius * 2 + 1) / stride);
            const maxClouds = cellsX * cellsZ;
            const maxCount = maxClouds * this.voxelsPerCloud.max;

            lodMaxCounts.push({ maxCount, stride, config: cfg });
            totalMaxCount += maxCount;
        }

        const geometry = new THREE.PlaneGeometry(1, 1);

        const iCloudCenter = new THREE.InstancedBufferAttribute(new Float32Array(totalMaxCount * 3), 3);
        const iLocalOff = new THREE.InstancedBufferAttribute(new Float32Array(totalMaxCount * 3), 3);
        const iSeed = new THREE.InstancedBufferAttribute(new Float32Array(totalMaxCount), 1);
        const iAlpha = new THREE.InstancedBufferAttribute(new Float32Array(totalMaxCount), 1);
        const iScale = new THREE.InstancedBufferAttribute(new Float32Array(totalMaxCount), 1);
        const iWindOffset = new THREE.InstancedBufferAttribute(new Float32Array(totalMaxCount * 2), 2);

        geometry.setAttribute('instanceCloudCenter', iCloudCenter);
        geometry.setAttribute('instanceLocalOffset', iLocalOff);
        geometry.setAttribute('instanceSeed', iSeed);
        geometry.setAttribute('instanceAlpha', iAlpha);
        geometry.setAttribute('instanceScale', iScale);
        geometry.setAttribute('instanceWindOffset', iWindOffset);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCameraPos: { value: new THREE.Vector3() },
                uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
                uWindDirection: { value: new THREE.Vector3(1, 0, 0.3).normalize() },
                uWindSpeed: { value: 1.0 },
                uMoisture: { value: 0.5 },
                uCloudCoverage: { value: 0.5 },
                uSpriteScale: { value: this.cellSize * 0.25 },
                uCloudRadius: { value: 11.0 },
                uVoxelJitter: { value: 2.2 },
                uRippleStrength: { value: 1.0 },
                uProximityFade: { value: 60.0 },
                uCloudColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: this._vertexShader(),
            fragmentShader: this._fragmentShader(),
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending
        });

        this._mesh = new THREE.InstancedMesh(geometry, material, totalMaxCount);
        this._mesh.frustumCulled = false;
        this._mesh.renderOrder = 200;
        this._mesh.count = 0;
        this.scene.add(this._mesh);

        let startIndex = 0;
        for (let lodIndex = 0; lodIndex < this.lodConfigs.length; lodIndex++) {
            const { maxCount, stride, config } = lodMaxCounts[lodIndex];

            this._lodMeshes.push({
                startIndex,
                stride,
                config,
                count: 0,
                maxCount,
                iCloudCenter, iLocalOff, iSeed, iAlpha, iScale, iWindOffset,
                centers: iCloudCenter.array,
                localOffsets: iLocalOff.array,
                seeds: iSeed.array,
                alphas: iAlpha.array,
                scales: iScale.array,
                windOffsets: iWindOffset.array,
                cellKeys: new Array(maxCount)
            });

            startIndex += maxCount;
        }
    }

    // ------------------------------------------------------------------
    // Shaders
    // ------------------------------------------------------------------
    _vertexShader() {
        return `
            attribute vec3 instanceCloudCenter;
            attribute vec3 instanceLocalOffset;
            attribute float instanceSeed;
            attribute float instanceAlpha;
            attribute float instanceScale;
            attribute vec2 instanceWindOffset;

            uniform float uTime;
            uniform vec3 uCameraPos;
            uniform vec3 uWindDirection;
            uniform float uWindSpeed;
            uniform float uSpriteScale;
            uniform float uCloudRadius;
            uniform float uVoxelJitter;

            varying vec2 vUv;
            varying float vAlpha;
            varying vec3 vWorldPos;
            varying float vSeed;
            varying vec3 vLocalWind;
            varying vec3 vLocalOffset;

            float hash(float n) { return fract(sin(n) * 43758.5453123); }

            vec3 getLocalWind(vec3 worldPos, float seed) {
                float t = uTime * uWindSpeed;
                float n1 = sin(worldPos.x * 0.12 + t + seed * 6.28) * 0.5 + 0.5;
                float n2 = cos(worldPos.z * 0.09 + t * 0.7 + seed * 4.0) * 0.5 + 0.5;
                float n3 = sin((worldPos.x + worldPos.z) * 0.05 + t * 0.3) * 0.5 + 0.5;
                float gust = pow(n3, 3.0) * 2.0;
                vec3 wind = uWindDirection * (uWindSpeed + gust);
                float swirl = sin(n1 * 6.28) * cos(n2 * 6.28);
                wind.xz += vec2(cos(swirl), sin(swirl)) * uWindSpeed * 0.3;
                return wind;
            }

            void main() {
                vUv = uv;
                vAlpha = instanceAlpha;
                vSeed = instanceSeed;
                vLocalOffset = instanceLocalOffset;

                // Cloud-level drift
                vec3 cloudPos = instanceCloudCenter;
                cloudPos.x += instanceWindOffset.x;
                cloudPos.z += instanceWindOffset.y;

                // Per-voxel position inside cloud volume
                vec3 localPos = instanceLocalOffset * uCloudRadius * instanceScale;

                // Per-voxel wind jitter
                vec3 windJitter = getLocalWind(cloudPos + localPos, instanceSeed);
                float jitterAmt = uVoxelJitter * (1.0 - smoothstep(0.0, 80.0, distance(cloudPos, uCameraPos)));
                localPos += windJitter * jitterAmt;

                // Orbital wobble
                float wobble = sin(uTime * 0.4 + instanceSeed * 10.0) * jitterAmt * 0.2;
                localPos.x += cos(instanceSeed * 6.28 + uTime) * wobble;
                localPos.z += sin(instanceSeed * 6.28 + uTime) * wobble;

                vec3 worldPos = cloudPos + localPos;
                vWorldPos = worldPos;
                vLocalWind = windJitter;

                // Billboard
                vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
                float scale = instanceScale * uSpriteScale;
                mvPosition.xy += position.xy * scale;
                gl_Position = projectionMatrix * mvPosition;
            }
        `;
    }

    _fragmentShader() {
        return `
            precision highp float;

            uniform vec3 uCameraPos;
            uniform vec3 uLightDir;
            uniform float uMoisture;
            uniform float uCloudCoverage;
            uniform vec3 uCloudColor;
            uniform float uTime;
            uniform float uWindSpeed;
            uniform float uRippleStrength;
            uniform float uProximityFade;

            varying vec2 vUv;
            varying float vAlpha;
            varying vec3 vWorldPos;
            varying float vSeed;
            varying vec3 vLocalWind;
            varying vec3 vLocalOffset;

            float hash(float n) { return fract(sin(n) * 43758.5453123); }
            float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

            float valueNoise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash(i.x + i.y * 57.0);
                float b = hash(i.x + 1.0 + i.y * 57.0);
                float c = hash(i.x + i.y * 57.0 + 1.0);
                float d = hash(i.x + 1.0 + i.y * 57.0 + 1.0);
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            float pyroclasticNoise(vec2 p, float seed, float t) {
                float n = 0.0;
                float amp = 0.5;
                float freq = 1.8;
                for (int i = 0; i < 4; i++) {
                    vec2 q = p * freq + vec2(seed * 13.0 + float(i) * 7.3, float(i) * 1.9);
                    float tOff = t * (0.12 + float(i) * 0.04);
                    float wave = valueNoise(q + vec2(tOff, tOff * 0.7));
                    wave = 1.0 - abs(wave * 2.0 - 1.0);
                    n += wave * amp;
                    amp *= 0.5;
                    freq *= 2.1;
                }
                return n;
            }

            float getBacklight(vec3 worldPos, vec3 lightDir, vec3 camPos) {
                vec3 toLight = normalize(lightDir);
                vec3 camToPuff = normalize(worldPos - camPos);
                float alignment = dot(camToPuff, toLight);
                float backscatter = smoothstep(0.6, 1.0, alignment);
                return backscatter * 0.5;
            }

            float getUndersideDarken(vec2 uv, float moisture) {
                float underside = 1.0 - uv.y;
                float swell = moisture * 0.4;
                return smoothstep(0.3 - swell, 0.7, underside);
            }

            void main() {
                float t = uTime;
                float seed = vSeed;

                // Wind ripping: shear UVs vertically
                vec2 windShear = vLocalWind.xz * vLocalOffset.y * 0.12 * uRippleStrength;
                float rip = sin(vUv.y * 14.0 + t * 4.0 + seed * 6.0) * 0.08 * uWindSpeed * uRippleStrength;
                vec2 sampleUv = (vUv - 0.5) * 2.5 + windShear + vec2(rip, 0.0);

                // Pyroclastic density
                float density = pyroclasticNoise(sampleUv, seed, t);

                // Radial taper so individual billboards aren't square
                float radial = 1.0 - length(vUv - 0.5) * 1.8;
                radial = clamp(radial, 0.0, 1.0);
                density *= radial;

                if (density < 0.05) discard;

                // Edge fade near cloud volume boundary
                float edgeDist = length(vLocalOffset);
                float edgeFade = 1.0 - smoothstep(0.45, 0.95, edgeDist);

                // Color
                vec3 baseColor = uCloudColor;
                float backlight = getBacklight(vWorldPos, uLightDir, uCameraPos);
                vec3 litColor = baseColor + vec3(0.35, 0.28, 0.12) * backlight;

                float darken = getUndersideDarken(vUv, uMoisture);
                vec3 darkColor = baseColor * vec3(0.45, 0.50, 0.62);
                vec3 color = mix(litColor, darkColor, darken * 0.7);

                float tint = sin(seed * 13.7) * 0.03;
                color += vec3(tint, tint * 0.8, tint * 0.5);

                // Proximity fade: billboards fade out near camera
                float distToCam = distance(vWorldPos, uCameraPos);
                float proxFade = uProximityFade <= 0.0 ? 1.0 : smoothstep(0.0, uProximityFade, distToCam);

                // Final alpha
                float alpha = density * vAlpha * uCloudCoverage * edgeFade * proxFade;
                alpha = clamp(alpha, 0.0, 0.85);

                gl_FragColor = vec4(color, alpha);
            }
        `;
    }

    // ------------------------------------------------------------------
    // Noise helpers
    // ------------------------------------------------------------------
    _hashNoise(x, z) {
        const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
        const n2 = Math.sin(x * 269.5 + z * 183.3 + 79.0) * 43758.5453;
        return (Math.abs(n - Math.floor(n)) + Math.abs(n2 - Math.floor(n2))) * 0.5;
    }

    // ------------------------------------------------------------------
    // Cloud density (world-space placement)
    // ------------------------------------------------------------------
    _sampleCloudDensity(worldX, worldZ) {
        const s1 = this._hashNoise(worldX * 0.015, worldZ * 0.015);
        const s2 = this._hashNoise(worldX * 0.035 + 100, worldZ * 0.035 + 200) * 0.5;
        const s3 = this._hashNoise(worldX * 0.08 + 300, worldZ * 0.08 + 400) * 0.25;
        let density = (s1 + s2 + s3) / 1.75;
        density = density * 0.5 + this._cloudCoverage * 0.5;
        density = Math.max(0, (density - 0.35) * 2.0);
        return Math.min(1, density);
    }

    // ------------------------------------------------------------------
    // Generate voxels for one cloud cluster
    // ------------------------------------------------------------------
    _generateCloudVoxels(cx, cy, cz, seed, lod, startIdx, spawnFade = 1.0) {
        const count = this.voxelsPerCloud.min + Math.floor(seed * (this.voxelsPerCloud.max - this.voxelsPerCloud.min));
        let written = 0;
        const centers = lod.centers;
        const local = lod.localOffsets;
        const scales = lod.scales;
        const seeds = lod.seeds;
        const alphas = lod.alphas;
        const wind = lod.windOffsets;

        for (let v = 0; v < count; v++) {
            if (startIdx + written >= lod.startIndex + lod.maxCount) break;
            const vs = this._hashNoise(seed * 1000 + v, v * 37.1);

            let lx = (this._hashNoise(vs, 1) - 0.5) * 2.0;
            let ly = (this._hashNoise(vs, 2) - 0.25) * 2.0; // bias upward
            let lz = (this._hashNoise(vs, 3) - 0.5) * 2.0;

            // Ellipsoid cull
            const d = lx * lx + (ly * ly) * 2.5 + lz * lz;
            if (d > 1.0) continue;

            const i = startIdx + written;
            centers[i * 3] = cx; centers[i * 3 + 1] = cy; centers[i * 3 + 2] = cz;
            local[i * 3] = lx; local[i * 3 + 1] = ly; local[i * 3 + 2] = lz;
            scales[i] = (0.7 + this._hashNoise(vs, 4) * 0.5) * lod.config.spriteScale;
            seeds[i] = vs;
            alphas[i] = spawnFade;
            wind[i * 2] = 0; wind[i * 2 + 1] = 0;
            written++;
        }
        return written;
    }

    // ------------------------------------------------------------------
    // Grid update
    // ------------------------------------------------------------------
    _updateGrid(cameraX, cameraZ) {
        const gridOriginX = Math.floor(cameraX / this.cellSize);
        const gridOriginZ = Math.floor(cameraZ / this.cellSize);

        if (gridOriginX === this._lastGridOrigin.x && gridOriginZ === this._lastGridOrigin.z) {
            return false;
        }
        this._lastGridOrigin.x = gridOriginX;
        this._lastGridOrigin.z = gridOriginZ;

        let offset = 0;
        for (let lod = 0; lod < this._lodMeshes.length; lod++) {
            this._rebuildLod(lod, gridOriginX, gridOriginZ, cameraX, cameraZ, offset);
            offset += this._lodMeshes[lod].count;
        }
        if (this._debug) {
            this._updateDebugMarkers();
        }
        return true;
    }

    _rebuildLod(lodIndex, gridOriginX, gridOriginZ, cameraX, cameraZ, baseOffset) {
        const lod = this._lodMeshes[lodIndex];
        lod.startIndex = baseOffset;
        const stride = lod.stride;
        const r = this.renderRadius;
        const lodPrefix = `lod${lodIndex}:`;

        // Mark all clouds in this LOD as potentially dying
        for (const [key, state] of this._cellFadeStates) {
            if (key.startsWith(lodPrefix)) state.dying = true;
        }

        let count = 0;

        // Living clouds
        for (let gz = -r; gz <= r; gz += stride) {
            for (let gx = -r; gx <= r; gx += stride) {
                const cellGx = gridOriginX + gx;
                const cellGz = gridOriginZ + gz;
                const worldX = cellGx * this.cellSize;
                const worldZ = cellGz * this.cellSize;

                const density = this._sampleCloudDensity(worldX, worldZ);
                if (density * this.cloudDensityScale < 0.05) continue;

                let height = this.cloudBaseHeight;
                if (this.terrainSystem && this.terrainSystem.getHeight) {
                    const th = this.terrainSystem.getHeight(worldX, worldZ);
                    if (typeof th === 'number' && !isNaN(th)) {
                        height = th + this.cloudBaseHeight;
                    }
                }

                const seed = this._hashNoise(cellGx * 73.3, cellGz * 91.7);
                const cellKey = `lod${lodIndex}:${cellGx},${cellGz}`;

                let state = this._cellFadeStates.get(cellKey);
                const driftHash = this._hashNoise(seed * 791.3 + 123.4, seed * 547.1 + 987.6);
                const phaseHash = this._hashNoise(seed * 413.7 + 321.0, seed * 659.2 + 456.8);
                if (!state) {
                    state = {
                        alpha: 0, dying: false, height, seed,
                        driftX: 0, driftZ: 0,
                        driftSpeed: 0.5 + driftHash * 0.8,
                        driftPhase: phaseHash * 6.283
                    };
                    this._cellFadeStates.set(cellKey, state);
                } else {
                    state.dying = false;
                    state.height = height;
                    state.seed = seed;
                    if (state.driftX === undefined) state.driftX = 0;
                    if (state.driftZ === undefined) state.driftZ = 0;
                    if (state.driftSpeed === undefined) state.driftSpeed = 0.5 + driftHash * 0.8;
                    if (state.driftPhase === undefined) state.driftPhase = phaseHash * 6.283;
                }

                const voxels = this._generateCloudVoxels(worldX, height, worldZ, seed, lod, lod.startIndex + count, state.alpha);
                for (let i = 0; i < voxels; i++) {
                    lod.cellKeys[count + i] = cellKey;
                }
                count += voxels;
                if (count >= lod.maxCount) break;
            }
            if (count >= lod.maxCount) break;
        }

        // Dying clouds
        for (const [key, state] of this._cellFadeStates) {
            if (!key.startsWith(lodPrefix)) continue;
            if (!state.dying) continue;
            if (state.alpha <= 0.005) {
                this._cellFadeStates.delete(key);
                continue;
            }
            const parts = key.split(':')[1].split(',');
            const cellGx = parseInt(parts[0]);
            const cellGz = parseInt(parts[1]);
            const worldX = cellGx * this.cellSize;
            const worldZ = cellGz * this.cellSize;

            const voxels = this._generateCloudVoxels(worldX, state.height, worldZ, state.seed, lod, lod.startIndex + count, state.alpha);
            for (let i = 0; i < voxels; i++) {
                lod.cellKeys[count + i] = key;
            }
            count += voxels;
            if (count >= lod.maxCount) break;
        }

        lod.count = count;

        lod.iCloudCenter.needsUpdate = true;
        lod.iLocalOff.needsUpdate = true;
        lod.iSeed.needsUpdate = true;
        lod.iAlpha.needsUpdate = true;
        lod.iScale.needsUpdate = true;
        lod.iWindOffset.needsUpdate = true;

        if (this._debug) {
            console.log(`[VoxelCloudSystem] LOD${lodIndex} rebuilt: ${count} voxels (stride=${stride}, baseH=${this.cloudBaseHeight})`);
        }

    }

    // ------------------------------------------------------------------
    // Per-frame alpha update for LOD crossfade
    // ------------------------------------------------------------------
    _updateAlphas(cameraX, cameraZ) {
        for (let lod = 0; lod < this._lodMeshes.length; lod++) {
            const lodData = this._lodMeshes[lod];
            const cfg = lodData.config;
            const count = lodData.count;
            const centers = lodData.centers;
            const alphaArr = lodData.alphas;
            const cellKeys = lodData.cellKeys;

            for (let rel = 0; rel < count; rel++) {
                const i = lodData.startIndex + rel;
                const wx = centers[i * 3];
                const wz = centers[i * 3 + 2];
                const dist = Math.sqrt((wx - cameraX) ** 2 + (wz - cameraZ) ** 2);

                let alpha = 1.0;
                if (dist < cfg.fadeStart) {
                    alpha = 1.0;
                } else if (dist > cfg.fadeEnd) {
                    alpha = 0.0;
                } else {
                    alpha = 1.0 - (dist - cfg.fadeStart) / (cfg.fadeEnd - cfg.fadeStart);
                    alpha = alpha * alpha * (3 - 2 * alpha);
                }

                // Grid-edge fade to prevent pop-in/out at render boundary
                const cellOffsetX = (wx / this.cellSize) - this._lastGridOrigin.x;
                const cellOffsetZ = (wz / this.cellSize) - this._lastGridOrigin.z;
                const cellDist = Math.sqrt(cellOffsetX * cellOffsetX + cellOffsetZ * cellOffsetZ);
                const edgeFadeStart = this.renderRadius * 0.65;
                const edgeFadeEnd = this.renderRadius * 0.95;
                let edgeFade = 1.0;
                if (cellDist >= edgeFadeEnd) {
                    edgeFade = 0.0;
                } else if (cellDist > edgeFadeStart) {
                    let t = (cellDist - edgeFadeStart) / (edgeFadeEnd - edgeFadeStart);
                    edgeFade = 1.0 - t * t * (3 - 2 * t);
                }
                alpha *= edgeFade;

                // Spawn/despawn fade
                const key = cellKeys[rel];
                const state = this._cellFadeStates.get(key);
                const spawnFade = state ? state.alpha : 1.0;
                alpha *= spawnFade;

                alphaArr[i] = alpha;
            }
        }
        if (this._lodMeshes.length) {
            this._lodMeshes[0].iAlpha.needsUpdate = true;
        }
    }

    // ------------------------------------------------------------------
    // Per-cell spawn/despawn fade
    // ------------------------------------------------------------------
    _updateFadeStates(deltaTime) {
        const fadeSpeed = 2.0;
        const delta = deltaTime * fadeSpeed;
        for (const state of this._cellFadeStates.values()) {
            if (state.dying) {
                state.alpha = Math.max(0, state.alpha - delta);
            } else {
                state.alpha = Math.min(1, state.alpha + delta);
            }
        }
    }

    // ------------------------------------------------------------------
    // Wind offset accumulation (world-space drift per cloud)
    // ------------------------------------------------------------------
    _updateWindOffsets(deltaTime) {
        const windX = Math.cos(this._windDirection) * this._windSpeed * this._jetstream * deltaTime * 2.0;
        const windZ = Math.sin(this._windDirection) * this._windSpeed * this._jetstream * deltaTime * 2.0;

        // Accumulate drift per cloud (cell) so clumps move independently
        for (const state of this._cellFadeStates.values()) {
            const speedMul = state.driftSpeed || 1.0;
            const phase = state.driftPhase || 0;
            const turb = Math.sin(this._time * 0.3 + phase) * 0.35 + 1.0;
            state.driftX += windX * speedMul * turb;
            state.driftZ += windZ * speedMul * turb;
            const maxDrift = this.cellSize * 1.5;
            state.driftX = Math.max(-maxDrift, Math.min(maxDrift, state.driftX));
            state.driftZ = Math.max(-maxDrift, Math.min(maxDrift, state.driftZ));
        }

        // Write per-cloud drift into each voxel instance
        for (let lod = 0; lod < this._lodMeshes.length; lod++) {
            const lodData = this._lodMeshes[lod];
            const count = lodData.count;
            const windArr = lodData.windOffsets;
            const cellKeys = lodData.cellKeys;

            for (let rel = 0; rel < count; rel++) {
                const i = lodData.startIndex + rel;
                const key = cellKeys[rel];
                const state = this._cellFadeStates.get(key);
                if (state) {
                    windArr[i * 2] = state.driftX;
                    windArr[i * 2 + 1] = state.driftZ;
                }
            }
        }
        if (this._lodMeshes.length) {
            this._lodMeshes[0].iWindOffset.needsUpdate = true;
        }
    }

    // ------------------------------------------------------------------
    // Parameter reading
    // ------------------------------------------------------------------
    _readParameters() {
        const ps = window.parameterSystem;
        if (!ps) return;

        const enabled = ps.getParameter('voxelCloudEnabled');
        if (this._mesh) this._mesh.visible = enabled;

        const newBaseHeight = ps.getParameter('voxelCloudBaseHeight');
        if (newBaseHeight !== undefined && newBaseHeight !== this.cloudBaseHeight) {
            this.cloudBaseHeight = newBaseHeight;
            this._lastGridOrigin = { x: Infinity, z: Infinity };
        }

        const newRadius = ps.getParameter('voxelCloudRenderRadius');
        if (newRadius !== undefined && newRadius !== this.renderRadius) {
            this.renderRadius = newRadius;
            this._lastGridOrigin = { x: Infinity, z: Infinity };
        }

        const quality = Math.round(ps.getParameter('voxelCloudQuality') ?? 2);
        const sizes = [64, 52, 40, 28, 20, 14, 10];
        const newSize = sizes[Math.max(0, Math.min(6, quality))];
        if (newSize !== this.cellSize) {
            this.cellSize = newSize;
            this._lastGridOrigin = { x: Infinity, z: Infinity };
        }

        const newSizeScale = ps.getParameter('voxelCloudSize');
        if (newSizeScale !== undefined && newSizeScale !== this.cloudSizeScale) {
            this.cloudSizeScale = newSizeScale;
            if (this._mesh && this._mesh.material.uniforms) {
                this._mesh.material.uniforms.uSpriteScale.value = this.cellSize * 0.25 * this.cloudSizeScale;
            }
        }

        const newDensityScale = ps.getParameter('voxelCloudDensity');
        if (newDensityScale !== undefined && newDensityScale !== this.cloudDensityScale) {
            this.cloudDensityScale = newDensityScale;
            this._lastGridOrigin = { x: Infinity, z: Infinity };
        }

        const color = ps.getParameter('voxelCloudColor');
        if (color !== undefined) {
            if (this._mesh && this._mesh.material.uniforms) {
                this._mesh.material.uniforms.uCloudColor.value.set(color);
            }
        }

        const debug = ps.getParameter('voxelCloudDebug');
        if (debug !== undefined && debug !== this._debug) {
            this.setDebug(debug);
        }

        // New params
        const voxelCount = ps.getParameter('voxelCloudVoxels');
        if (voxelCount !== undefined) {
            const floored = Math.max(this.voxelsPerCloud.min + 4, Math.floor(voxelCount));
            if (floored !== this.voxelsPerCloud.max) {
                this.voxelsPerCloud.max = floored;
                this._lastGridOrigin = { x: Infinity, z: Infinity };
            }
        }

        const ripple = ps.getParameter('voxelCloudRipple');
        if (ripple !== undefined && ripple !== this.rippleStrength) {
            this.rippleStrength = ripple;
            if (this._mesh && this._mesh.material.uniforms) {
                this._mesh.material.uniforms.uRippleStrength.value = ripple;
            }
        }

        const jetstream = ps.getParameter('voxelCloudJetstream');
        if (jetstream !== undefined && jetstream !== this._jetstream) {
            this._jetstream = jetstream;
            if (this._mesh && this._mesh.material.uniforms) {
                this._mesh.material.uniforms.uWindSpeed.value = this._windSpeed * this._jetstream;
            }
        }

        const proxFade = ps.getParameter('voxelCloudProximityFade');
        if (proxFade !== undefined && proxFade !== this._proximityFade) {
            this._proximityFade = proxFade;
            if (this._mesh && this._mesh.material.uniforms) {
                this._mesh.material.uniforms.uProximityFade.value = proxFade;
            }
        }
    }

    // ------------------------------------------------------------------
    // Debug markers
    // ------------------------------------------------------------------
    _clearDebugMarkers() {
        while (this._debugGroup.children.length > 0) {
            const child = this._debugGroup.children[0];
            this._debugGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
    }

    _updateDebugMarkers() {
        this._clearDebugMarkers();
        if (!this._lodMeshes.length) return;
        const lod0 = this._lodMeshes[0];
        const count = lod0.count;
        const centers = lod0.centers;
        if (!this._debugBoxGeo) {
            this._debugBoxGeo = new THREE.BoxGeometry(2, 2, 2);
            this._debugBoxMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
        }
        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(this._debugBoxGeo, this._debugBoxMat);
            mesh.position.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
            this._debugGroup.add(mesh);
        }
    }

    // ------------------------------------------------------------------
    // Test clouds
    // ------------------------------------------------------------------
    spawnTestCloudAt(worldX, worldZ, opts = {}) {
        const color = opts.color || 0xff0000;
        const size = opts.size || 60;
        const height = opts.height || (this.terrainSystem?.getHeight ? this.terrainSystem.getHeight(worldX, worldZ) : 0) + this.cloudBaseHeight;

        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(worldX, height, worldZ);
        mesh.scale.set(size, size, size);
        const camX = this._cameraPos.x || worldX + 1;
        const camZ = this._cameraPos.z || worldZ + 1;
        mesh.lookAt(camX, height, camZ);
        mesh.name = 'TestCloud';
        this.scene.add(mesh);
        this._testClouds.push(mesh);
        console.log(`[VoxelCloudSystem] Test cloud spawned at (${worldX.toFixed(1)}, ${height.toFixed(1)}, ${worldZ.toFixed(1)}) size=${size}`);
        return mesh;
    }

    clearTestClouds() {
        for (const mesh of this._testClouds) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this._testClouds = [];
        console.log('[VoxelCloudSystem] Test clouds cleared');
    }

    setDebug(enabled) {
        this._debug = enabled;
        console.log('[VoxelCloudSystem] Debug:', enabled);
        if (enabled) {
            this._updateDebugMarkers();
        } else {
            this._clearDebugMarkers();
        }
        this._lastGridOrigin = { x: Infinity, z: Infinity };
    }

    setWeatherSnapshot(snapshot) {
        if (!snapshot) return;
        this._weatherSnapshot = snapshot;
        this._moisture = snapshot.humidity;
        this._cloudCoverage = snapshot.cloudCoverage;
        this._windSpeed = snapshot.windSpeed;
        this._windDirection = snapshot.windDirection;
        this._lightBlocking = snapshot.lightBlocking;

        if (this._mesh && this._mesh.material.uniforms) {
            const u = this._mesh.material.uniforms;
            if (u.uMoisture) u.uMoisture.value = this._moisture;
            if (u.uCloudCoverage) u.uCloudCoverage.value = this._cloudCoverage;
            if (u.uWindSpeed) u.uWindSpeed.value = this._windSpeed * this._jetstream;
            if (u.uWindDirection) u.uWindDirection.value.set(
                Math.cos(this._windDirection), 0, Math.sin(this._windDirection)
            ).normalize();
        }
    }

    setEnabled(enabled) {
        if (this._enabled === enabled) return;
        this._enabled = enabled;
        if (this._mesh) this._mesh.visible = enabled;
    }

    update(camera, time, deltaTime) {
        if (!this._enabled) return;
        this._time += deltaTime;
        this._cameraPos.copy(camera.position);

        this._readParameters();

        this._updateFadeStates(deltaTime);

        const gridChanged = this._updateGrid(camera.position.x, camera.position.z);

        this._updateAlphas(camera.position.x, camera.position.z);

        this._updateWindOffsets(deltaTime);

        let totalCount = 0;
        for (const lod of this._lodMeshes) {
            totalCount += lod.count;
        }
        this._mesh.count = totalCount;

        if (this._mesh.material.uniforms) {
            this._mesh.material.uniforms.uTime.value = this._time;
            this._mesh.material.uniforms.uCameraPos.value.copy(camera.position);
        }
    }

    dispose() {
        if (this._mesh) {
            this.scene.remove(this._mesh);
            this._mesh.geometry.dispose();
            this._mesh.material.dispose();
        }
        this._lodMeshes = [];
        this._clearDebugMarkers();
        this.clearTestClouds();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VoxelCloudSystem;
}
