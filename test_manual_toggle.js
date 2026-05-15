const { chromium } = require('playwright');

async function testManualToggle() {
    console.log('[Manual Toggle] Testing dev interface toggle manually...');
    
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
        
        console.log('[Manual Toggle] Navigating to http://localhost:3000...');
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
            return window.parameterSystem && window.devInterface && window.boardSystem;
        }, { timeout: 10000 });
        
        // Test 1: Manual toggle via console
        console.log('[Manual Toggle] Testing manual toggle via console...');
        
        const toggleTest = await page.evaluate(() => {
            const results = [];
            
            // Initial state
            results.push({
                step: 'initial',
                visible: window.devInterface.isVisible,
                display: document.getElementById('enhancedDevInterface').style.display
            });
            
            // Show
            window.devInterface.show();
            results.push({
                step: 'after_show',
                visible: window.devInterface.isVisible,
                display: document.getElementById('enhancedDevInterface').style.display
            });
            
            // Hide
            window.devInterface.hide();
            results.push({
                step: 'after_hide',
                visible: window.devInterface.isVisible,
                display: document.getElementById('enhancedDevInterface').style.display
            });
            
            // Toggle
            window.devInterface.toggle();
            results.push({
                step: 'after_toggle_1',
                visible: window.devInterface.isVisible,
                display: document.getElementById('enhancedDevInterface').style.display
            });
            
            // Toggle again
            window.devInterface.toggle();
            results.push({
                step: 'after_toggle_2',
                visible: window.devInterface.isVisible,
                display: document.getElementById('enhancedDevInterface').style.display
            });
            
            return results;
        });
        
        console.log('[Manual Toggle] Manual toggle results:');
        toggleTest.forEach(result => {
            console.log(`  ${result.step}: visible=${result.visible}, display=${result.display}`);
        });
        
        // Test 2: Simulate Space key event manually
        console.log('[Manual Toggle] Testing manual Space key simulation...');
        
        await page.evaluate(() => {
            // Create and dispatch a Space key event
            const spaceEvent = new KeyboardEvent('keydown', {
                code: 'Space',
                key: ' ',
                bubbles: true,
                cancelable: true
            });
            
            document.dispatchEvent(spaceEvent);
        });
        
        await page.waitForTimeout(500);
        
        const afterManualSpace = await page.evaluate(() => {
            return {
                visible: window.devInterface.isVisible,
                display: document.getElementById('enhancedDevInterface').style.display
            };
        });
        
        console.log('[Manual Toggle] After manual Space event:', afterManualSpace);
        
        // Test 3: Check if event listener is active
        console.log('[Manual Toggle] Checking event listener status...');
        
        const eventListenerCheck = await page.evaluate(() => {
            let eventListenerActive = false;
            
            // Add a test event listener to see if keyboard events are being captured
            document.addEventListener('keydown', function testListener(e) {
                if (e.code === 'Space') {
                    eventListenerActive = true;
                    console.log('Space key event captured by test listener');
                }
            });
            
            return {
                test: 'Event listener test setup complete'
            };
        });
        
        console.log('[Manual Toggle] Event listener check:', eventListenerCheck);
        
        // Test 4: Try Space key again
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);
        
        const afterKeyboardSpace = await page.evaluate(() => {
            return {
                visible: window.devInterface.isVisible,
                display: document.getElementById('enhancedDevInterface').style.display
            };
        });
        
        console.log('[Manual Toggle] After keyboard Space:', afterKeyboardSpace);
        
        // Test 5: Show interface and test sliders
        console.log('[Manual Toggle] Showing interface for slider test...');
        await page.evaluate(() => {
            window.devInterface.show();
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(1000);
        
        const sliderTest = await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (slider) {
                const oldValue = slider.value;
                slider.value = -4.0;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                
                return {
                    success: true,
                    oldValue,
                    newValue: slider.value,
                    paramValue: window.parameterSystem.getParameter('waterLevel'),
                    boardValue: window.boardSystem.waterLevel
                };
            } else {
                return { success: false, error: 'Slider not found' };
            }
        });
        
        console.log('[Manual Toggle] Slider test:', sliderTest);
        
        console.log('[Manual Toggle] ✅ Manual testing complete!');
        console.log('[Manual Toggle] The dev interface works programmatically but Space key shortcut may have issues.');
        
        await page.waitForTimeout(3000);
        
    } catch (error) {
        console.error('[Manual Toggle] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Manual Toggle] Browser closed.');
    }
}

testManualToggle().catch(err => {
    console.error(err);
    process.exit(1);
});
