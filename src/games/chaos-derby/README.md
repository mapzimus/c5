# Chaos Derby

A 2–4 player betting race on one shared screen. Six procedurally drawn runners line up on a side-on track full of hurdles, crates, bananas, mud and hills, then get struck by lightning, carried off by eagles, flattened by boulders and swapped backwards. Nobody steers a runner. Bettors do get a say.

## Single race (default)

- **Place your bets.** Each seat taps a runner (or presses 1–6), in seat order. Every card shows two **traits** read straight off the stats rolled for this race (QUICK, WOBBLY, LIES THERE, BIG ENGINE, …). They are true tendencies, not odds: the chaos still decides who wins. The old made-up odds are gone.
- **The race** runs on a short course (about half a minute). Bad luck hunts the leaders and good luck finds the stragglers, so the running order keeps changing.
- **One CHEER per seat.** Every seat has a panel under the progress bar with a big CHEER button (keyboard: that seat's action key). Spend it once, whenever you like: your runner gets straight back up if they are down, shakes off cramp, pie, dizziness or the wrong-way confusion, and sprints. The further back your runner is, the longer the sprint (2.2 s for the leader up to 4.7 s for last place, an **UNDERDOG ROAR**). Hyped runners also shrug off falls quickly for the duration. Cheer early to escape a pile-up, save it for the final stretch, or wake a napping runner: all three are good at different moments and the game never tells you which.
- **The halfway bell.** When the leader passes halfway, the race drops into slow motion for 5 seconds and every seat can **hedge**: tap one of the chips in your panel (keyboard: 1–6) to back a second runner. You cannot hedge on your own runner. The window closes early once everyone has decided. Bots mostly hedge on the front two, sometimes on a mid-packer, and occasionally dither and miss the window.
- **FINAL STRETCH.** When the leader passes three quarters, the ad boards flash red and random events come 1.6× faster. The crowd goes wild for cheers and the final stretch.
- **Scoring.** Place points are 6 for the winner down to 1 for last. Your main pick pays double place points, your hedge pays single. Two players on the same runner are split by their hedges. Highest total wins the point; the race ends once every runner with money on it has crossed, or 6 s after the winner.
- **Recap.** The results card names the **turning point**: the worst thing that happened to a runner while they were leading (or running second), e.g. "#3 Kevin fell asleep while leading at 18s", or "Clean run" if the winner was never caught.
- **Record.** A human seat's best payout is kept per device under `c5-best-chaos-derby-v2-hedge`; beating it shows NEW RECORD.
- Stats: Backed, Finish, Hedge, and when you spent your Cheer.

Touch targets (the CHEER button and the hedge chips) are at least `minTap`; each seat's panel takes its own pointer, so everyone can cheer at once.

## 3-race cup

Pure luck, no cheering or hedging. One bet, three short heats on an increasingly nasty course (STANDARD, SLIPPERY, CHAOS), cumulative place points 6/5/4/3/2/1. Runners keep their traits across the cup with a small per-heat wobble, so the card you read at the start still means something in heat 3. The seat whose runner has the most cup points wins.

## Files

- `rules.ts` – roster, stat ranges, colour assignment, placings.
- `logic.ts` – traits, cheer timing, hedge window constants, scoring, bot instincts, recap, panel layout (pure; tested in `logic.test.ts`).
- `world.ts` – the matter-js race, events, `cheer()`, `eventBoost`, `trackMul` (tested in `world.test.ts`).
- `chaos-derby.ts` – single race; `cup.ts` – the cup; `draw.ts` – runner art.

## Inspired by

The spectacle of watching helpless runners stumble through a course of absurd hazards is inspired by party-game "watch and bet" races and by televised obstacle shows; in-play hedging is borrowed from live sports betting. The cheer and the halfway bell are our own additions. No names, characters, art, code or audio were copied from any other game.
