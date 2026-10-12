# Castle Siege

Hide your king in a fortress, pick your ammo, blow their shots back. First to 2 rounds wins.

Seats alternate teams: 1st and 3rd on the left, 2nd and 4th on the right. A team with any human seat uses touch. An all-bot team plays itself.

## Modes

Castle Siege opens on a mode pick (an all-bot table skips it and takes turns):

- **Take turns (default):** the siege below, with ammo picks, the bellows and build decrees.
- **Real-time (classic, unrestricted):** same build phase with no decrees, but in the siege both cannons fire whenever they're
  reloaded (3s). Each cannon rolls its next ammo as it reloads, the wind shifts every 6s,
  and after 45s every roll is a bomb (sudden death). Smashes are credited to the side that
  fired, and blocks broken within 1.2s of each other count as one combo. No bellows.

## A round

1. **Build (16s, less under a decree).** Both sides at once, with dual touch.
   - Your first tap places your **king**. If you don't tap, it lands in the middle after 6s.
   - Then hold, slide and release to drop the next piece from your queue. The ghost shows where it lands. ⟳ rotates.
   - Both sides get the same 10-piece queue, shown with the next 3 pieces.
   - Nothing can be damaged while building.
   - **Build decrees.** Round 1 is classic. Every later round announces a symmetric condition in its banner and in the
     HUD, drawn without repeats from: **BRITTLE** (every piece has 1 HP, the big block 2), **NARROW LOT** (you may only
     build in the middle half of your zone, fenced with dashed lines), **TALL ORDER** (pillars, planks and wedges only),
     **BIG BLOCKS** (six pieces from blocks, cubes and wedges). The same fortress plan never works twice in a row.
2. **Siege.** Teams take turns firing, and the loser of the last round shoots first.
   - **Ammo picks.** Each exchange deals two public ammo cards in the centre of the tray (cannonball, bomb with splash and
     knockback, triple shot, boulder, or the rare golden ball). Both shooters pick from the same pair, so the offers are
     always fair. Tap a card, then drag back and release to fire. A human has 10s to pick and fire (a bar under the title);
     when it runs out the cannon picks and fires by itself. A pair with a golden ball is announced as a **GOLDEN EXCHANGE**.
   - **The bellows (signature twist).** While the enemy's shot is in the air, hold anywhere on your side and your king
     puffs his cheeks and blows a headwind at it. One full breath buys about a second of gust. It sweeps cannonballs,
     bombs and triple shots off course, while boulders push through it and golden balls barely notice. Breath refills by
     half each time you defend; a team trailing in rounds gets a full tank every defence (**underdog lungs**). A shot that
     was blown at and hit nothing gets a **BLOWN OFF!** callout and counts on the results screen. Bots hesitate, sometimes
     forget to blow, and taunt when it works.
   - The wind is rerolled every shot and shown at the top. The first stretch of the arc is previewed, without wind.
   - **Ghost shot:** while you aim, your team's previous shot shows as a faint dotted line in your color, up to where it first hit (marked "LAST SHOT").
   - Hard hits crack blocks, and a block shatters when its HP runs out. Smash 2+ in one shot for a combo callout. A shot that
     passes within a whisker of the enemy king without touching him gets a **SO CLOSE!** callout. The most blocks a human
     team has smashed in one shot is saved as a personal best on this device (key version `v2`, since picks and decrees changed
     what a combo means), and beating it gets a "NEW BEST!" callout.
   - After 4 shots each, every shot is a bomb (sudden death, no pick). The deciding **FINAL ROUND** goes to bombs after 3.
3. **King down.** A king has 3 HP. Big hits and bombs take it down, and falling off-screen counts as a knockout. You get slow-mo, a flash, and the round goes to the other side. If both kings go down at once, the round is replayed.

## Tuning

- `rules.ts`: build time, queue length, sudden-death shot counts (`SUDDEN_DEATH_AFTER`, `FINAL_SUDDEN_DEATH_AFTER`), the
  human turn clock, decrees (`DECREES`), ammo odds and offers (`dealOffers`), the bot's pick heuristic (`ammoValue`),
  bellows (`BREATH_*`, `GUST_STRENGTH`, `gustFactor`), near-miss distance, wind, impact damage curve, real-time reload and
  sudden-death time.
- `world.ts`: zones and lots, drop gap, wind strength, bomb radius, max shot speed.

## Inspired by

The build-then-bombard loop comes from the classic fortress-artillery games where two players stack a castle and then lob
shots over it. The ammo cards borrow the "two public offers, both sides choose" idea from drafting card games so the luck
is shared and the pick is the skill. The bellows is a nod to fairy-tale giants who blow houses down, turned around so the
defender does the blowing: the player who is waiting for their turn now has a timed, limited action every exchange.
Build decrees are the "same rule for everyone, different every round" constraint from party board games, so a memorised
fortress plan stops being the answer.
