/* =====================================================================
 *  XQ — Xiangqi (Chinese Chess) Engine
 *  Pure logic module: rules, move generation, search (negamax alpha-beta
 *  + iterative deepening + transposition table w/ bounds + killers +
 *  history + aspiration + quiescence + time management), evaluation
 *  (material + piece-square tables + rook files + cannon screens +
 *  king safety + structure + mobility).
 *  No DOM access — testable in any JS runtime.
 *
 *  Conventions:
 *   - board: Int8Array(90); index = r*9+c; r 0..9 top->bottom
 *     (BLACK home on top), c 0..8 left->right.
 *   - piece codes: 0 empty; red +1..+7, black -1..-7
 *     (1 K 2 A 3 E 4 H 5 R 6 C 7 P)
 *   - move encoding: m = from | (to << 7)   (from,to < 128)
 *   - scores: positive = better for RED unless noted.
 * ===================================================================== */
var XQ = (function () {
'use strict';

/* Publish this file's own source to the page so the UI can build a Web Worker
   from it WITHOUT any network fetch (fetches of local files are blocked on
   file:// pages). When this file is eval'd inside a worker there is no
   document — the capture is a page-side convenience only and is inert there. */
try {
  if (typeof document !== 'undefined' && document.currentScript) {
    var __g = (typeof window !== 'undefined') ? window : globalThis;
    __g.__XQ_ENGINE_SOURCE = document.currentScript.textContent;
  }
} catch (e) { /* ignore */ }

const K = 1, A = 2, E = 3, H = 4, R = 5, C = 6, P = 7;
const VAL = [0, 0, 140, 140, 450, 1000, 500, 100];
const MATE = 100000, INF = 1000000;

/* ---------- piece-square tables (defined for RED; black mirrored on rows) ---------- */
const PST = {
  5: [ // rook
    [10, 15, 20, 25, 30, 25, 20, 15, 10],
    [10, 18, 25, 30, 35, 30, 25, 18, 10],
    [ 8, 15, 22, 28, 32, 28, 22, 15,  8],
    [ 8, 15, 22, 28, 30, 28, 22, 15,  8],
    [10, 18, 26, 32, 38, 32, 26, 18, 10],
    [ 8, 15, 24, 30, 36, 30, 24, 15,  8],
    [ 5, 12, 18, 24, 28, 24, 18, 12,  5],
    [ 5, 10, 15, 20, 22, 20, 15, 10,  5],
    [ 0,  5, 10, 15, 18, 15, 10,  5,  0],
    [ 0,  8, 12, 16, 18, 16, 12,  8,  0]
  ],
  4: [ // horse
    [ -5,  5,  0,  5,  5,  5,  0,  5, -5],
    [  5, 10, 15, 20, 25, 20, 15, 10,  5],
    [  0, 10, 20, 25, 25, 25, 20, 10,  0],
    [ -5,  5, 15, 20, 25, 20, 15,  5, -5],
    [ -5,  5, 15, 20, 25, 20, 15,  5, -5],
    [  0,  5, 15, 20, 20, 20, 15,  5,  0],
    [  5,  5, 10, 15, 15, 15, 10,  5,  5],
    [  0,  0,  5, 10, 10, 10,  5,  0,  0],
    [ -5, -5,  0,  5,  5,  5,  0, -5, -5],
    [-10, -5, -5,  0,  0,  0, -5, -5,-10]
  ],
  6: [ // cannon
    [ 0,  0,  2,  5,  5,  5,  2,  0,  0],
    [ 2,  5,  5,  8, 10,  8,  5,  5,  2],
    [ 5,  8, 10, 14, 16, 14, 10,  8,  5],
    [ 5,  8, 10, 14, 16, 14, 10,  8,  5],
    [ 8, 10, 12, 15, 18, 15, 12, 10,  8],
    [ 8, 10, 12, 15, 18, 15, 12, 10,  8],
    [ 5,  8,  8, 12, 14, 12,  8,  8,  5],
    [ 5,  8, 10, 14, 16, 14, 10,  8,  5],
    [ 2,  5,  5,  8, 10,  8,  5,  5,  2],
    [ 0,  0,  2,  5,  5,  5,  2,  0,  0]
  ],
  7: [ // pawn (base 100)
    [50, 60, 65, 70, 70, 65, 60, 50, 50],
    [60, 80, 90, 100, 100, 90, 80, 60, 60],
    [65, 85, 100, 110, 115, 110, 100, 85, 65],
    [55, 75, 90, 100, 105, 100, 90, 75, 55],
    [40, 55, 65, 75, 80, 75, 65, 55, 40],
    [25, 40, 50, 55, 60, 55, 50, 40, 25],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0]
  ],
  2: [ // advisor
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 2, 3, 2, 0, 0, 0, 0],
    [0, 0, 3, 4, 3, 0, 0, 0, 0]
  ],
  3: [ // elephant
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [2, 0, 3, 0, 4, 0, 3, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 0, 6, 0, 8, 0, 6, 0, 4],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [5, 0, 8, 0, 10, 0, 8, 0, 5]
  ],
  1: [ // general
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 2, 3, 2, 0, 0, 0, 0],
    [0, 0, 3, 4, 3, 0, 0, 0, 0]
  ]
};

/* ---------- horse geometry (8 directions) ---------- */
const H_DR  = [ 1,  1,  2,  2, -1, -1, -2, -2];
const H_DC  = [-2,  2, -1,  1,  2, -2,  1, -1];
const HOFF  = [ 7, 11, 17, 19, -7, -11, -17, -19];
const HLEG  = [-1,  1,  9,  9,  1,  1, -9, -9];

/* ---------- zobrist ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(a ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}
/* Zobrist keys: two independent PRNG streams combined into ONE 53-bit
   safe-integer hash (hi part 21 bits * 2^32 + lo 32 bits).
   The old single 32-bit hash collided in real search trees (mulberry32
   outputs have near-linear dependencies), which made the 3-fold-repetition
   branch fire spuriously and poisoned scores. */
const ZRH = mulberry32(0x9e3779b9);
const ZRL = mulberry32(0x85EBCA6B);
const ZZH = new Int32Array(15 * 90);   /* high part, masked to 21 bits */
const ZZL = new Int32Array(15 * 90);   /* low part, full 32 bits */
for (let i = 0; i < ZZH.length; i++) {
  ZZH[i] = ZRH() & 0x1FFFFF;
  ZZL[i] = ZRL() | 0;
}
const ZZ_TH = ZRH() & 0x1FFFFF;
const ZZ_TL = ZRL() | 0;

/* ---------- initial position ---------- */
function initialBoard() {
  const b = new Int8Array(90);
  const back = [-R, -H, -E, -A, -K, -A, -E, -H, -R];
  for (let c = 0; c < 9; c++) {
    b[c] = back[c];
    b[9 * 9 + c] = -back[c];
  }
  b[2 * 9 + 1] = -C; b[2 * 9 + 7] = -C;
  b[7 * 9 + 1] = C;  b[7 * 9 + 7] = C;
  for (let c = 0; c < 9; c += 2) {
    b[3 * 9 + c] = -P;
    b[6 * 9 + c] = P;
  }
  return b;
}

/* =====================================================================
 *  Position
 * ===================================================================== */
function Position(board, turn) {
  const b = new Int8Array(90);
  b.set(board);
  this.b = b;
  this.turn = turn || 1;          // 1 red, -1 black
  this.kr = -1; this.kb = -1;
  this.hash = 0; this.hashH = 0; this.hashL = 0;
  this.rep = [];
  this.repCount = new Map();
  this.nodes = 0;
  this.cancelled = false;
  this.timeLimit = 0;
  this.mat = 0;             // 0 = no in-search time check; else Date.now() deadline
  this.caps = [];              // LIFO stack of captured pieces (makeMove/unmakeMove)
  let hH = this.turn === 1 ? ZZ_TH : 0;
  let hL = this.turn === 1 ? ZZ_TL : 0;
  for (let s = 0; s < 90; s++) {
    const p = b[s];
    if (!p) continue;
    hH ^= ZZH[(p + 7) * 90 + s];
    hL ^= ZZL[(p + 7) * 90 + s];
    this.mat += VAL[p > 0 ? p : -p];
    if (p === K) this.kr = s;
    else if (p === -K) this.kb = s;
  }
  this.hashH = hH; this.hashL = hL;
  this.hash = hH * 4294967296 + (hL >>> 0);
  this.rep.push(this.hash);
  this.repCount.set(this.hash, 1);
}

Position.prototype.makeMove = function (m) {
  const from = m & 127, to = m >> 7;
  const b = this.b;
  const piece = b[from];
  const cap = b[to];            // captured enemy piece, or 0 if a quiet move
  this.caps.push(cap);
  b[to] = piece; b[from] = 0;
  if (piece === K) this.kr = to;
  else if (piece === -K) this.kb = to;
  if (cap === K) this.kr = -1;        // safety: a general is never legally captured
  else if (cap === -K) this.kb = -1;
  this.hashH ^= ZZH[(piece + 7) * 90 + from] ^ ZZH[(piece + 7) * 90 + to];
  this.hashL ^= ZZL[(piece + 7) * 90 + from] ^ ZZL[(piece + 7) * 90 + to];
  if (cap) {
    this.hashH ^= ZZH[(cap + 7) * 90 + to];
    this.hashL ^= ZZL[(cap + 7) * 90 + to];
    this.mat -= VAL[cap > 0 ? cap : -cap];
  }
  this.turn = -this.turn;
  this.hashH ^= ZZ_TH;
  this.hashL ^= ZZ_TL;
  this.hash = this.hashH * 4294967296 + (this.hashL >>> 0);
};

Position.prototype.unmakeMove = function (m) {
  const to = m >> 7, from = m & 127;
  const b = this.b;
  const piece = b[to];
  const cap = this.caps.pop();   // captured piece to restore on the destination
  b[from] = piece; b[to] = cap;
  if (piece === K) this.kr = from;
  else if (piece === -K) this.kb = from;
  if (cap === K) this.kr = to;         // restore a (never-actually) captured general
  else if (cap === -K) this.kb = to;
  this.hashH ^= ZZH[(piece + 7) * 90 + from] ^ ZZH[(piece + 7) * 90 + to];
  this.hashL ^= ZZL[(piece + 7) * 90 + from] ^ ZZL[(piece + 7) * 90 + to];
  if (cap) {
    this.hashH ^= ZZH[(cap + 7) * 90 + to];
    this.hashL ^= ZZL[(cap + 7) * 90 + to];
    this.mat += VAL[cap > 0 ? cap : -cap];
  }
  this.turn = -this.turn;
  this.hashH ^= ZZ_TH;
  this.hashL ^= ZZ_TL;
  this.hash = this.hashH * 4294967296 + (this.hashL >>> 0);
};

/* is `color`'s general attacked? (explicit color — used by legality tests
   AFTER a move, where turn has already flipped) */
Position.prototype.checked = function (color) {
  if (color === 1) return isAttacked(this.b, this.kr, -1);
  return isAttacked(this.b, this.kb, 1);
};

/* is the SIDE TO MOVE in check? (used by the search) */
Position.prototype.inCheck = function () {
  return this.checked(this.turn);
};

/* sanity: both generals present? */
Position.prototype.kingsPresent = function () {
  return this.kr >= 0 && this.kb >= 0;
};

/* =====================================================================
 *  Attack detection: does color `by` (+1 red / -1 black) attack sq?
 *  (handles rook, cannon, horse w/ leg, flying general, pawn)
 * ===================================================================== */
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function isAttacked(b, sq, by) {
  const r = sq / 9 | 0, c = sq % 9;
  /* `by` = color of the ATTACKER (+1 red / -1 black) */
  const eR = by * R, eC = by * C, eH = by * H, aK = by * K, eP = by * P;

  /* four rays: rook / cannon (over exactly one screen) / flying general.
     Walk outwards: 1st piece = check if rook or enemy general, else it is
     the screen; 2nd piece = check if enemy cannon. */
  for (let i = 0; i < 4; i++) {
    let y = r + DIRS[i][0], x = c + DIRS[i][1];
    let screens = 0;
    while (y >= 0 && y <= 9 && x >= 0 && x <= 8) {
      const p = b[y * 9 + x];
      if (p) {
        if (screens === 0) {
          if (p === eR || p === aK) return true;
          screens = 1;
        } else {
          if (p === eC) return true;
          break;
        }
      }
      y += DIRS[i][0]; x += DIRS[i][1];
    }
  }

  /* horses (leg must be free) */
  for (let i = 0; i < 8; i++) {
    const hr = r + H_DR[i], hc = c + H_DC[i];
    if (hr < 0 || hr > 9 || hc < 0 || hc > 8) continue;
    const hs = hr * 9 + hc;
    if (b[hs] === eH) {
      /* leg of the HORSE (hr,hc) toward the target: opposite of the
         horse->target offset derived from (r,c) */
      const lr = hr + (H_DR[i] === 2 ? -1 : H_DR[i] === -2 ? 1 : 0);
      const lc = hc + (H_DC[i] === 2 ? -1 : H_DC[i] === -2 ? 1 : 0);
      if (inRange(lr, lc) && b[lr * 9 + lc] === 0) return true;
    }
  }

  /* pawns */
  if (by === 1) {
    if (r + 1 <= 9 && b[(r + 1) * 9 + c] === eP) return true;
    if (r <= 4) { // red has crossed
      if (c > 0 && b[r * 9 + c - 1] === eP) return true;
      if (c < 8 && b[r * 9 + c + 1] === eP) return true;
    }
  } else {
    if (r - 1 >= 0 && b[(r - 1) * 9 + c] === eP) return true;
    if (r >= 5) { // black has crossed
      if (c > 0 && b[r * 9 + c - 1] === eP) return true;
      if (c < 8 && b[r * 9 + c + 1] === eP) return true;
    }
  }
  return false;
}

/* attacker COUNT for a square (no early exit) — king-safety term */
function countAttackers(b, sq, by) {
  const r = sq / 9 | 0, c = sq % 9;
  const eR = by * R, eC = by * C, eH = by * H, aK = by * K, eP = by * P;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    let y = r + DIRS[i][0], x = c + DIRS[i][1];
    let screens = 0;
    while (y >= 0 && y <= 9 && x >= 0 && x <= 8) {
      const p = b[y * 9 + x];
      if (p) {
        if (screens === 0) {
          if (p === eR || p === aK) n++;
          screens = 1;
        } else {
          if (p === eC) n++;
          break;
        }
      }
      y += DIRS[i][0]; x += DIRS[i][1];
    }
  }
  for (let i = 0; i < 8; i++) {
    const hr = r + H_DR[i], hc = c + H_DC[i];
    if (hr < 0 || hr > 9 || hc < 0 || hc > 8) continue;
    if (b[hr * 9 + hc] === eH) {
      const lr = hr + (H_DR[i] === 2 ? -1 : H_DR[i] === -2 ? 1 : 0);
      const lc = hc + (H_DC[i] === 2 ? -1 : H_DC[i] === -2 ? 1 : 0);
      if (inRange(lr, lc) && b[lr * 9 + lc] === 0) n++;
    }
  }
  if (by === 1) {
    if (r + 1 <= 9 && b[(r + 1) * 9 + c] === eP) n++;
    if (r <= 4) {
      if (c > 0 && b[r * 9 + c - 1] === eP) n++;
      if (c < 8 && b[r * 9 + c + 1] === eP) n++;
    }
  } else {
    if (r - 1 >= 0 && b[(r - 1) * 9 + c] === eP) n++;
    if (r >= 5) {
      if (c > 0 && b[r * 9 + c - 1] === eP) n++;
      if (c < 8 && b[r * 9 + c + 1] === eP) n++;
    }
  }
  return n;
}

/* re-export helper so the (separately edited) leg bounds check can use it */
function inRange(r, c) { return r >= 0 && r <= 9 && c >= 0 && c <= 8; }

/* =====================================================================
 *  Move generation
 * ===================================================================== */
function genPiece(pos, s, r, c, type, moves) {
  const b = pos.b, t = pos.turn;
  const enemyKing = -t * K;
  function push(to) { moves.push(s | (to << 7)); }
  function ok(to) {
    const q = b[to];
    if (q === enemyKing) return false; // never allow capturing a general (safety guard)
    return q === 0 || (q > 0) !== (t === 1);
  }

  switch (type) {
    case K:
      if (c < 3 || c > 5) break;
      {
        const nr = r - 1;
        if ((t === 1 ? nr >= 7 : nr <= 2) && nr >= 0 && nr <= 9 && ok(s - 9)) push(s - 9);
        const nr2 = r + 1;
        if ((t === 1 ? nr2 <= 9 : nr2 >= 0) && nr2 >= 0 && nr2 <= 9 && ok(s + 9)) push(s + 9);
      }
      if (c > 3 && ok(s - 1)) push(s - 1);
      if (c < 8 && ok(s + 1)) push(s + 1);
      break;
    case A:
      if (c < 3 || c > 5) break;
      for (let dr = -1; dr <= 1; dr += 2) {
        const nr = r + dr;
        if ((t === 1 && (nr < 7 || nr > 9)) || (t === -1 && (nr < 0 || nr > 2))) continue;
        if (nr < 0 || nr > 9) continue;
        for (let dc = -1; dc <= 1; dc += 2) {
          const nc = c + dc;
          if (nc < 3 || nc > 5) continue;
          if (ok(nr * 9 + nc)) push(nr * 9 + nc);
        }
      }
      break;
    case E: {
      const eDR = [2, 2, -2, -2], eDC = [2, -2, 2, -2];
      for (let i = 0; i < 4; i++) {
        const tr = r + eDR[i], tc = c + eDC[i];
        if (tr < 0 || tr > 9 || tc < 0 || tc > 8) continue;
        if ((t === 1 && tr < 5) || (t === -1 && tr > 4)) continue; // no river crossing
        if (b[(r + eDR[i] / 2) * 9 + (c + eDC[i] / 2)] !== 0) continue; // blocked eye
        if (ok(tr * 9 + tc)) push(tr * 9 + tc);
      }
      break;
    }
    case H: {
      for (let i = 0; i < 8; i++) {
        const tr = r + H_DR[i], tc = c + H_DC[i];
        if (tr < 0 || tr > 9 || tc < 0 || tc > 8) continue;
        const to = tr * 9 + tc;
        const lr = r + (H_DR[i] === 2 ? 1 : H_DR[i] === -2 ? -1 : 0);
        const lc = c + (H_DC[i] === 2 ? 1 : H_DC[i] === -2 ? -1 : 0);
        if (b[lr * 9 + lc] !== 0) continue; // blocked horse leg
        if (ok(to)) push(to);
      }
      break;
    }
    case R:
    case C: {
      for (let i = 0; i < 4; i++) {
        let y = r + DIRS[i][0], x = c + DIRS[i][1];
        const dy = DIRS[i][0], dx = DIRS[i][1];
        let screen = false;
        while (y >= 0 && y <= 9 && x >= 0 && x <= 8) {
          const sq = y * 9 + x;
          const q = b[sq];
          if (q === 0) {
            if (!screen) push(sq);
          } else {
            const enemy = (q > 0) !== (t === 1);
            if (type === R) { if (enemy) push(sq); break; }
            // Cannon: the first piece is the screen — keep sliding past it.
            // The NEXT piece encountered is a legal capture target iff it is
            // an enemy. (The old code broke right after the screen and only
            // tested the one square adjacent to it, silently dropping every
            // capture where the target sat further past the screen.)
            if (screen) { if (enemy) push(sq); break; }
            screen = true;
          }
          y += dy; x += dx;
        }
      }
      break;
    }
    case P: {
      const nr = r + (t === 1 ? -1 : 1);
      if (nr >= 0 && nr < 10 && ok(s + (t === 1 ? -9 : 9))) push(s + (t === 1 ? -9 : 9));
      const crossed = t === 1 ? r <= 4 : r >= 5;
      if (crossed) {
        if (c > 0 && ok(s - 1)) push(s - 1);
        if (c < 8 && ok(s + 1)) push(s + 1);
      }
      break;
    }
  }
}

function genMoves(pos, legal) {
  const b = pos.b, t = pos.turn;
  const moves = [];
  for (let s = 0; s < 90; s++) {
    const p = b[s];
    if (!p || (p > 0) !== (t === 1)) continue;
    const r = s / 9 | 0, c = s % 9;
    genPiece(pos, s, r, c, p > 0 ? p : -p, moves);
  }
  if (!legal) return moves;
  const out = [];
  const mover = pos.turn;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    pos.makeMove(m);
    const chk = pos.checked(mover); // legality: mover's general must be safe
    pos.unmakeMove(m);
    if (!chk) out.push(m);
  }
  return out;
}

function genCaptures(pos, legal) {
  const b = pos.b, t = pos.turn;
  const moves = [];
  for (let s = 0; s < 90; s++) {
    const p = b[s];
    if (!p || (p > 0) !== (t === 1)) continue;
    const type = p > 0 ? p : -p;
    if (type === K || type === A) continue;
    const r = s / 9 | 0, c = s % 9;
    genPiece(pos, s, r, c, type, moves);
  }
  for (let i = moves.length - 1; i >= 0; i--) {
    if (!b[moves[i] >> 7]) moves.splice(i, 1);
  }
  if (!legal) return moves;
  const out = [];
  const mover = pos.turn;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    pos.makeMove(m);
    const chk = pos.checked(mover); // legality: mover's general must be safe
    pos.unmakeMove(m);
    if (!chk) out.push(m);
  }
  return out;
}

/* =====================================================================
 *  Evaluation (absolute: positive = better for RED)
 *  full=false → cheap stand-pat (no mobility) for quiescence speed.
 * ===================================================================== */
function evalAbs(pos, full) {
  if (full === undefined) full = true;
  const saved = pos.turn;
  const b = pos.b;
  let score = 0;
  let heavy = 0, rA = 0, rE = 0, bA = 0, bE = 0;
  const ownP = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const enP = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let s = 0; s < 90; s++) {
    const p = b[s];
    if (!p) continue;
    const type = p > 0 ? p : -p;
    if (type === R || type === C || type === H) heavy++;
    if (type === A) { if (p > 0) rA++; else bA++; }
    else if (type === E) { if (p > 0) rE++; else bE++; }
    else if (type === P) { if (p > 0) ownP[s % 9]++; else enP[s % 9]++; }
  }
  const endgame = heavy <= 3;
  for (let s = 0; s < 90; s++) {
    const p = b[s];
    if (!p) continue;
    const sign = p > 0 ? 1 : -1;
    const type = p > 0 ? p : -p;
    const r = s / 9 | 0, c = s % 9;
    const row = p > 0 ? r : 9 - r;
    let v = VAL[type] + PST[type][row][c];
    if (endgame) {
      if (type === P) v += 90;
      else if (type === H) v += 25;
    }
    if (type === H) {
      let legs = 0;
      if (r > 0 && b[s - 9]) legs++;
      if (r < 9 && b[s + 9]) legs++;
      if (c > 0 && b[s - 1]) legs++;
      if (c < 8 && b[s + 1]) legs++;
      v -= legs * 12;
    }
    if (type === R) {
      /* rook file: open files are worth real money in xiangqi */
      const o = ownP[c], e = enP[c];
      if (o === 0 && e === 0) v += 40;
      else if (o === 0) v += 26;
      else if (e === 0) v -= 18;
    }
    if (type === C) {
      /* cannon wants screens: count occupied rays */
      let scr = 0;
      for (let i = 0; i < 4; i++) {
        let y = r + DIRS[i][0], x = c + DIRS[i][1];
        while (y >= 0 && y <= 9 && x >= 0 && x <= 8) {
          if (b[y * 9 + x]) { scr++; break; }
          y += DIRS[i][0]; x += DIRS[i][1];
        }
      }
      v += scr >= 2 ? 16 : (scr === 1 ? 8 : -6);
    }
    score += sign * v;
  }
  if (rA < 2) score += (2 - rA) * 18;
  if (rE < 2) score += (2 - rE) * 14;
  if (bA < 2) score -= (2 - bA) * 18;
  if (bE < 2) score -= (2 - bE) * 14;

  /* king safety: multiple attackers on the general = danger */
  if (pos.kingsPresent()) {
    if (pos.kr >= 0) {
      const n = countAttackers(b, pos.kr, -1);
      if (n >= 2) score -= 12 * n;
      else if (n === 1) score -= 4;
    }
    if (pos.kb >= 0) {
      const n = countAttackers(b, pos.kb, 1);
      if (n >= 2) score += 12 * n;
      else if (n === 1) score += 4;
    }
  }

  if (full) {
    pos.turn = 1;
    let mr = genMoves(pos, false).length;
    pos.turn = -1;
    let mb = genMoves(pos, false).length;
    pos.turn = saved;
    score += (mr - mb) * 3;
  } else {
    pos.turn = saved;
  }
  return score;
}

/* =====================================================================
 *  Search: negamax alpha-beta + TT (bounds) + killers + history + quiescence
 * ===================================================================== */
const TT = new Map();
var TT_MAX_V = 1500000;
const TT_MAX = 1500000;
/* TT entry packed into ONE JS number (<= 53 bits):
       v = biasedScore(21b) * 2^28 + meta(28b)
   meta bits: move 0..13, rep 14..19, type 20..21, depth 22..27
   NOTE: no 32-bit << / >> on v (would truncate); use float division for
   the high fields. Key of the Map is the 53-bit position hash itself. */
const TT_BIAS = 1000000;
function ttPack(score, depth, move, type, rep) {
  let sc = score | 0;
  if (sc > 1000000) sc = 1000000; else if (sc < -1000000) sc = -1000000;
  sc += TT_BIAS;   /* [0, 2000000] < 2^21 */
  const meta = ((depth & 63) << 22) | ((type & 3) << 20) | ((rep & 63) << 14) | (move & 0x3fff);
  return sc * 268435456 + meta;
}
function ttScore(v) { return Math.floor(v / 268435456) - TT_BIAS; }
function ttm(v)     { return v & 0x3fff; }
function ttDepth(v) { return Math.floor(v / 4194304) & 63; }
function ttType(v)  { return Math.floor(v / 1048576) & 3; }
function ttRep(v)   { return Math.floor(v / 16384) & 63; }
const MAXPLY = 256;
const KILLERS = [];
for (let i = 0; i < MAXPLY; i++) KILLERS[i] = [0, 0];
const HISTORY = new Int32Array(90 * 90);
const TIME_MASK = 2047;         // check the clock every 2048 nodes

function orderMoves(pos, moves, ttMove, ply) {
  const b = pos.b;
  function score(m) {
    if (m === ttMove) return 1e9;
    const cap = b[m >> 7];
    if (cap) {
      const mover = b[m & 127] > 0 ? b[m & 127] : -b[m & 127];
      return 1e6 + VAL[cap > 0 ? cap : -cap] * 100 - VAL[mover];
    }
    const k = KILLERS[ply];
    if (k[0] === m) return 5e5;
    if (k[1] === m) return 4e5;
    return HISTORY[(m & 127) * 90 + (m >> 7)] + scoreDelta(pos, m);
  }
  const scored = new Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    scored[i] = { m: moves[i], s: score(moves[i]) };
  }
  scored.sort(function (x, y) { return y.s - x.s; });
  for (let i = 0; i < moves.length; i++) moves[i] = scored[i].m;
}

function scoreDelta(pos, m) {
  const b = pos.b;
  const from = m & 127, to = m >> 7;
  const p = b[from];
  if (!p) return 0;
  const type = p > 0 ? p : -p;
  const r1 = from / 9 | 0, c1 = from % 9;
  const r2 = to / 9 | 0, c2 = to % 9;
  const row1 = p > 0 ? r1 : 9 - r1;
  const row2 = p > 0 ? r2 : 9 - r2;
  return PST[type][row2][c2] - PST[type][row1][c1];
}

function search(pos, depth, alpha, beta, ply) {
  pos.nodes++;
  if (pos.cancelled) return 0;
  if (pos.timeLimit && (pos.nodes & TIME_MASK) === 0 && Date.now() > pos.timeLimit) {
    pos.cancelled = true; return 0;
  }
  if (pos.kingsPresent() === false) return -INF; /* corrupted: treat as worst */

  const h = pos.hash;
  const cnt = pos.repCount.get(h) || 0;
  if (cnt >= 2) {
    /* 3rd occurrence of this position along the path.
       If the side to move is in check, the checker repeated a check
       (perpetual) and must give way or lose. */
    return pos.inCheck() ? (MATE - 5000) : 0;
  }

  if (depth <= 0) return quiescence(pos, alpha, beta, ply);

  pos.rep.push(h);
  pos.repCount.set(h, cnt + 1);

  const inChk = pos.inCheck();
  const d = (inChk && depth <= 5) ? depth : depth - 1; // capped check extension

  const moves = genMoves(pos, true);
  if (moves.length === 0) {
    pos.rep.pop(); pos.repCount.set(h, cnt);
    /* xiangqi rule: ANY side with no legal move loses — whether or not in check. */
    return pos.kingsPresent() ? -(MATE - ply) : -MATE;
  }

  /* transposition table: pruning when the rep context matches */
  const e = TT.get(h);
  let ttMove = e !== undefined ? ttm(e) : -1;
  const alphaOrig = alpha;
  if (e !== undefined && ttDepth(e) >= depth && ttRep(e) === (cnt & 63)) {
    const et = ttType(e), es = ttScore(e);
    if (et === 1) return es;                        // exact
    if (et === 0 && es >= beta) return es;         // upper
    if (et === 2 && es <= alpha) return es;        // lower
    if (et === 0 && es < beta) beta = es;
    if (et === 2 && es > alpha) alpha = es;
    if (alpha >= beta) return es;
  }

  /* null move: pass (guarded — never in check, never a bare endgame) */
  if (!inChk && d >= 3 && pos.mat >= 2500) {
    pos.caps.push(100);           /* sentinel: no board change */
    pos.turn = -pos.turn;
    pos.hashH ^= ZZ_TH; pos.hashL ^= ZZ_TL;
    pos.hash = pos.hashH * 4294967296 + (pos.hashL >>> 0);
    const dN = d - 1 - (d >> 3);
    const ns = -search(pos, dN, -beta, -beta + 1, ply + 1);
    pos.turn = -pos.turn;
    pos.hashH ^= ZZ_TH; pos.hashL ^= ZZ_TL;
    pos.hash = pos.hashH * 4294967296 + (pos.hashL >>> 0);
    pos.caps.pop();
    if (pos.cancelled) { pos.rep.pop(); pos.repCount.set(h, cnt); return 0; }
    if (ns >= beta) return ns;
  }

  orderMoves(pos, moves, ttMove, Math.min(ply, MAXPLY - 1));

  let best = ttMove, bestScore = -INF, who = -INF;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    /* cheap SEE: skip deeply losing exchanges when not in check */
    const cap0 = pos.b[m >> 7];
    if (cap0 && !inChk) {
      const mv0 = pos.b[m & 127] > 0 ? pos.b[m & 127] : -pos.b[m & 127];
      if (VAL[cap0 > 0 ? cap0 : -cap0] - VAL[mv0] < -300) continue;
    }
    pos.makeMove(m);
    let sc;
    const cCnt = pos.repCount.get(pos.hash) || 0;
    if (cCnt >= 2) {
      /* the move created a 3rd occurrence: draw; if it also checks,
         the mover violates the perpetual-check rule -> mover loses */
      sc = pos.inCheck() ? -MATE : -30;
    } else {
      sc = -search(pos, d, -beta, -alpha, ply + 1);
    }
    pos.unmakeMove(m);

    if (pos.cancelled) { pos.rep.pop(); pos.repCount.set(h, cnt); return 0; }
    if (sc > bestScore) { bestScore = sc; best = m; }
    if (sc > who) who = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) {
      /* cutoff: learn from quiet (non-capture, non-TT) moves */
      if (!pos.b[m >> 7] && m !== ttMove) {
        const k = KILLERS[Math.min(ply, MAXPLY - 1)];
        if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
        HISTORY[(m & 127) * 90 + (m >> 7)] += d * d;
      }
      break;
    }
  }
  pos.rep.pop();
  pos.repCount.set(h, cnt);

  /* store (raw, pre-clamp score; rep context for safe reuse) */
  if (!pos.cancelled) {
    if (TT.size >= TT_MAX_V) TT.clear();
    let type = 1;
    if (who <= alphaOrig) type = 2;
    else if (who >= beta) type = 0;
    const st = depth + (inChk ? 1 : 0);
    const old = TT.get(h);
    if (old === undefined || ttDepth(old) < st || (type === 1 && ttType(old) !== 1)) {
      TT.set(h, ttPack(bestScore, st, best, type, cnt & 63));
    }
  }

  /* ply-pace mate scores, clamped to a sane range */
  if (bestScore >= MATE - 2000) bestScore = Math.min(MATE - 1, Math.max(MATE - 2000, (MATE - ply) + (bestScore - (MATE - 2000))));
  if (bestScore <= -(MATE - 2000)) bestScore = Math.max(-(MATE - 1), Math.min(-(MATE - 2000), -(MATE - ply) + (bestScore + (MATE - 2000))));
  return bestScore;
}

function quiescence(pos, alpha, beta, ply) {
  pos.nodes++;
  if (pos.cancelled) return 0;
  if (pos.timeLimit && (pos.nodes & TIME_MASK) === 0 && Date.now() > pos.timeLimit) {
    pos.cancelled = true; return 0;
  }

  const inChk = pos.inCheck();
  const stand = (pos.turn === 1 ? 1 : -1) * evalAbs(pos, false);
  if (!inChk) {
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  } else {
    if (stand <= alpha) return alpha;
    if (stand < beta) beta = stand;
  }

  const moves = inChk ? genMoves(pos, true) : genCaptures(pos, true);

  const b = pos.b;
  const scored = new Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const cap = b[m >> 7];
    const mv = b[m & 127];
    if (cap && !inChk && VAL[cap > 0 ? cap : -cap] - VAL[mv > 0 ? mv : -mv] < -300) continue;
    scored[i] = { m, s: cap ? VAL[-cap] * 100 - VAL[mv > 0 ? mv : -mv] : -1 };
  }
  scored.sort(function (x, y) { return y.s - x.s; });

  let best = -INF;
  for (let i = 0; i < scored.length; i++) {
    if (!scored[i]) continue;
    const m = scored[i].m;
    pos.makeMove(m);
    const sc = -quiescence(pos, -beta, -alpha, ply + 1);
    pos.unmakeMove(m);
    if (pos.cancelled) return 0;
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  if (best === -INF) {
    /* no reply at all: only a real mate if the opponent's general is gone;
       otherwise fall back to stand-pat (never fabricate a mate) */
    if (inChk && pos.kingsPresent() === false) return -(MATE - ply);
    return stand;
  }
  return best;
}

/* =====================================================================
 *  Root search: iterative deepening, aspiration window, time budget.
 *  The transposition table is kept across consecutive calls so follow-up
 *  moves reuse work; killers/history are reset per call.
 * ===================================================================== */
function rootSearch(pos, opt) {
  opt = opt || {};
  const timeMs = opt.timeMs || 2000;
  const maxDepth = opt.maxDepth || 40;
  for (let i = 0; i < MAXPLY; i++) { KILLERS[i][0] = 0; KILLERS[i][1] = 0; }
  HISTORY.fill(0);
  pos.cancelled = false;
  pos.nodes = 0;
  pos.timeLimit = Date.now() + timeMs;
  pos.rep.length = 0;
  pos.repCount.clear();
  pos.caps.length = 0;
  pos.rep.push(pos.hash);
  pos.repCount.set(pos.hash, 1);

  const moves = genMoves(pos, true);
  if (moves.length === 0) {
    return { move: -1, score: pos.inCheck() ? -(MATE) : MATE, depth: 0, nodes: 0, nps: 0 };
  }

  let bestMove = moves[0], bestScore = -INF;
  let bestDepth = 0;
  let lastScores = null, lastScore = 0;
  const t0 = Date.now();

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (pos.cancelled) break;
    orderMoves(pos, moves, bestMove, 0);

    let alpha = -INF, beta = INF;
    /* aspiration intentionally omitted: with null-move score noise it causes
       non-monotonic depth (fail-low/fail-high re-search storms). Full window. */
    let a0 = alpha, b0 = beta;

    let depthBest = -1, depthScore = -INF;
    let complete = true;
    const scores = new Array(moves.length);
    let widened = 0;

    for (let attempt = 0; attempt < 3; attempt++) {
      depthBest = -1; depthScore = -INF;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        pos.makeMove(m);
        const cCnt = pos.repCount.get(pos.hash) || 0;
        const sc = cCnt >= 2 ? (pos.inCheck() ? -MATE : -30)
                             : -search(pos, depth - 1, -beta, -alpha, 1);
        pos.unmakeMove(m);
        scores[i] = sc;
        if (pos.cancelled) { complete = false; break; }
        if (sc > depthScore) { depthScore = sc; depthBest = m; }
        if (sc > alpha) alpha = sc;
        if (alpha >= beta) break;
      }
      /* aspiration failed? widen (at most twice) */
      if (!pos.cancelled && (a0 !== -INF || b0 !== INF) && widened < 2
          && Math.abs(lastScore) < MATE - 2000) {
        const failLow = a0 !== -INF && depthScore <= a0;
        const failHigh = b0 !== INF && depthScore >= b0;
        if (failLow || failHigh) {
          alpha = -INF; beta = INF;
          a0 = -INF; b0 = INF;
          widened++;
          continue;
        }
      }
      break;
    }

    if (complete && depthBest >= 0) {
      bestMove = depthBest;
      bestScore = depthScore;
      bestDepth = depth;
      lastScores = scores;
      lastScore = depthScore;
      if (Math.abs(depthScore) >= MATE - 2000) break; // forced mate found
    } else if (depth === 1) {
      /* even depth 1 was cut short — take best partial */
      for (let i = 0; i < moves.length; i++) {
        if (scores[i] !== undefined && scores[i] > bestScore) { bestScore = scores[i]; bestMove = moves[i]; }
      }
      bestDepth = 1;
      lastScores = scores;
    }
    if (pos.cancelled || Date.now() > pos.timeLimit) break;
  }

  const t = Date.now();
  return {
    move: bestMove, score: bestScore, depth: bestDepth,
    nodes: pos.nodes, nps: pos.nodes > 0 ? Math.round(pos.nodes / Math.max(1, t - t0) * 1000) : 0,
    timeMs: t - t0,
    allScores: lastScores, allMoves: moves
  };
}

/* =====================================================================
 *  Material / draw helpers
 * ===================================================================== */
function materialCounts(pos) {
  const b = pos.b;
  const cnt = { r: { K: 0, A: 0, E: 0, H: 0, R: 0, C: 0, P: 0 }, b: { K: 0, A: 0, E: 0, H: 0, R: 0, C: 0, P: 0 } };
  for (let s = 0; s < 90; s++) {
    const p = b[s];
    if (!p) continue;
    const t = p > 0 ? p : -p;
    const who = p > 0 ? 'r' : 'b';
    if (t === K) cnt[who].K++;
    else if (t === A) cnt[who].A++;
    else if (t === E) cnt[who].E++;
    else if (t === H) cnt[who].H++;
    else if (t === R) cnt[who].R++;
    else if (t === C) cnt[who].C++;
    else if (t === P) cnt[who].P++;
  }
  return cnt;
}

function isInsufficientMaterial(pos) {
  const m = materialCounts(pos);
  if (m.r.R + m.r.C + m.b.R + m.b.C > 0) return false;
  const rH = m.r.H, bH = m.b.H, rP = m.r.P, bP = m.b.P;
  if (rH === 0 && bH === 0 && rP === 0 && bP === 0) return true; // K(+A/E) vs K(+A/E)
  if (rH <= 1 && bH === 0 && rP === 0) return true;
  if (bH <= 1 && rH === 0 && bP === 0) return true;
  if (rH === 1 && bH === 1 && rP === 0 && bP === 0) return true;
  return false;
}

/* ---------- persistence strings ---------- */
const PCH = ['.', 'K', 'A', 'E', 'H', 'R', 'C', 'P', 'k', 'a', 'e', 'h', 'r', 'c', 'p'];
function boardToString(b) {
  let s = '';
  for (let i = 0; i < 90; i++) {
    const p = b[i];
    s += p === 0 ? '.' : p > 0 ? PCH[p] : PCH[7 - p];
  }
  return s;
}
function stringToBoard(s) {
  const b = new Int8Array(90);
  for (let i = 0; i < 90; i++) {
    const v = PCH.indexOf(s[i]);
    if (v <= 0) { b[i] = 0; continue; }
    b[i] = v <= 7 ? v : -(v - 7);
  }
  return b;
}
function positionToString(board, turn) {
  return boardToString(board) + (turn === 1 ? ' r' : ' b');
}
function parsePosition(s) {
  return { board: stringToBoard(s.slice(0, 90)), turn: s[91] === 'b' ? -1 : 1 };
}

/* ---------- public API ---------- */
return {
  K: K, A: A, E: E, H: H, R: R, C: C, P: P,
  setTTMax: function (n) { TT_MAX_V = n | 0; },
  VAL: VAL, MATE: MATE, INF: INF,
  PST: PST,
  initialBoard: initialBoard,
  Position: Position,
  genMoves: genMoves,
  genCaptures: genCaptures,
  isAttacked: isAttacked,
  countAttackers: countAttackers,
  evalAbs: evalAbs,
  search: search,
  rootSearch: rootSearch,
  materialCounts: materialCounts,
  isInsufficientMaterial: isInsufficientMaterial,
  boardToString: boardToString,
  stringToBoard: stringToBoard,
  positionToString: positionToString,
  parsePosition: parsePosition,
  moveFrom: function (m) { return m & 127; },
  moveTo: function (m) { return m >> 7; },
  /* UCI-XQ ("d0e1": file letter + rank 0-9, rank 0 = red home) <-> app move code.
     App board: index = row*9+col, row 0 = top (black home), col 0 = left. */
  uciToMove: function (u) {
    if (!u || u.length < 4) return -1;
    var f = (9 - (u.charCodeAt(1) - 48)) * 9 + (u.charCodeAt(0) - 97);
    var t = (9 - (u.charCodeAt(3) - 48)) * 9 + (u.charCodeAt(2) - 97);
    if (f < 0 || f > 89 || t < 0 || t > 89) return -1;
    return f | (t << 7);
  },
  moveToUci: function (m) {
    var f = m & 127, t = m >> 7;
    return 'abcdefghi'.charAt(f % 9) + (9 - (f / 9 | 0)) +
           'abcdefghi'.charAt(t % 9) + (9 - (t / 9 | 0));
  }
};

/* expose constants to the runtime global so code that eval()'d this file
   (e.g. JXA test harness) can also reference them */
(function (g) {
  if (!g) return;
  g.K = K; g.A = A; g.E = E; g.H = H; g.R = R; g.C = C; g.P = P;
  g.VAL = VAL; g.MATE = MATE; g.XQ = XQ;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

})();

if (typeof module !== 'undefined' && module.exports) module.exports = XQ;