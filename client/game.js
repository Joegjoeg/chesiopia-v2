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
                
                // Expose board system to global scope for debug button AFTER full initialization
                window.boardSystem = this.boardSystem;
                console.log('[Game] Board system exposed to window.boardSystem for debug button');
                
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
                
                console.log('[Game] LOD debug functions exposed - use testLODDistances() or debugSeamlessLOD() in console');
                
                console.log('[Game] Game initialization completed successfully!');
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
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.5;  // Increased from 0.5 for brighter scene
        
        // Set background color
        this.renderer.setClearColor(0x87CEEB, 1);
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
        this.treeSystem = new LocalTreeSystem(this.scene, null);
        console.log('[Game] Tree system created:', !!this.treeSystem);
        this.terrainSystem = new TerrainSystem(this.scene, this.treeSystem);
        this.boardSystem = new CleanBoardSystem(this.scene, this.terrainSystem, this.treeSystem, this);
        this.piecesSystem = new Pieces3D(this.scene, this.terrainSystem);
        
        // Update tree system with terrain system reference
        this.treeSystem.terrainSystem = this.terrainSystem;
        
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
        
        // Initialize grass and texture blending systems (DISABLED)
        console.log('[Game] GrassSystem and TextureBlendingSystem disabled - using board grass texture instead');
        this.grassSystem = null;
        this.textureBlendingSystem = null;
        
        // Generate initial terrain
        await this.terrainSystem.generateInitialTerrain(0, 0, 10);
        
        // Create initial board - increased radius for proper LOD visibility
        this.boardSystem.createBoard(0, 0, 3);

        
        // Initialize tree system with initial camera position
        console.log('[Game] Tree system exists:', !!this.treeSystem);
        if (this.treeSystem) {
            console.log('[Game] Calling updateCameraPosition');
            this.treeSystem.updateCameraPosition(this.camera.position);
            // Force tree loading immediately
            console.log('[Game] About to call updateTreesFromServerData()');
            this.treeSystem.updateTreesFromServerData();
            console.log('[Game] Called updateTreesFromServerData()');
        } else {
            console.log('[Game] ERROR: Tree system is null/undefined!');
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
                        this.treeSystem.trees.clear();
                        
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
    }
    
    startGameLoop() {
        let lastTime = 0;

        const animate = (currentTime) => {
            requestAnimationFrame(animate);

            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            lastTime = currentTime;

            // console.log('[Game DEBUG] Game loop running, deltaTime:', deltaTime);

            // Update systems
            this.cameraController.update();

            // Update trees based on camera position
            if (this.treeSystem) {
                this.treeSystem.updateCameraPosition(this.camera.position);
                this.treeSystem.updateTreeFade();
            }

            // Update visual feedback system
            if (this.visualFeedback) {
                this.visualFeedback.update();
            }

            // Update decorative visuals system
            if (this.decorativeVisuals) {
                this.decorativeVisuals.updateCameraPosition(this.camera.position);
                this.decorativeVisuals.update(deltaTime);
            }

            // Grass system disabled - using board grass texture instead
            if (this.grassSystem) {
                console.log('[Game DEBUG] Grass system should be null but is not - this should not happen');
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

            // Count vertices in scene
            let totalVertices = 0;
            let totalTriangles = 0;
            this.scene.traverse((object) => {
                if (object.isMesh && object.geometry) {
                    const positionAttribute = object.geometry.getAttribute('position');
                    if (positionAttribute) {
                        totalVertices += positionAttribute.count;
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
                const debugEl = document.getElementById('connectionDebug');
                if (debugEl) {
                    debugEl.innerHTML = `Vertices: ${(totalVertices / 1000).toFixed(1)}K | Triangles: ${(totalTriangles / 1000).toFixed(1)}K`;
                    debugEl.style.color = '#66ff66';
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
