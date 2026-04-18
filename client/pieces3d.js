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
        const piece = this.createPieceModel(pieceData);
        
        // Check rotation immediately after creation
        console.log(`[Pieces3D] DEBUG: After creation - quaternion: x=${piece.quaternion.x.toFixed(4)}, y=${piece.quaternion.y.toFixed(4)}, z=${piece.quaternion.z.toFixed(4)}, w=${piece.quaternion.w.toFixed(4)}`);
        
        this.pieces.set(pieceData.id, pieceData);
        this.pieceMeshes.set(pieceData.id, piece);
        this.scene.add(piece);
        
        // Check rotation after adding to scene
        console.log(`[Pieces3D] DEBUG: After scene addition - quaternion: x=${piece.quaternion.x.toFixed(4)}, y=${piece.quaternion.y.toFixed(4)}, z=${piece.quaternion.z.toFixed(4)}, w=${piece.quaternion.w.toFixed(4)}`);
        
        return piece;
    }
    
    
    createPieceModel(pieceData) {
        const group = new THREE.Group();
        const material = this.materials[pieceData.color] || this.materials.white;
        
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
        
        // Set initial position immediately (no animation for initial placement)
        const height = this.getMedianTerrainHeight(pieceData.x, pieceData.z);
        const normal = this.getTerrainNormal(pieceData.x, pieceData.z);
        
        // Position just above terrain surface (similar to selection indicators)
        const pieceHeight = height + 0.02; // Very small offset, pieces almost touch board surface
        group.position.set(pieceData.x + 0.5, pieceHeight, pieceData.z + 0.5);
        
        // Rotate piece to halfway between terrain normal and vertical AND store terrain info BEFORE piece creation
        console.log(`[Pieces3D] DEBUG: Creating piece ${pieceData.id} at (${pieceData.x}, ${pieceData.z})`);
        console.log(`[Pieces3D] DEBUG: Terrain normal:`, normal ? `y=${normal.y.toFixed(4)}` : 'null');
        
        if (normal && normal.y < 0.999) { // Apply even on very slight slopes
            console.log(`[Pieces3D] DEBUG: Using terrain rotation for alignment`);
            const upVector = new THREE.Vector3(0, 1, 0);
            const terrainNormal = normal.clone();
            
            // Store terrain info for rotation
            group.userData.terrainNormal = terrainNormal;
            group.userData.terrainHeight = height;
            group.userData.useBendModifier = false; // Disable bend modifier
            
            console.log(`[Pieces3D] DEBUG: Terrain rotation setup - terrain normal:`, terrainNormal);
            console.log(`[Pieces3D] DEBUG: Group position: x=${group.position.x.toFixed(2)}, y=${group.position.y.toFixed(2)}, z=${group.position.z.toFixed(2)}`);
        } else {
            // Use actual terrain system - if it returns flat, that's the real terrain
            console.log(`[Pieces3D] DEBUG: Using actual terrain (flat terrain detected)`);
            const testNormal = new THREE.Vector3(0, 1, 0); // Flat terrain normal
            
            // Store terrain info for rotation
            group.userData.terrainNormal = testNormal;
            group.userData.terrainHeight = height;
            group.userData.useBendModifier = false; // Disable bend modifier
            
            console.log(`[Pieces3D] DEBUG: Terrain rotation setup - flat terrain:`, testNormal);
            console.log(`[Pieces3D] DEBUG: Group position: x=${group.position.x.toFixed(2)}, y=${group.position.y.toFixed(2)}, z=${group.position.z.toFixed(2)}`);
        }
        
        // Store reference to piece data BEFORE piece creation
        group.userData.pieceId = pieceData.id;
        group.userData.pieceType = pieceData.type;
        
        console.log(`[Pieces3D] DEBUG: userData set BEFORE piece creation - hasNormal=${!!group.userData.terrainNormal}, hasHeight=${group.userData.terrainHeight !== undefined}`);
        if (group.userData.terrainNormal) {
            console.log(`[Pieces3D] DEBUG: Stored normal:`, group.userData.terrainNormal);
        }
        
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
        
        const upVector = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, terrainNormal);
        group.quaternion.copy(quaternion);
        
        console.log(`[Pieces3D] DEBUG: Terrain rotation applied - quaternion: x=${group.quaternion.x.toFixed(4)}, y=${group.quaternion.y.toFixed(4)}, z=${group.quaternion.z.toFixed(4)}, w=${group.quaternion.w.toFixed(4)}`);
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
    
    
    
    createPawn(group, material) {
        // Base
        const baseGeometry = new THREE.CylinderGeometry(0.3, 0.4, 0.2, 8);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.1;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        // Body
        const bodyGeometry = new THREE.CylinderGeometry(0.25, 0.3, 0.4, 8);
        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.y = 0.4;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
        // Head
        const headGeometry = new THREE.SphereGeometry(0.2, 8, 6);
        const head = new THREE.Mesh(headGeometry, material);
        head.position.y = 0.7;
        head.castShadow = true;
        head.receiveShadow = true;
        group.add(head);
    }
    
    createRook(group, material) {
        // Create unified rook mesh with high subdivision for smooth bending
        // Use a cylinder with tapered top for rook shape
        const unifiedGeometry = new THREE.CylinderGeometry(0.35, 0.25, 0.8, 16, 24); // Tapered cylinder
        const unifiedMesh = new THREE.Mesh(unifiedGeometry, material);
        
        // Position the unified mesh
        unifiedMesh.position.y = 0.5; // Center at ground level + radius
        unifiedMesh.castShadow = true;
        unifiedMesh.receiveShadow = true;
        
        // Add unified mesh to group
        group.add(unifiedMesh);
        
        console.log(`[Pieces3D] DEBUG: Created unified rook mesh with ${unifiedGeometry.attributes.position.count} vertices`);
    }
    
    createKnight(group, material) {
        // Create unified knight mesh with high subdivision for smooth bending
        // Use a tapered cylinder with slight bulge for knight body
        const unifiedGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.7, 16, 28); // Tapered with many segments
        const unifiedMesh = new THREE.Mesh(unifiedGeometry, material);
        
        // Position the unified mesh
        unifiedMesh.position.y = 0.5; // Center at ground level + radius
        unifiedMesh.castShadow = true;
        unifiedMesh.receiveShadow = true;
        
        // Add unified mesh to group
        group.add(unifiedMesh);
        
        console.log(`[Pieces3D] DEBUG: Created unified knight mesh with ${unifiedGeometry.attributes.position.count} vertices`);
    }
    
    createBishop(group, material) {
        // Create unified bishop mesh with high subdivision for smooth bending
        // Use a cone shape with many segments
        const unifiedGeometry = new THREE.ConeGeometry(0.3, 0.8, 16, 32); // Cone with many segments
        const unifiedMesh = new THREE.Mesh(unifiedGeometry, material);
        
        // Position the unified mesh
        unifiedMesh.position.y = 0.5; // Center at ground level + radius
        unifiedMesh.castShadow = true;
        unifiedMesh.receiveShadow = true;
        
        // Add unified mesh to group
        group.add(unifiedMesh);
        
        console.log(`[Pieces3D] DEBUG: Created unified bishop mesh with ${unifiedGeometry.attributes.position.count} vertices`);
    }
    
    createQueen(group, material) {
        // Base - increased height segments for smooth bend
        const baseGeometry = new THREE.CylinderGeometry(0.35, 0.4, 0.2, 8, 6);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.1;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        // Body - increased height segments for smooth bend
        const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.5, 8, 12);
        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.y = 0.45;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
        // Crown base
        const crownBaseGeometry = new THREE.CylinderGeometry(0.35, 0.3, 0.2, 8);
        const crownBase = new THREE.Mesh(crownBaseGeometry, material);
        crownBase.position.y = 0.75;
        crownBase.castShadow = true;
        crownBase.receiveShadow = true;
        group.add(crownBase);
        
        // Crown points
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const pointGeometry = new THREE.ConeGeometry(0.08, 0.3, 6);
            const point = new THREE.Mesh(pointGeometry, material);
            point.position.set(
                Math.cos(angle) * 0.25,
                1.0,
                Math.sin(angle) * 0.25
            );
            point.castShadow = true;
            point.receiveShadow = true;
            group.add(point);
        }
        
        // Central orb
        const orbGeometry = new THREE.SphereGeometry(0.15, 8, 6);
        const orb = new THREE.Mesh(orbGeometry, material);
        orb.position.y = 1.1;
        orb.castShadow = true;
        orb.receiveShadow = true;
        group.add(orb);
        
            }
    
    createKing(group, material) {
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
        this.animatePieceToPosition(pieceMesh, targetX, targetY, targetZ, normal);
    }
    
    animatePieceToPosition(pieceMesh, targetX, targetY, targetZ, targetNormal) {
        const startPos = pieceMesh.position.clone();
        const endPos = new THREE.Vector3(targetX, targetY, targetZ);
        
        // Revert deformation during movement (make base horizontal)
        console.log(`[Pieces3D] DEBUG: Starting movement - reverting deformation`);
        pieceMesh.traverse((child) => {
            if (child.isMesh && child.userData.originalGeometry) {
                this.revertMeshDeformation(child);
            }
        });
        
        // Calculate distance and number of squares to cross
        const distance = Math.sqrt(Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.z - startPos.z, 2));
        const squaresToCross = Math.max(Math.floor(distance), 1); // At least 1 step
        
        // Slower pace - more time per square for deliberate stepping
        const duration = 800 * squaresToCross; // 800ms per square
        const startTime = Date.now();
        
        // Store initial rotation for normal interpolation
        const startNormal = new THREE.Vector3(0, 1, 0); // Assume starting upright
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Smooth easing for natural movement
            const easedProgress = this.disneyEaseInOut(progress);
            
            // Calculate current position
            const currentX = THREE.MathUtils.lerp(startPos.x, endPos.x, easedProgress);
            const currentZ = THREE.MathUtils.lerp(startPos.z, endPos.z, easedProgress);
            
            // Step-per-square motion - slower, more deliberate sway
            const stepCycle = progress * squaresToCross * Math.PI * 2;
            const stepHeight = 0.2; // Reduced step height since pieces are on ground
            const swayAmount = 0.15; // Gentler sway for ground-level movement
            
            // Calculate terrain height at current position along the path
            const terrainHeightAtCurrentPos = this.getMedianTerrainHeight(currentX, currentZ);
            const baseY = terrainHeightAtCurrentPos + 0.15; // Add slight offset above terrain
            
            // Step up and down on each square, but relative to terrain, not added on top
            let stepY = Math.abs(Math.sin(stepCycle)) * stepHeight;
            
            // Ensure we end exactly at terrain level (no step up at the very end)
            if (progress >= 0.95) {
                stepY = 0;
            }
            
            // Step should be relative to the terrain height, not accumulated
            const currentY = baseY + stepY;
            
                        
            // Slow, deliberate side-to-side sway (like stepping carefully) - but not at the very end
            let swayX = 0, swayZ = 0;
            if (progress < 0.95) { // Only sway during movement, not at the end
                swayX = Math.sin(stepCycle * 0.5) * swayAmount;
                swayZ = Math.cos(stepCycle * 0.5) * swayAmount;
            }
            
            // Mesh deformation synced with stepping - but not at the very end
            let scaleX = 1, scaleY = 1, scaleZ = 1;
            if (progress < 0.95) { // Only deform during movement, not at the end
                const stepPhase = Math.sin(stepCycle);
                const squashAmount = 0.25; // Slightly less deformation for ground contact
                scaleX = 1.0 + (stepPhase * squashAmount * 0.5);
                scaleY = 1.0 - (Math.abs(stepPhase) * squashAmount * 0.3); // Squash when stepping down
                scaleZ = 1.0 + (Math.cos(stepCycle) * squashAmount * 0.5);
            }
            
            // Gentle rotation - slower, more dignified
            const rotationProgress = progress * Math.PI * 0.8; // Less spinning, more turning
            const stepWobble = Math.sin(stepCycle * 2) * 0.05; // Subtle wobble with each step
            
            // Sample terrain normal at current position along the path
            const currentNormal = this.getTerrainNormal(currentX, currentZ);
            
            // Calculate rotation to align with terrain normal (full tilt)
            const upVector = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, currentNormal);
            
            // Apply transformations
            pieceMesh.position.set(currentX + swayX, currentY, currentZ + swayZ);
            pieceMesh.scale.set(scaleX, scaleY, scaleZ);
            
            // Apply terrain alignment rotation + artistic rotation
            pieceMesh.quaternion.multiplyQuaternions(
                quaternion, 
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationProgress + stepWobble)
            );
            
            // Add subtle tilting with each step (relative to terrain normal) - but not at the end
            if (progress < 0.95) {
                const tiltX = Math.sin(stepCycle * 1.2) * 0.02;
                const tiltZ = Math.cos(stepCycle * 1.2) * 0.02;
                const tiltQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, 0, tiltZ));
                pieceMesh.quaternion.multiply(tiltQuaternion);
            }
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Ensure perfect centering before flourish
                pieceMesh.position.set(endPos.x, endPos.y, endPos.z);
                pieceMesh.scale.set(1, 1, 1);
                
                // End with a gentle settling flourish aligned to terrain
                this.disneyFlourish(pieceMesh, targetNormal);
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
    
    disneyFlourish(pieceMesh, terrainNormal = null) {
        // End with a charming little flourish
        const flourishDuration = 300;
        const startTime = Date.now();
        
        const flourish = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / flourishDuration, 1);
            
            // Final bounce and spin with landing
            const bounce = Math.sin(progress * Math.PI) * 0.03; // Much smaller bounce to prevent shelf hopping
            const finalSpin = Math.sin(progress * Math.PI * 2) * 0.15;
            
            // Add bounce during flourish, then land back down
            if (progress < 0.5) {
                // First half: bounce up
                pieceMesh.position.y += bounce;
            } else if (progress < 0.9) {
                // Second half: land back down (negative bounce)
                pieceMesh.position.y -= bounce * 0.8; // Slightly less down to settle gently
            }
            // Final 10%: no height changes, just spin
            
            // Apply halfway terrain normal alignment if provided
            if (terrainNormal) {
                const upVector = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, terrainNormal);
                pieceMesh.quaternion.multiplyQuaternions(
                    quaternion,
                    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), finalSpin)
                );
            } else {
                pieceMesh.rotation.x = 0;
                pieceMesh.rotation.z = 0;
                pieceMesh.rotation.y = 0;
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
                
                if (terrainNormal) {
                    // Align final position with terrain normal
                    const upVector = new THREE.Vector3(0, 1, 0);
                    const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, terrainNormal);
                    pieceMesh.quaternion.copy(quaternion);
                } else {
                    pieceMesh.rotation.x = 0;
                    pieceMesh.rotation.z = 0;
                    pieceMesh.rotation.y = 0;
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
            this.removeSelectionGlow(pieceMesh);
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
        // Sample multiple points across the square to get median height
        const samples = [];
        const sampleCount = 9; // 3x3 grid of samples
        
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const sampleX = x + (i * 0.25); // 0, 0.25, 0.5
                const sampleZ = z + (j * 0.25); // 0, 0.25, 0.5
                samples.push(this.getTerrainHeight(sampleX, sampleZ));
            }
        }
        
        // Sort and return median
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)];
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
