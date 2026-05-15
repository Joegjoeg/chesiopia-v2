const { chromium } = require('playwright');

async function debugGrassExposed() {
    console.log('[Grass Exposed Debug] Checking grass system exposure...');
    
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
        
        console.log('[Grass Exposed Debug] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(5000);
        
        // Check board system grass system details
        const boardGrassCheck = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            return {
                boardSystemGrass: !!window.boardSystem.grassSystem,
                boardSystemTextureBlending: !!window.boardSystem.textureBlendingSystem,
                grassSystemType: window.boardSystem.grassSystem ? window.boardSystem.grassSystem.constructor.name : null,
                grassSystemMethods: window.boardSystem.grassSystem ? 
                    Object.getOwnPropertyNames(window.boardSystem.grassSystem).filter(name => 
                        typeof window.boardSystem.grassSystem[name] === 'function'
                    ).slice(0, 10) : [],
                grassSystemHasTexture: !!window.boardSystem.grassSystem?.grassTexture,
                grassSystemHasMaterial: !!window.boardSystem.grassSystem?.grassMaterial,
                grassSystemChunks: window.boardSystem.grassSystem?.grassChunks?.size || 0
            };
        });
        
        console.log('[Grass Exposed Debug] Board grass system details:', boardGrassCheck);
        
        // Expose grass system to window if it exists in board system
        const exposeTest = await page.evaluate(() => {
            if (window.boardSystem && window.boardSystem.grassSystem && !window.grassSystem) {
                window.grassSystem = window.boardSystem.grassSystem;
                console.log('Exposed grass system to window object');
                return 'Grass system exposed to window';
            } else if (window.grassSystem) {
                return 'Grass system already exposed to window';
            } else {
                return 'Cannot expose grass system - not found in board system';
            }
        });
        
        console.log('[Grass Exposed Debug] Exposure test:', exposeTest);
        
        // Test seasonal grass color functionality
        const seasonalTest = await page.evaluate(() => {
            if (!window.grassSystem) return { error: 'Grass system not available' };
            
            try {
                const currentSeason = window.boardSystem?.currentSeason || 'UNKNOWN';
                const seasonalColor = window.grassSystem.getSeasonalGrassColor();
                
                return {
                    currentSeason: currentSeason,
                    seasonalColor: seasonalColor ? {
                        r: seasonalColor.r,
                        g: seasonalColor.g,
                        b: seasonalColor.b
                    } : null,
                    hasMethod: typeof window.grassSystem.getSeasonalGrassColor === 'function',
                    hasUpdateTextures: typeof window.grassSystem.updateSeasonalTextures === 'function'
                };
            } catch (error) {
                return { error: error.message };
            }
        });
        
        console.log('[Grass Exposed Debug] Seasonal test:', seasonalTest);
        
        // Test grass texture update
        const textureUpdateTest = await page.evaluate(() => {
            if (!window.grassSystem) return { error: 'Grass system not available' };
            
            try {
                console.log('Testing grass texture update...');
                window.grassSystem.updateSeasonalTextures();
                
                return {
                    success: true,
                    textureExists: !!window.grassSystem.grassTexture,
                    materialExists: !!window.grassSystem.grassMaterial,
                    materialMap: window.grassSystem.grassMaterial ? !!window.grassSystem.grassMaterial.map : false
                };
            } catch (error) {
                return { error: error.message };
            }
        });
        
        console.log('[Grass Exposed Debug] Texture update test:', textureUpdateTest);
        
        // Check if grass sprites are actually being rendered
        const renderCheck = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            const scene = window.boardSystem.scene;
            const grassSprites = [];
            
            scene.traverse((child) => {
                if (child.isMesh && child.material && child.material.map && 
                    (child.name?.includes('grass') || child.material.map.image?.width === 256)) {
                    grassSprites.push({
                        name: child.name,
                        visible: child.visible,
                        materialType: child.material.type,
                        hasTexture: !!child.material.map,
                        position: child.position
                    });
                }
            });
            
            return {
                grassSpriteCount: grassSprites.length,
                grassSprites: grassSprites.slice(0, 5)
            };
        });
        
        console.log('[Grass Exposed Debug] Render check:', renderCheck);
        
        // Take screenshot to verify visual results
        await page.screenshot({ 
            path: 'd:\\Chesiopia v2\\screenshots\\grass_system_test.png',
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Grass Exposed Debug] Screenshot saved for visual verification');
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Grass Exposed Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Grass Exposed Debug] Browser closed.');
    }
}

debugGrassExposed().catch(err => {
    console.error(err);
    process.exit(1);
});
