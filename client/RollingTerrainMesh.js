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

        // Debug tracking
        this._debugTrackEnabled = false;
        this._lastTrackTime = 0;
        this._trackInterval = 2000; // ms
        this._trackHistory = []; // last few roll events
        if (typeof window !== 'undefined') {
            if (!window.__terrainDebug) window.__terrainDebug = {};
            window.__terrainDebug.rollingTerrain = this;
            window.__terrainDebug.toggleTrack = () => {
                this._debugTrackEnabled = !this._debugTrackEnabled;
                console.log(`[TerrainTrack] ${this._debugTrackEnabled ? 'ENABLED' : 'DISABLED'}`);
            };
        }
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
        const c = this._getCornerCoords();
        this._log('init', `origin=(${this.originX},${this.originZ}) size=${this.N}x${this.N} camera(${centerX.toFixed(1)},${centerZ.toFixed(1)}) corners NW${c.nw} NE${c.ne} SW${c.sw} SE${c.se}`);
    }

    // Call every frame (or every update) with current camera position.
    // Keeps the mesh centered on the camera target so the target never
    // drifts toward the edge.
    update(cameraPos) {
        const targetOriginX = Math.floor(cameraPos.x) - Math.floor(this.N / 2);
        const targetOriginZ = Math.floor(cameraPos.z) - Math.floor(this.N / 2);

        let dx = targetOriginX - this.originX;
        let dz = targetOriginZ - this.originZ;

        // Clamp to max step so we don't do giant recalcs in one frame
        if (dx !== 0) {
            dx = Math.max(-this.maxStep, Math.min(this.maxStep, dx));
        }
        if (dz !== 0) {
            dz = Math.max(-this.maxStep, Math.min(this.maxStep, dz));
        }

        // Always track, even if no roll happens
        const meshMinX = this.originX;
        const meshMaxX = this.originX + (this.N - 1);
        const meshMinZ = this.originZ;
        const meshMaxZ = this.originZ + (this.N - 1);
        this._debugTrack(cameraPos, meshMinX, meshMaxX, meshMinZ, meshMaxZ, dx, dz);

        if (dx === 0 && dz === 0) return;

        this._trackHistory.push({
            t: Date.now(),
            camera: { x: cameraPos.x.toFixed(1), z: cameraPos.z.toFixed(1) },
            roll: { dx, dz },
            origin: { x: this.originX, z: this.originZ }
        });
        if (this._trackHistory.length > 10) this._trackHistory.shift();

        this._roll(dx, dz, cameraPos);
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

    _roll(dx, dz, cameraPos) {
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

        const c = this._getCornerCoords();
        const camStr = cameraPos ? `camera(${cameraPos.x.toFixed(1)},${cameraPos.z.toFixed(1)}) ` : '';
        this._log('roll', `dx=${dx} dz=${dz} origin=(${this.originX},${this.originZ}) ${camStr}corners NW${c.nw} NE${c.ne} SW${c.sw} SE${c.se}`);

        if (typeof this.board.onTerrainMeshUpdated === 'function') {
            this.board.onTerrainMeshUpdated();
        }
    }

    // Average world position of the four corner vertices.
    // This is a more robust "center" than origin + N/2 because it reflects
    // the actual computed heights.
    getCenterFromCorners() {
        const pos = this.geometry.attributes.position.array;
        const corners = [
            this._bIndex(0, 0),
            this._bIndex(this.N - 1, 0),
            this._bIndex(0, this.N - 1),
            this._bIndex(this.N - 1, this.N - 1)
        ];
        let cx = 0, cy = 0, cz = 0;
        for (const idx of corners) {
            cx += pos[idx * 3 + 0] + this.mesh.position.x;
            cy += pos[idx * 3 + 1] + this.mesh.position.y;
            cz += pos[idx * 3 + 2] + this.mesh.position.z;
        }
        return { x: cx / 4, y: cy / 4, z: cz / 4 };
    }

    _getCornerCoords() {
        const farX = this.originX + (this.N - 1) * this.S;
        const farZ = this.originZ + (this.N - 1) * this.S;
        return {
            nw: `(${this.originX.toFixed(0)},${this.originZ.toFixed(0)})`,
            ne: `(${farX.toFixed(0)},${this.originZ.toFixed(0)})`,
            sw: `(${this.originX.toFixed(0)},${farZ.toFixed(0)})`,
            se: `(${farX.toFixed(0)},${farZ.toFixed(0)})`
        };
    }

    _debugTrack(cameraPos, minX, maxX, minZ, maxZ, dx, dz) {
        if (!this._debugTrackEnabled) return;
        const now = Date.now();
        if (now - this._lastTrackTime < this._trackInterval) return;
        this._lastTrackTime = now;

        const center = this.getCenterFromCorners();
        const distToCenter = Math.sqrt(
            (cameraPos.x - center.x) ** 2 +
            (cameraPos.z - center.z) ** 2
        );
        const halfSize = (this.N - 1) * this.S * 0.5;

        const farX = this.originX + (this.N - 1) * this.S;
        const farZ = this.originZ + (this.N - 1) * this.S;
        const nw = `(${this.originX.toFixed(0)},${this.originZ.toFixed(0)})`;
        const ne = `(${farX.toFixed(0)},${this.originZ.toFixed(0)})`;
        const sw = `(${this.originX.toFixed(0)},${farZ.toFixed(0)})`;
        const se = `(${farX.toFixed(0)},${farZ.toFixed(0)})`;

        console.log(
            `%c[TerrainTrack] target(${cameraPos.x.toFixed(1)},${cameraPos.z.toFixed(1)})  ` +
            `terrainOrigin(${this.originX},${this.originZ})  ` +
            `cornerCenter(${center.x.toFixed(1)},${center.z.toFixed(1)})  ` +
            `distToCenter=${distToCenter.toFixed(1)}  ` +
            `safeZone[${minX.toFixed(0)}..${maxX.toFixed(0)}, ${minZ.toFixed(0)}..${maxZ.toFixed(0)}]  ` +
            `halfSize=${halfSize.toFixed(0)}  ` +
            `corners NW${nw} NE${ne} SW${sw} SE${se}`,
            distToCenter > halfSize * 0.5 ? 'color:#ff4444' : 'color:#44ff44'
        );
    }

    _log(tag, msg) {
        const now = Date.now();
        if (now - this._lastLogTime < this._logInterval) return;
        this._lastLogTime = now;
        console.log(`[RollingTerrain ${tag}] ${msg}`);
    }
}
