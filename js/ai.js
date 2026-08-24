/* Chowka-Bhara — The computer opponent. */
"use strict";

/* ============================= COMPUTER PLAYER ============================= */
// The computer weighs every legal move on the four things a human actually
// thinks about: what it wins right now (a capture, a piece home), how exposed
// the destination square is, what the move threatens next turn, and whether it
// escapes a square already under threat. Exposure is weighted by the real odds
// of each roll rather than treated as a flat yes/no.

function cellKey(rc) { return rc[0] + "," + rc[1]; }
function isSafeCell(rc) { return !!state.safeCellSet[cellKey(rc)]; }

// Every square an opponent could land on next turn, mapped to the summed
// probability of them throwing the number that gets them there. Counted once
// per roll rather than once per piece, so four pieces sitting in hand do not
// read as four times the danger.
function threatMap(againstPlayer) {
  var map = {};
  var lastIndex = state.pathLength - 1;

  rollOdds(state.N).forEach(function(roll) {
    var reachable = {};
    state.players.forEach(function(p) {
      if (p.id === againstPlayer.id) return;
      p.pieces.forEach(function(piece) {
        if (piece.status !== "active") return;      // already home
        var d = piece.pathIndex + roll.value;
        if (d >= lastIndex) return;                  // the centre captures nothing
        if (layerOf(d, state.ringBoundaries) > 0 && !p.hasCaptured) return;
        var destIndex = d;
        var rc = p.path[destIndex];
        if (isSafeCell(rc)) return;
        // A square they cannot legally land on is not a square they threaten:
        // a pair of somebody's is closed to them, and so is a square of their
        // own where a second piece may not stand.
        var blocker = immortalOwner(rc);
        if (blocker !== null && blocker !== p.id) return;
        var standing = piecesOnCell(rc);
        if (standing[p.id] && !state.stackCellSet[cellKey(rc)]) return;
        reachable[cellKey(rc)] = true;
      });
    });
    Object.keys(reachable).forEach(function(k) {
      map[k] = (map[k] || 0) + roll.p;
    });
  });
  return map;
}

function opponentsOn(rc, player) {
  var out = [];
  state.players.forEach(function(p) {
    if (p.id === player.id) return;
    p.pieces.forEach(function(op) {
      if (op.status !== "active") return;
      var orc = p.path[op.pathIndex];
      if (orc[0] === rc[0] && orc[1] === rc[1]) out.push({ player: p, piece: op });
    });
  });
  return out;
}

// How much this square would threaten next turn if the piece stood on it.
function threatCreated(player, destIndex) {
  var lastIndex = state.pathLength - 1;
  var total = 0;
  rollOdds(state.N).forEach(function(roll) {
    var d = destIndex + roll.value;
    if (d >= lastIndex) return;
    if (layerOf(d, state.ringBoundaries) > 0 && !player.hasCaptured) return;
    var rc = player.path[d];
    if (isSafeCell(rc)) return;
    // Threatening a pair is not a threat: there is nowhere to land.
    var held = immortalOwner(rc);
    if (held !== null && held !== player.id) return;
    var victims = opponentsOn(rc, player);
    if (victims.length) total += roll.p * victims.length;
  });
  return total;
}

function scoreMove(player, move, threats) {
  var lastIndex = state.pathLength - 1;
  var piece = player.pieces[move.pieceId];
  var score = 0;

  if (move.type === "finish") {
    score += 1200;
    var alreadyHome = player.pieces.filter(function(pc) {
      return pc.status === "finished";
    }).length;
    if (alreadyHome === piecesPerPlayer(state.N) - 1) score += 5000;  // this wins
    return score;
  }

  var destRC = player.path[move.destIndex];
  var destSafe = isSafeCell(destRC);
  // Landing beside one of your own, where that pair cannot be taken.
  var pairs = !destSafe && (piecesOnCell(destRC)[player.id] || 0) > 0;

  var victims = destSafe ? [] : opponentsOn(destRC, player);
  if (victims.length) {
    score += 700 * victims.length;
    // The first capture is the only key to the inner rings, so it is worth
    // far more than the material it takes.
    if (!player.hasCaptured) score += 900;
    // Sending back a piece that had nearly finished costs its owner most.
    victims.forEach(function(v) {
      score += 400 * (v.piece.pathIndex / lastIndex);
    });
  }

  var risk = (destSafe || pairs) ? 0 : (threats[cellKey(destRC)] || 0);
  score -= risk * 800;
  if (destSafe) score += 120;
  // Worth more than a safe square, because you chose where to put it.
  if (pairs) score += 260;

  var fromRC = player.path[piece.pathIndex];
  if (fromRC && !isSafeCell(fromRC)) {
    var danger = threats[cellKey(fromRC)] || 0;
    var mine = piecesOnCell(fromRC)[player.id] || 0;
    if (mine > 1) {
      /* Standing in a pair was already safe, so there is nothing to escape.
         Breaking the last pair is the opposite of an escape: the piece that
         stays is left in the open. */
      if (mine === 2) score -= danger * 500;
    } else {
      // Credit for vacating a square that is currently in danger.
      score += danger * 600;
    }
  }

  score += threatCreated(player, move.destIndex) * 300;
  score += move.destIndex * 3;                 // general progress

  return score;
}

// With several throws banked at once the computer picks the pairing, not just
// the piece: every (banked throw × legal piece) combination is scored and the
// best one played. Spending is greedy one step at a time, which is also how a
// person plays it — take the best available move, then look again.
function chooseCPUPlay(player) {
  var playable = playableChips();
  if (!playable.length) return null;

  if (state.cpuSkill === "easy" && Math.random() < 0.65) {
    var e = playable[Math.floor(Math.random() * playable.length)];
    return { chipId: e.chip.id, move: e.moves[Math.floor(Math.random() * e.moves.length)] };
  }

  var threats = threatMap(player);
  var best = null, bestScore = -Infinity;
  playable.forEach(function(entry) {
    entry.moves.forEach(function(move) {
      // A touch of noise so repeated games do not play out identically.
      var s = scoreMove(player, move, threats) + Math.random() * 8;
      if (s > bestScore) { bestScore = s; best = { chipId: entry.chip.id, move: move }; }
    });
  });
  return best;
}

function cpuThinkTime() { return state.reducedMotion ? 60 : 520; }

// Called after every state change; a no-op unless it is a computer's turn.
function maybeRunCPU() {
  if (state.cpuTimer) { clearTimeout(state.cpuTimer); state.cpuTimer = null; }
  if (state.busy) return;
  if (state.turnState === "GAME_OVER" || state.turnState === "PAUSED_WIN") return;
  if (online.mode === "guest") return;      // the host drives every CPU seat
  if (online.pausedSeat !== null) return;   // nobody moves while disconnected

  var player = currentPlayer();
  if (!player.isCPU) return;

  if (state.turnState === "AWAITING_ROLL") {
    state.cpuTimer = setTimeout(function() {
      state.cpuTimer = null;
      onRollClick();
    }, cpuThinkTime());
  } else if (state.turnState === "AWAITING_MOVE") {
    state.cpuTimer = setTimeout(function() {
      state.cpuTimer = null;
      var play = chooseCPUPlay(player);
      if (!play) return;
      state.selectedChipId = play.chipId;
      refreshMoveOptions();
      onTokenClick(player.id, play.move.pieceId, true);
    }, cpuThinkTime());
  }
}
