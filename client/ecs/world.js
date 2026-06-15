// ECS World — central orchestrator: archetype groups, system runner, spawn/despawn
class ECSWorld {
    constructor(scene, maxEntities = 256) {
        this.registry = new ComponentRegistry();
        this.pool = new GameplayPool(maxEntities);
        this.pool.setRegistry(this.registry);
        this.visualPool = new VisualPool(scene);
        this.scene = scene;

        // Archetype groups: Map<archetypeName, Set<entityId>>
        this._archetypeGroups = new Map();
        // Archetype definitions: Map<archetypeName, archetypeConfig>
        this._archetypes = new Map();
        // Systems: ordered array
        this._systems = [];
        // Cross-reference: entityId -> visualHandle
        this._entityVisuals = new Map();
        // Entity -> archetype fast lookup
        this._entityArchetypes = new Map();

        this._tickCount = 0;
    }

    registerArchetype(archetype) {
        if (this._archetypes.has(archetype.name)) {
            console.warn(`[ECSWorld] Archetype "${archetype.name}" already registered`);
            return;
        }
        this._archetypes.set(archetype.name, archetype);
        this._archetypeGroups.set(archetype.name, new Set());

        // Register components with registry
        for (const [compName, defaultData] of Object.entries(archetype.components || {})) {
            if (!this.registry.has(compName)) {
                const schema = this._inferSchema(defaultData);
                this.registry.register(compName, schema);
            }
        }
    }

    _inferSchema(defaultData) {
        const schema = {};
        for (const [key, value] of Object.entries(defaultData)) {
            const t = typeof value;
            if (t === 'number') {
                schema[key] = Number.isInteger(value) ? 'int' : 'float';
            } else if (t === 'boolean') {
                schema[key] = 'bool';
            } else if (t === 'string') {
                schema[key] = 'string';
            } else {
                schema[key] = 'object';
            }
        }
        return schema;
    }

    registerSystem(name, requiredComponents, updateFn, options = {}) {
        this._systems.push({
            name,
            requiredComponents,
            update: updateFn,
            priority: options.priority || 0,
            enabled: options.enabled !== false
        });
        // Sort by priority ascending (lower = earlier)
        this._systems.sort((a, b) => a.priority - b.priority);
    }

    async preloadVisuals() {
        for (const archetype of this._archetypes.values()) {
            if (archetype.modelRef) {
                await this.visualPool.preloadModel(archetype);
            }
        }
    }

    spawn(archetypeName, overrides = {}) {
        const archetype = this._archetypes.get(archetypeName);
        if (!archetype) {
            console.error(`[ECSWorld] Unknown archetype: ${archetypeName}`);
            return -1;
        }

        // Check per-archetype cap
        const group = this._archetypeGroups.get(archetypeName);
        const poolCap = archetype.poolCap || 256;
        if (group.size >= poolCap) {
            console.warn(`[ECSWorld] Archetype cap reached for "${archetypeName}" (${poolCap})`);
            return -1;
        }

        const entityId = this.pool.create(archetype, overrides);
        if (entityId < 0) return -1;

        group.add(entityId);
        this._entityArchetypes.set(entityId, archetypeName);

        // Acquire visual handle
        const visualHandle = this.visualPool.acquire(archetypeName, entityId);
        this._entityVisuals.set(entityId, visualHandle);

        return entityId;
    }

    despawn(entityId) {
        if (!this.pool.isAlive(entityId)) return false;

        const archetypeName = this._entityArchetypes.get(entityId);
        if (archetypeName) {
            const group = this._archetypeGroups.get(archetypeName);
            if (group) group.delete(entityId);
        }

        const visualHandle = this._entityVisuals.get(entityId);
        if (visualHandle !== undefined) {
            this.visualPool.release(visualHandle);
            this._entityVisuals.delete(entityId);
        }

        this._entityArchetypes.delete(entityId);
        this.pool.destroy(entityId);
        return true;
    }

    getEntities(archetypeName) {
        const group = this._archetypeGroups.get(archetypeName);
        return group ? Array.from(group) : [];
    }

    getEntitiesWithComponents(componentNames) {
        const result = [];
        const mask = this.registry.getMask(componentNames);
        this.pool.forEach((id) => {
            // Fast path: check each required component exists on entity
            let hasAll = true;
            for (const name of componentNames) {
                if (!this.pool.hasComponent(id, name)) {
                    hasAll = false;
                    break;
                }
            }
            if (hasAll) result.push(id);
        });
        return result;
    }

    getArchetype(entityId) {
        return this._archetypes.get(this._entityArchetypes.get(entityId));
    }

    getVisualHandle(entityId) {
        return this._entityVisuals.get(entityId);
    }

    tick(dt) {
        this._tickCount++;
        for (const system of this._systems) {
            if (!system.enabled) continue;
            system.update(dt, this);
        }
    }

    getTick() {
        return this._tickCount;
    }
}

window.ECSWorld = ECSWorld;
