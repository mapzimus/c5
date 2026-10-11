# Hot Tiles

2-4 players share one screen. Twenty big coloured tiles (5 colours, a 5x4 grid, 4x5 on a portrait phone) float over lava, and each player has a round token that starts on a random tile.

- A round: a beat of "..." (1.0s), then a colour is called in huge text and the lava border flashes that colour.
- Drag your token (one finger each, multi-touch) onto a tile of the called colour. The window is 2.2s in round 1 and shrinks 0.25s per round down to 0.9s.
- When the window closes every tile that is **not** the called colour drops into the lava. Tokens on a dropped tile, in a gap, or off the grid sink with a splash.
- **Lives.** Everyone starts with 2 lives (3 in a duel), shown as flames over their token. A fall costs a life ("SINGED!") and you get back up on a random tile next round; a fall on your last life knocks you out ("TOAST!"). A red ring marks a token on its last life.
- **Hot Spot.** From round 2 one tile of the called colour is ringed in gold. Only the token nearest its centre at the close claims it and earns an ember; three embers buy a life (max 3). Tokens shove each other, so the Hot Spot is a brawl: contest it or take a quiet tile.
- **Switch calls.** From round 3 about a third of calls switch to a different colour part-way through the window ("SWITCH!", with 0.4s added). Commit early and you may have to run again; wait and you may run out of time.
- **Ghosts (the signature twist).** Knocked-out players are not out: their token comes back as a ghost that floats over the grid. Drag your ghost onto any tile and hold it there: the tile cracks, and once the fuse ring fills (0.75s, down to 0.35s in late rounds) the tile is **cursed** and drops at the close even if it is the called colour. The cracks are visible to everyone, so the living can flee. A curse can never remove the last safe tile of the called (or switch) colour, and a ghost gets one curse per round. Sink someone and it's a **haunting**; haunt two players and you rise from the lava with one life (once per match).
- Tiles reshuffle their colours every round. Rounds 1-3 have 4 tiles of each colour; from round 4 only 2-3 tiles match the call (and 2-3 match the switch colour).
- Round 6 is **OVERDRIVE**: shortest windows, half the calls switch, the lava glows. If everyone still alive falls in the same round, nobody loses a life and the round is replayed. The match is capped at 14 plays ("LAST ROUND!" before the last one).
- Winner: the last token standing, or at the cap the survivor with the most lives, then embers. Knocked-out players rank by elimination order, hauntings as the tiebreak.
- Feedback: "CLOSE!" for a last-second save (not safe 350ms before the close, safe at it), "SO CLOSE!" when you fell within a token's width of a safe tile, "HAUNTED" callouts, and a per-seat record for rounds survived (humans only, stored under `c5-best-hot-tiles-v2-lives`).
- Bots set off 300-900ms after the call (capped at 55% of the window), prefer the nearest matching tile, contest the Hot Spot 35% of the time, go for a wrong tile first 10-28% of the time (rising per round), and from round 3 sometimes choke and leave far too late. When a ghost starts cursing their tile most bots notice after 0.35-0.8s and move, some never look down. Bot ghosts stalk the weakest nearby player before the call, then curse the tile with the most prey.

## Inspired by

The tile-call-and-drop mechanic is inspired by Mushroom Mix-Up and Hexagon Heat from Nintendo's *Mario Party* series, with the sinking floor feel of Hex-A-Gone from Mediatonic's *Fall Guys*; the haunting ghosts nod to the dead-player sabotage modes found in party games. This is our own design: no names, art, code or audio were copied.
