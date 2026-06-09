# Terrain Visual System Spec

## 1. Material Architecture

- **Inner terrain mesh** (`rollingTerrain.mesh.material`): clone of `TextureBlendingSystem.shaderMaterial`, `uFadeEnabled = 0`
- **Outer ring mesh** (`terrainOuterRing.material`): clone of inner terrain material, `uFadeEnabled = 0` (fade disabled — ring vertices lie beyond the inner fade radius so fade must be off)
- **Clipmap meshes** (legacy): reuse `TextureBlendingSystem.shaderMaterial` directly
- **All terrain meshes** must have uniforms: `uDebugView`, `uBiomeTextureBlend`, `uBiomeTexLayer0`, `uBiomeTexLayer1`, `uBiomeTexScale0`, `uBiomeTexScale1`, `uCheckerboardEnabled`

## 2. Debug View Modes

| Mode | `setBiomeDebugView(n)` | Expected Visual |
|------|------------------------|-----------------|
| 0 | Normal | Procedural biome color blended with PBR textures (default) |
| 1 | Dominant biome | Each pixel colored by whichever biome has highest weight (palette-coded) |
| 2 | Layer 0 only | Shows only base `uBiomeTexLayer0` array, blended by biome weights |
| 3 | Layer 1 only | Shows only overlay `uBiomeTexLayer1` array, blended by biome weights |

**Uniform propagation rule**: calling `setBiomeDebugView(n)` must update `uDebugView` on `shaderMaterial`, `rollingTerrain.mesh.material`, and `terrainOuterRing.material` simultaneously.

## 3. Biome Texture Arrays

- `DataArrayTexture` layer0 and layer1 must be created with `depth > 0`
- Individual albedo textures must be loaded and pushed into `_biomeTexLayerData` before `_rebuildDataArrayTexture()` runs
- `_rebuildDataArrayTexture()` must be triggered by `TextureSetLoader` `onLoad` callback

## 4. Outer Ring Visibility

- Should be created on medium+ tier devices (`tier !== 'low'`, `qualityLevel > 0`)
- Meshes must be added to `game.scene`
- Material must respond to `uDebugView` (uses same fragment shader)
- If outer ring is missing, check `_shouldEnableTerrainOuterRing()` and `deviceCapabilities.tier`

## 5. Rapid Prototype Workflow

```
1. Make shader change in textureBlendingSystem.js
2. Refresh browser
3. Run in console:  runChessopiaTests()
4. Check TERRAIN_SHADER, DEBUG_VIEW, BIOME_TEX, OUTER_RING categories
5. If DEBUG_VIEW fails, uniform is not synced to all materials
6. If BIOME_TEX fails, DataArrayTexture is empty — check onLoad callbacks
7. If OUTER_RING fails, check tier/quality gating
```
