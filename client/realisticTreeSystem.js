var UP = window.UP || new THREE.Vector3(0, 1, 0);
window.UP = UP;

// RealisticTreeSystem
// Loads a high-quality GLB (e.g. CGTrader tree asset), clusters multiple
// trees into variants, bakes leaf flakes into merged InstancedMesh parts,
// and drops leaf detail with camera distance for an automatic LOD effect.

class RealisticTreeSystem {
    constructor(scene, terrainSystem = null) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;

        this.maxTrees = 1500;
        this.leavesPerTree = 20;
        this.treeCount = 0;
        this.treeData = [];
        this.windField = new Map();
        this.parts = [];

        this._ready = false;
        this._resolveReady = null;
        this._readyPromise = new Promise((r) => { this._resolveReady = r; });
        this._pendingTrees = [];

        this._scratchMatrix = new THREE.Matrix4();
        this._scratchPos = new THREE.Vector3();
        this._scratchQuat = new THREE.Quaternion();
        this._scratchScale = new THREE.Vector3();
        this._zeroScaleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        this._leafVisible = new Uint8Array(this.maxTrees);
        this._leafLodCount = new Uint8Array(this.maxTrees);
        this._capacityWarned = false;

        this.leafDropDistance = 90;
        this.globalTreeSizeMult = 1.0;
        this.foliageSizeMult = 1.0;
        this.animationEnabled = true;
        this.maxRenderDistance = 85;

        this.windUniforms = {
            uTime: { value: 0 },
            uWindStrength: { value: 0.3 },
            uWindDirection: { value: new THREE.Vector2(1, 0) }
        };

        this._whiteTexture = null;

        this._initAsync();
    }

    async _initAsync() {
        try {
            await this._loadAndProcessModel();
            this._createParts();
            this.scene.add(this.trunkMesh);
            if (this.leafMesh) this.scene.add(this.leafMesh);
            this._ready = true;
            if (this._resolveReady) this._resolveReady();
            console.log('[RealisticTreeSystem] Ready');
            for (const args of this._pendingTrees) {
                this.addTree(args[0], args[1], args[2], args[3] || {});
            }
            this._pendingTrees = [];
        } catch (err) {
            console.error('[RealisticTreeSystem] Init failed:', err);
        }
    }

    _getWhiteTexture() {
        if (!this._whiteTexture) {
            const c = document.createElement('canvas');
            c.width = 1; c.height = 1;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 1, 1);
            this._whiteTexture = new THREE.CanvasTexture(c);
            this._whiteTexture.colorSpace = THREE.SRGBColorSpace;
        }
        return this._whiteTexture;
    }

    async _loadAndProcessModel() {
        const loader = new THREE.GLTFLoader();
        const gltf = await loader.loadAsync('/Models/Trees/tree%20asset.glb');
        const scene = gltf.scene;
        if (!scene) throw new Error('No scene in GLB');
        scene.updateMatrixWorld(true);

        const meshes = [];
        scene.traverse((child) => {
            if (child.isMesh) {
                if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                meshes.push(child);
            }
        });
        if (meshes.length === 0) throw new Error('No meshes found in GLB');

        // Heuristic leaf detection — look for alpha/transparent, low-poly, double-sided, name hints
        let leafMesh = null;
        let bestLeafScore = -1;
        const trunkMeshes = [];
        for (const m of meshes) {
            const mat = m.material;
            const verts = m.geometry.attributes.position.count;
            const tris = m.geometry.index ? m.geometry.index.count / 3 : verts / 3;
            const hasAlpha = !!(mat && (mat.transparent || (mat.alphaTest && mat.alphaTest > 0) || mat.alphaMap));
            const isBlend = !!(mat && mat.alphaMode === 'BLEND');
            const isDoubleSided = !!(mat && mat.side === THREE.DoubleSide);
            const nameHint = /branch|leaf|flake/i.test(m.name) ? 3 : 0;
            const lowPoly = verts <= 10 ? 2 : verts <= 50 ? 1 : 0;
            const score = (isBlend ? 4 : 0) + (hasAlpha ? 2 : 0) + (isDoubleSided ? 1 : 0) + lowPoly + nameHint;
            if (score > bestLeafScore) {
                bestLeafScore = score;
                leafMesh = m;
            }
        }
        for (const m of meshes) {
            if (m !== leafMesh) trunkMeshes.push(m);
        }

        // Pick the single largest trunk mesh by triangle count (don't merge — too many tris per instance)
        if (trunkMeshes.length === 0) throw new Error('No trunk meshes found');
        trunkMeshes.sort((a, b) => {
            const ta = a.geometry.index ? a.geometry.index.count / 3 : a.geometry.attributes.position.count / 3;
            const tb = b.geometry.index ? b.geometry.index.count / 3 : b.geometry.attributes.position.count / 3;
            return tb - ta;
        });
        this._trunkMesh = trunkMeshes[0];

        this._leafMesh = leafMesh;

        const leafTris = this._leafMesh ? (this._leafMesh.geometry.index ? this._leafMesh.geometry.index.count / 3 : this._leafMesh.geometry.attributes.position.count / 3) : 0;
        const trunkTris = this._trunkMesh.geometry.index ? this._trunkMesh.geometry.index.count / 3 : this._trunkMesh.geometry.attributes.position.count / 3;
        console.log(`[RTS] Meshes: ${meshes.length}. Trunk="${this._trunkMesh.name}" (${Math.round(trunkTris)} tris) Leaf="${this._leafMesh ? this._leafMesh.name : 'none'}" (${Math.round(leafTris)} tris, leafScore=${bestLeafScore})`);

        if (this._leafMesh) {
            const hasUvs = this._leafMesh.geometry.attributes.uv && this._leafMesh.geometry.attributes.uv.count > 0;
            console.log(`[RTS] Leaf mesh UVs: ${hasUvs ? 'present' : 'MISSING'}. Replacing with simplified geometry for instancing.`);
            this._leafMesh.geometry = this._buildSimpleLeafGeometry();
        }
    }

    _createParts() {
        // Trunk
        const trunkGeo = this._trunkMesh.geometry.clone();
        trunkGeo.applyMatrix4(this._trunkMesh.matrixWorld);
        const trunkMat = this._createSolidMaterial([this._trunkMesh]);
        this.trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, this.maxTrees);
        this.trunkMesh.count = 0;
        this.trunkMesh.castShadow = true;
        this.trunkMesh.receiveShadow = true;
        this.trunkMesh.frustumCulled = false;
        this._setupWindAttributes(this.trunkMesh);

        // Leaf cloud
        if (this._leafMesh) {
            const leafGeo = this._leafMesh.geometry.clone();
            leafGeo.applyMatrix4(this._leafMesh.matrixWorld);
            const leafMat = this._createLeafMaterial([this._leafMesh]);
            const leafCapacity = this.maxTrees * this.leavesPerTree;
            this.leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leafCapacity);
            this.leafMesh.count = 0;
            this.leafMesh.castShadow = false;
            this.leafMesh.receiveShadow = true;
            this.leafMesh.frustumCulled = false;
            this.leafMesh.renderOrder = 2;
            this._setupWindAttributes(this.leafMesh);
        } else {
            const dummyGeo = new THREE.BufferGeometry();
            dummyGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
            this.leafMesh = new THREE.InstancedMesh(dummyGeo, new THREE.MeshBasicMaterial({ visible: false }), this.maxTrees);
            this.leafMesh.visible = false;
        }

        this.parts = [
            { name: 'trunk', mesh: this.trunkMesh, isLeaf: false },
            { name: 'leaf', mesh: this.leafMesh, isLeaf: true }
        ];
    }

    _buildSimpleLeafGeometry() {
        // A simple curved leaf quad (8 triangles) that renders cheaply
        // but catches light like a small cluster of leaves
        const geo = new THREE.PlaneGeometry(1.0, 0.7, 2, 2);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            pos.setZ(i, (x * x * 0.35) + (Math.abs(y) * 0.08));
        }
        geo.computeVertexNormals();
        return geo;
    }

    _setupWindAttributes(mesh) {
        const count = mesh.count === 0 ? mesh.instanceMatrix.count : mesh.count;
        const phases = new Float32Array(count);
        const windMults = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            phases[i] = Math.random() * Math.PI * 2;
            windMults[i] = 1.0;
        }
        mesh.geometry.setAttribute('aWindPhase', new THREE.InstancedBufferAttribute(phases, 1));
        mesh.geometry.setAttribute('aWindMultiplier', new THREE.InstancedBufferAttribute(windMults, 1));
    }

    _createSolidMaterial(sourceMeshes) {
        const color = new THREE.Color(0x5a3f2a);
        let map = null;
        for (const m of sourceMeshes) {
            if (m.material) {
                if (m.material.color) color.copy(m.material.color);
                if (m.material.map) map = m.material.map;
            }
        }
        return new THREE.ShaderMaterial({
            uniforms: {
                color: { value: color },
                map: { value: map || this._getWhiteTexture() },
                uUseMap: { value: map ? 1.0 : 0.0 },
                uSunDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                uSunColor: { value: new THREE.Color(1, 1, 1) },
                uSunIntensity: { value: 1.0 },
                uMoonDir: { value: new THREE.Vector3(-0.5, 1.0, -0.3).normalize() },
                uMoonColor: { value: new THREE.Color(0.8, 0.9, 1.0) },
                uMoonIntensity: { value: 0.0 },
                uAmbientColor: { value: new THREE.Color(1, 1, 1) },
                uAmbientIntensity: { value: 0.1 },
                uNightAmbientColor: { value: new THREE.Color(0.16, 0.22, 0.35) },
                uNightAmbientIntensity: { value: 0.02 },
                uTime: this.windUniforms.uTime,
                uWindStrength: this.windUniforms.uWindStrength,
                uWindDirection: this.windUniforms.uWindDirection,
                uSwayMult: { value: 0.008 },
                uWindHeightPower: { value: 2.0 },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 },
                uFogGradientEnabled: { value: 0.0 },
                uFogGradientExponent: { value: 2.0 },
                uFogGradientBias: { value: 0.0 },
                uFogDensity: { value: 1.0 },
                uFogColors: { value: [
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080')
                ]},
                uFogStops: { value: [0.0, 0.25, 0.5, 0.75, 1.0] },
                uFogColorCount: { value: 2 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                attribute float aWindPhase;
                attribute float aWindMultiplier;
                uniform float uTime;
                uniform float uWindStrength;
                uniform vec2 uWindDirection;
                uniform float uSwayMult;
                uniform float uWindHeightPower;
                varying vec3 vNormal;
                varying vec3 vWorldPos;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    mat4 localToWorld = modelMatrix * instanceMatrix;
                    vNormal = normalize(mat3(localToWorld) * normal);
                    vec4 wp = localToWorld * vec4(position, 1.0);
                    float hRel = max(0.0, wp.y - instanceMatrix[3][1]);
                    float hNorm = clamp(hRel * 0.12, 0.0, 1.0);
                    float phase = aWindPhase + position.x * 0.5 + position.z * 0.3;
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.15 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.10 * uSwayMult * aWindMultiplier;
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
                uniform float uFogGradientEnabled;
                uniform float uFogGradientExponent;
                uniform float uFogGradientBias;
                uniform float uFogDensity;
                uniform vec3 uFogColors[5];
                uniform float uFogStops[5];
                uniform int uFogColorCount;

                vec3 getGradientFogColor(float t) {
                    vec3 result = uFogColors[0];
                    if (uFogColorCount <= 1) return result;
                    float s0 = uFogStops[0];
                    float s1 = uFogStops[1];
                    float blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                    result = mix(uFogColors[0], uFogColors[1], blend);
                    if (uFogColorCount >= 3) {
                        s0 = uFogStops[1];
                        s1 = uFogStops[2];
                        if (t >= s0) {
                            blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                            result = mix(uFogColors[1], uFogColors[2], blend);
                        }
                    }
                    if (uFogColorCount >= 4) {
                        s0 = uFogStops[2];
                        s1 = uFogStops[3];
                        if (t >= s0) {
                            blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                            result = mix(uFogColors[2], uFogColors[3], blend);
                        }
                    }
                    if (uFogColorCount >= 5) {
                        s0 = uFogStops[3];
                        s1 = uFogStops[4];
                        if (t >= s0) {
                            blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                            result = mix(uFogColors[3], uFogColors[4], blend);
                        }
                    }
                    return result;
                }
                uniform vec3 color;
                uniform sampler2D map;
                uniform float uUseMap;
                uniform vec3 uSunDir;
                uniform vec3 uSunColor;
                uniform float uSunIntensity;
                uniform vec3 uMoonDir;
                uniform vec3 uMoonColor;
                uniform float uMoonIntensity;
                uniform vec3 uAmbientColor;
                uniform float uAmbientIntensity;
                uniform vec3 uNightAmbientColor;
                uniform float uNightAmbientIntensity;
                varying vec3 vNormal;
                varying vec3 vWorldPos;
                varying vec2 vUv;
                void main() {
                    vec3 normal = normalize(vNormal);
                    float sunDiff = max(dot(normal, uSunDir), 0.0);
                    vec3 sunLight = uSunColor * uSunIntensity * sunDiff;
                    float moonDiff = max(dot(normal, uMoonDir), 0.0);
                    vec3 moonLight = uMoonColor * uMoonIntensity * moonDiff;
                    vec3 ambient = uAmbientColor * uAmbientIntensity + uNightAmbientColor * uNightAmbientIntensity;
                    vec3 lightTotal = ambient + sunLight + moonLight;
                    vec3 baseColor = (uUseMap > 0.5) ? texture2D(map, vUv).rgb : color;
                    vec3 lighting = baseColor * lightTotal;
                    gl_FragColor = vec4(lighting, 1.0);
#ifdef USE_FOG
                    float fogDist = length(vWorldPos - cameraPosition);
                    float fogFactor;
                    vec3 fogColorSample = fogColor;
                    if (uFogGradientEnabled > 0.5) {
                        float normDist = (fogDist - fogNear) / max(fogFar - fogNear, 0.001);
                        normDist = clamp(normDist + uFogGradientBias, 0.0, 1.0);
                        fogFactor = 1.0 - pow(normDist, uFogGradientExponent) * uFogDensity;
                        fogColorSample = getGradientFogColor(normDist);
                    } else {
                        fogFactor = (fogFar - fogDist) / max(fogFar - fogNear, 0.001);
                        fogFactor *= uFogDensity;
                    }
                    fogFactor = clamp(fogFactor, 0.0, 1.0);
                    gl_FragColor.rgb = mix(fogColorSample, gl_FragColor.rgb, fogFactor);
#endif
                }
            `,
            fog: true
        });
    }

    _createLeafMaterial(sourceMeshes) {
        const color = new THREE.Color(0x4a8a2a);
        let map = null;
        for (const m of sourceMeshes) {
            if (m.material) {
                const mm = m.material;
                // Accept any map from the leaf mesh — we only pass leaf meshes here.
                if (!map && mm.map) {
                    map = mm.map;
                    if (map && map.colorSpace !== THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
                }
                // Only trust the material color if it looks like a leaf (green-ish).
                // If the leaf mesh reuses the trunk's brown material, we ignore it.
                if (mm.color) {
                    const c = mm.color;
                    const max = Math.max(c.r, c.g, c.b);
                    const min = Math.min(c.r, c.g, c.b);
                    const delta = max - min;
                    let hue = 0;
                    if (delta !== 0) {
                        if (max === c.r) hue = ((c.g - c.b) / delta) % 6;
                        else if (max === c.g) hue = ((c.b - c.r) / delta) + 2;
                        else hue = ((c.r - c.g) / delta) + 4;
                        hue *= 60;
                        if (hue < 0) hue += 360;
                    }
                    const isGreen = hue >= 60 && hue <= 180 && c.g > c.r && c.g > c.b * 0.8;
                    if (isGreen) color.copy(c);
                }
            }
        }
        return new THREE.ShaderMaterial({
            uniforms: {
                color: { value: color },
                map: { value: map || this._getWhiteTexture() },
                uUseMap: { value: map ? 1.0 : 0.0 },
                uSunDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                uSunColor: { value: new THREE.Color(1, 1, 1) },
                uSunIntensity: { value: 1.0 },
                uMoonDir: { value: new THREE.Vector3(-0.5, 1.0, -0.3).normalize() },
                uMoonColor: { value: new THREE.Color(0.8, 0.9, 1.0) },
                uMoonIntensity: { value: 0.0 },
                uAmbientColor: { value: new THREE.Color(1, 1, 1) },
                uAmbientIntensity: { value: 0.1 },
                uNightAmbientColor: { value: new THREE.Color(0.16, 0.22, 0.35) },
                uNightAmbientIntensity: { value: 0.02 },
                uTime: this.windUniforms.uTime,
                uWindStrength: this.windUniforms.uWindStrength,
                uWindDirection: this.windUniforms.uWindDirection,
                uSwayMult: { value: 0.04 },
                uWindHeightPower: { value: 2.0 },
                edgeSoftness: { value: 3.0 },
                edgeStrength: { value: 0.7 },
                falloffPower: { value: 1.5 },
                falloffStrength: { value: 0.9 },
                uBaseAlpha: { value: 0.55 },
                fogColor: { value: new THREE.Color() },
                fogNear: { value: 0 },
                fogFar: { value: 0 },
                uFogGradientEnabled: { value: 0.0 },
                uFogGradientExponent: { value: 2.0 },
                uFogGradientBias: { value: 0.0 },
                uFogDensity: { value: 1.0 },
                uFogColors: { value: [
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080'),
                    new THREE.Color('#808080')
                ]},
                uFogStops: { value: [0.0, 0.25, 0.5, 0.75, 1.0] },
                uFogColorCount: { value: 2 }
            },
            vertexShader: `
                #include <common>
                #include <fog_pars_vertex>
                attribute float aWindPhase;
                attribute float aWindMultiplier;
                uniform float uTime;
                uniform float uWindStrength;
                uniform vec2 uWindDirection;
                uniform float uSwayMult;
                uniform float uWindHeightPower;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                varying vec3 vLocalPos;
                void main() {
                    vUv = uv;
                    vLocalPos = position;
                    mat4 localToWorld = modelMatrix * instanceMatrix;
                    vWorldNormal = normalize(mat3(localToWorld) * normal);
                    vec4 wp = localToWorld * vec4(position, 1.0);
                    float hRel = max(0.0, wp.y - instanceMatrix[3][1]);
                    float hNorm = clamp(hRel * 0.12, 0.0, 1.0);
                    float phase = aWindPhase + position.x * 0.5 + position.z * 0.3;
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.06 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * pow(hNorm, uWindHeightPower) * 0.04 * uSwayMult * aWindMultiplier;
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
                uniform float uFogGradientEnabled;
                uniform float uFogGradientExponent;
                uniform float uFogGradientBias;
                uniform float uFogDensity;
                uniform vec3 uFogColors[5];
                uniform float uFogStops[5];
                uniform int uFogColorCount;

                vec3 getGradientFogColor(float t) {
                    vec3 result = uFogColors[0];
                    if (uFogColorCount <= 1) return result;
                    float s0 = uFogStops[0];
                    float s1 = uFogStops[1];
                    float blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                    result = mix(uFogColors[0], uFogColors[1], blend);
                    if (uFogColorCount >= 3) {
                        s0 = uFogStops[1];
                        s1 = uFogStops[2];
                        if (t >= s0) {
                            blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                            result = mix(uFogColors[1], uFogColors[2], blend);
                        }
                    }
                    if (uFogColorCount >= 4) {
                        s0 = uFogStops[2];
                        s1 = uFogStops[3];
                        if (t >= s0) {
                            blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                            result = mix(uFogColors[2], uFogColors[3], blend);
                        }
                    }
                    if (uFogColorCount >= 5) {
                        s0 = uFogStops[3];
                        s1 = uFogStops[4];
                        if (t >= s0) {
                            blend = clamp((t - s0) / max(s1 - s0, 0.001), 0.0, 1.0);
                            result = mix(uFogColors[3], uFogColors[4], blend);
                        }
                    }
                    return result;
                }
                uniform sampler2D map;
                uniform vec3 color;
                uniform float uUseMap;
                uniform vec3 uSunDir;
                uniform vec3 uSunColor;
                uniform float uSunIntensity;
                uniform vec3 uMoonDir;
                uniform vec3 uMoonColor;
                uniform float uMoonIntensity;
                uniform vec3 uAmbientColor;
                uniform float uAmbientIntensity;
                uniform vec3 uNightAmbientColor;
                uniform float uNightAmbientIntensity;
                uniform float edgeSoftness;
                uniform float edgeStrength;
                uniform float falloffPower;
                uniform float falloffStrength;
                uniform float uBaseAlpha;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                varying vec3 vLocalPos;
                // Simple pseudo-random noise
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                void main() {
                    vec4 texel = texture2D(map, vUv);
                    vec3 baseTex = texel.rgb;
                    vec3 baseColor = (uUseMap > 0.5) ? mix(baseTex, color, 0.45) : color;
                    float alpha = (uUseMap > 0.5) ? texel.a : 1.0;
                    if (alpha < 0.05) discard;

                    // Procedural oval leaf shape (fallback to local position if UVs missing)
                    vec2 shapeCoord = (vUv.x == 0.0 && vUv.y == 0.0) ? (vLocalPos.xy / vec2(0.5, 0.35)) : (vUv - 0.5) * 2.0;
                    // Elongate vertically to make a leaf oval
                    float ovalDist = length(shapeCoord * vec2(0.8, 1.0));
                    // Soft edge fade — creates the leaf silhouette
                    float shapeAlpha = 1.0 - smoothstep(0.35, 0.95, ovalDist);
                    // Subtle vein line down the middle
                    float vein = 1.0 - smoothstep(0.0, 0.06, abs(shapeCoord.x)) * smoothstep(0.1, 0.4, abs(shapeCoord.y));
                    baseColor = mix(baseColor, baseColor * 1.25, vein * 0.25);
                    // Slight color noise for organic variation
                    float nval = noise(shapeCoord * 6.0);
                    baseColor = mix(baseColor, baseColor * (0.85 + nval * 0.3), 0.2);

                    vec3 n = normalize(vWorldNormal);
                    float sunDiff = max(dot(n, uSunDir), 0.0);
                    vec3 sunLight = uSunColor * uSunIntensity * sunDiff;
                    float moonDiff = max(dot(n, uMoonDir), 0.0);
                    vec3 moonLight = uMoonColor * uMoonIntensity * moonDiff;
                    vec3 ambient = uAmbientColor * uAmbientIntensity + uNightAmbientColor * uNightAmbientIntensity;
                    vec3 lightTotal = ambient + sunLight + moonLight;
                    vec3 litColor = baseColor * lightTotal;
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float fresnel = pow(1.0 - abs(dot(n, viewDir)), edgeSoftness);
                    float edgeAlpha = 1.0 - (fresnel * edgeStrength);
                    float finalAlpha = alpha * edgeAlpha * shapeAlpha * uBaseAlpha;
                    if (finalAlpha < 0.03) discard;
                    gl_FragColor = vec4(litColor, finalAlpha);
#ifdef USE_FOG
                    float fogDist = length(vWorldPos - cameraPosition);
                    float fogFactor;
                    vec3 fogColorSample = fogColor;
                    if (uFogGradientEnabled > 0.5) {
                        float normDist = (fogDist - fogNear) / max(fogFar - fogNear, 0.001);
                        normDist = clamp(normDist + uFogGradientBias, 0.0, 1.0);
                        fogFactor = 1.0 - pow(normDist, uFogGradientExponent) * uFogDensity;
                        fogColorSample = getGradientFogColor(normDist);
                    } else {
                        fogFactor = (fogFar - fogDist) / max(fogFar - fogNear, 0.001);
                        fogFactor *= uFogDensity;
                    }
                    fogFactor = clamp(fogFactor, 0.0, 1.0);
                    gl_FragColor.rgb = mix(fogColorSample, gl_FragColor.rgb, fogFactor);
#endif
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            fog: true
        });
    }

    addTree(worldX, worldZ, terrainHeight, metadata = {}) {
        if (this.treeCount >= this.maxTrees) {
            if (!this._capacityWarned) {
                console.warn('[RealisticTreeSystem] Capacity reached (' + this.maxTrees + ')');
                this._capacityWarned = true;
            }
            return -1;
        }
        if (!this._ready) {
            this._pendingTrees.push([worldX, worldZ, terrainHeight, metadata]);
            return -1;
        }

        const i = this.treeCount;
        const maxScale = metadata.maxScale || 1.0;
        const scale = (0.9 + Math.random() * 0.2) * maxScale;
        const rotY = Math.random() * Math.PI * 2;

        const board = window.game && window.game.boardSystem;
        const ps = window.parameterSystem;
        const upright = ps ? ps.getParameter('treeUpright') : false;
        const normal = upright ? new THREE.Vector3(0, 1, 0)
            : (board && board.getTerrainNormal ? board.getTerrainNormal(worldX, worldZ) : new THREE.Vector3(0, 1, 0));

        const leafSeed = Math.random();
        this.treeData.push({ x: worldX, z: worldZ, y: terrainHeight, scale, rotY, normal: normal.clone(), biome: metadata.biome, leafSeed });
        this._leafVisible[i] = 1;

        const tileX = Math.floor(worldX);
        const tileZ = Math.floor(worldZ);
        const windMult = this.windField.get(`${tileX},${tileZ}`) || 1.0;

        this._scratchQuat.setFromAxisAngle(UP, rotY);
        const tiltQuat = new THREE.Quaternion().setFromUnitVectors(UP, normal);
        tiltQuat.multiply(this._scratchQuat);
        this._scratchQuat.copy(tiltQuat);

        const instanceScale = scale * this.globalTreeSizeMult;

        // Trunk
        this._scratchPos.set(worldX, terrainHeight, worldZ);
        this._scratchScale.set(instanceScale, instanceScale, instanceScale);
        this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);
        this.trunkMesh.setMatrixAt(i, this._scratchMatrix);
        this.trunkMesh.geometry.attributes.aWindMultiplier.setX(i, windMult);

        // Leaf cloud
        if (this._leafMesh) {
            const rng = this._makeRng(leafSeed);
            const canopyRadius = 3.5 * instanceScale;
            const canopyHeight = 7.0 * instanceScale;
            for (let j = 0; j < this.leavesPerTree; j++) {
                const leafIdx = i * this.leavesPerTree + j;
                const theta = rng() * Math.PI * 2;
                const phi = rng() * Math.PI * 0.5;
                const r = canopyRadius * Math.pow(rng(), 1 / 3);
                const lx = r * Math.sin(phi) * Math.cos(theta);
                const ly = canopyHeight + r * Math.cos(phi) * 0.5;
                const lz = r * Math.sin(phi) * Math.sin(theta);
                const lRotY = rng() * Math.PI * 2;
                const lRotX = (rng() - 0.5) * 0.5;
                const lRotZ = (rng() - 0.5) * 0.5;
                const lQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(lRotX, lRotY, lRotZ));
                const lScale = (0.7 + rng() * 0.6) * instanceScale;
                this._scratchPos.set(worldX + lx, terrainHeight + ly, worldZ + lz);
                this._scratchScale.set(lScale, lScale, lScale);
                const finalQuat = this._scratchQuat.clone().multiply(lQuat);
                this._scratchMatrix.compose(this._scratchPos, finalQuat, this._scratchScale);
                this.leafMesh.setMatrixAt(leafIdx, this._scratchMatrix);
                this.leafMesh.geometry.attributes.aWindMultiplier.setX(leafIdx, windMult);
            }
        }

        this.treeCount++;
        this.trunkMesh.count = this.treeCount;
        if (this._leafMesh) this.leafMesh.count = this.treeCount * this.leavesPerTree;

        this.trunkMesh.instanceMatrix.needsUpdate = true;
        if (this.leafMesh) this.leafMesh.instanceMatrix.needsUpdate = true;
        this.trunkMesh.geometry.attributes.aWindMultiplier.needsUpdate = true;
        if (this.leafMesh && this.leafMesh.geometry.attributes.aWindMultiplier) {
            this.leafMesh.geometry.attributes.aWindMultiplier.needsUpdate = true;
        }
        return i;
    }

    _makeRng(seed) {
        let s = seed * 12345;
        return () => {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    removeTree(index) {
        if (index < 0 || index >= this.treeCount) return null;
        const lastIndex = this.treeCount - 1;
        if (index !== lastIndex) {
            const moved = this.treeData[lastIndex];
            this.treeData[index] = moved;
            this._leafVisible[index] = this._leafVisible[lastIndex];
            this._copyTreeInstances(lastIndex, index);
        }
        this.treeData.length = lastIndex;
        this.treeCount = lastIndex;
        this.trunkMesh.count = this.treeCount;
        if (this._leafMesh) this.leafMesh.count = this.treeCount * this.leavesPerTree;
        return this.treeData[index];
    }

    _copyTreeInstances(fromTreeIndex, toTreeIndex) {
        // Trunk
        this.trunkMesh.getMatrixAt(fromTreeIndex, this._scratchMatrix);
        this.trunkMesh.setMatrixAt(toTreeIndex, this._scratchMatrix);
        const w = this.trunkMesh.geometry.attributes.aWindMultiplier;
        if (w) w.setX(toTreeIndex, w.getX(fromTreeIndex));
        // Leaves
        if (this._leafMesh) {
            for (let j = 0; j < this.leavesPerTree; j++) {
                const fromLeaf = fromTreeIndex * this.leavesPerTree + j;
                const toLeaf = toTreeIndex * this.leavesPerTree + j;
                this.leafMesh.getMatrixAt(fromLeaf, this._scratchMatrix);
                this.leafMesh.setMatrixAt(toLeaf, this._scratchMatrix);
                const wl = this.leafMesh.geometry.attributes.aWindMultiplier;
                if (wl) wl.setX(toLeaf, wl.getX(fromLeaf));
            }
        }
    }

    updateTreeInstanceMatrix(i, tree) {
        const scale = tree.scale * this.globalTreeSizeMult;
        const rotY = tree.rotY;
        const height = tree.y;
        const normal = tree.normal || UP;
        this._scratchQuat.setFromUnitVectors(UP, normal);
        const yQuat = new THREE.Quaternion().setFromAxisAngle(UP, rotY);
        this._scratchQuat.multiply(yQuat);

        // Trunk
        this._scratchPos.set(tree.x, height, tree.z);
        this._scratchScale.set(scale, scale, scale);
        this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);
        this.trunkMesh.setMatrixAt(i, this._scratchMatrix);

        // Leaves
        if (this._leafMesh) {
            const rng = this._makeRng(tree.leafSeed);
            const canopyRadius = 3.5 * scale;
            const canopyHeight = 7.0 * scale;
            for (let j = 0; j < this.leavesPerTree; j++) {
                const leafIdx = i * this.leavesPerTree + j;
                if (this._leafVisible[i] === 0) {
                    this.leafMesh.setMatrixAt(leafIdx, this._zeroScaleMatrix);
                    continue;
                }
                const theta = rng() * Math.PI * 2;
                const phi = rng() * Math.PI * 0.5;
                const r = canopyRadius * Math.pow(rng(), 1 / 3);
                const lx = r * Math.sin(phi) * Math.cos(theta);
                const ly = canopyHeight + r * Math.cos(phi) * 0.5;
                const lz = r * Math.sin(phi) * Math.sin(theta);
                const lRotY = rng() * Math.PI * 2;
                const lRotX = (rng() - 0.5) * 0.5;
                const lRotZ = (rng() - 0.5) * 0.5;
                const lQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(lRotX, lRotY, lRotZ));
                const lScale = (0.7 + rng() * 0.6) * scale * (this.foliageSizeMult || 1.0);
                this._scratchPos.set(tree.x + lx, height + ly, tree.z + lz);
                this._scratchScale.set(lScale, lScale, lScale);
                const finalQuat = this._scratchQuat.clone().multiply(lQuat);
                this._scratchMatrix.compose(this._scratchPos, finalQuat, this._scratchScale);
                this.leafMesh.setMatrixAt(leafIdx, this._scratchMatrix);
            }
        }

        this.trunkMesh.instanceMatrix.needsUpdate = true;
        if (this.leafMesh) this.leafMesh.instanceMatrix.needsUpdate = true;
    }

    update(timeSec, windStrength, windDirection) {
        this.windUniforms.uTime.value = timeSec;
        this.windUniforms.uWindStrength.value = (windStrength != null ? windStrength : 0.3);
        if (windDirection != null) {
            this.windUniforms.uWindDirection.value.set(windDirection.x || 1, windDirection.y || 0);
        }

        const bs = window.game && window.game.boardSystem;
        if (bs && bs.sun && bs.sun.light && bs.moon && bs.moon.light) {
            const sunLight = bs.sun.light;
            const moonLight = bs.moon.light;
            const sunInt = sunLight ? sunLight.intensity : 0;
            const moonInt = moonLight ? moonLight.intensity : 0;
            const sunDir = sunLight ? sunLight.position.clone().sub(sunLight.target?.position ?? new THREE.Vector3()).normalize() : new THREE.Vector3(0, 1, 0);
            const moonDir = moonLight ? moonLight.position.clone().sub(moonLight.target?.position ?? new THREE.Vector3()).normalize() : new THREE.Vector3(0, 1, 0);
            for (const part of this.parts) {
                const mat = part.mesh.material;
                if (!mat || !mat.uniforms) continue;
                if (mat.uniforms.uSunIntensity) mat.uniforms.uSunIntensity.value = Math.max(0, sunInt);
                if (mat.uniforms.uSunDir) mat.uniforms.uSunDir.value.copy(sunDir);
                if (mat.uniforms.uSunColor && sunLight) mat.uniforms.uSunColor.value.copy(sunLight.color);
                if (mat.uniforms.uMoonIntensity) mat.uniforms.uMoonIntensity.value = Math.max(0, moonInt);
                if (mat.uniforms.uMoonDir) mat.uniforms.uMoonDir.value.copy(moonDir);
                if (mat.uniforms.uMoonColor && moonLight) mat.uniforms.uMoonColor.value.copy(moonLight.color);
                if (bs.ambientLight) {
                    if (mat.uniforms.uAmbientColor) mat.uniforms.uAmbientColor.value.copy(bs.ambientLight.color);
                    if (mat.uniforms.uAmbientIntensity) mat.uniforms.uAmbientIntensity.value = bs.ambientLight.intensity;
                }
                if (bs.nightAmbientLight) {
                    if (mat.uniforms.uNightAmbientColor) mat.uniforms.uNightAmbientColor.value.copy(bs.nightAmbientLight.color);
                    if (mat.uniforms.uNightAmbientIntensity) mat.uniforms.uNightAmbientIntensity.value = bs.nightAmbientLight.intensity;
                }
            }
        }

        // Sync gradient fog uniforms
        const ps = window.parameterSystem;
        if (ps) {
            for (const part of this.parts) {
                const mat = part.mesh.material;
                if (!mat || !mat.uniforms) continue;
                const syncFog = (uniformName, paramName, isBool = false) => {
                    if (mat.uniforms[uniformName] !== undefined) {
                        let val = ps.getParameter(paramName);
                        if (val !== undefined) {
                            if (isBool) val = val ? 1.0 : 0.0;
                            const cur = mat.uniforms[uniformName].value;
                            if (typeof cur === 'number' && typeof val === 'number') {
                                if (Math.abs(cur - val) > 0.0001) mat.uniforms[uniformName].value = val;
                            } else if (cur !== val) {
                                mat.uniforms[uniformName].value = val;
                            }
                        }
                    }
                };
                syncFog('uFogGradientEnabled', 'fogGradientEnabled', true);
                syncFog('uFogGradientExponent', 'fogGradientExponent');
                syncFog('uFogGradientBias', 'fogGradientBias');
                syncFog('uFogDensity', 'fogDensity');
                if (mat.uniforms.uFogColors && mat.uniforms.uFogStops && mat.uniforms.uFogColorCount) {
                    const count = Math.floor(ps.getParameter('fogColorBandCount') || 2);
                    if (mat.uniforms.uFogColorCount.value !== count) mat.uniforms.uFogColorCount.value = count;
                    for (let i = 0; i < 5; i++) {
                        const colorVal = ps.getParameter(`fogColor${i + 1}`);
                        if (colorVal && mat.uniforms.uFogColors.value[i]) {
                            mat.uniforms.uFogColors.value[i].set(colorVal);
                        }
                        const stopVal = ps.getParameter(`fogColorStop${i + 1}`);
                        if (stopVal !== undefined && mat.uniforms.uFogStops.value[i] !== stopVal) {
                            mat.uniforms.uFogStops.value[i] = stopVal;
                        }
                    }
                }
            }
        }

        // Leaf distance LOD — reduce leaf count per tree with distance
        const camera = window.game && window.game.camera;
        if (!camera || !this._leafMesh) return;
        const camPos = camera.position;
        let anyLeafChanged = false;
        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];
            if (!tree || tree._lodVisible === false) continue;
            const dx = tree.x - camPos.x;
            const dz = tree.z - camPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            let targetCount = 0;
            if (dist < 25) targetCount = this.leavesPerTree;
            else if (dist < 50) targetCount = Math.floor(this.leavesPerTree * 0.6);
            else if (dist < 80) targetCount = Math.floor(this.leavesPerTree * 0.3);
            else if (dist < this.leafDropDistance) targetCount = Math.floor(this.leavesPerTree * 0.15);

            const oldCount = this._leafLodCount[i];
            if (targetCount !== oldCount) {
                if (targetCount > oldCount) {
                    // Regenerate all leaves for this tree (restores hidden ones)
                    this.updateTreeInstanceMatrix(i, tree);
                } else {
                    // Hide leaves from targetCount upward
                    for (let j = targetCount; j < this.leavesPerTree; j++) {
                        this.leafMesh.setMatrixAt(i * this.leavesPerTree + j, this._zeroScaleMatrix);
                    }
                }
                this._leafLodCount[i] = targetCount;
                anyLeafChanged = true;
            }
        }
        if (anyLeafChanged) {
            this.leafMesh.instanceMatrix.needsUpdate = true;
        }
    }

    clear() {
        this.treeCount = 0;
        this.treeData.length = 0;
        for (let i = 0; i < this.maxTrees; i++) {
            this._leafVisible[i] = 1;
            this._leafLodCount[i] = this.leavesPerTree;
        }
        this._capacityWarned = false;
        if (this.trunkMesh) {
            this.trunkMesh.count = 0;
            this.trunkMesh.instanceMatrix.needsUpdate = true;
        }
        if (this.leafMesh) {
            this.leafMesh.count = 0;
            this.leafMesh.instanceMatrix.needsUpdate = true;
        }
    }

    dispose() {
        if (this.trunkMesh) {
            this.scene.remove(this.trunkMesh);
            this.trunkMesh.geometry.dispose();
            this.trunkMesh.material.dispose();
        }
        if (this.leafMesh) {
            this.scene.remove(this.leafMesh);
            this.leafMesh.geometry.dispose();
            this.leafMesh.material.dispose();
        }
        this.parts = [];
        this.treeData = [];
        this.treeCount = 0;
    }

    whenReady() {
        return this._readyPromise;
    }

    computeWindField() {
        const board = window.game && window.game.boardSystem;
        if (!board || !board.computeTreeWindField) return;
        board.computeTreeWindField(this.treeData, this.windField);
    }

    setLodLevel(level) {
        const settings = {
            high: { leafDrop: 45, renderDist: 100 },
            medium: { leafDrop: 30, renderDist: 75 },
            low: { leafDrop: 20, renderDist: 50 }
        };
        const s = settings[level] || settings.medium;
        this.leafDropDistance = s.leafDrop;
        this.maxRenderDistance = s.renderDist;
    }

    setGlobalTreeSizeMult(value) {
        this.globalTreeSizeMult = value;
        for (let i = 0; i < this.treeCount; i++) {
            this.updateTreeInstanceMatrix(i, this.treeData[i]);
        }
    }

    setFoliageSizeMult(value) {
        this.foliageSizeMult = value;
        for (let i = 0; i < this.treeCount; i++) {
            this.updateTreeInstanceMatrix(i, this.treeData[i]);
        }
    }
}
