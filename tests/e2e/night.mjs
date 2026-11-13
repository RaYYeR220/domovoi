/**
 * End-to-end night in the IWER emulator: the spirit furnishes the room, the
 * player looks away, something changes, the player turns back and frames it
 * with both hands. Run with:
 *   npx @iwsdk/cli dev up --headless --open --allow-browser-automation
 *   npx @iwsdk/cli browser run tests/e2e/night.mjs --timeout 180000
 * Screenshots go to tests/e2e/out/.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run({ page, frame, workspaceRoot }) {
  const app = frame ?? page;
  const out = join(workspaceRoot, 'tests', 'e2e', 'out');
  mkdirSync(out, { recursive: true });
  const shot = async (name) => page.screenshot({ path: join(out, `${name}.png`) });
  const remote = (cmd, args = {}) =>
    app.evaluate(([c, a]) => window.IWER_DEVICE.remote.dispatch(c, a), [cmd, args]);
  const state = () =>
    app.evaluate(() => {
      const g = window.__domovoi;
      return g ? { phase: g.phase, active: g.activeTricks(), props: g.props.size } : null;
    });
  const waitFor = async (pred, timeoutMs, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await state();
      if (s && pred(s)) return s;
      await sleep(250);
    }
    throw new Error(`timeout waiting for ${label}`);
  };

  const status = await remote('get_session_status');
  if (!status?.sessionActive) await remote('accept_session');
  await remote('set_input_mode', { mode: 'hand' });
  await remote('set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });

  const furnished = await waitFor((s) => s.phase === 'night', 60000, 'night to begin');
  await shot('01-furnished');
  const log = [`furnished: ${furnished.props} props`];

  // Look away to the left until the spirit does something.
  await remote('set_transform', { device: 'headset', orientation: { x: 0, y: 0.6428, z: 0, w: 0.766 } }); // ~80° left
  const tricked = await waitFor((s) => s.active.length > 0, 60000, 'a trick');
  const trick = tricked.active[0];
  log.push(`trick: ${trick.kind} on ${trick.targetId}`);
  const target = trick.points[0];

  // Turn back and look at it.
  await remote('look_at', { device: 'headset', target });
  await sleep(600);
  await shot('02-changed');

  // Make the director's frame around it with two "finger gun" hands.
  const eye = await app.evaluate(() => window.__domovoi.head.position);
  const d = norm(sub(target, eye));
  const r = norm(cross(d, { x: 0, y: 1, z: 0 }));
  const u = cross(r, d);
  const C = add(eye, scale(d, 0.42));
  const W = 0.2;
  const H = 0.14;
  const A = add(C, add(scale(r, -W / 2), scale(u, -H / 2)));
  const B = add(C, add(scale(r, W / 2), scale(u, H / 2)));
  await remote('set_hand_pose', { device: 'hand-left', poseId: 'finger-gun', duration: 0.2 });
  await remote('set_hand_pose', { device: 'hand-right', poseId: 'finger-gun', duration: 0.2 });
  await remote('set_transform', {
    device: 'hand-left',
    anchor: 'index-finger-phalanx-proximal',
    position: A,
    orientation: { fingers: u, thumb: r },
  });
  await remote('set_transform', {
    device: 'hand-right',
    anchor: 'index-finger-phalanx-proximal',
    position: B,
    orientation: { fingers: scale(u, -1), thumb: scale(r, -1) },
  });
  await sleep(350);
  await shot('03-framing');
  const caught = await waitFor((s) => !s.active.some((a) => a.id === trick.id), 6000, 'the catch').catch(() => null);
  log.push(caught ? 'caught: yes' : 'caught: NO');
  await sleep(900);
  await shot('04-caught');
  await remote('set_hand_pose', { device: 'hand-left', poseId: 'default' });
  await remote('set_hand_pose', { device: 'hand-right', poseId: 'default' });
  await remote('set_transform', { device: 'hand-left', position: { x: -0.25, y: 0.9, z: -0.3 } });
  await remote('set_transform', { device: 'hand-right', position: { x: 0.25, y: 0.9, z: -0.3 } });
  await sleep(1600);
  await shot('05-developing');
  const board = await app.evaluate(() => window.__domovoi.boardAt);
  if (board) {
    await sleep(2600);
    await remote('look_at', { device: 'headset', target: board });
    await sleep(1400);
    await shot('06-board');
    log.push(`board at (${board.x.toFixed(2)}, ${board.y.toFixed(2)}, ${board.z.toFixed(2)})`);
  } else {
    log.push('board: none');
  }
  await remote('set_hand_pose', { device: 'hand-left', poseId: 'default' });
  await remote('set_hand_pose', { device: 'hand-right', poseId: 'default' });
  return log.join('\n');
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return scale(a, 1 / l);
}
