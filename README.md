# GamerKraft Engine 3

A browser-based 3D game engine and level editor with an Unreal Engine–style workflow.
Build levels from voxels and actors, script gameplay, play-test in the viewport, render with
the built-in ray tracer and path tracer, and share games as links or single HTML files.

Try it at **https://saptarshihalder.github.io/gamerkraft-3d/**. It runs in the browser, so
there is nothing to install. Free and open source under the [MIT License](LICENSE).

## Sharing games

**Share** in the toolbar creates two links:

- **Play**: opens straight into the game.
- **Remix**: opens an editable copy in the editor.

The project is compressed into the URL fragment (`#play=…` / `#edit=…`), so no server or
account is involved. Shared games run in a sandboxed iframe. Remix asks before keeping another
person's Level Script. Some chat apps truncate very long links; for big worlds use
**Package Project** instead.

Projects are saved in the browser (IndexedDB). Use File ▸ Export Project File to move one to
another device.

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
- **Project Browser** — 8 templates with live-rendered thumbnails; multiple projects saved in the browser (IndexedDB) with autosave
- **Share Game Link** — Play and Remix links
- **Touch** — tap, two-finger orbit and pinch zoom on tablets
- **Play In Editor** — play-test in the viewport; the level is restored exactly on stop. *Play From Here* via right-click
- **Map Check**, copy/paste, duplicate, snap-to-floor, top orthographic view, lit/unlit/wireframe/ray traced/path traced view modes, guided tour

### Templates
Blank · Third Person Platformer · First Person Arena · Parkour Tower (Obby) · Coin Rush · Dungeon Crawler (procedural maze, keys & doors) · Survival Island · Sandbox Builder

## Engine

- **Rendering** — three.js r128, chunked voxel meshing (16³) with hidden-face culling and baked per-vertex ambient occlusion; 42 blocks with procedural shader materials (no textures); PBR lighting, ACES tone mapping, soft shadows that follow the camera, dynamic sky with sun, stars and clouds, time of day, 8 sky presets, a pooled point-light system, instanced particles, GPU-instanced foliage
- **Actors (35 types)** — player start, goal, checkpoints, jump/speed pads, teleporters, moving and crumbling platforms, keyed doors, trigger volumes, signs, coins, gems, health, keys, jetpack, double jump, spikes, saws, 4 enemy behaviours, turrets, enemy spawners, point lights, torches, crates, explosive barrels, trees, rocks, bushes, flowers, grass
- **Gameplay** — fixed 60 Hz physics with swept AABB collision against voxels and moving colliders; coyote time, jump buffering, variable jump height, sprint, swimming, ladders, ice, slime bounce, lava; health, lives, knockback, stomp attacks, shooting, in-game building with a hotbar; 5 win conditions (reach goal, collect all, defeat all, survive, sandbox) with optional time limits
- **Input** — keyboard + mouse (pointer lock), gamepad, touch controls on mobile
- **Audio** — procedural sound effects and 4 generative music tracks (WebAudio, no assets)
- **HUD** — health, lives, score, coins, timer, objective, keys, jetpack fuel, minimap, pause menu with settings, victory/defeat screens with best times

## Ray tracing

`src/render/raytracer.js` is a real-time hybrid ray tracer for WebGL2. It works in the editor
viewport, in Play In Editor and in packaged games.

- Enable it with the *Ray Traced* view mode, the **Render** menu or `r.raytrace 1`.
- Presets: Low, Medium, High, Ultra (`r.rt.quality`), plus a resolution override.
- *On in Games by Default* (World Settings ▸ Ray Tracing) starts packaged games with it on.
  Players can toggle it and change quality in the pause menu.

It traces shadows, reflections, refraction, ambient occlusion and (Ultra) one-bounce GI, with
temporal accumulation. Actors use a two-level BVH rebuilt each frame. three.js draws
particles, transparent effects and editor helpers on top.

## Path tracing

`src/render/pathtracer.js` renders final-quality stills and animations on the GPU.

- *Path Traced* view mode (or `r.pathtrace 1`) refines progressively in the viewport.
- **Render Image** (`Alt+R`): up to 8K, saved as PNG or copied to the clipboard.
- **Render Animation**: turntable or day-cycle time-lapse, as WebM and/or a ZIP of PNG frames.

Features: multi-bounce GI, soft shadows, GGX reflections, refraction and absorption, emissive
blocks, depth of field, fog, denoising and ACES/Reinhard tone mapping. Render settings are
saved with the project. Both tracers need WebGL2 with `EXT_color_buffer_float`. Packaged
games include the ray tracer but not the path tracer.

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
src/render/           voxel shader, mesher, sky, engine, raytracer, pathtracer,
                      rt-scene / rt-glsl (shared by both tracers), render-output
src/runtime/          input/audio/physics, HUD, game session + scripting, standalone player
src/editor/           UI kit, editor core (history, gizmo, tools, PIE), panels, templates,
                      render-studio, share (game links), app
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
page and engine always update atomically. Forks hosted elsewhere should update the
`gk-public-url` meta tag in `index.html`.

## Save format

Projects are JSON (`.gkproj`): `{ format, version: 3, meta, world: { size, height, chunks }, actors, settings, script }`.
Share links carry the same JSON as `z` + base64url(deflate-raw) or, without
`CompressionStream`, `j` + base64url.
`settings.render` holds the render settings; older projects get the defaults.
Chunks are run-length encoded, base64 16³ voxel arrays. Levels from GamerKraft v1/v2 are
imported and migrated automatically (File ▸ Import, or the v2 browser autosave on first launch).

## License

[MIT](LICENSE). Games you make are yours; packaged games include a one-line MIT notice.

Third-party code:
- [three.js](https://threejs.org) r128, MIT, bundled in the editor and in packaged games.
- [Lucide](https://lucide.dev) icons, ISC, editor only.
