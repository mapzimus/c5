# Mug Match

A 2–4 player face-pulling contest on one screen. A ridiculous target mug sits in a panel at the top centre; every player gets the same blank mug in their own column underneath.

- Each mug has 7 draggable handles: both eyes, both eyebrow ends, both mouth corners and the nose tip. Drag them and the face stretches live, with rubbery lag so the skin wobbles after the handles.
- Raising the brows makes the eyes bulge; pulling the mouth corners up or down makes a grin or a frown; the head bulges wherever a handle is pushed past the rim.
- The target is built from 7 parameters (eye spacing, eye height, eye size, mouth width, mouth curve, nose length, eyebrow tilt), randomised each round. Round 1 is odd, round 2 is weird, round 3 is absurd.
- You have 12 seconds per round. No ghost overlay: look at the target panel and eyeball it.
- Round score = 100 minus the normalised parameter distance between your mug and the target, shown as a percentage. 3 rounds, highest total wins.
- Multi-touch: every handle is tracked by pointer id, so two hands (or two players) can drag at once. Humans only control their own column.
- Bots drag one handle at a time toward the target with easing, after a short think, with a per-bot error of 5–25%.
- Stat: "Best match %".

## Inspired by

The idea is inspired by the Face Lift minigame in Nintendo's *Mario Party*. This is our own design: no names, art, code or audio were copied.
