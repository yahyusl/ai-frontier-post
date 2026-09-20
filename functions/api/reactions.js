// GET  /api/reactions?slug=<slug>        -> {like, dislike}
// POST /api/reactions {slug, vote, prev?} -> {like, dislike}
// vote/prev are "like" | "dislike". `prev` lets a reader switch their vote.
import { json, handleOptions, readJson, validSlug, checkRate, clientIp } from './_store.js';

const key = (slug) => 'react:' + slug;
const empty = () => ({ like: 0, dislike: 0 });

function sanitize(cur) {
  const like = Math.max(0, parseInt(cur && cur.like, 10) || 0);
  const dislike = Math.max(0, parseInt(cur && cur.dislike, 10) || 0);
  return { like, dislike };
}

export async function onRequestGet({ request, env }) {
  const slug = new URL(request.url).searchParams.get('slug') || '';
  if (!validSlug(slug)) return json({ error: 'bad slug' }, 400);
  const cur = sanitize(JSON.parse((await env.AFP_DATA.get(key(slug))) || 'null'));
  return json(cur);
}

export async function onRequestPost({ request, env }) {
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
  const k = key(slug);
  const cur = sanitize(JSON.parse((await env.AFP_DATA.get(k)) || 'null'));
  if (unvote) {
    // Reader removed their vote: just decrement, never increment.
    if (cur[prev] > 0) cur[prev] -= 1;
  } else {
    if (prev && prev !== vote && cur[prev] > 0) cur[prev] -= 1;
    cur[vote] += 1;
  }
  await env.AFP_DATA.put(k, JSON.stringify(cur));
  return json(cur);
}

export async function onRequestOptions() {
  return handleOptions();
}
