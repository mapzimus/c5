# Micro Mayhem

A 2–4 player rapid-fire gauntlet of tiny games. The screen is split into one vertical lane per player; everyone plays the **same** microgame at the **same** time in their own lane (same layout in every lane, so it is fair). Nobody is ever eliminated, but the trailing players carry the two meanest tools in the game.

## Round structure

- 15 microgames per match. Each one: a 1.1s card with a single huge word (**POP!**, **SWAT!** ...), then up to 3.6 seconds of play, then a 0.6s result beat showing what each lane earned.
- Every 5 microgames the speed ramps: 3.6s → 3.0s → 2.4s with a **FASTER!** callout. Fly, needle and egg all move faster at higher speed.
- Microgames 11–15 are **OVERDRIVE**: the arena pulses red and every point (and every penalty) counts double.
- Most points after 15 wins (ties share). Stats: **Fastest win** (quickest success in ms) and **Best heat run** (longest streak).

## Scoring: heat, DOUBLE and the JINX

- **HEAT**: a success scores your heat multiplier. Two wins in a row lights **x2**, four in a row **x3** ("ON FIRE"). Any miss drops you back to x1 ("HEAT LOST"). The three flame pips under your score show it.
- **DOUBLE**: during the card, tap anywhere in your lane to arm **DOUBLE** (tap again to disarm). A success is then worth twice the heat; a miss costs **2 points** (4 in overdrive) and your heat. The lane gets a pulsing gold frame while armed.
- **Fastest +1**: the single quickest success in the round gets +1 (+2 in overdrive).
- **JINX** (the twist): the fastest success also casts a hex at the **highest-scoring rival who is at or above the caster's score** — you can only jinx up, never down. A purple star flies from the caster's lane to the victim's, and the victim's *next* microgame is distorted:
  - **FLIPPED** – the lane is mirrored vertically; the egg falls upward, the arrow comes at a blob that is upside down.
  - **SPINNING** – the whole play area rotates continuously.
  - **TINY** – everything shrinks to 72% around the centre (targets stay at least the minimum touch size).
  - **FOGGED** – the lane is dark except for a spotlight that follows your finger.
  Touch input is warped exactly like the picture, so tapping what you see still works; it is just harder. A jinxed bot succeeds 60% as often.
- **UNDERDOG**: whoever is last and at least 3 points behind the leader doubles for free: a failed DOUBLE costs them nothing. Their lane says so, and bots in that spot gamble almost every round.
- **SO CLOSE**: a release just outside the band, a tap just past the wedge, an egg that grazes the basket, a swipe that started too late or a shake two taps short is called out instead of a plain MISS.
- Human seats keep a personal best score (stored under a versioned key); beating it fires **NEW RECORD!** at the end.

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

Each bot gets a per-microgame script: it waits a 200–700ms "reaction" delay, then performs the gesture through the same input path a finger uses. Each script is rolled to succeed about 80% of the time at full speed, dropping to 70% and then ~58% as the timer shrinks, and to 60% of that when jinxed. A failing script does something plausible: taps the wrong balloon or colour, swings just behind the fly, overshoots the egg, swipes too late, releases outside the band, mashes too slowly, or stops the needle off target. Bots arm DOUBLE a beat into the card, more often when behind, hot, in overdrive or as the underdog, and sometimes taunt ("TOO SLOW!") after a fastest win.

## Inspired by

The format is inspired by the microgame structure of Nintendo's *WarioWare* series (one-word instruction, a few seconds, speed-ups) and the reaction minigames of *Mario Party*; the lane-warping jinx owes something to the screen-flipping items of kart racers and the "punch up only" rule to the catch-up items of the same genre. This is our own design: no names, art, code or audio were copied.
