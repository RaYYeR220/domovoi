/**
 * Eyes-only accessibility mode: no hand gestures at all. Look at a change and
 * hold your gaze; the dwell takes the photo. Shortened night (?length=45&eyes=1).
 *   npx @iwsdk/cli browser run tests/e2e/eyes-only.mjs --timeout 105000
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run({ page, frame, workspaceRoot }) {
  let app = frame ?? page;
  const out = join(workspaceRoot, 'tests', 'e2e', 'out');
  mkdirSync(out, { recursive: true });
  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });

  if (!(await app.evaluate(() => location.search.includes('eyes=1')))) {
    await app.evaluate(() => {
      localStorage.removeItem('domovoi.save.v1');
      location.search = '?length=45&eyes=1';
    });
    await sleep(6000);
    app = page.frames().find((f) => f.url().includes('eyes=1')) ?? page;
  }
  const remote = (cmd, args = {}) => app.evaluate(([c, a]) => window.IWER_DEVICE.remote.dispatch(c, a), [cmd, args]);
  const state = () =>
    app.evaluate(() => {
      const g = window.__domovoi;
      return g ? { phase: g.phase, active: g.activeTricks(), head: g.head.position, result: g.night?.final ?? null } : null;
    });

  const status = await remote('get_session_status');
  if (!status?.sessionActive) await remote('accept_session');
  // Sit facing forward before the spirit decides where the seat is.
  await remote('set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await remote('set_input_mode', { mode: 'hand' });

  const yaws = [0.6428, -0.6428, 0.3, -0.3];
  let caught = 0;
  let tries = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 95000) {
    const s = await state();
    if (!s) {
      await sleep(500);
      continue;
    }
    if (s.phase === 'dawn') break;
    if (s.phase === 'night' && s.active.length > 0) {
      const trick = s.active[0];
      const target = trick.points[0];
      await remote('look_at', { device: 'headset', target });
      await remote('set_connected', { device: 'hand-left', connected: false });
      await remote('set_connected', { device: 'hand-right', connected: false });
      await sleep(2300);
      const after = await state();
      if (after && !after.active.some((a) => a.id === trick.id)) caught++;
      if (caught === 1) await shot('eyes-01-first-catch');
    } else {
      const y = yaws[tries++ % yaws.length];
      await remote('set_transform', { device: 'headset', orientation: { x: 0, y, z: 0, w: Math.sqrt(1 - y * y) } });
      await sleep(1500);
    }
  }
  await remote('set_transform', { device: 'headset', orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(1500);
  await shot('eyes-02-dawn');
  const end = await state();
  return `phase: ${end?.phase}\ncaught by script: ${caught}\nresult: ${JSON.stringify(end?.result)}`;
}

async function frameAround(remote, eye, target) {
  const d = norm(sub(target, eye));
  const r = norm(cross(d, { x: 0, y: 1, z: 0 }));
  const u = cross(r, d);
  const C = add(eye, scale(d, 0.42));
  const A = add(C, add(scale(r, -0.1), scale(u, -0.07)));
  const B = add(C, add(scale(r, 0.1), scale(u, 0.07)));
  await remote('set_hand_pose', { device: 'hand-left', poseId: 'finger-gun', duration: 0.15 });
  await remote('set_hand_pose', { device: 'hand-right', poseId: 'finger-gun', duration: 0.15 });
  await remote('set_transform', { device: 'hand-left', anchor: 'index-finger-phalanx-proximal', position: A, orientation: { fingers: u, thumb: r } });
  await remote('set_transform', { device: 'hand-right', anchor: 'index-finger-phalanx-proximal', position: B, orientation: { fingers: scale(u, -1), thumb: scale(r, -1) } });
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
