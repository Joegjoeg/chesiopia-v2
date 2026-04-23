const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
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
        this.terrainGenerator = new TerrainGenerator();
        this.gameState = new GameState(this.terrainGenerator);
        this.moveValidator = new MoveValidator();
        
        // Set up general change detection
        this.gameState.setChangeCallback((changeType, data) => {
            console.log(`[Server] Game state change detected: ${changeType}`, data);
            this.broadcastGameStateChange(changeType, data);
        });
        
        // World storage
        this.worldDataPath = path.join(__dirname, 'world-data.json');
        this.worldSeed = null;
        this.terrainCache = new Map(); // Cache terrain chunks in memory
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
        this.initializeWorld();
        
        // Start background chunk pre-generation
        this.startBackgroundChunkGeneration();
    }
    
    // General method to broadcast any game state change to all clients
    broadcastGameStateChange(changeType, data) {
        console.log(`[Server] BROADCASTING CHANGE: ${changeType}`);
        console.log(`[Server] Change data:`, data);
        console.log(`[Server] Connected clients: ${this.io.sockets.sockets.size}`);
        
        switch (changeType) {
            case 'gameReset':
                console.log('[Server] Broadcasting gameReset - full game state');
                this.io.emit('gameState', this.gameState.getState());
                break;
            case 'playerAdded':
                console.log(`[Server] Broadcasting playerAdded: ${data.player.name}`);
                console.log(`[Server] Player pieces count: ${data.pieces.length}`);
                this.io.emit('playerJoined', data.player);
                // Broadcast new player's pieces
                data.pieces.forEach((piece, index) => {
                    console.log(`[Server] Broadcasting piece ${index + 1}/${data.pieces.length}:`, piece);
                    console.log(`[Server] Broadcasting to ALL clients via this.io.emit:`, piece);
                    this.io.emit('pieceAdded', piece);
                    console.log(`[Server] pieceAdded emit completed for piece ${piece.id}`);
                });
                break;
            case 'pieceMoved':
                console.log(`[Server] Broadcasting pieceMoved: ${data.piece.id} to (${data.toX}, ${data.toZ})`);
                this.io.emit('pieceMoved', data);
                break;
            case 'piecePurchased':
                console.log(`[Server] Broadcasting piecePurchased: ${data.piece.type} for player ${data.player.id}`);
                this.io.emit('piecePurchased', { success: true, piece: data.piece });
                break;
            case 'coveringSet':
                console.log(`[Server] Broadcasting coveringSet: ${data.coveringPiece.id} covering ${data.coveredPiece.id}`);
                this.io.emit('coveringSet', { 
                    success: true,
                    coveringPiece: data.coveringPiece,
                    coveredPiece: data.coveredPiece
                });
                break;
            default:
                console.log(`[Server] Unknown change type: ${changeType}`);
        }
    }
    
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'client')));
        this.app.use('/models', express.static(path.join(__dirname, 'models')));
        this.app.use('/Models', express.static(path.join(__dirname, 'Models')));
    }
    
    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'client/index.html'));
        });
        
        this.app.get('/api/terrain/:x/:y', (req, res) => {
            const { x, y } = req.params;
            const height = this.terrainGenerator.getHeight(parseInt(x), parseInt(y));
            const isBlocked = this.terrainGenerator.isTileBlocked(parseInt(x), parseInt(y));
            res.json({ height, isBlocked });
        });
        
        // Endpoint for getting chunk data with blocked information
        this.app.get('/api/terrain/chunk/:chunkX/:chunkZ', (req, res) => {
            const { chunkX, chunkZ } = req.params;
            console.log(`[Server] Chunk request received: (${chunkX}, ${chunkZ})`);
            const chunkData = this.terrainGenerator.getChunkData(parseInt(chunkX), parseInt(chunkZ));
            console.log(`[Server] Generated chunk data with ${chunkData.length} tiles for (${chunkX}, ${chunkZ})`);
            res.json(chunkData);
        });
        
        // Endpoint for recreating the world (dev tool)
        this.app.post('/api/world/recreate', async (req, res) => {
            console.log('[Server] World recreation requested via API');
            try {
                await this.generateNewWorld();
                res.json({ 
                    success: true, 
                    message: 'World regenerated successfully',
                    seed: this.worldSeed 
                });
            } catch (error) {
                console.error('[Server] Error regenerating world:', error);
                res.status(500).json({ 
                    success: false, 
                    message: 'Failed to regenerate world' 
                });
            }
        });
        
        // Endpoint for downloading entire world (single request)
        this.app.get('/api/terrain/world', (req, res) => {
            console.log('[Server] World download request received');
            
            if (!this.worldData) {
                console.log('[Server] World data not ready yet');
                return res.status(503).json({ 
                    error: 'World still generating, please try again' 
                });
            }
            
            const worldSizeKB = JSON.stringify(this.worldData).length / 1024;
            console.log(`[Server] Serving entire world (${worldSizeKB.toFixed(2)} KB)`);
            
            res.json(this.worldData);
        });
        
        // Endpoint for getting current world seed
        this.app.get('/api/world/seed', (req, res) => {
            res.json({ 
                seed: this.worldSeed,
                message: 'Current world seed'
            });
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
                    // Change notification handled by general system
                } else {
                    socket.emit('purchaseFailed', { reason: purchaseResult.reason });
                }
            });
            
            // Handle covering system
            socket.on('setCovering', (coverData) => {
                const { coveringPieceId, coveredPieceId } = coverData;
                
                const result = this.gameState.setCovering(coveringPieceId, coveredPieceId);
                if (result.success) {
                    // Change notification handled by general system
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
                    // Find valid spawn positions (not blocked)
                    const validPositions = [];
                    const searchRadius = 15;
                    
                    for (let x = -searchRadius; x <= searchRadius; x++) {
                        for (let z = -searchRadius; z <= searchRadius; z++) {
                            const isBlocked = this.terrainGenerator.isTileBlocked(x, z);
                            if (!isBlocked) {
                                validPositions.push({ x, z });
                            }
                        }
                    }
                    
                    if (validPositions.length === 0) {
                        console.log('[Server] No valid spawn positions found - all terrain is blocked');
                        return;
                    }
                    
                    console.log(`[Server] Found ${validPositions.length} valid spawn positions`);
                    
                    // Spawn test pieces at valid positions
                    const testPieces = [
                        { type: 'pawn' },
                        { type: 'pawn' },
                        { type: 'rook' }
                    ];
                    
                    testPieces.forEach(pieceData => {
                        // Pick a random valid position
                        const randomIndex = Math.floor(Math.random() * validPositions.length);
                        const position = validPositions[randomIndex];
                        
                        // Remove used position to avoid overlap
                        validPositions.splice(randomIndex, 1);
                        
                        const piece = this.gameState.createPiece(
                            player.id,
                            pieceData.type,
                            position.x,
                            position.z
                        );
                        player.pieces.push(piece.id);
                        console.log(`[Server] Created test piece ${pieceData.type} at (${position.x}, ${position.z}):`, piece);
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
    
    async initializeWorld() {
        try {
            console.log('[Server] Initializing world...');
            
            // Try to load existing world data
            const worldData = await this.loadWorldData();
            
            if (worldData) {
                console.log('[Server] Loaded existing world with seed:', worldData.seed);
                this.worldSeed = worldData.seed;
                this.terrainCache = new Map(worldData.terrainCache || []);
                
                // Initialize terrain generator with saved seed
                this.terrainGenerator.setSeed(this.worldSeed);
            } else {
                console.log('[Server] No existing world found, generating new world...');
                await this.generateNewWorld();
            }
            
            console.log('[Server] World initialization complete');
        } catch (error) {
            console.error('[Server] Error initializing world:', error);
            // Fallback: generate new world
            await this.generateNewWorld();
        }
    }
    
    async loadWorldData() {
        try {
            const data = await fs.readFile(this.worldDataPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('[Server] No world data file found');
                return null;
            }
            throw error;
        }
    }
    
    async saveWorldData() {
        try {
            const worldData = {
                seed: this.worldSeed,
                terrainCache: Array.from(this.terrainCache.entries()),
                savedAt: new Date().toISOString()
            };
            
            await fs.writeFile(this.worldDataPath, JSON.stringify(worldData, null, 2));
            console.log('[Server] World data saved');
        } catch (error) {
            console.error('[Server] Error saving world data:', error);
        }
    }
    
    async generateNewWorld() {
        console.log('[Server] Generating new world...');
        
        // Generate new seed
        this.worldSeed = Math.floor(Math.random() * 1000000);
        
        // Set seed for deterministic generation
        this.terrainGenerator.setSeed(this.worldSeed);
        
        // Clear cache
        this.terrainCache.clear();
        
        // Save the new world
        await this.saveWorldData();
        
        console.log('[Server] New world generated with seed:', this.worldSeed);
        
        // Notify all clients to refresh terrain
        this.io.emit('worldRegenerated', { seed: this.worldSeed });
        
        // Start background chunk pre-generation
        this.startBackgroundChunkGeneration();
    }
    
    startBackgroundChunkGeneration() {
        // Pre-generate entire world for single download
        console.log('[Server] Starting entire world generation...');
        
        const preGenRadius = 25; // Generate 51x51 chunks around origin (much larger world)
        const chunksToPreGen = [];
        
        for (let x = -preGenRadius; x <= preGenRadius; x++) {
            for (let z = -preGenRadius; z <= preGenRadius; z++) {
                chunksToPreGen.push({ x, z });
            }
        }
        
        // Generate entire world in background
        setTimeout(() => {
            this.worldData = {
                seed: this.worldSeed,
                chunks: {},
                worldBounds: {
                    minX: -preGenRadius * 16,
                    maxX: preGenRadius * 16,
                    minZ: -preGenRadius * 16,
                    maxZ: preGenRadius * 16
                }
            };
            
            chunksToPreGen.forEach(chunk => {
                const chunkData = this.terrainGenerator.getChunkData(chunk.x, chunk.z);
                const chunkKey = `${chunk.x},${chunk.z}`;
                this.worldData.chunks[chunkKey] = chunkData;
                
                if (chunksToPreGen.length % 100 === 0) {
                    console.log(`[Server] Generated ${Object.keys(this.worldData.chunks).length}/${chunksToPreGen.length} chunks`);
                }
            });
            
            console.log(`[Server] Entire world generation completed! Generated ${chunksToPreGen.length} chunks`);
            console.log(`[Server] World bounds: X(${this.worldData.worldBounds.minX} to ${this.worldData.worldBounds.maxX}), Z(${this.worldData.worldBounds.minZ} to ${this.worldData.worldBounds.maxZ})`);
            
            // Calculate total world size
            const totalTiles = chunksToPreGen.length * 256; // 256 tiles per chunk
            const worldSizeKB = JSON.stringify(this.worldData).length / 1024;
            console.log(`[Server] Total tiles: ${totalTiles}, World data size: ${worldSizeKB.toFixed(2)} KB`);
        }, 1000); // Start after 1 second
    }

    start(port = 3000) {
        console.log(`[Server] Chessopia server starting on port ${port}`);
        this.server.listen(port, () => {
            console.log(`[Server] Server listening on port ${port}`);
        });
    }
}

    // ... (rest of the code remains the same)
const server = new ChessopiaServer();
server.start();
