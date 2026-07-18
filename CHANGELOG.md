# Changelog

All notable changes to GamerKraft 3D are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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

- Published games are playable again: the exporter now bundles the engine's whole module graph into the standalone HTML file instead of embedding only `engine.js`, whose relative imports cannot resolve outside the repository.
- Loading a saved project no longer fails: the load path accepts the version 3 scene documents that saving produces (and still accepts legacy voxel payloads), and validates files before clearing the current world.

## [0.1.0] - 2026-07-18

### Added

- Browser-based voxel editor, runtime, asset cooking pipeline, and backend-neutral subsystem contracts.
