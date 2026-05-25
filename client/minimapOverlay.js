class MinimapOverlay {
    constructor({ terrainSystem, cameraController, settlementSystem = null, parent = null, size = 220 } = {}) {
        this.terrainSystem = terrainSystem;
        this.cameraController = cameraController;
        this.settlementSystem = settlementSystem;
        this.parent = parent || document.getElementById('uiOverlay') || document.body;
        this.size = size;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);

        this.baseWorldSpan = 640; // World units displayed at neutral zoom
        this.zoomLevels = [0.45, 0.65, 1, 1.5, 2.25, 3.25, 4.75];
        this.zoomIndex = 2;
        this.lastRenderTime = 0;
        this._needsRedraw = true;
        this.headingRadians = 0;
        this._chunkImages = new Map();
        this._settlementColors = new Map();

        this.orientationOffset = 0;
        this._palette = this._createPalette();

        // Weather overlay state
        this.weatherLayers = { pressure: false, moisture: false, temperature: false, fronts: false, isobars: false };
        this._envAgents = [];
        this._agentCache = new Map(); // key -> cached nearest-opposite info
        this._frontChainCache = new Map(); // key -> { chain, lowX, lowZ, highX, highZ }

        // Local wind field sampled from pressure gradient around camera
        this.localWind = { x: 0, z: 0, speed: 0, angle: 0 };
        this._lastWindUpdate = 0;
        this._windUpdateInterval = 2000; // ms

        this._buildDOM();

        // Redraw when minimap parameters change
        const ps = window.parameterSystem;
        if (ps && typeof ps.onParameterChange === 'function') {
            this._paramUnsub = ps.onParameterChange((name) => {
                if (name.startsWith('minimap') || name.startsWith('weather')) this.requestRender();
            });
        }
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

        // Time-of-day controls (sun / moon) positioned over the canvas
        const timeControls = document.createElement('div');
        timeControls.className = 'minimap-time-controls';

        this.sunBtn = document.createElement('button');
        this.sunBtn.type = 'button';
        this.sunBtn.className = 'minimap-time-btn';
        this.sunBtn.title = 'Advance 3 hours';
        this.sunBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';

        this.moonBtn = document.createElement('button');
        this.moonBtn.type = 'button';
        this.moonBtn.className = 'minimap-time-btn';
        this.moonBtn.title = 'Rewind 3 hours';
        this.moonBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

        timeControls.appendChild(this.sunBtn);
        timeControls.appendChild(this.moonBtn);
        this.container.appendChild(timeControls);

        this.sunBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this._adjustTimeOfDay(3);
        });
        this.moonBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this._adjustTimeOfDay(-3);
        });

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

        // Weather layer toggles
        const weatherTypes = [
            { key: 'pressure', label: 'P', title: 'Pressure' },
            { key: 'moisture', label: 'M', title: 'Moisture' },
            { key: 'temperature', label: 'T', title: 'Temperature' },
            { key: 'fronts', label: 'F', title: 'Front Systems' },
            { key: 'isobars', label: 'I', title: 'Isobars' }
        ];
        this.weatherChecks = {};
        for (const wt of weatherTypes) {
            const label = document.createElement('label');
            label.className = 'minimap-weather-check';
            label.title = wt.title;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            const span = document.createElement('span');
            span.textContent = wt.label;
            label.appendChild(cb);
            label.appendChild(span);
            controls.appendChild(label);
            this.weatherChecks[wt.key] = cb;
            cb.addEventListener('change', () => {
                this.weatherLayers[wt.key] = cb.checked;
                this.requestRender();
            });
        }

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

    _adjustTimeOfDay(deltaHours) {
        const ps = window.parameterSystem;
        if (!ps) return;
        const current = ps.getParameter('dayTime') ?? 12;
        let next = current + deltaHours;
        // Wrap within 0-24
        while (next >= 24) next -= 24;
        while (next < 0) next += 24;
        ps.setParameter('dayTime', next, 'user');
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

    setEnvAgents(agents) {
        this._envAgents = Array.isArray(agents) ? agents : (agents?.agents || []);
        this._agentCache.clear();
        this._frontChainCache.clear();
        // console.log('[Minimap] Received agents:', this._envAgents.length);
        this.requestRender();
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

        const ps = window.parameterSystem;
        const interval = ps ? (ps.getParameter('minimapUpdateInterval') ?? 180) : 180;
        if (!this._needsRedraw && timestamp - this.lastRenderTime < interval) {
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
        const heading = this.headingRadians || 0;
        const cosH = Math.cos(heading);
        const sinH = Math.sin(heading);
        const center = this.size / 2;

        this.scaleLabel.textContent = `${Math.round(viewSpan)}u span`;

        if (!this._chunkImages.size) {
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '12px "Segoe UI", sans-serif';
            ctx.fillText('Awaiting terrain data…', 16, this.size / 2);
            this._drawFocusMarker();
            return;
        }

        const chunkSize = this.terrainSystem.chunkSize || 16;
        const chunks = this.terrainSystem?.chunks;
        const liveKeys = new Set(this._chunkImages.keys());

        // Sync any newly-loaded chunks that haven't been cached yet
        if (chunks) {
            for (const [key, chunk] of chunks) {
                if (!chunk?.data) continue;
                if (!this._chunkImages.has(key)) {
                    const canvas = this._generateChunkImage(chunk, chunkSize);
                    this._chunkImages.set(key, canvas);
                }
            }
        }

        // Compute bounding box of explored area for ring-based fade
        let minCX = Infinity, maxCX = -Infinity, minCZ = Infinity, maxCZ = -Infinity;
        for (const key of this._chunkImages.keys()) {
            const [cx, cz] = key.split(',').map(Number);
            minCX = Math.min(minCX, cx);
            maxCX = Math.max(maxCX, cx);
            minCZ = Math.min(minCZ, cz);
            maxCZ = Math.max(maxCZ, cz);
        }

        for (const [key, chunkImg] of this._chunkImages) {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            const chunkWorldX = chunkX * chunkSize;
            const chunkWorldZ = chunkZ * chunkSize;

            const relCX = chunkWorldX + chunkSize / 2 - focus.x;
            const relCZ = chunkWorldZ + chunkSize / 2 - focus.z;
            const rotatedCX = relCX * cosH - relCZ * sinH;
            const rotatedCZ = relCX * sinH + relCZ * cosH;
            const pcx = center + rotatedCX * pxPerUnit;
            const pcz = center + rotatedCZ * pxPerUnit;
            const screenSize = chunkSize * pxPerUnit;

            // Alpha: combine concentric ring fade and contour fade
            const ps = window.parameterSystem;
            let alpha = 1.0;

            // Contour fade: interior chunks stay opaque, only actual boundary softens
            const contourFade = ps ? ps.getParameter('minimapContourFade') : false;
            if (contourFade) {
                const edgeOpacity = ps ? ps.getParameter('minimapContourOpacity') : 0.35;
                const hasAllNeighbors =
                    this._chunkImages.has(`${chunkX + 1},${chunkZ}`) &&
                    this._chunkImages.has(`${chunkX - 1},${chunkZ}`) &&
                    this._chunkImages.has(`${chunkX},${chunkZ + 1}`) &&
                    this._chunkImages.has(`${chunkX},${chunkZ - 1}`);
                alpha = hasAllNeighbors ? 1.0 : edgeOpacity;
            } else {
                // Concentric ring fade: distance from explored-area bounding edge
                const edgeFadeEnabled = ps ? ps.getParameter('minimapEdgeFade') : true;
                const fadeDepth = ps ? ps.getParameter('minimapFadeDepth') : 3;
                if (edgeFadeEnabled && fadeDepth > 0) {
                    const edgeDist = Math.min(
                        chunkX - minCX,
                        maxCX - chunkX,
                        chunkZ - minCZ,
                        maxCZ - chunkZ
                    );
                    if (edgeDist < fadeDepth) {
                        alpha = (edgeDist + 1) / (fadeDepth + 1);
                    }
                }
            }

            const img = chunkImg.canvas || chunkImg; // handle old {canvas} objects
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(pcx, pcz);
            ctx.rotate(heading);
            ctx.drawImage(img, -screenSize * 0.5, -screenSize * 0.5, screenSize, screenSize);
            ctx.restore();
        }

        this._drawSettlements(focus, pxPerUnit, cosH, sinH, center, halfSpan);

        // Weather overlays
        if (this.weatherLayers.pressure || this.weatherLayers.moisture || this.weatherLayers.temperature) {
            this._drawWeatherTiles(focus, pxPerUnit, cosH, sinH, center, halfSpan);
        }
        if ((this.weatherLayers.isobars || this.weatherLayers.fronts) && this._envAgents.length > 0) {
            this._drawWeatherFronts(focus, pxPerUnit, cosH, sinH, center, halfSpan, zoomFactor);
        }

        // Update local wind field around camera (throttled)
        this._updateLocalWind(focus);

        // Draw minimap wind arrow (bonus)
        this._drawWindArrows(ctx, focus, pxPerUnit, cosH, sinH, center);

        // Soft circular mask — fades loaded terrain smoothly at the minimap edge
        const ps = window.parameterSystem;
        const circularMask = ps ? ps.getParameter('minimapCircularMask') : true;
        if (circularMask) {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            const maskStart = ps ? ps.getParameter('minimapMaskStart') : 0.38;
            const fadeStart = this.size * maskStart;
            const fadeEnd = this.size * 0.5;
            const maskGrad = ctx.createRadialGradient(center, center, fadeStart, center, center, fadeEnd);
            maskGrad.addColorStop(0, 'rgba(0,0,0,1)');
            maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = maskGrad;
            ctx.fillRect(0, 0, this.size, this.size);
            ctx.restore();
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

    _generateChunkImage(chunk, chunkSize) {
        const canvas = document.createElement('canvas');
        canvas.width = chunkSize;
        canvas.height = chunkSize;
        const ctx = canvas.getContext('2d');
        for (let localZ = 0; localZ < chunkSize; localZ++) {
            for (let localX = 0; localX < chunkSize; localX++) {
                const tileIndex = localZ * chunkSize + localX;
                const tile = chunk.data[tileIndex];
                if (!tile) continue;
                ctx.fillStyle = this._getTileColor(tile);
                ctx.fillRect(localX, localZ, 1, 1);
            }
        }
        return canvas;
    }

    onChunkLoaded(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        if (this._chunkImages.has(chunkKey)) return;
        const chunk = this.terrainSystem?.chunks?.get(chunkKey);
        if (!chunk?.data) return;
        const chunkSize = this.terrainSystem.chunkSize || 16;
        const canvas = this._generateChunkImage(chunk, chunkSize);
        this._chunkImages.set(chunkKey, canvas);
        this._needsRedraw = true;
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

    _getSettlementColor(settlement) {
        if (this._settlementColors.has(settlement.id)) {
            return this._settlementColors.get(settlement.id);
        }
        // Deterministic hue from settlement name hash
        let hash = 0;
        const str = settlement.name || String(settlement.id);
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        const hue = Math.abs(hash) % 360;
        const color = { h: hue, s: 65, l: 45 };
        this._settlementColors.set(settlement.id, color);
        return color;
    }

    _worldToMinimap(x, z, focus, pxPerUnit, cosH, sinH, center) {
        const relX = x - focus.x;
        const relZ = z - focus.z;
        const rotatedX = relX * cosH - relZ * sinH;
        const rotatedZ = relX * sinH + relZ * cosH;
        return {
            px: center + rotatedX * pxPerUnit,
            py: center + rotatedZ * pxPerUnit
        };
    }

    _drawSettlements(focus, pxPerUnit, cosH, sinH, center, halfSpan) {
        if (!this.settlementSystem) return;
        const ctx = this.ctx;

        for (const settlement of this.settlementSystem.settlements) {
            if (!settlement._active) continue;

            // Skip if settlement center is well outside view
            const relCenterX = settlement.x - focus.x;
            const relCenterZ = settlement.z - focus.z;
            if (Math.abs(relCenterX) > halfSpan + 40 || Math.abs(relCenterZ) > halfSpan + 40) continue;

            const baseColor = this._getSettlementColor(settlement);
            const darkColor = `hsl(${baseColor.h}, ${baseColor.s}%, ${Math.max(15, baseColor.l - 18)}%)`;
            const lightColor = `hsl(${baseColor.h}, ${baseColor.s}%, ${Math.min(85, baseColor.l + 22)}%)`;

            // Draw buildings (darker dots)
            if (settlement.buildings && settlement.buildings.length > 0) {
                ctx.fillStyle = darkColor;
                for (const b of settlement.buildings) {
                    if (typeof b.x !== 'number' || typeof b.z !== 'number') continue;
                    const p = this._worldToMinimap(b.x, b.z, focus, pxPerUnit, cosH, sinH, center);
                    const size = Math.max(2, pxPerUnit * 0.6);
                    ctx.fillRect(p.px - size * 0.5, p.py - size * 0.5, size, size);
                }
            }

            // Draw villagers (lighter dots)
            if (settlement.villagers && settlement.villagers.length > 0) {
                ctx.fillStyle = lightColor;
                for (const v of settlement.villagers) {
                    let vx, vz;
                    if (v._mesh && v._mesh.position) {
                        vx = v._mesh.position.x;
                        vz = v._mesh.position.z;
                    } else if (v.currentNode && typeof v.currentNode.x === 'number') {
                        vx = v.currentNode.x;
                        vz = v.currentNode.z;
                    } else {
                        continue;
                    }
                    const p = this._worldToMinimap(vx, vz, focus, pxPerUnit, cosH, sinH, center);
                    const size = Math.max(1.5, pxPerUnit * 0.35);
                    ctx.beginPath();
                    ctx.arc(p.px, p.py, size * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }

    _drawWeatherTiles(focus, pxPerUnit, cosH, sinH, center, halfSpan) {
        const ctx = this.ctx;
        const chunkSize = this.terrainSystem.chunkSize || 16;
        const tileScreenSize = Math.max(pxPerUnit, 0.6);

        ctx.save();
        for (const [key] of this._chunkImages) {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            const chunk = this.terrainSystem?.chunks?.get(key);
            if (!chunk?.data) continue;
            const chunkWorldX = chunkX * chunkSize;
            const chunkWorldZ = chunkZ * chunkSize;

            for (let lz = 0; lz < chunkSize; lz++) {
                const worldZ = chunkWorldZ + lz;
                const relZ = worldZ - focus.z;
                if (Math.abs(relZ) > halfSpan) continue;
                for (let lx = 0; lx < chunkSize; lx++) {
                    const worldX = chunkWorldX + lx;
                    const relX = worldX - focus.x;
                    if (Math.abs(relX) > halfSpan) continue;

                    const tile = chunk.data[lz * chunkSize + lx];
                    if (!tile) continue;

                    const rx = relX * cosH - relZ * sinH;
                    const rz = relX * sinH + relZ * cosH;
                    const px = center + rx * pxPerUnit;
                    const py = center + rz * pxPerUnit;

                    if (this.weatherLayers.pressure && typeof tile.pressure === 'number') {
                        const v = tile.pressure;
                        const hue = v * 120;
                        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.35)`;
                        ctx.fillRect(px - tileScreenSize * 0.5, py - tileScreenSize * 0.5, tileScreenSize, tileScreenSize);
                    }
                    if (this.weatherLayers.moisture && typeof tile.moisture === 'number') {
                        const v = tile.moisture;
                        const r = Math.round(210 + (60 - 210) * v);
                        const g = Math.round(180 + (120 - 180) * v);
                        const b = Math.round(120 + (220 - 120) * v);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
                        ctx.fillRect(px - tileScreenSize * 0.5, py - tileScreenSize * 0.5, tileScreenSize, tileScreenSize);
                    }
                    if (this.weatherLayers.temperature && typeof tile.temperature === 'number') {
                        let v = tile.temperature;
                        if (v > 1 || v < 0) { v = (v + 10) / 40; v = Math.max(0, Math.min(1, v)); }
                        const hue = 240 - v * 240;
                        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.35)`;
                        ctx.fillRect(px - tileScreenSize * 0.5, py - tileScreenSize * 0.5, tileScreenSize, tileScreenSize);
                    }
                }
            }
        }
        ctx.restore();
    }

    _drawWeatherFronts(focus, pxPerUnit, cosH, sinH, center, halfSpan, zoomFactor = 1) {
        const ctx = this.ctx;
        const agents = this._envAgents;
        if (!agents.length) return;

        const ps = window.parameterSystem;
        const frontThreshold = ps ? (ps.getParameter('weatherFrontThreshold') ?? 55) : 55;
        const symbolCutoffMult = ps ? (ps.getParameter('symbolCutoffMult') ?? 0.8) : 0.8;
        const minimapRingScale = ps ? (ps.getParameter('weatherRingScale') ?? 3.5) : 3.5;

        let ringCount = 5;
        if (zoomFactor < 0.8) {
            ringCount = 2;
        } else if (zoomFactor < 1.5) {
            ringCount = 3;
        } else if (zoomFactor < 2.5) {
            ringCount = 4;
        }

        const basePhysicsRadii = [8, 16, 24, 34, 46];
        const physicsRadii = basePhysicsRadii.slice(0, ringCount);
        const baseRadii = physicsRadii.map(r => r * minimapRingScale);
        const maxRingWorld = baseRadii[baseRadii.length - 1] || 0;
        const cullRadius = halfSpan + maxRingWorld;

        const drawIsobars = !!this.weatherLayers.isobars;
        const drawFronts = !!this.weatherLayers.fronts;
        const showCenters = drawIsobars && !drawFronts;

        const agentScreen = [];
        for (let i = 0; i < agents.length; i++) {
            const a = agents[i];
            if (a.dying || a.life <= 0) continue;
            const relX = a.x - focus.x;
            const relZ = a.z - focus.z;
            if (Math.abs(relX) > cullRadius || Math.abs(relZ) > cullRadius) continue;
            const p = this._worldToMinimap(a.x, a.z, focus, pxPerUnit, cosH, sinH, center);
            agentScreen.push({ ...a, sx: p.px, sy: p.py, idx: i, isHigh: a.pressure > 0.5 });
        }

        if (!agentScreen.length || (!drawIsobars && !drawFronts)) return;

        for (let i = 0; i < agentScreen.length; i++) {
            const a = agentScreen[i];
            let nearest = null;
            let nearestDist = Infinity;
            for (let j = 0; j < agentScreen.length; j++) {
                if (i === j) continue;
                const b = agentScreen[j];
                if (a.isHigh === b.isHigh) continue;
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearest = b;
                }
            }
            this._agentCache.set(i, { nearest, nearestDist });
        }

        ctx.save();
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';

        if (showCenters) {
            for (const a of agentScreen) {
                const dotSize = a.isHigh ? 4 : 3.5;
                ctx.beginPath();
                ctx.arc(a.sx, a.sy, dotSize, 0, Math.PI * 2);
                ctx.fillStyle = a.isHigh ? 'rgba(255, 90, 90, 0.65)' : 'rgba(80, 140, 255, 0.65)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        } else if (!drawFronts) {
            for (const a of agentScreen) {
                const markerStrength = Math.min(1, Math.max(0.2, a.strength / 2));
                this._drawPressureMarker(ctx, a.sx, a.sy, a.isHigh, markerStrength);
            }
        }

        if (drawIsobars) {
            for (let i = 0; i < agentScreen.length; i++) {
                const a = agentScreen[i];
                const cached = this._agentCache.get(i);
                const nearest = cached?.nearest;
                const nearestDist = cached?.nearestDist ?? Infinity;
                const isClose = nearestDist < frontThreshold;

                let deformDx = 0, deformDz = 0, deformStrength = 0;
                if (isClose && nearest) {
                    const t = (frontThreshold - nearestDist) / frontThreshold;
                    deformStrength = t * 0.35;
                    const dx = nearest.x - a.x;
                    const dz = nearest.z - a.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1;
                    deformDx = (dx / len) * deformStrength;
                    deformDz = (dz / len) * deformStrength;
                }

                const rCol = a.isHigh ? 220 : 60;
                const gCol = a.isHigh ? 70 : 120;
                const bCol = a.isHigh ? 80 : 220;
                const segments = zoomFactor >= 1.5 ? 60 : 36;

                for (let ri = 0; ri < ringCount; ri++) {
                    const pts = [];
                    for (let s = 0; s <= segments; s++) {
                        const theta = (s / segments) * Math.PI * 2;
                        let wx = a.x + Math.cos(theta) * baseRadii[ri];
                        let wz = a.z + Math.sin(theta) * baseRadii[ri];
                        if (isClose && nearest) {
                            const toNearest = Math.atan2(nearest.z - a.z, nearest.x - a.x);
                            const angleDiff = Math.abs(((theta - toNearest + Math.PI) % (Math.PI * 2)) - Math.PI);
                            const pullFactor = Math.max(0, Math.cos(angleDiff));
                            const pull = deformStrength * pullFactor * baseRadii[ri];
                            wx += deformDx * pull;
                            wz += deformDz * pull;
                        }
                        const p = this._worldToMinimap(wx, wz, focus, pxPerUnit, cosH, sinH, center);
                        pts.push({ x: p.px, y: p.py });
                    }

                    const alpha = 0.2 + (1 - ri / ringCount) * 0.25;
                    ctx.strokeStyle = `rgba(${rCol}, ${gCol}, ${bCol}, ${alpha})`;
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let s = 1; s < pts.length; s++) {
                        const prev = pts[s - 1];
                        const curr = pts[s];
                        const mx = (prev.x + curr.x) / 2;
                        const my = (prev.y + curr.y) / 2;
                        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
            }
        }

        if (drawFronts) {
            for (let i = 0; i < agentScreen.length; i++) {
                const a = agentScreen[i];
                const cached = this._agentCache.get(i);
                const nearest = cached?.nearest;
                const nearestDist = cached?.nearestDist ?? Infinity;
                if (!nearest || nearestDist > frontThreshold * symbolCutoffMult) continue;
                if (a.isHigh) continue;

                const gradient = Math.max(0, 1 - nearestDist / frontThreshold);
                const ds = (frontThreshold - nearestDist) / frontThreshold * 0.35;
                const outerR = baseRadii[ringCount - 1] * (1 + ds * 0.5);

                // Build elastic front chain between this low and nearest high
                const chain = this._buildFrontChain(a, nearest, 14, 5);
                const screenPts = chain.map(v => this._worldToMinimap(v.x, v.z, focus, pxPerUnit, cosH, sinH, center));

                // Shadow
                ctx.beginPath();
                ctx.moveTo(screenPts[0].px, screenPts[0].py);
                for (let ci = 1; ci < screenPts.length; ci++) {
                    ctx.lineTo(screenPts[ci].px, screenPts[ci].py);
                }
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.lineWidth = 5;
                ctx.stroke();

                // White front line
                ctx.beginPath();
                ctx.moveTo(screenPts[0].px, screenPts[0].py);
                for (let ci = 1; ci < screenPts.length; ci++) {
                    ctx.lineTo(screenPts[ci].px, screenPts[ci].py);
                }
                ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + gradient * 0.4})`;
                ctx.lineWidth = 2.2;
                ctx.stroke();

                // Chain tangent helper
                const chainTangent = (idx) => {
                    const prev = chain[Math.max(0, idx - 1)];
                    const next = chain[Math.min(chain.length - 1, idx + 1)];
                    const tx = next.x - prev.x;
                    const tz = next.z - prev.z;
                    const len = Math.hypot(tx, tz) || 1;
                    return { x: tx / len, z: tz / len };
                };

                // Fixed 3 symbols per side at chain indices [3, 7, 10]
                const symbolIndices = [3, 7, 10];
                for (const idx of symbolIndices) {
                    const pt = chain[idx];
                    const tan = chainTangent(idx);
                    const sx = pt.x - tan.z * outerR * 0.6;
                    const sz = pt.z + tan.x * outerR * 0.6;
                    const sp = this._worldToMinimap(sx, sz, focus, pxPerUnit, cosH, sinH, center);
                    const angle = Math.atan2(tan.z, tan.x) + Math.PI / 2;
                    this._drawColdFrontSymbol(ctx, sp.px, sp.py, angle, gradient);
                }

                for (const idx of symbolIndices) {
                    const pt = chain[idx];
                    const tan = chainTangent(idx);
                    const sx = pt.x + tan.z * outerR * 0.6;
                    const sz = pt.z - tan.x * outerR * 0.6;
                    const sp = this._worldToMinimap(sx, sz, focus, pxPerUnit, cosH, sinH, center);
                    const angle = Math.atan2(tan.z, tan.x) - Math.PI / 2;
                    this._drawWarmFrontSymbol(ctx, sp.px, sp.py, angle + Math.PI, gradient);
                }
            }
        }

        ctx.restore();
    }

    _drawColdFrontSymbol(ctx, x, y, angle, intensity) {
        const size = 5 + intensity * 6;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = `rgba(60, 120, 220, ${0.6 + intensity * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.5, -size * 0.6);
        ctx.lineTo(-size * 0.5, size * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    _drawWarmFrontSymbol(ctx, x, y, angle, intensity) {
        const size = 5 + intensity * 6;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = `rgba(220, 80, 80, ${0.6 + intensity * 0.4})`;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.5, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    _drawPressureMarker(ctx, x, y, isHigh, intensity) {
        ctx.save();
        ctx.translate(x, y);
        const radius = 6 + intensity * 6;
        ctx.fillStyle = isHigh ? `rgba(255, 150, 150, ${0.6 + intensity * 0.2})` : `rgba(120, 170, 255, ${0.6 + intensity * 0.2})`;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = `${Math.round(radius * 1.4)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(isHigh ? 'H' : 'L', 0, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 1;
        ctx.strokeText(isHigh ? 'H' : 'L', 0, 0);
        ctx.restore();
    }

    _samplePressure(wx, wz) {
        let p = 0.5;
        const agents = this._envAgents;
        if (!agents || !agents.length) return p;
        const maxDist = 300; // global cutoff — ignore agents very far away
        for (const a of agents) {
            if (a.dying || a.life <= 0) continue;
            const dx = wx - a.x;
            const dz = wz - a.z;
            const distSq = dx * dx + dz * dz;
            if (distSq > maxDist * maxDist) continue;
            const r = (a.radius || 40);
            if (distSq >= r * r) continue;
            const dist = Math.sqrt(distSq);
            const falloff = (1 - dist / r) ** 2 * (a.strength || 1);
            p += a.pressure > 0.5 ? falloff * 0.5 : -falloff * 0.5;
        }
        return Math.max(0, Math.min(1, p));
    }

    _sampleWindAt(wx, wz, delta = 4) {
        // Compute pressure gradient by sampling cardinal points
        const pLeft  = this._samplePressure(wx - delta, wz);
        const pRight = this._samplePressure(wx + delta, wz);
        const pUp    = this._samplePressure(wx, wz - delta);
        const pDown  = this._samplePressure(wx, wz + delta);

        const dPdx = (pRight - pLeft) / (2 * delta);
        const dPdz = (pDown - pUp) / (2 * delta);

        // Wind flows from high to low pressure (negative gradient)
        // Scale so a typical gradient of 0.1 over 8 units gives moderate wind
        const scale = 60;
        let windX = -dPdx * scale;
        let windZ = -dPdz * scale;

        // Add subtle Coriolis-like deflection: wind crosses isobars at ~15°
        const coriolis = 0.15;
        const tmpX = windX;
        windX = windX - windZ * coriolis;
        windZ = windZ + tmpX * coriolis;

        const speed = Math.hypot(windX, windZ);
        return { x: windX, z: windZ, speed, angle: Math.atan2(windZ, windX) };
    }

    _updateLocalWind(focus) {
        const now = performance.now();
        if (now - this._lastWindUpdate < this._windUpdateInterval) return;
        this._lastWindUpdate = now;

        const wx = focus?.x ?? 0;
        const wz = focus?.z ?? 0;
        this.localWind = this._sampleWindAt(wx, wz, 10);

        // Debug: log wind changes so user can verify responsiveness
        if (this._debugWind) {
            console.log(`[Wind] pos=(${wx.toFixed(0)},${wz.toFixed(0)}) speed=${this.localWind.speed.toFixed(2)} angle=${(this.localWind.angle * 180 / Math.PI).toFixed(0)}° agents=${this._envAgents.length}`);
        }

        // Push update to any subscribers (e.g., terrain effects)
        if (typeof window.onWindUpdate === 'function') {
            window.onWindUpdate(this.localWind);
        }
    }

    pushWindUpdate() {
        this._lastWindUpdate = 0; // reset throttle
    }

    _drawWindArrows(ctx, focus, pxPerUnit, cosH, sinH, center) {
        if (!this.localWind || this.localWind.speed < 0.1) return;
        const wx = focus?.x ?? 0;
        const wz = focus?.z ?? 0;
        const p = this._worldToMinimap(wx, wz, focus, pxPerUnit, cosH, sinH, center);
        const x = p.px, y = p.py;
        const angle = this.localWind.angle;
        const len = Math.min(20, 8 + this.localWind.speed * 1.5);

        // Shadow
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * len + 1, y + Math.sin(angle) * len + 1);
        ctx.lineTo(x - Math.cos(angle + 0.4) * len * 0.5 + 1, y - Math.sin(angle + 0.4) * len * 0.5 + 1);
        ctx.lineTo(x - Math.cos(angle - 0.4) * len * 0.5 + 1, y - Math.sin(angle - 0.4) * len * 0.5 + 1);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fill();

        // Arrow
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.lineTo(x - Math.cos(angle + 0.4) * len * 0.5, y - Math.sin(angle + 0.4) * len * 0.5);
        ctx.lineTo(x - Math.cos(angle - 0.4) * len * 0.5, y - Math.sin(angle - 0.4) * len * 0.5);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 220, 120, 0.85)';
        ctx.fill();
    }

    _buildFrontChain(low, high, segments = 14, iterations = 3) {
        const cacheKey = `${low.x.toFixed(1)},${low.z.toFixed(1)}-${high.x.toFixed(1)},${high.z.toFixed(1)}`;
        const cached = this._frontChainCache.get(cacheKey);
        const posThreshold = 1.0;

        if (cached) {
            const lowMoved = Math.hypot(low.x - cached.lowX, low.z - cached.lowZ);
            const highMoved = Math.hypot(high.x - cached.highX, high.z - cached.highZ);
            if (lowMoved < posThreshold && highMoved < posThreshold) {
                return cached.chain.map(v => ({ x: v.x, z: v.z }));
            }
        }

        const chain = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            chain.push({
                x: low.x + (high.x - low.x) * t,
                z: low.z + (high.z - low.z) * t,
                ox: low.x + (high.x - low.x) * t,
                oz: low.z + (high.z - low.z) * t
            });
        }

        const idealDist = Math.hypot(high.x - low.x, high.z - low.z) / segments;
        const ps = window.parameterSystem;
        const pressureStrength = ps ? (ps.getParameter('frontPressureStrength') ?? 0.6) : 0.6;
        const springStrength = ps ? (ps.getParameter('frontSpringStrength') ?? 0.3) : 0.3;
        const smoothStrength = ps ? (ps.getParameter('frontSmoothStrength') ?? 0.2) : 0.2;

        const dx = high.x - low.x;
        const dz = high.z - low.z;
        const perpX = -dz;
        const perpZ = dx;
        const perpLen = Math.hypot(perpX, perpZ) || 1;
        const nx = perpX / perpLen;
        const nz = perpZ / perpLen;

        for (let iter = 0; iter < iterations; iter++) {
            // Pressure attraction: push toward pressure = 0.5
            for (let i = 1; i < segments; i++) {
                const v = chain[i];
                const pressure = this._samplePressure(v.x, v.z);
                const offset = (0.5 - pressure) * pressureStrength * idealDist;
                v.x += nx * offset;
                v.z += nz * offset;
            }

            // Spring forces: pull toward ideal spacing
            for (let i = 1; i <= segments; i++) {
                const v = chain[i];
                const prev = chain[i - 1];
                const dist = Math.hypot(v.x - prev.x, v.z - prev.z);
                const correction = (dist - idealDist) * springStrength;
                if (dist > 0.001) {
                    const dx_ = (v.x - prev.x) / dist;
                    const dz_ = (v.z - prev.z) / dist;
                    v.x -= dx_ * correction;
                    v.z -= dz_ * correction;
                }
            }
            for (let i = 0; i < segments; i++) {
                const v = chain[i];
                const next = chain[i + 1];
                const dist = Math.hypot(next.x - v.x, next.z - v.z);
                const correction = (dist - idealDist) * springStrength;
                if (dist > 0.001) {
                    const dx_ = (next.x - v.x) / dist;
                    const dz_ = (next.z - v.z) / dist;
                    v.x += dx_ * correction;
                    v.z += dz_ * correction;
                }
            }

            // Laplacian smoothing
            for (let i = 1; i < segments; i++) {
                const v = chain[i];
                const prev = chain[i - 1];
                const next = chain[i + 1];
                v.x = v.x * (1 - smoothStrength) + ((prev.x + next.x) * 0.5) * smoothStrength;
                v.z = v.z * (1 - smoothStrength) + ((prev.z + next.z) * 0.5) * smoothStrength;
            }
        }

        this._frontChainCache.set(cacheKey, {
            chain: chain.map(v => ({ x: v.x, z: v.z })),
            lowX: low.x, lowZ: low.z,
            highX: high.x, highZ: high.z
        });

        return chain;
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

        // Heading chevron stays fixed at screen-top, map rotates beneath it
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(center, center - 26);
        ctx.lineTo(center - 6, center - 12);
        ctx.lineTo(center + 6, center - 12);
        ctx.closePath();
        ctx.fill();
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

    setWindDebug(enabled) {
        this._debugWind = enabled;
        console.log(`[MinimapOverlay] Wind debug ${enabled ? 'enabled' : 'disabled'}`);
    }
}

window.MinimapOverlay = MinimapOverlay;
