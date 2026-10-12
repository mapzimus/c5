# Vault Heist (id `fling`)

A 60-second slingshot loot brawl for 2–4 players on one shared screen. Everyone plays at once; nobody is ever out.

- **Fling.** Touch your ball, drag back, let go: the ball flies the other way, harder the further you pulled (up to 900 px/s, 18 px minimum drag). You can grab it again once it has nearly stopped. Multi-touch: each finger owns one ball.
- **Loot goes in your pouch, not your score.** Rolling over a coin (bronze 1, silver 3, gold 5, diamond 10) adds it to the **pouch** riding on your ball (the gold number above it, the gold halo everyone can see). Picking up three coins in a row within 1.5 s raises a combo multiplier (x2, x3, x4) on the pickups themselves.
- **The vault is the only way to score.** A glowing ring sits somewhere in the arena. Roll into it with loot aboard and the pouch is banked: `pouch × multiplier`. The multiplier grows with the pouch (8+ → x2, 16+ → x3; x4 is the hard cap with bonuses), so the choice every fling is *grab more or cash out now*. After a bank the vault jumps to the far side of the arena; left alone it relocates every 10 s (the arc around it counts down), and it shrinks a little as the match ramps.
- **Ramming steals.** Hit someone with a closing speed over 150 px/s and the faster ball takes **half the victim's pouch** (capped at 12); a really hard hit also knocks loose coins out of them. Banked points are safe forever. A ball that stops just outside the vault with a fat pouch gets a **SO CLOSE**.
- **Crown and underdog.** The sole leader on banked points wears a crown: hits on them steal 1.5x. The sole last place, when at least 10 behind, is the **UNDERDOG** and banks at +1x. Nobody is out of it.
- **Escalation.** Coin waves speed up over the first 45 s; random events hit every ~9 s (COIN RAIN, QUAKE, JACKPOT diamond, SHUFFLE positions, SCATTER, GRAVITY, 2X COINS, BUMPERS). Mystery boxes grant MAGNET, MEGA (bigger, heavier), SHIELD (blocks one hit), TURBO (next fling doubled) or DOUBLE (2x pickups for everyone).
- **FINAL HEIST.** With 15 s left the vault slams to the centre, every bank pays an extra +1x, the vault relocates every 6 s and coins pour in. Bots dump their loot in the closing seconds and so should you.
- Most banked wins. Stats: banks, best single bank, loot stolen. Human seats keep a personal best for a single bank (**NEW RECORD**, stored under the `v2-vault` key).
- Bots have a personality (they cash out somewhere between 6 and 9 loot, or from 4 when they are passing the vault), bank when the vault is near or time is short, ram a nearby fat pouch (the crown first) about half the time they notice it, wobble their aim, fire a plain bad shot one time in ten, hesitate between flings and taunt after steals and banks.

Rules live in `logic.ts` (pure, tested in `logic.test.ts`); `fling.ts` is input, bots' glue, effects and drawing.

## Inspired by

The drag-and-release slingshot ball is a touchscreen staple (pool, marbles, flicking bottle caps across a table). The pouch-and-vault loop borrows the push-your-luck idea of games like *Incan Gold* and the bank-or-keep-rolling tension of dice games such as *Farkle*: unbanked loot is worth more the longer you hold it and can be taken from you. This is our own design: no names, art, code or audio were copied.
