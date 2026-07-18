# GamerKraft 3D architecture

## Runtime composition

`src/main.js` starts the application. `src/core/application.js` composes the selected editor or runtime target, while `src/editor/` provides authoring behavior and `src/runtime/` runs play mode, saving, and standalone export. `index.html` remains a thin browser entry point.

## Domain boundaries

- `src/assets/` describes block catalogs and asset definitions; `src/core/asset-registry.js` gives assets stable UUID-backed identities.
- `src/world/` owns scene data, importing, and world systems.
- `src/input/` converts device state into semantic, tick-indexed actions.
- `src/physics/` owns the voxel AABB implementation behind physics contracts.
- `src/render/` presents renderer contracts and the Three.js WebGL backend.
- `src/audio/` and `src/network/` expose backend-neutral contracts for future implementations.
- `src/ui/` owns browser-facing UI coordination.

Data flows from input into fixed-timestep runtime simulation, then into render submission. Scene files serialize authored entities and components only: renderer, physics, and audio state are rebuilt from that data rather than persisted.

## Build and deployment

`tools/gk-build.mjs` validates asset metadata, cooks derived metadata into `dist/derived`, and copies the runnable website to `dist/browser`. The Pages workflow uploads only `dist/browser`; source, tests, and repository metadata never become the deployed artifact.

## Quality boundaries

Node module tests cover contracts and asset registry behavior. A Playwright smoke test opens the generated browser artifact and confirms the public `window.GK` API is available. These checks, formatting, linting, and package verification are required before a Pages deployment.
