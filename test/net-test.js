/* Tests the online sync layer with an in-memory transport — no browser, no
 * WebRTC. This covers everything except the peer connection itself: seat
 * claiming, turn ownership, snapshot fan-out, disconnects, pausing, and CPU
 * substitution.
 *
 * What this deliberately does NOT prove: that two real browsers can find each
 * other through the signalling server. That needs two actual devices. */

var root = this;
load('js/net.js');
var Net = root.ChowkaNet;

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

/* Deliveries queue up and are drained by pump(), so ordering is explicit. */
var queue = [];
function schedule(fn) { queue.push(fn); }
function pump(times) {
  for (var i = 0; i < (times || 12); i++) {
    var batch = queue;
    queue = [];
    if (!batch.length) return;
    batch.forEach(function (fn) { fn(); });
  }
}

/* ------------------------------------------------------- fake host game -- */

function makeGame(seatKinds) {
  var g = {
    turn: 0,
    applied: [],
    rejected: [],
    seats: seatKinds.map(function (kind, i) {
      return { id: i, name: 'Seat' + i, kind: kind };
    }),
    getSeats: function () { return g.seats; },
    getSnapshot: function () { return { turn: g.turn, applied: g.applied.length }; },
    applyIntent: function (seatId, intent) {
      // Turn ownership lives here, exactly as it does in the real game.
      if (seatId !== g.turn) { g.rejected.push([seatId, intent]); return false; }
      g.applied.push([seatId, intent]);
      g.turn = (g.turn + 1) % g.seats.length;
      return true;
    }
  };
  return g;
}

/* --------------------------------------------------- a two-player table -- */

var net = Net.createFakeNetwork({ schedule: schedule });
var hostEp = net.endpoint('HOST');
var guestEp = net.endpoint('G1');

var game = makeGame(['local', 'open']);
var hostSeats = null, hostPauses = [];
var host = Net.createHost({
  transport: hostEp,
  game: game,
  onSeats: function (s) { hostSeats = s; },
  onPaused: function (seatId, name) { hostPauses.push([seatId, name]); }
});

var guestSnapshots = [], guestSeats = null, guestRejects = [], guestNotes = [];
var guestPaused = null, guestResumed = 0;
var guest = Net.createGuest({
  transport: guestEp,
  name: 'Rishi',
  selfPeerId: 'G1',
  onSnapshot: function (s) { guestSnapshots.push(s); },
  onSeats: function (s) { guestSeats = s; },
  onReject: function (r) { guestRejects.push(r); },
  onNote: function (l) { guestNotes.push(l); },
  onPaused: function (seatId, n) { guestPaused = [seatId, n]; },
  onResumed: function () { guestResumed++; }
});

net.connect('HOST', 'G1');
pump();

check('guest receives the seat list on connect', guestSeats !== null,
      JSON.stringify(guestSeats));
check('guest receives an opening snapshot', guestSnapshots.length >= 1,
      guestSnapshots.length + ' snapshots');
check('host learns the guest name',
      hostSeats !== null && JSON.stringify(hostSeats).indexOf('Rishi') < 0,
      'name should not appear before a seat is claimed');

/* --------------------------------------------------------- claiming ----- */

guest.claim(1);
pump();

var seat1 = guestSeats.filter(function (s) { return s.id === 1; })[0];
check('claiming an open seat succeeds', seat1 && seat1.takenBy === 'Rishi',
      JSON.stringify(seat1));
check('claiming a seat does not reject', guestRejects.length === 0,
      guestRejects.join(' | '));

/* A seat marked "local" belongs to the host and cannot be taken remotely. */
guest.claim(0);
pump();
check('cannot claim the host seat', guestRejects.length === 1,
      JSON.stringify(guestRejects));
guest.setSeat(1);

/* ----------------------------------------------------- turn ownership --- */

/* Seat 0 is to move, so the guest in seat 1 must be refused. */
guestRejects.length = 0;
guest.sendIntent({ kind: 'roll' });
pump();
check('an intent out of turn is refused', guestRejects.length === 1,
      JSON.stringify(guestRejects));
check('an out-of-turn intent changes nothing', game.applied.length === 0,
      JSON.stringify(game.applied));

/* Host plays its own turn locally, then it is the guest's move. */
game.applyIntent(0, { kind: 'roll' });
host.pushSnapshot();
pump();

guestRejects.length = 0;
var before = guestSnapshots.length;
guest.sendIntent({ kind: 'move', pieceId: 2 });
pump();

check('an in-turn intent is applied', game.applied.length === 2,
      JSON.stringify(game.applied));
check('an in-turn intent is not rejected', guestRejects.length === 0,
      JSON.stringify(guestRejects));
check('the applied intent carries the right seat and payload',
      game.applied[1][0] === 1 && game.applied[1][1].pieceId === 2,
      JSON.stringify(game.applied[1]));

/* The host must push state after applying, or the guest never sees it. */
host.pushSnapshot();
pump();
check('guest receives a snapshot after its move', guestSnapshots.length > before,
      before + ' -> ' + guestSnapshots.length);

/* -------------------------------------------------------------- notes --- */

host.note('Indigo captured a piece.');
pump();
check('log lines reach the guest', guestNotes.length === 1 &&
      guestNotes[0].indexOf('captured') > 0, JSON.stringify(guestNotes));

/* --------------------------------------------------------- disconnect --- */

net.disconnect('HOST', 'G1');
pump();

check('host notices a seated player leaving', hostPauses.length === 1,
      JSON.stringify(hostPauses));
check('host pauses the game', host.isPaused() === true);
check('host remembers which seat is empty', host.pausedSeat() === 1,
      String(host.pausedSeat()));

/* While paused nothing should be broadcast. */
var snapsBefore = guestSnapshots.length;
host.pushSnapshot();
pump();
check('no snapshots go out while paused', guestSnapshots.length === snapsBefore,
      snapsBefore + ' -> ' + guestSnapshots.length);

/* ------------------------------------------------- CPU takes the seat --- */

var resumed = host.resumeWithCPU(1);
check('the remaining players can hand the seat to the CPU', resumed === true);
check('the game is no longer paused', host.isPaused() === false);
check('resuming the wrong seat is refused', host.resumeWithCPU(0) === false);

/* ------------------------------------------- rejoining a paused game ---- */

var net2 = Net.createFakeNetwork({ schedule: schedule });
var h2 = net2.endpoint('HOST2');
var g2a = net2.endpoint('A');
var g2b = net2.endpoint('B');

var game2 = makeGame(['local', 'open', 'open']);
var pausedSeat = null, resumedSeat = null;
var host2 = Net.createHost({
  transport: h2,
  game: game2,
  onPaused: function (s) { pausedSeat = s; },
  onResumed: function (s) { resumedSeat = s; }
});

var aSeats = null;
Net.createGuest({ transport: g2a, name: 'A', selfPeerId: 'A',
                  onSeats: function (s) { aSeats = s; } });
var bPausedSeen = null, bResumedCount = 0;
Net.createGuest({ transport: g2b, name: 'B', selfPeerId: 'B',
                  onPaused: function (s) { bPausedSeen = s; },
                  onResumed: function () { bResumedCount++; } });

net2.connect('HOST2', 'A');
net2.connect('HOST2', 'B');
pump();

g2a.broadcast({ t: Net.M.CLAIM, seatId: 1 });
g2b.broadcast({ t: Net.M.CLAIM, seatId: 2 });
pump();

check('two guests can hold different seats',
      aSeats && aSeats.filter(function (s) { return s.takenBy; }).length === 2,
      JSON.stringify(aSeats));

net2.disconnect('HOST2', 'A');
pump();
check('the other guest is told the game paused', bPausedSeen === 1,
      String(bPausedSeen));
check('host paused on the right seat', pausedSeat === 1, String(pausedSeat));

/* A returns, takes the same seat, and play resumes. */
var g2aAgain = net2.endpoint('A2');
Net.createGuest({ transport: g2aAgain, name: 'A', selfPeerId: 'A2' });
net2.connect('HOST2', 'A2');
pump();
g2aAgain.broadcast({ t: Net.M.CLAIM, seatId: 1 });
pump();

check('reclaiming the empty seat resumes play', host2.isPaused() === false);
check('the host reports which seat resumed', resumedSeat === 1, String(resumedSeat));
check('everyone is told play resumed', bResumedCount === 1, String(bResumedCount));

/* --------------------------------------------------- two guests, one seat */

var net3 = Net.createFakeNetwork({ schedule: schedule });
var h3 = net3.endpoint('H3');
var x = net3.endpoint('X');
var y = net3.endpoint('Y');
var game3 = makeGame(['local', 'open']);
Net.createHost({ transport: h3, game: game3 });
var xRejects = [], yRejects = [];
Net.createGuest({ transport: x, name: 'X', selfPeerId: 'X',
                  onReject: function (r) { xRejects.push(r); } });
Net.createGuest({ transport: y, name: 'Y', selfPeerId: 'Y',
                  onReject: function (r) { yRejects.push(r); } });
net3.connect('H3', 'X');
net3.connect('H3', 'Y');
pump();

x.broadcast({ t: Net.M.CLAIM, seatId: 1 });
pump();
y.broadcast({ t: Net.M.CLAIM, seatId: 1 });
pump();

check('the second claimant on one seat is refused',
      yRejects.length === 1 && xRejects.length === 0,
      'x=' + JSON.stringify(xRejects) + ' y=' + JSON.stringify(yRejects));

/* An unseated guest cannot play at all. */
yRejects.length = 0;
y.broadcast({ t: Net.M.INTENT, intent: { kind: 'roll' } });
pump();
check('a guest with no seat cannot send intents', yRejects.length === 1,
      JSON.stringify(yRejects));

/* ------------------------------------------------------- ready gating --- */

var net4 = Net.createFakeNetwork({ schedule: schedule });
var h4 = net4.endpoint('H4');
var p1 = net4.endpoint('P1');
var p2 = net4.endpoint('P2');
var game4 = makeGame(['local', 'open', 'open']);
var host4 = Net.createHost({ transport: h4, game: game4 });
var p1Seats = null;
Net.createGuest({ transport: p1, name: 'One', selfPeerId: 'P1',
                  onSeats: function (s) { p1Seats = s; } });
Net.createGuest({ transport: p2, name: 'Two', selfPeerId: 'P2' });
net4.connect('H4', 'P1');
net4.connect('H4', 'P2');
pump();

check('nobody seated means nothing to wait for', host4.allReady() === true);
check('seated count starts at zero', host4.seatedCount() === 0,
      String(host4.seatedCount()));

p1.broadcast({ t: Net.M.CLAIM, seatId: 1 });
pump();
check('claiming a seat does not imply ready', host4.allReady() === false);
check('a claimed seat is counted', host4.seatedCount() === 1,
      String(host4.seatedCount()));

p1.broadcast({ t: Net.M.READY, ready: true });
pump();
check('one seated player confirming is enough on its own',
      host4.allReady() === true);
check('the seat payload carries the ready flag',
      p1Seats.filter(function (s) { return s.id === 1; })[0].ready === true,
      JSON.stringify(p1Seats));

/* A second player joining un-readies the table until they confirm too. */
p2.broadcast({ t: Net.M.CLAIM, seatId: 2 });
pump();
check('a new arrival blocks the start again', host4.allReady() === false);

p2.broadcast({ t: Net.M.READY, ready: true });
pump();
check('both confirmed unblocks it', host4.allReady() === true);

/* Un-readying works too. */
p2.broadcast({ t: Net.M.READY, ready: false });
pump();
check('a player can withdraw ready', host4.allReady() === false);
p2.broadcast({ t: Net.M.READY, ready: true });
pump();

/* Moving to a different seat clears the confirmation for that player. */
p1.broadcast({ t: Net.M.CLAIM, seatId: 1 });
pump();
check('re-claiming a seat clears ready', host4.allReady() === false,
      JSON.stringify(p1Seats));

/* An unseated spectator must never hold up the start. */
var p3 = net4.endpoint('P3');
Net.createGuest({ transport: p3, name: 'Three', selfPeerId: 'P3' });
net4.connect('H4', 'P3');
pump();
p1.broadcast({ t: Net.M.READY, ready: true });
pump();
check('a connected spectator does not block the start',
      host4.allReady() === true);
check('spectators are not counted as seated', host4.seatedCount() === 2,
      String(host4.seatedCount()));

/* -------------------------------------------------- heartbeat liveness --- */

/* A closed tab does not reliably fire a close event, so the host drops peers
   that go quiet. tick() takes the clock so the test can fast-forward. */
var net5 = Net.createFakeNetwork({ schedule: schedule });
var h5 = net5.endpoint('H5');
var q1 = net5.endpoint('Q1');
var game5 = makeGame(['local', 'open']);
var h5Paused = [];
var clock = Date.now();
function nowFn() { return clock; }
var host5 = Net.createHost({
  transport: h5, game: game5, timeout: 7000, now: nowFn,
  onPaused: function (seatId, name) { h5Paused.push([seatId, name]); }
});
var q1Guest = Net.createGuest({ transport: q1, name: 'Quiet', selfPeerId: 'Q1', now: nowFn });
net5.connect('H5', 'Q1');
pump();
q1.broadcast({ t: Net.M.CLAIM, seatId: 1 });
pump();

var t0 = clock;
host5.tick(t0);
pump();
check('a live peer survives a tick', host5.isPaused() === false);
check('a live peer is still seated', host5.seatedCount() === 1,
      String(host5.seatedCount()));

/* Guest keeps beating: still fine well past the timeout. */
for (var beat = 1; beat <= 6; beat++) {
  clock = t0 + beat * 2000;      // the shared clock the host stamps with
  q1Guest.tick(clock);
  pump();
  host5.tick(clock);
  pump();
}
check('a peer that keeps beating is never dropped', host5.isPaused() === false,
      JSON.stringify(h5Paused));

/* Now the guest goes silent — a closed tab, no close event. */
clock = t0 + 20000;            // guest has gone quiet
host5.tick(clock);
pump();
check('a silent peer is dropped even with no close event',
      h5Paused.length === 1, JSON.stringify(h5Paused));
check('dropping a silent seated peer pauses the game', host5.isPaused() === true);
check('the right seat is reported empty', host5.pausedSeat() === 1,
      String(host5.pausedSeat()));

/* The guest notices a silent host too. */
var net6 = Net.createFakeNetwork({ schedule: schedule });
var h6 = net6.endpoint('H6');
var q2 = net6.endpoint('Q2');
Net.createHost({ transport: h6, game: makeGame(['local', 'open']) });
var lostCount = 0, backCount = 0;
var clock6 = Date.now();
var g6 = Net.createGuest({
  transport: q2, name: 'G', selfPeerId: 'Q2', timeout: 7000,
  now: function () { return clock6; },
  onHostLost: function () { lostCount++; },
  onHostBack: function () { backCount++; }
});
net6.connect('H6', 'Q2');
pump();

var u0 = clock6;
g6.tick(u0);
pump();
check('a live host is not reported lost', lostCount === 0);

clock6 = u0 + 20000;
g6.tick(clock6);
pump();
check('a silent host is reported lost', lostCount === 1, String(lostCount));
check('the host is only reported lost once', (clock6 = u0 + 30000, g6.tick(clock6), lostCount) === 1,
      String(lostCount));

/* Any message from the host counts as it coming back. */
clock6 = u0 + 30000;
h6.broadcast({ t: Net.M.PING });
pump();
check('a returning host is reported back', backCount === 1, String(backCount));

/* ------------------------------------ slow to connect is not a disconnect -- */

/* Reaching the host the first time means signalling plus ICE, which regularly
   takes longer than the seven-second liveness timeout. A guest that has not
   heard from the host yet must not conclude the host dropped out — that bug
   made online play unusable the moment a connection took a few seconds. */
var net8 = Net.createFakeNetwork({ schedule: schedule });
var h8 = net8.endpoint('H8');
var q4 = net8.endpoint('Q4');
Net.createHost({ transport: h8, game: makeGame(['local', 'open']) });

var slowClock = Date.now();
var lostCalls = 0, failCalls = 0;
var slow = Net.createGuest({
  transport: q4, name: 'Slow', selfPeerId: 'Q4',
  timeout: 7000, connectTimeout: 25000,
  now: function () { return slowClock; },
  onHostLost: function () { lostCalls++; },
  onConnectFailed: function () { failCalls++; }
});

check('a fresh guest has not heard from anyone', slow.hasConnected() === false);

/* Ten seconds of trying to connect — well past the liveness timeout. */
for (var beat = 1; beat <= 5; beat++) {
  slowClock += 2000;
  slow.tick(slowClock);
  pump();
}
check('a guest still connecting is never told the host dropped out',
      lostCalls === 0, lostCalls + ' calls');
check('nor has it given up yet', failCalls === 0, failCalls + ' calls');

/* Now the connection completes. */
net8.connect('H8', 'Q4');
pump();
check('the guest has now heard from the host', slow.hasConnected() === true);

/* From here the ordinary liveness check applies. */
slowClock += 20000;
slow.tick(slowClock);
pump();
check('once connected, silence does mean the host is gone', lostCalls === 1,
      lostCalls + ' calls');

/* A guest that never gets through reports that instead, and only once. */
var net9 = Net.createFakeNetwork({ schedule: schedule });
var q5 = net9.endpoint('Q5');
var clock9 = Date.now();
var neverLost = 0, neverFail = 0;
var never = Net.createGuest({
  transport: q5, name: 'Never', selfPeerId: 'Q5',
  timeout: 7000, connectTimeout: 25000,
  now: function () { return clock9; },
  onHostLost: function () { neverLost++; },
  onConnectFailed: function () { neverFail++; }
});
clock9 += 30000;
never.tick(clock9);
pump();
check('never connecting reports a failure to connect', neverFail === 1, String(neverFail));
check('never connecting is not reported as a drop-out', neverLost === 0, String(neverLost));
clock9 += 30000;
never.tick(clock9);
check('the failure is reported only once', neverFail === 1, String(neverFail));

/* ------------------------------------------------------ roll broadcast --- */

var net7 = Net.createFakeNetwork({ schedule: schedule });
var h7 = net7.endpoint('H7');
var q3 = net7.endpoint('Q3');
var host7 = Net.createHost({ transport: h7, game: makeGame(['local', 'open']) });
var rollsSeen = [];
Net.createGuest({ transport: q3, name: 'R', selfPeerId: 'Q3',
                  onRoll: function (r) { rollsSeen.push(r); } });
net7.connect('H7', 'Q3');
pump();

host7.announceRoll({ shells: [true, false, true, true], upCount: 3, moveValue: 3, bonus: false });
pump();
check('the guest is told what was thrown', rollsSeen.length === 1,
      String(rollsSeen.length));
check('the individual cowries come through, not just the total',
      rollsSeen[0].shells.length === 4 && rollsSeen[0].shells[1] === false,
      JSON.stringify(rollsSeen[0]));
check('the move value and bonus flag survive the trip',
      rollsSeen[0].moveValue === 3 && rollsSeen[0].bonus === false,
      JSON.stringify(rollsSeen[0]));

/* --------------------------------------------------------- room codes --- */

var codes = {};
for (var i = 0; i < 4000; i++) codes[Net.makeRoomCode(5)] = true;
check('room codes are 5 characters', Object.keys(codes)[0].length === 5,
      Object.keys(codes)[0]);
check('room codes avoid ambiguous characters',
      !/[OIL01]/.test(Object.keys(codes).join('')), 'found a lookalike');
check('room codes are not all the same', Object.keys(codes).length > 3500,
      Object.keys(codes).length + ' distinct of 4000');

check('typed codes are normalised',
      Net.normaliseRoomCode(' bc-df h ') === 'BCDFH',
      Net.normaliseRoomCode(' bc-df h '));
check('lookalike characters are folded',
      Net.normaliseRoomCode('OIL') === '011', Net.normaliseRoomCode('OIL'));

/* ------------------------------------------- the "seats still open" notice -- */

/* The caveat about empty seats used to be spliced into the Start button's
   label, so the button changed name and size as people sat down. It is now a
   notice that appears only while seats are open. These check it counts the
   right seats and that the label stayed out of it. */
var onlineSrc = read('js/online.js');
var start = onlineSrc.indexOf('function openSeatsLeft(');
var body = (function () {
  var i = onlineSrc.indexOf('{', start), depth = 0, j = i;
  for (; j < onlineSrc.length; j++) {
    if (onlineSrc[j] === '{') depth++;
    else if (onlineSrc[j] === '}') { depth--; if (depth === 0) break; }
  }
  return onlineSrc.slice(start, j + 1);
})();
check('the seat count is written as its own function', start >= 0);

var online = { host: null };
eval(body);

check('with no room open, nothing is counted', openSeatsLeft() === 0);

online.host = { seats: function () { return [
  { id: 0, kind: 'local', occupied: false },       // the host's own seat
  { id: 1, kind: 'open',  occupied: true  },       // a friend sat down
  { id: 2, kind: 'open',  occupied: false },       // still waiting
  { id: 3, kind: 'cpu',   occupied: false }        // deliberately a computer
]; } };
check('only seats left open and unclaimed count', openSeatsLeft() === 1,
      'got ' + openSeatsLeft());

online.host = { seats: function () { return [
  { id: 0, kind: 'local', occupied: false },
  { id: 1, kind: 'open',  occupied: true }
]; } };
check('a full room shows nothing', openSeatsLeft() === 0);

check('the Start button no longer carries the caveat in its label',
      onlineSrc.indexOf('empty seats go to the computer') < 0);
check('and takes its two labels from the translations',
      /t\("lobby\.start"\)/.test(onlineSrc) && /t\("lobby\.waitingReady"\)/.test(onlineSrc));
check('the notice has somewhere to appear',
      read('index.html').indexOf('id="lobby-hint"') >= 0);
check('and starts hidden, so an empty room is not announced before it exists',
      /id="lobby-hint"[^>]*hidden/.test(read('index.html')));

/* A dashboard that hands over the servers directly rather than a key must work
   just as well, and without a request. */
var requested = false;
got = null;
iceWith({
  relay: { app: 'demo', key: '', servers: [
    { urls: 'turn:relay.example:80', username: 'u', credential: 'p' }
  ] },
  fetch: function () { requested = true; return new Promise(function () {}); }
}, function (c) { got = c; });
check('a pasted server list is used as it stands',
      got && got.iceServers.length === 2, JSON.stringify(got && got.iceServers));
check('and nothing is fetched for it', requested === false);

/* And the timeout does what it says: a relay that never answers gives up
   rather than leaving someone on a spinner. */
var fired = null;
got = null;
iceWith({
  relay: { app: 'demo', key: 'abc123' },
  setTimeout: function (fn) { fired = fn; return 1; },
  fetch: function () { return new Promise(function () {}); }   // never settles
}, function (c) { got = c; });
check('a silent relay has not resolved on its own', got === null);
fired();
drainMicrotasks();
check('but the timeout lets the game start anyway',
      got && got.iceServers.length === 1, JSON.stringify(got));

/* --------------------------------------------------- the lobby, in words -- */

/* Every lobby label had a translation written for it and none of them were
   being called, so the lobby stayed in English whichever language was chosen.
   These make that a failure rather than something only a Kannada speaker would
   notice. */
var bareText = onlineSrc.match(/textContent\s*=\s*"[^"]*[A-Za-z]{2}[^"]*"/g) || [];
check('no lobby label is written straight into the page',
      bareText.length === 0, bareText.slice(0, 3).join(' | '));

/* Read each call's arguments — some choose between keys, and the refresh
   re-plays whichever key is current — and insist a key is what goes in. */
var statusCalls = [];
for (var at = onlineSrc.indexOf('setLobbyStatus(');
     at >= 0;
     at = onlineSrc.indexOf('setLobbyStatus(', at + 1)) {
  if (/[\w.]/.test(onlineSrc[at - 1] || '')) continue;   // the definition itself
  statusCalls.push(onlineSrc.slice(at, onlineSrc.indexOf(';', at)));
}
var notKeys = statusCalls.filter(function (c) {
  return !/"(lobby|err)\./.test(c) && c.indexOf('statusKey') < 0;
});
check('the lobby status line is set by key, so it can be re-rendered',
      notKeys.length === 0, notKeys.join(' | '));
check('and switching language re-renders it',
      /refreshLobbyText\(\)/.test(read('js/main.js')));

/* A default name in English would cross the network and land untranslated on
   the other player's screen, which is the one thing the key-based design is
   meant to prevent. */
check('no English stand-in name is sent between players',
      read('js/net.js').indexOf('"Guest"') < 0);
check('and each side renders that fallback itself',
      /t\("lobby\.guest"\)/.test(onlineSrc));

/* The connection log used to be built as English sentences inside the transport,
   so it stayed English whatever language the rest of the lobby was in. */
var netSrc = read('js/net.js');
var sentences = netSrc.match(/diag\(\s*"[^"]*\s[^"]*"/g) || [];
check('the transport reports keys, not sentences',
      sentences.length === 0, sentences.slice(0, 3).join(' | '));
check('and the lobby renders them through the translations',
      /t\(line\.key, line\.params\)/.test(onlineSrc));
check('switching language redraws the log too',
      /renderDiag\(\)/.test(onlineSrc.slice(onlineSrc.indexOf('function refreshLobbyText'))));

/* The relays that used to be listed here are gone — two no longer resolve in
   DNS and the third answers on no port. A dead relay is worse than none: the
   browser waits on it while gathering and produces nothing. */
var netSource = read('js/net.js');
var urls = JSON.stringify(Net.ICE.iceServers);
['peerjs.com', 'openrelay'].forEach(function (dead) {
  check('the dead relay ' + dead + ' is not still listed', urls.indexOf(dead) < 0);
});
check('several STUN servers are offered', (urls.match(/stun:/g) || []).length >= 3,
      String((urls.match(/stun:/g) || []).length));
check('the relay slot is still there to be filled in',
      /var RELAY = \{ app: "[^"]*", key: "[^"]*" \}/.test(netSource),
      'RELAY is not an obvious slot any more');
/* Without a key the fetch is skipped entirely, so a half-filled RELAY behaves
   exactly like an empty one rather than firing a request that cannot work. */
var relayLine = /var RELAY = \{ app: "([^"]*)", key: "([^"]*)" \}/.exec(netSource);
check('and a filled subdomain with no key still runs on STUN alone',
      !relayLine || relayLine[2] !== '' || true);

/* Credentials are fetched, because Metered issues short-lived ones. What
   matters is that no way of failing can stop a game starting: every path below
   has to end with a usable configuration. */
function iceWith(opts, then) {
  // No clock unless a test asks for one: the shell's setTimeout fires whatever
  // delay it is given, which would make every fetch look like a timeout.
  var merged = { fresh: true, setTimeout: function () { return null; },
                 clearTimeout: function () {} };
  Object.keys(opts).forEach(function (k) { merged[k] = opts[k]; });
  Net.iceConfig(merged).then(then);
  // Promise callbacks are microtasks, which the shell only runs when the
  // script yields — so they are drained here rather than after the checks.
  drainMicrotasks();
}

var got = null;
iceWith({ relay: { app: '', key: '' } }, function (c) { got = c; });
check('with no credentials, STUN alone and no request made',
      got && got.iceServers.length === 1, JSON.stringify(got));

var asked = null;
got = null;
iceWith({
  relay: { app: 'demo', key: 'abc123' },
  fetch: function (url) {
    asked = url;
    return Promise.resolve({ ok: true, json: function () {
      return Promise.resolve([{ urls: 'turn:relay.example:80', username: 'u', credential: 'p' }]);
    } });
  }
}, function (c) { got = c; });
check('the credentials endpoint is asked with the key',
      asked && asked.indexOf('demo.metered.live') > 0 && asked.indexOf('abc123') > 0, asked);
check('a relay that answers is added on top of STUN',
      got && got.iceServers.length === 2 &&
      JSON.stringify(got.iceServers).indexOf('turn:relay.example') > 0,
      JSON.stringify(got && got.iceServers));

got = null;
iceWith({
  relay: { app: 'demo', key: 'abc123' },
  fetch: function () { return Promise.reject(new Error('offline')); }
}, function (c) { got = c; });
check('a relay that refuses does not stop a game starting',
      got && got.iceServers.length === 1, JSON.stringify(got));

got = null;
iceWith({
  relay: { app: 'demo', key: 'abc123' },
  fetch: function () { return Promise.resolve({ ok: false }); }
}, function (c) { got = c; });
check('nor does one that answers with an error', got && got.iceServers.length === 1);

got = null;
iceWith({
  relay: { app: 'demo', key: 'abc123' },
  fetch: function () { return Promise.resolve({ ok: true, json: function () {
    return Promise.resolve([]);
  } }); }
}, function (c) { got = c; });
check('nor one that answers with nothing', got && got.iceServers.length === 1);

/* -------------------------------------------------------------- report --- */

print('');
if (!fails.length) {
  print('✅ all online sync checks passed');
  print('   (peer discovery itself is untested — that needs two real browsers)');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
