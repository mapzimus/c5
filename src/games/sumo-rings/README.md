# Tilt Sumo

A 2–4 player bumper brawl on a round platform balanced on a single pivot. Everyone plays at once on the same screen, and nobody sits out: fallen players haunt the rim.

- Each player is a heavy ball (radius 40). Steer with a virtual joystick in your own pad: 2 players share the bottom of the screen (left/right), 3–4 players get the four corners. Touch anywhere in your pad to plant the stick, drag to set direction and force, let go to stop pushing.
- **The ring tips where the weight is.** The platform's tilt is the sum of every weight on it (ball offset from the pivot over the ring radius, divided by the seat count, capped at 1). Opposite weights cancel; a crowd on one side tips it and everyone slides downhill at up to 330 px/s². The deck shades dark on the low side, chevrons flow downhill and a spirit-level bubble at the pivot drifts uphill (green/amber/red by severity).
- **Tap to SLAM.** A quick tap in your pad (or a second finger while steering) fires a charged lunge in your last steering direction: 800 px/s for 0.25s at 1.7× mass, then it spends half its momentum. The charge ring around your ball refills in 2.6s. Slams hit hard, but a missed one near the edge carries you off.
- Any ball whose centre leaves the platform falls (shrinks and fades) and is out for the round. Getting back from within 14 px of the rim to 50 px inside is an **EDGE SAVE** (counted in the stats).
- **Rim riders.** Once a fallen ball is gone, that player hangs on the rim as a ghost: drag to slide around the edge (max 1.9 rad/s), weighing 1.3 balls-at-the-edge; tap to **STOMP** (2.6× weight for 0.7s, 2.4s cooldown). Ghosts tip the ring against the survivors; bots haunt whoever leads on points.
- Movement is momentum-based with friction; balls bounce off each other with mass (restitution 0.88), so a running start barges harder.
- Every 7s the platform shrinks by 16% (**SHRINK!**). At 18s **OVERDRIVE** starts: the ring shrinks steadily, the tilt bites 1.5× harder and the pivot wobbles with a rotating lean nobody can balance against. A round that somehow lasts 36s ends with no winner.
- Four rounds. Round 1 is plain so everyone learns the tilt; rounds 2–4 each roll a different hazard: **ICE** (almost no friction, weak grip), **SPINNER** (a striped bar whirls through the centre and knocks balls flying) or **GUST** (every few seconds wind shoves everyone one way, arrows show the direction).
- Scoring: last ball on the platform **+2**, every bump-off (you were the last to hit them within 2s) **+1**. The **FINAL ROUND pays double**, and the seat(s) with the fewest points going into it get the **UNDERDOG** ball: bigger (radius 46), heavier and worth more on the tilt. Most points wins the match, ties share. If the last balls fall together nobody scores.
- Stats: bump-offs, edge saves and falls. Human seats keep a personal best for bump-offs in a match (**NEW RECORD**, stored under the `v2-tilt` key).
- Bots steer toward the nearest opponent near the centre, back toward the centre near the edge, and lean uphill the closer to the edge they get; they slam when a target lines up and the lunge would land on the platform (8% of the time they fire recklessly anyway), hesitate for 300 ms now and then, and taunt after a bump-off. Ghost bots haunt the leader and stomp when they are under them.

## Inspired by

The bumper-ball mechanic is inspired by the Bumper Balls minigame in Nintendo's *Mario Party*; the tipping platform owes something to the seesaw stages in party games and to the kitchen-table game of balancing marbles on a tray. This is our own design: no names, art, code or audio were copied.
