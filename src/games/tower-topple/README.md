# Tower Topple

One shared tower. Everyone takes turns stacking onto it.

- A block swings on a rope above the tower. On your turn, tap anywhere (or press Space) to drop it.
- Whatever hangs over the edge of the block below is sliced off and tumbles away, so the tower narrows. The next player inherits whatever you left.
- Land within 6px of center for a **PERFECT**: the block keeps its full width and you score +2. Any other landing scores +1.
- Miss the tower entirely and you lose one of your 3 lives. The top of the tower widens a bit so play can continue.
- The swing speeds up as the tower grows, and the camera scrolls up with it.
- The game ends when only one player has lives left, or when everyone has used their 12 drops. Highest score wins (ties share the win).

Bots aim for the tower top with a random error and drop when the block swings past that point.

## Credit

Inspired by [tower_game](https://github.com/iamkun/tower_game) by iamkun (MIT License, Copyright (c) 2018 BMQB, Inc). This is a from-scratch reimplementation in C5 style; no code or art was copied.
