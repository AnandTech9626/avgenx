// Coding Lab: CodeMirror editor, starter templates, sample and custom tests, sandboxed
// JavaScript execution, submission history, hints and editorials.
import CodeMirror from 'codemirror';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/mode/python/python.js';
import 'codemirror/mode/clike/clike.js';
import 'codemirror/addon/edit/matchbrackets.js';
import 'codemirror/addon/edit/closebrackets.js';
import 'codemirror/addon/selection/active-line.js';
import 'codemirror/addon/comment/comment.js';

import { esc, fmtDateTime, uid, debounce } from '../core/util.js';
import { icon } from '../core/icons.js';
import { pill, btn, empty, select, tabs, tag } from '../core/ui.js';
import * as store from '../core/store.js';
import { actor } from '../core/select.js';
import { allProblems, problemById } from '../data/problemsStore.js';
import { starter } from '../data/problems.js';
import { runJS, runRemote, LANGS } from '../services/executor.js';
import { setCopilotContext } from './copilot.js';
import { weeklyContest } from '../domain/motivation.js';

const MODES = { javascript: 'javascript', python: 'python', java: 'text/x-java', cpp: 'text/x-c++src' };
const STATUS_TONE = { Accepted: 'p-ok', 'Wrong Answer': 'p-bad', 'Runtime Error': 'p-bad', 'Compile Error': 'p-bad', 'Time Limit Exceeded': 'p-warn', Unavailable: 'p-mute', Ran: 'p-info', Cancelled: 'p-mute' };
let cm = null;
let running = null;
let lastResult = null;
let bottomTab = 'tests';
let leftTab = 'problem';
let saveDraft = null;

const meId = () => actor().id;
const draftKey = (pid, lang) => `${meId()}|${pid}|${lang}`;
const fmtVal = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

function currentProblem(ctx) {
  const id = ctx.params.problem || ctx.local('lab', { last: 'two-sum' }).last;
  return problemById(ctx.s, id) || problemById(ctx.s, 'two-sum');
}
function langOf(ctx) { const L = ctx.local('lab', { last: 'two-sum' }); if (!L.lang) { const st = ctx.s.students.find((x) => x.id === ctx.me.id); L.lang = st?.lang === 'javascript' || !st ? 'javascript' : 'javascript'; } return L.lang; }

function statementHtml(p) {
  const fmt = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
  return `<div class="stack" style="--gap:12px"><p>${fmt(p.statement)}</p>${p.tests.slice(0, 2).map(([args, exp], i) => `<div class="example"><div class="eyebrow">Example ${i + 1}</div><pre><b>Input:</b> ${esc(p.params.map((n, k) => `${n} = ${fmtVal(args[k])}`).join(', '))}\n<b>Output:</b> ${esc(fmtVal(exp))}</pre></div>`).join('')}
    <dl class="dl small"><dt>Function</dt><dd><code>${esc(p.fn)}(${esc(p.params.join(', '))})</code></dd><dt>Time limit</dt><dd>2.5 s for all tests (browser sandbox)</dd><dt>Memory limit</dt><dd>Enforced only by the server execution service</dd><dt>Expected</dt><dd>${esc(p.complexity || 'n/a')}</dd></dl></div>`;
}

function leftPanel(ctx, p) {
  const me = ctx.me.id;
  const subs = ctx.s.submissions.filter((x) => x.studentId === me && x.problemId === p.id).sort((a, b) => (a.at < b.at ? 1 : -1));
  const accepted = subs.some((x) => x.status === 'Accepted');
  const failed = subs.filter((x) => x.status !== 'Accepted').length;
  const L = ctx.local(`hints:${p.id}`, { shown: 0, solution: false });
  const canSee = accepted || failed >= 3 || ctx.me.role !== 'student';
  let body = '';
  if (leftTab === 'problem') body = statementHtml(p);
  else if (leftTab === 'hints') body = `<div class="stack" style="--gap:10px">${p.hints.slice(0, L.shown).map((h, i) => `<div class="callout"><b>Hint ${i + 1}.</b> ${esc(h)}</div>`).join('')}${L.shown < p.hints.length ? btn(`Reveal hint ${L.shown + 1} of ${p.hints.length}`, { act: 'hint', sm: true, ic: 'sparkle' }) : '<p class="small muted">All hints shown.</p>'}</div>`;
  else if (leftTab === 'editorial') body = canSee ? `<div class="stack"><p class="small">Approach and reference solution. Complexity: <b>${esc(p.complexity || '')}</b></p>${L.solution || accepted || ctx.me.role !== 'student' ? `<pre class="md-code"><code>${esc(p.solution)}</code></pre>` : `<div class="callout warn small">Viewing the solution before you solve it means your eventual accepted submission will not count as first-try.</div>${btn('Show reference solution', { act: 'showSolution', sm: true })}`}</div>` : `<div class="callout info small">The editorial unlocks after an accepted submission or three attempts. You have ${failed} failed attempt${failed === 1 ? '' : 's'}.</div>`;
  else body = subs.length ? `<div class="list">${subs.slice(0, 30).map((x) => `<button type="button" class="item" data-act="loadSub" data-id="${x.id}" ${x.code ? '' : 'disabled title="Code not stored for seeded history"'}>${pill(x.status, STATUS_TONE[x.status] || 'p-mute')}<span class="grow min0"><span class="t small">${x.passed}/${x.total} tests · ${x.ms} ms · ${esc(x.lang)}</span><br><span class="s">${fmtDateTime(x.at)}${x.code ? ' · click to load code' : ''}</span></span></button>`).join('')}</div>` : empty('No submissions yet', 'Submit to run every hidden test and save the result here.', { ic: 'clock' });
  return `${tabs([['problem', 'Problem'], ['hints', 'Hints'], ['editorial', 'Editorial'], ['subs', 'Submissions', subs.length]], leftTab, 'leftTab', { label: 'Problem sections' })}<div class="lab-left-body">${body}</div>`;
}

function bottomPanel(ctx, p) {
  const L = ctx.local(`custom:${p.id}`, { input: JSON.stringify(p.tests[0][0]) });
  const r = lastResult && lastResult.problemId === p.id ? lastResult : null;
  let body = '';
  if (bottomTab === 'tests') {
    const samples = p.tests.slice(0, 2);
    body = `<div class="cases">${samples.map(([args, exp], i) => { const rr = r?.kind === 'run' ? r.results[i] : null; return `<div class="case ${rr ? (rr.passed ? 'pass' : 'fail') : ''}"><div class="spread"><b class="small">Case ${i + 1}</b>${rr ? pill(rr.passed ? 'Passed' : 'Failed', rr.passed ? 'p-ok' : 'p-bad') : ''}</div><div class="mono xs"><span class="muted">input</span> ${esc(p.params.map((n, k) => `${n}=${fmtVal(args[k])}`).join(', '))}</div><div class="mono xs"><span class="muted">expected</span> ${esc(fmtVal(exp))}</div>${rr ? `<div class="mono xs"><span class="muted">output</span> ${esc(rr.error ? `Error: ${rr.error}` : rr.got)}</div>` : ''}</div>`; }).join('')}</div>`;
  } else if (bottomTab === 'custom') {
    const cr = r?.kind === 'custom' ? r.results[0] : null;
    body = `<div class="stack" style="--gap:8px"><label class="small" for="custom-in">Arguments as a JSON array, in order: <code>[${esc(p.params.join(', '))}]</code></label><textarea id="custom-in" class="textarea mono" rows="2" data-input="customIn">${esc(L.input)}</textarea><div class="row">${btn('Run with this input', { act: 'runCustom', sm: true, ic: 'play' })}${L.err ? `<span class="error-text">${esc(L.err)}</span>` : ''}</div>${cr ? `<div class="case"><div class="mono xs"><span class="muted">output</span> ${esc(cr.error ? `Error: ${cr.error}` : cr.got)}</div><div class="mono xs muted">${cr.ms.toFixed(2)} ms</div></div>` : ''}</div>`;
  } else {
    const logs = r?.logs || [];
    body = logs.length ? `<pre class="console">${esc(logs.join('\n'))}</pre>` : `<p class="small muted">console.log output from your last run appears here.</p>`;
  }
  const status = r ? `<div class="run-status ${r.status === 'Accepted' ? 'ok' : r.status === 'Ran' ? '' : 'bad'}" role="status"><b>${esc(r.kind === 'submit' ? r.status : r.status === 'Accepted' ? 'Sample tests passed' : r.status)}</b>${r.kind === 'submit' && r.total ? ` · ${r.passed}/${r.total} tests` : ''} · ${r.ms} ms${r.error ? `<div class="small">${esc(r.error)}</div>` : ''}</div>` : '';
  return `${status}${tabs([['tests', 'Sample tests'], ['custom', 'Custom input'], ['console', 'Console']], bottomTab, 'bottomTab', { label: 'Run panels' })}<div class="lab-bottom-body">${body}</div>`;
}

function contestBar(ctx) {
  if (!ctx.query.contest) return '';
  const c = weeklyContest(ctx.now);
  const L = ctx.local('contest', { startedAt: null });
  if (!L.startedAt) L.startedAt = Date.now();
  return `<div class="contest-bar" role="status"><b>${esc(c.title)}</b><span>Timed mode · ${c.minutes} minutes</span><span class="mono" id="contest-timer"></span><span class="row">${c.problems.map((id, i) => `<a class="chip" href="#/lab/${id}?contest=1" ${id === ctx.params.problem ? 'aria-current="page"' : ''}>P${i + 1}</a>`).join('')}</span></div>`;
}

export default {
  perms: ['lab.use'],
  title: (ctx) => `${currentProblem(ctx)?.title || 'Coding Lab'} · Coding Lab`,
  render(ctx) {
    const p = currentProblem(ctx);
    ctx.local('lab').last = p.id;
    const lang = langOf(ctx);
    const solved = ctx.s.submissions.some((x) => x.studentId === ctx.me.id && x.problemId === p.id && x.status === 'Accepted');
    const back = ctx.query.from;
    const langInfo = LANGS.find((l) => l.id === lang);
    return `<div class="page lab-page">
      ${contestBar(ctx)}
      <div class="spread"><div class="min0"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/arena">Practice Arena</a><span aria-hidden="true">/</span><span aria-current="page">Coding Lab</span></nav><h1 id="page-title" style="font-size:1.45rem">${esc(p.title)}</h1><div class="row" style="--gap:6px;margin-top:6px"><span class="pill plain diff-${p.diff.toLowerCase()} p-mute">${p.diff}</span>${p.topics.map(tag).join('')}${solved ? pill('Solved', 'p-ok') : ''}${p.custom ? pill('Instructor problem', 'p-info') : ''}</div></div>
        <div class="row">${back ? btn('Back to lesson', { href: back, ic: 'back', sm: true }) : ''}${btn('Problem list', { act: 'pickProblem', ic: 'list', sm: true })}</div></div>
      <div class="lab">
        <section class="panel lab-left" id="lab-left" aria-label="Problem">${leftPanel(ctx, p)}</section>
        <section class="lab-right" aria-label="Editor">
          <div class="editor-bar">
            ${select({ id: 'lab-lang', value: lang, options: LANGS.map((l) => [l.id, l.label + (l.runnable ? '' : ' (server)')]), sm: true, a: { 'data-change': 'lang', 'aria-label': 'Language' } })}
            <span class="grow"></span>
            ${btn('', { act: 'format', ic: 'edit', sm: true, cls: 'btn-quiet', title: 'Format code (Alt+Shift+F)' })}
            ${btn('', { act: 'reset', ic: 'reset', sm: true, cls: 'btn-quiet', title: 'Reset to starter code' })}
            ${btn('Run', { act: 'run', ic: 'play', sm: true, cls: 'btn-ghost', title: 'Run sample tests (Ctrl+Enter)' })}
            ${btn('Submit', { act: 'submit', ic: 'upload', sm: true, cls: 'btn-primary', title: 'Submit against all tests (Ctrl+Shift+Enter)', disabled: ctx.me.role !== 'student' && false })}
          </div>
          ${!langInfo.runnable ? `<div class="callout warn small" style="border-radius:0">${esc(langInfo.label)} code is judged by the server-side execution service, which is not connected in this build. You can write and save it here; switch to JavaScript to run tests in the browser sandbox.</div>` : ''}
          <div class="editor-wrap"><textarea id="code" aria-label="Code editor"></textarea></div>
          <div class="lab-bottom" id="lab-bottom">${bottomPanel(ctx, p)}</div>
        </section>
      </div></div>`;
  },
  mount(root, ctx) {
    const p = currentProblem(ctx);
    const lang = langOf(ctx);
    const ta = root.querySelector('#code');
    const draft = ctx.s.labDrafts[draftKey(p.id, lang)];
    ta.value = draft ?? starter(p, lang);
    cm = CodeMirror.fromTextArea(ta, { mode: MODES[lang], lineNumbers: true, indentUnit: lang === 'python' ? 4 : 2, tabSize: 2, matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true, theme: 'avgenx', viewportMargin: 50,
      extraKeys: { 'Ctrl-Enter': () => this.actions.run(null, null, ctx), 'Cmd-Enter': () => this.actions.run(null, null, ctx), 'Shift-Ctrl-Enter': () => this.actions.submit(null, null, ctx), 'Shift-Cmd-Enter': () => this.actions.submit(null, null, ctx), 'Shift-Alt-F': () => format(), 'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment', Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection(' '.repeat(c.getOption('indentUnit')))), Esc: () => document.querySelector('.lab-right .btn-primary')?.focus() } });
    cm.getInputField().setAttribute('aria-label', `${p.title}: ${LANGS.find((l) => l.id === lang).label} code editor. Press Escape to leave the editor.`);
    saveDraft = debounce(() => store.commit('lab.draft', (s) => { s.labDrafts[draftKey(p.id, langOf(ctx))] = cm.getValue(); }, { silent: true }), 600);
    cm.on('change', () => saveDraft());
    setCopilotContext(() => `Coding Lab problem "${p.title}" (${p.diff}; topics ${p.topics.join(', ')}). Statement: ${p.statement} Learner's current ${lang} code:\n\`\`\`${lang}\n${cm?.getValue().slice(0, 4000)}\n\`\`\`${lastResult?.problemId === p.id ? `\nLast result: ${lastResult.status}${lastResult.error ? ` (${lastResult.error})` : ''}` : ''}`);
    const timerEl = root.querySelector('#contest-timer');
    if (timerEl) { const L = ctx.local('contest'); const end = L.startedAt + 90 * 60000; const tick = () => { const left = Math.max(0, end - Date.now()); timerEl.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left`; if (left > 0 && document.body.contains(timerEl)) setTimeout(tick, 1000); }; tick(); }
  },
  unmount() { saveDraft?.cancel?.(); if (cm) { try { store.commit('lab.draft', (s) => { /* flush on leave */ }, { silent: true }); } catch { /* ignore */ } cm.toTextArea(); cm = null; } running?.abort(); setCopilotContext(null); lastResult = null; },
  onStoreChange(ctx, d) { if (['lab.draft', 'ai.thread'].includes(d.label)) return false; return !cm; },
  actions: {
    leftTab(el, e, ctx) { leftTab = el.dataset.id; document.querySelector('#lab-left').innerHTML = leftPanel(ctx, currentProblem(ctx)); },
    bottomTab(el, e, ctx) { bottomTab = el.dataset.id; document.querySelector('#lab-bottom').innerHTML = bottomPanel(ctx, currentProblem(ctx)); },
    hint(el, e, ctx) { const p = currentProblem(ctx); ctx.local(`hints:${p.id}`).shown++; document.querySelector('#lab-left').innerHTML = leftPanel(ctx, p); },
    showSolution(el, e, ctx) {
      const p = currentProblem(ctx);
      ctx.confirm({ title: 'Show the reference solution?', body: 'Your next accepted submission on this problem will not earn the first-try bonus. Hints are usually a better next step.', confirmLabel: 'Show solution' }).then((ok) => { if (!ok) return; ctx.local(`hints:${p.id}`).solution = true; store.commit('lab.solutionViewed', (s) => { s.submissions.push({ id: uid('SB'), studentId: ctx.me.id, problemId: p.id, lang: 'javascript', at: new Date().toISOString(), status: 'Solution viewed', passed: 0, total: p.tests.length, ms: 0 }); }, { silent: true }); document.querySelector('#lab-left').innerHTML = leftPanel(ctx, p); });
    },
    loadSub(el, e, ctx) { const x = ctx.s.submissions.find((s) => s.id === el.dataset.id); if (x?.code && cm) { cm.setValue(x.code); ctx.toast('Loaded code from that submission'); } },
    lang(el, e, ctx) { saveDraft?.cancel?.(); if (cm) store.commit('lab.draft', (s) => { s.labDrafts[draftKey(currentProblem(ctx).id, langOf(ctx))] = cm.getValue(); }, { silent: true }); ctx.local('lab').lang = el.value; lastResult = null; cm?.toTextArea(); cm = null; ctx.rerender(); },
    format() { format(); },
    reset(el, e, ctx) { ctx.confirm({ title: 'Reset to starter code?', body: 'Your current code for this problem and language will be replaced. Submitted code stays in your submission history.', confirmLabel: 'Reset code', danger: true }).then((ok) => { if (ok && cm) { const p = currentProblem(ctx); cm.setValue(starter(p, langOf(ctx))); } }); },
    customIn(el, e, ctx) { ctx.local(`custom:${currentProblem(ctx).id}`).input = el.value; },
    pickProblem(el, e, ctx) { pickProblem(ctx); },
    async run(el, e, ctx) { await execute(ctx, 'run'); },
    async submit(el, e, ctx) { await execute(ctx, 'submit'); },
    async runCustom(el, e, ctx) { await execute(ctx, 'custom'); },
  },
};

function format() {
  if (!cm) return;
  const cur = cm.getCursor();
  cm.operation(() => { for (let i = 0; i < cm.lineCount(); i++) cm.indentLine(i, 'smart'); cm.setValue(cm.getValue().replace(/[ \t]+$/gm, '')); });
  cm.setCursor(cur);
}

async function execute(ctx, kind) {
  if (!cm || running) return;
  const p = currentProblem(ctx);
  const lang = langOf(ctx);
  const code = cm.getValue();
  const bottom = document.querySelector('#lab-bottom');
  let cases;
  if (kind === 'custom') {
    const L = ctx.local(`custom:${p.id}`);
    try { const args = JSON.parse(L.input); if (!Array.isArray(args)) throw new Error('Wrap the arguments in a JSON array.'); if (args.length !== p.params.length) throw new Error(`Expected ${p.params.length} argument${p.params.length > 1 ? 's' : ''}.`); cases = [{ args }]; L.err = ''; } catch (err) { L.err = `Invalid input: ${err.message}`; bottomTab = 'custom'; bottom.innerHTML = bottomPanel(ctx, p); return; }
  } else cases = (kind === 'run' ? p.tests.slice(0, 2) : p.tests).map(([args, expected]) => ({ args, expected }));
  bottom.innerHTML = `<div class="run-status" role="status"><b>${kind === 'submit' ? 'Judging against all tests…' : 'Running…'}</b></div>`;
  running = new AbortController();
  const r = lang === 'javascript' ? await runJS({ code, fn: p.fn, cases, signal: running.signal }) : await runRemote({ endpoint: ctx.s.settings.integrations.execution.endpoint, lang, code, problemId: p.id });
  running = null;
  const passed = r.results.filter((x) => x.passed).length;
  lastResult = { ...r, kind, problemId: p.id, passed, total: cases.length };
  bottomTab = kind === 'custom' ? 'custom' : r.logs?.length && r.status !== 'Accepted' && kind !== 'submit' ? 'console' : bottomTab === 'console' ? 'console' : kind === 'custom' ? 'custom' : 'tests';
  if (kind === 'submit' && r.status !== 'Unavailable' && r.status !== 'Cancelled') {
    const status = r.status === 'Ran' ? 'Wrong Answer' : r.status;
    const firstSolve = status === 'Accepted' && !ctx.s.submissions.some((x) => x.studentId === ctx.me.id && x.problemId === p.id && x.status === 'Accepted');
    ctx.commit('lab.submit', (s) => { s.submissions.push({ id: uid('SB'), studentId: ctx.me.id, problemId: p.id, lang, at: new Date().toISOString(), status, passed, total: cases.length, ms: r.ms, code }); }, { silent: true });
    lastResult.status = status;
    ctx.toast(status === 'Accepted' ? (firstSolve && ctx.flag('gamification') && ctx.me.role === 'student' ? `Accepted · +${ctx.s.settings.xp[`solve${p.diff}`]} XP for a first solve` : 'Accepted') : `${status}: ${passed}/${cases.length} tests passed`, { tone: status === 'Accepted' ? '' : 'bad' });
    document.querySelector('#lab-left').innerHTML = leftPanel(ctx, p);
  }
  bottom.innerHTML = bottomPanel(ctx, p);
}

function pickProblem(ctx) {
  const F = ctx.local('labPick', { q: '', diff: 'all' });
  const render = () => {
    const solved = new Set(ctx.s.submissions.filter((x) => x.studentId === ctx.me.id && x.status === 'Accepted').map((x) => x.problemId));
    const list = allProblems(ctx.s).filter((p) => (F.diff === 'all' || p.diff === F.diff) && (!F.q || `${p.title} ${p.topics.join(' ')}`.toLowerCase().includes(F.q.toLowerCase())));
    return { title: 'Choose a problem', sub: `${allProblems(ctx.s).length} problems`, body: `<div class="row"><input class="input" id="pp-q" placeholder="Filter by title or topic" value="${esc(F.q)}" aria-label="Filter problems"><div class="btn-group" role="group" aria-label="Difficulty">${['all', 'Easy', 'Medium', 'Hard'].map((d) => `<button type="button" data-pp-diff="${d}" aria-pressed="${F.diff === d}">${d === 'all' ? 'All' : d}</button>`).join('')}</div></div><div class="list" id="pp-list">${list.map((p) => `<a class="item" href="#/lab/${p.id}">${solved.has(p.id) ? icon('check', 'style="width:16px;height:16px;color:var(--ok)"') : icon('code', 'style="width:16px;height:16px;color:var(--faint)"')}<span class="grow min0"><span class="t">${esc(p.title)}</span><br><span class="s">${p.topics.join(', ')}</span></span><span class="small diff-${p.diff.toLowerCase()}">${p.diff}</span></a>`).join('')}</div>` };
  };
  ctx.openPanel(render);
  const wire = () => {
    const d = document.querySelector('#drawer');
    d.querySelector('#pp-q')?.addEventListener('input', (e) => { F.q = e.target.value; const b = d.querySelector('.drawer-body'); const pos = e.target.selectionStart; b.innerHTML = render().body; wire(); const i = d.querySelector('#pp-q'); i.focus(); i.setSelectionRange(pos, pos); });
    d.querySelectorAll('[data-pp-diff]').forEach((b) => (b.onclick = () => { F.diff = b.dataset.ppDiff; d.querySelector('.drawer-body').innerHTML = render().body; wire(); }));
    d.querySelectorAll('#pp-list a').forEach((a) => a.addEventListener('click', () => d.querySelector('[data-close]').click()));
  };
  wire();
}
