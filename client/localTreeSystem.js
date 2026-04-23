class LocalTreeSystem {
    constructor(scene, terrainSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.trees = new Map();
        this.treeTemplate = null;
        
        // Initialize tree materials (fully visible by default)
        this.treeMaterials = {
            trunk: new THREE.MeshLambertMaterial({ 
                color: 0x8B4513, // Brown color for trunk
                transparent: false,
                opacity: 1.0
            }),
            leaves: new THREE.MeshLambertMaterial({ 
                color: 0x228B22, // Forest green for leaves
                transparent: false,
                opacity: 1.0
            })
        };
        
        // Create tree template
        this.createTreeTemplate();
        
        // Camera position for distance calculations (start at origin)
        this.cameraPosition = new THREE.Vector3(0, 0, 0);
        
        // Tree loading settings - SIMPLIFIED DISTANCE SYSTEM
        this.treeLoadDistance = 50; // Load trees within 50 units
        this.fogDistance = 50; // Match fog far distance
        this.chunkSize = 16;
        this.lastCameraChunk = { x: -999999, z: -999999 };
    }

    createTreeTemplate() {
        this.treeTemplate = this.createNintendoishTree();
        this.treeTemplate.visible = false; // Hide template
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

    cloneTree() {
        return this.treeTemplate.clone();
    }

    addTreeToTile(x, z, height) {
        const key = `${x},${z}`;
        if (this.trees.has(key)) {
            return; // Tree already exists
        }
        
        // console.log(`[TreeDebug] Creating tree at (${x}, ${z}) height=${height}`); // TEMPORARILY DISABLED
        
        const tree = this.cloneTree();
        tree.position.set(x + 0.5, height + 0.3, z + 0.5);
        
        // Force tree and all children to be visible
        tree.visible = true;
        tree.traverse(child => {
            if (child.isMesh) {
                child.visible = true;
            }
        });
        
        let meshCount = 0;
        tree.traverse(child => {
            if (child.isMesh) {
                meshCount++;
                child.castShadow = true;
                child.receiveShadow = true;
                child.renderOrder = 2;
                child.depthTest = true;
                child.depthWrite = true;
                
                // Ensure material is visible
                if (child.material) {
                    child.material.opacity = 1.0;
                    child.material.transparent = false;
                    child.material.visible = true;
                    
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => {
                            mat.opacity = 1.0;
                            mat.transparent = false;
                            mat.visible = true;
                            if (mat.color) {
                                mat.color.setHex(0x2d4a2b);
                            }
                            mat.needsUpdate = true;
                        });
                    } else if (child.material.color) {
                        child.material.color.setHex(0x2d4a2b);
                        child.material.needsUpdate = true;
                    }
                }
            }
        });
        
        // console.log(`[TreeDebug] Tree has ${meshCount} meshes, visible=${tree.visible}`); // TEMPORARILY DISABLED
        this.scene.add(tree);
        this.trees.set(key, tree);
        // console.log(`[TreeDebug] Tree added to scene, total trees: ${this.trees.size}`); // TEMPORARILY DISABLED
    }

    removeTreeFromTile(x, z) {
        const key = `${x},${z}`;
        const tree = this.trees.get(key);
        
        if (tree) {
            this.scene.remove(tree);
            this.trees.delete(key);
        }
    }

    isWithinTreeLoadDistance(x, z) {
        const treePosition = new THREE.Vector3(x + 0.5, 0, z + 0.5);
        const distance = treePosition.distanceTo(this.cameraPosition);
        return distance <= this.treeLoadDistance;
    }

    calculateOpacity(distance) {
        // SIMPLIFIED - ALL TREES ALWAYS VISIBLE
        return 1.0;
    }

    
    updateCameraPosition(cameraPosition) {
        this.cameraPosition.copy(cameraPosition);
        
        // Update trees more frequently - every 4 units instead of 16 (chunk size)
        const cameraGridX = Math.floor(cameraPosition.x / 4);
        const cameraGridZ = Math.floor(cameraPosition.z / 4);
        
        if (cameraGridX !== this.lastCameraChunk.x || cameraGridZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: cameraGridX, z: cameraGridZ };
            this.updateTreesFromServerData();
        }
    }

    async updateTreesFromServerData() {
        const chunksToCheck = this.getChunksInRange();
        
        // Process chunks in parallel with batching
        const chunkPromises = [];
        for (const chunkX of chunksToCheck.x) {
            for (const chunkZ of chunksToCheck.z) {
                chunkPromises.push(this.processChunk(chunkX, chunkZ));
            }
        }
        
        // Wait for all chunks to be processed
        await Promise.all(chunkPromises);
        
        // Remove trees outside fog distance
        this.removeDistantTrees();
    }

    processChunk(chunkX, chunkZ) {
        // Get terrain data from terrain system (no API calls needed)
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunk = this.terrainSystem.chunks.get(chunkKey);
        
        if (!chunk || !chunk.data) {
            console.warn(`[LocalTreeSystem] No terrain data found for chunk (${chunkX}, ${chunkZ})`);
            return;
        }


        // Process all tiles in this chunk using existing terrain data
        const treesToAdd = [];
        const treesToRemove = [];
        let blockedTileCount = 0;
        let treeDistanceTileCount = 0;

        for (const tile of chunk.data) {
            const { x, z, height, isBlocked } = tile;
            
            if (isBlocked) {
                blockedTileCount++;
            }
            
            if (this.isWithinTreeLoadDistance(x, z)) {
                treeDistanceTileCount++;
                // Trees grow on steep slopes (blocked), not flat terrain (not blocked)
                if (isBlocked) {
                    // Add tree on every blocked tile (consistent positioning)
                    treesToAdd.push({ x, z, height });
                    // console.log(`[TreeDebug] Will add tree at (${x}, ${z})`); // TEMPORARILY DISABLED
                } else {
                    treesToRemove.push({ x, z });
                }
            } else {
                treesToRemove.push({ x, z });
            }
        }
        
        // console.log(`[TreeDebug] Chunk (${chunkKey}): ${blockedTileCount} blocked, ${treeDistanceTileCount} in distance, ${treesToAdd.length} to add`);
        

        // Remove trees first
        for (const { x, z } of treesToRemove) {
            this.removeTreeFromTile(x, z);
        }

        // Add all trees at once (instant deployment with fade effect)
        for (const { x, z, height } of treesToAdd) {
            this.addTreeToTile(x, z, height);
        }

    }

    updateTreesForChunk(chunkX, chunkZ, chunkSize) {
        // Method to match terrain system interface (synchronous now)
        this.processChunk(chunkX, chunkZ);
    }

    updateTreeFade() {
        // Update opacity for all trees based on distance to camera
        let debugCount = 0;
        for (const [key, tree] of this.trees) {
            const [x, z] = key.split(',').map(Number);
            const treePosition = new THREE.Vector3(x + 0.5, 0, z + 0.5);
            const distance = treePosition.distanceTo(this.cameraPosition);
            
            const opacity = this.calculateOpacity(distance);
            
            // Debug first few trees
            if (debugCount < 3) {
                console.log(`[TreeFadeDebug] Tree at (${x},${z}): distance=${distance.toFixed(2)}, opacity=${opacity.toFixed(2)}`);
                debugCount++;
            }
            
            // Update opacity for all meshes in the tree group
            tree.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.opacity = opacity;
                    child.material.transparent = opacity < 1.0;
                    child.material.needsUpdate = true; // Force material update
                }
            });
        }
    }

    getChunksInRange() {
        const minChunkX = Math.floor((this.cameraPosition.x - this.treeLoadDistance) / 16);
        const maxChunkX = Math.ceil((this.cameraPosition.x + this.treeLoadDistance) / 16);
        const minChunkZ = Math.floor((this.cameraPosition.z - this.treeLoadDistance) / 16);
        const maxChunkZ = Math.ceil((this.cameraPosition.z + this.treeLoadDistance) / 16);
        
        const chunks = { x: [], z: [] };
        for (let x = minChunkX; x <= maxChunkX; x++) {
            chunks.x.push(x);
        }
        for (let z = minChunkZ; z <= maxChunkZ; z++) {
            chunks.z.push(z);
        }
        
        return chunks;
    }

    removeDistantTrees() {
        const treesToRemove = [];
        
        for (const [key, tree] of this.trees) {
            const [x, z] = key.split(',').map(Number);
            if (!this.isWithinTreeLoadDistance(x, z)) {
                treesToRemove.push({ x, z });
            }
        }
        
        for (const { x, z } of treesToRemove) {
            this.removeTreeFromTile(x, z);
        }
    }
}
