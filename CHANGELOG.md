# Changelog

All notable changes to GamerKraft 3D are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Unreal-style editor shell: World Outliner (live per-type counts, click to jump between instances), Details inspector with Focus/Replace/Delete, a Select tool (`Q`) with selection highlight, `F` camera focus, `Del` to delete, Content Browser with category tabs and live search, a status bar with live engine stats, and a graphite professional theme.
- Editor fly camera is now Unreal-style: WASD/QE fly only while the right mouse button is held, freeing `Q` for the Select tool.

### Changed

- Block definitions gained a `category` field that drives the Content Browser grouping.

- Runtime developer console (`` ` `` to toggle) with commands: `help`, `stats`, `log`, `loglevel`, `generate`, `mapsize`, `mode`, `tp`, `heal`, `give` — available in the editor and in exported games (world-altering commands stay editor-only).
- Structured engine logging (`GK.Log`) with categories, severity levels, a ring buffer, and listeners; warnings and errors surface in the console.
- Deterministic seeded RNG (`GK.Random.createRng` / `toSeed`) — mulberry32, unit-tested.
- Procedural terrain generator: seeded value-noise hills with water, stone/dirt/grass layers, trees, coins, gems, and a guaranteed start pad and goal; runs as one undoable editor action via the new sidebar button, `generate [seed]`, or `GK.generateWorld(seed)`.
- `PARITY.md`: an honest component-by-component audit against the full AAA-engine feature map, plus the web-first competitive strategy and prioritized milestones.

- Collaboration documentation, repository templates, release process, and automated quality/deployment workflows.
- Browser smoke tests covering the publish pipeline (standalone export opened from `file://`) and project save/load round trips.
- `npm run build` now also produces `dist/browser/GamerKraft_Editor.html`, a double-clickable single-file editor with the vendors and flattened engine inlined. It boots and publishes games entirely offline; publishing from it skips refetching and reuses its own inline bundle.
- Opening `index.html` directly from disk now shows an explanation (browsers block ES modules on `file://`) instead of a dead UI whose buttons silently do nothing.
- The module flattener is a shared, DOM-free module (`src/runtime/module-bundler.js`) used by both the in-browser publisher and the build tool, with unit tests over the real engine graph.

### Fixed

- A deploy can no longer half-break the live editor: the deployed `index.html` is now the same fully inlined single-file build as the offline editor, so page markup and engine update atomically and caches cannot serve a mixed version. The engine also null-guards the status bar and developer console so stale cached markup degrades gracefully instead of killing the frame loop.

- Published games are playable again: the exporter now bundles the engine's whole module graph into the standalone HTML file instead of embedding only `engine.js`, whose relative imports cannot resolve outside the repository.
- Loading a saved project no longer fails: the load path accepts the version 3 scene documents that saving produces (and still accepts legacy voxel payloads), and validates files before clearing the current world.

## [0.1.0] - 2026-07-18

### Added

- Browser-based voxel editor, runtime, asset cooking pipeline, and backend-neutral subsystem contracts.
