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
  SEATS.build();
  buildLangPicker();
  renderSpaceLabels();
  renderLog();
  if (state) {
    renderSidebar();
    syncTokensToState();
    updateCellDensity();
    updateUI();
  }
  if (online.host) renderSeatList(online.host.seats());
  refreshLobbyText();         // I18N.apply() has just reset it to its default
  selectTab(setupTab);
}

// The board-size labels say what changes with the board: how far there is to
// walk, and how many pieces walk it. The two boards are different games, so
// the choice should show that before it is made.
function renderSpaceLabels() {
  Array.prototype.forEach.call(document.querySelectorAll("[data-board]"), function(elm) {
    var N = parseInt(elm.getAttribute("data-board"), 10);
    elm.textContent = t("setup.spaces", { n: N * N, p: piecesPerPlayer(N) });
  });
}

function buildHowTo() {
  var list = el("howto-list");
  if (!list) return;
  list.innerHTML = "";
  // Runs past the end on purpose: missing keys are skipped, so a line can be
  // added to the table without also having to remember this number.
  for (var i = 1; i <= 24; i++) {
    var key = "howto." + i;
    var text = t(key);
    if (text === key) continue;
    var li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  }
}

/* ============================= WIRE UP ============================= */

/* The words go in before anything that could throw. A single bad listener used
   to take the whole page down with it, and an empty screen is a far worse
   failure than a button that does nothing. */
I18N.load();
I18N.apply();
A11Y.load();
SEATS.load();

/* Attach a handler only if the element is really there. Markup and scripts can
   fall out of step — a cached script from an earlier release meeting fresh
   markup, say — and that should cost one control, not the entire screen. */
function on(id, event, fn) {
  var node = el(id);
  if (node) node.addEventListener(event, fn);
  else if (window.console) console.warn("[chowka] no element #" + id);
}

function openA11y() {
  A11Y.open();
  SEATS.build();              // players, above the accessibility settings
  buildLangPicker();          // language lives inside the panel too
}
on("a11y-btn", "click", openA11y);
on("a11y-btn-setup", "click", openA11y);
on("a11y-close", "click", function() { A11Y.close(); });
on("a11y-backdrop", "click", function() { A11Y.close(); });
buildLangPicker();
buildHowTo();
renderSpaceLabels();

on("tie-btn", "click", function() {
  if (online.mode === "guest") return online.guest.sendIntent({ kind: "tie" });
  requestTie(myVotingSeat());
});

on("howto-btn", "click", function() {
  el("howto-drawer").classList.remove("hidden");
});

on("history-back", "click", function() { historyStep(-1); });
on("history-forward", "click", function() { historyStep(1); });
on("history-now", "click", historyLiveAgain);

on("history-btn", "click", function() {
  renderHistory();
  el("history-drawer").classList.remove("hidden");
  // Opened to look back, and the newest line — the one you just missed — is at
  // the top of the list, so that is where it opens.
  var list = el("history-list");
  if (list && list.parentNode) list.parentNode.scrollTop = 0;
});
function closeHistory() {
  el("history-drawer").classList.add("hidden");
  if (!historyLive()) historyLiveAgain();   // closing means coming back
}
on("history-close", "click", closeHistory);
on("history-backdrop", "click", closeHistory);
function closeHowTo() { el("howto-drawer").classList.add("hidden"); }
on("howto-close", "click", closeHowTo);
on("howto-backdrop", "click", closeHowTo);
document.addEventListener("keydown", function(e) {
  // Only when a game is on screen and nothing is being typed into.
  var typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "");
  if (!typing && state && e.key === "ArrowLeft") { historyStep(-1); return; }
  if (!typing && state && e.key === "ArrowRight") { historyStep(1); return; }
  if (e.key !== "Escape") return;
  closeHowTo();
  closeHistory();
  A11Y.close();
});

/* One tab is showing at a time; that is the mode. */
var setupTab = "local";
function currentMode() { return setupTab; }

/* Board size and player count belong to both playing tabs. Rather than two
   copies that can quietly disagree, the single block is moved into whichever
   tab is showing, which keeps its state for nothing. */
function selectTab(which) {
  setupTab = which;

  ["local", "host", "join"].forEach(function(name) {
    var tab = el("tab-" + name), panel = el("panel-" + name);
    if (tab) {
      tab.classList.toggle("on", name === which);
      tab.setAttribute("aria-selected", String(name === which));
    }
    if (panel) panel.hidden = name !== which;
  });

  var settings = el("game-settings");
  var slot = document.querySelector("#panel-" + which + " .panel-slot");
  if (settings && slot) slot.appendChild(settings);

  syncCPUOptions();
  if (typeof SEATS !== "undefined") SEATS.build();
}

["local", "host", "join"].forEach(function(name) {
  on("tab-" + name, "click", function() { selectTab(name); });
});

// Select the opening tab through the same path as a click, so the tab state
// and the position of the shared settings are decided in one place rather than
// half by the markup and half by the first thing the player presses.
selectTab(setupTab);

on("join-code", "input", function() {
  var input = el("join-code");
  input.value = ChowkaNet.normaliseRoomCode(input.value);
});

on("begin-btn", "click", function() {
  var cfg = readSetup();
  initGame(cfg.N, cfg.numPlayers, cfg.numCPU, cfg.cpuSkill);
});

on("host-btn", "click", function() { startHosting(); });

on("join-btn", "click", function() {
  var code = ChowkaNet.normaliseRoomCode(el("join-code").value);
  if (code.length < 4) return el("join-code").focus();
  startJoining(code);
});

on("start-online-btn", "click", function() {
  var cfg = online.config;
  var seats = online.host.seats();

  // Seats nobody claimed fall to the computer rather than standing empty.
  cfg.seatKinds = cfg.seatKinds.map(function(kind, i) {
    if (kind === "local") return "local";
    return seats[i] && seats[i].occupied ? "remote" : "cpu";
  });

  initGame(cfg.N, cfg.numPlayers, 0, cfg.cpuSkill);
  state.players.forEach(function(p, i) { p.isCPU = cfg.seatKinds[i] === "cpu"; });

  showScreen("game-screen");
  updateNetBadge();
  online.host.pushSeats();
  updateUI();                       // also broadcasts the opening snapshot
});

on("lobby-cancel-btn", "click", function() {
  if (online.peer) { try { online.peer.destroy(); } catch (e) {} }
  location.reload();
});

on("pause-cpu-btn", "click", function() {
  var seatId = online.pausedSeat;
  if (seatId === null || !online.host) return;
  online.config.seatKinds[seatId] = "cpu";
  if (state) state.players[seatId].isCPU = true;
  online.host.resumeWithCPU(seatId);
  online.pausedSeat = null;
  el("pause-overlay").classList.add("hidden");
  addLog("log.cpuTakeover", { name: "seat." + seatId });
  updateNetBadge();
  if (state) updateUI();
});

on("pause-quit-btn", "click", function() {
  if (online.peer) { try { online.peer.destroy(); } catch (e) {} }
  location.reload();
});

/* The two counts on the setup screen are halves of one number: the humans and
   the computers sit down at the same table, and the game only deals tables of
   two or four. So a computer count is offered only when it adds up to one of
   those — one human is given one computer or three, never two, because that
   would seat three players on three consecutive sides. The count it starts on
   is the smallest table the humans can make, which for a single player is a
   game against the computer. */
function cpuChoicesFor(numHumans) {
  var allowed = [0, 1, 2, 3].filter(function(n) {
    var seats = numHumans + n;
    return seats === 2 || seats === 4;
  });
  return { allowed: allowed, preferred: allowed.length ? allowed[0] : 0 };
}

// A count with no table for it is disabled rather than silently clamped at
// Begin, and the choice moves to a workable one rather than staying on a
// pressed option that no longer means anything.
function syncCPUOptions() {
  var numHumans = parseInt(document.querySelector('input[name="num-players"]:checked').value, 10);
  var choice = cpuChoicesFor(numHumans);
  var picked = document.querySelector('input[name="num-cpu"]:checked');
  var numCPU = picked ? parseInt(picked.value, 10) : -1;

  if (choice.allowed.indexOf(numCPU) < 0) {
    numCPU = choice.preferred;
    document.getElementById("cpu-" + numCPU).checked = true;
  }
  [0, 1, 2, 3].forEach(function(n) {
    document.getElementById("cpu-" + n).disabled = choice.allowed.indexOf(n) < 0;
  });

  // Skill is meaningless with nobody to apply it to.
  document.getElementById("cpu-skill-section").hidden = numCPU === 0;
  // The table just changed size, so the seat rows have to follow it.
  if (typeof SEATS !== "undefined") SEATS.build();
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
