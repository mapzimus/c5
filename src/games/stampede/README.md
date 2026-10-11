# Stampede

A 2–4 player survival dodge on a five-lane ice floe, everyone at once. Each player is a round critter
standing on the left third of the screen; herds of fat sliding critters barrel in from the right, one
lane each.

- Lanes are horizontal bands. The screen is split into one vertical touch zone per player: tap the
  **top half** of your zone to hop up a lane, the **bottom half** to hop down. Swiping up/down works too.
- Hops take 0.15s with a little squash. Hopping past the top or bottom lane just bumps you.
- Every wave leaves at least one lane safe. Waves get faster and thicker over the round.
- After 20s **BIG ONES** show up: fat critters that cover two lanes.
- After 30s a **STAMPEDE!** wall fills every lane but one, repeating every 7s.
- Get hit and you're bulldozed off the left edge, spinning into the water: out for the round.
- A round ends when one player is left standing (they win it), when everyone is out (the last to
  fall wins; a simultaneous fall shares), or at 45s (all survivors share the win).
- First to 2 round wins takes the match, max 5 rounds. Score = round wins. Stat: longest survival.
- Bots watch the nearest incoming critter in their lane and hop to the safest adjacent lane when it
  will arrive within 0.6–1.1s (per-bot reaction noise), with a 10% chance to misjudge and hop randomly.

## Inspired by

The mechanic is inspired by the Pushy Penguins minigame in Nintendo's *Mario Party* series.
This is our own design: no names, art, code or audio were copied.
