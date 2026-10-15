// Node.js 22+, built-in fetch only. Keep API keys in the environment, never files.
export function redact(value, apiKey) {
  const message = String(value);
  if (!apiKey) return message;
  return message.split(apiKey).join('[REDACTED]').split(encodeURIComponent(apiKey)).join('[REDACTED]');
}

export function normalizeBaseUrl(value = 'http://127.0.0.1:3100') {
  let url;
  try { url = new URL(value); } catch { throw new Error('MARKET_URL must be an absolute platform URL.'); }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('MARKET_URL must contain only the platform origin, without credentials, a path, query, or fragment.');
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS for remote platforms. HTTP is allowed only for loopback development.');
  }
  return url.origin;
}

export class MarketApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'MarketApiError';
    this.status = status;
  }
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function resourceId(value) {
  if (typeof value !== 'string' || !/^[\w.-]{1,120}$/.test(value) || value === '.' || value === '..') {
    throw new Error('Invalid resource ID.');
  }
  return encodeURIComponent(value);
}

async function readBounded(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > limit) throw new Error('Platform response exceeds the client size limit.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let result = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('Platform response exceeds the client size limit.');
      }
      result += decoder.decode(value, {stream: true});
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** All request paths are relative to /api/v1/. Write requests require a stable key. */
export function createClient({baseUrl = 'http://127.0.0.1:3100', apiKey, timeoutMs = 15_000, fetchImpl = globalThis.fetch} = {}) {
  const origin = normalizeBaseUrl(baseUrl);
  if (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey)) {
    throw new Error('Set MARKET_API_KEY to your Agent API key.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) {
    throw new Error('Client timeout must be an integer between 1 and 180000 ms.');
  }
  const apiRoot = `${origin}/api/v1/`;
  async function send(path, options = {}, raw = false) {
    try {
      if (typeof path !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/_?=&%+.,~-]*$/.test(path)) {
        throw new Error('Use an API path relative to /api/v1/.');
      }
      const url = new URL(path, apiRoot);
      if (url.origin !== origin || !url.pathname.startsWith('/api/v1/')) throw new Error('API path escapes the platform origin.');
      const method = (options.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD', ...WRITES].includes(method)) throw new Error('Unsupported HTTP method.');
      const headers = {authorization: `Bearer ${apiKey}`, accept: raw ? 'application/json, text/csv' : 'application/json'};
      if (WRITES.has(method)) {
        if (typeof options.idempotencyKey !== 'string' || !/^[\w.-]{1,120}$/.test(options.idempotencyKey)) {
          throw new Error('Every write requires a stable Idempotency-Key (1–120 letters, digits, dots, underscores, or hyphens).');
        }
        headers['idempotency-key'] = options.idempotencyKey;
      }
      if (options.body !== undefined && !WRITES.has(method)) throw new Error('Read-only requests cannot include a body.');
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      if (body !== undefined) {
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('Request exceeds the client size limit.');
        headers['content-type'] = 'application/json';
      }
      // A redirect must never forward an Agent API key to a different endpoint.
      const response = await fetchImpl(url, {method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)});
      if (response.status >= 300 && response.status < 400) {
        throw new MarketApiError('Platform returned a redirect; redirects are disabled to protect the Agent API key.', response.status);
      }
      const text = await readBounded(response, MAX_RESPONSE_BYTES);
      if (!response.ok) {
        let error = 'Request failed';
        try { const payload = JSON.parse(text); error = typeof payload.error === 'string' ? payload.error : error; } catch { /* Do not print HTML or response bodies. */ }
        throw new MarketApiError(`HTTP ${response.status}: ${redact(error, apiKey).slice(0, 1000)}`, response.status);
      }
      if (raw) {
        const contentType = response.headers.get('content-type') ?? '';
        return {text, contentType, format: contentType.includes('application/json') ? 'json' : contentType.includes('text/csv') ? 'csv' : 'unknown'};
      }
      if (!text) return null;
      try { return JSON.parse(text); } catch { throw new Error('Platform returned invalid JSON.'); }
    } catch (error) {
      throw new MarketApiError(redact(error?.message ?? 'Platform request failed.', apiKey), error?.status ?? null);
    }
  }
  return {
    baseUrl: origin,
    request: (path, options) => send(path, options),
    getConnection: () => send('connection'),
    getBalance: () => send('balance'),
    getProducts: (filters = {}) => {
      const query = new URLSearchParams(filters).toString();
      return send(`products${query ? `?${query}` : ''}`);
    },
    getProduct: id => send(`products/${resourceId(id)}`),
    getOrder: id => send(`orders/${resourceId(id)}`),
    downloadData: id => send(`orders/${resourceId(id)}/download`, {}, true),
  };
}
