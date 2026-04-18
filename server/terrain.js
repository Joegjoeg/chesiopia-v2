class TerrainGenerator {
    constructor() {
        this.noiseScale = 0.02;
        this.heightScale = 25;
        this.tileCache = new Map();
        this.maxCacheSize = 10000;
        
        // Simple noise implementation
        this.permutation = [];
        for (let i = 0; i < 256; i++) {
            this.permutation[i] = Math.floor(Math.random() * 256);
        }
        for (let i = 0; i < 256; i++) {
            this.permutation[256 + i] = this.permutation[i];
        }
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
        // Simple simplex noise implementation
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
        const height = this.getHeight(x, y);
        const slope = this.calculateSlope(x, y, height);
        return slope > 45; // Degrees - steep slopes are impassable
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
        
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                const worldX = chunkX * chunkSize + x;
                const worldZ = chunkZ * chunkSize + z;
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
