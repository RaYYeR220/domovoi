# Reviewing Domovoi in five minutes

## On a Quest 3 / 3S

1. Sit somewhere you can see a table or a shelf. If the headset has never scanned this room, Space Setup helps the spirit a lot. Without it, the spirit hangs a few little shelves of its own.
2. Open **LIVE_URL** in Meta Quest Browser and press **Begin the night**. Allow hand tracking and spatial data when asked.
3. Watch the spirit set its things out around you. You don't need to read anything; the hint below your view tells you the two moves.
4. **Look away** (to the side, not behind you). Within a few seconds, something changes where you weren't looking.
5. **Look back and make a frame** with both hands (thumbs and index fingers in an L, like a film director). Hold it still for half a second. The photo develops in front of you, the change is put right, and the photo flies to the cork board on your wall.
   - One-hand alternative: look at the change and pinch, or tap your thumb on your index finger.
6. A full night is about 7 minutes. For a quicker look, open **LIVE_URL?length=90** for a 90-second night that ends at dawn with the result card.

## Things worth trying

| Try | What to look for |
|---|---|
| Look away while your real lamp is out of view | The lamp glows when you look back. The spirit used *your* lamp. |
| Accuse something that didn't change | The spirit giggles from behind you and gets a little bolder. |
| `?eyes=1` | Eyes-only mode: no hand gestures. Hold your gaze on a change. Looking around is never held against you. |
| `?fov=glasses` (desktop emulator) | The Meta VR Glasses field of view: bigger blind spots, a bolder spirit. |
| The dawn card → *Share this night* | A QR code. The same night plays out in someone else's room. |
| Come back the next day | The board is still on the same wall (persistent anchor), with yesterday's photos. A new night, a longer streak, maybe a gift. |

## On a desktop browser (no headset)

The page runs in the Immersive Web Emulator: `npm install && npm run dev` opens a managed browser with an emulated Quest 3 in a furnished room. The automated runs in `tests/e2e/` play whole nights there (see [CHALLENGE_CHECKLIST.md](CHALLENGE_CHECKLIST.md)).

## Evidence

- [CHALLENGE_CHECKLIST.md](CHALLENGE_CHECKLIST.md): each judging criterion mapped to code, tests and footage.
- [CLAIMS.md](CLAIMS.md): every claim we make, with how it's backed.
- `npm test`: unit tests for the game core (attention, night director, hand frame, placement, progress).
- `results/rooms.json`: the room sweep, every built-in emulator room furnished and played.
