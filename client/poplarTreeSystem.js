var UP = window.UP || new THREE.Vector3(0, 1, 0);
window.UP = UP;

// PoplarTreeSystem
// Instanced poplar trees using three equally-spaced vertical planes
// around a central trunk, textured with tree.jpg. Shares wind and
// terrain-tilt behaviour with TerrainTreeSystem and GrowingTreeSystem.

class PoplarTreeSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;

        this.maxTrees = 1500;
        this.treeCount = 0;
        this.treeData = []; // {x, y, z, scale, rotY}
        this.windField = new Map();
        this.parts = [];

        this._heightSmoothingFactor = 0.25;
        this._currentHeights = null;
        this.currentSeason = 'summer';

        this.windUniforms = {
            uTime:          { value: 0 },
            uWindStrength:  { value: 0.4 },
            uWindDirection: { value: new THREE.Vector2(1, 0) }
        };

        // Load the tree sprite texture
        this.treeTexture = new THREE.TextureLoader().load('../Images/tree.jpg');
        this.treeTexture.colorSpace = THREE.SRGBColorSpace;

        // Shared per-tree wind attributes so all planes on one tree sway together
        this._sharedWindPhases = new Float32Array(this.maxTrees);
        this._sharedWindMultipliers = new Float32Array(this.maxTrees);
        for (let i = 0; i < this.maxTrees; i++) {
            this._sharedWindPhases[i] = Math.random() * Math.PI * 2;
            this._sharedWindMultipliers[i] = 1.0;
        }

        // Shared per-instance circular fade (1.0 = fully visible, 0.0 = invisible)
        this._sharedFade = new Float32Array(this.maxTrees);
        for (let i = 0; i < this.maxTrees; i++) {
            this._sharedFade[i] = 1.0;
        }

        this._createParts();
        this.parts.forEach(p => this.scene.add(p.mesh));

        // Shared scratch objects
        this._scratchMatrix = new THREE.Matrix4();
        this._scratchPos    = new THREE.Vector3();
        this._scratchQuat   = new THREE.Quaternion();
        this._scratchScale  = new THREE.Vector3();
        this._scratchEuler  = new THREE.Euler();

        console.log('[PoplarTreeSystem] Initialized (capacity ' + this.maxTrees + ')');
    }

    _createParts() {
        const parts = [];

        // --- THREE VERTICAL PLANES ---
        const planeAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
        for (let i = 0; i < 3; i++) {
            const planeGeo = new THREE.PlaneGeometry(2.2, 2.6, 1, 1);
            planeGeo.translate(0, 1.3, 0); // base at y=0
            planeGeo.rotateY(planeAngles[i]);
            const planeMat = this._createPlaneShaderMaterial(0.05);
            const planeMesh = this._makeInstancedMesh(planeGeo, planeMat, true);
            planeMesh.renderOrder = 2; // ensure foliage draws after transparent water plane
            parts.push({
                name: 'plane_' + i,
                mesh: planeMesh,
                offset: { x: 0, y: 0, z: 0 },
                scaleY: 1.0,
                isPlane: true
            });
        }

        this.parts = parts;
    }

    _createPlaneShaderMaterial(swayMult) {
        return new THREE.ShaderMaterial({
            uniforms: {
                map:           { value: this.treeTexture },
                lightDir:      { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                ambient:       { value: 0.65 },
                uTime:         this.windUniforms.uTime,
                uWindStrength: this.windUniforms.uWindStrength,
                uWindDirection: this.windUniforms.uWindDirection,
                uSwayMult:     { value: swayMult },
                uWindHeightPower: { value: 2.0 },
                uSunIntensity: { value: 1.0 },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 },
                uCameraHeight: { value: 0 },
                uDeformStartHeight: { value: 10 },
                uDeformEndHeight: { value: 100 },
                uCameraWorldPos: { value: new THREE.Vector3() },
                uSphereRadius: { value: 180 },
                uEnableSpherical: { value: 1.0 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                attribute float aWindPhase;
                attribute float aWindMultiplier;
                attribute float aFade;

                uniform float uTime;
                uniform float uWindStrength;
                uniform vec2 uWindDirection;
                uniform float uSwayMult;
                uniform float uWindHeightPower;
                uniform float uCameraHeight;
                uniform float uDeformStartHeight;
                uniform float uDeformEndHeight;
                uniform vec3 uCameraWorldPos;
                uniform float uSphereRadius;
                uniform float uEnableSpherical;

                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                varying vec3 vLocalPos;
                varying float vFade;

                void main() {
                    vFade = aFade;
                    vUv = uv;
                    vLocalPos = position;
                    mat4 localToWorld = modelMatrix * instanceMatrix;
                    vWorldNormal = normalize(mat3(localToWorld) * normal);
                    vec4 wp = localToWorld * vec4(position, 1.0);
                    float hRel = max(0.0, wp.y - instanceMatrix[3][1]); float hNorm = clamp(hRel * 0.12, 0.0, 1.0);
                    float phase = aWindPhase + position.x * 0.5 + position.z * 0.3;
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.15 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.10 * uSwayMult * aWindMultiplier;

                    // Spherical deformation (same formula as terrain shader)
                    if (uEnableSpherical > 0.5) {
                        float heightRange = uDeformEndHeight - uDeformStartHeight;
                        float deformFactor = 0.0;
                        if (uCameraHeight >= uDeformEndHeight) {
                            deformFactor = 1.0;
                        } else if (uCameraHeight > uDeformStartHeight) {
                            float t = clamp((uCameraHeight - uDeformStartHeight) / heightRange, 0.0, 1.0);
                            deformFactor = t * t * (3.0 - 2.0 * t);
                        }
                        float terrainHeightAtCamera = uCameraWorldPos.y - uCameraHeight;
                        vec3 sphereCenter = vec3(uCameraWorldPos.x, terrainHeightAtCamera - uSphereRadius, uCameraWorldPos.z);
                        vec2 dXZ = wp.xz - sphereCenter.xz;
                        float horizDist = length(dXZ);
                        vec2 dir = horizDist > 0.001 ? normalize(dXZ) : vec2(0.0);
                        float arcAngle = clamp(horizDist / uSphereRadius, 0.0, 3.14159);
                        float sinA = sin(arcAngle);
                        float cosA = cos(arcAngle);
                        vec3 flatPos = wp.xyz;
                        vec3 spherePos;
                        spherePos.xz = sphereCenter.xz + dir * uSphereRadius * sinA;
                        spherePos.y = sphereCenter.y + uSphereRadius * cosA;
                        wp.xyz = mix(flatPos, spherePos, deformFactor);
                    }

                    vWorldPos = wp.xyz;
                    vec4 mvPosition = viewMatrix * wp;
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                }
            `,
            fragmentShader: `
                precision highp float;
                #include <common>
                #include <fog_pars_fragment>
                uniform sampler2D map;
                uniform vec3 lightDir;
                uniform float ambient;
                uniform float uSunIntensity;

                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                varying vec3 vLocalPos;
                varying float vFade;

                void main() {
                    vec4 texel = texture2D(map, vUv);
                    // Derive alpha from luminance (bright sky/background -> transparent)
                    float lum = max(texel.r, max(texel.g, texel.b));
                    float alpha = 1.0 - smoothstep(0.35, 0.65, lum);
                    alpha = pow(alpha, 1.4);
                    if (alpha < 0.06) discard;
                    vec3 n = normalize(vWorldNormal);
                    float diff = max(dot(n, lightDir), 0.0);
                    vec3 litColor = texel.rgb * (ambient + diff * (1.0 - ambient)) * uSunIntensity;
                    gl_FragColor = vec4(litColor, alpha);
                    #include <fog_fragment>
                    gl_FragColor.a *= vFade;
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            alphaTest: 0.06,
            fog: true
        });
    }

    _createTrunkShaderMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0x5a3f2a) },
                lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                ambient: { value: 0.65 },
                uSunIntensity: { value: 1.0 },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 },
                uCameraHeight: { value: 0 },
                uDeformStartHeight: { value: 10 },
                uDeformEndHeight: { value: 100 },
                uCameraWorldPos: { value: new THREE.Vector3() },
                uSphereRadius: { value: 180 },
                uEnableSpherical: { value: 1.0 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                attribute float aFade;
                varying float vFade;
                varying vec3 vNormal;

                uniform float uCameraHeight;
                uniform float uDeformStartHeight;
                uniform float uDeformEndHeight;
                uniform vec3 uCameraWorldPos;
                uniform float uSphereRadius;
                uniform float uEnableSpherical;

                void main() {
                    vFade = aFade;
                    vNormal = normalize(normalMatrix * normal);
                    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);

                    // Spherical deformation (same formula as terrain shader)
                    if (uEnableSpherical > 0.5) {
                        float heightRange = uDeformEndHeight - uDeformStartHeight;
                        float deformFactor = 0.0;
                        if (uCameraHeight >= uDeformEndHeight) {
                            deformFactor = 1.0;
                        } else if (uCameraHeight > uDeformStartHeight) {
                            float t = clamp((uCameraHeight - uDeformStartHeight) / heightRange, 0.0, 1.0);
                            deformFactor = t * t * (3.0 - 2.0 * t);
                        }
                        float terrainHeightAtCamera = uCameraWorldPos.y - uCameraHeight;
                        vec3 sphereCenter = vec3(uCameraWorldPos.x, terrainHeightAtCamera - uSphereRadius, uCameraWorldPos.z);
                        vec2 dXZ = wp.xz - sphereCenter.xz;
                        float horizDist = length(dXZ);
                        vec2 dir = horizDist > 0.001 ? normalize(dXZ) : vec2(0.0);
                        float arcAngle = clamp(horizDist / uSphereRadius, 0.0, 3.14159);
                        float sinA = sin(arcAngle);
                        float cosA = cos(arcAngle);
                        vec3 flatPos = wp.xyz;
                        vec3 spherePos;
                        spherePos.xz = sphereCenter.xz + dir * uSphereRadius * sinA;
                        spherePos.y = sphereCenter.y + uSphereRadius * cosA;
                        wp.xyz = mix(flatPos, spherePos, deformFactor);
                    }

                    vec4 mvPosition = viewMatrix * wp;
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                }
            `,
            fragmentShader: `
                precision highp float;
                #include <common>
                #include <fog_pars_fragment>
                uniform vec3 color;
                uniform vec3 lightDir;
                uniform float ambient;
                uniform float uSunIntensity;
                varying float vFade;
                varying vec3 vNormal;
                void main() {
                    float diff = max(dot(normalize(vNormal), normalize(lightDir)), 0.0);
                    vec3 lit = color * (ambient + diff * (1.0 - ambient)) * uSunIntensity;
                    gl_FragColor = vec4(lit, 1.0);
                    #include <fog_fragment>
                    gl_FragColor.a *= vFade;
                }
            `,
            transparent: true,
            depthWrite: false,
            fog: true,
            side: THREE.DoubleSide
        });
    }

    _makeInstancedMesh(geometry, material, needsWind = false) {
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxTrees);
        mesh.name = 'poplarTree';
        mesh.count = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // LOD manager handles culling

        // Per-instance circular fade attribute (shared across all parts)
        mesh.geometry.setAttribute('aFade',
            new THREE.InstancedBufferAttribute(this._sharedFade, 1));

        if (needsWind) {
            mesh.geometry.setAttribute('aWindPhase',
                new THREE.InstancedBufferAttribute(this._sharedWindPhases, 1));
            mesh.geometry.setAttribute('aWindMultiplier',
                new THREE.InstancedBufferAttribute(this._sharedWindMultipliers, 1));
        }
        return mesh;
    }

    addTree(worldX, worldZ, terrainHeight) {
        if (this.treeCount >= this.maxTrees) {
            console.warn('[PoplarTreeSystem] Capacity reached (' + this.maxTrees + ')');
            return -1;
        }

        const i = this.treeCount;
        const scale  = 0.85 + Math.random() * 0.45; // 0.85 - 1.30
        const rotY   = Math.random() * Math.PI * 2;

        const board = window.game && window.game.boardSystem;
        const normal = (board && board.getTerrainNormal) ? board.getTerrainNormal(worldX, worldZ) : new THREE.Vector3(0, 1, 0);
        this.treeData.push({ x: worldX, z: worldZ, y: terrainHeight, scale, rotY, normal: normal.clone() });

        if (!this._currentHeights) {
            this._currentHeights = new Float32Array(this.maxTrees);
        }
        this._currentHeights[i] = terrainHeight;

        const tileX = Math.floor(worldX);
        const tileZ = Math.floor(worldZ);
        const windMult = this.windField.get(`${tileX},${tileZ}`) || 1.0;

        this._scratchQuat.setFromAxisAngle(UP, rotY);
        const tiltQuat = new THREE.Quaternion().setFromUnitVectors(UP, normal);
        tiltQuat.multiply(this._scratchQuat);
        this._scratchQuat.copy(tiltQuat);
        this._scratchPos.set(worldX, terrainHeight, worldZ);
        this._scratchScale.set(scale, scale, scale);
        this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);

        for (const part of this.parts) {
            part.mesh.setMatrixAt(i, this._scratchMatrix);
        }
        // Shared wind multiplier: write once since all parts use the same buffer
        this._sharedWindMultipliers[i] = windMult;

        this.treeCount++;
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
            part.mesh.instanceMatrix.needsUpdate = true;
        }
        if (this.parts[0].mesh.geometry.attributes.aWindMultiplier) {
            this.parts[0].mesh.geometry.attributes.aWindMultiplier.needsUpdate = true;
        }

        return i;
    }

    update(timeSec, windStrength, windDirection) {
        this.lastWindDirection = windDirection;
        this.windUniforms.uTime.value = timeSec;
        this.windUniforms.uWindStrength.value = (windStrength != null ? windStrength : 0.6) * 0.5;
        if (windDirection != null) {
            this.windUniforms.uWindDirection.value.set(
                windDirection.x || 1,
                windDirection.y || 0
            );
        }

        // Update lighting uniforms from board day/night cycle
        const bs = window.boardSystem;
        if (bs && bs.sun && bs.sun.light && bs.moon && bs.moon.light) {
            const sunInt = bs.sun.light.intensity;
            const moonInt = bs.moon.light.intensity;
            const totalIntensity = Math.max(0.15, sunInt + moonInt * 0.4);
            const sunElev = Math.sin(bs.sun.angle);
            const lightPos = sunElev > 0 ? bs.sun.light.position : bs.moon.light.position;
            const lightDir = lightPos.clone().normalize();
            const ambient = sunElev > 0 ? 0.55 : 0.2;

            for (const part of this.parts) {
                const mat = part.mesh.material;
                if (mat && mat.uniforms) {
                    if (mat.uniforms.uSunIntensity) mat.uniforms.uSunIntensity.value = totalIntensity;
                    if (mat.uniforms.lightDir) mat.uniforms.lightDir.value.copy(lightDir);
                    if (mat.uniforms.ambient) mat.uniforms.ambient.value = ambient;
                }
            }
        }

        // Update spherical deformation uniforms from texture blending system
        const tbs = window.game && window.game.textureBlendingSystem;
        if (tbs && tbs.shaderMaterial) {
            const src = tbs.shaderMaterial.uniforms;
            for (const part of this.parts) {
                const mat = part.mesh.material;
                if (mat && mat.uniforms) {
                    if (mat.uniforms.uCameraHeight) mat.uniforms.uCameraHeight.value = src.uCameraHeight.value;
                    if (mat.uniforms.uDeformStartHeight) mat.uniforms.uDeformStartHeight.value = src.uDeformStartHeight.value;
                    if (mat.uniforms.uDeformEndHeight) mat.uniforms.uDeformEndHeight.value = src.uDeformEndHeight.value;
                    if (mat.uniforms.uCameraWorldPos) mat.uniforms.uCameraWorldPos.value.copy(src.uCameraWorldPos.value);
                    if (mat.uniforms.uSphereRadius) mat.uniforms.uSphereRadius.value = src.uSphereRadius.value;
                    if (mat.uniforms.uEnableSpherical) mat.uniforms.uEnableSpherical.value = src.uEnableSpherical.value;
                }
            }
        }

        this.updateTreeHeights();
    }

    updateTreeHeights() {
        if (this.treeCount === 0 || !this._currentHeights) return;

        const board = window.game && window.game.boardSystem;
        const camera = window.game && window.game.camera;
        if (!board || !camera) {
            console.warn('[PoplarTreeSystem] No board or camera available');
            return;
        }

        // Get circular fade radii from texture blending system (fresh each frame)
        const tbs = window.game && window.game.textureBlendingSystem;
        const fadeRadii = tbs ? tbs.getFadeRadii() : null;
        const innerRadius = fadeRadii ? fadeRadii.inner : Infinity;
        const outerRadius = fadeRadii ? fadeRadii.outer : Infinity;

        const meshExtent = 96;
        const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;

        let fadeDirty = false;

        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];
            const dx = Math.abs(tree.x - camera.position.x);
            const dz = Math.abs(tree.z - camera.position.z);

            // Compute circular fade based on horizontal distance to camera
            let fade = 1.0;
            if (fadeRadii) {
                const dist = Math.sqrt(
                    (tree.x - camera.position.x) ** 2 +
                    (tree.z - camera.position.z) ** 2
                );
                fade = THREE.MathUtils.smoothstep(outerRadius, innerRadius, dist);
            }
            const oldFade = this._sharedFade[i] !== undefined ? this._sharedFade[i] : 1.0;
            if (Math.abs(fade - oldFade) > 0.001) {
                this._sharedFade[i] = fade;
                fadeDirty = true;
            }

            let targetHeight;
            if (dx <= meshExtent && dz <= meshExtent) {
                targetHeight = board.getUnifiedTerrainHeight(tree.x, tree.z);
            } else {
                targetHeight = this._currentHeights[i] || tree.y;
                if (typeof board.getSquareHeights === 'function') {
                    board.getSquareHeights(tree.x, tree.z).then(height => {
                        if (height < waterCutoff) return;
                        if (this._currentHeights && this._currentHeights[i] !== undefined) {
                            this._currentHeights[i] = height;
                            tree.y = height;
                            this.updateTreeInstanceMatrix(i, tree);
                        }
                    });
                }
            }

            if (targetHeight < waterCutoff) continue;

            const currentHeight = this._currentHeights[i];
            const newHeight = currentHeight + (targetHeight - currentHeight) * this._heightSmoothingFactor;
            this._currentHeights[i] = newHeight;

            if (board.getTerrainNormal) {
                tree.normal = board.getTerrainNormal(tree.x, tree.z).clone();
            }

            tree.y = newHeight;

            // Only update matrix if height or fade changed significantly
            if (Math.abs(newHeight - currentHeight) > 0.01 || Math.abs(fade - oldFade) > 0.01) {
                this.updateTreeInstanceMatrix(i, tree);
            }
        }

        // Upload fade buffer if any fades changed
        if (fadeDirty) {
            for (const part of this.parts) {
                const attr = part.mesh.geometry.attributes.aFade;
                if (attr) attr.needsUpdate = true;
            }
        }
    }

    updateTreeInstanceMatrix(i, tree) {
        const fade = this._sharedFade[i] !== undefined ? this._sharedFade[i] : 1.0;

        if (fade < 0.001) {
            // Fully faded: move off-screen so GPU discards it (avoids zero-scale NaN)
            this._scratchPos.set(tree.x, -9999.0, tree.z);
            this._scratchScale.set(0.0001, 0.0001, 0.0001);
            this._scratchQuat.set(0, 0, 0, 1);
        } else {
            const scale = tree.scale;
            const rotY = tree.rotY;
            const normal = tree.normal || UP;
            this._scratchQuat.setFromUnitVectors(UP, normal);
            const yQuat = new THREE.Quaternion().setFromAxisAngle(UP, rotY);
            this._scratchQuat.multiply(yQuat);
            this._scratchPos.set(tree.x, tree.y, tree.z);
            this._scratchScale.set(scale, scale, scale);
        }

        this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);

        for (const part of this.parts) {
            part.mesh.setMatrixAt(i, this._scratchMatrix);
        }

        for (const part of this.parts) {
            part.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    computeWindField() {
        const board = window.game && window.game.boardSystem;
        if (!board || !board.computeTreeWindField) {
            console.warn('[PoplarTreeSystem] No board wind field computation available');
            return;
        }
        board.computeTreeWindField(this.treeData, this.windField);
        console.log('[PoplarTreeSystem] Wind field computed for', this.windField.size, 'tiles');
    }

    recomputeWindMultipliers() {
        const ps = window.parameterSystem;
        const exposureScale = ps ? (ps.getParameter('windExposureScale')?.value ?? 6.0) : 6.0;
        const shadowStrength = ps ? (ps.getParameter('windShadowStrength')?.value ?? 1.5) : 1.5;
        const wd = this.lastWindDirection || (window.game && window.game.decorativeVisuals && window.game.decorativeVisuals.windDirection) || { x: 1, y: 0 };
        const windDir = new THREE.Vector3(wd.x, 0, wd.y).normalize();
        for (let i = 0; i < this.treeCount; i++) {
            const data = this.treeData[i];
            const normal = data.normal || new THREE.Vector3(0, 1, 0);
            const windwardFactor = Math.max(0, normal.dot(windDir));
            let mult = 1.0 + 0.5 * exposureScale;
            mult *= (0.5 + windwardFactor * shadowStrength);
            const baseMult = this.windField.get(`${Math.floor(data.x)},${Math.floor(data.z)}`) || 1.0;
            mult *= baseMult;
            this._sharedWindMultipliers[i] = mult;
        }
        for (const part of this.parts) {
            const attr = part.mesh.geometry.attributes.aWindMultiplier;
            if (attr) attr.needsUpdate = true;
        }
    }

    clear() {
        this.treeCount = 0;
        this.treeData.length = 0;
        for (const part of this.parts) {
            part.mesh.count = 0;
            part.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    dispose() {
        for (const part of this.parts) {
            this.scene.remove(part.mesh);
            part.mesh.geometry.dispose();
            part.mesh.material.dispose();
        }
        this.parts = [];
        this.treeData = [];
        this.treeCount = 0;
        if (this.treeTexture) this.treeTexture.dispose();
    }

    hasTreeAt(worldX, worldZ) {
        const fx = Math.floor(worldX);
        const fz = Math.floor(worldZ);
        for (const t of this.treeData) {
            if (Math.floor(t.x) === fx && Math.floor(t.z) === fz) return true;
        }
        return false;
    }

    getTreeCount() {
        return this.treeCount;
    }

    setSeason(season) {
        this.currentSeason = season;
        console.log('[PoplarTreeSystem] Season set to', season);
    }
}
