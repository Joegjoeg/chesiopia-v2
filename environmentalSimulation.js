class SeededRandom {
    constructor(seed) {
        this.seed = seed || Math.floor(Math.random() * 2147483647);
    }

    next() {
        this.seed = (this.seed * 16807 + 0) % 2147483647;
        return (this.seed - 1) / 2147483646;
    }

    range(min, max) {
        return min + this.next() * (max - min);
    }

    rangeInt(min, max) {
        return Math.floor(min + this.next() * (max - min + 1));
    }
}

const AGENT_TYPE = {
    PRESSURE: 0,
    MOISTURE: 1
};

class PressureAgent {
    constructor(x, z, type, seed) {
        this.x = x;
        this.z = z;
        this.type = type;
        this.rng = new SeededRandom(seed);

        this.state = {
            pressure: 0.5,
            humidity: 0.5,
            temperature: 0.5,
            instability: 0.0
        };

        this.primaryField = type === AGENT_TYPE.PRESSURE ? 'pressure' : 'humidity';
        this.carryCapacity = 1.0;
        this.depositRate = 0.08;
        this.absorbRate = 0.06;
        this.moveRadius = 6.0;
        this.sampleCount = 6;
        this.strength = 1.0;
        this.maxStrength = 2.0;
        this.mergeTarget = null;
        this.windInfluence = 0.25;

        this.life = 1.0;
        this._dying = false;
        this.lastDx = 0;
        this.lastDz = 0;
        // console.log(`[Agent] Created ${type === AGENT_TYPE.PRESSURE ? 'pressure' : 'moisture'} at (${x.toFixed(1)},${z.toFixed(1)}) life=${this.life}`);
    }

    tick(envFields, terrainGenerator, windVector, moveScale = 1.0, globalSampleCount = null) {
        if (this._dying) {
            this.life = Math.max(0, this.life - 0.05);
        } else {
            this.life = Math.min(1, this.life + 0.05);
        }
        this._move(envFields, windVector, moveScale, globalSampleCount);
        this._deposit(envFields);
        this._absorb(envFields, terrainGenerator);
        this._updateStrength(envFields);
        this._decayInstability();
    }

    _move(envFields, windVector, moveScale = 1.0, globalSampleCount = null) {
        // If being merged into a stronger agent, let them drag us
        if (this.mergeTarget) {
            const dx = this.mergeTarget.x - this.x;
            const dz = this.mergeTarget.z - this.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 0.5) {
                this.x += dx * 0.35;
                this.z += dz * 0.35;
            }
            return;
        }

        const effectiveRadius = this.moveRadius * moveScale;
        const sampleCount = globalSampleCount !== null ? globalSampleCount : this.sampleCount;
        const samples = [];
        for (let i = 0; i < sampleCount; i++) {
            const angle = this.rng.next() * Math.PI * 2;
            const dist = this.rng.next() * effectiveRadius;
            const nx = Math.round(this.x + Math.cos(angle) * dist);
            const nz = Math.round(this.z + Math.sin(angle) * dist);
            const key = `${nx},${nz}`;
            const field = envFields.get(key);
            // Use neutral (0.5) if no field exists — agents explore empty space
            samples.push({ x: nx, z: nz, field: field ? field[this.primaryField] : 0.5, key });
        }

        if (samples.length === 0) return;

        const currentField = envFields.get(`${Math.round(this.x)},${Math.round(this.z)}`);
        const currentValue = currentField ? currentField[this.primaryField] : 0.5;

        // Sort by gradient favorability: if carrying high, seek low; if carrying low, seek high
        const myValue = this.state[this.primaryField];
        samples.sort((a, b) => {
            const diffA = Math.abs(a.field - myValue);
            const diffB = Math.abs(b.field - myValue);
            return diffB - diffA; // biggest difference first
        });

        // 75% chance to follow gradient, 25% random exploration
        const choice = this.rng.next() < 0.75 ? samples[0] : samples[Math.floor(this.rng.next() * samples.length)];
        if (!choice) return;

        // Blend gradient direction with global wind field and momentum
        const gradientX = choice.x - this.x;
        const gradientZ = choice.z - this.z;

        const windX = (windVector?.dx ?? 0) * effectiveRadius;
        const windZ = (windVector?.dz ?? 0) * effectiveRadius;

        // Momentum: bias toward continuing last direction
        const momentumWeight = 0.3;
        const gradientWeight = 0.7;
        const blendX = gradientX * gradientWeight + this.lastDx * momentumWeight;
        const blendZ = gradientZ * gradientWeight + this.lastDz * momentumWeight;

        const moveX = blendX * (1 - this.windInfluence) + windX * this.windInfluence;
        const moveZ = blendZ * (1 - this.windInfluence) + windZ * this.windInfluence;

        // Soft move: interpolate toward blended direction (scale with moveScale for larger weather)
        const newX = this.x + moveX * 0.6 * moveScale;
        const newZ = this.z + moveZ * 0.6 * moveScale;

        // Store momentum direction
        this.lastDx = newX - this.x;
        this.lastDz = newZ - this.z;

        // Track instability when gradient is weak
        const gradient = Math.abs(currentValue - choice.field);
        if (gradient < 0.05) {
            this.state.instability += 0.1;
        } else {
            this.state.instability = Math.max(0, this.state.instability - 0.05);
        }

        this.x = newX;
        this.z = newZ;
    }

    _deposit(envFields) {
        const tx = Math.round(this.x);
        const tz = Math.round(this.z);
        const key = `${tx},${tz}`;
        let field = envFields.get(key);
        if (!field) {
            // Create field on demand — agents seed the climate field
            field = { pressure: 0.5, humidity: 0.5, temperature: 0.5 };
            envFields.set(key, field);
        }

        // Scale deposit by life (fade in)
        const lifeScale = Math.max(0.1, this.life);

        // Deposit primary field based on difference from tile
        const diff = this.state[this.primaryField] - field[this.primaryField];
        const deposit = diff * this.depositRate * lifeScale;
        field[this.primaryField] += deposit;
        this.state[this.primaryField] -= deposit * 0.5; // lose some, keep some

        // Cross-coupling: high humidity increases pressure (latent heat)
        if (this.type === AGENT_TYPE.MOISTURE && field.humidity > 0.7) {
            field.pressure += 0.005 * lifeScale;
        }

        // Clamp
        field.pressure = Math.max(0, Math.min(1, field.pressure));
        field.humidity = Math.max(0, Math.min(1, field.humidity));
        field.temperature = Math.max(0, Math.min(1, field.temperature));
        this.state.pressure = Math.max(0, Math.min(1, this.state.pressure));
        this.state.humidity = Math.max(0, Math.min(1, this.state.humidity));
    }

    _absorb(envFields, terrainGenerator) {
        const tx = Math.round(this.x);
        const tz = Math.round(this.z);
        const key = `${tx},${tz}`;
        const field = envFields.get(key);
        if (!field) return;

        // Scale absorb by life (fade in)
        const lifeScale = Math.max(0.1, this.life);

        // Absorb from tile
        this.state.pressure += (field.pressure - this.state.pressure) * this.absorbRate * lifeScale;
        this.state.humidity += (field.humidity - this.state.humidity) * this.absorbRate * lifeScale;
        this.state.temperature += (field.temperature - this.state.temperature) * this.absorbRate * lifeScale;

        // Dual water detection: climate humidity OR terrain height
        const height = terrainGenerator.getHeight(tx, tz);
        const isWater = field.humidity > 0.7 || height < terrainGenerator.waterLevel + 1;
        if (isWater) {
            this.state.humidity = Math.min(1, this.state.humidity + 0.03 * lifeScale);
        }

        // Clamp
        this.state.pressure = Math.max(0, Math.min(1, this.state.pressure));
        this.state.humidity = Math.max(0, Math.min(1, this.state.humidity));
        this.state.temperature = Math.max(0, Math.min(1, this.state.temperature));
    }

    _decayInstability() {
        // High instability makes agents more erratic and can trigger "storm" behavior
        if (this.state.instability > 0.8) {
            // Storm: mark as dying rather than resetting — will be respawned
            this._dying = true;
            this.moveRadius = Math.min(12, this.moveRadius + 2);
        } else {
            this.moveRadius = Math.max(4, Math.min(10, this.moveRadius * 0.98 + 6 * 0.02));
        }
    }

    _updateStrength(envFields) {
        const currentField = envFields.get(`${Math.round(this.x)},${Math.round(this.z)}`);
        if (!currentField) return;

        let diff;
        if (this.type === AGENT_TYPE.PRESSURE) {
            diff = Math.abs(this.state.pressure - currentField.pressure);
        } else {
            diff = Math.abs(this.state.humidity - currentField.humidity);
        }

        // Well-matched agents gain strength, mismatched agents lose it
        const gain = 0.03 * (1 - diff);
        const loss = 0.04 * diff;
        this.strength += gain - loss;
        this.strength = Math.max(0.1, Math.min(this.maxStrength, this.strength));
    }
}

class EnvironmentalSimulation {
    constructor(terrainGenerator, options = {}) {
        this.terrainGenerator = terrainGenerator;
        this.agentCount = options.agentCount || 200;
        this.tickIntervalMs = options.tickIntervalMs || 2000;
        this.windChangeInterval = options.windChangeInterval || 10;
        this.agents = [];
        this.envFields = new Map(); // "x,z" -> {pressure, humidity, temperature}
        this.tickCount = 0;
        this.rng = new SeededRandom(options.seed || 42);
        this.running = false;
        this.windVector = { dx: 0, dz: 0 };
        this.windTimer = 0;

        // Focal point pooling
        this.focalX = 0;
        this.focalZ = 0;
        this.activeRadius = options.activeRadius || 128;
        this.spawnRadius = Math.floor(this.activeRadius * 0.75);
        this.despawnRadius = Math.floor(this.activeRadius * 1.25);
        this._clientFocals = new Map(); // clientId -> {x, z, time}

        // Rolling average climate history
        this.climateHistory = new Map(); // "x,z" -> [{time, field}]
        this.rollingWindowMs = 30000;
        this.maxHistoryPerField = 30;

        // Agent movement tuning
        this.moveScale = 1.0;
        this.globalSampleCount = null; // null = use agent default
    }

    init() {
        console.log('[EnvSim] Initializing environmental simulation...');
        // envFields starts empty — agents create it
        this._spawnAgents();
        console.log(`[EnvSim] Initialized with ${this.agents.length} agents, ${this.envFields.size} field tiles`);
    }

    _spawnAgents() {
        const halfPressure = Math.floor(this.agentCount / 2);
        const minDist = 20;
        // console.log(`[EnvSim] _spawnAgents count=${this.agentCount} focal=(${this.focalX},${this.focalZ}) spawnRadius=${this.spawnRadius}`);

        for (let i = 0; i < this.agentCount; i++) {
            // Spawn within spawnRadius of focal point with minimum separation
            let x, z, ok;
            let attempts = 0;
            do {
                const angle = this.rng.next() * Math.PI * 2;
                const dist = this.rng.next() * this.spawnRadius;
                x = Math.round(this.focalX + Math.cos(angle) * dist);
                z = Math.round(this.focalZ + Math.sin(angle) * dist);
                ok = true;
                for (const a of this.agents) {
                    const dx = a.x - x;
                    const dz = a.z - z;
                    if (Math.sqrt(dx * dx + dz * dz) < minDist) {
                        ok = false;
                        break;
                    }
                }
                attempts++;
            } while (!ok && attempts < 50);

            const type = i < halfPressure ? AGENT_TYPE.PRESSURE : AGENT_TYPE.MOISTURE;
            const seed = this.rng.rangeInt(1, 1000000);
            const agent = new PressureAgent(x, z, type, seed);

            // Initialize from local climate (or neutral if empty)
            const field = this.sampleClimate(x, z);
            agent.state.pressure = field.pressure;
            agent.state.humidity = field.humidity;
            agent.state.temperature = field.temperature;

            // Give pressure agents extreme initial variance
            if (type === AGENT_TYPE.PRESSURE) {
                agent.state.pressure = i % 2 === 0 ? 0.8 : 0.2;
            } else {
                agent.state.humidity = 0.7;
            }

            this.agents.push(agent);
        }
        // console.log(`[EnvSim] _spawnAgents done: ${this.agents.length} agents total`);
    }

    tick() {
        if (!this.running) return;
        this.tickCount++;

        this._updateWind();
        this._mergeAgents();
        if (this._clientFocals.size > 0) {
            this._rebalanceAgents();
        }

        const preCount = this.agents.length;
        const dyingCount = this.agents.filter(a => a._dying).length;

        // Agent phase
        for (const agent of this.agents) {
            agent.tick(this.envFields, this.terrainGenerator, this.windVector, this.moveScale, this.globalSampleCount);
        }

        // Remove agents that have fully faded out
        const beforeFilter = this.agents.length;
        this.agents = this.agents.filter(agent => !agent._dying || agent.life > 0);
        const removed = beforeFilter - this.agents.length;
        if (removed > 0 || dyingCount > 0) {
            // console.log(`[EnvSim] tick=${this.tickCount} agents=${preCount} dying=${dyingCount} removed=${removed} remaining=${this.agents.length} focal=(${this.focalX},${this.focalZ})`);
        }

        // Diffusion phase: sparse 3x3 box blur
        this._diffuse();

        // Decay pressure only (humidity/temperature conserved by agents)
        this._decay();

        // Record climate for rolling average
        for (const [key, field] of this.envFields) {
            this._recordClimate(key, field);
        }

        // Prune stale fields every 10 ticks
        if (this.tickCount % 10 === 0) {
            this._pruneStaleFields();
        }

        // Respawn to maintain population
        this._respawnAgents();
    }

    _diffuse() {
        const changes = new Map();

        for (const [key, field] of this.envFields) {
            let pSum = field.pressure;
            let hSum = field.humidity;
            let tSum = field.temperature;
            let count = 1;

            const [x, z] = key.split(',').map(Number);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const neighbor = this.envFields.get(`${x + dx},${z + dz}`);
                    if (neighbor) {
                        pSum += neighbor.pressure;
                        hSum += neighbor.humidity;
                        tSum += neighbor.temperature;
                        count++;
                    } else {
                        pSum += 0.5;
                        hSum += 0.5;
                        tSum += 0.5;
                        count++;
                    }
                }
            }

            const pDiffRate = 0.05;
            const hDiffRate = 0.15;
            const tDiffRate = 0.15;

            changes.set(key, {
                pressure: field.pressure + (pSum / count - field.pressure) * pDiffRate,
                humidity: field.humidity + (hSum / count - field.humidity) * hDiffRate,
                temperature: field.temperature + (tSum / count - field.temperature) * tDiffRate
            });
        }

        for (const [key, vals] of changes) {
            const field = this.envFields.get(key);
            if (field) {
                field.pressure = Math.max(0, Math.min(1, vals.pressure));
                field.humidity = Math.max(0, Math.min(1, vals.humidity));
                field.temperature = Math.max(0, Math.min(1, vals.temperature));
            }
        }
    }

    _decay() {
        for (const field of this.envFields.values()) {
            // Only pressure decays toward neutral
            field.pressure += (0.5 - field.pressure) * 0.001;
        }
    }

    _updateWind() {
        this.windTimer++;
        if (this.windTimer >= this.windChangeInterval) {
            this.windTimer = 0;
            // Slowly evolving global wind using superimposed sine waves
            // (simulates continental-scale weather patterns)
            const t = this.tickCount * 0.08;
            const angle = Math.sin(t * 0.31) * 1.2 + Math.sin(t * 0.17) * 0.7 + Math.sin(t * 0.53) * 0.4;
            const magnitude = 0.3 + Math.sin(t * 0.23) * 0.2 + Math.cos(t * 0.11) * 0.15;
            this.windVector.dx = Math.cos(angle) * magnitude;
            this.windVector.dz = Math.sin(angle) * magnitude;
        }
    }

    _mergeAgents() {
        const mergeDistance = 8.0;
        const absorbDistance = 1.5;
        const toRemove = new Set();
        let candidatesChecked = 0;
        let withinMergeRange = 0;
        let absorbed = 0;
        let dragged = 0;

        for (let i = 0; i < this.agents.length; i++) {
            const a = this.agents[i];
            if (toRemove.has(i)) continue;

            for (let j = i + 1; j < this.agents.length; j++) {
                const b = this.agents[j];
                if (toRemove.has(j)) continue;
                if (a.type !== b.type) continue;
                candidatesChecked++;

                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < mergeDistance) {
                    withinMergeRange++;
                    const [stronger, weaker, strongIdx, weakIdx] =
                        a.strength >= b.strength ? [a, b, i, j] : [b, a, j, i];

                    if (dist < absorbDistance) {
                        // Absorb weaker into stronger
                        const totalStrength = stronger.strength + weaker.strength;
                        stronger.x = (stronger.x * stronger.strength + weaker.x * weaker.strength) / totalStrength;
                        stronger.z = (stronger.z * stronger.strength + weaker.z * weaker.strength) / totalStrength;

                        const wStrong = stronger.strength / totalStrength;
                        const wWeak = weaker.strength / totalStrength;
                        stronger.state.pressure = stronger.state.pressure * wStrong + weaker.state.pressure * wWeak;
                        stronger.state.humidity = stronger.state.humidity * wStrong + weaker.state.humidity * wWeak;
                        stronger.state.temperature = stronger.state.temperature * wStrong + weaker.state.temperature * wWeak;
                        stronger.state.instability = Math.max(stronger.state.instability, weaker.state.instability) * 0.85;

                        stronger.strength = Math.min(stronger.maxStrength, totalStrength * 0.9);
                        toRemove.add(weakIdx);
                        weaker.mergeTarget = null;
                        absorbed++;
                    } else {
                        // Drag weaker toward stronger over multiple ticks
                        weaker.mergeTarget = stronger;
                        dragged++;
                    }
                } else {
                    // Clear stale merge targets
                    if (b.mergeTarget === a) b.mergeTarget = null;
                    if (a.mergeTarget === b) a.mergeTarget = null;
                }
            }
        }

        if (candidatesChecked > 0 && (withinMergeRange > 0 || absorbed > 0 || dragged > 0)) {
            // console.log(`[EnvSim] Merge: checked=${candidatesChecked} inRange=${withinMergeRange} absorbed=${absorbed} dragged=${dragged} removed=${toRemove.size}`);
        }

        if (toRemove.size > 0) {
            this.agents = this.agents.filter((_, idx) => !toRemove.has(idx));
        }
    }

    _respawnAgents() {
        const activeCount = this.agents.filter(a => !a._dying).length;
        const needed = this.agentCount - activeCount;
        if (needed <= 0) return;
        // console.log(`[EnvSim] _respawnAgents needed=${needed} active=${activeCount} total=${this.agents.length} focal=(${this.focalX},${this.focalZ})`);

        const halfPressure = Math.floor(needed / 2);

        for (let i = 0; i < needed; i++) {
            // Spawn within spawnRadius of focal point
            let x, z;
            let attempts = 0;
            let tooClose = true;
            while (tooClose && attempts < 30) {
                const angle = this.rng.next() * Math.PI * 2;
                const dist = this.rng.next() * this.spawnRadius;
                x = Math.round(this.focalX + Math.cos(angle) * dist);
                z = Math.round(this.focalZ + Math.sin(angle) * dist);
                tooClose = false;
                for (const a of this.agents) {
                    const dx = a.x - x;
                    const dz = a.z - z;
                    if (Math.sqrt(dx * dx + dz * dz) < 20) {
                        tooClose = true;
                        break;
                    }
                }
                attempts++;
            }

            const type = i < halfPressure ? AGENT_TYPE.PRESSURE : AGENT_TYPE.MOISTURE;
            const seed = this.rng.rangeInt(1, 1000000);
            const agent = new PressureAgent(x, z, type, seed);

            // Initialize from local climate (or neutral if empty)
            const field = this.sampleClimate(x, z);
            agent.state.pressure = field.pressure;
            agent.state.humidity = field.humidity;
            agent.state.temperature = field.temperature;

            if (type === AGENT_TYPE.PRESSURE) {
                agent.state.pressure = this.rng.next() < 0.5 ? 0.8 : 0.2;
            } else {
                agent.state.humidity = 0.7;
            }

            this.agents.push(agent);
        }
        // console.log(`[EnvSim] _respawnAgents done: ${this.agents.length} agents total`);
    }

    getFieldsInRegion(minX, minZ, maxX, maxZ) {
        const fields = [];
        for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += 4) { // Sparse sampling
            for (let z = Math.floor(minZ); z <= Math.ceil(maxZ); z += 4) {
                const field = this.envFields.get(`${x},${z}`);
                if (field) {
                    fields.push({ x, z, ...field });
                }
            }
        }
        return fields;
    }

    getAverageFieldInRegion(minX, minZ, maxX, maxZ) {
        let pSum = 0, hSum = 0, tSum = 0, count = 0;
        for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
            for (let z = Math.floor(minZ); z <= Math.ceil(maxZ); z++) {
                const field = this.envFields.get(`${x},${z}`);
                if (field) {
                    pSum += field.pressure;
                    hSum += field.humidity;
                    tSum += field.temperature;
                    count++;
                }
            }
        }
        if (count === 0) return { pressure: 0.5, humidity: 0.5, temperature: 0.5 };
        return {
            pressure: pSum / count,
            humidity: hSum / count,
            temperature: tSum / count
        };
    }

    getAgentPositions() {
        return this.agents.map(a => ({
            x: a.x,
            z: a.z,
            type: a.type,
            pressure: a.state.pressure,
            humidity: a.state.humidity,
            instability: a.state.instability,
            strength: a.strength,
            life: a.life,
            dying: a._dying
        }));
    }

    // Pure read: sample climate at (x,z). Returns weighted average of nearby
    // envFields entries, or neutral (0.5) if none found. Never creates entries.
    sampleClimate(x, z) {
        const searchRadius = 8;
        let pSum = 0, hSum = 0, tSum = 0, weightSum = 0, pSqSum = 0;
        let sampleCount = 0;

        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                const nx = Math.round(x) + dx;
                const nz = Math.round(z) + dz;
                const field = this.envFields.get(`${nx},${nz}`);
                if (!field) continue;

                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > searchRadius) continue;

                const weight = 1 / (1 + dist);
                pSum += field.pressure * weight;
                hSum += field.humidity * weight;
                tSum += field.temperature * weight;
                pSqSum += field.pressure * field.pressure * weight;
                weightSum += weight;
                sampleCount++;
            }
        }

        if (weightSum === 0) {
            return {
                pressure: 0.5,
                humidity: 0.5,
                temperature: 0.5,
                pressureVariance: 0,
                sampleCount: 0
            };
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

    // Return 30-second rolling average of climate at (x,z), or fall back to sampleClimate
    sampleClimateSmoothed(x, z) {
        const key = `${Math.round(x)},${Math.round(z)}`;
        const history = this.climateHistory.get(key);
        if (!history || history.length === 0) {
            return this.sampleClimate(x, z);
        }

        const base = this.sampleClimate(x, z);
        const now = Date.now();
        const cutoff = now - this.rollingWindowMs;
        let pSum = 0, hSum = 0, tSum = 0, count = 0;

        for (const entry of history) {
            if (entry.time < cutoff) continue;
            pSum += entry.field.pressure;
            hSum += entry.field.humidity;
            tSum += entry.field.temperature;
            count++;
        }

        if (count === 0) {
            return base;
        }

        return {
            pressure: pSum / count,
            humidity: hSum / count,
            temperature: tSum / count,
            pressureVariance: base.pressureVariance,
            sampleCount: Math.max(base.sampleCount, count)
        };
    }

    _recordClimate(key, field) {
        let history = this.climateHistory.get(key);
        if (!history) {
            history = [];
            this.climateHistory.set(key, history);
        }
        history.push({
            time: Date.now(),
            field: { pressure: field.pressure, humidity: field.humidity, temperature: field.temperature }
        });
        // Prune old entries
        const cutoff = Date.now() - this.rollingWindowMs;
        while (history.length > 0 && history[0].time < cutoff) {
            history.shift();
        }
        // Hard cap to prevent unbounded growth for very active fields
        if (history.length > this.maxHistoryPerField) {
            history.splice(0, history.length - this.maxHistoryPerField);
        }
    }

    // Update focal point from client position. Computes centroid of active clients.
    updateFocalPoint(x, z, clientId) {
        this._clientFocals.set(clientId, { x, z, time: Date.now() });

        // Expire old entries (>60s)
        const now = Date.now();
        for (const [id, data] of this._clientFocals) {
            if (now - data.time > 60000) {
                this._clientFocals.delete(id);
            }
        }

        // Compute centroid
        let cx = 0, cz = 0, count = 0;
        for (const data of this._clientFocals.values()) {
            cx += data.x;
            cz += data.z;
            count++;
        }
        if (count === 0) return;

        const newFocalX = Math.round(cx / count);
        const newFocalZ = Math.round(cz / count);

        // Only rebalance if focal moved significantly (>16 tiles)
        const dist = Math.sqrt((newFocalX - this.focalX) ** 2 + (newFocalZ - this.focalZ) ** 2);
        if (dist > 16) {
            // console.log(`[EnvSim] Focal moved ${dist.toFixed(1)} -> (${newFocalX},${newFocalZ}) from (${this.focalX},${this.focalZ})`);
            this.focalX = newFocalX;
            this.focalZ = newFocalZ;
            this._rebalanceAgents();
        }
    }

    // Mark distant agents as dying, remove dead ones
    _rebalanceAgents() {
        let marked = 0, cleared = 0;
        for (const agent of this.agents) {
            const dx = agent.x - this.focalX;
            const dz = agent.z - this.focalZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const wasDying = agent._dying;
            if (dist > this.despawnRadius) {
                agent._dying = true;
                if (!wasDying) marked++;
            } else {
                agent._dying = false;
                if (wasDying) cleared++;
            }
        }
        if (marked > 0 || cleared > 0) {
            // console.log(`[EnvSim] Rebalance: marked=${marked} cleared=${cleared} despawnRadius=${this.despawnRadius} focal=(${this.focalX},${this.focalZ})`);
        }
    }

    setAgentCount(target) {
        if (!Number.isFinite(target)) return;
        const clamped = Math.max(0, Math.min(500, Math.round(target)));
        if (clamped === this.agentCount) return;

        this.agentCount = clamped;
        console.log(`[EnvSim] Agent target set to ${this.agentCount}`);

        if (!this.running) {
            this._respawnAgents();
            return;
        }

        const deficit = this.agentCount - this.agents.length;
        if (deficit > 0) {
            this._respawnAgents();
            return;
        }

        const excess = Math.abs(deficit);
        if (excess === 0) return;

        const sorted = [...this.agents].sort((a, b) => a.life - b.life);
        for (let i = 0; i < excess && i < sorted.length; i++) {
            const agent = sorted[i];
            agent._dying = true;
            agent.life = Math.min(agent.life, 0.3);
        }
    }

    // Remove envFields entries close to neutral (0.5) to prevent unbounded growth
    _pruneStaleFields() {
        const stale = [];
        for (const [key, field] of this.envFields) {
            const nearNeutral =
                Math.abs(field.pressure - 0.5) < 0.05 &&
                Math.abs(field.humidity - 0.5) < 0.05 &&
                Math.abs(field.temperature - 0.5) < 0.05;
            if (nearNeutral) {
                stale.push(key);
            }
        }
        for (const key of stale) {
            this.envFields.delete(key);
            this.climateHistory.delete(key);
        }
        if (stale.length > 0) {
            console.log(`[EnvSim] Pruned ${stale.length} stale field entries`);
        }
    }

    setActiveRadius(radius) {
        this.activeRadius = radius;
        this.spawnRadius = Math.floor(radius * 0.75);
        this.despawnRadius = Math.floor(radius * 1.25);
        console.log(`[EnvSim] Active radius set: active=${this.activeRadius}, spawn=${this.spawnRadius}, despawn=${this.despawnRadius}`);
    }

    setMoveScale(scale) {
        if (!Number.isFinite(scale)) return;
        const clamped = Math.max(0.25, Math.min(4.0, scale));
        if (clamped === this.moveScale) return;
        this.moveScale = clamped;
        console.log(`[EnvSim] Move scale set to ${this.moveScale}`);
    }

    setSampleCount(count) {
        if (!Number.isFinite(count)) return;
        const clamped = Math.max(2, Math.min(12, Math.round(count)));
        if (clamped === this.globalSampleCount) return;
        this.globalSampleCount = clamped;
        console.log(`[EnvSim] Global sample count set to ${this.globalSampleCount}`);
    }

    start() {
        this.running = true;
        console.log('[EnvSim] Simulation started');
    }

    stop() {
        this.running = false;
        console.log('[EnvSim] Simulation stopped');
    }
}

module.exports = { EnvironmentalSimulation, PressureAgent, AGENT_TYPE };
