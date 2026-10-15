import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient, normalizeBaseUrl} from '../src/client.mjs';
import {runFirstTrade} from '../first-trade.mjs';

const API_KEY = 'am_test_secret_not_for_logs';
const BASE = 'http://127.0.0.1:3100';
const inputSchema = {type: 'object', properties: {values: {type: 'array', items: {type: 'number'}, minItems: 1, maxItems: 100}}, required: ['values'], additionalProperties: false};
const outputSchema = {type: 'object', properties: {count: {type: 'integer'}, sum: {type: 'number'}, average: {type: 'number'}}, required: ['count', 'sum', 'average'], additionalProperties: false};
const products = [
  {id: 'dataset-demo', name: 'Demo data', kind: 'data', status: 'approved', format: 'json', seller_id: 'seller', price: 40, version: '1.0.0'},
  {id: 'tool-demo', name: 'Statistics', kind: 'tool', status: 'approved', seller_id: 'seller', price: 12, version: '1.0.0', input_schema: inputSchema, output_schema: outputSchema},
];

function platform({toolStatus = 'succeeded', disconnectAfterPurchase = false, disconnectAfterCall = false, worker = true, data = [{agents: 128}, {agents: 96}, {agents: 72}], budget = {}, pendingReads = 0} = {}) {
  const requests = [];
  const orders = new Map();
  const keys = new Map();
  let balance = 1000;
  let held = 0;
  let purchaseDisconnected = false;
  let callDisconnected = false;
  let remainingPending = pendingReads;
  let executions = 0;
  const json = (value, status = 200) => Response.json(value, {status});
  const currentBalance = () => ({balance, held, budget: {day: '2026-10-14', timezone: 'UTC', single_limit: 200, daily_limit: 1000, spent: 1000 - balance, remaining: balance, ...budget}});
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    const path = url.pathname.replace('/api/v1/', '');
    requests.push({path, method: options.method, headers: options.headers, body: options.body, redirect: options.redirect});
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, `Bearer ${API_KEY}`);
    if (options.method === 'GET') {
      if (path === 'connection') return json({connected: true, agent: {id: 'buyer', name: 'Buyer', balance, held}, budget: currentBalance().budget});
      if (path === 'balance') return json(currentBalance());
      if (path === 'products') return json(products);
      if (path.startsWith('products/')) return json(products.find(product => product.id === path.split('/')[1]));
      if (path === 'health') return json({web: 'ready', worker});
      if (path.endsWith('/download')) {
        const order = orders.get(path.split('/')[1]);
        assert.equal(order?.kind, 'data');
        return json(data);
      }
      if (path.startsWith('orders/')) {
        const order = orders.get(path.split('/')[1]);
        if (order.kind === 'tool' && remainingPending-- > 0) return json({...order, status: 'running', output: null});
        return json(order);
      }
    }
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      const key = options.headers['idempotency-key'];
      assert.match(key, /^[\w.-]{1,120}$/);
      if (keys.has(key)) return json(keys.get(key)); // Intentionally retains the original pending POST response.
      if (path === 'purchases') {
        const order = {id: 'data-order', kind: 'data', status: 'succeeded', product_id: body.productId, buyer_id: 'buyer', price: 40, output: null};
        balance -= 40;
        orders.set(order.id, order);
        keys.set(key, order);
        if (disconnectAfterPurchase && !purchaseDisconnected) {
          purchaseDisconnected = true;
          throw new Error('Connection closed after server committed the purchase.');
        }
        return json(order);
      }
      if (path === 'calls') {
        executions++;
        balance -= 12;
        held += 12;
        const response = {id: 'tool-order', kind: 'tool', status: 'pending', product_id: body.productId, buyer_id: 'buyer', price: 12, input: body.input, output: null};
        keys.set(key, response);
        const sum = body.input.values.reduce((sum, value) => sum + value, 0);
        const final = {...response, status: toolStatus, output: toolStatus === 'succeeded' ? {count: body.input.values.length, sum, average: sum / body.input.values.length} : null};
        orders.set(final.id, final);
        held -= 12;
        if (toolStatus !== 'succeeded') balance += 12;
        if (disconnectAfterCall && !callDisconnected) {
          callDisconnected = true;
          throw new Error('Connection closed after server accepted the tool call.');
        }
        return json(response);
      }
    }
    throw new Error(`Unexpected mocked request ${options.method} ${path}`);
  };
  return {fetchImpl, requests, orders, keys, get balance() { return balance; }, get held() { return held; }, get executions() { return executions; }};
}

async function fixture(t, settings) {
  const cwd = await mkdtemp(join(tmpdir(), 'agent-market-example-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const mock = platform(settings);
  const messages = [];
  const env = {MARKET_URL: BASE, MARKET_API_KEY: API_KEY};
  const run = options => runFirstTrade({cwd, env, fetchImpl: mock.fetchImpl, log: message => messages.push(message), pollIntervalMs: 0, ...options});
  return {cwd, mock, messages, env, run};
}

test('help works without credentials and performs no requests', async () => {
  let network = 0;
  const messages = [];
  const result = await runFirstTrade({argv: ['--help'], env: {}, fetchImpl: async () => { network++; }, log: value => messages.push(value)});
  assert.equal(result.mode, 'help');
  assert.equal(network, 0);
  assert.match(messages[0], /--run-id/);
});

test('default preview is read-only and does not create run state', async t => {
  const {run, mock, cwd, messages} = await fixture(t);
  const result = await run({argv: []});
  assert.equal(result.mode, 'preview');
  assert.equal(result.plan.projectedSpend, 52);
  assert.ok(mock.requests.every(request => request.method === 'GET'));
  assert.deepEqual(await readdir(cwd), []);
  assert.ok(messages.every(value => !value.includes(API_KEY)));
});

test('approved execution purchases data, passes purchased values, and settles successful tool', async t => {
  const {run, mock, cwd} = await fixture(t, {pendingReads: 1});
  const result = await run({argv: ['--execute', '--run-id', 'first-run']});
  assert.equal(result.status, 'succeeded');
  assert.equal(result.spent, 52);
  assert.equal(mock.balance, 948);
  assert.equal(mock.held, 0);
  assert.deepEqual(result.call.input, {values: [128, 96, 72]});
  assert.equal(result.call.output.sum, 296);
  assert.equal(mock.executions, 1);
  const stateText = await readFile(join(cwd, '.agent-market-runs', 'first-run.json'), 'utf8');
  assert.ok(!stateText.includes(API_KEY));
  const state = JSON.parse(stateText);
  assert.equal(state.baseUrl, BASE);
  assert.equal(state.agentId, 'buyer');
  assert.equal(state.purchase.orderId, 'data-order');
  assert.equal(state.call.orderId, 'tool-order');
  assert.deepEqual(state.call.body.input.values, [128, 96, 72]);
});

test('a completed run resumes through current order GETs with no additional writes or charges', async t => {
  const {run, mock} = await fixture(t);
  await run({argv: ['--execute', '--run-id', 'completed']});
  const previousPosts = mock.requests.filter(request => request.method === 'POST').length;
  const result = await run({argv: ['--execute', '--run-id', 'completed']});
  assert.equal(result.status, 'succeeded');
  assert.equal(mock.requests.filter(request => request.method === 'POST').length, previousPosts);
  assert.equal(mock.balance, 948);
  assert.equal(mock.executions, 1);
});

test('interrupting after the data purchase resumes without buying the dataset again', async t => {
  const {run, mock} = await fixture(t);
  await assert.rejects(run({argv: ['--execute', '--run-id', 'after-data'], onStage: async stage => { if (stage === 'purchase') throw new Error('Simulated process interruption.'); }}), /interruption/);
  assert.equal(mock.balance, 960);
  assert.equal(mock.executions, 0);
  const result = await run({argv: ['--execute', '--run-id', 'after-data']});
  assert.equal(result.status, 'succeeded');
  assert.equal(mock.requests.filter(request => request.path === 'purchases' && request.method === 'POST').length, 1);
  assert.equal(mock.balance, 948);
});

test('network loss after committed purchase replays exactly the saved idempotency key', async t => {
  const {run, mock, cwd} = await fixture(t, {disconnectAfterPurchase: true});
  await assert.rejects(run({argv: ['--execute', '--run-id', 'lost-data-response']}), /Connection closed/);
  const state = JSON.parse(await readFile(join(cwd, '.agent-market-runs', 'lost-data-response.json'), 'utf8'));
  assert.equal(state.purchase.orderId, null);
  assert.equal(mock.balance, 960);
  const result = await run({argv: ['--execute', '--run-id', 'lost-data-response']});
  const posts = mock.requests.filter(request => request.path === 'purchases' && request.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
  assert.equal(mock.orders.size, 2);
  assert.equal(result.spent, 52);
  assert.equal(mock.balance, 948);
});

test('ambiguous tool POST replays the saved key then reads the latest terminal order', async t => {
  const {run, mock, cwd} = await fixture(t, {disconnectAfterCall: true});
  await assert.rejects(run({argv: ['--execute', '--run-id', 'lost-tool-response']}), /Connection closed/);
  const state = JSON.parse(await readFile(join(cwd, '.agent-market-runs', 'lost-tool-response.json'), 'utf8'));
  assert.equal(state.call.orderId, null);
  assert.deepEqual(state.call.body.input, {values: [128, 96, 72]});
  const result = await run({argv: ['--execute', '--run-id', 'lost-tool-response']});
  const posts = mock.requests.filter(request => request.path === 'calls' && request.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
  assert.equal(mock.executions, 1);
  assert.equal(result.status, 'succeeded');
  assert.equal(mock.balance, 948);
});

test('polling timeout keeps the existing tool order and a later resume only queries it', async t => {
  const {run, mock} = await fixture(t, {pendingReads: 1});
  await assert.rejects(run({argv: ['--execute', '--run-id', 'poll-timeout'], pollTimeoutMs: 0}), /still running.*Resume/);
  assert.equal(mock.executions, 1);
  const posts = mock.requests.filter(request => request.method === 'POST').length;
  const result = await run({argv: ['--execute', '--run-id', 'poll-timeout']});
  assert.equal(result.status, 'succeeded');
  assert.equal(mock.executions, 1);
  assert.equal(mock.requests.filter(request => request.method === 'POST').length, posts);
  assert.equal(mock.balance, 948);
});

for (const status of ['failed', 'unknown', 'cancelled']) {
  test(`${status} releases the tool fee and resumption never creates another call`, async t => {
    const {run, mock, messages} = await fixture(t, {toolStatus: status});
    const result = await run({argv: ['--execute', '--run-id', `tool-${status}`]});
    assert.equal(result.status, status);
    assert.equal(result.spent, 40);
    assert.equal(mock.balance, 960);
    assert.equal(mock.held, 0);
    await run({argv: ['--execute', '--run-id', `tool-${status}`]});
    assert.equal(mock.executions, 1);
    assert.equal(mock.requests.filter(request => request.path === 'calls' && request.method === 'POST').length, 1);
    assert.ok(messages.some(message => message.includes('No automatic retry')));
  });
}

test('local total cap, Agent daily budget, organization budget, and worker readiness stop writes', async t => {
  for (const settings of [
    {env: {MARKET_MAX_SPEND: '51'}, pattern: /MARKET_MAX_SPEND/},
    {budget: {remaining: 51}, pattern: /daily budget/},
    {budget: {single_limit: 39}, pattern: /single-transaction/},
    {budget: {organization: {remaining: 51}}, pattern: /organization/},
    {worker: false, pattern: /worker/i},
  ]) {
    const {run, mock, env} = await fixture(t, settings);
    await assert.rejects(run({argv: ['--execute'], env: {...env, ...settings.env}}), settings.pattern);
    assert.ok(mock.requests.every(request => request.method === 'GET'));
    assert.equal(mock.balance, 1000);
  }
});

test('an unsuitable downloaded dataset stops tool charges and does not duplicate its purchase on resume', async t => {
  const {run, mock} = await fixture(t, {data: [{agents: 'not-a-number'}]});
  await assert.rejects(run({argv: ['--execute', '--run-id', 'bad-data']}), /finite numbers/);
  await assert.rejects(run({argv: ['--execute', '--run-id', 'bad-data']}), /finite numbers/);
  assert.equal(mock.balance, 960);
  assert.equal(mock.executions, 0);
  assert.equal(mock.requests.filter(request => request.path === 'purchases' && request.method === 'POST').length, 1);
});

test('resumption rejects changed platform, Agent, cap, or product bindings before writes', async t => {
  const {run, mock, env} = await fixture(t);
  await run({argv: ['--execute', '--run-id', 'bound']});
  const posts = mock.requests.filter(request => request.method === 'POST').length;
  for (const changed of [
    {MARKET_MAX_SPEND: '100'},
    {MARKET_URL: 'http://127.0.0.1:3200'},
    {MARKET_DATA_PRODUCT_ID: 'different-data'},
    {MARKET_TOOL_PRODUCT_ID: 'different-tool'},
  ]) await assert.rejects(run({argv: ['--execute', '--run-id', 'bound'], env: {...env, ...changed}}), /state|cap|product/i);
  const differentAgentFetch = async (url, options) => {
    const response = await mock.fetchImpl(url, options);
    if (new URL(url).pathname.endsWith('/connection')) return Response.json({...await response.json(), agent: {id: 'another-buyer', name: 'Different'}});
    return response;
  };
  await assert.rejects(run({argv: ['--execute', '--run-id', 'bound'], fetchImpl: differentAgentFetch}), /another platform, Agent/);
  assert.equal(mock.requests.filter(request => request.method === 'POST').length, posts);
});

test('remote HTTP and URL credentials are rejected, while HTTPS and loopback are accepted', () => {
  for (const url of ['http://example.com', 'http://192.168.1.2:3100', 'https://user:password@example.com', 'https://example.com/subpath', 'https://example.com?token=secret']) assert.throws(() => normalizeBaseUrl(url));
  assert.equal(normalizeBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeBaseUrl('http://localhost:3100'), 'http://localhost:3100');
  assert.equal(normalizeBaseUrl('http://[::1]:3100'), 'http://[::1]:3100');
});

test('redirects cannot forward the API key and every write requires an idempotency key', async () => {
  let requests = 0;
  const client = createClient({baseUrl: 'https://market.example', apiKey: API_KEY, fetchImpl: async (url, options) => {
    requests++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, {status: 302, headers: {location: 'https://attacker.example/steal'}});
  }});
  await assert.rejects(client.getConnection(), /redirects are disabled/);
  assert.equal(requests, 1);
  await assert.rejects(client.request('purchases', {method: 'POST', body: {productId: 'data'}}), /Idempotency-Key/);
  await assert.rejects(client.request('https://attacker.example'), /relative/);
  await assert.rejects(client.request('../admin'), /relative|escapes/);
  assert.equal(requests, 1);
});

test('API keys are redacted from HTTP errors and transport exceptions', async () => {
  const client = createClient({baseUrl: BASE, apiKey: API_KEY, fetchImpl: async () => Response.json({error: `Rejected ${API_KEY} and ${encodeURIComponent(API_KEY)}`}, {status: 401})});
  await assert.rejects(client.getConnection(), error => error.status === 401 && !error.message.includes(API_KEY) && error.message.includes('[REDACTED]'));
  const transport = createClient({baseUrl: BASE, apiKey: API_KEY, fetchImpl: async () => { throw new Error(`Transport error with ${API_KEY}`); }});
  await assert.rejects(transport.getConnection(), error => !error.message.includes(API_KEY));
});

test('streamed response size and request timeouts are bounded', async () => {
  const large = createClient({baseUrl: BASE, apiKey: API_KEY, fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))});
  await assert.rejects(large.getConnection(), /size limit/);
  const timed = createClient({baseUrl: BASE, apiKey: API_KEY, timeoutMs: 5, fetchImpl: async (_url, options) => new Promise((_, reject) => {
    // Keep a handle alive for this mock; real fetch naturally keeps the event loop alive.
    const timer = setTimeout(() => reject(new Error('Mock stalled.')), 100);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, {once: true});
  })});
  await assert.rejects(timed.getConnection(), /timeout|aborted/i);
});

test('run IDs cannot escape the state directory and invalid arguments cannot authorize writes', async () => {
  const fetchImpl = async () => { throw new Error('Unexpected network request'); };
  for (const argv of [['--execute', '--run-id', '../elsewhere'], ['--run-id', 'a'], ['--execute', '--run-id'], ['--purchase']]) {
    await assert.rejects(runFirstTrade({argv, env: {}, fetchImpl}), /run-id|argument/);
  }
});
