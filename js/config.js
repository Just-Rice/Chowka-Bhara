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

/* The two boards are played as two different games. 5x5 is the four-cowrie
   game: four pieces a side, throws of 1 to 4 and 8. 7x7 has twice the path to
   walk, so it is played with six cowries and six pieces a side — bigger throws
   and more to move, which keeps the longer board to a comparable length of
   game rather than twice the length. */
function piecesPerPlayer(N) { return N >= 7 ? 6 : 4; }
function shellCount(N) { return N >= 7 ? 6 : 4; }

/* One rule covers both sets, which is why the counts can change without the
   rules changing: your count is your move, and the two extremes — every cowrie
   up, and none of them — are the special throws that earn another turn. None
   up is worth double the set. With four that is the familiar 4 and 8; with six
   it comes out as 6 and 12. */
function throwOutcome(upCount, shells) {
  if (upCount === 0)      return { moveValue: shells * 2, bonus: true };
  if (upCount === shells) return { moveValue: shells,     bonus: true };
  return { moveValue: upCount, bonus: false };
}

function binomial(n, k) {
  var r = 1, i;
  for (i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return Math.round(r);
}

/* Every roll a player can make on this board, with its probability. The
   computer uses these to weigh risk and threat, and it asks often enough that
   the answer is worked out once per board and kept. */
var ROLL_ODDS_BY_N = {};
function rollOdds(N) {
  if (ROLL_ODDS_BY_N[N]) return ROLL_ODDS_BY_N[N];
  var shells = shellCount(N);
  var total = Math.pow(2, shells);
  var byValue = {};
  for (var up = 0; up <= shells; up++) {
    var v = throwOutcome(up, shells).moveValue;
    byValue[v] = (byValue[v] || 0) + binomial(shells, up) / total;
  }
  var odds = Object.keys(byValue).map(function (v) {
    return { value: parseInt(v, 10), p: byValue[v] };
  }).sort(function (a, b) { return a.value - b.value; });
  ROLL_ODDS_BY_N[N] = odds;
  return odds;
}

var state = null;
