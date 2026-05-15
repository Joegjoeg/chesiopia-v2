const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--disable-gpu', '--no-sandbox'] 
    });
    const page = await browser.newPage();
    
    const allLogs = [];
    let capturingShaderDump = false;
    let shaderDumpBuffer = [];
    
    page.on('console', msg => {
        const text = msg.text();
        const type = msg.type();
        const entry = { type, text, time: Date.now() };
        allLogs.push(entry);
        
        // Detect start of Three.js shader error dump
        if (text.includes('THREE.WebGLProgram: Shader Error') || 
            text.includes('Program Info Log:') ||
            text.includes('Vertex shader is not compiled') ||
            text.includes('Fragment shader is not compiled')) {
            capturingShaderDump = true;
            shaderDumpBuffer.push(text);
        } else if (capturingShaderDump) {
            // Continue capturing shader dump lines (they come as separate console calls)
            if (text.includes('ERROR:') || 
                text.includes('gl.getShaderInfoLog') ||
                text.includes('uniform') ||
                text.includes('attribute') ||
                text.includes('varying') ||
                text.includes('void main') ||
                text.includes('#include') ||
                text.includes('precision') ||
                text.match(/^\s*\d+\s*:/) || // Line numbers in shader dump
                text.includes(' varying ') ||
                text.includes('    varying ') ||
                text.match(/^\s+[a-zA-Z]/)) { // Indented shader code
                shaderDumpBuffer.push(text);
            } else {
                capturingShaderDump = false;
            }
        }
    });
    
    page.on('pageerror', err => {
        allLogs.push({ type: 'pageerror', text: err.message, time: Date.now() });
    });
    
    page.on('requestfailed', req => {
        allLogs.push({ type: 'network-error', text: `Failed: ${req.url()}`, time: Date.now() });
    });

    console.log('[Diag] Navigating to game...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('[Diag] Page loaded, waiting for shader compilation...');
    await page.waitForTimeout(10000); // Give plenty of time for everything to load and error
    
    // Also try to extract shader info via page evaluation
    const shaderInfo = await page.evaluate(() => {
        // Try to find any WebGL context and get shader info
        const canvases = document.querySelectorAll('canvas');
        const info = { canvases: canvases.length, contexts: [] };
        for (const canvas of canvases) {
            try {
                const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (gl) {
                    info.contexts.push({
                        hasContext: true,
                        renderer: gl.getParameter(gl.RENDERER),
                        vendor: gl.getParameter(gl.VENDOR),
                        version: gl.getParameter(gl.VERSION)
                    });
                }
            } catch (e) {}
        }
        return info;
    });
    
    // Build report
    const report = {
        timestamp: new Date().toISOString(),
        webglInfo: shaderInfo,
        shaderDump: shaderDumpBuffer,
        allErrors: allLogs.filter(l => l.type === 'error' || l.type === 'pageerror'),
        allWarns: allLogs.filter(l => l.type === 'warning'),
        allLogs: allLogs
    };
    
    const outputFile = 'shader_diagnostic.json';
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log(`[Diag] Full report saved to: ${outputFile}`);
    
    // Print shader dump if found
    if (shaderDumpBuffer.length > 0) {
        console.log('\n=== SHADER ERROR DUMP ===');
        shaderDumpBuffer.forEach(line => console.log(line));
        console.log('=== END SHADER DUMP ===\n');
    } else {
        console.log('\n[Diag] No shader dump captured. Here are all error-level logs:');
        report.allErrors.forEach(e => console.log(`[${e.type}] ${e.text}`));
    }
    
    await browser.close();
})();
