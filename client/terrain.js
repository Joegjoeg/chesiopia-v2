// TERRAIN.JS - SUPER AGGRESSIVE CACHE BUSTING v2
// This file handles terrain generation and loading
console.log('[Terrain] === NEW VERSION LOADED ===');

class TerrainSystem {
    constructor(scene, treeSystem = null) {
        console.log('[Terrain] LOADING TERRAIN.JS v2 - SUPER AGGRESSIVE CACHE BUSTING');
        this.scene = scene;
        this.treeSystem = treeSystem;
        this.chunks = new Map();
        this.chunkSize = 16;
        this.loadDistance = 6; // Expanded for wider camera cone (96 units / 16 chunk size)
        this.lastCameraChunk = { x: 0, z: 0 };
        this.worldDownloaded = false; // Flag to track if entire world has been downloaded
        
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
    
    async downloadEntireWorld() {
        console.log('[Terrain] On-demand world initialization - no pre-download needed');
        
        try {
            // Set default color palette (will be generated from chunk data)
            this.colorPalette = [
                { r: 0.2, g: 0.6, b: 0.2 },  // grass
                { r: 0.8, g: 0.7, b: 0.4 },  // sand
                { r: 0.2, g: 0.4, b: 0.7 },  // water
                { r: 0.1, g: 0.4, b: 0.1 }   // dark grass
            ];
            
            this.worldDownloaded = true;
            console.log('[Terrain] On-demand initialization complete - chunks will load as needed');
            
        } catch (error) {
            console.error('[Terrain] ERROR IN INITIALIZATION:', error);
            setTimeout(() => this.downloadEntireWorld(), 5000); // Retry after 5 seconds
        }
    }
    
    async loadChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        // Check if already loaded
        if (this.chunks.has(chunkKey)) {
            if (this.treeSystem) {
                this.treeSystem.updateTreesForChunk(chunkX, chunkZ, this.chunkSize);
            }
            return this.chunks.get(chunkKey).data;
        }
        
        // Load from server
        try {
            console.log(`[Terrain] Loading chunk on-demand: ${chunkKey}`);
            const response = await fetch(`/api/terrain/chunk/${chunkX}/${chunkZ}`);
            
            if (!response.ok) {
                throw new Error(`Failed to load chunk ${chunkKey}: ${response.status}`);
            }
            
            const chunkData = await response.json();
            console.log(`[Terrain] Loaded chunk ${chunkKey} with ${chunkData.length} tiles`);
            
            // Cache the chunk
            this.chunks.set(chunkKey, {
                data: chunkData,
                loaded: true
            });
            
            return chunkData;
        } catch (error) {
            console.error(`[Terrain] Error loading chunk ${chunkKey}:`, error);
            return null;
        }
    }
    
    async generateInitialTerrain(centerX, centerZ, radius) {
        console.log(`[Terrain] generateInitialTerrain called - worldDownloaded: ${this.worldDownloaded}`);
        // If world not downloaded yet, download it first
        if (!this.worldDownloaded) {
            console.log('[Terrain] World not downloaded, triggering download...');
            await this.downloadEntireWorld();
        }
        
        // Load chunks around initial position
        const chunkRadius = Math.ceil(radius / this.chunkSize);
        const centerChunkX = Math.floor(centerX / this.chunkSize);
        const centerChunkZ = Math.floor(centerZ / this.chunkSize);
        
        console.log(`[Terrain] Loading chunks around (${centerChunkX}, ${centerChunkZ}) with radius ${chunkRadius}`);
        
        const chunkPromises = [];
        for (let x = centerChunkX - chunkRadius; x <= centerChunkX + chunkRadius; x++) {
            for (let z = centerChunkZ - chunkRadius; z <= centerChunkZ + chunkRadius; z++) {
                chunkPromises.push(this.loadChunk(x, z));
            }
        }
        
        await Promise.all(chunkPromises);
        console.log(`[Terrain] Initial terrain generation complete. Loaded ${this.chunks.size} chunks`);
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
        
        // ALWAYS ensure camera's current chunk is loaded first
        const currentChunkKey = `${cameraChunkX},${cameraChunkZ}`;
        if (!this.chunks.has(currentChunkKey)) {
            console.log(`[Terrain] PRIORITY: Loading camera's current chunk ${currentChunkKey}`);
            chunksToLoad.push({ x: cameraChunkX, z: cameraChunkZ });
        }
        
        // Determine which chunks should be loaded
        for (let x = -this.loadDistance; x <= this.loadDistance; x++) {
            for (let z = -this.loadDistance; z <= this.loadDistance; z++) {
                const chunkX = cameraChunkX + x;
                const chunkZ = cameraChunkZ + z;
                const chunkKey = `${chunkX},${chunkZ}`;
                
                if (!this.chunks.has(chunkKey)) {
                    // Skip if already added as priority
                    if (chunkKey !== currentChunkKey) {
                        console.log(`[Terrain] Loading chunk ${chunkKey}`);
                        chunksToLoad.push({ x: chunkX, z: chunkZ });
                    }
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
        
        // If world is downloaded, chunks should already be cached
        if (this.worldDownloaded) {
            if (this.chunks.has(chunkKey)) {
                // Chunk is already cached, update trees if needed
                if (this.treeSystem) {
                    this.treeSystem.updateTreesForChunk(chunkX, chunkZ, this.chunkSize);
                }
                return;
            } else {
                console.warn(`[Terrain] Chunk (${chunkX}, ${chunkZ}) not found in cached world data`);
                return;
            }
        }
        
        // Fallback: If world not downloaded yet, trigger download
        console.log(`[Terrain] World not downloaded yet, triggering download for chunk (${chunkX}, ${chunkZ})`);
        await this.downloadEntireWorld();
        
        // After download, try again
        if (this.chunks.has(chunkKey)) {
            if (this.treeSystem) {
                this.treeSystem.updateTreesForChunk(chunkX, chunkZ, this.chunkSize);
            }
        }
    }
    
    unloadChunk(chunkKey) {
        const chunk = this.chunks.get(chunkKey);
        if (chunk) {
            this.chunks.delete(chunkKey);
        }
    }
    
    getHeight(x, y) {
        // If world not downloaded yet, return default height
        if (!this.worldDownloaded) {
            return 0; // Default height during world download
        }
        
        // Get height from cached world data
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(y / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            console.warn(`[Terrain] No chunk data for (${x}, ${y}) - chunk (${chunkX}, ${chunkZ}) not found in cached world`);
            console.log(`[Terrain] CRITICAL DEBUG: Looking for chunkKey "${chunkKey}" in cache of ${this.chunks.size} chunks`);
            console.log(`[Terrain] CRITICAL DEBUG: First 10 available chunk keys:`, Array.from(this.chunks.keys()).slice(0, 10));
            console.log(`[Terrain] CRITICAL DEBUG: World downloaded flag: ${this.worldDownloaded}`);
            return 0; // Default height if chunk not found
        }
        
        // Find the specific tile in chunk
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
        
        // Find the specific tile in the chunk
        const localX = x - (chunkX * this.chunkSize);
        const localZ = y - (chunkZ * this.chunkSize);
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
    
    getTileHeight(x, z) {
        return this.getHeight(x, z);
    }
    
    getNormal(x, z) {
        // Calculate terrain normal using height differences
        const delta = 0.1; // Small offset for normal calculation
        
        // Get heights at neighboring points
        const hCenter = this.getHeight(x, z);
        const hRight = this.getHeight(x + delta, z);
        const hLeft = this.getHeight(x - delta, z);
        const hUp = this.getHeight(x, z + delta);
        const hDown = this.getHeight(x, z - delta);
        
        // Calculate gradient vectors
        const dx = (hRight - hLeft) / (2 * delta);
        const dz = (hUp - hDown) / (2 * delta);
        
        // Normal vector (pointing upward from surface)
        const normal = new THREE.Vector3(-dx, 1, -dz);
        normal.normalize();
        
        return normal;
    }
    
    clearAllChunks() {
        // Simply clear the chunk map - no meshes to dispose
        this.chunks.clear();
        console.log('[Terrain] All chunks cleared');
    }
}
