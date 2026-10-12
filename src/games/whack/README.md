# Bonk (id `whack`)

A 50-second whack-a-mole for 2–4 players on one shared screen. Each player gets a zone of nine holes; everyone plays at once and nobody is ever out.

- **Bonk.** Tap a critter in your zone before it ducks. Multi-touch: every finger is its own tap. Tapping an **empty hole** is a whiff: it costs two steps of combo (never points), so spam-tapping the grid does not pay.
- **FATTEN (the twist).** A critter does not sit still: the longer you leave it up, the fatter it gets, and the number on its belly is what it pays right now: **1 → 2 → 3 → 5** (a stage every 0.42 s). It ducks at a random moment somewhere between 0.55 s and ~2 s, with only a short **wobble and a sweat drop** as warning. So every critter is a bet: bonk now for a sure 1, or wait for the fat 5 and risk losing it. A fat one that escapes is a **SO CLOSE**; a bonk inside the last 0.12 s is a **CLUTCH** (+1). The duck window shrinks as the match ramps.
- **Combo and FEVER.** Six scoring hits in a row fill the meter and start **FEVER**: 5 s of double points, more critters and fewer bombs. An escape or a bomb empties the meter.
- **Bombs** (dark, pink X) cost 5 points, wipe the combo and end FEVER. **Gold** critters pay 10 but are up for a blink.
- **RAIDS (losers stay in it).** Only players behind the leader get purple **RAIDER** critters (the sole last place, 8+ behind, gets the most and is tagged **UNDERDOG**). Bonk a raider and a **THIEF** pops up in the leader's zone holding a sack in their colour. The leader has 1.3 s to bonk it: **BLOCKED** costs nothing, but if it escapes it takes **5 points** from them and gives them to you. Raids never make anyone mathematically safe or out.
- **OVERDRIVE.** With 12 s left the screen pulses orange, spawns speed up and everything is fatter: stages pay **2 → 3 → 5 → 8**.
- Most points wins. Stats: hits, fat bonks, points stolen, fevers, bombs hit, gold. Human seats keep a personal best (**NEW RECORD** callout the moment it is beaten, stored under the `v2-fatten` key).
- Bots have a personality: a greed level (bonk at 2, 3 or wait for 5), a reaction speed, a chance to read the wobble, and a small chance to slap a bomb. They pause after each bonk, zone out for half a second now and then, wait too long on fat ones, block most thieves and taunt after a fat bonk.

Rules live in `logic.ts` (pure, tested in `logic.test.ts`); `whack.ts` is input, bot glue, effects and drawing (integration tests in `whack.test.ts`).

## Inspired by

The arcade whack-a-mole cabinet is the base: targets pop up, you hit them before they drop. The fattening critters borrow the push-your-luck beat of dice and card games such as *Can't Stop* or *Incan Gold*, where every extra moment of greed raises both the payout and the odds of losing it. Raids are the party-game "hit the leader" catch-up, done with counterplay rather than a free penalty. This is our own design: no names, art, code or audio were copied.
