/* Chowka-Bhara — What a throw produces, which moves are legal, and the banked-throw pool. */
"use strict";

/* ============================= SHELL THROW ============================= */
// Four cowries on the small board, six on the large. The board is passed in
// so a test can throw for either without a game running.
function throwShells(N) {
  var count = shellCount(N === undefined ? (state ? state.N : 5) : N);
  var shells = [];
  var i;
  for (i = 0; i < count; i++) shells.push(Math.random() < 0.5);
  var upCount = shells.filter(Boolean).length;
  var outcome = throwOutcome(upCount, count);
  return {
    shells: shells,
    upCount: upCount,
    moveValue: outcome.moveValue,
    bonus: outcome.bonus
  };
}

function sleep(ms) { return new Promise(function(res){ setTimeout(res, ms); }); }

/* ============================= RULES ENGINE ============================= */
function computeLegalMoves(player, moveValue) {
  var moves = [];
  var lastIndex = state.pathLength - 1;
  player.pieces.forEach(function(piece) {
    if (piece.status === "active") {
      var d = piece.pathIndex + moveValue;
      if (d > lastIndex) return; // overshoot: illegal
      if (d === lastIndex) {
        moves.push({ pieceId: piece.id, type: "finish", destIndex: d });
      } else {
        var layer = layerOf(d, state.ringBoundaries);
        if (layer > 0 && !player.hasCaptured) return; // gated: illegal
        moves.push({ pieceId: piece.id, type: "move", destIndex: d });
      }
    }
  });
  return moves;
}

function highlightLegal(moves) {
  var player = currentPlayer();
  moves.forEach(function(m) {
    var token = document.getElementById("token-p" + player.id + "-" + m.pieceId);
    if (token) token.classList.add("legal");
  });
}
function clearHighlights() {
  document.querySelectorAll(".legal").forEach(function(el){ el.classList.remove("legal"); });
}

/* ============================= POOL ============================= */
// Which banked throws can actually be played right now. A value may be
// unplayable at this moment yet become playable after another value is spent
// (a capture unlocks the inner rings), so this is recomputed every time.
function playableChips() {
  var player = currentPlayer();
  var out = [];
  state.pool.forEach(function(chip) {
    var legal = computeLegalMoves(player, chip.value);
    if (legal.length) out.push({ chip: chip, moves: legal });
  });
  return out;
}

function selectedEntry() {
  var playable = playableChips();
  for (var i = 0; i < playable.length; i++) {
    if (playable[i].chip.id === state.selectedChipId) return playable[i];
  }
  return null;
}

// Auto-select when there is no real choice to make, so the common case stays
// a single tap.
function ensureSelection() {
  var playable = playableChips();
  if (!playable.length) { state.selectedChipId = null; return; }
  if (!selectedEntry()) state.selectedChipId = playable[0].chip.id;
}

function spendChip(chipId) {
  state.pool = state.pool.filter(function(c) { return c.id !== chipId; });
  if (state.selectedChipId === chipId) state.selectedChipId = null;
}

function renderPool() {
  var wrap = document.getElementById("pool");
  var chips = document.getElementById("pool-chips");
  var showing = state.pool.length > 0 && state.turnState !== "GAME_OVER";
  wrap.hidden = !showing;
  if (!showing) { chips.innerHTML = ""; return; }

  var playable = playableChips();
  var playableIds = {};
  playable.forEach(function(e) { playableIds[e.chip.id] = true; });

  chips.innerHTML = "";
  state.pool.forEach(function(chip) {
    var btn = document.createElement("button");
    btn.className = "pool-chip" +
      (chip.id === state.selectedChipId ? " selected" : "");
    btn.disabled = !playableIds[chip.id] || state.busy ||
      !controlsSeat(state.currentPlayerIndex) || online.pausedSeat !== null;
    btn.innerHTML = chip.value +
      (playableIds[chip.id] ? "" : '<span class="chip-sub">' + t("pool.noMove") + '</span>');
    btn.addEventListener("click", function() {
      state.selectedChipId = chip.id;
      refreshMoveOptions();
      updateUI();
    });
    chips.appendChild(btn);
  });
}

// Point legalMoves and the board highlights at whichever chip is selected.
function refreshMoveOptions() {
  clearHighlights();
  var entry = selectedEntry();
  state.legalMoves = entry ? entry.moves : [];
  if (state.legalMoves.length) highlightLegal(state.legalMoves);
}
