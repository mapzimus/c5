# Inspiration research: new minigame ideas

Mechanics borrowed from other games, to be designed and coded from scratch. No names, art, code or audio come from the sources. Ranked best first for C5: one shared touch device, readable in ~10s, chaotic, bot-playable, cheap to draw in canvas.

Already in C5 or in progress, so skipped: memory pairs, flip, artillery (Castle Siege, Kaboom Isle), slingshot-to-target (Eye of the Storm), betting race (Chaos Derby), physics drop/merge (Lucky Drop), fling-and-bump coins (Fling), Simon sequences (Nerve), whack-a-mole, flappy, Connect Four, Booty Haul, Bug Wars, curve snakes, tower stacking, Tetris versus.

Effort: 1 = an afternoon, 10 = a Kaboom Isle-sized project.

---

## 1. Hot Tiles
**Inspired by:** Mario Party's Mushroom Mix-Up / Hexagon Heat.
**Pitch:** A grid of coloured tiles sits over lava. A colour is called, everyone drags their token onto a matching tile, then every other tile drops. Each round the timer gets shorter, fewer tiles match, and tiles start sharing colours or stripes. Tokens shove each other, so a crowded safe tile can push someone off.
**Controls:** Each player drags their own token (multi-touch). In 2-player games the screen can be split into halves with a mirrored board.
**Effort:** 3

## 2. Quick Draw
**Inspired by:** 1-2-Switch's Quick Draw and Mario Party's reaction games.
**Pitch:** Players face off in a standoff. Tap your zone the instant "DRAW!" appears. Fake calls ("DRUM!", "DRAWER!", a tumbleweed, a chicken squawk) catch anyone who fires early, and a false start loses the round. Best of 5, and later rounds add more fakes and longer waits.
**Controls:** Each player taps their own screen zone. Bots react after a random 180–400 ms and sometimes take the bait on a fake.
**Effort:** 1

## 3. Rope Skip (1 vs all)
**Inspired by:** Mario Party 8's Chump Rope.
**Pitch:** One player spins a giant rope and everyone else jumps it. The spinner can speed up, slow down or stutter to bait jumps, and jumpers who get hit are out. The jumpers win the round if anyone survives 15 seconds. Rotate the spinner so everyone gets a turn.
**Controls:** The spinner drags in a circle (speed follows the finger). Jumpers each tap their own zone to jump. Bots time jumps from the rope angle with some noise.
**Effort:** 3

## 4. Hungry Hoppers
**Inspired by:** the classic board game Hungry Hungry Hippos.
**Pitch:** A creature sits in each corner of a tablet. Tap to chomp the marbles that pour into the middle. Golden marbles are worth 3, bombs stun you for a second, and a "frenzy" wave dumps 40 marbles at once. The most marbles after 45 seconds wins. It's loud, readable instantly, and plays best on a tablet with 4 people.
**Controls:** Each player taps their corner. Holding does nothing, so mashing is rate-limited by the chomp animation.
**Effort:** 2

## 5. Sumo Rings
**Inspired by:** Mario Party's Bumper Balls, and the Sumo and Spinner War modes in *2 Player Games: The Challenge*.
**Pitch:** Players roll heavy balls on a round platform that shrinks every 10 seconds, and the last one on it wins. Hazards change each round: an ice patch, a spinning bumper, a wind gust. Unlike Fling, there are no coins. It's pure ring-out with momentum.
**Controls:** Each player gets a virtual joystick pad in their corner (drag to steer). For 2 players, use the split edges.
**Effort:** 4

## 6. Spot Kick
**Inspired by:** Penalty Kicks in *2 Player Games: The Challenge* and Mario Party's shootout minigames.
**Pitch:** It's a simultaneous mind game. The shooter swipes toward a corner while the keeper taps a dive direction, and both lock in within 1.5 seconds. Swipe speed adds curve and power, and a weak shot can be saved even when the keeper guesses wrong. Teams swap roles over 5 kicks each, with sudden death if tied.
**Controls:** The shooter swipes in their half and the keeper taps left, centre or right in theirs. Bots pick randomly, weighted against the opponent's history.
**Effort:** 3

## 7. Trap Run
**Inspired by:** Ultimate Chicken Horse.
**Pitch:** Each round, every player places one trap (saw, spring, glue, fan, spike block) on a short side-scrolling course. Then everyone runs it at once. You score only if you finish and not everyone else does, so traps have to be mean but not impossible. First to 5 points wins.
**Controls:** Pick a trap and tap where it goes, taking turns. The run is auto-scrolling and you tap your lane to jump. Bots place traps near the current best path and jump at gaps.
**Effort:** 6

## 8. Pocket Air Hockey
**Inspired by:** Air Hockey in *2 Player Games: The Challenge* and the arcade table.
**Pitch:** It's classic air hockey with goals on each edge (2 to 4 players). Each round it gets messier: a second puck drops in, goals widen, or a moving bumper appears in the middle. First to 5, or whoever has conceded least when time runs out.
**Controls:** Drag your mallet in your own zone (multi-touch). Bots track the puck with lag.
**Effort:** 3

## 9. Microgame Madness
**Inspired by:** WarioWare microgames and the gauntlet mode in WarioWare: Move It!'s party mode.
**Pitch:** Rapid-fire 4-second microgames, each with a one-word instruction: "POP!", "CATCH!", "DODGE!", "SWAT!". Everyone plays the same one at once in their own zone, and the fastest success gets a bonus. Speed ramps every 5 games, and the most points after 20 wins. Start with 8 microgames and add more later. The shared framework is the real cost.
**Controls:** Each player uses their own zone. Every microgame uses one gesture (tap, drag or swipe), so bots are a per-microgame script.
**Effort:** 7

## 10. Candy Heist (1 vs all)
**Inspired by:** Nintendo Land's Animal Crossing: Sweet Day.
**Pitch:** Thieves roam a small top-down garden and grab candy, getting slower the more they carry. One guard player steers two guards at once with two fingers, and a tagged thief drops everything. The thieves win if they bank 30 candy before time runs out. Hidden information doesn't work on one screen, so the twist is the guard's two-finger juggling.
**Controls:** The guard drags two guards with two fingers. Thieves each use a joystick pad at the screen edge. Bots: guards chase the heaviest-laden thief, and thieves path to candy while keeping away from guards.
**Effort:** 6

## 11. Hot Potato
**Inspired by:** Mario Party's bomb-passing minigames and the party game itself.
**Pitch:** A lit bomb sits in someone's zone with a hidden fuse. Tap to pass it, but it always goes to a random other player unless you hold to aim, which takes half a second. Some bombs are duds and some split in two. Whoever's holding it when it blows is out, and the last one standing wins.
**Controls:** Tap your zone to pass, or hold to aim at a neighbour. Bots pass after a short delay.
**Effort:** 2

## 12. Boomerang Brawl
**Inspired by:** Boomerang Fu, TowerFall and Knight Squad.
**Pitch:** Players are top-down blobs in a small arena with crates. Each fighter auto-walks and its aim arrow spins. Tap to throw a boomerang that curves back, and catching it lets you throw again. One hit knocks you out, and the first to 3 round wins takes the match. Power-ups like a fire boomerang, multi-throw and a shield drop from the sky.
**Controls:** One button each (tap your zone). Holding stops your spin so you can aim. This is the 12 MiniBattles one-button idea. Bots throw when the arrow lines up with an enemy.
**Effort:** 5

## 13. Wobble Snipers
**Inspired by:** 12 MiniBattles and Rooftop Snipers (one-button ragdoll duels).
**Pitch:** Two wobbly gunslingers stand on a rooftop. Tap to hop, and tap again in the air to fire in whatever direction you're tilting. Knock the other off the roof to win the round, first to 5 rounds. Arenas rotate between a rooftop, a train and an ice floe.
**Controls:** One tap zone per player. Bots fire when roughly level with the opponent.
**Effort:** 5

## 14. Order Up
**Inspired by:** Overcooked, cut down to a single shared screen.
**Pitch:** A conveyor belt runs across the middle carrying burger parts, and each player has a plate and an order ticket. Drag the right parts onto your plate in order before the ticket expires. You can also grab what an opponent needs. Dropping a wrong part on someone else's plate ruins it, which is deliberately legal.
**Controls:** Drag from the belt to a plate (multi-touch). Bots pick the next needed part and occasionally sabotage.
**Effort:** 5

## 15. Safe Cracker
**Inspired by:** 1-2-Switch's safe-cracking game, which uses haptic feel.
**Pitch:** Players take turns cracking a dial safe against a 20-second clock. The phone vibrates (or a tick sound plays, plus a faint visual wobble as a fallback) when the dial passes the hidden notch. Open three tumblers to crack it, and the fastest crack wins. This is the one idea that uses the Android build's vibration.
**Controls:** Drag around the dial, taking turns. Bots sweep and stop with a noisy reaction time.
**Effort:** 3

---

### Considered and dropped
- **Jackbox drawing and writing games:** bots can't play them, and they need private screens.
- **Pico Park / Heave Ho:** cooperative, so they don't fit one-point-per-win.
- **Mario Chase / Luigi's Ghost Mansion:** they rely on hidden information, which needs a second screen.
- **Tug-of-war mash:** too close to Whack and Hungry Hoppers. It could be a microgame in #9.
- **Curling / shuffleboard:** too close to Eye of the Storm.

## Sources
- https://www.mariowiki.com/Hexagon Heat
- https://www.mariowiki.com/List_of_Mario_Party:_The_Top_100_minigames
- https://www.nintendolife.com/news/2021/09/mario_party_superstars_includes_100_minigames_-_heres_the_full_list
- https://mariowiki.com/Bumper_Balls
- https://mariowiki.com/Chump_Rope
- https://www.thetoptens.com/super-mario/mario-party-minigames/
- https://apps.apple.com/us/app/2-player-games-the-challenge/id1465731199
- https://nextpit.com/best-multiplayer-games-on-single-smartphone
- https://poki.com/en/g/12-minibattles
- https://lutris.net/games/12-minibattles/
- https://en.wikipedia.org/wiki/Nintendo_Land
- https://www.engadget.com/2017/02/08/nintendo-switch-minigames/
- https://looper.com/40850/1-2-switch-includes-safe-cracking-crying-baby-simulators
- https://www.nintendojo.com/news/18-of-1-2-switchs-28-minigames-have-been-revealed
- https://en.wikipedia.org/wiki/WarioWare:_Move_It!
- https://destructoid.com/?p=419795
- https://couchcoopfavorites.com/knight-squad-2
- https://www.trueachievements.com/game/Knight-Squad/walkthrough/4
- https://en.wikipedia.org/wiki/Js13kGames
