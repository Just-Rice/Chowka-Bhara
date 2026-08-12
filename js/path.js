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

function buildCanonicalPath(N) {
  var mid = (N - 1) / 2;
  var path = [];
  var ringBoundaries = [];
  var startCell = [0, mid]; // top-edge middle
  var lastRingStart = null;
  var clockwise = false;    // outer ring travels anti-clockwise
  var k = 0;

  while (true) {
    var sideLen = N - 2 * k;
    if (sideLen <= 0) break;

    if (sideLen === 1) {
      // The centre. A 3x3 ring only touches it from its four edge-middles, so
      // if the lap happened to end on a corner we finish the lap first rather
      // than cutting diagonally across. That costs one extra step, and only
      // on boards where the parity works out that way (7x7, not 5x5).
      var tail = path[path.length - 1];
      if (tail && Math.abs(tail[0] - mid) + Math.abs(tail[1] - mid) > 1) {
        path.push([lastRingStart[0], lastRingStart[1]]);
        // That square belongs to the ring it is part of, not to the centre.
        ringBoundaries[ringBoundaries.length - 1] = path.length;
      }
      path.push([mid, mid]);
      ringBoundaries.push(path.length);
      break;
    }

    var ringCells = ringLoop(N, k, startCell, clockwise);
    lastRingStart = startCell;
    path = path.concat(ringCells);
    ringBoundaries.push(path.length);

    // Turn inward from the square the lap actually ended on. Turning in from
    // the square below the player's *start* instead leaves a diagonal step,
    // which is illegal everywhere else on this board.
    var last = ringCells[ringCells.length - 1];
    var lo = k + 1, hi = N - 2 - k;
    startCell = [
      Math.min(Math.max(last[0], lo), hi),
      Math.min(Math.max(last[1], lo), hi)
    ];
    clockwise = !clockwise;
    k++;
  }

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
