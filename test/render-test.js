/* Tests the drawing code that touches the board, by giving it just enough of a
 * document to run against. Everything else in these suites is pure logic; this
 * one exists because the worst bug the game has had was a drawing bug — the
 * pieces multiplying every time the language changed — and a source-level grep
 * would not have caught it.
 *
 * The DOM here is a few dozen lines and supports only what render.js actually
 * uses. That is the point: it is small enough to trust, and the function under
 * test is the real one. */

var fails = [];
function check(name, cond, detail) {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
}

/* ------------------------------------------------------ a small document -- */

function Node(tag) {
  this.tag = tag;
  this.children = [];
  this.parentNode = null;
  this.className = '';
  this.id = '';
  this.props = {};
  var self = this;
  this.style = {
    setProperty: function (k, v) { self.props[k] = v; },
    removeProperty: function (k) { delete self.props[k]; }
  };
  this.classList = {
    add: function () {}, remove: function () {}, toggle: function () {},
    contains: function () { return false; }
  };
}
Node.prototype.appendChild = function (n) {
  if (n.parentNode) n.parentNode.removeChild(n);
  n.parentNode = this;
  this.children.push(n);
  return n;
};
Node.prototype.removeChild = function (n) {
  var i = this.children.indexOf(n);
  if (i >= 0) this.children.splice(i, 1);
  n.parentNode = null;
  return n;
};
Node.prototype.setAttribute = function () {};
Node.prototype.addEventListener = function () {};
Node.prototype.querySelector = function (sel) {
  var want = sel.replace('.', ''), found = null;
  walk(this, function (n) {
    if (found === null && n !== this &&
        n.className.split(/\s+/).indexOf(want) >= 0) found = n;
  });
  return found;
};

/* Only enough HTML parsing to find the ids a fragment declares — which is all
   the roster rows use it for. */
Object.defineProperty(Node.prototype, 'innerHTML', {
  set: function (html) {
    this.children.forEach(function (c) { c.parentNode = null; });
    this.children = [];
    var re = /id="([^"]+)"/g, m;
    while ((m = re.exec(html)) !== null) {
      var child = new Node('div');
      child.id = m[1];
      this.appendChild(child);
    }
  },
  get: function () { return ''; }
});

function walk(node, fn) {
  fn(node);
  node.children.slice().forEach(function (c) { walk(c, fn); });
}

var root = new Node('body');
var document = {
  createElement: function (tag) { return new Node(tag); },
  getElementById: function (id) {
    var found = null;
    walk(root, function (n) { if (found === null && n.id === id) found = n; });
    return found;
  },
  querySelectorAll: function (sel) {
    var want = sel.replace('.', ''), out = [];
    walk(root, function (n) {
      if (n.className.split(/\s+/).indexOf(want) >= 0) out.push(n);
    });
    return out;
  }
};

/* --------------------------------------------------- the real code under -- */

var SRC = ['config', 'path', 'render', 'game']
  .map(function (n) { return read('js/' + n + '.js'); }).join('\n');

function grab(name) {
  var start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  var i = SRC.indexOf('{', start), depth = 0, j = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, j + 1);
}

eval(['ringLoop', 'ringCorners', 'turnInward', 'buildCanonicalPath', 'rotateRC',
      'rotatePath', 'piecesPerPlayer', 'buildSafeCells', 'buildStackCells', 'physicalRing',
      'renderSidebar', 'updateCellDensity', 'logSnapshot', 'historyGoTo', 'historyStep',
      'historyLive', 'historyLiveAgain', 'showShells', 'pairHolds'].map(grab).join('\n'));

/* render.js keeps these at the top of the file rather than inside a function,
   so they are declared here to match. */
var logEntries = [];
var history = { viewing: null };
function renderHistory() {}
function updateUI() {}
/* Lives in online.js. Redrawing the sidebar puts every piece where the game
   says it is, which is the same thing for the purposes of these checks. */
function syncTokensToState() { renderSidebar(); }

// Everything renderSidebar leans on that is not the thing being tested.
function renderRoster() {}
function playerName(id) { return 'P' + id; }
function requestMove() {}
var PLAYER_DEFS = [
  { key: 'players.madder', colorVar: 'p-madder' },
  { key: 'players.indigo', colorVar: 'p-indigo' },
  { key: 'players.turmeric', colorVar: 'p-turmeric' },
  { key: 'players.areca', colorVar: 'p-areca' }
];
var SLOT_SETS = { 2: [0, 2], 4: [0, 1, 2, 3] };
var state = null;

function buildBoard(N) {
  root.children = [];
  var board = new Node('div');
  board.id = 'board';
  root.appendChild(board);
  for (var r = 0; r < N; r++) {
    for (var c = 0; c < N; c++) {
      var cell = new Node('div');
      cell.id = 'pieces-' + r + '-' + c;
      cell.className = 'pieces';
      board.appendChild(cell);
    }
  }
  var roster = new Node('div');
  roster.id = 'roster';
  root.appendChild(roster);
}

function makeState(N, numPlayers) {
  var built = buildCanonicalPath(N);
  var all = [0, 1, 2, 3].map(function (s) { return rotatePath(built.path, s, N); });
  var slots = SLOT_SETS[numPlayers];
  var players = [];
  for (var i = 0; i < numPlayers; i++) {
    var pieces = [];
    for (var j = 0; j < piecesPerPlayer(N); j++) {
      pieces.push({ id: j, status: 'active', pathIndex: 0 });
    }
    players.push({
      id: i, colorVar: PLAYER_DEFS[i].colorVar, slot: slots[i],
      path: all[slots[i]], hasCaptured: false, isCPU: false, pieces: pieces
    });
  }
  return {
    N: N, pathLength: built.path.length, ringBoundaries: built.ringBoundaries,
    safeCellSet: buildSafeCells(N, all),
    stackCellSet: buildStackCells(N, buildSafeCells(N, all)), players: players
  };
}

function tokens() { return document.querySelectorAll('.token'); }
function syncTokens() { renderSidebar(); }
function tokensIn(id) {
  var host = document.getElementById(id);
  return host ? host.children.filter(function (c) {
    return c.className.split(/\s+/).indexOf('token') >= 0;
  }).length : -1;
}

/* ------------------------------------------------------------- the bug --- */

[[5, 2], [7, 4]].forEach(function (setup) {
  var N = setup[0], np = setup[1];
  var tag = N + 'x' + N + ' ' + np + 'p: ';
  var want = np * piecesPerPlayer(N);

  buildBoard(N);
  state = makeState(N, np);
  renderSidebar();
  check(tag + 'one piece per piece, first time round', tokens().length === want,
        tokens().length + ' of ' + want);

  /* Redrawing is what a language change does — the settings panel is where the
     language lives, which is how this was found. It must not add a second set. */
  renderSidebar();
  check(tag + 'and still after a redraw', tokens().length === want,
        tokens().length + ' of ' + want);

  for (var i = 0; i < 6; i++) renderSidebar();
  check(tag + 'and after six more', tokens().length === want,
        tokens().length + ' of ' + want);
});

/* --------------------------------------------- pieces stay where they are - */

buildBoard(5);
state = makeState(5, 2);
renderSidebar();

/* Move a piece out along its path, and send another one home. */
var mover = state.players[0].pieces[0];
mover.pathIndex = 7;
var finisher = state.players[0].pieces[1];
finisher.status = 'finished';

renderSidebar();

var rc = state.players[0].path[7];
check('a piece part-way round is drawn where it stands',
      tokensIn('pieces-' + rc[0] + '-' + rc[1]) === 1,
      String(tokensIn('pieces-' + rc[0] + '-' + rc[1])));
check('a finished piece is drawn in its tray',
      tokensIn('finished-0') === 1, String(tokensIn('finished-0')));

var start = state.players[0].path[0];
check('and the start square holds only the pieces still on it',
      tokensIn('pieces-' + start[0] + '-' + start[1]) === 2,
      String(tokensIn('pieces-' + start[0] + '-' + start[1])));

check('no piece is left without a home',
      tokens().every(function (t) { return t.parentNode !== null; }));

/* Four pieces on one square have to shrink to fit. They are sized by the same
   pass that draws them, because a redraw that forgot to size them left every
   piece full-size and overlapping — which is what a fresh online game looked
   like, since the seat list arrives and redraws the board a moment after it
   starts. */
buildBoard(5);
state = makeState(5, 2);
renderSidebar();

var startCell = document.getElementById('pieces-' + state.players[0].path[0][0] +
                                        '-' + state.players[0].path[0][1]);
check('a square holding four pieces is told how big to draw them',
      !!startCell && !!startCell.props['--tok'],
      JSON.stringify(startCell && startCell.props));
check('and they are shrunk rather than left at full size',
      parseFloat(startCell.props['--tok']) < 64,
      startCell.props['--tok']);

var empty = document.getElementById('pieces-1-1');
check('an empty square is not given a size at all', !empty.props['--tok']);

/* Any redraw, not just the first: this is the path that was missing it. */
startCell.props = {};
renderSidebar();
check('and a second redraw sizes them too', !!startCell.props['--tok'],
      JSON.stringify(startCell.props));

/* ------------------------------------------------- names and colours ---- */

/* SEATS is what decides who a player is, so it runs here for real too — it
   builds DOM, and its colour rules are the sort of thing that looks obviously
   right and quietly is not. */
var store = {};
var localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var I18N = { t: function (k, p) { return p ? k + JSON.stringify(p) : k; } };
/* The module declares itself with "use strict", which would confine its var to
   the eval rather than letting the suite see it. */
eval(read('js/seats.js').replace('"use strict";', ''));

state = null;
SEATS.load();
check('four seats, four different colours',
      SEATS.list.length === 4 &&
      SEATS.list.map(function (r) { return r.colour; }).sort().join() ===
        SEATS.COLOURS.slice().sort().join(),
      SEATS.list.map(function (r) { return r.colour; }).join());

/* Taking a colour somebody else holds must trade, not clone. */
SEATS.setColour(0, "p-turmeric");
var colours = SEATS.list.map(function (r) { return r.colour; });
check('choosing a taken colour trades for it',
      colours[0] === "p-turmeric" && colours[2] === "p-madder", colours.join());
check('and all four are still different',
      colours.slice().sort().join() === SEATS.COLOURS.slice().sort().join(),
      colours.join());

/* Choosing the colour you already have is not a swap with yourself. */
SEATS.setColour(0, "p-turmeric");
check('re-choosing your own colour changes nothing',
      SEATS.list.map(function (r) { return r.colour; }).join() === colours.join());

/* A name falls back to the colour, and follows the seat through a swap. */
check('an unnamed seat is called after its colour',
      SEATS.nameOf(1) === "players.indigo", SEATS.nameOf(1));
SEATS.setName(1, "Rishi");
check('a named seat is called what it was named', SEATS.nameOf(1) === "Rishi");
SEATS.setColour(1, "p-areca");
check('and keeps that name through a colour change', SEATS.nameOf(1) === "Rishi");

var long = "abcdefghijklmnopqrstuvwxyz";
SEATS.setName(2, long);
check('a name is capped rather than let run',
      SEATS.nameOf(2).length === SEATS.MAX_NAME, SEATS.nameOf(2));

check('the name sent online is the first seat\'s', SEATS.myName() === null);
SEATS.setName(0, "Host");
check('once it has one', SEATS.myName() === "Host");

/* Anything can end up in storage; two seats holding one colour must not. */
store["chowka:seats"] = JSON.stringify([
  { name: "", colour: "p-indigo" }, { name: "", colour: "p-indigo" },
  { name: "", colour: "p-indigo" }, { name: "", colour: "p-indigo" }
]);
SEATS.load();
var repaired = SEATS.list.map(function (r) { return r.colour; });
check('a corrupt saved file is repaired rather than trusted',
      repaired.slice().sort().join() === SEATS.COLOURS.slice().sort().join(),
      repaired.join());

store["chowka:seats"] = "not json at all";
SEATS.load();
check('and unreadable storage falls back to the defaults',
      SEATS.list.length === 4 && SEATS.list[0].colour === "p-madder");

/* A colour change has to reach the pieces, which carry it as a class. */
store = {};
SEATS.load();
buildBoard(5);
state = makeState(5, 2);
state.players.forEach(function (p) { p.colorVar = SEATS.colourOf(p.id); });
renderSidebar();
SEATS.setColour(0, "p-areca");
state.players.forEach(function (p) { p.colorVar = SEATS.colourOf(p.id); });
renderSidebar();
var mine = tokens().filter(function (tk) {
  return tk.className.indexOf("token-p-areca") >= 0;
});
check('pieces are redrawn in the new colour',
      mine.length === piecesPerPlayer(5), mine.length + ' in areca');
check('and no piece is left in the old one',
      tokens().length === 2 * piecesPerPlayer(5), String(tokens().length));

/* Called before load(), these must still answer rather than throw — they run
   from the lobby and from the join handler, where an exception would take the
   connection down with no message. */
SEATS.list = null;
var survived = true;
try {
  SEATS.colourOf(0); SEATS.nameOf(0); SEATS.myName(); SEATS.visibleCount();
} catch (e) { survived = false; }
check('the seat readers load themselves rather than throwing', survived);

/* ------------------------------------------- one colour to one seat ------ */

/* Colours used to be a purely local setting, so two players could both choose
   blue and each screen would draw the same seat in its own colour. The host
   settles them now, and this is the rule it settles by. */
function coloursOf(list) { return list.map(function (r) { return r.colour; }); }

var settled = SEATS.resolve([
  { name: 'A', colour: 'p-indigo' },
  { name: 'B', colour: 'p-indigo' },
  { name: 'C', colour: 'p-indigo' },
  { name: 'D', colour: 'p-indigo' }
]);
check('everyone asking for the same colour still gets four different ones',
      coloursOf(settled).sort().join() === SEATS.COLOURS.slice().sort().join(),
      coloursOf(settled).join());
check('and the first to ask keeps what they asked for',
      settled[0].colour === 'p-indigo', settled[0].colour);
check('names are left alone', settled.map(function (r) { return r.name; }).join() === 'A,B,C,D');

settled = SEATS.resolve([
  { name: '', colour: 'p-areca' },
  { name: '', colour: null },
  { name: '', colour: 'p-madder' },
  { name: '', colour: undefined }
]);
check('a seat that asked for nothing is given something free',
      coloursOf(settled).sort().join() === SEATS.COLOURS.slice().sort().join(),
      coloursOf(settled).join());
check('and the ones that did ask are honoured',
      settled[0].colour === 'p-areca' && settled[2].colour === 'p-madder',
      coloursOf(settled).join());

settled = SEATS.resolve([{ name: '', colour: 'not-a-colour' }, { name: '', colour: 'p-indigo' }]);
check('a colour that does not exist is ignored rather than drawn',
      SEATS.COLOURS.indexOf(settled[0].colour) >= 0, settled[0].colour);

/* What the host sends back is what this browser draws, whatever it wanted. */
store = {};
SEATS.load();
SEATS.setColour(0, 'p-areca');
SEATS.useRemote([{ name: 'Ravi', colour: 'p-turmeric' }, { name: '', colour: 'p-madder' }]);
check("the host's answer wins over this browser's wish",
      SEATS.colourOf(0) === 'p-turmeric', SEATS.colourOf(0));
check('including the name', SEATS.nameOf(0) === 'Ravi', SEATS.nameOf(0));
SEATS.useRemote(null);
check('and a local game goes back to its own choices',
      SEATS.colourOf(0) === 'p-areca', SEATS.colourOf(0));

/* ------------------------------------------------- reading it back ------ */

/* Stepping through the log has to move the pieces and the cowries, because the
   board is what you are reading. It must also be able to come back. */
buildBoard(5);
state = makeState(5, 2);
state.players.forEach(function (p) { p.colorVar = SEATS.colourOf(p.id); });
renderSidebar();

/* Three moments: everyone at home, one piece out, that piece further out. */
logEntries = [];
state.lastRoll = { shells: [true, false, true, false] };
logEntries.push({ key: 'a', params: {}, at: logSnapshot() });

state.players[0].pieces[0].pathIndex = 4;
state.lastRoll = { shells: [false, false, false, false] };
logEntries.push({ key: 'b', params: {}, at: logSnapshot() });

state.players[0].pieces[0].pathIndex = 9;
state.players[0].pieces[1].status = 'finished';
state.lastRoll = { shells: [true, true, true, true] };
logEntries.push({ key: 'c', params: {}, at: logSnapshot() });

check('a line remembers where every piece stood',
      logEntries[2].at.pieces[0][0] === 9 && logEntries[2].at.pieces[0][1] === -1,
      JSON.stringify(logEntries[2].at.pieces[0]));
check('and what the cowries showed',
      logEntries[0].at.shells.join() === 'true,false,true,false',
      String(logEntries[0].at.shells));

/* Put the board where it is now, then walk back. */
syncTokens();
check('the game starts out showing the present', historyLive());

historyGoTo(0);
check('stepping back is no longer the present', !historyLive());
var start = state.players[0].path[0];
check('and the pieces go back with it',
      tokensIn('pieces-' + start[0] + '-' + start[1]) === 4,
      String(tokensIn('pieces-' + start[0] + '-' + start[1])));

historyStep(1);
check('forward one moves on', history.viewing === 1, String(history.viewing));
var four = state.players[0].path[4];
check('and the piece is where that line left it',
      tokensIn('pieces-' + four[0] + '-' + four[1]) === 1,
      String(tokensIn('pieces-' + four[0] + '-' + four[1])));

historyStep(-5);
check('walking back past the beginning stops there', history.viewing === 0);
historyStep(9);
check('and forward past the end stops at the last line',
      history.viewing === logEntries.length - 1, String(history.viewing));

historyGoTo(0);
historyLiveAgain();
check('coming back to now says so', historyLive());
var nine = state.players[0].path[9];
check('and puts the pieces where the game says they are',
      tokensIn('pieces-' + nine[0] + '-' + nine[1]) === 1,
      String(tokensIn('pieces-' + nine[0] + '-' + nine[1])));
check('including the one that finished', tokensIn('finished-0') === 1,
      String(tokensIn('finished-0')));

/* A line written before there was a board cannot be stepped to. */
logEntries.push({ key: 'd', params: {}, at: null });
historyGoTo(logEntries.length - 1);
check('a line with no position behind it is not jumped to', historyLive());

/* ------------------------------------------------- a pair on the board --- */

/* Two pieces sharing a square already look like two pieces sharing a square.
   What makes a pair different is that nobody may land on it, and that is
   invisible unless it is drawn — so the container is marked, and only where the
   pair actually buys something. */
state = makeState(5, 2);
buildBoard(5);
state.stackCellSet = buildStackCells(5, state.safeCellSet);

/* An inner-ring square, which takes a stack and is open to capture. */
var openIdx = state.ringBoundaries[0] + 1;
var openRC = state.players[0].path[openIdx];
state.players[0].pieces[0].pathIndex = openIdx;
state.players[0].pieces[1].pathIndex = openIdx;
renderSidebar();
function cell(rc) { return document.getElementById('pieces-' + rc[0] + '-' + rc[1]); }
check('setup: the square is open to capture',
      !state.safeCellSet[openRC[0] + ',' + openRC[1]]);
check('a pair on an open square is marked', pairHolds(cell(openRC)) === true);

/* The start square: safe, and where every game begins with the whole set. */
var startRC = state.players[0].path[0];
check('a set on its own start is not', pairHolds(cell(startRC)) === false,
      'safe squares shelter everyone already');

/* One piece alone is not a pair. */
state.players[0].pieces[1].pathIndex = openIdx + 1;
renderSidebar();
check('and one piece alone is not', pairHolds(cell(openRC)) === false);

/* ------------------------------------------------- the end of the game --- */

/* The last thing anybody sees, and the least exercised: it is drawn once, and
   only when a game is already over. It named the winner by reading a property
   the players do not have — every game ended by announcing that "undefined" had
   won — and it said the rest of the card in English whatever language the game
   was being read in. Both are the kind of thing only a test that actually draws
   the card will catch, so here it is drawn.

   I18N.t is stubbed to echo the key it is given, so a line that reads as a key
   went through the table and a line that reads as a sentence is hard-coded. */

eval(['showWinOverlay', 'showDrawOverlay', 'standingsText', 'ordinal', 'playerActive']
     .map(grab).join('\n'));
function t(k, p) { return I18N.t(k, p); }

function buildOverlay() {
  ['win-overlay', 'win-eyebrow', 'win-standings', 'play-on-btn', 'play-again-btn']
    .forEach(function (id) {
      var n = new Node('div');
      n.id = id;
      root.appendChild(n);
    });
  var name = new Node('p');
  name.className = 'win-name';
  document.getElementById('win-overlay').appendChild(name);
}
function overlayText(id) { return document.getElementById(id).textContent; }
function winnerName() {
  return document.getElementById('win-overlay').querySelector('.win-name').textContent;
}

buildOverlay();
state = makeState(5, 2);
state.placements = [1, 0];

showWinOverlay(state.players[1], false);
check('the winner is named', winnerName() === playerName(1), String(winnerName()));
check('and named by asking, not by reading a property off the player',
      String(winnerName()).indexOf('undefined') < 0, String(winnerName()));
check('the final card is looked up, not written out',
      overlayText('win-eyebrow') === 'win.finalPlacings', overlayText('win-eyebrow'));
check('and lists the placings, winner first',
      overlayText('win-standings').indexOf(playerName(1)) <
      overlayText('win-standings').indexOf(playerName(0)),
      JSON.stringify(overlayText('win-standings')));
check('with nothing to play on for',
      document.getElementById('play-on-btn').hidden === true);
check('the button underneath offers another game',
      overlayText('play-again-btn') === 'win.playAgain', overlayText('play-again-btn'));

showWinOverlay(state.players[0], true);
check('the first-one-home card is looked up too',
      overlayText('win-eyebrow') === 'win.firstHome', overlayText('win-eyebrow'));
check('and asks the question rather than stating it',
      overlayText('win-standings') === 'win.playOnQ', overlayText('win-standings'));
check('with the option to play on', document.getElementById('play-on-btn').hidden === false);
check('and to stop there', overlayText('play-again-btn') === 'win.endHere',
      overlayText('play-again-btn'));

/* A game nobody won. The host reaches this by calling the tie; a guest reaches
   it by being handed a snapshot, which is why it is drawn from the state rather
   than from what the caller happened to be holding. */
state.placements = [];
showDrawOverlay();
check('a draw names everyone still playing',
      winnerName().indexOf(playerName(0)) >= 0 && winnerName().indexOf(playerName(1)) >= 0,
      winnerName());
check('and says it was drawn', overlayText('win-eyebrow') === 'win.drawn',
      overlayText('win-eyebrow'));
check('a draw offers nothing to play on for',
      document.getElementById('play-on-btn').hidden === true);

/* Called with a player that is not there — a tie snapshot has no placings, so
   players[placements[0]] is undefined — it must not take the screen down. */
var threw = false;
try { showWinOverlay(undefined, false); } catch (e) { threw = true; }
check('an ending with nobody to name does not throw', !threw);

/* -------------------------------------------------------------- report --- */

print('');
print('board redraws exercised against a stub document');
if (!fails.length) {
  print('✅ all rendering checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
