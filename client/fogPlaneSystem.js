/**
 * FogPlaneSystem - Rolling quad fog plane with procedural animated splatter texture,
 * circular mask, distance-based transparency, and environmental response.
 *
 * The fog plane is a camera-centered horizontal quad rendered with a custom shader.
 * It uses fBm noise to generate soft splatter patterns that drift with wind,
 * and its density is modulated by humidity, temperature (with diurnal cycle),
 * and wind speed.
 */
class FogPlaneSystem {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.material = null;
        this.geometry = null;

        // Environmental state (rolling averages from server)
        this.envPressure = 0.5;
        this.envHumidity = 0.5;
        this.envTemperature = 0.5; // climate baseline (0-1), NOT diurnal

        // Wind state
        this.windSpeed = 1.0;
        this.windDirection = 0.0; // radians

        // Diurnal cycle state
        this.dayTime = 12.0; // 0-24
        this.diurnalAmplitude = 0.15; // ±15% temp variation

        // Cached computed instantaneous temperature
        this.instantaneousTemp = 0.5;

        // Accumulated UV offset for smooth wind-driven drift
        this.uvOffset = { x: 0, y: 0 };
        this._lastTime = 0;
        this.windVec = { x: 1.0, y: 0.0 };

        // Parameter defaults (will be overridden by parameterSystem)
        this.params = {
            enabled: false,
            height: 0.5,          // meters above water level
            radius: 80.0,         // outer circular mask radius
            innerRadius: 60.0,    // where circular fade begins
            nearDist: 10.0,       // near distance for alpha ramp (transparent)
            farDist: 50.0,        // far distance for alpha ramp (opaque)
            distTransparency: 1.0, // strength of distance-based transparency (0=uniform, 1=full fade)
            density: 1.0,         // overall density multiplier
            windFade: 0.5,        // how much wind reduces fog
            noiseScale: 0.05,     // UV scale for noise
            speed: 0.3,           // animation speed
            color: new THREE.Color('#cccccc'),
            diurnalAmp: 0.15
        };
    }

    init() {
        this._buildShader();
        this._createMesh();
        this.updateParameters();
        console.log('[FogPlaneSystem] Initialized');
    }

    /**
     * Compute diurnal temperature offset.
     * Returns a sinusoidal offset in the range [-diurnalAmplitude, +diurnalAmplitude].
     * Peak warmth at 15:00 (3pm), coldest at 03:00 (3am).
     * The server's envTemperature is a stable climate baseline; we add this
     * client-side diurnal variation so walking into a new area never carries
     * stale "time-of-day" temperature data with it.
     */
    getDiurnalOffset(dayTime) {
        const amp = this.params.diurnalAmp;
        // cos(0) = 1 at 15:00, cos(π) = -1 at 03:00
        return amp * Math.cos((dayTime - 15.0) / 12.0 * Math.PI);
    }

    /**
     * Update the instantaneous temperature that drives fog density.
     * This is called whenever env data or dayTime changes.
     */
    updateInstantaneousTemperature() {
        const offset = this.getDiurnalOffset(this.dayTime);
        let temp = this.envTemperature + offset;
        temp = Math.max(0.0, Math.min(1.0, temp));
        this.instantaneousTemp = temp;
        if (this.material) {
            this.material.uniforms.uTemperature.value = temp;
        }
    }

    setDayTime(dayTime) {
        this.dayTime = dayTime;
        this.updateInstantaneousTemperature();
    }

    setEnvironmentalFields(pressure, humidity, temperature) {
        this.envPressure = pressure;
        this.envHumidity = humidity;
        this.envTemperature = temperature;
        this.updateInstantaneousTemperature();
        if (this.material) {
            this.material.uniforms.uHumidity.value = humidity;
            this.material.uniforms.uPressure.value = pressure;
        }
    }

    setWind(speed, directionRadians) {
        this.windSpeed = speed;
        this.windDirection = directionRadians;
        const wx = Math.cos(directionRadians) * speed;
        const wz = Math.sin(directionRadians) * speed;
        this.windVec.x = wx;
        this.windVec.y = wz;
        if (this.material) {
            this.material.uniforms.uWindVec.value.set(wx, wz);
            this.material.uniforms.uWindSpeed.value = speed;
        }
    }

    updateParameters() {
        const ps = window.parameterSystem;
        if (!ps) return;
        this.params.enabled = ps.getParameter('fogPlaneEnabled');
        this.params.height = ps.getParameter('fogPlaneHeight');
        this.params.radius = ps.getParameter('fogPlaneRadius');
        this.params.innerRadius = ps.getParameter('fogPlaneInnerRadius');
        this.params.nearDist = ps.getParameter('fogPlaneNearDist');
        this.params.farDist = ps.getParameter('fogPlaneFarDist');
        this.params.distTransparency = ps.getParameter('fogPlaneDistTransparency');
        this.params.density = ps.getParameter('fogPlaneDensity');
        this.params.windFade = ps.getParameter('fogPlaneWindFade');
        this.params.noiseScale = ps.getParameter('fogPlaneNoiseScale');
        this.params.speed = ps.getParameter('fogPlaneSpeed');
        this.params.diurnalAmp = ps.getParameter('fogPlaneDiurnalAmp');
        const c = ps.getParameter('fogPlaneColor');
        if (c) this.params.color.set(c);

        if (this.material) {
            this.material.uniforms.uEnabled.value = this.params.enabled ? 1.0 : 0.0;
            this.material.uniforms.uOuterRadius.value = this.params.radius;
            this.material.uniforms.uInnerRadius.value = this.params.innerRadius;
            this.material.uniforms.uNearDist.value = this.params.nearDist;
            this.material.uniforms.uFarDist.value = this.params.farDist;
            this.material.uniforms.uDistTransparency.value = this.params.distTransparency;
            this.material.uniforms.uDensity.value = this.params.density;
            this.material.uniforms.uWindFade.value = this.params.windFade;
            this.material.uniforms.uNoiseScale.value = this.params.noiseScale;
            this.material.uniforms.uSpeed.value = this.params.speed;
            this.material.uniforms.uColor.value.copy(this.params.color);
        }

        if (this.mesh) {
            this.mesh.visible = this.params.enabled;
            // Resize geometry to match radius (scale.x = scale.y for square in XZ)
            const s = this.params.radius * 2.0;
            this.mesh.scale.set(s, s, 1);
        }
    }

    update(camera, time) {
        if (!this.mesh || !this.params.enabled) return;

        // Keep plane centered on camera XZ
        const y = this.params.height;
        this.mesh.position.set(camera.position.x, y, camera.position.z);

        // Smooth wind-driven UV drift: accumulate offset each frame.
        // Using totalTime * windVec snaps the pattern when wind changes;
        // accumulating avoids that positional leap.
        let dt = 0;
        if (this._lastTime > 0) {
            dt = time - this._lastTime;
        }
        this._lastTime = time;

        if (dt > 0 && dt < 1.0) { // sanity cap for large gaps
            const rate = this.params.speed * 0.3;
            // Negate wind vector: adding UV offset makes texture appear to move opposite,
            // so we subtract to make fog drift WITH the wind.
            this.uvOffset.x -= this.windVec.x * rate * dt;
            this.uvOffset.y -= this.windVec.y * rate * dt;
        }

        if (this.material) {
            this.material.uniforms.uUvOffset.value.set(this.uvOffset.x, this.uvOffset.y);
        }
    }

    _buildShader() {
        const vertexShader = `
            varying vec2 vUv;
            varying vec3 vWorldPos;

            void main() {
                vUv = uv;
                vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            precision mediump float;

            uniform float uEnabled;
            uniform float uOuterRadius;
            uniform float uInnerRadius;
            uniform float uNearDist;
            uniform float uFarDist;
            uniform float uDistTransparency;
            uniform float uDensity;
            uniform float uWindFade;
            uniform float uNoiseScale;
            uniform float uSpeed;
            uniform vec3  uColor;
            uniform float uHumidity;
            uniform float uTemperature;
            uniform float uPressure;
            uniform vec2  uUvOffset;
            uniform vec2  uWindVec;
            uniform float uWindSpeed;

            varying vec2 vUv;
            varying vec3 vWorldPos;

            // Hash & fBm noise
            float hash(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            float fbm(vec2 p) {
                float v = 0.0;
                float a = 0.5;
                vec2 shift = vec2(100.0);
                mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
                for (int i = 0; i < 5; i++) {
                    v += a * noise(p);
                    p = rot * p * 2.0 + shift;
                    a *= 0.5;
                }
                return v;
            }

            void main() {
                if (uEnabled < 0.5) {
                    discard;
                }

                // Per-fragment radial distance from camera (center of fog plane)
                float distXZ = length(vWorldPos.xz - cameraPosition.xz);

                // Circular mask: fade from inner radius to outer radius
                float circleMask = 1.0 - smoothstep(uInnerRadius, uOuterRadius, distXZ);

                // Distance alpha: transparent near camera, opaque far away
                float distAlpha = mix(1.0, smoothstep(uNearDist, uFarDist, distXZ), uDistTransparency);

                // Wind-driven UV drift (smoothly accumulated on CPU)
                vec2 uv = vWorldPos.xz * uNoiseScale;
                vec2 drift = uUvOffset;

                // Multi-octave splatter noise
                float n1 = fbm(uv * 0.6 + drift + vec2(13.7, 47.3));
                float n2 = fbm(uv * 1.2 - drift * 0.7 + vec2(91.0, 13.0));
                float n3 = fbm(uv * 2.4 + drift * 0.3 + vec2(31.0, 57.0));

                // Soft splatter pattern
                float splatter = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
                // Threshold to create variable patchiness
                splatter = smoothstep(0.35, 0.7, splatter);

                // Environmental density:
                // - More humidity = more fog
                // - Higher temperature = less fog (evaporation)
                // - More wind = blows fog away
                float windReduction = clamp(uWindSpeed * uWindFade, 0.0, 0.95);
                float envFog = uHumidity * (1.0 - uTemperature) * (1.0 - windReduction);
                envFog = clamp(envFog, 0.0, 1.0);

                // Pressure can suppress fog (high pressure = clear skies)
                float pressureFactor = mix(0.6, 1.0, 1.0 - uPressure);
                envFog *= pressureFactor;

                // Final alpha composition
                float alpha = circleMask * distAlpha * splatter * envFog * uDensity;

                // Soft fade near edges for smooth blending
                alpha *= smoothstep(0.0, 0.1, circleMask);

                gl_FragColor = vec4(uColor, alpha);
            }
        `;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uEnabled: { value: this.params.enabled ? 1.0 : 0.0 },
                uUvOffset: { value: new THREE.Vector2(0, 0) },
                uOuterRadius: { value: this.params.radius },
                uInnerRadius: { value: this.params.innerRadius },
                uNearDist: { value: this.params.nearDist },
                uFarDist: { value: this.params.farDist },
                uDistTransparency: { value: this.params.distTransparency },
                uDensity: { value: this.params.density },
                uWindFade: { value: this.params.windFade },
                uNoiseScale: { value: this.params.noiseScale },
                uSpeed: { value: this.params.speed },
                uColor: { value: this.params.color },
                uHumidity: { value: 0.5 },
                uTemperature: { value: 0.5 },
                uPressure: { value: 0.5 },
                uWindVec: { value: new THREE.Vector2(1.0, 0.0) },
                uWindSpeed: { value: 1.0 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending
        });
    }

    _createMesh() {
        // Unit plane, scaled in updateParameters to match radius
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = 'fogPlane';
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.renderOrder = 2; // after water (1), before most transparents
        this.mesh.visible = this.params.enabled;
        const s = this.params.radius * 2.0;
        this.mesh.scale.set(s, s, 1);
        this.scene.add(this.mesh);
    }

    dispose() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh = null;
        }
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
    }
}
