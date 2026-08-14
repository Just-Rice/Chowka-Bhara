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
      /* What each guest asked for, in seat order, handed to the game so it can
         settle them. A colour identifies a piece on a shared board, so it
         cannot be left to each browser to decide — two players both choosing
         blue would see the same seat in different colours on each screen. */
      var wishes = game.getSeats().map(function (seat) {
        var owner = seatOwner(seat.id);
        return owner ? { name: peers[owner].name, colour: peers[owner].colour } : null;
      });

      return game.getSeats(wishes).map(function (seat) {
        var owner = seatOwner(seat.id);
        return {
          id: seat.id,
          kind: seat.kind,                       // "local" | "open" | "cpu"
          // Occupancy and the name are separate: a guest who sent no name
          // still occupies the seat, and the fallback label is a translation
          // each client renders in its own language rather than a word
          // crossing the network.
          occupied: !!owner,
          takenBy: owner ? (peers[owner].name || null) : null,
          name: seat.name || null,
          colour: seat.colour,
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
        // No name means no name — the label is a translation each client
        // renders for itself, so no English default crosses the wire.
        peers[peerId].name = msg.name ? String(msg.name).slice(0, 20) : null;
        // A colour is a request, not a decision. The game resolves it below.
        peers[peerId].colour = msg.colour ? String(msg.colour).slice(0, 20) : null;
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
    var name = opts.name || null;
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
      transport.broadcast({ t: M.HELLO, name: name, colour: opts.colour && opts.colour() });
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
      hello: function () {
        transport.broadcast({ t: M.HELLO, name: name, colour: opts.colour && opts.colour() });
      },
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
  /* Diagnostics leave here as a key and whatever values go with it, never as a
     sentence. This file has no idea what language anyone is reading in — and
     the lobby has to be able to re-render the whole list when that changes. */
  function createPeerTransport(opts) {
    var peer = opts.peer;                 // a live PeerJS Peer
    var conns = {};                       // peerId -> DataConnection
    var handlers = { message: [], join: [], leave: [] };
    // Connecting is the part that fails silently in the wild, so it reports
    // what it is doing rather than leaving a blank screen.
    var diag = opts.onDiag || function () {};

    /* Which kinds of route the browser managed to find. This is the question a
       failed connection actually turns on: "host" and "srflx" mean the two are
       trying to reach each other directly, and if that is all there is, a
       network that refuses direct contact has nothing left to fall back to.
       "relay" means a TURN server answered and the connection will hold up
       almost anywhere. Saying so beats watching "checking" turn into
       "disconnected" with no explanation. */
    function watchRoutes(conn, tries) {
      var pc = conn.peerConnection;
      if (!pc) {
        if (tries > 0) setTimeout(function () { watchRoutes(conn, tries - 1); }, 250);
        return;
      }
      var kinds = {};
      pc.addEventListener("icecandidate", function (e) {
        if (e.candidate && e.candidate.candidate) {
          var m = /\btyp (\w+)/.exec(e.candidate.candidate);
          if (m) kinds[m[1]] = true;
          return;
        }
        // A null candidate means gathering has finished.
        var found = Object.keys(kinds);
        diag("diag.routes", { kinds: found.join(", ") || "none" });
        if (found.indexOf("relay") < 0) diag("diag.noRelay");
      });
    }

    function wire(conn) {
      conns[conn.peer] = conn;
      diag("diag.negotiating", { peer: conn.peer.slice(-6) });
      watchRoutes(conn, 12);

      conn.on("data", function (data) {
        handlers.message.forEach(function (fn) { fn(conn.peer, data); });
      });
      conn.on("open", function () {
        diag("diag.connected");
        handlers.join.forEach(function (fn) { fn(conn.peer); });
      });
      conn.on("iceStateChanged", function (st) {
        diag("diag.path", { state: st });
        // "failed" means no route exists between the two networks; without a
        // relay there is nothing further to try.
        if (st === "failed" && opts.onIceFailed) opts.onIceFailed();
      });

      var gone = false;
      function leave() {
        if (gone) return;
        gone = true;
        delete conns[conn.peer];
        handlers.leave.forEach(function (fn) { fn(conn.peer); });
      }
      conn.on("close", function () { diag("diag.closed"); leave(); });
      conn.on("error", function (e) {
        diag("diag.error", { type: (e && e.type) || e });
        leave();
      });
    }

    peer.on("connection", function (conn) {
      diag("diag.incoming");
      wire(conn);
    });

    // The signalling server drops idle peers; without this a host that has had
    // the page open a while stops being findable.
    peer.on("disconnected", function () {
      diag("diag.signallingDropped");
      try { peer.reconnect(); } catch (e) {}
    });

    return {
      _wire: wire,
      connectTo: function (id) {
        var conn = peer.connect(id, { reliable: true });
        wire(conn);

        // PeerJS occasionally produces a connection that never opens. One
        // retry costs little and fixes the common case.
        setTimeout(function () {
          if (conn.open) return;
          diag("diag.retry");
          try { conn.close(); } catch (e) {}
          var again = peer.connect(id, { reliable: true });
          wire(again);
        }, 9000);

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

  /* How the two browsers try to find each other.
   *
   * STUN only tells each side what its own public address looks like; the two
   * then try to punch a hole to each other directly. That works on most home
   * networks and fails on a good many others — mobile carriers, and any network
   * with client isolation, where two devices on the same Wi-Fi are deliberately
   * kept from talking.
   *
   * A TURN relay is the fallback for those, and there is none here. The three
   * that used to be listed are gone: eu-0.turn.peerjs.com and
   * us-0.turn.peerjs.com no longer resolve in DNS at all, and
   * openrelay.metered.ca answers on no port. A dead relay is worse than no
   * relay — the browser waits on it during gathering and produces nothing — so
   * they are removed rather than left in as decoration.
   *
   * Add one below and cross-network play becomes reliable. Every provider hands
   * out the same three fields.
   */
  /* Where the relay comes from.
   *
   * Metered hands out short-lived credentials from an endpoint rather than a
   * fixed username and password, which is why this is fetched rather than
   * written down. Fill in the two fields from the Metered dashboard and
   * cross-network play starts working; leave them blank and the game runs on
   * STUN alone, exactly as it does now.
   *
   * Either of two things works, whichever the dashboard actually shows:
   *
   *   key      an API key. The credentials are fetched with it at connect time,
   *            which is the better of the two — Metered issues short-lived ones
   *            and a fetched credential is always current.
   *   servers  a ready-made list of { urls, username, credential } objects. Use
   *            this when the dashboard hands you the ICE servers directly
   *            rather than a key.
   *
   * Verified against the live endpoint: with no key it answers 400 "Please
   * specify API Key", and with a wrong one 401 "Invalid API Key", so the path
   * and the parameter name below are right and the key is all that is missing.
   *
   * Both end up in a public file. That is how any browser-side relay works —
   * the credentials have to reach the browser — and it is why the key is worth
   * rotating if the free quota ever starts disappearing.
   */
  var RELAY = {
    app: "chowka-bhara",
    key: "903710510cc10e1b455217a78eaeade1ad1f",
                      // A credential-scoped key. Metered documents this one as safe
                      // for front-end use — it can only fetch an ICE config. The
                      // account secretKey, which can create and delete credentials,
                      // is not here and must never be.
    servers: []       // or a ready-made list, pasted straight from the dashboard
  };

  var STUN = [
    { urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun.cloudflare.com:3478",
      "stun:global.stun.twilio.com:3478"
    ] }
  ];

  /* STUN only tells each browser its own public address, so the two can try to
     reach each other directly. That works on most home networks and fails on
     mobile carriers and on any network with client isolation. A relay is the
     fallback for those. */
  var ICE = { iceServers: STUN };

  var icePromise = null;

  /* Resolved once per session, and never allowed to hold up a connection: if
     the credentials endpoint is slow, blocked or down, the game goes ahead on
     STUN alone rather than sitting on a spinner. A relay that cannot be
     fetched is the situation we are already in, not a new failure. */
  function iceConfig(opts) {
    opts = opts || {};
    var fetcher = opts.fetch || (typeof fetch === "function" ? fetch : null);
    var timeout = opts.timeout || 4000;
    // Injectable so the timeout itself can be tested, and so a shell without a
    // real clock does not fire it the instant it is set.
    var later = opts.setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
    var cancel = opts.clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : function () {});
    var relay = opts.relay || RELAY;
    var diag = opts.onDiag || function () {};

    if (icePromise && !opts.fresh) return icePromise;

    // A list given outright needs no request at all.
    if (relay.servers && relay.servers.length) {
      diag("diag.relayReady", { n: relay.servers.length });
      icePromise = Promise.resolve({ iceServers: STUN.concat(relay.servers) });
      return icePromise;
    }

    if (!relay.app || !relay.key || !fetcher) {
      diag("diag.noRelay");
      icePromise = Promise.resolve({ iceServers: STUN });
      return icePromise;
    }

    var url = "https://" + relay.app + ".metered.live/api/v1/turn/credentials?apiKey=" +
              encodeURIComponent(relay.key);

    icePromise = new Promise(function (resolve) {
      var settled = false;
      function fallback() {
        if (settled) return;
        settled = true;
        diag("diag.relayFailed");
        resolve({ iceServers: STUN });
      }
      var timer = later ? later(fallback, timeout) : null;

      fetcher(url).then(function (res) {
        return res && res.ok ? res.json() : null;
      }).then(function (servers) {
        if (settled) return;
        if (!servers || !servers.length) return fallback();
        cancel(timer);
        settled = true;
        diag("diag.relayReady", { n: servers.length });
        resolve({ iceServers: STUN.concat(servers) });
      }).catch(fallback);
    });
    return icePromise;
  }

  root.ChowkaNet = {
    ICE: ICE,
    iceConfig: iceConfig,
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
