/**
 * Shadow Baker Core
 * Grid-based raycasting to generate shadow geometry from a model at a given sun angle.
 */
class ShadowBaker {
    constructor(scene, sunLight) {
        this.scene = scene;
        this.sunLight = sunLight;
        this.raycaster = new THREE.Raycaster();
        this.currentSet = null;
    }

    /**
     * Bake shadow for a single angle.
     * @param {THREE.Object3D} model - The model to cast shadow
     * @param {Object} params - Bake parameters
     * @param {number} params.gridResolution - Cells per side (e.g., 32)
     * @param {number} params.worldSize - World-space size of the grid (e.g., 3.0)
     * @param {number} params.groundY - Ground plane Y (default 0)
     * @param {number} params.azimuth - Sun azimuth in degrees
     * @param {number} params.elevation - Sun elevation in degrees
     * @param {number} params.lightHeight - Height of the directional light
     * @returns {Object} Shadow mesh data for this angle
     */
    bakeSingleAngle(model, params) {
        const {
            gridResolution = 32,
            worldSize = 3.0,
            groundY = 0,
            azimuth = 0,
            elevation = 45,
            lightHeight = 50
        } = params;

        const halfSize = worldSize / 2;
        const cellSize = worldSize / gridResolution;
        const center = this.getModelCenter(model);

        // Compute sun position in world space
        const sunPos = this.getSunPosition(azimuth, elevation, lightHeight, center);

        // Collect all mesh geometries from the model for intersection
        const meshes = [];
        model.traverse(child => {
            if (child.isMesh && child.geometry) {
                meshes.push(child);
            }
        });

        // Grid cell occupancy array (true = in shadow)
        const occupancy = new Array(gridResolution * gridResolution).fill(false);

        // For each grid cell, cast a ray from the cell toward the sun
        for (let gx = 0; gx < gridResolution; gx++) {
            for (let gz = 0; gz < gridResolution; gz++) {
                // World position of this cell center on the ground plane (slightly above to avoid self-hit)
                const wx = center.x - halfSize + (gx + 0.5) * cellSize;
                const wz = center.z - halfSize + (gz + 0.5) * cellSize;
                const cellPos = new THREE.Vector3(wx, groundY + 0.02, wz);

                // Ray direction: from cell toward sun
                const rayDir = new THREE.Vector3().subVectors(sunPos, cellPos).normalize();

                // Cast ray from cell upward toward sun
                this.raycaster.set(cellPos, rayDir);
                const intersects = this.raycaster.intersectObjects(meshes, false);

                // If we hit any model mesh before reaching the sun, this cell is in shadow
                if (intersects.length > 0) {
                    // Check that the hit is between the cell and the sun (not behind)
                    const hit = intersects[0];
                    const distToHit = hit.distance;
                    const distToSun = cellPos.distanceTo(sunPos);
                    if (distToHit < distToSun - 0.01) {
                        occupancy[gz * gridResolution + gx] = true;
                    }
                }
            }
        }

        // Build mesh from occupancy grid
        const meshData = this.buildMeshFromOccupancy(
            occupancy, gridResolution, worldSize, center, groundY
        );

        return {
            azimuth,
            elevation,
            occupancy,
            meshData
        };
    }

    /**
     * Build a shadow mesh from occupancy data.
     * Creates vertices for each grid cell with height = 1 if shadow, 0 if not.
     * Also triangulates contiguous shadow regions for a cleaner mesh.
     */
    buildMeshFromOccupancy(occupancy, resolution, worldSize, center, groundY) {
        const halfSize = worldSize / 2;
        const cellSize = worldSize / resolution;

        // Two approaches: point cloud per cell (simple morphing) or triangulated (cleaner)
        // For morphing, we want identical topology per angle, so use a uniform grid of vertices
        const vertices = [];
        const indices = [];
        const heights = []; // Just the height data (0 or 1) for this angle

        // Create a vertex per grid cell center
        for (let gz = 0; gz < resolution; gz++) {
            for (let gx = 0; gx < resolution; gx++) {
                const wx = center.x - halfSize + (gx + 0.5) * cellSize;
                const wz = center.z - halfSize + (gz + 0.5) * cellSize;
                const inShadow = occupancy[gz * resolution + gx];
                const h = inShadow ? 1.0 : 0.0;

                vertices.push(wx, groundY + h * 0.02, wz); // Slight height for visibility
                heights.push(h);
            }
        }

        // Create triangles for each quad
        for (let gz = 0; gz < resolution - 1; gz++) {
            for (let gx = 0; gx < resolution - 1; gx++) {
                const i = gz * resolution + gx;
                // Two triangles per quad
                indices.push(i, i + 1, i + resolution);
                indices.push(i + 1, i + resolution + 1, i + resolution);
            }
        }

        // Compute face normals for lighting (though we'll use MeshBasicMaterial)
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return {
            vertices,
            indices,
            heights,
            resolution,
            worldSize,
            cellSize
        };
    }

    getModelCenter(model) {
        const box = new THREE.Box3().setFromObject(model);
        return box.getCenter(new THREE.Vector3());
    }

    getSunPosition(azimuthDeg, elevationDeg, height, target) {
        const azimuth = THREE.Math.degToRad(azimuthDeg);
        const elevation = THREE.Math.degToRad(elevationDeg);
        const r = height;

        const x = target.x + r * Math.cos(elevation) * Math.sin(azimuth);
        const y = target.y + r * Math.sin(elevation);
        const z = target.z + r * Math.cos(elevation) * Math.cos(azimuth);

        return new THREE.Vector3(x, y, z);
    }

    /**
     * Bake all angles and create a ShadowSet.
     */
    bakeAllAngles(model, params) {
        const numAngles = params.numAngles || 12;
        const elevation = params.elevation || 45;
        const lightHeight = params.lightHeight || 50;

        // Reset model to neutral pose before baking
        if (model.userData._treeGenerator && model.userData._treeGenerator.resetTree) {
            model.userData._treeGenerator.resetTree(model);
        }

        const angles = [];
        for (let i = 0; i < numAngles; i++) {
            const azimuth = (i / numAngles) * 360;
            angles.push({
                azimuth,
                elevation,
                lightHeight
            });
        }

        const bakedAngles = [];
        for (const angle of angles) {
            const result = this.bakeSingleAngle(model, {
                ...params,
                ...angle
            });
            bakedAngles.push(result);
        }

        // Store the set
        this.currentSet = {
            gridResolution: params.gridResolution,
            worldSize: params.worldSize,
            groundY: params.groundY || 0,
            numAngles: bakedAngles.length,
            angles: bakedAngles.map(a => ({
                azimuth: a.azimuth,
                elevation: a.elevation,
                heights: a.meshData.heights
            })),
            indexBuffer: bakedAngles[0].meshData.indices,
            metadata: {
                bakedAt: Date.now(),
                modelType: params.modelType || 'unknown'
            }
        };

        return this.currentSet;
    }

    /**
     * Create a preview shadow mesh from a single baked angle result.
     * Use MeshBasicMaterial with dark color and transparency.
     */
    createPreviewMesh(meshData, wireframe = false) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
        geometry.setIndex(meshData.indices);
        geometry.computeVertexNormals();

        // Ensure positions are set correctly for visibility
        const positions = geometry.attributes.position;
        positions.needsUpdate = true;

        const material = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            side: THREE.DoubleSide,
            wireframe: wireframe
        });

        return new THREE.Mesh(geometry, material);
    }

    /**
     * Build a preview mesh from an occupancy array (for previewing baked results).
     */
    createPreviewFromHeights(heights, resolution, worldSize, center, groundY = 0, wireframe = false) {
        const occupancy = heights.map(h => h > 0.5);
        const meshData = this.buildMeshFromOccupancy(occupancy, resolution, worldSize, center, groundY);
        return this.createPreviewMesh(meshData, wireframe);
    }

    /**
     * For live preview: bake just the current sun position and return a mesh.
     */
    bakePreview(model, params, wireframe = false) {
        const result = this.bakeSingleAngle(model, params);
        const mesh = this.createPreviewMesh(result.meshData, wireframe);
        // Store as single-angle set for export fallback
        this.currentSet = {
            gridResolution: params.gridResolution,
            worldSize: params.worldSize,
            groundY: params.groundY || 0,
            numAngles: 1,
            angles: [{
                azimuth: params.azimuth,
                elevation: params.elevation,
                heights: result.meshData.heights
            }],
            indexBuffer: result.meshData.indices,
            metadata: { preview: true }
        };
        return { mesh, result };
    }
}

window.ShadowBaker = ShadowBaker;
