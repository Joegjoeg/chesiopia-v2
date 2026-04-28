// TERRAIN-NEW.JS - SUPER AGGRESSIVE CACHE BUSTING v3
// This file handles terrain generation and loading
console.log('[Terrain] === NEW VERSION LOADED ===');

class TerrainSystem {
    constructor(scene, treeSystem = null) {
        console.log('[Terrain] LOADING TERRAIN-NEW.JS v3 - SUPER AGGRESSIVE CACHE BUSTING');
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
        console.log('[Terrain] STARTING WORLD DOWNLOAD - THIS SHOULD APPEAR!');
        
        try {
            console.log('[Terrain] STEP 1: Fetching world data...');
            const response = await fetch('/api/terrain/world');
            
            if (!response.ok) {
                if (response.status === 503) {
                    console.log('[Terrain] World still generating, retrying in 2 seconds...');
                    setTimeout(() => this.downloadEntireWorld(), 2000);
                    return;
                }
                throw new Error(`Failed to download world: ${response.status}`);
            }
            
            console.log('[Terrain] STEP 2: Parsing JSON response...');
            const worldData = await response.json();
            console.log(`[Terrain] STEP 3: Parsed world with ${Object.keys(worldData.chunks).length} chunks`);
            
            // Validate world data structure
            if (!worldData || !worldData.chunks) {
                console.error('[Terrain] Invalid world data structure:', worldData);
                throw new Error('Invalid world data received');
            }
            
            console.log('[Terrain] STEP 4: Starting chunk caching loop...');
            console.log(`[Terrain] CRITICAL: About to cache ${Object.keys(worldData.chunks).length} chunks`);
            
            // Cache all chunks locally
            let loadedChunks = 0;
            const totalChunks = Object.keys(worldData.chunks).length;
            const chunkEntries = Object.entries(worldData.chunks);
            
            console.log(`[Terrain] CRITICAL: Total chunk entries to process: ${chunkEntries.length}`);
            
            for (const [chunkKey, chunkData] of chunkEntries) {
                this.chunks.set(chunkKey, {
                    data: chunkData,
                    loaded: true
                });
                loadedChunks++;
                
                // Log progress more frequently
                if (loadedChunks % 50 === 0) {
                    console.log(`[Terrain] PROGRESS: ${loadedChunks}/${totalChunks} chunks cached (${Math.round(loadedChunks/totalChunks*100)}%)`);
                }
                
                // Debug: Log first few chunk keys and data structure
                if (loadedChunks <= 5) {
                    console.log(`[Terrain] DEBUG: Chunk ${chunkKey} data:`, {
                        key: chunkKey,
                        dataType: typeof chunkData,
                        isArray: Array.isArray(chunkData),
                        length: chunkData.length,
                        firstItem: chunkData[0]
                    });
                }
                
                // Debug: Log every 100th chunk to see progress
                if (loadedChunks % 100 === 0) {
                    console.log(`[Terrain] MILESTONE: Cached ${loadedChunks} chunks, last key: ${chunkKey}`);
                }
            }
            
            console.log('[Terrain] STEP 5: Caching loop completed!');
            console.log(`[Terrain] CRITICAL FINAL: Expected ${totalChunks}, actually cached ${this.chunks.size} chunks`);
            console.log(`[Terrain] CRITICAL FINAL: First 10 server keys:`, Object.keys(worldData.chunks).slice(0, 10));
            console.log(`[Terrain] CRITICAL FINAL: First 10 cache keys:`, Array.from(this.chunks.keys()).slice(0, 10));
            
            this.worldDownloaded = true;
            console.log('[Terrain] STEP 6: World download completed successfully!');
            
        } catch (error) {
            console.error('[Terrain] ERROR IN WORLD DOWNLOAD:', error);
            setTimeout(() => this.downloadEntireWorld(), 5000); // Retry after 5 seconds
        }
    }
    
    async generateInitialTerrain(centerX, centerZ, radius) {
        console.log(`[Terrain] generateInitialTerrain called - worldDownloaded: ${this.worldDownloaded}`);
        // If world not downloaded yet, download it first
        if (!this.worldDownloaded) {
            console.log('[Terrain] World not downloaded, triggering download...');
            await this.downloadEntireWorld();
        }
        
        console.log(`[Terrain] Initial terrain generation complete. World downloaded: ${this.worldDownloaded}`);
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
            return;
        }
        
        // If still not found after download, something is wrong
        console.error(`[Terrain] Chunk (${chunkX}, ${chunkZ}) still not found after world download attempt.`);
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
        
        // Unload distant chunks
        chunksToUnload.forEach(chunkKey => {
            this.unloadChunk(chunkKey);
        });
    }
    
    unloadChunk(chunkKey) {
        const chunk = this.chunks.get(chunkKey);
        if (chunk && chunk.mesh) {
            this.scene.remove(chunk.mesh);
            chunk.mesh.geometry.dispose();
            chunk.mesh.material.dispose();
        }
        this.chunks.delete(chunkKey);
    }
    
    updateStreaming() {
        // For single world download, this method is no-op
        // All chunks are already cached after world download
    }
}
