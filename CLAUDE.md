# Category Five

Chaotic party-game collection: vanilla TypeScript + Canvas 2D + Vite. No framework.

## Commands

- `npm run dev` — Start dev server (port 5173)
- `npm run build` — Type-check (`tsc --noEmit`) then bundle (`vite build`)
- `npm test` — Run all tests (`vitest run`)

## Architecture

```
src/
  main.ts              Entry point
  app.ts               Menu, pregame, results screens (DOM)
  styles.css           Dark theme, responsive, CSS variables
  core/
    types.ts           GameDefinition, GameInstance, GameContext, Player
    engine.ts          Game loop: countdown → playing → finished
    input.ts           Pointer + keyboard binding
    audio.ts           Web Audio synth (Sfx class, no assets)
    rng.ts             Deterministic PRNG (mulberry32)
    viewport.ts        Logical-to-physical sizing
    draw.ts            Timer bar, arena fill
  fx/
    juice.ts           Screen shake, particles, hit-stop, slow-mo, callouts, personal bests
    sky.ts             Animated background motes
  ui/
    dom.ts             el() and clear() helpers
  games/
    index.ts           Central registry — add a game here to show it on the menu
    template.ts        Starter template for new games
    <game-id>/         One directory per game
      <game-id>.ts     GameInstance class (rendering, input, lifecycle)
      logic.ts         Pure functions: rules, scoring, bot AI (no DOM/canvas)
      logic.test.ts    Tests for the pure logic
```

## Adding a game

1. Copy `src/games/template.ts` into `src/games/<your-id>/`
2. Split pure logic into `logic.ts` — this is what tests import
3. Implement `GameDefinition` and `GameInstance` (see `src/core/types.ts`)
4. Add the export to `allGames` in `src/games/index.ts`
5. Add the game ID to the `EXPECTED_IDS` array in `src/games/index.test.ts`
6. Write tests in `logic.test.ts` covering rules, scoring, and bot behavior

## Conventions

- **logic.ts split**: Every game separates pure logic (testable, no DOM) from the GameInstance class
- **Deterministic RNG**: Use `ctx.rng` for all game randomness, never `Math.random()`
- **Bot AI**: Export bot functions from logic.ts so they can be tested independently
- **Personal bests**: Use `loadBest`/`saveBest` from `fx/juice.ts` with a version string when rules change
- **Particle effects**: Use the shared `Juice` class; `Callouts` for big text popups
- **Sound**: Use `ctx.sfx` methods (collect, streak, hit, whoosh, miss, win, tick, select)
- **No comments** unless the why is non-obvious
- **Strict TypeScript**: `strict`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`

## Test patterns

- Deterministic seeds: `new Rng(seed)` for reproducibility
- Statistical assertions: Run 100+ seeds, assert bounds
- Full game simulation: `while (!game.isFinished())` to verify termination
- Bot behavior: Verify bots complete games independently
- Canvas mocking: `vi.fn()` stubs for addEventListener/getBoundingClientRect

## Deployment

- GitHub Pages at `https://mapzimus.github.io/c5/`
- CI: push to main → `npm ci && npm test && npm run build` → deploy dist/
- Android: Capacitor (`npm run sync:android && npm run build:apk`)
