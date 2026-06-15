// Network Sync System — placeholder for client-auth + server validation
class NetworkSyncSystem {
    constructor(networkManager = null) {
        this.network = networkManager;
        this._accumulator = 0;
        this._sendInterval = 0.1; // 10 Hz
    }

    update(dt, world) {
        if (!this.network || !this.network.socket) return;

        this._accumulator += dt;
        if (this._accumulator < this._sendInterval) return;
        this._accumulator -= this._sendInterval;

        const ships = world.getEntities('ship');
        for (const entityId of ships) {
            const pos = world.pool.getPosition(entityId);
            const vel = world.pool.getVelocity(entityId);
            const heading = world.pool.getRotation(entityId);

            this.network.socket.emit('playerState', {
                entityId,
                position: { x: pos.x, y: pos.y, z: pos.z },
                velocity: { vx: vel.vx, vy: vel.vy, vz: vel.vz },
                heading,
                tick: world.getTick()
            });
        }
    }
}

window.NetworkSyncSystem = NetworkSyncSystem;
