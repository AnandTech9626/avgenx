import { chromium } from '@playwright/test';
const EXE = process.env.CHROMIUM_PATH || undefined;
import { previewUrl as url, previewAs } from './preview-role.mjs';
const [,, ...args] = process.argv;
const list = args.length ? args : ['student:/dashboard'];
const browser = await chromium.launch({ executablePath: EXE });
for (const spec of list) {
  const [role, path, mode = 'light', w = '1360'] = spec.split('|').length > 1 ? spec.split('|') : [...spec.split(':').slice(0, 1), spec.split(':').slice(1).join(':')];
  const ctx = await browser.newContext({ viewport: { width: Number(w), height: 900 }, colorScheme: mode === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(url + '#/');
  await page.waitForTimeout(500);
  await previewAs(page, role);
  await page.waitForTimeout(200);
  await page.evaluate((h) => { location.hash = h; }, path);
  await page.waitForTimeout(900);
  const name = `shots/${role}${path.replace(/[^a-z0-9]+/gi, '_')}_${mode}_${w}.png`;
  await page.screenshot({ path: name, fullPage: false });
  console.log(name);
  await ctx.close();
}
await browser.close();
