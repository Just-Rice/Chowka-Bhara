/* Tests the computer player by extracting its real source out of index.html.
 * The CPU functions read module-level `state` and touch no DOM, so they can be
 * exercised directly against constructed positions. */

/* The game is split across js/ modules now, so read them all and let grab()
   pick functions out of the combined source exactly as before. */
var SRC = ['config','path','rules','ai','render','game','online','main']
  .map(function (n) { return read('js/' + n + '.js'); }).join('\n');

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

eval([
  'ringLoop', 'ringCorners', 'turnInward', 'buildCanonicalPath', 'rotateRC', 'rotatePath', 'physicalRing',
  'layerOf', 'computeLegalMoves', 'piecesOnCell', 'immortalOwner', 'currentPlayer',
  'cellKey', 'isSafeCell', 'threatMap', 'opponentsOn', 'threatCreated',
  'scoreMove', 'playableChips', 'selectedEntry', 'chooseCPUPlay'
].map(grab).join('\n'));


/* The piece count, the cowrie count and the throw table are now board-
   dependent, so take the real ones rather than a stub that can drift. */
eval(['piecesPerPlayer', 'shellCount', 'throwOutcome', 'binomial', 'rollOdds',
      'buildSafeCells', 'buildStackCells']
     .map(grab).join('\n'));
var ROLL_ODDS_BY_N = {};
var SLOT_SETS = { 2: [0, 2], 4: [0, 1, 2, 3] };
var state = null;

var fails = [];

/* Bank one throw of `value` and return the CPU's chosen move for it. */
function cpuPlayWith(player, value) {
  state.currentPlayerIndex = player.id;
  state.pool = [{ id: ++state.poolSeq, value: value }];
  state.selectedChipId = null;
  var play = chooseCPUPlay(player);
  return play ? play.move : null;
}
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

function makeState(N, numPlayers, skill) {
  var built = buildCanonicalPath(N);
  var all = [0, 1, 2, 3].map(function (s) { return rotatePath(built.path, s, N); });
  var safe = buildSafeCells(N, all);
  var slots = SLOT_SETS[numPlayers];
  var players = [];
  for (var i = 0; i < numPlayers; i++) {
    var pieces = [];
    for (var j = 0; j < piecesPerPlayer(N); j++) {
      pieces.push({ id: j, status: 'active', pathIndex: 0 });
    }
    players.push({
      id: i, name: 'P' + i, slot: slots[i], path: all[slots[i]],
      hasCaptured: false, isCPU: i > 0, pieces: pieces
    });
  }
  return {
    N: N, ringBoundaries: built.ringBoundaries, pathLength: built.path.length,
    safeCellSet: safe, stackCellSet: buildStackCells(N, safe),
    players: players, currentPlayerIndex: 0,
    cpuSkill: skill || 'sharp',
    pool: [], poolSeq: 0, selectedChipId: null
  };
}

/* Put a piece of `player` onto the physical cell `rc`, if their path visits it. */
function placeAt(player, pieceId, rc) {
  for (var i = 0; i < player.path.length; i++) {
    if (player.path[i][0] === rc[0] && player.path[i][1] === rc[1]) {
      player.pieces[pieceId].status = 'active';
      player.pieces[pieceId].pathIndex = i;
      return i;
    }
  }
  throw new Error('cell not on path: ' + rc);
}

/* ---------------------------------------------- takes a free capture --- */

state = makeState(5, 2);
var me = state.players[0], foe = state.players[1];

/* Find a square 3 steps ahead of one of my pieces that is genuinely capturable
 * (on the outer ring, not one of the four safe starts). */
var fromIdx = null, targetRC = null;
for (var q = 1; q < state.ringBoundaries[0] - 3; q++) {
  var rc = me.path[q + 3];
  if (!state.safeCellSet[cellKey(rc)]) { fromIdx = q; targetRC = rc; break; }
}
check('setup: found an unsafe target square', targetRC !== null,
      JSON.stringify(targetRC));

me.pieces[0].status = 'active';
me.pieces[0].pathIndex = fromIdx;
placeAt(foe, 0, targetRC);

/* Decoy: another of my pieces that could also legally move 3. */
me.pieces[1].status = 'active';
me.pieces[1].pathIndex = 1;

var moves = computeLegalMoves(me, 3);
var picked = cpuPlayWith(me, 3);
check('takes an available capture', picked && picked.pieceId === 0,
      'picked ' + JSON.stringify(picked) + ' of ' + JSON.stringify(moves));

/* ------------------------------------- avoids walking into a gun barrel - */

state = makeState(5, 2);
me = state.players[0]; foe = state.players[1];
me.hasCaptured = true; foe.hasCaptured = true;

/* Two of my pieces, both able to move 2. One lands on a quiet square, the other
 * on a square an enemy piece covers from one step back. Nothing to capture. */
var quietFrom = null, hotFrom = null, hotRC = null;
for (var a = 1; a < state.ringBoundaries[0] - 2; a++) {
  var rcA = me.path[a + 2];
  if (state.safeCellSet[cellKey(rcA)]) continue;
  /* Can the enemy cover this square from one step behind on THEIR path? */
  for (var fi = 1; fi < foe.path.length; fi++) {
    if (foe.path[fi][0] === rcA[0] && foe.path[fi][1] === rcA[1]) {
      if (hotFrom === null) { hotFrom = a; hotRC = rcA; foe.pieces[0].status = 'active'; foe.pieces[0].pathIndex = fi - 1; }
      break;
    }
  }
  /* Not one two steps behind the other. A piece may not land on a square its
     own side already holds, so that pairing would quietly take one of the two
     candidate moves away and leave this testing nothing. */
  if (hotFrom !== null && hotFrom !== a && quietFrom === null &&
      a + 2 !== hotFrom && hotFrom + 2 !== a) quietFrom = a;
}
/* Pick a quiet origin the enemy piece cannot reach at all. */
for (a = 1; quietFrom === null && a < state.ringBoundaries[0] - 2; a++) {
  if (a === hotFrom) continue;
  if (a + 2 === hotFrom || hotFrom + 2 === a) continue;
  var rcQ = me.path[a + 2];
  if (state.safeCellSet[cellKey(rcQ)]) continue;
  var reachable = false;
  rollOdds(state.N).forEach(function (r) {
    var d = foe.pieces[0].pathIndex + r.value;
    if (d >= foe.path.length - 1) return;
    if (foe.path[d][0] === rcQ[0] && foe.path[d][1] === rcQ[1]) reachable = true;
  });
  if (!reachable) quietFrom = a;
}

me.pieces[0].status = 'active'; me.pieces[0].pathIndex = quietFrom;
me.pieces[1].status = 'active'; me.pieces[1].pathIndex = hotFrom;
me.pieces[2].status = 'finished';   /* keep hand empty so only these two move */
me.pieces[3].status = 'finished';

var threats = threatMap(me);
check('threat map flags the covered square', (threats[cellKey(hotRC)] || 0) > 0,
      'threat = ' + (threats[cellKey(hotRC)] || 0));

moves = computeLegalMoves(me, 2);
check('setup: exactly the two candidate moves', moves.length === 2,
      JSON.stringify(moves));
picked = cpuPlayWith(me, 2);
check('avoids moving into a covered square when a quiet move exists',
      picked && picked.pieceId === 0,
      'picked ' + JSON.stringify(picked) + ' of ' + JSON.stringify(moves));

/* ---------------------------------------------- finishing wins --------- */

state = makeState(5, 2);
me = state.players[0];
me.hasCaptured = true;
var last = state.pathLength - 1;
me.pieces[0].status = 'finished';
me.pieces[1].status = 'finished';
me.pieces[2].status = 'finished';
me.pieces[3].status = 'active';
me.pieces[3].pathIndex = last - 2;

moves = computeLegalMoves(me, 2);
picked = cpuPlayWith(me, 2);
check('takes the winning move', picked && picked.type === 'finish',
      JSON.stringify(picked));

/* ---------------------------------------------- threat map hygiene ----- */

state = makeState(5, 2);
me = state.players[0]; foe = state.players[1];
/* All four enemy pieces sit in hand: entering squares must not be counted
 * four times over. */
threats = threatMap(me);
var maxThreat = 0;
Object.keys(threats).forEach(function (k) { maxThreat = Math.max(maxThreat, threats[k]); });
check('threat never exceeds probability 1', maxThreat <= 1.0001,
      'max = ' + maxThreat);

/* Safe squares must never appear as threatened. */
var safeThreatened = Object.keys(state.safeCellSet).filter(function (k) {
  return threats[k] > 0;
});
check('safe squares are never marked as threatened', safeThreatened.length === 0,
      safeThreatened.join(' | '));

/* ---------------------------------------------- fuzz ------------------- */

function randomPosition(N, numPlayers, skill) {
  var s = makeState(N, numPlayers, skill);
  s.players.forEach(function (p) {
    p.hasCaptured = Math.random() < 0.5;
    p.pieces.forEach(function (pc) {
      var r = Math.random();
      if (r < 0.9) {
        pc.status = 'active';
        pc.pathIndex = Math.floor(Math.random() * (s.pathLength - 1));
        if (!p.hasCaptured && layerOf(pc.pathIndex, s.ringBoundaries) > 0) {
          pc.pathIndex = Math.floor(Math.random() * s.ringBoundaries[0]);
        }
      } else { pc.status = 'finished'; pc.pathIndex = -2; }
    });
  });
  return s;
}

var iterations = 0, returnedOutside = 0, threw = 0, nullPick = 0;
[5, 7].forEach(function (N) {
  [2, 4].forEach(function (np) {
    ['easy', 'sharp'].forEach(function (skill) {
      for (var t = 0; t < 800; t++) {
        state = randomPosition(N, np, skill);
        var pl = state.players[Math.floor(Math.random() * np)];
        state.currentPlayerIndex = pl.id;
        var roll = [1, 2, 3, 4, 8][Math.floor(Math.random() * 5)];
        var legal;
        try {
          legal = computeLegalMoves(pl, roll);
          if (!legal.length) continue;
          iterations++;
          state.currentPlayerIndex = pl.id;
          state.pool = [{ id: ++state.poolSeq, value: roll }];
          // Sometimes bank extra throws, as a run of 4s and 0s would.
          var extra = Math.floor(Math.random() * 3);
          for (var x = 0; x < extra; x++) {
            state.pool.push({ id: ++state.poolSeq, value: [4, 8][x % 2] });
          }
          state.selectedChipId = null;
          var play = chooseCPUPlay(pl);
          if (!play) { nullPick++; continue; }
          var chip = state.pool.filter(function (c) { return c.id === play.chipId; })[0];
          if (!chip) { returnedOutside++; continue; }
          // computeLegalMoves builds fresh objects, so compare by value.
          var legalForChip = computeLegalMoves(pl, chip.value);
          var match = legalForChip.some(function (m) {
            return m.pieceId === play.move.pieceId &&
                   m.type === play.move.type &&
                   m.destIndex === play.move.destIndex;
          });
          if (!match) returnedOutside++;
        } catch (e) {
          threw++;
          if (threw === 1) fails.push('fuzz threw: ' + (e.message || e));
        }
      }
    });
  });
});

check('fuzz: never throws', threw === 0, threw + ' throws');
check('fuzz: always returns a move', nullPick === 0, nullPick + ' nulls');
check('fuzz: only ever returns a legal move', returnedOutside === 0,
      returnedOutside + ' outside the legal set');

print('fuzzed ' + iterations + ' positions across 5x5/7x7, 2 and 4 players, both skills');
print('');
if (!fails.length) {
  print('✅ all CPU checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
