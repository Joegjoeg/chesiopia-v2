// Lifetime System — TTL-based entity despawn
class LifetimeSystem {
    update(dt, world) {
        // Collect entities to despawn after iteration
        const toDespawn = [];

        world.pool.forEach((entityId) => {
            const lifetime = world.pool.getComponent(entityId, 'lifetime');
            if (!lifetime) return;

            lifetime.elapsed += dt;
            if (lifetime.elapsed >= lifetime.ttl) {
                toDespawn.push(entityId);
            }
        });

        for (const entityId of toDespawn) {
            world.despawn(entityId);
        }
    }
}

window.LifetimeSystem = LifetimeSystem;
