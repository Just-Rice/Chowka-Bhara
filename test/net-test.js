/* Tests the online sync layer with an in-memory transport — no browser, no
 * WebRTC. This covers everything except the peer connection itself: seat
 * claiming, turn ownership, snapshot fan-out, disconnects, pausing, and CPU
 * substitution.
 *
 * What this deliberately does NOT prove: that two real browsers can find each
 * other through the signalling server. That needs two actual devices. */

var root = this;
load('/Users/rishirao/workspace/chowkabara/js/net.js');
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

/* -------------------------------------------------------------- report --- */

print('');
if (!fails.length) {
  print('✅ all online sync checks passed');
  print('   (peer discovery itself is untested — that needs two real browsers)');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
