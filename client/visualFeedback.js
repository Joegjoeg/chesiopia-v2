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
        
        // Performance tuning
        this.maxParticles = 100; // Limit particle effects
        
        // Track when individual move markers are ready for interaction
        this.readyMarkers = new Set();
        
        // Single InstancedMesh for all move indicators (1 draw call)
        this.MAX_MOVE_INDICATORS = 64;
        const indicatorGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8);
        const indicatorMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.5,
            emissive: 0xffffff,
            emissiveIntensity: 0.2
        });
        this._moveIndicatorMesh = new THREE.InstancedMesh(indicatorGeometry, indicatorMaterial, this.MAX_MOVE_INDICATORS);
        this._moveIndicatorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this._moveIndicatorMesh.count = 0;
        this._moveIndicatorMesh.name = 'moveIndicatorMesh';
        this.scene.add(this._moveIndicatorMesh);
        
        this._dummy = new THREE.Object3D();
        this._instanceData = [];
        this._moveIndicatorState = 'idle';
        this._moveIndicatorDyingStart = 0;
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
        // Return the single InstancedMesh for raycaster intersection
        if (this._moveIndicatorMesh && this._moveIndicatorMesh.count > 0) {
            return [this._moveIndicatorMesh];
        }
        return [];
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
        this._moveIndicatorState = 'active';
        
        // Clear ready markers set
        this.readyMarkers.clear();
        
        if (moves.length === 0) {
            return;
        }
        
        const count = Math.min(moves.length, this.MAX_MOVE_INDICATORS);
        this._moveIndicatorMesh.count = count;
        this._instanceData = new Array(count);
        
        // Get current piece position from game state to ensure we have the updated position
        let pieceX = 0, pieceZ = 0;
        if (this.selectedPiece) {
            if (window.game && window.game.gameState) {
                const currentPiece = window.game.gameState.getPiece(this.selectedPiece.id);
                if (currentPiece) {
                    pieceX = currentPiece.x;
                    pieceZ = currentPiece.z;
                } else {
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
        
        const now = Date.now();
        
        // Populate InstancedMesh
        for (let i = 0; i < count; i++) {
            const move = sortedMoves[i];
            const originalIndex = moves.indexOf(move);
            const terrainHeight = this.getTerrainHeight(move.x, move.z);
            
            // Set per-instance color
            const color = move.isCapture ? new THREE.Color(0xff0000) : new THREE.Color(0x0088ff);
            this._moveIndicatorMesh.setColorAt(i, color);
            
            // Store animation data
            this._instanceData[i] = {
                originalIndex,
                x: move.x,
                z: move.z,
                terrainHeight,
                startTime: now,
                delay: i * 100,
                popupComplete: false,
                pulseStartTime: 0,
                phase: originalIndex * 0.2,
                initialRotation: Math.random() * Math.PI * 2
            };
            
            // Start hidden
            this._dummy.position.set(move.x + 0.5, terrainHeight + 0.3, move.z + 0.5);
            this._dummy.rotation.set(Math.PI / 2, 0, this._instanceData[i].initialRotation);
            this._dummy.scale.setScalar(0);
            this._dummy.updateMatrix();
            this._moveIndicatorMesh.setMatrixAt(i, this._dummy.matrix);
        }
        
        this._moveIndicatorMesh.instanceMatrix.needsUpdate = true;
        this._moveIndicatorMesh.instanceColor.needsUpdate = true;
        
        // Set individual readiness timeouts
        for (let i = 0; i < count; i++) {
            const originalIndex = this._instanceData[i].originalIndex;
            const key = `move_${originalIndex}`;
            const readyTime = i * 100 + 300;
            
            setTimeout(() => {
                this.readyMarkers.add(key);
                console.log(`[VisualFeedback] Marker ${key} is now ready for interaction`);
            }, readyTime);
        }
    }
    
    showTileHover(x, z) {
        this.hideTileHover();
        this.hoveredTile = { x, z };
        
        const indicator = this.createHoverIndicator(x, z);
        this.highlightMeshes.set('hover', indicator);
        
        // Add to scene on top to avoid clipping issues
        indicator.renderOrder = 1000;
        this.scene.add(indicator);
        
        // Force mesh to render on top
        this.scene.traverse((child) => {
            if (child.isMesh) {
                child.renderOrder = child.renderOrder || 0;
            }
        });
    }
    
    createHoverIndicator(x, z) {
        // Create custom geometry that matches board tile exactly
        const geometry = this.createTileGeometry(x, z);
        const material = this.hoverMaterial;
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'hoverIndicator';
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
        line.name = 'coveringLine';
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
        path.name = 'movePath';
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
        if (this._moveIndicatorMesh.count === 0) {
            this.validMoves = [];
            return;
        }
        
        console.log('[VisualFeedback] Clearing valid moves, count:', this._moveIndicatorMesh.count);
        
        this._moveIndicatorState = 'dying';
        this._moveIndicatorDyingStart = Date.now();
        this.validMoves = [];
        
        // Primary cleanup after animation
        setTimeout(() => {
            if (this._moveIndicatorState === 'dying') {
                console.log('[VisualFeedback] Primary cleanup timeout triggered');
                this._moveIndicatorMesh.count = 0;
                this._instanceData = [];
                this._moveIndicatorState = 'idle';
            }
        }, 300);
        
        // Failsafe cleanup
        setTimeout(() => {
            if (this._moveIndicatorState === 'dying') {
                console.log('[VisualFeedback] Failsafe cleanup timeout triggered');
                this._moveIndicatorMesh.count = 0;
                this._instanceData = [];
                this._moveIndicatorState = 'idle';
            }
        }, 500);
    }

    hasVisibleMoveMarkers() {
        return this._moveIndicatorMesh && this._moveIndicatorMesh.count > 0;
    }

    clearValidMovesImmediate() {
        console.log('[VisualFeedback] Clearing valid moves immediately, count:', this._moveIndicatorMesh.count);
        
        this._moveIndicatorMesh.count = 0;
        this._instanceData = [];
        this._moveIndicatorState = 'idle';
        this.validMoves = [];
        this.readyMarkers.clear();
    }

    cleanupInvalidMoveMarkers() {
        // With InstancedMesh there are no stale individual move meshes in highlightMeshes.
        // If validMoves is empty but indicators are still showing, clear them.
        if (this.validMoves.length === 0 && this._moveIndicatorMesh.count > 0) {
            this.clearValidMovesImmediate();
        }
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
        
        // Clear instanced move indicators
        if (this._moveIndicatorMesh) {
            this._moveIndicatorMesh.count = 0;
            this._instanceData = [];
            this._moveIndicatorState = 'idle';
        }
        
        this.selectedPiece = null;
        this.validMoves = [];
        this.hoveredTile = null;
    }
    
    createSelectionIndicator(x, z) {
        const geometry = new THREE.RingGeometry(0.3, 0.4, 8);
        const material = this.highlightMaterial.clone();
        material.emissiveIntensity = 0.5;
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'selectionIndicator';
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
        mesh.name = move.isCapture ? 'captureIndicator' : 'moveIndicator';
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
        mesh.name = 'coveringIndicator';
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
        mesh.name = 'captureEffect';
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
        mesh.name = 'spawnEffect';
        mesh.position.set(x + 0.5, 0.1, z + 0.5);
        mesh.rotation.x = -Math.PI / 2;

        // Animate ring expansion
        mesh.userData = {
            type: 'spawn',
            startTime: Date.now(),
            duration: 1000
        };

        return mesh;
    }
    
    easeOutElastic(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    
    updatePulseEffects() {
        // Update move indicator instances
        if (this._moveIndicatorMesh && this._moveIndicatorMesh.count > 0) {
            this._updateMoveIndicatorInstances();
        }
        
        // Rotate non-move indicators (e.g., covered indicator)
        for (const [key, mesh] of this.highlightMeshes) {
            if (mesh.userData.type === 'rotate') {
                mesh.rotation.y += mesh.userData.rotationSpeed;
            }
        }
    }
    
    _updateMoveIndicatorInstances() {
        const now = Date.now();
        const count = this._moveIndicatorMesh.count;
        const state = this._moveIndicatorState;
        let needsUpdate = false;
        
        if (state === 'dying') {
            const elapsed = now - this._moveIndicatorDyingStart;
            const progress = Math.min(elapsed / 200, 1);
            const easedProgress = 1 - this.easeOutElastic(1 - progress);
            const scale = easedProgress;
            
            for (let i = 0; i < count; i++) {
                const data = this._instanceData[i];
                if (!data) continue;
                this._dummy.position.set(data.x + 0.5, data.terrainHeight + 0.3, data.z + 0.5);
                this._dummy.rotation.set(Math.PI / 2, 0, data.initialRotation + (now * 0.001 * 0.5));
                this._dummy.scale.setScalar(scale);
                this._dummy.updateMatrix();
                this._moveIndicatorMesh.setMatrixAt(i, this._dummy.matrix);
            }
            this._moveIndicatorMesh.instanceMatrix.needsUpdate = true;
            
            if (progress >= 1) {
                this._moveIndicatorMesh.count = 0;
                this._instanceData = [];
                this._moveIndicatorState = 'idle';
            }
            return;
        }
        
        for (let i = 0; i < count; i++) {
            const data = this._instanceData[i];
            if (!data) continue;
            
            const elapsed = now - data.startTime;
            let scale = 0;
            let spinRotation = data.initialRotation;
            
            if (elapsed < data.delay) {
                scale = 0;
            } else if (!data.popupComplete) {
                const popupElapsed = elapsed - data.delay;
                const progress = Math.min(popupElapsed / 300, 1);
                scale = this.easeOutElastic(progress);
                if (progress >= 1) {
                    data.popupComplete = true;
                    data.pulseStartTime = now;
                }
            } else {
                const pulseElapsed = now - data.pulseStartTime;
                const pulse = Math.sin(pulseElapsed * 0.003 + data.phase) * 0.5 + 0.5;
                scale = 1 + pulse * 0.2;
                spinRotation = data.initialRotation + (pulseElapsed * 0.001 * 0.5);
            }
            
            this._dummy.position.set(data.x + 0.5, data.terrainHeight + 0.3, data.z + 0.5);
            this._dummy.rotation.set(Math.PI / 2, 0, spinRotation);
            this._dummy.scale.setScalar(scale);
            this._dummy.updateMatrix();
            this._moveIndicatorMesh.setMatrixAt(i, this._dummy.matrix);
            needsUpdate = true;
        }
        
        if (needsUpdate) {
            this._moveIndicatorMesh.instanceMatrix.needsUpdate = true;
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

        // Reuse single dot instead of allocating per frame
        const dotGeometry = new THREE.SphereGeometry(0.1);
        const dotMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            emissive: 0x00ff00
        });
        const dot = new THREE.Mesh(dotGeometry, dotMaterial);
        dot.name = 'movePathDot';
        this.scene.add(dot);

        const points = path.geometry.attributes.position.array;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = (elapsed % duration) / duration;
            const t = progress;

            dot.position.set(
                points[0] + (points[3] - points[0]) * t,
                points[1] + (points[4] - points[1]) * t + Math.sin(progress * Math.PI) * 0.5,
                points[2] + (points[5] - points[2]) * t
            );

            if (elapsed < duration * 2) {
                requestAnimationFrame(animate);
            } else {
                this.scene.remove(dot);
                dot.geometry.dispose();
                dot.material.dispose();
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
        mesh.name = 'cooldownIndicator';
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
        arc.name = 'cooldownArc';
        arc.position.copy(mesh.position);
        arc.rotation.copy(mesh.rotation);
        
        const group = new THREE.Group();
        group.name = 'cooldownGroup';
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
    
    showWaterSplash(x, z, waterLevel = -1.5) {
        // Skip if particles disabled
        if (this.maxParticles <= 0) return;
        
        // Simple splash: create a burst of small white particles
        const particleCount = Math.min(12, this.maxParticles);
        const particles = new THREE.Group();
        particles.name = 'splashParticles';
        
        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.05, 4, 4);
            const material = new THREE.MeshBasicMaterial({
                color: 0xccddff,
                transparent: true,
                opacity: 0.8
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = 'splashParticle';
            
            // Random position around splash center
            const angle = (Math.PI * 2 * i) / particleCount;
            const radius = 0.1 + Math.random() * 0.2;
            mesh.position.set(
                x + Math.cos(angle) * radius,
                waterLevel + 0.1,
                z + Math.sin(angle) * radius
            );
            
            // Store velocity for animation
            mesh.userData.velocity = new THREE.Vector3(
                Math.cos(angle) * (0.02 + Math.random() * 0.03),
                0.05 + Math.random() * 0.08,
                Math.sin(angle) * (0.02 + Math.random() * 0.03)
            );
            mesh.userData.life = 1.0;
            
            particles.add(mesh);
        }
        
        particles.position.set(0, 0, 0);
        this.scene.add(particles);
        
        // Animate and remove
        const startTime = Date.now();
        const duration = 800;
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress >= 1) {
                this.scene.remove(particles);
                particles.children.forEach(child => {
                    child.geometry.dispose();
                    child.material.dispose();
                });
                return;
            }
            
            particles.children.forEach(mesh => {
                mesh.position.add(mesh.userData.velocity);
                mesh.userData.velocity.y -= 0.003; // gravity
                mesh.material.opacity = 0.8 * (1 - progress);
                mesh.scale.setScalar(1 - progress * 0.5);
            });
            
            requestAnimationFrame(animate);
        };
        
        animate();
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
        
        // Dispose instanced move indicator mesh
        if (this._moveIndicatorMesh) {
            this.scene.remove(this._moveIndicatorMesh);
            this._moveIndicatorMesh.geometry.dispose();
            this._moveIndicatorMesh.material.dispose();
        }
        
        // Dispose materials
        this.highlightMaterial.dispose();
        this.validMoveMaterial.dispose();
        this.captureMoveMaterial.dispose();
        this.hoverMaterial.dispose();
        this.coveringMaterial.dispose();
    }
}
