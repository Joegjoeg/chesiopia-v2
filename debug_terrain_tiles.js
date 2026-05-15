const { chromium } = require('playwright');

async function debugTerrainTiles() {
    console.log('[Terrain Debug] Investigating server tile types and textures...');
    
    const browser = await chromium.launch({
        headless: false,
        args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1
        });
        
        const page = await context.newPage();
        
        console.log('[Terrain Debug] Navigating to http://localhost:3000...');
        await page.goto('http://localhost:3000', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        await page.waitForTimeout(5000);
        
        // Check 1: Server tile data structure
        const tileDataCheck = await page.evaluate(() => {
            if (!window.terrainSystem) return { error: 'Terrain system not found' };
            
            // Get some sample tiles from different areas
            const samplePositions = [
                { x: 0, z: 0, name: 'center' },
                { x: 10, z: 10, name: 'positive' },
                { x: -10, z: -10, name: 'negative' },
                { x: 20, z: 0, name: 'east' },
                { x: 0, z: 20, name: 'north' }
            ];
            
            const tileSamples = samplePositions.map(pos => {
                const tileData = window.terrainSystem.getTileData(pos.x, pos.z);
                const height = window.terrainSystem.getHeight(pos.x, pos.z);
                const isBlocked = window.terrainSystem.isTileBlocked(pos.x, pos.z);
                
                return {
                    position: pos,
                    height: height,
                    isBlocked: isBlocked,
                    tileData: tileData ? {
                        hasData: true,
                        keys: Object.keys(tileData),
                        type: tileData.type,
                        biome: tileData.biome,
                        elevation: tileData.elevation,
                        moisture: tileData.moisture,
                        temperature: tileData.temperature
                    } : { hasData: false }
                };
            });
            
            return {
                tileSamples: tileSamples,
                chunksLoaded: window.terrainSystem.chunks.size,
                worldDownloaded: window.terrainSystem.worldDownloaded
            };
        });
        
        console.log('[Terrain Debug] Tile data analysis:', tileDataCheck);
        
        // Check 2: Direct server API call
        const serverTileCheck = await page.evaluate(async () => {
            try {
                // Test server API for chunk data
                const response = await fetch('/api/terrain/chunk/0/0');
                if (response.ok) {
                    const chunkData = await response.json();
                    
                    // Analyze first few tiles
                    const tileAnalysis = chunkData.slice(0, 10).map((tile, index) => ({
                        index: index,
                        hasType: !!tile.type,
                        hasBiome: !!tile.biome,
                        hasElevation: tile.elevation !== undefined,
                        hasMoisture: tile.moisture !== undefined,
                        type: tile.type,
                        biome: tile.biome,
                        elevation: tile.elevation,
                        height: tile.height,
                        allKeys: Object.keys(tile)
                    }));
                    
                    return {
                        success: true,
                        chunkSize: chunkData.length,
                        tileAnalysis: tileAnalysis,
                        uniqueTypes: [...new Set(chunkData.map(t => t.type).filter(Boolean))],
                        uniqueBiomes: [...new Set(chunkData.map(t => t.biome).filter(Boolean))]
                    };
                } else {
                    return { success: false, error: `HTTP ${response.status}` };
                }
            } catch (error) {
                return { success: false, error: error.message };
            }
        });
        
        console.log('[Terrain Debug] Server tile analysis:', serverTileCheck);
        
        // Check 3: Texture blending system usage
        const textureCheck = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            return {
                textureBlendingSystem: !!window.boardSystem.textureBlendingSystem,
                textureBlendingEnabled: !window.boardSystem.textureBlendingDisabled,
                boardMaterials: window.boardSystem.lightTileColor ? {
                    lightTileColor: {
                        r: window.boardSystem.lightTileColor.r,
                        g: window.boardSystem.lightTileColor.g,
                        b: window.boardSystem.lightTileColor.b
                    },
                    darkTileColor: {
                        r: window.boardSystem.darkTileColor.r,
                        g: window.boardSystem.darkTileColor.g,
                        b: window.boardSystem.darkTileColor.b
                    }
                } : null,
                groundMeshes: []
            };
        });
        
        console.log('[Terrain Debug] Texture system check:', textureCheck);
        
        // Check 4: What's actually being rendered on the ground
        const renderCheck = await page.evaluate(() => {
            if (!window.boardSystem) return { error: 'Board system not found' };
            
            const scene = window.boardSystem.scene;
            const groundMeshes = [];
            
            scene.traverse((child) => {
                if (child.isMesh && (
                    child.name?.includes('board') || 
                    child.name?.includes('ground') ||
                    child.name?.includes('terrain') ||
                    child.geometry?.attributes?.position
                )) {
                    groundMeshes.push({
                        name: child.name,
                        materialType: child.material?.type,
                        hasTexture: !!child.material?.map,
                        vertexColors: child.material?.vertexColors,
                        materialColor: child.material?.color ? {
                            r: child.material.color.r,
                            g: child.material.color.g,
                            b: child.material.color.b
                        } : null,
                        geometryType: child.geometry?.type,
                        vertexCount: child.geometry?.attributes?.position?.count
                    });
                }
            });
            
            return {
                groundMeshCount: groundMeshes.length,
                groundMeshes: groundMeshes.slice(0, 5),
                hasVertexColors: groundMeshes.some(m => m.vertexColors),
                hasTextures: groundMeshes.some(m => m.hasTexture)
            };
        });
        
        console.log('[Terrain Debug] Ground rendering analysis:', renderCheck);
        
        // Check 5: Texture blending system methods
        const blendingMethodsCheck = await page.evaluate(() => {
            if (!window.boardSystem?.textureBlendingSystem) return { error: 'Texture blending system not found' };
            
            const blendingSystem = window.boardSystem.textureBlendingSystem;
            
            return {
                methods: Object.getOwnPropertyNames(blendingSystem).filter(name => 
                    typeof blendingSystem[name] === 'function'
                ),
                hasGetStableGrassColor: typeof blendingSystem.getStableGrassColor === 'function',
                grassColors: blendingSystem.grassColors ? blendingSystem.grassColors.map(c => ({
                    r: c.r, g: c.g, b: c.b
                })) : null,
                startDistance: blendingSystem.startDistance,
                endDistance: blendingSystem.endDistance
            };
        });
        
        console.log('[Terrain Debug] Texture blending methods:', blendingMethodsCheck);
        
        await page.waitForTimeout(2000);
        
    } catch (error) {
        console.error('[Terrain Debug] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[Terrain Debug] Browser closed.');
    }
}

debugTerrainTiles().catch(err => {
    console.error(err);
    process.exit(1);
});
