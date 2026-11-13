/**
 * Furnish the current emulator room and report what the spirit found and did.
 * Used by the room sweep (every built-in room, none of them tuned for).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run({ page, frame, workspaceRoot }) {
  const app = frame ?? page;
  const room = JSON.parse(readFileSync(join(workspaceRoot, 'iwsdk.config.json'), 'utf8')).dev.emulator.environment;
  const out = join(workspaceRoot, 'tests', 'e2e', 'out', 'rooms');
  mkdirSync(out, { recursive: true });
  const remote = (cmd, args = {}) => app.evaluate(([c, a]) => window.IWER_DEVICE.remote.dispatch(c, a), [cmd, args]);
  const game = (fn) => app.evaluate(fn);

  const status = await remote('get_session_status');
  if (!status?.sessionActive) await remote('accept_session');
  await remote('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await remote('set_input_mode', { mode: 'hand' });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const phase = await game(() => window.__domovoi?.phase);
    if (phase === 'night') break;
    await sleep(500);
  }
  await page.screenshot({ path: join(out, `${room}-front.png`) });
  // Glance around; whenever something has changed, look at it and pinch to catch it.
  const tricks = [];
  const caught = new Set();
  const yaws = [0.6428, -0.6428, 0.34, -0.34];
  let k = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < 62000) {
    const active = await game(() => window.__domovoi.activeTricks());
    for (const a of active) if (!tricks.some((t) => t.id === a.id)) tricks.push({ id: a.id, kind: a.kind, target: a.targetId });
    const next = active.find((a) => !caught.has(a.id));
    if (next && next.points[0]) {
      await remote('look_at', { device: 'headset', target: next.points[0] });
      await sleep(400);
      await remote('set_select_value', { device: 'hand-right', value: 1, duration: 0.1 });
      await sleep(450);
      await remote('set_select_value', { device: 'hand-right', value: 0, duration: 0.1 });
      caught.add(next.id);
      await sleep(400);
    } else {
      const y = yaws[k++ % yaws.length];
      await remote('set_transform', { device: 'headset', orientation: { x: 0, y, z: 0, w: Math.sqrt(1 - y * y) } });
      await sleep(2500);
    }
  }
  const report = await game(() => window.__domovoi.roomReport());
  const result = { room, ...report, tricks, caughtByProbe: caught.size };
  writeFileSync(join(out, `${room}.json`), JSON.stringify(result, null, 2));
  return JSON.stringify(result);
}
