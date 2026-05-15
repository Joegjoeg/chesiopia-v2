const fs = require('fs');
const { chromium } = require('playwright');

async function analyzeCurrentScreenshot() {
    console.log('[Screenshot Analysis] Examining current terrain appearance...');
    
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
        
        console.log('[Screenshot Analysis] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000);
        
        // Take multiple screenshots from different angles
        const positions = [
            { x: 0, z: 0, y: 15, name: 'center_view' },
            { x: 25, z: 25, y: 20, name: 'high_elevation_view' },
            { x: -15, z: -15, y: 18, name: 'water_area_view' },
            { x: 20, z: -20, y: 25, name: 'mixed_terrain_view' }
        ];
        
        for (const pos of positions) {
            // Position camera
            await page.evaluate(({ x, y, z }) => {
                if (window.game && window.game.camera) {
                    window.game.camera.position.set(x, y, z);
                    window.game.camera.lookAt(0, 0, 0);
                }
            }, { x: pos.x, y: pos.y, z: pos.z });
            
            await page.waitForTimeout(1500);
            
            // Take screenshot
            await page.screenshot({ 
                path: `d:\\Chesiopia v2\\screenshots\\current_${pos.name}.png`,
                fullPage: false,
                type: 'png'
            });
            
            console.log(`[Screenshot Analysis] Captured: current_${pos.name}.png`);
            
            // Analyze what's visible in the scene
            const sceneAnalysis = await page.evaluate(() => {
                const analysis = {
                    terrainVisible: false,
                    textureType: 'unknown',
                    colorsVisible: [],
                    biomeTypes: new Set()
                };
                
                if (window.boardSystem?._viewportMesh) {
                    const mesh = window.boardSystem._viewportMesh;
                    analysis.terrainVisible = true;
                    analysis.textureType = mesh.material.map?.constructor?.name || 'none';
                    analysis.vertexColorsEnabled = mesh.material.vertexColors;
                }
                
                // Test some terrain colors at different positions
                if (window.boardSystem?.textureBlendingSystem) {
                    const testPositions = [
                        { x: 0, z: 0 }, { x: 10, z: 10 }, { x: -10, z: -10 },
                        { x: 15, z: -15 }, { x: -15, z: 15 }
                    ];
                    
                    testPositions.forEach(pos => {
                        try {
                            const color = window.boardSystem.textureBlendingSystem.getAdaptiveTerrainColor(pos.x, pos.z, Date.now() * 0.001);
                            analysis.colorsVisible.push({
                                position: pos,
                                color: { r: color.r, g: color.g, b: color.b }
                            });
                        } catch (error) {
                            analysis.colorsVisible.push({
                                position: pos,
                                error: error.message
                            });
                        }
                    });
                }
                
                return analysis;
            });
            
            console.log(`[Screenshot Analysis] Scene analysis for ${pos.name}:`, sceneAnalysis);
        }
        
        // Check file sizes to ensure screenshots were created
        console.log('[Screenshot Analysis] Verifying screenshot files:');
        for (const pos of positions) {
            try {
                const stats = fs.statSync(`d:\\Chesiopia v2\\screenshots\\current_${pos.name}.png`);
                console.log(`  current_${pos.name}.png: ${stats.size} bytes`);
            } catch (error) {
                console.log(`  current_${pos.name}.png: File not found`);
            }
        }
        
        console.log('[Screenshot Analysis] ✅ Complete - Check the screenshot files for visual assessment');
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Screenshot Analysis] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Screenshot Analysis] Browser closed.');
    }
}

analyzeCurrentScreenshot().catch(err => {
    console.error(err);
    process.exit(1);
});
