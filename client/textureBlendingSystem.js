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
            precision mediump float;
            uniform float uWaterLevel;
            uniform float uTime;
            varying vec3 vColor;
            varying vec3 vWorldPosition;
            varying vec3 vBiomeColor;
            varying vec2 vUv;

            uniform vec3 uSeasonalGrassColor;

            // Spherical deformation uniforms
            uniform float uSphereRadius;
            uniform float uCameraHeight;
            uniform float uDeformStartHeight;
            uniform float uDeformEndHeight;
            uniform float uEnableSpherical;
            uniform vec3 uCameraWorldPos;
            uniform float uDebugForceSpherical;
            
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
            
            vec3 getBiomeColor(float height) {
                // Biome palette
                vec3 deepWater   = vec3(0.40, 0.60, 0.90);
                vec3 shallowWater= vec3(0.70, 0.65, 0.50);
                vec3 beach       = vec3(0.80, 0.75, 0.45);
                vec3 lowland     = vec3(0.35, 0.45, 0.15);
                vec3 grassland   = vec3(0.25, 0.55, 0.15);
                vec3 forest      = vec3(0.10, 0.35, 0.10);
                vec3 mountain    = vec3(0.45, 0.40, 0.30);
                vec3 snow        = vec3(0.85, 0.85, 0.85);

                float blend = 0.5; // transition zone width in world units

                float w1 = smoothstep(-3.0 - blend, -3.0 + blend, height);
                float w2 = smoothstep(-2.5 - blend, -2.5 + blend, height);
                float w3 = smoothstep( 1.0 - blend,  1.0 + blend, height);
                float w4 = smoothstep( 3.0 - blend,  3.0 + blend, height);
                float w5 = smoothstep(10.0 - blend, 10.0 + blend, height);
                float w6 = smoothstep(18.0 - blend, 18.0 + blend, height);
                float w7 = smoothstep(25.0 - blend, 25.0 + blend, height);

                vec3 color = deepWater;
                color = mix(color, shallowWater, w1);
                color = mix(color, beach,       w2);
                color = mix(color, lowland,     w3);
                color = mix(color, grassland,   w4);
                color = mix(color, forest,      w5);
                color = mix(color, mountain,    w6);
                color = mix(color, snow,        w7);
                return color;
            }

            void main() {
                vColor = color;

                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                // Compute UVs from world position so noise/texture stays locked to world coordinates
                vUv = worldPosition.xz * 0.15;

                vBiomeColor = getBiomeColor(vWorldPosition.y);

                // Apply water ripple effect only to underwater vertices
                vec3 modifiedPosition = position;
                if (vWorldPosition.y < uWaterLevel) {
                    float ripple = sin(uTime * 2.0 + worldPosition.x * 0.2) *
                                  cos(uTime * 1.5 + worldPosition.z * 0.2) * 0.15;
                    modifiedPosition.y += ripple;
                }

                // Compute final world position including optional spherical curvature
                vec4 wp = modelMatrix * vec4(modifiedPosition, 1.0);
                vec3 finalWorld = wp.xyz;

                if (uEnableSpherical > 0.5 && uSphereRadius > 0.0) {
                    // Deformation factor: 0 = flat, 1 = fully curved
                    float deformFactor;
                    if (uDebugForceSpherical > 0.5) {
                        deformFactor = 1.0; // always full curvature in debug mode
                    } else {
                        float t = clamp((uCameraHeight - uDeformStartHeight) / (uDeformEndHeight - uDeformStartHeight), 0.0, 1.0);
                        deformFactor = t * t * (3.0 - 2.0 * t); // smoothstep
                    }

                    // Camera-centered curvature: drop with distance in XZ
                    vec2 dXZ = wp.xz - uCameraWorldPos.xz;
                    float distXZ = length(dXZ);
                    float curvatureDrop = (distXZ * distXZ) / (2.0 * uSphereRadius);
                    finalWorld.y -= curvatureDrop * deformFactor;
                }

                gl_Position = projectionMatrix * viewMatrix * vec4(finalWorld, 1.0);
            }
        `;

        // Get seasonal grass color for shader
        // Ensure grass texture exists before creating the material
        if (!this.grassTexture) {
            this.grassTexture = this.createGrassTexture();
        }

        const seasonalGrassColor = this.getSeasonalGrassColor();
        console.log('[TextureBlending] Creating shader material with seasonal grass color:', seasonalGrassColor);

        const fragmentShader = `
        precision mediump float;
        uniform vec3 uCursorPos;
        uniform float uStartDistance;
        uniform float uEndDistance;
        uniform float uTime;
        uniform float uWaterLevel;
        uniform vec3 uSeasonalGrassColor;
        uniform sampler2D grassTexture;
        uniform float uSunIntensity;

        varying vec3 vColor;
        varying vec3 vWorldPosition;
        varying vec3 vBiomeColor;
        varying vec2 vUv;

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

            // Generate checkerboard pattern from world position
            float checkerX = floor(vWorldPosition.x);
            float checkerZ = floor(vWorldPosition.z);
            float checker = mod(checkerX + checkerZ, 2.0);
            vec3 chessboardColor = vec3(checker);

            // Add subtle variation to biome color
            float variation = sin(vWorldPosition.x * 0.2 + uTime * 0.5)
                                * cos(vWorldPosition.z * 0.2 + uTime * 0.3) * 0.05;
            vec3 biomeColor = vBiomeColor + vec3(variation);

            // Blend between checkerboard (near) and biome (far)
            vec3 finalColor = mix(chessboardColor, biomeColor, blendFactor);

            // Sample grass texture and blend with seasonal color
            vec3 texColor = texture2D(grassTexture, vUv).rgb;
            vec3 seasonalTintedTexture = mix(texColor, uSeasonalGrassColor, 0.3);

            // Only apply grass texture blend to land biomes above water level
            float noiseValue = noise(vUv * 3.0 + 200.0);
            float grassBlend = 0.40 + noiseValue * 0.35; // 0.40 - 0.75 smooth range
            float isLand = smoothstep(uWaterLevel, uWaterLevel + 0.8, vWorldPosition.y);
            finalColor = mix(finalColor, seasonalTintedTexture, grassBlend * isLand);
            finalColor *= uSunIntensity;
            gl_FragColor = vec4(finalColor, 1.0);
        }
        `;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uCursorPos: { value: new THREE.Vector3() },
                uStartDistance: { value: this.startDistance },
                uEndDistance: { value: this.endDistance },
                uTime: { value: 0.0 },
                uWaterLevel: { value: -1.5 },
                uSeasonalGrassColor: { value: seasonalGrassColor },
                grassTexture: { value: this.grassTexture },
                uSunIntensity: { value: 1.0 },
                // Spherical deformation uniforms (defaults)
                uSphereRadius: { value: 300.0 },
                uCameraHeight: { value: 0.0 },
                uDeformStartHeight: { value: 20.0 },
                uDeformEndHeight: { value: 300.0 },
                uEnableSpherical: { value: 1.0 },
                uCameraWorldPos: { value: new THREE.Vector3(0, 0, 0) },
                uDebugForceSpherical: { value: 0.0 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            vertexColors: true,
            transparent: true
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

        // Spherical deformation uniforms
        const terrainHeight = this.terrainSystem ? this.terrainSystem.getHeight(cameraPosition.x, cameraPosition.z) : 0;
        const camH = Math.max(0, cameraPosition.y - terrainHeight);
        mat.uCameraHeight.value = camH;
        if (mat.uCameraWorldPos) {
            mat.uCameraWorldPos.value.copy(cameraPosition);
        }
        if (planetMapping && planetMapping.activePlanet) {
            mat.uSphereRadius.value = planetMapping.activePlanet.sphereRadius || mat.uSphereRadius.value;
        }
        mat.uEnableSpherical.value = (this.sphericalEnabled !== false) ? 1.0 : 0.0;
        if (mat.uDebugForceSpherical) {
            mat.uDebugForceSpherical.value = (this.debugForceSpherical === true) ? 1.0 : 0.0;
        }

        // Throttled debug log for spherical diagnostics
        if (!this._lastSphericalLog || Date.now() - this._lastSphericalLog > 2000) {
            this._lastSphericalLog = Date.now();
            const mesh = this.boardSystem?.continuousMesh;
            const meshType = mesh?.material?.type || 'no-mesh';
            const isShader = mesh?.material?.isShaderMaterial || false;
            console.log(`[SPHERICAL DEBUG] meshMaterial=${meshType} isShader=${isShader} ` +
                        `uSphereRadius=${mat.uSphereRadius.value.toFixed(1)} ` +
                        `uCameraHeight=${mat.uCameraHeight.value.toFixed(1)} ` +
                        `uDeformStart=${mat.uDeformStartHeight.value.toFixed(1)} ` +
                        `uDeformEnd=${mat.uDeformEndHeight.value.toFixed(1)} ` +
                        `uEnable=${mat.uEnableSpherical.value.toFixed(1)} ` +
                        `uDebugForce=${mat.uDebugForceSpherical.value.toFixed(1)} ` +
                        `cameraPos=${cameraPosition.y.toFixed(1)} terrainH=${terrainHeight.toFixed(1)}`);
        }
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
    updateSeasonalTextures() {
        // Only update the seasonal color uniform; grass.jpg is static
        if (this.shaderMaterial && this.shaderMaterial.uniforms && this.shaderMaterial.uniforms.uSeasonalGrassColor) {
            const seasonalColor = this.getSeasonalGrassColor();
            console.log('[TextureBlending] Updating seasonal grass color uniform to:', seasonalColor);
            this.shaderMaterial.uniforms.uSeasonalGrassColor.value = seasonalColor;
            this.shaderMaterial.needsUpdate = true;
        } else {
            console.log('[TextureBlending] Cannot update uniform - shaderMaterial:', !!this.shaderMaterial, 'uniforms:', !!this.shaderMaterial?.uniforms, 'uSeasonalGrassColor:', !!this.shaderMaterial?.uniforms?.uSeasonalGrassColor);
        }

        console.log('[TextureBlending] Updated seasonal grass texture for season:', this.boardSystem?.currentSeason);
    }
}
