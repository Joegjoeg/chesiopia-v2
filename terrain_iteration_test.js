const { chromium } = require('playwright');

async function terrainIterationTest() {
    console.log('[Iteration 1] Starting terrain texture improvement cycle...');
    
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
                text: msg.text()
            });
        });
        
        console.log('[Iteration 1] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000);
        
        // Check for any errors
        const errorMessages = consoleMessages.filter(msg => msg.type === 'error');
        if (errorMessages.length > 0) {
            console.log('[Iteration 1] ❌ Errors found:');
            errorMessages.forEach(msg => {
                console.log(`  [ERROR] ${msg.text}`);
            });
        } else {
            console.log('[Iteration 1] ✅ No errors in console');
        }
        
        // Check adaptive terrain status
        const terrainStatus = await page.evaluate(() => {
            return {
                boardSystemExists: !!window.boardSystem,
                textureBlendingExists: !!window.boardSystem?.textureBlendingSystem,
                viewportMeshExists: !!window.boardSystem?._viewportMesh,
                hasVertexColors: !!window.boardSystem?._viewportMesh?.geometry?.attributes?.color,
                materialVertexColors: window.boardSystem?._viewportMesh?.material?.vertexColors,
                adaptiveColorWorking: !!window.boardSystem?.textureBlendingSystem?.getAdaptiveTerrainColor
            };
        });
        
        console.log('[Iteration 1] Terrain status:', terrainStatus);
        
        // Take screenshot for analysis
        await page.screenshot({ 
            path: 'd:\\Chesiopia v2\\screenshots\\terrain_iteration_1.png',
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Iteration 1] Screenshot saved: terrain_iteration_1.png');
        
        // Test different terrain positions
        const positions = [
            { x: 0, z: 0, name: 'center' },
            { x: 15, z: 15, name: 'mountain_area' },
            { x: -5, z: -5, name: 'water_area' },
            { x: 10, z: -10, name: 'mixed_terrain' }
        ];
        
        const terrainAnalysis = [];
        
        for (const pos of positions) {
            // Move camera to position
            await page.evaluate(({ x, z }) => {
                if (window.game && window.game.camera) {
                    window.game.camera.position.set(x, 15, z);
                    window.game.camera.lookAt(0, 0, 0);
                }
            }, { x: pos.x, z: pos.z });
            
            await page.waitForTimeout(1000);
            
            // Analyze terrain at this position
            const analysis = await page.evaluate(({ x, z }) => {
                const results = {
                    position: { x, z },
                    adaptiveColors: [],
                    biomeInfo: []
                };
                
                if (window.boardSystem?.textureBlendingSystem) {
                    // Test adaptive colors around this position
                    for (let dx = -2; dx <= 2; dx++) {
                        for (let dz = -2; dz <= 2; dz++) {
                            const testX = x + dx;
                            const testZ = z + dz;
                            try {
                                const color = window.boardSystem.textureBlendingSystem.getAdaptiveTerrainColor(testX, testZ, Date.now() * 0.001);
                                results.adaptiveColors.push({
                                    x: testX,
                                    z: testZ,
                                    color: { r: color.r, g: color.g, b: color.b }
                                });
                            } catch (error) {
                                results.adaptiveColors.push({
                                    x: testX,
                                    z: testZ,
                                    error: error.message
                                });
                            }
                        }
                    }
                }
                
                return results;
            }, { x: pos.x, z: pos.z });
            
            analysis.name = pos.name;
            terrainAnalysis.push(analysis);
            
            // Take screenshot at this position
            await page.screenshot({ 
                path: `d:\\Chesiopia v2\\screenshots\\terrain_${pos.name}_iteration_1.png`,
                fullPage: false,
                type: 'png'
            });
        }
        
        console.log('[Iteration 1] Terrain analysis:');
        terrainAnalysis.forEach(analysis => {
            console.log(`  ${analysis.name}:`);
            console.log(`    Position: (${analysis.position.x}, ${analysis.position.z})`);
            console.log(`    Adaptive colors sampled: ${analysis.adaptiveColors.length}`);
            
            // Analyze color diversity
            const validColors = analysis.adaptiveColors.filter(c => c.color);
            if (validColors.length > 0) {
                const uniqueColors = new Set(validColors.map(c => `${c.color.r.toFixed(2)},${c.color.g.toFixed(2)},${c.color.b.toFixed(2)}`));
                console.log(`    Unique colors: ${uniqueColors.size}`);
                
                // Sample a few colors
                validColors.slice(0, 3).forEach(c => {
                    console.log(`      (${c.x}, ${c.z}): RGB(${c.color.r.toFixed(2)}, ${c.color.g.toFixed(2)}, ${c.color.b.toFixed(2)})`);
                });
            }
            
            const errors = analysis.adaptiveColors.filter(c => c.error);
            if (errors.length > 0) {
                console.log(`    Errors: ${errors.length}`);
            }
        });
        
        console.log('[Iteration 1] ✅ Analysis complete. Check screenshots for visual assessment.');
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Iteration 1] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Iteration 1] Browser closed.');
    }
}

terrainIterationTest().catch(err => {
    console.error(err);
    process.exit(1);
});
