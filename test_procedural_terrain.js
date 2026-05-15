const { chromium } = require('playwright');

async function testProceduralTerrain() {
    console.log('[Procedural Test] Testing biome texture system...');
    
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
        
        console.log('[Procedural Test] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000);
        
        // Check for procedural texture creation
        const textureMessages = consoleMessages.filter(msg => 
            msg.text.includes('Procedural biome texture') ||
            msg.text.includes('Creating procedural biome texture')
        );
        
        console.log('[Procedural Test] Texture creation messages:');
        textureMessages.forEach(msg => {
            console.log(`  [${msg.type.toUpperCase()}] ${msg.text}`);
        });
        
        // Check for any errors
        const errorMessages = consoleMessages.filter(msg => msg.type === 'error');
        if (errorMessages.length > 0) {
            console.log('[Procedural Test] ❌ Errors found:');
            errorMessages.forEach(msg => {
                console.log(`  [ERROR] ${msg.text}`);
            });
        } else {
            console.log('[Procedural Test] ✅ No errors in console');
        }
        
        // Test terrain system status
        const terrainStatus = await page.evaluate(() => {
            return {
                boardSystemExists: !!window.boardSystem,
                grassTextureExists: !!window.boardSystem?.grassTexture,
                textureType: window.boardSystem?.grassTexture?.constructor?.name,
                isCanvasTexture: window.boardSystem?.grassTexture?.isCanvasTexture,
                viewportMeshExists: !!window.boardSystem?._viewportMesh,
                materialMap: !!window.boardSystem?._viewportMesh?.material?.map,
                vertexColorsEnabled: window.boardSystem?._viewportMesh?.material?.vertexColors
            };
        });
        
        console.log('[Procedural Test] Terrain status:', terrainStatus);
        
        // Take screenshots at different positions to test texture variation
        const testPositions = [
            { x: 0, z: 0, name: 'center' },
            { x: 20, z: 20, name: 'high_elevation' },
            { x: -10, z: -10, name: 'water_area' },
            { x: 15, z: -15, name: 'mixed_terrain' }
        ];
        
        for (const pos of testPositions) {
            // Move camera to position
            await page.evaluate(({ x, z }) => {
                if (window.game && window.game.camera) {
                    window.game.camera.position.set(x, 20, z);
                    window.game.camera.lookAt(0, 0, 0);
                }
            }, { x: pos.x, z: pos.z });
            
            await page.waitForTimeout(1000);
            
            // Take screenshot
            await page.screenshot({ 
                path: `d:\\Chesiopia v2\\screenshots\\procedural_${pos.name}.png`,
                fullPage: false,
                type: 'png'
            });
            
            console.log(`[Procedural Test] Screenshot saved: procedural_${pos.name}.png`);
        }
        
        // Test texture analysis
        const textureAnalysis = await page.evaluate(() => {
            const results = {
                textureInfo: {},
                materialInfo: {},
                meshInfo: {}
            };
            
            if (window.boardSystem?.grassTexture) {
                const texture = window.boardSystem.grassTexture;
                results.textureInfo = {
                    type: texture.constructor.name,
                    isCanvasTexture: !!texture.isCanvasTexture,
                    hasImage: !!texture.image,
                    imageSize: texture.image ? {
                        width: texture.image.width,
                        height: texture.image.height
                    } : null,
                    wrapS: texture.wrapS,
                    wrapT: texture.wrapT,
                    colorSpace: texture.colorSpace
                };
            }
            
            if (window.boardSystem?._viewportMesh?.material) {
                const material = window.boardSystem._viewportMesh.material;
                results.materialInfo = {
                    type: material.constructor.name,
                    hasMap: !!material.map,
                    vertexColors: material.vertexColors,
                    color: material.color ? {
                        r: material.color.r,
                        g: material.color.g,
                        b: material.color.b
                    } : null
                };
            }
            
            if (window.boardSystem?._viewportMesh?.geometry) {
                const geometry = window.boardSystem._viewportMesh.geometry;
                results.meshInfo = {
                    hasColors: !!geometry.attributes.color,
                    hasUVs: !!geometry.attributes.uv,
                    vertexCount: geometry.attributes.position?.count || 0
                };
            }
            
            return results;
        });
        
        console.log('[Procedural Test] Texture analysis:', textureAnalysis);
        
        const isWorking = terrainStatus.boardSystemExists && 
                          terrainStatus.grassTextureExists &&
                          terrainStatus.isCanvasTexture &&
                          !terrainStatus.vertexColorsEnabled;
        
        console.log(`[Procedural Test] ${isWorking ? '✅' : '❌'} Procedural biome texture: ${isWorking ? 'WORKING' : 'NOT WORKING'}`);
        
        if (!isWorking) {
            console.log('[Procedural Test] Issues found:');
            if (!terrainStatus.boardSystemExists) console.log('  - Board system not found');
            if (!terrainStatus.grassTextureExists) console.log('  - Grass texture not found');
            if (!terrainStatus.isCanvasTexture) console.log('  - Texture is not procedural canvas');
            if (terrainStatus.vertexColorsEnabled) console.log('  - Vertex colors still enabled (should be disabled)');
        }
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Procedural Test] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Procedural Test] Browser closed.');
    }
}

testProceduralTerrain().catch(err => {
    console.error(err);
    process.exit(1);
});
