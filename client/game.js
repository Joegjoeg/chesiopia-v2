class PrivateerGame {
    constructor() {
        console.log('[Game] PrivateerGame constructor called!');
        window.gameInstance = this;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrainSystem = null;
        this.rollingTerrain = null;
        this.cameraController = null;
        this.networkManager = null;
        this.isLoading = true;
        this.isInitialized = false;
        this._frameCount = 0;
        this._lastFpsTime = 0;
        this._fps = 0;

        this.init().catch(error => {
            console.error('[Game] Failed to initialize:', error);
            this.showError('Failed to load game. Please refresh.');
        });
    }

    async init() {
        this.showLoadingProgress(10);
        await this.setupRenderer();
        this.showLoadingProgress(30);
        await this.setupScene();
        this.showLoadingProgress(50);
        await this.setupSystems();
        this.showLoadingProgress(70);
        this.setupEventListeners();
        this.showLoadingProgress(90);
        this.startGameLoop();
        this.showLoadingProgress(100);
        setTimeout(() => {
            this.hideLoadingScreen();
            this.isInitialized = true;
            console.log('[Game] Initialization complete');
        }, 500);
    }

    async setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('gameCanvas'),
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Ensure canvas can receive keyboard events
        const canvas = document.getElementById('gameCanvas');
        canvas.tabIndex = 0;
        canvas.focus();
        canvas.addEventListener('click', () => canvas.focus());
        canvas.style.outline = 'none';
    }

    async setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 20, 40);

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(50, 100, 50);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 500;
        const d = 100;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        this.scene.add(dirLight);
    }

    async setupSystems() {
        // Terrain system loads chunks from server
        this.terrainSystem = new TerrainSystem(this.scene);
        await this.terrainSystem.downloadEntireWorld();
        await this.terrainSystem.generateInitialTerrain(0, 0, 48);

        // Rolling terrain mesh
        this.rollingTerrain = new RollingTerrainMesh(this.terrainSystem, {
            gridSize: 96,
            cellSize: 1,
            thresholdCells: 16,
            maxStepPerFrame: 8,
            getHeight: (x, z) => this.terrainSystem.getHeight(x, z),
            getColor: (x, z) => this.terrainSystem.getColor(x, z),
            waterLevel: 12.0
        });
        this.scene.add(this.rollingTerrain.mesh);
        this.scene.add(this.rollingTerrain.waterMesh);
        await this.rollingTerrain.initAt(0, 0);

        // DEBUG: Simple water plane to verify rendering
        const debugWaterGeo = new THREE.PlaneGeometry(300, 300);
        const debugWaterMat = new THREE.MeshBasicMaterial({
            color: 0x2266aa,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        this.debugWater = new THREE.Mesh(debugWaterGeo, debugWaterMat);
        this.debugWater.rotation.x = -Math.PI / 2;
        this.debugWater.position.y = 12.0;
        this.debugWater.renderOrder = -1;
        this.debugWater.name = 'debugWater';
        this.scene.add(this.debugWater);
        console.log('[Game] Debug water plane added at y=12.0, size=300x300');

        // Camera controller
        this.cameraController = new CameraController(this.camera, this.scene);
        this.cameraController.target.set(0, 0, 0);

        // ECS World
        this.ecsWorld = new ECSWorld(this.scene);
        this.ecsWorld.registerArchetype(ShipArchetype);
        this.ecsWorld.registerArchetype(CannonballArchetype);

        // Systems
        this.inputSystem = new InputSystem();
        this.movementSystem = new MovementSystem();
        this.combatSystem = new CombatSystem();
        this.physicsSystem = new PhysicsSystem(this.terrainSystem);
        this.lifetimeSystem = new LifetimeSystem();
        this.visualSyncSystem = new VisualSyncSystem();

        this.ecsWorld.registerSystem('input', ['playerInput'], (dt, world) => this.inputSystem.update(dt, world), { priority: 0 });
        this.ecsWorld.registerSystem('movement', ['sail', 'playerInput', 'velocity', 'rotation'], (dt, world) => this.movementSystem.update(dt, world), { priority: 10 });
        this.ecsWorld.registerSystem('combat', ['cannon', 'playerInput', 'position', 'rotation'], (dt, world) => this.combatSystem.update(dt, world), { priority: 20 });
        this.ecsWorld.registerSystem('physics', ['position', 'velocity'], (dt, world) => this.physicsSystem.update(dt, world), { priority: 30 });
        this.ecsWorld.registerSystem('lifetime', ['lifetime'], (dt, world) => this.lifetimeSystem.update(dt, world), { priority: 40 });
        this.ecsWorld.registerSystem('visualSync', [], (dt, world) => this.visualSyncSystem.update(dt, world), { priority: 50 });

        // Preload visual models before spawning entities
        await this.ecsWorld.preloadVisuals();

        // Find a spawn location where terrain is below water level
        const waterLevel = 12.0;
        let spawnX = 0, spawnZ = 0;
        let foundWater = false;
        for (let r = 0; r < 50 && !foundWater; r++) {
            for (let dx = -r; dx <= r && !foundWater; dx++) {
                for (let dz = -r; dz <= r && !foundWater; dz++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // only check perimeter
                    const sx = dx, sz = dz;
                    const h = this.terrainSystem.getHeight(sx, sz);
                    if (h < waterLevel) {
                        spawnX = sx; spawnZ = sz;
                        foundWater = true;
                    }
                }
            }
        }
        console.log('[Game] Spawn search:', foundWater ? `water at (${spawnX}, ${spawnZ})` : 'no water found, using origin');

        // Spawn player ship
        this.playerShipId = this.ecsWorld.spawn('ship', {
            position: { x: spawnX, y: 0, z: spawnZ }
        });
        console.log('[Game] Player ship spawned at', spawnX, spawnZ, 'entityId:', this.playerShipId);
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
        this.setupBridgePanel();
        this.setupVoiceCommands();
    }

    setupBridgePanel() {
        this.bridgePanel = document.getElementById('bridgePanel');
        if (!this.bridgePanel) return;

        // Toggle with backtick
        const toggleKey = (e) => {
            if (e.code === 'Backquote') {
                e.preventDefault();
                this.toggleBridgePanel();
            }
        };
        window.addEventListener('keydown', toggleKey, { capture: true });

        // Command buttons
        const cmdMap = {
            'easyPort': () => this.setRudder(-1, 0.3),
            'easyStarboard': () => this.setRudder(1, 0.3),
            'hardPort': () => this.setRudder(-1, 1.0),
            'hardStarboard': () => this.setRudder(1, 1.0),
            'amidships': () => this.setRudderAmidships(),
            'steady': () => this.setSteadyAsSheGoes()
        };
        this.bridgePanel.querySelectorAll('[data-cmd]').forEach(btn => {
            btn.addEventListener('click', () => {
                const fn = cmdMap[btn.dataset.cmd];
                if (fn) fn();
            });
        });

        // Rudder angle slider
        const slider = document.getElementById('bridgeRudderSlider');
        const valueEl = document.getElementById('bridgeRudderValue');
        const portDir = document.getElementById('bridgePortDir');
        const starboardDir = document.getElementById('bridgeStarboardDir');
        const applyBtn = document.getElementById('bridgeApplyRudder');

        let selectedDir = 1; // 1 = starboard, -1 = port
        if (slider && valueEl) {
            slider.addEventListener('input', () => {
                valueEl.textContent = slider.value + '%';
            });
        }
        if (portDir) {
            portDir.addEventListener('click', () => {
                selectedDir = -1;
                portDir.classList.add('active');
                starboardDir.classList.remove('active');
            });
        }
        if (starboardDir) {
            starboardDir.addEventListener('click', () => {
                selectedDir = 1;
                starboardDir.classList.add('active');
                portDir.classList.remove('active');
            });
            starboardDir.classList.add('active'); // default
        }
        if (applyBtn && slider) {
            applyBtn.addEventListener('click', () => {
                this.setRudder(selectedDir, parseInt(slider.value, 10) / 100);
            });
        }
    }

    setupVoiceCommands() {
        // Check if Web Speech API is supported
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.log('[Voice] Web Speech API not supported in this browser');
            this.showVoiceStatus('Voice commands not supported', false);
            return;
        }

        console.log('[Voice] Setting up voice commands...');
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        // Voice command mapping
        this.voiceCommands = {
            'easy port': () => this.setRudder(-1, 0.3),
            'easy starboard': () => this.setRudder(1, 0.3),
            'hard port': () => this.setRudder(-1, 1.0),
            'hard starboard': () => this.setRudder(1, 1.0),
            'rudder amidships': () => this.setRudderAmidships(),
            'amidships': () => this.setRudderAmidships(),
            'steady as she goes': () => this.setSteadyAsSheGoes(),
            'steady': () => this.setSteadyAsSheGoes(),
            'port': () => this.setRudder(-1, 0.5),
            'starboard': () => this.setRudder(1, 0.5),
            'left': () => this.setRudder(-1, 0.5),
            'right': () => this.setRudder(1, 0.5),
            'stop': () => this.setRudderAmidships()
        };

        this.recognition.onresult = (event) => {
            const last = event.results.length - 1;
            const command = event.results[last][0].transcript.trim().toLowerCase();
            console.log('[Voice] Recognized:', command);

            // Find matching command
            for (const [phrase, action] of Object.entries(this.voiceCommands)) {
                if (command.includes(phrase)) {
                    console.log('[Voice] Executing:', phrase);
                    action();
                    this.showVoiceStatus(`Command: ${phrase}`, true);
                    return;
                }
            }

            console.log('[Voice] No matching command found');
            this.showVoiceStatus(`Unknown: "${command}"`, false);
        };

        this.recognition.onerror = (event) => {
            console.error('[Voice] Error:', event.error);
            if (event.error === 'not-allowed') {
                this.showVoiceStatus('Microphone access denied', false);
            } else if (event.error === 'no-speech') {
                // Let onend handle restart
            } else {
                this.showVoiceStatus(`Error: ${event.error}`, false);
            }
        };

        this.recognition.onend = () => {
            // Restart recognition if it stops
            if (this.voiceEnabled) {
                try {
                    this.recognition.start();
                } catch (e) {
                    console.log('[Voice] Could not restart recognition:', e);
                }
            }
        };

        // Create voice status indicator
        this.createVoiceIndicator();

        // Start listening
        try {
            this.recognition.start();
            this.voiceEnabled = true;
            this.showVoiceStatus('Voice commands active', true);
            console.log('[Voice] Voice commands initialized');
        } catch (e) {
            console.error('[Voice] Failed to start recognition:', e);
            this.showVoiceStatus('Failed to start voice', false);
        }
    }

    createVoiceIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'voiceIndicator';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 10px 15px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 12px;
            z-index: 1000;
            transition: opacity 0.3s;
        `;
        indicator.innerHTML = '<span style="color: #4CAF50;">●</span> Voice: Active';
        document.body.appendChild(indicator);
        this.voiceIndicator = indicator;
    }

    showVoiceStatus(message, success) {
        if (!this.voiceIndicator) return;
        const color = success ? '#4CAF50' : '#ff6b6b';
        this.voiceIndicator.innerHTML = `<span style="color: ${color};">●</span> ${message}`;
        this.voiceIndicator.style.opacity = '1';

        clearTimeout(this._voiceFadeTimer);
        this._voiceFadeTimer = setTimeout(() => {
            if (this.voiceIndicator) {
                this.voiceIndicator.style.opacity = '0.7';
            }
        }, 3000);
    }

    stopVoice() {
        this.voiceEnabled = false;
        if (this.recognition) {
            this.recognition.abort();
            this.recognition = null;
        }
        if (this.voiceIndicator) {
            this.voiceIndicator.remove();
            this.voiceIndicator = null;
        }
    }

    toggleBridgePanel() {
        if (!this.bridgePanel) return;
        const showing = this.bridgePanel.style.display !== 'none';
        this.bridgePanel.style.display = showing ? 'none' : 'block';
    }

    getPlayerInput() {
        if (!this.ecsWorld || this.playerShipId === undefined) return null;
        return this.ecsWorld.pool.getComponent(this.playerShipId, 'playerInput');
    }

    setRudder(direction, amount) {
        const input = this.getPlayerInput();
        if (!input) return;
        input.rudder = direction * amount;
        input.rudderLock = true; // persist until keys or amidships
        input.targetHeading = null; // manual command cancels steady mode
    }

    setRudderAmidships() {
        const input = this.getPlayerInput();
        if (!input) return;
        input.rudder = 0;
        input.rudderLock = true;
        input.targetHeading = null;
    }

    setSteadyAsSheGoes() {
        if (!this.ecsWorld || this.playerShipId === undefined) return;
        const heading = this.ecsWorld.pool.getRotation(this.playerShipId);
        const input = this.getPlayerInput();
        if (!input) return;
        input.targetHeading = heading;
        input.rudder = 0;
        input.rudderLock = true;
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    startGameLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            this.update();
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }

    update() {
        const now = performance.now();
        this._frameCount++;
        if (now - this._lastFpsTime >= 1000) {
            this._fps = this._frameCount;
            this._frameCount = 0;
            this._lastFpsTime = now;
        }

        const dt = 0.016;

        // ECS tick
        if (this.ecsWorld) {
            this.ecsWorld.tick(dt);
        }

        // Camera follow player ship
        if (this.cameraController && this.ecsWorld && this.playerShipId !== undefined) {
            const shipPos = this.ecsWorld.pool.getPosition(this.playerShipId);
            this.cameraController.target.set(shipPos.x, shipPos.y, shipPos.z);
        }

        if (this.cameraController) {
            this.cameraController.update(dt);
        }

        if (this.terrainSystem && this.camera) {
            this.terrainSystem.updateStreaming(this.camera.position);
        }

        if (this.rollingTerrain && this.camera) {
            this.rollingTerrain.update(this.cameraController ? this.cameraController.target : this.camera.position, this.camera.position);
        }
    }

    showLoadingProgress(percent) {
        const bar = document.querySelector('.loading-progress');
        if (bar) bar.style.width = percent + '%';
    }

    hideLoadingScreen() {
        const screen = document.getElementById('loadingScreen');
        if (screen) screen.style.opacity = '0';
        setTimeout(() => { if (screen) screen.style.display = 'none'; }, 500);
    }

    showError(message) {
        const screen = document.getElementById('loadingScreen');
        if (screen) {
            screen.innerHTML = '<div style="color:#ff6b6b;text-align:center;padding:40px;"><h2>Error</h2><p>' + message + '</p></div>';
        }
    }
}

function initializeGame() {
    console.log('[Game] initializeGame called');
    window.game = new PrivateerGame();
}
