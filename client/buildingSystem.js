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
        this.buildingGeometries = {
            house:       new THREE.BoxGeometry(0.8, 0.7, 0.9),
            church:      new THREE.BoxGeometry(1.2, 1.6, 1.8),
            manor:       new THREE.BoxGeometry(1.8, 1.4, 2.2),
            barn:        new THREE.BoxGeometry(1.4, 1.0, 1.6),
            field:       new THREE.PlaneGeometry(2.0, 1.5),
            fishingHut:  new THREE.BoxGeometry(0.7, 0.6, 0.8),
            maypole:     new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8),
            lampPost:    new THREE.CylinderGeometry(0.05, 0.06, 1.2, 6),
            villageGreen:new THREE.CircleGeometry(2.5, 16),
            pond:        new THREE.CircleGeometry(1.2, 12)
        };

        this.buildingMaterials = {
            house:       new THREE.MeshLambertMaterial({ color: 0xc8b896 }),
            houseRoof:   new THREE.MeshLambertMaterial({ color: 0x8b4513 }),
            church:      new THREE.MeshLambertMaterial({ color: 0xd4c5a9 }),
            churchRoof:  new THREE.MeshLambertMaterial({ color: 0x4a3728 }),
            manor:       new THREE.MeshLambertMaterial({ color: 0xe8dcc8 }),
            manorRoof:   new THREE.MeshLambertMaterial({ color: 0x5c4033 }),
            barn:        new THREE.MeshLambertMaterial({ color: 0xa0522d }),
            barnRoof:    new THREE.MeshLambertMaterial({ color: 0x654321 }),
            field:       new THREE.MeshLambertMaterial({ color: 0x7c9c3e, side: THREE.DoubleSide }),
            fishingHut:  new THREE.MeshLambertMaterial({ color: 0x8b8682 }),
            maypole:     new THREE.MeshLambertMaterial({ color: 0xdeb887 }),
            lampPost:    new THREE.MeshLambertMaterial({ color: 0x4a4a4a }),
            villageGreen:new THREE.MeshLambertMaterial({ color: 0x5a8a3a, side: THREE.DoubleSide }),
            pond:        new THREE.MeshLambertMaterial({ color: 0x3a6b8c, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
            churchCross: new THREE.MeshLambertMaterial({ color: 0xffd700 })
        };

        console.log('[BuildingSystem] Initialized');
    }

    placeInitialBuildings(settlement) {
        const { x, z, typeDef } = settlement;

        if (typeDef.hasGreen) {
            this.addBuilding(settlement, 'villageGreen', x, z);
            this.addBuilding(settlement, 'pond', x + 3, z + 2);
            this.addBuilding(settlement, 'maypole', x + 1, z - 3);
        }

        if (typeDef.hasChurch) {
            this.addBuilding(settlement, 'church', x + 6, z - 2);
        }

        if (typeDef.hasManor) {
            this.addBuilding(settlement, 'manor', x - 8, z - 6);
        }

        const houseCount = Math.max(2, Math.floor(settlement.population / BUILDING_THRESHOLDS.housePerVillagers));
        for (let i = 0; i < houseCount; i++) {
            this.addBuilding(settlement, 'house');
        }

        const fieldCount = Math.max(1, Math.floor(settlement.population / BUILDING_THRESHOLDS.fieldPerVillagers));
        for (let i = 0; i < fieldCount; i++) {
            this.addBuilding(settlement, 'field');
        }

        if (typeDef.hasBarn && fieldCount >= BUILDING_THRESHOLDS.barnAfterFields) {
            this.addBuilding(settlement, 'barn');
        }
    }

    addBuilding(settlement, type, forceX, forceZ) {
        const id = ++this.buildingIdCounter;
        let bx, bz;
        const footprint = this.getBuildingFootprint(type);

        if (forceX !== undefined && forceZ !== undefined) {
            const gx = Math.round(forceX);
            const gz = Math.round(forceZ);
            if (this._isFootprintValid(settlement, type, gx, gz, footprint.w, footprint.d)) {
                bx = gx;
                bz = gz;
            } else {
                const pos = this.findBuildingPosition(settlement, type);
                if (!pos) return null;
                bx = pos.x;
                bz = pos.z;
            }
        } else {
            const pos = this.findBuildingPosition(settlement, type);
            if (!pos) return null;
            bx = pos.x;
            bz = pos.z;
        }

        const by = this.terrainSystem ? this.terrainSystem.getHeight(bx, bz) : 0;

        const building = {
            id,
            type,
            x: bx,
            z: bz,
            y: by,
            _mesh: null,
            _createdAt: settlement.age
        };

        this.createBuildingMesh(building, settlement);
        settlement.buildings.push(building);

        // Level terrain under elevated buildings and refresh meshes
        const shouldLevel = ['house', 'church', 'manor', 'barn', 'fishingHut', 'maypole', 'lampPost'].includes(type);
        if (shouldLevel && this.terrainSystem) {
            this.terrainSystem.levelTerrainArea(bx, bz, footprint.w, footprint.d, by);
            const boardSystem = this.settlementSystem?.game?.boardSystem;
            if (boardSystem && boardSystem.refreshTerrainInArea) {
                const refreshRadius = Math.max(footprint.w, footprint.d) + 1;
                boardSystem.refreshTerrainInArea(bx, bz, refreshRadius);
            }
        }

        if (type === 'house' || type === 'field' || type === 'barn' || type === 'fishingHut') {
            const exists = settlement.nodes.find(n => n.type === type && n.buildingRef === building);
            if (!exists) {
                settlement.nodes.push({
                    type,
                    x: bx,
                    z: bz,
                    y: by,
                    label: type.charAt(0).toUpperCase() + type.slice(1),
                    buildingRef: building
                });
            }
        }

        return building;
    }

    findBuildingPosition(settlement, type) {
        const center = { x: settlement.x, z: settlement.z };
        const footprint = this.getBuildingFootprint(type);
        const attempts = 25;

        for (let i = 0; i < attempts; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = this.getPlacementDistance(type);
            const rawX = center.x + Math.cos(angle) * dist;
            const rawZ = center.z + Math.sin(angle) * dist;
            const gx = Math.round(rawX);
            const gz = Math.round(rawZ);

            if (!this._isFootprintValid(settlement, type, gx, gz, footprint.w, footprint.d)) continue;

            return { x: gx, z: gz };
        }

        return null;
    }

    getPlacementDistance(type) {
        switch (type) {
            case 'house': return 4 + Math.random() * 10;
            case 'field': return 6 + Math.random() * 14;
            case 'barn': return 5 + Math.random() * 8;
            case 'fishingHut': return 8 + Math.random() * 12;
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

    createBuildingMesh(building, settlement) {
        const group = new THREE.Group();
        const bx = building.x;
        const bz = building.z;
        const by = building.y;
        const footprint = this.getBuildingFootprint(building.type);

        this.createFoundationMesh(group, footprint, by);

        switch (building.type) {
            case 'house':
                this.createHouseMesh(group);
                break;
            case 'church':
                this.createChurchMesh(group);
                break;
            case 'manor':
                this.createManorMesh(group);
                break;
            case 'barn':
                this.createBarnMesh(group);
                break;
            case 'field':
                this.createFieldMesh(group);
                break;
            case 'fishingHut':
                this.createFishingHutMesh(group);
                break;
            case 'maypole':
                this.createMaypoleMesh(group);
                break;
            case 'villageGreen':
                this.createVillageGreenMesh(group);
                break;
            case 'pond':
                this.createPondMesh(group);
                break;
            case 'lampPost':
                this.createLampPostMesh(group, building);
                break;
        }

        group.position.set(bx, by, bz);
        settlement._group.add(group);
        building._mesh = group;
    }

    createHouseMesh(group) {
        const body = new THREE.Mesh(this.buildingGeometries.house, this.buildingMaterials.house);
        body.position.y = 0.35;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const roofGeo = new THREE.ConeGeometry(0.65, 0.5, 4);
        const roof = new THREE.Mesh(roofGeo, this.buildingMaterials.houseRoof);
        roof.position.y = 0.85;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const doorGeo = new THREE.PlaneGeometry(0.2, 0.35);
        const door = new THREE.Mesh(doorGeo, new THREE.MeshLambertMaterial({ color: 0x4a3728 }));
        door.position.set(0, 0.2, 0.46);
        group.add(door);
    }

    createChurchMesh(group) {
        const body = new THREE.Mesh(this.buildingGeometries.church, this.buildingMaterials.church);
        body.position.y = 0.8;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const spireGeo = new THREE.ConeGeometry(0.4, 0.8, 4);
        const spire = new THREE.Mesh(spireGeo, this.buildingMaterials.churchRoof);
        spire.position.y = 1.8;
        spire.rotation.y = Math.PI / 4;
        spire.castShadow = true;
        group.add(spire);

        const crossGeo = new THREE.BoxGeometry(0.08, 0.25, 0.04);
        const crossVert = new THREE.Mesh(crossGeo, this.buildingMaterials.churchCross);
        crossVert.position.y = 2.3;
        group.add(crossVert);
        const crossHoriz = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.06, 0.04),
            this.buildingMaterials.churchCross
        );
        crossHoriz.position.set(0, 2.22, 0);
        group.add(crossHoriz);

        const doorGeo = new THREE.PlaneGeometry(0.3, 0.5);
        const door = new THREE.Mesh(doorGeo, new THREE.MeshLambertMaterial({ color: 0x3a2718 }));
        door.position.set(0, 0.3, 0.91);
        group.add(door);
    }

    createManorMesh(group) {
        const body = new THREE.Mesh(this.buildingGeometries.manor, this.buildingMaterials.manor);
        body.position.y = 0.7;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const roofGeo = new THREE.ConeGeometry(1.3, 0.7, 4);
        const roof = new THREE.Mesh(roofGeo, this.buildingMaterials.manorRoof);
        roof.position.y = 1.55;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const wingGeo = new THREE.BoxGeometry(0.8, 0.6, 1.0);
        const wing = new THREE.Mesh(wingGeo, this.buildingMaterials.manor);
        wing.position.set(1.1, 0.3, 0);
        wing.castShadow = true;
        group.add(wing);
    }

    createBarnMesh(group) {
        const body = new THREE.Mesh(this.buildingGeometries.barn, this.buildingMaterials.barn);
        body.position.y = 0.5;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const roofGeo = new THREE.ConeGeometry(1.0, 0.6, 4);
        const roof = new THREE.Mesh(roofGeo, this.buildingMaterials.barnRoof);
        roof.position.y = 1.1;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);
    }

    createFieldMesh(group) {
        const field = new THREE.Mesh(this.buildingGeometries.field, this.buildingMaterials.field);
        field.rotation.x = -Math.PI / 2;
        field.position.y = 0.05;
        field.receiveShadow = true;
        group.add(field);

        for (let i = 0; i < 5; i++) {
            const cropGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 4);
            const crop = new THREE.Mesh(cropGeo, new THREE.MeshLambertMaterial({ color: 0x6b8e23 }));
            crop.position.set(
                (Math.random() - 0.5) * 1.5,
                0.15,
                (Math.random() - 0.5) * 1.0
            );
            group.add(crop);
        }
    }

    createFishingHutMesh(group) {
        const body = new THREE.Mesh(this.buildingGeometries.fishingHut, this.buildingMaterials.fishingHut);
        body.position.y = 0.3;
        body.castShadow = true;
        group.add(body);

        const roofGeo = new THREE.ConeGeometry(0.55, 0.4, 4);
        const roof = new THREE.Mesh(roofGeo, this.buildingMaterials.barnRoof);
        roof.position.y = 0.7;
        roof.rotation.y = Math.PI / 4;
        group.add(roof);
    }

    createMaypoleMesh(group) {
        const pole = new THREE.Mesh(this.buildingGeometries.maypole, this.buildingMaterials.maypole);
        pole.position.y = 0.9;
        pole.castShadow = true;
        group.add(pole);

        const ribbonColors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const ribbonGeo = new THREE.BoxGeometry(0.02, 0.6, 0.02);
            const ribbon = new THREE.Mesh(ribbonGeo, new THREE.MeshLambertMaterial({ color: ribbonColors[i] }));
            ribbon.position.set(
                Math.cos(angle) * 0.3,
                0.6,
                Math.sin(angle) * 0.3
            );
            ribbon.rotation.z = angle;
            group.add(ribbon);
        }
    }

    createVillageGreenMesh(group) {
        const green = new THREE.Mesh(this.buildingGeometries.villageGreen, this.buildingMaterials.villageGreen);
        green.rotation.x = -Math.PI / 2;
        green.position.y = 0.02;
        green.receiveShadow = true;
        group.add(green);

        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
            const dist = 1.5 + Math.random();
            const treeGroup = new THREE.Group();
            const trunkGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.6, 6);
            const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
            trunk.position.y = 0.3;
            trunk.castShadow = true;
            treeGroup.add(trunk);
            const foliageGeo = new THREE.SphereGeometry(0.35, 6, 4);
            const foliage = new THREE.Mesh(foliageGeo, new THREE.MeshLambertMaterial({ color: 0x3a7a2a }));
            foliage.position.y = 0.7;
            foliage.castShadow = true;
            treeGroup.add(foliage);
            treeGroup.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
            group.add(treeGroup);
        }
    }

    createPondMesh(group) {
        const pond = new THREE.Mesh(this.buildingGeometries.pond, this.buildingMaterials.pond);
        pond.rotation.x = -Math.PI / 2;
        pond.position.y = 0.01;
        group.add(pond);
    }

    createLampPostMesh(group, building) {
        const post = new THREE.Mesh(this.buildingGeometries.lampPost, this.buildingMaterials.lampPost);
        post.position.y = 0.6;
        post.castShadow = true;
        group.add(post);

        const lampGeo = new THREE.BoxGeometry(0.15, 0.2, 0.15);
        const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffdd88 }));
        lamp.position.y = 1.25;
        group.add(lamp);
        building._lampMesh = lamp;
    }

    createFoundationMesh(group, footprint, height) {
        const fw = footprint.w;
        const fd = footprint.d;
        const foundationGeo = new THREE.BoxGeometry(fw * 0.95, 0.08, fd * 0.95);
        let color = 0x8b7355;
        if (this.terrainSystem && this.terrainSystem.getBiomeColor) {
            const biome = this.terrainSystem.getBiomeColor(height);
            color = new THREE.Color(biome.r, biome.g, biome.b);
        }
        const foundationMat = new THREE.MeshLambertMaterial({ color });
        const foundation = new THREE.Mesh(foundationGeo, foundationMat);
        foundation.position.y = -0.04;
        foundation.receiveShadow = true;
        group.add(foundation);
    }

    updateBuildingVisuals(settlement, deltaTime) {
        const hour = this.settlementSystem.getHourOfDay();
        const isNight = hour < 6 || hour >= 22;

        for (const building of settlement.buildings) {
            if (building.type === 'lampPost' && building._mesh && building._lampMesh) {
                building._lampMesh.material.color.setHex(isNight ? 0xffdd88 : 0x444444);
                building._lampMesh.material.emissive = isNight
                    ? new THREE.Color(0xffaa44)
                    : new THREE.Color(0x000000);
            }
        }
    }

    dispose() {
        for (const key of Object.keys(this.buildingGeometries)) {
            this.buildingGeometries[key].dispose();
        }
        for (const key of Object.keys(this.buildingMaterials)) {
            this.buildingMaterials[key].dispose();
        }
        this.buildingGeometries = {};
        this.buildingMaterials = {};
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BuildingSystem;
}
