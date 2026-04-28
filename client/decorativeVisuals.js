class DecorativeVisualsSystem {
    constructor(scene, terrainSystem, game) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.game = game; // Store game reference for mouse access
        
        // Daisy system
        this.daisies = new Map(); // Map of daisy data by position key
        this.maxDaisies = 200; // Maximum number of daisies
        this.daisySpawnRadius = 50; // Spawn radius around camera
        
        // Bird system
        this.birdPool = []; // Object pool for birds
        this.activeBirds = new Map(); // Active birds in scene
        this.maxBirds = 12; // Target bird population
        this.minHeight = 3; // Minimum height above ground
        this.maxHeight = 8; // Maximum height above ground
        this.birdSpawnRadius = 60; // Spawn radius around camera
        
        // Camera position for fade calculations
        this.cameraPosition = new THREE.Vector3(0, 0, 0);
        
        // Initialize panic sound variations
        this.panicSounds = [
            'hu?', 'oop!', 'yelp!', 'eep!', 'ah!', 'oh!', 'wa!', 'yi!', 'ee!', 'oo!'
        ];
        
        // Initialize systems
        this.initializeDaisies();
        this.initializeBirds();
    }
    
    // DAISY SYSTEM
    initializeDaisies() {
        console.log('[DecorativeVisuals] Initializing daisy system...');
        this.spawnInitialDaisies();
    }
    
    spawnInitialDaisies() {
        // Spawn initial daisies in random positions
        for (let i = 0; i < this.maxDaisies; i++) {
            const x = (Math.random() - 0.5) * this.daisySpawnRadius * 2;
            const z = (Math.random() - 0.5) * this.daisySpawnRadius * 2;
            this.spawnDaisy(x, z);
        }
        console.log(`[DecorativeVisuals] Spawned ${this.daisies.size} initial daisies`);
    }
    
    spawnDaisy(x, z) {
        const key = `${Math.round(x)},${Math.round(z)}`;
        if (this.daisies.has(key)) {
            return; // Daisy already exists at this position
        }
        
        // Get terrain height
        const height = this.terrainSystem ? this.terrainSystem.getHeight(x, z) : 0;
        
        // Create daisy group
        const daisyGroup = new THREE.Group();
        
        // Create tiny pixel flower petals (simplified as small spheres)
        const petalGeometry = new THREE.SphereGeometry(0.05, 4, 3); // Very small, low poly
        
        // White petals arranged in circle
        const petalPositions = [
            { x: 0.1, z: 0 }, { x: -0.1, z: 0 },
            { x: 0, z: 0.1 }, { x: 0, z: -0.1 },
            { x: 0.07, z: 0.07 }, { x: -0.07, z: 0.07 },
            { x: 0.07, z: -0.07 }, { x: -0.07, z: -0.07 }
        ];
        
        const petalMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, // White petals
            transparent: true,
            opacity: 0.9
        });
        
        // Add petals
        for (const pos of petalPositions) {
            const petal = new THREE.Mesh(petalGeometry, petalMaterial);
            petal.position.set(pos.x, height + 0.1, pos.z);
            petal.renderOrder = 1000; // Render on top
            daisyGroup.add(petal);
        }
        
        // Yellow center
        const centerGeometry = new THREE.SphereGeometry(0.03, 6, 4);
        const centerMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00, // Yellow center
            transparent: true,
            opacity: 1.0
        });
        const center = new THREE.Mesh(centerGeometry, centerMaterial);
        center.position.set(0, height + 0.1, 0);
        center.renderOrder = 1001; // Render on top of petals
        daisyGroup.add(center);
        
        // Add tiny stem
        const stemGeometry = new THREE.CylinderGeometry(0.01, 0.01, 0.1, 3);
        const stemMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x2d5016, // Dark green stem
            transparent: true,
            opacity: 0.8
        });
        const stem = new THREE.Mesh(stemGeometry, stemMaterial);
        stem.position.set(0, height + 0.05, 0);
        daisyGroup.add(stem);
        
        // Random rotation for variety
        daisyGroup.rotation.y = Math.random() * Math.PI * 2;
        
        // Add to scene
        this.scene.add(daisyGroup);
        
        // Store daisy data
        this.daisies.set(key, {
            group: daisyGroup,
            position: { x, z, height },
            baseOpacity: 0.8,
            currentOpacity: 0.8
        });
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
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // Create radial gradient for magical glow effect
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');    // White center
        gradient.addColorStop(0.2, 'rgba(255, 255, 200, 0.9)'); // Yellow-white
        gradient.addColorStop(0.4, 'rgba(255, 200, 100, 0.7)'); // Yellow
        gradient.addColorStop(0.6, 'rgba(255, 150, 50, 0.5)');  // Orange
        gradient.addColorStop(0.8, 'rgba(200, 100, 255, 0.3)'); // Purple
        gradient.addColorStop(1, 'rgba(100, 50, 255, 0)');      // Transparent purple
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        
        // Add sparkles
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * 64;
            const y = Math.random() * 64;
            const size = Math.random() * 2 + 1;
            ctx.fillRect(x, y, size, size);
        }
        
        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        
        // Create sprite material
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            color: 0xffffff
        });
        
        // Create sprite
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(0.125, 0.125, 1); // Size of sprite (reduced by half again)

        // Hide initially (in pool)
        sprite.visible = false;

        // Create omni light with falloff for the sprite
        const light = new THREE.PointLight(0xffaa00, 2, 8, 2); // Warm orange light, intensity 2, distance 8, decay 2
        light.position.set(0, 0, 0);
        light.visible = false;

        return {
            group: sprite,
            sprite: sprite,
            light: light,
            position: { x: 0, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            targetPosition: { x: 0, y: 0, z: 0 },
            phase: 0,
            speed: 0.15 + Math.random() * 0.1,
            behavior: 'drifting', // drifting, circling, swooping, hovering
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
            fleeDirection: { x: 0, z: 0 }
        };
    }
    
    spawnInitialBirds() {
        // Spawn initial magical books from pool
        for (let i = 0; i < this.maxBirds; i++) {
            this.spawnBook();
        }
        console.log(`[DecorativeVisuals] Spawned ${this.activeBirds.size} initial magical books`);
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
        book.group.position.set(x, height, z);
        book.group.visible = true;
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
        this.scene.add(book.light);  // Add sprite's omni light to scene
        this.activeBirds.set(id, book);
        
        return id;
    }
    
    despawnBird(id) {
        const bird = this.activeBirds.get(id);
        if (!bird) return;

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
        this.updateDaisies();
        this.updateBirds(deltaTime);
        this.maintainBookPopulation();
    }
    
    updateDaisies() {
        // Update daisy opacity based on distance from camera
        const fadeDistance = 8; // Start fading at 8 units
        const fadeCompleteDistance = 15; // Fully faded at 15 units
        
        for (const [key, daisy] of this.daisies) {
            const distance = Math.sqrt(
                Math.pow(daisy.position.x - this.cameraPosition.x, 2) +
                Math.pow(daisy.position.z - this.cameraPosition.z, 2)
            );
            
            let opacity = daisy.baseOpacity;
            
            if (distance > fadeDistance) {
                const fadeProgress = Math.min((distance - fadeDistance) / (fadeCompleteDistance - fadeDistance), 1);
                opacity = daisy.baseOpacity * (1 - fadeProgress);
            }
            
            daisy.currentOpacity = opacity;
            
            // Update opacity for all parts of the daisy
            daisy.group.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.opacity = opacity;
                    child.material.transparent = opacity < 1.0;
                    child.material.needsUpdate = true;
                }
            });
        }
    }
    
    updateBirds(deltaTime) {
        for (const [id, sprite] of this.activeBirds) {
            // Update behavior timer
            sprite.behaviorTimer -= deltaTime;
            if (sprite.behaviorTimer <= 0) {
                // Change behavior
                const behaviors = ['drifting', 'circling', 'swooping', 'hovering'];
                sprite.behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
                sprite.behaviorTimer = 3 + Math.random() * 5; // 3-8 seconds per behavior
            }
            
            // Check mouse cursor avoidance behavior
            this.checkMouseAvoidance(sprite, deltaTime);
            
            // Apply simple sprite movement based on behavior (only if not fleeing or panicking)
            if (!sprite.isFleeing && !sprite.isPanicking) {
                const time = Date.now() * 0.001; // Time in seconds
                
                switch (sprite.behavior) {
                    case 'drifting':
                        // Smooth magical drifting using noise
                        sprite.velocity.x = this.simplexNoise(time + sprite.noiseOffset.x) * 0.025;
                        sprite.velocity.z = this.simplexNoise(time + sprite.noiseOffset.z) * 0.025;
                        sprite.velocity.y = this.simplexNoise(time + sprite.noiseOffset.y) * 0.008;
                        break;
                        
                    case 'circling':
                        // Circular magical flight pattern
                        const circleRadius = 12;
                        const circleSpeed = 0.4;
                        const angle = time * circleSpeed + sprite.noiseOffset.x;
                        sprite.velocity.x = Math.cos(angle) * circleRadius * 0.012;
                        sprite.velocity.z = Math.sin(angle) * circleRadius * 0.012;
                        sprite.velocity.y = Math.sin(time * 2 + sprite.noiseOffset.y) * 0.005;
                        break;
                        
                    case 'swooping':
                        // Magical swooping up and down movement
                        const swoopPhase = time * 0.6 + sprite.noiseOffset.x;
                        sprite.velocity.x = Math.cos(swoopPhase) * 0.04;
                        sprite.velocity.z = Math.sin(swoopPhase * 0.8) * 0.03;
                        sprite.velocity.y = Math.sin(swoopPhase * 2.5) * 0.02;
                        break;
                        
                    case 'hovering':
                        // Magical hovering with enchantment
                        sprite.velocity.x = Math.sin(time * 4 + sprite.noiseOffset.x) * 0.008;
                        sprite.velocity.z = Math.cos(time * 4 + sprite.noiseOffset.z) * 0.008;
                        sprite.velocity.y = Math.sin(time * 6 + sprite.noiseOffset.y) * 0.01;
                        break;
                }
            }
            
            // Update position with constraints
            this.updateBookPosition(sprite, deltaTime);

            // Update light position to match sprite
            sprite.light.position.copy(sprite.sprite.position);

            // Distance-based fading (mist effect)
            const distance = Math.sqrt(
                Math.pow(sprite.sprite.position.x - this.cameraPosition.x, 2) +
                Math.pow(sprite.sprite.position.z - this.cameraPosition.z, 2)
            );

            const fadeStartDistance = 10.67; // Start fading at ~10.67 units (8 * 1.33)
            const fadeEndDistance = 45; // Fully faded at 45 units

            let opacity = 0.2; // Base visibility reduced to 20% (even more transparent)
            if (distance > fadeStartDistance) {
                const fadeProgress = Math.min((distance - fadeStartDistance) / (fadeEndDistance - fadeStartDistance), 1);
                opacity = 0.2 * (1.0 - fadeProgress);
            }

            sprite.sprite.material.opacity = opacity;

            // Link pulsing rate to movement speed
            const velocityMagnitude = Math.sqrt(
                sprite.velocity.x * sprite.velocity.x + 
                sprite.velocity.y * sprite.velocity.y + 
                sprite.velocity.z * sprite.velocity.z
            );
            const speedMultiplier = 1.0 + velocityMagnitude * 10; // Faster movement = faster pulsing

            // Simple sprite animation - toned down pulsing glow linked to speed
            sprite.phase += sprite.speed * speedMultiplier;
            const pulse = Math.sin(sprite.phase) * 0.1 + 0.9; // Pulse between 0.8 and 1.0 (much less variation)
            sprite.sprite.scale.set(0.5 * pulse, 0.5 * pulse, 1);
            
            // Add gentle bobbing
            const bobbing = Math.sin(Date.now() * 0.002 + sprite.noiseOffset.y) * 0.1;
            sprite.sprite.position.y += bobbing;
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
        
        // Debug: Log distance check (only log occasionally to avoid spam)
        if (Math.random() < 0.01) { // Log 1% of the time
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
                        console.log('[ZIP ANIMATION] Reached target, pausing before next zip');
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
                    console.log('[ZIP ANIMATION] Starting panic zip for sprite');
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
        // Play a random cute panic sound using TTS with distance-based volume
        const randomSound = this.panicSounds[Math.floor(Math.random() * this.panicSounds.length)];
        
        // Calculate volume based on distance - BALANCED effect
        // Close: 0.4 volume, Far: 0.03 volume, Fade starts at 12 units, complete at 32 units
        const fadeStartDistance = 3;
        const fadeEndDistance = 70;
        const maxVolume = 0.3;
        const minVolume = 0.001;
        
        let volume = maxVolume;
        if (distanceToCamera > fadeStartDistance) {
            const fadeProgress = Math.min((distanceToCamera - fadeStartDistance) / (fadeEndDistance - fadeStartDistance), 1);
            volume = maxVolume * (1 - fadeProgress) + minVolume * fadeProgress;
        }
        
        // Use speech synthesis for cute, unobtrusive sounds
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(randomSound);
            utterance.pitch = 1.8; // High pitch for cute sound
            utterance.rate = 1.2; // Slightly fast for startled effect
            utterance.volume = volume; // Distance-based volume
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
        while (this.activeBirds.size < this.maxBirds) {
            this.spawnBook();
        }
    }
    
    // Simple noise function for smooth movement
    simplexNoise(x) {
        // Simplified noise function (in real implementation, use proper simplex noise)
        return Math.sin(x * 0.1) * Math.cos(x * 0.07) * Math.sin(x * 0.13);
    }
    
    // CLEANUP METHODS
    dispose() {
        // Remove all daisies
        for (const [key, daisy] of this.daisies) {
            this.scene.remove(daisy.group);
            daisy.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }
        this.daisies.clear();
        
        // Remove all magical books (return to pool)
        for (const [id, book] of this.activeBirds) {
            this.scene.remove(book.group);
            book.group.visible = false;
            book.active = false;
            this.birdPool.push(book);
        }
        this.activeBirds.clear();
        
        // Dispose book pool objects
        this.disposeBookPool();
    }
    
    despawnBook(id) {
        const book = this.activeBirds.get(id);
        if (!book) return;
        
        // Remove from scene
        this.scene.remove(book.group);
        book.group.visible = false;
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
        }
        this.birdPool.length = 0;
    }
}
