# Verify GamerKraft 3D Engine

Single-file browser app (`index.html`, no build step). Verify by driving it in
headless Chromium.

## Launch

```bash
cd <repo-root>
python3 -m http.server 8931 --bind 127.0.0.1 &   # serve repo root
```

Playwright must use the pre-installed browser (version mismatch otherwise):

```js
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

Install playwright in the scratchpad, not the repo (`npm i playwright` — browser
download is skipped via env).

## Drive

The engine exposes `window.GK` (World, Editor, Player, Entities, state, setMode,
setTool, setMapSize, restartGame). Prefer real input (mouse/keyboard events on
the canvas) for editor tools and movement; use `GK` to read state and for
teleport-style test setup.

Flows worth driving:
- Boot: starter world (`Object.keys(GK.World.voxels).length` ≈ 421), no console errors
- Editor: brush click (aim at an EMPTY floor pixel, e.g. (820,520) — screen
  center hits the demo coin and *replaces* it, count stays flat), box drag,
  eraser, Ctrl+Z/Y round trip
- Play: click `#modePlay`, wait ~2 s, player lands on start pad (y≈1, onGround)
- Death: teleport far off-map (`GK.state.player.pos.set(500,5,500)`), expect GAME OVER
- Publish: `waitForEvent('download')` + click `#btn-publish` (60 s timeout — slow
  under software GL), save, open via `file://`, click START GAME, expect playable

## Gotchas

- Google Fonts request fails in the sandbox (`ERR_CONNECTION_RESET`) — filter it
  from console-error assertions; not an app bug.
- Headless GL is llvmpipe: FPS is ~10 even on small maps. Assert on DRAW CALLS
  (debug panel, expect <40 on a 10k map), never on FPS.
- Pointer lock is unreliable headless — test shooting via `GK.Player.shoot()`.
- The demo level has a jump pad at (0,1,-2): walking the player south bounces
  them ~18 blocks high and possibly onto the goal. Restart before assertions
  that assume the player is grounded.
- After GAME OVER the overlay intercepts clicks on the top bar — click
  "BACK TO EDITOR" in the overlay, not `#modeEdit`.

A full smoke script covering all of the above lived at
`scratchpad/pwtest/smoke.js` (session-local); rebuild from the flows above.
