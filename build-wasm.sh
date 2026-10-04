#!/bin/bash
# ============================================================================
#  Rebuild the Pikafish single-threaded WebAssembly engine into wasm/.
#
#  Requirements:
#    - emscripten in PATH  (e.g. `brew install emscripten`)
#    - git, curl
#
#  What it does:
#    1. fetches official-pikafish/Pikafish at the pinned commit
#    2. applies wasm/single-thread-wasm.patch (thread + C-bridge patches)
#    3. copies src/wasm_main.cpp (the exported C API bridge)
#    4. compiles with em++ (single-threaded; SSE128 for NNUE)
#    5. installs pikafish-single.js/.wasm into wasm/
#    6. downloads the 50MB NNUE net into wasm/ if missing
#
#  Output artifacts land in ./wasm/. The app works without them (it falls
#  back to the built-in JS engine), but with them the AI is tournament grade.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

PINNED_SHA=1c66b9b21cf2f280ce3b3ffa80c1c6609f2b29ff
UPSTREAM=https://github.com/official-pikafish/Pikafish
NET_URL=https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue

command -v em++ >/dev/null 2>&1 || { echo "ERROR: em++ not found in PATH (brew install emscripten)"; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
echo ">> cloning Pikafish @$PINNED_SHA"
git init -q "$WORK/Pikafish"
git -C "$WORK/Pikafish" remote add origin "$UPSTREAM"
git -C "$WORK/Pikafish" fetch -q --depth 1 origin "$PINNED_SHA"
git -C "$WORK/Pikafish" checkout -q FETCH_HEAD

cd "$WORK/Pikafish"
echo ">> applying wasm patch"
git apply "$OLDPWD/wasm/single-thread-wasm.patch"

# wasm_main.cpp is already part of the patch (new file)
rm -f src/pikafish-single.js src/pikafish-single.wasm

echo ">> compiling (em++)"
cd src
SRCS=$(find . -path ./universal -prune -o -path ./temp_builds -prune -o -name '*.cpp' -print \
       | grep -v '\./main\.cpp$' | sed 's|^\./||' | tr '\n' ' ')
# bash word-splitting (this script runs under bash, not zsh)
em++ $SRCS \
  -O3 -funroll-loops -fno-exceptions -std=c++17 -Wall \
  -DNDEBUG -DIS_64BIT -DNO_PREFETCH \
  -DUSE_POPCNT -DUSE_SSE -DUSE_SSE2 -DUSE_SSSE3 -DUSE_SSE41 -D__SSE4_1__=1 \
  -msse -msse2 -mssse3 -msimd128 -DUSE_SLOPPY_ATOMICS \
  -sINITIAL_MEMORY=64MB -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=3MB \
  -sMODULARIZE=1 -sEXPORT_NAME=createPikafish -sINVOKE_RUN=0 \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain,ccall,cwrap,UTF8ToString \
  -sEXPORTED_FUNCTIONS=_wmain_init,_wmain_position,_wmain_position_moves,_wmain_go,_wmain_bestmove,_wmain_ponder,_wmain_fen,_wmain_clear,_wmain_perft,_malloc,_free,_main \
  -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker,node \
  -sASSERTIONS=0 -sWASM=1 \
  -o ./pikafish-single.js

cd "$OLDPWD"
cp src/pikafish-single.js src/pikafish-single.wasm "$PROJECT_DIR"/wasm/
chmod +x "$PROJECT_DIR"/wasm/pikafish-single.wasm
echo ">> installed wasm/pikafish-single.{js,wasm}"

if [ ! -f "$PROJECT_DIR"/wasm/pikafish.nnue ]; then
  echo ">> downloading NNUE net (50MB) from $NET_URL"
  curl -L --fail -o "$PROJECT_DIR"/wasm/pikafish.nnue "$NET_URL"
else
  echo ">> NNUE net already present (wasm/pikafish.nnue)"
fi

echo "done. verify with: node -e \"...\" (see README-wasm.md) or just play in the browser."
