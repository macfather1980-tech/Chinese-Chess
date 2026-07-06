/**
 * sw.js - Service Worker for Offline Support
 * 策略：Cache-First (靜態資源快取優先)
 */

const CACHE_NAME = 'chess-pwa-v1';
// 需要離線載入的資源清單
const ASSETS = [
    'index.html'
];

// 安裝階段：將靜態檔案緩存至本地端
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('正在快取靜態資源...');
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// 激活階段：清理舊版的快取
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((caches) => {
            return Promise.all(
                caches.keys().filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// 請求攔截：實作 Cache-First 策略
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // 如果快取中有該資源，直接回傳快取內容，不再請求網路
            if (response) {
                return response;
            }
            // 否則，嘗試從網路取得
            return fetch(event.request);
        })
    );
});
