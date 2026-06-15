// Cannonball Archetype
const CannonballArchetype = {
    name: 'cannonball',
    poolCap: 64,
    modelRef: null,
    modelScale: 0.3,
    components: {
        position:    { x: 0, y: 0, z: 0 },
        velocity:    { vx: 0, vy: 0, vz: 0 },
        rotation:    { heading: 0 },
        projectile:  { damage: 25, sourceEntityId: -1 },
        lifetime:    { ttl: 10.0, elapsed: 0 }
    }
};

window.CannonballArchetype = CannonballArchetype;
