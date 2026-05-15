const { chromium } = require('playwright');

async function debugSystemCreation() {
    console.log('[Debug] Checking system creation in detail...');
    
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
        
        console.log('[Debug] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000);
        
        // Check for system creation messages
        const creationMessages = consoleMessages.filter(msg => 
            msg.text.includes('GrassSystem created') || 
            msg.text.includes('TextureBlendingSystem created') ||
            msg.text.includes('Failed to create')
        );
        
        console.log('[Debug] System creation messages:');
        creationMessages.forEach(msg => {
            console.log(`  [${msg.type.toUpperCase()}] ${msg.text}`);
        });
        
        // Check the actual state
        const systemState = await page.evaluate(() => {
            return {
                boardSystemExists: !!window.boardSystem,
                boardGrassSystem: !!window.boardSystem?.grassSystem,
                boardTextureBlending: !!window.boardSystem?.textureBlendingSystem,
                gameGrassSystem: !!window.game?.grassSystem,
                gameTextureBlending: !!window.game?.textureBlendingSystem,
                grassSystemClass: typeof GrassSystem !== 'undefined',
                textureBlendingClass: typeof TextureBlendingSystem !== 'undefined',
                boardSystemMethods: window.boardSystem ? Object.getOwnPropertyNames(window.boardSystem) : []
            };
        });
        
        console.log('[Debug] System state:', systemState);
        
        // Try to manually create the systems
        const manualCreation = await page.evaluate(() => {
            const results = [];
            
            if (window.boardSystem && typeof GrassSystem !== 'undefined' && !window.boardSystem.grassSystem) {
                try {
                    console.log('Attempting manual GrassSystem creation...');
                    window.boardSystem.grassSystem = new GrassSystem(window.boardSystem.scene, window.boardSystem, window.boardSystem.terrainSystem);
                    results.push('GrassSystem manually created in board system');
                } catch (error) {
                    results.push(`Failed to create GrassSystem: ${error.message}`);
                }
            }
            
            if (window.boardSystem && typeof TextureBlendingSystem !== 'undefined' && !window.boardSystem.textureBlendingSystem) {
                try {
                    console.log('Attempting manual TextureBlendingSystem creation...');
                    window.boardSystem.textureBlendingSystem = new TextureBlendingSystem(window.boardSystem, window.boardSystem.terrainSystem);
                    results.push('TextureBlendingSystem manually created in board system');
                } catch (error) {
                    results.push(`Failed to create TextureBlendingSystem: ${error.message}`);
                }
            }
            
            return results;
        });
        
        console.log('[Debug] Manual creation results:', manualCreation);
        
        // Test again after manual creation
        const afterManualTest = await page.evaluate(() => {
            return {
                boardGrassSystem: !!window.boardSystem?.grassSystem,
                boardTextureBlending: !!window.boardSystem?.textureBlendingSystem,
                adaptiveColorFunction: !!window.boardSystem?.textureBlendingSystem?.getAdaptiveTerrainColor,
                viewportMeshColors: !!window.boardSystem?._viewportMesh?.geometry?.attributes?.color
            };
        });
        
        console.log('[Debug] After manual creation:', afterManualTest);
        
        const isWorking = afterManualTest.boardGrassSystem && 
                          afterManualTest.boardTextureBlending &&
                          afterManualTest.adaptiveColorFunction;
        
        console.log(`[Debug] ${isWorking ? '✅' : '❌'} Adaptive terrain: ${isWorking ? 'WORKING' : 'NOT WORKING'}`);
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Debug] Browser closed.');
    }
}

debugSystemCreation().catch(err => {
    console.error(err);
    process.exit(1);
});
