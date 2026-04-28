class ConsoleManager {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.consoleBuffer = [];
        this.maxBufferSize = 1000; // Keep last 1000 log entries
        this.originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            info: console.info
        };
        
        this.setupConsoleCapture();
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
                self.sendConsoleLogs();
            });
        }
    }
    
    addToBuffer(level, args) {
        const entry = {
            timestamp: new Date().toISOString(),
            level: level,
            message: args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' '),
            rawArgs: args
        };
        
        this.consoleBuffer.push(entry);
        
        // Maintain buffer size
        if (this.consoleBuffer.length > this.maxBufferSize) {
            this.consoleBuffer.shift();
        }
    }
    
    sendConsoleLogs() {
        if (this.networkManager && this.networkManager.socket) {
            const logsData = {
                buffer: this.consoleBuffer,
                clientInfo: {
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    timestamp: new Date().toISOString(),
                    bufferSize: this.consoleBuffer.length,
                    maxBufferSize: this.maxBufferSize
                }
            };
            
            this.networkManager.socket.emit('consoleLogs', logsData);
            console.log('[ConsoleManager] Sent console logs to server');
        }
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
