class JesusSummonSystem {
    constructor({ scene, boardSystem, terrainSystem } = {}) {
        this.scene = scene;
        this.boardSystem = boardSystem;
        this.terrainSystem = terrainSystem;
        this.waterLevel = (boardSystem && boardSystem.waterLevel) ?? -1.5;

        this.jesusGroup = null;
        this.jesusHeight = 6;
        this._modelLoaded = false;
        this._loader = null;
        this._currentAnimation = null;
        this._hillKey = 'jesusSummonHill';
        this._status = 'idle';
        this._refreshAccumulator = 0;
        this.targetLift = 4;
        this._rumbleActive = false;
        this._heraldPlayed = false;
        this._rotationHumActive = false;
        this._tempVec = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
        this._facingOffset = -Math.PI / 2; // Rotate 90° clockwise relative to camera
    }

    get status() {
        if (this._currentAnimation) return 'summoning';
        return this._status;
    }

    async summonJesus(options = {}) {
        if (!this.boardSystem || !this.scene) {
            console.warn('[JesusSummonSystem] Missing scene or board system');
            return;
        }
        if (this._currentAnimation) {
            console.warn('[JesusSummonSystem] Summon already in progress');
            return;
        }

        await this._ensureModel();

        const spawnPoint = this._pickSpawnPoint(options);
        if (!spawnPoint) {
            console.warn('[JesusSummonSystem] No valid spawn point found');
            return;
        }
        const centerX = spawnPoint.x;
        const centerZ = spawnPoint.z;
        const groundHeight = this.boardSystem.getUnifiedTerrainHeight(centerX, centerZ);
        const lift = this.getTargetLift();
        const desiredPeak = Math.max(this.waterLevel + lift, groundHeight + lift);
        const hillAmplitude = desiredPeak - groundHeight;
        if (hillAmplitude <= 0.01) {
            console.warn('[JesusSummonSystem] Terrain already above target height; skipping summon');
            return;
        }

        const startY = this.waterLevel - this.jesusHeight - 1;
        const endY = groundHeight + hillAmplitude; // matches peak height once hill completes

        this.jesusGroup.visible = true;
        this.jesusGroup.position.set(centerX, startY, centerZ);
        this.jesusGroup.rotation.y = Math.PI + this._facingOffset; // Base orientation

        const modifierConfig = {
            type: 'gaussianHill',
            centerX,
            centerZ,
            radius: 8,
            sigma: 4,
            amplitude: hillAmplitude,
            strength: 0,
            plateauHalfSize: 1.5, // 3x3 area in world units
            plateauBlend: 1.0
        };
        this.boardSystem.setTerrainModifier(this._hillKey, modifierConfig);

        // Move camera target to summon location
        const game = this.boardSystem && this.boardSystem.game;
        if (game && game.cameraController) {
            game.cameraController.centerOnPosition(centerX, centerZ);
        }

        this._currentAnimation = {
            duration: 3500,
            elapsedMs: 0,
            startY,
            endY,
            centerX,
            centerZ,
            radius: modifierConfig.radius + 2,
            modifier: modifierConfig
        };
        this._status = 'summoning';
        this._refreshAccumulator = 0;
        this._heraldPlayed = false;
        this._rumbleActive = false;
        this._rotationHumActive = false;
        this._startSummonAudio(this._currentAnimation.duration / 1000);
        console.log('[JesusSummonSystem] Summon started at', centerX, centerZ);
    }

    update(deltaTime = 0) {
        this._updateFacing(deltaTime);
        this._updateRotationAudio();

        if (!this._currentAnimation) {
            return;
        }

        const anim = this._currentAnimation;
        anim.elapsedMs += deltaTime * 1000;
        const progress = Math.min(anim.elapsedMs / anim.duration, 1);
        const eased = this._easeOutCubic(progress);

        // Update hill strength
        anim.modifier.strength = eased;
        this.boardSystem.setTerrainModifier(this._hillKey, anim.modifier);

        // Refresh the rolling mesh periodically so the hill appears while animating
        this._refreshAccumulator += deltaTime;
        if (this._refreshAccumulator >= 0.05) {
            this._refreshAccumulator = 0;
            const pad = anim.radius;
            this.boardSystem.refreshTerrainRegion(
                anim.centerX - pad,
                anim.centerZ - pad,
                anim.centerX + pad,
                anim.centerZ + pad
            );
        }

        // Animate Jesus rising with the hill
        if (this.jesusGroup && typeof THREE !== 'undefined' && THREE.MathUtils) {
            const easedHeight = THREE.MathUtils.lerp(anim.startY, anim.endY, eased);
            this.jesusGroup.position.y = easedHeight;
        }

        if (!this._heraldPlayed && progress >= 0.92) {
            this._triggerHeraldCue();
        }

        if (progress >= 1) {
            this._status = 'idle';
            this._currentAnimation = null;
            this._stopSummonAudio();
            console.log('[JesusSummonSystem] Summon complete');
        }
    }

    setTargetLift(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        this.targetLift = Math.min(20, Math.max(1, numeric));
    }

    getTargetLift() {
        return this.targetLift || 4;
    }

    _easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    _pickSpawnPoint(options = {}) {
        const override = this._validateSpawnPoint(options.spawnOverride);
        if (override) {
            return override;
        }
        const preferredCenter = options.preferredCenter && isFinite(options.preferredCenter.x) && isFinite(options.preferredCenter.z)
            ? { x: options.preferredCenter.x, z: options.preferredCenter.z }
            : null;
        const radius = isFinite(options.searchRadius) ? options.searchRadius : undefined;
        const step = isFinite(options.searchStep) ? options.searchStep : undefined;
        return this._findBestWaterSpawn(preferredCenter, { radius, step });
    }

    _validateSpawnPoint(spawn) {
        if (!spawn || !isFinite(spawn.x) || !isFinite(spawn.z)) {
            return null;
        }
        const groundHeight = this.boardSystem.getUnifiedTerrainHeight(spawn.x, spawn.z);
        const depth = this.waterLevel - groundHeight;
        if (depth < 0.2) {
            return null;
        }
        return { x: spawn.x, z: spawn.z, depth };
    }

    _startSummonAudio(durationSeconds = 4) {
        if (!window.soundManager || typeof window.soundManager.startRumble !== 'function') {
            return;
        }
        window.soundManager.startRumble({
            duration: durationSeconds + 1,
            volume: 0.7
        });
        this._rumbleActive = true;
        if (typeof window.soundManager.startRotationHum === 'function') {
            window.soundManager.startRotationHum({ volume: 0.4, wobbleRate: 0.55 });
            this._rotationHumActive = true;
        }
    }

    _triggerHeraldCue() {
        if (this._heraldPlayed) return;
        this._heraldPlayed = true;
        if (window.soundManager) {
            if (typeof window.soundManager.stopRumble === 'function') {
                window.soundManager.stopRumble({ fade: 0.6 });
            }
            if (typeof window.soundManager.stopRotationHum === 'function' && this._rotationHumActive) {
                window.soundManager.stopRotationHum({ fade: 0.4 });
            }
            if (typeof window.soundManager.playHeavenlyChorus === 'function') {
                const intensity = Math.min(1, this.getTargetLift() / 8);
                window.soundManager.playHeavenlyChorus({ intensity });
            }
        }
        this._rumbleActive = false;
        this._rotationHumActive = false;
    }

    _stopSummonAudio() {
        if (this._rumbleActive && window.soundManager && typeof window.soundManager.stopRumble === 'function') {
            window.soundManager.stopRumble({ fade: 0.5 });
        }
        this._rumbleActive = false;
        if (this._rotationHumActive && window.soundManager && typeof window.soundManager.stopRotationHum === 'function') {
            window.soundManager.stopRotationHum({ fade: 0.4 });
        }
        this._rotationHumActive = false;
    }

    _orientModelUpright(root) {
        if (!root || typeof THREE === 'undefined' || !THREE.Box3 || !THREE.Vector3) {
            return;
        }

        root.rotation.set(0, 0, 0);
        root.updateMatrixWorld(true);

        const bbox = new THREE.Box3().setFromObject(root);
        const size = bbox.getSize(new THREE.Vector3());
        const axes = [
            { axis: 'x', value: size.x },
            { axis: 'y', value: size.y },
            { axis: 'z', value: size.z }
        ].sort((a, b) => b.value - a.value);

        const [primary, secondary] = axes;
        const dominance = secondary && secondary.value > 0 ? primary.value / secondary.value : Infinity;
        if (primary.axis === 'y' || dominance < 1.1) {
            // Already upright or axis lengths too similar to pick a rotation
            return;
        }

        if (primary.axis === 'x') {
            root.rotateZ(Math.PI / 2);
        } else if (primary.axis === 'z') {
            root.rotateX(-Math.PI / 2);
        }

        root.updateMatrixWorld(true);
        console.log(`[JesusSummonSystem] Auto-oriented model using dominant axis ${primary.axis.toUpperCase()}`);
    }

    async _ensureModel() {
        if (this._modelLoaded && this.jesusGroup) {
            return;
        }
        if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
            throw new Error('THREE.GLTFLoader not available');
        }
        if (!this._loader) {
            this._loader = new THREE.GLTFLoader();
        }
        const gltf = await this._loader.loadAsync('/Models/jesus.glb?v=' + Date.now());
        const scene = gltf.scene || gltf.scenes?.[0];
        if (!scene) {
            throw new Error('jesus.glb missing scene');
        }
        scene.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        this._orientModelUpright(scene);

        const bbox = new THREE.Box3().setFromObject(scene);
        const size = bbox.getSize(new THREE.Vector3());
        const targetHeight = 6;
        const scale = targetHeight / Math.max(size.y, 0.0001);
        scene.scale.setScalar(scale);
        const centeredBox = new THREE.Box3().setFromObject(scene);
        const center = centeredBox.getCenter(new THREE.Vector3());
        scene.position.sub(center);
        scene.position.y -= centeredBox.min.y; // place feet at local y=0
        this.jesusHeight = targetHeight;

        this.jesusGroup = new THREE.Group();
        this.jesusGroup.add(scene);
        this.jesusGroup.visible = false;
        this.scene.add(this.jesusGroup);
        this._modelLoaded = true;
        console.log('[JesusSummonSystem] Model loaded');
    }

    _findBestWaterSpawn(center = null, options = {}) {
        const waterLevel = this.waterLevel;
        const searchCenter = center || { x: 0, z: 0 };
        let best = { x: searchCenter.x, z: searchCenter.z, depth: -Infinity };
        const maxRadius = Math.max(4, options.radius ?? 16);
        const step = Math.max(1, options.step ?? 2);
        for (let dx = -maxRadius; dx <= maxRadius; dx += step) {
            for (let dz = -maxRadius; dz <= maxRadius; dz += step) {
                const x = searchCenter.x + dx;
                const z = searchCenter.z + dz;
                const height = this.boardSystem.getUnifiedTerrainHeight(x, z);
                const depth = waterLevel - height;
                if (depth > best.depth) {
                    best = { x, z, depth };
                }
            }
        }
        if (!isFinite(best.depth) || best.depth < 0.2) {
            const fallback = { x: 0, z: 0 };
            const depth = waterLevel - this.boardSystem.getUnifiedTerrainHeight(fallback.x, fallback.z);
            return { ...fallback, depth };
        }
        return best;
    }

    _updateFacing(deltaTime = 0) {
        if (!this.jesusGroup || typeof THREE === 'undefined') return;
        const camera = this._getCamera();
        if (!camera) return;
        const jesusPos = this.jesusGroup.position;
        const dx = camera.position.x - jesusPos.x;
        const dz = camera.position.z - jesusPos.z;
        if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) {
            return;
        }
        const targetAngle = Math.atan2(dx, dz) + this._facingOffset;
        const currentAngle = this.jesusGroup.rotation.y;
        const alpha = Math.min(1, (deltaTime || 0.016) * 1.5);
        this.jesusGroup.rotation.y = this._lerpAngle(currentAngle, targetAngle, alpha);
    }

    _updateRotationAudio() {
        if (!this._rotationHumActive || !window.soundManager || typeof window.soundManager.updateRotationHum !== 'function') {
            return;
        }
        const distance = this._getCameraDistance();
        if (!Number.isFinite(distance)) return;
        window.soundManager.updateRotationHum(distance, 80);
    }

    _getCamera() {
        if (this.boardSystem && this.boardSystem.game && this.boardSystem.game.camera) {
            return this.boardSystem.game.camera;
        }
        if (window.game && window.game.camera) {
            return window.game.camera;
        }
        return null;
    }

    _getCameraDistance() {
        if (!this.jesusGroup || typeof THREE === 'undefined') return null;
        const camera = this._getCamera();
        if (!camera) return null;
        if (!this._tempVec) {
            this._tempVec = new THREE.Vector3();
        }
        this._tempVec.copy(camera.position);
        return this._tempVec.distanceTo(this.jesusGroup.position);
    }

    _lerpAngle(current, target, alpha) {
        let diff = target - current;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        return current + diff * alpha;
    }
}

window.JesusSummonSystem = JesusSummonSystem;
