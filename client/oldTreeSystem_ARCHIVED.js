// OLD TREE SYSTEM - ARCHIVED FOR STORAGE
// This file contains the original tree system that has been disconnected
// from the main game in favor of the new terrain-integrated tree system.
// 
// ARCHIVED DATE: 2026-05-06
// REPLACEMENT: terrainTreeSystem.js
// 
// USAGE: This system is kept for reference and potential restoration if needed.
//         The main game now uses TerrainTreeSystem which integrates trees
//         directly into the terrain geometry with subdivision and deformation.

// Original LocalTreeSystem class - now archived
class LocalTreeSystem_ARCHIVED {
    constructor(scene, terrainSystem, altTreeSystem = null) {
        console.log('[ARCHIVED] LocalTreeSystem disabled - use TerrainTreeSystem instead');
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.altTreeSystem = altTreeSystem;
        this.trees = new Map();
        this.cameraPosition = new THREE.Vector3();
        this.lastCameraChunk = { x: -9999, z: -9999 };
        this.fogDistance = 40;
        this.chunkSize = 16;
        this.isUpdating = false;
        this.isArchived = true; // Mark as archived

        // Seasonal configuration (kept for reference)
        this.seasonConfig = {
            SPRING: { treeColor: [0.7,0.9,0.5] },
            SUMMER: { treeColor: [0.4,0.8,0.3] },
            AUTUMN: { treeColor: [0.9,0.6,0.2] },
            WINTER: { treeColor: [0.8,0.8,0.9] }
        };
        this.currentSeason = 'SPRING';
        this.seasonProgress = 0;

        // All other original properties disabled
        console.warn('[ARCHIVED] Tree generation disabled - trees now integrated with terrain');
    }

    // All methods disabled - return early or log warnings
    update(cameraPosition) {
        console.warn('[ARCHIVED] LocalTreeSystem.update() disabled');
        return;
    }

    addTree(x, z, type = 'oak') {
        console.warn('[ARCHIVED] LocalTreeSystem.addTree() disabled - use TerrainTreeSystem.addTreeToTerrain()');
        return null;
    }

    removeTree(x, z) {
        console.warn('[ARCHIVED] LocalTreeSystem.removeTree() disabled - use TerrainTreeSystem.removeTree()');
        return false;
    }

    createTreeMesh(x, z, type) {
        console.warn('[ARCHIVED] LocalTreeSystem.createTreeMesh() disabled');
        return null;
    }

    createLeafTexture(density, seed) {
        console.warn('[ARCHIVED] LocalTreeSystem.createLeafTexture() disabled');
        return null;
    }

    updateSeason(season, progress) {
        console.warn('[ARCHIVED] LocalTreeSystem.updateSeason() disabled');
        return;
    }

    dispose() {
        console.warn('[ARCHIVED] LocalTreeSystem.dispose() called on archived system');
        this.trees.clear();
    }
}

// Export for reference only
window.LocalTreeSystem_ARCHIVED = LocalTreeSystem_ARCHIVED;

console.log('[ARCHIVED] Old tree system loaded but disabled. Use TerrainTreeSystem for new tree functionality.');
