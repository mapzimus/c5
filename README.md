# Category Five

Play: [mapzimus.github.io/c5](https://mapzimus.github.io/c5/)

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

## Games

| Game | How it plays |
| --- | --- |
| **Pairs** | Cards start face down. Click two. A match stays and you go again. A miss flips back and the next player goes. |

## Add another game

1. Copy `src/minigames/template.ts` (or drop a port in `src/minigames/imported/`).
2. Add the export to `allMinigames` in `src/minigames/index.ts`.
3. The main menu picks it up.

Pitches and half-thoughts go in `ideas/inbox.md` until they are a real game.

`MinigameContext` hands you canvas size, the roster, keyboard + click input, a seeded RNG, and tiny synth SFX. Untimed games use `durationMs: 0` and end when `isFinished()` is true.
