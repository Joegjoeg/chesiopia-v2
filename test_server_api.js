const http = require('http');

console.log('[API Test] Testing server terrain API directly...');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/terrain/chunk/0/0',
    method: 'GET'
};

const req = http.request(options, (res) => {
    console.log(`[API Test] Status: ${res.statusCode}`);
    console.log(`[API Test] Headers:`, res.headers);
    
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        try {
            const jsonData = JSON.parse(data);
            console.log(`[API Test] Response length: ${jsonData.length} tiles`);
            
            // Check first tile for biome data
            if (jsonData.length > 0) {
                const firstTile = jsonData[0];
                console.log(`[API Test] First tile keys:`, Object.keys(firstTile));
                console.log(`[API Test] First tile biome:`, firstTile.biome);
                console.log(`[API Test] First tile type:`, firstTile.type);
                console.log(`[API Test] First tile height:`, firstTile.height);
            }
            
            // Check unique biomes
            const uniqueBiomes = [...new Set(jsonData.map(t => t.biome).filter(Boolean))];
            console.log(`[API Test] Unique biomes: ${uniqueBiomes.join(', ')}`);
            
            console.log('[API Test] ✅ API test completed successfully');
            
        } catch (error) {
            console.error('[API Test] ❌ JSON parse error:', error.message);
            console.log('[API Test] Raw response:', data.substring(0, 500));
        }
    });
});

req.on('error', (error) => {
    console.error('[API Test] ❌ Request error:', error.message);
});

req.end();
