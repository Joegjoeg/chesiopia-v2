const { chromium } = require('playwright');

async function testDynamicShaderSystem() {
    console.log('[Dynamic Shader Test] Testing activated shader system...');
    
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
        
        console.log('[Dynamic Shader Test] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(8000);
        
        // Check for shader system activation
        const shaderMessages = consoleMessages.filter(msg => 
            msg.text.includes('dynamic shader material') ||
            msg.text.includes('Using dynamic shader') ||
            msg.text.includes('shader system')
        );
        
        console.log('[Dynamic Shader Test] Shader activation messages:');
        shaderMessages.forEach(msg => {
            console.log(`  [${msg.type.toUpperCase()}] ${msg.text}`);
        });
        
        // Check for any errors
        const errorMessages = consoleMessages.filter(msg => msg.type === 'error');
        if (errorMessages.length > 0) {
            console.log('[Dynamic Shader Test] ❌ Errors found:');
            errorMessages.forEach(msg => {
                console.log(`  [ERROR] ${msg.text}`);
            });
        } else {
            console.log('[Dynamic Shader Test] ✅ No errors in console');
        }
        
        // Test terrain system status
        const terrainStatus = await page.evaluate(() => {
            return {
                boardSystemExists: !!window.boardSystem,
                textureBlendingSystemExists: !!window.boardSystem?.textureBlendingSystem,
                shaderMaterialExists: !!window.boardSystem?.textureBlendingSystem?.shaderMaterial,
                viewportMeshExists: !!window.boardSystem?._viewportMesh,
                materialType: window.boardSystem?._viewportMesh?.material?.constructor?.name,
                isShaderMaterial: window.boardSystem?._viewportMesh?.material?.isShaderMaterial,
                hasVertexColors: !!window.boardSystem?._viewportMesh?.geometry?.attributes?.color
            };
        });
        
        console.log('[Dynamic Shader Test] Terrain status:', terrainStatus);
        
        // Test shader uniform updates
        const shaderTest = await page.evaluate(() => {
            const results = {};
            
            if (window.boardSystem?.textureBlendingSystem) {
                const system = window.boardSystem.textureBlendingSystem;
                
                // Test shader material creation
                try {
                    const material = system.createShaderMaterial();
                    results.shaderMaterialCreated = !!material;
                    results.materialType = material?.constructor?.name;
                    results.hasUniforms = !!material?.uniforms;
                    results.uniforms = material?.uniforms ? Object.keys(material.uniforms) : [];
                } catch (error) {
                    results.shaderMaterialError = error.message;
                }
                
                // Test shader uniform updates
                try {
                    system.updateShaderUniforms(
                        new THREE.Vector3(0, 10, 0), 
                        Date.now() * 0.001
                    );
                    results.uniformUpdateSuccess = true;
                } catch (error) {
                    results.uniformUpdateError = error.message;
                }
            }
            
            return results;
        });
        
        console.log('[Dynamic Shader Test] Shader system test:', shaderTest);
        
        // Take screenshots at different positions to test shader blending
        const testPositions = [
            { x: 0, z: 0, y: 15, name: 'close_view' },
            { x: 0, z: 0, y: 30, name: 'far_view' },
            { x: 10, z: 10, y: 20, name: 'angled_view' }
        ];
        
        for (const pos of testPositions) {
            // Position camera
            await page.evaluate(({ x, y, z }) => {
                if (window.game && window.game.camera) {
                    window.game.camera.position.set(x, y, z);
                    window.game.camera.lookAt(0, 0, 0);
                }
            }, { x: pos.x, y: pos.y, z: pos.z });
            
            await page.waitForTimeout(2000);
            
            // Take screenshot
            await page.screenshot({ 
                path: `d:\\Chesiopia v2\\screenshots\\shader_${pos.name}.png`,
                fullPage: false,
                type: 'png'
            });
            
            console.log(`[Dynamic Shader Test] Screenshot saved: shader_${pos.name}.png`);
        }
        
        const isWorking = terrainStatus.boardSystemExists && 
                          terrainStatus.textureBlendingSystemExists &&
                          terrainStatus.isShaderMaterial &&
                          terrainStatus.hasVertexColors &&
                          shaderTest.shaderMaterialCreated;
        
        console.log(`[Dynamic Shader Test] ${isWorking ? '✅' : '❌'} Dynamic shader system: ${isWorking ? 'WORKING' : 'NOT WORKING'}`);
        
        if (!isWorking) {
            console.log('[Dynamic Shader Test] Issues found:');
            if (!terrainStatus.boardSystemExists) console.log('  - Board system not found');
            if (!terrainStatus.textureBlendingSystemExists) console.log('  - Texture blending system not found');
            if (!terrainStatus.isShaderMaterial) console.log('  - Viewport mesh not using shader material');
            if (!terrainStatus.hasVertexColors) console.log('  - Viewport mesh missing vertex colors');
            if (!shaderTest.shaderMaterialCreated) console.log('  - Shader material creation failed');
        }
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Dynamic Shader Test] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Dynamic Shader Test] Browser closed.');
    }
}

testDynamicShaderSystem().catch(err => {
    console.error(err);
    process.exit(1);
});
