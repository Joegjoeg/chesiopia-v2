const fs = require('fs');
const crypto = require('crypto');

// Read current world data
console.log('Reading world-data.json...');
const worldData = JSON.parse(fs.readFileSync('world-data.json', 'utf8'));

// Extract unique colors to build palette
console.log('Building color palette...');
const colorMap = new Map();
const palette = [];
let colorIndex = 0;

function getColorIndex(color) {
  const key = `${color.r},${color.g},${color.b}`;
  if (!colorMap.has(key)) {
    colorMap.set(key, colorIndex);
    palette.push(color);
    colorIndex++;
  }
  return colorMap.get(key);
}

// Convert terrain type to integer code
function getTerrainTypeCode(isBlocked) {
  // For now, just convert boolean to 0/1
  // Future: expand for town, river, tree types, etc.
  return isBlocked ? 1 : 0;
}

// Generate checksum for a chunk
function generateChecksum(data) {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').substring(0, 8);
}

// Convert chunks to new format
console.log('Converting chunks to new format...');
const newChunks = {};

for (const [chunkKey, tiles] of Object.entries(worldData.worldData.chunks)) {
  const newTiles = [];
  
  // Sort tiles by position to ensure correct indexing
  tiles.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.x - b.x;
  });
  
  // Convert each tile
  for (const tile of tiles) {
    const height = parseFloat(tile.height.toFixed(2)); // 2 decimal places
    const terrainType = getTerrainTypeCode(tile.isBlocked);
    const colorIdx = getColorIndex(tile.color);
    
    newTiles.push([height, terrainType, colorIdx]);
  }
  
  // Generate checksum
  const checksum = generateChecksum(newTiles);
  
  newChunks[chunkKey] = {
    checksum: checksum,
    tiles: newTiles
  };
}

// Build terrain type descriptions
const terrainTypes = {
  "0": "empty",
  "1": "blocked",
  "2": "town",
  "3": "river",
  "10": "tree1",
  "11": "tree2"
};

// Create new world data structure
const newWorldData = {
  version: 2,
  seed: worldData.seed,
  palette: palette,
  terrainTypes: terrainTypes,
  chunks: newChunks
};

// Write new world data
console.log('Writing world-data-v2.json...');
fs.writeFileSync('world-data-v2.json', JSON.stringify(newWorldData, null, 2));

// Calculate size reduction
const oldSize = fs.statSync('world-data.json').size;
const newSize = fs.statSync('world-data-v2.json').size;
const reduction = ((oldSize - newSize) / oldSize * 100).toFixed(2);

console.log('\n=== Conversion Complete ===');
console.log(`Original size: ${(oldSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`New size: ${(newSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Reduction: ${reduction}%`);
console.log(`Unique colors: ${palette.length}`);
console.log(`Total chunks: ${Object.keys(newChunks).length}`);
console.log('\nOutput: world-data-v2.json');
