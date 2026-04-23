class TreeSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.trees = new Map(); // Map to store tree meshes by tile coordinates
        this.debugSpheres = new Map(); // Map to store debug spheres by tile coordinates
        this.treeMaterials = this.createTreeMaterials();
        
        // Tree culling settings - match fog distance
        this.maxTreeDistance = 40; // Same as fog far distance
        this.cameraPosition = new THREE.Vector3();
    }

    updateCameraPosition(cameraPosition) {
        this.cameraPosition.copy(cameraPosition);
        this.cullDistantTrees();
    }

    cullDistantTrees() {
        const maxDistanceSq = this.maxTreeDistance * this.maxTreeDistance;
        let culledCount = 0;
        let addedCount = 0;
        let totalTrees = this.trees.size;

        for (const [key, tree] of this.trees) {
            const distance = tree.position.distanceToSquared(this.cameraPosition);
            
            if (distance > maxDistanceSq) {
                // Tree is beyond fog distance, remove from scene
                this.scene.remove(tree);
                culledCount++;
            } else if (!tree.parent) {
                // Tree is within distance but not in scene, add it back
                this.scene.add(tree);
                addedCount++;
            }
        }

        if (culledCount > 0 || addedCount > 0) {
            console.log(`[TreeSystem] Trees: Culled ${culledCount}, Added ${addedCount}, Total in scene: ${totalTrees - culledCount + addedCount}`);
        }
    }

    isTreeInDistance(worldX, worldZ) {
        // Get actual tree height from terrain for accurate distance calculation
        const treeHeight = this.terrainSystem ? this.terrainSystem.getHeight(worldX, worldZ) : 0;
        const treePosition = new THREE.Vector3(worldX + 0.5, treeHeight, worldZ + 0.5);
        
        // Check if camera position is valid
        if (!this.cameraPosition) {
            console.log(`[TreeSystem] Camera position not initialized, allowing tree at (${worldX}, ${worldZ})`);
            return true;
        }
        
        const distance = treePosition.distanceTo(this.cameraPosition);
        const inDistance = distance <= this.maxTreeDistance;
        
        // Debug logging for first few trees only to avoid spam
        if (this.trees.size < 5 || !inDistance) {
            console.log(`[TreeSystem] Tree at (${worldX}, ${worldZ}): distance=${distance.toFixed(1)}, max=${this.maxTreeDistance}, inDistance=${inDistance}`);
        }
        
        return inDistance;
    }

    createTreeMaterials() {
        return {
            trunk: new THREE.MeshStandardMaterial({
                color: 0x8B4513, // Brown trunk
                roughness: 0.8,
                metalness: 0.0
            }),
            leaves: new THREE.MeshStandardMaterial({
                color: 0x228B22, // Forest green leaves
                roughness: 0.9,
                metalness: 0.0
            }),
            snowLeaves: new THREE.MeshStandardMaterial({
                color: 0xF0F8FF, // Snow white leaves for winter theme
                roughness: 0.9,
                metalness: 0.0
            })
        };
    }

    createNintendoishTree(x, z) {
        const tree = new THREE.Group();
        
        // Get terrain height at this position (with fallback)
        let terrainHeight = 0;
        if (this.terrainSystem && typeof this.terrainSystem.getHeight === 'function') {
            terrainHeight = this.terrainSystem.getHeight(x, z);
        } else {
            console.warn('[TreeSystem] Terrain system not available for height calculation, using default height');
        }
        
        console.log(`[TreeSystem] Creating tree at (${x}, ${z}) with terrain height: ${terrainHeight}`);
        
        // Create trunk (cylinder) - made longer to prevent sinking when rotated
        const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.5, 8);
        const trunk = new THREE.Mesh(trunkGeometry, this.treeMaterials.trunk);
        
        // Position trunk so bottom is below rotation origin (y=-0.75) for proper ground contact
        trunk.position.set(0, -0.75, 0);
        tree.add(trunk);
        
        // Create leaves (multiple spheres for Nintendoish look) - moved down with trunk
        const leafGeometry = new THREE.SphereGeometry(0.6, 8, 6);
        const leaves = new THREE.Mesh(leafGeometry, this.treeMaterials.leaves);
        leaves.position.set(0, 0.25, 0);
        leaves.scale.set(1, 1.2, 1); // Slightly elongated
        tree.add(leaves);
        
        // Add smaller leaf spheres for more detail - moved down with trunk
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
        
        // Random rotation will be handled by terrain alignment, not random override
        
        // Add subtle animation
        tree.userData = {
            type: 'tree',
            originalY: terrainHeight,
            swayPhase: Math.random() * Math.PI * 2,
            swayAmount: 0.02 + Math.random() * 0.02
        };
        
        // Ensure tree casts and receives shadows
        tree.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        console.log(`[TreeSystem] Tree created with ${tree.children.length} children`);
        
        return tree;
    }

    addTreeToTile(x, z) {
        const key = `${x},${z}`;
        
        // Remove existing tree if present
        this.removeTreeFromTile(x, z);
        
        // Get terrain height at this position (same logic as pieces)
        let terrainHeight = 0;
        console.log(`[TreeSystem] Getting terrain height for (${x}, ${z})`);
        console.log(`[TreeSystem] Terrain system available: ${!!this.terrainSystem}`);
        console.log(`[TreeSystem] getHeight method available: ${!!(this.terrainSystem && typeof this.terrainSystem.getHeight === 'function')}`);
        
        // Use exact same terrain height method as pieces
        if (window.game && window.game.boardSystem) {
            terrainHeight = window.game.boardSystem.getTerrainHeight(x, z);
            console.log(`[TreeSystem] Board system terrain height: ${terrainHeight}`);
        } else if (this.terrainSystem && typeof this.terrainSystem.getHeight === 'function') {
            terrainHeight = this.terrainSystem.getHeight(x, z);
            console.log(`[TreeSystem] Direct terrain height: ${terrainHeight}`);
        } else {
            console.warn('[TreeSystem] No terrain system available, using default height 0');
        }
        
        // Create new tree
        const tree = this.createNintendoishTree(x, z);
        
        // Get terrain normal exactly like pieces do
        let terrainNormal = null;
        console.log(`[TreeSystem] DEBUG: Getting terrain normal for (${x}, ${z})`);
        console.log(`[TreeSystem] DEBUG: terrainSystem exists: ${!!this.terrainSystem}`);
        console.log(`[TreeSystem] DEBUG: getNormal method exists: ${!!(this.terrainSystem && typeof this.terrainSystem.getNormal === 'function')}`);
        
        if (this.terrainSystem && typeof this.terrainSystem.getNormal === 'function') {
            // Try both coordinate orders to see which works
            terrainNormal = this.terrainSystem.getNormal(x, z);
            console.log(`[TreeSystem] DEBUG: Terrain system normal for (${x}, ${z}):`, terrainNormal);
            
            // If no normal or flat terrain, try swapped coordinates
            if (!terrainNormal || terrainNormal.y >= 0.999) {
                console.log(`[TreeSystem] DEBUG: Trying swapped coordinates (${z}, ${x})`);
                const swappedNormal = this.terrainSystem.getNormal(z, x);
                if (swappedNormal && swappedNormal.y < 0.999) {
                    terrainNormal = swappedNormal;
                    console.log(`[TreeSystem] DEBUG: Using swapped coordinates normal:`, terrainNormal);
                }
            }
            
            if (terrainNormal) {
                console.log(`[TreeSystem] DEBUG: Normal magnitude: ${terrainNormal.length().toFixed(4)}, Y component: ${terrainNormal.y.toFixed(4)}`);
                console.log(`[TreeSystem] DEBUG: Should apply rotation: ${terrainNormal.y < 0.999}`);
            }
        } else {
            console.warn(`[TreeSystem] DEBUG: No terrain normal method available`);
        }
        
        // Position tree so trunk base (at y=-0.75) touches ground + small offset
        const trunkBaseHeight = terrainHeight + 0.02 + 0.75; // Add trunk bottom offset
        tree.position.set(x + 0.5, trunkBaseHeight, z + 0.5);
        console.log(`[TreeSystem] DEBUG: Tree positioned at (${tree.position.x.toFixed(3)}, ${tree.position.y.toFixed(3)}, ${tree.position.z.toFixed(3)})`);
        
        // Apply terrain rotation exactly like pieces do for all trees
        if (terrainNormal && terrainNormal.y < 0.999) { // Apply even on very slight slopes
            console.log(`[TreeSystem] DEBUG: Applying terrain rotation for tree at (${x}, ${z})`);
            console.log(`[TreeSystem] DEBUG: Before rotation - quaternion: x=${tree.quaternion.x.toFixed(4)}, y=${tree.quaternion.y.toFixed(4)}, z=${tree.quaternion.z.toFixed(4)}, w=${tree.quaternion.w.toFixed(4)}`);
            
            const upVector = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, terrainNormal);
            tree.quaternion.copy(quaternion);
            
            console.log(`[TreeSystem] DEBUG: After rotation - quaternion: x=${tree.quaternion.x.toFixed(4)}, y=${tree.quaternion.y.toFixed(4)}, z=${tree.quaternion.z.toFixed(4)}, w=${tree.quaternion.w.toFixed(4)}`);
            console.log(`[TreeSystem] DEBUG: Terrain rotation applied successfully`);
        } else {
            console.log(`[TreeSystem] DEBUG: No rotation applied - terrainNormal: ${!!terrainNormal}, y: ${terrainNormal ? terrainNormal.y.toFixed(4) : 'null'}`);
        }
        
        this.trees.set(key, tree);
        this.scene.add(tree);
        
        console.log(`[TreeSystem] Added tree to tile (${x}, ${z}) using exact piece positioning logic`);
        console.log(`[TreeSystem] Tree position: (${tree.position.x}, ${tree.position.y}, ${tree.position.z})`);
        console.log(`[TreeSystem] Scene children count: ${this.scene.children.length}`);
    }

    removeTreeFromTile(x, z) {
        const key = `${x},${z}`;
        
        // Remove tree
        const existingTree = this.trees.get(key);
        if (existingTree) {
            this.scene.remove(existingTree);
            
            // Dispose of all meshes and geometries
            existingTree.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
            
            this.trees.delete(key);
            console.log(`[TreeSystem] Removed tree from tile (${x}, ${z})`);
        }
    }

    updateTrees(deltaTime) {
        // Animation disabled to preserve terrain rotation
        // Trees now follow terrain normals exactly like pieces
    }

    clearAllTrees() {
        for (const [key, tree] of this.trees) {
            this.scene.remove(tree);
            
            // Dispose of all meshes and geometries
            tree.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
        }
        
        this.trees.clear();
        console.log('[TreeSystem] Cleared all trees');
    }

    updateTreesForChunk(chunkX, chunkZ, chunkSize = 16) {
        console.log(`[TreeSystem] === UPDATE TREES FOR CHUNK (${chunkX}, ${chunkZ}) ===`);
        
        // Check if terrain system is available
        if (!this.terrainSystem || typeof this.terrainSystem.isTileBlocked !== 'function') {
            console.warn('[TreeSystem] Terrain system not available, skipping tree generation');
            return;
        }
        
        console.log(`[TreeSystem] Terrain system available, checking tiles...`);
        let blockedCount = 0;
        let treeCount = 0;
        let checkedCount = 0;
        let skippedCount = 0;
        
        // Remove trees in this chunk
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                const worldX = chunkX * chunkSize + x;
                const worldZ = chunkZ * chunkSize + z;
                checkedCount++;
                
                // Check if tree is within fog distance before processing
                if (!this.isTreeInDistance(worldX, worldZ)) {
                    this.removeTreeFromTile(worldX, worldZ);
                    skippedCount++;
                    continue;
                }
                
                const isBlocked = this.terrainSystem.isTileBlocked(worldX, worldZ);
                
                if (isBlocked) {
                    blockedCount++;
                    this.addTreeToTile(worldX, worldZ);
                    treeCount++;
                } else {
                    this.removeTreeFromTile(worldX, worldZ);
                }
            }
        }
        
        console.log(`[TreeSystem] === CHUNK COMPLETE === Checked: ${checkedCount}, Blocked: ${blockedCount}, Trees: ${treeCount}, Skipped: ${skippedCount}, Total: ${this.trees.size}`);
    }

    hasTreeAt(x, z) {
        const key = `${x},${z}`;
        return this.trees.has(key);
    }
}
