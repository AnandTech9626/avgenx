// Sign-in and account administration in a real browser against the real server.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PROBLEMS } from '../../src/data/problems.js';

test.describe.configure({ mode: 'serial' });
let child, B, accts;
const PW = 'Teal-orbit-lantern-71';
const acct = (role, n = 0) => accts.filter((a) => a.role === role)[n];

// The real server runs in its own process (as in production) with a throwaway database.
test.beforeAll(async () => {
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'tests/e2e/server-fixture.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const first = await new Promise((res, rej) => {
    createInterface({ input: child.stdout }).once('line', res);
    child.once('exit', (c) => rej(new Error(`server fixture exited with ${c}`)));
  });
  const info = JSON.parse(first);
  accts = info.accounts;
  B = `http://127.0.0.1:${info.port}`;
});
test.afterAll(async () => { child.stdin.end(); await new Promise((r) => child.once('exit', r)); });

const errors = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|status of 40[13]/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(() => { expect(errors, errors.join(' | ')).toEqual([]); });

async function uiLogin(page, role, a, { remember = false } = {}) {
  await page.goto(`${B}/`);
  await page.selectOption('#role', role);
  await page.fill('#identifier', a.userId);
  await page.fill('#password', a.password);
  if (remember) await page.check('#remember');
  await page.click('button.primary');
}
async function finishFirstLogin(page, a) {
  await page.waitForSelector('h1:has-text("Choose a new password"), #nav a');
  if (a.password === PW) return; // already changed in an earlier test
  await expect(page.locator('h1')).toHaveText('Choose a new password');
  await page.fill('#current', a.password);
  await page.fill('#next', PW);
  await page.fill('#confirm', PW);
  await page.click('button.primary');
  a.password = PW;
}
/** Complete first sign-in through the API (shares the page's cookie jar). */
async function apiReady(page, role, a) {
  const r = await page.request.post(`${B}/api/auth/login`, { data: { role, identifier: a.userId, password: a.password }, headers: { origin: B } });
  expect(r.status()).toBe(200);
  if ((await r.json()).next === 'change-password') {
    const me = await (await page.request.get(`${B}/api/auth/me`)).json();
    expect((await page.request.post(`${B}/api/auth/change-password`, { data: { current: a.password, next: PW }, headers: { origin: B, 'x-csrf-token': me.csrf } })).status()).toBe(200);
    a.password = PW;
  }
}

test('without a session the sign-in page is shown and the LMS is not served', async ({ page }) => {
  for (const path of ['/', '/#/admin/exec', '/#/dashboard']) {
    await page.goto(B + path);
    await expect(page.locator('h1')).toHaveText('Welcome back');
    await expect(page.locator('#nav')).toHaveCount(0);
  }
  const html = await (await page.request.get(`${B}/`)).text();
  for (const lmsOnly of ['Riya Menon', 'CodeMirror', 'Valid Parentheses']) expect(html).not.toContain(lmsOnly); // sample data and the IDE never reach anonymous visitors
  await expect(page.locator('a, button', { hasText: /sign ?up|register|create (an )?account/i })).toHaveCount(0);
  await expect(page.locator('#role option')).toHaveCount(12); // placeholder + 11 roles
});

test('invalid credentials and an unassigned role are rejected with clear messages', async ({ page }) => {
  const s = acct('student');
  await uiLogin(page, 'student', { userId: s.userId, password: 'Definitely-wrong-1' });
  await expect(page.locator('.alert')).toHaveText('The user ID, password or role is not correct.');
  await expect(page.locator('#password')).toHaveValue('');
  await uiLogin(page, 'superadmin', s);
  await expect(page.locator('.alert')).toHaveText('This account is not authorised for the selected role.');
  await expect(page.locator('#nav')).toHaveCount(0);
});

test('first sign-in forces a new password, then lands on the student dashboard without any role switcher', async ({ page }) => {
  const s = acct('student');
  await uiLogin(page, 'student', s);
  await finishFirstLogin(page, s);
  await page.waitForSelector('#nav a');
  expect(new URL(page.url()).hash).toBe('#/dashboard');
  await expect(page.locator('#who')).toContainText('Test Student One');
  await expect(page.locator('#who')).toContainText('Student');
  await expect(page.locator('#who')).toContainText('Linked profile: Riya Menon');
  await expect(page.locator('#role-select, #acting-select')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/viewing as role|acting as/i);
  await page.reload();
  await page.waitForSelector('#nav a');
  await expect(page.locator('#who')).toContainText('Test Student One'); // refresh keeps a valid session
});

test('changing browser storage or the URL does not grant privileges', async ({ page }) => {
  const s = acct('student');
  await apiReady(page, 'student', s);
  await page.goto(`${B}/`);
  await page.waitForSelector('#nav a');
  await page.evaluate(() => {
    localStorage.setItem('avgenx-platform-ui-v1', JSON.stringify({ role: 'superadmin', acting: { superadmin: 'U-SA1', student: 'U-SA1' } }));
    sessionStorage.setItem('avgenx-preview-identity', JSON.stringify({ role: 'superadmin' }));
  });
  await page.goto(`${B}/#/admin/accounts`);
  await page.reload(); // cold start with tampered storage and a forbidden deep link
  await page.waitForSelector('#nav a');
  expect(new URL(page.url()).hash).toBe('#/dashboard'); // not permitted, so sent home
  await expect(page.locator('#who')).toContainText('Student');
  await expect(page.locator('#nav')).not.toContainText('Accounts and Sign-in');
  await page.evaluate(() => { location.hash = '/admin/accounts'; });
  await expect(page.locator('#main')).toContainText('You do not have access');
  const status = await page.evaluate(async () => (await fetch('/api/admin/accounts')).status);
  expect(status).toBe(403);
  const forged = await page.evaluate(async () => (await fetch('/api/admin/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'x' }, body: JSON.stringify({ name: 'Me Admin', email: 'me@x.io', roles: ['superadmin'], credential: 'temporary' }) })).status);
  expect(forged).toBe(403);
});

test('each role is sent to its own home page', async ({ browser }) => {
  const homes = { superadmin: '/admin/settings', admin: '/ops/students', instructor: '/ops/teaching', mentor: '/mentors', placement: '/ops/placements', corporate: '/corporate', student: '/dashboard' };
  for (const [role, home] of Object.entries(homes)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await apiReady(page, role, role === 'student' ? acct('student', 1) : acct(role));
    await page.goto(`${B}/`);
    await page.waitForSelector('#nav a');
    expect(new URL(page.url()).hash, role).toBe(`#${home}`);
    await ctx.close();
  }
});

test('an administrator creates and disables accounts in the console; disabled accounts cannot sign in', async ({ page }) => {
  const a = acct('admin');
  await uiLogin(page, 'admin', a);
  await finishFirstLogin(page, a);
  await page.waitForSelector('#nav a');
  await page.click('#nav a[href="#/admin/accounts"]');
  await expect(page.locator('h1')).toHaveText('Accounts and sign-in');
  await expect(page.locator('#main tbody tr')).toHaveCount(8);
  await page.click('[data-act="create"]');
  await page.fill('#drawer #name', 'Priya Raman');
  await page.fill('#drawer #email', 'priya.raman@example.com');
  await expect(page.locator('#drawer input[name="roles"][value="superadmin"]')).toBeDisabled();
  await page.click('#drawer button[type="submit"]');
  await expect(page.locator('#modal')).toContainText('Account created');
  const userId = await page.locator('#modal .mono').first().innerText();
  const temp = await page.locator('#secret').inputValue();
  expect(temp.length).toBeGreaterThanOrEqual(20);
  await page.click('#modal [data-close]');
  await page.locator('#main tbody tr', { hasText: 'Priya Raman' }).click();
  await page.click('#drawer [data-act="setStatus"]');
  await page.click('#modal [data-yes]');
  await expect(page.locator('#main tbody tr', { hasText: 'Priya Raman' })).toContainText('Disabled');
  await page.click('#drawer [data-close]');
  await page.click('[data-act="tab"][data-id="audit"]');
  await expect(page.locator('#main table')).toContainText('Account disabled');
  await expect(page.locator('#main table')).toContainText('Account created');

  const other = await page.context().browser().newPage();
  await uiLogin(other, 'student', { userId, password: temp });
  await expect(other.locator('.alert')).toHaveText('This account is disabled. Contact your institute administrator.');
  await other.close();
});

test('the Excel register downloads for administrators', async ({ page }) => {
  await apiReady(page, 'admin', acct('admin'));
  await page.goto(`${B}/#/admin/accounts`);
  await page.waitForSelector('#export-register');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-register')]);
  expect(dl.suggestedFilename()).toMatch(/^avgenx-account-register-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('signing out ends the session and returns to the sign-in page', async ({ page, context }) => {
  await apiReady(page, 'instructor', acct('instructor'));
  await page.goto(`${B}/`);
  await page.waitForSelector('#nav a');
  const before = (await context.cookies()).find((c) => c.name === 'avgenx_sid').value;
  await page.click('#signout');
  await expect(page.locator('h1')).toHaveText('Welcome back');
  await expect(page.locator('.alert.ok')).toHaveText('You are signed out.');
  const replay = await page.request.get(`${B}/api/auth/me`, { headers: { cookie: `avgenx_sid=${before}` } });
  expect(replay.status()).toBe(401);
  await page.goto(`${B}/#/ops/teaching`);
  await expect(page.locator('h1')).toHaveText('Welcome back');
});

test('the LMS still works after sign-in: the coding lab judges a submission under the server CSP', async ({ page }) => {
  await apiReady(page, 'student', acct('student', 1));
  await page.goto(`${B}/#/lab/two-sum`);
  await page.waitForSelector('.CodeMirror');
  await page.evaluate((c) => document.querySelector('.CodeMirror').CodeMirror.setValue(c), PROBLEMS.find((p) => p.id === 'two-sum').solution);
  await page.click('[data-act="submit"]');
  await expect(page.locator('.run-status')).toContainText('Accepted', { timeout: 10000 });
  const injected = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.body.appendChild(s); return new Promise((r) => setTimeout(() => r(window.__x), 100)); });
  expect(injected).toBeUndefined();
  const blocked = errors.filter((e) => /Content Security Policy/.test(e));
  expect(blocked.length).toBeGreaterThan(0); // the browser reported the blocked injection
  errors.splice(0, errors.length, ...errors.filter((e) => !/Content Security Policy/.test(e)));
});

test('a mentor and a student on different devices work at the same time without affecting each other', async ({ browser }) => {
  const mentorCtx = await browser.newContext(); const studentCtx = await browser.newContext(); // two separate devices
  const mentor = await mentorCtx.newPage(); const student = await studentCtx.newPage();
  await apiReady(mentor, 'mentor', acct('mentor'));
  await mentor.goto(`${B}/`); await mentor.waitForSelector('#nav a');
  expect(new URL(mentor.url()).hash).toBe('#/mentors');
  // While the mentor is working, the student opens the site: they get their own sign-in page.
  await student.goto(`${B}/`);
  await expect(student.locator('h1')).toHaveText('Welcome back');
  await apiReady(student, 'student', acct('student', 1));
  await student.goto(`${B}/`); await student.waitForSelector('#nav a');
  expect(new URL(student.url()).hash).toBe('#/dashboard');
  await expect(student.locator('#who')).toContainText('Student');
  // The mentor is still the mentor, and keeps working.
  await mentor.evaluate(() => { location.hash = '/mentors'; });
  await expect(mentor.locator('#who')).toContainText('Mentor');
  expect((await (await mentor.request.get(`${B}/api/auth/me`)).json()).user.role).toBe('mentor');
  // The student signing out does not sign the mentor out.
  await student.click('#signout');
  await expect(student.locator('h1')).toHaveText('Welcome back');
  expect((await mentor.request.get(`${B}/api/auth/me`)).status()).toBe(200);
  await mentor.evaluate(() => window.dispatchEvent(new Event('focus')));
  await mentor.waitForTimeout(500);
  await expect(mentor.locator('#nav')).toBeVisible();
  await mentorCtx.close(); await studentCtx.close();
});
