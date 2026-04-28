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
        this.keys[event.key.toLowerCase()] = true;
        
        // Prevent default for game keys
        if (['w', 'a', 's', 'd', 'q', 'e', ' '].includes(event.key.toLowerCase())) {
            event.preventDefault();
        }
    }
    
    handleKeyUp(event) {
        this.keys[event.key.toLowerCase()] = false;
    }
    
    handleMouseDown(event) {
        if (event.button === 0) { // Left click - now for pieces only
            // Don't handle camera controls here - let game handle pieces
        } else if (event.button === 1) { // Middle click - camera orientation
            this.middleMouseDown = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
            event.preventDefault(); // Prevent middle-click behavior
        } else if (event.button === 2) { // Right click - camera position
            this.rightMouseDown = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
            event.preventDefault(); // Prevent context menu
        }
    }
    
    handleMouseUp(event) {
        if (event.button === 0) { // Left click - pieces only
            this.mouseDown = false;
        } else if (event.button === 1) { // Middle click - camera orientation
            this.middleMouseDown = false;
        } else if (event.button === 2) { // Right click - camera position
            this.rightMouseDown = false;
            // Sync currentTarget with target to prevent wobble when drag ends
            this.currentTarget.copy(this.target);
            // Clear velocity to prevent momentum-based movement after drag
            this.velocity.set(0, 0, 0);
            // Reset oscillation counter to prevent false triggers
            this.oscillationCount = 0;
        }
    }
    
    handleMouseMove(event) {
        if (this.middleMouseDown) {
            const deltaX = event.clientX - this.lastMouseX;
            const deltaY = event.clientY - this.lastMouseY;
            
            if (this.mode === 'tactical' || this.mode === 'free') {
                // Add angular velocity for spin momentum rotation (now middle click)
                this.angleVelocity -= deltaX * this.rotationSpeed * 100;
                
                // Vertical arc rotation around center point
                const verticalRotationSpeed = 0.002;
                const currentVerticalAngle = Math.atan2(this.height - 15, this.distance); // Current vertical angle
                const newVerticalAngle = currentVerticalAngle + deltaY * verticalRotationSpeed;
                
                // Calculate new height and distance based on vertical arc
                const arcRadius = Math.sqrt(Math.pow(this.distance, 2) + Math.pow(this.height - 15, 2));
                this.distance = Math.max(5, Math.min(50, arcRadius * Math.cos(newVerticalAngle)));
                this.height = 15 + arcRadius * Math.sin(newVerticalAngle);
            }
            
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        }
        
        if (this.rightMouseDown) {
            const deltaX = event.clientX - this.lastMouseX;
            const deltaY = event.clientY - this.lastMouseY;
            
            if (this.mode === 'tactical' || this.mode === 'free') {
                // Move camera target like WASD keys (now right click)
                const panSpeed = 0.04; // Reduced sensitivity for more controlled movement
                const angleRad = this.angle * Math.PI / 180;
                
                // Calculate movement vectors based on camera angle
                const moveVector = new THREE.Vector3();
                
                // Horizontal mouse movement (left/right) affects strafing (A/D keys)
                moveVector.x -= Math.cos(angleRad) * deltaX * panSpeed;
                moveVector.z += Math.sin(angleRad) * deltaX * panSpeed;
                
                // Vertical mouse movement (up/down) affects forward/backward (W/S keys)
                moveVector.x -= Math.sin(angleRad) * deltaY * panSpeed; // Reversed: Backward/Forward
                moveVector.z -= Math.cos(angleRad) * deltaY * panSpeed; // Reversed: Backward/Forward
                
                // Apply movement directly to target during dragging for immediate response
                this.target.add(moveVector);
                
                // During dragging, update currentTarget more aggressively for smoother movement
                this.currentTarget.lerp(this.target, 0.3); // Faster interpolation during drag
                this.velocity.set(0, 0, 0); // Clear velocity during drag to prevent sway
            }
            
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        }
    }
    
    handleWheel(event) {
        event.preventDefault();
        
        // Target point zoom system
        const scrollDelta = event.deltaY;
        const zoomDirection = scrollDelta > 0 ? -1 : 1; // Reversed: scroll forward = zoom in
        
        // Get camera's forward direction
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        
        // Calculate target point along line of sight
        const stepDistance = 5.0; // Reduced step distance for less dramatic zoom
        const newTarget = this.target.clone().add(forward.clone().multiplyScalar(zoomDirection * stepDistance));
        
        // Set the zoom target for smooth movement
        this.zoomTarget = newTarget;
    }
    
    handleTouchStart(event) {
        if (event.touches.length === 1) {
            this.mouseDown = true;
            this.lastMouseX = event.touches[0].clientX;
            this.lastMouseY = event.touches[0].clientY;
        }
    }
    
    handleTouchMove(event) {
        if (event.touches.length === 1 && this.mouseDown) {
            const deltaX = event.touches[0].clientX - this.lastMouseX;
            const deltaY = event.touches[0].clientY - this.lastMouseY;
            
            if (this.mode === 'tactical' || this.mode === 'free') {
                this.angleVelocity -= deltaX * this.rotationSpeed * 100;
                
                // Vertical arc rotation around center point (same as mouse movement)
                const verticalRotationSpeed = 0.002;
                const currentVerticalAngle = Math.atan2(this.height - 15, this.distance);
                const newVerticalAngle = currentVerticalAngle - deltaY * verticalRotationSpeed; // Reversed for touch
                
                // Calculate new height and distance based on vertical arc
                const arcRadius = Math.sqrt(Math.pow(this.distance, 2) + Math.pow(this.height - 15, 2));
                this.distance = Math.max(5, Math.min(50, arcRadius * Math.cos(newVerticalAngle)));
                this.height = 15 + arcRadius * Math.sin(newVerticalAngle);
            }
            
            this.lastMouseX = event.touches[0].clientX;
            this.lastMouseY = event.touches[0].clientY;
        }
    }
    
    handleTouchEnd(event) {
        this.mouseDown = false;
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
        
        // Q/E for zoom
        if (this.keys['q']) this.distance = Math.max(10, this.distance - this.zoomSpeed);
        if (this.keys['e']) this.distance = Math.min(50, this.distance + this.zoomSpeed);
    }
    
    updateTacticalMode() {
        // Similar to strategic but with rotation
        const moveVector = new THREE.Vector3();
        
        if (this.keys['w']) {
            moveVector.x -= Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z -= Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
        }
        if (this.keys['s']) {
            moveVector.x += Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z += Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
        }
        if (this.keys['a']) {
            moveVector.x -= Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z += Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
        }
        if (this.keys['d']) {
            moveVector.x += Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z -= Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
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
        // Full 3D movement
        const moveVector = new THREE.Vector3();
        
        if (this.keys['w']) {
            moveVector.x += Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z += Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
        }
        if (this.keys['s']) {
            moveVector.x -= Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z -= Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
        }
        if (this.keys['a']) {
            moveVector.x += Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z -= Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
        }
        if (this.keys['d']) {
            moveVector.x -= Math.cos(this.angle * Math.PI / 180) * this.moveSpeed;
            moveVector.z += Math.sin(this.angle * Math.PI / 180) * this.moveSpeed;
        }
        
        this.target.add(moveVector);
        
        // Q/E for height
        if (this.keys['q']) this.height = Math.max(2, this.height - 0.3);
        if (this.keys['e']) this.height = Math.min(100, this.height + 0.3);
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
        
        const angleRad = this.currentAngle * Math.PI / 180;
        
        // Calculate camera position based on smoothed target and angle
        const x = this.currentTarget.x + Math.sin(angleRad) * this.distance;
        const z = this.currentTarget.z + Math.cos(angleRad) * this.distance;
        
        // Get terrain height at camera position for collision avoidance
        let terrainHeight = 0;
        if (window.game && window.game.boardSystem) {
            terrainHeight = window.game.boardSystem.getTerrainHeight(x, z);
        }
        
        // Calculate desired height
        let desiredHeight = this.currentTarget.y + this.height;
        
        // Ensure camera stays above terrain with minimum clearance
        const minHeightAboveTerrain = terrainHeight + this.minCameraHeight;
        if (desiredHeight < minHeightAboveTerrain) {
            desiredHeight = minHeightAboveTerrain;
        }
        
        // More stable height adjustment to prevent oscillation
        const currentHeight = this.camera.position.y;
        const heightDiff = desiredHeight - currentHeight;
        
        // Use different smoothing factors based on the situation
        let smoothingFactor = 0.15; // Default smooth transition
        
        // If we're being pushed up by terrain, use more gradual smoothing
        if (desiredHeight > currentHeight && heightDiff > 1.0) {
            smoothingFactor = 0.05; // Very gradual when terrain is pushing up
        }
        // If we're close to target height, use faster smoothing
        else if (Math.abs(heightDiff) < 0.5) {
            smoothingFactor = 0.3; // Faster when close to target
        }
        
        const smoothHeight = currentHeight + heightDiff * smoothingFactor;
        
        // Check for oscillation and apply failsafe (only when not actively dragging)
        const currentPosition = new THREE.Vector3(x, smoothHeight, z);
        const movementDelta = currentPosition.distanceTo(this.lastPosition);
        
        // Skip oscillation detection during mouse dragging to prevent interference with normal camera control
        if (!this.rightMouseDown && !this.middleMouseDown) {
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
        this.camera.lookAt(this.target);
    }
    
    cycleMode() {
        const modes = ['strategic', 'tactical', 'follow', 'free'];
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
}
