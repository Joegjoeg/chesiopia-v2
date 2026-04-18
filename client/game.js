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
            this.showLoadingProgress(50);
            
            console.log('[Game] Setting up systems...');
            await this.setupSystems();
            this.showLoadingProgress(70);
            
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
        this.renderer.toneMappingExposure = 0.5;
        
        // Set background color
        this.renderer.setClearColor(0x87CEEB, 1);
    }
    
    async setupScene() {
        // Create scene
        this.scene = new THREE.Scene();
        
        // Add distance fog to obscure background terrain
        this.scene.fog = new THREE.Fog(0x808080, 10, 40); // 50% gray, pea souper fog
        console.log('[Game] Fog applied:', !!this.scene.fog, 'Color:', this.scene.fog.color.getHex(), 'Near:', this.scene.fog.near, 'Far:', this.scene.fog.far);
        
        // Setup lighting
        this.setupLighting();
        
        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        
        // Verify fog is still applied after camera setup
        console.log('[Game] Fog verification after camera setup:', !!this.scene.fog);
        this.camera.position.set(10, 15, 10);
        this.camera.lookAt(0, 0, 0);
    }
    
    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);
        
        // Additional low brightness fill light to lighten shadows
        const fillLight = new THREE.AmbientLight(0xffffff, 0.15); // Soft white fill light
        this.scene.add(fillLight);
        
        // Main directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        
        // Configure shadow camera
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.bias = -0.0001;
        
        this.scene.add(directionalLight);
        
        // Add light helper for debugging
        // const helper = new THREE.DirectionalLightHelper(directionalLight, 10);
        // this.scene.add(helper);
    }
    
    async setupSystems() {
        // Initialize game systems
        this.gameState = new ClientGameState();
        this.terrainSystem = new TerrainSystem(this.scene);
        this.boardSystem = new CleanBoardSystem(this.scene, this.terrainSystem);
        this.piecesSystem = new Pieces3D(this.scene, this.terrainSystem);
        this.cameraController = new CameraController(this.camera, this.scene);
        this.movementBridge = new MovementBridge(this.gameState, this.boardSystem);
        this.visualFeedback = new VisualFeedbackSystem(this.scene);
        console.log('[Game] Creating SimpleCelShaderSystem...');
        this.celShaderSystem = new SimpleCelShaderSystem();
        console.log('[Game] SimpleCelShaderSystem created:', !!this.celShaderSystem);
        
        // Generate initial terrain
        await this.terrainSystem.generateInitialTerrain(0, 0, 10);
        
        // Create initial board
        this.boardSystem.createBoard(0, 0, 10);
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
        const animate = () => {
            requestAnimationFrame(animate);
            
            // Update systems
            this.cameraController.update();
            this.piecesSystem.update();
            this.visualFeedback.update();
            
            // Update terrain streaming
            this.terrainSystem.updateStreaming(this.camera.position);
            
            // Update board streaming
            this.boardSystem.updateStreaming(this.camera.position);
            
            // Render
            this.renderer.render(this.scene, this.camera);
        };
        
        animate();
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
                this.handleTileClick(tilePos.x, tilePos.z);
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
        
        console.log('[Game] Valid moves found:', this.validMoves.length);
        
        // Show visual feedback
        this.visualFeedback.showSelectedPiece(piece);
        this.visualFeedback.showValidMoves(this.validMoves);
        
        // Update UI
        this.updateSelectedPieceUI(piece);
    }
    
    handleTileClick(x, z) {
        if (this.selectedPiece) {
            // Check if this specific square's marker is ready for interaction
            const isValidMove = this.validMoves.some(move => move.x === x && move.z === z);
            
            if (isValidMove) {
                if (!this.visualFeedback.isMarkerReady(x, z)) {
                    console.log(`[Game] Marker for square (${x},${z}) not ready yet, ignoring click`);
                    return; // Behave as empty square until this marker appears
                }
                
                this.movePiece(this.selectedPiece, x, z);
                // Don't deselect here - let handlePieceMoved handle it
                return;
            }
        }
        
        // Deselect piece only if no valid move was made
        this.selectedPiece = null;
        this.validMoves = [];
        this.visualFeedback.hideSelection();
        this.visualFeedback.clearValidMovesImmediate(); // Clear move markers on deselect
        this.updateSelectedPieceUI(null);
    }
    
    movePiece(piece, toX, toZ) {
        if (this.networkManager) {
            this.networkManager.emit('movePiece', {
                pieceId: piece.id,
                fromX: piece.x,
                fromZ: piece.z,
                toX: toX,
                toZ: toZ
            });
        }
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
        if (data.success) {
            this.piecesSystem.movePiece(data.piece.id, data.piece.x, data.piece.z);
            
            if (data.capturedPiece) {
                this.piecesSystem.removePiece(data.capturedPiece.id);
                this.visualFeedback.showCaptureEffect(data.capturedPiece.x, data.capturedPiece.z);
            }
            
            // Clear all available square markers with animation
            console.log('[Game] Clearing valid moves with animation...');
            this.visualFeedback.clearValidMoves();
            
            // Update valid moves using the moved piece data (since piece gets deselected)
            const movedPiece = this.gameState.getPiece(data.piece.id);
            if (movedPiece) {
                console.log('[Game] Getting valid moves for moved piece:', movedPiece);
                this.validMoves = this.movementBridge.getValidMovesForPiece(movedPiece);
                console.log('[Game] Valid moves found:', this.validMoves.length);
                
                // Wait for animated cleanup to complete before showing new markers
                setTimeout(() => {
                    this.visualFeedback.showValidMoves(this.validMoves, false);
                }, 600); // Wait for pop-out animation to complete
                
                // Keep the piece selected to show its moves
                this.selectedPiece = movedPiece;
                this.visualFeedback.showSelectedPiece(movedPiece);
                this.updateSelectedPieceUI(movedPiece);
            } else {
                console.log('[Game] Moved piece not found in game state');
            }
        }
    }
    
    handlePiecePurchased(data) {
        if (data.success) {
            // Get player color for the new piece
            const player = this.gameState.getCurrentPlayer();
            if (player) {
                data.piece.color = player.color;
            }
            this.piecesSystem.addPiece(data.piece);
            this.visualFeedback.showSpawnEffect(data.piece.x, data.piece.z);
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
        const statusEl = document.getElementById('connectionStatus');
        const statusText = document.getElementById('statusText');
        
        if (statusEl && statusText) {
            statusText.textContent = status.text;
            statusEl.className = `status-indicator ${status.connected ? 'connected' : 'disconnected'}`;
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
