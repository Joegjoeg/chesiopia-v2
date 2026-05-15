const TerrainGenerator = require('./terrain.js');

console.log('[Test] Testing terrain generator directly...');

try {
    const terrain = new TerrainGenerator();
    console.log('[Test] Terrain generator created successfully');
    
    // Test getBiomeType method
    const testHeights = [-5, -2, -1, 1, 5, 15, 20, 30];
    console.log('[Test] Testing biome classification:');
    testHeights.forEach(height => {
        const biome = terrain.getBiomeType(height);
        console.log(`  Height ${height}: ${biome}`);
    });
    
    // Test getChunkData method
    console.log('[Test] Testing chunk data generation...');
    const chunkData = terrain.getChunkData(0, 0, 16);
    console.log(`[Test] Generated chunk with ${chunkData.length} tiles`);
    
    // Check first few tiles for biome data
    console.log('[Test] First 5 tiles:');
    chunkData.slice(0, 5).forEach((tile, index) => {
        console.log(`  Tile ${index}: height=${tile.height}, biome=${tile.biome}, type=${tile.type}`);
    });
    
    // Check if biome data exists
    const hasBiomeData = chunkData.some(tile => tile.biome && tile.type);
    console.log(`[Test] Has biome data: ${hasBiomeData}`);
    
    const uniqueBiomes = [...new Set(chunkData.map(t => t.biome).filter(Boolean))];
    console.log(`[Test] Unique biomes: ${uniqueBiomes.join(', ')}`);
    
    console.log('[Test] ✅ Terrain generator test completed successfully');
    
} catch (error) {
    console.error('[Test] ❌ Error testing terrain generator:', error.message);
    console.error(error.stack);
}
