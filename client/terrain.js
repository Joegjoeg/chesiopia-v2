// TERRAIN.JS - SUPER AGGRESSIVE CACHE BUSTING v2
// This file handles terrain generation and loading
console.log('[Terrain] === NEW VERSION LOADED ===');

class TerrainSystem {
    constructor(scene, treeSystem = null) {
        console.log('[Terrain] LOADING TERRAIN.JS');
        this.scene = scene;
        this.treeSystem = treeSystem;
        this.chunks = new Map();
        this.loadingChunks = new Set(); // Track chunks currently being loaded
        this.chunkSize = 32;
        this.loadDistance = 4; // Roughly equivalent to previous 96u coverage
        this.lastCameraChunk = { x: 0, z: 0 };
        this.worldDownloaded = false; // Flag to track if entire world has been downloaded
        this.onChunkLoaded = null; // Callback when a chunk is loaded
        this.onChunkUnloaded = null; // Callback when a chunk is unloaded
        
        // Probe system: foreknowledge of distant terrain
        this._lastProbeRequest = 0;
        this._probeThrottleMs = 2000; // Throttle probe requests to every 2s
        this._lastCameraPos = new THREE.Vector3();
        
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
            
            // Notify callback that chunk was loaded
            if (this.onChunkLoaded) {
                this.onChunkLoaded(chunkX, chunkZ);
            }
            
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
    
    async requestProbeAhead(cameraPos) {
        const now = performance.now();
        if (now - this._lastProbeRequest < this._probeThrottleMs) return;

        // Compute direction from last position delta
        const dx = cameraPos.x - this._lastCameraPos.x;
        const dz = cameraPos.z - this._lastCameraPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        this._lastCameraPos.copy(cameraPos);
        
        if (dist < 0.5) return; // Not moving enough
        
        const dirX = dx / dist;
        const dirZ = dz / dist;
        const probeDist = this.chunkSize * 3; // 3 chunks ahead
        const px = Math.floor(cameraPos.x + dirX * probeDist);
        const pz = Math.floor(cameraPos.z + dirZ * probeDist);

        try {
            this._lastProbeRequest = now;
            const response = await fetch(`/api/terrain/probe?x=${px}&z=${pz}&radius=48&profile=textured`);
            if (response.ok) {
                await response.json();
            }
        } catch (err) {
            // Silently ignore probe failures — non-critical
        }
    }

    setChunkSize(size) {
        const clamped = Math.max(8, Math.floor(size));
        if (clamped === this.chunkSize) return;
        console.log(`[Terrain] chunkSize changed ${this.chunkSize} -> ${clamped}`);
        this.chunkSize = clamped;
        this.loadDistance = Math.max(2, Math.round(96 / clamped));
        this.chunks.clear();
        this.loadingChunks.clear();
        this.lastCameraChunk = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
        if (this._lastCameraPos) {
            this.updateStreaming(this._lastCameraPos);
        }
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
    
    async updateChunks(cameraChunkX, cameraChunkZ) {
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
        
        // Load new chunks asynchronously
        const chunkPromises = chunksToLoad.map(chunk => this.loadChunk(chunk.x, chunk.z));
        await Promise.all(chunkPromises);
        
        // Unload distant chunks
        chunksToUnload.forEach(chunkKey => {
            this.unloadChunk(chunkKey);
        });
    }
    
    unloadChunk(chunkKey) {
        const chunk = this.chunks.get(chunkKey);
        if (!chunk) return;

        this.chunks.delete(chunkKey);

        if (typeof this.onChunkUnloaded === 'function') {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            this.onChunkUnloaded(chunkX, chunkZ);
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
            // Return default height without triggering chunk loading
            // Chunk loading should be handled separately, not during height sampling
            return 0; // Default height if chunk not found
        }
        
        // Find the specific tile in chunk
        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(y - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        
        const tile = chunk.data[tileIndex];
        if (!tile) {
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
    
    levelTerrainArea(gx, gz, width, depth, targetHeight) {
        if (!this.chunks) return;
        for (let dx = 0; dx < width; dx++) {
            for (let dz = 0; dz < depth; dz++) {
                const tx = gx + dx;
                const tz = gz + dz;
                const chunkX = Math.floor(tx / this.chunkSize);
                const chunkZ = Math.floor(tz / this.chunkSize);
                const chunkKey = `${chunkX},${chunkZ}`;
                const chunk = this.chunks.get(chunkKey);
                if (!chunk || !chunk.data) continue;
                const localX = Math.floor(tx - (chunkX * this.chunkSize));
                const localZ = Math.floor(tz - (chunkZ * this.chunkSize));
                const tileIndex = localZ * this.chunkSize + localX;
                if (tileIndex >= 0 && tileIndex < chunk.data.length) {
                    const tile = chunk.data[tileIndex];
                    if (tile) {
                        tile.height = targetHeight;
                        tile.isBlocked = false;
                    }
                }
            }
        }
    }

    clearAllChunks() {
        // Simply clear the chunk map - no meshes to dispose
        this.chunks.clear();
        console.log('[Terrain] All chunks cleared');
    }
}
