const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const TerrainGenerator = require('./terrain');

class PrivateerServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: { origin: "*", methods: ["GET", "POST"] }
        });

        this.port = process.env.PORT || 3000;
        this.terrainGenerator = new TerrainGenerator();
        this.terrainCache = new Map();
        this.worldSeed = null;

        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
        this.initializeWorld();
    }

    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '10mb' }));

        const clientStatic = express.static(path.join(__dirname, 'client'), {
            setHeaders: (res, filePath) => {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                const ext = path.extname(filePath);
                if (ext === '.css') res.setHeader('Content-Type', 'text/css');
                else if (ext === '.js') res.setHeader('Content-Type', 'application/javascript');
                else if (ext === '.html') res.setHeader('Content-Type', 'text/html');
            }
        });
        this.app.use(clientStatic);
        this.app.use('/models', express.static(path.join(__dirname, 'models')));
        this.app.use('/Models', express.static(path.join(__dirname, 'Models')));
        this.app.use('/Images', express.static(path.join(__dirname, 'Images')));
        this.app.use('/textures', express.static(path.join(__dirname, 'textures')));
    }

    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'client/index.html'));
        });
        this.app.get('/favicon.ico', (req, res) => res.status(204).end());

        this.app.get('/api/terrain/:x/:y', (req, res) => {
            const { x, y } = req.params;
            const height = this.terrainGenerator.getHeight(parseInt(x), parseInt(y));
            const isBlocked = this.terrainGenerator.isTileBlocked(parseInt(x), parseInt(y));
            res.json({ height, isBlocked });
        });

        this.app.get('/api/trees', (req, res) => {
            const trees = Array.from(this.terrainGenerator.trees.entries()).map(([key, data]) => {
                const [x, y] = key.split(',').map(Number);
                return { x, y, biome: data.biome || 'unknown', maxScale: data.maxScale || 1.0, growthRate: data.growthRate || 1.0, species: data.species || 'terrain' };
            });
            res.json({ trees });
        });

        this.app.get('/api/trees/chunk/:chunkX/:chunkZ', (req, res) => {
            const cX = parseInt(req.params.chunkX);
            const cZ = parseInt(req.params.chunkZ);
            const added = this.terrainGenerator.generateTreesForChunk(cX, cZ);
            const trees = this.terrainGenerator.getTreesForChunk(cX, cZ);
            res.json({ trees });
        });

        this.app.get('/api/terrain/chunk/:chunkX/:chunkZ', (req, res) => {
            const { chunkX, chunkZ } = req.params;
            const chunkKey = `${chunkX},${chunkZ}`;

            if (this.terrainCache.has(chunkKey)) {
                return res.json(this.terrainCache.get(chunkKey));
            }

            const cX = parseInt(chunkX);
            const cZ = parseInt(chunkZ);
            const chunkData = this.terrainGenerator.getChunkData(cX, cZ);
            this.terrainCache.set(chunkKey, chunkData);
            res.json(chunkData);
        });

        this.app.get('/api/terrain/probe', (req, res) => {
            const x = parseFloat(req.query.x);
            const z = parseFloat(req.query.z);
            const radius = parseFloat(req.query.radius) || 48;
            const profile = req.query.profile || 'smooth';
            if (isNaN(x) || isNaN(z)) {
                return res.status(400).json({ error: 'x and z query params required' });
            }
            const height = this.terrainGenerator.registerProbe(x, z, { radius, profile });
            res.json({ x, z, height, radius, profile });
        });

        this.app.post('/api/world/recreate', async (req, res) => {
            try {
                this.generateNewWorld();
                res.json({ success: true, message: 'World regenerated', seed: this.worldSeed });
            } catch (error) {
                console.error('[Server] Error regenerating world:', error);
                res.status(500).json({ success: false, message: 'Failed to regenerate world' });
            }
        });

        this.app.get('/api/world/seed', (req, res) => {
            res.json({ seed: this.worldSeed });
        });
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`[Server] Client connected: ${socket.id}`);

            socket.on('disconnect', () => {
                console.log(`[Server] Client disconnected: ${socket.id}`);
            });

            // MULTIPLAYER_HUB: Add player position sync here
            // Current: single-player only
        });
    }

    initializeWorld() {
        try {
            console.log('[Server] Initializing world...');
            this.worldSeed = Math.floor(Math.random() * 1000000);
            this.terrainGenerator.setSeed(this.worldSeed);
            this.terrainGenerator.generateRivers(80);
            this.terrainGenerator.generateTrees(200);
            console.log(`[Server] World initialized with seed: ${this.worldSeed}`);
        } catch (error) {
            console.error('[Server] Error initializing world:', error);
            this.worldSeed = Math.floor(Math.random() * 1000000);
            this.terrainGenerator.setSeed(this.worldSeed);
        }
    }

    generateNewWorld() {
        this.worldSeed = Math.floor(Math.random() * 1000000);
        this.terrainGenerator.setSeed(this.worldSeed);
        this.terrainGenerator.generateRivers(80);
        this.terrainCache.clear();
        this.terrainGenerator.trees.clear();
        this.terrainGenerator.generateTrees(200);
        this.io.emit('worldRegenerated', { seed: this.worldSeed });
        console.log('[Server] New world generated with seed:', this.worldSeed);
    }

    async start(port = 3000) {
        console.log(`[Server] Privateer server starting on port ${port}`);
        this.server.on('error', (err) => {
            console.error(`[Server] Failed to start: ${err.message}`);
            process.exit(1);
        });
        this.server.listen(port, () => {
            console.log(`[Server] Server listening on port ${port}`);
        });
    }
}

const server = new PrivateerServer();
server.start(server.port).catch(err => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
});
