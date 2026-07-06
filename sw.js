const CACHE_NAME = 'ai-chess-v1';
// 需要快取的檔案清單
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json'
];

// 安裝 Service Worker 並預存檔案
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching shell assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// 啟用 Service Worker 並清除舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch 策略：Cache-First (快取優先)
// 優先從快取尋找資源，若無則才從網路獲取
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
