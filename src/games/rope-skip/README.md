# Rope Riot

One player turns a giant rope, everyone else skips it and decides, clear by clear, whether to
keep their pot on the line or bank it.

- Each round one player is the **Spinner**. Rounds rotate so everyone spins once (3-4 players);
  a 2-player duel goes two rounds each. Solo is one round against a CPU spinner.
- **Spinner:** drag in circles on the ring at the right. The rope's speed follows how fast your
  finger goes round, clamped so it never stops (and never gets impossibly fast). Speed up, slow
  down or hold still to stutter and bait bad jumps. Let go and the rope keeps its last speed.
- **Jumpers:** tap the left part of your strip to jump (fixed ~0.45s hop, no double jump). If the
  rope sweeps the bottom while you're on the ground, you're out for the round.
- **The pot (push your luck):** every clear adds **+1** to the POT floating over your head. Tap
  **BANK** on your strip to cash it in and hop out, safe for the rest of the round (mid-air taps
  bank on landing). Stay in and survive the 15s round for **pot +5**. Get swept and you lose the
  whole pot: the spinner **steals it, +2** on top.
- **Overdrive:** the last 5s of every round. Clears pay **+2**, the rope's slowest speed rises and
  the arena glows. The best moment to be greedy is also the most dangerous.
- **Ghosts (nobody sits out):** swept and banked jumpers float above the rope as ghosts. Tap your
  strip to **WHIP**: the ghost grabs the rope down to a crawl for 0.4s, then it snaps round faster
  than the spinner alone can turn it. 3s cooldown. A ghost whose whip is live when someone gets swept
  earns **ASSIST +2**.
- **Safety net (comeback):** from round two, whoever is in last place starts the round with a net:
  their first sweep is a stumble (half the pot goes to the spinner) instead of a knockout.
- A round ends early once nobody is left skipping. Highest total after all rounds wins (ties share it).
- Streak milestones every 5 clears get a fanfare; clearing by a hair sparks a "SO CLOSE". The
  biggest pot a human banks is kept as a personal record (`c5-best-rope-skip-v2-pot`).

Bot spinners follow a random schedule of cruising, bursts and stutters and get burstier when a big
pot is on the floor. Bot jumpers take off about 0.2s before the rope reaches them, read the rope's
speed with a quarter-second lag (so stutters and whips can fool them), make the occasional mistime,
and bank once their pot passes a nerve threshold rolled each round. Bot ghosts whip on the approach.

## Inspired by

Inspired by the playground long-rope game and the party-game staple where one player turns the rope
while the rest jump it (mechanic only), crossed with push-your-luck banking games where every extra
turn risks the whole stake. Original design and code; no art, audio or code was copied.
