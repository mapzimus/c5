# Slot Hop

A 2–4 player top-down slot-car race on one shared screen, where the slots are not equal and you can hop between them. The screen is split into one vertical zone per player; the track sits in the middle with three or four concentric slots.

- Each match picks one of three tracks: **Speedway** (a stadium oval, 6 laps), **The Bean** (a wide loop with a deep dip, 4 laps) and **Hairpin** (a long straight, a sweeping side and a tight 180° hairpin, 4 laps).
- **Hold anywhere in your zone to accelerate, release to brake.** Multi-touch, so everyone drives at once.
- **Quick tap to hop a slot**: tap the **top half** of your zone to hop **out**, the **bottom half** to hop **in**. Hops take a moment, have a short cooldown, and are refused ("NO ROOM") when another car is sitting in that spot.
- **Slots are unequal.** The innermost slot is the shortest lap (about 150 px per slot per lap) but it runs the tight side of the bends that turn with the loop, so its speed limits are lower there. On The Bean and Hairpin some bends turn the other way, so the short slot is the *wide* line through those. Every point of every slot has its own speed limit; your car glows **green → yellow → red** as you approach it (the throttle bar in your zone uses the same colour). Go over and you **spin out**: flung off the slot for 1.2s, then resume at a crawl. Straights never spin you out. A tiny slot indicator next to your lap counter shows which slot you are in.
- **Cars in one slot can't pass each other.** The car behind is held at the leader's bumper and **shunts** it: a chunk of the closing speed is handed to the car in front, which can push it over the limit in a bend. Sit in front of a faster rival to block them, ram them into a bend to spin them, or hop around them.
- A **turbo pad** (pulsing chevrons) sits on the longest straight. Cross it at full throttle for a boost above the normal top speed.
- **Near misses**: peaking within 1.5% of the limit and surviving shows "SO CLOSE!". Laps without a spin build a **CLEAN ×n** streak.
- **Catch-up grip**: whoever is last and at least a fifth of a lap behind the leader gets +8% top speed and grip (a pulsing green ring and a "CATCH-UP GRIP" tag).
- **FINAL LAP: OVERDRIVE** — the moment the leader starts the last lap, everyone's top speed goes up 15% and grip 12%, the kerbs turn orange and scroll, and the road tints.
- **Marshals**: finished drivers are not done. Their ghost car keeps cruising the track and **a tap drops an oil slick** under it (3s recharge, slick lasts 4s). Oil covers every slot and cuts the limit to 60%, even on straights, so anyone still racing has to lift for it. Bot marshals time their drops for approaching cars.
- **First across the line wins.** The others are placed as they finish; 8s after the winner, anyone still racing is placed by progress. Scores are place points: 5 / 3 / 2 / 1.
- **Lap record**: a human seat's fastest lap per track is saved (`c5-best-slot-cars-v2-<track>`); beating it shows "NEW RECORD". The record is listed on the race-over screen.
- Stats: **Best lap**, **Spin-outs** and **Hops**.
- Bots hold the throttle and lift when the slowest point of their slot within the next `speed × 0.5s` would be exceeded, with a personal margin (0.90–0.96 of the limit) and small noise; a momentary lapse now and then makes them brake late. They hop out from behind a slower car, dive for the short slot on a clear straight depending on their greed, and sometimes bail out to a wider slot when they are about to spin. As marshals they drop oil when a racer is about to reach their ghost.

## Inspired by

The throttle-only slot-car mechanic is inspired by the Slot Car Derby minigame in Nintendo's *Mario Party*; slot hopping is inspired by digital slot-car sets whose lane-change track pieces let cars overtake. This is our own design: no names, art, code or audio were copied.
