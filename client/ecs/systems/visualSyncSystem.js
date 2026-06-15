// Visual Sync System — copies gameplay state to visual pool each tick
class VisualSyncSystem {
    update(dt, world) {
        world.pool.forEach((entityId) => {
            const handle = world.getVisualHandle(entityId);
            if (handle === undefined) return;

            const pos = world.pool.getPosition(entityId);
            const heading = world.pool.getRotation(entityId);

            world.visualPool.update(handle, {
                position: { x: pos.x, y: pos.y, z: pos.z },
                rotation: heading
            });
        });
    }
}

window.VisualSyncSystem = VisualSyncSystem;
