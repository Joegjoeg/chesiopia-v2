// HybridTreeManager
// Coordinates TerrainTreeSystem, GrowingTreeSystem, PoplarTreeSystem, and CherryTreeSystem with patch-based alternation
// Uses 4-way chunk distribution cycling through the four tree types

class HybridTreeManager {
    constructor(scene, terrainSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.chunkSize = 16;

        // Initialize all four tree systems
        this.terrainTreeSystem = new TerrainTreeSystem(scene, terrainSystem);
        this.growingTreeSystem = new GrowingTreeSystem(scene, terrainSystem);
        this.poplarTreeSystem = new PoplarTreeSystem(scene, terrainSystem);
        this.cherryTreeSystem = new CherryTreeSystem(scene, terrainSystem);

        // Track which trees belong to which system
        this.treeRegistry = new Map(); // key -> 'terrain', 'growing', 'poplar', or 'cherry'

        console.log('[HybridTreeManager] Initialized with patch-based alternation (chunkSize=' + this.chunkSize + ')');
    }

    /**
     * Determine which tree system to use based on chunk position
     * 4-way distribution: chunks cycle through Terrain, Growing, Poplar, Cherry
     */
    _getTreeSystemForPosition(worldX, worldZ) {
        const chunkX = Math.floor(worldX / this.chunkSize);
        const chunkZ = Math.floor(worldZ / this.chunkSize);
        const mod = Math.abs(chunkX + chunkZ * 2) % 4;

        if (mod === 0) return this.terrainTreeSystem;
        if (mod === 1) return this.growingTreeSystem;
        if (mod === 2) return this.poplarTreeSystem;
        return this.cherryTreeSystem;
    }

    /**
     * Add a tree at world position. Routes to appropriate system based on chunk.
     */
    addTree(worldX, worldZ, terrainHeight) {
        const system = this._getTreeSystemForPosition(worldX, worldZ);
        const key = `${Math.floor(worldX)},${Math.floor(worldZ)}`;

        let result;
        if (system === this.terrainTreeSystem) {
            result = system.addTree(worldX, worldZ, terrainHeight);
            this.treeRegistry.set(key, 'terrain');
        } else if (system === this.growingTreeSystem) {
            result = system.addTree(worldX, worldZ, terrainHeight);
            this.treeRegistry.set(key, 'growing');
        } else if (system === this.poplarTreeSystem) {
            result = system.addTree(worldX, worldZ, terrainHeight);
            this.treeRegistry.set(key, 'poplar');
        } else {
            result = system.addTree(worldX, worldZ, terrainHeight);
            this.treeRegistry.set(key, 'cherry');
        }

        return result;
    }

    /**
     * Populate trees from server, distributing between systems based on chunk pattern
     */
    async populateFromServer() {
        try {
            const response = await fetch('/api/trees');
            if (!response.ok) {
                console.warn('[HybridTreeManager] /api/trees returned ' + response.status);
                return;
            }
            const data = await response.json();
            const list = data.trees || [];
            console.log('[HybridTreeManager] Server reports ' + list.length + ' trees');

            const board = window.game && window.game.boardSystem;
            if (!board || typeof board.getUnifiedTerrainHeight !== 'function') {
                console.warn('[HybridTreeManager] boardSystem.getUnifiedTerrainHeight not ready; aborting populate');
                return;
            }

            const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;

            let placed = 0;
            let underwater = 0;
            let terrainTrees = 0;
            let growingTrees = 0;
            let poplarTrees = 0;
            let cherryTrees = 0;

            for (const t of list) {
                const wx = t.x;
                const wz = t.y;
                const height = board.getUnifiedTerrainHeight(wx, wz);

                if (height < waterCutoff) { underwater++; continue; }

                const system = this._getTreeSystemForPosition(wx, wz);
                const key = `${Math.floor(wx)},${Math.floor(wz)}`;

                if (system === this.terrainTreeSystem) {
                    if (this.terrainTreeSystem.addTree(wx + 0.5, wz + 0.5, height) !== -1) {
                        terrainTrees++;
                        this.treeRegistry.set(key, 'terrain');
                    }
                } else if (system === this.growingTreeSystem) {
                    if (this.growingTreeSystem.addTree(wx + 0.5, wz + 0.5, height) !== -1) {
                        growingTrees++;
                        this.treeRegistry.set(key, 'growing');
                    }
                } else if (system === this.poplarTreeSystem) {
                    if (this.poplarTreeSystem.addTree(wx + 0.5, wz + 0.5, height) !== -1) {
                        poplarTrees++;
                        this.treeRegistry.set(key, 'poplar');
                    }
                } else {
                    if (this.cherryTreeSystem.addTree(wx + 0.5, wz + 0.5, height) !== -1) {
                        cherryTrees++;
                        this.treeRegistry.set(key, 'cherry');
                    }
                }
                placed++;
            }

            console.log('[HybridTreeManager] Placed ' + placed + ' trees (' + underwater + ' skipped underwater)');
            console.log('[HybridTreeManager] Distribution: ' + terrainTrees + ' terrain, ' + growingTrees + ' growing, ' + poplarTrees + ' poplar, ' + cherryTrees + ' cherry');
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
            console.log('[HybridTreeManager] Wind field computed for all systems');
        } catch (err) {
            console.error('[HybridTreeManager] populateFromServer failed:', err);
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
        this.treeRegistry.clear();
        console.log('[HybridTreeManager] Cleared all trees');
    }

    /**
     * Update all tree systems
     */
    update(timeSec, windStrength, windDirection) {
        if (Math.random() < 0.01) {
            console.log('[HybridTreeManager] update called, timeSec:', timeSec, 'windStrength:', windStrength);
        }
        this.terrainTreeSystem.update(timeSec, windStrength, windDirection);
        this.growingTreeSystem.update(timeSec, windStrength, windDirection);
        this.poplarTreeSystem.update(timeSec, windStrength, windDirection);
        this.cherryTreeSystem.update(timeSec, windStrength, windDirection);
    }

    /**
     * Check if a tree exists at position
     */
    hasTreeAt(worldX, worldZ) {
        return this.terrainTreeSystem.hasTreeAt(worldX, worldZ) ||
               this.growingTreeSystem.hasTreeAt(worldX, worldZ) ||
               this.poplarTreeSystem.hasTreeAt(worldX, worldZ) ||
               this.cherryTreeSystem.hasTreeAt(worldX, worldZ);
    }

    /**
     * Get tree count from all systems
     */
    getTreeCount() {
        return this.terrainTreeSystem.getTreeCount() +
               this.growingTreeSystem.getTreeCount() +
               this.poplarTreeSystem.getTreeCount() +
               this.cherryTreeSystem.getTreeCount();
    }

    /**
     * Dispose all systems
     */
    dispose() {
        this.terrainTreeSystem.dispose();
        this.growingTreeSystem.dispose();
        this.poplarTreeSystem.dispose();
        this.cherryTreeSystem.dispose();
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
    }
}
