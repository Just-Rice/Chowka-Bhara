/* Chowkabara online play — the sync layer.
 *
 * Deliberately knows nothing about WebRTC, PeerJS or the DOM. It speaks to a
 * `transport` object and to a `game` adapter, both of which are supplied by the
 * caller. That is what makes the interesting half of online play testable
 * headlessly: the tests hand it an in-memory transport and a fake game.
 *
 *   transport = {
 *     send(peerId, msg),        // to one peer
 *     broadcast(msg),           // to everyone connected
 *     onMessage(fn),            // fn(peerId, msg)
 *     onPeerJoin(fn),           // fn(peerId)
 *     onPeerLeave(fn)           // fn(peerId)
 *   }
 *
 *   game = {                    // host side only
 *     getSnapshot(),            // serialisable game state
 *     getSeats(),               // [{ id, name, kind, owner }]
 *     applyIntent(seatId, intent)   // -> true if it changed the game
 *   }
 *
 * The host owns the one true game. Guests never mutate anything locally: they
 * send intents and render whatever snapshot comes back. Two boards therefore
 * cannot drift apart, at the cost of trusting whoever is hosting.
 */
(function (root) {
  "use strict";

  var PROTOCOL = 1;

  /* Message kinds, host <-> guest. */
  var M = {
    HELLO: "hello",       // guest -> host, on connect
    WELCOME: "welcome",   // host -> guest, protocol + seat list
    CLAIM: "claim",       // guest -> host, "I'll take seat N"
    READY: "ready",       // guest -> host, "I'm ready to start"
    SEATS: "seats",       // host -> all, seat list changed
    INTENT: "intent",     // guest -> host, "roll" / "move"
    SNAPSHOT: "snapshot", // host -> all, authoritative state
    NOTE: "note",         // host -> all, a line for the log
    PAUSED: "paused",     // host -> all, someone dropped
    RESUMED: "resumed",   // host -> all
    ROLL: "roll",         // host -> all, the cowries that were just thrown
    ASK: "ask",           // host -> one guest, "answer this for me"
    REPLY: "reply",       // guest -> host, the answer
    PING: "ping",         // both ways, liveness
    REJECT: "reject"      // host -> guest, intent refused (with a reason)
  };

  /* ------------------------------------------------------------------ host */

  function createHost(opts) {
    var transport = opts.transport;
    var game = opts.game;
    var onSeats = opts.onSeats || function () {};
    var onPeerChange = opts.onPeerChange || function () {};
    var onReject = opts.onReject || function () {};

    var peers = {};        // peerId -> { name, seatId, ready, lastSeen }
    var paused = false;
    var pausedFor = null;

    // A closed tab does not reliably fire a data-channel close event —
    // especially on mobile — so liveness is tracked by heartbeat instead of
    // trusting the transport to tell us.
    var TIMEOUT = opts.timeout || 7000;
    // Injectable so tests can fast-forward instead of sleeping.
    var now = opts.now || function () { return Date.now(); };

    function seatOwner(seatId) {
      var found = null;
      Object.keys(peers).forEach(function (pid) {
        if (peers[pid].seatId === seatId) found = pid;
      });
      return found;
    }

    function seatsPayload() {
      return game.getSeats().map(function (seat) {
        var owner = seatOwner(seat.id);
        return {
          id: seat.id,
          nameKey: seat.nameKey,
          kind: seat.kind,                       // "local" | "open" | "cpu"
          takenBy: owner ? (peers[owner].name || "Guest") : null,
          ready: owner ? !!peers[owner].ready : false,
          peerId: owner
        };
      });
    }

    function pushSeats() {
      var payload = seatsPayload();
      transport.broadcast({ t: M.SEATS, seats: payload });
      onSeats(payload);
    }

    function pushSnapshot() {
      if (paused) return;
      transport.broadcast({ t: M.SNAPSHOT, snap: game.getSnapshot() });
    }

    function note(key, params) {
      transport.broadcast({ t: M.NOTE, key: key, params: params || {} });
    }

    transport.onPeerJoin(function (peerId) {
      peers[peerId] = { name: null, seatId: null, ready: false, lastSeen: now() };
      onPeerChange(Object.keys(peers).length);
    });

    function dropPeer(peerId) {
      var info = peers[peerId];
      if (!info) return;
      delete peers[peerId];
      onPeerChange(Object.keys(peers).length);

      // Losing a spectator is harmless; losing a seated player stops the game.
      if (info.seatId !== null && info.seatId !== undefined) {
        paused = true;
        pausedFor = info.seatId;
        transport.broadcast({
          t: M.PAUSED, seatId: info.seatId, name: info.name || "A player"
        });
        if (opts.onPaused) opts.onPaused(info.seatId, info.name);
      }
      pushSeats();
    }

    transport.onPeerLeave(dropPeer);

    transport.onMessage(function (peerId, msg) {
      if (!msg || !peers[peerId]) return;
      peers[peerId].lastSeen = now();

      if (msg.t === M.PING) return;        // liveness only

      if (msg.t === M.HELLO) {
        peers[peerId].name = String(msg.name || "Guest").slice(0, 20);
        transport.send(peerId, {
          t: M.WELCOME, protocol: PROTOCOL, seats: seatsPayload()
        });
        // A guest arriving mid-game should see the board immediately.
        transport.send(peerId, { t: M.SNAPSHOT, snap: game.getSnapshot() });
        pushSeats();
        return;
      }

      if (msg.t === M.CLAIM) {
        var seatId = msg.seatId;
        var seat = game.getSeats().filter(function (s) { return s.id === seatId; })[0];
        if (!seat || seat.kind !== "open") {
          return transport.send(peerId, { t: M.REJECT, reason: "That seat isn't open." });
        }
        var taken = seatOwner(seatId);
        if (taken && taken !== peerId) {
          return transport.send(peerId, { t: M.REJECT, reason: "Someone just took that seat." });
        }
        peers[peerId].seatId = seatId;
        peers[peerId].ready = false;   // a fresh seat has to be confirmed

        // If this fills the seat we were waiting on, play can carry on.
        if (paused && pausedFor === seatId) {
          paused = false;
          pausedFor = null;
          transport.broadcast({ t: M.RESUMED });
          if (opts.onResumed) opts.onResumed(seatId);
        }
        pushSeats();
        pushSnapshot();
        return;
      }

      if (msg.t === M.REPLY) {
        if (opts.onReply) opts.onReply(msg);
        return;
      }

      if (msg.t === M.READY) {
        peers[peerId].ready = !!msg.ready;
        pushSeats();
        return;
      }

      if (msg.t === M.INTENT) {
        if (paused) {
          return transport.send(peerId, { t: M.REJECT, reason: "The game is paused." });
        }
        var mySeat = peers[peerId].seatId;
        if (mySeat === null || mySeat === undefined) {
          return transport.send(peerId, { t: M.REJECT, reason: "Take a seat first." });
        }
        // applyIntent is where turn ownership is enforced; the host game refuses
        // anything from a seat that is not to move.
        var changed = game.applyIntent(mySeat, msg.intent);
        if (!changed) {
          onReject(mySeat, msg.intent);
          return transport.send(peerId, { t: M.REJECT, reason: "Not your move." });
        }
        return;
      }
    });

    return {
      isHost: true,
      pushSnapshot: pushSnapshot,
      pushSeats: pushSeats,
      note: note,
      seats: seatsPayload,
      peerCount: function () { return Object.keys(peers).length; },
      isPaused: function () { return paused; },
      pausedSeat: function () { return pausedFor; },

      // Every seated guest has confirmed. Seats nobody took do not count —
      // they fall to the computer at kickoff, so they have nothing to confirm.
      allReady: function () {
        return Object.keys(peers).every(function (pid) {
          var info = peers[pid];
          if (info.seatId === null || info.seatId === undefined) return true;
          return !!info.ready;
        });
      },

      seatedCount: function () {
        return Object.keys(peers).filter(function (pid) {
          var s = peers[pid].seatId;
          return s !== null && s !== undefined;
        }).length;
      },

      // Which peer, if any, is sitting in that seat.
      peerForSeat: function (seatId) { return seatOwner(seatId); },

      askPeer: function (peerId, question) {
        transport.send(peerId, { t: M.ASK, id: question.id,
                                 kind: question.kind, payload: question.payload });
      },

      announceRoll: function (result) {
        transport.broadcast({ t: M.ROLL, result: result });
      },

      // Call on an interval. Sends a heartbeat and drops anyone who has gone
      // quiet for longer than the timeout.
      tick: function (at) {
        at = at === undefined ? now() : at;
        transport.broadcast({ t: M.PING });
        Object.keys(peers).forEach(function (pid) {
          if (at - peers[pid].lastSeen > TIMEOUT) dropPeer(pid);
        });
      },

      // Used when the remaining players decide to hand a dropped seat to the CPU.
      resumeWithCPU: function (seatId) {
        if (!paused || pausedFor !== seatId) return false;
        paused = false;
        pausedFor = null;
        transport.broadcast({ t: M.RESUMED });
        pushSeats();
        pushSnapshot();
        return true;
      }
    };
  }

  /* ----------------------------------------------------------------- guest */

  function createGuest(opts) {
    var transport = opts.transport;
    var name = opts.name || "Guest";
    var mySeat = null;
    var TIMEOUT = opts.timeout || 7000;
    // Reaching the host the first time means signalling plus ICE, which
    // routinely takes longer than the liveness timeout. So the "have they gone
    // quiet" check only arms once we have actually heard from them; until then
    // a separate, much longer budget covers "could not connect at all".
    var CONNECT_TIMEOUT = opts.connectTimeout || 25000;
    var now = opts.now || function () { return Date.now(); };
    var startedAt = now();
    var hostLastSeen = now();
    var everHeard = false;
    var hostLost = false;
    var gaveUp = false;

    transport.onPeerJoin(function () {
      transport.broadcast({ t: M.HELLO, name: name });
    });

    transport.onMessage(function (peerId, msg) {
      if (!msg) return;
      hostLastSeen = now();
      everHeard = true;
      if (hostLost) {
        hostLost = false;
        if (opts.onHostBack) opts.onHostBack();
      }
      switch (msg.t) {
        case M.PING:
          break;
        case M.ROLL:
          if (opts.onRoll) opts.onRoll(msg.result);
          break;
        case M.ASK:
          if (opts.onAsk) opts.onAsk(msg);
          break;
        case M.WELCOME:
          if (msg.protocol !== PROTOCOL && opts.onVersionMismatch) {
            opts.onVersionMismatch(msg.protocol, PROTOCOL);
            return;
          }
          if (opts.onSeats) opts.onSeats(msg.seats);
          break;
        case M.SEATS:
          // Track our own seat as the host sees it, not as we asked for it.
          msg.seats.forEach(function (s) {
            if (s.peerId && opts.selfPeerId && s.peerId === opts.selfPeerId) mySeat = s.id;
          });
          if (opts.onSeats) opts.onSeats(msg.seats);
          break;
        case M.SNAPSHOT:
          if (opts.onSnapshot) opts.onSnapshot(msg.snap);
          break;
        case M.NOTE:
          if (opts.onNote) opts.onNote(msg.key, msg.params || {});
          break;
        case M.PAUSED:
          if (opts.onPaused) opts.onPaused(msg.seatId, msg.name);
          break;
        case M.RESUMED:
          if (opts.onResumed) opts.onResumed();
          break;
        case M.REJECT:
          if (opts.onReject) opts.onReject(msg.reason);
          break;
      }
    });

    return {
      isHost: false,
      hello: function () { transport.broadcast({ t: M.HELLO, name: name }); },
      claim: function (seatId) {
        mySeat = seatId;
        transport.broadcast({ t: M.CLAIM, seatId: seatId });
      },
      setReady: function (ready) {
        transport.broadcast({ t: M.READY, ready: !!ready });
      },
      seatOf: function (seats, selfId) {
        var mine = (seats || []).filter(function (s) { return s.peerId === selfId; })[0];
        return mine ? mine.id : null;
      },
      seat: function () { return mySeat; },
      setSeat: function (s) { mySeat = s; },
      sendIntent: function (intent) {
        transport.broadcast({ t: M.INTENT, intent: intent });
      },
      replyToAsk: function (answer) {
        transport.broadcast({ t: M.REPLY, id: answer.id, answer: answer.answer });
      },

      // Mirror of the host's tick: heartbeat out, and notice if the host has
      // gone quiet for too long.
      tick: function (at) {
        at = at === undefined ? now() : at;
        transport.broadcast({ t: M.PING });

        if (!everHeard) {
          // Never connected. This is a failure to arrive, not a disconnection,
          // and it deserves a different message.
          if (!gaveUp && at - startedAt > CONNECT_TIMEOUT) {
            gaveUp = true;
            if (opts.onConnectFailed) opts.onConnectFailed();
          }
          return;
        }

        if (!hostLost && at - hostLastSeen > TIMEOUT) {
          hostLost = true;
          if (opts.onHostLost) opts.onHostLost();
        }
      },

      /* Exposed so the interface can tell "still connecting" from "was
         connected and lost them". */
      hasConnected: function () { return everHeard; }
    };
  }

  /* ------------------------------------------------- in-memory transport --
   * Used by the tests, and handy for driving two "clients" in one page while
   * developing. Delivery is asynchronous, because the real thing is too, and
   * bugs that only appear with out-of-order delivery should be reproducible.
   */
  function createFakeNetwork(options) {
    options = options || {};
    var schedule = options.schedule || function (fn) { fn(); };
    var endpoints = {};

    function endpoint(id) {
      var handlers = { message: [], join: [], leave: [] };
      var linked = {};

      var ep = {
        id: id,
        _handlers: handlers,
        _linked: linked,
        send: function (peerId, msg) {
          var target = endpoints[peerId];
          if (!target || !linked[peerId]) return;
          var copy = JSON.parse(JSON.stringify(msg));
          schedule(function () {
            target._handlers.message.forEach(function (fn) { fn(id, copy); });
          });
        },
        broadcast: function (msg) {
          Object.keys(linked).forEach(function (peerId) { ep.send(peerId, msg); });
        },
        onMessage: function (fn) { handlers.message.push(fn); },
        onPeerJoin: function (fn) { handlers.join.push(fn); },
        onPeerLeave: function (fn) { handlers.leave.push(fn); }
      };
      endpoints[id] = ep;
      return ep;
    }

    return {
      endpoint: endpoint,
      connect: function (a, b) {
        endpoints[a]._linked[b] = true;
        endpoints[b]._linked[a] = true;
        schedule(function () {
          endpoints[a]._handlers.join.forEach(function (fn) { fn(b); });
          endpoints[b]._handlers.join.forEach(function (fn) { fn(a); });
        });
      },
      disconnect: function (a, b) {
        delete endpoints[a]._linked[b];
        delete endpoints[b]._linked[a];
        schedule(function () {
          endpoints[a]._handlers.leave.forEach(function (fn) { fn(b); });
          endpoints[b]._handlers.leave.forEach(function (fn) { fn(a); });
        });
      }
    };
  }

  /* --------------------------------------------------- PeerJS transport --
   * The only part that touches the network, and the only part the headless
   * tests cannot reach. Kept as thin as possible for exactly that reason.
   */
  function createPeerTransport(opts) {
    var peer = opts.peer;                 // a live PeerJS Peer
    var conns = {};                       // peerId -> DataConnection
    var handlers = { message: [], join: [], leave: [] };

    function wire(conn) {
      conns[conn.peer] = conn;
      conn.on("data", function (data) {
        handlers.message.forEach(function (fn) { fn(conn.peer, data); });
      });
      conn.on("open", function () {
        handlers.join.forEach(function (fn) { fn(conn.peer); });
      });
      var gone = false;
      function leave() {
        if (gone) return;
        gone = true;
        delete conns[conn.peer];
        handlers.leave.forEach(function (fn) { fn(conn.peer); });
      }
      conn.on("close", leave);
      conn.on("error", leave);
    }

    peer.on("connection", wire);

    return {
      _wire: wire,
      connectTo: function (id) {
        var conn = peer.connect(id, { reliable: true });
        wire(conn);
        return conn;
      },
      send: function (peerId, msg) {
        var c = conns[peerId];
        if (c && c.open) c.send(msg);
      },
      broadcast: function (msg) {
        Object.keys(conns).forEach(function (id) {
          if (conns[id].open) conns[id].send(msg);
        });
      },
      onMessage: function (fn) { handlers.message.push(fn); },
      onPeerJoin: function (fn) { handlers.join.push(fn); },
      onPeerLeave: function (fn) { handlers.leave.push(fn); },
      close: function () {
        Object.keys(conns).forEach(function (id) {
          try { conns[id].close(); } catch (e) {}
        });
        conns = {};
      }
    };
  }

  /* Room codes people can read aloud: no vowels (so no accidental words) and
   * no characters that look like each other. */
  var CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789";

  function makeRoomCode(len) {
    var out = "";
    for (var i = 0; i < (len || 5); i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  function normaliseRoomCode(input) {
    return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
      .replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1");
  }

  root.ChowkaNet = {
    PROTOCOL: PROTOCOL,
    M: M,
    createHost: createHost,
    createGuest: createGuest,
    createFakeNetwork: createFakeNetwork,
    createPeerTransport: createPeerTransport,
    makeRoomCode: makeRoomCode,
    normaliseRoomCode: normaliseRoomCode,
    ROOM_PREFIX: "chowka-"
  };
})(typeof window !== "undefined" ? window : this);
