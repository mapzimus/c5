# Tower Topple

One shared tower. Everyone takes turns stacking onto it, and everyone else is the wind.

## Rules

- A block swings on a rope above the tower. On your turn, tap anywhere (or press Space) to drop it. A 4.5s shot clock drops it for you if you dither.
- Whatever hangs over the edge of the block below is sliced off and tumbles away, so the tower narrows. The next player inherits whatever you left.
- Land within 6px of center for a **PERFECT**: the block keeps its width, grows back 14px, and you score +2. Any other landing scores +1; just outside the window is a **SO CLOSE**.
- Perfects chain across players on the shared tower: the streak pays +3, +4, +5 (cap +6) and from 3 in a row it's **ON FIRE** (double regrow, hit-stop, flash). Any non-perfect drop ends the streak.
- **Bellows (the twist):** every seat has a pad at the bottom of the screen with a breath meter (refills in 3s). While you wait, tap your pad (or your seat's action key) to blow a gust from your side of the table: the swinging block jerks, a block already falling drifts sideways, and the tower rocks. Bots blow too, and taunt when they do.
- Sloppy drops also knock the tower: it sways on a damped spring, and a swaying top shifts where the next block has to land. A faint guide line shows where the top is right now.
- **Topple:** lean the tower past the red warning and its top 40% (at least two blocks) tumbles off. Every fallen block costs its owner one point, so blowing on a tower full of your own blocks is a gamble. If a gust caused it, the callout names the culprit.
- Miss the tower entirely and you lose one of your 3 lives. The top widens a bit so play can continue.
- **Out of lives? You are ghost wind:** your breath refills twice as fast and you keep blowing until the end.
- **Underdog:** the lowest score at the table gets a wider PERFECT window (10px) until they catch up.
- Each seat gets 12 drops with 2 players, 10 with 3, 8 with 4 (a match runs 60-90s). When everyone is on their last drop, **FINAL ROUND** starts: double points, a faster swing, faster breath.
- The game ends when only one player has lives left or everyone has dropped. The whole tower comes down for the winner. Highest score wins (ties share the win); human seats keep a personal best.

Bots aim for the tower top with a random error, drop when the block swings past that point, and blow about two turns in three, less often when the top of the tower is theirs.

## Inspired by

The one-tower, slice-the-overhang stacking loop comes from the classic stacker arcade format. Making the waiting players the weather turns a solo timing game into a table argument: the dropper reads the wobble and the shot clock, everyone else decides whether a gust is worth the risk to their own blocks, and a topple is a shared disaster with a named culprit.

## Credit

Inspired by [tower_game](https://github.com/iamkun/tower_game) by iamkun (MIT License, Copyright (c) 2018 BMQB, Inc). This is a from-scratch reimplementation in C5 style; no code or art was copied.
