class TerrainGenerator {
    constructor() {
        this.noiseScale = 0.015;
        this.heightScale = 20.0;
        this.tileCache = new Map();
        this.maxCacheSize = 10000;
        this.seed = null;
        
        // Water table constants
        this.waterLevel = -1.5;       // Shallow water: wading allowed
        this.deepWaterLevel = -3.0;   // Deep water: movement blocked
        this.riverMaxDepth = 1.5;     // Max depth for river channels
        
        // Tree data for consistent blocking between client and server
        this.trees = new Map(); // key="x,y" -> {x, y, biome, maxScale, growthRate, species, clumpId}

        // Biome-aware tree generation parameters
        this.BIOME_TREE_CONFIG = {
            deep_water:   { density: 0.00, clumpiness: 0.0, minSlope:  0, maxSlope:  0, maxScale: 0.0, growthRate: 0.0, species: 'none' },
            shallow_water:{ density: 0.00, clumpiness: 0.0, minSlope:  0, maxSlope:  0, maxScale: 0.0, growthRate: 0.0, species: 'none' },
            beach:        { density: 0.00, clumpiness: 0.0, minSlope:  0, maxSlope:  0, maxScale: 0.0, growthRate: 0.0, species: 'none' },
            lowland:      { density: 0.06, clumpiness: 0.3, minSlope:  2, maxSlope: 20, maxScale: 0.9, growthRate: 1.1, species: 'poplar' },
            grassland:    { density: 0.12, clumpiness: 0.3, minSlope:  3, maxSlope: 30, maxScale: 1.0, growthRate: 1.0, species: 'terrain' },
            forest:       { density: 0.50, clumpiness: 0.8, minSlope:  8, maxSlope: 50, maxScale: 1.3, growthRate: 0.7, species: 'terrain' },
            mountain:     { density: 0.08, clumpiness: 0.2, minSlope: 20, maxSlope: 70, maxScale: 0.7, growthRate: 0.4, species: 'growing' },
            snow:         { density: 0.02, clumpiness: 0.1, minSlope: 15, maxSlope: 55, maxScale: 0.5, growthRate: 0.2, species: 'growing' }
        };

        // Clump noise scale for clustering
        this.clumpNoiseScale = 0.04;

        // Biome patch noise for breaking up concentric rings
        this.biomePatchScale = 0.025;
        this.biomePatchStrength = 0.0;
        this.biomePatchSeedOffset = 123.45;
        
        // River channels: key="x,y" -> depth (how much terrain was carved down)
        this.rivers = new Map();
        this.riverCount = 6; // Number of rivers to generate

        // Planet mapping for coordinate wrapping
        this.planetMapping = null;

        // Celestial double-pendulum terrain generation
        this.celestialPendulum = {
            enabled: true,
            r1: 12,
            r2: 8,
            sunAngle: 0,
            moonAngle: 0,
            freqX: 0.025,
            freqZ: 0.018,
            noiseBlend: 0.25
        };

        // Probe system: pre-committed height constraints for blend zones
        this.probes = new Map();
        this.probeInfluenceRadius = 48;

        // Simple noise implementation - will be initialized with seed
        this.permutation = [];
        this.generatePermutation();
    }

    setPlanetMapping(planetMapping) {
        this.planetMapping = planetMapping;
        console.log(`[TerrainGenerator] Planet mapping ${planetMapping ? 'ENABLED' : 'DISABLED'}`);
    }

    /**
     * Wrap coordinates if planet mapping is active.
     * Returns wrapped (x, z) for consistent terrain generation.
     */
    _wrapCoords(x, z) {
        if (!this.planetMapping || !this.planetMapping.enabled) return { x, z };
        const planet = this.planetMapping.getPlanetForCamera(x, z);
        return this.planetMapping.wrapPosition(x, z, planet);
    }
    
    setSeed(seed) {
        this.seed = seed;
        this.tileCache.clear(); // Clear cache when seed changes
        this.generatePermutation();
        console.log(`[TerrainGenerator] Set seed to: ${seed}`);
    }
    
    generatePermutation() {
        const random = this.seed !== null ? this.seededRandom() : Math.random;
        
        this.permutation = [];
        for (let i = 0; i < 256; i++) {
            this.permutation[i] = Math.floor(random() * 256);
        }
        for (let i = 0; i < 256; i++) {
            this.permutation[256 + i] = this.permutation[i];
        }
    }
    
    seededRandom() {
        let seed = this.seed || 12345;
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }
    
    setCelestialAngles(sunAngle, moonAngle) {
        this.celestialPendulum.sunAngle = sunAngle;
        this.celestialPendulum.moonAngle = moonAngle;
    }

    getPendulumHeight(x, z) {
        const cp = this.celestialPendulum;
        const sunPhase  = cp.sunAngle  + x * cp.freqX + z * cp.freqZ;
        const moonPhase = cp.moonAngle + x * cp.freqZ * 1.3 - z * cp.freqX * 0.7;
        const h1 = cp.r1 * Math.sin(sunPhase);
        const h2 = h1 + cp.r2 * Math.sin(moonPhase);
        return -h2;
    }

    getNaturalHeight(x, z) {
        const pendulum = this.getPendulumHeight(x, z);
        if (this.celestialPendulum.noiseBlend > 0) {
            const noise = this.simplexNoise(
                x * this.noiseScale * 2,
                z * this.noiseScale * 2
            ) * this.celestialPendulum.noiseBlend * this.heightScale * 0.5;
            return pendulum + noise;
        }
        return pendulum;
    }

    registerProbe(x, z, options = {}) {
        const key = `${x},${z}`;
        if (this.probes.has(key)) return this.probes.get(key).height;
        const height = this.getNaturalHeight(x, z);
        const probe = {
            x, z, height,
            radius: options.radius || this.probeInfluenceRadius,
            profile: options.profile || 'smooth'
        };
        this.probes.set(key, probe);
        return height;
    }

    findNearbyProbes(x, z) {
        const results = [];
        for (const probe of this.probes.values()) {
            const dx = x - probe.x;
            const dz = z - probe.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < probe.radius) {
                results.push({ x: probe.x, z: probe.z, height: probe.height, radius: probe.radius, profile: probe.profile, distance: dist });
            }
        }
        results.sort((a, b) => a.distance - b.distance);
        return results;
    }

    getRawHeight(x, y) {
        if (this.celestialPendulum.enabled) {
            return this.getNaturalHeight(x, y);
        }
        let height = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;
        
        for (let i = 0; i < 4; i++) {
            height += this.simplexNoise(
                x * this.noiseScale * frequency,
                y * this.noiseScale * frequency
            ) * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        
        return (height / maxValue) * this.heightScale;
    }
    
    getHeight(x, y) {
        // Wrap coordinates if planet mapping is active
        const wrapped = this._wrapCoords(x, y);
        x = wrapped.x;
        y = wrapped.z;

        const key = `${x},${y}`;

        // Check cache first
        if (this.tileCache.has(key)) {
            return this.tileCache.get(key);
        }

        let finalHeight = this.getRawHeight(x, y);
        
        // Blend toward nearby probes for smooth transitions
        const nearby = this.findNearbyProbes(x, y);
        if (nearby.length > 0) {
            let blended = finalHeight;
            let totalWeight = 0;
            for (const p of nearby) {
                const t = p.distance / p.radius;
                let w;
                switch (p.profile) {
                    case 'steep':   w = t < 0.3 ? 1 : 0; break;
                    case 'textured': w = (1-t)*(1-t) + this.simplexNoise(x*0.1, y*0.1)*0.15; break;
                    default:        w = (1-t)*(1-t); break;
                }
                w = Math.max(0, Math.min(1, w));
                blended += (p.height - blended) * w * 0.5;
                totalWeight += w;
            }
            if (totalWeight > 0) {
                finalHeight = blended;
            }
        }
        
        // Cache management
        if (this.tileCache.size >= this.maxCacheSize) {
            const keysToDelete = Array.from(this.tileCache.keys()).slice(0, 1000);
            keysToDelete.forEach(k => this.tileCache.delete(k));
        }
        
        // Apply river channel carving if this tile is on a river
        const riverDepth = this.rivers.get(key);
        if (riverDepth) {
            finalHeight -= riverDepth;
        }
        
        this.tileCache.set(key, finalHeight);
        return finalHeight;
    }
    
    simplexNoise(x, y) {
        // Simple continuous noise function for chunk boundaries
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        
        x -= Math.floor(x);
        y -= Math.floor(y);
        
        const u = this.fade(x);
        const v = this.fade(y);
        
        const a = this.permutation[X] + Y;
        const aa = this.permutation[a];
        const ab = this.permutation[a + 1];
        const b = this.permutation[X + 1] + Y;
        const ba = this.permutation[b];
        const bb = this.permutation[b + 1];
        
        return this.lerp(v,
            this.lerp(u, this.grad(this.permutation[aa], x, y),
                this.grad(this.permutation[ba], x - 1, y)),
            this.lerp(u, this.grad(this.permutation[ab], x, y - 1),
                this.grad(this.permutation[bb], x - 1, y - 1))
        );
    }
    
    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }
    
    lerp(t, a, b) {
        return a + t * (b - a);
    }
    
    grad(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
    
    isTileBlocked(x, y) {
        // Wrap coordinates if planet mapping is active
        const wrapped = this._wrapCoords(x, y);
        x = wrapped.x;
        y = wrapped.z;

        const height = this.getHeight(x, y);
        
        // Deep water blocks movement
        if (height < this.deepWaterLevel) {
            console.log(`[TerrainGen] Tile (${x},${y}): blocked by deep water (height=${height.toFixed(2)})`);
            return true;
        }
        
        // Check if tile has a tree (primary blocking method)
        const treeKey = `${x},${y}`;
        const hasTree = this.trees.has(treeKey);
        
        if (hasTree) {
            console.log(`[TerrainGen] Tile (${x},${y}): blocked by tree`);
            return true;
        }
        
        // Fallback: Check slope-based blocking for very steep terrain
        const slope = this.calculateSlope(x, y, height);
        const isSlopeBlocked = slope > 80; // Only block very steep terrain
        
        console.log(`[TerrainGen] Tile (${x},${y}): height=${height.toFixed(2)}, slope=${slope.toFixed(2)}°, blocked=${isSlopeBlocked}`);
        return isSlopeBlocked;
    }
    
    getWaterState(height) {
        if (height < this.deepWaterLevel) {
            return { type: 'deep', wadeable: false, blocked: true };
        } else if (height < this.waterLevel) {
            return { type: 'shallow', wadeable: true, blocked: false };
        }
        return { type: 'dry', wadeable: false, blocked: false };
    }
    
    // Add tree at position with optional metadata
    addTree(x, y, metadata = {}) {
        const treeKey = `${x},${y}`;
        this.trees.set(treeKey, { x, y, ...metadata });
    }

    // Remove tree at position
    removeTree(x, y) {
        const treeKey = `${x},${y}`;
        this.trees.delete(treeKey);
    }

    // Check if tree exists at position
    hasTreeAt(x, y) {
        const treeKey = `${x},${y}`;
        return this.trees.has(treeKey);
    }

    // Get tree metadata at position
    getTreeData(x, y) {
        const treeKey = `${x},${y}`;
        return this.trees.get(treeKey) || null;
    }
    
    // Generate trees for terrain with biome-aware procedural placement
    generateTrees(searchRadius = 50) {
        console.log(`[TerrainGen] Generating biome-aware trees in radius ${searchRadius}`);

        for (let x = -searchRadius; x <= searchRadius; x++) {
            for (let y = -searchRadius; y <= searchRadius; y++) {
                this._tryPlaceTree(x, y);
            }
        }

        console.log(`[TerrainGen] Generated ${this.trees.size} biome-aware trees`);
    }

    // Deterministic per-tile random value (0-1) based on coordinates + world seed
    _tileRandom(x, y, offset = 0) {
        let h = ((this.seed || 12345) + x * 374761 + y * 668265 + offset * 997) & 0x7fffffff;
        h = (h * 9301 + 49297) % 233280;
        return h / 233280;
    }

    // Attempt to place a single tree at world (x,y) using biome rules
    _tryPlaceTree(x, y) {
        const height = this.getHeight(x, y);
        if (height < this.waterLevel) return;

        const slope = this.calculateSlope(x, y, height);
        const biome = this.getBiomeType(height, x, y);
        const config = this.BIOME_TREE_CONFIG[biome];
        if (!config || config.density <= 0) return;
        if (slope < config.minSlope || slope > config.maxSlope) return;

        const rng = this._tileRandom(x, y, 0);
        if (rng > config.density) return;

        // Clumpiness: use secondary noise to create clustering
        if (config.clumpiness > 0) {
            const clumpNoise = this.simplexNoise(x * this.clumpNoiseScale, y * this.clumpNoiseScale);
            const clumpThreshold = 1.0 - config.clumpiness;
            if (clumpNoise < clumpThreshold) return;
        }

        // Per-tree variation
        const scaleVar = this._tileRandom(x, y, 1);
        const maxScale = config.maxScale * (0.8 + scaleVar * 0.4);
        const growthVar = this._tileRandom(x, y, 2);
        const growthRate = config.growthRate * (0.85 + growthVar * 0.3);

        this.addTree(x, y, { biome, maxScale, growthRate, species: config.species });
    }

    // Generate trees for a specific chunk on-demand
    generateTreesForChunk(chunkX, chunkZ, chunkSize = 16) {
        const startX = chunkX * chunkSize;
        const startZ = chunkZ * chunkSize;
        let added = 0;
        for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
                const wx = startX + x;
                const wz = startZ + z;
                const key = `${wx},${wz}`;
                if (!this.trees.has(key)) {
                    this._tryPlaceTree(wx, wz);
                    if (this.trees.has(key)) added++;
                }
            }
        }
        if (added > 0) {
            console.log(`[TerrainGen] Added ${added} trees for chunk (${chunkX}, ${chunkZ})`);
        }
        return added;
    }

    // Get all trees within a chunk
    getTreesForChunk(chunkX, chunkZ, chunkSize = 16) {
        const startX = chunkX * chunkSize;
        const startZ = chunkZ * chunkSize;
        const result = [];
        for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
                const wx = startX + x;
                const wz = startZ + z;
                const data = this.getTreeData(wx, wz);
                if (data) result.push(data);
            }
        }
        return result;
    }
    
    calculateSlope(x, y, height) {
        const delta = 0.1;
        const h1 = this.getHeight(x + delta, y);
        const h2 = this.getHeight(x - delta, y);
        const h3 = this.getHeight(x, y + delta);
        const h4 = this.getHeight(x, y - delta);
        
        const dx = (h2 - h1) / (2 * delta);
        const dz = (h4 - h3) / (2 * delta);
        
        return Math.atan(Math.sqrt(dx * dx + dz * dz)) * (180 / Math.PI);
    }
    
    getPatchNoise(x, z) {
        const scale = this.biomePatchScale || 0.025;
        const seed = this.biomePatchSeedOffset || 123.45;
        return this.simplexNoise(x * scale + seed, z * scale + seed * 2.0);
    }

    getBiomeType(height, x, z) {
        // Height-based biome classification with optional patch noise
        let effectiveHeight = height;
        if (this.biomePatchStrength > 0 && x !== undefined && z !== undefined) {
            effectiveHeight += this.getPatchNoise(x, z) * this.biomePatchStrength;
        }
        if (effectiveHeight < this.deepWaterLevel) {
            return 'deep_water';
        } else if (effectiveHeight < this.waterLevel) {
            return 'shallow_water';
        } else if (effectiveHeight < 0) {
            return 'beach';
        } else if (effectiveHeight < 2) {
            return 'lowland';
        } else if (effectiveHeight < 8) {
            return 'grassland';
        } else if (effectiveHeight < 15) {
            return 'forest';
        } else if (effectiveHeight < 22) {
            return 'mountain';
        } else {
            return 'snow';
        }
    }
    
    getMoisture(x, z, height) {
        // Simple moisture calculation based on height and distance from water
        let moisture = 0.5; // Base moisture
        
        // Higher areas are drier
        if (height > 10) {
            moisture -= (height - 10) * 0.02;
        }
        
        // Areas near water level are wetter
        if (height >= this.deepWaterLevel && height <= this.waterLevel + 2) {
            moisture += 0.3;
        }
        
        // Add some noise variation
        const noiseValue = this.simplexNoise(x * 0.05, z * 0.05);
        moisture += noiseValue * 0.2;
        
        return Math.max(0, Math.min(1, moisture));
    }
    
    getTemperature(x, z, height) {
        // Simple temperature calculation based on height
        let temperature = 0.5; // Base temperature
        
        // Higher areas are colder
        temperature -= height * 0.01;
        
        // Add some noise variation
        const noiseValue = this.simplexNoise(x * 0.03, z * 0.03);
        temperature += noiseValue * 0.15;
        
        return Math.max(0, Math.min(1, temperature));
    }
    
    getBiomeColor(height, x, z) {
        // Height-based biome coloring with water table and optional patch noise
        let effectiveHeight = height;
        if (this.biomePatchStrength > 0 && x !== undefined && z !== undefined) {
            effectiveHeight += this.getPatchNoise(x, z) * this.biomePatchStrength;
        }
        if (effectiveHeight < this.deepWaterLevel) {
            return { r: 0.05, g: 0.15, b: 0.4 }; // Deep water - dark blue
        } else if (effectiveHeight < this.waterLevel) {
            return { r: 0.15, g: 0.35, b: 0.65 }; // Shallow water - lighter blue
        } else if (effectiveHeight < 0) {
            return { r: 0.8, g: 0.75, b: 0.45 }; // Wet sand / shore
        } else if (effectiveHeight < 3) {
            return { r: 0.35, g: 0.65, b: 0.25 }; // Low grass
        } else if (effectiveHeight < 10) {
            return { r: 0.2, g: 0.55, b: 0.2 }; // Grass
        } else if (effectiveHeight < 18) {
            return { r: 0.15, g: 0.45, b: 0.15 }; // Dark grass / forest edge
        } else if (effectiveHeight < 25) {
            return { r: 0.45, g: 0.4, b: 0.3 }; // Rock
        } else {
            return { r: 0.85, g: 0.85, b: 0.85 }; // Snow
        }
    }
    
    getChunkData(chunkX, chunkZ, chunkSize = 16) {
        const chunk = [];
        
        // Generate terrain using noise directly - no over-smoothing
        for (let z = 0; z < chunkSize; z++) {
            const worldZ = chunkZ * chunkSize + z;
            
            for (let x = 0; x < chunkSize; x++) {
                const worldX = chunkX * chunkSize + x;
                
                // Get height directly from noise function
                const height = this.getHeight(worldX, worldZ);
                const isBlocked = this.isTileBlocked(worldX, worldZ);
                const color = this.getBiomeColor(height, worldX, worldZ);
                const biomeType = this.getBiomeType(height, worldX, worldZ);
                
                const waterState = this.getWaterState(height);
                chunk.push({
                    x: worldX,
                    z: worldZ,
                    height: height,
                    isBlocked: isBlocked,
                    color: color,
                    waterState: waterState,
                    biome: biomeType,
                    type: biomeType,
                    elevation: height,
                    moisture: this.getMoisture(worldX, worldZ, height),
                    temperature: this.getTemperature(worldX, worldZ, height),
                    pressure: 0.5
                });
            }
        }
        
        return chunk;
    }

    blendChunkEdges(chunkData, chunkX, chunkZ, chunkSize, neighbors) {
        // neighbors: { north: chunkData, south: chunkData, east: chunkData, west: chunkData }
        const blendWidth = 6; // tiles to blend inward from edge

        const getTile = (data, lx, lz) => {
            if (!data) return null;
            const idx = lz * chunkSize + lx;
            return (idx >= 0 && idx < data.length) ? data[idx] : null;
        };

        for (let i = 0; i < chunkData.length; i++) {
            const tile = chunkData[i];
            const lx = i % chunkSize;
            const lz = Math.floor(i / chunkSize);
            let blendedHeight = tile.height;
            let totalWeight = 0;

            // North edge (lz == 0) - blend with south edge of north neighbor
            if (lz < blendWidth && neighbors.north) {
                const neighborTile = getTile(neighbors.north, lx, chunkSize - 1 - lz);
                if (neighborTile) {
                    const t = lz / blendWidth; // 0 at edge, 1 at blendWidth
                    const w = (1 - t) * (1 - t); // quadratic falloff
                    blendedHeight = blendedHeight * (1 - w) + neighborTile.height * w;
                    totalWeight += w;
                }
            }

            // South edge (lz >= chunkSize - blendWidth) - blend with north edge of south neighbor
            if (lz >= chunkSize - blendWidth && neighbors.south) {
                const distFromEdge = (chunkSize - 1 - lz);
                const neighborTile = getTile(neighbors.south, lx, distFromEdge);
                if (neighborTile) {
                    const t = distFromEdge / blendWidth;
                    const w = (1 - t) * (1 - t);
                    blendedHeight = blendedHeight * (1 - w) + neighborTile.height * w;
                    totalWeight += w;
                }
            }

            // West edge (lx < blendWidth) - blend with east edge of west neighbor
            if (lx < blendWidth && neighbors.west) {
                const neighborTile = getTile(neighbors.west, chunkSize - 1 - lx, lz);
                if (neighborTile) {
                    const t = lx / blendWidth;
                    const w = (1 - t) * (1 - t);
                    blendedHeight = blendedHeight * (1 - w) + neighborTile.height * w;
                    totalWeight += w;
                }
            }

            // East edge (lx >= chunkSize - blendWidth) - blend with west edge of east neighbor
            if (lx >= chunkSize - blendWidth && neighbors.east) {
                const distFromEdge = (chunkSize - 1 - lx);
                const neighborTile = getTile(neighbors.east, distFromEdge, lz);
                if (neighborTile) {
                    const t = distFromEdge / blendWidth;
                    const w = (1 - t) * (1 - t);
                    blendedHeight = blendedHeight * (1 - w) + neighborTile.height * w;
                    totalWeight += w;
                }
            }

            // Corner blending: average the two edge blends
            if (totalWeight > 0) {
                tile.height = blendedHeight;
                tile.elevation = blendedHeight;
                const color = this.getBiomeColor(blendedHeight);
                tile.color = color;
                tile.biome = this.getBiomeType(blendedHeight);
                tile.type = tile.biome;
                tile.waterState = this.getWaterState(blendedHeight);
            }
        }
    }
    
    clearCache() {
        this.tileCache.clear();
    }
    
    // RIVER WALKER - algorithmically carve river channels
    generateRivers(bounds = 80) {
        console.log(`[River] Generating ${this.riverCount} rivers in bounds ${bounds}...`);
        this.rivers.clear();
        this.tileCache.clear(); // Clear cache since heights will change
        
        const rng = this.seed !== null ? this.seededRandom() : Math.random;
        const sources = this.findRiverSources(this.riverCount, bounds, rng);
        
        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            console.log(`[River] Walking river ${i + 1} from (${source.x}, ${source.y}) height=${source.height.toFixed(1)}`);
            this.walkRiver(source.x, source.y, bounds, rng);
        }
        
        console.log(`[River] Generated ${this.rivers.size} carved river tiles`);
    }
    
    findRiverSources(count, bounds, rng) {
        const sources = [];
        const attempts = count * 10;
        
        for (let i = 0; i < attempts && sources.length < count; i++) {
            const x = Math.floor((rng() * 2 - 1) * bounds);
            const y = Math.floor((rng() * 2 - 1) * bounds);
            const height = this.getRawHeight(x, y);
            
            // Source must be above water and reasonably high
            if (height > this.waterLevel + 2) {
                // Check it's a local peak (higher than neighbors)
                let isPeak = true;
                for (let dx = -1; dx <= 1 && isPeak; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        const nh = this.getRawHeight(x + dx, y + dy);
                        if (nh > height) {
                            isPeak = false;
                            break;
                        }
                    }
                }
                if (isPeak) {
                    sources.push({ x, y, height });
                }
            }
        }
        
        // Fallback: if not enough peaks, just pick highest random points
        while (sources.length < count) {
            const x = Math.floor((rng() * 2 - 1) * bounds);
            const y = Math.floor((rng() * 2 - 1) * bounds);
            const height = this.getRawHeight(x, y);
            if (height > this.waterLevel) {
                sources.push({ x, y, height });
            }
        }
        
        return sources;
    }
    
    walkRiver(startX, startY, bounds, rng) {
        let x = startX;
        let y = startY;
        let steps = 0;
        const maxSteps = 200;
        let accumulatedFlow = 0;
        
        while (steps < maxSteps) {
            steps++;
            accumulatedFlow += 0.05;
            
            // Find lowest neighbor
            let bestX = x;
            let bestY = y;
            let bestHeight = this.getRawHeight(x, y);
            
            const neighbors = [
                { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
                { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
                { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
                { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
            ];
            
            for (const n of neighbors) {
                const nx = x + n.dx;
                const ny = y + n.dy;
                const h = this.getRawHeight(nx, ny);
                if (h < bestHeight) {
                    bestHeight = h;
                    bestX = nx;
                    bestY = ny;
                }
            }
            
            // If no lower neighbor, stop (local minimum or flat)
            if (bestX === x && bestY === y) {
                break;
            }
            
            x = bestX;
            y = bestY;
            
            // Carve channel with increasing depth based on flow accumulation
            const depth = Math.min(accumulatedFlow, this.riverMaxDepth);
            this.carveRiverTile(x, y, depth);
            
            // If reached water, stop
            const currentHeight = this.getHeight(x, y);
            if (currentHeight < this.waterLevel) {
                break;
            }
            
            // Bounds check
            if (Math.abs(x) > bounds || Math.abs(y) > bounds) {
                break;
            }
        }
    }
    
    carveRiverTile(x, y, depth) {
        const key = `${x},${y}`;
        const existing = this.rivers.get(key) || 0;
        this.rivers.set(key, Math.max(existing, depth));
        
        // Also carve adjacent tiles for wider channel effect
        const widenChance = 0.3;
        const adjacent = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
        ];
        for (const n of adjacent) {
            const nk = `${x + n.dx},${y + n.dy}`;
            const ex = this.rivers.get(nk) || 0;
            if (ex < depth * 0.5) {
                this.rivers.set(nk, depth * 0.5);
            }
        }
    }
    
    isRiverTile(x, y) {
        return this.rivers.has(`${x},${y}`);
    }
}

module.exports = TerrainGenerator;
