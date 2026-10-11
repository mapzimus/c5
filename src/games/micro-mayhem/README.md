# Micro Mayhem

A 2–4 player rapid-fire gauntlet of tiny games. The screen is split into one vertical lane per player; everyone plays the **same** microgame at the **same** time in their own lane (same layout in every lane, so it is fair).

- 15 microgames per match. Each one: a 1s card with a single huge word (**POP!**, **SWAT!** ...), then up to 4 seconds of play, then a 0.6s result beat showing **GOT IT** / **MISS** in each lane.
- 1 point per success. The single fastest success that round gets **+1** (shown as **+2** in their lane and a "FASTEST +1" callout).
- Every 5 microgames the speed ramps: 4s → 3.2s → 2.5s, with a **FASTER!** callout. Fly, needle and egg all move faster at higher speed.
- Most points after 15 wins (ties share). Stat: **Fastest win** (quickest success in ms) and games cleared.

## The 8 microgames (one gesture each)

| Card | Gesture | Rule |
| --- | --- | --- |
| POP! | tap | Four balloons, one is rising. Tap the riser. Tapping a still one fails. |
| SWAT! | tap (moving target) | A fly zips between random points. Tap it. Misses don't lock you out. |
| CATCH! | drag | An egg falls; drag the basket under it before it splats. |
| DODGE! | swipe | An arrow flies at your blob; swipe up or down to hop out of the way. |
| MATCH! | tap | Three shapes, one odd colour. Tap the odd one. |
| HOLD! | hold / release | Hold your finger down; the bar fills. Release inside the green band. Overfilling fails. |
| SHAKE! | mash | Tap 8 times to shake the apple off the tree. |
| STOP! | timing tap | A needle spins; tap when it points into the target wedge. |

Order is random each match with no immediate repeats.

## Bots

Each bot gets a per-microgame script: it waits a 200–700ms "reaction" delay, then performs the gesture through the same input path a finger uses. Each script is rolled to succeed about 80% of the time at full speed, dropping to 70% and then ~58% as the timer shrinks. A failing script does something plausible: taps the wrong balloon or colour, swings just behind the fly, overshoots the egg, swipes too late, releases outside the band, mashes too slowly, or stops the needle off target.

## Inspired by

The format is inspired by the microgame structure of Nintendo's *WarioWare* series (one-word instruction, a few seconds, speed-ups) and the reaction minigames of *Mario Party*. This is our own design: no names, art, code or audio were copied.
