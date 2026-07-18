# GamerKraft 3D Engine

A browser-based voxel game engine and level editor. Build 3D platformer levels,
playtest them instantly, and publish them as fully standalone HTML files that run
anywhere — even offline.

**`index.html` is now only the browser entry point.** The application is composed from native ES modules in `src/` (plus vendored libraries), with no build step required.

## Features

### Editor
- **Fly camera** — WASD + Q/E to fly, hold right mouse to look, arrow keys also rotate, scroll wheel to dolly
- **Tools** — Brush (`B`) with click-drag painting, Box fill (`V`), area Eraser (`X`), Alt/middle-click eyedropper
- **22 block types** — terrain, glass, ice (slippery), ladders (climbable), water, lava, trees, spikes, jump/speed pads, coins, gems, enemy spawners, turrets, jetpack pickups, checkpoints, start/goal markers
- **Delta-based undo/redo** (`Ctrl+Z` / `Ctrl+Y`, 50 levels) — each stroke, box fill, clear, or map resize is one undoable action
- **Quick-select** — number keys `1`–`0` pick palette slots
- **Resizable maps** up to 200×200; shrinking prunes out-of-bounds blocks as an undoable action
- **Autosave** — the world persists to `localStorage` every 15 s and on tab close
- **Save / Load** project JSON files (backwards compatible with v1 saves)
- Interactive tutorial, debug overlay (position, draw calls, triangles, FPS), compass

### Play mode
- Third- or first-person camera (toggle with `C`), pointer-lock mouse look
- Fixed-timestep physics (60 Hz) with swept AABB voxel collision — frame-rate independent
- Jumping with coyote time, sprinting, swimming, ladder climbing, ice friction, lava, void death
- 3-heart health with invulnerability frames and knockback; checkpoints set your respawn
- Enemies that chase and avoid walls, turrets with per-unit fire cooldowns, and click-to-shoot combat (+50 per kill)
- Coins (+100), gems (+500), jetpack pickup (hold SPACE to fly)
- Score, coin counter, level timer, hearts, and FPS in the HUD
- Procedural WebAudio sound effects and an instanced particle system (no assets)

### Engine internals
- **Instanced rendering** — plain cubes are drawn through per-type `InstancedMesh`
  pools (one draw call per block type). A 10,000-block map renders in ~20 draw
  calls and builds in ~15 ms. Special shapes (trees, coins, gems, turrets, spikes)
  are individual meshes with shared geometries/materials — nothing is ever
  re-allocated or disposed per block.
- **Fixed-timestep simulation** with an accumulator; rendering interpolates the camera.
- **Settings panel** — shadows, particles, volume, FOV, view distance, camera mode; persisted to `localStorage`.
- **Publisher** — inlines the vendored libraries and the serialized world into one
  self-contained HTML file (with CDN fallback when building from `file://`).

## Controls

| Context | Keys |
|---|---|
| Editor | `WASD` + `Q`/`E` fly, right-drag look, wheel dolly, `B`/`V`/`X` tools, `1`–`0` palette, `Ctrl+Z`/`Y` undo/redo, Alt-click eyedropper |
| Play | `WASD` move, `SPACE` jump/climb/jetpack, `Shift` sprint/descend, mouse look (click to capture), click shoot, `C` camera toggle |

## Project structure

- `src/core/` — composition root that selects an editor or runtime target.
- `src/runtime/` — engine implementation plus save/export interfaces.
- `src/editor/`, `src/render/`, `src/physics/`, `src/assets/`, and `src/ui/` — explicit subsystem boundaries and public interfaces.
- `index.html` — browser markup and the single `src/main.js` module entry point.

## Development

No build step. Serve the repo root and open `index.html`:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Dependencies (Three.js r128, Tailwind, Lucide) are vendored in `vendor/` — the
app works fully offline and versions are pinned.

A public scripting/testing API is exposed as `window.GK`:

```js
GK.World.setBlock(0, 1, 0, 12)   // place a coin
GK.setMode('PLAY')               // start playtesting
GK.state.player.pos              // live player position
```

### Save format

```json
{ "version": 2, "mapSize": 20, "voxels": { "x,y,z": blockId } }
```

### Future work
- Greedy meshing / hidden-face culling to cut triangle counts further on huge maps
- Voxel DDA raycast for picking (replaces instanced-mesh raycasts)
- Behavior scripting for blocks and entities

## Deployment

Pushes to `main` deploy to GitHub Pages via `.github/workflows/static.yml`.

### Rendering architecture

`src/render/` owns the graphics-device boundary. Runtime code advances a frame
with `beginFrame()`, `submitScene()`, and `endFrame()` and reads draw statistics
through `getDiagnostics()`. The current `ThreeWebGLRenderer` maps the ordered
shadow, opaque, transparent, post-process, and UI pass contract to Three.js's
WebGL scheduler. Texture, mesh, material, and shader resources are represented
by opaque `AssetHandle`s. WebGPU, Vulkan, and desktop-native renderers remain
future backend implementations of the same `Renderer` interface.
