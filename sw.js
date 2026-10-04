/* Service Worker — offline PWA shell.
   NOTE: registers only over https or localhost (secure context). On a plain
   http LAN URL the game still runs fully; the SW simply won't activate.

   v4 (2026-10-04-b4) — engine re-shipped (search-bridge fixes: movetime
   semantics, stdout byte-sink capture, fflush; identical wasm binary,
   refreshed assets-embedded.js). Bump for cache refresh on update.

   v3 (2026-10-04-b3) — made offline play bulletproof:
   * Code assets: NETWORK-FIRST + cache fallback (a reload always gets the
     newest code — the b2-era cache-first strategy is exactly what kept
     serving a stale engine.js after the cannon rules fix).
   * Big assets (50MB NNUE net + 67MB embedded backup): CACHE-FIRST
     (content-immutable and huge; the embedded copy is what lets the app
     play the professional engine with NO server at all).
   * The `endsWith('./wasm/…')` matcher now compares against the URL
     PATHNAME (the old form never matched an absolute URL, so the net was
     silently treated as a small network-first asset).
   * A cache-name bump no longer bricks offline play: on activate we keep
     the most recent previous cache that can serve the shell as a backup
     (BACKUPS) and the fetch fallback chain is CACHE → BACKUPS. The backup
     is deleted only once the new cache is verified complete.
   * Big assets are pre-cached with retries, and any that are missing are
     re-fetched on every activate (self-heals an interrupted first install).
   */
const CACHE = 'xq-chess-v2-2026-10-04-b6';
const ASSETS = [
  './',
  './index.html',
  './engine.js',
  './engine-wasm.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  // Pikafish WASM engine (single-threaded build; ~0.6MB total)
  './wasm/pikafish-single.js',
  './wasm/pikafish-single.wasm'
];
/* 50MB NNUE net (web fetch path) + 67MB embedded all-in-one copy (the
   no-server path; also the automatic in-app fallback if the net file on the
   host is corrupt/missing, e.g. a Git-LFS pointer served instead of bytes).
   Both are content-immutable → cache-first. */
const BIG_ASSETS = [ './wasm/pikafish.nnue', './assets-embedded.js' ];

let BACKUPS = [];   // previous cache names, kept as offline fallback

function isBig(url) {
  let p;
  try { p = new URL(url, location.href).pathname; } catch (e) { p = url; }
  return BIG_ASSETS.some((a) => p.endsWith(a.replace(/^\.\//, '')));
}

function addRetry(cache, url, tries) {
  return cache.add(url).catch((e) => {
    if (tries > 1) {
      return new Promise((r) => setTimeout(r, 2000)).then(() => addRetry(cache, url, tries - 1));
    }
    console.warn('[sw] pre-cache failed:', url, e);
    return null;
  });
}

function ensureBig(cache) {
  // (re)fetch any big asset missing from the current cache — non-fatal.
  return Promise.all(BIG_ASSETS.map((u) =>
    cache.match(u, { ignoreSearch: true }).then((r) => r ? null : addRetry(cache, u, 2))
  ));
}

self.addEventListener('install', (event) => {
  // Small assets first, then activate ASAP so the new SW serves the app;
  // the two big downloads continue in the background (self-heal in activate).
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((u) => addRetry(cache, u, 2))))
      .then(() => self.skipWaiting())
      .then(() => self.clients.claim())
  );
  // Big pre-cache runs in the background on purpose: activation must not
  // wait on 117MB of downloads, or a slow connection would keep the old SW
  // (and its possibly-stale cache) in charge. ensureBig() re-runs on every
  // activate anyway, so nothing is left out in the cold.
  caches.open(CACHE).then((cache) => ensureBig(cache)).catch(() => {});
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1) prune old caches: keep the newest previous cache that can still
    //    serve the shell (offline backup); delete everything else.
    const keys = await caches.keys();
    const shellOk = [];
    for (const k of keys) {
      if (k === CACHE) continue;
      const c = await caches.open(k);
      const ok = await c.match('./index.html').then((r) => !!r && c.match('./engine.js').then((r2) => !!r2));
      if (ok) shellOk.push(k); else await caches.delete(k);
    }
    shellOk.sort();                       // names sort chronologically (date+letter)
    for (const k of shellOk.slice(0, -1)) await caches.delete(k);
    BACKUPS = shellOk.slice(-1);
    console.log('[sw] activated', CACHE, 'backup:', BACKUPS[0] || 'none');
    // 2) self-heal in the background: re-fetch any missing big asset
    //    (a no-op / fast fail when offline).
    ensureBig(await caches.open(CACHE));
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  const put = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
    }
    return res;
  };
  const chainMatch = () => {
    // current cache, then backup(s), newest first
    const order = [CACHE].concat(BACKUPS);
    const tryNext = (i) => i >= order.length
      ? Promise.resolve(new Response('offline and no cached copy', { status: 503 }))
      : caches.open(order[i]).then((c) => c.match(event.request, { ignoreSearch: true }))
        .then((r) => r || tryNext(i + 1)).catch(() => tryNext(i + 1));
    return tryNext(0);
  };
  event.respondWith(
    isBig(url)
      ? chainMatch().then((cached) =>
          cached ? cached : fetch(event.request).then(put)   // cache-first, fetch to warm
        )
      : fetch(event.request).then(put).catch(chainMatch)     // network-first, cache fallback
  );
});
