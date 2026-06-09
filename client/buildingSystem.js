// BuildingSystem — Building placement logic, thresholds, and visual meshes for settlements

class BuildingSystem {
    constructor(scene, terrainSystem, settlementSystem) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.settlementSystem = settlementSystem;

        this.buildingGeometries = {};
        this.buildingMaterials = {};
        this.buildingIdCounter = 0;

        this._scratchVec = new THREE.Vector3();
    }

    init() {
        this._initMaterials();
        console.log('[BuildingSystem] Initialized');
    }

    _initMaterials() {
        this.materials = {
            wall:       new THREE.MeshLambertMaterial({ color: 0xc8b896 }),
            wallDark:   new THREE.MeshLambertMaterial({ color: 0xb8a886 }),
            roof:       new THREE.MeshLambertMaterial({ color: 0x8b4513 }),
            roofDark:   new THREE.MeshLambertMaterial({ color: 0x6b3410 }),
            wood:       new THREE.MeshLambertMaterial({ color: 0x8b6914 }),
            woodDark:   new THREE.MeshLambertMaterial({ color: 0x6b4a0a }),
            stone:      new THREE.MeshLambertMaterial({ color: 0x9a9588 }),
            field:      new THREE.MeshLambertMaterial({ color: 0x7c9c3e, side: THREE.DoubleSide }),
            water:      new THREE.MeshLambertMaterial({ color: 0x3a6b8c, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
            gold:       new THREE.MeshLambertMaterial({ color: 0xffd700 }),
            thatch:     new THREE.MeshLambertMaterial({ color: 0xd4c5a0 }),
            maypole:    new THREE.MeshLambertMaterial({ color: 0xdeb887 }),
            lampGlow:   new THREE.MeshBasicMaterial({ color: 0xffdd88 }),
            fence:      new THREE.MeshLambertMaterial({ color: 0x8b6914 }),
            grass:      new THREE.MeshLambertMaterial({ color: 0x5a8a3a, side: THREE.DoubleSide }),
            fieldWall:  new THREE.MeshLambertMaterial({ color: 0x8b7355 }),
            door:       new THREE.MeshLambertMaterial({ color: 0x4a3728 }),
        };
    }

    _seededRandom(seed) {
        let s = seed;
        return () => {
            s = (s * 16807 + 0) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    _hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
        }
        return Math.abs(hash);
    }

    _getRand(settlement) {
        if (!settlement._rand) {
            const seed = this._hashString(settlement.id || 'settlement_0');
            settlement._rand = this._seededRandom(seed);
        }
        return settlement._rand;
    }

    _sampleTerrainHeight(x, z) {
        if (!this.terrainSystem || typeof this.terrainSystem.getHeight !== 'function') return 0;
        return this.terrainSystem.getHeight(x, z);
    }

    _getWaterLevel() {
        return this.settlementSystem?.game?.boardSystem?.waterLevel ?? -1.5;
    }

    _removeComponent(settlement, building) {
        const compIdx = (settlement._components || []).findIndex(c => c.group === building._mesh);
        if (compIdx >= 0) {
            const comp = settlement._components[compIdx];
            for (const hp of comp.hardpoints || []) {
                const idx = settlement._hardpoints.indexOf(hp);
                if (idx >= 0) settlement._hardpoints.splice(idx, 1);
            }
            settlement._components.splice(compIdx, 1);
        }
        if (building._hardpointIndex >= 0) {
            const hp = settlement._hardpoints[building._hardpointIndex];
            if (hp) {
                hp.occupied = false;
                hp.buildingRef = null;
            }
        }
        if (building._mesh) {
            settlement._group.remove(building._mesh);
            building._mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
        }
        settlement.nodes = settlement.nodes.filter(n => n.buildingRef !== building);
        const bIdx = settlement.buildings.indexOf(building);
        if (bIdx >= 0) settlement.buildings.splice(bIdx, 1);
        this._recomputeBounds(settlement);
        this._updateFence(settlement);
    }

    syncBuildings(settlement, serverBuildings) {
        if (!serverBuildings || !Array.isArray(serverBuildings)) return;

        const serverCounts = {};
        for (const sb of serverBuildings) {
            serverCounts[sb.type] = (serverCounts[sb.type] || 0) + 1;
        }
        const localCounts = {};
        for (const b of settlement.buildings) {
            localCounts[b.type] = (localCounts[b.type] || 0) + 1;
        }

        for (const type of Object.keys(localCounts)) {
            const excess = localCounts[type] - (serverCounts[type] || 0);
            if (excess > 0) {
                const toRemove = settlement.buildings.filter(b => b.type === type).slice(-excess);
                for (const b of toRemove) this._removeComponent(settlement, b);
            }
        }

        for (const type of Object.keys(serverCounts)) {
            const missing = serverCounts[type] - (localCounts[type] || 0);
            for (let i = 0; i < missing; i++) {
                const sb = serverBuildings.find(b => b.type === type);
                this.attachComponent(settlement, type, {
                    state: sb?.state || 'complete',
                    startedAtDay: sb?.startedAtDay
                });
            }
        }
    }

    placeInitialBuildings(settlement) {
        const { typeDef } = settlement;
        this.attachComponent(settlement, 'house');
        if (typeDef.hasGreen) {
            this.attachComponent(settlement, 'villageGreen');
        }
        if (typeDef.hasChurch) {
            this.attachComponent(settlement, 'church');
        }
        if (typeDef.hasManor) {
            this.attachComponent(settlement, 'manor');
        }
        const houseCount = Math.max(1, Math.floor(settlement.population / BUILDING_THRESHOLDS.housePerVillagers)) - 1;
        for (let i = 0; i < houseCount; i++) {
            this.attachComponent(settlement, 'house');
        }
        const fieldCount = Math.max(1, Math.floor(settlement.population / BUILDING_THRESHOLDS.fieldPerVillagers));
        for (let i = 0; i < fieldCount; i++) {
            this.attachComponent(settlement, 'field');
        }
        if (typeDef.hasBarn && fieldCount >= BUILDING_THRESHOLDS.barnAfterFields) {
            this.attachComponent(settlement, 'barn');
        }
    }

    _getPrefabMaxBounds(type) {
        switch (type) {
            case 'house':       return { w: 1.3, h: 1.2, d: 1.3 };
            case 'church':      return { w: 1.4, h: 2.4, d: 1.6 };
            case 'manor':       return { w: 2.0, h: 1.9, d: 1.7 };
            case 'barn':        return { w: 1.9, h: 1.3, d: 1.6 };
            case 'field':       return { w: 2.6, h: 0.15, d: 2.0 };
            case 'fishingHut':  return { w: 1.0, h: 0.9, d: 1.0 };
            case 'maypole':     return { w: 0.6, h: 2.0, d: 0.6 };
            case 'villageGreen':return { w: 3.0, h: 0.1, d: 3.0 };
            case 'pond':        return { w: 1.6, h: 0.05, d: 1.6 };
            case 'lampPost':    return { w: 0.25, h: 1.4, d: 0.25 };
            default:            return { w: 1.0, h: 1.0, d: 1.0 };
        }
    }

    _wouldOverlap(settlement, posX, posZ, bounds, rotationY) {
        const cos = Math.cos(rotationY);
        const sin = Math.sin(rotationY);
        const w2 = bounds.w / 2;
        const d2 = bounds.d / 2;
        const corners = [
            { x: -w2, z: -d2 }, { x: w2, z: -d2 },
            { x: -w2, z: d2 }, { x: w2, z: d2 }
        ];
        let pMinX = Infinity, pMaxX = -Infinity;
        let pMinZ = Infinity, pMaxZ = -Infinity;
        for (const c of corners) {
            const wx = posX + (c.x * cos + c.z * sin);
            const wz = posZ + (-c.x * sin + c.z * cos);
            pMinX = Math.min(pMinX, wx); pMaxX = Math.max(pMaxX, wx);
            pMinZ = Math.min(pMinZ, wz); pMaxZ = Math.max(pMaxZ, wz);
        }
        for (const comp of settlement._components || []) {
            const ex = comp.group.position.x;
            const ez = comp.group.position.z;
            const ery = comp.group.rotation.y;
            const eCos = Math.cos(ery), eSin = Math.sin(ery);
            const ew2 = comp.bounds.w / 2, ed2 = comp.bounds.d / 2;
            const eCorners = [
                { x: -ew2, z: -ed2 }, { x: ew2, z: -ed2 },
                { x: -ew2, z: ed2 }, { x: ew2, z: ed2 }
            ];
            let eMinX = Infinity, eMaxX = -Infinity;
            let eMinZ = Infinity, eMaxZ = -Infinity;
            for (const c of eCorners) {
                const wx = ex + (c.x * eCos + c.z * eSin);
                const wz = ez + (-c.x * eSin + c.z * eCos);
                eMinX = Math.min(eMinX, wx); eMaxX = Math.max(eMaxX, wx);
                eMinZ = Math.min(eMinZ, wz); eMaxZ = Math.max(eMaxZ, wz);
            }
            const buffer = 0.05;
            if (pMinX < eMaxX + buffer && pMaxX > eMinX - buffer &&
                pMinZ < eMaxZ + buffer && pMaxZ > eMinZ - buffer) {
                return true;
            }
        }
        return false;
    }

    attachComponent(settlement, type, options = {}) {
        const id = ++this.buildingIdCounter;
        const isFirst = !settlement._components || settlement._components.length === 0;
        let hardpoint = null;
        let hardpointIndex = -1;
        const rand = this._getRand(settlement);

        if (!isFirst) {
            let candidates = this._getCompatibleHardpoints(settlement, type);
            if (candidates.length === 0) {
                this._expandHardpoints(settlement);
                candidates = this._getCompatibleHardpoints(settlement, type);
            }
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            }
            const maxBounds = this._getPrefabMaxBounds(type);
            for (const candidate of candidates) {
                const hp = candidate.hp;
                const posX = hp.x + hp.dirX * (maxBounds.d / 2);
                const posZ = hp.z + hp.dirZ * (maxBounds.d / 2);
                const rotY = Math.atan2(hp.dirX, hp.dirZ);
                if (!this._wouldOverlap(settlement, posX, posZ, maxBounds, rotY)) {
                    hardpoint = hp;
                    hardpointIndex = candidate.index;
                    break;
                }
            }
            if (!hardpoint) {
                this._expandHardpoints(settlement);
                candidates = this._getCompatibleHardpoints(settlement, type);
                for (const candidate of candidates) {
                    const hp = candidate.hp;
                    const posX = hp.x + hp.dirX * (maxBounds.d / 2);
                    const posZ = hp.z + hp.dirZ * (maxBounds.d / 2);
                    const rotY = Math.atan2(hp.dirX, hp.dirZ);
                    if (!this._wouldOverlap(settlement, posX, posZ, maxBounds, rotY)) {
                        hardpoint = hp;
                        hardpointIndex = candidate.index;
                        break;
                    }
                }
            }
            if (!hardpoint) return null;
        }

        let posX, posZ, terrainH;
        if (!isFirst && hardpoint) {
            const maxBounds = this._getPrefabMaxBounds(type);
            posX = hardpoint.x + hardpoint.dirX * (maxBounds.d / 2);
            posZ = hardpoint.z + hardpoint.dirZ * (maxBounds.d / 2);
            terrainH = this._sampleTerrainHeight(posX, posZ);
        } else {
            posX = settlement.x;
            posZ = settlement.z;
            terrainH = this._sampleTerrainHeight(posX, posZ);
        }

        const building = {
            id,
            type,
            x: posX,
            z: posZ,
            y: terrainH,
            state: options.state || 'complete',
            _mesh: null,
            _createdAt: settlement.age,
            _startedAtDay: options.startedAtDay || 0,
            _hardpointIndex: hardpointIndex
        };

        if (!isFirst && hardpoint) {
            hardpoint.occupied = true;
            hardpoint.buildingRef = building;
        }

        if (options.state === 'under_construction') {
            this._createComponentScaffolding(settlement, building, type, hardpoint);
            this._createComponentConstruction(settlement, building, type, hardpoint);
        } else {
            this._createComponentMesh(settlement, building, type, hardpoint);
        }

        settlement.buildings.push(building);

        const levelBounds = this._getPrefabMaxBounds(type);
        this._levelTerrainForComponent(settlement, posX, posZ, levelBounds);

        const nodeTypes = ['house', 'field', 'barn', 'fishingHut', 'villageGreen', 'church', 'manor', 'pond', 'maypole', 'proclamationSpot', 'lampPost'];
        if (nodeTypes.includes(type)) {
            const exists = settlement.nodes.find(n => n.type === type && n.buildingRef === building);
            if (!exists) {
                settlement.nodes.push({
                    type,
                    x: building.x,
                    z: building.z,
                    y: building.y,
                    label: type.charAt(0).toUpperCase() + type.slice(1),
                    buildingRef: building
                });
            }
        }

        return building;
    }

    _getCompatibleHardpoints(settlement, type) {
        const typeCompat = {
            house: ['residential', 'any'],
            church: ['civic', 'any'],
            manor: ['civic', 'any'],
            barn: ['agricultural', 'any'],
            field: ['agricultural', 'any'],
            fishingHut: ['agricultural', 'any'],
            maypole: ['civic', 'any'],
            villageGreen: ['civic', 'any'],
            pond: ['any'],
            lampPost: ['any']
        };
        const compat = typeCompat[type] || ['any'];
        const result = [];
        for (let i = 0; i < (settlement._hardpoints || []).length; i++) {
            const hp = settlement._hardpoints[i];
            if (!hp.occupied && compat.includes(hp.type)) {
                result.push({ hp, index: i });
            }
        }
        return result;
    }

    _expandHardpoints(settlement) {
        if (!settlement._components) return;
        const rand = this._getRand(settlement);
        let maxR = 2;
        for (const comp of settlement._components) {
            const pos = comp.group.position;
            const dx = pos.x - settlement.x;
            const dz = pos.z - settlement.z;
            const r = Math.sqrt(dx * dx + dz * dz) + Math.max(comp.bounds.w, comp.bounds.d) * 0.6;
            maxR = Math.max(maxR, r);
        }
        const newRadius = maxR + 1.5;
        const count = Math.max(4, Math.floor(newRadius * 2));
        if (!settlement._hardpoints) settlement._hardpoints = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.3;
            const dirX = Math.cos(angle);
            const dirZ = Math.sin(angle);
            const hx = settlement.x + dirX * newRadius;
            const hz = settlement.z + dirZ * newRadius;
            settlement._hardpoints.push({
                x: hx,
                y: this._sampleTerrainHeight(hx, hz),
                z: hz,
                dirX,
                dirZ,
                type: 'any',
                occupied: false,
                buildingRef: null
            });
        }
    }

    _levelTerrainForComponent(settlement, posX, posZ, bounds) {
        if (!this.terrainSystem || !this.terrainSystem.levelTerrainArea) return;
        const w = Math.ceil(bounds.w);
        const d = Math.ceil(bounds.d);
        const by = this._sampleTerrainHeight(posX, posZ);
        const gx = Math.floor(posX - w / 2);
        const gz = Math.floor(posZ - d / 2);
        this.terrainSystem.levelTerrainArea(gx, gz, w, d, by);
        const boardSystem = this.settlementSystem?.game?.boardSystem;
        if (boardSystem && typeof boardSystem.refreshTerrainInArea === 'function') {
            boardSystem.refreshTerrainInArea(posX, posZ, Math.max(w, d) + 1);
        }
        this.emitTerrainDeltas(settlement, gx, gz, w, d, by);
    }

    findBuildingPosition(settlement, type) {
        const center = { x: settlement.x, z: settlement.z };
        const footprint = this.getBuildingFootprint(type);
        const attempts = 25;
        const rand = this._getRand(settlement);

        for (let i = 0; i < attempts; i++) {
            const angle = rand() * Math.PI * 2;
            const dist = this.getPlacementDistance(settlement, type);
            const rawX = center.x + Math.cos(angle) * dist;
            const rawZ = center.z + Math.sin(angle) * dist;
            const gx = Math.round(rawX);
            const gz = Math.round(rawZ);

            if (!this._isFootprintValid(settlement, type, gx, gz, footprint.w, footprint.d)) continue;

            return { x: gx, z: gz };
        }

        return null;
    }

    getPlacementDistance(settlement, type) {
        const rand = this._getRand(settlement);
        switch (type) {
            case 'house': return 4 + rand() * 10;
            case 'field': return 6 + rand() * 14;
            case 'barn': return 5 + rand() * 8;
            case 'fishingHut': return 8 + rand() * 12;
            default: return 5;
        }
    }

    getMinSpacing(typeA, typeB) {
        if (typeA === 'house' && typeB === 'house') return 1.5;
        if (typeA === 'field' && typeB === 'field') return 3;
        return 2;
    }

    getBuildingFootprint(type) {
        switch (type) {
            case 'house': return { w: 1, d: 1 };
            case 'fishingHut': return { w: 1, d: 1 };
            case 'maypole': return { w: 1, d: 1 };
            case 'lampPost': return { w: 1, d: 1 };
            case 'church': return { w: 2, d: 2 };
            case 'barn': return { w: 2, d: 2 };
            case 'field': return { w: 2, d: 2 };
            case 'manor': return { w: 3, d: 3 };
            case 'villageGreen': return { w: 5, d: 5 };
            case 'pond': return { w: 3, d: 3 };
            default: return { w: 1, d: 1 };
        }
    }

    _isTileOccupiedByPiece(gx, gz) {
        const gameState = this.settlementSystem?.game?.gameState;
        if (!gameState || typeof gameState.getPieceAt !== 'function') return false;
        return !!gameState.getPieceAt(gx, gz);
    }

    _getFootprintAverageHeight(gx, gz, fw, fd) {
        if (!this.terrainSystem) return 0;
        let total = 0;
        let count = 0;
        for (let dx = 0; dx < fw; dx++) {
            for (let dz = 0; dz < fd; dz++) {
                total += this.terrainSystem.getHeight(gx + dx, gz + dz);
                count++;
            }
        }
        return count > 0 ? total / count : 0;
    }

    isFootprintLoaded(gx, gz, fw, fd) {
        return this._isFootprintLoaded(gx, gz, fw, fd);
    }

    _isFootprintLoaded(gx, gz, fw, fd) {
        if (!this.terrainSystem || !this.terrainSystem.chunks) return false;
        const cs = this.terrainSystem.chunkSize || 16;
        for (let dx = 0; dx < fw; dx++) {
            for (let dz = 0; dz < fd; dz++) {
                const tx = gx + dx;
                const tz = gz + dz;
                const chunkX = Math.floor(tx / cs);
                const chunkZ = Math.floor(tz / cs);
                const chunkKey = `${chunkX},${chunkZ}`;
                const chunk = this.terrainSystem.chunks.get(chunkKey);
                if (!chunk || !chunk.data) return false;
            }
        }
        return true;
    }

    _isFootprintValid(settlement, type, gx, gz, fw, fd) {
        if (!this.terrainSystem) return true;
        const heights = [];
        for (let dx = 0; dx < fw; dx++) {
            for (let dz = 0; dz < fd; dz++) {
                const tx = gx + dx;
                const tz = gz + dz;
                if (this.terrainSystem.isTileBlocked && this.terrainSystem.isTileBlocked(tx, tz)) {
                    return false;
                }
                const h = this.terrainSystem.getHeight(tx, tz);
                if (h < -1.5) return false;
                heights.push(h);
                if (this._isTileOccupiedByPiece(tx, tz)) return false;
            }
        }
        if (heights.length > 1) {
            const minH = Math.min(...heights);
            const maxH = Math.max(...heights);
            if (maxH - minH > 1.0) return false;
        }
        for (let dx = 0; dx < fw; dx++) {
            for (let dz = 0; dz < fd; dz++) {
                const normal = this.terrainSystem.getNormal && this.terrainSystem.getNormal(gx + dx, gz + dz);
                if (normal) {
                    const slope = Math.acos(Math.abs(normal.y)) * (180 / Math.PI);
                    if (slope > 15) return false;
                }
            }
        }
        for (const b of settlement.buildings) {
            const dx = gx - b.x;
            const dz = gz - b.z;
            if (Math.sqrt(dx * dx + dz * dz) < this.getMinSpacing(type, b.type)) {
                return false;
            }
        }
        return true;
    }

    _createComponentMesh(settlement, building, type, hardpoint) {
        const rand = this._getRand(settlement);
        const prefab = this._getPrefab(type, rand);
        if (!prefab) return;

        const group = prefab.group;
        const bounds = prefab.bounds;

        group.position.set(building.x, building.y, building.z);
        if (hardpoint) {
            group.rotation.y = Math.atan2(hardpoint.dirX, hardpoint.dirZ);
        }

        settlement._group.add(group);
        building._mesh = group;

        const comp = { type, group, bounds, hardpoints: [] };
        const ry = group.rotation.y;
        const cos = Math.cos(ry);
        const sin = Math.sin(ry);

        for (const hp of prefab.hardpoints) {
            const wx = group.position.x + (hp.x * cos + hp.z * sin);
            const wz = group.position.z + (-hp.x * sin + hp.z * cos);
            const wdx = hp.dirX * cos + hp.dirZ * sin;
            const wdz = -hp.dirX * sin + hp.dirZ * cos;
            const worldHp = {
                x: wx,
                y: group.position.y + hp.y,
                z: wz,
                dirX: wdx,
                dirZ: wdz,
                type: hp.type,
                occupied: false,
                buildingRef: null
            };
            settlement._hardpoints.push(worldHp);
            comp.hardpoints.push(worldHp);
        }
        if (!settlement._components) settlement._components = [];
        settlement._components.push(comp);

        this._updateSettlementBounds(settlement, group, bounds);
        this._updateFence(settlement);
    }

    _updateSettlementBounds(settlement, group, bounds) {
        if (!settlement._bounds) {
            settlement._bounds = { minX: settlement.x - 2, maxX: settlement.x + 2, minZ: settlement.z - 2, maxZ: settlement.z + 2 };
        }
        const w2 = bounds.w / 2;
        const d2 = bounds.d / 2;
        const ry = group.rotation.y;
        const cos = Math.cos(ry);
        const sin = Math.sin(ry);
        const corners = [
            { x: -w2, z: -d2 }, { x: w2, z: -d2 },
            { x: -w2, z: d2 }, { x: w2, z: d2 }
        ];
        for (const c of corners) {
            const wx = group.position.x + (c.x * cos + c.z * sin);
            const wz = group.position.z + (-c.x * sin + c.z * cos);
            settlement._bounds.minX = Math.min(settlement._bounds.minX, wx);
            settlement._bounds.maxX = Math.max(settlement._bounds.maxX, wx);
            settlement._bounds.minZ = Math.min(settlement._bounds.minZ, wz);
            settlement._bounds.maxZ = Math.max(settlement._bounds.maxZ, wz);
        }
    }

    _recomputeBounds(settlement) {
        settlement._bounds = { minX: settlement.x - 2, maxX: settlement.x + 2, minZ: settlement.z - 2, maxZ: settlement.z + 2 };
        for (const comp of settlement._components || []) {
            this._updateSettlementBounds(settlement, comp.group, comp.bounds);
        }
    }

    createSettlementBase(settlement) {
        const h = settlement.height || 0;
        settlement._baseY = h;
        if (!settlement._hardpoints) settlement._hardpoints = [];
        if (!settlement._components) settlement._components = [];
        if (!settlement._bounds) settlement._bounds = { minX: settlement.x - 2, maxX: settlement.x + 2, minZ: settlement.z - 2, maxZ: settlement.z + 2 };

        const initialRadius = 2;
        const initialCount = 4;
        for (let i = 0; i < initialCount; i++) {
            const angle = (i / initialCount) * Math.PI * 2;
            const dirX = Math.cos(angle);
            const dirZ = Math.sin(angle);
            const hx = settlement.x + dirX * initialRadius;
            const hz = settlement.z + dirZ * initialRadius;
            settlement._hardpoints.push({
                x: hx,
                y: this._sampleTerrainHeight(hx, hz),
                z: hz,
                dirX,
                dirZ,
                type: 'any',
                occupied: false,
                buildingRef: null
            });
        }

        this._createFence(settlement);
    }

    _updateFence(settlement) {
        this._removeFence(settlement);
        this._createFence(settlement);
    }

    _removeFence(settlement) {
        if (settlement._fenceMeshes) {
            for (const m of settlement._fenceMeshes) {
                settlement._group.remove(m);
                if (m.geometry) m.geometry.dispose();
            }
            settlement._fenceMeshes = [];
        }
    }

    _createFence(settlement) {
        const waterLevel = this._getWaterLevel();
        const radius = Math.max(
            (settlement._fenceRadius || 0) + 0.5,
            settlement.type === 'hamlet' ? 3.5 : 5
        );
        let maxR = 2;
        for (const comp of settlement._components || []) {
            const pos = comp.group.position;
            const dx = pos.x - settlement.x;
            const dz = pos.z - settlement.z;
            const r = Math.sqrt(dx * dx + dz * dz) + Math.max(comp.bounds.w, comp.bounds.d) * 0.7;
            maxR = Math.max(maxR, r);
        }
        const fenceRadius = Math.max(radius, maxR + 1.5);
        settlement._fenceRadius = fenceRadius;
        const wallHeight = settlement.type === 'hamlet' ? 0.6 : 0.9;
        const postCount = Math.max(8, Math.floor(fenceRadius * 4));
        settlement._fenceMeshes = [];

        const postGeo = new THREE.CylinderGeometry(0.06, 0.07, wallHeight, 5);
        const gateStart = Math.floor(postCount * 0.875);
        const gateEnd = postCount;
        const createdPosts = new Array(postCount).fill(false);

        // First pass: create posts on valid terrain
        for (let i = 0; i < postCount; i++) {
            if (i >= gateStart && i < gateEnd) continue;
            const angle = (i / postCount) * Math.PI * 2;
            const px = settlement.x + Math.cos(angle) * fenceRadius;
            const pz = settlement.z + Math.sin(angle) * fenceRadius;
            const terrainH = this._sampleTerrainHeight(px, pz);
            if (terrainH < waterLevel) continue;
            const post = new THREE.Mesh(postGeo, this.materials.wood);
            post.position.set(px, terrainH + wallHeight / 2, pz);
            post.castShadow = true;
            settlement._group.add(post);
            settlement._fenceMeshes.push(post);
            createdPosts[i] = true;
        }

        // Second pass: rails between consecutive valid posts
        for (let i = 0; i < postCount; i++) {
            if (!createdPosts[i]) continue;
            const next = (i + 1) % postCount;
            if (!createdPosts[next]) continue;
            if (i >= gateStart && i < gateEnd) continue;
            if (next >= gateStart && next < gateEnd) continue;

            const angle1 = (i / postCount) * Math.PI * 2;
            const angle2 = (next / postCount) * Math.PI * 2;
            const px1 = settlement.x + Math.cos(angle1) * fenceRadius;
            const pz1 = settlement.z + Math.sin(angle1) * fenceRadius;
            const px2 = settlement.x + Math.cos(angle2) * fenceRadius;
            const pz2 = settlement.z + Math.sin(angle2) * fenceRadius;
            const h1 = this._sampleTerrainHeight(px1, pz1);
            const h2 = this._sampleTerrainHeight(px2, pz2);
            const connY1 = h1 + wallHeight * 0.65;
            const connY2 = h2 + wallHeight * 0.65;
            const dx = px2 - px1;
            const dz = pz2 - pz1;
            const dy = connY2 - connY1;
            const hdist = Math.sqrt(dx * dx + dz * dz);
            const fullDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const yaw = Math.atan2(dx, dz);
            const pitch = Math.atan2(dy, hdist);
            const rail = new THREE.Mesh(
                new THREE.BoxGeometry(0.03, 0.03, fullDist),
                this.materials.wood
            );
            rail.position.set((px1 + px2) / 2, (connY1 + connY2) / 2, (pz1 + pz2) / 2);
            rail.rotation.x = -pitch;
            rail.rotation.y = yaw;
            settlement._group.add(rail);
            settlement._fenceMeshes.push(rail);
        }

        // Gate posts
        const gatePostGeo = new THREE.CylinderGeometry(0.08, 0.09, wallHeight * 1.3, 5);
        for (const side of [-1, 1]) {
            const angle = (gateStart / postCount) * Math.PI * 2 + side * 0.06;
            const gx = settlement.x + Math.cos(angle) * fenceRadius;
            const gz = settlement.z + Math.sin(angle) * fenceRadius;
            const terrainH = this._sampleTerrainHeight(gx, gz);
            if (terrainH < waterLevel) continue;
            const gp = new THREE.Mesh(gatePostGeo, this.materials.wood);
            gp.position.set(gx, terrainH + wallHeight * 0.65, gz);
            gp.castShadow = true;
            settlement._group.add(gp);
            settlement._fenceMeshes.push(gp);
        }
    }

    _getPrefab(type, rand) {
        switch (type) {
            case 'house':       return this._prefabHouse(rand);
            case 'church':      return this._prefabChurch(rand);
            case 'manor':       return this._prefabManor(rand);
            case 'barn':        return this._prefabBarn(rand);
            case 'field':       return this._prefabField(rand);
            case 'fishingHut':  return this._prefabFishingHut(rand);
            case 'maypole':     return this._prefabMaypole(rand);
            case 'villageGreen':return this._prefabVillageGreen(rand);
            case 'pond':        return this._prefabPond(rand);
            case 'lampPost':    return this._prefabLampPost(rand);
            default:            return this._prefabHouse(rand);
        }
    }

    _addHardpoints(bounds, types, excludedSide) {
        const hps = [];
        const w2 = bounds.w / 2;
        const d2 = bounds.d / 2;
        const y = bounds.h * 0.3;
        if (excludedSide !== 'front') hps.push({ x: 0, y, z: d2, dirX: 0, dirZ: 1, type: types[0] || 'any' });
        if (excludedSide !== 'back') hps.push({ x: 0, y, z: -d2, dirX: 0, dirZ: -1, type: types[1] || 'any' });
        if (excludedSide !== 'right') hps.push({ x: w2, y, z: 0, dirX: 1, dirZ: 0, type: types[2] || 'any' });
        if (excludedSide !== 'left') hps.push({ x: -w2, y, z: 0, dirX: -1, dirZ: 0, type: types[3] || 'any' });
        return hps;
    }

    _prefabHouse(rand) {
        const w = 0.8 + rand() * 0.5;
        const d = 0.8 + rand() * 0.5;
        const h = 0.6 + rand() * 0.4;
        const roofH = 0.35 + rand() * 0.2;
        const group = new THREE.Group();

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.materials.wall);
        body.position.y = h / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(w, d) * 0.55, roofH, 4),
            this.materials.roof
        );
        roof.position.y = h + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const door = new THREE.Mesh(
            new THREE.PlaneGeometry(0.18, 0.32),
            this.materials.door
        );
        door.position.set(0, 0.18, d / 2 + 0.01);
        group.add(door);

        if (rand() > 0.3) {
            const chimW = 0.12 + rand() * 0.06;
            const chimH = 0.3 + rand() * 0.3;
            const chimney = new THREE.Mesh(
                new THREE.BoxGeometry(chimW, chimH, chimW),
                this.materials.wallDark
            );
            chimney.position.set(w * 0.25, h + roofH * 0.3, -d * 0.2);
            chimney.castShadow = true;
            group.add(chimney);
        }

        const bounds = { w, h: h + roofH, d };
        const hardpoints = this._addHardpoints(bounds, ['residential', 'residential', 'any', 'any'], 'front');
        return { group, hardpoints, bounds };
    }

    _prefabChurch(rand) {
        const w = 1.0 + rand() * 0.4;
        const d = 1.2 + rand() * 0.4;
        const h = 1.4 + rand() * 0.4;
        const roofH = 0.5 + rand() * 0.2;
        const group = new THREE.Group();

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.materials.wall);
        body.position.y = h / 2;
        body.castShadow = true;
        group.add(body);

        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(w, d) * 0.55, roofH, 4),
            this.materials.roofDark
        );
        roof.position.y = h + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const spire = new THREE.Mesh(
            new THREE.ConeGeometry(0.18, 0.6, 4),
            this.materials.roofDark
        );
        spire.position.y = h + roofH + 0.3;
        spire.rotation.y = Math.PI / 4;
        spire.castShadow = true;
        group.add(spire);

        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.02), this.materials.gold);
        crossV.position.y = h + roofH + 0.65;
        group.add(crossV);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.02), this.materials.gold);
        crossH.position.set(0, h + roofH + 0.6, 0);
        group.add(crossH);

        const door = new THREE.Mesh(
            new THREE.PlaneGeometry(0.25, 0.45),
            this.materials.door
        );
        door.position.set(0, 0.25, d / 2 + 0.01);
        group.add(door);

        const bounds = { w, h: h + roofH + 0.7, d };
        const hardpoints = this._addHardpoints(bounds, ['civic', 'civic', 'any', 'any'], 'front');
        return { group, hardpoints, bounds };
    }

    _prefabManor(rand) {
        const w = 1.4 + rand() * 0.6;
        const d = 1.2 + rand() * 0.5;
        const h = 1.2 + rand() * 0.4;
        const roofH = 0.45 + rand() * 0.2;
        const group = new THREE.Group();

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.materials.wall);
        body.position.y = h / 2;
        body.castShadow = true;
        group.add(body);

        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(w, d) * 0.55, roofH, 4),
            this.materials.roof
        );
        roof.position.y = h + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const wingW = w * 0.5 + rand() * 0.2;
        const wingD = d * 0.7;
        const wingH = h * 0.7;
        const wing = new THREE.Mesh(
            new THREE.BoxGeometry(wingW, wingH, wingD),
            this.materials.wallDark
        );
        wing.position.set(w / 2 + wingW / 2 - 0.1, wingH / 2, 0);
        wing.castShadow = true;
        group.add(wing);

        const bounds = { w: w + wingW, h: h + roofH, d };
        const hardpoints = this._addHardpoints(bounds, ['civic', 'civic', 'any', 'any'], 'front');
        return { group, hardpoints, bounds };
    }

    _prefabBarn(rand) {
        const w = 1.4 + rand() * 0.5;
        const d = 1.2 + rand() * 0.4;
        const h = 0.9 + rand() * 0.3;
        const roofH = 0.4 + rand() * 0.15;
        const group = new THREE.Group();

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.materials.wood);
        body.position.y = h / 2;
        body.castShadow = true;
        group.add(body);

        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(w, d) * 0.55, roofH, 4),
            this.materials.roofDark
        );
        roof.position.y = h + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const bounds = { w, h: h + roofH, d };
        const hardpoints = this._addHardpoints(bounds, ['agricultural', 'agricultural', 'any', 'any'], 'front');
        return { group, hardpoints, bounds };
    }

    _prefabField(rand) {
        const w = 1.8 + rand() * 0.8;
        const d = 1.4 + rand() * 0.6;
        const group = new THREE.Group();

        const wallH = 0.15;
        const wallThick = 0.06;
        const perimeter = [
            { x: 0, z: -d / 2, w: w, d: wallThick },
            { x: 0, z: d / 2, w: w, d: wallThick },
            { x: -w / 2, z: 0, w: wallThick, d: d },
            { x: w / 2, z: 0, w: wallThick, d: d }
        ];
        for (const seg of perimeter) {
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(seg.w, wallH, seg.d),
                this.materials.fieldWall
            );
            wall.position.set(seg.x, wallH / 2, seg.z);
            group.add(wall);
        }

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(w - 0.15, d - 0.15),
            this.materials.field
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0.02;
        ground.receiveShadow = true;
        group.add(ground);

        for (let i = 0; i < 6; i++) {
            const crop = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.18, 4),
                new THREE.MeshLambertMaterial({ color: 0x6b8e23 })
            );
            crop.position.set(
                (rand() - 0.5) * (w - 0.3),
                0.12,
                (rand() - 0.5) * (d - 0.3)
            );
            group.add(crop);
        }

        const bounds = { w, h: wallH, d };
        const hardpoints = this._addHardpoints(bounds, ['agricultural', 'agricultural', 'any', 'any']);
        return { group, hardpoints, bounds };
    }

    _prefabFishingHut(rand) {
        const w = 0.7 + rand() * 0.3;
        const d = 0.7 + rand() * 0.3;
        const h = 0.5 + rand() * 0.3;
        const roofH = 0.3 + rand() * 0.15;
        const group = new THREE.Group();

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            this.materials.woodDark
        );
        body.position.y = h / 2;
        body.castShadow = true;
        group.add(body);

        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(w, d) * 0.55, roofH, 4),
            this.materials.thatch
        );
        roof.position.y = h + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const bounds = { w, h: h + roofH, d };
        const hardpoints = this._addHardpoints(bounds, ['agricultural', 'any', 'any', 'any'], 'front');
        return { group, hardpoints, bounds };
    }

    _prefabMaypole(rand) {
        const group = new THREE.Group();
        const h = 1.4 + rand() * 0.4;
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.05, h, 6),
            this.materials.maypole
        );
        pole.position.y = h / 2;
        pole.castShadow = true;
        group.add(pole);

        const colors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const ribbon = new THREE.Mesh(
                new THREE.BoxGeometry(0.015, h * 0.35, 0.015),
                new THREE.MeshLambertMaterial({ color: colors[i] })
            );
            ribbon.position.set(Math.cos(angle) * 0.25, h * 0.35, Math.sin(angle) * 0.25);
            ribbon.rotation.z = angle;
            group.add(ribbon);
        }

        const bounds = { w: 0.6, h, d: 0.6 };
        const hardpoints = this._addHardpoints(bounds, ['civic', 'civic', 'any', 'any']);
        return { group, hardpoints, bounds };
    }

    _prefabVillageGreen(rand) {
        const w = 2.0 + rand() * 1.0;
        const d = 2.0 + rand() * 1.0;
        const group = new THREE.Group();

        const wallH = 0.1;
        const wallThick = 0.08;
        const perimeter = [
            { x: 0, z: -d / 2, w: w, d: wallThick },
            { x: 0, z: d / 2, w: w, d: wallThick },
            { x: -w / 2, z: 0, w: wallThick, d: d },
            { x: w / 2, z: 0, w: wallThick, d: d }
        ];
        for (const seg of perimeter) {
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(seg.w, wallH, seg.d),
                this.materials.stone
            );
            wall.position.set(seg.x, wallH / 2, seg.z);
            group.add(wall);
        }

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(w - 0.2, d - 0.2),
            this.materials.grass
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0.02;
        ground.receiveShadow = true;
        group.add(ground);

        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + rand() * 0.5;
            const dist = 0.5 + rand() * 0.5;
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.06, 0.4, 5),
                this.materials.wood
            );
            trunk.position.set(Math.cos(angle) * dist, 0.2, Math.sin(angle) * dist);
            group.add(trunk);
            const foliage = new THREE.Mesh(
                new THREE.SphereGeometry(0.25, 5, 4),
                new THREE.MeshLambertMaterial({ color: 0x3a7a2a })
            );
            foliage.position.set(Math.cos(angle) * dist, 0.5, Math.sin(angle) * dist);
            group.add(foliage);
        }

        const bounds = { w, h: wallH + 0.6, d };
        const hardpoints = this._addHardpoints(bounds, ['civic', 'civic', 'any', 'any']);
        return { group, hardpoints, bounds };
    }

    _prefabPond(rand) {
        const w = 1.0 + rand() * 0.6;
        const d = 1.0 + rand() * 0.6;
        const group = new THREE.Group();

        const pond = new THREE.Mesh(
            new THREE.CircleGeometry(Math.min(w, d) * 0.4, 12),
            this.materials.water
        );
        pond.rotation.x = -Math.PI / 2;
        pond.position.y = 0.01;
        group.add(pond);

        const bounds = { w, h: 0.05, d };
        const hardpoints = this._addHardpoints(bounds, ['any', 'any', 'any', 'any']);
        return { group, hardpoints, bounds };
    }

    _prefabLampPost(rand) {
        const h = 1.0 + rand() * 0.3;
        const group = new THREE.Group();

        const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.04, h, 5),
            this.materials.woodDark
        );
        post.position.y = h / 2;
        post.castShadow = true;
        group.add(post);

        const lamp = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.15, 0.12),
            this.materials.lampGlow
        );
        lamp.position.y = h + 0.05;
        group.add(lamp);
        group.userData._lampMesh = lamp;

        const bounds = { w: 0.25, h: h + 0.15, d: 0.25 };
        const hardpoints = this._addHardpoints(bounds, ['any', 'any', 'any', 'any']);
        return { group, hardpoints, bounds };
    }

    _getScaffoldTexture() {
        if (this._scaffoldTex) return this._scaffoldTex;
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#8a7a5a';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#6b5b3a';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, size - 4, size - 4);
        ctx.beginPath();
        ctx.moveTo(4, 4);
        ctx.lineTo(size - 4, size - 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(size - 4, 4);
        ctx.lineTo(4, size - 4);
        ctx.stroke();
        ctx.strokeStyle = '#7a6a4a';
        ctx.lineWidth = 1;
        for (let i = 8; i < size; i += 12) {
            ctx.beginPath();
            ctx.moveTo(i, 2);
            ctx.lineTo(i, size - 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(2, i);
            ctx.lineTo(size - 2, i);
            ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
        this._scaffoldTex = tex;
        return tex;
    }

    _createComponentScaffolding(settlement, building, type, hardpoint) {
        const rand = this._getRand(settlement);
        const bounds = this._getPrefabBounds(type, rand);
        const fw = bounds.w;
        const fh = bounds.h;
        const fd = bounds.d;

        const group = new THREE.Group();
        const cubeSize = 0.5;
        const tex = this._getScaffoldTexture();
        const mat = new THREE.MeshLambertMaterial({ map: tex });

        const cols = Math.ceil(fw / cubeSize);
        const rows = Math.ceil(fd / cubeSize);
        const stacks = Math.ceil(fh / cubeSize);
        const geo = new THREE.BoxGeometry(cubeSize * 0.95, cubeSize * 0.95, cubeSize * 0.95);

        for (let sx = 0; sx < cols; sx++) {
            for (let sz = 0; sz < rows; sz++) {
                for (let sy = 0; sy < stacks; sy++) {
                    const mesh = new THREE.Mesh(geo, mat);
                    mesh.position.set(
                        (sx - (cols - 1) / 2) * cubeSize,
                        sy * cubeSize + cubeSize / 2,
                        (sz - (rows - 1) / 2) * cubeSize
                    );
                    mesh.castShadow = true;
                    group.add(mesh);
                }
            }
        }

        group.position.set(building.x, building.y, building.z);
        if (hardpoint) {
            group.rotation.y = Math.atan2(hardpoint.dirX, hardpoint.dirZ);
        }

        settlement._group.add(group);
        building._scaffoldMesh = group;
    }

    _createComponentConstruction(settlement, building, type, hardpoint) {
        const rand = this._getRand(settlement);
        const bounds = this._getPrefabBounds(type, rand);
        const fw = bounds.w;
        const fh = bounds.h;
        const fd = bounds.d;

        const geo = new THREE.BoxGeometry(fw * 0.9, fh * 0.9, fd * 0.9);
        const mat = new THREE.MeshLambertMaterial({
            color: 0xc8b896,
            transparent: true,
            opacity: 0.3
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(building.x, building.y + fh / 2, building.z);
        if (hardpoint) {
            mesh.rotation.y = Math.atan2(hardpoint.dirX, hardpoint.dirZ);
        }
        mesh.castShadow = true;
        settlement._group.add(mesh);

        building._constructionMesh = mesh;
        building._constructionTotalVerts = geo.attributes.position.count;
        building._constructionProgress = 0;
        geo.setDrawRange(0, 0);
    }

    advanceConstruction(building, progressDelta) {
        if (building.state !== 'under_construction') return false;
        building._constructionProgress = Math.min(1, building._constructionProgress + progressDelta);
        const total = building._constructionTotalVerts || 100;
        const visible = Math.max(1, Math.floor(building._constructionProgress * total));

        if (building._constructionMesh && building._constructionMesh.geometry) {
            building._constructionMesh.geometry.setDrawRange(0, visible);
            building._constructionMesh.material.opacity = 0.3 + building._constructionProgress * 0.4;
        }

        if (building._constructionProgress >= 1.0) {
            this.completeConstruction(building);
            return true;
        }
        return false;
    }

    completeConstruction(building) {
        let settlement = null;
        for (const s of this.settlementSystem.settlements) {
            if (s.buildings.includes(building)) {
                settlement = s;
                break;
            }
        }
        if (!settlement) return;

        if (building._scaffoldMesh) {
            settlement._group.remove(building._scaffoldMesh);
            building._scaffoldMesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            building._scaffoldMesh = null;
        }

        if (building._constructionMesh) {
            settlement._group.remove(building._constructionMesh);
            building._constructionMesh.geometry.dispose();
            building._constructionMesh.material.dispose();
            building._constructionMesh = null;
        }

        const hardpoint = building._hardpointIndex >= 0 ? settlement._hardpoints[building._hardpointIndex] : null;
        this._createComponentMesh(settlement, building, building.type, hardpoint);
        building.state = 'complete';

        if (this.settlementSystem) {
            this.settlementSystem.scheduleOpening(building);
        }
    }

    _getPrefabBounds(type, rand) {
        switch (type) {
            case 'house':       return { w: 0.8 + rand() * 0.5, h: 0.8 + rand() * 0.4, d: 0.8 + rand() * 0.5 };
            case 'church':      return { w: 1.0 + rand() * 0.4, h: 1.8 + rand() * 0.6, d: 1.2 + rand() * 0.4 };
            case 'manor':       return { w: 1.4 + rand() * 0.6, h: 1.4 + rand() * 0.5, d: 1.2 + rand() * 0.5 };
            case 'barn':        return { w: 1.4 + rand() * 0.5, h: 1.0 + rand() * 0.3, d: 1.2 + rand() * 0.4 };
            case 'field':       return { w: 1.8 + rand() * 0.8, h: 0.15, d: 1.4 + rand() * 0.6 };
            case 'fishingHut':  return { w: 0.7 + rand() * 0.3, h: 0.6 + rand() * 0.3, d: 0.7 + rand() * 0.3 };
            case 'maypole':     return { w: 0.4, h: 1.6 + rand() * 0.4, d: 0.4 };
            case 'villageGreen':return { w: 2.0 + rand() * 1.0, h: 0.1, d: 2.0 + rand() * 1.0 };
            case 'pond':        return { w: 1.0 + rand() * 0.6, h: 0.05, d: 1.0 + rand() * 0.6 };
            case 'lampPost':    return { w: 0.25, h: 1.2 + rand() * 0.2, d: 0.25 };
            default:            return { w: 1.0, h: 1.0, d: 1.0 };
        }
    }

    getBuildingHeight(type) {
        switch (type) {
            case 'house': return 1.2;
            case 'church': return 2.4;
            case 'manor': return 2.2;
            case 'barn': return 1.6;
            case 'field': return 0.15;
            case 'fishingHut': return 1.0;
            case 'maypole': return 1.8;
            case 'villageGreen': return 0.1;
            case 'pond': return 0.05;
            case 'lampPost': return 1.3;
            default: return 1.0;
        }
    }

    emitTerrainDeltas(settlement, gx, gz, width, depth, targetHeight) {
        if (!this.terrainSystem || !this.terrainSystem.chunks) return;
        const deltas = [];
        for (let dx = 0; dx < width; dx++) {
            for (let dz = 0; dz < depth; dz++) {
                const tx = gx + dx;
                const tz = gz + dz;
                const chunkX = Math.floor(tx / this.terrainSystem.chunkSize);
                const chunkZ = Math.floor(tz / this.terrainSystem.chunkSize);
                const localX = Math.floor(tx - chunkX * this.terrainSystem.chunkSize);
                const localZ = Math.floor(tz - chunkZ * this.terrainSystem.chunkSize);
                deltas.push({ chunkX, chunkZ, localX, localZ, height: targetHeight });
            }
        }

        // Group by chunk
        const chunkMap = new Map();
        for (const d of deltas) {
            const key = `${d.chunkX},${d.chunkZ}`;
            if (!chunkMap.has(key)) chunkMap.set(key, []);
            chunkMap.get(key).push({ localX: d.localX, localZ: d.localZ, height: d.height });
        }

        const chunks = Array.from(chunkMap.entries()).map(([key, deltas]) => ({ key, deltas }));
        const nm = this.settlementSystem?.game?.networkManager;
        if (nm && nm.socket) {
            nm.socket.emit('terrainModified', { villageId: settlement.id, chunks });
        }
    }

    updateBuildingVisuals(settlement, deltaTime) {
        const hour = this.settlementSystem.getHourOfDay();
        const isNight = hour < 6 || hour >= 22;

        for (const building of settlement.buildings) {
            if (building.type === 'lampPost' && building._mesh) {
                const lamp = building._mesh.userData._lampMesh;
                if (lamp) {
                    lamp.material.color.setHex(isNight ? 0xffdd88 : 0x444444);
                    lamp.material.emissive = isNight
                        ? new THREE.Color(0xffaa44)
                        : new THREE.Color(0x000000);
                }
            }
        }
    }

    dispose() {
        for (const key of Object.keys(this.materials)) {
            this.materials[key].dispose();
        }
        this.materials = {};
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BuildingSystem;
}
