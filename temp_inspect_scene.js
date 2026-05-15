const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
    const p = await b.newPage();
    await p.goto('http://localhost:3000?v=6', { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForFunction(() => {
        const ls = document.getElementById('loadingScreen');
        if (!ls) return true;
        const s = window.getComputedStyle(ls);
        return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0';
    }, { timeout: 60000, polling: 200 });
    await p.waitForTimeout(3000);
    const info = await p.evaluate(() => {
        const g = window.game;
        const lights = g.scene.children.filter(c => c.isLight).map(l => ({
            type: l.type,
            color: l.color ? l.color.getHexString() : null,
            intensity: l.intensity,
            name: l.name
        }));
        const tts = g.terrainTreeSystem;
        const canopyPart = tts.parts.find(p => p.isCanopy);
        const mat = canopyPart.mesh.material;
        return {
            lights,
            matColor: mat.color.getHexString(),
            matRoughness: mat.roughness,
            matMetalness: mat.metalness,
            matTransparent: mat.transparent,
            matAlphaTest: mat.alphaTest,
            matSide: mat.side,
            matDepthWrite: mat.depthWrite,
            mapExists: !!mat.map,
            mapImageSize: mat.map ? (mat.map.image ? `${mat.map.image.width}x${mat.map.image.height}` : 'no image') : 'no map'
        };
    });
    console.log(JSON.stringify(info, null, 2));
    await b.close();
})();
