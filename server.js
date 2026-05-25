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
const SettlementGenerator = require('./server/settlementGenerator');
const SettlementTomeManager = require('./server/settlementTomeManager');
const settlementData = require('./client/settlementData');
const { SETTLEMENT_TYPES, generateSettlementName } = settlementData;
const ClimateInference = require('./climateInference');
const { GroundwaterSystem } = require('./client/groundwaterSystem');

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

        this.settlementGenerator = null;
        this.tomeManager = null;
        this._tomeTickInterval = null;
        
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
        this.terrainShaderPath = path.join(__dirname, 'terrain-shader-config.json');
        this.materialsDir = path.join(__dirname, 'data', 'materials');
        this.materialMappingsPath = path.join(__dirname, 'data', 'material-mappings.json');
        this.worldSeed = null;
        this.terrainCache = new Map(); // Cache terrain chunks in memory (fallback for clients without clientId)

        // Per-client terrain generation: each client can have different orbit scales
        // and therefore sees different terrain. Each client gets their own generator
        // instance (sharing trees/rivers) and their own chunk cache.
        this.clientTerrainGenerators = new Map(); // clientId -> TerrainGenerator
        this.clientTerrainCaches = new Map();     // clientId -> Map(chunkKey -> chunkData)
        this.clientOrbitScales = new Map();       // clientId -> {sunScale, moonScale}
        
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
        
        this.climateInference = new ClimateInference();
        this.envSimulation = null;

        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
        this.initializeWorld();
    }

    /**
     * Get or create a per-client TerrainGenerator.
     * Each client sees their own terrain based on their orbit scales,
     * but shares trees, rivers, and settlement modifications with the base world.
     */
    getClientTerrainGenerator(clientId) {
        if (!clientId) {
            if (this.envSimulation && this.climateInference) {
                this.terrainGenerator.setClimateMemory(this.envSimulation, this.climateInference);
            }
            return { generator: this.terrainGenerator, cache: this.terrainCache };
        }

        if (this.clientTerrainGenerators.has(clientId)) {
            const generator = this.clientTerrainGenerators.get(clientId);
            if (this.envSimulation && this.climateInference) {
                generator.setClimateMemory(this.envSimulation, this.climateInference);
            }
            return { generator, cache: this.clientTerrainCaches.get(clientId) };
        }

        // Create a new generator for this client, sharing immutable world state
        const gen = new TerrainGenerator();
        gen.setSeed(this.worldSeed);
        gen.trees = this.terrainGenerator.trees;
        gen.rivers = this.terrainGenerator.rivers;
        gen.heightModifications = this.terrainGenerator.heightModifications;
        gen.planetMapping = this.terrainGenerator.planetMapping;

        // Apply this client's orbit scales if they've set any
        const scales = this.clientOrbitScales.get(clientId);
        if (scales) {
            gen.setOrbitHeightScales(scales.sunScale, scales.moonScale);
        }

        const cache = new Map();
        this.clientTerrainGenerators.set(clientId, gen);
        this.clientTerrainCaches.set(clientId, cache);

        if (this.envSimulation && this.climateInference) {
            gen.setClimateMemory(this.envSimulation, this.climateInference);
        }

        console.log(`[Server] Created per-client terrain generator for clientId=${clientId}`);
        return { generator: gen, cache };
    }
    
    // Setup error interceptor to forward server errors to clients
    setupErrorInterceptor() {
        // Override console.error to catch and forward errors
        this._originalConsoleError = console.error;
        this._originalConsoleLog = console.log;

        console.error = (...args) => {
            // Call original console.error
            this._originalConsoleError.apply(console, args);

            // Forward error to clients
            const errorMessage = args.join(' ');
            this.forwardErrorToClient('error', errorMessage);
        };

        // Also catch uncaught exceptions
        process.on('uncaughtException', (error) => {
            this._originalConsoleError('Uncaught Exception:', error);
            this.forwardErrorToClient('uncaught', error.message + '\n' + error.stack);
        });

        process.on('unhandledRejection', (reason, promise) => {
            this._originalConsoleError('Unhandled Rejection at:', promise, 'reason:', reason);
            this.forwardErrorToClient('rejection', `Unhandled rejection: ${reason}`);
        });
    }

    // Forward error to all connected clients
    forwardErrorToClient(type, message) {
        if (this._originalConsoleLog) {
            this._originalConsoleLog(`[Server] Forwarding ${type} error to clients:`, message);
        }
        if (!this.io) return;
        try {
            this.io.emit('server-error', {
                type: type,
                message: message,
                timestamp: new Date().toISOString()
            });
        } catch (emitErr) {
            if (this._originalConsoleError) {
                this._originalConsoleError('[Server] Failed to emit server-error:', emitErr);
            }
        }
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
        this.app.use('/test-tools', express.static(path.join(__dirname, 'test-tools')));

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
            const clientId = req.query.clientId || null;
            const { generator } = this.getClientTerrainGenerator(clientId);
            const height = generator.getHeight(parseInt(x), parseInt(y));
            const isBlocked = generator.isTileBlocked(parseInt(x), parseInt(y));
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
            const clientId = req.query.clientId || null;
            const { generator, cache } = this.getClientTerrainGenerator(clientId);
            console.log(`[Server] Chunk request received: (${chunkX}, ${chunkZ}) clientId=${clientId || 'default'}`);
            
            // Check cache first (per-client cache)
            if (cache.has(chunkKey)) {
                console.log(`[Server] Chunk ${chunkKey} found in cache for clientId=${clientId || 'default'}`);
                return res.json(cache.get(chunkKey));
            }
            
            // Generate chunk on-demand
            const cX = parseInt(chunkX);
            const cZ = parseInt(chunkZ);

            if (this.envSimulation) {
                const centerX = cX * 16 + 8;
                const centerZ = cZ * 16 + 8;
                this.envSimulation.updateFocalPoint(centerX, centerZ, clientId || `chunk:${chunkKey}`);
            }
            const chunkData = generator.getChunkData(cX, cZ);
            
            // Blend edges with adjacent cached chunks for smooth boundaries
            const chunkSize = 16;
            const neighbors = {
                north: cache.get(`${cX},${cZ - 1}`) || null,
                south: cache.get(`${cX},${cZ + 1}`) || null,
                west:  cache.get(`${cX - 1},${cZ}`) || null,
                east:  cache.get(`${cX + 1},${cZ}`) || null,
            };
            if (neighbors.north || neighbors.south || neighbors.west || neighbors.east) {
                generator.blendChunkEdges(chunkData, cX, cZ, chunkSize, neighbors);
                console.log(`[Server] Blended chunk edges for (${cX}, ${cZ}) with cached neighbors`);
            }
            
            console.log(`[Server] Generated chunk data with ${chunkData.length} tiles for (${cX}, ${cZ}) clientId=${clientId || 'default'}`);

            // Cache the chunk (per-client cache)
            cache.set(chunkKey, chunkData);

            res.json(chunkData);
        });
        
        // Endpoint for probe requests (client foreknowledge of distant terrain)
        this.app.get('/api/terrain/probe', (req, res) => {
            const x = parseFloat(req.query.x);
            const z = parseFloat(req.query.z);
            const radius = parseFloat(req.query.radius) || 48;
            const profile = req.query.profile || 'smooth';
            const clientId = req.query.clientId || null;
            
            if (isNaN(x) || isNaN(z)) {
                return res.status(400).json({ error: 'x and z query params required' });
            }

            const { generator } = this.getClientTerrainGenerator(clientId);
            if (this.envSimulation) {
                this.envSimulation.updateFocalPoint(x, z, clientId || 'probe');
            }

            const height = generator.registerProbe(x, z, { radius, profile });
            console.log(`[Server] Probe registered at (${x}, ${z}) height=${height.toFixed(2)} radius=${radius} profile=${profile} clientId=${clientId || 'default'}`);
            res.json({ x, z, height, radius, profile });
        });

        // Endpoint for adjusting orbit height influence (dev control)
        this.app.post('/api/terrain/orbit-height-scale', (req, res) => {
            console.warn('[Server] /api/terrain/orbit-height-scale is deprecated under climate-driven terrain');
            const clampScale = (value) => {
                if (value === undefined || value === null) return undefined;
                const num = Number(value);
                if (!Number.isFinite(num)) return undefined;
                return Math.max(0, Math.min(4, num));
            };

            const sunScale = clampScale(req.body?.sunScale);
            const moonScale = clampScale(req.body?.moonScale);
            const clientId = req.body?.clientId || null;

            if (sunScale === undefined && moonScale === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'sunScale or moonScale must be provided'
                });
            }

            // Determine target: per-client or global fallback
            let nextSun, nextMoon;
            if (clientId) {
                // Per-client: store scales and update client's generator
                const current = this.clientOrbitScales.get(clientId);
                nextSun = sunScale ?? current?.sunScale ?? 1;
                nextMoon = moonScale ?? current?.moonScale ?? 1;
                this.clientOrbitScales.set(clientId, { sunScale: nextSun, moonScale: nextMoon });

                // Update the client's generator if it already exists
                if (this.clientTerrainGenerators.has(clientId)) {
                    this.clientTerrainGenerators.get(clientId).setOrbitHeightScales(nextSun, nextMoon);
                }

                console.log(`[Server] Orbit height scales updated for clientId=${clientId}: sun=${nextSun}, moon=${nextMoon}`);
            } else {
                // Global fallback: update base generator (for clients without clientId)
                const current = this.terrainGenerator.celestialPendulum;
                nextSun = sunScale ?? current.sunHeightScale ?? 1;
                nextMoon = moonScale ?? current.moonHeightScale ?? 1;
                this.terrainGenerator.setOrbitHeightScales(nextSun, nextMoon);
                console.log(`[Server] Global orbit height scales updated: sun=${nextSun}, moon=${nextMoon}`);
            }

            // NOTE: We intentionally do NOT clear any caches here.
            // The user wants already-explored terrain to remain as-is;
            // only newly-generated chunks should use the updated scales.

            res.json({
                success: true,
                sunScale: nextSun,
                moonScale: nextMoon,
                clientId: clientId || 'default'
            });
        });

        this.app.post('/api/environment/radius', (req, res) => {
            if (!this.envSimulation) {
                return res.status(503).json({ error: 'Environmental simulation not ready' });
            }
            const radius = Number(req.body?.radius);
            if (!Number.isFinite(radius) || radius < 32 || radius > 512) {
                return res.status(400).json({ error: 'radius must be between 32 and 512' });
            }
            this.envSimulation.setActiveRadius(radius);
            res.json({ success: true, radius });
        });

        this.app.post('/api/environment/agent-count', (req, res) => {
            if (!this.envSimulation) {
                return res.status(503).json({ error: 'Environmental simulation not ready' });
            }
            const count = Number(req.body?.count);
            if (!Number.isFinite(count) || count < 20 || count > 500) {
                return res.status(400).json({ error: 'count must be between 20 and 500' });
            }
            this.envSimulation.setAgentCount(count);
            res.json({ success: true, target: this.envSimulation.agentCount, active: this.envSimulation.agents.length });
        });

        this.app.post('/api/environment/move-scale', (req, res) => {
            if (!this.envSimulation) {
                return res.status(503).json({ error: 'Environmental simulation not ready' });
            }
            const scale = Number(req.body?.scale);
            if (!Number.isFinite(scale) || scale < 0.25 || scale > 4.0) {
                return res.status(400).json({ error: 'scale must be between 0.25 and 4.0' });
            }
            this.envSimulation.setMoveScale(scale);
            res.json({ success: true, scale: this.envSimulation.moveScale });
        });

        this.app.post('/api/environment/sample-count', (req, res) => {
            if (!this.envSimulation) {
                return res.status(503).json({ error: 'Environmental simulation not ready' });
            }
            const count = Number(req.body?.count);
            if (!Number.isFinite(count) || count < 2 || count > 12) {
                return res.status(400).json({ error: 'count must be between 2 and 12' });
            }
            this.envSimulation.setSampleCount(count);
            res.json({ success: true, sampleCount: this.envSimulation.globalSampleCount });
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

        // Terrain shader config: save from node wrangler test tool
        this.app.post('/api/terrain-shader', async (req, res) => {
            console.log(`[Server] POST /api/terrain-shader from ${req.ip}`);
            try {
                const config = req.body;
                await fs.writeFile(this.terrainShaderPath, JSON.stringify(config, null, 2), 'utf8');
                console.log('[Server] Terrain shader config saved');
                res.json({ success: true, message: 'Terrain shader config saved' });
            } catch (error) {
                console.error('[Server] Error saving terrain shader config:', error);
                res.status(500).json({ error: 'Failed to save terrain shader config' });
            }
        });

        // Terrain shader config: load in game client
        this.app.get('/api/terrain-shader', async (req, res) => {
            console.log(`[Server] GET /api/terrain-shader from ${req.ip}`);
            try {
                const data = await fs.readFile(this.terrainShaderPath, 'utf8');
                const config = JSON.parse(data);
                res.json(config);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    res.status(404).json({ error: 'No terrain shader config saved yet' });
                } else {
                    console.error('[Server] Error loading terrain shader config:', error);
                    res.status(500).json({ error: 'Failed to load terrain shader config' });
                }
            }
        });

        // ─── Material Library (Shader Node Wrangler) ─────────────────────────

        // Ensure materials directory exists
        this._ensureMaterialsDir();

        // List all materials
        this.app.get('/api/materials', async (req, res) => {
            try {
                const files = await fs.readdir(this.materialsDir);
                const materials = [];
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const data = await fs.readFile(path.join(this.materialsDir, file), 'utf8');
                    const mat = JSON.parse(data);
                    materials.push({ name: mat.name, target: mat.target, modifiedAt: mat.modifiedAt });
                }
                res.json(materials);
            } catch (error) {
                console.error('[Server] Error listing materials:', error);
                res.status(500).json({ error: 'Failed to list materials' });
            }
        });

        // Get a specific material
        this.app.get('/api/materials/:name', async (req, res) => {
            const filePath = path.join(this.materialsDir, `${req.params.name}.json`);
            try {
                const data = await fs.readFile(filePath, 'utf8');
                res.json(JSON.parse(data));
            } catch (error) {
                if (error.code === 'ENOENT') {
                    res.status(404).json({ error: 'Material not found' });
                } else {
                    res.status(500).json({ error: 'Failed to load material' });
                }
            }
        });

        // Save a material
        this.app.post('/api/materials/:name', async (req, res) => {
            const filePath = path.join(this.materialsDir, `${req.params.name}.json`);
            try {
                const config = req.body;
                config.name = req.params.name;
                config.modifiedAt = new Date().toISOString();
                await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
                console.log(`[Server] Material saved: ${req.params.name}`);
                res.json({ success: true, message: `Material '${req.params.name}' saved` });
            } catch (error) {
                console.error('[Server] Error saving material:', error);
                res.status(500).json({ error: 'Failed to save material' });
            }
        });

        // Delete a material
        this.app.delete('/api/materials/:name', async (req, res) => {
            const filePath = path.join(this.materialsDir, `${req.params.name}.json`);
            try {
                await fs.unlink(filePath);
                console.log(`[Server] Material deleted: ${req.params.name}`);
                res.json({ success: true, message: `Material '${req.params.name}' deleted` });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    res.status(404).json({ error: 'Material not found' });
                } else {
                    res.status(500).json({ error: 'Failed to delete material' });
                }
            }
        });

        // Apply material to a model
        this.app.post('/api/materials/:name/apply', async (req, res) => {
            const { modelId, modelType } = req.body;
            try {
                let mappings = {};
                try {
                    const data = await fs.readFile(this.materialMappingsPath, 'utf8');
                    mappings = JSON.parse(data);
                } catch (e) { /* no mappings yet */ }

                mappings[modelId] = { material: req.params.name, modelType: modelType || 'generic' };
                await fs.writeFile(this.materialMappingsPath, JSON.stringify(mappings, null, 2), 'utf8');
                console.log(`[Server] Material '${req.params.name}' applied to model '${modelId}'`);
                res.json({ success: true, message: `Material applied to ${modelId}` });
            } catch (error) {
                console.error('[Server] Error applying material:', error);
                res.status(500).json({ error: 'Failed to apply material' });
            }
        });

        // Get all model-material mappings
        this.app.get('/api/material-mappings', async (req, res) => {
            try {
                const data = await fs.readFile(this.materialMappingsPath, 'utf8');
                res.json(JSON.parse(data));
            } catch (error) {
                if (error.code === 'ENOENT') {
                    res.json({});
                } else {
                    res.status(500).json({ error: 'Failed to load mappings' });
                }
            }
        });
    }

    async _ensureMaterialsDir() {
        try {
            await fs.mkdir(this.materialsDir, { recursive: true });
        } catch (e) {
            if (e.code !== 'EEXIST') console.error('[Server] Failed to create materials dir:', e);
        }
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
            try {
                const { email, username, identifier, password } = req.body;
                const loginIdentifier = identifier || email || username;
                console.log(`[Auth] Login request for ${loginIdentifier}`);

                if (!loginIdentifier || !password) {
                    return res.status(400).json({ success: false, error: 'Email/username and password required.' });
                }

                const result = await auth.login(loginIdentifier, password);
                res.status(result.success ? 200 : 401).json(result);
            } catch (error) {
                console.error('[Auth] Login error:', error);
                res.status(500).json({ success: false, error: 'Server error. Please try again.' });
            }
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
                // Fall back to guest connection on any error
                const guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
                socket.data.user = {
                    id: guestId,
                    username: 'Guest',
                    email: 'guest@local',
                    role: 'guest'
                };
                console.log(`[Auth] Socket ${socket.id} auth error, connected as guest`);
                next();
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
            
            socket.on('requestSettlements', (data) => {
                const { x, z, radius } = data || {};
                const cx = x || 0;
                const cz = z || 0;
                const r = radius || 400;
                if (!this.settlementGenerator) {
                    socket.emit('settlementsReceived', { villages: [] });
                    return;
                }
                const villages = this.settlementGenerator.getVillagesInRadius(cx, cz, r);
                socket.emit('settlementsReceived', { villages });
                console.log(`[Server] Sent ${villages.length} villages to ${socket.id} in radius ${r} around (${cx}, ${cz})`);
            });

            socket.on('spawnDebugVillage', (data) => {
                console.log(`[Server] spawnDebugVillage received from ${socket.id}:`, data);
                try {
                    if (!this.settlementGenerator || !this.tomeManager) {
                        console.warn('[Server] spawnDebugVillage: settlementGenerator or tomeManager not ready');
                        return;
                    }
                    const { x, z } = data || {};
                    if (x === undefined || z === undefined) {
                        console.warn('[Server] spawnDebugVillage: missing x or z');
                        return;
                    }

                    console.log('[Server] Debug spawn prerequisites', {
                        hasTerrain: !!this.terrainGenerator,
                        hasSettlementGenerator: !!this.settlementGenerator,
                        hasTomeManager: !!this.tomeManager,
                        settlementCount: this.settlementGenerator.generatedVillages?.length || 0
                    });

                    const typeKey = 'village';
                    const typeDef = SETTLEMENT_TYPES[typeKey];
                    if (!typeDef) {
                        console.error('[Server] spawnDebugVillage: missing typeDef for', typeKey, 'SETTLEMENT_TYPES keys:', Object.keys(SETTLEMENT_TYPES || {}));
                        return;
                    }
                    const id = `settlement_debug_${Date.now()}`;
                    const name = `Debug_${generateSettlementName()}`;
                    const height = this.terrainGenerator.getHeight(x, z);

                    const village = {
                        id,
                        name,
                        type: typeKey,
                        typeDef,
                        x, z,
                        height,
                        population: 2,
                        maxPopulation: typeDef.maxPop,
                        foodCapacity: 4,
                        faithCapacity: 0,
                        buildings: [],
                        nodes: [],
                        villagers: [],
                        roads: [],
                        knight: null,
                        age: 0,
                        state: 'founding',
                        constructionQueue: [],
                        completedBuildings: [],
                        firstHouseBuilt: false,
                        greenBuilt: false,
                        _seedOffset: Date.now() % 100000
                    };

                    this.settlementGenerator.generatedVillages.push(village);
                    this.tomeManager.initializeTome(village);

                    // Broadcast the new village to all connected clients
                    console.log('[Server] Broadcasting settlementsReceived for new debug village');
                    this.io.emit('settlementsReceived', { villages: [village] });
                    console.log(`[Server] Debug village "${name}" spawned at (${x.toFixed(1)}, ${z.toFixed(1)})`);
                } catch (err) {
                    console.error('[Server] spawnDebugVillage ERROR:', err);
                }
            });

            socket.on('terrainModified', (data) => {
                if (!data || !data.chunks) return;
                for (const chunk of data.chunks) {
                    this.terrainGenerator.applyHeightDeltas(chunk.key, chunk.deltas);
                }
                socket.broadcast.emit('terrainModified', data);
            });

            socket.on('tomeMutation', (data) => {
                const { villageId, villagerId, slotIndex, newActivity } = data || {};
                if (!this.tomeManager || !villageId || !villagerId || slotIndex === undefined || !newActivity) return;
                const userId = socket.data.user?.id || socket.id;
                this.tomeManager.queueMutation(villageId, villagerId, slotIndex, newActivity, userId);
            });

            socket.on('spawnWeatherAgents', (data) => {
                if (!this.envSimulation) return;
                const { x = 0, z = 0, radius = 80, count = 8 } = data || {};
                console.log(`[Server] spawnWeatherAgents called at (${x},${z}) radius=${radius} count=${count} currentAgents=${this.envSimulation.agents.length} focal=(${this.envSimulation.focalX},${this.envSimulation.focalZ})`);
                // Update focal point so spawned agents aren't immediately culled
                this.envSimulation.updateFocalPoint(x, z, socket.id);
                console.log(`[Server] After focal update: focal=(${this.envSimulation.focalX},${this.envSimulation.focalZ}) focals=${this.envSimulation._clientFocals.size}`);
                const { PressureAgent, AGENT_TYPE } = require('./environmentalSimulation.js');
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * radius;
                    const ax = x + Math.cos(angle) * dist;
                    const az = z + Math.sin(angle) * dist;
                    const type = i % 2 === 0 ? AGENT_TYPE.PRESSURE : AGENT_TYPE.MOISTURE;
                    const seed = Math.floor(Math.random() * 1000000);
                    const agent = new PressureAgent(ax, az, type, seed);
                    agent.state.pressure = i % 2 === 0 ? 0.8 : 0.2;
                    agent.strength = 1.0;
                    this.envSimulation.agents.push(agent);
                }
                console.log(`[Server] Spawned ${count} weather agents near (${x},${z}), total: ${this.envSimulation.agents.length}`);
                this.io.emit('envAgents', this.envSimulation.getAgentPositions());
            });

            socket.on('clearWeatherAgents', () => {
                if (!this.envSimulation) return;
                this.envSimulation.agents = [];
                console.log('[Server] Cleared all weather agents');
                this.io.emit('envAgents', []);
            });

            socket.on('requestTomeUpdate', (data) => {
                const { villageId } = data || {};
                if (!this.tomeManager || !villageId) return;
                const delta = this.tomeManager.getTomeDelta(villageId, -1);
                if (delta) {
                    socket.emit('tomeUpdate', delta);
                }
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
        if (this.envSimulation && this.climateInference) {
            this.terrainGenerator.setClimateMemory(this.envSimulation, this.climateInference);
        }
            
            // Generate rivers (carve channels into terrain)
            this.terrainGenerator.generateRivers(80);

            // Generate settlements deterministically from seed
            this.settlementGenerator = new SettlementGenerator(this.terrainGenerator, this.worldSeed);
            // Auto-generation disabled: villages are only spawned manually via spawnDebugVillage
            // this.settlementGenerator.generateAllVillages();

            // Initialize tome manager with generated villages
            this.tomeManager = new SettlementTomeManager(this.settlementGenerator, this);
            this.tomeManager.init();

            // Start the 03:00 daily tome resolution tick
            this.startTomeTick();
            
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

            this.settlementGenerator = new SettlementGenerator(this.terrainGenerator, this.worldSeed);
            // Auto-generation disabled: villages are only spawned manually via spawnDebugVillage
            // this.settlementGenerator.generateAllVillages();
            this.tomeManager = new SettlementTomeManager(this.settlementGenerator, this);
            this.tomeManager.init();
            this.startTomeTick();
        }
    }

    startTomeTick() {
        if (this._tomeTickInterval) return;
        const dayLength = this.dayLength || 60000;
        const tickOffsetMs = dayLength * (3 / 24);
        const checkIntervalMs = 1000;

        this._tomeTickInterval = setInterval(() => {
            if (!this.tomeManager) return;
            const now = Date.now();
            const elapsed = now - this.epoch;
            const dayProgress = (elapsed % dayLength) / dayLength;
            if (dayProgress >= (3 / 24) && dayProgress < (3 / 24) + (checkIntervalMs / dayLength)) {
                const currentDay = Math.floor(elapsed / dayLength);
                if (this._lastTomeBroadcastDay === currentDay) return;
                this._lastTomeBroadcastDay = currentDay;
                this.tomeManager.resolveDailyTick();
                const tomeState = this.tomeManager.getFullTomeState(
                    this.settlementGenerator.generatedVillages.map(v => v.id)
                );
                for (const [villageId, delta] of Object.entries(tomeState)) {
                    this.io.emit('tomeUpdate', delta);
                }
                // Also broadcast updated blueprints so clients see new buildings immediately
                this.io.emit('settlementsReceived', { villages: this.settlementGenerator.generatedVillages });
            }
        }, checkIntervalMs);

        console.log(`[Server] Tome tick started (03:00 game-time, every ${dayLength}ms real)`);
    }

    stopTomeTick() {
        if (this._tomeTickInterval) {
            clearInterval(this._tomeTickInterval);
            this._tomeTickInterval = null;
        }
        this._lastTomeBroadcastDay = -1;
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

        // Also clear all per-client generators and caches since the world seed changed
        const clientGenCount = this.clientTerrainGenerators.size;
        this.clientTerrainGenerators.clear();
        this.clientTerrainCaches.clear();
        // Keep clientOrbitScales so clients retain their preferences across world regens
        console.log(`[Server] Cleared ${clientGenCount} per-client terrain generators due to world regeneration`);

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
        
        // Generate settlements for the new world
        this.settlementGenerator = new SettlementGenerator(this.terrainGenerator, this.worldSeed);
        // Auto-generation disabled: villages are only spawned manually via spawnDebugVillage
        // this.settlementGenerator.generateAllVillages();
        this.tomeManager = new SettlementTomeManager(this.settlementGenerator, this);
        this.tomeManager.init();
        this.startTomeTick();

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

    async start(port = 3000) {
        console.log(`[Server] Chessopia server starting on port ${port}`);

        // Wait for auth manager to initialize before accepting connections
        await this.authManager.init();

        this.server.on('error', (err) => {
            console.error(`[Server] Failed to start: ${err.message}`);
            process.exit(1);
        });
        this.server.listen(port, () => {
            console.log(`[Server] Server listening on port ${port}`);
            // Enable console debugging commands
            this.setupConsoleCommands();
            
            // Start periodic time sync broadcasts
            this.startTimeSync();

            // Start environmental simulation
            this.startEnvSimulation().catch(err => {
                console.error('[Server] Failed to start environmental simulation:', err);
            });
            
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

    async _getInitialAgentCount() {
        try {
            const data = await fs.readFile(this.parameterDefaultsPath, 'utf8');
            const defaults = JSON.parse(data);
            const count = Number(defaults?.climateAgentCount);
            if (Number.isFinite(count)) {
                return Math.max(0, Math.min(500, Math.round(count)));
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn('[Server] Failed to read parameter defaults for agent count:', error.message || error);
            }
        }
        return null;
    }

    async startEnvSimulation() {
        console.log('[Server] Starting environmental simulation...');
        const savedAgentCount = await this._getInitialAgentCount();
        const initialAgentCount = savedAgentCount ?? 200;
        if (savedAgentCount !== null) {
            console.log(`[Server] Using saved climateAgentCount=${initialAgentCount}`);
        }
        this.envSimulation = new EnvironmentalSimulation(this.terrainGenerator, {
            agentCount: initialAgentCount,
            tickIntervalMs: 2000,
            activeRadius: 128,
            seed: this.worldSeed || 42
        });

        // Create groundwater system and wire into env simulation and terrain
        this.groundwaterSystem = new GroundwaterSystem(this.terrainGenerator, {
            chunkSize: 16,
            activeRadius: 4
        });
        this.envSimulation.setGroundwaterSystem(this.groundwaterSystem);
        this.terrainGenerator.setGroundwaterSystem(this.groundwaterSystem);
        for (const gen of this.clientTerrainGenerators.values()) {
            gen.setGroundwaterSystem(this.groundwaterSystem);
        }

        this.envSimulation.init();
        this.envSimulation.start();

        // Ensure terrain generators read climate memory
        this.terrainGenerator.setClimateMemory(this.envSimulation, this.climateInference);
        for (const gen of this.clientTerrainGenerators.values()) {
            gen.setClimateMemory(this.envSimulation, this.climateInference);
        }

        // Tick loop
        this.envSimInterval = setInterval(() => {
            this.envSimulation.tick();
            if (this.groundwaterSystem) {
                this.groundwaterSystem.tick(Date.now());
            }
            this.io.emit('envAgents', this.envSimulation.getAgentPositions());
        }, this.envSimulation.tickIntervalMs);

        // Broadcast agent positions every 5 seconds for minimap weather overlay
        this.envAgentBroadcastInterval = setInterval(() => {
            if (this.envSimulation) {
                this.io.emit('envAgents', this.envSimulation.getAgentPositions());
            }
        }, 5000);

        console.log('[Server] Environmental simulation started');
    }
}

    // ... (rest of the code remains the same)
const server = new ChessopiaServer();
server.start().catch(err => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
});
