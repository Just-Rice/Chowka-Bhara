/* Verifies Chowka Bhara's real logic by extracting the actual function source
 * out of index.html and evaluating it — no reimplementation, so a bug in the
 * game is a failure here. */

/* The game is split across js/ modules now, so read them all and let grab()
   pick functions out of the combined source exactly as before. */
var SRC = ['config','path','rules','ai','render','game','online','main']
  .map(function (n) { return read('js/' + n + '.js'); }).join('\n');

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

var NAMES = ['ringLoop', 'ringCorners', 'turnInward', 'buildCanonicalPath', 'rotateRC', 'rotatePath',
             'physicalRing', 'layerOf', 'throwShells', 'computeLegalMoves'];
eval(NAMES.map(grab).join('\n'));

/* The piece count, the cowrie count and the throw table are now board-
   dependent, so take the real ones rather than a stub that can drift. */
eval(['piecesPerPlayer', 'shellCount', 'throwOutcome', 'binomial', 'rollOdds',
      'buildSafeCells', 'seatCount']
     .map(grab).join('\n'));
var ROLL_ODDS_BY_N = {};
var SLOT_SETS = { 2: [0, 2], 4: [0, 1, 2, 3] };
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
  check(tag + 'walks no square twice', dupeCells.length === 0, dupeCells.join(' '));

  /* Every step is to a neighbouring square. Straight is the rule; the single
     exception is the 7x7 turning off its outer ring, where the corner it has
     to reach sits diagonally. Anything else — a second diagonal, or a jump of
     more than one square — is a broken board. */
  var far = [], diagonals = [];
  for (var i = 1; i < path.length; i++) {
    var dr = Math.abs(path[i][0] - path[i - 1][0]);
    var dc = Math.abs(path[i][1] - path[i - 1][1]);
    var where = i + ':' + JSON.stringify(path[i - 1]) + '->' + JSON.stringify(path[i]);
    if (dr > 1 || dc > 1) far.push(where);
    else if (dr === 1 && dc === 1) diagonals.push(where);
  }
  check(tag + 'no step reaches further than a neighbouring square',
        far.length === 0, far.slice(0, 3).join(' '));
  check(tag + 'exactly ' + (N === 7 ? 'one diagonal step' : 'no diagonal step'),
        diagonals.length === (N === 7 ? 1 : 0), diagonals.join(' '));
  if (N === 7) {
    check(tag + 'and it is the turn off the outer ring into the corner',
          diagonals[0] === '24:[0,4]->[1,5]', diagonals[0]);
  }

  /* Each lap has to finish back on the player's own side of its ring, which is
     what decides the direction it runs and where it turns inward. */
  var at = 0;
  built.ringBoundaries.forEach(function (end, ring) {
    if (end - at > 1) {
      var tail = path[end - 1];
      check(tag + 'ring ' + ring + ' finishes on the near side',
            tail[0] === ring, JSON.stringify(tail));
    }
    at = end;
  });

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

/* ------------------------------------------------- the exact route ----- */

/* Both boards written out square by square, as "rowcol". The route is a design
   decision rather than something derived, so it is pinned here: any change to
   it has to be a deliberate change to this list too, not a side effect. */
var ROUTES = {
  5: ('02 01 00 10 20 30 40 41 42 43 44 34 ' +
      '24 14 04 03 13 23 33 32 31 21 11 12 ' +
      '22').trim().split(/\s+/),
  7: ('03 02 01 00 10 20 30 40 50 60 61 62 ' +
      '63 64 65 66 56 46 36 26 16 06 05 04 ' +
      '15 25 35 45 55 54 53 52 51 41 31 21 ' +
      '11 12 13 14 24 34 44 43 42 32 22 23 ' +
      '33').trim().split(/\s+/)
};

Object.keys(ROUTES).forEach(function (n) {
  var N = parseInt(n, 10);
  var got = buildCanonicalPath(N).path.map(function (rc) { return '' + rc[0] + rc[1]; });
  var want = ROUTES[n];
  var firstDiff = -1;
  for (var i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] !== want[i]) { firstDiff = i; break; }
  }
  check(N + 'x' + N + ': the route is square for square what it should be',
        firstDiff < 0,
        firstDiff < 0 ? '' : 'step ' + firstDiff + ' is ' + got[firstDiff] +
                             ', should be ' + want[firstDiff]);
  check(N + 'x' + N + ': and the right length',
        got.length === want.length, got.length + ' vs ' + want.length);
});

/* ------------------------------------------------- shell throw --------- */

/* Both boards, against the tables written out by hand here rather than
   generated from the same code being tested. 5x5 is the four-cowrie game;
   7x7 is played with six, where a throw of six and a throw of nothing are the
   two that earn another turn, worth 6 and 12. */
var THROWS = [
  { N: 5, shells: 4, bonus: { 4: true, 8: true },
    want: { 1: 4 / 16, 2: 6 / 16, 3: 4 / 16, 4: 1 / 16, 8: 1 / 16 } },
  { N: 7, shells: 6, bonus: { 6: true, 12: true },
    want: { 1: 6 / 64, 2: 15 / 64, 3: 20 / 64, 4: 15 / 64, 5: 6 / 64,
            6: 1 / 64, 12: 1 / 64 } }
];

THROWS.forEach(function (board) {
  var tag = board.N + 'x' + board.N + ': ';
  var counts = {}, rolls = 200000, bad = null;

  for (var i = 0; i < rolls; i++) {
    var r = throwShells(board.N);
    counts[r.moveValue] = (counts[r.moveValue] || 0) + 1;
    if (r.shells.length !== board.shells) { bad = 'threw ' + r.shells.length + ' cowries'; break; }
    if (!!r.bonus !== !!board.bonus[r.moveValue]) {
      bad = 'move ' + r.moveValue + ' gave bonus ' + r.bonus; break;
    }
    if (r.upCount === 0 && r.moveValue !== board.shells * 2) {
      bad = 'none up gave ' + r.moveValue; break;
    }
    if (r.upCount === board.shells && r.moveValue !== board.shells) {
      bad = 'all up gave ' + r.moveValue; break;
    }
    if (r.upCount > 0 && r.upCount < board.shells && r.moveValue !== r.upCount) {
      bad = r.upCount + ' up gave ' + r.moveValue; break;
    }
  }
  check(tag + 'every throw follows the rules', bad === null, bad);

  Object.keys(board.want).forEach(function (v) {
    var got = (counts[v] || 0) / rolls;
    check(tag + 'throw distribution for move ' + v,
          Math.abs(got - board.want[v]) < 0.01,
          'got ' + got.toFixed(4) + ', expected ' + board.want[v].toFixed(4));
  });

  var seen = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
  var expected = Object.keys(board.want).map(Number).sort(function (a, b) { return a - b; });
  check(tag + 'no throw outside the table', seen.join() === expected.join(),
        'saw ' + seen.join() + ', expected ' + expected.join());

  /* The computer weighs its moves against these odds, so they have to be the
     same odds the cowries actually produce. */
  var odds = rollOdds(board.N);
  var total = 0, wrong = [];
  odds.forEach(function (o) {
    total += o.p;
    if (Math.abs(o.p - board.want[o.value]) > 1e-9) {
      wrong.push(o.value + ' at ' + o.p);
    }
  });
  check(tag + 'the odds the computer uses match the cowries',
        wrong.length === 0, wrong.join(' '));
  check(tag + 'and they add up to one', Math.abs(total - 1) < 1e-9, String(total));
});

/* Pieces a side, which is the other half of the change. */
check('the small board is played with four pieces a side', piecesPerPlayer(5) === 4);
check('the large board is played with six', piecesPerPlayer(7) === 6);

/* ------------------------------------------------- rules engine -------- */

function makeState(N, numPlayers) {
  var built = buildCanonicalPath(N);
  var all = [0, 1, 2, 3].map(function (s) { return rotatePath(built.path, s, N); });
  var safe = buildSafeCells(N, all);
  var slots = SLOT_SETS[numPlayers];
  var players = [];
  for (var i = 0; i < numPlayers; i++) {
    var pieces = [];
    for (var j = 0; j < piecesPerPlayer(N); j++) pieces.push({ id: j, status: 'active', pathIndex: 0 });
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

/* Pieces start on the board, so a roll always moves its full value. */
check('pieces start on the start square',
      P.pieces.every(function (pc) { return pc.status === 'active' && pc.pathIndex === 0; }),
      JSON.stringify(P.pieces));

P.hasCaptured = true;
var m = computeLegalMoves(P, 2);
check('all four pieces can move', m.length === 4, JSON.stringify(m.length));
check('a roll of 2 moves two squares, not one',
      m[0].type === 'move' && m[0].destIndex === 2, JSON.stringify(m[0]));
check('no move is ever an "enter"',
      m.every(function (x) { return x.type !== 'enter'; }), JSON.stringify(m));
P.hasCaptured = false;

/* Inner-ring gate. */
P.pieces[0].pathIndex = 14;          /* outer ring, near its end (0..15) */
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

/* ------------------------------------------------------- seating ------- */

/* Two or four. Three seats players on three consecutive sides, which is not the
   same game for all three of them, so it is not offered. */
check('only two- and four-player tables exist',
      Object.keys(SLOT_SETS).sort().join() === '2,4', Object.keys(SLOT_SETS).join());
check('two players sit opposite each other',
      SLOT_SETS[2].join() === '0,2', SLOT_SETS[2].join());
check('four use every side', SLOT_SETS[4].join() === '0,1,2,3', SLOT_SETS[4].join());

/* Nothing that arrives from outside — an old snapshot, a stale link — may leave
   the game holding a seating it has no table for. */
check('a stray count is rounded to a real table',
      seatCount(3) === 4 && seatCount(2) === 2 && seatCount(4) === 4 &&
      seatCount(0) === 2 && seatCount(9) === 4,
      [0, 2, 3, 4, 9].map(seatCount).join(' '));

/* And the setup screen must not offer what the game will not deal. */
var markup = read('index.html');
check('the setup screen offers two and four only',
      (markup.match(/name="num-players"/g) || []).length === 2,
      (markup.match(/name="num-players"/g) || []).length + ' options');
check('and three is not among them', markup.indexOf('id="np-3"') < 0);

/* ---------------------------------------------------- safe squares ----- */

/* Two kinds, and nothing else: the four starts, and every ring corner. Written
   out per board rather than recomputed, so a change to the rule has to be a
   deliberate change here too. */
/* The 5x5 keeps the traditional four and nothing else. The 7x7 shelters corners
   too, but never on the last ring before home. */
[{ N: 5, corners: [],
   unsafe: [[0,0],[0,4],[4,0],[4,4], [1,1],[1,3],[3,1],[3,3]] },
 { N: 7, corners: [[0,0],[0,6],[6,0],[6,6], [1,1],[1,5],[5,1],[5,5]],
   unsafe: [[2,2],[2,4],[4,2],[4,4]] }].forEach(function (board) {
  var st = makeState(board.N, 4);
  var tag = board.N + 'x' + board.N + ': ';
  var safe = st.safeCellSet;

  var missing = board.corners.filter(function (rc) { return !safe[rc[0] + ',' + rc[1]]; });
  check(tag + 'every sheltered corner is safe', missing.length === 0,
        missing.map(function (rc) { return rc.join(','); }).join(' '));

  var starts = st.players.map(function (p) { return p.path[0][0] + ',' + p.path[0][1]; });
  var lostStart = starts.filter(function (k) { return !safe[k]; });
  check(tag + 'and every start square still is', lostStart.length === 0, lostStart.join(' '));

  /* Nothing else may creep in: a mid-ring square must stay capturable. */
  check(tag + 'no more than the starts and the corners are safe',
        Object.keys(safe).length === board.corners.length + 4,
        Object.keys(safe).length + ' safe, expected ' + (board.corners.length + 4));

  /* The centre is a destination, not a shelter. */
  var mid = (board.N - 1) / 2;
  check(tag + 'the centre is not one of them', !safe[mid + ',' + mid]);

  /* Nor is the last ring before it — there should be nowhere to sit out the
     final stretch. */
  var sheltered = (board.unsafe || []).filter(function (rc) { return safe[rc[0] + ',' + rc[1]]; });
  check(tag + 'no square is sheltered that should not be', sheltered.length === 0,
        sheltered.map(function (rc) { return rc.join(','); }).join(' '));

  /* Every safe square has to be somewhere a piece can actually stand. */
  var onPath = {};
  st.players.forEach(function (p) {
    p.path.forEach(function (rc) { onPath[rc[0] + ',' + rc[1]] = true; });
  });
  var stranded = Object.keys(safe).filter(function (k) { return !onPath[k]; });
  check(tag + 'and sits on the path', stranded.length === 0, stranded.join(' '));
});

/* ------------------------------------------------- report -------------- */

print('');
if (!fails.length) {
  print('✅ all checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
