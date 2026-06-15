// Physics System — simplified Euler integration with gravity and water drag
// Designed to be swappable with cannon.js later
class PhysicsSystem {
    constructor(terrainSystem) {
        this.terrainSystem = terrainSystem;
        this.gravity = -9.81;
        this.waterLevel = 12.0;
        this.waterDrag = 1.0;
        this.groundDrag = 0.5;
    }

    update(dt, world) {
        const rt = window.game && window.game.rollingTerrain;
        if (rt && rt._currentWaterLevel) {
            this.waterLevel = rt._currentWaterLevel();
        }

        world.pool.forEach((entityId) => {
            const pos = world.pool.getPosition(entityId);
            const vel = world.pool.getVelocity(entityId);
            const archetype = world.getArchetype(entityId);

            // Integrate position
            let newX = pos.x + vel.vx * dt;
            let newY = pos.y + vel.vy * dt;
            let newZ = pos.z + vel.vz * dt;

            let newVx = vel.vx;
            let newVy = vel.vy;
            let newVz = vel.vz;

            // Gravity
            if (archetype && archetype.name === 'cannonball') {
                newVy += this.gravity * dt;
            } else if (archetype && archetype.name === 'ship') {
                // Ships constrained to water surface
                const terrainHeight = this.terrainSystem ? this.terrainSystem.getHeight(newX, newZ) : this.waterLevel;
                const surfaceY = Math.max(terrainHeight, this.waterLevel);
                newY = surfaceY;
                newVy = 0;
            }

            // Water / ground drag
            if (this.terrainSystem) {
                const h = this.terrainSystem.getHeight(newX, newZ);
                if (h > this.waterLevel) {
                    // On ground — heavy drag
                    newVx *= this.groundDrag;
                    newVz *= this.groundDrag;
                } else {
                    // In water
                    newVx *= this.waterDrag;
                    newVz *= this.waterDrag;
                }
            }

            // Cannonball terrain collision
            if (archetype && archetype.name === 'cannonball') {
                const h = this.terrainSystem ? this.terrainSystem.getHeight(newX, newZ) : -999;
                if (newY < h) {
                    world.despawn(entityId);
                    return;
                }
                // Water splash despawn
                if (newY < this.waterLevel) {
                    world.despawn(entityId);
                    return;
                }
            }

            world.pool.setPosition(entityId, newX, newY, newZ);
            world.pool.setVelocity(entityId, newVx, newVy, newVz);

            // Update rotation to match velocity for cannonballs
            if (archetype && archetype.name === 'cannonball') {
                if (Math.abs(newVx) > 0.01 || Math.abs(newVz) > 0.01) {
                    world.pool.setRotation(entityId, Math.atan2(newVx, newVz));
                }
            }
        });
    }
}

window.PhysicsSystem = PhysicsSystem;
