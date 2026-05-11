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

        // --- TRUNK ---
        const trunkHeight = 2.5;
        const trunkGeo = new THREE.CylinderGeometry(0.06, 0.10, trunkHeight, 8, 4);
        trunkGeo.translate(0, trunkHeight / 2, 0);
        // Pinch all top-ring vertices into a single point
        const tPos = trunkGeo.attributes.position;
        for (let i = 0; i < tPos.count; i++) {
            if (tPos.getY(i) > trunkHeight / 2 - 0.001) {
                tPos.setX(i, 0);
                tPos.setZ(i, 0);
            }
        }
        tPos.needsUpdate = true;
        trunkGeo.computeVertexNormals();
        const trunkMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x5a3f2a),
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        this._injectWindShader(trunkMat, 0.015);
        parts.push({
            name: 'trunk',
            mesh: this._makeInstancedMesh(trunkGeo, trunkMat, true),
            offset: { x: 0, y: 0, z: 0 },
            scaleY: 1.0
        });

        // --- THREE VERTICAL PLANES ---
        const planeAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
        for (let i = 0; i < 3; i++) {
            const planeGeo = new THREE.PlaneGeometry(2.2, 2.6, 5, 4);
            planeGeo.translate(0, 1.3, 0); // base at y=0
            planeGeo.rotateY(planeAngles[i]);
            const planeMat = this._createPlaneShaderMaterial(0.05);
            parts.push({
                name: 'plane_' + i,
                mesh: this._makeInstancedMesh(planeGeo, planeMat, true),
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
                uSunIntensity: { value: 1.0 }
            },
            vertexShader: `
                attribute float aWindPhase;
                attribute float aWindMultiplier;

                uniform float uTime;
                uniform float uWindStrength;
                uniform vec2 uWindDirection;
                uniform float uSwayMult;

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
                    float h = max(0.0, wp.y);
                    float phase = aWindPhase + position.x * 0.5 + position.z * 0.3;
                    wp.x += sin(uTime * 1.8 + phase) * uWindStrength * h * h * 0.15 * uSwayMult * aWindMultiplier;
                    wp.z += cos(uTime * 2.6 + phase * 1.4) * uWindStrength * h * h * 0.10 * uSwayMult * aWindMultiplier;
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform vec3 lightDir;
                uniform float ambient;
                uniform float uSunIntensity;

                varying vec2 vUv;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                varying vec3 vLocalPos;

                void main() {
                    vec4 texel = texture2D(map, vUv);
                    // Derive alpha from luminance (bright sky/background -> transparent)
                    float lum = max(texel.r, max(texel.g, texel.b));
                    float alpha = 1.0 - smoothstep(0.40, 0.60, lum);
                    if (alpha < 0.05) discard;
                    vec3 n = normalize(vWorldNormal);
                    float diff = max(dot(n, lightDir), 0.0);
                    vec3 litColor = texel.rgb * (ambient + diff * (1.0 - ambient)) * uSunIntensity;
                    gl_FragColor = vec4(litColor, alpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: true
        });
    }

    _makeInstancedMesh(geometry, material, needsWind = false) {
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxTrees);
        mesh.count = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        if (needsWind) {
            mesh.geometry.setAttribute('aWindPhase',
                new THREE.InstancedBufferAttribute(this._sharedWindPhases, 1));
            mesh.geometry.setAttribute('aWindMultiplier',
                new THREE.InstancedBufferAttribute(this._sharedWindMultipliers, 1));
        }
        return mesh;
    }

    _injectWindShader(material, swayAmount) {
        const u = this.windUniforms;
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime          = u.uTime;
            shader.uniforms.uWindStrength  = u.uWindStrength;
            shader.uniforms.uWindDirection = u.uWindDirection;
            shader.uniforms.uSwayMult      = { value: swayAmount };

            shader.vertexShader =
                `attribute float aWindPhase;\n` +
                `attribute float aWindMultiplier;\n` +
                `uniform float uTime;\n` +
                `uniform float uWindStrength;\n` +
                `uniform vec2 uWindDirection;\n` +
                `uniform float uSwayMult;\n` +
                shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                float h = max(0.0, position.y);
                float phase = aWindPhase + position.x * 0.5 + position.z * 0.3;
                float s1 = sin(uTime * 1.8 + phase) * uWindStrength * h * h * 0.15 * uSwayMult * aWindMultiplier;
                float s2 = cos(uTime * 2.6 + phase * 1.4) * uWindStrength * h * h * 0.10 * uSwayMult * aWindMultiplier;
                transformed.x += s1;
                transformed.z += s2;`
            );
        };
        material.needsUpdate = true;
    }

    addTree(worldX, worldZ, terrainHeight) {
        if (this.treeCount >= this.maxTrees) {
            console.warn('[PoplarTreeSystem] Capacity reached (' + this.maxTrees + ')');
            return -1;
        }

        const i = this.treeCount;
        const scale  = 0.85 + Math.random() * 0.45; // 0.85 - 1.30
        const rotY   = Math.random() * Math.PI * 2;

        this.treeData.push({ x: worldX, z: worldZ, y: terrainHeight, scale, rotY });

        if (!this._currentHeights) {
            this._currentHeights = new Float32Array(this.maxTrees);
        }
        this._currentHeights[i] = terrainHeight;

        const tileX = Math.floor(worldX);
        const tileZ = Math.floor(worldZ);
        const windMult = this.windField.get(`${tileX},${tileZ}`) || 1.0;

        this._scratchEuler.set(0, rotY, 0);
        this._scratchQuat.setFromEuler(this._scratchEuler);
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

        const meshExtent = 96;
        const waterCutoff = (board.waterLevel != null ? board.waterLevel : -1.5) + 0.05;

        for (let i = 0; i < this.treeCount; i++) {
            const tree = this.treeData[i];
            const dx = Math.abs(tree.x - camera.position.x);
            const dz = Math.abs(tree.z - camera.position.z);

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

            let rippleTiltX = 0;
            let rippleTiltZ = 0;
            if (board.getTerrainNormal) {
                const normal = board.getTerrainNormal(tree.x, tree.z);
                rippleTiltX = Math.atan2(normal.x, normal.y);
                rippleTiltZ = Math.atan2(-normal.z, normal.y);
            }

            tree.y = newHeight;
            this.updateTreeInstanceMatrix(i, tree, rippleTiltX, rippleTiltZ);
        }
    }

    updateTreeInstanceMatrix(i, tree, rippleTiltX = 0, rippleTiltZ = 0) {
        const scale = tree.scale;
        const rotY = tree.rotY;

        this._scratchEuler.set(rippleTiltX, rotY, rippleTiltZ);
        this._scratchQuat.setFromEuler(this._scratchEuler);
        this._scratchPos.set(tree.x, tree.y, tree.z);
        this._scratchScale.set(scale, scale, scale);
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
