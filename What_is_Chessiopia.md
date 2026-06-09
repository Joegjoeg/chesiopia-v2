# What is Chessiopia?

## From the Assistant's Perspective

Chessiopia is a multiplayer 3D chess variant built as a browser-based game using Three.js for rendering and Node.js with Socket.IO for real-time multiplayer networking. I have been working inside this codebase across numerous sessions, and this document summarizes what the project actually is, how it functions, and where it currently stands in development.

---

## Core Concept

Chessiopia takes traditional chess and places it on an infinite, procedurally generated 3D landscape. Instead of a flat 8x8 board, the game world consists of rolling hills generated with multi-octave noise. A conforming chess grid is overlaid on top of the terrain. Pieces move according to modified chess rules, but the terrain itself affects gameplay: tiles on steep slopes become impassable, creating natural chokepoints and high-ground strategic value.

The name appears in two forms across the codebase: **Chessiopia** (in file paths and package metadata) and **Chessopia** (in design documents like `DNA.md`). Both refer to the same project.

---

## Key Features

### 1. Infinite Procedural 3D Terrain
- Generated using multi-octave smooth noise (Perlin/simplex-based)
- Height-scaled rolling hills with biome-based coloring (water, sand, grass, forest, rock, snow)
- Chunk-based streaming: 16x16 tile chunks load and unload dynamically as the camera moves
- Terrain slopes block movement: tiles with >45° inclines are impassable
- Infinite in all directions; the world has no hard boundaries

### 2. Conforming Chess Board Overlay
- A unified single-mesh board system overlays the terrain with vertex-colored squares
- Dramatic performance improvement over individual tile meshes (~90% reduction in draw calls)
- Virtual tile abstraction: game logic operates on logical tiles without per-tile rendering overhead
- Board vertices conform exactly to terrain heights, eliminating gaps

### 3. 3D Chess Pieces
- Hierarchically constructed using Three.js primitives (base, body, head)
- Pieces are placed at terrain surface elevation plus an offset to prevent clipping
- Material consistency with shared materials for performance
- Visual states via emissive highlighting for selection and coverage

### 4. Modified Chess Rules
- **Pawn**: Moves 1 tile straight (N/S/E/W), captures 1 tile diagonally in any direction
- **Rook**: Horizontal/vertical up to 8 tiles
- **Knight**: L-shape (2,1), can jump over pieces
- **Bishop**: Diagonal up to 8 tiles
- **Queen**: Any straight line up to 8 tiles
- **King**: 1 tile in any direction
- Each piece has a movement cooldown after moving (ranging from 2 to 6 seconds)

### 5. Covering System (Unique Mechanic)
- Pieces can "cover" friendly pieces, protecting them from capture
- A covered piece cannot be captured directly
- To capture a covered piece, the attacker must either capture the covering piece or block the line of sight between them
- A piece can only cover one other piece at a time
- Moving a covering piece breaks the coverage
- Coverage is tracked server-side

### 6. Point Scoring and Shop System
- Players earn points by capturing enemy pieces (value equals standard chess piece values)
- Points can be spent in a shop (opened with `S`) to purchase new pieces
- Shop prices are 2x the piece value (Pawn: 2, Knight: 6, Bishop: 6, Rook: 10, Queen: 18)
- New pieces spawn adjacent to the player's king
- Maximum 20 pieces per player
- Newly purchased pieces start with a 5-second cooldown

### 7. Multi-Mode Camera System
- **Strategic Mode**: Overhead view for board awareness
- **Tactical Mode**: Rotating view around a focal point
- **Follow Mode**: Tracks the selected piece dynamically
- **Free Mode**: Full 3D navigation with elevation control
- Smooth cubic-eased transitions between modes and positions
- Controls: WASD for movement, Q/E for elevation, mouse drag to rotate, scroll to zoom, Space to cycle modes, C to center on king

### 8. Advanced Visual Systems
- **Cel Shading**: Custom shader-based toon rendering for a stylized look
- **Texture Blending**: Height-based terrain texture mixing for natural biome transitions
- **Grass System**: Shader-based grass rendering on terrain surfaces
- **Tree Systems**: Multiple generations exist; the current approach uses instanced meshes with wind animation, seasonal growth modifiers, and biome-aware placement
  - Supports seasonal states (Spring, Summer, Autumn, Winter) with growth rate modifiers
  - Shader-based wind sway
- **Day/Night Cycle**: Server-authoritative time system mapping real-world time to in-game days and seasons
- **Shadow System**: Selective shadow casting for depth perception
- **LOD System**: Distance-based level of detail for terrain chunks

### 9. Multiplayer Architecture
- Real-time synchronization via Socket.IO
- Node.js/Express backend with CORS-enabled WebSocket connections
- Server-side authoritative game state (`gameState.js`)
- Client-side move validation with server reconciliation
- Error forwarding: server errors and uncaught exceptions are broadcast to all connected clients for debugging
- AI opponent support (partial implementation)

### 10. Developer Tooling
- Extensive debug interfaces and test HTML pages (`connection_test.html`, `debug.html`, `test_board_debug.html`, etc.)
- In-game dev interface (`devInterface.js`) with parameter sliders for tuning visual systems
- Console manager for log aggregation
- Performance manager with FPS monitoring
- Memory profiler for Three.js object tracking
- Screenshot capture and analysis tools
- Validation test suite (`validationTests.js`)

---

## User Interaction Flow

1. **Load**: Player opens the game in a browser. A loading screen shows initialization progress (renderer, scene, systems, network).
2. **Connect**: The client establishes a Socket.IO connection to the Node.js server.
3. **Spawn**: The player is assigned a color, and their pieces spawn near their king on the infinite board.
4. **Navigate**: Using WASD, mouse drag, and scroll, the player moves the camera across the infinite terrain.
5. **Select**: Clicking a piece selects it and highlights valid move tiles in 3D.
6. **Move**: Clicking a valid tile moves the piece with a smooth eased animation. A cooldown timer begins.
7. **Cover**: Right-clicking or using a cover command can establish a protective covering relationship with a nearby friendly piece.
8. **Capture**: Moving onto an enemy piece (that is not covered) captures it, awarding points and removing the piece.
9. **Shop**: Pressing `S` opens the shop modal. The player can purchase reinforcements if they have enough points.
10. **Explore**: The player can move the camera infinitely in any direction; new terrain chunks stream in seamlessly.

---

## Stage of Development

### What Works
- Core 3D rendering pipeline (Three.js scene, renderer, lighting)
- Procedural terrain generation with chunk streaming
- Unified mesh board overlay with virtual tile logic
- Hierarchical 3D piece construction and placement
- Multi-mode camera with smooth transitions
- Client-server multiplayer connection and state sync
- Modified chess move validation (with terrain blocking)
- Piece cooldown system
- Covering system logic (server-side tracking)
- Point scoring and shop interface
- Cel shading and texture blending
- Grass and tree rendering systems
- Day/night and seasonal time mapping
- Multiple debug and test interfaces

### What Is Partially Implemented or Iterative
- **Tree systems**: There are at least five different tree system files (`treeSystem.js`, `terrainTreeSystem.js`, `localTreeSystem.js`, `growingTreeSystem.js`, `poplarTreeSystem.js`, `cherryTreeSystem.js`, etc.), indicating the visual approach to foliage is still evolving. `growingTreeSystem.js` appears to be the most advanced, featuring instanced meshes, growth animations, and seasonal modifiers.
- **AI opponents**: Referenced in architecture but not fully integrated into the active game flow.
- **Authentication**: Referenced in `DNA.md` and `package.json` dependencies (`bcrypt`), but the current server uses open guest play.
- **LOD**: Infrastructure exists but may still be under tuning.

### What Suggests Active Heavy Development
- The root directory contains numerous temporary debug scripts (`debug_*.js`, `test_*.js`, `temp_*.js`, `fix_*.js`, `check_*.js`)
- Screenshots folder with 38+ debug renders of terrain states
- Multiple connection test HTML files suggesting network stability has been a focus
- A `DNA.md` file exists, which is essentially a complete recreation guide — a common artifact when a project has undergone major refactoring or rebuilds
- The presence of `.bak` files and archived systems (`oldTreeSystem_ARCHIVED.js`) confirms iterative replacement of subsystems

### Architectural Maturity
The codebase demonstrates sophisticated architectural patterns:
- **Bridge Pattern**: `movementBridge.js` cleanly separates 2D chess logic from 3D rendering
- **Event-Driven Communication**: Loose coupling between rendering, game logic, and network systems
- **Multi-layer Caching**: Valid moves, virtual tiles, corner heights, and terrain chunks are all cached
- **Memory Management**: Explicit disposal of Three.js geometries and materials to prevent WebGL memory leaks
- **Device Tiering**: Automatic detection of device capabilities with quality adjustments

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript, Three.js (r155), HTML5 Canvas |
| Backend | Node.js, Express, Socket.IO |
| Terrain | Custom multi-octave noise (`simplex-noise` library) |
| Build | None (raw files served statically) |
| Testing | Playwright (for screenshot/regression testing), manual test pages |

---

## Summary

Chessiopia is not a simple chess clone. It is an ambitious attempt to fuse strategic chess gameplay with infinite open-world 3D exploration. The project is past the prototype phase — it has a working multiplayer server, a performant 3D client, and core game mechanics implemented — but it is still in active development. The sheer volume of debug tooling, test pages, and iterative system rewrites (especially around trees and terrain visuals) indicates a project that is functional but still being polished and optimized. From my perspective as the assistant working in this codebase, Chessiopia represents a technically complex hybrid of turn-based strategy and real-time 3D world rendering.
