import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeller } from '../seller.mjs';

const key = 'am_fake_seller_for_tests';
const args = ['--file', 'sample.json', '--name', 'Synthetic data', '--description', 'Synthetic fixture only', '--license', 'MIT', '--price', '20'];
async function fixture(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'seller-example-test-'));
  writeFileSync(join(cwd, 'sample.json'), '[{"agents":12}]');
  try { await fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}
function api({ disconnect = false, echoKey = false } = {}) {
  const requests = [];
  const results = new Map();
  let interrupted = false;
  return {
    requests, results,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'manual');
      const path = new URL(url).pathname;
      requests.push({ path, ...options });
      if (path.endsWith('/connection')) return Response.json({ connected: true, agent: { id: 'seller' } });
      if (echoKey) return Response.json({ error: `Invalid credential ${key}` }, { status: 401 });
      const idem = options.headers['idempotency-key'];
      assert.ok(idem);
      if (!results.has(idem)) results.set(idem, { id: `resource-${results.size + 1}`, status: 'pending', price: 20 });
      if (disconnect && !interrupted) { interrupted = true; throw new Error('Simulated lost response after committed publish.'); }
      return Response.json(results.get(idem));
    },
  };
}

test('seller previews locally without a key or any HTTP request', async () => fixture(async cwd => {
  const result = await runSeller({ args, cwd, env: {}, log: () => {}, fetchImpl: () => { throw new Error('No requests allowed'); } });
  assert.equal(result.mode, 'preview'); assert.equal(result.price, 20);
}));
test('seller interrupted publication resumes the exact original request without duplicate resource', async () => fixture(async cwd => {
  const mock = api({ disconnect: true });
  const options = { args: [...args, '--execute', '--run-id', 'same-publish'], env: { MARKET_API_KEY: key }, cwd, log: () => {}, fetchImpl: mock.fetchImpl };
  await assert.rejects(runSeller(options), /lost response/);
  const result = await runSeller(options);
  const replay = await runSeller(options);
  assert.equal(result.productId, replay.productId); assert.equal(result.submissionStatus, 'pending'); assert.equal(mock.results.size, 1);
  const posts = mock.requests.filter(request => request.method === 'POST');
  assert.equal(posts.length, 3);
  assert.ok(posts.every(request => request.headers['idempotency-key'] === posts[0].headers['idempotency-key'] && request.body === posts[0].body));
  assert.ok(!readFileSync(join(cwd, '.agent-market-runs/seller-same-publish.json'), 'utf8').includes(key));
}));
test('seller prevents resource changes under an existing publication run', async () => fixture(async cwd => {
  const mock = api();
  const options = { args: [...args, '--execute', '--run-id', 'fixed-input'], env: { MARKET_API_KEY: key }, cwd, log: () => {}, fetchImpl: mock.fetchImpl };
  await runSeller(options);
  writeFileSync(join(cwd, 'sample.json'), '[{"agents":99}]');
  await assert.rejects(runSeller(options), /different market, Agent or resource/);
  assert.equal(mock.requests.filter(request => request.method === 'POST').length, 1);
}));
test('seller sanitizes credential echoes and does not submit invalid JSON', async () => fixture(async cwd => {
  const mock = api({ echoKey: true });
  await assert.rejects(runSeller({ args: [...args, '--execute'], cwd, env: { MARKET_API_KEY: key }, log: () => {}, fetchImpl: mock.fetchImpl }), error => !error.message.includes(key) && error.message.includes('REDACTED'));
  writeFileSync(join(cwd, 'sample.json'), '{invalid');
  await assert.rejects(runSeller({ args, cwd, log: () => {} }), /not valid JSON/);
}));
