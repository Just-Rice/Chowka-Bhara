# Chowkabara

A digital Chowka Bhara (Ashta Chamma) — the traditional Indian cowrie-shell race
to the centre. Single file, vanilla JavaScript, no dependencies, no build step.

```sh
open index.html
```

## House rules

**Board & setup**

- 5×5 or 7×7 grid, concentric square rings from the outside in to a centre "home"
- 2–4 players, 4 pieces each
- Each player enters at the middle of their own side. 2 players sit opposite each
  other; 3 use three consecutive sides; 4 use all four
- Direction alternates ring to ring: anti-clockwise around the outer ring,
  clockwise around the next ring in, and so on
- Only the four starting squares are safe — and they are safe from **everyone**.
  No capture can happen on one, whoever owns it

**Rolling** — 4 cowries, counted mouth-up:

| Shells up | Move | Throw again |
| --- | --- | --- |
| 1 | 1 | no |
| 2 | 2 | no |
| 3 | 3 | no |
| 4 | 4 | **yes** |
| 0 | 8 | **yes** |

There is **no cap** on consecutive bonus throws.

**Banked throws**

- Keep throwing while you roll 4s and 0s. Every throw is banked rather than
  played immediately
- Once you roll a 1, 2 or 3, spend the bank: assign each banked throw to **any**
  of your pieces, in **any** order
- You must use every banked throw that has a legal move. A throw with no legal
  move anywhere is skipped
- Order matters and is yours to choose — a throw that looks dead can come alive
  after another throw captures and unlocks your inner rings
- A capture earns another throw, which joins the bank mid-spend

**Movement**

- Entering: a piece leaves your hand and lands on the rolled number, counting the
  start square as the first space — so a roll of 1 lands on the start square
- No piece may enter an inner ring until your side has captured. The unlock is
  **per player, not per piece**: once *any* of your pieces captures, *all* of them
  are permanently free to go inside
- Your own pieces never block each other. They share squares freely and move
  independently — a stack is not a unit
- Reaching the centre needs the exact count; overshooting means that piece simply
  cannot use that throw
- If you have a legal move, you must make it

**Capturing**

- Landing exactly on an opponent's piece sends it back to their hand, and you
  throw again
- Landing on a square holding several opponent pieces sends **all** of them back

**Winning**

- First player with all 4 pieces on the exact centre takes 1st place
- The game then asks whether to **play on** for the remaining places. Play on and
  the finished player drops out while the rest race for 2nd, 3rd and 4th
- If the board ever deadlocks — every piece stranded on the outer ring with nobody
  able to capture, so nobody can ever unlock — the game ends and places are
  awarded by how far each player got

## Computer opponent

Choose 0–3 computer players at setup, at **Easy** or **Sharp**. Computers take the
last seats, so a lone human always moves first.

Sharp scores every legal move on four axes and takes the best:

- **What it wins now** — captures (weighted by how far the victim had travelled)
  and finishing a piece. The *first* capture is scored far above its material
  value, because it is the only key to the inner rings.
- **Exposure** — how likely an opponent is to land on the destination next turn,
  weighted by the true odds of each roll (1 in 4/16, 2 in 6/16, 3 in 4/16,
  4 in 1/16, 8 in 1/16) rather than a flat safe/unsafe.
- **What it sets up** — how much the destination threatens next turn.
- **Escape** — credit for vacating a square that is currently covered.

With several throws banked it scores every *(banked throw × legal piece)* pairing
and plays the best one, then looks again — greedy one step at a time, which is
also how a person plays it.

Easy plays a random legal move about two-thirds of the time.

## Online play

Pick **Host online** and you get a five-character room code. Friends pick
**Join online**, type the code, and take a seat. Each of them then confirms they
are ready; the host cannot start until every seated player has. Any seat nobody
claims is played by the computer.

**How it works.** The host's browser owns the game. Guests send intents — *"spend
the 4 on piece 2"* — and render the snapshot that comes back, so two boards can
never drift apart. Game traffic goes directly browser-to-browser over WebRTC; the
only thing the outside world does is introduce the two browsers to each other in
the first place.

**What this means in practice:**

- The host can, in principle, cheat. This is for playing with friends, not
  strangers.
- If someone drops, the game pauses and waits. They can rejoin with the same code
  and pick their seat back up, or the host can hand it to the computer.
- Matchmaking runs on PeerJS's free public cloud. It occasionally has downtime,
  and if it ever disappears online play breaks until the server address in
  `js/net.js` is pointed somewhere else. Everything else keeps working.
- The library is only fetched when you click into online play, so opening
  `index.html` offline still gives you the full local and computer game.
- Room codes skip vowels and lookalike characters, so they can be read aloud
  without spelling anything rude or ambiguous.

## Tests

The logic is verified headlessly. The tests read the real function source out of
`index.html`, so they exercise shipping code rather than a copy.

```sh
./test/run.sh
```

| Suite | Covers |
| --- | --- |
| `rules-test.js` | Path geometry, shell odds over 200,000 throws, entering, the inner-ring gate, overshoot, exact finish |
| `cpu-test.js` | Takes free captures, avoids covered squares, takes winning moves, no double-counted threats, ~9,600-position fuzz |
| `turn-test.js` | Banked throws stay independent, unplayable throws skip, a mid-turn capture unlocks the rest, selection handling, placement ordering |
| `net-test.js` | Seat claiming, ready gating, turn ownership, snapshot fan-out, disconnect/pause, rejoining, CPU substitution, room-code hygiene |

`net-test.js` runs the real sync layer over an in-memory transport, with two fake
browsers talking to each other. **It does not and cannot test the peer connection
itself** — that needs two real devices. `js/net.js` is deliberately split so the
part that can be tested is as large as possible and the WebRTC adapter is as thin
as possible.

### Path geometry

Every step on the board is orthogonal — pieces never move diagonally. The visit
order for a player entering from the top edge:

```
5x5 — 25 steps                7x7 — 50 steps
  2  1  0 15 14                 3  2  1  0 23 22 21
  3 22 23 16 13                 4 37 38 39 24 25 20
  4 21 24 17 12                 5 36 41 40 47 26 19
  5 20 19 18 11                 6 35 42 49 46 27 18
  6  7  8  9 10                 7 34 43 44 45 28 17
                                8 33 32 31 30 29 16
                                9 10 11 12 13 14 15
```

A lap turns inward from the square it actually ends on, which keeps that step
orthogonal like every other move.

The centre is only reachable straight-on from the four edge-middles of the
innermost ring. On 5x5 the last lap happens to end on one of those, so the piece
steps straight in. On 7x7 it ends on a corner, so the piece takes one extra step
back onto the square beside the centre — the only square any path visits twice —
before going in. That is why a 7x7 journey is 50 steps rather than 49.
