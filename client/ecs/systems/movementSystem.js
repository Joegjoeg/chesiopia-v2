// Movement System — sail forces, wind interaction, heading update
class MovementSystem {
    constructor() {
        this.windDirection = 0; // radians
        this.windSpeed = 5;
    }

    update(dt, world) {
        // Pull wind from rollingTerrain if available
        const rt = window.game && window.game.rollingTerrain;
        if (rt) {
            if (rt.windDir) {
                this.windDirection = Math.atan2(rt.windDir.y, rt.windDir.x);
            }
            if (rt.windSpeed !== undefined) {
                this.windSpeed = rt.windSpeed;
            }
        }

        const ships = world.getEntities('ship');
        for (const entityId of ships) {
            const input = world.pool.getComponent(entityId, 'playerInput');
            const sail = world.pool.getComponent(entityId, 'sail');
            const hull = world.pool.getComponent(entityId, 'hull');
            if (!input || !sail || !hull) continue;

            const heading = world.pool.getRotation(entityId);
            const vel = world.pool.getVelocity(entityId);

            // Rudder turning — effectiveness scales with speed (minimal steerage way at very low speeds)
            const speed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);
            const steerageFactor = Math.max(0.05, speed / sail.maxSpeed);

            if (input.targetHeading !== null && input.targetHeading !== undefined) {
                // Auto-steer toward target heading (Steady As She Goes)
                let diff = input.targetHeading - heading;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                const steer = Math.max(-1, Math.min(1, diff * 3)); // proportional control
                const turnAmount = steer * sail.turnRate * steerageFactor;
                world.pool.setRotation(entityId, heading + turnAmount);
            } else if (input.rudder !== 0) {
                const turnAmount = input.rudder * sail.turnRate * steerageFactor;
                world.pool.setRotation(entityId, heading + turnAmount);
            }

            // Sail force based on wind angle relative to heading
            const newHeading = world.pool.getRotation(entityId);
            const windAngle = this.windDirection - newHeading;
            const windAlignment = Math.cos(windAngle); // -1 = dead against, 1 = directly with wind
            const sailForce = input.throttle * sail.maxSpeed * windAlignment * (this.windSpeed / 5);

            // Apply drag (speed already computed above)
            const dragForce = speed * (1 - hull.drag);

            // Update velocity
            const forwardX = Math.sin(newHeading);
            const forwardZ = Math.cos(newHeading);

            let newVx = vel.vx + forwardX * sailForce * dt;
            let newVz = vel.vz + forwardZ * sailForce * dt;

            // Apply drag
            newVx *= hull.drag;
            newVz *= hull.drag;

            // Clamp to max speed
            const newSpeed = Math.sqrt(newVx * newVx + newVz * newVz);
            if (newSpeed > sail.maxSpeed) {
                const scale = sail.maxSpeed / newSpeed;
                newVx *= scale;
                newVz *= scale;
            }

            world.pool.setVelocity(entityId, newVx, vel.vy, newVz);
        }
    }
}

window.MovementSystem = MovementSystem;
