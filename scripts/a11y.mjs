// Runs axe-core across many role × page combinations in light and dark schemes.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const axe = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const EXE = process.env.CHROMIUM_PATH || undefined;
import { previewUrl as url, previewAs } from './preview-role.mjs';
const browser = await chromium.launch({ executablePath: EXE });
const plan = { student: ['/dashboard', '/programs', '/programs/ai', '/course/WEB302', '/paths', '/arena', '/certificates', '/placement', '/jobs', '/interview', '/portfolio', '/mentors', '/discussions', '/discussions/TH-1', '/groups', '/me'], ceo: ['/admin/exec', '/admin/reports', '/ops/fees'], admin: ['/ops/students', '/ops/students/S1001', '/ops/admissions', '/ops/cohorts', '/ops/attendance', '/admin/users', '/admin/audit', '/admin/settings'], director: ['/ops/courses', '/ops/courses/WEB301', '/ops/risk', '/assessments', '/admin/orgs/ORG-NW'], instructor: ['/ops/teaching', '/projects', '/live'], superadmin: ['/admin/permissions', '/admin/integrations'], corporate: ['/corporate'], placement: ['/ops/placements'], mentor: ['/mentors'] };
const out = new Map();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(url + '#/'); await page.waitForTimeout(500);
  for (const [role, paths] of Object.entries(plan)) {
    await previewAs(page, role);
    for (const p of paths) {
      await page.evaluate((h) => { location.hash = h; }, p); await page.waitForTimeout(150);
      if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axe });
      const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => ({ id: x.id, n: x.nodes.length, t: String(x.nodes[0].target), html: x.nodes[0].html.slice(0, 120), msg: x.nodes[0].failureSummary?.split('\n')[1] })));
      for (const x of v) { const k = `${scheme} ${x.id}`; if (!out.has(k)) out.set(k, []); out.get(k).push(`${role} ${p} (${x.n}) ${x.t} :: ${x.html} :: ${x.msg || ''}`); }
    }
  }
  await ctx.close();
}
// The real sign-in flow and the accounts console, served by the AVGENX server.
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { openDb } = await import('../server/db.mjs');
const { createApp } = await import('../server/app.mjs');
const { seedDev } = await import('../server/cli.mjs');
const dir = mkdtempSync(join(tmpdir(), 'avgenx-a11y-'));
const db = openDb(join(dir, 'a11y.db'));
const accts = await seedDev(db);
const server = createApp({ db, log: { error() {}, log() {} } }).listen(0);
const B = `http://127.0.0.1:${server.address().port}`;
const sa = accts.find((a) => a.role === 'superadmin');
const SA_FIRST = sa.password; // temporary password from the seed
let serverPages = 0;
for (const scheme of ['light', 'dark']) {
  for (const width of [1360, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true }); // only so axe can be injected
    const page = await ctx.newPage();
    const scan = async (label) => {
      if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axe });
      const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => ({ id: x.id, t: x.help, n: x.nodes.length, html: x.nodes[0]?.html?.slice(0, 160) })));
      serverPages++;
      for (const x of v) { const k = `${scheme} ${x.id}`; if (!out.has(k)) out.set(k, []); out.get(k).push(`server ${label} @${width} (${x.n}) ${x.t} :: ${x.html}`); }
    };
    await page.goto(B + '/'); await page.waitForSelector('#role'); await page.waitForTimeout(2600); await scan('sign-in');
    await page.selectOption('#role', 'student'); await page.fill('#identifier', 'nobody'); await page.fill('#password', 'Wrong-password-1'); await page.click('button.primary'); await page.waitForSelector('.alert'); await scan('sign-in error');
    await page.click('[data-go="forgot"]'); await scan('forgot password');
    if (scheme === 'light' && width === 1360) {
      await page.goto(B + '/'); await page.waitForSelector('#role');
      await page.selectOption('#role', 'superadmin'); await page.fill('#identifier', sa.userId); await page.fill('#password', SA_FIRST); await page.click('button.primary');
      await page.waitForSelector('#current'); await scan('forced password change');
    }
    await ctx.close();
  }
}
// Accounts console as a signed-in super administrator (password changed through the API).
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, bypassCSP: true });
  const page = await ctx.newPage();
  await page.request.post(B + '/api/auth/login', { data: { role: 'superadmin', identifier: sa.userId, password: SA_FIRST }, headers: { origin: B } });
  const me = await (await page.request.get(B + '/api/auth/me')).json();
  await page.request.post(B + '/api/auth/change-password', { data: { current: SA_FIRST, next: 'Quiet-harbour-signal-58' }, headers: { origin: B, 'x-csrf-token': me.csrf } });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(B + '/#/admin/accounts'); await page.reload(); await page.waitForSelector('#main tbody tr'); await page.waitForTimeout(400);
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axe });
    for (const [label, step] of [['accounts', null], ['create panel', async () => page.click('[data-act="create"]')], ['account detail', async () => { await page.click('#drawer [data-close]'); await page.locator('#main tbody tr').first().click(); }]]) {
      if (step) { await step(); await page.waitForTimeout(250); }
      const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => ({ id: x.id, t: x.help, n: x.nodes.length, html: x.nodes[0]?.html?.slice(0, 160) })));
      serverPages++;
      for (const x of v) { const k = `${scheme} ${x.id}`; if (!out.has(k)) out.set(k, []); out.get(k).push(`server ${label} (${x.n}) ${x.t} :: ${x.html}`); }
    }
    await page.click('#drawer [data-close]').catch(() => {});
  }
  await ctx.close();
}
server.close(); db.close(); rmSync(dir, { recursive: true, force: true });

for (const [k, v] of out) console.log(`\n## ${k}\n` + v.slice(0, 6).join('\n'));
console.log(`checked ${serverPages} server pages and states plus the preview sweep`);
console.log(out.size ? `\n${out.size} violation types` : 'no serious violations');
await browser.close();
process.exit(out.size ? 1 : 0);
