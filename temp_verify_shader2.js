const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
    const p = await b.newPage();
    await p.goto('http://localhost:3000?v=4', { waitUntil: 'networkidle', timeout: 60000 });
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
        mat.needsUpdate = true;
        const renderer = g.renderer;
        const programs = renderer.properties.get(mat).programs;
        const prog = programs ? programs.values().next().value : null;
        if (!prog) return { error: 'no program' };
        const gl = renderer.getContext();
        const fsSrc = gl.getShaderSource(prog.fragmentShader);
        const alphaIdx = fsSrc.indexOf('diffuseColor.a *= vEdgeAlpha');
        const fragColorIdx = fsSrc.indexOf('gl_FragColor');
        return {
            alphaIdx,
            fragColorIdx,
            alphaToFragDist: fragColorIdx - alphaIdx,
            snippetBeforeAlpha: fsSrc.substring(Math.max(0, alphaIdx - 200), alphaIdx),
            snippetAfterAlpha: fsSrc.substring(alphaIdx, alphaIdx + 300),
            snippetFirstFragColor: fsSrc.substring(fragColorIdx - 100, fragColorIdx + 100)
        };
    });
    console.log(JSON.stringify(info, null, 2));
    await b.close();
})();
