(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const ICONS = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
    movie: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/></svg>',
    show: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 2l3 4 3-4"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    play: '<svg viewBox="0 0 24 24" class="solid"><path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5z"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    chevL: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    chevR: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    stack: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M6 5h12M9 2h6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" class="lock"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  const KEYS = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
    10009: 'back', 8: 'back', 27: 'back',
    415: 'play', 19: 'pause', 10252: 'playpause', 32: 'playpause',
    413: 'stop', 417: 'ff', 412: 'rew', 10221: 'subs', 457: 'info', 70: 'fullscreen',
  };

  // ---------------------------------------------------------------- shell

  // The design is 1920x1080 (the TV). A window of another shape keeps that scale on its short
  // side and grows the stage on the other, so it fills the window: taller shows more rows,
  // wider gives the grids more columns. The TV is exactly 1920x1080, so nothing changes there.
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    const w = Math.round(innerWidth / s), hgt = Math.round(innerHeight / s), stage = $('#stage');
    stage.style.transform = s === 1 ? '' : `scale(${s})`;
    stage.style.width = w + 'px';
    stage.style.height = hgt + 'px';
    const extra = w - 1920;
    stage.style.setProperty('--cols', 7 + Math.floor(extra / 240));
    stage.style.setProperty('--rcols', 5 + Math.floor(extra / 240));
    stage.style.setProperty('--ccols', 5 + Math.floor(extra / 330));
    // Rows measured how far they can scroll at the old width.
    for (const t of document.querySelectorAll('.row-track, .tabs')) t._n = null;
  }

  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 4000);
  }
  document.addEventListener('app:toast', e => toast(e.detail.msg, e.detail.ms));
  // The player borrows the app's picker panel for its subtitle menus.
  document.addEventListener('app:pick', e => { const d = e.detail; picker.open(d.title, d.options, d.current, d.onPick); });

  function exitApp() {
    if (TV) {
      try { tizen.application.getCurrentApplication().exit(); } catch (e) { toast('On the TV, this closes Gravitos.'); }
      return;
    }
    // PC: never closes itself; the window's own close button does that.
  }

  function tickClock() {
    $('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const fmtTime = ms => { const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${mm}:${String(s % 60).padStart(2, '0')}`; };
  const epCode = m => `S${m.parentIndex} E${m.index}`;
  const titleOf = m => (m.type === 'episode' ? m.grandparentTitle : m.type === 'season' ? m.parentTitle : m.title);

  function metaHtml(m) {
    const bits = [];
    if (m.year) bits.push(m.year);
    if (m.contentRating) bits.push(`<span class="badge">${esc(m.contentRating)}</span>`);
    if (m.type === 'show' && m.childCount) bits.push(m.childCount + (m.childCount == 1 ? ' Season' : ' Seasons'));
    else if (m.duration) bits.push(fmtDur(m.duration));
    const genres = (m.Genre || []).slice(0, 2).map(g => esc(g.tag)).join(', ');
    if (genres) bits.push(genres);
    const scores = scoresHtml(m);
    if (scores) bits.push(scores);
    return bits.map(b => `<span>${b}</span>`).join('');
  }

  // IMDb / Rotten Tomatoes scores. Full metadata carries a Rating list with every source;
  // library listings only carry `rating` (critics) and `audienceRating` with an image naming the source.
  function ratingsOf(m) {
    const r = {};
    for (const x of m.Rating || []) {
      const img = x.image || '';
      if (img.indexOf('imdb://') === 0) r.imdb = x.value;
      else if (img.indexOf('rottentomatoes://') === 0 && x.type === 'critic') r.critic = { value: x.value, fresh: !/rotten$/.test(img) };
      else if (img.indexOf('rottentomatoes://') === 0 && x.type === 'audience') r.audience = { value: x.value, up: !/spilled$/.test(img) };
    }
    const ci = m.ratingImage || '', ai = m.audienceRatingImage || '';
    if (!r.critic && ci.indexOf('rottentomatoes://') === 0 && m.rating != null) r.critic = { value: m.rating, fresh: !/rotten$/.test(ci) };
    if (!r.audience && ai.indexOf('rottentomatoes://') === 0 && m.audienceRating != null) r.audience = { value: m.audienceRating, up: !/spilled$/.test(ai) };
    if (r.imdb == null && ai.indexOf('imdb://') === 0) r.imdb = m.audienceRating;
    if (r.imdb == null && !r.critic && !r.audience && m.audienceRating) r.other = m.audienceRating;
    return r;
  }

  const RT_ICONS = {
    fresh: '<svg viewBox="0 0 24 24" class="score-icon"><circle cx="12" cy="13.5" r="8.5" fill="#fa320a"/><path d="M12 6.2C11 3.8 9 3 7.2 3.4c1.6.6 2.7 1.7 3.3 3.2-1.5-.6-3-.5-4.3.3 1.9.2 3.3.9 4.3 2 .5-1 1.2-1.9 2.1-2.4 1 .4 2.3 1.4 3 2.6.3-1.6-.3-3-1.6-3.9 1.4-.6 2.8-.6 4.1-.2-1.4-1.3-3.5-1.5-5.3-.6.2-.8.6-1.5 1.2-2.1-1.1.3-1.8 1-2.3 1.9z" fill="#00912d"/></svg>',
    rotten: '<svg viewBox="0 0 24 24" class="score-icon"><path d="M12 3.5l2.2 4.3 4.6-1.6-1.6 4.6 4.3 2.2-4.3 2.2 1.6 4.6-4.6-1.6L12 22.5l-2.2-4.3-4.6 1.6 1.6-4.6-4.3-2.2 4.3-2.2-1.6-4.6 4.6 1.6z" fill="#0ac855"/></svg>',
    upright: '<svg viewBox="0 0 24 24" class="score-icon"><path d="M5.5 9.5h13l-1.7 12h-9.6z" fill="#fa320a"/><path d="M8.4 9.5l.9 12M15.6 9.5l-.9 12M12 9.5v12" stroke="#fff" stroke-width="1.3"/><circle cx="8" cy="7.5" r="2.6" fill="#ffe08a"/><circle cx="12" cy="6" r="3" fill="#fff3c4"/><circle cx="16" cy="7.5" r="2.6" fill="#ffe08a"/></svg>',
    spilled: '<svg viewBox="0 0 24 24" class="score-icon"><path d="M3 14.5l8.5-5.5 4 6.2-8.5 5.5z" fill="#0ac855"/><circle cx="17" cy="18" r="2.2" fill="#fff3c4"/><circle cx="20" cy="15" r="1.8" fill="#ffe08a"/></svg>',
  };

  function scoresHtml(m) {
    const r = ratingsOf(m), out = [];
    const pct = v => Math.round(v * 10) + '%';
    if (r.imdb != null) out.push(`<span class="score imdb"><b>IMDb</b>${Number(r.imdb).toFixed(1)}</span>`);
    if (r.critic) out.push(`<span class="score">${RT_ICONS[r.critic.fresh ? 'fresh' : 'rotten']}${pct(r.critic.value)}</span>`);
    if (r.audience) out.push(`<span class="score">${RT_ICONS[r.audience.up ? 'upright' : 'spilled']}${pct(r.audience.value)}</span>`);
    if (r.other != null) out.push(`<span class="score">★ ${Number(r.other).toFixed(1)}</span>`);
    return out.length ? `<span class="scores">${out.join('')}</span>` : '';
  }

  // "3 new" on a show you've started that has episodes you haven't seen.
  function newBadge(m) {
    const n = (m.leafCount || 0) - (m.viewedLeafCount || 0);
    return m.type === 'show' && m.viewedLeafCount > 0 && n > 0 ? `<span class="new-badge">${n} new</span>` : '';
  }

  const progressHtml = m => (m.viewOffset && m.duration
    ? `<div class="progress"><i style="width:${Math.min(100, (m.viewOffset / m.duration) * 100)}%"></i></div>` : '');

  // The title's logo artwork, falling back to the title as text if there's none or it fails to load.
  function setBrand(el, m, w, hgt) {
    const url = Plex.logo(m, w, hgt);
    const text = () => { el.innerHTML = `<h1>${esc(titleOf(m))}</h1>`; };
    if (!url) return text();
    const img = h('img');
    img.alt = '';
    img.onerror = text;
    img.src = url;
    el.innerHTML = '';
    el.appendChild(img);
  }

  // On the TV (or with ?tv in the address, to preview it on a PC) the app trades a few
  // expensive effects for speed: see the .tv rules in app.css.
  const TV = typeof window.tizen !== 'undefined' || /[?&]tv\b/.test(location.search);
  document.documentElement.classList.toggle('tv', TV);

  // Plex samples four colours from each title's artwork; they tint the whole background.
  // Repainting that full-screen wash on every move is too slow for the TV, so there it
  // only changes where it's asked for explicitly (`force`: the details page).
  const DEFAULT_AMBIENT = { topLeft: '1c1631', topRight: '101d31', bottomRight: '2a1021', bottomLeft: '0c0c13' };
  let ambFlip = 0, ambKey = '';
  function setAmbient(c, force) {
    if (TV && !force) return;
    const ok = c && ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].every(k => /^[0-9a-f]{6}$/i.test(c[k]));
    if (!ok) c = DEFAULT_AMBIENT;
    const key = c.topLeft + c.topRight + c.bottomRight + c.bottomLeft;
    if (key === ambKey) return;
    ambKey = key;
    const layers = document.querySelectorAll('#ambient .amb');
    ambFlip ^= 1;
    layers[ambFlip].style.background =
      `radial-gradient(75% 85% at 0% 0%, #${c.topLeft} 0%, transparent 100%),` +
      `radial-gradient(75% 85% at 100% 0%, #${c.topRight} 0%, transparent 100%),` +
      `radial-gradient(75% 85% at 100% 100%, #${c.bottomRight} 0%, transparent 100%),` +
      `radial-gradient(75% 85% at 0% 100%, #${c.bottomLeft} 0%, transparent 100%), #08080b`;
    layers[ambFlip].classList.add('on');
    layers[ambFlip ^ 1].classList.remove('on');
  }

  // Crossfade between the two <img> layers in `layers` (hero backdrop).
  function crossfade(layers, src, state) {
    state.flip ^= 1;
    const next = layers[state.flip], prev = layers[state.flip ^ 1];
    const token = (state.token = (state.token || 0) + 1);
    if (!src) { next.classList.remove('on'); prev.classList.remove('on'); return; }
    const show = () => {
      if (token !== state.token) return;
      next.classList.add('on');
      prev.classList.remove('on');
    };
    next.onload = show;
    next.src = src;
    // Tile artwork is already in memory: show it now rather than a frame or two later on load.
    if (next.complete && next.naturalWidth) show();
  }

  // Scroll a horizontal track so the focused item sits near the left edge, leaving `peek`
  // pixels for the previous item, which the container fades out (see .scrolled in the CSS).
  // Positions are measured once and cached: layout reads on every key press add up on a TV.
  // Set while the mouse moves the focus: rows and grids then stay put under the pointer.
  let pointerFocus = false;

  function scrollRow(track, el, peek) {
    if (pointerFocus) return;
    if (el._w == null) { el._w = el.offsetWidth; el._left = el.offsetLeft; }
    if (peek == null) peek = Math.round(el._w * 0.4);
    if (track._pad == null) track._pad = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const box = track.parentElement;
    if (track._n !== track.childElementCount) {
      track._n = track.childElementCount;
      track._max = Math.max(0, track.scrollWidth - box.clientWidth);
    }
    const pad = track._pad;
    const prev = el.previousElementSibling;
    const x = Math.min(track._max, Math.max(0, el._left - pad - (prev ? peek : 0)));
    track.style.transform = x ? `translateX(${-x}px)` : '';
    track._x = x;
    box.classList.toggle('scrolled', x > 0);
    if (x > 0) box.style.setProperty('--edge', Math.max(60, pad + (prev ? peek : 0) - 18) + 'px');
    // The TV has no fade mask: the half-visible previous tile is dimmed instead.
    if (track._peek && track._peek !== prev) track._peek.classList.remove('peek');
    track._peek = x > 0 ? prev : null;
    if (track._peek) track._peek.classList.add('peek');
  }

  // Artwork loads ahead of the cursor: tiles carry data-src until their row is "warmed"
  // (the row you're on and the next two), so images are ready before you reach them.
  function warm(row) {
    if (!row || row._warm) return;
    row._warm = true;
    for (const img of row.querySelectorAll('img[data-src]')) {
      img.src = img.getAttribute('data-src');
      img.removeAttribute('data-src');
    }
  }

  // ---------------------------------------------------------------- view stack

  const views = {};
  const stack = [];
  let sections = [];

  const top = () => stack[stack.length - 1];
  const isActive = v => !!top() && top().view === v;
  const railItems = () => $('#rail .rail-items');

  function activate(v) {
    v.el.classList.add('active');
    $('#pcbar').classList.toggle('no-back', stack.length <= 1);
    $('#stage').classList.toggle('with-chrome', !!v.rail);
  }

  function deactivate(entry) {
    entry.lastFocus = Nav.current();
    entry.view.el.classList.remove('active');
    if (entry.view.leave) entry.view.leave();
  }

  function go(name, params) {
    if (top()) deactivate(top());
    stack.push({ name, view: views[name], params });
    activate(views[name]);
    views[name].enter(params || {});
  }

  function reset(name, params) {
    while (stack.length) deactivate(stack.pop());
    go(name, params);
  }

  function back() {
    const cur = top();
    if (!cur) return;
    if (stack.length > 1) {
      deactivate(stack.pop());
      const prev = top();
      activate(prev.view);
      if (prev.view.resume) prev.view.resume();
      if (prev.lastFocus && document.contains(prev.lastFocus)) Nav.focus(prev.lastFocus);
      else if (prev.view.focusDefault) prev.view.focusDefault();
      return;
    }
    if (cur.view.onBack && cur.view.onBack()) return;
    const inRail = Nav.current() && Nav.current().closest('#rail');
    if (cur.view.rail && !inRail) return Nav.enter(railItems());
    if (cur.name !== 'home' && sections.length) { markRail('home'); return reset('home'); }
    if (TV) picker.open('Exit Gravitos?', [{ key: 'exit', label: 'Exit' }, { key: 'stay', label: 'Cancel' }], 'stay', o => { if (o.key === 'exit') exitApp(); });
  }

  // ---------------------------------------------------------------- rail & account

  function buildRail() {
    const box = railItems();
    box.innerHTML = '';
    const items = [
      { id: 'search', label: 'Search', icon: 'search', view: 'search' },
      { id: 'home', label: 'Home', icon: 'home', view: 'home' },
    ].concat(sections.map(s => ({
      id: 'sec' + s.key, label: s.title, icon: s.type === 'show' ? 'show' : 'movie', view: 'library', params: { section: s },
    })), [{ id: 'collections', label: 'Collections', icon: 'stack', view: 'collections' }], services.map(sv => ({
      id: 'svc-' + sv.id, label: sv.name, badge: sv, view: 'service', params: { service: sv },
    })), [{ id: 'settings', label: 'Settings', icon: 'settings', view: 'settings' }]);
    for (const it of items) {
      const icon = it.badge ? `<i class="svc-badge" style="background:${it.badge.colour}">${esc(it.badge.name[0])}</i>` : ICONS[it.icon];
      const el = h('div', 'rail-item focusable', icon + `<span class="label">${esc(it.label)}</span>`);
      el.dataset.id = it.id;
      el._select = () => { markRail(it.id); reset(it.view, it.params); };
      box.appendChild(el);
    }
  }

  function markRail(id) {
    const box = railItems();
    for (const el of box.children) el.classList.toggle('current', el.dataset.id === id);
    const cur = box.querySelector(`[data-id="${id}"]`);
    if (cur) Nav.remember(box, cur);
  }

  let account = null;
  async function loadAccount() {
    try { account = await Plex.user(); } catch (e) { return; }
    for (const a of document.querySelectorAll('.avatar')) if (account.thumb) a.style.backgroundImage = `url("${account.thumb}")`;
    $('#rail .rail-user span').textContent = account.title || account.username || '';
  }

  document.addEventListener('nav:focus', e => {
    $('#stage').classList.toggle('rail-open', !!e.target.closest('#rail'));
  });

  // ---------------------------------------------------------------- tiles

  function underText(m) {
    const left = m.viewOffset && m.duration ? fmtDur(m.duration - m.viewOffset) + ' left' : '';
    const label = m.type === 'episode' ? `${epCode(m)} · ${m.title}` : m.title;
    return left ? `${label} · ${left}` : label;
  }

  // A 16:9 card with the title's backdrop and logo. `under` adds a caption line below it.
  function tile(m, opts) {
    opts = opts || {};
    const ep = m.type === 'episode' || m.type === 'season';
    const art = ep ? (m.grandparentArt || m.art || m.thumb) : (m.art || m.thumb);
    const logo = Plex.logo(m, 440, 170);
    const el = h('div', 'tile focusable',
      `<div class="card${m.viewOffset && m.duration ? ' has-progress' : ''}">` +
      (art ? `<img class="art" decoding="async" data-src="${esc(Plex.img(art, 480, 270))}" alt="">` : '') +
      '<div class="scrim"></div>' +
      (logo ? `<img class="logo" decoding="async" data-src="${esc(logo)}" alt="">` : `<div class="t">${esc(titleOf(m))}</div>`) +
      progressHtml(m) + newBadge(m) + '</div>' +
      (opts.under ? `<div class="under">${esc(typeof opts.under === 'function' ? opts.under(m) : underText(m))}</div>` : ''));
    const logoImg = $('.logo', el);
    if (logoImg) logoImg.onerror = () => { logoImg.outerHTML = `<div class="t">${esc(titleOf(m))}</div>`; };
    el._item = m;
    // The hero reuses these exact URLs, so it can show the tile's already-loaded images at once.
    el._art = art ? Plex.img(art, 480, 270) : '';
    el._artPath = art || '';
    // toShow: an episode standing in for its show (new-episode rows) opens the show's page.
    el._select = opts.toShow && m.grandparentRatingKey
      ? () => go('details', { ratingKey: m.grandparentRatingKey })
      : () => openItem(m, opts.play);
    // Holding OK (or right-clicking) opens options instead; see the key handling at the end.
    el._hold = opts.hold ? () => opts.hold(m) : () => itemOptions(m, el, () => tile(m, opts));
    return el;
  }

  // `kind`: say what it is (search mixes films and shows).
  function posterCard(m, kind) {
    const el = h('div', 'poster focusable' + (m.thumb ? '' : ' noimg'),
      (m.thumb ? `<img loading="lazy" src="${esc(Plex.img(m.thumb, 240, 360))}" alt="">` : `<div class="t">${esc(m.title)}</div>`) +
      progressHtml(m) + newBadge(m) +
      (m.type === 'movie' && m.viewCount && !m.viewOffset ? '<span class="seen"></span>' : '') +
      `<div class="label">${esc(m.title)}${m.year ? ` <small>${m.year}${kind && m.type === 'show' ? ' · Series' : ''}</small>` : ''}</div>`);
    el._item = m;
    el._select = () => openItem(m);
    el._hold = () => itemOptions(m, el, () => posterCard(m, kind));
    return el;
  }

  function episodeCard(e) {
    const el = h('div', 'ep focusable',
      `<div class="card${e.viewOffset && e.duration ? ' has-progress' : ''}">` +
      (e.thumb ? `<img class="art" loading="lazy" src="${esc(Plex.img(e.thumb, 480, 270))}" alt="">` : '') +
      progressHtml(e) + (e.viewCount && !e.viewOffset ? '<span class="seen"></span>' : '') + '</div>' +
      `<div class="ep-title">${e.index}. ${esc(e.title)}</div>` +
      `<div class="ep-meta">${e.duration ? fmtDur(e.duration) : ''}${e.viewOffset && e.duration ? ' · ' + fmtDur(e.duration - e.viewOffset) + ' left' : ''}</div>`);
    el._item = e;
    el._select = () => startPlayback(e, e.viewOffset || 0);
    el._hold = () => itemOptions(e, el, () => episodeCard(e));
    return el;
  }

  // Options for any title (hold OK on the TV, right-click on a PC): play from the beginning,
  // mark watched / unwatched, go to its page. The card is rebuilt in place to show the change.
  function itemOptions(m, el, rebuild) {
    const show = m.type === 'show';
    const watched = show ? m.viewedLeafCount >= m.leafCount : !!m.viewCount && !m.viewOffset;
    const list = [];
    if (!show && m.viewOffset) list.push({ key: 'restart', label: 'Play from the beginning' });
    list.push({ key: 'watched', label: (watched ? 'Mark as unwatched' : 'Mark as watched') + (show ? ' (whole show)' : '') });
    const toShow = m.type === 'episode' && m.grandparentRatingKey;
    if (!(isActive(details) && details.rk === (toShow ? m.grandparentRatingKey : m.ratingKey))) {
      list.push({ key: 'details', label: toShow ? 'Go to show' : 'Go to details' });
    }
    picker.open(m.type === 'episode' ? `${titleOf(m)} · ${epCode(m)}` : titleOf(m), list, null, async o => {
      if (o.key === 'restart') return startPlayback(m, 0);
      if (o.key === 'details') return openItem(toShow ? { type: 'show', ratingKey: m.grandparentRatingKey } : Object.assign({}, m, { type: m.type === 'episode' ? 'show' : m.type }));
      try { await (watched ? Plex.lib.unscrobble : Plex.lib.scrobble)(m.ratingKey); } catch (e) { return toast("Couldn't update Plex. Try again."); }
      m.viewOffset = 0;
      m.viewCount = watched ? 0 : 1;
      if (show) m.viewedLeafCount = watched ? 0 : m.leafCount;
      toast(watched ? 'Marked as unwatched' : 'Marked as watched');
      if (el && document.contains(el)) { const nu = rebuild(); el.replaceWith(nu); Nav.focus(nu); }
      if (isActive(home)) home.refresh();
    });
  }

  function button(label, icon, fn, cls) {
    const b = h('div', 'btn focusable' + (cls ? ' ' + cls : ''), (icon ? ICONS[icon] : '') + `<span>${esc(label)}</span>`);
    b._select = fn;
    return b;
  }

  function buildRow(title, items, opts) {
    opts = opts || {};
    const row = h('section', 'row', `<h2 class="row-title">${opts.icon || ''}${esc(title)}${opts.hint ? `<small class="row-hint">${esc(opts.hint)}</small>` : ''}</h2>`);
    row.setAttribute('data-group', '');
    if (opts.id) row.dataset.id = opts.id;
    const box = h('div', 'row-clip');
    const track = h('div', 'row-track');
    track.setAttribute('data-axis', 'x');
    for (const m of items) track.appendChild(tile(m, opts));
    box.appendChild(track);
    if (!TV) addArrows(box, track);
    row.appendChild(box);
    return row;
  }

  // Episode tiles standing for their show: look the shows up (one request) to badge them.
  function badgeShows(row) {
    const tiles = Array.prototype.slice.call(row.querySelectorAll('.tile'));
    const keys = [...new Set(tiles.map(t => t._item.grandparentRatingKey).filter(Boolean))];
    return Plex.lib.metaMany(keys).then(shows => {
      const by = new Map(shows.map(s => [String(s.ratingKey), s]));
      for (const t of tiles) {
        const s = by.get(String(t._item.grandparentRatingKey)), b = s ? newBadge(s) : '';
        if (b) $('.card', t).insertAdjacentHTML('beforeend', b);
      }
    }).catch(() => {});
  }

  // PC: ‹ › at a row's ends page through it with the mouse (they show while pointing at the row).
  function addArrows(box, track) {
    for (const dir of [-1, 1]) {
      const b = h('button', 'row-arrow ' + (dir < 0 ? 'prev' : 'next'), dir < 0 ? ICONS.chevL : ICONS.chevR);
      b.type = 'button';
      b.onclick = e => {
        e.stopPropagation();
        const tiles = Array.prototype.filter.call(track.children, c => c.classList.contains('focusable'));
        if (!tiles.length) return;
        const page = Math.max(1, Math.floor(box.clientWidth / (tiles[0].offsetWidth + 26)) - 1);
        let i = tiles.indexOf(Nav.current());
        if (i < 0) i = track._at || 0;
        track._at = Math.max(0, Math.min(tiles.length - 1, i + dir * page));
        Nav.focus(tiles[track._at]);
      };
      box.appendChild(b);
    }
    // › hides when the row is already at its end (or never scrolls at all), checked on pointing.
    const atEnd = () => box.classList.toggle('at-end', (track._x || 0) >= track.scrollWidth - box.clientWidth - 1);
    box.addEventListener('mouseenter', atEnd);
    box.addEventListener('click', () => setTimeout(atEnd));
  }

  const skeleton = n => Array.from({ length: n }, () =>
    '<div class="sk-row"><div class="sk sk-title"></div><div class="sk-cards">' + '<div class="sk"></div>'.repeat(5) + '</div></div>').join('');

  function openItem(m, play) {
    if (play || m.type === 'episode') return startPlayback(m, m.viewOffset || 0);
    if (isActive(details)) return details.enter({ ratingKey: m.type === 'season' ? m.parentRatingKey : m.ratingKey });
    go('details', { ratingKey: m.type === 'season' ? m.parentRatingKey : m.ratingKey });
  }

  function startPlayback(m, offset) {
    const returnTo = Nav.current();
    Player.play(m, offset, () => {
      if (returnTo && document.contains(returnTo)) Nav.focus(returnTo);
      const t = top();
      if (t && t.view.refresh) t.view.refresh();
    }).catch(err => toast(err.message));
  }

  // ---------------------------------------------------------------- sign in

  // A QR code as an SVG (qrcode-generator, js/vendor/qrcode.js), with a quiet zone.
  function qrSvg(text) {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}" fill="#0a0a0c"/></svg>`;
  }

  views.login = {
    el: $('#view-login'),
    enter() {
      setAmbient(null);
      const btn = $('#btn-newcode');
      btn._select = () => this.start();
      Nav.focus(btn);
      this.start();
    },
    leave() { clearInterval(this.poll); clearTimeout(this.expiry); },
    async start() {
      this.leave();
      const pin = $('.pin', this.el), qr = $('.qr', this.el), status = $('.login-status', this.el);
      pin.textContent = '····';
      qr.innerHTML = '';
      status.textContent = 'Getting a code…';
      try {
        // Two PINs: a short one to type at plex.tv/link, a long one carried by the QR code.
        const [short, long] = await Promise.all([Plex.createPin(false), Plex.createPin(true)]);
        pin.textContent = short.code;
        qr.innerHTML = qrSvg(Plex.authUrl(long.code));
        status.textContent = 'Waiting for you to sign in…';
        this.poll = setInterval(async () => {
          const toks = await Promise.all([short, long].map(p => Plex.checkPin(p.id).catch(() => null)));
          const tok = toks[0] || toks[1];
          if (!tok) return;
          this.leave();
          Plex.setToken(tok, true);
          Promise.all([loadAccount(), loadProfiles()]).then(([, many]) => reset(many ? 'profiles' : 'servers'));
        }, 2000);
        this.expiry = setTimeout(() => this.start(), Math.min(short.expiresIn || 900, long.expiresIn || 900) * 1000);
      } catch (e) {
        status.textContent = "Couldn't reach plex.tv. Check the internet connection, then get a new code.";
      }
    },
  };

  // ---------------------------------------------------------------- servers

  views.servers = {
    el: $('#view-servers'),
    async enter(params) {
      setAmbient(null);
      const list = $('.server-list', this.el), status = $('.servers-status', this.el);
      list.innerHTML = '';
      status.textContent = 'Looking for your servers…';
      let found;
      try {
        found = await Plex.servers();
      } catch (e) {
        if (e.status === 401) { Plex.signOut(); return reset('login'); }
        status.textContent = "Couldn't reach plex.tv: " + e.message;
        list.appendChild(button('Try again', null, () => this.enter(params), 'wide'));
        return Nav.focus(list.firstChild);
      }
      if (!found.length) {
        // A managed profile sees only servers shared with it.
        if (homeUsers.length > 1) {
          status.textContent = `${account ? account.title : 'This profile'} hasn't been given access to a server yet. In Plex, open Settings, then Manage Library Access, and share your libraries with this profile.`;
          list.appendChild(button('Switch profile', null, () => reset('profiles'), 'wide'));
          return Nav.focus(list.firstChild);
        }
        status.textContent = 'No Plex Media Servers on this account.';
        return;
      }
      const saved = Plex.server();
      const remembered = saved && found.find(r => r.clientIdentifier === saved.id);
      if (!params.choose && (found.length === 1 || remembered)) return pick(remembered || found[0]);
      status.textContent = '';
      for (const r of found) list.appendChild(button(r.name + (r.owned ? '' : ' (shared)'), null, () => pick(r), 'wide'));
      Nav.focus(list.firstChild);
    },
  };

  async function pick(resource) {
    const status = $('.servers-status', views.servers.el);
    status.textContent = `Connecting to ${resource.name}…`;
    try {
      await Plex.connect(resource);
      await loadSections();
      home.loaded = false;
      library.section = null;
      markRail('home');
      reset('home');
    } catch (e) {
      status.textContent = e.message;
      const list = $('.server-list', views.servers.el);
      if (!list.firstChild) list.appendChild(button('Try again', null, () => views.servers.enter({}), 'wide'));
      Nav.focus(list.firstChild);
    }
  }

  async function loadSections() {
    sections = await Plex.lib.sections();
    allTitles = null;
    services = await loadServices().catch(() => []);
    buildRail();
  }

  // ---------------------------------------------------------------- profiles (Plex Home)

  // Shown at start-up when the account has more than one Plex Home profile. No PIN is asked
  // for the profile already in use or for the account the TV signed in with (its saved
  // sign-in is reused); Plex only insists on one to switch to another protected profile.
  let homeUsers = [], homeUuid = null;
  async function loadProfiles() {
    const [users, me] = await Promise.all([Plex.homeUsers().catch(() => []), Plex.homeUser().catch(() => null)]);
    homeUsers = users;
    homeUuid = me && me.uuid;
    return homeUsers.length > 1;
  }

  views.profiles = {
    el: $('#view-profiles'),
    get list() { return $('.profile-list', this.el); },
    get pad() { return $('.pin-pad', this.el); },
    enter() {
      setAmbient(null);
      this.closePin();
      const list = this.list;
      list.innerHTML = '';
      let mine = null;
      for (const u of homeUsers) {
        const el = h('div', 'profile focusable',
          `<div class="avatar"></div><span>${esc(u.title)}${u.protected ? ICONS.lock : ''}</span>`);
        if (u.thumb) $('.avatar', el).style.backgroundImage = `url("${u.thumb}")`;
        el._select = () => this.choose(u);
        list.appendChild(el);
        if (account && u.uuid === account.uuid) mine = el;
      }
      Nav.focus(mine || list.firstChild);
    },
    choose(u) {
      if (this.busy) return;
      if (account && u.uuid === account.uuid) return this.done(false);
      if (u.uuid === homeUuid) return this.switchTo(u, null, Plex.homeToken());
      if (u.protected) return this.openPin(u);
      this.switchTo(u);
    },
    async switchTo(u, pin, saved) {
      this.busy = true;
      let tok = saved || null, err = null;
      if (!tok) try { tok = await Plex.switchUser(u.uuid, pin); } catch (e) { err = e; }
      this.busy = false;
      if (!tok) {
        if (pin && err && err.status >= 400 && err.status < 500) { toast('Wrong PIN. Try again.'); return this.paintPin(this.pin = ''); }
        return toast("Couldn't switch profile. Check the internet connection.");
      }
      Plex.setToken(tok);
      account = null;
      await loadAccount();
      home.loaded = false;
      library.section = null;
      this.done(true);
    },
    done(switched) {
      this.closePin();
      startServer(switched);
    },
    openPin(u) {
      this.pinUser = u;
      this.pin = '';
      const pad = this.pad, keys = $('.pin-keys', pad);
      $('.pin-for', pad).textContent = `Enter the PIN for ${u.title}`;
      if (!keys.children.length) {
        for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Cancel', '0', '⌫']) {
          const el = h('div', 'key focusable', esc(k));
          el._select = () => this.pinKey(k);
          keys.appendChild(el);
        }
      }
      this.list.hidden = true;
      pad.hidden = false;
      this.paintPin();
      Nav.focus(keys.firstChild);
    },
    pinKey(k) {
      if (this.busy) return;
      if (k === 'Cancel') return this.closePin(true);
      if (k === '⌫') this.pin = this.pin.slice(0, -1);
      else if (this.pin.length < 4) this.pin += k;
      this.paintPin();
      if (this.pin.length === 4) this.switchTo(this.pinUser, this.pin);
    },
    paintPin() {
      const dots = $('.pin-dots', this.el).children;
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < (this.pin || '').length);
    },
    closePin(refocus) {
      if (this.pad.hidden) return;
      this.pad.hidden = true;
      this.list.hidden = false;
      if (refocus) Nav.enter(this.list);
    },
    onBack() {
      if (this.pad.hidden) return false;
      this.closePin(true);
      return true;
    },
    // The remote's number keys type the PIN directly.
    onKey(key, e) {
      if (this.pad.hidden) return false;
      const c = e.keyCode, d = c >= 48 && c <= 57 ? c - 48 : c >= 96 && c <= 105 ? c - 96 : -1;
      if (d < 0) return false;
      this.pinKey(String(d));
      return true;
    },
  };

  // ---------------------------------------------------------------- streaming services

  // Filters, not apps: each service shows the titles in your Plex library that came from it.
  // Shows carry their original network; movies only a studio, so those match by studio name.
  const SERVICES = [
    { id: 'netflix', name: 'Netflix', network: /^netflix$/i, studio: /netflix/i, colour: '#e50914' },
    { id: 'prime', name: 'Prime Video', network: /^(prime video|amazon)/i, studio: /^amazon/i, colour: '#00a8e1' },
    { id: 'disney', name: 'Disney+', network: /^disney\+$/i, studio: /disney|pixar|lucasfilm|marvel studios/i, colour: '#1f4fd6' },
    { id: 'apple', name: 'Apple TV+', network: /^apple tv/i, studio: /^apple/i, colour: '#8e8e93' },
    { id: 'hbo', name: 'HBO Max', network: /^(hbo|hbo max|max)$/i, studio: /^hbo/i, colour: '#7b3fe4' },
    { id: 'hulu', name: 'Hulu', network: /^hulu$/i, studio: /^hulu/i, colour: '#1db954' },
    { id: 'paramount', name: 'Paramount+', network: /^paramount\+$/i, studio: /^paramount/i, colour: '#0064ff' },
    { id: 'peacock', name: 'Peacock', network: /^peacock$/i, studio: /^peacock/i, colour: '#c99a1b' },
  ];
  let services = [];

  // Which services have titles here, with the library filter paths that list them.
  async function loadServices() {
    const found = SERVICES.map(sv => Object.assign({ paths: [] }, sv));
    await Promise.all(sections.map(async s => {
      const field = s.type === 'show' ? 'network' : 'studio';
      const dirs = await Plex.api(`/library/sections/${s.key}/${field}`).then(m => m.Directory || []).catch(() => []);
      for (const d of dirs) for (const sv of found) {
        if (sv[field].test(d.title)) sv.paths.push(d.fastKey || `/library/sections/${s.key}/all?${field}=${d.key}`);
      }
    }));
    return found.filter(sv => sv.paths.length);
  }

  views.service = {
    el: $('#view-service'), rail: true,
    get grid() { return $('.grid', this.el); },
    focusDefault() { if (this.grid.firstChild) Nav.enter(this.grid); },
    async enter(params) {
      const sv = this.sv = params.service;
      $('.lib-title', this.el).textContent = sv.name;
      $('.lib-count', this.el).textContent = '';
      this.grid.innerHTML = '';
      this.grid.style.transform = '';
      // A collection arrives with its titles, already in release order; a service lists them A–Z.
      const lists = sv.items ? [sv.items] : await Promise.all(sv.paths.map(p => Plex.api(p).then(m => m.Metadata || []).catch(() => [])));
      if (this.sv !== sv) return;
      const seen = new Set(), items = [];
      for (const m of [].concat(...lists)) if (!seen.has(m.ratingKey)) { seen.add(m.ratingKey); items.push(m); }
      if (!sv.items) items.sort((a, b) => (a.titleSort || a.title).localeCompare(b.titleSort || b.title));
      this.items = items;
      this.kind = 'all';
      this.show(true);
    },
    // All / Movies / TV Shows, shown only when the service has both.
    show(focusGrid) {
      const box = $('.lib-buttons', this.el);
      box.innerHTML = '';
      const has = t => this.items.some(m => m.type === t);
      if (has('movie') && has('show')) {
        for (const [kind, label] of [['all', 'All'], ['movie', 'Movies'], ['show', 'TV Shows']]) {
          const b = button(label, null, () => { this.kind = kind; this.show(false); }, 'small' + (this.kind === kind ? ' primary' : ''));
          box.appendChild(b);
          if (!focusGrid && this.kind === kind && isActive(this)) Nav.focus(b);
        }
      }
      const list = this.kind === 'all' ? this.items : this.items.filter(m => m.type === this.kind);
      this.grid.innerHTML = '';
      this.grid.style.transform = '';
      for (const m of list) this.grid.appendChild(posterCard(m));
      $('.lib-count', this.el).textContent = `${list.length} titles`;
      if (focusGrid && isActive(this) && this.grid.firstChild) Nav.focus(this.grid.firstChild);
    },
    // Back from the posters goes up to the filter buttons first, as in the libraries.
    onBack() {
      const c = Nav.current(), box = $('.lib-buttons', this.el);
      if (!c || !this.grid.contains(c) || !box.firstChild) return false;
      Nav.enter(box);
      return true;
    },
  };

  views.service.el.addEventListener('nav:focus', e => {
    if (e.target.classList.contains('poster')) scrollGrid(views.service.grid, e.target, 402);
  });

  // ---------------------------------------------------------------- collections tab

  // Every film and show, loaded once when Collections is first opened.
  let allTitles = null;
  const loadAllTitles = () => allTitles || (allTitles = Promise.all(sections.map(s => Plex.lib.all(s.key, 0, PAGE, 'titleSort').then(r => r.items)))
    .then(lists => [].concat(...lists))
    .catch(e => { allTitles = null; throw e; }));

  // The series part of a title, for grouping sequels: "John Wick: Chapter 4" → "john wick".
  function seriesKey(title) {
    return title.replace(/\s*\(\d{4}\)$/, '').split(/: | - /)[0]
      .replace(/\s+(part|chapter|vol\.?|volume)\s+\S+$/i, '')
      .replace(/\s+(\d+(\.\d+)?|[ivx]+)$/i, '').replace(/[²³]$/, '')
      .trim().toLowerCase().replace(/^(the|a)\s+/, '');
  }

  // Franchises from js/franchises.js first, then any other titles sharing a series name, then
  // Plex's own collections (made in Plex, or by Plex for film series), merged by name.
  function buildCollections(items, plexCols) {
    const out = [], taken = new Set();
    for (const f of FRANCHISES) {
      const list = items.filter(m => (f.match ? f.match.test(m.title.replace(/\s*\(\d{4}\)$/, '')) : f.studio.test(m.studio || '')));
      if (list.length < 2) continue;
      out.push({ name: f.name, items: list });
      list.forEach(m => taken.add(m));
    }
    const groups = new Map();
    for (const m of items) {
      const k = taken.has(m) ? '' : seriesKey(m.title);
      if (k.length < 2 || NOT_SERIES.test(k)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Named after the shortest title's series part: "The Hangover", "Pirates of the Caribbean".
      const shortest = list.map(m => m.title.replace(/\s*\(\d{4}\)$/, '')).sort((x, y) => x.length - y.length)[0];
      out.push({ name: shortest.split(/: | - /)[0], items: list });
    }
    const norm = n => n.toLowerCase().replace(/\s+collection$/, '').replace(/^the\s+/, '');
    for (const pc of plexCols) {
      if (!pc.items.length) continue;
      const same = out.find(c => norm(c.name) === norm(pc.name));
      if (!same) { out.push({ name: pc.name.replace(/\s+collection$/i, ''), items: pc.items.slice() }); continue; }
      for (const m of pc.items) if (!same.items.some(x => x.ratingKey === m.ratingKey)) same.items.push(m);
    }
    const date = m => m.originallyAvailableAt || String(m.year || 9999);
    for (const c of out) c.items.sort((x, y) => date(x).localeCompare(date(y)));
    return out.sort((x, y) => x.name.replace(/^the /i, '').localeCompare(y.name.replace(/^the /i, '')));
  }

  function collectionCard(c) {
    const first = c.items.find(m => m.art) || c.items[0], art = first.art || first.thumb;
    const films = c.items.filter(m => m.type === 'movie').length, shows = c.items.length - films;
    const count = [films ? `${films} ${films === 1 ? 'film' : 'films'}` : '', shows ? `${shows} ${shows === 1 ? 'show' : 'shows'}` : ''].filter(Boolean).join(' · ');
    const el = h('div', 'tile focusable',
      '<div class="card">' + (art ? `<img class="art" decoding="async" src="${esc(Plex.img(art, 480, 270))}" alt="">` : '') +
      `<div class="scrim"></div><div class="t">${esc(c.name)}</div></div><div class="under">${count}</div>`);
    el._select = () => go('service', { service: { name: c.name, items: c.items } });
    return el;
  }

  views.collections = {
    el: $('#view-collections'), rail: true,
    get grid() { return $('.coll-grid', this.el); },
    focusDefault() { if (this.grid.querySelector('.focusable')) Nav.enter(this.grid); },
    // Rebuilt whenever the libraries or Plex's collections have changed since the last visit
    // (two small requests to find out), so new titles and collections show up by themselves.
    async enter() {
      const grid = this.grid;
      let secs, plexLists;
      try {
        [secs, plexLists] = await Promise.all([Plex.lib.sections(), Promise.all(sections.map(s => Plex.lib.collections(s.key).catch(() => [])))]);
      } catch (e) { secs = null; }
      const plexCols = secs ? [].concat(...plexLists) : [];
      const sig = secs ? secs.map(s => `${s.key}:${s.contentChangedAt || s.updatedAt}`).join() + '|' + plexCols.map(c => `${c.ratingKey}:${c.updatedAt}:${c.childCount}`).join() : this.sig;
      if (sig === this.sig && this.from === allTitles && grid.querySelector('.focusable')) return this.focusDefault();
      if (sig !== this.sig) allTitles = null;
      grid.style.transform = '';
      grid.innerHTML = '<p class="empty">Gathering your collections…</p>';
      $('.lib-count', this.el).textContent = '';
      let items;
      try { items = await loadAllTitles(); } catch (e) { grid.innerHTML = '<p class="empty">Couldn\'t load your library. Is the server online?</p>'; return; }
      this.from = allTitles;
      this.sig = sig;
      // A Plex collection's titles come from the Collection tags in the listing; fetched only if missing.
      const byTag = new Map();
      for (const m of items) for (const t of m.Collection || []) { if (!byTag.has(t.tag)) byTag.set(t.tag, []); byTag.get(t.tag).push(m); }
      const plex = await Promise.all(plexCols.map(async c => ({ name: c.title, items: byTag.get(c.title) || await Plex.lib.collectionItems(c).catch(() => []) })));
      const cols = buildCollections(items, plex);
      grid.innerHTML = cols.length ? '' : '<p class="empty">No series or spin-offs here yet.</p>';
      for (const c of cols) grid.appendChild(collectionCard(c));
      $('.lib-count', this.el).textContent = `${cols.length} collections`;
      if (isActive(this)) this.focusDefault();
    },
  };

  views.collections.el.addEventListener('nav:focus', e => {
    // One whole row stays visible above (the cards resize with the window, so measure one).
    if (e.target.classList.contains('tile')) scrollGrid(views.collections.grid, e.target, e.target.offsetHeight + 56 + 26);
  });

  // ---------------------------------------------------------------- home

  // One show per tile: the newest episode of each, in order.
  function latestPerShow(episodes, n) {
    const seen = new Set(), out = [];
    for (const e of episodes) {
      if (seen.has(e.grandparentRatingKey)) continue;
      seen.add(e.grandparentRatingKey);
      out.push(e);
      if (out.length >= n) break;
    }
    return out;
  }

  const fmtAired = d => {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? '' : dt.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // The rows each library contributes to Home, grouped by kind so Home can interleave libraries:
  // { added, released, rated: [...], genres: [...] }.
  async function sectionRows(s) {
    const show = s.type === 'show';
    const noun = show ? 'Shows' : 'Movies';
    const out = { rated: [], genres: [], collections: [] };
    const minYear = (new Date().getFullYear() - 3) + '-01-01';
    const today = new Date().toISOString().slice(0, 10);
    const released = d => !!d && d >= minYear && d <= today;
    const tasks = [];

    if (show) {
      // Episode listings (type 4) give "new episode" ordering instead of when the show was first added.
      tasks.push(Plex.lib.all(s.key, 0, 150, 'addedAt:desc', { type: 4 }).then(r => {
        const eps = latestPerShow(r.items, 25);
        if (eps.length) out.added = buildRow('Recently Added Shows', eps, { toShow: true, under: e => `${epCode(e)} · ${e.title}` });
        if (out.added) return badgeShows(out.added);
      }));
      tasks.push(Plex.lib.all(s.key, 0, 200, 'originallyAvailableAt:desc', { type: 4 }).then(r => {
        const eps = latestPerShow(r.items.filter(e => released(e.originallyAvailableAt)), 25);
        if (eps.length >= 4) out.released = buildRow('Recently Released Shows', eps, { toShow: true, under: e => `${epCode(e)} · aired ${fmtAired(e.originallyAvailableAt)}` });
        if (out.released) return badgeShows(out.released);
      }));
    } else {
      tasks.push(Plex.lib.all(s.key, 0, 30, 'addedAt:desc').then(r => {
        if (r.items.length) out.added = buildRow('Recently Added Movies', r.items);
      }));
      tasks.push(Plex.lib.all(s.key, 0, 60, 'originallyAvailableAt:desc').then(r => {
        const items = r.items.filter(m => released(m.originallyAvailableAt)).slice(0, 25);
        if (items.length >= 4) out.released = buildRow('Recently Released Movies', items, { under: m => 'Released ' + fmtAired(m.originallyAvailableAt) });
      }));
      // Rotten Tomatoes scores come with the listing (critics = rating, audience = audienceRating).
      tasks.push(Plex.lib.all(s.key, 0, 60, 'rating:desc').then(r => {
        const items = r.items.filter(m => /^rottentomatoes/.test(m.ratingImage || '') && m.rating >= 8.5);
        if (items.length >= 5) out.rated[1] = buildRow("Critics' Favourites", shuffle(items).slice(0, 25), { icon: RT_ICONS.fresh });
      }));
      tasks.push(Plex.lib.all(s.key, 0, 60, 'audienceRating:desc').then(r => {
        const items = r.items.filter(m => /^rottentomatoes/.test(m.audienceRatingImage || '') && m.audienceRating >= 8.5);
        if (items.length >= 5) out.rated[2] = buildRow('Audience Favourites', shuffle(items).slice(0, 25), { icon: RT_ICONS.upright });
      }));
      tasks.push(Plex.lib.all(s.key, 0, 40, 'rating:desc', { unwatched: 1 }).then(r => {
        const items = r.items.filter(m => m.rating >= 8);
        if (items.length >= 5) out.rated[3] = buildRow("Highly Rated, Not Yet Seen", shuffle(items).slice(0, 25));
      }));
    }

    // IMDb scores only come with full metadata: take the best-rated candidates, fetch their
    // details in one request, and rank by IMDb.
    tasks.push(Plex.lib.all(s.key, 0, 60, 'audienceRating:desc').then(r => Plex.lib.metaMany(r.items.map(m => m.ratingKey))).then(full => {
      const ranked = full.map(m => [m, ratingsOf(m).imdb]).filter(x => x[1] >= 7.5).sort((a, b) => b[1] - a[1]).map(x => x[0]);
      if (ranked.length >= 5) out.rated[0] = buildRow(`Top Rated ${noun}`, ranked.slice(0, 25), { icon: '<b class="imdb-chip">IMDb</b>' });
    }));

    // Six random genres per library, each needing enough titles to fill a row.
    tasks.push(Plex.lib.genres(s.key).then(async list => {
      const picks = shuffle(list).slice(0, 9);
      const lists = await Promise.all(picks.map(g => Plex.lib.byGenre(s.key, g).catch(() => [])));
      lists.forEach((items, i) => {
        // "TV Movie" and the like already say what they are.
        const label = /movie|show|series|film/i.test(picks[i].title) ? picks[i].title : `${picks[i].title} ${noun}`;
        if (items.length >= 8 && out.genres.length < 6) out.genres.push(buildRow(label, shuffle(items).slice(0, 25)));
      });
    }));

    // Up to three of the library's collections, each as its own row.
    tasks.push(Plex.lib.collections(s.key).then(async list => {
      const picks = shuffle(list.filter(c => !c.childCount || c.childCount >= 4)).slice(0, 3);
      const lists = await Promise.all(picks.map(c => Plex.lib.collectionItems(c).catch(() => [])));
      lists.forEach((items, i) => { if (items.length >= 4) out.collections.push(buildRow(picks[i].title, items.slice(0, 25))); });
    }));

    await Promise.all(tasks.map(t => t.catch(() => {})));
    out.rated = out.rated.filter(Boolean);
    return out;
  }

  const heroState = { flip: 0 };
  let heroKey = null;

  const deckRow = deck => buildRow('Continue Watching', deck, { play: true, under: true, id: 'deck', hint: TV ? 'Hold OK for options' : 'Right-click for options', hold: deckOptions });

  function deckOptions(m) {
    const show = m.type === 'episode' && m.grandparentRatingKey;
    picker.open(titleOf(m), [
      { key: 'restart', label: 'Play from the beginning' },
      { key: 'remove', label: 'Remove from Continue Watching' },
      { key: 'watched', label: 'Mark as watched' },
      { key: 'details', label: show ? 'Go to show' : 'Go to details' },
    ], null, async o => {
      if (o.key === 'details') return go('details', { ratingKey: show ? m.grandparentRatingKey : m.ratingKey });
      if (o.key === 'restart') return startPlayback(m, 0);
      try { await (o.key === 'remove' ? Plex.lib.removeFromDeck : Plex.lib.scrobble)(m.ratingKey); } catch (e) { return toast("Couldn't update Plex. Try again."); }
      toast(o.key === 'remove' ? 'Removed from Continue Watching' : 'Marked as watched');
      home.refresh();
    });
  }

  // "Because you watched …": titles like the last film and the last show this profile watched,
  // leaving out ones it has already seen.
  async function becauseRows() {
    const recent = await Promise.all(sections.map(s => Plex.lib.all(s.key, 0, 1, 'lastViewedAt:desc').then(r => r.items[0], () => null)));
    const picks = recent.filter(m => m && m.lastViewedAt).sort((a, b) => b.lastViewedAt - a.lastViewedAt);
    const rows = await Promise.all(picks.map(async m => {
      const sim = await Plex.lib.similar(m.ratingKey).catch(() => []);
      const unseen = sim.filter(x => (x.type === 'show' ? (x.viewedLeafCount || 0) < (x.leafCount || 1) : !x.viewCount));
      return unseen.length >= 4 ? buildRow(`Because you watched ${titleOf(m)}`, unseen.slice(0, 20)) : null;
    }));
    return rows.filter(Boolean);
  }

  // Watchlisted titles that are in this library (the rest can't be played here).
  async function watchlistItems() {
    const list = await Plex.lib.watchlist();
    const found = await Promise.all(list.slice(0, 40).map(w => (w.guid ? Plex.lib.byGuid(w.guid).catch(() => null) : null)));
    return found.filter(Boolean);
  }

  const home = views.home = {
    el: $('#view-home'), rail: true, loaded: false,
    get track() { return $('.rows-track', this.el); },
    enter() { if (!this.loaded) this.load(); else this.focusDefault(); },
    resume() { const c = Nav.current(); if (c && c._item) setAmbient(c._item.UltraBlurColors); this.syncWatchlist(); },
    focusDefault() {
      if (this.track.querySelector('.focusable')) Nav.enter(this.track);
      this.resume();
    },
    // After a title's watchlist button was used, rebuild My Watchlist.
    async syncWatchlist() {
      if (!this.watchlistDirty || !this.loaded) return;
      this.watchlistDirty = false;
      const items = await watchlistItems().catch(() => null);
      if (!items) return;
      const track = this.track, old = $('[data-id="wl"]', track);
      const hadFocus = !!old && old.contains(Nav.current());
      const row = items.length ? buildRow('My Watchlist', items, { id: 'wl' }) : null;
      if (old && row) track.replaceChild(row, old);
      else if (old) old.remove();
      else if (row) { const deck = $('[data-id="deck"]', track); track.insertBefore(row, deck ? deck.nextSibling : track.firstChild); }
      warm(row);
      for (const r of track.children) r._top = null;
      if (hadFocus && isActive(this)) Nav.enter(row || track);
    },
    async load() {
      this.loaded = true;
      const gen = this.gen = (this.gen || 0) + 1;
      const track = this.track;
      track.innerHTML = skeleton(2);
      track.style.transform = '';
      this.activeRow = null;
      this.watchlistDirty = false;
      // Continue Watching is one quick request: show it as soon as it's here, rather than after
      // the slowest of the ~20 requests behind the other rows (plex.tv, genres, ratings…).
      const rest = Promise.all([
        watchlistItems().catch(() => []),
        becauseRows().catch(() => []),
        Promise.all(sections.map(s => sectionRows(s).catch(() => ({ rated: [], genres: [], collections: [] })))),
      ]);
      const deck = await Plex.lib.onDeck().catch(() => []);
      if (gen !== this.gen) return;
      if (deck.length) {
        track.innerHTML = '';
        track.appendChild(deckRow(deck));
        track.insertAdjacentHTML('beforeend', skeleton(1));
        this.ready();
      }
      const [watch, because, perSection] = await rest;
      if (gen !== this.gen) return;
      if (deck.length) for (const sk of track.querySelectorAll('.sk-row')) sk.remove();
      else track.innerHTML = '';
      if (watch.length) track.appendChild(buildRow('My Watchlist', watch, { id: 'wl' }));
      // Recently added, then recently released, then ratings and genre rows alternating between libraries.
      const add = row => { if (row) track.appendChild(row); };
      perSection.forEach(p => add(p.added));
      perSection.forEach(p => add(p.released));
      because.forEach(add);
      const interleave = lists => { for (let i = 0; lists.some(l => l[i]); i++) lists.forEach(l => add(l[i])); };
      interleave(perSection.map(p => p.rated));
      interleave(perSection.map(p => p.collections));
      interleave(perSection.map(p => p.genres));
      if (!track.children.length) {
        track.innerHTML = '<p class="empty">Nothing here yet. Add some movies or shows to Plex.</p>';
        window.gravitosReady = true;
        return;
      }
      for (const r of track.children) r._top = null;
      if (deck.length) for (let i = 0; i < 6; i++) warm(track.children[i]);
      else this.ready();
    },
    // First rows' artwork loading, focus on the first tile, and the startup animation released.
    ready() {
      const track = this.track;
      // The startup animation plays while these load, so the first rows are ready when it ends.
      const imgs = [];
      for (let i = 0; i < 6; i++) { warm(track.children[i]); if (track.children[i]) imgs.push(...track.children[i].querySelectorAll('img')); }
      if (isActive(this)) Nav.focus(track.querySelector('.focusable'));
      Promise.all(imgs.slice(0, 30).map(img => (img.complete ? null : new Promise(r => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      }))))
        .then(() => { window.gravitosReady = true; });
    },
    // After playback, rebuild Continue Watching so progress is current.
    async refresh() {
      const deck = await Plex.lib.onDeck().catch(() => null);
      if (!deck) return;
      const track = this.track, old = $('[data-id="deck"]', track);
      const hadFocus = !!old && old.contains(Nav.current());
      const row = deck.length ? deckRow(deck) : null;
      if (old && row) track.replaceChild(row, old);
      else if (old) old.remove();
      else if (row) track.insertBefore(row, track.firstChild);
      warm(row);
      // Rows may have moved: forget their measured positions.
      for (const r of track.children) r._top = null;
      if (hadFocus && isActive(this) && !Player.active()) Nav.focus(track.querySelector('.focusable'));
    },
  };

  // The small label above a title: what it is, and whether it's new.
  function eyebrow(m) {
    const kind = m.type === 'movie' ? 'Film' : 'Series';
    const added = m.type === 'episode' ? m.addedAt : (m.addedAt || 0);
    const fresh = added && Date.now() / 1000 - added < 14 * 86400;
    return fresh ? `${kind}  ·  New` : kind;
  }

  // The hero changes the moment a tile is focused. Full-size backdrops are loaded ahead for
  // the tiles around the cursor, so it normally shows the sharp picture at once; if that one
  // isn't ready yet, the tile's 480px artwork stands in until it is, swapped in place.
  function setHero(m, tileEl) {
    if (!m || heroKey === m.ratingKey) return;
    heroKey = m.ratingKey;
    const info = $('.hero-info', home.el);
    $('.eyebrow', info).textContent = eyebrow(m);
    setBrand($('.brand', info), m, 440, 170);
    $('.kicker', info).textContent = m.type === 'episode' ? `${epCode(m)} · ${m.title}` : '';
    $('.meta', info).innerHTML = metaHtml(m);
    $('.hero-summary', info).textContent = m.summary || '';
    if (!TV) {
      info.classList.remove('swap');
      void info.offsetWidth; // restart the entrance animation
      info.classList.add('swap');
    }
    const big = sharp.get(sharpSrc(tileEl));
    crossfade(home.el.querySelectorAll('.hero-bg'), big && big._ok ? big.src : tileEl ? tileEl._art : '', heroState);
    if (!(big && big._ok)) {
      const layer = home.el.querySelectorAll('.hero-bg')[heroState.flip];
      preloadSharp(tileEl, src => { if (heroKey === m.ratingKey && layer.classList.contains('on')) layer.src = src; });
    }
    setAmbient(m.UltraBlurColors);
  }

  // Full-size backdrops by URL, kept (with their decoded pictures) for the last 40 tiles near the cursor.
  const sharp = new Map();
  function sharpSrc(tileEl) {
    if (!tileEl || !tileEl._artPath) return '';
    return TV ? Plex.img(tileEl._artPath, 1280, 720) : Plex.img(tileEl._artPath, 1920, 1080);
  }
  function preloadSharp(tileEl, then) {
    const src = sharpSrc(tileEl);
    if (!src) return;
    let img = sharp.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      // decode() readies the picture off the main thread, so showing it later costs nothing.
      img._done = img.decode().then(() => (img._ok = true), () => false);
      sharp.set(src, img);
      if (sharp.size > 40) sharp.delete(sharp.keys().next().value);
    }
    if (then) img._done.then(ok => ok && then(src));
  }

  home.el.addEventListener('nav:focus', e => {
    const el = e.target, row = el.closest('.row');
    if (!row) return;
    scrollRow(el.parentElement, el);
    const prev = home.activeRow;
    if (prev !== row) {
      if (prev) prev.classList.remove('active-row');
      row.classList.add('active-row');
      home.activeRow = row;
      if (row._top == null) row._top = row.offsetTop;
      if (!pointerFocus) home.track.style.transform = row._top ? `translateY(${-row._top}px)` : '';
      warm(row); warm(row.nextElementSibling);
      warm(row.nextElementSibling && row.nextElementSibling.nextElementSibling);
      warm(row.previousElementSibling);
    }
    setHero(el._item, el);
    // Get the neighbours' backdrops ready: next two along, one back, and the rows above and below.
    preloadSharp(el.nextElementSibling);
    preloadSharp(el.nextElementSibling && el.nextElementSibling.nextElementSibling);
    preloadSharp(el.previousElementSibling);
    const i = Array.prototype.indexOf.call(el.parentElement.children, el);
    for (const r of [row.previousElementSibling, row.nextElementSibling]) {
      const t = r && r.querySelector('.row-track');
      if (t) { preloadSharp(t.children[0]); preloadSharp(t.children[i]); }
    }
  });

  // ---------------------------------------------------------------- library

  const SORTS = [['titleSort', 'A–Z'], ['addedAt:desc', 'Recently added'], ['year:desc', 'Newest'], ['audienceRating:desc', 'Top rated']];
  // The whole library in one request, so scrolling never waits (938 movies ≈ 1.5 MB here).
  const PAGE = 5000;

  const library = views.library = {
    el: $('#view-library'), rail: true, sortIdx: 0, gen: 0,
    get grid() { return $('.grid', this.el); },
    enter(params) {
      if (this.section && this.section.key === params.section.key && this.grid.children.length) return this.focusDefault();
      this.section = params.section;
      this.sortIdx = 0;
      this.genre = null;
      this.genres = null;
      this.collection = null;
      this.collections = null;
      // The Collection button only shows once we know the library has collections.
      const s = params.section;
      Plex.lib.collectionFilters(s.key).then(list => {
        if (this.section !== s) return;
        this.collections = list;
        $('.coll-btn', this.el).hidden = !list.length;
      }).catch(() => {});
      this.render();
    },
    focusDefault() { if (this.grid.firstChild) Nav.enter(this.grid); else Nav.enter($('.lib-buttons', this.el)); },
    // Back from the posters goes up to Genre/Sort first; Back again opens the menu.
    onBack() {
      const c = Nav.current();
      if (!c || !(this.grid.contains(c) || $('.az', this.el).contains(c))) return false;
      Nav.enter($('.lib-buttons', this.el));
      return true;
    },
    // # A–Z down the right edge (A–Z sort only): moving over a letter previews it, OK or Left jumps there.
    buildAz() {
      const az = $('.az', this.el);
      az.innerHTML = '';
      az.hidden = this.sortIdx !== 0 || !this.grid.children.length;
      if (az.hidden) return;
      const first = {};
      Array.prototype.forEach.call(this.grid.children, p => {
        const c = ((p._item.titleSort || p._item.title || '').trim()[0] || '#').toUpperCase();
        const k = c >= 'A' && c <= 'Z' ? c : '#';
        if (!first[k]) first[k] = p;
      });
      for (const k of '#ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const el = h('div', 'az-key' + (first[k] ? ' focusable' : ' empty'), k);
        el._target = first[k];
        if (first[k]) el._select = () => Nav.focus(first[k]);
        az.appendChild(el);
      }
    },
    async render(keepFocus) {
      $('.lib-title', this.el).textContent = this.section.title;
      $('.lib-count', this.el).textContent = '';
      const genreBtn = $('.genre-btn', this.el), sortBtn = $('.sort-btn', this.el);
      genreBtn.textContent = 'Genre: ' + (this.genre ? this.genre.title : 'All');
      genreBtn.classList.toggle('active', !!this.genre);
      genreBtn._select = () => this.pickGenre();
      const collBtn = $('.coll-btn', this.el);
      collBtn.textContent = 'Collection: ' + (this.collection ? this.collection.title : 'All');
      collBtn.classList.toggle('active', !!this.collection);
      collBtn.hidden = !(this.collections && this.collections.length);
      collBtn._select = () => picker.open('Collection', [{ key: '', label: 'All titles' }].concat(this.collections.map(c => ({ key: c.key, label: c.title }))),
        this.collection ? this.collection.key : '', o => {
          this.collection = o.key ? { key: o.key, title: o.label } : null;
          this.render(true);
        });
      sortBtn.textContent = 'Sort: ' + SORTS[this.sortIdx][1];
      sortBtn._select = () => picker.open('Sort by', SORTS.map((s, i) => ({ key: i, label: s[1] })), this.sortIdx, o => {
        this.sortIdx = o.key;
        this.render(true);
      });
      this.grid.innerHTML = '';
      this.grid.style.transform = '';
      this.count = 0; this.total = Infinity; this.loading = false; this.gen++;
      await this.more();
      this.buildAz();
      if (!isActive(this)) return;
      if (!keepFocus && this.grid.firstChild) Nav.focus(this.grid.firstChild);
      else if (!this.grid.firstChild) Nav.focus(genreBtn);
    },
    async pickGenre() {
      if (!this.genres) {
        try { this.genres = await Plex.lib.genres(this.section.key); } catch (e) { return toast("Couldn't load genres."); }
      }
      const opts = [{ key: '', label: 'All genres' }].concat(this.genres.map(g => ({ key: g.key, label: g.title })));
      picker.open('Genre', opts, this.genre ? this.genre.key : '', o => {
        this.genre = o.key ? { key: o.key, title: o.label } : null;
        this.render(true);
      });
    },
    async more() {
      if (this.loading || this.count >= this.total) return;
      this.loading = true;
      const gen = this.gen;
      try {
        const filters = {};
        if (this.genre) filters.genre = this.genre.key;
        if (this.collection) filters.collection = this.collection.key;
        const { items, total } = await Plex.lib.all(this.section.key, this.count, PAGE, SORTS[this.sortIdx][0], filters);
        if (gen !== this.gen) return;
        this.count += items.length;
        this.total = total != null ? total : (items.length < PAGE ? this.count : Infinity);
        for (const m of items) this.grid.appendChild(posterCard(m));
        const n = this.total === Infinity ? this.count + '+' : this.total;
        $('.lib-count', this.el).textContent = n ? `${n} titles` : (this.genre || this.collection ? 'No titles match these filters' : 'This library is empty');
      } catch (e) {
        if (gen === this.gen) toast(`Couldn't load ${this.section.title}.`);
      } finally {
        if (gen === this.gen) this.loading = false;
      }
    },
  };

  // Scroll the poster grid so one row above the focused poster stays visible.
  function scrollGrid(grid, el, keepAbove) {
    if (pointerFocus) return;
    if (el._top == null) el._top = el.offsetTop;
    const y = Math.max(0, el._top - keepAbove);
    grid.style.transform = y ? `translateY(${-y}px)` : '';
  }

  library.el.addEventListener('nav:focus', e => {
    const el = e.target;
    if (el._target) {
      // On a letter: scroll its first title into view and make Left land on it.
      scrollGrid(library.grid, el._target, 402);
      Nav.remember(library.grid, el._target);
      return;
    }
    if (!el.classList.contains('poster')) return;
    scrollGrid(library.grid, el, 402);
    setAmbient(el._item.UltraBlurColors);
    if (Array.prototype.indexOf.call(library.grid.children, el) > library.count - 30) library.more();
  });

  // ---------------------------------------------------------------- details

  const backdropState = { flip: 0 };

  const details = views.details = {
    el: $('#view-details'),
    async enter(params) {
      this.rk = params.ratingKey;
      this.m = null;
      this.season = null;
      $('.details-body', this.el).innerHTML = '';
      $('.details-lower', this.el).innerHTML = '';
      $('.backdrop', this.el).classList.remove('on');
      await this.load(true);
    },
    focusDefault() { const b = $('.btn', this.el); if (b) Nav.focus(b); },
    refresh() { if (this.rk) this.load(false); },
    async load(fresh) {
      const rk = this.rk;
      try {
        const m = await Plex.lib.meta(rk, { includeOnDeck: 1 });
        if (rk === this.rk && isActive(this)) this.render(m, fresh);
      } catch (e) {
        toast("Couldn't load this title.");
      }
    },
    render(m, fresh) {
      this.m = m;
      setAmbient(m.UltraBlurColors, true);
      if (fresh) {
        const bd = $('.backdrop', this.el);
        bd.onload = () => bd.classList.add('on');
        bd.src = Plex.img(m.art || m.thumb, 1920, 1080);
      }
      const show = m.type === 'show';
      const tags = (list, n) => (list || []).slice(0, n).map(t => t.tag).join(', ');
      const cast = tags(m.Role, 3), director = tags(m.Director, 2);
      const body = $('.details-body', this.el);
      body.innerHTML =
        `<div class="eyebrow">${esc(eyebrow(m))}</div>` +
        '<div class="brand"></div>' +
        `<div class="meta">${metaHtml(m)}</div>` +
        `<p class="hero-summary">${esc(m.summary || '')}</p>` +
        '<div class="credits">' +
        (cast ? `<div><span>Starring</span> ${esc(cast)}</div>` : '') +
        (!show && director ? `<div><span>Director</span> ${esc(director)}</div>` : '') +
        '</div><div class="buttons" data-axis="x" data-right="none"></div>';
      setBrand($('.brand', body), m, 640, 190);
      const box = $('.buttons', body);
      if (show) this.showButtons(m, box); else this.movieButtons(m, box);

      // Keep the lower section when refreshing after playback; rebuild it on a fresh visit.
      const lower = $('.details-lower', this.el);
      if (fresh || !lower.children.length) {
        lower.innerHTML = '';
        if (show) {
          // Right at the end of the seasons or episodes stays put (it used to jump up to the buttons).
          lower.innerHTML = '<div class="clip" data-clip><div class="tabs" data-axis="x" data-right="none"></div></div>' +
            '<div class="clip" data-clip><div class="row-track eps" data-axis="x" data-right="none"></div></div>';
          if (!TV) addArrows($('.eps', lower).parentElement, $('.eps', lower));
          this.loadSeasons(m);
        } else {
          this.loadSimilar(m);
        }
      } else if (show && this.season) {
        const s = this.season;
        this.season = null;
        this.loadEpisodes(s);
      }
      // A refresh after playback keeps focus where it was (the episode row refocuses itself).
      const c = Nav.current();
      if (fresh || !c || !this.el.contains(c) || !document.contains(c)) Nav.focus(box.firstChild);
    },
    watchedButton(m, box) {
      const watched = m.type === 'show' ? m.viewedLeafCount >= m.leafCount : !!m.viewCount;
      const apply = async () => {
        await (watched ? Plex.lib.unscrobble : Plex.lib.scrobble)(m.ratingKey).catch(() => toast('Could not update.'));
        this.refresh();
      };
      // A show's ✓ changes every episode (and unwatching wipes their progress): ask first.
      box.appendChild(button(watched ? 'Mark unwatched' : 'Mark watched', 'check', () => (m.type !== 'show' ? apply()
        : picker.open(`Mark every episode of ${m.title} as ${watched ? 'unwatched' : 'watched'}?`,
          [{ key: 'yes', label: watched ? 'Mark all unwatched' : 'Mark all watched' }, { key: 'no', label: 'Cancel' }], 'no',
          o => { if (o.key === 'yes') apply(); })), 'round'));
    },
    movieButtons(m, box) {
      const off = m.viewOffset || 0;
      box.appendChild(button(off ? `Resume · ${fmtDur(m.duration - off)} left` : 'Play', 'play', () => startPlayback(m, off), 'primary'));
      if (off) box.appendChild(button('From the beginning', 'restart', () => startPlayback(m, 0), 'round'));
      this.watchedButton(m, box);
      this.watchlistButton(m, box);
    },
    // Add to / remove from the plex.tv watchlist (titles matched by Plex's current agents only).
    watchlistButton(m, box) {
      const id = /^plex:\/\//.test(m.guid || '') ? m.guid.split('/').pop() : '';
      if (!id) return;
      let on = false;
      const b = button('', null, async () => {
        try { await Plex.lib.watchlistSet(id, !on); } catch (e) { return toast("Couldn't update your watchlist. Try again."); }
        set(!on);
        home.watchlistDirty = true;
        toast(on ? 'Added to your watchlist' : 'Removed from your watchlist');
      }, 'round');
      const set = v => { on = v; b.innerHTML = (v ? ICONS.check : ICONS.plus) + `<span>${v ? 'On your watchlist' : 'Add to watchlist'}</span>`; };
      set(false);
      box.appendChild(b);
      Plex.lib.onWatchlist(id).then(v => { if (this.m === m) set(v); }).catch(() => {});
    },
    nextUp(m) {
      const od = m.OnDeck && m.OnDeck.Metadata;
      return (Array.isArray(od) ? od[0] : od) || null;
    },
    showButtons(m, box) {
      const next = this.nextUp(m);
      if (next) {
        const off = next.viewOffset || 0;
        box.appendChild(button(`${off ? 'Resume' : 'Play'} ${epCode(next)}`, 'play', () => startPlayback(next, off), 'primary'));
      } else {
        box.appendChild(button('Play', 'play', async () => {
          const eps = await Plex.lib.leaves(m.ratingKey, 1).catch(() => []);
          if (eps[0]) startPlayback(eps[0], 0);
        }, 'primary'));
      }
      this.watchedButton(m, box);
      this.watchlistButton(m, box);
    },
    async loadSimilar(m) {
      const items = await Plex.lib.similar(m.ratingKey).catch(() => []);
      if (this.m !== m || !items.length) return;
      const row = buildRow('More Like This', items.slice(0, 16));
      row.classList.add('active-row');
      warm(row);
      const clip = h('div', 'clip');
      clip.setAttribute('data-clip', '');
      clip.appendChild(row);
      $('.details-lower', this.el).appendChild(clip);
    },
    async loadSeasons(m) {
      const seasons = await Plex.lib.children(m.ratingKey).catch(() => []);
      if (this.m !== m) return;
      const tabs = $('.tabs', this.el);
      for (const s of seasons) {
        const t = h('div', 'tab focusable', esc(s.title));
        t._season = s;
        t._select = () => this.loadEpisodes(s);
        tabs.appendChild(t);
      }
      const next = this.nextUp(m);
      const start = (next && seasons.find(s => s.ratingKey === next.parentRatingKey)) || seasons[0];
      if (!start) return;
      const tab = Array.prototype.find.call(tabs.children, t => t._season === start);
      Nav.remember(tabs, tab);
      scrollRow(tabs, tab, 0);
      this.loadEpisodes(start);
    },
    async loadEpisodes(s) {
      if (this.season === s.ratingKey) return;
      this.season = s.ratingKey;
      for (const t of $('.tabs', this.el).children) t.classList.toggle('current', t._season === s);
      const eps = await Plex.lib.children(s.ratingKey).catch(() => []);
      if (this.season !== s.ratingKey || !this.m) return;
      const track = $('.eps', this.el);
      const hadFocus = track.contains(Nav.current());
      track.innerHTML = '';
      track.style.transform = '';
      for (const e of eps) track.appendChild(episodeCard(e));
      const next = this.nextUp(this.m);
      const card = (next && Array.prototype.find.call(track.children, c => c._item.ratingKey === next.ratingKey)) ||
        Array.prototype.find.call(track.children, c => c._item.viewOffset) || track.firstChild;
      if (card) {
        Nav.remember(track, card);
        scrollRow(track, card);
        if (hadFocus) Nav.focus(card);
      }
    },
  };

  details.el.addEventListener('nav:focus', e => {
    const el = e.target, summary = $('.details-body .hero-summary', details.el);
    if (el._season) {
      scrollRow(el.parentElement, el, 0);
      clearTimeout(details.tabTimer);
      if (TV) details.tabTimer = setTimeout(() => details.loadEpisodes(el._season), 350); // PC: on click (_select)
    }
    if (el.classList.contains('ep') || el.classList.contains('tile')) scrollRow(el.parentElement, el);
    if (!summary || !details.m) return;
    // Episodes show their own synopsis in place of the show's.
    summary.textContent = el.classList.contains('ep')
      ? `${el._item.index}. ${el._item.title} — ${el._item.summary || ''}`
      : details.m.summary || '';
  });

  // ---------------------------------------------------------------- search

  const search = views.search = {
    el: $('#view-search'), rail: true, q: '',
    enter() { if (!this.built) this.build(); this.focusDefault(); },
    focusDefault() { Nav.enter($('.keys', this.el)); },
    build() {
      this.built = true;
      const keys = $('.keys', this.el);
      for (const c of 'abcdefghijklmnopqrstuvwxyz1234567890') keys.appendChild(this.key(c.toUpperCase(), () => this.set(this.q + c)));
      keys.appendChild(this.key('Space', () => this.set(this.q + ' '), 'wide'));
      keys.appendChild(this.key('⌫', () => this.set(this.q.slice(0, -1)), 'wide'));
      keys.appendChild(this.key('Clear', () => this.set(''), 'wide'));
      this.set('');
    },
    key(label, fn, cls) {
      const k = h('div', 'key focusable' + (cls ? ' ' + cls : ''), esc(label));
      k._select = fn;
      return k;
    },
    set(q) {
      this.q = q;
      $('.query .q', this.el).textContent = q;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(), 350);
    },
    async run() {
      const q = this.q.trim(), res = $('.results', this.el);
      res.style.transform = '';
      if (!q) { res.innerHTML = '<p class="empty">Search your movies and shows.</p>'; return; }
      const items = await Plex.lib.search(q).catch(() => null);
      if (q !== this.q.trim()) return;
      res.innerHTML = '';
      if (!items) { res.innerHTML = '<p class="empty">Search failed. Is the server online?</p>'; return; }
      if (!items.length) { res.innerHTML = `<p class="empty">No results for “${esc(q)}”.</p>`; return; }
      for (const m of items) res.appendChild(posterCard(m, true));
    },
    // Back from the results goes to the keyboard first.
    onBack() {
      if (!$('.results', this.el).contains(Nav.current())) return false;
      Nav.enter($('.keys', this.el));
      return true;
    },
    // Lets a keyboard type straight into search (the TV's USB keyboards; ?tv previews on a PC).
    onKey(key, e) {
      if (e.key && e.key.length === 1 && /[a-z0-9 ]/i.test(e.key)) { this.set(this.q + e.key.toLowerCase()); return true; }
      if (e.keyCode === 8 && this.q) { this.set(this.q.slice(0, -1)); return true; }
      return false;
    },
  };

  search.el.addEventListener('nav:focus', e => {
    const el = e.target;
    if (!el.classList.contains('poster')) return;
    scrollGrid($('.results', search.el), el, 380);
    setAmbient(el._item.UltraBlurColors);
  });

  // ---------------------------------------------------------------- picker

  // A slide-in list for choosing one option (genre, sort order). Back closes it.
  const picker = {
    el: $('#picker'),
    get list() { return $('.picker-list', this.el); },
    isOpen() { return !this.el.hidden; },
    open(title, options, currentKey, onPick) {
      this.returnTo = Nav.current();
      $('h2', this.el).textContent = title;
      const list = this.list;
      list.innerHTML = '';
      list.style.transform = '';
      for (const o of options) {
        const it = h('div', 'pick focusable' + (o.key === currentKey ? ' current' : ''), `<span>${esc(o.label)}</span>${ICONS.check}`);
        it._select = () => { this.close(); onPick(o); };
        list.appendChild(it);
      }
      this.el.hidden = false;
      Nav.focus(list.querySelector('.current') || list.firstChild);
    },
    close() {
      this.el.hidden = true;
      if (this.returnTo && document.contains(this.returnTo)) Nav.focus(this.returnTo);
    },
  };

  // Keep the focused option near the middle of the list.
  picker.el.addEventListener('nav:focus', e => {
    if (pointerFocus) return;
    const list = picker.list, view = list.parentElement.clientHeight;
    const y = Math.max(0, Math.min(list.scrollHeight - view, e.target.offsetTop - view / 2 + e.target.offsetHeight / 2));
    list.style.transform = y ? `translateY(${-y}px)` : '';
  });

  // ---------------------------------------------------------------- settings

  views.settings = {
    el: $('#view-settings'), rail: true,
    focusDefault() { Nav.enter($('.settings .buttons', this.el)); },
    enter() {
      setAmbient(null);
      const s = Plex.server() || {};
      const box = $('.settings', this.el);
      box.innerHTML = '<h1>Settings</h1>' +
        `<div class="account"><div class="avatar"></div><span>${esc(account ? account.title || account.username : 'Plex account')}</span></div>` +
        `<p class="server-info">Connected to <b>${esc(s.name)}</b><br><small>${esc(s.uri)}</small></p>` +
        '<div class="buttons" data-axis="x"></div>' +

        `<p class="about">Subtitle search: ${Subs.enabled() ? 'OpenSubtitles directly (API key set)' : 'through Plex · add an OpenSubtitles API key in js/config.js to search directly'}</p>` +
        '<p class="about">Gravitos 1.12.1 · an unofficial Plex client for Samsung TVs</p>';
      if (account && account.thumb) $('.avatar', box).style.backgroundImage = `url("${account.thumb}")`;
      const btns = $('.buttons', box);
      btns.appendChild(button('Reload library', 'restart', async () => {
        try { await loadSections(); } catch (e) { return toast("Couldn't reach the server."); }
        home.loaded = false; library.section = null; markRail('home'); reset('home');
      }));
      const langBtn = button('Subtitles: ' + Subs.langName(Subs.lang()), null, () => {
        picker.open('Subtitle language', Subs.LANGS.map(l => ({ key: l[0], label: l[1] })), Subs.lang(), o => {
          Subs.setLang(o.key);
          $('span', langBtn).textContent = 'Subtitles: ' + o.label;
        });
      });
      btns.appendChild(langBtn);
      if (homeUsers.length > 1) btns.appendChild(button('Switch profile', null, () => reset('profiles')));
      btns.appendChild(button('Switch server', null, () => reset('servers', { choose: true })));
      btns.appendChild(button('Sign out', null, () => { Plex.signOut(); sections = []; reset('login'); }));
      Nav.focus(btns.firstChild);
    },
  };

  // ---------------------------------------------------------------- input

  let lastMove = 0;
  // OK on an element with a hold action (Continue Watching) acts on release; held for 600 ms
  // it opens the hold action instead. Until OK is released, its repeats are ignored, so the
  // menu that opens can't be chosen from by accident.
  let hold = null;
  // PC is mouse-only: real key presses are ignored there; the wheel and controllers send
  // synthetic ones (isTrusted false). ?tv keeps the keyboard for previewing the TV.
  document.addEventListener('keydown', e => {
    if (!TV && e.isTrusted) return;
    const key = KEYS[e.keyCode];
    if (key === 'enter' && hold) { e.preventDefault(); return; }
    // F (PC): full screen, except while typing a search.
    if (key === 'fullscreen' && !isActive(search)) { e.preventDefault(); return toggleFullscreen(); }
    // An open picker takes the keys first, including over the player (subtitle menus).
    if (picker.isOpen()) {
      if (!key) return;
      e.preventDefault();
      if (key === 'back') picker.close();
      else if (key === 'left' || key === 'right' || key === 'up' || key === 'down') Nav.move(key);
      else if (key === 'enter' && !e.repeat) { const c = Nav.current(); if (c && c._select) c._select(); }
      return;
    }
    if (Player.active()) {
      if (key) { e.preventDefault(); Player.key(key); }
      return;
    }
    const t = top();
    if (t && t.view.onKey && t.view.onKey(key, e)) { e.preventDefault(); return; }
    if (!key) return;
    e.preventDefault();
    const arrow = key === 'left' || key === 'right' || key === 'up' || key === 'down';
    // A held arrow on the TV repeats faster than it can draw: skip repeats that pile up.
    if (arrow && TV && e.repeat && performance.now() - lastMove < 110) return;
    if (arrow) { lastMove = performance.now(); Nav.move(key); }
    else if (key === 'enter') {
      const c = Nav.current();
      if (c && c._hold) {
        const hd = hold = { el: c, done: false };
        hd.timer = setTimeout(() => { hd.done = true; c._hold(); }, 600);
      } else if (c && c._select) c._select();
    }
    else if (key === 'back') back();
  });

  document.addEventListener('keyup', e => {
    if (!TV && e.isTrusted) return;
    if (KEYS[e.keyCode] !== 'enter' || !hold) return;
    const hd = hold;
    hold = null;
    clearTimeout(hd.timer);
    if (!hd.done && hd.el === Nav.current() && hd.el._select) hd.el._select();
  });

  // ---------------------------------------------------------------- PC: mouse, wheel, controllers

  function toggleFullscreen() {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => {});
  }

  // Wheel, controllers and the like press the same keys the keyboard and remote do.
  function synth(type, code, repeat) {
    const e = new KeyboardEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => code });
    Object.defineProperty(e, 'repeat', { get: () => !!repeat });
    document.dispatchEvent(e);
  }

  // The wheel steps through rows (sideways with Shift or a sideways scroll), one step per notch.
  // A mouse notch (~100px) is one step; a touchpad's many small events add up to steps.
  let wheelAt = 0, wheelStep = 0, wheelSum = 0;
  addEventListener('wheel', e => {
    if (TV || (Player.active() && !picker.isOpen())) return;
    if (e.target.closest && e.target.closest('#chapters, #osd-controls')) return; // the player's own wheel uses
    e.preventDefault();
    const now = performance.now();
    const side = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const d = (side ? e.deltaX || e.deltaY : e.deltaY) * (e.deltaMode === 1 ? 40 : 1);
    if (!d) return;
    if (now - wheelAt > 250) wheelSum = 0; // a new gesture
    wheelAt = now;
    wheelSum += d;
    if (Math.abs(wheelSum) < 60 || now - wheelStep < 140) return;
    wheelStep = now;
    const code = side ? (wheelSum > 0 ? 39 : 37) : (wheelSum > 0 ? 40 : 38);
    wheelSum = 0;
    synth('keydown', code);
    synth('keyup', code);
  }, { passive: false });

  // Pointing at something focuses it (the hero follows), without scrolling it away.
  let lastXY = '';
  document.addEventListener('mousemove', e => {
    const xy = e.clientX + ',' + e.clientY;
    if (xy === lastXY || Player.active()) return; // content moving under a still pointer isn't a move
    lastXY = xy;
    const f = e.target.closest('.focusable');
    if (!f || f === Nav.current() || (picker.isOpen() && !f.closest('#picker'))) return;
    pointerFocus = true;
    try { Nav.focus(f); } finally { pointerFocus = false; }
  });

  // Xbox / PlayStation controllers: D-pad or left stick to move, A to select (hold for
  // options), B to go back, Start to pause, bumpers to skip back / forward.
  const PAD = { 12: 38, 13: 40, 14: 37, 15: 39, 0: 13, 1: 27, 9: 32, 4: 412, 5: 417 };
  const padHeld = {};
  let padLoop = 0;
  function pollPads() {
    const pads = navigator.getGamepads ? Array.prototype.filter.call(navigator.getGamepads(), Boolean) : [];
    if (!pads.length) { padLoop = 0; return; }
    const down = {};
    for (const p of pads) {
      for (const b in PAD) if (p.buttons[b] && p.buttons[b].pressed) down[PAD[b]] = true;
      const x = p.axes[0] || 0, y = p.axes[1] || 0;
      if (x < -0.6) down[37] = true; else if (x > 0.6) down[39] = true;
      if (y < -0.6) down[38] = true; else if (y > 0.6) down[40] = true;
    }
    const now = performance.now();
    for (const c in down) {
      const held = padHeld[c];
      if (!held) { padHeld[c] = { next: now + 400 }; synth('keydown', +c); }
      // Held directions repeat, like a held key; A doesn't (holding it opens options).
      else if (now >= held.next && c !== '13') { held.next = now + 130; synth('keydown', +c, true); }
    }
    for (const c in padHeld) if (!down[c]) { delete padHeld[c]; synth('keyup', +c); }
    padLoop = requestAnimationFrame(pollPads);
  }
  addEventListener('gamepadconnected', () => { if (!padLoop) padLoop = requestAnimationFrame(pollPads); });

  // Back and Full screen (top right, PC only) and the mouse's own Back button: the mouse alone gets
  // everywhere. Back leaves a video outright rather than first hiding its controls.
  function pcBack() {
    if (picker.isOpen()) picker.close();
    else if (Player.active()) Player.key('stop');
    else back();
  }
  $('#pc-back').addEventListener('click', e => { e.stopPropagation(); pcBack(); });
  $('#rail').addEventListener('mouseleave', () => {
    $('#stage').classList.remove('rail-open');
    const c = Nav.current(), t = top();
    if (!c || !c.closest('#rail') || !t || !t.view.focusDefault) return;
    // Hand focus back to the page, without scrolling it, so no menu item stays highlighted.
    pointerFocus = true;
    try { t.view.focusDefault(); } finally { pointerFocus = false; }
  });
  $('#pc-full').addEventListener('click', e => { e.stopPropagation(); toggleFullscreen(); });
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement, b = $('#pc-full');
    b.title = on ? 'Exit full screen' : 'Full screen';
    $('svg', b).innerHTML = on ? '<path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5"/>' : '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>';
  });
  addEventListener('mouseup', e => { if (e.button === 3 && !TV) { e.preventDefault(); pcBack(); } });

  // Right-click stands in for holding OK when testing with a mouse.
  document.addEventListener('contextmenu', e => {
    if (!TV) e.preventDefault(); // the browser's own menu (Reload, Inspect…) looks out of place in the app
    const f = e.target.closest('.focusable');
    if (!f || !f._hold || Player.active()) return;
    e.preventDefault();
    Nav.focus(f);
    f._hold();
  });

  // Mouse support for testing in a desktop browser.
  document.addEventListener('click', e => {
    const f = e.target.closest('.focusable');
    if (!f && picker.isOpen() && !e.target.closest('.picker-panel')) return picker.close();
    // Over a video only the menus it opens (subtitles, audio, episodes) are the app's to handle.
    if (!f || (Player.active() && !f.closest('#picker'))) return;
    Nav.focus(f);
    if (f._select) f._select();
  });

  // ---------------------------------------------------------------- start

  async function boot() {
    fit();
    addEventListener('resize', fit);
    tickClock();
    setInterval(tickClock, 10000);
    // The installed PC app keeps working when the local server isn't running (sw.js).
    if (!TV && 'serviceWorker' in navigator && /^http/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
    setAmbient(null, true);
    try {
      tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'Caption', 'Info',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    } catch (e) {}
    if (!Plex.token()) { window.gravitosReady = true; return reset('login'); }
    const [, many] = await Promise.all([loadAccount(), loadProfiles()]);
    if (many) { window.gravitosReady = true; return reset('profiles'); }
    startServer(false);
  }

  // Open the saved server (or find one). After a profile switch the saved connection belongs
  // to the old profile, so the server is looked up again for the new one's access.
  async function startServer(switched) {
    // A saved connection made by another profile would show that profile's libraries.
    const saved = Plex.server();
    if (saved && saved.owner === Plex.token() && !switched) {
      try {
        await Plex.ping();
        await loadSections();
        markRail('home');
        return reset('home');
      } catch (e) {
        // The saved address no longer answers (new IP?) - rediscover it.
      }
    }
    window.gravitosReady = true;
    reset('servers');
  }

  boot();
})();
