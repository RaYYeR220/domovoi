# Domovoi

**It only moves things when you're not looking.**

You know your room. You'd notice if someone moved your teacup. Wouldn't you?

Domovoi is a seated, hands-only mixed reality game for Meta Quest. A small house spirit, the *domovoi* of Slavic folklore, moves into your real room, sets its things out on your real furniture, and then plays with them, but only where you aren't looking. Turn your head and the candle on your coffee table lights itself. Look at the TV and a teacup behind you slides ten centimetres. Your real lamp switches on. Your window shows a night sky.

Make a frame with your hands, the way a film director does, and photograph what changed. A caught change is put right, and its photo is pinned to an evidence board that hangs on your real wall and is still there tomorrow. Get to dawn before the room tips.

A night takes about seven minutes. There is a new one every day, the same for everyone, played in each person's own room.

**▶ Play:** open the link in **Meta Quest Browser** on a Quest 3 or 3S and press *Begin the night*. Nothing to install.

---

## Why it can only exist in mixed reality

The game is built on one promise: **the spirit never changes anything you could have seen change.** That needs three things a headset knows and nothing else does:

- **Where you are looking, and how wide you can see.** Every frame, the field of view is read from the headset's own projection matrices, not a constant. At any moment **36% of a seated player's surroundings is out of sight on Quest 3**. On Meta VR Glasses, with their narrower view, it's **61%**. The spirit gets bolder on narrower devices because it genuinely has more room to hide.
- **What your room is made of.** Planes and labelled meshes from Space Setup become table tops, shelf tops and walls for the spirit's things. Your real lamp, screen, plant, wall art and windows become targets for its tricks. Big furniture hides what's behind it, so the spirit uses your couch as cover.
- **Your hands.** The camera is two "L" shapes held up as a frame, a gesture everyone already knows. One-hand alternatives: look and pinch, or a thumb tap.

Take the headset away and there's nothing left of the game. That's deliberate.

## How a night goes

1. **The spirit moves in.** It brings 8–9 household things (a candle, a teacup, books, a clock, a lantern…) and sets them out on your real surfaces, spread around you so some are always out of view.
2. **Look away.** Out of your sight, it slides, turns, hides, swaps, lights or tips its things, lights your lamp, fills your screen with snow, makes your plant bloom. Each trick leaves one quiet sound where it happened.
3. **Look back. Frame it.** Hold the frame still for half a second. The photo develops in front of you like a Polaroid and the change is put right.
4. **Dawn.** Five unresolved changes and the room tips. Make it to dawn and the spirit settles down. Your streak grows, and as the spirit's trust grows it leaves you small gifts.

Accusing something that didn't change emboldens the spirit. Its tricks get subtler as the night goes on and as the days go by.

## Built for Meta VR Glasses, playable today on Quest 3

- **Gaze + pinch.** Where the device reports eye gaze (Meta VR Glasses, emulators), you look and pinch. On Quest 3, the head direction stands in.
- **Field of view.** All reading UI stays inside the Glasses' 58° × 54° design area. The blind-spot model uses the device's real projection: Meta VR Glasses report 37°/37° horizontally and 25° up, 43° down.
- **Seated.** Everything happens in front of you and to your sides, nothing behind the chair. It passes the airplane-seat test.

## Accessibility

- **Eyes-only mode:** hold your gaze on something for a moment and it's photographed. No hand gestures at all. Looking around never counts against you.
- **Sound captions:** each trick's sound also appears as a caption at the edge of your view, pointing to where it came from ("a creak, to your left").
- **One hand is enough:** pinch or thumb-tap while looking, instead of the two-hand frame.

## Persistent

- The evidence board hangs on a free stretch of your real wall: nothing hanging there, nothing standing in front of it, nothing between you and it. It's held by a **persistent spatial anchor**, so tomorrow it's on the same wall.
- Photos and progress (streak, trust, gifts) stay on the device (IndexedDB and local storage). There are no accounts and no servers.
- **Share a night:** the dawn card shows a QR code for tonight's night. The same spirit with the same plan plays out differently in someone else's house.

## Rooms nobody tuned for

The spirit has to work in rooms it has never seen. Every built-in room of the Immersive Web Emulator was furnished and played by an automated run. None of them was hand-tuned.

<!-- rooms:start -->
**8 of 8 rooms furnished**, the evidence board hung on a real wall in 8, 20 tricks played (5 different kinds, 7 on the room's own things). Generated 2026-11-13 by `tests/e2e/room-probe.mjs` + `npm run report`.

| Room | Scene data | Real things the spirit can use | Props placed (bearing spread) | Tricks this room allows | Tricks seen in a 60 s probe |
|---|---|---|---|---|---|
| Sunlit living room | 14 meshes, 15 planes | couch ×2, lamp ×2, table ×3, plant, shelf ×2, screen, art ×3, door, window | 9 (-64° … 99°) | 15 of 15 | appear, vanish |
| Home office | 9 meshes, 13 planes | table ×2, screen, shelf ×2, couch, plant, art ×2, window, door | 9 (-67° … 100°) | 14 of 15 | appear, vanish, state |
| Conference room | 12 meshes, 12 planes | shelf, screen, table, art, window ×3, door | 9 (-43° … 38°) | 13 of 15 | appear, vanish |
| Open office | 16 meshes, 17 planes | table ×2, plant ×2, shelf, couch ×3, art ×2, window ×3, door | 9 (-68° … 46°) | 13 of 15 | appear, vanish, shift |
| Kitchen | 16 meshes, 14 planes | table ×4, shelf ×3, lamp, plant, art, window ×2, door | 9 (-71° … 82°) | 14 of 15 | appear, shift |
| Bedroom | 11 meshes, 14 planes | bed, table ×2, lamp ×3, shelf ×2, plant, couch, art ×2, window, door | 9 (-94° … 99°) | 14 of 15 | shift, vanish, lamp-on |
| Music studio | 13 meshes, 11 planes | plant, table ×2, lamp, shelf, couch, window, door | 9 (-81° … 88°) | 13 of 15 | vanish |
| Open studio | 3 meshes, 9 planes | plant, art, window, door | 8 (own shelves ×5) (-75° … 75°) | 13 of 15 | vanish |
<!-- rooms:end -->

## Under the hood

- **Immersive Web SDK** (Meta, WebXR): passthrough MR, plane and mesh detection with semantic labels, hand tracking, gaze tracking, anchors, spatial audio.
- **Engine-free game core** (`src/core/`) with unit tests:
  - `attention`: field of view from projection matrices, blind spots, occlusion by furniture.
  - `night`: a deterministic director over a daily seed.
  - `frame-gesture`: two-hand L-frame detection, tested against the emulator's own hand poses.
  - `placement`: spots on real furniture for a seated player.
  - `progress`: daily nights, streak, trust, gifts, share links.
- **XR layer** (`src/game/`, `src/systems/`): reads the room, places and animates props, renders the tricks, takes the spirit photographs, runs the HUD and the sound.
- **Spirit photographs:** web apps can't read passthrough pixels, so the photo is rendered from your eye through the hand frame. It shows the scanned room mesh in warm sepia with the spirit's things in it, in the manner of Victorian spirit photography.

### Run it

```sh
npm install
npm run dev          # emulator + HTTPS dev server
npm test             # unit tests
npm run build        # static build in dist/
```

Handy URL flags: `?length=90` gives a 90-second night, `?eyes=1` turns on eyes-only mode, `?fov=glasses` applies the Meta VR Glasses field of view in emulators, and `?night=<code>` plays a shared night.

## Honest limits

- The two-hand frame is tuned against the emulator's hand model. If hand tracking struggles in your light, use look-and-pinch or a thumb tap.
- Persistent anchors are per device and per browser profile. Clearing site data resets the board's spot.
- The spirit's best tricks need a room scan (Space Setup). Without one it hangs a few little shelves of its own in front of you.

## Credits

3D models and sounds are CC0. See [CREDITS.md](CREDITS.md). Code is MIT licensed.
