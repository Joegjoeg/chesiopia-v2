class CleanBoardSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.chunks = new Map();
        this.tileCache = new Map();
        this.maxCacheSize = 10000;
        
        // Board configuration
        this.chunkSize = 16;
        this.renderDistance = 6;
        this.fadeDistance = 2; // Distance over which chunks fade in/out
        
        // Fade tracking
        this.chunkFadeStates = new Map();
        
        // Materials
        this.lightTileColor = new THREE.Color(0xf0d9b5); // Light wood
        this.darkTileColor = new THREE.Color(0xb58863);  // Dark wood
        this.highlightColor = new THREE.Color(0x7fc97f);
        this.selectedColor = new THREE.Color(0xf4a460);
        
        this.boardMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 1.0
        });
        
        // Terrain system reference
        this.terrainSystem = terrainSystem;
        
        // Streaming state
        this.lastCameraChunk = { x: -999999, z: -999999 };
        
        console.log(`[Board] Board system initialized with terrain system: ${this.terrainSystem ? 'YES' : 'NO'}`);
    }
    
    createBoard(centerX, centerZ, radius) {
        const promises = [];
        
        for (let x = -radius; x <= radius; x++) {
            for (let z = -radius; z <= radius; z++) {
                const chunkX = Math.floor(centerX / this.chunkSize) + x;
                const chunkZ = Math.floor(centerZ / this.chunkSize) + z;
                
                promises.push(this.createChunk(chunkX, chunkZ));
            }
        }
        
        return Promise.all(promises);
    }
    
    updateStreaming(cameraPosition) {
        const cameraChunkX = Math.floor(cameraPosition.x / this.chunkSize);
        const cameraChunkZ = Math.floor(cameraPosition.z / this.chunkSize);
        
        // Check if camera moved to a new chunk
        if (cameraChunkX !== this.lastCameraChunk.x || cameraChunkZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: cameraChunkX, z: cameraChunkZ };
            this.updateBoardChunks(cameraChunkX, cameraChunkZ);
        }
        
        // Update fade states
        this.updateChunkFades(cameraChunkX, cameraChunkZ);
    }
    
    updateChunkFades(cameraChunkX, cameraChunkZ) {
        for (const [chunkKey, chunk] of this.chunks) {
            const distance = Math.max(
                Math.abs(chunk.x - cameraChunkX),
                Math.abs(chunk.z - cameraChunkZ)
            );
            
            let targetOpacity = 1.0;
            
            // Calculate fade based on distance
            if (distance > this.renderDistance - this.fadeDistance) {
                const fadeStart = this.renderDistance - this.fadeDistance;
                const fadeEnd = this.renderDistance;
                const fadeProgress = (distance - fadeStart) / (fadeEnd - fadeStart);
                targetOpacity = Math.max(0, 1.0 - fadeProgress);
            }
            
            // Get or create fade state
            let fadeState = this.chunkFadeStates.get(chunkKey);
            if (!fadeState) {
                fadeState = { opacity: targetOpacity, targetOpacity: targetOpacity, fadeIn: true };
                this.chunkFadeStates.set(chunkKey, fadeState);
            }
            
            // Update target opacity
            fadeState.targetOpacity = targetOpacity;
            
            // Smooth fade transition
            const fadeSpeed = 0.1;
            if (Math.abs(fadeState.opacity - fadeState.targetOpacity) > 0.01) {
                fadeState.opacity += (fadeState.targetOpacity - fadeState.opacity) * fadeSpeed;
                chunk.mesh.material.opacity = fadeState.opacity;
            }
        }
    }
    
    updateBoardChunks(cameraChunkX, cameraChunkZ) {
        // Load new chunks within render distance
        for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
            for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
                const chunkX = cameraChunkX + x;
                const chunkZ = cameraChunkZ + z;
                const chunkKey = `${chunkX},${chunkZ}`;
                
                if (!this.chunks.has(chunkKey)) {
                    this.createChunk(chunkX, chunkZ);
                }
            }
        }
        
        // Unload distant chunks
        for (const [chunkKey, chunk] of this.chunks) {
            const distance = Math.max(
                Math.abs(chunk.x - cameraChunkX),
                Math.abs(chunk.z - cameraChunkZ)
            );
            
            if (distance > this.renderDistance + 1) {
                this.unloadChunk(chunkKey);
            }
        }
        
        // Clean up fully faded chunks
        this.removeFullyFadedChunks();
    }
    
    unloadChunk(chunkKey) {
        const chunk = this.chunks.get(chunkKey);
        if (chunk) {
            // Start fade-out
            const fadeState = this.chunkFadeStates.get(chunkKey);
            if (fadeState) {
                fadeState.targetOpacity = 0.0;
                fadeState.fadeIn = false;
            } else {
                // If no fade state, remove immediately
                this.scene.remove(chunk.mesh);
                this.chunks.delete(chunkKey);
            }
        }
    }
    
    // Method to actually remove fully faded chunks
    removeFullyFadedChunks() {
        for (const [chunkKey, fadeState] of this.chunkFadeStates) {
            if (fadeState.opacity <= 0.01 && fadeState.targetOpacity <= 0.01) {
                const chunk = this.chunks.get(chunkKey);
                if (chunk) {
                    this.scene.remove(chunk.mesh);
                    this.chunks.delete(chunkKey);
                    this.chunkFadeStates.delete(chunkKey);
                }
            }
        }
    }
    
    async createChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        
        
        if (this.chunks.has(chunkKey)) {
            return;
        }
        
        // Create unified mesh for this chunk
                const geometry = this.createChunkGeometry(chunkX, chunkZ);
        
        const material = this.boardMaterial.clone();
        material.opacity = 0.0; // Start invisible for fade-in
        const mesh = new THREE.Mesh(geometry, material);
        
        mesh.position.set(
            chunkX * this.chunkSize,
            0,
            chunkZ * this.chunkSize
        );
        
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        
        this.scene.add(mesh);
        
        // Initialize fade state
        this.chunkFadeStates.set(chunkKey, {
            opacity: 0.0,
            targetOpacity: 1.0,
            fadeIn: true
        });
        
        // Store chunk data
        this.chunks.set(chunkKey, {
            mesh: mesh,
            x: chunkX,
            z: chunkZ,
            geometry: geometry
        });
    }
    
    createChunkGeometry(chunkX, chunkZ) {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const colors = [];
        const indices = [];
        const normals = [];
        
        let tileCount = 0;
        
        // Create individual tiles with precise positioning
        for (let x = 0; x < this.chunkSize; x++) {
            for (let z = 0; z < this.chunkSize; z++) {
                const worldX = chunkX * this.chunkSize + x;
                const worldZ = chunkZ * this.chunkSize + z;
                
                // Get terrain height at tile corners
                const height00 = this.getTerrainHeight(worldX, worldZ);
                const height10 = this.getTerrainHeight(worldX + 1, worldZ);
                const height01 = this.getTerrainHeight(worldX, worldZ + 1);
                const height11 = this.getTerrainHeight(worldX + 1, worldZ + 1);
                
                // Determine if tile is light or dark
                const isLight = (Math.floor(worldX) + Math.floor(worldZ)) % 2 === 0;
                const tileColor = isLight ? this.lightTileColor : this.darkTileColor;
                
                tileCount++;
                
                // Create 4 vertices for the tile with slight overlap to eliminate gaps
                const baseIndex = vertices.length / 3;
                const overlap = 0.001; // Tiny overlap to ensure no gaps
                
                // Bottom-left
                vertices.push(x - overlap, height00, z - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                
                // Bottom-right
                vertices.push(x + 1 + overlap, height10, z - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                
                // Top-left
                vertices.push(x - overlap, height01, z + 1 + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                
                // Top-right
                vertices.push(x + 1 + overlap, height11, z + 1 + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                
                // Create indices for two triangles
                // First triangle (bottom-left, bottom-right, top-left)
                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                
                // Second triangle (bottom-right, top-right, top-left)
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }
        
        // Calculate normals
        this.calculateNormals(vertices, indices, normals);
        
        // Set geometry attributes
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setIndex(indices);
        
        return geometry;
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
    
    getTerrainHeight(x, z) {
        if (this.terrainSystem) {
            return this.terrainSystem.getHeight(x, z);
        }
        return 0;
    }
    
    getTileHeight(x, z) {
        return this.getTerrainHeight(x, z);
    }
    
    isTileBlocked(x, z) {
        // Check if tile is blocked by terrain
        const height = this.getTileHeight(x, z);
        const slope = this.calculateSlope(x, z, height);
        const isBlocked = slope > 60; // Degrees - increased from 20 to allow movement on reasonable terrain
        console.log(`[Board] isTileBlocked(${x}, ${z}): height=${height.toFixed(3)}, slope=${slope.toFixed(1)}°, blocked=${isBlocked}`);
        return isBlocked;
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
    
    getTileFromIntersection(intersection) {
        const point = intersection.point;
        return {
            x: Math.floor(point.x),
            z: Math.floor(point.z)
        };
    }
    
    getBoardMeshes() {
        const meshes = [];
        for (const chunk of this.chunks.values()) {
            meshes.push(chunk.mesh);
        }
        return meshes;
    }
    
    highlightTile(x, z, color) {
        // This would update the vertex colors for the specific tile
        // For now, we'll implement a simpler version
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(z / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(chunkKey);
        if (chunk) {
            // Update vertex colors for the highlighted tile
            this.updateTileColor(chunk, x, z, color);
        }
    }
    
    updateTileColor(chunk, tileX, tileZ, color) {
        const localX = tileX - chunk.x * this.chunkSize;
        const localZ = tileZ - chunk.z * this.chunkSize;
        
        if (localX < 0 || localX >= this.chunkSize || localZ < 0 || localZ >= this.chunkSize) {
            return;
        }
        
        const geometry = chunk.geometry;
        const colors = geometry.attributes.color.array;
        
        // Update colors for the 4 vertices of the tile
        const baseIndex = (localX * this.chunkSize + localZ) * 4 * 3;
        
        for (let i = 0; i < 4; i++) {
            const vertexIndex = baseIndex + i * 3;
            colors[vertexIndex] = color.r;
            colors[vertexIndex + 1] = color.g;
            colors[vertexIndex + 2] = color.b;
        }
        
        geometry.attributes.color.needsUpdate = true;
    }
    
    resetTileColor(x, z) {
        const isLight = (Math.floor(x) + Math.floor(z)) % 2 === 0;
        const color = isLight ? this.lightTileColor : this.darkTileColor;
        this.highlightTile(x, z, color);
    }
    
    clearHighlights() {
        // Reset all tiles to their original colors
        for (const chunk of this.chunks.values()) {
            const geometry = chunk.geometry;
            const colors = geometry.attributes.color.array;
            
            // Reset all colors to original board colors
            for (let x = 0; x < this.chunkSize; x++) {
                for (let z = 0; z < this.chunkSize; z++) {
                    const worldX = chunk.x * this.chunkSize + x;
                    const worldZ = chunk.z * this.chunkSize + z;
                    const isLight = (Math.floor(worldX) + Math.floor(worldZ)) % 2 === 0;
                    const tileColor = isLight ? this.lightTileColor : this.darkTileColor;
                    
                    const baseIndex = (x * this.chunkSize + z) * 4 * 3;
                    
                    for (let i = 0; i < 4; i++) {
                        const vertexIndex = baseIndex + i * 3;
                        colors[vertexIndex] = tileColor.r;
                        colors[vertexIndex + 1] = tileColor.g;
                        colors[vertexIndex + 2] = tileColor.b;
                    }
                }
            }
            
            geometry.attributes.color.needsUpdate = true;
        }
    }
    
    removeChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunk = this.chunks.get(chunkKey);
        
        if (chunk) {
            // Remove board mesh
            this.scene.remove(chunk.mesh);
            chunk.geometry.dispose();
            chunk.mesh.material.dispose();
            
            this.chunks.delete(chunkKey);
        }
    }
    
    clearAllChunks() {
        for (const [chunkKey, chunk] of this.chunks) {
            // Remove board mesh
            this.scene.remove(chunk.mesh);
            chunk.geometry.dispose();
            chunk.mesh.material.dispose();
        }
        this.chunks.clear();
    }
    
    clearCache() {
        this.tileCache.clear();
    }
    
    // Update board to match terrain
    updateBoardForTerrain(terrainSystem) {
        for (const [chunkKey, chunk] of this.chunks) {
            this.updateChunkGeometry(chunk, terrainSystem);
        }
    }
    
    updateChunkGeometry(chunk, terrainSystem) {
        const geometry = chunk.geometry;
        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal.array;
        const indices = geometry.index.array;
        
        // Update vertex heights to match terrain
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            const worldX = chunk.x * this.chunkSize + x;
            const worldZ = chunk.z * this.chunkSize + z;
            
            positions[i + 1] = terrainSystem.getTileHeight(worldX, worldZ);
        }
        
        // Recalculate normals
        this.calculateNormals(Array.from(positions), Array.from(indices), normals);
        
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.normal.needsUpdate = true;
    }
    
    clearTerrainCache() {
        // Clear any cached terrain data
        this.terrainCache = this.terrainCache || new Map();
        this.terrainCache.clear();
        console.log('[Board] Terrain cache cleared');
    }
    
    updateTerrainMesh() {
        // Update all board chunks with new terrain data
        console.log('[Board] Updating terrain mesh with new data');
        
        for (const [chunkKey, chunk] of this.chunks) {
            if (chunk.mesh && this.terrainSystem) {
                this.updateChunkWithTerrain(chunk, this.terrainSystem);
            }
        }
    }
}
