# Category Five

C5 is a chaotic, Mario Party-style party game. This repo starts as the **minigame collection**. The board — stars, coins, and a hurricane path around the table — comes later and will sit on top of the same games.

The running name is **Category Five**: loud, short, a little mean, like a storm that will not stay in its lane.

## Play

```bash
npm install
npm run dev
```

Then open the local Vite URL. Default roster is one human (Gale, WASD) plus three bots.

```bash
npm test
npm run build
```

## What's here

| Minigame | Feel | Controls |
| --- | --- | --- |
| **Storm Surge** | Dodge falling wreckage in a sideways wind | Move |
| **Eye of the Storm** | Camp the shrinking calm eye | Move |
| **Gust Grab** | Loot crates and stars, skip the lightning | Move |
| **Pressure Drop** | Slap the action button only in the red band | Action |

Party points are `5 / 3 / 2 / 1` by rank. Ties share a rank. **Chaos Circuit** plays every game back-to-back and crowns whoever piled up the most points.

### Local controls

| Seat | Move | Action |
| --- | --- | --- |
| P1 | WASD | Space |
| P2 | Arrows | Enter |
| P3 | IJKL | Right Shift |
| P4 | TFGH | Y |

Escape aborts a live game.

## How a minigame gets added

1. Create `src/minigames/your-game.ts` that exports a `MinigameDefinition`.
2. Implement `create(ctx)` so it returns `update`, `render`, `isFinished`, `getScores`, and `destroy`.
3. Register it in `src/minigames/index.ts`.
4. Keep it short (20–45s), readable at a glance, and mean in a funny way.

`MinigameContext` already hands you the canvas size, the roster, keyboard input, a seeded RNG, and tiny synth SFX. Bots are just players with `kind: "bot"` — teach them a desired stick direction (or an action press) and they will sit at the table.

The hub, briefing, results, and session standings do not need to know how your game works. That is the contract the future board will use too: launch a registered id, collect scores, pay party points, move on.

## Layout

```
src/core/        engine, input, session, registry
src/minigames/   each game is a plugin
src/fx/          title-storm backdrop
src/ui/          tiny DOM helpers
src/app.ts       screens: title → roster → hub → play → results
```

## Later

- A Category Five board that picks these games as spaces / chance cards
- Gamepads and online rooms
- More minigames. Lots more minigames.
