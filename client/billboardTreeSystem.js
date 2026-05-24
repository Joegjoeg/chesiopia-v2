var UP = window.UP || new THREE.Vector3(0, 1, 0);
window.UP = UP;

class BillboardTreeSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.maxTrees = 1500;
        this.treeCount = 0;
        this.treeData = [];
        this.windField = new Map();
        this.numVariants = 5;
        this._heightSmoothingFactor = 0.25;
        this._currentHeights = null;

        // Global tree size multiplier (controlled by dev tools; applied via shader uniform)
        this.globalTreeSizeMult = 1.0;

        this.windUniforms = {
            uTime: { value: 0 },
            uWindStrength: { value: 0.4 },
            uWindDirection: { value: new THREE.Vector2(1, 0) }
        };

        this.parts = [];
        this._ready = false;
        this._pendingTrees = [];
        this._readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });

        this._scratchMatrix = new THREE.Matrix4();
        this._scratchPos = new THREE.Vector3();
        this._scratchQuat = new THREE.Quaternion();
        this._scratchScale = new THREE.Vector3();

        this._initAsync();
    }

    async _initAsync() {
        try {
            await this._loadAndBuildAtlas();
            this._createParts();
            this.parts.forEach(p => this.scene.add(p.mesh));
            this._ready = true;
            if (this._resolveReady) this._resolveReady();
            console.log('[BillboardTreeSystem] Ready with ' + this.numVariants + ' variants');
            for (const args of this._pendingTrees) {
                this.addTree(args[0], args[1], args[2], args[3] || {});
            }
            this._pendingTrees = [];
        } catch (err) {
            console.error('[BillboardTreeSystem] Init failed:', err);
        }
    }

    async _loadAndBuildAtlas() {
        const texSize = 256;
        const atlasW = texSize * this.numVariants;
        const atlasH = texSize;
        const atlasCanvas = document.createElement('canvas');
        atlasCanvas.width = atlasW;
        atlasCanvas.height = atlasH;
        const ctx = atlasCanvas.getContext('2d');

        const offRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        offRenderer.setSize(texSize, texSize);
        offRenderer.setPixelRatio(1);
        offRenderer.setClearColor(0x000000, 0);

        const offScene = new THREE.Scene();
        const offCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
        offCamera.position.set(0, 1.8, 4.5);
        offCamera.lookAt(0, 1.5, 0);

        offScene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dl = new THREE.DirectionalLight(0xffffff, 1.0);
        dl.position.set(2, 5, 3);
        offScene.add(dl);

        const loader = new THREE.GLTFLoader();
        for (let i = 0; i < this.numVariants; i++) {
            let modelRoot;
            try {
                const gltf = await loader.loadAsync('../Models/Trees/Aspen' + (i + 1) + '.glb');
                modelRoot = gltf.scene;
            } catch (e) {
                modelRoot = this._fallbackTree(i);
            }
            const box = new THREE.Box3().setFromObject(modelRoot);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const s = 2.2 / maxDim;
            modelRoot.scale.setScalar(s);
            modelRoot.position.set(-center.x * s, -center.y * s + 0.1, -center.z * s);

            offScene.add(modelRoot);
            offRenderer.render(offScene, offCamera);
            offScene.remove(modelRoot);
            ctx.drawImage(offRenderer.domElement, i * texSize, 0);
        }
        offRenderer.dispose();

        this.atlasTexture = new THREE.CanvasTexture(atlasCanvas);
        this.atlasTexture.colorSpace = THREE.SRGBColorSpace;
        this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.atlasTexture.magFilter = THREE.LinearFilter;
        this.atlasTexture.generateMipmaps = true;
        this.atlasTexture.needsUpdate = true;
        this._variantWidth = 1.0 / this.numVariants;
    }

    _fallbackTree(i) {
        const g = new THREE.Group();
        const tg = new THREE.CylinderGeometry(0.08, 0.12, 1.4, 6);
        tg.translate(0, 0.7, 0);
        g.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 0.9 })));
        const hues = [0x4a8c3f, 0x5aaa32, 0x3d7a2e, 0x6bbb44, 0x4a9a38];
        const fg = new THREE.SphereGeometry(0.7, 8, 6);
        fg.translate(0, 1.7, 0);
        g.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: hues[i], roughness: 0.7 })));
        return g;
    }

    _createParts() {
        const planeGeo = new THREE.PlaneGeometry(1.8, 2.8, 1, 1);
        planeGeo.translate(0, 1.4, 0);
        const planeMat = this._createBillboardShaderMaterial();
        const planeMesh = this._makeInstancedMesh(planeGeo, planeMat, true);
        planeMesh.renderOrder = 2;
        this.parts = [{
            name: 'billboard',
            mesh: planeMesh,
            offset: { x: 0, y: 0, z: 0 },
            scaleY: 1.0
        }];
    }

    _createBillboardShaderMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                map: { value: this.atlasTexture },
                uVariantWidth: { value: this._variantWidth },
                lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                ambient: { value: 0.65 },
                uTime: this.windUniforms.uTime,
                uWindStrength: this.windUniforms.uWindStrength,
                uWindDirection: this.windUniforms.uWindDirection,
                uSwayMult: { value: 0.06 },
                uWindHeightPower: { value: 2.0 },
                uSunIntensity: { value: 1.0 },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 },
                uCameraHeight: { value: 0 },
                uCameraWorldPos: { value: new THREE.Vector3() },
                uStretchMin: { value: 1.0 },
                uStretchMax: { value: 6.0 },
                uStretchStartH: { value: 5.0 },
                uStretchEndH: { value: 40.0 },
                uTreeSizeMult: { value: 1.0 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                attribute float aWindPhase;
                attribute float aWindMultiplier;
                attribute float aTreeVariant;
                uniform float uTime;
                uniform float uWindStrength;
                uniform vec2 uWindDirection;
                uniform float uSwayMult;
                uniform float uWindHeightPower;
                uniform float uVariantWidth;
                uniform float uCameraHeight;
                uniform float uStretchMin;
                uniform float uStretchMax;
                uniform float uStretchStartH;
                uniform float uStretchEndH;
                uniform float uTreeSizeMult;
                uniform vec3 uCameraWorldPos;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;

                void main() {
                    float variant = aTreeVariant;
                    vec2 uvBase = uv;
                    uvBase.x = uvBase.x * uVariantWidth + variant * uVariantWidth;
                    vUv = uvBase;

                    // Extract instance center, scale, and terrain normal from instanceMatrix
                    vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
                    float scaleX = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
                    float scaleY = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
                    vec3 terrainNormal = normalize(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));

                    // Camera direction
                    vec3 toCam = normalize(uCameraWorldPos - center);

                    // Cylindrical billboard basis around terrainNormal
                    vec3 right = cross(terrainNormal, toCam);
                    float rightLen = length(right);
                    if (rightLen < 0.001) {
                        // Camera directly above/below -- use arbitrary horizontal axis
                        right = normalize(cross(terrainNormal, vec3(1.0, 0.0, 0.0)));
                    } else {
                        right = normalize(right);
                    }
                    vec3 forward = cross(right, terrainNormal); // points toward camera

                    // Camera-height stretch (compensates for foreshortening when viewed from above)
                    float stretchRange = uStretchEndH - uStretchStartH;
                    float stretchT = 0.0;
                    if (uCameraHeight >= uStretchEndH) {
                        stretchT = 1.0;
                    } else if (uCameraHeight > uStretchStartH && stretchRange > 0.001) {
                        stretchT = clamp((uCameraHeight - uStretchStartH) / stretchRange, 0.0, 1.0);
                        stretchT = stretchT * stretchT * (3.0 - 2.0 * stretchT);
                    }
                    float stretchY = mix(uStretchMin, uStretchMax, stretchT);

                    // Apply global size multiplier to local vertex position
                    vec3 sizedPos = position * uTreeSizeMult;

                    // Billboard the vertex: local X -> right, local Y -> terrainNormal
                    vec3 billboardPos = center + right * (sizedPos.x * scaleX) + terrainNormal * (sizedPos.y * scaleY * stretchY);

                    // Wind sway
                    float hRel = max(0.0, billboardPos.y - center.y);
                    float hNorm = clamp(hRel * 0.08, 0.0, 1.0);
                    float phase = aWindPhase + sizedPos.x * 0.5 + sizedPos.z * 0.3;
                    billboardPos.x += sin(uTime * 1.8 + phase) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.15 * uSwayMult * aWindMultiplier;
                    billboardPos.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.10 * uSwayMult * aWindMultiplier;

                    // World normal follows terrain tilt for consistent diffuse lighting
                    vWorldNormal = terrainNormal;
                    vWorldPos = billboardPos;
                    vec4 mvPosition = viewMatrix * vec4(billboardPos, 1.0);
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

                void main() {
                    vec4 texel = texture2D(map, vUv);
                    float alpha = texel.a;
                    if (alpha < 0.08) discard;
                    vec3 n = normalize(vWorldNormal);
                    float diff = max(dot(n, lightDir), 0.0);
                    vec3 litColor = texel.rgb * (ambient + diff * (1.0 - ambient)) * uSunIntensity;
                    gl_FragColor = vec4(litColor, alpha);
                    #include <fog_fragment>
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            alphaTest: 0.08,
            fog: true
        });
    }

    _makeInstancedMesh(geometry, material, needsWind) {
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxTrees);
        mesh.name = 'billboardTree';
        mesh.count = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        if (needsWind) {
            const phases = new Float32Array(this.maxTrees);
            const windMults = new Float32Array(this.maxTrees);
            const variants = new Float32Array(this.maxTrees);
            for (let i = 0; i < this.maxTrees; i++) {
                phases[i] = Math.random() * Math.PI * 2;
                windMults[i] = 1.0;
                variants[i] = 0;
            }
            mesh.geometry.setAttribute('aWindPhase', new THREE.InstancedBufferAttribute(phases, 1));
            mesh.geometry.setAttribute('aWindMultiplier', new THREE.InstancedBufferAttribute(windMults, 1));
            mesh.geometry.setAttribute('aTreeVariant', new THREE.InstancedBufferAttribute(variants, 1));
        }
        return mesh;
    }

    addTree(worldX, worldZ, terrainHeight, metadata = {}) {
        if (!this._ready) {
            this._pendingTrees.push([worldX, worldZ, terrainHeight, metadata]);
            return -1;
        }
        if (this.treeCount >= this.maxTrees) return -1;

        const i = this.treeCount;
        const variant = Math.floor(Math.random() * this.numVariants);
        const maxScale = metadata.maxScale || 1.0;
        const scale = (0.9 + Math.random() * 0.5) * maxScale;

        const board = window.game && window.game.boardSystem;
        const normal = (board && board.getTerrainNormal)
            ? board.getTerrainNormal(worldX, worldZ)
            : new THREE.Vector3(0, 1, 0);

        this.treeData.push({ x: worldX, z: worldZ, y: terrainHeight, scale, variant, normal: normal.clone(), biome: metadata.biome, growthRate: metadata.growthRate });

        if (!this._currentHeights) {
            this._currentHeights = new Float32Array(this.maxTrees);
        }
        this._currentHeights[i] = terrainHeight;

        const tileX = Math.floor(worldX);
        const tileZ = Math.floor(worldZ);
        const windMult = this.windField.get(tileX + ',' + tileZ) || 1.0;

        this._scratchQuat.setFromUnitVectors(UP, normal);

        for (const part of this.parts) {
            this._scratchPos.set(worldX, terrainHeight, worldZ);
            this._scratchScale.set(scale, scale, scale);
            this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);
            part.mesh.setMatrixAt(i, this._scratchMatrix);
            const attr = part.mesh.geometry.attributes;
            if (attr.aWindMultiplier) attr.aWindMultiplier.setX(i, windMult);
            if (attr.aTreeVariant) attr.aTreeVariant.setX(i, variant);
        }

        this.treeCount++;
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
            part.mesh.instanceMatrix.needsUpdate = true;
            if (part.mesh.geometry.attributes.aWindMultiplier) {
                part.mesh.geometry.attributes.aWindMultiplier.needsUpdate = true;
            }
            if (part.mesh.geometry.attributes.aTreeVariant) {
                part.mesh.geometry.attributes.aTreeVariant.needsUpdate = true;
            }
        }
        return i;
    }

    updateTreeInstanceMatrix(i, tree) {
        const normal = tree.normal || UP;
        this._scratchQuat.setFromUnitVectors(UP, normal);
        for (const part of this.parts) {
            this._scratchPos.set(tree.x, tree.y, tree.z);
            this._scratchScale.set(tree.scale, tree.scale, tree.scale);
            this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);
            part.mesh.setMatrixAt(i, this._scratchMatrix);
            part.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    updateTreeHeights() {
        if (this.treeCount === 0 || !this._currentHeights) return;
        const board = window.game && window.game.boardSystem;
        const camera = window.game && window.game.camera;
        if (!board || !camera) return;
        const meshExtent = 96;
        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];
            if (!tree || tree._lodVisible === false) continue;
            const dx = Math.abs(tree.x - camera.position.x);
            const dz = Math.abs(tree.z - camera.position.z);
            let targetHeight;
            if (dx <= meshExtent && dz <= meshExtent) {
                targetHeight = board.getUnifiedTerrainHeight(tree.x, tree.z);
            } else {
                targetHeight = this._currentHeights[i] || tree.y;
            }
            const newHeight = this._currentHeights[i] + (targetHeight - this._currentHeights[i]) * this._heightSmoothingFactor;
            this._currentHeights[i] = newHeight;
            if (board.getTerrainNormal) {
                tree.normal = board.getTerrainNormal(tree.x, tree.z).clone();
            }
            tree.y = newHeight;
            this.updateTreeInstanceMatrix(i, tree);
        }
    }

    setGlobalTreeSizeMult(value) {
        this.globalTreeSizeMult = value;
        for (const part of this.parts) {
            if (part.mesh && part.mesh.material && part.mesh.material.uniforms && part.mesh.material.uniforms.uTreeSizeMult) {
                part.mesh.material.uniforms.uTreeSizeMult.value = value;
            }
        }
    }

    update(timeSec, windStrength, windDirection) {
        this.windUniforms.uTime.value = timeSec;
        this.windUniforms.uWindStrength.value = (windStrength != null ? windStrength : 0.6) * 0.5;
        if (windDirection != null) {
            this.windUniforms.uWindDirection.value.set(windDirection.x || 1, windDirection.y || 0);
        }

        const bs = window.boardSystem;
        if (bs && bs.sun && bs.moon) {
            const sunInt = bs.sun.light ? bs.sun.light.intensity : 0;
            const moonInt = bs.moon.light ? bs.moon.light.intensity : 0;
            const totalInt = Math.max(0.15, sunInt + moonInt * 0.4);
            const sunElev = Math.sin(bs.sun.angle);
            const amb = sunElev > 0 ? 0.55 : 0.2;
            for (const part of this.parts) {
                const u = part.mesh.material.uniforms;
                if (u.uSunIntensity) u.uSunIntensity.value = totalInt;
                if (u.ambient) u.ambient.value = amb;
            }
        }

        const camera = window.game && window.game.camera;
        if (camera && this.parts.length > 0) {
            const terrainH = bs && bs.getTerrainHeight
                ? bs.getTerrainHeight(camera.position.x, camera.position.z) : 0;
            const camH = Math.max(0, camera.position.y - terrainH);
            for (const part of this.parts) {
                const u = part.mesh.material.uniforms;
                if (u.uCameraHeight) u.uCameraHeight.value = camH;
                if (u.uCameraWorldPos) u.uCameraWorldPos.value.copy(camera.position);
            }
        }

        this.updateTreeHeights();
    }

    clear() {
        this.treeCount = 0;
        this.treeData.length = 0;
        for (const part of this.parts) {
            part.mesh.count = 0;
            part.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    /** Remove a single tree by index using swap-with-last for O(1) removal. */
    removeTree(index) {
        if (index < 0 || index >= this.treeCount) return null;
        const removed = this.treeData[index];
        const lastIndex = this.treeCount - 1;
        if (index !== lastIndex) {
            const moved = this.treeData[lastIndex];
            this.treeData[index] = moved;
            this._currentHeights[index] = this._currentHeights[lastIndex];
            for (const part of this.parts) {
                const attr = part.mesh.geometry.attributes.aWindMultiplier;
                if (attr) attr.setX(index, attr.getX(lastIndex));
                const attr2 = part.mesh.geometry.attributes.aTreeVariant;
                if (attr2) attr2.setX(index, attr2.getX(lastIndex));
            }
            this.updateTreeInstanceMatrix(index, moved);
        }
        this.treeData.length = lastIndex;
        this.treeCount = lastIndex;
        for (const part of this.parts) {
            part.mesh.count = this.treeCount;
        }
        return removed;
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
        if (this.atlasTexture) this.atlasTexture.dispose();
    }

    getTreeCount() { return this.treeCount; }

    hasTreeAt(worldX, worldZ) {
        const fx = Math.floor(worldX);
        const fz = Math.floor(worldZ);
        for (const t of this.treeData) {
            if (Math.floor(t.x) === fx && Math.floor(t.z) === fz) return true;
        }
        return false;
    }

    computeWindField() {
        const board = window.game && window.game.boardSystem;
        if (!board || !board.computeTreeWindField) return;
        board.computeTreeWindField(this.treeData, this.windField);
    }

    setSeason(season) {
        this.currentSeason = season;
    }

    whenReady() {
        return this._readyPromise;
    }
}
