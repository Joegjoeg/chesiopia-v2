const { chromium } = require('playwright');
const path = require('path');

async function checkClientConsole() {
    console.log('[Console Check] Starting client console analysis...');
    
    const browser = await chromium.launch({
        headless: false,  // Show browser so we can see interactions
        args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1
        });
        
        const page = await context.newPage();
        
        // Collect all console logs
        const consoleLogs = [];
        page.on('console', msg => {
            consoleLogs.push({
                type: msg.type(),
                text: msg.text(),
                location: msg.location()
            });
        });
        
        // Collect page errors
        const pageErrors = [];
        page.on('pageerror', error => {
            pageErrors.push({
                message: error.message,
                stack: error.stack
            });
        });
        
        console.log('[Console Check] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('[Console Check] Waiting for loading screen to disappear...');
        await page.waitForFunction(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            if (!loadingScreen) return true;
            const style = window.getComputedStyle(loadingScreen);
            return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        }, { timeout: 60000, polling: 200 });
        
        console.log('[Console Check] Waiting for scene to stabilize...');
        await page.waitForTimeout(3000);
        
        // Wait for all systems to be available
        await page.waitForFunction(() => {
            return window.parameterSystem && window.devInterface && window.boardSystem;
        }, { timeout: 10000 });
        
        console.log('[Console Check] All systems available, opening dev interface...');
        
        // Clear console logs before we start testing
        consoleLogs.length = 0;
        pageErrors.length = 0;
        
        // Open dev interface and show terrain category
        await page.evaluate(() => {
            console.log('[Manual Test] Opening dev interface...');
            window.devInterface.show();
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(2000);
        
        // Test 1: Check initial console logs
        console.log('[Console Check] Initial console logs:');
        consoleLogs.slice(-10).forEach((log, index) => {
            console.log(`  ${index + 1}. [${log.type}] ${log.text}`);
        });
        
        // Test 2: Manually interact with slider using console
        console.log('[Console Check] Testing slider interaction via console...');
        
        const sliderTestResult = await page.evaluate(() => {
            console.log('[Manual Test] Looking for waterLevel slider...');
            
            const sliderContainer = document.querySelector('[data-parameter="waterLevel"]');
            if (!sliderContainer) {
                console.log('[Manual Test] Slider container not found');
                return 'Container not found';
            }
            
            const slider = sliderContainer.querySelector('input[type="range"]');
            if (!slider) {
                console.log('[Manual Test] Slider input not found');
                return 'Slider not found';
            }
            
            console.log(`[Manual Test] Found slider, current value: ${slider.value}`);
            
            // Test setting a new value
            const oldValue = slider.value;
            slider.value = -4.5;
            console.log(`[Manual Test] Setting slider to: ${slider.value}`);
            
            // Trigger events
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[Manual Test] Dispatched input event');
            
            slider.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[Manual Test] Dispatched change event');
            
            // Check parameter system
            const paramValue = window.parameterSystem.getParameter('waterLevel');
            console.log(`[Manual Test] Parameter system value: ${paramValue}`);
            
            // Check board system
            const boardValue = window.boardSystem.waterLevel;
            console.log(`[Manual Test] Board system value: ${boardValue}`);
            
            return `Slider changed from ${oldValue} to ${slider.value}, param: ${paramValue}, board: ${boardValue}`;
        });
        
        console.log(`[Console Check] Slider test result: ${sliderTestResult}`);
        
        await page.waitForTimeout(1000);
        
        // Test 3: Check console logs after slider interaction
        console.log('[Console Check] Console logs after slider interaction:');
        consoleLogs.slice(-15).forEach((log, index) => {
            console.log(`  ${index + 1}. [${log.type}] ${log.text}`);
        });
        
        // Test 4: Try multiple slider interactions
        console.log('[Console Check] Testing multiple slider interactions...');
        
        await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (slider) {
                for (let i = 0; i < 5; i++) {
                    const value = -Math.random() * 8; // Random value between -8 and 0
                    slider.value = value;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                    console.log(`[Manual Test] Slider interaction ${i + 1}: set to ${value}`);
                }
            }
        });
        
        await page.waitForTimeout(2000);
        
        // Test 5: Check final console logs
        console.log('[Console Check] Final console logs (last 20):');
        consoleLogs.slice(-20).forEach((log, index) => {
            console.log(`  ${index + 1}. [${log.type}] ${log.text}`);
        });
        
        // Test 6: Check for any errors
        if (pageErrors.length > 0) {
            console.log('[Console Check] Page errors found:');
            pageErrors.forEach((error, index) => {
                console.log(`  ${index + 1}. ${error.message}`);
                if (error.stack) {
                    console.log(`     Stack: ${error.stack.split('\n')[0]}`);
                }
            });
        } else {
            console.log('[Console Check] No page errors detected');
        }
        
        // Test 7: Get final parameter values
        const finalValues = await page.evaluate(() => {
            return {
                parameterValue: window.parameterSystem.getParameter('waterLevel'),
                boardValue: window.boardSystem.waterLevel,
                sliderValue: document.querySelector('[data-parameter="waterLevel"] input[type="range"]')?.value
            };
        });
        
        console.log('[Console Check] Final values:');
        console.log(`  Parameter system: ${finalValues.parameterValue}`);
        console.log(`  Board system: ${finalValues.boardValue}`);
        console.log(`  Slider: ${finalValues.sliderValue}`);
        
        // Take screenshot for verification
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'console-check.png'),
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Console Check] Screenshot saved');
        
        // Wait 3 seconds so we can see the final state
        await page.waitForTimeout(3000);
        
    } catch (error) {
        console.error('[Console Check] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Console Check] Browser closed.');
    }
}

checkClientConsole().catch(err => {
    console.error(err);
    process.exit(1);
});
