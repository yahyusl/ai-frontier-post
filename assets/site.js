/* AI Frontier Post — engagement: reactions (like/dislike) + comments.
   Mounts: <div class="reactions" data-reactions="slug"></div>
           <div class="comments" data-comments="slug"></div>
   Call window.AFP.boot() after any dynamic render (the SPA does this). */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function timeAgo(ts) {
    var s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  }

  var ICON_UP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
  var ICON_DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';

  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || 'request failed');
        return d;
      });
    });
  }

  /* ---------- reactions ---------- */
  function voteKey(slug) { return 'afp-vote:' + slug; }
  function getVote(slug) {
    try { return localStorage.getItem(voteKey(slug)); } catch (e) { return null; }
  }
  function setVote(slug, v) {
    try {
      if (v) localStorage.setItem(voteKey(slug), v);
      else localStorage.removeItem(voteKey(slug));
    } catch (e) {}
  }

  function paint(box, counts, voted) {
    var like = box.querySelector('[data-vote="like"]');
    var dislike = box.querySelector('[data-vote="dislike"]');
    like.querySelector('b').textContent = counts.like;
    dislike.querySelector('b').textContent = counts.dislike;
    like.classList.toggle('active', voted === 'like');
    dislike.classList.toggle('active', voted === 'dislike');
    like.setAttribute('aria-pressed', voted === 'like' ? 'true' : 'false');
    dislike.setAttribute('aria-pressed', voted === 'dislike' ? 'true' : 'false');
  }

  function setupReactions(box) {
    if (box.__afp) return;
    box.__afp = 1;
    var slug = box.getAttribute('data-reactions');
    if (!slug) return;
    box.innerHTML =
      '<span class="rx-label">Was this useful?</span>' +
      '<button type="button" class="rx-btn" data-vote="like" aria-pressed="false">' + ICON_UP + '<b>0</b></button>' +
      '<button type="button" class="rx-btn" data-vote="dislike" aria-pressed="false">' + ICON_DOWN + '<b>0</b></button>';
    var counts = { like: 0, dislike: 0 };
    var voted = getVote(slug);
    var busy = false;

    function refresh() {
      api('/api/reactions?slug=' + encodeURIComponent(slug))
        .then(function (d) { counts = d; paint(box, counts, voted); })
        .catch(function () {});
    }

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-vote]');
      if (!btn || busy) return;
      var vote = btn.getAttribute('data-vote');
      // Clicking the active vote again removes it.
      var next = voted === vote ? null : vote;
      busy = true;
      btn.classList.add('busy');
      api('/api/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next ? { slug: slug, vote: next, prev: voted } : { slug: slug, vote: vote, prev: vote, unvote: true })
      }).then(function (d) {
        counts = d; voted = next; setVote(slug, voted); paint(box, counts, voted);
      }).catch(function () {
        // offline fallback: keep it local-only
        if (next && next !== voted) { counts[next]++; if (voted) counts[voted]--; }
        else if (!next && voted) { counts[voted]--; }
        voted = next; setVote(slug, voted); paint(box, counts, voted);
      }).finally(function () { busy = false; btn.classList.remove('busy'); });
    });

    // Server-side: the stored vote (keyed by hashed client IP) is authoritative.
    // An unvote only retracts when it matches the stored vote; re-voting the
    // same option is a no-op, switching moves one count.
    refresh();
  }

  /* ---------- comments ---------- */
  function commentHTML(c) {
    var initial = (c.name || '?').trim().charAt(0).toUpperCase();
    return '<div class="comment"><span class="avatar sm">' + esc(initial) + '</span>' +
      '<div class="comment-body"><div class="comment-meta"><b>' + esc(c.name) + '</b>' +
      '<span>' + esc(timeAgo(c.ts)) + '</span></div>' +
      '<p>' + esc(c.text).replace(/\n/g, '<br>') + '</p></div></div>';
  }

  function setupComments(box) {
    if (box.__afp) return;
    box.__afp = 1;
    var slug = box.getAttribute('data-comments');
    if (!slug) return;
    box.innerHTML =
      '<div class="section-head"><h2>Join the discussion</h2><span class="meta" data-ccount></span></div>' +
      '<div class="comment-list" data-clist><p class="comments-loading">Loading comments…</p></div>' +
      '<form class="comment-form" data-cform novalidate>' +
      '<h3>Leave a comment</h3>' +
      '<div class="comment-rules"><span>Challenge ideas, not people</span><span>Bring evidence</span><span>Keep it useful</span></div>' +
      '<label>Your name<input name="name" maxlength="40" autocomplete="name" placeholder="Ada Lovelace" required></label>' +
      '<label>Comment<textarea name="text" rows="4" maxlength="2000" placeholder="What did this get right — or wrong?" required></textarea></label>' +
      '<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<div class="comment-actions"><button type="submit" class="btn-accent">Post comment</button>' +
      '<span class="form-status" data-status role="status"></span></div></form>';

    var list = box.querySelector('[data-clist]');
    var countEl = box.querySelector('[data-ccount]');
    var form = box.querySelector('[data-cform]');
    var status = box.querySelector('[data-status]');

    function load() {
      api('/api/comments?slug=' + encodeURIComponent(slug)).then(function (d) {
        var n = d.count || 0;
        countEl.textContent = n === 1 ? '1 comment' : n + ' comments';
        list.innerHTML = n
          ? d.comments.map(commentHTML).join('')
          : '<p class="comments-empty">No comments yet — start the conversation.</p>';
      }).catch(function () {
        list.innerHTML = '<p class="comments-empty">Comments are unavailable right now. Please try again later.</p>';
        countEl.textContent = '';
      });
    }

    var nameEl = form.querySelector('input[name="name"]');
    var textEl = form.querySelector('textarea[name="text"]');
    var hpEl = form.querySelector('input[name="website"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameEl.value.trim();
      var text = textEl.value.trim();
      if (name.length < 2) { status.textContent = 'Please add your name.'; return; }
      if (text.length < 3) { status.textContent = 'Please write a comment first.'; return; }
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      status.textContent = 'Posting…';
      api('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: slug, name: name, text: text, website: hpEl.value })
      }).then(function (d) {
        textEl.value = '';
        status.textContent = d.held
          ? 'Thanks — your comment is awaiting moderation.'
          : 'Comment posted. Thanks for joining in.';
        load();
      }).catch(function (err) {
        status.textContent = err.message || 'Could not post. Try again.';
      }).finally(function () { btn.disabled = false; });
    });

    load();
  }

  function boot(scope) {
    scope = scope || document;
    var rxs = scope.querySelectorAll ? scope.querySelectorAll('[data-reactions]') : [];
    for (var i = 0; i < rxs.length; i++) setupReactions(rxs[i]);
    var cms = scope.querySelectorAll ? scope.querySelectorAll('[data-comments]') : [];
    for (var j = 0; j < cms.length; j++) setupComments(cms[j]);
  }

  window.AFP = window.AFP || {};
  window.AFP.boot = boot;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(document); });
  } else {
    boot(document);
  }
})();
