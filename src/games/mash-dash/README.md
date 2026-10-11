# Mash Dash

A 2–4 player wind-up foot race on one screen. Each player gets a horizontal lane; tap anywhere in your lane.

- Every tap hops your runner forward a step. Taps within 200ms of each other chain into a speed bonus (up to 1.6x per step after 12 quick taps). Pause and the bonus resets.
- A traffic light at the top cycles **GREEN** (mash!) and **RED** (freeze!). Tapping during RED makes you trip: you fall flat, slide back 5% of the track and lie stunned for 0.8s (taps ignored).
- In the first half, RED is announced by a 0.3s **YELLOW** warning. Once anyone passes the halfway mark the yellow disappears and reds get shorter and more frequent.
- Lane hazards: a banana peel wastes your next tap (slip), a spring launches you forward 7% of the track. Each lane gets one spring and 1–2 bananas at random spots.
- First across the finish line wins and starts a 10s countdown. Others are placed as they cross; when the countdown ends everyone remaining is placed by distance.
- Score: 1st 10 pts, 2nd 7, 3rd 4, 4th 2. Stats: Taps and Trips.
- Bots mash at 6–9 Hz with jitter, notice a RED after 150–400ms (so they sometimes trip), usually ease off on yellow, and occasionally stall for 0.5s.

## Inspired by

Inspired by Mario Party's mash-the-button races (Mecha-Marathon, Pokey Pummel) and the playground game Red Light, Green Light. This is our own design: no names, art, code or audio were copied.
