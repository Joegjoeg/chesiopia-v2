# Chessopia — Detailed Feature Archive
## Granular Inventory of Every System, Mechanic, and Technique Built

*This document maps the actual code — not just commit messages — file by file, system by system.*

---

## Executive Summary

Chessopia is a multiplayer, browser-based 3D chess game built on Three.js and Node.js. It features an infinite procedural terrain world with 8 biomes, real-time day/night cycles, server-authoritative game state, and a comprehensive settlement simulation with procedurally generated villages, villagers, and knights.

**Key architectural decisions:**
- **Single unified mesh board**: One draw call for the entire visible world instead of thousands of per-tile meshes.
- **Chunk-streamed infinite terrain**: 16×16 tiles loaded on-demand with 5-tier LOD and cone culling.
- **Gated parameter system**: 100+ runtime-tweakable values with monkey-patched Three.js objects to prevent game logic from overwriting user overrides.
- **Server-authoritative everything**: Time, moves, settlements, and environmental simulation all run server-side with client prediction.

**Major systems:** multiplayer networking (Socket.IO), JWT auth with dev gating, environmental agent simulation (pressure/moisture/temperature), 10+ tree rendering iterations culminating in a hybrid approach, advanced terrain shader with 60+ uniforms (biome blending, cliffs, beaches, forest floors, per-biome grass types), 4-mode camera with spherical orbit, 28-category dev interface, memory profiler, temporal anti-aliasing, procedural audio synthesis, and a Jesus summon mini-game with terrain deformation.

---

## 1. SERVER & BACKEND ARCHITECTURE

### Core Server (`server.js`)
- **Express + Socket.IO** multiplayer backbone with CORS (`origin: "*"`)
- **Server-authoritative game time**: epoch-based day/night cycle mapping real-world time to in-game calendar (120-day years, configurable day length)
- **Error forwarding interceptor**: overrides `console.error`, catches `uncaughtException` and `unhandledRejection`, broadcasts to all connected clients via `server-error` socket event
- **Static file serving** with manual MIME type assignment and `Cache-Control: no-cache`
- **Shared module routes**: exposes `moveValidator.js` and `gameState.js` to client for validation parity
- **Terrain chunk API**: `/terrain/chunk/:x/:z` with server-side terrain cache (`terrainCache` Map)
- **World data persistence**: `world-data-v2.json` with lazy initialization

### Authentication (`auth.js`, `authApi.js`, `authOverlay.js`, `authState.js`)
- **JWT-based auth**: register, login, email verification, token refresh
- **Email service**: verification codes via SMTP (`emailService.js`)
- **Dev role gating**: `authState.isDev()` restricts dev tools, mobile dev button, and advanced panels
- **Account badge UI**: fixed-position badge showing auth state, clickable to reopen overlay
- **Persistent sessions**: token stored in `localStorage`, validated on reload

### Game State (`gameState.js`)
- Authoritative server state with **change callbacks** broadcasting `gameReset`, `playerAdded`, `pieceMoved`, `piecePurchased`, `coveringSet`
- **Piece ID tracking**: server assigns unique IDs, broadcasts `pieceAdded` for each new piece

### Environmental Simulation (`environmentalSimulation.js`)
- **Seeded RNG**: `SeededRandom` class with LCG (`16807` multiplier)
- **Pressure & moisture agents**: 30 wandering agents that deposit/absorb pressure, humidity, temperature across a grid
- **Agent behavior**: gradient-seeking movement (75% follow gradient, 25% random), cross-coupling (humidity → pressure), storm behavior at instability > 0.8
- **Chunk signatures**: per-chunk uplift, heat absorption, moisture generation influencing agent state
- **Tick interval**: 2-second simulation ticks

### Settlement Systems (`server/settlementGenerator.js`, `server/settlementTomeManager.js`)
- **Procedural village generation**: 6 settlement types (hamlet, village, town, port, abbey, castle) with type-specific buildings
- **Settlement naming**: `generateSettlementName()` with thematic pools
- **Tome Manager**: per-village ledger (grain, fish, faith, stress, festivals) and villager roster
- **Villager generation**: 46 first names, role distribution (knight, mayor, priest, farmer, fisher, child, monk, town crier)
- **Daily resolution**: 03:00 in-game time resolves all villager activities, applies season modifiers
- **Mutation queue**: player overrides to villager schedules queued and resolved on next tick
- **Knight ownership**: villages can be owned by knight IDs
- **Tournament system**: knights participate in tournaments with results affecting village loyalty

---

## 2. CHESS GAME MECHANICS

### Board System (`board_clean.js` — ~5,000 lines)
- **Unified single-mesh board**: one `THREE.Mesh` with `vertexColors` for the entire visible world, eliminating per-tile draw calls (~90% reduction)
- **Virtual tile abstraction**: game logic operates on logical tile cache without per-tile rendering
- **Conforming vertices**: board vertices snap to terrain heights via `getUnifiedTerrainHeight()`, corner height caching prevents gaps
- **Chunk-based streaming**: 16×16 tile chunks loaded/unloaded based on camera position with 140° cone culling
- **5-tier LOD system**:
  - High (1×1 tiles, <15 units)
  - Medium (2×2 tiles, <30 units)
  - Low (4×4 tiles, <45 units)
  - Very Low (8×8 tiles, <60 units)
  - Horizon (16×16 tiles, <120 units)
- **Hysteresis buffers**: upgradeBuffer 2 units, downgradeBuffer 0 to prevent flickering
- **Adaptive mesh optimization**: vertex aggregation at distance with smoothing, up to 80% reduction
- **Circular terrain mask**: radial gradient alpha map to hide square chunk corners
- **Server height cache**: 1000-entry LRU for per-tile server requests with 6-concurrency limit
- **Rolling terrain refresh**: batched chunk-loaded callbacks with `requestAnimationFrame` throttling

### Movement Bridge (`movementBridge.js`)
- **2D→3D translation layer**: `getValidMovesForPiece()` with 5-second cache timeout
- **Move caching**: `Map` keyed by `piece.id_x_z_lastMoveTime`
- **Pattern-based validation**: Pawn (1 straight, diagonal capture), Knight (L-jump), Bishop (diag 8), Rook (ortho 8), Queen (8 any), King (1 any)
- **Terrain slope blocking**: >45° inclines reject moves

### Covering System (`coveringSystem.js`)
- **Line-of-sight coverage**: piece A covers piece B; attackers must break LOS or capture A
- **Visual feedback**: magenta emissive overlay on covered pieces
- **Server reconciliation**: covering relationships tracked server-side, broadcast via `coveringSet`

### Shop & Points (`game.js`)
- **Capture scoring**: piece values (Pawn 1, Knight 3, Bishop 3, Rook 5, Queen 9)
- **Shop pricing**: 2× piece value (Pawn 2, Knight 6, Bishop 6, Rook 10, Queen 18)
- **Purchase flow**: spawn adjacent to king, max 20 pieces, 5-second cooldown

### Pieces 3D (`pieces3d.js`)
- **Hierarchical construction**: base → body → head using Three.js primitives
- **Material sharing**: shared materials with per-instance emissive overrides for selection/coverage
- **Placement at terrain height**: `getTerrainHeight()` + offset prevents clipping
- **Movement animation**: eased interpolation with cooldown integration

---

## 3. TERRAIN & WORLD GENERATION

### Procedural Terrain (`terrain.js`, `RollingTerrainMesh.js`)
- **Multi-octave noise**: Perlin/simplex-based rolling hills
- **8 biomes**: Deep Water, Shallow Water, Beach, Lowland, Grassland, Forest, Mountain, Snow
- **Height-based biome thresholds**: configurable 7 thresholds separating biomes
- **Chunk streaming**: on-demand generation, warm cache, preload distance 2 chunks
- **Probe system**: foreknowledge of distant terrain with 2-second throttle
- **Biome patch noise**: fbm-based variation at configurable scale/strength/seed
- **Biome edge blending**: 3 modes — smooth (all), hard (selected pair), splatter (noise+stain mix)
- **Per-pair edge settings**: localStorage-persisted snapshots for each biome boundary

### Spherical Deformation (`textureBlendingSystem.js`, `planetMapping.js`)
- **Planet mapping**: terrain sits on a sphere surface as camera ascends
- **Deform factor**: smoothstep transition from flat → spherical based on camera height
- **World-centered sphere**: sphere center tracks camera horizontally, sits below terrain vertically
- **Arc-angle mapping**: flat XZ mapped to sphere surface via sin/cos of arc angle
- **Curvature scale**: amplifies spherical drop for tighter/higher planets
- **Debug force mode**: bypasses height check for full spherical preview

---

## 4. RENDERING & SHADER SYSTEMS

### Texture Blending System (`textureBlendingSystem.js` — ~1,700 lines)
The largest single shader pipeline in the project:

**Vertex Shader Features:**
- Biome color computation with 8-biome weighted mixing
- Biome edge mode: smooth (all), hard (selected pair), splatter (fbm+stain)
- Spherical deformation with world-centered sphere math
- Forest mask UV generation from world position
- Fog vertex include

**Fragment Shader Features:**
- **Cursor-based fade**: checkerboard fades to biome grass based on cursor world distance
- **Adjustable fade radii**: inner/outer radius with smoothstep
- **Checkerboard pattern**: procedural UV-scaled checker with configurable strength
- **Per-biome grass types** (recent addition): 6 profiles (None, Meadow, Prairie, Alpine, Marsh, Dry Steppe) mapped across 5 active biomes
  - `grassPalette()`: baseColor, highlightColor, patchContrast per type
  - `accumulateGrassLayer()`: fbm patch noise, variant mixing, tint/light blending, weighted accumulation
- **Grass detail system**: anisotropic fbm (stretched UVs for blade streaks), sharpening via smoothstep range narrowing, micro-noise overlay
- **Beach system**: sand/stone/wet color mixing, stone scatter, wet shoreline band, shrub patches, biome bias, height blend
- **Forest floor**: forest mask texture sampling, noise-based variation, biome-weighted blend max
- **Cliff system**: slope threshold (dot product), transition band, rubble noise, horizontal strata banding, vertical face darkening, moss overlay
- **Water grid sparkle**: grid-based micro-glitter on water surface
- **Environmental uniforms**: pressure, humidity, temperature passed to shader (from env sim)
- **Sun intensity multiplier**: applied to final color
- **Terrain opacity**: global alpha override

**Uniforms (>60 total):**
- Cursor pos, fade distances, water levels, grass UV/wind/tint/light/blend/sharpness/speed/phase/stretch/micro/type[8]
- Forest mask texture, forest floor texture, forest blend params
- Beach colors, stone amount/scale, wet width/intensity, fade speed/delay, shrub amount/color/bias/height blend
- Cliff enable/threshold/blend/rubble/strata scale+amount/darken + 3 colors
- Biome colors[8], thresholds[7], edge mode/scale/strength/splatter scale+amount+mix, patch scale+strength+seed
- Spherical: radius, camera height, deform start/end, enable, debug force, curvature scale, camera world pos, planet center
- Environmental: pressure, humidity, temperature

### Cel Shading (`celShader.js`, `celShaderSimple.js`)
- **Custom toon shader**: discrete light bands, edge darkening
- **Simple variant**: stripped-down version for performance
- **Toggle at runtime**: dev interface button switches pipeline

### Temporal Anti-Aliasing (`temporalAASystem.js`)
- **Jitter-based subpixel sampling**: camera jitter per frame, history buffer blending
- **WebGL2 required**: feature-gated by device capability detection
- **Auto-enable**: high-tier devices get TAA by default
- **Dev interface panel**: status polling, enable/disable toggle

### Sky & Atmosphere
- **Sky Shader System** (`skyShaderSystem.js`): procedural starfield on sphere geometry (radius 2000)
  - Atmospheric gradient → starfield fade based on camera height
  - 1000 stars with twinkle animation
  - Sun elevation-driven sky color
- **Zodiac Constellation System** (`zodiacConstellationSystem.js`): 12 persistent constellations
  - Per-session seeded random star placement
  - Glowing spline connections between stars
  - Fade in/out based on altitude (60→120 units)
  - Canvas-generated glow textures

### Water Reflections (`waterReflectionManager.js`)
- **Mirror camera technique**: `THREE.WebGLRenderTarget` with reflected view matrix
- **Clip plane**: water-level clipping for correct reflection
- **Distance/height culling**: max distance 48, max height 32
- **Render target**: 512×512 with depth buffer
- **Skip reasons logged**: performance-aware conditional updates

### Shadow System (`shadowSystem.js`)
- **Baked shadow system**: precomputed/reused shadow configurations
- **Sun + moon both cast shadows**: directional lights with 1024×1024 shadow maps
- **Fixed quality**: medium tier locked to prevent shadow map corruption on resize
- **PCF soft shadows**: `THREE.PCFSoftShadowMap`
- **Large shadow camera**: 400-unit ortho box for sun/moon

---

## 5. VEGETATION & ENVIRONMENTAL DETAIL

### Tree Systems (10+ iterations)
**Current: Hybrid Tree Manager** (`hybridTreeManager.js`)
- Patch-based alternation between `TerrainTreeSystem` (geometry-integrated) and `LocalTreeSystem` (instanced)
- Billboard fallback for distant trees
- `treeTypeOverride`: dev-controlled override ('none', 'local', 'billboard', etc.)
- Chunk load/unload integration

**Local Tree System** (`localTreeSystem.js` — ~1,500 lines)
- **Nintendo-style procedural trees**: triangular-prism trunk + low-poly sphere foliage (6×4 segments = 48 tris/ball)
- **Canopy structure**: 1 center ball + 1 top ball + 6 ring balls with randomized positions/rotations
- **Foliage shader material**:
  - Leaf texture sampling (procedural canvas with scattered dots)
  - Directional + ambient lighting
  - Fresnel edge falloff for puffball softness (`edgeSoftness`, `edgeStrength`)
  - Fog integration (vertex + fragment includes)
- **Depth pre-pass**: colorWrite=false depth-only mesh child to prevent transparent sorting artifacts
- **Seasonal textures**: 9 annual stages from winter dormancy → buds → bloom → growth → full → summer → early autumn → peak autumn → late autumn
  - Density variation (0.3× winter → 1.0× full)
  - Blossom rendering during spring (pink/white)
  - Leaf color transitions (gray → light green → forest green → yellow-green → orange → brown)
- **3 LOD texture densities**: high (6000 dots), medium (3000), low (1500)
- **Wind animation**: vertex-position manipulation on trunk and foliage balls
- **Tree pool**: 100-max mesh reuse system

**Legacy Systems:**
- `treeSystem.js` — original individual meshes
- `billboardTreeSystem.js` — sprite-based
- `efficientTreeSystem.js` — instanced optimization
- `growingTreeSystem.js` — age-driven growth states
- `cherryTreeSystem.js` — dedicated cherry blossom variant
- `poplarTreeSystem.js` — poplar-specific tapered trunks
- `terrainTreeSystem.js` — terrain-integrated geometry

### Grass System (`grassSystem.js`)
- **Instanced sprite grass**: GPU-animated wind sway via shader
- **Seasonal color adaptation**: reads `boardSystem.currentSeason` → `seasonConfig.treeColor`
- **4 LOD levels** (distance-based instance count):
  - Near (<30): 16 instances, full size/opacity
  - Medium (<60): 8 instances, 0.8× size/opacity
  - Far (<100): 4 instances, 0.6× size/opacity
  - Very Far (<150): 2 instances, 0.4× size/opacity
- **Wind configuration**: speed + strength uniforms
- **Atlas texture**: generated canvas with multiple grass blade images

### Decorative Visuals (`decorativeVisuals.js` — ~1,200 lines)
- **Daisy system**: 200 max billboarded flower sprites around camera
  - Procedural flower texture (5 white petals + yellow center)
  - Terrain-normal oriented (quaternion from up→normal)
  - Respawn on camera movement >25 units
  - Frustum culling for Navi-like light cap (tier-based: low=0, medium=4, high=12)
  - Wind phase per daisy
- **Bird system**: 12 max animated birds, object-pooled
  - Flight paths with perlin-like wandering
  - Height range 3–8 units above terrain
  - Panic reactions (flee from camera, return after delay)
  - "Panic sounds": text-to-speech-like onomatopoeia (`hu?`, `oop!`, `yelp!`, etc.)
  - Frustum culling
- **Global wind system**: Ghost of Yōtei-inspired
  - Slowly wandering wind heading (target angle interpolation)
  - Gust system: random spawn interval (avg 8s), intensity boost, decay rate

---

## 6. LIGHTING & TIME

### Sun / Moon System (`board_clean.js`)
- **Orbiting sun**: configurable orbit radius, height, intensity, color
- **Lens flare**: 3 additive-blended sprites with decreasing size/opacity
- **Moon system**: independent orbit with 28-day period, phase-based vector texture
- **Phase texture generation**: canvas-drawn crescent/gibbous/full moon with shadow overlay
- **Moon shadow casting**: separate directional light for nighttime shadows
- **Horizon fade**: flare fades near horizon

### Lighting Rig (`board_clean.js` + `devInterface.js`)
- **Artist-driven keyframe system**: 5 light tracks (sun, moon, ambient, nightAmbient, sky)
- **Keyframe structure**: `{ time, color, intensity, transparency? }`
- **Interpolation**: `interpolateRig()` with nearest-keyframe lerp
- **Persistence**: saved to/restored from `localStorage`
- **Dev UI**: full rig editor with add-keyframe-at-time, per-track keyframe list, delete, save/load
- **Transparency support**: sky track includes transparency for atmospheric fade

### Day/Night Cycle
- **Server-authoritative**: `serverGameTime`, `serverDayLength`, `serverYear`, `serverDayOfYear`, `serverTimeOfDay`
- **NaN-hardened display**: all time calculations guarded with `Number.isFinite()` fallbacks
- **Season system**: 4 seasons × 30 days = 120-day year
  - Configurable per-season: sun tilt, moon color/intensity, tree color, fog color, sky transparency
- **Day time slider**: dev-interactive, drag-aware (pauses auto-update while dragging)
- **Year time slider**: same pattern for year progress
- **DOM throttling**: updates throttled by frame count to prevent per-frame repaints

### Fog (`game.js`, `board_clean.js`)
- **Exponential fog**: `THREE.Fog` with color sync to sun elevation
- **Distance manager**: unified draw distance control for fog, trees, LOD
- **Dynamic update**: `updateFogColor()` based on sun height and camera altitude

---

## 7. DEVELOPER TOOLS & DEBUGGING

### Parameter System (`parameterSystem.js` — ~2,000 lines)
- **100+ registered parameters** across 28 categories
- **Declarative config**: `{ default, range, category, description, apply(), gate() }`
- **Gated writes**: `Object.defineProperty` on computed values (sun/moon/ambient intensity, fog near/far) — game-logic writes silently ignored when user has overridden
- **Color object protection**: monkey-patched `copy/lerp/setRGB/setHex/set` on Three.js color instances
- **Time protection**: wraps `updateServerGameTime` so user day/speed survive server syncs
- **Modifier stacks**: `ModifierStack` class for layered value blending with weight/operation/add/mix
- **Select parameter type** (recent): numeric select with option labels, full coercion pipeline
- **Saved defaults**: `localStorage` persistence with `_loadSavedDefaults()`
- **Socket listeners**: receives server-broadcast parameter updates
- **Reset all**: one-button revert to factory defaults

### Dev Interface (`devInterface.js` — ~3,700 lines)
- **28 categories**: terrain, planet, lighting, spotlight, time, environment, graphics, taa, performance, lod, distances, water, shoreline, landCover, cliff, tree, blending, verts, camera, sky, stars, rig, checkerboard, models, jesus, settlement, flare, minimap
- **Transparent overlay**: `rgba(0,0,0,0.85)` with `backdrop-filter: blur(8px)`
- **Mobile dev button**: 56px floating FAB, bottom-right, dev-restricted
- **Category tabs**: 3-letter abbreviations, toggle on/off, active state styling
- **Memory monitor panel**: mount point for `MemoryProfiler` sparklines
- **Live stats bar**: wind speed + compass arrow, day time, season, vertex/triangle counts, camera ray distance/object
- **Game actions grid**: Clear, Spawn, Cel, Map, Err, Respawn
- **Quick actions**: Reset, Rand, Export, Import, Save Def, Set Def, Clear Def, Photo, Logs, Ray
- **Parameter controls**:
  - Slider (numeric range)
  - Checkbox (boolean)
  - Color picker
  - Select dropdown
  - Modifier stack summary with expand
- **ShowIf conditional display**: parameters hidden based on other parameter values
- **Edge pair cache**: `localStorage` persistence of per-biome-pair edge blending settings with slug-based keying
- **Rig editor UI**: add keyframes at arbitrary times, per-track keyframe lists, delete individual keys
- **Jesus summon panel**: trigger button + status polling
- **Settlement panel**: village list, tome viewer
- **TAA panel**: status polling, enable toggle
- **Geometry polling**: live vertex/triangle/draw call counts

### Memory Profiler (`memoryProfiler.js`)
- **Three.js object counting**: geometries, materials, textures, lights, cameras
- **Heap tracking**: `performance.memory.usedJSHeapSize`
- **Draw call tracking**: `renderer.info.calls`
- **Sparkline history**: 60-second ring buffers for all metrics
- **Throttled updates**: once per second, only when dev tools open
- **Hotkey**: `M` toggle
- **Panel modes**: floating vs embedded

### Performance Manager (`performanceManager.js`)
- **FPS monitoring**: rolling average frame time
- **Adaptive quality**: potential for tier adjustment (currently mostly logged)

### Distance Manager (`game.js`)
- **Unified distance control**: single source of truth for fog, tree, LOD draw distances
- **User multipliers**: per-category scale factors from parameter system
- **Tier-aware defaults**: high/medium/low baseline distances

### Console & Error Tools
- **Console manager** (`consoleManager.js`): log aggregation, level filtering
- **Server error display** (`serverErrorDisplay.js`): client-side panel showing server-forwarded errors
- **Screenshot tools**: capture (`takeScreenshot()`), analysis (`analyze_screenshot.js`), visual test (`screenshot_visual_test.js`)
- **Validation tests** (`validationTests.js`): automated test suite for game logic

---

## 8. CAMERA & CONTROLS

### Camera Controller (`camera.js` — ~800 lines)
- **4 modes**: strategic, tactical, follow, free
- **Spherical orbit**: middle-mouse drag controls azimuth + polar angles
- **Right-mouse pan**: drag to translate camera target
- **Velocity-based movement**: acceleration + deceleration for smooth panning
- **Zoom target system**: scroll or button triggers smooth camera flight to target point
- **Isometric constants**: 45° azimuth, ~31.5° polar for diamond silhouette view
- **Dynamic pan speed**: height-aware pan speed scaling (higher = faster)
- **Oscillation failsafe**: detects camera wobble and clamps
- **Touch support**: full touchstart/touchmove/touchend handling with drag threshold
- **Mode transitions**: animated interpolation between modes
- **Boundary clamping**: min/max orbit distance, polar angle limits
- **Keyboard**: WASD movement, Q/E elevation, Space mode cycle, C center on king

---

## 9. SPECIAL EFFECTS & MINI-GAMES

### Jesus Summon System (`jesusSummonSystem.js`, `jesusSummonTriggerSystem.js`)
- **Animated summon**: model rises from below water level to terrain peak
- **Terrain hill deformation**: real-time heightfield modification creating a mound
- **Camera shake rumble**: per-frame position jitter during summon
- **Sound herald**: Web Audio API synthesized herald tone
- **Rotation hum**: continuous loop during summon
- **Facing offset**: -90° relative to camera
- **Dev triggerable**: button in dev interface

### Minimap Overlay (`game.js`)
- **Chunk image caching**: renders terrain chunks to offscreen canvas for minimap
- **Camera tracking**: follows player position on overview map

### Respawn Animation (`game.js`)
- **Flying castle intro**: camera starts high above, swoops down to player position
- **Smooth cubic easing**: startPos → targetPos with elegant swoosh

---

## 10. AUDIO

### Sound Manager (`soundManager.js`)
- **Web Audio API context**: with user-gesture resumption (`AudioContext.resume()` on click/key/touch)
- **Procedural footstep synthesis**: oscillator + noise burst, 100ms cooldown
- **Grumbling sounds**: text-to-speech-like synthesis, 3-second cooldown
- **Rumble loop**: low-frequency oscillator for Jesus summon terrain shake
- **Rotation hum**: sustained tone during summon animation
- **Herald sound**: pitched tone sequence for summon start
- **Master volume**: 0.5 default

---

## 11. MOBILE & PERFORMANCE

### Device Capability Detection (`game.js`)
- **WebGL capability probing**: `maxTextureSize`, `maxVertexTextures`, `maxTextureImageUnits`, renderer string, vendor
- **GPU tier scoring**:
  - High-end GPU (+3): Apple M, RTX, GTX, Radeon RX, Adreno 7/8, Mali-G7
  - Low-end GPU (-2): Mali-G3, Mali-T, Adreno 3/4, PowerVR
  - Texture size: 16K(+2), 8K(+1), <4K(-1)
  - CPU cores: 8+(+2), 4+(+1), ≤2(-1)
  - RAM: 8GB+(+2), 4GB+(+1), <4GB(-1)
  - Mobile UA (-1)
- **Tiered defaults**:
  - High: 192 grid, 36 mesh mult, 60 render dist, TAA on, pixel ratio 2
  - Medium: 128 grid, 24 mesh mult, 40 render dist, TAA off, pixel ratio 1.5
  - Low: 96 grid, 18 mesh mult, 30 render dist, no antialias, pixel ratio 1

### Android Hardening
- **Shader precision**: explicit `precision highp/mediump` declarations
- **WebGL context loss handling**: `webglcontextlost` → pause render loop, `webglcontextrestored` → resume
- **API guards**: feature detection before advanced WebGL API usage
- **ES2020 removal**: stripped `??` operator for older WebViews
- **Cache busters**: timestamp query params on all script loads

---

## 12. SETTLEMENT SUBSYSTEMS (Client-Side)

### Settlement System (`game.js`)
Initialized as 6 interdependent systems:
- **SettlementSystem**: village placement, terrain-aware positioning
- **BuildingSystem**: procedural building generation per village type
- **RoadSystem**: path network between buildings and village center
- **VillagerSystem**: client-side villager visualization, walk types, activity scheduling
- **KnightSystem**: knight entities, equipment, combat stats
- **TournamentSystem**: jousting/arena events with knight participation
- **TomeUI**: in-game book interface for reading village tomes

### Settlement Data (`client/settlementData.js` — referenced)
- **6 settlement types**: hamlet, village, town, port, abbey, castle
- **Type definitions**: hasManor, hasChurch, population ranges, building thresholds
- **Villager roles**: knight, mayor, priest, farmer, fisher, child, monk, townCrier, villager
- **Task definitions**: morning/evening task arrays per role
- **Season definitions**: 4 seasons with production multipliers

---

## 13. NETWORKING & REAL-TIME SYNC

### Network Manager (`network.js`)
- **Socket.IO wrapper**: connection, reconnection, auth header injection
- **Move synchronization**: client validates → server authorizes → broadcast to all
- **Chunk streaming**: requests terrain chunks on demand
- **Time sync**: receives server-authoritative time packets
- **Server error handling**: displays forwarded errors in UI panel

### Error Forwarding
- **Client→Server**: `window.onerror` and `console.error` intercepted, sent to server log endpoint
- **Server→Client**: all server errors broadcast via `server-error` socket event
- **Error panel**: dedicated UI section showing latest server errors with clear button

---

## 14. ASSET PIPELINE

### Models
- **14 GLB files**: Bishop, book, various pieces and props
- **Blend file**: `AllModels.blend` with `.blend1` backup
- **Model loading**: GLTFLoader with cache-busting for remote deployment

### Image Assets
- **~40 images**: textures, tree photos, screenshots, grass reference
- **Procedural textures**: forest floor (4 variants), leaf dots (3 densities), grass atlas, sky gradient, circular masks, moon phases

### Chessopia Tools
- **Separate asset preview app**: `Chessopia Tools/index.html`
- **Baker core**: `baker-core.js` for texture/asset baking
- **Exporter**: `exporter.js` for model export
- **Preview scene**: `preview-scene.js` for isolated model viewing

---

## Summary by the Numbers

| Metric | Value |
|---|---|
| Total git commits | ~44 |
| Client JS files | ~55 |
| Server JS files | ~8 |
| Test HTML pages | ~15 |
| Lines in `board_clean.js` | ~5,000 |
| Lines in `devInterface.js` | ~3,700 |
| Lines in `textureBlendingSystem.js` | ~1,700 |
| Lines in `localTreeSystem.js` | ~1,500 |
| Lines in `game.js` | ~1,800 |
| Lines in `camera.js` | ~800 |
| Lines in `decorativeVisuals.js` | ~1,200 |
| ParameterSystem registered params | 100+ |
| Dev interface categories | 28 |
| Tree system iterations | 10+ |
| Biome types | 8 |
| LOD tiers (terrain) | 5 |
| Grass LOD levels | 4 |
| Settlement types | 6 |
| Villager roles | 9 |
| Lighting rig tracks | 5 |
| Seasons | 4 |
| Shader uniforms (texture blending) | 60+ |
| 3D model assets | 14 GLB |
| Image assets | ~40 |
