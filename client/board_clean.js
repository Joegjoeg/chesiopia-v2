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



        this.lightTileColor = new THREE.Color(0xf0d9b5); // Light wood



        this.darkTileColor = new THREE.Color(0xb58863);  // Dark wood



        this.highlightColor = new THREE.Color(0x7fc97f);



        this.selectedColor = new THREE.Color(0xf4a460);



        



        // Create grass texture for board tiles



        this.grassTexture = this.createGrassTexture();



        



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






        this.boardMaterial = new THREE.MeshStandardMaterial({



            vertexColors: true,



            map: this.grassTexture,



            roughness: 0.8,



            metalness: 0.0,



            side: THREE.DoubleSide,



            transparent: false,



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





        console.log(`[Board] Board system initialized with terrain system: ${this.terrainSystem ? 'YES' : 'NO'}`);





        console.log(`[Board] Adaptive mesh optimization: ${this.optimization.adaptiveMesh.enabled ? 'ENABLED' : 'DISABLED'}`);





        console.log(`[Board] Chunk streaming: ${this.optimization.streaming.enabled ? 'ENABLED' : 'DISABLED'}`);







        // Initialize sun system
        this.createSunSystem();

        console.log(`[Board] Sun system initialized`);
    }

    



    // Seeded random number generator for consistent textures
    seededRandom(seed) {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    // Create simple tiled grass texture for future procedural editing
    createGrassTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // Simple clean grass base - perfect for procedural editing later
        ctx.fillStyle = '#4a7c2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Add subtle tile pattern for visual interest (easy to modify later)
        const tileSize = 64;
        for (let x = 0; x < 8; x++) {
            for (let z = 0; z < 8; z++) {
                const isLight = (x + z) % 2 === 0;
                ctx.fillStyle = isLight ? '#5a8d35' : '#3a6b1f';
                ctx.globalAlpha = 0.1;
                ctx.fillRect(x * tileSize, z * tileSize, tileSize, tileSize);
            }
        }
        ctx.globalAlpha = 1.0;

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        
        console.log('[Board] Simple tiled grass texture created for procedural editing');
        return texture;
    }

    // Create orbiting sun system with omni light, circle sprite, and lens flare
    createSunSystem() {
        console.log('[SUN] Creating orbiting sun system');

        // Sun configuration - 60 second full rotation at 60fps
        this.sun = {
            orbitRadius: 10,         // Distance from camera (much closer)
            orbitSpeed: (2 * Math.PI) / (60 * 60),  // Full rotation in 60 seconds at 60fps
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
            orbitSpeed: (2 * Math.PI) / (60 * 60),  // Same speed as sun
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
        
        // Create directional light (sun-like, parallel rays)
        this.sun.light = new THREE.DirectionalLight(
            this.sun.color,
            this.sun.intensity
        );
        this.sun.light.position.set(0, this.sun.height, 0);
        this.sun.light.castShadow = false; // Shadows disabled for Android performance

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
        this.moon.light.castShadow = false;  // Moon doesn't cast shadows
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

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Define color states for different times of day
        const colorStates = {
            night: {
                horizon: { r: 20, g: 20, b: 40 },
                zenith: { r: 5, g: 5, b: 15 },
                glow: { r: 50, g: 50, b: 100 },
                glowIntensity: 0.1
            },
            dawn: {
                horizon: { r: 60, g: 40, b: 60 },
                zenith: { r: 20, g: 20, b: 50 },
                glow: { r: 200, g: 80, b: 50 },
                glowIntensity: 0.4
            },
            sunrise: {
                horizon: { r: 30, g: 30, b: 60 },
                zenith: { r: 20, g: 20, b: 60 },
                glow: { r: 255, g: 100, b: 50 },
                glowIntensity: 0.8
            },
            midday: {
                horizon: { r: 173, g: 216, b: 230 },
                zenith: { r: 100, g: 149, b: 237 },
                glow: { r: 255, g: 220, b: 150 },
                glowIntensity: 0.5
            },
            noon: {
                horizon: { r: 135, g: 206, b: 235 },
                zenith: { r: 70, g: 130, b: 180 },
                glow: { r: 255, g: 255, b: 200 },
                glowIntensity: 0.3
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
        let horizonColor, zenithColor, sunGlowColor, sunGlowIntensity;

        if (sunElevation > 0.5) {
            // Noon - bright blue sky
            horizonColor = colorStates.noon.horizon;
            zenithColor = colorStates.noon.zenith;
            sunGlowColor = colorStates.noon.glow;
            sunGlowIntensity = colorStates.noon.glowIntensity;
        } else if (sunElevation > 0.2) {
            // Transition from midday to noon
            const t = (sunElevation - 0.2) / 0.3; // Normalize to 0-1
            horizonColor = lerpColor(colorStates.midday.horizon, colorStates.noon.horizon, t);
            zenithColor = lerpColor(colorStates.midday.zenith, colorStates.noon.zenith, t);
            sunGlowColor = lerpColor(colorStates.midday.glow, colorStates.noon.glow, t);
            sunGlowIntensity = lerp(colorStates.midday.glowIntensity, colorStates.noon.glowIntensity, t);
        } else if (sunElevation > 0) {
            // Transition from sunrise to midday
            const t = sunElevation / 0.2; // Normalize to 0-1
            horizonColor = lerpColor(colorStates.sunrise.horizon, colorStates.midday.horizon, t);
            zenithColor = lerpColor(colorStates.sunrise.zenith, colorStates.midday.zenith, t);
            sunGlowColor = lerpColor(colorStates.sunrise.glow, colorStates.midday.glow, t);
            sunGlowIntensity = lerp(colorStates.sunrise.glowIntensity, colorStates.midday.glowIntensity, t);
        } else if (sunElevation > -0.2) {
            // Transition from dawn to sunrise
            const t = (sunElevation + 0.2) / 0.2; // Normalize to 0-1
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

        // Define fog colors for different times of day
        const fogColors = {
            night: { r: 5, g: 5, b: 10 },      // Very dark blue/black
            dawn: { r: 40, g: 30, b: 50 },      // Purple/dark
            sunrise: { r: 80, g: 60, b: 70 },   // Muted purple
            midday: { r: 180, g: 180, b: 180 }, // Light gray
            noon: { r: 200, g: 200, b: 200 }    // White/light gray
        };

        const lerp = (a, b, t) => a + (b - a) * t;
        const lerpColor = (c1, c2, t) => ({
            r: lerp(c1.r, c2.r, t),
            g: lerp(c1.g, c2.g, t),
            b: lerp(c1.b, c2.b, t)
        });

        let fogColor;

        if (sunElevation > 0.5) {
            fogColor = fogColors.noon;
        } else if (sunElevation > 0.2) {
            const t = (sunElevation - 0.2) / 0.3;
            fogColor = lerpColor(fogColors.midday, fogColors.noon, t);
        } else if (sunElevation > 0) {
            const t = sunElevation / 0.2;
            fogColor = lerpColor(fogColors.sunrise, fogColors.midday, t);
        } else if (sunElevation > -0.2) {
            const t = (sunElevation + 0.2) / 0.2;
            fogColor = lerpColor(fogColors.dawn, fogColors.sunrise, t);
        } else {
            fogColor = fogColors.night;
        }

        this.scene.fog.color.setRGB(fogColor.r / 255, fogColor.g / 255, fogColor.b / 255);
    }

    updateSunPosition(cameraPosition) {
        // Update sun angle based on server game time
        if (this.serverGameTime > 0) {
            // Interpolate time locally between server syncs for smooth movement
            let currentGameTime = this.serverGameTime;
            if (this.lastTimeSyncTimestamp > 0) {
                // Add elapsed time since last sync to get smooth continuous movement
                const elapsedSinceSync = Date.now() - this.lastTimeSyncTimestamp;
                currentGameTime += elapsedSinceSync;
            }
            
            // Use interpolated time: angle = (elapsedTime / dayLength) * 2PI
            this.sun.angle = (currentGameTime / this.serverDayLength) * (2 * Math.PI);
        } else {
            // Fallback to local frame-based increments if no server time yet
            this.sun.angle += this.sun.orbitSpeed;
            console.log('[Board] Sun angle using local fallback');
        }
        this.moon.angle = this.sun.angle + Math.PI;  // Moon is opposite to sun

        // Calculate sun height based on angle (vertical orbit)
        const sunHeight = Math.max(0, Math.sin(this.sun.angle) * this.sun.height);
        const sunElevation = Math.sin(this.sun.angle);

        // Calculate sun position (orbits around camera horizontally, rises/sets vertically)
        const sunX = cameraPosition.x + Math.cos(this.sun.angle) * this.sun.orbitRadius;
        const sunZ = cameraPosition.z + Math.sin(this.sun.angle) * this.sun.orbitRadius;
        const sunY = cameraPosition.y + sunHeight;

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

        // Fade light intensity when sun is below horizon
        const lightIntensity = Math.max(0, sunElevation) * this.sun.intensity;
        this.sun.light.intensity = lightIntensity;

        // Smooth sun color transition based on elevation
        // Define color keyframes for different elevations
        const sunriseColor = new THREE.Color(0xff6347);  // Tomato orange
        const midDayColor = new THREE.Color(0xfffacd);    // Lemon chiffon
        const noonColor = new THREE.Color(0xffffff);      // White
        const sunNightColor = new THREE.Color(0x000000);  // Black (below horizon)

        let sunColor;
        if (sunElevation <= 0) {
            // Below horizon
            sunColor = sunNightColor;
        } else if (sunElevation < 0.2) {
            // Sunrise/sunset to mid-day transition
            const t = sunElevation / 0.2;
            sunColor = sunriseColor.clone().lerp(midDayColor, t);
        } else if (sunElevation < 0.5) {
            // Mid-day to noon transition
            const t = (sunElevation - 0.2) / 0.3;
            sunColor = midDayColor.clone().lerp(noonColor, t);
        } else {
            // Noon
            sunColor = noonColor;
        }
        this.sun.light.color.copy(sunColor);

        // Update sky background color based on sun elevation
        this.updateSkyColor(sunElevation);

        // Calculate moon height (opposite to sun)
        const moonHeight = Math.max(0, Math.sin(this.moon.angle) * this.moon.height);
        const moonElevation = Math.sin(this.moon.angle);

        // Calculate moon position (opposite to sun)
        const moonX = cameraPosition.x + Math.cos(this.moon.angle) * this.moon.orbitRadius;
        const moonZ = cameraPosition.z + Math.sin(this.moon.angle) * this.moon.orbitRadius;
        const moonY = cameraPosition.y + moonHeight;

        // Update moon light position
        this.moon.light.position.set(moonX, moonY, moonZ);

        // Update moon light target
        this.moon.light.target.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        this.moon.light.target.updateMatrixWorld();

        // Fade moon light intensity when moon is below horizon
        const moonIntensity = Math.max(0, moonElevation) * this.moon.intensity;
        this.moon.light.intensity = moonIntensity;

        // Smooth moon color transition based on elevation
        const moonRiseColor = new THREE.Color(0x4a5568);   // Dim bluish-gray
        const moonZenithColor = new THREE.Color(0xe2e8f0);  // Bright silver
        const moonNightColor = new THREE.Color(0x000000);    // Black (below horizon)

        let moonColor;
        if (moonElevation <= 0) {
            // Below horizon
            moonColor = moonNightColor;
        } else if (moonElevation < 0.5) {
            // Moonrise to zenith transition
            const t = moonElevation / 0.5;
            moonColor = moonRiseColor.clone().lerp(moonZenithColor, t);
        } else {
            // Zenith
            moonColor = moonZenithColor;
        }
        this.moon.light.color.copy(moonColor);

        // Update ambient light intensity for atmospheric scattering at dusk/dawn
        // Represents sunlight bouncing off atmosphere when sun is at low angles and after sunset
        let ambientIntensity = 0;
        if (sunElevation < 0.3 && sunElevation > 0) {
            // Sun at low angles before sunset - start fading in (atmospheric scattering)
            const t = (0.3 - sunElevation) / 0.3; // 0 at 0.3 elevation, 1 at 0 elevation
            ambientIntensity = t * 0.4; // Max 0.4 intensity at sunset
        } else if (sunElevation <= 0 && moonElevation < 0.2) {
            // Sun below horizon, moon not yet risen - peak twilight period
            const sunDepth = Math.min(1, Math.abs(sunElevation)); // 0 at horizon, 1 at lowest
            ambientIntensity = 0.4 + (sunDepth * 0.1); // Peak around 0.5 when sun is deep below
        } else if (moonElevation >= 0.2 && moonElevation < 0.4) {
            // Moon rising - fade out ambient light
            const t = (moonElevation - 0.2) / 0.2; // 0 at 0.2, 1 at 0.4
            ambientIntensity = 0.5 * (1 - t);
        }
        this.ambientLight.intensity = ambientIntensity;

        // Update dev console light stats (throttled to every 30 frames)
        this.frameCount++;
        if (this.frameCount % 30 === 0 && typeof document !== 'undefined') {
            const sunIntEl = document.getElementById('sunIntensity');
            const sunColorEl = document.getElementById('sunColor');
            const moonIntEl = document.getElementById('moonIntensity');
            const moonColorEl = document.getElementById('moonColor');
            const ambientIntEl = document.getElementById('ambientIntensity');
            const ambientColorEl = document.getElementById('ambientColor');

            if (sunIntEl) sunIntEl.textContent = this.sun.light.intensity.toFixed(2);
            if (sunColorEl) sunColorEl.textContent = '#' + this.sun.light.color.getHexString();
            if (moonIntEl) moonIntEl.textContent = this.moon.light.intensity.toFixed(2);
            if (moonColorEl) moonColorEl.textContent = '#' + this.moon.light.color.getHexString();
            if (ambientIntEl) ambientIntEl.textContent = this.ambientLight.intensity.toFixed(2);
            if (ambientColorEl) ambientColorEl.textContent = '#' + this.ambientLight.color.getHexString();
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
    
    // Update server game time (called from network manager)
    updateServerGameTime(elapsedTime, dayLength) {
        this.serverGameTime = elapsedTime;
        this.serverDayLength = dayLength;
        this.lastTimeSyncTimestamp = Date.now(); // Track when we received this sync
        console.log(`[Board] Server time sync: ${elapsedTime}ms elapsed, day length: ${dayLength}ms`);
    }
        



    createBoard(centerX, centerZ, radius) {
        console.log(`[DYNAMIC MESH] Creating board with dynamic continuous mesh (NO GAPS!)`);
        
        // CLEAR ALL EXISTING CHUNKS - we're using dynamic continuous mesh now
        this.clearAllChunks();
        
        // Initialize mesh bounds
        this.meshBounds = {
            centerX: centerX,
            centerZ: centerZ,
            size: this.chunkSize * 12 // 12x12 chunks visible area (increased from 8)
        };
        
        // Create the continuous mesh centered on camera position
        const continuousMesh = this.createContinuousMeshAround(centerX, centerZ);
        
        // Add to scene
        this.scene.add(continuousMesh);
        
        // Store reference for later access
        this.continuousMesh = continuousMesh;
        
        console.log(`[DYNAMIC MESH] Board created - dynamic mesh with no gaps!`);
        
        return Promise.resolve(); // Return promise for compatibility
    }
    
    // Clear all existing chunks when switching to continuous mesh
    clearAllChunks() {
        console.log(`[CONTINUOUS MESH] Clearing all existing chunks`);
        
        // Remove all chunk meshes from scene
        for (const [chunkKey, chunk] of this.chunks) {
            if (chunk.mesh) {
                this.scene.remove(chunk.mesh);
            }
        }
        
        // Clear the chunks map
        this.chunks.clear();
        
        // Remove continuous mesh if it exists
        if (this.continuousMesh) {
            this.scene.remove(this.continuousMesh);
            this.continuousMesh = null;
        }
        
        console.log(`[CONTINUOUS MESH] All chunks cleared`);
    }
    
    // DYNAMIC MESH REGENERATION - Create new vertices as camera scrolls, remove old ones
    updateDynamicMesh(cameraPosition, force = false) {
        // console.log(`[Board] === updateDynamicMesh CALLED === force=${force}`);
        // console.log(`[Board] Camera position: ${cameraPosition.x.toFixed(2)}, ${cameraPosition.z.toFixed(2)}`);
        // console.log(`[Board] Mesh bounds: ${this.meshBounds ? 'EXISTS' : 'NULL'}`);
        
        // Initialize mesh bounds if not set
        if (!this.meshBounds) {
            console.log(`[Board] INITIALIZING mesh bounds`);
            this.meshBounds = {
                centerX: cameraPosition.x,
                centerZ: cameraPosition.z,
                size: this.chunkSize * 12 // 12x12 chunks visible area (increased from 8)
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
            console.log(`[DYNAMIC MESH] ${force ? 'FORCE' : 'Camera moved'} regenerating mesh (distance: ${distanceFromCenter.toFixed(1)})`);

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
            const newMesh = this.createContinuousMeshAround(cameraPosition.x, cameraPosition.z);
            this.scene.add(newMesh);
            this.continuousMesh = newMesh;

            this.lastMeshRegeneration = Date.now();

            console.log(`[DYNAMIC MESH] Mesh regenerated at (${cameraPosition.x.toFixed(1)}, ${cameraPosition.z.toFixed(1)})`);
        }
    }
    
    // Create continuous mesh centered on specific position
    // Each tile has 4 unique vertices for per-tile color control (checkerboard + mouse fade)
    createContinuousMeshAround(centerX, centerZ) {
        console.log(`[DYNAMIC MESH] Creating mesh centered at (${centerX.toFixed(1)}, ${centerZ.toFixed(1)})`);
        
        const meshSize = this.meshBounds.size;
        const tileSize = 1;
        const tilesPerSide = meshSize;
        
        console.log(`[DYNAMIC MESH] Mesh size: ${meshSize}x${meshSize}, Tiles: ${tilesPerSide}x${tilesPerSide}`);

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
                const height00 = this.getUnifiedTerrainHeight(worldX, worldZ);
                const height10 = this.getUnifiedTerrainHeight(worldX + tileSize, worldZ);
                const height01 = this.getUnifiedTerrainHeight(worldX, worldZ + tileSize);
                const height11 = this.getUnifiedTerrainHeight(worldX + tileSize, worldZ + tileSize);

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
                const grassColor = new THREE.Color(0.3, 0.6, 0.2);
                const tileColor = new THREE.Color().lerpColors(baseTileColor, grassColor, fadeFactor);

                // Create 4 vertices for the tile with slight overlap to eliminate gaps
                const baseIndex = vertices.length / 3;
                const overlap = 0.001;

                // Bottom-left
                vertices.push(worldX - overlap, height00, worldZ - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push(0, 0);

                // Bottom-right
                vertices.push(worldX + tileSize + overlap, height10, worldZ - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push(1, 0);

                // Top-left
                vertices.push(worldX - overlap, height01, worldZ + tileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push(0, 1);

                // Top-right
                vertices.push(worldX + tileSize + overlap, height11, worldZ + tileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                normals.push(0, 1, 0);
                uvs.push(1, 1);

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
        
        // Create mesh with grass texture and vertex colors for grass fade effect
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,   // Enable vertex colors for grass fade effect
            map: this.grassTexture,
            side: THREE.DoubleSide,
            roughness: 0.9,
            metalness: 0.0
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'dynamicContinuousMesh';
        mesh.receiveShadow = true;   // Enable receiving shadows from other models
        mesh.castShadow = false;      // Disable self-shadowing to avoid ripple effect
        
        console.log(`[DYNAMIC MESH] Created mesh with ${vertices.length/3} vertices, ${indices.length/3} triangles`);
        
        return mesh;
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
        
        // Intersect with board meshes
        const intersects = raycaster.intersectObjects(boardMeshes);



        



        if (intersects.length > 0) {



            // Use the first intersection point with board geometry



            this.mouseWorldPosition.copy(intersects[0].point);
            // console.log(`[MOUSE WORLD] Intersect hit: ${this.mouseWorldPosition.x.toFixed(2)}, ${this.mouseWorldPosition.z.toFixed(2)}`);



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
                // console.log(`[STREAMING DEBUG] Updated mouse world pos: ${this.mouseWorldPosition.x.toFixed(2)}, ${this.mouseWorldPosition.z.toFixed(2)}`);

            // Update mesh colors based on mouse position
            if (this.needsFadeUpdate) {
                this.updateContinuousMeshColors();
                this.needsFadeUpdate = false;
            }
            
            // Check if mesh needs regeneration based on camera movement
            this.updateDynamicMesh(cameraPosition);
            
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
                
                // UV coordinates
                uvs.push(x / verticesX, z / verticesZ);
                
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
            map: this.grassTexture,  // Re-enable texture now that lighting works
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
                var grassColor = new THREE.Color(0.3, 0.6, 0.2);
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
                var overlap = 0.001; // Tiny overlap to ensure no gaps
                
                // Bottom-left
                vertices.push(x * actualTileSize - overlap, height00, z * actualTileSize - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push(x / tilesPerChunk, z / tilesPerChunk);
                
                // Bottom-right
                vertices.push((x + 1) * actualTileSize + overlap, height10, z * actualTileSize - overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push((x + 1) / tilesPerChunk, z / tilesPerChunk);
                
                // Top-left
                vertices.push(x * actualTileSize - overlap, height01, z * actualTileSize + actualTileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push(x / tilesPerChunk, (z + 1) / tilesPerChunk);
                
                // Top-right
                vertices.push((x + 1) * actualTileSize + overlap, height11, z * actualTileSize + actualTileSize + overlap);
                colors.push(tileColor.r, tileColor.g, tileColor.b);
                uvs.push((x + 1) / tilesPerChunk, (z + 1) / tilesPerChunk);
                
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
                        var grassColor = new THREE.Color(0.3, 0.6, 0.2);
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
                uvs.push(x / this.chunkSize, z / this.chunkSize);
                
                // Bottom-right
                vertices.push(x + stepSize, height10, z);
                colors.push(avgR, avgG, avgB);
                uvs.push((x + stepSize) / this.chunkSize, z / this.chunkSize);
                
                // Top-left
                vertices.push(x, height01, z + stepSize);
                colors.push(avgR, avgG, avgB);
                uvs.push(x / this.chunkSize, (z + stepSize) / this.chunkSize);
                
                // Top-right
                vertices.push(x + stepSize, height11, z + stepSize);
                colors.push(avgR, avgG, avgB);
                uvs.push((x + stepSize) / this.chunkSize, (z + stepSize) / this.chunkSize);
                
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
        const point = intersection.point;
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
                const grassColor = new THREE.Color(0.3, 0.6, 0.2);
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
