/**
 * LODManager — Generic adaptive level-of-detail manager.
 *
 * Register any group of objects with distance rules. The manager evaluates
 * visibility, frustum inclusion, and performance pressure each frame, then
 * invokes your callbacks so the host system applies the actual changes.
 *
 * Works for individual Meshes, Groups, InstancedMeshes, particles, etc.
 *
 * Design note:  The manager decides WHO and WHAT level; the host system
 * decides HOW (e.g. set mesh.count, move off-screen, fade, hide children).
 * Buffer reordering for InstancedMesh is deliberately NOT handled here
 * because it destroys the stable index mapping most systems rely on.
 */

class LODManager {
    constructor(options = {}) {
        this.groups = new Map();
        this.camera = null;
        this.performanceManager = options.performanceManager || null;

        // Adaptive state
        this.globalDistanceScale = 1.0;   // 0.4 – 1.0
        this.globalLevelBias = 0;         // 0 – +2  (forces cheaper LOD)
        this.pressure = 0.0;              // 0.0 – 1.0
        this.frameCount = 0;

        // Frustum reuse
        this._frustum = new THREE.Frustum();
        this._projScreenMatrix = new THREE.Matrix4();
        this._tempMatrix = new THREE.Matrix4();
        this._scratchSphere = new THREE.Sphere();

        // Internal FPS fallback
        this._fpsHistory = [];
        this._lastFpsUpdate = 0;
        this._internalFps = 60;

        this.targetFps = options.targetFps || 30;
        this.minFps = options.minFps || 20;
        this.adaptiveSmoothing = options.adaptiveSmoothing || 0.15;

        // Override
        this._overrideActive = false;

        console.log('[LODManager] Initialized');
    }

    /**
     * Register a LOD group.
     *
     * config:
     *   levels: Array<{name: string, distance: number}>
     *           Sorted ascending by distance.  The first entry is the
     *           highest detail (closest to camera).
     *   cullDistance: number    — beyond this distance the item is culled.
     *   frustumCull: boolean   — run sphere-in-frustum test (default true).
     *   getPosition: (item) => THREE.Vector3  — MUST return a reference,
     *           e.g. item.position or a pre-existing vector. Do NOT allocate.
     *   getBoundsRadius: (item) => number  — for frustum sphere test.
     *   onLevelChange: (item, oldLevelName|null, newLevelName|null) => void
     *   onCull: (item) => void
     *   onVisible: (item) => void
     *   maxVisible: number    — hard cap; sorts by distance internally when exceeded.
     *   updateInterval: number — evaluate every N frames (default 1).
     *   hysteresisFrames: number — frames an item must stay at a new
     *           LOD level before the callback fires (default 3).
     */
    registerGroup(name, config) {
        const levels = [...config.levels].sort((a, b) => a.distance - b.distance);

        this.groups.set(name, {
            name,
            levels,
            cullDistance: config.cullDistance ?? Infinity,
            frustumCull: config.frustumCull ?? true,
            getPosition: config.getPosition,
            getBoundsRadius: config.getBoundsRadius || (() => 0),
            onLevelChange: config.onLevelChange || (() => {}),
            onCull: config.onCull || (() => {}),
            onVisible: config.onVisible || (() => {}),
            maxVisible: config.maxVisible ?? Infinity,
            updateInterval: Math.max(1, config.updateInterval || 1),
            hysteresisFrames: Math.max(0, config.hysteresisFrames ?? 3),
            items: new Map(), // id -> { id, item, currentLevel, pendingLevel, pendingFrames, wasVisible, distance }
            visibleCount: 0,
            _frameOffset: this.frameCount % 3,  // stagger group updates across frames
            _animFrame: 0  // for shouldAnimateGroup throttling
        });

        console.log(`[LODManager] Registered group '${name}' with ${levels.length} levels, cull ${config.cullDistance ?? '∞'}`);
    }

    add(groupName, item, id) {
        const group = this.groups.get(groupName);
        if (!group) {
            console.warn(`[LODManager] Unknown group '${groupName}'`);
            return false;
        }
        if (group.items.has(id)) {
            console.warn(`[LODManager] Duplicate id '${id}' in group '${groupName}'`);
            return false;
        }
        group.items.set(id, {
            id,
            item,
            currentLevel: -1,
            pendingLevel: -1,
            pendingFrames: 0,
            wasVisible: false,
            distance: 0
        });
        return true;
    }

    remove(groupName, id) {
        const group = this.groups.get(groupName);
        if (!group) return false;
        const entry = group.items.get(id);
        if (!entry) return false;

        // Fire a final cull if the item was visible
        if (entry.wasVisible) {
            group.onCull(entry.item);
            entry.wasVisible = false;
        }
        group.items.delete(id);
        return true;
    }

    clear(groupName) {
        if (groupName) {
            const g = this.groups.get(groupName);
            if (g) { g.items.clear(); g.visibleCount = 0; }
        } else {
            for (const g of this.groups.values()) {
                g.items.clear();
                g.visibleCount = 0;
            }
        }
    }

    dispose() {
        this.clear();
        this.groups.clear();
    }

    /** Call once per frame. */
    update(camera, deltaTime) {
        this.frameCount++;
        this.camera = camera;

        if (!this._overrideActive) {
            this._updatePressure(deltaTime);
        }

        if (this.groups.size === 0) return;

        this._buildFrustum(camera);

        for (const group of this.groups.values()) {
            // Stagger updates if interval > 1
            if ((this.frameCount + group._frameOffset) % group.updateInterval !== 0) continue;
            this._processGroup(group, camera);
        }
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    _updatePressure(deltaTime) {
        if (this.performanceManager) {
            const level = this.performanceManager.qualityLevel ?? 4;
            const maxLevel = this.performanceManager.maxQualityLevel ?? 4;
            const target = 1.0 - (level / maxLevel);
            this.pressure += (target - this.pressure) * this.adaptiveSmoothing;
        } else {
            this._fpsHistory.push(1 / Math.max(deltaTime, 0.001));
            if (this._fpsHistory.length > 30) this._fpsHistory.shift();

            const now = performance.now();
            if (now - this._lastFpsUpdate > 500) {
                const avg = this._fpsHistory.reduce((a, b) => a + b, 0) / this._fpsHistory.length;
                this._internalFps = this._internalFps * 0.7 + avg * 0.3;
                this._lastFpsUpdate = now;

                if (this._internalFps < this.minFps) {
                    this.pressure = Math.min(1, this.pressure + 0.15);
                } else if (this._internalFps > this.targetFps + 10) {
                    this.pressure = Math.max(0, this.pressure - 0.08);
                }
            }
        }

        this.globalDistanceScale = 1.0 - (this.pressure * 0.6); // 1.0 -> 0.4
        this.globalLevelBias = Math.floor(this.pressure * 2.5); // 0 -> +2
    }

    _buildFrustum(camera) {
        this._tempMatrix.makePerspective(
            camera.fov * (Math.PI / 180),
            camera.aspect,
            camera.near,
            camera.far
        );
        this._projScreenMatrix.multiplyMatrices(this._tempMatrix, camera.matrixWorldInverse);
        this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
    }

    _processGroup(group, camera) {
        const camPos = camera.position;
        const entries = [];
        const culledEntries = [];

        // 1. Distance + frustum
        const scaledCull = group.cullDistance * this.globalDistanceScale;

        for (const entry of group.items.values()) {
            const pos = group.getPosition(entry.item);
            entry.distance = pos.distanceTo(camPos);

            // Frustum sphere test
            let inFrustum = true;
            if (group.frustumCull) {
                const r = group.getBoundsRadius(entry.item);
                this._scratchSphere.set(pos, r);
                inFrustum = this._frustum.intersectsSphere(this._scratchSphere);
            }

            const culled = entry.distance > scaledCull || !inFrustum;

            if (culled) {
                culledEntries.push(entry);
                continue;
            }
            entries.push(entry);
        }

        // 2. Cull callbacks
        for (const entry of culledEntries) {
            if (entry.wasVisible) {
                group.onCull(entry.item, entry.id);
                entry.wasVisible = false;
                entry.currentLevel = -1;
                entry.pendingLevel = -1;
                entry.pendingFrames = 0;
            }
        }

        // 3. Visible callbacks
        for (const entry of entries) {
            if (!entry.wasVisible) {
                group.onVisible(entry.item, entry.id);
                entry.wasVisible = true;
            }
        }

        // 4. maxVisible hard cap — sort by distance, cull the excess
        let visibleEntries = entries;
        if (entries.length > group.maxVisible) {
            entries.sort((a, b) => a.distance - b.distance);
            const keep = entries.slice(0, group.maxVisible);
            const discard = entries.slice(group.maxVisible);
            for (const entry of discard) {
                if (entry.wasVisible) {
                    group.onCull(entry.item, entry.id);
                    entry.wasVisible = false;
                    entry.currentLevel = -1;
                    entry.pendingLevel = -1;
                    entry.pendingFrames = 0;
                }
            }
            visibleEntries = keep;
        }

        // 5. LOD level per visible entry (with hysteresis)
        for (const entry of visibleEntries) {
            const scaledDist = entry.distance / Math.max(this.globalDistanceScale, 0.001);

            // Descend thresholds: find the highest-index level whose
            // distance <= scaledDist
            let targetLevel = 0;
            for (let i = group.levels.length - 1; i >= 0; i--) {
                if (scaledDist >= group.levels[i].distance) {
                    targetLevel = i;
                    break;
                }
            }

            // Apply performance bias (cheaper LOD under pressure)
            targetLevel = Math.min(group.levels.length - 1, targetLevel + this.globalLevelBias);

            // Hysteresis debounce
            if (targetLevel !== entry.currentLevel) {
                if (entry.pendingLevel === targetLevel) {
                    entry.pendingFrames++;
                    if (entry.pendingFrames >= group.hysteresisFrames) {
                        // Commit transition
                        const oldName = entry.currentLevel >= 0
                            ? group.levels[entry.currentLevel].name
                            : null;
                        const newName = group.levels[targetLevel].name;
                        group.onLevelChange(entry.item, oldName, newName);
                        entry.currentLevel = targetLevel;
                        entry.pendingLevel = -1;
                        entry.pendingFrames = 0;
                    }
                } else {
                    entry.pendingLevel = targetLevel;
                    entry.pendingFrames = 1;
                }
            } else {
                entry.pendingLevel = -1;
                entry.pendingFrames = 0;
            }
        }

        group.visibleCount = visibleEntries.length;
    }

    // ------------------------------------------------------------------
    // Public helpers
    // ------------------------------------------------------------------

    /** Is any item in this group currently visible? */
    isGroupVisible(name) {
        const group = this.groups.get(name);
        return group ? group.visibleCount > 0 : false;
    }

    /** How many items in this group are currently visible? */
    getGroupVisibleCount(name) {
        const group = this.groups.get(name);
        return group ? group.visibleCount : 0;
    }

    /**
     * Throttled animation gate.
     * Returns true once every `interval` frames while the group has visible items.
     * Use this to skip expensive wind/uniform updates for distant systems.
     *
     * Example:
     *   if (lodManager.shouldAnimateGroup('poplarTrees', 3)) {
     *       poplarTreeSystem.update(timeSec, windStrength, windDirection);
     *   }
     */
    shouldAnimateGroup(name, interval = 1) {
        const group = this.groups.get(name);
        if (!group || group.visibleCount === 0) return false;
        group._animFrame++;
        return (group._animFrame % Math.max(1, interval)) === 0;
    }

    setGroupCullDistance(name, distance) {
        const group = this.groups.get(name);
        if (group) group.cullDistance = distance;
    }

    setGroupMaxVisible(name, count) {
        const group = this.groups.get(name);
        if (group) group.maxVisible = count;
    }

    getStatus() {
        const stats = {};
        for (const [name, g] of this.groups) {
            stats[name] = {
                total: g.items.size,
                visible: g.visibleCount,
                culled: g.items.size - g.visibleCount
            };
        }
        return {
            pressure: this.pressure,
            distanceScale: this.globalDistanceScale,
            levelBias: this.globalLevelBias,
            overrideActive: this._overrideActive,
            groups: stats
        };
    }

    getFrustum() {
        return this._frustum;
    }

    /** Force adaptive multipliers (disables auto until clearAdaptiveOverride is called). */
    setAdaptiveOverride(distanceScale, levelBias) {
        this.globalDistanceScale = distanceScale;
        this.globalLevelBias = levelBias;
        this._overrideActive = true;
    }

    clearAdaptiveOverride() {
        this._overrideActive = false;
    }
}
