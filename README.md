# Pixel Touchdown

A browser arcade football game. Cute voxel animals play 7-on-7 football in a Crossy Road–style world.
You throw as the QB (Retro Bowl–style slingshot), then run with the ball carrier. On defense you pick the call
and tap the gold Star for a Super Play. Between games you run the whole team: draft, Market (free agency),
Team Cash (salary cap), injuries, Coins, buildings, coaches, the Boss, and 32 teams in NFL-style seasons and playoffs.

## Play

1. Open `index.html` in a modern browser (Chrome, Edge, Safari, Firefox). No install and no server needed.
2. Or serve the folder (good for phones on your Wi-Fi):
   ```
   python3 -m http.server 8000
   ```
   Then open `http://<your-computer-ip>:8000` on the phone.

The game saves in the browser (3 save slots + autosave). Use Saves → Export to back up a save.

## Controls

| Action | Touch | Mouse | Keyboard |
|---|---|---|---|
| Pick a play | tap a card | click a card | 1 / 2 / 3, 4 = More |
| Hike | HIKE button or swipe up | click HIKE | Space / Enter |
| Throw | pull back and let go (slingshot) | drag and release | 1–4 = quick throw to a receiver |
| Lob | hold LOB while you let go | right-button drag | hold Shift at release |
| Move | joystick (where your thumb lands) | hold left button toward the cursor | WASD / arrows |
| Sprint | Sprint button | Shift | Shift |
| Juke / Spin / Dive | buttons | buttons | Q / R / E |
| Defense: GO / Star Play | GO, then tap when the ring is green | click | Enter, then Space |
| Defense: move the Star | tap a defender | click a defender | Tab |
| Fast / Skip / Sim Drive / Auto | » / Skip / Sim Drive / Auto chips | same | F / X / D / A |
| Field goal | drag back from the kicker, or Auto | same | ← → aim, hold Space for power |
| Pause | ⏸ | ⏸ | Esc / P |

In-game help: Title → How to Play (controls, offense, defense, counter cheat sheet).

## For developers

- Plain JavaScript, no build step. Three.js r149 is in `lib/`. All code adds itself to `window.PT`.
- Docs: `docs/GAME_DESIGN.md` (rules and numbers), `docs/ARCHITECTURE.md` (code structure),
  `docs/RECONCILE.md` (binding decisions), `docs/handoff/` (per-module notes), `docs/PROGRESS.md`.
- Tests:
  ```
  node tests/run.js            # unit tests (core, league, franchise, engine, save)
  node tests/lint.js           # code rules
  node tests/sim/calibrate.js  # engine stats vs targets
  node tests/sim/seasons.js    # 10-season league soak
  cd tests/browser && npm install   # once (playwright-core)
  node tests/browser/smoke.js  # full franchise flow at 3 screen sizes
  node tests/browser/soak.js   # 3 seasons in the browser
  ```
- URL flags: `?debug=1` (FPS + quick sim buttons), `?seed=N`, `?quality=low|med|high`, `?autoplay=1`.
- Dev pages: `dev/engine.html` (2D engine viewer), `dev/render.html?zoo=1` (all 35 animals), `dev/ui.html?screen=hub`.
