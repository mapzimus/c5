# Flag Flash

A 2–4 player reaction game with a sting in the tail. A caller stands on a stage at the top holding a **red** flag and a **blue** flag. Each player gets a column of the screen below, split into a red half and a blue half. A match is a series of **heats**; the highest total score wins.

## Calls

- Each call the caller raises a flag and shouts **RED!**, **BLUE!**, **BOTH!** or **NONE!**.
  - RED: tap your red half. BLUE: tap your blue half.
  - BOTH: tap with two fingers, or tap both halves within 150 ms of each other.
  - NONE: do nothing. Any tap knocks you out.
- Every correct answer (including keeping still on NONE) scores **+1**. Three correct in a row makes you **HOT**: every further answer pays **+2** until you slip. A response under 250 ms gets a FLASH! label; a correct tap that lands just after the window shuts gets a SO CLOSE!
- The response window starts at 1.5 s and shrinks by 0.1 s per call to a floor (a timer bar runs along the top).
- Wrong half, tapping on NONE, too slow, or tapping when nothing has been called (including during a **feint**, where the caller just twitches a flag with no shout) knocks you out of the heat. Feints get more frequent the longer a heat runs.

## Side swap

Now and then the caller spins round and the flags change hands: the red and blue halves of every column **slide across to the other side** ("sides swap!"). Any tap during the spin is a jump. Keep tapping the *colour*, not the side your thumb remembers. Bots get noticeably clumsier for a couple of calls after a swap.

## Hecklers

Knocked out? You are not done. Your column becomes a heckler booth with one big **FEINT!** button. Tap it and the caller twitches a flag in the next gap, exactly like one of his own feints. If a survivor bites, you score **+2** (GOTCHA!). The button reloads for 3 s after each feint, and at most two feints land between any two calls, so the real call always comes.

## Showdown

When one player is left standing, the heat becomes a **showdown**: a pot starts at 3 and grows by 2 for every call the survivor answers, while every heckler is trying to fake them out. The survivor can tap **BANK** at any moment (except mid-resolve) to take the pot and end the heat, and the pot banks itself after 6 survived calls. Fall before banking and the pot is lost. With two players the showdown starts the moment the first one falls.

## Heats, second wind and OVERDRIVE

- Heats keep coming until the match clock passes 36 s (at least three, at most six); the next heat is then the **FINAL HEAT: OVERDRIVE** — shorter windows, more feints, more swaps, and **every point doubled**.
- At the start of every heat after the first, whoever is last gets a **SECOND WIND** shield (gold ring) that absorbs one mistake. If everybody is tied, nobody gets one.
- A heat that drags past 16 calls ends with the survivors sharing +3 each. If everyone still in fails on the same call, the heat just ends.
- Stats: fastest correct response in ms, points banked from pots, and heckle bites. Human players' fastest-ever response is kept as a record (NEW RECORD callout).
- Bots answer 250–600 ms after a call, get 8% of calls wrong and bite on 15% of feints, get sloppier as the window shrinks and after a swap, heckle about half the gaps they can, and bank with growing nerves as the pot climbs.

## Inspired by

The mechanic is inspired by the Shy Guy Says minigame in Nintendo's *Mario Party*. This is our own design: no names, art, code or audio were copied. The heckler booths, side swaps and the bank-or-bust showdown are additions of our own.
