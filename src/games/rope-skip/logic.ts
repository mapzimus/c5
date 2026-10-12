/**
 * Pure Rope Riot rules: rope phase, jump arc, sweep check, the pot (push-your-luck),
 * ghost whips, safety nets, bot timing and scoring. No DOM.
 */

export const TAU = Math.PI * 2;
export const ROUND_SECONDS = 15;
export const AIR_TIME = 0.45;
/** Fraction of the jump arc's peak the feet must clear for the rope to pass under. */
export const CLEAR_FRACTION = 0.2;
/** Rope angular speed limits (rad/s). One full turn takes TAU / omega seconds. */
export const MIN_OMEGA = 2.4;
export const MAX_OMEGA = 9;
/** Rope phase where it sweeps the jumpers' feet. 0 = overhead. */
export const BOTTOM = Math.PI;
export const BOT_LEAD = 0.2;
/** Clearing with less height margin than this is a close call (sparks, "SO CLOSE"). */
export const CLOSE_CALL_MARGIN = 0.12;
/** Every this many clears in a row is a streak milestone (fanfare only; the pot is the reward). */
export const STREAK_EVERY = 5;

// ---- the pot (push your luck) ----
/** Points a clear adds to the jumper's pot; doubled during overdrive. */
export const CLEAR_POINTS = 1;
/** The last seconds of a round are OVERDRIVE: clears pay double and the rope's floor speed rises. */
export const OVERDRIVE_SECONDS = 5;
export const OVERDRIVE_FLOOR = MIN_OMEGA + 1.6;
/** Banked on top of the pot by anyone still skipping when the round ends. */
export const SURVIVE_BONUS = 5;
/** Spinner points per knockout, on top of the victim's stolen pot. */
export const KNOCK_POINTS = 2;
/** A ghost whose whip is live when someone gets swept earns this. */
export const ASSIST_POINTS = 2;

// ---- ghost whips ----
/**
 * A whip is a grab then a snap: the ghost hauls the rope down to its floor speed for
 * WHIP_GRAB_SECONDS, then lets go and it snaps round WHIP_BOOST rad/s faster for WHIP_SECONDS.
 */
export const WHIP_GRAB_SECONDS = 0.4;
export const WHIP_SECONDS = 0.5;
export const WHIP_TOTAL = WHIP_GRAB_SECONDS + WHIP_SECONDS;
export const WHIP_BOOST = 3.4;
export const WHIP_COOLDOWN = 3;
/** Whips can push the rope past the spinner's ceiling, up to this. */
export const WHIP_MAX_OMEGA = MAX_OMEGA + 2.5;
/** Bot jumpers read the rope's speed with this much lag (s), so stutters and whips can fool them. */
export const BOT_PERCEPTION_LAG = 0.25;

export function clampOmega(omega: number): number {
  return Math.min(MAX_OMEGA, Math.max(MIN_OMEGA, Math.abs(omega)));
}

/** Slowest the rope may turn: faster once the round hits overdrive. */
export function omegaFloor(overdrive: boolean): number {
  return overdrive ? OVERDRIVE_FLOOR : MIN_OMEGA;
}

/** Phase of a whip `whipT` seconds from its end: grabbing, snapping, or nothing. */
export function whipPhase(whipT: number): "grab" | "snap" | null {
  if (whipT <= 0) return null;
  return whipT > WHIP_SECONDS ? "grab" : "snap";
}

/**
 * Rope speed actually applied this frame: spinner speed (floored), hauled down to the floor
 * while any ghost grabs it, otherwise plus every snapping whip, capped.
 */
export function effectiveOmega(omega: number, overdrive: boolean, grabs: number, snaps: number): number {
  const floor = omegaFloor(overdrive);
  if (grabs > 0) return floor;
  const base = Math.max(floor, omega);
  return Math.min(WHIP_MAX_OMEGA, base + snaps * WHIP_BOOST);
}

/** True when the rope passed its bottom while moving from `prev` to `next` (unwrapped angles, next >= prev). */
export function crossedBottom(prev: number, next: number): boolean {
  return Math.floor((next - BOTTOM) / TAU) > Math.floor((prev - BOTTOM) / TAU);
}

/** Seconds until the rope next reaches the bottom at constant `omega`. */
export function timeToBottom(phi: number, omega: number): number {
  let d = (BOTTOM - phi) % TAU;
  if (d <= 0) d += TAU;
  return d / Math.max(1e-6, omega);
}

/** Jump height as a fraction of peak (0..1) `t` seconds after takeoff. 0 when grounded. */
export function jumpHeight(t: number | null): number {
  if (t === null || t < 0 || t >= AIR_TIME) return 0;
  const u = t / AIR_TIME;
  return 4 * u * (1 - u);
}

/** True when a jumper `t` seconds into a jump (null = grounded) is high enough to clear the rope. */
export function isClear(t: number | null): boolean {
  return jumpHeight(t) > CLEAR_FRACTION;
}

/** True when a clear was barely a clear. */
export function isCloseCall(t: number | null): boolean {
  const h = jumpHeight(t);
  return h > CLEAR_FRACTION && h < CLEAR_FRACTION + CLOSE_CALL_MARGIN;
}

/** True when the round is in its overdrive climax. */
export function isOverdrive(timeLeft: number): boolean {
  return timeLeft <= OVERDRIVE_SECONDS;
}

/** Pot earned by one clear with `timeLeft` seconds on the round clock. */
export function clearPoints(timeLeft: number): number {
  return isOverdrive(timeLeft) ? CLEAR_POINTS * 2 : CLEAR_POINTS;
}

/** True when a clear streak just hit a milestone. */
export function isStreakMilestone(streak: number): boolean {
  return streak > 0 && streak % STREAK_EVERY === 0;
}

/** What a sweep does to a jumper: knockout and theft, or a stumble if they carry a safety net. */
export function sweepOutcome(pot: number, hasNet: boolean): { out: boolean; kept: number; stolen: number; spinnerGain: number } {
  if (hasNet) {
    const kept = Math.floor(pot / 2);
    const stolen = pot - kept;
    return { out: false, kept, stolen, spinnerGain: stolen };
  }
  return { out: true, kept: 0, stolen: pot, spinnerGain: KNOCK_POINTS + pot };
}

/** Points banked by a jumper still skipping when the round ends. */
export function surviveReward(pot: number): number {
  return pot + SURVIVE_BONUS;
}

/**
 * Comeback edge: from round two on, whoever is strictly behind the leader and sitting
 * in last place starts the round with a safety net (first sweep stumbles instead of knocking out).
 */
export function hasSafetyNet(scores: readonly number[], seat: number, round: number): boolean {
  if (round <= 0 || scores.length < 2) return false;
  const mine = scores[seat];
  if (mine === undefined) return false;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return mine === min && min < max;
}

/** Launch velocity (px/s) for a jumper the rope just swept, scaled by rope speed. */
export function knockVelocity(omega: number, rand: () => number): { vx: number; vy: number; spin: number } {
  const k = Math.min(1, omega / MAX_OMEGA);
  return {
    vx: 180 + k * 420 + rand() * 80,
    vy: -(260 + k * 360),
    spin: 6 + k * 10 + rand() * 4,
  };
}

/** Wrapped signed angle difference in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * Spinner order: index into players for each round. A solo player gets a single
 * round against the CPU spinner (-1); a duel goes two rounds each so it lasts a match.
 */
export function spinnerOrder(playerCount: number): number[] {
  if (playerCount <= 1) return [-1];
  if (playerCount === 2) return [0, 1, 0, 1];
  return Array.from({ length: playerCount }, (_, i) => i);
}

export interface SpinSegment {
  kind: "cruise" | "burst" | "stutter";
  omega: number;
  duration: number;
}

/**
 * Next chunk of the bot spinner's random schedule. A juicy pot on the floor (`greed` 0..1)
 * makes the bot burst more and cruise less.
 */
export function nextBotSegment(rand: () => number, greed = 0): SpinSegment {
  const r = rand();
  const span = (a: number, b: number) => a + rand() * (b - a);
  const burstChance = 0.25 + 0.2 * greed;
  if (r < burstChance) return { kind: "burst", omega: span(7, MAX_OMEGA), duration: span(0.6, 1.4) };
  if (r < burstChance + 0.2) return { kind: "stutter", omega: MIN_OMEGA, duration: span(0.25, 0.6) };
  return { kind: "cruise", omega: span(3.2, 6), duration: span(1, 2.4) };
}

/** How early (s before the rope hits bottom) a bot jumper takes off this turn. */
export function botLead(rand: () => number): number {
  const noise = (rand() + rand() - 1) * 0.06;
  if (rand() < 0.08) return BOT_LEAD + (rand() < 0.5 ? -0.22 : 0.3);
  return BOT_LEAD + noise;
}

/** Pot size at which a bot jumper starts thinking about banking (its nerve for this round). */
export function botBailThreshold(rand: () => number): number {
  return 6 + Math.floor(rand() * 8);
}

/**
 * Bot banking decision, asked once per clear while safely grounded. Greedy in overdrive
 * (double points), hesitant otherwise, and never with an empty pot.
 */
export function botWantsBail(pot: number, threshold: number, overdrive: boolean, rand: () => number): boolean {
  if (pot <= 0) return false;
  const need = overdrive ? threshold + 4 : threshold;
  if (pot < need) return false;
  return rand() < (overdrive ? 0.35 : 0.6);
}

/**
 * Bot ghost: whip while the rope is on approach and someone is still grounded, so the grab
 * lands just before they would take off.
 */
export function botShouldWhip(ttb: number, groundedTargets: number, rand: () => number): boolean {
  if (groundedTargets <= 0) return false;
  if (ttb < 0.3 || ttb > 0.75) return false;
  return rand() < 0.55;
}
