class LocalTreeSystem {
    constructor(scene, terrainSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        // TREES REMOVED - Simplified empty system
        console.log('[TreeSystem] Trees removed - simplified system active');
    }

    // TREES REMOVED - Empty stub methods
    createTreeTemplate() {
        console.log('[TreeSystem] Tree template creation disabled');
    }

    createNintendoishTree() {
        return null;
    }

    cloneTree() {
        return null;
    }

    addTreeToTile(x, z, height) {
        // TREES REMOVED - Do nothing
        console.log('[TreeSystem] Tree addition disabled');
    }

    removeTreeFromTile(x, z) {
        // TREES REMOVED - Do nothing
        console.log('[TreeSystem] Tree removal disabled');
    }

    isWithinTreeLoadDistance(x, z) {
        // TREES REMOVED - Always return false
        return false;
    }

    calculateOpacity(distance) {
        // SIMPLIFIED - ALL TREES ALWAYS VISIBLE
        return 1.0;
    }

    updateCameraPosition(cameraPosition) {
        // TREES REMOVED - Do nothing
        // console.log('[TreeSystem] Camera position update disabled');
    }

    async updateTreesFromServerData() {
        // TREES REMOVED - Do nothing
        // console.log('[TreeSystem] Server data update disabled');
    }
    
    async processChunk(chunkX, chunkZ) {
        // TREES REMOVED - Do nothing
        // console.log('[TreeSystem] Chunk processing disabled');
    }
    
    clearAllTrees() {
        // TREES REMOVED - Do nothing
        // console.log('[TreeSystem] Clear trees disabled');
    }
    
    updateTreeFade(cameraPosition) {
        // TREES REMOVED - Do nothing
        // console.log('[TreeSystem] Tree fade disabled');
    }
    
    calculateOpacity(distance) {
        // TREES REMOVED - Always return 1
        return 1.0;
    }

    getChunksInRange() {
        // TREES REMOVED - Return empty chunks
        return { x: [], z: [] };
    }

    updateVisibleTrees() {
        // TREES REMOVED - Do nothing
        console.log('[TreeSystem] Update visible trees disabled');
    }
    
    // Check if tree exists at position (for board system blocking)
    hasTreeAt(x, z) {
        // TREES REMOVED - Always return false (no tree blocking)
        return false;
    }

    removeDistantTrees() {
        // TREES REMOVED - Do nothing
        console.log('[TreeSystem] Remove distant trees disabled');
    }
}
