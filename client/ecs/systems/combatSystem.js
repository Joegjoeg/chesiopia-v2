// Combat System — cannon firing, projectile spawning
class CombatSystem {
    constructor() {
        this.muzzleVelocity = 30;
        this.cannonOffsetSide = 1.5;
        this.cannonOffsetFront = 1.0;
    }

    update(dt, world) {
        const ships = world.getEntities('ship');
        for (const entityId of ships) {
            const cannon = world.pool.getComponent(entityId, 'cannon');
            const input = world.pool.getComponent(entityId, 'playerInput');
            if (!cannon || !input) continue;

            // Decrement cooldown
            if (cannon.cooldownRemaining > 0) {
                cannon.cooldownRemaining -= dt;
                if (cannon.cooldownRemaining < 0) cannon.cooldownRemaining = 0;
            }

            if (input.fireRequested && cannon.cooldownRemaining <= 0) {
                this._fireCannons(entityId, world);
                cannon.cooldownRemaining = cannon.reloadTime;
            }
        }
    }

    _fireCannons(shipId, world) {
        const pos = world.pool.getPosition(shipId);
        const heading = world.pool.getRotation(shipId);
        const shipVel = world.pool.getVelocity(shipId);
        const cannon = world.pool.getComponent(shipId, 'cannon');
        if (!cannon) return;

        const forwardX = Math.sin(heading);
        const forwardZ = Math.cos(heading);
        const rightX = Math.cos(heading);
        const rightZ = -Math.sin(heading);

        const arcs = [];
        // Port side
        if (cannon.portArc > 0) {
            arcs.push({ side: -1, arcRad: (cannon.portArc * Math.PI) / 180 });
        }
        // Starboard side
        if (cannon.starboardArc > 0) {
            arcs.push({ side: 1, arcRad: (cannon.starboardArc * Math.PI) / 180 });
        }

        for (const arc of arcs) {
            const offsetX = rightX * arc.side * this.cannonOffsetSide;
            const offsetZ = rightZ * arc.side * this.cannonOffsetSide;

            const spawnX = pos.x + forwardX * this.cannonOffsetFront + offsetX;
            const spawnZ = pos.z + forwardZ * this.cannonOffsetFront + offsetZ;
            const spawnY = pos.y + 1.5;

            // Fire angle: perpendicular to ship heading, broadside
            const fireHeading = heading + arc.side * (Math.PI / 2);
            const muzzleVx = Math.sin(fireHeading) * this.muzzleVelocity;
            const muzzleVz = Math.cos(fireHeading) * this.muzzleVelocity;

            const projOverrides = {
                position: { x: spawnX, y: spawnY, z: spawnZ },
                velocity: {
                    vx: shipVel.vx + muzzleVx,
                    vy: 2,
                    vz: shipVel.vz + muzzleVz
                },
                projectile: { damage: 25, sourceEntityId: shipId }
            };

            world.spawn('cannonball', projOverrides);
        }
    }
}

window.CombatSystem = CombatSystem;
