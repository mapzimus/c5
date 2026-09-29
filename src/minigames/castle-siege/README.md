# Castle Siege

Hide your king in a fortress, then blow up theirs. First to 2 rounds wins.

Seats alternate teams: 1st and 3rd on the left, 2nd and 4th on the right. A team with any human seat uses touch. An all-bot team plays itself.

## A round

1. **Build (25s).** Both sides at once, with dual touch.
   - Your first tap places your **king**. If you don't tap, it lands in the middle after 6s.
   - Then hold, slide and release to drop the next piece from your queue. The ghost shows where it lands. ⟳ rotates.
   - Both sides get the same 12-piece queue, shown with the next 3 pieces.
   - Nothing can be damaged while building.
2. **Siege.** Teams take turns firing, and the loser of the last round shoots first.
   - Each turn starts with an ammo roll: cannonball, bomb (splash damage plus knockback), triple shot, or boulder (heavy, extra damage).
   - The wind is rerolled every shot.
   - Drag back and release to fire. The first stretch of the arc is previewed, without wind.
   - Hard hits crack blocks, and a block shatters when its HP runs out. Smash 2+ in one shot for a combo callout.
   - After 5 shots each, every shot is a bomb (sudden death).
3. **King down.** A king has 3 HP. Big hits and bombs take it down, and falling off-screen counts as a knockout. You get slow-mo, a flash, and the round goes to the other side. If both kings go down at once, the round is replayed.

## Tuning

- `rules.ts`: pieces (size, HP, odds), build time, queue length, ammo odds, wind, impact damage curve, sudden-death shot count.
- `world.ts`: zones, drop gap, wind strength, bomb radius, max shot speed.
