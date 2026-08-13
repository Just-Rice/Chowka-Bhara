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
  this.style = { setProperty: function () {}, removeProperty: function () {} };
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
      'rotatePath', 'piecesPerPlayer', 'buildSafeCells',
      'renderSidebar'].map(grab).join('\n'));

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
    safeCellSet: buildSafeCells(N, all), players: players
  };
}

function tokens() { return document.querySelectorAll('.token'); }
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

/* -------------------------------------------------------------- report --- */

print('');
print('board redraws exercised against a stub document');
if (!fails.length) {
  print('✅ all rendering checks passed');
} else {
  print('❌ ' + fails.length + ' failure(s):');
  fails.forEach(function (f) { print('  - ' + f); });
}
