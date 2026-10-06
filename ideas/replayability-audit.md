# Replayability audit — all nine games

September 30, 2026. Source review of the current workspace, including the recently deployed Storm, Booty Haul, and Knockabout changes. This is a design assessment grounded in code, not a measured retention study or hands-on playtest. Recommendations below are proposals; no gameplay changes were made during this audit.

## Main finding

The collection already has random layouts, physics, streaks, and spectacle. The missing layer is meaningful variation: different plans to try, clear evidence of improvement, short routes into another match, and enough control to make a loss feel instructive. More particles, random bonuses, or extra characters alone will not supply that layer.

Prioritize broken or misleading rules first, then shorter and fairer party sessions, then new decisions. Keep a game's identity: Derby can remain a luck spectacle, Pairs a memory game, and Parrot Flip a simple flick challenge.

## Fix before expanding

1. **Knockabout: make drafted perks real.** `applyLaunchPerks()` returns speed/mass multipliers, but `launchAll()` ignores them. `applyPerk()` records an ID; disc spawning does not apply the perk's `onApply` hook. Rubber Bumper and Ghost Step have descriptions but no behavior. `updateVisuals()` resets mass to 1 or 2.6. A player can draft a promised advantage that never happens. Trace and test every offered perk through spawning, launch, collision, and round reset; hide any unfinished perk.
2. **Booty Haul: support every human.** `handleInput()` takes `humans[0]` and returns; other human seats have no anchor or raid control. Provide explicit active-seat selection and each seat's action binding, or a fair turn/heat mode. Bots automatically raid in the perfect window, so give them reaction error and the same information constraints as humans.
3. **Bug Wars: move turn logic out of rendering.** `drawPassHint()` consumes clicks, handles Space, and advances turns. It is called only in the human `pick` phase, so Space does not end a turn while choosing a target. Keep rendering read-only; handle pass and no-legal-attack transitions in `update()`, with a visible touch button.
4. **Knockabout: define simultaneous elimination.** `roundWinner()` picks the first maximum from finish order. If every owner falls during the same simulation step, event order determines the winner. Treat that as a draw or a clearly defined tiebreak, with a regression scenario.
5. **Protect score comparability.** Storm's old single-volley best shares a storage key with the new three-volley total. Booty Haul's old passive-scoring best shares its key with raid scoring. Version records by ruleset and mode; label them clearly.

Source anchors: `src/games/imported/knockabout/{index,perks,world,objectives}.ts`; `src/games/imported/booty-haul/booty-haul.ts`; `src/games/imported/bug-wars/bug-wars.ts`.

## Ranked enhancement packages

### 1. Bug Wars — make each turn a tactical choice

**Current strengths:** connected random gardens, contested borders, dice tension, income based on the largest connected region, and an eight-round limit.

**Current friction:** humans can continue attacking while bots are capped at three attacks; there is no human turn clock. Income placement is random. Species identify seats visually but do not change the rules. Connected-region income can reinforce the leader's advantage. Dice animations and reinforcement sequences add waiting, especially with four players.

**First package:** give every seat three action points per turn and a visible end-turn button. Spend one to attack or move reinforcements between adjacent friendly tiles. Let the player choose placement for a small portion of income; distribute the rest automatically. Show a compact attack likelihood preview calculated from the actual dice rules. Offer a small garden/short-round party mode.

**Next:** contested food tiles that score at round boundaries. They should reward taking and holding objectives rather than only growing the largest blob. Add species abilities only once action limits and income are balanced; keep them public and draftable rather than assigning power by seat.

**Check:** human/bot action budgets match; four-player turns stay brisk; the opening leader does not routinely become untouchable; passing works from both selection phases and on touch.

### 2. Knockabout — deliver the build variety already promised

**Current strengths:** simultaneous planning, multiple arenas, two discs per player, powerups, shrinking ground, and a losing-player perk draft.

**Current friction:** nonfunctional perks undermine experimentation; ties for fewest wins award the draft to the first matching seat. After switching to simultaneous turns, the HUD still highlights one current player. Bots can spend the full 15-second draft timer waiting before auto-picking.

**First package:** ship four fully implemented, visibly distinct perks with end-to-end checks: heavier disc, faster launch, one-use edge save, and a collision effect. Show each human's ready count out of two, plus the common launch timer. Let bot drafts happen promptly and rotate tied draft priority.

**Next:** a pre-match choice between an offensive and defensive starter, then round-specific objectives such as survival or holding a center zone. Keep classic survival available. Prefer a few consequential builds to a large pool of ambiguous bonuses.

**Check:** each perk changes a reproducible outcome; all seats understand when launch occurs; double elimination is fair; losing players can try a different plan next round.

### 3. Booty Haul — replace repeated camping rewards with hunting

**Current strengths:** roaming traffic, location choice, multipliers, replenishing moves, convoy events, and the new raid beat.

**Current friction:** passive ticks repeatedly reward the same vessels; raids also reuse that traffic without consuming loot or changing the situation. Staying on a profitable anchor and pressing raid on schedule can dominate the decision loop. Named gold-rush lane numbers are difficult to locate on a rotating globe. Only the first human has controls.

**First package:** award a capture once per vessel passage, using an explicit passage ID that changes when a ship is reoutfitted. Make raids capture a visible group and put those vessels on a cooldown or send them onward. Signal a treasure convoy before arrival and highlight its route, destination, and time remaining. Offer jump-to-port controls instead of requiring tiny globe targets.

**Next:** choose between a wide, low-value net and a narrow, high-value treasure raid. Add short contracts such as catching three tankers or intercepting a convoy; expose rewards before the player commits. Use short heats if shared-globe multiplayer remains awkward.

**Check:** changing location sometimes beats camping; every human can play; bots miss some perfect beats; players can locate a convoy without interpreting lane numbers.

### 4. Chaos Derby — turn spectacle into recurring stories

**Current strengths:** twelve distinctive characters, six-runner drafts, randomized physical incidents, changing leaders, and photo-finish drama.

**Current friction:** after choosing a runner there are no further player decisions during a roughly 50-second race. Displayed odds are decorative; hidden stats reroll independently of character identity, so there is no form to learn. Two players choosing the same runner can have effectively identical stakes in the outcome.

**First package:** a three-race cup with cumulative placement points, shorter heats, and a different field/track condition each heat. Retain recognizable runner tendencies across the cup, show two understandable traits, and remove decorative odds or replace them with evidence-based estimates.

**Next:** an optional intervention mode with one cheer boost per player. Let players choose when to use it; do not make repeated tapping determine speed. Add a backup-runner pick for modest consolation points and a post-race recap explaining the decisive incident. Preserve the original pure-luck mode.

**Check:** spectators stay interested through the final heat; traits predict tendencies without determining winners; last place still has a reason to care; identical picks do not make the entire match feel redundant.

### 5. Castle Siege — vary construction and ammunition decisions

**Current strengths:** build-and-destroy phases, identical piece queues for fairness, different materials/shapes, several ammunition types, wind, sudden death, and turn-based/real-time modes.

**Current friction:** repeated 25-second construction phases can become routine. Ammunition is randomly assigned, and late rounds become bomb-only, reducing choice and variety. A successful fortress pattern can be reused without a new constraint.

**First package:** choose one of two ammunition types for each shot, using equal public offers for both teams. Add a small set of symmetric build conditions—limited footprint, fragile foundations, or fewer sturdy blocks—announced before construction. Keep an unrestricted classic mode.

**Next:** permit one limited repair or king relocation between exchanges. Record favorite fortress layouts for practice, but do not auto-build them during competitive timed construction. Add demolition challenges with a fixed fortress and a three-shot budget.

**Check:** several fortress shapes are viable; ammo selection matters; construction remains quick; modifiers stay symmetric; sudden death still ends stalemates reliably.

### 6. Eye of the Storm — make the three volleys evolve

**Current strengths:** simultaneous slingshots, knockouts, swirl changes, cells awarding extra shots, and now three volleys with banked scores.

**Current friction:** the puck board resets, but pegs and scoring rings remain the same across volleys. Shot feedback shows direction rather than where the puck is likely to stop. Drawing six ammo pips hides extra cell-awarded pucks. Corner pads are only 96 pixels from the edges while maximum pull is 170, so full pulls can leave the canvas; compare mouse and touch ergonomics.

**First package:** use three announced conditions: calm opener, stronger swirl, then moving bonus target. Telegraph swirl reversal and offer a short approximate stopping preview that includes current drag/swirl, with uncertainty clearly shown. Display actual ammo count, including bonus pucks.

**Next:** an optional choice each volley between a light precise puck and a heavy knockout puck. Start with equal choices for every seat. Add a seeded precision challenge separate from multiplayer records.

**Check:** each volley encourages a different shot; every corner supports comparable power on touch; extra pucks are legible; previews teach rather than solve the shot.

### 7. Pairs — add tactical tempo without breaking memory

**Current strengths:** random crest sets and layouts, five-second peek, turn retention, streak scoring, fever multipliers, a golden pair, and a closer bonus.

**Current friction:** retaining turns while escalating score lets a strong memory player collect both more pairs and more points, leaving others watching. A fixed 36-card board has no short party variant. Random decks alone do not introduce new decisions after the rules are learned.

**First package:** add **Flag Pairs**, a separate national-flag version alongside club-crest Pairs, sharing the matching engine and controls. Give it an identifiable menu card and separate records. Offer both themes in a compact nine-pair sprint and a full-board classic. In sprint, cap consecutive retained matches at three before rotating the turn; compare flat pair points against the current escalating system. Keep classic scoring unchanged for players who enjoy long streaks.

**Flag Pairs scope:** use consistent local SVG flag assets rather than platform-dependent emoji. Label revealed cards with country names and preserve each flag's proportions inside a common card frame. Initially draw from a deliberately distinguishable set; put visually similar flags into an optional harder set. Add regional decks as later variety. Match on stable country IDs, not image filenames. Separate best records by theme, board size, and scoring mode. Reuse the existing peek, golden-pair, streak, and input behavior so this is a coherent new version rather than a duplicate implementation. Do not add geography quizzes to the basic matching rules.

**Next:** one earnable, public scout action that briefly reveals a selected card; spend a turn or clearly defined resource to use it. Add a seeded solo challenge tracking misses, time, and matches rather than only total score. Avoid shuffling hidden cards in standard play because that invalidates learned locations.

**Check:** all players get meaningful turns; the leader is not decided by one early run; scout use has a cost; matching remains readable with similar crests.

### 8. Parrot Flip — make misses useful and mastery visible

**Current strengths:** expressive flick physics, shared escalating stake, ON FIRE, perfect landings, golden flips, sudden death, and simultaneous duel play.

**Current friction:** a golden flip occurs only about once in 150 flicks, so it is too rare to carry session variety. Flick/physics jitter can blur whether a miss reflects technique. The best record emphasizes fire-run lives gained; it does not explain consistency or improvement. Successful ON FIRE players retain the turn in classic mode.

**First package:** a practice mode with flick strength, rotation, landing tilt, and a brief cause-of-miss cue. Track make rate over the last ten attempts and best perfect streak. Use the same physical rules in practice and competition.

**Next:** optional three-round landing challenges with a fixed, announced platform condition for each round. Reward perfect landings in that mode without changing the shared-stake balance in classic. Offer a quick duel preset for party sessions and cosmetic achievements for demonstrated skills.

**Check:** players can explain how to adjust after a miss; practice improvement transfers to normal play; variants change technique without adding opaque random forces.

### 9. Lucky Drop — preserve the strongest loop, add bounded goals

**Current strengths:** exposed-match planning, next-orb preview, chain scoring, charged shakes, escalating shot clocks and drop tiers, large merge milestones, best records, and same-seed versus heats.

**Current friction:** all modes finish by overflow, so expert runs can keep a party waiting. Three/four-player versus uses sequential heats. Identical random rolls do not guarantee identical orb tiers once score-dependent drop odds diverge; the UI's claim of the same drops needs that distinction checked.

**First package:** a two-minute party sprint with a short settle window after the last drop, alongside endless classic. In competitive sprint, use a fixed shared drop sequence or a shared level clock so both players truly receive the same pieces. Give each mode a separate best record.

**Next:** a limited hold/swap slot with a clear cost, plus small handcrafted chain puzzles and daily seeded runs. Reserve attacks/junk orbs for a separate battle mode; do not make standard versus punish someone simply for trailing.

**Check:** party matches have predictable length; shared drops remain identical despite score differences; the settle window scores late merges fairly; hold adds planning rather than trivializing danger.

## Collection-wide additions

- **Fast rematch:** a clear result-screen action for replaying the same game/mode with a fresh seed, preserving roster. Respect the current winner-picks-next rule or introduce a deliberate shared rematch vote.
- **Practice and party presets:** skill games need repeatable practice; party play needs bounded duration and little elimination downtime. Avoid one universal timer for all games.
- **Meaningful results:** show one or two useful stats per game—accuracy and knockouts; longest chain; perfect landings; territory gained. Give players a concrete target for their next attempt.
- **Seeded challenges:** expose and store seeds plus ruleset version, mode, and player configuration. The engine currently creates a new RNG without a user-facing replay seed. A seed alone is insufficient if inputs, bots, or unrelated effects consume gameplay randomness differently.
- **Cosmetic mastery:** visible medals for specific accomplishments, without permanent gameplay advantages. Start with a few per game rather than grind-heavy progression.
- **Session variety:** offer a short cup or suggest games not played recently. Keep direct game selection available.

## Suggested delivery order

1. Repair Knockabout perks/ties, Booty Haul human controls, and Bug Wars update/render separation.
2. Add Flag Pairs with national flags, quick rematch, versioned records, and bounded Lucky Drop/Pairs party presets.
3. Build Bug Wars action budgets and reinforcement choice; make Booty Haul convoy hunting active.
4. Add the Derby cup, Castle Siege ammo choices, and Storm volley conditions.
5. Add Parrot practice feedback, seeded challenges, and a small cosmetic mastery layer.

Validate with two- and four-player sessions across mouse, keyboard, and touch. Record match length, longest wait between decisions, immediate rematch choices, leader reversals, and whether players understand why they lost. Treat those as evaluation signals, not proven outcomes. Test one substantial rules change at a time.
