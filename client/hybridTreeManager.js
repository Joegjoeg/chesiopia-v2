// HybridTreeManager
// Coordinates TerrainTreeSystem, GrowingTreeSystem, PoplarTreeSystem, and CherryTreeSystem with patch-based alternation
// Uses 4-way chunk distribution cycling through the four tree types

class HybridTreeManager {
    constructor(scene, terrainSystem, lodManager) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.chunkSize = 16;
        this.lodManager = lodManager;

        // Initialize all five tree systems
        this.terrainTreeSystem = new TerrainTreeSystem(scene, terrainSystem);
        this.growingTreeSystem = new GrowingTreeSystem(scene, terrainSystem);
        this.poplarTreeSystem = new PoplarTreeSystem(scene, terrainSystem);
        this.cherryTreeSystem = new CherryTreeSystem(scene, terrainSystem);
        this.billboardTreeSystem = new BillboardTreeSystem(scene, terrainSystem);

        // Track which trees belong to which system
        this.treeRegistry = new Map(); // key -> 'terrain', 'growing', 'poplar', 'cherry', or 'billboard'

        // Scratch vector for LOD position queries (zero-alloc)
        this._scratchPos = new THREE.Vector3();

        // Dev-tool overrides
        this.treeTypeOverride = 'default';
        this.lodEnabled = true;
        this._isRepopulating = false;

        // Register LOD groups if manager available
        if (this.lodManager) {
            this._registerLodGroups();
        }

        console.log('[HybridTreeManager] Initialized with patch-based alternation (chunkSize=' + this.chunkSize + ')');

        // Only show the active system's meshes; hide others to avoid rendering empty InstancedMesh overhead
        this._updateActiveSystemVisibility();
    }

    _getActiveSystem() {
        switch (this.treeTypeOverride) {
            case 'none':    return null;
            case 'terrain': return this.terrainTreeSystem;
            case 'growing': return this.growingTreeSystem;
            case 'cherry':  return this.cherryTreeSystem;
            case 'billboard': return this.billboardTreeSystem;
            case 'poplar':
            default:        return this.poplarTreeSystem;
        }
    }

    _attachSystemToScene(system, attach) {
        if (!system || !system.parts) return;
        for (const part of system.parts) {
            if (!part.mesh) continue;
            if (attach) {
                if (part.mesh.parent !== this.scene) this.scene.add(part.mesh);
            } else {
                if (part.mesh.parent === this.scene) this.scene.remove(part.mesh);
            }
        }
    }

    _updateActiveSystemVisibility() {
        const active = this._getActiveSystem();
        const activeName = active === this.terrainTreeSystem ? 'terrain'
                         : active === this.growingTreeSystem ? 'growing'
                         : active === this.cherryTreeSystem ? 'cherry'
                         : active === this.billboardTreeSystem ? 'billboard'
                         : 'poplar';
        const all = [this.terrainTreeSystem, this.growingTreeSystem, this.poplarTreeSystem, this.cherryTreeSystem, this.billboardTreeSystem];
        for (const system of all) {
            const isActive = system === active;
            const name = system === this.terrainTreeSystem ? 'terrain'
                       : system === this.growingTreeSystem ? 'growing'
                       : system === this.cherryTreeSystem ? 'cherry'
                       : system === this.billboardTreeSystem ? 'billboard'
                       : 'poplar';
            this._attachSystemToScene(system, isActive);
            if (system) {
                const count = system.getTreeCount ? system.getTreeCount() : 0;
                const inScene = system.parts && system.parts[0] && system.parts[0].mesh
                    ? system.parts[0].mesh.parent === this.scene
                    : false;
                // console.log(`[HybridTreeManager] ${name}: inScene=${inScene}, count=${count}`);
            }
        }
        // console.log(`[HybridTreeManager] Active system: ${activeName}, override=${this.treeTypeOverride}`);
    }

    _registerLodGroups() {
        const lm = this.lodManager;
        const posFn = (tree) => this._scratchPos.set(tree.x, tree.y, tree.z);
        const radiusFn = () => 4.0;

        lm.registerGroup('terrainTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 120,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 800,
            onCull: (tree, id) => this._setTreeInstanceVisible(this.terrainTreeSystem, id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisible(this.terrainTreeSystem, id, true)
        });
        lm.registerGroup('growingTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 100,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 600,
            onCull: (tree, id) => this._setTreeInstanceVisible(this.growingTreeSystem, id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisible(this.growingTreeSystem, id, true)
        });
        lm.registerGroup('poplarTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 120,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 1000,
            onCull: (tree, id) => this._setTreeInstanceVisible(this.poplarTreeSystem, id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisible(this.poplarTreeSystem, id, true)
        });
        lm.registerGroup('cherryTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 100,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 600,
            onCull: (tree, id) => this._setTreeInstanceVisible(this.cherryTreeSystem, id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisible(this.cherryTreeSystem, id, true)
        });
        lm.registerGroup('billboardTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 120,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 1000,
            onCull: (tree, id) => this._setTreeInstanceVisible(this.billboardTreeSystem, id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisible(this.billboardTreeSystem, id, true)
        });
    }

    _setTreeInstanceVisible(system, index, visible) {
        const tree = system.treeData[index];
        if (!tree) return;
        if (visible) {
            system.updateTreeInstanceMatrix(index, tree);
        } else {
            const m = system._scratchMatrix || new THREE.Matrix4();
            const p = system._scratchPos || new THREE.Vector3();
            const q = system._scratchQuat || new THREE.Quaternion();
            const s = system._scratchScale || new THREE.Vector3();
            p.set(tree.x, tree.y, tree.z);
            q.set(0, 0, 0, 1);
            s.set(0, 0, 0);
            m.compose(p, q, s);
            for (const part of system.parts) {
                part.mesh.setMatrixAt(index, m);
                part.mesh.instanceMatrix.needsUpdate = true;
            }
        }
    }

    /**
     * Determine which tree system to use based on chunk position and biome hint.
     * Supports dev-tool override to force a single tree type.
     * Biome species hints bias selection with 60% weight for regional consistency.
     */
    _getTreeSystemForPosition(worldX, worldZ, metadata = {}) {
        if (this.treeTypeOverride === 'none') return null;
        if (this.treeTypeOverride && this.treeTypeOverride !== 'default') {
            switch (this.treeTypeOverride) {
                case 'terrain': return this.terrainTreeSystem;
                case 'growing': return this.growingTreeSystem;
                case 'cherry':  return this.cherryTreeSystem;
                case 'billboard': return this.billboardTreeSystem;
                case 'poplar':
                default:        return this.poplarTreeSystem;
            }
        }

        // Biome species hint: 60% chance to route to preferred system
        const hint = metadata && metadata.species;
        if (hint && hint !== 'none') {
            const roll = Math.random();
            if (roll < 0.6) {
                switch (hint) {
                    case 'terrain':   return this.terrainTreeSystem;
                    case 'growing':   return this.growingTreeSystem;
                    case 'poplar':    return this.poplarTreeSystem;
                    case 'cherry':    return this.cherryTreeSystem;
                    case 'billboard': return this.billboardTreeSystem;
                }
            }
        }

        // Chunk-based checkerboard fallback for visual patch variety
        const chunkX = Math.floor(worldX / this.chunkSize);
        const chunkZ = Math.floor(worldZ / this.chunkSize);
        const parityX = ((chunkX % 2) + 2) % 2;
        const parityZ = ((chunkZ % 2) + 2) % 2;
        const patternIndex = (parityX << 1) | parityZ;

        switch (patternIndex) {
            case 0: return this.terrainTreeSystem;
            case 1: return this.growingTreeSystem;
            case 2: return this.poplarTreeSystem;
            case 3:
            default: return this.cherryTreeSystem;
        }
    }

    /**
     * Dev tool: override all trees to a single type and repopulate
     */
    setTreeTypeOverride(type) {
        if (this._isRepopulating) return;
        if (this.treeTypeOverride === type) return;

        console.log('[HybridTreeManager] Switching tree type to:', type);
        this.treeTypeOverride = type;

        // Clear existing trees
        this._isRepopulating = true;
        this.clear();

        // If switching to 'none', just hide everything without repopulating
        if (type === 'none') {
            this._updateActiveSystemVisibility();
            this._isRepopulating = false;
            console.log('[HybridTreeManager] Trees disabled (none)');
            return;
        }

        // Repopulate next frame to let clear() finish
        requestAnimationFrame(() => {
            this.populateFromServer().then(() => {
                this._updateActiveSystemVisibility();
                this._isRepopulating = false;
                console.log('[HybridTreeManager] Repopulated with type:', type);
            }).catch(err => {
                this._updateActiveSystemVisibility();
                this._isRepopulating = false;
                console.error('[HybridTreeManager] Repopulate failed:', err);
            });
        });
    }

    /**
     * Add a tree at world position. Routes to appropriate system based on chunk.
     * Optional metadata (biome, maxScale, growthRate, species) biases visuals.
     */
    addTree(worldX, worldZ, terrainHeight, metadata = {}) {
        const system = this._getTreeSystemForPosition(worldX, worldZ, metadata);
        if (!system) return -1;
        const key = `${Math.floor(worldX)},${Math.floor(worldZ)}`;

        // Guard against duplicate placement
        if (this.treeRegistry.has(key)) return -1;

        let result = system.addTree(worldX, worldZ, terrainHeight, metadata);
        if (result === -1) return -1;

        // Track in registry
        if (system === this.terrainTreeSystem) {
            this.treeRegistry.set(key, 'terrain');
            if (this.lodManager) {
                this.lodManager.add('terrainTrees', system.treeData[result], result);
            }
        } else if (system === this.growingTreeSystem) {
            this.treeRegistry.set(key, 'growing');
            if (this.lodManager) {
                this.lodManager.add('growingTrees', system.treeData[result], result);
            }
        } else if (system === this.poplarTreeSystem) {
            this.treeRegistry.set(key, 'poplar');
            if (this.lodManager) {
                this.lodManager.add('poplarTrees', system.treeData[result], result);
            }
        } else if (system === this.billboardTreeSystem) {
            this.treeRegistry.set(key, 'billboard');
            if (this.lodManager) {
                this.lodManager.add('billboardTrees', system.treeData[result], result);
            }
        } else {
            this.treeRegistry.set(key, 'cherry');
            if (this.lodManager) {
                this.lodManager.add('cherryTrees', system.treeData[result], result);
            }
        }

        return result;
    }

    /**
     * Populate trees from server, distributing between systems based on chunk pattern
     */
    async populateFromServer() {
        return new Promise(async (resolve, reject) => {
            try {
                const response = await fetch('/api/trees');
                if (!response.ok) {
                    console.warn('[HybridTreeManager] /api/trees returned ' + response.status);
                    resolve();
                    return;
                }
                const data = await response.json();
                const list = data.trees || [];
                console.log('[HybridTreeManager] Server reports ' + list.length + ' trees');

                const board = window.game && window.game.boardSystem;
                if (!board || typeof board.getUnifiedTerrainHeight !== 'function') {
                    console.warn('[HybridTreeManager] boardSystem.getUnifiedTerrainHeight not ready; aborting populate');
                    resolve();
                    return;
                }

                // If billboard is the active type, wait for async atlas generation first
                if (this.treeTypeOverride === 'billboard' && this.billboardTreeSystem) {
                    await this.billboardTreeSystem.whenReady();
                }

                const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;

                let placed = 0;
                let underwater = 0;
                let terrainTrees = 0;
                let growingTrees = 0;
                let poplarTrees = 0;
                let cherryTrees = 0;
                let billboardTrees = 0;

                // Process trees in batches to keep the main thread responsive
                const BATCH_SIZE = 50;
                let idx = 0;

                const processBatch = () => {
                    const end = Math.min(idx + BATCH_SIZE, list.length);
                    for (; idx < end; idx++) {
                        const t = list[idx];
                        const wx = t.x;
                        const wz = t.y;
                        const height = board.getUnifiedTerrainHeight(wx, wz);

                        if (height < waterCutoff) { underwater++; continue; }

                        const meta = {
                            biome: t.biome,
                            maxScale: t.maxScale,
                            growthRate: t.growthRate,
                            species: t.species
                        };
                        const system = this._getTreeSystemForPosition(wx, wz, meta);
                        const result = this.addTree(wx + 0.5, wz + 0.5, height, meta);
                        if (result !== -1) {
                            if (system === this.terrainTreeSystem) terrainTrees++;
                            else if (system === this.growingTreeSystem) growingTrees++;
                            else if (system === this.poplarTreeSystem) poplarTrees++;
                            else if (system === this.billboardTreeSystem) billboardTrees++;
                            else cherryTrees++;
                            placed++;
                        }
                    }

                    if (idx < list.length) {
                        requestAnimationFrame(processBatch);
                    } else {
                        console.log('[HybridTreeManager] Placed ' + placed + ' trees (' + underwater + ' skipped underwater)');
                        console.log('[HybridTreeManager] Distribution: ' + terrainTrees + ' terrain, ' + growingTrees + ' growing, ' + poplarTrees + ' poplar, ' + cherryTrees + ' cherry, ' + billboardTrees + ' billboard');
                        console.log('[HybridTreeManager] Growing tree count:', this.growingTreeSystem.getTreeCount());
                        console.log('[HybridTreeManager] Poplar tree count:', this.poplarTreeSystem.getTreeCount());
                        console.log('[HybridTreeManager] Cherry tree count:', this.cherryTreeSystem.getTreeCount());

                        // Compute wind field for all systems
                        this.terrainTreeSystem.computeWindField();
                        console.log('[HybridTreeManager] Computing wind field for growing trees...');
                        this.growingTreeSystem.computeWindField();
                        console.log('[HybridTreeManager] Computing wind field for poplar trees...');
                        this.poplarTreeSystem.computeWindField();
                        console.log('[HybridTreeManager] Computing wind field for cherry trees...');
                        this.cherryTreeSystem.computeWindField();
                        console.log('[HybridTreeManager] Computing wind field for billboard trees...');
                        this.billboardTreeSystem.computeWindField();
                        console.log('[HybridTreeManager] Wind field computed for all systems');
                        resolve();
                    }
                };

                processBatch();
            } catch (err) {
                console.error('[HybridTreeManager] populateFromServer failed:', err);
                reject(err);
            }
        });
    }

    /**
     * Load trees for a specific chunk on-demand (used during terrain streaming).
     * Skips already-placed trees via the registry guard in addTree.
     */
    async loadTreesForChunk(chunkX, chunkZ) {
        console.log(`[HybridTreeManager] loadTreesForChunk(${chunkX},${chunkZ}) – fetching…`);
        try {
            const response = await fetch(`/api/trees/chunk/${chunkX}/${chunkZ}`);
            if (!response.ok) {
                console.warn(`[HybridTreeManager] /api/trees/chunk/${chunkX}/${chunkZ} returned ${response.status}`);
                return;
            }
            const data = await response.json();
            const list = data.trees || [];
            console.log(`[HybridTreeManager] loadTreesForChunk(${chunkX},${chunkZ}) – server returned ${list.length} trees`);
            if (list.length === 0) return;

            const board = window.game && window.game.boardSystem;
            if (!board || typeof board.getUnifiedTerrainHeight !== 'function') {
                console.warn(`[HybridTreeManager] boardSystem not ready, skipping tree placement`);
                return;
            }

            const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;
            let placed = 0;
            let skippedWater = 0;
            let dupes = 0;

            for (const t of list) {
                const wx = t.x;
                const wz = t.y;
                const height = board.getUnifiedTerrainHeight(wx, wz);
                if (height < waterCutoff) { skippedWater++; continue; }

                const meta = {
                    biome: t.biome,
                    maxScale: t.maxScale,
                    growthRate: t.growthRate,
                    species: t.species
                };
                const result = this.addTree(wx + 0.5, wz + 0.5, height, meta);
                if (result !== -1) placed++;
                else dupes++;
            }

            console.log(`[HybridTreeManager] loadTreesForChunk(${chunkX},${chunkZ}) – placed ${placed}, skipped ${skippedWater}, dupes ${dupes}`);
            if (placed > 0) {
                this.terrainTreeSystem.computeWindField();
                this.growingTreeSystem.computeWindField();
                this.poplarTreeSystem.computeWindField();
                this.cherryTreeSystem.computeWindField();
                this.billboardTreeSystem.computeWindField();
            }
        } catch (err) {
            console.error(`[HybridTreeManager] loadTreesForChunk(${chunkX},${chunkZ}) failed:`, err);
        }
    }

    /**
     * Remove all trees from all systems
     */
    clear() {
        this.terrainTreeSystem.clear();
        this.growingTreeSystem.clear();
        this.poplarTreeSystem.clear();
        this.cherryTreeSystem.clear();
        this.billboardTreeSystem.clear();
        this.treeRegistry.clear();
        if (this.lodManager) {
            this.lodManager.clear('terrainTrees');
            this.lodManager.clear('growingTrees');
            this.lodManager.clear('poplarTrees');
            this.lodManager.clear('cherryTrees');
            this.lodManager.clear('billboardTrees');
        }
        console.log('[HybridTreeManager] Cleared all trees');
    }

    /**
     * Set visibility on all tree meshes across all systems
     */
    setTreeVisible(visible) {
        const systems = [this.terrainTreeSystem, this.growingTreeSystem, this.poplarTreeSystem, this.cherryTreeSystem, this.billboardTreeSystem];
        for (const system of systems) {
            this._attachSystemToScene(system, visible);
        }
    }

    /**
     * Update all tree systems
     */
    update(timeSec, windStrength, windDirection) {
        const dontRender = window.parameterSystem && window.parameterSystem.getParameter('dontRenderTrees');
        if (dontRender) {
            this.setTreeVisible(false);
            return;
        }

        if (this.lodManager && this.lodEnabled) {
            // Terrain trees - animate every frame
            const terrainGo = this.lodManager.shouldAnimateGroup('terrainTrees', 1);
            if (terrainGo) this.terrainTreeSystem.update(timeSec, windStrength, windDirection);

            // Growing trees - every 2nd frame
            const growingGo = this.lodManager.shouldAnimateGroup('growingTrees', 2);
            if (growingGo) this.growingTreeSystem.update(timeSec, windStrength, windDirection);

            // Poplar trees - adaptive throttling based on visible count
            const poplarVisible = this.lodManager.getGroupVisibleCount('poplarTrees');
            const poplarInterval = poplarVisible < 50 ? 1 : poplarVisible < 200 ? 4 : 8;
            const poplarGo = this.lodManager.shouldAnimateGroup('poplarTrees', poplarInterval);
            if (poplarGo) this.poplarTreeSystem.update(timeSec, windStrength, windDirection);

            // Cherry trees - every 2nd frame
            const cherryGo = this.lodManager.shouldAnimateGroup('cherryTrees', 2);
            if (cherryGo) this.cherryTreeSystem.update(timeSec, windStrength, windDirection);

            // Billboard trees - every frame (needs camera height updates)
            const billboardGo = this.lodManager.shouldAnimateGroup('billboardTrees', 1);
            if (billboardGo) this.billboardTreeSystem.update(timeSec, windStrength, windDirection);
        } else {
            // Fallback without LODManager
            this.terrainTreeSystem.update(timeSec, windStrength, windDirection);
            this.growingTreeSystem.update(timeSec, windStrength, windDirection);
            this.poplarTreeSystem.update(timeSec, windStrength, windDirection);
            this.cherryTreeSystem.update(timeSec, windStrength, windDirection);
            this.billboardTreeSystem.update(timeSec, windStrength, windDirection);
        }
    }

    /**
     * Check if a tree exists at position
     */
    hasTreeAt(worldX, worldZ) {
        return this.terrainTreeSystem.hasTreeAt(worldX, worldZ) ||
               this.growingTreeSystem.hasTreeAt(worldX, worldZ) ||
               this.poplarTreeSystem.hasTreeAt(worldX, worldZ) ||
               this.cherryTreeSystem.hasTreeAt(worldX, worldZ) ||
               this.billboardTreeSystem.hasTreeAt(worldX, worldZ);
    }

    /**
     * Get tree count from all systems
     */
    getTreeCount() {
        return this.terrainTreeSystem.getTreeCount() +
               this.growingTreeSystem.getTreeCount() +
               this.poplarTreeSystem.getTreeCount() +
               this.cherryTreeSystem.getTreeCount() +
               this.billboardTreeSystem.getTreeCount();
    }

    /**
     * Dispose all systems
     */
    dispose() {
        this.terrainTreeSystem.dispose();
        this.growingTreeSystem.dispose();
        this.poplarTreeSystem.dispose();
        this.cherryTreeSystem.dispose();
        this.billboardTreeSystem.dispose();
        this.treeRegistry.clear();
        console.log('[HybridTreeManager] Disposed');
    }

    /**
     * Set season for all systems
     */
    setSeason(season) {
        this.terrainTreeSystem.setSeason(season);
        this.growingTreeSystem.setSeason(season);
        this.poplarTreeSystem.setSeason(season);
        this.cherryTreeSystem.setSeason(season);
        this.billboardTreeSystem.setSeason(season);
    }
}
