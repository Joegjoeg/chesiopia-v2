/**
 * DistanceManager - Single source of truth for all draw distances.
 *
 * Computes actual distances from three inputs:
 *   1. Base maximum (hard ceiling for each distance type)
 *   2. Performance scale (0.2-1.0, driven by FPS quality level)
 *   3. User multiplier (0.5-2.0 per category, from dev tools)
 *
 * Formula: actual = baseMaximum * performanceScale * userMultiplier
 *
 * Respects absolute overrides: if a parameter like fogFar or treeCullDistance
 * has been set directly via ParameterSystem (userOverridden === true), the
 * DistanceManager skips that value and leaves the absolute override in place.
 */
class DistanceManager {
    constructor(game) {
        this.game = game;

        // Base maximums — these are the hard ceilings at Ultra quality with 1.0x multiplier
        this.baseMax = {
            fogNear: 20,
            fogFar: 100,
            treeRender: 80,
            treeCull: 120,
            lodHigh: 15,
            lodMedium: 30,
            lodLow: 45,
            lodVeryLow: 60,
            lodHorizon: 120
        };

        // Performance scale (0.2 - 1.0). Set externally by PerformanceManager.
        this.performanceScale = 1.0;

        // User multipliers (0.5 - 2.0). Set externally by ParameterSystem.
        this.userMultipliers = {
            fog: 1.0,
            tree: 1.0,
            lod: 1.0
        };

        // Track what we last applied so we can diff
        this._lastApplied = {};

        console.log('[DistanceManager] Initialized');
    }

    /**
     * Set the performance scale (0.2 - 1.0).
     * Called by PerformanceManager whenever quality level changes.
     */
    setPerformanceScale(scale) {
        scale = Math.max(0.2, Math.min(1.0, scale));
        if (Math.abs(scale - this.performanceScale) < 0.001) return;
        this.performanceScale = scale;
        this.applyDistances();
    }

    /**
     * Set a user multiplier for a category.
     * Called by ParameterSystem when sliders change.
     */
    setUserMultiplier(category, value) {
        value = Math.max(0.5, Math.min(2.0, value));
        if (this.userMultipliers[category] === value) return;
        this.userMultipliers[category] = value;
        this.applyDistances();
    }

    /**
     * Apply all computed distances to game systems.
     * Skips any value that has an absolute user override in ParameterSystem.
     */
    applyDistances() {
        const ps = window.parameterSystem;
        const game = this.game;
        if (!game) return;

        // --- Fog ---
        const fogMul = this.userMultipliers.fog;
        const fogScale = this.performanceScale;
        this._applyFog('fogNear', this.baseMax.fogNear * fogScale * fogMul, ps, game);
        this._applyFog('fogFar',  this.baseMax.fogFar  * fogScale * fogMul, ps, game);

        // --- Tree distances ---
        const treeMul = this.userMultipliers.tree;
        const treeScale = this.performanceScale;
        this._applyTreeRender(this.baseMax.treeRender * treeScale * treeMul, ps, game);
        this._applyTreeCull(this.baseMax.treeCull * treeScale * treeMul, ps, game);

        // --- LOD distances ---
        const lodMul = this.userMultipliers.lod;
        const lodScale = this.performanceScale;
        this._applyLod('lodHighDistance',    this.baseMax.lodHigh    * lodScale * lodMul, ps, game);
        this._applyLod('lodMediumDistance',  this.baseMax.lodMedium  * lodScale * lodMul, ps, game);
        this._applyLod('lodLowDistance',     this.baseMax.lodLow     * lodScale * lodMul, ps, game);
        this._applyLod('lodVeryLowDistance', this.baseMax.lodVeryLow * lodScale * lodMul, ps, game);
        // Horizon LOD also caps the terrain maxRenderDistance
        const horizonDist = this.baseMax.lodHorizon * lodScale * lodMul;
        this._applyLod('lodHorizonDistance', horizonDist, ps, game);
        this._applyMaxRenderDistance(horizonDist, ps, game);
    }

    // ---- Internal helpers ----

    _isOverridden(paramName, ps) {
        if (!ps) return false;
        const p = ps.params.get(paramName);
        return !!(p && p.userOverridden);
    }

    _applyFog(paramName, computedValue, ps, game) {
        if (this._isOverridden(paramName, ps)) return;
        const scene = game.boardSystem && game.boardSystem.scene;
        if (!scene || !scene.fog) return;
        if (paramName === 'fogNear') {
            scene.fog.near = computedValue;
        } else if (paramName === 'fogFar') {
            scene.fog.far = computedValue;
        }
        this._lastApplied[paramName] = computedValue;
    }

    _applyTreeRender(computedValue, ps, game) {
        if (this._isOverridden('treeCullDistance', ps)) return; // treeCullDistance is the dominant override
        // Apply to tree systems
        const htm = game.hybridTreeManager;
        if (htm) {
            htm.maxRenderDistance = computedValue;
        }
        this._lastApplied.treeRender = computedValue;
    }

    _applyTreeCull(computedValue, ps, game) {
        if (this._isOverridden('treeCullDistance', ps)) return;
        const lm = game.lodManager;
        if (lm && lm.setGroupCullDistance) {
            lm.setGroupCullDistance('terrainTrees', computedValue);
            lm.setGroupCullDistance('growingTrees', computedValue);
            lm.setGroupCullDistance('poplarTrees', computedValue);
            lm.setGroupCullDistance('cherryTrees', computedValue);
            lm.setGroupCullDistance('billboardTrees', computedValue);
        }
        this._lastApplied.treeCull = computedValue;
    }

    _applyLod(paramName, computedValue, ps, game) {
        if (this._isOverridden(paramName, ps)) return;
        const bs = game.boardSystem;
        if (!bs || !bs.optimization || !bs.optimization.lodLevels) return;

        const idxMap = {
            lodHighDistance: 0,
            lodMediumDistance: 1,
            lodLowDistance: 2,
            lodVeryLowDistance: 3,
            lodHorizonDistance: 4
        };
        const idx = idxMap[paramName];
        if (idx === undefined) return;

        const lodEntry = bs.optimization.lodLevels[idx];
        if (lodEntry) {
            lodEntry.distance = computedValue;
        }
        this._lastApplied[paramName] = computedValue;
    }

    _applyMaxRenderDistance(computedValue, ps, game) {
        if (this._isOverridden('maxRenderDistance', ps)) return;
        const bs = game.boardSystem;
        if (!bs) return;
        // Only board_clean uses maxRenderDistance for cone culling
        if (bs.optimization && bs.optimization.maxRenderDistance !== undefined) {
            bs.optimization.maxRenderDistance = computedValue;
        }
        this._lastApplied.maxRenderDistance = computedValue;
    }

    // ---- Public read API ----

    getActualDistance(type) {
        return this._lastApplied[type] || this.baseMax[type] || 0;
    }

    getStatus() {
        return {
            performanceScale: this.performanceScale,
            userMultipliers: { ...this.userMultipliers },
            lastApplied: { ...this._lastApplied }
        };
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DistanceManager;
}
