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
        this._pierMaterial = null;
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
                this._disposeGroup(segment._mesh);
                segment._mesh = null;
            }
            return;
        }

        if (!segment._mesh || !segment._mesh.userData || segment._mesh.userData.width !== roadType.width) {
            if (segment._mesh) {
                settlement._group.remove(segment._mesh);
                this._disposeGroup(segment._mesh);
            }
            segment._mesh = this.createRoadMesh(segment, roadType);
            if (segment._mesh) {
                settlement._group.add(segment._mesh);
            }
        } else {
            // Color the road mesh (first child)
            const roadMesh = segment._mesh.children.find(c => c.userData && c.userData.width !== undefined);
            if (roadMesh) roadMesh.material.color.setHex(roadType.color);
        }
    }

    getRoadType(strength) {
        if (strength >= ROAD_TYPES.arterialRoad.strength) return ROAD_TYPES.arterialRoad;
        if (strength >= ROAD_TYPES.villageRoad.strength) return ROAD_TYPES.villageRoad;
        if (strength >= ROAD_TYPES.dirtPath.strength) return ROAD_TYPES.dirtPath;
        return null;
    }

    _getPierMaterial() {
        const settings = window.bridgeSettings || {
            brickSize: 0.5,
            brickColor: '#8B4513',
            mortarColor: '#C0C0C0'
        };
        const brickColor = settings.brickColor || '#8B4513';
        const mortarColor = settings.mortarColor || '#C0C0C0';
        const brickSize = settings.brickSize || 0.5;

        // If settings unchanged and material exists, return cached material
        if (this._pierMaterial &&
            this._pierMaterial._lastBrickColor === brickColor &&
            this._pierMaterial._lastMortarColor === mortarColor &&
            this._pierMaterial._lastBrickSize === brickSize) {
            return this._pierMaterial;
        }

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Fill mortar background
        ctx.fillStyle = mortarColor;
        ctx.fillRect(0, 0, 256, 256);

        const rows = 8;
        const cols = 4;
        const brickH = 256 / rows;
        const brickW = 256 / cols;
        const mortarW = 4;

        for (let r = 0; r < rows; r++) {
            const offset = (r % 2) * (brickW / 2);
            for (let c = -1; c < cols + 1; c++) {
                const x = c * brickW + offset + mortarW / 2;
                const y = r * brickH + mortarW / 2;
                const w = brickW - mortarW;
                const h = brickH - mortarW;
                if (x + w < 0 || x > 256) continue;
                ctx.fillStyle = brickColor;
                ctx.fillRect(x, y, w, h);
                // Subtle highlight
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fillRect(x, y, w, h / 2);
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1 / brickSize, 1 / brickSize);
        texture.colorSpace = THREE.SRGBColorSpace;

        if (this._pierMaterial) {
            // Update existing shared material so all piers refresh live
            const oldMap = this._pierMaterial.map;
            this._pierMaterial.map = texture;
            this._pierMaterial.needsUpdate = true;
            if (oldMap) oldMap.dispose();
        } else {
            this._pierMaterial = new THREE.MeshLambertMaterial({ map: texture });
        }

        this._pierMaterial._lastBrickColor = brickColor;
        this._pierMaterial._lastMortarColor = mortarColor;
        this._pierMaterial._lastBrickSize = brickSize;
        return this._pierMaterial;
    }

    _createPierGeometry(halfW, height) {
        const geo = new THREE.BoxGeometry(halfW * 2, height, halfW * 2);
        const pos = geo.attributes.position;
        const uv = geo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            const ax = Math.abs(x);
            const ay = Math.abs(y);
            const az = Math.abs(z);
            const maxVal = Math.max(ax, ay, az);
            const eps = 0.001;
            if (Math.abs(ax - maxVal) < eps) {
                // Left / Right face -> map (z, y) to (u, v)
                uv.setXY(i, (z + halfW) / (halfW * 2), (y + height / 2) / height);
            } else if (Math.abs(ay - maxVal) < eps) {
                // Top / Bottom face -> map (x, z) to (u, v)
                uv.setXY(i, (x + halfW) / (halfW * 2), (z + halfW) / (halfW * 2));
            } else {
                // Front / Back face -> map (x, y) to (u, v)
                uv.setXY(i, (x + halfW) / (halfW * 2), (y + height / 2) / height);
            }
        }
        return geo;
    }

    _buildRoadGeometry(centerPoints, carriagewayWidth, aggerWidth, aggerDepth, roadColor, waterLevel) {
        if (!centerPoints || centerPoints.length < 2) return null;

        const roadThickness = 0.05;
        const waterBuffer = 0.3;
        const bridgeClearance = 0.8;
        const archSpan = 4.5;
        const maxGrade = 0.15; // tan(~8.5 deg)
        const aggerEmbed = 0.05;

        const perps = [];
        for (let i = 0; i < centerPoints.length; i++) {
            let dx, dz;
            if (i === 0) {
                dx = centerPoints[1].x - centerPoints[0].x;
                dz = centerPoints[1].z - centerPoints[0].z;
            } else if (i === centerPoints.length - 1) {
                dx = centerPoints[i].x - centerPoints[i - 1].x;
                dz = centerPoints[i].z - centerPoints[i - 1].z;
            } else {
                dx = centerPoints[i + 1].x - centerPoints[i - 1].x;
                dz = centerPoints[i + 1].z - centerPoints[i - 1].z;
            }
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            perps.push({ x: -dz / len, z: dx / len });
        }

        const isWater = centerPoints.map(p => p.y < waterLevel + waterBuffer);

        // Target heights: land follows terrain (+thickness), water is flat bridge deck
        const roadY = centerPoints.map((p, i) =>
            isWater[i] ? waterLevel + bridgeClearance : p.y + roadThickness
        );

        // Grade-limit the road surface; water points act as fixed anchors
        for (let pass = 0; pass < 20; pass++) {
            let changed = false;
            for (let i = 1; i < centerPoints.length; i++) {
                const dx = centerPoints[i].x - centerPoints[i - 1].x;
                const dz = centerPoints[i].z - centerPoints[i - 1].z;
                const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
                const maxDy = maxGrade * dist;
                if (roadY[i] > roadY[i - 1] + maxDy) {
                    if (!isWater[i]) { roadY[i] = roadY[i - 1] + maxDy; changed = true; }
                    else if (!isWater[i - 1]) { roadY[i - 1] = roadY[i] - maxDy; changed = true; }
                } else if (roadY[i] < roadY[i - 1] - maxDy) {
                    if (!isWater[i]) { roadY[i] = roadY[i - 1] - maxDy; changed = true; }
                    else if (!isWater[i - 1]) { roadY[i - 1] = roadY[i] + maxDy; changed = true; }
                }
            }
            for (let i = centerPoints.length - 2; i >= 0; i--) {
                const dx = centerPoints[i + 1].x - centerPoints[i].x;
                const dz = centerPoints[i + 1].z - centerPoints[i].z;
                const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
                const maxDy = maxGrade * dist;
                if (roadY[i + 1] > roadY[i] + maxDy) {
                    if (!isWater[i]) { roadY[i] = roadY[i + 1] - maxDy; changed = true; }
                    else if (!isWater[i + 1]) { roadY[i + 1] = roadY[i] + maxDy; changed = true; }
                } else if (roadY[i + 1] < roadY[i] - maxDy) {
                    if (!isWater[i]) { roadY[i] = roadY[i + 1] + maxDy; changed = true; }
                    else if (!isWater[i + 1]) { roadY[i + 1] = roadY[i] - maxDy; changed = true; }
                }
            }
            if (!changed) break;
        }

        const pointData = centerPoints.map((p, i) => ({
            isWater: isWater[i],
            roadY: roadY[i],
            terrainY: p.y,
            bottomY: 0,
            aggerWidth: carriagewayWidth
        }));

        // Simple extrusion: land = embankment, water = thin deck slab only
        for (let i = 0; i < pointData.length; i++) {
            if (pointData[i].isWater) {
                pointData[i].bottomY = pointData[i].roadY - 0.15;
                pointData[i].aggerWidth = carriagewayWidth;
            } else {
                pointData[i].bottomY = pointData[i].terrainY - aggerEmbed;
                const minBase = pointData[i].roadY - 0.15;
                if (pointData[i].bottomY > minBase) {
                    pointData[i].bottomY = minBase;
                }
                pointData[i].aggerWidth = aggerWidth;
            }
        }

        const vertices = [];
        const indices = [];

        for (let i = 0; i < centerPoints.length; i++) {
            const cp = centerPoints[i];
            const pd = pointData[i];
            const p = perps[i];
            const cw = carriagewayWidth / 2;
            const aw = pd.aggerWidth / 2;

            vertices.push(cp.x + p.x * cw, pd.roadY, cp.z + p.z * cw);
            vertices.push(cp.x - p.x * cw, pd.roadY, cp.z - p.z * cw);
            vertices.push(cp.x + p.x * aw, pd.bottomY, cp.z + p.z * aw);
            vertices.push(cp.x - p.x * aw, pd.bottomY, cp.z - p.z * aw);
        }

        for (let i = 0; i < centerPoints.length - 1; i++) {
            const b = i * 4;
            const n = (i + 1) * 4;

            indices.push(b, n, b + 1);
            indices.push(b + 1, n, n + 1);

            indices.push(b, b + 2, n);
            indices.push(n, b + 2, n + 2);

            indices.push(b + 1, n + 1, b + 3);
            indices.push(b + 3, n + 1, n + 3);

            indices.push(b + 2, n + 2, b + 3);
            indices.push(b + 3, n + 2, n + 3);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        // Build arch and pier transforms for water spans (separate cloned geometry)
        const pierTransforms = [];
        const spans = [];
        let start = -1;
        for (let i = 0; i < pointData.length; i++) {
            if (pointData[i].isWater && start === -1) start = i;
            if (!pointData[i].isWater && start !== -1) {
                spans.push({ start, end: i - 1 });
                start = -1;
            }
        }
        if (start !== -1) spans.push({ start, end: pointData.length - 1 });

        for (const span of spans) {
            const dists = [0];
            for (let i = span.start + 1; i <= span.end; i++) {
                const dx = centerPoints[i].x - centerPoints[i - 1].x;
                const dz = centerPoints[i].z - centerPoints[i - 1].z;
                dists.push(dists[dists.length - 1] + Math.sqrt(dx * dx + dz * dz));
            }
            const totalDist = dists[dists.length - 1];
            if (totalDist < 0.1) continue;

            const numArches = Math.max(2, Math.round(totalDist / archSpan));
            const pierSpacing = totalDist / numArches;

            const deckBottom = waterLevel + bridgeClearance - 0.05;
            const pierBase = waterLevel - 0.3;
            const drop = Math.max(0.4, deckBottom - pierBase);
            const pierHalfW = carriagewayWidth * 0.25; // each pier is half road width, two side by side
            const pierOffset = carriagewayWidth * 0.25; // distance from centreline to each pier centre
            for (let p = 0; p <= numArches; p++) {
                const targetDist = p * pierSpacing;
                let bestIdx = span.start;
                let bestDiff = Infinity;
                for (let i = span.start; i <= span.end; i++) {
                    const d = Math.abs(dists[i - span.start] - targetDist);
                    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
                }
                const cp = centerPoints[bestIdx];
                let rdx, rdz;
                if (bestIdx === 0) {
                    rdx = centerPoints[1].x - centerPoints[0].x;
                    rdz = centerPoints[1].z - centerPoints[0].z;
                } else if (bestIdx === centerPoints.length - 1) {
                    rdx = centerPoints[bestIdx].x - centerPoints[bestIdx - 1].x;
                    rdz = centerPoints[bestIdx].z - centerPoints[bestIdx - 1].z;
                } else {
                    rdx = centerPoints[bestIdx + 1].x - centerPoints[bestIdx - 1].x;
                    rdz = centerPoints[bestIdx + 1].z - centerPoints[bestIdx - 1].z;
                }
                const angle = Math.atan2(rdx, rdz);
                const perpX = Math.sin(angle); // perpendicular to road direction
                const perpZ = Math.cos(angle);

                let pierBottom = waterLevel - 0.3;
                if (this.terrainSystem && this.terrainSystem.getHeight) {
                    const terrainY = this.terrainSystem.getHeight(cp.x, cp.z);
                    pierBottom = Math.min(terrainY, waterLevel) - 0.2;
                }
                const pierHeight = Math.max(0.4, deckBottom - pierBottom);
                const pierY = deckBottom - pierHeight / 2;

                // Left pier
                pierTransforms.push({
                    x: cp.x + perpX * pierOffset,
                    y: pierY,
                    z: cp.z + perpZ * pierOffset,
                    ry: angle,
                    halfW: pierHalfW,
                    height: pierHeight
                });
                // Right pier
                pierTransforms.push({
                    x: cp.x - perpX * pierOffset,
                    y: pierY,
                    z: cp.z - perpZ * pierOffset,
                    ry: angle,
                    halfW: pierHalfW,
                    height: pierHeight
                });
            }
        }

        return { geometry: geo, pierTransforms };
    }

    createRoadMesh(segment, roadType) {
        const fromY = this.terrainSystem ? this.terrainSystem.getHeight(segment.from.x, segment.from.z) : 0;
        const toY = this.terrainSystem ? this.terrainSystem.getHeight(segment.to.x, segment.to.z) : 0;
        const midX = (segment.from.x + segment.to.x) / 2;
        const midZ = (segment.from.z + segment.to.z) / 2;
        const midY = this.terrainSystem ? this.terrainSystem.getHeight(midX, midZ) : 0;

        const waterLevel = this.terrainSystem && this.terrainSystem._currentWaterLevel
            ? this.terrainSystem._currentWaterLevel()
            : -1.5;

        const points = [
            { x: segment.from.x, z: segment.from.z, y: fromY },
            { x: midX, z: midZ, y: midY },
            { x: segment.to.x, z: segment.to.z, y: toY }
        ];

        const aggerWidth = roadType.width * 1.8;
        const aggerDepth = 0.4;

        const result = this._buildRoadGeometry(points, roadType.width, aggerWidth, aggerDepth, roadType.color, waterLevel);
        if (!result) return null;

        const mat = new THREE.MeshLambertMaterial({
            color: roadType.color,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -1.0
        });

        const group = new THREE.Group();
        const mesh = new THREE.Mesh(result.geometry, mat);
        mesh.receiveShadow = true;
        mesh.userData.width = roadType.width;
        group.add(mesh);

        const pierMat = this._getPierMaterial();
        for (const t of result.pierTransforms) {
            const pierGeo = this._createPierGeometry(t.halfW, t.height);
            const pier = new THREE.Mesh(pierGeo, pierMat);
            pier.position.set(t.x, t.y, t.z);
            pier.rotation.y = t.ry;
            pier.castShadow = true;
            pier.receiveShadow = true;
            group.add(pier);
        }

        return group;
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
            this.settlementSystem.buildingSystem.attachComponent(settlement, 'lampPost');
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

        const waterLevel = this.terrainSystem && this.terrainSystem._currentWaterLevel
            ? this.terrainSystem._currentWaterLevel()
            : -1.5;

        const aggerWidth = 1.2 * 1.8;
        const aggerDepth = 0.6;

        const result = this._buildRoadGeometry(points, 1.2, aggerWidth, aggerDepth, ROAD_TYPES.arterialRoad.color, waterLevel);
        if (!result) return null;

        const mat = new THREE.MeshLambertMaterial({
            color: ROAD_TYPES.arterialRoad.color,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -1.0
        });

        const group = new THREE.Group();
        const mesh = new THREE.Mesh(result.geometry, mat);
        mesh.receiveShadow = true;
        mesh.name = `Arterial_${settlementA.name}_${settlementB.name}`;
        group.add(mesh);

        const pierMat = this._getPierMaterial();
        for (const t of result.pierTransforms) {
            const pierGeo = this._createPierGeometry(t.halfW, t.height);
            const pier = new THREE.Mesh(pierGeo, pierMat);
            pier.position.set(t.x, t.y, t.z);
            pier.rotation.y = t.ry;
            pier.castShadow = true;
            pier.receiveShadow = true;
            group.add(pier);
        }

        this.scene.add(group);

        return {
            key,
            settlementA: settlementA.id,
            settlementB: settlementB.id,
            points,
            _mesh: group
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

    _disposeGroup(group) {
        if (!group) return;
        group.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => {
                        if (m !== this._pierMaterial) m.dispose();
                    });
                } else if (child.material !== this._pierMaterial) {
                    child.material.dispose();
                }
            }
        });
    }

    dispose() {
        for (const [key, segment] of this.roadSegments) {
            if (segment._mesh) {
                this._disposeGroup(segment._mesh);
            }
        }
        this.roadSegments.clear();

        for (const road of this.arterialRoads) {
            if (road._mesh) {
                this.scene.remove(road._mesh);
                this._disposeGroup(road._mesh);
            }
        }
        this.arterialRoads = [];

        if (this._pierMaterial) {
            if (this._pierMaterial.map) this._pierMaterial.map.dispose();
            this._pierMaterial.dispose();
            this._pierMaterial = null;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RoadSystem;
}
