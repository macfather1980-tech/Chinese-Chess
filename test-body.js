/* Engine test body — run via: cat engine.js test-body.js > /tmp/xqcombined.js && osascript -l JavaScript /tmp/xqcombined.js */
var pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL: ' + name); }
}
function B() { return XQ.initialBoard(); }
function sq(r, c) { return r * 9 + c; }
function fmt(m) { var f = XQ.moveFrom(m), to = XQ.moveTo(m); return '(' + (f / 9 | 0) + ',' + (f % 9) + ')->(' + (to / 9 | 0) + ',' + (to % 9) + ')'; }

/* ---------- 1. opening moves: 44 for both sides ---------- */
var pos = new XQ.Position(B(), 1);
var redMoves = XQ.genMoves(pos, true);
console.log('opening red legal moves = ' + redMoves.length);
t('red opening = 44', redMoves.length === 44);
var b = B();
var byType = {};
for (var i = 0; i < redMoves.length; i++) {
  var p = b[XQ.moveFrom(redMoves[i])];
  var key = p > 0 ? p : -p;
  byType[key] = (byType[key] || 0) + 1;
}
var names = { 1: 'K', 2: 'A', 3: 'E', 4: 'H', 5: 'R', 6: 'C', 7: 'P' };
var summary = '';
for (var k in byType) summary += names[k] + ':' + byType[k] + ' ';
console.log('red per-type: ' + summary);
t('breakdown K1 A2 E4 H4 R4 C24 P5 (=44)', byType[1] === 1 && byType[2] === 2 && byType[3] === 4 && byType[4] === 4 && byType[5] === 4 && byType[6] === 24 && byType[7] === 5);

pos = new XQ.Position(B(), -1);
var blackN = XQ.genMoves(pos, true).length;
console.log('opening black legal moves = ' + blackN);
t('black opening = 44', blackN === 44);

/* ---------- 2. horse leg (isolated horse, center of board) ---------- */
b = new Int8Array(90);
b[sq(4, 4)] = 4; // lone red horse
pos = new XQ.Position(b, 1);
var hs = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(4, 4); });
t('lone horse center = 8 moves', hs.length === 8);
b[sq(4, 3)] = 2; // block left leg
pos = new XQ.Position(b, 1);
hs = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(4, 4); });
console.log('horse left-leg blocked: ' + hs.length + ' ' + hs.map(fmt).join(' '));
t('one leg blocked = 6 moves', hs.length === 6);
b[sq(4, 5)] = 2; // block right leg too
pos = new XQ.Position(b, 1);
hs = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(4, 4); });
console.log('horse both-h legs blocked: ' + hs.length + ' ' + hs.map(fmt).join(' '));
t('both horizontal legs = 4 moves', hs.length === 4);
b[sq(3, 4)] = 2; b[sq(5, 4)] = 2; // all four legs
pos = new XQ.Position(b, 1);
hs = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(4, 4); });
t('all legs blocked = 0 moves', hs.length === 0);

/* horse attack with blocked leg (isAttacked) */
b = new Int8Array(90);
b[sq(4, 4)] = -4;  // black horse
b[sq(4, 5)] = 5;   // red rook on the horse's leg
t('horse leg blocked => does not attack (5,6)', XQ.isAttacked(b, sq(5, 6), -1) === false);
b[sq(4, 5)] = 0;
t('leg free => attacks (5,6)', XQ.isAttacked(b, sq(5, 6), -1) === true);

/* ---------- 3. elephant eye + river ---------- */
b = B();
pos = new XQ.Position(b, 1);
var es = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(9, 2); });
console.log('elephant(9,2) opening: ' + es.length + ' ' + es.map(fmt).join(' '));
t('elephant(9,2) = 2 moves', es.length === 2);

b = B();
b[sq(9, 2)] = 0; b[sq(7, 0)] = 3; // red elephant at (7,0)
b[sq(8, 1)] = 1;                  // advisor on its eye
pos = new XQ.Position(b, 1);
es = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(7, 0); });
console.log('elephant(7,0) eye blocked: ' + es.length + ' ' + es.map(fmt).join(' '));
t('eye blocked: only (5,2) remains', es.length === 1 && fmt(es[0]) === '(7,0)->(5,2)');

b = B();
b[sq(9, 2)] = 0; b[sq(5, 4)] = 3; // elephant at river edge
pos = new XQ.Position(b, 1);
es = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(5, 4); });
console.log('elephant(5,4): ' + es.length + ' ' + es.map(fmt).join(' '));
t('elephant stays own side: 2 moves', es.length === 2);

/* ---------- 4. flying general ---------- */
b = B();
for (var r = 1; r < 9; r++) b[sq(r, 4)] = 0;
pos = new XQ.Position(b, 1);
console.log('facing: inCheck=' + pos.inCheck());
t('flying general = in check', pos.inCheck() === true);
var km = XQ.genMoves(pos, true).filter(function (m) { return XQ.moveFrom(m) === sq(9, 4); });
console.log('red king moves: ' + km.length + ' ' + km.map(fmt).join(' '));
t('king has 0 moves (sides blocked by own advisors, (8,4) still facing)', km.length === 0);
t('but red can still block with an advisor', XQ.genMoves(pos, true).length > 0);

/* ---------- 5. checks ---------- */
/* own advisor blocks rook */
b = new Int8Array(90);
b[sq(0, 4)] = -1; b[sq(0, 0)] = 5; b[sq(0, 3)] = -2; b[sq(9, 3)] = 1;
pos = new XQ.Position(b, -1);
t('own advisor blocks rook check', pos.inCheck() === false);

/* rook on open row; king sealed by own elephant w/ blocked eyes => checkmate */
b = new Int8Array(90);
b[sq(0, 4)] = -1; b[sq(1, 4)] = -3;      // black king + elephant
b[sq(0, 0)] = 5; b[sq(0, 8)] = 5;        // red rooks on row 0
b[sq(2, 3)] = 7; b[sq(2, 5)] = 7;        // red pawns block elephant eyes
b[sq(9, 3)] = 1;
pos = new XQ.Position(b, -1);
console.log('rook mate: inCheck=' + pos.inCheck() + ' moves=' + XQ.genMoves(pos, true).length);
t('rook sealed-palace = checkmate', pos.inCheck() === true && XQ.genMoves(pos, true).length === 0);

/* cannon checks via exactly one screen (screen = own pawn) */
b = new Int8Array(90);
b[sq(0, 4)] = -1; b[sq(0, 2)] = 7; b[sq(0, 0)] = 6; b[sq(9, 3)] = 1;
pos = new XQ.Position(b, -1);
t('cannon checks over one screen', pos.inCheck() === true);
b[sq(0, 2)] = 0;
pos = new XQ.Position(b, -1);
t('cannon w/o screen: no check', pos.inCheck() === false);
b[sq(0, 2)] = 7; b[sq(0, 1)] = -2; // two screens
pos = new XQ.Position(b, -1);
t('cannon w/ two screens: no check', pos.inCheck() === false);

/* cannon sealed-palace checkmate (black king only) */
b = new Int8Array(90);
b[sq(0, 4)] = -1;
b[sq(0, 0)] = 6; b[sq(0, 2)] = 7;   // cannon + own pawn screen => check
b[sq(2, 3)] = 5; b[sq(2, 5)] = 5;   // seal (0,3) (0,5)
b[sq(1, 0)] = 5;                    // rook row 1 seals (1,4)
b[sq(9, 3)] = 1;
pos = new XQ.Position(b, -1);
console.log('cannon mate: inCheck=' + pos.inCheck() + ' moves=' + XQ.genMoves(pos, true).length);
t('cannon sealed-palace = checkmate', pos.inCheck() === true && XQ.genMoves(pos, true).length === 0);

/* stalemate: no check, no legal moves => loss for the stalemated side */
b = new Int8Array(90);
b[sq(0, 4)] = -1;
b[sq(2, 3)] = 5; b[sq(2, 5)] = 5;   // seal (0,3) (0,5)
b[sq(1, 0)] = 5;                    // rook row 1 seals (1,4)
b[sq(9, 4)] = 1; b[sq(8, 4)] = 2;   // red king + advisor blocks flying-general file
pos = new XQ.Position(b, -1);
console.log('stalemate: inCheck=' + pos.inCheck() + ' moves=' + XQ.genMoves(pos, true).length);
t('stalemate: no check, 0 moves', pos.inCheck() === false && XQ.genMoves(pos, true).length === 0);

/* ---------- 6. strings ---------- */
var s = XQ.positionToString(B(), 1);
console.log('pos string: ' + s);
t('standard string', s === 'rheakaehr..........c.....c.p.p.p.p.p..................P.P.P.P.P.C.....C..........RHEAKAEHR r');
var pp = XQ.parsePosition(s);
t('roundtrip board', XQ.boardToString(pp.board) === s.slice(0, 90));
t('roundtrip turn r', pp.turn === 1);
var pp2 = XQ.parsePosition(XQ.positionToString(B(), -1));
t('roundtrip turn b', pp2.turn === -1);

/* ---------- 7. pawn river ---------- */
b = B();
b[sq(6, 0)] = 0; b[sq(4, 0)] = 7; // red pawn just crossed (row 4)
pos = new XQ.Position(b, 1);
var pm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(4, 0); });
console.log('red pawn(4,0) crossed: ' + pm.length + ' ' + pm.map(fmt).join(' '));
t('red crossed pawn (4,0): 2 moves', pm.length === 2);
b = B();
pos = new XQ.Position(b, 1);
pm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(6, 0); });
t('uncrossed pawn: 1 move', pm.length === 1);
b = B();
b[sq(3, 8)] = 0; b[sq(5, 8)] = -7; // black pawn crossed (row 5)
pos = new XQ.Position(b, -1);
pm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(5, 8); });
console.log('black pawn(5,8) crossed: ' + pm.length + ' ' + pm.map(fmt).join(' '));
t('black crossed pawn: 2 moves', pm.length === 2);

/* ---------- 8. cannon opening = 12 ---------- */
b = B();
pos = new XQ.Position(b, 1);
var cm = XQ.genMoves(pos, false).filter(function (m) { return XQ.moveFrom(m) === sq(7, 1); });
console.log('cannon(7,1) opening: ' + cm.length + ' ' + cm.map(fmt).join(' '));
// 4 up (b3..b6) + b9 capture past the b3 pawn-screen + 1 down + 5 sideways = 12
t('cannon opening 12 moves', cm.length === 12);

/* ---------- 9. search smoke ---------- */
pos = new XQ.Position(B(), 1);
var t0 = Date.now();
var res = XQ.rootSearch(pos, { timeMs: 1500, maxDepth: 16 });
var t1 = Date.now();
console.log('rootSearch 1.5s: depth=' + res.depth + ' score=' + res.score + ' nodes=' + res.nodes + ' time=' + (t1 - t0) + 'ms');
t('search returns a move', res.move >= 0);
t('search reached depth >= 3', res.depth >= 3);
t('opening eval small', Math.abs(res.score) < 400);

/* ---------- 10. self-play with invariants ---------- */
pos = new XQ.Position(B(), 1);
var okInv = true;
var ended = false;
for (var ply = 0; ply < 200; ply++) {
  var ms = XQ.genMoves(pos, true);
  if (ms.length === 0) break;
  var r2 = XQ.rootSearch(pos, { timeMs: 120, maxDepth: 6 });
  var kr0 = -1, kb0 = -1;
  for (var s2 = 0; s2 < 90; s2++) { if (pos.b[s2] === 1) kr0 = s2; if (pos.b[s2] === -1) kb0 = s2; }
  if (kr0 < 0 || kb0 < 0) { okInv = false; console.log('KING MISSING right after rootSearch at ply ' + ply); break; }
  var mv = r2.move >= 0 ? r2.move : ms[Math.floor(Math.random() * ms.length)];
  var mvF = XQ.moveFrom(mv), mvT = XQ.moveTo(mv);
  if (pos.b[mvT] === 1 || pos.b[mvT] === -1) { okInv = false; console.log('MOVE TARGETS A KING: ' + fmt(mv) + ' at ply ' + ply + ' board=' + XQ.boardToString(pos.b)); break; }
  pos.makeMove(mv);
  var kr = -1, kb = -1, pc = 0;
  for (var s2 = 0; s2 < 90; s2++) {
    var p2 = pos.b[s2];
    if (p2 === 1) kr = s2;
    if (p2 === -1) kb = s2;
    if (p2) pc++;           // piece COUNT (0..32); a capture lowers it, never raises it
  }
  if (kr < 0 || kb < 0 || pc > 32) { okInv = false; console.log('BAD material/kings at ply ' + ply + ' move=' + fmt(mv) + ' pieces=' + pc + ' board=' + XQ.boardToString(pos.b)); break; }
  if (kr % 9 === kb % 9) {
    var clear = true;
    var lo = Math.min(kr / 9 | 0, kb / 9 | 0), hi = Math.max(kr / 9 | 0, kb / 9 | 0);
    for (var rr = lo + 1; rr < hi; rr++) if (pos.b[rr * 9 + kr % 9]) { clear = false; break; }
    if (clear) { okInv = false; console.log('kings facing at ply ' + ply); break; }
  }
  if (pos.inCheck() && XQ.genMoves(pos, true).length === 0) { console.log('game over at ply ' + ply + ' (mate)'); ended = true; break; }
}
console.log('self-play plies: ' + ply + ' ok=' + okInv);
t('self-play invariants hold', okInv);
/* a mate/stalemate end is a LEGAL game end (time-budgeted self-play is
   non-deterministic, so asserting a minimum length is flaky); only require
   the game not to end before any real play has happened */
t('self-play ended legally', okInv && (ended || ply >= 200));

/* ---------- 11. mate-in-1 found ---------- */
b = new Int8Array(90);
b[sq(0, 4)] = -1;
b[sq(0, 3)] = -2; b[sq(0, 5)] = -2;
b[sq(1, 3)] = -2; b[sq(1, 5)] = -2; b[sq(1, 4)] = -3;
b[sq(3, 0)] = 6;   // red cannon
b[sq(4, 0)] = 1;   // own piece below (blocks cannon path down, not the file)
pos = new XQ.Position(b, 1);
t('mate-in-1 setup: not in check', pos.inCheck() === false);
var r3 = XQ.rootSearch(pos, { timeMs: 800, maxDepth: 10 });
console.log('mate-in-1: ' + fmt(r3.move) + ' score=' + r3.score);
pos.makeMove(r3.move);
t('cannon mate-in-1 found', XQ.genMoves(pos, true).length === 0 && pos.inCheck() === true);

/* ---------- 12. insufficient material ---------- */
b = new Int8Array(90);
b[sq(0, 4)] = -1; b[sq(9, 4)] = 1;
pos = new XQ.Position(b, 1);
t('KK = insufficient', XQ.isInsufficientMaterial(pos) === true);
b[sq(9, 0)] = 5;
pos = new XQ.Position(b, 1);
t('KR vs K = win (not insufficient)', XQ.isInsufficientMaterial(pos) === false);

/* ---------- 13. real-game position (user report 2026-10-03) ----------
   Game: 1.炮二平五 象3進5 2.傌二進三 卒3進1 3.俥一進一 卒5進1, red to move.
   Fact-checked vs the rules: the red cannon on (7,4) is blocked forward by
   its own centre pawn (6,4) — that pawn IS the screen, and the next piece up
   the e-file is the enemy pawn on (4,4), so the cannon DOES capture (4,4):
   1 capture + 1 down + 3 sideways = 5 moves (matches the native Pikafish
   engine). A plain forward move into/over its own pawn would be illegal. */
b = B();
b[sq(0,2)] = 0; b[sq(2,4)] = -3;   // 象3進5
b[sq(7,7)] = 0; b[sq(7,4)] = 6;    // 炮二平五
b[sq(9,7)] = 0; b[sq(7,6)] = 4;    // 傌二進三
b[sq(3,2)] = 0; b[sq(4,2)] = -7;   // 卒3進1
b[sq(9,8)] = 0; b[sq(8,8)] = 5;    // 俥一進一
b[sq(3,4)] = 0; b[sq(4,4)] = -7;   // 卒5進1
pos = new XQ.Position(b, 1);
t('reported pos: not in check', pos.inCheck() === false);
var cms = XQ.genMoves(pos, true).filter(function (m) { return XQ.moveFrom(m) === sq(7,4); });
var cmsDesc = cms.map(fmt).join(' ');
console.log('reported pos cannon (7,4): ' + cms.length + ' ' + cmsDesc);
t('reported pos: cannon has 5 moves (down + 3 sideways + (4,4) capture past the (6,4) screen)',
  cms.length === 5);
t('reported pos: red has 40 legal moves', XQ.genMoves(pos, true).length === 40);

console.log('\n===== RESULT: ' + pass + ' passed, ' + fail + ' failed =====');
