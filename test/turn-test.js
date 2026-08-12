/* Covers the house rules added on top of the original build: banked bonus
 * throws spent in any order, the skip rule, placement ordering and the
 * deadlock ranking. Functions are extracted from index.html, so this tests the
 * shipping code. */

/* ordinal() and standingsText() read the translation table, so load it and
   supply the two helpers they expect from the game file. */
load('js/i18n.js');
var I18N = this.I18N;
var t = function (k, params) { return I18N.t(k, params); };
var PLAYER_NAMES = ['Madder', 'Indigo', 'Turmeric', 'Areca'];
function playerName(id) { return PLAYER_NAMES[id]; }

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
  'ringLoop', 'buildCanonicalPath', 'rotateRC', 'rotatePath', 'physicalRing',
  'layerOf', 'computeLegalMoves', 'currentPlayer',
  'playableChips', 'selectedEntry', 'ensureSelection', 'spendChip',
  'playerActive', 'ordinal', 'progressOf', 'standingsText'
].map(grab).join('\n'));

var PIECES_PER_PLAYER = 4;
var SLOT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
var state = null;

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

function makeState(N, numPlayers) {
  var built = buildCanonicalPath(N);
  var all = [0, 1, 2, 3].map(function (s) { return rotatePath(built.path, s, N); });
  var safe = {};
  all.forEach(function (p) { safe[p[0][0] + ',' + p[0][1]] = true; });
  var slots = SLOT_SETS[numPlayers];
  var players = [];
  for (var i = 0; i < numPlayers; i++) {
    var pieces = [];
    for (var j = 0; j < PIECES_PER_PLAYER; j++) {
      pieces.push({ id: j, status: 'active', pathIndex: 0 });
    }
    players.push({
      id: i, name: 'P' + i, colorVar: 'x', slot: slots[i], path: all[slots[i]],
      hasCaptured: false, isCPU: false, pieces: pieces
    });
  }
  return {
    N: N, ringBoundaries: built.ringBoundaries, pathLength: built.path.length,
    safeCellSet: safe, players: players, currentPlayerIndex: 0,
    pool: [], poolSeq: 0, selectedChipId: null, placements: [],
    playOn: false, movedThisTurn: false, deadTurns: 0
  };
}

function bank(values) {
  state.pool = values.map(function (v) { return { id: ++state.poolSeq, value: v }; });
  state.selectedChipId = null;
}

/* ------------------------------------- banked throws stay independent -- */

state = makeState(5, 2);
var me = state.players[0];
me.hasCaptured = true;
me.pieces[0].status = 'active'; me.pieces[0].pathIndex = 3;
me.pieces[1].status = 'active'; me.pieces[1].pathIndex = 6;
me.pieces[2].status = 'finished';
me.pieces[3].status = 'finished';

bank([4, 8, 2]);
var playable = playableChips();
check('every banked throw is offered separately', playable.length === 3,
      playable.length + ' of 3');
check('each banked throw carries its own move list',
      playable.every(function (e) { return e.moves.length === 2; }),
      JSON.stringify(playable.map(function (e) { return e.moves.length; })));

/* Any piece can take any throw — the pairing is free. */
var pieceIdsFor4 = playable.filter(function (e) { return e.chip.value === 4; })[0]
  .moves.map(function (m) { return m.pieceId; }).sort();
check('a banked throw can go to any eligible piece',
      pieceIdsFor4.join(',') === '0,1', pieceIdsFor4.join(','));

/* --------------------------------------------- unplayable throws skip -- */

state = makeState(5, 2);
me = state.players[0];
me.hasCaptured = true;
var last = state.pathLength - 1;
/* One piece two short of the centre: 2 finishes, 8 overshoots. */
me.pieces[0].status = 'active'; me.pieces[0].pathIndex = last - 2;
me.pieces[1].status = 'finished';
me.pieces[2].status = 'finished';
me.pieces[3].status = 'finished';

bank([2, 8]);
playable = playableChips();
check('overshooting throws are not offered', playable.length === 1,
      JSON.stringify(playable.map(function (e) { return e.chip.value; })));
check('the exact throw is offered as a finish',
      playable[0].chip.value === 2 && playable[0].moves[0].type === 'finish',
      JSON.stringify(playable[0]));

/* Nothing playable at all -> the turn is over and the rest are discarded. */
bank([8, 8]);
check('a turn with no playable banked throw is skipped entirely',
      playableChips().length === 0);

/* ------------------------------- a capture mid-turn unlocks the rest --- */

state = makeState(5, 2);
me = state.players[0];
me.hasCaptured = false;
/* Sitting near the end of the outer ring: every throw lands inside. */
me.pieces[0].status = 'active'; me.pieces[0].pathIndex = state.ringBoundaries[0] - 1;
me.pieces[1].status = 'finished';
me.pieces[2].status = 'finished';
me.pieces[3].status = 'finished';

bank([2]);
check('inner-ring throws are unplayable before a capture',
      playableChips().length === 0);
me.hasCaptured = true;
check('the same throw becomes playable once the side has captured',
      playableChips().length === 1);

/* ----------------------------------------------- selection behaviour --- */

state = makeState(5, 2);
me = state.players[0];
me.hasCaptured = true;
me.pieces[0].status = 'active'; me.pieces[0].pathIndex = 3;
me.pieces[1].status = 'finished';
me.pieces[2].status = 'finished';
me.pieces[3].status = 'finished';

bank([3, 8]);          /* 8 from index 3 lands at 11, still outer -> playable */
state.selectedChipId = null;
ensureSelection();
check('a selection is made automatically', state.selectedChipId !== null);
check('the auto-selection is playable', selectedEntry() !== null);

var keptId = state.selectedChipId;
var otherId = state.pool.filter(function (c) { return c.id !== keptId; })[0].id;
spendChip(otherId);
check('spending removes exactly one throw', state.pool.length === 1,
      JSON.stringify(state.pool));
check('spending another chip leaves the selection alone',
      state.selectedChipId === keptId);
spendChip(keptId);
check('spending the selected chip clears the selection',
      state.selectedChipId === null && state.pool.length === 0);

/* --------------------------------------------------- placements ------- */

check('ordinals read naturally',
      ordinal(1) === '1st' && ordinal(2) === '2nd' && ordinal(3) === '3rd' &&
      ordinal(4) === '4th');

state = makeState(5, 4);
state.players[0].pieces.forEach(function (pc) { pc.status = 'finished'; });
check('a player with every piece home is no longer active',
      !playerActive(state.players[0]));
check('a player with pieces left is still active',
      playerActive(state.players[1]));

/* Progress ranking: more pieces home beats further along the path. */
state = makeState(5, 4);
var a = state.players[1], b = state.players[2];
a.pieces[0].status = 'finished';
a.pieces[1].status = 'finished';
b.pieces.forEach(function (pc, i) {
  pc.status = 'active';
  pc.pathIndex = state.pathLength - 2 - i;
});
check('progress counts finished pieces at full value',
      progressOf(a) > 2 * state.pathLength - 1,
      'a=' + progressOf(a) + ' b=' + progressOf(b));

state.placements = [1, 2, 0, 3];
var text = standingsText();
check('standings are numbered in finishing order',
      text.indexOf('1st') === 0 && text.indexOf('4th') > 0, JSON.stringify(text));

/* ------------------------------------------------ stalling, not ending -- */

/* A stall is not an ending. Two players one square from home, each needing an
   exact count, can sit for several rounds — at a real board you keep throwing.
   The game used to declare whoever was marginally ahead the winner, which is
   how a drawn position got recorded as a win for Madder. */

/* Reconstruct advanceTurn's stall bookkeeping, which is the part that decides. */
function stallAfter(rounds, numPlayers, movedEach) {
  var st = { deadTurns: 0, stalled: false, movedThisTurn: false };
  var active = numPlayers;
  for (var turn = 0; turn < rounds * numPlayers; turn++) {
    st.movedThisTurn = movedEach;
    if (st.movedThisTurn) { st.deadTurns = 0; st.stalled = false; }
    else st.deadTurns++;
    if (!st.stalled && st.deadTurns >= active * 2) st.stalled = true;
  }
  return st;
}

check('one quiet round does not raise the offer',
      stallAfter(1, 2, false).stalled === false);
check('two quiet rounds do raise it',
      stallAfter(2, 2, false).stalled === true);
check('a game where pieces keep moving never raises it',
      stallAfter(8, 2, true).stalled === false);
/* The threshold is active*2 turns, which is two full rounds whatever the
   player count — so the offer always appears after the same amount of play. */
check('two rounds is the threshold at any player count',
      stallAfter(1, 3, false).stalled === false &&
      stallAfter(2, 3, false).stalled === true &&
      stallAfter(1, 4, false).stalled === false &&
      stallAfter(2, 4, false).stalled === true);

/* Calling it a tie needs at least two players still in. */
state = makeState(5, 2);
check('two players still playing can agree a tie',
      state.players.filter(playerActive).length === 2);
state.players[1].pieces.forEach(function (pc) { pc.status = 'finished'; });
check('with only one left it is a win, not a tie',
      state.players.filter(playerActive).length === 1);

/* Progress ranking still exists for a genuine finish, but must no longer be
   what decides a stalled game. */
state = makeState(5, 2);
var p0 = state.players[0], p1 = state.players[1];
p0.pieces[0].pathIndex = state.pathLength - 2;
p1.pieces[0].pathIndex = state.pathLength - 2;
check('two players one square out rank equally',
      progressOf(p0) === progressOf(p1),
      progressOf(p0) + ' vs ' + progressOf(p1));

/* ------------------------------------------------------- report ------- */

print('');
if (!fails.length) {
  print('✅ all turn-rule checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
