# Pikafish WASM engine (Chinese Chess V2)

This folder contains the **official Pikafish** xiangqi engine (the strongest
open-source Chinese chess engine) compiled to **WebAssembly**, plus the 50MB
NNUE evaluation network. The app uses it automatically when available and
falls back to the built-in JavaScript engine (`engine.js`) otherwise.

## Contents

| File | What |
|---|---|
| `pikafish-single.js` / `.wasm` | Emscripten build of Pikafish (single-threaded, SSE128 NNUE). ~0.6MB. |
| `pikafish.nnue` | Official master net (50MB compressed / 61MB unpacked). Downloaded once, then cached. |
| `single-thread-wasm.patch` | Patch applied to upstream Pikafish: (1) make `Thread`/`NativeThread` no-ops on non-pthread emscripten (`thread.cpp`, `thread_native.h`); (2) value-init `SearchManager` (`search.h`); (3) a defensive static-storage hard time guard in `check_time` (`search.cpp`, WASM-only); (4) add `src/wasm_main.cpp` — an exported C API (`wmain_init/position/go/bestmove/…`) replacing UCI stdin/stdout, with a movegen self-check. |

## Licensing

Pikafish is **GPL-3.0** (see `Copying.txt` in the upstream repo). The patch
and `wasm_main.cpp` are therefore also GPL-3.0. The rest of this app
(`engine.js`, `index.html`, …) is unchanged and carries its own terms.

Upstream: https://github.com/official-pikafish/Pikafish
Pinned commit: `1c66b9b21cf2f280ce3b3ffa80c1c6609f2b29ff`
Net: https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue

## Verified

* `perft` of the standard position matches the **native** Pikafish binary and
  the public reference (44 / 1,920 / 79,666 / 3,290,240 / 133,312,995).
  The worker re-runs a perft(3) self-check after loading and refuses to
  activate if it doesn't match (the app then stays on the JS engine).
* Search returns sane, strong moves (NNUE eval, iterative deepening, TT).

## Bridge fixes (2026-10-04, `wasm_main.cpp`)

Three bugs that made `wmain_go` abort in the WASM build (the identical native
code ran fine) were found and fixed:

1. **Static-table init order** — the Engine constructor sets up the starting
   position, which consults the magic-attack tables; those must be
   initialised *before* the Engine is created (as `main.cpp` does for the UCI
   build). On native the uninitialised tables segfault; in WASM address 0 is
   silently readable, so the bug only surfaced later during search.
2. **Unregistered update callbacks** — the search manager *copies* the engine's
   `UpdateContext` when threads are resized, so every callback
   (`on_start`, `on_iter`, `on_update_no_moves`, …) must be registered
   **before** the `Threads`/`Hash` options are applied; an empty
   `std::function` throws `std::bad_function_call` at search start, which
   aborts the module under `-fno-exceptions`.
3. **Uninitialised `LimitsType.startTime`** — the UCI `go` parser sets
   `limits.startTime = now()`; the C bridge must do the same, otherwise time
   management compares against garbage and the search never stops.

The build also exports `_malloc`/`_free`/`UTF8ToString` so the worker can
read result strings (newer Emscripten `ccall` no longer accepts
ArrayBuffers as `'string'` arguments).

## Search-bridge fixes (2026-10-04, `wmain_go` / `engine-wasm.js`)

A second round of fixes made `wmain_go(timeMs)` actually *honour the
budget* and *report progress* in the Web app:

1. **`movetime` instead of `time[]`** — the app asks for "think for N ms",
   but the bridge originally filled `limits.time[...]`, which
   `TimeManagement::init` interprets as a *game clock over ~50 moves* and
   scales down to a few % of N ms. `wmain_go` now sets
   `limits.movetime = timeMs` (a direct stop) and
   `limits.startTime = now()`.
2. **`fflush(stdout)`** — the C library fully buffers non-tty stdout, so a
   short search never emitted its `info` lines. `wmain_go` flushes after
   the search.
3. **Byte-sink stdout capture (`engine-wasm.js`)** — this emscripten glue
   ignores the `out:` option and calls the `Module["stdout"]` sink **one
   byte per call** (a `{write: fn}` object is silently never called). The
   worker re-assembles bytes into UTF-8 lines, so `info`/`bestmove`
   progress is captured in every environment.

Also kept: a cheap *hard time guard* — `wmain_go` records its budget in
**static** storage (`g_goStart`/`g_goBudget`) and `SearchManager::check_time`
enforces it as a backstop (WASM builds only; see the patch). Investigation
traced the suspected SearchManager heap corruption to test-harness
artifacts (overlapping search dispatches in a node script) — an ASan build
found no memory errors — so the guard is insurance, not a workaround for a
known clobber.

### Verified (node, worker-like env, current build)

* perft(3) self-check on load: 79,666 (matches native).
* Time honoured to the millisecond: budget 100/1000/5000 ms → actual
  101/1000/5001 ms (ratio 1.00), depths 15/22/27, `info` lines fully
  delivered (16/23/28 lines) in every run.
* The engine clock is `performance.now()` (WASI `clock_time_get` → musl
  `clock_gettime` → `_emscripten_get_now`), i.e. real time; the earlier
  "variable-rate clock" readings were an artifact of dispatching several
  searches in the same event-loop tick.
* App↔engine pipeline: 8/8 checks (positions, mate, self-play, timing).

## Rebuilding

```sh
brew install emscripten   # one time
./build-wasm.sh
```

This re-fetches upstream at the pinned commit, applies
`wasm/single-thread-wasm.patch`, compiles with `em++`, and (re)installs the
artifacts into `wasm/`. Afterwards run `python3 build-assets.py` to
regenerate `assets-embedded.js`, and bump the `CACHE` name in `sw.js` after
replacing artifacts so the service worker picks them up.

## Playing (no server needed)

* **Anywhere, offline:** double-click `index.html` (or open it from the
  Files app on an iPhone). The app detects `file://`, loads
  `assets-embedded.js` (base64 of all four engine assets) via a script tag,
  decodes it and runs the full Pikafish engine — zero fetches, zero server.
  Status bar shows **⚡Pikafish(內置)**.
* **GitHub Pages PWA:** push all files, open the link in Safari, add to the
  Home Screen. First visit downloads the 50MB net (progress shown as
  “⚡下載中 …%”), then the service worker serves everything offline.
  If the 50MB file on the host is ever corrupt/missing (e.g. a Git-LFS
  pointer), the app transparently falls back to the embedded copy.
* **`python3 serve.py`** is now optional (LAN play / quick iteration).

Notes:

* The engine runs in a Web Worker; single-threaded builds need no special
  headers. A future multithreaded (`-pthread`) build would additionally
  require the COOP/COEP headers (`serve.py` already sends them).
* 64-bit WebAssembly SIMD128 requires Safari 16.4+ (iPhone 11 or newer on a
  recent iOS). Older browsers get the automatic JS-engine fallback.
* Memory: 64MB base + 61MB net + 32MB hash ≈ 160MB in the worker — fine on
  modern iPhones. The embedded path adds ~68MB of base64 text in the page
  plus the decoded 50MB buffer — still fine on modern phones; if you ever
  target very old devices, keep the file:// option in mind as a trade-off.
