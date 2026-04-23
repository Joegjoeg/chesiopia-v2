class EfficientTreeSystem {
    constructor(scene) {
        this.scene = scene;
        this.trees = new Map();
        this.fogDistance = 40;
        this.cameraPosition = new THREE.Vector3();
        this.lastCameraChunk = { x: -999, z: -999 };
        
        // Tree materials
        this.treeMaterials = {
            trunk: new THREE.MeshLambertMaterial({ color: 0x8B4513 }),
            leaves: new THREE.MeshLambertMaterial({ color: 0x228B22 })
        };
        
        // Cache for terrain data
        this.terrainCache = new Map();
        this.cacheExpiry = 30000; // 30 seconds
    }

    createNintendoishTree() {
        const tree = new THREE.Group();
        
        // Create trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.5, 8);
        const trunk = new THREE.Mesh(trunkGeometry, this.treeMaterials.trunk);
        trunk.position.set(0, -0.75, 0);
        tree.add(trunk);
        
        // Create leaves
        const leafGeometry = new THREE.SphereGeometry(0.6, 8, 6);
        const leaves = new THREE.Mesh(leafGeometry, this.treeMaterials.leaves);
        leaves.position.set(0, 0.25, 0);
        leaves.scale.set(1, 1.2, 1);
        tree.add(leaves);
        
        // Add smaller leaf spheres
        const smallLeafGeometry = new THREE.SphereGeometry(0.4, 6, 5);
        
        // Side leaves
        const leftLeaf = new THREE.Mesh(smallLeafGeometry, this.treeMaterials.leaves);
        leftLeaf.position.set(-0.35, 0.15, 0);
        tree.add(leftLeaf);
        
        const rightLeaf = new THREE.Mesh(smallLeafGeometry, this.treeMaterials.leaves);
        rightLeaf.position.set(0.35, 0.15, 0);
        tree.add(rightLeaf);
        
        // Front and back leaves
        const frontLeaf = new THREE.Mesh(smallLeafGeometry, this.treeMaterials.leaves);
        frontLeaf.position.set(0, 0.15, -0.35);
        tree.add(frontLeaf);
        
        const backLeaf = new THREE.Mesh(smallLeafGeometry, this.treeMaterials.leaves);
        backLeaf.position.set(0, 0.15, 0.35);
        tree.add(backLeaf);
        
        // Top leaf
        const topLeaf = new THREE.Mesh(smallLeafGeometry, this.treeMaterials.leaves);
        topLeaf.position.set(0, 0.65, 0);
        topLeaf.scale.set(0.8, 1.1, 0.8);
        tree.add(topLeaf);
        
        return tree;
    }

    async getTerrainData(x, z) {
        const key = `${x},${z}`;
        const cached = this.terrainCache.get(key);
        
        // Check cache first
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        
        // Fetch from server
        try {
            const response = await fetch(`/api/terrain/${x}/${z}`);
            const data = await response.json();
            
            // Cache the result
            this.terrainCache.set(key, {
                data: data,
                timestamp: Date.now()
            });
            
            return data;
        } catch (error) {
            console.warn(`[EfficientTreeSystem] Failed to get terrain data for (${x}, ${z}):`, error);
            return { height: 0, isBlocked: false };
        }
    }

    addTreeToTile(x, z, height) {
        const key = `${x},${z}`;
        
        if (this.trees.has(key)) {
            return; // Tree already exists
        }
        
        const tree = this.createNintendoishTree();
        tree.position.set(x + 0.5, height + 0.02 + 0.75, z + 0.5);
        
        this.scene.add(tree);
        this.trees.set(key, tree);
    }

    removeTreeFromTile(x, z) {
        const key = `${x},${z}`;
        const tree = this.trees.get(key);
        
        if (tree) {
            this.scene.remove(tree);
            this.trees.delete(key);
        }
    }

    isWithinFogDistance(x, z) {
        const treePosition = new THREE.Vector3(x + 0.5, 0, z + 0.5);
        const distance = treePosition.distanceTo(this.cameraPosition);
        return distance <= this.fogDistance;
    }

    updateCameraPosition(cameraPosition) {
        this.cameraPosition.copy(cameraPosition);
        
        // Only update when camera moves to a new chunk
        const cameraChunkX = Math.floor(cameraPosition.x / 16);
        const cameraChunkZ = Math.floor(cameraPosition.z / 16);
        
        if (cameraChunkX !== this.lastCameraChunk.x || cameraChunkZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: cameraChunkX, z: cameraChunkZ };
            this.updateTreesIncremental();
        }
    }

    async updateTreesIncremental() {
        const chunksToCheck = this.getChunksInRange();
        
        // Collect all tiles to check
        const tilesToCheck = [];
        for (const chunkX of chunksToCheck.x) {
            for (const chunkZ of chunksToCheck.z) {
                for (let x = 0; x < 16; x++) {
                    for (let z = 0; z < 16; z++) {
                        const worldX = chunkX * 16 + x;
                        const worldZ = chunkZ * 16 + z;
                        tilesToCheck.push({ x: worldX, z: worldZ });
                    }
                }
            }
        }
        
        // Batch process tiles
        const batchSize = 50; // Process 50 tiles at a time
        for (let i = 0; i < tilesToCheck.length; i += batchSize) {
            const batch = tilesToCheck.slice(i, i + batchSize);
            await this.processTileBatch(batch);
            
            // Small delay to prevent blocking
            if (i + batchSize < tilesToCheck.length) {
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }
        
        // Remove trees outside fog distance
        this.removeDistantTrees();
        
        // Clean old cache entries
        this.cleanCache();
    }

    getChunksInRange() {
        const minChunkX = Math.floor((this.cameraPosition.x - this.fogDistance) / 16);
        const maxChunkX = Math.ceil((this.cameraPosition.x + this.fogDistance) / 16);
        const minChunkZ = Math.floor((this.cameraPosition.z - this.fogDistance) / 16);
        const maxChunkZ = Math.ceil((this.cameraPosition.z + this.fogDistance) / 16);
        
        const chunks = { x: [], z: [] };
        for (let x = minChunkX; x <= maxChunkX; x++) {
            chunks.x.push(x);
        }
        for (let z = minChunkZ; z <= maxChunkZ; z++) {
            chunks.z.push(z);
        }
        
        return chunks;
    }

    async processTileBatch(tiles) {
        for (const tile of tiles) {
            if (this.isWithinFogDistance(tile.x, tile.z)) {
                const terrainData = await this.getTerrainData(tile.x, tile.z);
                if (terrainData.isBlocked) {
                    this.addTreeToTile(tile.x, tile.z, terrainData.height);
                } else {
                    this.removeTreeFromTile(tile.x, tile.z);
                }
            } else {
                this.removeTreeFromTile(tile.x, tile.z);
            }
        }
    }

    removeDistantTrees() {
        const treesToRemove = [];
        
        for (const [key, tree] of this.trees) {
            const [x, z] = key.split(',').map(Number);
            if (!this.isWithinFogDistance(x, z)) {
                treesToRemove.push({ x, z });
            }
        }
        
        for (const { x, z } of treesToRemove) {
            this.removeTreeFromTile(x, z);
        }
    }

    cleanCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, cached] of this.terrainCache) {
            if (now - cached.timestamp > this.cacheExpiry) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.terrainCache.delete(key);
        }
    }
}
