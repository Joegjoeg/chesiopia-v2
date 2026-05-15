const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const SCREENSHOT_PATH = path.join(SCREENSHOT_DIR, 'current.png');

async function captureScreenshot() {
    console.log('[Capture] Starting screenshot capture...');
    
    // Ensure screenshot directory exists
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    
    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1
        });
        
        const page = await context.newPage();
        
        console.log('[Capture] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });
        
        console.log('[Capture] Waiting for loading screen to disappear...');
        // Wait for loading screen to be hidden or removed
        await page.waitForFunction(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            if (!loadingScreen) return true;
            const style = window.getComputedStyle(loadingScreen);
            return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        }, { timeout: 60000, polling: 200 });
        
        console.log('[Capture] Loading screen gone, waiting for scene to stabilize...');
        // Extra wait for WebGL scene to render a few frames
        await page.waitForTimeout(3000);
        
        console.log('[Capture] Taking screenshot...');
        await page.screenshot({ 
            path: SCREENSHOT_PATH,
            fullPage: false,
            type: 'png'
        });
        
        console.log(`[Capture] Screenshot saved to: ${SCREENSHOT_PATH}`);
        
    } catch (error) {
        console.error('[Capture] Error capturing screenshot:', error.message);
        throw error;
    } finally {
        await browser.close();
        console.log('[Capture] Browser closed.');
    }
}

// Allow running directly or being required as a module
if (require.main === module) {
    captureScreenshot().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { captureScreenshot, SCREENSHOT_PATH };
