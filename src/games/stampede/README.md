# Thin Ice Stampede

A 2–4 player lane-dodge on a five-lane ice floe, everyone at once, scored on points over three short
rounds. Each player is a round critter standing on the left third of the screen; herds of fat sliding
critters barrel in from the right, one lane each.

- Lanes are horizontal bands. The screen is split into one vertical touch zone per player: tap the
  **top half** of your zone to hop up a lane, the **bottom half** to hop down. Swiping up/down works too.
  Hops take 0.15s with a little squash. Hopping past the top or bottom lane just bumps you.
- **Points**: every second standing is +1. Hopping out of a lane less than 0.24s before a critter would
  have hit you is a **CLOSE** call: +2, and consecutive close calls multiply (×2, ×3 … up to ×5) until
  you go down. The last player standing gets **+5**. Highest total after three rounds wins; ties share.
- **Thin ice** (the signature twist): stand in one lane and cracks spread under your feet. After about
  3.2s (2.0s late in a round) the ice gives way and you fall through. Every hop resets the cracks, so
  you are always choosing *when* to move, not just reacting.
- **Revenge riders** (losers stay in): a flattened or sunk player is back on screen one second later as
  a rider at the right edge. Their zone's up/down taps now aim a marker; every 4s a bruiser in their
  colour launches down the marked lane. The lane they are aiming at is tinted as fair warning. A
  rider's critter that flattens someone scores the rider **+4 REVENGE**. Rider critters ignore the
  "one lane is always safe" rule, so the last one standing is never comfortable.
- **Underdog shield**: at the start of rounds 2 and 3, whoever has the lowest total (if they actually
  trail) gets a one-hit shield that pops the critter instead of them.
- Every herd wave leaves at least one lane safe. Waves get faster and thicker over the round; after 6s
  **BIG ONES** cover two lanes; after 11s a **STAMPEDE!** wall fills every lane but one, repeating every
  4.5s. Round 3 is the **FINAL ROUND · OVERDRIVE**: it starts 6s along the difficulty curve.
- Rounds last 20s or until everyone is off the ice. Three rounds, ~70s per match.
- Bots have per-round "bravado" (they hop 0.4–1.0s before impact, so the brave ones farm CLOSE calls
  and die for it), misjudge 10% of the time, and leave cracking ice for whichever neighbour is hit
  latest. Rider bots hunt the current leader, with a 25% wild aim.
- Personal best (human seats only, key `v2-points`): highest match total, with a NEW RECORD callout.
  Stat: close calls.

## Inspired by

The lane-dodge is inspired by the Pushy Penguins minigame in Nintendo's *Mario Party* series; the thin
ice, close-call scoring and revenge riders are our own additions. This is our own design: no names,
art, code or audio were copied.
