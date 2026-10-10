# Block Brawl

Versus falling blocks for 2–4 players, all at once, each in their own 10x20 well.

- Everyone gets the **same** block sequence (shared seed, 7-bag), so it's fair.
- Blocks fall faster over time.
- Clear 2 / 3 / 4 lines at once to send 1 / 2 / 4 garbage lines (each with one random hole)
  to a random rival who's still in. Garbage lands when that rival's current block locks
  (a red bar beside their well shows what's coming).
- Stack past the top and you're out. Last one standing wins. If 3 minutes pass, the most
  lines cleared among those still in wins.

## Controls

Touch, inside your own lane:

- **Tap** = rotate
- **Drag left/right** = move one cell per cell-width dragged
- **Swipe down** = hard drop

Keyboard (optional, per seat binds from the menu): left/right = move, up = rotate,
down = soft drop, action key = hard drop.

Bots try every rotation and column, score each result (height, holes, bumpiness, lines),
then steer there at a human-ish pace and drop.

## Credit

Inspired by [jakesgordon/javascript-tetris](https://github.com/jakesgordon/javascript-tetris)
(MIT, Copyright (c) 2011-2016 Jake Gordon and contributors). Written from scratch for C5.
