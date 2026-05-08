class TextureAtlasGenerator {
    constructor(boardSystem) {
        this.boardSystem = boardSystem;
        this.atlasSize = 4096; // 4096x4096 atlas
        this.textureSize = 256; // Each texture is 256x256
        this.gridSize = this.atlasSize / this.textureSize; // 16x16 grid = 256 textures
        this.atlas = null;
    }

    generateAtlas() {
        console.log('[TextureAtlas] Starting atlas generation...');

        // Use default colors if board system not ready
        const defaultLightColor = { r: 0.941, g: 0.851, b: 0.71 }; // 0xf0d9b5
        const defaultDarkColor = { r: 0.714, g: 0.533, b: 0.388 };  // 0xb58863

        const lightColor = this.boardSystem?.lightTileColor || defaultLightColor;
        const darkColor = this.boardSystem?.darkTileColor || defaultDarkColor;

        console.log('[TextureAtlas] Using light color:', lightColor);
        console.log('[TextureAtlas] Using dark color:', darkColor);

        const canvas = document.createElement('canvas');
        canvas.width = this.atlasSize;
        canvas.height = this.atlasSize;
        const ctx = canvas.getContext('2d');

        // Generate all 256 neighbor configurations
        for (let i = 0; i < 256; i++) {
            const x = (i % this.gridSize) * this.textureSize;
            const y = Math.floor(i / this.gridSize) * this.textureSize;
            this.generateTileTexture(ctx, x, y, i);
        }

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        this.atlas = texture;
        console.log('[TextureAtlas] Generated atlas with 256 tile textures');
        return texture;
    }

    generateTileTexture(ctx, offsetX, offsetY, bitmask) {
        const size = this.textureSize;
        const halfSize = size / 2;

        // Get light and dark tile colors (use defaults if board system not ready)
        const defaultLightColor = { r: 0.941, g: 0.851, b: 0.71 };
        const defaultDarkColor = { r: 0.714, g: 0.533, b: 0.388 };
        const lightColor = this.boardSystem?.lightTileColor || defaultLightColor;
        const darkColor = this.boardSystem?.darkTileColor || defaultDarkColor;

        // Fill base checkerboard pattern
        ctx.fillStyle = `rgb(${Math.floor(lightColor.r * 255)}, ${Math.floor(lightColor.g * 255)}, ${Math.floor(lightColor.b * 255)})`;
        ctx.fillRect(offsetX, offsetY, size, size);

        // Parse bitmask to determine neighbors
        // Bit order: N, NE, E, SE, S, SW, W, NW
        const neighbors = {
            N: (bitmask & 0x01) !== 0,
            NE: (bitmask & 0x02) !== 0,
            E: (bitmask & 0x04) !== 0,
            SE: (bitmask & 0x08) !== 0,
            S: (bitmask & 0x10) !== 0,
            SW: (bitmask & 0x20) !== 0,
            W: (bitmask & 0x40) !== 0,
            NW: (bitmask & 0x80) !== 0
        };

        // Create edge smoothing based on neighbors
        // For each edge, if neighbor exists, blend toward that neighbor's color
        const edgeBlendWidth = size * 0.15; // 15% of texture for edge blending

        // North edge
        if (neighbors.N) {
            const gradient = ctx.createLinearGradient(offsetX, offsetY, offsetX, offsetY + edgeBlendWidth);
            gradient.addColorStop(0, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX, offsetY, size, edgeBlendWidth);
        }

        // South edge
        if (neighbors.S) {
            const gradient = ctx.createLinearGradient(offsetX, offsetY + size - edgeBlendWidth, offsetX, offsetY + size);
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX, offsetY + size - edgeBlendWidth, size, edgeBlendWidth);
        }

        // East edge
        if (neighbors.E) {
            const gradient = ctx.createLinearGradient(offsetX + size - edgeBlendWidth, offsetY, offsetX + size, offsetY);
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX + size - edgeBlendWidth, offsetY, edgeBlendWidth, size);
        }

        // West edge
        if (neighbors.W) {
            const gradient = ctx.createLinearGradient(offsetX, offsetY, offsetX + edgeBlendWidth, offsetY);
            gradient.addColorStop(0, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX, offsetY, edgeBlendWidth, size);
        }

        // Corner blending for diagonal neighbors
        const cornerSize = edgeBlendWidth * 0.7;

        // NE corner
        if (neighbors.NE) {
            const gradient = ctx.createRadialGradient(
                offsetX + size - cornerSize, offsetY + cornerSize, 0,
                offsetX + size - cornerSize, offsetY + cornerSize, cornerSize * 1.5
            );
            gradient.addColorStop(0, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX + size - cornerSize * 2, offsetY, cornerSize * 2, cornerSize * 2);
        }

        // SE corner
        if (neighbors.SE) {
            const gradient = ctx.createRadialGradient(
                offsetX + size - cornerSize, offsetY + size - cornerSize, 0,
                offsetX + size - cornerSize, offsetY + size - cornerSize, cornerSize * 1.5
            );
            gradient.addColorStop(0, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX + size - cornerSize * 2, offsetY + size - cornerSize * 2, cornerSize * 2, cornerSize * 2);
        }

        // SW corner
        if (neighbors.SW) {
            const gradient = ctx.createRadialGradient(
                offsetX + cornerSize, offsetY + size - cornerSize, 0,
                offsetX + cornerSize, offsetY + size - cornerSize, cornerSize * 1.5
            );
            gradient.addColorStop(0, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX, offsetY + size - cornerSize * 2, cornerSize * 2, cornerSize * 2);
        }

        // NW corner
        if (neighbors.NW) {
            const gradient = ctx.createRadialGradient(
                offsetX + cornerSize, offsetY + cornerSize, 0,
                offsetX + cornerSize, offsetY + cornerSize, cornerSize * 1.5
            );
            gradient.addColorStop(0, `rgba(${Math.floor(darkColor.r * 255)}, ${Math.floor(darkColor.g * 255)}, ${Math.floor(darkColor.b * 255)}, 0.5)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(offsetX, offsetY, cornerSize * 2, cornerSize * 2);
        }
    }

    getAtlas() {
        if (!this.atlas) {
            this.generateAtlas();
        }
        return this.atlas;
    }
}
