/* Chowka-Bhara — Setting a game up, running a turn, and deciding placings. */
"use strict";

/* ============================= GAME INIT ============================= */
// Which of the 4 edge-slots (0=top,1=right,2=bottom,3=left) are used for a
// given player count. 2 players sit opposite each other; 4 use every edge.
var SLOT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

function initGame(N, numPlayers, numCPU, cpuSkill) {
  // Computers take the last seats, so a lone human is always the first to move.
  numCPU = Math.max(0, Math.min(numCPU || 0, numPlayers));
  var firstCPU = numPlayers - numCPU;

  var built = buildCanonicalPath(N);
  var ringBoundaries = built.ringBoundaries;
  var allSlotPaths = [0, 1, 2, 3].map(function(s){ return rotatePath(built.path, s, N); });

  // Only the four starting squares are safe, matching the traditional board -
  // marked regardless of player count, same as a physical board would show them.
  var safeCellSet = {};
  allSlotPaths.forEach(function(p){ safeCellSet[p[0][0] + "," + p[0][1]] = true; });

  var slots = SLOT_SETS[numPlayers];
  var players = [];
  for (var i = 0; i < numPlayers; i++) {
    var pieces = [];
    // Every piece begins on its owner's start square, as it would on a real
    // board. There is no separate "entering" move, so a roll of 2 always
    // moves two squares.
    for (var j = 0; j < PIECES_PER_PLAYER; j++) pieces.push({ id: j, status: "active", pathIndex: 0 });
    players.push({
      id: i,
      nameKey: PLAYER_DEFS[i].key,
      colorVar: PLAYER_DEFS[i].colorVar,
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
    cpuSkill: cpuSkill || "sharp",
    cpuTimer: null,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  };

  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("win-overlay").classList.add("hidden");

  renderBoardStructure();
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

/* Everyone still playing agrees to stop. Nobody is ranked above anybody else,
   which is the honest outcome when the position simply would not break. */
function callItATie() {
  if (!state || state.turnState === "GAME_OVER") return;

  var drawn = state.players.filter(playerActive);
  if (drawn.length < 2) return;          // only one left: that is a win, not a tie

  state.turnState = "GAME_OVER";
  state.stalled = false;
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
