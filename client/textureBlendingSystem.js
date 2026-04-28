// Texture Blending System - Dynamic chessboard to grass transition based on camera distance
class TextureBlendingSystem {
    constructor(boardSystem, terrainSystem) {
        this.boardSystem = boardSystem;
        this.terrainSystem = terrainSystem;
        
        // Distance configuration
        this.startDistance = 8; // Start blending at this distance
        this.endDistance = 20; // Fully grass at this distance
        
        // Grass colors for blending
        this.grassColors = [
            new THREE.Color(0.2, 0.5, 0.1), // Dark green
            new THREE.Color(0.3, 0.6, 0.2), // Medium green
            new THREE.Color(0.4, 0.7, 0.3), // Light green
        ];
        
        // Store original vertex colors
        this.originalColors = new Map();
        
        // Store stable grass colors per tile to prevent flickering
        this.tileGrassColors = new Map();
        this.colorTransitionTime = new Map();
        
        console.log('[TextureBlending] System initialized');
    }
    
    getStableGrassColor(worldX, worldZ, time) {
        const tileKey = `${Math.floor(worldX)},${Math.floor(worldZ)}`;
        
        // Initialize color for this tile if not exists
        if (!this.tileGrassColors.has(tileKey)) {
            const baseColor = this.grassColors[Math.floor(worldX + worldZ) % this.grassColors.length];
            this.tileGrassColors.set(tileKey, baseColor.clone());
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
        // Create a procedural grass texture
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Create grass-like pattern
        for (let x = 0; x < canvas.width; x++) {
            for (let y = 0; y < canvas.height; y++) {
                // Base green color with variations
                const noise = Math.random();
                const greenValue = 0.3 + noise * 0.3;
                const brightness = 0.8 + noise * 0.2;
                
                // Add some texture variation
                if (noise > 0.7) {
                    // Darker patches
                    ctx.fillStyle = `rgb(${Math.floor(greenValue * 100 * brightness)}, ${Math.floor(greenValue * 200 * brightness)}, ${Math.floor(greenValue * 80 * brightness)})`;
                } else {
                    // Normal grass
                    ctx.fillStyle = `rgb(${Math.floor(greenValue * 120 * brightness)}, ${Math.floor(greenValue * 220 * brightness)}, ${Math.floor(greenValue * 100 * brightness)})`;
                }
                
                ctx.fillRect(x, y, 1, 1);
            }
        }
        
        // Add some subtle horizontal lines for grass blade effect
        ctx.strokeStyle = 'rgba(0, 100, 0, 0.3)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 50; i++) {
            const y = Math.random() * canvas.height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 4); // Repeat the texture
        texture.needsUpdate = true;
        
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
}
