/**
 * ParameterSystem - Centralized, gated parameter registry for dev tools.
 *
 * Design:
 *  - Each parameter has a declarative config: default, range, category, description,
 *    optional apply() to propagate to game systems, and optional gate() to install a
 *    property descriptor that silently ignores game-logic writes when the user has
 *    taken control (userOverridden === true).
 *  - Computed per-frame values (sun/moon/ambient intensity, fog near/far) are protected
 *    via Object.defineProperty gates. Writes from any source are ignored once the user
 *    has set the parameter from the dev tools.
 *  - Color objects (sun/moon/ambient .color) are protected by monkey-patching
 *    copy/lerp/setRGB/setHex/set on the instance, because Three.js mutates them in
 *    place rather than reassigning.
 *  - Time (dayTime/daySpeed) is protected by wrapping updateServerGameTime so user
 *    values survive server syncs.
 */

class ParameterSystem {
    constructor() {
        this.params = new Map();
        this.installed = new Set();
        this.listeners = new Set();
        this._taaWarningShown = false;

        this._registerAll();
        console.log(`[ParameterSystem] Registered ${this.params.size} parameters`);

        // Cache the systems-ready promise so all consumers share one wait
        this.systemsReady = this._waitForSystems();

        // Install gates first, then apply saved defaults so values override hardcoded defaults
        this.systemsReady.then(() => this._installAll())
                         .then(() => this._loadSavedDefaults())
                         .catch(err => console.error('[ParameterSystem] init chain failed:', err));
        this._setupSocketListeners();
    }

    // ---------- Public API ----------

    setParameter(name, value, source = 'user', options = {}) {
        console.log(`[ParameterSystem] setParameter("${name}",`, value, `, src=${source})`);
        const p = this.params.get(name);
        if (!p) {
            console.warn(`[ParameterSystem] Unknown parameter: ${name}`);
            return false;
        }

        const coerced = this._coerce(p, value, options.clamp !== false);
        console.log(`[ParameterSystem] "${name}" coerced:`, value, '->', coerced);
        if (coerced === undefined) {
            console.warn(`[ParameterSystem] "${name}" coercion returned undefined`);
            return false;
        }
        value = coerced;

        p.value = value;
        p.lastModified = Date.now();
        p.modifiedBy = source;
        if (source !== 'reset' && source !== 'init') {
            p.userOverridden = true;
        }

        const sys = this._getSystem();
        console.log(`[ParameterSystem] "${name}" applying to sys=`, !!sys);
        this._apply(name, p, sys, /*forceThroughGate=*/true);
        this._updateUI(name, value);
        this._emit(name, value, p);

        console.log(`[ParameterSystem] ${name} = ${value} (src=${source}, override=${p.userOverridden})`);
        return true;
    }

    getParameter(name) {
        const p = this.params.get(name);
        if (!p) return undefined;
        // Lazy-init modifierStack default so callers always get a real instance
        if (p.type === 'modifierStack' && p.value === null) {
            p.value = ModifierStack.defaultStack();
        }
        return p.value;
    }

    resetParameter(name) {
        const p = this.params.get(name);
        if (!p) return;
        p.userOverridden = false;
        this.setParameter(name, p.defaultValue, 'reset');
    }

    resetAll() {
        this.params.forEach((_, name) => this.resetParameter(name));
        console.log('[ParameterSystem] All parameters reset to defaults');
    }

    getAllParameters() {
        const out = {};
        this.params.forEach((p, name) => {
            out[name] = this._snapshot(p);
        });
        return out;
    }

    getParametersByCategory(category) {
        const out = {};
        this.params.forEach((p, name) => {
            if (p.category === category) out[name] = this._snapshot(p);
        });
        return out;
    }

    getCategories() {
        const set = new Set();
        this.params.forEach(p => set.add(p.category));
        return Array.from(set);
    }

    isOverridden(name) {
        const p = this.params.get(name);
        return p ? p.userOverridden : false;
    }

    onParameterChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    // ---------- Registration ----------

    _registerAll() {
        const reg = (name, cfg) => {
            this.params.set(name, Object.assign({
                name,
                value: cfg.default,
                defaultValue: cfg.default,
                userOverridden: false,
                lastModified: Date.now(),
                modifiedBy: 'init'
            }, cfg));
        };

        // --- Terrain ---
        reg('waterLevel', {
            category: 'terrain', type: 'number', default: -1.5, min: -10, max: 10, step: 0.1,
            description: 'Water surface Y position',
            gate: { targetOf: sys => sys, prop: 'waterLevel' }
        });
        reg('waveHeight', {
            category: 'terrain', type: 'number', default: 1.0, min: 0.0, max: 5.0, step: 0.05,
            description: 'Master wave height multiplier',
            shortLabel: 'Wave Height',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms.uWaveHeight) {
                    tbs.shaderMaterial.uniforms.uWaveHeight.value = v;
                }
            }
        });
        reg('tideAmplitude', {
            category: 'terrain', type: 'number', default: 0.3, min: 0.0, max: 3.0, step: 0.05,
            description: 'Tidal water level range driven by moon phase',
            shortLabel: 'Tide Amplitude',
            gate: { targetOf: sys => sys, prop: 'tideAmplitude' }
        });
        reg('snowLevelSeasonal', {
            category: 'terrain', type: 'number', default: 8.0, min: 0.0, max: 30.0, step: 0.5,
            description: 'How much snow line drops in winter (height units)',
            shortLabel: 'Snow Seasonal',
            gate: { targetOf: sys => sys, prop: 'snowLevelSeasonal' }
        });
        reg('beachWidth', {
            category: 'terrain', type: 'number', default: 4, min: 1, max: 20, step: 1,
            description: 'Beach width (regen)',
            gate: { targetOf: sys => sys, prop: 'beachWidth' }
        });
        reg('chunkSize', {
            category: 'terrain', type: 'number', default: 16, min: 4, max: 32, step: 1,
            description: 'Chunk size (regen)',
            gate: { targetOf: sys => sys, prop: 'chunkSize' }
        });
        reg('meshMultiplier', {
            category: 'terrain', type: 'number', default: 24, min: 4, max: 72, step: 1,
            description: 'Mesh density',
            apply: (v, sys) => {
                // DISABLED automatic board creation - handled by game.js
                // if (sys.createBoard) sys.createBoard(0, 0, 3, v);
            }
        });
        reg('terrainOpacity', {
            category: 'terrain', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.05,
            description: 'Overall terrain mesh transparency',
            shortLabel: 'Terrain Opacity',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms.uTerrainOpacity) {
                    tbs.shaderMaterial.uniforms.uTerrainOpacity.value = v;
                }
            }
        });
        reg('useViewportMesh', {
            category: 'terrain', type: 'boolean', default: true,
            description: 'Use rolling viewport mesh (disable for shoreline subdivision)',
            shortLabel: 'Viewport Mesh',
            apply: (v, sys) => {
                if (sys && sys.setUseViewportMesh) {
                    sys.setUseViewportMesh(v);
                }
            }
        });
        reg('shorelineSubdivision', {
            category: 'terrain', type: 'number', default: 0, min: 0, max: 2, step: 1,
            description: 'Subdivide shoreline tiles where angles are steep (0=off, 1=medium, 2=high)',
            shortLabel: 'Shore Subdiv',
            apply: (v, sys) => {
                if (sys && sys.setShorelineSubdivision) {
                    sys.setShorelineSubdivision(v);
                }
            }
        });

        // --- LOD ---
        const lodApply = (idx) => (v, sys) => {
            if (sys.optimization && sys.optimization.lodLevels && sys.optimization.lodLevels[idx]) {
                sys.optimization.lodLevels[idx].distance = v;
            }
        };
        reg('lodHighDistance',    { category: 'lod', type: 'number', default: 15, min: 5,  max: 30,  step: 1, description: 'High LOD distance',     apply: lodApply(0) });
        reg('lodMediumDistance',  { category: 'lod', type: 'number', default: 30, min: 15, max: 45,  step: 1, description: 'Medium LOD distance',  apply: lodApply(1) });
        reg('lodLowDistance',     { category: 'lod', type: 'number', default: 45, min: 30, max: 60,  step: 1, description: 'Low LOD distance',     apply: lodApply(2) });
        reg('lodVeryLowDistance', { category: 'lod', type: 'number', default: 60, min: 45, max: 100, step: 1, description: 'Very-low LOD distance', apply: lodApply(3) });

        // --- Planet ---
        reg('planetSphereRadius', {
            shortLabel: 'Sphere R',
            category: 'planet', type: 'number', default: 180, min: 5, max: 5000, step: 10,
            description: 'Planet sphere radius for deformation',
            apply: (v, sys) => {
                if (sys.setPlanetSphereRadius) {
                    sys.setPlanetSphereRadius(v);
                } else if (sys.planetMapping && sys.planetMapping.activePlanet) {
                    sys.planetMapping.activePlanet.sphereRadius = v;
                }
            }
        });
        reg('planetWrapRadius', {
            shortLabel: 'Wrap R',
            category: 'planet', type: 'number', default: 128, min: 64, max: 512, step: 1,
            description: 'Coordinate wrap radius from planet center',
            apply: (v, sys) => {
                if (sys.planetMapping && sys.planetMapping.activePlanet) {
                    sys.planetMapping.activePlanet.wrapRadiusX = v;
                    sys.planetMapping.activePlanet.wrapRadiusZ = v;
                }
            }
        });
        reg('deformStartHeight', {
            shortLabel: 'Deform Start',
            category: 'planet', type: 'number', default: 10, min: 0, max: 100, step: 1,
            description: 'Camera height where spherical deformation begins',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (!tbs) return;
                if (typeof tbs.setDeformStartHeight === 'function') {
                    tbs.setDeformStartHeight(v);
                } else if (tbs.shaderMaterial?.uniforms?.uDeformStartHeight) {
                    tbs.shaderMaterial.uniforms.uDeformStartHeight.value = v;
                } else {
                    tbs.deformStartHeight = v;
                }
            }
        });
        reg('deformEndHeight', {
            shortLabel: 'Deform End',
            category: 'planet', type: 'number', default: 100, min: 20, max: 500, step: 1,
            description: 'Camera height where deformation is fully spherical',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (!tbs) return;
                if (typeof tbs.setDeformEndHeight === 'function') {
                    tbs.setDeformEndHeight(v);
                } else if (tbs.shaderMaterial?.uniforms?.uDeformEndHeight) {
                    tbs.shaderMaterial.uniforms.uDeformEndHeight.value = v;
                } else {
                    tbs.deformEndHeight = v;
                }
            }
        });
        reg('enablePlanetWrap', {
            category: 'planet', type: 'boolean', default: true,
            description: 'Planet wrap',
            apply: (v, sys) => {
                if (sys.planetMapping) {
                    sys.planetMapping.setEnabled(v);
                }
            }
        });
        reg('enableSpherical', {
            category: 'planet', type: 'boolean', default: true,
            description: 'Spherical shader',
            apply: (v, sys) => {
                if (sys.textureBlendingSystem) {
                    sys.textureBlendingSystem.sphericalEnabled = v;
                }
            }
        });
        reg('debugForceSpherical', {
            category: 'planet', type: 'boolean', default: false,
            description: 'Force spherical',
            apply: (v, sys) => {
                if (sys.textureBlendingSystem && sys.textureBlendingSystem.shaderMaterial) {
                    sys.textureBlendingSystem.shaderMaterial.uniforms.uDebugForceSpherical.value = v ? 1.0 : 0.0;
                }
            }
        });
        reg('curvatureScale', {
            shortLabel: 'Curvature',
            category: 'planet', type: 'number', default: 2.0, min: 0.1, max: 10.0, step: 0.1,
            description: 'Amplifies spherical curvature drop',
            apply: (v, sys) => {
                if (sys.textureBlendingSystem) {
                    sys.textureBlendingSystem.curvatureScale = v;
                }
            }
        });
        reg('enableTerrainFade', {
            category: 'planet', type: 'boolean', default: true,
            description: 'Terrain circular fade',
            apply: (v, sys) => {
                if (sys.textureBlendingSystem) {
                    sys.textureBlendingSystem.fadeEnabled = v;
                }
            }
        });

        // --- Lighting ---
        reg('sunIntensity', {
            category: 'lighting', type: 'number', default: 1.0, min: 0, max: 3, step: 0.05,
            description: 'Sun intensity',
            gate: { targetOf: sys => sys.sun && sys.sun.light, prop: 'intensity' }
        });
        reg('moonIntensity', {
            category: 'lighting', type: 'number', default: 0.5, min: 0, max: 3, step: 0.05,
            description: 'Moon intensity',
            gate: { targetOf: sys => sys.moon && sys.moon.light, prop: 'intensity' }
        });
        reg('ambientIntensity', {
            category: 'lighting', type: 'number', default: 0.3, min: 0, max: 2, step: 0.02,
            description: 'Ambient intensity',
            gate: { targetOf: sys => sys.ambientLight, prop: 'intensity' }
        });
        reg('sunColor', {
            category: 'lighting', type: 'color', default: '#ffffff',
            description: 'Sun color',
            apply: (v, sys) => { if (sys.sun && sys.sun.light) sys.sun.light.color.set(v); },
            colorGate: sys => sys.sun && sys.sun.light && sys.sun.light.color
        });
        reg('moonColor', {
            category: 'lighting', type: 'color', default: '#87ceeb',
            description: 'Moon color',
            apply: (v, sys) => { if (sys.moon && sys.moon.light) sys.moon.light.color.set(v); },
            colorGate: sys => sys.moon && sys.moon.light && sys.moon.light.color
        });
        reg('ambientColor', {
            category: 'lighting', type: 'color', default: '#8b5cf6',
            description: 'Ambient color',
            apply: (v, sys) => { if (sys.ambientLight) sys.ambientLight.color.set(v); },
            colorGate: sys => sys.ambientLight && sys.ambientLight.color
        });

        // --- Time ---
        reg('dayTime', {
            category: 'time', type: 'number', default: 12, min: 0, max: 24, step: 0.01,
            persist: false,
            description: 'Time of day',
            apply: (v, sys) => {
                const dayLenMs = sys.serverDayLength || 60000;
                sys.serverGameTime = (v / 24) * dayLenMs;
                sys.lastTimeSyncTimestamp = Date.now();
                // Emit to server for synchronization
                if (window.game && window.game.networkManager) {
                    window.game.networkManager.emit('updateGameTime', { timeOfDay: v });
                }
            }
        });
        reg('daySpeed', {
            category: 'time', type: 'number', default: 60, min: 3, max: 600, step: 1,
            description: 'Day length in seconds',
            apply: (v, sys) => {
                const newDayLength = v * 1000;
                const oldDayLength = sys.serverDayLength || 60000;

                // Compute current interpolated game time to preserve sun position
                let currentGameTime = sys.serverGameTime;
                if (sys.lastTimeSyncTimestamp > 0) {
                    currentGameTime += Date.now() - sys.lastTimeSyncTimestamp;
                }

                // Preserve total game days so sun doesn't jump when speed changes
                const totalDays = currentGameTime / oldDayLength;
                sys.serverGameTime = totalDays * newDayLength;
                sys.serverDayLength = newDayLength;
                sys.lastTimeSyncTimestamp = Date.now();

                // Recalculate yearLength to match new day length
                sys.yearLength = 120 * newDayLength;

                // Emit to server for synchronization
                if (window.game && window.game.networkManager) {
                    window.game.networkManager.emit('updateGameTime', { dayLength: newDayLength });
                }
            }
        });
        reg('yearTime', {
            category: 'time', type: 'number', default: 0, min: 0, max: 120, step: 0.1,
            description: 'Day of year (0-120)',
            apply: (v, sys) => {
                sys.serverGameTime = Math.floor(v) * (sys.serverDayLength || 60000) + (sys.serverGameTime % (sys.serverDayLength || 60000));
                // Emit to server for synchronization
                if (window.game && window.game.networkManager) {
                    window.game.networkManager.emit('updateGameTime', { dayOfYear: Math.floor(v) });
                }
            }
        });
        reg('month', {
            category: 'time', type: 'select', default: '1',
            description: 'Month (1-4)',
            options: [
                { value: '1', label: 'Spring' },
                { value: '2', label: 'Summer' },
                { value: '3', label: 'Autumn' },
                { value: '4', label: 'Winter' }
            ],
            apply: (v, sys) => {
                const month = parseInt(v);
                const dayOfYear = (month - 1) * 30;
                sys.serverGameTime = dayOfYear * (sys.serverDayLength || 60000) + (sys.serverGameTime % (sys.serverDayLength || 60000));
                // Emit to server for synchronization
                if (window.game && window.game.networkManager) {
                    window.game.networkManager.emit('updateGameTime', { dayOfYear });
                }
            }
        });
        reg('year', {
            category: 'time', type: 'select', default: '1',
            description: 'Game year',
            options: Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `Year ${i + 1}` })),
            apply: (v, sys) => {
                const year = parseInt(v);
                const currentYear = Math.floor(sys.serverGameTime / (120 * (sys.serverDayLength || 60000)));
                const yearOffset = (year - 1) * 120 * (sys.serverDayLength || 60000);
                const currentYearStart = currentYear * 120 * (sys.serverDayLength || 60000);
                sys.serverGameTime = yearOffset + (sys.serverGameTime % (120 * (sys.serverDayLength || 60000)));
                // Emit to server for synchronization
                if (window.game && window.game.networkManager) {
                    window.game.networkManager.emit('updateGameTime', { year });
                }
            }
        });

        // --- Environment ---
        reg('windSpeed', {
            category: 'environment', type: 'number', default: 1.0, min: 0, max: 50, step: 0.1,
            description: 'Wind speed',
            apply: (v, sys) => {
                if (sys._waterTextureData) sys._waterTextureData.windSpeed = v;
                if (sys.grassSystem) sys.grassSystem.windSpeed = v;
                const game = window.game;
                if (game && game.decorativeVisuals) game.decorativeVisuals.windSpeed = v;
            }
        });
        reg('windDirection', {
            category: 'environment', type: 'number', default: 0, min: 0, max: 360, step: 1,
            description: 'Wind direction (degrees)',
            apply: (v, sys) => {
                const game = window.game;
                if (game && game.decorativeVisuals) {
                    game.decorativeVisuals.windTargetAngle = v * (Math.PI / 180);
                }
            }
        });
        reg('windExposureScale', {
            category: 'environment', type: 'number', default: 6.0, min: 0, max: 20, step: 0.5,
            description: 'Terrain exposure wind multiplier (higher = more wind on exposed trees)',
            shortLabel: 'Exposure',
            apply: (v) => {
                const lts = window.game && window.game.localTreeSystem;
                if (lts) lts.windExposureScale = v;
                const htm = window.game && window.game.hybridTreeManager;
                if (htm) {
                    if (htm.terrainTreeSystem) htm.terrainTreeSystem.recomputeWindMultipliers();
                    if (htm.poplarTreeSystem) htm.poplarTreeSystem.recomputeWindMultipliers();
                    if (htm.cherryTreeSystem) htm.cherryTreeSystem.recomputeWindMultipliers();
                    if (htm.growingTreeSystem) htm.growingTreeSystem.recomputeWindMultipliers();
                }
            }
        });
        reg('windShadowStrength', {
            category: 'environment', type: 'number', default: 1.5, min: 0, max: 5, step: 0.1,
            description: 'Wind shadow strength (leeward vs windward tree multiplier)',
            shortLabel: 'Wind Shadow',
            apply: (v) => {
                const lts = window.game && window.game.localTreeSystem;
                if (lts) lts.windShadowStrength = v;
                const htm = window.game && window.game.hybridTreeManager;
                if (htm) {
                    if (htm.terrainTreeSystem) htm.terrainTreeSystem.recomputeWindMultipliers();
                    if (htm.poplarTreeSystem) htm.poplarTreeSystem.recomputeWindMultipliers();
                    if (htm.cherryTreeSystem) htm.cherryTreeSystem.recomputeWindMultipliers();
                    if (htm.growingTreeSystem) htm.growingTreeSystem.recomputeWindMultipliers();
                }
            }
        });
        reg('windHeightPower', {
            category: 'environment', type: 'number', default: 2.0, min: 0.5, max: 5.0, step: 0.1,
            description: 'Wind bend height power (how much tree top bends vs base)',
            shortLabel: 'Height Power',
            apply: (v) => {
                const lts = window.game && window.game.localTreeSystem;
                if (lts) lts.windHeightPower = v;
                // Update instanced tree system shaders
                const htm = window.game && window.game.hybridTreeManager;
                if (!htm) return;
                [htm.terrainTreeSystem, htm.growingTreeSystem, htm.poplarTreeSystem, htm.cherryTreeSystem, htm.billboardTreeSystem].forEach(sys => {
                    if (!sys || !sys.parts) return;
                    sys.parts.forEach(part => {
                        const mat = part.mesh && part.mesh.material;
                        if (mat && mat.uniforms && mat.uniforms.uWindHeightPower) {
                            mat.uniforms.uWindHeightPower.value = v;
                        }
                    });
                });
            }
        });
        reg('blusteryWind', {
            category: 'environment', type: 'number', default: 0, min: 0, max: 10, step: 1,
            description: 'Random blustery wind (0 = calm steady, 10 = changeable direction fluctuating gale force)',
            shortLabel: 'Blustery Wind',
            apply: (v) => {
                const game = window.game;
                if (game && game.decorativeVisuals) game.decorativeVisuals.blusteryWind = v;
            }
        });

        // Wind direction state for gradual turning
        this._wind = {
            currentRad: 0,
            targetRad: 0,
            turnSpeed: 0.5 // radians per second
        };

        // Gradual wind direction update - call this from game loop or systems
        this.updateWindDirection = (deltaTime) => {
            const targetDeg = this.params.get('windDirection')?.value ?? 0;
            this._wind.targetRad = targetDeg * Math.PI / 180;

            // Shortest angle difference
            let diff = this._wind.targetRad - this._wind.currentRad;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            // Gradual turn
            const maxTurn = this._wind.turnSpeed * deltaTime;
            if (Math.abs(diff) <= maxTurn) {
                this._wind.currentRad = this._wind.targetRad;
            } else {
                this._wind.currentRad += Math.sign(diff) * maxTurn;
            }

            // Normalize
            while (this._wind.currentRad > Math.PI) this._wind.currentRad -= Math.PI * 2;
            while (this._wind.currentRad < -Math.PI) this._wind.currentRad += Math.PI * 2;

            // Apply to systems
            const game = window.game;
            if (game && game.decorativeVisuals) {
                game.decorativeVisuals.windAngle = this._wind.currentRad;
                if (game.decorativeVisuals.windDirection && game.decorativeVisuals.windDirection.set) {
                    game.decorativeVisuals.windDirection.set(Math.cos(this._wind.currentRad), Math.sin(this._wind.currentRad));
                }
            }
        };

        // Getter for systems that need immediate read
        this.getWindDirection = () => this._wind.currentRad;
        this.getWindDirectionDegrees = () => (this._wind.currentRad * 180 / Math.PI + 360) % 360;
        reg('fogNear', {
            category: 'environment', type: 'number', default: 10, min: 1, max: 100, step: 1,
            description: 'Fog start distance',
            gate: { targetOf: sys => sys.scene && sys.scene.fog, prop: 'near' }
        });
        reg('fogFar', {
            category: 'environment', type: 'number', default: 100, min: 20, max: 400, step: 1,
            description: 'Fog end distance',
            gate: { targetOf: sys => sys.scene && sys.scene.fog, prop: 'far' }
        });
        reg('daisiesEnabled', {
            category: 'environment', type: 'boolean', default: false,
            description: 'Show daisies',
            shortLabel: 'Daisies',
            apply: (v) => {
                const game = window.game;
                if (game && game.decorativeVisuals) {
                    if (!v) {
                        for (const [, daisy] of game.decorativeVisuals.daisies) {
                            game.decorativeVisuals.scene.remove(daisy.group);
                        }
                        game.decorativeVisuals.daisies.clear();
                    } else {
                        game.decorativeVisuals.spawnInitialDaisies();
                    }
                }
            }
        });

        // --- Water Shader System ---
        const waterUniformApply = (uniformName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                tbs.shaderMaterial.uniforms[uniformName].value = v;
            }
        };
        reg('waterType', {
            category: 'water', type: 'select', default: 'shaderOnly',
            description: 'Water rendering mode',
            shortLabel: 'Water Type',
            rebuildCategory: true,
            options: [
                { value: 'shaderOnly', label: 'Shader Only' },
                { value: 'flatBed', label: 'Flat Lake Bed' },
                { value: 'lakeBed', label: 'Lake Bed Sim' }
            ],
            apply: (v, sys) => {
                if (typeof sys.setFlatWaterEnabled === 'function') {
                    sys.setFlatWaterEnabled(v === 'flatBed' || v === 'lakeBed');
                }
            }
        });
        reg('flatBedDepth', {
            category: 'water', type: 'number', default: 0.5, min: 0.0, max: 3.0, step: 0.1,
            description: 'How far below water level the flat bed sits',
            shortLabel: 'Bed Depth',
            showIf: { param: 'waterType', value: ['flatBed', 'lakeBed'] },
            apply: waterUniformApply('uFlatBedDepth')
        });
        reg('lakeBedBlend', {
            category: 'water', type: 'number', default: 0.5, min: 0.0, max: 1.0, step: 0.05,
            description: 'How much the darkened lake bed shows through (0 = original terrain, 1 = full lake bed)',
            shortLabel: 'Lake Bed',
            showIf: { param: 'waterType', value: 'lakeBed' },
            apply: waterUniformApply('uLakeBedBlend')
        });
        reg('lakeSurfaceOpacity', {
            category: 'water', type: 'number', default: 0.8, min: 0.0, max: 1.0, step: 0.05,
            description: 'How opaque the water surface is over the lake bed (0 = fully transparent, 1 = opaque water)',
            shortLabel: 'Surface Opacity',
            showIf: { param: 'waterType', value: 'lakeBed' },
            apply: waterUniformApply('uLakeSurfaceOpacity')
        });
        reg('waterShaderEnabled', {
            category: 'water', type: 'boolean', default: true,
            description: 'Enable water rendering in terrain shader',
            shortLabel: 'Water Shader',
            apply: waterUniformApply('uWaterEnabled')
        });
        reg('debugWaterState', {
            category: 'water', type: 'boolean', default: false,
            description: 'Debug: show water state (land/shallow/deep)',
            apply: waterUniformApply('uDebugWaterState')
        });
        reg('debugRadialUp', {
            category: 'water', type: 'boolean', default: false,
            description: 'Debug: show radial up vectors',
            apply: waterUniformApply('uDebugRadialUp')
        });
        reg('debugWaveNormals', {
            category: 'water', type: 'boolean', default: false,
            description: 'Debug: show wave normal map',
            apply: waterUniformApply('uDebugWaveNormals')
        });
        reg('debugFresnel', {
            category: 'water', type: 'boolean', default: false,
            description: 'Debug: show fresnel mask',
            apply: waterUniformApply('uDebugFresnel')
        });
        reg('debugFoam', {
            category: 'water', type: 'boolean', default: false,
            description: 'Debug: show foam mask',
            apply: waterUniformApply('uDebugFoam')
        });
        reg('shallowThreshold', {
            category: 'water', type: 'number', default: 1.5, min: 0.1, max: 5.0, step: 0.1,
            description: 'Shallow water depth threshold',
            apply: waterUniformApply('uShallowThreshold')
        });
        reg('foamIntensity', {
            category: 'water', type: 'number', default: 0.6, min: 0.0, max: 2.0, step: 0.05,
            description: 'Shoreline foam intensity',
            apply: waterUniformApply('uFoamIntensity')
        });
        reg('waveScale', {
            category: 'water', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.05,
            description: 'Master wave size multiplier',
            shortLabel: 'Wave Scale',
            apply: waterUniformApply('uWaveScale')
        });
        reg('waveAmplitudeSwell', {
            category: 'water', type: 'number', default: 3.0, min: 0.0, max: 8.0, step: 0.1,
            description: 'Large swell wave amplitude',
            apply: waterUniformApply('uWaveAmplitudeSwell')
        });
        reg('waveAmplitudeWind', {
            category: 'water', type: 'number', default: 1.5, min: 0.0, max: 5.0, step: 0.05,
            description: 'Wind wave amplitude',
            apply: waterUniformApply('uWaveAmplitudeWind')
        });
        reg('waveAmplitudeRipple', {
            category: 'water', type: 'number', default: 0.6, min: 0.0, max: 2.0, step: 0.05,
            description: 'Small ripple amplitude',
            apply: waterUniformApply('uWaveAmplitudeRipple')
        });
        reg('waterDepthMax', {
            category: 'water', type: 'number', default: 15.0, min: 1.0, max: 50.0, step: 0.5,
            description: 'Maximum water depth for colour absorption',
            apply: waterUniformApply('uWaterDepthMax')
        });
        reg('waveSwellSpeed', {
            category: 'water', type: 'number', default: 1.5, min: 0.0, max: 5.0, step: 0.1,
            description: 'Large swell wave animation speed',
            shortLabel: 'Swell Speed',
            apply: waterUniformApply('uWaveSwellSpeed')
        });
        reg('waterDetailScale', {
            category: 'water', type: 'number', default: 1.0, min: 0.05, max: 20.0, step: 0.05,
            description: 'Master water scale (lower = smaller condensed waves like a pond, higher = larger ocean waves)',
            shortLabel: 'Detail Scale',
            apply: waterUniformApply('uWaterDetailScale')
        });
        reg('waveWindSpeed', {
            category: 'water', type: 'number', default: 3.5, min: 0.0, max: 10.0, step: 0.1,
            description: 'Medium wind wave animation speed',
            shortLabel: 'Wind Speed',
            apply: waterUniformApply('uWaveWindSpeed')
        });
        reg('waveRippleSpeed', {
            category: 'water', type: 'number', default: 8.0, min: 0.0, max: 20.0, step: 0.5,
            description: 'Small ripple animation speed',
            shortLabel: 'Ripple Speed',
            apply: waterUniformApply('uWaveRippleSpeed')
        });
        reg('waveSwellFreq', {
            category: 'water', type: 'number', default: 1.0, min: 0.1, max: 5.0, step: 0.1,
            description: 'Swell wavelength scale (lower = wider waves, higher = tighter waves)',
            shortLabel: 'Swell Freq',
            apply: waterUniformApply('uWaveSwellFreq')
        });
        reg('waveWindFreq', {
            category: 'water', type: 'number', default: 1.0, min: 0.1, max: 5.0, step: 0.1,
            description: 'Wind wave wavelength scale (lower = wider waves, higher = tighter waves)',
            shortLabel: 'Wind Freq',
            apply: waterUniformApply('uWaveWindFreq')
        });
        reg('waveRippleFreq', {
            category: 'water', type: 'number', default: 1.0, min: 0.1, max: 5.0, step: 0.1,
            description: 'Ripple wavelength scale (lower = wider waves, higher = tighter waves)',
            shortLabel: 'Ripple Freq',
            apply: waterUniformApply('uWaveRippleFreq')
        });
        reg('foamSpeed', {
            category: 'water', type: 'number', default: 1.5, min: 0.0, max: 5.0, step: 0.1,
            description: 'Shoreline foam churn speed',
            shortLabel: 'Foam Speed',
            apply: waterUniformApply('uFoamSpeed')
        });
        reg('foamScale', {
            category: 'water', type: 'number', default: 4.0, min: 0.5, max: 10.0, step: 0.5,
            description: 'Foam patch size (smaller = bigger patches)',
            shortLabel: 'Foam Scale',
            apply: waterUniformApply('uFoamScale')
        });
        reg('foamDepth', {
            category: 'water', type: 'number', default: 0.8, min: 0.1, max: 3.0, step: 0.1,
            description: 'How far from shore foam reaches',
            shortLabel: 'Foam Depth',
            apply: waterUniformApply('uFoamDepth')
        });
        reg('foamWindSensitivity', {
            category: 'water', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.1,
            description: 'How strongly shoreline foam drifts with the wind',
            shortLabel: 'Foam Wind',
            apply: waterUniformApply('uFoamWindSensitivity')
        });
        reg('fresnelPower', {
            category: 'water', type: 'number', default: 5.0, min: 1.0, max: 10.0, step: 0.5,
            description: 'Water reflectivity sharpness (lower = more mirror-like)',
            shortLabel: 'Fresnel',
            apply: waterUniformApply('uFresnelPower')
        });
        reg('deepWaterColor', {
            category: 'water', type: 'color', default: '#1a4080',
            description: 'Deep water colour',
            shortLabel: 'Deep Color',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms.uDeepWaterColor) {
                    tbs.shaderMaterial.uniforms.uDeepWaterColor.value.set(v);
                }
            }
        });
        reg('shallowWaterColor', {
            category: 'water', type: 'color', default: '#6699e6',
            description: 'Shallow water colour',
            shortLabel: 'Shallow Color',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms.uShallowWaterColor) {
                    tbs.shaderMaterial.uniforms.uShallowWaterColor.value.set(v);
                }
            }
        });
        reg('waterOpacity', {
            category: 'water', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.05,
            description: 'Water transparency (0 = invisible, 1 = fully opaque)',
            shortLabel: 'Water Opacity',
            apply: waterUniformApply('uWaterOpacity')
        });
        reg('skyReflection', {
            category: 'water', type: 'number', default: 0.4, min: 0.0, max: 1.0, step: 0.05,
            description: 'Fresnel sky reflection strength on water',
            shortLabel: 'Sky Reflection',
            apply: waterUniformApply('uSkyReflection')
        });
        reg('specularIntensity', {
            category: 'water', type: 'number', default: 0.8, min: 0.0, max: 2.0, step: 0.05,
            description: 'Water specular highlight intensity',
            shortLabel: 'Specular',
            apply: waterUniformApply('uSpecularIntensity')
        });
        reg('sparkleIntensity', {
            category: 'water', type: 'number', default: 0.6, min: 0.0, max: 2.0, step: 0.05,
            description: 'Micro-glitter sparkle brightness on water',
            shortLabel: 'Sparkle',
            apply: waterUniformApply('uSparkleIntensity')
        });
        reg('sparkleScale', {
            category: 'water', type: 'number', default: 8.0, min: 1.0, max: 64.0, step: 1.0,
            description: 'Sparkle point density (higher = more dense glitter)',
            shortLabel: 'Sparkle Scale',
            apply: waterUniformApply('uSparkleScale')
        });
        reg('sparkleSpeed', {
            category: 'water', type: 'number', default: 3.0, min: 0.0, max: 10.0, step: 0.5,
            description: 'Shimmer animation speed of sparkles',
            shortLabel: 'Sparkle Speed',
            apply: waterUniformApply('uSparkleSpeed')
        });

        // --- Grass ---
        const grassUniformApply = (uniformName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                tbs.shaderMaterial.uniforms[uniformName].value = v;
            }
        };
        reg('grassUvScale', {
            category: 'landCover', type: 'number', default: 0.15, min: 0.05, max: 2.0, step: 0.01,
            description: 'Grass texture UV scale (smaller = finer)',
            shortLabel: 'Tex Scale',
            apply: grassUniformApply('uGrassUvScale')
        });
        reg('grassWindMultiplier', {
            category: 'landCover', type: 'number', default: 1.0, min: 0, max: 3.0, step: 0.1,
            description: 'Grass wind displacement strength multiplier (scales global wind)',
            shortLabel: 'Wind Mult',
            apply: grassUniformApply('uGrassWindMultiplier')
        });
        reg('grassBlendAmount', {
            category: 'landCover', type: 'number', default: 0.55, min: 0, max: 1.0, step: 0.05,
            description: 'Grass overlay blend amount',
            shortLabel: 'Blend',
            apply: grassUniformApply('uGrassBlendAmount')
        });
        reg('grassSharpness', {
            category: 'landCover', type: 'number', default: 0.6, min: 0, max: 1.0, step: 0.05,
            description: 'Grass blade edge sharpness (0 = soft/cloudy, 1 = hard blades)',
            shortLabel: 'Sharp',
            apply: grassUniformApply('uGrassSharpness')
        });
        reg('grassColorTint', {
            category: 'landCover', type: 'color', default: '#3a8c2e',
            description: 'Grass colour tint',
            shortLabel: 'Colour',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms.uGrassColorTint) {
                    tbs.shaderMaterial.uniforms.uGrassColorTint.value.set(v);
                }
            }
        });
        reg('grassColorLight', {
            category: 'landCover', type: 'color', default: '#59a638',
            description: 'Grass highlight colour (light base)',
            shortLabel: 'Light',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms.uGrassColorLight) {
                    tbs.shaderMaterial.uniforms.uGrassColorLight.value.set(v);
                }
            }
        });
        reg('grassWindSpeed', {
            category: 'landCover', type: 'number', default: 1.2, min: 0.0, max: 5.0, step: 0.1,
            description: 'Grass wind animation speed (higher = faster waves)',
            shortLabel: 'Wind Speed',
            apply: grassUniformApply('uGrassWindSpeed')
        });
        reg('grassPhaseScale', {
            category: 'landCover', type: 'number', default: 1.0, min: 0.1, max: 5.0, step: 0.1,
            description: 'Wind spatial wavelength scale (lower = broader waves)',
            shortLabel: 'Phase Scale',
            apply: grassUniformApply('uGrassPhaseScale')
        });
        reg('grassBladeStretchX', {
            category: 'landCover', type: 'number', default: 4.0, min: 0.5, max: 16.0, step: 0.5,
            description: 'Horizontal grass blade stretch',
            shortLabel: 'Stretch X',
            apply: grassUniformApply('uGrassBladeStretchX')
        });
        reg('grassBladeStretchY', {
            category: 'landCover', type: 'number', default: 16.0, min: 1.0, max: 64.0, step: 1.0,
            description: 'Vertical grass blade stretch (taller blades)',
            shortLabel: 'Stretch Y',
            apply: grassUniformApply('uGrassBladeStretchY')
        });
        reg('grassMicroAmount', {
            category: 'landCover', type: 'number', default: 0.2, min: 0.0, max: 1.0, step: 0.05,
            description: 'Secondary micro detail layer intensity',
            shortLabel: 'Micro Detail',
            apply: grassUniformApply('uGrassMicroAmount')
        });

        // --- Grass Types Per Biome ---
        const grassTypeOptions = [
            { value: 0, label: 'None' },
            { value: 1, label: 'Meadow' },
            { value: 2, label: 'Prairie' },
            { value: 3, label: 'Alpine' },
            { value: 4, label: 'Marsh' },
            { value: 5, label: 'Dry Steppe' }
        ];
        const defaultGrassTypes = [0, 0, 0, 4, 1, 3, 5, 0];
        const grassBiomeNames = ['Deep Water','Shallow Water','Beach','Lowland','Grassland','Forest','Mountain','Snow'];
        const grassTypeApply = (idx) => (v, sys) => {
            const num = typeof v === 'number' ? v : parseFloat(v);
            const tbs = sys.textureBlendingSystem;
            if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms.uGrassType) {
                const arr = tbs.shaderMaterial.uniforms.uGrassType.value;
                if (arr && arr.length > idx) arr[idx] = num;
                tbs.shaderMaterial.uniforms.uGrassType.needsUpdate = true;
            }
        };
        for (let i = 0; i < 8; i++) {
            reg(`grassType${i}`, {
                category: 'landCover', type: 'select', default: defaultGrassTypes[i],
                description: `${grassBiomeNames[i]} grass profile`,
                shortLabel: `${grassBiomeNames[i]} Grass`,
                options: grassTypeOptions,
                apply: grassTypeApply(i)
            });
        }

        // --- Forest Floor ---
        const forestUniformApply = (uniformName, propName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (!tbs) return;
            if (propName) {
                tbs[propName] = v;
            }
            if (tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                tbs.shaderMaterial.uniforms[uniformName].value = v;
            }
        };

        reg('forestEnabled', {
            category: 'forest', type: 'boolean', default: true,
            description: 'Enable biome-dependent forest floor textures under trees',
            shortLabel: 'Enabled',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (!tbs || !tbs.shaderMaterial?.uniforms?.uForestEnabled) return;
                tbs.forestEnabled = !!v;
                tbs.shaderMaterial.uniforms.uForestEnabled.value = v ? 1.0 : 0.0;
            }
        });

        reg('forestBlendMax', {
            category: 'forest', type: 'number', default: 0.65, min: 0.0, max: 1.0, step: 0.05,
            description: 'Maximum strength of forest floor takeover where trees are dense',
            shortLabel: 'Blend',
            apply: forestUniformApply('uForestBlendMax', 'forestBlendMax')
        });

        reg('forestMaskStrength', {
            category: 'forest', type: 'number', default: 1.5, min: 0.2, max: 4.0, step: 0.1,
            description: 'How strongly the tree-density mask is emphasized (higher = tighter patches)',
            shortLabel: 'Mask Pow',
            apply: forestUniformApply('uForestMaskStrength', 'forestMaskStrength')
        });

        reg('forestBiomeBias', {
            category: 'forest', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.1,
            description: 'Bias toward forest biomes (higher = only strong forest zones get the texture)',
            shortLabel: 'Biome Bias',
            apply: forestUniformApply('uForestBiomeBias', 'forestBiomeBias')
        });

        reg('forestTexScale', {
            category: 'forest', type: 'number', default: 0.18, min: 0.05, max: 1.0, step: 0.01,
            description: 'Forest floor texture tiling scale (smaller = finer detail)',
            shortLabel: 'Tex Scale',
            apply: forestUniformApply('uForestTexScale', 'forestTexScale')
        });

        reg('forestNoiseScale', {
            category: 'forest', type: 'number', default: 0.08, min: 0.01, max: 0.5, step: 0.01,
            description: 'Breakup noise scale for mask edges (higher = noisier blend)',
            shortLabel: 'Noise',
            apply: forestUniformApply('uForestNoiseScale', 'forestNoiseScale')
        });

        reg('forestBaseInfluence', {
            category: 'forest', type: 'number', default: 0.2, min: 0.0, max: 1.0, step: 0.05,
            description: 'Baseline forest-floor influence even with sparse trees (helps subtle duff)',
            shortLabel: 'Base',
            apply: forestUniformApply('uForestBaseInfluence', 'forestBaseInfluence')
        });

        // --- Beach ---
        const beachUniformApply = (uniformName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                tbs.shaderMaterial.uniforms[uniformName].value = v;
            }
        };
        const beachColorApply = (uniformName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                tbs.shaderMaterial.uniforms[uniformName].value.set(v);
            }
        };
        reg('beachEnabled', {
            category: 'shoreline', type: 'boolean', default: true,
            description: 'Enable beach surface detail rendering',
            shortLabel: 'Enabled',
            apply: beachUniformApply('uBeachEnabled')
        });
        reg('beachStoneAmount', {
            category: 'shoreline', type: 'number', default: 0.6, min: 0.0, max: 1.0, step: 0.05,
            description: 'Amount of stone patches vs pure sand',
            shortLabel: 'Stone Amt',
            apply: beachUniformApply('uBeachStoneAmount')
        });
        reg('beachStoneScale', {
            category: 'shoreline', type: 'number', default: 0.4, min: 0.05, max: 10.0, step: 0.05,
            description: 'Noise scale for stone/sand variation (smaller = broader patches)',
            shortLabel: 'Stone Scale',
            apply: beachUniformApply('uBeachStoneScale')
        });
        reg('beachWetWidth', {
            category: 'shoreline', type: 'number', default: 1.2, min: 0.0, max: 5.0, step: 0.1,
            description: 'Width of the high-tide wet sand band above water',
            shortLabel: 'Wet Width',
            apply: beachUniformApply('uBeachWetWidth')
        });
        reg('beachWetIntensity', {
            category: 'shoreline', type: 'number', default: 0.7, min: 0.0, max: 1.0, step: 0.05,
            description: 'Darkness of the wet sand high-tide line',
            shortLabel: 'Wet Intensity',
            apply: beachUniformApply('uBeachWetIntensity')
        });
        reg('wetFadeDelay', {
            category: 'shoreline', type: 'number', default: 0.3, min: 0.0, max: 3.0, step: 0.1,
            description: 'Distance above water where sand stays fully wet before fading',
            shortLabel: 'Wet Plateau',
            apply: beachUniformApply('uWetFadeDelay')
        });
        reg('wetFadeSpeed', {
            category: 'shoreline', type: 'number', default: 0.5, min: 0.0, max: 5.0, step: 0.1,
            description: 'How quickly wet sand dries out above the plateau zone',
            shortLabel: 'Dry Speed',
            apply: beachUniformApply('uWetFadeSpeed')
        });
        reg('beachShrubAmount', {
            category: 'shoreline', type: 'number', default: 0.5, min: 0.0, max: 1.0, step: 0.05,
            description: 'Amount of hardy shrubbery at the top of the beach',
            shortLabel: 'Shrub Amt',
            apply: beachUniformApply('uBeachShrubAmount')
        });
        reg('beachBiomeBias', {
            category: 'shoreline', type: 'number', default: 1.0, min: 0.1, max: 4.0, step: 0.1,
            description: 'Bias toward true biome beach weight (higher = only strong beach zones render)',
            shortLabel: 'Biome Bias',
            apply: beachUniformApply('uBeachBiomeBias')
        });
        reg('beachHeightBlend', {
            category: 'shoreline', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.05,
            description: 'Blend additional height-based mask with biome weight (0 = biome only)',
            shortLabel: 'Height Mix',
            apply: beachUniformApply('uBeachHeightBlend')
        });
        reg('beachSandColor', {
            category: 'shoreline', type: 'color', default: '#d2c284',
            description: 'Base dry sand colour',
            shortLabel: 'Sand Colour',
            apply: beachColorApply('uBeachSandColor')
        });
        reg('beachStoneColor', {
            category: 'shoreline', type: 'color', default: '#736b61',
            description: 'Stone patch colour',
            shortLabel: 'Stone Colour',
            apply: beachColorApply('uBeachStoneColor')
        });
        reg('beachWetColor', {
            category: 'shoreline', type: 'color', default: '#998d61',
            description: 'Wet sand high-tide line colour',
            shortLabel: 'Wet Colour',
            apply: beachColorApply('uBeachWetColor')
        });
        reg('beachShrubColor', {
            category: 'shoreline', type: 'color', default: '#386b26',
            description: 'Hardy shrub colour',
            shortLabel: 'Shrub Colour',
            apply: beachColorApply('uBeachShrubColor')
        });
        reg('debugBeachState', {
            category: 'shoreline', type: 'boolean', default: false,
            description: 'Debug: show beach mask only',
            shortLabel: 'Debug Mask',
            apply: beachUniformApply('uDebugBeachState')
        });

        // --- Cliff / Slope Material ---
        const cliffApply = (setterName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs && typeof tbs[setterName] === 'function') {
                tbs[setterName](v);
            }
        };
        reg('cliffEnabled', {
            category: 'cliff', type: 'boolean', default: true,
            description: 'Enable cliff material on steep slopes',
            shortLabel: 'Enabled',
            apply: cliffApply('setCliffEnabled')
        });
        reg('cliffThreshold', {
            category: 'cliff', type: 'number', default: 0.45, min: 0.0, max: 1.0, step: 0.01,
            description: 'Slope angle where cliff material starts (0=flat, 1=vertical)',
            shortLabel: 'Threshold',
            apply: cliffApply('setCliffThreshold')
        });
        reg('cliffBlendWidth', {
            category: 'cliff', type: 'number', default: 0.25, min: 0.0, max: 1.0, step: 0.01,
            description: 'Transition band width around threshold',
            shortLabel: 'Blend Width',
            apply: cliffApply('setCliffBlendWidth')
        });
        reg('cliffRubbleAmount', {
            category: 'cliff', type: 'number', default: 0.65, min: 0.0, max: 1.0, step: 0.05,
            description: 'Loose scree / rubble visibility on cliff faces',
            shortLabel: 'Rubble',
            apply: cliffApply('setCliffRubbleAmount')
        });
        reg('cliffStrataScale', {
            category: 'cliff', type: 'number', default: 0.12, min: 0.01, max: 2.0, step: 0.01,
            description: 'Horizontal rock strata banding frequency',
            shortLabel: 'Strata Scale',
            apply: cliffApply('setCliffStrataScale')
        });
        reg('cliffStrataAmount', {
            category: 'cliff', type: 'number', default: 0.55, min: 0.0, max: 1.0, step: 0.05,
            shortLabel: 'Strata Amount',
            apply: cliffApply('setCliffStrataAmount')
        });
        reg('cliffDarkenAmount', {
            category: 'cliff', type: 'number', default: 0.35, min: 0.0, max: 1.0, step: 0.05,
            description: 'Vertical face self-shadowing darkening',
            shortLabel: 'Darken',
            apply: cliffApply('setCliffDarkenAmount')
        });
        reg('cliffBaseColor', {
            category: 'cliff', type: 'color', default: '#615c51',
            description: 'Base dark rock colour',
            shortLabel: 'Base Colour',
            apply: cliffApply('setCliffBaseColor')
        });
        reg('cliffLightColor', {
            category: 'cliff', type: 'color', default: '#948575',
            description: 'Lighter exposed rock colour',
            shortLabel: 'Light Colour',
            apply: cliffApply('setCliffLightColor')
        });
        reg('cliffMossColor', {
            category: 'cliff', type: 'color', default: '#476138',
            description: 'Moss / lichen tint colour',
            shortLabel: 'Moss Colour',
            apply: cliffApply('setCliffMossColor')
        });
        reg('cliffMossAmount', {
            category: 'cliff', type: 'number', default: 0.40, min: 0.0, max: 1.0, step: 0.05,
            description: 'Moss coverage on less-vertical cliff faces',
            shortLabel: 'Moss Amount',
            apply: cliffApply('setCliffMossAmount')
        });
        reg('cliffDebug', {
            category: 'cliff', type: 'boolean', default: false,
            description: 'Debug: show cliff mask only',
            shortLabel: 'Debug Mask',
            apply: cliffApply('setCliffDebug')
        });

        // --- Biome Edge Blending ---
        const biomeUniformApply = (uniformName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                tbs.shaderMaterial.uniforms[uniformName].value = v;
            }
        };
        const biomeOptions = [
            { value: 0, label: 'Deep Water' },
            { value: 1, label: 'Shallow Water' },
            { value: 2, label: 'Beach' },
            { value: 3, label: 'Lowland' },
            { value: 4, label: 'Grassland' },
            { value: 5, label: 'Forest' },
            { value: 6, label: 'Mountain' },
            { value: 7, label: 'Snow' }
        ];
        reg('biomeEdgeA', {
            category: 'blending', type: 'select', default: 3,
            description: 'First biome in the edge pair',
            shortLabel: 'Biome A',
            options: biomeOptions,
            apply: biomeUniformApply('uBiomeEdgeA')
        });
        reg('biomeEdgeB', {
            category: 'blending', type: 'select', default: 4,
            description: 'Second biome in the edge pair',
            shortLabel: 'Biome B',
            options: biomeOptions,
            apply: biomeUniformApply('uBiomeEdgeB')
        });
        reg('biomeEdgeMode', {
            category: 'blending', type: 'select', default: 0,
            description: 'Edge blending mode',
            shortLabel: 'Mode',
            options: [
                { value: 0, label: 'Blended' },
                { value: 1, label: 'Sharp' },
                { value: 2, label: 'Custom' }
            ],
            apply: biomeUniformApply('uBiomeEdgeMode')
        });
        reg('biomeEdgeScale', {
            category: 'blending', type: 'number', default: 0.3, min: 0.01, max: 2.0, step: 0.01,
            description: 'Wiggle noise scale (smaller = broader waves)',
            shortLabel: 'Wiggle Scale',
            apply: biomeUniformApply('uBiomeEdgeScale')
        });
        reg('biomeEdgeStrength', {
            category: 'blending', type: 'number', default: 1.0, min: 0, max: 3.0, step: 0.05,
            description: 'Wiggle noise displacement strength',
            shortLabel: 'Wiggle Str',
            apply: biomeUniformApply('uBiomeEdgeStrength')
        });
        reg('biomeSplatterScale', {
            category: 'blending', type: 'number', default: 0.5, min: 0.01, max: 3.0, step: 0.01,
            description: 'Splatter patch size (smaller = bigger patches)',
            shortLabel: 'Splatter Scale',
            apply: biomeUniformApply('uBiomeSplatterScale')
        });
        reg('biomeSplatterAmount', {
            category: 'blending', type: 'number', default: 0.5, min: 0, max: 1.0, step: 0.05,
            description: 'Splatter mask intensity',
            shortLabel: 'Splatter Amt',
            apply: biomeUniformApply('uBiomeSplatterAmount')
        });
        reg('biomeEdgeSplatterMix', {
            category: 'blending', type: 'number', default: 0.5, min: 0, max: 1.0, step: 0.05,
            description: 'Blend between wiggly edge (0) and splatter mask (1)',
            shortLabel: 'Edge/Splat',
            apply: biomeUniformApply('uBiomeEdgeSplatterMix')
        });

        // --- Biome Patch Noise ---
        reg('biomePatchScale', {
            category: 'blending', type: 'number', default: 0.025, min: 0.001, max: 0.1, step: 0.001,
            description: 'Patch noise spatial scale (smaller = bigger patches)',
            shortLabel: 'Patch Scale',
            apply: biomeUniformApply('uBiomePatchScale')
        });
        reg('biomePatchStrength', {
            category: 'blending', type: 'number', default: 0.0, min: 0, max: 6.0, step: 0.1,
            description: 'Patch noise threshold shift strength (0 = off)',
            shortLabel: 'Patch Str',
            apply: biomeUniformApply('uBiomePatchStrength')
        });
        reg('biomePatchSeed', {
            category: 'blending', type: 'number', default: 123.45, min: 0, max: 999.99, step: 1.0,
            description: 'Patch noise seed offset',
            shortLabel: 'Patch Seed',
            apply: biomeUniformApply('uBiomePatchSeed')
        });

        // --- Biome Palette ---
        const biomeColorApply = (idx) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs) tbs.setBiomeColor(idx, v);
        };
        const biomeThresholdApply = (idx) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs) tbs.setBiomeThreshold(idx, v);
        };
        const defaultBiomeColors = [
            '#6699e6', '#b3a580', '#c2bf6b', '#6bad51',
            '#3f9438', '#2d6b26', '#856148', '#e0e6eb'
        ];
        const defaultBiomeThresholds = [-1.5, -1.0, 2.5, 4.5, 11.5, 19.5, 26.5];
        const biomeNames = ['Deep Water','Shallow Water','Beach','Lowland','Grassland','Forest','Mountain','Snow'];
        for (let i = 0; i < 8; i++) {
            reg(`biomeColor${i}`, {
                category: 'blending', type: 'color', default: defaultBiomeColors[i],
                description: `${biomeNames[i]} color`,
                shortLabel: `${biomeNames[i]} Col`,
                apply: biomeColorApply(i)
            });
        }
        for (let i = 0; i < 7; i++) {
            reg(`biomeThreshold${i}`, {
                category: 'blending', type: 'number', default: defaultBiomeThresholds[i],
                min: -50, max: 100, step: 0.1,
                description: `${biomeNames[i]}-${biomeNames[i+1]} boundary`,
                shortLabel: `${biomeNames[i]} Th`,
                apply: biomeThresholdApply(i)
            });
        }

        // --- Biome Modifier Stack ---
        reg('biomeModifierStack', {
            category: 'blending', type: 'modifierStack',
            default: ModifierStack.defaultStack(),
            description: 'Layered noise modifiers for biome surface edges',
            shortLabel: 'Modifier Stack',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (!tbs || !tbs.shaderMaterial) return;
                const stack = (v instanceof ModifierStack) ? v : ModifierStack.defaultStack();
                const legacy = stack.toLegacyUniforms();
                Object.entries(legacy).forEach(([uniform, val]) => {
                    if (tbs.shaderMaterial.uniforms[uniform]) {
                        tbs.shaderMaterial.uniforms[uniform].value = val;
                    }
                });
            }
        });

        // --- Checkerboard ---
        const checkerboardUniformApply = (uniformName) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs && tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                tbs.shaderMaterial.uniforms[uniformName].value = v;
            }
        };
        reg('checkerFadeStrength', {
            category: 'checkerboard', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.01,
            description: 'Checkerboard transparency fade strength (0 = full checkerboard, 1 = full biome)',
            shortLabel: 'Fade',
            apply: checkerboardUniformApply('uCheckerFadeStrength')
        });

        reg('dontRenderTrees', {
            category: 'environment', type: 'boolean', default: false,
            description: 'Dont render trees',
            shortLabel: 'No Trees',
            apply: (v, sys) => {
                const game = window.game;
                if (game && game.hybridTreeManager) {
                    game.hybridTreeManager.setTreeVisible(!v);
                }
            }
        });

        // --- Graphics ---
        reg('shadowMapSize', {
            category: 'graphics', type: 'number', default: 1024, min: 512, max: 4096, step: 512,
            description: 'Shadow map size',
            apply: (v, sys) => {
                const applyTo = (light) => {
                    if (!light || !light.shadow) return;
                    light.shadow.mapSize.width = v;
                    light.shadow.mapSize.height = v;
                    if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
                    light.shadow.needsUpdate = true;
                };
                if (sys.sun) applyTo(sys.sun.light);
                if (sys.moon) applyTo(sys.moon.light);
            }
        });
        reg('shadowCameraSize', {
            category: 'graphics', type: 'number', default: 400, min: 50, max: 800, step: 25,
            description: 'Shadow camera size',
            apply: (v, sys) => {
                const applyTo = (light) => {
                    if (!light || !light.shadow || !light.shadow.camera) return;
                    light.shadow.camera.left = -v;
                    light.shadow.camera.right = v;
                    light.shadow.camera.top = v;
                    light.shadow.camera.bottom = -v;
                    light.shadow.camera.updateProjectionMatrix();
                    light.shadow.needsUpdate = true;
                };
                if (sys.sun) applyTo(sys.sun.light);
                if (sys.moon) applyTo(sys.moon.light);
            }
        });

        const withTemporalAA = (cb) => {
            const game = window.game;
            const taa = game && game.temporalAA;
            if (!taa) {
                if (!this._taaWarningShown) {
                    console.warn('[ParameterSystem] Temporal AA controls unavailable (system not initialized)');
                    this._taaWarningShown = true;
                }
                return;
            }
            cb(taa);
        };

        const updateTaaSetting = (prop, reason) => (value) => {
            withTemporalAA(taa => {
                const patch = {};
                patch[prop] = value;
                taa.updateSettings(patch);
                taa.resetHistory(reason || `param:${prop}`);
            });
        };

        reg('taaEnabled', {
            category: 'taa', type: 'boolean', default: false,
            description: 'Enable temporal anti-aliasing (WebGL2 devices only)',
            shortLabel: 'Enabled',
            apply: (v) => {
                const game = window.game;
                if (!v && (!game || !game.temporalAA)) {
                    return;
                }
                withTemporalAA(taa => {
                    taa.setEnabled(!!v);
                    if (v) taa.resetHistory('param:enabled');
                });
            }
        });
        reg('taaFeedbackLow', {
            category: 'taa', type: 'number', default: 0.82, min: 0.5, max: 0.95, step: 0.01,
            description: 'History weight when motion is calm (higher = softer edges)',
            shortLabel: 'Low Motion',
            apply: updateTaaSetting('feedbackMin', 'param:feedbackLow')
        });
        reg('taaFeedbackHigh', {
            category: 'taa', type: 'number', default: 0.95, min: 0.6, max: 0.99, step: 0.01,
            description: 'History weight when motion spikes (higher = smoother but blurrier)',
            shortLabel: 'High Motion',
            apply: updateTaaSetting('feedbackMax', 'param:feedbackHigh')
        });
        reg('taaClampScalar', {
            category: 'taa', type: 'number', default: 1.5, min: 0.5, max: 3.0, step: 0.1,
            description: 'Neighborhood clamp scalar (higher clamps ghosting more aggressively)',
            shortLabel: 'Clamp',
            apply: updateTaaSetting('clampScalar', 'param:clamp')
        });
        reg('taaJitterSpread', {
            category: 'taa', type: 'number', default: 0.65, min: 0.1, max: 2.0, step: 0.05,
            description: 'Subpixel jitter spread (higher = faster convergence, but more shimmer)',
            shortLabel: 'Jitter',
            apply: updateTaaSetting('jitterSpread', 'param:jitter')
        });
        reg('taaSharpenStrength', {
            category: 'taa', type: 'number', default: 0.04, min: 0.0, max: 0.2, step: 0.01,
            description: 'Post-resolve sharpening to recover fine detail',
            shortLabel: 'Sharpen',
            apply: updateTaaSetting('sharpenStrength', 'param:sharpen')
        });

        // --- Tree ---
        reg('treeType', {
            category: 'tree', type: 'select', default: 'none',
            description: 'Override all trees to one type',
            shortLabel: 'Type',
            persist: false, // Never persist — always start with no trees, load on-demand via devtools
            options: [
                { value: 'none', label: 'None' },
                { value: 'default', label: 'Default' },
                { value: 'poplar', label: 'Poplar' },
                { value: 'terrain', label: 'Canopy' },
                { value: 'growing', label: 'Growing' },
                { value: 'cherry', label: 'Cherry' },
                { value: 'billboard', label: 'Illuminated Trees' }
            ],
            apply: (v) => {
                const htm = window.game && window.game.hybridTreeManager;
                console.log('[ParameterSystem.treeType] htm=', !!htm, 'value=', v);
                if (htm) htm.setTreeTypeOverride(v);
            }
        });
        reg('treeWindSensitivity', {
            category: 'tree', type: 'number', default: 1.0, min: 0, max: 3, step: 0.1,
            description: 'How much trees react to global wind speed (multiplier)',
            shortLabel: 'Wind Sens',
            apply: (v) => {
                const htm = window.game && window.game.hybridTreeManager;
                const ps = window.parameterSystem;
                const globalWind = ps ? ps.getParameter('windSpeed') : 1.0;
                const finalWind = globalWind * v;
                if (!htm) return;
                [htm.terrainTreeSystem, htm.growingTreeSystem, htm.poplarTreeSystem, htm.cherryTreeSystem, htm.billboardTreeSystem].forEach((sys, i) => {
                    const names = ['terrain','growing','poplar','cherry','billboard'];
                    if (sys && sys.windUniforms && sys.windUniforms.uWindStrength) {
                        sys.windUniforms.uWindStrength.value = finalWind;
                    }
                });
            }
        });
        reg('treeSwayMult', {
            category: 'tree', type: 'number', default: 1.0, min: 0, max: 3, step: 0.1,
            description: 'Poplar sway multiplier',
            shortLabel: 'Sway',
            apply: (v) => {
                const htm = window.game && window.game.hybridTreeManager;
                console.log('[ParameterSystem.treeSwayMult] htm=', !!htm, 'poplar=', !!(htm && htm.poplarTreeSystem), 'value=', v);
                if (!htm) return;
                let setCount = 0;
                const systems = [htm.poplarTreeSystem, htm.billboardTreeSystem];
                systems.forEach(sys => {
                    if (!sys || !sys.parts) return;
                    sys.parts.forEach(part => {
                        if (part.mesh && part.mesh.material && part.mesh.material.uniforms && part.mesh.material.uniforms.uSwayMult) {
                            part.mesh.material.uniforms.uSwayMult.value = v;
                            setCount++;
                        }
                    });
                });
                console.log(`[ParameterSystem.treeSwayMult] set ${setCount} materials`);
            }
        });
        reg('treeSize', {
            category: 'tree', type: 'number', default: 1.0, min: 0.2, max: 3.0, step: 0.05,
            description: 'Global tree size multiplier',
            shortLabel: 'Size',
            apply: (v) => {
                const htm = window.game && window.game.hybridTreeManager;
                if (!htm) return;
                if (htm.billboardTreeSystem) {
                    htm.billboardTreeSystem.parts.forEach(part => {
                        if (part.mesh && part.mesh.material && part.mesh.material.uniforms && part.mesh.material.uniforms.uTreeSizeMult) {
                            part.mesh.material.uniforms.uTreeSizeMult.value = v;
                        }
                    });
                }
            }
        });
        reg('treeLODEnabled', {
            category: 'tree', type: 'boolean', default: true,
            description: 'Enable LOD animation throttling',
            shortLabel: 'LOD',
            apply: (v) => {
                const htm = window.game && window.game.hybridTreeManager;
                console.log('[ParameterSystem.treeLODEnabled] htm=', !!htm, 'value=', v);
                if (htm) htm.lodEnabled = v;
            }
        });
        reg('treeCullDistance', {
            category: 'tree', type: 'number', default: 120, min: 50, max: 300, step: 10,
            description: 'Tree cull distance',
            shortLabel: 'Cull Dist',
            apply: (v) => {
                const lm = window.game && window.game.lodManager;
                if (lm && lm.setGroupCullDistance) {
                    lm.setGroupCullDistance('terrainTrees', v);
                    lm.setGroupCullDistance('growingTrees', v);
                    lm.setGroupCullDistance('poplarTrees', v);
                    lm.setGroupCullDistance('cherryTrees', v);
                    lm.setGroupCullDistance('billboardTrees', v);
                }
            }
        });
        reg('treeMaxVisible', {
            category: 'tree', type: 'number', default: 1000, min: 100, max: 2000, step: 100,
            description: 'Max visible trees',
            shortLabel: 'Max Vis',
            apply: (v) => {
                const lm = window.game && window.game.lodManager;
                if (lm && lm.setGroupMaxVisible) {
                    lm.setGroupMaxVisible('terrainTrees', v);
                    lm.setGroupMaxVisible('growingTrees', v);
                    lm.setGroupMaxVisible('poplarTrees', v);
                    lm.setGroupMaxVisible('cherryTrees', v);
                    lm.setGroupMaxVisible('billboardTrees', v);
                }
            }
        });

        // --- Performance ---
        reg('maxRenderDistance', {
            category: 'performance', type: 'number', default: 80, min: 20, max: 300, step: 5,
            description: 'Maximum tile render distance',
            apply: (v, sys) => { if (sys.optimization) sys.optimization.maxRenderDistance = v; }
        });
        reg('vertexReduction', {
            category: 'performance', type: 'number', default: 0.8, min: 0, max: 0.95, step: 0.05,
            description: 'Max vertex reduction (adaptive mesh)',
            apply: (v, sys) => {
                if (sys.optimization && sys.optimization.adaptiveMesh) {
                    sys.optimization.adaptiveMesh.maxVertexReduction = v;
                }
            }
        });
        reg('targetFps', {
            category: 'performance', type: 'number', default: 30, min: 15, max: 120, step: 1,
            description: 'Target FPS for performance manager',
            apply: (v) => {
                const pm = window.game && window.game.performanceManager;
                if (pm) pm.targetFps = v;
            }
        });

        // --- Camera ---
        reg('scrollEffectStartHeight', {
            category: 'camera', type: 'number', default: 0, min: 0, max: 200, step: 0.1,
            description: 'Height above terrain where drag-speed scaling begins',
            shortLabel: 'Start Ht'
        });
        reg('scrollBaseDragSpeed', {
            category: 'camera', type: 'number', default: 0.04, min: 0.001, max: 0.5, step: 0.001,
            description: 'Base right-click / touch drag pan speed',
            shortLabel: 'Base Speed'
        });
        reg('scrollHeightMultiplier', {
            category: 'camera', type: 'number', default: 0.001, min: 0, max: 0.05, step: 0.0001,
            description: 'Extra drag speed per world unit above start height',
            shortLabel: 'Ht Multiplier'
        });
        reg('wheelSensitivity', {
            category: 'camera', type: 'number', default: 2, min: 0.5, max: 10, step: 0.5,
            description: 'Mouse wheel zoom sensitivity multiplier',
            shortLabel: 'Wheel Sens'
        });
        reg('isometricMode', {
            category: 'camera', type: 'boolean', default: false,
            description: 'Enable isometric camera mode',
            shortLabel: 'Isometric',
            apply: (v) => {
                const game = window.game;
                if (game && game.camera) {
                    if (v) {
                        game.camera.setMode('isometric');
                    } else {
                        game.camera.setMode('tactical');
                    }
                }
            }
        });

        // --- Sky / Starfield ---
        reg('starType', {
            category: 'stars', type: 'select', default: 'default',
            description: 'Star field preset type',
            shortLabel: 'Star Type',
            options: [
                { value: 'default', label: 'Default' },
                { value: 'dense', label: 'Dense' },
                { value: 'bright', label: 'Bright' },
                { value: 'subtle', label: 'Subtle' },
                { value: 'cinematic', label: 'Cinematic' },
                { value: 'twinkling', label: 'Twinkling' },
                { value: 'distant_galaxy', label: 'Distant Galaxy' }
            ],
            apply: (v, sys) => {
                const presets = {
                    default: { skyStarDensity: 1000, skyStarBrightness: 1.0, skyShimmerSpeed: 2.0, skyShimmerIntensity: 0.3, skyStarColor: '#ffffff' },
                    dense: { skyStarDensity: 3000, skyStarBrightness: 1.2, skyShimmerSpeed: 2.0, skyShimmerIntensity: 0.2, skyStarColor: '#ffffff' },
                    bright: { skyStarDensity: 800, skyStarBrightness: 2.5, skyShimmerSpeed: 1.5, skyShimmerIntensity: 0.1, skyStarColor: '#fff8e7' },
                    subtle: { skyStarDensity: 600, skyStarBrightness: 0.6, skyShimmerSpeed: 0.5, skyShimmerIntensity: 0.05, skyStarColor: '#e6e6ff' },
                    cinematic: { skyStarDensity: 1500, skyStarBrightness: 1.3, skyShimmerSpeed: 1.0, skyShimmerIntensity: 0.15, skyStarColor: '#fff5e6' },
                    twinkling: { skyStarDensity: 1200, skyStarBrightness: 1.5, skyShimmerSpeed: 6.0, skyShimmerIntensity: 0.8, skyStarColor: '#ffe6f0' },
                    distant_galaxy: { skyStarDensity: 4000, skyStarBrightness: 0.8, skyShimmerSpeed: 3.0, skyShimmerIntensity: 0.4, skyStarColor: '#aaccff' }
                };
                const preset = presets[v];
                if (!preset) return;
                Object.entries(preset).forEach(([name, value]) => {
                    this.setParameter(name, value, 'preset');
                });
            }
        });
        reg('skyFadeStartHeight', {
            category: 'sky', type: 'number', default: 50, min: 0, max: 500, step: 5,
            description: 'Camera height where stars start appearing',
            shortLabel: 'Fade Start',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setFadeStartHeight(v);
            }
        });
        reg('skyFadeEndHeight', {
            category: 'sky', type: 'number', default: 120, min: 10, max: 1000, step: 10,
            description: 'Camera height where stars are fully visible',
            shortLabel: 'Fade End',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setFadeEndHeight(v);
            }
        });
        reg('skyStarDensity', {
            category: 'stars', type: 'number', default: 1000, min: 100, max: 5000, step: 100,
            description: 'Star field density',
            shortLabel: 'Density',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setStarDensity(v);
            }
        });
        reg('skyStarBrightness', {
            category: 'stars', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.1,
            description: 'Overall star brightness',
            shortLabel: 'Brightness',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setStarBrightness(v);
            }
        });
        reg('skyShimmerSpeed', {
            category: 'stars', type: 'number', default: 2.0, min: 0.0, max: 10.0, step: 0.5,
            description: 'Twinkle animation speed',
            shortLabel: 'Shimmer Speed',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setShimmerSpeed(v);
            }
        });
        reg('skyShimmerIntensity', {
            category: 'stars', type: 'number', default: 0.3, min: 0.0, max: 1.0, step: 0.05,
            description: 'Twinkle intensity variation',
            shortLabel: 'Shimmer Int',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setShimmerIntensity(v);
            }
        });
        reg('skyStarColor', {
            category: 'stars', type: 'color', default: '#ffffff',
            description: 'Star color tint',
            shortLabel: 'Star Color',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setStarColor(v);
            }
        });
        reg('skyEnabled', {
            category: 'sky', type: 'boolean', default: true,
            description: 'Enable starfield shader (disable to use canvas sky)',
            shortLabel: 'Enabled',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) {
                    sys.skyShaderSystem.skySphere.visible = v;
                    // Clear scene.background when shader is enabled so sphere shows through
                    if (v) {
                        sys.scene.background = null;
                    } else {
                        sys.scene.background = sys.skyTexture;
                    }
                }
            }
        });
    }

    // ---------- Gate installation ----------

    _getSystem() { return window.boardSystem; }

    _waitForSystems() {
        if (this.systemsReady) return this.systemsReady;
        return new Promise(resolve => {
            const check = () => {
                const bs = this._getSystem();
                if (bs && bs.sun && bs.sun.light && bs.moon && bs.moon.light && bs.ambientLight && bs.scene && bs.scene.fog) {
                    resolve();
                } else {
                    setTimeout(check, 200);
                }
            };
            check();
        });
    }

    _installAll() {
        const sys = this._getSystem();
        if (!sys) return;

        this.params.forEach((p, name) => this._installOne(name, p, sys));

        // Wrap time-sync so user-overridden dayTime/daySpeed survive server updates
        this._wrapTimeSync(sys);

        console.log('[ParameterSystem] Gates installed');

        // Apply initial defaults to surface them into the game state
        this.params.forEach((p, name) => {
            if (p.apply) {
                try { p.apply(p.value, sys); } catch (e) { /* tolerant */ }
            }
        });
    }

    _installOne(name, p, sys) {
        if (this.installed.has(name)) return;

        // Numeric / value gate via Object.defineProperty
        if (p.gate && typeof p.gate.targetOf === 'function') {
            const target = p.gate.targetOf(sys);
            if (!target) {
                setTimeout(() => this._installOne(name, p, sys), 500);
                return;
            }
            this._installValueGate(target, p.gate.prop, p);
        }

        // Color gate via instance method monkey-patch
        if (typeof p.colorGate === 'function') {
            const colorObj = p.colorGate(sys);
            if (!colorObj) {
                setTimeout(() => this._installOne(name, p, sys), 500);
                return;
            }
            this._installColorGate(colorObj, p);
            // Initialize color to default
            try { colorObj.set(p.value); } catch (e) {}
        }

        this.installed.add(name);
    }

    _installValueGate(target, prop, param) {
        // Read existing descriptor to preserve original getter/setter if already defined.
        let stored = target[prop];
        // Sync param.value to real current state so dev UI reflects reality on first open.
        if (stored !== undefined && stored !== null && !param.userOverridden) {
            param.value = stored;
        }
        try { delete target[prop]; } catch (e) {}

        Object.defineProperty(target, prop, {
            configurable: true,
            enumerable: true,
            get: () => param.userOverridden ? param.value : stored,
            set: (v) => {
                if (param.userOverridden) {
                    // Silently ignore external writes while user holds control.
                    return;
                }
                stored = v;
            }
        });
    }

    _installColorGate(colorObj, param) {
        if (colorObj.__gatedParameter) return;
        colorObj.__gatedParameter = param.name;

        const origCopy   = colorObj.copy.bind(colorObj);
        const origLerp   = colorObj.lerp.bind(colorObj);
        const origSet    = colorObj.set.bind(colorObj);
        const origSetRGB = colorObj.setRGB ? colorObj.setRGB.bind(colorObj) : null;
        const origSetHex = colorObj.setHex ? colorObj.setHex.bind(colorObj) : null;
        const origLerpColors = colorObj.lerpColors ? colorObj.lerpColors.bind(colorObj) : null;

        colorObj.copy = function (c) { return param.userOverridden ? this : origCopy(c); };
        colorObj.lerp = function (c, t) { return param.userOverridden ? this : origLerp(c, t); };
        if (origSetRGB)      colorObj.setRGB = function (r, g, b) { return param.userOverridden ? this : origSetRGB(r, g, b); };
        if (origSetHex)      colorObj.setHex = function (h) { return param.userOverridden ? this : origSetHex(h); };
        if (origLerpColors)  colorObj.lerpColors = function (a, b, t) { return param.userOverridden ? this : origLerpColors(a, b, t); };

        // .set() is used by user setParameter path too — always allow it, but it is
        // also called in some game code paths. To differentiate, we let it through
        // when called via ParameterSystem (marked via _psDirect flag).
        colorObj.set = function (v) {
            if (!param.userOverridden || colorObj._psDirect) return origSet(v);
            return this;
        };
    }

    _wrapTimeSync(sys) {
        if (sys.__psTimeSyncWrapped || typeof sys.updateServerGameTime !== 'function') return;
        sys.__psTimeSyncWrapped = true;

        const original = sys.updateServerGameTime.bind(sys);
        const ps = this;
        sys.updateServerGameTime = function (data) {
            const dt = ps.params.get('dayTime');
            const ds = ps.params.get('daySpeed');
            const isDayTimeTransient = !!(dt && dt.persist === false);
            const isDaySpeedTransient = !!(ds && ds.persist === false);
            const hasDaySpeedOverride = !!(ds && ds.userOverridden && !isDaySpeedTransient);
            const hasDayTimeOverride = !!(dt && dt.userOverridden && !isDayTimeTransient);

            const releaseTransientDayTime = () => {
                if (isDayTimeTransient && dt && dt.userOverridden) {
                    dt.userOverridden = false;
                }
            };

            if (!hasDaySpeedOverride && !hasDayTimeOverride) {
                releaseTransientDayTime();
                return original(data);
            }

            const payload = (data && typeof data === 'object') ? data : {};
            const elapsed = Number.isFinite(payload.elapsedTime) ? payload.elapsedTime : 0;
            const referenceDay = Number.isFinite(payload.dayLength) && payload.dayLength > 0 ? payload.dayLength : 60000;

            sys.lastTimeSyncTimestamp = Date.now();

            // Sync calendar fields from server so date display updates even when overridden
            if (Number.isFinite(payload.year)) sys.serverYear = payload.year;
            if (Number.isFinite(payload.dayOfYear)) sys.serverDayOfYear = payload.dayOfYear;
            if (Number.isFinite(payload.timeOfDay)) sys.serverTimeOfDay = payload.timeOfDay;
            if (!hasDaySpeedOverride && Number.isFinite(payload.dayLength)) sys.serverDayLength = payload.dayLength;

            if (hasDaySpeedOverride) {
                if (hasDayTimeOverride) {
                    sys.serverGameTime = (dt.value / 24) * (sys.serverDayLength || 60000);
                    return;
                }
                const normalized = referenceDay > 0 ? ((elapsed % referenceDay) / referenceDay) : 0;
                sys.serverGameTime = normalized * (sys.serverDayLength || referenceDay || 60000);
                releaseTransientDayTime();
                return;
            }

            // Only dayTime override active
            sys.serverDayLength = sys.serverDayLength || 60000;
            sys.serverGameTime = (dt.value / 24) * sys.serverDayLength;
        };
    }

    // ---------- Apply / coerce / events ----------

    _apply(name, p, sys, forceThroughGate) {
        if (!sys) {
            console.warn(`[ParameterSystem] _apply("${name}") skipped: sys is null`);
            return;
        }

        // Run user-defined apply
        if (p.apply) {
            console.log(`[ParameterSystem] _apply("${name}") calling apply() with value=`, p.value);
            try {
                p.apply(p.value, sys);
                console.log(`[ParameterSystem] _apply("${name}") apply() succeeded`);
            } catch (e) {
                console.warn(`[ParameterSystem] apply ${name} failed:`, e);
            }
        } else {
            console.log(`[ParameterSystem] _apply("${name}") has no apply callback`);
        }

        // For value-gated params, force the stored value to match (so reads outside the
        // descriptor path — e.g. GPU uniform snapshots — see the user's value).
        if (p.gate && typeof p.gate.targetOf === 'function') {
            const target = p.gate.targetOf(sys);
            if (target) {
                try {
                    target[p.gate.prop] = p.value; // blocked by gate if overridden — so use direct bypass
                } catch (e) {}
                // Bypass to actually mutate the stored slot: temporarily drop gate, write, reinstall.
                this._forceGatedWrite(target, p.gate.prop, p);
            }
        }

        // For color-gated params, force-set via flagged bypass.
        if (typeof p.colorGate === 'function') {
            const colorObj = p.colorGate(sys);
            if (colorObj) {
                colorObj._psDirect = true;
                try { colorObj.set(p.value); } finally { colorObj._psDirect = false; }
            }
        }
    }

    _forceGatedWrite(target, prop, param) {
        // The descriptor ignores writes while overridden; temporarily release to store value.
        const desc = Object.getOwnPropertyDescriptor(target, prop);
        if (!desc || !desc.get) return;
        const wasOverridden = param.userOverridden;
        param.userOverridden = false;  // let the setter accept the write
        try {
            target[prop] = param.value;
        } finally {
            param.userOverridden = wasOverridden;
        }
    }

    _coerce(p, value, clamp = true) {
        if (p.type === 'number') {
            const n = typeof value === 'number' ? value : parseFloat(value);
            if (Number.isNaN(n)) return undefined;
            let v = n;
            if (clamp) {
                if (p.min !== undefined) v = Math.max(p.min, v);
                if (p.max !== undefined) v = Math.min(p.max, v);
            }
            return v;
        }
        if (p.type === 'color') {
            if (typeof value === 'string') return value;
            if (value && typeof value.getHexString === 'function') return '#' + value.getHexString();
            return p.defaultValue;
        }
        if (p.type === 'modifierStack') {
            if (value instanceof ModifierStack) return value;
            if (value && typeof value === 'object') {
                try { return ModifierStack.fromJSON(value); } catch (e) { return ModifierStack.defaultStack(); }
            }
            return ModifierStack.defaultStack();
        }
        if (p.type === 'select' && typeof p.defaultValue === 'number') {
            const n = typeof value === 'number' ? value : parseFloat(value);
            if (Number.isNaN(n)) return p.defaultValue;
            return n;
        }
        return value;
    }

    _snapshot(p) {
        let snapValue = p.value;
        let snapDefault = p.defaultValue;
        if (p.type === 'modifierStack') {
            snapValue = snapValue && typeof snapValue.toJSON === 'function' ? snapValue.toJSON() : snapValue;
            snapDefault = snapDefault && typeof snapDefault.toJSON === 'function' ? snapDefault.toJSON() : snapDefault;
        }
        return {
            value: snapValue,
            defaultValue: snapDefault,
            userOverridden: p.userOverridden,
            type: p.type,
            category: p.category,
            description: p.description,
            shortLabel: p.shortLabel,
            min: p.min,
            max: p.max,
            step: p.step,
            options: p.options,
            persist: p.persist !== undefined ? p.persist : true,
            showIf: p.showIf,
            rebuildCategory: p.rebuildCategory,
            lastModified: p.lastModified,
            modifiedBy: p.modifiedBy
        };
    }

    _updateUI(name, value) {
        // DevInterface tags the wrapping container with data-parameter.
        document.querySelectorAll(`[data-parameter="${name}"]`).forEach(container => {
            const isSelf = container.tagName === 'INPUT';
            if (isSelf) {
                if (!container.matches(':focus')) {
                    if (container.type === 'checkbox') container.checked = !!value;
                    else container.value = value;
                }
                return;
            }
            const slider  = container.querySelector('input[type="range"]');
            const num     = container.querySelector('input[type="number"]');
            const color   = container.querySelector('input[type="color"]');
            const display = container.querySelector('.param-value');
            if (slider && !slider.matches(':focus')) slider.value = value;
            if (num && !num.matches(':focus')) num.value = value;
            if (color && !color.matches(':focus')) color.value = value;
            if (display) display.textContent = value;
        });

        // Also notify the DevInterface directly if present.
        const dev = window.devInterface;
        if (dev && typeof dev.updateParameterDisplay === 'function') {
            try { dev.updateParameterDisplay(name, value); } catch (e) {}
        }
    }

    _emit(name, value, p) {
        this.listeners.forEach(fn => {
            try { fn(name, value, p); } catch (e) {}
        });
    }

    _setupSocketListeners() {
        const tryHook = () => {
            const nm = window.game && window.game.networkManager;
            const sock = nm && nm.socket;
            if (!sock) { setTimeout(tryHook, 500); return; }

            sock.on('setParameter', data => {
                if (data && data.name !== undefined) {
                    this.setParameter(data.name, data.value, 'server');
                }
            });
            sock.on('setParameters', data => {
                if (data && typeof data === 'object') {
                    Object.entries(data).forEach(([n, v]) => this.setParameter(n, v, 'server'));
                }
            });
            sock.on('getParameters', () => {
                sock.emit('parametersResponse', this.getAllParameters());
            });
            console.log('[ParameterSystem] Socket listeners ready');
        };
        tryHook();
    }

    async _loadSavedDefaults() {
        // 1. Try client-side default ENV first (set via DevInterface "Set Def")
        const envRaw = localStorage.getItem('chesiopia-default-env');
        if (envRaw) {
            const envName = localStorage.getItem('chesiopia-default-env-name') || 'default-env';
            console.log(`[ParameterSystem._loadSavedDefaults] Found localStorage default ENV: ${envName}`);
            try {
                const envData = JSON.parse(envRaw);
                await this._waitForSystems();
                this._applySavedDefaults(envData, 'default-env');
                console.log('[ParameterSystem._loadSavedDefaults] Default ENV applied successfully');
                return;
            } catch (err) {
                console.warn('[ParameterSystem._loadSavedDefaults] Failed to apply default ENV, falling back to server:', err);
            }
        }

        // 2. Fall back to server-side /api/defaults
        console.log('[ParameterSystem._loadSavedDefaults] Starting fetch of /api/defaults...');
        try {
            const response = await fetch('/api/defaults');
            console.log(`[ParameterSystem._loadSavedDefaults] response.ok=${response.ok}, status=${response.status}`);
            if (!response.ok) {
                console.warn(`[ParameterSystem._loadSavedDefaults] HTTP ${response.status} — aborting load`);
                return;
            }
            const defaults = await response.json();
            const keys = Object.keys(defaults);
            console.log(`[ParameterSystem._loadSavedDefaults] received keys:`, keys);
            if (keys.length === 0) {
                console.log('[ParameterSystem._loadSavedDefaults] empty payload — nothing to apply');
                return;
            }

            console.log(`[ParameterSystem._loadSavedDefaults] Applying ${keys.length} saved default(s):`, keys.join(', '));
            await this._waitForSystems();
            this._applySavedDefaults(defaults, 'server-defaults');
            console.log('[ParameterSystem._loadSavedDefaults] Saved defaults applied successfully');
        } catch (err) {
            console.warn('[ParameterSystem._loadSavedDefaults] Could not load saved defaults:', err);
        }
    }

    _applySavedDefaults(defaults, sourceLabel) {
        // Handle lightingRig embedded in ENV exports
        if (defaults.lightingRig) {
            const board = window.boardSystem;
            if (board && board.lightingRig) {
                try {
                    Object.assign(board.lightingRig, JSON.parse(JSON.stringify(defaults.lightingRig)));
                    console.log(`[ParameterSystem._applySavedDefaults] lightingRig restored from ${sourceLabel}`);
                } catch (e) {
                    console.warn('[ParameterSystem._applySavedDefaults] Failed to restore lightingRig:', e);
                }
            }
        }

        Object.keys(defaults).forEach(name => {
            if (name === 'lightingRig') return; // handled above
            const p = this.params.get(name);
            if (!p) {
                console.warn(`[ParameterSystem._applySavedDefaults] Saved default for unknown parameter: ${name}`);
                return;
            }

            if (p.persist === false) {
                console.log(`[ParameterSystem._applySavedDefaults] Skipping non-persistent parameter: ${name}`);
                return;
            }

            // ENV files store full snapshot objects {value, defaultValue, ...}
            // Server /api/defaults stores raw values
            let raw = defaults[name];
            let saved = (raw && typeof raw === 'object' && 'value' in raw) ? raw.value : raw;
            console.log(`[ParameterSystem._applySavedDefaults] ${name}: stored=${saved}, type=${typeof saved}, paramType=${p.type}`);

            // Validate type match
            if (p.type === 'number' && typeof saved !== 'number') {
                console.warn(`[ParameterSystem._applySavedDefaults] Skipped ${name}: expected number, got ${typeof saved}`);
                return;
            }
            if (p.type === 'boolean' && typeof saved !== 'boolean') {
                console.warn(`[ParameterSystem._applySavedDefaults] Skipped ${name}: expected boolean, got ${typeof saved}`);
                return;
            }
            if (p.type === 'modifierStack' && saved && typeof saved === 'object' && saved.layers === undefined) {
                console.warn(`[ParameterSystem._applySavedDefaults] Skipped ${name}: expected modifierStack object`);
                return;
            }

            // Clamp to declared bounds
            const min = p.min !== undefined ? p.min : -Infinity;
            const max = p.max !== undefined ? p.max : Infinity;
            let value = saved;
            if (p.type === 'number') value = Math.max(min, Math.min(max, value));

            // Update defaultValue so reset brings you back here, not to hardcoded
            p.defaultValue = value;
            p.value = value;
            p.userOverridden = true;
            p.lastModified = Date.now();
            p.modifiedBy = sourceLabel;
            console.log(`[ParameterSystem._applySavedDefaults] ${name}: applying value=${value}`);
            this._apply(name, p, this._getSystem(), /*forceThroughGate=*/true);
            this._updateUI(name, value);
            console.log(`[ParameterSystem._applySavedDefaults] ${name}: applied & UI updated`);
        });
    }
}

// Bootstrap
window.parameterSystem = new ParameterSystem();

// Convenience globals
window.getParam      = (n) => window.parameterSystem.getParameter(n);
window.setParam      = (n, v) => window.parameterSystem.setParameter(n, v);
window.resetParam    = (n) => window.parameterSystem.resetParameter(n);
window.resetAllParams = () => window.parameterSystem.resetAll();
window.getAllParams  = () => window.parameterSystem.getAllParameters();

// Diagnostic: call debugPersistence() from the console to inspect persistence state
window.debugPersistence = () => {
    const ps = window.parameterSystem;
    const all = ps.getAllParameters();
    const overrides = {};
    const gated = {};
    Object.entries(all).forEach(([name, cfg]) => {
        if (cfg.value !== cfg.default) overrides[name] = { value: cfg.value, default: cfg.default };
        if (cfg.userOverridden) gated[name] = cfg.value;
    });
    console.group('=== Persistence Debug ===');
    console.log('Total parameters:', Object.keys(all).length);
    console.log('Overridden (value != default):', Object.keys(overrides).length, overrides);
    console.log('Gated (userOverridden=true):', Object.keys(gated).length, gated);
    console.log('Full state:', all);
    console.groupEnd();
    return { overrides, gated, all };
};

// Hook into game loop for wind direction gradual update
const _windHook = () => {
    const ps = window.parameterSystem;
    if (ps && ps.updateWindDirection) {
        // Approximate delta time - systems can also call directly with precise dt
        ps.updateWindDirection(0.016);
    }
    requestAnimationFrame(_windHook);
};
requestAnimationFrame(_windHook);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParameterSystem;
}
