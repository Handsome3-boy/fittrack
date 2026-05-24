// FitTrack Service Worker — PWA Offline Support
// Cache-first for local assets, network-first for CDN, stale-while-revalidate for data

const CACHE_VERSION = 'fittrack-v6';
const STATIC_CACHE = CACHE_VERSION + '-static';
const CDN_CACHE = CACHE_VERSION + '-cdn';

// Core assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './fitness-tracker.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

// CDN assets — network-first with cache fallback
const CDN_ORIGINS = [
  'cdn.jsdelivr.net',
];

// ── Install: pre-cache core assets ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Pre-cache miss:', url, err)
          )
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches, claim clients ───────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== CDN_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy per resource type ───────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip non-http(s) requests (chrome-extension://, etc.)
  if (!url.protocol.startsWith('http')) return;

  // CDN resources: network-first, cache fallback
  if (CDN_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(cdnStrategy(event.request));
    return;
  }

  // Local same-origin resources: cache-first (stale-while-revalidate)
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }

  // Other cross-origin: network-only (don't cache third-party)
});

// ── Strategy: Cache-first with background revalidation ──────
async function cacheFirstStrategy(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  // Revalidate in background
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => cached);

  // Return cached immediately if available
  return cached || fetchPromise;
}

// ── Strategy: Network-first with cache fallback ─────────────
async function cdnStrategy(request) {
  const cache = await caches.open(CDN_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // If no cache and no network, throw
    throw err;
  }
}

// ── Message handler for skipWaiting prompts ─────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
