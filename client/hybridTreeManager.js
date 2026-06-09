// HybridTreeManager
// Coordinates TerrainTreeSystem, GrowingTreeSystem, PoplarTreeSystem, and CherryTreeSystem with patch-based alternation
// Uses 4-way chunk distribution cycling through the four tree types

class HybridTreeManager {
    constructor(scene, terrainSystem, lodManager) {
        this.scene = scene;
        this._terrainSystemRef = terrainSystem;
        this.chunkSize = 16;
        this.lodManager = lodManager;

        this._systemFactoryClasses = {
            terrain: TerrainTreeSystem,
            growing: GrowingTreeSystem,
            poplar: PoplarTreeSystem,
            cherry: CherryTreeSystem,
            billboard: BillboardTreeSystem,
            realistic: RealisticTreeSystem
        };
        this._systems = {
            terrain: null,
            growing: null,
            poplar: null,
            cherry: null,
            billboard: null,
            realistic: null
        };
        this._systemOrder = Object.keys(this._systems);
        this._defineSystemAccessors();

        // Track which trees belong to which system
        this.treeRegistry = new Map(); // key -> 'terrain', 'growing', 'poplar', 'cherry', or 'billboard'

        // Scratch vector for LOD position queries (zero-alloc)
        this._scratchPos = new THREE.Vector3();

        // Dev-tool overrides
        this.treeTypeOverride = 'default';
        this.lodEnabled = true;
        this._isRepopulating = false;
        this._isPopulating = false;
        this._treeAnimationEnabled = true;
        this._treeMaxRenderDistance = null;
        this._treeLodLevel = null;

        // Register LOD groups if manager available
        if (this.lodManager) {
            this._registerLodGroups();
        }

        console.log('[HybridTreeManager] Initialized with patch-based alternation (chunkSize=' + this.chunkSize + ')');

        // Only show the active system's meshes; hide others to avoid rendering empty InstancedMesh overhead
        this._updateActiveSystemVisibility();
    }

    set terrainSystem(value) {
        this._terrainSystemRef = value;
        this._forEachSystem((sys) => {
            if (sys && 'terrainSystem' in sys) {
                sys.terrainSystem = value;
            }
        });
    }

    get terrainSystem() {
        return this._terrainSystemRef;
    }

    set animationEnabled(enabled) {
        this._treeAnimationEnabled = enabled;
        this._forEachSystem((sys) => {
            if (sys && 'animationEnabled' in sys) {
                sys.animationEnabled = enabled;
            }
        });
    }

    get animationEnabled() {
        return this._treeAnimationEnabled;
    }

    set maxRenderDistance(distance) {
        this._treeMaxRenderDistance = distance;
        this._forEachSystem((sys) => {
            if (sys && 'maxRenderDistance' in sys) {
                sys.maxRenderDistance = distance;
            }
        });
    }

    get maxRenderDistance() {
        return this._treeMaxRenderDistance;
    }

    setLodLevel(level) {
        this._treeLodLevel = level;
        this._forEachSystem((sys) => {
            if (sys && typeof sys.setLodLevel === 'function') {
                sys.setLodLevel(level);
            }
        });
    }

    _defineSystemAccessors() {
        const propMap = {
            terrain: 'terrainTreeSystem',
            growing: 'growingTreeSystem',
            poplar: 'poplarTreeSystem',
            cherry: 'cherryTreeSystem',
            billboard: 'billboardTreeSystem',
            realistic: 'realisticTreeSystem'
        };
        Object.entries(propMap).forEach(([key, prop]) => {
            Object.defineProperty(this, prop, {
                get: () => this._systems[key],
                set: (value) => {
                    this._systems[key] = value;
                    this._applyTreeSettings(value);
                }
            });
        });
    }

    _forEachSystem(callback) {
        for (const name of this._systemOrder) {
            const sys = this._systems[name];
            if (sys) callback(sys, name);
        }
    }

    _getActiveKey() {
        switch (this.treeTypeOverride) {
            case 'none':
                return null;
            case 'terrain':
                return 'terrain';
            case 'growing':
                return 'growing';
            case 'cherry':
                return 'cherry';
            case 'billboard':
                return 'billboard';
            case 'realistic':
                return 'realistic';
            case 'poplar':
            default:
                return 'poplar';
        }
    }

    _ensureSystem(name) {
        if (this._systems[name]) {
            return this._systems[name];
        }
        const Factory = this._systemFactoryClasses[name];
        if (!Factory) return null;
        const system = new Factory(this.scene, this._terrainSystemRef);
        this._systems[name] = system;
        this._applyTreeSettings(system);
        const activeKey = this._getActiveKey();
        this._attachSystemToScene(system, activeKey && activeKey === name);
        return system;
    }

    _applyTreeSettings(system) {
        if (!system) return;
        if (this._treeAnimationEnabled !== undefined && 'animationEnabled' in system) {
            system.animationEnabled = this._treeAnimationEnabled;
        }
        if (this._treeMaxRenderDistance !== null && 'maxRenderDistance' in system) {
            system.maxRenderDistance = this._treeMaxRenderDistance;
        }
        if (this._treeLodLevel && typeof system.setLodLevel === 'function') {
            system.setLodLevel(this._treeLodLevel);
        }
    }

    _setTreeInstanceVisibleByName(name, index, visible) {
        const system = this._systems[name];
        if (!system) return;
        this._setTreeInstanceVisible(system, index, visible);
    }

    _getActiveSystem() {
        const key = this._getActiveKey();
        if (!key) return null;
        return this._ensureSystem(key);
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
        const activeKey = this._getActiveKey();
        const activeSystem = activeKey ? this._systems[activeKey] : null;
        this._forEachSystem((system, name) => {
            const isActive = !!activeSystem && system === activeSystem;
            this._attachSystemToScene(system, isActive);
        });
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
            onCull: (tree, id) => this._setTreeInstanceVisibleByName('terrain', id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisibleByName('terrain', id, true)
        });
        lm.registerGroup('growingTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 100,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 600,
            onCull: (tree, id) => this._setTreeInstanceVisibleByName('growing', id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisibleByName('growing', id, true)
        });
        lm.registerGroup('poplarTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 120,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 1000,
            onCull: (tree, id) => this._setTreeInstanceVisibleByName('poplar', id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisibleByName('poplar', id, true)
        });
        lm.registerGroup('cherryTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 100,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 600,
            onCull: (tree, id) => this._setTreeInstanceVisibleByName('cherry', id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisibleByName('cherry', id, true)
        });
        lm.registerGroup('billboardTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 120,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 1000,
            onCull: (tree, id) => this._setTreeInstanceVisibleByName('billboard', id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisibleByName('billboard', id, true)
        });
        lm.registerGroup('realisticTrees', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 120,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 500,
            onCull: (tree, id) => this._setTreeInstanceVisibleByName('realistic', id, false),
            onVisible: (tree, id) => this._setTreeInstanceVisibleByName('realistic', id, true)
        });
    }

    _setTreeInstanceVisible(system, index, visible) {
        const tree = system.treeData[index];
        if (!tree) return;
        tree._lodVisible = !!visible;
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
                case 'terrain': return this._ensureSystem('terrain');
                case 'growing': return this._ensureSystem('growing');
                case 'cherry':  return this._ensureSystem('cherry');
                case 'billboard': return this._ensureSystem('billboard');
                case 'realistic': return this._ensureSystem('realistic');
                case 'poplar':
                default:        return this._ensureSystem('poplar');
            }
        }

        // Biome species hint: 60% chance to route to preferred system
        const hint = metadata && metadata.species;
        if (hint && hint !== 'none') {
            const roll = Math.random();
            if (roll < 0.6) {
                switch (hint) {
                    case 'terrain':   return this._ensureSystem('terrain');
                    case 'growing':   return this._ensureSystem('growing');
                    case 'poplar':    return this._ensureSystem('poplar');
                    case 'cherry':    return this._ensureSystem('cherry');
                    case 'billboard': return this._ensureSystem('billboard');
                    case 'realistic': return this._ensureSystem('realistic');
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
            case 0: return this._ensureSystem('terrain');
            case 1: return this._ensureSystem('growing');
            case 2: return this._ensureSystem('poplar');
            case 3:
            default: return this._ensureSystem('cherry');
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

        this._isRepopulating = true;

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
        const systemKey = this._getActiveKey() || 'billboard';
        const system = this._ensureSystem(systemKey);
        if (!system) return -1;
        const key = `${Math.floor(worldX)},${Math.floor(worldZ)}`;

        // Guard against duplicate placement
        if (this.treeRegistry.has(key)) return -1;

        let result = system.addTree(worldX, worldZ, terrainHeight, metadata);
        if (result === -1) return -1;

        this.treeRegistry.set(key, systemKey);
        if (this.lodManager) {
            const groupMap = {
                terrain: 'terrainTrees',
                growing: 'growingTrees',
                poplar: 'poplarTrees',
                cherry: 'cherryTrees',
                billboard: 'billboardTrees',
                realistic: 'realisticTrees'
            };
            const group = groupMap[systemKey];
            if (group) this.lodManager.add(group, system.treeData[result], result);
        }

        return result;
    }

    /**
     * Populate trees from server, distributing between systems based on chunk pattern
     */
    async populateFromServer() {
        if (this._isPopulating) {
            if (!this._populateSkipLogged) {
                console.log('[HybridTreeManager] populateFromServer already in progress, skipping');
                this._populateSkipLogged = true;
            }
            return;
        }
        this._populateSkipLogged = false;
        this._isPopulating = true;
        this.clear();
        return new Promise(async (resolve, reject) => {
            try {
                const response = await fetch('/api/trees');
                if (!response.ok) {
                    console.warn('[HybridTreeManager] /api/trees returned ' + response.status);
                    this._isPopulating = false;
                    resolve();
                    return;
                }
                const data = await response.json();
                const list = data.trees || [];
                console.log('[HybridTreeManager] Server reports ' + list.length + ' trees');

                const board = window.game && window.game.boardSystem;
                if (!board || typeof board.getUnifiedTerrainHeight !== 'function') {
                    console.warn('[HybridTreeManager] boardSystem.getUnifiedTerrainHeight not ready; aborting populate');
                    this._isPopulating = false;
                    resolve();
                    return;
                }

                const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;

                const systemKey = this._getActiveKey() || 'billboard';
                const system = this._ensureSystem(systemKey);
                if (system && typeof system.whenReady === 'function') {
                    await system.whenReady();
                }

                let placed = 0;
                let underwater = 0;

                // Process trees in batches to keep the main thread responsive
                const BATCH_SIZE = 100;
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
                        const result = this.addTree(wx + 0.5, wz + 0.5, height, meta);
                        if (result !== -1) placed++;
                    }

                    if (idx < list.length) {
                        requestAnimationFrame(processBatch);
                    } else {
                        console.log('[HybridTreeManager] Placed ' + placed + '/' + list.length + ' trees (' + underwater + ' skipped underwater, ' + (list.length - placed - underwater) + ' other rejects)');

                        // Compute wind field for billboard system
                        if (system && typeof system.computeWindField === 'function' && system.treeCount > 0) {
                            system.computeWindField();
                        }
                        this._isPopulating = false;
                        resolve();
                    }
                };

                processBatch();
            } catch (err) {
                this._isPopulating = false;
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
        try {
            const response = await fetch(`/api/trees/chunk/${chunkX}/${chunkZ}`);
            if (!response.ok) {
                return;
            }
            const data = await response.json();
            const list = data.trees || [];
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

            if (placed > 0) {
                this._forEachSystem((sys) => {
                    if (typeof sys.computeWindField === 'function' && sys.treeCount > 0) {
                        sys.computeWindField();
                    }
                });
            }
        } catch (err) {
            console.error(`[HybridTreeManager] loadTreesForChunk(${chunkX},${chunkZ}) failed:`, err);
        }
    }

    /**
     * Remove all trees belonging to a specific chunk from all systems.
     */
    unloadTreesForChunk(chunkX, chunkZ) {
        const chunkSize = this.chunkSize;
        const groupMap = {
            terrain: 'terrainTrees',
            growing: 'growingTrees',
            poplar: 'poplarTrees',
            cherry: 'cherryTrees',
            billboard: 'billboardTrees',
            realistic: 'realisticTrees'
        };

        this._forEachSystem((sys, name) => {
            const lodGroup = groupMap[name];
            if (!lodGroup) return;

            const indices = [];
            for (let i = 0; i < sys.treeCount; i++) {
                const tree = sys.treeData[i];
                if (Math.floor(tree.x / chunkSize) === chunkX && Math.floor(tree.z / chunkSize) === chunkZ) {
                    indices.push(i);
                }
            }
            if (!indices.length) return;

            indices.sort((a, b) => b - a);
            for (const idx of indices) {
                const lastIndex = sys.treeCount - 1;
                if (this.lodManager) {
                    this.lodManager.remove(lodGroup, idx);
                }

                const removed = sys.removeTree(idx);
                if (!removed) continue;
                const key = `${Math.floor(removed.x)},${Math.floor(removed.z)}`;
                this.treeRegistry.delete(key);

                if (idx < lastIndex && this.lodManager) {
                    this.lodManager.remove(lodGroup, lastIndex);
                    const movedTree = sys.treeData[idx];
                    if (movedTree) {
                        this.lodManager.add(lodGroup, movedTree, idx);
                    }
                }
            }
        });
    }

    /**
     * Remove all trees from all systems
     */
    clear() {
        this._forEachSystem((sys) => {
            if (sys && typeof sys.clear === 'function') {
                sys.clear();
            }
        });
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
        this._forEachSystem((system) => {
            this._attachSystemToScene(system, visible);
        });
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
            const systems = {
                terrain: this._systems.terrain,
                growing: this._systems.growing,
                poplar: this._systems.poplar,
                cherry: this._systems.cherry,
                billboard: this._systems.billboard
            };

            if (systems.terrain) {
                const go = this.lodManager.shouldAnimateGroup('terrainTrees', 1);
                if (go && typeof systems.terrain.update === 'function') {
                    systems.terrain.update(timeSec, windStrength, windDirection);
                }
            }

            if (systems.growing) {
                const go = this.lodManager.shouldAnimateGroup('growingTrees', 2);
                if (go && typeof systems.growing.update === 'function') {
                    systems.growing.update(timeSec, windStrength, windDirection);
                }
            }

            if (systems.poplar) {
                const visible = this.lodManager.getGroupVisibleCount('poplarTrees');
                const interval = visible < 50 ? 1 : visible < 200 ? 4 : 8;
                const go = this.lodManager.shouldAnimateGroup('poplarTrees', interval);
                if (go && typeof systems.poplar.update === 'function') {
                    systems.poplar.update(timeSec, windStrength, windDirection);
                }
            }

            if (systems.cherry) {
                const go = this.lodManager.shouldAnimateGroup('cherryTrees', 2);
                if (go && typeof systems.cherry.update === 'function') {
                    systems.cherry.update(timeSec, windStrength, windDirection);
                }
            }

            if (systems.billboard) {
                const go = this.lodManager.shouldAnimateGroup('billboardTrees', 1);
                if (go && typeof systems.billboard.update === 'function') {
                    systems.billboard.update(timeSec, windStrength, windDirection);
                }
            }
        } else {
            this._forEachSystem((sys) => {
                if (typeof sys.update === 'function') {
                    sys.update(timeSec, windStrength, windDirection);
                }
            });
        }
    }

    /**
     * Check if a tree exists at position
     */
    hasTreeAt(worldX, worldZ) {
        let found = false;
        this._forEachSystem((sys) => {
            if (found || !sys || typeof sys.hasTreeAt !== 'function') return;
            if (sys.hasTreeAt(worldX, worldZ)) {
                found = true;
            }
        });
        return found;
    }

    /**
     * Get tree count from all systems
     */
    getTreeCount() {
        let total = 0;
        this._forEachSystem((sys) => {
            if (sys && typeof sys.getTreeCount === 'function') {
                total += sys.getTreeCount();
            }
        });
        return total;
    }

    /**
     * Dispose all systems
     */
    dispose() {
        this._forEachSystem((sys, name) => {
            if (sys && typeof sys.dispose === 'function') {
                sys.dispose();
            }
            this._systems[name] = null;
        });
        this.treeRegistry.clear();
        console.log('[HybridTreeManager] Disposed');
    }

    /**
     * Set season for all systems
     */
    setSeason(season) {
        this._forEachSystem((sys) => {
            if (sys && typeof sys.setSeason === 'function') {
                sys.setSeason(season);
            }
        });
    }
}
