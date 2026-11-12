// Plex API client: PIN sign-in, server discovery, library queries and media URLs.
const Plex = (() => {
  const PRODUCT = 'Gravitos';
  const VERSION = '1.0.0';
  const onTv = typeof window.tizen !== 'undefined';

  const store = {
    get(k) { try { return localStorage.getItem('mq.' + k); } catch (e) { return null; } },
    set(k, v) {
      try { v == null ? localStorage.removeItem('mq.' + k) : localStorage.setItem('mq.' + k, v); } catch (e) {}
    },
  };

  function clientId() {
    let id = store.get('clientId');
    if (!id) {
      id = 'gravitos-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      store.set('clientId', id);
    }
    return id;
  }

  function identity() {
    return {
      'X-Plex-Product': PRODUCT,
      'X-Plex-Version': VERSION,
      'X-Plex-Client-Identifier': clientId(),
      // Plex picks its transcode profile from the platform; Chrome's is the safe HLS/H.264 one.
      'X-Plex-Platform': 'Chrome',
      'X-Plex-Device': onTv ? 'Samsung TV' : 'Browser',
      'X-Plex-Device-Name': onTv ? 'Gravitos (Samsung TV)' : 'Gravitos',
    };
  }

  let token = store.get('token');
  let server = null;
  try { server = JSON.parse(store.get('server') || 'null'); } catch (e) {}

  async function req(url, opts) {
    const { method = 'GET', auth, timeout = 15000 } = opts || {};
    const headers = Object.assign({ Accept: 'application/json' }, identity());
    if (auth) headers['X-Plex-Token'] = auth;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { method, headers, signal: ctl.signal });
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status + ' from ' + url.split('?')[0]);
        err.status = res.status;
        throw err;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- plex.tv account

  // strong=false gives a 4-character code to type at plex.tv/link; strong=true gives the long
  // code Plex's sign-in page (authUrl) expects, which the QR code carries.
  const createPin = strong => req('https://plex.tv/api/v2/pins?strong=' + !!strong, { method: 'POST' });
  const authUrl = code => 'https://app.plex.tv/auth#?' + new URLSearchParams({
    clientID: clientId(), code, 'context[device][product]': PRODUCT,
  });
  const checkPin = id => req('https://plex.tv/api/v2/pins/' + id).then(p => p.authToken || null);

  // `token` is the current profile's; `homeToken` is the account that signed in, kept so the
  // profile list (Plex Home) can be read and switched from any profile.
  let homeToken = store.get('homeToken');
  // Copies installed before profiles existed: the saved sign-in is the account's own. Save it
  // now, before any switch replaces `token`.
  if (!homeToken && token) { homeToken = token; store.set('homeToken', token); }
  function setToken(t, fromSignIn) {
    token = t; store.set('token', t);
    if (fromSignIn || !homeToken) { homeToken = t; store.set('homeToken', t); }
  }

  function signOut() {
    token = null; server = null; homeToken = null;
    store.set('token', null); store.set('server', null); store.set('homeToken', null);
  }

  // ---- Plex Home profiles
  const homeUsers = () => req('https://plex.tv/api/v2/home/users', { auth: homeToken, timeout: 8000 }).then(r => r.users || r || []);
  // Resolves to the profile's own token; a wrong PIN rejects with status 401/403.
  const switchUser = (uuid, pin) => req(`https://plex.tv/api/v2/home/users/${uuid}/switch` + (pin ? '?pin=' + encodeURIComponent(pin) : ''),
    { auth: homeToken, method: 'POST' }).then(u => u.authToken);

  async function servers() {
    const list = await req('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { auth: token });
    return list.filter(r => (r.provides || '').split(',').includes('server'));
  }

  // Try every address Plex knows for the server at once and keep the best one that answers:
  // local before remote, https before http, relay last.
  async function connect(resource) {
    const conns = [];
    const seen = new Set();
    const add = c => { if (!seen.has(c.uri)) { seen.add(c.uri); conns.push(c); } };
    for (const c of resource.connections || []) {
      add(c);
      if (c.local && c.address) add({ uri: `http://${c.address}:${c.port}`, local: true, protocol: 'http' });
    }
    const rank = c => (c.relay ? 4 : 0) + (c.local ? 0 : 2) + (c.protocol === 'https' ? 0 : 1);
    conns.sort((a, b) => rank(a) - rank(b));

    const auth = resource.accessToken || token;
    const results = await Promise.all(conns.map(c =>
      req(c.uri + '/identity', { auth, timeout: 5000 }).then(() => c, () => null)));
    const best = results.find(Boolean);
    if (!best) throw new Error(`Couldn't reach ${resource.name}. Is it switched on?`);

    // `owner`: the profile this connection's access belongs to (see startServer in app.js).
    server = { name: resource.name, id: resource.clientIdentifier, uri: best.uri, token: auth, owner: token };
    store.set('server', JSON.stringify(server));
    return server;
  }

  // ---- media server

  function api(path, params, method) {
    const q = params ? (path.includes('?') ? '&' : '?') + new URLSearchParams(params) : '';
    return req(server.uri + path + q, { auth: server.token, method }).then(r => r.MediaContainer || r);
  }

  function url(path, params) {
    const p = new URLSearchParams(Object.assign({}, params, { 'X-Plex-Token': server.token }));
    return server.uri + path + (path.includes('?') ? '&' : '?') + p;
  }

  // Server-side resize keeps the TV from decoding full-size artwork.
  function img(path, w, h, png) {
    if (!path) return '';
    const p = { width: w, height: h, minSize: 1, upscale: 1, url: path };
    if (png) p.format = 'png';
    return url('/photo/:/transcode', p);
  }

  // The title's transparent logo artwork (the show's, for an episode or season), if Plex has one.
  function logo(m, w, h) {
    const l = (m.Image || []).find(i => i.type === 'clearLogo');
    return l ? img(l.url, w, h, true) : '';
  }

  // Fallback for files the TV can't play directly: Plex transcodes to HLS from `offsetMs`.
  // `extra` can ask for a subtitle to be burned into the picture.
  function hlsUrl(meta, offsetMs, session, extra) {
    return url('/video/:/transcode/universal/start.m3u8', Object.assign({
      path: '/library/metadata/' + meta.ratingKey,
      mediaIndex: 0, partIndex: 0, protocol: 'hls',
      offset: Math.floor((offsetMs || 0) / 1000),
      fastSeek: 1, directPlay: 0, directStream: 1,
      videoQuality: 100, videoResolution: '1920x1080', maxVideoBitrate: 20000,
      subtitleSize: 100, audioBoost: 100, location: 'lan',
      session, 'X-Plex-Session-Identifier': session,
    }, identity(), extra));
  }

  // Plex (1.43 here) refuses start.m3u8 with "400 Bad Request" unless the same request has
  // first been put to /decision, as Plex's own apps do. Resolves to the URL to play.
  async function startHls(meta, offsetMs, session, extra) {
    const start = hlsUrl(meta, offsetMs, session, extra);
    await fetch(start.replace('/start.m3u8', '/decision'), { headers: { Accept: 'application/json' } }).catch(() => {});
    return start;
  }

  const DISCOVER = 'https://discover.provider.plex.tv';
  const page = (start, size) => ({ 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': size });

  const lib = {
    sections: () => api('/library/sections')
      .then(m => (m.Directory || []).filter(d => d.type === 'movie' || d.type === 'show')),
    onDeck: () => api('/library/onDeck', page(0, 20)).then(m => m.Metadata || []),
    all: (id, start, size, sort, filters) => api(`/library/sections/${id}/all`, Object.assign({ sort }, filters, page(start, size)))
      .then(m => ({ items: m.Metadata || [], total: m.totalSize })),
    // Full metadata (including the IMDb / Rotten Tomatoes Rating list) for many items in one request.
    metaMany: keys => (keys.length ? api(`/library/metadata/${keys.join(',')}`).then(m => m.Metadata || []) : Promise.resolve([])),
    genres: id => api(`/library/sections/${id}/genre`).then(m => m.Directory || []),
    // Collections: the list (for Home rows), the filter values (for the library), and their titles.
    collections: id => api(`/library/sections/${id}/collections`).then(m => m.Metadata || []),
    collectionFilters: id => api(`/library/sections/${id}/collection`).then(m => m.Directory || []),
    collectionItems: c => api(c.key || `/library/collections/${c.ratingKey}/children`, page(0, 60)).then(m => m.Metadata || []),
    removeFromDeck: rk => api('/actions/removeFromContinueWatching', { ratingKey: rk }, 'PUT'),
    // The watchlist lives on plex.tv (the same one as the Plex apps), keyed by the id at the end
    // of a title's plex:// guid. Titles matched by older agents have no such id.
    watchlist: () => req(DISCOVER + '/library/sections/watchlist/all?X-Plex-Container-Start=0&X-Plex-Container-Size=60', { auth: token })
      .then(r => (r.MediaContainer && r.MediaContainer.Metadata) || []),
    onWatchlist: id => req(`${DISCOVER}/library/metadata/${id}/userState`, { auth: token })
      .then(r => { const s = r.MediaContainer && r.MediaContainer.UserState; return !!(s && (s[0] || s).watchlistedAt); }),
    watchlistSet: (id, on) => req(`${DISCOVER}/actions/${on ? 'addToWatchlist' : 'removeFromWatchlist'}?ratingKey=${id}`, { auth: token, method: 'PUT' }),
    // A plex.tv title in this library (by guid), or null.
    byGuid: guid => api('/library/all', { guid }).then(m => (m.Metadata || [])[0] || null),
    byGenre: (id, g) => {
      const path = g.fastKey || (String(g.key).charAt(0) === '/' ? g.key : `/library/sections/${id}/all?genre=${g.key}`);
      return api(path, page(0, 60)).then(m => m.Metadata || []);
    },
    meta: (rk, extra) => api(`/library/metadata/${rk}`, extra).then(m => (m.Metadata || [])[0]),
    children: rk => api(`/library/metadata/${rk}/children`).then(m => m.Metadata || []),
    similar: rk => api(`/library/metadata/${rk}/similar`, { count: 20 }).then(m => m.Metadata || []),
    leaves: (rk, n) => api(`/library/metadata/${rk}/allLeaves`, page(0, n)).then(m => m.Metadata || []),
    search: q => api('/hubs/search', { query: q, limit: 30 }).then(m => (m.Hub || [])
      .filter(h => h.type === 'movie' || h.type === 'show')
      .reduce((all, h) => all.concat(h.Metadata || []), [])),
    timeline: p => api('/:/timeline', p).catch(() => {}),
    scrobble: rk => api('/:/scrobble', { key: rk, identifier: 'com.plexapp.plugins.library' }),
    unscrobble: rk => api('/:/unscrobble', { key: rk, identifier: 'com.plexapp.plugins.library' }),
    // The client identifier has to be in the query, as it was when the session started,
    // or Plex answers 404 and the conversion keeps running on the server.
    // `closing`: sent as the page goes away, so the browser has to let it finish (keepalive).
    stopTranscode: (session, closing) => {
      const params = Object.assign({ session }, identity());
      if (closing) return fetch(url('/video/:/transcode/universal/stop', params), { keepalive: true }).catch(() => {});
      return api('/video/:/transcode/universal/stop', params).catch(() => {});
    },

    // Subtitles. Plex searches OpenSubtitles itself; downloading a result adds it to the item
    // as an external stream (this needs the server's subtitle downloads to work, see README).
    searchSubs: (rk, lang) => api(`/library/metadata/${rk}/subtitles`, { language: lang, hearingImpaired: 0, forced: 0 })
      .then(m => m.Stream || []),
    downloadSub: (rk, key) => api(`/library/metadata/${rk}/subtitles`, { key }, 'PUT'),
    // Remember the choice on the server (0 = off), like Plex's own apps do.
    selectSub: (partId, streamId) => api(`/library/parts/${partId}`, { subtitleStreamID: streamId || 0, allParts: 1 }, 'PUT'),
    selectAudio: (partId, streamId) => api(`/library/parts/${partId}`, { audioStreamID: streamId, allParts: 1 }, 'PUT'),
    subText: stream => fetch(url(stream.key, { encoding: 'utf-8' })).then(r => {
      if (!r.ok) throw new Error('Subtitle download failed (' + r.status + ')');
      return r.text();
    }),
  };

  const user = () => req('https://plex.tv/api/v2/user', { auth: token });
  const homeUser = () => req('https://plex.tv/api/v2/user', { auth: homeToken });

  return {
    clientId, createPin, authUrl, checkPin, setToken, signOut, servers, connect, user, homeUser, homeUsers, switchUser,
    homeToken: () => homeToken,
    token: () => token,
    server: () => server,
    ping: () => api('/identity'),
    api, url, img, logo, hlsUrl, startHls, lib,
  };
})();
