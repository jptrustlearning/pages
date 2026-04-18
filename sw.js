const CACHE_NAME = 'jptrust-member-v3';  // bumped 2026-04-18 to force-refresh after sp500-strategy-pro luxe overhaul
const ASSETS = [
  './',
  './member-dashboard.html',
  './manifest.json',
  './pwa-icons/icon-192x192.png',
  './pwa-icons/icon-512x512.png',
  'https://fonts.googleapis.com/css2?family=Anuphan:wght@200;300;400;500;600;700&family=Cinzel:wght@400;500;600;700&family=DM+Serif+Display&display=swap'
];

// Install — cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
// EXCEPT: news files are always fetched fresh (never cached), so new batches show immediately
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const isNews = url.includes('/news/') || url.includes('news-index.json');
  if (isNews) {
    // Always go to network for news — no cache fallback
    event.respondWith(fetch(event.request, {cache: 'no-store'}));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
