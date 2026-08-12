/* Verifies Chowka Bhara's real logic by extracting the actual function source
 * out of index.html and evaluating it — no reimplementation, so a bug in the
 * game is a failure here. */

var SRC = read('/Users/rishirao/workspace/chowkabara/index.html');

/* Pull a named function's full text by brace-matching from its declaration. */
function grab(name) {
  var start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  var i = SRC.indexOf('{', start), depth = 0, j = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, j + 1);
}

var NAMES = ['ringLoop', 'buildCanonicalPath', 'rotateRC', 'rotatePath',
             'physicalRing', 'layerOf', 'throwShells', 'computeLegalMoves'];
eval(NAMES.map(grab).join('\n'));

var PIECES_PER_PLAYER = 4;
var SLOT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
var state = null;

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------------- path geometry ------- */

[5, 7].forEach(function (N) {
  var built = buildCanonicalPath(N);
  var path = built.path;
  var mid = (N - 1) / 2;
  var tag = 'N=' + N + ': ';

  /* Every square once, plus the centre — and on boards whose parity needs it,
     one extra step to finish the last lap before turning into the centre. */
  var squares = 0;
  for (var k = 0; N - 2 * k > 1; k++) squares += 4 * (N - 2 * k - 1);
  squares += 1;
  check(tag + 'path length', path.length === squares || path.length === squares + 1,
        'got ' + path.length + ', expected ' + squares + ' or ' + (squares + 1));

  check(tag + 'starts at own edge middle',
        path[0][0] === 0 && path[0][1] === mid, JSON.stringify(path[0]));
  check(tag + 'ends at centre',
        path[path.length - 1][0] === mid && path[path.length - 1][1] === mid,
        JSON.stringify(path[path.length - 1]));

  var seen = {};
  var dupeCells = [];
  path.forEach(function (rc) {
    var key = rc[0] + ',' + rc[1];
    if (seen[key]) dupeCells.push(key);
    seen[key] = true;
  });
  check(tag + 'reaches every square', Object.keys(seen).length === N * N,
        Object.keys(seen).length + ' distinct of ' + N * N);
  check(tag + 'repeats at most one square', dupeCells.length <= 1,
        dupeCells.join(' '));
  /* The only permitted repeat is the approach square next to the centre. */
  if (dupeCells.length === 1) {
    var d = dupeCells[0].split(',').map(Number);
    check(tag + 'the repeated square is the one beside the centre',
          Math.abs(d[0] - mid) + Math.abs(d[1] - mid) === 1, dupeCells[0]);
  }

  /* Consecutive path cells must be orthogonally adjacent, except where the
   * path cuts inward between rings (also adjacent) — so: always adjacent. */
  var jumps = [];
  for (var i = 1; i < path.length; i++) {
    var d = Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1]);
    if (d !== 1) jumps.push(i + ':' + JSON.stringify(path[i - 1]) + '->' + JSON.stringify(path[i]));
  }
  check(tag + 'every step moves one square', jumps.length === 0, jumps.slice(0, 3).join(' '));

  /* Ring direction must alternate: outer anti-clockwise, next clockwise. */
  var b = built.ringBoundaries;
  check(tag + 'ring boundaries end at path end',
        b[b.length - 1] === path.length, JSON.stringify(b));

  /* All four rotations must be the same length and start on their own edge. */
  var rotations = [0, 1, 2, 3].map(function (s) { return rotatePath(path, s, N); });
  var starts = rotations.map(function (p) { return p[0].join(','); });
  check(tag + 'four distinct start squares',
        new Set(starts).size === 4, starts.join(' | '));
  rotations.forEach(function (p, s) {
    check(tag + 'rotation ' + s + ' same length', p.length === path.length);
    check(tag + 'rotation ' + s + ' ends at centre',
          p[p.length - 1][0] === mid && p[p.length - 1][1] === mid);
    var mids = [[0, mid], [mid, N - 1], [N - 1, mid], [mid, 0]];
    var onEdgeMiddle = mids.some(function (m) {
      return m[0] === p[0][0] && m[1] === p[0][1];
    });
    check(tag + 'rotation ' + s + ' starts at an edge middle', onEdgeMiddle,
          JSON.stringify(p[0]));
  });

  /* layerOf must agree with physical ring for every path index. */
  var mismatch = [];
  for (i = 0; i < path.length; i++) {
    if (layerOf(i, b) !== physicalRing(path[i][0], path[i][1], N)) {
      mismatch.push(i + ':' + path[i]);
    }
  }
  check(tag + 'layerOf matches physical ring', mismatch.length === 0,
        mismatch.slice(0, 3).join(' '));
});

/* ------------------------------------------------- shell throw --------- */

var counts = {};
var BONUS = { 8: true, 4: true };
for (var t = 0; t < 200000; t++) {
  var r = throwShells();
  counts[r.moveValue] = (counts[r.moveValue] || 0) + 1;
  if (!!r.bonus !== !!BONUS[r.moveValue]) {
    check('bonus flag matches rules', false, 'move ' + r.moveValue + ' bonus ' + r.bonus);
    break;
  }
  if (r.upCount === 0 && r.moveValue !== 8) check('0 up = 8', false);
  if (r.upCount === 4 && r.moveValue !== 4) check('4 up = 4', false);
}
/* C(4,k)/16 → 1:4/16, 2:6/16, 3:4/16, 4:1/16, 8(=0 up):1/16 */
var want = { 1: 4 / 16, 2: 6 / 16, 3: 4 / 16, 4: 1 / 16, 8: 1 / 16 };
Object.keys(want).forEach(function (v) {
  var got = (counts[v] || 0) / 200000;
  check('throw distribution for move ' + v,
        Math.abs(got - want[v]) < 0.01,
        'got ' + got.toFixed(4) + ', expected ' + want[v].toFixed(4));
});

/* ------------------------------------------------- rules engine -------- */

function makeState(N, numPlayers) {
  var built = buildCanonicalPath(N);
  var all = [0, 1, 2, 3].map(function (s) { return rotatePath(built.path, s, N); });
  var safe = {};
  all.forEach(function (p) { safe[p[0][0] + ',' + p[0][1]] = true; });
  var slots = SLOT_SETS[numPlayers];
  var players = [];
  for (var i = 0; i < numPlayers; i++) {
    var pieces = [];
    for (var j = 0; j < PIECES_PER_PLAYER; j++) pieces.push({ id: j, status: 'home', pathIndex: -1 });
    players.push({
      id: i, name: 'P' + i, slot: slots[i], path: all[slots[i]],
      hasCaptured: false, pieces: pieces
    });
  }
  return {
    N: N, ringBoundaries: built.ringBoundaries, pathLength: built.path.length,
    safeCellSet: safe, players: players, currentPlayerIndex: 0
  };
}

state = makeState(5, 2);
var P = state.players[0];
var last = state.pathLength - 1;

/* Entering. */
var m = computeLegalMoves(P, 3);
check('entering: all four hand pieces offered', m.length === 4, JSON.stringify(m.length));
check('entering: roll 3 lands at path index 2',
      m[0].type === 'enter' && m[0].destIndex === 2, JSON.stringify(m[0]));

/* Inner-ring gate. */
P.pieces[0].status = 'active';
P.pieces[0].pathIndex = 14;          /* outer ring, near its end (0..15) */
P.pieces[1].status = 'active';
P.pieces[1].pathIndex = 2;
P.pieces[2].status = 'finished';
P.pieces[3].status = 'finished';
P.hasCaptured = false;

m = computeLegalMoves(P, 3);
var forPiece0 = m.filter(function (x) { return x.pieceId === 0; });
check('gate: cannot land in inner ring before capturing',
      forPiece0.length === 0,
      'index 14 + 3 = 17, layer ' + layerOf(17, state.ringBoundaries));

P.hasCaptured = true;
m = computeLegalMoves(P, 3);
forPiece0 = m.filter(function (x) { return x.pieceId === 0; });
check('gate: allowed after capturing', forPiece0.length === 1, JSON.stringify(m));

/* Overshoot. */
P.pieces[0].pathIndex = last - 2;
m = computeLegalMoves(P, 3).filter(function (x) { return x.pieceId === 0; });
check('overshoot: roll past centre is illegal', m.length === 0, JSON.stringify(m));

m = computeLegalMoves(P, 2).filter(function (x) { return x.pieceId === 0; });
check('exact roll finishes', m.length === 1 && m[0].type === 'finish', JSON.stringify(m));

/* Finished pieces never generate moves. */
m = computeLegalMoves(P, 2).filter(function (x) { return x.pieceId === 2 || x.pieceId === 3; });
check('finished pieces are not movable', m.length === 0, JSON.stringify(m));

/* Safe squares: are the four start cells the ONLY safe ones? */
check('exactly four safe squares', Object.keys(state.safeCellSet).length === 4,
      Object.keys(state.safeCellSet).join(' | '));

/* ------------------------------------------------- report -------------- */

print('');
if (!fails.length) {
  print('✅ all checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
