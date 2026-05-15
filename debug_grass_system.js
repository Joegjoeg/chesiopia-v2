const { chromium } = require('playwright');

async function debugGrassSystem() {
    console.log('[Grass Debug] Analyzing grass system integration...');
    
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
        
        console.log('[Grass Debug] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        await page.waitForFunction(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            if (!loadingScreen) return true;
            const style = window.getComputedStyle(loadingScreen);
            return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        }, { timeout: 60000, polling: 200 });
        
        await page.waitForTimeout(3000);
        
        await page.waitForFunction(() => {
            return window.boardSystem && window.terrainSystem;
        }, { timeout: 10000 });
        
        // Check 1: System initialization
        const initCheck = await page.evaluate(() => {
            return {
                grassSystemExists: !!window.grassSystem,
                grassSystemDisabled: !!window.grassSystemDisabled,
                boardSystemExists: !!window.boardSystem,
                terrainSystemExists: !!window.terrainSystem,
                textureBlendingExists: !!window.textureBlendingSystem,
                globalVars: Object.keys(window).filter(key => key.toLowerCase().includes('grass'))
            };
        });
        
        console.log('[Grass Debug] Initialization check:', initCheck);
        
        // Check 2: Board system grass configuration
        const boardConfig = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            return {
                grassSystemDisabled: window.boardSystem.grassSystemDisabled,
                textureBlendingDisabled: window.boardSystem.textureBlendingDisabled,
                hasGrassSystem: !!window.boardSystem.grassSystem,
                hasTextureBlending: !!window.boardSystem.textureBlendingSystem,
                boardConfig: {
                    chunkSize: window.boardSystem.chunkSize,
                    meshMultiplier: window.boardSystem.meshMultiplier
                }
            };
        });
        
        console.log('[Grass Debug] Board system configuration:', boardConfig);
        
        // Check 3: What's actually being rendered on the board
        const renderCheck = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            // Check what textures/materials are being used
            const scene = window.boardSystem.scene;
            const meshes = [];
            
            scene.traverse((child) => {
                if (child.isMesh && child.material) {
                    meshes.push({
                        name: child.name || 'unnamed',
                        materialType: child.material.type,
                        hasTexture: !!child.material.map,
                        textureImage: child.material.map ? child.material.map.image : null,
                        vertexColors: child.material.vertexColors,
                        materialColor: child.material.color ? {
                            r: child.material.color.r,
                            g: child.material.color.g,
                            b: child.material.color.b
                        } : null
                    });
                }
            });
            
            return {
                totalMeshes: meshes.length,
                meshDetails: meshes.slice(0, 5), // First 5 meshes
                boardMeshes: meshes.filter(m => m.name && m.name.includes('board')),
                hasVertexColors: meshes.some(m => m.vertexColors),
                hasTextures: meshes.some(m => m.hasTexture)
            };
        });
        
        console.log('[Grass Debug] Rendering analysis:', renderCheck);
        
        // Check 4: Grass texture atlas if system exists
        const grassTextureCheck = await page.evaluate(() => {
            if (!window.grassSystem) return { error: 'Grass system not initialized' };
            
            const grassSystem = window.grassSystem;
            return {
                hasGrassTexture: !!grassSystem.grassTexture,
                hasGrassMaterial: !!grassSystem.grassMaterial,
                grassChunksCount: grassSystem.grassChunks.size,
                maxInstancesPerChunk: grassSystem.maxInstancesPerChunk,
                lodLevels: grassSystem.lodLevels,
                grassColors: grassSystem.grassColors || null,
                textureInfo: grassSystem.grassTexture ? {
                    width: grassSystem.grassTexture.image?.width,
                    height: grassSystem.grassTexture.image?.height,
                    isCanvas: grassSystem.grassTexture.image instanceof HTMLCanvasElement
                } : null
            };
        });
        
        console.log('[Grass Debug] Grass texture analysis:', grassTextureCheck);
        
        // Check 5: Try to manually activate grass system
        console.log('[Grass Debug] Attempting to manually initialize grass system...');
        
        const manualInit = await page.evaluate(() => {
            const results = [];
            
            // Try to create grass system if it doesn't exist
            if (!window.grassSystem && window.boardSystem && window.terrainSystem) {
                try {
                    console.log('Creating grass system manually...');
                    window.grassSystem = new GrassSystem(window.boardSystem.scene, window.boardSystem, window.terrainSystem);
                    results.push('Grass system created successfully');
                } catch (error) {
                    results.push(`Failed to create grass system: ${error.message}`);
                }
            } else if (window.grassSystem) {
                results.push('Grass system already exists');
            } else {
                results.push('Cannot create grass system - missing dependencies');
            }
            
            // Try to create texture blending system
            if (!window.textureBlendingSystem && window.boardSystem && window.terrainSystem) {
                try {
                    console.log('Creating texture blending system manually...');
                    window.textureBlendingSystem = new TextureBlendingSystem(window.boardSystem, window.terrainSystem);
                    results.push('Texture blending system created successfully');
                } catch (error) {
                    results.push(`Failed to create texture blending system: ${error.message}`);
                }
            } else if (window.textureBlendingSystem) {
                results.push('Texture blending system already exists');
            }
            
            return results;
        });
        
        console.log('[Grass Debug] Manual initialization results:', manualInit);
        
        // Check 6: Verify grass system after manual init
        const postInitCheck = await page.evaluate(() => {
            return {
                grassSystemExists: !!window.grassSystem,
                textureBlendingExists: !!window.textureBlendingSystem,
                grassSystemActive: window.grassSystem ? window.grassSystem.grassChunks.size > 0 : false,
                grassTextureReady: window.grassSystem ? !!window.grassSystem.grassTexture : false
            };
        });
        
        console.log('[Grass Debug] Post-initialization check:', postInitCheck);
        
        // Check 7: Test grass rendering at specific positions
        const grassTest = await page.evaluate(() => {
            if (!window.grassSystem) return { error: 'Grass system not available for testing' };
            
            const testPositions = [
                { x: 0, z: 0 },
                { x: 10, z: 10 },
                { x: -5, z: 5 }
            ];
            
            const results = testPositions.map(pos => {
                try {
                    // Try to get grass color at this position
                    const grassColor = window.grassSystem.getStableGrassColor ? 
                        window.grassSystem.getStableGrassColor(pos.x, pos.z, Date.now() * 0.001) : null;
                    
                    return {
                        position: pos,
                        grassColor: grassColor ? {
                            r: grassColor.r,
                            g: grassColor.g,
                            b: grassColor.b
                        } : null,
                        hasMethod: !!window.grassSystem.getStableGrassColor
                    };
                } catch (error) {
                    return {
                        position: pos,
                        error: error.message
                    };
                }
            });
            
            return results;
        });
        
        console.log('[Grass Debug] Grass color test results:', grassTest);
        
        // Take screenshot for visual verification
        await page.screenshot({ 
            path: 'd:\\Chesiopia v2\\screenshots\\grass_debug.png',
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Grass Debug] Screenshot saved for visual verification');
        
        console.log('[Grass Debug] ✅ Grass system debug complete!');
        
        await page.waitForTimeout(3000);
        
    } catch (error) {
        console.error('[Grass Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Grass Debug] Browser closed.');
    }
}

debugGrassSystem().catch(err => {
    console.error(err);
    process.exit(1);
});
