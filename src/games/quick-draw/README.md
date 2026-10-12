# High Noon

A 2–4 player standoff with stakes. The screen is split into one tap zone per player, each with that player's colour, name, notches and gunslinger.

- Each round starts with a tense wait of a random 1.5s up to 3s (round 1), growing by 0.5s per round to 5s.
- Then **DRAW!** appears in gold. The first player to tap their zone after it wins the round (one notch), and their reaction time in ms is shown. Anyone who draws within 400ms after the winner sees how late they were (`+37 ms`); within 60ms it's **SO CLOSE**.
- Fake calls show up during the wait: **DRUM!**, **DRAWER!**, **DRAMA!**, **BRAW!**, or a tumbleweed rolling across. Round 1 has 0–1 fakes; later rounds get more.
- Tapping before the real DRAW (fakes included) is a false start: you're out for that round and your hat drops. If everyone false-starts, nobody scores. If nobody taps within 3s of DRAW, nobody scores.
- **Hecklers.** A false-starter isn't done: they get two bottles. Tap your zone to throw one across the street and yell a decoy (**DRAW?**, **NOW!**, **GO GO!**, **BANG!**, **DRAW!!**) in your own colour, tilted, never gold. Anyone who bites is out, and you get a **GOTCHA!** (counted as a heckle hit). Only one call is on screen at a time, and bottles can't be thrown once DRAW is up.
- **Double down.** Between rounds (after the late-draw window closes, until just before the next wait), tap your zone to raise: a gold `×2` chip and a gold hat band mark you. A doubled win pays **2 notches**; a doubled false start **costs 1 notch**. Seats strictly behind everyone else are underdogs and double **for free** (no penalty). One raise per round, no undo.
- First to **4 notches** wins. If nobody reaches 4 after 7 rounds, the most notches takes it (ties share). **MATCH POINT** is called when any seat can finish this round; round 7 is **LAST CALL**.
- During the wait a heartbeat pulse (vignette + tick) speeds up the longer it goes, and turns gold on match point.
- The winner fires both ways: bullets knock the hats off everyone else, and the hats tumble and bounce. A false start fires into the dirt and drops your own hat.
- Reacting under 200ms shows **LIGHTNING!**. A human beating their fastest-ever draw (saved on the device) gets **NEW RECORD**.
- Bots each have their own hand (fastest draw 170–250ms, spread 130–210ms, 6–14% chance to hesitate), bite a fake ~15% of the time and a heckle ~20%, throw their bottles when out, and raise more often when behind (almost always when it's free, rarely when leading, more after a win).

## Inspired by

The mechanic is inspired by the Quick Draw minigame in Nintendo's *1-2-Switch*; the stakes are our own saloon poker twist (raise before the draw, underdog plays free) and the hecklers are a nod to every western where the loser throws a bottle. This is our own design: no names, art or audio were copied.
