/* Chowka-Bhara — Host-authoritative online play: lobby, seats, snapshots, liveness. */
"use strict";

/* ============================= ONLINE PLAY =============================
 * Host-authoritative. The host's browser owns `state`; guests send intents
 * and render whatever snapshot comes back, so the two boards cannot drift.
 * All the protocol logic lives in js/net.js and is tested headlessly; this
 * file only maps it onto the game and the DOM.
 */
var online = {
  mode: "local",        // "local" | "host" | "guest"
  config: null,         // { N, numPlayers, cpuSkill, seatKinds[] }
  peer: null, transport: null, host: null, guest: null,
  myId: null, mySeat: null, roomCode: null,
  pausedSeat: null,
  _loading: null
};

function el(id) { return document.getElementById(id); }

// The library is only fetched when someone actually plays online, so opening
// this file offline still gives the full local and computer game.
function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  if (online._loading) return online._loading;
  online._loading = new Promise(function(resolve, reject) {
    var s = document.createElement("script");
    s.src = "vendor/peerjs.min.js";
    s.onload = function() { resolve(); };
    s.onerror = function() {
      reject(new Error(t("err.lib")));
    };
    document.head.appendChild(s);
  });
  return online._loading;
}

function peerErrorMessage(err) {
  var type = err && err.type;
  if (type === "peer-unavailable") return t("err.noRoom");
  if (type === "network" || type === "server-error" || type === "socket-error") {
    return t("err.network");
  }
  if (type === "browser-incompatible") return t("err.browser");
  if (type === "unavailable-id") return t("err.codeTaken");
  return t("err.generic", { type: type ? " (" + type + ")" : "" });
}

/* ------------------------------------------------------- serialisation */
// Paths are rebuilt from the board size and seat, so only the moving parts
// travel: piece positions, whose turn it is, and the banked throws.
function serializeState() {
  return {
    N: state.N,
    numPlayers: state.players.length,
    players: state.players.map(function(p) {
      return {
        id: p.id, slot: p.slot, hasCaptured: p.hasCaptured, isCPU: p.isCPU,
        pieces: p.pieces.map(function(pc) {
          return { id: pc.id, status: pc.status, pathIndex: pc.pathIndex };
        })
      };
    }),
    currentPlayerIndex: state.currentPlayerIndex,
    turnState: state.turnState,
    pool: state.pool.map(function(c) { return { id: c.id, value: c.value }; }),
    selectedChipId: state.selectedChipId,
    placements: state.placements.slice(),
    playOn: state.playOn,
    lastRoll: state.lastRoll
  };
}

// Put every token in the container its state says it belongs to. Guests do
// not animate hops — they are shown the result, which cannot desync.
function syncTokensToState() {
  state.players.forEach(function(p) {
    p.pieces.forEach(function(pc) {
      var token = el("token-p" + p.id + "-" + pc.id);
      if (!token) return;
      var target;
      if (pc.status === "finished") target = el("finished-" + p.id);
      else {
        var rc = p.path[pc.pathIndex];
        target = rc ? el("pieces-" + rc[0] + "-" + rc[1]) : null;
      }
      if (target && token.parentNode !== target) target.appendChild(token);
    });
  });
}

function applySnapshot(snap) {
  if (!snap) return;
  if (!state || state.N !== snap.N || state.players.length !== snap.numPlayers) {
    initGame(snap.N, snap.numPlayers, 0, "sharp");
  }
  snap.players.forEach(function(sp, i) {
    var p = state.players[i];
    p.hasCaptured = sp.hasCaptured;
    p.isCPU = sp.isCPU;
    sp.pieces.forEach(function(spc, j) {
      p.pieces[j].status = spc.status;
      p.pieces[j].pathIndex = spc.pathIndex;
    });
  });
  state.currentPlayerIndex = snap.currentPlayerIndex;
  state.turnState = snap.turnState;
  state.pool = snap.pool.slice();
  state.selectedChipId = snap.selectedChipId;
  state.placements = snap.placements.slice();
  state.playOn = snap.playOn;
  state.lastRoll = snap.lastRoll;
  state.busy = false;

  syncTokensToState();
  applyBoardRotation();
  updateCellDensity();
  refreshMoveOptions();
  updateUI();

  if (state.turnState === "GAME_OVER") {
    showWinOverlay(state.players[state.placements[0]], false);
  }
}

/* --------------------------------------------------------- seat rights */
function controlsSeat(playerId) {
  if (!state) return false;
  if (online.mode === "guest") return online.mySeat === playerId;
  if (online.mode === "host") return online.config.seatKinds[playerId] === "local";
  return !state.players[playerId].isCPU;
}

// Everything the player does goes through these two, so a guest's click
// becomes a message instead of a local mutation.
function requestRoll() {
  if (!state || state.busy || online.pausedSeat !== null) return;
  if (!controlsSeat(state.currentPlayerIndex)) return;
  if (online.mode === "guest") return online.guest.sendIntent({ kind: "roll" });
  onRollClick();
}

function requestMove(playerId, pieceId) {
  if (!state || state.busy || online.pausedSeat !== null) return;
  if (playerId !== state.currentPlayerIndex) return;
  if (!controlsSeat(playerId)) return;
  if (online.mode === "guest") {
    return online.guest.sendIntent({
      kind: "move", chipId: state.selectedChipId, pieceId: pieceId
    });
  }
  onTokenClick(playerId, pieceId, true);
}

// Host side: validate a guest's intent against the real game before it runs.
function applyRemoteIntent(seatId, intent) {
  if (!state || state.busy) return false;
  if (state.turnState === "GAME_OVER" || state.turnState === "PAUSED_WIN") return false;
  if (seatId !== state.currentPlayerIndex) return false;
  if (!intent) return false;

  if (intent.kind === "roll") {
    if (state.turnState !== "AWAITING_ROLL") return false;
    onRollClick();
    return true;
  }
  if (intent.kind === "move") {
    if (state.turnState !== "AWAITING_MOVE") return false;
    var has = state.pool.some(function(c) { return c.id === intent.chipId; });
    if (!has) return false;
    state.selectedChipId = intent.chipId;
    refreshMoveOptions();
    var ok = state.legalMoves.some(function(m) { return m.pieceId === intent.pieceId; });
    if (!ok) return false;
    onTokenClick(seatId, intent.pieceId, true);
    return true;
  }
  return false;
}

function hostGameAdapter() {
  return {
    getSeats: function() {
      return online.config.seatKinds.map(function(kind, i) {
        return { id: i, name: PLAYER_DEFS[i].name, kind: kind };
      });
    },
    getSnapshot: function() { return state ? serializeState() : null; },
    applyIntent: applyRemoteIntent
  };
}

/* -------------------------------------------------------------- lobby */
function showScreen(which) {
  ["setup-screen", "lobby-screen", "game-screen"].forEach(function(id) {
    el(id).classList.toggle("hidden", id !== which);
  });
}

/* A running account of what the connection is doing, so a failed join says
   something more useful than nothing at all. */
var diagLines = [];
function netDiag(line) {
  diagLines.push(line);
  if (diagLines.length > 6) diagLines.shift();
  var n = el("lobby-diag");
  if (n) n.textContent = diagLines.join("  \u00b7  ");
}

function setLobbyStatus(text, isError) {
  var node = el("lobby-status");
  node.textContent = text;
  node.classList.toggle("error", !!isError);
}

function readSetup() {
  return {
    N: parseInt(document.querySelector('input[name="board-size"]:checked').value, 10),
    numPlayers: parseInt(document.querySelector('input[name="num-players"]:checked').value, 10),
    numCPU: parseInt(document.querySelector('input[name="num-cpu"]:checked').value, 10),
    cpuSkill: document.querySelector('input[name="cpu-skill"]:checked').value
  };
}

function refreshStartButton() {
  if (online.mode !== "host" || !online.host) return;
  var btn = el("start-online-btn");
  var ready = online.host.allReady();
  var seated = online.host.seatedCount();
  btn.disabled = !ready;
  btn.textContent = ready
    ? (seated ? "Start game" : "Start game (empty seats go to the computer)")
    : "Waiting for players to be ready\u2026";
}

function renderSeatList(seats) {
  var list = el("seat-list");
  list.innerHTML = "";
  (seats || []).forEach(function(seat) {
    var row = document.createElement("div");
    row.className = "seat-row" +
      (online.mode === "guest" && online.mySeat === seat.id ? " mine" : "") +
      (online.mode === "host" && seat.kind === "local" ? " mine" : "");

    var dot = document.createElement("span");
    dot.className = "seat-dot";
    dot.style.background = "var(--" + PLAYER_DEFS[seat.id].colorVar + ")";
    row.appendChild(dot);

    var name = document.createElement("span");
    name.className = "seat-name";
    name.textContent = seat.name;
    row.appendChild(name);

    var who = document.createElement("span");
    who.className = "seat-who";

    var isMine = online.mode === "guest" && online.mySeat === seat.id;

    if (seat.kind === "local") {
      who.textContent = online.mode === "host" ? "You (host)" : "Host";
      row.appendChild(who);
    } else if (seat.takenBy) {
      who.textContent = seat.takenBy + (isMine ? " (you)" : "");
      row.appendChild(who);

      if (isMine) {
        // Your own seat gets the toggle; everyone else's shows its state.
        var ready = document.createElement("button");
        ready.className = "seat-claim-btn" + (seat.ready ? "" : " pending");
        ready.textContent = seat.ready ? t("lobby.readyTick") : t("lobby.imReady");
        ready.addEventListener("click", function() {
          online.myReady = !seat.ready;
          online.guest.setReady(online.myReady);
        });
        row.appendChild(ready);
      } else {
        var tag = document.createElement("span");
        tag.className = "seat-ready" + (seat.ready ? " yes" : "");
        tag.textContent = seat.ready ? "ready" : "not ready";
        row.appendChild(tag);
      }
    } else if (online.mode === "host") {
      who.textContent = t("lobby.waiting");
      row.appendChild(who);
      var sel = document.createElement("select");
      [["open", "Open to a friend"], ["cpu", "Computer"]].forEach(function(opt) {
        var o = document.createElement("option");
        o.value = opt[0];
        o.textContent = opt[1];
        if (online.config.seatKinds[seat.id] === opt[0]) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function() {
        online.config.seatKinds[seat.id] = sel.value;
        online.host.pushSeats();
      });
      row.appendChild(sel);
    } else {
      who.textContent = "Open";
      row.appendChild(who);
      var btn = document.createElement("button");
      btn.className = "seat-claim-btn";
      btn.textContent = "Sit here";
      btn.addEventListener("click", function() {
        online.mySeat = seat.id;
        online.myReady = false;
        online.guest.claim(seat.id);
        setLobbyStatus(t("lobby.seatTaken"));
      });
      row.appendChild(btn);
    }

    list.appendChild(row);
  });

  refreshStartButton();
}

function startHosting() {
  var cfg = readSetup();
  online.mode = "host";
  online.config = {
    N: cfg.N, numPlayers: cfg.numPlayers, cpuSkill: cfg.cpuSkill, seatKinds: []
  };
  for (var i = 0; i < cfg.numPlayers; i++) {
    online.config.seatKinds.push(i === 0 ? "local" : "open");
  }

  showScreen("lobby-screen");
  setLobbyStatus(t("lobby.opening"));

  loadPeerJS().then(function() {
    var code = ChowkaNet.makeRoomCode(5);
    var peer = new Peer(ChowkaNet.ROOM_PREFIX + code, { debug: 0, config: ChowkaNet.ICE });
    online.peer = peer;
    online.roomCode = code;

    peer.on("open", function() {
      online.transport = ChowkaNet.createPeerTransport({ peer: peer, onDiag: netDiag });
      online.host = ChowkaNet.createHost({
        transport: online.transport,
        game: hostGameAdapter(),
        onSeats: function(seats) { renderSeatList(seats); updateNetBadge(); },
        onPeerChange: updateNetBadge,
        onPaused: onSeatDropped,
        onResumed: onSeatReturned
      });
      el("code-display").hidden = false;
      el("room-code").textContent = code;
      el("start-online-btn").hidden = false;
      refreshStartButton();
      startHeartbeat();
      setLobbyStatus("Room open. Share the code, then start when everyone is seated.");
      renderSeatList(online.host.seats());
    });

    peer.on("error", function(err) {
      if (err && err.type === "unavailable-id") {
        try { peer.destroy(); } catch (e) {}
        return startHosting();   // 17 million codes; a clash just means retry
      }
      setLobbyStatus(peerErrorMessage(err), true);
    });
  }).catch(function(e) { setLobbyStatus(e.message, true); });
}

function startJoining(code) {
  online.mode = "guest";
  showScreen("lobby-screen");
  setLobbyStatus("Connecting to " + code + "…");
  el("code-display").hidden = true;
  el("start-online-btn").hidden = true;   // only the host starts the game

  loadPeerJS().then(function() {
    var peer = new Peer(undefined, { debug: 0, config: ChowkaNet.ICE });
    online.peer = peer;

    peer.on("open", function(id) {
      online.myId = id;
      var transport = ChowkaNet.createPeerTransport({ peer: peer, onDiag: netDiag });
      online.transport = transport;
      online.guest = ChowkaNet.createGuest({
        transport: transport,
        name: "Guest",
        selfPeerId: id,
        onSeats: function(seats) {
          // Trust the host's view of who sits where, not our own click.
          var mine = seats.filter(function(x) { return x.peerId === id; })[0];
          online.mySeat = mine ? mine.id : null;
          online.myReady = !!(mine && mine.ready);
          renderSeatList(seats);
          updateNetBadge();
          setLobbyStatus(!mine
            ? "Connected to " + code + ". Pick a seat."
            : mine.ready
              ? "Ready. Waiting for the host to start."
              : "Seat taken. Press \u201cI'm ready\u201d when you are.");
          applyBoardRotation();
        },
        onSnapshot: onGuestSnapshot,
        onRoll: function(result) {
          if (state) { state.lastRoll = result; animateShells(result); }
        },
        onHostLost: function() {
          setLobbyStatus(t("err.hostLost"), true);
          onSeatDropped(null, t("pause.host"));
        },
        onConnectFailed: function() {
          // Never got through at all, which is a different problem from
          // having been connected and lost them.
          setLobbyStatus(t("err.noReach"), true);
        },
        onHostBack: function() {
          onSeatReturned(null);
        },
        onNote: addRemoteLog,
        onReject: function(reason) { setLobbyStatus(reason, true); },
        onPaused: onSeatDropped,
        onResumed: onSeatReturned
      });
      transport.connectTo(ChowkaNet.ROOM_PREFIX + code);
      startHeartbeat();
    });

    peer.on("error", function(err) { setLobbyStatus(peerErrorMessage(err), true); });
  }).catch(function(e) { setLobbyStatus(e.message, true); });
}

function onGuestSnapshot(snap) {
  if (!snap) return;                       // host hasn't started the game yet
  if (!el("game-screen").classList.contains("hidden")) {
    applySnapshot(snap);
    return;
  }
  showScreen("game-screen");
  applySnapshot(snap);
  updateNetBadge();
}

/* ---------------------------------------------------- drops and pauses */
function onSeatDropped(seatId, name) {
  online.pausedSeat = seatId;
  // Reopen the seat so the same player can walk back into it.
  if (online.mode === "host") online.config.seatKinds[seatId] = "open";

  el("pause-name").textContent = (name || PLAYER_DEFS[seatId].name) + " dropped out";
  el("pause-note").textContent = online.mode === "host"
    ? "They can rejoin with the same room code, or the computer can take over."
    : "Waiting for them to rejoin. The host can hand the seat to the computer.";
  el("pause-cpu-btn").hidden = online.mode !== "host";
  el("pause-overlay").classList.remove("hidden");
  updateNetBadge();
  if (state) updateUI();
}

function onSeatReturned(seatId) {
  online.pausedSeat = null;
  if (online.mode === "host" && seatId !== undefined && seatId !== null) {
    online.config.seatKinds[seatId] = "remote";
  }
  el("pause-overlay").classList.add("hidden");
  updateNetBadge();
  if (state) updateUI();
}

// Both sides beat every couple of seconds; the other end drops you after
// roughly seven seconds of silence.
function startHeartbeat() {
  if (online.beat) clearInterval(online.beat);
  online.beat = setInterval(function() {
    if (online.host) online.host.tick(Date.now());
    else if (online.guest) online.guest.tick(Date.now());
  }, 2000);
}

function updateNetBadge() {
  var badge = el("net-badge");
  if (online.mode === "local") { badge.hidden = true; return; }
  badge.hidden = false;
  var connected = online.host ? online.host.peerCount() : (online.guest ? 1 : 0);
  var down = online.pausedSeat !== null;
  badge.classList.toggle("off", down);
  badge.textContent = down ? t("net.reconnecting")
    : online.mode === "host" ? t("net.hosting", { n: connected })
    : t("net.online", { code: online.roomCode || "" });
}
