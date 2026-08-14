/* Chowka-Bhara — Setting a game up, running a turn, and deciding placings. */
"use strict";

/* ============================= GAME INIT ============================= */
// Which of the 4 edge-slots (0=top,1=right,2=bottom,3=left) are used for a
// given player count. 2 players sit opposite each other; 4 use every edge.
//
// Three is not offered. It seats players on three consecutive sides, which
// leaves one player with an opponent on either flank and one with a free side —
// the game is not the same for all three, and it plays worse for it.
var SLOT_SETS = { 2: [0, 2], 4: [0, 1, 2, 3] };

// Anything that is not a table we deal is rounded up to the nearest one, so a
// stray count from an old link or a stale snapshot cannot leave initGame
// holding an undefined seating.
function seatCount(n) { return n >= 3 ? 4 : 2; }

/* Where a piece cannot be captured. Two kinds, and both are marked whatever the
   player count, the way a physical board would show them:

   The four starting squares, one per side, are safe on both boards. That is the
   traditional marking, and on the 5x5 it is the whole of it — four safe squares
   out of twenty-five, as the game has always been played.

   The 7x7 is a longer walk and shelters its corners as well, since a corner is
   where a piece has to turn and a chase behind it closes up. Not every corner:
   the last ring before home has none, because there should be nowhere to sit out
   the final stretch. Corner shelter therefore only appears on a board with three
   or more rings, which the 5x5 does not have. */
function buildSafeCells(N, allSlotPaths) {
  var safe = {};
  allSlotPaths.forEach(function(p) { safe[p[0][0] + "," + p[0][1]] = true; });

  var ringCount = (N - 1) / 2;
  var rings = ringCount >= 3 ? ringCount - 1 : 0;   // never the ring before home
  for (var k = 0; k < rings; k++) {
    var lo = k, hi = N - 1 - k;
    [[lo, lo], [lo, hi], [hi, lo], [hi, hi]].forEach(function(rc) {
      safe[rc[0] + "," + rc[1]] = true;
    });
  }
  return safe;
}

function initGame(N, numPlayers, numCPU, cpuSkill) {
  numPlayers = seatCount(numPlayers);
  // Computers take the last seats, so a lone human is always the first to move.
  numCPU = Math.max(0, Math.min(numCPU || 0, numPlayers));
  var firstCPU = numPlayers - numCPU;

  var built = buildCanonicalPath(N);
  var ringBoundaries = built.ringBoundaries;
  var allSlotPaths = [0, 1, 2, 3].map(function(s){ return rotatePath(built.path, s, N); });

  var safeCellSet = buildSafeCells(N, allSlotPaths);

  var slots = SLOT_SETS[numPlayers];
  var players = [];
  for (var i = 0; i < numPlayers; i++) {
    var pieces = [];
    // Every piece begins on its owner's start square, as it would on a real
    // board. There is no separate "entering" move, so a roll of 2 always
    // moves two squares.
    for (var j = 0; j < piecesPerPlayer(N); j++) pieces.push({ id: j, status: "active", pathIndex: 0 });
    players.push({
      id: i,
      // The seat, not the colour: a name follows its player through a colour
      // change, and the log has to say the same thing afterwards as before.
      nameKey: "seat." + i,
      colorVar: SEATS.colourOf(i),
      slot: slots[i],
      path: allSlotPaths[slots[i]],
      hasCaptured: false,
      isCPU: i >= firstCPU,
      pieces: pieces
    });
  }

  state = {
    N: N,
    ringBoundaries: ringBoundaries,
    pathLength: built.path.length,
    safeCellSet: safeCellSet,
    players: players,
    currentPlayerIndex: 0,
    turnState: "AWAITING_ROLL",
    legalMoves: [],
    lastRoll: null,
    busy: false,
    // Throws banked this turn but not yet assigned to a piece. A 4 or a 0
    // earns another throw, and a capture earns another throw, so a single
    // turn can accumulate several before any of them are spent.
    pool: [],
    poolSeq: 0,
    selectedChipId: null,
    // Finishing order. The game continues after the first player is home if
    // the players choose to play on, so this can grow past one entry.
    placements: [],
    playOn: false,
    movedThisTurn: false,
    deadTurns: 0,
    stalled: false,
    tieVotes: [],
    cpuSkill: cpuSkill || "sharp",
    cpuTimer: null,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  };

  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("win-overlay").classList.add("hidden");

  renderBoardStructure();
  renderShellTray();
  renderSidebar();
  updateCellDensity();
  addLog("log.newGame", { n: N, players: numPlayers });
  updateUI();
}

function currentPlayer() { return state.players[state.currentPlayerIndex]; }

// Which seat the person at this screen is playing. Hotseat and hosting both
// sit in seat 0; a guest sits wherever they claimed.
function viewingSeat() {
  if (online.mode === "guest" && online.mySeat !== null && online.mySeat !== undefined) {
    return online.mySeat;
  }
  return 0;
}

function applyBoardRotation() {
  var board = document.getElementById("board");
  if (!board || !state) return;
  var seat = viewingSeat();
  var player = state.players[seat] || state.players[0];
  // Slots run 0=top, 1=right, 2=bottom, 3=left. Put the viewer's slot at the
  // bottom; the CSS counter-rotates any text so it stays readable.
  var quarters = (2 - player.slot + 4) % 4;
  board.style.setProperty("--board-rot", (quarters * 90) + "deg");
}

/* ============================= TURN FLOW ============================= */
function onRollClick() {
  if (state.busy || state.turnState !== "AWAITING_ROLL") return;
  state.busy = true;
  updateUI();

  var result = throwShells();
  state.lastRoll = result;
  if (online.mode === "host" && online.host) online.host.announceRoll(result);

  animateShells(result).then(function(){
    var player = currentPlayer();
    state.pool.push({ id: ++state.poolSeq, value: result.moveValue });
    addLog(result.bonus ? "log.threwAgain" : "log.threw",
           { name: player.nameKey, up: result.upCount, move: result.moveValue });

    state.busy = false;

    // A 4 or a 0 means another throw before anything is spent.
    if (result.bonus) {
      state.turnState = "AWAITING_ROLL";
      updateUI();
      return;
    }
    beginSpending();
  });
}

// Move from throwing to spending, ending the turn if nothing banked can be
// played at all.
function beginSpending() {
  var playable = playableChips();
  if (!playable.length) {
    if (state.pool.length) {
      addLog(state.pool.length > 1 ? "log.skippedMany" : "log.skippedOne");
    }
    state.pool = [];
    state.selectedChipId = null;
    advanceTurn();
    return;
  }
  state.turnState = "AWAITING_MOVE";
  ensureSelection();
  refreshMoveOptions();
  updateUI();
}

function onTokenClick(playerId, pieceId, fromCPU) {
  // The pieces on screen are a past position, not the one you would be moving.
  if (typeof historyLive === "function" && !historyLive()) return;
  if (state.busy) return;
  if (state.turnState !== "AWAITING_MOVE") return;
  if (playerId !== state.currentPlayerIndex) return;
  // A human clicking a highlighted piece during the computer's turn must not
  // be able to play its move for it.
  if (!fromCPU && currentPlayer().isCPU) return;

  var entry = selectedEntry();
  if (!entry) return;
  var spentChipId = entry.chip.id;

  var move = null;
  for (var i = 0; i < state.legalMoves.length; i++) {
    if (state.legalMoves[i].pieceId === pieceId) { move = state.legalMoves[i]; break; }
  }
  if (!move) return;

  state.busy = true;
  clearHighlights();
  var player = currentPlayer();
  var piece = player.pieces[pieceId];
  var token = document.getElementById("token-p" + player.id + "-" + pieceId);

  var afterPlacement = function() {
    var captured = false;

    if (move.type !== "finish") {
      var destRC = player.path[move.destIndex];
      var destKey = destRC[0] + "," + destRC[1];
      if (!state.safeCellSet[destKey]) {
        state.players.forEach(function(p) {
          if (p.id === player.id) return;
          p.pieces.forEach(function(op) {
            if (op.status !== "active") return;
            var opRC = p.path[op.pathIndex];
            if (opRC[0] === destRC[0] && opRC[1] === destRC[1]) {
              op.pathIndex = 0;                 // all the way back to their start
              var opToken = document.getElementById("token-p" + p.id + "-" + op.id);
              var backRC = p.path[0];
              document.getElementById("pieces-" + backRC[0] + "-" + backRC[1])
                .appendChild(opToken);
              captured = true;
              addLog("log.sentBack", { name: player.nameKey, victim: p.nameKey });
            }
          });
        });
        if (captured) player.hasCaptured = true;
      }
    }

    updateCellDensity();
    renderRoster();

    // The throw has now been used, whatever it did.
    spendChip(spentChipId);
    state.movedThisTurn = true;
    state.busy = false;

    var allFinished = player.pieces.every(function(pc){ return pc.status === "finished"; });
    if (allFinished) {
      recordFinish(player);
      return;
    }

    // A capture earns another throw, which joins the pool alongside anything
    // still unspent.
    if (captured) {
      addLog("log.captureAgain", { name: player.nameKey });
      state.turnState = "AWAITING_ROLL";
      updateUI();
      return;
    }

    if (state.pool.length) {
      beginSpending();   // ends the turn by itself if nothing else can play
    } else {
      advanceTurn();
    }
  };

  if (move.type === "enter") {
    piece.status = "active";
    piece.pathIndex = move.destIndex;
    var enterRC = player.path[move.destIndex];
    document.getElementById("pieces-" + enterRC[0] + "-" + enterRC[1]).appendChild(token);
    token.classList.add("pop-in");
    setTimeout(function(){ token.classList.remove("pop-in"); }, 420);
    sleep(160).then(afterPlacement);
  } else if (move.type === "finish") {
    var fromIdx = piece.pathIndex;
    animateHop(player.path, token, fromIdx, move.destIndex).then(function(){
      piece.status = "finished";
      piece.pathIndex = -2;
      document.getElementById("finished-" + player.id).appendChild(token);
      addLog("log.reachedHome", { name: player.nameKey });
      afterPlacement();
    });
  } else {
    var from = piece.pathIndex;
    animateHop(player.path, token, from, move.destIndex).then(function(){
      piece.pathIndex = move.destIndex;
      afterPlacement();
    });
  }
}

function playerActive(p) {
  return p.pieces.some(function(pc){ return pc.status !== "finished"; });
}

function advanceTurn() {
  clearHighlights();
  state.pool = [];
  state.selectedChipId = null;
  state.legalMoves = [];

  // A stall is not the same as an ending. Play can sit for a while with
  // nobody able to move — everyone needing an exact count for the centre, say
  // — and at a real board you would simply keep throwing until it broke. So
  // after two rounds with no piece moving the game offers a way out rather
  // than picking a winner: the players may call it a tie, or carry on.
  if (state.movedThisTurn) {
    state.deadTurns = 0;
    if (state.stalled) {
      state.stalled = false;
      state.tieVotes = [];      // the position broke; any votes are void
      addLog("log.unstalled");
    }
  } else {
    state.deadTurns++;
  }

  var active = state.players.filter(playerActive);
  if (!active.length) return endGame();

  if (!state.stalled && state.deadTurns >= active.length * 2) {
    state.stalled = true;
    addLog("log.stalled");
  }

  var n = state.players.length;
  for (var step = 1; step <= n; step++) {
    var idx = (state.currentPlayerIndex + step) % n;
    if (playerActive(state.players[idx])) { state.currentPlayerIndex = idx; break; }
  }

  state.movedThisTurn = false;
  state.turnState = "AWAITING_ROLL";
  updateUI();
}

/* ============================= PLACINGS ============================= */
function ordinal(n) {
  var s = t("ord." + n);
  return s === ("ord." + n) ? String(n) : s;
}

// How far a player has got overall — used only to rank whoever is still on
// the board when the game ends early.
function progressOf(p) {
  var lastIndex = state.pathLength - 1;
  var total = 0;
  p.pieces.forEach(function(pc) {
    if (pc.status === "finished") total += lastIndex + 1;
    else if (pc.status === "active") total += pc.pathIndex + 1;
  });
  return total;
}

function standingsText() {
  return state.placements.map(function(pid, i) {
    return ordinal(i + 1) + "   " + playerName(pid);
  }).join("\n");
}

function recordFinish(player) {
  if (state.placements.indexOf(player.id) < 0) state.placements.push(player.id);
  dropTieVote(player.id);       // they are home; the vote is no longer theirs
  addLog("log.isHome", { name: player.nameKey, place: ordinal(state.placements.length) });

  var remaining = state.players.filter(playerActive);

  // The first player home decides whether the rest keep racing for the
  // remaining places, rather than the game just stopping.
  if (state.placements.length === 1 && remaining.length > 1 && !state.playOn) {
    state.turnState = "PAUSED_WIN";
    showWinOverlay(player, true);
    updateUI();
    return;
  }

  if (remaining.length <= 1) {
    remaining.forEach(function(p) {
      if (state.placements.indexOf(p.id) < 0) state.placements.push(p.id);
    });
    return endGame();
  }

  state.movedThisTurn = true;
  advanceTurn();
}

function endGame(reason) {
  state.turnState = "GAME_OVER";
  clearHighlights();
  state.pool = [];
  state.selectedChipId = null;
  state.stalled = false;

  // Rank anyone still on the board by how far they got.
  var unplaced = state.players.filter(function(p) {
    return state.placements.indexOf(p.id) < 0;
  });
  unplaced.sort(function(a, b) { return progressOf(b) - progressOf(a); });
  unplaced.forEach(function(p) { state.placements.push(p.id); });

  if (reason) addLog(reason);
  addLog("log.final", { list: standingsText().replace(/\n/g, " \u00b7 ") });
  showWinOverlay(state.players[state.placements[0]], false);
  updateUI();
}

/* Who gets a say: everyone still playing whom a person is actually operating.
   The computer has no opinion about stopping. */
function tieVoters() {
  return state.players.filter(function(p) {
    if (!playerActive(p)) return false;
    if (online.mode === "local") return !p.isCPU;
    return online.config && online.config.seatKinds[p.id] !== "cpu";
  });
}

/* A majority, as at a chess board: both of two, two of three, three of four. */
function tieThreshold() {
  return Math.floor(tieVoters().length / 2) + 1;
}

/* Whether this seat gets a say. The threshold is counted from the players still
   going, so the votes have to be counted from the same set — otherwise somebody
   who is already home can carry a tie that nobody still playing agreed to. */
function canVoteForTie(playerId) {
  if (playerId === null || playerId === undefined) return false;
  return tieVoters().some(function(p) { return p.id === playerId; });
}

/* Called when a player reaches the centre: their vote goes with them. A vote
   cast while playing must not keep counting after they have finished. */
function dropTieVote(playerId) {
  var at = state.tieVotes.indexOf(playerId);
  if (at >= 0) state.tieVotes.splice(at, 1);
}

/* Which seat the person at this screen votes with. */
function myVotingSeat() {
  if (online.mode === "guest") return online.mySeat;
  if (online.mode === "host") {
    for (var i = 0; i < online.config.seatKinds.length; i++) {
      if (online.config.seatKinds[i] === "local") return i;
    }
  }
  return state.currentPlayerIndex;
}

function hasVotedForTie(playerId) {
  return state.tieVotes.indexOf(playerId) >= 0;
}

/* One player asking. On this device alone there is nobody to ask, so it simply
   ends; online it takes a majority, and asking again withdraws your vote. */
function requestTie(playerId) {
  if (!state || state.turnState === "GAME_OVER" || !state.stalled) return;
  if (playerId === null || playerId === undefined) return;

  // On this device one press ends it, and only a person can press it.
  if (online.mode === "local") return callItATie();

  // Online it is a vote, and a vote belongs to someone still in the game.
  if (!canVoteForTie(playerId)) return;

  var at = state.tieVotes.indexOf(playerId);
  if (at >= 0) {
    state.tieVotes.splice(at, 1);
    addLog("log.tieWithdrawn", { name: "seat." + playerId });
  } else {
    state.tieVotes.push(playerId);
    addLog("log.tieAsked", {
      name: "seat." + playerId,
      have: state.tieVotes.length,
      need: tieThreshold()
    });
    notifyTieRequest(playerId);
  }

  if (state.tieVotes.length >= tieThreshold()) return callItATie();
  updateUI();
}

/* Everyone still playing agrees to stop. Nobody is ranked above anybody else,
   which is the honest outcome when the position simply would not break. */
function callItATie() {
  if (!state || state.turnState === "GAME_OVER") return;

  var drawn = state.players.filter(playerActive);
  if (drawn.length < 2) return;          // only one left: that is a win, not a tie

  state.turnState = "GAME_OVER";
  state.stalled = false;
  state.tieVotes = [];
  clearHighlights();
  state.pool = [];
  state.selectedChipId = null;

  addLog("log.tieCalled", {
    names: drawn.map(function(p) { return playerName(p.id); }).join(", ")
  });

  var overlay = document.getElementById("win-overlay");
  var nameEl = overlay.querySelector(".win-name");
  nameEl.textContent = drawn.map(function(p) { return playerName(p.id); }).join("  ·  ");
  nameEl.style.color = "var(--khaki-text)";
  document.getElementById("win-eyebrow").textContent = t("win.drawn");

  // Anyone already home keeps their place; the rest share what is left.
  var lines = [];
  state.placements.forEach(function(pid, i) {
    lines.push(ordinal(i + 1) + "   " + playerName(pid));
  });
  lines.push(t("win.drawNote"));
  document.getElementById("win-standings").textContent = lines.join("\n");

  document.getElementById("play-on-btn").hidden = true;
  document.getElementById("play-again-btn").textContent = t("win.playAgain");
  overlay.classList.remove("hidden");
  updateUI();
}

function showWinOverlay(player, offerPlayOn) {
  var overlay = document.getElementById("win-overlay");
  var nameEl = overlay.querySelector(".win-name");
  nameEl.textContent = player.name;
  nameEl.style.color = "var(--" + player.colorVar + ")";

  document.getElementById("win-eyebrow").textContent =
    offerPlayOn ? "First one home" : "Final placings";
  document.getElementById("win-standings").textContent =
    offerPlayOn ? "Do you want to play on for the remaining places?" : standingsText();
  document.getElementById("play-on-btn").hidden = !offerPlayOn;
  document.getElementById("play-again-btn").textContent =
    offerPlayOn ? "End here" : "Play again";

  overlay.classList.remove("hidden");
}
