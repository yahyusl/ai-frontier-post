// GET  /api/comments?slug=<slug>                 -> {comments:[...], count}
// POST /api/comments {slug, name, text, website?} -> {ok, held?} | {error}
// `website` is a honeypot — bots fill it, humans never see it.
// Comments containing links are held for moderation instead of auto-approved.
import { json, handleOptions, readJson, validSlug, checkRate, clientIp, cleanStr, makeId } from './_store.js';

const key = (slug) => 'comments:' + slug;
const MAX_STORED = 200;
const HAS_LINK = /(https?:\/\/|www\.)/i;

export async function onRequestGet({ request, env }) {
  const slug = new URL(request.url).searchParams.get('slug') || '';
  if (!validSlug(slug)) return json({ error: 'bad slug' }, 400);
  let list = [];
  try {
    list = JSON.parse((await env.AFP_DATA.get(key(slug))) || '[]');
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  const approved = list.filter((c) => c && c.approved);
  return json({ comments: approved.slice(-MAX_STORED), count: approved.length });
}

export async function onRequestPost({ request, env }) {
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
  const k = key(slug);
  let list = [];
  try {
    list = JSON.parse((await env.AFP_DATA.get(k)) || '[]');
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  list.push(entry);
  await env.AFP_DATA.put(k, JSON.stringify(list.slice(-MAX_STORED)));
  return json({ ok: true, held });
}

export async function onRequestOptions() {
  return handleOptions();
}
