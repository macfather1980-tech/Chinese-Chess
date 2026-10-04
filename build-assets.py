#!/usr/bin/env python3
"""
build-assets.py — package every engine asset as base64 into assets-embedded.js

WHY THIS FILE EXISTS
--------------------
The Pikafish WASM engine needs four assets:

    engine-wasm.js            (worker-side bridge, ~8KB)
    wasm/pikafish-single.js   (emscripten glue, ~64KB)
    wasm/pikafish-single.wasm (the compiled engine, ~540KB)
    wasm/pikafish.nnue        (NNUE evaluation net, 50MB)

In the browser the main thread normally *fetches* them — which only works
over http/https. When the app is opened via file:// (double-click on a Mac,
"open in Safari" from the Files app on an iPhone, …) fetches are blocked and
the professional engine could never load: you were stuck with a server.

`<script src>` tags, however, work fine from file://. So this script bakes
all four assets into a single JavaScript file (base64 strings). index.html
loads it with a script tag when needed, decodes the strings and hands the
buffers to the engine worker exactly like the fetch path does.

USAGE
-----
    python3 build-assets.py

Run it after `./build-wasm.sh` (or whenever any of the four inputs change),
then upload the regenerated assets-embedded.js together with the rest of the
project (it is ~67MB — below GitHub's 100MB per-file limit).

The generated file is runtime-agnostic: in the browser it sets
window.__XQ_EMBED, in Node it sets globalThis.__XQ_EMBED (used by the
automated pipeline test).
"""
import base64
import hashlib
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "assets-embedded.js"

# key -> path relative to HERE
FILES = {
    "engine-wasm.js": "engine-wasm.js",
    "wasm/pikafish-single.js": "wasm/pikafish-single.js",
    "wasm/pikafish-single.wasm": "wasm/pikafish-single.wasm",
    "wasm/pikafish.nnue": "wasm/pikafish.nnue",
}


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def main() -> int:
    payload = []
    for key, rel in FILES.items():
        p = HERE / rel
        if not p.is_file():
            print(f"ERROR: {rel} is missing — run ./build-wasm.sh first", file=sys.stderr)
            return 1
        data = p.read_bytes()
        enc = b64(data)
        sha = hashlib.sha256(data).hexdigest()
        payload.append((key, rel, len(data), sha, enc))
        print(f"  {rel:32s} {len(data)/1e6:8.2f} MB  sha256:{sha[:16]}…")

    total_out = sum(len(p[4]) for p in payload)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S %Z")
    h = hashlib.sha256()
    for _k, _r, _s, _x, enc in payload:
        h.update(enc.encode("ascii"))
    sha_all = h.hexdigest()

    lines = []
    a = lines.append
    a("/* =====================================================================")
    a("   assets-embedded.js — GENERATED FILE, DO NOT EDIT BY HAND.")
    a("   Regenerate with:  python3 build-assets.py")
    a(f"   Generated: {stamp}   (payload sha256: {sha_all})")
    a("")
    a("   Base64 of every engine asset (see build-assets.py for why this")
    a("   file exists: it is what lets the app run the professional")
    a("   Pikafish engine with NO server — file://, offline, anywhere.")
    a(f"   Payload size: {total_out/1e6:.1f} MB of base64 text")
    a("   Contents:")
    for key, rel, size, sha, _enc in payload:
        a(f"     {key:28s} {size/1e6:8.2f} MB   sha256:{sha}")
    a("   DO NOT open this file in an editor (it is one very long string).")
    a("   ===================================================================== */")
    a("(function (g) {")
    a("'use strict';")
    a("var F = {};")
    for key, rel, size, sha, enc in payload:
        a(f'F["{key}"] = "{enc}";')
    a("g.__XQ_EMBED = {")
    a(f'  version: "{time.strftime("%Y%m%d-%H%M%S")}",')
    a("  files: F")
    a("};")
    a("})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : self));")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT.name}: {OUT.stat().st_size/1e6:.1f} MB")
    print("done. Commit assets-embedded.js together with the project.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
