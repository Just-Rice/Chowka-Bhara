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
        // Carried so a guest joining mid-game draws the same board as everyone
        // else, without waiting for the next seat list.
        colour: p.colorVar, name: SEATS.nameOf(p.id),
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
    drawn: !!state.drawn,
    stalled: state.stalled,
    tieVotes: state.tieVotes.slice(),
    lastRoll: state.lastRoll
  };
}

// Put every token in the container its state says it belongs to. Guests do
// not animate hops — they are shown the result, which cannot desync.
function syncTokensToState() {
  // While the log is being read back, the tokens are showing a past position
  // on purpose. A snapshot arriving from the host, or the computer taking its
  // turn, must not yank the board out from under that.
  if (typeof history !== "undefined" && history && history.viewing !== null) return;
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
  var identities = [];
  snap.players.forEach(function(sp, i) {
    var p = state.players[i];
    p.hasCaptured = sp.hasCaptured;
    p.isCPU = sp.isCPU;
    if (sp.colour) {
      p.colorVar = sp.colour;
      identities[i] = { name: sp.name || "", colour: sp.colour };
    }
    sp.pieces.forEach(function(spc, j) {
      p.pieces[j].status = spc.status;
      p.pieces[j].pathIndex = spc.pathIndex;
    });
  });
  if (identities.length) SEATS.useRemote(identities);
  state.currentPlayerIndex = snap.currentPlayerIndex;
  state.turnState = snap.turnState;
  state.pool = snap.pool.slice();
  state.selectedChipId = snap.selectedChipId;
  state.placements = snap.placements.slice();
  state.playOn = snap.playOn;
  state.drawn = !!snap.drawn;
  state.stalled = !!snap.stalled;

  // A vote that is new to us, and not our own, is worth announcing.
  var votedBefore = state.tieVotes || [];
  var votedNow = (snap.tieVotes || []).slice();
  state.tieVotes = votedNow;
  votedNow.forEach(function(pid) {
    if (votedBefore.indexOf(pid) < 0) notifyTieRequest(pid);
  });
  state.lastRoll = snap.lastRoll;
  state.busy = false;

  syncTokensToState();
  applyBoardRotation();
  updateCellDensity();
  refreshMoveOptions();
  updateUI();

  if (state.turnState === "GAME_OVER") {
    if (state.drawn) showDrawOverlay();
    else showWinOverlay(state.players[state.placements[0]], false);
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
  if (intent.kind === "tie") {
    // The guest is voting, not deciding — the majority decides.
    requestTie(seatId);
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
    getSeats: function(seatWishes) {
      /* The host settles who is what. A guest's choice arrives as a wish and
         the seats it does not own fall back to the host's own settings; then
         SEATS.resolve makes sure no two hold the same colour. What comes out
         is what every screen draws, which is the whole point — a colour names
         a piece on a board both people are looking at. */
      var wishes = online.config.seatKinds.map(function(kind, i) {
        var asked = seatWishes && seatWishes[i];
        if (asked && (asked.name || asked.colour)) return asked;
        return { name: SEATS.list[i].name, colour: SEATS.list[i].colour };
      });
      var settled = SEATS.resolve(wishes);
      return online.config.seatKinds.map(function(kind, i) {
        return { id: i, kind: kind, name: settled[i].name, colour: settled[i].colour };
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

/* Lines that mean something has gone wrong. A connection that simply works
   should not have to explain itself, but one that does not must — so the log
   stays out of sight until one of these appears, and then shows the lot. */
var TROUBLE = {
  "diag.noRelay": true, "diag.relayFailed": true,
  "diag.closed": true, "diag.error": true,
  "diag.signallingDropped": true, "diag.retry": true
};
var diagTrouble = false;

function netDiag(key, params) {
  diagLines.push({ key: key, params: params || null });
  if (diagLines.length > 6) diagLines.shift();
  if (TROUBLE[key]) diagTrouble = true;
  // The path going anywhere other than up is the clearest sign of trouble.
  if (key === "diag.path" && params &&
      /failed|disconnected|closed/.test(String(params.state))) diagTrouble = true;
  renderDiag();
}

function renderDiag() {
  var n = el("lobby-diag");
  if (!n) return;
  var always = typeof A11Y !== "undefined" && A11Y.settings &&
               A11Y.get("netlog") === "always";
  n.hidden = !(always || diagTrouble) || diagLines.length === 0;
  n.textContent = diagLines.map(function(line) {
    return t(line.key, line.params);
  }).join("  \u00b7  ");
}

/* The lobby line is set as a key rather than as finished text, so that
   switching language mid-lobby re-renders whatever it currently says instead
   of leaving one English sentence stranded on an otherwise translated screen. */
function setLobbyStatus(key, params) {
  online.statusKey = key;
  online.statusParams = params || null;
  var node = el("lobby-status");
  node.textContent = t(key, params);
  node.classList.remove("error");
}

/* Errors arrive as finished text — some of it from the browser, in whatever
   language it chose — so they are shown as given and not re-rendered. */
function setLobbyError(text) {
  online.statusKey = null;
  diagTrouble = true;          // an error is exactly when the log earns its place
  renderDiag();
  var node = el("lobby-status");
  node.textContent = text;
  node.classList.add("error");
}

function refreshLobbyText() {
  if (online.statusKey) setLobbyStatus(online.statusKey, online.statusParams);
  renderDiag();
}

function setupChoice(name, fallback) {
  var picked = document.querySelector('input[name="' + name + '"]:checked');
  return picked ? parseInt(picked.value, 10) : fallback;
}

/* How many are at the table: the humans plus the computers filling the rest of
   it. Every screen that needs a seat count asks here, so the two controls can
   never be read as two separate tables. Online, the computers stand in for the
   seats left open — a guest who joins takes one of them. */
function setupSeatCount() {
  return setupChoice("num-players", 1) + setupChoice("num-cpu", 1);
}

function readSetup() {
  return {
    N: parseInt(document.querySelector('input[name="board-size"]:checked').value, 10),
    numHumans: setupChoice("num-players", 1),
    numPlayers: setupSeatCount(),
    numCPU: setupChoice("num-cpu", 1),
    // Each playing tab has its own skill control, so read the one on show.
    cpuSkill: document.querySelector(
      currentMode() === "host" ? 'input[name="host-skill"]:checked'
                               : 'input[name="cpu-skill"]:checked').value
  };
}

/* Seats the host left open that nobody has taken. A seat set to "Computer" on
   purpose is not one of these \u2014 the host already knows about those. */
function openSeatsLeft() {
  if (!online.host) return 0;
  return online.host.seats().filter(function(seat) {
    return seat.kind === "open" && !seat.occupied;
  }).length;
}

function refreshStartButton() {
  if (online.mode !== "host" || !online.host) return;
  var btn = el("start-online-btn");
  var ready = online.host.allReady();
  btn.disabled = !ready;
  btn.textContent = ready ? t("lobby.start") : t("lobby.waitingReady");

  // The caveat lives beside the button, not inside its label, so the button
  // keeps one size and one name whatever the room is doing.
  var hint = el("lobby-hint");
  if (hint) {
    var empty = openSeatsLeft();
    hint.textContent = t("lobby.emptySeats");
    hint.hidden = online.mode !== "host" || empty === 0;
  }
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
    dot.style.background = "var(--" + SEATS.colourOf(seat.id) + ")";
    row.appendChild(dot);

    var name = document.createElement("span");
    name.className = "seat-name";
    name.textContent = playerName(seat.id);
    row.appendChild(name);

    var who = document.createElement("span");
    who.className = "seat-who";

    var isMine = online.mode === "guest" && online.mySeat === seat.id;

    if (seat.kind === "local") {
      who.textContent = online.mode === "host" ? t("lobby.youHost") : t("lobby.hostSeat");
      row.appendChild(who);
    } else if (seat.occupied) {
      who.textContent = (seat.takenBy || t("lobby.guest")) + (isMine ? t("lobby.you") : "");
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
        tag.textContent = seat.ready ? t("lobby.readyTag") : t("lobby.notReady");
        row.appendChild(tag);
      }
    } else if (online.mode === "host") {
      who.textContent = t("lobby.waiting");
      row.appendChild(who);
      var sel = document.createElement("select");
      [["open", "lobby.openToFriend"], ["cpu", "lobby.computer"]].forEach(function(opt) {
        var o = document.createElement("option");
        o.value = opt[0];
        o.textContent = t(opt[1]);
        if (online.config.seatKinds[seat.id] === opt[0]) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function() {
        online.config.seatKinds[seat.id] = sel.value;
        online.host.pushSeats();
      });
      row.appendChild(sel);
    } else {
      who.textContent = t("lobby.open");
      row.appendChild(who);
      var btn = document.createElement("button");
      btn.className = "seat-claim-btn";
      btn.textContent = t("lobby.sitHere");
      btn.addEventListener("click", function() {
        online.mySeat = seat.id;
        online.myReady = false;
        online.guest.claim(seat.id);
        setLobbyStatus("lobby.seatTaken");
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
  setLobbyStatus("lobby.opening");

  // Credentials first, then the connection — but never blocking on them:
  // iceConfig falls back to STUN rather than leaving anyone waiting.
  loadPeerJS().then(function() {
    return ChowkaNet.iceConfig({ onDiag: netDiag });
  }).then(function(ice) {
    var code = ChowkaNet.makeRoomCode(5);
    var peer = new Peer(ChowkaNet.ROOM_PREFIX + code, { debug: 0, config: ice });
    online.peer = peer;
    online.roomCode = code;

    var opened = false;      // has this room ever come up?
    peer.on("open", function() {
      opened = true;
      online.transport = ChowkaNet.createPeerTransport({ peer: peer, onDiag: netDiag });
      online.host = ChowkaNet.createHost({
        transport: online.transport,
        game: hostGameAdapter(),
        onSeats: function(seats) {
          SEATS.useRemote(seats);      // the host draws from its own answer too
          renderSeatList(seats);
          updateNetBadge();
          if (state) SEATS.applyToGame();
        },
        onPeerChange: updateNetBadge,
        onPaused: onSeatDropped,
        onResumed: onSeatReturned
      });
      el("code-display").hidden = false;
      el("room-code").textContent = code;
      el("start-online-btn").hidden = false;
      refreshStartButton();
      startHeartbeat();
      setLobbyStatus("lobby.roomOpen");
      renderSeatList(online.host.seats());
    });

    peer.on("error", function(err) {
      // Before the room exists, a clash just means picking another code.
      // Afterwards the same error means the signalling server still holds our
      // old session while we reconnect, and re-hosting there would mint a
      // fresh code and cut loose everybody already in the room.
      if (err && err.type === "unavailable-id") {
        if (!opened) {
          try { peer.destroy(); } catch (e) {}
          return startHosting();
        }
        netDiag("diag.staleSession");
        return;
      }
      setLobbyError(peerErrorMessage(err));
    });
  }).catch(function(e) { setLobbyError(e.message); });
}

function startJoining(code) {
  online.mode = "guest";
  showScreen("lobby-screen");
  online.roomCode = code;
  online.hostPeerId = ChowkaNet.ROOM_PREFIX + code;
  setLobbyStatus("lobby.connecting", { code: code });
  el("code-display").hidden = true;
  el("start-online-btn").hidden = true;   // only the host starts the game

  loadPeerJS().then(function() {
    return ChowkaNet.iceConfig({ onDiag: netDiag });
  }).then(function(ice) {
    var peer = new Peer(undefined, { debug: 0, config: ice });
    online.peer = peer;

    peer.on("open", function(id) {
      online.myId = id;
      var transport = ChowkaNet.createPeerTransport({ peer: peer, onDiag: netDiag });
      online.transport = transport;
      online.guest = ChowkaNet.createGuest({
        transport: transport,
        name: SEATS.myName(),
        colour: function() { return SEATS.list[0].colour; },
        selfPeerId: id,
        onSeats: function(seats) {
          // The host's answer on names and colours, not this browser's wish.
          SEATS.useRemote(seats);
          // Trust the host's view of who sits where, not our own click.
          var mine = seats.filter(function(x) { return x.peerId === id; })[0];
          online.mySeat = mine ? mine.id : null;
          online.myReady = !!(mine && mine.ready);
          renderSeatList(seats);
          updateNetBadge();
          setLobbyStatus(!mine ? "lobby.connected"
                       : mine.ready ? "lobby.ready" : "lobby.seatTaken",
                         { code: code });
          applyBoardRotation();
        },
        onSnapshot: onGuestSnapshot,
        onRoll: function(result) {
          if (state) { state.lastRoll = result; animateShells(result); }
        },
        onHostLost: function() {
          if (gameIsOver()) return;      // the game is done; so is the host
          // Losing the connection is not the same as the game being over, and
          // sitting there saying so forever helps nobody. Dial back first.
          if (rejoin()) return;
          setLobbyError(t("err.hostLost"));
          onSeatDropped(null, t("pause.host"));
        },
        onHostBack: function() {
          netDiag("diag.reconnected");
          onSeatReturned(null);     // clears the pause, the tries and the badge
        },
        onConnectFailed: function() {
          // Never got through at all, which is a different problem from
          // having been connected and lost them.
          setLobbyError(t("err.noReach"));
        },
        onNote: addRemoteLog,
        onReject: function(reason) { setLobbyError(t(reason)); },
        onPaused: onSeatDropped,
        onResumed: onSeatReturned
      });
      transport.connectTo(ChowkaNet.ROOM_PREFIX + code);
      startHeartbeat();
    });

    peer.on("error", function(err) { setLobbyError(peerErrorMessage(err)); });
  }).catch(function(e) { setLobbyError(e.message); });
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

/* Re-open the connection to the host. The room code is all that is needed —
   the host is still sitting there under the same id — so a lost connection is
   worth a few attempts before anyone is told the game has fallen over. Backed
   off so a host who really has gone is not dialled forever. */
function rejoin() {
  if (online.mode !== "guest" || !online.hostPeerId || !online.transport) return false;
  online.rejoinTries = (online.rejoinTries || 0) + 1;
  if (online.rejoinTries > 4) return false;

  netDiag("diag.rejoining", { n: online.rejoinTries });
  try {
    online.transport.connectTo(online.hostPeerId);
  } catch (e) {
    return false;
  }
  // Say who we are and take our seat back; the host reopened it when we went.
  setTimeout(function() {
    if (!online.guest) return;
    online.guest.hello();
    if (online.mySeat !== null && online.mySeat !== undefined) {
      online.guest.claim(online.mySeat);
    }
  }, 1200);
  return true;
}

/* Coming back to the page. Timers in a hidden tab are throttled to almost
   nothing, so both sides can time each other out while the connection is
   perfectly good — which is why a game left alone came back claiming everyone
   had disconnected. The clocks are forgiven, and if the connection really did
   go, this is the moment to rebuild it. */
function onPageVisible() {
  if (document.hidden) return;
  if (online.host) online.host.nudge(Date.now());
  else if (online.guest) {
    online.guest.nudge(Date.now());
    if (online.pausedSeat !== null || online.rejoinTries) rejoin();
  }
}
document.addEventListener("visibilitychange", onPageVisible);
window.addEventListener("focus", onPageVisible);
window.addEventListener("pageshow", onPageVisible);

/* ---------------------------------------------------- drops and pauses */
/* Whether there is still a game to interrupt. PAUSED_WIN does not count: that
   is the "play on?" prompt, and the game is very much still going. */
function gameIsOver() {
  return !!state && state.turnState === "GAME_OVER";
}

function onSeatDropped(seatId, name) {
  /* Once the game is finished, somebody closing their tab is not news — it is
     the expected end of an evening. Telling you the other player dropped out,
     minutes after you both saw the result, reads as something having gone
     wrong when nothing has. */
  if (gameIsOver()) return;

  online.pausedSeat = seatId;
  // Reopen the seat so the same player can walk back into it.
  if (online.mode === "host") online.config.seatKinds[seatId] = "open";

  el("pause-name").textContent = t("pause.dropped",
    { name: name || playerName(seatId) });
  el("pause-note").textContent =
    t(online.mode === "host" ? "pause.hostNote" : "pause.guestNote");
  el("pause-cpu-btn").hidden = online.mode !== "host";
  el("pause-overlay").classList.remove("hidden");
  updateNetBadge();
  if (state) updateUI();
}

function onSeatReturned(seatId) {
  online.pausedSeat = null;
  online.rejoinTries = 0;
  if (online.mode === "host" && seatId !== undefined && seatId !== null) {
    online.config.seatKinds[seatId] = "remote";
  }
  el("pause-overlay").classList.add("hidden");
  updateNetBadge();
  if (state) updateUI();
}

// Both sides beat every couple of seconds; the other end drops you after
// roughly seven seconds of silence.
function stopHeartbeat() {
  if (online.beat) clearInterval(online.beat);
  online.beat = null;
}

function startHeartbeat() {
  stopHeartbeat();
  online.beat = setInterval(function() {
    // Nothing to keep watch over once the result is in, and every beat is
    // relayed traffic somebody is paying for.
    if (gameIsOver()) return stopHeartbeat();
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
