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
| **Flag Snap** | A 5s peek, then 12 flag pairs. Match two to keep your turn, but three in a row pays FEVER and passes it. While the active player has one card up, anyone on the sideline can SNAP the mate to steal the pair, or lose a point and sit out if wrong. Last place gets a peek, the final 3 pairs pay double. |
| **Bonk** | Tap critters in your zone. Each one fattens while it's up, paying 1, 2, 3 then 5, but ducks at a random moment: bonk now or wait. Players behind the leader get raiders that drop a thief into the leader's zone to steal points. FEVER at 6 hits, OVERDRIVE in the last 12s. |
| **Sky Dash** | Tap your lane to climb through gates. Every gate grows an unbanked run with a multiplier; every third gate splits into BANK and RIDE halves. Crash and the run is gone. Three lives, then you become a storm cloud dropping thunderheads on rivals. OVERDRIVE in the last 20s. |
| **Drop Zone** | Four in a row bursts and scores (three with 3-4 players), and falling discs can chain. Every few drops the board tilts sideways and everything slides; every seat votes the tilt direction, even off-turn, and last place votes double. One Bomb and one Anvil each. |
| **Parrot Flip** | Flick a pirate macaw and land it standing. A glowing perch moves every flip; land on it for a golden flip. Knocked-out seats call every flip as ghosts, and three right calls brings you back. Round cap with OVERDRIVE at the end. **Duel mode:** two players flip at once on a split screen. |
| **Castle Siege** | Hide your king, build walls under a random decree (brittle, narrow lot, tall pieces, big blocks), then take turns firing from two public ammo cards. The defender holds to blow a bellows headwind at incoming shots. First to 2 rounds. [Details](src/games/castle-siege/README.md) **Real-time mode:** no turns, both cannons fire whenever reloaded. |
| **Stormbolt** | Everyone slingshots pucks into the eye at once, light or heavy. Out of pucks? Your pad becomes a storm cloud: drag to call lightning that blasts pucks away. Wind shifts are telegraphed, an aim preview shows the curve, and trailing seats get an extra puck. Three volleys. |
| **Chaos Derby** | Pure luck, real physics. Bet on one of six weird runners, each with two true traits. At the halfway bell the race slows and everyone may hedge on a second runner. Each seat has one CHEER to stand a fallen runner up and sprint. A short single race, or a 3-race cup. |
| **Kaboom Isle** | Artillery on crumbling islands, everyone fires at once each volley. Pick 1 of 3 weapons, stop the aim needle and power meter. Once per island you can SWAT an incoming bomb back at its owner. Ghosts blow the wind. Damage heats up each round and the lava rises. |
| **Curve Clash** | Your line never stops. Cross your own line to close a loop: everything inside becomes your ground, rival heads inside are trapped. The dead come back as wraiths laying killer ink. Three-round points race, the last at double points. Inspired by [Achtung, die Kurve!](https://github.com/stravid/achtung-die-kurve) (MIT). |
| **Tower Topple** | One shared tower, taking turns dropping the swinging block. Everyone else holds a bellows to gust it off line, and a leaning tower now really topples, costing every fallen block's owner. Shot clock, final round at double points. Inspired by [tower_game](https://github.com/iamkun/tower_game) (MIT). |
| **High Noon** | Standoff: tap the instant DRAW! appears. Between rounds, double down for two notches (or lose one on a false start); the player behind doubles free. False-starters heckle with fake calls to catch others. First to 4 notches. |
| **Rope Riot** | One player spins the rope, everyone else jumps. Each clear grows your pot; BANK it any time, or get swept and the spinner steals it. Out or banked, you become a ghost who can whip the rope faster. Everyone takes a turn spinning. |
| **Chomp** | Tap to chomp marbles, but they sit in your belly until you hold still to GULP them. Every 4 raises the multiplier; a bomb makes you barf the lot back into the bowl. The bowl tilts toward whoever is last. OVERDRIVE in the last 10s. |
| **Block Brawl** | Falling-blocks versus, everyone at once, same pieces. Clears and chains send garbage; clearing above the high-stakes line doubles it. Power cells hit rivals with INK, RUSH or FLIP. At 50s the tide rises for everyone. Topped out? Haunt rivals as a ghost. Inspired by [javascript-tetris](https://github.com/jakesgordon/javascript-tetris) (MIT). |
| **Vault Heist** | Fling your ball to grab coins into a stealable pouch, then roll into the roaming vault to bank it with a multiplier. Ram a rival to steal half their pouch; the leader wears a crown and loses more. FINAL HEIST in the last 15s. |
| **Booty Haul** | Park your ship on the globe and raid passing traffic into your hold; the multiplier climbs with each raid, but only HAUL HOME banks it. The navy hunts the richest hold and dumps seized loot as a prize anyone can grab. Every seat has its own controls. |
| **Bug Wars** | Turn-based territory with dice. Three actions a turn with exact odds on every target. After a capture, SURGE on for bonus dice or bank it; a failed surge routs you back. Wiped-out players stomp stacks as ghosts. Short rounds, final round frenzy. |
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
**Lucky Drop** is also on the main menu. The default **Sprint** puts every seat on its own board for 90s in lockstep: one shared deck, one shared beat, same orb for everyone. Overflow is a bust, not elimination, and the last 20s are OVERDRIVE. **Classic** keeps Take Turns and Versus. [Rules and controls](src/games/imported/lucky-drop/README.md).

## Add another game

1. Copy `src/games/template.ts` (or drop a port in `src/games/imported/`).
2. Add the export to `allGames` in `src/games/index.ts`.
3. The main menu picks it up.
4. For its menu thumbnail, run `npm run dev`, then `npm run thumbs -- http://localhost:5173/ <game-id>` (needs Playwright). It plays the game bot-vs-bot and saves a mid-game shot to `public/thumbs/<id>.jpg`. Tune the timing in `DELAY` in `scripts/capture-thumbs.mjs`.

Pitches and half-thoughts go in `ideas/inbox.md` until they are a real game.

`GameContext` hands you canvas size, the roster, keyboard + click input, a seeded RNG, and tiny synth SFX. Untimed games use `durationMs: 0` and end when `isFinished()` is true.

Flag art on Flag Snap is the PNG set in `public/flags/` ([flagcdn](https://flagcdn.com/) / [flag-icons](https://github.com/lipis/flag-icons)).
