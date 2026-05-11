// RollingTerrainMesh — Fixed-capacity rolling terrain grid
//  - Uses a single BufferGeometry whose topology never changes.
//  - Only Y (height) is updated when the camera crosses a hysteresis threshold.
//  - Ring-buffer heads rotate logical world rows/cols so new edge data
//    overwrites the leaving edge data without reallocating buffers.
//
//  No per-frame geometry recreation. No dynamic arrays. Minimal GC.

class RollingTerrainMesh {
    constructor(boardSystem, terrainSystem, options = {}) {
        this.board    = boardSystem;
        this.terrain  = terrainSystem;
        this.N        = options.gridSize        || 64;   // vertices per axis
        this.S        = options.cellSize        || 1;    // world units per cell
        this.threshold = options.thresholdCells || 12;  // safe-zone margin
        this.maxStep  = options.maxStepPerFrame || 8;   // per-axis clamp

        this.originX = 0;    // world X of local vertex (0,0)
        this.originZ = 0;    // world Z of local vertex (0,0)

        // Static geometry: x/z never change; y is updated on roll.
        const vertCount = this.N * this.N;
        const positions = new Float32Array(vertCount * 3);
        const colors    = new Float32Array(vertCount * 3);
        const uvs       = new Float32Array(vertCount * 2);
        const indices   = [];

        for (let z = 0; z < this.N; z++) {
            for (let x = 0; x < this.N; x++) {
                const i = z * this.N + x;
                positions[i * 3 + 0] = x * this.S;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = z * this.S;
                // White — the shader generates checkerboard from world position
                colors[i * 3 + 0] = 1.0;
                colors[i * 3 + 1] = 1.0;
                colors[i * 3 + 2] = 1.0;
                uvs[i * 2 + 0] = 0;
                uvs[i * 2 + 1] = 0;
            }
        }

        for (let z = 0; z < this.N - 1; z++) {
            for (let x = 0; x < this.N - 1; x++) {
                const a = z * this.N + x;
                const b = a + 1;
                const c = a + this.N;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
        this.geometry.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
        this.geometry.setIndex(indices);

        const material = options.material || new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.name = 'rollingTerrain';
        this.mesh.receiveShadow = true;
        this.mesh.castShadow    = false;

        // Throttled logging
        this._lastLogTime = 0;
        this._logInterval = 1000; // ms
    }

    // ---- helpers ------------------------------------------------------------

    // Flat index: local (xW, zW) maps directly to buffer because mesh
    // moves with the origin, so no ring-buffer rotation is needed.
    _bIndex(xW, zW) {
        return zW * this.N + xW;
    }

    _height(worldX, worldZ) {
        return this.board.getUnifiedTerrainHeight(worldX, worldZ);
    }

    // ---- public API ---------------------------------------------------------

    async initAt(centerX, centerZ) {
        this.originX = Math.floor(centerX) - Math.floor(this.N / 2);
        this.originZ = Math.floor(centerZ) - Math.floor(this.N / 2);
        this.mesh.position.set(this.originX, 0, this.originZ);

        const pos = this.geometry.attributes.position.array;
        for (let zW = 0; zW < this.N; zW++) {
            for (let xW = 0; xW < this.N; xW++) {
                const idx = this._bIndex(xW, zW);
                const wX  = this.originX + xW;
                const wZ  = this.originZ + zW;
                pos[idx * 3 + 1] = this._height(wX, wZ);
            }
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeVertexNormals();
        this._log('init', `origin=(${this.originX},${this.originZ}) size=${this.N}x${this.N}`);
    }

    // Call every frame (or every update) with current camera position.
    // Only touches geometry when a threshold is crossed.
    update(cameraPos) {
        let dx = 0, dz = 0;
        const minX = this.originX + this.threshold;
        const maxX = this.originX + (this.N - 1 - this.threshold);
        const minZ = this.originZ + this.threshold;
        const maxZ = this.originZ + (this.N - 1 - this.threshold);

        if (cameraPos.x > maxX) {
            dx = Math.min(this.maxStep, Math.ceil(cameraPos.x - maxX));
        } else if (cameraPos.x < minX) {
            dx = -Math.min(this.maxStep, Math.ceil(minX - cameraPos.x));
        }

        if (cameraPos.z > maxZ) {
            dz = Math.min(this.maxStep, Math.ceil(cameraPos.z - maxZ));
        } else if (cameraPos.z < minZ) {
            dz = -Math.min(this.maxStep, Math.ceil(minZ - cameraPos.z));
        }

        if (dx === 0 && dz === 0) return;

        this._roll(dx, dz);
    }

    // Refresh a rectangular world region that falls inside the current window.
    // Called by terrainSystem.onChunkLoaded so newly arrived data shows up
    // without a full rebuild.
    refreshRegion(worldMinX, worldMinZ, worldMaxX, worldMaxZ) {
        const localMinX = Math.max(0, Math.floor(worldMinX - this.originX));
        const localMinZ = Math.max(0, Math.floor(worldMinZ - this.originZ));
        const localMaxX = Math.min(this.N - 1, Math.ceil(worldMaxX - this.originX));
        const localMaxZ = Math.min(this.N - 1, Math.ceil(worldMaxZ - this.originZ));

        if (localMinX > localMaxX || localMinZ > localMaxZ) return 0;

        const pos = this.geometry.attributes.position.array;
        let touched = 0;
        for (let zW = localMinZ; zW <= localMaxZ; zW++) {
            for (let xW = localMinX; xW <= localMaxX; xW++) {
                const idx = this._bIndex(xW, zW);
                const wX  = this.originX + xW;
                const wZ  = this.originZ + zW;
                pos[idx * 3 + 1] = this._height(wX, wZ);
                touched++;
            }
        }
        if (touched > 0) {
            this.geometry.attributes.position.needsUpdate = true;
            this.geometry.computeVertexNormals();
            this._log('refresh', `region [${localMinX}..${localMaxX}, ${localMinZ}..${localMaxZ}] touched=${touched}`);
        }
        return touched;
    }

    // ---- internals ----------------------------------------------------------

    _roll(dx, dz) {
        // Move origin (mesh stays at origin in world space)
        this.originX += dx;
        this.originZ += dz;
        this.mesh.position.x = this.originX;
        this.mesh.position.z = this.originZ;

        const pos = this.geometry.attributes.position.array;

        // When the mesh origin moves, every vertex's world position changes,
        // so we must refresh the entire grid.
        for (let zW = 0; zW < this.N; zW++) {
            for (let xW = 0; xW < this.N; xW++) {
                const idx = this._bIndex(xW, zW);
                const wX  = this.originX + xW;
                const wZ  = this.originZ + zW;
                pos[idx * 3 + 1] = this._height(wX, wZ);
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeVertexNormals();

        this._log('roll', `dx=${dx} dz=${dz} origin=(${this.originX},${this.originZ})`);

        if (typeof this.board.onTerrainMeshUpdated === 'function') {
            this.board.onTerrainMeshUpdated();
        }
    }

    _log(tag, msg) {
        const now = Date.now();
        if (now - this._lastLogTime < this._logInterval) return;
        this._lastLogTime = now;
        console.log(`[RollingTerrain ${tag}] ${msg}`);
    }
}
