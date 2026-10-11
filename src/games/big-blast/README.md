# Big Blast

A 2–4 player push-your-luck bomb game, played in turns on one screen. Four bombs, most coins wins.

- A giant cartoon bomb sits centre screen with **5 detonator plungers** beneath it. One plunger (secret, random) is live.
- Players take turns in seat order. On your turn the screen is yours: your colour frames it, your name is called and a **4s turn clock** runs. Tap any un-pressed plunger (the clock running out picks one for you).
- A **dud** pays a **bounty** into your **stake**: +10 with 5 plungers open, +20 with 4, +30 with 3, +50 with 2. The left panel always shows what the next dud pays and the odds ("1 IN 3 GOES BOOM"); the right panel shows the current player's stake.
- After a dud you choose, within 2.6s: **press AGAIN** (tap another plunger: more coins, worse odds, and fewer safe plungers for whoever is next) or **STOP** (big button in your colour; running out of time stops for you). Pressing with a single plunger left is a certain boom, so a human who leaves one plunger banks automatically ("NO ESCAPE!" greets whoever is next).
- The **live** one: 0.6s of fuse hiss while the bomb swells, then **KABOOM**. That player is toast: their whole stake for this bomb burns. Everyone else banks their stake **+20 survival bonus**.
- **The JINX** (signature twist): whoever was toasted last holds a purple JINX during the next bomb and goes first on it. Once, when any other player taps STOP, the holder can tap **JINX!** during the 1s "banks" beat: the stop is cancelled and that player must press again. Leaving exactly one plunger while someone holds the JINX is a death sentence.
- **Underdog**: whoever has the fewest banked coins earns **double bounties** (gold "x2" badge).
- **Final bomb** (bomb 4 of 4): everything pays **double**, including the survival bonus. The bomb glows red.
- Score = banked coins. Stats: **Longest chain** (duds in one turn), **Toasted**. A human's coin total is saved as a personal record ("NEW RECORD").
- Bots press after 0.6–1.6s, sometimes hovering a hand over two plungers to tease. Each bot has a hidden nerve: they press again more when the bomb is fresh, when their stake is small, when they are behind or on the final bomb, and taunt ("GUTS!", "YOUR PROBLEM NOW") in the right panel. Bots spend the JINX almost always when it would be a certain boom, rarely on a fresh bomb.

## Inspired by

Inspired by the Bowser's Big Blast minigame from Nintendo's *Mario Party* series (mechanic only), crossed with press-your-luck dice games. The stake-burn economy, the again/stop choice, the underdog and final-bomb multipliers and the JINX are our own design: no names, art, code or audio were copied.
