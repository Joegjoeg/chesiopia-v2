class CoveringSystem {
    constructor(gameState, visualFeedbackSystem) {
        this.gameState = gameState;
        this.visualFeedback = visualFeedbackSystem;
        this.coveringRelationships = new Map();
        this.activeCoverings = new Map();
    }
    
    updateCoveringRelationships(relationships) {
        this.coveringRelationships.clear();
        relationships.forEach(([coveringId, coveredId]) => {
            this.coveringRelationships.set(coveringId, coveredId);
        });
        
        this.updateVisualCoverings();
    }
    
    setCovering(coveringPieceId, coveredPieceId) {
        // Remove any existing coverage for the covering piece
        this.removeCovering(coveringPieceId);
        
        // Set new coverage
        this.coveringRelationships.set(coveringPieceId, coveredPieceId);
        this.activeCoverings.set(coveringPieceId, {
            coveringPieceId: coveringPieceId,
            coveredPieceId: coveredPieceId,
            startTime: Date.now()
        });
        
        this.updateVisualCoverings();
    }
    
    removeCovering(coveringPieceId) {
        const coveredPieceId = this.coveringRelationships.get(coveringPieceId);
        if (coveredPieceId) {
            this.coveringRelationships.delete(coveringPieceId);
            this.activeCoverings.delete(coveringPieceId);
            this.updateVisualCoverings();
        }
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
                return this.gameState.getPiece(coveringId);
            }
        }
        return null;
    }
    
    getCoveredPiece(coveringPieceId) {
        const coveredPieceId = this.coveringRelationships.get(coveringPieceId);
        return coveredPieceId ? this.gameState.getPiece(coveredPieceId) : null;
    }
    
    canCover(gameState, coveringPiece, coveredPiece, terrainSystem) {
        // Can only cover friendly pieces
        if (coveringPiece.playerId !== coveredPiece.playerId) {
            return false;
        }
        
        // Can't cover self
        if (coveringPiece.id === coveredPiece.id) {
            return false;
        }
        
        // Check if covering piece already covers something
        if (this.coveringRelationships.has(coveringPiece.id)) {
            return false;
        }
        
        // Check if covered piece is already covered
        if (this.isCovered(coveredPiece.id)) {
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
    
    getCoverablePieces(gameState, piece, terrainSystem) {
        const coverable = [];
        const playerPieces = gameState.getPiecesForPlayer(piece.playerId);
        
        playerPieces.forEach(targetPiece => {
            if (this.canCover(gameState, piece, targetPiece, terrainSystem)) {
                coverable.push(targetPiece);
            }
        });
        
        return coverable;
    }
    
    getCoveringPieces(gameState, piece, terrainSystem) {
        const covering = [];
        const playerPieces = gameState.getPiecesForPlayer(piece.playerId);
        
        playerPieces.forEach(coveringPiece => {
            if (this.canCover(gameState, coveringPiece, piece, terrainSystem)) {
                covering.push(coveringPiece);
            }
        });
        
        return covering;
    }
    
    updateVisualCoverings() {
        // Clear existing visual coverings
        this.visualFeedback.clearCoveringRelationship();
        
        // Add visual indicators for all active coverings
        for (const [coveringId, coveredId] of this.coveringRelationships) {
            const coveringPiece = this.gameState.getPiece(coveringId);
            const coveredPiece = this.gameState.getPiece(coveredId);
            
            if (coveringPiece && coveredPiece) {
                this.visualFeedback.showCoveringRelationship(coveringPiece, coveredPiece);
            }
        }
    }
    
    // Check if moving a piece would break coverage
    wouldBreakCoverage(piece, toX, toZ, gameState, terrainSystem) {
        // Check if this piece is currently covering something
        for (const [coveringId, coveredId] of this.coveringRelationships) {
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
                        terrainSystem
                    );
                }
            }
        }
        
        return false;
    }
    
    // Get coverage strength for a piece
    getCoverageStrength(pieceId) {
        let strength = 0;
        
        for (const [coveringId, coveredId] of this.coveringRelationships) {
            if (coveredId === pieceId) {
                strength++;
            }
        }
        
        return strength;
    }
    
    // Get all pieces that are covered
    getCoveredPieces() {
        const covered = [];
        
        for (const [coveringId, coveredId] of this.coveringRelationships) {
            const piece = this.gameState.getPiece(coveredId);
            if (piece) {
                covered.push(piece);
            }
        }
        
        return covered;
    }
    
    // Get all pieces that are covering others
    getCoveringPieces() {
        const covering = [];
        
        for (const coveringId of this.coveringRelationships.keys()) {
            const piece = this.gameState.getPiece(coveringId);
            if (piece) {
                covering.push(piece);
            }
        }
        
        return covering;
    }
    
    // Get coverage statistics for a player
    getPlayerCoverageStats(playerId) {
        const playerPieces = this.gameState.getPiecesForPlayer(playerId);
        
        let coveringCount = 0;
        let coveredCount = 0;
        
        playerPieces.forEach(piece => {
            if (this.coveringRelationships.has(piece.id)) {
                coveringCount++;
            }
            if (this.isCovered(piece.id)) {
                coveredCount++;
            }
        });
        
        return {
            coveringCount: coveringCount,
            coveredCount: coveredCount,
            totalPieces: playerPieces.length,
            coverageRatio: playerPieces.length > 0 ? coveredCount / playerPieces.length : 0
        };
    }
    
    // Find best covering piece for a target
    findBestCoveringPiece(targetPiece, gameState, terrainSystem) {
        const coveringPieces = this.getCoveringPieces(gameState, targetPiece, terrainSystem);
        
        if (coveringPieces.length === 0) {
            return null;
        }
        
        // Score each potential covering piece
        let bestPiece = null;
        let bestScore = -Infinity;
        
        coveringPieces.forEach(piece => {
            const score = this.scoreCoveringPiece(piece, targetPiece, gameState);
            if (score > bestScore) {
                bestScore = score;
                bestPiece = piece;
            }
        });
        
        return bestPiece;
    }
    
    scoreCoveringPiece(coveringPiece, targetPiece, gameState) {
        let score = 0;
        
        // Prefer pieces with higher value
        const pieceValues = {
            pawn: 1,
            knight: 3,
            bishop: 3,
            rook: 5,
            queen: 9,
            king: 1000
        };
        
        score += pieceValues[coveringPiece.type] || 0;
        
        // Prefer pieces that are not under attack
        // (This would need move validator integration)
        
        // Prefer pieces that can still move effectively
        // (This would need cooldown checking)
        
        // Prefer pieces closer to the target
        const distance = Math.sqrt(
            Math.pow(coveringPiece.x - targetPiece.x, 2) +
            Math.pow(coveringPiece.z - targetPiece.z, 2)
        );
        score -= distance * 0.1;
        
        return score;
    }
    
    // Check if a piece can be captured (not covered)
    canBeCaptured(pieceId) {
        return !this.isCovered(pieceId);
    }
    
    // Get pieces that can capture a target
    getCapturingPieces(targetPiece, gameState, terrainSystem) {
        const capturing = [];
        
        for (const piece of gameState.getAllPieces()) {
            if (piece.playerId !== targetPiece.playerId) {
                // Check if piece can capture target
                // (This would need move validator integration)
                if (this.canCapture(piece, targetPiece, gameState, terrainSystem)) {
                    capturing.push(piece);
                }
            }
        }
        
        return capturing;
    }
    
    canCapture(attacker, target, gameState, terrainSystem) {
        if (attacker.playerId === target.playerId) {
            return false;
        }
        
        if (this.isCovered(target.id)) {
            return false;
        }
        
        // Check line of sight for ranged pieces
        const distance = Math.sqrt(
            Math.pow(attacker.x - target.x, 2) +
            Math.pow(attacker.z - target.z, 2)
        );
        
        if (distance > 1) {
            return this.hasLineOfSight(
                attacker.x,
                attacker.z,
                target.x,
                target.z,
                gameState,
                terrainSystem
            );
        }
        
        return true;
    }
    
    // Clear all coverings
    clearAllCoverings() {
        this.coveringRelationships.clear();
        this.activeCoverings.clear();
        this.updateVisualCoverings();
    }
    
    // Get coverage map (for AI analysis)
    getCoverageMap(playerId, gameState) {
        const coverageMap = new Map();
        
        for (const [coveringId, coveredId] of this.coveringRelationships) {
            const coveringPiece = gameState.getPiece(coveringId);
            const coveredPiece = gameState.getPiece(coveredId);
            
            if (coveringPiece && coveringPiece.playerId === playerId) {
                const key = `${coveringPiece.x},${coveringPiece.z}`;
                if (!coverageMap.has(key)) {
                    coverageMap.set(key, []);
                }
                coverageMap.get(key).push({
                    coveringPiece: coveringPiece,
                    coveredPiece: coveredPiece
                });
            }
        }
        
        return coverageMap;
    }
    
    // Update system
    update() {
        // Update visual effects for coverings
        this.updateCoveringAnimations();
    }
    
    updateCoveringAnimations() {
        for (const [coveringId, covering] of this.activeCoverings) {
            const elapsed = Date.now() - covering.startTime;
            
            // Could add pulsing effects or other animations here
            // based on elapsed time
        }
    }
    
    // Cleanup
    cleanup() {
        this.coveringRelationships.clear();
        this.activeCoverings.clear();
        this.visualFeedback.clearCoveringRelationship();
    }
}
