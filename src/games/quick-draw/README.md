# Quick Draw

A 2–4 player standoff. The screen is split into one tap zone per player, each with that player's colour, name and gunslinger.

- Each round starts with a tense wait of a random 1.5s up to 3s (round 1), growing by 0.5s per round to 5s.
- Then **DRAW!** appears. The first player to tap their zone after it wins the round, and their reaction time in ms is shown.
- Fake calls show up during the wait: **DRUM!**, **DRAWER!**, **DRAMA!**, **BRAW!**, or a tumbleweed rolling across. Round 1 has 0–1 fakes; later rounds get more (up to 5).
- Tapping before the real DRAW (fakes included) is a false start: you're out for that round. If everyone false-starts, nobody scores. If nobody taps within 3s of DRAW, nobody scores.
- Best of 5: first to 3 round wins. If nobody reaches 3 after 5 rounds, the most round wins takes it (ties share).
- Bots react 180–400ms after DRAW, and have a ~15% chance to bite on each fake.

## Inspired by

The mechanic is inspired by the Quick Draw minigame in Nintendo's *1-2-Switch*. This is our own design: no names, art or audio were copied.
