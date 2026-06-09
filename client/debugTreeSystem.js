// DEBUG TREE SYSTEM - Check integration issues
class DebugTreeSystem {
    constructor() {
        this.debugMode = true;
        this.oldTreeSystem = null;
        this.newTreeSystem = null;
        this.terrainSystem = null;
        this.scene = null;
        
        console.log('[DebugTreeSystem] Initialized - Ready to debug tree integration');
    }
    
    // Set up references to systems for debugging
    setupReferences(scene, terrainSystem, oldTreeSystem, newTreeSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.oldTreeSystem = oldTreeSystem;
        this.newTreeSystem = newTreeSystem;
        
        console.log('[DebugTreeSystem] References set up');
        this.checkSystemStatus();
    }
    
    // Check current status of all tree systems
    checkSystemStatus() {
        console.log('\n=== TREE SYSTEM STATUS CHECK ===');
        
        // Check scene objects
        if (this.scene) {
            const treeObjects = this.scene.children.filter(child => 
                child.userData && child.userData.isTree
            );
            console.log(`[Debug] Scene has ${treeObjects.length} tree objects`);
            
            // Check for any tree-like meshes
            const allMeshes = this.scene.children.filter(child => child.isMesh);
            console.log(`[Debug] Scene has ${allMeshes.length} total meshes`);
            
            allMeshes.forEach((mesh, index) => {
                if (mesh.name && mesh.name.toLowerCase().includes('tree')) {
                    console.log(`[Debug] Found tree mesh: ${mesh.name} at index ${index}`);
                }
            });
        }
        
        // Check old tree system
        if (this.oldTreeSystem) {
            console.log(`[Debug] Old tree system exists with ${this.oldTreeSystem.trees ? this.oldTreeSystem.trees.size : 0} trees`);
            if (this.oldTreeSystem.trees) {
                this.oldTreeSystem.trees.forEach((tree, key) => {
                    console.log(`[Debug] Old tree at ${key}:`, tree);
                });
            }
        }
        
        // Check new tree system
        if (this.newTreeSystem) {
            console.log(`[Debug] New tree system exists with ${this.newTreeSystem.treeQuads ? this.newTreeSystem.treeQuads.size : 0} tree quads`);
            if (this.newTreeSystem.treeQuads) {
                this.newTreeSystem.treeQuads.forEach((quad, key) => {
                    console.log(`[Debug] New tree quad at ${key}:`, quad);
                });
            }
        }
        
        // Check terrain system
        if (this.terrainSystem) {
            console.log(`[Debug] Terrain system exists with ${this.terrainSystem.chunks ? this.terrainSystem.chunks.size : 0} chunks`);
        }
        
        console.log('=== END STATUS CHECK ===\n');
    }
    
    // Test adding a new tree
    testAddNewTree(x, z, treeType = 'oak') {
        console.log(`\n=== TESTING NEW TREE ADDITION ===`);
        console.log(`[Debug] Attempting to add ${treeType} tree at (${x}, ${z})`);
        
        if (!this.newTreeSystem) {
            console.error('[Debug] New tree system not available!');
            return false;
        }
        
        try {
            // Check if tree already exists at this position
            const existingTree = this.newTreeSystem.hasTreeAt(x, z);
            console.log(`[Debug] Tree already exists at (${x}, ${z}): ${existingTree}`);
            
            // Add the tree
            const quadKey = this.newTreeSystem.addTreeToTerrain(x, z, treeType);
            console.log(`[Debug] Tree added with quad key: ${quadKey}`);
            
            // Verify it was added
            const wasAdded = this.newTreeSystem.hasTreeAt(x, z);
            console.log(`[Debug] Tree verification - exists at (${x}, ${z}): ${wasAdded}`);
            
            // Check terrain geometry modification
            const chunkX = Math.floor(x / this.terrainSystem.chunkSize);
            const chunkZ = Math.floor(z / this.terrainSystem.chunkSize);
            const chunkKey = `${chunkX},${chunkZ}`;
            
            const geometryModified = this.newTreeSystem.treeGeometry.has(chunkKey);
            console.log(`[Debug] Terrain geometry modified for chunk ${chunkKey}: ${geometryModified}`);
            
            console.log(`=== END NEW TREE TEST ===\n`);
            return wasAdded;
            
        } catch (error) {
            console.error('[Debug] Error adding new tree:', error);
            console.log(`=== END NEW TREE TEST (ERROR) ===\n`);
            return false;
        }
    }
    
    // Test removing old trees
    testRemoveOldTrees() {
        console.log(`\n=== TESTING OLD TREE REMOVAL ===`);
        
        if (!this.oldTreeSystem) {
            console.log('[Debug] No old tree system to remove');
            return;
        }
        
        try {
            // Count old trees
            const oldTreeCount = this.oldTreeSystem.trees ? this.oldTreeSystem.trees.size : 0;
            console.log(`[Debug] Found ${oldTreeCount} old trees to remove`);
            
            // Remove all old trees
            if (this.oldTreeSystem.trees) {
                const treeKeys = Array.from(this.oldTreeSystem.trees.keys());
                treeKeys.forEach(key => {
                    const tree = this.oldTreeSystem.trees.get(key);
                    console.log(`[Debug] Removing old tree: ${key}`);
                    
                    // Remove from scene
                    if (tree && tree.mesh && this.scene) {
                        this.scene.remove(tree.mesh);
                        if (tree.mesh.geometry) tree.mesh.geometry.dispose();
                        if (tree.mesh.material) tree.mesh.material.dispose();
                    }
                    
                    // Remove from system
                    this.oldTreeSystem.trees.delete(key);
                });
            }
            
            // Verify removal
            const remainingTrees = this.oldTreeSystem.trees ? this.oldTreeSystem.trees.size : 0;
            console.log(`[Debug] Remaining old trees: ${remainingTrees}`);
            
            console.log(`=== END OLD TREE REMOVAL ===\n`);
            
        } catch (error) {
            console.error('[Debug] Error removing old trees:', error);
            console.log(`=== END OLD TREE REMOVAL (ERROR) ===\n`);
        }
    }
    
    // Test terrain integration
    testTerrainIntegration() {
        console.log(`\n=== TESTING TERRAIN INTEGRATION ===`);
        
        if (!this.terrainSystem || !this.newTreeSystem) {
            console.error('[Debug] Missing terrain or new tree system');
            return;
        }
        
        try {
            // Get a test position
            const testX = 10;
            const testZ = 10;
            
            console.log(`[Debug] Testing terrain integration at (${testX}, ${testZ})`);
            
            // Check if chunk exists
            const chunkX = Math.floor(testX / this.terrainSystem.chunkSize);
            const chunkZ = Math.floor(testZ / this.terrainSystem.chunkSize);
            const chunkKey = `${chunkX},${chunkZ}`;
            
            const chunkExists = this.terrainSystem.chunks && this.terrainSystem.chunks.has(chunkKey);
            console.log(`[Debug] Chunk ${chunkKey} exists: ${chunkExists}`);
            
            // Check if we can get chunk geometry
            const geometry = this.terrainSystem.getChunkGeometry ? 
                this.terrainSystem.getChunkGeometry(chunkKey) : null;
            console.log(`[Debug] Chunk geometry available: ${!!geometry}`);
            
            // Check if we can get chunk mesh
            const mesh = this.terrainSystem.getChunkMesh ? 
                this.terrainSystem.getChunkMesh(chunkKey) : null;
            console.log(`[Debug] Chunk mesh available: ${!!mesh}`);
            
            if (mesh) {
                console.log(`[Debug] Mesh vertices: ${mesh.geometry.attributes.position.count}`);
                console.log(`[Debug] Mesh triangles: ${mesh.geometry.index.count / 3}`);
            }
            
            console.log(`=== END TERRAIN INTEGRATION ===\n`);
            
        } catch (error) {
            console.error('[Debug] Error testing terrain integration:', error);
            console.log(`=== END TERRAIN INTEGRATION (ERROR) ===\n`);
        }
    }
    
    // Run full diagnostic
    runFullDiagnostic() {
        console.log('\n🔍 === FULL TREE SYSTEM DIAGNOSTIC === 🔍');
        
        this.checkSystemStatus();
        this.testRemoveOldTrees();
        this.testTerrainIntegration();
        this.testAddNewTree(10, 10, 'oak');
        this.testAddNewTree(12, 12, 'pine');
        this.testAddNewTree(8, 15, 'birch');
        
        // Final status check
        setTimeout(() => {
            console.log('\n🔍 === FINAL STATUS CHECK === 🔍');
            this.checkSystemStatus();
        }, 1000);
        
        console.log('🔍 === END FULL DIAGNOSTIC === 🔍\n');
    }
    
    // Enable/disable debug mode
    setDebugMode(enabled) {
        this.debugMode = enabled;
        console.log(`[DebugTreeSystem] Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }
}

// Create global debug instance
window.debugTreeSystem = new DebugTreeSystem();

// Auto-run diagnostic if available
setTimeout(() => {
    if (window.debugTreeSystem && window.terrainSystem) {
        console.log('[Debug] Auto-running tree system diagnostic...');
        window.debugTreeSystem.runFullDiagnostic();
    }
}, 2000);

console.log('[DebugTreeSystem] Debug script loaded. Use window.debugTreeSystem to access.');
