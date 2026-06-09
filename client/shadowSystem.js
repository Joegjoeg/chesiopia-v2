/**
 * BakedShadowSystem
 * Runtime system for baked geometry shadows in Chessopia.
 * Loads ShadowSet data, morphs between pre-baked angles based on sun position,
 * and applies wind deformation matching the parent object.
 */
class BakedShadowSystem {
    constructor(scene) {
        this.scene = scene;
        this.enabled = true;
        this.shadowSets = new Map(); // name -> ShadowSet data
        this.instances = new Map(); // object UUID -> { mesh, setName, parent }
        this.tempVec3 = new THREE.Vector3();
        this.tempColor = new THREE.Color();

        // Reusable geometry/material caches per set
        this.baseGeometries = new Map(); // setName -> BufferGeometry
        this.shadowMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -1.0
        });
    }

    /**
     * Load a ShadowSet from JSON data (fetched or embedded).
     * @param {string} name - Identifier for this shadow set
     * @param {Object} data - Parsed ShadowSet JSON
     */
    loadShadowSet(name, data) {
        if (!data || !data.angles || !data.indexBuffer) {
            console.warn('[ShadowSystem] Invalid shadow set data:', name);
            return false;
        }

        this.shadowSets.set(name, data);

        // Pre-build base geometry for this set
        const geo = this.buildBaseGeometry(data);
        this.baseGeometries.set(name, geo);

        console.log(`[ShadowSystem] Loaded set "${name}" with ${data.numAngles} angles, ${data.gridResolution}x${data.gridResolution} grid`);
        return true;
    }

    /**
     * Build a base BufferGeometry from the set's index buffer and grid parameters.
     * Vertex positions will be overwritten each frame during morphing.
     */
    buildBaseGeometry(setData) {
        const res = setData.gridResolution;
        const size = setData.worldSize;
        const half = size / 2;
        const cellSize = size / res;
        const groundY = setData.groundY || 0;

        const vertices = new Float32Array(res * res * 3);
        const uvs = new Float32Array(res * res * 2);

        for (let gz = 0; gz < res; gz++) {
            for (let gx = 0; gx < res; gx++) {
                const i = gz * res + gx;
                const wx = -half + (gx + 0.5) * cellSize;
                const wz = -half + (gz + 0.5) * cellSize;
                vertices[i * 3] = wx;
                vertices[i * 3 + 1] = groundY;
                vertices[i * 3 + 2] = wz;
                uvs[i * 2] = gx / (res - 1);
                uvs[i * 2 + 1] = gz / (res - 1);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(setData.indexBuffer);
        geometry.computeVertexNormals();

        return geometry;
    }

    /**
     * Create a shadow instance for an object.
     * @param {THREE.Object3D} parent - The object casting the shadow
     * @param {string} setName - ShadowSet identifier
     * @param {Object} options - Optional settings
     * @returns {THREE.Mesh|null} The shadow mesh
     */
    createShadowFor(parent, setName, options = {}) {
        if (!this.enabled) return null;
        const setData = this.shadowSets.get(setName);
        if (!setData) {
            console.warn(`[ShadowSystem] Shadow set "${setName}" not loaded`);
            return null;
        }

        // Remove any existing shadow for this parent to avoid duplicates (e.g. pooled trees)
        if (this.instances.has(parent.uuid)) {
            this.removeShadowFor(parent);
        }

        const baseGeo = this.baseGeometries.get(setName);
        if (!baseGeo) return null;

        // Clone geometry for this instance (so we can modify vertices independently)
        const geometry = baseGeo.clone();
        // Deep clone the position attribute so each instance has its own buffer
        const positions = new Float32Array(baseGeo.attributes.position.array);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = this.shadowMaterial.clone();
        if (options.opacity !== undefined) material.opacity = options.opacity;
        if (options.color !== undefined) material.color.set(options.color);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'bakedShadow';
        mesh.renderOrder = 998;
        mesh.userData.isBakedShadow = true;
        mesh.userData.parentUUID = parent.uuid;

        this.scene.add(mesh);

        const instance = {
            mesh: mesh,
            setName: setName,
            parent: parent,
            setData: setData,
            positions: positions,
            lastAzimuth: null,
            windProperties: options.windProperties || parent.userData?.windProperties || null
        };

        this.instances.set(parent.uuid, instance);
        return mesh;
    }

    /**
     * Remove a shadow instance.
     */
    removeShadowFor(parent) {
        const instance = this.instances.get(parent.uuid);
        if (instance) {
            this.scene.remove(instance.mesh);
            instance.mesh.geometry.dispose();
            instance.mesh.material.dispose();
            this.instances.delete(parent.uuid);
        }
    }

    /**
     * Update all shadow instances for the current sun azimuth (in degrees).
     * Call this once per frame.
     * @param {number} time - Current time in seconds
     * @param {number} sunAzimuth - Sun azimuth in degrees (0-360)
     * @param {Object} windState - Optional { direction: rad, strength: 0-1 }
     */
    update(time, sunAzimuth, windState = null) {
        if (this.instances.size === 0) return;

        for (const instance of this.instances.values()) {
            this.updateInstance(instance, time, sunAzimuth, windState);
        }
    }

    updateInstance(instance, time, sunAzimuth, windState) {
        const { mesh, parent, setData, positions } = instance;
        if (!parent || !parent.parent) {
            // Parent was removed from scene
            this.scene.remove(mesh);
            return;
        }

        // Position shadow under parent object
        mesh.position.copy(parent.position);
        mesh.position.y = (setData.groundY || 0) + 0.03;

        // Copy parent's Y rotation so shadow aligns with object orientation
        mesh.rotation.y = parent.rotation.y;

        // Find two nearest baked angles
        const angles = setData.angles;
        if (!angles || angles.length === 0) return;

        let nearestA = null, nearestB = null;
        let bestDistA = Infinity, bestDistB = Infinity;

        for (const a of angles) {
            const da = Math.abs(a.azimuth - sunAzimuth);
            const wrapDist = Math.min(da, 360 - da);
            if (wrapDist < bestDistA) {
                bestDistB = bestDistA;
                nearestB = nearestA;
                bestDistA = wrapDist;
                nearestA = a;
            } else if (wrapDist < bestDistB) {
                bestDistB = wrapDist;
                nearestB = a;
            }
        }

        if (!nearestA) return;

        // Compute blend factor t (0 = nearestA, 1 = nearestB)
        let t = 0;
        if (nearestB) {
            // Handle wrap-around at 0/360
            let a0 = nearestA.azimuth;
            let a1 = nearestB.azimuth;
            let s = sunAzimuth;

            // Normalize so a0 < a1 and s is between them (handling wrap)
            if (a1 < a0) {
                if (s < a0 && s + 360 > a0) s += 360;
                a1 += 360;
            }
            if (s < a0) s += 360;

            if (s >= a0 && s <= a1) {
                t = (s - a0) / (a1 - a0);
            } else {
                t = 0;
            }
        }

        // Clamp t
        t = Math.max(0, Math.min(1, t));

        // Morph vertices
        const h0 = nearestA.heights;
        const h1 = nearestB ? nearestB.heights : h0;
        const res = setData.gridResolution;
        const count = res * res;

        // Wind deformation
        let windOffsetX = 0, windOffsetZ = 0;
        let windScale = 0;
        if (windState && windState.strength > 0) {
            const windDirX = Math.cos(windState.direction);
            const windDirZ = Math.sin(windState.direction);
            const props = instance.windProperties || parent.userData?.windProperties;
            if (props) {
                const windBase = 0.2 * windState.strength;
                const windVariation = Math.sin(time * 0.5 + props.phase) * 0.1 * windState.strength;
                const windFlutter = Math.sin(time * 2.0 + props.phase * 2) * 0.05 * windState.strength;
                const bendHeightFactor = props.height / 1.5;
                const thicknessFactor = 0.05 / props.baseRadius;
                const dimensionScale = bendHeightFactor * thicknessFactor;
                const totalBend = (windBase + windVariation + windFlutter) * dimensionScale;
                windOffsetX = windDirX * totalBend * 0.5; // Scale down for ground projection
                windOffsetZ = windDirZ * totalBend * 0.5;
                windScale = Math.max(0, totalBend * 0.3);
            }
        }

        const worldSize = setData.worldSize;
        const halfSize = worldSize / 2;
        const cellSize = worldSize / res;

        for (let i = 0; i < count; i++) {
            const h = h0[i] * (1 - t) + h1[i] * t;
            // Only raise shadowed cells slightly for visibility
            const height = h > 0.5 ? 0.02 : 0;

            // Base grid position (local to shadow center)
            const gx = i % res;
            const gz = Math.floor(i / res);
            const lx = -halfSize + (gx + 0.5) * cellSize;
            const lz = -halfSize + (gz + 0.5) * cellSize;

            // Apply wind displacement to shadow vertices
            // Vertices farther from center move more (simulating stretched shadow)
            const distFromCenter = Math.sqrt(lx * lx + lz * lz);
            const windFactor = 1.0 + (distFromCenter / halfSize) * windScale;

            positions[i * 3] = lx * windFactor + windOffsetX;
            positions[i * 3 + 1] = (setData.groundY || 0) + height;
            positions[i * 3 + 2] = lz * windFactor + windOffsetZ;
        }

        mesh.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * Dispose all resources.
     */
    dispose() {
        for (const instance of this.instances.values()) {
            this.scene.remove(instance.mesh);
            instance.mesh.geometry.dispose();
            instance.mesh.material.dispose();
        }
        this.instances.clear();

        for (const geo of this.baseGeometries.values()) {
            geo.dispose();
        }
        this.baseGeometries.clear();

        this.shadowSets.clear();
    }
}

window.BakedShadowSystem = BakedShadowSystem;
