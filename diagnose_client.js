const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const LOG_PATH = path.join(__dirname, 'client_console_dump.json');

async function diagnose() {
    console.log('[Diagnose] Starting client diagnosis...');
    
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    
    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        bypassCSP: true
    });
    
    // Disable caching completely
    await context.setExtraHTTPHeaders({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
    });
    
    const page = await context.newPage();
    
    // Capture ALL console output
    const consoleLogs = [];
    page.on('console', msg => {
        const entry = {
            type: msg.type(),
            text: msg.text(),
            location: msg.location(),
            time: Date.now()
        };
        consoleLogs.push(entry);
        console.log(`[CLIENT ${msg.type().toUpperCase()}] ${msg.text()}`);
    });
    
    // Capture page errors
    page.on('pageerror', err => {
        const entry = { type: 'pageerror', text: err.message, stack: err.stack, time: Date.now() };
        consoleLogs.push(entry);
        console.log(`[CLIENT ERROR] ${err.message}`);
    });
    
    // Capture request failures
    page.on('requestfailed', req => {
        const entry = { type: 'requestfailed', url: req.url(), time: Date.now() };
        consoleLogs.push(entry);
        console.log(`[CLIENT REQUEST FAILED] ${req.url()}`);
    });
    
    try {
        console.log('[Diagnose] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000?_=' + Date.now(), { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        console.log('[Diagnose] DOM loaded. Waiting 5 seconds for scripts to execute...');
        await page.waitForTimeout(5000);
        
        // Try to evaluate what's happening in the page
        const gameState = await page.evaluate(() => {
            return {
                hasGame: typeof window.game !== 'undefined',
                gameInitialized: window.game ? window.game.isInitialized : false,
                hasScene: window.game ? !!window.game.scene : false,
                loadingScreenVisible: !!document.getElementById('loadingScreen'),
                loadingScreenDisplay: document.getElementById('loadingScreen') 
                    ? window.getComputedStyle(document.getElementById('loadingScreen')).display 
                    : 'not found',
                logContent: document.getElementById('loadingLog') 
                    ? document.getElementById('loadingLog').innerText.substring(0, 2000)
                    : 'no log element'
            };
        });
        
        console.log('[Diagnose] Page state:', JSON.stringify(gameState, null, 2));
        
        // Take screenshot regardless of state
        const screenshotPath = path.join(SCREENSHOT_DIR, 'diagnose.png');
        await page.screenshot({ 
            path: screenshotPath,
            fullPage: false,
            type: 'png'
        });
        console.log(`[Diagnose] Screenshot saved to: ${screenshotPath}`);
        
        // Save console logs
        fs.writeFileSync(LOG_PATH, JSON.stringify(consoleLogs, null, 2));
        console.log(`[Diagnose] Console logs saved to: ${LOG_PATH}`);
        console.log(`[Diagnose] Total console entries: ${consoleLogs.length}`);
        
        // Print summary of errors
        const errors = consoleLogs.filter(l => l.type === 'error' || l.type === 'pageerror');
        if (errors.length > 0) {
            console.log('\n=== CLIENT ERRORS ===');
            errors.forEach((e, i) => {
                console.log(`${i + 1}. [${e.type}] ${e.text}`);
            });
        } else {
            console.log('\nNo client errors captured.');
        }
        
    } catch (error) {
        console.error('[Diagnose] Error during diagnosis:', error.message);
        // Try screenshot anyway
        try {
            const screenshotPath = path.join(SCREENSHOT_DIR, 'diagnose_error.png');
            await page.screenshot({ path: screenshotPath, fullPage: false, type: 'png' });
            console.log(`[Diagnose] Error screenshot saved to: ${screenshotPath}`);
        } catch (ssErr) {
            console.error('[Diagnose] Could not take screenshot:', ssErr.message);
        }
    } finally {
        await browser.close();
        console.log('[Diagnose] Browser closed.');
    }
}

diagnose().catch(err => {
    console.error(err);
    process.exit(1);
});
