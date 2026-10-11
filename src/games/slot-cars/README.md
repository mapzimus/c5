# Slot Cars

A 2–4 player top-down slot-car race on one shared screen. The screen is split into one vertical zone per player; the track sits in the middle and every car runs in its own concentric lane.

- Each match picks one of three tracks: **Speedway** (a stadium oval), **The Bean** (a wide loop with a deep dip pinched into it) and **Hairpin** (a long straight, a sweeping side and a tight 180° hairpin).
- The only control is throttle: **press and hold anywhere in your zone to accelerate, release to brake**. Multi-touch, so everyone drives at once.
- Every point of the track has a curvature and therefore a speed limit. Your car glows **green → yellow → red** as you approach the limit of the bend you're in (the throttle bar at the bottom of your zone uses the same colour). Go over it and you **spin out**: the car is flung off the slot, spins for 1.2s, then resumes at a crawl.
- A **turbo pad** (pulsing chevrons) sits on the longest straight. Cross it at full throttle for a speed boost above the normal top speed. Straights never spin you out, but carry that speed into the next bend and you will.
- All lanes share the same lap length and the same limits, so no lane is favoured.
- **First to 3 laps wins.** The others are placed as they finish; 8s after the winner, anyone still racing is placed by progress. Scores are place points: 5 / 3 / 2 / 1.
- Stats: **Spin-outs** and **Best lap**.
- Bots hold the throttle and lift when the slowest point within the next `speed × 0.5s` would be exceeded, with a personal margin (0.90–0.96 of the limit) and small noise. Every so often a bot has a lapse: it looks less far ahead and pushes harder, which is how bots spin out.

## Inspired by

The mechanic is inspired by the Slot Car Derby minigame in Nintendo's *Mario Party*. This is our own design: no names, art, code or audio were copied.
