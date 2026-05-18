require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const GameState = require('./gameState');
const MoveValidator = require('./moveValidator');
const TerrainGenerator = require('./terrain');
const AuthManager = require('./auth');
const EmailService = require('./emailService');
const { EnvironmentalSimulation } = require('./environmentalSimulation');

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
        
        // Auth system
        this.emailService = new EmailService();
        this.authManager = new AuthManager(this.emailService);
        
        // Set up general change detection
        this.gameState.setChangeCallback((changeType, data) => {
            console.log(`[Server] Game state change detected: ${changeType}`, data);
            this.broadcastGameStateChange(changeType, data);
        });
        
        // World storage
        this.worldDataPath = path.join(__dirname, 'world-data-v2.json');
        this.parameterDefaultsPath = path.join(__dirname, 'parameter-defaults.json');
        this.worldSeed = null;
        this.terrainCache = new Map(); // Cache terrain chunks in memory
        
        // Game time tracker (server-side authoritative time)
        // epoch: real-world timestamp representing game time = 0
        // dayLength: real milliseconds per game day (default 60s)
        this.dayLength = 60000;

        // Initialize epoch so current real-world date/time maps to game time
        const nowMs = Date.now();
        const realNow = new Date();
        const startOfYear = new Date(realNow.getFullYear(), 0, 0);
        const realDayOfYear = Math.floor((realNow - startOfYear) / (1000 * 60 * 60 * 24));
        const gameDayOfYear = Math.floor((realDayOfYear / 365) * 120);
        const gameYear = 1;
        const timeOfDay = (realNow.getHours() + realNow.getMinutes() / 60) / 24;
        const totalGameDays = (gameYear - 1) * 120 + gameDayOfYear + timeOfDay;
        this.epoch = nowMs - (totalGameDays * this.dayLength);
        
        // Error forwarding system
        this.setupErrorInterceptor();
        
        // Initialize auth (async)
        this.authManager.init().catch(err => console.error('[Server] Auth init error:', err));
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
        this.initializeWorld();
        this.envSimulation = null;
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
        
        // Configure static file serving with proper MIME types
        const clientStatic = express.static(path.join(__dirname, 'client'), {
            setHeaders: (res, filePath) => {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                const ext = path.extname(filePath);
                if (ext === '.css') {
                    res.setHeader('Content-Type', 'text/css');
                } else if (ext === '.js') {
                    res.setHeader('Content-Type', 'application/javascript');
                } else if (ext === '.html') {
                    res.setHeader('Content-Type', 'text/html');
                }
            }
        });
        this.app.use(clientStatic);
        
        this.app.use('/models', express.static(path.join(__dirname, 'models')));
        this.app.use('/Models', express.static(path.join(__dirname, 'Models')));
        this.app.use('/Images', express.static(path.join(__dirname, 'Images')));

        // Shared modules available to client
        this.app.get('/moveValidator.js', (req, res) => {
            res.sendFile(path.join(__dirname, 'moveValidator.js'));
        });
    }
    
    setupRoutes() {
        // Auth routes
        this.setupAuthRoutes();
        
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
                return {
                    x, y,
                    biome: data.biome || 'unknown',
                    maxScale: data.maxScale || 1.0,
                    growthRate: data.growthRate || 1.0,
                    species: data.species || 'terrain'
                };
            });
            console.log(`[Server] Sent tree data: ${trees.length} trees`);
            res.json({ trees });
        });

        // Endpoint for getting trees within a specific chunk (for on-demand loading)
        this.app.get('/api/trees/chunk/:chunkX/:chunkZ', (req, res) => {
            const cX = parseInt(req.params.chunkX);
            const cZ = parseInt(req.params.chunkZ);
            // Ensure trees are generated for this chunk before fetching
            const added = this.terrainGenerator.generateTreesForChunk(cX, cZ);
            const trees = this.terrainGenerator.getTreesForChunk(cX, cZ);
            if (added > 0 || trees.length > 0) {
                console.log(`[Server] /api/trees/chunk/${cX}/${cZ} generated ${added}, returning ${trees.length}`);
            }
            res.json({ trees });
        });

        // Endpoint for getting chunk data with blocked information
        this.app.get('/api/terrain/chunk/:chunkX/:chunkZ', (req, res) => {
            const { chunkX, chunkZ } = req.params;
            const chunkKey = `${chunkX},${chunkZ}`;
            console.log(`[Server] Chunk request received: (${chunkX}, ${chunkZ})`);
            
            // Check cache first
            if (this.terrainCache.has(chunkKey)) {
                console.log(`[Server] Chunk ${chunkKey} found in cache`);
                return res.json(this.terrainCache.get(chunkKey));
            }
            
            // Update celestial angles before generation (snapshot current time)
            const elapsed = Date.now() - this.epoch;
            const dayLength = this.dayLength || 60000;
            const sunAngle = (elapsed / dayLength) * 2 * Math.PI - Math.PI / 2;
            const moonPeriod = 28 * dayLength;
            const moonAngle = ((elapsed % moonPeriod) / moonPeriod) * 2 * Math.PI - Math.PI / 2;
            this.terrainGenerator.setCelestialAngles(sunAngle, moonAngle);

            // Generate chunk on-demand
            const cX = parseInt(chunkX);
            const cZ = parseInt(chunkZ);
            const chunkData = this.terrainGenerator.getChunkData(cX, cZ);
            
            // Blend edges with adjacent cached chunks for smooth boundaries
            const chunkSize = 16;
            const neighbors = {
                north: this.terrainCache.get(`${cX},${cZ - 1}`) || null,
                south: this.terrainCache.get(`${cX},${cZ + 1}`) || null,
                west:  this.terrainCache.get(`${cX - 1},${cZ}`) || null,
                east:  this.terrainCache.get(`${cX + 1},${cZ}`) || null,
            };
            if (neighbors.north || neighbors.south || neighbors.west || neighbors.east) {
                this.terrainGenerator.blendChunkEdges(chunkData, cX, cZ, chunkSize, neighbors);
                console.log(`[Server] Blended chunk edges for (${cX}, ${cZ}) with cached neighbors`);
            }
            
            // Inject environmental simulation fields into chunk tiles
            if (this.envSimulation) {
                for (const tile of chunkData) {
                    const field = this.envSimulation.envFields.get(`${tile.x},${tile.z}`);
                    if (field) {
                        tile.pressure = field.pressure;
                        tile.moisture = field.humidity;
                        tile.temperature = field.temperature;
                    }
                }
            }

            console.log(`[Server] Generated chunk data with ${chunkData.length} tiles for (${cX}, ${cZ})`);

            // Cache the chunk
            this.terrainCache.set(chunkKey, chunkData);

            res.json(chunkData);
        });
        
        // Endpoint for probe requests (client foreknowledge of distant terrain)
        this.app.get('/api/terrain/probe', (req, res) => {
            const x = parseFloat(req.query.x);
            const z = parseFloat(req.query.z);
            const radius = parseFloat(req.query.radius) || 48;
            const profile = req.query.profile || 'smooth';

            if (isNaN(x) || isNaN(z)) {
                return res.status(400).json({ error: 'x and z query params required' });
            }

            // Update celestial angles before probe generation
            const elapsed = Date.now() - this.epoch;
            const dayLength = this.dayLength || 60000;
            const sunAngle = (elapsed / dayLength) * 2 * Math.PI - Math.PI / 2;
            const moonPeriod = 28 * dayLength;
            const moonAngle = ((elapsed % moonPeriod) / moonPeriod) * 2 * Math.PI - Math.PI / 2;
            this.terrainGenerator.setCelestialAngles(sunAngle, moonAngle);

            const height = this.terrainGenerator.registerProbe(x, z, { radius, profile });
            console.log(`[Server] Probe registered at (${x}, ${z}) height=${height.toFixed(2)} radius=${radius} profile=${profile}`);
            res.json({ x, z, height, radius, profile });
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
        
        // Endpoint for environmental field data
        this.app.get('/api/environment/fields', (req, res) => {
            if (!this.envSimulation) {
                return res.status(503).json({ error: 'Environmental simulation not ready' });
            }
            const minX = parseFloat(req.query.minX) || -50;
            const minZ = parseFloat(req.query.minZ) || -50;
            const maxX = parseFloat(req.query.maxX) || 50;
            const maxZ = parseFloat(req.query.maxZ) || 50;
            const avg = req.query.avg === 'true';
            
            if (avg) {
                const fields = this.envSimulation.getAverageFieldInRegion(minX, minZ, maxX, maxZ);
                res.json(fields);
            } else {
                const fields = this.envSimulation.getFieldsInRegion(minX, minZ, maxX, maxZ);
                res.json({ fields, tickCount: this.envSimulation.tickCount });
            }
        });
        
        // Endpoint for agent positions (debug)
        this.app.get('/api/environment/agents', (req, res) => {
            if (!this.envSimulation) {
                return res.status(503).json({ error: 'Environmental simulation not ready' });
            }
            res.json({ agents: this.envSimulation.getAgentPositions() });
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
        
        // Endpoint for getting saved parameter defaults
        this.app.get('/api/defaults', async (req, res) => {
            console.log(`[Server] GET /api/defaults from ${req.ip}`);
            try {
                const data = await fs.readFile(this.parameterDefaultsPath, 'utf8');
                const parsed = JSON.parse(data);
                console.log(`[Server] GET /api/defaults -> ${Object.keys(parsed).length} keys`);
                res.json(parsed);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log('[Server] GET /api/defaults -> no file yet, returning {}');
                    res.json({});
                } else {
                    console.error('[Server] Error reading parameter defaults:', error);
                    res.status(500).json({ error: 'Failed to read defaults' });
                }
            }
        });

        // Endpoint for saving parameter defaults (only overridden values)
        this.app.post('/api/defaults', async (req, res) => {
            console.log(`[Server] POST /api/defaults from ${req.ip}`);
            try {
                const defaults = req.body;
                console.log('[Server] POST body keys:', Object.keys(defaults));
                if (!defaults || typeof defaults !== 'object') {
                    console.warn('[Server] POST /api/defaults rejected: invalid payload');
                    return res.status(400).json({ error: 'Invalid defaults payload' });
                }
                await fs.writeFile(this.parameterDefaultsPath, JSON.stringify(defaults, null, 2));
                console.log(`[Server] Saved ${Object.keys(defaults).length} parameter defaults to ${this.parameterDefaultsPath}`);
                res.json({ success: true, message: 'Defaults saved' });
            } catch (error) {
                console.error('[Server] Error saving parameter defaults:', error);
                res.status(500).json({ error: 'Failed to save defaults' });
            }
        });

        // Endpoint for clearing saved parameter defaults
        this.app.delete('/api/defaults', async (req, res) => {
            console.log(`[Server] DELETE /api/defaults from ${req.ip}`);
            try {
                await fs.unlink(this.parameterDefaultsPath);
                console.log('[Server] Parameter defaults cleared');
                res.json({ success: true, message: 'Defaults cleared' });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log('[Server] DELETE /api/defaults -> no file to delete');
                    res.json({ success: true, message: 'No defaults to clear' });
                } else {
                    console.error('[Server] Error clearing parameter defaults:', error);
                    res.status(500).json({ error: 'Failed to clear defaults' });
                }
            }
        });
    }
    
    setupAuthRoutes() {
        const app = this.app;
        const auth = this.authManager;
        
        // Register - request verification code
        app.post('/api/auth/register', async (req, res) => {
            const { email, username, password } = req.body;
            console.log(`[Auth] Register request for ${email}`);
            
            if (!email || !username || !password) {
                return res.status(400).json({ success: false, error: 'Email, username, and password required.' });
            }
            
            const result = await auth.requestVerification(email, username, password);
            res.status(result.success ? 200 : 400).json(result);
        });
        
        // Verify email code
        app.post('/api/auth/verify', async (req, res) => {
            const { email, code } = req.body;
            console.log(`[Auth] Verify request for ${email}`);
            
            if (!email || !code) {
                return res.status(400).json({ success: false, error: 'Email and code required.' });
            }
            
            const result = await auth.verifyCode(email, code);
            res.status(result.success ? 200 : 400).json(result);
        });
        
        // Login
        app.post('/api/auth/login', async (req, res) => {
            const { email, username, identifier, password } = req.body;
            const loginIdentifier = identifier || email || username;
            console.log(`[Auth] Login request for ${loginIdentifier}`);
            
            if (!loginIdentifier || !password) {
                return res.status(400).json({ success: false, error: 'Email/username and password required.' });
            }
            
            const result = await auth.login(loginIdentifier, password);
            res.status(result.success ? 200 : 401).json(result);
        });
        
        // Get current user
        app.get('/api/auth/me', (req, res) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            
            const token = authHeader.substring(7);
            const result = auth.verifyToken(token);
            
            if (!result.valid) {
                return res.status(401).json({ error: 'Invalid or expired token' });
            }
            
            const user = auth.getUserById(result.userId);
            if (!user) {
                return res.status(401).json({ error: 'User not found' });
            }
            
            res.json({ success: true, user });
        });
        
        // Logout (mainly client-side token clear, but we can log it)
        app.post('/api/auth/logout', (req, res) => {
            res.json({ success: true, message: 'Logged out' });
        });
    }
    
    setupSocketHandlers() {
        // Socket auth middleware
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth?.token;
                
                if (!token) {
                    // Allow guest connections
                    const guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
                    socket.data.user = {
                        id: guestId,
                        username: 'Guest',
                        email: 'guest@local',
                        role: 'guest'
                    };
                    console.log(`[Auth] Socket ${socket.id} connected as guest`);
                    next();
                    return;
                }
                
                const result = this.authManager.verifyToken(token);
                
                if (!result.valid) {
                    // Allow invalid tokens as guests too (for testing/bypass)
                    const guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
                    socket.data.user = {
                        id: guestId,
                        username: 'Guest',
                        email: 'guest@local',
                        role: 'guest'
                    };
                    console.log(`[Auth] Socket ${socket.id} invalid token, connected as guest`);
                    next();
                    return;
                }
                
                const user = this.authManager.getUserByEmail(result.email);
                if (!user) {
                    return next(new Error('User not found'));
                }
                
                socket.data.user = user;
                console.log(`[Auth] Socket ${socket.id} authenticated as ${user.username} (${user.role})`);
                next();
            } catch (error) {
                console.error('[Auth] Socket auth error:', error);
                next(new Error('Authentication error'));
            }
        });
        
        this.io.on('connection', (socket) => {
            console.log(`Player connected: ${socket.id}`);
            
            // Send current game time on connection
            socket.emit('timeSync', this.getGameTime());

            // Handle time/date parameter changes from clients
            socket.on('updateGameTime', (data) => {
                console.log('[Server] Game time update from client:', data);
                this._ensureValidTimeState();
                const now = Date.now();
                const elapsed = now - this.epoch;

                let currentDayLength = (typeof this.dayLength === 'number' && Number.isFinite(this.dayLength) && this.dayLength > 0)
                    ? this.dayLength
                    : 60000;
                if (currentDayLength !== this.dayLength) {
                    console.warn('[Server] Invalid stored dayLength detected. Resetting to 60000ms. Previous value:', this.dayLength);
                    this.dayLength = currentDayLength;
                }

                const totalDays = elapsed / currentDayLength;

                if (data.dayLength !== undefined) {
                    const requestedDayLength = Number(data.dayLength);
                    if (Number.isFinite(requestedDayLength) && requestedDayLength > 0) {
                        // Preserve current game time when changing speed
                        this.epoch = now - (totalDays * requestedDayLength);
                        this.dayLength = requestedDayLength;
                        currentDayLength = requestedDayLength;
                    } else {
                        console.warn('[Server] Ignoring invalid dayLength from client:', data.dayLength);
                    }
                }
                if (data.timeOfDay !== undefined) {
                    const requestedTime = Number(data.timeOfDay);
                    if (Number.isFinite(requestedTime)) {
                        const clampedTime = Math.max(0, Math.min(24, requestedTime));
                        // Preserve current day/year, change time-of-day only
                        const currentDay = Math.floor(totalDays);
                        const newTotalDays = currentDay + (clampedTime / 24);
                        this.epoch = now - (newTotalDays * this.dayLength);
                    } else {
                        console.warn('[Server] Ignoring invalid timeOfDay from client:', data.timeOfDay);
                    }
                }
                if (data.dayOfYear !== undefined) {
                    const requestedDayOfYear = Number(data.dayOfYear);
                    if (Number.isFinite(requestedDayOfYear)) {
                        // Preserve current year and time-of-day, change day-of-year
                        const normalizedDayOfYear = Math.max(0, Math.min(119, Math.floor(requestedDayOfYear)));
                        const currentYear = Math.floor(totalDays / 120);
                        const currentTimeOfDay = totalDays % 1;
                        const newTotalDays = (currentYear * 120) + normalizedDayOfYear + currentTimeOfDay;
                        this.epoch = now - (newTotalDays * this.dayLength);
                    } else {
                        console.warn('[Server] Ignoring invalid dayOfYear from client:', data.dayOfYear);
                    }
                }
                if (data.year !== undefined) {
                    const requestedYear = Number(data.year);
                    if (Number.isFinite(requestedYear)) {
                        // Preserve current day-of-year and time-of-day, change year
                        const normalizedYear = Math.max(1, Math.floor(requestedYear));
                        const currentDayOfYear = Math.floor(totalDays) % 120;
                        const currentTimeOfDay = totalDays % 1;
                        const newTotalDays = ((normalizedYear - 1) * 120) + currentDayOfYear + currentTimeOfDay;
                        this.epoch = now - (newTotalDays * this.dayLength);
                    } else {
                        console.warn('[Server] Ignoring invalid year from client:', data.year);
                    }
                }

                // Broadcast updated time to all clients
                this.io.emit('timeSync', this.getGameTime());
            });

            // Handle player joining
            socket.on('joinGame', (playerData) => {
                const user = socket.data.user;
                console.log('[Server] Player joining game:', user.username, playerData);
                
                // Use authenticated user data, but allow client to override color if provided
                const enrichedPlayerData = {
                    name: user.username,
                    color: playerData?.color || null,
                    userId: user.id,
                    role: user.role
                };
                
                const player = this.gameState.addPlayer(user.id, enrichedPlayerData);
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
                const userId = socket.data.user.id;
                
                // Ownership check: verify piece belongs to this player
                const piece = this.gameState.pieces.get(pieceId);
                if (!piece) {
                    socket.emit('moveInvalid', { reason: 'Piece not found' });
                    return;
                }
                if (piece.playerId !== userId) {
                    socket.emit('moveInvalid', { reason: 'Not your piece' });
                    return;
                }
                
                // Validate move
                const isValid = this.moveValidator.validateMove(
                    this.gameState,
                    pieceId,
                    fromX,
                    fromZ,
                    toX,
                    toZ
                );
                
                if (isValid.valid) {
                    // Execute move
                    const moveResult = this.gameState.executeMove(pieceId, toX, toZ);
                    
                    // Check for game over conditions
                    const gameOver = this.gameState.checkGameOver();
                    if (gameOver) {
                        this.io.emit('gameOver', gameOver);
                    }
                } else {
                    socket.emit('moveInvalid', { reason: isValid.reason || 'Invalid move' });
                }
            });
            
            // Handle piece purchase
            socket.on('purchasePiece', (purchaseData) => {
                const { pieceType, playerId } = purchaseData;
                const userId = socket.data.user.id;
                
                // Ownership check: must match authenticated user
                if (playerId !== userId) {
                    socket.emit('purchaseFailed', { reason: 'Not your account' });
                    return;
                }
                
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
                const userId = socket.data.user.id;
                
                // Ownership check: both pieces must belong to this player
                const coveringPiece = this.gameState.pieces.get(coveringPieceId);
                const coveredPiece = this.gameState.pieces.get(coveredPieceId);
                if (!coveringPiece || !coveredPiece) {
                    socket.emit('coveringFailed', { reason: 'Piece not found' });
                    return;
                }
                if (coveringPiece.playerId !== userId || coveredPiece.playerId !== userId) {
                    socket.emit('coveringFailed', { reason: 'Can only cover your own pieces' });
                    return;
                }
                
                const result = this.gameState.setCovering(coveringPieceId, coveredPieceId);
                if (result.success) {
                    // Change notification handled by general system
                } else {
                    socket.emit('coveringFailed', { reason: result.reason });
                }
            });
            
            // Handle initial army request
            socket.on('requestInitialArmy', () => {
                const userId = socket.data.user.id;
                console.log('=== REQUEST INITIAL ARMY EVENT RECEIVED ===');
                console.log('[Server] Initial army request received from user:', socket.data.user.username);
                
                const player = this.gameState.players.get(userId);
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
                    this.io.emit('gameState', this.gameState.getState());
                }
            });
            
            // Handle spawn test pieces (temporary command)
            socket.on('spawnTestPieces', () => {
                const userId = socket.data.user.id;
                console.log('=== SPAWN TEST PIECES EVENT RECEIVED ===');
                console.log('[Server] Spawn test pieces request received from user:', socket.data.user.username);
                
                const player = this.gameState.players.get(userId);
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
                const userRole = socket.data.user.role;
                // Only devs can reset the game
                if (userRole !== 'dev') {
                    console.log(`[Server] Reset game denied for non-dev user: ${socket.data.user.username}`);
                    return;
                }
                console.log('=== RESET GAME EVENT RECEIVED ===');
                console.log('[Server] Reset game request received from dev:', socket.data.user.username);
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
            
            // Handle environmental field requests from clients
            socket.on('getEnvFields', (data) => {
                if (!this.envSimulation) {
                    socket.emit('envFields', { error: 'Simulation not ready' });
                    return;
                }
                const { minX, minZ, maxX, maxZ } = data || {};
                const fields = this.envSimulation.getAverageFieldInRegion(
                    minX ?? -50, minZ ?? -50, maxX ?? 50, maxZ ?? 50
                );
                socket.emit('envFields', fields);
            });

            // Handle requests for console logs from any client or admin tool
            socket.on('requestConsoleLogs', () => {
                console.log(`[Server] Console log request from ${socket.id}, broadcasting to all clients`);
                this.io.emit('requestConsoleLogs');
            });
            
            // Handle parameter setting commands from admin interface
            socket.on('setParameter', (data) => {
                const { name, value, targetClientId } = data;
                console.log(`[Server] Parameter set request: ${name} = ${value} from ${socket.id}`);
                
                if (targetClientId && targetClientId !== 'all') {
                    // Send to specific client
                    this.io.to(targetClientId).emit('setParameter', { name, value });
                    console.log(`[Server] Parameter ${name} sent to client ${targetClientId}`);
                } else {
                    // Broadcast to all clients
                    this.io.emit('setParameter', { name, value });
                    console.log(`[Server] Parameter ${name} broadcast to all clients`);
                }
            });
            
            // Handle batch parameter updates
            socket.on('setParameters', (data) => {
                const { parameters, targetClientId } = data;
                console.log(`[Server] Batch parameter set request: ${Object.keys(parameters).length} parameters from ${socket.id}`);
                
                if (targetClientId && targetClientId !== 'all') {
                    // Send to specific client
                    this.io.to(targetClientId).emit('setParameters', parameters);
                    console.log(`[Server] ${Object.keys(parameters).length} parameters sent to client ${targetClientId}`);
                } else {
                    // Broadcast to all clients
                    this.io.emit('setParameters', parameters);
                    console.log(`[Server] ${Object.keys(parameters).length} parameters broadcast to all clients`);
                }
            });
            
            // Handle parameter request from client
            socket.on('getParameters', () => {
                console.log(`[Server] Parameter request from ${socket.id}`);
                // Send current server-side parameter values (if any)
                socket.emit('parametersResponse', this.getCurrentParameters());
            });
            
            // Handle admin commands
            socket.on('adminCommand', (command) => {
                const userRole = socket.data.user.role;
                if (userRole !== 'dev') {
                    console.log(`[Server] Admin command denied for non-dev: ${socket.data.user.username}`);
                    socket.emit('adminResponse', { success: false, message: 'Dev access required' });
                    return;
                }
                console.log(`[Server] Admin command from dev ${socket.data.user.username}:`, command);
                this.handleAdminCommand(command, socket);
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
                const user = socket.data.user;
                console.log(`Player disconnected: ${socket.id} (user: ${user?.username})`);
                if (user) {
                    this.gameState.removePlayer(user.id);
                    this.io.emit('playerDisconnected', { playerId: user.id });
                }
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
            
            // Generate rivers (carve channels into terrain)
            this.terrainGenerator.generateRivers(80);
            
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
            this.terrainGenerator.generateRivers(80);
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

        // Generate rivers
        this.terrainGenerator.generateRivers(80);

        // Clear cache and old trees
        this.terrainCache.clear();
        this.terrainGenerator.probes.clear();
        this.terrainGenerator.trees.clear();

        // Regenerate biome-aware trees for the new seed
        this.terrainGenerator.generateTrees(50);
        
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
            console.log(`[Server] Requesting logs from specific client: ${socketId}`);
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
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
    
    // Parameter management methods
    getCurrentParameters() {
        // Return current server-side parameter values
        return {
            serverTime: Date.now(),
            dayLength: this.dayLength,
            epoch: this.epoch,
            // Add any server-authoritative parameters here
        };
    }
    
    setParameter(name, value, targetClientId = 'all') {
        console.log(`[Server] Setting parameter: ${name} = ${value} for ${targetClientId}`);
        
        if (targetClientId && targetClientId !== 'all') {
            // Send to specific client
            this.io.to(targetClientId).emit('setParameter', { name, value });
        } else {
            // Broadcast to all clients
            this.io.emit('setParameter', { name, value });
        }
    }
    
    setParameters(parameters, targetClientId = 'all') {
        console.log(`[Server] Setting ${Object.keys(parameters).length} parameters for ${targetClientId}`);
        
        if (targetClientId && targetClientId !== 'all') {
            // Send to specific client
            this.io.to(targetClientId).emit('setParameters', parameters);
        } else {
            // Broadcast to all clients
            this.io.emit('setParameters', parameters);
        }
    }
    
    handleAdminCommand(command, socket) {
        const { type, data } = command;
        
        switch (type) {
            case 'setParameter':
                this.setParameter(data.name, data.value, data.targetClientId);
                socket.emit('adminResponse', { success: true, message: `Parameter ${data.name} set to ${data.value}` });
                break;
                
            case 'setParameters':
                this.setParameters(data.parameters, data.targetClientId);
                socket.emit('adminResponse', { success: true, message: `${Object.keys(data.parameters).length} parameters set` });
                break;
                
            case 'getClients':
                const clients = Array.from(this.io.sockets.sockets.keys());
                socket.emit('adminResponse', { success: true, data: { clients } });
                break;
                
            case 'broadcastMessage':
                this.io.emit('adminMessage', data.message);
                socket.emit('adminResponse', { success: true, message: 'Message broadcasted' });
                break;
                
            case 'resetGame':
                this.resetGame();
                socket.emit('adminResponse', { success: true, message: 'Game reset' });
                break;
                
            default:
                socket.emit('adminResponse', { success: false, message: `Unknown command type: ${type}` });
        }
    }
    
    // Add console debugging command handler
    setupConsoleCommands() {
        // Set up stdin listener for console commands (only if TTY available)
        if (!process.stdin.isTTY) {
            console.log('[Server] Non-TTY environment detected, skipping raw mode console commands');
            return;
        }
        try {
            process.stdin.setRawMode(true);
        } catch (error) {
            console.log('[Server] Raw mode not available in this environment, skipping console commands');
            return;
        }
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

            // Start environmental simulation
            this.startEnvSimulation();
            
            // Test console forwarding after 5 seconds
            setTimeout(() => {
                console.log('\n[Server] === TESTING CONSOLE FORWARDING ===');
                this.requestConsoleLogs();
            }, 5000);
        });
    }
    
    getGameTime() {
        this._ensureValidTimeState();
        const now = Date.now();
        const elapsed = now - this.epoch;
        const dayLength = (typeof this.dayLength === 'number' && Number.isFinite(this.dayLength) && this.dayLength > 0)
            ? this.dayLength
            : 60000;

        if (dayLength !== this.dayLength) {
            console.warn('[Server] Invalid dayLength detected when building game time payload. Resetting to 60000ms. Previous value:', this.dayLength);
            this.dayLength = dayLength;
        }

        const totalDays = elapsed / dayLength;
        const year = Math.floor(totalDays / 120) + 1;
        const dayOfYear = Math.floor(totalDays) % 120;
        const timeOfDay = (totalDays % 1) * 24;

        return {
            elapsedTime: elapsed,
            dayLength,
            year,
            dayOfYear,
            timeOfDay
        };
    }

    _ensureValidTimeState() {
        if (!Number.isFinite(this.dayLength) || this.dayLength <= 0) {
            console.warn('[Server] Invalid dayLength detected. Resetting to 60000ms. Previous value:', this.dayLength);
            this.dayLength = 60000;
        }

        if (!Number.isFinite(this.epoch)) {
            console.warn('[Server] Invalid epoch detected. Recomputing from real-world time. Previous value:', this.epoch);
            this._recomputeEpochFromRealWorld();
        }
    }

    _recomputeEpochFromRealWorld() {
        const nowMs = Date.now();
        const realNow = new Date();
        const startOfYear = new Date(realNow.getFullYear(), 0, 0);
        const realDayOfYear = Math.floor((realNow - startOfYear) / (1000 * 60 * 60 * 24));
        const gameDayOfYear = Math.floor((realDayOfYear / 365) * 120);
        const gameYear = 1;
        const timeOfDay = (realNow.getHours() + realNow.getMinutes() / 60) / 24;
        const totalGameDays = (gameYear - 1) * 120 + gameDayOfYear + timeOfDay;
        this.epoch = nowMs - (totalGameDays * this.dayLength);
    }
    
    startTimeSync() {
        // Broadcast game time every 5 seconds
        setInterval(() => {
            const gameTime = this.getGameTime();
            this.io.emit('timeSync', gameTime);
        }, 5000);
    }

    startEnvSimulation() {
        console.log('[Server] Starting environmental simulation...');
        this.envSimulation = new EnvironmentalSimulation(this.terrainGenerator, {
            agentCount: 30,
            tickIntervalMs: 2000,
            bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
            seed: this.worldSeed || 42
        });
        this.envSimulation.init();
        this.envSimulation.start();

        // Tick loop
        this.envSimInterval = setInterval(() => {
            this.envSimulation.tick();
        }, this.envSimulation.tickIntervalMs);

        // Broadcast env fields to all clients every 3 seconds
        this.envBroadcastInterval = setInterval(() => {
            const avg = this.envSimulation.getAverageFieldInRegion(-50, -50, 50, 50);
            this.io.emit('envFields', avg);
        }, 3000);

        console.log('[Server] Environmental simulation started');
    }
}

    // ... (rest of the code remains the same)
const server = new ChessopiaServer();
server.start();
