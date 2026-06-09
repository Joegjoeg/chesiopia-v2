// TerrainOuterRing — Low-resolution frame around RollingTerrainMesh
//  - Four separate meshes (N, S, E, W) forming a frame with a hole for the inner mesh.
//  - The inner edge of each strip shares vertices with the inner mesh edge:
//    seam-adjacent band uses spacing 1 in BOTH directions so no T-junctions occur
//    at the boundary between the two meshes.
//  - Spacing in the perpendicular direction increases with distance (1, 2, 4, 8 …).
//  - Two-tier update:
//      1. Seam sync   — when the inner mesh rolls, only the seam row/column is
//                       resampled so the shared edge stays perfectly locked.
//      2. Full resample — when the camera has moved > fullUpdateThreshold world
//                         units, every vertex in the outer ring is resampled.

class TerrainOuterRing {
    constructor(boardSystem, terrainSystem, options = {}) {
        this.board = boardSystem;
        this.terrain = terrainSystem;
        this.N = options.gridSize || 64;
        this.S = options.cellSize || 1;
        this.material = options.material || new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            side: THREE.DoubleSide
        });
        this.fullUpdateThreshold = options.fullUpdateThreshold || 16;
        this.extension = options.extension || 64;
        this.radiusScale = options.radiusScale || 1.0;

        // Bands for the perpendicular axis (outward from seam).
        this.perpBands = [
            { spacing: 1, count: 1 },
            { spacing: 2, count: 1 },
            { spacing: 4, count: 1 },
            { spacing: 8, count: 1 },
            { spacing: 16, count: 1 },
            { spacing: 32, count: 1 }
        ];

        // Clone material for outer ring: disable the circular fade (it targets the inner terrain
        // edge and would set alpha=0 on all outer ring vertices which lie beyond that radius).
        if (this.material && this.material.clone) {
            this.material = this.material.clone();
            this.material.side = THREE.DoubleSide;
            if (this.material.uniforms) {
                if (this.material.uniforms.uFadeEnabled) {
                    this.material.uniforms.uFadeEnabled.value = 0.0;
                }
            }
        }

        this.originX = 0;
        this.originZ = 0;
        this.lastFullUpdatePos = new THREE.Vector3(
            Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY
        );

        this.meshes = [];
        this._stripData = [];
        this.debug = true;

        // Fade-in state for deferred appearance
        this._fadeIn = {
            active: false,
            startTime: 0,
            duration: 3000, // ms
            opacity: 1.0
        };

        this._buildMeshes();

        // Fade-in: use uTerrainOpacity (already in the textureBlending shader:
        //   gl_FragColor = vec4(finalColor, fadeAlpha * uTerrainOpacity)
        // The outer ring has its own cloned material, so this is safe.
        if (this.material && this.material.uniforms && this.material.uniforms.uTerrainOpacity) {
            this.material.uniforms.uTerrainOpacity.value = 0.0;
        }

        // For standard materials, enable transparent path too.
        if (this.material && this.material.isMeshStandardMaterial) {
            this.material.transparent = true;
            this.material.opacity = 0.0;
        }

        if (this.debug) this._logCreationSummary();
    }

    _logCreationSummary() {
        console.log('[TerrainOuterRing] Created with config:', {
            gridSize: this.N,
            cellSize: this.S,
            extension: this.extension,
            radiusScale: this.radiusScale,
            fullUpdateThreshold: this.fullUpdateThreshold,
            perpBands: this.perpBands
        });
        for (let i = 0; i < this._stripData.length; i++) {
            const s = this._stripData[i];
            const xMin = Math.min(...s.xCoords) + s.xOffset;
            const xMax = Math.max(...s.xCoords) + s.xOffset;
            const zMin = Math.min(...s.zCoords) + s.zOffset;
            const zMax = Math.max(...s.zCoords) + s.zOffset;
            console.log(`[TerrainOuterRing] ${s.name} strip bounds: x=[${xMin.toFixed(1)}, ${xMax.toFixed(1)}], z=[${zMin.toFixed(1)}, ${zMax.toFixed(1)}], verts=${s.nx * s.nz}`);
        }
    }

    // Build a 1-D coordinate array for one axis, positive side only.
    // Spacings are multiplied by radiusScale so vertex count stays fixed
    // while absolute reach increases.
    _buildPerpAxis(bands) {
        const pos = [0];
        let cursor = 0;
        const s = this.radiusScale;
        for (const { spacing, count } of bands) {
            for (let k = 0; k < count; k++) {
                cursor += spacing * s;
                pos.push(cursor);
            }
        }
        return pos; // e.g. [0, 1, 3, 7, 15, 31, 63] with s=1
    }

    // Build a hybrid axis: inner section at spacing 1, extensions at spacing 2.
    // Extension distances are multiplied by radiusScale so vertex count stays
    // fixed while the ring reaches farther.
    _buildHybridAxis(innerMin, innerMax, ext, innerSpacing, outerSpacing) {
        const pos = [];
        const s = this.radiusScale;
        const leftMin  = -ext * s;
        const leftMax  = innerMin - 1;
        const rightMin = innerMax + 1;
        const rightMax = innerMax + ext * s;
        const scaledOuterSpacing = outerSpacing * s;

        // Left extension
        const leftStart = Math.ceil(leftMin / scaledOuterSpacing) * scaledOuterSpacing;
        for (let v = leftStart; v <= leftMax; v += scaledOuterSpacing) {
            pos.push(v);
        }
        // Inner section (matches inner mesh density exactly)
        for (let v = innerMin; v <= innerMax; v += innerSpacing) {
            pos.push(v);
        }
        // Right extension
        const rightStart = Math.ceil(rightMin / scaledOuterSpacing) * scaledOuterSpacing;
        for (let v = rightStart; v <= rightMax; v += scaledOuterSpacing) {
            pos.push(v);
        }
        return pos;
    }

    _buildMeshes() {
        const N = this.N;
        const ext = this.extension;
        const perp = this._buildPerpAxis(this.perpBands); // [0, 1, 3, 7, 15, 31, 63]

        // ---- North strip (extends north from inner mesh top edge) ----
        const northX = this._buildHybridAxis(0, N - 1, ext, 1, 2);
        const northZ = perp.map(v => v); // positive
        this._createStrip('north', northX, northZ, 0, N - 1, 'z', 0);

        // ---- South strip (extends south from inner mesh bottom edge) ----
        const southX = northX;
        const southZ = perp.map(v => -v); // negative
        this._createStrip('south', southX, southZ, 0, 0, 'z', 0, true);

        // ---- East strip (extends east from inner mesh right edge) ----
        const eastX = perp.map(v => v); // positive
        const eastZ = this._buildHybridAxis(0, N - 1, ext, 1, 2);
        this._createStrip('east', eastX, eastZ, N - 1, 0, 'x', 0);

        // ---- West strip (extends west from inner mesh left edge) ----
        const westX = perp.map(v => -v); // negative
        const westZ = eastZ;
        this._createStrip('west', westX, westZ, 0, 0, 'x', 0, true);
    }

    _createStrip(name, xCoords, zCoords, xOffset, zOffset, seamAxis, seamIndex, flipWinding = false) {
        const nx = xCoords.length;
        const nz = zCoords.length;
        const vertCount = nx * nz;

        const positions = new Float32Array(vertCount * 3);
        const colors    = new Float32Array(vertCount * 3);
        const uvs       = new Float32Array(vertCount * 2);
        const cliffs    = new Float32Array(vertCount);
        const indices   = [];

        for (let z = 0; z < nz; z++) {
            for (let x = 0; x < nx; x++) {
                const i = z * nx + x;
                positions[i * 3 + 0] = xCoords[x] + xOffset;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = zCoords[z] + zOffset;
                colors[i * 3 + 0] = 1.0;
                colors[i * 3 + 1] = 1.0;
                colors[i * 3 + 2] = 1.0;
                uvs[i * 2 + 0] = 0;
                uvs[i * 2 + 1] = 0;
                cliffs[i] = 0;
            }
        }

        for (let z = 0; z < nz - 1; z++) {
            for (let x = 0; x < nx - 1; x++) {
                const a = z * nx + x;
                const b = a + 1;
                const c = a + nx;
                const d = c + 1;
                if (flipWinding) {
                    indices.push(a, b, c, b, d, c);
                } else {
                    indices.push(a, c, b, b, c, d);
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('terrainCliff', new THREE.BufferAttribute(cliffs, 1));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = `terrainOuterRing_${name}`;
        mesh.receiveShadow = true;
        mesh.castShadow    = false;

        this.meshes.push(mesh);
        this._stripData.push({
            name, nx, nz, xCoords, zCoords, xOffset, zOffset,
            seamAxis, seamIndex,
            seamIndices: this._computeSeamIndices(nx, nz, seamAxis, seamIndex)
        });
    }

    _computeSeamIndices(nx, nz, seamAxis, seamIndex) {
        const indices = [];
        if (seamAxis === 'z') {
            // Seam is a row: all x at the fixed z index seamIndex
            for (let x = 0; x < nx; x++) {
                indices.push(seamIndex * nx + x);
            }
        } else if (seamAxis === 'x') {
            // Seam is a column: all z at the fixed x index seamIndex
            for (let z = 0; z < nz; z++) {
                indices.push(z * nx + seamIndex);
            }
        }
        return indices;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    initAt(originX, originZ) {
        this.originX = originX;
        this.originZ = originZ;
        for (const mesh of this.meshes) {
            mesh.position.set(originX, 0, originZ);
        }
        this._resampleAll();
        this.lastFullUpdatePos.set(
            originX + this.N * 0.5 * this.S,
            0,
            originZ + this.N * 0.5 * this.S
        );
        if (this.debug) {
            console.log('[TerrainOuterRing] initAt origin:', { x: originX, z: originZ });
            this.logMeshPositions();
        }
    }

    /**
     * Start a fade-in from invisible to fully visible over `durationMs` milliseconds.
     * Call this after adding the ring meshes to the scene.
     */
    startFadeIn(durationMs = 3000) {
        this._fadeIn.active = true;
        this._fadeIn.startTime = performance.now();
        this._fadeIn.duration = durationMs;
        this._fadeIn.opacity = 0.0;
        this._applyFadeOpacity(0.0);
    }

    _applyFadeOpacity(opacity) {
        this._fadeIn.opacity = opacity;
        if (this.material) {
            // Use uTerrainOpacity: the textureBlending shader does
            //   gl_FragColor = vec4(finalColor, fadeAlpha * uTerrainOpacity)
            if (this.material.uniforms && this.material.uniforms.uTerrainOpacity) {
                this.material.uniforms.uTerrainOpacity.value = opacity;
            }
            if (this.material.isMeshStandardMaterial) {
                this.material.opacity = opacity;
            }
        }
    }

    _updateFade() {
        if (!this._fadeIn.active) return;
        const elapsed = performance.now() - this._fadeIn.startTime;
        const t = Math.min(1.0, elapsed / this._fadeIn.duration);
        // Ease-out cubic for smooth appearance
        const eased = 1.0 - Math.pow(1.0 - t, 3);
        this._applyFadeOpacity(eased);
        if (t >= 1.0) {
            this._fadeIn.active = false;
            if (this.material && this.material.isMeshStandardMaterial) {
                this.material.transparent = false;
            }
        }
    }

    logMeshPositions() {
        for (const mesh of this.meshes) {
            const box = new THREE.Box3().setFromObject(mesh);
            console.log(`[TerrainOuterRing] ${mesh.name} world pos=(${mesh.position.x.toFixed(1)}, ${mesh.position.y.toFixed(1)}, ${mesh.position.z.toFixed(1)}), bbox=[${box.min.x.toFixed(1)},${box.min.z.toFixed(1)}]→[${box.max.x.toFixed(1)},${box.max.z.toFixed(1)}]`);
        }
    }

    /**
     * Called by the board immediately after RollingTerrainMesh finishes a roll.
     * @param {number} dx  — cells rolled in X (positive = east)
     * @param {number} dz  — cells rolled in Z (positive = south... wait,
     *                        in _roll, originX += dx, so dx > 0 means mesh
     *                        shifted east, exposing the WEST edge for dx > 0.
     *                        Actually let's trace carefully:
     *                        - origin shifts by (dx, dz)
     *                        - For dz > 0: originZ increases → mesh moves north
     *                          in world space? No, originZ += dz means the
     *                          mesh's local (0,0) now maps to a larger world Z.
     *                          So the mesh data that was at world Z = oldOriginZ + N-1
     *                          is now at local z = N-1-dz. New data is exposed at
     *                          local z = N-1 (world Z = newOriginZ + N-1).
     *                        So dz > 0 exposes the NORTH edge.
     *                        Similarly dx > 0 exposes the EAST edge.
     *                        Let's verify against RollingTerrainMesh._roll:
     *                        oldLocalZ = zW + dz. For dz > 0, zW near N-1
     *                        has oldLocalZ > N-1 → new data sampled.
     *                        Those zW near N-1 are the NORTH edge.
     *                        Yes: dx > 0 → east edge, dz > 0 → north edge.
     *                        Wait, the code comment says "dz > 0 means originZ
     *                        increases" which is northward in world space if Z
     *                        points north. Actually in Three.js, Z usually points
     *                        toward the viewer (south on many maps), but the
     *                        sign doesn't matter — we just mirror the inner
     *                        mesh's logic.
     *                        From _roll: for dz>0, newly exposed strip is at
     *                        zW near N-1. That is the "top" or "north" edge
     *                        if we think of +Z as north. If +Z is south, it's
     *                        the south edge. Regardless, we call it the edge
     *                        in the +Z direction.
     */
    onInnerMeshRolled(dx, dz, newOriginX, newOriginZ) {
        this.originX = newOriginX;
        this.originZ = newOriginZ;

        for (const mesh of this.meshes) {
            mesh.position.set(newOriginX, 0, newOriginZ);
        }

        // All four seams must be resampled because the mesh position change
        // shifts every seam to new world coordinates. Updating only the
        // leading edge leaves the trailing/perpendicular seams desynchronized
        // with the inner mesh's ring-buffer-copied edges.
        if (dx !== 0 || dz !== 0) {
            this._updateSeamForStrip(0); // north
            this._updateSeamForStrip(1); // south
            this._updateSeamForStrip(2); // east
            this._updateSeamForStrip(3); // west
        }

        if (this.debug) {
            console.log(`[TerrainOuterRing] Rolled dx=${dx}, dz=${dz}. New origin=(${newOriginX}, ${newOriginZ}). All seams updated.`);
        }
    }

    /**
     * Call every frame (or at the same cadence as RollingTerrainMesh.update).
     * Triggers a full resample if the camera has moved far enough.
     */
    update(cameraPos) {
        const cc = this.board.game?.cameraController;
        const terrainCenter = new THREE.Vector3(this.originX, 0, this.originZ);
        const cameraPosition = cc?.camera?.position || cameraPos;

        // Update fade center to the middle of the terrain mesh, not the camera
        if (this.material && this.material.uniforms && this.material.uniforms.uFadeCenter) {
            this.material.uniforms.uFadeCenter.value.set(terrainCenter.x, 0, terrainCenter.z);
        }

        // Debug: log divergence between camera position and terrain center
        if (this.debug && cc) {
            const divX = cameraPosition.x - terrainCenter.x;
            const divZ = cameraPosition.z - terrainCenter.z;
            const divDist = Math.sqrt(divX * divX + divZ * divZ);
            if (divDist > 1.0) {
                console.log(`[TerrainOuterRing] Camera-terrain divergence: ${divDist.toFixed(1)} units. cam=(${cameraPosition.x.toFixed(1)}, ${cameraPosition.z.toFixed(1)}) terrainCenter=(${terrainCenter.x.toFixed(1)}, ${terrainCenter.z.toFixed(1)})`);
            }
        }

        // Animate fade-in if active
        this._updateFade();

        const dx = terrainCenter.x - this.lastFullUpdatePos.x;
        const dz = terrainCenter.z - this.lastFullUpdatePos.z;
        const distSq = dx * dx + dz * dz;
        const thrSq = this.fullUpdateThreshold * this.fullUpdateThreshold;

        if (distSq >= thrSq) {
            if (this.debug) {
                console.log(`[TerrainOuterRing] Full resample triggered. Camera moved ${Math.sqrt(distSq).toFixed(1)} units. Center=(${terrainCenter.x.toFixed(1)}, ${terrainCenter.z.toFixed(1)})`);
            }
            this._resampleAll();
            this.lastFullUpdatePos.set(terrainCenter.x, 0, terrainCenter.z);
        }
    }

    destroy(scene) {
        for (const mesh of this.meshes) {
            scene.remove(mesh);
            mesh.geometry.dispose();
        }
        this.meshes = [];
        this._stripData = [];
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    _updateSeamForStrip(stripIdx) {
        const strip = this._stripData[stripIdx];
        const mesh  = this.meshes[stripIdx];
        const pos   = mesh.geometry.attributes.position.array;
        const seam  = strip.seamIndices;

        let minH = Infinity, maxH = -Infinity;
        let firstWorld = null, lastWorld = null;

        for (const idx of seam) {
            const localX = pos[idx * 3 + 0];
            const localZ = pos[idx * 3 + 2];
            const worldX = this.originX + localX;
            const worldZ = this.originZ + localZ;
            const h = this._height(worldX, worldZ);
            pos[idx * 3 + 1] = h;
            if (h < minH) minH = h;
            if (h > maxH) maxH = h;
            if (!firstWorld) firstWorld = { x: worldX, z: worldZ, h };
            lastWorld = { x: worldX, z: worldZ, h };
        }

        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();

        if (this.debug && firstWorld) {
            console.log(`[TerrainOuterRing] ${strip.name} seam updated: ${seam.length} verts, origin=(${this.originX}, ${this.originZ}), first=(${firstWorld.x.toFixed(1)}, ${firstWorld.z.toFixed(1)}) h=${firstWorld.h.toFixed(2)}, last=(${lastWorld.x.toFixed(1)}, ${lastWorld.z.toFixed(1)}) h=${lastWorld.h.toFixed(2)}, range=[${minH.toFixed(2)}, ${maxH.toFixed(2)}]`);
        }
    }

    _resampleAll() {
        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            const pos  = mesh.geometry.attributes.position.array;
            let minH = Infinity, maxH = -Infinity;
            const vertCount = pos.length / 3;

            for (let j = 0; j < pos.length; j += 3) {
                const localX = pos[j + 0];
                const localZ = pos[j + 2];
                const worldX = this.originX + localX;
                const worldZ = this.originZ + localZ;
                const h = this._height(worldX, worldZ);
                pos[j + 1] = h;
                if (h < minH) minH = h;
                if (h > maxH) maxH = h;
            }
            mesh.geometry.attributes.position.needsUpdate = true;
            mesh.geometry.computeVertexNormals();

            if (this.debug) {
                const name = this._stripData[i]?.name || `strip${i}`;
                console.log(`[TerrainOuterRing] ${name} full resample: ${vertCount} verts, origin=(${this.originX}, ${this.originZ}), height range=[${minH.toFixed(2)}, ${maxH.toFixed(2)}]`);
            }
        }
    }

    _height(worldX, worldZ) {
        return this.board.getUnifiedTerrainHeight(worldX, worldZ);
    }
}
