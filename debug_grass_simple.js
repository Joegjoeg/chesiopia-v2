const { chromium } = require('playwright');

async function debugGrassSimple() {
    console.log('[Grass Simple Debug] Quick grass system check...');
    
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
        
        console.log('[Grass Simple Debug] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        // Wait for basic game elements
        await page.waitForTimeout(5000);
        
        // Quick system check
        const systemCheck = await page.evaluate(() => {
            return {
                game: !!window.game,
                boardSystem: !!window.boardSystem,
                grassSystem: !!window.grassSystem,
                textureBlendingSystem: !!window.textureBlendingSystem,
                grassSystemDisabled: !!window.grassSystemDisabled,
                allGlobalVars: Object.keys(window).filter(key => 
                    key.toLowerCase().includes('grass') || 
                    key.toLowerCase().includes('texture')
                )
            };
        });
        
        console.log('[Grass Simple Debug] System check:', systemCheck);
        
        // Check if grass classes are loaded
        const classCheck = await page.evaluate(() => {
            return {
                GrassSystem: typeof GrassSystem !== 'undefined',
                TextureBlendingSystem: typeof TextureBlendingSystem !== 'undefined',
                scriptTags: Array.from(document.scripts).map(script => ({
                    src: script.src,
                    loaded: script.readyState || 'unknown'
                })).filter(script => script.src.includes('grass') || script.src.includes('texture'))
            };
        });
        
        console.log('[Grass Simple Debug] Class check:', classCheck);
        
        // Check board system configuration
        const boardCheck = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            return {
                grassSystemDisabled: window.boardSystem.grassSystemDisabled,
                textureBlendingDisabled: window.boardSystem.textureBlendingDisabled,
                hasGrassSystem: !!window.boardSystem.grassSystem,
                hasTextureBlending: !!window.boardSystem.textureBlendingSystem,
                boardMeshes: window.boardSystem.chunks ? window.boardSystem.chunks.size : 0
            };
        });
        
        console.log('[Grass Simple Debug] Board check:', boardCheck);
        
        // Check what's actually on the ground
        const groundCheck = await page.evaluate(() => {
            const scene = window.game ? window.game.scene : null;
            if (!scene) return { error: 'No scene found' };
            
            const groundMeshes = [];
            scene.traverse((child) => {
                if (child.isMesh && (
                    child.name?.includes('board') || 
                    child.name?.includes('ground') ||
                    child.name?.includes('terrain')
                )) {
                    groundMeshes.push({
                        name: child.name,
                        materialType: child.material?.type,
                        hasTexture: !!child.material?.map,
                        vertexColors: child.material?.vertexColors,
                        color: child.material?.color ? {
                            r: child.material.color.r,
                            g: child.material.color.g,
                            b: child.material.color.b
                        } : null
                    });
                }
            });
            
            return {
                groundMeshCount: groundMeshes.length,
                groundMeshes: groundMeshes.slice(0, 3)
            };
        });
        
        console.log('[Grass Simple Debug] Ground check:', groundCheck);
        
        // Try to manually create grass system
        console.log('[Grass Simple Debug] Attempting manual grass system creation...');
        
        const manualTest = await page.evaluate(() => {
            try {
                if (window.GrassSystem && window.boardSystem && !window.grassSystem) {
                    window.grassSystem = new GrassSystem(
                        window.boardSystem.scene,
                        window.boardSystem,
                        window.boardSystem.terrainSystem
                    );
                    return 'Grass system created successfully';
                } else {
                    return 'Cannot create grass system - missing dependencies or already exists';
                }
            } catch (error) {
                return `Error creating grass system: ${error.message}`;
            }
        });
        
        console.log('[Grass Simple Debug] Manual test:', manualTest);
        
        // Final check
        const finalCheck = await page.evaluate(() => {
            return {
                grassSystemExists: !!window.grassSystem,
                grassSystemWorking: window.grassSystem ? {
                    hasTexture: !!window.grassSystem.grassTexture,
                    hasMaterial: !!window.grassSystem.grassMaterial,
                    chunksCount: window.grassSystem.grassChunks.size
                } : null
            };
        });
        
        console.log('[Grass Simple Debug] Final check:', finalCheck);
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Grass Simple Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Grass Simple Debug] Browser closed.');
    }
}

debugGrassSimple().catch(err => {
    console.error(err);
    process.exit(1);
});
