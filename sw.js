const CACHE_NAME = 'jptrust-member-v20';  // bumped 2026-07-08 — auto-reload clients on activate (self-heal stale caches)
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
  event.waitUntil((async () => {
    // purge old version caches
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    // Auto-reload any open pages so they refetch fresh HTML (via cache:reload).
    // This self-heals users stuck on a stale cached app shell — no manual clear.
    const wins = await self.clients.matchAll({ type: 'window' });
    for (const c of wins) {
      try { c.navigate(c.url); } catch (e) {}
    }
  })());
});

// Fetch — network first, fallback to cache
// Skip non-GET requests (Cache API only supports GET — POST/PUT/DELETE would throw)
// EXCEPT: news files are always fetched fresh (never cached), so new batches show immediately
self.addEventListener('fetch', event => {
  // Skip caching for non-GET (POST to Supabase, etc.)
  if (event.request.method !== 'GET') return;

  const url = event.request.url;
  const isNews = url.includes('/news/') || url.includes('news-index.json');
  if (isNews) {
    // Always go to network for news — no cache fallback
    event.respondWith(fetch(event.request, {cache: 'no-store'}));
    return;
  }
  // HTML / navigations: always fetch fresh from network (bypass the browser
  // HTTP cache) so a new deploy reaches users immediately — no stale app shell.
  let pathname = '/';
  try { pathname = new URL(url).pathname; } catch (e) {}
  const isHTML = event.request.mode === 'navigate' || pathname.endsWith('.html') || pathname === '/';
  event.respondWith(
    fetch(event.request, isHTML ? {cache: 'reload'} : undefined)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
