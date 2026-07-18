# Changelog

All notable changes to GamerKraft 3D are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Collaboration documentation, repository templates, release process, and automated quality/deployment workflows.
- Browser smoke tests covering the publish pipeline (standalone export opened from `file://`) and project save/load round trips.

### Fixed

- Published games are playable again: the exporter now bundles the engine's whole module graph into the standalone HTML file instead of embedding only `engine.js`, whose relative imports cannot resolve outside the repository.
- Loading a saved project no longer fails: the load path accepts the version 3 scene documents that saving produces (and still accepts legacy voxel payloads), and validates files before clearing the current world.

## [0.1.0] - 2026-07-18

### Added

- Browser-based voxel editor, runtime, asset cooking pipeline, and backend-neutral subsystem contracts.
