// RollingTerrainMesh — Fixed-capacity rolling terrain grid
//  - Uses a single BufferGeometry whose topology never changes.
//  - Only Y (height) is updated when the camera crosses a hysteresis threshold.
//  - Ring-buffer heads rotate logical world rows/cols so new edge data
//    overwrites the leaving edge data without reallocating buffers.
//
//  No per-frame geometry recreation. No dynamic arrays. Minimal GC.

class RollingTerrainMesh {
    constructor(boardSystem, terrainSystem, options = {}) {
        this.board    = boardSystem;
        this.terrain  = terrainSystem;
        this.groundwaterSystem = null; // set externally
        this.N        = options.gridSize        || 64;   // vertices per axis
        this.S        = options.cellSize        || 1;    // world units per cell
        this.threshold = options.thresholdCells || 12;  // safe-zone margin
        this.maxStep  = options.maxStepPerFrame || 16;   // per-axis clamp

        this.originX = 0;    // world X of local vertex (0,0)
        this.originZ = 0;    // world Z of local vertex (0,0)

        // Static geometry: x/z never change; y is updated on roll.
        const vertCount = this.N * this.N;
        const positions = new Float32Array(vertCount * 3);
        const colors    = new Float32Array(vertCount * 3);
        const uvs       = new Float32Array(vertCount * 2);
        const indices   = [];

        for (let z = 0; z < this.N; z++) {
            for (let x = 0; x < this.N; x++) {
                const i = z * this.N + x;
                positions[i * 3 + 0] = x * this.S;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = z * this.S;
                // White — the shader generates checkerboard from world position
                colors[i * 3 + 0] = 1.0;
                colors[i * 3 + 1] = 1.0;
                colors[i * 3 + 2] = 1.0;
                uvs[i * 2 + 0] = 0;
                uvs[i * 2 + 1] = 0;
            }
        }

        for (let z = 0; z < this.N - 1; z++) {
            for (let x = 0; x < this.N - 1; x++) {
                const a = z * this.N + x;
                const b = a + 1;
                const c = a + this.N;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
        this.geometry.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
        this.geometry.setAttribute('terrainCliff', new THREE.BufferAttribute(new Float32Array(vertCount), 1));
        this.geometry.setIndex(indices);

        const material = options.material || new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.name = 'rollingTerrain';
        this.mesh.receiveShadow = true;
        this.mesh.castShadow    = false;

        // Water plane — match terrain size exactly (quad aligned with terrain grid)
        const terrainSize = (this.N - 1) * this.S;
        this.waterRadius = terrainSize * 0.5; // half-size for the square mesh function
        this.waterGeoFadeWidth = options.waterGeoFadeWidth || 5.0;
        this.waterResolution = this.N; // match terrain grid resolution
        const waterGeometry = this._createSquareWaterMesh(this.waterRadius, this.waterResolution);
        this._waterDepths = waterGeometry.attributes.terrainDepth.array;
        // Placeholder 1x1 white texture so the shader compiles with a valid sampler2D
        const placeholderTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
        placeholderTex.needsUpdate = true;
        this.waterUniforms = {
            uReflectionMap:     { value: placeholderTex },
            uReflectionEnabled: { value: 0.0 },
            uTextureMatrix:     { value: new THREE.Matrix4() },
            uWaterColor:        { value: new THREE.Color(0x3388cc) },
            uOpacity:           { value: 0.45 },
            uRoughness:         { value: 0.05 },
            uMetalness:         { value: 0.7 },
            uTime:              { value: 0.0 },
            uWindDir:           { value: new THREE.Vector2(1.0, 0.0) },
            uWindSpeed:         { value: 1.0 },
            uWaveTexScale:      { value: 1.0 },
            uWaveTexSpeed:      { value: 1.0 },
            uWaterBaseY:        { value: 0.0 },
            uWaveNormalStr:     { value: 0.35 },
            uWaveCrestTint:     { value: 1.15 },
            uWaveTroughTint:    { value: 0.85 },
            uWaveSparkle:       { value: 0.3 },
            uWaveSpecularPower: { value: 32.0 },
            uWaveFresnelPower:  { value: 2.0 },
            uWaveNormalEps:     { value: 0.05 },
            fogColor:           { value: new THREE.Color(0x808080) },
            fogNear:            { value: 20 },
            fogFar:             { value: 60 },
            fogEnabled:         { value: 1.0 },
            // Unified Gerstner wave parameters (single source of truth)
            uWaveK:             { value: new Float32Array(10) },     // 5 harmonics × 2
            uWaveAmp:           { value: new Float32Array(5) },
            uWaveOmega:         { value: new Float32Array(5) },
            uWavePhase:         { value: new Float32Array(5) },
            uWaveSteepness:     { value: 0.3 },
            uWaveMaxAmp:        { value: 0.46 },
            // Spherical deformation (copied from terrain shader)
            uSphereRadius:      { value: 180.0 },
            uDeformStartHeight: { value: 10.0 },
            uDeformEndHeight:   { value: 100.0 },
            uCameraHeight:      { value: 0.0 },
            uEnableSpherical:   { value: 1.0 },
            uCurvatureScale:    { value: 2.0 },
            uPlanetCenter:      { value: new THREE.Vector3(0, 0, 0) }
        };
        const waterVertexShader = `
            attribute float terrainDepth;

            uniform mat4 uTextureMatrix;
            uniform float uWaterBaseY;
            uniform float uSphereRadius;
            uniform float uDeformStartHeight;
            uniform float uDeformEndHeight;
            uniform float uCameraHeight;
            uniform float uEnableSpherical;
            uniform float uCurvatureScale;
            uniform vec3 uPlanetCenter;

            varying vec4 vReflectionUv;
            varying vec3 vWorldPosition;
            varying vec3 vViewDirection;
            varying float vTerrainDepth;

            void applySphericalDeformation(inout vec4 worldPos) {
                if (uEnableSpherical > 0.5 && uSphereRadius > 0.0) {
                    float heightRange = max(0.0001, uDeformEndHeight - uDeformStartHeight);
                    float t = clamp((uCameraHeight - uDeformStartHeight) / heightRange, 0.0, 1.0);
                    vec3 fromCenter = worldPos.xyz - uPlanetCenter;
                    float dist = length(fromCenter.xz);
                    float curvature = (dist * dist) / (2.0 * uSphereRadius);
                    worldPos.y -= curvature * t * uCurvatureScale;
                }
            }

            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vTerrainDepth = terrainDepth;

                // Flat water plane - no geometric displacement
                // Wave visuals are handled entirely in fragment shader
                worldPos.y = uWaterBaseY;
                applySphericalDeformation(worldPos);

                vWorldPosition = worldPos.xyz;
                vViewDirection = cameraPosition - worldPos.xyz;
                vReflectionUv = uTextureMatrix * worldPos;
                vec4 mvPosition = viewMatrix * worldPos;
                gl_Position = projectionMatrix * mvPosition;
            }
        `;
        const waterFragmentShader = `
            uniform sampler2D uReflectionMap;
            uniform float uReflectionEnabled;
            uniform vec3 uWaterColor;
            uniform float uOpacity;
            uniform float uRoughness;
            uniform float uMetalness;
            uniform float uTime;
            uniform vec2 uWindDir;
            uniform float uWindSpeed;
            uniform float uWaveTexScale;
            uniform float uWaveTexSpeed;
            uniform float uWaveK[10];
            uniform float uWaveAmp[5];
            uniform float uWaveOmega[5];
            uniform float uWavePhase[5];
            uniform float uWaveSteepness;
            uniform float uWaveMaxAmp;
            uniform float uWaveNormalEps;
            uniform float uWaveNormalStr;
            uniform float uWaveCrestTint;
            uniform float uWaveTroughTint;
            uniform float uWaveSparkle;
            uniform float uWaveSpecularPower;
            uniform float uWaveFresnelPower;
            uniform vec3 fogColor;
            uniform float fogNear;
            uniform float fogFar;
            uniform float fogEnabled;

            varying vec4 vReflectionUv;
            varying vec3 vWorldPosition;
            varying vec3 vViewDirection;
            varying float vTerrainDepth;

            // Procedural wave texture with organic, non-grid pattern
            vec2 rotateToWind(vec2 p) {
                vec2 wd = normalize(uWindDir);
                return vec2(dot(p, wd), dot(p, vec2(-wd.y, wd.x)));
            }

            // Hash function for pseudo-random noise
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            // Smooth noise function
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            // Fractal Brownian Motion for organic wave variation
            float fbm(vec2 p, float t) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;
                for (int i = 0; i < 4; i++) {
                    value += amplitude * noise(p * frequency + t * 0.1);
                    amplitude *= 0.5;
                    frequency *= 2.0;
                }
                return value;
            }

            // Organic wave texture that flows with wind direction
            float waveTextureHeight(vec2 p, float t) {
                vec2 q = rotateToWind(p);
                float freq = uWaveTexScale;
                float spd = uWaveTexSpeed * (0.3 + uWindSpeed * 0.7);
                float h = 0.0;

                // Primary wind-aligned waves (flowing downwind)
                float wave1 = sin(q.x * 2.0 * freq - t * 1.5 * spd + fbm(p * 0.5, t * 0.2) * 0.5);
                h += wave1 * 0.40;

                // Secondary cross-wind ripples (perpendicular to wind)
                float wave2 = sin(q.y * 4.0 * freq + t * 0.8 * spd + noise(p * 1.5 + t * 0.1) * 0.3);
                h += wave2 * 0.25;

                // Small turbulent detail (non-grid, rotated at 45 degrees to wind)
                float turbAngle = 0.785; // 45 degrees
                vec2 turb = vec2(
                    q.x * cos(turbAngle) - q.y * sin(turbAngle),
                    q.x * sin(turbAngle) + q.y * cos(turbAngle)
                );
                float wave3 = sin(turb.x * 8.0 * freq - t * 2.2 * spd) * cos(turb.y * 6.0 * freq + t * 1.5 * spd);
                h += wave3 * 0.15;

                // Fine micro-ripples using noise (completely organic, no grid)
                h += (noise(p * 16.0 * freq + t * spd) - 0.5) * 0.12;
                h += (noise(p * 32.0 * freq - t * 1.8 * spd) - 0.5) * 0.08;

                return h;
            }

            float gerstnerHeight(vec2 worldXZ, float timeVal) {
                float h = 0.0;
                for (int i = 0; i < 5; i++) {
                    vec2 k = vec2(uWaveK[i*2], uWaveK[i*2+1]);
                    float phase = dot(k, worldXZ) - uWaveOmega[i] * timeVal + uWavePhase[i];
                    h += uWaveAmp[i] * sin(phase);
                }
                if (uWaveSteepness > 0.0 && uWaveMaxAmp > 0.001) {
                    float norm = h / uWaveMaxAmp;
                    h = (norm > 0.0 ? pow(norm, 1.0 - uWaveSteepness)
                                    : -pow(-norm, 1.0 - uWaveSteepness)) * uWaveMaxAmp;
                }
                return h;
            }

            void main() {
                vec3 viewDir = normalize(vViewDirection);
                vec2 worldXZ = vWorldPosition.xz;

                float h0  = gerstnerHeight(worldXZ, uTime) + waveTextureHeight(worldXZ, uTime);
                float eps = uWaveNormalEps;
                float hx  = gerstnerHeight(worldXZ + vec2(eps, 0.0), uTime) + waveTextureHeight(worldXZ + vec2(eps, 0.0), uTime);
                float hz  = gerstnerHeight(worldXZ + vec2(0.0, eps), uTime) + waveTextureHeight(worldXZ + vec2(0.0, eps), uTime);
                vec3 waveNormal = normalize(vec3(-(hx - h0) / eps, 1.0, -(hz - h0) / eps));

                // Full wave texture everywhere (no distance fade on normals)
                float normalStr = uWaveNormalStr;
                vec3 normal = normalize(mix(vec3(0.0, 1.0, 0.0), waveNormal, normalStr));

                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
                float diff = max(dot(normal, lightDir), 0.0);
                vec3 color = uWaterColor * (0.25 + 0.75 * diff);

                float heightFactor = h0 * 0.15 + 0.5;
                color = mix(color * uWaveTroughTint, color * uWaveCrestTint, heightFactor);

                vec3 halfDir = normalize(lightDir + viewDir);
                float spec = pow(max(dot(normal, halfDir), 0.0), uWaveSpecularPower);
                color += vec3(1.0) * spec * uMetalness * (1.0 - uRoughness);

                float sparkle = pow(max(dot(normal, normalize(lightDir + vec3(0.0, 0.3, 0.0))), 0.0), 64.0);
                color += vec3(0.8, 0.9, 1.0) * sparkle * uWaveSparkle * (1.0 - uRoughness);

                if (uReflectionEnabled > 0.5) {
                    vec2 reflectionUv = vReflectionUv.xy / vReflectionUv.w;
                    reflectionUv.y = 1.0 - reflectionUv.y;
                    vec3 reflectionColor = texture(uReflectionMap, reflectionUv).rgb;

                    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), uWaveFresnelPower);
                    fresnel = clamp(fresnel, 0.0, 1.0);

                    color = mix(color, reflectionColor, fresnel * uReflectionEnabled);
                }

                // Full terrain coverage - no edge fade needed
                float finalOpacity = uOpacity;

                if (fogEnabled > 0.5) {
                    float fogDist = length(vViewDirection);
                    float fogFactor = smoothstep(fogNear, fogFar, fogDist);
                    color = mix(color, fogColor, fogFactor);
                }

                gl_FragColor = vec4(color, finalOpacity);
            }
        `;
        const waterMaterial = new THREE.ShaderMaterial({
            uniforms: this.waterUniforms,
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
        this.waterMesh.name = 'waterPlane';
        this.waterMesh.renderOrder = 1; // after terrain, before transparent trees
        this.waterMesh.receiveShadow = true;
        this.waterMesh.castShadow    = false;
        this.waterOffset = options.waterOffset ?? 0.03;
        console.log(`[RollingTerrainMesh] Water plane created: ${this.N}x${this.N} verts, offset=${this.waterOffset}`);

        this.waveUpdateIntervalMs = options.waveUpdateIntervalMs ?? 500; // CPU fallback: update less often
        this._lastWaveUpdateTime = 0;
        this.shaderWaveEnabled = true; // Use GPU shader waves by default (eliminates CPU simulation cost)
        this.updateThrottle = {
            enabled: options.enableThrottle !== undefined ? !!options.enableThrottle : true,
            intervalMs: 66,       // ~15 Hz max instead of 30 Hz
            minDistance: 1.5,     // Only roll after 1.5 world units
            lastCameraPos: new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY),
            lastUpdateTime: 0
        };

        // Toroidal Gerstner wave config — harmonics are integer multiples of domain size
        this.waveConfig = {
            enabled: true,
            amplitudeScale: 1.0,
            speed: 1.5,
            steepness: 0.3,
            harmonics: [
                { nx: 1, nz: 0, amplitude: 0.15, phase: 0 },
                { nx: 0, nz: 1, amplitude: 0.12, phase: 1.5 },
                { nx: 1, nz: 1, amplitude: 0.08, phase: 0.7 },
                { nx: -1, nz: 2, amplitude: 0.06, phase: 2.1 },
                { nx: 2, nz: -1, amplitude: 0.05, phase: 3.2 }
            ]
        };
        this.windDir = new THREE.Vector2(1, 0);
        this.windSpeed = 1.0;
        this.terrainHeights = new Float32Array(this.N * this.N);

        // Pre-allocated temp buffers for ring-buffer _roll() (avoids GC from temp arrays)
        this._rollTemp = {
            y:       new Float32Array(this.N * this.N),
            heights: new Float32Array(this.N * this.N),
            depths:  new Float32Array(this.N * this.N),
            cliffs:  new Float32Array(this.N * this.N),
        };

        // Throttled logging
        this._lastLogTime = 0;
        this._logInterval = 1000; // ms

        // Cliff mask throttling
        this._lastCliffMaskUpdate = 0;
        this._cliffMaskUpdateIntervalMs = 200;

        // Debug tracking
        this._debugTrackEnabled = false;
        this._lastTrackTime = 0;
        this._trackInterval = 2000; // ms
        this._trackHistory = []; // last few roll events
        if (typeof window !== 'undefined') {
            if (!window.__terrainDebug) window.__terrainDebug = {};
            window.__terrainDebug.rollingTerrain = this;
            window.__terrainDebug.toggleTrack = () => {
                this._debugTrackEnabled = !this._debugTrackEnabled;
                console.log(`[TerrainTrack] ${this._debugTrackEnabled ? 'ENABLED' : 'DISABLED'}`);
            };
        }

        // Flatten water to base so shader waves displace from correct level
        this._flattenWaterToBase();
    }

    // ---- square water mesh --------------------------------------------------

    /**
     * Create a camera-centered square grid water mesh with a circular mask in the shader.
     * Uniform vertex distribution is better for wave simulation than radial fans.
     * Vertices cover [-radius, +radius] on X/Z with 'resolution' verts per axis.
     * The shader discards/fades fragments beyond the circular boundary.
     */
    _createSquareWaterMesh(radius, resolution) {
        const positions = [];
        const indices = [];
        const terrainDepths = [];
        const step = (radius * 2) / (resolution - 1);

        for (let z = 0; z < resolution; z++) {
            for (let x = 0; x < resolution; x++) {
                positions.push(
                    -radius + x * step,
                    0,
                    -radius + z * step
                );
                terrainDepths.push(1.0);
            }
        }

        for (let z = 0; z < resolution - 1; z++) {
            for (let x = 0; x < resolution - 1; x++) {
                const a = z * resolution + x;
                const b = a + 1;
                const c = a + resolution;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('terrainDepth', new THREE.Float32BufferAttribute(terrainDepths, 1));
        geometry.setIndex(indices);

        const vertCount = positions.length / 3;
        console.log(`[SquareWaterMesh] Created: ${resolution}x${resolution} grid, ${vertCount} verts, ${indices.length / 3} tris`);
        return geometry;
    }

    // ---- helpers ------------------------------------------------------------

    // Flat index: local (xW, zW) maps directly to buffer because mesh
    // moves with the origin, so no ring-buffer rotation is needed.
    _bIndex(xW, zW) {
        return zW * this.N + xW;
    }

    _height(worldX, worldZ) {
        return this.board.getUnifiedTerrainHeight(worldX, worldZ);
    }

    _currentWaterLevel() {
        const boardLevel = (this.board && (this.board.tidalWaterLevel ?? this.board.waterLevel));
        return boardLevel ?? -1.5;
    }

    _updateWaterBaseUniform() {
        const base = this._currentWaterLevel() + this.waterOffset;
        this.waterUniforms.uWaterBaseY.value = base;
        return base;
    }

    _writeDepthAtIndex(idx, terrainHeight, waterLevel) {
        if (!this._waterDepths) return;
        if (idx < 0 || idx >= this._waterDepths.length) return;
        this._waterDepths[idx] = waterLevel - terrainHeight;
    }

    _markWaterDepthsDirty() {
        const attr = this.waterMesh?.geometry?.attributes?.terrainDepth;
        if (attr) {
            attr.needsUpdate = true;
        }
    }

    _flattenWaterToBase() {
        if (!this.waterMesh || !this.waterMesh.geometry?.attributes?.position) return;
        const waterPos = this.waterMesh.geometry.attributes.position.array;
        const base = this._updateWaterBaseUniform();
        for (let i = 1; i < waterPos.length; i += 3) {
            waterPos[i] = base;
        }
        this.waterMesh.geometry.attributes.position.needsUpdate = true;
    }

    setShaderWaveEnabled(enabled) {
        const next = !!enabled;
        if (this.shaderWaveEnabled === next) return;
        this.shaderWaveEnabled = next;
        // uShaderWavesEnabled removed — shader waves are always enabled now
        if (next) {
            this._flattenWaterToBase();
        } else {
            this._lastWaveUpdateTime = 0;
            this.updateWaves(true);
        }
    }

    setUpdateThrottleEnabled(enabled) {
        this.updateThrottle.enabled = !!enabled;
        if (!this.updateThrottle.enabled) {
            this.updateThrottle.lastCameraPos.set(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
            this.updateThrottle.lastUpdateTime = 0;
        }
    }

    // ---- public API ---------------------------------------------------------

    async initAt(centerX, centerZ) {
        this.originX = Math.floor(centerX) - Math.floor(this.N / 2);
        this.originZ = Math.floor(centerZ) - Math.floor(this.N / 2);
        this.mesh.position.set(this.originX, 0, this.originZ);
        // Center water mesh on terrain center (water vertices are centered at local origin)
        const terrainCenterX = this.originX + (this.N - 1) * this.S * 0.5;
        const terrainCenterZ = this.originZ + (this.N - 1) * this.S * 0.5;
        this.waterMesh.position.set(terrainCenterX, 0, terrainCenterZ);

        const pos = this.geometry.attributes.position.array;
        const waterLevel = this._currentWaterLevel();
        for (let zW = 0; zW < this.N; zW++) {
            for (let xW = 0; xW < this.N; xW++) {
                const idx = this._bIndex(xW, zW);
                const wX  = this.originX + xW;
                const wZ  = this.originZ + zW;
                const h = this._height(wX, wZ);
                pos[idx * 3 + 1] = h;
                this.terrainHeights[idx] = h;
            }
        }
        this.geometry.attributes.position.needsUpdate = true;

        // Sync water plane — flat at water level
        const waterPos = this.waterMesh.geometry.attributes.position.array;
        const waterY = this._updateWaterBaseUniform();
        for (let i = 1; i < waterPos.length; i += 3) {
            waterPos[i] = waterY;
        }
        this.waterMesh.geometry.attributes.position.needsUpdate = true;
        this._markWaterDepthsDirty();

        this.geometry.computeVertexNormals();
        const c = this._getCornerCoords();
        this._log('init', `origin=(${this.originX},${this.originZ}) size=${this.N}x${this.N} camera(${centerX.toFixed(1)},${centerZ.toFixed(1)}) corners NW${c.nw} NE${c.ne} SW${c.sw} SE${c.se}`);
    }

    // Call every frame (or every update) with the terrain center position.
    // `terrainCenter` is the point the camera orbits around (what the user
    // is looking at) — keeping the mesh centered there prevents the focal
    // point from drifting toward the terrain edge.
    // `cameraPos` is optional and defaults to `terrainCenter`; it is used
    // only for water/shader effects that must track the actual camera.
    update(terrainCenter, cameraPos = terrainCenter) {
        this.waterUniforms.uTime.value = performance.now() / 1000;

        // Sync camera height to water shader for spherical deformation
        this.waterUniforms.uCameraHeight.value = cameraPos.y;

        // Sync spherical deformation params from texture blending system (if available)
        const tbs = this.board && this.board.textureBlendingSystem;
        if (tbs) {
            const mat = tbs.shaderMaterial;
            if (mat && mat.uniforms) {
                const src = mat.uniforms;
                if (src.uSphereRadius) this.waterUniforms.uSphereRadius.value = src.uSphereRadius.value;
                if (src.uDeformStartHeight) this.waterUniforms.uDeformStartHeight.value = src.uDeformStartHeight.value;
                if (src.uDeformEndHeight) this.waterUniforms.uDeformEndHeight.value = src.uDeformEndHeight.value;
                if (src.uEnableSpherical) this.waterUniforms.uEnableSpherical.value = src.uEnableSpherical.value;
                if (src.uCurvatureScale) this.waterUniforms.uCurvatureScale.value = src.uCurvatureScale.value;
                if (src.uPlanetCenter) this.waterUniforms.uPlanetCenter.value.copy(src.uPlanetCenter.value);
            }
        }

        // Position water mesh centered on terrain center (follows landscape, not camera)
        if (this.waterMesh) {
            const terrainCenterX = this.originX + (this.N - 1) * this.S * 0.5;
            const terrainCenterZ = this.originZ + (this.N - 1) * this.S * 0.5;
            this.waterMesh.position.set(terrainCenterX, 0, terrainCenterZ);
            this._updateWaterDepths(terrainCenterX, cameraPos.y, terrainCenterZ);
        }

        // Update Gerstner uniforms every frame so shader waves stay current
        this._syncGerstnerUniforms(this.waterUniforms.uTime.value);

        if (this.updateThrottle.enabled) {
            const now = performance.now();
            const lastPos = this.updateThrottle.lastCameraPos;
            const minDistSq = this.updateThrottle.minDistance * this.updateThrottle.minDistance;
            let distSq = Infinity;
            if (lastPos.x !== Number.POSITIVE_INFINITY) {
                const dxPos = terrainCenter.x - lastPos.x;
                const dzPos = terrainCenter.z - lastPos.z;
                distSq = dxPos * dxPos + dzPos * dzPos;
            }
            if (distSq < minDistSq && (now - this.updateThrottle.lastUpdateTime) < this.updateThrottle.intervalMs) {
                return;
            }
            this.updateThrottle.lastUpdateTime = now;
            this.updateThrottle.lastCameraPos.copy(terrainCenter);
        }
        // Threshold-based rolling: only roll when camera nears mesh edge,
        // not on every integer boundary crossing. This eliminates the
        // visual jitter caused by terrain snapping while camera drags smoothly.
        const localX = terrainCenter.x - this.originX;
        const localZ = terrainCenter.z - this.originZ;
        const edgeMin = this.threshold;
        const edgeMax = this.N - 1 - this.threshold;

        let dx = 0;
        let dz = 0;
        if (localX < edgeMin)  dx = Math.floor(localX - edgeMin);
        if (localX > edgeMax)  dx = Math.ceil(localX - edgeMax);
        if (localZ < edgeMin)  dz = Math.floor(localZ - edgeMin);
        if (localZ > edgeMax)  dz = Math.ceil(localZ - edgeMax);

        // Clamp to max step so we don't do giant recalcs in one frame
        if (dx !== 0) {
            dx = Math.max(-this.maxStep, Math.min(this.maxStep, dx));
        }
        if (dz !== 0) {
            dz = Math.max(-this.maxStep, Math.min(this.maxStep, dz));
        }

        // Always track, even if no roll happens
        const meshMinX = this.originX;
        const meshMaxX = this.originX + (this.N - 1);
        const meshMinZ = this.originZ;
        const meshMaxZ = this.originZ + (this.N - 1);
        this._debugTrack(terrainCenter, meshMinX, meshMaxX, meshMinZ, meshMaxZ, dx, dz);

        // Debug: console.log(`[RollingTerrain] ROLL triggered: local(${localX.toFixed(1)},${localZ.toFixed(1)}) edge[${edgeMin}..${edgeMax}] dx=${dx} dz=${dz} origin=(${this.originX},${this.originZ})`);

        if (dx === 0 && dz === 0) return;

        this._trackHistory.push({
            t: Date.now(),
            camera: { x: terrainCenter.x.toFixed(1), z: terrainCenter.z.toFixed(1) },
            roll: { dx, dz },
            origin: { x: this.originX, z: this.originZ }
        });
        if (this._trackHistory.length > 10) this._trackHistory.shift();

        this._roll(dx, dz, terrainCenter);
    }

    // Refresh a rectangular world region that falls inside the current window.
    // Called by terrainSystem.onChunkLoaded so newly arrived data shows up
    // without a full rebuild.
    refreshRegion(worldMinX, worldMinZ, worldMaxX, worldMaxZ) {
        const localMinX = Math.max(0, Math.floor(worldMinX - this.originX));
        const localMinZ = Math.max(0, Math.floor(worldMinZ - this.originZ));
        const localMaxX = Math.min(this.N - 1, Math.ceil(worldMaxX - this.originX));
        const localMaxZ = Math.min(this.N - 1, Math.ceil(worldMaxZ - this.originZ));

        if (localMinX > localMaxX || localMinZ > localMaxZ) return 0;

        const pos = this.geometry.attributes.position.array;
        const waterLevel = this._currentWaterLevel();
        let touched = 0;
        for (let zW = localMinZ; zW <= localMaxZ; zW++) {
            for (let xW = localMinX; xW <= localMaxX; xW++) {
                const idx = this._bIndex(xW, zW);
                const wX  = this.originX + xW;
                const wZ  = this.originZ + zW;
                const h = this._height(wX, wZ);
                pos[idx * 3 + 1] = h;
                this.terrainHeights[idx] = h;
                touched++;
            }
        }
        if (touched > 0) {
            this.geometry.attributes.position.needsUpdate = true;
            // NOTE: skipping computeVertexNormals for small region refreshes —
            // saves ~14ms per call. Normals from init/_roll are close enough
            // for 16×16 chunk patches in a 576×576 mesh.

            // Sync water plane — flatten to base Y (radial mesh: update all verts, not grid region)
            const waterY = this._updateWaterBaseUniform();
            const waterPos = this.waterMesh.geometry.attributes.position.array;
            // Only do grid-region indexing if water mesh matches terrain grid size
            if (waterPos.length === this.N * this.N * 3) {
                for (let zW = localMinZ; zW <= localMaxZ; zW++) {
                    for (let xW = localMinX; xW <= localMaxX; xW++) {
                        const idx = this._bIndex(xW, zW);
                        waterPos[idx * 3 + 1] = waterY;
                    }
                }
            } else {
                // Radial mesh: flatten all vertices to base Y
                for (let i = 1; i < waterPos.length; i += 3) {
                    waterPos[i] = waterY;
                }
            }
            this.waterMesh.geometry.attributes.position.needsUpdate = true;
            this._markWaterDepthsDirty();

            // this._log('refresh', `region [${localMinX}..${localMaxX}, ${localMinZ}..${localMaxZ}] touched=${touched}`);
        }
        return touched;
    }

    // ---- internals ----------------------------------------------------------

    _computeCliffMasks() {
        // Throttle removed: _roll() is already throttled by updateThrottle,
        // and cliff masks must stay in sync with the geometry immediately.
        // const now = performance.now();
        // if (now - this._lastCliffMaskUpdate < this._cliffMaskUpdateIntervalMs) return;
        // this._lastCliffMaskUpdate = now;
        const N = this.N;
        const heights = this.terrainHeights;
        const cliffAttr = this.geometry.attributes.terrainCliff.array;

        for (let z = 0; z < N; z++) {
            for (let x = 0; x < N; x++) {
                const idx = z * N + x;

                let dx = 0, dz = 0;
                if (x > 0 && x < N - 1) {
                    dx = (heights[idx + 1] - heights[idx - 1]) * 0.5;
                } else if (x < N - 1) {
                    dx = heights[idx + 1] - heights[idx];
                } else {
                    dx = heights[idx] - heights[idx - 1];
                }

                if (z > 0 && z < N - 1) {
                    dz = (heights[idx + N] - heights[idx - N]) * 0.5;
                } else if (z < N - 1) {
                    dz = heights[idx + N] - heights[idx];
                } else {
                    dz = heights[idx] - heights[idx - N];
                }

                const len = Math.sqrt(dx * dx + 1 + dz * dz);
                cliffAttr[idx] = 1.0 / len;
            }
        }
        this.geometry.attributes.terrainCliff.needsUpdate = true;
    }

    _roll(dx, dz, cameraPos) {
        const N = this.N;
        const pos = this.geometry.attributes.position.array;
        const temp = this._rollTemp;

        // Snapshot current data into pre-allocated temp buffers
        for (let i = 0; i < N * N; i++) {
            temp.y[i]       = pos[i * 3 + 1];
            temp.heights[i] = this.terrainHeights[i];
            temp.cliffs[i]  = this.geometry.attributes.terrainCliff.array[i];
        }

        // Move origin (mesh stays at origin in world space)
        this.originX += dx;
        this.originZ += dz;
        this.mesh.position.x = this.originX;
        this.mesh.position.z = this.originZ;
        // Water mesh position is managed by update() — camera-centered radial mesh

        const waterLevel = this._currentWaterLevel();

        // Ring-buffer copy: existing data is shifted by (-dx, -dz) in local space.
        // Only the newly exposed strips need fresh _height() samples.
        for (let zW = 0; zW < N; zW++) {
            for (let xW = 0; xW < N; xW++) {
                const newIdx = this._bIndex(xW, zW);
                const oldLocalX = xW + dx;
                const oldLocalZ = zW + dz;

                if (oldLocalX >= 0 && oldLocalX < N && oldLocalZ >= 0 && oldLocalZ < N) {
                    // Overlapping region: copy from temp snapshot
                    const oldIdx = this._bIndex(oldLocalX, oldLocalZ);
                    pos[newIdx * 3 + 1] = temp.y[oldIdx];
                    this.terrainHeights[newIdx] = temp.heights[oldIdx];
                    this.geometry.attributes.terrainCliff.array[newIdx] = temp.cliffs[oldIdx];
                } else {
                    // Newly exposed edge: sample terrain height
                    const wX = this.originX + xW;
                    const wZ = this.originZ + zW;
                    const h = this._height(wX, wZ);
                    pos[newIdx * 3 + 1] = h;
                    this.terrainHeights[newIdx] = h;
                }
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this._computeCliffMasks();

        // Sync water plane — flat at water level (X/Z are static, only Y changes)
        // Skip CPU Y-update when shader waves are active (shader handles displacement)
        const waterY = this._updateWaterBaseUniform();
        if (!this.shaderWaveEnabled) {
            const waterPos = this.waterMesh.geometry.attributes.position.array;
            for (let i = 1; i < waterPos.length; i += 3) {
                waterPos[i] = waterY;
            }
            this.waterMesh.geometry.attributes.position.needsUpdate = true;
        }
        this._markWaterDepthsDirty();

        // Skip computeVertexNormals on roll — saves ~14ms per call.
        // Normals from init are close enough for edge-strip updates.
        // this.geometry.computeVertexNormals();

        // const c = this._getCornerCoords();
        // const camStr = cameraPos ? `camera(${cameraPos.x.toFixed(1)},${cameraPos.z.toFixed(1)}) ` : '';
        // this._log('roll', `dx=${dx} dz=${dz} origin=(${this.originX},${this.originZ}) ${camStr}corners NW${c.nw} NE${c.ne} SW${c.sw} SE${c.se}`);

        if (typeof this.board.onTerrainRolled === 'function') {
            this.board.onTerrainRolled(dx, dz, this.originX, this.originZ);
        }
    }

    // Average world position of the four corner vertices.
    // This is a more robust "center" than origin + N/2 because it reflects
    // the actual computed heights.
    getCenterFromCorners() {
        const pos = this.geometry.attributes.position.array;
        const corners = [
            this._bIndex(0, 0),
            this._bIndex(this.N - 1, 0),
            this._bIndex(0, this.N - 1),
            this._bIndex(this.N - 1, this.N - 1)
        ];
        let cx = 0, cy = 0, cz = 0;
        for (const idx of corners) {
            cx += pos[idx * 3 + 0] + this.mesh.position.x;
            cy += pos[idx * 3 + 1] + this.mesh.position.y;
            cz += pos[idx * 3 + 2] + this.mesh.position.z;
        }
        return { x: cx / 4, y: cy / 4, z: cz / 4 };
    }

    _getCornerCoords() {
        const farX = this.originX + (this.N - 1) * this.S;
        const farZ = this.originZ + (this.N - 1) * this.S;
        return {
            nw: `(${this.originX.toFixed(0)},${this.originZ.toFixed(0)})`,
            ne: `(${farX.toFixed(0)},${this.originZ.toFixed(0)})`,
            sw: `(${this.originX.toFixed(0)},${farZ.toFixed(0)})`,
            se: `(${farX.toFixed(0)},${farZ.toFixed(0)})`
        };
    }

    destroy(scene) {
        if (this.mesh) {
            scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh = null;
        }
        if (this.waterMesh) {
            scene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
            this.waterMesh.material.dispose();
            this.waterMesh = null;
        }
    }

    _debugTrack(cameraPos, minX, maxX, minZ, maxZ, dx, dz) {
        if (!this._debugTrackEnabled) return;
        const now = Date.now();
        if (now - this._lastTrackTime < this._trackInterval) return;
        this._lastTrackTime = now;

        const center = this.getCenterFromCorners();
        const distToCenter = Math.sqrt(
            (cameraPos.x - center.x) ** 2 +
            (cameraPos.z - center.z) ** 2
        );
        const halfSize = (this.N - 1) * this.S * 0.5;

        const farX = this.originX + (this.N - 1) * this.S;
        const farZ = this.originZ + (this.N - 1) * this.S;
        const nw = `(${this.originX.toFixed(0)},${this.originZ.toFixed(0)})`;
        const ne = `(${farX.toFixed(0)},${this.originZ.toFixed(0)})`;
        const sw = `(${this.originX.toFixed(0)},${farZ.toFixed(0)})`;
        const se = `(${farX.toFixed(0)},${farZ.toFixed(0)})`;

        console.log(
            `%c[TerrainTrack] target(${cameraPos.x.toFixed(1)},${cameraPos.z.toFixed(1)})  ` +
            `terrainOrigin(${this.originX},${this.originZ})  ` +
            `cornerCenter(${center.x.toFixed(1)},${center.z.toFixed(1)})  ` +
            `distToCenter=${distToCenter.toFixed(1)}  ` +
            `safeZone[${minX.toFixed(0)}..${maxX.toFixed(0)}, ${minZ.toFixed(0)}..${maxZ.toFixed(0)}]  ` +
            `halfSize=${halfSize.toFixed(0)}  ` +
            `corners NW${nw} NE${ne} SW${sw} SE${se}`,
            distToCenter > halfSize * 0.5 ? 'color:#ff4444' : 'color:#44ff44'
        );
    }

    // Unified Gerstner wave sync — pushes computed wave params to shader uniforms
    // so vertex and fragment shaders evaluate the SAME world-space wave function.
    _syncGerstnerUniforms(time) {
        const L = this.N * this.S;
        const g = 9.81;
        const windPhaseBoost = this.windSpeed * 0.3;
        const windDx = this.windDir.x;
        const windDz = this.windDir.y;
        const ampScale = this.waveConfig.amplitudeScale;
        const freqScale = this.waveConfig.freqScale || 1.0;
        const speedScale = this.waveConfig.speedScale || 1.0;
        let maxAmp = 0;

        for (let i = 0; i < this.waveConfig.harmonics.length; i++) {
            const h = this.waveConfig.harmonics[i];
            const kx = ((2 * Math.PI * h.nx) / L) * freqScale;
            const kz = ((2 * Math.PI * h.nz) / L) * freqScale;
            const kMag = Math.sqrt(kx * kx + kz * kz) || 0.001;
            const omega = Math.sqrt(g * kMag) * this.waveConfig.speed * speedScale * (1.0 + this.windSpeed * 0.2);
            const windDot = (kx * windDx + kz * windDz) / kMag;
            const phase = h.phase + windPhaseBoost * windDot;
            const amp = h.amplitude * ampScale;

            this.waterUniforms.uWaveK.value[i * 2] = kx;
            this.waterUniforms.uWaveK.value[i * 2 + 1] = kz;
            this.waterUniforms.uWaveAmp.value[i] = amp;
            this.waterUniforms.uWaveOmega.value[i] = omega;
            this.waterUniforms.uWavePhase.value[i] = phase;
            maxAmp += amp;
        }
        this.waterUniforms.uWaveMaxAmp.value = maxAmp;
        this.waterUniforms.uWaveSteepness.value = this.waveConfig.steepness;
    }

    setGroundwaterSystem(groundwaterSystem) {
        this.groundwaterSystem = groundwaterSystem;
    }

    setWeatherSnapshot(snapshot) {
        if (!snapshot) return;
        this.windDir.set(Math.cos(snapshot.windDirection), Math.sin(snapshot.windDirection));
        this.windSpeed = snapshot.windSpeed;
        this.waterUniforms.uWindDir.value.copy(this.windDir);
        this.waterUniforms.uWindSpeed.value = this.windSpeed;
        // Storm strength modulates wave amplitude (rougher water)
        const ps = window.parameterSystem;
        const waveScale = ps ? ps.getParameter('weatherStormWaveScale') : 1.0;
        const stormBoost = 1.0 + snapshot.stormStrength * 0.8 * waveScale;
        this.waveConfig.amplitudeScale = (this._baseAmplitudeScale || 1.0) * stormBoost;
    }

    // Update terrainDepth attribute for water mesh based on terrain at given world origin
    _updateWaterDepths(originX, cameraY, originZ) {
        if (!this.waterMesh || !this.waterMesh.geometry) return;
        const waterLevel = this._currentWaterLevel();
        const pos = this.waterMesh.geometry.attributes.position.array;
        const depths = this.waterMesh.geometry.attributes.terrainDepth.array;
        const worldX = originX;
        const worldZ = originZ;

        let closestShorelineDist = Infinity;
        const shorelineDepthThreshold = 1.0;
        let hasWater = false;
        let hasLand = false;

        // Water mesh vertices are centered at (0,0,0) in local space,
        // positioned at terrain center in world space. Compute depth from terrain height.
        for (let i = 0; i < depths.length; i++) {
            const vx = pos[i * 3];
            const vz = pos[i * 3 + 2];
            const wx = worldX + vx;
            const wz = worldZ + vz;
            const h = this._height(wx, wz);

            // Check for local groundwater pool
            let effectiveWaterLevel = waterLevel;
            if (this.groundwaterSystem) {
                const surfaceWater = this.groundwaterSystem.getSurfaceWater(wx, wz);
                if (surfaceWater > 0.02) {
                    // Pool exists: water surface is at terrain height + pool depth
                    effectiveWaterLevel = h + surfaceWater;
                }
            }

            depths[i] = effectiveWaterLevel - h;

            if (depths[i] > 0) hasWater = true;
            if (depths[i] < 0) hasLand = true;

            // Track shoreline proximity for wave sound (depth near zero = shoreline)
            // Use a threshold band so multiple candidates smooth the min-distance estimate.
            if (Math.abs(depths[i]) < shorelineDepthThreshold) {
                const dist = Math.sqrt(vx * vx + vz * vz);
                if (dist < closestShorelineDist) {
                    closestShorelineDist = dist;
                }
            }
        }

        // If no shoreline vertex found inside the mesh, sample cardinal directions
        // beyond the mesh to find the nearest transition.
        if (closestShorelineDist === Infinity && ((hasLand && !hasWater) || (!hasLand && hasWater))) {
            const sampleDist = this.waterRadius * 1.5;
            const dirs = [
                { x: sampleDist, z: 0 },
                { x: -sampleDist, z: 0 },
                { x: 0, z: sampleDist },
                { x: 0, z: -sampleDist }
            ];
            for (const d of dirs) {
                const h = this._height(cameraX + d.x, cameraZ + d.z);
                const depth = waterLevel - h;
                if (hasLand && depth > 0) {
                    closestShorelineDist = sampleDist;
                    break;
                }
                if (hasWater && depth < 0) {
                    closestShorelineDist = sampleDist;
                    break;
                }
            }
        }

        // True 3D distance from camera to shoreline: combine horizontal distance
        // with height above the water surface.
        const heightAboveWater = Math.max(0, cameraY - waterLevel);
        const dist3D = Math.sqrt(
            closestShorelineDist * closestShorelineDist +
            heightAboveWater * heightAboveWater
        );

        this.waterMesh.geometry.attributes.terrainDepth.needsUpdate = true;

        // Drive shoreline wave ambience with master Gerstner strength
        if (window.soundManager) {
            const waveStrength = this.waterUniforms.uWaveMaxAmp.value;
            window.soundManager.updateShorelineAmbience(waveStrength, dist3D);
        }
    }

    // Deprecated: CPU Gerstner displacement replaced by shader-based unified waves.
    // This method now only syncs uniforms and updates radial mesh depths.
    updateWaves(force = false) {
        if (!this.waveConfig.enabled || !this.waterMesh) return;
        const now = performance.now();
        if (!force && this.waveUpdateIntervalMs > 0 && (now - this._lastWaveUpdateTime) < this.waveUpdateIntervalMs) {
            return;
        }
        this._lastWaveUpdateTime = now;
        const time = now / 1000;
        this._syncGerstnerUniforms(time);
        this._updateWaterBaseUniform();
    }

    _log(tag, msg) {
        // Throttled logging disabled for performance
        // const now = Date.now();
        // if (now - this._lastLogTime < this._logInterval) return;
        // this._lastLogTime = now;
        // console.log(`[RollingTerrain ${tag}] ${msg}`);
    }
}
