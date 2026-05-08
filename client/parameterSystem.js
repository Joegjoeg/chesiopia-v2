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

        this._registerAll();
        console.log(`[ParameterSystem] Registered ${this.params.size} parameters`);

        this._waitForSystems().then(() => this._installAll());
        this._setupSocketListeners();
    }

    // ---------- Public API ----------

    setParameter(name, value, source = 'user') {
        const p = this.params.get(name);
        if (!p) {
            console.warn(`[ParameterSystem] Unknown parameter: ${name}`);
            return false;
        }

        value = this._coerce(p, value);
        if (value === undefined) return false;

        p.value = value;
        p.lastModified = Date.now();
        p.modifiedBy = source;
        if (source !== 'reset' && source !== 'init') {
            p.userOverridden = true;
        }

        const sys = this._getSystem();
        this._apply(name, p, sys, /*forceThroughGate=*/true);
        this._updateUI(name, value);
        this._emit(name, value, p);

        console.log(`[ParameterSystem] ${name} = ${value} (src=${source}, override=${p.userOverridden})`);
        return true;
    }

    getParameter(name) {
        const p = this.params.get(name);
        return p ? p.value : undefined;
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
            description: 'Water plane Y position',
            apply: (v, sys) => {
                if (sys._waterPlane) sys._waterPlane.position.y = v;
            },
            gate: { targetOf: sys => sys, prop: 'waterLevel' }
        });
        reg('beachWidth', {
            category: 'terrain', type: 'number', default: 4, min: 1, max: 20, step: 1,
            description: 'Beach tile width (regen required)',
            gate: { targetOf: sys => sys, prop: 'beachWidth' }
        });
        reg('chunkSize', {
            category: 'terrain', type: 'number', default: 16, min: 4, max: 32, step: 1,
            description: 'Chunk size (regen required, advisory)',
            gate: { targetOf: sys => sys, prop: 'chunkSize' }
        });
        reg('meshMultiplier', {
            category: 'terrain', type: 'number', default: 12, min: 4, max: 24, step: 1,
            description: 'Mesh density multiplier (regenerates board)',
            apply: (v, sys) => {
                if (sys.createBoard) sys.createBoard(0, 0, 3, v);
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
            category: 'planet', type: 'number', default: 1000, min: 100, max: 5000, step: 10,
            description: 'Planet sphere radius for deformation',
            apply: (v, sys) => {
                if (sys.planetMapping && sys.planetMapping.activePlanet) {
                    sys.planetMapping.activePlanet.sphereRadius = v;
                }
            }
        });
        reg('planetWrapRadius', {
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
            category: 'planet', type: 'number', default: 50, min: 10, max: 200, step: 1,
            description: 'Camera height where spherical deformation begins',
            apply: (v, sys) => {
                if (sys.textureBlendingSystem && sys.textureBlendingSystem.shaderMaterial) {
                    sys.textureBlendingSystem.shaderMaterial.uniforms.uDeformStartHeight.value = v;
                }
            }
        });
        reg('deformEndHeight', {
            category: 'planet', type: 'number', default: 300, min: 100, max: 1000, step: 1,
            description: 'Camera height where deformation is fully spherical',
            apply: (v, sys) => {
                if (sys.textureBlendingSystem && sys.textureBlendingSystem.shaderMaterial) {
                    sys.textureBlendingSystem.shaderMaterial.uniforms.uDeformEndHeight.value = v;
                }
            }
        });
        reg('enablePlanetWrap', {
            category: 'planet', type: 'boolean', default: true,
            description: 'Enable coordinate wrapping (planet mode)',
            apply: (v, sys) => {
                if (sys.planetMapping) {
                    sys.planetMapping.setEnabled(v);
                }
            }
        });

        // --- Lighting ---
        reg('sunIntensity', {
            category: 'lighting', type: 'number', default: 1.0, min: 0, max: 3, step: 0.05,
            description: 'Sun directional light base intensity',
            gate: { targetOf: sys => sys.sun && sys.sun.light, prop: 'intensity' }
        });
        reg('moonIntensity', {
            category: 'lighting', type: 'number', default: 0.5, min: 0, max: 3, step: 0.05,
            description: 'Moon directional light base intensity',
            gate: { targetOf: sys => sys.moon && sys.moon.light, prop: 'intensity' }
        });
        reg('ambientIntensity', {
            category: 'lighting', type: 'number', default: 0.3, min: 0, max: 2, step: 0.02,
            description: 'Ambient atmospheric light intensity',
            gate: { targetOf: sys => sys.ambientLight, prop: 'intensity' }
        });
        reg('sunColor', {
            category: 'lighting', type: 'color', default: '#ffffff',
            description: 'Sun color (override locks per-frame color)',
            apply: (v, sys) => { if (sys.sun && sys.sun.light) sys.sun.light.color.set(v); },
            colorGate: sys => sys.sun && sys.sun.light && sys.sun.light.color
        });
        reg('moonColor', {
            category: 'lighting', type: 'color', default: '#87ceeb',
            description: 'Moon color (override locks per-frame color)',
            apply: (v, sys) => { if (sys.moon && sys.moon.light) sys.moon.light.color.set(v); },
            colorGate: sys => sys.moon && sys.moon.light && sys.moon.light.color
        });
        reg('ambientColor', {
            category: 'lighting', type: 'color', default: '#8b5cf6',
            description: 'Ambient color (override locks per-frame color)',
            apply: (v, sys) => { if (sys.ambientLight) sys.ambientLight.color.set(v); },
            colorGate: sys => sys.ambientLight && sys.ambientLight.color
        });

        // --- Time ---
        reg('dayTime', {
            category: 'time', type: 'number', default: 12, min: 0, max: 24, step: 0.01,
            description: 'Time of day (hours). Locks sun to chosen time.',
            apply: (v, sys) => {
                const dayLenMs = sys.serverDayLength || 60000;
                sys.serverGameTime = (v / 24) * dayLenMs;
                sys.lastTimeSyncTimestamp = Date.now();
            }
        });
        reg('daySpeed', {
            category: 'time', type: 'number', default: 60, min: 3, max: 600, step: 1,
            description: 'Day length in seconds',
            apply: (v, sys) => { sys.serverDayLength = v * 1000; }
        });
        reg('yearTime', {
            category: 'time', type: 'number', default: 0, min: 0, max: 120, step: 0.1,
            description: 'Day of year (0-120)',
            apply: (v, sys) => {
                sys.serverGameTime = Math.floor(v) * (sys.serverDayLength || 60000) + (sys.serverGameTime % (sys.serverDayLength || 60000));
            }
        });

        // --- Environment ---
        reg('windSpeed', {
            category: 'environment', type: 'number', default: 1.0, min: 0, max: 50, step: 0.1,
            description: 'Wind speed (water / grass / decorative)',
            apply: (v, sys) => {
                if (sys._waterTextureData) sys._waterTextureData.windSpeed = v;
                const game = window.game;
                if (game && game.decorativeVisuals) game.decorativeVisuals.windSpeed = v;
                if (game && game.grassSystem) game.grassSystem.windSpeed = v;
            }
        });
        reg('windDirection', {
            category: 'environment', type: 'number', default: 0, min: 0, max: 360, step: 1,
            description: 'Wind direction target (degrees) - wind gradually turns to this',
            // Target is stored; systems access current direction via getWindDirection()
            apply: (v, sys) => {
                // Target stored; actual direction updated gradually in getWindDirection()
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
            const sys = this._getSystem();
            if (sys && sys._waterTextureData) {
                sys._waterTextureData.windDirection = this._wind.currentRad;
                if (sys.updateWaterTexture) sys.updateWaterTexture();
            }
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

        // --- Graphics ---
        reg('shadowMapSize', {
            category: 'graphics', type: 'number', default: 1024, min: 512, max: 4096, step: 512,
            description: 'Shadow map resolution (invalidates shadow map)',
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
            description: 'Shadow orthographic camera coverage',
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
    }

    // ---------- Gate installation ----------

    _getSystem() { return window.boardSystem; }

    _waitForSystems() {
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
        sys.updateServerGameTime = function (elapsed, dayLen) {
            const dt = ps.params.get('dayTime');
            const ds = ps.params.get('daySpeed');
            if (ds && ds.userOverridden) {
                // Preserve user day length; still stamp sync.
                sys.lastTimeSyncTimestamp = Date.now();
                if (dt && dt.userOverridden) {
                    // Lock time of day: re-anchor serverGameTime to user value each sync.
                    sys.serverGameTime = (dt.value / 24) * sys.serverDayLength;
                    return;
                }
                // Scale elapsed into user-chosen day length proportionally
                const referenceDay = dayLen || 60000;
                sys.serverGameTime = (elapsed % referenceDay) / referenceDay * sys.serverDayLength;
                return;
            }
            if (dt && dt.userOverridden) {
                sys.serverDayLength = sys.serverDayLength || 60000;
                sys.serverGameTime = (dt.value / 24) * sys.serverDayLength;
                sys.lastTimeSyncTimestamp = Date.now();
                return;
            }
            return original(elapsed, dayLen);
        };
    }

    // ---------- Apply / coerce / events ----------

    _apply(name, p, sys, forceThroughGate) {
        if (!sys) return;

        // Run user-defined apply
        if (p.apply) {
            try { p.apply(p.value, sys); } catch (e) { console.warn(`[ParameterSystem] apply ${name} failed:`, e); }
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

    _coerce(p, value) {
        if (p.type === 'number') {
            const n = typeof value === 'number' ? value : parseFloat(value);
            if (Number.isNaN(n)) return undefined;
            let v = n;
            if (p.min !== undefined) v = Math.max(p.min, v);
            if (p.max !== undefined) v = Math.min(p.max, v);
            return v;
        }
        if (p.type === 'color') {
            if (typeof value === 'string') return value;
            if (value && typeof value.getHexString === 'function') return '#' + value.getHexString();
            return p.defaultValue;
        }
        return value;
    }

    _snapshot(p) {
        return {
            value: p.value,
            defaultValue: p.defaultValue,
            userOverridden: p.userOverridden,
            type: p.type,
            category: p.category,
            description: p.description,
            min: p.min,
            max: p.max,
            step: p.step,
            lastModified: p.lastModified,
            modifiedBy: p.modifiedBy
        };
    }

    _updateUI(name, value) {
        // DevInterface tags the wrapping container with data-parameter.
        document.querySelectorAll(`[data-parameter="${name}"]`).forEach(container => {
            const isSelf = container.tagName === 'INPUT';
            if (isSelf) {
                if (!container.matches(':focus')) container.value = value;
                return;
            }
            const slider  = container.querySelector('input[type="range"]');
            const num     = container.querySelector('input[type="number"]');
            const color   = container.querySelector('input[type="color"]');
            const display = container.querySelector('span');
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
}

// Bootstrap
window.parameterSystem = new ParameterSystem();

// Convenience globals
window.getParam      = (n) => window.parameterSystem.getParameter(n);
window.setParam      = (n, v) => window.parameterSystem.setParameter(n, v);
window.resetParam    = (n) => window.parameterSystem.resetParameter(n);
window.resetAllParams = () => window.parameterSystem.resetAll();
window.getAllParams  = () => window.parameterSystem.getAllParameters();

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
