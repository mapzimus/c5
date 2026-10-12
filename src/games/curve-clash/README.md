# Curve Clash

**Draw the line. Close the loop.**

2–4 players. You're a line that never stops moving and leaves a trail behind it.
Hit a wall, a rival's line, a rival's ground or fresh wraith ink and you're out. Small gaps open
in every line every 2–3 seconds, so you can slip through. Three rounds; the last line alive takes
each round, and the **final round scores double**. Most points after three rounds wins.
Lines slowly speed up as the round goes on.

## The twist: close the loop

Your **own line never kills you**. Cross it and you close a loop: everything inside becomes your
ground (filled in your colour), every line inside vanishes, power-ups inside are yours, rivals'
ground inside is stolen, and **any rival caught inside is TRAPPED** and out of the round.
You can drive on your own ground; rivals die on it ("FENCED"). So every few seconds you decide:
a tight, safe little loop for a few points, or a big greedy one that might swallow somebody.
Bots curl into loops of their own now and then.

## Losers stay in: wraiths

Die with two or more rivals still alive and a second later you're back as a **wraith** (same
corner buttons): a pale wisp that passes through everything and lays ink in bursts. Fresh ink
kills the living for ~2 s, then fades. Kill someone with it and you score a **HAUNT**.
Bot wraiths chase where the nearest survivor is heading, with a bit of hesitation.

## Other twists

- **Power-ups** appear on clear ground every few seconds (max 2 at once). Drive over one or loop it:
  - **W · WIPE** (yellow) wipes every line off the board (ground stays).
  - **P · PORTAL** (purple) turns the walls into portals for everyone for 5 s.
  - **G · GHOST** (white) for 3 s: no line, pass through everything but walls, can't be trapped.
- **Near misses.** Skim a rival line without touching it: +1 for close, +3 for a razor-thin skim,
  banked only if you're still alive a beat later.
- **Walls close in** 16 s into a round (8 s in the final), down to a small box.

**Score:** 60 per round won, 10 per rival outlasted, 2 per % of the board claimed, 40 per trap,
25 per haunt, 15 per rival that dies on your ground, near-miss points. Everything doubles in the
final round. Human seats get a "NEW RECORD" callout for their best match score.
Stats: rounds won, ground claimed, kills (traps + haunts + fenced).

**Controls:** hold the ◀ / ▶ buttons in your corner (P1 bottom-left, P2 bottom-right,
P3 top-left, P4 top-right). Keyboard: your seat's left/right keys (A/D, ←/→, J/L, F/H).
The same buttons steer your wraith.

**Bots** cast rays left/straight/right on the occupancy grid and steer toward open space.
They chase the nearest power-up (within ~420 px) only while the heading toward it is clear.

## Code

- `curve-clash-logic.ts` – DOM-free: occupancy grid (trails, claimed ground, fading ink, shrinking
  walls), polygon fill / point-in-polygon / loop detection, raycasts, bot steering and curling,
  wraith steering, spawn/pickup placement, portal wrap, near-miss check, scoring. Unit tested.
- `curve-clash.ts` – the game: input, simulation loop, rendering, juice.
- `curve-clash.test.ts` – headless bot matches play three rounds through to a winner.

## Inspired by

Achtung, die Kurve! and its many clones: the ever-moving line, the gaps, the last-one-alive round.
The loop claim comes from territory games such as Qix, flipped so that the loop is closed by your
own line rather than a wall; the wraiths are the party-game answer to watching from the bench.

## Credits

Inspired by [Achtung, die Kurve!](https://github.com/stravid/achtung-die-kurve) (MIT),
Copyright (c) 2010 Mathias Paumgarten & David Strauß. Written from scratch for C5.
