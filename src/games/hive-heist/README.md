# Hive Heist

A 2–4 player push-your-luck counting game. Everyone shares one hungry bear and one honeycomb conveyor; honey is only yours once you have banked it.

- A hive is a queue of combs rolling toward the bear (longer on small tables). Honey drops are worth points (the value is printed on the drop); angry wasps hide in the queue at random positions, never in the first two slots. Only the next 3 combs are revealed; everything further back shows as **?**.
- On your turn tap **TAKE 1**, **TAKE 2** or **BANK**. Honey you take goes **in your paws**, not on the scoreboard. BANK leaves the hive with your paws intact and locks the honey in.
- A wasp at the front of the queue on your turn means you are **CORNERED**: you are stung, you **spill everything in your paws**, and you are out of that hive. So count: shove a visible wasp onto the player with the fattest paws (a wasp 2nd means TAKE 1, a wasp 3rd means TAKE 2 or TAKE 1 to pick who gets it).
- The risk meter above the belt shows how many wasps are still hidden in how many unseen combs. Bank before the odds turn.
- **The swarm:** anyone out of the hive (banked or stung) gets one wasp. Tap your own card to **release it** into the hidden combs. If it stings someone, you collect a **bounty of 3**.
- Three hives of rising stakes: Spring (2 wasps, honey 1–3), Summer (3 wasps, honey 1–4, a **crown comb worth 6**) and the final Royal hive (4 wasps, honey 2–5, a crown worth 10). The crown's slot is marked even while hidden, so everyone counts toward it.
- **Underdog nose:** from hive 2 on, the unique lowest scorer sees 4 combs on their turn instead of 3.
- A hive ends when it is empty (everyone still in banks their paws) or when everyone is out. A 5s turn timer runs; timing out counts as TAKE 1.
- Most banked honey after three hives wins (ties share). Stat: **Best haul** (biggest single bank). Human seats keep a personal best banked total.
- Bots shove wasps onto the richest paws and never onto themselves if they can help it, grab two when nothing is in view, and bank once their paws times the hidden risk outweighs another bite. Each bot has its own nerve, hesitates when a wasp is in view, blunders 8% of the time, and drops its swarm wasp at a random moment.

## Inspired by

Inspired by the Honeycomb Havoc minigame in Nintendo's *Mario Party*, crossed with bank-or-bust press-your-luck games. This is our own design: no names, art, code or audio were copied.
