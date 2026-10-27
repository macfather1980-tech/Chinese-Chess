// Cloudflare Pages function: serves /wasm/pikafish.nnue (the 47.7 MiB
// Pikafish NNUE network) by streaming its split parts in order.
//
// Why: Cloudflare enforces a 25 MiB per-file limit, so the full network file
// is excluded from the Cloudflare build (see the Pages build command in
// wrangler/build config + README). It is shipped as 19 MiB parts:
//   wasm/pikafish.nnue.part-1 … part-N   (N in wasm/pikafish.nnue.parts)
//
// The game code is UNCHANGED: it still fetches `wasm/pikafish.nnue`; this
// function reassembles the parts into one byte stream (with a correct
// Content-Length, so the in-app download progress works). Offline layers
// for the result: (1) the client service worker cache (sw.js stores it as
// immutable), (2) the browser HTTP cache via the stale-iferror policy above,
// (3) the app's IndexedDB mirror (index.html). Downloaded once per device
// per engine version.
// NOTE: the parts themselves keep `max-age=0, must-revalidate` (default) so
// a new engine deploy reassembles fresh bytes on the very next request.
//
// GitHub Pages ignores this file (it only serves static assets), so the
// existing Pages link keeps fetching the full file directly.
// NOTE: must be a NAMED export (not `export default`) — the Pages Functions
// route scanner only registers files that export `onRequest*` by name.
export async function onRequest(context) {
  const origin = new URL(context.request.url).origin;

  // Part count lives in a tiny text file so re-building the engine only
  // requires regenerating the parts (the count file is regenerated too).
  const manifest = await fetch(origin + '/wasm/pikafish.nnue.parts');
  if (!manifest.ok) {
    return new Response('nnue parts manifest missing', { status: 502 });
  }
  const count = parseInt((await manifest.text()).trim(), 10);
  if (!Number.isInteger(count) || count < 1 || count > 64) {
    return new Response('bad nnue parts count: ' + count, { status: 502 });
  }

  // Fetch all part responses first (headers carry content-length) so we can
  // advertise the exact total size, then pipe the bodies through in order.
  const parts = [];
  let total = 0;
  for (let i = 1; i <= count; i++) {
    const r = await fetch(origin + '/wasm/pikafish.nnue.part-' + i);
    if (!r.ok) {
      return new Response('nnue part ' + i + ' missing (HTTP ' + r.status + ')', { status: 502 });
    }
    const cl = r.headers.get('content-length');
    if (cl) total += Number(cl);
    parts.push(r);
  }

  const body = new ReadableStream({
    async start(controller) {
      try {
        for (const r of parts) {
          for await (const chunk of r.body) controller.enqueue(chunk);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      for (const r of parts) {
        try { if (r.body) r.body.cancel(); } catch (_) { /* noop */ }
      }
    },
  });

  const headers = new Headers({
    'content-type': 'application/octet-stream',
    // Cache policy (v7, 2026-10-27): revalidate on EVERY online request
    // (max-age=0 — a fresh engine deploy is visible immediately), but keep
    // the stored copy usable when revalidation cannot run (offline):
    // stale-if-error lets the browser HTTP cache serve the stale 50MB as a
    // backstop for loads the service worker does not intercept (iOS evicts
    // big Cache API entries, and a SW-served response never reaches the
    // HTTP cache). The SW itself re-stores responses as immutable (sw.js).
    'cache-control': 'public, max-age=0, stale-while-revalidate=604800, stale-if-error=31536000',
  });
  if (total > 0) headers.set('content-length', String(total));

  return new Response(body, { status: 200, headers });
}
