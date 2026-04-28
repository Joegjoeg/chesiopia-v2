class MoveValidator {
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
    
    validateMove(gameState, pieceId, fromX, fromZ, toX, toZ) {
        const piece = gameState.pieces.get(pieceId);
        if (!piece) {
            return { valid: false, reason: 'Piece not found' };
        }
        
        // Check if piece is on the expected position
        if (piece.x !== fromX || piece.z !== fromZ) {
            return { valid: false, reason: 'Piece not at expected position' };
        }
        
        // Check cooldown
        const cooldownTime = this.getCooldownTime(piece.type);
        if (Date.now() - piece.lastMoveTime < cooldownTime) {
            return { valid: false, reason: 'Piece still on cooldown' };
        }
        
        // Check if destination is within board bounds (infinite board, so no bounds check)
        
        // Check if destination is blocked by terrain (trees)
        if (gameState.terrainGenerator && gameState.terrainGenerator.isTileBlocked(toX, toZ)) {
            return { valid: false, reason: 'Destination tile is blocked by terrain' };
        }
        
        // Check if there's a friendly piece at destination
        const destPiece = gameState.getPieceAt(toX, toZ);
        if (destPiece && destPiece.playerId === piece.playerId) {
            return { valid: false, reason: 'Cannot move to friendly piece' };
        }
        
        // Check if move follows piece movement rules
        const validMoves = this.getValidMoves(gameState, piece);
        const isValidMove = validMoves.some(move => move.x === toX && move.z === toZ);
        
        if (!isValidMove) {
            return { valid: false, reason: 'Invalid move pattern' };
        }
        
        return { valid: true };
    }
    
    getValidMoves(gameState, piece) {
        const moves = [];
        const pattern = this.movePatterns[piece.type];
        
        if (!pattern) {
            return moves;
        }
        
        if (Array.isArray(pattern.moves)) {
            // Fixed distance moves
            pattern.moves.forEach(move => {
                const newX = piece.x + move.dx;
                const newZ = piece.z + move.dz;
                
                if (this.isValidDestination(gameState, piece, newX, newZ)) {
                    moves.push({ x: newX, z: newZ });
                }
            });
        } else {
            // Variable distance moves
            const directions = this.getDirections(pattern.moves);
            const range = pattern.range || 8;
            
            directions.forEach(dir => {
                for (let i = 1; i <= range; i++) {
                    const newX = piece.x + dir.dx * i;
                    const newZ = piece.z + dir.dz * i;
                    
                    // Check if tile is blocked by terrain (trees)
                    if (gameState.terrainGenerator && gameState.terrainGenerator.isTileBlocked(newX, newZ)) {
                        break;
                    }
                    
                    const destPiece = gameState.getPieceAt(newX, newZ);
                    if (destPiece) {
                        if (destPiece.playerId !== piece.playerId) {
                            // Can capture enemy piece
                            moves.push({ x: newX, z: newZ });
                        }
                        break; // Can't move past any piece
                    } else {
                        // Empty tile
                        moves.push({ x: newX, z: newZ });
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
    
    isValidDestination(gameState, piece, x, z) {
        // Check if tile is blocked by terrain (trees)
        if (gameState.terrainGenerator && gameState.terrainGenerator.isTileBlocked(x, z)) {
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
    
    isTileBlocked(gameState, x, z) {
        // Check if tile has a tree - pieces cannot move to squares with trees
        if (gameState.terrainGenerator && gameState.terrainGenerator.isTileBlocked(x, z)) {
            return true;
        }
        
        // Fallback to slope check for terrain-based blocking (if needed)
        const height = this.getTerrainHeight(gameState, x, z);
        const slope = this.calculateSlope(gameState, x, z, height);
        return slope > 60; // Degrees - increased to allow movement on reasonable terrain
    }
    
    getTerrainHeight(gameState, x, z) {
        // Simple height calculation - in full implementation, use terrain generator
        const scale = 0.02;
        const amplitude = 10;
        return Math.sin(x * scale) * Math.cos(z * scale) * amplitude;
    }
    
    calculateSlope(gameState, x, z, height) {
        const delta = 0.1;
        const h1 = this.getTerrainHeight(gameState, x + delta, z);
        const h2 = this.getTerrainHeight(gameState, x - delta, z);
        const h3 = this.getTerrainHeight(gameState, x, z + delta);
        const h4 = this.getTerrainHeight(gameState, x, z - delta);
        
        const dx = (h2 - h1) / (2 * delta);
        const dz = (h4 - h3) / (2 * delta);
        
        return Math.atan(Math.sqrt(dx * dx + dz * dz)) * (180 / Math.PI);
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
    
    canCapture(gameState, attacker, target) {
        if (attacker.playerId === target.playerId) {
            return false;
        }
        
        if (gameState.isCovered(target.id)) {
            return false;
        }
        
        const validMoves = this.getValidMoves(gameState, attacker);
        return validMoves.some(move => move.x === target.x && move.z === target.z);
    }
}

module.exports = MoveValidator;
