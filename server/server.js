const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const GameState = require('./gameState');
const MoveValidator = require('./moveValidator');
const TerrainGenerator = require('./terrain');

class ChessopiaServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        this.port = process.env.PORT || 3000;
        this.gameState = new GameState();
        this.moveValidator = new MoveValidator();
        this.terrainGenerator = new TerrainGenerator();
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
    }
    
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../client')));
    }
    
    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../client/index.html'));
        });
        
        this.app.get('/api/terrain/:x/:y', (req, res) => {
            const { x, y } = req.params;
            const height = this.terrainGenerator.getHeight(parseInt(x), parseInt(y));
            const isBlocked = this.terrainGenerator.isTileBlocked(parseInt(x), parseInt(y));
            res.json({ height, isBlocked });
        });
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`Player connected: ${socket.id}`);
            
            // Handle player joining
            socket.on('joinGame', (playerData) => {
                console.log('[Server] Player joining game:', playerData);
                const player = this.gameState.addPlayer(socket.id, playerData);
                console.log('[Server] Created player:', player);
                socket.emit('playerJoined', player);
                socket.broadcast.emit('playerJoined', player);
                
                // Send current game state
                const gameState = this.gameState.getState();
                console.log('[Server] === SENDING GAME STATE ===');
                console.log('[Server] Game state object:', gameState);
                console.log('[Server] Game state keys:', Object.keys(gameState));
                console.log('[Server] Pieces array:', gameState.pieces);
                console.log('[Server] Pieces count:', gameState.pieces?.length || 0);
                console.log('[Server] Players array:', gameState.players);
                console.log('[Server] Players count:', gameState.players?.length || 0);
                console.log('[Server] Emitting gameState event to socket:', socket.id);
                socket.emit('gameState', gameState);
                console.log('[Server] === GAME STATE SENT ===');
            });
            
            // Handle piece movement
            socket.on('movePiece', (moveData) => {
                const { pieceId, fromX, fromZ, toX, toZ } = moveData;
                
                // Validate move
                const isValid = this.moveValidator.validateMove(
                    this.gameState,
                    pieceId,
                    fromX,
                    fromZ,
                    toX,
                    toZ
                );
                
                if (isValid) {
                    // Execute move
                    const moveResult = this.gameState.executeMove(pieceId, toX, toZ);
                    
                    // Broadcast move to all players
                    this.io.emit('pieceMoved', moveResult);
                    
                    // Check for game over conditions
                    const gameOver = this.gameState.checkGameOver();
                    if (gameOver) {
                        this.io.emit('gameOver', gameOver);
                    }
                } else {
                    socket.emit('moveInvalid', { reason: 'Invalid move' });
                }
            });
            
            // Handle piece purchase
            socket.on('purchasePiece', (purchaseData) => {
                const { pieceType, playerId } = purchaseData;
                
                const purchaseResult = this.gameState.purchasePiece(playerId, pieceType);
                if (purchaseResult.success) {
                    this.io.emit('piecePurchased', purchaseResult);
                } else {
                    socket.emit('purchaseFailed', { reason: purchaseResult.reason });
                }
            });
            
            // Handle covering system
            socket.on('setCovering', (coverData) => {
                const { coveringPieceId, coveredPieceId } = coverData;
                
                const result = this.gameState.setCovering(coveringPieceId, coveredPieceId);
                if (result.success) {
                    this.io.emit('coveringSet', result);
                } else {
                    socket.emit('coveringFailed', { reason: result.reason });
                }
            });
            
            // Handle spawn test pieces (temporary command)
            socket.on('spawnTestPieces', () => {
                console.log('=== SPAWN TEST PIECES EVENT RECEIVED ===');
                console.log('[Server] Spawn test pieces request received from socket:', socket.id);
                
                const player = this.gameState.players.get(socket.id);
                if (player) {
                    // Spawn additional test pieces for the existing player
                    const spawnX = Math.floor(Math.random() * 20) - 10;
                    const spawnZ = Math.floor(Math.random() * 20) - 10;
                    
                    const testPieces = [
                        { type: 'pawn', offset: { x: 2, z: 0 } },
                        { type: 'pawn', offset: { x: -2, z: 0 } },
                        { type: 'rook', offset: { x: 0, z: 2 } }
                    ];
                    
                    testPieces.forEach(pieceData => {
                        const piece = this.gameState.createPiece(
                            player.id,
                            pieceData.type,
                            spawnX + pieceData.offset.x,
                            spawnZ + pieceData.offset.z
                        );
                        player.pieces.push(piece.id);
                        console.log('[Server] Created test piece:', piece);
                    });
                    
                    // Broadcast updated game state to all clients
                    const gameState = this.gameState.getState();
                    this.io.emit('gameState', gameState);
                    console.log('[Server] Test pieces spawned and game state broadcasted');
                } else {
                    console.log('[Server] No player found for socket:', socket.id);
                }
                console.log('=== SPAWN TEST PIECES COMPLETE ===');
            });
            
            // Handle game reset (temporary command)
            socket.on('resetGame', () => {
                console.log('=== RESET GAME EVENT RECEIVED ===');
                console.log('[Server] Reset game request received from socket:', socket.id);
                console.log('[Server] Current pieces before reset:', this.gameState.pieces.size);
                console.log('[Server] Current players before reset:', this.gameState.players.size);
                
                this.gameState.resetGame();
                
                // Broadcast empty game state to ALL clients
                const gameState = this.gameState.getState();
                console.log('[Server] Broadcasting empty game state to all clients');
                console.log('[Server] Empty state pieces count:', gameState.pieces?.length || 0);
                console.log('[Server] Empty state players count:', gameState.players?.length || 0);
                
                this.io.emit('gameState', gameState);
                console.log('[Server] Game reset and empty state broadcasted to all clients');
                console.log('=== RESET GAME COMPLETE ===');
            });
            
            // Handle disconnection
            socket.on('disconnect', () => {
                console.log(`Player disconnected: ${socket.id}`);
                this.gameState.removePlayer(socket.id);
                this.io.emit('playerDisconnected', { playerId: socket.id });
            });
        });
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`Chessopia server running on port ${this.port}`);
            console.log(`Open http://localhost:${this.port} to play`);
        });
    }
}

// Start the server
const server = new ChessopiaServer();
server.start();
