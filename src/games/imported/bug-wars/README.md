# Bug Wars

Dice-driven territory game on a hex garden, registered as `bug-wars` in C5's main
menu. Pure rules live in `rules.ts` (tested in `rules.test.ts`); `bug-wars.ts` is the
canvas front end: phases, bots, drawing and juice. No assets, no extra packages.

## Play

- The garden is a connected hex patch with a few stones punched out, dealt evenly to
  every seat. Each tile holds a stack of 1 to 8 bugs.
- **Three actions a turn**, humans and bots alike (four in the final round). Tap one
  of your stacks (2+ bugs), then:
  - an enemy neighbour to **attack**: both sides roll one die per bug, the attacker
    needs strictly more. Win and the swarm moves in (one bug stays home); lose and the
    attacker is left with one bug. Every target shows its real win chance.
  - a friendly neighbour to **march**: all but one bug shift over (stacks cap at 8).
- **Surge** (the signature twist): after a capture the swarm may press on from the tile
  it just took (if 3+ bugs landed), for free, with +1 bonus die, then +2, then +3 (three presses max). A
  surge that fails is a rout: the tile it pressed from goes straight back to its old
  owner with one bug. Tap HOLD / the tile itself / Space to dig in and bank it.
- **End turn** (button, Space or Enter, or the 15-second turn clock) drops
  reinforcements equal to your largest connected patch onto random tiles; what does not
  fit waits in the nest (up to 12).
- **Underdog:** the living seat with strictly the fewest tiles wins ties on its attacks
  and gets +2 income. It is re-checked before every action.
- **Ghosts:** with 3-4 players, a wiped-out seat stays in the game. On each of its turns
  it stomps any stack on the board, squashing it to half (humans tap a tile within six
  seconds; bots go for the leader's fattest stack).
- Rounds: 4 with two players, 3 with three or four. The last one is a **FINAL
  ROUND** frenzy with four actions. Most tiles when the rounds run out wins; holding the
  whole garden ends it early. Results list attacks, captures, best surge chain and
  ghost stomps. A human seat's capture count is kept as a local record
  (`c5-best-bug-wars-v2-captures`).

Bots weigh attacks by the exact dice odds, occasionally take their second-best option,
press a surge only when the odds (with momentum dice) look good, and shove idle
interior stacks to the front when nothing is worth attacking.

## Inspired by

The core loop (a stack of dice on every tile, attack a neighbour, strictly-higher sum
wins, income from your largest connected region) follows the classic browser territory
dice games. The surge/rout press-your-luck chain, action budgets, the underdog's tie
rule and the ghosts' boot are original to this version; the art is procedural canvas
drawing. This file and its sources are MIT licensed, like the rest of the C5 repository.
