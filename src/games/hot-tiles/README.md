# Hot Tiles

2-4 players share one screen. Twenty big coloured tiles (5 colours, a 5x4 grid, 4x5 on a portrait phone) float over lava, and each player has a round token that starts on a random tile.

- A round: a beat of "..." (1.2s), then a colour is called in huge text and the lava border flashes that colour.
- Drag your token (one finger each, multi-touch) onto a tile of the called colour. The window is 2.2s in round 1 and shrinks 0.25s per round down to 0.9s.
- When the window closes every tile that is **not** the called colour drops into the lava. Tokens on a dropped tile, in a gap, or off the grid sink with a splash and are out.
- Tiles reshuffle their colours every round. Rounds 1-3 have 4 tiles of each colour; from round 4 only 2-3 tiles match the call.
- Tokens shove each other (simple circle repulsion). A held token pushes a free one the full distance, so a nudge off the tile edge counts as off.
- Last token standing wins. If everyone still alive falls in the same round, nobody is out and the round is replayed with the same survivors on fresh random tiles. The match is capped at 12 plays; anyone still standing then shares the win.
- Score is elimination order: first out lowest, survivor(s) highest, ties share.
- Stats: rounds survived, and "last-second saves" (you were not on a matching tile 350ms before the window closed, but were when it did).
- Bots pick a random matching tile and set off 300-900ms after the call (capped at 40% of the window in late rounds), with a 10% chance to head for a wrong tile first and correct 300-600ms later.

## Inspired by

The tile-call-and-drop mechanic is inspired by Mushroom Mix-Up and Hexagon Heat from Nintendo's *Mario Party* series, with the sinking floor feel of Hex-A-Gone from Mediatonic's *Fall Guys*. This is our own design: no names, art, code or audio were copied.
