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
        
        console.log('[TextureBlending] System initialized');
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
            uniform float uTime;
            varying vec3 vColor;
            varying vec3 vWorldPosition;
            varying vec3 vOriginalWorldPosition;
            varying vec3 vBiomeColor;
            varying vec2 vUv;
            varying float vDeformFactor;

            uniform vec3 uSeasonalGrassColor;

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

            vec3 getBiomeColor(float height, vec2 worldXZ) {
                float blend = 0.5;
                float h = height - uWaterLevel;

                float t1 = uBiomeThresholds[0];
                float t2 = uBiomeThresholds[1];
                float t3 = uBiomeThresholds[2];
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

                return uBiomeColors[0] * deepW + uBiomeColors[1] * shallowW + uBiomeColors[2] * beachW
                     + uBiomeColors[3] * lowlandW + uBiomeColors[4] * grasslandW + uBiomeColors[5] * forestW
                     + uBiomeColors[6] * mountainW + uBiomeColors[7] * snowW;
            }

            void main() {
                vColor = color;

                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                vOriginalWorldPosition = worldPosition.xyz;
                // Compute UVs from world position so noise/texture stays locked to world coordinates
                vUv = worldPosition.xz * 0.15;

                vBiomeColor = getBiomeColor(vWorldPosition.y, vWorldPosition.xz);

                // Compute final world position including optional spherical curvature
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vec3 finalWorld = wp.xyz;

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

                    // World-centered sphere: terrain sits ON the sphere surface
                    // Sphere center is directly below the camera, at terrain height minus radius
                    float terrainHeightAtCamera = uCameraWorldPos.y - uCameraHeight;
                    vec3 sphereCenter = vec3(uCameraWorldPos.x, terrainHeightAtCamera - uSphereRadius, uCameraWorldPos.z);

                    // Horizontal offset from sphere center
                    vec2 dXZ = wp.xz - sphereCenter.xz;
                    float horizDist = length(dXZ);
                    vec2 dir = horizDist > 0.001 ? normalize(dXZ) : vec2(0.0);

                    // Angle on the sphere surface from the north pole
                    float arcAngle = clamp(horizDist / uSphereRadius, 0.0, 3.14159);
                    float sinA = sin(arcAngle);
                    float cosA = cos(arcAngle);

                    vec3 flatPos = wp.xyz;
                    vec3 spherePos;
                    // Map flat terrain XZ onto sphere surface XZ
                    spherePos.xz = sphereCenter.xz + dir * uSphereRadius * sinA;
                    // Sphere surface height at this angle
                    spherePos.y = sphereCenter.y + uSphereRadius * cosA;

                    // Blend between flat plane and spherical surface
                    finalWorld = mix(flatPos, spherePos, deformFactor);

                    // Update texture coords so checkerboard/grass shrink with the mesh
                    vWorldPosition.xz = finalWorld.xz;
                    vUv = finalWorld.xz * 0.15;
                }

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
        uniform float uGrassUvScale;
        uniform float uGrassWindMultiplier;
        uniform vec3 uGrassColorTint;
        uniform vec3 uGrassColorLight;
        uniform float uGrassBlendAmount;
        uniform float uGrassSharpness;
        uniform float uGrassWindSpeed;
        uniform float uGrassPhaseScale;
        uniform float uGrassBladeStretchX;
        uniform float uGrassBladeStretchY;
        uniform float uGrassMicroAmount;
        uniform float uSunIntensity;
        uniform vec3 uFadeCenter;
        uniform float uFadeInnerRadius;
        uniform float uFadeOuterRadius;
        uniform float uFadeEnabled;
        uniform float uCheckerScale;
        uniform vec3 uPlanetCenter;
        uniform float uSphereRadius;

        // Water system uniforms
        uniform float uWaterEnabled;
        uniform float uShallowThreshold;
        uniform vec3 uDeepWaterColor;
        uniform vec3 uShallowWaterColor;
        uniform float uDebugWaterState;
        uniform float uDebugRadialUp;
        uniform float uDebugWaveNormals;
        uniform float uDebugFresnel;
        uniform float uDebugFoam;
        uniform float uFoamIntensity;
        uniform float uWaveAmplitudeSwell;
        uniform float uWaveAmplitudeWind;
        uniform float uWaveAmplitudeRipple;
        uniform float uWaveScale;
        uniform float uWaterDepthMax;
        uniform float uWaveSwellSpeed;
        uniform float uWaveWindSpeed;
        uniform float uWaveRippleSpeed;
        uniform float uWaveSwellFreq;
        uniform float uWaveWindFreq;
        uniform float uWaveRippleFreq;
        uniform float uFoamSpeed;
        uniform float uFoamScale;
        uniform float uFoamDepth;
        uniform float uFresnelPower;
        uniform float uWaterOpacity;
        uniform float uSkyReflection;
        uniform float uSpecularIntensity;
        uniform float uTerrainOpacity;
        uniform float uWaterDetailScale;
        uniform float uSparkleIntensity;
        uniform float uSparkleScale;
        uniform float uSparkleSpeed;
        uniform vec3 uCameraWorldPos;
        uniform vec2 uWindDirection;
        uniform float uWindStrength;

        // Beach system uniforms
        uniform float uBeachEnabled;
        uniform vec3 uBeachSandColor;
        uniform vec3 uBeachStoneColor;
        uniform vec3 uBeachWetColor;
        uniform float uBeachStoneAmount;
        uniform float uBeachStoneScale;
        uniform float uBeachWetWidth;
        uniform float uBeachWetIntensity;
        uniform float uBeachShrubAmount;
        uniform vec3 uBeachShrubColor;
        uniform float uBeachUvScale;
        uniform float uDebugBeachState;

        varying vec3 vColor;
        varying vec3 vWorldPosition;
        varying vec3 vOriginalWorldPosition;
        varying vec3 vBiomeColor;
        varying vec2 vUv;
        varying float vDeformFactor;

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

        // Grid-based sparkle / micro-glitter for water surface
        float gridSparkle(vec2 pos, float scale, float speed, float t) {
            vec2 gridPos = pos * scale;
            vec2 cell = floor(gridPos);
            vec2 frac = fract(gridPos) - 0.5;
            float randPhase = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
            float randOffset = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
            float shimmer = sin(t * speed + randPhase * 6.28318) * 0.5 + 0.5;
            shimmer = pow(shimmer, 3.0);
            float dist = length(frac + vec2(randOffset - 0.5, randPhase - 0.5) * 0.4);
            float point = 1.0 - smoothstep(0.0, 0.2, dist);
            return point * shimmer;
        }

        // Gerstner wave normal (no geometry displacement)
        vec3 gerstnerNormal(vec2 pos, float t, float ampSwell, float ampWind, float ampRipple, float scale) {
            vec3 n = vec3(0.0, 1.0, 0.0);
            float d = uWaterDetailScale;
            // Layer 1 — large swell
            float kSwell = 0.02 * uWaveSwellFreq / d;
            n.x += cos(pos.x * kSwell + t * uWaveSwellSpeed) * ampSwell * d * scale * kSwell;
            n.z += sin(pos.y * kSwell + t * uWaveSwellSpeed) * ampSwell * d * scale * kSwell;
            // Layer 2 — wind waves
            float kWind = 0.08 * uWaveWindFreq / d;
            n.x += cos(pos.x * kWind + t * uWaveWindSpeed) * ampWind * d * scale * kWind;
            n.z += sin(pos.y * kWind + t * uWaveWindSpeed) * ampWind * d * scale * kWind;
            // Layer 3 — ripples
            float kRipple = 0.3 * uWaveRippleFreq / d;
            n.x += cos(pos.x * kRipple + t * uWaveRippleSpeed) * ampRipple * d * scale * kRipple;
            n.z += sin(pos.y * kRipple + t * uWaveRippleSpeed) * ampRipple * d * scale * kRipple;
            return normalize(n);
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

            // Blend between checkerboard (near) and biome (far)
            vec3 finalColor = mix(chessboardColor, biomeColor, blendFactor);

            // ==================== BEACH SYSTEM ====================
            if (uBeachEnabled > 0.5) {
                // Beach mask: between shallow water (~-2.5) and lowland (~1.0)
                float beachMask = smoothstep(-2.8, -2.2, vWorldPosition.y)
                                * (1.0 - smoothstep(0.8, 1.5, vWorldPosition.y));

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

                    // High tide line: wet sand just above water level
                    float waterDist = vWorldPosition.y - uWaterLevel;
                    float wetMask = smoothstep(uBeachWetWidth, 0.0, waterDist) * uBeachWetIntensity;
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
            // Sharpen: narrow smoothstep range = harder edges
            float edgeLow = 0.35 + uGrassSharpness * 0.12;
            float edgeHigh = 0.65 - uGrassSharpness * 0.12;
            float grassDetail = smoothstep(edgeLow, edgeHigh, bladeNoise);

            // Micro detail layer for richness
            vec2 microUv = grassUv * vec2(12.0, 48.0);
            float microNoise = smoothstep(0.30, 0.70, fbm(microUv));
            grassDetail = mix(grassDetail, microNoise, uGrassMicroAmount);

            vec3 grassColor = mix(vec3(0.15, 0.45, 0.12), uGrassColorLight, grassDetail);
            grassColor = mix(grassColor, uGrassColorTint, 0.3);

            // Biome mask: grass only on lowland -> forest
            float grassMask = smoothstep(1.0, 3.0, vWorldPosition.y)
                            * (1.0 - smoothstep(15.0, 18.0, vWorldPosition.y));

            finalColor = mix(finalColor, grassColor, grassMask * blendFactor * uGrassBlendAmount);
            finalColor *= uSunIntensity;

            // ==================== WATER SYSTEM ====================
            if (uWaterEnabled > 0.5) {
            float waterDepth = max(0.0, uWaterLevel - vWorldPosition.y);
            float isWater = step(0.001, waterDepth);
            float isShallow = 1.0 - smoothstep(0.0, uShallowThreshold, waterDepth);
            float isDeep = smoothstep(uShallowThreshold, uShallowThreshold + 0.5, waterDepth);

            // Debug: flat water state colours
            if (uDebugWaterState > 0.5) {
                vec3 debugLand = vec3(0.0, 1.0, 0.0);
                vec3 debugShallow = vec3(0.0, 1.0, 1.0);
                vec3 debugDeep = vec3(0.0, 0.0, 1.0);
                vec3 debugColor = mix(debugShallow, debugDeep, isDeep);
                gl_FragColor = vec4(mix(debugLand, debugColor, isWater), 1.0);
                #include <fog_fragment>
                return;
            }

            // Planet-relative up vector
            vec3 radialUp = normalize(vWorldPosition - uPlanetCenter);

            // Debug: radial up visualization
            if (uDebugRadialUp > 0.5) {
                gl_FragColor = vec4(radialUp * 0.5 + 0.5, 1.0);
                #include <fog_fragment>
                return;
            }

            // Virtual water surface position
            vec3 virtualSurfacePos = vWorldPosition + radialUp * waterDepth;

            // Build orthonormal basis on curved surface
            vec3 tangent = normalize(cross(radialUp, vec3(0.0, 0.0, 1.0)));
            if (abs(dot(radialUp, vec3(0.0, 0.0, 1.0))) > 0.99) {
                tangent = vec3(1.0, 0.0, 0.0);
            }
            vec3 bitangent = cross(radialUp, tangent);

            // Gerstner wave normal
            vec3 waveN = gerstnerNormal(virtualSurfacePos.xz, uTime,
                                        uWaveAmplitudeSwell,
                                        uWaveAmplitudeWind,
                                        uWaveAmplitudeRipple,
                                        uWaveScale);
            vec3 perturbedNormal = normalize(
                tangent * waveN.x +
                bitangent * waveN.z +
                radialUp * waveN.y
            );

            // Debug: wave normals
            if (uDebugWaveNormals > 0.5) {
                gl_FragColor = vec4(perturbedNormal * 0.5 + 0.5, 1.0);
                #include <fog_fragment>
                return;
            }

            // Fresnel
            vec3 V = normalize(uCameraWorldPos - vWorldPosition);
            float fresnel = pow(1.0 - max(0.0, dot(V, perturbedNormal)), uFresnelPower);

            // Debug: fresnel mask
            if (uDebugFresnel > 0.5) {
                gl_FragColor = vec4(vec3(fresnel), 1.0);
                #include <fog_fragment>
                return;
            }

            // Depth absorption
            float depthFactor = smoothstep(0.0, uWaterDepthMax, waterDepth);
            vec3 waterBase = mix(uShallowWaterColor, uDeepWaterColor, depthFactor);

            // Shoreline foam
            float foamNoise = noise(vWorldPosition.xz * uFoamScale / uWaterDetailScale + uTime * uFoamSpeed);
            float foam = (1.0 - smoothstep(0.0, uFoamDepth, waterDepth)) * (foamNoise * 0.5 + 0.5);
            vec3 foamColor = vec3(0.9, 0.95, 1.0);
            waterBase = mix(waterBase, foamColor, foam * uFoamIntensity);

            // Debug: foam mask
            if (uDebugFoam > 0.5) {
                gl_FragColor = vec4(vec3(foam), 1.0);
                #include <fog_fragment>
                return;
            }

            // Blend water into terrain
            finalColor = mix(finalColor, waterBase, isWater * uWaterOpacity);

            // Fresnel sky reflection on water
            vec3 skyColor = vec3(0.5, 0.6, 0.7);
            finalColor = mix(finalColor, skyColor, fresnel * isWater * uSkyReflection);

            // Specular highlight — makes wave normals visible from above
            vec3 sunDir = normalize(vec3(0.3, 0.9, 0.2));
            vec3 H = normalize(sunDir + V);
            float spec = pow(max(0.0, dot(perturbedNormal, H)), 64.0);
            finalColor += vec3(0.6, 0.7, 0.8) * spec * isWater * uSpecularIntensity;

            // Micro-glitter / sparkle on water surface
            float sparkle = gridSparkle(vWorldPosition.xz, uSparkleScale, uSparkleSpeed, uTime);
            float viewMask = pow(max(0.0, dot(perturbedNormal, H)), 32.0);
            finalColor += vec3(1.0, 0.98, 0.92) * sparkle * viewMask * isWater * uSparkleIntensity;

            }
            // ==================== END WATER SYSTEM ====================

            // Distance softening: desaturate + reduce contrast at 40-80 units from camera
            float camDist = length(cameraPosition - vWorldPosition);
            float softenFactor = smoothstep(40.0, 80.0, camDist);

            vec3 gray = vec3(dot(finalColor, vec3(0.299, 0.587, 0.114)));
            finalColor = mix(finalColor, gray, softenFactor * 0.55);
            finalColor = mix(finalColor, vec3(0.5), softenFactor * 0.25);

            float hfNoise = fract(sin(dot(vWorldPosition.xz, vec2(17.13, 37.91))) * 43758.5453);
            finalColor += (hfNoise - 0.5) * softenFactor * 0.03;

            // Circular transparency fade: full opacity inside inner radius, fade to transparent at outer radius
            float fadeDist = length(uFadeCenter.xz - vWorldPosition.xz);
            float fadeAlpha = mix(1.0, smoothstep(uFadeOuterRadius, uFadeInnerRadius, fadeDist), uFadeEnabled);

            gl_FragColor = vec4(finalColor, fadeAlpha * uTerrainOpacity);
            #include <fog_fragment>
        }
        `;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uCursorPos: { value: new THREE.Vector3() },
                uStartDistance: { value: this.startDistance },
                uEndDistance: { value: this.endDistance },
                uTime: { value: 0.0 },
                uWaterLevel: { value: -1.5 },
                uSunIntensity: { value: 1.0 },
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
                // Biome edge blending uniforms
                uBiomeEdgeA: { value: 3 },
                uBiomeEdgeB: { value: 4 },
                uBiomeEdgeMode: { value: 0 },
                uBiomeEdgeScale: { value: 0.3 },
                uBiomeEdgeStrength: { value: 1.0 },
                uBiomeSplatterScale: { value: 0.5 },
                uBiomeSplatterAmount: { value: 0.5 },
                uBiomeEdgeSplatterMix: { value: 0.5 },
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
                // Dynamic checker scale
                uCheckerScale: { value: 1.0 },
                // Planet center for spherical checkerboard wrapping
                uPlanetCenter: { value: new THREE.Vector3(0, -180, 0) },
                // Water system uniforms
                uShallowThreshold: { value: 1.5 },
                uDeepWaterColor: { value: new THREE.Color(0.10, 0.25, 0.50) },
                uShallowWaterColor: { value: new THREE.Color(0.40, 0.60, 0.90) },
                uDebugWaterState: { value: 0.0 },
                uDebugRadialUp: { value: 0.0 },
                uDebugWaveNormals: { value: 0.0 },
                uDebugFresnel: { value: 0.0 },
                uDebugFoam: { value: 0.0 },
                uFoamIntensity: { value: 0.6 },
                uWaveAmplitudeSwell: { value: 3.0 },
                uWaveAmplitudeWind: { value: 1.5 },
                uWaveAmplitudeRipple: { value: 0.6 },
                uWaveScale: { value: 1.0 },
                uWaterDepthMax: { value: 15.0 },
                uWaveSwellSpeed: { value: 1.5 },
                uWaveWindSpeed: { value: 3.5 },
                uWaveRippleSpeed: { value: 8.0 },
                uWaveSwellFreq: { value: 1.0 },
                uWaveWindFreq: { value: 1.0 },
                uWaveRippleFreq: { value: 1.0 },
                uFoamSpeed: { value: 1.5 },
                uFoamScale: { value: 4.0 },
                uFoamDepth: { value: 0.8 },
                uFresnelPower: { value: 5.0 },
                uWaterOpacity: { value: 1.0 },
                uSkyReflection: { value: 0.4 },
                uSpecularIntensity: { value: 0.8 },
                uTerrainOpacity: { value: 1.0 },
                uWaterDetailScale: { value: 1.0 },
                uSparkleIntensity: { value: 0.6 },
                uSparkleScale: { value: 8.0 },
                uSparkleSpeed: { value: 3.0 },
                uWaterEnabled: { value: 1.0 },
                // Beach system uniforms
                uBeachEnabled: { value: 1.0 },
                uBeachSandColor: { value: new THREE.Color(0.82, 0.76, 0.52) },
                uBeachStoneColor: { value: new THREE.Color(0.45, 0.42, 0.38) },
                uBeachWetColor: { value: new THREE.Color(0.60, 0.55, 0.38) },
                uBeachStoneAmount: { value: 0.6 },
                uBeachStoneScale: { value: 0.4 },
                uBeachWetWidth: { value: 1.2 },
                uBeachWetIntensity: { value: 0.7 },
                uBeachShrubAmount: { value: 0.5 },
                uBeachShrubColor: { value: new THREE.Color(0.22, 0.42, 0.15) },
                uBeachUvScale: { value: 0.15 },
                uDebugBeachState: { value: 0.0 }
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
        if (this.boardSystem.waterLevel !== undefined) {
            mat.uWaterLevel.value = this.boardSystem.waterLevel;
        }

        // Update sun intensity so terrain darkens at night
        const sunInt = this.boardSystem?.sun?.light?.intensity || 0;
        const moonInt = this.boardSystem?.moon?.light?.intensity || 0;
        const intensity = Math.max(0.15, sunInt + moonInt * 0.4);
        mat.uSunIntensity.value = intensity;

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

        // Throttled debug log for spherical diagnostics
        if (!this._lastSphericalLog || Date.now() - this._lastSphericalLog > 2000) {
            this._lastSphericalLog = Date.now();
            const mesh = this.boardSystem?.continuousMesh;
            const meshType = mesh?.material?.type || 'no-mesh';
            const isShader = mesh?.material?.isShaderMaterial || false;
            const matMatch = mesh?.material === this.shaderMaterial;
            console.log(`[SPHERICAL DEBUG] meshMaterial=${meshType} isShader=${isShader} matMatch=${matMatch} ` +
                        `uSphereRadius=${mat.uSphereRadius.value.toFixed(1)} ` +
                        `uCameraHeight=${mat.uCameraHeight.value.toFixed(1)} ` +
                        `uDeformStart=${mat.uDeformStartHeight.value.toFixed(1)} ` +
                        `uDeformEnd=${mat.uDeformEndHeight.value.toFixed(1)} ` +
                        `uEnable=${mat.uEnableSpherical.value.toFixed(1)} ` +
                        `uDebugForce=${mat.uDebugForceSpherical.value.toFixed(1)} ` +
                        `uCurvatureScale=${mat.uCurvatureScale?.value?.toFixed(2) || 'n/a'} ` +
                        `cameraPos=${cameraPosition.y.toFixed(1)} terrainH=${terrainHeight.toFixed(1)} camAbove=${camHeight.toFixed(1)}`);
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

    updateSeasonalTextures() {
        const seasonalColor = this.getSeasonalGrassColor();
        if (this.shaderMaterial?.uniforms?.uGrassColorTint) {
            this.shaderMaterial.uniforms.uGrassColorTint.value.copy(seasonalColor);
            this.shaderMaterial.needsUpdate = true;
        }
        console.log('[TextureBlending] Updated seasonal grass color for season:', this.boardSystem?.currentSeason);
    }
}
