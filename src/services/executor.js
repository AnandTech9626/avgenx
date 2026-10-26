// Code execution service.
//
// JavaScript practice runs in the learner's own browser inside a dedicated Web Worker:
// no DOM, network and storage APIs removed before user code runs, and a hard wall-clock
// limit enforced by terminating the worker. This is suitable for a learner running their
// own code. It is NOT a judge for untrusted code on a server: production grading of C++,
// Java, Python and JavaScript must use the isolated server-side execution service
// (containers or a judge such as Judge0 behind POST /api/execute; see docs/API.md).

const HARNESS = `
const out = [];
const send = (m) => postMessage(m);
const eq = (a, b) => {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => eq(a[k], b[k]));
};
const fmt = (v) => { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } };
onmessage = (e) => {
  const { code, fn, cases } = e.data;
  // Remove capabilities user code has no reason to touch.
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker']) { try { self[k] = undefined; } catch {} }
  const logs = [];
  const con = { log: (...a) => logs.push(a.map(fmt).join(' ')), error: (...a) => logs.push('[error] ' + a.map(fmt).join(' ')), warn: (...a) => logs.push('[warn] ' + a.map(fmt).join(' ')), info: (...a) => logs.push(a.map(fmt).join(' ')) };
  let f;
  try {
    f = new Function('console', '"use strict";\\n' + code + '\\n;return typeof ' + fn + ' === "function" ? ' + fn + ' : undefined;')(con);
  } catch (err) {
    send({ type: 'compile', error: String(err && err.message || err), logs });
    return;
  }
  if (typeof f !== 'function') { send({ type: 'compile', error: 'Function ' + fn + ' is not defined. Keep the starter function name.', logs }); return; }
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const before = logs.length;
    const t0 = performance.now();
    try {
      const got = f(...JSON.parse(JSON.stringify(c.args)));
      const ms = performance.now() - t0;
      results.push({ i, ms, got: fmt(got), passed: 'expected' in c ? eq(got, c.expected) : null, logs: logs.slice(before) });
    } catch (err) {
      results.push({ i, ms: performance.now() - t0, error: String(err && err.message || err), passed: false, logs: logs.slice(before) });
    }
  }
  send({ type: 'done', results, logs });
};`;

let harnessUrl = null;
const harness = () => (harnessUrl ||= URL.createObjectURL(new Blob([HARNESS], { type: 'text/javascript' })));

export const LANGS = [
  { id: 'javascript', label: 'JavaScript', runnable: true },
  { id: 'python', label: 'Python 3', runnable: false },
  { id: 'java', label: 'Java 21', runnable: false },
  { id: 'cpp', label: 'C++ 20', runnable: false },
];

/**
 * Run JavaScript against cases. cases: [{ args, expected? }]
 * Resolves { status, results, logs, ms, error? }. Never rejects.
 */
export function runJS({ code, fn, cases, timeoutMs = 2500, signal }) {
  return new Promise((resolve) => {
    let worker;
    try { worker = new Worker(harness()); } catch (err) { resolve({ status: 'Unavailable', results: [], logs: [], ms: 0, error: `This browser blocked the code sandbox: ${err.message}` }); return; }
    const t0 = performance.now();
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); resolve({ ...r, ms: Math.round(performance.now() - t0) }); };
    const timer = setTimeout(() => finish({ status: 'Time Limit Exceeded', results: [], logs: [], error: `Stopped after ${timeoutMs / 1000}s. Check for an infinite loop or an algorithm that is too slow.` }), timeoutMs);
    signal?.addEventListener('abort', () => finish({ status: 'Cancelled', results: [], logs: [] }));
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'compile') return finish({ status: 'Compile Error', results: [], logs: m.logs, error: m.error });
      const anyError = m.results.find((r) => r.error);
      const judged = m.results.filter((r) => r.passed !== null);
      const status = anyError ? 'Runtime Error' : judged.length && judged.every((r) => r.passed) ? 'Accepted' : judged.length ? 'Wrong Answer' : 'Ran';
      finish({ status, results: m.results, logs: m.logs, error: anyError?.error });
    };
    worker.onerror = (e) => { e.preventDefault(); finish({ status: 'Runtime Error', results: [], logs: [], error: e.message }); };
    worker.postMessage({ code, fn, cases });
  });
}

/** Remote execution for non-JS languages. Requires the server-side execution service. */
export async function runRemote({ endpoint, lang, code, problemId }) {
  if (!endpoint) return { status: 'Unavailable', results: [], logs: [], ms: 0, error: `${LANGS.find((l) => l.id === lang)?.label || lang} runs on the isolated execution service, which is not connected in this build. Switch to JavaScript to run code here, or configure the execution service under Integrations.` };
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, code, problemId }) });
    if (!r.ok) throw new Error(`Execution service returned ${r.status}`);
    return await r.json();
  } catch (err) {
    return { status: 'Unavailable', results: [], logs: [], ms: 0, error: `Could not reach the execution service: ${err.message}` };
  }
}
