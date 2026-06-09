// WeatherDirector — Client-side weather authority
// Samples climate from terrain chunk tiles, computes derived weather metrics,
// and provides a single snapshot that all visual systems read from.
//
// Tick timing: target 0.5s, gated by frame budget, forced every 10s max.
// Wind: pressure-gradient primary, noise-based fallback.

class WeatherDirector {
    constructor(game) {
        this.game = game;
        this.terrainSystem = game.terrainSystem;
        this.performanceManager = game.performanceManager;

        // Timing
        this.targetTickMs = 500;
        this.maxStalenessMs = 10000;
        this._lastTickTime = 0;
        this._lastForceTickTime = 0;

        // Smoothing window (seconds) for exponential moving average
        this.smoothingWindow = 30;

        // Wind state (mirrors server _updateWind algorithm)
        this._windVector = { dx: 0, dz: 0 };
        this._windTimer = 0;
        this._windChangeInterval = 10;
        this._tickCount = 0;

        // Current snapshot (atomically swapped)
        this._snapshot = this._neutralSnapshot();

        // Sampling delta for pressure gradient — adaptive, starts at 8
        this._adaptiveDelta = 8;

        console.log('[WeatherDirector] Initialized');
    }

    _neutralSnapshot() {
        return {
            pressure: 0.5,
            humidity: 0.5,
            temperature: 0.5,
            pressureVariance: 0,
            windSpeed: 0.3,
            windDirection: 0,
            cloudCoverage: 0,
            fogDensity: 0,
            rainIntensity: 0,
            stormStrength: 0,
            wetness: 0,
            lightBlocking: 0,
            visibility: 1,
            weatherState: 'clear',
            timestamp: 0
        };
    }

    // Called each frame from game loop
    update(deltaTime) {
        const now = performance.now();
        const timeSinceTick = now - this._lastTickTime;
        const timeSinceForce = now - this._lastForceTickTime;

        // Check frame budget
        const budgetOk = this._frameBudgetOk();

        // Should we tick?
        let shouldTick = false;
        if (timeSinceForce >= this.maxStalenessMs) {
            shouldTick = true;
        } else if (budgetOk && timeSinceTick >= this.targetTickMs) {
            shouldTick = true;
        }

        if (!shouldTick) return;

        this._lastTickTime = now;
        if (timeSinceForce >= this.maxStalenessMs) {
            this._lastForceTickTime = now;
        }

        this._tick();
    }

    _frameBudgetOk() {
        if (!this.performanceManager) return true;
        const fps = this.performanceManager.smoothedFps;
        const target = this.performanceManager.targetFps;
        if (typeof fps !== 'number' || typeof target !== 'number') return true;
        return fps >= target;
    }

    _tick() {
        this._tickCount++;
        const camera = this.game.camera;
        if (!camera) return;

        const cx = Math.round(camera.position.x);
        const cz = Math.round(camera.position.z);

        // Update adaptive delta based on loaded chunks
        this._updateAdaptiveDelta(cx, cz);

        // Sample climate around camera
        const climate = this._sampleClimateRegion(cx, cz);

        // Update wind
        this._updateWind(cx, cz, climate);

        // Compute derived metrics
        const derived = this._computeDerived(climate);

        // Build new snapshot with EMA smoothing
        const newSnapshot = this._buildSnapshot(climate, derived);

        // Atomic swap
        this._snapshot = newSnapshot;
    }

    _updateAdaptiveDelta(cx, cz) {
        if (!this.terrainSystem) return;

        // Find largest delta where all 4 cardinal sample points have loaded chunks
        const maxDelta = 16;
        const minDelta = 4;
        const chunkSize = this.terrainSystem.chunkSize || 32;

        for (let delta = maxDelta; delta >= minDelta; delta -= 2) {
            const points = [
                [cx - delta, cz],
                [cx + delta, cz],
                [cx, cz - delta],
                [cx, cz + delta]
            ];
            const allLoaded = points.every(([wx, wz]) => {
                const chunkX = Math.floor(wx / chunkSize);
                const chunkZ = Math.floor(wz / chunkSize);
                const chunk = this.terrainSystem.chunks.get(`${chunkX},${chunkZ}`);
                return chunk && chunk.data;
            });
            if (allLoaded) {
                this._adaptiveDelta = delta;
                return;
            }
        }
        this._adaptiveDelta = minDelta;
    }

    _sampleClimateRegion(cx, cz) {
        const delta = this._adaptiveDelta;
        let pSum = 0, hSum = 0, tSum = 0, pSqSum = 0, weightSum = 0;
        let sampleCount = 0;

        // Sample a sparse grid within ±delta
        const step = Math.max(2, Math.floor(delta / 4));
        for (let dx = -delta; dx <= delta; dx += step) {
            for (let dz = -delta; dz <= delta; dz += step) {
                const wx = cx + dx;
                const wz = cz + dz;
                const tile = this.terrainSystem ? this.terrainSystem.getTileData(wx, wz) : null;

                let p = 0.5, h = 0.5, t = 0.5;
                if (tile) {
                    p = typeof tile.pressure === 'number' ? tile.pressure : 0.5;
                    h = typeof tile.moisture === 'number' ? tile.moisture : 0.5;
                    t = typeof tile.temperature === 'number' ? tile.temperature : 0.5;
                }

                const dist = Math.sqrt(dx * dx + dz * dz);
                const weight = 1 / (1 + dist);

                pSum += p * weight;
                hSum += h * weight;
                tSum += t * weight;
                pSqSum += p * p * weight;
                weightSum += weight;
                sampleCount++;
            }
        }

        if (weightSum === 0) {
            return { pressure: 0.5, humidity: 0.5, temperature: 0.5, pressureVariance: 0, sampleCount: 0 };
        }

        const pressure = pSum / weightSum;
        const pressureVariance = Math.max(0, pSqSum / weightSum - pressure * pressure);

        return {
            pressure,
            humidity: hSum / weightSum,
            temperature: tSum / weightSum,
            pressureVariance,
            sampleCount
        };
    }

    _updateWind(cx, cz, climate) {
        this._windTimer++;
        if (this._windTimer < this._windChangeInterval) return;
        this._windTimer = 0;

        const delta = this._adaptiveDelta;

        // Count how many env field tiles we have in the region
        let fieldCount = 0;
        if (this.terrainSystem) {
            for (let dx = -delta; dx <= delta; dx += 2) {
                for (let dz = -delta; dz <= delta; dz += 2) {
                    const tile = this.terrainSystem.getTileData(cx + dx, cz + dz);
                    if (tile && typeof tile.pressure === 'number') fieldCount++;
                }
            }
        }

        // Fallback: noise-based wind when too few data points
        if (fieldCount < 4) {
            const t = this._tickCount * 0.08;
            const angle = Math.sin(t * 0.31) * 1.2 + Math.sin(t * 0.17) * 0.7 + Math.sin(t * 0.53) * 0.4;
            const magnitude = 0.3 + Math.sin(t * 0.23) * 0.2 + Math.cos(t * 0.11) * 0.15;
            this._windVector.dx = Math.cos(angle) * magnitude;
            this._windVector.dz = Math.sin(angle) * magnitude;
            return;
        }

        // Compute wind from pressure gradient
        const pLeft  = this._samplePressureAt(cx - delta, cz);
        const pRight = this._samplePressureAt(cx + delta, cz);
        const pUp    = this._samplePressureAt(cx, cz - delta);
        const pDown  = this._samplePressureAt(cx, cz + delta);

        const dPdx = (pRight - pLeft) / (2 * delta);
        const dPdz = (pDown - pUp) / (2 * delta);

        // Wind flows from high to low pressure (negative gradient)
        const scale = 60;
        let windX = -dPdx * scale;
        let windZ = -dPdz * scale;

        // Clamp magnitude
        const mag = Math.sqrt(windX * windX + windZ * windZ);
        const maxMag = 1.5;
        if (mag > maxMag) {
            windX = (windX / mag) * maxMag;
            windZ = (windZ / mag) * maxMag;
        }

        // Smooth transition toward new gradient-driven wind
        const blend = 0.6;
        this._windVector.dx = this._windVector.dx * (1 - blend) + windX * blend;
        this._windVector.dz = this._windVector.dz * (1 - blend) + windZ * blend;
    }

    _samplePressureAt(wx, wz) {
        if (!this.terrainSystem) return 0.5;
        const tile = this.terrainSystem.getTileData(wx, wz);
        if (tile && typeof tile.pressure === 'number') return tile.pressure;
        return 0.5;
    }

    _computeDerived(climate) {
        const p = climate.pressure;
        const h = climate.humidity;
        const t = climate.temperature;
        const pVar = climate.pressureVariance;

        const windMag = Math.sqrt(
            this._windVector.dx * this._windVector.dx +
            this._windVector.dz * this._windVector.dz
        );

        // Cloud coverage: driven by humidity and pressure variance (instability)
        const cloudCoverage = Math.min(1, h * 0.7 + pVar * 2.5);

        // Fog density: high humidity + cool temperature + low wind
        const fogDensity = Math.min(1, h * (1 - t) * (1 - windMag * 0.5) * 1.5);

        // Rain intensity: humidity exceeding saturation, boosted by low pressure
        const saturationThreshold = 0.65;
        const rainIntensity = Math.max(0, (h - saturationThreshold) / (1 - saturationThreshold));
        const rainBoost = (1 - p) * 0.3;
        const rain = Math.min(1, rainIntensity * 1.2 + rainBoost);

        // Storm strength: combines instability, pressure variance, and high humidity
        const stormStrength = Math.min(1,
            pVar * 3.0 +
            (h - 0.6) * 1.5 +
            (1 - p) * 0.5
        );

        // Wetness: from rain + humidity
        const wetness = Math.min(1, rain * 0.8 + h * 0.2);

        // Light blocking: clouds + storms reduce sunlight
        const lightBlocking = Math.min(1, cloudCoverage * 0.6 + stormStrength * 0.4);

        // Visibility: inverse of fog + rain
        const visibility = Math.max(0.05, 1 - (fogDensity * 0.7 + rain * 0.3));

        // Weather state classification
        let weatherState = 'clear';
        if (stormStrength > 0.7) {
            weatherState = 'storm';
        } else if (rain > 0.5) {
            weatherState = 'rain';
        } else if (rain > 0.15) {
            weatherState = 'drizzle';
        } else if (fogDensity > 0.5) {
            weatherState = 'foggy';
        } else if (cloudCoverage > 0.5) {
            weatherState = 'overcast';
        }

        return {
            cloudCoverage,
            fogDensity,
            rainIntensity: rain,
            stormStrength,
            wetness,
            lightBlocking,
            visibility,
            weatherState
        };
    }

    _buildSnapshot(climate, derived) {
        const prev = this._snapshot;
        const alpha = Math.min(1, this.targetTickMs / 1000 / this.smoothingWindow);

        const windMag = Math.sqrt(
            this._windVector.dx * this._windVector.dx +
            this._windVector.dz * this._windVector.dz
        );
        const windDir = Math.atan2(this._windVector.dz, this._windVector.dx);

        const ema = (prevVal, newVal) => {
            if (typeof prevVal !== 'number' || isNaN(prevVal)) return newVal;
            return prevVal * (1 - alpha) + newVal * alpha;
        };

        return {
            pressure: ema(prev.pressure, climate.pressure),
            humidity: ema(prev.humidity, climate.humidity),
            temperature: ema(prev.temperature, climate.temperature),
            pressureVariance: ema(prev.pressureVariance, climate.pressureVariance),
            windSpeed: ema(prev.windSpeed, windMag),
            windDirection: windDir,
            cloudCoverage: ema(prev.cloudCoverage, derived.cloudCoverage),
            fogDensity: ema(prev.fogDensity, derived.fogDensity),
            rainIntensity: ema(prev.rainIntensity, derived.rainIntensity),
            stormStrength: ema(prev.stormStrength, derived.stormStrength),
            wetness: ema(prev.wetness, derived.wetness),
            lightBlocking: ema(prev.lightBlocking, derived.lightBlocking),
            visibility: ema(prev.visibility, derived.visibility),
            weatherState: derived.weatherState,
            timestamp: performance.now()
        };
    }

    getSnapshot() {
        return this._snapshot;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WeatherDirector;
}
