/* Chowka-Bhara — Board geometry: the ring walk each player follows to the centre. */
"use strict";

/* ============================= PATH GENERATION ============================= */
// Each player has their own personal path around the SAME physical board: a
// rotation of one canonical path, so every player's journey is equal length
// and starts at the middle of their own edge, matching the traditional board.
// Movement alternates direction ring to ring (anti-clockwise outer, clockwise
// next ring in, and so on), cutting inward at the cell radially aligned with
// the player's own starting square.

function ringLoop(N, k, startRC, clockwise) {
  var top = k, bottom = N - 1 - k, left = k, right = N - 1 - k;
  var sideLen = N - 2 * k;
  if (sideLen === 1) return [[k, k]];
  var loop = [];
  var c, r;
  for (c = left; c <= right; c++) loop.push([top, c]);
  for (r = top + 1; r <= bottom; r++) loop.push([r, right]);
  for (c = right - 1; c >= left; c--) loop.push([bottom, c]);
  for (r = bottom - 1; r >= top + 1; r--) loop.push([r, left]);
  if (!clockwise) loop.reverse();
  var idx = 0;
  for (var i = 0; i < loop.length; i++) {
    if (loop[i][0] === startRC[0] && loop[i][1] === startRC[1]) { idx = i; break; }
  }
  return loop.slice(idx).concat(loop.slice(0, idx));
}

/* The corners of ring k, which is where a lap always turns inward. Entering at
   a corner rather than mid-edge is what makes both boards read the same way. */
function ringCorners(N, k) {
  var lo = k, hi = N - 1 - k;
  return [[lo, lo], [lo, hi], [hi, lo], [hi, hi]];
}

/* Where the lap that just ended at `tail` steps to. Straight if a corner of the
   next ring is next door, diagonal if it is not — which happens exactly once on
   a 7x7 lap and never on a 5x5 one. */
function turnInward(tail, targets) {
  var straight = null, diagonal = null;
  targets.forEach(function(t) {
    var dr = Math.abs(tail[0] - t[0]), dc = Math.abs(tail[1] - t[1]);
    if (dr + dc === 1) straight = straight || t;
    else if (dr === 1 && dc === 1) diagonal = diagonal || t;
  });
  return straight || diagonal;
}

function buildCanonicalPath(N) {
  var mid = (N - 1) / 2;
  var path = [];
  var ringBoundaries = [];
  var entry = [0, mid];     // the middle of the player's own edge
  var k = 0;

  while (N - 2 * k > 1) {
    /* Which way round the lap goes is decided by where it has to finish: back
       on the player's own side of the ring, so the turn inward is always taken
       from there. On the outer ring both directions finish there — that is the
       side you started on — and that one goes anti-clockwise.

       On a 5x5 this alternates ring to ring. On a 7x7 the innermost ring comes
       out running the same way as the one outside it, which is a consequence of
       the rule rather than an exception to it. */
    var clockwise = k > 0;
    var cells = ringLoop(N, k, entry, clockwise);
    if (clockwise && cells[cells.length - 1][0] !== k) {
      clockwise = false;
      cells = ringLoop(N, k, entry, clockwise);
    }

    path = path.concat(cells);
    ringBoundaries.push(path.length);

    var inner = N - 2 * (k + 1);
    entry = turnInward(path[path.length - 1],
                       inner > 1 ? ringCorners(N, k + 1) : [[mid, mid]]);
    k++;
  }

  path.push([mid, mid]);
  ringBoundaries.push(path.length);

  return { path: path, ringBoundaries: ringBoundaries };
}

function rotateRC(rc, N) { return [rc[1], N - 1 - rc[0]]; }

function rotatePath(path, times, N) {
  return path.map(function(rc) {
    var p = rc;
    for (var t = 0; t < times; t++) p = rotateRC(p, N);
    return p;
  });
}

function physicalRing(r, c, N) {
  return Math.min(r, c, N - 1 - r, N - 1 - c);
}

function layerOf(idx, ringBoundaries) {
  for (var i = 0; i < ringBoundaries.length; i++) {
    if (idx < ringBoundaries[i]) return i;
  }
  return ringBoundaries.length - 1;
}
