# Smudge Race

A 2–4 player tracing race on one shared screen. Each player gets a vertical lane; the same random squiggle appears in every lane. Trace it well, trace it fast, then throw ink at whoever is beating you.

## Rules

- The squiggle is a smooth open curve (Catmull-Rom through random control points, zig-zagging top to bottom) with a white **START** dot and a gold **END** dot. A faint band shows the tolerance; a wider, fainter band shows the outer limit.
- Put a finger on START and trace the line to END in one stroke. Your stroke is drawn in your colour and a live accuracy % ticks along the bottom of your lane, with a **heat meter** that fills while you stay inside the band. Long clean runs make your stroke glow and shout **ON FIRE**.
- Accuracy = share of your sampled stroke points that stayed inside the tolerance band.
- Lifting before END, or straying outside the outer band (3x the tolerance), scraps the stroke with a buzzer and a red flash: back to START. A scrapped stroke keeps **half** of its partial credit (fraction traced x accuracy), so a late scrap is not a zero. Drifting past 2.2x the band and recovering flashes **SO CLOSE!**.
- Reaching END locks in your accuracy as the round score (0–100). 95%+ earns **FLAWLESS!**. The first to finish gets **+10**, the second **+5**.
- **Smudging (the twist):** the moment you finish you get two ink blots. Buttons with your rivals' names appear in your lane; tap one to throw a blot into that lane. It lands just ahead of their finger and hides the path there for 2.4 seconds before drying away. Their own stroke stays visible, the band underneath still counts, so they must trace the hidden stretch from memory, wait, or push on and risk a scrap. Finishing fast is worth more than the bonus: it buys you time to sabotage.
- The round ends 3s after the first finisher, when everyone has finished, or at 13s. Unfinished players score the fraction traced times their accuracy.
- **Wide brush (comeback):** from round 2 on, whoever is last on total (ties included) traces with a 35% wider band, shown in green.
- 4 rounds: 5, 6, 7 then 8 control points, with the band getting thinner (10%, 8.5%, 7%, 6% of the lane width) and blots getting bigger. Round 4 is the **INKSTORM**: every round score counts **x1.5**. Round scores add up; highest total wins.
- Bots trace at a steady pace with smoothed perpendicular wobble, tuned to land around 70–95% accuracy, start after a short random delay, slip toward the edge now and then (sometimes scrapping and hesitantly retrying), trace much sloppier through a blot, and smudge whoever is winning once they finish.
- Human seats keep a personal best trace % across sessions (`NEW RECORD` callout, shown as PB in the lane header).
- Stats: **Best trace %**, smudges thrown and scrapped strokes.

## Inspired by

The mechanic is inspired by the Trace Race / Crazy Cutter minigames in Nintendo's *Mario Party* series, with the ink-throwing sabotage in the spirit of item-based party racers. This is our own design: no names, art, code or audio were copied.
