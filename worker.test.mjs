// Unit tests for worker.js — Node builtins only. Run with:
//   node --test worker.test.mjs
// Stubs env.AFP_DATA with an in-memory Map-based KV and env.AFP_ADMIN_TOKEN.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.js';

function makeKV() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? m.get(k) : null;
    },
    async put(k, v /*, opts*/) {
      m.set(k, String(v));
    },
  };
}

function makeEnv(token) {
  const env = { AFP_DATA: makeKV() };
  if (token !== undefined) env.AFP_ADMIN_TOKEN = token;
  return env;
}

function req(method, path, { body, headers, ip } = {}) {
  const h = new Headers(headers || {});
  h.set('cf-connecting-ip', ip || '1.2.3.4');
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request('https://example.test' + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(env, method, path, opts) {
  const res = await handleRequest(req(method, path, opts), env);
  const data = await res.json();
  return [res.status, data];
}

const post = (env, path, body, ip, headers) => call(env, 'POST', path, { body, ip, headers });
const get = (env, path, ip) => call(env, 'GET', path, { ip });

const SLUG = 'test-slug-ab';

/* ---------------- reactions ---------------- */

test('vote then unvote by same IP decrements', async () => {
  const env = makeEnv();
  assert.deepEqual(await post(env, '/api/reactions', { slug: SLUG, vote: 'like' }), [200, { like: 1, dislike: 0 }]);
  const [status, data] = await post(env, '/api/reactions', { slug: SLUG, vote: 'like', prev: 'like', unvote: true });
  assert.equal(status, 200);
  assert.deepEqual(data, { like: 0, dislike: 0 });
});

test('unvote without a prior vote does NOT decrement (even with legacy counts)', async () => {
  const env = makeEnv();
  // Legacy data: counts but no voter records — strangers cannot drive them down.
  await env.AFP_DATA.put('react:' + SLUG, JSON.stringify({ like: 5, dislike: 2 }));
  const [status, data] = await post(env, '/api/reactions', { slug: SLUG, vote: 'like', prev: 'like', unvote: true }, '9.9.9.9');
  assert.equal(status, 200);
  assert.deepEqual(data, { like: 5, dislike: 2 });
});

test('unvote with mismatched prev does NOT decrement', async () => {
  const env = makeEnv();
  await post(env, '/api/reactions', { slug: SLUG, vote: 'like' });
  const [status, data] = await post(env, '/api/reactions', { slug: SLUG, vote: 'dislike', prev: 'dislike', unvote: true });
  assert.equal(status, 200);
  assert.deepEqual(data, { like: 1, dislike: 0 });
});

test('double-vote by same IP does not double-count; switching vote moves one count', async () => {
  const env = makeEnv();
  await post(env, '/api/reactions', { slug: SLUG, vote: 'like' });
  const [s2, d2] = await post(env, '/api/reactions', { slug: SLUG, vote: 'like' });
  assert.equal(s2, 200);
  assert.deepEqual(d2, { like: 1, dislike: 0 });
  // Switch vote: like decrements, dislike increments — net still one vote total.
  const [s3, d3] = await post(env, '/api/reactions', { slug: SLUG, vote: 'dislike' });
  assert.equal(s3, 200);
  assert.deepEqual(d3, { like: 0, dislike: 1 });
});

test('GET reactions never leaks the voter map', async () => {
  const env = makeEnv();
  await post(env, '/api/reactions', { slug: SLUG, vote: 'like' });
  const [status, data] = await get(env, '/api/reactions?slug=' + SLUG);
  assert.equal(status, 200);
  assert.deepEqual(data, { like: 1, dislike: 0 });
  const raw = await env.AFP_DATA.get('react:' + SLUG);
  assert.ok(raw.includes('"voters"'), 'voter map is persisted in KV');
  assert.ok(!raw.includes('1.2.3.4'), 'raw client IP is never persisted');
});

test('rate limit: 31st vote in an hour from one IP/slug returns 429', async () => {
  const env = makeEnv();
  let lastStatus = 0;
  for (let i = 0; i < 31; i++) {
    const [status] = await post(env, '/api/reactions', { slug: SLUG, vote: 'like' }, '7.7.7.7');
    lastStatus = status;
  }
  assert.equal(lastStatus, 429);
});

/* ---------------- comments ---------------- */

test('held comment (with link) is stored but NOT returned by GET', async () => {
  const env = makeEnv();
  const [s1, d1] = await post(env, '/api/comments', {
    slug: SLUG, name: 'Spammer', text: 'great post, see https://spam.example',
  });
  assert.equal(s1, 200);
  assert.deepEqual(d1, { ok: true, held: true });
  const [s2, d2] = await get(env, '/api/comments?slug=' + SLUG);
  assert.equal(s2, 200);
  assert.deepEqual(d2.comments, []);
  assert.equal(d2.count, 0);
});

test('moderate approve with wrong token is 403; with right token approves', async () => {
  const env = makeEnv('right-token');
  const [s1] = await post(env, '/api/comments', {
    slug: SLUG, name: 'Spammer', text: 'visit https://spam.example',
  });
  assert.equal(s1, 200);
  const [sWrong, dWrong] = await post(
    env, '/api/comments/moderate', { slug: SLUG, id: 'x', action: 'approve' }, undefined,
    { authorization: 'Bearer wrong-token' }
  );
  assert.equal(sWrong, 403);
  assert.deepEqual(dWrong, { error: 'forbidden' });

  // Find the held comment's id straight from KV.
  const list = JSON.parse(await env.AFP_DATA.get('comments:' + SLUG));
  const [sOk, dOk] = await post(
    env, '/api/comments/moderate', { slug: SLUG, id: list[0].id, action: 'approve' }, undefined,
    { authorization: 'Bearer right-token' }
  );
  assert.equal(sOk, 200);
  assert.deepEqual(dOk, { ok: true, action: 'approve' });
  const [, dGet] = await get(env, '/api/comments?slug=' + SLUG);
  assert.equal(dGet.count, 1);
  assert.equal(dGet.comments[0].text, 'visit https://spam.example');
});

test('moderate delete with right token removes the comment', async () => {
  const env = makeEnv('tok');
  await post(env, '/api/comments', { slug: SLUG, name: 'Ann', text: 'hello https://x.example' });
  const list = JSON.parse(await env.AFP_DATA.get('comments:' + SLUG));
  const [s, d] = await post(
    env, '/api/comments/moderate', { slug: SLUG, id: list[0].id, action: 'delete' }, undefined,
    { authorization: 'Bearer tok' }
  );
  assert.equal(s, 200);
  assert.deepEqual(d, { ok: true, action: 'delete' });
  const after = JSON.parse(await env.AFP_DATA.get('comments:' + SLUG));
  assert.deepEqual(after, []);
});

test('moderation without AFP_ADMIN_TOKEN set returns 403 "moderation not configured"', async () => {
  const env = makeEnv(); // no token
  const [status, data] = await post(
    env, '/api/comments/moderate', { slug: SLUG, id: 'x', action: 'approve' }, undefined,
    { authorization: 'Bearer anything' }
  );
  assert.equal(status, 403);
  assert.deepEqual(data, { error: 'moderation not configured' });
});
