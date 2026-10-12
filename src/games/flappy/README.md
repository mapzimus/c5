# Sky Dash

Everyone flies a jet in their own lane on one screen. Tap your lane to climb, let go to drop, thread the neon gates. 75 seconds, highest banked score wins.

## Rules

- **Flying:** one tap = one flap. Touching a gate, the ceiling or the floor is a crash.
- **The run:** every gate you clear adds to your unbanked **RUN** (shown under your jet and top-right of your lane). Coins add 2, a **skim** (clearing a gate edge by a hair) adds 3 and jumps the multiplier a whole level.
- **Multiplier:** every 3 gates in a row raises the run multiplier: x1, x2, x3, x4, x5. The pips under the multiplier show how close the next level is.
- **Split gates (the twist):** every third gate opens wider and is split in two. One half glows gold and says **BANK**; the other says **RIDE**. Fly through the gold half and your run is banked into your score and the multiplier resets to x1. Fly through the other half and the run keeps growing at the higher multiplier. Nothing counts until it is banked.
- **Crashing:** costs one of your 3 lives and the whole unbanked run (you see `LOST 24`). You relaunch 1.2 seconds later, lined up with the next gap and briefly untouchable.
- **Storm cloud (out of lives):** your lane turns into a storm cloud. Tap a rival's button to drop a thunderhead at their altitude at the far edge of their lane; it scrolls toward them like a gate. If it brings a jet down you score +5. One shot every 3 seconds. Bots pick on the leader and wait for a gate to arrive.
- **Underdog:** whoever trails the leader by 15 or more gets +1 to their multiplier until they catch up.
- **Overdrive:** the last 20 seconds are faster, the gaps are tighter and every run gain is doubled. At 10 seconds left you are told to bank it: unbanked points die at the whistle.
- **Ending:** at time, or as soon as only one jet has lives left. The last jet flying banks its run plus 10. Score decides the order; lives left, then unbanked run, break ties.
- **Power-ups:** a shield (S) takes one hit for you, a ghost (G) lets you fly through gates for 3 seconds.
- Human seats keep a personal best banked score (`c5-best-flappy-race-v2-bank`) and get a `NEW RECORD` callout.

## Design notes

- Bots have a nerve value: cowards bank at 12, gamblers wait for 40+, everyone banks at x5 or in the last 9 seconds. They get sloppier as the scroll speed rises.
- Gate gaps are placed so the next one is always reachable (climb at most 150 px/s, drop at most 240 px/s between gates). Narrow lanes (3-4 players) scroll a little slower so everyone gets the same reaction time.
- Logic that does not touch the canvas lives in `logic.ts` and is covered by `logic.test.ts`; `flappy.test.ts` drives whole matches headlessly.

## Inspired by

The tap-to-flap control and scrolling gates are the familiar one-button flying genre. The split BANK/RIDE gates, the lost-on-crash run with a visible multiplier, and the storm-cloud sabotage for eliminated players are original to this game. Original name, procedural canvas art, synthesised audio; no third-party assets.
