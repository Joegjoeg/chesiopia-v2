class VisualFeedbackSystem {
    constructor(scene) {
        this.scene = scene;
        this.highlightMeshes = new Map();
        this.effectMeshes = [];
        this.hoveredTile = null;
        this.selectedPiece = null;
        this.validMoves = [];
        
        // Materials for visual feedback
        this.highlightMaterial = new THREE.MeshStandardMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.5,
            emissive: 0x00ff00,
            emissiveIntensity: 0.3
        });
        
        this.validMoveMaterial = new THREE.MeshStandardMaterial({
            color: 0x0088ff,
            transparent: true,
            opacity: 0.4,
            emissive: 0x0088ff,
            emissiveIntensity: 0.2
        });
        
        this.captureMoveMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5,
            emissive: 0xff0000,
            emissiveIntensity: 0.3
        });
        
        this.hoverMaterial = new THREE.MeshStandardMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8,
            emissive: 0xffff00,
            emissiveIntensity: 0.5
        });
        
        this.coveringMaterial = new THREE.MeshStandardMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.4,
            emissive: 0xff00ff,
            emissiveIntensity: 0.3
        });
        
        // Animation
        this.animations = [];
        this.pulseTime = 0;
        
        // Track when individual move markers are ready for interaction
        this.readyMarkers = new Set();
    }
    
    update() {
        this.pulseTime += 0.05;
        
        // Update animations
        this.animations = this.animations.filter(anim => {
            return !this.updateAnimation(anim);
        });
        
        // Update pulse effects
        this.updatePulseEffects();
    }

    getValidMoveMeshes() {
        // Return all valid move marker meshes for raycaster intersection
        const meshes = [];
        this.highlightMeshes.forEach((mesh, key) => {
            if (key.startsWith('move_')) {
                meshes.push(mesh);
            }
        });
        return meshes;
    }
    
    showSelectedPiece(piece) {
        this.clearSelection();
        this.selectedPiece = piece;
        
        // Create selection indicator
        const indicator = this.createSelectionIndicator(piece.x, piece.z);
        this.highlightMeshes.set('selected', indicator);
        this.scene.add(indicator);
    }
    
    showValidMoves(moves, clearImmediately = true) {
        // Clear immediately unless explicitly disabled (for post-move scenarios)
        if (clearImmediately) {
            this.clearValidMovesImmediate();
        }
        this.validMoves = moves;
        
        // Clear ready markers set
        this.readyMarkers.clear();
        
        if (moves.length === 0) {
            return;
        }
        
        // Get current piece position from game state to ensure we have the updated position
        let pieceX = 0, pieceZ = 0;
        if (this.selectedPiece) {
            // Try to get fresh piece data from game state
            if (window.game && window.game.gameState) {
                const currentPiece = window.game.gameState.getPiece(this.selectedPiece.id);
                if (currentPiece) {
                    pieceX = currentPiece.x;
                    pieceZ = currentPiece.z;
                } else {
                    // Fallback to selected piece position
                    pieceX = this.selectedPiece.x;
                    pieceZ = this.selectedPiece.z;
                }
            } else {
                pieceX = this.selectedPiece.x;
                pieceZ = this.selectedPiece.z;
            }
        }
        
        // Sort moves by distance from piece (closest first)
        const sortedMoves = [...moves].sort((a, b) => {
            const distA = Math.sqrt((a.x - pieceX) ** 2 + (a.z - pieceZ) ** 2);
            const distB = Math.sqrt((b.x - pieceX) ** 2 + (b.z - pieceZ) ** 2);
            return distA - distB;
        });
        
        // Create indicators with sequential pop-up animation
        sortedMoves.forEach((move, sortedIndex) => {
            const originalIndex = moves.indexOf(move);
            const indicator = this.createMoveIndicator(move, originalIndex);
            const key = `move_${originalIndex}`;
            
            console.log('[VisualFeedback] Creating move marker:', key, 'at position:', move.x, move.z);
            
            // Start with scale 0 and add to scene
            indicator.scale.setScalar(0);
            this.highlightMeshes.set(key, indicator);
            this.scene.add(indicator);
            
            // Add pop-up animation data
            indicator.userData = {
                ...indicator.userData,
                type: 'popup',
                startTime: Date.now(),
                delay: sortedIndex * 100, // 100ms delay between each marker
                initialScale: 0,
                targetScale: 1
            };
        });
        
        // Set individual readiness timeouts for each marker
        sortedMoves.forEach((move, sortedIndex) => {
            const originalIndex = moves.indexOf(move);
            const key = `move_${originalIndex}`;
            const readyTime = sortedIndex * 100 + 300; // Individual delay + animation duration
            
            setTimeout(() => {
                this.readyMarkers.add(key);
                console.log(`[VisualFeedback] Marker ${key} is now ready for interaction`);
            }, readyTime);
        });
    }
    
    showTileHover(x, z) {
        this.hideTileHover();
        this.hoveredTile = { x, z };
        
        const indicator = this.createHoverIndicator(x, z);
        this.highlightMeshes.set('hover', indicator);
        
        // Add to scene on top to avoid clipping issues
        indicator.renderOrder = 1000;
        this.scene.add(indicator);
        
        // Add red ball debug indicator at same position
        const debugBall = this.createDebugBall(x, z);
        this.highlightMeshes.set('debug_ball', debugBall);
        this.scene.add(debugBall);
        
        // Force mesh to render on top
        this.scene.traverse((child) => {
            if (child.isMesh) {
                child.renderOrder = child.renderOrder || 0;
            }
        });
    }
    
    createDebugBall(x, z) {
        const geometry = new THREE.SphereGeometry(0.1);
        const material = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 1.0
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x + 0.5, this.getTerrainHeight(x, z) + 0.1, z + 0.5);
        mesh.renderOrder = 1001;
        
        return mesh;
    }
    
    createHoverIndicator(x, z) {
        // Create custom geometry that matches board tile exactly
        const geometry = this.createTileGeometry(x, z);
        const material = this.hoverMaterial;
        
        const mesh = new THREE.Mesh(geometry, material);
        // Position at tile origin, geometry vertices handle the rest
        mesh.position.set(x, 0, z);
        
        return mesh;
    }
    
    createTileGeometry(x, z) {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const indices = [];
        
        // Get exact same corner heights as board
        const height00 = this.getTerrainHeight(x, z);
        const height10 = this.getTerrainHeight(x + 1, z);
        const height01 = this.getTerrainHeight(x, z + 1);
        const height11 = this.getTerrainHeight(x + 1, z + 1);
        
        // Slightly smaller than tile with small offset above surface
        const scale = 0.95;
        const offset = 0.05;
        const margin = (1 - scale) / 2;
        
        // Create vertices for hover indicator in local space (0-1 range)
        vertices.push(
            margin, height00 + offset, margin,           // bottom-left
            1 - margin, height10 + offset, margin,       // bottom-right  
            margin, height01 + offset, 1 - margin,       // top-left
            1 - margin, height11 + offset, 1 - margin    // top-right
        );
        
        // Create indices for two triangles
        indices.push(0, 1, 2, 1, 3, 2);
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        return geometry;
    }
    
    hideSelection() {
        const selected = this.highlightMeshes.get('selected');
        if (selected) {
            this.scene.remove(selected);
            selected.geometry.dispose();
            selected.material.dispose();
            this.highlightMeshes.delete('selected');
        }
        this.selectedPiece = null;
    }
    
    hideTileHover() {
        const hoverIndicator = this.highlightMeshes.get('hover');
        if (hoverIndicator) {
            this.scene.remove(hoverIndicator);
            hoverIndicator.geometry.dispose();
            hoverIndicator.material.dispose();
            this.highlightMeshes.delete('hover');
        }
        
        // Also remove debug ball
        const debugBall = this.highlightMeshes.get('debug_ball');
        if (debugBall) {
            this.scene.remove(debugBall);
            debugBall.geometry.dispose();
            debugBall.material.dispose();
            this.highlightMeshes.delete('debug_ball');
        }
        
        this.hoveredTile = null;
    }
    
    showCoveringRelationship(coveringPiece, coveredPiece) {
        // Create visual line between covering and covered pieces
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(coveringPiece.x + 0.5, 2, coveringPiece.z + 0.5),
            new THREE.Vector3(coveredPiece.x + 0.5, 2, coveredPiece.z + 0.5)
        ]);
        
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0xff00ff,
            linewidth: 3,
            transparent: true,
            opacity: 0.7
        });
        
        const line = new THREE.Line(lineGeometry, lineMaterial);
        this.highlightMeshes.set('covering_line', line);
        this.scene.add(line);
        
        // Add indicator on covered piece
        const coveredIndicator = this.createCoveredIndicator(coveredPiece.x, coveredPiece.z);
        this.highlightMeshes.set('covered', coveredIndicator);
        this.scene.add(coveredIndicator);
    }
    
    clearCoveringRelationship() {
        const line = this.highlightMeshes.get('covering_line');
        if (line) {
            this.scene.remove(line);
            line.geometry.dispose();
            line.material.dispose();
            this.highlightMeshes.delete('covering_line');
        }
        
        const covered = this.highlightMeshes.get('covered');
        if (covered) {
            this.scene.remove(covered);
            covered.geometry.dispose();
            covered.material.dispose();
            this.highlightMeshes.delete('covered');
        }
    }
    
    showCaptureEffect(x, z) {
        const effect = this.createCaptureEffect(x, z);
        this.scene.add(effect);
        this.effectMeshes.push(effect);
        
        // Remove after animation
        setTimeout(() => {
            this.scene.remove(effect);
            effect.geometry.dispose();
            effect.material.dispose();
            const index = this.effectMeshes.indexOf(effect);
            if (index > -1) {
                this.effectMeshes.splice(index, 1);
            }
        }, 1000);
    }
    
    showSpawnEffect(x, z) {
        const effect = this.createSpawnEffect(x, z);
        this.scene.add(effect);
        this.effectMeshes.push(effect);
        
        // Remove after animation
        setTimeout(() => {
            this.scene.remove(effect);
            effect.geometry.dispose();
            effect.material.dispose();
            const index = this.effectMeshes.indexOf(effect);
            if (index > -1) {
                this.effectMeshes.splice(index, 1);
            }
        }, 1500);
    }
    
    showMovePath(fromX, fromZ, toX, toZ) {
        const pathGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(fromX + 0.5, 0.5, fromZ + 0.5),
            new THREE.Vector3(toX + 0.5, 0.5, toZ + 0.5)
        ]);
        
        const pathMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff00,
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });
        
        const path = new THREE.Line(pathGeometry, pathMaterial);
        this.highlightMeshes.set('move_path', path);
        this.scene.add(path);
        
        // Animate along path
        this.animatePath(path);
    }
    
    clearSelection() {
        const selected = this.highlightMeshes.get('selected');
        if (selected) {
            this.scene.remove(selected);
            selected.geometry.dispose();
            selected.material.dispose();
            this.highlightMeshes.delete('selected');
        }
        this.selectedPiece = null;
    }
    
    clearValidMoves() {
        const moveKeys = [];
        console.log('[VisualFeedback] Clearing valid moves, current keys:', Array.from(this.highlightMeshes.keys()));
        
        for (const [key, mesh] of this.highlightMeshes) {
            if (key.startsWith('move_')) {
                moveKeys.push(key);
                console.log('[VisualFeedback] Marking for removal:', key);
                
                // Add pop-out animation
                mesh.userData = {
                    type: 'popout',
                    startTime: Date.now(),
                    initialScale: mesh.scale.x,
                    targetScale: 0,
                    markedForRemoval: true
                };
            }
        }
        
        // Remove after animation completes with longer timeout to ensure completion
        setTimeout(() => {
            console.log('[VisualFeedback] Primary cleanup timeout triggered');
            moveKeys.forEach(key => {
                const mesh = this.highlightMeshes.get(key);
                if (mesh && mesh.userData.markedForRemoval) {
                    console.log('[VisualFeedback] Removing mesh via primary cleanup:', key);
                    this.scene.remove(mesh);
                    mesh.geometry.dispose();
                    mesh.material.dispose();
                    this.highlightMeshes.delete(key);
                }
            });
        }, 300); // Increased to 300ms to ensure animation completes
        
        // Immediate fallback removal to ensure cleanup
        setTimeout(() => {
            console.log('[VisualFeedback] Failsafe cleanup timeout triggered');
            moveKeys.forEach(key => {
                const mesh = this.highlightMeshes.get(key);
                if (mesh) {
                    console.log('[VisualFeedback] Removing mesh via failsafe cleanup:', key);
                    this.scene.remove(mesh);
                    mesh.geometry.dispose();
                    mesh.material.dispose();
                    this.highlightMeshes.delete(key);
                }
            });
        }, 500); // Failsafe cleanup
        
        this.validMoves = [];
    }
    
    hasVisibleMoveMarkers() {
        // Check if there are any visible move markers
        return this.highlightMeshes.size > 0 || this.validMoves.length > 0;
    }
    
    clearValidMovesImmediate() {
        const moveKeys = [];
        console.log('[VisualFeedback] Clearing valid moves immediately, current keys:', Array.from(this.highlightMeshes.keys()));
        
        for (const [key, mesh] of this.highlightMeshes) {
            if (key.startsWith('move_')) {
                moveKeys.push(key);
                console.log('[VisualFeedback] Removing mesh immediately:', key);
                
                // Remove immediately without animation
                this.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
                this.highlightMeshes.delete(key);
            }
        }
        
        this.validMoves = [];
        this.readyMarkers.clear(); // Reset ready markers
    }
    
    isMarkerReady(x, z) {
        // Find the move at this position and check if its marker is ready
        const move = this.validMoves.find(m => m.x === x && m.z === z);
        if (move) {
            const originalIndex = this.validMoves.indexOf(move);
            const key = `move_${originalIndex}`;
            return this.readyMarkers.has(key);
        }
        return false;
    }
    
    clearAllHighlights() {
        for (const [key, mesh] of this.highlightMeshes) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.highlightMeshes.clear();
        this.selectedPiece = null;
        this.validMoves = [];
        this.hoveredTile = null;
    }
    
    createSelectionIndicator(x, z) {
        const geometry = new THREE.RingGeometry(0.3, 0.4, 8);
        const material = this.highlightMaterial.clone();
        material.emissiveIntensity = 0.5;
        
        const mesh = new THREE.Mesh(geometry, material);
        
        // Use terrain height
        const terrainHeight = this.getTerrainHeight(x, z);
        mesh.position.set(x + 0.5, terrainHeight + 0.1, z + 0.5);
        mesh.rotation.x = -Math.PI / 2;
        
        return mesh;
    }
    
    createMoveIndicator(move, index) {
        const material = move.isCapture ? this.captureMoveMaterial : this.validMoveMaterial;
        const geometry = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8);
        
        const mesh = new THREE.Mesh(geometry, material);
        
        // Use terrain height and raise higher to prevent dipping below squares
        const terrainHeight = this.getTerrainHeight(move.x, move.z);
        mesh.position.set(move.x + 0.5, terrainHeight + 0.3, move.z + 0.5);
        mesh.rotation.x = Math.PI / 2; // Rotate 90 degrees in x-axis to stand upright
        
        // Add pulsing and spinning animation
        mesh.userData = { 
            type: 'pulse',
            startTime: Date.now(),
            phase: index * 0.2,
            spinSpeed: 0.5, // Slow spin speed (radians per second)
            initialRotation: Math.random() * Math.PI * 2 // Random starting rotation
        };
        
        return mesh;
    }
    
    getTerrainHeight(x, z) {
        // Try to get height from board system first
        if (window.game && window.game.boardSystem) {
            return window.game.boardSystem.getTerrainHeight(x, z);
        }
        
        // Fallback to simple height calculation
        return Math.sin(x * 0.02) * Math.cos(z * 0.02) * 12.5;
    }
    
    createCoveredIndicator(x, z) {
        const geometry = new THREE.OctahedronGeometry(0.3);
        const material = this.coveringMaterial;
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x + 0.5, 1, z + 0.5);
        
        // Add rotation animation
        mesh.userData = { 
            type: 'rotate',
            rotationSpeed: 0.02
        };
        
        return mesh;
    }
    
    createCaptureEffect(x, z) {
        const geometry = new THREE.SphereGeometry(0.5, 8, 6);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.8
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x + 0.5, 0.5, z + 0.5);
        
        // Add explosion animation
        mesh.userData = {
            type: 'explode',
            startTime: Date.now(),
            duration: 1000
        };
        
        return mesh;
    }
    
    createSpawnEffect(x, z) {
        const geometry = new THREE.RingGeometry(0.1, 1.0, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x + 0.5, 0.1, z + 0.5);
        mesh.rotation.x = -Math.PI / 2;
        
        // Add spawn animation
        mesh.userData = {
            type: 'spawn',
            startTime: Date.now(),
            duration: 1500
        };
        
        return mesh;
    }
    
    easeOutElastic(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    
    updatePulseEffects() {
        for (const [key, mesh] of this.highlightMeshes) {
            if (mesh.userData.type === 'pulse') {
                const elapsed = Date.now() - mesh.userData.startTime;
                const phase = mesh.userData.phase;
                const pulse = Math.sin(elapsed * 0.003 + phase) * 0.5 + 0.5;
                
                mesh.material.opacity = 0.3 + pulse * 0.3;
                mesh.scale.setScalar(1 + pulse * 0.2);
                
                // Add slow spinning animation
                if (mesh.userData.spinSpeed !== undefined) {
                    const currentTime = Date.now() * 0.001; // Convert to seconds
                    const spinRotation = mesh.userData.initialRotation + (currentTime * mesh.userData.spinSpeed);
                    mesh.rotation.z = spinRotation;
                }
            }
            
            if (mesh.userData.type === 'popup') {
                const elapsed = Date.now() - mesh.userData.startTime - mesh.userData.delay;
                
                if (elapsed >= 0) {
                    const progress = Math.min(elapsed / 300, 1); // 300ms animation
                    const easedProgress = this.easeOutElastic(progress);
                    const scale = mesh.userData.initialScale + (mesh.userData.targetScale - mesh.userData.initialScale) * easedProgress;
                    mesh.scale.setScalar(scale);
                    
                    // After popup animation, switch to pulse animation
                    if (progress >= 1) {
                        mesh.userData.type = 'pulse';
                        mesh.userData.startTime = Date.now();
                        mesh.userData.phase = 0;
                    }
                }
            }
            
            if (mesh.userData.type === 'popout') {
                const elapsed = Date.now() - mesh.userData.startTime;
                const progress = Math.min(elapsed / 200, 1); // 200ms animation
                const easedProgress = 1 - this.easeOutElastic(1 - progress); // Reverse elastic
                const scale = mesh.userData.initialScale + (mesh.userData.targetScale - mesh.userData.initialScale) * easedProgress;
                mesh.scale.setScalar(scale);
                mesh.material.opacity = 1 - progress; // Fade out
                
                // Failsafe: remove if animation is complete and still exists
                if (progress >= 1 && mesh.userData.markedForRemoval) {
                    console.log('[VisualFeedback] Removing mesh via failsafe:', key);
                    this.scene.remove(mesh);
                    mesh.geometry.dispose();
                    mesh.material.dispose();
                    this.highlightMeshes.delete(key);
                }
            }
            
            if (mesh.userData.type === 'rotate') {
                mesh.rotation.y += mesh.userData.rotationSpeed;
            }
        }
    }
    
    updateAnimation(anim) {
        const elapsed = Date.now() - anim.startTime;
        const progress = Math.min(elapsed / anim.duration, 1);
        
        switch (anim.type) {
            case 'explode':
                const scale = 1 + progress * 2;
                anim.mesh.scale.setScalar(scale);
                anim.mesh.material.opacity = 1 - progress;
                break;
                
            case 'spawn':
                const spawnScale = progress;
                anim.mesh.scale.setScalar(spawnScale);
                anim.mesh.material.opacity = 1 - progress * 0.5;
                anim.mesh.rotation.z = progress * Math.PI * 2;
                break;
        }
        
        return progress >= 1;
    }
    
    animatePath(path) {
        const duration = 500;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = (elapsed % duration) / duration;
            
            // Create moving dot along path
            const dotGeometry = new THREE.SphereGeometry(0.1);
            const dotMaterial = new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                emissive: 0x00ff00
            });
            
            const dot = new THREE.Mesh(dotGeometry, dotMaterial);
            
            // Position along path
            const points = path.geometry.attributes.position.array;
            const t = progress;
            const x = points[0] + (points[3] - points[0]) * t;
            const y = points[1] + (points[4] - points[1]) * t + Math.sin(progress * Math.PI) * 0.5;
            const z = points[2] + (points[5] - points[2]) * t;
            
            dot.position.set(x, y, z);
            this.scene.add(dot);
            
            // Remove dot after short time
            setTimeout(() => {
                this.scene.remove(dot);
                dot.geometry.dispose();
                dot.material.dispose();
            }, 100);
            
            if (elapsed < duration * 2) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    // Show cooldown indicator for a piece
    showCooldown(piece) {
        const indicator = this.createCooldownIndicator(piece);
        this.highlightMeshes.set(`cooldown_${piece.id}`, indicator);
        this.scene.add(indicator);
    }
    
    hideCooldown(pieceId) {
        const indicator = this.highlightMeshes.get(`cooldown_${pieceId}`);
        if (indicator) {
            this.scene.remove(indicator);
            indicator.geometry.dispose();
            indicator.material.dispose();
            this.highlightMeshes.delete(`cooldown_${pieceId}`);
        }
    }
    
    createCooldownIndicator(piece) {
        const geometry = new THREE.RingGeometry(0.35, 0.4, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x666666,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        // Use terrain height
        const terrainHeight = this.getTerrainHeight(piece.x, piece.z);
        mesh.position.set(piece.x + 0.5, terrainHeight + 0.15, piece.z + 0.5);
        mesh.rotation.x = -Math.PI / 2;
        
        // Calculate cooldown progress
        const cooldownTime = this.getCooldownTime(piece.type);
        const elapsed = Date.now() - (piece.lastMoveTime || 0);
        const progress = Math.min(elapsed / cooldownTime, 1);
        
        // Create arc for remaining cooldown
        const arcGeometry = new THREE.RingGeometry(0.35, 0.4, 16, 0, (1 - progress) * Math.PI * 2);
        const arcMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        
        const arc = new THREE.Mesh(arcGeometry, arcMaterial);
        arc.position.copy(mesh.position);
        arc.rotation.copy(mesh.rotation);
        
        const group = new THREE.Group();
        group.add(mesh);
        group.add(arc);
        
        return group;
    }
    
    getCooldownTime(pieceType) {
        const cooldowns = {
            pawn: 2000,
            knight: 3000,
            bishop: 3000,
            rook: 4000,
            queen: 6000,
            king: 2000
        };
        
        return cooldowns[pieceType] || 2000;
    }
    
    dispose() {
        this.clearAllHighlights();
        
        // Dispose effect meshes
        this.effectMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.effectMeshes = [];
        
        // Dispose materials
        this.highlightMaterial.dispose();
        this.validMoveMaterial.dispose();
        this.captureMoveMaterial.dispose();
        this.hoverMaterial.dispose();
        this.coveringMaterial.dispose();
    }
}
