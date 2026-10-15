// Publish only an explicitly selected JSON/CSV file; preview by default.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, lstatSync } from 'node:fs';
import { extname, resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from './src/client.mjs';

function argumentsOf(args) {
  const options = { execute: false, help: false };
  const values = new Set(['file', 'name', 'description', 'license', 'price', 'version', 'run-id']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') options.execute = true;
    else if (args[i] === '--help') options.help = true;
    else if (args[i].startsWith('--') && values.has(args[i].slice(2))) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
      options[args[i].slice(2)] = args[++i];
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return options;
}

export async function runSeller({ args = [], env = process.env, cwd = process.cwd(), log = console.log, fetchImpl = globalThis.fetch } = {}) {
  const options = argumentsOf(args);
  if (options.help) {
    log('Usage: node seller.mjs --file PATH --name NAME --description TEXT --license TEXT --price INTEGER [--version 1.0.0] [--execute] [--run-id ID]\nPreview is local and free. --execute submits a resource for administrator review. Resume the same run ID after an interrupted request.');
    return { mode: 'help' };
  }
  const price = Number(options.price);
  if (!options.file || !options.name || !options.description || !options.license || !Number.isSafeInteger(price) || price < 1 || price > 1000000) {
    throw new Error('Required: --file PATH --name NAME --description TEXT --license TEXT --price INTEGER (1–1000000).');
  }
  const file = resolve(cwd, options.file);
  const format = extname(file).slice(1).toLowerCase();
  if (!['json', 'csv'].includes(format)) throw new Error('Only .json or .csv files are supported.');
  const bytes = readFileSync(file);
  if (bytes.length > 1000000) throw new Error('File exceeds the 1 MB data limit.');
  const content = bytes.toString('utf8');
  if (!content.trim()) throw new Error('File is empty.');
  if (format === 'json') { try { JSON.parse(content); } catch { throw new Error('Selected file is not valid JSON.'); } }
  const body = { kind: 'data', name: options.name.trim(), description: options.description.trim(), license: options.license.trim(), price, version: options.version ?? '1.0.0', format, content };
  for (const [field, limit] of [['name', 100], ['description', 2000], ['license', 500], ['version', 40]]) {
    if (!body[field].trim() || body[field].length > limit) throw new Error(`Invalid ${field}; maximum ${limit} characters.`);
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 1100000) throw new Error('Encoded publish request exceeds the platform request limit.');
  const preview = { mode: 'preview', name: body.name, version: body.version, price, currency: 'virtual_credits', format, bytes: bytes.length, license: body.license, note: 'No request made. Use --execute to publish for administrator review.' };
  if (!options.execute) { log(JSON.stringify(preview, null, 2)); return preview; }
  const client = createClient({ baseUrl: env.MARKET_URL ?? 'http://127.0.0.1:3100', apiKey: env.MARKET_API_KEY, fetchImpl });
  const connection = await client.getConnection();
  const runId = options['run-id'] ?? randomUUID();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) throw new Error('Run ID must contain 1–80 letters, numbers, underscores or hyphens.');
  const directory = join(cwd, '.agent-market-runs');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Run directory must be a local directory, not a symlink.');
  const statePath = join(directory, `seller-${runId}.json`);
  const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const binding = { baseUrl: new URL(env.MARKET_URL ?? 'http://127.0.0.1:3100').href.replace(/\/$/, ''), agentId: connection.agent.id, fingerprint };
  let state;
  if (existsSync(statePath)) {
    if (!lstatSync(statePath).isFile() || lstatSync(statePath).isSymbolicLink()) throw new Error('Run state must be a regular file.');
    state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.kind !== 'seller-publish' || Object.keys(binding).some(key => state[key] !== binding[key])) throw new Error('Run ID belongs to a different market, Agent or resource. Use the original inputs to resume.');
  } else {
    state = { kind: 'seller-publish', runId, ...binding, idempotencyKey: randomUUID(), productId: null };
    writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx', flush: true });
  }
  log(`Run ID: ${runId}`);
  log(`Resume: node seller.mjs [same options] --execute --run-id ${runId}`);
  // An unpublished product has no public GET endpoint. Replay the exact POST;
  // its original submission result is intentionally not a live listing status.
  const product = await client.request('products', { method: 'POST', body, idempotencyKey: state.idempotencyKey });
  if (state.productId && state.productId !== product.id) throw new Error('Unexpected product ID for the saved publication.');
  if (!state.productId) {
    state.productId = product.id;
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporary, statePath);
  }
  const result = { runId, productId: product.id, submissionStatus: product.status, price: product.price, currency: 'virtual_credits', note: 'Original submission status; check the seller dashboard for current review status. An administrator must approve the resource before trading.' };
  log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSeller({ args: process.argv.slice(2) }).catch(error => {
    const key = process.env.MARKET_API_KEY;
    const message = String(error.message);
    console.error(key ? message.replaceAll(key, '[redacted]') : message);
    process.exitCode = 1;
  });
}
