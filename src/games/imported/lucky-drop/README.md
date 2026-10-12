# Lucky Drop

Port of the standalone Lucky Drop prototype created for this project. Registered as
`lucky-drop` in C5's main menu; uses the shared canvas, roster, seeded RNG, synth
audio and session scoring. No additional packages or external assets are needed.

## Play

Lucky Drop opens on a mode pick (an all-bot table skips straight to Sprint):

- **Sprint** (the party mode): everyone plays at once, each on their own board, for
  90 seconds. See below.
- **Classic:** endless until overflow, as before. A second pick (skipped for a solo
  player) chooses **Take Turns** (one board, one player at a time) or **Versus** (two
  boards side by side, same drops; 3–4 players play heats P1 vs P2, then P3 vs P4).

Shared rules:

- Drag across your board and release to drop. Seat keys also work: left/right to aim,
  the seat's action key to drop, the seat's down key to shake (Take Turns additionally
  accepts Arrows/A-D, Space and S for whoever is up).
- Two touching identical orbs merge: 1 → 2 → 4 → … → 2048 → 4096. Each merge awards the
  new value × 10. Merges within 1.5 seconds build a chain multiplier, up to ×5.
- Creating 128 adds a 1,000-point bonus, doubling each size up to 32,000 for 4096,
  the top orb (two 4096s don't merge). The board stays.
- Merges charge a shake; tap the Shake button or press the shake key to use it.

### Sprint

- **Same orbs, same beat.** One shared deck feeds every board; every beat, everyone
  gets the same orb (shown ON DECK at the top with the beat ring draining around it)
  and chooses where it lands. When the beat ends, anyone who has not dropped drops
  where they are aiming. Once everyone has dropped, the next beat starts at once.
  Orb odds follow the sprint clock, not the score, so the deck is identical for all
  boards no matter who is ahead (`sprint-rules.ts`).
- **Stages.** 0–25s only 1/2/4 drop, 2.3s beats. 25s: 8s join, 2.0s beats. 50s: 16s
  join, 1.7s beats. **70s: OVERDRIVE**, 1.4s beats and every merge and bonus pays ×2.
  The strip's progress bar shows the stage markers from the start.
- **Bust, don't die.** A settled orb above the line for 2.5 seconds busts the board:
  that board loses a quarter of its points (rounded to tens), explodes, and the player
  continues on a fresh board at the same place in the deck. Nobody is eliminated and
  nobody waits.
- **Underdog shake.** Anyone behind the leader charges a shake in four merges instead
  of six.
- **Settle.** After the last beat the boards keep simulating for three seconds so late
  merges count; then the highest total wins. Results show biggest orb, longest chain
  and busts.
- Bots pick a spot inside each beat (they hesitate early and snap faster in
  OVERDRIVE), aim at exposed matches, are sloppy about one drop in eight, and shake
  when the stack is tall. Lead changes, busts and big orbs are called out.
- Sprint records are stored separately from Classic (`c5-best-lucky-drop-sprint-v1`),
  for human seats only; beating one shows NEW RECORD.

### Classic

- Drops start at 1 (65%), 2 (25%), 4 (10%). As your score climbs you level up
  (2k, 6k, 15k, 30k): 8s and then 16s join the drops and big orbs get likelier.
  See `levels.ts`. The next two orbs are visible.
- Shot clock: wait too long and the orb drops where you're aiming. It starts at
  8s and shrinks with each level, down to 3s.
- Six merges charge a shake.
- A settled orb above the dotted line for three seconds ends the run. New falling
  orbs get a grace period.
- **Every Classic run is unlimited: no drop cap and no overall timer.** Players take
  consecutive runs on fresh boards until each board overflows. Everyone gets the same
  seeded drop sequence; shakes do not consume drop randomness. The highest score wins;
  C5 handles ties and the win point. Personal best is local to this browser and shared
  across seats (`c5-lucky-drop-best`).

Menu/Escape exits as usual.

## Inspired by

The sprint borrows the "everyone gets the same tiles" fairness of a puzzle tournament
and the rhythm of a game-show lightning round: one shared countdown, one call, and
everybody answers at once. Busting is modelled on push-your-luck dice games, where
going bust costs you the round's haul but never your seat, so the trailing player
always has a reason to keep stacking tall.

## Implementation

- `physics.ts`: DOM-independent circle collisions and matching, stepped at 120 Hz. A
  world can take a `roller` (a shared deck), a score `multiplier` and a `dangerLimit`.
- `rules.ts`: deterministic bot aiming. `sprint-rules.ts`: stages, the shared deck,
  bust and shake-cost maths, board layout and bot beat plans.
- `lucky-drop.ts`: the mode picker and the Classic Take Turns adapter. `versus.ts`:
  Classic Versus. `sprint.ts`: the Sprint adapter (lockstep beats, busts, settling,
  per-board multi-touch, records and stats).
- Tests cover physics, probability boundaries, chains, overflow, unlimited runs,
  input cancellation, bot play, score handoff, listener cleanup, sprint stages, the
  shared deck staying identical across scores and busts, bust accounting, underdog
  shakes, OVERDRIVE scoring, layout bounds and a full four-bot sprint.

Run `npm test` and `npm run build` from the repository root.
