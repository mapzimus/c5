# Sumo Rings

A 2–4 player bumper brawl on a round platform in the middle of the screen. Everyone plays at once on the same screen.

- Each player is a heavy ball (radius 40). Steer with a virtual joystick in your own pad: 2 players share the bottom of the screen (left/right), 3–4 players get the four corners. Touch anywhere in your pad to plant the stick, drag to set direction and force, let go to stop pushing.
- Movement is momentum-based with friction; balls bounce off each other elastically (own circle physics, mass-weighted), so a running start barges harder.
- Any ball whose centre leaves the platform falls (shrinks and fades) and is out for the round.
- Every 10s the platform shrinks by 15% (**SHRINK!**), with a red pulse on the rim just before.
- Each round rolls one hazard: **ICE** (almost no friction, weak grip), **SPINNER** (a striped bar whirls through the centre and knocks balls flying) or **GUST** (every few seconds wind shoves everyone one way, arrows show the direction).
- Last ball on the platform wins the round. First to 2 round wins takes the match, at most 5 rounds (most wins, ties share). If the last balls fall together nobody scores.
- Score = round wins. Stats: bump-offs (opponents you sent over the edge) and falls.
- Bots steer toward the nearest opponent when near the centre and back toward the centre near the edge, with heading noise and occasional 300ms hesitations.

## Inspired by

The mechanic is inspired by the Bumper Balls minigame in Nintendo's *Mario Party*. This is our own design: no names, art, code or audio were copied.
