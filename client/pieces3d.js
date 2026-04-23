class Pieces3D {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.pieces = new Map();
        this.pieceMeshes = new Map();
        this.animatingPieces = new Map();
        
        // Piece materials
        this.materials = {
            white: this.createPieceMaterial(0xffffff, 0xcccccc),
            black: this.createPieceMaterial(0x333333, 0x111111),
            red: this.createPieceMaterial(0xff4444, 0xcc0000),
            blue: this.createPieceMaterial(0x4444ff, 0x0000cc),
            green: this.createPieceMaterial(0x44ff44, 0x00cc00),
            yellow: this.createPieceMaterial(0xffff44, 0xcccc00)
        };
        
        // Piece geometries (will be created on demand)
        this.geometries = {};
        
        // Animation settings
        this.moveAnimations = new Map();
    }
    
    isTerrainBlocked(x, z) {
        if (!this.terrainSystem) {
            console.warn(`[Pieces3D] No terrain system available to check blocked status at (${x}, ${z})`);
            return false; // Default to not blocked if no terrain system
        }
        
        // Get terrain data for this tile
        const chunkX = Math.floor(x / 16);
        const chunkZ = Math.floor(z / 16);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const chunk = this.terrainSystem.chunks.get(chunkKey);
        if (!chunk || !chunk.data) {
            console.warn(`[Pieces3D] No terrain data found for chunk (${chunkX}, ${chunkZ}) at (${x}, ${z})`);
            return false; // Default to not blocked if no chunk data
        }
        
        // Find the specific tile in the chunk
        const localX = x - (chunkX * 16);
        const localZ = z - (chunkZ * 16);
        const tileIndex = localZ * 16 + localX;
        
        const tile = chunk.data[tileIndex];
        if (!tile) {
            console.warn(`[Pieces3D] No tile data found at (${x}, ${z})`);
            return false; // Default to not blocked if no tile data
        }
        
        console.log(`[Pieces3D] Checking terrain at (${x}, ${z}): isBlocked=${tile.isBlocked}`);
        return tile.isBlocked || false;
    }
    
    createPieceMaterial(baseColor, darkColor) {
        return new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.4,
            metalness: 0.1,
            emissive: darkColor,
            emissiveIntensity: 0.1
        });
    }

    createPieceMaterialEnhanced(baseColor, darkColor) {
        return new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.2, // Very smooth for mirror-like surface
            metalness: 0.4, // Higher metalness for strong reflections
            emissive: darkColor,
            emissiveIntensity: 0.2, // Stronger glow
            specular: 0x666666, // Brighter specular for intense shine
            shininess: 150, // Very high shininess for polished surface
            envMapIntensity: 2.0 // Boost environmental reflections
        });
    }

    createPieceMaterialUltraReflective(baseColor, darkColor) {
        return new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.05, // Extremely smooth for maximum reflection
            metalness: 0.8, // Very high metalness for mirror-like surface
            emissive: darkColor,
            emissiveIntensity: 0.3, // Strong glow
            specular: 0xffffff, // White specular for maximum reflection
            shininess: 200, // Maximum shininess
            envMapIntensity: 3.0 // Maximum environmental reflections
        });
    }
    
    addPiece(pieceData) {
        // Check if spawn location is valid (not surrounded by blocked squares)
        if (!this.isValidSpawnLocation(pieceData.x, pieceData.z)) {
            console.warn(`[Pieces3D] Cannot spawn piece at (${pieceData.x}, ${pieceData.z}) - surrounded by blocked terrain`);
            return null;
        }
        
        const piece = this.createPieceModel(pieceData);
        
        this.pieces.set(pieceData.id, pieceData);
        this.pieceMeshes.set(pieceData.id, piece);
        this.scene.add(piece);
        
        // Play spawn sound
        if (window.soundManager) {
            window.soundManager.playFootstep(); // Use footstep as spawn sound
        }
        
        return piece;
    }
    
    isValidSpawnLocation(x, z) {
        // Check all 8 surrounding squares
        const surroundingOffsets = [
            [-1, -1], [-1, 0], [-1, 1],  // Top row
            [0, -1],           [0, 1],    // Left and right
            [1, -1],  [1, 0],  [1, 1]    // Bottom row
        ];
        
        let blockedCount = 0;
        const totalSurrounding = 8;
        
        for (const [dx, dz] of surroundingOffsets) {
            const checkX = x + dx;
            const checkZ = z + dz;
            
            // Check if this surrounding square is blocked
            if (this.isTerrainBlocked(checkX, checkZ)) {
                blockedCount++;
            }
        }
        
        // If all surrounding squares are blocked, this is not a valid spawn location
        const isValid = blockedCount < totalSurrounding;
        
        console.log(`[Pieces3D] Spawn validation for (${x}, ${z}): ${blockedCount}/${totalSurrounding} surrounding squares blocked, valid: ${isValid}`);
        
        return isValid;
    }
    
    
    createPieceModel(pieceData) {
        const group = new THREE.Group();
        const material = this.materials[pieceData.color] || this.materials.white;
        
        // Store piece type in userData for voice system
        group.userData.pieceType = pieceData.type.toLowerCase();
        
                
        switch (pieceData.type.toLowerCase()) {
            case 'pawn':
                this.createPawn(group, material);
                break;
            case 'rook':
                this.createRook(group, material);
                break;
            case 'knight':
                this.createKnight(group, material);
                break;
            case 'bishop':
                this.createBishop(group, material);
                break;
            case 'queen':
                this.createQueen(group, material);
                break;
            case 'king':
                this.createKing(group, material);
                break;
            default:
                this.createPawn(group, material); // Default to pawn
        }
        
        // Set initial position immediately (no animation for initial placement)
        const height = this.getMedianTerrainHeight(pieceData.x, pieceData.z);
        const normal = this.getTerrainNormal(pieceData.x, pieceData.z);
        
        // Position just above terrain surface (similar to selection indicators)
        const pieceHeight = height + 0.02; // Very small offset, pieces almost touch board surface
        group.position.set(pieceData.x + 0.5, pieceHeight, pieceData.z + 0.5);
        
        // Rotate piece to halfway between terrain normal and vertical AND store terrain info BEFORE piece creation
        if (normal && normal.y < 0.999) { // Apply even on very slight slopes
            const upVector = new THREE.Vector3(0, 1, 0);
            const terrainNormal = normal.clone();
            
            // Store terrain info for rotation
            group.userData.terrainNormal = terrainNormal;
            group.userData.terrainHeight = height;
            group.userData.useBendModifier = false; // Disable bend modifier
        } else {
            // Use actual terrain system - if it returns flat, that's the real terrain
            group.userData.terrainNormal = null;
            group.userData.terrainHeight = height;
            group.userData.useBendModifier = false; // Disable bend modifier
        }
        
        // Store reference to piece data BEFORE piece creation
        group.userData.pieceId = pieceData.id;
        group.userData.pieceType = pieceData.type;
        
        // Create the piece geometry AFTER terrain info is stored
        switch (pieceData.type) {
            case 'pawn':
                this.createPawn(group, material);
                break;
            case 'rook':
                this.createRook(group, material);
                break;
            case 'knight':
                this.createKnight(group, material);
                break;
            case 'bishop':
                this.createBishop(group, material);
                break;
            case 'queen':
                this.createQueen(group, material);
                break;
            case 'king':
                this.createKing(group, material);
                break;
            default:
                this.createPawn(group, material); // Default to pawn
        }
        
        console.log(`[Pieces3D] DEBUG: Piece creation complete - userData still available: hasNormal=${!!group.userData.terrainNormal}, hasHeight=${group.userData.terrainHeight !== undefined}`);
        
        // Apply initial terrain rotation
        console.log(`[Pieces3D] DEBUG: Checking terrain normal - exists: ${!!group.userData.terrainNormal}`);
        if (group.userData.terrainNormal) {
            console.log(`[Pieces3D] DEBUG: Applying initial terrain rotation`);
            console.log(`[Pieces3D] DEBUG: Terrain normal:`, group.userData.terrainNormal);
            console.log(`[Pieces3D] DEBUG: Before rotation - quaternion: x=${group.quaternion.x.toFixed(4)}, y=${group.quaternion.y.toFixed(4)}, z=${group.quaternion.z.toFixed(4)}, w=${group.quaternion.w.toFixed(4)}`);
            this.applyTerrainRotation(group, group.userData.terrainNormal);
            console.log(`[Pieces3D] DEBUG: After rotation - quaternion: x=${group.quaternion.x.toFixed(4)}, y=${group.quaternion.y.toFixed(4)}, z=${group.quaternion.z.toFixed(4)}, w=${group.quaternion.w.toFixed(4)}`);
        } else {
            console.log(`[Pieces3D] DEBUG: No terrain normal available - piece will spawn vertical`);
        }
        
        // Check final rotation right before returning
        console.log(`[Pieces3D] DEBUG: Final quaternion before return: x=${group.quaternion.x.toFixed(4)}, y=${group.quaternion.y.toFixed(4)}, z=${group.quaternion.z.toFixed(4)}, w=${group.quaternion.w.toFixed(4)}`);
        
        return group;
    }
    
    applyTerrainRotation(group, terrainNormal) {
        console.log(`[Pieces3D] DEBUG: Applying terrain rotation - normal:`, terrainNormal);
        
        // Calculate subtle tilt based on terrain normal (reduced from full alignment)
        const upVector = new THREE.Vector3(0, 1, 0);
        const fullRotation = new THREE.Quaternion().setFromUnitVectors(upVector, terrainNormal);
        
        // Extract the Euler angles from the full rotation
        const euler = new THREE.Euler().setFromQuaternion(fullRotation);
        
        // Reduce the rotation intensity to 30% for subtle effect
        euler.x *= 0.3;
        euler.y *= 0.3;  // Keep Y rotation minimal for pieces
        euler.z *= 0.3;
        
        // Apply the reduced rotation
        const subtleRotation = new THREE.Quaternion().setFromEuler(euler);
        group.quaternion.copy(subtleRotation);
        
        console.log(`[Pieces3D] DEBUG: Subtle terrain rotation applied - quaternion: x=${group.quaternion.x.toFixed(4)}, y=${group.quaternion.y.toFixed(4)}, z=${group.quaternion.z.toFixed(4)}, w=${group.quaternion.w.toFixed(4)}`);
    }

    deformMeshToTerrain(mesh, terrainNormal, terrainHeight) {
        console.log(`[Pieces3D] DEBUG: Deforming mesh - terrainNormal.y=${terrainNormal.y.toFixed(4)}, terrainHeight=${terrainHeight.toFixed(3)}`);
        
        // Store original geometry for reversion during movement
        if (!mesh.userData.originalGeometry) {
            mesh.userData.originalGeometry = mesh.geometry.clone();
        }
        
        const geometry = mesh.geometry;
        const positionAttribute = geometry.attributes.position;
        const vertices = positionAttribute.array;
        const originalVertices = mesh.userData.originalGeometry.attributes.position.array;
        
        // Get the mesh's world position
        const meshWorldPos = new THREE.Vector3();
        mesh.getWorldPosition(meshWorldPos);
        
        // Deform bottom vertices to conform to terrain contours
        for (let i = 0; i < vertices.length; i += 3) {
            const vertex = new THREE.Vector3(
                vertices[i],
                vertices[i + 1], 
                vertices[i + 2]
            );
            
            // Get original vertex position
            const originalVertex = new THREE.Vector3(
                originalVertices[i],
                originalVertices[i + 1], 
                originalVertices[i + 2]
            );
            
            // Only deform bottom vertices (those close to the base)
            const localHeight = originalVertex.y;
            if (localHeight < 0.1) { // Bottom 10% of the piece
                // Calculate deformation based on terrain normal
                // Make the base follow the terrain slope
                const deformationStrength = 0.05; // How much to deform
                const slopeX = terrainNormal.x * deformationStrength;
                const slopeZ = terrainNormal.z * deformationStrength;
                
                // Apply deformation to make base conform to terrain
                vertex.x = originalVertex.x + slopeX;
                vertex.y = originalVertex.y; // Keep base height
                vertex.z = originalVertex.z + slopeZ;
            } else {
                // Keep upper vertices unchanged
                vertex.copy(originalVertex);
            }
        }
        
        // Mark geometry as needing update
        positionAttribute.needsUpdate = true;
        geometry.computeVertexNormals();
        
        console.log(`[Pieces3D] DEBUG: Base deformation applied - terrain slope: X=${terrainNormal.x.toFixed(3)}, Z=${terrainNormal.z.toFixed(3)}`);
    }
    
    revertMeshDeformation(mesh) {
        // Restore mesh to its original geometry during movement
        if (mesh.userData.originalGeometry) {
            const geometry = mesh.geometry;
            const positionAttribute = geometry.attributes.position;
            const originalVertices = mesh.userData.originalGeometry.attributes.position.array;
            
            // Copy original vertices back
            for (let i = 0; i < positionAttribute.array.length; i++) {
                positionAttribute.array[i] = originalVertices[i];
            }
            
            // Mark geometry as needing update
            positionAttribute.needsUpdate = true;
            geometry.computeVertexNormals();
            
            console.log(`[Pieces3D] DEBUG: Mesh deformation reverted for movement`);
        }
    }
    
    
    
    createPawn(group, material) {
        // Load GLB model for pawn
        this.loadPieceModel(group, 'pawn', material);
    }
    
    createRook(group, material) {
        // Load GLB model for rook
        this.loadPieceModel(group, 'rook', material);
    }
    
    createKnight(group, material) {
        // Load GLB model for knight
        this.loadPieceModel(group, 'knight', material);
    }
    
    createBishop(group, material) {
        // Load GLB model for bishop
        this.loadPieceModel(group, 'bishop', material);
    }
    
    createQueen(group, material) {
        // Load GLB model for queen
        this.loadPieceModel(group, 'queen', material);
    }
    
    createKing(group, material) {
        console.log(`[Pieces3D] *** CREATE KING CALLED ***`);
        console.log(`[Pieces3D] Group:`, group);
        console.log(`[Pieces3D] Material:`, material);
        
        // Load GLB model for king
        this.loadKingModel(group, material);
    }
    
    async loadPieceModel(group, pieceType, material) {
        try {
            console.log(`[Pieces3D] === ${pieceType.toUpperCase()} MODEL LOADING START ===`);
            console.log(`[Pieces3D] Loading ${pieceType} model from: /Models/${pieceType}.glb`);
            
            // Check if GLTFLoader is available
            if (typeof THREE.GLTFLoader === 'undefined') {
                console.warn(`[Pieces3D] GLTFLoader not available, falling back to geometric ${pieceType}`);
                this.createGeometricPiece(pieceType, group, material);
                return;
            }
            
            console.log(`[Pieces3D] GLTFLoader is available, proceeding to load ${pieceType}.glb`);
            
            console.log(`[Pieces3D] Using custom GLTFLoader to load ${pieceType}.glb`);
            const loader = new THREE.GLTFLoader();
            const gltf = await loader.loadAsync(`/Models/${pieceType}.glb`);
            
            console.log(`[Pieces3D] GLTF loaded successfully for ${pieceType}:`, gltf);
            console.log(`[Pieces3D] GLTF scene:`, gltf.scene);
            console.log(`[Pieces3D] GLTF scene children:`, gltf.scene.children.length);
            
            // Get the loaded model
            const model = gltf.scene;
            
            console.log('=== MODEL DEBUG ===');
            console.log('Model before scaling:', model);
            console.log('Model children count:', model.children.length);
            console.log('Model position:', model.position);
            console.log('Model scale:', model.scale);
            console.log('Model visible:', model.visible);
            
            // Debug model bounds before scaling
            const box = new THREE.Box3().setFromObject(model);
            console.log('Model bounding box before scaling:', box);
            console.log('Model size before scaling:', box.getSize(new THREE.Vector3()));
            
            // Center model on its local origin by calculating bounding box
            const center = box.getCenter(new THREE.Vector3());
            
            // Move model so its center is at local origin
            model.position.sub(center);
            
            // Update bounding box after repositioning
            const newBox = new THREE.Box3().setFromObject(model);
            console.log(`[Pieces3D] ${pieceType} model recentered - new bounds:`, newBox);
            
            // Scale and position the model appropriately
            model.scale.set(0.5, 0.5, 0.5); // Consistent scale for all pieces
            
            // Fix orientation - rotate -90 degrees from current face-up position for all pieces
            model.rotation.x = -Math.PI / 2;
            
            // Position model so 0,0 origin touches the square for all pieces
            model.position.set(0, 0, 0); // Origin touches the square
            
            console.log('Model after scaling - scale:', model.scale);
            console.log('Model after scaling - position:', model.position);
            
            // Debug model bounds after scaling
            const boxAfter = new THREE.Box3().setFromObject(model);
            console.log('Model bounding box after scaling:', boxAfter);
            console.log('Model size after scaling:', boxAfter.getSize(new THREE.Vector3()));
            
            // Preserve original materials and textures from GLB model
            model.traverse((child) => {
                if (child.isMesh) {
                    console.log('Found mesh child:', child.name || 'unnamed');
                    console.log('Child mesh material:', child.material);
                    // Keep original material with textures, just enable shadows
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            
            // Add model to group
            group.add(model);
            console.log(`[Pieces3D] ${pieceType} GLB model loaded with original textures`);
            
        } catch (error) {
            console.error(`[Pieces3D] Failed to load ${pieceType} GLB model:`, error);
            console.log(`[Pieces3D] Falling back to geometric ${pieceType}`);
            this.createGeometricPiece(pieceType, group, material);
        }
    }

    createGeometricPiece(pieceType, group, material) {
        // Fallback to original geometric pieces
        switch (pieceType) {
            case 'pawn':
                this.createPawn(group, material);
                break;
            case 'rook':
                this.createRook(group, material);
                break;
            case 'knight':
                this.createKnight(group, material);
                break;
            case 'bishop':
                this.createBishop(group, material);
                break;
            case 'queen':
                this.createQueen(group, material);
                break;
            case 'king':
                this.createGeometricKing(group, material);
                break;
            default:
                this.createPawn(group, material);
        }
    }

    async loadKingModel(group, material) {
        await this.loadPieceModel(group, 'king', material);
    }
    
    createGeometricKing(group, material) {
        // Fallback to original geometric king
        // Base - increased height segments for smooth bend
        const baseGeometry = new THREE.CylinderGeometry(0.4, 0.45, 0.2, 8, 6);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.1;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        // Body - increased height segments for smooth bend
        const bodyGeometry = new THREE.CylinderGeometry(0.35, 0.4, 0.6, 8, 16);
        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.y = 0.5;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
        // Crown base
        const crownBaseGeometry = new THREE.CylinderGeometry(0.4, 0.35, 0.2, 8);
        const crownBase = new THREE.Mesh(crownBaseGeometry, material);
        crownBase.position.y = 0.8;
        crownBase.castShadow = true;
        crownBase.receiveShadow = true;
        group.add(crownBase);
        
        // Crown
        const crownGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.5);
        const crown = new THREE.Mesh(crownGeometry, material);
        crown.position.y = 1.05;
        crown.castShadow = true;
        crown.receiveShadow = true;
        group.add(crown);
        
        // Cross on top
        const crossVerticalGeometry = new THREE.BoxGeometry(0.05, 0.3, 0.05);
        const crossVertical = new THREE.Mesh(crossVerticalGeometry, material);
        crossVertical.position.y = 1.3;
        crossVertical.castShadow = true;
        crossVertical.receiveShadow = true;
        group.add(crossVertical);
        
        const crossHorizontalGeometry = new THREE.BoxGeometry(0.2, 0.05, 0.05);
        const crossHorizontal = new THREE.Mesh(crossHorizontalGeometry, material);
        crossHorizontal.position.y = 1.25;
        crossHorizontal.castShadow = true;
        crossHorizontal.receiveShadow = true;
        group.add(crossHorizontal);
    }

    updatePiecePosition(pieceMesh, x, z) {
        // Get terrain height and normal for the square
        const height = this.getMedianTerrainHeight(x, z);
        const normal = this.getTerrainNormal(x, z);
        const targetY = height + 0.02; // Position piece just above terrain surface
        const targetX = x + 0.5;
        const targetZ = z + 0.5;
        
        // Disney-style animated movement with terrain alignment
        const pieceType = pieceMesh.userData.pieceType || null;
        this.animatePieceToPosition(pieceMesh, targetX, targetY, targetZ, normal, null, pieceType);
    }
    
    animatePieceToPosition(pieceMesh, targetX, targetY, targetZ, targetNormal, onCompleteCallback, pieceType = null) {
        const startPos = pieceMesh.position.clone();
        const endPos = new THREE.Vector3(targetX, targetY, targetZ);
        
        // Revert deformation during movement (make base horizontal)
        pieceMesh.traverse((child) => {
            if (child.isMesh && child.userData.originalGeometry) {
                this.revertMeshDeformation(child);
            }
        });
        
        // Calculate distance and number of squares to cross
        const distance = Math.sqrt(Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.z - startPos.z, 2));
        const squaresToCross = Math.max(Math.floor(distance), 1); // At least 1 step
        
        // Calculate direction to destination for initial turn
        const direction = new THREE.Vector3(endPos.x - startPos.x, 0, endPos.z - startPos.z).normalize();
        let targetRotation = Math.atan2(direction.x, direction.z);
        
        // Normalize rotation to [0, 2*PI] to avoid edge cases
        if (targetRotation < 0) {
            targetRotation += 2 * Math.PI;
        }
        
        // Get current piece rotation and normalize to [0, 2*PI]
        const currentRotation = pieceMesh.rotation.y % (2 * Math.PI);
        const normalizedCurrentRotation = currentRotation < 0 ? currentRotation + 2 * Math.PI : currentRotation;
        
        // Calculate shortest rotation path
        let rotationDelta = targetRotation - normalizedCurrentRotation;
        
        // Choose shortest path (clockwise vs anticlockwise)
        if (Math.abs(rotationDelta) > Math.PI) {
            if (rotationDelta > 0) {
                rotationDelta -= 2 * Math.PI; // Go anticlockwise instead
            } else {
                rotationDelta += 2 * Math.PI; // Go clockwise instead
            }
        }
        
        // Check if piece already faces correct direction (within tolerance)
        const rotationTolerance = 0.1; // ~5.7 degrees
        const needsRotation = Math.abs(rotationDelta) > rotationTolerance;
        const skipStartHop = !needsRotation;
        
                
        // Animation phases - adjust duration if no rotation needed
        const turnDuration = skipStartHop ? 0 : 300; // Skip turn phase if already facing direction
        const hopDuration = 600 * squaresToCross; // Time for hopping movement
        const totalDuration = turnDuration + hopDuration;
        const startTime = Date.now();
        
        // Store initial rotation for normal interpolation
        const startNormal = new THREE.Vector3(0, 1, 0); // Assume starting upright
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);
            
            // Play footsteps during movement - simple time-based approach
            if (window.soundManager && progress > 0.1 && progress < 0.9) {
                // Calculate footstep intervals based on distance - 2 footsteps per square
                const footstepInterval = hopDuration / squaresToCross / 2; // 2 footsteps per square
                
                // Simple time-based footstep tracking - no persistent state needed
                const shouldPlayFootstep = Math.floor(elapsed / footstepInterval) !== Math.floor((elapsed - 16) / footstepInterval);
                
                if (shouldPlayFootstep) {
                    window.soundManager.playFootstep();
                }
            }
            
            // Phase 1: Initial turn to face destination (only if needed)
            // Phase 2: Disney-style hopping movement
            let currentX, currentZ, currentY, rotationProgress;
            let scaleX = 1, scaleY = 1, scaleZ = 1;
            let swayX = 0, swayZ = 0;
            
            if (progress < 0.25 && !skipStartHop) {
                // Phase 1: Turn to face destination - NO MOVEMENT during rotation
                const turnProgress = progress / 0.25; // Normalize to 0-1 for this phase
                const turnEased = this.disneyEaseInOut(turnProgress);
                
                // Stay at start position during rotation
                currentX = startPos.x;
                currentZ = startPos.z;
                
                // Small anticipatory hop during turn
                const turnHopHeight = 0.15 * Math.sin(turnProgress * Math.PI);
                const terrainHeightAtStart = this.getMedianTerrainHeight(startPos.x, startPos.z);
                currentY = terrainHeightAtStart + 0.15 + turnHopHeight;
                
                // Rotate using shortest path
                rotationProgress = normalizedCurrentRotation + (rotationDelta * turnEased);
                
                // Gentle scale pulse during turn anticipation
                const scalePulse = 1.0 + (Math.sin(turnProgress * Math.PI) * 0.05);
                scaleX = scaleY = scaleZ = scalePulse;
                
            } else {
                // Phase 2: Disney-style hopping movement
                // Adjust progress calculation if we skipped rotation phase
                let hopProgress;
                if (skipStartHop) {
                    // If no rotation needed, use full progress for hopping
                    hopProgress = progress; // 0-1 for entire animation
                } else {
                    // Normal case: rotation phase was 0-25%, so hopping starts at 25%
                    hopProgress = (progress - 0.25) / 0.75; // Normalize to 0-1 for hopping phase
                }
                const hopEased = this.disneyEaseInOut(hopProgress);
                
                // Calculate position along path
                currentX = THREE.MathUtils.lerp(startPos.x, endPos.x, hopEased);
                currentZ = THREE.MathUtils.lerp(startPos.z, endPos.z, hopEased);
                
                // Calculate terrain height at current position
                const terrainHeightAtCurrent = this.getMedianTerrainHeight(currentX, currentZ);
                const baseY = terrainHeightAtCurrent + 0.15;
                
                // Variable stride patterns - first few hops are different
                let stepHeight, swayAmount, squashAmount;
                const hopPhase = hopProgress * squaresToCross; // Which hop we're on
                
                if (hopPhase < 1) {
                    // First hop: shorter, quicker
                    stepHeight = 0.25;
                    swayAmount = 0.08;
                    squashAmount = 0.15;
                } else if (hopPhase < 2) {
                    // Second hop: medium height, different timing
                    stepHeight = 0.35;
                    swayAmount = 0.12;
                    squashAmount = 0.20;
                } else {
                    // Regular hops for remaining distance
                    stepHeight = 0.3;
                    swayAmount = 0.15;
                    squashAmount = 0.25;
                }
                
                // Higher final hop for the last square
                if (hopProgress > 0.85) {
                    stepHeight *= 1.8; // Almost double height for final hop
                    swayAmount *= 0.7; // Less sway on final hop
                }
                
                // Calculate hopping motion with Disney furniture-style sway
                const stepCycle = hopProgress * squaresToCross * Math.PI * 2;
                let hopY = Math.abs(Math.sin(stepCycle)) * stepHeight;
                
                // Ensure we land perfectly at the end
                if (hopProgress >= 0.98) {
                    hopY = 0;
                }
                
                currentY = baseY + hopY;
                
                // Side-to-side swaying like Disney furniture walking
                if (hopProgress < 0.95) {
                    swayX = Math.sin(stepCycle * 0.7) * swayAmount;
                    swayZ = Math.cos(stepCycle * 0.7) * swayAmount * 0.6; // Less Z sway for forward motion
                }
                
                // Squash and stretch during hops
                if (hopProgress < 0.95) {
                    const stepPhase = Math.sin(stepCycle);
                    scaleX = 1.0 + (stepPhase * squashAmount * 0.4);
                    scaleY = 1.0 - (Math.abs(stepPhase) * squashAmount * 0.3);
                    scaleZ = 1.0 + (Math.cos(stepCycle) * squashAmount * 0.4);
                }
                
                // Continue rotation during movement with wobble
                // Use the final target rotation (which accounts for shortest path)
                const finalTargetRotation = normalizedCurrentRotation + rotationDelta;
                rotationProgress = finalTargetRotation + (Math.sin(stepCycle * 3) * 0.1);
            }
            
            // Sample terrain normal at current position
            const currentNormal = this.getTerrainNormal(currentX, currentZ);
            
            // Calculate subtle terrain rotation (30% intensity)
            const upVector = new THREE.Vector3(0, 1, 0);
            const fullRotation = new THREE.Quaternion().setFromUnitVectors(upVector, currentNormal);
            const euler = new THREE.Euler().setFromQuaternion(fullRotation);
            
            euler.x *= 0.3;
            euler.y *= 0.3;
            euler.z *= 0.3;
            
            const terrainQuaternion = new THREE.Quaternion().setFromEuler(euler);
            
            // Apply transformations
            pieceMesh.position.set(currentX + swayX, currentY, currentZ + swayZ);
            pieceMesh.scale.set(scaleX, scaleY, scaleZ);
            
            // Combine terrain alignment with artistic rotation
            const artisticRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationProgress);
            pieceMesh.quaternion.multiplyQuaternions(terrainQuaternion, artisticRotation);
            
            // Add tilting during hops (but not during final landing)
            if (progress > 0.2 && progress < 0.95) {
                const hopPhase = (progress - 0.2) / 0.8;
                const stepCycle = hopPhase * squaresToCross * Math.PI * 2;
                const tiltX = Math.sin(stepCycle * 1.5) * 0.03;
                const tiltZ = Math.cos(stepCycle * 1.5) * 0.03;
                const tiltQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, 0, tiltZ));
                pieceMesh.quaternion.multiply(tiltQuaternion);
            }
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Ensure perfect final positioning
                pieceMesh.position.set(endPos.x, endPos.y, endPos.z);
                pieceMesh.scale.set(1, 1, 1);
                
                // Play movement sounds with piece type
                if (window.soundManager) {
                    window.soundManager.playMoveSound(pieceType);
                }
                
                // Special flourish for higher final hop
                this.disneyFlourish(pieceMesh, targetNormal, targetRotation);
                
                // Call completion callback if provided
                if (onCompleteCallback) {
                    onCompleteCallback();
                }
            }
        };
        
        animate();
    }
    
    disneyEaseInOut(t) {
        // Smooth Disney-style easing
        return t < 0.5 
            ? 2 * t * t 
            : -1 + (4 - 2 * t) * t;
    }
    
    getTerrainNormal(x, z) {
        // Sample terrain normal at the given position
        console.log(`[Pieces3D] DEBUG: getTerrainNormal called for position (${x}, ${z}) - terrainSystem exists: ${!!this.terrainSystem}, getNormal exists: ${!!(this.terrainSystem && this.terrainSystem.getNormal)}`);
        
        if (this.terrainSystem && this.terrainSystem.getNormal) {
            const normal = this.terrainSystem.getNormal(x, z);
            console.log(`[Pieces3D] DEBUG: terrainSystem.getNormal returned:`, normal);
            console.log(`[Pieces3D] DEBUG: Normal magnitude: ${normal.length().toFixed(4)}, Y component: ${normal.y.toFixed(4)}`);
            
            // Check if normal is actually different from vertical
            if (Math.abs(normal.y - 1.0) < 0.001) {
                console.log(`[Pieces3D] DEBUG: Normal is effectively vertical - no terrain rotation needed`);
            } else {
                console.log(`[Pieces3D] DEBUG: Normal shows terrain slope - rotation should be applied`);
            }
            
            return normal;
        }
        
        console.log(`[Pieces3D] DEBUG: Using fallback normal - terrainSystem.getNormal not available`);
        // Fallback to upright normal
        return new THREE.Vector3(0, 1, 0);
    }
    
    disneyFlourish(pieceMesh, terrainNormal = null, targetRotation = null) {
        // End with a charming little flourish
        const flourishDuration = 300;
        const startTime = Date.now();
        
        const flourish = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / flourishDuration, 1);
            
            // Final bounce without spin (to preserve travel direction)
            const bounce = Math.sin(progress * Math.PI) * 0.03; // Much smaller bounce to prevent shelf hopping
            // Removed finalSpin to preserve travel direction
            
            // Add bounce during flourish, then land back down
            if (progress < 0.5) {
                // First half: bounce up
                pieceMesh.position.y += bounce;
            } else if (progress < 0.9) {
                // Second half: land back down (negative bounce)
                pieceMesh.position.y -= bounce * 0.8; // Slightly less down to settle gently
            }
            // Final 10%: no height changes, just spin
            
            // Keep piece upright with correct travel direction during flourish (no terrain alignment)
            if (targetRotation !== null) {
                // Ensure piece stays upright with correct travel direction
                pieceMesh.rotation.x = 0;
                pieceMesh.rotation.z = 0;
                pieceMesh.rotation.y = targetRotation; // Use exact target rotation
            }
            // Scale back to normal with a little pop
            const popScale = 1.0 + (Math.sin(progress * Math.PI) * 0.08);
            pieceMesh.scale.setScalar(popScale);
            
            if (progress < 1) {
                requestAnimationFrame(flourish);
            } else {
                // Reset to perfect final position aligned with terrain
                pieceMesh.scale.setScalar(1);
                
                // Ensure we're exactly at the target height (no floating)
                // This should match the targetY from the animation
                // The flourish should have the targetY passed in, but for now use current position
                // pieceMesh.position.y should already be correct from the animation
                
                // Ensure perfect final rotation - use targetRotation exactly
                const finalAngleDeg = (targetRotation * 180 / Math.PI + 360) % 360;
                
                console.log(`[Pieces3D] === ANIMATION END DEBUG ===`);
                console.log(`[Pieces3D] Animation end - Setting final rotation to: ${targetRotation.toFixed(3)} (${finalAngleDeg.toFixed(1)}°)`);
                
                // Set exact final rotation - no interference
                pieceMesh.rotation.x = 0;
                pieceMesh.rotation.y = targetRotation; // Exact target rotation
                pieceMesh.rotation.z = 0;
                
                const finalSetAngleDeg = (pieceMesh.rotation.y * 180 / Math.PI + 360) % 360;
                console.log(`[Pieces3D] Animation end - Final rotation set: x=${pieceMesh.rotation.x.toFixed(3)}, y=${pieceMesh.rotation.y.toFixed(3)} (${finalSetAngleDeg.toFixed(1)}°), z=${pieceMesh.rotation.z.toFixed(3)}`);
                
                // Check if this is the problematic direction
                if (finalAngleDeg > 44 && finalAngleDeg < 46) {
                    console.log(`[Pieces3D] *** PROBLEM DIRECTION: 45-degree movement completed ***`);
                }
                if (finalAngleDeg > 134 && finalAngleDeg < 136) {
                    console.log(`[Pieces3D] *** PROBLEM DIRECTION: 135-degree movement completed ***`);
                }
                if (finalAngleDeg > 224 && finalAngleDeg < 226) {
                    console.log(`[Pieces3D] *** PROBLEM DIRECTION: 225-degree movement completed ***`);
                }
                if (finalAngleDeg > 314 && finalAngleDeg < 316) {
                    console.log(`[Pieces3D] *** PROBLEM DIRECTION: 315-degree movement completed ***`);
                }
            }
        };
        
        flourish();
    }
    
    movePiece(pieceId, newX, newZ) {
        const pieceMesh = this.pieceMeshes.get(pieceId);
        const pieceData = this.pieces.get(pieceId);
        
        if (pieceMesh && pieceData) {
            // Update piece data
            pieceData.x = newX;
            pieceData.z = newZ;
            
            // Animate movement
            this.updatePiecePosition(pieceMesh, newX, newZ);
        }
    }
    
    movePieceWithCallback(pieceId, newX, newZ, onCompleteCallback) {
        const pieceMesh = this.pieceMeshes.get(pieceId);
        const pieceData = this.pieces.get(pieceId);
        
        if (pieceMesh && pieceData) {
            // Update piece data
            pieceData.x = newX;
            pieceData.z = newZ;
            
            // Animate movement with callback
            this.updatePiecePositionWithCallback(pieceMesh, newX, newZ, onCompleteCallback);
        }
    }
    
    updatePiecePositionWithCallback(pieceMesh, x, z, onCompleteCallback) {
        // Get terrain height and normal for the square
        const height = this.getMedianTerrainHeight(x, z);
        const normal = this.getTerrainNormal(x, z);
        const targetY = height + 0.02; // Position piece just above terrain surface
        const targetX = x + 0.5;
        const targetZ = z + 0.5;
        
        // Disney-style animated movement with terrain alignment
        const pieceType = pieceMesh.userData.pieceType || null;
        this.animatePieceToPosition(pieceMesh, targetX, targetY, targetZ, normal, onCompleteCallback, pieceType);
    }
    
    removePiece(pieceId) {
        const pieceMesh = this.pieceMeshes.get(pieceId);
        
        if (pieceMesh) {
            // Animate removal
            this.animatePieceRemoval(pieceMesh);
            
            // Clean up
            setTimeout(() => {
                this.scene.remove(pieceMesh);
                this.pieceMeshes.delete(pieceId);
                this.pieces.delete(pieceId);
            }, 300);
        }
    }
    
    animatePieceRemoval(pieceMesh) {
        const duration = 300;
        const startTime = Date.now();
        const startScale = pieceMesh.scale.clone();
        const startY = pieceMesh.position.y;
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Shrink and fall
            const scale = startScale.clone().multiplyScalar(1 - progress);
            pieceMesh.scale.copy(scale);
            
            pieceMesh.position.y = startY - progress * 0.5;
            pieceMesh.rotation.y += progress * Math.PI;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    selectPiece(pieceId) {
        const pieceMesh = this.pieceMeshes.get(pieceId);
        if (pieceMesh) {
            // Add emissive glow
            this.addSelectionGlow(pieceMesh);
        }
    }
    
    deselectPiece(pieceId) {
        const pieceMesh = this.pieceMeshes.get(pieceId);
        if (pieceMesh) {
            // Visual feedback for selection
            if (window.visualFeedback) {
                window.visualFeedback.showSelectionEffect(pieceMesh);
            }
            
            // Play selection sound
            if (window.soundManager) {
                window.soundManager.playFootstep(); // Use footstep as selection sound
            }
        }
    }
    
    addSelectionGlow(pieceMesh) {
        pieceMesh.traverse((child) => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.emissive = new THREE.Color(0xffff00);
                child.material.emissiveIntensity = 0.3;
            }
        });
    }
    
    removeSelectionGlow(pieceMesh) {
        pieceMesh.traverse((child) => {
            if (child.isMesh && child.material.emissive) {
                child.material.emissiveIntensity = 0.1;
            }
        });
    }
    
    getPiece(pieceId) {
        return this.pieces.get(pieceId);
    }

    getPieceMesh(pieceId) {
        return this.pieceMeshes.get(pieceId);
    }

    getPieceByMesh(mesh) {
        // Traverse up to find the group with piece data
        let current = mesh;
        while (current && current.parent) {
            if (current.userData.pieceId) {
                return this.pieces.get(current.userData.pieceId);
            }
            current = current.parent;
        }
        return null;
    }
    
    getAllPieceMeshes() {
        const meshes = [];
        for (const pieceMesh of this.pieceMeshes.values()) {
            pieceMesh.traverse((child) => {
                if (child.isMesh) {
                    meshes.push(child);
                }
            });
        }
        return meshes;
    }
    
    getTerrainHeight(x, z) {
        // Use board system for consistent heights with board tiles
        if (window.game && window.game.boardSystem) {
            return window.game.boardSystem.getTerrainHeight(x, z);
        }
        
        // Fallback - should not happen if game is properly initialized
        console.warn('[Pieces3D] Board system not available, using fallback height calculation');
        return 0;
    }
    
        
    getMedianTerrainHeight(x, z) {
        // Sample multiple points across the entire square to get median height
        const samples = [];
        const sampleCount = 9; // 3x3 grid of samples
        
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const sampleX = x + (i * 0.5); // 0, 0.5, 1.0 - covers entire tile
                const sampleZ = z + (j * 0.5); // 0, 0.5, 1.0 - covers entire tile
                samples.push(this.getTerrainHeight(sampleX, sampleZ));
            }
        }
        
        // Sort and return median
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)];
    }
    
    getTerrainNormal(x, z) {
        // Calculate terrain normal using finite differences
        const delta = 0.1;
        
        // Sample heights at neighboring points
        const hCenter = this.getTerrainHeight(x, z);
        const hRight = this.getTerrainHeight(x + delta, z);
        const hLeft = this.getTerrainHeight(x - delta, z);
        const hUp = this.getTerrainHeight(x, z + delta);
        const hDown = this.getTerrainHeight(x, z - delta);
        
        // Calculate gradients
        const dx = (hRight - hLeft) / (2 * delta);
        const dz = (hUp - hDown) / (2 * delta);
        
        // Create normal vector (pointing upward from surface)
        const normal = new THREE.Vector3(-dx, 1, -dz);
        normal.normalize();
        
        return normal;
    }
    
    update() {
        // Update ongoing animations
        for (const [pieceId, animation] of this.moveAnimations) {
            if (this.updateAnimation(animation)) {
                this.moveAnimations.delete(pieceId);
            }
        }
    }
    
    updateAnimation(animation) {
        const elapsed = Date.now() - animation.startTime;
        const progress = Math.min(elapsed / animation.duration, 1);
        
        // Apply animation
        if (animation.type === 'move') {
            const easedProgress = this.easeInOutCubic(progress);
            animation.piece.position.lerpVectors(
                animation.startPos,
                animation.endPos,
                easedProgress
            );
        }
        
        return progress >= 1;
    }
    
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    
    clearAllPieces() {
        for (const pieceMesh of this.pieceMeshes.values()) {
            this.scene.remove(pieceMesh);
        }
        this.pieces.clear();
        this.pieceMeshes.clear();
        this.moveAnimations.clear();
    }
}
