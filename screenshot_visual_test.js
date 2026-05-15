const { chromium } = require('playwright');
const path = require('path');

async function screenshotVisualTest() {
    console.log('[Screenshot Test] Starting visual verification of dev interface...');
    
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
        
        console.log('[Screenshot Test] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('[Screenshot Test] Waiting for loading screen to disappear...');
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
        
        // Screenshot 1: Initial state (no dev interface)
        console.log('[Screenshot Test] Taking screenshot 1: Initial game state...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-1-initial.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 2: Dev interface opened
        console.log('[Screenshot Test] Opening dev interface...');
        await page.evaluate(() => {
            window.devInterface.show();
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(2000);
        
        console.log('[Screenshot Test] Taking screenshot 2: Dev interface opened (terrain category)...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-2-dev-opened.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 3: First slider interaction
        console.log('[Screenshot Test] Testing first slider interaction (waterLevel to -2.0)...');
        await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (slider) {
                slider.value = -2.0;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('Slider set to -2.0');
            }
        });
        
        await page.waitForTimeout(2000); // Wait for water level to update visually
        
        console.log('[Screenshot Test] Taking screenshot 3: Water level changed to -2.0...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-3-water-level-2.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 4: Extreme water level change
        console.log('[Screenshot Test] Testing extreme water level change (waterLevel to -6.0)...');
        await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (slider) {
                slider.value = -6.0;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('Slider set to -6.0');
            }
        });
        
        await page.waitForTimeout(2000);
        
        console.log('[Screenshot Test] Taking screenshot 4: Water level changed to -6.0...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-4-water-level-6.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 5: Switch to lighting category
        console.log('[Screenshot Test] Switching to lighting category...');
        await page.evaluate(() => {
            window.devInterface.showCategory('lighting');
        });
        
        await page.waitForTimeout(1000);
        
        console.log('[Screenshot Test] Taking screenshot 5: Lighting category...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-5-lighting-category.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 6: Change sun intensity
        console.log('[Screenshot Test] Testing sun intensity change (to 2.0)...');
        await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="sunIntensity"] input[type="range"]');
            if (slider) {
                slider.value = 2.0;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('Sun intensity set to 2.0');
            }
        });
        
        await page.waitForTimeout(2000);
        
        console.log('[Screenshot Test] Taking screenshot 6: Sun intensity changed to 2.0...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-6-sun-intensity-2.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 7: Switch to time category
        console.log('[Screenshot Test] Switching to time category...');
        await page.evaluate(() => {
            window.devInterface.showCategory('time');
        });
        
        await page.waitForTimeout(1000);
        
        console.log('[Screenshot Test] Taking screenshot 7: Time category...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-7-time-category.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 8: Change time of day
        console.log('[Screenshot Test] Testing time of day change (to 18.0 - sunset)...');
        await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="dayTime"] input[type="range"]');
            if (slider) {
                slider.value = 18.0;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('Day time set to 18.0');
            }
        });
        
        await page.waitForTimeout(3000); // Wait for lighting to update
        
        console.log('[Screenshot Test] Taking screenshot 8: Time changed to 18.0 (sunset)...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-8-sunset-time.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 9: Multiple rapid changes
        console.log('[Screenshot Test] Testing multiple rapid slider changes...');
        await page.evaluate(() => {
            // Back to terrain
            window.devInterface.showCategory('terrain');
            
            // Rapid changes
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (slider) {
                slider.value = -1.0;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                
                setTimeout(() => {
                    slider.value = -4.5;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                }, 500);
                
                setTimeout(() => {
                    slider.value = -0.5;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                }, 1000);
            }
        });
        
        await page.waitForTimeout(2000);
        
        console.log('[Screenshot Test] Taking screenshot 9: After rapid changes...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-9-rapid-changes.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Screenshot 10: Final state with dev interface closed
        console.log('[Screenshot Test] Closing dev interface...');
        await page.evaluate(() => {
            window.devInterface.hide();
        });
        
        await page.waitForTimeout(1000);
        
        console.log('[Screenshot Test] Taking screenshot 10: Final state (dev interface closed)...');
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'test-10-final.png'),
            fullPage: false,
            type: 'png'
        });
        
        // Get final parameter values
        const finalValues = await page.evaluate(() => {
            return {
                waterLevel: window.parameterSystem.getParameter('waterLevel'),
                sunIntensity: window.parameterSystem.getParameter('sunIntensity'),
                dayTime: window.parameterSystem.getParameter('dayTime'),
                boardWaterLevel: window.boardSystem.waterLevel
            };
        });
        
        console.log('[Screenshot Test] Final parameter values:');
        console.log(`  Water Level: ${finalValues.waterLevel} (board: ${finalValues.boardWaterLevel})`);
        console.log(`  Sun Intensity: ${finalValues.sunIntensity}`);
        console.log(`  Day Time: ${finalValues.dayTime}`);
        
        console.log('[Screenshot Test] ✅ All screenshots captured successfully!');
        console.log('[Screenshot Test] Screenshots saved to: d:\\Chesiopia v2\\screenshots\\');
        
        await page.waitForTimeout(3000);
        
    } catch (error) {
        console.error('[Screenshot Test] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Screenshot Test] Browser closed.');
    }
}

screenshotVisualTest().catch(err => {
    console.error(err);
    process.exit(1);
});
