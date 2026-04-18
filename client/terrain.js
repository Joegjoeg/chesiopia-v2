class TerrainSystem {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.chunkSize = 16;
        this.loadDistance = 3;
        this.noiseScale = 0.02;
        this.heightScale = 12.5;
        this.lastCameraChunk = { x: 0, z: 0 };
        
        // Terrain colors for different biomes
        this.biomeColors = {
            deepWater: new THREE.Color(0.1, 0.3, 0.6),
            shallowWater: new THREE.Color(0.2, 0.4, 0.7),
            sand: new THREE.Color(0.8, 0.7, 0.4),
            grass: new THREE.Color(0.2, 0.6, 0.2),
            forest: new THREE.Color(0.1, 0.4, 0.1),
            rock: new THREE.Color(0.5, 0.4, 0.3),
            snow: new THREE.Color(0.9, 0.9, 0.9)
        };
    }
    
    async generateInitialTerrain(centerX, centerZ, radius) {
        const promises = [];
        
        for (let x = -radius; x <= radius; x++) {
            for (let z = -radius; z <= radius; z++) {
                const chunkX = Math.floor(centerX / this.chunkSize) + x;
                const chunkZ = Math.floor(centerZ / this.chunkSize) + z;
                
                promises.push(this.loadChunk(chunkX, chunkZ));
            }
        }
        
        await Promise.all(promises);
    }
    
    updateStreaming(cameraPosition) {
        const cameraChunkX = Math.floor(cameraPosition.x / this.chunkSize);
        const cameraChunkZ = Math.floor(cameraPosition.z / this.chunkSize);
        
        // Check if camera moved to a new chunk
        if (cameraChunkX !== this.lastCameraChunk.x || cameraChunkZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: cameraChunkX, z: cameraChunkZ };
            this.updateChunks(cameraChunkX, cameraChunkZ);
        }
    }
    
    updateChunks(cameraChunkX, cameraChunkZ) {
        console.log(`[Terrain] Updating chunks for camera at: ${cameraChunkX},${cameraChunkZ}`);
        
        const chunksToLoad = [];
        const chunksToUnload = [];
        
        // Determine which chunks should be loaded
        for (let x = -this.loadDistance; x <= this.loadDistance; x++) {
            for (let z = -this.loadDistance; z <= this.loadDistance; z++) {
                const chunkX = cameraChunkX + x;
                const chunkZ = cameraChunkZ + z;
                const chunkKey = `${chunkX},${chunkZ}`;
                
                if (!this.chunks.has(chunkKey)) {
                    console.log(`[Terrain] Loading chunk ${chunkKey}`);
                    chunksToLoad.push({ x: chunkX, z: chunkZ });
                }
            }
        }
        
        // Determine which chunks should be unloaded
        for (const [chunkKey, chunk] of this.chunks) {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            const distance = Math.max(
                Math.abs(chunkX - cameraChunkX),
                Math.abs(chunkZ - cameraChunkZ)
            );
            
            if (distance > this.loadDistance + 1) {
                console.log(`[Terrain] Unloading distant chunk ${chunkKey} (distance: ${distance})`);
                chunksToUnload.push(chunkKey);
            }
        }
        
        // Load new chunks
        let chunksLoaded = 0;
        chunksToLoad.forEach(chunk => {
            this.loadChunk(chunk.x, chunk.z);
            chunksLoaded++;
        });
        
        console.log(`[Terrain] Loaded ${chunksLoaded} new chunks`);
        
        // Unload distant chunks
        chunksToUnload.forEach(chunkKey => {
            this.unloadChunk(chunkKey);
        });
    }
    
    async loadChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        if (this.chunks.has(chunkKey)) {
            return;
        }
        
        // Generate terrain data for this chunk (for height calculations only)
        const terrainData = this.generateChunkData(chunkX, chunkZ);
        
        // NOTE: Terrain mesh creation disabled to prevent conflicts with board system
        // The board system handles the visual representation using terrain heights
        /*
        // Create terrain mesh
        const geometry = this.createChunkGeometry(terrainData);
        const material = this.createChunkMaterial(terrainData);
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
            chunkX * this.chunkSize,
            0,
            chunkZ * this.chunkSize
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        this.scene.add(mesh);
        */
        
        // Store chunk data (mesh disabled - board system handles visuals)
        this.chunks.set(chunkKey, {
            data: terrainData,
            x: chunkX,
            z: chunkZ
        });
    }
    
    unloadChunk(chunkKey) {
        const chunk = this.chunks.get(chunkKey);
        if (chunk) {
            this.chunks.delete(chunkKey);
        }
    }
    
    generateChunkData(chunkX, chunkZ) {
        const data = [];
        
        for (let x = 0; x < this.chunkSize; x++) {
            for (let z = 0; z < this.chunkSize; z++) {
                const worldX = chunkX * this.chunkSize + x;
                const worldZ = chunkZ * this.chunkSize + z;
                
                const height = this.getHeight(worldX, worldZ);
                const isBlocked = this.isTileBlocked(worldX, worldZ);
                const color = this.getBiomeColor(height);
                
                data.push({
                    x: x,
                    z: z,
                    worldX: worldX,
                    worldZ: worldZ,
                    height: height,
                    isBlocked: isBlocked,
                    color: color
                });
            }
        }
        
        return data;
    }
    
    createChunkGeometry(terrainData) {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const normals = [];
        const colors = [];
        const indices = [];
        
        const width = this.chunkSize;
        const depth = this.chunkSize;
        
        // Create vertices
        for (let i = 0; i < terrainData.length; i++) {
            const data = terrainData[i];
            const x = data.x;
            const z = data.z;
            const y = data.height;
            
            vertices.push(x, y, z);
            
            // Add color
            colors.push(data.color.r, data.color.g, data.color.b);
        }
        
        // Calculate normals and create indices
        for (let x = 0; x < width - 1; x++) {
            for (let z = 0; z < depth - 1; z++) {
                const topLeft = x * depth + z;
                const topRight = (x + 1) * depth + z;
                const bottomLeft = x * depth + (z + 1);
                const bottomRight = (x + 1) * depth + (z + 1);
                
                // Two triangles per quad
                indices.push(topLeft, bottomLeft, topRight);
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }
        
        // Calculate normals
        this.calculateNormals(vertices, indices, normals);
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        
        return geometry;
    }
    
    createChunkMaterial(terrainData) {
        return new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0.2,
            flatShading: false
        });
    }
    
    calculateNormals(vertices, indices, normals) {
        // Initialize normals array
        for (let i = 0; i < vertices.length; i += 3) {
            normals.push(0, 0, 0);
        }
        
        // Calculate face normals and accumulate
        for (let i = 0; i < indices.length; i += 3) {
            const i1 = indices[i] * 3;
            const i2 = indices[i + 1] * 3;
            const i3 = indices[i + 2] * 3;
            
            const v1 = new THREE.Vector3(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
            const v2 = new THREE.Vector3(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
            const v3 = new THREE.Vector3(vertices[i3], vertices[i3 + 1], vertices[i3 + 2]);
            
            const edge1 = new THREE.Vector3().subVectors(v2, v1);
            const edge2 = new THREE.Vector3().subVectors(v3, v1);
            const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
            
            // Add to vertex normals
            normals[i1] += normal.x;
            normals[i1 + 1] += normal.y;
            normals[i1 + 2] += normal.z;
            
            normals[i2] += normal.x;
            normals[i2 + 1] += normal.y;
            normals[i2 + 2] += normal.z;
            
            normals[i3] += normal.x;
            normals[i3 + 1] += normal.y;
            normals[i3 + 2] += normal.z;
        }
        
        // Normalize vertex normals
        for (let i = 0; i < normals.length; i += 3) {
            const normal = new THREE.Vector3(normals[i], normals[i + 1], normals[i + 2]);
            normal.normalize();
            normals[i] = normal.x;
            normals[i + 1] = normal.y;
            normals[i + 2] = normal.z;
        }
    }
    
    getHeight(x, y) {
        // Multi-octave noise for realistic terrain
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
        
        return (height / maxValue) * this.heightScale;
    }
    
    simplexNoise(x, y) {
        // Simple simplex noise implementation
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        
        x -= Math.floor(x);
        y -= Math.floor(y);
        
        const u = this.fade(x);
        const v = this.fade(y);
        
        const a = this.p[X] + Y;
        const aa = this.p[a];
        const ab = this.p[a + 1];
        const b = this.p[X + 1] + Y;
        const ba = this.p[b];
        const bb = this.p[b + 1];
        
        return this.lerp(v,
            this.lerp(u, this.grad(this.p[aa], x, y),
                this.grad(this.p[ba], x - 1, y)),
            this.lerp(u, this.grad(this.p[ab], x, y - 1),
                this.grad(this.p[bb], x - 1, y - 1))
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
    
    // Permutation table for simplex noise
    get p() {
        if (!this._p) {
            this._p = [];
            for (let i = 0; i < 256; i++) {
                this._p[i] = Math.floor(Math.random() * 256);
            }
            for (let i = 0; i < 256; i++) {
                this._p[256 + i] = this._p[i];
            }
        }
        return this._p;
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
    
    getTileHeight(x, z) {
        return this.getHeight(x, z);
    }
    
    getNormal(x, z) {
        // Calculate terrain normal using height differences
        const delta = 0.1; // Small offset for normal calculation
        
        // Get heights at neighboring points
        const hCenter = this.getHeight(x, z);
        const hRight = this.getHeight(x + delta, z);
        const hLeft = this.getHeight(x - delta, z);
        const hUp = this.getHeight(x, z + delta);
        const hDown = this.getHeight(x, z - delta);
        
        // Calculate gradient vectors
        const dx = (hRight - hLeft) / (2 * delta);
        const dz = (hUp - hDown) / (2 * delta);
        
        // Normal vector (pointing upward from surface)
        const normal = new THREE.Vector3(-dx, 1, -dz);
        normal.normalize();
        
        // Debug logging for first few calls
        if (Math.random() < 0.1) { // Log ~10% of calls to avoid spam
            console.log(`[Terrain] Normal at (${x.toFixed(1)}, ${z.toFixed(1)}): dx=${dx.toFixed(3)}, dz=${dz.toFixed(3)}, normal=${normal.x.toFixed(3)},${normal.y.toFixed(3)},${normal.z.toFixed(3)}`);
        }
        
        return normal;
    }
    
    clearAllChunks() {
        for (const [chunkKey, chunk] of this.chunks) {
            this.scene.remove(chunk.mesh);
            chunk.mesh.geometry.dispose();
            chunk.mesh.material.dispose();
        }
        this.chunks.clear();
    }
}
