# Kaboom Isle (id `kaboom-isle`)

Tap-timed artillery on crumbling floating islands over lava, played by 2-4 people around one touchscreen. Every survivor shoots in the **same volley** from their own panel along the bottom edge, so nobody waits for three other turns.

## Rules

- **Volleys, not turns.** Each round every living player, at the same time: taps one of three random weapon cards in their panel, taps to stop the swinging **aim needle** at their blob, taps again to stop the **power meter**. Shots fly as soon as they are fired, so an early bomb can knock you about while you are still aiming. Bots pick in under a second; humans auto-pick / auto-lock / auto-fire after 5 / 5 / 3.5 s. Keyboard: your seat's action key taps the panel.
- **Weapons:** bomb, bouncer (2.5 s fuse), cluster, triple, boxing glove (huge shove), airstrike, drill, teleporter, black hole, the rare Mega Nuke, and the rubber chicken.
- **HEAT (escalation).** The island heats up every round: damage x1.0, x1.2, x1.4 ... up to x2.2, shown as a meter. From round 4 the **lava rises** each round; round 5 is **OVERDRIVE**. Islands rarely last more than 5 rounds. A maximum of 8 rounds: then highest HP takes the island.
- **Chaos cards** from round 2: low gravity, hurricane, meteor shower, crate rain, bouncy world, earthquake, lava surge, double trouble (two shots each) or a jackpot round (rares only).
- **Signature twist: SWAT.** Everyone gets **one SWAT per island**. When an enemy bomb comes within reach of your blob a dashed ring flashes, time slows for a human seat, and a tap on your blob (or on your panel when you are not aiming; keyboard: your seat's *up* key) bats the bomb back **at whoever threw it at 1.5x damage**. It becomes your shot: damage, KOs and "Swats landed" are yours. Saving it for the nuke or burning it on a bouncer is the decision. Bots swat nukes and boosted shots far more often than small stuff, and sometimes react too late.
- **Ghosts stay in (losers engaged).** Lose your blob and your panel turns into **◀ BLOW / BLOW ▶**: tap (or your seat's left/right key) to gust the wind by 0.45 in that direction, 1.1 s cooldown, capped at ±1.6. Every bomb in the air when you gust carries your mark: if it then hurts someone you get **HAUNTED BY ...** credit and a "Haunts" stat. Bot ghosts gust every 1-2.5 s while bombs fly, usually pushing the wind further from calm.
- **Underdog (comeback).** At the start of each round the lowest-HP survivor, if 25+ HP behind the next, is the **UNDERDOG**: +30% damage and four weapon cards instead of three.
- **Crates** give +35 HP, double damage on the next shot, or a shield that halves one hit.
- **Match.** Two players: first to 2 islands of 3. Three or four players: two islands, most island wins, ties broken by total damage ("WINS ON DAMAGE"). Between islands everyone drafts a stacking **perk**, losers first: thick skin, big boom, anchor, vampire, fireproof, lucky, twin shot, sniper. The final island starts at heat x1.4 with the lava rising from round 3.
- **Feedback:** -damage floaters, MULTI-HIT / SNIPE / CRUSHED / RETURN TO SENDER callouts, "SO CLOSE" when a blast just misses, hit-stop and shake on big hits, slow-mo on knockouts, bot taunts in their panels. Human seats keep a **best single hit** record under a versioned key and get a "NEW RECORD" callout.
- Score: island wins x10000 + total damage. Stats: Islands, Damage, KOs, Best hit, Swats landed, Haunts, Perks.

Match length: about 45-90 s with 2-4 players (bots vs bots average ~50-60 s).

## Inspired by

Inspired by the destructible-terrain artillery genre (Scorched Earth, Worms) and the "everyone acts at once" rhythm of simultaneous-turn party games, with a return-to-sender parry in the spirit of tennis-style reflect mechanics and the wind-meddling ghosts of party games where eliminated players keep sabotaging. This is our own design: no names, art, code or audio were copied.
