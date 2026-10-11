# Scribble Race

A 2–4 player tracing race on one shared screen. Each player gets a vertical lane; the same random squiggle appears in every lane.

- The squiggle is a smooth open curve (Catmull-Rom through random control points, zig-zagging top to bottom) with a white **START** dot and a gold **END** dot. A faint band shows the tolerance; a wider, fainter band shows the outer limit.
- Put a finger on START and trace the line to END in one stroke. Your stroke is drawn in your colour and a live accuracy % ticks along the bottom of your lane.
- Accuracy = share of your sampled stroke points that stayed inside the tolerance band.
- Lifting before END, or straying outside the outer band (3x the tolerance), scraps the stroke with a buzzer and a red flash: back to START.
- Reaching END locks in your accuracy as the round score (0–100), shown as a big percentage. 95%+ earns **FLAWLESS!**
- The round ends 2.5s after the first finisher, when everyone has finished, or at 15s. Unfinished players score the fraction traced times their accuracy (a scrapped, unrestarted stroke scores 0).
- 3 rounds: 5, 6 then 7 control points, with the band getting thinner (10%, 8%, 6.5% of the lane width). Round scores add up; highest total wins.
- Bots trace at a steady pace with smoothed perpendicular wobble, tuned to land around 70–95% accuracy, and start after a short random delay.
- Stats: **Best trace %** and scrapped strokes.

## Inspired by

The mechanic is inspired by the Trace Race / Crazy Cutter minigames in Nintendo's *Mario Party* series. This is our own design: no names, art, code or audio were copied.
