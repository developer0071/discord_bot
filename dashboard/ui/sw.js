const CACHE_NAME = 'moonlight-soldiers-cache-v5';

// Install event - cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll([
          '/',
          '/index.html',
          '/logo.png',
          '/app-api.js'
        ]);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          return cacheName.startsWith('moonlight-soldiers-cache-') && cacheName !== CACHE_NAME;
        }).map(cacheName => {
          return caches.delete(cacheName);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - Stale While Revalidate strategy
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests, except for fonts/icons
  if (!event.request.url.startsWith(self.location.origin) && 
      !event.request.url.includes('fonts.googleapis.com') && 
      !event.request.url.includes('fonts.gstatic.com') &&
      !event.request.url.includes('cdnjs.cloudflare.com')) {
    return;
  }

  const request = event.request;
  const accept = request.headers.get('accept') || '';
  const isFreshCriticalAsset =
    request.mode === 'navigate' ||
    accept.includes('text/html') ||
    request.url.endsWith('/app-api.js') ||
    request.url.endsWith('/sw.js');

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(err => {
        console.error('Network fetch failed', err);
        return caches.match(request).then(cachedResponse => {
          if (cachedResponse) return cachedResponse;
          if (!isFreshCriticalAsset) return Response.error();
          throw err;
        });
      })
  );
});
