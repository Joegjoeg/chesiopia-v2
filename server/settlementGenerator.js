// SettlementGenerator — Deterministic village placement using world seed + terrain checks
// Ported from client/settlementData.js, made deterministic for server-authoritative generation

const path = require('path');
const settlementData = require(path.join(__dirname, '..', 'client', 'settlementData'));

const {
    SETTLEMENT_TYPES, VILLAGER_ROLES, TASKS, NODE_TYPES, BUILDING_THRESHOLDS,
    SEASONS, evaluateTerrainSuitability, generateSettlementName, distance2D
} = settlementData;

class SettlementGenerator {
    constructor(terrainGenerator, worldSeed) {
        this.terrainGenerator = terrainGenerator;
        this.worldSeed = worldSeed;
        this.minSpacing = 200;
        this.maxSettlements = 10;
        this.searchRadius = 400;
        this.generatedVillages = [];
    }

    seededRandom(seed) {
        let s = seed;
        return () => {
            s = (s * 16807 + 0) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    generateAllVillages() {
        this.generatedVillages = [];
        const villages = [];

        for (let i = 0; i < this.maxSettlements; i++) {
            const villageSeed = this.worldSeed + i * 1000 + 42;
            const rand = this.seededRandom(villageSeed);

            const location = this.findSettlementLocation(rand, villages);
            if (!location) {
                console.log(`[SettlementGenerator] Could not place village ${i + 1}, stopping at ${villages.length}`);
                break;
            }

            const typeKey = rand() < SETTLEMENT_TYPES.hamlet.spawnWeight ? 'hamlet' : 'village';
            const typeDef = SETTLEMENT_TYPES[typeKey];
            const name = this.generateName(rand);

            const village = this.createVillageBlueprint(location.x, location.z, typeKey, typeDef, name, i + 1);
            villages.push(village);
        }

        this.generatedVillages = villages;
        console.log(`[SettlementGenerator] Generated ${villages.length} villages`);
        return villages;
    }

    findSettlementLocation(rand, existingVillages) {
        const attempts = 30;

        for (let i = 0; i < attempts; i++) {
            const angle = rand() * Math.PI * 2;
            const dist = this.minSpacing + rand() * (this.searchRadius - this.minSpacing);
            const cx = Math.cos(angle) * dist;
            const cz = Math.sin(angle) * dist;

            let tooClose = false;
            for (const v of existingVillages) {
                const dx = cx - v.x;
                const dz = cz - v.z;
                if (Math.sqrt(dx * dx + dz * dz) < this.minSpacing) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;

            const centerH = this.terrainGenerator.getHeight(cx, cz);
            if (centerH < -1.5) continue;

            const suitability = this.evaluateSuitability(cx, cz, 12);
            if (suitability > 0.5) {
                return { x: cx, z: cz, suitability };
            }
        }

        return null;
    }

    evaluateSuitability(x, z, radius) {
        if (!this.terrainGenerator) return 0;

        let score = 0;
        let samples = 0;
        const step = Math.max(1, Math.floor(radius / 4));

        for (let dx = -radius; dx <= radius; dx += step) {
            for (let dz = -radius; dz <= radius; dz += step) {
                const sx = x + dx;
                const sz = z + dz;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > radius) continue;

                const height = this.terrainGenerator.getHeight(sx, sz);
                const blocked = this.terrainGenerator.isTileBlocked ? this.terrainGenerator.isTileBlocked(sx, sz) : false;

                if (blocked) { score -= 3; samples++; continue; }

                const normal = this.terrainGenerator.getNormal ? this.terrainGenerator.getNormal(sx, sz) : null;
                const slope = normal ? Math.acos(Math.abs(normal.y)) * (180 / Math.PI) : 0;

                if (slope > 30) { score -= 2; samples++; continue; }
                if (slope > 15) { score += 0; samples++; continue; }

                if (height < -5) { score -= 3; samples++; continue; }
                if (height < -1.5) { score -= 2; samples++; continue; }

                const edgeBonus = (1 - dist / radius) * 2;
                score += 1 + edgeBonus;
                samples++;
            }
        }

        return samples > 0 ? score / samples : 0;
    }

    generateName(rand) {
        const prefixes = ['Ash', 'Oak', 'Elm', 'Willow', 'Thorn', 'Briar', 'Hazel', 'Rowan', 'Yew', 'Holly',
                          'Mill', 'Brook', 'Ford', 'Bridge', 'Gate', 'Cross', 'Stone', 'Well', 'Moor', 'Dean'];
        const suffixes = ['bury', 'ton', 'ham', 'wick', 'stead', 'ford', 'ley', 'field', 'combe', 'worth',
                          'thorpe', 'by', 'cott', 'dale', 'mere', 'wood', 'haven', 'bridge', 'gate', 'end'];
        return prefixes[Math.floor(rand() * prefixes.length)] +
               suffixes[Math.floor(rand() * suffixes.length)];
    }

    createVillageBlueprint(x, z, typeKey, typeDef, name, id) {
        const height = this.terrainGenerator.getHeight(x, z);

        const blueprint = {
            id: `settlement_${String(id).padStart(3, '0')}`,
            name,
            type: typeKey,
            typeDef,
            x, z,
            height,
            population: 2,
            maxPopulation: typeDef.maxPop,
            foodCapacity: 4,
            faithCapacity: 0,
            buildings: [],
            nodes: [],
            villagers: [],
            roads: [],
            knight: null,
            age: 0,
            state: 'founding',
            constructionQueue: [],
            completedBuildings: [],
            firstHouseBuilt: false,
            greenBuilt: false,
            _seedOffset: id * 1000 + 42
        };

        return blueprint;
    }

    initializeNodes(village) {
        const { x, z, height, typeDef } = village;
        const nodes = [];

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

        village.nodes = nodes;
    }

    placeInitialBuildings(village) {
        const buildings = [];
        const { x, z, height, typeDef, population } = village;

        const houseCount = Math.ceil(population / BUILDING_THRESHOLDS.housePerVillagers);
        for (let i = 0; i < houseCount; i++) {
            const bx = x + (i % 4) * 3 - 4;
            const bz = z + Math.floor(i / 4) * 3 + 4;
            buildings.push({
                type: 'house',
                x: bx,
                z: bz,
                y: this.terrainGenerator ? this.terrainGenerator.getHeight(bx, bz) : height
            });
        }

        const fieldCount = Math.ceil(population / BUILDING_THRESHOLDS.fieldPerVillagers);
        for (let i = 0; i < fieldCount; i++) {
            const bx = x + (i % 3) * 5 - 5;
            const bz = z - Math.floor(i / 3) * 5 - 8;
            buildings.push({
                type: 'field',
                x: bx,
                z: bz,
                y: this.terrainGenerator ? this.terrainGenerator.getHeight(bx, bz) : height
            });
        }

        if (typeDef.hasBarn && fieldCount >= BUILDING_THRESHOLDS.barnAfterFields) {
            const bx = x + 2;
            const bz = z - 4;
            buildings.push({ type: 'barn', x: bx, z: bz, y: this.terrainGenerator ? this.terrainGenerator.getHeight(bx, bz) : height });
        }

        if (typeDef.hasChurch) {
            const bx = x + 6;
            const bz = z - 2;
            buildings.push({ type: 'church', x: bx, z: bz, y: this.terrainGenerator ? this.terrainGenerator.getHeight(bx, bz) : height });
        }

        if (typeDef.hasManor && population >= BUILDING_THRESHOLDS.manorMinPopulation) {
            const bx = x - 8;
            const bz = z - 6;
            buildings.push({ type: 'manor', x: bx, z: bz, y: this.terrainGenerator ? this.terrainGenerator.getHeight(bx, bz) : height });
        }

        village.buildings = buildings;
    }

    getBiomeAt(x, z) {
        if (!this.terrainGenerator) return 'grassland';
        const h = this.terrainGenerator.getHeight(x, z);
        if (h < -1.5) return 'water';
        if (h < 2.0) return 'beach';
        if (h < 20.0) return 'grassland';
        return 'hill';
    }

    findBuildingSite(village, type) {
        const rand = this.seededRandom(village._seedOffset + type.length * 100 + village.buildings.length * 7);
        const center = { x: village.x, z: village.z };
        const existing = village.buildings;
        const existingNodes = village.nodes;

        const getRotatedOffset = (dist, angle) => ({
            x: Math.round(Math.cos(angle) * dist),
            z: Math.round(Math.sin(angle) * dist)
        });

        const tryPosition = (baseX, baseZ) => {
            const h = this.terrainGenerator.getHeight(baseX, baseZ);
            if (h < -1.5) return null;
            const normal = this.terrainGenerator.getNormal ? this.terrainGenerator.getNormal(baseX, baseZ) : null;
            if (normal) {
                const slope = Math.acos(Math.abs(normal.y)) * (180 / Math.PI);
                if (slope > 15) return null;
            }
            return { x: baseX, z: baseZ, y: h };
        };

        const houses = existing.filter(b => b.type === 'house');
        const firstHouse = houses[0];
        const greens = existingNodes.filter(n => n.type === 'villageGreen');
        const green = greens[0];
        const churches = existing.filter(b => b.type === 'church');
        const church = churches[0];
        const barns = existing.filter(b => b.type === 'barn');
        const barn = barns[0];

        switch (type) {
            case 'house': {
                if (!firstHouse) {
                    const angle = rand() * Math.PI * 2;
                    const dist = 3 + rand() * 4;
                    const off = getRotatedOffset(dist, angle);
                    return tryPosition(center.x + off.x, center.z + off.z);
                }
                const clusterAngle = rand() * Math.PI * 2;
                const clusterDist = 3 + rand() * 5;
                const off = getRotatedOffset(clusterDist, clusterAngle);
                return tryPosition(firstHouse.x + off.x, firstHouse.z + off.z);
            }
            case 'villageGreen': {
                if (!firstHouse) return null;
                const angle = rand() * Math.PI * 2;
                const dist = 4 + rand() * 3;
                const off = getRotatedOffset(dist, angle);
                return tryPosition(firstHouse.x + off.x, firstHouse.z + off.z);
            }
            case 'barn': {
                const ref = green || firstHouse || center;
                const angle = rand() * Math.PI * 2;
                const dist = 8 + rand() * 6;
                const off = getRotatedOffset(dist, angle);
                return tryPosition(ref.x + off.x, ref.z + off.z);
            }
            case 'church': {
                const ref = green || center;
                const angle = rand() * Math.PI * 2;
                const dist = 5 + rand() * 4;
                const off = getRotatedOffset(dist, angle);
                return tryPosition(ref.x + off.x, ref.z + off.z);
            }
            case 'fishingHut': {
                if (!green) return null;
                for (let attempt = 0; attempt < 20; attempt++) {
                    const angle = rand() * Math.PI * 2;
                    const dist = 6 + rand() * 12;
                    const off = getRotatedOffset(dist, angle);
                    const px = green.x + off.x;
                    const pz = green.z + off.z;
                    if (this.getBiomeAt(px, pz) === 'beach') {
                        return tryPosition(px, pz);
                    }
                }
                return null;
            }
            case 'field': {
                const ref = green || center;
                for (let attempt = 0; attempt < 20; attempt++) {
                    const angle = rand() * Math.PI * 2;
                    const dist = 6 + rand() * 10;
                    const off = getRotatedOffset(dist, angle);
                    const px = ref.x + off.x;
                    const pz = ref.z + off.z;
                    if (this.getBiomeAt(px, pz) === 'grassland') {
                        return tryPosition(px, pz);
                    }
                }
                return tryPosition(ref.x + 8, ref.z + 5);
            }
            case 'manor': {
                let best = null;
                let bestDist = -1;
                for (let attempt = 0; attempt < 30; attempt++) {
                    const angle = rand() * Math.PI * 2;
                    const dist = 12 + rand() * 10;
                    const off = getRotatedOffset(dist, angle);
                    const px = center.x + off.x;
                    const pz = center.z + off.z;
                    const pos = tryPosition(px, pz);
                    if (!pos) continue;
                    const minDist = existing.reduce((min, b) => {
                        const d = Math.sqrt((px - b.x) ** 2 + (pz - b.z) ** 2);
                        return Math.min(min, d);
                    }, Infinity);
                    if (minDist > bestDist) {
                        bestDist = minDist;
                        best = pos;
                    }
                }
                return best;
            }
            case 'lampPost': {
                const ref = existingNodes.find(n => n.type === 'road') || green || center;
                const angle = rand() * Math.PI * 2;
                const dist = 1 + rand() * 2;
                const off = getRotatedOffset(dist, angle);
                return tryPosition(ref.x + off.x, ref.z + off.z);
            }
            default: {
                const angle = rand() * Math.PI * 2;
                const dist = 5 + rand() * 5;
                const off = getRotatedOffset(dist, angle);
                return tryPosition(center.x + off.x, center.z + off.z);
            }
        }
    }

    getVillagesInRadius(cx, cz, radius) {
        return this.generatedVillages.filter(v => {
            const dx = v.x - cx;
            const dz = v.z - cz;
            return Math.sqrt(dx * dx + dz * dz) <= radius;
        });
    }

    getVillageById(id) {
        return this.generatedVillages.find(v => v.id === id);
    }

    toJSON() {
        return {
            villages: this.generatedVillages,
            config: {
                minSpacing: this.minSpacing,
                maxSettlements: this.maxSettlements,
                searchRadius: this.searchRadius
            }
        };
    }
}

module.exports = SettlementGenerator;
