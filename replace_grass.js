const fs = require('fs');
const path = 'd:\\Chesiopia v2\\client\\board_clean.js';
let content = fs.readFileSync(path, 'utf8');

const oldFunc = `    // Create simple tiled grass texture for future procedural editing
    createGrassTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Base grass color
        ctx.fillStyle = '#3d6b22';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // More visible checkerboard tile pattern
        const tileSize = 16;
        for (let x = 0; x < 8; x++) {
            for (let z = 0; z < 8; z++) {
                const isLight = (x + z) % 2 === 0;
                ctx.fillStyle = isLight ? '#6bb83a' : '#2d5016';
                ctx.globalAlpha = 0.25;
                ctx.fillRect(x * tileSize, z * tileSize, tileSize, tileSize);
            }
        }
        ctx.globalAlpha = 1.0;

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;

        console.log('[Board] Grass texture created (128x128)');
        return texture;
    }`;

const newFunc = `    // Load real grass texture from images folder
    createGrassTexture() {
        const loader = new THREE.TextureLoader();
        const texture = loader.load('Images/grass.jpg');
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.colorSpace = THREE.SRGBColorSpace;

        console.log('[Board] Grass texture loaded (Images/grass.jpg)');
        return texture;
    }`;

if (content.includes(oldFunc)) {
    content = content.replace(oldFunc, newFunc);
    fs.writeFileSync(path, content);
    console.log('SUCCESS: Replaced createGrassTexture() with Image/grass.jpg loader');
} else {
    console.log('ERROR: Could not find old function text to replace');
}
