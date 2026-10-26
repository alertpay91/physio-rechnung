// Service worker: aplikacija radi i bez interneta. Uvek prvo pokušava mrežu (najnovija verzija),
// a keš koristi samo kad mreže nema. GitHub API i access.json se nikad ne keširaju ovde.
const CACHE = 'physio-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/util.js', 'js/model.js', 'js/crypto.js', 'js/store.js', 'js/github.js', 'js/vault.js', 'js/pdf.js', 'js/zip.js', 'js/ui.js', 'js/i18n.js',
  'js/views/auth.js', 'js/views/dashboard.js', 'js/views/invoices.js', 'js/views/patients.js', 'js/views/settings.js', 'js/views/data.js',
  'vendor/pdfmake.min.js', 'vendor/vfs_fonts.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/access.json')) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
