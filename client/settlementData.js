// SettlementData — Core data structures, constants, and terrain suitability for the settlement simulation system

const SETTLEMENT_TYPES = {
    hamlet: {
        name: 'Hamlet',
        minPop: 5,
        maxPop: 15,
        buildings: ['houses', 'fields'],
        hasChurch: false,
        hasManor: false,
        hasGreen: false,
        hasMaypole: false,
        hasBarn: false,
        hasLampPosts: false,
        spawnWeight: 0.6
    },
    village: {
        name: 'Village',
        minPop: 15,
        maxPop: 80,
        buildings: ['houses', 'fields', 'church', 'manor', 'barn', 'villageGreen', 'maypole', 'lampPosts'],
        hasChurch: true,
        hasManor: true,
        hasGreen: true,
        hasMaypole: true,
        hasBarn: true,
        hasLampPosts: true,
        spawnWeight: 0.4
    }
};

const VILLAGER_ROLES = {
    farmer:      { label: 'Farmer',      morningTasks: ['harvest', 'tend fields'],     eveningTasks: ['rest', 'wander', 'attend church'],   icon: '🌾' },
    fisher:      { label: 'Fisher',      morningTasks: ['fish', 'mend nets'],          eveningTasks: ['rest', 'wander', 'celebrate'],       icon: '🎣' },
    priest:      { label: 'Priest',      morningTasks: ['pray', 'tend church'],        eveningTasks: ['attend church', 'rest'],              icon: '⛪' },
    mayor:       { label: 'Mayor',       morningTasks: ['survey', 'visit fields'],     eveningTasks: ['rest', 'wander'],                     icon: '🏛️' },
    townCrier:   { label: 'Town Crier',  morningTasks: ['proclaim', 'wander'],         eveningTasks: ['rest', 'celebrate'],                  icon: '📯' },
    child:       { label: 'Child',       morningTasks: ['play', 'wander'],             eveningTasks: ['rest', 'play'],                       icon: '🧒' },
    villager:    { label: 'Villager',    morningTasks: ['help build', 'wander'],       eveningTasks: ['rest', 'wander', 'celebrate'],        icon: '🧑' },
    knight:      { label: 'Knight',      morningTasks: ['patrol', 'train'],            eveningTasks: ['rest', 'socialize'],                  icon: '⚔️' },
    monk:        { label: 'Monk',        morningTasks: ['pray', 'tend church'],        eveningTasks: ['pray', 'rest'],                       icon: '🙏' }
};

const TASKS = {
    harvest:        { label: 'Harvest',        duration: 4, destinations: ['field', 'barn'] },
    fish:           { label: 'Fish',           duration: 4, destinations: ['fishingHut', 'waterEdge'] },
    attendChurch:   { label: 'Attend Church',  duration: 1, destinations: ['church'] },
    helpBuild:      { label: 'Help Build',     duration: 2, destinations: ['villageGreen', 'constructionSite'] },
    celebrate:      { label: 'Celebrate',      duration: 2, destinations: ['villageGreen', 'maypole'] },
    wander:         { label: 'Wander',         duration: 2, destinations: ['villageGreen', 'pond', 'road', 'scenicSpot'] },
    rest:           { label: 'Rest',           duration: 4, destinations: ['home'] },
    pray:           { label: 'Pray',           duration: 1, destinations: ['church'] },
    tendFields:     { label: 'Tend Fields',    duration: 3, destinations: ['field'] },
    proclaim:       { label: 'Proclaim',       duration: 1, destinations: ['villageGreen', 'proclamationSpot'] },
    play:           { label: 'Play',           duration: 2, destinations: ['villageGreen', 'pond', 'field'] },
    patrol:         { label: 'Patrol',         duration: 2, destinations: ['road', 'manor'] },
    train:          { label: 'Train',          duration: 2, destinations: ['manor'] },
    socialize:      { label: 'Socialize',      duration: 2, destinations: ['villageGreen', 'church', 'manor'] },
    survey:         { label: 'Survey',         duration: 1, destinations: ['field', 'road', 'villageGreen'] },
    mendNets:       { label: 'Mend Nets',      duration: 2, destinations: ['fishingHut', 'home'] },
    visitFields:    { label: 'Visit Fields',   duration: 1, destinations: ['field'] }
};

const NODE_TYPES = {
    home:            { label: 'Home',            weight: 3 },
    church:          { label: 'Church',          weight: 2 },
    field:           { label: 'Field',           weight: 2 },
    barn:            { label: 'Barn',            weight: 1 },
    fishingHut:      { label: 'Fishing Hut',     weight: 1 },
    villageGreen:    { label: 'Village Green',   weight: 3 },
    maypole:         { label: 'Maypole',         weight: 2 },
    pond:            { label: 'Pond',            weight: 2 },
    manor:           { label: 'Manor',           weight: 1 },
    proclamationSpot:{ label: 'Proclamation',    weight: 1 },
    road:            { label: 'Road',            weight: 2 },
    scenicSpot:      { label: 'Scenic Spot',     weight: 1 },
    waterEdge:       { label: 'Water Edge',      weight: 1 },
    constructionSite:{ label: 'Construction',    weight: 1 }
};

const BUILDING_THRESHOLDS = {
    housePerVillagers: 2.5,
    fieldPerVillagers: 4,
    barnAfterFields: 3,
    barnCapacity: 5,        // each barn covers up to 5 fields
    fishingHutRequiresWater: true,
    manorMinPopulation: 15
};

const ROAD_TYPES = {
    grass:      { label: 'Grass',       strength: 0,    color: 0x5a7d3a, width: 0.3 },
    dirtPath:   { label: 'Dirt Path',   strength: 30,   color: 0x8b7355, width: 0.5 },
    villageRoad:{ label: 'Village Road',strength: 80,   color: 0xa09080, width: 0.8 },
    arterialRoad:{ label: 'Arterial Road',strength: 150,color: 0xb0a090, width: 1.2 }
};

const SEASONS = {
    spring:    { label: 'Spring',    churchActivity: 0.7, fieldActivity: 0.8, maypoleActivity: 0.5, indoorBias: 0.3, eveningActivity: 0.6 },
    summer:    { label: 'Summer',    churchActivity: 0.5, fieldActivity: 1.0, maypoleActivity: 1.0, indoorBias: 0.1, eveningActivity: 0.9 },
    autumn:    { label: 'Autumn',    churchActivity: 0.6, fieldActivity: 1.2, maypoleActivity: 0.6, indoorBias: 0.3, eveningActivity: 0.5 },
    winter:    { label: 'Winter',    churchActivity: 0.9, fieldActivity: 0.2, maypoleActivity: 0.1, indoorBias: 0.8, eveningActivity: 0.3 }
};

const TIME_SLOTS = {
    morning:  { startHour: 6,  endHour: 12, label: 'Morning' },
    midday:   { startHour: 12, endHour: 16, label: 'Midday' },
    evening:  { startHour: 16, endHour: 22, label: 'Evening' },
    night:    { startHour: 22, endHour: 6,  label: 'Night' }
};

function getCurrentTimeSlot(hour) {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 16) return 'midday';
    if (hour >= 16 && hour < 22) return 'evening';
    return 'night';
}

function getCurrentSeason(dayOfYear) {
    const seasonDay = ((dayOfYear % 360) + 360) % 360;
    if (seasonDay < 90) return 'spring';
    if (seasonDay < 180) return 'summer';
    if (seasonDay < 270) return 'autumn';
    return 'winter';
}

function evaluateTerrainSuitability(terrainSystem, x, z, radius) {
    if (!terrainSystem) return 0;

    let score = 0;
    let samples = 0;
    const step = Math.max(1, Math.floor(radius / 4));

    for (let dx = -radius; dx <= radius; dx += step) {
        for (let dz = -radius; dz <= radius; dz += step) {
            const sx = x + dx;
            const sz = z + dz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > radius) continue;

            const height = terrainSystem.getHeight(sx, sz);
            const blocked = terrainSystem.isTileBlocked ? terrainSystem.isTileBlocked(sx, sz) : false;

            if (blocked) { score -= 3; samples++; continue; }

            const normal = terrainSystem.getNormal ? terrainSystem.getNormal(sx, sz) : null;
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

function findSettlementLocation(terrainSystem, minSpacing, existingSettlements, searchRadius, attempts) {
    if (!terrainSystem) return null;

    for (let i = 0; i < attempts; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = minSpacing + Math.random() * (searchRadius - minSpacing);
        const cx = Math.cos(angle) * dist;
        const cz = Math.sin(angle) * dist;

        let tooClose = false;
        if (existingSettlements) {
            for (const s of existingSettlements) {
                const dx = cx - s.x;
                const dz = cz - s.z;
                if (Math.sqrt(dx * dx + dz * dz) < minSpacing) {
                    tooClose = true;
                    break;
                }
            }
        }
        if (tooClose) continue;

        const centerH = terrainSystem.getHeight(cx, cz);
        if (centerH < -1.5) continue;

        const suitability = evaluateTerrainSuitability(terrainSystem, cx, cz, 12);
        if (suitability > 0.5) {
            return { x: cx, z: cz, suitability };
        }
    }

    return null;
}

function generateSettlementName() {
    const prefixes = ['Ash', 'Oak', 'Elm', 'Willow', 'Thorn', 'Briar', 'Hazel', 'Rowan', 'Yew', 'Holly',
                      'Mill', 'Brook', 'Ford', 'Bridge', 'Gate', 'Cross', 'Stone', 'Well', 'Moor', 'Dean'];
    const suffixes = ['bury', 'ton', 'ham', 'wick', 'stead', 'ford', 'ley', 'field', 'combe', 'worth',
                      'thorpe', 'by', 'cott', 'dale', 'mere', 'wood', 'haven', 'bridge', 'gate', 'end'];
    return prefixes[Math.floor(Math.random() * prefixes.length)] +
           suffixes[Math.floor(Math.random() * suffixes.length)];
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function distance2D(a, b) {
    const dx = a.x - b.x;
    const dz = (a.z !== undefined ? a.z : 0) - (b.z !== undefined ? b.z : 0);
    return Math.sqrt(dx * dx + dz * dz);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SETTLEMENT_TYPES, VILLAGER_ROLES, TASKS, NODE_TYPES, BUILDING_THRESHOLDS,
        ROAD_TYPES, SEASONS, TIME_SLOTS,
        getCurrentTimeSlot, getCurrentSeason, evaluateTerrainSuitability,
        findSettlementLocation, generateSettlementName, clamp, lerp, distance2D
    };
}
