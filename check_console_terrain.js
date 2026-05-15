const { chromium } = require('playwright');

async function checkConsoleTerrain() {
    console.log('[Console Check] Verifying adaptive terrain in client console...');
    
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
        
        // Capture console logs
        const consoleMessages = [];
        page.on('console', msg => {
            consoleMessages.push({
                type: msg.type(),
                text: msg.text(),
                location: msg.location()
            });
        });
        
        console.log('[Console Check] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000); // Wait for full initialization
        
        // Check console logs for terrain system initialization
        const terrainLogs = consoleMessages.filter(msg => 
            msg.text.includes('terrain') || 
            msg.text.includes('biome') || 
            msg.text.includes('TextureBlending') ||
            msg.text.includes('Grass') ||
            msg.text.includes('Board')
        );
        
        console.log('[Console Check] Terrain-related console logs:');
        terrainLogs.slice(-20).forEach(log => {
            console.log(`  [${log.type.toUpperCase()}] ${log.text}`);
        });
        
        // Check for errors
        const errorLogs = consoleMessages.filter(msg => msg.type === 'error');
        if (errorLogs.length > 0) {
            console.log('[Console Check] ❌ Errors found in console:');
            errorLogs.forEach(log => {
                console.log(`  [ERROR] ${log.text}`);
            });
        } else {
            console.log('[Console Check] ✅ No errors in console');
        }
        
        // Test terrain system functionality
        const terrainTest = await page.evaluate(() => {
            const results = {
                boardSystemExists: !!window.boardSystem,
                textureBlendingExists: !!window.boardSystem?.textureBlendingSystem,
                grassSystemExists: !!window.boardSystem?.grassSystem,
                viewportMeshExists: !!window.boardSystem?._viewportMesh,
                terrainSystemExists: !!window.terrainSystem,
                adaptiveColorsWorking: false
            };
            
            // Test adaptive color function
            if (window.boardSystem?.textureBlendingSystem) {
                try {
                    const testColor = window.boardSystem.textureBlendingSystem.getAdaptiveTerrainColor(0, 0, Date.now() * 0.001);
                    results.adaptiveColorsWorking = !!testColor;
                    results.testColor = { r: testColor.r, g: testColor.g, b: testColor.b };
                } catch (error) {
                    results.adaptiveColorError = error.message;
                }
            }
            
            // Test viewport mesh vertex colors
            if (window.boardSystem?._viewportMesh) {
                const mesh = window.boardSystem._viewportMesh;
                results.hasVertexColors = !!mesh.geometry.attributes.color;
                results.materialVertexColors = mesh.material.vertexColors;
                results.vertexCount = mesh.geometry.attributes.color?.count || 0;
            }
            
            return results;
        });
        
        console.log('[Console Check] Terrain system test results:', terrainTest);
        
        // Test biome data from server
        const biomeTest = await page.evaluate(async () => {
            try {
                const response = await fetch('/api/terrain/chunk/0/0');
                if (response.ok) {
                    const chunkData = await response.json();
                    
                    // Check for biome diversity
                    const biomes = new Set();
                    const types = new Set();
                    let hasMoisture = false;
                    let hasTemperature = false;
                    
                    chunkData.forEach(tile => {
                        if (tile.biome) biomes.add(tile.biome);
                        if (tile.type) types.add(tile.type);
                        if (tile.moisture !== undefined) hasMoisture = true;
                        if (tile.temperature !== undefined) hasTemperature = true;
                    });
                    
                    return {
                        success: true,
                        biomeCount: biomes.size,
                        typeCount: types.size,
                        biomes: Array.from(biomes),
                        types: Array.from(types),
                        hasMoisture,
                        hasTemperature,
                        sampleTiles: chunkData.slice(0, 5).map(t => ({
                            biome: t.biome,
                            type: t.type,
                            height: t.height,
                            moisture: t.moisture,
                            temperature: t.temperature
                        }))
                    };
                } else {
                    return { success: false, error: `HTTP ${response.status}` };
                }
            } catch (error) {
                return { success: false, error: error.message };
            }
        });
        
        console.log('[Console Check] Biome data test:', biomeTest);
        
        // Final assessment
        const isWorking = terrainTest.boardSystemExists && 
                          terrainTest.textureBlendingExists &&
                          terrainTest.adaptiveColorsWorking &&
                          biomeTest.success &&
                          biomeTest.biomeCount > 1;
        
        console.log(`[Console Check] ${isWorking ? '✅' : '❌'} Adaptive terrain system: ${isWorking ? 'WORKING' : 'NOT WORKING'}`);
        
        if (!isWorking) {
            console.log('[Console Check] Issues found:');
            if (!terrainTest.boardSystemExists) console.log('  - Board system not initialized');
            if (!terrainTest.textureBlendingExists) console.log('  - Texture blending system not initialized');
            if (!terrainTest.adaptiveColorsWorking) console.log('  - Adaptive color function not working');
            if (!biomeTest.success) console.log('  - Server biome data not available');
            if (biomeTest.biomeCount <= 1) console.log('  - No biome diversity in server data');
        }
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Console Check] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Console Check] Browser closed.');
    }
}

checkConsoleTerrain().catch(err => {
    console.error(err);
    process.exit(1);
});
