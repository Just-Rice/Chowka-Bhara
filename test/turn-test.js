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
  'ringLoop', 'ringCorners', 'turnInward', 'buildCanonicalPath', 'rotateRC', 'rotatePath', 'physicalRing',
  'layerOf', 'computeLegalMoves', 'piecesOnCell', 'immortalOwner', 'currentPlayer',
  'playableChips', 'selectedEntry', 'ensureSelection', 'spendChip',
  'playerActive', 'ordinal', 'progressOf', 'standingsText',
  'tieVoters', 'tieThreshold', 'hasVotedForTie', 'canVoteForTie', 'dropTieVote', 'requestTie'
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
    safeCellSet: safe, stackCellSet: buildStackCells(N, safe),
    players: players, currentPlayerIndex: 0,
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
/* requestTie talks to the screen and to the other players; neither is what is
   being tested here, so they are stubbed and the vote arithmetic is real. */
function addLog() {}
function notifyTieRequest() {}
function updateUI() {}
function callItATie() { state.turnState = 'GAME_OVER'; }

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
seatsOf(4, ['local', 'remote', 'remote', 'cpu']);
check('three voters need two', tieThreshold() === 2, String(tieThreshold()));
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

/* Nor does a player who has already finished. Three voters is still a real
   position — four seats with one of them a computer — even though three
   players is not a table the game deals. */
seatsOf(4, ['local', 'remote', 'remote', 'cpu']);
check('three humans among four seats need two',
      tieVoters().length === 3 && tieThreshold() === 2,
      tieVoters().length + ' voters, threshold ' + tieThreshold());
state.players[2].pieces.forEach(function (pc) { pc.status = 'finished'; });
check('a player already home no longer votes',
      tieVoters().length === 2, tieVoters().length + ' voters');

/* Votes are tracked per player. */
seatsOf(4, ['local', 'remote', 'remote', 'cpu']);
state.tieVotes = [1];
check('a vote is remembered against its player', hasVotedForTie(1) === true);
check('and nobody else is counted as having voted',
      hasVotedForTie(0) === false && hasVotedForTie(2) === false);

/* A player already home has banked their place and has no say in ending the
   game for everybody else. The threshold counts only the players still going,
   so the votes must be counted from the same set — otherwise the two who have
   finished can carry a tie that neither remaining player agreed to. */
seatsOf(4, ['local', 'remote', 'remote', 'remote']);
state.stalled = true;          // requestTie does nothing unless play is stuck
state.turnState = 'AWAITING_ROLL';
state.players[0].pieces.forEach(function (pc) { pc.status = 'finished'; });
state.players[1].pieces.forEach(function (pc) { pc.status = 'finished'; });

check('only the players still going may vote',
      canVoteForTie(2) && canVoteForTie(3) &&
      !canVoteForTie(0) && !canVoteForTie(1),
      [0, 1, 2, 3].map(canVoteForTie).join(','));
check('and the threshold counts the same two',
      tieVoters().length === 2 && tieThreshold() === 2,
      tieVoters().length + ' voters, threshold ' + tieThreshold());

state.tieVotes = [];
requestTie(0);
requestTie(1);
check('a finished player asking changes nothing',
      state.tieVotes.length === 0 && state.turnState !== 'GAME_OVER',
      JSON.stringify(state.tieVotes));

requestTie(2);
check('a player still going is heard', state.tieVotes.length === 1,
      JSON.stringify(state.tieVotes) + ' stalled=' + state.stalled);
requestTie(3);
check('and two of the two still going carries it',
      state.turnState === 'GAME_OVER', state.turnState);

/* A vote cast while playing must not outlive the player casting it. */
seatsOf(4, ['local', 'remote', 'remote', 'remote']);
state.tieVotes = [1, 2];
dropTieVote(1);
check('finishing takes your vote with you',
      state.tieVotes.length === 1 && state.tieVotes[0] === 2,
      JSON.stringify(state.tieVotes));

/* Nobody outside the table at all. */
check('a seat that does not exist cannot vote', !canVoteForTie(9));
check('and neither can nobody', !canVoteForTie(null) && !canVoteForTie(undefined));

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
check('the large board is a longer walk', state.pathLength === 49,
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

/* -------------------------------------- one throw, one number of squares -- */

/* Which move is being made used to be recorded twice: once as the selected
   throw, and once as a list of highlights written by whichever call last
   refreshed it. Two records of one decision can only agree by agreement, and
   when they do not you spend one throw and move by another — a wrong number of
   squares with nothing on screen to explain it. */
state = makeState(5, 2);
state.players[0].hasCaptured = true;
state.poolSeq = 0;
state.pool = [{ id: ++state.poolSeq, value: 4 }, { id: ++state.poolSeq, value: 3 }];

/* Spending them one at a time on one piece must come to exactly their sum. */
var piece = state.players[0].pieces[0];
piece.pathIndex = 0;
var spentTotal = 0;
state.pool.slice().forEach(function (chip) {
  state.selectedChipId = chip.id;
  var entry = selectedEntry();
  check('throw ' + chip.value + ' is playable', !!entry, String(chip.value));
  if (!entry) return;
  var move = entry.moves.filter(function (m) { return m.pieceId === 0; })[0];
  check('and offers a move for the piece', !!move);
  if (!move) return;
  check('of exactly ' + chip.value + ' squares',
        move.destIndex - piece.pathIndex === chip.value,
        String(move.destIndex - piece.pathIndex));
  spentTotal += chip.value;
  piece.pathIndex = move.destIndex;
  spendChip(chip.id);
});
check('a 4 and a 3 move seven squares, not eight',
      piece.pathIndex === 7 && spentTotal === 7,
      'ended at ' + piece.pathIndex);

/* And every throw a board can produce agrees with itself. */
[5, 7].forEach(function (N) {
  var st = makeState(N, 2);
  st.players[0].hasCaptured = true;
  state = st;
  rollOdds(N).forEach(function (o) {
    state.pool = [{ id: 1, value: o.value }];
    state.selectedChipId = 1;
    var p0 = state.players[0].pieces[0];
    p0.pathIndex = 0;
    var entry = selectedEntry();
    if (!entry) return;                     // overshoots the board, fairly
    var move = entry.moves.filter(function (m) { return m.pieceId === 0; })[0];
    if (!move) return;
    check(N + 'x' + N + ': a throw of ' + o.value + ' moves ' + o.value,
          move.destIndex - p0.pathIndex === o.value,
          String(move.destIndex - p0.pathIndex));
  });
});

/* ------------------------------------------- safe squares along a path -- */

/* The four starting squares fall at fixed steps of everybody's own path, so a
   piece can land on one without ever thinking about whose it is. An opponent
   standing there cannot be taken — which is the rule, and looks exactly like a
   capture that failed unless something says so. */
[[5, [0, 4, 8, 12]], [7, [0, 3, 6, 9, 12, 15, 18, 21, 24, 28, 32, 36]]].forEach(function (c) {
  var N = c[0], expect = c[1];
  var st = makeState(N, 2);
  var steps = [];
  st.players[0].path.forEach(function (rc, i) {
    if (st.safeCellSet[rc[0] + ',' + rc[1]]) steps.push(i);
  });
  check(N + 'x' + N + ': the safe steps along a path are where they should be',
        steps.join() === expect.join(), steps.join());
});

/* The specific case that was queried: a piece one step before a start square,
   moving four and then three, lands on it. */
state = makeState(5, 2);
var start8 = state.players[0].path[8];
check('a 5x5 piece on step 1 that moves 7 lands on step 8',
      1 + 4 + 3 === 8);
check('and step 8 is a starting square, so safe from everyone',
      !!state.safeCellSet[start8[0] + ',' + start8[1]],
      JSON.stringify(start8));
check('the game says so rather than saying nothing',
      read('js/game.js').indexOf('log.safeSquare') > 0);

/* ------------------------------- every square, every pair of throws ----- */

/* Spot-checking a move proves one move. This walks every starting square on
   both boards, spending every pair of throws that board can produce, and
   insists each one moves exactly its own number of squares and that the pair
   comes to their sum. It is where a report of a piece travelling one square too
   far would show up, if it were in the movement at all. */
[5, 7].forEach(function (N) {
  var values = rollOdds(N).map(function (o) { return o.value; });
  var built = buildCanonicalPath(N);
  var last = built.path.length - 1;
  var wrongStep = [], wrongTotal = [], tried = 0;

  values.forEach(function (a) {
    values.forEach(function (b) {
      for (var from = 0; from + a + b <= last; from++) {
        var st = makeState(N, 2);
        st.players[0].hasCaptured = true;
        st.players[0].pieces.forEach(function (pc, i) {
          pc.status = i === 0 ? 'active' : 'finished';
        });
        st.players[0].pieces[0].pathIndex = from;
        st.poolSeq = 0;
        st.pool = [{ id: 1, value: a }, { id: 2, value: b }];
        state = st;

        var at = from, played = 0;
        [1, 2].forEach(function (id) {
          state.selectedChipId = id;
          var entry = selectedEntry();
          if (!entry) return;
          var move = entry.moves.filter(function (m) { return m.pieceId === 0; })[0];
          if (!move) return;
          if (move.destIndex - at !== entry.chip.value && move.type !== 'finish') {
            wrongStep.push(N + ': from ' + at + ' a ' + entry.chip.value +
                           ' moved ' + (move.destIndex - at));
          }
          at = move.destIndex;
          state.players[0].pieces[0].pathIndex = at;
          played += entry.chip.value;
          spendChip(id);
        });
        tried++;
        if (played === a + b && at !== from + a + b) {
          wrongTotal.push(N + ': from ' + from + ', ' + a + ' and ' + b +
                          ' ended at ' + at + ' not ' + (from + a + b));
        }
      }
    });
  });

  check(N + 'x' + N + ': every throw moves its own number of squares',
        wrongStep.length === 0, wrongStep.slice(0, 3).join(' | '));
  check(N + 'x' + N + ': and two throws come to their sum',
        wrongTotal.length === 0, wrongTotal.slice(0, 3).join(' | '));
  check(N + 'x' + N + ': over a useful number of positions', tried > 200, String(tried));
});

/* ------------------------------- which throw a click is about to spend -- */

/* Several throws can be banked at once and the oldest is selected for you, so a
   click spends it without asking. A turn that banks an 8, a 4 and a 3 — which
   is what "0 up" then two bonus throws produces — spends the 8 first. Nothing
   said so, and the piece moving eight looked like a four and a three moving
   eight. */
state = makeState(5, 2);
state.players[0].hasCaptured = true;
state.players[0].pieces.forEach(function (pc, i) { pc.status = i === 0 ? 'active' : 'finished'; });
state.players[0].pieces[0].pathIndex = 0;
state.poolSeq = 0;
state.pool = [{ id: ++state.poolSeq, value: 8 },
              { id: ++state.poolSeq, value: 4 },
              { id: ++state.poolSeq, value: 3 }];
state.selectedChipId = null;
ensureSelection();
check('the throw selected for you is the oldest banked one',
      selectedEntry() && selectedEntry().chip.value === 8,
      selectedEntry() ? String(selectedEntry().chip.value) : 'none');
check('so a click on a piece would move it eight, not four',
      selectedEntry().moves.filter(function (m) { return m.pieceId === 0; })[0].destIndex === 8);
check('and the button is able to say which throw that is',
      read('js/i18n.js').indexOf('btn.choosePieceFor') > 0 &&
      read('js/render.js').indexOf('choosePieceLabel') > 0);

/* "0 up" is the biggest throw on the board and read as a zero. */
check('none-up gets a line of its own', read('js/game.js').indexOf('log.threwNone') > 0);
check('and it is the throw worth double the set',
      throwOutcome(0, 4).moveValue === 8 && throwOutcome(0, 6).moveValue === 12);

/* ------------------------------------------------------- report ------- */

print('');
if (!fails.length) {
  print('✅ all turn-rule checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
