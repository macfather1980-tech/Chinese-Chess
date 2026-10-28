/* Service Worker — offline PWA shell.
   NOTE: registers only over https or localhost (secure context). On a plain
   http LAN URL the game still runs fully; the SW simply won't activate.

   v10 (2026-10-28-b13) — stop the 50MB net re-downloading on every ONLINE
   restart (seen on iPhones after iOS evicted the big Cache Storage entry):
   * The PAGE is now IndexedDB-mirror-first: after the one verified download
     the app reboots the engine from its persistent IndexedDB mirror, so an
     evicted SW cache entry no longer forces a 50MB re-download next launch.
   * The SW never downloads the net itself (ensureBig skips it): on iOS an
     evicted entry would otherwise trigger a 50MB background fetch on every
     launch. Instead the PAGE pushes the net bytes to the SW
     ({type:'xq-net-mirror', transferable ArrayBuffer}) once the engine boots
     verified, and the SW stores them in the cache — the cache self-heals
     with zero downloads. (The page pushes the EMBEDDED net too when it booted
     from that — a corrupted cached download gets replaced by the known-good
     bytes.)
   * (An earlier revision had the SW read the mirror from IndexedDB directly;
     on WebKit an indexedDB.open() from a service worker whose database is
     also open in a page hangs forever with no events — the page-push design
     replaced it.)

   v8 (2026-10-27-b11) — iOS Home Screen app "white chin" fix
   (index.html only, no SW logic changes): WebKit bug 254868 — in
   installed web apps height:100%/svh/dvh/visualViewport all report
   the screen minus the home-indicator safe area, leaving a white
   strip below the app. The shell is now min-height:100vh (+ px-level
   bleedFix backup + a full-bleed #bleed ring), which makes the page
   paint that strip and the layout viewport grow to the full window
   (bug 210009). This cache-name bump makes the fixed index.html part
   of the offline cache from the first online load, and the menu's
   offline-layer readout shows b11 so users can verify the update.

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
const CACHE = 'xq-chess-v2-2026-10-28-b13';
const SW_VER = String(CACHE).replace(/^xq-chess-v2-/, '');   // shown in the app menu
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

/* True for the 50MB NNUE net. The SW never DOWNLOADS it on its own (v10):
   the page's IndexedDB mirror is its offline layer, and the page pushes the
   bytes back to this cache after the engine boots (xq-net-mirror). */
function isNet(u) {
  try { return new URL(u, location.href).pathname.endsWith('wasm/pikafish.nnue'); }
  catch (e) { return String(u).indexOf('pikafish.nnue') >= 0; }
}

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
  // (re)populate any big asset missing from the current cache — non-fatal.
  // Adopt from the backup cache first (free). The 67MB embedded backup then
  // downloads if absent. The 50MB net is deliberately NOT downloaded here
  // (v10): the page's IndexedDB mirror is its offline layer, and the page
  // pushes the net to this cache after the engine boots — downloading here
  // would re-fetch 50MB in the background after every iOS cache eviction.
  return Promise.all(BIG_ASSETS.map((u) =>
    cache.match(u, { ignoreSearch: true }).then((r) => {
      if (r && usable(r, u)) return null;
      return backupMatch(u).then((b) => {
        if (b) return cache.put(u, toCacheable(b.clone()));
        if (isNet(u)) return null;   // page-push keeps the net warm (v10)
        return downloadBig(u, 2).then((res) =>
          res ? (bigPut[bigKey(u)] || Promise.resolve()) : null);
      });
    })
  ));
}

self.addEventListener('install', (event) => {
  // Small assets first, then activate ASAP so the new SW serves the app;
  // big work continues in the background (self-heal in activate).
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((u) => addRetry(cache, u, 2))))
      .then(() => self.skipWaiting())
      .then(() => self.clients.claim())
  );
  // Big pre-cache runs in the background on purpose: activation must not
  // wait on downloads, or a slow connection would keep the old SW (and its
  // possibly-stale cache) in charge. ensureBig() re-runs on every activate
  // anyway, so nothing is left out in the cold.
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
    // Tell open clients which SW version is in charge (shown in the app menu —
    // so the user can verify the offline layer actually updated).
    self.clients.matchAll().forEach((c) => {
      try { c.postMessage({ type: 'xq-sw', ver: SW_VER }); } catch (e) { /* noop */ }
    });
    // 2) self-heal big assets in the background (adopt-from-backup; the net
    //    is page-push kept warm, see v10). Deliberately NOT awaited —
    //    activation must stay quick. Once the new cache is complete, prune
    //    the backup (a 50MB entry must not live in two caches forever).
    //    The 8s grace lets the page's net push land before the completeness
    //    check decides the backup's fate.
    ensureBig(await caches.open(CACHE)).then(() => new Promise((r) => setTimeout(r, 8000))).then(async () => {
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

self.addEventListener('message', (event) => {
  try {
    // The app pings when its menu opens (in case the activate broadcast was
    // missed because the page script started later).
    if (event.data && event.data.type === 'xq-ping' && event.source) {
      event.source.postMessage({ type: 'xq-sw', ver: SW_VER });
    }
    // The page pushes the 50MB net (its verified bytes: the IndexedDB mirror
    // or a fresh download, or the embedded copy) as a TRANSFERABLE ArrayBuffer
    // after the engine boots — the SW stores it so the cache self-heals with
    // zero downloads (v10). The transfer detaches the page's buffer; the page
    // is done with it (the engine worker keeps its own copy).
    if (event.data && event.data.type === 'xq-net-mirror') {
      const b = event.data.bytes;
      if (b && b.byteLength > 1000) {
        const url = new URL('wasm/pikafish.nnue', self.location.href).href;
        caches.open(CACHE)
          .then((c) => c.put(url, toCacheable(new Response(b, { headers: { 'content-type': 'application/octet-stream' } }))))
          .catch((e) => console.warn('[sw] net mirror put failed:', e));
      }
    }
  } catch (e) { /* noop */ }
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
