const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
    const p = await b.newPage();
    await p.goto('http://localhost:3000?v=3', { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForFunction(() => {
        const ls = document.getElementById('loadingScreen');
        if (!ls) return true;
        const s = window.getComputedStyle(ls);
        return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0';
    }, { timeout: 60000, polling: 200 });
    await p.waitForTimeout(3000);
    const info = await p.evaluate(() => {
        const g = window.game;
        const tts = g.terrainTreeSystem;
        const canopyPart = tts.parts.find(p => p.isCanopy);
        const mat = canopyPart.mesh.material;
        // Force compile
        mat.needsUpdate = true;
        // Get shader from first program
        const renderer = g.renderer;
        const programs = renderer.properties.get(mat).programs;
        const prog = programs ? programs.values().next().value : null;
        if (!prog) return { error: 'no program', matKeys: Object.keys(mat) };
        const gl = renderer.getContext();
        const vsSrc = gl.getShaderSource(prog.vertexShader);
        const fsSrc = gl.getShaderSource(prog.fragmentShader);
        return {
            hasVEdgeAlphaVS: vsSrc.includes('vEdgeAlpha'),
            hasVEdgeAlphaFS: fsSrc.includes('vEdgeAlpha'),
            hasSmoothstep: vsSrc.includes('smoothstep'),
            hasDiffuseAlphaMul: fsSrc.includes('diffuseColor.a *='),
            fsSnippet: fsSrc.substring(fsSrc.indexOf('vEdgeAlpha') - 50, fsSrc.indexOf('vEdgeAlpha') + 80)
        };
    });
    console.log(JSON.stringify(info, null, 2));
    await b.close();
})();
