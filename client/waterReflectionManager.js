/**
 * WaterReflectionManager
 * Renders the scene from a mirrored camera into a render target for planar water reflections.
 */
class WaterReflectionManager {
    constructor(renderer, scene, options = {}) {
        this.renderer = renderer;
        this.scene = scene;

        const width = options.width || 512;
        const height = options.height || 512;
        this._width = width;
        this._height = height;

        this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            colorSpace: THREE.NoColorSpace
        });

        this.mirrorCamera = new THREE.PerspectiveCamera();
        this.textureMatrix = new THREE.Matrix4();

        this._scratchLookDir = new THREE.Vector3();
        this._scratchUp = new THREE.Vector3();
        this._scratchTarget = new THREE.Vector3();

        // Debug canvas to preview reflection texture
        this._debugCanvas = null;
        this._debugVisible = options.debug !== false;
        if (this._debugVisible) {
            this._debugCanvas = document.createElement('canvas');
            this._debugCanvas.width = 128;
            this._debugCanvas.height = 128;
            this._debugCanvas.style.cssText = 'position:fixed;bottom:8px;left:8px;width:128px;height:128px;border:1px solid #0f0;z-index:9999;background:#000;';
            this._debugCanvas.id = 'reflectionDebug';
            document.body.appendChild(this._debugCanvas);
            this._debugCtx = this._debugCanvas.getContext('2d');
        }
    }

    setDebugVisible(visible) {
        this._debugVisible = visible;
        if (!this._debugCanvas) return;
        this._debugCanvas.style.display = visible ? 'block' : 'none';
    }

    /**
     * Update the reflection texture.
     * @param {number} waterLevel - World Y of the water plane.
     * @param {THREE.Camera} camera - Main scene camera.
     * @param {THREE.Object3D} waterMesh - The water mesh to hide during reflection render.
     * @returns {boolean} True if the reflection was updated this frame.
     */
    update(waterLevel, camera, waterMesh) {
        // Skip if camera is underwater
        if (camera.position.y < waterLevel) return false;

        this.mirrorCamera.copy(camera);
        this.mirrorCamera.updateProjectionMatrix();

        // Reflect camera position across the horizontal plane at waterLevel
        this.mirrorCamera.position.copy(camera.position);
        this.mirrorCamera.position.y = 2 * waterLevel - camera.position.y;

        // Reflect look direction
        this._scratchLookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
        this._scratchLookDir.y *= -1;
        this._scratchTarget.copy(this.mirrorCamera.position).add(this._scratchLookDir);

        // Reflect up vector
        this._scratchUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        this._scratchUp.y *= -1;
        this.mirrorCamera.up.copy(this._scratchUp);
        this.mirrorCamera.lookAt(this._scratchTarget);

        this.mirrorCamera.updateMatrixWorld();
        this.mirrorCamera.updateProjectionMatrix();

        // Temporarily hide the water mesh so it doesn't reflect itself
        const wasVisible = waterMesh ? waterMesh.visible : true;
        if (waterMesh) waterMesh.visible = false;

        // Diagnostics: log mirror camera state
        console.log('[REFL] mirror pos=', this.mirrorCamera.position.toArray(), 'target=', this._scratchTarget.toArray(), 'up=', this._scratchUp.toArray());

        // Temporarily make all materials double-sided so the mirror camera
        // (below the water looking up) can see front-facing meshes
        const sideStack = [];
        this.scene.traverse(obj => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach((m, i) => {
                    sideStack.push({ obj, i, side: m.side });
                    m.side = THREE.DoubleSide;
                });
            }
        });
        console.log('[REFL] doubleSided count=', sideStack.length);

        // Render scene to reflection target
        const oldRenderTarget = this.renderer.getRenderTarget();
        const oldViewport = this.renderer.getViewport(new THREE.Vector4());
        const oldScissorTest = this.renderer.getScissorTest();
        const oldClearColor = new THREE.Color();
        this.renderer.getClearColor(oldClearColor);
        const oldClearAlpha = this.renderer.getClearAlpha();

        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.setViewport(0, 0, this._width, this._height);
        this.renderer.setScissorTest(false);
        this.renderer.setClearColor(0xff0000, 1); // RED so we can tell if anything renders
        this.renderer.clear();
        this.renderer.state.buffers.depth.setMask(true);
        this.renderer.render(this.scene, this.mirrorCamera);

        // Read back one pixel for quick validation
        const pixel = new Uint8Array(4);
        this.renderer.readRenderTargetPixels(this.renderTarget, this._width / 2 | 0, this._height / 2 | 0, 1, 1, pixel);
        console.log('[REFL] center pixel=', Array.from(pixel));

        this.renderer.setRenderTarget(oldRenderTarget);
        this.renderer.setViewport(oldViewport.x, oldViewport.y, oldViewport.z, oldViewport.w);
        this.renderer.setScissorTest(oldScissorTest);
        this.renderer.setClearColor(oldClearColor, oldClearAlpha);

        // Restore materials
        sideStack.forEach(entry => {
            const mats = Array.isArray(entry.obj.material) ? entry.obj.material : [entry.obj.material];
            mats[entry.i].side = entry.side;
        });

        // Restore water mesh visibility
        if (waterMesh) waterMesh.visible = wasVisible;

        // Copy reflection texture to debug canvas for visual verification
        if (this._debugCanvas && this._debugVisible) {
            try {
                const pixels = new Uint8Array(this._width * this._height * 4);
                this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, this._width, this._height, pixels);
                // Flip Y because WebGL framebuffers are bottom-up
                const flipped = new Uint8Array(this._width * this._height * 4);
                for (let y = 0; y < this._height; y++) {
                    const srcRow = (this._height - 1 - y) * this._width * 4;
                    const dstRow = y * this._width * 4;
                    for (let x = 0; x < this._width * 4; x++) {
                        flipped[dstRow + x] = pixels[srcRow + x];
                    }
                }
                const imgData = this._debugCtx.createImageData(this._width, this._height);
                imgData.data.set(flipped);
                this._debugCtx.putImageData(imgData, 0, 0);
            } catch (e) {
                // ignore readback errors
            }
        }

        // Build texture matrix: bias * projection * view
        this.textureMatrix.set(
            0.5, 0,   0,   0.5,
            0,   0.5, 0,   0.5,
            0,   0,   0.5, 0.5,
            0,   0,   0,   1
        );
        this.textureMatrix.multiply(this.mirrorCamera.projectionMatrix);
        this.textureMatrix.multiply(this.mirrorCamera.matrixWorldInverse);

        return true;
    }

    get texture() {
        return this.renderTarget.texture;
    }

    dispose() {
        this.renderTarget.dispose();
    }
}
