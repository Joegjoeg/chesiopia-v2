# Codex Mediam: Chessiopia Overview (GPT 5.1 Companion)

## 1. Perspective from the Assistant
Chessiopia is a browser-based, multiplayer 3D chess variant that stretches classic chess across an infinite, procedurally generated landscape. From inside the codebase I see Three.js driving the render pipeline, while Node.js and Socket.IO keep every player's state synchronized over the network. The familiar 8x8 board is replaced with a conforming grid that hugs rolling hills, valleys, and biomes, so every match unfolds on unique terrain that directly affects movement and tactics.

## 2. Key Features and Player Interactions

### 2.1 Living Terrain Chessboard
- Infinite world built from multi-octave noise with biome-aware texturing (water, sand, grass, forest, rock, snow).
- Terrain height and slope feed into gameplay: steep tiles become impassable, naturally creating chokepoints and defensible ridges.
- A unified mesh board overlays the terrain, keeping draw calls low while letting logic operate on virtual tiles.

### 2.2 Enhanced Piece & Cover Systems
- All canonical chess pieces exist, but movement is adapted for the open grid (e.g., pawns move N/S/E/W and capture diagonally). Cooldowns after each move pace the action and encourage multi-piece play.
- The covering mechanic lets a friendly piece protect another if it has line of sight; covered units cannot be captured until protection is removed, introducing squad-based tactics usually absent from chess.

### 2.3 Economy and Reinforcements
- Captures award traditional chess point values; a lightweight shop lets players spend points (at 2× cost) to buy reinforcements that spawn near their king.
- Newly purchased pieces arrive on cooldown, preventing instant rushes and rewarding long-term planning.

### 2.4 Navigation & Feedback
- Four camera modes (Strategic, Tactical, Follow, Free) allow players to survey the infinite terrain or lock onto a single duel, with eased transitions and WASD/QE/mouse controls.
- Visual feedback systems highlight selections, valid moves, and coverage relationships while shader-based cel shading, texture blending, grass, and tree systems keep the world legible and stylized.

### 2.5 Typical Player Loop
1. Load into the world, connect to the server, and spawn near the king.
2. Pan/zoom the camera to scout the terrain and streaming board chunks.
3. Select a piece to view valid moves, taking slopes and blockers into account.
4. Move or cover allies, respecting cooldowns and protection states.
5. Capture opponents, earn points, buy reinforcements, and keep expanding along the infinite board.

## 3. Stage of Development
- **Stable Foundations**: Rendering, procedural terrain streaming, the conforming board, multiplayer sync, movement validation, covering, cooldowns, shop flow, and the shader stack are all functioning end-to-end.
- **Active Iterations**: Tree/foliage systems, AI opponents, device-tier optimizations, and level-of-detail tuning are undergoing repeated revisions (multiple experimental files and debug scripts exist).
- **Evidence of Heavy Ongoing Work**: The repository contains extensive debug/test utilities, screenshot audits, and a DNA-style rebuild guide, indicating a mature prototype that's still being polished and optimized for performance and content breadth.
