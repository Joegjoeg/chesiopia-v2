class CleanBoardSystem {



    constructor(scene, terrainSystem = null, treeSystem = null, game = null) {



        this.scene = scene;



        this.terrainSystem = terrainSystem;



        this.treeSystem = treeSystem;



        this.game = game;



        this.chunks = new Map();



        this.tileCache = new Map();



        this.maxCacheSize = 10000;



        // Game time sync (server-side authoritative time)
        this.serverGameTime = 0;
        this.serverDayLength = 60000; // 60 seconds per day
        this.lastTimeSyncTimestamp = 0; // When the last server time sync was received
        this.frameCount = 0; // For throttling DOM updates

        // Seasonal system
        this.yearLength = 120 * this.serverDayLength; // 120 days = 360 seconds (6 minutes per year)
        this.seasonConfig = {
            SPRING: { days: [0, 30],   sunTilt: 0.3,  moonColor: [0.5,0.5,0.7], moonIntensity: 0.4, treeColor: [0.7,0.9,0.5], fogColor: [200,220,200] },
            SUMMER: { days: [30, 60],  sunTilt: 0.5,  moonColor: [0.4,0.5,0.8], moonIntensity: 0.5, treeColor: [0.4,0.8,0.3], fogColor: [235,245,255] },
            AUTUMN: { days: [60, 90],  sunTilt: 0.2,  moonColor: [0.6,0.4,0.5], moonIntensity: 0.4, treeColor: [0.9,0.6,0.2], fogColor: [200,180,150] },
            WINTER: { days: [90, 120], sunTilt: 0.0,  moonColor: [0.3,0.3,0.5], moonIntensity: 0.3, treeColor: [0.8,0.8,0.9], fogColor: [180,190,210] }
        };
        this.currentSeason = 'SPRING';
        this.seasonProgress = 0; // 0-1 within current season
        this.dayOfYear = 0; // 0-119

        // UI drag flags to prevent auto-update while user is interacting
        this._isDraggingDayTimeSlider = false;
        this._isDraggingYearTimeSlider = false;



        



        // Board configuration



        this.chunkSize = 16;



        this.renderDistance = 20; // Increased from 8 to allow more LOD levels



        // Removed fadeDistance - no longer using camera-based opacity fade



        



        // Removed fade tracking - no longer using camera-based opacity fade



        



        // Mouse position tracking for fade center



        this.mouseWorldPosition = new THREE.Vector3(0, 0, 0);



        this.currentMouseX = window.innerWidth / 2;



        this.currentMouseY = window.innerHeight / 2;



        



        // Track mouse movement and trigger fade updates



        this.needsFadeUpdate = false;



        this.frameCount = 0;



        



        window.addEventListener('mousemove', (event) => {



            this.currentMouseX = event.clientX;



            this.currentMouseY = event.clientY;



            this.needsFadeUpdate = true; // Flag that fade needs recalculation



            // console.log(`[MOUSE DEBUG] Mouse moved to: (${event.clientX}, ${event.clientY}) - needsFadeUpdate set to true`);



            // console.log(`[MOUSE DEBUG] Raw mouse: ${this.currentMouseX}, ${this.currentMouseY}`);
        });

        // Touch event support for Android/mobile
        window.addEventListener('touchmove', (event) => {
            if (event.touches.length > 0) {
                this.currentMouseX = event.touches[0].clientX;
                this.currentMouseY = event.touches[0].clientY;
                this.needsFadeUpdate = true;
            }
        }, { passive: true });

        window.addEventListener('touchstart', (event) => {
            if (event.touches.length > 0) {
                this.currentMouseX = event.touches[0].clientX;
                this.currentMouseY = event.touches[0].clientY;
                this.needsFadeUpdate = true;
            }
        }, { passive: true });



        



        // Materials



        this.lightTileColor = new THREE.Color(0xe0c9a0); // Light wood (reduced contrast)
        this.darkTileColor = new THREE.Color(0xc9a070);  // Dark wood (reduced contrast)



        this.highlightColor = new THREE.Color(0x87ceeb);



        this.selectedColor = new THREE.Color(0xf4a460);



        // Water level and underwater mesh optimization
        this.waterLevel = -1.5;
        this.beachWidth = 4; // Tiles: keep full resolution within this distance of water line



        // Dynamic shader system will handle terrain texturing
        // Static texture removed - using textureBlendingSystem shader




        // Distance fade configuration



        this.fadeConfig = {



            nearDistance: 8,     // Distance where fade starts (checkerboard visible)



            farDistance: 16,    // Distance where fade ends (pure grass) - expanded fade zone



            currentDistance: 0   // Current camera distance for fade calculation



        };



        



        // Multi-layer optimization system



        this.optimization = {
            // Cone culling settings
            coneFOV: 140,          // 140° field of view (expanded from 100°)
            coneBuffer: 30,        // 30° buffer to prevent edge popping (expanded from 22°)
            maxRenderDistance: 80, // Maximum render distance (adjusted for smaller scale)
            
            // Distance LOD settings - proper tile sizes for different detail levels
            lodLevels: [
                { distance: 15, tileSize: 1, name: 'high' },     // Very Near: Full detail (1x1 tiles)
                { distance: 30, tileSize: 2, name: 'medium' },    // Medium: 50% detail (2x2 tiles)
                { distance: 45, tileSize: 4, name: 'low' },      // Far: 25% detail (4x4 tiles)
                { distance: 60, tileSize: 8, name: 'verylow' }   // Very Far: 6.25% detail (8x8 tiles)
            ],
            
            // Hysteresis settings to prevent flickering
            hysteresis: {
                upgradeBuffer: 2,     // Upgrade LOD 2 units closer (prevent flicker)
                downgradeBuffer: 0     // Downgrade LOD immediately when farther (more responsive)
            },
            
            // Adaptive mesh optimization settings
            adaptiveMesh: {
                enabled: true,
                aggregationDistance: 50,    // Distance to start aggregating vertices
                maxVertexReduction: 0.8,    // Maximum 80% vertex reduction at far distance
                lodBias: 0.5,               // Bias toward lower LOD for performance
                smoothingEnabled: true,     // Enable mesh smoothing for aggregated geometry
                minClusterSize: 4          // Minimum tiles to cluster for aggregation
            },
            
            // Chunk streaming settings
            streaming: {
                enabled: true,
                preloadDistance: 2,         // Chunks to preload beyond render distance
                unloadDelay: 1000,          // Delay in ms before unloading distant chunks
                maxChunksPerFrame: 2,       // Max chunks to process per frame
                predictionEnabled: true,     // Predict camera movement
                predictionDistance: 3       // Distance to predict camera movement
            },
            
            // Performance tracking
            stats: {
                totalChunks: 0,
                renderedChunks: 0,
                culledChunks: 0,
                vertexCount: 0,
                baseVertexCount: 0,
                reductionRatio: 0,
                lastUpdate: Date.now(),
                frameTime: 0,
                lodTransitions: 0
            }
        };






        // Create circular terrain mask to hide corners
        this.terrainMask = this.createCircularTerrainMask();

        this.boardMaterial = new THREE.MeshStandardMaterial({



            vertexColors: true,



            // Using dynamic shader instead of static texture



            alphaMap: this.terrainMask,



            roughness: 0.8,



            metalness: 0.0,



            side: THREE.DoubleSide,



            transparent: true,



            opacity: 1.0



        });





        // Streaming state



        this.lastCameraChunk = { x: -999999, z: -999999 };



        this.cameraVelocity = new THREE.Vector3(0, 0, 0);





        this.lastCameraPosition = new THREE.Vector3(0, 0, 0);





        this.lastUpdateTime = Date.now();





        // Adaptive mesh cache



        this.adaptiveMeshCache = new Map();





        this.chunkUpdateQueue = new Set();





        this.processedChunksThisFrame = 0;





        // Initialize grass system for seasonal grass textures
        if (typeof GrassSystem !== 'undefined' && this.terrainSystem) {
            try {
                this.grassSystem = new GrassSystem(this.scene, this, this.terrainSystem);
                console.log('[Board] Grass system initialized');
            } catch (error) {
                console.error('[Board] Failed to initialize grass system:', error);
                this.grassSystem = null;
            }
        } else {
            console.log('[Board] Grass system disabled - GrassSystem class not available or no terrain system');
            this.grassSystem = null;
        }

        // Initialize texture blending system
        if (typeof TextureBlendingSystem !== 'undefined' && this.terrainSystem) {
            try {
                this.textureBlendingSystem = new TextureBlendingSystem(this, this.terrainSystem);
                console.log('[Board] Texture blending system initialized');
            } catch (error) {
                console.error('[Board] Failed to initialize texture blending system:', error);
                this.textureBlendingSystem = null;
            }
        } else {
            console.log('[Board] Texture blending system disabled - class not available or no terrain system');
            this.textureBlendingSystem = null;
        }

        console.log(`[Board] Board system initialized with terrain system: ${this.terrainSystem ? 'YES' : 'NO'}`);

        // Wire chunk-loaded callback so rolling terrain refreshes newly arrived data
        if (this.terrainSystem) {
            const board = this;
            const previousCallback = this.terrainSystem.onChunkLoaded;
            this.terrainSystem.onChunkLoaded = function(chunkX, chunkZ) {
                if (previousCallback) previousCallback(chunkX, chunkZ);
                if (board.rollingTerrain) {
                    const cs = board.terrainSystem.chunkSize || 16;
                    const minX = chunkX * cs;
                    const minZ = chunkZ * cs;
                    const maxX = minX + cs - 1;
                    const maxZ = minZ + cs - 1;
                    board.rollingTerrain.refreshRegion(minX, minZ, maxX, maxZ);
                }
            };
        }

        // Cache for server terrain height queries (avoid repeated API calls)
        this._serverHeightCache = new Map();
        this._serverHeightCacheSize = 1000; // Maximum cache entries

        // Concurrency control for per-tile server requests
        this._pendingServerRequests = new Map();
        this._maxConcurrentServerRequests = 6;
        this._activeServerRequests = 0;





        console.log(`[Board] Adaptive mesh optimization: ${this.optimization.adaptiveMesh.enabled ? 'ENABLED' : 'DISABLED'}`);





        console.log(`[Board] Chunk streaming: ${this.optimization.streaming.enabled ? 'ENABLED' : 'DISABLED'}`);







        // Initialize sun system
        this.createSunSystem();

        console.log(`[Board] Sun system initialized`);
    }

    createCircularTerrainMask() {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Create radial gradient: white (opaque) in center, black (transparent) at edges
        const centerX = size / 2;
        const centerY = size / 2;
        const maxRadius = size / 2;
        const fadeRadius = maxRadius * 0.85; // Start fading at 85% of max radius

        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
        gradient.addColorStop(0, 'white'); // Center: fully opaque
        gradient.addColorStop(fadeRadius / maxRadius, 'white'); // Start of fade: still opaque
        gradient.addColorStop(1, 'black'); // Edge: fully transparent

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    



    // Seeded random number generator for consistent textures
    seededRandom(seed) {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    // Old createGrassTexture method removed - using dynamic shader system instead

    // Create orbiting sun system with omni light, circle sprite, and lens flare
    createSunSystem() {
        console.log('[SUN] Creating orbiting sun system');

        // Sun configuration - 3 second full rotation
        this.sun = {
            orbitRadius: 10,         // Distance from camera (much closer)
            orbitSpeed: (2 * Math.PI) / (3 * 60),  // Full rotation in 3 seconds at 60fps
            angle: 0,               // Start at noon for immediate light
            height: 30,             // Max height above ground (lower)
            intensity: 1,           // Light intensity (reduced further)
            color: 0xffffff,         // White light
            // Lens flare settings
            flareSize: 15,          // Larger flare size
            flareOpacity: 0.9,
            horizonFadeDistance: 20  // Distance from horizon where flare starts fading
        };

        // Moon configuration - opposite orbit, pale blue light
        this.moon = {
            orbitRadius: 10,         // Same as sun
            orbitSpeed: (2 * Math.PI) / (3 * 60),  // Same speed as sun
            angle: Math.PI,          // Opposite to sun (180 degrees offset)
            height: 30,             // Same height as sun
            intensity: 0.5,         // Dimmer than sun
            color: 0x87ceeb,        // Pale blue light (sky blue)
            flareSize: 8,           // Smaller than sun
            flareOpacity: 0.6,
            horizonFadeDistance: 20
        };

        // Ambient light for atmospheric scattering at dusk/dawn (purple twilight)
        this.ambientLight = new THREE.AmbientLight(0x8b5cf6, 0); // Purple atmospheric color, starts at 0 intensity
        this.scene.add(this.ambientLight);

        // Night ambient light (low blue to prevent pure black shadows)
        this.nightAmbientLight = new THREE.AmbientLight(0x2a3a5a, 0); // Cool blue, starts at 0 intensity
        this.scene.add(this.nightAmbientLight);
        
        // Create directional light (sun-like, parallel rays)
        this.sun.light = new THREE.DirectionalLight(
            this.sun.color,
            this.sun.intensity
        );
        this.sun.light.position.set(0, this.sun.height, 0);
        this.sun.light.castShadow = true; // Shadows enabled for debug

        // Initialize shadow properties
        this.sun.light.shadow.mapSize.width = 1024;
        this.sun.light.shadow.mapSize.height = 1024;
        this.sun.light.shadow.camera.near = 0.5;
        this.sun.light.shadow.camera.far = 500;
        this.sun.light.shadow.bias = -0.0005;
        this.sun.light.shadow.normalBias = 0.02;
        const sunShadowSize = 400;
        this.sun.light.shadow.camera.left = -sunShadowSize;
        this.sun.light.shadow.camera.right = sunShadowSize;
        this.sun.light.shadow.camera.top = sunShadowSize;
        this.sun.light.shadow.camera.bottom = -sunShadowSize;
        this.sun.light.shadow.camera.updateProjectionMatrix();

        this.scene.add(this.sun.light);

        // Create sun sprite (circle with gradient texture)
        const sunTexture = this.createCircularTexture(this.sun.color, 128, this.sun.flareOpacity);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: sunTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.sun.sprite = new THREE.Sprite(spriteMaterial);
        this.sun.sprite.scale.set(this.sun.flareSize * 2, this.sun.flareSize * 2, 1);
        this.sun.sprite.position.set(0, this.sun.height, 0);
        this.scene.add(this.sun.sprite);

        // Create lens flare effect (multiple sprites with circular textures)
        this.sun.lensFlares = [];
        const flareCount = 3;

        for (let i = 0; i < flareCount; i++) {
            const flareSize = this.sun.flareSize * (1 - i * 0.3);
            const flareTexture = this.createCircularTexture(this.sun.color, 64, this.sun.flareOpacity * (0.5 - i * 0.15));
            const flareMaterial = new THREE.SpriteMaterial({
                map: flareTexture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const flare = new THREE.Sprite(flareMaterial);
            flare.scale.set(flareSize * 2, flareSize * 2, 1);
            flare.position.set(0, this.sun.height, 0);
            this.scene.add(flare);
            this.sun.lensFlares.push(flare);
        }

        // Create moon directional light (pale blue)
        this.moon.light = new THREE.DirectionalLight(
            this.moon.color,
            this.moon.intensity
        );
        this.moon.light.position.set(0, this.moon.height, 0);
        this.moon.light.castShadow = true;  // Moon casts shadows at night

        // Initialize moon shadow properties
        this.moon.light.shadow.mapSize.width = 1024;
        this.moon.light.shadow.mapSize.height = 1024;
        this.moon.light.shadow.camera.near = 0.5;
        this.moon.light.shadow.camera.far = 500;
        this.moon.light.shadow.bias = -0.0005;
        this.moon.light.shadow.normalBias = 0.02;
        const moonShadowSize = 400;
        this.moon.light.shadow.camera.left = -moonShadowSize;
        this.moon.light.shadow.camera.right = moonShadowSize;
        this.moon.light.shadow.camera.top = moonShadowSize;
        this.moon.light.shadow.camera.bottom = -moonShadowSize;
        this.moon.light.shadow.camera.updateProjectionMatrix();

        this.scene.add(this.moon.light);

        // Create moon sprite (smaller, pale blue with circular texture)
        const moonTexture = this.createCircularTexture(this.moon.color, 128, this.moon.flareOpacity);
        const moonSpriteMaterial = new THREE.SpriteMaterial({
            map: moonTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.moon.sprite = new THREE.Sprite(moonSpriteMaterial);
        this.moon.sprite.scale.set(this.moon.flareSize * 2, this.moon.flareSize * 2, 1);
        this.moon.sprite.position.set(0, this.moon.height, 0);
        this.scene.add(this.moon.sprite);

        console.log('[SUN] Sun and moon system created');

        // Create sky gradient texture canvas
        this.skyCanvas = document.createElement('canvas');
        this.skyCanvas.width = 512;
        this.skyCanvas.height = 512;
        this.skyContext = this.skyCanvas.getContext('2d');
        this.skyTexture = new THREE.CanvasTexture(this.skyCanvas);
        this.scene.background = this.skyTexture;
    }

    // Create circular gradient texture for sun/moon sprites
    createCircularTexture(color, size, opacity) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Create radial gradient for circular glow
        const gradient = ctx.createRadialGradient(
            size / 2, size / 2, 0,
            size / 2, size / 2, size / 2
        );

        // Convert color hex to RGB
        const r = (color >> 16) & 255;
        const g = (color >> 8) & 255;
        const b = color & 255;

        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${opacity})`);
        gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${opacity * 0.5})`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        return new THREE.CanvasTexture(canvas);
    }

    updateSkyColor(sunElevation) {
        if (!this.skyContext) return;
        const ctx = this.skyContext;
        const width = this.skyCanvas.width;
        const height = this.skyCanvas.height;

        const colorStates = {
            dawn: {
                horizon: { r: 75, g: 0, b: 130 },
                zenith: { r: 25, g: 25, b: 112 },
                glow: { r: 255, g: 140, b: 0 },
                glowIntensity: 0.3
            },
            sunrise: {
                horizon: { r: 255, g: 140, b: 0 },
                zenith: { r: 100, g: 50, b: 150 },
                glow: { r: 255, g: 200, b: 100 },
                glowIntensity: 0.5
            },
            midday: {
                horizon: { r: 135, g: 206, b: 235 },
                zenith: { r: 70, g: 130, b: 180 },
                glow: { r: 255, g: 255, b: 220 },
                glowIntensity: 0.4
            },
            noon: {
                horizon: { r: 135, g: 206, b: 235 },
                zenith: { r: 70, g: 130, b: 180 },
                glow: { r: 255, g: 255, b: 255 },
                glowIntensity: 0.3
            },
            night: {
                horizon: { r: 10, g: 10, b: 40 },
                zenith: { r: 5, g: 5, b: 20 },
                glow: { r: 0, g: 0, b: 0 },
                glowIntensity: 0.0
            }
        };

        // Linear interpolation helper
        const lerp = (a, b, t) => a + (b - a) * t;
        const lerpColor = (c1, c2, t) => ({
            r: lerp(c1.r, c2.r, t),
            g: lerp(c1.g, c2.g, t),
            b: lerp(c1.b, c2.b, t)
        });

        // Determine current colors with smooth transitions
        // Scale transition thresholds based on day length (shorter day = wider angular range for transitions)
        const referenceDayLength = 60000; // 60 seconds reference
        const timeScale = referenceDayLength / this.serverDayLength; // Inverted: shorter day = larger scale
        const dawnThreshold = -0.2 * timeScale;
        const sunriseThreshold = 0 * timeScale;
        const middayThreshold = 0.2 * timeScale;
        const noonThreshold = 0.5 * timeScale;

        let horizonColor, zenithColor, sunGlowColor, sunGlowIntensity;

        if (sunElevation > noonThreshold) {
            // Noon - bright blue sky
            horizonColor = colorStates.noon.horizon;
            zenithColor = colorStates.noon.zenith;
            sunGlowColor = colorStates.noon.glow;
            sunGlowIntensity = colorStates.noon.glowIntensity;
        } else if (sunElevation > middayThreshold) {
            // Transition from midday to noon
            const t = (sunElevation - middayThreshold) / (noonThreshold - middayThreshold);
            horizonColor = lerpColor(colorStates.midday.horizon, colorStates.noon.horizon, t);
            zenithColor = lerpColor(colorStates.midday.zenith, colorStates.noon.zenith, t);
            sunGlowColor = lerpColor(colorStates.midday.glow, colorStates.noon.glow, t);
            sunGlowIntensity = lerp(colorStates.midday.glowIntensity, colorStates.noon.glowIntensity, t);
        } else if (sunElevation > sunriseThreshold) {
            // Transition from sunrise to midday
            const t = (sunElevation - sunriseThreshold) / (middayThreshold - sunriseThreshold);
            horizonColor = lerpColor(colorStates.sunrise.horizon, colorStates.midday.horizon, t);
            zenithColor = lerpColor(colorStates.sunrise.zenith, colorStates.midday.zenith, t);
            sunGlowColor = lerpColor(colorStates.sunrise.glow, colorStates.midday.glow, t);
            sunGlowIntensity = lerp(colorStates.sunrise.glowIntensity, colorStates.midday.glowIntensity, t);
        } else if (sunElevation > dawnThreshold) {
            // Transition from dawn to sunrise
            const t = (sunElevation - dawnThreshold) / (sunriseThreshold - dawnThreshold);
            horizonColor = lerpColor(colorStates.dawn.horizon, colorStates.sunrise.horizon, t);
            zenithColor = lerpColor(colorStates.dawn.zenith, colorStates.sunrise.zenith, t);
            sunGlowColor = lerpColor(colorStates.dawn.glow, colorStates.sunrise.glow, t);
            sunGlowIntensity = lerp(colorStates.dawn.glowIntensity, colorStates.sunrise.glowIntensity, t);
        } else {
            // Night - dark blue/black
            horizonColor = colorStates.night.horizon;
            zenithColor = colorStates.night.zenith;
            sunGlowColor = colorStates.night.glow;
            sunGlowIntensity = colorStates.night.glowIntensity;
        }

        // Create radial gradient from horizon (bottom) to zenith (top)
        const gradient = ctx.createRadialGradient(
            width / 2, height, 0,    // Center at horizon
            width / 2, height / 2, height / 2  // Extend to zenith
        );

        gradient.addColorStop(0, `rgb(${Math.floor(horizonColor.r)}, ${Math.floor(horizonColor.g)}, ${Math.floor(horizonColor.b)})`);
        gradient.addColorStop(0.5, `rgb(${Math.floor((horizonColor.r + zenithColor.r) / 2)}, ${Math.floor((horizonColor.g + zenithColor.g) / 2)}, ${Math.floor((horizonColor.b + zenithColor.b) / 2)})`);
        gradient.addColorStop(1, `rgb(${Math.floor(zenithColor.r)}, ${Math.floor(zenithColor.g)}, ${Math.floor(zenithColor.b)})`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Add sun glow near horizon if sun is visible
        if (sunGlowIntensity > 0 && sunElevation > -0.3) {
            const glowGradient = ctx.createRadialGradient(
                width / 2, height - 50, 0,
                width / 2, height - 50, 150
            );
            glowGradient.addColorStop(0, `rgba(${Math.floor(sunGlowColor.r)}, ${Math.floor(sunGlowColor.g)}, ${Math.floor(sunGlowColor.b)}, ${sunGlowIntensity})`);
            glowGradient.addColorStop(1, `rgba(${Math.floor(sunGlowColor.r)}, ${Math.floor(sunGlowColor.g)}, ${Math.floor(sunGlowColor.b)}, 0)`);
            ctx.fillStyle = glowGradient;
            ctx.fillRect(0, height - 200, width, 200);
        }

        // Update texture
        this.skyTexture.needsUpdate = true;

        // Update fog color based on time of day
        this.updateFogColor(sunElevation);
    }

    updateFogColor(sunElevation) {
        if (!this.scene.fog) return;

        // Scale transition thresholds based on day length (shorter day = wider angular range for transitions)
        const referenceDayLength = 60000; // 60 seconds reference
        const timeScale = referenceDayLength / this.serverDayLength; // Inverted: shorter day = larger scale
        const dawnThreshold = -0.2 * timeScale;
        const sunriseThreshold = 0 * timeScale;
        const middayThreshold = 0.2 * timeScale;
        const noonThreshold = 0.5 * timeScale;

        // Define vivid fog colors for dramatic day/night cycle
        const fogColors = {
            night:  { r: 0,   g: 0,   b: 0   },  // Black night fog
            dawn:   { r: 80,  g: 40,  b: 60  },  // Warm dark violet
            sunrise:{ r: 200, g: 120, b: 80  },  // Golden amber
            midday:{ r: 180, g: 200, b: 220 },  // Soft blue
            noon:  { r: 200, g: 220, b: 255 }   // Bright sky blue
        };

        // Linear interpolation helper
        const lerp = (a, b, t) => a + (b - a) * t;
        const lerpColor = (c1, c2, t) => ({
            r: lerp(c1.r, c2.r, t),
            g: lerp(c1.g, c2.g, t),
            b: lerp(c1.b, c2.b, t)
        });

        let fogColor, fogNear, fogFar;

        if (sunElevation > noonThreshold) {
            // Noon - clear
            fogColor = fogColors.noon;
            fogNear = 25; fogFar = 100;
        } else if (sunElevation > middayThreshold) {
            // Midday to noon
            const t = (sunElevation - middayThreshold) / (noonThreshold - middayThreshold);
            fogColor = lerpColor(fogColors.midday, fogColors.noon, t);
            fogNear = 20 + t * 5;     // 20 → 25
            fogFar = 80 + t * 20;      // 80 → 100
        } else if (sunElevation > sunriseThreshold) {
            // Sunrise to midday, fog lifting
            const t = (sunElevation - sunriseThreshold) / (middayThreshold - sunriseThreshold);
            fogColor = lerpColor(fogColors.sunrise, fogColors.midday, t);
            fogNear = 12 + t * 8;      // 12 → 20
            fogFar = 50 + t * 30;      // 50 → 80
        } else if (sunElevation > dawnThreshold) {
            // Dawn to sunrise, fog creeping in
            const t = (sunElevation - dawnThreshold) / (sunriseThreshold - dawnThreshold);
            fogColor = lerpColor(fogColors.dawn, fogColors.sunrise, t);
            fogNear = 6 + t * 6;       // 6 → 12
            fogFar = 30 + t * 20;      // 30 → 50
        } else {
            // Night - tight fog
            fogColor = fogColors.night;
            fogNear = 6; fogFar = 28;
        }

        this.scene.fog.color.setRGB(fogColor.r / 255, fogColor.g / 255, fogColor.b / 255);
        this.scene.fog.near = fogNear;
        this.scene.fog.far = fogFar;

        // Night deepening: fade fog to black between midnight (00:00) and 03:00, then restore by 05:00
        const dayProgress = (this.serverGameTime % this.serverDayLength) / this.serverDayLength;
        const hours = dayProgress * 24;
        const midnightHours = hours >= 12 ? hours - 12 : hours + 12; // Normalize so 0 = midnight
        if (sunElevation < 0 && midnightHours >= 0 && midnightHours < 5) {
            let t;
            if (midnightHours < 3) {
                // 00:00 to 03:00: fade to black
                t = midnightHours / 3; // 0 at 00:00, 1 at 03:00
                const nightFogColor = new THREE.Color(0, 0, 0); // Black
                const currentFogColor = this.scene.fog.color.clone();
                // Interpolate from normal fog color (at 00:00) to black (at 03:00)
                currentFogColor.lerp(nightFogColor, t);
                this.scene.fog.color.copy(currentFogColor);
            } else {
                // 03:00 to 05:00: restore to normal
                t = (midnightHours - 3) / 2; // 0 at 03:00, 1 at 05:00
                const nightFogColor = new THREE.Color(0, 0, 0); // Black
                const currentFogColor = this.scene.fog.color.clone();
                // Interpolate from black (at 03:00) to normal fog color (at 05:00)
                currentFogColor.lerp(nightFogColor, 1 - t);
                this.scene.fog.color.copy(currentFogColor);
            }
        }
    }

    updateSunPosition(cameraPosition) {
        // Update seasons
        this.updateSeasons();

        // Scale transition thresholds based on day length (shorter day = wider angular range for transitions)
        const referenceDayLength = 60000; // 60 seconds reference
        const timeScale = referenceDayLength / this.serverDayLength; // Inverted: shorter day = larger scale

        // Update sun angle based on server game time
        if (this.serverGameTime > 0) {
            // Interpolate time locally between server syncs for smooth movement
            let currentGameTime = this.serverGameTime;
            if (this.lastTimeSyncTimestamp > 0) {
                // Add elapsed time since last sync to get smooth continuous movement
                const elapsedSinceSync = Date.now() - this.lastTimeSyncTimestamp;
                currentGameTime += elapsedSinceSync;
            }

            // Use interpolated time: angle = (elapsedTime / dayLength) * 2PI - PI/2
            // Offset by -PI/2 so that 0:00 = midnight, 6:00 = sunrise, 12:00 = noon, 18:00 = sunset
            this.sun.angle = (currentGameTime / this.serverDayLength) * (2 * Math.PI) - (Math.PI / 2);
        } else {
            // Fallback to local frame-based increments if no server time yet
            this.sun.angle += this.sun.orbitSpeed;
            console.log('[Board] Sun angle using local fallback');
        }
        this.moon.angle = this.sun.angle + Math.PI;  // Moon is opposite to sun

        // Get seasonal configuration
        const season = this.seasonConfig[this.currentSeason];
        const seasonTilt = season.sunTilt;

        // Calculate sun height based on angle (vertical orbit) with seasonal tilt
        const sunHeight = Math.max(0, Math.sin(this.sun.angle) * this.sun.height);
        const sunElevation = Math.sin(this.sun.angle);

        // Calculate sun position (orbits around camera horizontally on X-axis, seasonal tilt on Y-axis)
        const sunX = cameraPosition.x + Math.cos(this.sun.angle) * this.sun.orbitRadius;
        const sunZ = cameraPosition.z + Math.sin(this.sun.angle) * this.sun.orbitRadius;
        const sunY = cameraPosition.y + sunHeight + seasonTilt * 5; // Seasonal tilt affects height

        // Update sun light position
        this.sun.light.position.set(sunX, sunY, sunZ);

        // Update sun light target to center on camera position
        this.sun.light.target.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        this.sun.light.target.updateMatrixWorld();

        // Configure shadow camera to be wide enough for the board and distant mountains
        const shadowSize = 400;  // Doubled from 200 to cover distant mountains
        this.sun.light.shadow.camera.left = -shadowSize;
        this.sun.light.shadow.camera.right = shadowSize;
        this.sun.light.shadow.camera.top = shadowSize;
        this.sun.light.shadow.camera.bottom = -shadowSize;
        this.sun.light.shadow.camera.updateProjectionMatrix();
        this.sun.light.shadow.needsUpdate = true;

        // Fade light intensity when sun is below horizon
        const lightIntensity = Math.max(0, sunElevation) * this.sun.intensity;
        this.sun.light.intensity = lightIntensity;

        // Smooth sun color transition based on elevation
        const sunriseThreshold = 0 * timeScale;
        const middayThreshold = 0.2 * timeScale;
        const noonThreshold = 0.5 * timeScale;

        // Define color keyframes for different elevations
        const sunriseColor = new THREE.Color(0xff6347);  // Tomato orange
        const sunriseRedColor = new THREE.Color(0xff2200); // Strong red at sunrise
        const midDayColor = new THREE.Color(0xfffacd);    // Lemon chiffon
        const noonColor = new THREE.Color(0xffffff);      // White
        const sunNightColor = new THREE.Color(0x000000);  // Black (below horizon)

        let sunColor;
        if (sunElevation <= sunriseThreshold) {
            // Below horizon
            sunColor = sunNightColor;
        } else if (sunElevation < 0.05 * timeScale) {
            // Just above horizon - strong red tint that quickly fades
            const t = (sunElevation - sunriseThreshold) / (0.05 * timeScale - sunriseThreshold);
            sunColor = sunriseRedColor.clone().lerp(sunriseColor, t);
        } else if (sunElevation < middayThreshold) {
            // Sunrise to midday transition
            const t = (sunElevation - 0.05 * timeScale) / (middayThreshold - 0.05 * timeScale);
            sunColor = sunriseColor.clone().lerp(midDayColor, t);
        } else if (sunElevation < noonThreshold) {
            // Midday to noon transition
            const t = (sunElevation - middayThreshold) / (noonThreshold - middayThreshold);
            sunColor = midDayColor.clone().lerp(noonColor, t);
        } else {
            // Noon
            sunColor = noonColor;
        }
        this.sun.light.color.copy(sunColor);

        // Update sky background color based on sun elevation
        if (this._viewportShader) {
            this._viewportShader.uniforms.uSunElevation.value = sunElevation;
        }
        this.updateSkyColor(sunElevation);

        // Calculate moon height (opposite to sun) with seasonal tilt
        const moonHeight = Math.max(0, Math.sin(this.moon.angle) * this.moon.height);
        const moonElevation = Math.sin(this.moon.angle);

        // Calculate moon position (opposite to sun) with seasonal tilt
        const moonX = cameraPosition.x + Math.cos(this.moon.angle) * this.moon.orbitRadius;
        const moonZ = cameraPosition.z + Math.sin(this.moon.angle) * this.moon.orbitRadius;
        const moonY = cameraPosition.y + moonHeight + seasonTilt * 5; // Seasonal tilt affects moon too

        // Update moon light position
        this.moon.light.position.set(moonX, moonY, moonZ);

        // Update moon light target
        this.moon.light.target.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        this.moon.light.target.updateMatrixWorld();

        // Configure moon shadow camera
        const moonShadowSize = 400;
        this.moon.light.shadow.camera.left = -moonShadowSize;
        this.moon.light.shadow.camera.right = moonShadowSize;
        this.moon.light.shadow.camera.top = moonShadowSize;
        this.moon.light.shadow.camera.bottom = -moonShadowSize;
        this.moon.light.shadow.camera.updateProjectionMatrix();
        this.moon.light.shadow.needsUpdate = true;

        // Fade moon light intensity when moon is below horizon
        const moonFadeInStart = -0.2 * timeScale;
        let moonIntensity;
        if (moonElevation < moonFadeInStart) {
            moonIntensity = 0;
        } else if (moonElevation < 0) {
            // Fade in from moonFadeInStart to 0
            const fadeProgress = (moonElevation - moonFadeInStart) / (0 - moonFadeInStart);
            moonIntensity = fadeProgress * season.moonIntensity * 0.3; // Start at 30% of max
        } else {
            // Full intensity based on elevation
            moonIntensity = Math.min(1, moonElevation * 2) * season.moonIntensity;
        }

        // Night deepening: darken moonlight between midnight (00:00) and 03:00, then restore by 05:00
        // Calculate hours from midnight (0-24 scale, where 0 = midnight)
        const dayProgress = (this.serverGameTime % this.serverDayLength) / this.serverDayLength;
        const hours = dayProgress * 24;
        const midnightHours = hours >= 12 ? hours - 12 : hours + 12; // Normalize so 0 = midnight
        let nightDarkenFactor = 1.0;
        if (sunElevation < 0 && midnightHours >= 0 && midnightHours < 5) {
            let t;
            if (midnightHours < 3) {
                // 00:00 to 03:00: fade to 30% intensity
                t = midnightHours / 3; // 0 at 00:00, 1 at 03:00
                nightDarkenFactor = 1.0 - (t * 0.7); // 1.0 at 00:00, 0.3 at 03:00
            } else {
                // 03:00 to 05:00: restore to 100% intensity
                t = (midnightHours - 3) / 2; // 0 at 03:00, 1 at 05:00
                nightDarkenFactor = 0.3 + (t * 0.7); // 0.3 at 03:00, 1.0 at 05:00
            }
        }
        moonIntensity *= nightDarkenFactor;
        this.moon.light.intensity = moonIntensity;

        // Debug shadow state (moved here after moonElevation is defined)
        if (this.frameCount % 60 === 0) {
            console.log(`[SHADOW DEBUG] sunElev=${sunElevation.toFixed(2)} sunInt=${this.sun.light.intensity.toFixed(2)} moonElev=${moonElevation.toFixed(2)} moonInt=${this.moon.light.intensity.toFixed(2)} castShadow=${this.sun.light.castShadow}`);
        }

        // Red-tinted moon events (4x per year at season boundaries)
        const redMoonDays = [0, 30, 60, 90]; // Season boundaries
        let redMoonFactor = 0;
        for (const day of redMoonDays) {
            const dayDiff = Math.abs(this.dayOfYear - day);
            if (dayDiff < 5) { // 5-day fade window
                const fade = 1 - (dayDiff / 5);
                redMoonFactor = Math.max(redMoonFactor, fade);
            }
        }

        // Smooth moon color transition based on elevation and season
        const moonRiseColor = new THREE.Color(0x4a5568);   // Dim bluish-gray
        const moonZenithColor = new THREE.Color(0xe2e8f0);  // Bright silver
        const moonNightColor = new THREE.Color(0x000000);    // Black (below horizon)
        const redMoonColor = new THREE.Color(0xcc3333);     // Blood moon red
        const moonColorZenithThreshold = 0.5 * timeScale;

        let moonColor;
        if (moonElevation <= 0) {
            // Below horizon
            moonColor = moonNightColor;
        } else if (moonElevation < moonColorZenithThreshold) {
            // Moonrise to zenith transition
            const t = moonElevation / moonColorZenithThreshold;
            moonColor = moonRiseColor.clone().lerp(moonZenithColor, t);
        } else {
            // Zenith
            moonColor = moonZenithColor;
        }

        // Apply seasonal moon color
        const seasonalMoonColor = new THREE.Color(...season.moonColor);
        moonColor.lerp(seasonalMoonColor, 0.5);

        // Apply red moon tint if active
        if (redMoonFactor > 0) {
            moonColor.lerp(redMoonColor, redMoonFactor * 0.7);
        }

        this.moon.light.color.copy(moonColor);

        // Update ambient light intensity for atmospheric scattering at dusk/dawn
        // Represents sunlight bouncing off atmosphere when sun is at low angles and after sunset
        // Scale transition thresholds based on day length
        const sunsetThreshold = 0.3 * timeScale;
        const moonRiseThreshold = 0.2 * timeScale;
        const moonAmbientZenithThreshold = 0.4 * timeScale;

        let ambientIntensity = 0;
        let nightAmbientIntensity = 0;

        if (sunElevation >= sunsetThreshold) {
            // Daytime - moderate fill so shadowed sides aren't pitch black
            ambientIntensity = 0.25;
        } else if (sunElevation > 0) {
            // Sunset fade: drop from 0.25 down to 0.2 at the horizon
            const t = sunElevation / sunsetThreshold;
            ambientIntensity = 0.2 + 0.05 * t;
        } else if (sunElevation > -0.2 * timeScale) {
            // Twilight glow just after sunset (purple atmospheric scattering)
            const t = 1.0 - (Math.abs(sunElevation) / (0.2 * timeScale));
            ambientIntensity = 0.2 * t;
        } else {
            // Deep night - very low ambient, let the moon directional light do the work
            nightAmbientIntensity = 0.08;
        }

        this.ambientLight.intensity = ambientIntensity;
        this.nightAmbientLight.intensity = nightAmbientIntensity;

        // Winter night fog (cold color, fade in during winter)
        if (this.currentSeason === 'WINTER' && sunElevation <= 0) {
            // Use darker winter night fog instead of seasonal fog color
            const winterNightFogColor = new THREE.Color(0, 0, 0); // Black like regular night
            const fogFade = 0.02; // Smooth fade
            this.scene.fog.color.lerp(winterNightFogColor, fogFade);
            // Slightly increase fog density at night in winter
            this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, 8, fogFade);
            this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, 40, fogFade);
        }

        // Update dev console light stats (throttled to every 30 frames)
        this.frameCount++;
        if (this.frameCount % 30 === 0 && typeof document !== 'undefined') {
            const sunIntEl = document.getElementById('sunIntensity');
            const sunColorEl = document.getElementById('sunColor');
            const moonIntEl = document.getElementById('moonIntensity');
            const moonColorEl = document.getElementById('moonColor');
            const ambientIntEl = document.getElementById('ambientIntensity');
            const ambientColorEl = document.getElementById('ambientColor');
            const dayTimeEl = document.getElementById('dayTime');
            const seasonProgressEl = document.getElementById('seasonProgress');

            if (sunIntEl) sunIntEl.textContent = this.sun.light.intensity.toFixed(2);
            if (sunColorEl) sunColorEl.textContent = '#' + this.sun.light.color.getHexString();
            if (moonIntEl) moonIntEl.textContent = this.moon.light.intensity.toFixed(2);
            if (moonColorEl) moonColorEl.textContent = '#' + this.moon.light.color.getHexString();
            if (ambientIntEl) ambientIntEl.textContent = this.ambientLight.intensity.toFixed(2);
            if (ambientColorEl) ambientColorEl.textContent = '#' + this.ambientLight.color.getHexString();

            // Update day time display (0-24h format)
            if (dayTimeEl) {
                const dayProgress = (this.serverGameTime % this.serverDayLength) / this.serverDayLength;
                const hours = Math.floor(dayProgress * 24);
                const minutes = Math.floor((dayProgress * 24 * 60) % 60);
                dayTimeEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }

            // Update season progress display
            if (seasonProgressEl) {
                const seasonDividers = ['|', '||', '|||', '||||'];
                const seasonIndex = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'].indexOf(this.currentSeason);
                const divider = seasonDividers[seasonIndex] || '';
                seasonProgressEl.textContent = `${this.currentSeason} ${divider} ${(this.seasonProgress * 100).toFixed(0)}%`;
            }

            // Update day time slider to reflect current time (animate it)
            const dayTimeSlider = document.getElementById('dayTimeSlider');
            if (dayTimeSlider) {
                // Only update if user isn't currently dragging (check flag exists and is false)
                if (!this._isDraggingDayTimeSlider) {
                    const dayProgress = (this.serverGameTime % this.serverDayLength) / this.serverDayLength;
                    const hours = dayProgress * 24;
                    dayTimeSlider.value = hours;
                }
            }

            // Update year time slider to reflect current season (animate it)
            const yearTimeSlider = document.getElementById('yearTimeSlider');
            if (yearTimeSlider && !this._isDraggingYearTimeSlider) {
                yearTimeSlider.value = this.dayOfYear || 0;
            }
        }

        // Update sun sprite position (Sprite always faces camera automatically)
        this.sun.sprite.position.set(sunX, sunY, sunZ);

        // Update moon sprite position (Sprite always faces camera automatically)
        this.moon.sprite.position.set(moonX, moonY, moonZ);

        // Calculate horizon fade factor (0 at horizon, 1 at zenith)
        const horizonFade = Math.max(0, Math.min(1, sunElevation));
        const moonHorizonFade = Math.max(0, Math.min(1, moonElevation));

        // Update sprite opacity based on horizon fade
        this.sun.sprite.material.opacity = this.sun.flareOpacity * horizonFade;
        this.moon.sprite.material.opacity = this.moon.flareOpacity * moonHorizonFade;

        // Update lens flares (Sprite always faces camera automatically)
        this.sun.lensFlares.forEach((flare, index) => {
            flare.position.set(sunX, sunY, sunZ);

            // Apply horizon fade and additional distance fade
            const baseOpacity = (0.5 - index * 0.15);
            const distanceFade = Math.max(0, 1 - this.sun.orbitRadius / 200);
            flare.material.opacity = baseOpacity * horizonFade * distanceFade;

            // Add slight offset for lens flare effect
            const offset = (index + 1) * 2;
            flare.position.x += (cameraPosition.x - sunX) * 0.01 * offset;
            flare.position.z += (cameraPosition.z - sunZ) * 0.01 * offset;
        });
    }

    updateServerGameTime(elapsedTime, dayLength) {
        this.serverGameTime = elapsedTime;
        // Override server dayLength to 60000ms (60 seconds per day)
        this.serverDayLength = 60000;
        this.lastTimeSyncTimestamp = Date.now();
        console.log(`[Board] Server time sync: ${elapsedTime}ms elapsed, day length: ${dayLength}ms (OVERRIDDEN to 60000ms)`);
    }

    updateSeasons() {
        const yearProgress = (this.serverGameTime % this.yearLength) / this.yearLength;
        this.yearProgress = yearProgress; // Store for tree system
        this.dayOfYear = Math.floor(yearProgress * 120);

        // Determine current season with smooth transitions
        const seasonNames = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
        let newSeason = 'SPRING';

        for (const season of seasonNames) {
            const [start, end] = this.seasonConfig[season].days;
            if (this.dayOfYear >= start && this.dayOfYear < end) {
                newSeason = season;
                this.seasonProgress = (this.dayOfYear - start) / (end - start);
                break;
            }
        }

        // Smooth transition at season boundaries (5-day fade)
        const transitionDays = 5;
        const seasonLength = 30;
        if (this.seasonProgress < transitionDays / seasonLength && this.currentSeason !== newSeason) {
            // Fade in new season
            const fadeProgress = this.seasonProgress / (transitionDays / seasonLength);
            this.seasonProgress = fadeProgress;
        }

        // Debug logging every 60 frames
        if (this.frameCount % 60 === 0) {
            console.log(`[SEASON] Day: ${this.dayOfYear}/120, Season: ${newSeason}, Progress: ${this.seasonProgress.toFixed(2)}, TreeColor: [${this.seasonConfig[newSeason].treeColor.join(',')}]`);
        }

        // Update grass textures if season changed
        if (this.currentSeason !== newSeason) {
            if (this.grassSystem && typeof this.grassSystem.updateSeasonalTextures === 'function') {
                this.grassSystem.updateSeasonalTextures();
            }
            if (this.textureBlendingSystem && typeof this.textureBlendingSystem.updateSeasonalTextures === 'function') {
                this.textureBlendingSystem.updateSeasonalTextures();
            }
        }

        this.currentSeason = newSeason;
    }
        



    async createBoard(centerX, centerZ, radius, meshMultiplier = 12) {
        console.log(`[DYNAMIC MESH] Creating board with dynamic continuous mesh (NO GAPS!)`);
        
        // CLEAR ALL EXISTING CHUNKS - we're using dynamic continuous mesh now
        this.clearAllChunks();
        
        // Store multiplier for dynamic mesh regeneration
        this.meshMultiplier = meshMultiplier;
        
        // Initialize mesh bounds
        this.meshBounds = {
            centerX: centerX,
            centerZ: centerZ,
            size: this.chunkSize * meshMultiplier // configurable: 12 desktop, 6 mobile
        };
        
        // Create rolling terrain mesh (fixed grid, ring-buffer updates)
        if (this.useViewportMesh) {
            const material = this.textureBlendingSystem
                ? this.textureBlendingSystem.createShaderMaterial()
                : new THREE.MeshStandardMaterial({
                    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide
                  });

            this.rollingTerrain = new RollingTerrainMesh(this, this.terrainSystem, {
                gridSize: 64, cellSize: 1, thresholdCells: 29, material
            });
            await this.rollingTerrain.initAt(centerX, centerZ);
            this.continuousMesh = this.rollingTerrain.mesh;
            this.scene.add(this.continuousMesh);
            console.log(`[ROLLING TERRAIN] Board created with 64x64 fixed grid`);
        } else {
            this.continuousMesh = await this.createContinuousMeshAround(centerX, centerZ);
            this.scene.add(this.continuousMesh);
        }

        // Create water plane at water level
        this.createWaterPlane();
        
        // Store reference for later access
        
        console.log(`[DYNAMIC MESH] Board created - size=${this.meshBounds.size}, mult=${meshMultiplier}, verts≈${(this.meshBounds.size * this.meshBounds.size * 4 / 1000).toFixed(0)}K`);
        
        return Promise.resolve(); // Return promise for compatibility
    }
    
    createWaterPlane() {
        // Remove existing water plane if any
        if (this._waterPlane) {
            this.scene.remove(this._waterPlane);
            this._waterPlane.geometry.dispose();
            if (this._waterPlane.material.map) {
                this._waterPlane.material.map.dispose();
            }
            this._waterPlane.material.dispose();
        }

        const waterLevel = this.waterLevel;
        const size = 200; // Large enough to cover view area

        const geometry = new THREE.PlaneGeometry(size, size);
        geometry.rotateX(-Math.PI / 2);

        // Load sky reflection texture
        const textureLoader = new THREE.TextureLoader();
        const waterTexture = textureLoader.load('../Images/sky reflection1.jpg');
        
        // Configure texture for seamless scrolling
        waterTexture.wrapS = THREE.RepeatWrapping;
        waterTexture.wrapT = THREE.RepeatWrapping;
        waterTexture.repeat.set(2, 1); // Repeat less to make clouds more prominent

        const material = new THREE.MeshStandardMaterial({
            transparent: true,
            opacity: 0.95,
            roughness: 0.05,
            metalness: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false,
            map: waterTexture
        });

        this._waterPlane = new THREE.Mesh(geometry, material);
        this._waterPlane.position.set(0, waterLevel, 0);
        this._waterPlane.name = 'waterPlane';
        // Render water after terrain so it depth-tests correctly against underwater terrain
        this._waterPlane.renderOrder = 1;
        this.scene.add(this._waterPlane);

        // Initialize texture animation with wind parameters
        this._waterTextureOffset = new THREE.Vector2(0, 0);
        this._windSpeed = 1.0;
        this._windDirection = new THREE.Vector2(1, 0);

        console.log('[WATER] Water plane created at y=' + waterLevel + ' with sky reflection texture');
    }

    updateWaterTexture() {
        // No-op - shader removed
    }

    setWindParameters(windSpeed, windDirection) {
        // No-op - shader removed
    }

    // Clear all existing chunks when switching to continuous mesh
    clearAllChunks() {
        console.log(`[CONTINUOUS MESH] Clearing all existing chunks`);

        // Remove rolling terrain mesh if it exists
        if (this.rollingTerrain) {
            this.scene.remove(this.rollingTerrain.mesh);
            this.rollingTerrain.mesh.geometry.dispose();
            // material is shared — do not dispose here
            this.rollingTerrain = null;
        }

        // Remove clipmap terrain if it exists (legacy)
        if (this._clipmapLevels) {
            for (const level of this._clipmapLevels) {
                if (level.mesh) {
                    this.scene.remove(level.mesh);
                    level.mesh.geometry.dispose();
                    level.mesh.material.dispose();
                }
            }
            this._clipmapLevels = null;
        }

        // Remove continuous mesh if it exists (non-clipmap fallback)
        if (this.continuousMesh) {
            this.scene.remove(this.continuousMesh);
            this.continuousMesh = null;
        }

        // Remove all chunk meshes from scene
        for (const [chunkKey, chunk] of this.chunks) {
            if (chunk.mesh) {
                this.scene.remove(chunk.mesh);
                chunk.mesh.geometry.dispose();
                chunk.mesh.material.dispose();
            }
        }
        this.chunks.clear();

        // Force recreation of clipmap terrain with checkerboard colors
        // Clipmap terrain disabled
        if (false && this.useViewportMesh) {
            this.createClipmapTerrain();
            this.continuousMesh = this._clipmapLevels[0].mesh;
        }

        console.log(`[CONTINUOUS MESH] All chunks cleared and terrain regenerated`);
    }

    // Force regeneration of clipmap terrain to apply checkerboard colors
    regenerateClipmapTerrain() {
        // Clipmap terrain disabled
        if (!this.useViewportMesh) return;

        console.log(`[CLIPMAP] Regenerating terrain with checkerboard colors`);

        // Remove existing clipmap terrain
        if (this._clipmapLevels) {
            for (const level of this._clipmapLevels) {
                if (level.mesh) {
                    this.scene.remove(level.mesh);
                    level.mesh.geometry.dispose();
                    level.mesh.material.dispose();
                }
            }
            this._clipmapLevels = null;
        }

        // Recreate with checkerboard colors
        // Clipmap terrain disabled
        // this.createClipmapTerrain();
        // this.continuousMesh = this._clipmapLevels[0].mesh;

        console.log(`[CLIPMAP] Terrain regeneration disabled`);
    }

    // DYNAMIC MESH REGENERATION - Create new vertices as camera scrolls, remove old ones
    async updateDynamicMesh(cameraPosition, force = false) {
        // Skip if using clipmap terrain (heights are updated dynamically in updateClipmapTerrain)
        if (this.useViewportMesh) return;

        // Initialize mesh bounds if not set
        if (!this.meshBounds) {
            console.log(`[Board] INITIALIZING mesh bounds`);
            this.meshBounds = {
                centerX: cameraPosition.x,
                centerZ: cameraPosition.z,
                size: this.chunkSize * (this.meshMultiplier || 12) // use stored multiplier, fallback to 12
            };
            this.lastMeshRegeneration = 0;
            return;
        }

        // Check if camera moved far enough to require mesh regeneration
        const distanceFromCenter = Math.sqrt(
            Math.pow(cameraPosition.x - this.meshBounds.centerX, 2) +
            Math.pow(cameraPosition.z - this.meshBounds.centerZ, 2)
        );

        const regenerationThreshold = this.meshBounds.size * 0.3; // Regenerate when 30% from center

        if (force || distanceFromCenter > regenerationThreshold) {
            // console.log(`[DYNAMIC MESH] ${force ? 'FORCE' : 'Camera moved'} regenerating mesh (distance: ${distanceFromCenter.toFixed(1)})`);

            // Update mesh bounds to follow camera
            this.meshBounds.centerX = cameraPosition.x;
            this.meshBounds.centerZ = cameraPosition.z;

            // Remove old mesh
            if (this.continuousMesh) {
                this.scene.remove(this.continuousMesh);
                this.continuousMesh.geometry.dispose();
                this.continuousMesh.material.dispose();
            }

            // Create new mesh centered on camera
            const newMesh = await this.createContinuousMeshAround(cameraPosition.x, cameraPosition.z);
            this.scene.add(newMesh);
            this.continuousMesh = newMesh;

            this.lastMeshRegeneration = Date.now();

            // console.log(`[DYNAMIC MESH] Mesh regenerated at (${cameraPosition.x.toFixed(1)}, ${cameraPosition.z.toFixed(1)})`);
        }
    }
    
    // Create continuous mesh centered on specific position
    // Each tile has 4 unique vertices for per-tile color control (checkerboard + mouse fade)
    async createContinuousMeshAround(centerX, centerZ) {
        // console.log(`[DYNAMIC MESH] Creating mesh centered at (${centerX.toFixed(1)}, ${centerZ.toFixed(1)})`);
        
        const meshSize = this.meshBounds.size;
        
        // Pre-populate server height cache for distant points before mesh creation
        await this.prepopulateDistantHeights(centerX, centerZ, meshSize);
        
        const tileSize = 1;
        const tilesPerSide = meshSize;
        
        // console.log(`[DYNAMIC MESH] Mesh size: ${meshSize}x${meshSize}, Tiles: ${tilesPerSide}x${tilesPerSide}`);

        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const colors = [];
        const indices = [];
        const normals = [];
        const uvs = [];

        // Generate tiles with non-shared vertices for per-tile color control
        for (let tx = 0; tx < tilesPerSide; tx++) {
            for (let tz = 0; tz < tilesPerSide; tz++) {
                const worldX = centerX - meshSize/2 + (tx * tileSize);
                const worldZ = centerZ - meshSize/2 + (tz * tileSize);

                // Get terrain heights at tile corners
                // Use server cache for distant points if chunks are not loaded
                const height00 = this.getTerrainHeightWithFallbackSync(worldX, worldZ, centerX, centerZ);
                const height10 = this.getTerrainHeightWithFallbackSync(worldX + tileSize, worldZ, centerX, centerZ);
                const height01 = this.getTerrainHeightWithFallbackSync(worldX, worldZ + tileSize, centerX, centerZ);
                const height11 = this.getTerrainHeightWithFallbackSync(worldX + tileSize, worldZ + tileSize, centerX, centerZ);

                // Calculate checkerboard color with mouse-based fade
                const isLight = (Math.floor(worldX) + Math.floor(worldZ)) % 2 === 0;
                const baseTileColor = isLight ? this.lightTileColor : this.darkTileColor;

                // Calculate distance from mouse cursor to tile center
                const tileCenterX = worldX + tileSize/2;
                const tileCenterZ = worldZ + tileSize/2;
                const distance = Math.sqrt(
                    Math.pow(tileCenterX - this.mouseWorldPosition.x, 2) +
                    Math.pow(tileCenterZ - this.mouseWorldPosition.z, 2)
                );

                const fadeFactor = this.calculateTextureFade(distance);
                const grassColor = new THREE.Color(0.4, 0.6, 0.8);
                const tileColor = new THREE.Color().lerpColors(baseTileColor, grassColor, fadeFactor);

                // Create 4 vertices for the tile with slight overlap to eliminate gaps
                const baseIndex = vertices.length / 3;
                const overlap = 0.02;

                // World-space UVs for grass texture (tiled across world)
                const uvScale = 0.5; // 1 texture tile per 2 world units

                // Bottom-left
                vertices.push(worldX - overlap, height00, worldZ - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push(worldX * uvScale, worldZ * uvScale);

                // Bottom-right
                vertices.push(worldX + tileSize + overlap, height10, worldZ - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push((worldX + tileSize) * uvScale, worldZ * uvScale);

                // Top-left
                vertices.push(worldX - overlap, height01, worldZ + tileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push(worldX * uvScale, (worldZ + tileSize) * uvScale);

                // Top-right
                vertices.push(worldX + tileSize + overlap, height11, worldZ + tileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push((worldX + tileSize) * uvScale, (worldZ + tileSize) * uvScale);

                // Create indices for two triangles
                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }

        // Set geometry attributes (colors are 3-component RGB)
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        // Compute proper vertex normals from geometry (replaces manual (0,1,0) normals)
        geometry.computeVertexNormals();

        // Compute bounding volumes for raycasting
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        
        // Create mesh using dynamic shader material (enables spherical deformation & blending)
        const material = this.textureBlendingSystem
            ? this.textureBlendingSystem.createShaderMaterial()
            : new THREE.MeshStandardMaterial({
                vertexColors: true,
                side: THREE.DoubleSide,
                roughness: 0.9,
                metalness: 0.0
            });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'dynamicContinuousMesh';
        mesh.receiveShadow = true;   // Enable receiving shadows from other models
        mesh.castShadow = false;      // Disable self-shadowing to avoid ripple effect
        
        // console.log(`[DYNAMIC MESH] Created mesh with ${vertices.length/3} vertices, ${indices.length/3} triangles`);
        
        return mesh;
    }

    // SINGLE-MESH VARIABLE-DENSITY TERRAIN
    // One BufferGeometry, one draw call. Vertex spacing doubles with distance from
    // camera — dense detail at centre, sparse at horizon. No overlapping meshes,
    // no seams, no z-fighting. Height calls per frame = vertex count.
    //
    // Grid axes are built by expanding outward from the origin in steps:
    //   band 0: spacing 1  → coords 0, ±1, ±2 … ±32
    //   band 1: spacing 2  → coords ±34, ±36 … ±64
    //   band 2: spacing 4  → ±68 … ±128
    //   band 3: spacing 8  → ±136 … ±256
    //   band 4: spacing 16 → ±272 … ±512
    createClipmapTerrain() {
        // Build the 1-D coordinate array for one axis.
        // Returns sorted array of local offsets (negative → positive).
        const buildAxis = (bands) => {
            const pos = [0];
            let cursor = 0;
            for (const { spacing, count } of bands) {
                for (let k = 0; k < count; k++) {
                    cursor += spacing;
                    pos.push(cursor);
                }
            }
            // Mirror negative side, sort
            const neg = pos.slice(1).map(v => -v);
            return [...neg.reverse(), ...pos];
        };

        // Each band: how many steps at this spacing
        const bandDefs = [
            { spacing: 1,  count: 32 },
            { spacing: 2,  count: 16 },
            { spacing: 4,  count: 16 },
            { spacing: 8,  count: 16 },
            { spacing: 16, count: 16 },
        ];

        const axis = buildAxis(bandDefs);   // same for X and Z
        const N = axis.length;              // number of vertices per axis
        const maxExtent = axis[axis.length - 1];
        const fadeStart = maxExtent * 0.85;

        const vertCount = N * N;
        const positions = new Float32Array(vertCount * 3);
        const colors    = new Float32Array(vertCount * 3);
        const alphas    = new Float32Array(vertCount);
        const uvs       = new Float32Array(vertCount * 2);
        const indices   = [];

        for (let iz = 0; iz < N; iz++) {
            for (let ix = 0; ix < N; ix++) {
                const idx = iz * N + ix;
                const lx  = axis[ix];
                const lz  = axis[iz];

                positions[idx * 3]     = lx;
                positions[idx * 3 + 1] = 0;
                positions[idx * 3 + 2] = lz;

                // Set UVs based on world coordinates for proper texture mapping
                uvs[idx * 2]     = lz * 0.1;  // Swap to prevent 90-degree rotation
                uvs[idx * 2 + 1] = lx * 0.1;

                // Set vertex colors to white - let shader generate checkerboard from world position
                colors[idx * 3]     = 1.0;
                colors[idx * 3 + 1] = 1.0;
                colors[idx * 3 + 2] = 1.0;

                const dist = Math.max(Math.abs(lx), Math.abs(lz));
                if (dist > fadeStart) {
                    alphas[idx] = Math.max(0, 1 - (dist - fadeStart) / (maxExtent - fadeStart));
                } else {
                    alphas[idx] = 1.0;
                }
            }
        }

        for (let iz = 0; iz < N - 1; iz++) {
            for (let ix = 0; ix < N - 1; ix++) {
                const a = iz * N + ix;
                const b = a + 1;
                const c = a + N;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('alpha',    new THREE.BufferAttribute(alphas, 1));
        geometry.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        let material;
        if (this.textureBlendingSystem) {
            // Always create/get the shader material from textureBlendingSystem
            material = this.textureBlendingSystem.createShaderMaterial();
            console.log('[CLIPMAP] Using shader material from textureBlendingSystem');
        } else {
            material = new THREE.MeshStandardMaterial({
                color: 0xffffff, roughness: 0.9, metalness: 0.0,
                side: THREE.DoubleSide, vertexColors: true
            });
            console.log('[CLIPMAP] Using standard material (no textureBlendingSystem)');
        }
        material.transparent = true;
        material.depthWrite  = true;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'terrainSingleMesh';
        mesh.receiveShadow = true;
        mesh.castShadow    = false;
        this.scene.add(mesh);

        // Debug: verify material type
        console.log('[CLIPMAP] Mesh material type:', mesh.material.type);
        console.log('[CLIPMAP] Mesh material is ShaderMaterial:', mesh.material.isShaderMaterial);
        console.log('[CLIPMAP] Mesh material uniforms:', mesh.material.uniforms ? 'present' : 'missing');

        // Store as a single-entry array so createBoard/clearAllChunks still work
        this._clipmapLevels = [{ mesh, snapX: -999999, snapZ: -999999 }];
        this._terrainAxis   = axis;   // reuse in update
        this._terrainN      = N;

        console.log(`[TERRAIN] Single mesh: ${N}×${N}=${vertCount} verts, ${indices.length/3} tris, extent=±${maxExtent}`);
    }

    // Horizon mesh removed - replaced by clipmap terrain system

    updateClipmapTerrain(cameraPosition) {
        if (!this._clipmapLevels || !this._terrainAxis) return;

        // Update shader uniforms every frame (pass planet mapping for spherical deformation)
        if (this.textureBlendingSystem && this.textureBlendingSystem.updateShaderUniforms) {
            this.textureBlendingSystem.updateShaderUniforms(cameraPosition, Date.now() * 0.001, this.planetMapping);
        }

        const mesh = this._clipmapLevels[0].mesh;
        const axis = this._terrainAxis;
        const N    = this._terrainN;

        // Snap camera to 4-tile grid to reduce update frequency and prevent hopping
        const snapX = Math.floor(cameraPosition.x / 4) * 4;
        const snapZ = Math.floor(cameraPosition.z / 4) * 4;
        const level = this._clipmapLevels[0];

        // Mesh always follows camera in XZ
        mesh.position.x = cameraPosition.x;
        mesh.position.z = cameraPosition.z;

        // Always update colors to ensure checkerboard pattern is visible
        // (removed snap check to force color updates)

        const posAttr = mesh.geometry.attributes.position;
        const colAttr = mesh.geometry.attributes.color;
        const positions = posAttr.array;
        const colors    = colAttr.array;

        for (let iz = 0; iz < N; iz++) {
            const lz = axis[iz];
            const worldZ = cameraPosition.z + lz;
            for (let ix = 0; ix < N; ix++) {
                const lx = axis[ix];
                const worldX = cameraPosition.x + lx;

                const height = this.getUnifiedTerrainHeight(worldX, worldZ);
                const idx = iz * N + ix;

                // Apply ripple effect to vertices below water level only
                const waterLevel = this.waterLevel || -1.5;
                let rippleHeight = height;
                if (height < waterLevel && this._windSpeed > 0) {
                    const time = Date.now() * 0.001;
                    const windSpeed = this._windSpeed;
                    const ripple = Math.sin(time * 2.0 * windSpeed + worldX * 0.3) *
                                   Math.cos(time * 1.5 * windSpeed + worldZ * 0.3) * 0.3 * windSpeed;
                    rippleHeight = height + ripple;
                }

                positions[idx * 3 + 1] = rippleHeight;

                const isLight = (Math.floor(worldX) + Math.floor(worldZ)) % 2 === 0;
                const tileColor = isLight ? this.lightTileColor : this.darkTileColor;
                colors[idx * 3]     = tileColor.r;
                colors[idx * 3 + 1] = tileColor.g;
                colors[idx * 3 + 2] = tileColor.b;
            }
        }

        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();

        // Update water plane to follow camera and respect water level
        if (this._waterPlane) {
            this._waterPlane.position.x = cameraPosition.x;
            this._waterPlane.position.z = cameraPosition.z;
            this._waterPlane.position.y = this.waterLevel;

            // Animate water texture scrolling based on wind direction and speed
            if (this._waterPlane.material.map) {
                const scrollAmount = this._windSpeed * 0.001;
                this._waterTextureOffset.x -= this._windDirection.x * scrollAmount;
                this._waterTextureOffset.y -= this._windDirection.y * scrollAmount;
                this._waterPlane.material.map.offset.copy(this._waterTextureOffset);
            }

            const terrainHeight = this.getTerrainHeight(cameraPosition.x, cameraPosition.z);
            const waterHeight = this.waterLevel;

            if (Math.floor(Date.now() / 1000) % 5 === 0) {
                console.log(`[WATER DEBUG] Camera: (${cameraPosition.x.toFixed(1)}, ${cameraPosition.z.toFixed(1)})`);
                console.log(`[WATER DEBUG] Water height: ${waterHeight}, Terrain height: ${terrainHeight.toFixed(2)}`);
                console.log(`[WATER DEBUG] Water visible: ${waterHeight > terrainHeight}`);
                console.log(`[WATER DEBUG] Water plane position: (${this._waterPlane.position.x.toFixed(1)}, ${this._waterPlane.position.y.toFixed(1)}, ${this._waterPlane.position.z.toFixed(1)})`);
            }
        }
    }

    updateMouseWorldPosition(camera) {



        // Get raycaster from mouse position



        const raycaster = new THREE.Raycaster();



        raycaster.setFromCamera(



            new THREE.Vector2(



                (this.currentMouseX / window.innerWidth) * 2 - 1,



                -(this.currentMouseY / window.innerHeight) * 2 + 1



            ),



            camera



        );



        



        // Use continuous mesh for intersection if available, otherwise fall back to chunks
        const boardMeshes = [];
        
        if (this.continuousMesh) {
            boardMeshes.push(this.continuousMesh);
        } else {
            // Fallback to chunk system
            for (const [chunkKey, chunk] of this.chunks) {
                if (chunk.mesh) {
                    boardMeshes.push(chunk.mesh);
                }
            }
        }
        
        if (this.useViewportMesh) {
            // Viewport mesh: use abstracted ray-plane intersection (no mesh dependency)
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersection = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
                this.mouseWorldPosition.copy(intersection);
            }
            return;
        }

        // Intersect with board meshes
        const intersects = raycaster.intersectObjects(boardMeshes);

        if (intersects.length > 0) {
            // Use the first intersection point with board geometry
            this.mouseWorldPosition.copy(intersects[0].point);
        } else {
            // Fallback to ground plane if no board intersection
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersection = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, intersection);
            this.mouseWorldPosition.copy(intersection);
        }



    }



    updateStreaming(cameraPosition, camera = null) {
        // console.log(`[STREAMING ENTRY] camera=${camera ? 'YES' : 'NULL'}, cameraPosition=${cameraPosition.x.toFixed(2)},${cameraPosition.z.toFixed(2)}`);
        // DYNAMIC CONTINUOUS MESH SYSTEM
        if (this.continuousMesh) {
            // Update mouse position
            if (!camera) {
                camera = this.scene.children.find(child => child.isPerspectiveCamera);
            }
            if (camera) {
                this.updateMouseWorldPosition(camera);
            }

            if (this.useViewportMesh) {
                // Rolling terrain: update edge rows/cols when camera crosses thresholds
                if (this.rollingTerrain) {
                    this.rollingTerrain.update(cameraPosition);
                }
                // Keep shader uniforms fresh (seasonal colors, cursor, time)
                if (this.textureBlendingSystem) {
                    this.textureBlendingSystem.updateShaderUniforms(cameraPosition, Date.now() * 0.001, this.planetMapping);
                }
            } else {
                // Traditional mesh: only regenerate when camera moves far enough
                this.updateDynamicMesh(cameraPosition);

                // Update mesh colors based on mouse position
                if (this.needsFadeUpdate) {
                    this.updateContinuousMeshColors();
                    this.needsFadeUpdate = false;
                }
            }
            
            // Update sun system
            this.updateSunPosition(cameraPosition);
            
            return; // Skip all chunk processing
        }
        
        // Old chunk system (disabled when continuous mesh is active)
        const frameStartTime = performance.now();
        this.frameCount++;
        
        // Debug: Log camera position changes periodically (disabled to reduce spam)
        // if (this.frameCount % 60 === 0) { // Log every 60 frames (~1 second)
        //     console.log(`[CAMERA DEBUG] Position: x=${cameraPosition.x.toFixed(1)}, z=${cameraPosition.z.toFixed(1)}`);
        // }
        
        // Update camera velocity for prediction
        const currentTime = Date.now();
        const deltaTime = (currentTime - this.lastUpdateTime) / 1000;
        if (deltaTime > 0) {
            this.cameraVelocity = cameraPosition.clone().sub(this.lastCameraPosition).divideScalar(deltaTime);
            this.lastCameraPosition.copy(cameraPosition);
            this.lastUpdateTime = currentTime;
        }
        
        // Update mouse world position
        if (!camera) {
            camera = this.scene.children.find(child => child.isPerspectiveCamera);
        }
        if (camera) {
            this.updateMouseWorldPosition(camera);
        }
        
        // Get current camera chunk
        const cameraChunkX = Math.floor(cameraPosition.x / this.chunkSize);
        const cameraChunkZ = Math.floor(cameraPosition.z / this.chunkSize);
        
        // Check if camera moved to a new chunk
        if (cameraChunkX !== this.lastCameraChunk.x || cameraChunkZ !== this.lastCameraChunk.z) {
            this.lastCameraChunk = { x: cameraChunkX, z: cameraChunkZ };
            this.updateBoardChunks(cameraChunkX, cameraChunkZ);
        }
        
        // Process chunk update queue (limit per frame for performance)
        this.processChunkUpdateQueue();
        
        // Update fade states
        this.updateChunkFades(this.mouseWorldPosition, cameraChunkX, cameraChunkZ);
        
        // Update optimization system
        // if (this.frameCount % 120 === 0) { // Log every 2 seconds (disabled to reduce spam)
        //     console.log('[LOD DEBUG] Optimization update called - camera moved significantly');
        // }
        this.updateOptimization();
        
        // Force LOD refresh every few seconds to ensure chunks update properly
        if (this.frameCount % 300 === 0) { // Every 5 seconds
            // console.log('[LOD REFRESH] Forcing LOD refresh on all chunks');
            this.forceLODRefresh();
        }
        
        // Update performance stats
        this.optimization.stats.frameTime = performance.now() - frameStartTime;
        
        // Reset the update flag
        this.needsFadeUpdate = false;
    }

    updateBoardChunks(cameraChunkX, cameraChunkZ) {
        // DISABLED: viewport/continuous mesh handles all terrain rendering
        if (this.continuousMesh) return;

        // console.log(`[Board DEBUG] Updating board chunks around camera (${cameraChunkX}, ${cameraChunkZ})`);
        
        const streaming = this.optimization.streaming;
        const effectiveRenderDistance = this.renderDistance + streaming.preloadDistance;
        
        // Predict camera movement if enabled
        let predictedChunks = [];
        if (streaming.predictionEnabled && this.cameraVelocity.length() > 0.1) {
            const predictionTime = streaming.predictionDistance / Math.max(this.cameraVelocity.length(), 1);
            const predictedPosition = this.lastCameraPosition.clone().add(
                this.cameraVelocity.clone().multiplyScalar(predictionTime)
            );
            const predictedChunkX = Math.floor(predictedPosition.x / this.chunkSize);
            const predictedChunkZ = Math.floor(predictedPosition.z / this.chunkSize);
            
            // Add predicted chunks to load list
            for (let x = -1; x <= 1; x++) {
                for (let z = -1; z <= 1; z++) {
                    predictedChunks.push({
                        x: predictedChunkX + x,
                        z: predictedChunkZ + z,
                        priority: 0.5
                    });
                }
            }
        }
        
        // Load new chunks within render distance
        const chunksToLoad = [];
        for (let x = -effectiveRenderDistance; x <= effectiveRenderDistance; x++) {
            for (let z = -effectiveRenderDistance; z <= effectiveRenderDistance; z++) {
                const chunkX = cameraChunkX + x;
                const chunkZ = cameraChunkZ + z;
                const chunkKey = `${chunkX},${chunkZ}`;
                
                if (!this.chunks.has(chunkKey)) {
                    chunksToLoad.push({
                        x: chunkX,
                        z: chunkZ,
                        priority: 1.0 - (Math.abs(x) + Math.abs(z)) / (effectiveRenderDistance * 2)
                    });
                }
            }
        }
        
        // Combine and sort by priority
        const allChunksToLoad = [...chunksToLoad, ...predictedChunks]
            .sort((a, b) => b.priority - a.priority)
            .slice(0, streaming.maxChunksPerFrame);
        
        // Load highest priority chunks
        for (const chunk of allChunksToLoad) {
            if (!this.chunks.has(`${chunk.x},${chunk.z}`)) {
                this.createChunk(chunk.x, chunk.z);
            }
        }
        
        // Queue distant chunks for unloading with delay
        for (const [chunkKey, chunk] of this.chunks) {
            const distance = Math.max(
                Math.abs(chunk.x - cameraChunkX),
                Math.abs(chunk.z - cameraChunkZ)
            );
            
            if (distance > effectiveRenderDistance) {
                this.queueChunkUnload(chunkKey);
            }
        }
    }
    
    // Chunk management functions for streaming
    queueChunkUnload(chunkKey) {
        const streaming = this.optimization.streaming;
        
        // Schedule chunk for delayed unload
        setTimeout(() => {
            if (this.chunks.has(chunkKey)) {
                const chunk = this.chunks.get(chunkKey);
                const cameraChunkX = Math.floor(this.lastCameraPosition.x / this.chunkSize);
                const cameraChunkZ = Math.floor(this.lastCameraPosition.z / this.chunkSize);
                
                const distance = Math.max(
                    Math.abs(chunk.x - cameraChunkX),
                    Math.abs(chunk.z - cameraChunkZ)
                );
                
                // Double-check distance before unloading
                if (distance > this.renderDistance + streaming.preloadDistance) {
                    this.unloadChunk(chunkKey);
                }
            }
        }, streaming.unloadDelay);
    }
    
    processChunkUpdateQueue() {
        const maxChunks = this.optimization.streaming.maxChunksPerFrame;
        this.processedChunksThisFrame = 0;
        
        // Process chunks in update queue
        for (const chunkKey of this.chunkUpdateQueue) {
            if (this.processedChunksThisFrame >= maxChunks) {
                break;
            }
            
            const chunk = this.chunks.get(chunkKey);
            if (chunk && chunk.needsUpdate) {
                this.updateChunkGeometry(chunk, this.terrainSystem);
                chunk.needsUpdate = false;
                this.processedChunksThisFrame++;
            }
            
            this.chunkUpdateQueue.delete(chunkKey);
        }
    }
    
    unloadChunk(chunkKey) {
        const chunk = this.chunks.get(chunkKey);

        if (chunk) {
            // Remove chunk immediately - no fade-out needed
            this.scene.remove(chunk.mesh);
            this.chunks.delete(chunkKey);
        }
    }


    // Removed removeFullyFadedChunks - no longer using fade states



    



    async createChunk(chunkX, chunkZ) {
        // DISABLED: viewport/continuous mesh handles all terrain rendering
        if (this.continuousMesh) return;

        const chunkKey = `${chunkX},${chunkZ}`;

        // console.log(`[Board DEBUG] Creating chunk ${chunkKey}`);

        if (this.chunks.has(chunkKey)) {



            // console.log(`[Board DEBUG] Chunk ${chunkKey} already exists, skipping`);



            return;



        }



        



        // Calculate distance from camera to determine appropriate LOD
        const chunkCenter = new THREE.Vector3(
            (chunkX * this.chunkSize) + this.chunkSize/2,
            0,
            (chunkZ * this.chunkSize) + this.chunkSize/2
        );
        const distance = chunkCenter.distanceTo(this.lastCameraPosition);
        const lodLevel = this.getLODLevel({ chunkCenter });
        
        // console.log(`[CHUNK SPAWN] Creating chunk ${chunkKey} at distance ${distance.toFixed(2)} with LOD: ${lodLevel.name} (tileSize: ${lodLevel.tileSize})`);
        // console.log(`[CHUNK SPAWN] LOD thresholds: High(≤40), Medium(≤80), Low(≤160), VeryLow(≤240)`);
        
        // Create unified mesh for this chunk with appropriate LOD
        const geometry = this.createChunkGeometry(chunkX, chunkZ, lodLevel.tileSize);
        
        const material = this.boardMaterial.clone();
        material.opacity = 1.0; // Fully visible

        // console.log(`[Board DEBUG] Material cloned for chunk ${chunkKey}`);



        // console.log(`[Board DEBUG] Material properties:`, {
        //     vertexColors: material.vertexColors,
        //     map: material.map,
        //     opacity: material.opacity,
        //     transparent: material.transparent
        // });



        



        material.opacity = 1.0; // Start fully visible - no fade-in needed



        const mesh = new THREE.Mesh(geometry, material);



        // console.log(`[Board DEBUG] Mesh created for chunk ${chunkKey}`);



        



        mesh.position.set(



            chunkX * this.chunkSize,



            0,



            chunkZ * this.chunkSize



        );



        



        mesh.receiveShadow = true;



        mesh.castShadow = false;



        



        // console.log(`[Board DEBUG] Adding mesh to scene at position:`, mesh.position);



        this.scene.add(mesh);



        // console.log(`[Board DEBUG] Mesh added to scene`);



        



        // Initialize fade state with distance-based fade



        // chunkCenter already calculated above



        


        // Store chunk data



        this.chunks.set(chunkKey, {

            mesh: mesh,



            x: chunkX,



            z: chunkZ,



            geometry: geometry,



            chunkCenter: chunkCenter,



            currentLOD: lodLevel.name,



            lastOptimized: Date.now()



        });
    }
    
    createChunkGeometry(chunkX, chunkZ, tileSize = null) {
        // console.log(`[Board DEBUG] Creating chunk geometry at (${chunkX}, ${chunkZ})${tileSize ? ` with tileSize: ${tileSize}` : ''}`);
        
        // Check if adaptive mesh optimization should be applied
        var chunkCenter = new THREE.Vector3(
            (chunkX * this.chunkSize) + this.chunkSize/2,
            0,
            (chunkZ * this.chunkSize) + this.chunkSize/2
        );
        
        var distanceFromCamera = this.lastCameraPosition.distanceTo(chunkCenter);
        var adaptiveMesh = this.optimization.adaptiveMesh;
        
        // If tileSize is specified, use standard geometry with that tile size
        if (tileSize !== null) {
            return this.createStandardChunkGeometry(chunkX, chunkZ, tileSize);
        }
        
        // Use adaptive mesh if enabled and beyond aggregation distance
        if (adaptiveMesh.enabled && distanceFromCamera > adaptiveMesh.aggregationDistance) {
            return this.createAdaptiveChunkGeometry(chunkX, chunkZ, distanceFromCamera);
        }
        
        // Use standard geometry for near chunks
        return this.createStandardChunkGeometry(chunkX, chunkZ);
    }
    
    // Function to get LOD level of adjacent chunk
    getAdjacentChunkLOD(chunkX, chunkZ, direction) {
        const adjacentKey = this.getAdjacentChunkKey(chunkX, chunkZ, direction);
        if (!adjacentKey) return null;
        
        const adjacentChunk = this.chunks.get(adjacentKey);
        if (!adjacentChunk) return null;
        
        return adjacentChunk.currentLOD || 'high';
    }
    
    // Function to get adjacent chunk key
    getAdjacentChunkKey(chunkX, chunkZ, direction) {
        switch(direction) {
            case 'north': return `${chunkX},${chunkZ + 1}`;
            case 'south': return `${chunkX},${chunkZ - 1}`;
            case 'east': return `${chunkX + 1},${chunkZ}`;
            case 'west': return `${chunkX - 1},${chunkZ}`;
            default: return null;
        }
    }
    
    // Function to get terrain height with LOD consideration - improved bidirectional matching
    getHeightWithLOD(worldX, worldZ, currentTileSize, chunkX, chunkZ) {
        // Basic call tracking (limited to avoid spam)
        if (Math.random() < 0.001) { // Log 0.1% of calls
            console.log(`[HEIGHT CALL] getHeightWithLOD called at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) for chunk (${chunkX},${chunkZ})`);
        }
        
        // Prevent infinite recursion
        if (this._heightRecursionDepth && this._heightRecursionDepth > 3) {
            return this.terrainSystem ? this.terrainSystem.getHeight(worldX, worldZ) : 0;
        }
        
        this._heightRecursionDepth = (this._heightRecursionDepth || 0) + 1;
        
        const originalHeight = this.terrainSystem ? this.terrainSystem.getHeight(worldX, worldZ) : 0;
        let adjustedHeight = originalHeight;
        
        const chunkLocalX = worldX - (chunkX * this.chunkSize);
        const chunkLocalZ = worldZ - (chunkZ * this.chunkSize);
        const currentChunkLOD = this.getChunkLODByName(chunkX, chunkZ);
        
        // Debug LOD levels and camera distance (disabled for performance)
        // if (Math.random() < 0.01) { // Log 1% of calls
        //     const cameraPos = this.camera ? this.camera.position : { x: 0, z: 0 };
        //     const chunkCenterX = chunkX * this.chunkSize + this.chunkSize / 2;
        //     const chunkCenterZ = chunkZ * this.chunkSize + this.chunkSize / 2;
        //     const distance = Math.sqrt(Math.pow(chunkCenterX - cameraPos.x, 2) + Math.pow(chunkCenterZ - cameraPos.z, 2));
        //     console.log(`[LOD DEBUG] Chunk (${chunkX},${chunkZ}) has LOD: ${currentChunkLOD} at distance ${distance.toFixed(1)}, pos (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
        // }
        
        // Check all borders for LOD mismatches and adjust heights accordingly
        // Use a small epsilon to ensure we catch edge vertices
        const borderEpsilon = 0.1;
        const borderChecks = [
            { direction: 'north', localCoord: chunkLocalZ, threshold: this.chunkSize - currentTileSize, worldCoord: worldZ, adjacentWorldCoord: chunkZ * this.chunkSize + this.chunkSize, isZ: true },
            { direction: 'south', localCoord: chunkLocalZ, threshold: currentTileSize, worldCoord: worldZ, adjacentWorldCoord: chunkZ * this.chunkSize, isZ: true },
            { direction: 'east', localCoord: chunkLocalX, threshold: this.chunkSize - currentTileSize, worldCoord: worldX, adjacentWorldCoord: chunkX * this.chunkSize + this.chunkSize, isZ: false },
            { direction: 'west', localCoord: chunkLocalX, threshold: currentTileSize, worldCoord: worldX, adjacentWorldCoord: chunkX * this.chunkSize, isZ: false }
        ];
        
        for (const check of borderChecks) {
            // More precise border detection - check if vertex is on or very close to the border
            const isOnBorder = check.isZ ? 
                (check.direction === 'north' ? check.localCoord >= check.threshold - borderEpsilon : check.localCoord <= check.threshold + borderEpsilon) :
                (check.direction === 'east' ? check.localCoord >= check.threshold - borderEpsilon : check.localCoord <= check.threshold + borderEpsilon);
            
            if (isOnBorder) {
                const adjacentLOD = this.getAdjacentChunkLOD(chunkX, chunkZ, check.direction);
                // Debug logging for border detection (disabled for performance)
                // console.log(`[BORDER DETECT] ${check.direction.toUpperCase()} border at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) - currentLOD: ${currentChunkLOD}, adjacentLOD: ${adjacentLOD}`);
                
                if (adjacentLOD && adjacentLOD !== currentChunkLOD) {
                    // Calculate the height that would create a seamless transition
                    const seamlessHeight = this.calculateSeamlessHeight(
                        worldX, worldZ, 
                        currentTileSize, currentChunkLOD,
                        adjacentLOD, check.direction,
                        check.adjacentWorldCoord, check.isZ
                    );
                    
                    if (seamlessHeight !== null) {
                        adjustedHeight = seamlessHeight;
                        
                        // Debug logging for border matching (disabled for performance)
                        // console.log(`[SEAMLESS LOD] ${check.direction.toUpperCase()} border: Chunk (${chunkX},${chunkZ}) [${currentChunkLOD}] matching adjacent [${adjacentLOD}] at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) height: ${originalHeight.toFixed(2)} -> ${adjustedHeight.toFixed(2)}`);
                        break; // Only apply one border adjustment per vertex
                    }
                }
            }
        }
        
        // Reset recursion depth before returning
        this._heightRecursionDepth = Math.max(0, (this._heightRecursionDepth || 0) - 1);
        
        return adjustedHeight;
    }
    
    // Helper function to get current chunk's LOD level
    getChunkLODByName(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunk = this.chunks.get(chunkKey);
        return chunk ? (chunk.currentLOD || 'high') : 'high';
    }
    
    // Calculate seamless height between different LOD levels
    calculateSeamlessHeight(worldX, worldZ, currentTileSize, currentLOD, adjacentLOD, direction, adjacentWorldCoord, isZ) {
        // Prevent infinite recursion
        if (this._seamlessRecursionDepth && this._seamlessRecursionDepth > 3) {
            return this.terrainSystem ? this.terrainSystem.getHeight(worldX, worldZ) : null;
        }
        
        this._seamlessRecursionDepth = (this._seamlessRecursionDepth || 0) + 1;
        
        if (!this.terrainSystem) {
            this._seamlessRecursionDepth = Math.max(0, (this._seamlessRecursionDepth || 0) - 1);
            return null;
        }
        
        // Get the base terrain heights
        const currentHeight = this.terrainSystem.getHeight(worldX, worldZ);
        
        // If adjacent chunk is higher detail, match its exact height
        if (adjacentDetailLevel > currentDetailLevel) {
            const adjacentHeight = isZ ? 
                this.terrainSystem.getHeight(worldX, adjacentWorldCoord) :
                this.terrainSystem.getHeight(adjacentWorldCoord, worldZ);
            
            // Check for ANY height differences and apply ultra-aggressive elimination
            const heightDiff = Math.abs(adjacentHeight - currentHeight);
            if (heightDiff > 0.1) {
                // ANY gap - use 100% direct matching to completely eliminate visual artifacts
                // Debug logging for gap elimination
                if (heightDiff > 1.0 || Math.random() < 0.2) {
                    console.log(`[GAP MATCH ELIMINATED] current=${currentHeight.toFixed(2)}, adjacent=${adjacentHeight.toFixed(2)}, diff=${heightDiff.toFixed(2)} [100% direct match]`);
                }
                
                // Reset recursion depth before returning
                this._seamlessRecursionDepth = Math.max(0, (this._seamlessRecursionDepth || 0) - 1);
                
                return adjacentHeight;
            }
            
            // Reset recursion depth before returning
            this._seamlessRecursionDepth = Math.max(0, (this._seamlessRecursionDepth || 0) - 1);
            
            return adjacentHeight;
        }
        
        // If current chunk is higher detail, we need to interpolate to match the lower detail
        if (currentDetailLevel > adjacentDetailLevel) {
            const adjacentTileSize = this.getTileSizeForLOD(adjacentLOD);
            const currentTileSizeValue = this.getTileSizeForLOD(currentLOD);
            
            // Debug logging for interpolation start (limited sampling)
            if (Math.random() < 0.1) { // Only log 10% to reduce spam
                console.log(`[INTERPOLATE] High-res [${currentLOD}] to low-res [${adjacentLOD}] at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
            }
            
            // Calculate the interpolated height where the removed vertex would have been
            // This is the midpoint between the two adjacent edge vertices in the low-res chunk
            let interpolatedHeight;
            
            if (isZ) {
                // North/South border - interpolate between two points along X
                // We need to find the vertices in the adjacent chunk that border this vertex
                const adjacentChunkX = Math.floor(adjacentWorldCoord / this.chunkSize);
                const adjacentChunkZ = Math.floor(adjacentWorldCoord / this.chunkSize);
                
                // Calculate the X position within the adjacent chunk's coordinate system
                const adjacentLocalX = worldX - (adjacentChunkX * this.chunkSize);
                
                // Find the two vertices in the adjacent chunk that border this point
                const vertexX1 = Math.floor(adjacentLocalX / adjacentTileSize) * adjacentTileSize;
                const vertexX2 = vertexX1 + adjacentTileSize;
                
                // Convert back to world coordinates
                const worldX1 = adjacentChunkX * this.chunkSize + vertexX1;
                const worldX2 = adjacentChunkX * this.chunkSize + vertexX2;
                
                // Get heights at the two adjacent edge vertices using the adjacent chunk's LOD
                const height1 = this.getHeightWithLOD(worldX1, adjacentWorldCoord, adjacentTileSize, adjacentChunkX, adjacentChunkZ);
                const height2 = this.getHeightWithLOD(worldX2, adjacentWorldCoord, adjacentTileSize, adjacentChunkX, adjacentChunkZ);
                
                // Calculate interpolation factor based on position between the two vertices
                const t = (worldX - worldX1) / adjacentTileSize;
                
                // Linear interpolation between the two heights
                interpolatedHeight = height1 + (height2 - height1) * t;
                
                // Debug logging for interpolation (disabled for performance)
                // console.log(`[INTERPOLATE] ${direction.toUpperCase()}: heights[${height1.toFixed(2)}, ${height2.toFixed(2)}] at x[${worldX1.toFixed(1)}, ${worldX2.toFixed(1)}], t=${t.toFixed(2)}, result=${interpolatedHeight.toFixed(2)}`);
                // console.log(`[INTERPOLATE DETAIL] Original: ${currentHeight.toFixed(2)}, Adjacent chunk: (${adjacentChunkX},${adjacentChunkZ}), World pos: (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
            } else {
                // East/West border - interpolate between two points along Z
                // We need to find the vertices in the adjacent chunk that border this vertex
                const adjacentChunkX = Math.floor(adjacentWorldCoord / this.chunkSize);
                const adjacentChunkZ = Math.floor(adjacentWorldCoord / this.chunkSize);
                
                // Calculate the Z position within the adjacent chunk's coordinate system
                const adjacentLocalZ = worldZ - (adjacentChunkZ * this.chunkSize);
                
                // Find the two vertices in the adjacent chunk that border this point
                const vertexZ1 = Math.floor(adjacentLocalZ / adjacentTileSize) * adjacentTileSize;
                const vertexZ2 = vertexZ1 + adjacentTileSize;
                
                // Convert back to world coordinates
                const worldZ1 = adjacentChunkZ * this.chunkSize + vertexZ1;
                const worldZ2 = adjacentChunkZ * this.chunkSize + vertexZ2;
                
                // Get heights at the two adjacent edge vertices using the adjacent chunk's LOD
                const height1 = this.getHeightWithLOD(adjacentWorldCoord, worldZ1, adjacentTileSize, adjacentChunkX, adjacentChunkZ);
                const height2 = this.getHeightWithLOD(adjacentWorldCoord, worldZ2, adjacentTileSize, adjacentChunkX, adjacentChunkZ);
                
                // Calculate interpolation factor based on position between the two vertices
                const t = (worldZ - worldZ1) / adjacentTileSize;
                
                // Linear interpolation between the two heights
                interpolatedHeight = height1 + (height2 - height1) * t;
                
                // Debug logging for interpolation (disabled for performance)
                // console.log(`[INTERPOLATE] ${direction.toUpperCase()}: heights[${height1.toFixed(2)}, ${height2.toFixed(2)}] at z[${worldZ1.toFixed(1)}, ${worldZ2.toFixed(1)}], t=${t.toFixed(2)}, result=${interpolatedHeight.toFixed(2)}`);
                // console.log(`[INTERPOLATE DETAIL] Original: ${currentHeight.toFixed(2)}, Adjacent chunk: (${adjacentChunkX},${adjacentChunkZ}), World pos: (${worldX.toFixed(1)}, ${worldZ.toFixed(1)})`);
            }
            
            // Calculate height difference to determine interpolation aggressiveness
            const heightDiff = Math.abs(interpolatedHeight - currentHeight);
            
            // ULTRA-AGGRESSIVE gap elimination - eliminate ALL visible gaps
            let finalHeight;
            if (heightDiff > 0.1) {
                // ANY gap - use 100% interpolation to completely eliminate visual artifacts
                finalHeight = interpolatedHeight;
                
                // Debug logging for gap elimination
                if (heightDiff > 1.0 || Math.random() < 0.2) {
                    console.log(`[GAP ELIMINATED] current=${currentHeight.toFixed(2)}, interpolated=${interpolatedHeight.toFixed(2)}, diff=${heightDiff.toFixed(2)}, final=${finalHeight.toFixed(2)} [100% interpolation]`);
                }
            } else {
                // Very small difference - use normal blend factor
                const blendFactor = this.getBorderBlendFactor(worldX, worldZ, currentTileSize, direction);
                finalHeight = currentHeight * (1 - blendFactor) + interpolatedHeight * blendFactor;
            }
            
            // Debug logging for ultra-aggressive gap elimination (limited sampling)
            if (Math.abs(finalHeight - currentHeight) > 0.1) { // Log any height changes
                const method = heightDiff > 0.1 ? "100% interpolation" : "normal blend";
                console.log(`[ULTRA AGGRESSIVE] current=${currentHeight.toFixed(2)}, interpolated=${interpolatedHeight.toFixed(2)}, final=${finalHeight.toFixed(2)}, diff=${heightDiff.toFixed(2)}, method=${method}`);
            }
            
            // Reset recursion depth before returning
            this._seamlessRecursionDepth = Math.max(0, (this._seamlessRecursionDepth || 0) - 1);
            
            return finalHeight;
        }
        
        // Reset recursion depth before returning
        this._seamlessRecursionDepth = Math.max(0, (this._seamlessRecursionDepth || 0) - 1);
        
        return currentHeight;
    }
    
    // Get detail level ranking (higher = more detailed)
    getLODDetailLevel(lodName) {
        const levels = { 'verylow': 1, 'low': 2, 'medium': 3, 'high': 4 };
        return levels[lodName] || 4;
    }
    
    // Get tile size for LOD level
    getTileSizeForLOD(lodName) {
        const sizes = { 'verylow': 8, 'low': 4, 'medium': 2, 'high': 1 };
        return sizes[lodName] || 1;
    }
    
    // Calculate blend factor for smooth transitions at borders
    getBorderBlendFactor(worldX, worldZ, tileSize, direction) {
        const localCoord = (direction === 'north' || direction === 'south') ? 
            (worldZ % this.chunkSize) : (worldX % this.chunkSize);
        
        const borderDistance = (direction === 'north' || direction === 'east') ?
            this.chunkSize - localCoord : localCoord;
        
        // For seamless transitions, we want full blending at the border itself
        // Use a fixed blend range that ensures smooth transitions regardless of tile size
        const blendRange = Math.max(tileSize * 2, 4);
        
        // Calculate blend factor: 1.0 at border, 0.0 at blendRange distance
        let blendFactor = 1.0 - (borderDistance / blendRange);
        
        // Clamp between 0.0 and 1.0 to prevent extreme values
        blendFactor = Math.max(0.0, Math.min(1.0, blendFactor));
        
        return blendFactor;
    }
    
    // SMART BORDER INTERPOLATION - Handle vertex density mismatches between chunks
    getBorderLockedHeight(worldX, worldZ, chunkX, chunkZ, tileX, tileZ, tilesPerChunk) {
        // Check if this vertex is on any border of the chunk
        const isBorder = (tileX === 0 || tileX === tilesPerChunk || tileZ === 0 || tileZ === tilesPerChunk);
        
        if (isBorder) {
            // BORDER VERTEX: Use smart interpolation to match adjacent chunks
            return this.getSmartBorderHeight(worldX, worldZ, chunkX, chunkZ, tileX, tileZ, tilesPerChunk);
        } else {
            // INTERNAL VERTEX: Use unified height source
            return this.getUnifiedTerrainHeight(worldX, worldZ);
        }
    }
    
    // Smart border height calculation that handles vertex density mismatches
    getSmartBorderHeight(worldX, worldZ, chunkX, chunkZ, tileX, tileZ, tilesPerChunk) {
        if (!this.terrainSystem) {
            console.warn('[SMART BORDER] No terrain system available');
            return 0;
        }
        
        // Get current chunk's LOD level - create temporary chunk data for getLODLevel
        const tempChunkData = {
            chunkCenter: new THREE.Vector3(
                chunkX * this.chunkSize + this.chunkSize/2,
                0,
                chunkZ * this.chunkSize + this.chunkSize/2
            )
        };
        const currentLOD = this.getLODLevel(tempChunkData).name;
        const currentDetail = this.getLODDetailLevel(currentLOD);
        
        // Check each direction for adjacent chunks
        const directions = [
            { name: 'north', dx: 0, dz: -1, isBorder: tileZ === 0 },
            { name: 'south', dx: 0, dz: 1, isBorder: tileZ === tilesPerChunk },
            { name: 'west', dx: -1, dz: 0, isBorder: tileX === 0 },
            { name: 'east', dx: 1, dz: 0, isBorder: tileX === tilesPerChunk }
        ];
        
        for (const dir of directions) {
            if (!dir.isBorder) continue;
            
            const adjacentChunkX = chunkX + dir.dx;
            const adjacentChunkZ = chunkZ + dir.dz;
            
            // Create temporary chunk data for adjacent chunk
            const adjacentChunkData = {
                chunkCenter: new THREE.Vector3(
                    adjacentChunkX * this.chunkSize + this.chunkSize/2,
                    0,
                    adjacentChunkZ * this.chunkSize + this.chunkSize/2
                )
            };
            const adjacentLOD = this.getLODLevel(adjacentChunkData).name;
            const adjacentDetail = this.getLODDetailLevel(adjacentLOD);
            
            // If adjacent chunk has higher detail, interpolate to match it
            if (adjacentDetail > currentDetail) {
                const interpolatedHeight = this.interpolateToAdjacentChunk(
                    worldX, worldZ, adjacentChunkX, adjacentChunkZ, 
                    currentDetail, adjacentDetail, dir.name
                );
                
                if (interpolatedHeight !== null) {
                    if (Math.random() < 0.01) { // Debug logging
                        console.log(`[SMART BORDER] ${dir.name}: (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) = ${interpolatedHeight.toFixed(2)} [interpolated to higher detail]`);
                    }
                    return interpolatedHeight;
                }
            }
        }
        
        // Default: use base terrain height
        const baseHeight = this.terrainSystem.getHeight(worldX, worldZ);
        if (Math.random() < 0.005) { // Debug logging
            console.log(`[SMART BORDER] default: (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) = ${baseHeight.toFixed(2)} [no interpolation needed]`);
        }
        return baseHeight;
    }
    
    // Interpolate height to match higher detail adjacent chunk
    interpolateToAdjacentChunk(worldX, worldZ, adjacentChunkX, adjacentChunkZ, currentDetail, adjacentDetail, direction) {
        // Calculate the detail ratio
        const detailRatio = adjacentDetail / currentDetail;
        
        if (detailRatio <= 1) return null; // No interpolation needed
        
        // Get the chunk boundaries
        const chunkSize = this.chunkSize;
        let adjacentWorldX, adjacentWorldZ;
        
        // Calculate the corresponding position in the adjacent chunk
        if (direction === 'north') {
            adjacentWorldX = worldX;
            adjacentWorldZ = adjacentChunkZ * chunkSize;
        } else if (direction === 'south') {
            adjacentWorldX = worldX;
            adjacentWorldZ = adjacentChunkZ * chunkSize;
        } else if (direction === 'west') {
            adjacentWorldX = adjacentChunkX * chunkSize;
            adjacentWorldZ = worldZ;
        } else if (direction === 'east') {
            adjacentWorldX = adjacentChunkX * chunkSize;
            adjacentWorldZ = worldZ;
        }
        
        // For higher detail chunks, we need to sample multiple points and interpolate
        if (detailRatio > 1) {
            // Sample the higher detail chunk at multiple points
            const sampleSize = Math.min(detailRatio, 4); // Limit sampling
            let totalHeight = 0;
            let sampleCount = 0;
            
            for (let i = 0; i < sampleSize; i++) {
                for (let j = 0; j < sampleSize; j++) {
                    const sampleX = adjacentWorldX + (i * chunkSize / sampleSize / sampleSize);
                    const sampleZ = adjacentWorldZ + (j * chunkSize / sampleSize / sampleSize);
                    const sampleHeight = this.terrainSystem.getHeight(sampleX, sampleZ);
                    totalHeight += sampleHeight;
                    sampleCount++;
                }
            }
            
            if (sampleCount > 0) {
                return totalHeight / sampleCount; // Return averaged height
            }
        }
        
        // Fallback: direct height lookup
        return this.terrainSystem.getHeight(adjacentWorldX, adjacentWorldZ);
    }
    
    // CONTINUOUS MESH METHOD - Create one big mesh deformed by terrain data (NO GAPS!)
    createContinuousMesh() {
        console.log('[CONTINUOUS MESH] Creating single continuous mesh for entire board');
        
        // Define the board area (based on current chunk system range)
        const boardSize = this.chunkSize * 10; // 10x10 chunks area
        const resolution = 1; // 1 unit per vertex for high detail
        const verticesX = Math.floor(boardSize / resolution);
        const verticesZ = Math.floor(boardSize / resolution);
        
        console.log(`[CONTINUOUS MESH] Board size: ${boardSize}x${boardSize}, Resolution: ${resolution}, Vertices: ${verticesX}x${verticesZ}`);
        
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const colors = [];
        const indices = [];
        const normals = [];
        const uvs = [];
        
        // Generate vertices and deform with terrain data
        for (var x = 0; x < verticesX; x++) {
            for (var z = 0; z < verticesZ; z++) {
                var worldX = -boardSize/2 + (x * resolution);
                var worldZ = -boardSize/2 + (z * resolution);
                
                // Get terrain height at this position
                var height = this.getUnifiedTerrainHeight(worldX, worldZ);
                
                // Add vertex
                vertices.push(worldX, height, worldZ);
                
                // Calculate normal (simplified - could be improved with proper terrain gradient)
                normals.push(0, 1, 0);
                
                // UV coordinates - use world position for seamless tiling across entire mesh
                uvs.push(worldX * 0.5, worldZ * 0.5);
                
                // White vertex colors to allow dynamic lighting to work
                const grassColor = { r: 1.0, g: 1.0, b: 1.0 };
                colors.push(grassColor.r, grassColor.g, grassColor.b);
            }
        }
        
        // Generate indices for triangles
        for (var x = 0; x < verticesX - 1; x++) {
            for (var z = 0; z < verticesZ - 1; z++) {
                var i = x * verticesZ + z;

                // Two triangles per quad
                indices.push(i, i + 1, i + verticesZ);
                indices.push(i + 1, i + verticesZ + 1, i + verticesZ);
            }
        }

        // Set geometry attributes
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        // Use Three.js built-in normal computation
        geometry.computeVertexNormals();

        // Create mesh with grass texture
        const material = new THREE.MeshStandardMaterial({
            vertexColors: false,  // Disable vertex colors for better lighting
            // Using dynamic shader instead of static texture  // Re-enable texture now that lighting works
            side: THREE.DoubleSide,
            roughness: 0.8,
            metalness: 0.0
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'continuousBoardMesh';
        mesh.receiveShadow = true;  // Enable receiving light/shadows
        mesh.castShadow = true;      // Enable casting shadows on itself
        
        console.log(`[CONTINUOUS MESH] Created mesh with ${vertices.length/3} vertices, ${indices.length/3} triangles`);
        
        return mesh;
    }
    
    // UNIFIED TERRAIN HEIGHT METHOD - Bypass all LOD calculations for gap-free terrain
    getUnifiedTerrainHeight(worldX, worldZ) {
        // Direct access to terrain system without any LOD modifications
        if (!this.terrainSystem) {
            return 0;
        }

        const baseHeight = this.terrainSystem.getHeight(worldX, worldZ);

        return baseHeight;
    }

    // Get terrain normal at a position including ripple effects
    getTerrainNormal(worldX, worldZ) {
        if (!this.terrainSystem) {
            return new THREE.Vector3(0, 1, 0);
        }

        const delta = 0.1; // Small offset for gradient calculation

        // Get heights at neighboring points including ripple
        const h = this.getHeightWithRipple(worldX, worldZ);
        const hx = this.getHeightWithRipple(worldX + delta, worldZ);
        const hz = this.getHeightWithRipple(worldX, worldZ + delta);

        // Calculate gradient
        const dx = (hx - h) / delta;
        const dz = (hz - h) / delta;

        // Normal is perpendicular to gradient
        const normal = new THREE.Vector3(-dx, 1.0, -dz).normalize();

        return normal;
    }

    // Get height including ripple effect
    getHeightWithRipple(worldX, worldZ) {
        const baseHeight = this.getUnifiedTerrainHeight(worldX, worldZ);
        const waterLevel = this.waterLevel || -1.5;
        let finalHeight = baseHeight;

        // Apply ripple effect below water level only if wind speed > 0
        if (baseHeight < waterLevel && this._windSpeed > 0) {
            const time = Date.now() * 0.001;
            const windSpeed = this._windSpeed;
            const ripple = Math.sin(time * 2.0 * windSpeed + worldX * 0.3) *
                           Math.cos(time * 1.5 * windSpeed + worldZ * 0.3) * 0.3 * windSpeed;
            finalHeight = baseHeight + ripple;
        }

        return finalHeight;
    }

    // Shared wind field computation for tree systems
    computeTreeWindField(treeData, windFieldMap) {
        const waterLevel = this.waterLevel || -1.5;
        windFieldMap.clear();

        // Build a grid of tree counts for density calculation
        const densityGrid = new Map();
        for (const t of treeData) {
            const tx = Math.floor(t.x);
            const tz = Math.floor(t.z);
            const key = `${tx},${tz}`;
            densityGrid.set(key, (densityGrid.get(key) || 0) + 1);
        }

        // Compute wind multiplier for each tile that has a tree
        for (const t of treeData) {
            const tx = Math.floor(t.x);
            const tz = Math.floor(t.z);
            const key = `${tx},${tz}`;
            if (windFieldMap.has(key)) continue;

            let windMult = 1.0;

            // Surface smoothness: check height variance in 3x3 area
            let variance = 0;
            let sum = 0;
            let count = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const h = this.getUnifiedTerrainHeight(tx + dx, tz + dz);
                    if (isFinite(h)) {
                        sum += h;
                        count++;
                    }
                }
            }
            if (count > 0) {
                const avg = sum / count;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const h = this.getUnifiedTerrainHeight(tx + dx, tz + dz);
                        if (isFinite(h)) {
                            variance += (h - avg) ** 2;
                        }
                    }
                }
                const smoothness = 1.0 / (1.0 + variance * 2);
                windMult *= 0.7 + smoothness * 0.6;
            }

            // Water boost (extra smooth surface - more wind)
            const height = this.getUnifiedTerrainHeight(tx, tz);
            if (Math.abs(height - waterLevel) < 0.3) {
                windMult *= 2.0; // Increased from 1.4 for more wind over water
            }

            // Obstacle density (more trees upwind = less wind) - shelter effect
            // Only count trees that are upwind of this tree (would provide shelter)
            const windDirX = this._windDirection ? this._windDirection.x : 1;
            const windDirZ = this._windDirection ? this._windDirection.y : 0;
            let upwindCount = 0;
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const nKey = `${tx+dx},${tz+dz}`;
                    const count = densityGrid.get(nKey) || 0;
                    // Check if this position is upwind relative to current tree
                    // Dot product of offset with wind direction
                    const dot = dx * windDirX + dz * windDirZ;
                    if (dot > 0) {
                        // This position is downwind, not upwind - don't count
                        continue;
                    }
                    upwindCount += count;
                }
            }
            windMult *= Math.max(0.5, 1.0 - upwindCount * 0.05);

            // Elevation effect removed - too pronounced with dramatic height changes
            // windMult *= 1.0 + Math.max(0, height) * 0.008;

            // Clamp to reasonable range
            windMult = Math.max(0.3, Math.min(2.0, windMult));

            windFieldMap.set(key, windMult);
        }

        console.log('[Board] Wind field computed for', windFieldMap.size, 'tiles');
    }

    // Get terrain height directly from server API (for points outside mesh range)
    // This avoids loading entire chunks just to get a single height value
    async getServerTerrainHeight(worldX, worldZ) {
        // Round to integer coordinates for cache key
        const cacheKey = `${Math.floor(worldX)},${Math.floor(worldZ)}`;

        // Check cache first
        if (this._serverHeightCache.has(cacheKey)) {
            return this._serverHeightCache.get(cacheKey);
        }

        // Deduplicate in-flight requests
        if (this._pendingServerRequests.has(cacheKey)) {
            return this._pendingServerRequests.get(cacheKey);
        }

        const promise = (async () => {
            // Wait for a concurrency slot
            while (this._activeServerRequests >= this._maxConcurrentServerRequests) {
                await new Promise(r => setTimeout(r, 5));
            }
            this._activeServerRequests++;

            try {
                const response = await fetch(`/api/terrain/${Math.floor(worldX)}/${Math.floor(worldZ)}`);
                if (!response.ok) {
                    return 0;
                }
                const data = await response.json();
                const height = data.height || 0;

                // Cache the result
                if (this._serverHeightCache.size >= this._serverHeightCacheSize) {
                    const firstKey = this._serverHeightCache.keys().next().value;
                    this._serverHeightCache.delete(firstKey);
                }
                this._serverHeightCache.set(cacheKey, height);

                return height;
            } catch (error) {
                return 0;
            } finally {
                this._activeServerRequests--;
            }
        })();

        this._pendingServerRequests.set(cacheKey, promise);
        try {
            return await promise;
        } finally {
            this._pendingServerRequests.delete(cacheKey);
        }
    }

    // Get terrain height with automatic fallback to server API for distant points
    // Mesh range: ±96 units from camera (192x192 vertex grid)
    async getTerrainHeightWithFallback(worldX, worldZ, cameraPosition) {
        const meshExtent = 96; // ±96 units from camera

        // Check if point is within mesh vertex range
        const dx = Math.abs(worldX - cameraPosition.x);
        const dz = Math.abs(worldZ - cameraPosition.z);

        if (dx <= meshExtent && dz <= meshExtent) {
            // Within mesh range: use terrain system (chunks needed for mesh vertices)
            return this.getUnifiedTerrainHeight(worldX, worldZ);
        } else {
            // Outside mesh range: use square heights (4-corner sampling) for better accuracy
            return await this.getSquareHeights(worldX, worldZ);
        }
    }

    // Synchronous version for use in mesh creation (uses cached server heights)
    getTerrainHeightWithFallbackSync(worldX, worldZ, centerX, centerZ) {
        const meshExtent = 96; // ±96 units from center

        // Check if point is within mesh vertex range
        const dx = Math.abs(worldX - centerX);
        const dz = Math.abs(worldZ - centerZ);

        if (dx <= meshExtent && dz <= meshExtent) {
            // Within mesh range: use terrain system (chunks should be loaded)
            return this.getUnifiedTerrainHeight(worldX, worldZ);
        } else {
            // Outside mesh range: try cached server height first
            const cacheKey = `${Math.floor(worldX)},${Math.floor(worldZ)}`;
            if (this._serverHeightCache && this._serverHeightCache.has(cacheKey)) {
                return this._serverHeightCache.get(cacheKey);
            }
            // Fallback to terrain system (may return 0 if chunk not loaded)
            return this.getUnifiedTerrainHeight(worldX, worldZ);
        }
    }

    // Pre-populate server height cache for distant points before mesh creation
    async prepopulateDistantHeights(centerX, centerZ, meshSize) {
        const meshExtent = 96; // ±96 units from center
        const preloadDistance = meshSize / 2; // Full mesh extent
        
        const promises = [];
        
        // Iterate over points beyond mesh extent (96 units) up to mesh size
        const startX = Math.floor(centerX - preloadDistance);
        const endX = Math.floor(centerX + preloadDistance);
        const startZ = Math.floor(centerZ - preloadDistance);
        const endZ = Math.floor(centerZ + preloadDistance);
        
        for (let x = startX; x <= endX; x++) {
            for (let z = startZ; z <= endZ; z++) {
                const worldX = x;
                const worldZ = z;
                
                // Check if point is beyond mesh extent
                const dx = Math.abs(worldX - centerX);
                const dz = Math.abs(worldZ - centerZ);
                
                if (dx > meshExtent || dz > meshExtent) {
                    // This point is beyond the loaded chunk range, pre-fetch from server
                    const cacheKey = `${worldX},${worldZ}`;
                    if (!this._serverHeightCache.has(cacheKey)) {
                        promises.push(this.getServerTerrainHeight(worldX, worldZ));
                    }
                }
            }
        }
        
        // Wait for all server height queries to complete
        await Promise.all(promises);
    }

    // Get terrain height using 4-corner sampling (square heights) via server API
    // Samples heights at tile corners and bilinear interpolates between them
    async getSquareHeights(worldX, worldZ) {
        // Round down to get tile corner coordinates
        const tileX = Math.floor(worldX);
        const tileZ = Math.floor(worldZ);

        // Sample heights at 4 corners of the tile
        const [h00, h10, h01, h11] = await Promise.all([
            this.getServerTerrainHeight(tileX, tileZ),
            this.getServerTerrainHeight(tileX + 1, tileZ),
            this.getServerTerrainHeight(tileX, tileZ + 1),
            this.getServerTerrainHeight(tileX + 1, tileZ + 1)
        ]);

        // Calculate interpolation factors
        const fx = worldX - tileX;
        const fz = worldZ - tileZ;

        // Bilinear interpolation
        const h0 = h00 * (1 - fx) + h10 * fx;
        const h1 = h01 * (1 - fx) + h11 * fx;
        const result = h0 * (1 - fz) + h1 * fz;

        return result;
    }

    // Test square heights at a specific location (for console testing)
    async testSquareHeights(worldX, worldZ) {
        console.log(`\n=== TESTING SQUARE HEIGHTS AT (${worldX}, ${worldZ}) ===`);
        const height = await this.getSquareHeights(worldX, worldZ);
        console.log(`=== FINAL HEIGHT: ${height.toFixed(2)} ===\n`);
        return height;
    }
    
    // Debug function to test seamless LOD transitions with sample data
    debugSeamlessTransitions() {
        console.log('\n=== SEAMLESS LOD TRANSITION DEBUG ===');
        console.log('Testing height matching between chunks of different LOD levels...\n');
        
        // Find chunks with different LOD levels that are adjacent
        const testCases = this.findLODBorderTestCases();
        
        if (testCases.length === 0) {
            console.log('[SEAMLESS DEBUG] No LOD border test cases found - all chunks have same LOD');
            return;
        }
        
        console.log(`[SEAMLESS DEBUG] Found ${testCases.length} LOD border test cases:\n`);
        
        // Test each case
        testCases.forEach((testCase, index) => {
            console.log(`--- Test Case ${index + 1}: Chunk ${testCase.chunkKey} [${testCase.currentLOD}] adjacent to ${testCase.adjacentKey} [${testCase.adjacentLOD}] (${testCase.direction}) ---`);
            
            this.debugSingleBorderTransition(testCase);
            
            // Limit to first 3 test cases to avoid spam
            if (index >= 2) {
                console.log('... (showing first 3 test cases only)');
                return;
            }
        });
        
        console.log('\n=== END SEAMLESS LOD DEBUG ===\n');
    }
    
    // Find test cases where different LOD chunks are adjacent
    findLODBorderTestCases() {
        const testCases = [];
        const processedPairs = new Set();
        
        for (const [chunkKey, chunkData] of this.chunks) {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            const currentLOD = chunkData.currentLOD || 'high';
            
            // Check all 4 directions
            const directions = ['north', 'south', 'east', 'west'];
            for (const direction of directions) {
                const adjacentKey = this.getAdjacentChunkKey(chunkX, chunkZ, direction);
                if (!adjacentKey) continue;
                
                // Avoid duplicate checks
                const pairKey = [chunkKey, adjacentKey].sort().join('-');
                if (processedPairs.has(pairKey)) continue;
                processedPairs.add(pairKey);
                
                const adjacentChunk = this.chunks.get(adjacentKey);
                if (!adjacentChunk) continue;
                
                const adjacentLOD = adjacentChunk.currentLOD || 'high';
                
                // Only test cases with different LOD levels
                if (currentLOD !== adjacentLOD) {
                    testCases.push({
                        chunkKey,
                        chunkX,
                        chunkZ,
                        currentLOD,
                        adjacentKey,
                        adjacentLOD,
                        direction,
                        chunkData,
                        adjacentData: adjacentChunk
                    });
                }
            }
        }
        
        return testCases;
    }
    
    // Debug a single border transition in detail
    debugSingleBorderTransition(testCase) {
        const { chunkX, chunkZ, currentLOD, adjacentLOD, direction, chunkData, adjacentData } = testCase;
        
        console.log(`  Chunk positions: (${chunkX},${chunkZ}) -> ${this.getAdjacentChunkKey(chunkX, chunkZ, direction)}`);
        console.log(`  LOD levels: ${currentLOD} (detail: ${this.getLODDetailLevel(currentLOD)}) vs ${adjacentLOD} (detail: ${this.getLODDetailLevel(adjacentLOD)})`);
        
        // Get tile sizes
        const currentTileSize = this.getTileSizeForLOD(currentLOD);
        const adjacentTileSize = this.getTileSizeForLOD(adjacentLOD);
        console.log(`  Tile sizes: ${currentTileSize} vs ${adjacentTileSize}`);
        
        // Sample vertices along the border
        const borderSamples = this.getBorderSamplePoints(chunkX, chunkZ, direction, currentTileSize);
        console.log(`  Testing ${borderSamples.length} sample points along ${direction} border:`);
        
        borderSamples.forEach((sample, index) => {
            const originalHeight = this.terrainSystem ? this.terrainSystem.getHeight(sample.x, sample.z) : 0;
            const adjustedHeight = this.getHeightWithLOD(sample.x, sample.z, currentTileSize, chunkX, chunkZ);
            const heightDiff = Math.abs(adjustedHeight - originalHeight);
            
            // Also check what the adjacent chunk would have at this position
            let adjacentHeight = 'N/A';
            if (direction === 'north' || direction === 'south') {
                const adjZ = direction === 'north' ? chunkZ * this.chunkSize + this.chunkSize : chunkZ * this.chunkSize;
                adjacentHeight = this.terrainSystem ? this.terrainSystem.getHeight(sample.x, adjZ) : 0;
            } else {
                const adjX = direction === 'east' ? chunkX * this.chunkSize + this.chunkSize : chunkX * this.chunkSize;
                adjacentHeight = this.terrainSystem ? this.terrainSystem.getHeight(adjX, sample.z) : 0;
            }
            
            console.log(`    Sample ${index + 1}: (${sample.x.toFixed(1)}, ${sample.z.toFixed(1)})`);
            console.log(`      Original height: ${originalHeight.toFixed(3)}`);
            console.log(`      Adjusted height: ${adjustedHeight.toFixed(3)} (diff: ${heightDiff.toFixed(3)})`);
            console.log(`      Adjacent height: ${adjacentHeight.toFixed(3)}`);
            console.log(`      Border distance: ${sample.borderDistance.toFixed(1)}`);
            console.log(`      Blend factor: ${sample.blendFactor.toFixed(3)}`);
            
            // Check if heights match well
            const matchQuality = Math.abs(adjustedHeight - adjacentHeight);
            if (matchQuality < 0.1) {
                console.log(`      ✓ EXCELLENT match (diff: ${matchQuality.toFixed(3)})`);
            } else if (matchQuality < 0.5) {
                console.log(`      ⚠ GOOD match (diff: ${matchQuality.toFixed(3)})`);
            } else {
                console.log(`      ✗ POOR match (diff: ${matchQuality.toFixed(3)})`);
            }
        });
        
        console.log('');
    }
    
    // Get sample points along a chunk border for testing
    getBorderSamplePoints(chunkX, chunkZ, direction, tileSize) {
        const samples = [];
        const numSamples = 5; // Test 5 points along each border
        
        for (let i = 0; i < numSamples; i++) {
            const t = i / (numSamples - 1); // 0 to 1
            let x, z;
            
            switch (direction) {
                case 'north':
                    x = chunkX * this.chunkSize + t * this.chunkSize;
                    z = chunkZ * this.chunkSize + this.chunkSize - 0.1; // Just inside the border
                    break;
                case 'south':
                    x = chunkX * this.chunkSize + t * this.chunkSize;
                    z = chunkZ * this.chunkSize + 0.1; // Just inside the border
                    break;
                case 'east':
                    x = chunkX * this.chunkSize + this.chunkSize - 0.1; // Just inside the border
                    z = chunkZ * this.chunkSize + t * this.chunkSize;
                    break;
                case 'west':
                    x = chunkX * this.chunkSize + 0.1; // Just inside the border
                    z = chunkZ * this.chunkSize + t * this.chunkSize;
                    break;
            }
            
            const borderDistance = this.getBorderDistance(x, z, direction);
            const blendFactor = this.getBorderBlendFactor(x, z, tileSize, direction);
            
            samples.push({ x, z, borderDistance, blendFactor });
        }
        
        return samples;
    }
    
    // Calculate distance from border
    getBorderDistance(worldX, worldZ, direction) {
        const localCoord = (direction === 'north' || direction === 'south') ? 
            (worldZ % this.chunkSize) : (worldX % this.chunkSize);
        
        return (direction === 'north' || direction === 'east') ?
            this.chunkSize - localCoord : localCoord;
    }

    createStandardChunkGeometry(chunkX, chunkZ, tileSize = null) {
        var geometry = new THREE.BufferGeometry();
        var vertices = [];
        var colors = [];
        var indices = [];
        var normals = [];
        var uvs = [];
        
        var actualTileSize = tileSize || 1; // Default to 1 (full resolution)
        var tilesPerChunk = Math.floor(this.chunkSize / actualTileSize);
        var tileCount = 0;
        
        // console.log(`[Board DEBUG] Creating standard geometry with tileSize: ${actualTileSize}, tilesPerChunk: ${tilesPerChunk}`);
        
        // Get current mouse world position for distance calculations
        // console.log(`[Board DEBUG] Mouse world position:`, this.mouseWorldPosition);
        
        // Create tiles with specified size
        for (var x = 0; x < tilesPerChunk; x++) {
            for (var z = 0; z < tilesPerChunk; z++) {
                var worldX = chunkX * this.chunkSize + (x * actualTileSize);
                var worldZ = chunkZ * this.chunkSize + (z * actualTileSize);
                
                // Get terrain height at tile corners using UNIFIED height source (reverted - smart interpolation made gaps worse)
                var height00 = this.getUnifiedTerrainHeight(worldX, worldZ);
                var height10 = this.getUnifiedTerrainHeight(worldX + actualTileSize, worldZ);
                var height01 = this.getUnifiedTerrainHeight(worldX, worldZ + actualTileSize);
                var height11 = this.getUnifiedTerrainHeight(worldX + actualTileSize, worldZ + actualTileSize);
                
                // DISTANCE-BASED FADE SYSTEM - Fade checkerboard to grass with distance
                var isLight = (Math.floor(worldX) + Math.floor(worldZ)) % 2 === 0;
                var baseTileColor = isLight ? this.lightTileColor : this.darkTileColor;
                
                // Calculate distance from mouse cursor to tile center
                var tileCenterX = worldX + actualTileSize/2;
                var tileCenterZ = worldZ + actualTileSize/2;
                var distance = Math.sqrt(
                    Math.pow(tileCenterX - this.mouseWorldPosition.x, 2) + 
                    Math.pow(tileCenterZ - this.mouseWorldPosition.z, 2)
                );
                
                // Use fadeConfig for consistent distance values
                var fadeConfig = this.fadeConfig;
                
                // Calculate fade factor (0 = full checkerboard, 1 = full grass)
                var fadeFactor = 0;
                if (distance < fadeConfig.nearDistance) {
                    fadeFactor = 0;
                } else if (distance > fadeConfig.farDistance) {
                    fadeFactor = 1;
                } else {
                    fadeFactor = (distance - fadeConfig.nearDistance) / (fadeConfig.farDistance - fadeConfig.nearDistance);
                }
                
                // Interpolate between checkerboard color and grass color
                var grassColor = new THREE.Color(0.4, 0.6, 0.8);
                var tileColor = new THREE.Color().lerpColors(baseTileColor, grassColor, fadeFactor);
                
                if (tileCount === 0) {
                    // console.log(`[Board DEBUG] First tile color:`, tileColor);
                    // console.log(`[Board DEBUG] Light tile color:`, this.lightTileColor);
                    // console.log(`[Board DEBUG] Dark tile color:`, this.darkTileColor);
                    // console.log(`[Board DEBUG] Fade system enabled - nearDistance: ${fadeConfig.nearDistance}, farDistance: ${fadeConfig.farDistance}`);
                }
                
                tileCount++;
                
                // Create 4 vertices for the tile with slight overlap to eliminate gaps
                var baseIndex = vertices.length / 3;
                var overlap = 0.02; // Larger overlap for smoother edges
                
                // UVs unused — shader uses world-position projection mapping
                // Bottom-left
                vertices.push(x * actualTileSize - overlap, height00, z * actualTileSize - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push(0, 0);
                
                // Bottom-right
                vertices.push((x + 1) * actualTileSize + overlap, height10, z * actualTileSize - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push(0, 0);
                
                // Top-left
                vertices.push(x * actualTileSize - overlap, height01, z * actualTileSize + actualTileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push(0, 0);
                
                // Top-right
                vertices.push((x + 1) * actualTileSize + overlap, height11, z * actualTileSize + actualTileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push(0, 0);
                
                // Create indices for two triangles
                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }
        
        // Calculate normals
        this.calculateNormals(vertices, indices, normals);
        
        // Set geometry attributes
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        
        const actualVertexCount = vertices.length / 3;
        // console.log(`[Board DEBUG] Created standard geometry with ${tileCount} tiles (tileSize: ${actualTileSize})`);
        // console.log(`[Board DEBUG] Vertices: ${actualVertexCount}, Colors: ${colors.length/3}, Indices: ${indices.length}`);
        // console.log(`[Board DEBUG] Expected vertices: ${tileCount * 4}, Actual vertices: ${actualVertexCount}`);
        
        // Visual debugging: add LOD info to geometry for debugging
        geometry.userData = {
            tileSize: actualTileSize,
            vertexCount: actualVertexCount,
            tileCount: tileCount,
            lodDebug: true
        };
        
        return geometry;
    }
    
    createAdaptiveChunkGeometry(chunkX, chunkZ, distanceFromCamera) {
        var adaptiveMesh = this.optimization.adaptiveMesh;
        var reductionFactor = Math.min(
            (distanceFromCamera - adaptiveMesh.aggregationDistance) / 100,
            adaptiveMesh.maxVertexReduction
        );
        
        // Calculate the aggregation level based on distance
        var aggregationLevel = Math.floor(reductionFactor * 4) + 1; // 1-4 levels
        var stepSize = Math.max(1, Math.floor(this.chunkSize / (16 / aggregationLevel)));
        
        console.log(`[ADAPTIVE MESH] Chunk (${chunkX}, ${chunkZ}): distance=${distanceFromCamera.toFixed(1)}, reduction=${(reductionFactor*100).toFixed(1)}%, step=${stepSize}`);
        
        var geometry = new THREE.BufferGeometry();
        var vertices = [];
        var colors = [];
        var indices = [];
        var normals = [];
        var uvs = [];
        
        var tileCount = 0;
        
        // Create aggregated mesh with larger tiles
        for (var x = 0; x < this.chunkSize; x += stepSize) {
            for (var z = 0; z < this.chunkSize; z += stepSize) {
                var worldX = chunkX * this.chunkSize + x;
                var worldZ = chunkZ * this.chunkSize + z;
                
                // Get terrain height at corners of aggregated tile
                var height00 = this.terrainSystem ? this.terrainSystem.getHeight(worldX, worldZ) : 0;
                var height10 = this.terrainSystem ? this.terrainSystem.getHeight(worldX + stepSize, worldZ) : 0;
                var height01 = this.terrainSystem ? this.terrainSystem.getHeight(worldX, worldZ + stepSize) : 0;
                var height11 = this.terrainSystem ? this.terrainSystem.getHeight(worldX + stepSize, worldZ + stepSize) : 0;
                
                // Calculate average color for aggregated area
                var avgR = 0, avgG = 0, avgB = 0;
                var sampleCount = 0;
                
                for (var sx = 0; sx < stepSize; sx++) {
                    for (var sz = 0; sz < stepSize; sz++) {
                        var sampleWorldX = worldX + sx;
                        var sampleWorldZ = worldZ + sz;
                        
                        var isLight = (sampleWorldX + sampleWorldZ) % 2 === 0;
                        var baseTileColor = isLight ? this.lightTileColor : this.darkTileColor;
                        
                        // Calculate distance fade
                        var tileCenterX = sampleWorldX + 0.5;
                        var tileCenterZ = sampleWorldZ + 0.5;
                        var distance = Math.sqrt(
                            Math.pow(tileCenterX - this.mouseWorldPosition.x, 2) + 
                            Math.pow(tileCenterZ - this.mouseWorldPosition.z, 2)
                        );
                        
                        var fadeFactor = this.calculateTextureFade(distance);
                        var grassColor = new THREE.Color(0.4, 0.6, 0.8);
                        var tileColor = new THREE.Color().lerpColors(baseTileColor, grassColor, fadeFactor);
                        
                        avgR += tileColor.r;
                        avgG += tileColor.g;
                        avgB += tileColor.b;
                        sampleCount++;
                    }
                }
                
                avgR /= sampleCount;
                avgG /= sampleCount;
                avgB /= sampleCount;
                
                tileCount++;
                
                // Create aggregated tile vertices
                var baseIndex = vertices.length / 3;
                
                // Bottom-left
                vertices.push(x, height00, z);
                colors.push(avgR, avgG, avgB);
                // Use world coordinates for UVs so grass texture tiles seamlessly across chunks
                uvs.push(worldX * 0.5, worldZ * 0.5);
                
                // Bottom-right
                vertices.push(x + stepSize, height10, z);
                colors.push(avgR, avgG, avgB);
                uvs.push((worldX + stepSize) * 0.5, worldZ * 0.5);
                
                // Top-left
                vertices.push(x, height01, z + stepSize);
                colors.push(avgR, avgG, avgB);
                uvs.push(worldX * 0.5, (worldZ + stepSize) * 0.5);
                
                // Top-right
                vertices.push(x + stepSize, height11, z + stepSize);
                colors.push(avgR, avgG, avgB);
                uvs.push((worldX + stepSize) * 0.5, (worldZ + stepSize) * 0.5);
                
                // Create indices for two triangles
                indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
                indices.push(baseIndex + 1, baseIndex + 3, baseIndex + 2);
            }
        }
        
        // Calculate normals
        this.calculateNormals(vertices, indices, normals);
        
        // Apply smoothing if enabled
        if (adaptiveMesh.smoothingEnabled && reductionFactor > 0.3) {
            this.applyMeshSmoothing(vertices, normals, stepSize);
        }
        
        // Set geometry attributes
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        
        console.log(`[ADAPTIVE MESH] Created aggregated geometry: ${tileCount} tiles, ${(vertices.length/3).toLocaleString()} vertices (${((1-reductionFactor)*100).toFixed(1)}% of original)`);
        
        return geometry;
    }
    
    applyMeshSmoothing(vertices, normals, stepSize) {
        // Simple mesh smoothing by averaging neighboring vertex heights
        var smoothedVertices = vertices.slice();
        
        for (var i = 0; i < vertices.length; i += 3) {
            if (i % 3 === 1) { // Only smooth Y component (height)
                var sum = 0;
                var count = 0;
                
                // Sample neighboring vertices
                for (var offset = -3; offset <= 3; offset += 3) {
                    var neighborIndex = i + offset;
                    if (neighborIndex >= 0 && neighborIndex < vertices.length) {
                        sum += vertices[neighborIndex];
                        count++;
                    }
                }
                
                if (count > 0) {
                    smoothedVertices[i] = sum / count;
                }
            }
        }
        
        // Update vertices array
        for (var i = 0; i < vertices.length; i++) {
            vertices[i] = smoothedVertices[i];
        }
    }
    
    calculateNormals(vertices, indices, normals) {
        // Initialize normals array
        for (var i = 0; i < vertices.length; i += 3) {
            normals.push(0, 0, 0);
        }
        
        // Calculate face normals and accumulate
        for (var i = 0; i < indices.length; i += 3) {
            var i1 = indices[i] * 3;
            var i2 = indices[i + 1] * 3;
            var i3 = indices[i + 2] * 3;
            
            var v1 = new THREE.Vector3(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
            var v2 = new THREE.Vector3(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
            var v3 = new THREE.Vector3(vertices[i3], vertices[i3 + 1], vertices[i3 + 2]);
            
            var edge1 = new THREE.Vector3().subVectors(v2, v1);
            var edge2 = new THREE.Vector3().subVectors(v3, v1);
            var normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
            
            // Add to vertex normals
            normals[i1] += normal.x;
            normals[i1 + 1] += normal.y;
            normals[i1 + 2] += normal.z;
            
            normals[i2] += normal.x;
            normals[i2 + 1] += normal.y;
            normals[i2 + 2] += normal.z;
            
            normals[i3] += normal.x;
            normals[i3 + 1] += normal.y;
            normals[i3 + 2] += normal.z;
        }
        
        // Normalize vertex normals
        for (var i = 0; i < normals.length; i += 3) {
            var normal = new THREE.Vector3(normals[i], normals[i + 1], normals[i + 2]);
            normal.normalize();
            normals[i] = normal.x;
            normals[i + 1] = normal.y;
            normals[i + 2] = normal.z;
        }
    }
    
    getTerrainHeight(x, z) {
        if (this.terrainSystem) {
            return this.terrainSystem.getHeight(x, z);
        }
        return 0;
    }
    
    getTileHeight(x, z) {
        return this.getTerrainHeight(x, z);
    }
    
    isTileBlocked(x, z) {
        // TREES REMOVED - Only check slope-based blocking
        const height = this.getTileHeight(x, z);
        const slope = this.calculateSlope(x, z, height);
        const isBlocked = slope > 80; // Only block very steep terrain (match server)
        return isBlocked;
    }
    
    calculateSlope(x, z, height) {
        const delta = 0.1;
        const h1 = this.getTileHeight(x + delta, z);
        const h2 = this.getTileHeight(x - delta, z);
        const h3 = this.getTileHeight(x, z + delta);
        const h4 = this.getTileHeight(x, z - delta);
        
        const dx = (h2 - h1) / (2 * delta);
        const dz = (h4 - h3) / (2 * delta);
        
        return Math.atan(Math.sqrt(dx * dx + dz * dz)) * (180 / Math.PI);
    }
    
    getTileFromIntersection(intersection) {
        const point = intersection.point || intersection;
        return {
            x: Math.floor(point.x),
            z: Math.floor(point.z)
        };
    }
    
    getBoardMeshes() {
        const meshes = [];
        // Return continuous mesh if it exists (new system)
        if (this.continuousMesh) {
            return [this.continuousMesh];
        }
        // Fallback to old chunk-based system
        for (const chunk of this.chunks.values()) {
            if (chunk.mesh) {
                meshes.push(chunk.mesh);
            }
        }
        return meshes;
    }
    
    highlightTile(x, z, color) {
        // This would update the vertex colors for the specific tile
        // For now, we'll implement a simpler version
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(z / this.chunkSize);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const chunk = this.chunks.get(chunkKey);
        if (chunk) {
            // Update vertex colors for the highlighted tile
            this.updateTileColor(chunk, x, z, color);
        }
    }
    
    updateTileColor(chunk, tileX, tileZ, color) {
        // Find the local coordinates within the chunk
        const localX = tileX - (chunk.x * this.chunkSize);
        const localZ = tileZ - (chunk.z * this.chunkSize);
        
        if (localX < 0 || localX >= this.chunkSize || localZ < 0 || localZ >= this.chunkSize) {
            return;
        }
        
        const geometry = chunk.mesh.geometry;
        const colors = geometry.attributes.color.array;
        
        // Calculate the starting index for this tile (4 vertices per tile)
        const tileIndex = (localX * this.chunkSize + localZ) * 12; // 4 vertices * 3 color components
        
        // Update color for all 4 vertices of this tile
        for (let i = 0; i < 12; i += 3) {
            colors[tileIndex + i] = color.r;
            colors[tileIndex + i + 1] = color.g;
            colors[tileIndex + i + 2] = color.b;
        }
        
        // Mark the color attribute as needing update
        geometry.attributes.color.needsUpdate = true;
    }
    
    calculateTextureFade(distance) {
        const { nearDistance, farDistance } = this.fadeConfig;
        
        if (distance < nearDistance) {
            return 0;
        } else if (distance > farDistance) {
            return 1;
        } else {
            return (distance - nearDistance) / (farDistance - nearDistance);
        }
    }
    
    updateChunkFades(mousePosition, cameraChunkX, cameraChunkZ) {
        // Update grass fade effect (tile colors) for chunks
        for (const [chunkKey, chunk] of this.chunks) {
            this.updateChunkTileColors(chunk, mousePosition);
        }
    }
    
    updateChunkTileColors(chunk, mousePosition) {
        const geometry = chunk.mesh.geometry;
        const colors = geometry.attributes.color.array;
        
        // Recalculate colors for each tile in this chunk
        let colorIndex = 0;
        for (let x = 0; x < this.chunkSize; x++) {
            for (let z = 0; z < this.chunkSize; z++) {
                const worldX = chunk.x * this.chunkSize + x;
                const worldZ = chunk.z * this.chunkSize + z;
                
                // Calculate distance from mouse cursor to this tile's center
                const tileCenterX = worldX + 0.5;
                const tileCenterZ = worldZ + 0.5;
                const tileCenter = new THREE.Vector3(tileCenterX, 0, tileCenterZ);
                const distance = mousePosition.distanceTo(tileCenter);
                
                // Calculate fade factor for this individual tile
                const fadeFactor = this.calculateTextureFade(distance);
                
                // Determine tile color based on position and fade
                const isLight = (worldX + worldZ) % 2 === 0;
                const baseTileColor = isLight ? this.lightTileColor : this.darkTileColor;
                const grassColor = new THREE.Color(0.4, 0.6, 0.8);
                const tileColor = new THREE.Color().lerpColors(baseTileColor, grassColor, fadeFactor);
                
                // Update colors for all 4 vertices of this tile
                for (let vertex = 0; vertex < 4; vertex++) {
                    colors[colorIndex++] = tileColor.r;
                    colors[colorIndex++] = tileColor.g;
                    colors[colorIndex++] = tileColor.b;
                }
            }
        }
        
        // Mark the color attribute as needing update
        geometry.attributes.color.needsUpdate = true;
    }

    // Update continuous mesh colors based on mouse position
    updateContinuousMeshColors() {
        if (!this.continuousMesh) return;
        // console.log(`[FADE DEBUG] updateContinuousMeshColors called, mouseWorldPosition: ${this.mouseWorldPosition.x.toFixed(2)}, ${this.mouseWorldPosition.z.toFixed(2)}`);
        
        const geometry = this.continuousMesh.geometry;
        const colors = geometry.attributes.color.array;
        
        const meshSize = this.meshBounds.size;
        const tileSize = 1;
        const tilesPerSide = meshSize;
        const centerX = this.meshBounds.centerX;
        const centerZ = this.meshBounds.centerZ;
        
        let colorIndex = 0;
        
        for (let tx = 0; tx < tilesPerSide; tx++) {
            for (let tz = 0; tz < tilesPerSide; tz++) {
                const worldX = centerX - meshSize/2 + (tx * tileSize);
                const worldZ = centerZ - meshSize/2 + (tz * tileSize);
                
                // Calculate checkerboard color with mouse-based fade
                const isLight = (Math.floor(worldX) + Math.floor(worldZ)) % 2 === 0;
                const baseTileColor = isLight ? this.lightTileColor : this.darkTileColor;
                
                // Calculate distance from mouse cursor to tile center
                const tileCenterX = worldX + tileSize/2;
                const tileCenterZ = worldZ + tileSize/2;
                const distance = Math.sqrt(
                    Math.pow(tileCenterX - this.mouseWorldPosition.x, 2) + 
                    Math.pow(tileCenterZ - this.mouseWorldPosition.z, 2)
                );
                
                const fadeFactor = this.calculateTextureFade(distance);
                const grassColor = new THREE.Color(1.0, 1.0, 1.0); // White for lighting
                const tileColor = baseTileColor.clone().lerp(grassColor, fadeFactor);
                
                // Update all 4 vertices of this tile
                for (let v = 0; v < 4; v++) {
                    colors[colorIndex++] = tileColor.r;
                    colors[colorIndex++] = tileColor.g;
                    colors[colorIndex++] = tileColor.b;
                }
            }
        }
        
        geometry.attributes.color.needsUpdate = true;
    }
    
    updateFadeCenter(mousePosition) {
        // Update the fade center for the distance-based fade effect
        if (mousePosition && mousePosition.x !== undefined && mousePosition.z !== undefined) {
            this.mouseWorldPosition.x = mousePosition.x;
            this.mouseWorldPosition.z = mousePosition.z;
            this.needsFadeUpdate = true;
            
            // console.log(`[FADE DEBUG] Updated fade center to: (${mousePosition.x.toFixed(2)}, ${mousePosition.z.toFixed(2)})`);
        }
    }
    
    updateSquareColors(mousePosition = null) {
        // Use provided mouse position or current mouse world position
        const actualMousePosition = mousePosition || this.mouseWorldPosition;
        
        // Update all chunks
        this.updateChunkFades(actualMousePosition);
    }
    
    // Multi-layer optimization system
    updateOptimization() {
        // Reset stats
        this.optimization.stats.totalChunks = 0;
        this.optimization.stats.renderedChunks = 0;
        this.optimization.stats.culledChunks = 0;
        this.optimization.stats.vertexCount = 0;
        
        // Debug: Log optimization update only when camera moves significantly (disabled to reduce spam)
        const cameraMoved = this.lastCameraPosition.distanceTo(this.optimization.lastLoggedPosition || new THREE.Vector3()) > 5;
        if (false && (cameraMoved || !this.optimization.lastLoggedPosition)) {
            console.log('[OPTIMIZATION DEBUG] Starting optimization update for', this.chunks.size, 'chunks');
            this.optimization.lastLoggedPosition = this.lastCameraPosition.clone();
        }
        
        // Update each chunk with optimization
        for (const [chunkKey, chunkData] of this.chunks) {
            this.optimization.stats.totalChunks++;
            const distance = chunkData.chunkCenter.distanceTo(this.lastCameraPosition);

            // Apply frustum culling and max render distance culling
            if (!this.isChunkVisible(chunkData, distance)) {
                chunkData.mesh.visible = false;
                this.optimization.stats.culledChunks++;
                continue;
            }

            const lodLevel = this.getLODLevel(chunkData);

            if (false && this.optimization.stats.totalChunks <= 5) { // Only log first 5 chunks (disabled)
                console.log(`[OPTIMIZATION DEBUG] Chunk ${chunkKey}: distance=${distance.toFixed(2)}, lod=${lodLevel.name}`);
            }

            // Check if LOD needs to be updated (with hysteresis)
            const currentLOD = chunkData.currentLOD || 'high';
            if (currentLOD !== lodLevel.name) {
                const currentLODIndex = this.optimization.lodLevels.findIndex(l => l.name === currentLOD);
                const newLODIndex = this.optimization.lodLevels.findIndex(l => l.name === lodLevel.name);

                let shouldUpdate = false;
                
                // Force update if chunk has no proper LOD set yet (initialization)
                const isFirstUpdate = !chunkData.currentLOD;
                
                if (isFirstUpdate) {
                    shouldUpdate = true; // Force first update to set proper LOD baseline
                } else {
                    // Apply hysteresis for subsequent updates
                    if (newLODIndex > currentLODIndex) { // Downgrading LOD (farther away)
                        // Since downgradeBuffer is 0, we should always downgrade when appropriate
                        shouldUpdate = true;
                    } else if (newLODIndex < currentLODIndex) { // Upgrading LOD (closer)
                        if (distance < lodLevel.distance - this.optimization.hysteresis.upgradeBuffer) {
                            shouldUpdate = true;
                        }
                    }
                }

                // console.log(`[LOD DEBUG] Chunk ${chunkKey}: current=${currentLOD}, target=${lodLevel.name}, distance=${distance.toFixed(2)}, shouldUpdate=${shouldUpdate}, firstUpdate=${isFirstUpdate}`);
                // console.log(`[LOD DEBUG]   Distance check: ${distance.toFixed(2)} vs ${lodLevel.distance} (buffer: ${newLODIndex > currentLODIndex ? this.optimization.hysteresis.downgradeBuffer : this.optimization.hysteresis.upgradeBuffer})`);

                if (shouldUpdate) {
                    // console.log(`[LOD UPDATE] Chunk ${chunkKey}: ${currentLOD} -> ${lodLevel.name} (distance: ${distance.toFixed(2)}, firstUpdate: ${isFirstUpdate})`);
                    this.updateChunkLOD(chunkData, lodLevel);
                }
            }
            
            chunkData.mesh.visible = true;
            this.optimization.stats.renderedChunks++;
            this.optimization.stats.vertexCount += this.calculateChunkVertices(lodLevel);
        }

        // console.log('[OPTIMIZATION DEBUG] Final stats:', {
        //     total: this.optimization.stats.totalChunks,
        //     rendered: this.optimization.stats.renderedChunks,
        //     culled: this.optimization.stats.culledChunks,
        //     vertices: this.optimization.stats.vertexCount
        // });

        // Update performance display
        this.updatePerformanceDisplay();
        
        // Log stats every few seconds
        if (Date.now() - this.optimization.stats.lastUpdate > 3000) {
            console.log('[OPTIMIZATION STATS]', {
                total: this.optimization.stats.totalChunks,
                rendered: this.optimization.stats.renderedChunks,
                culled: this.optimization.stats.culledChunks,
                vertices: this.optimization.stats.vertexCount,
                reduction: ((this.optimization.stats.culledChunks / this.optimization.stats.totalChunks) * 100).toFixed(1) + '%'
            });
            this.optimization.stats.lastUpdate = Date.now();
        }
    }
    
    isChunkVisible(chunkData, distance) {
        // Check maximum render distance
        if (distance > this.optimization.maxRenderDistance) {
            return false;
        }
        
        // Check cone culling
        return this.isInCone(chunkData.chunkCenter);
    }
    
    isInCone(chunkCenter) {
        // Get camera position and direction
        const camera = this.getCamera();
        if (!camera) {
            return true; // Default to visible if no camera
        }
        
        const cameraPos = camera.position;
        
        // Get camera direction vector (where camera is looking)
        const cameraDir = new THREE.Vector3(0, 0, -1);
        cameraDir.applyQuaternion(camera.quaternion);
        cameraDir.normalize();
        
        // Calculate vector from camera to chunk
        const toChunk = chunkCenter.clone().sub(cameraPos);
        const distance = toChunk.length();
        
        // First check distance culling
        const maxDistance = this.optimization.maxRenderDistance * 1.2;
        if (distance > maxDistance) {
            return false;
        }
        
        if (distance <= 0.001) return true; // Too close to camera
        
        // Calculate angle between camera direction and chunk direction
        toChunk.normalize();
        const angle = THREE.MathUtils.radToDeg(Math.acos(toChunk.dot(cameraDir)));
        
        // Check if within cone (with buffer)
        const effectiveFOV = this.optimization.coneFOV + this.optimization.coneBuffer;
        const inCone = angle <= (effectiveFOV / 2);
        
        return inCone;
    }
    
    getLODLevel(chunkData) {
        const distance = chunkData.chunkCenter.distanceTo(this.lastCameraPosition);
        const currentLOD = chunkData.currentLOD || 'high';
        let lodLevel = this.optimization.lodLevels[0]; // Default to high

        // Debug LOD assignment for specific chunks (disabled for performance)
        // if (Math.random() < 0.05) { // Log 5% of calls
        //     console.log(`[LOD ASSIGNMENT] Chunk (${chunkData.x},${chunkData.z}): distance=${distance.toFixed(2)}, currentLOD=${currentLOD}`);
        // }

        // Find the appropriate LOD based on distance (from nearest to farthest)
        for (let i = 0; i < this.optimization.lodLevels.length; i++) {
            const level = this.optimization.lodLevels[i];
            
            // Apply hysteresis to prevent flickering
            let effectiveDistance = distance;
            
            if (level.name === currentLOD) {
                // If currently at this LOD, apply hysteresis
                if (i > 0 && distance < level.distance) { // Moving closer to upgrade
                    effectiveDistance = distance - this.optimization.hysteresis.upgradeBuffer;
                } else if (i < this.optimization.lodLevels.length - 1 && distance > level.distance) { // Moving farther to downgrade
                    effectiveDistance = distance + this.optimization.hysteresis.downgradeBuffer;
                }
            }
            
            // Debug LOD assignment for specific chunks (disabled for performance)
            // if (Math.random() < 0.05) { // Log 5% of calls
            //     console.log(`[LOD ASSIGNMENT]   Testing ${level.name}: distance=${level.distance}, effective=${effectiveDistance.toFixed(2)}, match=${effectiveDistance <= level.distance}`);
            // }
            
            // Check if this LOD level should be used
            if (effectiveDistance <= level.distance) {
                lodLevel = level;
                break;
            }
        }
        
        // Debug LOD assignment for specific chunks (disabled for performance)
        // if (Math.random() < 0.05) { // Log 5% of calls
        //     console.log(`[LOD ASSIGNMENT] RESULT: Chunk (${chunkData.x},${chunkData.z}) distance=${distance.toFixed(2)} assigned LOD=${lodLevel.name}`);
        // }
        
        // Debug LOD changes (disabled to reduce spam)
        // if (lodLevel.name !== currentLOD) {
        //     console.log(`[LOD DEBUG] Chunk (${chunkData.x},${chunkData.z}): ${currentLOD} -> ${lodLevel.name} (distance: ${distance.toFixed(2)})`);
        // }
        
        return lodLevel;
    }
    
    updateChunkLOD(chunkData, lodLevel) {
        // console.log(`[OPTIMIZATION DEBUG] Updating LOD for chunk (${chunkData.x},${chunkData.z}) to ${lodLevel.name} (tileSize: ${lodLevel.tileSize})`);
        
        // Dispose old geometry
        if (chunkData.geometry) {
            chunkData.geometry.dispose();
        }

        // Create new geometry with the specified LOD's tileSize
        const newGeometry = this.createChunkGeometry(chunkData.x, chunkData.z, lodLevel.tileSize); // Pass tileSize
        chunkData.mesh.geometry = newGeometry;
        chunkData.geometry = newGeometry;
        chunkData.currentLOD = lodLevel.name;
        chunkData.tileSize = lodLevel.tileSize; // Store the active tileSize
        
        // Store LOD info for debugging but don't change colors automatically
        chunkData.mesh.userData.lodLevel = lodLevel.name;
        chunkData.mesh.userData.vertexCount = newGeometry.attributes.position.count;
        
        // console.log(`[LOD UPDATE] Chunk (${chunkData.x},${chunkData.z}) updated to ${lodLevel.name} - vertices: ${newGeometry.attributes.position.count}`);
    }
    
    calculateChunkVertices(lodLevel) {
        // Assuming each tile is a quad (4 vertices, 2 triangles)
        // A chunk has (this.chunkSize / lodLevel.tileSize) * (this.chunkSize / lodLevel.tileSize) tiles
        const tilesPerSide = this.chunkSize / lodLevel.tileSize;
        const numTiles = tilesPerSide * tilesPerSide;
        const vertexCount = numTiles * 4; // 4 vertices per tile
        
        // console.log(`[VERTEX DEBUG] LOD: ${lodLevel.name}, tileSize: ${lodLevel.tileSize}, tilesPerSide: ${tilesPerSide}, numTiles: ${numTiles}, vertexCount: ${vertexCount}`);
        
        return vertexCount;
    }
    
    forceLODUpdate() {
        // console.log('[LOD DEBUG] Forcing LOD update on all chunks for testing');
        
        for (const [chunkKey, chunkData] of this.chunks) {
            const distance = chunkData.chunkCenter.distanceTo(this.lastCameraPosition);
            const lodLevel = this.getLODLevel(chunkData);
            
            // console.log(`[LOD DEBUG] Force updating chunk ${chunkKey} to ${lodLevel.name} (distance: ${distance.toFixed(2)})`);
            
            // Force update regardless of current LOD
            this.updateChunkLOD(chunkData, lodLevel);
        }
        
        // console.log('[LOD DEBUG] Forced LOD update complete');
        // console.log('[LOD DEBUG] You should see chunks colored by LOD: Red=High, Yellow=Medium, Green=Low');
        // console.log('[LOD DEBUG] The gaps between chunks should change based on their LOD level');
    }
    
    initializeLODLevels() {
        // console.log('[LOD INIT] Initializing proper LOD levels for all chunks');
        
        let updatedCount = 0;
        for (const [chunkKey, chunkData] of this.chunks) {
            // Clear current LOD to force first update
            chunkData.currentLOD = null;
            updatedCount++;
        }
        
        // console.log(`[LOD INIT] Cleared LOD for ${updatedCount} chunks - they will update on next optimization pass`);
        // console.log('[LOD INIT] Run boardSystem.updateOptimization() or move camera to trigger updates');
    }
    
    forceLODWithoutHysteresis() {
        console.log('[LOD FORCE] Bypassing hysteresis - forcing LOD on all chunks');
        
        let updatedCount = 0;
        for (const [chunkKey, chunkData] of this.chunks) {
            const distance = chunkData.chunkCenter.distanceTo(this.lastCameraPosition);
            const lodLevel = this.getLODLevel(chunkData);
            
            console.log(`[LOD FORCE] Chunk ${chunkKey}: distance=${distance.toFixed(2)}, forcing to ${lodLevel.name}`);
            
            // Force update regardless of current LOD - no hysteresis check
            this.updateChunkLOD(chunkData, lodLevel);
            updatedCount++;
        }
        
        console.log(`[LOD FORCE] Forced LOD update on ${updatedCount} chunks`);
        console.log('[LOD FORCE] You should see different geometry levels based on distance');
        
        return updatedCount;
    }
    
    // Force LOD refresh on all chunks (bypasses hysteresis)
    forceLODRefresh() {
        console.log('[LOD REFRESH] Forcing LOD update on all chunks (bypassing hysteresis)');
        let updatedCount = 0;
        
        for (const [chunkKey, chunkData] of this.chunks) {
            const distance = chunkData.chunkCenter.distanceTo(this.lastCameraPosition);
            const lodLevel = this.getLODLevel(chunkData);
            const currentLOD = chunkData.currentLOD || 'high';
            
            // Force update if LOD should be different
            if (currentLOD !== lodLevel.name) {
                console.log(`[LOD REFRESH] Chunk ${chunkKey}: ${currentLOD} -> ${lodLevel.name} (distance: ${distance.toFixed(2)})`);
                this.updateChunkLOD(chunkData, lodLevel);
                updatedCount++;
            }
        }
        
        console.log(`[LOD REFRESH] Updated ${updatedCount} chunks`);
        return updatedCount;
    }
    
    // Debug function to test LOD distances
    testLODDistances() {
        console.log('[LOD DISTANCE TEST] Current LOD distances:');
        this.optimization.lodLevels.forEach((level, index) => {
            console.log(`  ${level.name}: up to ${level.distance} units (tileSize: ${level.tileSize})`);
        });
        
        console.log('[LOD DISTANCE TEST] Testing chunks around camera:');
        for (const [chunkKey, chunkData] of this.chunks) {
            const distance = chunkData.chunkCenter.distanceTo(this.lastCameraPosition);
            const lodLevel = this.getLODLevel(chunkData);
            console.log(`  Chunk ${chunkKey}: distance=${distance.toFixed(1)}, LOD=${lodLevel.name}`);
            
            // Only show first 10 chunks to avoid spam
            if (this.chunks.size > 10) break;
        }
    }
    
    testLODSystem() {
        console.log('[LOD TEST] Testing LOD system with visual feedback');
        
        let totalChunks = 0;
        let totalVertices = 0;
        const lodCounts = { high: 0, medium: 0, low: 0 };
        const lodVertices = { high: 0, medium: 0, low: 0 };
        
        for (const [chunkKey, chunkData] of this.chunks) {
            totalChunks++;
            
            const lodName = chunkData.currentLOD || 'high';
            const vertexCount = chunkData.geometry ? chunkData.geometry.attributes.position.count : 0;
            const tileSize = chunkData.geometry ? chunkData.geometry.userData.tileSize : 1;
            
            lodCounts[lodName]++;
            lodVertices[lodName] += vertexCount;
            totalVertices += vertexCount;
            
            // Visual feedback: change chunk color based on LOD
            if (chunkData.mesh && chunkData.mesh.material) {
                let debugColor;
                switch(lodName) {
                    case 'high':
                        debugColor = new THREE.Color(1, 0, 0); // Red for high detail
                        break;
                    case 'medium':
                        debugColor = new THREE.Color(1, 1, 0); // Yellow for medium detail
                        break;
                    case 'low':
                        debugColor = new THREE.Color(0, 1, 0); // Green for low detail
                        break;
                    default:
                        debugColor = new THREE.Color(0.5, 0.5, 0.5); // Gray for unknown
                }
                chunkData.mesh.material.color = debugColor;
                chunkData.mesh.material.needsUpdate = true;
            }
            
            console.log(`[LOD TEST] Chunk ${chunkKey}: LOD=${lodName}, tileSize=${tileSize}, vertices=${vertexCount}`);
        }
        
        console.log('[LOD TEST] SUMMARY:');
        console.log(`  Total chunks: ${totalChunks}`);
        console.log(`  Total vertices: ${totalVertices}`);
        console.log(`  High LOD: ${lodCounts.high} chunks, ${lodVertices.high} vertices`);
        console.log(`  Medium LOD: ${lodCounts.medium} chunks, ${lodVertices.medium} vertices`);
        console.log(`  Low LOD: ${lodCounts.low} chunks, ${lodVertices.low} vertices`);
        console.log('[LOD TEST] Chunks colored by LOD: Red=High, Yellow=Medium, Green=Low');
        
        return {
            totalChunks,
            totalVertices,
            lodCounts,
            lodVertices
        };
    }
    
    resetChunkColors() {
        console.log('[LOD TEST] Resetting chunk colors to normal');
        
        for (const [chunkKey, chunkData] of this.chunks) {
            if (chunkData.mesh && chunkData.mesh.material) {
                // Reset to original board material
                chunkData.mesh.material = this.boardMaterial.clone();
                chunkData.mesh.material.needsUpdate = true;
            }
        }
        
        console.log('[LOD TEST] Chunk colors reset');
    }
    
    getCamera() {
        // Try to get camera from game first (preferred method)
        if (this.game && this.game.camera) {
            return this.game.camera;
        }
        
        // Fallback: try to get camera from scene
        if (this.scene && this.scene.children) {
            for (const child of this.scene.children) {
                if (child.isCamera) {
                    return child;
                }
            }
        }
        return null;
    }
    
    updatePerformanceDisplay() {
        // Update dev tools performance display
        const vertexElement = document.getElementById('vertexCount');
        const chunkElement = document.getElementById('chunkCount');
        const totalChunkElement = document.getElementById('totalChunks');
        const reductionElement = document.getElementById('reductionPercent');
        
        if (vertexElement) {
            if (this.continuousMesh) {
                vertexElement.textContent = this.continuousMesh.geometry.attributes.position.count.toLocaleString();
            } else {
                vertexElement.textContent = this.optimization.stats.vertexCount.toLocaleString();
            }
        }
        if (chunkElement) {
            chunkElement.textContent = this.optimization.stats.renderedChunks;
        }
        if (totalChunkElement) {
            totalChunkElement.textContent = this.optimization.stats.totalChunks;
        }
        if (reductionElement) {
            const reduction = this.optimization.stats.totalChunks > 0 
                ? ((this.optimization.stats.culledChunks / this.optimization.stats.totalChunks) * 100).toFixed(1)
                : 0;
            reductionElement.textContent = reduction + '%';
            
            // Color code the reduction percentage
            if (reduction > 70) {
                reductionElement.style.color = '#00ff00'; // Green - excellent optimization
            } else if (reduction > 50) {
                reductionElement.style.color = '#ffff00'; // Yellow - good optimization
            } else {
                reductionElement.style.color = '#ff6666'; // Red - needs improvement
            }
        }
    }
    
    // Performance monitoring functions
    getPerformanceStats() {
        return {
            ...this.optimization.stats,
            totalChunks: this.chunks.size,
            adaptiveMeshEnabled: this.optimization.adaptiveMesh.enabled,
            streamingEnabled: this.optimization.streaming.enabled
        };
    }
    
    logPerformanceStats() {
        const stats = this.getPerformanceStats();
        console.log('[PERFORMANCE STATS]', {
            totalChunks: stats.totalChunks,
            renderedChunks: stats.renderedChunks,
            culledChunks: stats.culledChunks,
            vertexCount: stats.vertexCount,
            frameTime: stats.frameTime.toFixed(2) + 'ms',
            lodTransitions: stats.lodTransitions,
            reductionRatio: ((stats.culledChunks / stats.totalChunks) * 100).toFixed(1) + '%'
        });
    }
}

// Export the class for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CleanBoardSystem;
} else if (typeof window !== 'undefined') {
    window.CleanBoardSystem = CleanBoardSystem;
}
