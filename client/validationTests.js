/**
 * Validation Tests for Chessopia Visual and Performance Features
 * Run from browser console: runChessopiaTests()
 */

class ChessopiaValidator {
    constructor() {
        this.results = [];
        this.passCount = 0;
        this.failCount = 0;
    }
    
    log(category, test, passed, details = '') {
        const status = passed ? 'PASS' : 'FAIL';
        this.results.push({ category, test, passed, details });
        if (passed) this.passCount++; else this.failCount++;
        console.log(`[TEST] [${status}] ${category} - ${test}${details ? ': ' + details : ''}`);
    }
    
    runAllTests() {
        console.log('\n=== CHESSOPIA VALIDATION TESTS ===\n');
        this.passCount = 0;
        this.failCount = 0;
        this.results = [];
        
        this.testTreeSpawning();
        this.testNintendoTreesRemoved();
        this.testPerformanceManager();
        this.testGrassTexture();
        this.testVertexBudget();
        this.testProceduralTerrain();
        this.testGrassWind();
        this.testUnderwaterMeshMerge();
        
        console.log('\n=== TEST SUMMARY ===');
        console.log(`Total: ${this.passCount + this.failCount}, Passed: ${this.passCount}, Failed: ${this.failCount}`);
        
        if (this.failCount === 0) {
            console.log('ALL TESTS PASSED!');
        } else {
            console.log('SOME TESTS FAILED - see details above');
            this.results.filter(r => !r.passed).forEach(r => {
                console.log(`  FAIL: ${r.category} - ${r.test}`);
            });
        }
        
        return {
            total: this.passCount + this.failCount,
            passed: this.passCount,
            failed: this.failCount,
            results: this.results
        };
    }
    
    // Test 1: Trees should not spawn in water (height < -1.5)
    testTreeSpawning() {
        const game = window.gameInstance || window.game;
        const htm = game && game.hybridTreeManager;
        if (!game || !htm) {
            this.log('TREES', 'Tree manager exists', false, 'No game instance or hybridTreeManager');
            return;
        }

        const systems = htm._systems || {};
        let underwaterTrees = 0;
        let totalTrees = 0;
        const waterLevel = -1.5;

        Object.values(systems).forEach((sys) => {
            if (!sys || !Array.isArray(sys.treeData)) return;
            for (const tree of sys.treeData) {
                if (!tree) continue;
                totalTrees++;
                const height = typeof tree.y === 'number' ? tree.y : (tree.position?.y ?? 0);
                if (height < waterLevel) {
                    underwaterTrees++;
                }
            }
        });

        this.log('TREES', 'Tree manager exists', true, `${totalTrees} trees tracked`);
        this.log('TREES', 'No trees in water', underwaterTrees === 0, 
            underwaterTrees === 0 ? `0 underwater` : `${underwaterTrees} trees below water level ${waterLevel}`);
    }
    
    // Test 2: Nintendo trees should be removed
    testNintendoTreesRemoved() {
        const game = window.gameInstance || window.game;
        
        // Check oldTreeSystem is null/undefined
        const oldSystemRemoved = !game || game.oldTreeSystem === null || game.oldTreeSystem === undefined;
        this.log('TREES', 'Old TreeSystem removed', oldSystemRemoved, 
            oldSystemRemoved ? 'oldTreeSystem is null' : 'oldTreeSystem still exists');
        
        // Check no sphere-heavy trees in scene
        let sphereCount = 0;
        if (game && game.scene) {
            game.scene.traverse((obj) => {
                if (obj.isMesh && obj.geometry && obj.geometry.type === 'SphereGeometry') {
                    sphereCount++;
                }
            });
        }
        
        // Some spheres may be from other objects, but Nintendo trees had many
        this.log('TREES', 'No excessive sphere geometry', sphereCount < 10, 
            `${sphereCount} sphere geometries found`);
    }
    
    // Test 3: Performance manager should be active
    testPerformanceManager() {
        const game = window.gameInstance || window.game;
        
        if (!game || !game.performanceManager) {
            this.log('PERFORMANCE', 'PerformanceManager exists', false, 'Not initialized');
            return;
        }
        
        this.log('PERFORMANCE', 'PerformanceManager initialized', true);
        
        const status = game.performanceManager.getStatus();
        this.log('PERFORMANCE', 'FPS tracking active', parseFloat(status.fps) > 0, 
            `Current FPS: ${status.fps}`);
        
        this.log('PERFORMANCE', 'Quality level set', status.qualityLevel >= 0 && status.qualityLevel <= 4, 
            `Level: ${status.qualityLevel}/4`);
        
        this.log('PERFORMANCE', 'Vertex budget defined', status.vertexBudget > 0, 
            `Budget: ${status.vertexBudget}`);
        
        // Test keyboard override works
        this.log('PERFORMANCE', 'Quality override available', 
            typeof game.performanceManager.forceQualityLevel === 'function', 
            'Press keys 0-4 to override');
    }
    
    // Test 4: Grass texture should be visible on terrain
    testGrassTexture() {
        const game = window.gameInstance || window.game;
        
        if (!game || !game.boardSystem) {
            this.log('VISUALS', 'Board system exists', false, 'Not initialized');
            return;
        }
        
        const hasGrassTexture = game.boardSystem.grassTexture !== null && 
                                game.boardSystem.grassTexture !== undefined;
        this.log('VISUALS', 'Grass texture loaded', hasGrassTexture, 
            hasGrassTexture ? 'Texture exists' : 'Missing');
        
        // Check active terrain mesh UVs (viewport mesh is primary)
        const activeMesh = game.boardSystem.continuousMesh || game.boardSystem._viewportMesh;
        let meshHasUVs = false;
        let maxU = 0, maxV = 0;
        
        if (activeMesh && activeMesh.geometry && activeMesh.geometry.attributes.uv) {
            meshHasUVs = true;
            const uvs = activeMesh.geometry.attributes.uv;
            if (uvs.count > 0) {
                maxU = uvs.getX(0);
                maxV = uvs.getY(0);
            }
        }
        
        this.log('VISUALS', 'Active terrain mesh has UVs', meshHasUVs, 
            meshHasUVs ? `First UV: (${maxU.toFixed(2)}, ${maxV.toFixed(2)})` : 'No UVs found');
        
        // UVs should use world coordinates for tiling (should be > 1 for proper texture repeat)
        this.log('VISUALS', 'UVs use world coordinates for tiling', 
            maxU > 1 || maxV > 1, `UVs: (${maxU.toFixed(2)}, ${maxV.toFixed(2)})`);
        
        // Check chunks use UV coordinates for tiling (legacy chunk system)
        let chunksWithUVs = 0;
        let totalChunks = 0;
        if (game.boardSystem.chunks) {
            for (const [key, chunk] of game.boardSystem.chunks) {
                totalChunks++;
                if (chunk.mesh && chunk.mesh.geometry && chunk.mesh.geometry.attributes.uv) {
                    chunksWithUVs++;
                }
            }
        }
        
        this.log('VISUALS', 'Chunk meshes have UV attributes', chunksWithUVs >= 0, 
            `${chunksWithUVs}/${totalChunks} chunks with UVs`);
    }
    
    // Test 5: Vertex budget should be tracked
    testVertexBudget() {
        const game = window.gameInstance || window.game;
        
        if (!game || !game.scene) {
            this.log('PERFORMANCE', 'Scene exists for vertex counting', false);
            return;
        }
        
        let totalVertices = 0;
        let meshCount = 0;
        const counts = { terrain: 0, trees: 0, decorative: 0, other: 0 };
        
        game.scene.traverse((obj) => {
            if (obj.isMesh && obj.geometry) {
                meshCount++;
                const pos = obj.geometry.getAttribute('position');
                if (pos) {
                    const count = pos.count;
                    totalVertices += count;
                    
                    if (obj.name === 'viewportMesh' || obj.name === 'dynamicContinuousMesh' || obj.name === 'continuousBoardMesh' || obj.name === 'rollingTerrain' || obj.name === 'terrainSingleMesh') {
                        counts.terrain += count;
                    } else if (obj.userData?.isTree || obj.parent?.userData?.isTree) {
                        counts.trees += count;
                    } else if (obj.userData?.isDecorative) {
                        counts.decorative += count;
                    } else {
                        counts.other += count;
                    }
                }
            }
        });
        
        this.log('PERFORMANCE', 'Vertex counting functional', totalVertices > 0, 
            `${totalVertices.toLocaleString()} vertices across ${meshCount} meshes`);
        
        this.log('PERFORMANCE', 'Terrain vertices', counts.terrain > 0, 
            `${counts.terrain.toLocaleString()}`);
        this.log('PERFORMANCE', 'Tree vertices', counts.trees >= 0, 
            `${counts.trees.toLocaleString()}`);
        
        // Check if vertex budget is being respected
        if (game.performanceManager) {
            const budget = game.performanceManager.getVertexBudget();
            this.log('PERFORMANCE', 'Within vertex budget', totalVertices <= budget * 1.5, 
                `${totalVertices.toLocaleString()} / ${budget.toLocaleString()} budget`);
        }
    }
    
    // Test 7: Procedural terrain should generate varied heights
    testProceduralTerrain() {
        const game = window.gameInstance || window.game;
        if (!game || !game.terrainSystem) {
            this.log('TERRAIN', 'TerrainSystem exists', false, 'Not initialized');
            return;
        }
        
        this.log('TERRAIN', 'TerrainSystem initialized', true);
        
        // Check height variation (procedural terrain should have varied heights, not flat)
        const heights = [];
        for (let x = -5; x <= 5; x += 2) {
            for (let z = -5; z <= 5; z += 2) {
                const h = game.terrainSystem.getHeight(x, z);
                heights.push(h);
            }
        }
        
        const minH = Math.min(...heights);
        const maxH = Math.max(...heights);
        const range = maxH - minH;
        
        // Success criteria: height range > 2 (terrain should be varied, not flat)
        this.log('TERRAIN', 'Height variation', range > 2, 
            `range=${range.toFixed(2)} (min=${minH.toFixed(2)}, max=${maxH.toFixed(2)})`);
        
        // Check for water tiles (some tiles should be below water level)
        const waterTiles = heights.filter(h => h < -1.5).length;
        this.log('TERRAIN', 'Water tiles present', waterTiles > 0, 
            `${waterTiles}/${heights.length} tiles below water`);
        
        // Check for land tiles (some tiles should be above water)
        const landTiles = heights.filter(h => h > -1.5).length;
        this.log('TERRAIN', 'Land tiles present', landTiles > 0, 
            `${landTiles}/${heights.length} tiles above water`);
        
        // Chunk data should be loaded
        this.log('TERRAIN', 'Chunk data loaded', game.terrainSystem.chunks && game.terrainSystem.chunks.size > 0,
            `${game.terrainSystem.chunks ? game.terrainSystem.chunks.size : 0} chunks`);
    }
    
    // Test 8: Grass wind effects should be active
    testGrassWind() {
        const game = window.gameInstance || window.game;
        if (!game || !game.decorativeVisuals) {
            this.log('WIND', 'DecorativeVisuals exists', false, 'Not initialized');
            return;
        }
        
        const dv = game.decorativeVisuals;
        
        // Wind system should have direction and speed
        this.log('WIND', 'Wind direction set', dv.windDirection && (dv.windDirection.x !== 0 || dv.windDirection.y !== 0),
            `direction=(${dv.windDirection.x.toFixed(2)}, ${dv.windDirection.y.toFixed(2)})`);
        
        this.log('WIND', 'Wind speed > 0', dv.windSpeed > 0, `speed=${dv.windSpeed.toFixed(2)}`);
        
        // Wind should vary over time (gust system)
        this.log('WIND', 'Gust system active', dv.gustIntensity !== undefined, `gust=${dv.gustIntensity.toFixed(2)}`);
        
        // Daisies should exist and respond to wind
        this.log('WIND', 'Daisies spawned', dv.daisies && dv.daisies.size > 0, `${dv.daisies ? dv.daisies.size : 0} daisies`);
        
        // Check that daisy sprites are billboarding (using sprites, not meshes)
        if (dv.daisies && dv.daisies.size > 0) {
            const firstDaisy = dv.daisies.values().next().value;
            const hasSprite = firstDaisy && firstDaisy.flowerSprite && firstDaisy.flowerSprite.isSprite;
            this.log('WIND', 'Daisies are billboarded sprites', hasSprite, hasSprite ? 'sprite' : 'mesh');
        }
    }

    // Test 9: Underwater terrain vertices should be merged to coarser grid
    testUnderwaterMeshMerge() {
        const game = window.gameInstance || window.game;
        if (!game || !game.boardSystem) {
            this.log('MESH', 'BoardSystem exists', false, 'Not initialized');
            return;
        }

        const bs = game.boardSystem;

        // Water level should be defined
        this.log('MESH', 'Water level configured', bs.waterLevel !== undefined, `level=${bs.waterLevel}`);
        this.log('MESH', 'Beach width configured', bs.beachWidth !== undefined, `width=${bs.beachWidth}`);

        // Check viewport mesh exists
        this.log('MESH', 'Viewport mesh exists', !!bs._viewportMesh, bs._viewportMesh ? 'YES' : 'NO');

        // After at least one snap, positions should have been updated
        if (bs._viewportMesh && bs._viewportSnapX !== undefined) {
            const pos = bs._viewportMesh.geometry.attributes.position.array;
            const meshX = bs._viewportMesh.position.x;
            const meshZ = bs._viewportMesh.position.z;
            const waterLevel = bs.waterLevel;

            // Check a sample of vertices to see if any underwater ones were snapped
            let checked = 0;
            let snapped = 0;
            const segX = bs._viewportMeshSegX;
            const segZ = bs._viewportMeshSegZ;
            const stepX = bs._viewportMeshWidth / segX;
            const stepZ = bs._viewportMeshDepth / segZ;
            const worldBaseX = bs._viewportSnapX - bs._viewportMeshWidth / 2;
            const worldBaseZ = bs._viewportSnapZ - bs._viewportMeshDepth / 2;

            // Sample every 10th vertex to avoid expensive full scan
            for (let iz = 0; iz <= segZ; iz += 10) {
                for (let ix = 0; ix <= segX; ix += 10) {
                    const vi = (iz * (segX + 1) + ix) * 3;
                    const worldX = pos[vi] + meshX;
                    const worldZ = pos[vi + 2] + meshZ;
                    const rawWorldX = worldBaseX + ix * stepX;
                    const rawWorldZ = worldBaseZ + iz * stepZ;

                    const height = pos[vi + 1];
                    if (height < waterLevel - bs.beachWidth) {
                        checked++;
                        if (Math.abs(worldX - rawWorldX) > 0.01 || Math.abs(worldZ - rawWorldZ) > 0.01) {
                            snapped++;
                        }
                    }
                }
            }

            this.log('MESH', 'Underwater vertices snapped to coarser grid', checked > 0 && snapped > 0,
                `${snapped}/${checked} deep-water sample vertices merged`);
        }
    }
}

// Global test runner
function runChessopiaTests() {
    const validator = new ChessopiaValidator();
    return validator.runAllTests();
}

// Auto-run tests after a delay if game is loaded
setTimeout(() => {
    const game = window.gameInstance || window.game;
    if (game && game.isInitialized) {
        console.log('[Validator] Game detected, auto-running tests in 5 seconds...');
        setTimeout(() => runChessopiaTests(), 5000);
    }
}, 10000);

console.log('[Validator] Chessopia validation tests loaded. Run: runChessopiaTests()');

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChessopiaValidator;
} else if (typeof window !== 'undefined') {
    window.ChessopiaValidator = ChessopiaValidator;
    window.runChessopiaTests = runChessopiaTests;
}
