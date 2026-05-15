const { chromium } = require('playwright');
const path = require('path');

async function testParameters() {
    console.log('[Test] Starting browser parameter test...');
    
    const browser = await chromium.launch({
        headless: false,  // Show browser so we can interact
        args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1
        });
        
        const page = await context.newPage();
        
        console.log('[Test] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('[Test] Waiting for loading screen to disappear...');
        await page.waitForFunction(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            if (!loadingScreen) return true;
            const style = window.getComputedStyle(loadingScreen);
            return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        }, { timeout: 60000, polling: 200 });
        
        console.log('[Test] Waiting for scene to stabilize...');
        await page.waitForTimeout(3000);
        
        // Wait for parameter system to be available
        await page.waitForFunction(() => {
            return window.parameterSystem && window.devInterface;
        }, { timeout: 10000 });
        
        console.log('[Test] Parameter system available, testing...');
        
        // Test 1: Check initial waterLevel value
        const initialWaterLevel = await page.evaluate(() => {
            return window.parameterSystem.getParameter('waterLevel');
        });
        console.log(`[Test] Initial waterLevel: ${initialWaterLevel}`);
        
        // Test 2: Set a new value
        const testValue = -3.5;
        console.log(`[Test] Setting waterLevel to: ${testValue}`);
        
        await page.evaluate((value) => {
            window.parameterSystem.setParameter('waterLevel', value);
        }, testValue);
        
        // Wait a moment for the change to propagate
        await page.waitForTimeout(1000);
        
        // Test 3: Check if the value was actually set
        const actualWaterLevel = await page.evaluate(() => {
            return window.parameterSystem.getParameter('waterLevel');
        });
        console.log(`[Test] Actual waterLevel after setting: ${actualWaterLevel}`);
        
        // Test 4: Check the board system's waterLevel
        const boardWaterLevel = await page.evaluate(() => {
            if (window.boardSystem) {
                return window.boardSystem.waterLevel;
            }
            return 'boardSystem not available';
        });
        console.log(`[Test] Board system waterLevel: ${boardWaterLevel}`);
        
        // Test 5: Try to use the dev interface
        console.log('[Test] Opening dev interface...');
        await page.evaluate(() => {
            window.devInterface.show();
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(2000);
        
        // Test 6: Try to interact with slider
        console.log('[Test] Attempting to interact with waterLevel slider...');
        
        const sliderResult = await page.evaluate(() => {
            // The slider is inside a div with data-parameter
            const sliderContainer = document.querySelector('[data-parameter="waterLevel"]');
            if (sliderContainer) {
                const slider = sliderContainer.querySelector('input[type="range"]');
                if (slider) {
                    console.log('Found waterLevel slider, current value:', slider.value);
                    slider.value = -2.0;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                    slider.dispatchEvent(new Event('change', { bubbles: true }));
                    return 'Slider found and updated to -2.0';
                }
            }
            return 'Slider not found';
        });
        
        console.log(`[Test] Slider interaction result: ${sliderResult}`);
        
        await page.waitForTimeout(1000);
        
        // Test 7: Check final values
        const finalWaterLevel = await page.evaluate(() => {
            return window.parameterSystem.getParameter('waterLevel');
        });
        console.log(`[Test] Final waterLevel after slider: ${finalWaterLevel}`);
        
        // Take screenshot for verification
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'parameter-test.png'),
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Test] Screenshot saved');
        
    } catch (error) {
        console.error('[Test] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Test] Browser closed.');
    }
}

testParameters().catch(err => {
    console.error(err);
    process.exit(1);
});
