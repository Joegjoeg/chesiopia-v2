class TemporalAASystem {
    constructor({ renderer, camera } = {}) {
        if (!renderer || !camera) {
            throw new Error('[TemporalAA] Renderer and camera are required');
        }

        if (typeof THREE === 'undefined') {
            throw new Error('[TemporalAA] THREE.js must be loaded before TemporalAASystem');
        }

        this.renderer = renderer;
        this.camera = camera;
        this._supported = !!(renderer.capabilities && renderer.capabilities.isWebGL2);
        this.enabled = false;
        this.settings = {
            feedbackMin: 0.82,
            feedbackMax: 0.97,
            clampScalar: 1.5,
            jitterSpread: 0.65,
            sharpenStrength: 0.04
        };

        this._size = new THREE.Vector2();
        this.renderer.getDrawingBufferSize(this._size);
        this._pixelRatio = this.renderer.getPixelRatio();

        this._sceneTarget = null;
        this._historyReadTarget = null;
        this._historyWriteTarget = null;
        this._historyValid = false;

        this._taaScene = new THREE.Scene();
        this._taaCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._blitScene = new THREE.Scene();
        this._blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._fullscreenGeometry = new THREE.PlaneGeometry(2, 2);
        this._taaQuad = null;
        this._blitQuad = null;

        this._taaMaterial = null;
        this._blitMaterial = null;

        this._jitterSequence = this._generateHaltonSequence(64);
        this._jitterIndex = 0;
        this._userDisabled = false;

        this._status = {
            historyResets: 0,
            lastResetReason: 'startup',
            accumulatedSamples: 0
        };
    }

    isSupported() {
        return this._supported;
    }

    isActive() {
        return this.enabled && this._supported;
    }

    render(scene, camera) {
        if (!scene || !camera) {
            return;
        }

        if (!this.isActive()) {
            this._clearViewOffset(camera);
            this.renderer.render(scene, camera);
            return;
        }

        this._ensureResources();
        this._applyJitter(camera);

        this.renderer.setRenderTarget(this._sceneTarget);
        this.renderer.render(scene, camera);

        const hasHistory = this._historyValid && this._historyReadTarget;
        this._taaMaterial.uniforms.tCurrent.value = this._sceneTarget.texture;
        this._taaMaterial.uniforms.tHistory.value = hasHistory ? this._historyReadTarget.texture : this._sceneTarget.texture;
        this._taaMaterial.uniforms.hasHistory.value = hasHistory ? 1 : 0;

        this.renderer.setRenderTarget(this._historyWriteTarget);
        this.renderer.render(this._taaScene, this._taaCamera);

        this._blitMaterial.uniforms.tDiffuse.value = this._historyWriteTarget.texture;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this._blitScene, this._blitCamera);

        const tmp = this._historyReadTarget;
        this._historyReadTarget = this._historyWriteTarget;
        this._historyWriteTarget = tmp;
        this._historyValid = true;

        this._status.accumulatedSamples = Math.min(this._status.accumulatedSamples + 1, 65535);

        this._advanceJitter();
        this._clearViewOffset(camera);
    }

    setEnabled(flag) {
        if (!this._supported) {
            console.warn('[TemporalAA] Temporal AA not supported on this device');
            this.enabled = false;
            return false;
        }
        if (this.enabled === flag) {
            return true;
        }
        this.enabled = flag;
        if (flag) {
            this._ensureResources(true);
            this.resetHistory('enabled');
        } else {
            this._disposeRenderTargets();
            this._historyValid = false;
        }
        return true;
    }

    updateSettings(partial = {}) {
        Object.assign(this.settings, partial);
        this._sanitizeSettings();
        if (this._taaMaterial) {
            this._taaMaterial.uniforms.feedbackMin.value = this.settings.feedbackMin;
            this._taaMaterial.uniforms.feedbackMax.value = this.settings.feedbackMax;
            this._taaMaterial.uniforms.clampScalar.value = this.settings.clampScalar;
            this._taaMaterial.uniforms.sharpenStrength.value = this.settings.sharpenStrength;
        }
    }

    resetHistory(reason = 'manual') {
        this._historyValid = false;
        this._status.historyResets += 1;
        this._status.lastResetReason = reason;
        this._status.accumulatedSamples = 0;
    }

    handleResize() {
        this.renderer.getDrawingBufferSize(this._size);
        this._pixelRatio = this.renderer.getPixelRatio();
        if (this.enabled) {
            this._disposeRenderTargets();
            this._ensureRenderTargets();
            this.resetHistory('resize');
        }
    }

    getStatus() {
        return {
            supported: this._supported,
            enabled: this.enabled,
            active: this.isActive() && this._historyValid,
            historyResets: this._status.historyResets,
            lastResetReason: this._status.lastResetReason,
            accumulatedSamples: this._status.accumulatedSamples,
            jitterIndex: this._jitterIndex,
            jitterSpan: this._jitterSequence.length,
            resolution: `${this._size.x}x${this._size.y}`,
            pixelRatio: this._pixelRatio.toFixed(2),
            hasHistory: this._historyValid
        };
    }

    _ensureResources(initializing = false) {
        if (!this._taaMaterial) {
            this._createMaterials();
        }
        if (!this._sceneTarget || !this._historyReadTarget || !this._historyWriteTarget) {
            this._disposeRenderTargets();
            this._ensureRenderTargets();
        }
        if (!this._taaQuad) {
            this._taaQuad = new THREE.Mesh(this._fullscreenGeometry, this._taaMaterial);
            this._taaQuad.frustumCulled = false;
            this._taaScene.add(this._taaQuad);
        }
        if (!this._blitQuad) {
            this._blitQuad = new THREE.Mesh(this._fullscreenGeometry, this._blitMaterial);
            this._blitQuad.frustumCulled = false;
            this._blitScene.add(this._blitQuad);
        }
        if (initializing) {
            this.resetHistory('init');
        }
    }

    _createMaterials() {
        const invRes = new THREE.Vector2(
            this._size.x > 0 ? 1 / this._size.x : 1,
            this._size.y > 0 ? 1 / this._size.y : 1
        );

        this._taaMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tCurrent: { value: null },
                tHistory: { value: null },
                invResolution: { value: invRes },
                feedbackMin: { value: this.settings.feedbackMin },
                feedbackMax: { value: this.settings.feedbackMax },
                clampScalar: { value: this.settings.clampScalar },
                sharpenStrength: { value: this.settings.sharpenStrength },
                hasHistory: { value: 0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D tCurrent;
                uniform sampler2D tHistory;
                uniform vec2 invResolution;
                uniform float feedbackMin;
                uniform float feedbackMax;
                uniform float clampScalar;
                uniform float sharpenStrength;
                uniform float hasHistory;

                vec3 sampleCurrent(vec2 offset) {
                    return texture2D(tCurrent, vUv + offset * invResolution).rgb;
                }

                void main() {
                    vec3 currentColor = sampleCurrent(vec2(0.0));
                    vec3 historyColor = texture2D(tHistory, vUv).rgb;

                    float diff = length(currentColor - historyColor);
                    float diffFactor = clamp(diff * clampScalar, 0.0, 1.0);
                    float historyWeight = mix(feedbackMax, feedbackMin, diffFactor);
                    vec3 blended = (hasHistory > 0.5)
                        ? mix(currentColor, historyColor, historyWeight)
                        : currentColor;

                    vec3 laplacian = currentColor * 4.0
                        - sampleCurrent(vec2(1.0, 0.0))
                        - sampleCurrent(vec2(-1.0, 0.0))
                        - sampleCurrent(vec2(0.0, 1.0))
                        - sampleCurrent(vec2(0.0, -1.0));
                    blended += laplacian * sharpenStrength;

                    gl_FragColor = vec4(clamp(blended, 0.0, 1.0), 1.0);
                }
            `,
            depthTest: false,
            depthWrite: false
        });

        this._blitMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D tDiffuse;
                void main() {
                    gl_FragColor = texture2D(tDiffuse, vUv);
                }
            `,
            depthTest: false,
            depthWrite: false
        });
    }

    _ensureRenderTargets() {
        const params = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
            depthBuffer: false,
            stencilBuffer: false
        };

        this._sceneTarget = new THREE.WebGLRenderTarget(this._size.x, this._size.y, params);
        this._sceneTarget.texture.name = 'taaSceneTarget';
        this._sceneTarget.texture.colorSpace = this.renderer.outputColorSpace || THREE.SRGBColorSpace;

        this._historyReadTarget = new THREE.WebGLRenderTarget(this._size.x, this._size.y, params);
        this._historyReadTarget.texture.name = 'taaHistoryRead';
        this._historyReadTarget.texture.colorSpace = this.renderer.outputColorSpace || THREE.SRGBColorSpace;

        this._historyWriteTarget = new THREE.WebGLRenderTarget(this._size.x, this._size.y, params);
        this._historyWriteTarget.texture.name = 'taaHistoryWrite';
        this._historyWriteTarget.texture.colorSpace = this.renderer.outputColorSpace || THREE.SRGBColorSpace;

        if (this._taaMaterial) {
            this._taaMaterial.uniforms.invResolution.value.set(
                this._size.x > 0 ? 1 / this._size.x : 1,
                this._size.y > 0 ? 1 / this._size.y : 1
            );
        }
    }

    _disposeRenderTargets() {
        [this._sceneTarget, this._historyReadTarget, this._historyWriteTarget].forEach((target) => {
            if (target && target.dispose) {
                target.dispose();
            }
        });
        this._sceneTarget = null;
        this._historyReadTarget = null;
        this._historyWriteTarget = null;
    }

    _applyJitter(camera) {
        if (!camera || !camera.setViewOffset || this._size.x === 0 || this._size.y === 0) {
            return;
        }
        const jitter = this._jitterSequence[this._jitterIndex];
        const offsetX = jitter.x * this.settings.jitterSpread;
        const offsetY = jitter.y * this.settings.jitterSpread;
        camera.setViewOffset(
            this._size.x,
            this._size.y,
            offsetX,
            offsetY,
            this._size.x,
            this._size.y
        );
    }

    _advanceJitter() {
        this._jitterIndex = (this._jitterIndex + 1) % this._jitterSequence.length;
    }

    _clearViewOffset(camera) {
        if (camera && camera.clearViewOffset) {
            camera.clearViewOffset();
        }
    }

    _sanitizeSettings() {
        this.settings.feedbackMin = THREE.MathUtils.clamp(this.settings.feedbackMin, 0.0, 0.99);
        this.settings.feedbackMax = THREE.MathUtils.clamp(this.settings.feedbackMax, this.settings.feedbackMin + 0.001, 0.999);
        this.settings.clampScalar = THREE.MathUtils.clamp(this.settings.clampScalar, 0.1, 4.0);
        this.settings.jitterSpread = THREE.MathUtils.clamp(this.settings.jitterSpread, 0.1, 2.0);
        this.settings.sharpenStrength = THREE.MathUtils.clamp(this.settings.sharpenStrength, 0.0, 0.5);
    }

    _generateHaltonSequence(length) {
        const sequence = [];
        for (let i = 1; i <= length; i++) {
            const x = this._halton(i, 2) - 0.5;
            const y = this._halton(i, 3) - 0.5;
            sequence.push({ x, y });
        }
        return sequence;
    }

    _halton(index, base) {
        let result = 0;
        let f = 1 / base;
        let i = index;
        while (i > 0) {
            result += f * (i % base);
            i = Math.floor(i / base);
            f /= base;
        }
        return result;
    }
}

window.TemporalAASystem = TemporalAASystem;
