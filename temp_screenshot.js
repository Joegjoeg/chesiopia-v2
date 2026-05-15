const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
    const p = await b.newPage();
    await p.goto('http://localhost:3000?v=13', { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForFunction(() => {
        const ls = document.getElementById('loadingScreen');
        if (!ls) return true;
        const s = window.getComputedStyle(ls);
        return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0';
    }, { timeout: 60000, polling: 200 });
    await p.waitForTimeout(5000);
    await p.screenshot({ path: 'screenshots/foliage_fix_v3.png' });
    await b.close();
})();
