# Category Five

Play: **https://mapzimus.github.io/c5/**

That `/c5/` path is required. `https://mapzimus.github.io/` by itself is a 404.

C5 is a chaotic, Mario Party-style party game. This repo is the **game collection**. The board comes later and will sit on top of the same games.

The app opens on a **main menu of game cards**. Register a game and a card appears.

## Run

```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

Default table is two players (you + a bot). Add seats, rename, or flip Human/Bot on the menu.

After a game, the results screen offers **Play again** or back to the menu.

## Games

| Game | How it plays |
| --- | --- |
| **Flag Snap** | A 5s peek (tap to skip), then 12 pairs of flags on a 6×4 board (4×6 on a phone). On your turn flip two (8s shot clock): match and go again, three in a row is a HAT-TRICK for double points and then the turn passes. **Snap:** while someone else has one card up, hold your badge and tap its mate to steal the pair for yourself; a wrong snap costs a point and benches you for 5s. One secret golden pair pays triple, the last three pairs pay double (LAST CALL), and whoever is clearly last gets a flash of two hidden cards at the start of their turn. Every 4 misses, a shake-up slides 4 hidden cards to new spots. Inspired by classic Concentration/Pelmanism and the slap-the-pile rule of Snap. |
| **Bonk** | Tap critters in your zone before they hide. 8 hits in a row fills the meter and triggers 5s of FEVER (double points, more targets). Rare gold targets pay +10; bombs cost 5 and wipe your combo. |
| **Sky Dash** | Tap your lane to climb and thread neon gates. Coins in the gaps, +3 for skimming an edge, shield and ghost pickups, and the speed keeps climbing. Last jet flying wins. |
| **Drop Zone** | Get four in a row. Each round you also get one Bomb (clears a 3×3) and one Anvil (smashes down a column). Pieces fall after every blast, so lines can appear for anyone. First to 2 rounds. |
| **Parrot Flip** | Flick a pirate macaw and land it standing. Real bottle-game rules from [flipgame](https://github.com/mapzimus/flipgame): 10 lives each, every make raises the shared stake, a miss costs that many lives. 3 in a row = ON FIRE (bonus lives, free misses). Last one standing wins. **Duel mode:** two players flip at once on a split screen (both make = stake +2, a miss pays it, winner stays on). |
| **Castle Siege** | Hide your king, then drop pieces to wall him in (25s). Then take turns firing random ammo (cannonball, bomb, triple shot, boulder) through the wind. Blocks crack and shatter, and 3 hits take out a king. First to 2 rounds wins. [Details](src/games/castle-siege/README.md) **Real-time mode:** no turns, both cannons fire whenever reloaded. |
| **Eye of the Storm** | Big-touchscreen game. Everyone fires at once: drag back from your corner pad to slingshot six pucks into the eye (10/5/2). Random pegs, a swirl that bends shots and flips direction, and puck-on-puck knockouts. Ends when every puck is out and still, or at 60s. |
| **Chaos Derby** | Pure luck, real physics. Everyone bets on one of six runners drawn from a cast of twenty weirdos (a noodle, a cyclops jelly, a vampire, a ghost, a taco, a slug with eye stalks, a pirate, a pear in a top hat…), each with its own gait and face, and never two lookalike colours in one race. Then watch a ~50s race down a track of hurdles, crates, hills, bananas, springs and mud while chaos lands every few seconds (29 kinds): eagles, UFO abductions, anvils, trapdoors, balloons, pies, swaps, jetpacks, human cannonballs, low gravity, black ice, fish rain, boulders and more. The further up the order a runner is, the likelier its bad luck is severe, so leads rarely last. Whoever backed the best finisher wins. |
| **Kaboom Isle** | Tap-only artillery on crumbling floating islands over lava. First to win 2 islands takes the match. Each turn pick 1 of 3 random weapons (bomb, bouncer, cluster, triple, airstrike, drill, black hole, teleporter, boxing glove, rare Mega Nuke, rubber chicken), then tap to stop the aim needle and tap again to stop the power meter. Every round flips a chaos card (low gravity, hurricane, meteor shower, crate rain, bouncy world, earthquake, lava surge, double trouble, jackpot round). Between islands everyone drafts a stacking perk, losers first. Crates give HP, double damage or a shield. After five rounds the lava rises. |
| **Curve Clash** | Your line never stops and leaves a trail. Hold ◀/▶ in your corner to steer; gaps open in trails so you can slip through. Grab WIPE (clears every line), PORTAL (walls wrap for 5s) or GHOST (pass through lines for 3s). Skim a line for near-miss points. After 22s the walls close in. Last alive takes the round. Inspired by [Achtung, die Kurve!](https://github.com/stravid/achtung-die-kurve) (MIT). |
| **Tower Topple** | One shared tower, taking turns. Tap to drop the swinging block; overhang gets sliced off, so you inherit the last player's mess. Perfect drops score double and chaining them grows the block back and pays 3, 4, 5... (ON FIRE at 3). Sloppy drops set the tower wobbling, which moves the target for the next player. Sliced chunks bounce on the ground. Misses cost a life. Inspired by [tower_game](https://github.com/iamkun/tower_game) (MIT). |
| **Quick Draw** | Standoff. A heartbeat speeds up as the wait drags on, then tap your zone the instant DRAW! appears. The winner's bullets shoot everyone else's hat off; false starters fire into the dirt and drop theirs. Fake calls (DRUM!, a tumbleweed) catch anyone who fires early. Beat your fastest-ever draw for a NEW RECORD. First to 3 rounds. |
| **Rope Skip** | One player spins a giant rope by dragging in circles, baiting jumps; everyone else taps to jump. Every 5 clears in a row is a bonus point, and getting swept sends you ragdolling across the screen (faster rope, bigger launch). Survivors and the spinner score per round, and everyone takes a turn spinning. |
| **Chomp** | 45 seconds of tapping to chomp marbles. Every 3 chomps in a row raises your multiplier (up to x4); chomping on nothing or eating a bomb resets it. Bombs also stun you. Rare gold marbles pay 8, and three FRENZY waves flood the bowl. Most points wins. |
| **Block Brawl** | Falling-blocks versus, everyone at once in side-by-side wells with the same piece order. Tap to rotate, drag to move, swipe down to drop. Clears send garbage to a rival, and back-to-back clears build a chain that sends more. Clear a glowing power cell to hit rivals with INK, RUSH or FLIP. Last one standing wins. Inspired by [javascript-tetris](https://github.com/jakesgordon/javascript-tetris) (MIT). |
| **Hot Tiles** | Coloured tiles over lava. A colour is called, drag your token onto a match before every other tile drops. You have lives, and knocked-out players come back as ghosts who can curse a safe tile so it drops anyway. A gold Hot Spot pays embers (3 = extra life), SWITCH calls change the colour mid-window, and round 6 goes OVERDRIVE. |
| **Tilt Sumo** | Heavy balls on a round platform that tips under everyone's weight, so a crowd slides downhill. Drag a stick in your corner to steer, tap to SLAM. Fallen players cling to the rim as ghosts and stomp to tip the ring against the survivors. Four rounds with ice, spinner and gust hazards, final round double points. |
| **Big Blast** | Five plungers, one is live. Every dud pays a growing bounty into your unbanked stake; press again or STOP. KABOOM burns the victim's stake and everyone else banks. The last victim holds the JINX and can cancel someone's STOP. Underdog bounties pay double, final bomb doubles everything. Most coins wins. |
| **Flag Flash** | The caller raises RED, BLUE, BOTH or NONE; tap the matching half of your zone before the window closes. The caller sometimes spins and the sides swap. Knocked-out players become hecklers with a FEINT button. The last one standing enters a bank-or-bust showdown for a growing pot. Final heat is OVERDRIVE at double points. |
| **Hold It!** | A bomb with a hidden fuse. Tap to pass it to a random player, hold to aim. Hold longer before throwing and it sticks to the catcher's hands (1.5s STICKY, 3s GLUE), who must mash to wiggle free. Hearts instead of instant elimination; on your last heart you become a ghost who haunts the living by freezing their hands. Sudden death when two remain. |
| **Dare Dash** | Tap your lane to run. GREEN: mash. RED: freeze, or trip. YELLOW is the dare: taps charge a pot that pays out as a dash if you hold still through the red, and busts if you twitch. Finished runners sit on the bench lobbing banana peels. Last place gets turbo, and OVERDRIVE at halfway shortens every light. |
| **Thin Ice Stampede** | Hop ice lanes to dodge sliding herds, but camping cracks the ice under you until it gives way. Points per second standing, bonus for hopping at the last instant with a growing streak. Flattened players return as riders at the right edge who aim bruisers at the leader for revenge points. Three rounds, the last in OVERDRIVE. |
| **Slot Hop** | Hold to throttle, tap to hop between slots that are no longer equal: the inside is shorter but tighter. Cars sharing a slot can't pass, so the one behind shunts the leader, which can push them over the limit in a bend. Finished drivers become marshals dropping oil slicks. Final lap is OVERDRIVE, last place gets catch-up grip. |
| **Smudge Race** | Everyone traces the same squiggle in one stroke without lifting. Finish and you get two ink blots to lob at rivals, hiding their path for a couple of seconds. Last place gets a wider brush, round 4 is INKSTORM at x1.5. Speed buys sabotage time, so care and haste fight each other. |
| **Mug Shots** | Pull a rubber face's handles to match a ridiculous target mug. SNAP whenever you like: the bonus starts at x2 and drains to x1, so an early 60% can beat a late 95%. Snapping frees a tomato to throw at a rival's unfinished face. Four rounds, the last pays double, the player behind sees target guides. |
| **Avalanche Luge** | Side-by-side sled runs down a narrowing chute. Rivals ride as ghosts in your lane; sit in their wake to fill a DRAFT meter and slingshot past. Hold both halves to TUCK for speed, release before meltdown. When the first sled finishes an avalanche chases the stragglers, and finished players lob snowballs. |
| **Hive Heist** | Take 1 or 2 from a honeycomb queue with hidden wasps. Honey sits in your paws until you BANK and leave the hive; getting cornered by a wasp spills it all. Shove the visible wasp onto whoever holds the most. Banked or stung players release wasps into the combs for bounties. Three hives with crown combs, the last worth the most. |
| **Micro Mayhem** | Fifteen four-second microgames (POP, SWAT, CATCH, DODGE, MATCH, HOLD, SHAKE, STOP), everyone at once. Tap during the card to DOUBLE DOWN. Streaks build HEAT up to x3. The fastest success each round jinxes the leader's next game: flipped, spinning, tiny or fogged. Games 11-15 are OVERDRIVE at double points. |
**Lucky Drop** is also available from the main menu (Take Turns, or **Versus**: two boards at once, split screen, same drops): unlimited physics matching
runs with 65/25/10 drop odds, chain multipliers, charged shakes and a 128 clear.
Play solo or take turns against humans/bots; each run ends only when the board
overflows. [Rules and controls](src/games/imported/lucky-drop/README.md).

## Add another game

1. Copy `src/games/template.ts` (or drop a port in `src/games/imported/`).
2. Add the export to `allGames` in `src/games/index.ts`.
3. The main menu picks it up.
4. For its menu thumbnail, run `npm run dev`, then `npm run thumbs -- http://localhost:5173/ <game-id>` (needs Playwright). It plays the game bot-vs-bot and saves a mid-game shot to `public/thumbs/<id>.jpg`. Tune the timing in `DELAY` in `scripts/capture-thumbs.mjs`.

Pitches and half-thoughts go in `ideas/inbox.md` until they are a real game.

`GameContext` hands you canvas size, the roster, keyboard + click input, a seeded RNG, and tiny synth SFX. Untimed games use `durationMs: 0` and end when `isFinished()` is true.

Flag art on Flag Snap is the PNG set in `public/flags/` ([flagcdn](https://flagcdn.com/) / [flag-icons](https://github.com/lipis/flag-icons)).
