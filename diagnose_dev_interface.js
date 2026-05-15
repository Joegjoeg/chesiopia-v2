const { chromium } = require('playwright');
const path = require('path');

async function diagnoseDevInterface() {
    console.log('[Diagnosis] Checking dev interface functionality...');
    
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
        
        console.log('[Diagnosis] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('[Diagnosis] Waiting for loading screen to disappear...');
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
        
        // Check 1: Verify dev interface exists and is initially hidden
        const initialState = await page.evaluate(() => {
            const devInterface = document.getElementById('enhancedDevInterface');
            return {
                devInterfaceExists: !!devInterface,
                devInterfaceVisible: devInterface ? devInterface.style.display !== 'none' : false,
                parameterSystemExists: !!window.parameterSystem,
                devInterfaceObject: !!window.devInterface,
                devInterfaceMethods: window.devInterface ? Object.getOwnPropertyNames(window.devInterface) : []
            };
        });
        
        console.log('[Diagnosis] Initial state:', initialState);
        
        // Check 2: Try to show dev interface programmatically
        console.log('[Diagnosis] Attempting to show dev interface programmatically...');
        await page.evaluate(() => {
            if (window.devInterface) {
                window.devInterface.show();
                console.log('DevInterface.show() called');
            }
        });
        
        await page.waitForTimeout(1000);
        
        const afterShow = await page.evaluate(() => {
            const devInterface = document.getElementById('enhancedDevInterface');
            return {
                devInterfaceVisible: devInterface ? devInterface.style.display !== 'none' : false,
                currentCategory: window.devInterface ? window.devInterface.currentCategory : null,
                contentAreaExists: !!document.getElementById('devContentArea')
            };
        });
        
        console.log('[Diagnosis] After show():', afterShow);
        
        // Check 3: Try Space key press
        console.log('[Diagnosis] Testing Space key press...');
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);
        
        const afterSpace = await page.evaluate(() => {
            const devInterface = document.getElementById('enhancedDevInterface');
            return {
                devInterfaceVisible: devInterface ? devInterface.style.display !== 'none' : false
            };
        });
        
        console.log('[Diagnosis] After Space key:', afterSpace);
        
        // Check 4: Try to interact with sliders if visible
        if (afterShow.devInterfaceVisible || afterSpace.devInterfaceVisible) {
            console.log('[Diagnosis] Testing slider interaction...');
            
            const sliderTest = await page.evaluate(() => {
                // Show terrain category
                if (window.devInterface) {
                    window.devInterface.showCategory('terrain');
                }
                
                // Try to find and interact with waterLevel slider
                const slider = document.querySelector('[data-parameter="waterLevel"] input[type="range"]');
                if (slider) {
                    const oldValue = slider.value;
                    slider.value = -3.0;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    return {
                        sliderFound: true,
                        oldValue,
                        newValue: slider.value,
                        paramValue: window.parameterSystem.getParameter('waterLevel'),
                        boardValue: window.boardSystem.waterLevel
                    };
                } else {
                    return {
                        sliderFound: false,
                        error: 'Slider not found',
                        allSliders: document.querySelectorAll('input[type="range"]').length,
                        waterLevelContainer: !!document.querySelector('[data-parameter="waterLevel"]')
                    };
                }
            });
            
            console.log('[Diagnosis] Slider test result:', sliderTest);
        }
        
        // Check 5: Event listener diagnostics
        const eventCheck = await page.evaluate(() => {
            const devInterface = window.devInterface;
            if (!devInterface) return { error: 'DevInterface object not found' };
            
            // Check if keyboard shortcuts are set up
            const hasKeyboardShortcuts = !!devInterface.setupKeyboardShortcuts;
            const isVisible = devInterface.isVisible;
            
            // Check event listeners on document
            const documentListeners = (function() {
                const listeners = [];
                const events = ['keydown', 'keypress', 'keyup'];
                events.forEach(eventType => {
                    if (document.onkeydown && eventType === 'keydown') {
                        listeners.push(`document.on${eventType}: ${document.onkeydown.toString().substring(0, 100)}...`);
                    }
                });
                return listeners;
            })();
            
            return {
                hasKeyboardShortcuts,
                isVisible,
                documentListeners,
                methods: Object.getOwnPropertyNames(devInterface).filter(name => typeof devInterface[name] === 'function')
            };
        });
        
        console.log('[Diagnosis] Event listener check:', eventCheck);
        
        // Take screenshot for visual verification
        await page.screenshot({ 
            path: path.join(__dirname, 'screenshots', 'diagnosis.png'),
            fullPage: false,
            type: 'png'
        });
        
        console.log('[Diagnosis] Screenshot saved for visual verification');
        
        await page.waitForTimeout(3000);
        
    } catch (error) {
        console.error('[Diagnosis] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Diagnosis] Browser closed.');
    }
}

diagnoseDevInterface().catch(err => {
    console.error(err);
    process.exit(1);
});
