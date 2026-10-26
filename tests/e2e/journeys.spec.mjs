// End-to-end user journeys against the static preview build (dist/preview.html): sample data,
// no server. Sign-in for the real server is covered by auth.spec.mjs.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.goto('#/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  // The preview opens on its sign-in screen; enter as a student through the real UI.
  await page.selectOption('#role', 'student');
  await page.click('button.primary');
  await page.waitForSelector('#nav a');
});
test.afterEach(async () => { expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]); });

/** Switch the preview to another role (and optionally a specific sample profile). */
async function asRole(page, role, acting) {
  await page.evaluate(([r, a]) => sessionStorage.setItem('avgenx-preview-identity', JSON.stringify({ role: r, ref: a || null })), [role, acting]);
  await page.reload();
  await page.waitForSelector('#nav a');
}
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash).then(() => page.waitForTimeout(200));
const setCode = (page, code) => page.evaluate((c) => document.querySelector('.CodeMirror').CodeMirror.setValue(c), code);

test('each role sees its own navigation and guarded routes', async ({ page }) => {
  await asRole(page, 'student');
  await expect(page.locator('#nav')).toContainText('My Dashboard');
  await expect(page.locator('#nav')).not.toContainText('Executive Analytics');
  await go(page, '/admin/exec');
  await expect(page.locator('#main')).toContainText('You do not have access');
  await asRole(page, 'ceo');
  await expect(page.locator('#nav')).toContainText('Executive Analytics');
  await expect(page.locator('#main h1')).toHaveText('Executive analytics');
});

test('lesson completion is gated by evidence and advances progress', async ({ page }) => {
  await asRole(page, 'student');
  await go(page, '/course/WEB302');
  const before = Number((await page.locator('.course-hero .hint').innerText()).match(/(\d+) of/)[1]);
  await page.locator('.course-hero .btn-primary').click();
  await page.waitForTimeout(250);
  const kind = await page.locator('.player .eyebrow').first().innerText();
  const btn = page.locator('[data-act="complete"]');
  if (/exercise/i.test(kind)) {
    // A coding exercise cannot be completed until its problem is accepted in the lab.
    await expect(btn).toBeDisabled();
    const href = await page.locator('a[href*="#/lab/"]').first().getAttribute('href');
    const pid = href.match(/lab\/([\w-]+)/)[1];
    const { PROBLEMS } = await import('../../src/data/problems.js');
    const p = PROBLEMS.find((x) => x.id === pid);
    await page.locator('a[href*="#/lab/"]').first().click();
    await page.waitForSelector('.CodeMirror');
    await setCode(page, p.solution);
    await page.locator('[data-act="submit"]').click();
    await expect(page.locator('.run-status')).toContainText('Accepted', { timeout: 8000 });
    await page.locator('a:has-text("Back to lesson")').click();
    await page.waitForTimeout(250);
  }
  await expect(btn).toBeEnabled();
  await btn.click();
  await page.waitForTimeout(250);
  await go(page, '/course/WEB302');
  const after = Number((await page.locator('.course-hero .hint').innerText()).match(/(\d+) of/)[1]);
  expect(after).toBe(before + 1);
});

test('coding lab runs JavaScript in the sandbox: accepted, wrong answer, time limit', async ({ page }) => {
  await asRole(page, 'student', 'S1010');
  await go(page, '/lab/valid-parentheses');
  await page.waitForSelector('.CodeMirror');
  await setCode(page, 'function isValid(s) { return true; }');
  await page.locator('[data-act="submit"]').click();
  await expect(page.locator('.run-status')).toContainText('Wrong Answer', { timeout: 8000 });
  await setCode(page, readFileSync('src/data/problems.js', 'utf8').includes('function isValid') ? "function isValid(s) {\n  const st = [], pair = { ')': '(', ']': '[', '}': '{' };\n  for (const c of s) {\n    if ('([{'.includes(c)) st.push(c);\n    else if (st.pop() !== pair[c]) return false;\n  }\n  return st.length === 0;\n}" : '');
  await page.locator('[data-act="run"]').click();
  await expect(page.locator('.run-status')).toContainText('Sample tests passed', { timeout: 8000 });
  await page.locator('[data-act="submit"]').click();
  await expect(page.locator('.run-status')).toContainText('Accepted', { timeout: 8000 });
  await page.locator('[data-act="leftTab"][data-id="subs"]').click();
  await expect(page.locator('#lab-left')).toContainText('Accepted');
  await setCode(page, 'function isValid(s) { while (true) {} }');
  await page.locator('[data-act="run"]').click();
  await expect(page.locator('.run-status')).toContainText('Time Limit Exceeded', { timeout: 8000 });
});

test('timed assessment: start, answer, submit with confirmation, see results', async ({ page }) => {
  await asRole(page, 'student');
  await go(page, '/assessments/as-web101');
  await page.locator('[data-act="start"]').click();
  await page.locator('#modal [data-yes]').click();
  await page.waitForSelector('.exam-timer');
  await expect(page.locator('#exam-timer')).toHaveText(/\d+:\d\d/);
  const n = await page.locator('.qbtn').count();
  for (let i = 0; i < n; i++) {
    const opt = page.locator('.opt input').first();
    if (await opt.count()) await opt.check();
    if (i < n - 1) { await page.locator('.exam-page [data-act="go"].btn-primary').click(); await page.waitForTimeout(80); }
  }
  await page.locator('.exam-bar [data-act="submit"]').click();
  await page.locator('#modal [data-yes]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#main')).toContainText('Score');
  await expect(page.locator('.result-q').first()).toBeVisible();
});

test('project lifecycle: learner submits, instructor reviews and approves with rubric', async ({ page }) => {
  await asRole(page, 'student');
  await go(page, '/projects/PR-S1001-AS-WEB301');
  await page.fill('#repo', 'not-a-url');
  await page.locator('form[data-form="submit"] button[type="submit"]').click();
  await expect(page.locator('#repo-err')).toBeVisible();
  await page.fill('#repo', 'https://github.com/riya-dev/react-portfolio');
  await page.locator('form[data-form="submit"] button[type="submit"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('.page-head .pill')).toHaveText('Submitted');
  await asRole(page, 'instructor');
  await go(page, '/projects/PR-S1001-AS-WEB301');
  await page.locator('[data-act="go"][data-id="startReview"]').click();
  await page.waitForTimeout(150);
  for (const [id, v] of [['func', 36], ['code', 22], ['test', 13], ['docs', 18]]) await page.fill(`#sc-${id}`, String(v));
  await page.fill('#comment', 'Edge cases covered. Nice work.');
  await page.locator('form[data-form="approve"] button[type="submit"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('.page-head .pill')).toHaveText('Approved');
  await expect(page.locator('#main')).toContainText('Decision history');
});

test('tenant isolation: a corporate client sees only its own employees', async ({ page }) => {
  await asRole(page, 'corporate', 'U-CC1');
  await expect(page.locator('#main h1')).toHaveText('Northwind Logistics');
  await page.locator('[data-act="tab"][data-id="people"]').click();
  const text = await page.locator('#main').innerText();
  expect(text).not.toMatch(/Helios|Kestrel/);
  await go(page, '/admin/orgs/ORG-HF');
  await expect(page.locator('#main')).toContainText('You do not have access');
});

test('admissions: enrolling an applicant creates a learner with roadmap and fee plan', async ({ page }) => {
  await asRole(page, 'admin');
  await go(page, '/ops/admissions');
  const card = page.locator('.lane').filter({ hasText: 'Offer' }).locator('.ticket').first();
  const name = await card.locator('.t').innerText();
  await card.locator('[data-act="advance"]').click();
  await page.locator('#modal [data-yes]').click();
  await page.waitForTimeout(250);
  await go(page, '/ops/students');
  await page.fill('#st-q', name);
  await page.waitForTimeout(400);
  await expect(page.locator('.tbl tbody')).toContainText(name);
});

test('certificates: issuing requires eligibility and appears on public verification', async ({ page }) => {
  await asRole(page, 'director');
  await go(page, '/certificates');
  const issue = page.locator('[data-act="issue"]').first();
  if (await issue.count()) { await issue.click(); await page.waitForTimeout(200); }
  await page.locator('[data-act="tab"][data-id="issued"]').click();
  const id = (await page.locator('.tbl tbody tr .mono').first().innerText()).trim();
  await go(page, `/verify/${id}`);
  await expect(page.locator('.callout')).toContainText(/Valid certificate|revoked/);
  await go(page, '/verify/AVX-CRT-NOPE-0000');
  await expect(page.locator('.callout')).toContainText('No certificate found');
});

test('notifications: mark all as read clears the unread badge', async ({ page }) => {
  await asRole(page, 'student');
  await expect(page.locator('#bell .dot')).toBeVisible();
  await go(page, '/notifications');
  await page.locator('[data-act="readAll"]').click();
  await page.waitForTimeout(150);
  await expect(page.locator('#bell .dot')).toHaveCount(0);
});

test('command palette searches with permissions and keyboard navigation', async ({ page }) => {
  await asRole(page, 'student');
  await page.keyboard.press('Control+k');
  await page.fill('#pal-q', 'two sum');
  await page.waitForTimeout(200);
  await expect(page.locator('#pal-res')).toContainText('Two Sum');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => location.hash)).toContain('/lab/two-sum');
  await page.keyboard.press('Control+k');
  await page.fill('#pal-q', 'Aditya');
  await page.waitForTimeout(200);
  await expect(page.locator('#pal-res')).not.toContainText('Students');
  await page.keyboard.press('Escape');
});

test('feature flags hide features and block their routes', async ({ page }) => {
  await asRole(page, 'superadmin');
  await go(page, '/admin/settings');
  await page.uncheck('#f-community');
  await page.locator('form[data-form="flags"] button[type="submit"]').click();
  await page.waitForTimeout(150);
  await asRole(page, 'student');
  await expect(page.locator('#nav')).not.toContainText('Discussions');
  await go(page, '/discussions');
  await expect(page.locator('#main')).toContainText('switched off');
});

test('demo data persists across reloads and can be reset', async ({ page }) => {
  await asRole(page, 'student');
  await go(page, '/notifications');
  await page.locator('[data-act="readAll"]').click();
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('#nav a');
  await expect(page.locator('#bell .dot')).toHaveCount(0);
  await asRole(page, 'superadmin');
  await go(page, '/admin/settings');
  await page.locator('[data-act="tab"][data-id="system"]').click();
  await page.locator('[data-act="reset"]').click();
  await page.fill('#confirm-phrase', 'RESET');
  await page.locator('#modal [data-yes]').click();
  await page.waitForTimeout(300);
  await asRole(page, 'student');
  await expect(page.locator('#bell .dot')).toBeVisible();
});

test('mobile: navigation opens as a drawer and pages fit without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asRole(page, 'student');
  for (const h of ['/dashboard', '/lab/two-sum', '/programs', '/live', '/assessments']) {
    await go(page, h);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${h}`).toBeLessThanOrEqual(1);
  }
  await page.locator('.menu-btn').click();
  await expect(page.locator('#frame')).toHaveAttribute('data-nav-open', 'true');
});

test('accessibility: no serious axe violations on key pages', async ({ page }) => {
  const axe = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
  await asRole(page, 'student');
  const results = [];
  for (const h of ['/dashboard', '/programs', '/lab/two-sum', '/assessments', '/projects', '/live', '/notifications']) {
    await go(page, h);
    await page.waitForTimeout(250);
    await page.addScriptTag({ content: axe });
    const r = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: true } } })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target}`));
    results.push(...r.map((x) => `${h}: ${x}`));
  }
  expect(results, results.join('\n')).toEqual([]);
});

test('preview screen: no role switcher in the app, profile IDs are checked, leaving returns to the screen', async ({ page }) => {
  await expect(page.locator('#role-select, #acting-select')).toHaveCount(0);
  await expect(page.locator('#who')).toContainText('Riya Menon');
  await page.click('#signout');
  await expect(page.locator('h1')).toHaveText('Explore the preview');
  await expect(page.locator('.note')).toContainText('no password is checked');
  await page.selectOption('#role', 'student');
  await page.fill('#profile', 'S9999');
  await page.click('button.primary');
  await expect(page.locator('.field-error')).toContainText('No sample student has the ID S9999');
  await page.fill('#profile', 's1002');
  await page.click('button.primary');
  await page.waitForSelector('#nav a');
  await expect(page.locator('#who')).toContainText('Aditya Varma');
  await page.evaluate(() => { location.hash = '/admin/accounts'; });
  await expect(page.locator('#main')).toContainText('You do not have access');
  await asRole(page, 'superadmin');
  await page.evaluate(() => { location.hash = '/admin/accounts'; });
  await expect(page.locator('#main')).toContainText('Not available in the preview');
});
