# Imported minigames

Drop ports and borrowed prototypes here.

Wrap whatever you bring in as a `MinigameDefinition` (see `../template.ts`), then add that export to `allMinigames` in `../index.ts`. The hub only shows registered games.

## Parrot Flip

Port of [Whydah-Unit parrot-flip](https://github.com/mapzimus/Whydah-Unit/tree/main/parrot-flip): same Matter.js flick physics and macaw art, scored as a four-toss party minigame.

## Lucky Drop

Port of the standalone Lucky Drop physics matching game, with unlimited runs,
seeded drop odds, human/bot turns and C5 session scoring.
[Rules and controls](lucky-drop/README.md).

## Booty Haul

Port of the Booty Haul game from [Whydah-Unit map-studio](https://github.com/mapzimus/Whydah-Unit):
pick a spot on the world map, drop anchor, and score every ship that sails within 200 km.
Cargo 1 pt, tanker 2 pts, treasure ship 5 pts. One repark mid-game. 90-second rounds.
Uses simplified Natural Earth coastlines, real-world shipping lanes, and 11 chokepoint doors.
