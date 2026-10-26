// AI learning copilot panel: context-aware, streaming, with history, suggested prompts,
// feedback and an honest offline mode when no provider is connected.
import { icon } from '../core/icons.js';
import { esc, fmtTime, uid } from '../core/util.js';
import { drawer } from '../core/overlays.js';
import * as store from '../core/store.js';
import { ask, providerStatus, errorCopy } from '../services/ai.js';
import { PROBLEMS } from '../data/problems.js';
import { progressOf, findLesson } from '../domain/progress.js';
import { solvedProblems } from '../domain/career.js';

let pageContext = null; // set by views (lesson player, lab) via setCopilotContext
export const setCopilotContext = (fn) => { pageContext = fn; };
export const copilotButton = () => `<button type="button" class="btn btn-ghost btn-sm" data-act="g:copilot" aria-label="Open AI learning copilot">${icon('sparkle')}<span class="hide-sm">Copilot</span></button>`;

/** Minimal, safe markdown: escapes first, then formats fences, inline code, bold, lists. */
export function md(text) {
  const parts = String(text || '').split(/```/);
  return parts.map((p, i) => {
    if (i % 2) { const nl = p.indexOf('\n'); const lang = nl > -1 ? p.slice(0, nl).trim() : ''; const code = nl > -1 ? p.slice(nl + 1) : p; return `<pre class="md-code"><code data-lang="${esc(lang)}">${esc(code.replace(/\n$/, ''))}</code></pre>`; }
    return esc(p).split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      const fmt = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l) || !l.trim())) return `<ul>${lines.filter((l) => l.trim()).map((l) => `<li>${fmt(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</ul>`;
      if (/^#{1,4}\s/.test(lines[0])) return `<p><b>${fmt(lines[0].replace(/^#+\s/, ''))}</b>${lines.slice(1).length ? '<br>' + lines.slice(1).map(fmt).join('<br>') : ''}</p>`;
      return block.trim() ? `<p>${lines.map(fmt).join('<br>')}</p>` : '';
    }).join('');
  }).join('');
}

function learnerContext(ctx) {
  const s = ctx.s;
  const me = ctx.me;
  const lines = [`Role: ${me.role}. Name: ${me.name}.`];
  if (me.role === 'student') {
    const st = s.students.find((x) => x.id === me.id);
    const cohort = s.cohorts.find((c) => c.id === st.cohortId);
    lines.push(`Cohort: ${cohort?.name}. Preferred language: ${st.lang}.`);
    s.enrollments.filter((e) => e.studentId === me.id).forEach((e) => { const c = s.courses.find((x) => x.id === e.courseId); const p = progressOf(c, e); lines.push(`Course ${c.id} ${c.title}: ${p.pct}% done${p.next ? `, next lesson "${p.next.title}"` : ''}.`); });
    lines.push(`Problems solved: ${solvedProblems(s, me.id).length}.`);
    const due = s.projects.filter((p) => p.studentId === me.id && ['assigned', 'in_progress', 'revision'].includes(p.state)).map((p) => `${p.assignmentId} (${p.state}, due ${p.due})`);
    if (due.length) lines.push(`Open projects: ${due.join('; ')}.`);
  }
  const pc = pageContext?.();
  if (pc) lines.push(`Current page: ${pc}`);
  return lines.join('\n');
}

function suggestions(ctx, route) {
  const p = route.path || '';
  if (p.startsWith('/lab')) return ['Explain my code line by line', 'Why might my solution fail the hidden tests?', 'Give me a hint, not the answer', 'What is the time complexity of my approach?'];
  if (p.includes('/learn/')) return ['Summarise this lesson in five bullets', 'Quiz me with three questions on this lesson', 'Explain the hardest idea here more simply', 'Give me a real-world example'];
  if (p.startsWith('/interview') || p.startsWith('/placement')) return ['Run a short behavioural interview with me', 'Ask me one system design question', 'How should I prepare for my next mock interview?'];
  if (p.startsWith('/projects')) return ['Help me plan my project in milestones', 'What should my README include?', 'How do I respond to revision feedback?'];
  return ['Make me a study plan for this week', 'What should I learn next and why?', 'Recommend practice problems for my weak topics', 'Create a revision summary of my current course'];
}

/** Offline helpers: deterministic content from course data. Clearly labelled, not AI. */
function offlineHelper(ctx, kind) {
  const s = ctx.s, me = ctx.me;
  if (me.role !== 'student') return 'Offline helpers are built for learners. Connect an AI provider to use the copilot as staff.';
  const enr = s.enrollments.filter((e) => e.studentId === me.id && e.status !== 'completed');
  if (kind === 'plan') {
    const items = [];
    enr.forEach((e) => { const c = s.courses.find((x) => x.id === e.courseId); const lessons = c.modules.flatMap((m) => m.lessons).filter((l) => !e.done[l.id]).slice(0, 3); lessons.forEach((l) => items.push(`- ${c.id}: ${l.title} (${l.mins} min, ${l.type})`)); });
    s.projects.filter((p) => p.studentId === me.id && ['assigned', 'in_progress', 'revision'].includes(p.state)).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 2).forEach((p) => items.push(`- Project ${p.assignmentId}: ${p.state === 'revision' ? 'address revision feedback' : 'next milestone'} (due ${p.due})`));
    const solved = new Set(solvedProblems(s, me.id).map((p) => p.id));
    PROBLEMS.filter((p) => !solved.has(p.id) && p.diff !== 'Hard').slice(0, 3).forEach((p) => items.push(`- Practice: ${p.title} (${p.diff}, ${p.topics.join(', ')})`));
    return `**This week's plan (built from your course data)**\n\n${items.join('\n') || '- You are all caught up. Pick a new course from Explore Programs.'}`;
  }
  if (kind === 'summary') {
    const e = enr[0]; if (!e) return 'No course in progress.';
    const c = s.courses.find((x) => x.id === e.courseId);
    return `**${c.id} ${c.title}: revision outline**\n\nOutcomes:\n${c.outcomes.map((o) => `- ${o}`).join('\n')}\n\nModules:\n${c.modules.map((m) => `- ${m.title}: ${m.lessons.map((l) => l.title).join(', ')}`).join('\n')}`;
  }
  return '';
}

export function openCopilot(ctx, route) {
  const thread = () => (store.getState().aiThreads[ctx.me.id] ||= []);
  let ctl = null;
  let busy = false;
  const render = () => {
    const st = providerStatus(store.getState().settings);
    const inExam = store.getState().attempts.some((a) => a.studentId === ctx.me.id && a.status === 'in_progress');
    const msgs = thread();
    return `
      <div class="copilot">
        <div class="row small">${st.live ? `<span class="pill p-ok">Live</span><span class="muted">${esc(st.label)}</span>` : st.id === 'checking' ? `<span class="pill p-mute">Checking</span><span class="muted">Looking for an AI provider…</span>` : `<span class="pill p-warn">AI not connected</span><span class="muted">Offline helpers available</span>`}</div>
        ${!st.live ? `<div class="callout warn small"><b>No AI provider is connected.</b> The copilot will not invent answers. Connect a provider under Integrations (server-side key), or open this page inside Claude to use your own account. Meanwhile, the offline helpers below build plans and outlines from your course data.</div>
          <div class="row"><button type="button" class="btn btn-ghost btn-sm" data-cp="offline-plan">${icon('route')}Weekly plan from my data</button><button type="button" class="btn btn-ghost btn-sm" data-cp="offline-summary">${icon('book')}Revision outline</button></div>` : ''}
        ${inExam ? `<div class="callout bad small"><b>Paused during your assessment.</b> The copilot is unavailable while an assessment attempt is open, to protect academic integrity.</div>` : ''}
        <div class="chat" id="cp-log" aria-live="polite">${msgs.length ? msgs.map((m, i) => bubble(m, i)).join('') : `<div class="empty" style="border:0">${icon('sparkle')}<b>Ask about your lessons, code or plans</b><span>The copilot sees your current page and progress. It gives hints on graded work, not full solutions.</span></div>`}</div>
        <div class="chips" aria-label="Suggested prompts">${suggestions(ctx, route).map((q) => `<button type="button" class="chip" data-cp-suggest="${esc(q)}" ${!st.live || inExam ? 'disabled' : ''}>${esc(q)}</button>`).join('')}</div>
        <form class="chat-in" data-cp-form>
          <label class="sr-only" for="cp-input">Message the copilot</label>
          <textarea id="cp-input" class="textarea" rows="2" placeholder="${st.live ? 'Ask a question. Enter to send, Shift+Enter for a new line.' : 'Connect an AI provider to chat.'}" ${!st.live || inExam ? 'disabled' : ''}></textarea>
          <div class="row"><button type="button" class="btn btn-quiet btn-sm" data-cp="clear" ${msgs.length ? '' : 'disabled'}>Clear history</button><span class="hint grow">History is kept ${store.getState().settings.retention.chatDays} days on this device.</span>${busy ? `<button type="button" class="btn btn-danger btn-sm" data-cp="stop">${icon('stop')}Stop</button>` : `<button type="submit" class="btn btn-primary btn-sm" ${!st.live || inExam ? 'disabled' : ''}>${icon('send')}Send</button>`}</div>
        </form>
      </div>`;
  };
  const bubble = (m, i) => `<div class="msg ${m.role}"><div class="msg-meta">${m.role === 'user' ? 'You' : m.offline ? 'Offline helper (not AI)' : 'Copilot'} · ${fmtTime(m.at)}</div><div class="msg-body">${m.role === 'user' ? `<p>${esc(m.content).replace(/\n/g, '<br>')}</p>` : md(m.content)}${m.error ? `<p class="error-text">${esc(m.error)}</p>` : ''}</div>${m.role === 'assistant' && !m.offline && !m.error ? `<div class="row msg-fb"><button type="button" class="btn btn-quiet btn-xs" data-cp-fb="${i}:up" aria-pressed="${m.feedback === 'up'}" aria-label="Helpful">${icon('thumbUp')}</button><button type="button" class="btn btn-quiet btn-xs" data-cp-fb="${i}:down" aria-pressed="${m.feedback === 'down'}" aria-label="Not helpful">${icon('thumbDown')}</button></div>` : ''}</div>`;

  let ref = null;
  const redraw = () => { if (!ref) return; const body = ref.el.querySelector('.drawer-body'); body.innerHTML = render(); const log = body.querySelector('#cp-log'); log.scrollTop = log.scrollHeight; bind(); };
  const save = () => store.commit('ai.thread', () => {}, { silent: true });
  async function send(text) {
    const t = text.trim(); if (!t || busy) return;
    thread().push({ role: 'user', content: t, at: new Date().toISOString() });
    const reply = { role: 'assistant', content: 'Thinking…', at: new Date().toISOString(), id: uid('m') };
    thread().push(reply);
    busy = true; ctl = new AbortController(); redraw();
    const bodyEl = () => ref?.el.querySelector('.msg.assistant:last-child .msg-body');
    try {
      const turns = thread().filter((m) => !m.offline && !m.error && m !== reply && m.content !== 'Thinking…').map((m) => ({ role: m.role, content: m.content }));
      const r = await ask({ turns, context: learnerContext(ctx), signal: ctl.signal, settings: store.getState().settings, onText: ({ text: tx }) => { reply.content = tx; const b = bodyEl(); if (b) b.innerHTML = md(tx); } });
      reply.content = r.text + (r.truncated ? '\n\n(Answer cut short. Ask for less at a time.)' : '');
      reply.provider = r.provider;
    } catch (e) {
      reply.content = e?.text || '';
      if (e?.code !== 'cancelled') reply.error = errorCopy(e); else reply.content ||= '(Stopped.)';
    } finally { busy = false; ctl = null; save(); redraw(); }
  }
  function bind() {
    const el = ref.el;
    const input = el.querySelector('#cp-input');
    el.querySelector('[data-cp-form]').onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(v); };
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.querySelector('[data-cp-form]').requestSubmit(); } });
    el.querySelectorAll('[data-cp-suggest]').forEach((b) => (b.onclick = () => send(b.dataset.cpSuggest)));
    el.querySelectorAll('[data-cp-fb]').forEach((b) => (b.onclick = () => { const [i, v] = b.dataset.cpFb.split(':'); const m = thread()[Number(i)]; m.feedback = m.feedback === v ? null : v; save(); redraw(); }));
    el.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.cp;
      if (k === 'stop') ctl?.abort();
      if (k === 'clear') { store.getState().aiThreads[ctx.me.id] = []; save(); redraw(); }
      if (k === 'offline-plan' || k === 'offline-summary') { thread().push({ role: 'assistant', offline: true, content: offlineHelper(ctx, k.slice(8)), at: new Date().toISOString() }); save(); redraw(); }
    }));
  }
  // prune old history per retention policy
  const keep = Date.now() - store.getState().settings.retention.chatDays * 864e5;
  store.getState().aiThreads[ctx.me.id] = thread().filter((m) => new Date(m.at).getTime() > keep);
  ref = drawer({ title: 'Learning copilot', sub: 'Context: ' + esc(route.path || '/'), body: render(), wide: false, onMount: (el) => { ref = { el }; bind(); const log = el.querySelector('#cp-log'); log.scrollTop = log.scrollHeight; setTimeout(() => el.querySelector('#cp-input:not([disabled])')?.focus(), 30); }, onClose: () => { ctl?.abort(); ref = null; } });
  ref = { el: ref.el };
}
