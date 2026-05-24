/**
 * ResourceGuard — Pre-crash detection & emergency cleanup
 * Monitors heap, draw calls, geometry/texture counts for leaks and extreme usage.
 * Always-on, lightweight (checks every 3s), no console spam unless threshold breached.
 */
class ResourceGuard {
    constructor(game) {
        this.game = game;
        this.renderer = game.renderer;
        this.performanceManager = game.performanceManager;

        this._checkIntervalMs = 3000;
        this._lastCheckTime = 0;
        this._consecutiveGeoIncreases = 0;
        this._consecutiveTexIncreases = 0;
        this._lastGeoCount = 0;
        this._lastTexCount = 0;
        this._warningFired = false;
        this._criticalFired = false;
        this._hasEmergencyCleaned = false;

        this._thresholds = {
            heapWarnPercent: 0.75,
            heapCriticalPercent: 0.90,
            drawCallsWarn: 2000,
            drawCallsCritical: 4000,
            trianglesWarn: 2000000,
            trianglesCritical: 4000000,
            geoLeakConsecutive: 6,   // 6 increases (~18s) = probable leak
            texLeakConsecutive: 6
        };
    }

    update(currentTimeMs) {
        if (currentTimeMs - this._lastCheckTime < this._checkIntervalMs) return;
        this._lastCheckTime = currentTimeMs;

        const heap = performance.memory || {};
        const limit = heap.jsHeapSizeLimit || 1;
        const used = heap.usedJSHeapSize || 0;
        const heapRatio = used / limit;

        const info = this.renderer ? this.renderer.info : null;
        const drawCalls = info ? info.render.calls : 0;
        const triangles = info ? info.render.triangles : 0;

        const counts = this._countSceneObjects();
        const geoCount = counts.geometries;
        const texCount = counts.textures;

        // ── Leak detection: consecutive increases ──
        if (geoCount > this._lastGeoCount) {
            this._consecutiveGeoIncreases++;
        } else {
            this._consecutiveGeoIncreases = 0;
        }
        if (texCount > this._lastTexCount) {
            this._consecutiveTexIncreases++;
        } else {
            this._consecutiveTexIncreases = 0;
        }
        this._lastGeoCount = geoCount;
        this._lastTexCount = texCount;

        // ── Warning level ──
        let warnMsg = null;
        if (heapRatio > this._thresholds.heapWarnPercent) {
            warnMsg = `[ResourceGuard] Heap high: ${(heapRatio * 100).toFixed(1)}% (${this._fmtBytes(used)} / ${this._fmtBytes(limit)})`;
        }
        if (drawCalls > this._thresholds.drawCallsWarn) {
            warnMsg = `[ResourceGuard] Draw calls high: ${drawCalls}`;
        }
        if (triangles > this._thresholds.trianglesWarn) {
            warnMsg = `[ResourceGuard] Triangles high: ${(triangles / 1000000).toFixed(2)}M`;
        }
        if (this._consecutiveGeoIncreases >= this._thresholds.geoLeakConsecutive) {
            warnMsg = `[ResourceGuard] Probable geometry leak: ${geoCount} geometries (increased ${this._consecutiveGeoIncreases}x consecutively)`;
        }
        if (this._consecutiveTexIncreases >= this._thresholds.texLeakConsecutive) {
            warnMsg = `[ResourceGuard] Probable texture leak: ${texCount} textures (increased ${this._consecutiveTexIncreases}x consecutively)`;
        }
        if (warnMsg && !this._warningFired) {
            console.warn(warnMsg);
            this._warningFired = true;
        }

        // ── Critical / emergency cleanup ──
        const isCritical = heapRatio > this._thresholds.heapCriticalPercent
            || drawCalls > this._thresholds.drawCallsCritical
            || triangles > this._thresholds.trianglesCritical;

        if (isCritical && !this._hasEmergencyCleaned) {
            console.error(`[ResourceGuard] CRITICAL — emergency cleanup triggered`);
            this._emergencyCleanup();
            this._hasEmergencyCleaned = true;
        }

        if (!isCritical) {
            this._hasEmergencyCleaned = false;
            this._criticalFired = false;
        }
        if (!warnMsg) {
            this._warningFired = false;
        }
    }

    _emergencyCleanup() {
        // 1. Drop quality to minimum
        if (this.performanceManager) {
            const oldLevel = this.performanceManager.qualityLevel;
            this.performanceManager.qualityLevel = 0;
            this.performanceManager.applySettings();
            console.warn(`[ResourceGuard] Quality dropped: ${oldLevel} → 0`);
        }

        // 2. Disable Temporal AA
        if (this.game.temporalAA && this.game.temporalAA.enabled) {
            this.game.temporalAA.setEnabled(false);
            console.warn('[ResourceGuard] Temporal AA disabled');
        }

        // 3. Snapshot before any GC hint
        this._snapshot();

        // 4. Hint GC (may be ignored by browser, but safe to try)
        if (window.gc) {
            try { window.gc(); console.warn('[ResourceGuard] GC hinted'); } catch (e) {}
        }
    }

    _snapshot() {
        const heap = performance.memory || {};
        const info = this.renderer ? this.renderer.info : null;
        console.group('[ResourceGuard] Snapshot');
        console.log('Heap:', {
            used: this._fmtBytes(heap.usedJSHeapSize),
            total: this._fmtBytes(heap.totalJSHeapSize),
            limit: this._fmtBytes(heap.jsHeapSizeLimit)
        });
        if (info) {
            console.log('Render calls:', info.render.calls);
            console.log('Render triangles:', info.render.triangles);
            console.log('Render points:', info.render.points);
            console.log('Render lines:', info.render.lines);
        }
        const counts = this._countSceneObjects();
        console.log('Scene counts:', counts);
        console.groupEnd();
    }

    _countSceneObjects() {
        const scene = this.game.scene;
        if (!scene) return { meshes: 0, geometries: 0, materials: 0, textures: 0 };
        let meshes = 0;
        const geometries = new Set();
        const materials = new Set();
        const textures = new Set();

        scene.traverse((obj) => {
            if (obj.isMesh) {
                meshes++;
                if (obj.geometry) geometries.add(obj.geometry.uuid);
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    for (const m of mats) {
                        if (!m) continue;
                        materials.add(m.uuid);
                        for (const key of Object.keys(m)) {
                            const val = m[key];
                            if (val && val.isTexture) textures.add(val.uuid);
                        }
                        if (m.uniforms) {
                            for (const key of Object.keys(m.uniforms)) {
                                const val = m.uniforms[key];
                                if (val && val.value && val.value.isTexture) {
                                    textures.add(val.value.uuid);
                                }
                            }
                        }
                    }
                }
            }
        });

        return {
            meshes,
            geometries: geometries.size,
            materials: materials.size,
            textures: textures.size
        };
    }

    _fmtBytes(bytes) {
        if (!bytes) return '0B';
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
    }
}

window.ResourceGuard = ResourceGuard;
