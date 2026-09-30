# GamerKraft Engine 3

A browser-native 3D game engine and level editor with an Unreal Engine–style workflow.
Build levels from voxels and actors, script gameplay, play-test in the viewport,
render photoreal stills and videos with the built-in **path tracer**, and package a
**single offline HTML file** that runs on desktop and mobile.

No build step, no server: open `index.html`.

## Editor

Layout follows Unreal Engine 5: menu bar, toolbar with mode selector and Play/Pause/Stop,
**Place Actors** / mode panel, **Viewport** with overlay toolbars (view, view mode, show flags,
transform tools, snapping, camera speed, axis widget, stats), **Outliner**, **Details** /
**World Settings**, and a bottom dock with **Content Browser**, **Output Log** and **Level Script**.
Status bar has a console (`help`).

- **Modes** — Selection (place/transform actors), Build (voxels), Landscape (sculpt + procedural terrain), Foliage (GPU-instanced painting)
- **Transform gizmo** — move (axes + ground plane), rotate, scale; grid/rotation/scale snapping
- **Build tools** — brush (cube/sphere, size 1–9, plane-locked strokes), box (solid / hollow / walls, add / remove / replace), erase, paint, flood fill, eyedropper
- **Landscape** — raise, lower, flatten, smooth, paint; fBm terrain generator with 5 biomes (temperate, desert, snow, tropical island, volcanic)
- **Undo/redo** — transactional history for blocks, actors, settings, script and map size (100 steps)
- **Project Browser** — 8 templates with live-rendered thumbnails; multiple projects saved in the browser with autosave
- **Play In Editor** — play-test in the viewport; the level is restored exactly on stop. *Play From Here* via right-click
- **Map Check**, copy/paste, duplicate, snap-to-floor, top orthographic view, lit/unlit/wireframe, guided tour

### Templates
Blank · Third Person Platformer · First Person Arena · Parkour Tower (Obby) · Coin Rush · Dungeon Crawler (procedural maze, keys & doors) · Survival Island · Sandbox Builder

## Engine

- **Rendering** — three.js r128, chunked voxel meshing (16³) with hidden-face culling and baked per-vertex ambient occlusion; 42 blocks with procedural shader materials (no textures); PBR lighting, ACES tone mapping, soft shadows that follow the camera, dynamic sky with sun, stars and clouds, time of day, 8 sky presets, a pooled point-light system, instanced particles, GPU-instanced foliage
- **Actors (35 types)** — player start, goal, checkpoints, jump/speed pads, teleporters, moving and crumbling platforms, keyed doors, trigger volumes, signs, coins, gems, health, keys, jetpack, double jump, spikes, saws, 4 enemy behaviours, turrets, enemy spawners, point lights, torches, crates, explosive barrels, trees, rocks, bushes, flowers, grass
- **Gameplay** — fixed 60 Hz physics with swept AABB collision against voxels and moving colliders; coyote time, jump buffering, variable jump height, sprint, swimming, ladders, ice, slime bounce, lava; health, lives, knockback, stomp attacks, shooting, in-game building with a hotbar; 5 win conditions (reach goal, collect all, defeat all, survive, sandbox) with optional time limits
- **Input** — keyboard + mouse (pointer lock), gamepad, touch controls on mobile
- **Audio** — procedural sound effects and 4 generative music tracks (WebAudio, no assets)
- **HUD** — health, lives, score, coins, timer, objective, keys, jetpack fuel, minimap, pause menu with settings, victory/defeat screens with best times

## Rendering

GamerKraft includes its own path tracer, written directly against WebGL2 (it does not use
three.js). Rendering runs entirely on your GPU in the browser: it is free, needs no account or
render farm, and nothing is uploaded.

- **Path Traced viewport**: choose *Path Traced* in the viewport's view-mode menu (next to
  *Perspective*), the **Render** toolbar menu, or `r.pathtrace 1`. The view refines while you
  look around and restarts when you edit blocks, actors or the sky.
- **Render Image** (`Alt+R`): renders the current viewport camera at up to 8K. Resolution presets
  run from 720p to 4K plus square and vertical, and you set the sample count. The finished image
  saves as PNG or copies to the clipboard.
- **Render Animation**: a turntable orbit around what the viewport is looking at, or a time-lapse
  of the day cycle. Output is WebM video (WebCodecs VP9/VP8 with exact frame timing; MediaRecorder
  fallback), a ZIP of PNG frames, or both.

What it simulates: global illumination with multiple bounces, soft sun shadows (adjustable sun
size), GGX glossy and metallic reflections, glass/water/slime refraction with Fresnel and
absorption, light scattering in water, torches and point lights, glowing blocks as area lights,
depth of field with autofocus, the level's sky, clouds, stars and fog. Frames are progressively
accumulated and cleaned by an edge-aware denoiser guided by normals, depth and albedo. ACES,
Reinhard or linear tone mapping.

How it works (`src/render/rt-scene.js`, `src/render/pathtracer.js`):

- Voxels are uploaded as a 3D texture and traversed with a two-level DDA that skips empty
  4³ bricks. Actor meshes, including instanced foliage, are flattened into a binned-SAH BVH.
- Block surfaces use the same procedural GLSL as the raster renderer, so both match.
- Every pixel keeps a running average of independent samples in float render targets. Work is
  split into tiles and throttled with GPU fences so the editor stays responsive.

Render settings (samples, bounces, camera, lighting, color, animation) are saved with the project.
The path tracer needs WebGL2 with `EXT_color_buffer_float`, which current desktop and mobile
browsers support. Packaged games do not include it.

## Level scripting

Each level has a JavaScript Level Script that runs when play starts:

```js
on('coin', () => { if (game.coins === game.coinsTotal) hud.message('All coins!', 3); });
on('trigger:bossRoom', () => spawn('enemy', 0, 5, 0, { variant: 'flyer', health: 5 }));
every(30, () => hud.message('Time left: ' + Math.round(120 - game.time), 2));
```

The full API is listed beside the editor in the Level Script tab. Runtime errors appear in
the Output Log with line numbers.

## Packaging

**Platforms ▸ Package Project** produces one self-contained `.html` file: the runtime
modules, three.js and your level. It runs offline, including from `file://`. Every module
is registered as a function, and the packager rebuilds the runtime from each function's
source text (`Function#toString`), so packaging needs no network or file access. Editor code
is excluded from packaged games.

## Project layout

```
index.html            editor shell
css/editor.css        UE5-style dark theme
src/boot.js           module registry + bundler
src/core/             util, blocks, world (chunks, raycast, serialization), actors
src/render/           voxel shader, mesher, sky, engine (renderer, world view, particles),
                      path tracer: rt-scene (scene packing, BVH), pathtracer (WebGL2),
                      render-output (resolutions, animation paths, ZIP and WebM writers)
src/runtime/          input/audio/physics, HUD, game session + scripting, standalone player
src/editor/           UI kit, editor core (history, gizmo, tools, PIE), panels, templates,
                      render-studio (Path Traced viewport, Render window), app
vendor/               three.js r128 (wrapped for the registry), lucide icons (editor only)
```

`src/assets`, `src/core/{asset-registry,log,random,uuid}.js`, `src/input`, `src/physics`,
`src/render/{contracts,renderer,three-webgl-renderer}.js`, `src/audio`, `src/network` and
`src/world` are backend-neutral ES modules (renderer/physics/input/network contracts, UUID asset
registry, seeded RNG, structured log, scene format) covered by the Node test suite. The v3
editor does not use them yet.

The console API is exposed as `window.GK` (e.g. `GK.editor`, `GK.App`, `GK.World`).

## Development

No build step is needed. The editor is plain `<script>` files, so `index.html` works over
http(s) and when opened directly from disk:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

| Command | What it does |
| --- | --- |
| `npm test` | Node unit tests (`test/*.test.js`) |
| `npm run lint` | Syntax-checks every source and tool file |
| `npm run format:check` | Prettier check for config, workflows, docs and browser tests |
| `npm run build` | Validates and cooks `assets/`, writes `dist/browser/` including `GamerKraft_Editor.html`, a single-file offline editor |
| `npm run test:smoke` | Playwright smoke tests against `dist/browser` (set `GK_CHROMIUM` to use a system Chromium) |

Contribution workflow and history: [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

## Deployment

Pushes to `main` run the quality gate, then deploy `dist/browser` to GitHub Pages
(`.github/workflows/pages.yml`). The deployed `index.html` is the single-file editor, so the
page and engine always update atomically.

## Save format

Projects are JSON (`.gkproj`): `{ format, version: 3, meta, world: { size, height, chunks }, actors, settings, script }`.
`settings.render` holds the render settings; older projects get the defaults.
Chunks are run-length encoded, base64 16³ voxel arrays. Levels from GamerKraft v1/v2 are
imported and migrated automatically (File ▸ Import, or the v2 browser autosave on first launch).
