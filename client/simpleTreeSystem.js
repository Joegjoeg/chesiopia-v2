class SimpleTreeSystem {
    constructor(scene) {
        this.scene = scene;
        this.trees = new Map();
        this.fogDistance = 40; // Same as fog far distance
        this.cameraPosition = new THREE.Vector3();
        
        // Tree materials
        this.treeMaterials = {
            trunk: new THREE.MeshLambertMaterial({ color: 0x8B4513 }), // Brown
            leaves: new THREE.MeshLambertMaterial({ color: 0x228B22 })  // Forest green
        };
    }

    createNintendoishTree() {
        const tree = new THREE.Group();
        
        // Create trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.5, 8);
        const trunk = new THREE.Mesh(trunkGeometry, this.treeMaterials.trunk);
        trunk.position.set(0, -0.75, 0); // Center at ground level
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

    async addTreeToTile(x, z) {
        const key = `${x},${z}`;
        
        // Remove existing tree if present
        if (this.trees.has(key)) {
            this.removeTreeFromTile(x, z);
        }
        
        // Get terrain height from server
        const height = await this.getTerrainHeight(x, z);
        
        // Create tree
        const tree = this.createNintendoishTree();
        
        // Position tree
        tree.position.set(x + 0.5, height + 0.02 + 0.75, z + 0.5);
        
        // Add to scene
        this.scene.add(tree);
        this.trees.set(key, tree);
        
        console.log(`[SimpleTreeSystem] Added tree at (${x}, ${z})`);
    }

    removeTreeFromTile(x, z) {
        const key = `${x},${z}`;
        const tree = this.trees.get(key);
        
        if (tree) {
            this.scene.remove(tree);
            this.trees.delete(key);
            console.log(`[SimpleTreeSystem] Removed tree at (${x}, ${z})`);
        }
    }

    async getTerrainHeight(x, z) {
        try {
            const response = await fetch(`/api/terrain/${x}/${z}`);
            const data = await response.json();
            return data.height || 0;
        } catch (error) {
            console.warn(`[SimpleTreeSystem] Failed to get terrain height for (${x}, ${z}):`, error);
            return 0;
        }
    }

    async isTileBlocked(x, z) {
        try {
            const response = await fetch(`/api/terrain/${x}/${z}`);
            const data = await response.json();
            return data.isBlocked || false;
        } catch (error) {
            console.warn(`[SimpleTreeSystem] Failed to check if tile (${x}, ${z}) is blocked:`, error);
            return false;
        }
    }

    isWithinFogDistance(x, z) {
        const treePosition = new THREE.Vector3(x + 0.5, 0, z + 0.5);
        const distance = treePosition.distanceTo(this.cameraPosition);
        return distance <= this.fogDistance;
    }

    updateCameraPosition(cameraPosition) {
        this.cameraPosition.copy(cameraPosition);
        this.updateTrees();
    }

    async updateTrees() {
        // Get all tiles within fog distance
        const minChunkX = Math.floor((this.cameraPosition.x - this.fogDistance) / 16);
        const maxChunkX = Math.ceil((this.cameraPosition.x + this.fogDistance) / 16);
        const minChunkZ = Math.floor((this.cameraPosition.z - this.fogDistance) / 16);
        const maxChunkZ = Math.ceil((this.cameraPosition.z + this.fogDistance) / 16);
        
        console.log(`[SimpleTreeSystem] Updating trees in range: chunks (${minChunkX},${minChunkZ}) to (${maxChunkX},${maxChunkZ})`);
        
        // Clear all existing trees first (simple approach)
        for (const [key, tree] of this.trees) {
            this.scene.remove(tree);
        }
        this.trees.clear();
        
        // Check all tiles within range
        for (let x = minChunkX * 16; x <= maxChunkX * 16; x++) {
            for (let z = minChunkZ * 16; z <= maxChunkZ * 16; z++) {
                if (this.isWithinFogDistance(x, z)) {
                    const isBlocked = await this.isTileBlocked(x, z);
                    if (isBlocked) {
                        await this.addTreeToTile(x, z);
                    }
                }
            }
        }
        
        console.log(`[SimpleTreeSystem] Update complete. Total trees: ${this.trees.size}`);
    }
}
