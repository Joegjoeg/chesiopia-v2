/**
 * CrashDump - Automatic state capture on errors, WebGL context loss, or manual trigger.
 * Stores last N console lines and a structured game-state snapshot.
 */
class CrashDump {
    constructor() {
        this.MAX_CONSOLE = 200;
        this.consoleRing = [];
        this._origLog = console.log;
        this._origWarn = console.warn;
        this._origErr = console.error;
        this._game = null;
        this._renderer = null;
        this._lastDump = null;
        this._overlay = null;
        this._lastTriggerTime = 0;
        this._debounceMs = 5000;

        this._hookConsole();
        this._hookErrors();
    }

    registerGame(game) {
        this._game = game;
        if (game && game.renderer) this._renderer = game.renderer;
        if (game && game.renderer && game.renderer.domElement) {
            this._hookWebGL(game.renderer.domElement);
        }
    }

    // ---------- Console interception ----------
    _hookConsole() {
        const push = (lvl, args) => {
            const text = args.map(a => {
                try { return (typeof a === 'object') ? JSON.stringify(a) : String(a); }
                catch (e) { return String(a); }
            }).join(' ');
            this.consoleRing.push({ t: performance.now(), lvl, text });
            if (this.consoleRing.length > this.MAX_CONSOLE) this.consoleRing.shift();
        };
        console.log   = (...a) => { this._origLog.apply(console, a); push('log', a); };
        console.warn  = (...a) => { this._origWarn.apply(console, a); push('warn', a); };
        console.error = (...a) => { this._origErr.apply(console, a); push('error', a); };
    }

    restoreConsole() {
        console.log = this._origLog;
        console.warn = this._origWarn;
        console.error = this._origErr;
    }

    // ---------- Error / promise rejection ----------
    _hookErrors() {
        window.addEventListener('error', (e) => {
            this.trigger({
                source: 'onerror',
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno,
                stack: e.error && e.error.stack ? e.error.stack : null
            });
        });
        window.addEventListener('unhandledrejection', (e) => {
            this.trigger({
                source: 'unhandledrejection',
                message: e.reason && e.reason.message ? e.reason.message : String(e.reason),
                stack: e.reason && e.reason.stack ? e.reason.stack : null
            });
        });
    }

    _hookWebGL(canvas) {
        canvas.addEventListener('webglcontextlost', (e) => {
            this.trigger({ source: 'webgl', message: 'WebGL context lost', stack: null });
        });
    }

    // ---------- State snapshot ----------
    _snapshotGame() {
        const g = this._game;
        if (!g) return null;
        const snap = {
            contextLost: !!g._contextLost,
            camera: g.camera ? { x: g.camera.position.x, y: g.camera.position.y, z: g.camera.position.z } : null,
            renderer: this._snapshotRenderer(),
            terrain: this._snapshotTerrain(),
            board: this._snapshotBoard(),
            performance: g.performanceManager ? { qualityLevel: g.performanceManager.qualityLevel } : null,
            resourceGuard: g.resourceGuard ? {
                consecutiveGeoIncreases: g.resourceGuard._consecutiveGeoIncreases,
                consecutiveTexIncreases: g.resourceGuard._consecutiveTexIncreases,
                hasEmergencyCleaned: g.resourceGuard._hasEmergencyCleaned
            } : null
        };
        return snap;
    }

    _snapshotRenderer() {
        if (!this._renderer) return null;
        const info = this._renderer.info || {};
        const render = info.render || {};
        const mem = info.memory || {};
        return {
            calls: render.calls,
            triangles: render.triangles,
            points: render.points,
            lines: render.lines,
            geometries: mem.geometries,
            textures: mem.textures
        };
    }

    _snapshotTerrain() {
        const ts = this._game && this._game.terrainSystem;
        if (!ts) return null;
        return {
            chunksCached: ts.chunks ? ts.chunks.size : 0,
            worldDownloaded: !!ts.worldDownloaded,
            chunkSize: ts.chunkSize,
            loadDistance: ts.loadDistance,
            streamingEnabled: !!ts.streamingEnabled
        };
    }

    _snapshotBoard() {
        const bs = this._game && this._game.boardSystem;
        if (!bs) return null;
        return {
            useViewportMesh: !!bs.useViewportMesh,
            hasRollingTerrain: !!bs.rollingTerrain,
            hasContinuousMesh: !!bs.continuousMesh,
            chunks: bs.chunks ? bs.chunks.size : 0,
            meshBounds: bs.meshBounds ? {
                centerX: bs.meshBounds.centerX,
                centerZ: bs.meshBounds.centerZ,
                size: bs.meshBounds.size
            } : null,
            shorelineSubdivision: bs.shorelineSubdivision
        };
    }

    // ---------- Dump & UI ----------
    trigger(errorInfo = null) {
        const now = Date.now();
        if (now - this._lastTriggerTime < this._debounceMs) return this._lastDump;
        this._lastTriggerTime = now;
        const dump = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent,
            error: errorInfo,
            console: this.consoleRing.slice(),
            gameState: this._snapshotGame(),
            memory: this._snapshotMemory()
        };
        this._lastDump = dump;
        this._showOverlay(dump);
        // Also log a compact summary to console so it's in the ring buffer too
        console.error('[CrashDump] Capture triggered', errorInfo ? `(${errorInfo.source}: ${errorInfo.message})` : '(manual)');
        return dump;
    }

    _snapshotMemory() {
        const heap = performance.memory || {};
        return {
            usedJSHeapSize: heap.usedJSHeapSize,
            totalJSHeapSize: heap.totalJSHeapSize,
            jsHeapSizeLimit: heap.jsHeapSizeLimit
        };
    }

    download() {
        if (!this._lastDump) return;
        const blob = new Blob([JSON.stringify(this._lastDump, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crash-dump-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _showOverlay(dump) {
        if (this._overlay) this._overlay.remove();
        const div = document.createElement('div');
        div.id = 'crashDumpOverlay';
        div.style.cssText = `
            position:fixed;top:0;left:0;right:0;bottom:0;
            background:rgba(20,0,0,0.92);color:#ff6b6b;z-index:99999;
            font-family:monospace;padding:24px;overflow:auto;display:flex;flex-direction:column;
        `;
        const err = dump.error || {};
        const summary = err.message ? `${err.source}: ${err.message}` : 'Manual / unknown trigger';
        div.innerHTML = `
            <h2 style="margin:0 0 8px 0;color:#ff3333;">Crash Dump Captured</h2>
            <div style="color:#ff9999;margin-bottom:16px;font-size:13px;">${dump.timestamp} — ${summary}</div>
            <pre id="cdPreview" style="flex:1;overflow:auto;background:rgba(0,0,0,0.5);padding:12px;border-radius:6px;font-size:11px;color:#ccc;line-height:1.4;"></pre>
            <div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap;">
                <button id="cdDownload" style="background:#ff3333;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:bold;">
                    Download .json
                </button>
                <button id="cdClose" style="background:#444;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:14px;">
                    Close
                </button>
                <button id="cdCopy" style="background:#444;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:14px;">
                    Copy to clipboard
                </button>
            </div>
        `;
        document.body.appendChild(div);
        this._overlay = div;

        // Fill preview with compact game state
        const pre = div.querySelector('#cdPreview');
        pre.textContent = JSON.stringify(dump.gameState, null, 2);

        div.querySelector('#cdDownload').onclick = () => this.download();
        div.querySelector('#cdClose').onclick = () => { div.remove(); this._overlay = null; };
        div.querySelector('#cdCopy').onclick = () => {
            navigator.clipboard.writeText(JSON.stringify(dump, null, 2)).then(() => alert('Copied!'));
        };
    }
}

const crashDump = new CrashDump();
window.CrashDump = crashDump;
