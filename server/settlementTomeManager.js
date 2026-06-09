// SettlementTomeManager — Holds all village tomes, daily 03:00 resolution, mutation collection
// Server-authoritative villager state and daily simulation

const path = require('path');
const settlementData = require(path.join(__dirname, '..', 'client', 'settlementData'));

const { VILLAGER_ROLES, TASKS, SEASONS, BUILDING_THRESHOLDS, getCurrentSeason } = settlementData;

const VILLAGER_FIRST_NAMES = [
    'Eldwin', 'Godwin', 'Aldric', 'Bertram', 'Cedric', 'Dunstan', 'Edmund', 'Felton',
    'Gareth', 'Halford', 'Ivor', 'Jocelyn', 'Kenric', 'Leofric', 'Merrick', 'Norbert',
    'Oswin', 'Percival', 'Quentin', 'Rowland', 'Stanwin', 'Theobald', 'Ulric', 'Vernon',
    'Wilfred', 'Yorick', 'Alfred', 'Baldwin', 'Conrad', 'Drogo', 'Elric', 'Fulk',
    'Gervase', 'Hamond', 'Ingram', 'Jasper', 'Kendrick', 'Lambert', 'Milo', 'Nigel',
    'Orson', 'Piers', 'Ralph', 'Simon', 'Thurstan', 'Wymond'
];

class SettlementTomeManager {
    constructor(settlementGenerator, gameState) {
        this.settlementGenerator = settlementGenerator;
        this.gameState = gameState;
        this.tomes = new Map();        // villageId -> { ledger, villagers[] }
        this.pendingMutations = [];    // queued player overrides
        this.lastResolutionDay = -1;
        this.tomeVersion = 0;
    }

    init() {
        const villages = this.settlementGenerator.generatedVillages;
        for (const village of villages) {
            this.initializeTome(village);
        }
        console.log(`[TomeManager] Initialized ${this.tomes.size} village tomes`);
    }

    initializeTome(village) {
        const ledger = {
            villageId: village.id,
            grainStock: 6,
            fishStock: 3,
            faithStock: 0,
            dietBias: 0.35,
            collectiveStress: 25,
            lastFestivalDay: 0,
            ownedByKnightId: null
        };

        const villagers = this.generateVillagers(village);

        this.tomes.set(village.id, { ledger, villagers });
        village.villagers = villagers;
    }

    generateVillagers(village) {
        const villagers = [];
        const pop = Math.floor(village.population);
        const seed = this.settlementGenerator.worldSeed + parseInt(village.id.split('_')[1]) * 500 + 77;

        const rand = this.settlementGenerator.seededRandom(seed);

        const roleDistribution = this.buildRoleDistribution(village.typeDef, pop);

        for (let i = 0; i < pop; i++) {
            const nameIdx = Math.floor(rand() * VILLAGER_FIRST_NAMES.length);
            const name = VILLAGER_FIRST_NAMES[nameIdx] + (i >= VILLAGER_FIRST_NAMES.length ? ` ${i}` : '');

            const role = this.pickRole(roleDistribution, rand);
            const roleDef = VILLAGER_ROLES[role];

            const villager = {
                id: `${village.id}_villager_${String(i + 1).padStart(3, '0')}`,
                name,
                role,
                stress: 10 + rand() * 30,
                faith: role === 'priest' || role === 'monk' ? 20 + rand() * 30 : 5 + rand() * 15,
                grumpy: false,
                calledToService: false,
                activities: [
                    {
                        slot: 0,
                        assigned: roleDef ? roleDef.morningTasks[0] : 'wander',
                        playerOverride: null
                    },
                    {
                        slot: 1,
                        assigned: roleDef ? roleDef.eveningTasks[0] : 'rest',
                        playerOverride: null
                    }
                ],
                walkType: null,
                age: 20 + Math.floor(rand() * 40)
            };

            villagers.push(villager);
        }

        return villagers;
    }

    buildRoleDistribution(typeDef, pop) {
        const dist = [];

        if (typeDef.hasManor) {
            dist.push({ role: 'knight', count: 1 });
            dist.push({ role: 'mayor', count: 1 });
        }

        if (typeDef.hasChurch) {
            dist.push({ role: 'priest', count: 1 });
        }

        const fixed = dist.reduce((s, d) => s + d.count, 0);
        const remaining = Math.max(0, pop - fixed);

        if (remaining === 0) {
            return dist.length > 0 ? dist : [{ role: 'villager', count: 1 }];
        }

        const farmerCount = Math.floor(remaining * 0.5);
        const villagerCount = Math.floor(remaining * 0.25);
        const fisherCount = Math.floor(remaining * 0.1);
        const childCount = Math.max(1, Math.floor(remaining * 0.1));
        const monkCount = typeDef.hasChurch ? Math.max(0, Math.floor(remaining * 0.05)) : 0;
        const townCrierCount = typeDef.hasManor ? 1 : 0;

        dist.push({ role: 'farmer', count: farmerCount });
        dist.push({ role: 'villager', count: villagerCount });
        dist.push({ role: 'fisher', count: fisherCount });
        dist.push({ role: 'child', count: childCount });
        if (monkCount > 0) dist.push({ role: 'monk', count: monkCount });
        if (townCrierCount > 0) dist.push({ role: 'townCrier', count: townCrierCount });

        return dist;
    }

    pickRole(distribution, rand) {
        const total = distribution.reduce((s, d) => s + d.count, 0);
        let roll = rand() * total;
        for (const entry of distribution) {
            roll -= entry.count;
            if (roll <= 0) return entry.role;
        }
        return distribution[distribution.length - 1].role;
    }

    queueMutation(villageId, villagerId, slotIndex, newActivity, playerId) {
        this.pendingMutations.push({
            villageId,
            villagerId,
            slotIndex,
            newActivity,
            playerId,
            submittedDay: this.getCurrentGameDay()
        });
        console.log(`[TomeManager] Queued mutation: ${villagerId} slot ${slotIndex} -> ${newActivity} by ${playerId}`);
    }

    getCurrentGameDay() {
        if (!this.gameState) return 0;
        const now = Date.now();
        const elapsed = now - (this.gameState.epoch || now);
        const dayLength = this.gameState.dayLength || 60000;
        return Math.floor(elapsed / dayLength);
    }

    getCurrentDayOfYear() {
        const totalDays = this.getCurrentGameDay();
        return ((totalDays % 360) + 360) % 360;
    }

    resolveDailyTick() {
        const currentDay = this.getCurrentGameDay();
        if (currentDay === this.lastResolutionDay) return;
        this.lastResolutionDay = currentDay;

        const dayOfYear = this.getCurrentDayOfYear();
        const season = getCurrentSeason(dayOfYear);
        const seasonDef = SEASONS[season];

        console.log(`[TomeManager] Resolving daily tick for day ${currentDay} (season: ${season})`);

        for (const [villageId, tome] of this.tomes) {
            this.resolveVillageDay(villageId, tome, season);
        }

        this.pendingMutations = [];
        this.tomeVersion++;
    }

    resolveVillageDay(villageId, tome, season) {
        const { ledger, villagers } = tome;
        const village = this.settlementGenerator.getVillageById(villageId);
        if (!village) return;

        let totalGrain = 0;
        let totalFish = 0;
        let totalFaith = 0;

        for (const villager of villagers) {
            const morning = villager.activities[0].playerOverride || villager.activities[0].assigned;
            const evening = villager.activities[1].playerOverride || villager.activities[1].assigned;

            let grainOutput = 0, fishOutput = 0, faithOutput = 0;
            let stressDelta = 0;

            for (const activity of [morning, evening]) {
                switch (activity) {
                    case 'harvest':
                    case 'tendFields':
                    case 'visitFields':
                        grainOutput += 1;
                        stressDelta += 2;
                        break;
                    case 'fish':
                    case 'mendNets':
                        fishOutput += 1;
                        stressDelta += 2;
                        break;
                    case 'pray':
                    case 'attendChurch':
                        faithOutput += villager.role === 'monk' ? 3 : villager.role === 'priest' ? 2 : 1;
                        stressDelta -= 3;
                        break;
                    case 'wander':
                    case 'play':
                        stressDelta -= 8;
                        villager.walkType = this.pickWalkType();
                        break;
                    case 'rest':
                        stressDelta -= 2;
                        break;
                    case 'celebrate':
                        stressDelta -= 10;
                        break;
                    case 'socialize':
                        stressDelta -= 4;
                        break;
                    default:
                        stressDelta += 1;
                        break;
                }
            }

            if (villager.calledToService) {
                stressDelta += 5;
            }

            if (villager.grumpy) {
                stressDelta += 3;
                faithOutput = 0;
            }

            villager.stress = Math.max(0, Math.min(150, villager.stress + stressDelta));

            if (villager.stress > 100 && !villager.grumpy) {
                villager.grumpy = true;
                console.log(`[TomeManager] ${villager.name} became grumpy! (stress: ${villager.stress.toFixed(0)})`);
            } else if (villager.stress < 30 && villager.grumpy) {
                villager.grumpy = false;
            }

            totalGrain += grainOutput;
            totalFish += fishOutput;
            totalFaith += faithOutput;
        }

        const pop = villagers.length;
        ledger.grainStock += totalGrain - pop * 0.5;
        ledger.fishStock += totalFish - pop * 0.3;
        ledger.faithStock += totalFaith;

        if (ledger.grainStock < pop) {
            ledger.faithStock += pop * 0.5;
        }

        ledger.grainStock = Math.max(0, ledger.grainStock);
        ledger.fishStock = Math.max(0, ledger.fishStock);
        ledger.faithStock = Math.max(0, ledger.faithStock);

        const totalFishConsumed = pop * 0.3;
        const totalGrainConsumed = pop * 0.5;
        const totalFood = totalFishConsumed + totalGrainConsumed;
        ledger.dietBias = totalFood > 0 ? totalFishConsumed / totalFood : 0.35;

        ledger.collectiveStress = villagers.reduce((s, v) => s + v.stress, 0) / pop;

        // ── Population change (births / deaths) ──
        const foodStock = ledger.grainStock + ledger.fishStock;
        this.resolvePopulationChange(village, tome, season, foodStock);

        // ── Advance construction progress ──
        this.advanceConstruction(village);

        // ── Building expansion ──
        this.resolveBuildingExpansion(village);

        village.age++;
        village.population = villagers.length;
        village.foodCapacity = Math.floor(ledger.grainStock + ledger.fishStock);
        village.faithCapacity = Math.floor(ledger.faithStock);
    }

    resolvePopulationChange(village, tome, season, foodStock) {
        const { villagers, ledger } = tome;
        const pop = villagers.length;
        const maxPop = village.maxPopulation || 80;

        // Deaths
        if (foodStock < pop * 0.3 && pop > 1) {
            // Starvation: remove weakest (highest stress) villager
            const weakest = villagers.reduce((w, v, i) => v.stress > w.stress ? { stress: v.stress, idx: i } : w, { stress: -1, idx: -1 });
            if (weakest.idx >= 0) {
                const removed = villagers.splice(weakest.idx, 1)[0];
                console.log(`[TomeManager] ${removed.name} starved in ${village.name}`);
            }
            return; // no births after starvation
        }

        // Natural deaths (old age)
        for (let i = villagers.length - 1; i >= 0; i--) {
            if (villagers[i].age > 70 && Math.random() < 0.005) {
                const removed = villagers.splice(i, 1)[0];
                console.log(`[TomeManager] ${removed.name} died of old age in ${village.name}`);
            }
        }

        // Births
        if (pop >= maxPop) return;
        if (foodStock <= pop * 1.5) return; // no surplus

        const grumpyCount = villagers.filter(v => v.grumpy).length;
        if (grumpyCount / pop > 0.3) return; // too much unrest
        if (ledger.collectiveStress > 80) return; // too stressed

        const seasonMult = { spring: 2.0, summer: 1.2, autumn: 0.8, winter: 0.3 }[season] || 1.0;
        const birthChance = 0.15 * seasonMult * Math.max(0, 1 - ledger.collectiveStress / 150);

        if (Math.random() < birthChance) {
            this.addNewVillager(village, tome);
        }
    }

    addNewVillager(village, tome) {
        const { villagers } = tome;
        const newIdx = villagers.length;
        const seed = this.settlementGenerator.worldSeed + parseInt(village.id.split('_')[1]) * 500 + 1000 + newIdx;
        const rand = this.settlementGenerator.seededRandom(seed);

        const nameIdx = Math.floor(rand() * VILLAGER_FIRST_NAMES.length);
        const name = VILLAGER_FIRST_NAMES[nameIdx] + (newIdx >= VILLAGER_FIRST_NAMES.length ? ` ${newIdx}` : '');

        const roleDistribution = this.buildRoleDistribution(village.typeDef, villagers.length + 1);
        const role = this.pickRole(roleDistribution, rand);
        const roleDef = VILLAGER_ROLES[role];

        const villager = {
            id: `${village.id}_villager_${String(newIdx + 1).padStart(3, '0')}`,
            name,
            role,
            stress: 10 + rand() * 30,
            faith: role === 'priest' || role === 'monk' ? 20 + rand() * 30 : 5 + rand() * 15,
            grumpy: false,
            calledToService: false,
            activities: [
                {
                    slot: 0,
                    assigned: roleDef ? roleDef.morningTasks[0] : 'wander',
                    playerOverride: null
                },
                {
                    slot: 1,
                    assigned: roleDef ? roleDef.eveningTasks[0] : 'rest',
                    playerOverride: null
                }
            ],
            walkType: null,
            age: 0
        };

        villagers.push(villager);
        console.log(`[TomeManager] ${name} born in ${village.name} (pop ${villagers.length})`);
    }

    resolveBuildingExpansion(village) {
        if (!village.buildings) village.buildings = [];
        if (!village.nodes) village.nodes = [];
        const pop = village.population;
        const { ledger } = this.tomes.get(village.id) || {};
        const foodStock = ledger ? ledger.grainStock + ledger.fishStock : 0;
        const buildings = village.buildings;
        const hasHouse = buildings.some(b => b.type === 'house');
        const hasGreen = buildings.some(b => b.type === 'villageGreen') || village.nodes.some(n => n.type === 'villageGreen');
        const hasBarn = buildings.some(b => b.type === 'barn');
        const hasChurch = buildings.some(b => b.type === 'church');
        const hasFishingHut = buildings.some(b => b.type === 'fishingHut');
        const hasManor = buildings.some(b => b.type === 'manor');
        const houses = buildings.filter(b => b.type === 'house').length;
        const fields = buildings.filter(b => b.type === 'field').length;

        // 1. First house: always queue immediately if none
        if (!hasHouse && !this.isQueued(village, 'house')) {
            this.queueBuilding(village, 'house', 2, 7);
            return;
        }

        // 1.5. Village green: 1 month (30 days) after first house
        if (hasHouse && village.age >= 30 && !hasGreen && !this.isQueued(village, 'villageGreen')) {
            this.queueBuilding(village, 'villageGreen', 1, 14);
            return;
        }

        // Houses: pop > houses * 2.5
        if (houses > 0 && pop > houses * 2.5 && !this.isQueued(village, 'house')) {
            this.queueBuilding(village, 'house', 2, 7);
            return;
        }

        // 2. Barn: food storage maxed out (or first field exists and grain > 20)
        const grainCap = 20 + (hasBarn ? 30 : 0);
        if (hasHouse && fields >= 1 && !hasBarn && !this.isQueued(village, 'barn')) {
            if (ledger && ledger.grainStock >= grainCap) {
                this.queueBuilding(village, 'barn', pop, 2);
                return;
            }
        }

        // 6. Annual field
        if (hasHouse && (fields === 0 || (village.age % 360 < 7 && fields < Math.ceil(pop / 4))) && !this.isQueued(village, 'field')) {
            this.queueBuilding(village, 'field', 1, 10);
            return;
        }

        // 4. Church: pop >= 15
        if (pop >= 15 && !hasChurch && !this.isQueued(village, 'church')) {
            this.queueBuilding(village, 'church', pop, 370);
            return;
        }

        // 5. Fishing hut: low food + near beach
        const nearWater = this.settlementGenerator ?
            this.settlementGenerator.getBiomeAt(village.x + 10, village.z) === 'beach' ||
            this.settlementGenerator.getBiomeAt(village.x - 10, village.z) === 'beach' ||
            this.settlementGenerator.getBiomeAt(village.x, village.z + 10) === 'beach' ||
            this.settlementGenerator.getBiomeAt(village.x, village.z - 10) === 'beach'
            : false;
        if (foodStock < pop * 2 && nearWater && !hasFishingHut && !this.isQueued(village, 'fishingHut')) {
            this.queueBuilding(village, 'fishingHut', 1, 7);
            return;
        }

        // Manor: requires 2 fields + church + barn + houses
        if (fields >= 2 && hasChurch && hasBarn && houses >= 3 && !hasManor && !this.isQueued(village, 'manor')) {
            this.queueBuilding(village, 'manor', 5, 270);
            return;
        }

        // 6. Lamp posts: after manor
        const lampPosts = buildings.filter(b => b.type === 'lampPost').length;
        if (hasManor && lampPosts < 4 && !this.isQueued(village, 'lampPost')) {
            this.queueBuilding(village, 'lampPost', 1, 1);
            return;
        }
    }

    isQueued(village, type) {
        return village.constructionQueue && village.constructionQueue.some(q => q.type === type && q.state !== 'complete');
    }

    queueBuilding(village, type, workerCount, durationDays) {
        const site = this.settlementGenerator.findBuildingSite(village, type);
        if (!site) {
            console.log(`[TomeManager] Could not find site for ${type} in ${village.name}`);
            return;
        }

        const entry = {
            type,
            siteX: site.x,
            siteZ: site.z,
            siteY: site.y,
            workerCount,
            durationDays,
            elapsedDays: 0,
            startedAtDay: this.getCurrentGameDay(),
            state: 'under_construction'
        };

        if (!village.constructionQueue) village.constructionQueue = [];
        village.constructionQueue.push(entry);

        village.buildings.push({
            type,
            x: site.x,
            z: site.z,
            y: site.y,
            state: 'under_construction',
            startedAtDay: entry.startedAtDay
        });

        if (type === 'villageGreen') {
            village.nodes.push({
                type: 'villageGreen',
                x: site.x,
                z: site.z,
                y: site.y,
                label: 'Village Green'
            });
            village.greenBuilt = true;
        }
        if (type === 'house' && !village.firstHouseBuilt) {
            village.firstHouseBuilt = true;
        }

        console.log(`[TomeManager] Queued ${type} in ${village.name} at (${site.x.toFixed(1)}, ${site.z.toFixed(1)})`);

        if (this.gameState && this.gameState.io) {
            this.gameState.io.emit('buildingStarted', {
                villageId: village.id,
                building: {
                    type,
                    x: site.x,
                    z: site.z,
                    y: site.y,
                    startedAtDay: entry.startedAtDay
                }
            });
        }
    }

    advanceConstruction(village) {
        if (!village.constructionQueue) return;
        for (const job of village.constructionQueue) {
            if (job.state === 'under_construction') {
                job.elapsedDays++;
                if (job.elapsedDays >= job.durationDays) {
                    job.state = 'complete';
                    const b = village.buildings.find(b =>
                        b.type === job.type &&
                        Math.round(b.x) === Math.round(job.siteX) &&
                        Math.round(b.z) === Math.round(job.siteZ) &&
                        b.state === 'under_construction'
                    );
                    if (b) b.state = 'complete';
                    console.log(`[TomeManager] ${job.type} completed in ${village.name}`);
                }
            }
        }
    }

    pickWalkType() {
        const types = ['wander', 'hike', 'forest'];
        return types[Math.floor(Math.random() * types.length)];
    }

    getTomeDelta(villageId, lastVersion) {
        const tome = this.tomes.get(villageId);
        if (!tome) return null;

        return {
            villageId,
            version: this.tomeVersion,
            ledger: tome.ledger,
            villagers: tome.villagers.map(v => ({
                id: v.id,
                name: v.name,
                role: v.role,
                stress: v.stress,
                faith: v.faith,
                grumpy: v.grumpy,
                calledToService: v.calledToService,
                activities: v.activities,
                walkType: v.walkType,
                age: v.age
            }))
        };
    }

    getFullTomeState(villageIds) {
        const state = {};
        for (const id of villageIds) {
            const delta = this.getTomeDelta(id, -1);
            if (delta) state[id] = delta;
        }
        return state;
    }

    toJSON() {
        const data = {};
        for (const [id, tome] of this.tomes) {
            data[id] = {
                ledger: tome.ledger,
                villagers: tome.villagers
            };
        }
        return data;
    }
}

module.exports = SettlementTomeManager;
