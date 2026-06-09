/**
 * FormationPathfinding - Computes formation destinations and finds paths for each piece.
 * Respects piece movement patterns, terrain blocking, and "land next to enemy" rules.
 */
class FormationPathfinding {
    constructor(movementBridge, gameState) {
        this.movementBridge = movementBridge;
        this.gameState = gameState;

        // Movement order priority (lower = moves first)
        this.movePriority = {
            pawn: 1,
            knight: 2,
            bishop: 3,
            queen: 4,
            king: 5,
            rook: 6
        };

        // Chess piece values for junior/senior determination
        this.pieceValues = {
            pawn: 1,
            knight: 3,
            bishop: 3,
            rook: 5,
            queen: 9,
            king: 1000
        };
    }

    /**
     * Main entry point: given selected pieces and a target square,
     * compute destinations and paths for each piece.
     * Returns: Array of { piece, destination: {x,z}, path: [{x,z}, ...], priority }
     */
    computeFormationMoves(pieces, targetX, targetZ) {
        if (pieces.length === 0) return [];

        // Single piece: just pathfind directly to target
        if (pieces.length === 1) {
            const piece = pieces[0];
            const dest = this._findBestDestination(piece, targetX, targetZ);
            const path = this._findPath(piece, dest.x, dest.z);
            return [{
                piece,
                destination: dest,
                path,
                priority: this.movePriority[piece.type] || 99
            }];
        }

        // Multiple pieces: maintain formation
        return this._computeMultiPieceFormation(pieces, targetX, targetZ);
    }

    /**
     * Compute formation destinations for multiple pieces.
     */
    _computeMultiPieceFormation(pieces, targetX, targetZ) {
        // Compute centroid of current piece positions
        let cx = 0, cz = 0;
        for (const p of pieces) {
            cx += p.x;
            cz += p.z;
        }
        cx /= pieces.length;
        cz /= pieces.length;

        // For each piece, compute ideal offset and destination
        const results = [];
        const reservedDestinations = new Set(); // "x,z" strings

        // Sort pieces by priority so higher-priority pieces claim destinations first
        const sortedPieces = [...pieces].sort((a, b) => {
            return (this.movePriority[a.type] || 99) - (this.movePriority[b.type] || 99);
        });

        for (const piece of sortedPieces) {
            const offsetX = piece.x - cx;
            const offsetZ = piece.z - cz;

            // Round offsets to nearest integer for grid alignment
            const idealX = targetX + Math.round(offsetX);
            const idealZ = targetZ + Math.round(offsetZ);

            const dest = this._findBestDestination(piece, idealX, idealZ, reservedDestinations);
            const destKey = `${dest.x},${dest.z}`;
            reservedDestinations.add(destKey);

            const path = this._findPath(piece, dest.x, dest.z);

            results.push({
                piece,
                destination: dest,
                path,
                priority: this.movePriority[piece.type] || 99
            });
        }

        // Re-sort by original priority order for execution
        results.sort((a, b) => a.priority - b.priority);
        return results;
    }

    /**
     * Find the best destination for a piece, considering:
     * - ideal destination
     * - enemy occupation (land next to, not on top)
     * - friendly occupation / blocking
     * - reachability
     */
    _findBestDestination(piece, idealX, idealZ, reservedDestinations = new Set()) {
        // Check if ideal destination has an enemy piece
        const occupant = this.gameState.getPieceAt(idealX, idealZ);
        if (occupant && occupant.playerId !== piece.playerId) {
            // Find attack square next to enemy instead
            const attackSquare = this._findAttackSquare(piece, occupant, idealX, idealZ);
            if (attackSquare) {
                const dest = this._resolveDestination(piece, attackSquare.x, attackSquare.z, reservedDestinations);
                dest.reason = 'attack_square';
                return dest;
            }
        }

        // Check if ideal is reserved or occupied by friendly
        const dest = this._resolveDestination(piece, idealX, idealZ, reservedDestinations);
        if (dest.x === idealX && dest.z === idealZ) {
            dest.reason = 'formation_ideal';
        } else {
            dest.reason = 'formation_fallback';
        }
        return dest;
    }

    /**
     * Resolve a destination: if occupied/blocked/reserved, find nearest alternative.
     */
    _resolveDestination(piece, idealX, idealZ, reservedDestinations) {
        // If ideal is free and not reserved, use it
        if (this._isDestinationValid(piece, idealX, idealZ, reservedDestinations)) {
            return { x: idealX, z: idealZ };
        }

        // Spiral search for nearest valid square
        const maxRadius = 8;
        for (let r = 1; r <= maxRadius; r++) {
            const candidates = this._getSpiralRing(idealX, idealZ, r);
            // Sort by distance to ideal
            candidates.sort((a, b) => {
                const da = Math.abs(a.x - idealX) + Math.abs(a.z - idealZ);
                const db = Math.abs(b.x - idealX) + Math.abs(b.z - idealZ);
                return da - db;
            });

            for (const c of candidates) {
                if (this._isDestinationValid(piece, c.x, c.z, reservedDestinations)) {
                    return { x: c.x, z: c.z };
                }
            }
        }

        // Fallback: stay in place
        return { x: piece.x, z: piece.z };
    }

    _isDestinationValid(piece, x, z, reservedDestinations) {
        // Can't be same as current position (no-op)
        if (x === piece.x && z === piece.z) return false;

        // Check terrain blocking
        if (this.movementBridge.boardSystem.isTileBlocked(x, z)) return false;

        // Check reserved
        if (reservedDestinations.has(`${x},${z}`)) return false;

        // Check friendly piece occupation
        const occupant = this.gameState.getPieceAt(x, z);
        if (occupant && occupant.playerId === piece.playerId) return false;

        return true;
    }

    /**
     * Find squares from which `piece` can attack `targetPiece`.
     * Returns the closest such square to the piece's current position.
     */
    _findAttackSquare(piece, targetPiece, idealX, idealZ) {
        const pattern = this.movementBridge.getMovementPattern(piece.type);
        if (!pattern) return null;

        const tx = targetPiece.x;
        const tz = targetPiece.z;
        const candidates = [];

        if (Array.isArray(pattern.moves)) {
            // Fixed-distance pieces: knight, king, pawn
            for (const move of pattern.moves) {
                const cx = tx - move.dx;
                const cz = tz - move.dz;
                if (this._isValidAttackLanding(cx, cz, piece)) {
                    candidates.push({ x: cx, z: cz });
                }
            }
        } else {
            // Sliding pieces: bishop, rook, queen
            const directions = this.movementBridge.getDirections(pattern.moves);
            for (const dir of directions) {
                const cx = tx - dir.dx;
                const cz = tz - dir.dz;
                if (this._isValidAttackLanding(cx, cz, piece)) {
                    candidates.push({ x: cx, z: cz });
                }
            }
        }

        if (candidates.length === 0) return null;

        // Choose closest to ideal position
        candidates.sort((a, b) => {
            const da = Math.abs(a.x - idealX) + Math.abs(a.z - idealZ);
            const db = Math.abs(b.x - idealX) + Math.abs(b.z - idealZ);
            return da - db;
        });

        return candidates[0];
    }

    _isValidAttackLanding(x, z, attackerPiece) {
        if (x === attackerPiece.x && z === attackerPiece.z) return false;
        if (this.movementBridge.boardSystem.isTileBlocked(x, z)) return false;
        const occupant = this.gameState.getPieceAt(x, z);
        if (occupant && occupant.playerId === attackerPiece.playerId) return false;
        return true;
    }

    /**
     * Find a path from piece current position to destination using A*.
     * Each step must be a valid chess move for this piece type.
     * Returns array of positions [{x,z}, ...] excluding start, including destination.
     */
    _findPath(piece, destX, destZ) {
        if (piece.x === destX && piece.z === destZ) return [];

        // A* setup
        const startKey = `${piece.x},${piece.z}`;
        const goalKey = `${destX},${destZ}`;

        const openSet = new Map(); // key -> {x, z, f, g}
        const closedSet = new Set();
        const cameFrom = new Map(); // key -> previousKey
        const gScore = new Map(); // key -> cost

        openSet.set(startKey, { x: piece.x, z: piece.z, f: 0, g: 0 });
        gScore.set(startKey, 0);

        const maxIterations = 500;
        let iterations = 0;

        while (openSet.size > 0 && iterations < maxIterations) {
            iterations++;

            // Get node with lowest f score
            let currentKey = null;
            let currentF = Infinity;
            for (const [key, node] of openSet) {
                if (node.f < currentF) {
                    currentF = node.f;
                    currentKey = key;
                }
            }

            if (currentKey === goalKey) {
                return this._reconstructPath(cameFrom, currentKey, piece);
            }

            const current = openSet.get(currentKey);
            openSet.delete(currentKey);
            closedSet.add(currentKey);

            // Get valid moves from current position
            const tempPiece = { ...piece, x: current.x, z: current.z };
            const moves = this.movementBridge.calculateValidMoves(tempPiece);

            for (const move of moves) {
                const moveKey = `${move.x},${move.z}`;
                if (closedSet.has(moveKey)) continue;

                const tentativeG = gScore.get(currentKey) + 1;

                if (!openSet.has(moveKey) || tentativeG < (gScore.get(moveKey) || Infinity)) {
                    cameFrom.set(moveKey, currentKey);
                    gScore.set(moveKey, tentativeG);

                    const h = Math.abs(move.x - destX) + Math.abs(move.z - destZ);
                    openSet.set(moveKey, {
                        x: move.x,
                        z: move.z,
                        g: tentativeG,
                        f: tentativeG + h
                    });
                }
            }
        }

        // No path found - return empty (piece will need to stop)
        console.warn(`[FormationPathfinding] No path found for ${piece.type} from (${piece.x},${piece.z}) to (${destX},${destZ})`);
        return [];
    }

    _reconstructPath(cameFrom, currentKey, piece) {
        const path = [];
        let key = currentKey;

        while (cameFrom.has(key)) {
            const [x, z] = key.split(',').map(Number);
            path.unshift({ x, z });
            key = cameFrom.get(key);
        }

        return path;
    }

    /**
     * Get all squares in a ring around (cx, cz) with Manhattan radius r.
     */
    _getSpiralRing(cx, cz, r) {
        const result = [];
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) + Math.abs(dz) === r) {
                    result.push({ x: cx + dx, z: cz + dz });
                }
            }
        }
        return result;
    }

    /**
     * Get piece value for junior/senior comparison.
     */
    getPieceValue(pieceType) {
        return this.pieceValues[pieceType] || 0;
    }

    /**
     * Compare two pieces: returns negative if a is junior to b (lower value).
     */
    compareJunior(a, b) {
        return this.getPieceValue(a.type) - this.getPieceValue(b.type);
    }
}

if (typeof window !== 'undefined') {
    window.FormationPathfinding = FormationPathfinding;
}
