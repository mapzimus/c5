# Lucky Drop

Port of the standalone Lucky Drop prototype created for this project. Registered as
`lucky-drop` in C5's main menu; uses the shared canvas, roster, seeded RNG, synth
audio and session scoring. No additional packages or external assets are needed.

## Play

Lucky Drop opens on a mode pick (an all-bot or solo table skips it):

- **Take turns:** one board, one player at a time.
- **Versus:** two boards side by side, played at the same time with the same drop
  sequence. Each board has its own shot clock, level and shake button, and aims with
  its own touch (multi-touch) or its player's seat keys. The heat ends when both boards
  overflow. 3-4 players play heats: P1 vs P2, then P3 vs P4.


- Drag across the board and release to drop, or use Left/Right (A/D) and Space.
  The active player's configured seat controls also work.
- Two touching identical orbs merge: 1 → 2 → 4 → … → 128 → 256 → 512 → 1024 → 2048 → 4096.
- Each merge awards the new value × 10. Merges within 1.5 seconds build a chain
  multiplier, up to ×5.
- Drops start at 1 (65%), 2 (25%), 4 (10%). As your score climbs you level up
  (2k, 6k, 15k, 30k): 8s and then 16s join the drops and big orbs get likelier.
  See `levels.ts`. The next two orbs are visible.
- Shot clock: wait too long and the orb drops where you're aiming. It starts at
  8s and shrinks with each level, down to 3s.
- Six merges charge a shake. Press S or tap the Shake button to use it.
- Creating 128 adds a 1,000-point bonus, and each size up doubles it: 256 = 2,000,
  512 = 4,000, 1024 = 8,000, 2048 = 16,000, 4096 = 32,000. The board stays.
  4096 is the top orb (two 4096s don't merge).
- A settled orb above the dotted line for three seconds ends the run. New falling
  orbs get a grace period.

**Every run is unlimited: no drop cap and no overall timer, in solo or multiplayer.**
Players take consecutive runs on fresh boards until each board overflows. Everyone
gets the same seeded drop sequence; shakes do not consume drop randomness. Bots
aim at exposed matches or open space and use charged shakes near the top. The
highest score wins; C5 handles ties and the win point. Menu/Escape exits as usual.
Personal best is local to this browser and shared across seats.

## Implementation

- `physics.ts`: DOM-independent circle collisions and matching, stepped at 120 Hz.
- `rules.ts`: deterministic bot aiming.
- `lucky-drop.ts`: C5 lifecycle, pointer/keyboard controls, turns and rendering.
- Tests cover physics, probability boundaries, chains, overflow, unlimited runs,
  input cancellation, bot play, score handoff and listener cleanup.

Run `npm test` and `npm run build` from the repository root.
