# Chessopia Feature Archive
## A Chronological Inventory of Everything Built Along the Way

*Generated from git history + codebase survey. Dates are from commit timestamps. Some features were built across multiple sessions and are grouped by the period they first appeared.*

---

## Phase 1: Bootstrap & Deployment (April 18, 2026)

**Project Foundation**
- `Initial commit` — Chesiopia chess game project scaffold
- `Render.com restructure` — Moved server files to root, fixed file paths for cloud deployment
- `Error handling & logging` — Server startup debugging, test servers (minimal HTTP, essential deps only)
- `Dynamic server URL` — Client auto-detects local vs. remote (`localhost` vs. Render URL)

**Networking Basics**
- Socket.IO real-time multiplayer backbone
- CORS-enabled Express backend
- Server-side authoritative `gameState.js`

---

## Phase 2: Core 3D Chess (April 23, 2026)

**Game Board & Pieces**
- `3D Piece Models` — Hierarchical construction from Three.js primitives (base, body, head) with shared materials
- `Conforming Chess Board` — Unified single-mesh board overlay that follows terrain contours (vertex-colored squares)
- `Virtual Tile Abstraction` — Game logic operates on logical tiles without per-tile rendering overhead (~90% draw call reduction)
- `Piece Placement at Terrain Height` — Pieces sit at surface elevation + offset to prevent clipping
- `Model Loading Pipeline` — GLB loading with cache-busting for remote deployment

**Terrain Basics**
- `Infinite Procedural Terrain` — Multi-octave smooth noise (Perlin/simplex-based) generating rolling hills
- `Biome Coloring` — Water, sand, grass, forest, rock, snow height-based color palette
- `Slope-Based Movement Blocking` — Tiles with >45° inclines are impassable, creating natural chokepoints

**Camera**
- `Multi-Mode Camera System`
  - Strategic Mode (overhead)
  - Tactical Mode (rotating focal)
  - Follow Mode (tracks selected piece)
  - Free Mode (full 3D navigation: WASD + Q/E elevation)
  - Smooth cubic-eased transitions between all modes

**Multiplayer**
- Client-side move validation with server reconciliation
- AI opponent support (partial)

---

## Phase 3: World Streaming & Visual Systems (April 28, 2026)

**Terrain Streaming**
- `World Data Optimization` — 145MB → 39MB (72% reduction) via format optimization
- `On-Demand Chunk Generation` — 16×16 tile chunks load/unload dynamically based on camera position; removed pre-download requirement
- `Chunk Caching` — Client-side terrain cache with server fallback
- `Terrain Normal Rotation Fix` — Cancelled group Y-rotation so terrain tilt stays world-locked

**Game Mechanics**
- `Modified Chess Rules` — Cooldowns after moving (2–6 seconds per piece type)
- `Point Scoring` — Earn points by capturing enemy pieces
- `Chess Shop` (`S` key) — Spend points to buy new pieces (Pawn 2, Knight 6, Bishop 6, Rook 10, Queen 18), spawn adjacent to king, max 20 pieces, 5s cooldown on new purchases
- `Covering System` — Pieces can "cover" friendly pieces; attacker must break line of sight or capture the covering piece first

**Visual Feedback**
- Selection highlighting, valid-move indicators, capture indicators, hover glow, coverage visualization (emissive overlays)

---

## Phase 4: Mobile, Debug & Dev Tools (April 29, 2026)

**Mobile Optimization**
- `Mobile-Aware Mesh Sizing` — 96×96 tiles on mobile (6× chunks), 192×192 on desktop (12×)
- `Duplicate Loading Screen Fix` — Prevents double overlay on load
- `Mobile Debug Log Panel` — On-screen console for mobile browsers
- `Touchmove Debug Spam Removal` — Cleaned up flood-level mobile logging

**Developer Tooling**
- `Visible Vertex/Triangle Counts` — Live counters in dev tools
- `Optimisation-Status Panel` — Real-time performance readout
- `Dev Interface` (`parameterSystem.js` + `devInterface.js`)
  - 21 categories of tunable parameters: terrain, planet, lighting, time, environment, graphics, TAA, performance, LOD, water, shoreline, land cover, tree, blending, verts, camera, sky, stars, rig, checkerboard, models, jesus
  - Gated parameter writes (user overrides survive server syncs)
  - Color object protection (monkey-patched Three.js color mutations)
  - Modifier stacks for layered value blending
  - Mobile dev button (floating FAB, dev-restricted)
  - Rig keyframe editor for day/night lighting tracks
- `Console Manager` — Log aggregation and forwarding
- `Performance Manager` — FPS monitoring
- `Memory Profiler` — Three.js geometry/material/heap/calls tracking with 60-second sparkline history
- `Validation Test Suite` (`validationTests.js`)
- `Screenshot Capture & Analysis` (`capture_screenshot.js`, `analyze_screenshot.js`, `screenshot_visual_test.js`)
- `Server Error Forwarding` — Uncaught exceptions and errors broadcast to all connected clients for debugging

**Throttling & Cleanup**
- Chunk-loaded mesh rebuilds throttled to 500ms
- Per-frame console spam silenced (`updateDynamicMesh`, `STREAMING ENTRY`, `MOUSE WORLD`, `mouse avoidance`)

---

## Phase 5: Trees, Terrain & Deployment Hardening (May 8–11, 2026)

**Tree Systems (Multiple Generations)**
The codebase contains a full evolution of tree rendering:
- `treeSystem.js` — Original individual-mesh trees
- `billboardTreeSystem.js` — Sprite-based tree rendering
- `efficientTreeSystem.js` — Instanced-mesh optimization
- `growingTreeSystem.js` — Age/growth-state driven trees
- `localTreeSystem.js` — Large local biome-aware tree system (~72KB, the current main approach)
- `cherryTreeSystem.js` — Dedicated cherry blossom variant (May 11)
- `poplarTreeSystem.js` — Poplar-specific rendering
- `terrainTreeSystem.js` / `terrainTreeIntegration.js` — Terrain-aware placement
- `debugTreeSystem.js` — Debug visualization helpers
- `oldTreeSystem_ARCHIVED.js` — Retired approach
- `hybridTreeManager.js` — Hybrid approach managing multiple tree strategies

**Tree Features Across Systems**
- Seasonal states: Spring, Summer, Autumn, Winter with growth-rate modifiers and color shifts
- Shader-based wind sway
- Biome-aware placement
- LOD distance fading
- Hybrid instanced + billboard fallback

**Terrain & Water Improvements (May 11)**
- `Water Spherical Deformation` — Improved water surface math
- `Terrain Mesh Parameter Updates` — Finer-grained terrain generation controls
- `RollingTerrainMesh.js` — Alternative terrain mesh builder

**Deployment**
- `Non-TTY Crash Fix` — try/catch around `process.stdin.setRawMode` for Render
- `Script Loading Guard` — Prevents ReferenceError when client scripts missing from load array
- `Terrain Route Cache Fix` — `terrainCache` vs `chunkCache` naming fix
- Cache busters on all scripts to defeat CDN/browser caching

---

## Phase 6: Android, Shader Polish & Error Forwarding (May 15–16, 2026)

**Android Compatibility**
- `Shader Precision Declarations` — Explicit `precision highp/mediump` for mobile GPUs
- `WebGL Context Loss Handling` — Graceful recovery when browser kills GPU context
- `API Guards` — Feature detection before using advanced WebGL APIs
- `ES2020 Removal` — Stripped `??` operator from `lodManager.js` for older Android WebViews
- `LOD Manager Init Guard` — Prevents crash when initialization conditions aren't met

**Water & Shader Fixes (May 16)**
- `Water Shader Fog Compatibility` — Fixed water fragment shader fog integration
- `Auto-Forward Console Errors to Server` — Client console errors automatically reported to server endpoint for remote debugging

---

## Features Without Dedicated Commits (Built Inside Larger WIP/Update Commits)

### Auth & Account System
- `AuthOverlay` — Login / Register / Email Verification / Welcome flows
- `AuthState` — JWT token management, dev-role detection, account badge UI
- `AuthAPI` — Server-side register/login/verify/refresh endpoints
- Dev-restricted tools (only dev role sees mobile dev button & advanced panels)

### Audio Systems
- `SoundManager` — Web Audio API context with user-gesture resumption
  - Footstep synthesis (oscillator + noise)
  - Grumbling sounds (cooldown-based)
  - Herald sounds for Jesus summon
  - Rumble/rotation hum loops
- Decorative bird "panic sounds" (text-to-speech-like: "hu?", "oop!", "yelp!")

### Sky & Atmosphere
- `SkyShaderSystem` — Procedural starfield with orbit fade effect (fades from atmospheric gradient to stars as camera ascends)
- `ZodiacConstellationSystem` — 12 persistent 3D constellations with glowing spline connections, stable per-session seed, fade in/out based on altitude

### Advanced Rendering
- `Cel Shading` (`celShader.js`, `celShaderSimple.js`) — Custom toon shader material for stylized look
- `Temporal Anti-Aliasing (TAA)` (`temporalAASystem.js`) — Jitter-based subpixel stability
- `Shadow System` (`shadowSystem.js`) — Selective shadow casting for depth
- `Texture Blending System` (`textureBlendingSystem.js`) — Height/mask-based terrain texture mixing (~72KB, extensive shader work)
- `Texture Atlas Generator` (`textureAtlasGenerator.js`) — Bakes multiple textures into atlases
- `Water Reflection Manager` (`waterReflectionManager.js`) — Mirror camera + render target reflections with distance/height culling

### Grass & Ground Detail
- `Grass System` (`grassSystem.js`) — Instanced sprite grass with GPU wind animation, seasonal color adaptation, 4 LOD levels (distance-based instance count), atlas texture generation

### Decorative Environment
- `DecorativeVisualsSystem`
  - `Daisy System` — 200 max flower sprites around camera, respawn on movement
  - `Bird System` — 12 max animated birds, object-pooled, spawn radius, height range, wind-reactive flight paths, panic reactions
  - `Global Wind System` — Ghost of Yōtei-inspired wandering wind heading + gust simulation

### Special Effects
- `Jesus Summon System` (`jesusSummonSystem.js` + `jesusSummonTriggerSystem.js`)
  - Animated model rise from below water
  - Terrain hill deformation (peak spawn)
  - Camera shake rumble
  - Sound herald + rotation hum
  - Dev-interface triggerable
  - Status: idle / summoning

### Camera & Controls
- `Camera.js` (~34KB) — Full camera controller with mode switching, easing, zoom, boundary clamping, elevation control
- `Planet Mapping` (`planetMapping.js`) — Spherical world mapping utilities

### Networking & State
- `Network Manager` (`network.js`) — Socket.IO wrapper with reconnection, auth headers, move synchronization, chunk streaming
- `ServerErrorDisplay` (`serverErrorDisplay.js`) — Client-side error panel showing server-side issues
- `Move Validator` (`moveValidator.js`) — Client-side rule enforcement
- `Game State` (`gameState.js`) — Local state mirror with server reconciliation

### Utilities & Testing
- `Console Forwarding Tests` — Multiple scripts (`test_console_forwarding.js`, `trigger_console_*.js`, `request_logs_simple.js`, etc.)
- `Terrain Debugging` — `debug_terrain_tiles.js`, `debug_slider_*.js`, `debug_system_creation.js`, `debug_biome_data.js`
- `Grass Debugging` — `debug_grass_*.js` (multiple iterations)
- `Ownership Tests` — `test_ownership.js`, `test_ownership_simple.js`
- `Server API Tests` — `test_server_api.js`
- `Browser Parameter Tests` — `test_browser_parameters.js`

### Tooling Suite (`Chessopia Tools/`)
- Separate mini-app for asset preview
- `baker-core.js`, `exporter.js`, `preview-scene.js`
- Own `index.html` + `server.js` + `styles.css`

### Prototype / Experiment Pages
- `scalar_field_sim.html` — Scalar field simulation UI
- `connection_test.html` / `connection_final.html` / `connection_debug.html` — Network debugging pages
- `piece_test.html` — Piece rendering test
- `test_board_debug.html` — Board logic validation
- `minimal_game.html` / `minimal_test.html` / `simple_test.html` — Stripped-down bootstraps

---

## Summary Stats

| Category | Count |
|---|---|
| Git commits | ~44 |
| Client JS modules | ~55 |
| Test/debug HTML pages | ~15 |
| Tree system iterations | ~10 |
| Dev tool categories | 21 |
| ParameterSystem tunable parameters | 100+ |
| 3D model assets | 14 GLB + 1 blend file |
| Image assets | ~40 (incl. trees, textures, screenshots) |
| Lines in `board_clean.js` alone | ~6,000 |
| Lines in `devInterface.js` | ~3,100 |
| Lines in `parameterSystem.js` | ~2,000 |

---

*This archive is intended as both a historical record and a feature pantry — anything here can be revisited, refactored, or dropped into a future iteration.*
