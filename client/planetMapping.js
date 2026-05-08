/**
 * PlanetMapping - Coordinate wrapping and spherical planet configuration
 *
 * Maps infinite flat world coordinates into bounded planet regions.
 * When a coordinate exceeds the wrap radius, it loops back seamlessly.
 * The shader then projects the flat terrain onto a sphere for visual curvature.
 */
class PlanetMapping {
    constructor() {
        // Default planet at origin
        this.planets = [{
            id: 'home',
            name: 'Home Planet',
            centerX: 0,
            centerZ: 0,
            wrapRadiusX: 128,
            wrapRadiusZ: 128,
            sphereRadius: 1000,
            atmosphereRadius: 1020
        }];

        this.activePlanet = this.planets[0];
        this.enabled = true;

        console.log('[PlanetMapping] Initialized with 1 planet:', this.activePlanet.name);
    }

    /**
     * Add a new planet configuration
     */
    addPlanet(config) {
        const planet = Object.assign({
            id: `planet_${this.planets.length}`,
            name: `Planet ${this.planets.length + 1}`,
            centerX: 0,
            centerZ: 0,
            wrapRadiusX: 128,
            wrapRadiusZ: 128,
            sphereRadius: 1000,
            atmosphereRadius: 1020
        }, config);
        this.planets.push(planet);
        console.log(`[PlanetMapping] Added planet: ${planet.name} at (${planet.centerX}, ${planet.centerZ})`);
        return planet;
    }

    /**
     * Get the planet that contains the given world coordinates.
     * For now, always returns the first planet (single planet mode).
     */
    getPlanetForCamera(worldX, worldZ) {
        // Single planet: always return the active planet
        // Future: find nearest planet based on distance to planet centers
        return this.activePlanet;
    }

    /**
     * Wrap a world coordinate into the planet's local space.
     * Uses modulo arithmetic for seamless looping.
     */
    wrapCoordinate(value, planet, axis) {
        if (!this.enabled || !planet) return value;

        const radius = axis === 'x' ? planet.wrapRadiusX : planet.wrapRadiusZ;
        const center = axis === 'x' ? planet.centerX : planet.centerZ;
        const diameter = radius * 2;

        // Shift to origin, wrap, shift back
        const shifted = value - center + radius;
        const wrapped = ((shifted % diameter) + diameter) % diameter;
        return wrapped - radius + center;
    }

    /**
     * Wrap a world position (x, z) into the planet's local space.
     */
    wrapPosition(worldX, worldZ, planet) {
        if (!planet) planet = this.activePlanet;
        return {
            x: this.wrapCoordinate(worldX, planet, 'x'),
            z: this.wrapCoordinate(worldZ, planet, 'z')
        };
    }

    /**
     * Get the shortest delta between two coordinates considering wrapping.
     * Useful for movement interpolation across wrap boundaries.
     */
    wrapDelta(from, to, planet, axis) {
        if (!this.enabled || !planet) return to - from;

        const radius = axis === 'x' ? planet.wrapRadiusX : planet.wrapRadiusZ;
        const diameter = radius * 2;
        let delta = to - from;

        // If delta is more than half the diameter, wrap the other way
        if (delta > radius) delta -= diameter;
        if (delta < -radius) delta += diameter;

        return delta;
    }

    /**
     * Set the active planet by ID
     */
    setActivePlanet(planetId) {
        const planet = this.planets.find(p => p.id === planetId);
        if (planet) {
            this.activePlanet = planet;
            console.log(`[PlanetMapping] Active planet set to: ${planet.name}`);
            return true;
        }
        console.warn(`[PlanetMapping] Planet not found: ${planetId}`);
        return false;
    }

    /**
     * Update planet configuration (e.g., from parameter system)
     */
    updatePlanetConfig(planetId, config) {
        const planet = this.planets.find(p => p.id === planetId);
        if (planet) {
            Object.assign(planet, config);
            console.log(`[PlanetMapping] Updated planet ${planet.name}:`, config);
            return true;
        }
        return false;
    }

    /**
     * Enable/disable wrapping (for toggling planet mode)
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[PlanetMapping] Wrapping ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlanetMapping;
}
