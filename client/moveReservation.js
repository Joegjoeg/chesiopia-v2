/**
 * MoveReservation - Tracks squares reserved by pieces that are about to move.
 * Prevents friendly pieces from moving onto reserved squares.
 * Releases reservations when enemy pieces occupy them or when moves complete.
 */
class MoveReservation {
    constructor(gameState) {
        this.gameState = gameState;
        this.reservedSquares = new Map(); // "x,z" -> { pieceId, playerId, timestamp }
    }

    /**
     * Reserve a target square for a piece.
     */
    reserve(pieceId, x, z, playerId) {
        const key = `${x},${z}`;
        this.reservedSquares.set(key, { pieceId, playerId, timestamp: Date.now() });
    }

    /**
     * Release a reservation.
     */
    release(x, z) {
        const key = `${x},${z}`;
        this.reservedSquares.delete(key);
    }

    /**
     * Release all reservations for a piece.
     */
    releaseForPiece(pieceId) {
        for (const [key, data] of this.reservedSquares) {
            if (data.pieceId === pieceId) {
                this.reservedSquares.delete(key);
            }
        }
    }

    /**
     * Release all reservations for a player.
     */
    releaseForPlayer(playerId) {
        for (const [key, data] of this.reservedSquares) {
            if (data.playerId === playerId) {
                this.reservedSquares.delete(key);
            }
        }
    }

    /**
     * Check if a square is reserved by a friendly piece.
     */
    isReservedByFriendly(x, z, playerId) {
        const key = `${x},${z}`;
        const data = this.reservedSquares.get(key);
        return data && data.playerId === playerId;
    }

    /**
     * Check if a square is reserved by any piece.
     */
    isReserved(x, z) {
        const key = `${x},${z}`;
        return this.reservedSquares.has(key);
    }

    /**
     * Get the piece that reserved a square.
     */
    getReservingPiece(x, z) {
        const key = `${x},${z}`;
        const data = this.reservedSquares.get(key);
        return data ? data.pieceId : null;
    }

    /**
     * Handle enemy piece moving onto a reserved square.
     * Returns the pieceId whose reservation was violated, or null.
     */
    handleEnemyOccupation(x, z, enemyPlayerId) {
        const key = `${x},${z}`;
        const data = this.reservedSquares.get(key);
        if (data && data.playerId !== enemyPlayerId) {
            const pieceId = data.pieceId;
            this.reservedSquares.delete(key);
            return pieceId;
        }
        return null;
    }

    /**
     * Clean up stale reservations older than maxAgeMs.
     */
    cleanupStale(maxAgeMs = 30000) {
        const now = Date.now();
        for (const [key, data] of this.reservedSquares) {
            if (now - data.timestamp > maxAgeMs) {
                this.reservedSquares.delete(key);
            }
        }
    }

    /**
     * Get all reserved squares for a player.
     */
    getReservedForPlayer(playerId) {
        const result = [];
        for (const [key, data] of this.reservedSquares) {
            if (data.playerId === playerId) {
                const [x, z] = key.split(',').map(Number);
                result.push({ x, z, pieceId: data.pieceId });
            }
        }
        return result;
    }

    clearAll() {
        this.reservedSquares.clear();
    }
}

if (typeof window !== 'undefined') {
    window.MoveReservation = MoveReservation;
}
