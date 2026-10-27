/* Service Worker — offline PWA shell.
   NOTE: registers only over https or localhost (secure context). On a plain
   http LAN URL the game still runs fully; the SW simply won't activate.

   v7 (2026-10-27-b10) — fixed "⚠ JS備用 offline after a SW version bump"
   (seen on iPhone: the 50MB net was gone from the SW cache):
   * Every cached response is stored with `max-age=31536000, immutable`.
     v6's normalizer DELETED Cache-Control before put(); an entry without a
     usable lifetime expires best-effort in WebKit (iOS) — the net (and the
     shell) vanished within hours. Everything we cache is content-immutable;
     the cache-NAME bump is the one freshness lever.
   * Big downloads are deduplicated (one in-flight promise): a version-bump
     load triggers exactly ONE 50MB download, not two (app fetch + pre-cache).
   * A server that returns HTML for a non-HTML asset (Cloudflare serves
     index.html with 200 for missing files — e.g. assets-embedded.js, which
     is excluded from the Cloudflare build) is never cached nor served:
     such junk is skipped both on store and on cache/backup lookup.
   * On activate, big assets missing from the new cache are first ADOPTED
     from the kept backup cache (a cache-name bump must not force a 50MB
     re-download); only then is the network used. Once the new cache is
     verified complete the backup is pruned (bounds disk use across bumps).
   * The app additionally mirrors the 50MB net into IndexedDB after a
     successful download (see index.html) — a second offline layer that
     survives iOS Cache API eviction.

   v6 (2026-10-27-b9) — fixed OFFLINE engine play on Cloudflare:
   * The Cloudflare reassembly function tagged the 50MB net with `no-store`;
     the Cache API silently refuses to store no-store responses, so the net
     was never entering the SW cache. put() normalizes headers before cache.
   * Big assets on a cache MISS fall through to the network instead of
     returning the 503 placeholder (fresh installs could not download).

   v5 (2026-10-05-b8) — engine-wasm.js re-shipped (live "info" progress
   stream so the UI shows the AI thinking in real time); refreshed
   assets-embedded.js accordingly. Bump for cache refresh on update.

   v3 (2026-10-04-b3) — offline play design (still in force):
   * Code assets: NETWORK-FIRST + cache fallback (a reload always gets the
     newest code).
   * Big assets (50MB NNUE net + 67MB embedded backup): CACHE-FIRST
     (content-immutable and huge).
   * A cache-name bump no longer bricks offline play: on activate the newest
     previous cache that can serve the shell is kept as a BACKUP; the fetch
     fallback chain is CACHE → BACKUPS → (for big) network.
   */
const CACHE = 'xq-chess-v2-2026-10-27-b10';
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
   no-server path; also the in-app fallback if the net file on the host is
   corrupt/missing). Both are content-immutable → cache-first. */
const BIG_ASSETS = [ './wasm/pikafish.nnue', './assets-embedded.js' ];

let BACKUPS = [];   // previous cache names, kept as offline fallback

function isBig(url) {
  let p;
  try { p = new URL(url, location.href).pathname; } catch (e) { p = url; }
  return BIG_ASSETS.some((a) => p.endsWith(a.replace(/^\.\//, '')));
}

/* Store cached responses with a long, explicit lifetime. A response with a
   useless/absent Cache-Control expires best-effort in the Cache API — WebKit
   (iOS) evicts those fast, which is how the 50MB net was lost. Everything we
   cache is content-immutable (code updates land via the cache-name bump), so
   `immutable` is always safe here. Callers must pass a disposable/clone. */
function toCacheable(res) {
  const h = new Headers(res.headers);
  h.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(res.body, { status: res.status, headers: h });
}

function bigKey(u) {
  try { return new URL(u, location.href).href.replace(/\?.*$/, ''); }
  catch (e) { return String(u); }
}

/* One in-flight download per big asset, shared between the pre-cache and the
   fetch handler, so a page load never triggers two 50MB downloads. */
const bigInFlight = {};
const bigPut = {};   // pending cache-put promises, keyed like bigInFlight
function downloadBig(u, tries) {
  const key = bigKey(u);
  if (!bigInFlight[key]) {
    bigInFlight[key] = doFetchBig(u, tries || 2)
      .catch((e) => { console.warn('[sw] big download failed:', key, e); return null; })
      .then((r) => { bigInFlight[key] = null; return r; });
  }
  return bigInFlight[key];
}
function doFetchBig(u, tries) {
  return fetch(u).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u);
    if (!usable(r, u)) {
      // 404-as-200 html is deterministic (a retry will get the same junk);
      // mark fatal so pre-caching does not sit out retry delays on it.
      const e = new Error('not a real asset response for ' + u);
      e.fatal = true;
      throw e;
    }
    // Store a copy with a long lifetime. The response is returned WITHOUT
    // waiting for the 50MB serialization to finish (the app must not stall),
    // but the put promise is remembered so pre-caching can wait on it.
    bigPut[bigKey(u)] = caches.open(CACHE)
      .then((c) => c.put(u, toCacheable(r.clone())))
      .catch((e) => console.warn('[sw] cache put failed:', u, e))
      .then(() => { bigPut[bigKey(u)] = null; });
    return r;
  }).catch((e) => {
    if (tries > 1 && !e.fatal) return new Promise((res) => setTimeout(res, 2000)).then(() => doFetchBig(u, tries - 1));
    throw e;
  });
}

/* Reject responses that are not what the URL asks for. Cloudflare Pages
   serves index.html (200, text/html) for any missing path — v6 cached that
   junk as assets-embedded.js. (Documents like '/' are html legitimately.) */
function usable(r, u) {
  if (!r || !(r.status >= 200 && r.status < 300)) return false;
  let p;
  try { p = new URL(u, location.href).pathname; } catch (e) { p = String(u); }
  const looksLikeAsset = /\.(js|mjs|wasm|nnue|json|css|png|jpe?g|svg|webp|gif|woff2?)(\?|$)/i.test(u)
    || /\.(js|mjs|wasm|nnue|json|css|png|jpe?g|svg|webp|gif|woff2?)$/i.test(p);
  if (looksLikeAsset) {
    const ct = (r.headers.get('content-type') || '');
    if (/html/i.test(ct)) return false;
  }
  return true;
}

function addRetry(cache, u, tries) {
  if (isBig(u)) return downloadBig(u, tries);
  return fetch(u).then((r) => {
    if (!r.ok) throw new Error('bad status for ' + u);
    return cache.put(u, toCacheable(r.clone()));
  }).catch((e) => {
    if (tries > 1) {
      return new Promise((r) => setTimeout(r, 2000)).then(() => addRetry(cache, u, tries - 1));
    }
    console.warn('[sw] pre-cache failed:', u, e);
    return null;
  });
}

function backupMatch(u) {
  const t = (i) => i >= BACKUPS.length
    ? Promise.resolve(null)
    : caches.open(BACKUPS[i]).then((c) => c.match(u, { ignoreSearch: true }))
        .then((r) => (r && usable(r, u)) ? r : t(i + 1)).catch(() => t(i + 1));
  return t(0);
}

function ensureBig(cache) {
  // (re)fetch any big asset missing from the current cache — non-fatal.
  // Adopt from the backup cache first (free), download second. Awaits the
  // cache put (bigPut) so callers know the entry has really landed.
  return Promise.all(BIG_ASSETS.map((u) =>
    cache.match(u, { ignoreSearch: true }).then((r) => {
      if (r && usable(r, u)) return null;
      return backupMatch(u).then((b) => {
        if (b) return cache.put(u, toCacheable(b.clone()));
        return downloadBig(u, 2).then((res) =>
          res ? (bigPut[bigKey(u)] || Promise.resolve()) : null);
      });
    })
  ));
}

self.addEventListener('install', (event) => {
  // Small assets first, then activate ASAP so the new SW serves the app;
  // big downloads continue in the background (self-heal in activate).
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((u) => addRetry(cache, u, 2))))
      .then(() => self.skipWaiting())
      .then(() => self.clients.claim())
  );
  // Big pre-cache runs in the background on purpose: activation must not
  // wait on 50MB of downloads, or a slow connection would keep the old SW
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
      const ok = (await c.match('./index.html')) && (await c.match('./engine.js'));
      if (ok) shellOk.push(k); else await caches.delete(k);
    }
    shellOk.sort();                       // names sort chronologically (date+letter)
    for (const k of shellOk.slice(0, -1)) await caches.delete(k);
    BACKUPS = shellOk.slice(-1);
    console.log('[sw] activated', CACHE, 'backup:', BACKUPS[0] || 'none');
    // 2) self-heal big assets in the background (adopt-from-backup, else
    //    download). Deliberately NOT awaited — activation must stay quick.
    //    Once the new cache is complete, prune the backup (a 50MB entry
    //    must not live in two caches forever).
    ensureBig(await caches.open(CACHE)).then(async () => {
      const c = await caches.open(CACHE);
      const complete = (await c.match('./index.html')) && (await c.match('./engine.js'))
        && (await c.match('./wasm/pikafish.nnue', { ignoreSearch: true }));
      if (complete && BACKUPS.length) {
        await caches.delete(BACKUPS[0]);
        BACKUPS = [];
        console.log('[sw] new cache complete; backup pruned');
      }
    }).catch(() => {});
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  const put = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = toCacheable(res.clone());
      caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
    }
    return res;
  };
  const chainMatch = () => {
    // current cache, then backup(s), newest first; junk entries are skipped
    const order = [CACHE].concat(BACKUPS);
    const tryNext = (i) => i >= order.length
      ? Promise.resolve(new Response('offline and no cached copy', { status: 503 }))
      : caches.open(order[i]).then((c) => c.match(event.request, { ignoreSearch: true }))
        .then((r) => (r && usable(r, url)) ? r : tryNext(i + 1)).catch(() => tryNext(i + 1));
    return tryNext(0);
  };
  event.respondWith(
    isBig(url)
      ? chainMatch().then((cached) =>
          // cache-first; on a miss fall through to the (deduped) network
          // download, and only if THAT fails (offline) serve the 503.
          // (downloadBig resolves null on failure — never return that.)
          (cached && cached.ok) ? cached
          : downloadBig(url, 2).then((res) =>
            (res && res.ok) ? res
            : (cached ? cached : new Response('offline and no cached copy', { status: 503 })))
        )
      : fetch(event.request).then(put).catch(chainMatch)     // network-first, cache fallback
  );
});
