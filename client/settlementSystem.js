// SettlementSystem — Client-side settlement rendering and server sync
// Villages are generated server-side; client fetches and renders them

class SettlementSystem {
    constructor(scene, terrainSystem, game) {
        this.scene = scene;
        this.terrainSystem = terrainSystem;
        this.game = game;

        this.settlements = [];
        this.settlementMap = new Map();
        this.ceremonyQueue = [];
        this.pendingBuildings = new Map(); // villageId -> [{type, x, z, y, startedAtDay}]
        this._networkHandlersAttached = false;

        this.villagerSystem = null;
        this.buildingSystem = null;
        this.roadSystem = null;
        this.knightSystem = null;
        this.tournamentSystem = null;

        this.minSpacing = 200;
        this.searchRadius = 400;
        this.maxSettlements = 10;

        this.updateTimer = 0;
        this.updateInterval = 2.0;

        this.dayLength = 300;
        this.dayTimer = 0;
        this.dayOfYear = 90;

        this.cameraPos = new THREE.Vector3();
        this.activeRadius = 120;

        this._settlementsRequested = false;
        this._lastRequestX = 0;
        this._lastRequestZ = 0;

        this.pendingFoundings = new Map(); // villageId -> settlement data
        this.initialized = false;
        this.lodManager = null;
        this._scratchPos = new THREE.Vector3();
    }

    init() {
        if (this.initialized) return;
        this.settlements = [];
        this.settlementMap.clear();
        this.pendingFoundings.clear();
        this._settlementsRequested = false;
        this._lastRequestX = 0;
        this._lastRequestZ = 0;
        this.initialized = true;
        if (this.villagerSystem) this.villagerSystem.init();
        if (this.buildingSystem) this.buildingSystem.init();
        if (this.roadSystem) this.roadSystem.init();
        if (this.knightSystem) this.knightSystem.init();
        if (this.tournamentSystem) this.tournamentSystem.init();

        // Network handlers attached later in game.setupNetwork() after networkManager is ready
        console.log('[SettlementSystem] Initialized');
        // Auto-request disabled: villages are only spawned manually via dev tab
        // if (this._networkHandlersAttached) {
        //     this.requestSettlements();
        // }
    }

    setSubsystems(villagerSystem, buildingSystem, roadSystem, knightSystem, tournamentSystem) {

        // Deferred init: if any settlements were created before subsystems were ready
        for (const settlement of this.settlements) {
            if (settlement._needsVillagerInit && villagerSystem) {
                delete settlement._needsVillagerInit;
                if (settlement.villagers.length > 0) {
                    villagerSystem.initVillagersFromServer(settlement, settlement.villagers);
                } else if (settlement.population > 0) {
                    villagerSystem.populateSettlement(settlement);
                }
                for (const b of settlement.buildings) {
                    if (b.state === 'under_construction') {
                        villagerSystem.startConstruction(settlement, b.type);
                    }
                }
            }
            if (settlement._needsBuildingInit && buildingSystem) {
                delete settlement._needsBuildingInit;
                buildingSystem.createSettlementBase(settlement);
                buildingSystem.placeInitialBuildings(settlement);
            }
        }
        this.villagerSystem = villagerSystem;
        this.buildingSystem = buildingSystem;
        this.roadSystem = roadSystem;
        this.knightSystem = knightSystem;
        this.tournamentSystem = tournamentSystem;
    }

    connectLODManager(lodManager) {
        if (!lodManager) return;
        this.lodManager = lodManager;
        lodManager.registerGroup('settlements', {
            levels: [{ name: 'full', distance: 0 }],
            cullDistance: this.activeRadius * 2,
            frustumCull: true,
            getPosition: (settlement) => {
                this._scratchPos.set(settlement.x, settlement.height || 0, settlement.z);
                return this._scratchPos;
            },
            getBoundsRadius: () => 15.0,
            onCull: (settlement, id) => {
                if (settlement._group && settlement._group.parent) {
                    this.scene.remove(settlement._group);
                    settlement._lodVisible = false;
                }
            },
            onVisible: (settlement, id) => {
                if (settlement._group && !settlement._group.parent) {
                    this.scene.add(settlement._group);
                    settlement._lodVisible = true;
                }
            }
        });
        for (const settlement of this.settlements) {
            this._registerSettlementLOD(settlement);
        }
    }

    _registerSettlementLOD(settlement) {
        if (!this.lodManager || !settlement.id) return;
        this.lodManager.add('settlements', settlement, settlement.id);
    }

    _unregisterSettlementLOD(settlement) {
        if (!this.lodManager) return;
        this.lodManager.remove('settlements', settlement.id);
    }

    requestSettlements(x, z, radius) {
        if (!this.game || !this.game.networkManager) return;
        const cx = x || this.cameraPos.x;
        const cz = z || this.cameraPos.z;
        const r = radius || this.searchRadius;

        if (this._settlementsRequested &&
            Math.abs(cx - this._lastRequestX) < 50 &&
            Math.abs(cz - this._lastRequestZ) < 50) return;

        this._lastRequestX = cx;
        this._lastRequestZ = cz;
        this._settlementsRequested = true;

        console.log('[SettlementSystem] requestSettlements emit', { x: cx, z: cz, radius: r });
        this.game.networkManager.emit('requestSettlements', { x: cx, z: cz, radius: r });
    }

    attachNetworkHandlers() {
        if (this._networkHandlersAttached) {
            return true;
        }
        if (!this.game || !this.game.networkManager) {
            console.warn('[SettlementSystem] attachNetworkHandlers: networkManager not ready yet');
            return false;
        }

        // console.log('[SettlementSystem] Registering network handlers');
        this.game.networkManager.on('settlementsReceived', (data) => this.onSettlementsReceived(data));
        this.game.networkManager.on('tomeUpdate', (data) => this.onTomeUpdate(data));
        this.game.networkManager.on('buildingStarted', (data) => this.onBuildingStarted(data));
        this._networkHandlersAttached = true;
        // console.log('[SettlementSystem] Network handlers registered (settlements/tome/buildingStarted)');

        // Auto-request disabled: villages are only spawned manually via dev tab
        // if (!this._settlementsRequested) {
        //     this.requestSettlements();
        // }
        return true;
    }

    onSettlementsReceived(data) {
        // console.log('[SettlementSystem] onSettlementsReceived called, villages:', data?.villages?.length);
        if (!data || !data.villages) {
            // console.log('[SettlementSystem] No villages data');
            return;
        }

        try {
            const receivedIds = new Set(data.villages.map(v => v.id));

            for (const villageData of data.villages) {
                // console.log('[SettlementSystem] Processing village:', villageData.id, villageData.name);
                let settlement = this.settlementMap.get(villageData.id);

                if (!settlement) {
                    settlement = this.createSettlementFromBlueprint(villageData);
                    this.settlements.push(settlement);
                    this.settlementMap.set(villageData.id, settlement);
                    // console.log('[SettlementSystem] Created and added settlement, total:', this.settlements.length);
                } else {
                    this.updateSettlementFromBlueprint(settlement, villageData);
                    if (villageData.buildings && this.buildingSystem) {
                        this.buildingSystem.syncBuildings(settlement, villageData.buildings);
                    }
                }
            }

            // Only deactivate missing settlements if this looks like a full sync response
            // (broadcasts of single new villages should not deactivate existing ones)
            if (data.villages.length > 1) {
                for (const s of this.settlements) {
                    if (!receivedIds.has(s.id)) {
                        s._active = false;
                    }
                }
            }
        } catch (err) {
            console.error('[SettlementSystem] onSettlementsReceived ERROR:', err, err?.stack);
            throw err;
        }
    }

    createSettlementFromBlueprint(data) {
        const settlement = {
            id: data.id,
            name: data.name,
            type: data.type,
            typeDef: data.typeDef || SETTLEMENT_TYPES[data.type],
            x: data.x,
            z: data.z,
            height: data.height || 0,
            population: data.population || 0,
            maxPopulation: data.maxPopulation || 80,
            foodCapacity: data.foodCapacity || 0,
            faithCapacity: data.faithCapacity || 0,
            buildings: [],
            nodes: data.nodes || [],
            villagers: data.villagers || [],
            roads: data.roads || [],
            knight: data.knight || null,
            age: data.age || 0,
            state: data.state || 'founding',
            _active: true,
            _group: new THREE.Group(),
            _lastBuildingCheck: 0,
            _ledger: null
        };

        settlement._group.name = `Settlement_${settlement.name}`;
        this.scene.add(settlement._group);
        this._registerSettlementLOD(settlement);

        // Terrain-gate: defer if chunk not loaded
        if (!this.isTerrainLoaded(settlement.x, settlement.z)) {
            this.pendingFoundings.set(settlement.id, settlement);
            console.log(`[SettlementSystem] ${settlement.name} deferred — terrain not loaded yet`);
            return settlement;
        }

        this.finalizeSettlementSpawn(settlement, data);
        return settlement;
    }

    isTerrainLoaded(x, z) {
        if (!this.terrainSystem || !this.terrainSystem.chunks) return false;
        const cs = this.terrainSystem.chunkSize || 16;
        const cx = Math.floor(x / cs);
        const cz = Math.floor(z / cs);
        const chunk = this.terrainSystem.chunks.get(`${cx},${cz}`);
        return !!(chunk && chunk.data);
    }

    finalizeSettlementSpawn(settlement, data) {
        console.log(`[SettlementSystem] Finalizing ${settlement.name}: pop=${settlement.population}, serverBuildings=${data.buildings?.length || 0}`);

        // Re-sample height from loaded terrain
        if (this.terrainSystem) {
            settlement.height = this.terrainSystem.getHeight(settlement.x, settlement.z);
        }

        if (this.buildingSystem) {
            this.buildingSystem.createSettlementBase(settlement);
            if (data.buildings && data.buildings.length > 0) {
                this.buildingSystem.syncBuildings(settlement, data.buildings);
            } else {
                this.buildingSystem.placeInitialBuildings(settlement);
            }
        } else {
            settlement._needsBuildingInit = true;
        }

        // Initialize villagers
        if (this.villagerSystem) {
            if (settlement.villagers.length > 0) {
                this.villagerSystem.initVillagersFromServer(settlement, settlement.villagers);
            } else if (settlement.population > 0) {
                this.villagerSystem.populateSettlement(settlement);
            }
            // Kick off construction for any buildings already under construction
            for (const b of settlement.buildings) {
                if (b.state === 'under_construction') {
                    this.villagerSystem.startConstruction(settlement, b.type);
                }
            }
        } else {
            settlement._needsVillagerInit = true;
        }
    }

    checkPendingFoundings() {
        for (const [id, settlement] of this.pendingFoundings) {
            if (this.isTerrainLoaded(settlement.x, settlement.z)) {
                this.pendingFoundings.delete(id);
                this.finalizeSettlementSpawn(settlement, settlement);
            }
        }
    }

    onBuildingStarted(data) {
        if (!data || !data.villageId || !data.building) return;
        const settlement = this.settlementMap.get(data.villageId);
        if (!settlement) return;

        const b = data.building;
        if (this.buildingSystem) {
            this.buildingSystem.attachComponent(settlement, b.type, {
                state: 'under_construction',
                startedAtDay: b.startedAtDay
            });
        }

        if (this.villagerSystem && this.villagerSystem.startConstruction) {
            this.villagerSystem.startConstruction(settlement, b.type);
        }
    }

    checkPendingBuildings() {
        for (const [villageId, list] of this.pendingBuildings) {
            const settlement = this.settlementMap.get(villageId);
            if (!settlement) continue;
            for (const b of list) {
                if (this.buildingSystem) {
                    this.buildingSystem.attachComponent(settlement, b.type, {
                        state: 'under_construction',
                        startedAtDay: b.startedAtDay
                    });
                }
                if (this.villagerSystem && this.villagerSystem.startConstruction) {
                    this.villagerSystem.startConstruction(settlement, b.type);
                }
            }
            this.pendingBuildings.delete(villageId);
        }
    }

    createSettlementBase(settlement) {
        if (this.buildingSystem) {
            this.buildingSystem.createSettlementBase(settlement);
        }
    }

    addBuildingData(settlement, b) {
        const exists = settlement.buildings.find(
            existing => existing.type === b.type && Math.round(existing.x) === Math.round(b.x) && Math.round(existing.z) === Math.round(b.z)
        );
        if (exists) {
            exists.state = b.state || exists.state;
            return exists;
        }

        const building = {
            id: this.buildingSystem ? ++this.buildingSystem.buildingIdCounter : ++settlement.buildings.length,
            type: b.type,
            x: b.x,
            z: b.z,
            y: b.y !== undefined ? b.y : settlement.height,
            state: b.state || 'complete',
            _mesh: null,
            _createdAt: settlement.age,
            _startedAtDay: b.startedAtDay || 0,
            _constructionProgress: b.state === 'under_construction' ? 0 : undefined,
            _constructionTotalVerts: b.state === 'under_construction' ? 100 : undefined
        };

        settlement.buildings.push(building);

        // Add node for villager pathfinding
        const nodeTypes = ['house', 'field', 'barn', 'fishingHut', 'villageGreen', 'church', 'manor', 'pond', 'maypole', 'proclamationSpot', 'lampPost'];
        if (nodeTypes.includes(building.type)) {
            const nodeExists = settlement.nodes.find(n => n.type === building.type && n.buildingRef === building);
            if (!nodeExists) {
                settlement.nodes.push({
                    type: building.type,
                    x: building.x,
                    z: building.z,
                    y: building.y,
                    label: building.type.charAt(0).toUpperCase() + building.type.slice(1),
                    buildingRef: building
                });
            }
        }

        return building;
    }

    updateSettlementFromBlueprint(settlement, data) {
        settlement.population = data.population || settlement.population;
        settlement.maxPopulation = data.maxPopulation || settlement.maxPopulation;
        settlement.foodCapacity = data.foodCapacity || settlement.foodCapacity;
        settlement.faithCapacity = data.faithCapacity || settlement.faithCapacity;
        settlement.age = data.age || settlement.age;
        settlement._active = true;
    }

    onTomeUpdate(data) {
        if (!data || !data.villageId) return;

        const settlement = this.settlementMap.get(data.villageId);
        if (!settlement) return;

        settlement._ledger = data.ledger || null;

        if (data.villagers && this.villagerSystem) {
            this.villagerSystem.applyTomeUpdate(settlement, data.villagers);
        }

        if (data.ledger) {
            settlement.foodCapacity = Math.floor((data.ledger.grainStock || 0) + (data.ledger.fishStock || 0));
            settlement.faithCapacity = Math.floor(data.ledger.faithStock || 0);
        }
    }

    forceSpawnVillage(x, z) {
        console.log('[SettlementSystem] forceSpawnVillage called', { x, z, hasGame: !!this.game, hasNetwork: !!this.game?.networkManager, connected: this.game?.networkManager?.connected });
        if (this.game && this.game.networkManager) {
            this.game.networkManager.emit('spawnDebugVillage', { x, z });
            console.log(`[SettlementSystem] Requested server spawn at (${x.toFixed(1)}, ${z.toFixed(1)})`);
            return true;
        }
        console.warn('[SettlementSystem] Cannot spawn: no networkManager');
        return false;
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

        this.updateTimer += deltaTime;
        if (this.updateTimer >= this.updateInterval) {
            this.updateTimer = 0;
            this.updateSettlements();
        }

        this.checkPendingFoundings();
        this.checkPendingBuildings();

        // Fallback disabled: villages are only spawned manually via dev tab
        // this._fallbackRequestTimer = (this._fallbackRequestTimer || 0) + deltaTime;
        // if (this._fallbackRequestTimer >= 10.0) {
        //     this._fallbackRequestTimer = 0;
        //     if (this.settlements.length === 0) {
        //         this._settlementsRequested = false;
        //         this.requestSettlements(this.cameraPos.x, this.cameraPos.z, 400);
        //     }
        // }

        for (const settlement of this.settlements) {
            if (settlement._active) {
                this.updateSettlementVisuals(settlement, deltaTime);
            }
        }
    }

    updateSettlements() {
        for (const settlement of this.settlements) {
            if (!settlement._active) continue;

            const dist = distance2D(settlement, this.cameraPos);
            if (dist > this.activeRadius) continue;

            if (this.roadSystem) {
                this.roadSystem.updateSettlementRoads(settlement);
            }
        }

        if (this.roadSystem) {
            this.roadSystem.updateArterialRoads(this.settlements);
        }
    }

    updateSettlementVisuals(settlement, deltaTime) {
        if (settlement._lodVisible === false) return;
        if (this.buildingSystem) {
            this.buildingSystem.updateBuildingVisuals(settlement, deltaTime);
        }
        if (this.villagerSystem) {
            this.villagerSystem.updateSettlementVillagers(settlement, deltaTime, this.cameraPos);
        }
    }

    scheduleOpening(building) {
        const settlement = this.settlements.find(s => s.buildings.includes(building));
        if (!settlement) return;

        if (!settlement._pendingCeremonies) settlement._pendingCeremonies = [];
        settlement._pendingCeremonies.push({
            building,
            scheduledDay: this.dayOfYear + 1,
            startHour: 9,
            endHour: 17
        });
        console.log(`[SettlementSystem] Opening ceremony scheduled for ${building.type}`);
    }

    checkCeremonies(settlement) {
        if (!settlement._pendingCeremonies) return;
        const hour = this.getHourOfDay();

        for (let i = settlement._pendingCeremonies.length - 1; i >= 0; i--) {
            const c = settlement._pendingCeremonies[i];
            if (this.dayOfYear >= c.scheduledDay && hour >= c.startHour && hour < c.endHour) {
                settlement._pendingCeremonies.splice(i, 1);
                if (this.villagerSystem) {
                    this.villagerSystem.triggerOpeningCeremony(settlement, c.building);
                }
            }
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
            this.checkCeremonies(settlement);
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

        this._unregisterSettlementLOD(settlement);

        if (settlement._group) {
            try {
                this.scene.remove(settlement._group);
            } catch (e) {
                console.warn('[SettlementSystem] scene.remove failed:', e.message);
            }
            try {
                settlement._group.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => { try { m.dispose(); } catch (_) {} });
                        } else {
                            try { child.material.dispose(); } catch (_) {}
                        }
                    }
                });
            } catch (e) {
                console.warn('[SettlementSystem] dispose traverse failed:', e.message);
            }
        }

        this.settlementMap.delete(settlementId);
        this.settlements.splice(idx, 1);
    }

    dispose() {
        for (const settlement of [...this.settlements]) {
            try {
                this.removeSettlement(settlement.id);
            } catch (e) {
                console.error('[SettlementSystem] removeSettlement failed:', e);
            }
        }
        this.settlements = [];
        this.settlementMap.clear();
        this.initialized = false;
        try { if (this.villagerSystem) this.villagerSystem.dispose(); } catch (e) {}
        try { if (this.buildingSystem) this.buildingSystem.dispose(); } catch (e) {}
        try { if (this.roadSystem) this.roadSystem.dispose(); } catch (e) {}
        try { if (this.knightSystem) this.knightSystem.dispose(); } catch (e) {}
        try { if (this.tournamentSystem) this.tournamentSystem.dispose(); } catch (e) {}
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettlementSystem;
}
