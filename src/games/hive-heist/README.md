# Hive Heist

A 2–4 player turn-based counting game of nerve. Everyone shares one hungry bear and one honeycomb conveyor.

- A hive is a queue of 14–20 items rolling toward the bear. Honey drops are worth 1–3 points (the value is printed on the drop). Angry wasps hide in the queue at random positions (never in the first two slots).
- Only the next 3 items are revealed; everything further back shows as **?** until it comes into view, so you can see a wasp coming when it is within 3 of the bear.
- On your turn the whole screen is yours: tap **TAKE 1** or **TAKE 2** (big buttons in your colour). You collect the honey on the items you take.
- If any item you take is a wasp you are **STUNG**: lose 5 points and you are out of that hive. You keep any honey grabbed in the same bite.
- Turns rotate among players still in the hive. A 5s turn timer runs; timing out counts as TAKE 1.
- A hive ends when it is empty or everyone is out. Two hives are played: hive 1 hides 2–3 wasps, hive 2 hides 4.
- Highest honey total after both hives wins (ties share). Stat: **Stings**.
- Bots count the visible items: a wasp 1st or 2nd means TAKE 1 (a wasp 1st is a forced sting), a wasp 3rd means TAKE 2 to push it onto the next player, otherwise TAKE 2 for the extra honey. They blunder 10% of the time and take 0.7–1.8s to think.

## Inspired by

Inspired by the Honeycomb Havoc minigame in Nintendo's *Mario Party*. This is our own design: no names, art, code or audio were copied.
