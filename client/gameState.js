class ClientGameState {
    constructor() {
        this.players = new Map();
        this.pieces = new Map();
        this.coveringRelationships = new Map();
        this.currentPlayerId = null;
        this.gameStarted = false;
        
        // Local state
        this.selectedPieceId = null;
        this.hoveredTile = null;
        this.cameraMode = 'strategic';
        
        // Event handlers
        this.eventHandlers = new Map();
    }
    
    updateState(serverState) {
        // Update players
        this.players.clear();
        serverState.players.forEach(player => {
            this.players.set(player.id, player);
        });
        
        // Update pieces
        this.pieces.clear();
        serverState.pieces.forEach(piece => {
            this.pieces.set(piece.id, piece);
        });
        
        // Update covering relationships
        this.coveringRelationships.clear();
        serverState.coveringRelationships.forEach(([coveringId, coveredId]) => {
            this.coveringRelationships.set(coveringId, coveredId);
        });
        
        this.gameStarted = serverState.gameStarted;
        
        // Emit state change event
        this.emit('stateChanged', this.getState());
    }
    
    getCurrentPlayer() {
        return this.players.get(this.currentPlayerId);
    }
    
    getCurrentPlayerId() {
        return this.currentPlayerId;
    }
    
    setCurrentPlayerId(playerId) {
        this.currentPlayerId = playerId;
        this.emit('currentPlayerChanged', playerId);
    }
    
    getCurrentPlayerKing() {
        const player = this.getCurrentPlayer();
        if (!player) return null;
        
        for (const pieceId of player.pieces) {
            const piece = this.pieces.get(pieceId);
            if (piece && piece.type === 'king') {
                return piece;
            }
        }
        
        return null;
    }
    
    getPlayer(playerId) {
        return this.players.get(playerId);
    }
    
    getAllPlayers() {
        return Array.from(this.players.values());
    }
    
    getPiece(pieceId) {
        return this.pieces.get(pieceId);
    }
    
    getAllPieces() {
        return Array.from(this.pieces.values());
    }
    
    getPiecesForPlayer(playerId) {
        const player = this.players.get(playerId);
        if (!player) return [];
        
        return player.pieces.map(pieceId => this.pieces.get(pieceId)).filter(Boolean);
    }
    
    getPieceAt(x, z) {
        for (const piece of this.pieces.values()) {
            if (piece.x === x && piece.z === z) {
                return piece;
            }
        }
        return null;
    }
    
    isCovered(pieceId) {
        for (const [coveringId, coveredId] of this.coveringRelationships) {
            if (coveredId === pieceId) return true;
        }
        return false;
    }
    
    getCoveringPiece(coveredPieceId) {
        for (const [coveringId, coveredId] of this.coveringRelationships) {
            if (coveredId === coveredPieceId) {
                return this.pieces.get(coveringId);
            }
        }
        return null;
    }
    
    getCoveredPiece(coveringPieceId) {
        const coveredId = this.coveringRelationships.get(coveringPieceId);
        return coveredId ? this.pieces.get(coveredId) : null;
    }
    
    selectPiece(pieceId) {
        this.selectedPieceId = pieceId;
        this.emit('pieceSelected', pieceId);
    }
    
    getSelectedPiece() {
        return this.selectedPieceId ? this.pieces.get(this.selectedPieceId) : null;
    }
    
    deselectPiece() {
        this.selectedPieceId = null;
        this.emit('pieceDeselected');
    }
    
    setHoveredTile(x, z) {
        this.hoveredTile = { x, z };
        this.emit('tileHovered', { x, z });
    }
    
    getHoveredTile() {
        return this.hoveredTile;
    }
    
    setCameraMode(mode) {
        this.cameraMode = mode;
        this.emit('cameraModeChanged', mode);
    }
    
    getCameraMode() {
        return this.cameraMode;
    }
    
    // Piece validation
    canPlayerAffordPiece(playerId, pieceType) {
        const player = this.players.get(playerId);
        if (!player) return false;
        
        const costs = {
            pawn: 2,
            knight: 6,
            bishop: 6,
            rook: 10,
            queen: 18
        };
        
        const cost = costs[pieceType];
        return cost && player.points.total >= cost;
    }
    
    canPlayerPurchasePiece(playerId) {
        const player = this.players.get(playerId);
        return player && player.pieces.length < 20;
    }
    
    getPieceCost(pieceType) {
        const costs = {
            pawn: 2,
            knight: 6,
            bishop: 6,
            rook: 10,
            queen: 18
        };
        
        return costs[pieceType] || 0;
    }
    
    getPieceValue(pieceType) {
        const values = {
            pawn: 1,
            knight: 3,
            bishop: 3,
            rook: 5,
            queen: 9,
            king: 1000
        };
        
        return values[pieceType] || 0;
    }
    
    getPieceCooldown(pieceType) {
        const cooldowns = {
            pawn: 2000,
            knight: 3000,
            bishop: 3000,
            rook: 4000,
            queen: 6000,
            king: 2000
        };
        
        return cooldowns[pieceType] || 2000;
    }
    
    isPieceOnCooldown(piece) {
        const cooldownTime = this.getPieceCooldown(piece.type);
        const timeSinceMove = Date.now() - (piece.lastMoveTime || 0);
        return timeSinceMove < cooldownTime;
    }
    
    getPieceCooldownRemaining(piece) {
        const cooldownTime = this.getPieceCooldown(piece.type);
        const timeSinceMove = Date.now() - (piece.lastMoveTime || 0);
        return Math.max(0, cooldownTime - timeSinceMove);
    }
    
    // Game state queries
    isGameOver() {
        // Check if any player has no king
        for (const [playerId, player] of this.players) {
            const hasKing = player.pieces.some(pieceId => {
                const piece = this.pieces.get(pieceId);
                return piece && piece.type === 'king';
            });
            
            if (!hasKing) {
                return {
                    gameOver: true,
                    loser: player,
                    winner: this.getWinningPlayer()
                };
            }
        }
        
        return { gameOver: false };
    }
    
    getWinningPlayer() {
        let winner = null;
        let maxPoints = -1;
        
        for (const player of this.players.values()) {
            if (player.points.total > maxPoints) {
                maxPoints = player.points.total;
                winner = player;
            }
        }
        
        return winner;
    }
    
    getLeaderboard() {
        return Array.from(this.players.values())
            .sort((a, b) => b.points.total - a.points.total)
            .map((player, index) => ({
                rank: index + 1,
                name: player.name,
                color: player.color,
                points: player.points.total,
                captures: player.points.captures,
                pieces: player.pieces.length
            }));
    }
    
    // State serialization
    getState() {
        return {
            players: Array.from(this.players.values()),
            pieces: Array.from(this.pieces.values()),
            coveringRelationships: Array.from(this.coveringRelationships.entries()),
            currentPlayerId: this.currentPlayerId,
            selectedPieceId: this.selectedPieceId,
            hoveredTile: this.hoveredTile,
            cameraMode: this.cameraMode,
            gameStarted: this.gameStarted
        };
    }
    
    // Local storage
    saveToLocalStorage() {
        try {
            const state = {
                playerName: this.getCurrentPlayer()?.name,
                playerColor: this.getCurrentPlayer()?.color,
                cameraMode: this.cameraMode,
                lastSaved: Date.now()
            };
            
            localStorage.setItem('chessopia_save', JSON.stringify(state));
        } catch (error) {
            console.warn('Failed to save state to localStorage:', error);
        }
    }
    
    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('chessopia_save');
            if (saved) {
                const state = JSON.parse(saved);
                
                // Apply saved settings
                if (state.playerName && this.currentPlayerId) {
                    const player = this.players.get(this.currentPlayerId);
                    if (player) {
                        player.name = state.playerName;
                    }
                }
                
                if (state.cameraMode) {
                    this.cameraMode = state.cameraMode;
                    this.emit('cameraModeChanged', state.cameraMode);
                }
                
                return true;
            }
        } catch (error) {
            console.warn('Failed to load state from localStorage:', error);
        }
        
        return false;
    }
    
    // Event system
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }
    
    off(event, handler) {
        if (this.eventHandlers.has(event)) {
            const handlers = this.eventHandlers.get(event);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }
    
    // Cleanup
    cleanup() {
        this.players.clear();
        this.pieces.clear();
        this.coveringRelationships.clear();
        this.eventHandlers.clear();
        
        this.currentPlayerId = null;
        this.selectedPieceId = null;
        this.hoveredTile = null;
        this.gameStarted = false;
    }
}
