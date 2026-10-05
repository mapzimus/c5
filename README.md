# Category Five

Play: **https://mapzimus.github.io/c5/**

That `/c5/` path is required. `https://mapzimus.github.io/` by itself is a 404.

C5 is a chaotic, Mario Party-style party game. This repo is the **minigame collection**. The board comes later and will sit on top of the same games.

The app opens on a **main menu of game cards**. Register a minigame and a card appears.

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

**Scoring:** every minigame win is 1 point (ties for first all get it). The winner picks the next game from the results screen. If a bot wins, it picks at random.

## Games

| Game | How it plays |
| --- | --- |
| **Pairs FC** | A 5s peek (tap to skip), then 18 flags on a 6×6 board that fills the phone. Match two to stay on streak (bigger points). Last pair pays a closer bonus. Miss and the turn moves on. |
| **Parrot Flip** | Flick a pirate macaw and land it standing. Real bottle-game rules from [flipgame](https://github.com/mapzimus/flipgame): 10 lives each, every make raises the shared stake, a miss costs that many lives. 3 in a row = ON FIRE (bonus lives, free misses). Last one standing wins. **Duel mode:** two players flip at once on a split screen (both make = stake +2, a miss pays it, winner stays on). |
| **Castle Siege** | Hide your king, then drop pieces to wall him in (25s). Then take turns firing random ammo (cannonball, bomb, triple shot, boulder) through the wind. Blocks crack and shatter, and 3 hits take out a king. First to 2 rounds wins. [Details](src/minigames/castle-siege/README.md) **Real-time mode:** no turns, both cannons fire whenever reloaded. |
| **Eye of the Storm** | Big-touchscreen game. Everyone fires at once: drag back from your corner pad to slingshot six pucks into the eye (10/5/2). Random pegs, a swirl that bends shots and flips direction, and puck-on-puck knockouts. Ends when every puck is out and still, or at 60s. |
| **Chaos Derby** | Pure luck, real physics. Everyone bets on one of six runners drawn from a cast of twenty weirdos (a noodle, a cyclops jelly, a vampire, a ghost, a taco, a slug with eye stalks, a pirate, a pear in a top hat…), each with its own gait and face, and never two lookalike colours in one race. Then watch a ~50s race down a track of hurdles, crates, hills, bananas, springs and mud while 29 kinds of chaos land: eagles, UFO abductions, anvils, trapdoors, balloons, pies, swaps, jetpacks, human cannonballs, low gravity, black ice, fish rain, boulders and more. The further up the order a runner is, the likelier its bad luck is severe, so leads rarely last. Whoever backed the best finisher takes the point. |

**Lucky Drop** is also available from the main menu (Take Turns, or **Versus**: two boards at once, split screen, same drops): unlimited physics matching
runs with 65/25/10 drop odds, chain multipliers, charged shakes and a 128 clear.
Play solo or take turns against humans/bots; each run ends only when the board
overflows. [Rules and controls](src/minigames/imported/lucky-drop/README.md).

## Add another game

1. Copy `src/minigames/template.ts` (or drop a port in `src/minigames/imported/`).
2. Add the export to `allMinigames` in `src/minigames/index.ts`.
3. The main menu picks it up.

Pitches and half-thoughts go in `ideas/inbox.md` until they are a real game.

`MinigameContext` hands you canvas size, the roster, keyboard + click input, a seeded RNG, and tiny synth SFX. Untimed games use `durationMs: 0` and end when `isFinished()` is true.

Club crests on Pairs come from [World XI](https://github.com/mapzimus/lab) (the soccer-globe dataset). They remain trademarks of their clubs.
