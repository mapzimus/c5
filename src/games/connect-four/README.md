# Drop Zone

Turn-based disc dropping on a 7×6 grid for 2–4 players on one touchscreen, with a board that
tilts. Id `connect-four`, export `connectFour`.

## Rules

- Players take turns tapping a column to drop a disc. A line of **four** in a row (across, up or
  diagonal) bursts and scores 100. With three or four players the board is shared by three or four
  colours, so a line of **three** scores instead (the header says which). Longer lines pay +50 per
  extra disc.
- Everything above a burst line falls down. If that lines something up again it is a **chain**:
  the second link pays double, the third triple, and so on. Lines made by anyone pay that player,
  whoever's drop caused them.
- **The Tilt.** Every seven drops (five with four players) the whole board rocks sideways. Every
  row packs toward that side keeping its order, then the stacks drop back down and any lines
  burst and chain. The next tilt's direction and countdown are shown to the right of the board.
- **Steering the tilt** is the waiting game: every seat has `◀ TILT` / `TILT ▶` buttons that can
  be pressed at any time, including while someone else is thinking. Heavier side wins, ties go to
  the latest vote, and the direction **locks** one drop before the tilt so the last dropper can
  plan around it. Whoever is in last place gets a **double vote**, and gets their Bomb back when
  the board tilts if they have used it.
- **Powers.** Each player has one Bomb (clears the 3×3 around where it lands, then gravity) and
  one Anvil (smashes a whole column and keeps the bottom spot). Pick them on the left or with keys
  1–3; tap the active power again to go back to a plain disc.
- **Shot clock.** Humans have 7 seconds to drop (4.5 in Overdrive). Time out and a disc drops in
  a random column.
- **Match.** 70 seconds. The last 20 are **OVERDRIVE**: double points, faster tilts, shorter
  clock. When the clock runs out the board gets one **FINAL TILT**, and the highest score wins.
  A full board tilts early; a board still full after that loses its bottom row.
- The zone never starts empty: a fair random scatter of discs rains in before the first drop.
- Personal best (human seats only) is kept under the `v2-tilt` key and shows as NEW RECORD.

## Bots

Bots score every legal move (plain, Bomb, Anvil) by simulating it, including the tilt that
follows when it is the last drop before one, and they vote for the tilt side that pays them. They
hesitate over a couple of columns before dropping, miss threats now and then, and misjudge the
tilt about a third of the time.

## Files

- `board.ts` — pure rules: placing, powers, gravity, line finding and scoring, chains (`settle`),
  the tilt (`tiltSlide`, `previewTilt`), vote tally, underdogs, seeding, `simulateMove` for bots.
- `board.test.ts` — rules tests plus bot-vs-bot match tests (2–4 players, 45–100 s, a seat that
  never taps).
- `connect-four.ts` — the game: turn flow, animations, voting, bots, rendering.

## Inspired by

The core is the classic four-in-a-row drop game, played as a scoring race instead of a sudden
death so that nobody is out early. The tilt comes from tilting a physical frame and watching the
discs slide, and from match-three puzzlers where cleared pieces fall and chain. Letting the
waiting players steer the tilt, with the underdog's vote counting double, turns the waiting time
of a turn-based game into the part everyone plays at once.
