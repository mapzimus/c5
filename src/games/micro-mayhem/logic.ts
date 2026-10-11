import type { Rng } from "../../core/rng";

/**
 * Pure rules and microgames for Micro Mayhem. No DOM: the microgames only draw on
 * whatever 2D context they are handed, and bots drive them through the same
 * `handle()` path as a finger.
 */

export const MICROGAMES_PER_MATCH = 15;
export const CARD_S = 1.1;
export const RESULT_S = 0.6;
export const INTRO_S = 1.3;
export const FINAL_S = 2.4;
/** Play time per microgame, by speed tier (every 5 microgames ramps a tier). */
export const TIER_LIMITS = [3.6, 3.0, 2.4] as const;
/** Bot success odds per tier. */
export const BOT_SUCCESS = [0.8, 0.7, 0.58] as const;
/** A jinxed bot succeeds this fraction as often (humans suffer through the distortion itself). */
export const BOT_JINX_FACTOR = 0.6;
export const BOT_DELAY_MIN = 0.2;
export const BOT_DELAY_MAX = 0.7;
/** Heat multiplier caps here. */
export const HEAT_MAX = 3;
/** Points lost when a DOUBLE wager fails (doubled in overdrive). */
export const WAGER_PENALTY = 2;
/** Microgame index from which every point counts double. */
export const OVERDRIVE_FROM = 10;
/** Trailing the leader by this many points (and being last) makes you the underdog. */
export const UNDERDOG_GAP = 3;

export type MicroKind = "pop" | "swat" | "catch" | "dodge" | "match" | "hold" | "shake" | "stop";
export const MICRO_KINDS: readonly MicroKind[] = ["pop", "swat", "catch", "dodge", "match", "hold", "shake", "stop"];

/** Lane distortions a JINX can cast on a rival's next microgame. */
export type JinxKind = "flip" | "spin" | "tiny" | "fog";
export const JINX_KINDS: readonly JinxKind[] = ["flip", "spin", "tiny", "fog"];
export const JINX_LABEL: Record<JinxKind, string> = { flip: "FLIPPED", spin: "SPINNING", tiny: "TINY", fog: "FOGGED" };
/** Scale used by the TINY jinx: tap targets stay >= the minimum touch size. */
export const TINY_SCALE = 0.72;
export const SPIN_RATE = 2.2;

export function tierOf(index: number): number {
  return Math.min(TIER_LIMITS.length - 1, Math.floor(index / 5));
}

export function limitFor(index: number): number {
  return TIER_LIMITS[tierOf(index)]!;
}

/** True when microgame `index` starts a faster tier (5, 10). */
export function isSpeedUp(index: number): boolean {
  return index > 0 && index % 5 === 0 && tierOf(index) !== tierOf(index - 1);
}

export function isOverdrive(index: number): boolean {
  return index >= OVERDRIVE_FROM;
}

/** Random microgame order with no immediate repeats. */
export function planOrder(rng: Rng, count = MICROGAMES_PER_MATCH): MicroKind[] {
  const out: MicroKind[] = [];
  let last: MicroKind | null = null;
  for (let i = 0; i < count; i++) {
    const pool = MICRO_KINDS.filter((k) => k !== last);
    const kind = rng.pick(pool);
    out.push(kind);
    last = kind;
  }
  return out;
}

/** Heat multiplier for a run of `streak` consecutive successes: x1, x2 from 2 in a row, x3 from 4. */
export function heatFor(streak: number): number {
  return Math.min(HEAT_MAX, 1 + Math.floor(streak / 2));
}

export interface RoundSeat {
  success: boolean;
  /** Seconds from microgame start to the success, null when failed. */
  at: number | null;
  /** Heat multiplier the seat played this microgame with. */
  heat: number;
  /** DOUBLE wager armed during the card. */
  wagered: boolean;
  /** Underdogs lose nothing when a wager fails. */
  underdog: boolean;
}

export interface RoundScore {
  /** Score change per seat (can be negative; callers floor the total at 0). */
  deltas: number[];
  fastest: number | null;
}

/**
 * Success scores `heat` points, x2 when doubled, +1 to the single fastest success; everything
 * x2 in overdrive. A failed wager costs WAGER_PENALTY (x2 in overdrive) unless the seat is the underdog.
 */
export function scoreRound(seats: readonly RoundSeat[], overdrive: boolean): RoundScore {
  const mult = overdrive ? 2 : 1;
  let fastest: number | null = null;
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i]!;
    if (!s.success || s.at === null) continue;
    if (fastest === null || s.at < seats[fastest]!.at!) fastest = i;
  }
  const deltas = seats.map((s, i) => {
    if (s.success) return (s.heat * (s.wagered ? 2 : 1) + (fastest === i ? 1 : 0)) * mult;
    return s.wagered && !s.underdog ? -WAGER_PENALTY * mult : 0;
  });
  return { deltas, fastest };
}

/** Legacy helper kept for the simple case: 1 per success, +1 fastest. */
export function scoreOutcomes(outcomes: readonly { success: boolean; at: number | null }[]): { points: number[]; fastest: number | null } {
  const r = scoreRound(outcomes.map((o) => ({ ...o, heat: 1, wagered: false, underdog: false })), false);
  return { points: r.deltas, fastest: r.fastest };
}

/**
 * JINX punches up: the fastest seat hexes the highest-scoring rival whose score is at least their own.
 * Returns null when nobody qualifies (the jinxer is alone in front).
 */
export function pickJinxTarget(scores: readonly number[], jinxer: number): number | null {
  const mine = scores[jinxer] ?? 0;
  let target: number | null = null;
  for (let i = 0; i < scores.length; i++) {
    if (i === jinxer) continue;
    const sc = scores[i]!;
    if (sc < mine) continue;
    if (target === null || sc > scores[target]!) target = i;
  }
  return target;
}

/** Last place (ties allowed) and at least UNDERDOG_GAP behind the leader. */
export function isUnderdog(scores: readonly number[], i: number): boolean {
  if (scores.length < 2) return false;
  const mine = scores[i] ?? 0;
  const top = Math.max(...scores);
  const low = Math.min(...scores);
  return mine === low && top - mine >= UNDERDOG_GAP;
}

/** Odds a bot arms DOUBLE: underdogs nearly always, otherwise more when behind, hot or in overdrive. */
export function botWagerChance(opts: { deficit: number; heat: number; underdog: boolean; overdrive: boolean }): number {
  if (opts.underdog) return 0.9;
  const p = 0.15 + Math.min(0.25, opts.deficit * 0.05) + (opts.heat - 1) * 0.12 + (opts.overdrive ? 0.15 : 0);
  return Math.max(0, Math.min(0.75, p));
}

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MicroInput {
  type: "down" | "move" | "up";
  /** Logical canvas coords. */
  x: number;
  y: number;
  id: number;
}

export interface MicroOptions {
  limit: number;
  minTap: number;
}

export interface BotPlan {
  delay: number;
  succeed: boolean;
}

/** Affine lane distortion about the play-area centre. */
export interface JinxTransform {
  scale: number;
  rot: number;
  /** -1 mirrors vertically. */
  flipY: number;
}

export function jinxTransform(kind: JinxKind | null, t: number): JinxTransform {
  switch (kind) {
    case "flip": return { scale: 1, rot: 0, flipY: -1 };
    case "spin": return { scale: 1, rot: t * SPIN_RATE, flipY: 1 };
    case "tiny": return { scale: TINY_SCALE, rot: 0, flipY: 1 };
    default: return { scale: 1, rot: 0, flipY: 1 };
  }
}

/** Map a point in play-area coords through the inverse of the distortion (finger -> world). */
export function unjinxPoint(xf: JinxTransform, cx: number, cy: number, x: number, y: number): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-xf.rot);
  const s = Math.sin(-xf.rot);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return { x: cx + rx / xf.scale, y: cy + ry / (xf.scale * xf.flipY) };
}

export interface Sparks {
  burst(x: number, y: number, colors: readonly string[], big?: boolean): void;
}

const FONT = "Bebas Neue, Impact, sans-serif";
/** Space reserved at the top of a zone for name, score and heat. */
export const ZONE_HEADER = 110;

/** A short set of distinct, readable colours for props. */
const PROP_COLORS = ["#FF3D7A", "#3EE0FF", "#FFB020", "#B8FF3D", "#C77DFF", "#FF8C42"] as const;

export abstract class Microgame {
  abstract readonly kind: MicroKind;
  abstract readonly label: string;
  abstract readonly hint: string;
  success = false;
  failed = false;
  /** Set by a microgame when a failure was a whisker away ("SO CLOSE"). */
  nearMiss = false;
  /** Seconds since reset. */
  t = 0;
  successAt: number | null = null;
  /** Lane distortion in force for this microgame. */
  jinx: JinxKind | null = null;
  /** Last finger position in play coords (the FOG spotlight follows it). */
  lastTouch: { x: number; y: number } | null = null;
  private hintDeferred = false;
  protected zone: Zone = { x: 0, y: 0, w: 320, h: 720 };
  protected limit = 4;
  protected minTap = 60;
  protected rng!: Rng;
  protected bot: BotPlan | null = null;
  protected botDone = false;
  protected sparks: Sparks | null = null;

  get done(): boolean {
    return this.success || this.failed;
  }

  /** Width/height of the play area below the header, in zone-local coords. */
  protected get pw(): number {
    return this.zone.w;
  }
  protected get ph(): number {
    return this.zone.h - ZONE_HEADER;
  }

  reset(zone: Zone, rng: Rng, options: MicroOptions, sparks: Sparks | null = null): void {
    this.zone = zone;
    this.rng = rng;
    this.limit = options.limit;
    this.minTap = options.minTap;
    this.sparks = sparks;
    this.success = false;
    this.failed = false;
    this.nearMiss = false;
    this.t = 0;
    this.successAt = null;
    this.bot = null;
    this.botDone = false;
    this.jinx = null;
    this.lastTouch = null;
    this.setup();
  }

  setBot(plan: BotPlan): void {
    this.bot = plan;
    this.botDone = false;
  }

  /** Time's up: anything not finished counts as a miss and ignores further input. */
  lock(): void {
    if (!this.done) this.failed = true;
  }

  update(dt: number): void {
    if (this.done) {
      this.t += dt;
      return;
    }
    this.t += dt;
    if (this.bot && !this.botDone) this.botTick(dt);
    this.step(dt);
    if (!this.done && this.t >= this.limit) this.fail();
  }

  /** Feed one pointer event (already in logical canvas coords). A jinx warps the finger the same way it warps the lane. */
  handle(ev: MicroInput): void {
    if (this.done) return;
    const local = { x: ev.x - this.zone.x, y: ev.y - this.zone.y - ZONE_HEADER };
    this.lastTouch = local;
    const p = unjinxPoint(jinxTransform(this.jinx, this.t), this.pw / 2, this.ph / 2, local.x, local.y);
    this.input({ ...ev, x: p.x, y: p.y });
  }

  /** Draw in zone space: (0,0) is the top-left of the play area under the header. */
  render(g: CanvasRenderingContext2D, zone: Zone): void {
    g.save();
    g.beginPath();
    g.rect(zone.x, zone.y, zone.w, zone.h);
    g.clip();
    g.translate(zone.x, zone.y + ZONE_HEADER);
    const xf = jinxTransform(this.jinx, this.t);
    const cx = this.pw / 2;
    const cy = this.ph / 2;
    this.hintDeferred = this.jinx !== null;
    g.save();
    g.translate(cx, cy);
    g.rotate(xf.rot);
    g.scale(xf.scale, xf.scale * xf.flipY);
    g.translate(-cx, -cy);
    this.draw(g);
    g.restore();
    if (this.jinx === "fog" && !this.done) this.drawFog(g);
    if (this.hintDeferred) {
      this.hintDeferred = false;
      this.drawHint(g);
    }
    g.restore();
  }

  private drawFog(g: CanvasRenderingContext2D): void {
    const c = this.lastTouch ?? { x: this.pw / 2, y: this.ph / 2 };
    const r = Math.max(this.pw * 0.3, this.minTap * 1.6);
    const grad = g.createRadialGradient(c.x, c.y, r * 0.5, c.x, c.y, r * 1.6);
    grad.addColorStop(0, "rgba(10,6,24,0)");
    grad.addColorStop(1, "rgba(10,6,24,0.93)");
    g.fillStyle = grad;
    g.fillRect(0, 0, this.pw, this.ph);
  }

  protected win(): void {
    if (this.done) return;
    this.success = true;
    this.successAt = this.t;
  }

  protected fail(): void {
    if (this.done) return;
    this.failed = true;
  }

  protected spark(x: number, y: number, colors: readonly string[], big = false): void {
    this.sparks?.burst(this.zone.x + x, this.zone.y + ZONE_HEADER + y, colors, big);
  }

  /** Synthesized input for bots, in play-area coords. */
  protected botInput(type: MicroInput["type"], x: number, y: number): void {
    if (this.done) return;
    this.input({ type, x, y, id: -1 });
  }

  protected abstract setup(): void;
  protected abstract step(dt: number): void;
  protected abstract input(ev: MicroInput): void;
  protected abstract draw(g: CanvasRenderingContext2D): void;
  protected abstract botTick(dt: number): void;

  protected drawHint(g: CanvasRenderingContext2D): void {
    if (this.hintDeferred) return;
    g.save();
    g.fillStyle = "rgba(244,247,251,0.35)";
    g.font = `700 ${Math.round(Math.min(26, this.pw * 0.08))}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText(this.hint, this.pw / 2, this.ph - 10);
    g.restore();
  }
}

/* ------------------------------------------------------------------ POP! */

interface Balloon {
  x: number;
  y: number;
  r: number;
  color: string;
  rising: boolean;
  popped: boolean;
}

export class PopGame extends Microgame {
  readonly kind = "pop";
  readonly label = "POP!";
  readonly hint = "TAP THE RISING ONE";
  balloons: Balloon[] = [];

  protected setup(): void {
    const n = 4;
    const r = Math.max(34, this.minTap * 0.55, Math.min(this.pw / 6, 60));
    const risingIdx = this.rng.int(0, n - 1);
    const colors = shuffled(PROP_COLORS, this.rng);
    this.balloons = [];
    for (let i = 0; i < n; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = this.pw * (0.3 + col * 0.4) + this.rng.float(-r * 0.3, r * 0.3);
      const y = this.ph * (0.42 + row * 0.3);
      this.balloons.push({ x, y, r, color: colors[i]!, rising: i === risingIdx, popped: false });
    }
  }

  protected step(dt: number): void {
    const speed = (this.ph * 0.55) / Math.max(0.6, this.limit * 0.6);
    for (const b of this.balloons) {
      if (b.rising && !b.popped) {
        b.y -= speed * dt;
        if (b.y < -b.r * 1.5) this.fail();
      }
    }
  }

  protected input(ev: MicroInput): void {
    if (ev.type !== "down") return;
    let hit: Balloon | null = null;
    let best = Infinity;
    for (const b of this.balloons) {
      const d = Math.hypot(ev.x - b.x, ev.y - b.y);
      if (d < b.r * 1.25 && d < best) {
        best = d;
        hit = b;
      }
    }
    if (!hit) return;
    hit.popped = true;
    this.spark(hit.x, hit.y, [hit.color, "#ffffff"], hit.rising);
    if (hit.rising) this.win();
    else this.fail();
  }

  protected botTick(_dt: number): void {
    const plan = this.bot!;
    if (this.t < plan.delay) return;
    this.botDone = true;
    const target = plan.succeed
      ? this.balloons.find((b) => b.rising)!
      : this.rng.pick(this.balloons.filter((b) => !b.rising));
    this.botInput("down", target.x, target.y);
  }

  protected draw(g: CanvasRenderingContext2D): void {
    for (const b of this.balloons) {
      if (b.popped) continue;
      g.save();
      g.translate(b.x, b.y);
      g.strokeStyle = "rgba(244,247,251,0.4)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, b.r);
      g.quadraticCurveTo(8, b.r + 25, 0, b.r + 50);
      g.stroke();
      g.fillStyle = b.color;
      g.beginPath();
      g.ellipse(0, 0, b.r * 0.85, b.r, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.3)";
      g.beginPath();
      g.ellipse(-b.r * 0.3, -b.r * 0.35, b.r * 0.2, b.r * 0.3, -0.4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    this.drawHint(g);
  }
}

/* ----------------------------------------------------------------- SWAT! */

export class SwatGame extends Microgame {
  readonly kind = "swat";
  readonly label = "SWAT!";
  readonly hint = "TAP THE FLY";
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  r = 30;
  wing = 0;
  swats: { x: number; y: number; life: number }[] = [];

  protected setup(): void {
    this.r = Math.max(28, this.minTap * 0.5);
    this.x = this.pw / 2;
    this.y = this.ph * 0.45;
    this.swats = [];
    this.pickTarget();
  }

  private pickTarget(): void {
    const m = this.r * 1.5;
    this.tx = this.rng.float(m, this.pw - m);
    this.ty = this.rng.float(m, this.ph * 0.8 - m);
  }

  protected step(dt: number): void {
    this.wing += dt * 60;
    const speed = Math.max(this.pw, this.ph) * (1.2 + (4 - this.limit) * 0.25);
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 6) {
      this.pickTarget();
      return;
    }
    const s = Math.min(d, speed * dt);
    this.x += (dx / d) * s;
    this.y += (dy / d) * s;
    for (const sw of this.swats) sw.life -= dt;
    this.swats = this.swats.filter((sw) => sw.life > 0);
  }

  protected input(ev: MicroInput): void {
    if (ev.type !== "down") return;
    this.swats.push({ x: ev.x, y: ev.y, life: 0.25 });
    const d = Math.hypot(ev.x - this.x, ev.y - this.y);
    if (d < this.r * 1.4) {
      this.spark(this.x, this.y, ["#B8FF3D", "#2d3b12"], true);
      this.win();
    } else if (d < this.r * 2.6) {
      this.nearMiss = true;
    }
  }

  protected botTick(_dt: number): void {
    const plan = this.bot!;
    if (this.t < plan.delay) return;
    if (plan.succeed) {
      this.botDone = true;
      this.botInput("down", this.x, this.y);
    } else {
      // Keeps swinging just behind the fly: looks like trying, never lands.
      if (this.rng.next() < 0.06) this.botInput("down", this.x - this.r * 3, this.y + this.r * 2);
    }
  }

  protected draw(g: CanvasRenderingContext2D): void {
    for (const sw of this.swats) {
      g.save();
      g.globalAlpha = sw.life / 0.25;
      g.strokeStyle = "#F4F7FB";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(sw.x, sw.y, this.r * 1.3 * (1 - sw.life / 0.25) + 6, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    if (this.success) return this.drawHint(g);
    g.save();
    g.translate(this.x, this.y);
    const flap = Math.sin(this.wing) * 0.5;
    g.fillStyle = "rgba(200,230,255,0.45)";
    g.beginPath();
    g.ellipse(-this.r * 0.5, -this.r * 0.4, this.r * 0.7, this.r * 0.3, -0.6 + flap, 0, Math.PI * 2);
    g.ellipse(this.r * 0.5, -this.r * 0.4, this.r * 0.7, this.r * 0.3, 0.6 - flap, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1c2230";
    g.beginPath();
    g.ellipse(0, 0, this.r * 0.55, this.r * 0.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#FF3D7A";
    g.beginPath();
    g.arc(-this.r * 0.2, -this.r * 0.15, this.r * 0.14, 0, Math.PI * 2);
    g.arc(this.r * 0.2, -this.r * 0.15, this.r * 0.14, 0, Math.PI * 2);
    g.fill();
    g.restore();
    this.drawHint(g);
  }
}

/* ---------------------------------------------------------------- CATCH! */

export class CatchGame extends Microgame {
  readonly kind = "catch";
  readonly label = "CATCH!";
  readonly hint = "DRAG THE BASKET";
  eggX = 0;
  eggY = 0;
  eggVy = 0;
  basketX = 0;
  basketW = 100;
  landY = 0;
  splat = false;
  private pointer: number | null = null;
  private botTargetX = 0;

  protected setup(): void {
    this.basketW = Math.max(90, this.minTap * 1.4, this.pw * 0.28);
    this.basketX = this.pw / 2;
    this.landY = this.ph * 0.78;
    this.splat = false;
    this.pointer = null;
    const margin = this.basketW * 0.6;
    this.eggX = this.rng.float(margin, this.pw - margin);
    // Make sure the egg is clearly not already over the basket.
    if (Math.abs(this.eggX - this.basketX) < this.basketW * 0.7) {
      this.eggX = this.eggX < this.basketX ? margin : this.pw - margin;
    }
    this.eggY = -30;
    // Lands at ~65% of the limit under constant acceleration from rest.
    const fallT = this.limit * 0.65;
    this.eggVy = 0;
    this.gravity = (2 * (this.landY - this.eggY)) / (fallT * fallT);
    this.botTargetX = this.eggX;
  }
  private gravity = 500;

  protected step(dt: number): void {
    this.eggVy += this.gravity * dt;
    this.eggY += this.eggVy * dt;
    if (this.eggY >= this.landY) {
      this.eggY = this.landY;
      if (Math.abs(this.eggX - this.basketX) <= this.basketW / 2) {
        this.spark(this.eggX, this.eggY, ["#FFB020", "#ffffff"], true);
        this.win();
      } else {
        this.splat = true;
        this.nearMiss = Math.abs(this.eggX - this.basketX) - this.basketW / 2 < this.basketW * 0.35;
        this.spark(this.eggX, this.eggY + 10, ["#FFE08A", "#f4f7fb"]);
        this.fail();
      }
    }
  }

  protected input(ev: MicroInput): void {
    if (ev.type === "down") {
      this.pointer = ev.id;
      this.basketX = clamp(ev.x, this.basketW / 2, this.pw - this.basketW / 2);
    } else if (ev.type === "move" && ev.id === this.pointer) {
      this.basketX = clamp(ev.x, this.basketW / 2, this.pw - this.basketW / 2);
    } else if (ev.type === "up" && ev.id === this.pointer) {
      this.pointer = null;
    }
  }

  protected botTick(dt: number): void {
    const plan = this.bot!;
    if (this.t < plan.delay) return;
    if (!plan.succeed && this.botTargetX === this.eggX) {
      // Overshoots to the wrong side.
      this.botTargetX = this.eggX + (this.eggX < this.pw / 2 ? 1 : -1) * this.basketW * 1.1;
    }
    const want = clamp(this.botTargetX, this.basketW / 2, this.pw - this.basketW / 2);
    const step = this.pw * 1.6 * dt;
    const nx = this.basketX + clamp(want - this.basketX, -step, step);
    this.botInput(this.t - plan.delay < dt ? "down" : "move", nx, this.ph * 0.8);
  }

  protected draw(g: CanvasRenderingContext2D): void {
    // Ground line.
    g.fillStyle = "rgba(244,247,251,0.08)";
    g.fillRect(0, this.landY + 18, this.pw, 4);
    // Basket.
    g.save();
    g.translate(this.basketX, this.landY + 10);
    g.fillStyle = "#b8784a";
    g.beginPath();
    g.moveTo(-this.basketW / 2, -22);
    g.lineTo(this.basketW / 2, -22);
    g.lineTo(this.basketW / 2 - 12, 18);
    g.lineTo(-this.basketW / 2 + 12, 18);
    g.closePath();
    g.fill();
    g.strokeStyle = "#7a4a28";
    g.lineWidth = 3;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(-this.basketW / 2 + 6, -8 + i * 12);
      g.lineTo(this.basketW / 2 - 6, -8 + i * 12);
      g.stroke();
    }
    g.restore();
    // Egg.
    g.save();
    g.translate(this.eggX, this.eggY);
    if (this.splat) {
      g.fillStyle = "#f4f7fb";
      g.beginPath();
      g.ellipse(0, 12, 34, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#FFB020";
      g.beginPath();
      g.arc(0, 10, 10, 0, Math.PI * 2);
      g.fill();
    } else if (!this.success) {
      g.fillStyle = "#fff4dc";
      g.beginPath();
      g.ellipse(0, 0, 18, 24, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    this.drawHint(g);
  }
}

/* ---------------------------------------------------------------- DODGE! */

export class DodgeGame extends Microgame {
  readonly kind = "dodge";
  readonly label = "DODGE!";
  readonly hint = "SWIPE UP OR DOWN";
  arrowX = 0;
  arrowY = 0;
  blobY = 0;
  blobTargetY = 0;
  dodged = 0;
  private startY: number | null = null;
  private hitTime = 0;

  protected setup(): void {
    this.blobY = this.ph * 0.45;
    this.blobTargetY = this.blobY;
    this.arrowY = this.blobY;
    this.arrowX = -60;
    this.dodged = 0;
    this.startY = null;
    this.hitTime = this.limit * 0.7;
  }

  protected step(dt: number): void {
    const blobX = this.pw * 0.65;
    const speed = (blobX + 60) / this.hitTime;
    this.arrowX += speed * dt;
    this.blobY += (this.blobTargetY - this.blobY) * Math.min(1, dt * 18);
    if (this.arrowX >= blobX - 30 && !this.done) {
      if (this.dodged !== 0) {
        this.spark(blobX, this.blobY, ["#B8FF3D", "#ffffff"]);
        this.win();
      } else {
        this.nearMiss = this.startY !== null;
        this.spark(blobX, this.blobY, ["#FF3D7A", "#F4F7FB"], true);
        this.fail();
      }
    }
  }

  protected input(ev: MicroInput): void {
    if (this.dodged !== 0) return;
    if (ev.type === "down") {
      this.startY = ev.y;
    } else if ((ev.type === "move" || ev.type === "up") && this.startY !== null) {
      const dy = ev.y - this.startY;
      if (Math.abs(dy) >= Math.max(30, this.minTap * 0.4)) this.dodge(Math.sign(dy));
    }
  }

  dodge(dir: number): void {
    this.dodged = dir;
    this.startY = null;
    this.blobTargetY = this.blobY + dir * this.ph * 0.28;
  }

  protected botTick(_dt: number): void {
    const plan = this.bot!;
    // Dodges a bit before impact; a failing bot swipes too late.
    const when = plan.succeed ? Math.min(this.hitTime - 0.25, plan.delay + 0.3) : this.hitTime + 0.2;
    if (this.t < when) return;
    this.botDone = true;
    const dir = this.rng.sign();
    this.botInput("down", this.pw / 2, this.ph / 2);
    this.botInput("move", this.pw / 2, this.ph / 2 + dir * 80);
    this.botInput("up", this.pw / 2, this.ph / 2 + dir * 80);
  }

  protected draw(g: CanvasRenderingContext2D): void {
    const blobX = this.pw * 0.65;
    const r = Math.max(24, this.minTap * 0.4);
    // Blob.
    g.save();
    g.translate(blobX, this.blobY);
    g.fillStyle = this.failed ? "#6b7280" : "#3EE0FF";
    g.beginPath();
    g.ellipse(0, 0, r, r * 1.15, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#070b14";
    g.beginPath();
    g.arc(-r * 0.3, -r * 0.2, r * 0.12, 0, Math.PI * 2);
    g.arc(r * 0.3, -r * 0.2, r * 0.12, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Arrow.
    if (!this.failed || this.t < this.hitTime + 0.3) {
      g.save();
      g.translate(this.arrowX, this.arrowY);
      g.strokeStyle = "#FFB020";
      g.lineWidth = 6;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(-50, 0);
      g.lineTo(10, 0);
      g.stroke();
      g.fillStyle = "#FFB020";
      g.beginPath();
      g.moveTo(26, 0);
      g.lineTo(2, -12);
      g.lineTo(2, 12);
      g.closePath();
      g.fill();
      g.fillStyle = "#FF3D7A";
      g.beginPath();
      g.moveTo(-50, 0);
      g.lineTo(-62, -10);
      g.lineTo(-42, 0);
      g.lineTo(-62, 10);
      g.closePath();
      g.fill();
      g.restore();
    }
    this.drawHint(g);
  }
}

/* ---------------------------------------------------------------- MATCH! */

interface Shape {
  x: number;
  y: number;
  color: string;
  odd: boolean;
}

export class MatchGame extends Microgame {
  readonly kind = "match";
  readonly label = "MATCH!";
  readonly hint = "TAP THE ODD COLOUR";
  shapes: Shape[] = [];
  form: "circle" | "square" | "triangle" = "circle";
  size = 40;
  picked: Shape | null = null;

  protected setup(): void {
    const forms = ["circle", "square", "triangle"] as const;
    this.form = this.rng.pick(forms);
    this.size = Math.max(30, this.minTap * 0.5, Math.min(this.pw / 8, 52));
    const [base, odd] = shuffled(PROP_COLORS, this.rng);
    const oddIdx = this.rng.int(0, 2);
    this.shapes = [];
    this.picked = null;
    const vertical = this.pw < this.ph * 0.6;
    for (let i = 0; i < 3; i++) {
      const x = vertical ? this.pw / 2 : this.pw * (0.2 + i * 0.3);
      const y = vertical ? this.ph * (0.2 + i * 0.25) : this.ph * 0.42;
      this.shapes.push({ x, y, color: i === oddIdx ? odd! : base!, odd: i === oddIdx });
    }
  }

  protected step(_dt: number): void {}

  protected input(ev: MicroInput): void {
    if (ev.type !== "down") return;
    const reach = this.size * 1.6;
    let hit: Shape | null = null;
    let best = reach;
    for (const s of this.shapes) {
      const d = Math.hypot(ev.x - s.x, ev.y - s.y);
      if (d < best) {
        best = d;
        hit = s;
      }
    }
    if (!hit) return;
    this.picked = hit;
    this.spark(hit.x, hit.y, [hit.color, "#ffffff"], hit.odd);
    if (hit.odd) this.win();
    else this.fail();
  }

  protected botTick(_dt: number): void {
    const plan = this.bot!;
    if (this.t < plan.delay) return;
    this.botDone = true;
    const target = plan.succeed ? this.shapes.find((s) => s.odd)! : this.rng.pick(this.shapes.filter((s) => !s.odd));
    this.botInput("down", target.x, target.y);
  }

  protected draw(g: CanvasRenderingContext2D): void {
    for (const s of this.shapes) {
      g.save();
      g.translate(s.x, s.y);
      const sz = this.size * (this.picked === s ? 1.2 : 1);
      g.fillStyle = s.color;
      g.beginPath();
      if (this.form === "circle") g.arc(0, 0, sz, 0, Math.PI * 2);
      else if (this.form === "square") g.rect(-sz, -sz, sz * 2, sz * 2);
      else {
        g.moveTo(0, -sz * 1.1);
        g.lineTo(sz * 1.1, sz * 0.8);
        g.lineTo(-sz * 1.1, sz * 0.8);
        g.closePath();
      }
      g.fill();
      g.restore();
    }
    this.drawHint(g);
  }
}

/* ----------------------------------------------------------------- HOLD! */

export class HoldGame extends Microgame {
  readonly kind = "hold";
  readonly label = "HOLD!";
  readonly hint = "RELEASE IN THE GREEN";
  fill = 0;
  bandLo = 0.6;
  bandHi = 0.78;
  holding = false;
  released = false;
  private pointer: number | null = null;
  private botHeld = false;

  protected setup(): void {
    this.fill = 0;
    this.holding = false;
    this.released = false;
    this.pointer = null;
    this.botHeld = false;
    this.bandLo = this.rng.float(0.5, 0.72);
    this.bandHi = this.bandLo + 0.14;
  }

  /** Full bar takes ~60% of the limit. */
  private get rate(): number {
    return 1 / (this.limit * 0.6);
  }

  protected step(dt: number): void {
    if (this.holding) {
      this.fill += this.rate * dt;
      if (this.fill >= 1) {
        this.fill = 1;
        this.fail();
      }
    }
  }

  protected input(ev: MicroInput): void {
    if (ev.type === "down" && !this.holding && !this.released) {
      this.holding = true;
      this.pointer = ev.id;
    } else if (ev.type === "up" && this.holding && ev.id === this.pointer) {
      this.holding = false;
      this.released = true;
      if (this.fill >= this.bandLo && this.fill <= this.bandHi) {
        this.spark(this.pw / 2, this.barY, ["#B8FF3D", "#ffffff"], true);
        this.win();
      } else {
        this.nearMiss = Math.min(Math.abs(this.fill - this.bandLo), Math.abs(this.fill - this.bandHi)) < 0.07;
        this.fail();
      }
    }
  }

  protected botTick(_dt: number): void {
    const plan = this.bot!;
    if (!this.botHeld) {
      if (this.t < plan.delay) return;
      this.botHeld = true;
      this.botInput("down", this.pw / 2, this.ph / 2);
      // Decide the release point once: inside the band, or just outside it.
      const mid = (this.bandLo + this.bandHi) / 2;
      this.releaseAt = plan.succeed
        ? mid + this.rng.float(-0.05, 0.05)
        : this.rng.next() < 0.5 ? this.bandLo - this.rng.float(0.05, 0.2) : this.bandHi + this.rng.float(0.03, 0.15);
      return;
    }
    if (this.fill >= this.releaseAt) {
      this.botDone = true;
      this.botInput("up", this.pw / 2, this.ph / 2);
    }
  }
  private releaseAt = 0.7;

  private get barY(): number {
    return this.ph * 0.45;
  }

  protected draw(g: CanvasRenderingContext2D): void {
    const w = this.pw * 0.8;
    const h = Math.max(40, this.minTap * 0.6);
    const x = (this.pw - w) / 2;
    const y = this.barY - h / 2;
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(x, y, w, h);
    g.fillStyle = "rgba(184,255,61,0.35)";
    g.fillRect(x + w * this.bandLo, y, w * (this.bandHi - this.bandLo), h);
    const inBand = this.fill >= this.bandLo && this.fill <= this.bandHi;
    g.fillStyle = this.failed ? "#FF3D7A" : inBand ? "#B8FF3D" : "#3EE0FF";
    g.fillRect(x, y + 6, w * this.fill, h - 12);
    g.strokeStyle = "#B8FF3D";
    g.lineWidth = 3;
    g.strokeRect(x + w * this.bandLo, y, w * (this.bandHi - this.bandLo), h);
    g.strokeStyle = "rgba(244,247,251,0.3)";
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
    // Finger prompt.
    g.save();
    g.fillStyle = this.holding ? "#F4F7FB" : "rgba(244,247,251,0.45)";
    g.font = `700 ${Math.round(Math.min(40, this.pw * 0.12))}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(this.holding ? "HOLDING..." : this.released ? "" : "HOLD DOWN", this.pw / 2, this.barY + h + 36);
    g.restore();
    this.drawHint(g);
  }
}

/* ---------------------------------------------------------------- SHAKE! */

export const SHAKE_TAPS = 8;

export class ShakeGame extends Microgame {
  readonly kind = "shake";
  readonly label = "SHAKE!";
  readonly hint = "TAP TAP TAP";
  taps = 0;
  wobble = 0;
  appleY = 0;
  appleVy = 0;
  private botNext = 0;

  protected setup(): void {
    this.taps = 0;
    this.wobble = 0;
    this.appleY = 0;
    this.appleVy = 0;
    this.botNext = 0;
  }

  protected step(dt: number): void {
    this.wobble *= Math.pow(0.02, dt);
    if (this.t >= this.limit && this.taps >= SHAKE_TAPS - 2) this.nearMiss = true;
    if (this.success) {
      this.appleVy += 1400 * dt;
      this.appleY = Math.min(this.ph * 0.46, this.appleY + this.appleVy * dt);
    }
  }

  protected input(ev: MicroInput): void {
    if (ev.type !== "down") return;
    this.taps += 1;
    this.wobble = Math.min(1, this.wobble + 0.5);
    if (this.taps >= SHAKE_TAPS) {
      this.spark(this.pw / 2, this.ph * 0.3, ["#B8FF3D", "#FF3D7A"], true);
      this.win();
    }
  }

  protected botTick(_dt: number): void {
    const plan = this.bot!;
    if (this.t < plan.delay) return;
    // A failing bot mashes too slowly to get all 8 in before the buzzer.
    const want = plan.succeed ? SHAKE_TAPS : SHAKE_TAPS - 2;
    const span = Math.max(0.2, this.limit - plan.delay - (plan.succeed ? 0.4 : -0.3));
    if (this.taps >= want) {
      this.botDone = true;
      return;
    }
    if (this.t >= plan.delay + this.botNext) {
      this.botNext += span / want;
      this.botInput("down", this.pw / 2, this.ph / 2);
    }
  }

  protected draw(g: CanvasRenderingContext2D): void {
    const cx = this.pw / 2;
    const top = this.ph * 0.12;
    const trunkH = this.ph * 0.5;
    const sway = Math.sin(this.t * 40) * this.wobble * 10;
    g.save();
    g.translate(cx, top + trunkH);
    g.rotate(sway * 0.01);
    g.fillStyle = "#7a4a28";
    g.fillRect(-14, -trunkH, 28, trunkH);
    g.fillStyle = "#2f9e44";
    g.beginPath();
    g.arc(0, -trunkH, Math.min(this.pw * 0.3, 90), 0, Math.PI * 2);
    g.arc(-50, -trunkH + 30, 60, 0, Math.PI * 2);
    g.arc(50, -trunkH + 30, 60, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Apple.
    g.save();
    g.translate(cx + 30 + sway, top + 60 + this.appleY);
    g.fillStyle = "#FF3D3D";
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2f9e44";
    g.fillRect(-2, -26, 4, 12);
    g.restore();
    // Tap counter pips.
    for (let i = 0; i < SHAKE_TAPS; i++) {
      g.fillStyle = i < this.taps ? "#B8FF3D" : "rgba(244,247,251,0.15)";
      g.beginPath();
      g.arc(cx + (i - (SHAKE_TAPS - 1) / 2) * Math.min(28, this.pw / 10), this.ph * 0.76, 8, 0, Math.PI * 2);
      g.fill();
    }
    this.drawHint(g);
  }
}

/* ----------------------------------------------------------------- STOP! */

export class StopGame extends Microgame {
  readonly kind = "stop";
  readonly label = "STOP!";
  readonly hint = "TAP ON THE TARGET";
  angle = 0;
  speed = 6;
  wedgeStart = 0;
  wedgeSize = 0.7;
  stoppedAt: number | null = null;

  protected setup(): void {
    this.angle = this.rng.float(0, Math.PI * 2);
    this.speed = (Math.PI * 2) / Math.max(0.55, this.limit * 0.3);
    this.wedgeSize = 0.75;
    // Start the target at least a quarter turn ahead so there is a visible wind-up.
    this.wedgeStart = this.angle + this.rng.float(Math.PI * 0.6, Math.PI * 1.6);
    this.stoppedAt = null;
  }

  /** How far (radians) the needle angle is past the wedge start, wrapped to 0..2pi. */
  private intoWedge(a: number): number {
    return ((a - this.wedgeStart) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  }

  inWedge(a: number): boolean {
    return this.intoWedge(a) <= this.wedgeSize;
  }

  protected step(dt: number): void {
    this.angle += this.speed * dt;
  }

  protected input(ev: MicroInput): void {
    if (ev.type !== "down") return;
    this.stoppedAt = this.angle;
    const cx = this.pw / 2;
    const cy = this.ph * 0.42;
    if (this.inWedge(this.angle)) {
      this.spark(cx, cy, ["#B8FF3D", "#ffffff"], true);
      this.win();
    } else {
      const into = this.intoWedge(this.angle);
      this.nearMiss = into < this.wedgeSize + 0.35 || into > Math.PI * 2 - 0.35;
      this.spark(cx, cy, ["#FF3D7A"]);
      this.fail();
    }
  }

  protected botTick(_dt: number): void {
    const plan = this.bot!;
    if (this.t < plan.delay) return;
    // Succeeding bots tap once the needle is well inside the wedge; failing ones tap somewhere outside it.
    const into = this.intoWedge(this.angle);
    const centred = into >= this.wedgeSize * 0.3 && into <= this.wedgeSize * 0.8;
    const outside = into > this.wedgeSize + 0.2;
    if (plan.succeed ? centred : outside && this.rng.next() < 0.3) {
      this.botDone = true;
      this.botInput("down", this.pw / 2, this.ph / 2);
    }
  }

  protected draw(g: CanvasRenderingContext2D): void {
    const cx = this.pw / 2;
    const cy = this.ph * 0.42;
    const r = Math.min(this.pw * 0.38, this.ph * 0.3);
    g.save();
    g.translate(cx, cy);
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = this.failed ? "rgba(255,61,122,0.5)" : "rgba(184,255,61,0.55)";
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, this.wedgeStart, this.wedgeStart + this.wedgeSize);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(244,247,251,0.3)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
    const a = this.stoppedAt ?? this.angle;
    g.strokeStyle = this.success ? "#B8FF3D" : this.failed ? "#FF3D7A" : "#F4F7FB";
    g.lineWidth = 7;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    g.stroke();
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.arc(0, 0, 9, 0, Math.PI * 2);
    g.fill();
    g.restore();
    this.drawHint(g);
  }
}

export function makeMicrogame(kind: MicroKind): Microgame {
  switch (kind) {
    case "pop": return new PopGame();
    case "swat": return new SwatGame();
    case "catch": return new CatchGame();
    case "dodge": return new DodgeGame();
    case "match": return new MatchGame();
    case "hold": return new HoldGame();
    case "shake": return new ShakeGame();
    case "stop": return new StopGame();
  }
}

/** Bot plan for a microgame at speed tier `tier`: 200-700ms delay, ~80% success, less when faster or jinxed. */
export function planBot(rng: Rng, tier: number, jinxed = false): BotPlan {
  const chance = BOT_SUCCESS[Math.min(tier, BOT_SUCCESS.length - 1)]! * (jinxed ? BOT_JINX_FACTOR : 1);
  return { delay: rng.float(BOT_DELAY_MIN, BOT_DELAY_MAX), succeed: rng.next() < chance };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}
