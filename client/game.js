class ChessopiaGame {
    constructor() {
        console.log('[Game] ChessopiaGame constructor called!');
        if (typeof window !== 'undefined') {
            window.gameInstance = this;
        }
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
        this.lodManager = null;
        this.temporalAA = null;
        this.minimapOverlay = null;
        this.settlementSystem = null;
        
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
            this.setupTemporalAA();
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

            // Initialize shader wrangler material registry
            if (typeof MaterialRegistry !== 'undefined') {
                this.materialRegistry = new MaterialRegistry();
                await this.materialRegistry.init();
                window.materialRegistry = this.materialRegistry;
                console.log('[Game] MaterialRegistry initialized');
            } else {
                console.log('[Game] MaterialRegistry not available');
            }
            
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

                // Expose for console debugging (trees are loaded on-demand via devtools)
                if (this.hybridTreeManager) {
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
        
        // Set background color (black for space, sky shader handles atmosphere)
        this.renderer.setClearColor(0x000000, 1);

        // WebGL context loss/restore handling (critical for Android)
        const canvas = this.renderer.domElement;
        canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            console.warn('[Game] WebGL context lost - pausing render loop');
            this._contextLost = true;
            if (this._animFrameId) {
                cancelAnimationFrame(this._animFrameId);
                this._animFrameId = null;
            }
        });
        canvas.addEventListener('webglcontextrestored', () => {
            console.log('[Game] WebGL context restored - resuming');
            this._contextLost = false;
            this.startGameLoop();
        });
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
            details: {},
            features: {
                temporalAA: false
            }
        };

        try {
            const gl = this.renderer.getContext();
            const webglCaps = this.renderer.capabilities;

            const supportsWebGL2 = !!webglCaps.isWebGL2;

            caps.details.maxTextureSize = webglCaps.maxTextureSize;
            caps.details.maxVertexTextures = webglCaps.maxVertexTextures;
            caps.details.maxTextureImageUnits = webglCaps.maxTextureImageUnits;
            caps.details.hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
            caps.details.deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
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

            caps.features.temporalAA = supportsWebGL2 && score >= 2;

            if (score >= 5) {
                caps.tier = 'high';
                caps.gridSize = 192;
                caps.meshMultiplier = 36;
                caps.renderDistance = 60;
                caps.terrainLoadRadius = 30;
                caps.pixelRatioCap = 2;
                caps.defaultTaa = true;
            } else if (score >= 2) {
                caps.tier = 'medium';
                caps.gridSize = 128;
                caps.meshMultiplier = 24;
                caps.renderDistance = 40;
                caps.terrainLoadRadius = 20;
                caps.pixelRatioCap = 1.5;
                caps.defaultTaa = false;
            } else {
                caps.tier = 'low';
                caps.gridSize = 96;
                caps.meshMultiplier = 18;
                caps.renderDistance = 30;
                caps.terrainLoadRadius = 15;
                caps.antialias = false;
                caps.pixelRatioCap = 1;
                caps.defaultTaa = false;
                caps.features.temporalAA = false;
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

        // Sky shader system: procedural day-night sky + starfield
        if (typeof SkyShaderSystem !== 'undefined') {
            this.skyShaderSystem = new SkyShaderSystem(this.scene);
            // Show stars from ground level (transparent atmospheric fade)
            this.skyShaderSystem.setFadeStartHeight(0);
            this.skyShaderSystem.setFadeEndHeight(100);
            console.log('[Game] SkyShaderSystem initialized');
        }
        
        // Setup lighting
        this.setupLighting();
        console.log('[Game] Lighting setup completed');
        
        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            5000
        );
        
        // Verify fog is still applied after camera setup
        console.log('[Game] Fog verification after camera setup:', !!this.scene.fog);
        this.camera.position.set(5, 20, 5);
        this.camera.lookAt(0, 0, 0);
        console.log('[Game] Camera setup completed');

        // Camera raycast debug dot
        this._raycaster = new THREE.Raycaster();
        this._mouseNDC = new THREE.Vector2(0, 0);
        const dotGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5,
            depthTest: false
        });
        this.raycastDot = new THREE.Mesh(dotGeo, dotMat);
        this.raycastDot.visible = false;
        this.scene.add(this.raycastDot);
        this.raycastDotEnabled = false;

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

        // Mouse spotlight
        this.createMouseLight();
    }

    createMouseLight(type = 'SpotLight') {
        // Remove existing spotlight if any
        if (this.spotLight) {
            this.scene.remove(this.spotLight);
            this.spotLight = null;
        }
        if (this.spotLightHelper) {
            this.scene.remove(this.spotLightHelper);
            this.spotLightHelper = null;
        }

        const ps = window.parameterSystem;
        const height = ps ? ps.getParameter('spotlightHeight') : 25;
        const intensity = ps ? ps.getParameter('spotlightIntensity') : 0.4;
        const color = ps ? ps.getParameter('spotlightColor') : '#ffffff';
        const angle = ps ? ps.getParameter('spotlightAngle') : 0.19635;

        if (type === 'SpotLight') {
            this.spotLight = new THREE.SpotLight(color, intensity, 100, angle, 0.5, 1);
            this.spotLight.position.set(0, height, 0);
            this.spotLight.target.position.set(0, 0, 0);
            this.spotLight.visible = ps ? ps.getParameter('spotlightEnabled') !== false : true;
            this.scene.add(this.spotLight);
            this.scene.add(this.spotLight.target);
        } else if (type === 'PointLight') {
            this.spotLight = new THREE.PointLight(color, intensity, 50, 2);
            this.spotLight.position.set(0, height, 0);
            this.spotLight.visible = ps ? ps.getParameter('spotlightEnabled') !== false : true;
            this.scene.add(this.spotLight);
        } else if (type === 'DirectionalLight') {
            this.spotLight = new THREE.DirectionalLight(color, intensity);
            this.spotLight.position.set(0, height, 0);
            this.spotLight.target.position.set(0, 0, 0);
            this.spotLight.visible = ps ? ps.getParameter('spotlightEnabled') !== false : true;
            this.scene.add(this.spotLight);
            this.scene.add(this.spotLight.target);
        }

        // Spotlight helper for debugging
        if (type === 'SpotLight') {
            this.spotLightHelper = new THREE.SpotLightHelper(this.spotLight);
            this.spotLightHelper.visible = ps ? ps.getParameter('spotlightHelper') : false;
            this.scene.add(this.spotLightHelper);
        }

        console.log('[Game] Created mouse spotlight:', type);
    }

    recreateMouseLight(type) {
        this.createMouseLight(type);
    }

    updateMouseSpotlight() {
        if (!this.spotLight || !this.boardSystem) return;

        const mouseWorldPos = this.boardSystem.mouseWorldPosition;
        if (mouseWorldPos) {
            const ps = window.parameterSystem;
            const height = ps ? ps.getParameter('spotlightHeight') : 25;

            this.spotLight.position.set(mouseWorldPos.x, height, mouseWorldPos.z);
            if (this.spotLight.target) {
                this.spotLight.target.position.set(mouseWorldPos.x, 0, mouseWorldPos.z);
            }
            if (this.spotLightHelper) {
                this.spotLightHelper.update();
            }
        }
    }
    
    async setupSystems() {
        console.log('[Game] setupSystems() started!');
        // Initialize game systems
        this.gameState = new ClientGameState();

        // Initialize performance manager first (needed by LODManager)
        this.performanceManager = new PerformanceManager(this);
        console.log('[Game] PerformanceManager created');

        // Initialize ResourceGuard for leak detection & crash prevention
        this.resourceGuard = new ResourceGuard(this);
        console.log('[Game] ResourceGuard initialized');

        // Initialize LOD manager for adaptive level-of-detail (needed by HybridTreeManager)
        if (typeof LODManager !== 'undefined') {
            this.lodManager = new LODManager({ performanceManager: this.performanceManager });
            console.log('[Game] LODManager created');
        } else {
            console.warn('[Game] LODManager not available - skipping adaptive LOD');
            this.lodManager = null;
        }

        // Create hybrid tree manager with patch-based alternation between TerrainTreeSystem and LocalTreeSystem
        this.oldTreeSystem = null; // Disable old tree system
        this.hybridTreeManager = new HybridTreeManager(this.scene, null, this.lodManager);
        this.hybridTreeManager.treeTypeOverride = 'none';
        console.log('[Game] Hybrid tree manager created - trees load lazily');

        // Disable baked shadow system for now (debug version never enabled)
        this.shadowSystem = null;

        this.terrainSystem = new TerrainSystem(this.scene, null);
        this.boardSystem = new CleanBoardSystem(this.scene, this.terrainSystem, null, this, this.renderer);

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
            }
        };

        // Initialize shadow quality after board system is created
        setTimeout(() => {
            this.applyShadowQuality();
            console.log(`[SHADOW] Initial quality set to ${this.shadowQuality.current} (${this.shadowQuality.resolutions[this.shadowQuality.current]}x${this.shadowQuality.resolutions[this.shadowQuality.current]})`);
        }, 100);
        
        // Set up chunk loaded callback to regenerate terrain mesh
        this._lastChunkMeshRebuild = 0;
        const previousCallback = this.terrainSystem.onChunkLoaded;
        this.terrainSystem.onChunkLoaded = (chunkX, chunkZ) => {
            // Preserve board_clean.js's refreshRegion callback for rolling terrain
            if (previousCallback) previousCallback(chunkX, chunkZ);

            // Load trees for this newly-generated chunk
            // console.log(`[Game] onChunkLoaded (${chunkX}, ${chunkZ}) – requesting trees`);
            if (this.hybridTreeManager) {
                this.hybridTreeManager.loadTreesForChunk(chunkX, chunkZ);
            }

            // Legacy dynamic mesh rebuild (skip for viewport/rolling terrain)
            if (!this.boardSystem || !this.boardSystem.continuousMesh) return;
            if (this.boardSystem.useViewportMesh) return;

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

        const previousChunkUnloaded = this.terrainSystem.onChunkUnloaded;
        this.terrainSystem.onChunkUnloaded = (chunkX, chunkZ) => {
            if (previousChunkUnloaded) previousChunkUnloaded(chunkX, chunkZ);
            if (this.hybridTreeManager) {
                this.hybridTreeManager.unloadTreesForChunk(chunkX, chunkZ);
            }
        };
        
        // Update terrain tree system with terrain system and shadow system references
        if (this.hybridTreeManager) {
            this.hybridTreeManager.terrainSystem = this.terrainSystem;
        }
        
        // Simple tree system works independently with server data
        this.cameraController = new CameraController(this.camera, this.scene);
        if (typeof MovementBridge !== 'undefined') {
            this.movementBridge = new MovementBridge(this.gameState, this.boardSystem);
        } else {
            console.warn('[Game] MovementBridge not available');
        }
        this.visualFeedback = new VisualFeedbackSystem(this.scene);
        console.log('[Game] Creating SimpleCelShaderSystem...');
        this.celShaderSystem = new SimpleCelShaderSystem();
        console.log('[Game] SimpleCelShaderSystem created:', !!this.celShaderSystem);

        // Initialize decorative visuals system
        console.log('[Game] Creating DecorativeVisualsSystem...');
        this.decorativeVisuals = new DecorativeVisualsSystem(this.scene, this.terrainSystem, this);
        console.log('[Game] DecorativeVisualsSystem created:', !!this.decorativeVisuals);

        // Initialize settlement simulation system
        if (typeof SettlementSystem !== 'undefined') {
            this.settlementSystem = new SettlementSystem(this.scene, this.terrainSystem, this);
            this.settlementSystem.init();

            const buildingSystem = new BuildingSystem(this.scene, this.terrainSystem, this.settlementSystem);
            buildingSystem.init();

            const roadSystem = new RoadSystem(this.scene, this.terrainSystem, this.settlementSystem);
            roadSystem.init();

            const villagerSystem = new VillagerSystem(this.scene, this.terrainSystem, this.settlementSystem);
            villagerSystem.init();

            const knightSystem = new KnightSystem(this.scene, this.terrainSystem, this.settlementSystem);
            knightSystem.init();

            const tournamentSystem = new TournamentSystem(this.scene, this.terrainSystem, this.settlementSystem, knightSystem);
            tournamentSystem.init();

            this.settlementSystem.setSubsystems(villagerSystem, buildingSystem, roadSystem, knightSystem, tournamentSystem);

            if (typeof TomeUI !== 'undefined') {
                this.tomeUI = new TomeUI(this.settlementSystem);
                this.tomeUI.init();
            }

            console.log('[Game] SettlementSystem initialized');
            window.settlementSystem = this.settlementSystem;
        } else {
            console.warn('[Game] SettlementSystem not available');
        }

        if (typeof MinimapOverlay !== 'undefined') {
            try {
                this.minimapOverlay = new MinimapOverlay({
                    terrainSystem: this.terrainSystem,
                    cameraController: this.cameraController
                });
                window.minimapOverlay = this.minimapOverlay; // expose for wind field consumers
                console.log('[Game] MinimapOverlay initialized');

                // Connect minimap to terrain chunk loading
                const terrainCallback = this.terrainSystem.onChunkLoaded;
                this.terrainSystem.onChunkLoaded = (chunkX, chunkZ) => {
                    if (terrainCallback) terrainCallback(chunkX, chunkZ);
                    this.minimapOverlay.onChunkLoaded(chunkX, chunkZ);
                };
            } catch (err) {
                console.warn('[Game] Failed to initialize MinimapOverlay', err);
                this.minimapOverlay = null;
            }
        } else {
            console.warn('[Game] MinimapOverlay script missing');
        }

        // Initialize texture blending system after board system is created
        console.log('[Game] Creating TextureBlendingSystem for adaptive terrain...');

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
        // Load only the center chunks needed for the initial view.
        // The full grid is loaded progressively in warmChunkCache below.
        const initialLoadRadius = this.terrainSystem.chunkSize * 1.5; // 24 units = ~25 chunks
        await this.terrainSystem.generateInitialTerrain(0, 0, initialLoadRadius);

        // Apply detected capability tier to board & streaming
        this.boardSystem.useViewportMesh = true;
        this.boardSystem.renderDistance = caps.renderDistance;
        console.log(`[Game] Device tier: ${caps.tier}, gridSize: ${caps.gridSize}, meshMultiplier: ${caps.meshMultiplier}, renderDistance: ${caps.renderDistance}`);
        await this.boardSystem.createBoard(0, 0, 3, caps.meshMultiplier, caps.gridSize);

        if (typeof JesusSummonSystem !== 'undefined') {
            this.jesusSummonSystem = new JesusSummonSystem({
                scene: this.scene,
                boardSystem: this.boardSystem,
                terrainSystem: this.terrainSystem
            });
            window.jesusSummonSystem = this.jesusSummonSystem;
            console.log('[Game] JesusSummonSystem initialized');
            if (typeof JesusSummonTriggerSystem !== 'undefined') {
                this.jesusSummonTriggerSystem = new JesusSummonTriggerSystem({
                    game: this,
                    jesusSummonSystem: this.jesusSummonSystem
                });
                console.log('[Game] JesusSummonTriggerSystem initialized');
            } else {
                console.warn('[Game] JesusSummonTriggerSystem class not available');
            }
        } else {
            window.jesusSummonSystem = null;
            console.warn('[Game] JesusSummonSystem class not available');
        }

        // Background-load a larger chunk cache so camera movement is stutter-free.
        // This runs async — the game is already interactive from the initial batch.
        this.terrainSystem.warmChunkCache(0, 0, Math.ceil(caps.gridSize / 2));

        // Tree population is deferred until after init() completes so that
        // boardSystem.getTerrainHeight() and the terrain mesh are fully ready.
        console.log('[Game] Hybrid tree manager available:', !!this.hybridTreeManager);

        // Initialize memory profiler (updates only when dev tools are open)
        this.memoryProfiler = new MemoryProfiler(this);
        window.memoryProfiler = this.memoryProfiler;
        console.log('[Game] MemoryProfiler initialized (press M to toggle)');

        if (window.parameterSystem) {
            const taaActive = !!(this.temporalAA && this.temporalAA.isActive());
            window.parameterSystem.setParameter('taaEnabled', taaActive, 'init');
        }
    }

    setupTemporalAA() {
        if (typeof TemporalAASystem === 'undefined') {
            console.warn('[Game] TemporalAASystem script missing');
            return;
        }

        try {
            this.temporalAA = new TemporalAASystem({ renderer: this.renderer, camera: this.camera });
            const allow = this.deviceCapabilities?.features?.temporalAA;
            const autoEnable = !!(allow && this.deviceCapabilities?.defaultTaa);
            this.temporalAA.setEnabled(autoEnable);
            this._autoTaaPreference = autoEnable;
            console.log(`[Game] Temporal AA ${allow ? 'supported' : 'unsupported'} (auto=${autoEnable})`);
        } catch (err) {
            console.warn('[Game] Failed to initialize TemporalAASystem', err);
            this.temporalAA = null;
        }
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

        if (this.settlementSystem) {
            console.log('[Game] Notifying settlementSystem that network is ready');
            this.settlementSystem.attachNetworkHandlers();
        }
        
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
            // console.log('[Game] Time sync received:', data);
            if (this.boardSystem) {
                this.boardSystem.updateServerGameTime(data);
            }
        });

        this.networkManager.on('terrainModified', (data) => {
            if (!data || !Array.isArray(data.chunks) || !this.terrainSystem) {
                return;
            }
            const ts = this.terrainSystem;
            const chunkSize = ts.chunkSize || 32;
            let minX = Number.POSITIVE_INFINITY;
            let minZ = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let maxZ = Number.NEGATIVE_INFINITY;

            for (const chunk of data.chunks) {
                if (!chunk || !chunk.key) continue;
                ts.applyHeightDeltas(chunk.key, chunk.deltas || []);
                const [chunkX, chunkZ] = chunk.key.split(',').map(Number);
                if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) continue;
                if (!Array.isArray(chunk.deltas)) continue;
                const baseX = chunkX * chunkSize;
                const baseZ = chunkZ * chunkSize;
                for (const d of chunk.deltas) {
                    if (!d) continue;
                    const worldX = baseX + (d.localX ?? 0);
                    const worldZ = baseZ + (d.localZ ?? 0);
                    if (worldX < minX) minX = worldX;
                    if (worldZ < minZ) minZ = worldZ;
                    if (worldX > maxX) maxX = worldX;
                    if (worldZ > maxZ) maxZ = worldZ;
                }
            }

            if (this.boardSystem && isFinite(minX) && isFinite(minZ) && isFinite(maxX) && isFinite(maxZ)) {
                const padding = 1;
                this.boardSystem.refreshTerrainRegion(minX - padding, minZ - padding, maxX + padding, maxZ + padding);
            }
        });

        this.networkManager.on('envFields', (data) => {
            if (data.error) return;
            this._lastEnvFields = data;
            if (this.textureBlendingSystem) {
                this.textureBlendingSystem.setEnvironmentalFields(
                    data.pressure ?? 0.5,
                    data.humidity ?? 0.5,
                    data.temperature ?? 0.5
                );
            }
        });

        this.networkManager.on('envAgents', (data) => {
            // console.log('[Game] Received envAgents:', data?.length, 'agents');
            this._lastEnvAgents = data;
            if (this.minimapOverlay) {
                this.minimapOverlay.setEnvAgents(data);
            }
        });

        // Periodic request for environmental fields in visible region
        setInterval(() => {
            if (!this.networkManager) return;
            const cx = Math.floor(this.camera?.position?.x || 0);
            const cz = Math.floor(this.camera?.position?.z || 0);
            this.networkManager.emit('getEnvFields', {
                minX: cx - 40, maxX: cx + 40,
                minZ: cz - 40, maxZ: cz + 40
            });
        }, 3000);
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
        if (this.temporalAA) {
            lines.push(`TAA: ${this.temporalAA.isActive() ? 'ON' : 'OFF'}`);
        }
        lines.push(`Chunks cached: ${this.terrainSystem?.chunks?.size || 0}`);

        // Network status
        const netStatus = this.networkManager?.connected ? 'CONNECTED' : (this.networkManager ? 'DISCONNECTED' : 'NO NM');
        lines.push(`Network: ${netStatus}`);

        // Environmental simulation readout
        const env = this._lastEnvFields;
        if (env) {
            lines.push(`EnvSim  P:${env.pressure?.toFixed(2)} H:${env.humidity?.toFixed(2)} T:${env.temperature?.toFixed(2)}`);
        } else {
            lines.push(`EnvSim: waiting...`);
        }

        // Add performance manager status
        if (this.performanceManager) {
            const status = this.performanceManager.getStatus();
            lines.push(`FPS: ${status.fps} (target: ${status.targetFps})`);
            lines.push(`Quality: ${status.qualityLevel}/4 (keys 0-4)`);
            lines.push(`VertexBudget: ${status.vertexBudget/1000}K`);
        }
        
        const el = document.getElementById('optStatus');
        if (el) el.textContent = lines.join('\n');
        // console.log('[Status] ' + lines.join(' | '));
    }

    startGameLoop() {
        let lastTime = 0;
        let lastOptReport = 0;
        let frameCount = 0;

        const animate = (currentTime) => {
            this._animFrameId = requestAnimationFrame(animate);
            frameCount++;
            const frameStart = performance.now();

            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            lastTime = currentTime;

            if (this.performanceManager) {
                this.performanceManager.update(deltaTime);
            }

            if (this.lodManager && this.camera) {
                this.lodManager.update(this.camera, deltaTime);
            }

            if (this.memoryProfiler) {
                this.memoryProfiler.update(currentTime);
            }

            if (currentTime - lastOptReport > 3000) {
                this.reportOptimizationStatus();
                lastOptReport = currentTime;
            }

            // console.log('[Game DEBUG] Game loop running, deltaTime:', deltaTime);

            this.cameraController.update();

            if (typeof window !== 'undefined') {
                if (!window.__terrainDebug) window.__terrainDebug = {};
                window.__terrainDebug.cameraPosition = this.camera.position.clone();
                window.__terrainDebug.cameraTarget = this.cameraController.getTarget().clone();
            }

            if (this.visualFeedback) {
                this.visualFeedback.update();
            }

            if (this.decorativeVisuals) {
                this.decorativeVisuals.updateCameraPosition(this.camera.position);
                this.decorativeVisuals.update(deltaTime);
                if (this.boardSystem && this.boardSystem.setWindParameters) {
                    const windSpeed = this.decorativeVisuals.windSpeed || 1.0;
                    const windDirection = Math.atan2(this.decorativeVisuals.windDirection.y, this.decorativeVisuals.windDirection.x);
                    this.boardSystem.setWindParameters(windSpeed, windDirection);
                }
            }

            if (this.hybridTreeManager && this.decorativeVisuals) {
                // Throttle tree animation updates to every 2nd frame (30fps is enough for wind)
                this._treeUpdateFrame = (this._treeUpdateFrame || 0) + 1;
                if (this._treeUpdateFrame % 2 === 0) {
                    const t = currentTime * 0.001;
                    const ps = window.parameterSystem;
                    const globalWs = ps ? ps.getParameter('windSpeed') : (this.decorativeVisuals.windSpeed || 0.6);
                    const sens = ps ? ps.getParameter('treeWindSensitivity') : 1.0;
                    const ws = globalWs * sens;
                    const wd = this.decorativeVisuals.windDirection || { x: 1, y: 0 };
                    this.hybridTreeManager.update(t, ws, wd);
                }
            }

            if (this.jesusSummonSystem) {
                this.jesusSummonSystem.update(deltaTime);
            }

            if (this.settlementSystem) {
                this.settlementSystem.update(deltaTime, this.camera.position);
                if (this.settlementSystem.knightSystem) {
                    this.settlementSystem.knightSystem.update(deltaTime);
                }
                if (this.settlementSystem.tournamentSystem) {
                    this.settlementSystem.tournamentSystem.update(deltaTime);
                }
            }

            if (this.pondWeedSystem && this.boardSystem) {
                this.pondWeedSystem.update(currentTime * 0.001, this.boardSystem.grassTexture);
            }

            this.terrainSystem.updateStreaming(this.camera.position);
            this.terrainSystem.requestProbeAhead(this.camera.position);

            this.boardSystem.updateStreaming(this.camera.position, this.camera);

            // Update terrain tree foliage based on season (handled internally by tree systems)

            this.updateShadowQuality(deltaTime * 1000);

            if (this.minimapOverlay) {
                this.minimapOverlay.update(currentTime);
            }

            if (frameCount % 120 === 0) {
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
                const otherObjects = new Map();

                this.scene.traverse((object) => {
                    if (object.isMesh && object.geometry) {
                        const positionAttribute = object.geometry.getAttribute('position');
                        if (positionAttribute) {
                            const count = positionAttribute.count;
                            totalVertices += count;
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

                const vEl = document.getElementById('vertexCount');
                const tEl = document.getElementById('triangleCount');
                if (vEl) vEl.textContent = `${(totalVertices / 1000).toFixed(1)}K`;
                if (tEl) tEl.textContent = `${(totalTriangles / 1000).toFixed(1)}K`;
            }

            if (this.raycastDotEnabled && this.raycastDot) {
                // Throttle expensive full-scene raycast to every 3rd frame (~20fps)
                this._raycastFrame = (this._raycastFrame || 0) + 1;
                if (this._raycastFrame % 3 === 0) {
                    this._raycaster.setFromCamera(this._mouseNDC, this.camera);
                    const intersects = this._raycaster.intersectObjects(this.scene.children, true);
                    const hit = intersects.find(i => i.object !== this.raycastDot);
                    if (hit) {
                        this.raycastDot.position.copy(hit.point);
                        this.raycastDot.visible = true;
                        const distEl = document.getElementById('cameraRayDist');
                        const objEl = document.getElementById('cameraRayObj');
                        if (distEl) distEl.textContent = hit.distance.toFixed(1);
                        if (objEl) objEl.textContent = hit.object.name || hit.object.type || '?';
                    } else {
                        this.raycastDot.visible = false;
                        const distEl = document.getElementById('cameraRayDist');
                        const objEl = document.getElementById('cameraRayObj');
                        if (distEl) distEl.textContent = '-';
                        if (objEl) objEl.textContent = '-';
                    }
                }
            } else if (this.raycastDot) {
                this.raycastDot.visible = false;
            }

            if (this.temporalAA) {
                this.temporalAA.render(this.scene, this.camera);
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            if (this.resourceGuard) {
                this.resourceGuard.update(currentTime);
            }

            const frameTime = performance.now() - frameStart;
            if (frameTime > 50) {
                console.log(`[SLOW FRAME] ${frameTime.toFixed(1)}ms`);
            }
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

        // Store for raycast dot
        this._mouseNDC.copy(mouse);

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

        // Update mouse spotlight position
        this.updateMouseSpotlight();
    }
    
    onKeyDown(event) {
        if (!this.isInitialized) return;
        if (!event.key) return;

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
            case 't':
                if (this.settlementSystem && this.tomeUI) {
                    const settlement = this.settlementSystem.getSettlementAt(
                        this.camera.position.x,
                        this.camera.position.z,
                        30
                    );
                    if (settlement) {
                        this.tomeUI.toggle(settlement);
                    }
                }
                break;
        }
        
        // Pass to camera controller for movement
        this.cameraController.handleKeyDown(event);
    }
    
    onKeyUp(event) {
        if (!this.isInitialized) return;
        if (!event.key) return;
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
        this.validMoves = this.movementBridge ? this.movementBridge.getValidMovesForPiece(piece) : [];
        
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
                        this.validMoves = this.movementBridge ? this.movementBridge.getValidMovesForPiece(movedPiece) : [];
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
        console.log('Player joined:', data.name, 'userId:', data.userId, 'role:', data.role);
        
        // Set current player if this is the local player (match by userId if available)
        const user = window.authState ? window.authState.getUser() : null;
        if (user && data.userId === user.id) {
            this.gameState.setCurrentPlayerId(data.id);
            console.log('[Game] Set current player ID to:', data.id);
            
            // Update player info display
            const playerNameEl = document.getElementById('playerName');
            if (playerNameEl) {
                playerNameEl.textContent = data.name + (data.role === 'dev' ? ' [DEV]' : '');
            }
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
        if (this.tomeUI) {
            this.tomeUI.close();
        }
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
        if (this.temporalAA) {
            this.temporalAA.handleResize();
        }
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
