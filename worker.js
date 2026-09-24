/* AI Frontier Post — engagement API (like/dislike reactions + comments).
 *
 * Deployed as a standalone Cloudflare Worker named `afp-engage` (created via
 * the Cloudflare dashboard — dashboard direct-upload Pages deployments cannot
 * compile a functions/ folder, so Pages Functions are not used).
 * Dashboard setup: Worker Settings -> Bindings -> KV namespace, variable
 *   AFP_DATA -> namespace afp-data. Domains & Routes -> route
 *   aifrontierpost.com/api/* -> this worker (takes precedence over Pages).
 *   To enable comment moderation, add a secret (Settings -> Variables and
 *   Secrets -> Add secret) named AFP_ADMIN_TOKEN with a random token.
 * The static site (assets/site.js) calls these endpoints same-origin (/api/…),
 * so no CORS headers are sent on JSON responses. Votes are tracked per hashed
 * client IP in the stored react state; comment moderation requires the admin token.
 */

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Same-origin only: preflights get a bare 204 with no CORS headers.
function handleOptions() {
  return new Response(null, { status: 204 });
}

async function readJson(request, maxBytes) {
  maxBytes = maxBytes || 16384;
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error('payload too large');
  return JSON.parse(new TextDecoder().decode(buf));
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

// Privacy: raw client IPs are never persisted in KV. Voter identity is the
// SHA-256 of a fixed prefix + the IP — good enough to stop casual reversal
// and accidental PII exposure in stored state (not a secret-keyed MAC).
async function voterId(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('afp-voter:' + ip));
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return hex;
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
  // Strip ASCII control chars except tab/newline/CR; no regex escapes needed.
  const str = String(s == null ? '' : s);
  let out = '';
  for (const ch of str) {
    const n = ch.codePointAt(0);
    if (n === 9 || n === 10 || n === 13 || n >= 32) out += ch;
    if (out.length >= max + 200) break;
  }
  return out.trim().slice(0, max);
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* ---------------- reactions ---------------- */

const reactKey = (slug) => 'react:' + slug;

// Stored shape: { like, dislike, voters: { "<sha256(ip)>": "like"|"dislike" } }.
// Voters are only trusted from our own writes; read-time sanitization strips
// anything unexpected (and never leaks the voter map to readers).
function sanitizeReactionState(cur) {
  const state = {
    like: Math.max(0, parseInt(cur && cur.like, 10) || 0),
    dislike: Math.max(0, parseInt(cur && cur.dislike, 10) || 0),
    voters: {},
  };
  const raw = cur && cur.voters;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [ip, v] of Object.entries(raw)) {
      if ((v === 'like' || v === 'dislike') && typeof ip === 'string' && ip.length <= 64) {
        state.voters[ip] = v;
      }
    }
  }
  return state;
}

async function getReactions(env, slug) {
  if (!validSlug(slug)) return json({ error: 'bad slug' }, 400);
  const { like, dislike } = sanitizeReactionState(
    JSON.parse((await env.AFP_DATA.get(reactKey(slug))) || 'null')
  );
  return json({ like, dislike });
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
  const ip = clientIp(request);
  const vid = await voterId(ip);
  if (!(await checkRate(env.AFP_DATA, 'react:' + vid + ':' + slug, 30, 3600))) {
    return json({ error: 'too many votes, slow down' }, 429);
  }
  const k = reactKey(slug);
  // NOTE: KV has no transactions — this read-modify-write is best-effort and
  // two concurrent requests can lose one update. True atomicity would need
  // Durable Objects or D1 (deliberately not migrated: needs dashboard setup).
  const cur = sanitizeReactionState(JSON.parse((await env.AFP_DATA.get(k)) || 'null'));
  const prior = cur.voters[vid];
  if (unvote) {
    // Only retract a vote this client actually cast: unvote with no matching
    // stored vote is a no-op, so strangers can no longer drive counts down.
    if (prior === prev && cur[prev] > 0) {
      cur[prev] -= 1;
      delete cur.voters[vid];
    }
  } else if (prior !== vote) {
    if (prior && cur[prior] > 0) cur[prior] -= 1;
    cur[vote] += 1;
    cur.voters[vid] = vote;
  }
  // prior === vote is a no-op: re-voting never double-counts.
  await env.AFP_DATA.put(k, JSON.stringify(cur));
  return json({ like: cur.like, dislike: cur.dislike });
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
  if (!(await checkRate(env.AFP_DATA, 'comment:' + (await voterId(clientIp(request))) + ':' + slug, 5, 3600))) {
    return json({ error: 'too many comments, slow down' }, 429);
  }

  const held = HAS_LINK.test(text);
  const entry = { id: makeId(), name, text, ts: Date.now(), approved: !held };
  const list = await readCommentList(env, slug);
  list.push(entry);
  await env.AFP_DATA.put(commentsKey(slug), JSON.stringify(list.slice(-MAX_STORED)));
  return json({ ok: true, held });
}

/* ---------------- comment moderation ---------------- */

// Held comments (those containing links) can be approved or deleted here.
// Auth: header "authorization: Bearer <AFP_ADMIN_TOKEN>". Dashboard step: in
// the Worker settings add a secret (Settings -> Variables and Secrets ->
// Add secret) named AFP_ADMIN_TOKEN with a random token. Until that secret
// exists, this endpoint is disabled (403 "moderation not configured").
async function moderateComments(request, env) {
  if (!env.AFP_ADMIN_TOKEN) return json({ error: 'moderation not configured' }, 403);
  const auth = request.headers.get('authorization') || '';
  if (auth !== 'Bearer ' + env.AFP_ADMIN_TOKEN) return json({ error: 'forbidden' }, 403);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const { slug, id, action } = body || {};
  if (!validSlug(slug) || typeof id !== 'string' || (action !== 'approve' && action !== 'delete')) {
    return json({ error: 'bad input' }, 400);
  }
  const list = await readCommentList(env, slug);
  if (action === 'approve') {
    let found = false;
    for (const c of list) {
      if (c && c.id === id) {
        c.approved = true;
        found = true;
        break;
      }
    }
    if (!found) return json({ error: 'not found' }, 404);
    await env.AFP_DATA.put(commentsKey(slug), JSON.stringify(list.slice(-MAX_STORED)));
    return json({ ok: true, action: 'approve' });
  }
  const next = list.filter((c) => !(c && c.id === id));
  if (next.length === list.length) return json({ error: 'not found' }, 404);
  await env.AFP_DATA.put(commentsKey(slug), JSON.stringify(next.slice(-MAX_STORED)));
  return json({ ok: true, action: 'delete' });
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
  if (url.pathname === '/api/comments/moderate') {
    if (request.method === 'POST') return moderateComments(request, env);
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
