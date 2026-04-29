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
        this.terrainGenerator.generateTrees(50); // Generate trees for consistent blocking
        this.gameState = new GameState(this.terrainGenerator);
        this.moveValidator = new MoveValidator();
        
        // Set up general change detection
        this.gameState.setChangeCallback((changeType, data) => {
            console.log(`[Server] Game state change detected: ${changeType}`, data);
            this.broadcastGameStateChange(changeType, data);
        });
        
        // World storage
        this.worldDataPath = path.join(__dirname, 'world-data-v2.json');
        this.worldSeed = null;
        this.terrainCache = new Map(); // Cache terrain chunks in memory
        
        // Game time tracker (server-side authoritative time)
        this.gameStartTime = Date.now();
        this.dayLength = 60000; // 60 seconds per full day/night cycle
        
        // Error forwarding system
        this.setupErrorInterceptor();
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
        this.initializeWorld();
    }
    
    // Setup error interceptor to forward server errors to clients
    setupErrorInterceptor() {
        // Override console.error to catch and forward errors
        const originalConsoleError = console.error;
        const originalConsoleLog = console.log;
        
        console.error = (...args) => {
            // Call original console.error
            originalConsoleError.apply(console, args);
            
            // Forward error to clients
            const errorMessage = args.join(' ');
            this.forwardErrorToClient('error', errorMessage);
        };
        
        // Also catch uncaught exceptions
        process.on('uncaughtException', (error) => {
            originalConsoleError('Uncaught Exception:', error);
            this.forwardErrorToClient('uncaught', error.message + '\n' + error.stack);
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            originalConsoleError('Unhandled Rejection at:', promise, 'reason:', reason);
            this.forwardErrorToClient('rejection', `Unhandled rejection: ${reason}`);
        });
    }
    
    // Forward error to all connected clients
    forwardErrorToClient(type, message) {
        console.log(`[Server] Forwarding ${type} error to clients:`, message);
        this.io.emit('server-error', {
            type: type,
            message: message,
            timestamp: new Date().toISOString()
        });
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
        this.app.use('/Images', express.static(path.join(__dirname, 'Images')));
    }
    
    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'client/index.html'));
        });
        
        // Favicon route to prevent 404 errors
        this.app.get('/favicon.ico', (req, res) => {
            res.status(204).end(); // No content
        });
        
        this.app.get('/api/terrain/:x/:y', (req, res) => {
            const { x, y } = req.params;
            const height = this.terrainGenerator.getHeight(parseInt(x), parseInt(y));
            const isBlocked = this.terrainGenerator.isTileBlocked(parseInt(x), parseInt(y));
            res.json({ height, isBlocked });
        });
        
        // Endpoint for getting tree data (for consistent client/server blocking)
        this.app.get('/api/trees', (req, res) => {
            const trees = Array.from(this.terrainGenerator.trees.entries()).map(([key, data]) => {
                const [x, y] = key.split(',').map(Number);
                return { x, y };
            });
            console.log(`[Server] Sent tree data: ${trees.length} trees`);
            res.json({ trees });
        });
        
        // Endpoint for getting chunk data with blocked information
        this.app.get('/api/terrain/chunk/:chunkX/:chunkZ', (req, res) => {
            const { chunkX, chunkZ } = req.params;
            const chunkKey = `${chunkX},${chunkZ}`;
            console.log(`[Server] Chunk request received: (${chunkX}, ${chunkZ})`);
            
            // Check cache first
            if (this.chunkCache.has(chunkKey)) {
                console.log(`[Server] Chunk ${chunkKey} found in cache`);
                return res.json(this.chunkCache.get(chunkKey));
            }
            
            // Generate chunk on-demand
            const chunkData = this.terrainGenerator.getChunkData(parseInt(chunkX), parseInt(chunkZ));
            console.log(`[Server] Generated chunk data with ${chunkData.length} tiles for (${chunkX}, ${chunkZ})`);
            
            // Cache the chunk
            this.chunkCache.set(chunkKey, chunkData);
            
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
        
        // Endpoint for testing server error forwarding
        this.app.post('/api/test-error', (req, res) => {
            console.error('TEST ERROR: This is a test error from the server!');
            res.json({ 
                success: true,
                message: 'Test error triggered'
            });
        });
        
        // Endpoint for testing client error forwarding
        this.app.post('/api/test-client-error', (req, res) => {
            res.json({ 
                success: true,
                message: 'Test client error triggered'
            });
        });
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`Player connected: ${socket.id}`);
            
            // Send current game time on connection
            socket.emit('timeSync', this.getGameTime());
            
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
            
            // Handle initial army request
            socket.on('requestInitialArmy', () => {
                console.log('=== REQUEST INITIAL ARMY EVENT RECEIVED ===');
                console.log('[Server] Initial army request received from socket:', socket.id);
                
                const player = this.gameState.players.get(socket.id);
                if (player) {
                    // Find valid spawn positions (not blocked)
                    const validPositions = [];
                    const searchRadius = 15;
                    
                    for (let x = -searchRadius; x <= searchRadius; x++) {
                        for (let z = -searchRadius; z <= searchRadius; z++) {
                            if (this.isValidSpawnPositionForServer(x, z)) {
                                validPositions.push({ x, z });
                            }
                        }
                    }
                    
                    if (validPositions.length === 0) {
                        console.log('[Server] No valid spawn positions found - all terrain is blocked');
                        return;
                    }
                    
                    console.log(`[Server] Found ${validPositions.length} valid spawn positions`);
                    
                    // Create proper chess army
                    const initialArmy = [
                        { type: 'king' },
                        { type: 'queen' },
                        { type: 'rook' },
                        { type: 'rook' },
                        { type: 'bishop' },
                        { type: 'bishop' },
                        { type: 'knight' },
                        { type: 'knight' },
                        { type: 'pawn' },
                        { type: 'pawn' },
                        { type: 'pawn' },
                        { type: 'pawn' },
                        { type: 'pawn' },
                        { type: 'pawn' },
                        { type: 'pawn' },
                        { type: 'pawn' }
                    ];
                    
                    // Pick a random valid position for king first
                    const kingIndex = Math.floor(Math.random() * validPositions.length);
                    const kingPos = validPositions[kingIndex];
                    validPositions.splice(kingIndex, 1); // Remove used position
                    
                    // Spawn king first
                    const king = this.gameState.createPiece(
                        player.id,
                        'king',
                        kingPos.x,
                        kingPos.z
                    );
                    player.pieces.push(king.id);
                    player.kingPosition = { x: kingPos.x, z: kingPos.z };
                    console.log(`[Server] Created king at (${kingPos.x}, ${kingPos.z}):`, king);
                    
                    // Spawn remaining army pieces clustered around king
                    initialArmy.slice(1).forEach(pieceData => {
                        if (validPositions.length > 0) {
                            // Find position closest to the king for team clustering
                            let bestPosition = null;
                            let bestPriority = -1;
                            let bestIndex = -1;
                            
                            validPositions.forEach((pos, index) => {
                                const distance = Math.sqrt(
                                    Math.pow(pos.x - kingPos.x, 2) + 
                                    Math.pow(pos.z - kingPos.z, 2)
                                );
                                
                                // Priority system for team clustering
                                let priority = 0;
                                
                                // Highest priority: Immediate adjacent squares (1-2 tiles away)
                                if (distance >= 1 && distance <= 2) {
                                    priority = 100;
                                }
                                // Medium priority: Very close squares (2-4 tiles away)  
                                else if (distance >= 2 && distance <= 4) {
                                    priority = 50;
                                }
                                // Low priority: Close squares (4-6 tiles away) - maximum allowed distance
                                else if (distance >= 4 && distance <= 6) {
                                    priority = 10;
                                }
                                // Positions beyond 6 tiles get priority 0 (excluded from consideration)
                                else {
                                    priority = 0;
                                }
                                
                                // Add small randomness within same priority level
                                const randomFactor = Math.random() * 0.5;
                                const adjustedPriority = priority + randomFactor;
                                
                                // Debug logging for distance tracking
                                if (priority > 0) {
                                    console.log(`[Server] Position (${pos.x}, ${pos.z}): distance=${distance.toFixed(1)}, priority=${priority}, adjusted=${adjustedPriority.toFixed(2)}`);
                                }
                                
                                if (adjustedPriority > bestPriority) {
                                    bestPriority = adjustedPriority;
                                    bestPosition = pos;
                                    bestIndex = index;
                                }
                            });
                            
                            console.log(`[Server] Best position selected: (${bestPosition?.x}, ${bestPosition?.z}) with priority ${bestPriority.toFixed(2)}`);
                            
                            // Reject positions beyond 6 tiles
                            if (bestPosition) {
                                const finalDistance = Math.sqrt(
                                    Math.pow(bestPosition.x - kingPos.x, 2) + 
                                    Math.pow(bestPosition.z - kingPos.z, 2)
                                );
                                if (finalDistance > 6) {
                                    console.warn(`[Server] REJECTED position beyond 6 tiles: distance=${finalDistance.toFixed(1)}`);
                                    // Find a closer position or skip this piece
                                    bestPosition = null;
                                }
                            }
                            
                            if (bestPosition) {
                                validPositions.splice(bestIndex, 1); // Remove used position
                                
                                const piece = this.gameState.createPiece(
                                    player.id,
                                    pieceData.type,
                                    bestPosition.x,
                                    bestPosition.z
                                );
                                player.pieces.push(piece.id);
                                const actualDistance = Math.sqrt(Math.pow(bestPosition.x - kingPos.x, 2) + Math.pow(bestPosition.z - kingPos.z, 2));
                                console.log(`[Server] Created ${pieceData.type} at distance ${actualDistance.toFixed(1)} from king (${bestPosition.x}, ${bestPosition.z}):`, piece);
                            }
                        } else {
                            console.log(`[Server] No valid positions left for ${pieceData.type}`);
                        }
                    });
                    
                    console.log(`[Server] Total pieces created for player: ${player.pieces.length}`);
                    
                    // Broadcast updated game state to all clients
                    this.io.emit('gameState', this.gameState.getGameState());
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
                            if (this.isValidSpawnPositionForServer(x, z)) {
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
            
            // Handle console logs from client
            socket.on('consoleLogs', (logsData) => {
                console.log(`\n=== CONSOLE LOGS FROM CLIENT ${socket.id} ===`);
                console.log(`Client: ${logsData.clientInfo.userAgent}`);
                console.log(`URL: ${logsData.clientInfo.url}`);
                console.log(`Buffer size: ${logsData.clientInfo.bufferSize}/${logsData.clientInfo.maxBufferSize}`);
                console.log(`Timestamp: ${logsData.clientInfo.timestamp}`);
                
                // Display recent logs (last 20 entries to avoid spam)
                const recentLogs = logsData.buffer.slice(-20);
                console.log(`\n--- Recent Console Entries (${recentLogs.length} of ${logsData.buffer.length}) ---`);
                
                recentLogs.forEach(entry => {
                    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
                    const level = entry.level.toUpperCase().padEnd(5);
                    console.log(`[${timestamp}] ${level} ${entry.message}`);
                });
                
                console.log(`=== END CONSOLE LOGS FROM ${socket.id} ===\n`);
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
            console.log('[Server] Initializing world with on-demand generation...');
            
            // Try to load existing world data for seed
            const worldData = await this.loadWorldData();
            
            if (worldData) {
                console.log('[Server] Loaded existing world with seed:', worldData.seed);
                this.worldSeed = worldData.seed;
            } else {
                // Generate new seed
                this.worldSeed = Math.floor(Math.random() * 1000000);
                console.log('[Server] No existing world found, using new seed:', this.worldSeed);
            }
            
            // Initialize terrain generator with seed
            this.terrainGenerator.setSeed(this.worldSeed);
            
            // Initialize empty world data structure
            this.worldData = {
                seed: this.worldSeed,
                chunks: {},
                worldBounds: {
                    minX: -400,
                    maxX: 400,
                    minZ: -400,
                    maxZ: 400
                }
            };
            
            // Initialize chunk cache
            this.chunkCache = new Map();
            
            console.log('[Server] World initialization complete - chunks will be generated on-demand');
        } catch (error) {
            console.error('[Server] Error initializing world:', error);
            // Fallback: generate new seed
            this.worldSeed = Math.floor(Math.random() * 1000000);
            this.terrainGenerator.setSeed(this.worldSeed);
            this.worldData = {
                seed: this.worldSeed,
                chunks: {},
                worldBounds: {
                    minX: -400,
                    maxX: 400,
                    minZ: -400,
                    maxZ: 400
                }
            };
            this.chunkCache = new Map();
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
    
    async saveGeneratedWorldData() {
        try {
            const worldData = {
                seed: this.worldSeed,
                worldData: this.worldData,
                terrainCache: Array.from(this.terrainCache.entries()),
                savedAt: new Date().toISOString(),
                fullyGenerated: true
            };
            
            await fs.writeFile(this.worldDataPath, JSON.stringify(worldData, null, 2));
            console.log('[Server] Generated world data saved');
        } catch (error) {
            console.error('[Server] Error saving generated world data:', error);
        }
    }
    
    async generateNewWorld() {
        console.log('[Server] Generating new world...');
        
        // Generate new seed
        this.worldSeed = Math.floor(Math.random() * 1000000);
        
        // Set seed for deterministic generation
        this.terrainGenerator.setSeed(this.worldSeed);
        
        // Clear cache
        this.chunkCache.clear();
        
        // Initialize empty world data structure
        this.worldData = {
            seed: this.worldSeed,
            chunks: {},
            worldBounds: {
                minX: -400,
                maxX: 400,
                minZ: -400,
                maxZ: 400
            }
        };
        
        // Save the seed for persistence
        await this.saveWorldData();
        
        console.log('[Server] New world generated with seed:', this.worldSeed);
        
        // Notify all clients to refresh terrain
        this.io.emit('worldRegenerated', { seed: this.worldSeed });
        
        // No background generation - chunks will be generated on-demand
        console.log('[Server] Chunks will be generated on-demand as requested');
    }

    isValidSpawnPositionForServer(x, z) {
        // Server-side validation: check if tile is blocked (where trees will grow)
        // This prevents pieces from spawning on tree locations
        if (this.terrainGenerator.isTileBlocked(x, z)) {
            return false;
        }
        
        // Additional check for extreme slopes (>85°) that are definitely unplayable
        const height = this.terrainGenerator.getHeight(x, z);
        const slope = this.terrainGenerator.calculateSlope(x, z, height);
        if (slope > 85) {
            return false;
        }
        
        return true;
    }
    
    // Console debugging methods
    requestConsoleLogs(socketId = null) {
        console.log('[Server] Requesting console logs from clients...');
        
        if (socketId) {
            // Request from specific client
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
                console.log(`[Server] Requesting logs from specific client: ${socketId}`);
                socket.emit('requestConsoleLogs');
            } else {
                console.log(`[Server] Client ${socketId} not found`);
            }
        } else {
            // Request from all connected clients
            const clientCount = this.io.sockets.sockets.size;
            console.log(`[Server] Requesting logs from all ${clientCount} connected clients`);
            this.io.emit('requestConsoleLogs');
        }
    }
    
    // Add console debugging command handler
    setupConsoleCommands() {
        // Set up stdin listener for console commands
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', (key) => {
            // Ctrl+C to quit
            if (key === '\u0003') {
                process.exit();
            }
            // Press 'c' to request console logs
            if (key === 'c') {
                this.requestConsoleLogs();
            }
            // Press 'C' (Shift+c) to request from all clients with details
            if (key === 'C') {
                console.log('\n[Server] === CONSOLE DEBUG COMMAND ===');
                console.log('Connected clients:');
                this.io.sockets.sockets.forEach((socket, id) => {
                    console.log(`  - ${id} (connected: ${socket.connected})`);
                });
                this.requestConsoleLogs();
                console.log('[Server] Press \'c\' for quick logs, \'C\' for detailed logs\n');
            }
        });
        
        console.log('[Server] Console debugging enabled:');
        console.log('  Press \'c\' to request console logs from all clients');
        console.log('  Press \'C\' to request logs with client details');
        console.log('  Press Ctrl+C to quit');
    }

    start(port = 3000) {
        console.log(`[Server] Chessopia server starting on port ${port}`);
        this.server.listen(port, () => {
            console.log(`[Server] Server listening on port ${port}`);
            // Enable console debugging commands
            this.setupConsoleCommands();
            
            // Start periodic time sync broadcasts
            this.startTimeSync();
            
            // Test console forwarding after 5 seconds
            setTimeout(() => {
                console.log('\n[Server] === TESTING CONSOLE FORWARDING ===');
                this.requestConsoleLogs();
            }, 5000);
        });
    }
    
    getGameTime() {
        // Return current game time in milliseconds since game start
        return {
            elapsedTime: Date.now() - this.gameStartTime,
            dayLength: this.dayLength
        };
    }
    
    startTimeSync() {
        // Broadcast game time every 5 seconds
        setInterval(() => {
            const gameTime = this.getGameTime();
            this.io.emit('timeSync', gameTime);
        }, 5000);
    }
}

    // ... (rest of the code remains the same)
const server = new ChessopiaServer();
server.start();
