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
    }

    tick(envFields, chunkSignatures, terrainGenerator) {
        this._move(envFields);
        this._deposit(envFields);
        this._absorb(envFields, chunkSignatures, terrainGenerator);
        this._decayInstability();
    }

    _move(envFields) {
        const samples = [];
        for (let i = 0; i < this.sampleCount; i++) {
            const angle = this.rng.next() * Math.PI * 2;
            const dist = this.rng.next() * this.moveRadius;
            const nx = Math.round(this.x + Math.cos(angle) * dist);
            const nz = Math.round(this.z + Math.sin(angle) * dist);
            const key = `${nx},${nz}`;
            const field = envFields.get(key);
            if (field) {
                samples.push({ x: nx, z: nz, field: field[this.primaryField], key });
            }
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

        // Soft move: interpolate toward target
        const newX = this.x + (choice.x - this.x) * 0.6;
        const newZ = this.z + (choice.z - this.z) * 0.6;

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
        const field = envFields.get(key);
        if (!field) return;

        // Deposit primary field based on difference from tile
        const diff = this.state[this.primaryField] - field[this.primaryField];
        const deposit = diff * this.depositRate;
        field[this.primaryField] += deposit;
        this.state[this.primaryField] -= deposit * 0.5; // lose some, keep some

        // Cross-coupling: high humidity increases pressure (latent heat)
        if (this.type === AGENT_TYPE.MOISTURE && field.humidity > 0.7) {
            field.pressure += 0.005;
        }

        // Clamp
        field.pressure = Math.max(0, Math.min(1, field.pressure));
        field.humidity = Math.max(0, Math.min(1, field.humidity));
        field.temperature = Math.max(0, Math.min(1, field.temperature));
        this.state.pressure = Math.max(0, Math.min(1, this.state.pressure));
        this.state.humidity = Math.max(0, Math.min(1, this.state.humidity));
    }

    _absorb(envFields, chunkSignatures, terrainGenerator) {
        const tx = Math.round(this.x);
        const tz = Math.round(this.z);
        const key = `${tx},${tz}`;
        const field = envFields.get(key);
        if (!field) return;

        // Absorb from tile
        this.state.pressure += (field.pressure - this.state.pressure) * this.absorbRate;
        this.state.humidity += (field.humidity - this.state.humidity) * this.absorbRate;
        this.state.temperature += (field.temperature - this.state.temperature) * this.absorbRate;

        // Chunk signature influences
        const chunkSize = 16;
        const cx = Math.floor(tx / chunkSize);
        const cz = Math.floor(tz / chunkSize);
        const sig = chunkSignatures.get(`${cx},${cz}`);
        if (sig) {
            // Moisture agents gain humidity in high-moisture-generation chunks (water)
            if (this.type === AGENT_TYPE.MOISTURE) {
                this.state.humidity += sig.moistureGeneration * 0.02;
            }
            // All agents warm up in high heat-absorption areas
            this.state.temperature += (sig.heatAbsorption - this.state.temperature) * 0.01;
            // Pressure agents affected by uplift (orographic)
            if (this.type === AGENT_TYPE.PRESSURE) {
                this.state.pressure -= sig.uplift * 0.015;
            }
        }

        // Direct terrain influence: water tiles generate humidity
        const height = terrainGenerator.getHeight(tx, tz);
        if (height < terrainGenerator.waterLevel + 1) {
            this.state.humidity = Math.min(1, this.state.humidity + 0.03);
        }

        // Clamp
        this.state.pressure = Math.max(0, Math.min(1, this.state.pressure));
        this.state.humidity = Math.max(0, Math.min(1, this.state.humidity));
        this.state.temperature = Math.max(0, Math.min(1, this.state.temperature));
    }

    _decayInstability() {
        // High instability makes agents more erratic and can trigger "storm" behavior
        if (this.state.instability > 0.8) {
            // Storm: dump most state, reset
            this.state.pressure = 0.5;
            this.state.humidity = 0.5;
            this.state.instability = 0;
            this.moveRadius = Math.min(12, this.moveRadius + 2);
        } else {
            this.moveRadius = Math.max(4, Math.min(10, this.moveRadius * 0.98 + 6 * 0.02));
        }
    }
}

class EnvironmentalSimulation {
    constructor(terrainGenerator, options = {}) {
        this.terrainGenerator = terrainGenerator;
        this.agentCount = options.agentCount || 30;
        this.tickIntervalMs = options.tickIntervalMs || 2000;
        this.bounds = options.bounds || { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
        this.agents = [];
        this.envFields = new Map(); // "x,z" -> {pressure, humidity, temperature}
        this.chunkSignatures = new Map(); // "cx,cz" -> {uplift, heatAbsorption, moistureGeneration}
        this.tickCount = 0;
        this.rng = new SeededRandom(options.seed || 42);
        this.running = false;
    }

    init() {
        console.log('[EnvSim] Initializing environmental simulation...');
        this._initEnvFields();
        this._computeChunkSignatures();
        this._spawnAgents();
        console.log(`[EnvSim] Initialized with ${this.agents.length} agents, ${this.envFields.size} field tiles`);
    }

    _initEnvFields() {
        const { minX, maxX, minZ, maxZ } = this.bounds;
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const height = this.terrainGenerator.getHeight(x, z);
                const moisture = this.terrainGenerator.getMoisture(x, z, height);
                const temperature = this.terrainGenerator.getTemperature(x, z, height);
                this.envFields.set(`${x},${z}`, {
                    pressure: 0.5,
                    humidity: moisture,
                    temperature: temperature
                });
            }
        }
    }

    _computeChunkSignatures() {
        const chunkSize = 16;
        const { minX, maxX, minZ, maxZ } = this.bounds;
        const minCX = Math.floor(minX / chunkSize);
        const maxCX = Math.floor(maxX / chunkSize);
        const minCZ = Math.floor(minZ / chunkSize);
        const maxCZ = Math.floor(maxZ / chunkSize);

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                let totalSlope = 0;
                let tileCount = 0;
                let waterTiles = 0;
                let heatSum = 0;

                for (let lx = 0; lx < chunkSize; lx++) {
                    for (let lz = 0; lz < chunkSize; lz++) {
                        const wx = cx * chunkSize + lx;
                        const wz = cz * chunkSize + lz;
                        if (wx < this.bounds.minX || wx > this.bounds.maxX ||
                            wz < this.bounds.minZ || wz > this.bounds.maxZ) {
                            continue;
                        }
                        const height = this.terrainGenerator.getHeight(wx, wz);
                        const slope = this.terrainGenerator.calculateSlope(wx, wz, height);
                        totalSlope += slope;
                        tileCount++;
                        if (height < this.terrainGenerator.waterLevel) waterTiles++;

                        const biome = this.terrainGenerator.getBiomeType(height);
                        switch (biome) {
                            case 'snow': heatSum += 0.1; break;
                            case 'forest': heatSum += 0.5; break;
                            case 'grassland': heatSum += 0.6; break;
                            case 'lowland': heatSum += 0.7; break;
                            case 'beach': heatSum += 0.8; break;
                            case 'mountain': heatSum += 0.3; break;
                            default: heatSum += 0.5;
                        }
                    }
                }

                if (tileCount > 0) {
                    this.chunkSignatures.set(`${cx},${cz}`, {
                        uplift: Math.min(1, (totalSlope / tileCount) / 45),
                        heatAbsorption: heatSum / tileCount,
                        moistureGeneration: Math.min(1, waterTiles / tileCount * 3)
                    });
                }
            }
        }
    }

    _spawnAgents() {
        const { minX, maxX, minZ, maxZ } = this.bounds;
        const halfPressure = Math.floor(this.agentCount / 2);

        for (let i = 0; i < this.agentCount; i++) {
            const x = this.rng.rangeInt(minX, maxX);
            const z = this.rng.rangeInt(minZ, maxZ);
            const type = i < halfPressure ? AGENT_TYPE.PRESSURE : AGENT_TYPE.MOISTURE;
            const seed = this.rng.rangeInt(1, 1000000);
            const agent = new PressureAgent(x, z, type, seed);

            // Initialize agent state from local field
            const field = this.envFields.get(`${x},${z}`);
            if (field) {
                agent.state.pressure = field.pressure;
                agent.state.humidity = field.humidity;
                agent.state.temperature = field.temperature;
            }

            // Give pressure agents some initial variance
            if (type === AGENT_TYPE.PRESSURE) {
                agent.state.pressure = i % 2 === 0 ? 0.8 : 0.2;
            } else {
                agent.state.humidity = 0.7;
            }

            this.agents.push(agent);
        }
    }

    tick() {
        if (!this.running) return;
        this.tickCount++;

        // Agent phase
        for (const agent of this.agents) {
            agent.tick(this.envFields, this.chunkSignatures, this.terrainGenerator);
        }

        // Diffusion phase: simple 3x3 box blur on env fields
        this._diffuse();

        // Decay toward baseline (prevents runaway)
        this._decay();
    }

    _diffuse() {
        const changes = new Map();
        const { minX, maxX, minZ, maxZ } = this.bounds;

        for (let x = minX + 1; x < maxX; x++) {
            for (let z = minZ + 1; z < maxZ; z++) {
                const key = `${x},${z}`;
                const field = this.envFields.get(key);
                if (!field) continue;

                let pSum = field.pressure;
                let hSum = field.humidity;
                let tSum = field.temperature;
                let count = 1;

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (dx === 0 && dz === 0) continue;
                        const neighbor = this.envFields.get(`${x + dx},${z + dz}`);
                        if (neighbor) {
                            pSum += neighbor.pressure;
                            hSum += neighbor.humidity;
                            tSum += neighbor.temperature;
                            count++;
                        }
                    }
                }

                const diffRate = 0.15;
                changes.set(key, {
                    pressure: field.pressure + (pSum / count - field.pressure) * diffRate,
                    humidity: field.humidity + (hSum / count - field.humidity) * diffRate,
                    temperature: field.temperature + (tSum / count - field.temperature) * diffRate
                });
            }
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
        const { minX, maxX, minZ, maxZ } = this.bounds;
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = `${x},${z}`;
                const field = this.envFields.get(key);
                if (!field) continue;
                // Very slow decay toward neutral
                field.pressure += (0.5 - field.pressure) * 0.001;
            }
        }
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
            instability: a.state.instability
        }));
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
