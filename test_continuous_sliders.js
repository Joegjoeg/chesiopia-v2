const { chromium } = require('playwright');
const path = require('path');

async function testContinuousSliders() {
    console.log('[Continuous Test] Testing continuous slider functionality...');
    
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
        
        console.log('[Continuous Test] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('[Continuous Test] Waiting for loading screen to disappear...');
        await page.waitForFunction(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            if (!loadingScreen) return true;
            const style = window.getComputedStyle(loadingScreen);
            return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        }, { timeout: 60000, polling: 200 });
        
        await page.waitForTimeout(3000);
        
        await page.waitForFunction(() => {
            return window.parameterSystem && window.devInterface && window.boardSystem;
        }, { timeout: 10000 });
        
        console.log('[Continuous Test] Opening dev interface...');
        await page.evaluate(() => {
            window.devInterface.show();
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(2000);
        
        // Test 1: Initial state
        const initialState = await page.evaluate(() => {
            return {
                parameterValue: window.parameterSystem.getParameter('waterLevel'),
                boardValue: window.boardSystem.waterLevel,
                sliderValue: document.querySelector('[data-parameter="waterLevel"] input[type="range"]')?.value
            };
        });
        
        console.log(`[Continuous Test] Initial state: param=${initialState.parameterValue}, board=${initialState.boardValue}, slider=${initialState.sliderValue}`);
        
        // Test 2: Multiple continuous slider interactions
        console.log('[Continuous Test] Testing multiple slider interactions...');
        
        const testValues = [-2.0, -1.0, -3.0, -4.5, -0.5, -5.0, -2.5];
        const results = [];
        
        for (let i = 0; i < testValues.length; i++) {
            const testValue = testValues[i];
            
            const interactionResult = await page.evaluate((value) => {
                const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
                if (!slider) return { success: false, error: 'Slider not found' };
                
                // Set slider value
                slider.value = value;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                
                // Get all values after interaction
                const paramValue = window.parameterSystem.getParameter('waterLevel');
                const boardValue = window.boardSystem.waterLevel;
                const sliderValue = slider.value;
                
                return {
                    success: true,
                    setValue: value,
                    paramValue,
                    boardValue,
                    sliderValue,
                    synchronized: Math.abs(paramValue - boardValue) < 0.01 && Math.abs(boardValue - parseFloat(sliderValue)) < 0.01
                };
            }, testValue);
            
            results.push(interactionResult);
            console.log(`[Continuous Test] ${i + 1}. Set to ${testValue} → param=${interactionResult.paramValue}, board=${interactionResult.boardValue}, slider=${interactionResult.sliderValue}, synced=${interactionResult.synchronized}`);
            
            await page.waitForTimeout(500); // Small delay between interactions
        }
        
        // Test 3: Test rapid slider movements
        console.log('[Continuous Test] Testing rapid slider movements...');
        
        const rapidTest = await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (!slider) return { success: false, error: 'Slider not found' };
            
            const results = [];
            
            // Rapid movements
            for (let i = 0; i < 10; i++) {
                const value = -Math.random() * 8; // Random between -8 and 0
                slider.value = value;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                
                results.push({
                    iteration: i,
                    value,
                    paramValue: window.parameterSystem.getParameter('waterLevel'),
                    boardValue: window.boardSystem.waterLevel
                });
            }
            
            return { success: true, results };
        });
        
        if (rapidTest.success) {
            console.log('[Continuous Test] Rapid test results:');
            rapidTest.results.forEach(result => {
                console.log(`  ${result.iteration + 1}. ${result.value.toFixed(2)} → param=${result.paramValue}, board=${result.boardValue}`);
            });
        }
        
        // Test 4: Test different parameter categories
        console.log('[Continuous Test] Testing different parameter categories...');
        
        const categoryTests = await page.evaluate(() => {
            const results = {};
            
            // Test lighting category
            window.devInterface.showCategory('lighting');
            
            const sunSlider = document.querySelector('[data-parameter="sunIntensity"] input[type="range"]');
            if (sunSlider) {
                sunSlider.value = 1.5;
                sunSlider.dispatchEvent(new Event('input', { bubbles: true }));
                
                results.sunIntensity = {
                    setValue: 1.5,
                    paramValue: window.parameterSystem.getParameter('sunIntensity'),
                    sliderValue: sunSlider.value
                };
            }
            
            // Test time category
            window.devInterface.showCategory('time');
            
            const dayTimeSlider = document.querySelector('[data-parameter="dayTime"] input[type="range"]');
            if (dayTimeSlider) {
                dayTimeSlider.value = 14.0;
                dayTimeSlider.dispatchEvent(new Event('input', { bubbles: true }));
                
                results.dayTime = {
                    setValue: 14.0,
                    paramValue: window.parameterSystem.getParameter('dayTime'),
                    sliderValue: dayTimeSlider.value
                };
            }
            
            return results;
        });
        
        console.log('[Continuous Test] Category test results:');
        Object.entries(categoryTests).forEach(([param, result]) => {
            console.log(`  ${param}: set=${result.setValue}, param=${result.paramValue}, slider=${result.sliderValue}`);
        });
        
        // Test 5: Final verification
        const finalState = await page.evaluate(() => {
            return {
                parameterValue: window.parameterSystem.getParameter('waterLevel'),
                boardValue: window.boardSystem.waterLevel,
                sliderValue: document.querySelector('[data-parameter="waterLevel"] input[type="range"]')?.value
            };
        });
        
        console.log(`[Continuous Test] Final state: param=${finalState.parameterValue}, board=${finalState.boardValue}, slider=${finalState.sliderValue}`);
        
        // Summary
        const successCount = results.filter(r => r.success && r.synchronized).length;
        const totalTests = results.length;
        
        console.log(`[Continuous Test] SUMMARY: ${successCount}/${totalTests} tests passed (${((successCount/totalTests)*100).toFixed(1)}%)`);
        
        if (successCount === totalTests) {
            console.log('[Continuous Test] ✅ ALL TESTS PASSED - Sliders working continuously!');
        } else {
            console.log('[Continuous Test] ❌ Some tests failed');
        }
        
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'continuous-test.png'),
            fullPage: false,
            type: 'png'
        });
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Continuous Test] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Continuous Test] Browser closed.');
    }
}

testContinuousSliders().catch(err => {
    console.error(err);
    process.exit(1);
});
