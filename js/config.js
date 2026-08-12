/* Chowka-Bhara — Shared configuration and the mutable game state everything reads. */
"use strict";

var ChowkaNet = window.ChowkaNet;

/* ============================= CONFIG ============================= */
var PLAYER_DEFS = [
  { key: "players.madder",   colorVar: "p-madder"   },
  { key: "players.indigo",   colorVar: "p-indigo"   },
  { key: "players.turmeric", colorVar: "p-turmeric" },
  { key: "players.areca",    colorVar: "p-areca"    }
];

var t = function (k, p) { return I18N.t(k, p); };
function playerName(id) { return t(PLAYER_DEFS[id].key); }
var PIECES_PER_PLAYER = 4;

// Every roll a player can make, with its probability out of the 16 equally
// likely shell outcomes. Used by the computer to weigh risk and threat.
var ROLL_ODDS = [
  { value: 1, p: 4 / 16 },
  { value: 2, p: 6 / 16 },
  { value: 3, p: 4 / 16 },
  { value: 4, p: 1 / 16 },
  { value: 8, p: 1 / 16 }
];

var state = null;
