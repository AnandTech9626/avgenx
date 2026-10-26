// AVGENX Academy sign-in page.
//   mode 'server':  real sign-in against the AVGENX server (credentials verified server side).
//   mode 'preview': static preview build with sample data and no server; nothing is verified,
//                   and the page says so plainly.
import { ROLES } from '../core/rbac.js';
import { icon } from '../core/icons.js';
import { esc } from '../core/util.js';
import { authFetch, tabNote } from '../services/auth.js';

const ROLE_GROUPS = [
  ['Learning', ['student', 'corporate']],
  ['Teaching and mentoring', ['instructor', 'mentor', 'ta']],
  ['Academic and career operations', ['director', 'pm', 'placement']],
  ['Leadership and administration', ['ceo', 'admin', 'superadmin']],
];
const DOMAINS = ['Software Engineering and Programming', 'Web Development', 'Data and Analytics Engineering', 'Artificial Intelligence and Machine Learning', 'SAP and Enterprise Technologies', 'Cloud and DevOps', 'Cybersecurity', 'Mobile and Product Engineering', 'Architecture, Quality and Emerging Tech'];

export const brandMark = (id = 'bm') => `<svg class="brand-mark" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7CD76"/><stop offset="1" stop-color="#D98F1C"/></linearGradient></defs><rect x="1" y="1" width="42" height="42" rx="12" fill="url(#${id})"/><path d="M13 31.5 22 12l9 19.5" fill="none" stroke="#0A1121" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><rect class="cursor" x="17.2" y="24.2" width="9.6" height="3.4" rx="1.2" fill="#0A1121"/></svg>`;
const brand = (id) => `<span class="brand">${brandMark(id)}<span class="brand-word"><b>AVGENX</b><small>ACADEMY</small></span></span>`;

const CODE = [
  ['<span class="tk-k">function</span> <span class="tk-f">twoSum</span><span class="tk-p">(</span><span class="tk-v">nums</span><span class="tk-p">,</span> <span class="tk-v">target</span><span class="tk-p">) {</span>'],
  ['  <span class="tk-k">const</span> <span class="tk-v">seen</span> <span class="tk-p">=</span> <span class="tk-k">new</span> <span class="tk-f">Map</span><span class="tk-p">();</span>'],
  ['  <span class="tk-k">for</span> <span class="tk-p">(</span><span class="tk-k">let</span> <span class="tk-v">i</span> <span class="tk-p">=</span> <span class="tk-n">0</span><span class="tk-p">;</span> <span class="tk-v">i</span> <span class="tk-p">&lt;</span> <span class="tk-v">nums</span><span class="tk-p">.</span><span class="tk-v">length</span><span class="tk-p">;</span> <span class="tk-v">i</span><span class="tk-p">++) {</span>'],
  ['    <span class="tk-k">const</span> <span class="tk-v">need</span> <span class="tk-p">=</span> <span class="tk-v">target</span> <span class="tk-p">-</span> <span class="tk-v">nums</span><span class="tk-p">[</span><span class="tk-v">i</span><span class="tk-p">];</span>'],
  ['    <span class="tk-k">if</span> <span class="tk-p">(</span><span class="tk-v">seen</span><span class="tk-p">.</span><span class="tk-f">has</span><span class="tk-p">(</span><span class="tk-v">need</span><span class="tk-p">))</span>'],
  ['      <span class="tk-k">return</span> <span class="tk-p">[</span><span class="tk-v">seen</span><span class="tk-p">.</span><span class="tk-f">get</span><span class="tk-p">(</span><span class="tk-v">need</span><span class="tk-p">),</span> <span class="tk-v">i</span><span class="tk-p">];</span>'],
  ['    <span class="tk-v">seen</span><span class="tk-p">.</span><span class="tk-f">set</span><span class="tk-p">(</span><span class="tk-v">nums</span><span class="tk-p">[</span><span class="tk-v">i</span><span class="tk-p">],</span> <span class="tk-v">i</span><span class="tk-p">);</span>'],
  ['  <span class="tk-p">}</span>'],
  ['<span class="tk-p">}</span>'],
];

function promo() {
  const list = `<ul>${DOMAINS.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`;
  return `<section class="promo" aria-labelledby="promo-h">
    <div class="rise" style="--d:.05s">${brand('bm-promo')}</div>
    <div class="promo-copy">
      <div class="eyebrow rise" style="--d:.15s">Coding institute platform</div>
      <h2 class="headline rise" id="promo-h" style="--d:.25s"><span>Build Skills.</span><span>Create <em>Possibilities.</em></span></h2>
      <p class="promo-lede rise" style="--d:.4s"><b>Your learning journey starts here.</b> Courses, a hands-on coding lab, live classes, mentoring and career preparation, all in one place.</p>
      <div class="stage rise" style="--d:.55s" aria-hidden="true">
        <div class="editor glass">
          <div class="editor-bar"><i></i><i></i><i></i><span>two_sum.js</span></div>
          <pre class="code">${CODE.map(([l], i) => `<span class="ln" style="--i:${i}">${l}</span>`).join('')}</pre>
          <div class="run"><span class="ok">${icon('check')} Accepted</span><span>5 of 5 tests passed</span></div>
        </div>
        <div class="path glass">
          <h3>Learning path</h3>
          <p>Full-stack engineering</p>
          <ol><li class="done">Learn</li><li class="done">Practice</li><li class="now">Build <small>NOW</small></li><li>Review</li><li>Career</li></ol>
        </div>
      </div>
    </div>
    <div class="ticker" aria-label="Learning domains"><div class="ticker-track">${list}<div aria-hidden="true">${list}</div></div></div>
  </section>`;
}

const roleSelect = (value = '', hint = 'Choose a role assigned to your account.') => `<div class="field"><label for="role">Sign in as</label><div class="control">${icon('shield', 'class="lead"')}<select id="role" name="role" required aria-describedby="role-hint"><option value="" disabled ${value ? '' : 'selected'}>Select your role</option>${ROLE_GROUPS.map(([g, ids]) => `<optgroup label="${esc(g)}">${ids.map((id) => `<option value="${id}" ${id === value ? 'selected' : ''}>${esc(ROLES.find((r) => r.id === id).label)}</option>`).join('')}</optgroup>`).join('')}</select>${icon('chevron', 'class="chev"')}</div><span class="hint" id="role-hint">${hint}</span></div>`;

const passwordField = ({ id, label, autocomplete, describe = '', extra = '' }) => `<div class="field"><label for="${id}">${label}</label><div class="control has-toggle">${icon('lock', 'class="lead"')}<input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" required maxlength="128" ${describe ? `aria-describedby="${describe}"` : ''} spellcheck="false"><button type="button" class="toggle" data-toggle="${id}" aria-controls="${id}" aria-pressed="false">${icon('eye')}<span>Show</span></button></div>${extra}</div>`;

const submit = (label, ic = 'arrow') => `<button class="primary" type="submit"><span class="lbl">${label}</span>${icon(ic, 'class="go"')}</button>`;
const alertBox = (msg, tone = '') => (msg ? `<div class="alert ${tone}" role="${tone === 'ok' ? 'status' : 'alert'}">${icon(tone === 'ok' ? 'check' : 'alert')}<span>${esc(msg)}</span></div>` : '');

function shell(mode) {
  return `<div class="auth">
    ${promo()}
    <main class="panel" id="main">
      <div class="panel-top">${mode === 'server' ? `<span class="secure">${icon('lock')} Server-verified sign-in</span>` : `<span class="secure">${icon('info')} Preview build</span>`}</div>
      <div class="form-wrap"><div class="card" id="card"></div></div>
      <div class="panel-foot"><span>© ${new Date().getFullYear()} AVGENX Academy</span><span>${mode === 'server' ? 'Accounts are issued by your institute.' : 'Sample data only.'}</span></div>
    </main>
  </div>`;
}

// ---------------------------------------------------------------- shared behaviour
function wireCommon(root) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const input = root.querySelector(`#${t.dataset.toggle}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    t.setAttribute('aria-pressed', String(show));
    t.innerHTML = `${icon(show ? 'eyeOff' : 'eye')}<span>${show ? 'Hide' : 'Show'}</span>`;
    t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  const caps = (e) => { const c = root.querySelector(`#caps-${e.target.id}`); if (c && e.getModifierState) c.classList.toggle('on', e.getModifierState('CapsLock')); };
  root.addEventListener('keydown', (e) => { if (e.target.type === 'password' || e.target.dataset?.pw) caps(e); });
  root.addEventListener('keyup', (e) => { if (e.target.type === 'password' || e.target.dataset?.pw) caps(e); });
}
const capsHint = (id) => `<span class="caps" id="caps-${id}" aria-live="polite">${icon('alert')} Caps Lock is on</span>`;

function busy(form, on, label) {
  const b = form.querySelector('.primary');
  if (!b) return;
  b.disabled = on; b.setAttribute('aria-busy', String(on));
  if (on) { b.dataset.html = b.innerHTML; b.innerHTML = `<span class="spin" aria-hidden="true"></span><span>${label}</span>`; }
  else if (b.dataset.html) b.innerHTML = b.dataset.html;
}
const strength = (pw) => Math.min(4, (pw.length >= 12) + (pw.length >= 16) + ([/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(pw)).length >= 3) + (pw.length >= 20));

function setFieldErrors(form, fields = {}) {
  form.querySelectorAll('.field-error').forEach((x) => x.remove());
  form.querySelectorAll('[aria-invalid]').forEach((x) => { x.removeAttribute('aria-invalid'); });
  for (const [k, msg] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${k}"]`);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const id = `${input.id}-err`;
    input.closest('.field').insertAdjacentHTML('beforeend', `<span class="field-error" id="${id}">${esc(msg)}</span>`);
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
  }
}

// ---------------------------------------------------------------- server mode
const api = authFetch;
const NETWORK = 'We could not reach the AVGENX server. Check your connection and try again.';

function serverMode(root, card) {
  const target = /^#\/[\w/-]*$/.test(location.hash) ? location.hash : '';
  const goApp = () => location.replace(`/${target}`);
  let csrf = '';
  let config = { resetByEmail: false, devOutbox: false };

  const views = {
    signin(msg = '', tone = '') {
      card.innerHTML = `<h1>Welcome back</h1><p class="sub">Sign in with the account your institute administrator created for you.</p>
        <form novalidate data-f="signin">
          <div id="msg">${alertBox(msg, tone)}</div>
          ${roleSelect(tabNote.get('avgenx-last-role') || '')}
          <div class="field"><label for="identifier">User ID or registered email</label><div class="control">${icon('user', 'class="lead"')}<input id="identifier" name="identifier" autocomplete="username" required maxlength="254" spellcheck="false" autocapitalize="none" placeholder="e.g. STU-7K2QXM"></div></div>
          ${passwordField({ id: 'password', label: 'Password', autocomplete: 'current-password', describe: 'caps-password', extra: capsHint('password') })}
          <div class="row-between">${config.rememberMe ? `<label class="check"><input type="checkbox" name="remember" id="remember"><span class="box">${icon('check')}</span><span>Keep me signed in for 14 days</span></label>` : '<span></span>'}<button type="button" class="link" data-go="forgot">Forgot password?</button></div>
          ${submit('Sign in')}
        </form>
        <div class="card-foot">${icon('shield')}<span>There is no public sign-up. If you need access, ask your institute administrator to create an account for you.${config.rememberMe ? ' Use "Keep me signed in" only on a device you do not share.' : ''}</span></div>`;
      card.querySelector(tabNote.get('avgenx-last-role') ? '#identifier' : '#role').focus();
    },
    forgot() {
      card.innerHTML = `<button type="button" class="link back" data-go="signin">${icon('arrow')} Back to sign in</button><h1>Reset your password</h1><p class="sub">${config.resetByEmail ? 'Enter your user ID or registered email. If it matches an active account, we will email a reset link that works once and expires in 30 minutes.' : config.devOutbox ? 'Development mode: email is not connected, so the reset link is written to the server console instead of being emailed.' : 'Email delivery is not set up for this installation, so resets are handled by your institute administrator.'}</p>
        <form novalidate data-f="forgot"><div id="msg"></div>
          <div class="field"><label for="f-identifier">User ID or registered email</label><div class="control">${icon('at', 'class="lead"')}<input id="f-identifier" name="identifier" autocomplete="username" required maxlength="254" spellcheck="false" autocapitalize="none"></div></div>
          ${submit('Request reset link', 'send')}
        </form>`;
      card.querySelector('#f-identifier').focus();
    },
    change(user) {
      card.innerHTML = `<h1>Choose a new password</h1><p class="sub">${esc(user?.name || 'Your account')} was issued a temporary password. Set your own before continuing. Other devices will be signed out.</p>
        <form novalidate data-f="change"><div id="msg"></div>
          ${config.passwordsInFile ? `<div class="note">${icon('info')}<span>Your institute keeps passwords in its account file, so its administrators can see the password you choose. Do not reuse a password you use anywhere else.</span></div>` : ''}
          ${passwordField({ id: 'current', label: 'Temporary or current password', autocomplete: 'current-password' })}
          ${passwordField({ id: 'next', label: 'New password', autocomplete: 'new-password', describe: 'next-hint caps-next', extra: `<div class="meter" id="meter" data-level="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="hint" id="next-hint">At least 12 characters. A short phrase of unrelated words works well.</span>${capsHint('next')}` })}
          ${passwordField({ id: 'confirm', label: 'Confirm new password', autocomplete: 'new-password' })}
          ${submit('Save and continue')}
          <button type="button" class="secondary" data-go="signout">${icon('out')} Sign out instead</button>
        </form>`;
      card.querySelector('#current').focus();
    },
    reset(token) {
      card.innerHTML = `<h1>Set a new password</h1><p class="sub">This link works once. After saving, sign in with your new password.</p>
        <form novalidate data-f="reset" data-token="${esc(token)}"><div id="msg"></div>
          ${config.passwordsInFile ? `<div class="note">${icon('info')}<span>Your institute keeps passwords in its account file, so its administrators can see the password you choose. Do not reuse a password you use anywhere else.</span></div>` : ''}
          ${passwordField({ id: 'next', label: 'New password', autocomplete: 'new-password', describe: 'next-hint', extra: `<div class="meter" id="meter" data-level="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="hint" id="next-hint">At least 12 characters. A short phrase of unrelated words works well.</span>` })}
          ${passwordField({ id: 'confirm', label: 'Confirm new password', autocomplete: 'new-password' })}
          ${submit('Save new password')}
        </form>`;
      card.querySelector('#next').focus();
    },
  };

  const showMsg = (form, msg, tone = '') => { form.querySelector('#msg').innerHTML = alertBox(msg, tone); };
  const matchCheck = (form, d) => { if (d.next !== d.confirm) { setFieldErrors(form, { confirm: 'The passwords do not match.' }); return false; } return true; };

  const handlers = {
    async signin(form, d) {
      const fields = {};
      if (!d.role) fields.role = 'Select a role.';
      if (!d.identifier.trim()) fields.identifier = 'Enter your user ID or email.';
      if (!d.password) fields.password = 'Enter your password.';
      setFieldErrors(form, fields);
      if (Object.keys(fields).length) { form.querySelector('[aria-invalid="true"]').focus(); return; }
      busy(form, true, 'Signing in');
      const r = await api('/api/auth/login', { role: d.role, identifier: d.identifier.trim(), password: d.password, remember: !!d.remember }).catch(() => null);
      if (!r) { busy(form, false); return showMsg(form, NETWORK); }
      if (r.ok) {
        tabNote.set('avgenx-last-role', d.role);
        if (r.data.next === 'change-password') { const me = await api('/api/auth/me'); csrf = me.data.csrf; return views.change(me.data.user); }
        return goApp();
      }
      busy(form, false);
      form.querySelector('#password').value = '';
      showMsg(form, r.data.message || 'Sign-in failed. Try again.');
      (r.data.code === 'invalid_request' ? form.querySelector('#role') : form.querySelector('#password')).focus();
    },
    async forgot(form, d) {
      if (!d.identifier.trim()) { setFieldErrors(form, { identifier: 'Enter your user ID or email.' }); return; }
      setFieldErrors(form, {});
      busy(form, true, 'Sending');
      const r = await api('/api/auth/forgot', { identifier: d.identifier.trim() }).catch(() => null);
      busy(form, false);
      if (!r) return showMsg(form, NETWORK);
      showMsg(form, r.data.message || 'Request received.', r.ok ? 'ok' : '');
    },
    async change(form, d) {
      setFieldErrors(form, {});
      if (!matchCheck(form, d)) return;
      busy(form, true, 'Saving');
      const r = await api('/api/auth/change-password', { current: d.current, next: d.next }, csrf).catch(() => null);
      if (r?.ok) { if (r.data.file) tabNote.set('avgenx-flash', r.data.file === 'written' ? 'Password changed and written to accounts.xlsx.' : 'Password changed. accounts.xlsx is open in Excel, so it will be written there as soon as the file is closed.'); return goApp(); }
      busy(form, false);
      if (!r) return showMsg(form, NETWORK);
      if (r.status === 401 || r.status === 403) return views.signin('Your sign-in expired. Sign in again with the temporary password.');
      setFieldErrors(form, r.data.fields || {});
      showMsg(form, r.data.message || 'Could not save the password.');
    },
    async reset(form, d) {
      setFieldErrors(form, {});
      if (!matchCheck(form, d)) return;
      busy(form, true, 'Saving');
      const r = await api('/api/auth/reset', { token: form.dataset.token, password: d.next }).catch(() => null);
      busy(form, false);
      if (!r) return showMsg(form, NETWORK);
      if (r.ok) { history.replaceState(null, '', '/'); return views.signin('Password saved. Sign in with your new password.', 'ok'); }
      setFieldErrors(form, r.data.fields ? { next: r.data.fields.password } : {});
      showMsg(form, r.data.message || 'Could not save the password.');
    },
  };

  root.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-f]');
    if (!f) return;
    e.preventDefault();
    const d = Object.fromEntries([...f.elements].filter((x) => x.name).map((x) => [x.name, x.type === 'checkbox' ? x.checked : x.value]));
    handlers[f.dataset.f](f, d);
  });
  root.addEventListener('input', (e) => { if (e.target.id === 'next') { const m = root.querySelector('#meter'); if (m) m.dataset.level = String(e.target.value ? Math.max(1, strength(e.target.value)) : 0); } });
  root.addEventListener('click', async (e) => {
    const g = e.target.closest('[data-go]');
    if (!g) return;
    if (g.dataset.go === 'signout') { await api('/api/auth/logout', {}, csrf).catch(() => null); return views.signin('You are signed out.', 'ok'); }
    views[g.dataset.go]();
  });

  if (location.protocol === 'file:') {
    card.innerHTML = `<h1>Start the AVGENX server</h1><p class="sub">This page was opened as a file, so it cannot reach the server that checks sign-ins.</p>
      <div class="note" style="margin-top:24px">${icon('info')}<span>In a terminal in the <b>avgenx-academy</b> folder run <b>npm start</b>, then open the address it prints (<b>http://127.0.0.1:8080</b>) in your browser. To look around without the server, open <b>dist/preview.html</b> instead.</span></div>`;
    return;
  }
  (async () => {
    try { const c = await api('/api/auth/config'); if (c.ok) config = c.data; } catch { /* defaults */ }
    const token = location.pathname === '/reset' ? new URLSearchParams(location.hash.slice(1)).get('token') : null;
    if (token) { history.replaceState(null, '', '/reset'); return views.reset(token); }
    if (location.pathname === '/reset') return views.signin('This reset link is incomplete. Request a new one.');
    const me = await api('/api/auth/me').catch(() => null);
    if (me?.ok && me.data.restricted) { csrf = me.data.csrf; return views.change(me.data.user); }
    if (me?.ok) return goApp();
    views.signin(tabNote.get('avgenx-signed-out') ? 'You are signed out.' : '', 'ok');
    tabNote.del('avgenx-signed-out');
  })();
}

// ---------------------------------------------------------------- preview mode
function previewMode(root, card, onPreview) {
  card.innerHTML = `<h1>Explore the preview</h1><p class="sub">See each workspace of AVGENX Academy with sample data.</p>
    <form novalidate data-f="preview">
      <div class="note">${icon('info')}<span><b>Preview build.</b> No server is connected here, so no password is checked and nothing is a real account. The live installation verifies every sign-in on the AVGENX server.</span></div>
      ${roleSelect('', 'Pick any role to see its workspace.')}
      <div class="field"><label for="profile">Sample profile ID <span style="font-weight:500;color:var(--faint)">(optional)</span></label><div class="control">${icon('user', 'class="lead"')}<input id="profile" name="profile" autocomplete="off" spellcheck="false" autocapitalize="characters" maxlength="16" placeholder="Leave empty for the default person" aria-describedby="profile-hint"></div><span class="hint" id="profile-hint">For example S1002 opens the second sample learner.</span></div>
      ${submit('Enter preview')}
    </form>
    <div class="card-foot">${icon('shield')}<span>Accounts in the live system are created only by institute administrators. There is no public sign-up.</span></div>`;
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-f="preview"]');
    if (!f) return;
    e.preventDefault();
    const role = f.role.value;
    if (!role) { setFieldErrors(f, { role: 'Select a role to preview.' }); f.role.focus(); return; }
    const err = onPreview(role, f.profile.value.trim().toUpperCase());
    if (err) setFieldErrors(f, { profile: err });
  });
  card.querySelector('#role').focus();
}

/** Render the sign-in page into root. */
export function mountLogin(root, { mode = 'server', onPreview } = {}) {
  root.innerHTML = shell(mode);
  document.title = mode === 'server' ? 'Sign in · AVGENX Academy' : 'Preview · AVGENX Academy';
  const card = root.querySelector('#card');
  wireCommon(root);
  if (mode === 'server') serverMode(root, card);
  else previewMode(root, card, onPreview);
}
