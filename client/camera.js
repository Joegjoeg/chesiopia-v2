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
        this.rotationSpeed = 0.002;
        this.zoomSpeed = 0.5;
        
        // Input state
        this.keys = {};
        this.mouseDown = false;
        this.rightMouseDown = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        // Camera position for panning
        this.cameraX = 0;
        this.cameraZ = 0;
        this.minCameraHeight = 5; // Minimum height above terrain
        
        // Animation
        this.animating = false;
        this.animationStart = null;
        this.animationDuration = 1000;
        this.animationStartPos = null;
        this.animationTargetPos = null;
        
        // Add green sphere at camera target position for visualization
        this.targetSphere = this.createTargetSphere();
        this.scene.add(this.targetSphere);
        
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
        window.addEventListener('wheel', (e) => this.handleWheel(e));
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
        if (event.button === 0) { // Left click
            this.mouseDown = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        } else if (event.button === 2) { // Right click
            this.rightMouseDown = true;
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
            event.preventDefault(); // Prevent context menu
        }
    }
    
    handleMouseUp(event) {
        if (event.button === 0) { // Left click
            this.mouseDown = false;
        } else if (event.button === 2) { // Right click
            this.rightMouseDown = false;
        }
    }
    
    handleMouseMove(event) {
        if (this.mouseDown) {
            const deltaX = event.clientX - this.lastMouseX;
            const deltaY = event.clientY - this.lastMouseY;
            
            if (this.mode === 'tactical' || this.mode === 'free') {
                // Move camera target like WASD keys (swapped from right click)
                const panSpeed = 0.05;
                const angleRad = this.angle * Math.PI / 180;
                
                // Calculate movement vectors based on camera angle
                const moveVector = new THREE.Vector3();
                
                // Horizontal mouse movement (left/right) affects strafing (A/D keys)
                moveVector.x -= Math.cos(angleRad) * deltaX * panSpeed;
                moveVector.z += Math.sin(angleRad) * deltaX * panSpeed;
                
                // Vertical mouse movement (up/down) affects forward/backward (W/S keys)
                moveVector.x -= Math.sin(angleRad) * deltaY * panSpeed; // Reversed: Backward/Forward
                moveVector.z -= Math.cos(angleRad) * deltaY * panSpeed; // Reversed: Backward/Forward
                
                this.target.add(moveVector);
                this.updateCameraPosition();
            }
            
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        }
        
        if (this.rightMouseDown) {
            const deltaX = event.clientX - this.lastMouseX;
            const deltaY = event.clientY - this.lastMouseY;
            
            if (this.mode === 'tactical' || this.mode === 'free') {
                // Rotate camera around target (reversed Y direction) (swapped from left click)
                this.angle -= deltaX * this.rotationSpeed * 100;
                this.height = Math.max(5, Math.min(50, this.height + deltaY * 0.1)); // Reversed: + instead of -
            }
            
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        }
    }
    
    handleWheel(event) {
        event.preventDefault();
        
        // Move camera along its local forward axis
        const moveSpeed = 2.0;
        const delta = event.deltaY > 0 ? -1 : 1; // Reversed: scroll forward = move forward
        
        // Get camera's local forward direction
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        
        // Move target along camera's local forward axis
        const moveVector = forward.clone().multiplyScalar(delta * moveSpeed);
        this.target.add(moveVector);
        this.updateCameraPosition();
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
                this.angle -= deltaX * this.rotationSpeed * 100;
                this.height = Math.max(5, Math.min(50, this.height - deltaY * 0.1));
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
        const angleRad = this.angle * Math.PI / 180;
        
        // Calculate camera position based on target and angle
        const x = this.target.x + Math.sin(angleRad) * this.distance;
        const z = this.target.z + Math.cos(angleRad) * this.distance;
        
        // Get terrain height at camera position for collision avoidance
        let terrainHeight = 0;
        if (window.game && window.game.boardSystem) {
            terrainHeight = window.game.boardSystem.getTerrainHeight(x, z);
        }
        
        // Calculate desired height
        let desiredHeight = this.target.y + this.height;
        
        // Ensure camera stays above terrain with minimum clearance
        const minHeightAboveTerrain = terrainHeight + this.minCameraHeight;
        if (desiredHeight < minHeightAboveTerrain) {
            desiredHeight = minHeightAboveTerrain;
        }
        
        // Smooth height adjustment for collision avoidance
        const currentHeight = this.camera.position.y;
        const heightDiff = desiredHeight - currentHeight;
        const smoothHeight = currentHeight + heightDiff * 0.1; // Smooth transition
        
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
    
    createTargetSphere() {
        const geometry = new THREE.SphereGeometry(0.2, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3
        });
        
        const sphere = new THREE.Mesh(geometry, material);
        sphere.renderOrder = 1000; // Render on top
        return sphere;
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
