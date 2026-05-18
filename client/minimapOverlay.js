class MinimapOverlay {
    constructor({ terrainSystem, cameraController, parent = null, size = 220 } = {}) {
        this.terrainSystem = terrainSystem;
        this.cameraController = cameraController;
        this.parent = parent || document.getElementById('uiOverlay') || document.body;
        this.size = size;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);

        this.baseWorldSpan = 640; // World units displayed at neutral zoom
        this.zoomLevels = [0.45, 0.65, 1, 1.5, 2.25, 3.25, 4.75];
        this.zoomIndex = 2;
        this.minUpdateInterval = 180; // ms
        this.lastRenderTime = 0;
        this._needsRedraw = true;
        this.headingRadians = 0;

        this.orientationOffset = Math.PI; // rotate minimap 180° relative to camera
        this._currentMapAngle = 0;
        this._palette = this._createPalette();
        this._buildDOM();
    }

    _buildDOM() {
        this.container = document.createElement('div');
        this.container.className = 'minimap-overlay';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'minimap-canvas';
        this.canvas.width = this.size * this.dpr;
        this.canvas.height = this.size * this.dpr;
        this.canvas.style.width = `${this.size}px`;
        this.canvas.style.height = `${this.size}px`;
        this.ctx = this.canvas.getContext('2d');
        this.ctx.scale(this.dpr, this.dpr);
        this.ctx.imageSmoothingEnabled = false;
        this.container.appendChild(this.canvas);

        this.scaleLabel = document.createElement('div');
        this.scaleLabel.className = 'minimap-scale-label';
        this.container.appendChild(this.scaleLabel);

        const controls = document.createElement('div');
        controls.className = 'minimap-controls';
        this.zoomInBtn = document.createElement('button');
        this.zoomInBtn.type = 'button';
        this.zoomInBtn.className = 'minimap-btn';
        this.zoomInBtn.textContent = '+';
        this.zoomOutBtn = document.createElement('button');
        this.zoomOutBtn.type = 'button';
        this.zoomOutBtn.className = 'minimap-btn';
        this.zoomOutBtn.textContent = '−';
        controls.appendChild(this.zoomInBtn);
        controls.appendChild(this.zoomOutBtn);
        this.container.appendChild(controls);

        this.zoomInBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this.adjustZoom(1);
        });
        this.zoomOutBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this.adjustZoom(-1);
        });

        this.container.addEventListener('wheel', (event) => {
            if (event.ctrlKey) return; // defer to browser zoom gestures
            event.preventDefault();
            this.adjustZoom(event.deltaY < 0 ? 1 : -1);
        }, { passive: false });

        this.parent.appendChild(this.container);
    }

    setHeadingRadians(angle) {
        if (typeof angle !== 'number' || Number.isNaN(angle)) return;
        // Normalize to -PI .. PI to avoid overflow
        const normalized = ((angle + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (Math.abs(normalized - this.headingRadians) > 0.0001) {
            this.headingRadians = normalized;
            this.requestRender();
        }
    }

    _createPalette() {
        return {
            deep_water: '#082544',
            shallow_water: '#115a8c',
            water: '#1b6fb5',
            sand: '#c8b27c',
            beach: '#dcc38f',
            lowland: '#3c6f3a',
            grassland: '#5b9d4f',
            forest: '#2b4c2c',
            mountain: '#8d8679',
            rock: '#7a6758',
            snow: '#f1f5f6',
            swamp: '#355a3c',
            tundra: '#b7c6a5'
        };
    }

    adjustZoom(direction) {
        const newIndex = Math.min(
            this.zoomLevels.length - 1,
            Math.max(0, this.zoomIndex + direction)
        );
        if (newIndex !== this.zoomIndex) {
            this.zoomIndex = newIndex;
            this.requestRender();
        }
    }

    requestRender() {
        this._needsRedraw = true;
    }

    update(timestamp = performance.now()) {
        if (!this.terrainSystem || !this.cameraController) {
            return;
        }

        this._syncHeading();

        if (!this._needsRedraw && timestamp - this.lastRenderTime < this.minUpdateInterval) {
            return;
        }
        this.lastRenderTime = timestamp;
        this._needsRedraw = false;
        this._draw();
    }

    _syncHeading() {
        const controller = this.cameraController;
        if (!controller) return;

        if (typeof controller.getHeadingRadians === 'function') {
            this.setHeadingRadians(controller.getHeadingRadians());
            return;
        }

        const camera = controller.camera;
        const target = typeof controller.getTarget === 'function' ? controller.getTarget() : null;
        if (!camera || !target) return;
        const dx = target.x - camera.position.x;
        const dz = target.z - camera.position.z;
        if (dx === 0 && dz === 0) return;
        this.setHeadingRadians(Math.atan2(dx, dz));
    }

    _draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.size, this.size);
        ctx.fillStyle = 'rgba(2, 6, 14, 0.88)';
        ctx.fillRect(0, 0, this.size, this.size);

        const focus = this._getFocusPoint();
        const zoomFactor = this.zoomLevels[this.zoomIndex];
        const viewSpan = this.baseWorldSpan / zoomFactor;
        const halfSpan = viewSpan / 2;
        const pxPerUnit = this.size / viewSpan;
        const tileScreenSize = Math.max(pxPerUnit, 0.6);
        const heading = (this.headingRadians || 0) + this.orientationOffset;
        const cosH = Math.cos(heading);
        const sinH = Math.sin(heading);
        const center = this.size / 2;
        this._currentMapAngle = heading;

        this.scaleLabel.textContent = `${Math.round(viewSpan)}u span`;

        const chunks = this.terrainSystem?.chunks;
        if (!chunks || !chunks.size) {
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '12px "Segoe UI", sans-serif';
            ctx.fillText('Awaiting terrain data…', 16, this.size / 2);
            this._drawFocusMarker();
            return;
        }

        const chunkSize = this.terrainSystem.chunkSize || 16;
        for (const [key, chunk] of chunks) {
            if (!chunk?.data) continue;
            const [chunkX, chunkZ] = key.split(',').map(Number);
            const chunkWorldX = chunkX * chunkSize;
            const chunkWorldZ = chunkZ * chunkSize;

            const relMinX = chunkWorldX - focus.x;
            const relMaxX = relMinX + chunkSize;
            const relMinZ = chunkWorldZ - focus.z;
            const relMaxZ = relMinZ + chunkSize;
            if (relMinX > halfSpan || relMaxX < -halfSpan) continue;
            if (relMinZ > halfSpan || relMaxZ < -halfSpan) continue;

            this._drawChunkTiles({
                chunk,
                chunkWorldX,
                chunkWorldZ,
                chunkSize,
                focus,
                halfSpan,
                pxPerUnit,
                tileScreenSize,
                cosH,
                sinH,
                center
            });
        }

        this._drawFocusMarker();
    }

    _drawChunkTiles({ chunk, chunkWorldX, chunkWorldZ, chunkSize, focus, halfSpan, pxPerUnit, tileScreenSize, cosH, sinH, center }) {
        const ctx = this.ctx;
        for (let localZ = 0; localZ < chunkSize; localZ++) {
            const worldZ = chunkWorldZ + localZ;
            const relZ = worldZ - focus.z;
            if (Math.abs(relZ) > halfSpan) continue;
            for (let localX = 0; localX < chunkSize; localX++) {
                const worldX = chunkWorldX + localX;
                const relX = worldX - focus.x;
                if (Math.abs(relX) > halfSpan) continue;
                const tileIndex = localZ * chunkSize + localX;
                const tile = chunk.data[tileIndex];
                if (!tile) continue;
                ctx.fillStyle = this._getTileColor(tile);
                const rotatedX = relX * cosH - relZ * sinH;
                const rotatedZ = relX * sinH + relZ * cosH;
                const px = center + rotatedX * pxPerUnit;
                const py = center + rotatedZ * pxPerUnit;
                ctx.fillRect(px - tileScreenSize * 0.5, py - tileScreenSize * 0.5, tileScreenSize, tileScreenSize);
            }
        }
    }

    _getTileColor(tile) {
        const biome = typeof tile.biome === 'string'
            ? tile.biome.toLowerCase().replace(/\s+/g, '_')
            : null;
        if (biome && this._palette[biome]) {
            return this._palette[biome];
        }

        const h = typeof tile.height === 'number' ? tile.height : 0;
        if (h < -4) return this._palette.deep_water;
        if (h < -1) return this._palette.shallow_water;
        if (h < 0.5) return this._palette.beach;
        if (h < 3) return this._palette.lowland;
        if (h < 6) return this._palette.grassland;
        if (h < 12) return this._palette.forest;
        if (h < 18) return this._palette.mountain;
        return this._palette.snow;
    }

    _drawFocusMarker() {
        const ctx = this.ctx;
        const center = this.size / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center, 0);
        ctx.lineTo(center, this.size);
        ctx.moveTo(0, center);
        ctx.lineTo(this.size, center);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(center, center, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(center, center, this.size * 0.48, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.stroke();

        // Heading chevron rotates with map angle so it always points to camera forward
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(this._currentMapAngle || 0);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.lineTo(-6, -12);
        ctx.lineTo(6, -12);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    _getFocusPoint() {
        if (this.cameraController && typeof this.cameraController.getTarget === 'function') {
            const target = this.cameraController.getTarget();
            if (target) {
                return { x: target.x, z: target.z };
            }
        }
        return { x: 0, z: 0 };
    }
}

window.MinimapOverlay = MinimapOverlay;
