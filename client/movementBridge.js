class MovementBridge {
    constructor(gameState, boardSystem) {
        this.gameState = gameState;
        this.boardSystem = boardSystem;
        this.moveCache = new Map();
        this.cacheTimeout = 5000; // 5 seconds
    }
    
    getValidMovesForPiece(piece) {
        const cacheKey = `${piece.id}_${piece.x}_${piece.z}_${piece.lastMoveTime}`;
        
        // Check cache first
        const cached = this.moveCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.moves;
        }
        
        // Calculate valid moves
        const moves = this.calculateValidMoves(piece);
        
        // Cache the result
        this.moveCache.set(cacheKey, {
            moves: moves,
            timestamp: Date.now()
        });
        
        // Clean old cache entries
        this.cleanCache();
        
        return moves;
    }
    
    calculateValidMoves(piece) {
        const moves = [];
        const pattern = this.getMovementPattern(piece.type);
        
        if (!pattern) {
            return moves;
        }
        
        if (Array.isArray(pattern.moves)) {
            // Fixed distance moves (pawns, knights, kings)
            pattern.moves.forEach(move => {
                const newX = piece.x + move.dx;
                const newZ = piece.z + move.dz;
                
                if (this.isValidMove(piece, newX, newZ)) {
                    const height = this.boardSystem.getTileHeight(newX, newZ);
                    moves.push({
                        x: newX,
                        z: newZ,
                        height: height,
                        isCapture: this.isCaptureMove(piece, newX, newZ)
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
                    if (this.boardSystem.isTileBlocked(newX, newZ)) {
                        break;
                    }
                    
                    // Check for pieces
                    const targetPiece = this.gameState.getPieceAt(newX, newZ);
                    if (targetPiece) {
                        if (targetPiece.playerId !== piece.playerId) {
                            // Can capture enemy piece (unless covered)
                            if (!this.gameState.isCovered(targetPiece.id)) {
                                const height = this.boardSystem.getTileHeight(newX, newZ);
                                moves.push({
                                    x: newX,
                                    z: newZ,
                                    height: height,
                                    isCapture: true
                                });
                            }
                        }
                        break; // Can't move past any piece
                    } else {
                        // Empty tile
                        const height = this.boardSystem.getTileHeight(newX, newZ);
                        moves.push({
                            x: newX,
                            z: newZ,
                            height: height,
                            isCapture: false
                        });
                    }
                }
            });
        }
        
        return moves;
    }
    
    getMovementPattern(pieceType) {
        const patterns = {
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
        
        return patterns[pieceType];
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
    
    isValidMove(piece, x, z) {
        // Check if tile is blocked by terrain
        if (this.boardSystem.isTileBlocked(x, z)) {
            return false;
        }
        
        // Check if there's a piece at destination
        const destPiece = this.gameState.getPieceAt(x, z);
        if (destPiece) {
            // Can't move to friendly piece
            if (destPiece.playerId === piece.playerId) {
                return false;
            }
            // Can capture enemy piece (unless covered)
            if (this.gameState.isCovered(destPiece.id)) {
                return false;
            }
        }
        
        // Check cooldown
        if (this.isPieceOnCooldown(piece)) {
            return false;
        }
        
        return true;
    }
    
    isCaptureMove(piece, x, z) {
        const targetPiece = this.gameState.getPieceAt(x, z);
        return targetPiece && targetPiece.playerId !== piece.playerId;
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
    
    getPieceCooldown(piece) {
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
        return Math.max(0, cooldownTime - timeSinceMove);
    }
    
    // 3D coordinate translation
    worldToTile(worldPosition) {
        return {
            x: Math.floor(worldPosition.x),
            z: Math.floor(worldPosition.z)
        };
    }
    
    tileToWorld(tileX, tileZ) {
        const height = this.boardSystem.getTileHeight(tileX, tileZ);
        return new THREE.Vector3(
            tileX + 0.5,
            height + 0.1, // Slight offset above terrain
            tileZ + 0.5
        );
    }
    
    // Get height at specific world coordinates
    getHeightAt(x, z) {
        return this.boardSystem.getTileHeight(x, z);
    }
    
    // Check if line of sight is clear (for covering system)
    hasLineOfSight(fromX, fromZ, toX, toZ) {
        const dx = toX - fromX;
        const dz = toZ - fromZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const steps = Math.ceil(distance);
        
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const checkX = fromX + dx * t;
            const checkZ = fromZ + dz * t;
            
            // Check if intermediate tile is blocked by terrain
            if (this.boardSystem.isTileBlocked(Math.floor(checkX), Math.floor(checkZ))) {
                return false;
            }
            
            // Check if there's a piece blocking the path
            const blockingPiece = this.gameState.getPieceAt(
                Math.floor(checkX),
                Math.floor(checkZ)
            );
            if (blockingPiece) {
                return false;
            }
        }
        
        return true;
    }
    
    // Get tiles within range of a piece
    getTilesInRange(piece, range) {
        const tiles = [];
        
        for (let x = -range; x <= range; x++) {
            for (let z = -range; z <= range; z++) {
                const tileX = piece.x + x;
                const tileZ = piece.z + z;
                
                // Skip the piece's own tile
                if (x === 0 && z === 0) continue;
                
                // Skip if tile is blocked by terrain
                if (this.boardSystem.isTileBlocked(tileX, tileZ)) continue;
                
                tiles.push({
                    x: tileX,
                    z: tileZ,
                    height: this.boardSystem.getTileHeight(tileX, tileZ),
                    distance: Math.sqrt(x * x + z * z)
                });
            }
        }
        
        return tiles.sort((a, b) => a.distance - b.distance);
    }
    
    // Clean old cache entries
    cleanCache() {
        const now = Date.now();
        for (const [key, value] of this.moveCache) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.moveCache.delete(key);
            }
        }
    }
    
    // Clear all cached moves
    clearCache() {
        this.moveCache.clear();
    }
    
    // Validate a specific move
    validateMove(piece, fromX, fromZ, toX, toZ) {
        // Check if piece is at expected position
        if (piece.x !== fromX || piece.z !== fromZ) {
            return { valid: false, reason: 'Piece not at expected position' };
        }
        
        // Check cooldown
        if (this.isPieceOnCooldown(piece)) {
            return { valid: false, reason: 'Piece is on cooldown' };
        }
        
        // Get valid moves for piece
        const validMoves = this.getValidMovesForPiece(piece);
        const isValidMove = validMoves.some(move => move.x === toX && move.z === toZ);
        
        if (!isValidMove) {
            return { valid: false, reason: 'Invalid move pattern' };
        }
        
        return { valid: true };
    }
    
    // Get move animation data
    getMoveAnimationData(piece, toX, toZ) {
        const fromPos = this.tileToWorld(piece.x, piece.z);
        const toPos = this.tileToWorld(toX, toZ);
        
        return {
            from: fromPos,
            to: toPos,
            duration: this.getMoveDuration(piece.type),
            arcHeight: this.getMoveArcHeight(piece.type)
        };
    }
    
    getMoveDuration(pieceType) {
        const durations = {
            pawn: 500,
            knight: 800,
            bishop: 600,
            rook: 700,
            queen: 900,
            king: 400
        };
        
        return durations[pieceType] || 600;
    }
    
    getMoveArcHeight(pieceType) {
        const arcHeights = {
            pawn: 0.5,
            knight: 2.0, // Knights jump higher
            bishop: 0.8,
            rook: 0.3,
            queen: 0.6,
            king: 0.4
        };
        
        return arcHeights[pieceType] || 0.5;
    }
}
