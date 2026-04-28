// Professional Grass Sprite System - Mobile Optimized
class GrassSystem {
    constructor(scene, boardSystem, terrainSystem) {
        this.scene = scene;
        this.boardSystem = boardSystem;
        this.terrainSystem = terrainSystem;
        
        // Grass sprite containers
        this.grassChunks = new Map(); // chunkKey -> grass sprite data
        
        // Professional Configuration
        this.maxInstancesPerChunk = 64; // Max grass sprites per chunk
        this.animationTime = 0;
        
        // LOD Configuration (Distance-based instance count)
        this.lodLevels = [
            { distance: 30, instances: 16, size: 1.0, opacity: 1.0 },    // Near
            { distance: 60, instances: 8,  size: 0.8, opacity: 0.8 },    // Medium
            { distance: 100, instances: 4, size: 0.6, opacity: 0.6 },    // Far
            { distance: 150, instances: 2, size: 0.4, opacity: 0.4 }     // Very far
        ];
        
        // Wind Configuration
        this.windSpeed = 0.5;
        this.windStrength = 0.3;
        
        // Create grass texture atlas
        this.grassTexture = this.createGrassAtlas();
        
        // Create instanced grass material with GPU animation
        this.grassMaterial = this.createGrassMaterial();
        
        console.log('[Grass] Professional sprite system initialized');
    }
    
    // Create procedural grass texture atlas
    createGrassAtlas() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Create 8 frames of wind animation × 4 grass types
        const frameWidth = 32;
        const frameHeight = 32;
        
        for (let grassType = 0; grassType < 4; grassType++) {
            for (let frame = 0; frame < 8; frame++) {
                const x = (frame % 4) * frameWidth;
                const y = Math.floor(frame / 4) * frameHeight + grassType * 64;
                
                this.drawGrassSprite(ctx, x, y, frameWidth, frameHeight, grassType, frame);
            }
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        
        return texture;
    }
    
    // Draw individual grass sprite
    drawGrassSprite(ctx, x, y, width, height, grassType, frame) {
        ctx.save();
        ctx.translate(x + width/2, y + height/2);
        
        // Wind effect
        const windOffset = Math.sin(frame * 0.5) * 2;
        ctx.rotate(windOffset * Math.PI / 180);
        
        // Draw grass blades based on type
        const colors = [
            '#2d5016', // Dark green
            '#3a6b1f', // Medium green  
            '#4a7c28', // Light green
            '#5a8d35'  // Bright green
        ];
        
        ctx.fillStyle = colors[grassType];
        ctx.strokeStyle = '#1a3009';
        ctx.lineWidth = 1;
        
        // Draw 3-5 grass blades
        const bladeCount = 3 + grassType;
        for (let i = 0; i < bladeCount; i++) {
            const offsetX = (i - bladeCount/2) * 3;
            const bladeHeight = 8 + Math.random() * 4;
            
            ctx.beginPath();
            ctx.moveTo(offsetX, height/2);
            ctx.quadraticCurveTo(
                offsetX + windOffset, 
                height/2 - bladeHeight/2,
                offsetX + windOffset * 1.5, 
                -height/2
            );
            ctx.stroke();
            
            // Add some thickness
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.lineWidth = 1;
        }
        
        ctx.restore();
    }
    
    // Create simple grass material using Points for compatibility
    createGrassMaterial() {
        return new THREE.PointsMaterial({
            size: 0.3,
            map: this.grassTexture,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true,
            alphaTest: 0.1
        });
    }
    
    // Get LOD level for chunk based on camera distance
    getLODLevel(chunkCenter, cameraPosition) {
        const distance = chunkCenter.distanceTo(cameraPosition);
        
        for (const lod of this.lodLevels) {
            if (distance <= lod.distance) {
                return lod;
            }
        }
        
        return this.lodLevels[this.lodLevels.length - 1];
    }
    
    // Create grass sprites for chunk
    createGrassForChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        // Skip if already created
        if (this.grassChunks.has(chunkKey)) {
            return;
        }
        
        // Remove existing grass
        this.removeGrassForChunk(chunkKey);
        
        const chunkSize = this.boardSystem.chunkSize;
        const chunkCenter = new THREE.Vector3(
            (chunkX * chunkSize) + chunkSize/2,
            0,
            (chunkZ * chunkSize) + chunkSize/2
        );
        
        // Get camera position for LOD calculation
        const cameraPosition = this.scene.children.find(child => child.isPerspectiveCamera)?.position || new THREE.Vector3(0, 10, 0);
        const lodLevel = this.getLODLevel(chunkCenter, cameraPosition);
        
        // Generate grass positions for this chunk
        const positions = this.generateGrassPositions(chunkX, chunkZ, lodLevel.instances);
        
        // Create geometry for grass points
        const geometry = new THREE.BufferGeometry();
        const positionArray = new Float32Array(positions.length * 3);
        const colorArray = new Float32Array(positions.length * 3);
        
        positions.forEach((pos, index) => {
            const i = index * 3;
            positionArray[i] = pos.x;
            positionArray[i + 1] = pos.y;
            positionArray[i + 2] = pos.z;
            
            // Random green colors
            const greenShade = 0.3 + Math.random() * 0.3;
            colorArray[i] = 0.2;
            colorArray[i + 1] = greenShade;
            colorArray[i + 2] = 0.1;
        });
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorArray, 3));
        
        // Create points mesh
        const points = new THREE.Points(geometry, this.grassMaterial);
        points.position.set(chunkX * chunkSize, 0, chunkZ * chunkSize);
        
        // Add to scene
        this.scene.add(points);
        
        // Store chunk data
        this.grassChunks.set(chunkKey, {
            mesh: points,
            lodLevel: lodLevel,
            chunkCenter: chunkCenter,
            instanceCount: lodLevel.instances,
            basePositions: positions.slice() // Store for animation
        });
        
        console.log(`[Grass] Created chunk ${chunkKey} with ${lodLevel.instances} sprites`);
    }
    
    // Generate grass positions for chunk
    generateGrassPositions(chunkX, chunkZ, instanceCount) {
        const positions = [];
        const chunkSize = this.boardSystem.chunkSize;
        
        // Get available tiles in this chunk
        const availableTiles = [];
        for (let localX = 0; localX < chunkSize; localX++) {
            for (let localZ = 0; localZ < chunkSize; localZ++) {
                const worldX = chunkX * chunkSize + localX;
                const worldZ = chunkZ * chunkSize + localZ;
                
                // Skip if tile is blocked
                if (this.boardSystem.isTileBlocked(worldX, worldZ)) {
                    continue;
                }
                
                availableTiles.push({ localX, localZ, worldX, worldZ });
            }
        }
        
        // Distribute instances across available tiles
        const instancesPerTile = Math.max(1, Math.floor(instanceCount / availableTiles.length));
        
        availableTiles.forEach(tile => {
            const baseHeight = this.terrainSystem.getHeight(tile.worldX, tile.worldZ);
            
            for (let i = 0; i < instancesPerTile && positions.length < instanceCount; i++) {
                // Random position within tile
                const offsetX = (Math.random() - 0.5) * 0.8;
                const offsetZ = (Math.random() - 0.5) * 0.8;
                
                const x = tile.worldX + 0.5 + offsetX;
                const z = tile.worldZ + 0.5 + offsetZ;
                const y = baseHeight + (Math.random() - 0.5) * 0.02;
                
                positions.push(new THREE.Vector3(x, y, z));
            }
        });
        
        return positions;
    }
    
    // Remove grass sprites for chunk
    removeGrassForChunk(chunkKey) {
        const grassData = this.grassChunks.get(chunkKey);
        if (grassData && grassData.mesh) {
            this.scene.remove(grassData.mesh);
            grassData.mesh.geometry.dispose();
        }
        this.grassChunks.delete(chunkKey);
    }
    
    // Update grass animation (CPU-based for Points)
    update(deltaTime, cameraPosition) {
        this.animationTime += deltaTime * this.windSpeed;
        
        // Update each chunk's grass positions
        for (const [chunkKey, grassData] of this.grassChunks) {
            if (!grassData.mesh || !grassData.basePositions) continue;
            
            const positions = grassData.mesh.geometry.attributes.position.array;
            const basePositions = grassData.basePositions;
            
            // Apply wind animation to each grass sprite
            for (let i = 0; i < basePositions.length; i++) {
                const basePos = basePositions[i];
                const phase = (basePos.x * 0.3 + basePos.z * 0.7) * Math.PI * 2;
                
                // Wind effect
                const windX = Math.sin(this.animationTime * 2.0 + phase) * this.windStrength;
                const windZ = Math.cos(this.animationTime * 1.6 + phase) * this.windStrength * 0.5;
                
                // Update position
                const arrayIndex = i * 3;
                positions[arrayIndex] = basePos.x + windX;
                positions[arrayIndex + 1] = basePos.y;
                positions[arrayIndex + 2] = basePos.z + windZ;
            }
            
            // Mark geometry as needing update
            grassData.mesh.geometry.attributes.position.needsUpdate = true;
        }
        
        // Check for LOD updates
        const chunksToUpdate = [];
        
        for (const [chunkKey, grassData] of this.grassChunks) {
            const currentLOD = this.getLODLevel(grassData.chunkCenter, cameraPosition);
            
            // If LOD changed significantly, recreate chunk
            if (Math.abs(currentLOD.instances - grassData.instanceCount) > 4) {
                chunksToUpdate.push(chunkKey);
            }
        }
        
        // Recreate chunks that need LOD changes
        for (const chunkKey of chunksToUpdate) {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            this.removeGrassForChunk(chunkKey);
            this.createGrassForChunk(chunkX, chunkZ);
        }
        
        // Debug output (less frequent)
        if (Math.floor(this.animationTime * 10) % 60 === 0) {
            console.log(`[Grass] Sprite update: ${this.grassChunks.size} chunks, time=${this.animationTime.toFixed(2)}`);
        }
    }
    
    // Streaming update for chunk management
    updateStreaming(cameraPosition) {
        const chunkSize = this.boardSystem.chunkSize;
        const cameraChunkX = Math.floor(cameraPosition.x / chunkSize);
        const cameraChunkZ = Math.floor(cameraPosition.z / chunkSize);
        
        // Load grass for nearby chunks (limit to 1 chunk per frame)
        let chunksCreatedThisFrame = 0;
        const maxChunksPerFrame = 1;
        
        for (let x = -2; x <= 2; x++) {
            for (let z = -2; z <= 2; z++) {
                const chunkX = cameraChunkX + x;
                const chunkZ = cameraChunkZ + z;
                const chunkKey = `${chunkX},${chunkZ}`;
                
                if (!this.grassChunks.has(chunkKey)) {
                    if (chunksCreatedThisFrame < maxChunksPerFrame) {
                        this.createGrassForChunk(chunkX, chunkZ);
                        chunksCreatedThisFrame++;
                    }
                }
            }
        }
        
        // Remove grass from distant chunks
        for (const [chunkKey, grassData] of this.grassChunks) {
            const distance = grassData.chunkCenter.distanceTo(cameraPosition);
            
            if (distance > 200) { // Remove chunks beyond 200 units
                this.removeGrassForChunk(chunkKey);
            }
        }
    }
    
    // Clean up all grass
    dispose() {
        for (const [chunkKey] of this.grassChunks) {
            this.removeGrassForChunk(chunkKey);
        }
        
        this.grassMaterial.dispose();
        this.grassTexture.dispose();
    }
}
