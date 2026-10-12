# Booty Haul

Port of the Booty Haul game from [Whydah-Unit map-studio](https://github.com/mapzimus/Whydah-Unit)
(MIT licensed), reworked for C5 as a hold-and-haul ambush game. Registered as `booty-haul`;
uses the shared canvas, roster, seeded RNG, synth audio and session scoring. Simplified
Natural Earth coastlines (public domain), real-world shipping lanes and 11 chokepoint doors.

## Play

One globe, 2-4 players at once, 75 seconds.

- **Drop anchor.** Drag your anchor token from your panel onto the globe and release where the
  ships sail. While dragging you see the net you would get ("NET 37") and chokepoints snap
  under your finger. Tapping your anchor token arms you instead: the next tap on the globe
  drops you there (a lone human is always armed). Tapping it while anchored also turns the
  globe to your spot. You start with 2 moves; a move recharges every 6 s.
- **Raid.** Press RAID (or your seat's action key) to take every vessel inside your 200 km net
  into your hold: cargo 2, tanker 5, treasure 15, convoy 30. Captured ships are sent onward
  from a far port, so your water empties and refills; a raid reloads in 3 s. The panel shows
  the live value in your net, so the call is "raid now or let the net fill".
- **Hold and haul.** Loot sits in your hold, not your score. Each raid since your last haul adds
  half a multiplier (x1 → x1.5 → x2 … x4 at six raids). HAUL HOME (or your seat's down key)
  banks hold × multiplier, resets the multiplier and locks raiding for 2.5 s. Whatever is in
  the hold when time runs out banks at face value, no multiplier.
- **The Navy.** From 14 s on, every ~11 s the Navy hunts whoever carries the richest hold
  (hold × multiplier). A frigate closes in for 3.5 s with a horn, a red banner and a flashing
  panel. Haul before it lands and you are safe ("CLOSE CALL!" under 0.8 s); otherwise the
  hold is seized and dumped as a **PRIZE** at a chokepoint at least 900 km away, worth the
  seized loot, for 25 s. The first net to raid over it takes it into their hold.
- **High tide** at 50 s: ships sail 45% faster, convoy packs come every 10 s, the Navy hunts
  every ~8 s. **Last call** at 10 s. Gold rushes highlight their lane on the globe and are
  named by the nearest chokepoint or port.
- **Underdog.** A clear last place (under 75% of a leader with at least 60) recharges moves twice as fast.
- Bots hesitate before raiding, hold out for bigger nets, chase prizes, and sometimes miss
  the Navy horn.

Records are per ruleset (`c5-best-booty-haul-v2-haul`), human seats only.

## Controls

Multi-touch by pointer id: every human seat has its own panel with anchor, RAID and HAUL HOME
buttons, so all seats play at once on one screen. Keyboard: seat 1 Space / S, seat 2 Enter /
Down, seat 3 Right Shift / K, seat 4 Y / G. Scroll or pinch to zoom.

## Inspired by

The original Whydah-Unit map game was a pure spotting contest: park at a chokepoint and count
the passing hulls. The rework keeps the globe, lanes and doors and adds the pirate economy
around them: raids that actually empty the water, loot that is only yours once you haul it
home, and a Navy that always chases the fattest hold. Push-your-luck banking comes from
dice-and-bank party games; the seized-loot prize is the "spilled coins" rule from arcade coin
pushers, turned into a race across the map so a seizure makes the whole table move.
