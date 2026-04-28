class TerrainSystem {
    constructor(scene, treeSystem = null) {
        this.scene = scene;
        this.treeSystem = treeSystem;
        this.chunks = new Map();
        this.chunkSize = 16;
        this.loadDistance = 6; // Expanded for wider camera cone (96 units / 16 chunk size)
        this.lastCameraChunk = { x: 0, z: 0 };
        
        // Terrain colors for different biomes
        this.biomeColors = {
            deepWater: new THREE.Color(0.1, 0.3, 0.6),
            shallowWater: new THREE.Color(0.2, 0.4, 0.7),
            sand: new THREE.Color(0.8, 0.7, 0.4),
            grass: new THREE.Color(0.2, 0.6, 0.2),
            forest: new THREE.Color(0.1, 0.4, 0.1),
            rock: new THREE.Color(0.5, 0.4, 0.3),
            snow: new THREE.Color(0.9, 0.9, 0.9)
        };
    }
    
    async generateInitialTerrain(centerX, centerZ, radius) {
        const promises = [];
        
        for (let x = -radius; x <= radius; x++) {
            for (let z = -radius; z <= radius; z++) {
                const chunkX = Math.floor(centerX / this.chunkSize) + x;
                const chunkZ = Math.floor(centerZ / this.chunkSize) + z;
                
                promises.push(this.loadChunk(chunkX, chunkZ));
            }
        }
        
        await Promise.all(promises);
    }
    
    updateStreaming(cameraPosition) {
        const cameraChunkX = Math.floor(cameraPosition.x / this.chunkSize);
        const cameraChunkZ = Math.floor(cameraPosition.z / this.chunkSize);
        
        // Check if camera moved to a new chunk
        if (cameraChunkX !== this.lastCameraChunk.x || cameraChunkZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: cameraChunkX, z: cameraChunkZ };
            this.updateChunks(cameraChunkX, cameraChunkZ);
        }
    }
    
    updateChunks(cameraChunkX, cameraChunkZ) {
        console.log(`[Terrain] Updating chunks for camera at: ${cameraChunkX},${cameraChunkZ}`);
        
        const chunksToLoad = [];
        const chunksToUnload = [];
        
        // Determine which chunks should be loaded
        for (let x = -this.loadDistance; x <= this.loadDistance; x++) {
            for (let z = -this.loadDistance; z <= this.loadDistance; z++) {
                const chunkX = cameraChunkX + x;
                const chunkZ = cameraChunkZ + z;
                const chunkKey = `${chunkX},${chunkZ}`;
                
                if (!this.chunks.has(chunkKey)) {
                    console.log(`[Terrain] Loading chunk ${chunkKey}`);
                    chunksToLoad.push({ x: chunkX, z: chunkZ });
                }
            }
        }
        
        // Determine which chunks should be unloaded
        for (const [chunkKey, chunk] of this.chunks) {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            const distance = Math.max(
                Math.abs(chunkX - cameraChunkX),
                Math.abs(chunkZ - cameraChunkZ)
            );
            
            if (distance > this.loadDistance + 1) {
                console.log(`[Terrain] Unloading distant chunk ${chunkKey} (distance: ${distance})`);
                chunksToUnload.push(chunkKey);
            }
        }
        
        // Load new chunks
        let chunksLoaded = 0;
        chunksToLoad.forEach(chunk => {
            this.loadChunk(chunk.x, chunk.z);
            chunksLoaded++;
        });
        
        console.log(`[Terrain] Loaded ${chunksLoaded} new chunks`);
        
        // Unload distant chunks
        chunksToUnload.forEach(chunkKey => {
            this.unloadChunk(chunkKey);
        });
    }
    
    async loadChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        if (this.chunks.has(chunkKey)) {
            return;
        }
        
        // Get terrain data from server (authoritative source)
        try {
            const response = await fetch(`/api/terrain/chunk/${chunkX}/${chunkZ}`);
            if (!response.ok) {
                console.warn(`[Terrain] Failed to load chunk (${chunkX}, ${chunkZ}) from server`);
                return;
            }
            const terrainData = await response.json();
            
            // Store server data
            this.chunks.set(chunkKey, {
                data: terrainData,
                loaded: true
            });
            
            console.log(`[Terrain] Loaded chunk (${chunkX}, ${chunkZ}) from server with ${terrainData.length} tiles`);
            
            // Generate trees for blocked tiles after data is stored
            console.log(`[Terrain] Checking treeSystem for chunk (${chunkX}, ${chunkZ}):`, !!this.treeSystem);
            if (this.treeSystem) {
                console.log(`[Terrain] Calling updateTreesForChunk for chunk (${chunkX}, ${chunkZ})`);
                this.treeSystem.updateTreesForChunk(chunkX, chunkZ, this.chunkSize);
            } else {
                console.warn(`[Terrain] No treeSystem available for chunk (${chunkX}, ${chunkZ})`);
            }
        } catch (error) {
            console.error(`[Terrain] Error loading chunk (${chunkX}, ${chunkZ}):`, error);
        }
    }
    
    unloadChunk(chunkKey) {
        const chunk = this.chunks.get(chunkKey);
        if (chunk) {
            this.chunks.delete(chunkKey);
        }
    }
    
    getHeight(x, y) {
        // Get height from server-loaded chunk data
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(y / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            console.warn(`[Terrain] No chunk data for (${x}, ${y}) - chunk (${chunkX}, ${chunkZ}) not loaded`);
            return 0; // Default height if chunk not loaded
        }
        
        // Find specific tile in chunk - FIXED: Use Math.floor for fractional coordinates
        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(y - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        
        const tile = chunk.data[tileIndex];
        if (!tile) {
            console.warn(`[Terrain] No tile data for (${x}, ${y}) in chunk (${chunkX}, ${chunkZ})`);
            return 0; // Default height if tile not found
        }
        
        return tile.height || 0;
    }
    
    isTileBlocked(x, y) {
        // Get blocked status from server-loaded chunk data
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(y / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            console.warn(`[Terrain] No chunk data for isBlocked check at (${x}, ${y})`);
            return false; // Default to not blocked if no data
        }
        
        // Find specific tile in chunk - FIXED: Use Math.floor for fractional coordinates
        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(y - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        
        const tile = chunk.data[tileIndex];
        if (!tile) {
            console.warn(`[Terrain] No tile data for isBlocked check at (${x}, ${y})`);
            return false; // Default to not blocked if no tile
        }
        
        return tile.isBlocked || false;
    }
    
    getBiomeColor(height) {
        if (height < -15) {
            return { r: 0.1, g: 0.3, b: 0.6 }; // Deep water
        } else if (height < -5) {
            return { r: 0.2, g: 0.4, b: 0.7 }; // Shallow water
        } else if (height < 0) {
            return { r: 0.8, g: 0.7, b: 0.4 }; // Sand
        } else if (height < 10) {
            return { r: 0.2, g: 0.6, b: 0.2 }; // Grass
        } else if (height < 20) {
            return { r: 0.1, g: 0.4, b: 0.1 }; // Forest
        } else if (height < 30) {
            return { r: 0.5, g: 0.4, b: 0.3 }; // Rock
        } else {
            return { r: 0.9, g: 0.9, b: 0.9 }; // Snow
        }
    }
    
    getNormal(x, z) {
        // Calculate terrain normal using finite differences
        const delta = 0.1;
        
        // Sample heights at neighboring points
        const hCenter = this.getHeight(x, z);
        const hRight = this.getHeight(x + delta, z);
        const hLeft = this.getHeight(x - delta, z);
        const hUp = this.getHeight(x, z + delta);
        const hDown = this.getHeight(x, z - delta);
        
        // Calculate gradients
        const dx = (hRight - hLeft) / (2 * delta);
        const dz = (hUp - hDown) / (2 * delta);
        
        // Create normal vector (pointing upward from surface)
        const normal = new THREE.Vector3(-dx, 1, -dz);
        normal.normalize();
        
        return normal;
    }
}
