// Ship Archetype
const ShipArchetype = {
    name: 'ship',
    poolCap: 8,
    modelRef: 'Models/pawn1.glb',
    modelScale: 1.0,
    components: {
        position:    { x: 0, y: 0, z: 0 },
        velocity:    { vx: 0, vy: 0, vz: 0 },
        rotation:    { heading: 0 },
        sail:        { sailAngle: 0, sailState: 'full', maxSpeed: 20, turnRate: 0.05 },
        hull:        { maxHealth: 100, currentHealth: 100, mass: 500, drag: 0.95 },
        cannon:      { reloadTime: 3.0, cooldownRemaining: 0, portArc: 45, starboardArc: 45 },
        playerInput: { throttle: 0, rudder: 0, fireRequested: false, targetHeading: null, rudderLock: false }
    }
};

window.ShipArchetype = ShipArchetype;
