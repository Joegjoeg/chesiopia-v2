class TerrainGenerator {
    constructor() {
        this.noiseScale = 0.015;
        this.heightScale = 20.0;
        this.tileCache = new Map();
        this.maxCacheSize = 10000;
        this.seed = null;
        
        // Tree data for consistent blocking between client and server
        this.trees = new Map(); // Store tree positions by tile coordinates
        
        // Simple noise implementation - will be initialized with seed
        this.permutation = [];
        this.generatePermutation();
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
    
    getHeight(x, y) {
        const key = `${x},${y}`;
        
        // Check cache first
        if (this.tileCache.has(key)) {
            return this.tileCache.get(key);
        }
        
        // Generate multi-octave noise for realistic terrain
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
            amplitude *= 0.5;  // Halve amplitude each octave
            frequency *= 2;  // Double frequency each octave
        }
        
        const finalHeight = (height / maxValue) * this.heightScale;
        
        // Cache management
        if (this.tileCache.size >= this.maxCacheSize) {
            // Clear oldest entries
            const keysToDelete = Array.from(this.tileCache.keys()).slice(0, 1000);
            keysToDelete.forEach(k => this.tileCache.delete(k));
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
        // Check if tile has a tree (primary blocking method)
        const treeKey = `${x},${y}`;
        const hasTree = this.trees.has(treeKey);
        
        if (hasTree) {
            console.log(`[TerrainGen] Tile (${x},${y}): blocked by tree`);
            return true;
        }
        
        // Fallback: Check slope-based blocking for very steep terrain
        const height = this.getHeight(x, y);
        const slope = this.calculateSlope(x, y, height);
        const isSlopeBlocked = slope > 80; // Only block very steep terrain
        
        console.log(`[TerrainGen] Tile (${x},${y}): height=${height.toFixed(2)}, slope=${slope.toFixed(2)}°, blocked=${isSlopeBlocked}`);
        return isSlopeBlocked;
    }
    
    // Add tree at position (for consistent server/client state)
    addTree(x, y) {
        const treeKey = `${x},${y}`;
        this.trees.set(treeKey, { x, y });
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
    
    // Generate trees for terrain (call this after terrain generation)
    generateTrees(searchRadius = 50) {
        console.log(`[TerrainGen] Generating trees in radius ${searchRadius}`);
        
        for (let x = -searchRadius; x <= searchRadius; x++) {
            for (let y = -searchRadius; y <= searchRadius; y++) {
                const height = this.getHeight(x, y);
                const slope = this.calculateSlope(x, y, height);
                
                // Generate trees on steep slopes (where trees naturally grow)
                if (slope > 25 && slope < 80) {
                    // Add some randomness to tree placement
                    if (Math.random() < 0.3) { // 30% chance of tree on suitable terrain
                        this.addTree(x, y);
                    }
                }
            }
        }
        
        console.log(`[TerrainGen] Generated ${this.trees.size} trees`);
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
    
    getBiomeColor(height) {
        // Height-based biome coloring
        if (height < -15) {
            return { r: 0.1, g: 0.3, b: 0.6 }; // Deep water
        } else if (height < -5) {
            return { r: 0.2, g: 0.4, b: 0.7 }; // Shallow water
        } else if (height < 0) {
            return { r: 0.8, g: 0.7, b: 0.4 }; // Sand
        } else if (height < 10) {
            return { r: 0.2, g: 0.6, b: 0.2 }; // Grass
        } else if (height < 20) {
            return { r: 0.1, g: 0.4, b: 0.1 }; // Forest
        } else if (height < 30) {
            return { r: 0.5, g: 0.4, b: 0.3 }; // Rock
        } else {
            return { r: 0.9, g: 0.9, b: 0.9 }; // Snow
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
                const color = this.getBiomeColor(height);
                
                chunk.push({
                    x: worldX,
                    z: worldZ,
                    height: height,
                    isBlocked: isBlocked,
                    color: color
                });
            }
        }
        
        return chunk;
    }
    
    clearCache() {
        this.tileCache.clear();
    }
}

module.exports = TerrainGenerator;
