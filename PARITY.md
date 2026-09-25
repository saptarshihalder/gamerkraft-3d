# Engine parity audit — GamerKraft vs. the full engine component map

An honest inventory of where GamerKraft stands against the complete feature
map of a AAA engine (Unreal-class), and the strategy that follows from it.

## Positioning

GamerKraft does not try to be "Unreal, but rebuilt." It competes on **one
decisive dimension: the web**. Zero install, boots in any browser in seconds,
and ships games as a single HTML file that runs anywhere — even offline from
`file://`. Unreal cannot match that workflow; nothing in its pipeline goes
from idea to shareable playable link in under a minute. Every roadmap
decision below protects that advantage first and widens coverage second.

Competitive dimensions (from the standard six): **Workflow** (instant
iteration, one-click publish), **Simplicity** (one scripting API, no hidden
systems), and **Deployment** (single-file builds measured in megabytes) are
the chosen battlegrounds. Raw rendering performance parity with native
engines is explicitly not the goal.

## Status by component area

Legend: ✅ solid for a browser engine today · 🟡 partial / foundations laid ·
❌ not started · ⏩ deliberately out of scope for the web-first strategy.

| #   | Area                           | Status | Notes                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Core runtime                   | 🟡     | Fixed-timestep loop, config/settings, autosave, GUID assets, structured categorized logging, deterministic seeded RNG, runtime developer console with commands. Missing: job system, memory tracking, hot reload, reflection.                                                                                                                        |
| 2   | Object/entity model            | 🟡     | UUID entities with components (v3 scenes), terrain component, item/entity runtime split. Missing: hierarchy transforms in gameplay, prefabs, pooling, lifecycle hooks.                                                                                                                                                                               |
| 3   | Scene & world                  | 🟡     | Versioned scene documents, legacy import, map resize with pruning, procedural terrain generation. Missing: streaming, additive scenes, LOD/HLOD, large-coordinate support.                                                                                                                                                                           |
| 4   | Rendering                      | 🟡     | Backend-neutral renderer contract (Three.js/WebGL backend), instanced pools (10k blocks ≈ 20 draw calls), shadows, fog, render diagnostics. Missing: WebGPU backend, deferred/GI, post-processing stack.                                                                                                                                             |
| 5   | Camera                         | 🟡     | First/third person, editor fly camera, FOV/view-distance settings, compass. Missing: cinematic cameras, blending, render-to-texture.                                                                                                                                                                                                                 |
| 6   | Physics                        | 🟡     | Swept AABB voxel collision behind a backend-neutral query API, character controller (coyote time, water, ladders, ice), knockback. Missing: rigid bodies, joints, ragdolls, vehicles.                                                                                                                                                                |
| 7   | Character animation            | ❌     | Procedural item spin and avatar orientation only. No skeletal animation.                                                                                                                                                                                                                                                                             |
| 8   | VFX                            | 🟡     | Instanced particle pool with bursts, per-event effects, scalability toggle. Missing: authoring graph, GPU sim, trails/beams.                                                                                                                                                                                                                         |
| 9   | Audio                          | 🟡     | Procedural WebAudio synth, master gain, event SFX. Missing: spatialization, buses/submixes, music system, asset streaming.                                                                                                                                                                                                                           |
| 10  | Input                          | ✅     | Semantic action maps (no hardcoded keys in simulation), tick-indexed replay buffer, keyboard/mouse/pointer-lock. Missing: gamepad, touch, rebinding UI.                                                                                                                                                                                              |
| 11  | UI                             | 🟡     | Full editor chrome, HUD, overlays, settings, notifications, tutorial. Missing: world-space UI toolkit for games, data binding, localization.                                                                                                                                                                                                         |
| 12  | Gameplay programming           | 🟡     | Public scripting API (`window.GK`), developer console commands. Missing: user scripting language/sandbox, visual scripting.                                                                                                                                                                                                                          |
| 13  | Gameplay framework             | 🟡     | Modes, spawn/checkpoint/respawn, health/damage, score, pickups, win/lose flow, cheats console. Missing: abilities, inventory, quests, save-game slots.                                                                                                                                                                                               |
| 14  | AI                             | 🟡     | Chase enemies with wall avoidance, turret targeting with cooldowns. Missing: navmesh, behaviour trees, perception.                                                                                                                                                                                                                                   |
| 15  | Networking                     | 🟡     | Authority-aware replication contracts and deterministic tick inputs exist; no live netcode yet. Design-first so multiplayer isn't bolted on later.                                                                                                                                                                                                   |
| 16  | Asset pipeline                 | 🟡     | GUID asset metadata, importer validation, cooking to derived data, manifest, browser deployment. Missing: mesh/texture import (glTF), thumbnails, dependency UI.                                                                                                                                                                                     |
| 17  | Visual editor                  | 🟡     | Unreal-style shell: world outliner with live per-type counts and jump-to-instance, details inspector (focus/replace/delete), select tool with highlight, content browser with categories + search, status bar, tools (brush/box/eraser/eyedropper), undo/redo, play-in-editor, tutorial, settings. Missing: transform gizmos, docking, multi-select. |
| 18  | Terrain & procedural           | 🟡     | Deterministic seeded terrain generator (hills, water, layers, decoration, guaranteed start/goal), undoable. Missing: sculpting brushes, biomes, erosion.                                                                                                                                                                                             |
| 19  | Modelling tools                | ⏩     | Voxel-first engine; block editing is the modelling tool. Mesh editing deferred until mesh import exists.                                                                                                                                                                                                                                             |
| 20  | Cinematics                     | ❌     | Not started.                                                                                                                                                                                                                                                                                                                                         |
| 21  | Build & deployment             | ✅     | One-command build, asset cooking, single-file offline editor, single-file game export that runs from `file://`, CI, Pages deploy. This is the flagship.                                                                                                                                                                                              |
| 22  | Debugging & profiling          | 🟡     | Debug overlay (draw calls, tris, FPS, entity counts), structured log with levels, console `stats`/`log`, renderer diagnostics API. Missing: frame profiler, memory tracking, flame charts.                                                                                                                                                           |
| 23  | Testing & reliability          | ✅     | Unit tests (physics, scenes, bundler, RNG, terrain, log), browser automation of real user flows (publish, save/load, console, offline), CI gates on every PR.                                                                                                                                                                                        |
| 24  | Platform support               | 🟡     | Every OS with a modern browser, plus offline single-file builds. Missing: mobile touch controls, gamepad; consoles are ⏩.                                                                                                                                                                                                                           |
| 25  | Collaboration & source control | 🟡     | Text-based scene JSON (diffable), per-project files, GitHub workflows. Missing: asset locks, multi-user editing.                                                                                                                                                                                                                                     |
| 26  | Localization & accessibility   | ❌     | English-only; settings cover volume/motion basics. Not started in earnest.                                                                                                                                                                                                                                                                           |
| 27  | Plugin ecosystem               | ❌     | Public `GK` API and console command registry are extension seams; no plugin loader yet.                                                                                                                                                                                                                                                              |
| 28  | Online services                | ⏩     | Out of scope until networking lands.                                                                                                                                                                                                                                                                                                                 |
| 29  | Documentation                  | 🟡     | README, architecture, roadmap, changelog, contributor docs, in-app tutorial. Missing: full API reference, video tutorials.                                                                                                                                                                                                                           |
| 30  | Security & commercial          | 🟡     | No arbitrary eval in the console, importer validation, MIT license. Formal policies deferred.                                                                                                                                                                                                                                                        |

## What "Phase 1 — capable of shipping a small game" requires vs. reality

Of the fourteen Phase-1 requirements, GamerKraft has: core runtime and
component model, renderer, scene hierarchy (data-level), asset importing
(catalog-level), input, physics, audio, scripted gameplay (GK API + console),
basic UI, scene editor, play-in-editor, save/load, packaging (better than
required: single-file web + offline), and logging + draw-call diagnostics.
**Phase 1 is effectively complete for the voxel-game genre.** The engine
demonstrably ships playable, shareable games today.

## Next milestones (in priority order)

1. **Block/entity behaviour scripting** — a sandboxed event-action system so
   creators add game logic without code; the seed of visual scripting (#12).
2. **Gamepad and touch input** — completes #10 and unlocks mobile browsers (#24).
3. **glTF mesh import** — the asset pipeline's biggest gap (#16, #19).
4. **Spatial audio + music layer** (#9).
5. **Multiplayer replication on the existing contracts** — deterministic tick
   inputs and authority model are already in place (#15).
6. **WebGPU renderer backend** behind the existing renderer contract (#4).
7. **Profiler panel** — frame-time graph and per-system budgets (#22).
