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
    }

    get status() {
        if (this._currentAnimation) return 'summoning';
        return this._status;
    }

    async summonJesus() {
        if (!this.boardSystem || !this.scene) {
            console.warn('[JesusSummonSystem] Missing scene or board system');
            return;
        }
        if (this._currentAnimation) {
            console.warn('[JesusSummonSystem] Summon already in progress');
            return;
        }

        await this._ensureModel();

        const spawnPoint = this._findBestWaterSpawn();
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
        this.jesusGroup.rotation.y = Math.PI; // Face the camera by default

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
        console.log('[JesusSummonSystem] Summon started at', centerX, centerZ);
    }

    update(deltaTime = 0) {
        if (!this._currentAnimation) return;

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

        if (progress >= 1) {
            this._status = 'idle';
            this._currentAnimation = null;
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

    _findBestWaterSpawn() {
        const waterLevel = this.waterLevel;
        let best = { x: 0, z: 0, depth: -Infinity };
        const maxRadius = 16;
        const step = 2;
        for (let x = -maxRadius; x <= maxRadius; x += step) {
            for (let z = -maxRadius; z <= maxRadius; z += step) {
                const height = this.boardSystem.getUnifiedTerrainHeight(x, z);
                const depth = waterLevel - height;
                if (depth > best.depth) {
                    best = { x, z, depth };
                }
            }
        }
        if (!isFinite(best.depth) || best.depth < 0.2) {
            // fallback to origin shoreline
            best = { x: 0, z: 0, depth: waterLevel - this.boardSystem.getUnifiedTerrainHeight(0, 0) };
        }
        return best;
    }
}

window.JesusSummonSystem = JesusSummonSystem;
