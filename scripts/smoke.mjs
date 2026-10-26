// Visits every route as every role; reports console errors and render failures.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const ROUTES = [...readFileSync('src/views/index.js', 'utf8').matchAll(/R\('([^']+)'/g)].map((m) => ({ path: m[1] }));
const EXE = process.env.CHROMIUM_PATH || undefined;
import { previewUrl as url, previewAs } from './preview-role.mjs';
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url + '#/dashboard');
await page.waitForTimeout(800);
const roles = ['student', 'instructor', 'mentor', 'ta', 'admin', 'director', 'pm', 'placement', 'ceo', 'superadmin', 'corporate'];
const sample = { domain: 'web', id: 'WEB301', lesson: 'WEB301-L2', problem: 'two-sum', attempt: 'x', slug: 'riya-menon' };
const paths = ROUTES.map((r) => r.path.replace(/:(\w+)/g, (_, k) => (r.path.startsWith('/ops/students') ? 'S1001' : r.path.startsWith('/admin/orgs') ? 'ORG-NW' : r.path.startsWith('/projects/') ? 'PR-S1001-AS-WEB301' : r.path.startsWith('/discussions/') ? 'TH-1' : r.path.startsWith('/assessments/') && k === 'id' ? 'as-dsa-t1' : r.path.startsWith('/ops/courses/') ? 'WEB301' : r.path.startsWith('/programs/') ? 'web' : sample[k])));
let n = 0; const bad = [];
for (const role of roles) {
  await previewAs(page, role);
  await page.waitForTimeout(150);
  for (const p of paths) {
    const before = errors.length;
    await page.evaluate((h) => { location.hash = h; }, p);
    await page.waitForTimeout(60);
    const txt = await page.evaluate(() => document.querySelector('#main')?.innerText || '');
    n++;
    if (/Something went wrong on this page/.test(txt)) { const d = await page.evaluate(() => document.querySelector('#main .mono')?.innerText); bad.push(`${role} ${p}: ${d}`); }
    if (errors.length > before) bad.push(`${role} ${p}: ${errors.slice(before).map((x) => x.split('\n').slice(0, 3).join(' ')).join(' | ')}`);
  }
}
console.log(`visited ${n} role×route pages`);
console.log(bad.length ? bad.slice(0, 60).join('\n') : 'no render errors');
await browser.close();
process.exit(bad.length ? 1 : 0);
