const { chromium } = require('playwright');

async function testTerrainFix() {
    console.log('[Terrain Fix] Testing if adaptive terrain is now enabled...');
    
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
        
        console.log('[Terrain Fix] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000);
        
        // Check for the key console messages
        const enabledMessages = consoleMessages.filter(msg => 
            msg.text.includes('GrassSystem enabled') || 
            msg.text.includes('TextureBlendingSystem enabled') ||
            msg.text.includes('adaptive terrain')
        );
        
        const disabledMessages = consoleMessages.filter(msg => 
            msg.text.includes('disabled') && msg.text.includes('GrassSystem')
        );
        
        console.log('[Terrain Fix] Enable messages:', enabledMessages.length);
        console.log('[Terrain Fix] Disable messages:', disabledMessages.length);
        
        enabledMessages.forEach(msg => {
            console.log(`  ✅ ${msg.text}`);
        });
        
        disabledMessages.forEach(msg => {
            console.log(`  ❌ ${msg.text}`);
        });
        
        // Test the actual systems
        const systemTest = await page.evaluate(() => {
            const results = {
                gameGrassSystem: !!window.game?.grassSystem,
                gameTextureBlending: !!window.game?.textureBlendingSystem,
                boardGrassSystem: !!window.boardSystem?.grassSystem,
                boardTextureBlending: !!window.boardSystem?.textureBlendingSystem,
                adaptiveColorFunction: false,
                viewportMeshColors: false
            };
            
            // Test adaptive color function
            if (window.boardSystem?.textureBlendingSystem) {
                try {
                    const color = window.boardSystem.textureBlendingSystem.getAdaptiveTerrainColor(0, 0, Date.now() * 0.001);
                    results.adaptiveColorFunction = !!color;
                    results.testColor = { r: color.r, g: color.g, b: color.b };
                } catch (error) {
                    results.adaptiveColorError = error.message;
                }
            }
            
            // Test viewport mesh vertex colors
            if (window.boardSystem?._viewportMesh) {
                const mesh = window.boardSystem._viewportMesh;
                results.viewportMeshColors = !!mesh.geometry.attributes.color;
                results.materialVertexColors = mesh.material.vertexColors;
            }
            
            return results;
        });
        
        console.log('[Terrain Fix] System test results:', systemTest);
        
        // Take screenshot to visually verify
        await page.screenshot({ 
            path: 'd:\\Chesiopia v2\\screenshots\\terrain_fix_test.png',
            fullPage: false,
            type: 'png'
        });
        
        const isWorking = systemTest.gameGrassSystem && 
                          systemTest.gameTextureBlending &&
                          systemTest.adaptiveColorFunction &&
                          systemTest.viewportMeshColors;
        
        console.log(`[Terrain Fix] ${isWorking ? '✅' : '❌'} Adaptive terrain: ${isWorking ? 'WORKING' : 'NOT WORKING'}`);
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Terrain Fix] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Terrain Fix] Browser closed.');
    }
}

testTerrainFix().catch(err => {
    console.error(err);
    process.exit(1);
});
