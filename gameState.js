class GameState {
    constructor(terrainGenerator = null) {
        this.players = new Map();
        this.pieces = new Map();
        this.coveringRelationships = new Map(); // coveringPieceId -> coveredPieceId
        this.nextPieceId = 1;
        this.gameStarted = false;
        this.terrainGenerator = terrainGenerator;
        
        // Change detection system
        this.changeCallback = null; // Callback to notify of any changes
    }
    
    // Set callback for change notifications
    setChangeCallback(callback) {
        this.changeCallback = callback;
    }
    
    // Trigger change notification
    notifyChange(changeType, data) {
        if (this.changeCallback) {
            this.changeCallback(changeType, data);
        }
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
        
        // Notify of game reset
        this.notifyChange('gameReset', {});
        
        console.log('[GameState] After reset - Pieces count:', this.pieces.size);
        console.log('[GameState] After reset - Players count:', this.players.size);
        console.log('[GameState] After reset - Covering relationships count:', this.coveringRelationships.size);
        console.log('[GameState] Game reset complete');
    }
    
    addPlayer(socketId, playerData) {
        console.log('[GameState] addPlayer called with:', socketId, playerData);
        
        try {
            // Check if player already exists
            if (this.players.has(socketId)) {
                console.log('[GameState] Player already exists, returning existing player');
                return this.players.get(socketId);
            }
            
            console.log('[GameState] Creating new player...');
            
            // Create new player
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
            
            console.log('[GameState] About to set player in players map...');
            this.players.set(socketId, player);
            console.log('[GameState] Player set in players map successfully');
            
            // Pieces should only be created in response to client requests, not automatically
            console.log('[GameState] Player joined - pieces will be created on client request');
            
            // Notify of player added
            console.log('[GameState] About to call notifyChange for playerAdded:', player.name);
            console.log('[GameState] Player pieces count:', player.pieces.length);
            console.log('[GameState] About to call notifyChange...');
            this.notifyChange('playerAdded', { player, pieces: player.pieces.map(id => this.pieces.get(id)) });
            console.log('[GameState] notifyChange for playerAdded completed');
            
            return player;
        } catch (error) {
            console.error('[GameState] ERROR in addPlayer:', error);
            throw error;
        }
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
    
    isValidSpawnPosition(x, z) {
        // Check if tile itself is blocked by terrain
        if (this.terrainGenerator && this.terrainGenerator.isTileBlocked(x, z)) {
            // Get detailed terrain info to determine if it's actually blocked by a tree or just steep slope
            const height = this.terrainGenerator.getHeight(x, z);
            const slope = this.terrainGenerator.calculateSlope ? 
                this.terrainGenerator.calculateSlope(x, z, height) : 0;
            
            // Allow spawning on steep slopes (up to 80°) but block on very steep (>80°) where trees grow
            if (slope > 80) {
                console.log(`[GameState] Spawn rejected at (${x}, ${z}): extremely steep slope (${slope.toFixed(1)}°) - likely tree location`);
                return false;
            }
            
            console.log(`[GameState] Spawn allowed at (${x}, ${z}): steep slope (${slope.toFixed(1)}°) but acceptable for pieces`);
            return true;
        }
        
        // If no terrain generator, allow any position
        return true;
    }
    
    getNextPlayerColor() {
        const colors = ['white', 'black', 'red', 'blue', 'green', 'yellow'];
        const usedColors = Array.from(this.players.values()).map(p => p.color);
        return colors.find(color => !usedColors.includes(color)) || 'white';
    }
    
    spawnInitialPieces(player) {
        console.log('[GameState] Spawning initial pieces for player:', player.name);
        
        // Find valid spawn positions (not blocked by trees)
        const validPositions = [];
        const searchRadius = 20;
        
        if (this.terrainGenerator) {
            for (let x = -searchRadius; x <= searchRadius; x++) {
                for (let z = -searchRadius; z <= searchRadius; z++) {
                    if (this.isValidSpawnPosition(x, z) && !this.getPieceAt(x, z)) {
                        validPositions.push({ x, z });
                    }
                }
            }
        }
        
        if (validPositions.length === 0) {
            console.log('[GameState] No valid spawn positions found - using fallback positions');
            // Fallback to random positions if no terrain generator or all blocked
            for (let i = 0; i < 50; i++) {
                const x = Math.floor(Math.random() * 40) - 20;
                const z = Math.floor(Math.random() * 40) - 20;
                if (!this.getPieceAt(x, z)) {
                    validPositions.push({ x, z });
                }
            }
        }
        
        console.log(`[GameState] Found ${validPositions.length} valid spawn positions`);
        
        // Pick a random valid position for the king (ensuring it's on a free square)
        const kingIndex = Math.floor(Math.random() * validPositions.length);
        const kingPos = validPositions[kingIndex];
        validPositions.splice(kingIndex, 1); // Remove used position
        
        // Spawn King first on a guaranteed free square
        const king = this.createPiece(player.id, 'king', kingPos.x, kingPos.z);
        player.kingPosition = { x: kingPos.x, z: kingPos.z };
        player.pieces.push(king.id);
        console.log('[GameState] Created king at valid position:', king);
        
        // Spawn initial army near the king (most valuable piece)
        const initialPieces = [
            { type: 'queen', value: 9 },    // Most valuable after king
            { type: 'rook', value: 5 },
            { type: 'bishop', value: 3 },
            { type: 'knight', value: 3 },
            { type: 'bishop', value: 3 },
            { type: 'knight', value: 3 },
            { type: 'rook', value: 5 },
            { type: 'pawn', value: 1 },
            { type: 'pawn', value: 1 },
            { type: 'pawn', value: 1 },
            { type: 'pawn', value: 1 },
            { type: 'pawn', value: 1 },
            { type: 'pawn', value: 1 },
            { type: 'pawn', value: 1 },
            { type: 'pawn', value: 1 }
        ];
        
        // Sort pieces by value (most valuable first) to spawn near king
        initialPieces.sort((a, b) => b.value - a.value);
        
        initialPieces.forEach((pieceData, pieceIndex) => {
            if (validPositions.length > 0) {
                // Find best position based on distance to king (most valuable piece)
                let bestPosition = null;
                let bestIndex = -1;
                let bestPriority = -1;
                
                validPositions.forEach((pos, index) => {
                    const distance = Math.sqrt(
                        Math.pow(pos.x - kingPos.x, 2) + 
                        Math.pow(pos.z - kingPos.z, 2)
                    );
                    
                    // Priority system: closer to king is better for valuable pieces
                    let priority = 0;
                    
                    // Highest priority: Very close (1-3 tiles away)
                    if (distance <= 3) {
                        priority = 100;
                    }
                    // Medium priority: Close (4-6 tiles away)
                    else if (distance <= 6) {
                        priority = 50;
                    }
                    // Low priority: Far (7+ tiles away)
                    else {
                        priority = 10;
                    }
                    
                    // Add small randomness within same priority level
                    const randomFactor = Math.random() * 0.5;
                    const adjustedPriority = priority + randomFactor;
                    
                    if (adjustedPriority > bestPriority) {
                        bestPriority = adjustedPriority;
                        bestPosition = pos;
                        bestIndex = index;
                    }
                });
                
                if (bestPosition) {
                    validPositions.splice(bestIndex, 1); // Remove used position
                    
                    const piece = this.createPiece(
                        player.id,
                        pieceData.type,
                        bestPosition.x,
                        bestPosition.z
                    );
                    player.pieces.push(piece.id);
                    const distance = Math.sqrt(
                        Math.pow(bestPosition.x - kingPos.x, 2) + 
                        Math.pow(bestPosition.z - kingPos.z, 2)
                    );
                    console.log(`[GameState] Created ${pieceData.type} at distance ${distance.toFixed(1)} from king (${bestPosition.x}, ${bestPosition.z}):`, piece);
                } else {
                    console.log(`[GameState] No valid positions left for ${pieceData.type}`);
                }
            } else {
                console.log(`[GameState] No valid positions left for ${pieceData.type}`);
            }
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
        
        // Notify of piece moved
        this.notifyChange('pieceMoved', { 
            piece, 
            capturedPiece, 
            pointsEarned: captureReward,
            fromX: piece.x, 
            fromZ: piece.z, 
            toX, 
            toZ 
        });
        
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
        
        // Notify of piece purchased
        this.notifyChange('piecePurchased', { piece: newPiece, player });
        
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
        
        // Search for valid spawn locations near king (most valuable piece)
        const searchRadius = 5; // Increased radius for more options
        const validLocations = [];
        
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                const x = player.kingPosition.x + dx;
                const z = player.kingPosition.z + dz;
                
                // Check if position is free and valid (not blocked by trees)
                const isOccupied = this.getPieceAt(x, z);
                
                if (!isOccupied && this.isValidSpawnPosition(x, z)) {
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    validLocations.push({ x, z, distance });
                }
            }
        }
        
        // Sort by distance to king (closest first) - spawn near most valuable piece
        validLocations.sort((a, b) => a.distance - b.distance);
        
        // Return the closest valid location
        return validLocations.length > 0 ? validLocations[0] : null;
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
        
        // Notify of covering change
        this.notifyChange('coveringSet', { 
            coveringPiece, 
            coveredPiece 
        });
        
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
