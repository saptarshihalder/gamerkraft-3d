# Verify GamerKraft Engine

Static app (no build). Serve the repo root and drive it in headless Chromium.

```bash
python3 -m http.server 8931 --bind 127.0.0.1 &   # from repo root
```

Playwright must use the pre-installed browser:
`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`. Install playwright in the
scratchpad (`npm i playwright`), never in the repo.

## Handles
- `GK.editor` — Editor (world, history, selection, startPIE/stopPIE, pick, setMode)
- `GK.App` — newProject(templateId), save(), package(opts), mapCheck(quiet), console(cmd)
- `GK.editor.pie.game` — live Game during Play In Editor; `game.update(1/60)` steps it deterministically
- Packaged game: `GK.runtime` (engine, world, game, start())

## Flows worth driving
- First launch shows the Project Browser modal (remove `.modal-back` or click a template → Create Project). A guided tour may open; click `#tour-card >> text=Skip`.
- Build mode (Shift+2): click the viewport canvas to place blocks; `V` box tool drag; Ctrl+Z/Y.
- Place Actors: click `.pa-item >> text=Coin`, then click the viewport.
- Gizmo: project `GK.editor.gizmo.root` handle positions to screen and drag with the real mouse.
- PIE: `#toolbar .tb.play`; F10 stops. Voxel edits made during PIE must be rolled back.
- Package: `GK.App.package({...})` → download → open via `file://` → click `Play`.

## Gotchas
- Software GL: ~3–10 FPS. Frame dt is capped at 0.1s, so real-time walking covers less
  distance than expected; step `game.update(1/60)` in a loop for gameplay assertions.
- Thumbnails render on a queue (~200 ms each under software GL); wait for them rather than using a fixed sleep.
- Filter `ERR_CONNECTION` / favicon console errors (sandbox network).
- Headless pointer lock is unreliable; game input can be simulated with `game.input.pressed.add('fire')`.
