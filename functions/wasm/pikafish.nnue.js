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
// Content-Length, so the in-app download progress works). The service
// worker caches the concatenated result, so it is downloaded once per
// device per engine version (same as before).
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
    // Dynamic reassembly: never CDN-cache (the client service worker is the
    // cache; an engine re-deploy must be visible immediately).
    'cache-control': 'no-store',
  });
  if (total > 0) headers.set('content-length', String(total));

  return new Response(body, { status: 200, headers });
}
