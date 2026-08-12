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

**Rolling** — 4 cowrie shells, counted mouth-up:

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

### Known failure

`rules-test.js` reports one real bug: **the path jumps diagonally at every ring
transition.** Here is the visit order for a player entering from the top:

```
  2  1  0 15 14      index 15 is at [0,3]
  3 23 16 17 13      index 16 is at [1,2]  ← diagonal
  4 22 24 18 12
  5 21 20 19 11      index 23 is at [1,1]
  6  7  8  9 10      index 24 is at [2,2]  ← diagonal
```

Every other step on the board is orthogonal, so a piece visibly slides sideways
mid-hop. Unfixed pending a decision on which way the path should turn inward —
both candidate fixes change how long a lap is, which is a gameplay decision.
