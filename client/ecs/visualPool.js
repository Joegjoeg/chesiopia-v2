// Visual Pool — variable size, Three.js Object3D management
class VisualPool {
    constructor(scene) {
        this.scene = scene;
        this._handles = new Map(); // visualHandle -> { mesh, archetype, active, entityId }
        this._pools = new Map(); // archetypeName -> [] of reusable meshes
        this._nextHandle = 1;
        this._modelCache = new Map(); // archetypeName -> loaded scene/model
        this._loader = new THREE.GLTFLoader();
    }

    async preloadModel(archetype) {
        if (this._modelCache.has(archetype.name)) return;
        try {
            const result = await this._loader.loadAsync(archetype.modelRef);
            this._modelCache.set(archetype.name, result.scene || result);
        } catch (err) {
            console.warn(`[VisualPool] Failed to load model for "${archetype.name}":`, err);
            // Cache null so we don't retry; will use fallback mesh
            this._modelCache.set(archetype.name, null);
        }
    }

    acquire(archetypeName, entityId) {
        const handle = this._nextHandle++;
        let mesh = null;

        // Try pool reuse
        const pool = this._pools.get(archetypeName);
        if (pool && pool.length > 0) {
            mesh = pool.pop();
            mesh.visible = true;
        } else {
            mesh = this._createMesh(archetypeName);
        }

        if (mesh) {
            this.scene.add(mesh);
        }

        this._handles.set(handle, { mesh, archetype: archetypeName, active: true, entityId });
        return handle;
    }

    release(handle) {
        const entry = this._handles.get(handle);
        if (!entry) return false;
        if (entry.mesh) {
            entry.mesh.visible = false;
            this.scene.remove(entry.mesh);
            const pool = this._pools.get(entry.archetype);
            if (pool) {
                pool.push(entry.mesh);
            } else {
                this._pools.set(entry.archetype, [entry.mesh]);
            }
        }
        this._handles.delete(handle);
        return true;
    }

    update(handle, transformData) {
        const entry = this._handles.get(handle);
        if (!entry || !entry.mesh) return;
        if (transformData.position) {
            entry.mesh.position.set(transformData.position.x, transformData.position.y, transformData.position.z);
        }
        if (transformData.rotation !== undefined) {
            entry.mesh.rotation.y = transformData.rotation;
        }
        if (transformData.scale !== undefined) {
            entry.mesh.scale.setScalar(transformData.scale);
        }
    }

    setVisibility(handle, visible) {
        const entry = this._handles.get(handle);
        if (entry && entry.mesh) {
            entry.mesh.visible = visible;
        }
    }

    getMesh(handle) {
        const entry = this._handles.get(handle);
        return entry ? entry.mesh : null;
    }

    getEntityVisual(entityId) {
        for (const [handle, entry] of this._handles) {
            if (entry.entityId === entityId) return { handle, mesh: entry.mesh };
        }
        return null;
    }

    _createMesh(archetypeName) {
        const cached = this._modelCache.get(archetypeName);
        if (cached) {
            const clone = cached.clone();
            return clone;
        }

        // Fallback procedural meshes by archetype name
        if (archetypeName === 'ship') {
            const group = new THREE.Group();
            // Hull
            const hullGeo = new THREE.BoxGeometry(2, 1, 4);
            const hullMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const hull = new THREE.Mesh(hullGeo, hullMat);
            hull.position.y = 0.5;
            group.add(hull);
            // Mast
            const mastGeo = new THREE.CylinderGeometry(0.1, 0.1, 5);
            const mastMat = new THREE.MeshStandardMaterial({ color: 0x5C4033 });
            const mast = new THREE.Mesh(mastGeo, mastMat);
            mast.position.set(0, 3, 0);
            group.add(mast);
            // Sail
            const sailGeo = new THREE.PlaneGeometry(2.5, 3);
            const sailMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, side: THREE.DoubleSide });
            const sail = new THREE.Mesh(sailGeo, sailMat);
            sail.position.set(0, 3.5, 0.2);
            sail.rotation.y = Math.PI / 2;
            group.add(sail);
            group.castShadow = true;
            return group;
        }

        if (archetypeName === 'cannonball') {
            const geo = new THREE.SphereGeometry(0.3, 8, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            return mesh;
        }

        // Generic fallback
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff00ff });
        return new THREE.Mesh(geo, mat);
    }
}

window.VisualPool = VisualPool;
