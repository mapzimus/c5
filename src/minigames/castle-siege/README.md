# Castle Siege

Two teams build towers from the same random pieces, survive their own physics, then trade shots.

Seats alternate teams (1st and 3rd on the left, 2nd and 4th on the right). A team with any human seat uses touch. An all-bot team builds and shoots by itself.

## Flow

1. **Size.** Pick 20 or 40 pieces. The draw is weighted: cubes and bricks are common, blocks and wedges are rare. Both teams get identical counts.
2. **Build.** Both sides at once, with dual touch. Drag from your tray, ⟳ rotates 90°, DONE ends early. Physics runs live, so the tower has to balance.
   - Your first 2 pieces (4 in a 40-piece game) are **base pieces**. They snap to the ground, lock in place, and count against your total.
   - Timer is 3:00 for 20 pieces and 6:00 for 40. A "SWAP BUILDERS" chime sounds every 30s so the next student takes over.
3. **Settle.** Unplaced pieces are removed. Physics runs for at least 3s, until everything stops moving. Any non-base piece touching the ground is out.
4. **Siege.** Teams alternate, **8 shots each**. Drag back from anywhere on your side and release (slingshot). Each shot gets a fresh visible wind, normal around 0 with sd 8, clamped to ±25. Wind pushes only the ball. A shot passes through your own tower. Non-base pieces that hit the ground are removed immediately. Base pieces can't be destroyed.
5. **Win.** Knockout: the first team with no non-base pieces standing loses. Otherwise, when all shots are used, the team with fewer pieces standing loses. Equal counts is a draw.
6. **Summary.** Tower stats (leftover, fell in settle, standing) and a scatter plot of wind vs. sideways drift for every shot.
   - Drift comes from two invisible ghost balls fired with each shot, one with wind and one without. The gap between them when they fall back to launch height is pure wind effect.

## Tuning knobs

- `rules.ts`: piece sizes/weights, timers, shots per team, wind sd/max.
- `world.ts`: zones, ground height, wind strength (`WIND_ACCEL`), max shot speed.

## Not in v1

Hidden randomness (v2), per-student shot tracking, hot-seat order display.
