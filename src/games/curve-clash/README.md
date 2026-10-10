# Curve Clash

**Draw the line. Don't touch one.**

2–4 players. You're a line that never stops moving and leaves a trail behind it.
Hit a wall or any line (your own too) and you're out. Small gaps open in every line
every 2–3 seconds, so you can slip through. Last line alive takes the round; first to 3 rounds
(2 rounds with 3+ players) wins the match. Lines slowly speed up as the round goes on.

## Twists

- **Power-ups** appear on clear ground every few seconds (max 2 at once). Drive over one to grab it:
  - **W · WIPE** (yellow) wipes every line off the board.
  - **P · PORTAL** (purple) turns the walls into portals for everyone for 5 s. Leave one side, come in the other.
    The border goes dashed and blinks just before it ends.
  - **G · GHOST** (white) for 3 s: you leave no line and pass straight through lines (walls still kill).
    Your head blinks faster in the last second, and the ghost never ends while you're sitting on a line.
- **Near misses.** Skim past a line without touching it: +1 for close, +3 for a razor-thin skim.
  The bonus only banks if you're still alive a beat later. Parallel-riding a line counts once.
- **Walls close in.** 22 s into a round the arena starts shrinking from every side. It stops at a
  small box, so every round ends in a squeeze. Power-ups caught outside the walls vanish.

**Score:** 100 per round won + 10 per rival outlasted + near-miss points.
Stats: rounds won, near misses, power-ups grabbed.

**Controls:** hold the ◀ / ▶ buttons in your corner (P1 bottom-left, P2 bottom-right,
P3 top-left, P4 top-right). Keyboard: your seat's left/right keys (A/D, ←/→, J/L, F/H).

**Bots** cast rays left/straight/right on the occupancy grid and steer toward open space.
They chase the nearest power-up (within ~420 px) only while the heading toward it is clear.

## Code

- `curve-clash-logic.ts` – DOM-free: trail grid (with shrinking walls), raycasts, bot steering,
  spawn/pickup placement, portal wrap, near-miss check, arena shrink curve. Unit tested.
- `curve-clash.ts` – the game: input, simulation loop, rendering, juice.
- `curve-clash.test.ts` – headless bot matches play through to a winner.

## Credits

Inspired by [Achtung, die Kurve!](https://github.com/stravid/achtung-die-kurve) (MIT),
Copyright (c) 2010 Mathias Paumgarten & David Strauß. Written from scratch for C5.
