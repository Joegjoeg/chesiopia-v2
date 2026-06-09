class ConsoleManager {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.consoleBuffer = [];
        this.maxBufferSize = 1000; // Keep last 1000 log entries
        this.diagnosticsHistory = [];
        this.originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            info: console.info
        };
        this._internalLog = (...args) => {
            this.originalConsole.log.apply(console, args);
        };
        this._sendingLogs = false;
        this._inAddToBuffer = false;
        
        this.setupConsoleCapture();

        if (typeof window !== 'undefined') {
            window.consoleManager = this;
            window.getClientDiagnostics = () => this.getDiagnosticsSnapshot();
            window.requestClientDiagnostics = (reason = 'manual', extra = {}) => this.sendDiagnostics(reason, extra);
        }
    }
    
    setupConsoleCapture() {
        const self = this;
        
        // Override console methods to capture all output
        console.log = function(...args) {
            self.addToBuffer('log', args);
            self.originalConsole.log.apply(console, args);
        };
        
        console.warn = function(...args) {
            self.addToBuffer('warn', args);
            self.originalConsole.warn.apply(console, args);
        };
        
        console.error = function(...args) {
            self.addToBuffer('error', args);
            self.originalConsole.error.apply(console, args);
        };
        
        console.info = function(...args) {
            self.addToBuffer('info', args);
            self.originalConsole.info.apply(console, args);
        };
        
        // Set up server request handler
        if (this.networkManager && this.networkManager.socket) {
            this.networkManager.socket.on('requestConsoleLogs', () => {
                self.sendConsoleLogs({ reason: 'server_request' });
            });

            this.networkManager.socket.on('requestClientDiagnostics', (request = {}) => {
                self.sendDiagnostics(request?.reason || 'server_request', request);
            });
        }
    }
    
    addToBuffer(level, args) {
        if (this._inAddToBuffer) return;
        this._inAddToBuffer = true;
        try {
            const message = args.map(arg => {
                if (arg === null || arg === undefined) return String(arg);
                if (typeof arg === 'object') {
                    try {
                        const str = JSON.stringify(arg);
                        return str.length > 500 ? str.slice(0, 500) + '…' : str;
                    } catch {
                        return '[object]';
                    }
                }
                return String(arg);
            }).join(' ');

            const entry = {
                timestamp: new Date().toISOString(),
                level: level,
                message: message
            };

            this.consoleBuffer.push(entry);

            // Maintain buffer size
            if (this.consoleBuffer.length > this.maxBufferSize) {
                this.consoleBuffer.shift();
            }

            // Auto-forward errors to the server immediately so remote testers
            // don't need to trigger a manual request to see shader / runtime errors.
            if (level === 'error' && !this._sendingLogs && this.networkManager && this.networkManager.socket && this.networkManager.socket.connected) {
                this.sendConsoleLogs();
            }
        } finally {
            this._inAddToBuffer = false;
        }
    }
    
    sendConsoleLogs(options = {}) {
        if (this._sendingLogs) return null;
        this._sendingLogs = true;
        try {
            if (this.networkManager && this.networkManager.socket) {
                const reason = options.reason || 'manual';
                const includeDiagnostics = options.includeDiagnostics !== false;
                const extra = options.extra || {};
                const logsData = {
                    buffer: this.consoleBuffer,
                    clientInfo: {
                        userAgent: navigator.userAgent,
                        url: window.location.href,
                        timestamp: new Date().toISOString(),
                        bufferSize: this.consoleBuffer.length,
                        maxBufferSize: this.maxBufferSize
                    },
                    meta: {
                        type: 'consoleLogs',
                        reason,
                        timestamp: new Date().toISOString()
                    }
                };

                if (includeDiagnostics) {
                    logsData.diagnostics = this.getDiagnosticsSnapshot(reason, extra);
                }
                
                this.networkManager.socket.emit('consoleLogs', logsData);
                this._internalLog(`[ConsoleManager] Sent console logs${includeDiagnostics ? ' + diagnostics' : ''} (${reason})`);
                return logsData;
            }

            return null;
        } finally {
            this._sendingLogs = false;
        }
    }

    sendDiagnostics(reason = 'manual', extra = {}) {
        return this.sendConsoleLogs({ reason, includeDiagnostics: true, extra });
    }

    getDiagnosticsSnapshot(reason = 'manual', extra = {}) {
        const now = new Date().toISOString();
        const game = typeof window !== 'undefined' ? window.game : null;
        const parameterSystem = typeof window !== 'undefined' ? window.parameterSystem : null;
        const getParams = parameterSystem && typeof parameterSystem.getAllParameters === 'function'
            ? parameterSystem.getAllParameters.bind(parameterSystem)
            : (typeof window !== 'undefined' && typeof window.getAllParams === 'function' ? window.getAllParams : null);

        const navEntry = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
            ? performance.getEntriesByType('navigation')[0] || null
            : null;
        const memory = typeof performance !== 'undefined' && performance.memory
            ? {
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                usedJSHeapSize: performance.memory.usedJSHeapSize
            }
            : null;

        const socket = this.networkManager?.socket || null;
        const network = {
            connected: !!socket?.connected,
            socketId: socket?.id || null,
            transport: socket?.io?.engine?.transport?.name || null,
            reconnectAttempts: this.networkManager?.reconnectAttempts ?? null,
            statusText: this.networkManager?.status?.text ?? null
        };

        const snapshot = {
            reason,
            capturedAt: now,
            clientInfo: {
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
                url: typeof window !== 'undefined' ? window.location.href : null,
                viewport: typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 } : null,
                language: typeof navigator !== 'undefined' ? navigator.language : null,
                platform: typeof navigator !== 'undefined' ? navigator.platform : null,
                hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || null : null,
                deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory || null : null,
                visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
                onLine: typeof navigator !== 'undefined' ? navigator.onLine : null,
                memory,
                navigation: navEntry ? {
                    type: navEntry.type,
                    startTime: navEntry.startTime,
                    domContentLoaded: navEntry.domContentLoadedEventEnd,
                    loadEventEnd: navEntry.loadEventEnd,
                    transferSize: navEntry.transferSize
                } : null
            },
            network,
            console: {
                stats: this.getStats(),
                recentErrors: this.getRecentLogs(40).filter(entry => entry.level === 'error' || entry.level === 'warn'),
                recentLogs: this.getRecentLogs(20)
            },
            game: game && typeof game.getClientDiagnostics === 'function' ? game.getClientDiagnostics() : null,
            parameters: getParams ? getParams() : null,
            debug: typeof window !== 'undefined' ? {
                terrain: window.__terrainDebug ? {
                    cameraPosition: this._plainVector(window.__terrainDebug.cameraPosition),
                    cameraTarget: this._plainVector(window.__terrainDebug.cameraTarget),
                    rollingTerrain: this._plainRollingTerrainState(window.__terrainDebug.rollingTerrain)
                } : null,
                clientLoad: window.__clientLoadDiagnostics ? this._cloneDiagnosticValue(window.__clientLoadDiagnostics) : null
            } : null,
            extra
        };

        this.diagnosticsHistory.push({
            capturedAt: now,
            reason,
            consoleEntries: snapshot.console.stats.totalEntries,
            terrainChunks: snapshot.game?.terrain?.loadedChunks ?? null,
            boardMode: snapshot.game?.board?.meshMode ?? null
        });
        if (this.diagnosticsHistory.length > 20) {
            this.diagnosticsHistory.shift();
        }

        snapshot.history = this.diagnosticsHistory.slice(-5);
        return snapshot;
    }

    _plainVector(value) {
        if (!value) return null;
        if (Array.isArray(value)) return value.slice();
        if (typeof value.toArray === 'function') return value.toArray();
        if (typeof value === 'object') {
            const out = {};
            if ('x' in value) out.x = value.x;
            if ('y' in value) out.y = value.y;
            if ('z' in value) out.z = value.z;
            if ('w' in value) out.w = value.w;
            return Object.keys(out).length > 0 ? out : value;
        }
        return value;
    }

    _plainRollingTerrainState(value) {
        if (!value || typeof value !== 'object') return null;
        return {
            originX: value.originX ?? null,
            originZ: value.originZ ?? null,
            threshold: value.threshold ?? null,
            gridSize: value.N ?? null,
            cellSize: value.S ?? null,
            windSpeed: value.windSpeed ?? null,
            windDir: this._plainVector(value.windDir),
            updateThrottle: value.updateThrottle ? {
                enabled: value.updateThrottle.enabled ?? null,
                intervalMs: value.updateThrottle.intervalMs ?? null,
                minDistance: value.updateThrottle.minDistance ?? null,
                lastUpdateTime: value.updateThrottle.lastUpdateTime ?? null
            } : null,
            trackHistory: Array.isArray(value._trackHistory) ? value._trackHistory.slice(-10) : null
        };
    }

    _cloneDiagnosticValue(value) {
        if (value === null || value === undefined) return value;
        if (Array.isArray(value)) return value.map(item => this._cloneDiagnosticValue(item));
        if (typeof value === 'object') {
            if (typeof value.toArray === 'function') return value.toArray();
            if (value instanceof Map) {
                return Object.fromEntries(Array.from(value.entries()).map(([k, v]) => [k, this._cloneDiagnosticValue(v)]));
            }
            if (value instanceof Set) {
                return Array.from(value.values()).map(v => this._cloneDiagnosticValue(v));
            }
            const out = {};
            for (const [key, entry] of Object.entries(value)) {
                if (typeof entry === 'function') continue;
                out[key] = this._cloneDiagnosticValue(entry);
            }
            return out;
        }
        return value;
    }
    
    getRecentLogs(count = 50) {
        return this.consoleBuffer.slice(-count);
    }
    
    clearBuffer() {
        this.consoleBuffer = [];
        console.log('[ConsoleManager] Console buffer cleared');
    }
    
    // Restore original console (for cleanup)
    restoreConsole() {
        console.log = this.originalConsole.log;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.info = this.originalConsole.info;
    }
    
    // Get buffer statistics
    getStats() {
        const stats = {
            totalEntries: this.consoleBuffer.length,
            byLevel: {
                log: 0,
                warn: 0,
                error: 0,
                info: 0
            },
            oldestEntry: null,
            newestEntry: null
        };
        
        if (this.consoleBuffer.length > 0) {
            stats.oldestEntry = this.consoleBuffer[0].timestamp;
            stats.newestEntry = this.consoleBuffer[this.consoleBuffer.length - 1].timestamp;
            
            this.consoleBuffer.forEach(entry => {
                stats.byLevel[entry.level]++;
            });
        }
        
        return stats;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsoleManager;
}
