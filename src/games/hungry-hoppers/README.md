# Chomp

(Folder and id are still `hungry-hoppers` so the registry doesn't change.)

2–4 players, 50 seconds. Marbles roll around a round bowl. Each player is a round, one-eyed
monster on the rim (2 players: left and right; 3–4: the corners).

**Controls:** tap anywhere in your half (2 players) or your corner (3–4) to chomp. Your
monster's mouth lunges toward the centre for about 0.35s and swallows everything in reach.
You can't chomp again until the lunge finishes. Stop tapping to gulp. Mash while stunned to
shake it off faster.

**Marbles:**

- White = 1 point
- Gold = 8 points. Rare, fast, and it glints. Eating one gets a big GOLD! callout.
- Bomb (black, red ring, lit fuse) = you BARF and you're stunned (about 1.2s, each tap
  while stunned shaves 0.15s off)

**The belly (signature twist):** nothing you eat is yours yet. It sits in your belly, visible as
marbles rattling inside your swelling body and as `BELLY +pts xN` under your score. Every 4
marbles in the belly adds +1x to what the *next* marbles are worth, up to x4. To bank it you have
to **hold still**: 0.75s without chomping fills the gold ring around your body and you GULP the
whole belly into your score. Eat a bomb and you **barf** the whole belly back into the bowl (the
marbles spray toward the middle, golds included) for everyone else to eat. So every few chomps
you decide: gulp now, or keep stuffing at x3 with a bomb drifting past.

**Tilt (comeback):** when the leader is 6+ points ahead the bowl tilts toward whoever is last.
Marbles roll downhill (chevrons in the trailing player's colour show the slope, "TILT" points at
them); the tilt is strongest at a 48-point gap and levels out when last place is tied. Bombs
don't roll downhill, so the pile at the trailing player's rim is food.

**Frenzy waves** at 12s and 26s flood the bowl with 24 marbles plus a gold. **OVERDRIVE** for
the last 10 seconds: double points, faster marbles, more gold, two golds in the opening wave.

**Buzzer:** when time runs out only *half* of whatever is still in your belly counts, so gulp
before the end ("GULP NOW!" flashes with 2.6s left). Most points wins. Human seats keep a
personal best (`c5-best-hungry-hoppers-v2`) and get a NEW RECORD callout when they beat it.

Bots chomp when food is near their mouth after a short reaction delay (with the odd hesitation),
hold still to gulp once their belly reaches a personal threshold of 5–11 marbles, always gulp
before the buzzer, mash when stunned, and taunt ("MINE!", "FREE LUNCH!", "YUM!"). They usually
hold off when a bomb is in reach, but now and then they get greedy.

## Inspired by

Mechanic inspired by the board game Hungry Hungry Hippos (Hasbro) crossed with push-your-luck
banking games: the belly is a pot you keep raising until you cash out or bust. Our own design,
characters and art, written from scratch for C5.
