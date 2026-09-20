/* AI Frontier Post — engagement API (like/dislike reactions + comments).
 *
 * Deployed as a standalone Cloudflare Worker named `afp-engage` (created via
 * the Cloudflare dashboard — dashboard direct-upload Pages deployments cannot
 * compile a functions/ folder, so Pages Functions are not used).
 * Dashboard setup: Worker Settings -> Bindings -> KV namespace, variable
 *   AFP_DATA -> namespace afp-data. Domains & Routes -> route
 *   aifrontierpost.com/api/* -> this worker (takes precedence over Pages).
 * The static site (assets/site.js) calls these endpoints same-origin (/api/…).
 */

function json(data, status = 200) {
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

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

async function readJson(request, maxBytes = 16384) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error('payload too large');
  return JSON.parse(new TextDecoder().decode(buf));
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

// Slugs are lowercase alnum + dashes, e.g. "agent-evals-tutorial".
function validSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,120}$/.test(s);
}

// Fixed-window rate limit stored in KV. Returns true when allowed.
async function checkRate(kv, key, limit, ttlSec) {
  const k = 'rl:' + key;
  const n = parseInt((await kv.get(k)) || '0', 10) || 0;
  if (n >= limit) return false;
  await kv.put(k, String(n + 1), { expirationTtl: ttlSec });
  return true;
}

function cleanStr(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* ---------------- reactions ---------------- */

const reactKey = (slug) => 'react:' + slug;

function sanitizeCounts(cur) {
  return {
    like: Math.max(0, parseInt(cur && cur.like, 10) || 0),
    dislike: Math.max(0, parseInt(cur && cur.dislike, 10) || 0),
  };
}

async function getReactions(env, slug) {
  if (!validSlug(slug)) return json({ error: 'bad slug' }, 400);
  const cur = sanitizeCounts(JSON.parse((await env.AFP_DATA.get(reactKey(slug))) || 'null'));
  return json(cur);
}

async function postReactions(request, env) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { slug, vote, prev, unvote } = body || {};
  const okVote = (v) => v === 'like' || v === 'dislike';
  if (!validSlug(slug) || !okVote(vote) || (prev != null && prev !== '' && !okVote(prev))) {
    return json({ error: 'bad input' }, 400);
  }
  if (unvote && !okVote(prev)) return json({ error: 'bad input' }, 400);
  if (!(await checkRate(env.AFP_DATA, `react:${clientIp(request)}:${slug}`, 30, 3600))) {
    return json({ error: 'slow down — too many votes' }, 429);
  }
  const k = reactKey(slug);
  const cur = sanitizeCounts(JSON.parse((await env.AFP_DATA.get(k)) || 'null'));
  if (unvote) {
    if (cur[prev] > 0) cur[prev] -= 1;
  } else {
    if (prev && prev !== vote && cur[prev] > 0) cur[prev] -= 1;
    cur[vote] += 1;
  }
  await env.AFP_DATA.put(k, JSON.stringify(cur));
  return json(cur);
}

/* ---------------- comments ---------------- */

const commentsKey = (slug) => 'comments:' + slug;
const MAX_STORED = 200;
const HAS_LINK = /(https?:\/\/|www\.)/i;

async function readCommentList(env, slug) {
  try {
    const list = JSON.parse((await env.AFP_DATA.get(commentsKey(slug))) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function getComments(env, slug) {
  if (!validSlug(slug)) return json({ error: 'bad slug' }, 400);
  const approved = (await readCommentList(env, slug)).filter((c) => c && c.approved);
  return json({ comments: approved.slice(-MAX_STORED), count: approved.length });
}

async function postComments(request, env) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const slug = body && body.slug;
  if (!validSlug(slug)) return json({ error: 'bad slug' }, 400);
  // Honeypot: pretend success, store nothing.
  if (body.website) return json({ ok: true, held: true });

  const name = cleanStr(body.name, 40);
  const text = cleanStr(body.text, 2000);
  if (name.length < 2) return json({ error: 'Please add your name.' }, 400);
  if (text.length < 3) return json({ error: 'Please write a comment first.' }, 400);
  if (!(await checkRate(env.AFP_DATA, `comment:${clientIp(request)}:${slug}`, 5, 3600))) {
    return json({ error: 'slow down — too many comments' }, 429);
  }

  const held = HAS_LINK.test(text);
  const entry = { id: makeId(), name, text, ts: Date.now(), approved: !held };
  const list = await readCommentList(env, slug);
  list.push(entry);
  await env.AFP_DATA.put(commentsKey(slug), JSON.stringify(list.slice(-MAX_STORED)));
  return json({ ok: true, held });
}

/* ---------------- router ---------------- */

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return handleOptions();
  if (url.pathname === '/api/reactions') {
    if (request.method === 'GET') return getReactions(env, url.searchParams.get('slug') || '');
    if (request.method === 'POST') return postReactions(request, env);
    return json({ error: 'method not allowed' }, 405);
  }
  if (url.pathname === '/api/comments') {
    if (request.method === 'GET') return getComments(env, url.searchParams.get('slug') || '');
    if (request.method === 'POST') return postComments(request, env);
    return json({ error: 'method not allowed' }, 405);
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

// Named export for unit tests.
export { handleRequest };
