const { chromium } = require('playwright');
const path = require('path');

async function debugSliderCaching() {
    console.log('[Cache Debug] Investigating slider caching issue...');
    
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
        
        console.log('[Cache Debug] Navigating to http://localhost:3000...');
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
        
        console.log('[Cache Debug] Opening dev interface...');
        await page.evaluate(() => {
            window.devInterface.show();
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(2000);
        
        // Debug 1: Check initial cache state
        const cacheState1 = await page.evaluate(() => {
            const devInterface = window.devInterface;
            return {
                currentCategory: devInterface.currentCategory,
                cacheSize: devInterface.categoryCache.size,
                cachedKeys: Array.from(devInterface.categoryCache.keys()),
                waterLevelSlider: !!document.querySelector('[data-parameter="waterLevel"] input[type="range"]')
            };
        });
        
        console.log('[Cache Debug] Initial cache state:', cacheState1);
        
        // Debug 2: First slider interaction
        console.log('[Cache Debug] First slider interaction...');
        const firstInteraction = await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (!slider) return { error: 'Slider not found initially' };
            
            console.log('Found slider, value:', slider.value);
            slider.value = -2.0;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            
            return {
                success: true,
                oldValue: -1.5,
                newValue: slider.value,
                paramValue: window.parameterSystem.getParameter('waterLevel')
            };
        });
        
        console.log('[Cache Debug] First interaction result:', firstInteraction);
        
        await page.waitForTimeout(1000);
        
        // Debug 3: Check cache state after first interaction
        const cacheState2 = await page.evaluate(() => {
            const devInterface = window.devInterface;
            return {
                currentCategory: devInterface.currentCategory,
                cacheSize: devInterface.categoryCache.size,
                cachedKeys: Array.from(devInterface.categoryCache.keys()),
                waterLevelSlider: !!document.querySelector('[data-parameter="waterLevel"] input[type="range"]'),
                sliderValue: document.querySelector('[data-parameter="waterLevel"] input[type="range"]')?.value
            };
        });
        
        console.log('[Cache Debug] Cache state after first interaction:', cacheState2);
        
        // Debug 4: Second slider interaction
        console.log('[Cache Debug] Second slider interaction...');
        const secondInteraction = await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (!slider) {
                console.log('Slider not found on second interaction!');
                // Debug what happened to the DOM
                const waterLevelContainer = document.querySelector('[data-parameter="waterLevel"]');
                return {
                    error: 'Slider not found on second interaction',
                    containerExists: !!waterLevelContainer,
                    containerContent: waterLevelContainer ? waterLevelContainer.innerHTML : 'No container'
                };
            }
            
            console.log('Found slider on second try, value:', slider.value);
            slider.value = -3.0;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            
            return {
                success: true,
                oldValue: slider.value,
                newValue: slider.value,
                paramValue: window.parameterSystem.getParameter('waterLevel')
            };
        });
        
        console.log('[Cache Debug] Second interaction result:', secondInteraction);
        
        // Debug 5: Check if switching categories breaks things
        console.log('[Cache Debug] Testing category switch...');
        await page.evaluate(() => {
            window.devInterface.showCategory('lighting');
        });
        
        await page.waitForTimeout(1000);
        
        await page.evaluate(() => {
            window.devInterface.showCategory('terrain');
        });
        
        await page.waitForTimeout(1000);
        
        // Debug 6: Check cache after category switch
        const cacheState3 = await page.evaluate(() => {
            const devInterface = window.devInterface;
            return {
                currentCategory: devInterface.currentCategory,
                cacheSize: devInterface.categoryCache.size,
                cachedKeys: Array.from(devInterface.categoryCache.keys()),
                waterLevelSlider: !!document.querySelector('[data-parameter="waterLevel"] input[type="range"]'),
                sliderValue: document.querySelector('[data-parameter="waterLevel"] input[type="range"]')?.value
            };
        });
        
        console.log('[Cache Debug] Cache state after category switch:', cacheState3);
        
        // Debug 7: Third slider interaction after category switch
        console.log('[Cache Debug] Third slider interaction after category switch...');
        const thirdInteraction = await page.evaluate(() => {
            const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
            if (!slider) {
                return { error: 'Slider not found after category switch' };
            }
            
            slider.value = -4.0;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            
            return {
                success: true,
                paramValue: window.parameterSystem.getParameter('waterLevel')
            };
        });
        
        console.log('[Cache Debug] Third interaction result:', thirdInteraction);
        
        // Debug 8: Check showCachedCategory method behavior
        const cacheMethodDebug = await page.evaluate(() => {
            const devInterface = window.devInterface;
            
            // Manually call showCachedCategory to see what happens
            const currentCategory = devInterface.currentCategory;
            console.log('Current category before manual call:', currentCategory);
            
            // Check the cached content
            const cachedContent = devInterface.categoryCache.get(currentCategory);
            console.log('Cached content type:', cachedContent ? cachedContent.nodeType : 'null');
            console.log('Cached content children:', cachedContent ? cachedContent.children.length : 'N/A');
            
            // Check if waterLevel slider is in cached content
            const waterLevelInCache = cachedContent ? cachedContent.querySelector('[data-parameter="waterLevel"] input[type="range"]') : null;
            console.log('WaterLevel slider in cache:', !!waterLevelInCache);
            
            return {
                currentCategory,
                cacheHasContent: !!cachedContent,
                cacheChildrenCount: cachedContent ? cachedContent.children.length : 0,
                waterLevelInCache: !!waterLevelInCache
            };
        });
        
        console.log('[Cache Debug] Cache method debug:', cacheMethodDebug);
        
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'cache-debug.png'),
            fullPage: false,
            type: 'png'
        });
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Cache Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Cache Debug] Browser closed.');
    }
}

debugSliderCaching().catch(err => {
    console.error(err);
    process.exit(1);
});
