class BoardSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.chunks = new Map();
        this.chunkSize = 16;
        this.materialCache = new Map();
        this.lastCameraChunk = { x: -999999, z: -999999 };
        
        // Debug info
        this.debugMode = false;
        this.tilesGenerated = 0;
        this.tilesSkipped = 0;
        
        console.log('[Board] Board system initialized with terrain system:', !!this.terrainSystem);
    }
    
    createBoard() {
        console.log('[Board] Creating board...');
        
        // Create initial 5x5 chunk area around origin
        const initialChunks = [];
        for (let x = -2; x <= 2; x++) {
            for (let z = -2; z <= 2; z++) {
                initialChunks.push({ x, z });
            }
        }
        
        console.log(`[Board] Creating ${initialChunks.length} initial chunks`);
        
        // Create initial chunks
        initialChunks.forEach(chunk => {
            this.createChunk(chunk.x, chunk.z);
        });
        
        console.log('[Board] Board creation complete');
    }
    
    createChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        if (this.chunks.has(chunkKey)) {
            return this.chunks.get(chunkKey);
        }
        
        // Get terrain data from terrain system
        const chunkData = this.terrainSystem ? 
            this.terrainSystem.getChunkData(chunkX, chunkZ, this.chunkSize) : 
            this.generateFlatChunkData(chunkX, chunkZ);
        
        // Create chunk geometry and mesh
        const chunkGeometry = this.createChunkGeometry(chunkData);
        const chunkMaterial = this.getChunkMaterial();
        
        const chunkMesh = new THREE.Mesh(chunkGeometry, chunkMaterial);
        chunkMesh.position.set(chunkX * this.chunkSize, 0, chunkZ * this.chunkSize);
        chunkMesh.castShadow = true;
        chunkMesh.receiveShadow = true;
        
        this.scene.add(chunkMesh);
        
        // Store chunk data
        const chunk = {
            mesh: chunkMesh,
            data: chunkData,
            loaded: true
        };
        
        this.chunks.set(chunkKey, chunk);
        
        return chunk;
    }
    
    generateFlatChunkData(chunkX, chunkZ) {
        const chunk = [];
        
        for (let z = 0; z < this.chunkSize; z++) {
            for (let x = 0; x < this.chunkSize; x++) {
                const worldX = chunkX * this.chunkSize + x;
                const worldZ = chunkZ * this.chunkSize + z;
                
                chunk.push({
                    x: worldX,
                    z: worldZ,
                    height: 0,
                    isBlocked: false,
                    color: { r: 0.2, g: 0.6, b: 0.2 }
                });
            }
        }
        
        return chunk;
    }
    
    createChunkGeometry(chunkData) {
        const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, this.chunkSize, this.chunkSize);
        
        // Get vertex positions and normals
        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal.array;
        
        // Update vertex positions and normals based on terrain data
        for (let i = 0; i < chunkData.length; i++) {
            const tile = chunkData[i];
            const { x, z, height, color } = tile;
            
            // Calculate vertex indices for this tile
            const localX = x % this.chunkSize;
            const localZ = z % this.chunkSize;
            
            // Each tile affects a 2x2 area of vertices (simplified)
            const startX = localX;
            const startZ = localZ;
            const endX = (startX + 1) % this.chunkSize;
            const endZ = (startZ + 1) % this.chunkSize;
            
            // Update vertices for this tile's area
            for (let vz = startZ; vz <= endZ; vz++) {
                for (let vx = startX; vx <= endX; vx++) {
                    const vertexIndex = (vz * (this.chunkSize + 1)) + vx;
                    
                    if (vertexIndex < positions.length / 3) {
                        // Set vertex position
                        positions[vertexIndex * 3] = vx;
                        positions[vertexIndex * 3 + 1] = height;
                        positions[vertexIndex * 3 + 2] = vz;
                        
                        // Calculate normal based on surrounding heights
                        const normal = this.calculateNormalForTile(chunkData, localX, localZ);
                        normals[vertexIndex * 3] = normal.x;
                        normals[vertexIndex * 3 + 1] = normal.y;
                        normals[vertexIndex * 3 + 2] = normal.z;
                    }
                }
            }
        }
        
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.normal.needsUpdate = true;
        geometry.computeVertexNormals();
        
        return geometry;
    }
    
    calculateNormalForTile(chunkData, localX, localZ) {
        // Get heights of surrounding tiles for normal calculation
        const currentHeight = chunkData[localZ * this.chunkSize + localX]?.height || 0;
        
        const heightLeft = (localX > 0) ? 
            chunkData[localZ * this.chunkSize + (localX - 1)]?.height || 0 : currentHeight;
        const heightRight = (localX < this.chunkSize - 1) ? 
            chunkData[localZ * this.chunkSize + (localX + 1)]?.height || 0 : currentHeight;
        const heightUp = (localZ < this.chunkSize - 1) ? 
            chunkData[(localZ + 1) * this.chunkSize + localX]?.height || 0 : currentHeight;
        const heightDown = (localZ > 0) ? 
            chunkData[(localZ - 1) * this.chunkSize + localX]?.height || 0 : currentHeight;
        
        // Calculate normal using finite differences
        const dx = heightRight - heightLeft;
        const dz = heightUp - heightDown;
        
        const normal = new THREE.Vector3(-dx * 0.1, 1, -dz * 0.1);
        normal.normalize();
        
        return normal;
    }
    
    getChunkMaterial() {
        const cacheKey = 'chunkMaterial';
        
        if (this.materialCache.has(cacheKey)) {
            return this.materialCache.get(cacheKey);
        }
        
        const material = new THREE.MeshLambertMaterial({
            color: 0x4a5f3a, // Slightly greenish
            transparent: false,
            opacity: 1.0,
            side: THREE.DoubleSide
        });
        
        this.materialCache.set(cacheKey, material);
        return material;
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
        // Load new chunks
        for (let x = -2; x <= 2; x++) {
            for (let z = -2; z <= 2; z++) {
                const chunkX = cameraChunkX + x;
                const chunkZ = cameraChunkZ + z;
                
                if (!this.chunks.has(`${chunkX},${chunkZ}`)) {
                    this.createChunk(chunkX, chunkZ);
                }
            }
        }
        
        // Unload distant chunks
        const chunksToUnload = [];
        for (const [chunkKey, chunk] of this.chunks) {
            const [x, z] = chunkKey.split(',').map(Number);
            const distance = Math.max(
                Math.abs(x - cameraChunkX),
                Math.abs(z - cameraChunkZ)
            );
            
            if (distance > 3) {
                chunksToUnload.push(chunkKey);
            }
        }
        
        chunksToUnload.forEach(chunkKey => {
            const chunk = this.chunks.get(chunkKey);
            if (chunk && chunk.mesh) {
                this.scene.remove(chunk.mesh);
            }
            this.chunks.delete(chunkKey);
        });
    }
    
    getTerrainHeight(x, z) {
        // FIXED: Use Math.floor for fractional coordinates to prevent array index errors
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(z / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            console.warn(`[Board] No chunk data for (${x}, ${z}) - chunk (${chunkX}, ${chunkZ}) not loaded`);
            return 0;
        }
        
        // Find specific tile in chunk - FIXED: Use Math.floor for fractional coordinates
        const localX = Math.floor(x - (chunkX * this.chunkSize));
        const localZ = Math.floor(z - (chunkZ * this.chunkSize));
        const tileIndex = localZ * this.chunkSize + localX;
        
        const tile = chunk.data[tileIndex];
        if (!tile) {
            console.warn(`[Board] No tile data for (${x}, ${z}) in chunk (${chunkX}, ${chunkZ})`);
            return 0;
        }
        
        return tile.height || 0;
    }
    
    getTileHeight(x, z) {
        return this.getTerrainHeight(x, z);
    }
    
    isTileBlocked(x, z) {
        // Check if tile is blocked by terrain
        const height = this.getTileHeight(x, z);
        const slope = this.calculateSlope(x, z, height);
        return slope > 20; // Degrees - reduced from 45 to generate more blocked tiles
    }
    
    calculateSlope(x, z, height) {
        const delta = 0.1;
        const h1 = this.getTileHeight(x + delta, z);
        const h2 = this.getTileHeight(x - delta, z);
        const h3 = this.getTileHeight(x, z + delta);
        const h4 = this.getTileHeight(x, z - delta);
        
        const dx = (h2 - h1) / (2 * delta);
        const dz = (h4 - h3) / (2 * delta);
        
        return Math.atan(Math.sqrt(dx * dx + dz * dz)) * (180 / Math.PI);
    }
    
    getNormal(x, z) {
        // Calculate terrain normal using finite differences
        const delta = 0.1;
        
        // Sample heights at neighboring points
        const hCenter = this.getTerrainHeight(x, z);
        const hRight = this.getTerrainHeight(x + delta, z);
        const hLeft = this.getTerrainHeight(x - delta, z);
        const hUp = this.getTerrainHeight(x, z + delta);
        const hDown = this.getTerrainHeight(x, z - delta);
        
        // Calculate gradients
        const dx = (hRight - hLeft) / (2 * delta);
        const dz = (hUp - hDown) / (2 * delta);
        
        // Create normal vector (pointing upward from surface)
        const normal = new THREE.Vector3(-dx, 1, -dz);
        normal.normalize();
        
        return normal;
    }
    
    clearCache() {
        this.materialCache.clear();
    }
    
    dispose() {
        // Clean up all chunks
        for (const [chunkKey, chunk] of this.chunks) {
            if (chunk.mesh) {
                this.scene.remove(chunk.mesh);
                if (chunk.mesh.geometry) {
                    chunk.mesh.geometry.dispose();
                }
                if (chunk.mesh.material) {
                    chunk.mesh.material.dispose();
                }
            }
        }
        
        this.chunks.clear();
        this.materialCache.clear();
    }
}
