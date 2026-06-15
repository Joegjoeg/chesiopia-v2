// Gameplay Pool — fixed-size, typed arrays for hot path, objects for cold path
class GameplayPool {
    constructor(maxEntities = 256) {
        this.MAX = maxEntities;

        // Hot path components — typed arrays (Struct of Arrays)
        this._positions = new Float32Array(this.MAX * 3);
        this._velocities = new Float32Array(this.MAX * 3);
        this._rotations = new Float32Array(this.MAX); // heading in radians

        // Cold path components — sparse plain objects in fixed array
        this._cold = new Array(this.MAX);
        for (let i = 0; i < this.MAX; i++) {
            this._cold[i] = {};
        }

        // Entity state
        this._alive = new Uint8Array(this.MAX);
        this._archetypes = new Array(this.MAX).fill(null);
        this._freeList = [];
        for (let i = this.MAX - 1; i >= 0; i--) {
            this._freeList.push(i);
        }
        this._activeCount = 0;

        // Component registry reference (set by world)
        this.registry = null;
    }

    setRegistry(registry) {
        this.registry = registry;
    }

    create(archetype, overrides = {}) {
        if (this._freeList.length === 0) {
            console.warn('[GameplayPool] Max capacity reached');
            return -1;
        }
        const id = this._freeList.pop();
        this._alive[id] = 1;
        this._activeCount++;
        this._archetypes[id] = archetype.name;

        // Initialize hot path components
        const comps = archetype.components || {};
        if (comps.position) {
            this._positions[id * 3] = comps.position.x || 0;
            this._positions[id * 3 + 1] = comps.position.y || 0;
            this._positions[id * 3 + 2] = comps.position.z || 0;
        }
        if (comps.velocity) {
            this._velocities[id * 3] = comps.velocity.vx || 0;
            this._velocities[id * 3 + 1] = comps.velocity.vy || 0;
            this._velocities[id * 3 + 2] = comps.velocity.vz || 0;
        }
        if (comps.rotation) {
            this._rotations[id] = comps.rotation.heading || 0;
        }

        // Initialize cold path components
        this._cold[id] = {};
        for (const [compName, defaultData] of Object.entries(comps)) {
            if (compName === 'position' || compName === 'velocity' || compName === 'rotation') continue;
            this._cold[id][compName] = JSON.parse(JSON.stringify(defaultData));
        }

        // Apply overrides
        for (const [compName, data] of Object.entries(overrides)) {
            if (compName === 'position') {
                if (data.x !== undefined) this._positions[id * 3] = data.x;
                if (data.y !== undefined) this._positions[id * 3 + 1] = data.y;
                if (data.z !== undefined) this._positions[id * 3 + 2] = data.z;
            } else if (compName === 'velocity') {
                if (data.vx !== undefined) this._velocities[id * 3] = data.vx;
                if (data.vy !== undefined) this._velocities[id * 3 + 1] = data.vy;
                if (data.vz !== undefined) this._velocities[id * 3 + 2] = data.vz;
            } else if (compName === 'rotation') {
                if (data.heading !== undefined) this._rotations[id] = data.heading;
            } else {
                this._cold[id][compName] = JSON.parse(JSON.stringify(data));
            }
        }

        return id;
    }

    destroy(id) {
        if (!this.isAlive(id)) return false;
        this._alive[id] = 0;
        this._archetypes[id] = null;
        this._cold[id] = {};
        this._positions[id * 3] = 0;
        this._positions[id * 3 + 1] = 0;
        this._positions[id * 3 + 2] = 0;
        this._velocities[id * 3] = 0;
        this._velocities[id * 3 + 1] = 0;
        this._velocities[id * 3 + 2] = 0;
        this._rotations[id] = 0;
        this._freeList.push(id);
        this._activeCount--;
        return true;
    }

    isAlive(id) {
        return id >= 0 && id < this.MAX && this._alive[id] === 1;
    }

    getArchetype(id) {
        return this._archetypes[id];
    }

    getPosition(id) {
        const i = id * 3;
        return { x: this._positions[i], y: this._positions[i + 1], z: this._positions[i + 2] };
    }

    setPosition(id, x, y, z) {
        const i = id * 3;
        this._positions[i] = x;
        this._positions[i + 1] = y;
        this._positions[i + 2] = z;
    }

    getVelocity(id) {
        const i = id * 3;
        return { vx: this._velocities[i], vy: this._velocities[i + 1], vz: this._velocities[i + 2] };
    }

    setVelocity(id, vx, vy, vz) {
        const i = id * 3;
        this._velocities[i] = vx;
        this._velocities[i + 1] = vy;
        this._velocities[i + 2] = vz;
    }

    getRotation(id) {
        return this._rotations[id];
    }

    setRotation(id, heading) {
        this._rotations[id] = heading;
    }

    getComponent(id, componentName) {
        if (componentName === 'position') return this.getPosition(id);
        if (componentName === 'velocity') return this.getVelocity(id);
        if (componentName === 'rotation') return { heading: this.getRotation(id) };
        return this._cold[id][componentName] || null;
    }

    setComponent(id, componentName, data) {
        if (componentName === 'position') {
            if (data.x !== undefined) this._positions[id * 3] = data.x;
            if (data.y !== undefined) this._positions[id * 3 + 1] = data.y;
            if (data.z !== undefined) this._positions[id * 3 + 2] = data.z;
        } else if (componentName === 'velocity') {
            if (data.vx !== undefined) this._velocities[id * 3] = data.vx;
            if (data.vy !== undefined) this._velocities[id * 3 + 1] = data.vy;
            if (data.vz !== undefined) this._velocities[id * 3 + 2] = data.vz;
        } else if (componentName === 'rotation') {
            if (data.heading !== undefined) this._rotations[id] = data.heading;
        } else {
            this._cold[id][componentName] = data;
        }
    }

    hasComponent(id, componentName) {
        if (!this.isAlive(id)) return false;
        if (componentName === 'position') return true; // hot path always present if alive
        if (componentName === 'velocity') return true;
        if (componentName === 'rotation') return true;
        return componentName in this._cold[id];
    }

    forEach(callback) {
        for (let id = 0; id < this.MAX; id++) {
            if (this._alive[id]) callback(id);
        }
    }

    getActiveCount() {
        return this._activeCount;
    }
}

window.GameplayPool = GameplayPool;
