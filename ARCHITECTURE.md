# GamerKraft architecture

## Runtime composition

`index.html` is the editor shell. It loads classic scripts in dependency order. Each script
registers itself with `GK.module(name, factory)` (`src/boot.js`). The registry keeps every
factory function, so `GK.bundle({ runtimeOnly: true })` can re-emit the runtime from the
functions' live source text. The packager and the offline editor build use this, and it needs
no `fetch()`, which keeps packaging working from `file://`.

| Layer     | Files                                                                                      | Shipped in packaged games |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| Bootstrap | `src/boot.js`, `vendor/three.gk.js`                                                        | yes                       |
| Core data | `src/core/{util,blocks,world,actors}.js`                                                   | yes                       |
| Rendering | `src/render/{voxel-material,mesher,sky,engine}.js`                                         | yes                       |
| Runtime   | `src/runtime/{systems,hud,game,player}.js`                                                 | yes                       |
| Editor    | `src/editor/{ui,editor,panels,templates,app}.js`, `css/editor.css`, `vendor/lucide.min.js` | no                        |

- **World** stores voxels in 16³ chunks (packed integer keys), plus actors and settings. Every
  change emits events. During play a journal records voxel edits so stopping restores the level
  exactly.
- **Engine / WorldView** turn world events into dirty chunks, then remesh within a per-frame
  time budget. Actor views are rebuilt from data, and foliage is drawn as instanced meshes.
- **Game** runs fixed 60 Hz simulation (player, enemies, movers, triggers, rules, level
  script) on top of a World and Engine. The editor's Play In Editor and packaged games use the
  same class.
- **Editor** changes the World only through `History` transactions. Panels observe world and
  editor events.

## Contract modules

`src/assets`, `src/audio`, `src/input`, `src/network`, `src/physics`, `src/world`,
`src/render/{contracts,renderer,three-webgl-renderer}.js` and
`src/core/{asset-registry,log,random,uuid}.js` are ES modules that define backend-neutral
contracts. They cover renderer passes, semantic input actions, voxel AABB physics,
replication authority, UUID asset identity and the scene format. Node tests cover them, and
`src/runtime/module-bundler.js` flattens ES module graphs. The v3 editor does not import these
modules yet. Adopting them behind the classic-script runtime is roadmap work.

## Build and deployment

`tools/gk-build.mjs` validates asset metadata, cooks derived metadata into `dist/derived`,
and writes `dist/browser`. It inlines `css/editor.css` and every `<script src>` from
`index.html` into `GamerKraft_Editor.html` (a single-file offline editor). It also deploys that
same file as `index.html`, so the page and engine update atomically. The Pages workflow uploads
only `dist/browser`.

## Quality boundaries

- `npm test`: contract modules, the module bundler, and the v3 core (world storage, raycasts,
  serialization, legacy migration, self-rebundling) loaded in a Node VM.
- `npm run lint`: syntax-checks every file in `src/` and `tools/`.
- `npm run test:smoke`: Playwright boots the built editor over http and from `file://`,
  packages a game and plays it offline, checks terrain generation is deterministic, and
  round-trips saves.
