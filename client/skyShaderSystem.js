/**
 * Sky Shader System - Procedural starfield with orbit fade effect
 * Fades from atmospheric sky gradient to shimmering starfield as camera reaches orbit
 */
class SkyShaderSystem {
    constructor(scene) {
        this.scene = scene;
        
        // Shader configuration
        this.fadeStartHeight = 50;   // Height where stars start appearing
        this.fadeEndHeight = 200;    // Height where stars are fully visible
        this.starDensity = 1000;     // Number of stars
        this.starBrightness = 1.0;   // Overall star brightness
        this.shimmerSpeed = 2.0;     // Twinkle animation speed
        this.shimmerIntensity = 0.3;  // Twinkle intensity
        this.starColor = new THREE.Color(0xffffff); // Star color
        
        // Create sky sphere
        this.skySphere = this.createSkySphere();
        this.scene.add(this.skySphere);
        
        console.log('[SkyShader] System initialized');
    }
    
    createSkySphere() {
        const geometry = new THREE.SphereGeometry(2000, 32, 32);
        
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uCameraHeight: { value: 0.0 },
                uFadeStartHeight: { value: this.fadeStartHeight },
                uFadeEndHeight: { value: this.fadeEndHeight },
                uStarDensity: { value: this.starDensity },
                uStarBrightness: { value: this.starBrightness },
                uShimmerSpeed: { value: this.shimmerSpeed },
                uShimmerIntensity: { value: this.shimmerIntensity },
                uStarColor: { value: this.starColor },
                uSunElevation: { value: 0.0 }, // For sky gradient
                uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
                uSkyTransparency: { value: 1.0 },
                uFogColor: { value: new THREE.Color(0x808080) },
                uFogHorizonStrength: { value: 0.75 },
                uCloudCoverage: { value: 0.0 },
                uLightBlocking: { value: 0.0 }
            },
            vertexShader: `
                varying vec3 vLocalPos;
                varying vec2 vUv;

                void main() {
                    // Sky sphere is centered on camera with no rotation, so local
                    // position is exactly the world-space view direction without
                    // the precision loss of subtracting two large vectors.
                    vLocalPos = position;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform float uTime;
                uniform float uCameraHeight;
                uniform float uFadeStartHeight;
                uniform float uFadeEndHeight;
                uniform float uStarDensity;
                uniform float uStarBrightness;
                uniform float uShimmerSpeed;
                uniform float uShimmerIntensity;
                uniform vec3 uStarColor;
                uniform float uSunElevation;
                uniform vec3 uSunDirection;
                uniform float uSkyTransparency;
                uniform vec3 uFogColor;
                uniform float uFogHorizonStrength;
                uniform float uCloudCoverage;
                uniform float uLightBlocking;

                varying vec3 vLocalPos;
                varying vec2 vUv;
                
                // Hash function for star generation
                float hash(vec2 p) {
                    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
                    p3 += dot(p3, p3.yzx + 33.33);
                    return fract((p3.x + p3.y) * p3.z);
                }
                
                // 2D noise for shimmer
                float noise(vec2 st) {
                    vec2 i = floor(st);
                    vec2 f = fract(st);
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }
                
                // Calculate sky gradient color based on sun elevation
                vec3 getSkyColor(float elevation, vec3 direction) {
                    vec3 nightHorizon = vec3(0.04, 0.04, 0.16);
                    vec3 nightZenith = vec3(0.02, 0.02, 0.08);
                    vec3 noonHorizon = vec3(0.53, 0.81, 0.92);
                    vec3 noonZenith = vec3(0.27, 0.51, 0.71);
                    vec3 dawnHorizon = vec3(0.29, 0.0, 0.51);
                    vec3 dawnZenith = vec3(0.1, 0.1, 0.44);
                    
                    vec3 horizon, zenith;
                    float t = smoothstep(-0.2, 0.5, elevation);
                    
                    if (elevation < -0.2) {
                        horizon = nightHorizon;
                        zenith = nightZenith;
                    } else if (elevation < 0.0) {
                        float tt = smoothstep(-0.2, 0.0, elevation);
                        horizon = mix(nightHorizon, dawnHorizon, tt);
                        zenith = mix(nightZenith, dawnZenith, tt);
                    } else if (elevation < 0.5) {
                        float tt = smoothstep(0.0, 0.5, elevation);
                        horizon = mix(dawnHorizon, noonHorizon, tt);
                        zenith = mix(dawnZenith, noonZenith, tt);
                    } else {
                        horizon = noonHorizon;
                        zenith = noonZenith;
                    }
                    
                    float vertical = abs(direction.y);
                    return mix(horizon, zenith, vertical);
                }
                
                // Convert 3D direction to a 2D hash coordinate
                vec2 dirToHash(vec3 dir) {
                    // Use acos for z and atan for rotation around z
                    float phi = atan(dir.y, dir.x); // -pi to pi
                    float theta = acos(clamp(dir.z, -1.0, 1.0)); // 0 to pi
                    return vec2(phi * 10.0, theta * 10.0);
                }
                
                // Generate a single star at grid cell ij
                float starAt(vec2 ij, vec2 hashCoord, float time) {
                    // Random star position within cell [0,1]
                    vec2 starPos = vec2(
                        hash(ij + vec2(13.0, 7.0)),
                        hash(ij + vec2(7.0, 13.0))
                    );
                    
                    // Only some cells have stars (lower threshold = more stars)
                    float starProb = hash(ij + vec2(3.0, 17.0));
                    if (starProb > 0.3) return 0.0; // 70% of cells have stars
                    
                    // Distance from current pixel to star center (in cell-local coords)
                    vec2 delta = hashCoord - (ij + starPos);
                    float dist = length(delta);
                    
                    // Star size in cell-local units (small = point-like)
                    float starSize = 0.04;
                    float brightness = 1.0 - smoothstep(0.0, starSize, dist);
                    
                    // Twinkle using time
                    float twinklePhase = hash(ij + vec2(19.0, 23.0)) * 6.28;
                    float twinkleSpeed = 0.5 + hash(ij + vec2(31.0, 11.0));
                    float twinkle = 0.7 + 0.3 * sin(time * twinkleSpeed + twinklePhase);
                    
                    return brightness * twinkle;
                }
                
                void main() {
                    // Calculate view direction from camera.
                    // vLocalPos is the sphere vertex in local (world-aligned) coords.
                    // Since the sphere is centered on the camera, this is exactly the
                    // view direction without subtracting two large numbers.
                    vec3 viewDir = normalize(vLocalPos);

                    // Calculate fade factor based on camera height (0 = ground, 1 = orbit)
                    float fadeFactor = smoothstep(uFadeStartHeight, uFadeEndHeight, uCameraHeight);

                    // --- Atmospheric sky (low altitude) ---
                    vec3 atmosSky = getSkyColor(uSunElevation, viewDir);

                    // --- Orbit sky (near-black space with sun glow) ---
                    float sunDot = dot(viewDir, normalize(uSunDirection));
                    // Tight sharp glow around sun, wider faint halo
                    float sunGlow = pow(max(sunDot, 0.0), 256.0) * 0.8
                                  + pow(max(sunDot, 0.0), 16.0) * 0.05;
                    // Blue-white atmospheric rim around sun direction
                    vec3 orbitSky = vec3(0.0, 0.0, 0.005) + vec3(0.4, 0.6, 1.0) * sunGlow;

                    // Apply time-based transparency to atmospheric sky
                    vec3 transparentAtmos = atmosSky * uSkyTransparency;

                    // Mix between atmospheric and orbit sky based on altitude
                    vec3 skyColor = mix(transparentAtmos, orbitSky, fadeFactor);

                    // Generate starfield using direction-based hash stars
                    float starField = 0.0;
                    vec2 hashCoord = dirToHash(viewDir) * uStarDensity * 0.01;
                    vec2 cellId = floor(hashCoord);
                    for (int y = -1; y <= 1; y++) {
                        for (int x = -1; x <= 1; x++) {
                            vec2 neighbor = cellId + vec2(float(x), float(y));
                            starField += starAt(neighbor, hashCoord, uTime * uShimmerSpeed);
                        }
                    }
                    float globalShimmer = mix(1.0 - uShimmerIntensity, 1.0,
                        0.5 + 0.5 * sin(uTime * uShimmerSpeed * 0.3));
                    starField *= globalShimmer;
                    vec3 starColor = uStarColor * uStarBrightness * starField * 4.0;

                    // Add stars on top of sky (fade in with altitude)
                    vec3 finalColor = skyColor + starColor * fadeFactor;

                    // Keep atmospheric gradient at horizon when near ground
                    float horizonFade = smoothstep(0.0, 0.15, abs(viewDir.y));
                    finalColor = mix(skyColor, finalColor, horizonFade);

                    // Blend sky toward fog color at horizon for seamless transition
                    float horizonBlend = 1.0 - smoothstep(0.0, 0.2, abs(viewDir.y));
                    finalColor = mix(finalColor, uFogColor, horizonBlend * uFogHorizonStrength);

                    // Weather: overcast darkening and desaturation
                    finalColor = mix(finalColor, finalColor * 0.5, uCloudCoverage * 0.6);
                    finalColor = mix(finalColor, finalColor * 0.4, uLightBlocking * 0.5);
                    // Desaturate in heavy cloud cover
                    float lum = dot(finalColor, vec3(0.299, 0.587, 0.114));
                    finalColor = mix(finalColor, vec3(lum), uCloudCoverage * 0.5);

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false
        });
        
        const sphere = new THREE.Mesh(geometry, material);
        sphere.renderOrder = -1000; // Render first (background)
        
        return sphere;
    }
    
    update(time, cameraHeight, sunElevation, cameraPosition, sunDirection) {
        if (!this.skySphere || !this.skySphere.material || !this.skySphere.material.uniforms) return;

        // Sky sphere must follow camera so it always appears infinitely far away
        if (cameraPosition) {
            this.skySphere.position.copy(cameraPosition);
        }

        const uniforms = this.skySphere.material.uniforms;
        uniforms.uTime.value = time;
        uniforms.uCameraHeight.value = cameraHeight;
        uniforms.uSunElevation.value = sunElevation;
        if (sunDirection) {
            uniforms.uSunDirection.value.copy(sunDirection);
        }
        
        // Debug logging disabled — re-enable by setting this.debug = true
        // const now = performance.now();
        // if (this.debug && (!this._lastDebugLog || now - this._lastDebugLog > 1000)) {
        //     this._lastDebugLog = now;
        //     const fade = THREE.MathUtils.smoothstep(
        //         cameraHeight, 
        //         uniforms.uFadeStartHeight.value, 
        //         uniforms.uFadeEndHeight.value
        //     );
        //     console.log('[SkyShader] height:', cameraHeight.toFixed(1), 
        //                 '| fade:', fade.toFixed(2), 
        //                 '| sun:', sunElevation.toFixed(2),
        //                 '| visible:', this.skySphere.visible,
        //                 '| fog:', this.scene.fog ? 'ON' : 'OFF');
        // }
    }
    
    setFadeStartHeight(value) {
        this.fadeStartHeight = value;
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uFadeStartHeight.value = value;
        }
    }
    
    setFadeEndHeight(value) {
        this.fadeEndHeight = value;
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uFadeEndHeight.value = value;
        }
    }
    
    setStarDensity(value) {
        this.starDensity = value;
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uStarDensity.value = value;
        }
    }
    
    setStarBrightness(value) {
        this.starBrightness = value;
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uStarBrightness.value = value;
        }
    }
    
    setShimmerSpeed(value) {
        this.shimmerSpeed = value;
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uShimmerSpeed.value = value;
        }
    }
    
    setShimmerIntensity(value) {
        this.shimmerIntensity = value;
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uShimmerIntensity.value = value;
        }
    }
    
    setStarColor(value) {
        this.starColor.set(value);
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uStarColor.value.copy(this.starColor);
        }
    }

    setSkyTransparency(value) {
        this.skyTransparency = value;
        if (this.skySphere?.material?.uniforms) {
            this.skySphere.material.uniforms.uSkyTransparency.value = value;
        }
    }

    setWeatherSnapshot(snapshot) {
        if (!this.skySphere?.material?.uniforms || !snapshot) return;
        const u = this.skySphere.material.uniforms;
        const ps = window.parameterSystem;
        const cloudScale = ps ? ps.getParameter('weatherCloudCoverageScale') : 1.0;
        const blockScale = ps ? ps.getParameter('weatherLightBlockingIntensity') : 1.0;
        if (u.uCloudCoverage) u.uCloudCoverage.value = snapshot.cloudCoverage * cloudScale;
        if (u.uLightBlocking) u.uLightBlocking.value = snapshot.lightBlocking * blockScale;
    }

    dispose() {
        if (this.skySphere) {
            this.scene.remove(this.skySphere);
            this.skySphere.geometry.dispose();
            this.skySphere.material.dispose();
            this.skySphere = null;
        }
    }
}
