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
        this.fogPlaneSystem = null;
        this.lodManager = null;
        this.temporalAA = null;
        this.minimapOverlay = null;
        this.settlementSystem = null;
        this.weatherDirector = null;
        this.voxelCloudSystem = null;

        this.loadDiagnostics = {
            startedAt: this._diagNow(),
            startedAtWallClock: new Date().toISOString(),
            completedAt: null,
            completedAtWallClock: null,
            durationMs: null,
            progress: 0,
            phases: []
        };
        if (typeof window !== 'undefined') {
            window.__clientLoadDiagnostics = this.loadDiagnostics;
        }

        this.selectedPiece = null; // kept for backward compat; see get selectedPiece()
        this.validMoves = [];
        this.hoveredTile = null;

        this.multiPieceSelector = null;
        this.formationPathfinding = null;
        this.moveReservation = null;
        this.groupMoveExecutor = null;

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
            this._markLoadPhase('init.start');
            this.showLoadingProgress(10);
            console.time('[Perf] detectDeviceCapabilities');
            this.detectDeviceCapabilities();
            console.timeEnd('[Perf] detectDeviceCapabilities');
            this.showLoadingProgress(25);
            console.log('[Game] Setting up renderer...');
            console.time('[Perf] setupRenderer');
            await this.setupRenderer(this.deviceCapabilities);
            console.timeEnd('[Perf] setupRenderer');
            this._markLoadPhase('setupRenderer.complete');
            this.showLoadingProgress(30);
            console.time('[Perf] refineDeviceCapabilities');
            this.refineDeviceCapabilities();
            console.timeEnd('[Perf] refineDeviceCapabilities');

            console.log('[Game] Setting up scene...');
            console.time('[Perf] setupScene');
            await this.setupScene();
            console.timeEnd('[Perf] setupScene');
            this._markLoadPhase('setupScene.complete');
            console.log('[Game] Scene setup completed!');
            if (window.CrashDump) window.CrashDump.registerGame(this);
            this.setupTemporalAA();
            console.log('[Game] About to call showLoadingProgress(50)');
            this.showLoadingProgress(50);
            console.log('[Game] Called showLoadingProgress(50)');

            console.log('[Game] Setting up systems...');
            console.time('[Perf] setupSystems');
            try {
                await this.setupSystems();
                console.timeEnd('[Perf] setupSystems');
                this._markLoadPhase('setupSystems.complete');
                this.showLoadingProgress(70);
            } catch (error) {
                console.timeEnd('[Perf] setupSystems');
                console.error('[Game] Error in setupSystems:', error);
                throw error;
            }

            console.log('[Game] Setting up event listeners...');
            console.time('[Perf] setupEventListeners');
            await this.setupEventListeners();
            console.timeEnd('[Perf] setupEventListeners');
            this._markLoadPhase('setupEventListeners.complete');
            this.showLoadingProgress(80);

            console.log('[Game] Setting up network...');
            console.time('[Perf] setupNetwork');
            await this.setupNetwork();
            console.timeEnd('[Perf] setupNetwork');
            this._markLoadPhase('setupNetwork.complete');
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
            this._markLoadPhase('gameLoop.started');
            this.showLoadingProgress(100);
            
            setTimeout(() => {
                this.hideLoadingScreen();
                this.isInitialized = true;
                this._completeLoadDiagnostics('initial-ui-ready');
                
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

                // Periodic re-detection of device capabilities (every 60s)
                this._capRedetectInterval = setInterval(() => {
                    if (this._contextLost) return;
                    console.log('[Game] Periodic device capability re-detection...');
                    this.refineDeviceCapabilities();
                }, 60000);

                // Populate trees now that board system is ready
                if (this.hybridTreeManager) {
                    window.treeSystem = this.hybridTreeManager;
                    window.repopulateTrees = () => {
                        this.hybridTreeManager.populateFromServer();
                    };
                    this.hybridTreeManager.populateFromServer();
                }
            }, 500);
            
        } catch (error) {
            console.error('[Game] Failed to initialize game:', error);
            console.error('[Game] Error stack:', error.stack);
            this.showError('Failed to load game. Please refresh the page.');
        }
    }
    
    async setupRenderer(caps = null) {
        const antialias = caps ? caps.antialias : true;
        const powerPreference = caps && caps.tier === 'low' ? 'low-power' : 'high-performance';
        // Initialize Three.js renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('gameCanvas'),
            antialias: antialias,
            alpha: true,
            powerPreference: powerPreference
        });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        const pixelRatioCap = caps ? caps.pixelRatioCap : 2;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
        this.renderer.shadowMap.enabled = !(caps && caps.tier === 'low');
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
            if (window.CrashDump) {
                window.CrashDump.trigger({ source: 'webgl', message: 'WebGL context lost' });
            }
            // Emergency quality downgrade to prevent repeated context loss
            if (this.performanceManager) {
                console.log('[Game] Emergency quality downgrade to level 0');
                this.performanceManager.forceQualityLevel(0);
            }
        });
        canvas.addEventListener('webglcontextrestored', () => {
            console.log('[Game] WebGL context restored - resuming');
            this._contextLost = false;
            // Re-apply capped tier level after restoration
            if (this.performanceManager && this.deviceCapabilities) {
                const tier = this.deviceCapabilities.tier || 'medium';
                const startLevel = { low: 0, medium: 2, high: 4 }[tier] ?? 2;
                this.performanceManager.forceQualityLevel(startLevel);
            }
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
            useGLBModels: true,
            details: {},
            features: {
                temporalAA: false
            }
        };

        // URL override for desktop testing
        try {
            const urlTier = new URLSearchParams(location.search).get('tier');
            if (urlTier === 'low' || urlTier === 'medium' || urlTier === 'high') {
                caps.tier = urlTier;
                if (urlTier === 'low') {
                    caps.gridSize = 96;
                    caps.meshMultiplier = 18;
                    caps.renderDistance = 30;
                    caps.terrainLoadRadius = 15;
                    caps.antialias = false;
                    caps.pixelRatioCap = 1;
                    caps.useGLBModels = false;
                    caps.defaultTaa = false;
                    caps.features.temporalAA = false;
                } else if (urlTier === 'medium') {
                    caps.gridSize = 128;
                    caps.meshMultiplier = 24;
                    caps.renderDistance = 40;
                    caps.terrainLoadRadius = 20;
                    caps.pixelRatioCap = 1.5;
                    caps.useGLBModels = false;
                    caps.defaultTaa = false;
                } else {
                    caps.gridSize = 192;
                    caps.meshMultiplier = 36;
                    caps.renderDistance = 60;
                    caps.terrainLoadRadius = 30;
                    caps.pixelRatioCap = 2;
                    caps.useGLBModels = true;
                    caps.defaultTaa = true;
                }
                this.deviceCapabilities = caps;
                console.log(`[Game] Device tier overridden via URL: ${caps.tier}`);
                return caps;
            }
        } catch (e) {
            // URL parsing failed, continue with auto-detection
        }

        // Lightweight detection (no GL context needed)
        const isMobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        caps.details.hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
        caps.details.deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
        caps.details.pixelRatio = window.devicePixelRatio || 1;
        caps.details.screenWidth = window.screen.width;
        caps.details.screenHeight = window.screen.height;

        let score = 0;

        if (caps.details.hardwareConcurrency >= 8) score += 2;
        else if (caps.details.hardwareConcurrency >= 4) score += 1;
        else if (caps.details.hardwareConcurrency <= 2) score -= 1;

        if (caps.details.deviceMemory >= 8) score += 2;
        else if (caps.details.deviceMemory >= 4) score += 1;
        else if (caps.details.deviceMemory < 4) score -= 1;

        if (isMobileUA) score -= 1;

        // Preliminary tier (refined after renderer creation with GPU info)
        if (score >= 4) {
            caps.tier = 'high';
            caps.gridSize = 192;
            caps.meshMultiplier = 36;
            caps.renderDistance = 60;
            caps.terrainLoadRadius = 30;
            caps.pixelRatioCap = 2;
            caps.useGLBModels = true;
            caps.defaultTaa = true;
        } else if (score >= 1) {
            caps.tier = 'medium';
            caps.gridSize = 128;
            caps.meshMultiplier = 24;
            caps.renderDistance = 40;
            caps.terrainLoadRadius = 20;
            caps.pixelRatioCap = 1.5;
            caps.useGLBModels = false;
            caps.defaultTaa = false;
        } else {
            caps.tier = 'low';
            caps.gridSize = 96;
            caps.meshMultiplier = 18;
            caps.renderDistance = 30;
            caps.terrainLoadRadius = 15;
            caps.antialias = false;
            caps.pixelRatioCap = 1;
            caps.useGLBModels = false;
            caps.defaultTaa = false;
            caps.features.temporalAA = false;
        }

        this.deviceCapabilities = caps;
        console.log(`[Game] Device tier (preliminary): ${caps.tier}`, caps.details);
        return caps;
    }

    refineDeviceCapabilities() {
        const caps = this.deviceCapabilities;
        if (!caps) return;

        try {
            const gl = this.renderer.getContext();
            const webglCaps = this.renderer.capabilities;

            const supportsWebGL2 = !!webglCaps.isWebGL2;

            caps.details.maxTextureSize = webglCaps.maxTextureSize;
            caps.details.maxVertexTextures = webglCaps.maxVertexTextures;
            caps.details.maxTextureImageUnits = webglCaps.maxTextureImageUnits;
            caps.details.webglRenderer = gl.getParameter(gl.RENDERER);
            caps.details.webglVendor = gl.getParameter(gl.VENDOR);

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

            const isMobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            if (isMobileUA) score -= 1;

            caps.features.temporalAA = supportsWebGL2 && score >= 2;

            let newTier = 'medium';
            if (score >= 5) {
                newTier = 'high';
            } else if (score >= 2) {
                newTier = 'medium';
            } else {
                newTier = 'low';
            }

            const tierOrder = { low: 0, medium: 1, high: 2 };
            if (tierOrder[newTier] !== tierOrder[caps.tier]) {
                console.log(`[Game] Device tier refined: ${caps.tier} -> ${newTier} (score: ${score})`);
                caps.tier = newTier;
                if (newTier === 'high') {
                    caps.gridSize = 192;
                    caps.meshMultiplier = 36;
                    caps.renderDistance = 60;
                    caps.terrainLoadRadius = 30;
                    caps.pixelRatioCap = 2;
                    caps.useGLBModels = true;
                    caps.defaultTaa = true;
                } else if (newTier === 'medium') {
                    caps.gridSize = 128;
                    caps.meshMultiplier = 24;
                    caps.renderDistance = 40;
                    caps.terrainLoadRadius = 20;
                    caps.pixelRatioCap = 1.5;
                    caps.useGLBModels = false;
                    caps.defaultTaa = false;
                } else {
                    caps.gridSize = 96;
                    caps.meshMultiplier = 18;
                    caps.renderDistance = 30;
                    caps.terrainLoadRadius = 15;
                    caps.antialias = false;
                    caps.pixelRatioCap = 1;
                    caps.useGLBModels = false;
                    caps.defaultTaa = false;
                    caps.features.temporalAA = false;
                }
                // Re-apply pixel ratio if renderer exists
                if (this.renderer) {
                    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, caps.pixelRatioCap));
                }
            } else {
                console.log(`[Game] Device tier confirmed: ${caps.tier} (score: ${score})`);
            }
        } catch (e) {
            console.warn('[Game] GPU refinement failed, keeping preliminary tier:', e);
        }
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
        console.time('[Perf] ClientGameState');
        this.gameState = new ClientGameState();
        console.timeEnd('[Perf] ClientGameState');

        console.time('[Perf] PerformanceManager');

        // Initialize performance manager first (needed by LODManager)
        this.performanceManager = new PerformanceManager(this);
        console.timeEnd('[Perf] PerformanceManager');

        console.time('[Perf] ResourceGuard');
        // Initialize ResourceGuard for leak detection & crash prevention
        this.resourceGuard = new ResourceGuard(this);
        console.timeEnd('[Perf] ResourceGuard');
        console.log('[Game] ResourceGuard initialized');

        console.time('[Perf] LODManager');
        // Initialize LOD manager for adaptive level-of-detail (needed by HybridTreeManager)
        if (typeof LODManager !== 'undefined') {
            this.lodManager = new LODManager({ performanceManager: this.performanceManager });
            console.log('[Game] LODManager created');
        } else {
            console.warn('[Game] LODManager not available - skipping adaptive LOD');
            this.lodManager = null;
        }
        console.timeEnd('[Perf] LODManager');

        console.time('[Perf] HybridTreeManager');
        // Create hybrid tree manager with patch-based alternation between TerrainTreeSystem and LocalTreeSystem
        this.oldTreeSystem = null; // Disable old tree system
        this.hybridTreeManager = new HybridTreeManager(this.scene, null, this.lodManager);
        this.hybridTreeManager.treeTypeOverride = 'billboard';
        console.timeEnd('[Perf] HybridTreeManager');
        console.log('[Game] Hybrid tree manager created - billboard trees enabled');

        // Disable baked shadow system for now (debug version never enabled)
        this.shadowSystem = null;

        console.time('[Perf] TerrainSystem+BoardSystem');
        this.terrainSystem = new TerrainSystem(this.scene, null);
        this.boardSystem = new CleanBoardSystem(this.scene, this.terrainSystem, null, this, this.renderer);
        this.textureBlendingSystem = this.boardSystem.textureBlendingSystem;
        console.timeEnd('[Perf] TerrainSystem+BoardSystem');

        // Backfill the terrain reference now that it exists
        if (this.hybridTreeManager) {
            this.hybridTreeManager.terrainSystem = this.terrainSystem;
        }
        
        // Expose board system to global scope immediately after creation
        window.boardSystem = this.boardSystem;
        console.log('[Game] Board system exposed to window.boardSystem');

        // Water depth fade handled by boardSystem.updateWaterDepthFade()
        this.piecesSystem = new Pieces3D(this.scene, this.terrainSystem, this.deviceCapabilities);

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
        console.time('[Perf] Camera+Movement');
        this.cameraController = new CameraController(this.camera, this.scene);
        if (typeof MovementBridge !== 'undefined') {
            this.movementBridge = new MovementBridge(this.gameState, this.boardSystem);
        } else {
            console.warn('[Game] MovementBridge not available');
        }
        console.timeEnd('[Perf] Camera+Movement');

        console.time('[Perf] MultiPieceSystems');
        // Initialize multi-piece selection and formation movement systems
        if (typeof MultiPieceSelector !== 'undefined') {
            this.multiPieceSelector = new MultiPieceSelector(this);
            console.log('[Game] MultiPieceSelector initialized');
        } else {
            console.warn('[Game] MultiPieceSelector not available');
        }
        if (typeof FormationPathfinding !== 'undefined' && this.movementBridge) {
            this.formationPathfinding = new FormationPathfinding(this.movementBridge, this.gameState);
            console.log('[Game] FormationPathfinding initialized');
        } else {
            console.warn('[Game] FormationPathfinding not available');
        }
        if (typeof MoveReservation !== 'undefined') {
            this.moveReservation = new MoveReservation(this.gameState);
            console.log('[Game] MoveReservation initialized');
        } else {
            console.warn('[Game] MoveReservation not available');
        }
        if (typeof GroupMoveExecutor !== 'undefined' && this.formationPathfinding && this.moveReservation) {
            this.groupMoveExecutor = new GroupMoveExecutor(this, this.formationPathfinding, this.moveReservation);
            console.log('[Game] GroupMoveExecutor initialized');
        } else {
            console.warn('[Game] GroupMoveExecutor not available');
        }
        console.timeEnd('[Perf] MultiPieceSystems');

        console.time('[Perf] Visuals');
        this.visualFeedback = new VisualFeedbackSystem(this.scene);
        console.log('[Game] Creating SimpleCelShaderSystem...');
        this.celShaderSystem = new SimpleCelShaderSystem();
        console.log('[Game] SimpleCelShaderSystem created:', !!this.celShaderSystem);

        // Initialize decorative visuals system
        console.log('[Game] Creating DecorativeVisualsSystem...');
        this.decorativeVisuals = new DecorativeVisualsSystem(this.scene, this.terrainSystem, this);
        console.timeEnd('[Perf] Visuals');
        console.log('[Game] DecorativeVisualsSystem created:', !!this.decorativeVisuals);

        console.time('[Perf] SettlementSystem');
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

            if (this.lodManager) {
                this.settlementSystem.connectLODManager(this.lodManager);
            }

            if (typeof TomeUI !== 'undefined') {
                this.tomeUI = new TomeUI(this.settlementSystem);
                this.tomeUI.init();
            }

            console.log('[Game] SettlementSystem initialized');
            window.settlementSystem = this.settlementSystem;
        } else {
            console.warn('[Game] SettlementSystem not available');
        }
        console.timeEnd('[Perf] SettlementSystem');

        console.time('[Perf] MinimapOverlay');
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
        console.timeEnd('[Perf] MinimapOverlay');

        // Ensure parameter defaults are applied now that all systems (including TextureBlendingSystem from board_clean.js) exist
        if (window.parameterSystem) {
            window.parameterSystem._installAll();
        }

        console.time('[Perf] FogPlaneSystem');
        // Initialize fog plane system
        if (typeof FogPlaneSystem !== 'undefined') {
            try {
                this.fogPlaneSystem = new FogPlaneSystem(this.scene);
                this.fogPlaneSystem.init();
                console.log('[Game] FogPlaneSystem initialized');
            } catch (error) {
                console.error('[Game] Failed to create FogPlaneSystem:', error);
                this.fogPlaneSystem = null;
            }
        } else {
            console.log('[Game] FogPlaneSystem class not available');
            this.fogPlaneSystem = null;
        }
        console.timeEnd('[Perf] FogPlaneSystem');

        console.time('[Perf] WeatherDirector');
        // Initialize weather director (client-side weather authority)
        if (typeof WeatherDirector !== 'undefined') {
            this.weatherDirector = new WeatherDirector(this);
            console.log('[Game] WeatherDirector initialized');
        } else {
            console.warn('[Game] WeatherDirector class not available');
        }
        console.timeEnd('[Perf] WeatherDirector');

        console.time('[Perf] VoxelCloudSystem');
        // Initialize voxel cloud system (instanced billboard clouds)
        if (typeof VoxelCloudSystem !== 'undefined') {
            try {
                this.voxelCloudSystem = new VoxelCloudSystem(this.scene, this.terrainSystem, this);
                console.log('[Game] VoxelCloudSystem initialized');
            } catch (error) {
                console.error('[Game] Failed to create VoxelCloudSystem:', error);
                this.voxelCloudSystem = null;
            }
        } else {
            console.log('[Game] VoxelCloudSystem class not available');
            this.voxelCloudSystem = null;
        }
        console.timeEnd('[Perf] VoxelCloudSystem');
        
        console.time('[Perf] generateInitialTerrain');
        // Generate initial terrain sized to device capability tier
        const caps = this.deviceCapabilities;
        // Load only the center chunks needed for the initial view.
        // The full grid is loaded progressively in warmChunkCache below.
        const initialLoadRadius = this.terrainSystem.chunkSize * 1.5; // 24 units = ~25 chunks
        await this.terrainSystem.generateInitialTerrain(0, 0, initialLoadRadius);
        console.timeEnd('[Perf] generateInitialTerrain');

        // Apply detected capability tier to board & streaming
        this.boardSystem.useViewportMesh = true;
        this.boardSystem.renderDistance = caps.renderDistance;
        console.log(`[Game] Device tier: ${caps.tier}, gridSize: ${caps.gridSize}, meshMultiplier: ${caps.meshMultiplier}, renderDistance: ${caps.renderDistance}`);
        console.time('[Perf] createBoard');
        await this.boardSystem.createBoard(0, 0, 3, caps.meshMultiplier, caps.gridSize);
        console.timeEnd('[Perf] createBoard');

        // Start at tier-capped quality after terrain init
        if (this.performanceManager) {
            const tier = this.deviceCapabilities?.tier || 'medium';
            const startLevel = { low: 0, medium: 2, high: 4 }[tier] ?? 2;
            this.performanceManager.setTierCap(tier);
            this.performanceManager.forceQualityLevel(startLevel);
            console.log(`[Game] PerformanceManager started at level ${startLevel} (tier: ${tier})`);
        }

        console.time('[Perf] JesusSummonSystem');
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
        console.timeEnd('[Perf] JesusSummonSystem');

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
        this.renderer.domElement.addEventListener('mousedown', (event) => this.onMouseDown(event));
        this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
        this.renderer.domElement.addEventListener('mouseup', (event) => this.onMouseUp(event));
        this.renderer.domElement.addEventListener('click', (event) => this.onMouseClick(event));

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
            if (this.fogPlaneSystem && data.timeOfDay !== undefined) {
                this.fogPlaneSystem.setDayTime(data.timeOfDay);
            }
        });

        this.networkManager.on('treeChancesChanged', (data) => {
            const ps = window.parameterSystem;
            if (ps && data.chances) {
                for (const [biome, v] of Object.entries(data.chances)) {
                    const biomeIdx = ['deep_water','shallow_water','beach','lowland','grassland','forest','mountain','snow'].indexOf(biome);
                    if (biomeIdx >= 0) ps.setParameter(`biomeTreeChance${biomeIdx}`, v, 'server');
                }
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

        // Weather director readout
        const wd = this.weatherDirector;
        if (wd) {
            const s = wd.getSnapshot();
            lines.push(`Weather: ${s.weatherState} | P:${s.pressure.toFixed(2)} H:${s.humidity.toFixed(2)} T:${s.temperature.toFixed(2)}`);
            lines.push(`Wind: ${s.windSpeed.toFixed(2)} | Cloud:${s.cloudCoverage.toFixed(2)} Fog:${s.fogDensity.toFixed(2)} Rain:${s.rainIntensity.toFixed(2)}`);
        } else {
            lines.push(`Weather: waiting...`);
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

    getClientDiagnostics() {
        const now = this._diagNow();
        const load = this.loadDiagnostics ? {
            startedAt: this.loadDiagnostics.startedAt,
            startedAtWallClock: this.loadDiagnostics.startedAtWallClock,
            completedAt: this.loadDiagnostics.completedAt,
            completedAtWallClock: this.loadDiagnostics.completedAtWallClock,
            durationMs: this.loadDiagnostics.durationMs ?? (now - this.loadDiagnostics.startedAt),
            progress: this.loadDiagnostics.progress,
            phases: Array.isArray(this.loadDiagnostics.phases) ? this.loadDiagnostics.phases.slice(-20) : []
        } : null;

        const terrain = this.terrainSystem ? {
            chunkSize: this.terrainSystem.chunkSize,
            loadDistance: this.terrainSystem.loadDistance,
            chunksLoaded: this.terrainSystem.chunks?.size ?? 0,
            worldDownloaded: !!this.terrainSystem.worldDownloaded,
            loadingChunks: this.terrainSystem.loadingChunks?.size ?? 0,
            lastCameraChunk: this.terrainSystem.lastCameraChunk ? {
                x: this.terrainSystem.lastCameraChunk.x,
                z: this.terrainSystem.lastCameraChunk.z
            } : null,
            clientId: this.terrainSystem.clientId ?? null,
            probeThrottleMs: this.terrainSystem._probeThrottleMs ?? null,
            lastProbeRequest: this.terrainSystem._lastProbeRequest ?? null,
            pendingChunkDeltas: this.terrainSystem._pendingChunkDeltas?.size ?? 0
        } : null;

        const board = this.boardSystem ? {
            meshMode: this.boardSystem.useViewportMesh ? 'viewport' : (this.boardSystem.continuousMesh ? 'continuous' : 'chunk'),
            useViewportMesh: !!this.boardSystem.useViewportMesh,
            continuousMesh: !!this.boardSystem.continuousMesh,
            renderDistance: this.boardSystem.renderDistance ?? null,
            meshMultiplier: this.boardSystem.meshMultiplier ?? null,
            meshBounds: this.boardSystem.meshBounds ? {
                centerX: this.boardSystem.meshBounds.centerX,
                centerZ: this.boardSystem.meshBounds.centerZ,
                size: this.boardSystem.meshBounds.size
            } : null,
            chunksLoaded: this.boardSystem.chunks?.size ?? 0,
            rollingTerrain: !!this.boardSystem.rollingTerrain,
            optimization: this.boardSystem.optimization ? {
                streaming: this.boardSystem.optimization.streaming ? {
                    enabled: this.boardSystem.optimization.streaming.enabled,
                    preloadDistance: this.boardSystem.optimization.streaming.preloadDistance,
                    unloadDelay: this.boardSystem.optimization.streaming.unloadDelay,
                    maxChunksPerFrame: this.boardSystem.optimization.streaming.maxChunksPerFrame,
                    predictionEnabled: this.boardSystem.optimization.streaming.predictionEnabled,
                    predictionDistance: this.boardSystem.optimization.streaming.predictionDistance
                } : null,
                stats: this.boardSystem.optimization.stats ? {
                    totalChunks: this.boardSystem.optimization.stats.totalChunks,
                    renderedChunks: this.boardSystem.optimization.stats.renderedChunks,
                    culledChunks: this.boardSystem.optimization.stats.culledChunks,
                    vertexCount: this.boardSystem.optimization.stats.vertexCount,
                    baseVertexCount: this.boardSystem.optimization.stats.baseVertexCount,
                    reductionRatio: this.boardSystem.optimization.stats.reductionRatio,
                    frameTime: this.boardSystem.optimization.stats.frameTime,
                    lodTransitions: this.boardSystem.optimization.stats.lodTransitions
                } : null
            } : null
        } : null;

        const weather = this.weatherDirector && typeof this.weatherDirector.getSnapshot === 'function'
            ? this.weatherDirector.getSnapshot()
            : null;

        const clouds = this.voxelCloudSystem
            ? { enabled: true, lodCount: this.voxelCloudSystem._lodMeshes?.length ?? 0 }
            : null;

        const performanceStatus = this.performanceManager && typeof this.performanceManager.getStatus === 'function'
            ? this.performanceManager.getStatus()
            : null;

        return {
            capturedAt: new Date().toISOString(),
            runtime: {
                isLoading: this.isLoading,
                isInitialized: this.isInitialized,
                frameCount: typeof this._frameCount === 'number' ? this._frameCount : null,
                deviceTier: this.deviceCapabilities?.tier ?? null,
                pixelRatioCap: this.deviceCapabilities?.pixelRatioCap ?? null
            },
            load,
            renderer: this.renderer ? {
                pixelRatio: this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : null,
                shadowEnabled: this.renderer.shadowMap?.enabled ?? null,
                shadowType: this.renderer.shadowMap?.type ?? null,
                antialias: this.renderer.getContext ? !!this.renderer.getContext().getContextAttributes()?.antialias : null,
                toneMapping: this.renderer.toneMapping ?? null,
                toneMappingExposure: this.renderer.toneMappingExposure ?? null
            } : null,
            terrain,
            board,
            weather,
            clouds,
            performance: performanceStatus,
            systems: {
                fogPlane: !!this.fogPlaneSystem,
                textureBlending: !!this.textureBlendingSystem,
                grass: !!this.grassSystem,
                settlement: !!this.settlementSystem,
                minimap: !!this.minimapOverlay,
                temporalAA: this.temporalAA ? this.temporalAA.isActive() : null,
                decorativeVisuals: !!this.decorativeVisuals,
                soundManager: !!this.soundManager,
                voxelCloud: !!this.voxelCloudSystem
            }
        };
    }

    _diagNow() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
    }

    _markLoadPhase(name, details = {}) {
        if (!this.loadDiagnostics) return null;
        const timestamp = this._diagNow();
        const prev = this.loadDiagnostics.phases.length > 0 ? this.loadDiagnostics.phases[this.loadDiagnostics.phases.length - 1] : null;
        const entry = {
            name,
            timestamp,
            deltaMs: prev ? timestamp - prev.timestamp : timestamp - this.loadDiagnostics.startedAt,
            ...details
        };
        this.loadDiagnostics.phases.push(entry);
        if (this.loadDiagnostics.phases.length > 100) {
            this.loadDiagnostics.phases.shift();
        }
        if (typeof window !== 'undefined') {
            window.__clientLoadDiagnostics = this.loadDiagnostics;
        }
        return entry;
    }

    _completeLoadDiagnostics(reason = 'complete') {
        if (!this.loadDiagnostics || this.loadDiagnostics.completedAt) return this.loadDiagnostics;
        const completedAt = this._diagNow();
        this.loadDiagnostics.completedAt = completedAt;
        this.loadDiagnostics.completedAtWallClock = new Date().toISOString();
        this.loadDiagnostics.durationMs = completedAt - this.loadDiagnostics.startedAt;
        this._markLoadPhase(`load.${reason}`, { completed: true });
        if (typeof window !== 'undefined') {
            window.__clientLoadDiagnostics = this.loadDiagnostics;
        }
        return this.loadDiagnostics;
    }

    startGameLoop() {
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }
        let lastTime = 0;
        let lastOptReport = 0;
        let frameCount = 0;

        const animate = (currentTime) => {
            this._animFrameId = requestAnimationFrame(animate);
            frameCount++;
            this._frameCount = frameCount;
            const frameStart = performance.now();

            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            lastTime = currentTime;

            if (this.performanceManager) {
                this.performanceManager.update(deltaTime);
            }

            if (this.weatherDirector) {
                this.weatherDirector.update(deltaTime);
                const snap = this.weatherDirector.getSnapshot();
                if (this.fogPlaneSystem) {
                    this.fogPlaneSystem.setWeatherSnapshot(snap);
                }
                if (this.textureBlendingSystem) {
                    this.textureBlendingSystem.setWeatherSnapshot(snap);
                }
                if (this.boardSystem && this.boardSystem.rollingTerrain) {
                    this.boardSystem.rollingTerrain.setWeatherSnapshot(snap);
                }
                if (this.skyShaderSystem) {
                    this.skyShaderSystem.setWeatherSnapshot(snap);
                }
                if (this.voxelCloudSystem) {
                    this.voxelCloudSystem.setWeatherSnapshot(snap);
                }
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
                if (!window.__terrainDebug._camPos) window.__terrainDebug._camPos = new THREE.Vector3();
                if (!window.__terrainDebug._camTarget) window.__terrainDebug._camTarget = new THREE.Vector3();
                window.__terrainDebug._camPos.copy(this.camera.position);
                window.__terrainDebug._camTarget.copy(this.cameraController.getTarget());
                window.__terrainDebug.cameraPosition = window.__terrainDebug._camPos;
                window.__terrainDebug.cameraTarget = window.__terrainDebug._camTarget;
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

            if (this.hybridTreeManager && this.weatherDirector) {
                // Throttle tree animation updates to every 2nd frame (30fps is enough for wind)
                this._treeUpdateFrame = (this._treeUpdateFrame || 0) + 1;
                if (this._treeUpdateFrame % 2 === 0) {
                    const t = currentTime * 0.001;
                    const snap = this.weatherDirector.getSnapshot();
                    const ps = window.parameterSystem;
                    const sens = ps ? ps.getParameter('treeWindSensitivity') : 1.0;
                    const treeScale = ps ? ps.getParameter('weatherTreeWindScale') : 1.0;
                    const ws = snap.windSpeed * sens * treeScale;
                    const wd = { x: Math.cos(snap.windDirection), y: Math.sin(snap.windDirection) };
                    this.hybridTreeManager.update(t, ws, wd);
                }
            }

            if (this.jesusSummonSystem) {
                this.jesusSummonSystem.update(deltaTime);
            }

            // Settlement update throttled by performance tier
            const settlementInterval = this.performanceManager?.appliedSettings?.settlementUpdateInterval || 1;
            if (this.settlementSystem && frameCount % settlementInterval === 0) {
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

            // Update fog plane position and animation
            if (this.fogPlaneSystem) {
                this.fogPlaneSystem.update(this.camera, currentTime * 0.001);
            }

            // Update voxel clouds (grid recycling, LOD crossfade, wind drift)
            if (this.voxelCloudSystem) {
                this.voxelCloudSystem.update(this.camera, currentTime * 0.001, deltaTime);
            }

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
                const now = performance.now();
                if (!this._lastSlowFrameTime || now - this._lastSlowFrameTime > 5000) {
                    this._lastSlowFrameTime = now;
                    console.log(`[SLOW FRAME] ${frameTime.toFixed(1)}ms`);
                }
            }
        };

        animate(0);
    }
    
    onMouseDown(event) {
        if (!this.isInitialized) return;
        if (this.multiPieceSelector) {
            this.multiPieceSelector.onMouseDown(event);
        }
    }

    onMouseUp(event) {
        if (!this.isInitialized) return;
        if (this.multiPieceSelector) {
            this.multiPieceSelector.onMouseUp(event);
        }
    }

    onMouseClick(event) {
        if (!this.isInitialized) return;

        // If a drag just ended, consume this click event
        if (this.multiPieceSelector && this.multiPieceSelector.shouldConsumeClick()) {
            return;
        }

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
                console.log('[Game] Piece clicked:', piece, 'shift:', event.shiftKey);
                if (this.multiPieceSelector) {
                    this.multiPieceSelector.onPieceClick(piece, event.shiftKey);
                } else {
                    this.selectPiece(piece);
                }
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

                // With multi-piece selection active, any board click triggers formation move
                if (this.multiPieceSelector && this.multiPieceSelector.hasSelection()) {
                    this.handleTileClick(tilePos.x, tilePos.z);
                    return;
                }

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

        if (this.multiPieceSelector) {
            this.multiPieceSelector.onMouseMove(event);
        }

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

        const key = event.key.toLowerCase();

        // Multi-piece selection group hotkeys
        if (this.multiPieceSelector && /^[0-9]$/.test(key)) {
            const num = parseInt(key, 10);
            if (event.ctrlKey) {
                event.preventDefault();
                this.multiPieceSelector.saveGroup(num);
                return;
            } else if (!event.shiftKey && this.multiPieceSelector.selectionGroups.has(num)) {
                // Only load group if one exists; otherwise fall through to existing behavior
                event.preventDefault();
                this.multiPieceSelector.loadGroup(num);
                return;
            }
        }

        switch (key) {
            case 'x':
                this.toggleShop();
                break;
            case 'c':
                this.centerCameraOnKing();
                break;
            // Performance manager quality overrides (0-4, only if no group saved)
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
    
    /**
     * Backward-compatible single-piece selection.
     * Also clears multi-selection and shows valid moves for one piece.
     */
    selectPiece(piece) {
        console.log('[Game] selectPiece called with:', piece);

        // Ownership check: only allow selecting your own pieces
        const myPlayerId = this.gameState.getCurrentPlayerId();
        if (piece.playerId !== myPlayerId) {
            console.log('[Game] Cannot select enemy piece:', piece.id, 'owner:', piece.playerId, 'me:', myPlayerId);
            return;
        }

        // Update internal selectedPiece for backward compat
        this.selectedPiece = piece;
        this.validMoves = this.movementBridge ? this.movementBridge.getValidMovesForPiece(piece) : [];

        // Sync with multi-piece selector (clear other selections)
        if (this.multiPieceSelector) {
            this.multiPieceSelector.selectSinglePiece(piece);
        }

        // Show visual feedback
        this.visualFeedback.showSelectedPiece(piece);
        this.visualFeedback.showValidMoves(this.validMoves);
    }

    /**
     * Getter for backward compatibility.
     * Returns the first selected piece if multi-selection is active.
     */
    getSelectedPiece() {
        if (this.multiPieceSelector && this.multiPieceSelector.hasSelection()) {
            return this.multiPieceSelector.getSelectedPieces()[0] || null;
        }
        return this.selectedPiece;
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
                        // Only show valid moves / reselect for single-piece mode
                        const isMultiSelected = this.multiPieceSelector && this.multiPieceSelector.isPieceSelected(movedPiece.id);
                        if (!isMultiSelected) {
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
                            console.log('[Game] Piece is part of multi-selection, skipping reselection UI');
                        }
                    } else {
                        console.log('[Game] ERROR: Could not find moved piece in game state');
                    }
                };
                
                this.piecesSystem.movePieceWithCallback(data.piece.id, data.piece.x, data.piece.z, onAnimationComplete);
                console.log('[Game] Updated visual piece mesh position with callback:', data.piece.id, 'to', data.piece.x, data.piece.z);
            } else {
                console.log('[Game] Warning: Piece mesh not found for ID:', data.piece.id);
            }

            // Notify group move executor that this piece's animation completed
            if (this.groupMoveExecutor) {
                this.groupMoveExecutor.onPieceMoveComplete(data.piece.id);
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

        // Multi-piece formation move
        if (this.multiPieceSelector && this.multiPieceSelector.hasSelection()) {
            console.log(`[Game] Triggering formation move to (${x},${z})`);
            this.multiPieceSelector.onBoardClick(x, z);
            return;
        }

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
        if (this.multiPieceSelector) {
            this.multiPieceSelector.deselectAll();
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
        if (!this.piecesSystem) return;

        // Defensive: if server sends empty pieces during reconnect, preserve local pieces
        const hasExistingPieces = this.piecesSystem.pieceMeshes.size > 0;
        if ((!gameStateData.pieces || gameStateData.pieces.length === 0) && hasExistingPieces) {
            console.warn('[Game] Server sent 0 pieces but pieces exist locally; preserving them (likely transient reconnect state)');
            return;
        }

        // Clear existing pieces
        console.log('[Game] Clearing existing pieces...');
        this.piecesSystem.clearAllPieces();

        // Spawn all pieces from game state
        if (gameStateData.pieces && gameStateData.pieces.length > 0) {
            console.log(`[Game] Spawning ${gameStateData.pieces.length} pieces from game state...`);
            gameStateData.pieces.forEach((pieceData) => {
                // Add player color to piece data
                const player = gameStateData.players.find(p => p.id === pieceData.playerId);
                if (player) {
                    pieceData.color = player.color;
                } else {
                    pieceData.color = pieceData.color || 'white';
                }

                this.piecesSystem.addPiece(pieceData);
            });
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
        if (this.loadDiagnostics) {
            this.loadDiagnostics.progress = percent;
        }
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
