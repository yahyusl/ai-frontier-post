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

  /* ---------- Share (all articles) ----------
     Premium segmented share cluster, mounted twice: after the byline at the
     top of the article, and in a "pass it on" block at the end.
     Native Web Share on mobile when available; otherwise share-intent URLs. */
  var SHARE_SVGS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    reddit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="14.5" rx="7.5" ry="5"/><circle cx="4" cy="14.5" r="1.4"/><circle cx="20" cy="14.5" r="1.4"/><path d="M12 9.5 15 5"/><circle cx="15.9" cy="3.9" r="1.2"/><circle cx="9.2" cy="13.8" r="0.9" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.8" r="0.9" fill="currentColor" stroke="none"/><path d="M9.5 16.8c1.6 1 3.4 1 5 0"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
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

  function buildShareRow(url, title) {
    var html = '<span class="share-label">Share</span>';
    if (navigator.share) {
      html += '<button type="button" class="share-btn share-native" data-share-native aria-label="Share via\u2026" title="Share via\u2026">' + SHARE_SVGS.native + '</button>';
    }
    for (var i = 0; i < SHARE_NETWORKS.length; i++) {
      var n = SHARE_NETWORKS[i];
      html += '<a class="share-btn share-' + n.id + '" href="' + n.url(url, title) + '" target="_blank" rel="noopener" aria-label="' + n.label + '" title="' + n.label + '">' + SHARE_SVGS[n.id] + '</a>';
    }
    html += '<button type="button" class="share-btn share-copy" data-share-copy aria-label="Copy link" title="Copy link">' + SHARE_SVGS.link + '</button>';
    var row = document.createElement('div');
    row.className = 'share-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Share this article');
    row.innerHTML = html;
    row.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a.share-btn') : null;
      if (a) {
        e.preventDefault();
        window.open(a.href, 'afp-share', 'width=640,height=560,menubar=no,toolbar=no');
        return;
      }
      var nb = e.target.closest ? e.target.closest('[data-share-native]') : null;
      if (nb && navigator.share) {
        navigator.share({ title: title, text: title, url: url }).catch(function () {});
        return;
      }
      var cp = e.target.closest ? e.target.closest('[data-share-copy]') : null;
      if (cp) {
        var done = function () {
          cp.classList.add('copied');
          cp.innerHTML = SHARE_SVGS.check;
          cp.setAttribute('aria-label', 'Link copied');
          cp.setAttribute('title', 'Link copied');
          setTimeout(function () {
            cp.classList.remove('copied');
            cp.innerHTML = SHARE_SVGS.link;
            cp.setAttribute('aria-label', 'Copy link');
            cp.setAttribute('title', 'Copy link');
          }, 1800);
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
    return row;
  }

  function setupShare() {
    if (!document.querySelector || document.querySelector('.share-top')) return;
    var post = document.querySelector('article.post');
    if (!post) return;
    var url = shareUrl(), title = shareTitle();

    var header = post.querySelector('.post-header');
    if (header) {
      var top = buildShareRow(url, title);
      top.classList.add('share-top');
      var anchor = header.querySelector('.byline');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(top, anchor.nextSibling);
      else header.appendChild(top);
    }

    var end = document.createElement('div');
    end.className = 'share-end';
    var h = document.createElement('p');
    h.className = 'share-end-title';
    h.textContent = 'Found this useful? Pass it on.';
    end.appendChild(h);
    end.appendChild(buildShareRow(url, title));
    post.appendChild(end);
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

/* ============================================================
   AI Frontier Post — delight layer
   Interactive archives, motion, reading aids and a few easter eggs.
   Everything is progressive: the site reads fine without any of it,
   and motion is skipped for prefers-reduced-motion.
   ============================================================ */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var mq = function (q) { return !!(window.matchMedia && matchMedia(q).matches); };
  var REDUCE = mq('(prefers-reduced-motion: reduce)');
  var FINE = mq('(hover: hover) and (pointer: fine)');

  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  var decoder = doc.createElement('textarea');
  function txt(s) { decoder.innerHTML = String(s == null ? '' : s); return decoder.value; }
  function esc(s) {
    return txt(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function typing(e) {
    var t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function parseDay(d) { var p = String(d).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtDate(d) { var x = parseDay(d); return MONTHS[x.getMonth()].slice(0, 3) + ' ' + x.getDate() + ', ' + x.getFullYear(); }
  function daysAgo(d) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t - parseDay(d)) / 864e5); }
  function ago(d) {
    var n = daysAgo(d);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? n + ' days ago' : Math.round(n / 7) + ' weeks ago';
  }
  function initials(n) { return String(n).split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2); }
  function tagList(p) {
    return Array.isArray(p.tags) ? p.tags : String(p.tags || '').replace(/^\[|\]$/g, '').split(',')
      .map(function (t) { return t.trim().replace(/^["']|["']$/g, ''); }).filter(Boolean);
  }
  function tagKey(t) { return String(t).toLowerCase().replace(/[-_\s]+/g, ' ').trim(); }
  var postsP = null;
  function posts() {
    return postsP || (postsP = fetch('/posts.json').then(function (r) {
      if (!r.ok) throw new Error('posts ' + r.status);
      return r.json();
    }));
  }

  /* ---------- toast ---------- */
  function toast(html, ms) {
    var box = $('.afp-toasts');
    if (!box) { box = doc.createElement('div'); box.className = 'afp-toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); doc.body.appendChild(box); }
    var t = doc.createElement('div');
    t.className = 'afp-toast';
    t.innerHTML = html;
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, ms || 3600);
  }

  /* ---------- confetti (tiny canvas burst) ---------- */
  function confetti(x, y, opts) {
    if (REDUCE) return;
    opts = opts || {};
    var cv = doc.createElement('canvas'), ctx = cv.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.className = 'afp-confetti';
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    doc.body.appendChild(cv);
    ctx.scale(dpr, dpr);
    var colors = opts.colors || ['#4d46e5', '#8f88ff', '#e8b23f', '#1d7a4c', '#2563eb', '#f472b6'];
    var bits = [];
    for (var i = 0; i < (opts.count || 90); i++) {
      var a = (opts.spread ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - .5) * 1.9);
      var v = 4 + Math.random() * 7;
      bits.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.28, vr: (Math.random() - .5) * .3,
        w: 5 + Math.random() * 5, h: 8 + Math.random() * 6, c: colors[i % colors.length], t: 0 });
    }
    var start = performance.now();
    (function tick(now) {
      var el = now - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      bits.forEach(function (b) {
        b.vy += .22; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.globalAlpha = Math.max(0, 1 - el / 1900);
        ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
        ctx.restore();
      });
      if (el < 1900) requestAnimationFrame(tick); else cv.remove();
    })(start);
  }

  /* ---------- masthead height, condense, progress, back-to-top ---------- */
  var mast = $('.masthead');
  function mastVars() { if (mast) root.style.setProperty('--mast-real', mast.offsetHeight + 'px'); }
  mastVars();
  addEventListener('resize', mastVars);

  var post = $('article.post');
  var bar = $('#progress') || $('.progress');
  if (!bar && post) { bar = doc.createElement('div'); bar.className = 'progress'; bar.setAttribute('aria-hidden', 'true'); doc.body.insertBefore(bar, doc.body.firstChild); }
  var ownBar = bar && !bar.id; // the homepage drives its own #progress

  var top = doc.createElement('button');
  top.type = 'button'; top.className = 'to-top'; top.setAttribute('aria-label', 'Back to top');
  top.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="tt-track" cx="22" cy="22" r="19"/><circle class="tt-ring" cx="22" cy="22" r="19"/></svg>' +
    '<svg class="tt-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  doc.body.appendChild(top);
  var ring = $('.tt-ring', top), RING = 2 * Math.PI * 19;
  ring.style.strokeDasharray = RING;
  top.addEventListener('click', function () { scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' }); });

  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = scrollY, max = Math.max(1, doc.documentElement.scrollHeight - innerHeight);
    if (mast) mast.classList.toggle('is-scrolled', y > 8);
    top.classList.toggle('show', y > innerHeight * 1.2);
    ring.style.strokeDashoffset = RING * (1 - Math.min(1, y / max));
    if (ownBar && post) {
      var r = post.getBoundingClientRect();
      var p = (innerHeight * .35 - r.top) / Math.max(1, r.height - innerHeight * .4);
      bar.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
    }
    if (toc) tocSpy();
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  /* ---------- scroll reveal + scoreboard count-up ---------- */
  var RV = '.river-card,.category-card,.stack-card,.rel-card,.cx-card,.trend,.section-head,.score-card,.pod-ep,.person,.inline-art,.author-box,.reactions,.comment-form,.share-end,.cx-month,.art-item';
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    var shown = entries.filter(function (en) { return en.isIntersecting; })
      .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left; });
    shown.forEach(function (en, i) {
      var el = en.target;
      io.unobserve(el);
      el.style.setProperty('--rv-d', Math.min(i, 8) * 60 + 'ms');
      el.classList.add('rv-in');
      if (el.classList.contains('score-card')) countUp(el);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 }) : null;

  function countUp(scope) {
    if (REDUCE || scope.__counted) return;
    scope.__counted = 1;
    $$('.s-score, [data-count]', scope).forEach(function (el) {
      var m = /^([\d,]*\.?\d+)(.*)$/.exec(el.textContent.trim());
      if (!m) return;
      var to = parseFloat(m[1].replace(/,/g, '')), dec = (m[1].split('.')[1] || '').length, suf = m[2], comma = m[1].indexOf(',') >= 0;
      var t0 = performance.now(), dur = 900 + Math.random() * 300;
      (function step(now) {
        var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = to * e;
        var s = dec ? v.toFixed(dec) : String(Math.round(v));
        if (comma) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        el.textContent = s + suf;
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  function reveal(scope) {
    if (!io || REDUCE || !scope || scope.nodeType !== 1) return;
    var els = $$(RV, scope);
    if (scope.matches && scope.matches(RV)) els.unshift(scope);
    els.forEach(function (el) {
      if (el.__rv) return;
      el.__rv = 1;
      var r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) { if (el.classList.contains('score-card')) countUp(el); return; } // already on screen: no pop-in
      el.classList.add('rv');
      io.observe(el);
    });
  }
  reveal(doc.body);
  if ('MutationObserver' in window) {
    var pending = [];
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) if (m.addedNodes[i].nodeType === 1) pending.push(m.addedNodes[i]); });
      if (pending.length) requestAnimationFrame(function () { var p = pending; pending = []; p.forEach(reveal); mastVars(); });
    }).observe(doc.body, { childList: true, subtree: true });
  }

  /* ---------- pointer spotlight on cards ---------- */
  var SPOT = '.cx-card,.rel-card,.stack-card,.category-card,.lead-card,.newsletter-mini,.art-item,.pod-ep,.person';
  if (FINE && !REDUCE) {
    doc.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest(SPOT);
      if (!c) return;
      var r = c.getBoundingClientRect();
      c.classList.add('fx-spot');
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  /* ---------- articles: drop cap, table of contents rail, finish line ---------- */
  var toc = null, tocLinks = [], tocHeads = [];
  function tocSpy() {
    var body = $('.article-body', post), r = body.getBoundingClientRect();
    toc.classList.toggle('is-visible', r.top < innerHeight * .5 && r.bottom > innerHeight * .4 && body.getBoundingClientRect().left >= 290);
    var cur = 0;
    tocHeads.forEach(function (h, i) { if (h.getBoundingClientRect().top < innerHeight * .3) cur = i; });
    tocLinks.forEach(function (a, i) { a.classList.toggle('active', i === cur); });
  }
  function placeToc() {
    if (!toc) return;
    var left = $('.article-body', post).getBoundingClientRect().left;
    toc.style.left = Math.max(16, left - 268) + 'px';
    tocSpy();
  }
  if (post && !$('.article-body', post)) {
    // safety net: some pipeline pages leave the copy loose inside <article>
    var loose = Array.prototype.slice.call(post.children).filter(function (el) {
      return !el.matches('.post-header,.hero-art,.share-end,script');
    });
    if (loose.length) {
      var wrapEl = doc.createElement('div');
      wrapEl.className = 'article-body';
      post.insertBefore(wrapEl, loose[0]);
      loose.forEach(function (el) { wrapEl.appendChild(el); });
    }
  }
  if (post) {
    var bodyEl = $('.post > .article-body');
    if (bodyEl) {
      var first = bodyEl.firstElementChild;
      if (first && first.tagName === 'P' && first.textContent.trim().length > 140 && /^[A-Za-z]/.test(first.textContent.trim())) bodyEl.classList.add('has-dropcap');
      var heads = $$(':scope > h2', bodyEl).filter(function (h) { return !/^sources\b/i.test(h.textContent.trim()); });
      if (heads.length >= 3) {
        toc = doc.createElement('nav');
        toc.className = 'toc-rail';
        toc.setAttribute('aria-label', 'On this page');
        var used = {};
        toc.innerHTML = '<b>On this page</b>' + heads.map(function (h) {
          if (!h.id) {
            var id = h.textContent.toLowerCase().replace(/#\s*$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';
            while (used[id] || doc.getElementById(id)) id += '-x';
            h.id = id;
          }
          used[h.id] = 1;
          return '<a href="#' + h.id + '">' + esc(h.textContent.replace(/\s*#\s*$/, '')) + '</a>';
        }).join('');
        doc.body.appendChild(toc);
        tocLinks = $$('a', toc); tocHeads = heads;
        addEventListener('resize', placeToc);
        placeToc();
      }
    }
    var end = $('.share-end') || $('.post-engage') || bodyEl;
    var slugKey = 'afp-done:' + location.pathname;
    if (end && io && !ss(slugKey)) {
      var fin = new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        fin.disconnect();
        ss(slugKey, '1');
        var r = en[0].target.getBoundingClientRect();
        confetti(innerWidth / 2, Math.max(80, r.top), { count: 70 });
        var mins = (/(\d+)\s*min read/.exec(($('.byline') || doc.body).textContent) || [])[1];
        toast('<b>Finish line.</b> ' + (mins ? mins + ' minutes well spent.' : 'You read the whole thing.') + ' That’s rarer than AGI.');
      }, { threshold: .3 });
      fin.observe(end);
    }
  }

  /* ---------- interactive category archive ---------- */
  var catBody = doc.body.classList.contains('cat-page') ? doc.body : null;
  if (catBody) buildArchive();

  function buildArchive() {
    var cat = catBody.getAttribute('data-category'), slug = catBody.getAttribute('data-cat-slug');
    var main = $('main');
    if (!main || !cat) return;
    var desc = ($('.cat-desc') || {}).textContent || '';
    desc = desc.replace(/\s*\(\d+ stories\)\s*$/, '');
    posts().then(function (all) {
      var list = all.filter(function (p) { return p.category === cat; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); });
      if (!list.length) return;
      var PAGE = 24;
      var params = new URLSearchParams(location.search);
      var st = { q: params.get('q') || '', tag: params.get('tag') || '', sort: params.get('sort') || 'new', shown: PAGE };

      // hero
      var minutes = list.reduce(function (s, p) { return s + (+p.reading_minutes || 0); }, 0);
      var writers = {}; list.forEach(function (p) { writers[p.author] = 1; });
      var weeks = []; for (var w = 15; w >= 0; w--) weeks.push(0);
      list.forEach(function (p) { var k = Math.floor(daysAgo(p.date) / 7); if (k >= 0 && k < 16) weeks[15 - k]++; });
      var wmax = Math.max.apply(null, weeks.concat(1));
      var hero = doc.createElement('section');
      hero.className = 'cx-hero';
      hero.innerHTML = '<span class="cx-blob b1"></span><span class="cx-blob b2"></span><span class="cx-blob b3"></span>' +
        '<div class="cx-hero-in"><nav class="cx-crumb" aria-label="Breadcrumb"><a href="/">Home</a> / ' + esc(cat) + '</nav>' +
        '<div><span class="cx-kicker"><i></i>The archive · updated ' + ago(list[0].date) + '</span>' +
        '<h1>' + esc(cat) + '<span class="cx-dot">.</span></h1><p class="cx-desc">' + esc(desc) + '</p>' +
        '<div class="cx-stats"><div class="cx-stat"><b data-count>' + list.length + '</b><span>Stories</span></div>' +
        '<div class="cx-stat"><b data-count>' + Math.max(1, Math.round(minutes / 60)) + '</b><span>Hours of reading</span></div>' +
        '<div class="cx-stat"><b data-count>' + Object.keys(writers).length + '</b><span>Writers</span></div></div></div>' +
        '<div class="cx-spark" aria-label="Stories published per week, last 16 weeks"><div class="cx-spark-bars">' +
        weeks.map(function (n, i) { return '<i style="--i:' + i + ';height:' + Math.max(3, n / wmax * 100) + '%" title="' + n + ' stories"></i>'; }).join('') +
        '</div><small><span>16 weeks ago</span><span>This week</span></small></div></div>';

      var wrap = doc.createElement('div');
      wrap.className = 'cx-wrap';
      var tags = {}, spell = {};
      list.forEach(function (p) {
        tagList(p).forEach(function (t) {
          var k = tagKey(t);
          tags[k] = (tags[k] || 0) + 1;
          spell[k] = spell[k] || {}; spell[k][t] = (spell[k][t] || 0) + 1;
        });
      });
      function tagLabel(k) { var f = spell[k] || {}; return Object.keys(f).sort(function (a, b) { return f[b] - f[a]; })[0] || k; }
      st.tag = tagKey(st.tag);
      var topTags = Object.keys(tags).filter(function (t) { return tags[t] > 1; }).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 14);
      if (st.tag && topTags.indexOf(st.tag) < 0 && tags[st.tag]) topTags.unshift(st.tag);
      wrap.innerHTML = '<div class="cx-feature" hidden></div>' +
        '<div class="cx-bar" role="search"><label class="cx-search"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
        '<input type="search" placeholder="Search ' + list.length + ' ' + esc(cat) + ' stories…" aria-label="Search ' + esc(cat) + ' stories" value="' + esc(st.q) + '"><kbd>/</kbd></label>' +
        '<select class="cx-sort" aria-label="Sort stories"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="quick">Quick reads</option><option value="deep">Deep dives</option></select>' +
        '<div class="cx-tags" role="group" aria-label="Filter by topic"><button type="button" class="cx-tag" data-tag="" aria-pressed="' + (!st.tag) + '">All</button>' +
        topTags.map(function (t) { return '<button type="button" class="cx-tag" data-tag="' + esc(t) + '" aria-pressed="' + (st.tag === t) + '">' + esc(tagLabel(t)) + '<small>' + tags[t] + '</small></button>'; }).join('') +
        '</div></div><p class="cx-status" aria-live="polite"></p><div class="cx-results"></div>' +
        '<div class="river-more" hidden><button class="btn-ghost" type="button">More stories</button><small></small></div>';

      var shell = $('.cat-head', main);
      main.insertBefore(hero, main.firstChild);
      if (shell) shell.appendChild(wrap); else { wrap.classList.add('wrap'); main.appendChild(wrap); }
      root.classList.add('cx-on');
      if (!REDUCE) countUp(hero);

      var feat = $('.cx-feature', wrap), input = $('input', wrap), sort = $('.cx-sort', wrap);
      var results = $('.cx-results', wrap), more = $('.river-more', wrap), status = $('.cx-status', wrap);
      sort.value = /^(new|old|quick|deep)$/.test(st.sort) ? st.sort : 'new';
      st.sort = sort.value;
      var featured = list.length >= 7 ? list.slice(0, 3) : [];
      feat.innerHTML = featured.length ? card(featured[0], 'lead') + '<div class="cx-feature-side">' + card(featured[1], 'side') + card(featured[2], 'side') + '</div>' : '';

      function terms() { return st.q.toLowerCase().split(/\s+/).filter(Boolean); }
      function hl(s) {
        var raw = txt(s), t = terms();
        if (!t.length) return esc(raw);
        var re = new RegExp('(' + t.map(function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi');
        return raw.split(re).map(function (part, i) { return i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part); }).join('');
      }
      function card(p, kind) {
        var url = '/articles/' + encodeURIComponent(p.slug) + '/';
        var th = p.thumbnail ? '<img src="' + esc(p.thumbnail) + '" alt="" loading="lazy" decoding="async">'
          : '<div class="abstract-cover cat-' + slug + '"><span class="ac-label">' + esc(cat) + '</span></div>';
        var label = tagList(p)[0] || cat;
        return '<article class="cx-card' + (kind ? ' is-' + kind : '') + '"><a class="cx-thumb" href="' + url + '" tabindex="-1" aria-hidden="true">' + th +
          '<span class="cx-mins">' + (+p.reading_minutes || 1) + ' min</span></a><div class="cx-body"><span class="cx-label">' + esc(label) + '</span>' +
          (p.sponsored ? '<span class="sponsored-badge">Sponsored</span>' : '') +
          '<h3><a href="' + url + '">' + hl(p.title) + '</a></h3><p>' + hl(p.excerpt) + '</p>' +
          '<div class="cx-meta"><span class="avatar">' + esc(initials(p.author)) + '</span><span>' + esc(p.author) + '</span><span aria-hidden="true">·</span><time datetime="' + esc(p.date) + '">' + fmtDate(p.date) + '</time></div></div></article>';
      }
      function filtered() {
        var t = terms();
        var out = list.filter(function (p) {
          if (st.tag && !tagList(p).some(function (x) { return tagKey(x) === st.tag; })) return false;
          if (!t.length) return true;
          var hay = (txt(p.title) + ' ' + txt(p.excerpt) + ' ' + p.author + ' ' + tagList(p).join(' ')).toLowerCase();
          return t.every(function (w) { return hay.indexOf(w) >= 0; });
        });
        if (st.sort === 'old') out = out.slice().reverse();
        else if (st.sort === 'quick') out = out.slice().sort(function (a, b) { return a.reading_minutes - b.reading_minutes || b.date.localeCompare(a.date); });
        else if (st.sort === 'deep') out = out.slice().sort(function (a, b) { return b.reading_minutes - a.reading_minutes || b.date.localeCompare(a.date); });
        return out;
      }
      var pool = [], drawn = 0, lastMonth = null, grid = null, counts = {};
      function monthKey(d) { return d.slice(0, 7); }
      function draw(reset) {
        if (reset) {
          var plain = !st.q && !st.tag && st.sort === 'new';
          feat.hidden = !(plain && featured.length);
          pool = filtered();
          if (plain && featured.length) pool = pool.slice(3);
          drawn = 0; lastMonth = null; grid = null; counts = {};
          pool.forEach(function (p) { var k = monthKey(p.date); counts[k] = (counts[k] || 0) + 1; });
          results.innerHTML = '';
          st.shown = PAGE;
          if (!pool.length && !(plain && featured.length)) {
            results.innerHTML = '<div class="cx-empty"><b>Nothing on the wire.</b><p>No ' + esc(cat) + ' stories match that. Even the frontier has edges.</p><button type="button" class="btn-ghost" data-cx-clear>Clear filters</button></div>';
          }
        }
        var grouped = st.sort === 'new' || st.sort === 'old';
        var end = Math.min(st.shown, pool.length);
        for (; drawn < end; drawn++) {
          var p = pool[drawn], k = monthKey(p.date);
          if (!grid || (grouped && k !== lastMonth)) {
            if (grouped) {
              var d = parseDay(p.date);
              results.insertAdjacentHTML('beforeend', '<h2 class="cx-month">' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '<small>' + counts[k] + ' stor' + (counts[k] === 1 ? 'y' : 'ies') + '</small></h2>');
            }
            grid = doc.createElement('div'); grid.className = 'cx-grid'; results.appendChild(grid);
            lastMonth = k;
          }
          grid.insertAdjacentHTML('beforeend', card(p));
        }
        var total = pool.length + (feat.hidden ? 0 : featured.length), showing = drawn + (feat.hidden ? 0 : featured.length);
        more.hidden = drawn >= pool.length;
        $('small', more).textContent = 'Showing ' + showing + ' of ' + total;
        var bits = [];
        if (st.tag) bits.push('tagged <b>' + esc(tagLabel(st.tag)) + '</b>');
        if (st.q) bits.push('matching <b>“' + esc(st.q) + '”</b>');
        status.innerHTML = bits.length ? '<b>' + total + '</b> ' + (total === 1 ? 'story' : 'stories') + ' ' + bits.join(' and ') : '';
      }
      function sync() {
        var u = new URL(location.href);
        ['q', 'tag', 'sort'].forEach(function (k) { var v = st[k]; if (v && !(k === 'sort' && v === 'new')) u.searchParams.set(k, v); else u.searchParams.delete(k); });
        history.replaceState(null, '', u.pathname + u.search + u.hash);
        draw(true);
      }
      var deb;
      input.addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(function () { st.q = input.value.trim(); sync(); }, 140); });
      sort.addEventListener('change', function () { st.sort = sort.value; sync(); });
      $('.cx-tags', wrap).addEventListener('click', function (e) {
        var b = e.target.closest('.cx-tag'); if (!b) return;
        st.tag = b.getAttribute('data-tag') === st.tag ? '' : b.getAttribute('data-tag');
        $$('.cx-tag', wrap).forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-tag') === st.tag)); });
        sync();
      });
      results.addEventListener('click', function (e) {
        if (!e.target.closest('[data-cx-clear]')) return;
        st.q = ''; st.tag = ''; st.sort = 'new'; input.value = ''; sort.value = 'new';
        $$('.cx-tag', wrap).forEach(function (x) { x.setAttribute('aria-pressed', String(!x.getAttribute('data-tag'))); });
        sync(); input.focus();
      });
      $('button', more).addEventListener('click', function () {
        var before = drawn;
        st.shown += PAGE; draw(false);
        var firstNew = $$('.cx-card h3 a', results)[before];
        if (firstNew) firstNew.focus({ preventScroll: true });
      });
      archiveSearch = input;
      draw(true);
    }).catch(function () { /* the static list stays visible */ });
  }
  var archiveSearch = null;

  /* ---------- keyboard: shortcuts + easter eggs ---------- */
  var keys = null;
  function shortcuts() {
    if (keys) { keys.remove(); keys = null; return; }
    keys = doc.createElement('div');
    keys.className = 'afp-keys';
    keys.setAttribute('role', 'dialog'); keys.setAttribute('aria-modal', 'true'); keys.setAttribute('aria-label', 'Keyboard shortcuts');
    var rows = [['/', 'Search'], ['j  k', 'Next / previous story'], ['t', 'Toggle light / dark'], ['g h', 'Go home'], ['g n', 'AI News'], ['g r', 'Research'],
      ['g l', 'Frontier Labs'], ['g t', 'Tutorials'], ['g v', 'Reviews'], ['?', 'This panel'], ['esc', 'Close']];
    keys.innerHTML = '<div class="afp-keys-card"><div class="afp-keys-head"><b>Keyboard shortcuts</b><button type="button" aria-label="Close">×</button></div><dl>' +
      rows.map(function (r) { return '<div><dt>' + r[0].split(/\s+/).map(function (k) { return '<kbd>' + k + '</kbd>'; }).join(' ') + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') +
      '</dl><p class="afp-keys-foot">Rumour has it the classics still work here. ↑↑↓↓…</p></div>';
    keys.addEventListener('click', function (e) { if (e.target === keys || e.target.closest('.afp-keys-head button')) shortcuts(); });
    doc.body.appendChild(keys);
    $('button', keys).focus();
  }
  var STORY = '.cx-card h3 a,.river-card,.category-card,.stack-card,.lead-card,.rel-card,.trend,.art-item h2 a';
  function hop(dir) {
    var items = $$(STORY).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var i = items.indexOf(doc.activeElement);
    if (i < 0) { i = -1; items.some(function (el, n) { if (el.getBoundingClientRect().top > 70) { i = n - (dir > 0 ? 1 : 0); return true; } return false; }); }
    var next = items[Math.max(0, Math.min(items.length - 1, i + dir))];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'center', behavior: REDUCE ? 'auto' : 'smooth' });
  }
  var GO = { h: '/', n: '/category/ai-news/', r: '/category/research/', l: '/category/frontier-labs/', t: '/category/tutorials/', v: '/category/reviews/', p: '/podcasts/', a: '/about/' };
  var KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  var seq = [], word = '', chord = false, chordT;
  doc.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if (k === 'escape') { if (keys) shortcuts(); if (tokens) tokenizer(); closeBoot(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    seq.push(k); seq = seq.slice(-KONAMI.length);
    if (seq.join() === KONAMI.join()) { seq = []; tokenizer(); return; }
    if (k.length === 1) {
      word = (word + k).slice(-12);
      if (/agi$/.test(word)) { word = ''; agi(); return; }
      if (/sudo$/.test(word)) { word = ''; toast('<b>sudo</b>: permission denied. This incident has been reported to the alignment team.'); return; }
      if (/hello$/.test(word)) { word = ''; toast('Hello, human. 👋 I am a static website, but I appreciate the gesture.'); return; }
    }
    if (chord) {
      chord = false; clearTimeout(chordT);
      if (GO[k]) { e.preventDefault(); location.href = GO[k]; }
      return;
    }
    if (k === 'g') { chord = true; chordT = setTimeout(function () { chord = false; }, 900); return; }
    if (e.key === '?') { e.preventDefault(); shortcuts(); return; }
    if (k === '/') {
      var sb = $('#searchBtn');
      if (archiveSearch) { e.preventDefault(); archiveSearch.focus(); archiveSearch.select(); }
      else if (sb) { e.preventDefault(); sb.click(); }
      return;
    }
    if (k === 't') { var tb = $('#themeBtn'); if (tb) tb.click(); return; }
    if (k === 'j') { e.preventDefault(); hop(1); return; }
    if (k === 'k') { e.preventDefault(); hop(-1); }
  });

  /* Easter egg: ↑↑↓↓←→←→BA — see the page the way a language model does */
  var tokens = null;
  function tokenizer() {
    if (tokens) {
      tokens.forEach(function (pair) { if (pair[0].parentNode) pair[0].parentNode.replaceChild(pair[1], pair[0]); });
      tokens = null; root.classList.remove('tok-on');
      toast('Back to human vision.');
      return;
    }
    var scope = $('main') || doc.body, n = 0, count = 0;
    tokens = [];
    var walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        if (!t.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = t.parentElement;
        if (!p || p.closest('script,style,button,input,textarea,select,svg,.afp-keys,.cx-bar')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode() && nodes.length < 4000) nodes.push(walker.currentNode);
    nodes.forEach(function (t) {
      var span = doc.createElement('span');
      span.className = 'tokz';
      (t.nodeValue.match(/\s*[A-Za-z]{1,4}|\s*\d{1,3}|\s*[^\sA-Za-z\d]|\s+/g) || []).forEach(function (piece) {
        var s = doc.createElement('span');
        s.className = 'tk t' + (n++ % 6);
        s.textContent = piece;
        span.appendChild(s);
        count++;
      });
      t.parentNode.replaceChild(span, t);
      tokens.push([span, t]);
    });
    root.classList.add('tok-on');
    toast('<b>Tokenizer vision.</b> This page is ' + count.toLocaleString('en-US') + ' tokens to a model. Konami again or Esc to return.', 6000);
  }

  /* Easter egg: type "agi" */
  var boot = null;
  function closeBoot() { if (boot) { boot.classList.add('out'); var b = boot; boot = null; setTimeout(function () { b.remove(); }, 400); } }
  function agi() {
    if (boot) return;
    boot = doc.createElement('div');
    boot.className = 'agi-boot';
    boot.setAttribute('role', 'dialog'); boot.setAttribute('aria-label', 'AGI achieved (not really)');
    boot.innerHTML = '<pre></pre>';
    doc.body.appendChild(boot);
    boot.addEventListener('click', closeBoot);
    var pre = $('pre', boot);
    var lines = ['> loading frontier_model.ckpt ........ ok', '> parameters: 14,200,000,000,000 ....... ok', '> context window: yes', '> aligning values ..................... ok (probably)',
      '> reading every AI Frontier Post article  ok', '> achieving general intelligence ....... ', '', '__AGI__', '', '...internally. Returning you to the news. (esc)'];
    var i = 0;
    (function next() {
      if (!boot) return;
      if (i >= lines.length) { setTimeout(closeBoot, 2600); return; }
      var l = lines[i++];
      if (l === '__AGI__') { pre.insertAdjacentHTML('beforeend', '<span class="agi-big" data-text="AGI ACHIEVED">AGI ACHIEVED</span>\n'); confetti(innerWidth / 2, innerHeight / 2, { spread: true, count: 120, colors: ['#39ff88', '#a6ffcb', '#e8b23f', '#ffffff'] }); }
      else pre.appendChild(doc.createTextNode(l + '\n'));
      setTimeout(next, REDUCE ? 60 : l.indexOf('achieving') >= 0 ? 1100 : 260);
    })();
  }

  /* Easter egg: hammer the theme toggle — terminal mode */
  var themeBtn = $('#themeBtn'), hits = [];
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var now = Date.now();
    hits = hits.filter(function (t) { return now - t < 3500; }); hits.push(now);
    if (hits.length >= 7) {
      hits = [];
      root.dataset.theme = 'terminal'; ls('afp-theme', 'terminal');
      toast('<b>Terminal mode unlocked.</b> Press the moon to escape.');
    }
  });

  /* Easter egg: click the wordmark five times on the front page */
  var mark = $('.masthead .wordmark');
  var WORDS = ['Singularity', 'Hallucinated', 'Overfitted', 'Superaligned', 'Quantized', 'Emergent', 'Frontier'];
  var clicks = [], busy = false;
  if (mark) mark.addEventListener('click', function (e) {
    if (location.pathname !== '/') return;
    e.preventDefault();
    scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
    var now = Date.now();
    clicks = clicks.filter(function (t) { return now - t < 2000; }); clicks.push(now);
    if (clicks.length < 5 || busy) return;
    clicks = []; busy = true;
    var em = $('em', mark), word = WORDS[Math.floor(Math.random() * (WORDS.length - 1))];
    scramble(em, word, function () {
      toast('Model weights updated. AI <i>' + word + '</i> Post is now live.');
      setTimeout(function () { scramble(em, 'Frontier', function () { busy = false; }); }, 2600);
    });
  });
  function scramble(el, to, done) {
    var from = el.textContent, glyphs = '01<>/\\_[]{}#%&$*+=', len = Math.max(from.length, to.length), f = 0, frames = REDUCE ? 1 : 22;
    (function step() {
      var out = '';
      for (var i = 0; i < len; i++) {
        var settle = i / len * frames * .7 + frames * .3;
        out += f >= settle ? (to[i] || '') : glyphs[Math.floor(Math.random() * glyphs.length)];
      }
      el.textContent = out;
      if (++f <= frames) setTimeout(step, 40); else { el.textContent = to; if (done) done(); }
    })();
  }

  /* Easter egg: the night shift */
  var dl = $('#dateline'), hr = new Date().getHours();
  if (dl && hr < 5) dl.textContent += ' · Night owl edition';

  /* Easter egg: hello, fellow inspector of elements */
  if (!ss('afp-hi') && window.console && console.log) {
    ss('afp-hi', '1');
    console.log('%c AI Frontier Post %c dispatches from the frontier ', 'background:#4d46e5;color:#fff;font:700 14px Georgia,serif;padding:6px 10px;border-radius:6px 0 0 6px',
      'background:#151210;color:#e8b23f;font:12px monospace;padding:7px 10px;border-radius:0 6px 6px 0');
    console.log('%cYou opened the console. You are clearly a frontier person.\nThings worth trying on this site: press ?  ·  type agi  ·  ↑↑↓↓←→←→BA  ·  hammer the moon button.', 'color:#8f88ff;font:12px/1.6 monospace');
  }
})();
