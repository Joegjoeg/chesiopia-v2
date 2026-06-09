/**
 * GroupMoveExecutor - Orchestrates multi-piece formation movement.
 * Handles staggered starts, collision avoidance, junior piece pausing,
 * reservation violations, and piece-specific audio feedback.
 */
class GroupMoveExecutor {
    constructor(game, formationPathfinding, moveReservation) {
        this.game = game;
        this.pathfinding = formationPathfinding;
        this.reservation = moveReservation;

        this.activeMoves = new Map(); // pieceId -> MoveState
        this.isExecuting = false;
        this.staggerDelay = 400; // ms between piece starts

        // Piece-specific movement phrases for TTS context
        this.movementPhrases = {
            pawn: [
                "Forward, one step at a time.",
                "Onward, into the fray.",
                "Another square closer to glory... or death.",
                "March! Though the road be long."
            ],
            knight: [
                "A bold leap! None can predict my path!",
                "Over hill and dale, I ride!",
                "The knight charges where he wills!",
                "Ha! A maneuver worthy of song!"
            ],
            bishop: [
                "The divine path is clear.",
                "As God wills, so I glide.",
                "Diagonally, the righteous advance.",
                "Judgment comes on the slant."
            ],
            queen: [
                "All paths are mine to command.",
                "One move, many consequences.",
                "The board bends to my will.",
                "Witness the scope of true power."
            ],
            king: [
                "Slowly, carefully... the kingdom depends on it.",
                "A measured step for a measured crown.",
                "Where I go, all follows.",
                "One square, heavy with fate."
            ],
            rook: [
                "Straight through! None shall bar my way!",
                "The wall advances!",
                "Bones will break beneath my path!",
                "No deviation. Only destruction."
            ]
        };

        this.pausePhrases = {
            pawn: ["Hold... something blocks the way.", "Wait... a comrade passes.", "Halt... I am but a pawn."],
            knight: ["Stay... honor demands patience.", "Rein in... the path clears soon.", "A knight must wait his turn."],
            bishop: ["Pause... the divine timing is not yet.", "Wait... another moves in God's light.", "Patience is also a virtue."],
            queen: ["Hmph. I shall allow them passage.", "Wait? For them? Very well...", "A queen adapts to any delay."],
            king: ["Hold. Safety before haste.", "Wait... the board shifts.", "A king never rushes blindly."],
            rook: ["Grr... I wait. But not gladly.", "The wall halts. For now.", "Move aside, or be moved!"]
        };

        this.blockedPhrases = {
            pawn: ["Blocked... story of my life.", "Can't go further. Typical.", "The way is shut. As always."],
            knight: ["The path is lost!", "No way through! Curses!", "My charge is broken!"],
            bishop: ["The way is closed... a test of faith.", "God has barred this path.", "Not even the righteous may pass."],
            queen: ["Blocked? Impossible.", "Something dares impede me?", "An obstacle... how quaint."],
            king: ["We cannot proceed. Retreat.", "The way is shut to us.", "A king knows when to stop."],
            rook: ["PATH BLOCKED! FURY!", "Grrah! Something stands in my way!", "I will REMEMBER this!"]
        };

        this.resumePhrases = {
            pawn: ["Onward again!", "Finally, we march.", "About time."],
            knight: ["At last! Forward!", "The path clears! Charge!", "Delay ended! Ride!"],
            bishop: ["The time is come.", "God calls me forward.", "The path reopens."],
            queen: ["Finally. I was growing bored.", "The delay ends. Move.", "As it should be."],
            king: ["Proceed. With care.", "The way is open again.", "We continue."],
            rook: ["ROAR! MOVE AGAIN!", "The wall rolls onward!", "None stop me forever!"]
        };
    }

    /**
     * Main entry: execute a group move for selected pieces toward target.
     */
    executeMove(selectedPieces, targetX, targetZ) {
        if (this.isExecuting) {
            console.log('[GroupMoveExecutor] Already executing a group move, ignoring new request');
            return;
        }

        const plans = this.pathfinding.computeFormationMoves(selectedPieces, targetX, targetZ);
        if (plans.length === 0) return;

        console.log(`[GroupMoveExecutor] Starting group move: ${plans.length} pieces to (${targetX},${targetZ})`);

        this.isExecuting = true;
        this.activeMoves.clear();

        // Reserve all final destinations
        const myPlayerId = this.game.gameState.getCurrentPlayerId();
        for (const plan of plans) {
            if (plan.destination && (plan.destination.x !== plan.piece.x || plan.destination.z !== plan.piece.z)) {
                this.reservation.reserve(plan.piece.id, plan.destination.x, plan.destination.z, myPlayerId);
            }
        }

        // Initialize move states
        const now = Date.now();
        for (let i = 0; i < plans.length; i++) {
            const plan = plans[i];
            const startTime = now + (i * this.staggerDelay);

            this.activeMoves.set(plan.piece.id, {
                piece: plan.piece,
                currentX: plan.piece.x,
                currentZ: plan.piece.z,
                path: plan.path,
                stepIndex: 0,
                status: 'queued',
                startTime: startTime,
                nextStepTime: startTime,
                destination: plan.destination,
                priority: plan.priority,
                movingTo: null
            });

            console.log(`[GroupMoveExecutor] ${plan.piece.type} queued, starts at ${startTime}, path length: ${plan.path.length}`);
        }

        // Start ticking
        this._startTickLoop();
    }

    /**
     * Called when a piece move animation completes (from game.js handlePieceMoved).
     */
    onPieceMoveComplete(pieceId) {
        const state = this.activeMoves.get(pieceId);
        if (!state) return;

        console.log(`[GroupMoveExecutor] Piece ${pieceId} move animation complete`);

        if (state.status === 'moving') {
            // Advance current position to the step we just completed
            if (state.movingTo) {
                state.currentX = state.movingTo.x;
                state.currentZ = state.movingTo.z;
                state.movingTo = null;
            }
            state.stepIndex++;

            // Check if we've reached the destination
            if (state.stepIndex >= state.path.length) {
                state.status = 'completed';
                this.reservation.release(state.destination.x, state.destination.z);
                console.log(`[GroupMoveExecutor] Piece ${pieceId} completed its path`);
                this._trySpeak(state.piece, this.resumePhrases, 0.3);
            } else {
                // Ready for next step after cooldown
                const cooldown = this._getCooldown(state.piece.type);
                state.nextStepTime = Date.now() + cooldown;
                console.log(`[GroupMoveExecutor] Piece ${pieceId} ready for step ${state.stepIndex} at ${state.nextStepTime}`);
            }
        }

        this._checkAllComplete();
    }

    /**
     * Called when an enemy moves onto a reserved square.
     * The piece should stop one square short.
     */
    onReservationViolated(pieceId) {
        const state = this.activeMoves.get(pieceId);
        if (!state) return;

        console.log(`[GroupMoveExecutor] Reservation violated for piece ${pieceId}`);

        // Release the reservation
        this.reservation.release(state.destination.x, state.destination.z);

        // If the piece hasn't started or is still moving, stop it at current position
        state.status = 'blocked';
        state.blockedReason = 'reservation_violated';
        this._trySpeak(state.piece, this.blockedPhrases, 0.6);

        this._checkAllComplete();
    }

    /**
     * Internal tick loop.
     */
    _startTickLoop() {
        if (this._tickInterval) clearInterval(this._tickInterval);
        this._tickInterval = setInterval(() => this._tick(), 100);
    }

    _stopTickLoop() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
    }

    _tick() {
        if (!this.isExecuting) {
            this._stopTickLoop();
            return;
        }

        const now = Date.now();

        // Collect all next positions to detect collisions
        const nextPositions = new Map(); // "x,z" -> pieceId
        for (const [pieceId, state] of this.activeMoves) {
            if (state.status === 'moving' && state.movingTo) {
                const key = `${state.movingTo.x},${state.movingTo.z}`;
                if (!nextPositions.has(key)) {
                    nextPositions.set(key, pieceId);
                }
            }
        }

        for (const [pieceId, state] of this.activeMoves) {
            if (state.status === 'completed' || state.status === 'blocked') continue;

            if (state.status === 'queued') {
                if (now >= state.startTime) {
                    this._attemptStart(state, now, nextPositions);
                }
                continue;
            }

            if (state.status === 'paused') {
                this._checkResume(state, now, nextPositions);
                continue;
            }

            if (state.status === 'moving' && now >= state.nextStepTime) {
                this._attemptNextStep(state, now, nextPositions);
            }
        }

        this._checkAllComplete();
    }

    _attemptStart(state, now, nextPositions) {
        if (state.path.length === 0) {
            state.status = 'completed';
            return;
        }

        const step = state.path[0];
        const stepKey = `${step.x},${step.z}`;

        // Check collision with another piece's next step
        const occupant = nextPositions.get(stepKey);
        if (occupant && occupant !== state.piece.id) {
            const otherState = this.activeMoves.get(occupant);
            if (otherState) {
                if (this._isJunior(state.piece, otherState.piece)) {
                    state.status = 'paused';
                    state.pausedReason = 'junior_to_' + occupant;
                    console.log(`[GroupMoveExecutor] ${state.piece.type} paused: junior to ${otherState.piece.type}`);
                    this._trySpeak(state.piece, this.pausePhrases, 0.5);
                    return;
                }
            }
        }

        // Check if step square is reserved by another friendly piece (different destination)
        if (this.reservation.isReservedByFriendly(step.x, step.z, state.piece.playerId)) {
            const reserverId = this.reservation.getReservingPiece(step.x, step.z);
            if (reserverId && reserverId !== state.piece.id) {
                const otherPiece = this.game.gameState.getPiece(reserverId);
                if (otherPiece && this._isJunior(state.piece, otherPiece)) {
                    state.status = 'paused';
                    state.pausedReason = 'reserved_by_' + reserverId;
                    console.log(`[GroupMoveExecutor] ${state.piece.type} paused: reserved by another`);
                    this._trySpeak(state.piece, this.pausePhrases, 0.5);
                    return;
                }
            }
        }

        this._initiateStep(state, step);
    }

    _attemptNextStep(state, now, nextPositions) {
        if (state.stepIndex >= state.path.length) {
            state.status = 'completed';
            return;
        }

        const step = state.path[state.stepIndex];
        const stepKey = `${step.x},${step.z}`;

        // Check collision
        const occupant = nextPositions.get(stepKey);
        if (occupant && occupant !== state.piece.id) {
            const otherState = this.activeMoves.get(occupant);
            if (otherState && this._isJunior(state.piece, otherState.piece)) {
                state.status = 'paused';
                state.pausedReason = 'junior_collision';
                console.log(`[GroupMoveExecutor] ${state.piece.type} paused at step ${state.stepIndex}: junior collision`);
                this._trySpeak(state.piece, this.pausePhrases, 0.5);
                return;
            }
        }

        // Check reservation
        if (this.reservation.isReservedByFriendly(step.x, step.z, state.piece.playerId)) {
            const reserverId = this.reservation.getReservingPiece(step.x, step.z);
            if (reserverId && reserverId !== state.piece.id) {
                const otherPiece = this.game.gameState.getPiece(reserverId);
                if (otherPiece && this._isJunior(state.piece, otherPiece)) {
                    state.status = 'paused';
                    state.pausedReason = 'reserved_collision';
                    console.log(`[GroupMoveExecutor] ${state.piece.type} paused: reserved collision`);
                    this._trySpeak(state.piece, this.pausePhrases, 0.5);
                    return;
                }
            }
        }

        this._initiateStep(state, step);
    }

    _checkResume(state, now, nextPositions) {
        if (state.stepIndex >= state.path.length) {
            state.status = 'completed';
            return;
        }

        const step = state.path[state.stepIndex];
        const stepKey = `${step.x},${step.z}`;

        // Check if blocking condition cleared
        const occupant = nextPositions.get(stepKey);
        if (occupant && occupant !== state.piece.id) {
            const otherState = this.activeMoves.get(occupant);
            if (otherState && this._isJunior(state.piece, otherState.piece)) {
                return; // Still blocked
            }
        }

        if (this.reservation.isReservedByFriendly(step.x, step.z, state.piece.playerId)) {
            const reserverId = this.reservation.getReservingPiece(step.x, step.z);
            if (reserverId && reserverId !== state.piece.id) {
                const otherPiece = this.game.gameState.getPiece(reserverId);
                if (otherPiece && this._isJunior(state.piece, otherPiece)) {
                    return; // Still reserved by senior
                }
            }
        }

        // Path is clear, resume
        state.status = 'moving';
        state.nextStepTime = now;
        console.log(`[GroupMoveExecutor] ${state.piece.type} resuming`);
        this._trySpeak(state.piece, this.resumePhrases, 0.4);
    }

    _initiateStep(state, step) {
        console.log(`[GroupMoveExecutor] Moving ${state.piece.type} from (${state.currentX},${state.currentZ}) to (${step.x},${step.z})`);

        state.status = 'moving';
        state.nextStepTime = Date.now() + 999999; // Will be updated on completion

        // Track the step we are moving TO (for collision detection)
        state.movingTo = { x: step.x, z: step.z };

        // Initiate the actual move via game
        // Use a clone with the correct from position so movePiece emits correct coords
        const pieceForMove = { ...state.piece, x: state.currentX, z: state.currentZ };
        this.game.movePiece(pieceForMove, step.x, step.z);

        // Audio feedback
        this._trySpeak(state.piece, this.movementPhrases, 0.3);
    }

    _isJunior(pieceA, pieceB) {
        return this.pathfinding.compareJunior(pieceA, pieceB) < 0;
    }

    _getCooldown(pieceType) {
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

    _checkAllComplete() {
        if (this.activeMoves.size === 0) {
            this._finishExecution();
            return;
        }

        let allDone = true;
        for (const state of this.activeMoves.values()) {
            if (state.status !== 'completed' && state.status !== 'blocked') {
                allDone = false;
                break;
            }
        }

        if (allDone) {
            this._finishExecution();
        }
    }

    _finishExecution() {
        console.log('[GroupMoveExecutor] Group move execution finished');
        this.isExecuting = false;
        this._stopTickLoop();
        this.activeMoves.clear();

        // Keep pieces selected (game.js handles this via multiPieceSelector)
    }

    /**
     * Attempt to speak a contextual phrase for a piece.
     */
    _trySpeak(piece, phraseMap, probability = 0.5) {
        if (Math.random() > probability) return;
        if (!window.soundManager) return;

        const phrases = phraseMap[piece.type];
        if (!phrases || phrases.length === 0) return;

        const phrase = phrases[Math.floor(Math.random() * phrases.length)];

        // Calculate distance to camera for volume
        const camera = this.game.camera;
        const dx = (piece.x + 0.5) - camera.position.x;
        const dz = (piece.z + 0.5) - camera.position.z;
        const dy = 0 - camera.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(phrase);
            const voice = window.soundManager.getVoiceForPiece(piece.type);
            if (voice) utterance.voice = voice;

            const voiceConfig = window.soundManager.pieceVoices[piece.type];
            if (voiceConfig) {
                utterance.rate = voiceConfig.voiceSettings.rate;
                utterance.pitch = voiceConfig.voiceSettings.pitch;
                let volume = voiceConfig.voiceSettings.volume * 0.8;
                volume = window.soundManager.calculateDistanceVolume(dist, volume);
                utterance.volume = volume;
            } else {
                utterance.rate = 0.9;
                utterance.pitch = 0.8;
                utterance.volume = 0.4;
            }

            speechSynthesis.speak(utterance);
        }
    }

    /**
     * Cancel any active group move.
     */
    cancel() {
        console.log('[GroupMoveExecutor] Cancelling active group move');
        this.isExecuting = false;
        this._stopTickLoop();
        this.activeMoves.clear();
    }
}

if (typeof window !== 'undefined') {
    window.GroupMoveExecutor = GroupMoveExecutor;
}
