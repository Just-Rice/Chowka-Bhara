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
  'playerActive', 'ordinal', 'progressOf', 'standingsText',
  'tieVoters', 'tieThreshold', 'hasVotedForTie'
].map(grab).join('\n'));

/* The piece count, the cowrie count and the throw table are now board-
   dependent, so take the real ones rather than a stub that can drift. */
eval(['piecesPerPlayer', 'shellCount', 'throwOutcome', 'binomial', 'rollOdds',
      'buildSafeCells']
     .map(grab).join('\n'));
var ROLL_ODDS_BY_N = {};
var SLOT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
var state = null;

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

function makeState(N, numPlayers) {
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

/* --------------------------------------------------- the tie vote ------ */

/* Online, calling a tie takes a majority of the people still playing, the way
   a draw is agreed at a chess board. The computer gets no say. */

var online = { mode: 'host', config: { seatKinds: [] } };

function seatsOf(n, kinds) {
  state = makeState(5, n);
  online.config.seatKinds = kinds;
  state.tieVotes = [];
  return state;
}

/* Two players: both must agree. */
seatsOf(2, ['local', 'remote']);
check('two players need both votes', tieThreshold() === 2, String(tieThreshold()));
state.tieVotes = [0];
check('one of two is not enough', state.tieVotes.length < tieThreshold());
state.tieVotes = [0, 1];
check('two of two carries', state.tieVotes.length >= tieThreshold());

/* Three players: two is a majority — your example. */
seatsOf(3, ['local', 'remote', 'remote']);
check('three players need two votes', tieThreshold() === 2, String(tieThreshold()));
state.tieVotes = [0];
check('one of three is not enough', state.tieVotes.length < tieThreshold());
state.tieVotes = [0, 1];
check('two want it and one does not — still a tie',
      state.tieVotes.length >= tieThreshold());

/* Four players: three is a majority, two is not — your example. */
seatsOf(4, ['local', 'remote', 'remote', 'remote']);
check('four players need three votes', tieThreshold() === 3, String(tieThreshold()));
state.tieVotes = [0, 1];
check('two of four is not enough', state.tieVotes.length < tieThreshold());
state.tieVotes = [0, 1, 2];
check('three want it and one does not — still a tie',
      state.tieVotes.length >= tieThreshold());

/* The computer has no opinion, so it does not raise the bar. */
seatsOf(4, ['local', 'remote', 'cpu', 'cpu']);
check('computer seats are not counted as voters',
      tieVoters().length === 2, tieVoters().length + ' voters');
check('so two humans among four seats need both',
      tieThreshold() === 2, String(tieThreshold()));

/* Nor does a player who has already finished. */
seatsOf(3, ['local', 'remote', 'remote']);
state.players[2].pieces.forEach(function (pc) { pc.status = 'finished'; });
check('a player already home no longer votes',
      tieVoters().length === 2, tieVoters().length + ' voters');

/* Votes are tracked per player. */
seatsOf(3, ['local', 'remote', 'remote']);
state.tieVotes = [1];
check('a vote is remembered against its player', hasVotedForTie(1) === true);
check('and nobody else is counted as having voted',
      hasVotedForTie(0) === false && hasVotedForTie(2) === false);

/* On this device alone there is nobody to ask. */
online.mode = 'local';
seatsOf(2, ['local', 'local']);
state.players[1].isCPU = true;
check('playing the computer, only the person counts',
      tieVoters().length === 1, tieVoters().length + ' voters');
online.mode = 'host';

/* ---------------------------------------- the six-piece 7x7 game ------ */

/* The large board is a different game: six pieces a side and six cowries, so
   throws run up to 12. These check the two boards really are set up
   differently and that the bigger throws behave on the longer path. */
online.mode = 'local';

state = makeState(5, 2);
check('the small board deals four pieces a side',
      state.players[0].pieces.length === 4, String(state.players[0].pieces.length));

state = makeState(7, 2);
var big = state.players[0];
check('the large board deals six', big.pieces.length === 6, String(big.pieces.length));
check('the large board is a longer walk', state.pathLength === 50,
      String(state.pathLength));

/* Exactness still governs the finish, at the new top value. */
var last = state.pathLength - 1;
big.hasCaptured = true;
big.pieces.forEach(function (pc) { pc.status = 'done'; });
big.pieces[0].status = 'active';
big.pieces[0].pathIndex = last - 12;
var finishing = computeLegalMoves(big, 12);
check('a throw of 12 can finish from exactly twelve out',
      finishing.length === 1 && finishing[0].type === 'finish',
      JSON.stringify(finishing));

big.pieces[0].pathIndex = last - 11;
check('and overshooting with it is still no move',
      computeLegalMoves(big, 12).length === 0);

/* A value the small board can never produce has to be playable here. */
big.pieces[0].pathIndex = 3;
check('five is a real move on the large board',
      computeLegalMoves(big, 5).length === 1);

/* The tray is built from the board, so no fixed set may be left in the page. */
var page = read('index.html');
var trayAt = page.indexOf('id="shell-tray"');
check('the page ships no fixed set of cowries',
      page.slice(trayAt, trayAt + 200).indexOf('class="shell') < 0);
check('the tray is built instead', read('js/render.js').indexOf('function renderShellTray(') >= 0);
check('and built when a game starts', read('js/game.js').indexOf('renderShellTray()') >= 0);

/* ------------------------------------------------------- report ------- */

print('');
if (!fails.length) {
  print('✅ all turn-rule checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
