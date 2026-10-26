// Certification engine UI: eligibility checklists, issuance, revocation and public verification.
import { esc, fmtDate } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pageHead, pill, btn, empty, tabs, table, kpi, input, domainVar } from '../core/ui.js';
import { eligibility, issueCertificate, revokeCertificate, verifyCode } from '../domain/certification.js';
import { displayName, visibleStudents } from '../domain/scope.js';

const verifyUrl = (id) => `${location.origin}${location.pathname}#/verify/${id}`;

function certCard(ctx, c, { compact = false } = {}) {
  const course = ctx.s.courses.find((x) => x.id === c.courseId);
  const st = ctx.s.students.find((x) => x.id === c.studentId);
  return `<article class="cert ${c.status === 'revoked' ? 'revoked' : ''}" style="${domainVar(course.domain)}" aria-label="Certificate ${esc(c.id)}">
    <div class="spread"><span class="seal">AVX</span>${c.status === 'revoked' ? pill('Revoked', 'p-bad') : pill('Valid', 'p-ok')}</div>
    <div><div class="eyebrow">Certificate of completion</div><h3 class="cert-title">${esc(course.title)}</h3></div>
    <p class="small">Awarded to <b>${esc(st.name)}</b> for completing every requirement of ${esc(course.id)}, including lessons, assessment, approved projects${course.pass.instructorApproval ? ' and instructor sign-off' : ''}.</p>
    <dl class="dl small"><dt>Issued</dt><dd>${fmtDate(c.issuedAt)}</dd><dt>Credential ID</dt><dd class="mono">${esc(c.id)}</dd><dt>Verify code</dt><dd class="mono">${verifyCode(c.id)}</dd>${!compact ? `<dt>Verify at</dt><dd class="mono xs" style="word-break:break-all">${esc(verifyUrl(c.id))}</dd>` : ''}${c.status === 'revoked' ? `<dt>Revoked</dt><dd>${fmtDate(c.revokedAt)}: ${esc(c.revokedReason)}</dd>` : ''}</dl>
    ${c.demo ? '<p class="xs muted">Demo record generated for this prototype.</p>' : ''}
  </article>`;
}

export const certificates = {
  perms: ['certs.own', 'certs.manage'],
  title: () => 'Certificates',
  render(ctx) {
    if (ctx.me.role === 'student') return learnerView(ctx);
    const T = ctx.local('certT', { tab: 'queue' });
    const scope = visibleStudents(ctx.s, ctx.me);
    const ids = new Set(scope.map((s) => s.id));
    const eligibleQ = ctx.s.enrollments.filter((e) => ids.has(e.studentId) && e.status === 'completed').map((e) => ({ e, el: eligibility(ctx.s, e.studentId, e.courseId) })).filter((x) => x.el.eligible && !x.el.issued);
    const blocked = ctx.s.enrollments.filter((e) => ids.has(e.studentId) && e.status === 'completed').map((e) => ({ e, el: eligibility(ctx.s, e.studentId, e.courseId) })).filter((x) => !x.el.eligible && !x.el.issued);
    const issued = ctx.s.certificates.filter((c) => ids.has(c.studentId));
    let body;
    if (T.tab === 'queue') body = `<section class="panel flush">${table([
      { key: 's', label: 'Learner', render: (x) => `<b>${esc(displayName(ctx.s, x.e.studentId))}</b><div class="sub">${x.e.studentId}</div>` },
      { key: 'c', label: 'Course', render: (x) => `${x.e.courseId}<div class="sub">${esc(x.el.course.title)}</div>` },
      { key: 'k', label: 'Requirements', render: (x) => x.el.checks.map((k) => pill(k.label.split(' ').slice(0, 2).join(' '), 'p-ok', true)).join(' ') },
      { key: 'x', label: '', r: true, render: (x) => btn('Issue certificate', { act: 'issue', cls: 'btn-primary', sm: true, attrs: { 'data-s': x.e.studentId, 'data-c': x.e.courseId } }) },
    ], eligibleQ, { empty: 'No learners waiting. Learners appear here once every requirement is met.' })}</section>`;
    else if (T.tab === 'blocked') body = `<section class="panel flush">${table([
      { key: 's', label: 'Learner', render: (x) => `<b>${esc(displayName(ctx.s, x.e.studentId))}</b>` },
      { key: 'c', label: 'Course', render: (x) => x.e.courseId },
      { key: 'm', label: 'Missing', render: (x) => x.el.checks.filter((k) => !k.met).map((k) => `<div class="small">${icon('x', 'style="width:12px;height:12px;color:var(--bad)"')} ${esc(k.label)} <span class="muted">(${esc(k.detail)})</span></div>`).join('') },
      { key: 'x', label: '', r: true, render: (x) => (x.el.checks.some((k) => k.id === 'approval' && !k.met) && x.el.checks.filter((k) => !k.met).length === 1 && ['instructor', 'director', 'superadmin'].includes(ctx.me.role) ? btn('Sign off', { act: 'signoff', sm: true, attrs: { 'data-s': x.e.studentId, 'data-c': x.e.courseId } }) : '') },
    ], blocked, { empty: 'Nobody is blocked.', page: T.page || 1, pageSize: 15, pageAct: 'page' })}</section>`;
    else body = `<section class="panel flush">${table([
      { key: 'id', label: 'Credential', render: (c) => `<span class="mono small">${esc(c.id)}</span>` },
      { key: 's', label: 'Learner', render: (c) => esc(displayName(ctx.s, c.studentId)) },
      { key: 'd', label: 'Issued', render: (c) => fmtDate(c.issuedAt) },
      { key: 'st', label: 'Status', render: (c) => (c.status === 'revoked' ? `${pill('Revoked', 'p-bad')}<div class="sub">${esc(c.revokedReason)}</div>` : pill('Valid', 'p-ok')) },
      { key: 'x', label: '', r: true, render: (c) => `<div class="row" style="justify-content:flex-end">${btn('Verify page', { href: `/verify/${c.id}`, sm: true })}${c.status === 'issued' && ctx.can('certs.manage') ? btn('Revoke', { act: 'revoke', sm: true, cls: 'btn-danger', attrs: { 'data-id': c.id } }) : ''}</div>` },
    ], issued.slice().sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)), { page: T.page || 1, pageSize: 15, pageAct: 'page' })}</section>`;
    return `<div class="page">${pageHead({ title: 'Certificates', lede: 'Certificates are issued only when every configured requirement is met. Revocations show on the public verification page.', actions: btn('Verify a certificate', { href: '/verify', ic: 'shield' }) })}
      <div class="kpis">${kpi({ label: 'Ready to issue', value: eligibleQ.length, alert: eligibleQ.length > 0 })}${kpi({ label: 'Completed but blocked', value: blocked.length })}${kpi({ label: 'Issued (valid)', value: issued.filter((c) => c.status === 'issued').length })}${kpi({ label: 'Revoked', value: issued.filter((c) => c.status === 'revoked').length })}</div>
      ${tabs([['queue', 'Ready to issue', eligibleQ.length], ['blocked', 'Blocked', blocked.length], ['issued', 'Registry', issued.length]], T.tab, 'tab')}${body}</div>`;
  },
  actions: {
    tab(el, e, ctx) { const T = ctx.local('certT'); T.tab = el.dataset.id; T.page = 1; ctx.rerender(); },
    page(el, e, ctx) { ctx.local('certT').page = Number(el.dataset.id); ctx.rerender(); },
    issue(el, e, ctx) {
      const { s: sid, c: cid } = el.dataset;
      let cert;
      ctx.commit('cert.issue', (s) => { cert = issueCertificate(s, sid, cid, ctx.me.id, new Date()); ctx.notify(sid, 'certificate', `Certificate issued: ${cid}`, 'Share the verification link with employers.', '/certificates'); }, { audit: { action: 'certificate.issue', entity: 'certificate', entityId: `${sid}:${cid}`, detail: `Issued for ${cid}` } }) === true && ctx.toast(`Issued ${cert.id}`);
    },
    signoff(el, e, ctx) {
      const { s: sid, c: cid } = el.dataset;
      ctx.commit('cert.signoff', (s) => { const en = s.enrollments.find((x) => x.studentId === sid && x.courseId === cid); en.approvedBy = ctx.me.id; en.approvedAt = new Date().toISOString(); }, { ok: 'Signed off', audit: { action: 'enrollment.signoff', entity: 'enrollment', entityId: `${sid}:${cid}` } });
    },
    revoke(el, e, ctx) {
      const id = el.dataset.id;
      ctx.modal({ title: 'Revoke certificate', body: `<p>Revoking marks <span class="mono">${esc(id)}</span> as invalid on the public verification page. The record is kept for audit. This cannot be undone; a new certificate can be issued later.</p>${input({ id: 'rv-reason', label: 'Reason (shown publicly)', req: true })}<div class="field"><label for="rv-confirm">Type <b>REVOKE</b> to confirm</label><input class="input" id="rv-confirm" autocomplete="off"></div>`, foot: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-danger solid" type="button" id="rv-go" disabled>Revoke certificate</button>`, onMount: (m, close) => {
        const go = m.querySelector('#rv-go');
        m.querySelector('#rv-confirm').addEventListener('input', (ev) => { go.disabled = ev.target.value.trim() !== 'REVOKE'; });
        m.parentElement.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
        go.onclick = () => { const reason = m.querySelector('#rv-reason').value; if (ctx.commit('cert.revoke', (s) => { const c = revokeCertificate(s, id, reason, ctx.me.id, new Date()); ctx.notify(c.studentId, 'certificate', 'Certificate revoked', reason, '/certificates'); }, { ok: 'Certificate revoked', audit: { action: 'certificate.revoke', entity: 'certificate', entityId: id, detail: reason, kind: 'security' } }) === true) close(); };
      } });
    },
  },
};

function learnerView(ctx) {
  const enr = ctx.s.enrollments.filter((e) => e.studentId === ctx.me.id);
  const certs = ctx.s.certificates.filter((c) => c.studentId === ctx.me.id);
  return `<div class="page">${pageHead({ title: 'My certificates', lede: 'Each course lists exactly what is still needed. Certificates are verifiable by anyone with the credential ID.', actions: btn('Verify a certificate', { href: '/verify', ic: 'shield' }) })}
    ${certs.length ? `<section class="stack"><h2>Issued</h2><div class="grid g-auto" style="--min:320px">${certs.map((c) => `<div class="stack" style="--gap:8px">${certCard(ctx, c)}<div class="row">${btn('Copy verification link', { act: 'copyLink', sm: true, ic: 'copy', attrs: { 'data-id': c.id } })}${btn('Download PDF', { sm: true, ic: 'download', disabled: true, title: 'Signed PDF certificates need the PDF integration (server-side signing)' })}</div></div>`).join('')}</div></section>` : ''}
    <section class="stack"><h2>Progress towards certificates</h2><div class="grid g-auto" style="--min:320px">${enr.map((e) => { const el = eligibility(ctx.s, ctx.me.id, e.courseId); return `<section class="panel" style="${domainVar(el.course.domain)}"><div class="panel-head"><h2 style="font-size:1rem">${esc(el.course.title)}</h2>${el.issued ? pill('Issued', 'p-ok') : el.eligible ? pill('Eligible, awaiting issue', 'p-info') : pill(`${el.checks.filter((k) => k.met).length}/${el.checks.length} met`, 'p-mute')}</div><ul class="checklist">${el.checks.map((k) => `<li class="${k.met ? 'met' : ''}">${icon(k.met ? 'check' : 'dot')}<span>${esc(k.label)}<br><span class="hint">${esc(k.detail)}</span></span></li>`).join('')}</ul></section>`; }).join('') || empty('No enrollments')}</div></section></div>`;
}
certificates.actions.copyLink = (el, e, ctx) => {
  const url = verifyUrl(el.dataset.id);
  navigator.clipboard?.writeText(url).then(() => ctx.toast('Verification link copied'), () => ctx.modal({ title: 'Copy this link', body: `<label class="sr-only" for="copy-url">Verification link</label><input class="input mono" id="copy-url" value="${esc(url)}" readonly autofocus>`, onMount: (m) => { const i = m.querySelector('#copy-url'); i.addEventListener('focus', () => i.select()); } }));
};

export const verify = {
  title: () => 'Verify a certificate',
  render(ctx) {
    const q = (ctx.params.id || ctx.local('verify', { q: '' }).q || '').trim();
    const c = q ? ctx.s.certificates.find((x) => x.id.toUpperCase() === q.toUpperCase()) : null;
    const sample = ctx.s.certificates.find((x) => x.status === 'issued');
    return `<div class="page" style="max-width:820px">${pageHead({ title: 'Verify a certificate', lede: 'Employers and background-check agencies can confirm an AVGENX Academy credential here. No sign-in needed.' })}
      <form class="panel row" data-form="verify" style="align-items:flex-end"><div class="grow">${input({ id: 'cid', label: 'Credential ID', value: q, a: { placeholder: 'AVX-CRT-WEB301-1001', autocomplete: 'off', spellcheck: 'false' } })}</div><button class="btn btn-primary" type="submit">${icon('shield')}Verify</button></form>
      ${!q ? `<p class="small muted">Example from the demo data: <a href="#/verify/${esc(sample?.id || '')}" class="mono">${esc(sample?.id || '')}</a></p>` : c ? `<div class="callout ${c.status === 'revoked' ? 'bad' : 'ok'}" role="status"><b>${c.status === 'revoked' ? 'This certificate has been revoked.' : 'Valid certificate.'}</b> ${c.status === 'revoked' ? `Reason: ${esc(c.revokedReason)}` : 'Issued by AVGENX Academy and not revoked.'}</div>${certCard(ctx, c)}` : `<div class="callout bad" role="alert"><b>No certificate found with ID ${esc(q)}.</b> Check for typos; IDs look like AVX-CRT-WEB301-1001. Contact ${esc(ctx.s.settings.institute.supportEmail)} if you believe this is wrong.</div>`}</div>`;
  },
  forms: { verify(form, d, ctx) { ctx.nav(`/verify/${encodeURIComponent(d.cid.trim())}`); } },
};
