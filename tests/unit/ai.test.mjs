import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSSE } from '../../src/services/ai.js';
import handler from '../../server/ai-proxy.mjs';

const streamOf = (chunks) => new ReadableStream({ start(c) { const e = new TextEncoder(); chunks.forEach((x) => c.enqueue(e.encode(x))); c.close(); } });

test('SSE reader keeps lines split across network chunks', async () => {
  const seen = [];
  const text = await readSSE(streamOf(['data: {"te', 'xt":"Hel"}\n\ndata: {"text":"lo"}', '\n\n: ping\n']), ({ text: t }) => seen.push(t));
  assert.equal(text, 'Hello');
  assert.deepEqual(seen, ['Hel', 'Hello']);
});

const req = (body, headers = {}) => new Request('https://x.test/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('AI proxy reports not configured without a server key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await handler(req({ messages: [{ role: 'user', content: 'hi' }] }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'not_configured');
});

test('AI proxy keeps its own rules, trims history to a user turn, enforces origin, re-emits text', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.AI_ALLOWED_ORIGIN = 'https://ok.test';
  const realFetch = globalThis.fetch; let sent;
  globalThis.fetch = async (url, o) => { sent = { url, headers: o.headers, body: JSON.parse(o.body) }; return new Response(streamOf(['data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n', 'data: {"type":"message_stop"}\n']), { status: 200 }); };
  try {
    const bad = await handler(req({ messages: [{ role: 'user', content: 'x' }] }, { origin: 'https://evil.test' }));
    assert.equal(bad.status, 403);
    const r = await handler(req({ messages: [{ role: 'user', content: 'ctx' }, { role: 'assistant', content: 'earlier' }, { role: 'user', content: 'q' }] }, { origin: 'https://ok.test' }));
    assert.equal(r.status, 200);
    assert.equal(sent.headers['x-api-key'], 'test-key');
    assert.match(sent.body.system, /^You are the AVGENX Academy learning copilot/);
    assert.match(sent.body.system, /ctx$/);
    assert.equal(sent.body.messages[0].role, 'user');
    assert.equal(await readSSE(r.body), 'Hi');
  } finally { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; delete process.env.AI_ALLOWED_ORIGIN; }
});
