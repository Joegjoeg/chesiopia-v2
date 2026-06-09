class DecorativeVisualsSystem {
    constructor(scene, terrainSystem, game) {
        this._debug = false; // Set true for verbose decorative visual logs
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.game = game; // Store game reference for mouse access
        
        // Navi system (reused bird/book pool names)
        this.birdPool = []; // Object pool for birds
        this.activeBirds = new Map(); // Active birds in scene
        this.maxBirds = 12; // Target bird population
        this.minHeight = 3; // Minimum height above ground
        this.maxHeight = 8; // Maximum height above ground
        this.birdSpawnRadius = 60; // Spawn radius around camera
        
        // Camera position for fade calculations
        this.cameraPosition = new THREE.Vector3(0, 0, 0);

        // Global wind system (Ghost of Yōtei style)
        this.windTime = 0; // Time variable for wind simulation
        this.windAngle = Math.random() * Math.PI * 2; // Slowly wandering wind heading
        this.windTargetAngle = this.windAngle;
        this.windDirection = new THREE.Vector2(1, 0.3).normalize();
        this.windSpeed = 2.0; // Base wind speed (cycles per second)
        this.windGustStrength = 1.0;

        // Gust system (simplified - temporary wind speed boosts)
        this.gustIntensity = 0.0; // Current gust multiplier (1.0 = no gust, >1.0 = gusting)
        this.gustTargetIntensity = 0.0; // Target gust intensity
        this.gustDecayRate = 0.5; // How fast gusts decay
        this.gustSpawnTimer = 0; // Timer for spawning new gusts
        this.gustSpawnInterval = 8.0; // Average time between gust spawns (seconds)

        // Wind particle field (leaves, twigs, dust debris)
        this.windParticles = null;
        this._initWindParticles();

        // Initialize panic sound variations
        this.panicSounds = [
            'hu?', 'oop!', 'yelp!', 'eep!', 'ah!', 'oh!', 'wa!', 'yi!', 'ee!', 'oo!'
        ];
        
        // Initialize systems deferred — terrain isn't ready at constructor time anyway
        setTimeout(() => this.initializeBirds(), 5000);

        // One-time cleanup: remove any existing birdDebugSphere meshes from previous sessions
        setTimeout(() => this._cleanupLegacyDebugSpheres(), 1000);

        // LODManager scratch vector for position callbacks (shared, no allocation)
        this._lodScratchPos = new THREE.Vector3();
        this._registerLodGroup();
    }

    _registerLodGroup() {
        const lm = this.game?.lodManager;
        if (!lm) return;
        const posFn = (book) => this._lodScratchPos.set(book.position.x, book.position.y, book.position.z);
        const radiusFn = () => 1.5;
        lm.registerGroup('decorativeBooks', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: 80,
            frustumCull: true,
            getPosition: posFn,
            getBoundsRadius: radiusFn,
            maxVisible: 50,
            updateInterval: 2,
            onCull: (book, id) => {
                if (book._lodVisible === false) return;
                book._lodVisible = false;
                book.sprite.visible = false;
                book.light.visible = false;
                book.glowSprite.visible = false;
            },
            onVisible: (book, id) => {
                if (book._lodVisible === true) return;
                book._lodVisible = true;
                book.sprite.visible = true;
                book.glowSprite.visible = true;
            }
        });
    }
    
    // ---- Navi light management ----
    _getNaviLightCap() {
        const caps = this.game?.deviceCapabilities;
        if (!caps) return 12;
        switch (caps.tier) {
            case 'low': return 0;
            case 'medium': return 4;
            case 'high': return 12;
            default: return 12;
        }
    }

    _isInFrustum(position, margin = 0.35) {
        if (!this.game?.camera) return true;
        const p = position.clone().project(this.game.camera);
        return p.z > -1 && p.z < 1 &&
               p.x > -1 - margin && p.x < 1 + margin &&
               p.y > -1 - margin && p.y < 1 + margin;
    }

    // BIRD SYSTEM
    initializeBirds() {
        console.log('[DecorativeVisuals] Initializing bird system...');
        this.birdPool = []; // Object pool for birds
        this.activeBirds = new Map(); // Active birds in scene
        this.maxBirds = 12; // Target bird population
        this.minHeight = 3; // Minimum height above ground
        this.maxHeight = 8; // Maximum height above ground
        this.birdSpawnRadius = 60; // Spawn radius around camera
        
        // Initialize object pool
        this.initializeBirdPool();
        
        // Spawn initial birds
        this.spawnInitialBirds();
    }
    
    initializeBirdPool() {
        // Create pool of bird objects
        for (let i = 0; i < this.maxBirds; i++) {
            this.birdPool.push(this.createBirdObject());
        }
        console.log(`[DecorativeVisuals] Created bird pool with ${this.birdPool.length} objects`);
    }
    
    createBirdObject() {
        // Create sprite with Tinkerbell/Navi-style gradient texture
        // 128x128 canvas leaves room for a motion trail behind the head
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Create radial gradient for magical glow effect
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 30);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 200, 0.9)');
        gradient.addColorStop(0.4, 'rgba(255, 200, 100, 0.7)');
        gradient.addColorStop(0.6, 'rgba(255, 150, 50, 0.5)');
        gradient.addColorStop(0.8, 'rgba(200, 100, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(100, 50, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        // Create texture from canvas (will be redrawn each frame with trail)
        const texture = new THREE.CanvasTexture(canvas);

        // Create sprite material
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            color: 0xffffff,
            alphaTest: 0.01,
            depthWrite: false
        });
        
        // Create sprite
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.name = 'birdSprite';
        sprite.scale.set(0.125, 0.125, 1); // Size of sprite (reduced by half again)
        sprite.userData.isDecorative = true; // Mark as decorative for vertex profiling

        // Hide initially (in pool)
        sprite.visible = false;

        // Create omni light with falloff for the sprite
        const light = new THREE.PointLight(0x00ffaa, 5, 15, 2); // Blue-green glow, intensity 5, distance 15, decay 2
        light.name = 'birdLight';
        light.position.set(0, 0, 0);
        light.visible = false;

        // Ground glow sprite — illuminates terrain under the fairy
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = 64;
        glowCanvas.height = 64;
        const gCtx = glowCanvas.getContext('2d');
        const glowGrad = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        glowGrad.addColorStop(0.0, 'rgba(0, 255, 170, 0.45)');
        glowGrad.addColorStop(0.5, 'rgba(0, 255, 170, 0.15)');
        glowGrad.addColorStop(1.0, 'rgba(0, 255, 170, 0.0)');
        gCtx.fillStyle = glowGrad;
        gCtx.fillRect(0, 0, 64, 64);
        const glowTex = new THREE.CanvasTexture(glowCanvas);
        const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            alphaTest: 0.01
        }));
        glowSprite.scale.set(6, 6, 1);
        glowSprite.visible = false;

        return {
            group: sprite,
            sprite: sprite,
            light: light,
            glowSprite: glowSprite,
            position: { x: 0, y: 0, z: 0 },
            prevPosition: { x: 0, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            targetPosition: { x: 0, y: 0, z: 0 },
            phase: 0,
            speed: 0.15 + Math.random() * 0.1,
            behavior: 'drifting',
            behaviorTimer: 0,
            noiseOffset: { x: Math.random() * 1000, y: Math.random() * 1000, z: Math.random() * 1000 },
            active: false,
            isFleeing: false,
            isPanicking: false,
            fleeTimer: 0,
            pauseTimer: 0,
            panicTimer: 0,
            panicZips: 0,
            panicTarget: { x: 0, z: 0 },
            zipPauseTimer: 0,
            isZipPaused: false,
            fleeDirection: { x: 0, z: 0 },
            // Trail rendering state
            trailCanvas: canvas,
            trailCtx: ctx,
            trailTime: 0
        };
    }
    
    spawnInitialBirds() {
        // Spawn initial magical books from pool
        for (let i = 0; i < this.maxBirds; i++) {
            this.spawnBook();
        }
        console.log(`[DecorativeVisuals] Spawned ${this.activeBirds.size} initial magical books`);
    }

    _cleanupLegacyDebugSpheres() {
        // Remove any lingering birdDebugSphere meshes from scene
        const toRemove = [];
        this.scene.traverse((child) => {
            if (child.name === 'birdDebugSphere') {
                toRemove.push(child);
            }
        });
        for (const mesh of toRemove) {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        }
        if (toRemove.length > 0) {
            console.log(`[DecorativeVisuals] Cleaned up ${toRemove.length} legacy birdDebugSphere meshes`);
        }
    }
    
    spawnBook() {
        if (this.birdPool.length === 0) return null;
        
        const book = this.birdPool.pop();
        const id = `book_${Date.now()}_${Math.random()}`;
        
        // Random position within spawn radius
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * this.birdSpawnRadius;
        const x = this.cameraPosition.x + Math.cos(angle) * distance;
        const z = this.cameraPosition.z + Math.sin(angle) * distance;
        
        // Get ground height and add book height
        const groundHeight = this.terrainSystem ? this.terrainSystem.getHeight(x, z) : 0;
        const height = groundHeight + this.minHeight + Math.random() * (this.maxHeight - this.minHeight);
        
        // Position book
        book.position = { x, y: height, z };
        book.prevPosition = { x, y: height, z };
        book.group.position.set(x, height, z);
        book.group.visible = true;
        book.light.visible = true;
        book.active = true;
        
        // Set initial magical velocity
        book.velocity = {
            x: (Math.random() - 0.5) * 0.025,
            y: (Math.random() - 0.5) * 0.012,
            z: (Math.random() - 0.5) * 0.025
        };
        
        // Set random magical target
        book.targetPosition = {
            x: x + (Math.random() - 0.5) * 40,
            y: height + (Math.random() - 0.5) * 3,
            z: z + (Math.random() - 0.5) * 40
        };
        
        // Random initial magical behavior
        const behaviors = ['drifting', 'circling', 'swooping', 'hovering'];
        book.behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
        book.behaviorTimer = 3 + Math.random() * 5; // 3-8 seconds per behavior
        
        // Add to scene and active books
        this.scene.add(book.group);
        this.scene.add(book.light);
        this.scene.add(book.glowSprite);
        book.glowSprite.visible = true;
        this.activeBirds.set(id, book);
        book._lodVisible = true;

        const lm = this.game?.lodManager;
        if (lm) lm.add('decorativeBooks', book, id);

        if (this._debug) console.log(`[Fairy] Spawned ${id} — light visible: ${book.light.visible}, color: #${book.light.color.getHexString()}, intensity: ${book.light.intensity}, distance: ${book.light.distance}, pos: ${x.toFixed(1)},${height.toFixed(1)},${z.toFixed(1)}`);

        return id;
    }
    
    despawnBird(id) {
        const bird = this.activeBirds.get(id);
        if (!bird) return;

        const lm = this.game?.lodManager;
        if (lm) lm.remove('decorativeBooks', id);

        // Remove from scene
        this.scene.remove(bird.group);
        this.scene.remove(bird.light);  // Remove sprite's omni light from scene
        bird.group.visible = false;
        bird.light.visible = false;
        bird.active = false;

        // Return to pool
        this.activeBirds.delete(id);
        this.birdPool.push(bird);
    }
    
    // UPDATE METHODS
    updateCameraPosition(cameraPosition) {
        this.cameraPosition.copy(cameraPosition);
    }
    
    update(deltaTime) {
        // Update wind time (controls all wind animations)
        this.windTime += deltaTime * 1.2;

        const ps = window.parameterSystem;
        const blustery = ps ? (ps.getParameter('blusteryWind') || 0) : 0;
        const b = blustery / 10.0; // normalized 0..1

        // Read terrain-derived wind from WeatherDirector (pressure-gradient based)
        const wd = this.game?.weatherDirector?.getSnapshot();
        const terrainWindSpeed = wd ? wd.windSpeed : 0;
        const terrainWindAngle = wd ? wd.windDirection : null;

        // Choose wind target: minimap local wind wins, then terrain, then parameterSystem slider
        const localWind = window.minimapOverlay?.localWind;
        if (localWind && localWind.speed > 0.1) {
            this.windTargetAngle = localWind.angle;
        } else if (terrainWindAngle !== null) {
            this.windTargetAngle = terrainWindAngle;
        } else if (ps) {
            this.windTargetAngle = ps.getWindDirection();
        }

        // Steer toward windTargetAngle (set by parameter slider or minimap wind) while keeping organic noise
        let angleDiff = this.windTargetAngle - this.windAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        const baseAngleNoise = Math.sin(this.windTime * 0.08) * 0.5 + Math.sin(this.windTime * 0.023) * 0.3 + Math.sin(this.windTime * 0.004) * 0.2;
        const blusteryAngleNoise = b * (Math.sin(this.windTime * 0.5) * 2.0 + Math.sin(this.windTime * 0.18) * 1.2 + Math.sin(this.windTime * 0.05) * 0.6);
        const angleNoise = baseAngleNoise * (1 - b) + blusteryAngleNoise;
        const targetInfluence = 0.8 * (1 - b * 0.7);
        const noiseInfluence = 0.2 + b * 1.5;
        const turnRate = 1.2 + b * 0.8; // fast steering so local wind direction is actually followed
        this.windAngle += (angleDiff * targetInfluence + angleNoise * noiseInfluence) * deltaTime * turnRate;
        this.windDirection.set(Math.cos(this.windAngle), Math.sin(this.windAngle));

        // Wind speed base comes from parameterSystem; natural noise adds variation on top
        const paramWind = ps ? ps.getParameter('windSpeed') : 2.0;
        const localSpeed = localWind ? localWind.speed : 0;
        const terrainSpeed = terrainWindSpeed * 4.0; // scale up from WeatherDirector units
        const baseWind = paramWind + localSpeed * 0.5 + terrainSpeed;
        const baseSpeedNoise = (Math.sin(this.windTime * 0.3) * 0.8 + Math.sin(this.windTime * 0.17) * 0.4) * (baseWind / 2.0);
        const blusterySpeedNoise = b * (Math.sin(this.windTime * 0.4) * baseWind * 2.0 + Math.sin(this.windTime * 0.12) * baseWind);
        const galeBoost = b * baseWind * 1.5;
        this.windSpeed = Math.max(0, baseWind + baseSpeedNoise * (1 - b) + blusterySpeedNoise + galeBoost);

        // Update gust system
        this.updateGusts(deltaTime);

        // Calculate effective wind speed (base + gust)
        const effectiveWindSpeed = this.windSpeed * this.gustIntensity;

        // Update wind compass UI
        const windArrow = document.getElementById('windArrow');
        if (windArrow) {
            const windAngle = Math.atan2(this.windDirection.y, this.windDirection.x);
            // Get camera rotation (yaw) to make wind direction relative to viewport
            let cameraYaw = 0;
            if (this.game && this.game.camera) {
                // Get camera's forward direction projected onto XZ plane
                const forward = new THREE.Vector3(0, 0, -1);
                forward.applyQuaternion(this.game.camera.quaternion);
                cameraYaw = Math.atan2(forward.z, forward.x);
            }
            // Wind direction relative to camera: subtract camera yaw from wind angle
            const relativeAngle = windAngle - cameraYaw;
            const degrees = relativeAngle * (180 / Math.PI);
            // Scale arrow size based on effective wind speed (origin at tip, so scale from top)
            const scale = Math.max(0.5, Math.min(2.0, effectiveWindSpeed / 2.0));
            windArrow.style.transform = `rotate(${degrees}deg) scale(${scale})`;
        }
        const windSpeedEl = document.getElementById('windSpeed');
        if (windSpeedEl) {
            windSpeedEl.textContent = effectiveWindSpeed.toFixed(1);
        }

        this.updateBirds(deltaTime);
        this.maintainBookPopulation();

        // Update wind debris particles
        this._updateWindParticles(deltaTime);

        // Sync wind audio to visual intensity
        if (window.soundManager) {
            window.soundManager.updateWindIntensity(
                this.windSpeed || 0,
                this.gustIntensity || 1
            );
        }
    }

    updateGusts(deltaTime) {
        const ps = window.parameterSystem;
        const blustery = ps ? (ps.getParameter('blusteryWind') || 0) : 0;
        const b = blustery / 10.0;

        // Decay current gust intensity toward target
        if (this.gustIntensity > this.gustTargetIntensity) {
            this.gustIntensity -= this.gustDecayRate * deltaTime;
            if (this.gustIntensity < this.gustTargetIntensity) {
                this.gustIntensity = this.gustTargetIntensity;
            }
        } else if (this.gustIntensity < this.gustTargetIntensity) {
            this.gustIntensity += this.gustDecayRate * deltaTime;
            if (this.gustIntensity > this.gustTargetIntensity) {
                this.gustIntensity = this.gustTargetIntensity;
            }
        }

        // Spawn new gusts periodically
        this.gustSpawnTimer += deltaTime;
        if (this.gustSpawnTimer >= this.gustSpawnInterval) {
            this.gustSpawnTimer = 0;
            // Randomize next interval (gusts are irregular)
            const intervalBase = 5.0 + Math.random() * 8.0; // 5-13 seconds between gusts
            this.gustSpawnInterval = intervalBase * (1 - b * 0.85); // much more frequent when blustery

            // Higher chance to spawn a gust when blustery
            if (Math.random() < (0.4 + b * 0.5)) {
                this.spawnGust();
            }
        }
    }

    spawnGust() {
        const ps = window.parameterSystem;
        const blustery = ps ? (ps.getParameter('blusteryWind') || 0) : 0;
        const b = blustery / 10.0;
        // Random gust intensity: 1.5x to 3.5x wind speed, plus blustery boost
        const gustMultiplier = 1.5 + Math.random() * 2.0 + b * 3.0;
        this.gustTargetIntensity = gustMultiplier;

        // Gust lasts 2-5 seconds before starting to decay
        const gustDuration = 2.0 + Math.random() * 3.0;
        setTimeout(() => {
            this.gustTargetIntensity = 1.0; // Return to normal
        }, gustDuration * 1000);

        // gust spawned silently
    }
    
    updateBirds(deltaTime) {
        if (!this._naviTrailLogDone) {
            console.log(`[NaviTrails] updateBirds running — ${this.activeBirds.size} active, lightCap=${this._getNaviLightCap()}`);
            this._naviTrailLogDone = true;
        }
        const now = Date.now();
        const time = now * 0.001;
        const lightCap = this._getNaviLightCap();
        const naviEntries = [];

        // Periodic debug dump
        if (!this._naviDebugNext || now > this._naviDebugNext) {
            this._naviDebugNext = now + 2000;
        }

        for (const [id, sprite] of this.activeBirds) {
            // ---- Movement & behaviour (unchanged logic) ----
            sprite.behaviorTimer -= deltaTime;
            if (sprite.behaviorTimer <= 0) {
                const behaviors = ['drifting', 'circling', 'swooping', 'hovering'];
                sprite.behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
                sprite.behaviorTimer = 3 + Math.random() * 5;
            }
            this.checkMouseAvoidance(sprite, deltaTime);

            if (!sprite.isFleeing && !sprite.isPanicking) {
                switch (sprite.behavior) {
                    case 'drifting':
                        sprite.velocity.x = this.simplexNoise(time + sprite.noiseOffset.x) * 0.025;
                        sprite.velocity.z = this.simplexNoise(time + sprite.noiseOffset.z) * 0.025;
                        sprite.velocity.y = this.simplexNoise(time + sprite.noiseOffset.y) * 0.008;
                        break;
                    case 'circling':
                        {
                            const angle = time * 0.4 + sprite.noiseOffset.x;
                            sprite.velocity.x = Math.cos(angle) * 12 * 0.012;
                            sprite.velocity.z = Math.sin(angle) * 12 * 0.012;
                            sprite.velocity.y = Math.sin(time * 2 + sprite.noiseOffset.y) * 0.005;
                        }
                        break;
                    case 'swooping':
                        {
                            const swoopPhase = time * 0.6 + sprite.noiseOffset.x;
                            sprite.velocity.x = Math.cos(swoopPhase) * 0.04;
                            sprite.velocity.z = Math.sin(swoopPhase * 0.8) * 0.03;
                            sprite.velocity.y = Math.sin(swoopPhase * 2.5) * 0.02;
                        }
                        break;
                    case 'hovering':
                        sprite.velocity.x = Math.sin(time * 4 + sprite.noiseOffset.x) * 0.008;
                        sprite.velocity.z = Math.cos(time * 4 + sprite.noiseOffset.z) * 0.008;
                        sprite.velocity.y = Math.sin(time * 6 + sprite.noiseOffset.y) * 0.01;
                        break;
                }
            }

            // Store previous position for trail vector
            sprite.prevPosition.x = sprite.position.x;
            sprite.prevPosition.y = sprite.position.y;
            sprite.prevPosition.z = sprite.position.z;

            this.updateBookPosition(sprite, deltaTime);

            // Skip rendering for LODManager-culled books (keep updating position so they don't freeze)
            if (sprite._lodVisible === false) continue;

            // ---- Canvas trail rendering ----
            const ctx = sprite.trailCtx;
            const canvas = sprite.trailCanvas;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Compute screen-space motion vector
            let trailAngle = 0;
            let trailStrength = 0;
            if (this.game?.camera) {
                const cam = this.game.camera;
                const prevProj = new THREE.Vector3(sprite.prevPosition.x, sprite.prevPosition.y, sprite.prevPosition.z).project(cam);
                const currProj = new THREE.Vector3(sprite.position.x, sprite.position.y, sprite.position.z).project(cam);
                const sdx = currProj.x - prevProj.x;
                const sdy = currProj.y - prevProj.y;
                const len = Math.sqrt(sdx * sdx + sdy * sdy);
                // Smooth trail strength so it doesn't flicker on micro-movement
                const rawStrength = Math.min(len * 300, 1);
                sprite._smoothTrail = (sprite._smoothTrail || 0) * 0.85 + rawStrength * 0.15;
                trailStrength = sprite._smoothTrail;
                trailAngle = Math.atan2(sdy, sdx) + Math.PI; // opposite = trail direction
            }

            const headX = 64;
            const headY = 64;
            const maxTrailLen = 90 * trailStrength;

            // Draw trail as fading blobs
            if (maxTrailLen > 1) {
                const segments = 8;
                for (let i = 1; i <= segments; i++) {
                    const t = i / segments;
                    const dist = maxTrailLen * t;
                    const tx = headX + Math.cos(trailAngle) * dist;
                    const ty = headY + Math.sin(trailAngle) * dist;
                    const radius = 35 * (1 - t * 0.7);
                    const alpha = 1.0 * (1 - t) * trailStrength;
                    const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, radius);
                    grad.addColorStop(0, `rgba(255, 255, 230, ${alpha})`);
                    grad.addColorStop(0.4, `rgba(255, 210, 120, ${alpha * 0.8})`);
                    grad.addColorStop(1, `rgba(255, 160, 60, 0)`);
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(tx, ty, radius, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Draw head (pulsing)
            const velocityMag = Math.sqrt(
                sprite.velocity.x * sprite.velocity.x +
                sprite.velocity.y * sprite.velocity.y +
                sprite.velocity.z * sprite.velocity.z
            );
            const speedMul = 1.0 + velocityMag * 10;
            sprite.phase += sprite.speed * speedMul;
            const pulse = Math.sin(sprite.phase) * 0.12 + 0.88;

            const headGrad = ctx.createRadialGradient(headX, headY, 0, headX, headY, 55);
            headGrad.addColorStop(0, `rgba(255, 255, 255, ${pulse})`);
            headGrad.addColorStop(0.25, `rgba(255, 255, 200, ${pulse * 0.9})`);
            headGrad.addColorStop(0.55, `rgba(255, 200, 100, ${pulse * 0.6})`);
            headGrad.addColorStop(0.85, `rgba(200, 100, 255, ${pulse * 0.25})`);
            headGrad.addColorStop(1, `rgba(100, 50, 255, 0)`);
            ctx.fillStyle = headGrad;
            ctx.beginPath();
            ctx.arc(headX, headY, 50, 0, Math.PI * 2);
            ctx.fill();

            // Deterministic sparkles based on phase
            ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
            for (let i = 0; i < 6; i++) {
                const sx = headX + Math.sin(sprite.phase * 3 + i * 1.7) * 50;
                const sy = headY + Math.cos(sprite.phase * 2.3 + i * 2.1) * 50;
                const size = 5 + Math.sin(sprite.phase * 4 + i) * 3;
                ctx.fillRect(sx, sy, size, size);
            }

            // DEBUG: bright red corner dot — if canvas updates this MUST be visible
            ctx.fillStyle = 'rgba(255, 0, 0, 1.0)';
            ctx.fillRect(2, 2, 24, 24);

            sprite.sprite.material.map.needsUpdate = true;

            // ---- Distance-based scaling & fading ----
            const dx = sprite.sprite.position.x - this.cameraPosition.x;
            const dy = sprite.sprite.position.y - this.cameraPosition.y;
            const dz = sprite.sprite.position.z - this.cameraPosition.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Base scale from distance to keep roughly constant screen size
            // (old code was fixed ~0.45; we scale proportionally to distance)
            const baseScale = Math.max(0.08, distance * 0.022);
            const finalScale = baseScale * pulse;
            sprite.sprite.scale.set(finalScale, finalScale, 1);
            sprite.glowSprite.scale.set(baseScale * 4, baseScale * 4, 1);

            // Distance fade — start fully opaque nearby, fade to 0.15 far away
            const fadeStart = 10.67;
            const fadeEnd = 45;
            let opacity = 1.0;
            if (distance > fadeStart) {
                opacity = Math.max(0.15, 1.0 - (distance - fadeStart) / (fadeEnd - fadeStart));
            }
            sprite.sprite.material.opacity = opacity;

            // Bobbing
            sprite.sprite.position.y += Math.sin(Date.now() * 0.002 + sprite.noiseOffset.y) * 0.1;

            // Sync light & glow positions
            sprite.light.position.copy(sprite.sprite.position);
            sprite.glowSprite.position.copy(sprite.sprite.position);

            // Collect for light culling
            naviEntries.push({
                id, sprite,
                dist: distance,
                inView: this._isInFrustum(sprite.sprite.position, 0.35)
            });
        }

        // ---- Device-tier light culling ----
        naviEntries.sort((a, b) => a.dist - b.dist);
        let enabledLights = 0;
        for (const entry of naviEntries) {
            const shouldLight = entry.inView && enabledLights < lightCap;
            entry.sprite.light.visible = shouldLight;
            if (shouldLight) enabledLights++;
        }
    }
    
    checkMouseAvoidance(sprite, deltaTime) {
        // Get mouse position in world coordinates
        const mouseWorldPos = this.getMouseWorldPosition();
        
        // Debug: Log mouse position status
        if (!mouseWorldPos) {
            console.log('[DEBUG] No mouse world position available');
            return;
        }
        
        // Calculate distance to mouse (using fade start distance as avoidance radius)
        const fadeStartDistance = 3; // Same as fade start distance from volume settings
        const distanceToMouse = Math.sqrt(
            Math.pow(sprite.position.x - mouseWorldPos.x, 2) +
            Math.pow(sprite.position.z - mouseWorldPos.z, 2)
        );
        
        // Debug: Log distance check (disabled - too spammy even at 1%)
        if (false && Math.random() < 0.01) { // Log 1% of the time
            console.log('[DEBUG] Mouse avoidance check:', {
                mousePos: `(${mouseWorldPos.x.toFixed(2)}, ${mouseWorldPos.z.toFixed(2)})`,
                spritePos: `(${sprite.position.x.toFixed(2)}, ${sprite.position.z.toFixed(2)})`,
                distance: distanceToMouse.toFixed(2),
                threshold: fadeStartDistance,
                isFleeing: sprite.isFleeing,
                pauseTimer: sprite.pauseTimer.toFixed(2)
            });
        }
        
        if (sprite.isFleeing) {
            // Currently fleeing - update flee behavior
            sprite.fleeTimer -= deltaTime;
            
            if (sprite.fleeTimer <= 0) {
                // Stop fleeing, return to normal behavior
                sprite.isFleeing = false;
                sprite.behaviorTimer = 2 + Math.random() * 3; // Resume normal behavior soon
            } else {
                // Continue fleeing with high speed
                const fleeSpeed = 0.25; // Increased flee speed for more dramatic escape
                sprite.velocity.x = sprite.fleeDirection.x * fleeSpeed;
                sprite.velocity.z = sprite.fleeDirection.z * fleeSpeed;
                sprite.velocity.y = (Math.random() - 0.5) * 0.03; // More vertical variation
            }
        } else if (sprite.isPanicking) {
            // Currently panicking - do frantic zipping with pauses
            sprite.panicTimer -= deltaTime;
            
            if (sprite.panicTimer <= 0 || sprite.panicZips >= 3) {
                // Finished panicking, start fleeing
                sprite.isPanicking = false;
                sprite.isZipPaused = false;
                sprite.isFleeing = true;
                sprite.fleeTimer = 1.5 + Math.random() * 1; // Flee for 1.5-2.5 seconds
                
                // Calculate flee direction (away from mouse)
                const dx = sprite.position.x - mouseWorldPos.x;
                const dz = sprite.position.z - mouseWorldPos.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                
                if (distance > 0.001) {
                    sprite.fleeDirection.x = dx / distance;
                    sprite.fleeDirection.z = dz / distance;
                } else {
                    // Random direction if exactly on mouse
                    const angle = Math.random() * Math.PI * 2;
                    sprite.fleeDirection.x = Math.cos(angle);
                    sprite.fleeDirection.z = Math.sin(angle);
                }
            } else {
                // Handle zip pauses
                if (sprite.isZipPaused) {
                    sprite.zipPauseTimer -= deltaTime;
                    if (sprite.zipPauseTimer <= 0) {
                        sprite.isZipPaused = false;
                        // Resume movement to next target
                        const newDx = sprite.panicTarget.x - sprite.position.x;
                        const newDz = sprite.panicTarget.z - sprite.position.z;
                        const newDist = Math.sqrt(newDx * newDx + newDz * newDz);
                        
                        if (newDist > 0.001) {
                            const zipSpeed = 0.35; // Very fast zipping
                            sprite.velocity.x = (newDx / newDist) * zipSpeed;
                            sprite.velocity.z = (newDz / newDist) * zipSpeed;
                            sprite.velocity.y = (Math.random() - 0.5) * 0.04; // Erratic vertical movement
                        }
                    } else {
                        // Still paused - zero velocity
                        sprite.velocity.x = 0;
                        sprite.velocity.y = 0;
                        sprite.velocity.z = 0;
                    }
                } else {
                    // Check if we reached current panic target
                    const dx = sprite.panicTarget.x - sprite.position.x;
                    const dz = sprite.panicTarget.z - sprite.position.z;
                    const distToTarget = Math.sqrt(dx * dx + dz * dz);
                    
                    if (distToTarget < 1.0 || sprite.panicTimer < 0.15) {
                        // Reached target or time for new zip - start pause then pick new point
                        // console.log('[ZIP ANIMATION] Reached target, pausing before next zip');
                        sprite.isZipPaused = true;
                        sprite.zipPauseTimer = 0.5; // Pause for 0.5 seconds between zips
                        
                        if (sprite.panicZips < 3) {
                            sprite.panicZips++;
                            const panicRadius = 5; // Increased radius for wider movement
                            const angle = Math.random() * Math.PI * 2;
                            sprite.panicTarget.x = sprite.position.x + Math.cos(angle) * panicRadius;
                            sprite.panicTarget.z = sprite.position.z + Math.sin(angle) * panicRadius;
                        }
                        
                        // Zero velocity during pause
                        sprite.velocity.x = 0;
                        sprite.velocity.y = 0;
                        sprite.velocity.z = 0;
                    }
                }
            }
        } else if (distanceToMouse < fadeStartDistance) {
            // Mouse is too close - start avoidance sequence
            if (sprite.pauseTimer <= 0) {
                // Start pause
                sprite.pauseTimer = 0.3; // Pause for 0.3 seconds
                sprite.velocity.x *= 0.1; // Slow down dramatically
                sprite.velocity.z *= 0.1;
                sprite.velocity.y *= 0.1;
            } else {
                sprite.pauseTimer -= deltaTime;
                
                if (sprite.pauseTimer <= 0) {
                    // Pause finished - start panic zipping!
                    // panic zip started silently
                    sprite.isPanicking = true;
                    sprite.panicTimer = 0.6; // Panic for 0.6 seconds
                    sprite.panicZips = 0;
                    sprite.isZipPaused = false;
                    
                    // Play cute panic sound with distance-based volume
                    const distanceToCamera = Math.sqrt(
                        Math.pow(sprite.position.x - this.cameraPosition.x, 2) +
                        Math.pow(sprite.position.y - this.cameraPosition.y, 2) +
                        Math.pow(sprite.position.z - this.cameraPosition.z, 2)
                    );
                    this.playPanicSound(distanceToCamera);
                    
                    // Set first panic target - random direction away from mouse
                    const awayAngle = Math.atan2(
                        sprite.position.z - mouseWorldPos.z,
                        sprite.position.x - mouseWorldPos.x
                    ) + (Math.random() - 0.5) * Math.PI * 0.5; // Add some randomness
                    
                    const panicRadius = 5; // Increased radius for wider movement
                    sprite.panicTarget.x = sprite.position.x + Math.cos(awayAngle) * panicRadius;
                    sprite.panicTarget.z = sprite.position.z + Math.sin(awayAngle) * panicRadius;
                }
            }
        } else {
            // Mouse is far - reset pause timer
            sprite.pauseTimer = 0;
        }
    }
    
    playPanicSound(distanceToCamera = 0) {
        const randomSound = this.panicSounds[Math.floor(Math.random() * this.panicSounds.length)];
        
        let volume = 0.3;
        if (window.soundManager && window.soundManager.calculateDistanceVolume) {
            volume = window.soundManager.calculateDistanceVolume(distanceToCamera, 0.3);
        } else {
            const fadeStartDistance = 3;
            const fadeEndDistance = 70;
            const minVolume = 0.001;
            if (distanceToCamera > fadeStartDistance) {
                const fadeProgress = Math.min((distanceToCamera - fadeStartDistance) / (fadeEndDistance - fadeStartDistance), 1);
                volume = 0.3 * (1 - fadeProgress) + minVolume * fadeProgress;
            }
        }
        
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(randomSound);
            utterance.pitch = 1.8; // High pitch for cute sound
            utterance.rate = 1.2; // Slightly fast for startled effect
            utterance.volume = volume;
            utterance.lang = 'en-US';
            
            // Try to use a female voice which sounds more cute/fairy-like
            const voices = speechSynthesis.getVoices();
            const femaleVoice = voices.find(voice => 
                voice.name.includes('Female') || 
                voice.name.includes('Samantha') || 
                voice.name.includes('Karen') ||
                voice.lang.includes('female')
            );
            if (femaleVoice) {
                utterance.voice = femaleVoice;
            }
            
            speechSynthesis.speak(utterance);
        }
    }
    
    getMouseWorldPosition() {
        // Method 1: Try board system mouse position (this works based on console logs)
        if (this.game && this.game.boardSystem && this.game.boardSystem.mouseWorldPosition) {
            return this.game.boardSystem.mouseWorldPosition;
        }
        
        // Method 2: Check game.mouseWorldPosition
        if (this.game && this.game.mouseWorldPosition) {
            return this.game.mouseWorldPosition;
        }
        
        // Method 3: Try to calculate from camera and raycaster if available
        if (this.game && this.game.camera && this.game.mouse) {
            const camera = this.game.camera;
            const mouse = this.game.mouse;
            
            // Create raycaster from camera through mouse position
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);
            
            // Intersect with ground plane (y=0)
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersection = new THREE.Vector3();
            
            if (raycaster.ray.intersectPlane(plane, intersection)) {
                return intersection;
            }
        }
        
        // Method 4: Debug logging to see what's available
        if (Math.random() < 0.001) { // Very occasional debug
            console.log('[DEBUG] Mouse position debug:', {
                hasGame: !!this.game,
                hasBoardSystem: !!(this.game && this.game.boardSystem),
                boardSystemMousePos: !!(this.game && this.game.boardSystem && this.game.boardSystem.mouseWorldPosition),
                hasMouseWorldPos: !!(this.game && this.game.mouseWorldPosition),
                hasCamera: !!(this.game && this.game.camera),
                hasMouse: !!(this.game && this.game.mouse)
            });
        }
        
        return null;
    }
    
    updateBookPosition(book, deltaTime) {
        // Update position
        book.position.x += book.velocity.x;
        book.position.z += book.velocity.z;
        
        // Get ground height at book position
        const groundHeight = this.terrainSystem ? this.terrainSystem.getHeight(book.position.x, book.position.z) : 0;
        
        // Smoothly track terrain height with floating offset
        const targetHeight = groundHeight + this.minHeight + Math.abs(book.velocity.y) * 2;
        
        // Smooth interpolation to target height
        const heightLerpFactor = 0.1; // Smooth tracking speed
        book.position.y += (targetHeight - book.position.y) * heightLerpFactor;
        
        // Add gentle floating movement
        book.position.y += book.velocity.y;
        
        // Update sprite position
        book.sprite.position.set(book.position.x, book.position.y, book.position.z);
    }
    
    updateBookOrientation(book) {
        // Calculate movement direction
        const speed = Math.sqrt(book.velocity.x * book.velocity.x + book.velocity.z * book.velocity.z);
        
        if (speed > 0.001) {
            // Yaw follows movement direction - books tilt toward movement
            const targetYaw = Math.atan2(book.velocity.x, book.velocity.z);
            book.group.rotation.y += (targetYaw - book.group.rotation.y) * 0.1; // Smooth rotation
            
            // Subtle roll for banking during turns (magical books wobble)
            const rollAmount = Math.sin(Date.now() * 0.001 + book.noiseOffset.x) * 0.15;
            book.group.rotation.z += (rollAmount - book.group.rotation.z) * 0.05;
            
            // Books tilt forward/back based on velocity
            const pitchAmount = Math.sin(Date.now() * 0.002 + book.noiseOffset.y) * 0.1;
            book.group.rotation.x += (pitchAmount - book.group.rotation.x) * 0.03;
        }
    }
    
    maintainBookPopulation() {
        // Check if books are too far from camera and despawn
        const maxDistance = this.birdSpawnRadius * 1.5;
        const booksToDespawn = [];
        
        for (const [id, book] of this.activeBirds) {
            const distance = Math.sqrt(
                Math.pow(book.position.x - this.cameraPosition.x, 2) +
                Math.pow(book.position.z - this.cameraPosition.z, 2)
            );
            
            if (distance > maxDistance) {
                booksToDespawn.push(id);
            }
        }
        
        // Despawn distant books
        for (const id of booksToDespawn) {
            this.despawnBook(id);
        }
        
        // Spawn new books to maintain population
        while (this.activeBirds.size < this.maxBirds && this.birdPool.length > 0) {
            if (!this.spawnBook()) break;
        }
    }
    
    // Simple noise function for smooth movement
    simplexNoise(x) {
        // Simplified noise function (in real implementation, use proper simplex noise)
        return Math.sin(x * 0.1) * Math.cos(x * 0.07) * Math.sin(x * 0.13);
    }
    
    // CLEANUP METHODS
    dispose() {
        // Clear LODManager group
        const lm = this.game?.lodManager;
        if (lm && lm.groups) {
            const group = lm.groups.get('decorativeBooks');
            if (group) group.items.clear();
        }

        // Remove all magical books (return to pool)
        for (const [id, book] of this.activeBirds) {
            this.scene.remove(book.group);
            this.scene.remove(book.light);
            this.scene.remove(book.glowSprite);
            book.group.visible = false;
            book.light.visible = false;
            book.glowSprite.visible = false;
            book.active = false;
            this.birdPool.push(book);
        }
        this.activeBirds.clear();

        // Dispose book pool objects
        this.disposeBookPool();

        // Dispose wind particles
        this._disposeWindParticles();
    }

    despawnBook(id) {
        const book = this.activeBirds.get(id);
        if (!book) return;

        const lm = this.game?.lodManager;
        if (lm) lm.remove('decorativeBooks', id);

        // Remove from scene
        this.scene.remove(book.group);
        this.scene.remove(book.light);
        this.scene.remove(book.glowSprite);
        book.group.visible = false;
        book.light.visible = false;
        book.glowSprite.visible = false;
        book.active = false;

        // Return to pool
        this.activeBirds.delete(id);
        this.birdPool.push(book);
    }

    // Dispose book pool objects
    disposeBookPool() {
        for (const book of this.birdPool) {
            book.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            if (book.light) {
                if (book.light.geometry) book.light.geometry.dispose();
                if (book.light.material) book.light.material.dispose();
            }
            if (book.glowSprite) {
                if (book.glowSprite.material) book.glowSprite.material.dispose();
                if (book.glowSprite.material.map) book.glowSprite.material.map.dispose();
            }
        }
        this.birdPool.length = 0;
    }

    // ================================
    // WIND PARTICLE FIELD
    // ================================

    _initWindParticles() {
        if (!this.scene) return;
        const qualityLevel = this.game?.performanceManager?.qualityLevel ?? 4;
        const qualityMaxParticles = [25, 60, 100, 150, 200][qualityLevel] || 200;
        const maxParticles = qualityMaxParticles;

        this.windParticles = {
            enabled: true,
            maxParticles,
            active: [],
            pool: [],
            mesh: null,
            spawnTimer: 0,
            spawnInterval: 0.15,
            boundsRadius: 40,
            boundsHeight: 18,
            _dummy: new THREE.Object3D(),
            _windVec: new THREE.Vector3(),
            _scratchPos: new THREE.Vector3()
        };

        // Shared geometry: small flat quad for leaves/dust/twigs
        const geo = new THREE.PlaneGeometry(1, 1);

        // Procedural leaf texture with alpha mask
        const leafCanvas = document.createElement('canvas');
        leafCanvas.width = 128;
        leafCanvas.height = 128;
        const lctx = leafCanvas.getContext('2d');
        // Transparent background
        lctx.clearRect(0, 0, 128, 128);
        // Leaf shape: ellipse with pointed ends
        lctx.translate(64, 64);
        lctx.scale(1, 1.6);
        lctx.beginPath();
        lctx.arc(0, 0, 52, 0, Math.PI * 2);
        lctx.fillStyle = '#ffffff';
        lctx.fill();
        // Vein line
        lctx.scale(1, 1 / 1.6);
        lctx.beginPath();
        lctx.moveTo(0, -30);
        lctx.lineTo(0, 40);
        lctx.strokeStyle = 'rgba(0,0,0,0.15)';
        lctx.lineWidth = 2;
        lctx.stroke();
        const leafTex = new THREE.CanvasTexture(leafCanvas);
        leafTex.colorSpace = THREE.SRGBColorSpace;

        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: leafTex,
            alphaMap: leafTex,
            alphaTest: 0.3,
            side: THREE.DoubleSide,
            transparent: false,
            depthWrite: false,
            depthTest: false
        });

        const mesh = new THREE.InstancedMesh(geo, mat, maxParticles);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3);
        mesh.name = 'windDebris';
        mesh.frustumCulled = false;
        mesh.renderOrder = 999; // render on top so they're always visible
        mesh.visible = false;
        this.scene.add(mesh);
        this.windParticles.mesh = mesh;

        // Expose test function for console debugging
        window._testWindParticles = () => {
            console.log('[WindParticles] Forcing 10 test particles');
            for (let i = 0; i < 10 && this.windParticles.pool.length > 0; i++) {
                const p = this.windParticles.pool.pop();
                p.active = true;
                p.life = 0;
                p.maxLife = 5;
                p.type = 'leaf';
                p.scale = 0.4 + Math.random() * 0.4;
                p.rotationSpeed = Math.random() * 3;
                p.gustBoost = 0;
                const angle = Math.random() * Math.PI * 2;
                const dist = 5 + Math.random() * 15;
                p.position.set(
                    this.cameraPosition.x + Math.cos(angle) * dist,
                    2 + Math.random() * 8,
                    this.cameraPosition.z + Math.sin(angle) * dist
                );
                p.velocity.set(
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 2
                );
                this.windParticles.active.push(p);
            }
            this.windParticles.mesh.visible = true;
        };

        // Pre-warm pool
        for (let i = 0; i < maxParticles; i++) {
            this.windParticles.pool.push({
                active: false,
                life: 0,
                maxLife: 2 + Math.random() * 3,
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                rotationAxis: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
                rotationSpeed: 0,
                scale: 0.1 + Math.random() * 0.25,
                type: 'leaf', // leaf | twig | dust
                gustBoost: 0
            });
        }
    }

    _updateWindParticles(deltaTime) {
        const wp = this.windParticles;
        if (!wp || !wp.mesh) return;

        const ps = window.parameterSystem;
        const enabled = ps ? (ps.getParameter('windDebrisEnabled') ?? true) : true;
        if (!enabled) {
            wp.mesh.visible = false;
            return;
        }

        const effectiveWind = this.windSpeed * (this.gustIntensity > 1 ? this.gustIntensity : 1);
        const densityMult = ps ? (ps.getParameter('windDebrisDensity') ?? 1.0) : 1.0;
        const sizeMult = ps ? (ps.getParameter('windParticleSize') ?? 1.0) : 1.0;
        const gravMult = ps ? (ps.getParameter('windParticleGravity') ?? 1.0) : 1.0;
        const twigFreq = ps ? (ps.getParameter('windTwigFrequency') ?? 0.15) : 0.15;
        const twigGrav = ps ? (ps.getParameter('windTwigGravity') ?? 1.0) : 1.0;
        const gravFactor = ps ? (ps.getParameter('windGravityFactor') ?? 1.0) : 1.0;
        const spinSpeed = ps ? (ps.getParameter('windSpinSpeed') ?? 1.0) : 1.0;
        const particleColor = ps ? (ps.getParameter('windParticleColor') ?? '#8bc34a') : '#8bc34a';

        // Apply user color to material (cheap check via cached hex)
        if (wp._lastColor !== particleColor) {
            wp._lastColor = particleColor;
            wp._baseColor = new THREE.Color(particleColor);
        }
        const baseColor = wp._baseColor || new THREE.Color(0x8bc34a);
        const twigColor = new THREE.Color(0x8b6914); // brown
        const dustColor = baseColor.clone().lerp(new THREE.Color(0xfff8dc), 0.4); // pale tint

        // Throttled debug log (every 30s to reduce console noise)
        const nowMs = performance.now();
        if (!wp._lastDebugTime || nowMs - wp._lastDebugTime > 30000) {
            wp._lastDebugTime = nowMs;
            const firstPos = wp.active.length > 0 ? `(${wp.active[0].position.x.toFixed(1)}, ${wp.active[0].position.y.toFixed(1)}, ${wp.active[0].position.z.toFixed(1)})` : 'none';
            const target = Math.floor(wp.maxParticles * densityMult * Math.min(effectiveWind / 8, 1));
            console.log(`[WindParticles] wind=${this.windSpeed.toFixed(2)} eff=${effectiveWind.toFixed(2)} active=${wp.active.length}/${wp.maxParticles} target=${target} visible=${wp.mesh.visible} pos=${firstPos}`);
        }

        if (effectiveWind < 0.3) {
            wp.mesh.visible = false;
            return;
        }
        wp.mesh.visible = true;
        const windDir3 = wp._windVec.set(this.windDirection.x, 0, this.windDirection.y).normalize();
        const camPos = this.cameraPosition;
        const halfBoundsH = wp.boundsHeight * 0.5;
        const midH = camPos.y + 4; // center height band around slightly above camera

        // --- Update existing particles ---
        let activeCount = 0;
        let colorNeedsUpdate = false;
        for (let i = 0; i < wp.active.length; i++) {
            const p = wp.active[i];
            p.life += deltaTime;

            // Gust boost decays
            if (p.gustBoost > 0) {
                p.gustBoost -= deltaTime * 2;
                if (p.gustBoost < 0) p.gustBoost = 0;
            }

            // Laminar flow: wind direction dominates, gentle flutter
            const gustAdd = p.gustBoost * 3;
            const typeSpeed = p.type === 'dust' ? 1.3 : p.type === 'twig' ? 0.85 : 1.0;
            const baseSpeed = (effectiveWind + gustAdd) * typeSpeed;
            p.velocity.x = windDir3.x * baseSpeed;
            p.velocity.z = windDir3.z * baseSpeed;
            // Cross-wind flutter (small, chaotic)
            const flutterAmp = p.type === 'dust' ? 0.8 : p.type === 'twig' ? 0.15 : 0.5;
            p.velocity.x += Math.sin(p.life * 3 + i * 2.1) * flutterAmp;
            p.velocity.z += Math.cos(p.life * 2.7 + i * 1.7) * flutterAmp * 0.6;
            // Gravity: twigs sink fast, leaves flutter gently, dust rises slightly
            // Low wind speeds increase downward drift via windGravityFactor
            const lowWindBoost = Math.max(0, 1 - effectiveWind / 6);
            const windGravityMod = 1 + gravFactor * lowWindBoost;
            const baseGravity = p.type === 'twig' ? 1.2 * twigGrav : p.type === 'dust' ? -0.03 : 0.06;
            p.velocity.y -= deltaTime * baseGravity * gravMult * windGravityMod;

            p.position.addScaledVector(p.velocity, deltaTime);

            // Rotation tumble
            p.rotationSpeed += deltaTime * spinSpeed * (effectiveWind * 0.4 + p.gustBoost);

            // --- Soft field fade: distance from camera center ---
            const dx = p.position.x - camPos.x;
            const dz = p.position.z - camPos.z;
            const distH = Math.sqrt(dx * dx + dz * dz);
            const distV = Math.abs(p.position.y - midH);
            const edgeFadeH = Math.max(0, 1 - (distH / wp.boundsRadius) ** 3);
            const edgeFadeV = Math.max(0, 1 - (distV / halfBoundsH) ** 3);
            const edgeFade = edgeFadeH * edgeFadeV;

            // Life fade (smooth in at birth, smooth out at death)
            const lifeRatio = p.life / p.maxLife;
            const lifeFade = Math.min(1, lifeRatio * 4) * (lifeRatio > 0.75 ? 1 - (lifeRatio - 0.75) / 0.25 : 1);
            const fade = edgeFade * lifeFade;

            // Despawn when fully faded or far out
            if (edgeFade <= 0.01 || p.position.y < -5 || p.position.y > midH + halfBoundsH + 5 || p.life >= p.maxLife) {
                p.active = false;
                wp.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
                wp.pool.push(p);
                wp.active.splice(i, 1);
                i--;
                continue;
            }

            // Build instance matrix
            wp._dummy.position.copy(p.position);
            wp._dummy.rotation.set(
                p.rotationAxis.x * p.rotationSpeed,
                p.rotationAxis.y * p.rotationSpeed,
                p.rotationAxis.z * p.rotationSpeed
            );
            const windSize = Math.max(0.3, Math.min(3.0, effectiveWind / 6));
            const s = p.scale * fade * sizeMult * windSize;
            if (p.type === 'twig') {
                // Twig: long, thin, aligned with wind roughly
                wp._dummy.scale.set(s * 3.5, s * 0.25, s);
            } else if (p.type === 'dust') {
                wp._dummy.scale.set(s * 0.6, s * 0.6, s);
            } else {
                wp._dummy.scale.set(s, s, s);
            }
            wp._dummy.updateMatrix();
            wp.mesh.setMatrixAt(i, wp._dummy.matrix);

            // Per-instance color
            let c;
            if (p.type === 'twig') c = twigColor;
            else if (p.type === 'dust') c = dustColor;
            else c = baseColor;
            wp.mesh.setColorAt(i, c);
            colorNeedsUpdate = true;
            activeCount++;
        }

        // --- Spawn new particles throughout the field ---
        const targetCount = Math.floor(wp.maxParticles * densityMult * Math.min(effectiveWind / 64, 1));
        wp.spawnTimer += deltaTime;
        const qualityLevel = this.game?.performanceManager?.qualityLevel ?? 4;
        const perfScale = [0.3, 0.6, 0.8, 1.0, 1.0][qualityLevel] || 1.0;
        const spawnRate = Math.max(0.02, wp.spawnInterval / ((effectiveWind * densityMult + 0.1) * perfScale));

        while (wp.active.length < targetCount && wp.spawnTimer >= spawnRate && wp.pool.length > 0) {
            wp.spawnTimer -= spawnRate;
            const p = wp.pool.pop();
            p.active = true;
            p.life = 0;
            p.maxLife = 2.0 + Math.random() * 3.0;
            p.gustBoost = this.gustIntensity > 1.3 ? (this.gustIntensity - 1) * 2 : 0;

            // Distribute throughout the field volume around camera
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * wp.boundsRadius * 0.9; // uniform disk
            p.position.set(
                camPos.x + Math.cos(angle) * r,
                midH + (Math.random() - 0.5) * wp.boundsHeight * 0.9,
                camPos.z + Math.sin(angle) * r
            );
            // Initial velocity: laminar wind flow
            const initSpeed = effectiveWind * (0.6 + Math.random() * 0.3);
            p.velocity.set(
                windDir3.x * initSpeed + (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 0.2,
                windDir3.z * initSpeed + (Math.random() - 0.5) * 0.3
            );

            // Type selection: twig by frequency slider, then dust by wind speed
            const roll = Math.random();
            if (roll < twigFreq) {
                p.type = 'twig';
                p.scale = 0.3 + Math.random() * 0.3;
                p.rotationSpeed = Math.random() * 1.5;
            } else if (effectiveWind > 2 && roll < twigFreq + 0.35) {
                p.type = 'dust';
                p.scale = 0.05 + Math.random() * 0.08;
                p.rotationSpeed = Math.random() * 5;
            } else {
                p.type = 'leaf';
                p.scale = 0.12 + Math.random() * 0.18;
                p.rotationSpeed = Math.random() * 3;
            }

            wp.active.push(p);
        }

        wp.mesh.count = activeCount;
        wp.mesh.instanceMatrix.needsUpdate = true;
        if (colorNeedsUpdate) wp.mesh.instanceColor.needsUpdate = true;
    }

    _disposeWindParticles() {
        const wp = this.windParticles;
        if (!wp) return;
        if (wp.mesh) {
            this.scene.remove(wp.mesh);
            wp.mesh.geometry.dispose();
            wp.mesh.material.dispose();
        }
        this.windParticles = null;
    }
}
