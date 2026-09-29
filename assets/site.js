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

  /* ---------- Share row (all articles) ----------
     Injected at the top of every article page (after the byline).
     Native Web Share on mobile when available; otherwise share-intent URLs. */
  var SHARE_SVGS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    reddit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="14.5" rx="7.5" ry="5"/><circle cx="4" cy="14.5" r="1.4"/><circle cx="20" cy="14.5" r="1.4"/><path d="M12 9.5 15 5"/><circle cx="15.9" cy="3.9" r="1.2"/><circle cx="9.2" cy="13.8" r="0.9" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.8" r="0.9" fill="currentColor" stroke="none"/><path d="M9.5 16.8c1.6 1 3.4 1 5 0"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    native: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>'
  };

  var SHARE_NETWORKS = [
    { id: 'x', label: 'Share on X', url: function (u, t) { return 'https://x.com/intent/tweet?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(u); } },
    { id: 'facebook', label: 'Share on Facebook', url: function (u) { return 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u); } },
    { id: 'reddit', label: 'Share on Reddit', url: function (u, t) { return 'https://www.reddit.com/submit?url=' + encodeURIComponent(u) + '&title=' + encodeURIComponent(t); } },
    { id: 'linkedin', label: 'Share on LinkedIn', url: function (u) { return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(u); } },
    { id: 'whatsapp', label: 'Share on WhatsApp', url: function (u, t) { return 'https://wa.me/?text=' + encodeURIComponent(t + ' ' + u); } },
    { id: 'telegram', label: 'Share on Telegram', url: function (u, t) { return 'https://t.me/share/url?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t); } }
  ];

  function shareTitle() {
    var og = document.querySelector('meta[property="og:title"]');
    var t = og ? og.getAttribute('content') : document.title;
    return String(t || '').replace(/\s*[|\-–—]\s*AI Frontier Post\s*$/i, '').trim() || document.title;
  }

  function shareUrl() {
    var c = document.querySelector('link[rel="canonical"]');
    return (c && c.getAttribute('href')) || location.href;
  }

  function setupShare() {
    if (!document.querySelector || document.querySelector('.share-row')) return;
    var header = document.querySelector('article.post .post-header');
    if (!header) return;
    var url = shareUrl(), title = shareTitle();

    var html = '<span class="share-label">Share</span>';
    if (navigator.share) {
      html += '<button type="button" class="share-btn share-native" data-share-native aria-label="Share via…" title="Share via…">' + SHARE_SVGS.native + '</button>';
    }
    for (var i = 0; i < SHARE_NETWORKS.length; i++) {
      var n = SHARE_NETWORKS[i];
      html += '<a class="share-btn share-' + n.id + '" href="' + n.url(url, title) + '" target="_blank" rel="noopener" aria-label="' + n.label + '" title="' + n.label + '">' + SHARE_SVGS[n.id] + '</a>';
    }
    html += '<button type="button" class="share-btn share-copy" data-share-copy aria-label="Copy link" title="Copy link">' + SHARE_SVGS.link + '</button>';
    html += '<span class="share-copied" hidden>Copied</span>';

    var row = document.createElement('div');
    row.className = 'share-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Share this article');
    row.innerHTML = html;

    var anchor = header.querySelector('.byline');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
    } else {
      header.appendChild(row);
    }

    row.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a.share-btn') : null;
      if (a) {
        e.preventDefault();
        window.open(a.href, 'afp-share', 'width=640,height=560,menubar=no,toolbar=no');
        return;
      }
      var b = e.target.closest ? e.target.closest('[data-share-native]') : null;
      if (b && navigator.share) {
        navigator.share({ title: title, text: title, url: url }).catch(function () {});
        return;
      }
      var c = e.target.closest ? e.target.closest('[data-share-copy]') : null;
      if (c) {
        var done = function () {
          var tip = row.querySelector('.share-copied');
          if (tip) { tip.hidden = false; setTimeout(function () { tip.hidden = true; }, 1600); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, done);
        } else {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (err) {}
          document.body.removeChild(ta);
          done();
        }
      }
    });
  }

  function boot(scope) {
    scope = scope || document;
    var rxs = scope.querySelectorAll ? scope.querySelectorAll('[data-reactions]') : [];
    for (var i = 0; i < rxs.length; i++) setupReactions(rxs[i]);
    var cms = scope.querySelectorAll ? scope.querySelectorAll('[data-comments]') : [];
    for (var j = 0; j < cms.length; j++) setupComments(cms[j]);
    if (scope === document) { try { setupShare(); } catch (e) {} }
  }

  window.AFP = window.AFP || {};
  window.AFP.boot = boot;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(document); });
  } else {
    boot(document);
  }
})();
