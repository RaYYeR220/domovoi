// Production build smoke test in a plain browser (no XR): the start page loads,
// "Begin the night" falls back to the "open in Meta Quest Browser" dialog with a QR.
// Usage: npm run build && npx vite preview --port 4391  then  node tests/e2e/prod-landing.mjs [outDir]
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'tests/e2e/out';
const browser = await chromium.launch();
const errors = [];
for (const [name, viewport] of [['desktop', { width: 1280, height: 720 }], ['wide', { width: 1920, height: 1080 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push(`${name}: ${m.text()}`));
  await page.goto('https://localhost:4391/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/prod-${name}.png` });
  if (name === 'desktop') {
    await page.mouse.move(100, 600);
    await page.waitForTimeout(2500);
    await page.mouse.move(640, 600);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/prod-desktop-after.png` });
    await page.click('button[data-begin]');
    await page.waitForTimeout(800);
    const dialogOpen = await page.evaluate(() => document.querySelector('#qdlg')?.open);
    const hasQr = await page.evaluate(() => Boolean(document.querySelector('#qdlg .qr svg')));
    console.log(`dialog open: ${dialogOpen}, real QR: ${hasQr}`);
    await page.screenshot({ path: `${out}/prod-dialog.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log(`horizontal overflow: ${overflow}`);
  }
  await page.close();
}
await browser.close();
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
