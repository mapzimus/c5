# Parrot Flip

Port of [Whydah-Unit parrot-flip](https://github.com/mapzimus/Whydah-Unit/tree/main/parrot-flip)
(MIT): the same Matter.js flick physics and macaw art, played with the bottle-game rules from
[flipgame](https://github.com/mapzimus/flipgame) and a party layer on top. Registered as
`parrot-flip`; uses the shared canvas, roster, seeded RNG, synth audio and session scoring.

Parrot Flip opens on a Classic / Duel choice (an all-bot table goes straight to Classic).

## Classic: walk the perch

- Take turns. Flick **up** on the parrot to flip it; a harder snap is more spin. Flick a little
  sideways to steer where it lands. 6 lives each, 10 head to head.
- Every make adds to the **shared stake**. A miss costs the flipper the stake (at least 1 life),
  then the stake resets. 2 makes in a row = Heating up, 3 = **ON FIRE**: every make is +1 life,
  a miss is free and just ends the run. The fire carries over to your next turn.
- **The perch (the signature twist).** A glowing plank on the ground moves to the other side
  before every flip. Land the parrot standing on it and the make is **golden**: stake +2 (or +2
  lives on fire). The seat with the fewest lives flips at a 1.5x wider **underdog perch**, so
  last place always has a shot back.
- **Rounds.** Everyone flips once per round: 10 rounds for 2 players, 7 for 3, 5 for 4. The
  last two rounds are **OVERDRIVE**: misses cost +1 and the stake never resets, so the final
  flips are the biggest. After the final round the most lives wins; last one standing ends it
  early.
- **Ghosts (losers stay in).** 0 lives knocks you out, but your seat becomes a ghost panel.
  Before every flip, call it: tap **MAKE** or **MISS** (or press your seat's up / down key).
  Calls lock when the parrot touches down. A correct call is a doubloon, which ranks the
  ghosts; **three correct calls in a row brings you back from the deep on one life**, once per
  match.
- Feedback: "SO CLOSE!" when the parrot touched down nearly upright and tipped over; every
  other miss names its cause (TOO SOFT, OVER-SPUN, UNDER-SPUN, TIPPED OVER, WOBBLED OUT);
  "MAKE IT OR YOU'RE OUT" slow-mo before a knockout flip; each human sees their last-10 make
  rate; the longest ON FIRE run is a per-browser record (`c5-best-parrot-flip-fire-v2-perch`,
  humans only, "NEW RECORD!").
- Bots flick near the sweet spot with normal scatter, aim for the perch just under half the
  time (usually when they are the underdog) with human-sized error, and hesitate on a
  must-make flip. Bot ghosts
  lean MAKE, more so when the flipper is hot, and taunt when a MISS call lands.
- Results: survivors score 20 + lives; ghosts score by doubloons, then by how long they
  lasted. Stats show makes / attempts and perch landings.

## Duel

Two players flip at once on a split screen, each on their own half (multi-touch). Both make =
stake +2; anyone who misses pays the stake, then it resets; both miss = both pay. ON FIRE,
golden flips (1 in 150) and sudden death after 40 flips work as in the original rules. Both
knocked out in the same round = DOUBLE KO, both come back on one life. With 3-4 players the
winner stays on and the next player steps in for whoever is out.

## Inspired by

The flick-and-land loop is the bottle-flip challenge, here with a pirate macaw; the shared
stake, heating up and ON FIRE run come from the author's own flipgame. The perch is our take on
a called target in a landing game, and the ghost calls nod to the "bet on the survivor"
spectator mechanics of party games. Original names, procedural canvas art and synth audio only.
