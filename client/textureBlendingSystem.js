// Texture Blending System - Dynamic chessboard to grass transition based on camera distance
class TextureBlendingSystem {
    constructor(boardSystem, terrainSystem) {
        this.boardSystem = boardSystem;
        this.terrainSystem = terrainSystem;
        
        // Distance configuration (cursor-based fade)
        this.startDistance = 8;  // Start fading from biome to checkerboard
        this.endDistance = 16;   // Fully checkerboard at cursor
        
        // Spherical deformation toggle (controlled by dev interface)
        this.sphericalEnabled = true;
        this.debugForceSpherical = false;
        this.fadeEnabled = true;
        this.checkerFadeStrength = 1.0;
        this.curvatureScale = 1.0;
        this.deformStartHeight = 10;
        this.deformEndHeight = 100;
        
        // Grass texture reference for seasonal updates
        this.grassTexture = null;
        
        // Biome colors for adaptive terrain - enhanced for better visual diversity
        this.biomeColors = {
            deep_water: new THREE.Color(0.40, 0.60, 0.90),        // Light blue
            shallow_water: new THREE.Color(0.70, 0.65, 0.50),      // Wet sand
            beach: new THREE.Color(0.76, 0.70, 0.42),              // Sandy brown
            lowland: new THREE.Color(0.42, 0.68, 0.32),           // Light green
            grassland: new THREE.Color(0.25, 0.58, 0.22),          // Rich green
            forest: new THREE.Color(0.18, 0.42, 0.15),             // Dark forest green
            mountain: new THREE.Color(0.52, 0.38, 0.28),           // Rocky gray-brown
            snow: new THREE.Color(0.88, 0.90, 0.92)               // Off-white snow
        };
        
        // Enhanced grass colors with more variation
        this.grassColors = [
            new THREE.Color(0.22, 0.48, 0.15),  // Dark green
            new THREE.Color(0.28, 0.62, 0.18),  // Medium green  
            new THREE.Color(0.35, 0.72, 0.25),  // Light green
            new THREE.Color(0.32, 0.58, 0.22),  // Olive green
            new THREE.Color(0.25, 0.55, 0.20),  // Forest green
        ];
        
        // Store original vertex colors
        this.originalColors = new Map();
        
        // Store stable grass colors per tile to prevent flickering
        this.tileGrassColors = new Map();
        this.colorTransitionTime = new Map();
        
        // Checkerboard visible radius: shrinks proportionally with camera height
        this.checkerBaseStart = 8.0;
        this.checkerBaseEnd = 16.0;
        this.checkerHeightFactor = 0.02;  // radius = base / (1 + camHeight * factor)
        
        // Cliff / slope material system
        this.cliffEnabled = true;
        this.cliffThreshold = 0.45;        // slope start: ~65 degrees (cos 65° ≈ 0.42)
        this.cliffBlendWidth = 0.25;       // transition band width in dot-space
        this.cliffRubbleAmount = 0.65;     // loose scree visibility
        this.cliffStrataScale = 0.12;      // horizontal banding frequency
        this.cliffStrataAmount = 0.55;     // banding visibility
        this.cliffDarkenAmount = 0.35;     // vertical face darkening
        this.cliffBaseColor = new THREE.Color(0.38, 0.34, 0.30);
        this.cliffLightColor = new THREE.Color(0.58, 0.52, 0.46);
        this.cliffMossColor = new THREE.Color(0.28, 0.38, 0.22);
        this.cliffMossAmount = 0.40;
        this.cliffDebug = false;
        
        // Forest floor mask & textures
        this.forestMaskResolution = 256;
        this.forestMaskData = new Uint8Array(this.forestMaskResolution * this.forestMaskResolution);
        this.forestMaskTexture = new THREE.DataTexture(
            this.forestMaskData,
            this.forestMaskResolution,
            this.forestMaskResolution,
            THREE.RedFormat,
            THREE.UnsignedByteType
        );
        this.forestMaskTexture.internalFormat = 'R8';
        this.forestMaskTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.forestMaskTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.forestMaskTexture.minFilter = THREE.LinearFilter;
        this.forestMaskTexture.magFilter = THREE.LinearFilter;
        this.forestMaskTexture.colorSpace = THREE.NoColorSpace;
        this.forestMaskTexture.needsUpdate = true;
        this.forestMaskOrigin = new THREE.Vector2(0, 0);
        this.forestMaskWorldSize = 1;
        this._hasForestMaskData = false;
        this.forestEnabled = true;
        this.forestBlendMax = 0.65;
        this.forestMaskStrength = 1.5;
        this.forestBiomeBias = 1.0;
        this.forestTexScale = 0.18;
        this.forestNoiseScale = 0.08;
        this.forestBaseInfluence = 0.2;

        this.forestFloorTextures = this._createForestFloorTextureMap();
        this.activeForestTextureKey = 'default';
        this._biomeToForestTexture = {
            forest: 'forest',
            lowland: 'grassland',
            grassland: 'grassland',
            taiga: 'taiga',
            snow: 'taiga'
        };
        this._lastForestTextureKey = null;
        this._nodeShaderConfig = null; // Loaded from /api/terrain-shader

        console.log('[TextureBlending] System initialized');
    }

    async tryLoadNodeShader() {
        try {
            const res = await fetch('/api/terrain-shader', { cache: 'no-store' });
            if (res.ok) {
                this._nodeShaderConfig = await res.json();
                console.log('[TextureBlending] Loaded node shader config');
            } else {
                console.log('[TextureBlending] No saved node shader config (', res.status, ')');
            }
        } catch (err) {
            console.log('[TextureBlending] Failed to load node shader config:', err.message);
        }
    }

    _createForestFloorTextureMap() {
        return {
            default: this._generateForestFloorTexture('#3b2a1c', '#4f3a25', '#2a2116'),
            forest: this._generateForestFloorTexture('#2e3a23', '#45532c', '#1c2415'),
            taiga: this._generateForestFloorTexture('#2c2d30', '#484647', '#1f1f24'),
            grassland: this._generateForestFloorTexture('#3a3f1e', '#566027', '#252912')
        };
    }

    _generateForestFloorTexture(baseHex, midHex, accentHex) {
        const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
        if (!canvas) {
            return null;
        }

        const size = 256;
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = baseHex;
        ctx.fillRect(0, 0, size, size);

        const layers = [midHex, accentHex];
        layers.forEach((color, layerIndex) => {
            ctx.fillStyle = color;
            const spots = 180 + layerIndex * 80;
            for (let i = 0; i < spots; i++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const radius = (Math.random() * 6 + 2) * (layerIndex === 0 ? 1 : 0.6);
                const opacity = 0.08 + Math.random() * 0.12;
                ctx.globalAlpha = opacity;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        });
        ctx.globalAlpha = 1;

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        return texture;
    }

    setActiveForestFloorTexture(key) {
        if (!this.forestFloorTextures) return;
        const texture = this.forestFloorTextures[key] || this.forestFloorTextures.default;
        if (!texture) return;
        this.activeForestTextureKey = key;
        this._lastForestTextureKey = key;
        if (this.shaderMaterial?.uniforms?.uForestFloorTexture) {
            this.shaderMaterial.uniforms.uForestFloorTexture.value = texture;
        }
    }

    updateForestTextureForBiome(biome) {
        if (!this.forestFloorTextures) return;
        const key = this._biomeToForestTexture[biome] || 'default';
        if (key === this._lastForestTextureKey) {
            return;
        }
        this.setActiveForestFloorTexture(key);
    }
    
    // Get seasonal grass color from board system
    getSeasonalGrassColor() {
        if (this.boardSystem && this.boardSystem.currentSeason && this.boardSystem.seasonConfig) {
            const seasonConfig = this.boardSystem.seasonConfig[this.boardSystem.currentSeason];
            if (seasonConfig && seasonConfig.treeColor) {
                // Use actual seasonal tree color directly without multipliers
                const [r, g, b] = seasonConfig.treeColor;
                return new THREE.Color(r, g, b);
            }
        }
        // Default green color if no seasonal data available
        return new THREE.Color(0.3, 0.6, 0.2);
    }
    
    getAdaptiveTerrainColor(worldX, worldZ, time) {
        const tileKey = `${Math.floor(worldX)},${Math.floor(worldZ)}`;
        
        // Get tile data from terrain system
        const tileData = this.terrainSystem.getTileData(worldX, worldZ);
        
        if (tileData && tileData.biome) {
            // Use biome-based color
            const biomeColor = this.biomeColors[tileData.biome];
            if (biomeColor) {
                // Enhanced variation based on moisture, temperature, and position
                const moisture = tileData.moisture || 0.5;
                const temperature = tileData.temperature || 0.5;
                const elevation = tileData.elevation || tileData.height || 0;
                
                const variedColor = biomeColor.clone();
                
                // Add position-based noise for natural variation
                const noiseX = Math.sin(worldX * 0.15) * Math.cos(worldZ * 0.12);
                const noiseZ = Math.cos(worldX * 0.12) * Math.sin(worldZ * 0.15);
                const positionNoise = (noiseX + noiseZ) * 0.5;
                
                // Enhanced environmental effects
                variedColor.r += (moisture - 0.5) * 0.15;  // Moisture affects brightness
                variedColor.g += (temperature - 0.5) * 0.12; // Temperature affects green tint
                variedColor.b += (moisture - 0.5) * 0.08;
                
                // Elevation-based shading
                if (elevation > 10) {
                    // Higher elevations are cooler and darker
                    variedColor.r *= 0.9;
                    variedColor.g *= 0.95;
                    variedColor.b *= 1.05;
                } else if (elevation < 0) {
                    // Lower elevations are warmer
                    variedColor.r *= 1.05;
                    variedColor.g *= 1.02;
                    variedColor.b *= 0.95;
                }
                
                // Add natural noise variation with multiple scales
                variedColor.r += positionNoise * 0.08;
                variedColor.g += positionNoise * 0.06;
                variedColor.b += positionNoise * 0.04;
                
                // Add micro-variation for ultra-natural appearance
                const microNoise = Math.sin(worldX * 0.8) * Math.cos(worldZ * 0.7) * 0.02;
                variedColor.r += microNoise;
                variedColor.g += microNoise * 0.8;
                variedColor.b += microNoise * 0.6;
                
                // Clamp values to valid range
                variedColor.r = Math.max(0, Math.min(1, variedColor.r));
                variedColor.g = Math.max(0, Math.min(1, variedColor.g));
                variedColor.b = Math.max(0, Math.min(1, variedColor.b));
                
                return variedColor;
            }
        }
        
        // Fallback to grass color if no biome data
        return this.getStableGrassColor(worldX, worldZ, time);
    }
    
    getStableGrassColor(worldX, worldZ, time) {
        const tileKey = `${Math.floor(worldX)},${Math.floor(worldZ)}`;
        
        // Initialize color for this tile if not exists
        if (!this.tileGrassColors.has(tileKey)) {
            // Ensure grassColors array exists and has elements
            if (!this.grassColors || this.grassColors.length === 0) {
                // Fallback to default green color if no grass colors available
                this.tileGrassColors.set(tileKey, new THREE.Color(0.3, 0.6, 0.2));
            } else {
                const colorIndex = Math.floor(Math.abs(worldX + worldZ)) % this.grassColors.length;
                const baseColor = this.grassColors[colorIndex];
                if (baseColor) {
                    this.tileGrassColors.set(tileKey, baseColor.clone());
                } else {
                    // Fallback if baseColor is undefined
                    this.tileGrassColors.set(tileKey, new THREE.Color(0.3, 0.6, 0.2));
                }
            }
            this.colorTransitionTime.set(tileKey, Math.random() * Math.PI * 2); // Random phase
        }
        
        const baseColor = this.tileGrassColors.get(tileKey);
        const phase = this.colorTransitionTime.get(tileKey);
        
        // Create slow color variation
        const variationFactor = Math.sin(time * 0.1 + phase) * 0.05; // Very slow transition
        const variedColor = baseColor.clone();
        variedColor.r += variationFactor * 0.1;
        variedColor.g += variationFactor * 0.05;
        variedColor.b += variationFactor * 0.02;
        
        return variedColor;
    }
    
    updateForestMaskFromDensity(payload) {
        if (!this.forestMaskData || !this.forestMaskTexture) {
            return;
        }

        if (!payload || !payload.densityGrid || payload.densityGrid.size === 0 || !payload.size || payload.size <= 0) {
            this._clearForestMask();
            return;
        }

        const { densityGrid } = payload;
        const origin = payload.origin || { x: 0, z: 0 };
        const worldSize = Math.max(0.0001, payload.size);

        const resolution = this.forestMaskResolution;
        const data = this.forestMaskData;
        data.fill(0);

        const stamp = [
            { dx: 0, dz: 0, weight: 1.0 },
            { dx: 1, dz: 0, weight: 0.6 },
            { dx: -1, dz: 0, weight: 0.6 },
            { dx: 0, dz: 1, weight: 0.6 },
            { dx: 0, dz: -1, weight: 0.6 },
            { dx: 1, dz: 1, weight: 0.35 },
            { dx: -1, dz: 1, weight: 0.35 },
            { dx: 1, dz: -1, weight: 0.35 },
            { dx: -1, dz: -1, weight: 0.35 }
        ];

        for (const [key, count] of densityGrid.entries()) {
            const [tileXRaw, tileZRaw] = key.split(',');
            const tileX = Number(tileXRaw);
            const tileZ = Number(tileZRaw);
            if (!Number.isFinite(tileX) || !Number.isFinite(tileZ)) continue;

            const worldX = tileX + 0.5;
            const worldZ = tileZ + 0.5;
            const u = (worldX - origin.x) / worldSize;
            const v = (worldZ - origin.z) / worldSize;
            if (u < 0 || u > 1 || v < 0 || v > 1) continue;

            const px = Math.floor(u * resolution);
            const pz = Math.floor(v * resolution);
            const intensity = Math.min(1, count / 3);

            for (const sample of stamp) {
                const sx = px + sample.dx;
                const sz = pz + sample.dz;
                if (sx < 0 || sx >= resolution || sz < 0 || sz >= resolution) continue;
                const idx = sz * resolution + sx;
                const current = data[idx] / 255;
                const added = intensity * sample.weight;
                const value = Math.min(1, current + added);
                data[idx] = Math.floor(value * 255);
            }
        }

        this.forestMaskTexture.needsUpdate = true;
        this.forestMaskOrigin.set(origin.x, origin.z);
        this.forestMaskWorldSize = worldSize;
        this._hasForestMaskData = true;
    }

    _clearForestMask() {
        if (!this.forestMaskData || !this.forestMaskTexture) {
            return;
        }
        this.forestMaskData.fill(0);
        this.forestMaskTexture.needsUpdate = true;
        this._hasForestMaskData = false;
    }

    createGrassTexture() {
        // Load grass.jpg instead of generating a canvas texture
        const texture = new THREE.TextureLoader().load('../Images/grass.jpg');
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(6, 6);
        texture.colorSpace = THREE.SRGBColorSpace;

        // Store reference for seasonal updates
        this.grassTexture = texture;

        return texture;
    }
    
    createBlendingMaterial() {
        // Custom shader for texture blending
        const vertexShader = `
            varying vec2 vUv;
            varying vec3 vPosition;
            varying vec3 vWorldPosition;
            varying vec3 vColor;
            
            void main() {
                vUv = uv;
                vPosition = position;
                vColor = color; // Pass vertex color to fragment shader
                
                // Calculate world position
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        
        const fragmentShader = `
            precision mediump float;
            uniform vec3 cameraPosition;
            uniform float startDistance;
            uniform float endDistance;
            uniform sampler2D grassTexture;
            uniform float time;
            
            varying vec2 vUv;
            varying vec3 vPosition;
            varying vec3 vWorldPosition;
            varying vec3 vColor;
            
            void main() {
                // Calculate distance from camera
                float distance = length(cameraPosition - vWorldPosition);
                
                // Calculate blend factor (0 = chessboard, 1 = grass)
                float blendFactor = 0.0;
                if (distance <= startDistance) {
                    blendFactor = 0.1; // 10% grass at close distance
                } else if (distance >= endDistance) {
                    blendFactor = 1.0; // 100% grass at far distance
                } else {
                    // Smooth transition
                    blendFactor = 0.1 + 0.9 * ((distance - startDistance) / (endDistance - startDistance));
                }
                
                // Get chessboard color from vertex colors
                vec3 chessboardColor = vColor;
                
                // Get grass texture color
                vec2 grassUv = vWorldPosition.xz * 0.1; // Scale grass texture
                vec3 grassColor = texture2D(grassTexture, grassUv).rgb;
                
                // Add subtle animation to grass
                grassColor += sin(time * 0.5 + vWorldPosition.x * 0.1) * 0.05;
                grassColor += cos(time * 0.3 + vWorldPosition.z * 0.1) * 0.05;
                
                // Blend between chessboard and grass
                vec3 finalColor = mix(chessboardColor, grassColor, blendFactor);
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;
        
        const material = new THREE.ShaderMaterial({
            uniforms: {
                cameraPosition: { value: new THREE.Vector3() },
                startDistance: { value: this.startDistance },
                endDistance: { value: this.endDistance },
                grassTexture: { value: this.grassTexture },
                time: { value: 0.0 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            vertexColors: true,
            transparent: false
        });
        
        return material;
    }
    
    createBiomeTexture() {
        // No longer needed — biome color is computed per-vertex in the shader
        return null;
    }
    
    createShaderMaterial() {
        // Reuse cached material so uniform updates affect all meshes using it
        if (this.shaderMaterial) {
            return this.shaderMaterial;
        }
        const vertexShader = `
            #include <common>
            #include <fog_pars_vertex>
            uniform float uWaterLevel;
            uniform float uBiomeWaterLevel;
            uniform float uTime;
            varying vec3 vWorldPosition;
            varying vec3 vOriginalWorldPosition;
            varying vec3 vBiomeColor;
            varying vec2 vUv;
            varying float vDeformFactor;
            varying float vForestBiomeWeight;
            varying vec2 vForestMaskUv;
            varying float vBeachBiomeWeight;
            varying float vLowlandWeight;
            varying float vGrasslandWeight;
            varying float vMountainWeight;
            varying vec3 vWorldNormal;
            varying float vTerrainCliff;

            attribute float terrainCliff;

            uniform vec3 uSeasonalGrassColor;
            uniform vec2 uForestMaskOrigin;
            uniform float uForestMaskWorldSize;

            // Spherical deformation uniforms
            uniform float uSphereRadius;
            uniform float uCameraHeight;
            uniform float uDeformStartHeight;
            uniform float uDeformEndHeight;
            uniform float uEnableSpherical;
            uniform vec3 uCameraWorldPos;
            uniform float uDebugForceSpherical;
            uniform float uCurvatureScale;

            // Biome edge blending uniforms
            uniform float uBiomeEdgeA;
            uniform float uBiomeEdgeB;
            uniform float uBiomeEdgeMode;
            uniform float uBiomeEdgeScale;
            uniform float uBiomeEdgeStrength;
            uniform float uBiomeSplatterScale;
            uniform float uBiomeSplatterAmount;
            uniform float uBiomeEdgeSplatterMix;

            // Biome patch noise uniforms
            uniform float uBiomePatchScale;
            uniform float uBiomePatchStrength;
            uniform float uBiomePatchSeed;

            // Biome palette uniforms
            uniform vec3 uBiomeColors[8];
            uniform float uBiomeThresholds[7];

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }
            
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

            float fbm(vec2 p) {
                float v = 0.0, a = 0.5;
                vec2 shift = vec2(100.0);
                for (int i = 0; i < 4; i++) {
                    v += a * noise(p);
                    p = p * 2.0 + shift;
                    a *= 0.5;
                }
                return v;
            }

            float gBeachBiomeWeight;
            float gLowlandWeight;
            float gGrasslandWeight;
            float gMountainWeight;

            vec4 getBiomeColor(float height, vec2 worldXZ) {
                float blend = 0.5;
                float patchNoise = fbm(worldXZ * uBiomePatchScale + vec2(uBiomePatchSeed));
                float h = height - uBiomeWaterLevel + patchNoise * uBiomePatchStrength;
                float tideOffset = uWaterLevel - uBiomeWaterLevel;

                float t1 = uBiomeThresholds[0] + tideOffset;
                float t2 = uBiomeThresholds[1] + tideOffset;
                float t3 = uBiomeThresholds[2] + tideOffset;
                float t4 = uBiomeThresholds[3];
                float t5 = uBiomeThresholds[4];
                float t6 = uBiomeThresholds[5];
                float t7 = uBiomeThresholds[6];

                int mode = int(uBiomeEdgeMode);
                if (mode == 2) {
                    int a = int(uBiomeEdgeA);
                    int b = int(uBiomeEdgeB);
                    int low  = a < b ? a : b;
                    int high = a < b ? b : a;

                    float edgeNoise = fbm(worldXZ * uBiomeEdgeScale) * uBiomeEdgeStrength;
                    float splatter  = smoothstep(0.3, 0.7, fbm(worldXZ * uBiomeSplatterScale)) * uBiomeSplatterAmount;
                    float mask      = mix(edgeNoise, splatter, uBiomeEdgeSplatterMix);

                    if (0 >= low && 0 < high) t1 += mask;
                    if (1 >= low && 1 < high) t2 += mask;
                    if (2 >= low && 2 < high) t3 += mask;
                    if (3 >= low && 3 < high) t4 += mask;
                    if (4 >= low && 4 < high) t5 += mask;
                    if (5 >= low && 5 < high) t6 += mask;
                    if (6 >= low && 6 < high) t7 += mask;
                }

                float w1, w2, w3, w4, w5, w6, w7;
                if (mode == 1) {
                    int a = int(uBiomeEdgeA);
                    int b = int(uBiomeEdgeB);
                    int low  = a < b ? a : b;
                    int high = a < b ? b : a;

                    w1 = (0 >= low && 0 < high) ? step(t1, h) : smoothstep(t1 - blend, t1 + blend, h);
                    w2 = (1 >= low && 1 < high) ? step(t2, h) : smoothstep(t2 - blend, t2 + blend, h);
                    w3 = (2 >= low && 2 < high) ? step(t3, h) : smoothstep(t3 - blend, t3 + blend, h);
                    w4 = (3 >= low && 3 < high) ? step(t4, h) : smoothstep(t4 - blend, t4 + blend, h);
                    w5 = (4 >= low && 4 < high) ? step(t5, h) : smoothstep(t5 - blend, t5 + blend, h);
                    w6 = (5 >= low && 5 < high) ? step(t6, h) : smoothstep(t6 - blend, t6 + blend, h);
                    w7 = (6 >= low && 6 < high) ? step(t7, h) : smoothstep(t7 - blend, t7 + blend, h);
                } else {
                    w1 = smoothstep(t1 - blend, t1 + blend, h);
                    w2 = smoothstep(t2 - blend, t2 + blend, h);
                    w3 = smoothstep(t3 - blend, t3 + blend, h);
                    w4 = smoothstep(t4 - blend, t4 + blend, h);
                    w5 = smoothstep(t5 - blend, t5 + blend, h);
                    w6 = smoothstep(t6 - blend, t6 + blend, h);
                    w7 = smoothstep(t7 - blend, t7 + blend, h);
                }

                // Compute individual biome weights
                float deepW      = 1.0 - w1;
                float shallowW   = w1 * (1.0 - w2);
                float beachW     = w2 * (1.0 - w3);
                float lowlandW   = w3 * (1.0 - w4);
                float grasslandW = w4 * (1.0 - w5);
                float forestW    = w5 * (1.0 - w6);
                float mountainW  = w6 * (1.0 - w7);
                float snowW      = w7;

                vec3 color = uBiomeColors[0] * deepW + uBiomeColors[1] * shallowW + uBiomeColors[2] * beachW
                     + uBiomeColors[3] * lowlandW + uBiomeColors[4] * grasslandW + uBiomeColors[5] * forestW
                     + uBiomeColors[6] * mountainW + uBiomeColors[7] * snowW;
                gBeachBiomeWeight = beachW;
                gLowlandWeight = lowlandW;
                gGrasslandWeight = grasslandW;
                gMountainWeight = mountainW;
                return vec4(color, forestW);
            }

            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                vOriginalWorldPosition = worldPosition.xyz;
                vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                vTerrainCliff = terrainCliff;
                // Compute UVs from world position so noise/texture stays locked to world coordinates
                vUv = worldPosition.xz * 0.15;

                vec4 biomeInfo = getBiomeColor(vWorldPosition.y, vWorldPosition.xz);
                vBiomeColor = biomeInfo.rgb;
                vForestBiomeWeight = biomeInfo.a;
                vBeachBiomeWeight = clamp(gBeachBiomeWeight, 0.0, 1.0);
                vLowlandWeight = gLowlandWeight;
                vGrasslandWeight = gGrasslandWeight;
                vMountainWeight = gMountainWeight;

                // Compute final world position including optional spherical curvature
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vec3 finalWorld = wp.xyz;
                vDeformFactor = 0.0;

                if (uEnableSpherical > 0.5 && uSphereRadius > 0.0) {
                    // Deformation factor: 0 = flat, 1 = fully curved
                    float deformFactor;
                    if (uDebugForceSpherical > 0.5) {
                        deformFactor = 1.0;
                    } else {
                        float heightRange = max(0.0001, uDeformEndHeight - uDeformStartHeight);
                        float t = clamp((uCameraHeight - uDeformStartHeight) / heightRange, 0.0, 1.0);
                        deformFactor = t * t * (3.0 - 2.0 * t); // smoothstep
                    }

                    // Curvature scale amplifies the spherical drop (higher = tighter sphere = more curvature)
                    float effectiveRadius = uSphereRadius / max(uCurvatureScale, 0.0001);

                    // World-centered sphere: terrain sits ON the sphere surface
                    // Sphere center is directly below the camera, at terrain height minus radius
                    float terrainHeightAtCamera = uCameraWorldPos.y - uCameraHeight;
                    vec3 sphereCenter = vec3(uCameraWorldPos.x, terrainHeightAtCamera - effectiveRadius, uCameraWorldPos.z);

                    // Horizontal offset from sphere center
                    vec2 dXZ = wp.xz - sphereCenter.xz;
                    float horizDist = length(dXZ);
                    vec2 dir = horizDist > 0.001 ? normalize(dXZ) : vec2(0.0);

                    // Angle on the sphere surface from the north pole
                    float arcAngle = clamp(horizDist / effectiveRadius, 0.0, 3.14159);
                    float sinA = sin(arcAngle);
                    float cosA = cos(arcAngle);

                    vec3 flatPos = wp.xyz;
                    vec3 spherePos;
                    // Map flat terrain XZ onto sphere surface XZ
                    spherePos.xz = sphereCenter.xz + dir * effectiveRadius * sinA;
                    // Sphere surface height at this angle
                    spherePos.y = sphereCenter.y + effectiveRadius * cosA;

                    // Blend between flat plane and spherical surface
                    finalWorld = mix(flatPos, spherePos, deformFactor);

                    // Update texture coords so checkerboard/grass shrink with the mesh
                    vWorldPosition = finalWorld;
                    vUv = finalWorld.xz * 0.15;
                    vDeformFactor = deformFactor;
                }

                float maskDenom = max(uForestMaskWorldSize, 0.0001);
                vForestMaskUv = (vWorldPosition.xz - uForestMaskOrigin) / maskDenom;

                vec4 mvPosition = viewMatrix * vec4(finalWorld, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }
        `;

        const seasonalGrassColor = this.getSeasonalGrassColor();
        console.log('[TextureBlending] Creating shader material with seasonal grass color:', seasonalGrassColor);

        const fragmentShader = `
        precision highp float;
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 uCursorPos;
        uniform float uStartDistance;
        uniform float uEndDistance;
        uniform float uTime;
        uniform float uWaterLevel;
        uniform float uShoreWaterLevel;
        uniform float uBiomeWaterLevel;
        uniform float uGrassUvScale;
        uniform float uGrassWindMultiplier;
        uniform vec2 uWindDirection;
        uniform float uWindStrength;
        uniform vec3 uGrassColorTint;
        uniform vec3 uGrassColorLight;
        uniform float uGrassBlendAmount;
        uniform float uGrassSharpness;
        uniform float uGrassWindSpeed;
        uniform float uGrassPhaseScale;
        uniform float uGrassBladeStretchX;
        uniform float uGrassBladeStretchY;
        uniform float uGrassMicroAmount;
        uniform float uGrassType[8];
        uniform float uSunIntensity;
        uniform vec3 uSpotPos;
        uniform vec3 uSpotColor;
        uniform float uSpotIntensity;
        uniform float uSpotRadius;
        uniform vec3 uFadeCenter;
        uniform float uFadeInnerRadius;
        uniform float uFadeOuterRadius;
        uniform float uFadeEnabled;
        uniform float uCheckerScale;
        uniform float uCheckerFadeStrength;
        uniform vec3 uPlanetCenter;
        uniform float uSphereRadius;
        uniform sampler2D uForestMaskTexture;
        uniform sampler2D uForestFloorTexture;
        uniform float uForestBlendMax;
        uniform float uForestMaskStrength;
        uniform float uForestBiomeBias;
        uniform float uForestTexScale;
        uniform float uForestNoiseScale;
        uniform float uForestEnabled;
        uniform float uForestBaseInfluence;
        uniform float uBeachEnabled;
        uniform vec3 uBeachSandColor;
        uniform vec3 uBeachStoneColor;
        uniform vec3 uBeachWetColor;
        uniform float uBeachStoneAmount;
        uniform float uBeachStoneScale;
        uniform float uBeachWetWidth;
        uniform float uBeachWetIntensity;
        uniform float uWetFadeSpeed;
        uniform float uWetFadeDelay;
        uniform float uBeachShrubAmount;
        uniform vec3 uBeachShrubColor;
        uniform float uBeachBiomeBias;
        uniform float uBeachHeightBlend;
        uniform float uDebugBeachState;

        uniform float uTerrainOpacity;

        varying vec3 vWorldPosition;
        varying vec3 vOriginalWorldPosition;
        varying vec3 vBiomeColor;
        varying vec2 vUv;
        varying float vDeformFactor;
        varying float vForestBiomeWeight;
        varying vec2 vForestMaskUv;
        varying float vBeachBiomeWeight;
        varying float vLowlandWeight;
        varying float vGrasslandWeight;
        varying float vMountainWeight;
        varying vec3 vWorldNormal;
        varying float vTerrainCliff;

        // Environmental simulation uniforms
        uniform float uEnvPressure;
        uniform float uEnvHumidity;
        uniform float uEnvTemperature;

        // Cliff uniforms
        uniform float uCliffEnabled;
        uniform float uCliffThreshold;
        uniform float uCliffBlendWidth;
        uniform float uCliffRubbleAmount;
        uniform float uCliffStrataScale;
        uniform float uCliffStrataAmount;
        uniform float uCliffDarkenAmount;
        uniform vec3 uCliffBaseColor;
        uniform vec3 uCliffLightColor;
        uniform vec3 uCliffMossColor;
        uniform float uCliffMossAmount;
        uniform float uCliffDebug;

        // Distance blur uniforms
        uniform float uBlurEnabled;
        uniform float uBlurStart;
        uniform float uBlurEnd;
        uniform float uBlurStrength;

        // Mipmap bias uniforms
        uniform float uMipBiasEnabled;
        uniform float uMipBiasStart;
        uniform float uMipBiasEnd;
        uniform float uMipBiasStrength;

        // Custom fog uniforms
        uniform float uFogGradientEnabled;
        uniform float uFogGradientExponent;
        uniform float uFogGradientBias;
        uniform float uFogDensity;
        uniform vec3 uFogColors[5];
        uniform float uFogStops[5];
        uniform int uFogColorCount;

        vec3 getGradientFogColor(float t) {
            vec3 result = uFogColors[0];
            if (uFogColorCount <= 1) return result;
            float s0 = uFogStops[0];
            float s1 = uFogStops[1];
            float blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
            result = mix(uFogColors[0], uFogColors[1], blend);
            if (uFogColorCount >= 3) {
                s0 = uFogStops[1];
                s1 = uFogStops[2];
                if (t >= s0) {
                    blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                    result = mix(uFogColors[1], uFogColors[2], blend);
                }
            }
            if (uFogColorCount >= 4) {
                s0 = uFogStops[2];
                s1 = uFogStops[3];
                if (t >= s0) {
                    blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                    result = mix(uFogColors[2], uFogColors[3], blend);
                }
            }
            if (uFogColorCount >= 5) {
                s0 = uFogStops[3];
                s1 = uFogStops[4];
                if (t >= s0) {
                    blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                    result = mix(uFogColors[3], uFogColors[4], blend);
                }
            }
            return result;
        }

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

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

        float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            vec2 shift = vec2(100.0);
            for (int i = 0; i < 4; i++) {
                v += a * noise(p);
                p = p * 2.0 + shift;
                a *= 0.5;
            }
            return v;
        }

        void grassPalette(float typeId, out vec3 baseColor, out vec3 highlightColor, out float patchContrast) {
            if (typeId < 0.5) {
                baseColor = vec3(0.0);
                highlightColor = vec3(0.0);
                patchContrast = 0.0;
                return;
            }
            if (typeId < 1.5) {
                // Meadow
                baseColor = vec3(0.20, 0.46, 0.18);
                highlightColor = vec3(0.44, 0.74, 0.32);
                patchContrast = 0.9;
                return;
            }
            if (typeId < 2.5) {
                // Prairie
                baseColor = vec3(0.32, 0.45, 0.18);
                highlightColor = vec3(0.78, 0.72, 0.34);
                patchContrast = 0.8;
                return;
            }
            if (typeId < 3.5) {
                // Alpine
                baseColor = vec3(0.13, 0.36, 0.17);
                highlightColor = vec3(0.42, 0.62, 0.36);
                patchContrast = 0.7;
                return;
            }
            if (typeId < 4.5) {
                // Marsh
                baseColor = vec3(0.26, 0.35, 0.19);
                highlightColor = vec3(0.52, 0.57, 0.27);
                patchContrast = 1.05;
                return;
            }
            // Dry Steppe
            baseColor = vec3(0.43, 0.38, 0.18);
            highlightColor = vec3(0.78, 0.67, 0.33);
            patchContrast = 0.85;
        }

        void accumulateGrassLayer(float typeId, float biomeWeight, float biomeSeed, float grassDetail, vec3 worldPos, vec3 tint, vec3 lightColor, inout vec3 accum, inout float maskAccum) {
            if (typeId < 0.5 || biomeWeight <= 0.0001) return;
            vec3 baseColor;
            vec3 highlightColor;
            float patchContrast;
            grassPalette(typeId, baseColor, highlightColor, patchContrast);
            if (patchContrast <= 0.0) return;

            float noiseScale = 0.35 + biomeSeed * 0.03;
            float patchNoise = fbm(worldPos.xz * noiseScale + vec2(biomeSeed * 11.3 + 19.0));
            float patchVariant = fract(patchNoise * 3.731 + biomeSeed * 0.37);
            float patchMask = smoothstep(0.25, 0.85, patchNoise * patchContrast);
            vec3 patchColor = mix(baseColor, highlightColor, clamp(0.25 + patchVariant * 0.6 + grassDetail * 0.2, 0.0, 1.0));
            patchColor = mix(patchColor, tint, 0.25);
            patchColor = mix(patchColor, lightColor, 0.2 * grassDetail);
            float weight = biomeWeight * patchMask;
            accum += patchColor * weight;
            maskAccum += weight;
        }

        // ===== CLIFF / SLOPE MATERIAL SYSTEM =====

        // Slope steepness: 0=flat ground, 1=vertical cliff
        float getCliffMask(float upness) {
            float halfW = uCliffBlendWidth * 0.5;
            float start = max(0.0, uCliffThreshold - halfW);
            float end   = min(1.0, uCliffThreshold + halfW);
            return 1.0 - smoothstep(start, end, upness);
        }

        // Horizontal rock strata bands using fbm
        float getCliffStrata(vec3 worldPos, float scale, float amount) {
            float band = sin(worldPos.y * scale + fbm(worldPos.xz * 0.3) * 2.0);
            return smoothstep(-0.3, 0.3, band) * amount;
        }

        // Procedural triplanar cliff color with rubble and strata
        vec3 getCliffColor(vec3 worldPos, vec3 worldNormal, float steepness) {
            vec2 cliffCoord = worldPos.xz + worldPos.yx * 0.07;

            // Base rock variation noise
            float rockNoise = fbm(cliffCoord * 0.35);
            float detailNoise = fbm(cliffCoord * 1.2 + vec2(7.0, 13.0));

            // Strata banding
            float strata = getCliffStrata(worldPos, uCliffStrataScale, uCliffStrataAmount);

            // Base rock with noise variation
            vec3 rockColor = mix(uCliffBaseColor, uCliffLightColor, rockNoise * 0.5 + 0.25);

            // Add strata bands (darker layers)
            rockColor = mix(rockColor, uCliffBaseColor * 0.65, strata);

            // Loose rubble / scree — high freq noise on steep faces
            float rubble = fbm(cliffCoord * 2.5 + vec2(31.0, 47.0));
            rubble = smoothstep(0.35, 0.65, rubble);
            rockColor = mix(rockColor, uCliffLightColor * 0.80, rubble * uCliffRubbleAmount * steepness);

            // Micro detail noise
            rockColor += (detailNoise - 0.5) * 0.04;

            // Moss / lichen on less-vertical or north-ish facing parts
            float mossNoise = fbm(cliffCoord * 0.8 + vec2(101.0, 53.0));
            float mossMask = (1.0 - steepness * 0.6) * mossNoise * uCliffMossAmount;
            rockColor = mix(rockColor, uCliffMossColor, clamp(mossMask, 0.0, 1.0));

            // Darken very vertical faces (self-shadowing feel)
            rockColor *= mix(1.0, 1.0 - uCliffDarkenAmount, steepness * steepness);

            return rockColor;
        }

        void main() {
            // Use cursor position instead of camera position for fade
            float distance = length(uCursorPos - vWorldPosition);

            // Blend factor: 0 = checkerboard (near cursor), 1 = biome (far from cursor)
            float blendFactor = 0.0;
            if (distance <= uStartDistance) {
                blendFactor = 0.0;  // Full checkerboard near cursor
            } else if (distance >= uEndDistance) {
                blendFactor = 1.0;  // Full biome far from cursor
            } else {
                blendFactor = (distance - uStartDistance) / (uEndDistance - uStartDistance);
            }

            // Generate planar checkerboard from original undeformed world position
            float planarCheckerX = floor(vOriginalWorldPosition.x * uCheckerScale);
            float planarCheckerZ = floor(vOriginalWorldPosition.z * uCheckerScale);
            float planarChecker = mod(planarCheckerX + planarCheckerZ, 2.0);

            // Generate spherical checkerboard by projecting onto planet sphere surface
            vec3 toPlanet = vOriginalWorldPosition - uPlanetCenter;
            vec3 sphereDir = normalize(toPlanet);
            vec3 sphereSurface = uPlanetCenter + uSphereRadius * sphereDir;
            float sphericalCheckerX = floor(sphereSurface.x * uCheckerScale);
            float sphericalCheckerZ = floor(sphereSurface.z * uCheckerScale);
            float sphericalChecker = mod(sphericalCheckerX + sphericalCheckerZ, 2.0);

            // Blend between planar and spherical checkerboard based on deformation factor
            float checker = mix(planarChecker, sphericalChecker, vDeformFactor * vDeformFactor);
            vec3 chessboardColor = vec3(checker);

            // Add subtle variation to biome color
            float variation = sin(vWorldPosition.x * 0.2 + uTime * 0.5)
                                * cos(vWorldPosition.z * 0.2 + uTime * 0.3) * 0.05;
            vec3 biomeColor = vBiomeColor + vec3(variation);

            // Environmental simulation color modulation
            // High pressure + high humidity -> stormy darkening
            // Low pressure + high humidity -> rain blue shift
            // High temperature -> warm shift, low -> cool shift
            float stormFactor = uEnvPressure * uEnvHumidity;
            float rainFactor = (1.0 - uEnvPressure) * uEnvHumidity;
            vec3 stormTint = vec3(0.55, 0.55, 0.60);
            vec3 rainTint = vec3(0.75, 0.80, 0.90);
            vec3 warmTint = vec3(1.05, 0.95, 0.80);
            vec3 coolTint = vec3(0.85, 0.90, 1.05);

            biomeColor = mix(biomeColor, stormTint, stormFactor * 0.25);
            biomeColor = mix(biomeColor, rainTint, rainFactor * 0.20);
            if (uEnvTemperature > 0.6) {
                biomeColor = mix(biomeColor, warmTint, (uEnvTemperature - 0.6) * 0.35);
            } else if (uEnvTemperature < 0.4) {
                biomeColor = mix(biomeColor, coolTint, (0.4 - uEnvTemperature) * 0.30);
            }
            biomeColor = clamp(biomeColor, 0.0, 1.0);

            // Blend between checkerboard (near) and biome (far) with adjustable checker visibility
            float attenuatedBlend = mix(1.0, blendFactor, clamp(uCheckerFadeStrength, 0.0, 1.0));
            vec3 finalColor = mix(chessboardColor, biomeColor, attenuatedBlend);

            // ==================== CLIFF SYSTEM ====================
            if (uCliffEnabled > 0.5) {
                float cliffMask = getCliffMask(vTerrainCliff);
                if (cliffMask > 0.001) {
                    vec3 cliffColor = getCliffColor(vWorldPosition, vWorldNormal, cliffMask);
                    finalColor = mix(finalColor, cliffColor, cliffMask * blendFactor);
                }
                if (uCliffDebug > 0.5) {
                    gl_FragColor = vec4(vec3(cliffMask), 1.0);
                    #include <fog_fragment>
                    return;
                }
            }
            // ==================== END CLIFF SYSTEM ====================

            // ==================== BEACH SYSTEM ====================
            if (uBeachEnabled > 0.5) {
                float biomeBeachMask = pow(clamp(vBeachBiomeWeight, 0.0, 1.0), max(uBeachBiomeBias, 0.0001));
                float heightMask = smoothstep(-2.8, -2.2, vWorldPosition.y)
                                * (1.0 - smoothstep(0.8, 1.5, vWorldPosition.y));
                float blendMix = clamp(uBeachHeightBlend, 0.0, 1.0);
                float beachMask = biomeBeachMask * mix(1.0, heightMask, blendMix);

                if (beachMask > 0.01) {
                    // Base sand/stone noise
                    float beachNoise = fbm(vWorldPosition.xz * uBeachStoneScale);
                    float beachNoise2 = fbm(vWorldPosition.xz * uBeachStoneScale * 2.3 + vec2(31.0));

                    // Stone patches (rougher, darker areas) — more stone toward top of beach
                    float stoneThreshold = 0.42 + uBeachStoneAmount * 0.35;
                    float stoneMask = smoothstep(stoneThreshold - 0.12, stoneThreshold + 0.12, beachNoise);
                    // Stone concentrates at upper beach
                    float upperBeach = smoothstep(-2.0, 0.8, vWorldPosition.y);
                    stoneMask *= upperBeach;

                    // Mix sand and stone with secondary noise for variety
                    float stoneVariety = smoothstep(0.35, 0.65, beachNoise2);
                    vec3 beachColor = mix(uBeachSandColor, uBeachStoneColor, stoneMask * stoneVariety);

                    // High tide line: wet sand just above shore water level (lags actual tide)
                    float waterDist = vWorldPosition.y - uShoreWaterLevel;
                    float wetDist = max(0.0, waterDist);
                    float wetMask = (1.0 - smoothstep(uWetFadeDelay, uWetFadeDelay + uWetFadeSpeed, wetDist)) * uBeachWetIntensity;
                    // Break up wet line with noise
                    float wetNoise = fbm(vWorldPosition.xz * 3.0 + vec2(7.0));
                    wetMask *= (0.7 + 0.3 * wetNoise);
                    beachColor = mix(beachColor, uBeachWetColor, wetMask);

                    // Hardy shrubbery at top of beach
                    float shrubNoise = fbm(vWorldPosition.xz * uBeachStoneScale * 2.5 + vec2(50.0));
                    float shrubNoise2 = fbm(vWorldPosition.xz * uBeachStoneScale * 5.0 + vec2(120.0));
                    float shrubThreshold = 0.52 + uBeachShrubAmount * 0.28;
                    float shrubMask = smoothstep(shrubThreshold - 0.1, shrubThreshold + 0.1, shrubNoise);
                    // Clusters from second noise octave
                    shrubMask *= smoothstep(0.3, 0.7, shrubNoise2);
                    // Only at top of beach
                    float topOfBeach = smoothstep(-0.5, 1.0, vWorldPosition.y);
                    shrubMask *= topOfBeach;
                    beachColor = mix(beachColor, uBeachShrubColor, shrubMask * uBeachShrubAmount);

                    // Debug: show beach mask
                    if (uDebugBeachState > 0.5) {
                        gl_FragColor = vec4(vec3(beachMask), 1.0);
                        #include <fog_fragment>
                        return;
                    }

                    // Blend beach detail into final color
                    finalColor = mix(finalColor, beachColor, beachMask * blendFactor);
                }
            }
            // ==================== END BEACH SYSTEM ====================

            // Procedural wind-animated grass detail
            vec2 windDir = normalize(uWindDirection);
            float windPhase = (vWorldPosition.x * 0.3 + vWorldPosition.z * 0.7) * uGrassPhaseScale;
            vec2 windOffset = windDir * sin(uTime * uGrassWindSpeed + windPhase) * uWindStrength * uGrassWindMultiplier * 0.15;

            vec2 grassUv = vWorldPosition.xz * uGrassUvScale + windOffset;

            // Anisotropic fbm — stretch UVs vertically to create blade-like streaks
            vec2 bladeUv = grassUv * vec2(uGrassBladeStretchX, uGrassBladeStretchY);
            float bladeNoise = fbm(bladeUv);
            float edgeLow = 0.35 + uGrassSharpness * 0.12;
            float edgeHigh = 0.65 - uGrassSharpness * 0.12;
            float grassDetail = smoothstep(edgeLow, edgeHigh, bladeNoise);

            // Micro detail layer for richness
            vec2 microUv = grassUv * vec2(12.0, 48.0);
            float microNoise = smoothstep(0.30, 0.70, fbm(microUv));
            grassDetail = mix(grassDetail, microNoise, uGrassMicroAmount);

            float beachW = vBeachBiomeWeight;
            float lowlandW = vLowlandWeight;
            float grasslandW = vGrasslandWeight;
            float forestW = vForestBiomeWeight;
            float mountainW = vMountainWeight;

            vec3 grassAccum = vec3(0.0);
            float grassMaskAccum = 0.0;
            accumulateGrassLayer(uGrassType[2], beachW, 2.0, grassDetail, vWorldPosition, uGrassColorTint, uGrassColorLight, grassAccum, grassMaskAccum);
            accumulateGrassLayer(uGrassType[3], lowlandW, 3.0, grassDetail, vWorldPosition, uGrassColorTint, uGrassColorLight, grassAccum, grassMaskAccum);
            accumulateGrassLayer(uGrassType[4], grasslandW, 4.0, grassDetail, vWorldPosition, uGrassColorTint, uGrassColorLight, grassAccum, grassMaskAccum);
            accumulateGrassLayer(uGrassType[5], forestW, 5.0, grassDetail, vWorldPosition, uGrassColorTint, uGrassColorLight, grassAccum, grassMaskAccum);
            accumulateGrassLayer(uGrassType[6], mountainW, 6.0, grassDetail, vWorldPosition, uGrassColorTint, uGrassColorLight, grassAccum, grassMaskAccum);

            if (grassMaskAccum > 0.0001) {
                vec3 blendedGrass = grassAccum / grassMaskAccum;
                float mask = clamp(grassMaskAccum * blendFactor * uGrassBlendAmount, 0.0, 1.0);
                finalColor = mix(finalColor, blendedGrass, mask);
            }
            finalColor *= uSunIntensity;

            // Spotlight contribution (radial falloff from ground projection)
            float spotDist = length(vWorldPosition.xz - uSpotPos.xz);
            float spotFalloff = 1.0 - smoothstep(0.0, uSpotRadius, spotDist);
            finalColor += uSpotColor * uSpotIntensity * spotFalloff;

            // ==================== FOREST FLOOR SYSTEM ====================
            if (uForestEnabled > 0.5) {
                float maskSample = texture2D(uForestMaskTexture, vForestMaskUv).r;
                float forestMask = pow(clamp(maskSample, 0.0, 1.0), uForestMaskStrength);
                float biomeWeight = pow(clamp(vForestBiomeWeight, 0.0, 1.0), uForestBiomeBias);
                float forestFactor = mix(uForestBaseInfluence, 1.0, forestMask) * biomeWeight;
                if (forestFactor > 0.001) {
                    float forestNoise = fbm(vWorldPosition.xz * uForestNoiseScale);
                    forestFactor *= mix(0.7, 1.0, forestNoise);
                    vec2 forestUv = vWorldPosition.xz * uForestTexScale;
                    // Mipmap distance bias (simulated via multi-tap blur — no WebGL extension needed)
                    float blurOffset = 0.0;
                    if (uMipBiasEnabled > 0.5) {
                        float forestDist = length(vWorldPosition.xz - cameraPosition.xz);
                        float mipLevel = smoothstep(uMipBiasStart, uMipBiasEnd, forestDist) * uMipBiasStrength;
                        blurOffset = mipLevel * 0.015;
                    }
                    vec3 forestColor;
                    if (blurOffset > 0.0001) {
                        forestColor  = texture2D(uForestFloorTexture, forestUv + vec2( blurOffset,  blurOffset)).rgb;
                        forestColor += texture2D(uForestFloorTexture, forestUv + vec2(-blurOffset,  blurOffset)).rgb;
                        forestColor += texture2D(uForestFloorTexture, forestUv + vec2( blurOffset, -blurOffset)).rgb;
                        forestColor += texture2D(uForestFloorTexture, forestUv + vec2(-blurOffset, -blurOffset)).rgb;
                        forestColor *= 0.25;
                    } else {
                        forestColor = texture2D(uForestFloorTexture, forestUv).rgb;
                    }
                    finalColor = mix(finalColor, forestColor, forestFactor * uForestBlendMax * blendFactor);
                }
            }
            // ==================== END FOREST FLOOR SYSTEM ====================

            // Distance blur / softening
            float camDist = length(cameraPosition - vWorldPosition);
            float blurFactor = 0.0;
            if (uBlurEnabled > 0.5) {
                blurFactor = smoothstep(uBlurStart, uBlurEnd, camDist) * uBlurStrength;
            }
            // Legacy distance softening (always active, now scaled by blur params when enabled)
            float legacySoft = smoothstep(40.0, 80.0, camDist);
            float softenFactor = max(blurFactor, legacySoft * 0.3);

            vec3 gray = vec3(dot(finalColor, vec3(0.299, 0.587, 0.114)));
            finalColor = mix(finalColor, gray, softenFactor * 0.55);
            finalColor = mix(finalColor, vec3(0.5), softenFactor * 0.25);

            float hfNoise = fract(sin(dot(vWorldPosition.xz, vec2(17.13, 37.91))) * 43758.5453);
            finalColor += (hfNoise - 0.5) * softenFactor * 0.03;

            // Circular transparency fade: full opacity inside inner radius, fade to transparent at outer radius
            float fadeDist = length(uFadeCenter.xz - vWorldPosition.xz);
            float fadeAlpha = mix(1.0, smoothstep(uFadeOuterRadius, uFadeInnerRadius, fadeDist), uFadeEnabled);

            gl_FragColor = vec4(finalColor, fadeAlpha * uTerrainOpacity);

            // Custom enhanced fog (replaces built-in #include <fog_fragment>)
            float fogDist = length(vWorldPosition - cameraPosition);
            float fogFactor;
            vec3 fogColorSample = fogColor;
            if (uFogGradientEnabled > 0.5) {
                float normDist = (fogDist - fogNear) / max(fogFar - fogNear, 0.001);
                normDist = clamp(normDist + uFogGradientBias, 0.0, 1.0);
                fogFactor = 1.0 - pow(normDist, uFogGradientExponent) * uFogDensity;
                fogColorSample = getGradientFogColor(normDist);
            } else {
                fogFactor = (fogFar - fogDist) / max(fogFar - fogNear, 0.001);
                fogFactor *= uFogDensity;
            }
            fogFactor = clamp(fogFactor, 0.0, 1.0);
            gl_FragColor.rgb = mix(fogColorSample, gl_FragColor.rgb, fogFactor);
        }
        `;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uCursorPos: { value: new THREE.Vector3() },
                uStartDistance: { value: this.startDistance },
                uEndDistance: { value: this.endDistance },
                uTime: { value: 0.0 },
                uWaterLevel: { value: -1.5 },
                uShoreWaterLevel: { value: -1.5 },
                uBiomeWaterLevel: { value: -1.5 },
                uSunIntensity: { value: 1.0 },
                uSpotPos: { value: new THREE.Vector3() },
                uSpotColor: { value: new THREE.Color(1, 1, 1) },
                uSpotIntensity: { value: 0.0 },
                uSpotRadius: { value: 5.0 },
                uWindDirection: { value: new THREE.Vector2(1, 0) },
                uWindStrength: { value: 0.3 },
                uGrassUvScale: { value: 0.15 },
                uGrassWindMultiplier: { value: 1.0 },
                uGrassColorTint: { value: new THREE.Color('#3a8c2e') },
                uGrassColorLight: { value: new THREE.Color('#59a638') },
                uGrassBlendAmount: { value: 0.55 },
                uGrassSharpness: { value: 0.6 },
                uGrassWindSpeed: { value: 1.2 },
                uGrassPhaseScale: { value: 1.0 },
                uGrassBladeStretchX: { value: 4.0 },
                uGrassBladeStretchY: { value: 16.0 },
                uGrassMicroAmount: { value: 0.2 },
                uGrassType: { value: new Float32Array([0, 0, 0, 4, 1, 3, 5, 0]) },
                // Biome edge blending uniforms
                uBiomeEdgeA: { value: 3 },
                uBiomeEdgeB: { value: 4 },
                uBiomeEdgeMode: { value: 0 },
                uBiomeEdgeScale: { value: 0.3 },
                uBiomeEdgeStrength: { value: 1.0 },
                uBiomeSplatterScale: { value: 0.5 },
                uBiomeSplatterAmount: { value: 0.5 },
                uBiomeEdgeSplatterMix: { value: 0.5 },
                // Biome patch noise uniforms
                uBiomePatchScale: { value: 0.025 },
                uBiomePatchStrength: { value: 0.0 },
                uBiomePatchSeed: { value: 123.45 },
                // Biome palette uniforms
                uBiomeColors: { value: [
                    new THREE.Color(0.40, 0.60, 0.90),
                    new THREE.Color(0.70, 0.65, 0.50),
                    new THREE.Color(0.80, 0.75, 0.45),
                    new THREE.Color(0.35, 0.45, 0.15),
                    new THREE.Color(0.25, 0.55, 0.15),
                    new THREE.Color(0.10, 0.35, 0.10),
                    new THREE.Color(0.45, 0.40, 0.30),
                    new THREE.Color(0.85, 0.85, 0.85),
                ]},
                uBiomeThresholds: { value: [-1.5, -1.0, 2.5, 4.5, 11.5, 19.5, 26.5] },
                // Spherical deformation uniforms (defaults)
                uSphereRadius: { value: 180.0 },
                uCameraHeight: { value: 0.0 },
                uDeformStartHeight: { value: this.deformStartHeight },
                uDeformEndHeight: { value: this.deformEndHeight },
                uEnableSpherical: { value: 1.0 },
                uCameraWorldPos: { value: new THREE.Vector3(0, 0, 0) },
                uDebugForceSpherical: { value: 0.0 },
                uCurvatureScale: { value: 2.0 },
                // Fog uniforms (required when fog:true)
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 },
                // Circular transparency fade
                uFadeCenter: { value: new THREE.Vector3() },
                uFadeInnerRadius: { value: 24.0 },
                uFadeOuterRadius: { value: 31.0 },
                uFadeEnabled: { value: 1.0 },
                uCheckerFadeStrength: { value: this.checkerFadeStrength },
                // Dynamic checker scale
                uCheckerScale: { value: 1.0 },
                // Planet center for spherical checkerboard wrapping
                uPlanetCenter: { value: new THREE.Vector3(0, -180, 0) },
                uForestMaskTexture: { value: this.forestMaskTexture },
                uForestFloorTexture: { value: this.forestFloorTextures?.default || null },
                uForestMaskOrigin: { value: new THREE.Vector2(0, 0) },
                uForestMaskWorldSize: { value: 1.0 },
                uForestBlendMax: { value: this.forestBlendMax },
                uForestMaskStrength: { value: this.forestMaskStrength },
                uForestBiomeBias: { value: this.forestBiomeBias },
                uForestTexScale: { value: this.forestTexScale },
                uForestNoiseScale: { value: this.forestNoiseScale },
                uForestEnabled: { value: this.forestEnabled ? 1.0 : 0.0 },
                uForestBaseInfluence: { value: this.forestBaseInfluence },
                uTerrainOpacity: { value: 1.0 },
                // Beach system uniforms
                uBeachEnabled: { value: 1.0 },
                uBeachSandColor: { value: new THREE.Color(0.82, 0.76, 0.52) },
                uBeachStoneColor: { value: new THREE.Color(0.45, 0.42, 0.38) },
                uBeachWetColor: { value: new THREE.Color(0.60, 0.55, 0.38) },
                uBeachStoneAmount: { value: 0.6 },
                uBeachStoneScale: { value: 0.4 },
                uBeachWetWidth: { value: 1.2 },
                uBeachWetIntensity: { value: 0.7 },
                uWetFadeSpeed: { value: 0.5 },
                uWetFadeDelay: { value: 0.3 },
                uBeachShrubAmount: { value: 0.5 },
                uBeachShrubColor: { value: new THREE.Color(0.22, 0.42, 0.15) },
                uBeachUvScale: { value: 0.15 },
                uDebugBeachState: { value: 0.0 },
                uBeachBiomeBias: { value: 1.0 },
                uBeachHeightBlend: { value: 1.0 },
                // Cliff system uniforms
                uCliffEnabled: { value: this.cliffEnabled ? 1.0 : 0.0 },
                uCliffThreshold: { value: this.cliffThreshold },
                uCliffBlendWidth: { value: this.cliffBlendWidth },
                uCliffRubbleAmount: { value: this.cliffRubbleAmount },
                uCliffStrataScale: { value: this.cliffStrataScale },
                uCliffStrataAmount: { value: this.cliffStrataAmount },
                uCliffDarkenAmount: { value: this.cliffDarkenAmount },
                uCliffBaseColor: { value: this.cliffBaseColor },
                uCliffLightColor: { value: this.cliffLightColor },
                uCliffMossColor: { value: this.cliffMossColor },
                uCliffMossAmount: { value: this.cliffMossAmount },
                uCliffDebug: { value: this.cliffDebug ? 1.0 : 0.0 },
                // Environmental simulation uniforms
                uEnvPressure: { value: 0.5 },
                uEnvHumidity: { value: 0.5 },
                uEnvTemperature: { value: 0.5 },
                // Distance blur uniforms
                uBlurEnabled: { value: 0.0 },
                uBlurStart: { value: 20.0 },
                uBlurEnd: { value: 60.0 },
                uBlurStrength: { value: 1.0 },
                // Mipmap bias uniforms
                uMipBiasEnabled: { value: 0.0 },
                uMipBiasStart: { value: 15.0 },
                uMipBiasEnd: { value: 50.0 },
                uMipBiasStrength: { value: 2.0 },
                // Custom fog uniforms
                uFogGradientEnabled: { value: 0.0 },
                uFogGradientExponent: { value: 2.0 },
                uFogGradientBias: { value: 0.0 },
                uFogDensity: { value: 1.0 },
                uFogColors: { value: [
                    new THREE.Color('#808080'),
                    new THREE.Color('#606060'),
                    new THREE.Color('#404040'),
                    new THREE.Color('#303030'),
                    new THREE.Color('#202020')
                ]},
                uFogStops: { value: [0.0, 0.25, 0.5, 0.75, 1.0] },
                uFogColorCount: { value: 2 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            vertexColors: true,
            transparent: true,
            fog: true
        });

        this.shaderMaterial = material;
        return material;
    }

    
    updateShaderUniforms(cameraPosition, time, planetMapping) {
        // Update shader uniforms if shader material is being used
        if (!this.shaderMaterial) return;

        const mat = this.shaderMaterial.uniforms;

        // Use cursor position from board system instead of camera position
        const cursorPos = this.boardSystem.mouseWorldPosition || cameraPosition;
        mat.uCursorPos.value.copy(cursorPos);

        // Circular fade follows camera position
        if (mat.uFadeCenter) {
            mat.uFadeCenter.value.copy(cameraPosition);
        }
        if (mat.uFadeEnabled) {
            mat.uFadeEnabled.value = (this.fadeEnabled !== false) ? 1.0 : 0.0;
        }
        if (mat.uCheckerFadeStrength) {
            mat.uCheckerFadeStrength.value = this.checkerFadeStrength ?? 1.0;
        }
        // Dynamic circular fade: diameter fits inside terrain mesh, fade starts at 98% of radius
        if (mat.uFadeInnerRadius && mat.uFadeOuterRadius) {
            const fadeDiameter = this._getTerrainFadeDiameter();
            if (fadeDiameter > 0) {
                const outerRadius = fadeDiameter * 0.5;
                const innerRadius = outerRadius * 0.98;
                mat.uFadeOuterRadius.value = outerRadius;
                mat.uFadeInnerRadius.value = innerRadius;
            }
        }
        mat.uTime.value = time;

        // Update water level from board system
        // uWaterLevel = actual tide-adjusted level (for water rendering / flattening)
        // uShoreWaterLevel = lagged level for beach wet/dry line
        // uBiomeWaterLevel = permanent base level (for biome boundaries, vegetation stays fixed)
        if (this.boardSystem.tidalWaterLevel !== undefined) {
            mat.uWaterLevel.value = this.boardSystem.tidalWaterLevel;
        } else if (this.boardSystem.waterLevel !== undefined) {
            mat.uWaterLevel.value = this.boardSystem.waterLevel;
        }
        if (this.boardSystem.shoreWaterLevel !== undefined) {
            mat.uShoreWaterLevel.value = this.boardSystem.shoreWaterLevel;
        } else if (this.boardSystem.tidalWaterLevel !== undefined) {
            mat.uShoreWaterLevel.value = this.boardSystem.tidalWaterLevel;
        }
        if (this.boardSystem.waterLevel !== undefined) {
            mat.uBiomeWaterLevel.value = this.boardSystem.waterLevel;
        }
        // Debug: log once to verify uniform values
        if (!this._shoreUniformLogged) {
            this._shoreUniformLogged = true;
            console.log(`[SHADER] uWaterLevel=${mat.uWaterLevel.value.toFixed(3)} uShoreWaterLevel=${mat.uShoreWaterLevel.value.toFixed(3)} uBiomeWaterLevel=${mat.uBiomeWaterLevel.value.toFixed(3)}`);
        }

        if (mat.uForestMaskOrigin) {
            mat.uForestMaskOrigin.value.copy(this.forestMaskOrigin);
        }
        if (mat.uForestMaskWorldSize) {
            mat.uForestMaskWorldSize.value = this.forestMaskWorldSize;
        }

        // Update sun intensity so terrain darkens at night
        // Use _computed* values stored before parameterSystem gates intercept light.intensity writes
        const sunInt = this.boardSystem?._computedSunIntensity ?? this.boardSystem?.sun?.light?.intensity ?? 0;
        const moonInt = this.boardSystem?._computedMoonIntensity ?? this.boardSystem?.moon?.light?.intensity ?? 0;
        const intensity = Math.max(0.02, sunInt + moonInt * 0.4);
        mat.uSunIntensity.value = intensity;

        // Update spotlight uniforms
        // Use mouseWorldPosition for XZ to stay in sync with cursor position
        const spotLight = this.boardSystem?.game?.spotLight;
        const mouseWorldPos = this.boardSystem?.mouseWorldPosition;
        if (spotLight && mat.uSpotPos) {
            const height = spotLight.position.y;
            const x = mouseWorldPos ? mouseWorldPos.x : spotLight.position.x;
            const z = mouseWorldPos ? mouseWorldPos.z : spotLight.position.z;
            mat.uSpotPos.value.set(x, height, z);
            mat.uSpotColor.value.copy(spotLight.color);
            mat.uSpotIntensity.value = spotLight.visible ? spotLight.intensity : 0;
            const angle = spotLight.angle || 0.196;
            const radius = height * Math.tan(angle);
            mat.uSpotRadius.value = radius;
        }

        // Update wind uniforms from decorative visuals
        const dv = this.boardSystem?.game?.decorativeVisuals;
        if (dv) {
            if (mat.uWindDirection) {
                mat.uWindDirection.value.set(dv.windDirection.x, dv.windDirection.y);
            }
            if (mat.uWindStrength) {
                mat.uWindStrength.value = dv.windSpeed || 0.3;
            }
        }

        // Camera-relative data for curvature calculations
        const sampleHeight = this.boardSystem?.getTerrainHeight
            ? this.boardSystem.getTerrainHeight(cameraPosition.x, cameraPosition.z)
            : (this.terrainSystem?.getHeight
                ? this.terrainSystem.getHeight(cameraPosition.x, cameraPosition.z)
                : 0);
        const terrainHeight = Number.isFinite(sampleHeight) ? sampleHeight : 0;
        const camHeight = Math.max(0, cameraPosition.y - terrainHeight);
        if (mat.uCameraHeight) {
            mat.uCameraHeight.value = camHeight;
        }
        if (mat.uCameraWorldPos) {
            mat.uCameraWorldPos.value.copy(cameraPosition);
        }

        if (this.terrainSystem?.getTileData) {
            const tile = this.terrainSystem.getTileData(cameraPosition.x, cameraPosition.z);
            if (tile && tile.biome) {
                this.updateForestTextureForBiome(tile.biome);
            }
        }

        if (mat.uSphereRadius) {
            let sphereRadius = mat.uSphereRadius.value;
            if (planetMapping?.activePlanet?.sphereRadius) {
                sphereRadius = planetMapping.activePlanet.sphereRadius;
            } else if (planetMapping?.sphereRadius) {
                sphereRadius = planetMapping.sphereRadius;
            }
            mat.uSphereRadius.value = sphereRadius;
        }

        if (mat.uPlanetCenter) {
            const r = mat.uSphereRadius?.value || 180;
            const terrainBaseY = this.boardSystem?.waterLevel !== undefined ? this.boardSystem.waterLevel + 1.5 : 0;
            mat.uPlanetCenter.value.set(cameraPosition.x, terrainBaseY - r, cameraPosition.z);
        }

        if (mat.uDeformStartHeight) {
            mat.uDeformStartHeight.value = this.deformStartHeight;
        }
        if (mat.uDeformEndHeight) {
            mat.uDeformEndHeight.value = this.deformEndHeight;
        }
        mat.uEnableSpherical.value = (this.sphericalEnabled !== false) ? 1.0 : 0.0;
        if (mat.uDebugForceSpherical) {
            // Console override for debugging: type `_forceSpherical = true` in dev tools
            const force = (typeof window !== 'undefined' && window._forceSpherical === true);
            mat.uDebugForceSpherical.value = (this.debugForceSpherical === true || force) ? 1.0 : 0.0;
        }
        if (mat.uCurvatureScale) {
            mat.uCurvatureScale.value = this.curvatureScale ?? 1.0;
        }

        // Dynamic checkerboard radius: directly proportional to camera height above terrain
        // Higher camera = smaller visible checkerboard radius (zoomy feel)
        const radiusScale = 1.0 / (1.0 + camHeight * this.checkerHeightFactor);
        if (mat.uStartDistance) {
            mat.uStartDistance.value = this.checkerBaseStart * radiusScale;
        }
        if (mat.uEndDistance) {
            mat.uEndDistance.value = this.checkerBaseEnd * radiusScale;
        }
        if (mat.uCheckerScale) {
            mat.uCheckerScale.value = 1.0; // Fixed square size
        }

        // Sync blur / mip-bias / custom fog uniforms from parameterSystem
        const ps = window.parameterSystem;
        if (ps) {
            const sync = (uniformName, paramName) => {
                if (mat[uniformName] !== undefined) {
                    const val = ps.getParameter(paramName);
                    if (val !== undefined) {
                        const cur = mat[uniformName].value;
                        if (typeof cur === 'number' && typeof val === 'number') {
                            if (Math.abs(cur - val) > 0.0001) mat[uniformName].value = val;
                        } else if (cur !== val) {
                            mat[uniformName].value = val;
                        }
                    }
                }
            };
            sync('uBlurEnabled', 'blurEnabled');
            sync('uBlurStart', 'blurStart');
            sync('uBlurEnd', 'blurEnd');
            sync('uBlurStrength', 'blurStrength');
            sync('uMipBiasEnabled', 'mipBiasEnabled');
            sync('uMipBiasStart', 'mipBiasStart');
            sync('uMipBiasEnd', 'mipBiasEnd');
            sync('uMipBiasStrength', 'mipBiasStrength');
            sync('uFogGradientEnabled', 'fogGradientEnabled');
            sync('uFogGradientExponent', 'fogGradientExponent');
            sync('uFogGradientBias', 'fogGradientBias');
            sync('uFogDensity', 'fogDensity');

            // Sync fog color bands
            if (mat.uFogColors && mat.uFogStops && mat.uFogColorCount !== undefined) {
                const count = Math.floor(ps.getParameter('fogColorBandCount') || 2);
                if (mat.uFogColorCount.value !== count) mat.uFogColorCount.value = count;
                for (let i = 0; i < 5; i++) {
                    const colorVal = ps.getParameter(`fogColor${i + 1}`);
                    if (colorVal && mat.uFogColors.value[i]) {
                        mat.uFogColors.value[i].set(colorVal);
                    }
                    const stopVal = ps.getParameter(`fogColorStop${i + 1}`);
                    if (stopVal !== undefined && mat.uFogStops.value[i] !== stopVal) {
                        mat.uFogStops.value[i] = stopVal;
                    }
                }
            }
        }

        // Throttled debug log for spherical diagnostics
        if (!this._lastSphericalLog || Date.now() - this._lastSphericalLog > 2000) {
            this._lastSphericalLog = Date.now();
        }
    }

    setDeformStartHeight(value) {
        this.deformStartHeight = value;
        if (this.shaderMaterial?.uniforms?.uDeformStartHeight) {
            this.shaderMaterial.uniforms.uDeformStartHeight.value = value;
        }
    }

    setDeformEndHeight(value) {
        this.deformEndHeight = value;
        if (this.shaderMaterial?.uniforms?.uDeformEndHeight) {
            this.shaderMaterial.uniforms.uDeformEndHeight.value = value;
        }
    }

    setCheckerHeightSensitivity(factor) {
        this.checkerHeightFactor = factor;
    }

    _getTerrainFadeDiameter() {
        const board = this.boardSystem;
        if (!board) return 0;

        // Viewport mesh (rolling terrain) spans (N - 1) cells because vertices are inclusive
        if (board.useViewportMesh && board.rollingTerrain) {
            const rt = board.rollingTerrain;
            const cellSize = rt.S || 1;
            const usableSpan = Math.max(0, (rt.N - 1) * cellSize);
            return usableSpan;
        }

        // Continuous mesh bounds supply total width/height directly
        if (board.meshBounds?.size) {
            return board.meshBounds.size;
        }

        // Fallback to chunk size * multiplier (approximate square width)
        const chunkSize = board.chunkSize || board.terrainSystem?.chunkSize;
        if (!chunkSize) return 0;
        const multiplier = board.meshMultiplier || 24;
        return chunkSize * multiplier;
    }

    getFadeRadii() {
        const d = this._getTerrainFadeDiameter();
        if (!d) return null;
        const outer = d * 0.5;
        const inner = outer * 0.98;
        return { inner, outer };
    }

    updateChunkColors(chunk, cameraPosition, time) {
        if (!chunk.mesh || !chunk.geometry) return;
        
        // Store original colors if not already stored
        const chunkKey = `${chunk.x},${chunk.z}`;
        if (!this.originalColors.has(chunkKey)) {
            const colors = chunk.geometry.attributes.color.array.slice();
            this.originalColors.set(chunkKey, colors);
        }
        
        const originalColors = this.originalColors.get(chunkKey);
        const currentColors = chunk.geometry.attributes.color.array;
        const chunkSize = this.boardSystem.chunkSize;
        
        // Update colors based on distance
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                const worldX = chunk.x * chunkSize + x;
                const worldZ = chunk.z * chunkSize + z;
                
                // Calculate distance from camera
                const distance = Math.sqrt(
                    Math.pow(worldX - cameraPosition.x, 2) + 
                    Math.pow(worldZ - cameraPosition.z, 2)
                );
                
                // Calculate blend factor
                let blendFactor = 0.0;
                if (distance <= this.startDistance) {
                    blendFactor = 0.1; // 10% grass at close distance
                } else if (distance >= this.endDistance) {
                    blendFactor = 1.0; // 100% grass at far distance
                } else {
                    blendFactor = 0.1 + 0.9 * ((distance - this.startDistance) / (this.endDistance - this.startDistance));
                }
                
                // Get original chessboard color - match board system indexing
                const tileIndex = z * chunkSize + x;
                const baseIndex = tileIndex * 4 * 3; // 4 vertices per tile, 3 colors per vertex
                
                // Get stable grass color
                const grassColor = this.getStableGrassColor(worldX, worldZ, time);
                
                // Blend colors for all 4 vertices of this tile
                for (let vertex = 0; vertex < 4; vertex++) {
                    const vertexIndex = baseIndex + vertex * 3;
                    
                    const chessboardColor = new THREE.Color(
                        originalColors[vertexIndex],
                        originalColors[vertexIndex + 1],
                        originalColors[vertexIndex + 2]
                    );
                    
                    const blendedColor = chessboardColor.clone().lerp(grassColor, blendFactor);
                    
                    currentColors[vertexIndex] = blendedColor.r;
                    currentColors[vertexIndex + 1] = blendedColor.g;
                    currentColors[vertexIndex + 2] = blendedColor.b;
                }
            }
        }
        
        chunk.geometry.attributes.color.needsUpdate = true;
    }
    
    updateAllChunks(cameraPosition, time) {
        // Update all existing chunks
        for (const [chunkKey, chunk] of this.boardSystem.chunks) {
            this.updateChunkColors(chunk, cameraPosition, time);
        }
    }
    
    updateAnimation(time, cameraPosition) {
        // Animation is now handled in updateChunkColors with stable colors
        // This method is kept for compatibility but does minimal work
    }
    
    resetToOriginalColors() {
        // Restore original colors
        for (const [chunkKey, originalColors] of this.originalColors) {
            const chunk = this.boardSystem.chunks.get(chunkKey);
            if (chunk && chunk.geometry) {
                const currentColors = chunk.geometry.attributes.color.array;
                currentColors.set(originalColors);
                chunk.geometry.attributes.color.needsUpdate = true;
            }
        }
        this.originalColors.clear();
    }
    
    dispose() {
        this.resetToOriginalColors();
    }
    
    // Update grass textures for seasonal changes
    setBiomeColor(index, color) {
        if (!this.shaderMaterial || index < 0 || index > 7) return;
        const c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
        this.shaderMaterial.uniforms.uBiomeColors.value[index].copy(c);
    }

    setBiomeThreshold(index, value) {
        if (!this.shaderMaterial || index < 0 || index > 6) return;
        this.shaderMaterial.uniforms.uBiomeThresholds.value[index] = value;
    }

    setBiomePatchUniforms(scale, strength, seed) {
        if (!this.shaderMaterial) return;
        if (scale !== undefined) this.shaderMaterial.uniforms.uBiomePatchScale.value = scale;
        if (strength !== undefined) this.shaderMaterial.uniforms.uBiomePatchStrength.value = strength;
        if (seed !== undefined) this.shaderMaterial.uniforms.uBiomePatchSeed.value = seed;
    }

    updateSeasonalTextures() {
        const seasonalColor = this.getSeasonalGrassColor();
        if (this.shaderMaterial?.uniforms?.uGrassColorTint) {
            this.shaderMaterial.uniforms.uGrassColorTint.value.copy(seasonalColor);
            this.shaderMaterial.needsUpdate = true;
        }
        console.log('[TextureBlending] Updated seasonal grass color for season:', this.boardSystem?.currentSeason);
    }

    // --- Cliff parameter setters ---
    setCliffEnabled(enabled) {
        this.cliffEnabled = enabled;
        if (this.shaderMaterial?.uniforms?.uCliffEnabled) {
            this.shaderMaterial.uniforms.uCliffEnabled.value = enabled ? 1.0 : 0.0;
        }
    }

    setCliffThreshold(value) {
        this.cliffThreshold = value;
        if (this.shaderMaterial?.uniforms?.uCliffThreshold) {
            this.shaderMaterial.uniforms.uCliffThreshold.value = value;
        }
    }

    setCliffBlendWidth(value) {
        this.cliffBlendWidth = value;
        if (this.shaderMaterial?.uniforms?.uCliffBlendWidth) {
            this.shaderMaterial.uniforms.uCliffBlendWidth.value = value;
        }
    }

    setCliffRubbleAmount(value) {
        this.cliffRubbleAmount = value;
        if (this.shaderMaterial?.uniforms?.uCliffRubbleAmount) {
            this.shaderMaterial.uniforms.uCliffRubbleAmount.value = value;
        }
    }

    setCliffStrataScale(value) {
        this.cliffStrataScale = value;
        if (this.shaderMaterial?.uniforms?.uCliffStrataScale) {
            this.shaderMaterial.uniforms.uCliffStrataScale.value = value;
        }
    }

    setCliffStrataAmount(value) {
        this.cliffStrataAmount = value;
        if (this.shaderMaterial?.uniforms?.uCliffStrataAmount) {
            this.shaderMaterial.uniforms.uCliffStrataAmount.value = value;
        }
    }

    setCliffDarkenAmount(value) {
        this.cliffDarkenAmount = value;
        if (this.shaderMaterial?.uniforms?.uCliffDarkenAmount) {
            this.shaderMaterial.uniforms.uCliffDarkenAmount.value = value;
        }
    }

    setCliffBaseColor(color) {
        const c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
        this.cliffBaseColor = c;
        if (this.shaderMaterial?.uniforms?.uCliffBaseColor) {
            this.shaderMaterial.uniforms.uCliffBaseColor.value.copy(c);
        }
    }

    setCliffLightColor(color) {
        const c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
        this.cliffLightColor = c;
        if (this.shaderMaterial?.uniforms?.uCliffLightColor) {
            this.shaderMaterial.uniforms.uCliffLightColor.value.copy(c);
        }
    }

    setCliffMossColor(color) {
        const c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
        this.cliffMossColor = c;
        if (this.shaderMaterial?.uniforms?.uCliffMossColor) {
            this.shaderMaterial.uniforms.uCliffMossColor.value.copy(c);
        }
    }

    setCliffMossAmount(value) {
        this.cliffMossAmount = value;
        if (this.shaderMaterial?.uniforms?.uCliffMossAmount) {
            this.shaderMaterial.uniforms.uCliffMossAmount.value = value;
        }
    }

    setCliffDebug(enabled) {
        this.cliffDebug = enabled;
        if (this.shaderMaterial?.uniforms?.uCliffDebug) {
            this.shaderMaterial.uniforms.uCliffDebug.value = enabled ? 1.0 : 0.0;
        }
    }

    setEnvironmentalFields(pressure, humidity, temperature) {
        if (!this.shaderMaterial) return;
        const u = this.shaderMaterial.uniforms;
        if (u.uEnvPressure) u.uEnvPressure.value = pressure;
        if (u.uEnvHumidity) u.uEnvHumidity.value = humidity;
        if (u.uEnvTemperature) u.uEnvTemperature.value = temperature;
    }
}
