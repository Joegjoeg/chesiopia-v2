// RoadSystem — Path emergence from villager movement, road visuals, lamp posts, and arterial roads

class RoadSystem {
    constructor(scene, terrainSystem, settlementSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.settlementSystem = settlementSystem;

        this.roadSegments = new Map();
        this.roadMeshes = new Map();
        this.arterialRoads = [];

        this.pathStrengthDecay = 0.001;
        this.maxPathStrength = 200;

        this.roadMaterialCache = {};
    }

    init() {
        console.log('[RoadSystem] Initialized');
    }

    recordMovement(fromNode, toNode, settlement) {
        if (!fromNode || !toNode) return;
        if (fromNode === toNode) return;

        const key = this.getSegmentKey(fromNode, toNode);
        let segment = this.roadSegments.get(key);

        if (!segment) {
            segment = {
                key,
                from: { x: fromNode.x, z: fromNode.z },
                to: { x: toNode.x, z: toNode.z },
                strength: 0,
                settlementId: settlement.id,
                _mesh: null
            };
            this.roadSegments.set(key, segment);
        }

        segment.strength = Math.min(this.maxPathStrength, segment.strength + 1);
        this.updateRoadVisual(segment, settlement);
    }

    getSegmentKey(a, b) {
        const ax = Math.round(a.x * 10) / 10;
        const az = Math.round(a.z * 10) / 10;
        const bx = Math.round(b.x * 10) / 10;
        const bz = Math.round(b.z * 10) / 10;
        if (ax < bx || (ax === bx && az < bz)) {
            return `${ax},${az}_${bx},${bz}`;
        }
        return `${bx},${bz}_${ax},${az}`;
    }

    updateRoadVisual(segment, settlement) {
        const roadType = this.getRoadType(segment.strength);
        if (!roadType) {
            if (segment._mesh) {
                settlement._group.remove(segment._mesh);
                segment._mesh = null;
            }
            return;
        }

        if (!segment._mesh) {
            segment._mesh = this.createRoadMesh(segment, roadType);
            if (segment._mesh) {
                settlement._group.add(segment._mesh);
            }
        } else {
            segment._mesh.material.color.setHex(roadType.color);
            const scale = roadType.width / 0.5;
            segment._mesh.scale.x = scale;
        }
    }

    getRoadType(strength) {
        if (strength >= ROAD_TYPES.arterialRoad.strength) return ROAD_TYPES.arterialRoad;
        if (strength >= ROAD_TYPES.villageRoad.strength) return ROAD_TYPES.villageRoad;
        if (strength >= ROAD_TYPES.dirtPath.strength) return ROAD_TYPES.dirtPath;
        return null;
    }

    createRoadMesh(segment, roadType) {
        const midX = (segment.from.x + segment.to.x) / 2;
        const midZ = (segment.from.z + segment.to.z) / 2;
        const dx = segment.to.x - segment.from.x;
        const dz = segment.to.z - segment.from.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);

        const midY = this.terrainSystem
            ? this.terrainSystem.getHeight(midX, midZ)
            : 0;

        if (midY < -1.5) return null;

        const geo = new THREE.PlaneGeometry(0.5, length);
        const mat = new THREE.MeshLambertMaterial({
            color: roadType.color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = angle;
        mesh.position.set(midX, midY + 0.03, midZ);
        mesh.receiveShadow = true;

        return mesh;
    }

    updateSettlementRoads(settlement) {
        for (const [key, segment] of this.roadSegments) {
            if (segment.settlementId !== settlement.id) continue;

            segment.strength = Math.max(0, segment.strength - this.pathStrengthDecay);
            this.updateRoadVisual(segment, settlement);

            if (segment.strength <= 0 && segment._mesh) {
                settlement._group.remove(segment._mesh);
                segment._mesh = null;
                this.roadSegments.delete(key);
            }
        }

        this.updateLampPosts(settlement);
    }

    updateLampPosts(settlement) {
        if (!settlement.typeDef.hasLampPosts) return;

        const existingLamps = settlement.buildings.filter(b => b.type === 'lampPost').length;

        const maintainedSegments = [];
        for (const [key, segment] of this.roadSegments) {
            if (segment.settlementId === settlement.id && segment.strength >= ROAD_TYPES.villageRoad.strength) {
                maintainedSegments.push(segment);
            }
        }

        const desiredLamps = Math.min(maintainedSegments.length * 2, 20);
        if (existingLamps < desiredLamps && maintainedSegments.length > 0) {
            const seg = maintainedSegments[Math.floor(Math.random() * maintainedSegments.length)];
            const t = 0.3 + Math.random() * 0.4;
            const lx = lerp(seg.from.x, seg.to.x, t);
            const lz = lerp(seg.from.z, seg.to.z, t);
            this.settlementSystem.buildingSystem.addBuilding(settlement, 'lampPost', lx, lz);
        }
    }

    updateArterialRoads(settlements) {
        const active = settlements.filter(s => s._active && s.type === 'village');
        if (active.length < 2) return;

        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                const a = active[i];
                const b = active[j];
                const dist = distance2D(a, b);

                if (dist > 200) continue;

                const key = `arterial_${Math.min(a.id, b.id)}_${Math.max(a.id, b.id)}`;
                const existing = this.arterialRoads.find(r => r.key === key);
                if (existing) continue;

                const road = this.createArterialRoad(a, b, key);
                if (road) {
                    this.arterialRoads.push(road);
                }
            }
        }
    }

    createArterialRoad(settlementA, settlementB, key) {
        const points = this.generateCurvedPath(settlementA, settlementB);
        if (points.length < 2) return null;

        const roadGroup = new THREE.Group();
        roadGroup.name = `Arterial_${settlementA.name}_${settlementB.name}`;

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const dx = p1.x - p0.x;
            const dz = p1.z - p0.z;
            const length = Math.sqrt(dx * dx + dz * dz);
            const angle = Math.atan2(dx, dz);
            const midX = (p0.x + p1.x) / 2;
            const midZ = (p0.z + p1.z) / 2;
            const midY = this.terrainSystem ? this.terrainSystem.getHeight(midX, midZ) : 0;

            if (midY < -1.5) continue;

            const geo = new THREE.PlaneGeometry(1.2, length);
            const mat = new THREE.MeshLambertMaterial({
                color: ROAD_TYPES.arterialRoad.color,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.z = angle;
            mesh.position.set(midX, midY + 0.04, midZ);
            mesh.receiveShadow = true;
            roadGroup.add(mesh);
        }

        this.scene.add(roadGroup);

        return {
            key,
            settlementA: settlementA.id,
            settlementB: settlementB.id,
            points,
            _group: roadGroup
        };
    }

    generateCurvedPath(a, b) {
        const points = [];
        const steps = 12;
        const midX = (a.x + b.x) / 2;
        const midZ = (a.z + b.z) / 2;
        const dist = distance2D(a, b);
        const perpX = -(b.z - a.z) / Math.max(0.1, dist);
        const perpZ = (b.x - a.x) / Math.max(0.1, dist);
        const curveAmount = (Math.random() - 0.5) * dist * 0.2;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = lerp(a.x, b.x, t);
            const z = lerp(a.z, b.z, t);
            const curveOffset = Math.sin(t * Math.PI) * curveAmount;

            let cx = x + perpX * curveOffset;
            let cz = z + perpZ * curveOffset;

            if (this.terrainSystem) {
                if (this.terrainSystem.isTileBlocked && this.terrainSystem.isTileBlocked(cx, cz)) {
                    cx = x;
                    cz = z;
                }
                const cy = this.terrainSystem.getHeight(cx, cz);
                if (cy < -1.5) {
                    cx = x;
                    cz = z;
                }
                points.push({ x: cx, z: cz, y: this.terrainSystem.getHeight(cx, cz) });
            } else {
                points.push({ x: cx, z: cz, y: 0 });
            }
        }

        return points;
    }

    dispose() {
        for (const [key, segment] of this.roadSegments) {
            if (segment._mesh) {
                segment._mesh.geometry && segment._mesh.geometry.dispose();
                segment._mesh.material && segment._mesh.material.dispose();
            }
        }
        this.roadSegments.clear();

        for (const road of this.arterialRoads) {
            if (road._group) {
                this.scene.remove(road._group);
                road._group.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
            }
        }
        this.arterialRoads = [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RoadSystem;
}
