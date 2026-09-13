# Category Five

C5 is a chaotic, Mario Party-style party game. This repo is the **minigame workshop** — a place to brainstorm, build, and import short games. The board comes later and will sit on top of whatever lands in the catalog.

The running name is **Category Five**: loud, short, a little mean, like a storm that will not stay in its lane.

There are no minigames in the catalog yet. That is on purpose.

## Run the shell

```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

The hub will stay empty until you register a game.

## Where things go

| You want to… | Put it here |
| --- | --- |
| Brainstorm a pitch | `ideas/inbox.md` |
| Build a game from scratch | Copy `src/minigames/template.ts`, then register it |
| Import a game from elsewhere | `src/minigames/imported/`, wrap it, then register it |
| Make it show up in the hub | Add the export to `allMinigames` in `src/minigames/index.ts` |

The hub, briefing, results, and session standings do not need to know how a game works. Launch a registered id, collect scores, pay party points (`5 / 3 / 2 / 1` by rank; ties share a rank), move on. A future board can use that same contract.

`MinigameContext` hands you canvas size, the roster, keyboard input, a seeded RNG, and tiny synth SFX. Bots are players with `kind: "bot"`.

### Local controls (when a game uses them)

| Seat | Move | Action |
| --- | --- | --- |
| P1 | WASD | Space |
| P2 | Arrows | Enter |
| P3 | IJKL | Right Shift |
| P4 | TFGH | Y |

Escape aborts a live game.

## Layout

```
ideas/                 scratch notes and pitches
src/core/              engine, input, session, registry
src/minigames/         playable games you write
src/minigames/imported ports and borrowed prototypes
src/fx/                title-storm backdrop
src/app.ts             title → roster → hub → play → results
```
