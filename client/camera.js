class CameraController {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;
        this.mode = 'tactical'; // strategic, tactical, follow, free
        this.target = new THREE.Vector3(0, 0, 0);
        this.distance = 20;
        this.angle = 45;
        this.height = 15;
        
        // Movement
        this.moveSpeed = 0.5;
        this.rotationSpeed = 0.001; // Reduced mouse sensitivity
        this.zoomSpeed = 1.0;
        
        // Input state
        this.keys = {};
        this.mouseDown = false;
        this.rightMouseDown = false;
        this.middleMouseDown = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        // Spherical orbit state (middle mouse drag)
        this.orbitAzimuth = 0;   // horizontal angle (radians)
        this.orbitPolar = 0.6;   // vertical angle from top (radians), ~35 degrees
        this.orbitDistance = 20; // distance from target
        this.orbitLocked = false;
        
        // Camera position for panning
        this.cameraX = 0;
        this.cameraZ = 0;
        this.minCameraHeight = 10; // Increased minimum height above terrain to prevent snagging
        
        // Animation
        this.animating = false;
        this.animationStart = null;
        
        // Smooth movement with acceleration
        this.currentTarget = new THREE.Vector3(0, 0, 0); // Actual position being interpolated
        this.currentTarget.copy(this.target);
        this.smoothSpeed = 0.1; // Interpolation speed (0.1 = smooth, 1.0 = instant)
        
        // Velocity-based movement for acceleration/deceleration
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.acceleration = 0.04; // Slower acceleration
        this.deceleration = 0.98; // Lower damping for more gradual coasting
        this.maxSpeed = 0.2; // Much lower max speed for very gentle movement
        
        // Per-frame drag accumulation (high-DPI mice fire many events per frame)
        this.pendingDrag = { x: 0, y: 0 };
        this.lastDragMoveVector = new THREE.Vector3();
        this.dragWorldScale = null;
        this.dragAzimuth = undefined;

        // Double-right-click detection
        this.lastRightClickTime = 0;
        this.lastRightClickPos = { x: 0, y: 0 };
        this.rightClickDownPos = { x: 0, y: 0 };
        this.doubleClickDelay = 300; // ms between clicks
        this.doubleClickDistance = 10; // pixels between clicks

        // Cursor-grab anchor state for world-locked panning
        this.cursorGrabState = {
            active: false,
            worldPoint: null,
            target: new THREE.Vector3(),
            slowFactor: 1.0
        };
        this.panAnchorWorld = null;
        this.panAnchorTarget = null;
        this.dragLimitState = {
            active: false,
            origin: new THREE.Vector3()
        };
        this._dragLimitOffset = new THREE.Vector3();
        
        // Smooth rotation with spin momentum
        this.currentAngle = this.angle; // Actual angle being interpolated
        this.angleVelocity = 0; // Angular velocity for momentum
        this.rotationAcceleration = 0.2; // Much lower acceleration
        this.rotationDamping = 0.75; // Much higher damping for minimal momentum
        
        // Smooth target point zoom system
        this.zoomTarget = null; // Target point for smooth zoom
        this.zoomSpeed = 0.075; // Halved speed for elegant swoosh zoom
        this.zoomThreshold = 0.5; // Distance threshold to consider "arrived" at target
        this.animationDuration = 1000;
        this.animationStartPos = null;
        this.animationTargetPos = null;
        
        // Failsafe for camera oscillation
        this.lastPosition = new THREE.Vector3();
        this.oscillationCount = 0;
        this.maxOscillationCount = 10;
        
            // Isometric mode constants
        this.isometricAzimuth = Math.PI / 4; // 45 degrees for diamond silhouette
        this.isometricPolar = 0.55;           // ~31.5 degrees elevation
        this.minOrbitDistance = 12;           // Min zoom: pieces stay tap-friendly
        this.maxOrbitDistance = (window.parameterSystem && window.parameterSystem.getParameter('maxCameraHeight')) || 45;

        // Touch state for mobile
        this.touchDragged = false;
        this.touchOnEmptyGround = false;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchDragThreshold = 10;
        
        // Setup initial position
        this.updateCameraPosition();
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Keyboard events
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
        
        // Mouse events
        window.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        window.addEventListener('contextmenu', (e) => e.preventDefault()); // Prevent right-click context menu
        
        // Touch events for mobile
        window.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        window.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        window.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }
    
    handleKeyDown(event) {
        if (!event.key) return;
        this.keys[event.key.toLowerCase()] = true;
        
        // Prevent default for game keys
        if (['w', 'a', 's', 'd', 'q', 'e'].includes(event.key.toLowerCase())) {
            event.preventDefault();
        }
    }
    
    handleKeyUp(event) {
        if (!event.key) return;
        this.keys[event.key.toLowerCase()] = false;
    }

    beginCursorGrabAnchor(worldPoint, anchorTarget, slowFactor = 1) {
        if (!worldPoint) {
            this.cursorGrabState.active = false;
            this.cursorGrabState.worldPoint = null;
            return;
        }
        this.cursorGrabState.active = true;
        this.cursorGrabState.worldPoint = worldPoint.clone();
        this.cursorGrabState.target.copy(anchorTarget || this.target);
        this.cursorGrabState.slowFactor = Math.min(1, Math.max(0.1, slowFactor || 1));

        // Stable pan: compute screen-to-world scale once at grab depth
        const grabDist = this.camera.position.distanceTo(worldPoint);
        const fovRad = this.camera.fov * Math.PI / 180;
        this.cursorGrabState.worldScale = (2 * Math.tan(fovRad / 2) * grabDist) / window.innerHeight;
        this.cursorGrabState.azimuth = this.orbitAzimuth;
    }

    endCursorGrabAnchor() {
        this.cursorGrabState.active = false;
        this.cursorGrabState.worldPoint = null;
    }

    _enforceDragCutoff() {
        if (!this.dragLimitState.active) return false;
        const ps = window.parameterSystem;
        if (!ps) return false;
        const cutoff = ps.getParameter('cursorDragCutoffDistance');
        if (cutoff === undefined || cutoff <= 0) return false;

        const offset = this._dragLimitOffset;
        offset.copy(this.target).sub(this.dragLimitState.origin);
        offset.y = 0;
        const distance = Math.hypot(offset.x, offset.z);
        if (distance <= cutoff) return false;

        const clampRatio = cutoff / distance;
        offset.multiplyScalar(clampRatio);
        this.target.set(
            this.dragLimitState.origin.x + offset.x,
            this.target.y,
            this.dragLimitState.origin.z + offset.z
        );
        this.currentTarget.copy(this.target);
        this.velocity.set(0, 0, 0);
        this.pendingDrag.x = 0;
        this.pendingDrag.y = 0;
        this.endCursorGrabAnchor();
        return true;
    }

    getDynamicPanSpeed() {
        const ps = window.parameterSystem;
        const base = 0.03;

        if (ps) {
            const cap = ps.getParameter('cursorDragSpeedCap');
            return Math.min(cap, base);
        }

        return Math.min(0.10, base);
    }

    handleMouseDown(event) {
        if (event.button === 0) { // Left click - now for pieces only
            // Don't handle camera controls here - let game handle pieces
        } else if (event.button === 1) { // Middle click - spherical orbit
            this.middleMouseDown = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
            
            // Initialize orbit from current camera position relative to target
            const offset = new THREE.Vector3().subVectors(this.camera.position, this.target);
            this.orbitDistance = offset.length();
            this.orbitAzimuth = Math.atan2(offset.x, offset.z); // angle around Y axis
            // polar angle from horizontal plane (0 = ground level, PI/2 = straight down)
            const horizontalDist = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
            this.orbitPolar = Math.atan2(offset.y, horizontalDist);
            
            event.preventDefault(); // Prevent middle-click behavior
        } else if (event.button === 2) { // Right click - camera position
            // Record start position for drag vs click detection
            this.rightClickDownPos = { x: event.clientX, y: event.clientY };

            // Defensive: suppress pan if cursor is over water (NaviCursor drowning animation)
            const boardSys = window.game?.boardSystem;
            if (boardSys) {
                const mwp = boardSys.mouseWorldPosition;
                const waterLevel = boardSys.tidalWaterLevel ?? boardSys.waterLevel ?? -1.5;
                let terrainHeight;
                if (boardSys.getUnifiedTerrainHeight) {
                    terrainHeight = boardSys.getUnifiedTerrainHeight(mwp.x, mwp.z);
                } else if (boardSys.getHeightWithRipple) {
                    terrainHeight = boardSys.getHeightWithRipple(mwp.x, mwp.z);
                } else {
                    terrainHeight = mwp.y;
                }
                if (terrainHeight < waterLevel) {
                    event.preventDefault();
                    return;
                }
            }
            this.rightMouseDown = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
            this.zoomTarget = null; // Cancel smooth zoom when taking manual control
            this.dragLimitState.active = true;
            this.dragLimitState.origin.copy(this.target);

            // Capture world anchor for world-locked panning
            const boardSystem = window.game?.boardSystem;
            if (boardSystem?.mouseWorldPosition) {
                this.panAnchorWorld = boardSystem.mouseWorldPosition.clone();
                this.panAnchorTarget = this.target.clone();

                // Stable pan: compute screen-to-world scale once at grab depth
                const grabDist = this.camera.position.distanceTo(boardSystem.mouseWorldPosition);
                const fovRad = this.camera.fov * Math.PI / 180;
                this.dragWorldScale = (2 * Math.tan(fovRad / 2) * grabDist) / window.innerHeight;
                this.dragAzimuth = this.orbitAzimuth;
            } else {
                this.dragWorldScale = null;
                this.dragAzimuth = undefined;
            }
            this.lastDragMoveVector.set(0, 0, 0);

            event.preventDefault(); // Prevent context menu
        }
    }
    
    handleMouseUp(event) {
        if (event.button === 0) { // Left click - pieces only
            this.mouseDown = false;
        } else if (event.button === 1) { // Middle click - camera orientation
            this.middleMouseDown = false;
        } else if (event.button === 2) { // Right click - camera position
            // Check if this was a click (not a drag)
            const dx = event.clientX - this.rightClickDownPos.x;
            const dy = event.clientY - this.rightClickDownPos.y;
            const moveDist = Math.sqrt(dx * dx + dy * dy);

            if (moveDist < 5) { // It's a click, not a drag
                const now = Date.now();
                const timeSinceLast = now - this.lastRightClickTime;

                if (timeSinceLast < this.doubleClickDelay) {
                    const lastDx = event.clientX - this.lastRightClickPos.x;
                    const lastDy = event.clientY - this.lastRightClickPos.y;
                    const lastDist = Math.sqrt(lastDx * lastDx + lastDy * lastDy);

                    if (lastDist < this.doubleClickDistance) {
                        // Double-right-click detected!
                        this.handleDoubleRightClick();
                        this.lastRightClickTime = 0; // Reset to prevent triple-click
                    } else {
                        this.lastRightClickTime = now;
                        this.lastRightClickPos = { x: event.clientX, y: event.clientY };
                    }
                } else {
                    this.lastRightClickTime = now;
                    this.lastRightClickPos = { x: event.clientX, y: event.clientY };
                }
            }

            const wasDrag = moveDist >= 5;
            this.rightMouseDown = false;

            if (wasDrag) {
                const ps = window.parameterSystem;
                const momentum = ps ? ps.getParameter('cursorDragMomentum') : 0;
                if (momentum > 0 && this.lastDragMoveVector.lengthSq() > 1e-8) {
                    // Kick the target ahead so the smoothing system carries the camera
                    const kick = this.lastDragMoveVector.clone().multiplyScalar(momentum * 8);
                    this.target.add(kick);
                } else {
                    this.currentTarget.copy(this.target);
                    this.velocity.set(0, 0, 0);
                }
            } else {
                this.currentTarget.copy(this.target);
                this.velocity.set(0, 0, 0);
            }

            // Reset oscillation counter to prevent false triggers
            this.oscillationCount = 0;
            this.endCursorGrabAnchor();
            this.dragLimitState.active = false;
            this.panAnchorWorld = null;
            this.panAnchorTarget = null;
            this.dragWorldScale = null;
            this.dragAzimuth = undefined;
        }
    }

    handleDoubleRightClick() {
        const worldPoint = window.game?.boardSystem?.mouseWorldPosition;
        if (worldPoint) {
            console.log('[Camera] Double-right-click at world position:', worldPoint);
            // Move camera to this position using same animation as Jesus summon
            this.centerOnPosition(worldPoint.x, worldPoint.z);
        }
    }

    handleMouseMove(event) {
        if (this.middleMouseDown) {
            const deltaX = event.clientX - this.lastMouseX;
            const deltaY = event.clientY - this.lastMouseY;
            
            if (this.mode === 'tactical' || this.mode === 'free') {
                // Spherical orbit: lock distance, rotate around target
                const orbitSpeedX = 0.005;
                const orbitSpeedY = 0.005;
                
                this.orbitAzimuth -= deltaX * orbitSpeedX;
                this.orbitPolar += deltaY * orbitSpeedY;
                
                // Clamp polar to avoid flipping past vertical (0 = horizon, PI/2 = straight down)
                this.orbitPolar = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.orbitPolar));
            }
            
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        }
        
        if (this.rightMouseDown) {
            let deltaX = event.movementX;
            let deltaY = event.movementY;
            const maxDelta = 20;
            deltaX = Math.max(-maxDelta, Math.min(maxDelta, deltaX));
            deltaY = Math.max(-maxDelta, Math.min(maxDelta, deltaY));
            
            // Accumulate for single frame-bound application (prevents runaway on high-DPI mice)
            this.pendingDrag.x += deltaX;
            this.pendingDrag.y += deltaY;
        }
    }
    
    handleWheel(event) {
        event.preventDefault();

        // Get wheel sensitivity from parameter system
        const sensitivity = window.parameterSystem ? window.parameterSystem.getParameter('wheelSensitivity') : 2;

        // All modes: wheel zooms by changing orbit distance (camera up/down, target stays put)
        const zoomDelta = event.deltaY > 0 ? sensitivity : -sensitivity;
        this.orbitDistance = Math.max(
            this.minOrbitDistance,
            Math.min(this.maxOrbitDistance, this.orbitDistance + zoomDelta)
        );
    }
    
    handleTouchStart(event) {
        if (event.touches.length === 1) {
            this.mouseDown = true;
            this.touchDragged = false;
            this.touchOnEmptyGround = false;
            this.touchStartX = event.touches[0].clientX;
            this.touchStartY = event.touches[0].clientY;
            this.lastMouseX = event.touches[0].clientX;
            this.lastMouseY = event.touches[0].clientY;
            
            // In isometric mode, check if touch is on empty ground
            if (this.mode === 'isometric') {
                this.touchOnEmptyGround = !this.isTouchOnInteractive(
                    event.touches[0].clientX,
                    event.touches[0].clientY
                );
            }
        } else if (event.touches.length === 2) {
            // Two-finger pan: same as right-click drag
            this.touchPanning = true;
            this.lastTouchMidX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
            this.lastTouchMidY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
            
            // Pinch zoom initial distance
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            this.lastPinchDist = Math.sqrt(dx * dx + dy * dy);
        }
    }
    
    handleTouchMove(event) {
        event.preventDefault(); // Prevent page scroll during game interaction
        
        if (event.touches.length === 1 && this.mouseDown) {
            const deltaX = event.touches[0].clientX - this.lastMouseX;
            const deltaY = event.touches[0].clientY - this.lastMouseY;
            const totalDelta = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            if (totalDelta > this.touchDragThreshold) {
                this.touchDragged = true;
            }
            
            if (this.mode === 'isometric') {
                // Single finger drags pan the target in isometric mode
                if (this.touchDragged) {
                    const panSpeed = this.getDynamicPanSpeed();
                    const angleRad = this.isometricAzimuth;
                    
                    const moveVector = new THREE.Vector3();
                    moveVector.x -= Math.cos(angleRad) * deltaX * panSpeed;
                    moveVector.z += Math.sin(angleRad) * deltaX * panSpeed;
                    moveVector.x -= Math.sin(angleRad) * deltaY * panSpeed;
                    moveVector.z -= Math.cos(angleRad) * deltaY * panSpeed;
                    
                    this.target.add(moveVector);
                    this.currentTarget.copy(this.target);
                    this.velocity.set(0, 0, 0);

                    // Deselect piece if dragging on empty ground
                    if (this.touchOnEmptyGround && window.game && window.game.deselectFromTouchDrag) {
                        window.game.deselectFromTouchDrag();
                        this.touchOnEmptyGround = false; // Only deselect once
                    }
                }
            } else if (this.mode === 'tactical' || this.mode === 'free') {
                // Single finger: spherical orbit (same as middle mouse)
                const orbitSpeedX = 0.005;
                const orbitSpeedY = 0.005;
                
                this.orbitAzimuth -= deltaX * orbitSpeedX;
                this.orbitPolar += deltaY * orbitSpeedY;
                this.orbitPolar = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.orbitPolar));
            }
            
            this.lastMouseX = event.touches[0].clientX;
            this.lastMouseY = event.touches[0].clientY;
        } else if (event.touches.length === 2 && this.touchPanning) {
            // Two-finger pan: move camera target (same as right-click drag)
            const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
            const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
            let deltaX = midX - this.lastTouchMidX;
            let deltaY = midY - this.lastTouchMidY;

            // Clamp deltas to prevent runaway on lag or touch glitches
            const maxDelta = 20;
            deltaX = Math.max(-maxDelta, Math.min(maxDelta, deltaX));
            deltaY = Math.max(-maxDelta, Math.min(maxDelta, deltaY));
            
            // Accumulate for single frame-bound application
            this.pendingDrag.x += deltaX;
            this.pendingDrag.y += deltaY;

            this.lastTouchMidX = midX;
            this.lastTouchMidY = midY;
            
            // Pinch zoom
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            const pinchDist = Math.sqrt(dx * dx + dy * dy);
            const pinchDelta = pinchDist - this.lastPinchDist;
            
            // All modes: pinch changes orbit distance (camera up/down, target stays put)
            this.orbitDistance = Math.max(
                this.minOrbitDistance,
                Math.min(this.maxOrbitDistance, this.orbitDistance - pinchDelta * 0.05)
            );
            
            this.lastPinchDist = pinchDist;
        }
    }
    
    handleTouchEnd(event) {
        // If this was a tap (not a drag) in isometric mode, forward to game for piece selection
        if (!this.touchDragged && this.mode === 'isometric' && window.game && window.game.onMouseClick) {
            const rect = window.game.renderer.domElement.getBoundingClientRect();
            const fakeEvent = {
                clientX: this.touchStartX,
                clientY: this.touchStartY,
                target: window.game.renderer.domElement,
                preventDefault: () => {},
                stopPropagation: () => {}
            };
            window.game.onMouseClick(fakeEvent);
        }
        
        this.mouseDown = false;
        this.touchPanning = false;
        this.touchDragged = false;
        this.touchOnEmptyGround = false;
        this.lastPinchDist = 0;
    }
    
    update() {
        if (this.animating) {
            this.updateAnimation();
            return;
        }
        
        // Handle input based on mode
        switch (this.mode) {
            case 'strategic':
                this.updateStrategicMode();
                break;
            case 'tactical':
                this.updateTacticalMode();
                break;
            case 'follow':
                this.updateFollowMode();
                break;
            case 'free':
                this.updateFreeMode();
                break;
            case 'isometric':
                this.updateIsometricMode();
                break;
        }
        
        this.updateCameraPosition();
    }
    
    updateStrategicMode() {
        // WASD movement in world space
        const moveVector = new THREE.Vector3();
        
        if (this.keys['w']) moveVector.z += this.moveSpeed;
        if (this.keys['s']) moveVector.z -= this.moveSpeed;
        if (this.keys['a']) moveVector.x += this.moveSpeed;
        if (this.keys['d']) moveVector.x -= this.moveSpeed;
        
        // Apply movement
        this.target.add(moveVector);
        if (moveVector.lengthSq() > 0) this.zoomTarget = null;
        
        // Q/E for zoom
        if (this.keys['q']) this.distance = Math.max(10, this.distance - this.zoomSpeed);
        if (this.keys['e']) this.distance = Math.min(50, this.distance + this.zoomSpeed);
    }
    
    updateTacticalMode() {
        // WASD movement aligned with camera direction
        const moveVector = new THREE.Vector3();
        const angleRad = this.orbitAzimuth;
        
        if (this.keys['w']) {
            moveVector.x -= Math.sin(angleRad) * this.moveSpeed;
            moveVector.z -= Math.cos(angleRad) * this.moveSpeed;
        }
        if (this.keys['s']) {
            moveVector.x += Math.sin(angleRad) * this.moveSpeed;
            moveVector.z += Math.cos(angleRad) * this.moveSpeed;
        }
        if (this.keys['a']) {
            moveVector.x -= Math.cos(angleRad) * this.moveSpeed;
            moveVector.z += Math.sin(angleRad) * this.moveSpeed;
        }
        if (this.keys['d']) {
            moveVector.x += Math.cos(angleRad) * this.moveSpeed;
            moveVector.z -= Math.sin(angleRad) * this.moveSpeed;
        }
        
        this.target.add(moveVector);
        
        // Q/E for height
        if (this.keys['q']) this.height = Math.max(5, this.height - 0.2);
        if (this.keys['e']) this.height = Math.min(50, this.height + 0.2);
    }
    
    updateFollowMode() {
        // In follow mode, camera follows a target (set by centerOnPosition)
        // The target is updated externally
        if (this.keys['q']) this.distance = Math.max(10, this.distance - this.zoomSpeed);
        if (this.keys['e']) this.distance = Math.min(50, this.distance + this.zoomSpeed);
    }
    
    updateFreeMode() {
        // Full 3D movement aligned with camera direction
        const moveVector = new THREE.Vector3();
        const angleRad = this.orbitAzimuth;
        
        if (this.keys['w']) {
            moveVector.x += Math.sin(angleRad) * this.moveSpeed;
            moveVector.z += Math.cos(angleRad) * this.moveSpeed;
        }
        if (this.keys['s']) {
            moveVector.x -= Math.sin(angleRad) * this.moveSpeed;
            moveVector.z -= Math.cos(angleRad) * this.moveSpeed;
        }
        if (this.keys['a']) {
            moveVector.x += Math.cos(angleRad) * this.moveSpeed;
            moveVector.z -= Math.sin(angleRad) * this.moveSpeed;
        }
        if (this.keys['d']) {
            moveVector.x -= Math.cos(angleRad) * this.moveSpeed;
            moveVector.z += Math.sin(angleRad) * this.moveSpeed;
        }
        
        this.target.add(moveVector);
        
        // Q/E for height
        if (this.keys['q']) this.height = Math.max(2, this.height - 0.3);
        if (this.keys['e']) this.height = Math.min(100, this.height + 0.3);
    }
    
    updateIsometricMode() {
        // WASD movement in isometric-aligned world space
        const moveVector = new THREE.Vector3();
        const angleRad = this.isometricAzimuth;
        
        if (this.keys['w']) {
            moveVector.x -= Math.sin(angleRad) * this.moveSpeed;
            moveVector.z -= Math.cos(angleRad) * this.moveSpeed;
        }
        if (this.keys['s']) {
            moveVector.x += Math.sin(angleRad) * this.moveSpeed;
            moveVector.z += Math.cos(angleRad) * this.moveSpeed;
        }
        if (this.keys['a']) {
            moveVector.x -= Math.cos(angleRad) * this.moveSpeed;
            moveVector.z += Math.sin(angleRad) * this.moveSpeed;
        }
        if (this.keys['d']) {
            moveVector.x += Math.cos(angleRad) * this.moveSpeed;
            moveVector.z -= Math.sin(angleRad) * this.moveSpeed;
        }
        
        this.target.add(moveVector);
        
        // Q/E for zoom
        if (this.keys['q']) {
            this.orbitDistance = Math.max(this.minOrbitDistance, this.orbitDistance - this.zoomSpeed);
        }
        if (this.keys['e']) {
            this.orbitDistance = Math.min(this.maxOrbitDistance, this.orbitDistance + this.zoomSpeed);
        }
    }
    
    applyCursorGrabPan() {
        if (!this.cursorGrabState.active || !this.rightMouseDown) return false;

        // Use stable screen-space drag instead of re-raycasting dynamic terrain
        if (this.pendingDrag.x === 0 && this.pendingDrag.y === 0) {
            return true;
        }

        const maxFrameDelta = 20;
        const dx = Math.max(-maxFrameDelta, Math.min(maxFrameDelta, this.pendingDrag.x));
        const dy = Math.max(-maxFrameDelta, Math.min(maxFrameDelta, this.pendingDrag.y));

        const scale = this.cursorGrabState.worldScale || this.getDynamicPanSpeed();
        const angleRad = this.cursorGrabState.azimuth !== undefined ? this.cursorGrabState.azimuth : this.orbitAzimuth;
        const slow = this.cursorGrabState.slowFactor;

        const moveVector = new THREE.Vector3();
        moveVector.x -= Math.cos(angleRad) * dx * scale * slow;
        moveVector.z += Math.sin(angleRad) * dx * scale * slow;
        moveVector.x -= Math.sin(angleRad) * dy * scale * slow;
        moveVector.z -= Math.cos(angleRad) * dy * scale * slow;

        this.target.add(moveVector);
        this.currentTarget.copy(this.target);
        this.lastDragMoveVector.copy(moveVector);
        this.velocity.set(0, 0, 0);
        this.pendingDrag.x = 0;
        this.pendingDrag.y = 0;
        this._enforceDragCutoff();
        return true;
    }

    updateCameraPosition() {
        // Calculate desired movement direction
        const desiredMovement = new THREE.Vector3().subVectors(this.target, this.currentTarget);
        const distanceToTarget = desiredMovement.length();
        
        // Apply acceleration when there's input, deceleration when there's no input
        if (distanceToTarget > 0.01) {
            // There's input - accelerate towards target
            const accelerationForce = desiredMovement.normalize().multiplyScalar(this.acceleration);
            this.velocity.add(accelerationForce);
        } else {
            // No input - apply stronger deceleration to prevent oscillation
            this.velocity.multiplyScalar(this.deceleration * 0.9); // Stronger damping
            
            // Stop completely if velocity is very small
            if (this.velocity.length() < 0.001) {
                this.velocity.set(0, 0, 0);
            }
        }
        
        // Limit maximum speed - reduce it when close to target to prevent overshooting
        const speedLimit = distanceToTarget < 2.0 ? this.maxSpeed * 0.5 : this.maxSpeed;
        if (this.velocity.length() > speedLimit) {
            this.velocity.normalize().multiplyScalar(speedLimit);
        }
        
        // Apply velocity to current target position
        this.currentTarget.add(this.velocity);
        
        // If we're very close to the target and have low velocity, snap to target
        if (distanceToTarget < 0.05 && this.velocity.length() < 0.05) {
            this.currentTarget.copy(this.target);
            this.velocity.set(0, 0, 0);
        }
        
        // Spin momentum rotation - no spring back
        this.angleVelocity *= this.rotationDamping; // Apply damping
        this.currentAngle += this.angleVelocity;
        
        // Update target angle to match current angle (prevents spring back)
        this.angle = this.currentAngle;
        
        // Smooth zoom target movement
        if (this.zoomTarget) {
            const distance = this.target.distanceTo(this.zoomTarget);
            
            if (distance > this.zoomThreshold) {
                // Move towards target point smoothly
                const direction = new THREE.Vector3().subVectors(this.zoomTarget, this.target).normalize();
                const moveAmount = Math.min(distance * this.zoomSpeed, distance); // Don't overshoot
                this.target.add(direction.multiplyScalar(moveAmount));
            } else {
                // Arrived at target, clear it
                this.target.copy(this.zoomTarget);
                this.zoomTarget = null;
            }
        }
        
        // Lock isometric angles
        if (this.mode === 'isometric') {
            this.orbitAzimuth = this.isometricAzimuth;
            this.orbitPolar = this.isometricPolar;
        }
        
        // World-locked cursor grab panning (overrides legacy drag)
        let handledByCursor = this.applyCursorGrabPan();

        // DISABLED: jittery because mouseWorldPosition raycasts against dynamic terrain mesh
        // Stable drag is handled below using grab-depth scale

        // Stable screen-pixel drag using one-time screen-to-world scale at grab depth
        if (!handledByCursor && this.rightMouseDown && (this.pendingDrag.x !== 0 || this.pendingDrag.y !== 0)) {
            const maxFrameDelta = 20;
            const dx = Math.max(-maxFrameDelta, Math.min(maxFrameDelta, this.pendingDrag.x));
            const dy = Math.max(-maxFrameDelta, Math.min(maxFrameDelta, this.pendingDrag.y));

            const panSpeed = this.dragWorldScale || this.getDynamicPanSpeed();
            const angleRad = this.dragAzimuth !== undefined ? this.dragAzimuth : this.orbitAzimuth;

            const moveVector = new THREE.Vector3();
            moveVector.x -= Math.cos(angleRad) * dx * panSpeed;
            moveVector.z += Math.sin(angleRad) * dx * panSpeed;
            moveVector.x -= Math.sin(angleRad) * dy * panSpeed;
            moveVector.z -= Math.cos(angleRad) * dy * panSpeed;

            this.target.add(moveVector);
            this.currentTarget.copy(this.target);
            this.lastDragMoveVector.copy(moveVector);
            this.velocity.set(0, 0, 0);

            this.pendingDrag.x = 0;
            this.pendingDrag.y = 0;
            this._enforceDragCutoff();
        }
        
        // Calculate camera position using spherical coordinates
        const horizDist = this.orbitDistance * Math.cos(this.orbitPolar);
        const x = this.currentTarget.x + horizDist * Math.sin(this.orbitAzimuth);
        const z = this.currentTarget.z + horizDist * Math.cos(this.orbitAzimuth);
        const yBase = this.currentTarget.y + this.orbitDistance * Math.sin(this.orbitPolar);
        
        // Get terrain height at camera position for collision avoidance
        let terrainHeight = 0;
        if (window.game && window.game.boardSystem) {
            terrainHeight = window.game.boardSystem.getTerrainHeight(x, z);
        }
        
        // Ensure camera stays above terrain with minimum clearance
        let desiredHeight = yBase;
        const minHeightAboveTerrain = terrainHeight + this.minCameraHeight;
        if (desiredHeight < minHeightAboveTerrain) {
            desiredHeight = minHeightAboveTerrain;
        }
        
        // Smooth height adjustment to prevent oscillation
        const currentHeight = this.camera.position.y;
        const heightDiff = desiredHeight - currentHeight;
        let smoothingFactor = 0.15;
        if (desiredHeight > currentHeight && heightDiff > 1.0) {
            smoothingFactor = 0.05;
        } else if (Math.abs(heightDiff) < 0.5) {
            smoothingFactor = 0.3;
        }
        const smoothHeight = currentHeight + heightDiff * smoothingFactor;
        
        // Check for oscillation and apply failsafe (only when not actively dragging)
        const currentPosition = new THREE.Vector3(x, smoothHeight, z);
        const movementDelta = currentPosition.distanceTo(this.lastPosition);
        
        // Skip oscillation detection during mouse dragging to prevent interference with normal camera control
        if (!this.rightMouseDown && !this.middleMouseDown && !this.mouseDown && !this.touchPanning) {
            // If we're moving back and forth in a small area, increment oscillation count
            if (movementDelta < 0.1 && this.velocity.length() > 0.01) {
                this.oscillationCount++;
            } else {
                this.oscillationCount = 0; // Reset if movement is normal
            }
            
            // Apply failsafe if we've been oscillating too long
            if (this.oscillationCount > this.maxOscillationCount) {
                console.log('[Camera] Oscillation detected - applying failsafe');
                this.currentTarget.copy(this.target); // Snap to target
                this.velocity.set(0, 0, 0); // Stop all movement
                this.oscillationCount = 0; // Reset counter
            }
        } else {
            // Reset oscillation counter when dragging to prevent false triggers
            this.oscillationCount = 0;
        }
        
        this.lastPosition.copy(currentPosition);
        this.camera.position.set(x, smoothHeight, z);

        // Widen FOV as camera rises for orbit effect
        const altitude = smoothHeight;
        const fovFactor = THREE.MathUtils.smoothstep(altitude, 20, 300);
        const targetFOV = 75 + 30 * fovFactor;
        if (Math.abs(this.camera.fov - targetFOV) > 0.1) {
            this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, 0.05);
            this.camera.updateProjectionMatrix();
        }

        // Camera always tracks the orbit target so panning feels connected to the landscape
        this.camera.lookAt(this.target);
    }
    
    cycleMode() {
        const modes = ['strategic', 'tactical', 'follow', 'free', 'isometric'];
        const currentIndex = modes.indexOf(this.mode);
        const nextIndex = (currentIndex + 1) % modes.length;
        
        this.setMode(modes[nextIndex]);
    }
    
    setMode(mode) {
        this.mode = mode;
        
        // Reset some values based on mode
        switch (mode) {
            case 'strategic':
                this.angle = 45;
                this.height = 30;
                this.distance = 40;
                break;
            case 'tactical':
                this.angle = 45;
                this.height = 15;
                this.distance = 20;
                break;
            case 'follow':
                this.angle = 45;
                this.height = 15;
                this.distance = 15;
                break;
            case 'free':
                // Keep current position
                break;
            case 'isometric':
                this.orbitAzimuth = this.isometricAzimuth;
                this.orbitPolar = this.isometricPolar;
                this.orbitDistance = 25;
                break;
        }
        
        this.updateCameraPosition();
    }
    
    centerOnPosition(x, z) {
        this.animateToTarget(x, 0, z);
    }
    
    animateToTarget(x, y, z) {
        this.animating = true;
        this.animationStart = Date.now();
        this.animationStartPos = this.target.clone();
        this.animationTargetPos = new THREE.Vector3(x, y, z);
    }
    
    updateAnimation() {
        if (!this.animating) return;
        
        const elapsed = Date.now() - this.animationStart;
        const progress = Math.min(elapsed / this.animationDuration, 1);
        
        // Ease in-out cubic
        const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        this.target.lerpVectors(this.animationStartPos, this.animationTargetPos, easedProgress);
        this.updateCameraPosition();
        
        if (progress >= 1) {
            this.animating = false;
            this.target.copy(this.animationTargetPos);
        }
    }
    
    getPosition() {
        return this.camera.position.clone();
    }
    
    getTarget() {
        return this.target.clone();
    }

    getHeadingRadians() {
        // orbitAzimuth already tracks the camera's rotation around the Y axis
        if (typeof this.orbitAzimuth === 'number') {
            return this.orbitAzimuth;
        }
        const forward = new THREE.Vector3();
        forward.subVectors(this.target, this.camera.position);
        return Math.atan2(forward.x, forward.z);
    }

    setTarget(x, y, z) {
        this.target.set(x, y, z);
        this.updateCameraPosition();
    }
    
    getRaycaster(mouseX, mouseY) {
        const raycaster = new THREE.Raycaster();
        const rect = {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight
        };
        
        raycaster.setFromCamera(
            new THREE.Vector2(
                ((mouseX - rect.left) / rect.width) * 2 - 1,
                -((mouseY - rect.top) / rect.height) * 2 + 1
            ),
            this.camera
        );
        
        return raycaster;
    }
    
        
    // Get visible tiles in camera view
    getVisibleTiles(range = 50) {
        const tiles = [];
        const cameraPos = this.camera.position;
        
        for (let x = -range; x <= range; x++) {
            for (let z = -range; z <= range; z++) {
                const worldX = this.target.x + x;
                const worldZ = this.target.z + z;
                
                const tilePos = new THREE.Vector3(worldX, 0, worldZ);
                const distance = cameraPos.distanceTo(tilePos);
                
                if (distance < this.distance * 2) {
                    tiles.push({ x: worldX, z: worldZ, distance: distance });
                }
            }
        }
        
        return tiles.sort((a, b) => a.distance - b.distance);
    }
    
    isTouchOnInteractive(clientX, clientY) {
        const raycaster = this.getRaycaster(clientX, clientY);
        
        // Check pieces
        if (window.game && window.game.piecesSystem) {
            const pieceMeshes = window.game.piecesSystem.getAllPieceMeshes();
            const pieceIntersects = raycaster.intersectObjects(pieceMeshes, true);
            if (pieceIntersects.length > 0) return true;
        }
        
        // Check valid move markers
        if (window.game && window.game.visualFeedback) {
            const markerMeshes = window.game.visualFeedback.getValidMoveMeshes();
            const markerIntersects = raycaster.intersectObjects(markerMeshes);
            if (markerIntersects.length > 0) return true;
        }
        
        return false;
    }
}
