class WaterReflectionManager {
    constructor(renderer, scene, options = {}) {
        if (typeof THREE === 'undefined') {
            console.warn('[WaterReflection] THREE.js not available, disabling reflections');
            this.enabled = false;
            return;
        }

        this.renderer = renderer || null;
        this.scene = scene || null;
        this.enabled = options.enabled !== false && !!renderer && !!scene;
        this.clipBias = options.clipBias ?? 0.003;
        this.maxDistance = options.maxDistance ?? 48;
        this.maxHeight = options.maxHeight ?? 32;
        this.renderSize = options.size ?? 512;

        this.textureMatrix = new THREE.Matrix4();
        this.mirrorPlane = new THREE.Plane();
        this.normal = new THREE.Vector3();
        this.mirrorWorldPosition = new THREE.Vector3();
        this.cameraWorldPosition = new THREE.Vector3();
        this.rotationMatrix = new THREE.Matrix4();
        this.lookAtPosition = new THREE.Vector3(0, 0, -1);
        this.clipPlaneVector = new THREE.Vector4();
        this.q = new THREE.Vector4();
        this.viewVector = new THREE.Vector3();
        this.target = new THREE.Vector3();
        this.tempVector = new THREE.Vector3();

        this.debugInfo = {
            lastUpdateSuccessful: false,
            lastSkipReason: 'init',
            lastUpdatedTime: (typeof performance !== 'undefined' && performance.now)
                ? performance.now()
                : Date.now()
        };

        if (this.enabled) {
            this.renderTarget = new THREE.WebGLRenderTarget(this.renderSize, this.renderSize, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.UnsignedByteType,
                depthBuffer: true
            });
            this.renderTarget.texture.name = 'WaterReflectionRT';
            this.renderTarget.texture.generateMipmaps = false;

            this.mirrorCamera = new THREE.PerspectiveCamera();
            this.mirrorCamera.matrixAutoUpdate = true;
            this.mirrorCamera.layers.enable(0);
        } else {
            this.renderTarget = null;
            this.mirrorCamera = null;
        }
    }

    static get REFLECTION_LAYER() {
        return 2;
    }

    static markObjectForReflection(object) {
        if (!object || !object.layers) return;
        object.layers.enable(0);
        object.layers.enable(WaterReflectionManager.REFLECTION_LAYER);
        if (typeof object.traverse === 'function') {
            object.traverse((child) => {
                if (child.layers) {
                    child.layers.enable(0);
                    child.layers.enable(WaterReflectionManager.REFLECTION_LAYER);
                }
            });
        }
    }

    get texture() {
        return this.renderTarget ? this.renderTarget.texture : null;
    }

    dispose() {
        if (this.renderTarget) {
            this.renderTarget.dispose();
            this.renderTarget = null;
        }
    }

    update(waterMesh, camera) {
        if (!this.enabled || !this.renderTarget || !waterMesh || !camera) {
            this._markSkip('disabled-or-missing');
            return false;
        }
        if (!waterMesh.visible) {
            this._markSkip('water-hidden');
            return false;
        }

        waterMesh.updateMatrixWorld();
        camera.updateMatrixWorld();

        const planePosition = this.mirrorWorldPosition.setFromMatrixPosition(waterMesh.matrixWorld);
        const cameraPosition = this.cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

        if (this.maxDistance > 0) {
            this.tempVector.copy(camera.position);
            this.tempVector.y = planePosition.y;
            const hDist = this.tempVector.distanceTo(planePosition);
            if (hDist > this.maxDistance) {
                this._markSkip('max-distance');
                return false;
            }
        }

        const vDist = Math.abs(camera.position.y - planePosition.y);
        if (this.maxHeight > 0 && vDist > this.maxHeight) {
            this._markSkip('max-height');
            return false;
        }

        this.rotationMatrix.extractRotation(waterMesh.matrixWorld);
        this.normal.set(0, 1, 0).applyMatrix4(this.rotationMatrix);

        this.viewVector.copy(planePosition).sub(cameraPosition);
        if (this.viewVector.dot(this.normal) > 0) {
            this._markSkip('camera-behind-plane');
            return false;
        }

        this.viewVector.reflect(this.normal).negate();
        this.viewVector.add(planePosition);

        this.rotationMatrix.extractRotation(camera.matrixWorld);
        this.lookAtPosition.set(0, 0, -1).applyMatrix4(this.rotationMatrix);
        this.lookAtPosition.add(cameraPosition);

        this.target.copy(planePosition).sub(this.lookAtPosition);
        this.target.reflect(this.normal).negate();
        this.target.add(planePosition);

        this.mirrorCamera.layers.mask = camera.layers.mask;

        this.mirrorCamera.position.copy(this.viewVector);
        this.mirrorCamera.up.copy(camera.up);
        this.mirrorCamera.up.reflect(this.normal);
        this.mirrorCamera.lookAt(this.target);
        this.mirrorCamera.near = camera.near;
        this.mirrorCamera.far = camera.far;
        this.mirrorCamera.fov = camera.fov;
        this.mirrorCamera.updateProjectionMatrix();
        this.mirrorCamera.updateMatrixWorld();
        this.mirrorCamera.matrixWorldInverse.copy(this.mirrorCamera.matrixWorld).invert();

        this.textureMatrix.set(
            0.5, 0.0, 0.0, 0.5,
            0.0, 0.5, 0.0, 0.5,
            0.0, 0.0, 0.5, 0.5,
            0.0, 0.0, 0.0, 1.0
        );
        this.textureMatrix.multiply(this.mirrorCamera.projectionMatrix);
        this.textureMatrix.multiply(this.mirrorCamera.matrixWorldInverse);
        this.textureMatrix.multiply(waterMesh.matrixWorld);

        this.mirrorPlane.setFromNormalAndCoplanarPoint(this.normal, planePosition);
        this.mirrorPlane.applyMatrix4(this.mirrorCamera.matrixWorldInverse);

        this.clipPlaneVector.set(this.mirrorPlane.normal.x, this.mirrorPlane.normal.y, this.mirrorPlane.normal.z, this.mirrorPlane.constant);

        const projectionMatrix = this.mirrorCamera.projectionMatrix;
        const q = this.q;
        q.x = (Math.sign(this.clipPlaneVector.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
        q.y = (Math.sign(this.clipPlaneVector.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
        q.z = -1.0;
        q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

        const c = this.clipPlaneVector.multiplyScalar(2.0 / this.clipPlaneVector.dot(q));

        projectionMatrix.elements[2] = c.x;
        projectionMatrix.elements[6] = c.y;
        projectionMatrix.elements[10] = c.z + 1.0 - this.clipBias;
        projectionMatrix.elements[14] = c.w;

        const currentRenderTarget = this.renderer.getRenderTarget();
        const currentXrEnabled = this.renderer.xr ? this.renderer.xr.enabled : false;
        const currentShadowAutoUpdate = this.renderer.shadowMap ? this.renderer.shadowMap.autoUpdate : false;

        if (this.renderer.xr) this.renderer.xr.enabled = false;
        if (this.renderer.shadowMap) this.renderer.shadowMap.autoUpdate = false;

        const wasVisible = waterMesh.visible;
        waterMesh.visible = false;

        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.state.buffers.depth.setMask(true);
        this.renderer.clear();
        this.renderer.render(this.scene, this.mirrorCamera);

        waterMesh.visible = wasVisible;

        if (this.renderer.xr) this.renderer.xr.enabled = currentXrEnabled;
        if (this.renderer.shadowMap) this.renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
        this.renderer.setRenderTarget(currentRenderTarget);

        this._markSuccess();
        return true;
    }

    getDebugInfo() {
        return { ...this.debugInfo };
    }

    _markSkip(reason) {
        const timestamp = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        this.debugInfo.lastUpdateSuccessful = false;
        this.debugInfo.lastSkipReason = reason;
        this.debugInfo.lastUpdatedTime = timestamp;
        if (typeof window !== 'undefined') {
            window.__waterReflectionStatus = { ...this.debugInfo };
        }
    }

    _markSuccess() {
        const timestamp = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        this.debugInfo.lastUpdateSuccessful = true;
        this.debugInfo.lastSkipReason = null;
        this.debugInfo.lastUpdatedTime = timestamp;
        if (typeof window !== 'undefined') {
            window.__waterReflectionStatus = { ...this.debugInfo };
        }
    }
}

if (typeof window !== 'undefined') {
    window.WaterReflectionManager = WaterReflectionManager;
}
