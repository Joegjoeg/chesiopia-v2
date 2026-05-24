/**
 * MemoryProfiler - Lightweight runtime memory & object counter for Three.js
 *
 * Only updates when the dev interface is open (or when manually invoked),
 * throttled to once per second to avoid adding overhead.
 */
class MemoryProfiler {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.renderer = game.renderer;

        this._lastUpdateTime = 0;
        this._updateIntervalMs = 1000;
        this._isVisible = false;

        this._prevCounts = {};
        this._deltas = {};

        // Ring buffers for sparklines (60 seconds at 1s interval)
        this._historyLen = 60;
        this._history = {
            geometries: new Array(this._historyLen).fill(0),
            materials:  new Array(this._historyLen).fill(0),
            heap:       new Array(this._historyLen).fill(0),
            calls:      new Array(this._historyLen).fill(0)
        };
        this._historyIdx = 0;
        this._focusedMetric = null;
        this._panelMode = 'floating';
        this._mountRef = null;

        this._buildPanel();
        this._setupHotkey();
    }

    update(currentTimeMs) {
        const devOpen = window.devInterface && window.devInterface.isVisible;
        const shouldShow = this._isVisible || devOpen;

        if (shouldShow && this._panelMode !== 'embedded') {
            this.attachToDevTools();
        }
        if (this._panelMode === 'embedded') {
            this._resizeCanvasIfNeeded();
        }

        if (!shouldShow) {
            if (this.panel.style.display !== 'none') {
                this.panel.style.display = 'none';
            }
            return;
        }

        if (this.panel.style.display !== 'block') {
            this.panel.style.display = 'block';
        }

        if (currentTimeMs - this._lastUpdateTime < this._updateIntervalMs) return;
        this._lastUpdateTime = currentTimeMs;

        const counts = this._countSceneObjects();
        const systemCounts = this._countSystemObjects();
        const rendererInfo = this.renderer.info;
        const heap = performance.memory || {};

        this._pushHistory(counts, rendererInfo, heap);
        this._updatePanel(counts, systemCounts, rendererInfo, heap);
        this._drawGraph();
        this._logDeltas(counts, systemCounts);
    }

    toggle() {
        this._isVisible = !this._isVisible;
        console.log(`[MemoryProfiler] ${this._isVisible ? 'shown' : 'hidden'} (toggle with 'M')`);
    }

    dump() {
        const counts = this._countSceneObjects();
        const systemCounts = this._countSystemObjects();
        const heap = performance.memory || {};
        console.log('[MemoryProfiler] ===== SNAPSHOT =====');
        console.log('Scene objects:', counts);
        console.log('System objects:', systemCounts);
        console.log('Heap:', {
            used: this._fmtBytes(heap.usedJSHeapSize),
            total: this._fmtBytes(heap.totalJSHeapSize),
            limit: this._fmtBytes(heap.jsHeapSizeLimit)
        });
        console.log('======================');
    }

    _countSceneObjects() {
        let meshes = 0, groups = 0, lights = 0, cameras = 0;
        let geometries = new Set();
        let materials = new Set();
        let textures = new Set();

        this.scene.traverse((obj) => {
            if (obj.isMesh) meshes++;
            if (obj.isGroup) groups++;
            if (obj.isLight) lights++;
            if (obj.isCamera) cameras++;

            if (obj.isMesh && obj.geometry) {
                geometries.add(obj.geometry.uuid);
            }
            if (obj.isMesh && obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach((m) => {
                    if (!m) return;
                    materials.add(m.uuid);
                    // Walk material textures
                    for (const key of Object.keys(m)) {
                        const val = m[key];
                        if (val && val.isTexture) textures.add(val.uuid);
                    }
                    // Uniforms may also hold textures
                    if (m.uniforms) {
                        for (const key of Object.keys(m.uniforms)) {
                            const u = m.uniforms[key];
                            const val = u && u.value;
                            if (val && val.isTexture) textures.add(val.uuid);
                        }
                    }
                });
            }
        });

        return {
            meshes,
            groups,
            lights,
            cameras,
            geometries: geometries.size,
            materials: materials.size,
            textures: textures.size
        };
    }

    _countSystemObjects() {
        const g = this.game;
        return {
            chunks: g.terrainSystem?.chunks?.size || 0,
            daisies: g.decorativeVisuals?.daisies?.size || 0,
            birds: g.decorativeVisuals?.activeBirds?.size || 0,
            pieces: g.piecesSystem?.pieceMeshes?.size || 0,
            trees: g.hybridTreeManager?.getTreeCount?.() || 0,
            validMoves: g.visualFeedback?.validMoves?.size || 0
        };
    }

    _pushHistory(counts, rendererInfo, heap) {
        const idx = this._historyIdx % this._historyLen;
        this._history.geometries[idx] = counts.geometries;
        this._history.materials[idx]   = counts.materials;
        this._history.heap[idx]        = heap.usedJSHeapSize ? Math.round(heap.usedJSHeapSize / (1024 * 1024)) : 0;
        this._history.calls[idx]       = rendererInfo.render.calls;
        this._historyIdx++;
    }

    _updatePanel(counts, systemCounts, rendererInfo, heap) {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const statItems = [
            { label: 'Geo', value: counts.geometries },
            { label: 'Mat', value: counts.materials },
            { label: 'Tex', value: counts.textures },
            { label: 'Mesh', value: counts.meshes },
            { label: 'Grp', value: counts.groups },
            { label: 'Light', value: counts.lights },
            { label: 'Chunk', value: systemCounts.chunks },
            { label: 'Daisy', value: systemCounts.daisies },
            { label: 'Bird', value: systemCounts.birds },
            { label: 'Piece', value: systemCounts.pieces },
            { label: 'Tree', value: systemCounts.trees },
            { label: 'Valid', value: systemCounts.validMoves },
            { label: 'Calls', value: rendererInfo.render.calls },
            { label: 'TriK', value: (rendererInfo.render.triangles / 1000).toFixed(1) },
            { label: 'Heap', value: heap.usedJSHeapSize ? this._fmtBytes(heap.usedJSHeapSize) : '—' }
        ];

        const chipStyle = 'display:flex;justify-content:space-between;gap:2px;padding:0 3px;border-radius:2px;background:rgba(0,255,0,0.06);border:1px solid rgba(0,255,0,0.08);color:#bfffcf;font-size:8px;line-height:1.2;letter-spacing:0.3px;';
        const chips = statItems.map(item => `<span style="${chipStyle}"><span style=\"opacity:0.7\">${item.label}</span><span>${item.value}</span></span>`).join('');

        this._statsDiv.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;color:#00ff00;">
                <span>Memory</span>
                <span style="color:#666;font-size:9px;font-weight:400;">${timeStr}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(62px,1fr));gap:3px;">
                ${chips}
            </div>
        `;

        const idx = (this._historyIdx - 1 + this._historyLen) % this._historyLen;
        for (const span of this._legendSpans) {
            const m = span._metricDef;
            const val = this._history[m.key][idx];
            const displayVal = m.key === 'heap' ? val + 'MB' : val;
            const isFocused = this._focusedMetric === m.key;
            span.textContent = `${m.label}:${displayVal}`;
            span.style.color = m.color;
            span.style.opacity = isFocused ? '1' : '0.75';
            span.style.fontWeight = isFocused ? '700' : '400';
            span.style.background = isFocused ? 'rgba(255,255,255,0.1)' : 'transparent';
        }
    }

    _drawGraph() {
        const ctx = this._canvas.getContext('2d');
        const w = this._canvas.width;
        const h = this._canvas.height;
        const pad = 4;
        const axisW = this._focusedMetric ? 32 : 0;
        const graphW = w - axisW;
        const graphX = axisW;

        ctx.clearRect(0, 0, w, h);

        // Subtle background tint
        ctx.fillStyle = 'rgba(0, 20, 0, 0.3)';
        ctx.fillRect(0, 0, w, h);

        const metrics = [
            { key: 'geometries', color: '#00ffff', label: 'Geo' },
            { key: 'materials',  color: '#ff00ff', label: 'Mat' },
            { key: 'heap',       color: '#ffff00', label: 'Heap' },
            { key: 'calls',      color: '#00ff00', label: 'Calls' }
        ];

        // Faint horizontal guide lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const y25 = pad + (h - pad * 2) * 0.25;
        const y75 = pad + (h - pad * 2) * 0.75;
        ctx.moveTo(graphX, y25);
        ctx.lineTo(w, y25);
        ctx.moveTo(graphX, y75);
        ctx.lineTo(w, y75);
        ctx.stroke();

        for (const m of metrics) {
            const isFocused = this._focusedMetric === m.key;
            const isDimmed = this._focusedMetric && !isFocused;
            const data = this._history[m.key];

            let min = Infinity, max = -Infinity;
            for (const v of data) {
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (max === min) { max++; min--; }

            ctx.save();
            if (isDimmed) ctx.globalAlpha = 0.4;

            ctx.beginPath();
            ctx.strokeStyle = m.color;
            ctx.lineWidth = isFocused ? 2.5 : 1.5;
            for (let i = 0; i < this._historyLen; i++) {
                const x = graphX + (i / (this._historyLen - 1)) * graphW;
                const v = data[(this._historyIdx + i) % this._historyLen];
                const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Axis values for focused metric
            if (isFocused) {
                ctx.fillStyle = m.color;
                ctx.textAlign = 'right';
                ctx.font = '8px monospace';
                ctx.globalAlpha = 1;

                const maxLabel = m.key === 'heap' ? max + 'MB' : String(max);
                const minLabel = m.key === 'heap' ? min + 'MB' : String(min);
                ctx.fillText(maxLabel, axisW - 3, pad + 8);
                ctx.fillText(minLabel, axisW - 3, h - pad);
            }

            ctx.restore();
        }
    }

    _logDeltas(counts, systemCounts) {
        const now = Date.now();
        const all = { ...counts, ...systemCounts };
        const changes = [];
        for (const key of Object.keys(all)) {
            const prev = this._prevCounts[key];
            const curr = all[key];
            if (prev !== undefined && prev !== curr) {
                const sign = curr > prev ? '+' : '';
                changes.push(`${key}:${prev}→${curr} (${sign}${curr - prev})`);
            }
            this._prevCounts[key] = curr;
        }
        if (changes.length) {
            // console.log(`[MemoryProfiler Δ] ${changes.join(' | ')}`);
        }
    }

    _fmtBytes(bytes) {
        if (!bytes) return '0B';
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
    }

    _buildPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'memoryProfilerPanel';

        this._statsDiv = document.createElement('div');
        this._statsDiv.style.cssText = `
            border-bottom: 1px solid rgba(255,255,255,0.08);
            padding-bottom: 4px;
            margin-bottom: 4px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;
        this.panel.appendChild(this._statsDiv);

        this._legendDiv = document.createElement('div');
        this._legendDiv.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 6px;
        `;
        this.panel.appendChild(this._legendDiv);

        this._legendSpans = [];
        const metricDefs = [
            { key: 'geometries', color: '#00ffff', label: 'Geo' },
            { key: 'materials',  color: '#ff00ff', label: 'Mat' },
            { key: 'heap',       color: '#ffff00', label: 'Heap' },
            { key: 'calls',      color: '#00ff00', label: 'Calls' }
        ];
        for (const m of metricDefs) {
            const span = document.createElement('span');
            span.style.cssText = `
                font-size: 9px;
                padding: 1px 4px;
                border-radius: 3px;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
            `;
            span.addEventListener('click', () => {
                this._focusedMetric = this._focusedMetric === m.key ? null : m.key;
                this._drawGraph();
                for (const s of this._legendSpans) {
                    const def = s._metricDef;
                    const focused = this._focusedMetric === def.key;
                    s.style.color = def.color;
                    s.style.opacity = focused ? '1' : '0.75';
                    s.style.fontWeight = focused ? '700' : '400';
                    s.style.background = focused ? 'rgba(255,255,255,0.1)' : 'transparent';
                }
            });
            span._metricDef = m;
            this._legendSpans.push(span);
            this._legendDiv.appendChild(span);
        }

        this._canvas = document.createElement('canvas');
        this._canvas.width = 220;
        this._canvas.height = 40;
        this._canvas.style.cssText = `
            display: block;
            border-top: 1px solid rgba(255,255,255,0.1);
            height: 40px;
        `;
        this.panel.appendChild(this._canvas);

        if (!this.attachToDevTools()) {
            this._applyFloatingPanelStyles();
            document.body.appendChild(this.panel);
        }
    }

    attachToDevTools() {
        const devInterface = window.devInterface;
        const mount = devInterface && typeof devInterface.getMemoryPanelMount === 'function'
            ? devInterface.getMemoryPanelMount()
            : null;

        if (!mount) return false;

        if (this.panel.parentNode && this.panel.parentNode !== mount) {
            this.panel.parentNode.removeChild(this.panel);
        }

        if (mount.firstChild && mount.firstChild !== this.panel) {
            mount.innerHTML = '';
        }

        if (this.panel.parentNode !== mount) {
            mount.appendChild(this.panel);
        }

        this._panelMode = 'embedded';
        this._mountRef = mount;
        this.panel.style.cssText = `
            display: none;
            font-family: 'Segoe UI', 'Roboto', monospace, sans-serif;
            font-size: 10px;
            color: #aaffaa;
            line-height: 1.4;
            width: 100%;
        `;
        this._canvas.style.width = '100%';
        this._resizeCanvasIfNeeded(true);
        return true;
    }

    _applyFloatingPanelStyles() {
        this._panelMode = 'floating';
        this._mountRef = null;
        this.panel.style.cssText = `
            position: fixed;
            top: 5px;
            left: 5px;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px;
            padding: 6px 8px;
            font-family: 'Segoe UI', 'Roboto', monospace, sans-serif;
            font-size: 10px;
            color: #aaffaa;
            display: none;
            z-index: 10001;
            line-height: 1.4;
            min-width: 220px;
            pointer-events: auto;
            user-select: none;
        `;
        this._canvas.style.width = '220px';
        this._resizeCanvasIfNeeded(true);
    }

    _resizeCanvasIfNeeded(force = false) {
        if (!this._canvas) return;
        let desiredWidth;
        if (this._panelMode === 'embedded') {
            const mountWidth = this._mountRef?.clientWidth || this.panel.clientWidth || this._canvas.width || 320;
            desiredWidth = Math.max(260, Math.floor(mountWidth));
        } else {
            desiredWidth = 220;
        }
        if (force || this._canvas.width !== desiredWidth) {
            this._canvas.width = desiredWidth;
        }
    }

    _setupHotkey() {
        document.addEventListener('keydown', (e) => {
            if (e.key && e.key.toLowerCase() === 'm' && !e.target.matches('input, textarea')) {
                this.toggle();
            }
        });
    }
}
