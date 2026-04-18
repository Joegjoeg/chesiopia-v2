class GameState {
    constructor() {
        this.players = new Map();
        this.pieces = new Map();
        this.coveringRelationships = new Map(); // coveringPieceId -> coveredPieceId
        this.nextPieceId = 1;
        this.gameStarted = false;
    }
    
    // Temporary method to clear accumulated pieces
    resetGame() {
        console.log('[GameState] Resetting game - clearing all pieces and players');
        console.log('[GameState] Before reset - Pieces count:', this.pieces.size);
        console.log('[GameState] Before reset - Players count:', this.players.size);
        console.log('[GameState] Before reset - Covering relationships count:', this.coveringRelationships.size);
        
        // Clear everything
        this.players.clear();
        this.pieces.clear();
        this.coveringRelationships.clear();
        this.nextPieceId = 1;
        this.gameStarted = false;
        
        console.log('[GameState] After reset - Pieces count:', this.pieces.size);
        console.log('[GameState] After reset - Players count:', this.players.size);
        console.log('[GameState] After reset - Covering relationships count:', this.coveringRelationships.size);
        console.log('[GameState] Game reset complete');
    }
    
    addPlayer(socketId, playerData) {
        const player = {
            id: socketId,
            name: playerData.name || `Player ${this.players.size + 1}`,
            color: this.getNextPlayerColor(),
            points: {
                total: 50, // Starting points - increased for testing
                captures: 0
            },
            pieces: [],
            isReady: false,
            kingPosition: null
        };
        
        this.players.set(socketId, player);
        
        // Spawn initial pieces for the player
        this.spawnInitialPieces(player);
        
        return player;
    }
    
    removePlayer(socketId) {
        const player = this.players.get(socketId);
        if (player) {
            // Remove all player's pieces
            player.pieces.forEach(pieceId => {
                this.pieces.delete(pieceId);
            });
            this.players.delete(socketId);
        }
    }
    
    getNextPlayerColor() {
        const colors = ['white', 'black', 'red', 'blue', 'green', 'yellow'];
        const usedColors = Array.from(this.players.values()).map(p => p.color);
        return colors.find(color => !usedColors.includes(color)) || 'white';
    }
    
    spawnInitialPieces(player) {
        console.log('[GameState] Spawning initial pieces for player:', player.name);
        // Find a suitable spawn location
        const spawnX = Math.floor(Math.random() * 20) - 10;
        const spawnZ = Math.floor(Math.random() * 20) - 10;
        console.log('[GameState] Spawn location:', spawnX, spawnZ);
        
        // Spawn King first
        const king = this.createPiece(player.id, 'king', spawnX, spawnZ);
        player.kingPosition = { x: spawnX, z: spawnZ };
        player.pieces.push(king.id);
        console.log('[GameState] Created king:', king);
        
        // Spawn initial army - reduced for testing
        const initialPieces = [
            { type: 'pawn', offset: { x: 1, z: 0 } },
            { type: 'pawn', offset: { x: -1, z: 0 } }
        ];
        
        initialPieces.forEach(pieceData => {
            const piece = this.createPiece(
                player.id,
                pieceData.type,
                spawnX + pieceData.offset.x,
                spawnZ + pieceData.offset.z
            );
            player.pieces.push(piece.id);
            console.log('[GameState] Created piece:', piece);
        });
        console.log('[GameState] Total pieces for player:', player.pieces.length);
    }
    
    createPiece(playerId, type, x, z) {
        const piece = {
            id: this.nextPieceId++,
            playerId: playerId,
            type: type,
            x: x,
            z: z,
            lastMoveTime: 0,
            isCovered: false,
            cooldowns: {
                pawn: 2000,
                knight: 3000,
                bishop: 3000,
                rook: 4000,
                queen: 6000,
                king: 2000
            }
        };
        
        this.pieces.set(piece.id, piece);
        return piece;
    }
    
    executeMove(pieceId, toX, toZ) {
        const piece = this.pieces.get(pieceId);
        if (!piece) {
            return { success: false, reason: 'Piece not found' };
        }
        
        // Check for capture
        const capturedPiece = this.getPieceAt(toX, toZ);
        let captureReward = 0;
        
        if (capturedPiece) {
            // Check if captured piece is covered
            if (this.isCovered(capturedPiece.id)) {
                return { success: false, reason: 'Cannot capture covered piece' };
            }
            
            // Award points for capture
            const pieceValues = {
                pawn: 1,
                knight: 3,
                bishop: 3,
                rook: 5,
                queen: 9,
                king: 1000
            };
            
            captureReward = pieceValues[capturedPiece.type] || 0;
            
            // Remove captured piece
            this.removePiece(capturedPiece.id);
            
            // Update player points
            const player = this.players.get(piece.playerId);
            if (player) {
                player.points.total += captureReward;
                player.points.captures++;
            }
        }
        
        // Move piece
        piece.x = toX;
        piece.z = toZ;
        piece.lastMoveTime = Date.now();
        
        // Update king position if necessary
        const player = this.players.get(piece.playerId);
        if (player && piece.type === 'king') {
            player.kingPosition = { x: toX, z: toZ };
        }
        
        return {
            success: true,
            piece: piece,
            capturedPiece: capturedPiece,
            pointsEarned: captureReward
        };
    }
    
    purchasePiece(playerId, pieceType) {
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, reason: 'Player not found' };
        }
        
        // Check piece costs
        const pieceCosts = {
            pawn: 2,
            knight: 6,
            bishop: 6,
            rook: 10,
            queen: 18
        };
        
        const cost = pieceCosts[pieceType];
        if (!cost) {
            return { success: false, reason: 'Invalid piece type' };
        }
        
        if (player.points.total < cost) {
            return { success: false, reason: 'Insufficient points' };
        }
        
        if (player.pieces.length >= 20) {
            return { success: false, reason: 'Maximum pieces reached' };
        }
        
        // Deduct points
        player.points.total -= cost;
        
        // Find spawn location near king
        const spawnPos = this.findSpawnLocation(player);
        if (!spawnPos) {
            return { success: false, reason: 'No valid spawn location' };
        }
        
        // Create new piece
        const newPiece = this.createPiece(playerId, pieceType, spawnPos.x, spawnPos.z);
        player.pieces.push(newPiece.id);
        
        return {
            success: true,
            piece: newPiece,
            remainingPoints: player.points.total
        };
    }
    
    findSpawnLocation(player) {
        if (!player.kingPosition) {
            return null;
        }
        
        // Search for valid spawn location near king
        const searchRadius = 3;
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                const x = player.kingPosition.x + dx;
                const z = player.kingPosition.z + dz;
                
                if (!this.getPieceAt(x, z)) {
                    return { x, z };
                }
            }
        }
        
        return null;
    }
    
    setCovering(coveringPieceId, coveredPieceId) {
        const coveringPiece = this.pieces.get(coveringPieceId);
        const coveredPiece = this.pieces.get(coveredPieceId);
        
        if (!coveringPiece || !coveredPiece) {
            return { success: false, reason: 'Piece not found' };
        }
        
        if (coveringPiece.playerId !== coveredPiece.playerId) {
            return { success: false, reason: 'Can only cover friendly pieces' };
        }
        
        // Remove any existing coverage for the covering piece
        this.removeCovering(coveringPieceId);
        
        // Set new coverage
        this.coveringRelationships.set(coveringPieceId, coveredPieceId);
        coveredPiece.isCovered = true;
        
        return {
            success: true,
            coveringPiece: coveringPiece,
            coveredPiece: coveredPiece
        };
    }
    
    removeCovering(coveringPieceId) {
        const coveredPieceId = this.coveringRelationships.get(coveringPieceId);
        if (coveredPieceId) {
            const coveredPiece = this.pieces.get(coveredPieceId);
            if (coveredPiece) {
                coveredPiece.isCovered = false;
            }
            this.coveringRelationships.delete(coveringPieceId);
        }
    }
    
    isCovered(pieceId) {
        for (const [coveringId, coveredId] of this.coveringRelationships) {
            if (coveredId === pieceId) return true;
        }
        return false;
    }
    
    getPieceAt(x, z) {
        for (const piece of this.pieces.values()) {
            if (piece.x === x && piece.z === z) {
                return piece;
            }
        }
        return null;
    }
    
    removePiece(pieceId) {
        const piece = this.pieces.get(pieceId);
        if (piece) {
            // Remove from player's piece list
            const player = this.players.get(piece.playerId);
            if (player) {
                const index = player.pieces.indexOf(pieceId);
                if (index > -1) {
                    player.pieces.splice(index, 1);
                }
            }
            
            // Remove any coverage relationships
            this.removeCovering(pieceId);
            
            // Remove the piece
            this.pieces.delete(pieceId);
        }
    }
    
    checkGameOver() {
        // Check if any player has no king
        for (const [playerId, player] of this.players) {
            const hasKing = player.pieces.some(pieceId => {
                const piece = this.pieces.get(pieceId);
                return piece && piece.type === 'king';
            });
            
            if (!hasKing) {
                return {
                    gameOver: true,
                    winner: this.getWinningPlayer(),
                    reason: `${player.name} lost their king`
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
    
    getState() {
        return {
            players: Array.from(this.players.values()),
            pieces: Array.from(this.pieces.values()),
            coveringRelationships: Array.from(this.coveringRelationships.entries()),
            gameStarted: this.gameStarted
        };
    }
}

module.exports = GameState;
