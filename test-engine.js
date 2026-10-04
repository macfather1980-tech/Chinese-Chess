/* Engine test suite — run:  node test-engine.js
   (or: osascript -l JavaScript test-engine.js on a machine whose JXA
    ObjC bridge works — this machine's osascript ObjC.import is broken,
    so Node is the default here).
   NOTE 2026-10-04: expectations re-verified against the rules. The old
   numbers (cannon=10, king side-escapes=2, "mate"=0 moves, ...) were
   computed against the pre-fix engine / confused board setups. */

var XQ, K, A, E, H, R, C, P;
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  XQ = require(__dirname + '/engine.js');   // engine.js also sets globalThis.XQ/K/.../P
} else {
  ObjC.import('foundation');
  function readText(p) {
    return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null));
  }
  eval(readText('/Users/UaenaSzeto/Documents/LLM_Apps/Chinese Chess V2/engine.js'));
}

var pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name); }
}
function B() { return XQ.initialBoard(); }
function sq(r, c) { return r * 9 + c; }

/* ---------- 1. opening move count ---------- */
var pos = new XQ.Position(B(), 1);
var redMoves = XQ.genMoves(pos, true);
console.log('opening red legal moves = ' + redMoves.length);
t('opening moves = 44?', redMoves.length === 44);
/* per-piece breakdown for reference */
var b = B();
var byType = {};
for (var i = 0; i < redMoves.length; i++) {
  var p = b[XQ.moveFrom(redMoves[i])];
  byType[p > 0 ? p : -p] = (byType[p > 0 ? p : -p] || 0) + 1;
}
console.log('red per-type: ' + JSON.stringify(byType));
t('opening breakdown K1 A2 E4 H4 R4 C24 P5', byType[1] === 1 && byType[2] === 2 && byType[3] === 4 && byType[4] === 4 && byType[5] === 4 && byType[6] === 24 && byType[7] === 5);

/* black opening */
pos = new XQ.Position(B(), -1);
console.log('opening black legal moves = ' + XQ.genMoves(pos, true).length);
t('opening black = 44', XQ.genMoves(pos, true).length === 44);

/* ---------- 2. horse leg ----------
   board = initial, horse moved (9,1)->(8,1), advisor parked on (7,1).
   8 L-shapes: (6,0),(6,2) legs blocked by the advisor; (10,*),( *,-1)
   off-board; (7,3) legal; (9,3) occupied by own advisor. => 1 move. */
b = B();
b[sq(9, 1)] = 0;
b[sq(8, 1)] = 4;           // red horse at (8,1)
b[sq(7, 1)] = 2;           // advisor on the vertical leg square
pos = new XQ.Position(b, 1);
var hs = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(8, 1); });
console.log('horse (8,1) with blocked leg moves: ' + hs.length);
t('horse: blocked legs + own piece = 1 move', hs.length === 1);

/* ---------- 3. elephant eye + no river crossing ---------- */
b = B();
pos = new XQ.Position(b, 1);
var es = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(9, 2); });
console.log('elephant (9,2) opening moves: ' + es.length);
t('elephant (9,2) has 2 moves', es.length === 2);
/* elephant moved to (7,0); eye (8,1) blocked by own general:
   (7,0)->(9,2) blocked, but (7,0)->(5,2) (eye (6,1) free, own side) is legal */
b = B();
b[sq(9, 2)] = 0; b[sq(7, 0)] = 3;
b[sq(8, 1)] = 1; // own general on the eye of (7,0)->(9,2)
pos = new XQ.Position(b, 1);
es = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(7, 0); });
console.log('elephant (7,0) with eye blocked moves: ' + es.length);
t('elephant: one eye blocked still has the other diagonal = 1', es.length === 1);

/* ---------- 4. flying general ---------- */
b = B();
/* remove everything between kings on file 4, keep kings: red K (9,4), black K (0,4) */
for (var r = 1; r < 9; r++) b[sq(r, 4)] = 0;
pos = new XQ.Position(b, 1);
var kingsFacing = XQ.isAttacked(b, sq(9, 4), -1);
t('flying general detected', kingsFacing === true);
/* Red K in check: (8,4) stays facing -> illegal; (9,3)/(9,5) are its own
   advisors -> not reachable. So the general has NO legal move here. */
var km = XQ.genMoves(pos, true).filter(function (m) { return XQ.moveFrom(m) === sq(9, 4); });
console.log('red king escapes: ' + km.length);
t('facing king has 0 escapes (own advisors, forward still facing)', km.length === 0);

/* ---------- 5. check / "seal" positions ----------
   Rook (0,0) vs king (0,4) with OWN advisor at (0,3): the rook's rank attack
   stops at the advisor => NOT a check. The advisors (1,3)/(1,5) can still
   step to (2,4) (file 4 stays blocked by own elephant) => 2 legal moves. */
b = new Int8Array(90);
b[sq(0, 4)] = -1;  // black general
b[sq(0, 3)] = -2; b[sq(0, 5)] = -2; // advisors seal the rank
b[sq(1, 3)] = -2; b[sq(1, 5)] = -2; b[sq(1, 4)] = -3; // sealed palace
b[sq(0, 0)] = 5;   // red rook on row 0 (blocked by the (0,3) advisor)
b[sq(9, 4)] = 1;   // red general
pos = new XQ.Position(b, -1);
console.log('rook "seal" pos: inCheck=' + pos.inCheck() + ' moves=' + XQ.genMoves(pos, true).length);
t('own advisor blocks rook => not in check', pos.inCheck() === false);
t('advisor (1,3)/(1,5) can step to (2,4): 2 moves', XQ.genMoves(pos, true).length === 2);

/* stalemate (no check, no moves) => loss
   Red advisors/rooks on row 8 seal the file (flying-general safe) and the
   row; but the black advisors and elephant STILL have palace moves, so this
   position is NOT a stalemate: 4 legal moves (2 advisors -> (2,4),
   elephant (1,4) -> (3,2)/(3,6), file stays blocked by red advisor (8,4)). */
b = new Int8Array(90);
b[sq(0, 4)] = -1;
b[sq(0, 3)] = -2; b[sq(0, 5)] = -2;
b[sq(1, 3)] = -2; b[sq(1, 5)] = -2; b[sq(1, 4)] = -3;
b[sq(9, 4)] = 1;
b[sq(8, 4)] = 2; // red advisor on the file (blocks flying general)
b[sq(8, 3)] = 5; b[sq(8, 5)] = 5; // red rooks sealing row 8
pos = new XQ.Position(b, -1);
console.log('row-8 sealed pos: inCheck=' + pos.inCheck() + ' moves=' + XQ.genMoves(pos, true).length);
t('not in check, 4 palace moves remain', pos.inCheck() === false && XQ.genMoves(pos, true).length === 4);

/* true stalemate (困毙): the black general's only squares are its own
   advisors/elephant; both advisors' escape (1,4) is the own elephant;
   the elephant's both eyes (2,3)/(2,5) are sealed by red pawns. Red rook
   (3,4) attacks only the elephant (first piece on file 4) => no check. */
b = new Int8Array(90);
b[sq(0, 4)] = -1;
b[sq(0, 3)] = -2; b[sq(0, 5)] = -2;
b[sq(1, 4)] = -3; // own elephant seals the general's forward square
b[sq(2, 3)] = 7; b[sq(2, 5)] = 7;  // red pawns on the elephant's eyes
b[sq(9, 4)] = 1;
b[sq(3, 4)] = 5; // red rook: checks the elephant, blocks the file, not the king
pos = new XQ.Position(b, -1);
console.log('true stalemate: inCheck=' + pos.inCheck() + ' moves=' + XQ.genMoves(pos, true).length);
t('true stalemate = 0 moves, not in check', pos.inCheck() === false && XQ.genMoves(pos, true).length === 0);

/* ---------- 6. board string roundtrip ---------- */
var s = XQ.positionToString(B(), 1);
var pp = XQ.parsePosition(s);
t('roundtrip board', XQ.boardToString(pp.board) === s.slice(0, 90));
t('roundtrip turn', pp.turn === 1);
t('position string len', s.length === 92);

/* ---------- 7. pawn river ----------
   row 4/5 split: black half = rows 0..4, red half = rows 5..9.
   A red pawn on row 5 has NOT crossed (crossed = row <= 4). */
b = B();
b[sq(6, 0)] = 0; b[sq(5, 0)] = 7;   // red pawn advanced one, still own half
pos = new XQ.Position(b, 1);
var pm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(5, 0); });
console.log('red pawn (5,0) own-half moves: ' + pm.length);
t('own-half edge pawn = 1 (forward only)', pm.length === 1);
b[sq(6, 0)] = 0; b[sq(4, 0)] = 7;   // red pawn that HAS crossed
pos = new XQ.Position(b, 1);
pm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(4, 0); });
console.log('red pawn (4,0) crossed moves: ' + pm.length);
t('crossed edge pawn = 2 (forward + sideways)', pm.length === 2);
b = B();
pos = new XQ.Position(b, 1);
pm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(6, 0); });
t('uncrossed pawn 1 move', pm.length === 1);

/* ---------- 8. cannon screen ----------
   Rules (official): the 砲架 (screen) may be ANY piece, own or enemy.
   Opening cannon (7,1): 4 up + capture of the black horse (0,1) over the
   black cannon (2,1) screen + 1 down + 6 sideways = 12. */
b = B();
pos = new XQ.Position(b, 1);
var cm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(7, 1); });
console.log('cannon (7,1) opening moves: ' + cm.length);
t('cannon opening = 12 (incl. capture past the enemy-cannon screen)', cm.length === 12);

/* reported bug repro (2026-10-04 screenshot): center cannon (7,4) must be
   able to take the black pawn (4,4) over its OWN pawn (6,4) as screen. */
b = new Int8Array(90);
b[sq(7, 4)] = 6;   // red center cannon
b[sq(6, 4)] = 7;   // own center pawn = the screen
b[sq(4, 4)] = -7;  // black pawn two squares past the screen
b[sq(9, 4)] = 1; b[sq(0, 4)] = -1;
pos = new XQ.Position(b, 1);
cm = XQ.genMoves(pos, true).filter(function (m) { return XQ.moveFrom(m) === sq(7, 4); });
console.log('cannon (7,4) vs own screen: ' + cm.length + ' moves ' + cm.map(function (m) { return '(' + (XQ.moveTo(m) / 9 | 0) + ',' + (XQ.moveTo(m) % 9) + ')'; }).join(' '));
t('cannon takes over OWN pawn screen (reported bug)', cm.some(function (m) { return XQ.moveTo(m) === sq(4, 4); }));

/* ---------- 9. search smoke: initial position ---------- */
pos = new XQ.Position(B(), 1);
var t0 = Date.now();
var res = XQ.rootSearch(pos, { timeMs: 1500, maxDepth: 12 });
var t1 = Date.now();
console.log('rootSearch 1.5s: depth=' + res.depth + ' score=' + res.score + ' nodes=' + res.nodes + ' time=' + (t1 - t0) + 'ms move=' + res.move);
t('search returns a move', res.move >= 0);

/* ---------- 10. self-play with invariants ----------
   Invariants (re-verified): piece count never exceeds 32 and never grows;
   kings always present; kings never face across a clear file. */
pos = new XQ.Position(B(), 1);
var okInvariants = true;
var maxSeen = 32;   // initial board has 32 pieces; captures can only reduce the count
for (var ply = 0; ply < 200; ply++) {
  var ms = XQ.genMoves(pos, true);
  if (ms.length === 0) break;
  /* engine move, short budget */
  var r2 = XQ.rootSearch(pos, { timeMs: 120, maxDepth: 6 });
  var mv = r2.move >= 0 ? r2.move : ms[0];
  pos.makeMove(mv);
  /* invariants */
  var kr = -1, kb = -1, pc = 0;
  for (var s2 = 0; s2 < 90; s2++) {
    var p2 = pos.b[s2];
    if (p2 === 1) kr = s2;
    if (p2 === -1) kb = s2;
    if (p2) pc++;
  }
  if (kr < 0 || kb < 0) { okInvariants = false; console.log('king missing at ply ' + ply); break; }
  if (kr === kb) { okInvariants = false; console.log('kings on same square at ply ' + ply); break; }
  if (kr % 9 === kb % 9) {
    var clear = true;
    var lo = Math.min(kr / 9 | 0, kb / 9 | 0), hi = Math.max(kr / 9 | 0, kb / 9 | 0);
    for (var rr = lo + 1; rr < hi; rr++) if (pos.b[rr * 9 + kr % 9]) { clear = false; break; }
    if (clear) { okInvariants = false; console.log('kings facing at ply ' + ply); break; }
  }
  if (pc > 32) { okInvariants = false; console.log('piece count ' + pc + ' > 32 at ply ' + ply); break; }
  if (pc > maxSeen) { okInvariants = false; console.log('material grew at ply ' + ply + ': ' + maxSeen + ' -> ' + pc); break; }
  maxSeen = pc;
}
console.log('self-play plies: ' + ply + ', final turn=' + pos.turn + ', ok=' + okInvariants);
t('self-play invariants hold', okInvariants);

/* ---------- 11. mate-in-1 found by search ----------
   Cannon (3,0)->(0,0): the (0,3) advisor is the screen => check on the
   king (0,4). Every black reply keeps the (0,3) advisor (or the elephant)
   between cannon and king, or moves the checking screen out of the way
   only for its own piece -> no escape: mate. */
b = new Int8Array(90);
b[sq(0, 4)] = -1;
b[sq(0, 3)] = -2; b[sq(0, 5)] = -2;
b[sq(1, 3)] = -2; b[sq(1, 5)] = -2; b[sq(1, 4)] = -3;
b[sq(3, 0)] = 6;  // red cannon
b[sq(9, 4)] = 1;
pos = new XQ.Position(b, 1);
t('not in check yet', pos.inCheck() === false);
var r3 = XQ.rootSearch(pos, { timeMs: 800, maxDepth: 8 });
var from = XQ.moveFrom(r3.move), to = XQ.moveTo(r3.move);
console.log('mate-in-1 candidate: from=' + from + ' to=' + to + ' score=' + r3.score);
pos.makeMove(r3.move);
var mated = XQ.genMoves(pos, true).length === 0 && pos.inCheck();
t('cannon mate-in-1 found', mated);

console.log('\n===== RESULT: ' + pass + ' passed, ' + fail + ' failed =====');
if (typeof process !== 'undefined') process.exit(fail ? 1 : 0);
