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

  /* This redraws everything, so it has to start by clearing everything.
     Emptying the roster alone was not enough: the finished trays live inside
     it, so the pieces sitting in them were destroyed, while the pieces out on
     the board survived and a second full set was made beside them. Changing
     language mid-game runs this, which is why a few visits to the settings
     panel could leave the board carrying several sets of pieces at once. */
  Array.prototype.forEach.call(document.querySelectorAll(".token"), function(token) {
    if (token.parentNode) token.parentNode.removeChild(token);
  });
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
      // Placed where the piece actually is, not where it began. At the start
      // of a game those are the same square; mid-game they are not, and
      // assuming otherwise put every piece back on its start square.
      var home;
      if (piece.status === "finished") {
        home = document.getElementById("finished-" + p.id);
      } else {
        var rc = p.path[piece.pathIndex] || p.path[0];
        home = document.getElementById("pieces-" + rc[0] + "-" + rc[1]);
      }
      if (home) home.appendChild(token);
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
                     state.turnState !== "AWAITING_ROLL" || !historyLive();
  rollBtn.textContent =
      !mine ? (player.isCPU ? t("btn.computerPlaying")
                            : t("btn.waitingFor", { name: playerName(player.id) }))
    : state.turnState === "AWAITING_MOVE" ? t("btn.choosePiece")
    : state.pool.length ? t("btn.throwAgain")
    : t("btn.throw");

  renderPool();

  var tieBtn = document.getElementById("tie-btn");
  if (tieBtn) {
    var seat = myVotingSeat();
    // Offered only while play is genuinely stuck, and only to someone whose
    // vote would count — a player already home has no say in ending it.
    tieBtn.hidden = !state.stalled || state.turnState === "GAME_OVER" ||
                    (online.mode !== "local" && !canVoteForTie(seat));
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

/* Where every piece stood and what the cowries showed when this line was
   written. A few dozen small numbers, so six hundred of them cost nothing, and
   it is what lets the log be stepped through rather than only read. */
function logSnapshot() {
  if (typeof state === "undefined" || !state) return null;
  return {
    pieces: state.players.map(function (p) {
      return p.pieces.map(function (pc) {
        return pc.status === "finished" ? -1 : pc.pathIndex;
      });
    }),
    shells: state.lastRoll ? state.lastRoll.shells.slice() : null,
    turn: state.currentPlayerIndex
  };
}

function pushLog(key, params) {
  logEntries.push({ key: key, params: params || {}, at: logSnapshot() });
  if (logEntries.length > 600) logEntries.shift();
  // Reading the past while it grows is confusing; new lines return you to now.
  history.viewing = null;
  renderLog();
}

function addLog(key, params) {
  pushLog(key, params);
  // The host is the only one that generates events, so it relays them.
  if (online.mode === "host" && online.host) online.host.note(key, params || {});
}

function addRemoteLog(key, params) {
  pushLog(key, params);
}

/* ============================= LOOKING BACK ============================= */

/* Stepping through the log moves the pieces and the cowries on the real board,
   because that is the board you are trying to read. Nothing here touches the
   game itself: only where the tokens are drawn, and only until you come back to
   the present. */
var history = { viewing: null };

function historyLive() { return history.viewing === null; }

function showShells(shells) {
  var tray = document.querySelectorAll(".shell");
  Array.prototype.forEach.call(tray, function (el, i) {
    el.classList.remove("flipping");
    var up = shells && shells[i];
    el.classList.toggle("up", !!up);
    el.classList.toggle("down", !up);
  });
}

function historyGoTo(index) {
  if (!logEntries.length) return;
  index = Math.max(0, Math.min(index, logEntries.length - 1));
  var entry = logEntries[index];
  if (!entry || !entry.at) return;      // a line from before a board existed

  history.viewing = index;

  entry.at.pieces.forEach(function (positions, playerId) {
    var player = state.players[playerId];
    if (!player) return;
    positions.forEach(function (at, pieceId) {
      var token = document.getElementById("token-p" + playerId + "-" + pieceId);
      if (!token) return;
      var home = at < 0
        ? document.getElementById("finished-" + playerId)
        : (function () {
            var rc = player.path[at];
            return rc ? document.getElementById("pieces-" + rc[0] + "-" + rc[1]) : null;
          })();
      if (home) home.appendChild(token);
    });
  });

  showShells(entry.at.shells);
  updateCellDensity();
  renderHistory();
  updateUI();
}

function historyStep(delta) {
  var from = history.viewing === null ? logEntries.length - 1 : history.viewing;
  historyGoTo(from + delta);
}

/* Back to now: the pieces where the game says they are, the cowries showing the
   throw that actually stands. */
function historyLiveAgain() {
  history.viewing = null;
  syncTokensToState();
  showShells(state && state.lastRoll ? state.lastRoll.shells : null);
  updateCellDensity();
  renderHistory();
  updateUI();
}

/* The same entries the sidebar shows, all of them, numbered, in a panel you can
   scroll. The sidebar log is a glance at the last few lines; this is for going
   back and finding the throw you missed while the pieces were moving. */
function renderHistory() {
  var list = document.getElementById("history-list");
  if (!list) return;
  list.innerHTML = "";

  if (!logEntries.length) {
    var empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = t("history.empty");
    list.appendChild(empty);
    return;
  }

  logEntries.forEach(function(entry, i) {
    var li = document.createElement("li");
    li.className = "history-line" + (history.viewing === i ? " here" : "");
    li.textContent = logText(entry);
    // Any line can be jumped to directly; the arrows are for walking.
    if (entry.at) {
      li.tabIndex = 0;
      li.addEventListener("click", function () { historyGoTo(i); });
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); historyGoTo(i); }
      });
    }
    list.appendChild(li);
  });

  if (history.viewing !== null) {
    var here = list.children[history.viewing];
    if (here && here.scrollIntoView) here.scrollIntoView({ block: "nearest" });
  }
  renderHistoryControls();
}

/* The arrows, and a word on whether you are looking at now or at then. */
function renderHistoryControls() {
  var at = history.viewing === null ? logEntries.length - 1 : history.viewing;
  var where = document.getElementById("history-where");
  if (where) {
    where.textContent = historyLive()
      ? t("history.live")
      : t("history.at", { n: at + 1, total: logEntries.length });
    where.classList.toggle("past", !historyLive());
  }
  var back = document.getElementById("history-back");
  var fwd = document.getElementById("history-forward");
  var now = document.getElementById("history-now");
  if (back) back.disabled = !logEntries.length || at <= 0;
  if (fwd) fwd.disabled = historyLive() || at >= logEntries.length - 1;
  if (now) now.disabled = historyLive();

  // The board says so too, since that is where you are looking.
  var banner = document.getElementById("history-banner");
  if (banner) banner.hidden = historyLive();
}

/* One entry as a sentence. Names are stored as seats and numbers as numbers, so
   both the sidebar and the history read them in whatever language is current. */
function logText(entry) {
  var vals = {};
  Object.keys(entry.params).forEach(function(k) {
    var v = entry.params[k];
    if (typeof v === "string" && v.indexOf("seat.") === 0) {
      vals[k] = playerName(parseInt(v.slice(5), 10));
    } else if (typeof v === "string" && v.indexOf("players.") === 0) {
      vals[k] = t(v);
    } else {
      vals[k] = v;
    }
  });
  return t(entry.key, vals);
}

function renderLog() {
  var log = document.getElementById("log");
  if (!log) return;
  log.innerHTML = "";
  logEntries.forEach(function(entry) {
    var line = document.createElement("div");
    line.className = "log-line";
    line.textContent = logText(entry);
    log.appendChild(line);
  });
  log.scrollTop = log.scrollHeight;
  renderHistory();
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
