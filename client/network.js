class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.eventHandlers = new Map();
        this.consoleManager = null;
        
        // Connection status
        this.status = {
            connected: false,
            text: 'Disconnected',
            lastError: null
        };
    }
    
    getServerUrl() {
        // If running on localhost, connect to localhost
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'localhost:3000';
        }
        
        // If running on Render, use the same hostname (standard web ports)
        if (window.location.hostname.includes('onrender.com')) {
            return window.location.hostname;
        }
        
        // For production, use the current hostname
        return window.location.hostname;
    }
    
    async connect() {
        try {
            this.updateStatus('Connecting...', false);
            
            // Determine server URL based on current hostname
            const serverUrl = this.getServerUrl();
            console.log('[Network] Starting connection to', serverUrl, '...');
            
            // Connect to server
            this.socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                timeout: 10000,
                forceNew: true
            });
            
            console.log('[Network] Socket.IO instance created:', this.socket);
            
            // Setup event handlers
            this.setupSocketEvents();
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error('[Network] Connection timeout after 10 seconds');
                    this.updateConnectionDebug('Connection timeout - server not responding');
                    reject(new Error('Connection timeout'));
                }, 10000);
                
                this.socket.on('connect', () => {
                    console.log('[Network] Socket.IO connected successfully!');
                    clearTimeout(timeout);
                    this.updateConnectionDebug('Connected to server successfully');
                    resolve();
                });
                
                this.socket.on('connect_error', (error) => {
                    console.error('[Network] Socket.IO connection error:', error);
                    clearTimeout(timeout);
                    this.updateConnectionDebug('Connection error: ' + error.message);
                    reject(error);
                });
            });
            
        } catch (error) {
            console.error('[Network] Connection exception:', error);
            this.updateStatus('Connection failed', false);
            this.updateConnectionDebug('Connection exception: ' + error.message);
            throw error;
        }
    }
    
    setupSocketEvents() {
        console.log('[Network] Setting up socket events...');
        
        // Connection events
        this.socket.on('connect', () => {
            console.log('[Network] CONNECT event received!');
            this.onConnected();
        });
        
        this.socket.on('disconnect', () => {
            console.log('[Network] DISCONNECT event received!');
            this.onDisconnected();
        });
        
        this.socket.on('connect_error', (error) => {
            console.log('[Network] CONNECT_ERROR event received!', error);
            this.onConnectionError(error);
        });
        
        this.socket.on('reconnect', () => {
            console.log('[Network] RECONNECT event received!');
            this.onReconnected();
        });
        
        this.socket.on('reconnect_error', (error) => {
            console.log('[Network] RECONNECT_ERROR event received!', error);
            this.onReconnectError(error);
        });
        
        this.socket.on('reconnect_failed', () => {
            console.log('[Network] RECONNECT_FAILED event received!');
            this.onReconnectFailed();
        });
        
        // Keep worldRegenerated for terrain reset
        this.socket.on('worldRegenerated', (data) => {
            console.log('[Network] Received worldRegenerated:', data);
            this.triggerEvent('worldRegenerated', data);
        });

        // Error events
        this.socket.on('error', (error) => {
            console.log('[Network] Received error event:', error);
            this.onError(error);
        });

        // Console logs request handler
        this.socket.on('requestConsoleLogs', () => {
            console.log('[Network] Server requested console logs');
            if (this.consoleManager) {
                this.consoleManager.sendConsoleLogs();
            }
        });

        console.log('[Network] All socket events set up');
    }
    
    onConnected() {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.updateStatus('Connected', true);
        this.updateConnectionDebug('Socket connected - joining game...');
        
        // Initialize console manager after connection
        this.initializeConsoleManager();
        
        // Join game — stripped of auth
        const playerData = {
            name: this.getPlayerName(),
            color: this.getPlayerColor()
        };
        console.log('[Network] Emitting joinGame with data:', playerData);
        this.emit('joinGame', playerData);
    }
    
    onDisconnected() {
        this.connected = false;
        this.updateStatus('Disconnected', false);
        console.log('Disconnected from server');
        
        // Attempt to reconnect
        this.attemptReconnect();
    }
    
    onConnectionError(error) {
        this.connected = false;
        this.status.lastError = error.message;
        this.updateStatus('Connection error: ' + error.message, false);
        console.error('[Network] Connection error:', error);
        console.error('[Network] Error details:', error.description, error.context, error.type);
        
        // Attempt to reconnect
        this.attemptReconnect();
    }
    
    onReconnected() {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.updateStatus('Reconnected', true);
        console.log('Reconnected to server');
    }
    
    onReconnectAttempt() {
        this.reconnectAttempts++;
        console.log(`Reconnection attempt ${this.reconnectAttempts}`);
        this.updateStatus(`Reconnecting... (${this.reconnectAttempts})`, false);
    }
    
    onError(error) {
        console.error('Socket error:', error);
        this.status.lastError = error.message;
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.updateStatus('Connection failed', false);
            console.log('Max reconnection attempts reached');
            return;
        }
        
        setTimeout(() => {
            if (!this.connected && this.socket) {
                this.socket.connect();
            }
        }, this.reconnectDelay * this.reconnectAttempts);
    }
    
    emit(event, data) {
        if (this.socket && this.connected) {
            this.socket.emit(event, data);
        } else {
            console.warn('Cannot emit event - not connected:', event);
        }
    }
    
    on(event, callback) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(callback);
    }
    
    off(event, callback) {
        if (this.eventHandlers.has(event)) {
            const handlers = this.eventHandlers.get(event);
            const index = handlers.indexOf(callback);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    triggerEvent(event, ...args) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }
    
    // Game-specific methods
    joinGame(playerData) {
        this.emit('joinGame', playerData);
    }

    // Utility methods
    getPlayerName() {
        // Try to get name from localStorage or use default
        return localStorage.getItem('playerName') || `Player${Math.floor(Math.random() * 1000)}`;
    }
    
    getPlayerColor() {
        // Try to get color from localStorage or use default
        return localStorage.getItem('playerColor') || 'white';
    }
    
    savePlayerData(name, color) {
        if (name) localStorage.setItem('playerName', name);
        if (color) localStorage.setItem('playerColor', color);
    }
    
    updateStatus(text, connected) {
        this.status.connected = connected;
        this.status.text = text;
        this.status.lastError = null;
        
        // Hide connection status - only log to console
        console.log(`[NETWORK ${connected ? 'CONNECTED' : 'DISCONNECTED'}]`, text);
        
        // Hide the visual element completely
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) {
            statusEl.style.display = 'none';
        }
    }
    
    updateConnectionDebug(message) {
        const debugEl = document.getElementById('connectionDebug');
        if (debugEl) {
            debugEl.textContent = message;
            debugEl.style.color = message.includes('ERROR') ? '#ff6666' : '#66ff66';
        }
        console.log('[Network Debug]', message);
    }
    
    getStatus() {
        return this.status;
    }
    
    isConnected() {
        return this.connected;
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
        this.updateStatus('Disconnected', false);
    }
    
    // Latency measurement
    measureLatency() {
        if (!this.connected) return null;
        
        const startTime = Date.now();
        this.emit('ping', { timestamp: startTime });
        
        // Listen for pong response
        const onPong = (data) => {
            const latency = Date.now() - data.timestamp;
            this.socket.off('pong', onPong);
            return latency;
        };
        
        this.socket.on('pong', onPong);
    }
    
    // Room management (for future multiplayer rooms)
    joinRoom(roomId) {
        this.emit('joinRoom', { roomId });
    }
    
    leaveRoom() {
        this.emit('leaveRoom');
    }
    
    // Chat functionality (for future implementation)
    sendChatMessage(message) {
        this.emit('chatMessage', {
            message: message,
            timestamp: Date.now()
        });
    }
    
    // Error handling
    handleNetworkError(error) {
        console.error('Network error:', error);
        this.status.lastError = error.message;
        
        // Show error to user
        if (window.game && window.game.showError) {
            window.game.showError(`Network error: ${error.message}`);
        }
    }
    
    // Connection quality monitoring
    startQualityMonitoring() {
        if (!this.connected) return;
        
        setInterval(() => {
            const latency = this.measureLatency();
            if (latency) {
                console.log(`Latency: ${latency}ms`);
                
                // Update connection quality indicator
                if (latency < 100) {
                    this.updateStatus('Connected (Good)', true);
                } else if (latency < 300) {
                    this.updateStatus('Connected (Fair)', true);
                } else {
                    this.updateStatus('Connected (Poor)', true);
                }
            }
        }, 5000);
    }
    
    // Initialize console manager
    initializeConsoleManager() {
        if (!this.consoleManager && typeof ConsoleManager !== 'undefined') {
            this.consoleManager = new ConsoleManager(this);
            console.log('[Network] Console manager initialized');
        }
    }
    
    // Cleanup
    cleanup() {
        if (this.consoleManager) {
            this.consoleManager.restoreConsole();
            this.consoleManager = null;
        }
        
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        
        this.eventHandlers.clear();
        this.connected = false;
        this.updateStatus('Disconnected', false);
    }
}

window.NetworkManager = NetworkManager;
