const { chromium } = require('playwright');
const path = require('path');

async function debugSliderIssue() {
    console.log('[Debug] Starting detailed slider debug...');
    
    const browser = await chromium.launch({
        headless: false,  // Show browser so we can see what's happening
        args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1
        });
        
        const page = await context.newPage();
        
        console.log('[Debug] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('[Debug] Waiting for loading screen to disappear...');
        await page.waitForFunction(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            if (!loadingScreen) return true;
            const style = window.getComputedStyle(loadingScreen);
            return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        }, { timeout: 60000, polling: 200 });
        
        console.log('[Debug] Waiting for scene to stabilize...');
        await page.waitForTimeout(3000);
        
        // Wait for all systems to be available
        await page.waitForFunction(() => {
            return window.parameterSystem && window.devInterface && window.boardSystem;
        }, { timeout: 10000 });
        
        console.log('[Debug] All systems available, opening dev interface...');
        
        // Open dev interface and show terrain category
        await page.evaluate(() => {
            window.devInterface.show();
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(2000);
        
        // Debug 1: Check if dev interface is visible
        const devInterfaceVisible = await page.evaluate(() => {
            const devInterface = document.getElementById('enhancedDevInterface');
            return devInterface && devInterface.style.display !== 'none';
        });
        console.log(`[Debug] Dev interface visible: ${devInterfaceVisible}`);
        
        // Debug 2: Examine the DOM structure
        const domStructure = await page.evaluate(() => {
            const contentArea = document.getElementById('devContentArea');
            if (!contentArea) return 'Content area not found';
            
            const allElements = contentArea.querySelectorAll('*');
            const elements = [];
            
            allElements.forEach((el, index) => {
                elements.push({
                    index,
                    tagName: el.tagName,
                    className: el.className,
                    id: el.id,
                    dataset: { ...el.dataset },
                    type: el.type,
                    value: el.value,
                    textContent: el.textContent ? el.textContent.substring(0, 50) : ''
                });
            });
            
            return {
                totalElements: allElements.length,
                elements: elements.slice(0, 20) // First 20 elements
            };
        });
        
        console.log('[Debug] DOM Structure:');
        console.log(JSON.stringify(domStructure, null, 2));
        
        // Debug 3: Look specifically for waterLevel elements
        const waterLevelElements = await page.evaluate(() => {
            const results = [];
            
            // Try different selectors
            const selectors = [
                '[data-parameter="waterLevel"]',
                'input[data-parameter="waterLevel"]',
                'input[type="range"]',
                '[data-parameter*="water"]',
                '*[data-parameter]'
            ];
            
            selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                results.push({
                    selector,
                    found: elements.length,
                    elements: Array.from(elements).map(el => ({
                        tagName: el.tagName,
                        type: el.type,
                        value: el.value,
                        dataset: { ...el.dataset },
                        parent: el.parentElement?.tagName,
                        visible: el.offsetParent !== null
                    }))
                });
            });
            
            return results;
        });
        
        console.log('[Debug] WaterLevel element search:');
        console.log(JSON.stringify(waterLevelElements, null, 2));
        
        // Debug 4: Check if terrain category was actually created
        const categoryDebug = await page.evaluate(() => {
            const devInterface = window.devInterface;
            return {
                currentCategory: devInterface.currentCategory,
                cachedCategories: Array.from(devInterface.categoryCache.keys()),
                categoryCacheSize: devInterface.categoryCache.size
            };
        });
        
        console.log('[Debug] Category info:');
        console.log(JSON.stringify(categoryDebug, null, 2));
        
        // Debug 5: Try to manually trigger slider creation
        console.log('[Debug] Manually triggering terrain category creation...');
        await page.evaluate(() => {
            window.devInterface.categoryCache.clear(); // Clear cache
            window.devInterface.showCategory('terrain'); // Recreate
        });
        
        await page.waitForTimeout(1000);
        
        // Debug 6: Check again after recreation
        const afterRecreation = await page.evaluate(() => {
            const waterLevelElements = document.querySelectorAll('[data-parameter="waterLevel"]');
            return {
                found: waterLevelElements.length,
                elements: Array.from(waterLevelElements).map(el => ({
                    tagName: el.tagName,
                    type: el.type,
                    value: el.value,
                    dataset: { ...el.dataset }
                }))
            };
        });
        
        console.log('[Debug] After recreation:');
        console.log(JSON.stringify(afterRecreation, null, 2));
        
        // Take screenshot for manual inspection
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'debug-sliders.png'),
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Debug] Screenshot saved for manual inspection');
        
        // Wait 5 seconds so we can see the browser
        await page.waitForTimeout(5000);
        
    } catch (error) {
        console.error('[Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Debug] Browser closed.');
    }
}

debugSliderIssue().catch(err => {
    console.error(err);
    process.exit(1);
});
