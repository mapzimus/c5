# Avalanche Luge

A 2–4 player downhill sled race. The screen is split into one vertical lane per player; everyone rides the same seeded, procedurally generated ice chute at the same time, and you see your rivals as translucent **ghosts** in your own lane, exactly as far ahead or behind as they really are.

- **READY? ... GO!** then the sleds accelerate on their own. Hold the **left half** of your lane to lean left, the **right half** to lean right. Multi-touch is tracked per finger.
- **TUCK: hold both halves.** You stop steering, accelerate well past the normal top speed, and a **heat meter** beside the sled climbs. Let go before it fills: releasing above the white mark (72%) is a **PERFECT TUCK** and adds a burst of speed. Let it fill and you **MELTDOWN**: a spin-out that throws away more than half your speed. Tucking while grinding a wall heats up faster. Straights are for tucking, bends are for carving; the decision comes up every few seconds.
- **SLIPSTREAM.** Every ghost ahead of you trails a coloured wake. Ride inside it (close behind, nearly the same line) and your **DRAFT** meter fills while you get a little extra top speed. A full meter fires a **SLINGSHOT**: a big boost with a streak behind you, and an **OVERTAKE!** (bots taunt) if you pass the ghost. The meter fills faster the further back you are: second place fills it in 3.4s, every place further back is 40% faster. The leader has nobody to draft, so the pack always has a way to claw back.
- The chute snakes left and right down the screen. It starts wide and slow and gets **faster and narrower** the further you go. **FINAL STRETCH** is called when someone passes 72%.
- **Ice crystals** (cyan diamonds) give a speed boost. **Scraping a wall** slows you down and sprays snow. **Hitting a rock** spins you out for 0.8s. Passing a rock by a hair is a **CLOSE!** near miss.
- **AVALANCHE.** The moment the first sled crosses the line (or at 70s if nobody has), the avalanche is released 1200px behind the last racer and accelerates down every lane. Anyone it catches is **BURIED** and placed on the spot by distance, so stragglers must keep moving. A white triangle under the progress bar tracks it; the grace bar at the top shows the 11s cap after which anyone left is placed by distance.
- **Done racing? Throw snow.** Finished and buried players tap their lane to lob a **snowball** that lands at that lateral spot in every lane still racing (a growing shadow warns the targets). A hit costs 30% speed and splats the victim's screen for a second. One throw per 1.1s. Bots throw too, aiming at the straggler closest to the line.
- Score is place points: 5 / 3 / 2 / 1. Stats: **Time** at the line (or Buried) and **Slingshots**. Human seats keep a best finish time (`c5-best-ice-luge-v2`) and get a **NEW RECORD!** callout when they beat it.
- Bots steer toward the chute's centre line a short distance ahead, with 0.1–0.34s reaction lag and noise, so they scrape sometimes. They grab easy crystals, mostly dodge rocks and snowballs, sit in a wake when a rival is close ahead, tuck when the stretch ahead looks straight (misjudging it sometimes) and let go at their own greed level, so a few of them melt down.

## Inspired by

Inspired by the Bobsled Run minigame in Nintendo's *Mario Party* and the slipstream rule in arcade racers. This is our own design: no names, art, code or audio were copied.
