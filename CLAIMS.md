# Claims

Every statement on the project page, tagged with how it's backed.

- **REPRODUCIBLE** means a test or script in this repo shows it.
- **VERIFIED-EMULATOR** means it was observed in the Immersive Web Emulator, with screenshots.
- **BY DESIGN** means it is implemented, but measuring it needs a physical headset we didn't have.
- **NOT CLAIMED** means we explicitly do not claim it.

| Claim | Tier | Where |
|---|---|---|
| The spirit never changes anything you could see: only things out of view (or hidden behind furniture) for ≥ 1.2 s | REPRODUCIBLE | `src/core/night.test.ts` ("never touches something the player can see", "waits … then strikes"), `src/core/attention.test.ts` |
| Field of view is read from the headset's projection matrices each frame | REPRODUCIBLE | `fovFromProjection` + tests; `src/systems/game-system.ts` |
| 36% of a seated view is out of sight on Quest 3, 61% on Meta VR Glasses | REPRODUCIBLE | `blindFraction` test, `src/core/attention.test.ts` (solid-angle weighted, ±100° × ±50°) |
| Two-hand "L" frame detection | REPRODUCIBLE | `src/core/frame-gesture.test.ts`, run against the emulator's own `finger-gun` hand pose |
| A whole night plays to dawn: furnish → tricks → catches → result card | VERIFIED-EMULATOR | `tests/e2e/full-night.mjs` (won, 10/11 caught at `?length=45`) |
| Eyes-only mode plays a whole night without hand gestures | VERIFIED-EMULATOR | `tests/e2e/eyes-only.mjs` (won, 10/11, 0 false reports) |
| Real eye gaze is used where the device provides it | VERIFIED-EMULATOR | Meta VR Glasses emulator profile reports `gaze=eyes` |
| Tricks on the player's own lamp, screen, plant, wall art, window and shelves | VERIFIED-EMULATOR | `results/rooms.json` (tricks per room), screenshots |
| Works in rooms we never tuned for | VERIFIED-EMULATOR | room sweep over every built-in emulator room → `results/rooms.json` |
| The board hangs on a free stretch of real wall (no picture, window or door under it, no lamp or bookcase in front, clear line of sight) | REPRODUCIBLE + VERIFIED-EMULATOR | `src/core/board-spot.test.ts`; `tests/e2e/room-probe.mjs` → `board: "wall"` in all 8 rooms of `results/rooms.json` |
| Eyes-only dwell takes a photo only when something there changed | REPRODUCIBLE | `src/systems/game-system.ts` `updateDwell`, `Game.snapGaze(…, forgiving)` |
| Evidence board returns to the same wall next session | BY DESIGN | IWSDK persistent anchor + saved anchor-relative pose (`src/systems/evidence-system.ts`); persistence needs a device |
| Holds 72 fps on Quest 3 | BY DESIGN | Small draw-call budget, no shadows or post-processing, no per-frame allocation in hot paths. Not measured on hardware |
| Same daily night for everyone; share links replay a night | REPRODUCIBLE | `src/core/progress.test.ts`, `src/core/night.test.ts` (determinism) |
| Content is original or CC0 | REPRODUCIBLE | [CREDITS.md](CREDITS.md); all models and sounds CC0, fonts OFL, visuals procedural |
| The spirit photograph shows the real room's passthrough image | **NOT CLAIMED** | Web apps can't read passthrough pixels; photos render the scanned room mesh |
| Shared or colocated multiplayer | **NOT CLAIMED** | Sharing is asynchronous (the same night in another room) |
