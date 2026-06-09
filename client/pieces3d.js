class Pieces3D {
    constructor(scene, terrainSystem = null, deviceCapabilities = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.deviceCapabilities = deviceCapabilities;
        this.useGLBModels = false; // GLB models disabled until new smaller models are ready
        this.pieces = new Map();
        this.pieceMeshes = new Map();
        this.animatingPieces = new Map();
        this.glbModelCache = new Map(); // Cache loaded GLB models by piece type
        this.glbMeshFilters = {
            pawn: ['pawn'],
            rook: ['rook'],
            knight: ['knight'],
            bishop: ['bishop'],
            queen: ['queen'],
            king: ['king']
        };
        this.glbMeshBlacklist = ['plane', 'circle', 'berserker'];
        
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

        // Create blob shadow texture
        this.blobShadowTexture = this.createBlobShadowTexture();
    }

    createBlobShadowTexture() {
        // Create a radial gradient texture for blob shadows
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Radial gradient from dark center to transparent edge
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)'); // Dark center
        gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Transparent edge

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    createBlobShadow() {
        // Create a simple plane for the blob shadow
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({
            map: this.blobShadowTexture,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const shadow = new THREE.Mesh(geometry, material);
        shadow.name = 'blobShadow';
        shadow.userData.isBlobShadow = true;
        shadow.rotation.x = -Math.PI / 2; // Lay flat on ground
        shadow.position.y = 0.01; // Slightly above ground to avoid z-fighting
        shadow.scale.set(0.8, 0.8, 0.8); // Scale for piece size

        return shadow;
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
        group.name = `piece_${pieceData.type}_${pieceData.color}`;
        const material = this.materials[pieceData.color] || this.materials.white;

        // Inner group holds the actual meshes; outer group handles terrain normal + position
        const modelGroup = new THREE.Group();
        modelGroup.name = `pieceModel_${pieceData.type}`;
        group.add(modelGroup);
        group.userData.modelGroup = modelGroup;

        // Store piece type in userData for voice system
        group.userData.pieceType = pieceData.type.toLowerCase();
        group.userData.isPiece = true; // Mark as piece for vertex profiling

        switch (pieceData.type.toLowerCase()) {
            case 'pawn':
                this.createPawn(modelGroup, material);
                break;
            case 'rook':
                this.createRook(modelGroup, material);
                break;
            case 'knight':
                this.createKnight(modelGroup, material);
                break;
            case 'bishop':
                this.createBishop(modelGroup, material);
                break;
            case 'queen':
                this.createQueen(modelGroup, material);
                break;
            case 'king':
                this.createKing(modelGroup, material);
                break;
            default:
                this.createPawn(modelGroup, material); // Default to pawn
        }

        // Set initial position immediately (no animation for initial placement)
        const height = this.getMedianTerrainHeight(pieceData.x, pieceData.z);
        const normal = this.getTerrainNormal(pieceData.x, pieceData.z);

        // Position just above terrain surface
        const pieceHeight = height + 0.02;
        group.position.set(pieceData.x + 0.5, pieceHeight, pieceData.z + 0.5);

        // Apply terrain normal via quaternion to the outer group (sticks piece to ground)
        // TEMP: Disabled to test if this conflicts with mesh rotation fix
        if (normal && normal.y < 0.999) {
            const up = new THREE.Vector3(0, 1, 0);
            const terrainQuat = new THREE.Quaternion().setFromUnitVectors(up, normal);
            // group.quaternion.copy(terrainQuat); // TEMP: Disabled
            group.quaternion.set(0, 0, 0, 1); // TEMP: Force identity
        } else {
            group.quaternion.set(0, 0, 0, 1);
        }

        // Random Y rotation for variety — applied to modelGroup so terrain normal stays intact
        modelGroup.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);

        // Store reference to piece data
        group.userData.pieceId = pieceData.id;
        group.userData.pieceType = pieceData.type;
        group.userData.terrainHeight = height;
        
        // Check final rotation right before returning
        console.log(`[Pieces3D] DEBUG: Final quaternion before return: x=${group.quaternion.x.toFixed(4)}, y=${group.quaternion.y.toFixed(4)}, z=${group.quaternion.z.toFixed(4)}, w=${group.quaternion.w.toFixed(4)}`);

        // Add blob shadow under the piece
        const blobShadow = this.createBlobShadow();
        blobShadow.position.set(pieceData.x + 0.5, 0.01, pieceData.z + 0.5);
        group.add(blobShadow);
        group.userData.blobShadow = blobShadow;

        return group;
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
        const target = group.userData.modelGroup || group;
        this.createGeometricPawn(target, material);
    }

    createRook(group, material) {
        const target = group.userData.modelGroup || group;
        this.createGeometricRook(target, material);
    }

    createKnight(group, material) {
        const target = group.userData.modelGroup || group;
        this.createGeometricKnight(target, material);
    }

    createBishop(group, material) {
        const target = group.userData.modelGroup || group;
        this.createGeometricBishop(target, material);
    }

    createQueen(group, material) {
        const target = group.userData.modelGroup || group;
        this.createGeometricQueen(target, material);
    }

    createKing(group, material) {
        const target = group.userData.modelGroup || group;
        this.createGeometricKing(target, material);
    }
    
    getEffectiveModelFile(pieceType) {
        try {
            const overrides = JSON.parse(localStorage.getItem('chessiopia_piece_models') || '{}');
            if (overrides[pieceType]) {
                return overrides[pieceType];
            }
        } catch (e) { /* ignore */ }
        return pieceType;
    }

    async loadPieceModel(group, pieceType, material) {
        try {
            // Skip GLB entirely on low/medium tier devices
            if (!this.useGLBModels) {
                this.createGeometricPiece(pieceType, group, material);
                return;
            }

            const effectiveModelFile = this.getEffectiveModelFile(pieceType);
            console.log(`[Pieces3D] === ${pieceType.toUpperCase()} MODEL LOADING START (file: ${effectiveModelFile}) ===`);

            // Check cache first (keyed by resolved model file so overrides are honoured)
            if (this.glbModelCache.has(effectiveModelFile)) {
                console.log(`[Pieces3D] Using cached model for ${effectiveModelFile}`);
                const cachedModel = this.glbModelCache.get(effectiveModelFile);
                const clonedModel = cachedModel.clone();
                const targetGroup = group.userData.modelGroup || group;
                targetGroup.add(clonedModel);
                this.debugLogGLBMeshes(group, `${pieceType} from cache`);
                return;
            }

            console.log(`[Pieces3D] Loading ${pieceType} model from: /Models/${effectiveModelFile}.glb`);

            // Check if GLTFLoader is available
            if (typeof THREE.GLTFLoader === 'undefined') {
                console.warn(`[Pieces3D] GLTFLoader not available, falling back to geometric ${pieceType}`);
                this.createGeometricPiece(pieceType, group, material);
                return;
            }

            console.log(`[Pieces3D] GLTFLoader is available, proceeding to load ${effectiveModelFile}.glb`);

            console.log(`[Pieces3D] Using custom GLTFLoader to load ${effectiveModelFile}.glb`);
            const loader = new THREE.GLTFLoader();
            const loadPromise = loader.loadAsync(`/Models/${effectiveModelFile}.glb?v=${Date.now()}`);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('GLB load timeout (10s)')), 10000)
            );
            const gltf = await Promise.race([loadPromise, timeoutPromise]);
            
            console.log(`[Pieces3D] GLTF loaded successfully for ${pieceType}:`, gltf);
            console.log(`[Pieces3D] GLTF scene:`, gltf.scene);
            console.log(`[Pieces3D] GLTF scene children:`, gltf.scene.children.length);

            // DIAGNOSTIC: Log every node's transform before any code changes
            console.log(`[Pieces3D] === ${pieceType.toUpperCase()} GLB RAW TRANSFORMS ===`);
            gltf.scene.traverse((child) => {
                console.log(`  node='${child.name || '(unnamed)'}' type=${child.type} pos=(${child.position.x.toFixed(3)}, ${child.position.y.toFixed(3)}, ${child.position.z.toFixed(3)}) rot=(${child.rotation.x.toFixed(3)}, ${child.rotation.y.toFixed(3)}, ${child.rotation.z.toFixed(3)}) scale=(${child.scale.x.toFixed(3)}, ${child.scale.y.toFixed(3)}, ${child.scale.z.toFixed(3)})`);
            });
            console.log(`[Pieces3D] === END RAW TRANSFORMS ===`);

            // Get the loaded model and strip out meshes that don't belong to this piece type
            const model = gltf.scene;

            // WORKAROUND: Rotate meshes to stand upright (GLB pieces are lying flat in local space)
            gltf.scene.traverse((child) => {
                if (child.isMesh) {
                    child.rotation.x = -Math.PI / 2; // Rotate -90 degrees around X to stand up
                    child.rotation.z = 0; // Zero out the baked-in Z rotation
                    child.updateMatrix();
                }
            });
            console.log(`[Pieces3D] Applied upright rotation to all meshes in ${pieceType}`);

            const filterStats = this.filterGLBMeshesForPiece(model, pieceType);
            console.log(`[Pieces3D] GLB mesh filter stats for ${pieceType}:`, filterStats);
            
            // Scale the model appropriately
            model.scale.set(0.5, 0.5, 0.5); // Consistent scale for all pieces

            // Debug model bounds after scaling
            const box = new THREE.Box3().setFromObject(model);
            console.log('Model bounding box after scaling:', box);
            console.log('Model size after scaling:', box.getSize(new THREE.Vector3()));

            // Position model so it sits neatly on the board square:
            // center in X/Z, and place bottom (min.y) at y=0
            const center = box.getCenter(new THREE.Vector3());
            model.position.set(-center.x, -box.min.y, -center.z);
            console.log(`[Pieces3D] ${pieceType} model repositioned - bottom at y=0, centered XZ`);

            // Preserve original materials and textures from GLB model
            model.traverse((child) => {
                if (child.isMesh) {
                    // Keep original material with textures, just enable shadows
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.userData.isGLBModel = true;
                }
            });

            // Cache the processed model for future pieces of this type
            this.glbModelCache.set(effectiveModelFile, model.clone());
            console.log(`[Pieces3D] Cached model for ${effectiveModelFile}`);

            // Add model directly to inner modelGroup so outer group handles terrain normal
            const targetGroup = group.userData.modelGroup || group;
            targetGroup.add(model);
            this.debugLogGLBMeshes(group, `${pieceType} after load`);
            console.log(`[Pieces3D] ${pieceType} GLB model loaded with original textures`);

        } catch (error) {
            console.error(`[Pieces3D] Failed to load ${pieceType} GLB model:`, error);
            console.log(`[Pieces3D] Falling back to geometric ${pieceType}`);
            this.createGeometricPiece(pieceType, group, material);
        }
    }


    debugLogGLBMeshes(group, label = 'mesh-snapshot') {
        if (!group) {
            console.warn('[Pieces3D][MeshDebug] No group passed to debugLogGLBMeshes');
            return;
        }

        const pieceId = group.userData?.pieceId ?? 'unknown';
        const pieceType = group.userData?.pieceType ?? 'unknown';
        const meshInfos = [];

        group.traverse((child) => {
            if (child.isMesh && child.userData.isGLBModel) {
                meshInfos.push({
                    name: child.name || '(unnamed)',
                    uuid: child.uuid,
                    parent: child.parent?.name || child.parent?.type || '(no-parent)',
                    childCount: child.children?.length || 0,
                    hasBaseRotation: !!child.userData.baseRotationApplied
                });
            }
        });

        console.log(`[Pieces3D][MeshDebug] ${label} pieceId=${pieceId} type=${pieceType} glbMeshCount=${meshInfos.length}`);
        meshInfos.forEach((info, index) => {
            console.log(`[Pieces3D][MeshDebug]   #${index} name=${info.name} uuid=${info.uuid} parent=${info.parent} childCount=${info.childCount} baseRotApplied=${info.hasBaseRotation}`);
        });
    }

    filterGLBMeshesForPiece(model, pieceType) {
        if (!model) {
            return { kept: 0, removed: 0, skipped: true };
        }

        const typeKey = (pieceType || '').toLowerCase();
        const allowedFragments = this.glbMeshFilters[typeKey] || (typeKey ? [typeKey] : []);
        const blacklist = this.glbMeshBlacklist || [];

        const nodesToRemove = [];
        let kept = 0;
        let totalMeshes = 0;

        model.traverse((child) => {
            if (!child.isMesh) {
                return;
            }
            totalMeshes++;
            const name = (child.name || '').toLowerCase();
            const matchesAllowed = allowedFragments.length === 0
                ? true
                : allowedFragments.some(fragment => fragment && name.includes(fragment));
            const matchesBlacklist = blacklist.some(fragment => fragment && name.includes(fragment));

            if (matchesAllowed && !matchesBlacklist) {
                child.userData.isGLBModel = true;
                kept++;
            } else {
                nodesToRemove.push(child);
            }
        });

        if (kept === 0) {
            // Don't strip everything—leave original model intact for inspection
            console.warn(`[Pieces3D] No GLB meshes matched filters for ${pieceType}, skipping removal (totalMeshes=${totalMeshes})`);
            return { kept: 0, removed: 0, skipped: true };
        }

        nodesToRemove.forEach(child => {
            if (child.parent) {
                console.log(`[Pieces3D] Removing non-matching GLB mesh: ${child.name || '(unnamed)'}`);
                child.parent.remove(child);
            }
        });

        return { kept, removed: nodesToRemove.length, skipped: false };
    }

    createGeometricPiece(pieceType, group, material) {
        // Fallback to geometric pieces (no model loading)
        const target = group.userData.modelGroup || group;
        switch (pieceType) {
            case 'pawn':
                this.createGeometricPawn(target, material);
                break;
            case 'rook':
                this.createGeometricRook(target, material);
                break;
            case 'knight':
                this.createGeometricKnight(target, material);
                break;
            case 'bishop':
                this.createGeometricBishop(target, material);
                break;
            case 'queen':
                this.createGeometricQueen(target, material);
                break;
            case 'king':
                this.createGeometricKing(target, material);
                break;
            default:
                this.createGeometricPawn(target, material);
        }
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
    
    createGeometricPawn(group, material) {
        // Simple geometric pawn
        const baseGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.15, 8);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.075;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        const bodyGeometry = new THREE.CylinderGeometry(0.25, 0.3, 0.4, 8);
        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.y = 0.325;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
        const headGeometry = new THREE.SphereGeometry(0.2, 8, 6);
        const head = new THREE.Mesh(headGeometry, material);
        head.position.y = 0.6;
        head.castShadow = true;
        head.receiveShadow = true;
        group.add(head);
    }
    
    createGeometricRook(group, material) {
        // Geometric rook (castle tower)
        const baseGeometry = new THREE.CylinderGeometry(0.35, 0.4, 0.2, 8);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.1;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        const towerGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.6, 8);
        const tower = new THREE.Mesh(towerGeometry, material);
        tower.position.y = 0.4;
        tower.castShadow = true;
        tower.receiveShadow = true;
        group.add(tower);
        
        // Battlements on top
        const battlementWidth = 0.15;
        const battlementHeight = 0.1;
        const battlementDepth = 0.45;
        
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2;
            const x = Math.cos(angle) * battlementDepth;
            const z = Math.sin(angle) * battlementDepth;
            
            const battlementGeometry = new THREE.BoxGeometry(battlementWidth, battlementHeight, battlementWidth);
            const battlement = new THREE.Mesh(battlementGeometry, material);
            battlement.position.set(x, 0.75, z);
            battlement.castShadow = true;
            battlement.receiveShadow = true;
            group.add(battlement);
        }
    }
    
    createGeometricKnight(group, material) {
        // Geometric knight (simplified horse head)
        const baseGeometry = new THREE.CylinderGeometry(0.35, 0.4, 0.2, 8);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.1;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        const neckGeometry = new THREE.CylinderGeometry(0.25, 0.3, 0.4, 8);
        const neck = new THREE.Mesh(neckGeometry, material);
        neck.position.y = 0.4;
        neck.castShadow = true;
        neck.receiveShadow = true;
        group.add(neck);
        
        // Head (simplified horse head shape)
        const headGeometry = new THREE.BoxGeometry(0.4, 0.3, 0.5);
        const head = new THREE.Mesh(headGeometry, material);
        head.position.y = 0.7;
        head.position.z = 0.2;
        head.castShadow = true;
        head.receiveShadow = true;
        group.add(head);
        
        // Ear
        const earGeometry = new THREE.ConeGeometry(0.08, 0.2, 4);
        const ear = new THREE.Mesh(earGeometry, material);
        ear.position.y = 0.95;
        ear.position.z = 0.35;
        ear.rotation.x = Math.PI / 6;
        ear.castShadow = true;
        ear.receiveShadow = true;
        group.add(ear);
    }
    
    createGeometricBishop(group, material) {
        // Geometric bishop (mitre hat)
        const baseGeometry = new THREE.CylinderGeometry(0.35, 0.4, 0.2, 8);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.1;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.5, 8);
        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.y = 0.45;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
        // Mitre (bishop hat)
        const mitreGeometry = new THREE.ConeGeometry(0.25, 0.4, 8);
        const mitre = new THREE.Mesh(mitreGeometry, material);
        mitre.position.y = 0.85;
        mitre.castShadow = true;
        mitre.receiveShadow = true;
        group.add(mitre);
        
        // Cross on mitre
        const crossGeometry = new THREE.BoxGeometry(0.05, 0.15, 0.05);
        const cross = new THREE.Mesh(crossGeometry, material);
        cross.position.y = 1.1;
        cross.castShadow = true;
        cross.receiveShadow = true;
        group.add(cross);
    }
    
    createGeometricQueen(group, material) {
        // Geometric queen (crown with multiple points)
        const baseGeometry = new THREE.CylinderGeometry(0.35, 0.4, 0.2, 8);
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.1;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);
        
        const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.5, 8);
        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.y = 0.45;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
        // Crown base
        const crownBaseGeometry = new THREE.CylinderGeometry(0.35, 0.3, 0.15, 8);
        const crownBase = new THREE.Mesh(crownBaseGeometry, material);
        crownBase.position.y = 0.775;
        crownBase.castShadow = true;
        crownBase.receiveShadow = true;
        group.add(crownBase);
        
        // Crown points (5 points)
        for (let i = 0; i < 5; i++) {
            const angle = (i * 2 * Math.PI) / 5;
            const x = Math.cos(angle) * 0.2;
            const z = Math.sin(angle) * 0.2;
            
            const pointGeometry = new THREE.ConeGeometry(0.08, 0.3, 6);
            const point = new THREE.Mesh(pointGeometry, material);
            point.position.set(x, 1.0, z);
            point.castShadow = true;
            point.receiveShadow = true;
            group.add(point);
        }
        
        // Central sphere
        const sphereGeometry = new THREE.SphereGeometry(0.1, 8, 6);
        const sphere = new THREE.Mesh(sphereGeometry, material);
        sphere.position.y = 0.85;
        sphere.castShadow = true;
        sphere.receiveShadow = true;
        group.add(sphere);
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

        console.log(`[Pieces3D] === MOVEMENT START ===`);
        console.log(`[Pieces3D] Piece Type: ${pieceType}`);
        console.log(`[Pieces3D] Start Position: (${startPos.x.toFixed(2)}, ${startPos.y.toFixed(2)}, ${startPos.z.toFixed(2)})`);
        console.log(`[Pieces3D] End Position: (${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}, ${endPos.z.toFixed(2)})`);

        // Revert deformation during movement (make base horizontal)
        pieceMesh.traverse((child) => {
            if (child.isMesh && child.userData.originalGeometry) {
                this.revertMeshDeformation(child);
            }
        });

        // Calculate distance and number of squares to cross
        const distance = Math.sqrt(Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.z - startPos.z, 2));
        const squaresToCross = Math.max(Math.floor(distance), 1); // At least 1 step

        const hopDuration = 600 * squaresToCross;
        const totalDuration = hopDuration;
        const startTime = Date.now();

        // Pre-sample terrain heights along the path so we avoid resampling every frame
        const terrainSampleCount = Math.max(squaresToCross * 2, 1);
        const terrainHeightSamples = [];
        for (let i = 0; i <= terrainSampleCount; i++) {
            const t = i / terrainSampleCount;
            const sampleX = THREE.MathUtils.lerp(startPos.x, endPos.x, t);
            const sampleZ = THREE.MathUtils.lerp(startPos.z, endPos.z, t);
            terrainHeightSamples.push(this.getMedianTerrainHeight(sampleX, sampleZ));
        }

        const getTerrainHeightAtProgress = (t) => {
            if (terrainHeightSamples.length === 1) {
                return terrainHeightSamples[0];
            }

            const clampedT = Math.min(Math.max(t, 0), 1);
            const scaled = clampedT * terrainSampleCount;
            const baseIndex = Math.floor(scaled);

            if (baseIndex >= terrainSampleCount) {
                return terrainHeightSamples[terrainSampleCount];
            }

            const lerpFactor = scaled - baseIndex;
            const startHeight = terrainHeightSamples[baseIndex];
            const endHeight = terrainHeightSamples[baseIndex + 1];
            return THREE.MathUtils.lerp(startHeight, endHeight, lerpFactor);
        };

        // --- FACE DESTINATION SETUP ---
        const modelGroup = pieceMesh.userData.modelGroup;
        const dx = endPos.x - startPos.x;
        const dz = endPos.z - startPos.z;
        const targetRotationY = Math.atan2(dx, dz);
        const startRotationY = modelGroup ? modelGroup.rotation.y : 0;
        let deltaAngle = targetRotationY - startRotationY;
        // Normalize to shortest path (-PI to PI)
        while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
        while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
        // ------------------------------
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / totalDuration, 1);
            
            // Play footsteps during movement
            if (window.soundManager && progress > 0.1 && progress < 0.9) {
                const stepDivisions = Math.max(squaresToCross, 1);
                const footstepInterval = hopDuration / stepDivisions / 2;
                const previousElapsed = Math.max(elapsed - 16, 0);
                const shouldPlayFootstep = footstepInterval > 0 &&
                    Math.floor(elapsed / footstepInterval) !== Math.floor(previousElapsed / footstepInterval);
                if (shouldPlayFootstep) {
                    window.soundManager.playFootstep();
                    if (window.soundManager.playGrumble && Math.random() < 0.05) {
                        const camera = window.game && window.game.camera;
                        let distanceToCamera = null;
                        if (camera) {
                            const dx = group.position.x - camera.position.x;
                            const dy = group.position.y - camera.position.y;
                            const dz = group.position.z - camera.position.z;
                            distanceToCamera = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        }
                        window.soundManager.playGrumble(pieceType, distanceToCamera);
                    }
                }
            }

            const hopPhase = progress * squaresToCross;
            let stepHeight = 0.25;
            let swayAmount = 0.08;
            let squashAmount = 0.15;

            if (hopPhase < 1) {
                stepHeight = 0.25;
                swayAmount = 0.08;
                squashAmount = 0.15;
            } else if (hopPhase < 2) {
                stepHeight = 0.35;
                swayAmount = 0.12;
                squashAmount = 0.20;
            } else {
                stepHeight = 0.3;
                swayAmount = 0.15;
                squashAmount = 0.25;
            }

            // Higher final hop for the last square
            if (progress > 0.85) {
                stepHeight *= 1.8;
                swayAmount *= 0.7;
            }
            
            // Calculate hopping motion
            const stepCycle = progress * squaresToCross * Math.PI * 2;
            let hopY = Math.abs(Math.sin(stepCycle)) * stepHeight;
            
            // Ensure we land perfectly at the end
            if (progress >= 0.98) {
                hopY = 0;
            }

            const horizontalProgress = this.disneyEaseInOut(progress);
            const currentX = THREE.MathUtils.lerp(startPos.x, endPos.x, horizontalProgress);
            const currentZ = THREE.MathUtils.lerp(startPos.z, endPos.z, horizontalProgress);
            const terrainY = getTerrainHeightAtProgress(progress) + 0.02;
            const lerpedY = THREE.MathUtils.lerp(startPos.y, endPos.y, horizontalProgress);
            const baseY = THREE.MathUtils.lerp(lerpedY, terrainY, 0.7);
            const currentY = baseY + hopY;
            
            // Side-to-side swaying
            let swayX = 0, swayZ = 0;
            if (progress < 0.95) {
                swayX = Math.sin(stepCycle * 0.7) * swayAmount;
                swayZ = Math.cos(stepCycle * 0.7) * swayAmount * 0.6;
            }
            
            // Squash and stretch during hops
            let scaleX = 1, scaleY = 1, scaleZ = 1;
            if (progress < 0.95) {
                const stepPhase = Math.sin(stepCycle);
                scaleX = 1.0 + (stepPhase * squashAmount * 0.4);
                scaleY = 1.0 - (Math.abs(stepPhase) * squashAmount * 0.3);
                scaleZ = 1.0 + (Math.cos(stepCycle) * squashAmount * 0.4);
            }

            // Face destination during first 25% of movement
            if (modelGroup && progress < 0.25) {
                const turnProgress = this.disneyEaseInOut(progress / 0.25);
                modelGroup.rotation.y = startRotationY + deltaAngle * turnProgress;
            } else if (modelGroup) {
                modelGroup.rotation.y = targetRotationY;
            }

            // Apply transformations
            pieceMesh.position.set(currentX + swayX, currentY, currentZ + swayZ);
            pieceMesh.scale.set(scaleX, scaleY, scaleZ);

            // Update blob shadow position
            if (pieceMesh.userData.blobShadow) {
                pieceMesh.userData.blobShadow.position.set(currentX + swayX, 0.01, currentZ + swayZ);
            }
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Ensure perfect final positioning
                pieceMesh.position.set(endPos.x, endPos.y, endPos.z);
                pieceMesh.scale.set(1, 1, 1);

                // Update blob shadow to final position
                if (pieceMesh.userData.blobShadow) {
                    pieceMesh.userData.blobShadow.position.set(endPos.x, 0.01, endPos.z);
                }
                
                // Play movement sounds with piece type
                if (window.soundManager) {
                    let distanceToCamera = null;
                    const camera = window.game && window.game.camera;
                    if (camera) {
                        const dx = endPos.x - camera.position.x;
                        const dy = endPos.y - camera.position.y;
                        const dz = endPos.z - camera.position.z;
                        distanceToCamera = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    }
                    window.soundManager.playMoveSound(pieceType, distanceToCamera);
                }
                
                // Special flourish for higher final hop
                this.disneyFlourish(pieceMesh, targetNormal);
                
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
    
    disneyFlourish(pieceMesh, terrainNormal = null) {
        // Simple landing: brief scale-in from slightly smaller to normal
        const duration = 150;
        const startTime = Date.now();

        const settle = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);

            const scale = 0.92 + (0.08 * eased);
            pieceMesh.scale.setScalar(scale);

            if (progress < 1) {
                requestAnimationFrame(settle);
            } else {
                pieceMesh.scale.setScalar(1);

                if (terrainNormal !== null) {
                    const up = new THREE.Vector3(0, 1, 0);
                    const terrainQuat = new THREE.Quaternion().setFromUnitVectors(up, terrainNormal);
                    // pieceMesh.quaternion.copy(terrainQuat); // TEMP: Disabled
                    pieceMesh.quaternion.set(0, 0, 0, 1); // TEMP: Force identity
                } else {
                    pieceMesh.quaternion.set(0, 0, 0, 1);
                }
            }
        };

        settle();
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
            if (pieceMesh.userData.modelGroup) {
                pieceMesh.userData.modelGroup.rotation.y += progress * Math.PI;
            }
            
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
        let height = 0;
        // Use board system for consistent heights with board tiles
        if (window.game && window.game.boardSystem) {
            const board = window.game.boardSystem;
            const camera = window.game.camera;

            // Check if point is within mesh range
            if (camera) {
                const meshExtent = 96; // ±96 units from camera (192x192 vertex grid)
                const dx = Math.abs(x - camera.position.x);
                const dz = Math.abs(z - camera.position.z);

                if (dx <= meshExtent && dz <= meshExtent) {
                    height = board.getUnifiedTerrainHeight(x, z);
                } else {
                    if (board._serverHeightCache) {
                        const cacheKey = `${Math.floor(x)},${Math.floor(z)}`;
                        if (board._serverHeightCache.has(cacheKey)) {
                            height = board._serverHeightCache.get(cacheKey);
                        } else {
                            height = board.getUnifiedTerrainHeight(x, z);
                        }
                    } else {
                        height = board.getUnifiedTerrainHeight(x, z);
                    }
                }
            } else {
                height = board.getUnifiedTerrainHeight(x, z);
            }
        }

        if (!Number.isFinite(height)) {
            console.warn(`[Pieces3D] Invalid terrain height at (${x},${z}): ${height}, using fallback 0`);
            return 0;
        }
        return height;
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
        // Prefer terrain system normals when available to match terrain shading
        if (this.terrainSystem && typeof this.terrainSystem.getNormal === 'function') {
            const terrainNormal = this.terrainSystem.getNormal(x, z);
            if (terrainNormal && typeof terrainNormal.x === 'number') {
                return terrainNormal.clone ? terrainNormal.clone().normalize() : terrainNormal;
            }
        }

        // Fallback: approximate normal using sampled heights around the target point
        const delta = 0.1;
        const hCenter = this.getTerrainHeight(x, z);
        const hRight = this.getTerrainHeight(x + delta, z);
        const hLeft = this.getTerrainHeight(x - delta, z);
        const hUp = this.getTerrainHeight(x, z + delta);
        const hDown = this.getTerrainHeight(x, z - delta);

        const dx = (hRight - hLeft) / (2 * delta);
        const dz = (hUp - hDown) / (2 * delta);

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
