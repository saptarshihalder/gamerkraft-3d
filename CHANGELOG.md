# Changelog

All notable changes to GamerKraft 3D are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed (breaking)

- The editor is now GamerKraft Engine 3, a rewrite with an Unreal Engine 5-style workflow. It replaces the previous single-page editor (`src/main.js`, `src/runtime/engine.js` and its targets). The `window.GK` API changed: use `GK.editor`, `GK.App`, `GK.World` and `GK.editor.pie.game`.
- Projects are saved as v3 `.gkproj` JSON (chunked voxels, actors, settings, script). v1/v2 worlds, including the v2 browser autosave, are migrated automatically on import.
- Tailwind CSS and Google Fonts are no longer dependencies; `vendor/three.min.js` is now `vendor/three.gk.js`, wrapped for the module registry.

### Added

- Share Game Link (toolbar **Share**, File and Platforms menus). The whole game is compressed into the link's `#` fragment, which browsers never send to the server, so sharing needs no account, upload or backend. A _Play_ link runs the game in a sandboxed iframe with an opaque origin, so its Level Script cannot reach the site's saved projects. A _Remix_ link opens a copy in the editor and asks whether to keep someone else's Level Script before it can run. Damaged or cut-off links show an explanation instead of a broken game.
- Projects are stored in IndexedDB instead of `localStorage` (about 5 MB), with automatic migration and a `localStorage` fallback. Saves also happen when the tab is hidden, and a failed save now says so instead of claiming success.
- Devices or browsers that can't create a WebGL context get a plain-language screen (turn on hardware acceleration, update the browser, try another device) in the editor, in packaged games and on play links, instead of a blank page.
- Touch editing for tablets: tap to use the current tool, drag with two fingers to orbit, pinch to zoom (pan and zoom in the top view).
- Unit tests for link encoding and a browser smoke test for play links, remixing and the no-3D screen.
- A real-time ray tracer that works in the editor, in Play In Editor and in packaged games. It traces voxel and actor visibility, sun and point-light shadows, reflections, refraction through glass, water and slime, ambient occlusion and (Ultra) one-bounce GI. A temporal pass antialiases and denoises it, and three.js draws helpers, particles and transparent effects on top using the traced depth. It has Low/Medium/High/Ultra presets and a resolution scale, a Ray Traced view mode, `r.raytrace` and `r.rt.quality` console commands, and a World Settings section. A project option starts packaged games with ray tracing on. Players can switch it and its quality in the pause menu, and their choice is remembered.
- A two-level BVH (shared per-geometry BLASes placed by instances under a per-frame TLAS) and tracing GLSL shared by the ray tracer and the path tracer.
- An MIT `LICENSE` file (the project already declared MIT). It is also published with the site, packaged games carry a license notice, and the README lists third-party licenses.
- A built-in path tracer written directly against WebGL2. It renders voxels (two-level DDA over a 3D texture) and actor meshes (SAH BVH) with global illumination, soft shadows, GGX reflections, refraction through glass, water and slime, water scattering, torch and glowing-block lighting, depth of field, the level's sky and fog, and an edge-aware denoiser.
- A Path Traced viewport mode that refines progressively and follows edits live.
- A Render window (`Alt+R`, **Render** menu and toolbar) for still images up to 8K, saved as PNG or copied to the clipboard.
- Animation rendering: turntables and day-cycle time-lapses, output as WebM video (WebCodecs with exact frame timing, MediaRecorder fallback) and/or a ZIP of PNG frames.
- Render settings are saved with each project (`settings.render`). New console commands: `render [samples]` and `r.pathtrace 0|1`.
- Unit tests for scene packing, the BVH, the ZIP and WebM writers and animation cameras, and a browser smoke test that renders a still, an animation and the viewport.
- Editor modes (Selection, Build, Landscape, Foliage), a move/rotate/scale gizmo with snapping, and block tools (brush, box, erase, paint, flood fill, eyedropper).
- Terrain sculpting and a procedural terrain generator with five biomes.
- Transactional undo/redo, Play In Editor with exact level rollback, Play From Here, Map Check, a top orthographic view, and lit/unlit/wireframe view modes.
- A Project Browser with eight templates (Blank, Third Person Platformer, First Person Arena, Parkour Tower, Coin Rush, Dungeon Crawler, Survival Island, Sandbox Builder), multi-project storage and autosave.
- Rendering: chunked voxel meshing with baked ambient occlusion, 42 procedurally shaded blocks, a dynamic sky with time of day, pooled point lights and GPU-instanced foliage.
- Gameplay: 35 actor types (enemies, turrets, spawners, platforms, keyed doors, teleporters, trigger volumes and more), fixed-step physics, a HUD with minimap, gamepad and touch input, and procedural audio and music.
- A Level Script API with runtime error reporting in the Output Log.
- Single-file offline packaging. The runtime is rebuilt from the module registry, so packaging also works from `file://`.
- `npm run lint` now syntax-checks every file in `src/` and `tools/`. New unit tests cover the v3 core, and the browser smoke tests now target the v3 editor.

### Removed

- The previous editor application and its standalone boot expression (`STANDALONE_BOOT`). The backend-neutral contract modules (renderer, input, physics, network, assets, scene, log, RNG, UUID) and the ES-module bundler are kept and still tested.

### Added

- Unreal-style editor shell: World Outliner (live per-type counts, click to jump between instances), Details inspector with Focus/Replace/Delete, a Select tool (`Q`) with selection highlight, `F` camera focus, `Del` to delete, Content Browser with category tabs and live search, a status bar with live engine stats, and a graphite professional theme.
- Editor fly camera is now Unreal-style: WASD/QE fly only while the right mouse button is held, freeing `Q` for the Select tool.

### Changed

- Block definitions gained a `category` field that drives the Content Browser grouping.

- Runtime developer console (`` ` `` to toggle) with commands: `help`, `stats`, `log`, `loglevel`, `generate`, `mapsize`, `mode`, `tp`, `heal`, `give` — available in the editor and in exported games (world-altering commands stay editor-only).
- Structured engine logging (`GK.Log`) with categories, severity levels, a ring buffer, and listeners; warnings and errors surface in the console.
- Deterministic seeded RNG (`GK.Random.createRng` / `toSeed`) — mulberry32, unit-tested.
- Procedural terrain generator: seeded value-noise hills with water, stone/dirt/grass layers, trees, coins, gems, and a guaranteed start pad and goal; runs as one undoable editor action via the new sidebar button, `generate [seed]`, or `GK.generateWorld(seed)`.

- Collaboration documentation, repository templates, release process, and automated quality/deployment workflows.
- Browser smoke tests covering the publish pipeline (standalone export opened from `file://`) and project save/load round trips.
- `npm run build` now also produces `dist/browser/GamerKraft_Editor.html`, a double-clickable single-file editor with the vendors and flattened engine inlined. It boots and publishes games entirely offline; publishing from it skips refetching and reuses its own inline bundle.
- Opening `index.html` directly from disk now shows an explanation (browsers block ES modules on `file://`) instead of a dead UI whose buttons silently do nothing.
- The module flattener is a shared, DOM-free module (`src/runtime/module-bundler.js`) used by both the in-browser publisher and the build tool, with unit tests over the real engine graph.

### Fixed

- Opening a project now applies its sky and time of day to the viewport. Before, the previous project's environment stayed until a sky setting changed.
- A deploy can no longer half-break the live editor: the deployed `index.html` is now the same fully inlined single-file build as the offline editor, so page markup and engine update atomically and caches cannot serve a mixed version. The engine also null-guards the status bar and developer console so stale cached markup degrades gracefully instead of killing the frame loop.

- Published games are playable again: the exporter now bundles the engine's whole module graph into the standalone HTML file instead of embedding only `engine.js`, whose relative imports cannot resolve outside the repository.
- Loading a saved project no longer fails: the load path accepts the version 3 scene documents that saving produces (and still accepts legacy voxel payloads), and validates files before clearing the current world.

## [0.1.0] - 2026-07-18

### Added

- Browser-based voxel editor, runtime, asset cooking pipeline, and backend-neutral subsystem contracts.
