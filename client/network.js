class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.eventHandlers = new Map();
        
        // Connection status
        this.status = {
            connected: false,
            text: 'Disconnected',
            lastError: null
        };
    }
    
    async connect() {
        try {
            this.updateStatus('Connecting...', false);
            console.log('[Network] Starting connection to localhost:3000...');
            
            // Connect to server
            this.socket = io('localhost:3000', {
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
                    this.onConnected();
                    this.updateConnectionDebug('Connected to server successfully');
                    resolve();
                });
                
                this.socket.on('connect_error', (error) => {
                    console.error('[Network] Socket.IO connection error:', error);
                    clearTimeout(timeout);
                    this.onConnectionError(error);
                    this.updateConnectionDebug('Connection error: ' + error.message);
                    reject(error);
                });
                
                this.socket.on('disconnect', (reason) => {
                    console.log('[Network] Socket.IO disconnected:', reason);
                    this.updateConnectionDebug('Disconnected: ' + reason);
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
        
        // Game events - with debug logging
        this.socket.on('gameState', (data) => {
            console.log('[Network] === RECEIVED GAME STATE EVENT ===');
            console.log('[Network] Game state data:', data);
            this.triggerEvent('gameState', data);
        });
        
        this.socket.on('pieceMoved', (data) => {
            console.log('[Network] Received pieceMoved event:', data);
            this.triggerEvent('pieceMoved', data);
        });
        
        this.socket.on('pieceAdded', (data) => {
            console.log('[Network] === PIECE ADDED EVENT RECEIVED ===');
            console.log('[Network] Piece data:', data);
            console.log('[Network] Socket ID:', this.socket.id);
            this.triggerEvent('pieceAdded', data);
        });
        
        this.socket.on('piecePurchased', (data) => {
            console.log('[Network] Received piecePurchased event:', data);
            this.triggerEvent('piecePurchased', data);
        });
        
        this.socket.on('playerJoined', (data) => {
            console.log('[Network] Received playerJoined event:', data);
            this.triggerEvent('playerJoined', data);
        });
        
        this.socket.on('playerDisconnected', (data) => {
            console.log('[Network] Received playerDisconnected event:', data);
            this.triggerEvent('playerDisconnected', data);
        });
        
        this.socket.on('gameOver', (data) => {
            console.log('[Network] Received gameOver event:', data);
            this.triggerEvent('gameOver', data);
        });
        
        this.socket.on('moveInvalid', (data) => {
            console.log('[Network] Received moveInvalid event:', data);
            this.triggerEvent('moveInvalid', data);
        });
        
        this.socket.on('purchaseFailed', (data) => {
            console.log('[Network] Received purchaseFailed event:', data);
            this.triggerEvent('purchaseFailed', data);
        });
        
        this.socket.on('coveringSet', (data) => {
            console.log('[Network] Received coveringSet event:', data);
            this.triggerEvent('coveringSet', data);
        });
        
        this.socket.on('coveringFailed', (data) => {
            console.log('[Network] Received coveringFailed event:', data);
            this.triggerEvent('coveringFailed', data);
        });
        
        // Error events
        this.socket.on('error', (error) => {
            console.log('[Network] Received error event:', error);
            this.onError(error);
        });
        
        // Debug: Catch-all event listener to see what we receive
        this.socket.onAny((eventName, ...args) => {
            console.log('[Network] ANY EVENT:', eventName, args);
        });
        
        console.log('[Network] All socket events set up');
    }
    
    onConnected() {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.updateStatus('Connected', true);
        this.updateConnectionDebug('Socket connected - joining game...');
        
        // Join game
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
    
    movePiece(pieceId, fromX, fromZ, toX, toZ) {
        this.emit('movePiece', {
            pieceId: pieceId,
            fromX: fromX,
            fromZ: fromZ,
            toX: toX,
            toZ: toZ
        });
    }
    
    purchasePiece(pieceType, playerId) {
        this.emit('purchasePiece', {
            pieceType: pieceType,
            playerId: playerId
        });
    }
    
    setCovering(coveringPieceId, coveredPieceId) {
        this.emit('setCovering', {
            coveringPieceId: coveringPieceId,
            coveredPieceId: coveredPieceId
        });
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
        
        // Update UI
        const statusEl = document.getElementById('connectionStatus');
        const statusText = document.getElementById('statusText');
        
        if (statusEl && statusText) {
            statusText.textContent = text;
            statusEl.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
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
    
    // Spectator mode
    spectateGame(gameId) {
        this.emit('spectate', { gameId });
    }
    
    stopSpectating() {
        this.emit('stopSpectating');
    }
    
    // Game state requests
    requestGameState() {
        this.emit('requestGameState');
    }
    
    requestPlayerList() {
        this.emit('requestPlayerList');
    }
    
    // Temporary reset command
    resetGame() {
        console.log('[Network] Requesting game reset from client');
        console.log('[Network] Socket connected:', this.connected);
        console.log('[Network] Socket ID:', this.socket?.id);
        this.emit('resetGame');
        console.log('[Network] Reset request sent to server');
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
    
    // Cleanup
    cleanup() {
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
