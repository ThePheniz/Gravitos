// Lets the installed PC app open without the local server running. The app's own files are
// fetched fresh when the server answers (so changes show up) and saved; when it doesn't, the
// saved copies are used. Plex and plex.tv requests go straight to the network, never cached.
const CACHE = 'gravitos';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'pwa-192.png', 'pwa-512.png', 'css/app.css', 'fonts/inter-var.woff2',
  'js/splash.js', 'js/splash-gl.js', 'js/config.js', 'js/plex.js', 'js/subs.js', 'js/nav.js', 'js/player.js',
  'js/franchises.js', 'js/app.js', 'js/vendor/qrcode.js', 'js/vendor/hls.light.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' })
    .then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: true })
      .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
