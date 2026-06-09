class JesusSummonTriggerSystem {
    constructor({ game, jesusSummonSystem } = {}) {
        this.game = game;
        this.jesusSummonSystem = jesusSummonSystem;
        this.enabled = true;
        this._isUpsideDown = false;
        this._hourWindowActive = false;
        this._lastTriggerHourKey = null;
        this._currentHourKey = this._getHourKey(new Date());
        this._orientationHandler = this._handleOrientation.bind(this);
        this._hourlyCheckHandler = this._handleHourTick.bind(this);
        this._hourTimer = null;
        this._permissionRequested = false;
        this._betaThreshold = 150; // Phone flipped around X axis (~180 deg)
        this._gammaThreshold = 35;  // Keep sideways tilt limited

        this._initOrientationListener();
        this._hourWindowActive = this._isWithinHourWindow();
        this._hourTimer = setInterval(this._hourlyCheckHandler, 15000);
        console.log('[JesusSummonTrigger] Initialized');
    }

    dispose() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('deviceorientation', this._orientationHandler);
        }
        if (this._hourTimer) {
            clearInterval(this._hourTimer);
            this._hourTimer = null;
        }
    }

    _initOrientationListener() {
        if (typeof window === 'undefined') return;
        if (typeof DeviceOrientationEvent === 'undefined') {
            console.warn('[JesusSummonTrigger] DeviceOrientationEvent unsupported');
            return;
        }
        window.addEventListener('deviceorientation', this._orientationHandler, true);
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            const requestPermission = async () => {
                if (this._permissionRequested) return;
                this._permissionRequested = true;
                try {
                    const response = await DeviceOrientationEvent.requestPermission();
                    console.log('[JesusSummonTrigger] Orientation permission result:', response);
                } catch (err) {
                    console.warn('[JesusSummonTrigger] Orientation permission rejected:', err);
                }
            };
            const gestureHandler = () => {
                requestPermission();
                window.removeEventListener('click', gestureHandler);
                window.removeEventListener('touchstart', gestureHandler);
            };
            window.addEventListener('click', gestureHandler, { once: true });
            window.addEventListener('touchstart', gestureHandler, { once: true });
        }
    }

    _handleOrientation(event) {
        if (!this.enabled || !event) return;
        const beta = Number(event.beta);
        const gamma = Number(event.gamma);
        if (!isFinite(beta) || !isFinite(gamma)) {
            return;
        }
        const upsideDown = Math.abs(beta) >= this._betaThreshold && Math.abs(gamma) <= this._gammaThreshold;
        this._isUpsideDown = upsideDown;
        if (upsideDown) {
            this._lastUpsideDownTs = performance.now();
            this._attemptTrigger();
        }
    }

    _handleHourTick() {
        this._hourWindowActive = this._isWithinHourWindow();
        this._currentHourKey = this._getHourKey(new Date());
        this._attemptTrigger();
    }

    _attemptTrigger() {
        if (!this.enabled) return;
        if (!this._hourWindowActive || !this._isUpsideDown) return;
        if (!this.jesusSummonSystem || this.jesusSummonSystem.status === 'summoning') return;
        if (this._currentHourKey && this._currentHourKey === this._lastTriggerHourKey) {
            return;
        }

        const spawn = this._findSpawnNearCamera();
        const preferredCenter = spawn || this._getCameraGroundPoint();
        console.log('[JesusSummonTrigger] Triggering summon near camera', preferredCenter);
        this.jesusSummonSystem.summonJesus({
            spawnOverride: spawn,
            preferredCenter,
            searchRadius: 18,
            searchStep: 2
        });
        this._lastTriggerHourKey = this._currentHourKey;
    }

    _findSpawnNearCamera() {
        if (!this.game || !this.game.camera || !this.jesusSummonSystem) {
            return null;
        }
        const base = this._getCameraGroundPoint();
        if (!base) return null;
        let best = null;
        const radius = 18;
        const step = 2;
        for (let dx = -radius; dx <= radius; dx += step) {
            for (let dz = -radius; dz <= radius; dz += step) {
                const x = base.x + dx;
                const z = base.z + dz;
                const spawn = this.jesusSummonSystem._validateSpawnPoint
                    ? this.jesusSummonSystem._validateSpawnPoint({ x, z })
                    : null;
                if (spawn && (!best || spawn.depth > best.depth)) {
                    best = spawn;
                }
            }
        }
        return best;
    }

    _getCameraGroundPoint() {
        if (!this.game || !this.game.camera) return null;
        const cam = this.game.camera.position;
        if (!cam) return null;
        return { x: cam.x, z: cam.z };
    }

    _isWithinHourWindow() {
        const now = new Date();
        return now.getMinutes() === 0 && now.getSeconds() < 50;
    }

    _getHourKey(date) {
        return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`;
    }
}

window.JesusSummonTriggerSystem = JesusSummonTriggerSystem;
