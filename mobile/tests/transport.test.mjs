import test from 'node:test';
import assert from 'node:assert/strict';
import { requestWithBase } from '../src/lib/transport.ts';
test('uses the selected backend and forwards the incident update payload', async () => {
  let captured;
  const send = async (url, options) => { captured = { url, options }; return new Response(JSON.stringify({ id:'TVR-2050', revision:2 }), { status:200 }); };
  const result = await requestWithBase('https://api.example', '/api/incidents/TVR-2050/updates', { method:'POST', body:JSON.stringify({ description:'Condition worsened', attachments:[] }) }, send);
  assert.equal(captured.url, 'https://api.example/api/incidents/TVR-2050/updates');
  assert.deepEqual(JSON.parse(captured.options.body), { description:'Condition worsened', attachments:[] });
  assert.equal(result.revision, 2);
});
test('surfaces backend error details to reporters', async () => {
  const send = async () => new Response(JSON.stringify({ detail:'This incident is closed.' }), { status:409 });
  await assert.rejects(requestWithBase('https://api.example', '/api/incidents/TVR-1/updates', {}, send), /This incident is closed/);
});
test('network errors do not masquerade as a saved report', async () => {
  await assert.rejects(requestWithBase('https://api.example', '/api/incidents', {}, async () => { throw new TypeError('Network failed'); }), /Cannot reach the server/);
});
