import { fillArena, drawPlayerOrb } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import type { Rng } from "../../core/rng";
import type { Sfx } from "../../core/audio";

export const fling: GameDefinition = {
  id: "fling",
  name: "Fling!",
  tagline: "Slingshot your ball. Collect coins. Steal everything.",
  description:
    "90 seconds of chaos on a shared screen. Drag back your ball and release to fling it across the arena. " +
    "Roll through coins to score, smash into opponents to steal theirs. Random events shake up the board " +
    "every few seconds. The last 15 seconds is FRENZY MODE: double coins, double chaos. Highest score wins.",
  durationMs: 90_000,
  controls: "Drag back from your ball, release to fling",
  fillsScreen: true,
  create: (ctx) => new FlingGame(ctx),
};

// ── Vector helpers ──
interface Vec2 { x: number; y: number }
const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
const vadd = (a: Vec2, b: Vec2): Vec2 => v2(a.x + b.x, a.y + b.y);
const vsub = (a: Vec2, b: Vec2): Vec2 => v2(a.x - b.x, a.y - b.y);
const vmul = (a: Vec2, s: number): Vec2 => v2(a.x * s, a.y * s);
const vlen = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);
const vnorm = (a: Vec2): Vec2 => { const l = vlen(a); return l > 0.001 ? v2(a.x / l, a.y / l) : v2(); };
const vdot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const vdist = (a: Vec2, b: Vec2): number => vlen(vsub(a, b));

// ── Tuning ──
const FRICTION = 0.987;
const RESTITUTION = 0.82;
const WALL_BOUNCE = 0.75;
const POWER_SCALE = 5.5;
const MAX_POWER = 900;
const MIN_DRAG = 18;
const GRAB_RADIUS_MULT = 2.8;
const REGRAB_SPEED = 50;
const REGRAB_CD = 0.4;
const GAME_DURATION = 90;
const FRENZY_TIME = 15;
const COIN_SPAWN_BASE = 2.2;
const EVENT_INTERVAL_BASE = 9;
const MAX_COINS = 80;
const STEAL_THRESHOLD = 150;

const COIN_VALS: Record<string, number> = { bronze: 1, silver: 3, gold: 5, diamond: 10 };
const COIN_COLORS: Record<string, string> = { bronze: "#cd7f32", silver: "#c0c0c0", gold: "#ffd700", diamond: "#ff66ff", dropped: "#cd7f32" };
const PU_NAMES = ["MAGNET", "MEGA", "SHIELD", "TURBO", "DOUBLE"] as const;
const PU_COLORS: Record<string, string> = { MAGNET: "#ff6688", MEGA: "#ff66aa", SHIELD: "#44bbff", TURBO: "#ffcc00", DOUBLE: "#66ffaa" };

const EVENT_LIST = ["COIN RAIN", "QUAKE", "JACKPOT", "SHUFFLE", "SCATTER", "GRAVITY", "BONUS TIME", "BUMPERS"] as const;

// ── Sub-types ──
interface Coin {
  pos: Vec2; vel: Vec2; type: string; value: number;
  radius: number; life: number; maxLife: number; bob: number;
  dropImmunity: number; droppedBy: number;
}
interface MysteryBox { pos: Vec2; radius: number; life: number; bob: number; spin: number }
interface Bumper { pos: Vec2; radius: number; life: number }
interface Popup { x: number; y: number; text: string; color: string; size: number; life: number; maxLife: number; vy: number }

interface Seat {
  player: Player;
  pos: Vec2; vel: Vec2; radius: number; mass: number;
  grabbed: boolean; grabCd: number;
  score: number; combo: number; comboTimer: number;
  totalCollected: number; totalStolen: number;
  activePU: string | null; puTimer: number;
  turboReady: boolean; shielded: boolean; magnetTimer: number;
  aiTimer: number;
  aim: Vec2 | null;
}

class FlingGame implements GameInstance {
  private readonly W: number;
  private readonly H: number;
  private readonly ballR: number;
  private readonly coinR: number;
  private readonly seats: Seat[];
  private readonly coins: Coin[] = [];
  private readonly boxes: MysteryBox[] = [];
  private readonly bumpers: Bumper[] = [];
  private readonly popups: Popup[] = [];
  private readonly grabs = new Map<number, number>();
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly rng: Rng;
  private readonly sfx: Sfx;

  private timeLeft = GAME_DURATION;
  private frenzy = false;
  private coinTimer = 1.5;
  private silverTimer = 5;
  private goldTimer = 12;
  private boxTimer = 8;
  private eventTimer = EVENT_INTERVAL_BASE * 0.7;
  private doubleTime = 0;
  private eventBannerTimer = 0;
  private done = false;

  constructor(private readonly ctx: GameContext) {
    this.W = ctx.width;
    this.H = ctx.height;
    this.rng = ctx.rng;
    this.sfx = ctx.sfx;
    const m = Math.min(this.W, this.H);
    this.ballR = Math.max(14, m * 0.034);
    this.coinR = Math.max(5, this.ballR * 0.38);
    this.juice = new Juice(() => this.rng.next());

    const pad = 80;
    const spawns = [v2(pad, pad), v2(this.W - pad, pad), v2(pad, this.H - pad), v2(this.W - pad, this.H - pad)];
    this.seats = ctx.players.map((player, i) => ({
      player,
      pos: { ...spawns[i % 4]! }, vel: v2(), radius: this.ballR, mass: 1,
      grabbed: false, grabCd: 0,
      score: 0, combo: 0, comboTimer: 0, totalCollected: 0, totalStolen: 0,
      activePU: null, puTimer: 0,
      turboReady: false, shielded: false, magnetTimer: 0,
      aiTimer: 0.8 + this.rng.float(0, 1),
      aim: null,
    }));

    const canvas = ctx.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
  }

  // ── Multi-touch ──
  private toLogical(event: PointerEvent): Vec2 {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return v2(
      ((event.clientX - rect.left) / (rect.width || 1)) * this.W,
      ((event.clientY - rect.top) / (rect.height || 1)) * this.H,
    );
  }

  private readonly onDown = (event: PointerEvent): void => {
    const p = this.toLogical(event);
    let best = -1;
    let bestDist = this.ballR * GRAB_RADIUS_MULT;
    this.seats.forEach((seat, i) => {
      if (seat.player.kind !== "human" || seat.grabbed || seat.grabCd > 0) return;
      if (vlen(seat.vel) > REGRAB_SPEED) return;
      const d = vdist(p, seat.pos);
      if (d < bestDist) { best = i; bestDist = d; }
    });
    if (best < 0) return;
    event.preventDefault();
    this.grabs.set(event.pointerId, best);
    const seat = this.seats[best]!;
    seat.grabbed = true;
    seat.aim = p;
    try { this.ctx.canvas.setPointerCapture(event.pointerId); } catch { /* optional */ }
  };

  private readonly onMove = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    event.preventDefault();
    this.seats[i]!.aim = this.toLogical(event);
  };

  private readonly onUp = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    const seat = this.seats[i]!;
    const aim = seat.aim;
    seat.grabbed = false;
    seat.aim = null;
    if (!aim) return;
    this.launchBall(seat, aim);
  };

  private readonly onCancel = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    const seat = this.seats[i]!;
    seat.grabbed = false;
    seat.aim = null;
  };

  private launchBall(seat: Seat, aim: Vec2): void {
    const drag = vsub(aim, seat.pos);
    const dist = vlen(drag);
    if (dist < MIN_DRAG) return;
    const dir = vnorm(vmul(drag, -1));
    let power = Math.min(dist * POWER_SCALE, MAX_POWER);
    if (seat.turboReady) { power *= 2; seat.turboReady = false; }
    seat.vel = vmul(dir, power);
    seat.grabCd = REGRAB_CD;
    this.sfx.whoosh();
    this.juice.burst(seat.pos.x, seat.pos.y, seat.player.color, { count: 5, speed: 70, life: 0.25, gravity: 0 });
  }

  // ── AI ──
  private aiUpdate(seat: Seat, dt: number): void {
    if (seat.player.kind !== "bot") return;
    if (seat.grabbed || vlen(seat.vel) > REGRAB_SPEED || seat.grabCd > 0) {
      seat.aiTimer = 0.4 + this.rng.float(0, 0.6);
      return;
    }
    seat.aiTimer -= dt;
    if (seat.aiTimer > 0) return;

    let target: Vec2 | null = null;
    const nearBox = this.boxes.reduce<{ pos: Vec2; d: number } | null>((b, bx) => {
      const d = vdist(seat.pos, bx.pos);
      return d < (b ? b.d : 200) ? { pos: bx.pos, d } : b;
    }, null);

    if (nearBox && this.rng.next() < 0.4) {
      target = nearBox.pos;
    } else {
      const leader = this.seats.filter(o => o !== seat).reduce((a, b) => a.score > b.score ? a : b, { score: -1 } as Seat);
      if (leader.score > seat.score + 8 && this.rng.next() < 0.25 && vdist(seat.pos, leader.pos) < 300) {
        target = leader.pos;
      } else {
        let bestCoin: Coin | null = null;
        let bestScore = Infinity;
        for (const c of this.coins) {
          const d = vdist(seat.pos, c.pos);
          const score = d - c.value * 30;
          if (score < bestScore) { bestScore = score; bestCoin = c; }
        }
        if (bestCoin) target = bestCoin.pos;
      }
    }
    if (!target) { const a = this.rng.float(0, Math.PI * 2); target = v2(seat.pos.x + Math.cos(a) * 100, seat.pos.y + Math.sin(a) * 100); }
    const toT = vnorm(vsub(target, seat.pos));
    const wobble = (this.rng.next() - 0.5) * 0.4;
    const angle = Math.atan2(toT.y, toT.x) + wobble;
    const dir = v2(Math.cos(angle), Math.sin(angle));
    const dist = vdist(seat.pos, target);
    let power = Math.min(dist * 3 + 80 + this.rng.float(0, 200), MAX_POWER);
    if (seat.turboReady) { power *= 2; seat.turboReady = false; }
    seat.vel = vmul(dir, power);
    seat.grabCd = REGRAB_CD;
    seat.aiTimer = 0.6 + this.rng.float(0, 0.8);
    this.sfx.whoosh();
    this.juice.burst(seat.pos.x, seat.pos.y, seat.player.color, { count: 4, speed: 60, life: 0.2, gravity: 0 });
  }

  // ── Physics ──
  private updatePhysics(dt: number): void {
    for (const s of this.seats) {
      if (s.grabbed) continue;
      s.vel.x *= FRICTION; s.vel.y *= FRICTION;
      s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt;
      s.grabCd = Math.max(0, s.grabCd - dt);
      if (s.puTimer > 0) {
        s.puTimer -= dt;
        if (s.puTimer <= 0) {
          if (s.activePU === "MEGA") { s.radius = this.ballR; s.mass = 1; }
          s.activePU = null;
        }
      }
      if (s.pos.x - s.radius < 0) { s.pos.x = s.radius; s.vel.x *= -WALL_BOUNCE; this.wallFX(0, s.pos.y, s.player.color); }
      if (s.pos.x + s.radius > this.W) { s.pos.x = this.W - s.radius; s.vel.x *= -WALL_BOUNCE; this.wallFX(this.W, s.pos.y, s.player.color); }
      if (s.pos.y - s.radius < 0) { s.pos.y = s.radius; s.vel.y *= -WALL_BOUNCE; this.wallFX(s.pos.x, 0, s.player.color); }
      if (s.pos.y + s.radius > this.H) { s.pos.y = this.H - s.radius; s.vel.y *= -WALL_BOUNCE; this.wallFX(s.pos.x, this.H, s.player.color); }
    }
  }

  private wallFX(x: number, y: number, c: string): void {
    if (this.rng.next() < 0.4) this.juice.burst(x, y, c, { count: 3, speed: 40, life: 0.2, gravity: 0 });
  }

  private updateCollisions(): void {
    for (let i = 0; i < this.seats.length; i++) {
      for (let j = i + 1; j < this.seats.length; j++) {
        this.collide(this.seats[i]!, this.seats[j]!);
      }
    }
  }

  private collide(a: Seat, b: Seat): void {
    const d = vsub(b.pos, a.pos);
    const dist = vlen(d);
    const minD = a.radius + b.radius;
    if (dist >= minD || dist < 0.1) return;
    const n = vnorm(d);
    const overlap = minD - dist;
    const pushA = b.grabbed ? 1 : 0.5;
    const pushB = a.grabbed ? 1 : 0.5;
    a.pos = vsub(a.pos, vmul(n, overlap * pushA));
    b.pos = vadd(b.pos, vmul(n, overlap * pushB));
    const rv = vsub(a.vel, b.vel);
    const velN = vdot(rv, n);
    if (velN < 0) return;
    if (a.shielded) { a.shielded = false; b.vel = vadd(b.vel, vmul(n, Math.abs(velN) * 2)); this.impactFX(a, b); return; }
    if (b.shielded) { b.shielded = false; a.vel = vsub(a.vel, vmul(n, Math.abs(velN) * 2)); this.impactFX(a, b); return; }
    const mA = a.mass; const mB = b.mass;
    const imp = -(1 + RESTITUTION) * velN / (1 / mA + 1 / mB);
    a.vel.x += imp * n.x / mA; a.vel.y += imp * n.y / mA;
    b.vel.x -= imp * n.x / mB; b.vel.y -= imp * n.y / mB;
    const force = Math.abs(velN);
    this.impactFX(a, b);
    if (force > STEAL_THRESHOLD) {
      const spdA = vlen(a.vel); const spdB = vlen(b.vel);
      const stealAmt = Math.min(3, Math.floor(force / 200) + 1);
      if (spdA > spdB) {
        const stolen = Math.min(stealAmt, b.score);
        b.score -= stolen; a.score += stolen; a.totalStolen += stolen;
        if (stolen > 0) this.popup(a.pos.x, a.pos.y - 15, "+" + stolen + " STOLEN", a.player.color);
        this.dropCoins(b, Math.min(2, Math.floor(force / 300)));
      } else {
        const stolen = Math.min(stealAmt, a.score);
        a.score -= stolen; b.score += stolen; b.totalStolen += stolen;
        if (stolen > 0) this.popup(b.pos.x, b.pos.y - 15, "+" + stolen + " STOLEN", b.player.color);
        this.dropCoins(a, Math.min(2, Math.floor(force / 300)));
      }
    }
    if (a.grabbed && vlen(a.vel) > 60) { a.grabbed = false; this.releaseGrab(a); }
    if (b.grabbed && vlen(b.vel) > 60) { b.grabbed = false; this.releaseGrab(b); }
  }

  private releaseGrab(seat: Seat): void {
    seat.aim = null;
    for (const [pid, idx] of this.grabs) {
      if (this.seats[idx] === seat) { this.grabs.delete(pid); break; }
    }
  }

  private impactFX(a: Seat, b: Seat): void {
    const mid = v2((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2);
    const force = vlen(vsub(a.vel, b.vel));
    this.juice.burst(mid.x, mid.y, [a.player.color, b.player.color, "#fff"], {
      count: Math.min(14, Math.floor(force / 40) * 3 + 3), speed: force * 0.3, life: 0.3, gravity: 0,
    });
    this.sfx.hit();
    this.juice.shake(Math.min(0.5, force * 0.002));
  }

  // ── Coins ──
  private spawnCoin(type: string, x?: number, y?: number, vx = 0, vy = 0): void {
    if (this.coins.length >= MAX_COINS) return;
    if (x === undefined) { x = 40 + this.rng.float(0, this.W - 80); y = 40 + this.rng.float(0, this.H - 80); }
    const lifetimes: Record<string, number> = { bronze: 9, silver: 11, gold: 13, diamond: 16, dropped: 7 };
    this.coins.push({
      pos: v2(x, y!), vel: v2(vx, vy), type, value: COIN_VALS[type] ?? 1,
      radius: type === "diamond" ? this.coinR * 1.8 : type === "gold" ? this.coinR * 1.4 : type === "silver" ? this.coinR * 1.2 : this.coinR,
      life: lifetimes[type] ?? 9, maxLife: lifetimes[type] ?? 9, bob: this.rng.float(0, 6),
      dropImmunity: -1, droppedBy: -1,
    });
  }

  private dropCoins(seat: Seat, count: number): void {
    const idx = this.seats.indexOf(seat);
    for (let i = 0; i < count; i++) {
      if (seat.score <= 0) break;
      seat.score--;
      const a = this.rng.float(0, Math.PI * 2);
      const s = 80 + this.rng.float(0, 120);
      this.coins.push({
        pos: { ...seat.pos }, vel: v2(Math.cos(a) * s, Math.sin(a) * s), type: "dropped", value: 1,
        radius: this.coinR * 0.9, life: 7, maxLife: 7, bob: this.rng.float(0, 6),
        dropImmunity: 0.4, droppedBy: idx,
      });
    }
  }

  private updateCoins(dt: number): void {
    const fr = this.frenzy ? 0.55 : 1;
    this.coinTimer -= dt;
    if (this.coinTimer <= 0) {
      const n = this.frenzy ? 6 : 4;
      for (let i = 0; i < n; i++) this.spawnCoin("bronze");
      this.coinTimer = COIN_SPAWN_BASE * fr + this.rng.float(0, 1.5) * fr;
    }
    this.silverTimer -= dt;
    if (this.silverTimer <= 0) { this.spawnCoin("silver"); this.silverTimer = (this.frenzy ? 3 : 5.5) + this.rng.float(0, 2); }
    this.goldTimer -= dt;
    if (this.goldTimer <= 0) { this.spawnCoin("gold"); this.goldTimer = (this.frenzy ? 6 : 13) + this.rng.float(0, 4); }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i]!;
      c.life -= dt;
      if (c.life <= 0) { this.coins.splice(i, 1); continue; }
      if (c.dropImmunity > 0) c.dropImmunity -= dt;
      if (vlen(c.vel) > 1) {
        c.vel.x *= 0.96; c.vel.y *= 0.96;
        c.pos.x += c.vel.x * dt; c.pos.y += c.vel.y * dt;
        if (c.pos.x < c.radius) { c.pos.x = c.radius; c.vel.x *= -0.5; }
        if (c.pos.x > this.W - c.radius) { c.pos.x = this.W - c.radius; c.vel.x *= -0.5; }
        if (c.pos.y < c.radius) { c.pos.y = c.radius; c.vel.y *= -0.5; }
        if (c.pos.y > this.H - c.radius) { c.pos.y = this.H - c.radius; c.vel.y *= -0.5; }
      }
    }
  }

  private collectCoins(dt: number): void {
    for (const s of this.seats) {
      if (s.comboTimer > 0) { s.comboTimer -= dt; if (s.comboTimer <= 0) s.combo = 0; }
      if (s.magnetTimer > 0) {
        s.magnetTimer -= dt;
        for (const c of this.coins) {
          if (c.dropImmunity > 0 && c.droppedBy === this.seats.indexOf(s)) continue;
          const d = vdist(s.pos, c.pos);
          if (d < 130 && d > 5) { const pull = vnorm(vsub(s.pos, c.pos)); c.vel = vadd(c.vel, vmul(pull, 400 * dt)); }
        }
      }
      const seatIdx = this.seats.indexOf(s);
      for (let i = this.coins.length - 1; i >= 0; i--) {
        const c = this.coins[i]!;
        if (c.dropImmunity > 0 && c.droppedBy === seatIdx) continue;
        if (vdist(s.pos, c.pos) < s.radius + c.radius) {
          const mult = Math.min(4, 1 + Math.floor(s.combo / 3));
          const dbl = this.doubleTime > 0 ? 2 : 1;
          const pts = c.value * mult * dbl * (this.frenzy ? 2 : 1);
          s.score += pts; s.totalCollected++;
          s.combo++; s.comboTimer = 1.5;
          const col = c.type === "diamond" ? "#ff66ff" : c.type === "gold" ? "#ffd700" : c.type === "silver" ? "#e0e0e0" : "#ffb020";
          this.popup(c.pos.x, c.pos.y - 10, "+" + pts, col);
          this.juice.burst(c.pos.x, c.pos.y, COIN_COLORS[c.type] ?? "#ffb020", { count: 4, speed: 50, life: 0.2, gravity: 0 });
          if (c.type === "gold" || c.type === "diamond") this.sfx.streak(3); else this.sfx.collect();
          this.coins.splice(i, 1);
        }
      }
    }
  }

  // ── Mystery Boxes ──
  private updateBoxes(dt: number): void {
    this.boxTimer -= dt;
    if (this.boxTimer <= 0 && this.boxes.length < 2) {
      const x = 60 + this.rng.float(0, this.W - 120);
      const y = 60 + this.rng.float(0, this.H - 120);
      this.boxes.push({ pos: v2(x, y), radius: this.ballR * 0.7, life: 12, bob: this.rng.float(0, 6), spin: 0 });
      this.boxTimer = (this.frenzy ? 6 : 10) + this.rng.float(0, 4);
    }
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i]!;
      b.life -= dt; b.spin += dt * 2;
      if (b.life <= 0) { this.boxes.splice(i, 1); continue; }
      for (const s of this.seats) {
        if (vdist(s.pos, b.pos) < s.radius + b.radius) {
          this.applyPU(s);
          this.juice.burst(b.pos.x, b.pos.y, "#fff", { count: 10, speed: 80, life: 0.3, gravity: 0 });
          this.sfx.collect();
          this.boxes.splice(i, 1);
          break;
        }
      }
    }
  }

  private applyPU(s: Seat): void {
    const t = this.rng.pick(PU_NAMES);
    this.popup(s.pos.x, s.pos.y - 20, t, PU_COLORS[t] ?? "#fff", 12);
    if (t === "MAGNET") { s.magnetTimer = 6; }
    else if (t === "MEGA") {
      if (s.activePU === "MEGA") { s.radius = this.ballR; s.mass = 1; }
      s.activePU = "MEGA"; s.puTimer = 7; s.radius = this.ballR * 1.55; s.mass = 2;
    } else if (t === "SHIELD") { s.shielded = true; }
    else if (t === "TURBO") { s.turboReady = true; }
    else if (t === "DOUBLE") { this.doubleTime = Math.max(this.doubleTime, 8); }
  }

  // ── Events ──
  private updateEvents(dt: number): void {
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      const ev = this.rng.pick(EVENT_LIST);
      this.runEvent(ev);
      this.eventBannerTimer = 2;
      this.eventTimer = (this.frenzy ? 5 : EVENT_INTERVAL_BASE) + this.rng.float(0, 4);
      this.sfx.countdown();
    }
    if (this.eventBannerTimer > 0) this.eventBannerTimer -= dt;
    if (this.doubleTime > 0) this.doubleTime -= dt;
    for (let i = this.bumpers.length - 1; i >= 0; i--) {
      this.bumpers[i]!.life -= dt;
      if (this.bumpers[i]!.life <= 0) { this.bumpers.splice(i, 1); continue; }
      const bmp = this.bumpers[i]!;
      for (const s of this.seats) {
        if (vdist(s.pos, bmp.pos) < s.radius + bmp.radius) {
          const n = vnorm(vsub(s.pos, bmp.pos));
          s.vel = vadd(s.vel, vmul(n, 500));
          s.pos = vadd(bmp.pos, vmul(n, s.radius + bmp.radius + 1));
          if (s.grabbed) { s.grabbed = false; this.releaseGrab(s); }
          this.juice.burst(bmp.pos.x, bmp.pos.y, "#ff4444", { count: 6, speed: 100, life: 0.25, gravity: 0 });
          this.sfx.hit();
          this.juice.shake(0.2);
        }
      }
    }
  }

  private runEvent(ev: string): void {
    switch (ev) {
      case "COIN RAIN":
        for (let i = 0; i < (this.frenzy ? 18 : 12); i++) this.spawnCoin(this.rng.next() < 0.2 ? "silver" : "bronze");
        break;
      case "QUAKE":
        for (const s of this.seats) {
          const a = this.rng.float(0, Math.PI * 2);
          s.vel = vadd(s.vel, v2(Math.cos(a) * 400, Math.sin(a) * 400));
          if (s.grabbed) { s.grabbed = false; this.releaseGrab(s); }
        }
        this.juice.shake(0.6);
        break;
      case "JACKPOT":
        this.spawnCoin("diamond");
        this.callouts.show("JACKPOT!", "#ff66ff");
        break;
      case "SHUFFLE": {
        const positions = this.seats.map(s => ({ ...s.pos }));
        for (let i = positions.length - 1; i > 0; i--) {
          const j = this.rng.int(0, i);
          [positions[i], positions[j]] = [positions[j]!, positions[i]!];
        }
        for (let i = 0; i < this.seats.length; i++) {
          this.seats[i]!.pos = positions[i]!;
          this.seats[i]!.vel = v2();
          if (this.seats[i]!.grabbed) { this.seats[i]!.grabbed = false; this.releaseGrab(this.seats[i]!); }
        }
        this.juice.shake(0.4);
        break;
      }
      case "SCATTER": {
        const cx = this.W / 2; const cy = this.H / 2;
        for (const s of this.seats) {
          const d = vnorm(vsub(s.pos, v2(cx, cy)));
          s.vel = vadd(s.vel, vmul(d, 550));
          if (s.grabbed) { s.grabbed = false; this.releaseGrab(s); }
        }
        this.juice.shake(0.5);
        break;
      }
      case "GRAVITY": {
        const cx = this.W / 2; const cy = this.H / 2;
        for (const s of this.seats) {
          const d = vnorm(vsub(v2(cx, cy), s.pos));
          s.vel = vadd(s.vel, vmul(d, 450));
          if (s.grabbed) { s.grabbed = false; this.releaseGrab(s); }
        }
        for (const c of this.coins) { const d = vnorm(vsub(v2(cx, cy), c.pos)); c.vel = vadd(c.vel, vmul(d, 200)); }
        this.juice.shake(0.3);
        break;
      }
      case "BONUS TIME":
        this.doubleTime = Math.max(this.doubleTime, 8);
        this.callouts.show("2X COINS!", "#66ffaa");
        break;
      case "BUMPERS":
        this.bumpers.length = 0;
        for (let i = 0; i < 5; i++) {
          this.bumpers.push({
            pos: v2(60 + this.rng.float(0, this.W - 120), 60 + this.rng.float(0, this.H - 120)),
            radius: this.ballR * 1.2, life: 10,
          });
        }
        break;
    }
  }

  private popup(x: number, y: number, text: string, color: string, size = 14): void {
    this.popups.push({ x, y, text, color, size, life: 0.9, maxLife: 0.9, vy: -60 });
  }

  // ── Update ──
  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.timeLeft -= dt;
    if (!this.frenzy && this.timeLeft <= FRENZY_TIME) {
      this.frenzy = true;
      this.callouts.show("FRENZY!", "#FF3D7A", { size: 72 });
      this.sfx.go();
      this.juice.shake(0.5);
    }
    if (this.timeLeft <= 0) { this.done = true; this.sfx.win(); return; }
    for (const s of this.seats) this.aiUpdate(s, dt);
    this.updatePhysics(dt);
    this.updateCollisions();
    this.updateCoins(dt);
    this.collectCoins(dt);
    this.updateBoxes(dt);
    this.updateEvents(dt);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
  }

  isFinished(): boolean { return this.done; }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map(s => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (const s of this.seats) {
      stats.push({ playerId: s.player.id, label: "Collected", value: String(s.totalCollected) });
      if (s.totalStolen > 0) stats.push({ playerId: s.player.id, label: "Stolen", value: String(s.totalStolen) });
    }
    return stats;
  }

  destroy(): void {
    const canvas = this.ctx.canvas;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onCancel);
  }

  // ── Render ──
  render(g: CanvasRenderingContext2D): void {
    const W = this.W; const H = this.H;
    fillArena(g, W, H);
    this.juice.begin(g);

    // Grid
    g.strokeStyle = "rgba(255,255,255,0.018)"; g.lineWidth = 1;
    const step = Math.max(30, W / 20);
    for (let x = 0; x <= W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

    // Border
    const borderColor = this.frenzy ? `rgba(255,61,122,${0.4 + Math.sin(Date.now() * 0.008) * 0.3})`
      : this.doubleTime > 0 ? "rgba(102,255,170,0.4)" : "rgba(62,224,255,0.12)";
    g.strokeStyle = borderColor; g.lineWidth = 2.5;
    g.strokeRect(0, 0, W, H);

    // Bumpers
    for (const b of this.bumpers) {
      const pulse = 0.8 + Math.sin(Date.now() * 0.006) * 0.2;
      g.globalAlpha = Math.min(1, b.life / 2) * pulse;
      g.beginPath(); g.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,50,50,0.3)"; g.fill();
      g.strokeStyle = "#ff4444"; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;
    }

    // Coins
    for (const c of this.coins) {
      const bob = Math.sin(Date.now() * 0.005 + c.bob) * 1.5;
      const cx = c.pos.x; const cy = c.pos.y + bob;
      const fade = c.life < 2 ? c.life / 2 : 1;
      g.globalAlpha = fade * (c.type === "dropped" ? 0.75 : 1);
      if (c.type === "gold" || c.type === "diamond") {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, c.radius * 2.5);
        gr.addColorStop(0, COIN_COLORS[c.type]!); gr.addColorStop(1, "transparent");
        g.globalAlpha = fade * 0.15;
        g.beginPath(); g.arc(cx, cy, c.radius * 2.5, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
        g.globalAlpha = fade;
      }
      g.beginPath(); g.arc(cx, cy, c.radius, 0, Math.PI * 2);
      if (c.type === "diamond") { g.fillStyle = `hsl(${(Date.now() * 0.2) % 360},80%,65%)`; }
      else { g.fillStyle = COIN_COLORS[c.type] ?? "#cd7f32"; }
      g.fill();
      const sparkle = Math.sin(Date.now() * 0.01 + c.bob * 3);
      if (sparkle > 0.7) {
        g.fillStyle = "rgba(255,255,255,0.6)";
        g.beginPath(); g.arc(cx - c.radius * 0.3, cy - c.radius * 0.3, c.radius * 0.25, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }

    // Boxes
    for (const b of this.boxes) {
      const fade = b.life < 2 ? b.life / 2 : 1;
      g.globalAlpha = fade;
      g.save(); g.translate(b.pos.x, b.pos.y); g.rotate(b.spin);
      const s = b.radius * 1.6;
      g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(-s, -s, s * 2, s * 2);
      g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(-s, -s, s * 2, s * 2);
      g.fillStyle = "#ffb020"; g.font = `${b.radius * 1.5}px sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("?", 0, 1);
      g.restore(); g.globalAlpha = 1;
    }

    // Slingshot aim lines
    for (const s of this.seats) {
      const aim = s.aim;
      if (!s.grabbed || !aim) continue;
      const drag = vsub(aim, s.pos); const dist = vlen(drag);
      if (dist < MIN_DRAG * 0.5) continue;
      g.beginPath(); g.moveTo(s.pos.x, s.pos.y); g.lineTo(aim.x, aim.y);
      g.strokeStyle = "rgba(255,255,255,0.2)"; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(aim.x, aim.y, 6, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,0.15)"; g.fill();
      if (dist < MIN_DRAG) continue;
      const launchDir = vnorm(vmul(drag, -1));
      const power = Math.min(dist * POWER_SCALE, MAX_POWER);
      const arrowLen = 20 + (power / MAX_POWER) * 60;
      const end = vadd(s.pos, vmul(launchDir, arrowLen));
      g.beginPath(); g.moveTo(s.pos.x + launchDir.x * s.radius, s.pos.y + launchDir.y * s.radius);
      g.lineTo(end.x, end.y); g.strokeStyle = s.player.color; g.lineWidth = 3; g.globalAlpha = 0.7; g.stroke(); g.globalAlpha = 1;
      const angle = Math.atan2(launchDir.y, launchDir.x); const hs = 9;
      g.beginPath(); g.moveTo(end.x, end.y);
      g.lineTo(end.x - hs * Math.cos(angle - 0.45), end.y - hs * Math.sin(angle - 0.45));
      g.lineTo(end.x - hs * Math.cos(angle + 0.45), end.y - hs * Math.sin(angle + 0.45));
      g.closePath(); g.fillStyle = s.player.color; g.fill();
    }

    // Players
    for (const s of this.seats) {
      if (s.grabbed) {
        g.beginPath(); g.arc(s.pos.x, s.pos.y, s.radius + 6, 0, Math.PI * 2);
        g.strokeStyle = s.player.color; g.lineWidth = 2;
        g.globalAlpha = 0.4 + Math.sin(Date.now() * 0.008) * 0.2; g.stroke(); g.globalAlpha = 1;
      }
      if (s.shielded) {
        g.beginPath(); g.arc(s.pos.x, s.pos.y, s.radius + 5, 0, Math.PI * 2);
        g.strokeStyle = "rgba(68,187,255,0.5)"; g.lineWidth = 2; g.setLineDash([5, 5]); g.stroke(); g.setLineDash([]);
      }
      if (s.turboReady) {
        g.beginPath(); g.arc(s.pos.x, s.pos.y, s.radius + 4, 0, Math.PI * 2);
        g.strokeStyle = "rgba(255,204,0,0.45)"; g.lineWidth = 2.5; g.stroke();
      }
      if (s.magnetTimer > 0) {
        g.beginPath(); g.arc(s.pos.x, s.pos.y, s.radius + 8, 0, Math.PI * 2);
        g.strokeStyle = "rgba(255,102,136,0.3)"; g.lineWidth = 1; g.setLineDash([3, 6]); g.stroke(); g.setLineDash([]);
      }
      drawPlayerOrb(g, s.pos.x, s.pos.y, s.radius, s.player);
      g.font = "700 14px Outfit, sans-serif"; g.textAlign = "center"; g.fillStyle = s.player.color;
      g.fillText(String(s.score), s.pos.x, s.pos.y - s.radius - 10);
      if (s.combo >= 3) {
        const m = Math.min(4, 1 + Math.floor(s.combo / 3));
        g.font = "700 11px Outfit, sans-serif"; g.fillStyle = "#FFB020";
        g.fillText("x" + m, s.pos.x + s.radius + 8, s.pos.y - s.radius - 6);
      }
    }

    this.juice.end(g);

    // Popups (unshaken HUD layer)
    for (const p of this.popups) {
      g.globalAlpha = Math.max(0, p.life / p.maxLife);
      g.font = `700 ${p.size}px Outfit, sans-serif`; g.textAlign = "center";
      g.fillStyle = p.color; g.fillText(p.text, p.x, p.y);
    }
    g.globalAlpha = 1;

    // Score bar
    const sorted = [...this.seats].sort((a, b) => b.score - a.score);
    const leader = sorted[0];
    g.fillStyle = "rgba(7,11,20,0.55)"; g.fillRect(0, 0, W, 32);
    const chipW = W / this.seats.length;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const cx = chipW * i + chipW / 2;
      g.beginPath(); g.arc(cx - 30, 16, 5, 0, Math.PI * 2); g.fillStyle = s.player.color; g.fill();
      g.font = "700 14px Outfit, sans-serif"; g.textAlign = "left";
      g.fillStyle = s === leader ? "#FFB020" : "#aab";
      g.fillText(String(s.score), cx - 22, 21);
    }
    // Timer
    const tl = Math.max(0, this.timeLeft); const secs = Math.floor(tl);
    g.font = "700 14px Outfit, sans-serif"; g.textAlign = "right";
    g.fillStyle = this.frenzy ? "#FF3D7A" : tl < 15 ? "#FFB020" : "#5a6088";
    g.fillText(Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0"), W - 12, 21);
    if (this.frenzy) {
      g.font = "700 12px Outfit, sans-serif"; g.textAlign = "right";
      g.fillStyle = `rgba(255,61,122,${0.6 + Math.sin(Date.now() * 0.008) * 0.4})`;
      g.fillText("FRENZY", W - 60, 21);
    }
    if (this.doubleTime > 0) {
      g.font = "700 12px Outfit, sans-serif"; g.textAlign = "center";
      g.fillStyle = "rgba(102,255,170,0.7)"; g.fillText("2X COINS", W / 2, 48);
    }

    this.callouts.draw(g, W, H);
  }
}
