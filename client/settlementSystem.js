// SettlementSystem — Main orchestrator for the settlement simulation
// Manages settlement lifecycle: spawning, population growth, building thresholds, inter-settlement connections

class SettlementSystem {
    constructor(scene, terrainSystem, game) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.game = game;

        this.settlements = [];
        this.settlementIdCounter = 0;

        this.villagerSystem = null;
        this.buildingSystem = null;
        this.roadSystem = null;
        this.knightSystem = null;
        this.tournamentSystem = null;

        this.minSpacing = 60;
        this.searchRadius = 200;
        this.maxSettlements = 12;

        this.spawnTimer = 0;
        this.spawnInterval = 8;
        this.initialSpawnDelay = 4;

        this.updateTimer = 0;
        this.updateInterval = 2.0;

        this.dayLength = 300;
        this.dayTimer = 0;
        this.dayOfYear = 90;

        this.cameraPos = new THREE.Vector3();
        this.activeRadius = 120;

        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;
        console.log('[SettlementSystem] Initialized');
    }

    setSubsystems(villagerSystem, buildingSystem, roadSystem, knightSystem, tournamentSystem) {
        this.villagerSystem = villagerSystem;
        this.buildingSystem = buildingSystem;
        this.roadSystem = roadSystem;
        this.knightSystem = knightSystem;
        this.tournamentSystem = tournamentSystem;
    }

    update(deltaTime, cameraPosition) {
        if (!this.initialized) return;
        if (cameraPosition) this.cameraPos.copy(cameraPosition);

        this.dayTimer += deltaTime;
        while (this.dayTimer >= this.dayLength) {
            this.dayTimer -= this.dayLength;
            this.dayOfYear = (this.dayOfYear + 1) % 360;
            this.onDayPassed();
        }

        this.spawnTimer += deltaTime;
        if (this.spawnTimer >= this.spawnInterval && this.settlements.length < this.maxSettlements) {
            this.spawnTimer = 0;
            this.trySpawnSettlement();
        }

        this.updateTimer += deltaTime;
        if (this.updateTimer >= this.updateInterval) {
            this.updateTimer = 0;
            this.updateSettlements();
        }

        for (const settlement of this.settlements) {
            if (settlement._active) {
                this.updateSettlementVisuals(settlement, deltaTime);
            }
        }
    }

    trySpawnSettlement() {
        const location = findSettlementLocation(
            this.terrainSystem,
            this.minSpacing,
            this.settlements,
            this.searchRadius,
            20
        );

        if (!location) return;

        const typeKey = Math.random() < SETTLEMENT_TYPES.hamlet.spawnWeight ? 'hamlet' : 'village';
        const typeDef = SETTLEMENT_TYPES[typeKey];

        const settlement = this.createSettlement(location.x, location.z, typeKey, typeDef);
        this.settlements.push(settlement);

        console.log(`[SettlementSystem] Spawned ${typeDef.name} "${settlement.name}" at (${location.x.toFixed(1)}, ${location.z.toFixed(1)})`);
    }

    createSettlement(x, z, typeKey, typeDef) {
        const id = ++this.settlementIdCounter;
        const name = generateSettlementName();
        const pop = typeDef.minPop + Math.floor(Math.random() * (typeDef.maxPop - typeDef.minPop));

        const settlement = {
            id,
            name,
            type: typeKey,
            typeDef,
            x, z,
            population: pop,
            maxPopulation: typeDef.maxPop,
            foodCapacity: pop * 2,
            buildings: [],
            nodes: [],
            villagers: [],
            roads: [],
            knight: null,
            age: 0,
            _active: false,
            _group: new THREE.Group(),
            _lastBuildingCheck: 0,
            _growthRate: 0.02 + Math.random() * 0.03
        };

        settlement._group.name = `Settlement_${name}`;
        this.scene.add(settlement._group);

        this.initializeSettlementNodes(settlement);
        this.placeInitialBuildings(settlement);

        if (this.villagerSystem) {
            this.villagerSystem.populateSettlement(settlement);
        }

        settlement._active = true;
        return settlement;
    }

    initializeSettlementNodes(settlement) {
        const { x, z, typeDef } = settlement;
        const nodes = [];

        const height = this.terrainSystem ? this.terrainSystem.getHeight(x, z) : 0;

        if (typeDef.hasGreen) {
            nodes.push({ type: 'villageGreen', x: x, z: z, y: height, label: 'Village Green' });
            nodes.push({ type: 'pond', x: x + 3, z: z + 2, y: height, label: 'Pond' });
            nodes.push({ type: 'maypole', x: x + 1, z: z - 3, y: height, label: 'Maypole' });
            nodes.push({ type: 'proclamationSpot', x: x - 3, z: z + 1, y: height, label: 'Proclamation Spot' });
        }

        if (typeDef.hasChurch) {
            nodes.push({ type: 'church', x: x + 6, z: z - 2, y: height, label: 'Church' });
        }

        if (typeDef.hasManor) {
            nodes.push({ type: 'manor', x: x - 8, z: z - 6, y: height, label: 'Manor' });
        }

        settlement.nodes = nodes;
    }

    placeInitialBuildings(settlement) {
        if (this.buildingSystem) {
            this.buildingSystem.placeInitialBuildings(settlement);
        }
    }

    updateSettlements() {
        for (const settlement of this.settlements) {
            if (!settlement._active) continue;

            const dist = distance2D(settlement, this.cameraPos);
            if (dist > this.activeRadius) continue;

            settlement.age++;

            if (settlement.population < settlement.maxPopulation) {
                const growth = settlement._growthRate * (1 + settlement.foodCapacity / Math.max(1, settlement.population * 2));
                settlement.population = Math.min(settlement.maxPopulation, settlement.population + growth);
            }

            this.checkBuildingThresholds(settlement);

            if (this.roadSystem) {
                this.roadSystem.updateSettlementRoads(settlement);
            }
        }

        if (this.roadSystem) {
            this.roadSystem.updateArterialRoads(this.settlements);
        }
    }

    checkBuildingThresholds(settlement) {
        if (!this.buildingSystem) return;

        const houseCount = settlement.buildings.filter(b => b.type === 'house').length;
        const expectedHouses = Math.floor(settlement.population / BUILDING_THRESHOLDS.housePerVillagers);
        if (houseCount < expectedHouses) {
            this.buildingSystem.addBuilding(settlement, 'house');
        }

        const fieldCount = settlement.buildings.filter(b => b.type === 'field').length;
        const expectedFields = Math.floor(settlement.population / BUILDING_THRESHOLDS.fieldPerVillagers);
        if (fieldCount < expectedFields) {
            this.buildingSystem.addBuilding(settlement, 'field');
        }

        const hasBarn = settlement.buildings.some(b => b.type === 'barn');
        if (!hasBarn && fieldCount >= BUILDING_THRESHOLDS.barnAfterFields) {
            this.buildingSystem.addBuilding(settlement, 'barn');
        }

        const hasFishingHut = settlement.buildings.some(b => b.type === 'fishingHut');
        if (!hasFishingHut && BUILDING_THRESHOLDS.fishingHutRequiresWater) {
            const nearWater = this.isNearWater(settlement.x, settlement.z, 15);
            if (nearWater) {
                this.buildingSystem.addBuilding(settlement, 'fishingHut');
            }
        }

        if (settlement.typeDef.hasManor && settlement.population >= BUILDING_THRESHOLDS.manorMinPopulation) {
            const hasManor = settlement.buildings.some(b => b.type === 'manor');
            if (!hasManor) {
                this.buildingSystem.addBuilding(settlement, 'manor');
                if (this.knightSystem) {
                    this.knightSystem.assignKnight(settlement);
                }
            }
        }
    }

    isNearWater(x, z, radius) {
        if (!this.terrainSystem) return false;
        for (let dx = -radius; dx <= radius; dx += 2) {
            for (let dz = -radius; dz <= radius; dz += 2) {
                if (Math.sqrt(dx * dx + dz * dz) > radius) continue;
                const h = this.terrainSystem.getHeight(x + dx, z + dz);
                if (h < -1.5) return true;
            }
        }
        return false;
    }

    updateSettlementVisuals(settlement, deltaTime) {
        if (this.buildingSystem) {
            this.buildingSystem.updateBuildingVisuals(settlement, deltaTime);
        }
        if (this.villagerSystem) {
            this.villagerSystem.updateSettlementVillagers(settlement, deltaTime);
        }
    }

    onDayPassed() {
        const season = getCurrentSeason(this.dayOfYear);
        const seasonDef = SEASONS[season];

        for (const settlement of this.settlements) {
            if (!settlement._active) continue;
            if (this.villagerSystem) {
                this.villagerSystem.onDayPassed(settlement, season, seasonDef);
            }
        }

        if (this.tournamentSystem && Math.random() < 0.05) {
            this.tournamentSystem.tryTriggerTournament(this.settlements);
        }
    }

    getHourOfDay() {
        return (this.dayTimer / this.dayLength) * 24;
    }

    getCurrentTimeSlot() {
        return getCurrentTimeSlot(this.getHourOfDay());
    }

    getCurrentSeason() {
        return getCurrentSeason(this.dayOfYear);
    }

    getSettlementAt(x, z, maxDist) {
        let closest = null;
        let closestDist = maxDist || 20;
        for (const s of this.settlements) {
            const d = distance2D({ x, z }, s);
            if (d < closestDist) {
                closestDist = d;
                closest = s;
            }
        }
        return closest;
    }

    getActiveSettlements() {
        return this.settlements.filter(s => {
            return s._active && distance2D(s, this.cameraPos) < this.activeRadius;
        });
    }

    removeSettlement(settlementId) {
        const idx = this.settlements.findIndex(s => s.id === settlementId);
        if (idx === -1) return;
        const settlement = this.settlements[idx];

        if (settlement._group) {
            this.scene.remove(settlement._group);
            settlement._group.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }

        this.settlements.splice(idx, 1);
    }

    dispose() {
        for (const settlement of [...this.settlements]) {
            this.removeSettlement(settlement.id);
        }
        this.settlements = [];
        this.initialized = false;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettlementSystem;
}
