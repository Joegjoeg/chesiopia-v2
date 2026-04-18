class ClientMoveValidator {
    constructor() {
        this.pieceValues = {
            pawn: 1,
            knight: 3,
            bishop: 3,
            rook: 5,
            queen: 9,
            king: 1000
        };
        
        this.movePatterns = {
            pawn: {
                moves: [
                    { dx: 0, dz: 1 },  // North
                    { dx: 0, dz: -1 }, // South
                    { dx: 1, dz: 0 },  // East
                    { dx: -1, dz: 0 }  // West
                ],
                captures: [
                    { dx: 1, dz: 1 },   // NE
                    { dx: 1, dz: -1 },  // SE
                    { dx: -1, dz: 1 },  // NW
                    { dx: -1, dz: -1 }  // SW
                ]
            },
            knight: {
                moves: [
                    { dx: 2, dz: 1 }, { dx: 2, dz: -1 },
                    { dx: -2, dz: 1 }, { dx: -2, dz: -1 },
                    { dx: 1, dz: 2 }, { dx: 1, dz: -2 },
                    { dx: -1, dz: 2 }, { dx: -1, dz: -2 }
                ]
            },
            bishop: {
                moves: 'diagonal',
                range: 8
            },
            rook: {
                moves: 'straight',
                range: 8
            },
            queen: {
                moves: 'both',
                range: 8
            },
            king: {
                moves: [
                    { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
                    { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
                    { dx: 1, dz: 1 }, { dx: 1, dz: -1 },
                    { dx: -1, dz: 1 }, { dx: -1, dz: -1 }
                ]
            }
        };
    }
    
    validateMove(gameState, piece, toX, toZ, terrainSystem) {
        // Check if piece exists
        if (!piece) {
            return { valid: false, reason: 'Piece not found' };
        }
        
        // Check if move is within board bounds (infinite board, so no bounds check)
        
        // Check if destination is blocked by terrain
        if (terrainSystem && terrainSystem.isTileBlocked(toX, toZ)) {
            return { valid: false, reason: 'Destination tile is blocked by terrain' };
        }
        
        // Check if there's a friendly piece at destination
        const destPiece = gameState.getPieceAt(toX, toZ);
        if (destPiece && destPiece.playerId === piece.playerId) {
            return { valid: false, reason: 'Cannot move to friendly piece' };
        }
        
        // Check if move follows piece movement rules
        const validMoves = this.getValidMoves(gameState, piece, terrainSystem);
        const isValidMove = validMoves.some(move => move.x === toX && move.z === toZ);
        
        if (!isValidMove) {
            return { valid: false, reason: 'Invalid move pattern' };
        }
        
        // Check cooldown
        if (this.isPieceOnCooldown(piece)) {
            return { valid: false, reason: 'Piece is on cooldown' };
        }
        
        // Check if trying to capture covered piece
        if (destPiece && gameState.isCovered(destPiece.id)) {
            return { valid: false, reason: 'Cannot capture covered piece' };
        }
        
        return { valid: true };
    }
    
    getValidMoves(gameState, piece, terrainSystem) {
        const moves = [];
        const pattern = this.movePatterns[piece.type];
        
        if (!pattern) {
            return moves;
        }
        
        if (Array.isArray(pattern.moves)) {
            // Fixed distance moves (pawns, knights, kings)
            pattern.moves.forEach(move => {
                const newX = piece.x + move.dx;
                const newZ = piece.z + move.dz;
                
                if (this.isValidDestination(gameState, piece, newX, newZ, terrainSystem)) {
                    const destPiece = gameState.getPieceAt(newX, newZ);
                    moves.push({
                        x: newX,
                        z: newZ,
                        isCapture: destPiece && destPiece.playerId !== piece.playerId
                    });
                }
            });
        } else {
            // Variable distance moves (bishops, rooks, queens)
            const directions = this.getDirections(pattern.moves);
            const range = pattern.range || 8;
            
            directions.forEach(dir => {
                for (let i = 1; i <= range; i++) {
                    const newX = piece.x + dir.dx * i;
                    const newZ = piece.z + dir.dz * i;
                    
                    // Check if tile is blocked by terrain
                    if (terrainSystem && terrainSystem.isTileBlocked(newX, newZ)) {
                        break;
                    }
                    
                    const destPiece = gameState.getPieceAt(newX, newZ);
                    if (destPiece) {
                        if (destPiece.playerId !== piece.playerId) {
                            // Can capture enemy piece (unless covered)
                            if (!gameState.isCovered(destPiece.id)) {
                                moves.push({
                                    x: newX,
                                    z: newZ,
                                    isCapture: true
                                });
                            }
                        }
                        break; // Can't move past any piece
                    } else {
                        // Empty tile
                        moves.push({
                            x: newX,
                            z: newZ,
                            isCapture: false
                        });
                    }
                }
            });
        }
        
        return moves;
    }
    
    getDirections(moveType) {
        switch (moveType) {
            case 'straight':
                return [
                    { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
                    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }
                ];
            case 'diagonal':
                return [
                    { dx: 1, dz: 1 }, { dx: 1, dz: -1 },
                    { dx: -1, dz: 1 }, { dx: -1, dz: -1 }
                ];
            case 'both':
                return [
                    { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
                    { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
                    { dx: 1, dz: 1 }, { dx: 1, dz: -1 },
                    { dx: -1, dz: 1 }, { dx: -1, dz: -1 }
                ];
            default:
                return [];
        }
    }
    
    isValidDestination(gameState, piece, x, z, terrainSystem) {
        // Check if tile is blocked by terrain
        if (terrainSystem && terrainSystem.isTileBlocked(x, z)) {
            return false;
        }
        
        // Check if there's a piece at destination
        const destPiece = gameState.getPieceAt(x, z);
        if (destPiece) {
            // Can't move to friendly piece
            if (destPiece.playerId === piece.playerId) {
                return false;
            }
            // Can capture enemy piece (unless covered)
            if (gameState.isCovered(destPiece.id)) {
                return false;
            }
        }
        
        return true;
    }
    
    isPieceOnCooldown(piece) {
        const cooldowns = {
            pawn: 2000,
            knight: 3000,
            bishop: 3000,
            rook: 4000,
            queen: 6000,
            king: 2000
        };
        
        const cooldownTime = cooldowns[piece.type] || 2000;
        const timeSinceMove = Date.now() - (piece.lastMoveTime || 0);
        return timeSinceMove < cooldownTime;
    }
    
    getCooldownTime(pieceType) {
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
    
    getCooldownRemaining(piece) {
        const cooldownTime = this.getCooldownTime(piece.type);
        const timeSinceMove = Date.now() - (piece.lastMoveTime || 0);
        return Math.max(0, cooldownTime - timeSinceMove);
    }
    
    canCapture(gameState, attacker, target, terrainSystem) {
        if (attacker.playerId === target.playerId) {
            return false;
        }
        
        if (gameState.isCovered(target.id)) {
            return false;
        }
        
        const validMoves = this.getValidMoves(gameState, attacker, terrainSystem);
        return validMoves.some(move => move.x === target.x && move.z === target.z);
    }
    
    // Check if two pieces can cover each other (line of sight)
    canCover(gameState, coveringPiece, coveredPiece, terrainSystem) {
        // Can only cover friendly pieces
        if (coveringPiece.playerId !== coveredPiece.playerId) {
            return false;
        }
        
        // Check if pieces are in line of sight
        return this.hasLineOfSight(
            coveringPiece.x,
            coveringPiece.z,
            coveredPiece.x,
            coveredPiece.z,
            gameState,
            terrainSystem
        );
    }
    
    hasLineOfSight(fromX, fromZ, toX, toZ, gameState, terrainSystem) {
        const dx = toX - fromX;
        const dz = toZ - fromZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const steps = Math.ceil(distance);
        
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const checkX = fromX + dx * t;
            const checkZ = fromZ + dz * t;
            
            // Check if intermediate tile is blocked by terrain
            if (terrainSystem && terrainSystem.isTileBlocked(
                Math.floor(checkX),
                Math.floor(checkZ)
            )) {
                return false;
            }
            
            // Check if there's a piece blocking path
            const blockingPiece = gameState.getPieceAt(
                Math.floor(checkX),
                Math.floor(checkZ)
            );
            if (blockingPiece) {
                return false;
            }
        }
        
        return true;
    }
    
    // Get pieces that can be covered by a given piece
    getCoverablePieces(gameState, piece, terrainSystem) {
        const coverable = [];
        const playerPieces = gameState.getPiecesForPlayer(piece.playerId);
        
        playerPieces.forEach(targetPiece => {
            if (targetPiece.id !== piece.id && this.canCover(gameState, piece, targetPiece, terrainSystem)) {
                coverable.push(targetPiece);
            }
        });
        
        return coverable;
    }
    
    // Get pieces that can cover a given piece
    getCoveringPieces(gameState, piece, terrainSystem) {
        const covering = [];
        const playerPieces = gameState.getPiecesForPlayer(piece.playerId);
        
        playerPieces.forEach(coveringPiece => {
            if (coveringPiece.id !== piece.id && this.canCover(gameState, coveringPiece, piece, terrainSystem)) {
                covering.push(coveringPiece);
            }
        });
        
        return covering;
    }
    
    // Check if a move would break coverage
    wouldBreakCoverage(gameState, piece, toX, toZ, coveringRelationships) {
        // Check if this piece is currently covering something
        for (const [coveringId, coveredId] of coveringRelationships) {
            if (coveringId === piece.id) {
                const coveredPiece = gameState.getPiece(coveredId);
                if (coveredPiece) {
                    // Check if moving would break line of sight
                    return !this.hasLineOfSight(
                        toX,
                        toZ,
                        coveredPiece.x,
                        coveredPiece.z,
                        gameState,
                        null // Don't check terrain for coverage breaking
                    );
                }
            }
        }
        
        return false;
    }
    
    // Get all pieces threatening a given tile
    getThreateningPieces(gameState, x, z, terrainSystem) {
        const threats = [];
        
        for (const piece of gameState.getAllPieces()) {
            const validMoves = this.getValidMoves(gameState, piece, terrainSystem);
            if (validMoves.some(move => move.x === x && move.z === z)) {
                threats.push(piece);
            }
        }
        
        return threats;
    }
    
    // Check if a piece is under attack
    isUnderAttack(gameState, piece, terrainSystem) {
        const threats = this.getThreateningPieces(
            gameState,
            piece.x,
            piece.z,
            terrainSystem
        );
        
        return threats.some(threat => threat.playerId !== piece.playerId);
    }
    
    // Get safe squares for a piece (not under attack)
    getSafeSquares(gameState, piece, terrainSystem) {
        const validMoves = this.getValidMoves(gameState, piece, terrainSystem);
        const safeMoves = [];
        
        validMoves.forEach(move => {
            // Simulate move
            const originalX = piece.x;
            const originalZ = piece.z;
            
            piece.x = move.x;
            piece.z = move.z;
            
            // Check if piece would be under attack at new position
            if (!this.isUnderAttack(gameState, piece, terrainSystem)) {
                safeMoves.push(move);
            }
            
            // Restore original position
            piece.x = originalX;
            piece.z = originalZ;
        });
        
        return safeMoves;
    }
    
    // Evaluate position (simple material count)
    evaluatePosition(gameState, playerId) {
        let score = 0;
        
        for (const piece of gameState.getAllPieces()) {
            const value = this.pieceValues[piece.type] || 0;
            if (piece.playerId === playerId) {
                score += value;
            } else {
                score -= value;
            }
        }
        
        return score;
    }
}
