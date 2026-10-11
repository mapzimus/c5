# Ice Luge

A 2–4 player downhill sled race. The screen is split into one vertical lane per player; everyone rides the same seeded, procedurally generated ice chute at the same time.

- **READY? ... GO!** then the sleds accelerate on their own. You only steer: hold the **left half** of your lane to lean left, the **right half** to lean right. Multi-touch is tracked per finger.
- The chute snakes left and right down the screen. It starts wide and slow and gets **faster and narrower** the further you get.
- **Ice crystals** (cyan diamonds) give a speed boost, well past the current top speed for a moment.
- **Scraping a wall** slows you down and sprays snow. Every new wall contact counts as a scrape.
- **Hitting a rock** spins you out for 0.8s: no steering and most of your speed gone.
- Speed lines fill the lane and the camera shakes as you get fast.
- The finish line is about 40s down the track. First across wins. Others are placed as they cross; 8s after the winner the rest are placed by distance (a countdown bar shows the grace period). If nobody has finished by 95s, everyone is placed by distance.
- Score is place points: 5 / 3 / 2 / 1. Stats: **Crystals** collected and **Wall scrapes**.
- Bots steer toward the chute's centre line a short distance ahead, with 0.1–0.34s reaction lag and noise, so they scrape sometimes. They grab easy crystals and mostly dodge rocks.

## Inspired by

Inspired by the Bobsled Run minigame in Nintendo's *Mario Party*. This is our own design: no names, art, code or audio were copied.
