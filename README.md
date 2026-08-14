# Chowka-Bhara

A digital Chowka-Bhara (Ashta Chamma) — the traditional Indian cowrie race to
the centre. Vanilla JavaScript, no dependencies, no build step.

```sh
open index.html
```

## House rules

**Board & setup**

- 5×5 or 7×7 grid, concentric square rings from the outside in to a centre "home"
- 2 or 4 players. The board decides the rest: **5×5 is the four-cowrie game**, four
  pieces a side; **7×7 is played with six cowries and six pieces a side**. The
  larger board is twice the walk, so bigger throws and more to move keep it to a
  comparable length of game rather than twice the length
- Each player enters at the middle of their own side. 2 sit opposite each other;
  4 use all four. **Three is not offered**: it seats players on three consecutive
  sides, which leaves one with an opponent on either flank and one with a free
  side — not the same game for all three of them
- Each lap finishes back on your own side of the board before turning inward,
  onto a corner of the next ring in. On the 5×5 that comes out as alternating
  directions ring by ring; on the 7×7 the two inner rings run the same way
- Every move is straight except one: on the 7×7, turning off the outer ring is a
  single diagonal step onto a safe corner
- Safe squares are safe from **everyone** — no capture can happen on one,
  whoever owns it. There are two kinds: the four starting squares, and **every
  the four starting squares — which on the 5×5 is all of them, four out of
  twenty-five, as the game has always been played. The 7×7 is a longer walk and
  shelters its corners as well, since a corner is where a piece has to turn and
  a chase behind it closes up; but never on the last ring before home, because
  there should be nowhere to sit out the final stretch. **5×5: 4 safe squares.
  7×7: 12** All of them are ringed in white, drawn over the
  pieces so a crowded square still reads as safe

**Rolling** — cowries counted mouth-up. One rule covers both sets: your count is
your move, and the two extremes earn another throw — every cowrie up is worth its
own number, none up is worth double the set.

| Cowries up | 5×5 (four cowries) | 7×7 (six cowries) | Throw again |
| --- | --- | --- | --- |
| 1 | 1 | 1 | no |
| 2 | 2 | 2 | no |
| 3 | 3 | 3 | no |
| 4 | **4** | 4 | 5×5 only |
| 5 | — | 5 | no |
| 6 | — | **6** | 7×7 only |
| 0 | **8** | **12** | **yes** |

There is **no cap** on consecutive bonus throws.

**Banked throws**

- Keep throwing while you roll the two bonus values. Every throw is banked rather than
  played immediately
- Once you roll a 1, 2 or 3, spend the bank: assign each banked throw to **any**
  of your pieces, in **any** order
- You must use every banked throw that has a legal move. A throw with no legal
  move anywhere is skipped
- Order matters and is yours to choose — a throw that looks dead can come alive
  after another throw captures and unlocks your inner rings
- A capture earns another throw, which joins the bank mid-spend

**Orientation** — the board turns so that your own start square is always the one
nearest you. Everyone sees their own colour at the bottom.

**Movement**

- Every piece begins **on** your start square. There is no separate entering
  move, so a roll of 2 always moves two squares
- No piece may enter an inner ring until your side has captured. The unlock is
  **per player, not per piece**: once *any* of your pieces captures, *all* of them
  are permanently free to go inside
- Your own pieces never block each other. They share squares freely and move
  independently — a stack is not a unit
- Reaching the centre needs the exact count; overshooting means that piece simply
  cannot use that throw
- If you have a legal move, you must make it

**Capturing**

- Landing exactly on an opponent's piece sends it back to their own start
  square, and you throw again
- Landing on a square holding several opponent pieces sends **all** of them back

**Winning**

- First player with every piece on the exact centre takes 1st place
- The game then asks whether to **play on** for the remaining places. Play on and
  the finished player drops out while the rest race for 2nd, 3rd and 4th
- Play can stall: two players each one square from home, both needing an exact
  count, can sit for several rounds. After two rounds with nobody moving, a
  **Call it a tie** button appears in the corner of the sidebar. Ignore it and
  simply keep throwing, exactly as you would at a real board; it disappears
  again the moment a piece moves
- Online, a tie is **agreed rather than declared**, as at a chess board. Asking
  puts it to the others: two of two, two of three, or three of four carries it.
  Three voters is reachable at a four-player table where one seat is a computer.
  Everyone else gets a notice saying who asked and where the vote stands, and
  pressing again withdraws your own. Computer players and anyone already home
  get no say. Playing on this device alone there is nobody to ask, so it simply
  ends

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
- **A backgrounded tab is not a disconnection.** Browsers throttle timers in a
  hidden tab to almost nothing, so both sides stop hearing from each other while
  the connection is fine — which used to leave a game left alone reporting that
  everybody had disconnected, with no way back. Returning to the page forgives
  the silence rather than counting it, and a guest whose connection really did go
  redials the host up to four times and takes its seat back before anyone is told
  anything is wrong.
- Matchmaking runs on PeerJS's free public cloud. It occasionally has downtime,
  and when it does a room code simply will not connect.
- **There is no TURN relay.** STUN tells each browser its own public address and
  the two then try to reach each other directly, which works on most home
  networks and fails on mobile carriers and on any network with client
  isolation — where two devices on the same Wi-Fi are deliberately kept apart.
  The three relays that used to be listed are dead: `eu-0.turn.peerjs.com` and
  `us-0.turn.peerjs.com` no longer resolve in DNS, and `openrelay.metered.ca`
  answers on no port. They were removed rather than left in, because a dead
  relay is worse than none — the browser waits on it during gathering and gets
  nothing back.
- **A Metered relay is configured**, so a connection that cannot be made
  directly is carried by a relay instead. `RELAY` at the top of `js/net.js`
  holds the app subdomain and a credential-scoped `apiKey`; the ICE servers are
  fetched with it at connect time, because Metered issues short-lived
  credentials and a fetched one is always current.
- Metered issues **three kinds of key** and only one of them belongs in a public
  file. The `apiKey` here is credential-scoped and can do nothing but fetch an
  ICE config. The account `secretKey` — which creates and deletes credentials —
  lives in Dashboard → Developers and must never be committed; a test fails if
  anything is ever assigned to one in the files the site serves. Note that an
  `apiKey` does not exist until a credential is created, which is why an
  otherwise valid-looking account gives `401 Invalid API Key`.
- Every way the fetch can fail — no key, refused, an HTTP error, an empty
  answer, no answer within four seconds — falls back to STUN rather than
  stopping a game from starting. A ready-made server list can be pasted into
  `RELAY.servers` instead, and is then used with no request at all.
- The lobby's connection log says which kinds of route were found. `host` and
  `srflx` mean the two are trying to reach each other directly; `relay` means a
  TURN server answered. A log that reaches `network path: disconnected` without
  ever saying `connected`, and reports no relay, is this problem and not a bug
  in the game.

## Artwork

The cowries, pieces, board tile, centre and mat are generated images, processed
into game assets by `tools/process-art.py`. That script exists because the raw
output needs three things undoing: a watermark near one edge, no alpha channel,
and the occasional stray second object. It crops the outer band away, keys out
the flat magenta backdrop, pulls the colour fringe off the edges, keeps only the
largest connected shape, and squares everything up.

```sh
python3 tools/process-art.py "~/Downloads/CHOWKA-BHARA IMAGES"
```

Textures ship as JPEG since they carry no transparency; the whole set is about
800 KB. Every image sits on top of the colour it replaced, so a slow or missing
asset degrades to the original drawn look rather than to nothing. The safe-square
diamond is applied as a CSS mask, which lets one picture take each player's
colour instead of shipping four tinted copies.

## Layout

```
img/                the artwork, built by tools/process-art.py
tools/process-art.py
index.html          markup only, ~210 lines
css/
  tokens.css        reset, palette, page ground
  layout.css        page shell, panels, the game-screen grid
  screens.css       setup screen controls
  board.css         the board, its squares, the pieces on them
  sidebar.css       cowries, throw button, banked throws, roster, log
  online.css        lobby, seats, overlays, how-to-play drawer
js/
  i18n.js           translation tables and lookup
  a11y.js           text size, contrast, movement, notices
  seats.js          player names and colours
  net.js            the online protocol, transport-agnostic
  config.js         shared configuration and game state
  path.js           board geometry — the ring walk to the centre
  rules.js          throws, legal moves, the banked-throw pool
  ai.js             the computer opponent
  render.js         drawing board, sidebar and cowrie animation
  game.js           setup, turn flow, placings
  online.js         lobby, seats, snapshots, liveness
  main.js           language switching and start-up wiring
test/               eight suites, run with ./test/run.sh
vendor/peerjs.min.js
```

Stylesheets load in cascade order; scripts load in dependency order with
`main.js` last, since it is the only one that runs anything at load time. They
are plain scripts rather than ES modules on purpose: the game still opens by
double-clicking `index.html`, with no server and no build step.

## Setting up a game

Three tabs: **On this device**, **Host online**, **Join online**. Each shows only
what it needs, and each has its own start button rather than one that changes
label depending on hidden state.

Board size and player count belong to both playing tabs. Rather than two copies
that can quietly disagree, the single block of controls is moved into whichever
tab is showing, which preserves its state for nothing.

## Accessibility

An **Accessibility** panel — a drawer that covers the screen until it is
closed — reachable from the setup screen and from the sidebar mid-game — because discovering you need one of these usually happens while you
are playing. Everything is remembered per browser, and anything the operating
system already asks for is honoured as the default.

| Setting | What it does |
| --- | --- |
| **Text size** | Normal, Large, Largest — up to 132%. Every font size in the project is in `rem`, so one root change moves all of it together, and the sidebar widens to match |
| **Contrast** | Darkens the board so the pieces stand off it |
| **Movement** | Stops the tumbling cowries and sliding pieces. This reaches the game's own animation timings, not only the CSS |
| **Connection details** | Whether the technical log under the lobby seats is always on show, or only once something goes wrong |

A **Game log** panel beside How to play keeps every line of a game — every throw, every
capture — and can be **stepped through**. Arrows walk a line at a time, any line can be
clicked, and a button returns to the present. Every line stores where the pieces stood and
what the cowries showed, so stepping back moves the board and the shells to that moment.
The game itself is untouched: nothing can be played from the past, live redraws hold off
while you read, and closing the panel comes back to now. The sidebar log and the panel
render from the same entries, so they cannot disagree.

**Names and colours** are chosen in Settings. On this device one person names every seat; online you name only your own, because the others are being named by the people sitting at them. A colour identifies a piece on a board everybody is looking at, so online the **host settles them** — a guest's choice is a request, two players asking for the same colour are separated, and what the host sends back is what every screen draws.
| **Pop-up notices** | The bar that slides across the top of the board when something happens on another player's turn. Fade after a few seconds, or stay until closed |
| **Language** | English, ಕನ್ನಡ, हिन्दी, Español — it belongs with the other display settings |

Each text-size option is drawn at the size it selects, so the choice shows itself
rather than being described.

High contrast keeps the artwork rather than replacing it. A translucent scrim
sits over each square, between the painted texture and the pieces — the board
recedes, the pieces do not dim, and the photographs are still visible
underneath. Against that scrimmed board every piece clears **4.5:1**, which is
the floor for text rather than the 3:1 floor for shapes, because a piece on a
textured board is harder to pick out than a letter on a flat one.

Two things the tests guard, because both would fail silently. `contrast-test.js`
reads the real colours out of the stylesheet and recomputes the ratios, so a
retuned colour that drops below the line fails the build. `a11y-test.js` checks
no stylesheet has introduced a `px` font size, which would be text that quietly
stops scaling.

## Languages

English, ಕನ್ನಡ, हिन्दी and Español, chosen in the setup screen and remembered per
browser. It defaults to your browser's language when that is one of the four.

The choice is **entirely client-side**, so two people in the same online game can
read it in different languages. Anything that crosses the network — log lines
especially — travels as a key plus values and is rendered locally, never as
finished English. Player names are keys too, so Turmeric reads as ಅರಿಶಿನ or
हल्दी depending on who is looking.

The non-English translations were written by Claude and have not been checked by
a native speaker. Corrections welcome — they all live in `js/i18n.js`, one table
per language, same keys throughout.

## Releasing

```sh
python3 tools/stamp-assets.py 1.5.2      # before tagging
```

Every stylesheet and script is loaded with a `?v=` matching the release. Without
it a browser can pair a freshly fetched `index.html` with a script cached from an
earlier release — new markup, old code, a combination nobody ever tested. That
once left the setup screen with no text at all: the old script called a control
the new markup had dropped, threw, and never reached the line that fills the
words in.

Startup is also ordered so the words go in before anything that can throw, and
listeners attach only if their element is really there. A stale script should
cost one button, not the whole screen.

## Tests

The logic is verified headlessly. The tests read the real function source out of
`index.html`, so they exercise shipping code rather than a copy.

```sh
./test/run.sh
```

| Suite | Covers |
| --- | --- |
| `rules-test.js` | Path geometry, both throw tables over 200,000 throws each, the odds the computer uses matching the cowries, entering, the inner-ring gate, overshoot, exact finish |
| `cpu-test.js` | Takes free captures, avoids covered squares, takes winning moves, no double-counted threats, ~9,600-position fuzz |
| `turn-test.js` | Banked throws stay independent, unplayable throws skip, a mid-turn capture unlocks the rest, selection handling, placement ordering |
| `i18n-test.js` | Every language covers every key, placeholders line up, nothing copies English, no key the game asks for is missing |
| `contrast-test.js` | Every piece clears 4.5:1 against every ring under the scrim, sidebar text clears 7:1, nothing leaks outside `.hc` |
| `a11y-test.js` | All four settings exist and persist, every font size is relative, reduced motion reaches the game's timings and still marks playable pieces, every label present in all four languages |
| `net-test.js` | Seat claiming, ready gating, turn ownership, snapshot fan-out, disconnect/pause, rejoining, CPU substitution, room-code hygiene, and that no lobby label is written straight into the page |
| `render-test.js` | Board drawing against a small stub document: redrawing never multiplies the pieces, a piece is drawn where it stands rather than where it began, and the seat colour rules — a taken colour trades rather than clones, a corrupt saved file is repaired |

`net-test.js` runs the real sync layer over an in-memory transport, with two fake
browsers talking to each other. **It does not and cannot test the peer connection
itself** — that needs two real devices. `js/net.js` is deliberately split so the
part that can be tested is as large as possible and the WebRTC adapter is as thin
as possible.

### Path geometry

One rule decides the whole route: **a lap runs in whichever direction brings it
back to the player's own side of its ring, and turns inward from there onto a
corner of the next ring in.** The visit order for a player entering from the top
edge:

```
5x5 — 25 steps                7x7 — 49 steps
  2  1  0 15 14                 3  2  1  0 23 22 21
  3 22 23 16 13                 4 36 37 38 39 24 20
  4 21 24 17 12                 5 35 46 47 40 25 19
  5 20 19 18 11                 6 34 45 48 41 26 18
  6  7  8  9 10                 7 33 44 43 42 27 17
                                8 32 31 30 29 28 16
                                9 10 11 12 13 14 15
```

Both boards use every square exactly once, and no square is walked twice.

**Direction** follows from the rule rather than being imposed on it. On 5x5 it
works out as strict alternation — outer ring anti-clockwise, inner ring
clockwise. On 7x7 the two inner rings come out running the same way, because
that is what brings each of them home to the near side.

**The one diagonal.** Entering at a corner keeps both boards reading alike, but
a full 24-square outer lap on 7x7 ends at column 4 while the inner ring's
corners are at columns 1 and 5 — so no orthogonal step reaches one. Step 23 to
24, `(0,4)` to `(1,5)`, is therefore diagonal: the only such step on either
board. The alternative was to leave a square unvisited or walk one twice, and a
single diagonal onto a safe corner was judged the smaller oddity.
