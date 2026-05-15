// TERRAIN-NEW.JS - SUPER AGGRESSIVE CACHE BUSTING v3
// This file handles terrain generation and loading
console.log('[Terrain] === NEW VERSION LOADED ===');

class TerrainSystem {
    constructor(scene, treeSystem = null) {
        console.log('[Terrain] LOADING TERRAIN-NEW.JS v3 - SUPER AGGRESSIVE CACHE BUSTING');
        this.scene = scene;
        this.treeSystem = treeSystem;
        this.chunks = new Map();
        this.loadingChunks = new Set(); // Track chunks currently being loaded
        this.chunkSize = 16;
        this.loadDistance = 6; // Expanded for wider camera cone (96 units / 16 chunk size)
        this.lastCameraChunk = { x: 0, z: 0 };
        this.worldDownloaded = false; // Flag to track if entire world has been downloaded
        this.onChunkLoaded = null; // Callback when a chunk is loaded
        
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

        this.debug = {
            enabled: false,
            verbose: false,
            chunkSeq: 0,
            squareWatch: new Map(),
        };

        if (typeof window !== 'undefined') {
            if (!window.__terrainSystems) window.__terrainSystems = [];
            window.__terrainSystems.push(this);
            if (!window.TerrainDebug) {
                const api = {
                    enable: (on = true) => window.__terrainSystems.forEach(ts => ts.setDebugEnabled(on)),
                    setVerbose: (on = true) => window.__terrainSystems.forEach(ts => ts.setDebugVerbose(on)),
                    watchSquare: (x, z) => window.__terrainSystems.forEach(ts => ts.debugWatchSquare(x, z)),
                    clearWatch: () => window.__terrainSystems.forEach(ts => ts.debugClearWatch()),
                };
                window.TerrainDebug = api;
                console.log('[TerrainDebug] API available: TerrainDebug.enable(on), setVerbose(on), watchSquare(x,z), clearWatch()');
            }
        }
    }

    setDebugEnabled(on) {
        this.debug.enabled = !!on;
        if (this.debug.enabled) console.log('[TerrainDebug] enabled');
    }

    setDebugVerbose(on) {
        this.debug.verbose = !!on;
        if (this.debug.enabled) console.log('[TerrainDebug] verbose =', this.debug.verbose);
    }

    debugWatchSquare(x, z) {
        const k = `${Math.floor(x)},${Math.floor(z)}`;
        this.debug.squareWatch.set(k, { x: Math.floor(x), z: Math.floor(z) });
        if (this.debug.enabled) console.log('[TerrainDebug] watch', k);
    }

    debugClearWatch() {
        this.debug.squareWatch.clear();
        if (this.debug.enabled) console.log('[TerrainDebug] cleared watch list');
    }

    _debugLog(...args) {
        if (this.debug.enabled) console.log(...args);
    }

    _debugLogV(...args) {
        if (this.debug.enabled && this.debug.verbose) console.log(...args);
    }
    
    async downloadEntireWorld() {
        // console.log('[Terrain] STARTING WORLD DOWNLOAD - THIS SHOULD APPEAR!');
        
        try {
            // console.log('[Terrain] On-demand world initialization - no pre-download needed');
            
            // Set default color palette (will be generated from chunk data)
            this.colorPalette = [
                { r: 0.2, g: 0.6, b: 0.2 },  // grass
                { r: 0.8, g: 0.7, b: 0.4 },  // sand
                { r: 0.2, g: 0.4, b: 0.7 },  // water
                { r: 0.1, g: 0.4, b: 0.1 }   // dark grass
            ];
            
            this.worldDownloaded = true;
            // console.log('[Terrain] On-demand initialization complete - chunks will load as needed');
            
        } catch (error) {
            console.error('[Terrain] ERROR IN INITIALIZATION:', error);
            setTimeout(() => this.downloadEntireWorld(), 5000); // Retry after 5 seconds
        }
    }
    
    async generateInitialTerrain(centerX, centerZ, radius) {
        // console.log(`[Terrain] generateInitialTerrain called - worldDownloaded: ${this.worldDownloaded}`);
        // If world not downloaded yet, download it first
        if (!this.worldDownloaded) {
            console.log('[Terrain] World not downloaded, triggering download...');
            await this.downloadEntireWorld();
        }
        
        // Load chunks around initial position
        const chunkRadius = Math.ceil(radius / this.chunkSize);
        const centerChunkX = Math.floor(centerX / this.chunkSize);
        const centerChunkZ = Math.floor(centerZ / this.chunkSize);
        
        // console.log(`[Terrain] Loading chunks around (${centerChunkX}, ${centerChunkZ}) with radius ${chunkRadius}`);
        
        // Build load list and sort by distance so center loads first
        const chunksToLoad = [];
        for (let x = centerChunkX - chunkRadius; x <= centerChunkX + chunkRadius; x++) {
            for (let z = centerChunkZ - chunkRadius; z <= centerChunkZ + chunkRadius; z++) {
                const dist = Math.max(Math.abs(x - centerChunkX), Math.abs(z - centerChunkZ));
                chunksToLoad.push({ x, z, dist });
            }
        }
        chunksToLoad.sort((a, b) => a.dist - b.dist);

        // Load in batches so the browser isn't overwhelmed with parallel HTTP requests
        const batchSize = 6;
        for (let i = 0; i < chunksToLoad.length; i += batchSize) {
            const batch = chunksToLoad.slice(i, i + batchSize);
            await Promise.all(batch.map(c => this.loadChunk(c.x, c.z)));
        }

        // console.log(`[Terrain] Initial terrain generation complete. Loaded ${this.chunks.size} chunks`);
    }

    // Load a large cache progressively in the background so camera movement is stutter-free
    async warmChunkCache(centerX, centerZ, targetRadius) {
        const chunkRadius = Math.ceil(targetRadius / this.chunkSize);
        const centerChunkX = Math.floor(centerX / this.chunkSize);
        const centerChunkZ = Math.floor(centerZ / this.chunkSize);

        // Skip the inner radius already loaded by generateInitialTerrain
        const skipRadius = Math.ceil(chunkRadius * 0.4);

        for (let ring = skipRadius; ring <= chunkRadius; ring++) {
            const ringChunks = [];
            for (let x = centerChunkX - ring; x <= centerChunkX + ring; x++) {
                for (let z = centerChunkZ - ring; z <= centerChunkZ + ring; z++) {
                    if (Math.abs(x - centerChunkX) === ring || Math.abs(z - centerChunkZ) === ring) {
                        const key = `${x},${z}`;
                        if (!this.chunks.has(key) && !this._loadingPromises?.has(key)) {
                            ringChunks.push(this.loadChunk(x, z));
                        }
                    }
                }
            }
            if (ringChunks.length > 0) {
                await Promise.all(ringChunks);
            }
            // Yield to event loop so we don't block rendering
            await new Promise(r => requestAnimationFrame(r));
        }
        // console.log(`[Terrain] Warm cache complete. Total chunks: ${this.chunks.size}`);
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
            const tk = `${Math.floor(x)},${Math.floor(y)}`;
            if (this.debug.enabled && this.debug.squareWatch.has(tk)) {
                this._debugLog('[TerrainDebug] getHeight miss', { world: tk, chunkKey });
            }
            return 0; // Default height if chunk not found
        }
        
        // Find the specific tile in chunk
        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(y - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        
        const tile = chunk.data[tileIndex];
        const tk = `${Math.floor(x)},${Math.floor(y)}`;
        if (this.debug.enabled && this.debug.squareWatch.has(tk)) {
            this._debugLog('[TerrainDebug] getHeight', { world: tk, chunkKey, localX, localZ, tileIndex, hasTile: !!tile });
        }
        if (!tile) {
            return 0; // Default height if tile not found
        }
        
        return tile.height || 0;
    }
    
    isTileBlocked(x, y) {
        if (!this.worldDownloaded) {
            return false;
        }
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(y / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            const tk = `${Math.floor(x)},${Math.floor(y)}`;
            if (this.debug.enabled && this.debug.squareWatch.has(tk)) {
                this._debugLog('[TerrainDebug] isTileBlocked miss', { world: tk, chunkKey });
            }
            return false;
        }
        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(y - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        const tile = chunk.data[tileIndex];
        const tk = `${Math.floor(x)},${Math.floor(y)}`;
        if (this.debug.enabled && this.debug.squareWatch.has(tk)) {
            this._debugLog('[TerrainDebug] isTileBlocked', { world: tk, chunkKey, localX, localZ, tileIndex, hasTile: !!tile });
        }
        return tile ? (tile.isBlocked || false) : false;
    }

    getTileData(x, y) {
        if (!this.worldDownloaded) {
            return null;
        }
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(y / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            const tk = `${Math.floor(x)},${Math.floor(y)}`;
            if (this.debug.enabled && this.debug.squareWatch.has(tk)) {
                this._debugLog('[TerrainDebug] getTileData miss', { world: tk, chunkKey });
            }
            return null;
        }
        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(y - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        const tile = chunk.data[tileIndex] || null;
        const tk = `${Math.floor(x)},${Math.floor(y)}`;
        if (this.debug.enabled && this.debug.squareWatch.has(tk)) {
            this._debugLog('[TerrainDebug] getTileData', { world: tk, chunkKey, localX, localZ, tileIndex, hasTile: !!tile });
        }
        return tile;
    }

    getNormal(x, z) {
        if (!this.worldDownloaded) {
            return new THREE.Vector3(0, 1, 0);
        }
        // Sample adjacent tiles (delta=1) because getHeight floors to tile indices,
        // so delta<1 always returns the same tile height.
        const hRight = this.getHeight(x + 1, z);
        const hLeft  = this.getHeight(x - 1, z);
        const hUp    = this.getHeight(x, z + 1);
        const hDown  = this.getHeight(x, z - 1);
        const dx = (hRight - hLeft) * 0.5;
        const dz = (hUp - hDown) * 0.5;
        const normal = new THREE.Vector3(-dx, 1, -dz);
        normal.normalize();
        return normal;
    }

    async loadChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        // Check if already loaded
        if (this.chunks.has(chunkKey)) {
            if (this.treeSystem && typeof this.treeSystem.updateTreesForChunk === 'function') {
                this.treeSystem.updateTreesForChunk(chunkX, chunkZ, this.chunkSize);
            }
            return this.chunks.get(chunkKey).data;
        }
        
        // Deduplicate in-flight loads
        if (this._loadingPromises && this._loadingPromises.has(chunkKey)) {
            return this._loadingPromises.get(chunkKey);
        }
        
        const promise = this._doLoadChunk(chunkX, chunkZ);
        if (!this._loadingPromises) this._loadingPromises = new Map();
        this._loadingPromises.set(chunkKey, promise);
        try {
            return await promise;
        } finally {
            this._loadingPromises.delete(chunkKey);
        }
    }
    
    async _doLoadChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        // Load from server
        try {
            const seq = ++this.debug.chunkSeq;
            const dist = Math.max(Math.abs(chunkX - this.lastCameraChunk.x), Math.abs(chunkZ - this.lastCameraChunk.z));
            this._debugLog('[TerrainDebug] req', { seq, chunkKey, dist });
            // console.log(`[Terrain] Loading chunk on-demand: ${chunkKey}`);
            const response = await fetch(`/api/terrain/chunk/${chunkX}/${chunkZ}`);
            
            if (!response.ok) {
                throw new Error(`Failed to load chunk ${chunkKey}: ${response.status}`);
            }
            
            const chunkData = await response.json();
            // console.log(`[Terrain] Loaded chunk ${chunkKey} with ${chunkData.length} tiles`);
            this._debugLog('[TerrainDebug] loaded', { seq, chunkKey, tiles: chunkData.length });
            
            // Cache the chunk
            this.chunks.set(chunkKey, {
                data: chunkData,
                loaded: true
            });
            
            // Notify callback that chunk was loaded
            if (this.onChunkLoaded) {
                this.onChunkLoaded(chunkX, chunkZ);
            }
            if (this.debug.enabled && this.debug.squareWatch.size > 0) {
                for (const [k, pos] of this.debug.squareWatch) {
                    const cx = Math.floor(pos.x / this.chunkSize);
                    const cz = Math.floor(pos.z / this.chunkSize);
                    if (cx === chunkX && cz === chunkZ) this._debugLog('[TerrainDebug] watched square now in chunk', { square: k, chunkKey });
                }
            }
            
            return chunkData;
        } catch (error) {
            console.error(`[Terrain] Error loading chunk ${chunkKey}:`, error);
            return null;
        }
    }
    
    async updateChunks(cameraChunkX, cameraChunkZ) {
        // console.log(`[Terrain] Updating chunks for camera at: ${cameraChunkX},${cameraChunkZ}`);
        
        const chunksToLoad = [];
        const chunksToUnload = [];
        
        // ALWAYS ensure camera's current chunk is loaded first
        const currentChunkKey = `${cameraChunkX},${cameraChunkZ}`;
        if (!this.chunks.has(currentChunkKey)) {
            // console.log(`[Terrain] PRIORITY: Loading camera's current chunk ${currentChunkKey}`);
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
                        // console.log(`[Terrain] Loading chunk ${chunkKey}`);
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
                // console.log(`[Terrain] Unloading distant chunk ${chunkKey} (distance: ${distance})`);
                chunksToUnload.push(chunkKey);
            }
        }
        
        if (this.debug.enabled) {
            const list = chunksToLoad.map(c => ({ key: `${c.x},${c.z}`, d: Math.max(Math.abs(c.x - cameraChunkX), Math.abs(c.z - cameraChunkZ)) }));
            this._debugLog('[TerrainDebug] toLoad', list.slice(0, 24));
        }
        
        // Sort by distance so nearer chunks load first
        chunksToLoad.sort((a, b) => {
            const da = Math.max(Math.abs(a.x - cameraChunkX), Math.abs(a.z - cameraChunkZ));
            const db = Math.max(Math.abs(b.x - cameraChunkX), Math.abs(b.z - cameraChunkZ));
            return da - db;
        });
        
        // Load new chunks in batches to limit concurrency
        const batchSize = 6;
        for (let i = 0; i < chunksToLoad.length; i += batchSize) {
            const batch = chunksToLoad.slice(i, i + batchSize);
            await Promise.all(batch.map(chunk => this.loadChunk(chunk.x, chunk.z)));
        }
        
        // Unload distant chunks
        chunksToUnload.forEach(chunkKey => {
            if (this.debug.enabled) this._debugLog('[TerrainDebug] unload', { chunkKey });
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
    
    updateStreaming(cameraPosition) {
        const cameraChunkX = Math.floor(cameraPosition.x / this.chunkSize);
        const cameraChunkZ = Math.floor(cameraPosition.z / this.chunkSize);

        // Check if camera moved to a new chunk
        if (cameraChunkX !== this.lastCameraChunk.x || cameraChunkZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: cameraChunkX, z: cameraChunkZ };
            this.updateChunks(cameraChunkX, cameraChunkZ);
        }
    }
}
