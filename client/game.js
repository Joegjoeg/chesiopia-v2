class ChessopiaGame {
    constructor() {
        console.log('[Game] ChessopiaGame constructor called!');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrainSystem = null;
        this.boardSystem = null;
        this.piecesSystem = null;
        this.cameraController = null;
        this.movementBridge = null;
        this.visualFeedback = null;
        this.networkManager = null;
        this.gameState = null;
        this.celShaderSystem = null;
        this.grassSystem = null;
        this.textureBlendingSystem = null;
        
        this.selectedPiece = null;
        this.validMoves = [];
        this.hoveredTile = null;
        
        this.isLoading = true;
        this.isInitialized = false;
        
        console.log('Initializing Chessopia game...');
        
        try {
            this.init();
        } catch (error) {
            console.error('[Game] Failed to initialize game:', error);
            console.error('[Game] Error stack:', error.stack);
            this.showError('Failed to load game. Please refresh the page.');
        }
    }
    
    async init() {
        try {
            this.showLoadingProgress(10);
            console.log('[Game] Setting up renderer...');
            await this.setupRenderer();
            this.showLoadingProgress(30);
            this.detectDeviceCapabilities();
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.deviceCapabilities.pixelRatioCap));
            if (!this.deviceCapabilities.antialias) {
                // Can't disable antialias after creation, but we log it
                console.log('[Game] Low-tier device: antialias would be disabled on next load');
            }
            
            console.log('[Game] Setting up scene...');
            await this.setupScene();
            console.log('[Game] Scene setup completed!');
            console.log('[Game] About to call showLoadingProgress(50)');
            this.showLoadingProgress(50);
            console.log('[Game] Called showLoadingProgress(50)');
            
            console.log('[Game] Setting up systems...');
            try {
                await this.setupSystems();
                this.showLoadingProgress(70);
            } catch (error) {
                console.error('[Game] Error in setupSystems:', error);
                throw error;
            }
            
            console.log('[Game] Setting up event listeners...');
            await this.setupEventListeners();
            this.showLoadingProgress(80);
            
            console.log('[Game] Setting up network...');
            await this.setupNetwork();
            this.showLoadingProgress(90);
            
            console.log('[Game] Starting game loop...');
            this.startGameLoop();
            this.showLoadingProgress(100);
            
            setTimeout(() => {
                this.hideLoadingScreen();
                this.isInitialized = true;
                
                // Board system already exposed to window.boardSystem during initialization
                
                // Initialize LOD system properly
                if (this.boardSystem && this.boardSystem.initializeLODLevels) {
                    this.boardSystem.initializeLODLevels();
                    console.log('[Game] LOD system initialized');
                }
                
                // Expose LOD debug functions
                window.testLODDistances = () => {
                    if (window.boardSystem && window.boardSystem.testLODDistances) {
                        window.boardSystem.testLODDistances();
                    }
                };
                
                window.debugSeamlessLOD = () => {
                    if (window.boardSystem && window.boardSystem.debugSeamlessTransitions) {
                        window.boardSystem.debugSeamlessTransitions();
                    }
                };
                
                window.testSquareHeights = (x, z) => {
                    if (window.boardSystem && window.boardSystem.testSquareHeights) {
                        return window.boardSystem.testSquareHeights(x, z);
                    }
                };
                
                console.log('[Game] LOD debug functions exposed - use testLODDistances() or debugSeamlessLOD() in console');
                
                console.log('[Game] Game initialization completed successfully!');
                this.reportOptimizationStatus();

                // Populate trees from server now that boardSystem + terrain are fully ready.
                if (this.hybridTreeManager) {
                    this.hybridTreeManager.populateFromServer();
                    // Expose for console debugging
                    window.treeSystem = this.hybridTreeManager;
                    window.repopulateTrees = () => {
                        this.hybridTreeManager.clear();
                        this.hybridTreeManager.populateFromServer();
                    };
                }
            }, 500);
            
        } catch (error) {
            console.error('[Game] Failed to initialize game:', error);
            console.error('[Game] Error stack:', error.stack);
            this.showError('Failed to load game. Please refresh the page.');
        }
    }
    
    async setupRenderer() {
        // Initialize Three.js renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('gameCanvas'),
            antialias: true,
            alpha: true
        });
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true; // Enabled for debug
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.5;  // Increased from 0.5 for brighter scene

        // Shadow quality - fixed at medium to prevent shadow map corruption
        this.shadowQuality = {
            current: 'medium', // fixed: low, medium, high
            resolutions: {
                low: 512,
                medium: 1024,
                high: 2048
            }
        };
        
        // Set background color
        this.renderer.setClearColor(0x87CEEB, 1);
    }

    detectDeviceCapabilities() {
        const caps = {
            tier: 'medium',
            gridSize: 128,
            meshMultiplier: 24,
            renderDistance: 40,
            terrainLoadRadius: 20,
            antialias: true,
            pixelRatioCap: 2,
            details: {}
        };

        try {
            const gl = this.renderer.getContext();
            const webglCaps = this.renderer.capabilities;

            caps.details.maxTextureSize = webglCaps.maxTextureSize;
            caps.details.maxVertexTextures = webglCaps.maxVertexTextures;
            caps.details.maxTextureImageUnits = webglCaps.maxTextureImageUnits;
            caps.details.hardwareConcurrency = navigator.hardwareConcurrency || 2;
            caps.details.deviceMemory = navigator.deviceMemory || 4;
            caps.details.pixelRatio = window.devicePixelRatio || 1;
            caps.details.screenWidth = window.screen.width;
            caps.details.screenHeight = window.screen.height;
            caps.details.webglRenderer = gl.getParameter(gl.RENDERER);
            caps.details.webglVendor = gl.getParameter(gl.VENDOR);

            const isMobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            const lowEndGPU = /(Mali-G3|Mali-T|Adreno 3|Adreno 4|PowerVR)/i.test(caps.details.webglRenderer);
            const highEndGPU = /(Apple M|RTX|GTX|Radeon RX|Adreno 7|Adreno 8|Mali-G7)/i.test(caps.details.webglRenderer);

            let score = 0;

            if (highEndGPU) score += 3;
            else if (lowEndGPU) score -= 2;

            if (caps.details.maxTextureSize >= 16384) score += 2;
            else if (caps.details.maxTextureSize >= 8192) score += 1;
            else if (caps.details.maxTextureSize < 4096) score -= 1;

            if (caps.details.hardwareConcurrency >= 8) score += 2;
            else if (caps.details.hardwareConcurrency >= 4) score += 1;
            else if (caps.details.hardwareConcurrency <= 2) score -= 1;

            if (caps.details.deviceMemory >= 8) score += 2;
            else if (caps.details.deviceMemory >= 4) score += 1;
            else if (caps.details.deviceMemory < 4) score -= 1;

            if (isMobileUA) score -= 1;

            if (score >= 5) {
                caps.tier = 'high';
                caps.gridSize = 192;
                caps.meshMultiplier = 36;
                caps.renderDistance = 60;
                caps.terrainLoadRadius = 30;
                caps.pixelRatioCap = 2;
            } else if (score >= 2) {
                caps.tier = 'medium';
                caps.gridSize = 128;
                caps.meshMultiplier = 24;
                caps.renderDistance = 40;
                caps.terrainLoadRadius = 20;
                caps.pixelRatioCap = 1.5;
            } else {
                caps.tier = 'low';
                caps.gridSize = 96;
                caps.meshMultiplier = 18;
                caps.renderDistance = 30;
                caps.terrainLoadRadius = 15;
                caps.antialias = false;
                caps.pixelRatioCap = 1;
            }
        } catch (e) {
            console.warn('[Game] Device detection failed, falling back to medium tier:', e);
        }

        this.deviceCapabilities = caps;
        console.log(`[Game] Device tier: ${caps.tier}`, caps.details);
        return caps;
    }

    // Shadow quality is fixed at medium - adaptive system disabled to prevent shadow map corruption
    updateShadowQuality(frameTime) {
        // No-op - fixed shadow quality prevents shadow map resizing issues
    }

    // Apply fixed shadow quality to sun and moon lights
    applyShadowQuality() {
        if (!this.boardSystem) {
            return;
        }

        const resolution = this.shadowQuality.resolutions[this.shadowQuality.current];

        // Apply to sun light
        if (this.boardSystem.sun && this.boardSystem.sun.light) {
            this.boardSystem.sun.light.shadow.mapSize.set(resolution, resolution);
            this.boardSystem.sun.light.shadow.camera.updateProjectionMatrix();
            this.boardSystem.sun.light.shadow.needsUpdate = true;
        }

        // Apply to moon light
        if (this.boardSystem.moon && this.boardSystem.moon.light) {
            this.boardSystem.moon.light.shadow.mapSize.set(resolution, resolution);
            this.boardSystem.moon.light.shadow.camera.updateProjectionMatrix();
            this.boardSystem.moon.light.shadow.needsUpdate = true;
        }
    }
    
    async setupScene() {
        // Create scene
        this.scene = new THREE.Scene();
        
        // Add distance fog to obscure background terrain - INCREASED FOR BETTER VISIBILITY
        this.scene.fog = new THREE.Fog(0x808080, 20, 60); // 50% gray, increased near distance from 10 to 20 for clearer view
        console.log('[Game] Fog applied:', !!this.scene.fog, 'Color:', this.scene.fog.color.getHex(), 'Near:', this.scene.fog.near, 'Far:', this.scene.fog.far);
        
        // Setup lighting
        this.setupLighting();
        console.log('[Game] Lighting setup completed');
        
        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        
        // Verify fog is still applied after camera setup
        console.log('[Game] Fog verification after camera setup:', !!this.scene.fog);
        this.camera.position.set(5, 20, 5);
        this.camera.lookAt(0, 0, 0);
        console.log('[Game] Camera setup completed');
        console.log('[Game] setupScene() about to complete');
        console.log('[Game] setupScene() completed!');
    }
    
    setupLighting() {
        // All lights disabled - using board system's sun light only
        // // Ambient light
        // const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        // this.scene.add(ambientLight);
        //
        // // Additional low brightness fill light to lighten shadows
        // const fillLight = new THREE.AmbientLight(0xffffff, 0.15); // Soft white fill light
        // this.scene.add(fillLight);
        //
        // // Main directional light (sun)
        // const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        // directionalLight.position.set(50, 100, 50);
        // directionalLight.castShadow = true;
        //
        // // Configure shadow camera
        // directionalLight.shadow.camera.left = -50;
        // directionalLight.shadow.camera.right = 50;
        // directionalLight.shadow.camera.top = 50;
        // directionalLight.shadow.camera.bottom = -50;
        // directionalLight.shadow.camera.near = 0.5;
        // directionalLight.shadow.camera.far = 500;
        // directionalLight.shadow.mapSize.width = 2048;
        // directionalLight.shadow.mapSize.height = 2048;
        // directionalLight.shadow.bias = -0.0001;
        //
        // this.scene.add(directionalLight);
    }
    
    async setupSystems() {
        console.log('[Game] setupSystems() started!');
        // Initialize game systems
        this.gameState = new ClientGameState();
        // Create hybrid tree manager with patch-based alternation between TerrainTreeSystem and LocalTreeSystem
        this.oldTreeSystem = null; // Disable old tree system
        this.hybridTreeManager = new HybridTreeManager(this.scene, null); // Hybrid manager for both systems
        this.terrainTreeSystem = this.hybridTreeManager.terrainTreeSystem; // Reference for compatibility
        this.treeSystem = this.hybridTreeManager.localTreeSystem; // Reference for compatibility
        console.log('[Game] Hybrid tree manager created - terrainTreeSystem:', !!this.terrainTreeSystem, 'localTreeSystem:', !!this.treeSystem);

        // Initialize performance manager for automatic quality scaling
        this.performanceManager = new PerformanceManager(this);
        console.log('[Game] PerformanceManager created');

        // Initialize baked shadow system
        this.shadowSystem = new BakedShadowSystem(this.scene);
        console.log('[Game] BakedShadowSystem created');

        this.terrainSystem = new TerrainSystem(this.scene, this.terrainTreeSystem);
        this.boardSystem = new CleanBoardSystem(this.scene, this.terrainSystem, this.terrainTreeSystem, this);

        // Backfill the terrain reference now that it exists
        if (this.hybridTreeManager) {
            this.hybridTreeManager.terrainSystem = this.terrainSystem;
        }
        
        // Expose board system to global scope immediately after creation
        window.boardSystem = this.boardSystem;
        console.log('[Game] Board system exposed to window.boardSystem');

        // Water depth fade handled by boardSystem.updateWaterDepthFade()
        this.piecesSystem = new Pieces3D(this.scene, this.terrainSystem);

        // Register callback for terrain mesh updates to update tree normals (throttled)
        this._lastTreeNormalUpdate = 0;
        this.boardSystem.onTerrainMeshUpdated = () => {
            const now = Date.now();
            if (now - this._lastTreeNormalUpdate > 500) { // Throttle to once per 500ms
                this._lastTreeNormalUpdate = now;
                if (this.terrainTreeSystem) {
                    // Terrain trees don't need normal updates - they're part of terrain geometry
                }
            }
        };

        // Initialize shadow quality after board system is created
        setTimeout(() => {
            this.applyShadowQuality();
            console.log(`[SHADOW] Initial quality set to ${this.shadowQuality.current} (${this.shadowQuality.resolutions[this.shadowQuality.current]}x${this.shadowQuality.resolutions[this.shadowQuality.current]})`);
        }, 100);
        
        // Set up chunk loaded callback to regenerate terrain mesh
        this._lastChunkMeshRebuild = 0;
        this.terrainSystem.onChunkLoaded = (chunkX, chunkZ) => {
            if (!this.boardSystem || !this.boardSystem.continuousMesh) return;
            // Only force rebuild if chunk is inside current mesh bounds
            const mb = this.boardSystem.meshBounds;
            if (!mb) return;
            const chunkWorldX = chunkX * this.terrainSystem.chunkSize;
            const chunkWorldZ = chunkZ * this.terrainSystem.chunkSize;
            const halfSize = mb.size / 2;
            const inside = chunkWorldX >= mb.centerX - halfSize && chunkWorldX <= mb.centerX + halfSize &&
                           chunkWorldZ >= mb.centerZ - halfSize && chunkWorldZ <= mb.centerZ + halfSize;
            if (!inside) return;
            // Throttle rebuilds to once per 500ms
            const now = Date.now();
            if (now - this._lastChunkMeshRebuild < 500) return;
            this._lastChunkMeshRebuild = now;
            this.boardSystem.updateDynamicMesh(this.camera.position, true);
        };
        
        // Update terrain tree system with terrain system and shadow system references
        if (this.hybridTreeManager) {
            this.hybridTreeManager.terrainSystem = this.terrainSystem;
            this.hybridTreeManager.terrainTreeSystem.shadowSystem = this.shadowSystem;
        }
        
        // Simple tree system works independently with server data
        this.cameraController = new CameraController(this.camera, this.scene);
        this.movementBridge = new MovementBridge(this.gameState, this.boardSystem);
        this.visualFeedback = new VisualFeedbackSystem(this.scene);
        console.log('[Game] Creating SimpleCelShaderSystem...');
        this.celShaderSystem = new SimpleCelShaderSystem();
        console.log('[Game] SimpleCelShaderSystem created:', !!this.celShaderSystem);
        
        // Initialize decorative visuals system
        console.log('[Game] Creating DecorativeVisualsSystem...');
        this.decorativeVisuals = new DecorativeVisualsSystem(this.scene, this.terrainSystem, this);
        console.log('[Game] DecorativeVisualsSystem created:', !!this.decorativeVisuals);
        
        // Initialize grass and texture blending systems after board system is created
        console.log('[Game] Creating GrassSystem and TextureBlendingSystem for adaptive terrain...');
        
        // Create grass system
        if (typeof GrassSystem !== 'undefined') {
            try {
                this.grassSystem = new GrassSystem(this.scene, this.boardSystem, this.terrainSystem);
                this.boardSystem.grassSystem = this.grassSystem;
                console.log('[Game] GrassSystem created and assigned to board:', !!this.grassSystem);
            } catch (error) {
                console.error('[Game] Failed to create GrassSystem:', error);
                this.grassSystem = null;
                this.boardSystem.grassSystem = null;
            }
        } else {
            console.log('[Game] GrassSystem class not available');
            this.grassSystem = null;
            this.boardSystem.grassSystem = null;
        }
        
        // Create texture blending system
        if (typeof TextureBlendingSystem !== 'undefined') {
            try {
                this.textureBlendingSystem = new TextureBlendingSystem(this.boardSystem, this.terrainSystem);
                this.boardSystem.textureBlendingSystem = this.textureBlendingSystem;
                console.log('[Game] TextureBlendingSystem created and assigned to board:', !!this.textureBlendingSystem);
            } catch (error) {
                console.error('[Game] Failed to create TextureBlendingSystem:', error);
                this.textureBlendingSystem = null;
                this.boardSystem.textureBlendingSystem = null;
            }
        } else {
            console.log('[Game] TextureBlendingSystem class not available');
            this.textureBlendingSystem = null;
            this.boardSystem.textureBlendingSystem = null;
        }
        
        // Generate initial terrain sized to device capability tier
        const caps = this.deviceCapabilities;
        await this.terrainSystem.generateInitialTerrain(0, 0, caps.terrainLoadRadius);
        
        // Apply detected capability tier to board & streaming
        this.boardSystem.useViewportMesh = true;
        this.boardSystem.renderDistance = caps.renderDistance;
        console.log(`[Game] Device tier: ${caps.tier}, gridSize: ${caps.gridSize}, meshMultiplier: ${caps.meshMultiplier}, renderDistance: ${caps.renderDistance}`);
        this.boardSystem.createBoard(0, 0, 3, caps.meshMultiplier, caps.gridSize);

        
        // Tree population is deferred until after init() completes so that
        // boardSystem.getTerrainHeight() and the terrain mesh are fully ready.
        console.log('[Game] Terrain tree system exists:', !!this.terrainTreeSystem);
    }
    
    async setupEventListeners() {
        // Window resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        // Mouse events
        this.renderer.domElement.addEventListener('click', (event) => this.onMouseClick(event));
        this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
        
        // Keyboard events
        window.addEventListener('keydown', (event) => this.onKeyDown(event));
        window.addEventListener('keyup', (event) => this.onKeyUp(event));
        
        // UI events
        this.setupUIEventListeners();
    }
    
    setupUIEventListeners() {
        // Shop modal
        const shopBtn = document.getElementById('shopBtn');
        const closeShopBtn = document.getElementById('closeShop');
        const shopModal = document.getElementById('shopModal');
        
        if (closeShopBtn) {
            closeShopBtn.addEventListener('click', () => {
                shopModal.classList.add('hidden');
            });
        }
        
        // Shop item purchases
        const shopItems = document.querySelectorAll('.shop-item');
        shopItems.forEach(item => {
            const buyBtn = item.querySelector('.buy-btn');
            if (buyBtn) {
                buyBtn.addEventListener('click', () => {
                    const pieceType = item.dataset.piece;
                    this.purchasePiece(pieceType);
                });
            }
        });
        
        // Dev buttons
        const clearAllPiecesBtn = document.getElementById('clearAllPiecesBtn');
        if (clearAllPiecesBtn) {
            clearAllPiecesBtn.addEventListener('click', () => {
                console.log('[Game] Clear all pieces button clicked');
                if (this.networkManager) {
                    this.networkManager.resetGame();
                }
            });
        }
        
        const spawnTestPiecesBtn = document.getElementById('spawnTestPiecesBtn');
        if (spawnTestPiecesBtn) {
            spawnTestPiecesBtn.addEventListener('click', () => {
                console.log('[Game] Spawn test pieces button clicked');
                // Request additional pieces from server instead of rejoining
                if (this.networkManager) {
                    // Send a request to spawn test pieces for current player
                    this.networkManager.emit('spawnTestPieces', {});
                }
            });
        }
        
        const recreateMapBtn = document.getElementById('recreateMapBtn');
        if (recreateMapBtn) {
            recreateMapBtn.addEventListener('click', async () => {
                console.log('[Game] Recreate map button clicked');
                try {
                    const response = await fetch('/api/world/recreate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        console.log('[Game] Map recreated successfully with seed:', result.seed);
                        
                        // Clear all terrain data and trees
                        this.terrainSystem.chunks.clear();
                        if (this.hybridTreeManager) {
                            this.hybridTreeManager.terrainTreeSystem.treeQuads.clear();
                            this.hybridTreeManager.terrainTreeSystem.treeGeometry.clear();
                        }
                        
                        // Clear board system terrain cache
                        if (this.boardSystem) {
                            this.boardSystem.clearTerrainCache();
                        }
                        
                        // Refresh terrain around camera
                        const cameraPos = this.cameraController.camera.position;
                        await this.terrainSystem.generateInitialTerrain(
                            Math.floor(cameraPos.x), 
                            Math.floor(cameraPos.z), 
                            this.terrainSystem.loadDistance
                        );
                        
                        // Update board system with new terrain
                        if (this.boardSystem) {
                            this.boardSystem.updateTerrainMesh();
                        }
                        
                        // Force camera position update to refresh terrain heights
                        this.cameraController.updateCameraPosition();
                        
                        alert(`Map recreated! New seed: ${result.seed}`);
                    } else {
                        console.error('[Game] Failed to recreate map:', result.message);
                        alert('Failed to recreate map: ' + result.message);
                    }
                } catch (error) {
                    console.error('[Game] Error recreating map:', error);
                    alert('Error recreating map: ' + error.message);
                }
            });
        }
        
        const testServerErrorBtn = document.getElementById('testServerErrorBtn');
        if (testServerErrorBtn) {
            testServerErrorBtn.addEventListener('click', async () => {
                console.log('[Game] Test server error button clicked');
                try {
                    const response = await fetch('/api/test-error', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    const result = await response.json();
                    if (result.success) {
                        console.log('[Game] Test error triggered successfully');
                        alert('Test error triggered! Check the Server Errors panel.');
                    } else {
                        console.error('[Game] Failed to trigger test error:', result.message);
                        alert('Failed to trigger test error: ' + result.message);
                    }
                } catch (error) {
                    console.error('[Game] Error triggering test error:', error);
                    alert('Error triggering test error: ' + error.message);
                }
            });
        }

        // Day time slider (0-24h)
        const dayTimeSlider = document.getElementById('dayTimeSlider');
        if (dayTimeSlider && this.boardSystem) {
            // Add flag to prevent auto-update while dragging
            dayTimeSlider.addEventListener('mousedown', () => {
                this.boardSystem._isDraggingDayTimeSlider = true;
            });
            dayTimeSlider.addEventListener('mouseup', () => {
                this.boardSystem._isDraggingDayTimeSlider = false;
            });
            dayTimeSlider.addEventListener('mouseleave', () => {
                this.boardSystem._isDraggingDayTimeSlider = false;
            });

            dayTimeSlider.addEventListener('input', (e) => {
                const hours = parseFloat(e.target.value);
                const dayProgress = hours / 24;
                const currentDay = Math.floor(this.boardSystem.serverGameTime / this.boardSystem.serverDayLength);
                this.boardSystem.serverGameTime = (currentDay + dayProgress) * this.boardSystem.serverDayLength;
                // Reset sync timestamp so sun position matches slider exactly (no drift)
                this.boardSystem.lastTimeSyncTimestamp = Date.now();
                console.log(`[Game] Day time set to ${hours.toFixed(1)}h`);
            });
        }

        // Day speed slider (3s-240s per day)
        const daySpeedSlider = document.getElementById('daySpeedSlider');
        const daySpeedValue = document.getElementById('daySpeedValue');
        if (daySpeedSlider && daySpeedValue && this.boardSystem) {
            daySpeedSlider.addEventListener('input', (e) => {
                const secondsPerDay = parseInt(e.target.value);
                const oldDayLength = this.boardSystem.serverDayLength;
                const newDayLength = secondsPerDay * 1000;

                // Preserve current time of day when changing speed
                const dayProgress = (this.boardSystem.serverGameTime % oldDayLength) / oldDayLength;
                const currentDay = Math.floor(this.boardSystem.serverGameTime / oldDayLength);

                // Recalculate serverGameTime to maintain same time of day
                this.boardSystem.serverDayLength = newDayLength;
                this.boardSystem.serverGameTime = (currentDay + dayProgress) * newDayLength;

                daySpeedValue.textContent = `${secondsPerDay}s/day`;
                console.log(`[Game] Day speed set to ${secondsPerDay}s/day`);
            });
        }

        // Time of year slider (0-365 days)
        const yearTimeSlider = document.getElementById('yearTimeSlider');
        if (yearTimeSlider && this.boardSystem) {
            // Add flag to prevent auto-update while dragging
            yearTimeSlider.addEventListener('mousedown', () => {
                this.boardSystem._isDraggingYearTimeSlider = true;
            });
            yearTimeSlider.addEventListener('mouseup', () => {
                this.boardSystem._isDraggingYearTimeSlider = false;
            });
            yearTimeSlider.addEventListener('mouseleave', () => {
                this.boardSystem._isDraggingYearTimeSlider = false;
            });

            yearTimeSlider.addEventListener('input', (e) => {
                const dayOfYear = parseInt(e.target.value);
                // Update season based on day of year
                const seasonLength = 365 / 4; // 91.25 days per season
                const seasonIndex = Math.floor(dayOfYear / seasonLength);
                const seasons = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
                const newSeason = seasons[Math.min(seasonIndex, 3)];
                const seasonProgress = (dayOfYear % seasonLength) / seasonLength;

                this.boardSystem.currentSeason = newSeason;
                this.boardSystem.seasonProgress = seasonProgress;
                this.boardSystem.dayOfYear = dayOfYear;
                console.log(`[Game] Time of year set to day ${dayOfYear}, season ${newSeason}`);
            });
        }
        
        const toggleCelShadingBtn = document.getElementById('toggleCelShadingBtn');
        if (toggleCelShadingBtn) {
            console.log('[Game] Toggle cel shading button found and event listener added');
            toggleCelShadingBtn.addEventListener('click', () => {
                console.log('[Game] Toggle cel shading button clicked');
                console.log('[Game] CelShaderSystem available:', !!this.celShaderSystem);
                console.log('[Game] Scene available:', !!this.scene);
                if (this.celShaderSystem) {
                    this.celShaderSystem.toggleCelShading(this.scene); // Use simple shader
                } else {
                    console.error('[Game] CelShaderSystem not available!');
                }
            });
        } else {
            console.log('[Game] Toggle cel shading button not found!');
        }

        const respawnBtn = document.getElementById('respawnBtn');
        if (respawnBtn) {
            respawnBtn.addEventListener('click', () => {
                console.log('[Game] Respawn button clicked - starting flying castle animation');
                this.startRespawnAnimation();
            });
        }

        // Space bar toggles dev tools visibility
        this._devToolsVisible = false;
        window.addEventListener('keydown', (e) => {
            if (e.key === ' ') {
                const devControls = document.getElementById('devControls');
                if (devControls) {
                    this._devToolsVisible = !this._devToolsVisible;
                    devControls.style.display = this._devToolsVisible ? 'block' : 'none';
                }
            }
        });
    }

    startRespawnAnimation() {
        if (this._isRespawnAnimating) return;
        this._isRespawnAnimating = true;

        // Store target position (current camera position)
        const targetPos = this.camera.position.clone();
        const targetLookAt = new THREE.Vector3(
            this.camera.position.x + Math.sin(this.camera.rotation.y) * 10,
            0,
            this.camera.position.z + Math.cos(this.camera.rotation.y) * 10
        );

        // Start high above like a flying castle view
        const startPos = new THREE.Vector3(
            targetPos.x + (Math.random() - 0.5) * 40,
            targetPos.y + 60 + Math.random() * 20,
            targetPos.z + (Math.random() - 0.5) * 40
        );

        this.camera.position.copy(startPos);
        this.camera.lookAt(targetPos.x, 0, targetPos.z);

        // Disable camera controls during animation
        if (this.cameraController) {
            this.cameraController.enabled = false;
        }

        const duration = 4000; // 4 seconds
        const startTime = performance.now();

        const animateRespawn = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease in-out cubic
            const ease = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            // Lerp camera position
            this.camera.position.lerpVectors(startPos, targetPos, ease);

            // Look at gradually shifts from looking down at board to normal view
            const lookAtPos = new THREE.Vector3().lerpVectors(
                new THREE.Vector3(targetPos.x, 0, targetPos.z),
                targetLookAt,
                ease
            );
            this.camera.lookAt(lookAtPos);

            if (progress < 1) {
                requestAnimationFrame(animateRespawn);
            } else {
                // Animation complete
                this._isRespawnAnimating = false;
                if (this.cameraController) {
                    this.cameraController.enabled = true;
                }
                console.log('[Game] Respawn animation complete');
            }
        };

        requestAnimationFrame(animateRespawn);
    }
    
    async setupNetwork() {
        this.networkManager = new NetworkManager();
        await this.networkManager.connect();
        
        // Setup server error display with network manager
        if (window.serverErrorDisplay) {
            window.serverErrorDisplay.setNetworkManager(this.networkManager);
        }
        
        // Setup network event handlers
        this.networkManager.on('gameState', (data) => {
            console.log('[Game] === GAME STATE RECEIVED ===');
            console.log('[Game] Received game state:', data);
            console.log('[Game] Data type:', typeof data);
            console.log('[Game] Data keys:', Object.keys(data));
            console.log('[Game] Pieces in data:', data.pieces ? data.pieces.length : 'NO PIECES');
            console.log('[Game] Players in data:', data.players ? data.players.length : 'NO PLAYERS');
            
            this.gameState.updateState(data);
            this.syncPiecesWithGameState(data);
            this.updateUI();
        });
        
        this.networkManager.on('pieceMoved', (data) => {
            this.handlePieceMoved(data);
        });
        
        this.networkManager.on('pieceAdded', (data) => {
            this.handlePieceAdded(data);
        });
        
        this.networkManager.on('piecePurchased', (data) => {
            this.handlePiecePurchased(data);
        });
        
        this.networkManager.on('playerJoined', (data) => {
            this.handlePlayerJoined(data);
        });
        
        this.networkManager.on('connectionStatus', (status) => {
            this.updateConnectionStatus(status);
        });
        
        this.networkManager.on('timeSync', (data) => {
            console.log('[Game] Time sync received:', data);
            if (this.boardSystem) {
                this.boardSystem.updateServerGameTime(data.elapsedTime, data.dayLength);
            }
        });
    }
    
    reportOptimizationStatus() {
        const opt = this.boardSystem ? this.boardSystem.optimization : null;
        const lines = [];
        const meshMode = this.boardSystem?.useViewportMesh ? 'viewport' : (this.boardSystem?.continuousMesh ? 'continuous' : 'chunk');
        lines.push(`Mesh: ${meshMode} (${this.boardSystem?.meshBounds?.size || '-'}x${this.boardSystem?.meshBounds?.size || '-'}) mult=${this.boardSystem?.meshMultiplier || '-'}`);
        lines.push(`Shadows: ${this.renderer?.shadowMap?.enabled ? 'ON' : 'OFF'}`);
        lines.push(`Grass: ${this.grassSystem ? 'ON' : 'OFF'}`);
        lines.push(`TexBlend: ${this.textureBlendingSystem ? 'ON' : 'OFF'}`);
        lines.push(`LOD: ${opt ? 'levels=' + opt.lodLevels.length : 'n/a'}`);
        lines.push(`Stream: ${opt?.streaming?.enabled ? 'YES' : 'NO'}`);
        lines.push(`PixelRatio: ${this.renderer?.getPixelRatio?.() || '-'}`);
        lines.push(`Chunks cached: ${this.terrainSystem?.chunks?.size || 0}`);
        
        // Add performance manager status
        if (this.performanceManager) {
            const status = this.performanceManager.getStatus();
            lines.push(`FPS: ${status.fps} (target: ${status.targetFps})`);
            lines.push(`Quality: ${status.qualityLevel}/4 (keys 0-4)`);
            lines.push(`VertexBudget: ${status.vertexBudget/1000}K`);
        }
        
        const el = document.getElementById('optStatus');
        if (el) el.textContent = lines.join('\n');
    }

    startGameLoop() {
        let lastTime = 0;
        let lastOptReport = 0;

        const animate = (currentTime) => {
            requestAnimationFrame(animate);

            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            lastTime = currentTime;

            // Update performance manager for automatic quality scaling
            if (this.performanceManager) {
                this.performanceManager.update(deltaTime);
            }

            if (currentTime - lastOptReport > 3000) {
                this.reportOptimizationStatus();
                lastOptReport = currentTime;
            }

            // console.log('[Game DEBUG] Game loop running, deltaTime:', deltaTime);

            // Update systems
            this.cameraController.update();

            // Update terrain trees based on camera position (terrain trees are part of terrain geometry)
            if (this.terrainTreeSystem) {
                // Terrain trees don't need camera updates - they're integrated into terrain
            }

            // Update visual feedback system
            if (this.visualFeedback) {
                this.visualFeedback.update();
            }

            // Update decorative visuals system
            if (this.decorativeVisuals) {
                this.decorativeVisuals.updateCameraPosition(this.camera.position);
                this.decorativeVisuals.update(deltaTime);
                
                // Update water wind parameters from decorative visuals
                if (this.boardSystem && this.boardSystem.setWindParameters) {
                    const windSpeed = this.decorativeVisuals.windSpeed || 1.0;
                    const windDirection = Math.atan2(this.decorativeVisuals.windDirection.y, this.decorativeVisuals.windDirection.x);
                    this.boardSystem.setWindParameters(windSpeed, windDirection);
                }
            }


            // Animate terrain tree wind swaying
            if (this.hybridTreeManager && this.decorativeVisuals) {
                const t = currentTime * 0.001;
                const ws = this.decorativeVisuals.windSpeed || 0.6;
                const wd = this.decorativeVisuals.windDirection || { x: 1, y: 0 };
                this.hybridTreeManager.update(t, ws, wd);
            }

            // Update baked geometry shadows
            if (this.shadowSystem && this.boardSystem && this.boardSystem.sun) {
                const sunAngleDeg = (this.boardSystem.sun.angle * 180 / Math.PI) % 360;
                const sunAzimuth = sunAngleDeg < 0 ? sunAngleDeg + 360 : sunAngleDeg;
                const windState = this.decorativeVisuals ? {
                    direction: this.decorativeVisuals.windDirection,
                    strength: this.decorativeVisuals.windSpeed || 0
                } : null;
                this.shadowSystem.update(currentTime * 0.001, sunAzimuth, windState);
            }

            // Grass system disabled - using board grass texture instead
            if (this.grassSystem) {
                console.log('[Game DEBUG] Grass system should be null but is not - this should not happen');
            }

            // Update pond weed ripple effect on underwater terrain
            if (this.pondWeedSystem && this.boardSystem) {
                this.pondWeedSystem.update(currentTime * 0.001, this.boardSystem.grassTexture);
            }

            // Update texture blending (temporarily disabled to fix errors)
            // if (this.textureBlendingSystem) {
            //     this.textureBlendingSystem.updateAllChunks(this.camera.position, currentTime * 0.001); // Convert to seconds
            //     this.textureBlendingSystem.updateAnimation(currentTime * 0.001, this.camera.position); // Convert to seconds
            // }

            // Update terrain streaming
            this.terrainSystem.updateStreaming(this.camera.position);

            // Update board streaming
            this.boardSystem.updateStreaming(this.camera.position, this.camera);

            // Update terrain tree foliage based on season
            if (this.terrainTreeSystem && this.boardSystem) {
                // Terrain trees have seasonal effects built into their materials
                // Could add seasonal material updates here if needed
            }

            // Update shadow quality based on performance
            this.updateShadowQuality(deltaTime * 1000); // Convert to ms

            // Count vertices in scene by object type
            let totalVertices = 0;
            let totalTriangles = 0;
            const vertexCounts = {
                terrain: 0,
                trees: 0,
                billboards: 0,
                pieces: 0,
                decorative: 0,
                other: 0
            };
            const otherObjects = new Map(); // Track other objects by name

            this.scene.traverse((object) => {
                if (object.isMesh && object.geometry) {
                    const positionAttribute = object.geometry.getAttribute('position');
                    if (positionAttribute) {
                        const count = positionAttribute.count;
                        totalVertices += count;

                        // Categorize by object type (check object or parent userData)
                        const isTree = object.userData?.isTree || (object.parent?.userData?.isTree);
                        const isBillboard = object.userData?.isBillboard || (object.parent?.userData?.isBillboard);
                        const isPiece = object.userData?.isPiece || (object.parent?.userData?.isPiece);
                        const isDecorative = object.userData?.isDecorative || (object.parent?.userData?.isDecorative);

                        if (object.name === 'dynamicContinuousMesh' || object.name === 'viewportMesh' || object.name === 'rollingTerrain' || object.name === 'terrainSingleMesh') {
                            vertexCounts.terrain += count;
                        } else if (isTree) {
                            vertexCounts.trees += count;
                        } else if (isBillboard) {
                            vertexCounts.billboards += count;
                        } else if (isPiece) {
                            vertexCounts.pieces += count;
                        } else if (isDecorative) {
                            vertexCounts.decorative += count;
                        } else {
                            vertexCounts.other += count;
                            // Track other objects by name
                            const objName = object.name || 'unnamed';
                            otherObjects.set(objName, (otherObjects.get(objName) || 0) + count);
                        }
                    }
                    const indexAttribute = object.geometry.getIndex();
                    if (indexAttribute) {
                        totalTriangles += indexAttribute.count / 3;
                    } else if (positionAttribute) {
                        totalTriangles += positionAttribute.count / 3;
                    }
                }
            });

            // Update dev tools section with vertex/triangle counts every 10 frames
            if (Math.floor(currentTime / 16) % 10 === 0) {
                const vEl = document.getElementById('vertexCount');
                const tEl = document.getElementById('triangleCount');
                if (vEl) vEl.textContent = `${(totalVertices / 1000).toFixed(1)}K`;
                if (tEl) tEl.textContent = `${(totalTriangles / 1000).toFixed(1)}K`;

                // Log detailed breakdown every 60 frames (approx 1 second)
                if (Math.floor(currentTime / 16) % 60 === 0) {
                    console.log(`[VERTEX PROFILE] Total: ${(totalVertices/1000).toFixed(1)}K | Terrain: ${(vertexCounts.terrain/1000).toFixed(1)}K | Trees: ${(vertexCounts.trees/1000).toFixed(1)}K | Billboards: ${(vertexCounts.billboards/1000).toFixed(1)}K | Pieces: ${(vertexCounts.pieces/1000).toFixed(1)}K | Decorative: ${(vertexCounts.decorative/1000).toFixed(1)}K | Other: ${(vertexCounts.other/1000).toFixed(1)}K`);
                    // Log other objects breakdown if significant
                    if (vertexCounts.other > 10000) {
                        console.log(`[OTHER OBJECTS] ${Array.from(otherObjects.entries()).map(([name, verts]) => `${name}: ${(verts/1000).toFixed(1)}K`).join(' | ')}`);
                    }
                }
            }

            // Render
            this.renderer.render(this.scene, this.camera);
        };

        animate(0);
    }
    
    onMouseClick(event) {
        if (!this.isInitialized) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        
        // Check for piece clicks first
        const pieceMeshes = this.piecesSystem.getAllPieceMeshes();
        const pieceIntersects = raycaster.intersectObjects(pieceMeshes, true);
        
        if (pieceIntersects.length > 0) {
            const pieceMesh = pieceIntersects[0].object;
            const piece = this.piecesSystem.getPieceByMesh(pieceMesh);
            
            if (piece) {
                console.log('[Game] Piece clicked:', piece);
                this.selectPiece(piece);
                return;
            }
        }
        
        // Check for board clicks
        const boardMeshes = this.boardSystem.getBoardMeshes();
        const boardIntersects = raycaster.intersectObjects(boardMeshes);
        
        if (boardIntersects.length > 0) {
            const intersection = boardIntersects[0];
            const tilePos = this.boardSystem.getTileFromIntersection(intersection);
            
            if (tilePos) {
                console.log('[Game] Tile clicked:', tilePos.x, tilePos.z);
                
                // Check if there's a marker on this clicked square
                const hasMarkerOnSquare = this.validMoves.some(move => move.x === tilePos.x && move.z === tilePos.z);
                
                if (hasMarkerOnSquare) {
                    console.log('[Game] Tile has marker, processing move for:', tilePos.x, tilePos.z);
                    this.handleTileClick(tilePos.x, tilePos.z);
                    return;
                } else {
                    // Only process non-marker board clicks if there are no visible markers
                    const hasVisibleMarkers = this.visualFeedback.hasVisibleMoveMarkers();
                    if (!hasVisibleMarkers) {
                        console.log('[Game] No markers on tile and no visible markers, processing regular tile click');
                        this.handleTileClick(tilePos.x, tilePos.z);
                    } else {
                        console.log('[Game] No marker on this tile, ignoring click (markers are present elsewhere)');
                    }
                }
            }
        }
    }
    
    onMouseMove(event) {
        if (!this.isInitialized) return;
        
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        
        // Check for tile hover
        const boardMeshes = this.boardSystem.getBoardMeshes();
        const intersects = raycaster.intersectObjects(boardMeshes);
        
        if (intersects.length > 0) {
            const intersection = intersects[0];
            const tilePos = this.boardSystem.getTileFromIntersection(intersection);
            
            if (tilePos && (!this.hoveredTile || this.hoveredTile.x !== tilePos.x || this.hoveredTile.z !== tilePos.z)) {
                this.hoveredTile = tilePos;
                this.visualFeedback.showTileHover(tilePos.x, tilePos.z);
                
                // Update fade system to center on this tile position
                this.boardSystem.updateFadeCenter(tilePos.x + 0.5, tilePos.z + 0.5);
            }
        } else {
            this.hoveredTile = null;
            this.visualFeedback.hideTileHover();
        }
    }
    
    onKeyDown(event) {
        if (!this.isInitialized) return;
        
        switch (event.key.toLowerCase()) {
            case 'x':
                this.toggleShop();
                break;
            case 'c':
                this.centerCameraOnKing();
                break;
            // Performance manager quality overrides
            case '0':
            case '1':
            case '2':
            case '3':
            case '4':
                if (this.performanceManager) {
                    const level = parseInt(event.key);
                    this.performanceManager.forceQualityLevel(level);
                    console.log(`[Game] Forced quality level to ${level}`);
                }
                break;
            // Space key removed - tactical mode is now default
            case 'escape':
                this.closeAllModals();
                break;
        }
        
        // Pass to camera controller for movement
        this.cameraController.handleKeyDown(event);
    }
    
    onKeyUp(event) {
        if (!this.isInitialized) return;
        this.cameraController.handleKeyUp(event);
    }
    
    selectPiece(piece) {
        console.log('[Game] selectPiece called with:', piece);
        
        // Ownership check: only allow selecting your own pieces
        const myPlayerId = this.gameState.getCurrentPlayerId();
        if (piece.playerId !== myPlayerId) {
            console.log('[Game] Cannot select enemy piece:', piece.id, 'owner:', piece.playerId, 'me:', myPlayerId);
            return;
        }
        
        this.selectedPiece = piece;
        this.validMoves = this.movementBridge.getValidMovesForPiece(piece);
        
        // Show visual feedback
        this.visualFeedback.showSelectedPiece(piece);
        this.visualFeedback.showValidMoves(this.validMoves);
    }
    
    purchasePiece(pieceType) {
        if (this.networkManager) {
            this.networkManager.emit('purchasePiece', {
                pieceType: pieceType,
                playerId: this.gameState.getCurrentPlayerId()
            });
        }
    }
    
    handlePieceMoved(data) {
        console.log('[Game] Piece moved:', data);
        console.log('[Game] BEFORE clearValidMoves - selectedPiece:', this.selectedPiece);
        
        // Update piece position in game state and visual mesh
        if (data.piece && data.piece.id) {
            this.gameState.updatePiecePosition(data.piece.id, data.piece.x, data.piece.z);
            console.log('[Game] Updated piece position in game state:', data.piece.id, 'to', data.piece.x, data.piece.z);
            
            // Clear all available square markers first
            console.log('[Game] Clearing valid moves immediately...');
            this.visualFeedback.clearValidMovesImmediate();
            
            // Update visual piece mesh position with animation and callback
            const pieceMesh = this.piecesSystem.getPieceMesh(data.piece.id);
            if (pieceMesh) {
                console.log('[Game] Starting piece animation with callback for:', data.piece.id);
                
                // Create callback to generate new available square markers when animation completes
                const onAnimationComplete = () => {
                    console.log('[Game] Piece animation completed, generating new available square markers');
                    
                    // Check for water splash at destination
                    const destHeight = this.terrainSystem.getHeight(data.piece.x, data.piece.z);
                    if (destHeight < -1.5) {
                        console.log('[Game] Piece landed in water, showing splash at', data.piece.x, data.piece.z);
                        this.visualFeedback.showWaterSplash(data.piece.x + 0.5, data.piece.z + 0.5);
                    }
                    
                    // Update valid moves using the moved piece data
                    const movedPiece = this.gameState.getPiece(data.piece.id);
                    console.log('[Game] Moved piece from game state:', movedPiece);
                    console.log('[Game] Data piece from server:', data.piece);
                    if (movedPiece) {
                        console.log('[Game] Getting valid moves for moved piece:', movedPiece);
                        this.validMoves = this.movementBridge.getValidMovesForPiece(movedPiece);
                        console.log('[Game] Valid moves found:', this.validMoves.length);
                        
                        if (this.validMoves.length > 0) {
                            console.log('[Game] Showing valid moves for moved piece:', this.validMoves.length, 'moves');
                            this.visualFeedback.showValidMoves(this.validMoves, false);
                        } else {
                            console.log('[Game] No valid moves to show for moved piece');
                        }
                        
                        // Keep the piece selected to show its moves
                        console.log('[Game] BEFORE RESELECTING - selectedPiece:', this.selectedPiece);
                        this.selectedPiece = movedPiece;
                        console.log('[Game] AFTER RESELECTING - selectedPiece:', this.selectedPiece);
                        this.visualFeedback.showSelectedPiece(movedPiece);
                        this.updateSelectedPieceUI(movedPiece);
                    } else {
                        console.log('[Game] ERROR: Could not find moved piece in game state');
                    }
                };
                
                this.piecesSystem.movePieceWithCallback(data.piece.id, data.piece.x, data.piece.z, onAnimationComplete);
                console.log('[Game] Updated visual piece mesh position with callback:', data.piece.id, 'to', data.piece.x, data.piece.z);
            } else {
                console.log('[Game] Warning: Piece mesh not found for ID:', data.piece.id);
            }
            
            // Verify the update worked
            const updatedPiece = this.gameState.getPiece(data.piece.id);
            console.log('[Game] Verification - piece position after update:', updatedPiece);
        }
    }
    
    handlePiecePurchased(data) {
        if (data.success) {
            // Get player color for new piece
            const player = this.gameState.getCurrentPlayer();
            if (player) {
                data.piece.color = player.color;
            }
            
            const spawnedPiece = this.piecesSystem.addPiece(data.piece);
            
            if (spawnedPiece) {
                // Piece spawned successfully
                this.visualFeedback.showSpawnEffect(data.piece.x, data.piece.z);
                
                // Add purchased piece to game state
                this.gameState.pieces.set(data.piece.id, data.piece);
            } else {
                // Spawn failed - location surrounded by blocked terrain
                console.warn('[Game] Piece spawn failed - invalid location');
                // Could show error feedback to user here
            }
        }
    }
    
    handlePieceAdded(data) {
        console.log('[Game] === HANDLE PIECE ADDED ===');
        console.log('[Game] Received piece data:', data);
        console.log('[Game] Current pieces in gameState before adding:', this.gameState.pieces.size);
        
        // Get player color for new piece
        const player = this.gameState.players.get(data.playerId);
        console.log('[Game] Found player for piece:', player ? player.name : 'NOT FOUND');
        if (player) {
            data.color = player.color;
            console.log('[Game] Applied player color:', data.color);
        }
        
        // Add piece to pieces system and game state
        console.log('[Game] Calling piecesSystem.addPiece...');
        const spawnedPiece = this.piecesSystem.addPiece(data);
        
        if (spawnedPiece) {
            // Piece spawned successfully
            console.log('[Game] Calling visualFeedback.showSpawnEffect...');
            this.visualFeedback.showSpawnEffect(data.x, data.z);
            
            // Add new piece to game state
            this.gameState.pieces.set(data.id, data);
            console.log('[Game] Added new player piece to game state:', data.id);
            console.log('[Game] Total pieces in gameState after adding:', this.gameState.pieces.size);
        } else {
            // Spawn failed - location surrounded by blocked terrain
            console.warn('[Game] Piece spawn failed in handlePieceAdded - invalid location');
        }
    }
    
    handlePlayerJoined(data) {
        console.log('Player joined:', data.name);
        
        // Set current player if this is the local player
        if (this.networkManager.socket && data.id === this.networkManager.socket.id) {
            this.gameState.setCurrentPlayerId(data.id);
        }
        
        // Update player list UI
    }
    
    toggleShop() {
        const shopModal = document.getElementById('shopModal');
        if (shopModal) {
            shopModal.classList.toggle('hidden');
            if (!shopModal.classList.contains('hidden')) {
                this.updateShopUI();
            }
        }
    }
    
    centerCameraOnKing() {
        const king = this.gameState.getCurrentPlayerKing();
        if (king) {
            this.cameraController.centerOnPosition(king.x, king.z);
        }
    }
    
    handleTileClick(x, z) {
        console.log(`[Game] handleTileClick called at (${x},${z})`);
        console.log(`[Game] selectedPiece:`, this.selectedPiece);
        console.log(`[Game] validMoves:`, this.validMoves);
        
        if (this.selectedPiece) {
            // Check if this is a valid move for the selected piece
            const isValidMove = this.validMoves.some(move => move.x === x && move.z === z);
            console.log(`[Game] isValidMove: ${isValidMove}`);
            
            if (isValidMove) {
                console.log(`[Game] About to call movePiece with piece:`, this.selectedPiece, `to (${x},${z})`);
                this.movePiece(this.selectedPiece, x, z);
                console.log(`[Game] movePiece called, returning early`);
                // Don't deselect here - let handlePieceMoved handle it
                return;
            }
        }
        
        console.log(`[Game] No valid move, deselecting piece`);
        // Deselect piece only if no valid move was made
        console.log(`[Game] BEFORE DESELECT - selectedPiece:`, this.selectedPiece);
        this.selectedPiece = null;
        console.log(`[Game] AFTER DESELECT - selectedPiece:`, this.selectedPiece);
        this.validMoves = [];
        this.visualFeedback.hideSelection();
    }
    
    deselectFromTouchDrag() {
        // Called by camera.js when touch dragging on empty ground in isometric mode
        if (this.selectedPiece) {
            console.log('[Game] Deselecting piece from touch drag on empty ground');
            this.selectedPiece = null;
        }
        this.validMoves = [];
        this.visualFeedback.hideSelection();
        this.visualFeedback.clearValidMovesImmediate();
    }
    
    movePiece(piece, toX, toZ) {
        console.log(`[Game] movePiece called with piece:`, piece, `to (${toX},${toZ})`);
        
        if (!this.networkManager) {
            console.log('[Game] No network manager, cannot send move');
            return;
        }
        
        // Send move request to server
        this.networkManager.emit('movePiece', {
            pieceId: piece.id,
            fromX: piece.x,
            fromZ: piece.z,
            toX: toX,
            toZ: toZ
        });
        
        console.log(`[Game] Move request sent for piece ${piece.id} from (${piece.x},${piece.z}) to (${toX},${toZ})`);
    }
    
    closeAllModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => modal.classList.add('hidden'));
    }
    
    updateUI() {
        this.updatePlayerInfo();
        this.updateShopUI();
    }
    
    updatePlayerInfo() {
        const player = this.gameState.getCurrentPlayer();
        if (player) {
            const nameEl = document.getElementById('playerName');
            const pointsEl = document.getElementById('playerPoints');
            const piecesEl = document.getElementById('playerPieces');
            
            if (nameEl) nameEl.textContent = player.name;
            if (pointsEl) pointsEl.textContent = `Points: ${player.points.total}`;
            if (piecesEl) piecesEl.textContent = `Pieces: ${player.pieces.length}`;
        }
    }
    
    updateShopUI() {
        const shopPointsEl = document.getElementById('shopPoints');
        const player = this.gameState.getCurrentPlayer();
        
        if (shopPointsEl && player) {
            shopPointsEl.textContent = `Points: ${player.points.total}`;
        }
        
        // Update buy buttons
        const shopItems = document.querySelectorAll('.shop-item');
        shopItems.forEach(item => {
            const buyBtn = item.querySelector('.buy-btn');
            const cost = parseInt(item.querySelector('.cost').textContent);
            
            if (buyBtn && player) {
                buyBtn.disabled = player.points.total < cost;
            }
        });
    }
    
    updateSelectedPieceUI(piece) {
        const infoPanel = document.getElementById('selectedPieceInfo');
        const typeEl = document.getElementById('selectedPieceType');
        const cooldownEl = document.getElementById('selectedPieceCooldown');
        
        if (piece && infoPanel) {
            infoPanel.classList.remove('hidden');
            if (typeEl) typeEl.textContent = piece.type.charAt(0).toUpperCase() + piece.type.slice(1);
            
            const cooldown = this.getPieceCooldown(piece);
            if (cooldownEl) {
                if (cooldown > 0) {
                    cooldownEl.textContent = `Cooldown: ${(cooldown / 1000).toFixed(1)}s`;
                } else {
                    cooldownEl.textContent = 'Ready';
                }
            }
        } else if (infoPanel) {
            infoPanel.classList.add('hidden');
        }
    }
    
    updateConnectionStatus(status) {
        // Hide the floating connection status - only log to console
        console.log(`[CONNECTION ${status.connected ? 'CONNECTED' : 'DISCONNECTED'}]`, status.text);
        
        // Optional: Keep the element but hide it visually
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) {
            statusEl.style.display = 'none';
        }
    }
    
    syncPiecesWithGameState(gameStateData) {
        console.log('[Game] === SYNCING PIECES WITH GAME STATE ===');
        console.log('[Game] Game state data received:', gameStateData);
        console.log('[Game] Pieces array:', gameStateData.pieces);
        console.log('[Game] Pieces count:', gameStateData.pieces?.length || 0);
        console.log('[Game] Players array:', gameStateData.players);
        console.log('[Game] Players count:', gameStateData.players?.length || 0);
        
        // Check if piecesSystem exists
        console.log('[Game] Pieces system available:', !!this.piecesSystem);
        
        // Clear existing pieces
        console.log('[Game] Clearing existing pieces...');
        this.piecesSystem.clearAllPieces();
        
        // Spawn all pieces from game state
        if (gameStateData.pieces && gameStateData.pieces.length > 0) {
            console.log(`[Game] Spawning ${gameStateData.pieces.length} pieces from game state...`);
            gameStateData.pieces.forEach((pieceData, index) => {
                
                // Check if piece already exists to prevent duplicates
                const existingPiece = this.piecesSystem.getPiece(pieceData.id);
                if (existingPiece) {
                    console.log(`[Game] Piece ${pieceData.id} already exists, skipping creation`);
                    return;
                }
                
                // Add player color to piece data
                const player = gameStateData.players.find(p => p.id === pieceData.playerId);
                if (player) {
                    pieceData.color = player.color;
                } else {
                    // Fallback to existing color or default to white
                    pieceData.color = pieceData.color || 'white';
                }
                
                this.piecesSystem.addPiece(pieceData);
            });
        } else {
        }
        
    }
    
    getPieceCooldown(piece) {
        const cooldowns = {
            pawn: 2000,
            knight: 3000,
            bishop: 3000,
            rook: 4000,
            queen: 6000,
            king: 2000
        };
        
        const cooldownTime = cooldowns[piece.type] || 2000;
        const timeSinceMove = Date.now() - (piece.lastMoveTime || 0);
        return Math.max(0, cooldownTime - timeSinceMove);
    }
    
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    showLoadingProgress(percent) {
        const progressBar = document.querySelector('.loading-progress');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
    }
    
    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 500);
        }
    }
    
    showError(message) {
        console.error(message);
        // Could show error modal here
    }
}

// Initialize game when all scripts are loaded
function initializeGame() {
    if (typeof THREE === 'undefined') {
        console.error('THREE.js is not loaded!');
        showError('Failed to load 3D engine. Please refresh the page.');
        return;
    }
    
    if (typeof io === 'undefined') {
        console.error('Socket.IO is not loaded!');
        showError('Failed to load networking. Please refresh the page.');
        return;
    }
    
    try {
        console.log('Initializing Chessopia game...');
        window.game = new ChessopiaGame();
        
        // Random test king logic removed - pieces now spawn properly through gameState
    } catch (error) {
        console.error('Failed to initialize game:', error);
        showError('Failed to initialize game. Please refresh the page.');
    }
}

// Initialize game when called
window.initializeGame = initializeGame;

// Temporary reset command
window.resetGame = () => {
    if (window.game && window.game.networkManager) {
        window.game.networkManager.resetGame();
    } else {
        console.error('Game not initialized or network manager not available');
    }
};

// Also try to initialize on DOM content loaded as fallback
window.addEventListener('DOMContentLoaded', () => {
    if (typeof THREE !== 'undefined' && typeof io !== 'undefined') {
        setTimeout(initializeGame, 100);
    }
});
