/**
 * GroundwaterSystem
 * Chunk-based cellular automata for surface water flow, pooling, and groundwater saturation.
 * Operates only within active radius of camera/player.
 */
class GroundwaterSystem {
    constructor(terrainGenerator, options = {}) {
        this.terrainGenerator = terrainGenerator;
        this.chunkSize = options.chunkSize || 16;
        this.activeRadius = options.activeRadius || 4;     // chunks from camera
        this.tickIntervalMs = options.tickIntervalMs || 2000;

        this.chunks = new Map();      // key="cx,cz" → GroundwaterChunk
        this.lastTick = 0;
        this.tickCount = 0;

        // CA parameters
        this.surfaceFlowRate = 0.20;   // 20% of surface water flows downhill per tick
        this.groundwaterSeepRate = 0.05; // 5% seeps slowly
        this.evapToSeaThreshold = 0.01;  // surface water below this drains
        this.poolThreshold = 0.02;     // visible pooled water depth
        this.maxPoolDepth = 2.0;       // cap pooling depth

        // Current camera position for chunk loading
        this.cameraChunkX = 0;
        this.cameraChunkZ = 0;
    }

    /**
     * Per-chunk groundwater data
     */
    _getOrCreateChunk(cx, cz) {
        const key = `${cx},${cz}`;
        if (!this.chunks.has(key)) {
            this.chunks.set(key, new GroundwaterChunk(cx, cz, this.chunkSize));
        }
        return this.chunks.get(key);
    }

    /**
     * World coordinates → chunk key
     */
    _worldToChunk(worldX, worldZ) {
        return {
            cx: Math.floor(worldX / this.chunkSize),
            cz: Math.floor(worldZ / this.chunkSize)
        };
    }

    /**
     * World coordinates → local chunk index
     */
    _worldToLocal(worldX, worldZ) {
        const lx = worldX - Math.floor(worldX / this.chunkSize) * this.chunkSize;
        const lz = worldZ - Math.floor(worldZ / this.chunkSize) * this.chunkSize;
        return { lx, lz };
    }

    /**
     * Public API: get surface water depth at world coordinates
     */
    getSurfaceWater(worldX, worldZ) {
        const { cx, cz } = this._worldToChunk(worldX, worldZ);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (!chunk) return 0;
        const { lx, lz } = this._worldToLocal(worldX, worldZ);
        return chunk.surfaceWater[lz * this.chunkSize + lx];
    }

    /**
     * Public API: get groundwater saturation at world coordinates
     */
    getGroundwater(worldX, worldZ) {
        const { cx, cz } = this._worldToChunk(worldX, worldZ);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (!chunk) return 0;
        const { lx, lz } = this._worldToLocal(worldX, worldZ);
        return chunk.groundwater[lz * this.chunkSize + lx];
    }

    /**
     * Public API: add surface water (from precipitation)
     */
    addSurfaceWater(worldX, worldZ, amount) {
        const { cx, cz } = this._worldToChunk(worldX, worldZ);
        const chunk = this._getOrCreateChunk(cx, cz);
        const { lx, lz } = this._worldToLocal(worldX, worldZ);
        const idx = lz * this.chunkSize + lx;
        chunk.surfaceWater[idx] = Math.min(
            this.maxPoolDepth,
            chunk.surfaceWater[idx] + amount
        );
    }

    /**
     * Public API: remove surface water (from evaporation)
     */
    removeSurfaceWater(worldX, worldZ, amount) {
        const { cx, cz } = this._worldToChunk(worldX, worldZ);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (!chunk) return;
        const { lx, lz } = this._worldToLocal(worldX, worldZ);
        const idx = lz * this.chunkSize + lx;
        chunk.surfaceWater[idx] = Math.max(0, chunk.surfaceWater[idx] - amount);
    }

    /**
     * Update active chunks based on camera position
     */
    updateCamera(worldX, worldZ) {
        const newCx = Math.floor(worldX / this.chunkSize);
        const newCz = Math.floor(worldZ / this.chunkSize);

        if (newCx === this.cameraChunkX && newCz === this.cameraChunkZ) return;

        this.cameraChunkX = newCx;
        this.cameraChunkZ = newCz;

        // Load new chunks in active radius
        for (let dz = -this.activeRadius; dz <= this.activeRadius; dz++) {
            for (let dx = -this.activeRadius; dx <= this.activeRadius; dx++) {
                this._getOrCreateChunk(newCx + dx, newCz + dz);
            }
        }

        // Unload distant chunks
        for (const [key, chunk] of this.chunks) {
            const dist = Math.max(
                Math.abs(chunk.cx - newCx),
                Math.abs(chunk.cz - newCz)
            );
            if (dist > this.activeRadius + 1) {
                this.chunks.delete(key);
            }
        }
    }

    /**
     * Run cellular automata tick on all active chunks
     */
    tick(now) {
        if (now - this.lastTick < this.tickIntervalMs) return;
        this.lastTick = now;
        this.tickCount++;

        // Build lookup for neighbor chunks (to handle cross-chunk flow)
        const neighborChunks = new Map();
        for (const [key, chunk] of this.chunks) {
            neighborChunks.set(key, chunk);
        }

        // Tick each active chunk
        for (const chunk of this.chunks.values()) {
            this._tickChunk(chunk, neighborChunks);
        }
    }

    /**
     * Cellular automata rules for one chunk
     */
    _tickChunk(chunk, allChunks) {
        const cs = this.chunkSize;
        const newSurface = new Float32Array(chunk.surfaceWater);
        const newGround = new Float32Array(chunk.groundwater);

        for (let lz = 0; lz < cs; lz++) {
            for (let lx = 0; lx < cs; lx++) {
                const idx = lz * cs + lx;
                const worldX = chunk.cx * cs + lx;
                const worldZ = chunk.cz * cs + lz;
                const height = this.terrainGenerator.getHeight(worldX, worldZ);

                // Rule 1: Drain to sea
                if (height < this.terrainGenerator.waterLevel) {
                    newSurface[idx] = 0; // drains to global sea
                    continue;
                }

                // Rule 2: Surface water flows downhill
                const currentSurf = chunk.surfaceWater[idx];
                if (currentSurf > this.evapToSeaThreshold) {
                    const flowAmt = this._computeFlow(chunk, allChunks, lx, lz, currentSurf, this.surfaceFlowRate);
                    if (flowAmt > 0) {
                        newSurface[idx] -= flowAmt;
                        // flowAmt is distributed to neighbors in _computeFlow
                    }
                }

                // Rule 3: Groundwater seeps slowly
                const currentGw = chunk.groundwater[idx];
                if (currentGw > 0.1) {
                    const seepAmt = this._computeFlow(chunk, allChunks, lx, lz, currentGw * 0.5, this.groundwaterSeepRate);
                    if (seepAmt > 0) {
                        newGround[idx] -= seepAmt / 0.5;
                    }
                }

                // Rule 4: Surface water feeds groundwater
                if (newSurface[idx] > this.poolThreshold) {
                    const infiltration = newSurface[idx] * 0.05;
                    newGround[idx] = Math.min(1, newGround[idx] + infiltration);
                }

                // Rule 5: High groundwater feeds surface
                if (newGround[idx] > 0.8 && newSurface[idx] < this.poolThreshold) {
                    newSurface[idx] += (newGround[idx] - 0.8) * 0.1;
                }
            }
        }

        chunk.surfaceWater = newSurface;
        chunk.groundwater = newGround;
    }

    /**
     * Compute downhill flow amount and distribute to neighbors
     * Returns amount that flowed out of this cell
     */
    _computeFlow(chunk, allChunks, lx, lz, amount, rate) {
        const cs = this.chunkSize;
        const idx = lz * cs + lx;
        const worldX = chunk.cx * cs + lx;
        const worldZ = chunk.cz * cs + lz;
        const currentHeight = this.terrainGenerator.getHeight(worldX, worldZ);

        let bestNeighbor = null;
        let bestDiff = 0;

        // Check 8 neighbors
        const neighbors = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
            { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
            { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
        ];

        for (const n of neighbors) {
            const nlx = lx + n.dx;
            const nlz = lz + n.dy;

            // Handle cross-chunk neighbors
            let nChunk = chunk;
            let nnlx = nlx;
            let nnlz = nlz;

            if (nlx < 0 || nlx >= cs || nlz < 0 || nlz >= cs) {
                const ncx = chunk.cx + Math.floor(nlx / cs);
                const ncz = chunk.cz + Math.floor(nlz / cs);
                const nKey = `${ncx},${ncz}`;
                nChunk = allChunks.get(nKey);
                if (!nChunk) continue;
                nnlx = ((nlx % cs) + cs) % cs;
                nnlz = ((nlz % cs) + cs) % cs;
            }

            const nIdx = nnlz * cs + nnlx;
            const nWorldX = nChunk.cx * cs + nnlx;
            const nWorldZ = nChunk.cz * cs + nnlz;
            const nHeight = this.terrainGenerator.getHeight(nWorldX, nWorldZ);
            const nTotalHeight = nHeight + nChunk.surfaceWater[nIdx];

            const diff = (currentHeight + chunk.surfaceWater[idx]) - nTotalHeight;
            if (diff > bestDiff) {
                bestDiff = diff;
                bestNeighbor = { chunk: nChunk, idx: nIdx, diff };
            }
        }

        if (bestNeighbor && bestDiff > 0.01) {
            const flowAmt = Math.min(amount * rate, bestDiff * 0.5);
            if (flowAmt > 0.001) {
                bestNeighbor.chunk.surfaceWater[bestNeighbor.idx] += flowAmt;
                return flowAmt;
            }
        }

        return 0;
    }

    /**
     * Check if a world position has visible pooled water
     */
    hasPool(worldX, worldZ) {
        return this.getSurfaceWater(worldX, worldZ) > this.poolThreshold;
    }

    /**
     * Get all active chunks for rendering
     */
    getActiveChunks() {
        return Array.from(this.chunks.values());
    }

    /**
     * Get chunk by world coordinates
     */
    getChunk(worldX, worldZ) {
        const { cx, cz } = this._worldToChunk(worldX, worldZ);
        return this.chunks.get(`${cx},${cz}`);
    }
}

/**
 * Per-chunk groundwater data
 */
class GroundwaterChunk {
    constructor(cx, cz, chunkSize) {
        this.cx = cx;
        this.cz = cz;
        this.chunkSize = chunkSize;
        this.surfaceWater = new Float32Array(chunkSize * chunkSize);
        this.groundwater = new Float32Array(chunkSize * chunkSize);
        this.lastTick = 0;
    }
}

// Export for both module and global use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GroundwaterSystem, GroundwaterChunk };
}
