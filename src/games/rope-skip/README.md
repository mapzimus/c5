# Rope Skip

One player turns a giant rope, everyone else jumps it.

- Each round one player is the **Spinner**. Rounds rotate so everyone spins once (2 players = 2 rounds, up to 4).
- **Spinner:** drag in circles on the ring at the right. The rope's speed follows how fast your finger goes round, clamped so it never stops (and never gets impossibly fast). Speed up, slow down or hold still to stutter and bait bad jumps. Let go and the rope keeps its last speed.
- **Jumpers:** tap your own strip along the bottom to jump (fixed ~0.45s hop, no double jump). If the rope sweeps the bottom while you're on the ground, you tumble out for the rest of the round.
- Rounds last 15s. Every jumper still standing gets **+1**; the spinner gets **+1 per knockout**. Highest total after all rounds wins (ties share it).
- Solo: one round of jumping against a CPU spinner.

Bot spinners follow a random schedule of cruising, bursts and stutters. Bot jumpers take off about 0.2s before the rope reaches them, with some noise and the occasional mistime.

## Credit

Inspired by the "Chump Rope" minigame from Mario Party 8 (mechanic only). Original design and code; no art, audio or code was copied.
