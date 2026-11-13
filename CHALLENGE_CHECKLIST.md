# Judging criteria → evidence

## Innovation & Creativity
| Criterion words | Domovoi |
|---|---|
| "uniquely leverage Meta device capabilities" | The core rule (change only what you can't see) only exists because the headset knows your gaze, your field of view and your room. See README, "Why it can only exist in mixed reality" |
| spatial depth · scene understanding | Real furniture becomes surfaces and cover. Big furniture occludes (`src/core/attention.ts` `isOccluded`) |
| hands-first · gaze | Two-hand frame is the camera; gaze + pinch; eyes-only dwell |
| passthrough · persistent anchors | The room you see is the level; the evidence board stays on your wall (`src/systems/evidence-system.ts`) |
| "to drive repeat usage" | One shared night per day (date seed), streak, trust, six gifts, the board fills up (`src/core/progress.ts`) |

## Experience Design
| Criterion words | Domovoi |
|---|---|
| seated · hands-first | Spots are limited to ±100° of the seat (`src/core/placement.ts` `maxBearing`); nothing behind the chair; no controllers anywhere |
| intuitive navigation · clear onboarding | Two text-light hint cards ("It only moves things when you look away" → "Something changed. Frame it with both hands."); the first trick is a forced, obvious one (a candle lights) |
| habit-forming purpose | Daily night + streak + gifts; see Innovation |
| "Passthrough should be purposeful … the real room should meaningfully change the experience" | Props sit on your real tops; tricks use your real lamp, screen, plant, art and window; your couch is cover. A different room is a different night (`results/rooms.json`) |
| FoV-aware design | Blind spots come from the device's projection; all reading UI sits inside the Glasses' 58° × 54° design area; `?fov=glasses` |
| ≤ 10 minutes · clean pause/resume | ~7-minute nights; the night clock pauses while the headset is off or the system menu is open (`VisibilityState`) |

## Technical Implementation
| Criterion words | Domovoi |
|---|---|
| gaze interactions | IWSDK gaze tracking; WebXR eye-gaze input used for photos and eyes-only dwell; head fallback on Quest 3 (`src/systems/game-system.ts`) |
| hand tracking | 25-joint reading with `fillPoses`; custom L-frame recogniser + shutter dwell (`src/core/frame-gesture.ts`, tested on emulator poses); pinch and microgesture thumb tap |
| passthrough · scene understanding (MRUK equivalent on web) | Plane and mesh detection with semantic labels → furniture boxes, tops, panels, occluders (`src/game/room.ts`) |
| anchoring content to planes, surfaces, room geometry | Props on real tops with contact shadows; overlays on real lamps, screens, windows and art; the board on a free stretch of real wall |
| spatial anchoring | IWSDK persistent anchor; board pose saved relative to it |
| holding up in rooms the developer never tested | Automated sweep of every built-in emulator room (`tests/e2e/room-probe.mjs` → `results/rooms.json`) |
| reliability | 56 unit tests; end-to-end nights in the emulator (`tests/e2e/`); fallbacks for no room scan (spirit's own shelves), no walls (free-standing board), no hands (eyes-only), no storage (night still plays) |
| performant (≥ 60 fps) | No shadows or post-processing; procedural visuals of ~1 draw call each; allocation-free hot paths; 72 Hz target |

## Polish & Presentation
| Criterion words | Domovoi |
|---|---|
| art direction | Warm, minimal, mysterious-cozy; realistic CC0 props so a moved teacup feels uncanny; a soft ember of a spirit; sepia "spirit photographs" |
| sound design | Quiet spatial cues where each trick happened (the only hint), catch chime, shutter, room tone, crickets, dawn birds |
| UI/UX | Gaze-following pill hints, a moon dial on your left wrist, a dawn card you poke or pinch |
