/* Chowka-Bhara — who the players are: their names and their colours.
 *
 * The four seats ship named after the colours they play — Madder, Indigo,
 * Turmeric, Areca — which is how a physical board refers to them. That is a
 * sensible default and a poor substitute for a name, so both can be changed
 * here and are remembered per browser.
 *
 * Colours are swapped rather than assigned. Two players sharing a colour would
 * make the board unreadable, so choosing a colour somebody else holds trades
 * with them and all four stay distinct.
 *
 * A name set here is a literal string, unlike everything else in the game,
 * which travels as a key and is translated on arrival. That is the right
 * behaviour: a person's name should read the same in every language.
 */
"use strict";

var SEATS = {
  /* Index is the seat, and the order matches PLAYER_DEFS. */
  COLOURS: ["p-madder", "p-indigo", "p-turmeric", "p-areca"],
  KEYS: {
    "p-madder": "players.madder",
    "p-indigo": "players.indigo",
    "p-turmeric": "players.turmeric",
    "p-areca": "players.areca"
  },
  MAX_NAME: 16,

  list: null,

  load: function () {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("chowka:seats") || "null"); } catch (e) {}

    SEATS.list = SEATS.COLOURS.map(function (colour, i) {
      var row = (saved && saved[i]) || {};
      return {
        name: typeof row.name === "string" ? row.name.slice(0, SEATS.MAX_NAME) : "",
        colour: SEATS.COLOURS.indexOf(row.colour) >= 0 ? row.colour : colour
      };
    });

    // A saved file with a duplicated colour would leave two seats identical, so
    // any clash is repaired by handing out whatever is left over.
    var seen = {}, spare = SEATS.COLOURS.slice();
    SEATS.list.forEach(function (row) {
      if (seen[row.colour]) row.colour = null;
      else { seen[row.colour] = true; spare.splice(spare.indexOf(row.colour), 1); }
    });
    SEATS.list.forEach(function (row) {
      if (!row.colour) row.colour = spare.shift();
    });
    return SEATS.list;
  },

  save: function () {
    try { localStorage.setItem("chowka:seats", JSON.stringify(SEATS.list)); } catch (e) {}
  },

  /* Every reader loads on demand. These are called from the lobby and from the
     join handler, and if load() had not run — a script from another release
     meeting this one, say — the reader would throw where it stands. That is a
     silent, connection-killing failure for the sake of one missing call. */
  ready: function () {
    if (!SEATS.list) SEATS.load();
    return SEATS.list;
  },

  colourOf: function (id) {
    var row = SEATS.ready()[id];
    return row ? row.colour : SEATS.COLOURS[id % 4];
  },

  /* The name shown for a seat: what the player chose, or the name of the colour
     they are playing, in whatever language this browser is set to. */
  nameOf: function (id) {
    var row = SEATS.ready()[id];
    if (!row) return "";
    if (row.name) return row.name;
    return I18N.t(SEATS.KEYS[row.colour]);
  },

  /* The name this device answers to online. A guest has no seat until it claims
     one, so the first row doubles as "you". */
  myName: function () { return SEATS.ready()[0].name || null; },

  setName: function (id, value) {
    SEATS.ready()[id].name = String(value || "").slice(0, SEATS.MAX_NAME);
    SEATS.save();
    SEATS.applyToGame();
  },

  setColour: function (id, colour) {
    if (SEATS.COLOURS.indexOf(colour) < 0) return;
    SEATS.ready();
    var mine = SEATS.list[id].colour;
    if (mine === colour) return;
    // Trade with whoever holds it, so the four never collide.
    SEATS.list.forEach(function (row) { if (row.colour === colour) row.colour = mine; });
    SEATS.list[id].colour = colour;
    SEATS.save();
    SEATS.applyToGame();
  },

  /* Push a change into a game already in progress. Colours live on the pieces
     themselves, so the board has to be redrawn rather than merely relabelled. */
  applyToGame: function () {
    if (typeof state === "undefined" || !state) return;
    state.players.forEach(function (p) { p.colorVar = SEATS.colourOf(p.id); });
    if (typeof renderBoardStructure === "function") renderBoardStructure();
    if (typeof renderSidebar === "function") renderSidebar();
    if (typeof renderLog === "function") renderLog();
    if (typeof updateUI === "function") updateUI();
  },

  /* How many rows to offer: the seats of the game being played, or the number
     the setup screen is currently set to. */
  visibleCount: function () {
    if (typeof state !== "undefined" && state) return state.players.length;
    var picked = document.querySelector('input[name="num-players"]:checked');
    return picked ? parseInt(picked.value, 10) : 2;
  },

  build: function () {
    var host = document.getElementById("seat-settings");
    if (!host) return;
    host.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "a11y-row";

    var head = document.createElement("div");
    head.className = "a11y-head";
    var label = document.createElement("span");
    label.className = "a11y-label";
    label.textContent = I18N.t("seats.title");
    head.appendChild(label);
    wrap.appendChild(head);

    var hint = document.createElement("p");
    hint.className = "a11y-hint";
    hint.textContent = I18N.t("seats.hint");
    wrap.appendChild(hint);

    SEATS.ready();
    var n = SEATS.visibleCount();
    for (var i = 0; i < n; i++) wrap.appendChild(SEATS.row(i));

    host.appendChild(wrap);
  },

  row: function (id) {
    var row = document.createElement("div");
    row.className = "seat-edit";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "seat-edit-name";
    input.maxLength = SEATS.MAX_NAME;
    input.value = SEATS.list[id].name;
    // The colour's own name stands in, so an empty field still says what the
    // seat will be called rather than looking unfinished.
    input.placeholder = I18N.t(SEATS.KEYS[SEATS.list[id].colour]);
    input.setAttribute("aria-label", I18N.t("seats.nameFor", { n: id + 1 }));
    input.addEventListener("input", function () { SEATS.setName(id, input.value); });
    row.appendChild(input);

    var swatches = document.createElement("div");
    swatches.className = "seat-edit-colours";
    swatches.setAttribute("role", "group");
    swatches.setAttribute("aria-label", I18N.t("seats.colourFor", { n: id + 1 }));

    SEATS.COLOURS.forEach(function (colour) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (SEATS.list[id].colour === colour ? " on" : "");
      b.style.background = "var(--" + colour + ")";
      b.setAttribute("aria-label", I18N.t(SEATS.KEYS[colour]));
      b.setAttribute("aria-pressed", String(SEATS.list[id].colour === colour));
      b.addEventListener("click", function () {
        SEATS.setColour(id, colour);
        SEATS.build();          // a swap changes another row too
      });
      swatches.appendChild(b);
    });

    row.appendChild(swatches);
    return row;
  }
};
