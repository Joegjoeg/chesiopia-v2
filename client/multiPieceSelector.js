/**
 * MultiPieceSelector - Handles multi-piece selection via drag, click, shift-click, and group hotkeys.
 * Only allows selecting pieces owned by the current player.
 */
class MultiPieceSelector {
    constructor(game) {
        this.game = game;
        this.selectedPieces = new Map(); // pieceId -> piece
        this.selectionGroups = new Map(); // number -> Set(pieceId)

        // Drag state
        this.isMouseDown = false;
        this.isDragging = false;
        this.dragStartMouse = { x: 0, y: 0 };
        this.dragStartWorld = null;
        this.dragCurrentWorld = null;
        this.dragThreshold = 5; // pixels before drag starts
        this.ignoreNextClick = false;

        // Visuals
        this.dragRingMesh = null;
        this.selectionOutlineMeshes = new Map(); // pieceId -> outline mesh
        this.outlineMaterial = null;

        this._initOutlineMaterial();
    }

    _initOutlineMaterial() {
        this.outlineMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.8,
            side: THREE.BackSide,
            depthTest: false
        });
    }

    // ------------------------------------------------------------------
    //  Mouse events (called from game.js)
    // ------------------------------------------------------------------

    onMouseDown(event) {
        if (event.button !== 0) return;
        this.isMouseDown = true;
        this.isDragging = false;
        this.ignoreNextClick = false;
        this.dragStartMouse = { x: event.clientX, y: event.clientY };
        this.dragStartWorld = this._getMouseWorldPosition(event);
    }

    onMouseMove(event) {
        if (!this.isMouseDown) return;

        const dx = event.clientX - this.dragStartMouse.x;
        const dy = event.clientY - this.dragStartMouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!this.isDragging && dist > this.dragThreshold) {
            this.isDragging = true;
            this.ignoreNextClick = true;
            this._createDragRing();
        }

        if (this.isDragging) {
            this.dragCurrentWorld = this._getMouseWorldPosition(event);
            this._updateDragRing();
            this._highlightPiecesInDragRing();
        }
    }

    onMouseUp(event) {
        if (!this.isMouseDown) return;
        this.isMouseDown = false;

        if (this.isDragging) {
            this._finalizeDragSelection(event.shiftKey);
            this._clearDragRing();
            this.isDragging = false;
        }
    }

    /**
     * Returns true if the current click event should be consumed (i.e., a drag just ended).
     * Call this at the top of your click handler.
     */
    shouldConsumeClick() {
        if (this.ignoreNextClick) {
            this.ignoreNextClick = false;
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------------
    //  Piece / board clicks
    // ------------------------------------------------------------------

    onPieceClick(piece, shiftKey) {
        if (!this._isOwnPiece(piece)) return;

        if (shiftKey) {
            this.togglePieceSelection(piece);
        } else {
            this.selectSinglePiece(piece);
        }
    }

    onBoardClick(x, z) {
        // If we have pieces selected and click empty ground, start formation move
        if (this.selectedPieces.size > 0) {
            this._executeFormationMove(x, z);
        } else {
            this.deselectAll();
        }
    }

    // ------------------------------------------------------------------
    //  Selection API
    // ------------------------------------------------------------------

    selectSinglePiece(piece) {
        this.deselectAll();
        if (piece) {
            this.selectedPieces.set(piece.id, piece);
            this._addPieceOutline(piece);
            this._onSelectionChanged();
        }
    }

    togglePieceSelection(piece) {
        if (this.selectedPieces.has(piece.id)) {
            this.selectedPieces.delete(piece.id);
            this._removePieceOutline(piece.id);
        } else {
            this.selectedPieces.set(piece.id, piece);
            this._addPieceOutline(piece);
        }
        this._onSelectionChanged();
    }

    deselectAll() {
        for (const pieceId of this.selectionOutlineMeshes.keys()) {
            this._removePieceOutline(pieceId);
        }
        this.selectedPieces.clear();
        this._onSelectionChanged();
    }

    getSelectedPieces() {
        return Array.from(this.selectedPieces.values());
    }

    hasSelection() {
        return this.selectedPieces.size > 0;
    }

    isPieceSelected(pieceId) {
        return this.selectedPieces.has(pieceId);
    }

    // ------------------------------------------------------------------
    //  Selection groups (Ctrl+1..9 to save, 1..9 to recall)
    // ------------------------------------------------------------------

    saveGroup(number) {
        const pieceIds = new Set(this.selectedPieces.keys());
        this.selectionGroups.set(number, pieceIds);
        console.log(`[MultiPieceSelector] Saved group ${number} with ${pieceIds.size} pieces`);
    }

    loadGroup(number) {
        const pieceIds = this.selectionGroups.get(number);
        if (!pieceIds || pieceIds.size === 0) {
            console.log(`[MultiPieceSelector] Group ${number} is empty`);
            return;
        }

        this.deselectAll();
        for (const pieceId of pieceIds) {
            const piece = this.game.gameState.getPiece(pieceId);
            if (piece && this._isOwnPiece(piece)) {
                this.selectedPieces.set(piece.id, piece);
                this._addPieceOutline(piece);
            }
        }
        this._onSelectionChanged();
        console.log(`[MultiPieceSelector] Loaded group ${number} with ${this.selectedPieces.size} pieces`);
    }

    // ------------------------------------------------------------------
    //  Ownership
    // ------------------------------------------------------------------

    _isOwnPiece(piece) {
        const myPlayerId = this.game.gameState.getCurrentPlayerId();
        return piece && piece.playerId === myPlayerId;
    }

    // ------------------------------------------------------------------
    //  Formation move trigger
    // ------------------------------------------------------------------

    _executeFormationMove(targetX, targetZ) {
        const selected = this.getSelectedPieces();
        if (selected.length === 0) return;

        if (this.game.groupMoveExecutor) {
            this.game.groupMoveExecutor.executeMove(selected, targetX, targetZ);
        } else {
            console.warn('[MultiPieceSelector] GroupMoveExecutor not available');
        }
    }

    // ------------------------------------------------------------------
    //  Drag selection internals
    // ------------------------------------------------------------------

    _createDragRing() {
        if (this.dragRingMesh) this._clearDragRing();

        const geometry = new THREE.RingGeometry(0.1, 0.12, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthTest: false
        });

        this.dragRingMesh = new THREE.Mesh(geometry, material);
        this.dragRingMesh.name = 'dragSelectionRing';
        this.dragRingMesh.rotation.x = -Math.PI / 2;
        this.game.scene.add(this.dragRingMesh);

        // Expand spotlight during drag
        if (this.game.spotLight) {
            this.game.spotLight.angle = Math.PI / 4;
            this.game.spotLight.penumbra = 0.8;
            this.game.spotLight.intensity = 1.2;
        }
    }

    _updateDragRing() {
        if (!this.dragRingMesh || !this.dragStartWorld || !this.dragCurrentWorld) return;

        const dx = this.dragCurrentWorld.x - this.dragStartWorld.x;
        const dz = this.dragCurrentWorld.z - this.dragStartWorld.z;
        const radius = Math.sqrt(dx * dx + dz * dz);

        const centerX = (this.dragStartWorld.x + this.dragCurrentWorld.x) / 2;
        const centerZ = (this.dragStartWorld.z + this.dragCurrentWorld.z) / 2;

        this.dragRingMesh.position.set(centerX, 0.05, centerZ);
        this.dragRingMesh.scale.setScalar(Math.max(radius, 0.1));

        // Update spotlight to match ring
        if (this.game.spotLight) {
            this.game.spotLight.position.set(centerX, this.game.spotLight.position.y, centerZ);
            this.game.spotLight.target.position.set(centerX, 0, centerZ);
            // Scale angle with ring size (clamp to avoid too wide)
            const baseAngle = this.spotlightBaseAngle;
            const scale = Math.min(radius / 5, 3);
            this.game.spotLight.angle = baseAngle * (1 + scale);
        }
    }

    _highlightPiecesInDragRing() {
        if (!this.dragStartWorld || !this.dragCurrentWorld) return;

        const cx = (this.dragStartWorld.x + this.dragCurrentWorld.x) / 2;
        const cz = (this.dragStartWorld.z + this.dragCurrentWorld.z) / 2;
        const dx = this.dragCurrentWorld.x - this.dragStartWorld.x;
        const dz = this.dragCurrentWorld.z - this.dragStartWorld.z;
        const radius = Math.sqrt(dx * dx + dz * dz);

        // Temporary set of pieces inside the ring this frame
        const insideIds = new Set();

        const allPieces = this.game.gameState.getAllPieces();
        const myPlayerId = this.game.gameState.getCurrentPlayerId();

        for (const piece of allPieces) {
            if (piece.playerId !== myPlayerId) continue;

            const pdx = (piece.x + 0.5) - cx;
            const pdz = (piece.z + 0.5) - cz;
            const dist = Math.sqrt(pdx * pdx + pdz * pdz);

            if (dist <= radius) {
                insideIds.add(piece.id);
                if (!this.selectionOutlineMeshes.has(piece.id)) {
                    this._addPieceOutline(piece, true);
                }
            }
        }

        // Remove outlines for pieces that left the ring
        for (const [pieceId, mesh] of this.selectionOutlineMeshes) {
            if (!insideIds.has(pieceId)) {
                this._removePieceOutline(pieceId);
            }
        }
    }

    _finalizeDragSelection(shiftKey) {
        if (!this.dragStartWorld || !this.dragCurrentWorld) return;

        const cx = (this.dragStartWorld.x + this.dragCurrentWorld.x) / 2;
        const cz = (this.dragStartWorld.z + this.dragCurrentWorld.z) / 2;
        const dx = this.dragCurrentWorld.x - this.dragStartWorld.x;
        const dz = this.dragCurrentWorld.z - this.dragStartWorld.z;
        const radius = Math.sqrt(dx * dx + dz * dz);

        if (!shiftKey) {
            this.deselectAll();
        }

        const allPieces = this.game.gameState.getAllPieces();
        const myPlayerId = this.game.gameState.getCurrentPlayerId();
        let added = 0;

        for (const piece of allPieces) {
            if (piece.playerId !== myPlayerId) continue;

            const pdx = (piece.x + 0.5) - cx;
            const pdz = (piece.z + 0.5) - cz;
            const dist = Math.sqrt(pdx * pdx + pdz * pdz);

            if (dist <= radius) {
                this.selectedPieces.set(piece.id, piece);
                this._addPieceOutline(piece);
                added++;
            }
        }

        console.log(`[MultiPieceSelector] Drag selection finalized: ${added} pieces selected`);
        this._onSelectionChanged();
    }

    _clearDragRing() {
        if (this.dragRingMesh) {
            this.game.scene.remove(this.dragRingMesh);
            this.dragRingMesh.geometry.dispose();
            this.dragRingMesh.material.dispose();
            this.dragRingMesh = null;
        }

        // Reset spotlight
        if (this.game.spotLight) {
            this.game.spotLight.angle = this.spotlightBaseAngle;
            this.game.spotLight.penumbra = 0.5;
            const ps = window.parameterSystem;
            const intensity = ps ? ps.getParameter('spotlightIntensity') : 0.4;
            this.game.spotLight.intensity = intensity;
        }
    }

    // ------------------------------------------------------------------
    //  Piece outline visuals
    // ------------------------------------------------------------------

    _addPieceOutline(piece, isTemporary = false) {
        if (this.selectionOutlineMeshes.has(piece.id)) return;

        const pieceMesh = this.game.piecesSystem.pieceMeshes.get(piece.id);
        if (!pieceMesh) return;

        // Compute bounding box of the piece model
        const box = new THREE.Box3().setFromObject(pieceMesh);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        const outlineGeo = new THREE.BoxGeometry(maxDim * 1.05, maxDim * 1.05, maxDim * 1.05);
        const outlineMesh = new THREE.Mesh(outlineGeo, this.outlineMaterial.clone());

        // Parent to piece mesh so it follows automatically
        pieceMesh.add(outlineMesh);
        outlineMesh.position.set(0, size.y * 0.4, 0);
        outlineMesh.name = 'selectionOutline';
        outlineMesh.userData.isTemporary = isTemporary;

        this.selectionOutlineMeshes.set(piece.id, outlineMesh);
    }

    _removePieceOutline(pieceId) {
        const mesh = this.selectionOutlineMeshes.get(pieceId);
        if (mesh) {
            if (mesh.parent) mesh.parent.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            this.selectionOutlineMeshes.delete(pieceId);
        }
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    _getMouseWorldPosition(event) {
        const rect = this.game.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.game.camera);

        // Intersect with a theoretical ground plane at y=0
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, target);

        return target || new THREE.Vector3();
    }

    _onSelectionChanged() {
        // Notify game
        if (this.game.onMultiSelectionChanged) {
            this.game.onMultiSelectionChanged(this.getSelectedPieces());
        }

        // Update UI
        this._updateSelectionUI();
    }

    _updateSelectionUI() {
        const count = this.selectedPieces.size;
        const infoPanel = document.getElementById('selectedPieceInfo');
        const typeEl = document.getElementById('selectedPieceType');
        const cooldownEl = document.getElementById('selectedPieceCooldown');

        if (count === 0) {
            if (infoPanel) infoPanel.classList.add('hidden');
            return;
        }

        if (infoPanel) infoPanel.classList.remove('hidden');
        if (typeEl) {
            if (count === 1) {
                const piece = this.getSelectedPieces()[0];
                typeEl.textContent = piece.type.charAt(0).toUpperCase() + piece.type.slice(1);
            } else {
                typeEl.textContent = `${count} pieces selected`;
            }
        }
        if (cooldownEl) {
            const readyCount = this.getSelectedPieces().filter(p => !this.game.getPieceCooldown(p)).length;
            cooldownEl.textContent = readyCount === count ? 'All ready' : `${readyCount}/${count} ready`;
        }
    }
}

if (typeof window !== 'undefined') {
    window.MultiPieceSelector = MultiPieceSelector;
}
