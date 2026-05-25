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
        this._orbitScaleSyncHandle = null;
        this._debug = false;  // Set true for verbose parameter logging
        this._warnedUnknowns = new Set(); // One-time unknown param warnings

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
        if (this._debug) console.log(`[ParameterSystem] setParameter("${name}",`, value, `, src=${source})`);
        const p = this.params.get(name);
        if (!p) {
            console.warn(`[ParameterSystem] Unknown parameter: ${name}`);
            return false;
        }

        const coerced = this._coerce(p, value, options.clamp !== false);
        if (this._debug) console.log(`[ParameterSystem] "${name}" coerced:`, value, '->', coerced);
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
        if (this._debug) console.log(`[ParameterSystem] "${name}" applying to sys=`, !!sys);
        this._apply(name, p, sys, /*forceThroughGate=*/true);
        this._updateUI(name, value);
        this._emit(name, value, p);

        if (this._debug) console.log(`[ParameterSystem] ${name} = ${value} (src=${source}, override=${p.userOverridden})`);
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
            gate: { targetOf: sys => sys, prop: 'waterLevel' },
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (!rt || !rt.waterMesh) return;
                const waterY = v + rt.waterOffset;
                const waterPos = rt.waterMesh.geometry.attributes.position.array;
                for (let i = 1; i < waterPos.length; i += 3) {
                    waterPos[i] = waterY;
                }
                rt.waterMesh.geometry.attributes.position.needsUpdate = true;
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
            category: 'terrain', type: 'number', default: 32, min: 8, max: 64, step: 1,
            description: 'Terrain chunk size (affects streaming cadence)',
            apply: (value) => {
                const game = window.game;
                if (game && game.terrainSystem && typeof game.terrainSystem.setChunkSize === 'function') {
                    game.terrainSystem.setChunkSize(value);
                }
                const board = window.boardSystem;
                if (board) {
                    board.chunkSize = value;
                }
            }
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
        reg('terrainSunOrbitScale', {
            category: 'terrain', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.05,
            description: 'Multiplier for the primary orbit height influence (sun) when generating terrain',
            shortLabel: 'Sun Orbit',
            apply: () => {
                this._queueOrbitHeightScaleSync();
            }
        });
        reg('terrainMoonOrbitScale', {
            category: 'terrain', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.05,
            description: 'Multiplier for the secondary orbit height influence (moon) when generating terrain',
            shortLabel: 'Moon Orbit',
            apply: () => {
                this._queueOrbitHeightScaleSync();
            }
        });

        // --- Water plane ---
        const _getWaterMesh = () => {
            const bs = window.boardSystem;
            return bs && bs.rollingTerrain ? bs.rollingTerrain.waterMesh : null;
        };
        const _getRollingTerrain = () => {
            const bs = window.boardSystem;
            return bs ? bs.rollingTerrain : null;
        };
        reg('waterVisible', {
            category: 'water', type: 'boolean', default: true,
            description: 'Show terrain-following water plane',
            shortLabel: 'Visible',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm) wm.visible = v;
            }
        });
        reg('waterOpacity', {
            category: 'water', type: 'number', default: 0.45, min: 0.0, max: 1.0, step: 0.05,
            description: 'Water plane opacity',
            shortLabel: 'Opacity',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uOpacity.value = v;
            }
        });
        reg('waterOffset', {
            category: 'water', type: 'number', default: 0.03, min: 0.0, max: 1.0, step: 0.01,
            description: 'Height offset above terrain surface',
            shortLabel: 'Offset',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (!rt) return;
                rt.waterOffset = v;
                const waterPos = rt.waterMesh.geometry.attributes.position.array;
                const pos = rt.geometry.attributes.position.array;
                waterPos.set(pos); // copy X/Z from terrain
                const waterLevel = rt.board.tidalWaterLevel ?? rt.board.waterLevel ?? -1.5;
                const waterY = waterLevel + v;
                for (let i = 1; i < waterPos.length; i += 3) {
                    waterPos[i] = waterY;
                }
                rt.waterMesh.geometry.attributes.position.needsUpdate = true;
            }
        });
        reg('waterRoughness', {
            category: 'water', type: 'number', default: 0.05, min: 0.0, max: 1.0, step: 0.05,
            description: 'Water surface roughness',
            shortLabel: 'Roughness',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uRoughness.value = v;
            }
        });
        reg('waterMetalness', {
            category: 'water', type: 'number', default: 0.7, min: 0.0, max: 1.0, step: 0.05,
            description: 'Water surface metalness',
            shortLabel: 'Metalness',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uMetalness.value = v;
            }
        });
        reg('waveEnabled', {
            category: 'water', type: 'boolean', default: true,
            description: 'Enable toroidal Gerstner wave animation',
            shortLabel: 'Waves',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (rt) rt.waveConfig.enabled = v;
            }
        });
        reg('waveAmplitude', {
            category: 'water', type: 'number', default: 1.0, min: 0.0, max: 2.0, step: 0.05,
            description: 'Wave height multiplier',
            shortLabel: 'Wave Amp',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (rt) rt.waveConfig.amplitudeScale = v;
            }
        });
        reg('waveSpeed', {
            category: 'water', type: 'number', default: 1.5, min: 0.0, max: 3.0, step: 0.1,
            description: 'Wave animation speed',
            shortLabel: 'Wave Speed',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (rt) rt.waveConfig.speed = v;
            }
        });
        reg('waveSteepness', {
            category: 'water', type: 'number', default: 0.3, min: 0.0, max: 1.0, step: 0.05,
            description: 'Wave crest sharpness (0 = smooth, 1 = sharp)',
            shortLabel: 'Steepness',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (rt) rt.waveConfig.steepness = v;
            }
        });
        reg('waveTexScale', {
            category: 'water', type: 'number', default: 1.0, min: 0.1, max: 3.0, step: 0.1,
            description: 'Wave texture spatial frequency multiplier',
            shortLabel: 'Freq Scale',
            apply: (v) => {
                const rt = _getRollingTerrain();
                if (rt && rt.waveConfig) rt.waveConfig.freqScale = v;
                if (rt && rt.waterUniforms) rt.waterUniforms.uWaveTexScale.value = v;
            }
        });
        reg('waveTexSpeed', {
            category: 'water', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.1,
            description: 'Wave texture animation speed multiplier',
            shortLabel: 'Speed Scale',
            apply: (v) => {
                const rt = _getRollingTerrain();
                if (rt && rt.waveConfig) rt.waveConfig.speedScale = v;
                if (rt && rt.waterUniforms) rt.waterUniforms.uWaveTexSpeed.value = v;
            }
        });
        reg('waveTexNormal', {
            category: 'water', type: 'number', default: 0.35, min: 0.0, max: 1.0, step: 0.05,
            description: 'How much the procedural waves perturb surface normals',
            shortLabel: 'Tex Normal',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWaveNormalStr.value = v;
            }
        });
        reg('waveWindFactor', {
            category: 'water', type: 'number', default: 1.0, min: 0.0, max: 2.0, step: 0.1,
            description: 'How much wind affects both geometry and texture wave speed',
            shortLabel: 'Wind Factor',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (rt) rt.windSpeed = v;
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWindSpeed.value = v;
            }
        });
        reg('waterWindDirX', {
            category: 'water', type: 'number', default: 1.0, min: -1.0, max: 1.0, step: 0.05,
            description: 'Wind direction X component (affects procedural wave flow)',
            shortLabel: 'Wind Dir X',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (rt && rt.windDir) rt.windDir.x = v;
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms && wm.material.uniforms.uWindDir) wm.material.uniforms.uWindDir.value.x = v;
            }
        });
        reg('waterWindDirZ', {
            category: 'water', type: 'number', default: 0.0, min: -1.0, max: 1.0, step: 0.05,
            description: 'Wind direction Z component (affects procedural wave flow)',
            shortLabel: 'Wind Dir Z',
            apply: (v) => {
                const rt = window.boardSystem && window.boardSystem.rollingTerrain;
                if (rt && rt.windDir) rt.windDir.y = v;
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms && wm.material.uniforms.uWindDir) wm.material.uniforms.uWindDir.value.y = v;
            }
        });
        reg('waterColor', {
            category: 'water', type: 'color', default: '#3388cc',
            description: 'Base water colour',
            shortLabel: 'Water Colour',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms && wm.material.uniforms.uWaterColor) {
                    wm.material.uniforms.uWaterColor.value.set(v);
                }
            }
        });
        reg('shoreLagTime', {
            category: 'water', type: 'number', default: 8.0, min: 0.5, max: 30.0, step: 0.5,
            description: 'Seconds for shore wet line to catch up to changing water level (higher = slower)',
            shortLabel: 'Shore Lag',
            apply: (v) => {
                const board = window.boardSystem;
                if (board) board.shoreLagTimeConstant = v;
            }
        });
        reg('waterFalloffEnabled', {
            category: 'water', type: 'boolean', default: false,
            description: 'Enable distance-based transparency falloff',
            shortLabel: 'Falloff',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uFalloffEnabled.value = v ? 1.0 : 0.0;
            }
        });
        reg('waterFalloffDistance', {
            category: 'water', type: 'number', default: 50.0, min: 10.0, max: 200.0, step: 5.0,
            description: 'Distance over which water fades out',
            shortLabel: 'Falloff Distance',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uFalloffDistance.value = v;
            }
        });
        reg('waterRadius', {
            category: 'water', type: 'number', default: 25.0, min: 5.0, max: 60.0, step: 1.0,
            description: 'Radius of geometric water mesh around camera',
            shortLabel: 'Radius',
            apply: (v) => {
                const rt = _getRollingTerrain();
                if (!rt) return;
                rt.waterRadius = v;
                // Rebuild mesh geometry with new radius
                if (rt.waterMesh && rt.waterMesh.geometry) {
                    const newGeo = rt._createSquareWaterMesh(rt.waterRadius, rt.waterResolution);
                    rt.waterMesh.geometry.dispose();
                    rt.waterMesh.geometry = newGeo;
                    rt._waterDepths = newGeo.attributes.terrainDepth.array;
                }
            }
        });
        reg('waterFadeRadius', {
            category: 'water', type: 'number', default: 25.0, min: 5.0, max: 60.0, step: 1.0,
            description: 'Distance from camera where wave displacement starts fading (default matches mesh radius)',
            shortLabel: 'Fade Radius',
            apply: (v) => {
                const rt = _getRollingTerrain();
                if (rt && rt.waterUniforms) rt.waterUniforms.uGeoRadius.value = v;
            }
        });
        reg('waterGeoFadeWidth', {
            category: 'water', type: 'number', default: 5.0, min: 0.0, max: 20.0, step: 0.5,
            description: 'Width of geometric-to-shader water fade band',
            shortLabel: 'Fade Width',
            apply: (v) => {
                const rt = _getRollingTerrain();
                if (rt) rt.waterGeoFadeWidth = v;
                if (rt && rt.waterUniforms) rt.waterUniforms.uGeoFadeWidth.value = v;
            }
        });
        reg('waterResolution', {
            category: 'water', type: 'number', default: 32, min: 8, max: 64, step: 1,
            description: 'Square water mesh resolution (verts per axis)',
            shortLabel: 'Resolution',
            apply: (v) => {
                const rt = _getRollingTerrain();
                if (!rt) return;
                rt.waterResolution = Math.max(8, Math.min(64, v));
                // Changing resolution requires rebuilding the water mesh geometry
                if (rt.waterMesh && rt.waterMesh.geometry) {
                    const newGeo = rt._createSquareWaterMesh(rt.waterRadius, rt.waterResolution);
                    rt.waterMesh.geometry.dispose();
                    rt.waterMesh.geometry = newGeo;
                    rt._waterDepths = newGeo.attributes.terrainDepth.array;
                }
            }
        });
        reg('waveCrestTint', {
            category: 'water', type: 'number', default: 1.15, min: 0.5, max: 2.0, step: 0.05,
            description: 'Brightness multiplier for wave crests',
            shortLabel: 'Crest Tint',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWaveCrestTint.value = v;
            }
        });
        reg('waveTroughTint', {
            category: 'water', type: 'number', default: 0.85, min: 0.2, max: 1.5, step: 0.05,
            description: 'Darkness multiplier for wave troughs',
            shortLabel: 'Trough Tint',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWaveTroughTint.value = v;
            }
        });
        reg('waveSparkle', {
            category: 'water', type: 'number', default: 0.3, min: 0.0, max: 1.0, step: 0.05,
            description: 'Intensity of moving sparkle highlights on wave peaks',
            shortLabel: 'Sparkle',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWaveSparkle.value = v;
            }
        });
        reg('waveSpecularPower', {
            category: 'water', type: 'number', default: 32.0, min: 1.0, max: 128.0, step: 1.0,
            description: 'Specular highlight sharpness (Blinn-Phong exponent)',
            shortLabel: 'Spec Power',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWaveSpecularPower.value = v;
            }
        });
        reg('waveFresnelPower', {
            category: 'water', type: 'number', default: 2.0, min: 0.5, max: 5.0, step: 0.1,
            description: 'Reflection edge falloff sharpness (higher = sharper edges)',
            shortLabel: 'Fresnel Power',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWaveFresnelPower.value = v;
            }
        });
        reg('waveNormalEps', {
            category: 'water', type: 'number', default: 0.05, min: 0.01, max: 0.2, step: 0.01,
            description: 'Normal computation step size (lower = sharper, bumpier normals)',
            shortLabel: 'Normal Eps',
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) wm.material.uniforms.uWaveNormalEps.value = v;
            }
        });

        // --- Reflection ---
        reg('reflectionEnabled', {
            category: 'reflection', type: 'boolean', default: true,
            description: 'Enable planar water reflections',
            shortLabel: 'Enabled',
            rebuildCategory: true,
            apply: (v) => {
                const wm = _getWaterMesh();
                if (wm && wm.material && wm.material.uniforms) {
                    wm.material.uniforms.uReflectionEnabled.value = v ? 1.0 : 0.0;
                }
            }
        });
        reg('reflectionResolution', {
            category: 'reflection', type: 'number', default: 512, min: 128, max: 2048, step: 128,
            description: 'Reflection texture resolution',
            shortLabel: 'Resolution',
            showIf: { param: 'reflectionEnabled', value: true }
        });
        reg('reflectionFresnel', {
            category: 'reflection', type: 'number', default: 1.0, min: 0.0, max: 2.0, step: 0.1,
            description: 'Fresnel blend strength',
            shortLabel: 'Fresnel',
            showIf: { param: 'reflectionEnabled', value: true },
            apply: (v) => {
                // Handled in shader uniform if we add one; placeholder for now
            }
        });
        reg('reflectionDebug', {
            category: 'reflection', type: 'boolean', default: true,
            description: 'Show reflection debug preview canvas',
            shortLabel: 'Debug preview',
            showIf: { param: 'reflectionEnabled', value: true },
            apply: (v) => {
                const game = window.game;
                if (game && game.waterReflectionManager) {
                    game.waterReflectionManager.setDebugVisible(v);
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

        // --- Distances (relative multipliers) ---
        reg('distanceFogScale', {
            category: 'distances', type: 'number', default: 1.0, min: 0.5, max: 2.0, step: 0.05,
            description: 'Fog distance multiplier',
            shortLabel: 'Fog Scale',
            apply: (v) => {
                const dm = window.game && window.game.distanceManager;
                if (dm) dm.setUserMultiplier('fog', v);
            }
        });
        reg('distanceTreeScale', {
            category: 'distances', type: 'number', default: 1.0, min: 0.5, max: 2.0, step: 0.05,
            description: 'Tree draw distance multiplier',
            shortLabel: 'Tree Scale',
            apply: (v) => {
                const dm = window.game && window.game.distanceManager;
                if (dm) dm.setUserMultiplier('tree', v);
            }
        });
        reg('distanceLODScale', {
            category: 'distances', type: 'number', default: 1.0, min: 0.5, max: 2.0, step: 0.05,
            description: 'Terrain LOD distance multiplier',
            shortLabel: 'LOD Scale',
            apply: (v) => {
                const dm = window.game && window.game.distanceManager;
                if (dm) dm.setUserMultiplier('lod', v);
            }
        });

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
                tbs.deformStartHeight = v;
                if (typeof tbs.setDeformStartHeight === 'function') {
                    tbs.setDeformStartHeight(v);
                } else if (tbs.shaderMaterial?.uniforms?.uDeformStartHeight) {
                    tbs.shaderMaterial.uniforms.uDeformStartHeight.value = v;
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
                tbs.deformEndHeight = v;
                if (typeof tbs.setDeformEndHeight === 'function') {
                    tbs.setDeformEndHeight(v);
                } else if (tbs.shaderMaterial?.uniforms?.uDeformEndHeight) {
                    tbs.shaderMaterial.uniforms.uDeformEndHeight.value = v;
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
                if (sys.textureBlendingSystem) {
                    sys.textureBlendingSystem.debugForceSpherical = v;
                    if (sys.textureBlendingSystem.shaderMaterial) {
                        sys.textureBlendingSystem.shaderMaterial.uniforms.uDebugForceSpherical.value = v ? 1.0 : 0.0;
                    }
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
        // --- Spotlight ---
        reg('spotlightEnabled', {
            category: 'spotlight', type: 'boolean', default: true,
            description: 'Enable mouse spotlight',
            shortLabel: 'Enabled',
            apply: (v) => { const g = window.game; if (g && g.spotLight) g.spotLight.visible = v; }
        });
        reg('spotlightType', {
            category: 'spotlight', type: 'select', default: 'SpotLight',
            description: 'Mouse light type',
            options: [
                { value: 'SpotLight', label: 'Spot' },
                { value: 'PointLight', label: 'Point' },
                { value: 'DirectionalLight', label: 'Directional' }
            ],
            apply: (v) => { const g = window.game; if (g && g.recreateMouseLight) g.recreateMouseLight(v); }
        });
        reg('spotlightHeight', {
            category: 'spotlight', type: 'number', default: 25, min: 5, max: 100, step: 1,
            description: 'Height above mouse position',
            apply: (v) => { const g = window.game; if (g && g.spotLight) g.spotLight.position.y = v; }
        });
        reg('spotlightIntensity', {
            category: 'spotlight', type: 'number', default: 0.4, min: 0, max: 5, step: 0.05,
            description: 'Mouse light brightness',
            apply: (v) => { const g = window.game; if (g && g.spotLight) g.spotLight.intensity = v; }
        });
        reg('spotlightAngle', {
            category: 'spotlight', type: 'number', default: 0.19635, min: 0.05, max: 1.5708, step: 0.05,
            description: 'Spotlight cone angle (radians)',
            apply: (v) => { const g = window.game; if (g && g.spotLight && g.spotLight.angle !== undefined) g.spotLight.angle = v; }
        });
        reg('spotlightColor', {
            category: 'spotlight', type: 'color', default: '#ffffff',
            description: 'Mouse light color',
            apply: (v) => { const g = window.game; if (g && g.spotLight) g.spotLight.color.set(v); },
            colorGate: () => { const g = window.game; return g && g.spotLight && g.spotLight.color; }
        });
        reg('spotlightHelper', {
            category: 'spotlight', type: 'boolean', default: false,
            description: 'Show light cone helper',
            apply: (v) => { const g = window.game; if (g && g.spotLightHelper) g.spotLightHelper.visible = v; }
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
                const rad = v * (Math.PI / 180);
                if (sys._wind) {
                    sys._wind.targetRad = rad;
                    sys._wind.currentRad = rad;
                }
                const game = window.game;
                if (game && game.decorativeVisuals) {
                    game.decorativeVisuals.windTargetAngle = rad;
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

            // Internal wind state is updated above; decorativeVisuals reads getWindDirection() as fallback
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
        reg('fogGradientEnabled', {
            category: 'environment', type: 'boolean', default: false,
            description: 'Enable enhanced fog gradient (custom falloff curve)',
            shortLabel: 'Fog Gradient',
            rebuildCategory: true
        });
        reg('fogGradientExponent', {
            category: 'environment', type: 'number', default: 2.0, min: 0.5, max: 5.0, step: 0.1,
            description: 'Fog falloff curve exponent (1=linear, >1=exponential)',
            shortLabel: 'Fog Exp',
            showIf: { param: 'fogGradientEnabled', value: true }
        });
        reg('fogGradientBias', {
            category: 'environment', type: 'number', default: 0.0, min: -0.5, max: 0.5, step: 0.05,
            description: 'Fog distance bias (-0.5=nearer, 0.5=farther)',
            shortLabel: 'Fog Bias',
            showIf: { param: 'fogGradientEnabled', value: true }
        });
        reg('fogDensity', {
            category: 'environment', type: 'number', default: 1.0, min: 0.1, max: 3.0, step: 0.1,
            description: 'Global fog density multiplier',
            shortLabel: 'Fog Density'
        });
        reg('fogColorBandCount', {
            category: 'environment', type: 'number', default: 2, min: 2, max: 5, step: 1,
            description: 'Number of fog gradient color bands',
            shortLabel: 'Color Bands',
            showIf: { param: 'fogGradientEnabled', value: true }
        });
        const fogColorApply = (index) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs?.shaderMaterial?.uniforms?.uFogColors?.value?.[index]) {
                tbs.shaderMaterial.uniforms.uFogColors.value[index].set(v);
            }
        };
        const fogStopApply = (index) => (v, sys) => {
            const tbs = sys.textureBlendingSystem;
            if (tbs?.shaderMaterial?.uniforms?.uFogStops?.value?.[index] !== undefined) {
                tbs.shaderMaterial.uniforms.uFogStops.value[index] = v;
            }
        };
        reg('fogColor1', {
            category: 'environment', type: 'color', default: '#808080',
            description: 'Fog color at near distance (band 1)',
            shortLabel: 'Near Color',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogColorApply(0)
        });
        reg('fogColorStop1', {
            category: 'environment', type: 'number', default: 0.0, min: 0.0, max: 1.0, step: 0.01,
            description: 'Normalized stop position for near color',
            shortLabel: 'Near Stop',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogStopApply(0)
        });
        reg('fogColor2', {
            category: 'environment', type: 'color', default: '#606060',
            description: 'Fog color band 2',
            shortLabel: 'Color 2',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogColorApply(1)
        });
        reg('fogColorStop2', {
            category: 'environment', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.01,
            description: 'Normalized stop position for color band 2',
            shortLabel: 'Stop 2',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogStopApply(1)
        });
        reg('fogColor3', {
            category: 'environment', type: 'color', default: '#404040',
            description: 'Fog color band 3',
            shortLabel: 'Color 3',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogColorApply(2)
        });
        reg('fogColorStop3', {
            category: 'environment', type: 'number', default: 0.66, min: 0.0, max: 1.0, step: 0.01,
            description: 'Normalized stop position for color band 3',
            shortLabel: 'Stop 3',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogStopApply(2)
        });
        reg('fogColor4', {
            category: 'environment', type: 'color', default: '#303030',
            description: 'Fog color band 4',
            shortLabel: 'Color 4',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogColorApply(3)
        });
        reg('fogColorStop4', {
            category: 'environment', type: 'number', default: 0.83, min: 0.0, max: 1.0, step: 0.01,
            description: 'Normalized stop position for color band 4',
            shortLabel: 'Stop 4',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogStopApply(3)
        });
        reg('fogColor5', {
            category: 'environment', type: 'color', default: '#202020',
            description: 'Fog color band 5 (far)',
            shortLabel: 'Color 5',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogColorApply(4)
        });
        reg('fogColorStop5', {
            category: 'environment', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.01,
            description: 'Normalized stop position for far color',
            shortLabel: 'Far Stop',
            showIf: { param: 'fogGradientEnabled', value: true },
            apply: fogStopApply(4)
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
            category: 'water', type: 'number', default: 0.5, min: 0.0, max: 5.0, step: 0.1,
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
            if (tbs) {
                if (uniformName === 'uCheckerFadeStrength') tbs.checkerFadeStrength = v;
                if (tbs.shaderMaterial && tbs.shaderMaterial.uniforms[uniformName]) {
                    tbs.shaderMaterial.uniforms[uniformName].value = v;
                }
            }
        };
        reg('checkerFadeStrength', {
            category: 'checkerboard', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.01,
            description: 'Checkerboard transparency fade strength (0 = full checkerboard, 1 = full biome)',
            shortLabel: 'Fade',
            apply: checkerboardUniformApply('uCheckerFadeStrength')
        });
        reg('checkerboardEnabled', {
            category: 'checkerboard', type: 'boolean', default: true,
            description: 'Enable checkerboard pattern (disabled = full biome texture)',
            shortLabel: 'Enabled',
            apply: (v, sys) => {
                const tbs = sys.textureBlendingSystem;
                if (tbs) {
                    tbs.checkerboardEnabled = v;
                    if (tbs.shaderMaterial && tbs.shaderMaterial.uniforms && tbs.shaderMaterial.uniforms.uCheckerboardEnabled) {
                        tbs.shaderMaterial.uniforms.uCheckerboardEnabled.value = v ? 1.0 : 0.0;
                    }
                }
            }
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

        // --- Flare / Lens Flare ---
        reg('flareEnabled', {
            category: 'flare', type: 'boolean', default: true,
            description: 'Enable sun lens flares',
            shortLabel: 'Enabled',
            apply: (v, sys) => {
                if (sys.sun && sys.sun.lensFlares) {
                    sys.sun.lensFlares.forEach(flare => { flare.visible = v; });
                }
            }
        });
        reg('flareOpacity', {
            category: 'flare', type: 'number', default: 0.5, min: 0.0, max: 2.0, step: 0.05,
            description: 'Lens flare opacity multiplier',
            shortLabel: 'Opacity',
            apply: (v, sys) => {
                if (sys.sun) sys.sun.flareOpacity = v;
            }
        });
        reg('flareSize', {
            category: 'flare', type: 'number', default: 1.0, min: 0.1, max: 3.0, step: 0.05,
            description: 'Lens flare size multiplier',
            shortLabel: 'Size',
            apply: (v, sys) => {
                if (sys.sun) {
                    const base = sys.sun.baseFlareSize || (sys.sun.orbitRadius * 0.045) || 90;
                    sys.sun.flareSize = base * v;
                    if (sys.sun.sprite) {
                        sys.sun.sprite.scale.set(sys.sun.flareSize * 2, sys.sun.flareSize * 2, 1);
                    }
                }
            }
        });
        reg('flareSpread', {
            category: 'flare', type: 'number', default: 1.0, min: 0.0, max: 3.0, step: 0.1,
            description: 'How far flares spread along the sun-camera axis',
            shortLabel: 'Spread',
        });

        // --- Minimap ---
        reg('minimapEdgeFade', {
            category: 'minimap', type: 'boolean', default: true,
            description: 'Fade minimap chunks at the edge of explored area',
            shortLabel: 'Edge Fade',
        });
        reg('minimapFadeDepth', {
            category: 'minimap', type: 'number', default: 3, min: 0, max: 8, step: 1,
            description: 'How many chunk rings deep the edge fade goes (0 = no fade)',
            shortLabel: 'Fade Depth',
        });
        reg('minimapCircularMask', {
            category: 'minimap', type: 'boolean', default: true,
            description: 'Apply circular soft-edge mask to the whole minimap',
            shortLabel: 'Circular Mask',
        });
        reg('minimapMaskStart', {
            category: 'minimap', type: 'number', default: 0.38, min: 0.0, max: 0.48, step: 0.01,
            description: 'Where the circular mask fade begins (fraction of radius)',
            shortLabel: 'Mask Start',
        });
        reg('minimapContourFade', {
            category: 'minimap', type: 'boolean', default: false,
            description: 'Fade only chunks at the actual boundary of explored area',
            shortLabel: 'Contour Fade',
        });
        reg('minimapContourOpacity', {
            category: 'minimap', type: 'number', default: 0.35, min: 0.0, max: 1.0, step: 0.05,
            description: 'Opacity of chunks on the very edge (interior is always 1.0)',
            shortLabel: 'Edge Opacity',
        });
        reg('minimapUpdateInterval', {
            category: 'minimap', type: 'number', default: 180, min: 16, max: 1000, step: 16,
            description: 'Minimap redraw throttle interval in ms (lower = faster updates)',
            shortLabel: 'Draw Speed',
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
            description: 'Tree sway multiplier',
            shortLabel: 'Sway',
            apply: (v) => {
                const htm = window.game && window.game.hybridTreeManager;
                if (!htm) return;
                let setCount = 0;
                const systems = [htm.terrainTreeSystem, htm.growingTreeSystem, htm.poplarTreeSystem, htm.cherryTreeSystem, htm.billboardTreeSystem];
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
                const systems = [htm.terrainTreeSystem, htm.growingTreeSystem, htm.poplarTreeSystem, htm.cherryTreeSystem, htm.billboardTreeSystem];
                systems.forEach(sys => {
                    if (sys && typeof sys.setGlobalTreeSizeMult === 'function') {
                        sys.setGlobalTreeSizeMult(v);
                    }
                });
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
        reg('maxCameraHeight', {
            category: 'camera', type: 'number', default: 45, min: 20, max: 300, step: 1,
            description: 'Maximum camera zoom distance (orbit radius)',
            shortLabel: 'Max Height',
            apply: (v) => {
                const cc = window.game && window.game.cameraController;
                if (cc) {
                    cc.maxOrbitDistance = v;
                    if (cc.orbitDistance > v) cc.orbitDistance = v;
                }
            }
        });
        reg('isometricMode', {
            category: 'camera', type: 'boolean', default: false,
            description: 'Enable isometric camera mode',
            shortLabel: 'Isometric',
            apply: (v) => {
                const game = window.game;
                if (game && game.cameraController) {
                    if (v) {
                        game.cameraController.setMode('isometric');
                    } else {
                        game.cameraController.setMode('tactical');
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
        reg('skyTransparency', {
            category: 'sky', type: 'number', default: 1.0, min: 0.0, max: 1.0, step: 0.05,
            description: 'Atmospheric sky transparency (0 = orbit/space, 1 = full atmosphere)',
            shortLabel: 'Transparency',
            apply: (v, sys) => {
                if (sys.skyShaderSystem) sys.skyShaderSystem.setSkyTransparency(v);
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

        // --- Jesus Summon ---
        reg('jesusLift', {
            category: 'jesus', type: 'number', default: 4, min: 1, max: 20, step: 0.5,
            description: 'Target lift height for Jesus summon hill',
            shortLabel: 'Lift',
            apply: (v) => {
                if (window.jesusSummonSystem && typeof window.jesusSummonSystem.setTargetLift === 'function') {
                    window.jesusSummonSystem.setTargetLift(v);
                }
            }
        });

        // --- Piece Model Overrides ---
        reg('pieceModelOverrides', {
            category: 'models', type: 'object', default: {}, persist: true,
            description: 'GLB model overrides for chess pieces',
            apply: (v) => {
                if (window.game && window.game.piecesSystem) {
                    window.game.piecesSystem.glbModelCache.clear();
                }
            }
        });

        // --- Navi Cursor ---
        reg('cursorEnabled', {
            category: 'cursor', type: 'boolean', default: true,
            description: 'Enable custom Navi cursor',
            shortLabel: 'Enabled',
            apply: (v) => {
                const cursorEl = document.getElementById('naviCursor');
                const body = document.body;
                if (cursorEl && body) {
                    if (v) {
                        body.classList.add('navi-cursor-active');
                    } else {
                        body.classList.remove('navi-cursor-active');
                    }
                }
            }
        });
        reg('cursorSize', {
            category: 'cursor', type: 'number', default: 42, min: 1, max: 80, step: 2,
            description: 'Cursor overall size (pixels)',
            shortLabel: 'Size',
            apply: (v) => {
                if (window.__naviCursor) {
                    window.__naviCursor.baseSize = v;
                }
            }
        });
        reg('cursorWingWidth', {
            category: 'cursor', type: 'number', default: 14, min: 5, max: 40, step: 1,
            description: 'Wing width (pixels)',
            shortLabel: 'Wing Width',
            apply: (v) => {
                const wings = document.querySelectorAll('.navi-cursor-wing');
                wings.forEach(wing => {
                    wing.style.width = `${v}px`;
                });
            }
        });
        reg('cursorWingHeight', {
            category: 'cursor', type: 'number', default: 32, min: 15, max: 80, step: 2,
            description: 'Wing height (pixels)',
            shortLabel: 'Wing Height',
            apply: (v) => {
                const wings = document.querySelectorAll('.navi-cursor-wing');
                wings.forEach(wing => {
                    wing.style.height = `${v}px`;
                });
            }
        });
        reg('cursorWingOffset', {
            category: 'cursor', type: 'number', default: -6, min: -20, max: 0, step: 1,
            description: 'Wing vertical offset (pixels)',
            shortLabel: 'Wing Offset',
            apply: (v) => {
                const wings = document.querySelectorAll('.navi-cursor-wing');
                wings.forEach(wing => {
                    wing.style.top = `${v}px`;
                });
            }
        });
        reg('cursorWingAngle', {
            category: 'cursor', type: 'number', default: 30, min: 10, max: 60, step: 1,
            description: 'Wing spread angle (degrees)',
            shortLabel: 'Wing Angle',
            apply: (v) => {
                const leftWing = document.querySelector('.navi-cursor-wing.is-left');
                const rightWing = document.querySelector('.navi-cursor-wing.is-right');
                if (leftWing) leftWing.style.transform = `rotate(-${v}deg)`;
                if (rightWing) rightWing.style.transform = `rotate(${v}deg)`;
            }
        });
        reg('cursorCoreColorInner', {
            category: 'cursor', type: 'color', default: '#ffffff',
            description: 'Core inner color',
            shortLabel: 'Core Inner',
            apply: (v) => {
                const core = document.querySelector('.navi-cursor-core');
                if (core) {
                    core.style.background = `radial-gradient(circle at 45% 40%, ${v} 0%, rgba(213, 255, 255, 0.95) 25%, rgba(146, 224, 255, 0.8) 55%, rgba(94, 178, 255, 0.45) 80%, rgba(94, 178, 255, 0) 100%)`;
                }
            }
        });
        reg('cursorCoreColorOuter', {
            category: 'cursor', type: 'color', default: '#5eb2ff',
            description: 'Core outer glow color',
            shortLabel: 'Core Outer',
            apply: (v) => {
                const core = document.querySelector('.navi-cursor-core');
                if (core) {
                    core.style.boxShadow = `0 0 18px ${v}`;
                }
            }
        });
        reg('cursorWingColor', {
            category: 'cursor', type: 'color', default: '#cef8ff',
            description: 'Wing color',
            shortLabel: 'Wing Color',
            apply: (v) => {
                const wings = document.querySelectorAll('.navi-cursor-wing');
                wings.forEach(wing => {
                    wing.style.background = `radial-gradient(ellipse at 50% 15%, ${v}, ${v}00)`;
                });
            }
        });
        reg('cursorTrailColor', {
            category: 'cursor', type: 'color', default: '#82e1ff',
            description: 'Trail color',
            shortLabel: 'Trail Color',
            apply: (v) => {
                const trail = document.querySelector('.navi-cursor-trail');
                if (trail) {
                    trail.style.background = `radial-gradient(ellipse at 100% 50%, ${v}, ${v}00)`;
                }
            }
        });
        reg('cursorGlowColor', {
            category: 'cursor', type: 'color', default: '#78ffff',
            description: 'Cursor glow color',
            shortLabel: 'Glow Color',
            apply: (v) => {
                const cursorEl = document.getElementById('naviCursor');
                if (cursorEl) {
                    cursorEl.style.filter = `drop-shadow(0 0 8px ${v}cc) drop-shadow(0 0 20px ${v}99)`;
                }
            }
        });
        reg('cursorPulseSpeed', {
            category: 'cursor', type: 'number', default: 2, min: 0.5, max: 5, step: 0.1,
            description: 'Pulse animation speed (seconds)',
            shortLabel: 'Pulse Speed',
            apply: (v) => {
                const core = document.querySelector('.navi-cursor-core');
                if (core) {
                    core.style.animationDuration = `${v}s`;
                }
            }
        });
        reg('cursorDistanceScale', {
            category: 'cursor', type: 'boolean', default: true,
            description: 'Scale cursor size based on camera height',
            shortLabel: 'Distance Scale'
        });
        reg('cursorDistanceNear', {
            category: 'cursor', type: 'number', default: 12, min: 1, max: 100, step: 1,
            description: 'Camera orbit distance where cursor stays full size',
            shortLabel: 'Near Height'
        });
        reg('cursorDistanceFar', {
            category: 'cursor', type: 'number', default: 100, min: 10, max: 500, step: 5,
            description: 'Camera orbit distance where cursor reaches min scale',
            shortLabel: 'Far Height'
        });
        reg('cursorDistanceMinScale', {
            category: 'cursor', type: 'number', default: 0.3, min: 0.01, max: 1.0, step: 0.05,
            description: 'Cursor scale multiplier at far distance',
            shortLabel: 'Min Scale'
        });
        reg('cursorTrailScaleX', {
            category: 'cursor', type: 'number', default: 1.25, min: 0, max: 3, step: 0.05,
            description: 'Trail max X stretch multiplier',
            shortLabel: 'Trail Scale X'
        });
        reg('cursorTrailScaleY', {
            category: 'cursor', type: 'number', default: 0.7, min: 0, max: 3, step: 0.05,
            description: 'Trail max Y stretch multiplier',
            shortLabel: 'Trail Scale Y'
        });
        reg('cursorTrailOpacity', {
            category: 'cursor', type: 'number', default: 1.0, min: 0, max: 2.0, step: 0.05,
            description: 'Trail opacity multiplier',
            shortLabel: 'Trail Opacity'
        });
        reg('cursorSpeedSize', {
            category: 'cursor', type: 'number', default: 0.8, min: 0, max: 2.0, step: 0.05,
            description: 'Cursor size boost from speed (0 = no boost)',
            shortLabel: 'Size Over Speed'
        });
        reg('cursorWingSpeedScale', {
            category: 'cursor', type: 'boolean', default: true,
            description: 'Shrink wings when stationary and expand with speed',
            shortLabel: 'Wing Speed Scale'
        });
        reg('cursorWingScaleMult', {
            category: 'cursor', type: 'number', default: 1.5, min: 0, max: 3.0, step: 0.05,
            description: 'Max wing scale at full speed',
            shortLabel: 'Wing Scale'
        });
        reg('cursorWingOpacityMult', {
            category: 'cursor', type: 'number', default: 1.0, min: 0, max: 2.0, step: 0.05,
            description: 'Wing opacity multiplier',
            shortLabel: 'Wing Opacity'
        });
        reg('cursorGrabDisableSpeedScale', {
            category: 'cursor', type: 'boolean', default: true,
            description: 'Disable cursor speed-scale growth while left-click dragging',
            shortLabel: 'Grab: No Speed Scale'
        });
        reg('cursorGrabSlowFactor', {
            category: 'cursor', type: 'number', default: 1.0, min: 0.1, max: 1.0, step: 0.05,
            description: 'Camera pan speed multiplier while left-click dragging (lower = heavier feel)',
            shortLabel: 'Grab: Pan Slowdown'
        });
        reg('cursorGrabBuzzIntensity', {
            category: 'cursor', type: 'number', default: 1.6, min: 0.5, max: 3.0, step: 0.1,
            description: 'Buzz volume/intensity multiplier while dragging (effort sound)',
            shortLabel: 'Grab: Buzz Effort'
        });
        reg('cursorBuzzVolume', {
            category: 'cursor', type: 'number', default: 0.12, min: 0, max: 1.0, step: 0.01,
            description: 'Base volume of the cursor buzz sound',
            shortLabel: 'Buzz Volume'
        });
        reg('cursorBuzzFadeNear', {
            category: 'cursor', type: 'number', default: 10, min: 0, max: 50, step: 1,
            description: 'Camera distance where buzz volume fade begins',
            shortLabel: 'Buzz Fade Near'
        });
        reg('cursorBuzzFadeFar', {
            category: 'cursor', type: 'number', default: 40, min: 10, max: 200, step: 5,
            description: 'Camera distance where buzz reaches minimum volume',
            shortLabel: 'Buzz Fade Far'
        });
        reg('cursorDragSpeedCap', {
            category: 'cursor', type: 'number', default: 0.04, min: 0.01, max: 0.20, step: 0.01,
            description: 'Maximum right-click drag pan speed (hard cap)',
            shortLabel: 'Drag Speed Cap'
        });
        reg('cursorDragCutoffDistance', {
            category: 'cursor', type: 'number', default: 60, min: 10, max: 300, step: 5,
            description: 'Maximum world distance the camera can pan during a right-click drag',
            shortLabel: 'Drag Cutoff'
        });
        reg('cursorDragMomentum', {
            category: 'cursor', type: 'number', default: 0, min: 0, max: 1.0, step: 0.05,
            description: 'Camera coasting momentum after releasing a right-click drag (0 = no coasting)',
            shortLabel: 'Drag Momentum'
        });
        reg('cursorIdleRadius', {
            category: 'cursor', type: 'number', default: 18, min: 0, max: 60, step: 1,
            description: 'Max orbit radius of idle local-space hover (px)',
            shortLabel: 'Idle Radius'
        });
        reg('cursorIdleSpeed', {
            category: 'cursor', type: 'number', default: 1.0, min: 0, max: 5, step: 0.1,
            description: 'Speed multiplier for idle spherical flight',
            shortLabel: 'Idle Speed'
        });

        // --- Drowning Animation Timers ---
        reg('cursorDrownSubmergeMs', {
            category: 'cursor', type: 'number', default: 400, min: 100, max: 2000, step: 50,
            description: 'Drowning: time to dip under water (ms)',
            shortLabel: 'Submerge (ms)'
        });
        reg('cursorDrownUnderwaterMs', {
            category: 'cursor', type: 'number', default: 600, min: 100, max: 3000, step: 50,
            description: 'Drowning: pause underwater before emerging (ms)',
            shortLabel: 'Underwater (ms)'
        });
        reg('cursorDrownEmergeMs', {
            category: 'cursor', type: 'number', default: 500, min: 100, max: 2000, step: 50,
            description: 'Drowning: time to rise back to surface (ms)',
            shortLabel: 'Emerge (ms)'
        });
        reg('cursorDrownFlyUpMs', {
            category: 'cursor', type: 'number', default: 800, min: 100, max: 3000, step: 50,
            description: 'Drowning: time to fly up above water (ms)',
            shortLabel: 'Fly Up (ms)'
        });
        reg('cursorDrownShakeMs', {
            category: 'cursor', type: 'number', default: 1200, min: 200, max: 4000, step: 100,
            description: 'Drowning: wet-dog shake duration (ms)',
            shortLabel: 'Shake (ms)'
        });
        reg('cursorDrownHarumphMs', {
            category: 'cursor', type: 'number', default: 400, min: 100, max: 2000, step: 50,
            description: 'Drowning: harumph TTS pause before ending (ms)',
            shortLabel: 'Harumph (ms)'
        });
        reg('cursorDrownShakeAmplitude', {
            category: 'cursor', type: 'number', default: 12, min: 2, max: 40, step: 1,
            description: 'Drowning: max shake horizontal displacement (px)',
            shortLabel: 'Shake Amp'
        });
        reg('cursorDrownShakeCycles', {
            category: 'cursor', type: 'number', default: 4, min: 1, max: 12, step: 1,
            description: 'Drowning: number of wet-dog shake cycles',
            shortLabel: 'Shake Cycles'
        });
        reg('cursorDrownSubmergeDepth', {
            category: 'cursor', type: 'number', default: 40, min: 10, max: 100, step: 5,
            description: 'Drowning: how far the sprite dips (px)',
            shortLabel: 'Dip Depth'
        });
        reg('cursorDrownFlyHeight', {
            category: 'cursor', type: 'number', default: 25, min: 5, max: 80, step: 5,
            description: 'Drowning: how high the sprite flies above water (px)',
            shortLabel: 'Fly Height'
        });

        // --- Underwater State Visuals ---
        reg('cursorSubmergedOpacity', {
            category: 'cursor', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05,
            description: 'Underwater: cursor opacity while submerged',
            shortLabel: 'Sub Opacity',
            apply: (v) => {
                const el = document.getElementById('naviCursor');
                if (el) el.style.setProperty('--cursor-submerged-opacity', v);
            }
        });
        reg('cursorSubmergedBrightness', {
            category: 'cursor', type: 'number', default: 0.55, min: 0.1, max: 1.5, step: 0.05,
            description: 'Underwater: brightness filter while submerged',
            shortLabel: 'Sub Brightness',
            apply: (v) => {
                const el = document.getElementById('naviCursor');
                if (el) el.style.setProperty('--cursor-submerged-brightness', v);
            }
        });
        reg('cursorSubmergedSepia', {
            category: 'cursor', type: 'number', default: 0.45, min: 0, max: 1, step: 0.05,
            description: 'Underwater: sepia filter while submerged',
            shortLabel: 'Sub Sepia',
            apply: (v) => {
                const el = document.getElementById('naviCursor');
                if (el) el.style.setProperty('--cursor-submerged-sepia', v);
            }
        });
        reg('cursorSubmergedHue', {
            category: 'cursor', type: 'number', default: 155, min: 0, max: 360, step: 5,
            description: 'Underwater: hue-rotate angle while submerged (deg)',
            shortLabel: 'Sub Hue',
            apply: (v) => {
                const el = document.getElementById('naviCursor');
                if (el) el.style.setProperty('--cursor-submerged-hue', v + 'deg');
            }
        });
        reg('cursorSubmergedSat', {
            category: 'cursor', type: 'number', default: 1.7, min: 0, max: 4, step: 0.1,
            description: 'Underwater: saturation multiplier while submerged',
            shortLabel: 'Sub Saturation',
            apply: (v) => {
                const el = document.getElementById('naviCursor');
                if (el) el.style.setProperty('--cursor-submerged-sat', v);
            }
        });
        reg('cursorSubmergedBlur', {
            category: 'cursor', type: 'number', default: 0.6, min: 0, max: 4, step: 0.1,
            description: 'Underwater: blur amount while submerged (px)',
            shortLabel: 'Sub Blur',
            apply: (v) => {
                const el = document.getElementById('naviCursor');
                if (el) el.style.setProperty('--cursor-submerged-blur', v + 'px');
            }
        });
        reg('cursorSubmergedOverlay', {
            category: 'cursor', type: 'number', default: 1, min: 0, max: 1, step: 0.05,
            description: 'Underwater: blue water overlay opacity while submerged',
            shortLabel: 'Sub Overlay',
            apply: (v) => {
                const el = document.getElementById('naviCursor');
                if (el) el.style.setProperty('--cursor-submerged-overlay', v);
            }
        });
        reg('cursorUnderwaterSpeed', {
            category: 'cursor', type: 'number', default: 0.02, min: 0.005, max: 0.5, step: 0.005,
            description: 'Underwater: cursor follow speed (lower = heavier feel)',
            shortLabel: 'Underwater Speed'
        });

        // --- Weather (Minimap Overlay) ---
        reg('weatherFrontThreshold', {
            category: 'weather', type: 'number', default: 55, min: 20, max: 200, step: 5,
            description: 'Distance (world units) at which opposite pressure agents deform rings and show front symbols',
            shortLabel: 'Front Threshold'
        });
        reg('weatherSymbolCutoff', {
            category: 'weather', type: 'number', default: 0.8, min: 0.0, max: 1.0, step: 0.05,
            description: 'Multiplier for symbol visibility gate (lower = symbols stay visible from further away)',
            shortLabel: 'Symbol Cutoff'
        });
        reg('weatherRingScale', {
            category: 'weather', type: 'number', default: 3.5, min: 1.0, max: 8.0, step: 0.5,
            description: 'Visual scale multiplier for isobar ring radii on the minimap',
            shortLabel: 'Ring Scale'
        });
        reg('weatherSpawnRadius', {
            category: 'weather', type: 'number', default: 80, min: 10, max: 300, step: 5,
            description: 'Radius (world units) for debug weather agent spawning around player',
            shortLabel: 'Spawn Radius'
        });
        reg('weatherSpawnCount', {
            category: 'weather', type: 'number', default: 8, min: 1, max: 30, step: 1,
            description: 'Number of agents to spawn per debug spawn click',
            shortLabel: 'Spawn Count'
        });
        reg('climateAgentCount', {
            category: 'weather', type: 'number', default: 200, min: 0, max: 500, step: 10,
            description: 'Target number of climate agents in the environmental simulation',
            shortLabel: 'Agent Count',
            apply: (value) => {
                fetch('/api/environment/agent-count', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ count: value })
                }).catch(() => {});
            }
        });
        reg('weatherMoveScale', {
            category: 'weather', type: 'number', default: 1.0, min: 0.25, max: 4.0, step: 0.25,
            description: 'Multiplier for agent movement range. Higher = larger weather patterns',
            shortLabel: 'Move Scale',
            apply: (value) => {
                fetch('/api/environment/move-scale', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scale: value })
                }).catch(() => {});
            }
        });
        reg('weatherSampleCount', {
            category: 'weather', type: 'number', default: 6, min: 2, max: 12, step: 1,
            description: 'Number of squares sampled per agent move. Lower = more directed movement',
            shortLabel: 'Sample Count',
            apply: (value) => {
                fetch('/api/environment/sample-count', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ count: value })
                }).catch(() => {});
            }
        });

        // --- Fog Plane (rolling quad with procedural animated splatter texture) ---
        const fogPlaneApply = () => (v, sys) => {
            if (window.game && window.game.fogPlaneSystem) {
                window.game.fogPlaneSystem.updateParameters();
            }
        };
        reg('fogPlaneEnabled', {
            category: 'environment', type: 'boolean', default: false,
            description: 'Enable fog plane',
            shortLabel: 'Fog Plane',
            rebuildCategory: true,
            apply: fogPlaneApply()
        });
        reg('fogPlaneHeight', {
            category: 'environment', type: 'number', default: 0.5, min: -2, max: 10, step: 0.1,
            description: 'Fog plane height above water',
            shortLabel: 'Height',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneRadius', {
            category: 'environment', type: 'number', default: 80, min: 10, max: 300, step: 5,
            description: 'Fog plane outer circular mask radius',
            shortLabel: 'Radius',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneInnerRadius', {
            category: 'environment', type: 'number', default: 60, min: 5, max: 280, step: 5,
            description: 'Fog plane inner radius where circular fade begins',
            shortLabel: 'Inner Radius',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneNearDist', {
            category: 'environment', type: 'number', default: 10, min: 1, max: 100, step: 1,
            description: 'Near distance for alpha ramp (transparent)',
            shortLabel: 'Near Dist',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneFarDist', {
            category: 'environment', type: 'number', default: 50, min: 5, max: 200, step: 1,
            description: 'Far distance for alpha ramp (opaque)',
            shortLabel: 'Far Dist',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneDistTransparency', {
            category: 'environment', type: 'number', default: 1.0, min: 0, max: 1, step: 0.01,
            description: 'Distance transparency strength (0 = uniform opacity, 1 = full near-far fade)',
            shortLabel: 'Dist Fade',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneDensity', {
            category: 'environment', type: 'number', default: 1.0, min: 0, max: 3, step: 0.05,
            description: 'Overall fog density multiplier',
            shortLabel: 'Density',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneWindFade', {
            category: 'environment', type: 'number', default: 0.5, min: 0, max: 2, step: 0.05,
            description: 'How much wind blows fog away',
            shortLabel: 'Wind Fade',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneNoiseScale', {
            category: 'environment', type: 'number', default: 0.05, min: 0.001, max: 0.5, step: 0.001,
            description: 'Noise UV scale for fog splatter pattern',
            shortLabel: 'Noise Scale',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneSpeed', {
            category: 'environment', type: 'number', default: 0.3, min: 0, max: 3, step: 0.05,
            description: 'Fog animation speed',
            shortLabel: 'Anim Speed',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneColor', {
            category: 'environment', type: 'color', default: '#cccccc',
            description: 'Fog color',
            shortLabel: 'Color',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
        });
        reg('fogPlaneDiurnalAmp', {
            category: 'environment', type: 'number', default: 0.15, min: 0, max: 0.5, step: 0.01,
            description: 'Diurnal temperature amplitude (±range)',
            shortLabel: 'Diurnal Amp',
            showIf: { param: 'fogPlaneEnabled', value: true },
            apply: fogPlaneApply()
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
            if (this._debug) console.log(`[ParameterSystem] _apply("${name}") calling apply() with value=`, p.value);
            try {
                p.apply(p.value, sys);
                if (this._debug) console.log(`[ParameterSystem] _apply("${name}") apply() succeeded`);
            } catch (e) {
                console.warn(`[ParameterSystem] apply ${name} failed:`, e);
            }
        } else {
            if (this._debug) console.log(`[ParameterSystem] _apply("${name}") has no apply callback`);
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

    _queueOrbitHeightScaleSync() {
        if (this._orbitScaleSyncHandle) {
            clearTimeout(this._orbitScaleSyncHandle);
        }
        this._orbitScaleSyncHandle = setTimeout(() => {
            this._orbitScaleSyncHandle = null;
            this._syncOrbitHeightScales();
        }, 150);
    }

    _syncOrbitHeightScales() {
        const sunScale = this.getParameter('terrainSunOrbitScale');
        const moonScale = this.getParameter('terrainMoonOrbitScale');
        if (sunScale === undefined && moonScale === undefined) {
            return;
        }

        // Include the client's terrain ID so the server stores scales per-client
        const game = window.game;
        const clientId = (game && game.terrainSystem && game.terrainSystem.clientId) || null;

        fetch('/api/terrain/orbit-height-scale', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sunScale, moonScale, clientId })
        }).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        }).then(data => {
            console.log('[ParameterSystem] Orbit height scales synced to server:', data);
        }).catch(err => {
            console.warn('[ParameterSystem] Failed to sync orbit height scales:', err);
        });
    }

    async _loadSavedDefaults() {
        // 1. Try server-side /api/defaults first (secure, shared across sessions)
        if (this._debug) console.log('[ParameterSystem._loadSavedDefaults] Starting fetch of /api/defaults...');
        try {
            const response = await fetch('/api/defaults');
            if (this._debug) console.log(`[ParameterSystem._loadSavedDefaults] response.ok=${response.ok}, status=${response.status}`);
            if (response.ok) {
                const defaults = await response.json();
                const keys = Object.keys(defaults);
                if (this._debug) console.log(`[ParameterSystem._loadSavedDefaults] received keys:`, keys);
                if (keys.length > 0) {
                    if (this._debug) console.log(`[ParameterSystem._loadSavedDefaults] Applying ${keys.length} saved default(s):`, keys.join(', '));
                    await this._waitForSystems();
                    this._applySavedDefaults(defaults, 'server-defaults');
                    if (this._debug) console.log('[ParameterSystem._loadSavedDefaults] Saved defaults applied successfully');
                    return;
                }
                if (this._debug) console.log('[ParameterSystem._loadSavedDefaults] empty payload — falling back');
            } else {
                console.warn(`[ParameterSystem._loadSavedDefaults] HTTP ${response.status} — falling back`);
            }
        } catch (err) {
            console.warn('[ParameterSystem._loadSavedDefaults] Could not load server defaults:', err);
        }

        // 2. Fall back to client-side default ENV (legacy, set before server migration)
        const envRaw = localStorage.getItem('chesiopia-default-env');
        if (envRaw) {
            const envName = localStorage.getItem('chesiopia-default-env-name') || 'default-env';
            if (this._debug) console.log(`[ParameterSystem._loadSavedDefaults] Found localStorage default ENV: ${envName}`);
            try {
                const envData = JSON.parse(envRaw);
                await this._waitForSystems();
                this._applySavedDefaults(envData, 'default-env');
                if (this._debug) console.log('[ParameterSystem._loadSavedDefaults] Default ENV applied successfully');
            } catch (err) {
                console.warn('[ParameterSystem._loadSavedDefaults] Failed to apply default ENV:', err);
            }
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
                if (!this._warnedUnknowns.has(name)) {
                    this._warnedUnknowns.add(name);
                    console.warn(`[ParameterSystem._applySavedDefaults] Saved default for unknown parameter: ${name}`);
                }
                return;
            }

            if (p.persist === false) {
                if (this._debug) console.log(`[ParameterSystem._applySavedDefaults] Skipping non-persistent parameter: ${name}`);
                return;
            }

            // ENV files store full snapshot objects {value, defaultValue, ...}
            // Server /api/defaults stores raw values
            let raw = defaults[name];
            let saved = (raw && typeof raw === 'object' && 'value' in raw) ? raw.value : raw;
            if (this._debug) console.log(`[ParameterSystem._applySavedDefaults] ${name}: stored=${saved}, type=${typeof saved}, paramType=${p.type}`);

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
            if (this._debug) console.log(`[ParameterSystem._applySavedDefaults] ${name}: applying value=${value}`);
            this._apply(name, p, this._getSystem(), /*forceThroughGate=*/true);
            this._updateUI(name, value);
            if (this._debug) console.log(`[ParameterSystem._applySavedDefaults] ${name}: applied & UI updated`);
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

// Wind update loop — variable rate, default ~250ms, adjustable later
let _windUpdateIntervalMs = 250;
let _windTimeoutId = null;

const _windHook = () => {
    const ps = window.parameterSystem;
    if (ps && ps.updateWindDirection) {
        ps.updateWindDirection(_windUpdateIntervalMs / 1000);
    }
    _windTimeoutId = setTimeout(_windHook, _windUpdateIntervalMs);
};

// Defer start until parameterSystem exists; don't spin at 60fps unconditionally
const _waitForPs = () => {
    if (window.parameterSystem) {
        _windTimeoutId = setTimeout(_windHook, _windUpdateIntervalMs);
    } else {
        setTimeout(_waitForPs, 500);
    }
};
_waitForPs();

// Expose rate control for timed effects later
window.setWindUpdateRate = (ms) => { _windUpdateIntervalMs = ms; };
window.stopWindLoop = () => { if (_windTimeoutId) clearTimeout(_windTimeoutId); };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParameterSystem;
}
