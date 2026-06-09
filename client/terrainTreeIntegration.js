// TERRAIN TREE INTEGRATION - How to use the new terrain-integrated tree system
// This script demonstrates how to integrate TerrainTreeSystem with the existing game

class TerrainTreeIntegration {
    constructor(scene, terrainSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.terrainTreeSystem = new TerrainTreeSystem(scene, terrainSystem);
        
        // Example tree placement data
        this.exampleTrees = [
            { x: 10, z: 10, type: 'pine' },
            { x: 15, z: 12, type: 'oak' },
            { x: 8, z: 18, type: 'birch' },
            { x: 22, z: 9, type: 'oak' },
            { x: 11, z: 25, type: 'pine' }
        ];
        
        console.log('[TerrainTreeIntegration] Initialized with terrain-integrated tree system');
    }
    
    // Initialize the system and add example trees
    initialize() {
        console.log('[TerrainTreeIntegration] Setting up terrain trees...');
        
        // Add example trees to demonstrate the system
        this.exampleTrees.forEach(tree => {
            this.terrainTreeSystem.addTreeToTerrain(tree.x, tree.z, tree.type);
            console.log(`[TerrainTreeIntegration] Added ${tree.type} tree at (${tree.x}, ${tree.z})`);
        });
        
        console.log(`[TerrainTreeIntegration] Added ${this.exampleTrees.length} example trees`);
        console.log('[TerrainTreeIntegration] Trees are now integrated into terrain geometry');
    }
    
    // Add a tree at specific position
    addTree(worldX, worldZ, treeType = 'oak') {
        const quadKey = this.terrainTreeSystem.addTreeToTerrain(worldX, worldZ, treeType);
        console.log(`[TerrainTreeIntegration] Added ${treeType} tree at (${worldX}, ${worldZ}) - Quad: ${quadKey}`);
        return quadKey;
    }
    
    // Remove a tree
    removeTree(worldX, worldZ) {
        const success = this.terrainTreeSystem.removeTree(worldX, worldZ);
        if (success) {
            console.log(`[TerrainTreeIntegration] Removed tree at (${worldX}, ${worldZ})`);
        } else {
            console.warn(`[TerrainTreeIntegration] No tree found at (${worldX}, ${worldZ})`);
        }
        return success;
    }
    
    // Check if position has a tree
    hasTreeAt(worldX, worldZ) {
        return this.terrainTreeSystem.hasTreeAt(worldX, worldZ);
    }
    
    // Get quad information
    getQuadInfo(worldX, worldZ) {
        const quadData = this.terrainTreeSystem.getQuadAtPosition(worldX, worldZ);
        if (quadData) {
            console.log(`[TerrainTreeIntegration] Quad info for (${worldX}, ${worldZ}):`, quadData);
            return quadData;
        } else {
            console.log(`[TerrainTreeIntegration] No tree quad at (${worldX}, ${worldZ})`);
            return null;
        }
    }
    
    // Get all tree positions
    getAllTrees() {
        const trees = this.terrainTreeSystem.getAllTreePositions();
        console.log(`[TerrainTreeIntegration] Found ${trees.length} trees:`, trees);
        return trees;
    }
    
    // Demonstrate quad identification
    demonstrateQuadIdentification() {
        console.log('[TerrainTreeIntegration] === Quad Identification Demo ===');
        
        this.exampleTrees.forEach(tree => {
            const quadInfo = this.getQuadInfo(tree.x, tree.z);
            if (quadInfo) {
                console.log(`  Tree at (${tree.x}, ${tree.z}):`);
                console.log(`    - Type: ${quadInfo.treeType}`);
                console.log(`    - Chunk: ${quadInfo.chunkKey}`);
                console.log(`    - Subdivided: ${quadInfo.subdivided}`);
            }
        });
    }
    
    // Show how quads can be identified by position
    showQuadIdentification() {
        console.log('[TerrainTreeIntegration] === Quad Position Identification ===');
        console.log('Quads can be identified by their world grid position:');
        console.log('- Format: "x,z" where x and z are integer grid coordinates');
        console.log('- Example: "10,12" identifies the quad from (10,12) to (11,13)');
        console.log('- Each quad can hold exactly one tree');
        console.log('- Trees are stored in treeQuads Map with position as key');
        
        const positions = this.terrainTreeSystem.getAllTreePositions();
        positions.forEach(tree => {
            const quadKey = `${Math.floor(tree.x)},${Math.floor(tree.z)}`;
            console.log(`  - Tree ${tree.type} at quad ${quadKey}`);
        });
    }
    
    // Cleanup
    dispose() {
        console.log('[TerrainTreeIntegration] Cleaning up terrain tree system...');
        this.terrainTreeSystem.dispose();
    }
}

// Usage example for integration into main game:
function integrateTerrainTrees(scene, terrainSystem) {
    // Create the integration system
    const treeIntegration = new TerrainTreeIntegration(scene, terrainSystem);
    
    // Initialize with example trees
    treeIntegration.initialize();
    
    // Demonstrate quad identification
    treeIntegration.demonstrateQuadIdentification();
    treeIntegration.showQuadIdentification();
    
    // Make available globally for debugging
    window.terrainTreeIntegration = treeIntegration;
    
    console.log('[TerrainTreeIntegration] Integration complete. Use window.terrainTreeIntegration to access.');
    return treeIntegration;
}

// Export for use in main game
window.TerrainTreeIntegration = TerrainTreeIntegration;
window.integrateTerrainTrees = integrateTerrainTrees;

console.log('[TerrainTreeIntegration] Integration script loaded. Call integrateTerrainTrees(scene, terrainSystem) to activate.');
