/* A brief notice across the top of the board. Used when something happens on
   someone else's turn that you would otherwise only find in the log. */
var noticeTimer = null;

function hideNotice() {
  var n = document.getElementById("notice");
  if (!n) return;
  n.classList.remove("show");
  setTimeout(function() { n.hidden = true; }, 250);
}

function showNotice(text) {
  var n = document.getElementById("notice");
  if (!n) return;
  n.textContent = text;
  n.hidden = false;
  n.classList.add("show");
  if (noticeTimer) clearTimeout(noticeTimer);

  // Five seconds is not long enough for everybody, so it can be set to wait
  // until it is dismissed instead.
  if (A11Y.get("messages") === "stay") {
    n.onclick = hideNotice;
    n.classList.add("dismissable");
    return;
  }
  n.onclick = null;
  n.classList.remove("dismissable");
  noticeTimer = setTimeout(hideNotice, 5000);
}

/* Tell everyone except the person who asked. */
function notifyTieRequest(playerId) {
  if (playerId === myVotingSeat()) return;
  showNotice(t("notice.tieAsked", {
    name: playerName(playerId),
    have: state.tieVotes.length,
    need: tieThreshold()
  }));
}

/* Chowka-Bhara — Drawing the board, the sidebar and the cowrie animation. */
"use strict";

/* ============================= BOARD RENDER ============================= */
function renderBoardStructure() {
  var boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  boardEl.className = state.N === 7 ? "board-n7" : "board-n5";
  boardEl.style.gridTemplateColumns = "repeat(" + state.N + ", 1fr)";
  boardEl.style.gridTemplateRows = "repeat(" + state.N + ", 1fr)";

  var mid = (state.N - 1) / 2;

  for (var r = 0; r < state.N; r++) {
    for (var c = 0; c < state.N; c++) {
      var isCenter = (r === mid && c === mid);
      var cell = document.createElement("div");
      cell.className = "cell layer-" + physicalRing(r, c, state.N);
      cell.id = "cell-" + r + "-" + c;

      if (state.safeCellSet[r + "," + c]) cell.classList.add("safe-cell");
      if (isCenter) cell.classList.add("center-cell");

      var piecesEl = document.createElement("div");
      piecesEl.className = "pieces";
      piecesEl.id = "pieces-" + r + "-" + c;
      cell.appendChild(piecesEl);

      // Its own element rather than a pseudo-element, because both of the
      // cell's are already spoken for — the diamond and the high-contrast
      // scrim — and because this one has to be drawn over the pieces. A
      // square with six pieces stacked on it hid every marking it had, which
      // is the square where knowing you are safe matters most.
      if (state.safeCellSet[r + "," + c]) {
        var ring = document.createElement("span");
        ring.className = "safe-ring";
        ring.setAttribute("aria-hidden", "true");
        cell.appendChild(ring);
      }

      boardEl.appendChild(cell);
    }
  }

  state.players.forEach(function(p) {
    var startRC = p.path[0];
    var cell = document.getElementById("cell-" + startRC[0] + "-" + startRC[1]);
    cell.classList.add("player-start");
    cell.style.setProperty("--seat-colour", "var(--" + p.colorVar + ")");
  });

  applyBoardRotation();
}

/* ============================= SIDEBAR RENDER ============================= */
function renderSidebar() {
  var roster = document.getElementById("roster");
  roster.innerHTML = "";

  state.players.forEach(function(p) {
    var row = document.createElement("div");
    row.className = "roster-row";
    row.id = "roster-" + p.id;
    row.innerHTML =
      '<div class="roster-head">' +
        '<span class="dot" style="background:var(--' + p.colorVar + ')"></span>' +
        '<span class="roster-name">' + playerName(p.id) + '</span>' +
        '<span class="roster-counts">' +
          '<span class="count-badge" id="hand-count-' + p.id + '"></span>' +
          '<span class="count-badge" id="finished-count-' + p.id + '"></span>' +
        '</span>' +
      '</div>' +
      '<div class="tray-row">' +
        '<div class="tray finished" id="finished-' + p.id + '"></div>' +
      '</div>';
    roster.appendChild(row);

    p.pieces.forEach(function(piece) {
      var token = document.createElement("div");
      token.className = "token token-" + p.colorVar;
      token.id = "token-p" + p.id + "-" + piece.id;
      token.setAttribute("role", "button");
      token.tabIndex = 0;
      token.addEventListener("click", function(e){ e.stopPropagation(); requestMove(p.id, piece.id); });
      token.addEventListener("keydown", function(e){
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); requestMove(p.id, piece.id); }
      });
      // Tokens start on the board, on their owner's start square.
      var startRC = p.path[0];
      document.getElementById("pieces-" + startRC[0] + "-" + startRC[1])
        .appendChild(token);
    });
  });

  renderRoster();
}

function renderRoster() {
  state.players.forEach(function(p) {
    var onBoard = p.pieces.filter(function(pc){ return pc.status === "active"; }).length;
    var finCount  = p.pieces.filter(function(pc){ return pc.status === "finished"; }).length;
    document.getElementById("hand-count-" + p.id).textContent =
      t("roster.onBoard", { n: onBoard });
    document.getElementById("finished-count-" + p.id).textContent =
      t("roster.home", { n: finCount, total: piecesPerPlayer(state.N) });
    var row = document.getElementById("roster-" + p.id);
    row.classList.toggle("active-player", p.id === state.currentPlayerIndex && state.turnState !== "GAME_OVER");
  });
}

// Pieces sharing a square shrink to fit rather than piling up and spilling
// over the edges. They lay out on the smallest square grid that holds them
// and each takes an equal share of it, so one piece is large and sixteen —
// possible on a safe square, where every player can sit — are all still
// visible.
function updateCellDensity() {
  var els = document.querySelectorAll(".pieces");
  els.forEach(function(el) {
    var n = el.children.length;
    if (!n) { el.style.removeProperty("--tok"); return; }
    var cols = Math.ceil(Math.sqrt(n));
    // Reserve a little of the box for the gutters, and cap a lone piece so
    // it does not swell to fill the whole square.
    var size = Math.min(64, (96 - 6 * (cols - 1)) / cols);
    el.style.setProperty("--tok", size.toFixed(1) + "%");
    el.classList.toggle("tri", n === 3);
  });
}

/* ============================= UI STATE ============================= */
function updateUI() {
  renderRoster();
  var player = currentPlayer();
  var over = state.turnState === "GAME_OVER" || state.turnState === "PAUSED_WIN";
  var cpuTurn = player.isCPU && !over;

  var banner = document.getElementById("turn-banner");
  banner.textContent = t("game.turn", { name: playerName(player.id) }) +
    (player.isCPU ? t("game.computerSuffix") : "");
  banner.style.color = "var(--" + player.colorVar + ")";

  var mine = controlsSeat(player.id);
  var rollBtn = document.getElementById("roll-btn");
  rollBtn.disabled = state.busy || !mine || online.pausedSeat !== null ||
                     state.turnState !== "AWAITING_ROLL";
  rollBtn.textContent =
      !mine ? (player.isCPU ? t("btn.computerPlaying")
                            : t("btn.waitingFor", { name: playerName(player.id) }))
    : state.turnState === "AWAITING_MOVE" ? t("btn.choosePiece")
    : state.pool.length ? t("btn.throwAgain")
    : t("btn.throw");

  renderPool();

  var tieBtn = document.getElementById("tie-btn");
  if (tieBtn) {
    tieBtn.hidden = !state.stalled || state.turnState === "GAME_OVER";
    var seat = myVotingSeat();
    if (online.mode === "local") {
      tieBtn.textContent = t("btn.callTie");
      tieBtn.disabled = false;
      tieBtn.classList.remove("voted");
    } else {
      // Online it is a vote, so the button reports where the vote stands and
      // pressing again takes yours back.
      var mine = seat !== null && hasVotedForTie(seat);
      tieBtn.textContent = mine
        ? t("btn.tieWaiting", { have: state.tieVotes.length, need: tieThreshold() })
        : state.tieVotes.length
          ? t("btn.tieAgree", { have: state.tieVotes.length, need: tieThreshold() })
          : t("btn.callTie");
      tieBtn.disabled = seat === null || seat === undefined;
      tieBtn.classList.toggle("voted", !!mine);
    }
  }

  // Only offered while play is genuinely stuck, and only to someone who can
  // act on it — it disappears again the moment a piece moves.
  var tieBtn = document.getElementById("tie-btn");
  if (tieBtn) {
    tieBtn.hidden = !state.stalled || state.turnState === "GAME_OVER";
    tieBtn.disabled = online.mode === "guest" && online.mySeat === null;
  }

  var statusLine = document.getElementById("status-line");
  if (over) {
    statusLine.textContent = "";
  } else if (state.turnState === "AWAITING_MOVE") {
    var entry = selectedEntry();
    var banked = state.pool.length;
    statusLine.textContent =
      (entry ? t("status.spending", { n: entry.chip.value }) : "") +
      (banked > 1 ? t("status.banked", { n: banked }) : "") +
      (cpuTurn ? t("status.thinking") : entry ? t("status.tapPiece") : "");
  } else if (state.pool.length) {
    statusLine.textContent = t(state.pool.length > 1
      ? "status.bankedThrows" : "status.bankedThrow", { n: state.pool.length });
  } else {
    statusLine.textContent = "";
  }

  if (online.mode === "host" && online.host) online.host.pushSnapshot();
  maybeRunCPU();
}

// Log lines are stored as a key plus values and rendered on the spot, so a
// guest reading Kannada sees Kannada even though the host generated the
// event in Spanish.
var logEntries = [];

function addLog(key, params) {
  logEntries.push({ key: key, params: params || {} });
  if (logEntries.length > 200) logEntries.shift();
  renderLog();
  // The host is the only one that generates events, so it relays them.
  if (online.mode === "host" && online.host) online.host.note(key, params || {});
}

function addRemoteLog(key, params) {
  logEntries.push({ key: key, params: params || {} });
  if (logEntries.length > 200) logEntries.shift();
  renderLog();
}

function renderLog() {
  var log = document.getElementById("log");
  if (!log) return;
  log.innerHTML = "";
  logEntries.forEach(function(entry) {
    var line = document.createElement("div");
    line.className = "log-line";
    // Player names are stored as keys too, so they translate with everything.
    var vals = {};
    Object.keys(entry.params).forEach(function(k) {
      var v = entry.params[k];
      vals[k] = (typeof v === "string" && v.indexOf("players.") === 0) ? t(v) : v;
    });
    line.textContent = t(entry.key, vals);
    log.appendChild(line);
  });
  log.scrollTop = log.scrollHeight;
}

/* ============================= ANIMATION ============================= */

/* The tray is built rather than written out, because the two boards are played
   with different numbers of cowries. Six need to be smaller to sit in one row
   in the sidebar, which the class carries. */
function renderShellTray() {
  var tray = document.getElementById("shell-tray");
  if (!tray) return;
  var count = shellCount(state ? state.N : 5);
  tray.classList.toggle("six", count === 6);
  tray.innerHTML = "";
  for (var i = 0; i < count; i++) {
    var shell = document.createElement("div");
    shell.className = "shell down";
    tray.appendChild(shell);
  }
}

function animateShells(result) {
  var shellEls = Array.prototype.slice.call(document.querySelectorAll(".shell"));
  shellEls.forEach(function(el){ el.classList.add("flipping"); });
  return sleep(state.reducedMotion ? 60 : 650).then(function(){
    shellEls.forEach(function(el, i){
      el.classList.remove("flipping");
      el.classList.toggle("up", result.shells[i]);
      el.classList.toggle("down", !result.shells[i]);
    });
    return sleep(150);
  });
}

function animateHop(playerPath, token, fromIdx, toIdx) {
  // Per square. 120ms read as a piece being flicked rather than moved; this is
  // slow enough to follow a count of eight without being a wait.
  var delay = state.reducedMotion ? 0 : 160;
  var i = fromIdx + 1;
  function step() {
    if (i > toIdx) return Promise.resolve();
    var rc = playerPath[i];
    var cell = document.getElementById("pieces-" + rc[0] + "-" + rc[1]);
    cell.appendChild(token);
    i++;
    return delay ? sleep(delay).then(step) : step();
  }
  return step();
}
