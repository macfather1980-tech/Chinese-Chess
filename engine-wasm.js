/* =====================================================================
 *  XQ — Pikafish WASM engine (worker side)
 *
 *  Runs the official Pikafish xiangqi engine (compiled to WebAssembly,
 *  single-threaded build) inside a Web Worker. The main thread creates
 *  this worker from a blob that contains this file's source, so ALL
 *  binary assets (module JS, .wasm, NNUE net) are fetched by the main
 *  thread and transferred in via postMessage — this keeps the worker
 *  independent of blob-URL relative fetches.
 *
 *  Licensing: Pikafish is GPL-3.0. See wasm/README-wasm.md.
 *
 *  Protocol (main -> worker):
 *    {type:'init', js: ArrayBuffer, wasm: ArrayBuffer, net: ArrayBuffer,
 *     hashMB: number}
 *    {type:'search', reqId, str, hist: [uci...], opt}
 *      str  = app position string (90 chars + ' r'/' b')
 *      hist = the game's move list in UCI-XQ form (for startpos replay)
 *
 *  Protocol (worker -> main):
 *    {type:'status', reqId?, phase: 'loading'|'ready'|'failed', msg?, ok?}
 *    {type:'done',   reqId, move: uciString, mate?, cp?, depth?, nodes?,
 *                    nps?, timeMs?, noMoves?, err?}
 *
 *  Coordinate mapping (app board <-> UCI-XQ):
 *    app index = row*9+col, row 0..9 top->bottom, col 0..8 left->right
 *    UCI: file letter 'a'..'i' = col, rank digit = 9-row
 *    FEN: piece letters map 1:1 (K A E H R C P = red, lowercase = black)
 * ===================================================================== */
(function () {
'use strict';

var START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
// verified movegen signature (matches native Pikafish + public references)
var SELFTEST = { fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1', depth: 3, expect: 79666 };

var module_ = null;
self.phase = 'init';
var curFen = START_FEN;
var cc = null;          // Module.ccall, bound after init
var infoBuf = [];       // 'info ...' lines captured during the current search

function post(o) { try { self.postMessage(o); } catch (e) { /* buffer full? ignore */ } }

function setPhase(phase, msg) {
  self.phase = phase;
  post({ type: 'status', phase: phase, msg: msg || '' });
}

/* ---------- app position string <-> xiangqi FEN / UCI moves ---------- */

// App board-string letters -> xiangqi FEN letters.
// App: K general, A advisor, E elephant, H horse, R rook, C cannon, P pawn;
// uppercase = red, lowercase = black. FEN: k a b(elephant) n(horse) r c p;
// uppercase = red ('w'), lowercase = black. App row 0 = rank 9 = FEN row 0.
var FCH = { K: 'K', A: 'A', E: 'B', H: 'N', R: 'R', C: 'C', P: 'P',
            k: 'k', a: 'a', e: 'b', h: 'n', r: 'r', c: 'c', p: 'p' };

function appToFen(str) {
  var rows = [], r, c;
  for (r = 0; r < 10; r++) {
    var row = '', empty = 0;
    for (c = 0; c < 9; c++) {
      var ch = str[r * 9 + c];
      if (ch === '.' || ch === '0') { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += FCH[ch] || '.';
    }
    if (empty) row += empty;
    rows.push(row);
  }
  var side = str[91] === 'b' ? 'b' : 'w';
  return rows.join('/') + ' ' + side + ' - - 0 1';
}

function appMoveToUci(m) {
  var from = m & 127, to = m >> 7;
  return 'abcdefghi'.charAt(from % 9) + (9 - (from / 9 | 0)) +
         'abcdefghi'.charAt(to % 9) + (9 - (to / 9 | 0));
}

function uciToAppMove(uci) {
  if (!uci || uci.length < 4) return -1;
  var from = (9 - (uci.charCodeAt(1) - 48)) * 9 + (uci.charCodeAt(0) - 97);
  var to   = (9 - (uci.charCodeAt(3) - 48)) * 9 + (uci.charCodeAt(2) - 97);
  return from | (to << 7);
}

/* ---------- stdout: capture engine progress lines ---------- */

function onOut(line) {
  line = line.replace(/\s+$/, '');
  if (!line) return;
  if (line.charAt(0) === 'i' && line.indexOf('info') === 0) infoBuf.push(line);
}

/* Emscripten calls the Module `stdout` sink with ONE BYTE per call (it
   replaces /dev/stdout with a device whose write() loops over the buffer).
   We re-assemble bytes into UTF-8 text and hand complete lines to onOut().
   This build's glue ignores an `out:` option, so this is the only reliable
   way to receive the engine's "info depth=…" lines in every environment. */
var _pending = 0;   // current UTF-8 sequence length (0 = none)
var _pendingCode = 0;
var _line = [];
var _stdoutBytes = 0;
function onStdoutByte(b) {
  _stdoutBytes++;
  if (b === 10 || b === 0) {
    if (_line.length) onOut(decodeUtf8Chunk());
    _line.length = 0;
    return;
  }
  if (!b) return;
  if (_pending === 0) {
    if (b < 0x80) _line.push(b);
    else if (b < 0xE0) { _pending = 1; _pendingCode = b & 0x1F; }
    else if (b < 0xF0) { _pending = 2; _pendingCode = b & 0x0F; }
    else if (b < 0xF8) { _pending = 3; _pendingCode = b & 0x07; }
  } else if (b >= 0x80 && b < 0xC0) {
    _pendingCode = (_pendingCode << 6) | (b & 0x3F);
    if (--_pending === 0) _line.push(_pendingCode);
  } else { _pending = 0; onStdoutByte(b); }  // invalid sequence: drop, retry
}
function decodeUtf8Chunk() {
  var s = '';
  for (var i = 0; i < _line.length; i++) s += String.fromCharCode(_line[i]);
  try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(_line)); } catch (e) { return s; }
}

function lastInfo() {
  if (!infoBuf.length) return null;
  var l = infoBuf[infoBuf.length - 1];
  var o = { line: l };
  var m;
  if ((m = l.match(/depth=(-?\d+)/))) o.depth = +m[1];
  if ((m = l.match(/mate=(-?\d+)/))) o.mate = +m[1];
  else if ((m = l.match(/cp=(-?\d+)/))) o.cp = +m[1];
  if ((m = l.match(/nodes=(\d+)/))) o.nodes = +m[1];
  if ((m = l.match(/nps=(\d+)/))) o.nps = +m[1];
  if ((m = l.match(/time=(\d+)/))) o.timeMs = +m[1];
  return o;
}

/* ---------- module boot ---------- */

function boot(jsBytes, wasmBytes, netBytes, hashMB) {
  setPhase('loading', 'compiling module');
  var jsText = new TextDecoder('utf-8').decode(jsBytes);
  // The emscripten factory (createPikafish) is defined by the module source.
  (0, eval)(jsText + '\n;self.__XQ_PK_FACTORY = createPikafish;');
  if (!self.__XQ_PK_FACTORY) { setPhase('failed', 'module factory missing'); return; }

  self.__XQ_PK_FACTORY({
    wasmBinary: wasmBytes,
    /* This emscripten build's instantiateAsync() ignores a provided
       wasmBinary and re-reads the .wasm *file* via sync XHR — which only
       works when a server is reachable from the blob-URL worker. On file://
       (the no-server path) that XHR always fails. The supported
       instantiateWasm override below makes the provided buffer authoritative
       in every environment (also skips a redundant 540KB re-download). */
    instantiateWasm: function (info, cb) {
      WebAssembly.instantiate(wasmBytes, info)
        .then(function (r) { cb(r.instance); })
        .catch(function (e) { setPhase('failed', 'wasm instantiate: ' + String((e && e.message) || e)); });
    },
    /* This build's glue ignores an `out:` option. The `stdout` byte sink is
       the reliable capture path (emscripten replaces /dev/stdout with a
       device that calls it per byte); `print` is a fallback for paths that
       route via the console sink. Diagnostics (stderr) go to console —
       invisible to users, useful when debugging a failed boot. */
    stdout: onStdoutByte,
    print: onOut,
    printErr: function (l) { try { console.log(String(l)); } catch (e) {} }
  }).then(function (M) {
    module_ = M;
    try { M.callMain([]); } catch (e) { /* main() is a no-op marker */ }
    cc = M.ccall;

    setPhase('loading', 'loading evaluation net (61MB)');
    M.FS.writeFile('/pikafish.nnue', netBytes);

    var t0 = Date.now();
    var rc = cc('wmain_init', 'number', ['string', 'number', 'number'],
                ['/pikafish.nnue', hashMB || 32, 1]);
    if (rc !== 0) { setPhase('failed', 'wmain_init rc=' + rc); return; }

    // Movegen self-check: perft of the standard position must match the
    // native engine exactly. Catches any future build/patch regression.
    // NOTE: wmain_perft is i64 (unsigned long long) → ccall can return a
    // BigInt; compare numerically so the self-check works in every runtime.
    var n = cc('wmain_perft', 'number', ['string', 'number'], [SELFTEST.fen, SELFTEST.depth]);
    if (typeof n === 'bigint') n = Number(n);
    if (n !== SELFTEST.expect) {
      setPhase('failed', 'movegen self-check failed: perft(' + SELFTEST.depth + ')=' + n +
                         ' expected ' + SELFTEST.expect);
      return;
    }

    setPhase('ready', 'pikafish ready in ' + (Date.now() - t0) + 'ms');
  }).catch(function (e) {
    setPhase('failed', String((e && e.message) || e));
  });
}

/* ---------- search ---------- */

function doSearch(d) {
  var hist = d.hist || [];
  /* The position is loaded as standard placement + move replay: the engine
     rejects direct FENs whose pawns/bishops sit on NNUE-invalid squares
     (e.g. a pawn that crossed to an even file), but the make-move path does
     not — so any position reached by real play loads this way. */
  var sideAfter = (hist.length % 2 === 0) ? 'w' : 'b';
  var sideWant = d.str[91] === 'b' ? 'b' : 'w';
  if (sideAfter !== sideWant) {
    post({ type: 'done', reqId: d.reqId, move: '', err: 'desync' });
    return;
  }
  curFen = appToFen(d.str);
  var pr = cc('wmain_position_moves', 'number', ['string', 'string'], [START_FEN, hist.join(' ')]);
  if (pr !== 1) {
    post({ type: 'done', reqId: d.reqId, move: '', err: 'set' });
    return;
  }
  infoBuf.length = 0;
  var t0 = Date.now();
  cc('wmain_go', 'number', ['number', 'number'], [d.opt.timeMs | 0, d.opt.maxDepth | 0]);
  var elapsed = Date.now() - t0;

  var uci = '';
  if (module_._malloc && module_.UTF8ToString) {
    // Newer emscripten builds export _malloc/UTF8ToString: read the move via
    // an allocated buffer (ccall 'string' args no longer accept ArrayBuffers).
    var p = module_._malloc(32);
    var ok = cc('wmain_bestmove', 'number', ['number', 'number'], [p, 32]);
    if (ok) uci = module_.UTF8ToString(p);
    module_._free(p);
  } else {
    var buf = new ArrayBuffer(32);
    var ok2 = cc('wmain_bestmove', 'number', ['string', 'number'], [buf, 32]);
    if (ok2) uci = new TextDecoder('utf-8').decode(new Uint8Array(buf, 0, 31)).replace(/\0.*$/, '');
  }

  var inf = lastInfo();
  var out = { type: 'done', reqId: d.reqId, move: uci || '', timeMs: elapsed };
  if (inf && inf.timeMs != null) out.engineTime = inf.timeMs;
  if (globalThis.__XQ_DBG) out._dbg = { bytes: _stdoutBytes, infoLines: infoBuf.length };
  if (!uci) out.noMoves = true;
  if (inf) {
    if (inf.depth != null) out.depth = inf.depth;
    if (inf.nodes != null) out.nodes = inf.nodes;
    if (inf.nps != null) out.nps = inf.nps;
    if (inf.mate != null) out.mate = inf.mate;
    else if (inf.cp != null) out.cp = inf.cp;
  }
  post(out);
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type === 'init') {
    if (self.phase === 'init' && d.js && d.wasm && d.net) {
      boot(new Uint8Array(d.js), new Uint8Array(d.wasm), new Uint8Array(d.net), d.hashMB);
    }
    return;
  }
  if (d.type === 'search') {
    if (self.phase !== 'ready' || !cc) {
      post({ type: 'done', reqId: d.reqId, move: '', noMoves: true, err: 'engine not ready' });
      return;
    }
    doSearch(d);
  }
};

post({ type: 'status', phase: self.phase });

})();
