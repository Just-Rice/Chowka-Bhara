/* Chowka-Bhara — Language switching and start-up wiring. Loads last. */
"use strict";

/* ============================= LANGUAGE ============================= */
function buildLangPicker() {
  var group = el("lang-group");
  group.innerHTML = "";
  I18N.langs.forEach(function(lang) {
    var input = document.createElement("input");
    input.type = "radio";
    input.name = "lang";
    input.id = "lang-" + lang.code;
    input.value = lang.code;
    if (lang.code === I18N.current) input.checked = true;
    input.addEventListener("change", function() { setLanguage(lang.code); });

    var label = document.createElement("label");
    label.setAttribute("for", input.id);
    label.textContent = lang.label;    // always in its own script

    group.appendChild(input);
    group.appendChild(label);
  });
}

// Everything on screen is redrawn from the table, so switching language mid
// game keeps the position and only changes the words.
function setLanguage(code) {
  if (!I18N.set(code)) return;
  I18N.apply();
  buildHowTo();
  A11Y.build();
  renderSpaceLabels();
  renderLog();
  if (state) {
    renderSidebar();
    syncTokensToState();
    updateCellDensity();
    updateUI();
  }
  if (online.host) renderSeatList(online.host.seats());
  syncModeUI();
}

// The board-size labels count squares, which differs per board.
function renderSpaceLabels() {
  Array.prototype.forEach.call(document.querySelectorAll("[data-spaces]"), function(elm) {
    elm.textContent = t("setup.spaces", { n: elm.getAttribute("data-spaces") });
  });
}

function buildHowTo() {
  var list = el("howto-list");
  if (!list) return;
  list.innerHTML = "";
  for (var i = 1; i <= 13; i++) {
    var key = "howto." + i;
    var text = t(key);
    if (text === key) continue;
    var li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  }
}

/* ============================= WIRE UP ============================= */
A11Y.load();

function openA11y() { A11Y.open(); }
el("a11y-btn").addEventListener("click", openA11y);
el("a11y-btn-setup").addEventListener("click", openA11y);
el("a11y-close").addEventListener("click", function() { A11Y.close(); });
el("a11y-backdrop").addEventListener("click", function() { A11Y.close(); });

I18N.load();
I18N.apply();
buildLangPicker();
buildHowTo();
renderSpaceLabels();

el("tie-btn").addEventListener("click", function() {
  if (online.mode === "guest") return online.guest.sendIntent({ kind: "tie" });
  requestTie(myVotingSeat());
});

el("howto-btn").addEventListener("click", function() {
  el("howto-drawer").classList.remove("hidden");
});
function closeHowTo() { el("howto-drawer").classList.add("hidden"); }
el("howto-close").addEventListener("click", closeHowTo);
el("howto-backdrop").addEventListener("click", closeHowTo);
document.addEventListener("keydown", function(e) {
  if (e.key !== "Escape") return;
  closeHowTo();
  A11Y.close();
});

function currentMode() {
  return document.querySelector('input[name="play-mode"]:checked').value;
}

// Joining takes all its settings from the host, so the local options are
// hidden rather than shown and ignored.
function syncModeUI() {
  var mode = currentMode();
  el("join-section").hidden = mode !== "join";
  el("local-options").hidden = mode === "join";
  el("begin-btn").textContent =
    t(mode === "host" ? "setup.openRoom" : mode === "join" ? "setup.joinRoom" : "setup.begin");
}
Array.prototype.forEach.call(
  document.querySelectorAll('input[name="play-mode"]'),
  function(elm) { elm.addEventListener("change", syncModeUI); }
);
syncModeUI();

el("join-code").addEventListener("input", function() {
  var input = el("join-code");
  input.value = ChowkaNet.normaliseRoomCode(input.value);
});

document.getElementById("begin-btn").addEventListener("click", function(){
  var mode = currentMode();

  if (mode === "host") return startHosting();
  if (mode === "join") {
    var code = ChowkaNet.normaliseRoomCode(el("join-code").value);
    if (code.length < 4) {
      el("join-code").focus();
      return;
    }
    return startJoining(code);
  }

  var cfg = readSetup();
  initGame(cfg.N, cfg.numPlayers, cfg.numCPU, cfg.cpuSkill);
});

el("start-online-btn").addEventListener("click", function() {
  var cfg = online.config;
  var seats = online.host.seats();

  // Seats nobody claimed fall to the computer rather than standing empty.
  cfg.seatKinds = cfg.seatKinds.map(function(kind, i) {
    if (kind === "local") return "local";
    return seats[i] && seats[i].takenBy ? "remote" : "cpu";
  });

  initGame(cfg.N, cfg.numPlayers, 0, cfg.cpuSkill);
  state.players.forEach(function(p, i) { p.isCPU = cfg.seatKinds[i] === "cpu"; });

  showScreen("game-screen");
  updateNetBadge();
  online.host.pushSeats();
  updateUI();                       // also broadcasts the opening snapshot
});

el("lobby-cancel-btn").addEventListener("click", function() {
  if (online.peer) { try { online.peer.destroy(); } catch (e) {} }
  location.reload();
});

el("pause-cpu-btn").addEventListener("click", function() {
  var seatId = online.pausedSeat;
  if (seatId === null || !online.host) return;
  online.config.seatKinds[seatId] = "cpu";
  if (state) state.players[seatId].isCPU = true;
  online.host.resumeWithCPU(seatId);
  online.pausedSeat = null;
  el("pause-overlay").classList.add("hidden");
  addLog("log.cpuTakeover", { name: PLAYER_DEFS[seatId].key });
  updateNetBadge();
  if (state) updateUI();
});

el("pause-quit-btn").addEventListener("click", function() {
  if (online.peer) { try { online.peer.destroy(); } catch (e) {} }
  location.reload();
});

// Asking for more computers than there are seats is meaningless, so the
// choices above the current player count are disabled rather than silently
// clamped at Begin.
function syncCPUOptions() {
  var numPlayers = parseInt(document.querySelector('input[name="num-players"]:checked').value, 10);
  [0, 1, 2, 3].forEach(function(n) {
    var input = document.getElementById("cpu-" + n);
    var tooMany = n > numPlayers;
    input.disabled = tooMany;
    if (tooMany && input.checked) document.getElementById("cpu-0").checked = true;
  });
  // Skill is meaningless with nobody to apply it to.
  var numCPU = parseInt(document.querySelector('input[name="num-cpu"]:checked').value, 10);
  document.getElementById("cpu-skill-section").hidden = numCPU === 0;
}
Array.prototype.forEach.call(
  document.querySelectorAll('input[name="num-players"], input[name="num-cpu"]'),
  function(el) { el.addEventListener("change", syncCPUOptions); }
);
syncCPUOptions();

document.getElementById("roll-btn").addEventListener("click", requestRoll);
document.getElementById("new-game-btn").addEventListener("click", function(){ location.reload(); });

document.getElementById("play-on-btn").addEventListener("click", function(){
  state.playOn = true;
  document.getElementById("win-overlay").classList.add("hidden");
  addLog("log.playingOn");
  state.movedThisTurn = true;
  advanceTurn();
});

// While the "play on?" prompt is up this button means "stop here"; otherwise
// it is the ordinary restart.
document.getElementById("play-again-btn").addEventListener("click", function(){
  if (state && state.turnState === "PAUSED_WIN") {
    document.getElementById("win-overlay").classList.add("hidden");
    endGame();
    return;
  }
  location.reload();
});
