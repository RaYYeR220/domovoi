/**
 * Builds results/rooms.json from the room sweep (tests/e2e/out/rooms/*.json)
 * and renders the table between the <!-- rooms:start/end --> markers in
 * README.md. Numbers in the README come from here, never typed by hand.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sweepDir = join(root, 'tests', 'e2e', 'out', 'rooms');
const resultsDir = join(root, 'results');
const ROOM_NAMES = {
  sunlit_living_room: 'Sunlit living room',
  home_office: 'Home office',
  conference_room: 'Conference room',
  open_office: 'Open office',
  kitchen: 'Kitchen',
  bedroom: 'Bedroom',
  music_studio: 'Music studio',
  open_studio: 'Open studio',
};
/** Rooms reported by the emulator under two names (identical scene data). */
const ALIASES = new Set(['living_room', 'meeting_room', 'office_large', 'office_small']);

/** Tricks a room allows beyond the eight that work on the spirit's own things. */
const ROOM_TRICKS = {
  lamp: 'lamp-on',
  screen: 'screen-static',
  plant: 'plant-bloom',
  wall_art: 'art-twin',
  window_frame: 'window-night',
};
function allowed(r) {
  const set = new Set(['shift', 'turn', 'vanish', 'flip', 'grow', 'shrink', 'swap', 'state']);
  for (const [label, kind] of Object.entries(ROOM_TRICKS)) if (r.realThings?.[label]) set.add(kind);
  if (r.realThings?.table || r.realThings?.shelf || r.realThings?.storage || r.syntheticShelves) set.add('appear');
  if (r.realThings?.shelf || r.realThings?.storage || r.syntheticShelves) set.add('shelf-guest');
  return set;
}

let rooms = [];
if (existsSync(sweepDir)) {
  rooms = readdirSync(sweepDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(sweepDir, f), 'utf8')))
    .filter((r) => !ALIASES.has(r.room));
} else if (existsSync(join(resultsDir, 'rooms.json'))) {
  rooms = JSON.parse(readFileSync(join(resultsDir, 'rooms.json'), 'utf8')).rooms;
}
rooms.sort((a, b) => Object.keys(ROOM_NAMES).indexOf(a.room) - Object.keys(ROOM_NAMES).indexOf(b.room));

const REAL_TRICKS = new Set(['lamp-on', 'screen-static', 'plant-bloom', 'art-twin', 'window-night', 'appear', 'shelf-guest']);
const summary = {
  generated: new Date().toISOString().slice(0, 10),
  rooms: rooms.length,
  furnished: rooms.filter((r) => r.props >= 5).length,
  boards: rooms.filter((r) => r.board === 'wall').length,
  usedOwnShelves: rooms.filter((r) => r.syntheticShelves > 0).length,
  tricks: rooms.reduce((n, r) => n + r.tricks.length, 0),
  tricksOnRealThings: rooms.reduce((n, r) => n + r.tricks.filter((t) => REAL_TRICKS.has(t.kind)).length, 0),
  trickKindsSeen: [...new Set(rooms.flatMap((r) => r.tricks.map((t) => t.kind)))].length,
};
for (const r of rooms) r.allowedTricks = allowed(r).size;

mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, 'rooms.json'), JSON.stringify({ summary, rooms }, null, 2) + '\n');

const spread = (b) => (b.length ? `${b[0]}° … ${b[b.length - 1]}°` : 'n/a');
const realList = (r) =>
  Object.entries(r.realThings ?? {})
    .map(([k, v]) => `${k.replace('_frame', '').replace('wall_art', 'art')}${v > 1 ? ` ×${v}` : ''}`)
    .join(', ') || 'none';
const lines = [
  `**${summary.furnished} of ${summary.rooms} rooms furnished**, the evidence board hung on a real wall in ${summary.boards}, ${summary.tricks} tricks played (${summary.trickKindsSeen} different kinds, ${summary.tricksOnRealThings} on the room's own things). Generated ${summary.generated} by \`tests/e2e/room-probe.mjs\` + \`npm run report\`.`,
  '',
  '| Room | Scene data | Real things the spirit can use | Props placed (bearing spread) | Tricks this room allows | Tricks seen in a 60 s probe |',
  '|---|---|---|---|---|---|',
  ...rooms.map(
    (r) =>
      `| ${ROOM_NAMES[r.room] ?? r.room} | ${r.meshes} meshes, ${r.planes} planes | ${realList(r)} | ${r.props}${r.syntheticShelves ? ` (own shelves ×${r.syntheticShelves})` : ''} (${spread(r.propBearingsDeg)}) | ${r.allowedTricks} of 15 | ${[...new Set(r.tricks.map((t) => t.kind))].join(', ') || '—'} |`,
  ),
];

const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const updated = readme.replace(
  /<!-- rooms:start -->[\s\S]*<!-- rooms:end -->/,
  `<!-- rooms:start -->\n${lines.join('\n')}\n<!-- rooms:end -->`,
);
writeFileSync(readmePath, updated);
console.log(JSON.stringify(summary));
