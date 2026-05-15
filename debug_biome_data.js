const { chromium } = require('playwright');

async function debugBiomeData() {
    console.log('[Biome Debug] Checking if terrain system provides biome data...');
    
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
        
        console.log('[Biome Debug] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000);
        
        // Test biome data availability
        const biomeTest = await page.evaluate(() => {
            const results = {
                terrainSystemExists: !!window.game?.terrainSystem,
                boardSystemExists: !!window.boardSystem,
                textureBlendingSystemExists: !!window.boardSystem?.textureBlendingSystem,
                biomeDataTest: []
            };
            
            // Test different positions for biome data
            const testPositions = [
                { x: 0, z: 0, name: 'center' },
                { x: 10, z: 10, name: 'positive' },
                { x: -10, z: -10, name: 'negative' },
                { x: 15, z: 15, name: 'mountain_area' },
                { x: -5, z: -5, name: 'water_area' }
            ];
            
            for (const pos of testPositions) {
                const testResult = {
                    position: pos,
                    terrainData: null,
                    adaptiveColor: null,
                    biomeColor: null
                };
                
                // Test terrain system getTileData
                if (window.game?.terrainSystem?.getTileData) {
                    try {
                        const tileData = window.game.terrainSystem.getTileData(pos.x, pos.z);
                        testResult.terrainData = tileData;
                    } catch (error) {
                        testResult.terrainError = error.message;
                    }
                }
                
                // Test adaptive color function
                if (window.boardSystem?.textureBlendingSystem?.getAdaptiveTerrainColor) {
                    try {
                        const color = window.boardSystem.textureBlendingSystem.getAdaptiveTerrainColor(pos.x, pos.z, Date.now() * 0.001);
                        testResult.adaptiveColor = {
                            r: color.r,
                            g: color.g,
                            b: color.b
                        };
                    } catch (error) {
                        testResult.adaptiveError = error.message;
                    }
                }
                
                // Test biome color mapping
                if (window.boardSystem?.textureBlendingSystem?.biomeColors) {
                    const biomeColors = window.boardSystem.textureBlendingSystem.biomeColors;
                    testResult.availableBiomes = Object.keys(biomeColors);
                }
                
                results.biomeDataTest.push(testResult);
            }
            
            return results;
        });
        
        console.log('[Biome Debug] Biome data test results:');
        biomeTest.biomeDataTest.forEach(test => {
            console.log(`\n${test.position.name} (${test.position.x}, ${test.position.z}):`);
            
            if (test.terrainData) {
                console.log(`  Terrain data: biome=${test.terrainData.biome}, elevation=${test.terrainData.elevation}, moisture=${test.terrainData.moisture}, temperature=${test.terrainData.temperature}`);
            } else if (test.terrainError) {
                console.log(`  Terrain error: ${test.terrainError}`);
            } else {
                console.log(`  Terrain data: Not available`);
            }
            
            if (test.adaptiveColor) {
                console.log(`  Adaptive color: RGB(${test.adaptiveColor.r.toFixed(3)}, ${test.adaptiveColor.g.toFixed(3)}, ${test.adaptiveColor.b.toFixed(3)})`);
            } else if (test.adaptiveError) {
                console.log(`  Adaptive error: ${test.adaptiveError}`);
            } else {
                console.log(`  Adaptive color: Not available`);
            }
            
            if (test.availableBiomes) {
                console.log(`  Available biomes: ${test.availableBiomes.join(', ')}`);
            }
        });
        
        // Check biome texture creation
        const textureTest = await page.evaluate(() => {
            const results = {};
            
            if (window.boardSystem?.textureBlendingSystem) {
                const system = window.boardSystem.textureBlendingSystem;
                
                // Test biome texture creation
                try {
                    const texture = system.createBiomeTexture();
                    results.biomeTextureCreated = !!texture;
                    results.textureSize = texture?.image ? {
                        width: texture.image.width,
                        height: texture.image.height
                    } : null;
                } catch (error) {
                    results.biomeTextureError = error.message;
                }
                
                // Test a few sample colors from the biome texture
                if (system.biomeTexture) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 10;
                    canvas.height = 10;
                    const ctx = canvas.getContext('2d');
                    
                    try {
                        ctx.drawImage(system.biomeTexture.image, 0, 0, 10, 10);
                        const imageData = ctx.getImageData(0, 0, 10, 10);
                        const sampleColors = [];
                        
                        for (let i = 0; i < imageData.data.length; i += 40) { // Sample every 10th pixel
                            sampleColors.push({
                                r: imageData.data[i],
                                g: imageData.data[i + 1],
                                b: imageData.data[i + 2]
                            });
                        }
                        
                        results.sampleColors = sampleColors.slice(0, 5); // First 5 samples
                    } catch (error) {
                        results.textureSampleError = error.message;
                    }
                }
            }
            
            return results;
        });
        
        console.log(`\n[Biome Debug] Texture test results:`);
        console.log(`  Biome texture created: ${textureTest.biomeTextureCreated}`);
        if (textureTest.textureSize) {
            console.log(`  Texture size: ${textureTest.textureSize.width}x${textureTest.textureSize.height}`);
        }
        if (textureTest.sampleColors) {
            console.log(`  Sample colors:`);
            textureTest.sampleColors.forEach((color, i) => {
                console.log(`    ${i + 1}: RGB(${color.r}, ${color.g}, ${color.b})`);
            });
        }
        if (textureTest.biomeTextureError) {
            console.log(`  Texture error: ${textureTest.biomeTextureError}`);
        }
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Biome Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Biome Debug] Browser closed.');
    }
}

debugBiomeData().catch(err => {
    console.error(err);
    process.exit(1);
});
