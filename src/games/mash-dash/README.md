# Dare Dash

A 2–4 player wind-up foot race on one screen (game id `mash-dash`). Each player gets a horizontal lane; tap anywhere in your lane.

- The traffic light cycles **GREEN → YELLOW → RED**. Every tap on GREEN hops your runner forward a step. Taps within 200ms of each other chain into a speed bonus (up to 1.6x per step after 12 quick taps). Pause and the bonus resets.
- **The dare (signature twist).** YELLOW taps do not move you: each one charges a pot worth 3 plain steps (4 in overdrive) that floats over your head. The yellow lasts an unpredictable 0.5–1.4s, then RED. Hold still through the red and the pot pays out as a dash the moment the light goes GREEN again ("BANKED +12%"). The last dare landing within 150ms of the red is a **CLUTCH** and pays 50% extra. Tap during RED and you trip: fall flat, slide back 5% of the track, lie stunned for 0.8s, and the pot **BUSTS**.
- **Overdrive.** Once anyone passes halfway: greens, yellows and reds all get shorter (yellow 0.25–0.9s) and dares pay x4.
- **Turbo (comeback).** The sole last-place runner, 12% or more behind the leader, runs with a gold key: every step and dare is worth 1.3x until they catch up.
- **The bench (finished players stay in).** Crossing the line gives you a bench with one button per rival still running. Tap one to lob a banana peel that lands just ahead of that runner (2.5s reload). Bots on the bench heckle the leader every 1.2–3.2s.
- Lane hazards: a banana peel wastes your next tap (slip), a spring launches you forward 7% of the track. Each lane starts with one spring and 1–2 bananas at random spots.
- First across the finish line wins and starts an 8s countdown. Others are placed as they cross; when the countdown ends everyone remaining is placed by distance. Hard cap 75s.
- Score: 1st 10 pts, 2nd 7, 3rd 4, 4th 2. Stats: Banked (track % earned from dares), Trips, Time.
- Human seats keep a personal best finish time (`c5-best-mash-dash-v2-time`, stored as a speed score); beating it shows "NEW RECORD".
- Bots mash at 6.5–9 Hz with jitter, pick a dare plan each yellow (15% take none, half take 1–3, a quarter take 4–6, 10% get greedy and are caught), read a red they are still daring through 100–350ms late, and occasionally stall for 0.45s.

## Inspired by

Inspired by Mario Party's mash-the-button races (Mecha-Marathon, Pokey Pummel), the playground game Red Light, Green Light, and push-your-luck dice games where you bank or bust. This is our own design: no names, art, code or audio were copied.
