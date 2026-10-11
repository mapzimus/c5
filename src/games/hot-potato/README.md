# Hold It! (id `hot-potato`)

2–4 players sit in a ring around the screen: each seat gets its own touch zone (left/right halves for 2, two top quadrants and the bottom half for 3, quadrants for 4), with that player's colour, name, hearts and a little blob character.

## Rules

- A lit cartoon bomb with a **hidden fuse** starts in a random player's hands. The fuse hisses faster, the heat glow grows and the bomb (and its holder) shake more as time runs out. No timer is shown.
- **Tap your zone** to pass: the bomb arcs (~0.35s) to a **random** other living player.
- **Hold your zone** for 0.5s to aim: a pointer in your colour sweeps around the ring and the player it points at gets a dashed ring. Release to throw at them.
- **Signature twist – charge to stick.** A charge ring fills around whoever holds the bomb. Hold it (finger down, bomb in hand) for **1.5s** and your throw is **STICKY**: the catcher's hands are glued for 1s and they cannot pass. Hold **3s** and it is **GLUE**: stuck for 2s. The fuse is hidden, so every charge is a bet on how much time is left. The catcher can **mash** their zone to wiggle free a little faster (0.1s per tap).
- You cannot pass while a bomb is in the air; it has to land in your hands first.
- **Hearts.** 2 players have 4 hearts each, 3 players have 3, 4 players have 2. Whoever is holding a bomb when it blows (or has it flying at them) loses a heart: shake, flash, soot, hit-stop.
- **Comeback – hot hands.** On your last heart you charge 1.5× faster (a flame burns on your head): sticky at 1s, glue at 2s.
- **Ghosts – losers stay in.** Lose your last heart and you float back as a ghost in your zone. **Tap** your zone to **haunt** a random living player, or hold to aim and release to pick one: their hands **freeze** for 0.8s (4s cooldown, and a thawed player is immune for 1.5s). If your victim blows up while frozen or within 1.2s of thawing you get the **spook** credit ("SPOOKED BY …").
- **Escalation.** Fuses shorten (6–11s → 4–7.5s) and duds get rarer with every blast. When exactly two players remain, both on their last heart, it is **SUDDEN DEATH**: red ring, 4–7s fuses, no duds or splits.
- **Duds** (20% at first): the bomb fizzles with a puff of smoke, nobody is hurt, and a fresh (guaranteed live) bomb appears a moment later.
- **Splits** (15%, only with 3+ living players): 3 seconds after lighting, the bomb clones itself and the twin flies to someone else. Both are live, each with its own fuse.
- **Near miss:** throw a bomb that blows on the next person within 0.7s and you get a "SO CLOSE!" callout.
- **Nerve record:** your longest single hold that you got rid of in time is your Nerve. Human seats save their best (2s or more) under a versioned key and get a "NEW RECORD" callout.
- Last one with a heart wins. Score is elimination order: first out scores 1, the winner scores highest. Stat: **Nerve** (plus spooks for ghosts).
- Bots throw after 0.4–1.5s on a hot bomb, gamble on a sticky (sometimes a glue) 45% of the time when the bomb is young, blunder and hold far too long 8% of the time, aim at the leader (most hearts) 35% of the time, and haunt every 3–7s as ghosts. They talk ("heh heh", "TOO HOT!", "uh oh...", "BOO!").

Match length: about 45–90s with 2–4 players.

## Inspired by

Inspired by the playground game Hot Potato, the "the longer you hold, the stronger the throw" push-your-luck of charge shots in arcade sports games, and ghost-spectator mechanics from party games where eliminated players keep sabotaging. This is our own design: no names, art, code or audio were copied.
