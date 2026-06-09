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
        this.chunkSize = 32;
        this.loadDistance = 4; // Roughly equivalent to previous 96u coverage
        this.lastCameraChunk = { x: 0, z: 0 };
        this.worldDownloaded = false; // Flag to track if entire world has been downloaded
        this.onChunkLoaded = null; // Callback when a chunk is loaded
        this._pendingChunkDeltas = new Map();

        // Persistent client ID so the server can maintain per-client terrain caches and orbit scales
        this.clientId = localStorage.getItem('chessopiaClientId') || this._generateClientId();
        localStorage.setItem('chessopiaClientId', this.clientId);
        console.log(`[Terrain] clientId=${this.clientId}`);
        
        // Probe system: foreknowledge of distant terrain
        this._lastProbeRequest = 0;
        this._probeThrottleMs = 2000;
        this._lastCameraPos = new THREE.Vector3();

        // Terrain generation warning light (red studio light)
        this._genWarningLight = null;
        this._genWarningActive = false;
        this._genWarningTimeout = null;
        
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

        this._applyPendingDeltasForChunk(chunkKey);

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

        let height = tile.height || 0;

        // Dynamic edge blending: when a neighbor chunk is loaded, blend the border
        // tiles so both sides of the boundary have a smooth transition.  This fixes
        // the C1 discontinuity caused by the server only blending the newly generated
        // chunk and leaving the previously cached neighbour with raw heights.
        const blendWidth = 2;
        let blendedHeight = height;
        let totalWeight = 0;

        const getNeighborTile = (nk, nx, nz) => {
            const nc = this.chunks.get(nk);
            if (!nc || !nc.data) return null;
            const idx = nz * this.chunkSize + nx;
            return (idx >= 0 && idx < nc.data.length) ? nc.data[idx] : null;
        };

        // North edge (localZ near 0)
        if (localZ < blendWidth) {
            const nTile = getNeighborTile(`${chunkX},${chunkZ - 1}`, localX, this.chunkSize - 1 - localZ);
            if (nTile) {
                const t = localZ / blendWidth;
                const w = (1 - t) * (1 - t);
                blendedHeight = blendedHeight * (1 - w) + nTile.height * w;
                totalWeight += w;
            }
        }

        // South edge (localZ near chunkSize-1)
        if (localZ >= this.chunkSize - blendWidth) {
            const distFromEdge = (this.chunkSize - 1 - localZ);
            const nTile = getNeighborTile(`${chunkX},${chunkZ + 1}`, localX, distFromEdge);
            if (nTile) {
                const t = distFromEdge / blendWidth;
                const w = (1 - t) * (1 - t);
                blendedHeight = blendedHeight * (1 - w) + nTile.height * w;
                totalWeight += w;
            }
        }

        // West edge (localX near 0)
        if (localX < blendWidth) {
            const nTile = getNeighborTile(`${chunkX - 1},${chunkZ}`, this.chunkSize - 1 - localX, localZ);
            if (nTile) {
                const t = localX / blendWidth;
                const w = (1 - t) * (1 - t);
                blendedHeight = blendedHeight * (1 - w) + nTile.height * w;
                totalWeight += w;
            }
        }

        // East edge (localX near chunkSize-1)
        if (localX >= this.chunkSize - blendWidth) {
            const distFromEdge = (this.chunkSize - 1 - localX);
            const nTile = getNeighborTile(`${chunkX + 1},${chunkZ}`, distFromEdge, localZ);
            if (nTile) {
                const t = distFromEdge / blendWidth;
                const w = (1 - t) * (1 - t);
                blendedHeight = blendedHeight * (1 - w) + nTile.height * w;
                totalWeight += w;
            }
        }

        return totalWeight > 0 ? blendedHeight : height;
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

        this._applyPendingDeltasForChunk(chunkKey);

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

        this._applyPendingDeltasForChunk(chunkKey);

        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(y - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        return chunk.data[tileIndex] || null;
    }

    refreshChunkMesh(chunkKey) {
        // Mark chunk for rebuild — the update loop will regenerate geometry
        const chunk = this.chunks.get(chunkKey);
        if (chunk) chunk._needsRebuild = true;
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
            const response = await fetch(`/api/terrain/chunk/${chunkX}/${chunkZ}?clientId=${this.clientId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to load chunk ${chunkKey}: ${response.status}`);
            }
            
            const chunkData = await response.json();
            // console.log(`[Terrain] Loaded chunk ${chunkKey} with ${chunkData.length} tiles`);
            this._debugLog('[TerrainDebug] loaded', { seq, chunkKey, tiles: chunkData.length });
            
            // Cache the chunk
            const chunkRecord = {
                data: chunkData,
                loaded: true
            };
            this.chunks.set(chunkKey, chunkRecord);
            this._applyPendingDeltasForChunk(chunkKey);

            // Flash red warning light for terrain generation
            this._flashGenWarning();
            
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

        const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
        if (this.onChunkUnloaded) {
            this.onChunkUnloaded(chunkX, chunkZ);
        }
    }
    
    async requestProbeAhead(cameraPos) {
        const now = performance.now();
        if (now - this._lastProbeRequest < this._probeThrottleMs) return;

        const dx = cameraPos.x - this._lastCameraPos.x;
        const dz = cameraPos.z - this._lastCameraPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        this._lastCameraPos.copy(cameraPos);
        if (dist < 0.5) return;

        const dirX = dx / dist;
        const dirZ = dz / dist;
        const aheadChunkX = Math.floor((cameraPos.x + dirX * this.chunkSize * 3) / this.chunkSize);
        const aheadChunkZ = Math.floor((cameraPos.z + dirZ * this.chunkSize * 3) / this.chunkSize);

        this._lastProbeRequest = now;

        // Prefetch a small cone of chunks ahead of the camera
        const prefetchRadius = 2;
        for (let ox = -prefetchRadius; ox <= prefetchRadius; ox++) {
            for (let oz = -prefetchRadius; oz <= prefetchRadius; oz++) {
                const cx = aheadChunkX + ox;
                const cz = aheadChunkZ + oz;
                const key = `${cx},${cz}`;
                if (!this.chunks.has(key) && !this.loadingChunks.has(key)) {
                    this.loadChunk(cx, cz).catch(() => {});
                }
            }
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
        if (typeof this.onChunkSizeChanged === 'function') {
            try { this.onChunkSizeChanged(clamped); } catch (err) { console.warn('[Terrain] onChunkSizeChanged error', err); }
        }
        if (this._lastCameraPos) {
            this.updateStreaming(this._lastCameraPos);
        }
    }

    _flashGenWarning() {
        if (!this._genWarningLight) {
            this._genWarningLight = new THREE.PointLight(0xff0000, 0, 200);
            this._genWarningLight.position.set(0, 30, 0);
            this.scene.add(this._genWarningLight);
        }
        this._genWarningLight.intensity = 3;
        this._genWarningActive = true;
        if (this._genWarningTimeout) clearTimeout(this._genWarningTimeout);
        this._genWarningTimeout = setTimeout(() => {
            this._genWarningLight.intensity = 0;
            this._genWarningActive = false;
        }, 800);
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

    applyHeightDeltas(chunkKey, deltas) {
        if (!chunkKey || !Array.isArray(deltas) || deltas.length === 0) return;
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            const existing = this._pendingChunkDeltas.get(chunkKey) || [];
            existing.push(...deltas);
            this._pendingChunkDeltas.set(chunkKey, existing);
            return;
        }
        this._applyDeltasToChunk(chunkKey, chunk, deltas);
    }

    _applyPendingDeltasForChunk(chunkKey) {
        if (!this._pendingChunkDeltas.has(chunkKey)) return;
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) return;
        const deltas = this._pendingChunkDeltas.get(chunkKey);
        this._applyDeltasToChunk(chunkKey, chunk, deltas);
        this._pendingChunkDeltas.delete(chunkKey);
    }

    _applyDeltasToChunk(chunkKey, chunk, deltas) {
        if (!chunk || !chunk.data || !Array.isArray(deltas)) return;
        let updated = false;
        for (const d of deltas) {
            if (!d || typeof d.localX !== 'number' || typeof d.localZ !== 'number') continue;
            const idx = d.localZ * this.chunkSize + d.localX;
            if (idx < 0 || idx >= chunk.data.length) continue;
            let tile = chunk.data[idx];
            if (!tile || typeof tile !== 'object') {
                tile = {};
                chunk.data[idx] = tile;
            }
            if (d.height !== undefined) {
                tile.height = d.height;
                updated = true;
            }
            if (d.isBlocked !== undefined) {
                tile.isBlocked = d.isBlocked;
                updated = true;
            }
            if (d.biome !== undefined) {
                tile.biome = d.biome;
                updated = true;
            }
        }
        if (updated) {
            chunk._needsRebuild = true;
            if (this.onChunkLoaded) {
                const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
                try {
                    this.onChunkLoaded(chunkX, chunkZ);
                } catch (err) {
                    console.warn('[Terrain] onChunkLoaded callback failed after delta apply:', err);
                }
            }
        }
    }

    _generateClientId() {
        // Generate a random 16-char hex string for client identification
        const arr = new Uint8Array(8);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(arr);
        } else {
            for (let i = 0; i < 8; i++) arr[i] = Math.floor(Math.random() * 256);
        }
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }
}
