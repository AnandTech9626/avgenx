// AI provider abstraction for the learning copilot.
//
// Providers, tried in order:
//  1. ClaudeArtifactProvider: when this page runs inside a Claude artifact viewer, the viewer's
//     own Claude account answers through window.claude.use('sample'). No API key in the page.
//  2. HttpProvider: POST {endpoint} on your own backend (see netlify/functions/ai.mjs), which
//     holds the API key server-side and streams the answer.
//  3. None: the copilot shows an explicit "not connected" state and offers offline course
//     content (lesson outlines, problem hints). It never fabricates AI answers.

import { csrfToken } from '../core/session.js';

let artifactSample = null;
let artifactChecked = false;
let serverEndpoint = '';
/** The AVGENX server has an AI key configured; requests go to it with the session's CSRF token. */
export const setServerAI = (endpoint) => { serverEndpoint = endpoint; };
const endpointOf = (settings) => settings?.integrations?.ai?.endpoint || serverEndpoint;
let artifactPromise = null;

function detectArtifact() {
  if (artifactPromise) return artifactPromise;
  artifactPromise = (async () => {
    try {
      if (typeof window === 'undefined' || !window.claude?.use) return null;
      artifactSample = await window.claude.use('sample');
      return artifactSample;
    } catch { return null; } finally { artifactChecked = true; }
  })();
  return artifactPromise;
}

export function providerStatus(settings) {
  if (artifactSample) return { id: 'claude-artifact', label: 'Claude (your account, via the artifact viewer)', live: true };
  if (endpointOf(settings)) return { id: 'http', label: serverEndpoint && !settings?.integrations?.ai?.endpoint ? 'AVGENX server (key held server side)' : `Your AI endpoint (${endpointOf(settings)})`, live: true };
  if (!artifactChecked && typeof window !== 'undefined' && window.claude?.use) return { id: 'checking', label: 'Checking for an AI provider…', live: false };
  return { id: 'none', label: 'Not connected', live: false };
}
export const initAI = () => detectArtifact();

const SYSTEM = (ctx) => `You are the AVGENX Academy learning copilot for a coding institute. Be accurate, concise and encouraging. Teach rather than hand over full solutions to graded work: for assessment or project code, give hints, explanations and debugging guidance, not complete answers. Use short paragraphs, bullet lists and fenced code blocks where helpful. If you are unsure, say so.

Learner context (from the platform, may be partial):
${ctx}`;

/**
 * Ask the active provider. turns: [{role, content}] ending with the user's message.
 * Streams via onText({text}). Resolves {text, provider} or rejects {code, message, text?}.
 */
export async function ask({ turns, context, onText, signal, settings, mode = 'chat' }) {
  await Promise.race([detectArtifact(), new Promise((r) => setTimeout(r, 1500))]);
  const msgs = [{ role: 'user', content: SYSTEM(context) }, ...turns.slice(-12)];
  if (artifactSample) {
    try {
      const r = await artifactSample(msgs, { onText, signal, cache: mode === 'chat' ? false : undefined, modelTier: mode === 'quick' ? 'quick' : 'default' });
      return { text: r.text, truncated: r.truncated, provider: 'claude-artifact' };
    } catch (e) { throw { code: e?.code || 'upstream_error', message: e?.message || 'The AI request failed.', text: e?.text }; }
  }
  const endpoint = endpointOf(settings);
  if (endpoint) {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() }, credentials: 'same-origin', body: JSON.stringify({ messages: msgs }), signal }).catch((e) => { throw { code: e.name === 'AbortError' ? 'cancelled' : 'upstream_error', message: `Could not reach ${endpoint}` }; });
    if (!res.ok) throw { code: 'upstream_error', message: `AI endpoint returned ${res.status}` };
    if (res.body && res.headers.get('content-type')?.includes('text/event-stream')) {
      return { text: await readSSE(res.body, onText), provider: 'http' };
    }
    const j = await res.json();
    onText?.({ text: j.text });
    return { text: j.text, provider: 'http' };
  }
  throw { code: 'not_configured', message: 'No AI provider is connected.' };
}

/** Parse `data: {"text": ...}` server-sent events, buffering lines split across chunks. */
export async function readSSE(body, onText) {
  const reader = body.getReader(); const dec = new TextDecoder(); let text = ''; let buf = '';
  const take = (line) => { if (!line.startsWith('data: ')) return; try { const d = JSON.parse(line.slice(6)); if (d.text) { text += d.text; onText?.({ text }); } } catch { /* keep-alive or malformed line */ } };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    lines.forEach(take);
  }
  take(buf + dec.decode());
  return text;
}

export const ERROR_COPY = {
  not_granted: 'You declined AI access for this page. The copilot stays off for this visit.',
  sampling_disabled: 'AI is not available for this account.',
  rate_limited: 'Too many requests right now. Wait a moment and try again.',
  refused: 'The assistant declined this request. Try rephrasing it.',
  cancelled: '',
  not_configured: 'No AI provider is connected.',
  session_expired: 'Your session expired. Sign in again to use the copilot.',
};
export const errorCopy = (e) => ERROR_COPY[e?.code] ?? (e?.message || 'Something went wrong. Try again.');
