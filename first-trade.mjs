import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, lstat, chmod} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient, redact} from './src/client.mjs';

const HELP = `Agent Market first-trade example — Node.js 22+, no dependencies

  node --env-file=.env.local first-trade.mjs             Read-only preview
  node --env-file=.env.local first-trade.mjs --execute   Authorize data purchase and one tool call
  node --env-file=.env.local first-trade.mjs --execute --run-id <id>   Resume the SAME transaction

Environment:
  MARKET_URL                  Platform origin (default http://127.0.0.1:3100)
  MARKET_API_KEY              Your independent Agent API key
  MARKET_MAX_SPEND             Maximum total for this example, in virtual credits (default 52)
  MARKET_DATA_PRODUCT_ID       JSON dataset (default dataset-demo)
  MARKET_TOOL_PRODUCT_ID       Statistics-compatible tool (default tool-demo)

The default is read-only. --execute authorizes a data purchase and tool call.
Run state is saved before writes in .agent-market-runs/<id>.json, without API keys.
Keep that file and reuse --run-id after interruptions; a NEW run ID authorizes NEW purchases.
Unknown tool results are never automatically retried. The client spend cap is a
local guard for this example; the server additionally enforces Agent and organization budgets.
`;

const TERMINAL = new Set(['succeeded', 'failed', 'unknown', 'cancelled']);
const ID = /^[\w.-]{1,80}$/;

function options(argv) {
  const result = {execute: false, help: false, runId: null};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execute') result.execute = true;
    else if (argv[i] === '--help' || argv[i] === '-h') result.help = true;
    else if (argv[i] === '--run-id') result.runId = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}. Use --help.`);
  }
  if (result.runId !== null && (typeof result.runId !== 'string' || !ID.test(result.runId) || ['.', '..'].includes(result.runId))) {
    throw new Error('--run-id must contain 1–80 letters, digits, dots, underscores, or hyphens.');
  }
  if (result.runId && !result.execute) throw new Error('--run-id requires --execute to explicitly authorize resumption.');
  return result;
}

function price(product) {
  if (!Number.isSafeInteger(product?.price) || product.price < 0 || product.price > 1_000_000) throw new Error('Product price must be an integer in virtual credits.');
  return product.price;
}

// Deliberately limited schema support: fail closed on constraints this example cannot validate.
function validate(schema, value, at = 'input') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`${at}: missing JSON Schema.`);
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'enum', 'description', 'title']);
  for (const key of Object.keys(schema)) if (!allowed.has(key)) throw new Error(`${at}: unsupported schema constraint ${key}.`);
  const type = schema.type;
  const correct = type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isSafeInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : type === 'null' ? value === null
    : type === 'boolean' || type === 'string' ? typeof value === type : false;
  if (!correct) throw new Error(`${at}: expected ${type}.`);
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`${at}: value is not allowed.`);
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${at}: missing ${key}.`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(schema.properties[key], item, `${at}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${at}: unexpected property ${key}.`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, item, `${at}.${key}`);
    }
  }
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${at}: array length is outside the allowed range.`);
    if (!schema.items) throw new Error(`${at}: array item schema is required.`);
    value.forEach((item, index) => validate(schema.items, item, `${at}[${index}]`));
  }
  if (type === 'number' || type === 'integer') {
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${at}: number is outside the allowed range.`);
  }
  if (type === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) throw new Error(`${at}: string length is outside the allowed range.`);
}

function validateProducts(data, tool, agentId) {
  if (data?.kind !== 'data' || data.status !== 'approved' || data.format !== 'json') throw new Error('Choose an approved JSON data product.');
  if (tool?.kind !== 'tool' || tool.status !== 'approved') throw new Error('Choose an approved tool product.');
  if (data.seller_id === agentId || tool.seller_id === agentId) throw new Error('An Agent cannot buy its own resources.');
  price(data); price(tool);
  const schema = tool.input_schema;
  if (schema?.type !== 'object' || schema.properties?.values?.type !== 'array' || !['number', 'integer'].includes(schema.properties.values.items?.type)) {
    throw new Error('This example requires a statistics-compatible input schema: {values: number[]}.');
  }
  const output = tool.output_schema;
  if (output?.type !== 'object' || !['count', 'sum', 'average'].every(key => ['number', 'integer'].includes(output.properties?.[key]?.type) && output.required?.includes(key))) {
    throw new Error('This example requires a statistics-compatible output schema: {count, sum, average}.');
  }
  validate(schema, {values: [1]});
  validate(output, {count: 1, sum: 1, average: 1}, 'output');
}

function checkBudget(balance, costs) {
  const total = costs.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(balance?.balance) || !balance?.budget) throw new Error('Platform returned an invalid balance or budget.');
  if (balance.balance < total) throw new Error('Insufficient available virtual credits.');
  if (costs.some(amount => amount > balance.budget.single_limit)) throw new Error('A transaction exceeds the Agent single-transaction limit.');
  if (total > balance.budget.remaining) throw new Error('The example exceeds the Agent remaining daily budget (UTC).');
  if (balance.budget.organization && total > balance.budget.organization.remaining) throw new Error('The example exceeds the organization remaining shared daily budget (UTC).');
}

function summarizeProduct(product) {
  return {id: product.id, name: product.name, price: price(product), version: product.version, ...(product.kind === 'tool' ? {input_schema: product.input_schema, output_schema: product.output_schema} : {})};
}

async function readState(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('Run state must be a regular JSON file below 256 KB.');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function saveState(file, state, initial = false) {
  const json = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(json) > 256 * 1024) throw new Error('Run state exceeds the size limit.');
  if (initial) {
    try { await writeFile(file, json, {encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true}); return state; }
    catch (error) { if (error.code === 'EEXIST') return await readState(file); throw error; }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, json, {encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true});
  await rename(temporary, file);
  return state;
}

function boundState(state, client, connection, opts, env, maxSpend) {
  if (state?.version !== 1 || state.runId !== opts.runId || state.baseUrl !== client.baseUrl || state.agentId !== connection.agent.id) throw new Error('Run state belongs to another platform, Agent, or run ID.');
  if (state.maxSpend !== maxSpend || state.data.price + state.tool.price > maxSpend) throw new Error('Keep the original MARKET_MAX_SPEND when resuming; the run must remain within its approved cap.');
  if ((env.MARKET_DATA_PRODUCT_ID && env.MARKET_DATA_PRODUCT_ID !== state.data.id) || (env.MARKET_TOOL_PRODUCT_ID && env.MARKET_TOOL_PRODUCT_ID !== state.tool.id)) throw new Error('Run product IDs cannot change during resumption.');
  for (const operation of [state.purchase, state.call]) if (!/^[\w.-]{1,120}$/.test(operation?.idempotencyKey)) throw new Error('Run state is missing a stable idempotency key.');
  if (state.purchase.body?.productId !== state.data.id || (state.call.body && state.call.body.productId !== state.tool.id)) throw new Error('Run state contains inconsistent product IDs.');
  if (state.call.prepared) validate(state.tool.input_schema, state.call.body?.input);
  price(state.data); price(state.tool);
}

function numbersFromDataset(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Purchased data is not valid JSON; the completed data purchase remains charged.'); }
  if (!Array.isArray(data) || data.length < 1 || data.length > 100) throw new Error('Use a JSON array with 1–100 numeric items or records containing numeric agents fields.');
  const values = data.map(item => typeof item === 'number' ? item : item?.agents);
  if (!values.every(item => typeof item === 'number' && Number.isFinite(item))) throw new Error('Data must contain finite numbers or numeric agents fields; the completed data purchase remains charged.');
  return values;
}

/** Testable integration entry point; no network or trading happens on module import. */
export async function runFirstTrade({argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), fetchImpl = globalThis.fetch, log = console.log, pollIntervalMs = 500, pollTimeoutMs = 30_000, onStage = async () => {}} = {}) {
  const opts = options(argv);
  if (opts.help) { log(HELP); return {mode: 'help'}; }
  const emit = value => log(redact(typeof value === 'string' ? value : JSON.stringify(value, null, 2), env.MARKET_API_KEY));
  const maxSpend = Number(env.MARKET_MAX_SPEND ?? 52);
  if (!Number.isSafeInteger(maxSpend) || maxSpend < 0 || maxSpend > 1_000_000) throw new Error('MARKET_MAX_SPEND must be an integer between 0 and 1000000 virtual credits.');
  const client = createClient({baseUrl: env.MARKET_URL, apiKey: env.MARKET_API_KEY, fetchImpl});
  const connection = await client.getConnection();
  if (!connection.connected || typeof connection.agent?.id !== 'string') throw new Error('The API key is not connected to an Agent.');
  emit(`Connected Agent: ${connection.agent.name} (${connection.agent.id})`);
  const before = await client.getBalance();
  let state;
  let file;
  if (opts.execute) {
    opts.runId ??= randomUUID();
    const directory = join(resolve(cwd), '.agent-market-runs');
    await mkdir(directory, {recursive: true, mode: 0o700});
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('The run state directory must be a real directory.');
    await chmod(directory, 0o700);
    file = join(directory, `${opts.runId}.json`);
    state = await readState(file);
    if (state) boundState(state, client, connection, opts, env, maxSpend);
    emit(`Run ID: ${opts.runId}. After interruption, resume with --execute --run-id ${opts.runId}; keep the saved state.`);
  }
  if (!state) {
    const catalog = await client.getProducts();
    if (!Array.isArray(catalog)) throw new Error('Platform returned an invalid catalog.');
    const dataId = env.MARKET_DATA_PRODUCT_ID ?? 'dataset-demo';
    const toolId = env.MARKET_TOOL_PRODUCT_ID ?? 'tool-demo';
    const [data, tool] = await Promise.all([client.getProduct(dataId), client.getProduct(toolId)]);
    validateProducts(data, tool, connection.agent.id);
    const projectedSpend = price(data) + price(tool);
    if (projectedSpend > maxSpend) throw new Error(`Projected ${projectedSpend} virtual credits exceeds MARKET_MAX_SPEND=${maxSpend}; no purchase was made.`);
    checkBudget(before, [data.price, tool.price]);
    const health = await client.request('health');
    if (health.web !== 'ready' || !health.worker) throw new Error('The web service and independent worker must both be ready before starting a paid example.');
    const plan = {data: summarizeProduct(data), tool: summarizeProduct(tool), projectedSpend, maxSpend, currency: 'virtual_credits'};
    emit(plan);
    if (!opts.execute) {
      emit('Read-only preview: no purchase or tool call was made. Add --execute only when you approve this plan.');
      return {mode: 'preview', agent: connection.agent.id, plan, balance: before};
    }
    state = await saveState(file, {version: 1, runId: opts.runId, baseUrl: client.baseUrl, agentId: connection.agent.id, createdAt: new Date().toISOString(), maxSpend,
      data: plan.data, tool: plan.tool,
      purchase: {idempotencyKey: `data-${randomUUID()}`, body: {productId: data.id}, prepared: true, orderId: null},
      call: {idempotencyKey: `tool-${randomUUID()}`, body: null, prepared: false, orderId: null}}, true);
    boundState(state, client, connection, opts, env, maxSpend);
  }
  let purchase;
  if (!state.purchase.orderId) {
    const result = await client.request('purchases', {method: 'POST', body: state.purchase.body, idempotencyKey: state.purchase.idempotencyKey});
    if (typeof result?.id !== 'string') throw new Error('Purchase did not return an order ID; resume the same run to reconcile it.');
    state.purchase.orderId = result.id;
    await saveState(file, state);
  }
  purchase = await client.getOrder(state.purchase.orderId);
  if (purchase.status !== 'succeeded' || purchase.kind !== 'data' || purchase.product_id !== state.data.id || purchase.buyer_id !== state.agentId || purchase.price !== state.data.price) throw new Error('Data order differs from the approved plan; inspect the saved order before proceeding.');
  emit(`Data delivered: order ${purchase.id}, ${purchase.price} virtual credits.`);
  await onStage('purchase', {state, purchase});
  if (!state.call.prepared) {
    const downloaded = await client.downloadData(purchase.id);
    if (downloaded.format !== 'json') throw new Error('This statistics example accepts JSON datasets only; the completed data purchase remains charged.');
    const input = {values: numbersFromDataset(downloaded.text)};
    validate(state.tool.input_schema, input);
    const current = await client.getProduct(state.tool.id);
    if (current.status !== 'approved' || current.kind !== 'tool' || current.version !== state.tool.version || current.price !== state.tool.price || JSON.stringify(current.input_schema) !== JSON.stringify(state.tool.input_schema) || JSON.stringify(current.output_schema) !== JSON.stringify(state.tool.output_schema)) throw new Error('Tool changed or was withdrawn; inspect it before authorizing a new run. The completed data purchase remains charged.');
    checkBudget(await client.getBalance(), [state.tool.price]);
    const health = await client.request('health');
    if (!health.worker) throw new Error('Worker is unavailable; resume this run later. The data purchase is already complete.');
    state.call.body = {productId: state.tool.id, input};
    state.call.prepared = true;
    // Persist the exact input and key BEFORE POST; ambiguous network failures can be reconciled safely.
    await saveState(file, state);
  }
  if (!state.call.orderId) {
    const result = await client.request('calls', {method: 'POST', body: state.call.body, idempotencyKey: state.call.idempotencyKey});
    if (typeof result?.id !== 'string') throw new Error('Call did not return an order ID; resume the same run to reconcile it.');
    state.call.orderId = result.id;
    await saveState(file, state);
  }
  let call = await client.getOrder(state.call.orderId); // An idempotent POST replay may contain an old pending status.
  const deadline = Date.now() + pollTimeoutMs;
  while (!TERMINAL.has(call.status)) {
    if (!['pending', 'running'].includes(call.status)) throw new Error('Platform returned an unsupported order state.');
    if (Date.now() >= deadline) throw new Error(`Order ${call.id} is still ${call.status}. Resume run ${state.runId} to query the existing order; do not create a new run.`);
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    call = await client.getOrder(state.call.orderId);
  }
  if (call.kind !== 'tool' || call.product_id !== state.tool.id || call.buyer_id !== state.agentId || call.price !== state.tool.price) throw new Error('Tool order differs from the saved plan.');
  if (call.status === 'succeeded') validate(state.tool.output_schema, call.output, 'output');
  const after = await client.getBalance();
  const spent = purchase.price + (call.status === 'succeeded' ? call.price : 0);
  const result = {mode: 'execute', runId: state.runId, status: call.status, purchase, call, before, after, spent, currency: 'virtual_credits'};
  emit({runId: state.runId, status: call.status, dataOrder: purchase.id, toolOrder: call.id, actualSpent: spent, currency: 'virtual_credits', output: call.output, availableBalance: after.balance, held: after.held});
  if (call.status !== 'succeeded') emit('Tool fee was released. No automatic retry will occur; the completed data purchase remains charged. Inspect the existing order and external execution records before further action.');
  await onStage('complete', result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runFirstTrade().then(result => { if (result.mode === 'execute' && result.status !== 'succeeded') process.exitCode = 1; })
    .catch(error => { console.error(redact(error?.message ?? 'Example failed.', process.env.MARKET_API_KEY)); process.exitCode = 1; });
}
