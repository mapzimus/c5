# Block Brawl

Chain clears. Pop power cells. Bury everyone.

Versus falling blocks for 2–4 players, all at once, each in their own 10x20 well.

- Everyone gets the **same** block sequence (shared seed, 7-bag), so it's fair.
- Blocks fall faster over time.
- Clear 2 / 3 / 4 lines at once to send 1 / 2 / 4 garbage lines (each with one random hole)
  to a random rival who's still in. Garbage lands when that rival's current block locks
  (a red bar beside their well shows what's coming).
- **Chain:** clear lines on back-to-back drops to build a chain (shown big in your well).
  Every 2 links adds +1 garbage (x2 +1, x4 +2, x6+ +3), so even single-line clears hit hard
  once you're rolling. A drop that clears nothing breaks the chain.
- **Power cells:** about 1 block in 6 carries a glowing cell (same blocks for everyone, and
  the NEXT preview shows it). Clear the row it sits in and every rival gets hit with one of:
  - **INK** (5s): blots over their board and hides their NEXT preview.
  - **RUSH** (3.5s): their blocks fall 5x faster.
  - **FLIP** (5s): left/right and rotation are reversed.
- **High stakes:** a dashed line sits halfway up every well. Clear lines while your stack
  reaches it and the line garbage doubles. Stack high to hit hard, stack low to stay safe.
- **Underdog:** the living player strictly last on lines, 3+ behind the leader, sends +1 on
  every attack.
- **Overdrive and the tide:** at 50s blocks fall faster and the TIDE rises: a garbage row lands
  in every living well every 3s, speeding up to every 1.5s by the 90s limit.
- **Ghosts:** stack past the top and you're not done. Your lane becomes a ghost console: tap a
  rival's name to drop one garbage row on them, every 5s. Bot ghosts usually haunt the leader.
- Last one standing wins. At 90s the most lines cleared among those still in wins.

## Controls

Touch, inside your own lane:

- **Tap** = rotate
- **Drag left/right** = move one cell per cell-width dragged
- **Swipe down** = hard drop

Out of the game: tap a rival's name in your lane to haunt them.

Keyboard (optional, per seat binds from the menu): left/right = move, up = rotate,
down = soft drop, action key = hard drop.

Bots try every rotation and column, score each result (height, holes, bumpiness, lines,
plus a bonus for clearing power cells), then steer there at a human-ish pace and drop.
INK and FLIP slow their hands down; RUSH hits them just like humans.

## Credit

Inspired by [jakesgordon/javascript-tetris](https://github.com/jakesgordon/javascript-tetris)
(MIT, Copyright (c) 2011-2016 Jake Gordon and contributors). Written from scratch for C5.
