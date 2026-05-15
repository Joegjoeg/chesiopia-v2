const { chromium } = require('playwright');

async function testAdaptiveTerrain() {
    console.log('[Adaptive Terrain] Testing adaptive terrain textures...');
    
    const browser = await chromium.launch({
        headless: false,
        args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1
        });
        
        const page = await context.newPage();
        
        console.log('[Adaptive Terrain] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(5000);
        
        // Test adaptive terrain color system
        const terrainTest = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            const results = {
                boardSystemExists: !!window.boardSystem,
                textureBlendingExists: !!window.boardSystem.textureBlendingSystem,
                viewportMeshExists: !!window.boardSystem._viewportMesh,
                hasVertexColors: false,
                biomeColorsTest: []
            };
            
            // Test viewport mesh vertex colors
            if (window.boardSystem._viewportMesh) {
                const mesh = window.boardSystem._viewportMesh;
                results.hasVertexColors = !!mesh.geometry.attributes.color;
                results.vertexColorCount = mesh.geometry.attributes.color ? mesh.geometry.attributes.color.count : 0;
                results.materialVertexColors = mesh.material.vertexColors;
            }
            
            // Test adaptive terrain color function
            if (window.boardSystem.textureBlendingSystem) {
                const testPositions = [
                    { x: 0, z: 0, expected: 'lowland' },
                    { x: 5, z: 5, expected: 'grassland' },
                    { x: -2, z: -2, expected: 'beach' },
                    { x: 15, z: 15, expected: 'mountain' }
                ];
                
                testPositions.forEach(pos => {
                    try {
                        const color = window.boardSystem.textureBlendingSystem.getAdaptiveTerrainColor(pos.x, pos.z, Date.now() * 0.001);
                        results.biomeColorsTest.push({
                            position: pos,
                            color: { r: color.r, g: color.g, b: color.b },
                            success: true
                        });
                    } catch (error) {
                        results.biomeColorsTest.push({
                            position: pos,
                            error: error.message,
                            success: false
                        });
                    }
                });
            }
            
            return results;
        });
        
        console.log('[Adaptive Terrain] Terrain system test:', terrainTest);
        
        // Test server biome data
        const serverTest = await page.evaluate(async () => {
            try {
                const response = await fetch('/api/terrain/chunk/0/0');
                if (response.ok) {
                    const chunkData = await response.json();
                    
                    // Analyze biome diversity
                    const biomeCounts = {};
                    chunkData.forEach(tile => {
                        if (tile.biome) {
                            biomeCounts[tile.biome] = (biomeCounts[tile.biome] || 0) + 1;
                        }
                    });
                    
                    return {
                        success: true,
                        totalTiles: chunkData.length,
                        biomeCounts: biomeCounts,
                        biomeDiversity: Object.keys(biomeCounts).length,
                        hasMoistureData: chunkData.some(t => t.moisture !== undefined),
                        hasTemperatureData: chunkData.some(t => t.temperature !== undefined)
                    };
                } else {
                    return { success: false, error: `HTTP ${response.status}` };
                }
            } catch (error) {
                return { success: false, error: error.message };
            }
        });
        
        console.log('[Adaptive Terrain] Server biome test:', serverTest);
        
        // Take screenshots at different positions to show terrain variety
        console.log('[Adaptive Terrain] Taking terrain screenshots...');
        
        await page.screenshot({ 
            path: 'd:\\Chesiopia v2\\screenshots\\adaptive_terrain_center.png',
            fullPage: false,
            type: 'png'
        });
        
        // Move to different position and screenshot
        await page.evaluate(() => {
            if (window.game && window.game.camera) {
                window.game.camera.position.set(20, 10, 20);
                window.game.camera.lookAt(0, 0, 0);
            }
        });
        
        await page.waitForTimeout(1000);
        
        await page.screenshot({ 
            path: 'd:\\Chesiopia v2\\screenshots\\adaptive_terrain_moved.png',
            fullPage: false,
            type: 'png'
        });
        
        // Move to high elevation
        await page.evaluate(() => {
            if (window.game && window.game.camera) {
                window.game.camera.position.set(0, 25, 0);
                window.game.camera.lookAt(0, 0, 0);
            }
        });
        
        await page.waitForTimeout(1000);
        
        await page.screenshot({ 
            path: 'd:\\Chesiopia v2\\screenshots\\adaptive_terrain_high.png',
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Adaptive Terrain] Screenshots saved for visual verification');
        console.log('[Adaptive Terrain] ✅ Test completed!');
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Adaptive Terrain] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Adaptive Terrain] Browser closed.');
    }
}

testAdaptiveTerrain().catch(err => {
    console.error(err);
    process.exit(1);
});
