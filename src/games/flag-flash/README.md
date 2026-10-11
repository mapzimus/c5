# Flag Flash

A 2–4 player reaction test. A caller stands on a stage at the top holding a **red** flag (screen-left) and a **blue** flag (screen-right). Each player gets a column of the screen below, split into a red left half and a blue right half.

- Each call, the caller raises a flag and shouts **RED!**, **BLUE!**, **BOTH!** or **NONE!**.
  - RED: tap your red half. BLUE: tap your blue half.
  - BOTH: tap with two fingers, or tap both halves within 150 ms of each other.
  - NONE: do nothing. Any tap knocks you out.
- The response window starts at 1.5 s and shrinks by 0.1 s per call to a floor of 0.5 s (a timer bar runs along the top).
- Wrong half, tapping on NONE, too slow, or tapping when nothing has been called (including during a **feint**, where the caller just twitches a flag with no shout) knocks you out for the round: buzzer, your zone goes grey. Feints get more frequent the longer the round runs.
- Last player standing wins the round. If everyone still in fails on the same call, nobody scores. A round that drags on past 24 calls is void.
- First to 3 round wins, max 7 rounds. Score is round wins (ties share).
- Stats: fastest correct response in ms, and how many times you were knocked out.
- Bots answer 250–600 ms after a call, get 8% of calls wrong and bite on 15% of feints, and get noticeably sloppier as the window shrinks.

## Inspired by

The mechanic is inspired by the Shy Guy Says minigame in Nintendo's *Mario Party*. This is our own design: no names, art, code or audio were copied.
