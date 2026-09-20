// Shared helpers for the AI Frontier Post engagement API (reactions + comments).
// Backed by a KV namespace bound as AFP_DATA.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
    },
  });
}

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export async function readJson(request, maxBytes = 16384) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error('payload too large');
  return JSON.parse(new TextDecoder().decode(buf));
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

// Slugs are lowercase alnum + dashes, e.g. "agent-evals-tutorial".
export function validSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,120}$/.test(s);
}

// Fixed-window rate limit stored in KV. Returns true when allowed.
export async function checkRate(kv, key, limit, ttlSec) {
  const k = 'rl:' + key;
  const n = parseInt((await kv.get(k)) || '0', 10) || 0;
  if (n >= limit) return false;
  await kv.put(k, String(n + 1), { expirationTtl: ttlSec });
  return true;
}

export function cleanStr(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
