import { fillArena, drawPlayerOrb } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import type { Rng } from "../../core/rng";
import type { Sfx } from "../../core/audio";
import {
  aimAt, applyFriction, BANK_STEP, bankMultiplier, bankPayout, BIG_BANK, botPlan, coinWaveInterval, COIN_FRICTION_PER_S,
  COIN_LIFE_S, COIN_VALUES, COMBO_WINDOW_S, comboMultiplier, crownAndUnderdog, FAT_POUCH, GAME_DURATION_S, GRAB_RADIUS_MULT,
  isHeist, isNearMiss, launchPower, launchVelocity, MIN_DRAG, nextVaultPos, REGRAB_CD, REGRAB_SPEED,
  resolveCollision, spillCount, startPositions, stealAmount, stepBody, v2, vadd, VAULT_MOVE_HEIST_S, VAULT_MOVE_S,
  vaultRadius, vdist, vlen, vmul, vnorm, vsub,
} from "./logic";
import type { Body, Bounds, Vec2 } from "./logic";

export const fling: GameDefinition = {
  id: "fling",
  name: "Vault Heist",
  tagline: "Fling, loot, cash out before they ram you.",
  description:
    "Drag back your ball and let go to fling it. Coins you roll over fill your POUCH, but a pouch is not points: " +
    "roll into the roaming VAULT to bank it, and the fatter the pouch the bigger the multiplier. Get rammed and " +
    "the attacker takes half your loot. The leader wears a crown worth extra, last place banks at +1x, and the " +
    "last 15 seconds are the FINAL HEIST: every bank pays an extra x1. Most banked wins.",
  durationMs: 63_000,
  controls: "Drag back from your ball, release to fling. Roll into the vault to bank.",
  fillsScreen: true,
  create: (ctx) => new FlingGame(ctx),
};

const BEST_KEY = "v2-vault";
/** Bots fling again a little before the ball has fully stopped (humans wait for REGRAB_SPEED). */
const BOT_ACT_SPEED = 80;
const HUD_H = 60;
const EVENT_INTERVAL_BASE = 9;
const MAX_COINS = 80;

const COIN_COLORS: Record<string, string> = { bronze: "#cd7f32", silver: "#d8dde6", gold: "#ffd700", diamond: "#ff66ff", dropped: "#cd7f32" };
const PU_NAMES = ["MAGNET", "MEGA", "SHIELD", "TURBO", "DOUBLE"] as const;
const PU_COLORS: Record<string, string> = { MAGNET: "#ff6688", MEGA: "#ff66aa", SHIELD: "#44bbff", TURBO: "#ffcc00", DOUBLE: "#66ffaa" };
const EVENT_LIST = ["COIN RAIN", "QUAKE", "JACKPOT", "SHUFFLE", "SCATTER", "GRAVITY", "BONUS TIME", "BUMPERS"] as const;
const EVENT_COLORS: Record<string, string> = {
  "COIN RAIN": "#ffd700", QUAKE: "#ff7744", JACKPOT: "#ff66ff", SHUFFLE: "#b8ff3d", SCATTER: "#3ee0ff",
  GRAVITY: "#c9a3ff", "BONUS TIME": "#66ffaa", BUMPERS: "#ff4444",
};
const GOLD = "#ffd700";
const HEIST_PINK = "#FF3D7A";
const TAUNTS_STEAL = ["MINE!", "THANKS!", "YOINK", "GIMME"] as const;
const TAUNTS_BANK = ["CHA-CHING", "SAFE!", "EASY", "BANKED"] as const;

// ── Sub-types ──
interface Coin {
  pos: Vec2; vel: Vec2; type: string; value: number;
  radius: number; life: number; maxLife: number; bob: number;
  dropImmunity: number; droppedBy: number;
}
interface MysteryBox { pos: Vec2; radius: number; life: number; bob: number; spin: number }
interface Bumper { pos: Vec2; radius: number; life: number }
interface Popup { x: number; y: number; text: string; color: string; size: number; life: number; maxLife: number; vy: number }
interface Vault { pos: Vec2; radius: number; moveTimer: number; spin: number; flash: number; arrivals: number }

interface Seat extends Body {
  player: Player;
  grabbed: boolean; grabCd: number;
  /** Banked points (the score). */
  score: number;
  /** Unbanked loot riding on the ball: stealable. */
  pouch: number;
  combo: number; comboTimer: number;
  coinsCollected: number; totalStolen: number; banks: number; bestBank: number;
  activePU: string | null; puTimer: number;
  turboReady: boolean; shielded: boolean; magnetTimer: number;
  aiTimer: number; bankAt: number;
  aim: Vec2 | null;
  moving: boolean; flightVaultMin: number;
  hitFlash: number; bankFlash: number;
}

class FlingGame implements GameInstance {
  private readonly W: number;
  private readonly H: number;
  private readonly ballR: number;
  private readonly coinR: number;
  private readonly bounds: Bounds;
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
  private readonly vault: Vault;

  private timeLeft = GAME_DURATION_S;
  private elapsed = 0;
  private clock = 0;
  private heist = false;
  private coinTimer = 1.2;
  private silverTimer = 5;
  private goldTimer = 12;
  private boxTimer = 8;
  private eventTimer = EVENT_INTERVAL_BASE * 0.7;
  private doubleTime = 0;
  private leader = -1;
  private underdog = -1;
  private lastTick = -1;
  private done = false;

  constructor(private readonly ctx: GameContext) {
    this.W = ctx.width;
    this.H = ctx.height;
    this.rng = ctx.rng;
    this.sfx = ctx.sfx;
    const m = Math.min(this.W, this.H);
    this.ballR = Math.max(14, m * 0.034);
    this.coinR = Math.max(5, this.ballR * 0.38);
    this.bounds = { x0: 0, y0: HUD_H, x1: this.W, y1: this.H };
    this.juice = new Juice(() => this.rng.next());

    const spawns = startPositions(this.bounds, this.ballR * 3.2);
    this.seats = ctx.players.map((player, i) => ({
      player,
      pos: { ...spawns[i % 4]! }, vel: v2(), radius: this.ballR, mass: 1,
      grabbed: false, grabCd: 0,
      score: 0, pouch: 0, combo: 0, comboTimer: 0, coinsCollected: 0, totalStolen: 0, banks: 0, bestBank: 0,
      activePU: null, puTimer: 0,
      turboReady: false, shielded: false, magnetTimer: 0,
      aiTimer: 0.8 + this.rng.float(0, 1), bankAt: FAT_POUCH + this.rng.int(0, 4),
      aim: null, moving: false, flightVaultMin: Infinity, hitFlash: 0, bankFlash: 0,
    }));

    const vr = vaultRadius(this.ballR, 0);
    this.vault = {
      pos: nextVaultPos(this.rng, this.bounds, spawns, vr, this.ballR * 8),
      radius: vr, moveTimer: VAULT_MOVE_S, spin: 0, flash: 0, arrivals: 0,
    };
    for (let i = 0; i < 5; i++) this.spawnCoin("bronze");

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
    let bestDist = Math.max(this.ctx.minTap, this.ballR * GRAB_RADIUS_MULT);
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
    const vel = launchVelocity(seat.pos, aim, seat.turboReady);
    if (!vel) return;
    if (seat.turboReady) seat.turboReady = false;
    this.launch(seat, vel);
  };

  private readonly onCancel = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    const seat = this.seats[i]!;
    seat.grabbed = false;
    seat.aim = null;
  };

  private launch(seat: Seat, vel: Vec2): void {
    seat.vel = vel;
    seat.grabCd = REGRAB_CD;
    seat.moving = true;
    seat.flightVaultMin = Infinity;
    this.sfx.whoosh();
    const back = vnorm(vmul(vel, -1));
    this.juice.burst(seat.pos.x, seat.pos.y, seat.player.color, {
      count: 6, speed: 90, life: 0.25, gravity: 0, angle: Math.atan2(back.y, back.x), spread: 0.9,
    });
  }

  // ── AI ──
  private aiUpdate(seat: Seat, dt: number): void {
    if (seat.player.kind !== "bot") return;
    if (seat.grabbed || vlen(seat.vel) > BOT_ACT_SPEED || seat.grabCd > 0) {
      seat.aiTimer = 0.3 + this.rng.float(0, 0.45);
      return;
    }
    seat.aiTimer -= dt;
    if (seat.aiTimer > 0) return;
    const me = this.seats.indexOf(seat);
    const rivals = this.seats.filter((o) => o !== seat);
    const plan = botPlan({
      pos: seat.pos, pouch: seat.pouch, bankAt: seat.bankAt, vault: this.vault.pos,
      rivals: rivals.map((r) => ({ pos: r.pos, pouch: r.pouch, crowned: this.seats.indexOf(r) === this.leader })),
      coins: this.coins.filter((c) => !(c.dropImmunity > 0 && c.droppedBy === me)),
      heist: this.heist, timeLeft: this.timeLeft, roll: this.rng.next(),
    });
    // Human-like error: a little wobble, more when ramming in a hurry; now and then a plain bad shot.
    const sloppy = this.rng.next() < 0.1;
    const spread = plan.kind === "ram" ? 0.5 : plan.kind === "bank" ? 0.1 : 0.3;
    const wobble = (this.rng.next() - 0.5) * spread + (sloppy ? this.rng.float(-0.6, 0.6) : 0);
    // Bank shots are meant to roll straight through the vault, so they carry extra speed; rams must arrive fast.
    const powerPerPx = plan.kind === "bank" ? 0.9 : plan.kind === "ram" ? 1.1 : 1.0;
    const base = plan.kind === "ram" ? 240 : plan.kind === "bank" ? 90 : 80;
    const vel = aimAt(seat.pos, plan.target, wobble, this.rng.float(-30, 120), seat.turboReady, { powerPerPx, basePower: base });
    if (seat.turboReady) seat.turboReady = false;
    this.launch(seat, vel);
    seat.aiTimer = 0.5 + this.rng.float(0, 0.8);
  }

  // ── Physics ──
  private updatePhysics(dt: number): void {
    for (const s of this.seats) {
      s.grabCd = Math.max(0, s.grabCd - dt);
      if (s.hitFlash > 0) s.hitFlash -= dt;
      if (s.bankFlash > 0) s.bankFlash -= dt;
      if (s.puTimer > 0) {
        s.puTimer -= dt;
        if (s.puTimer <= 0) {
          if (s.activePU === "MEGA") { s.radius = this.ballR; s.mass = 1; }
          s.activePU = null;
        }
      }
      if (s.grabbed) continue;
      s.vel = applyFriction(s.vel, dt);
      const walls = stepBody(s, dt, this.bounds);
      if (walls > 0 && vlen(s.vel) > 120) this.wallFX(s);
      // Near-miss tracking: the closest this flight came to the vault.
      s.flightVaultMin = Math.min(s.flightVaultMin, vdist(s.pos, this.vault.pos));
      const speed = vlen(s.vel);
      if (s.moving && speed < REGRAB_SPEED) {
        s.moving = false;
        if (isNearMiss(s.flightVaultMin, this.vault.radius, s.radius, s.pouch) && vdist(s.pos, this.vault.pos) > this.vault.radius) {
          this.popup(s.pos.x, s.pos.y - s.radius - 24, "SO CLOSE", "#ffffff", 15);
          this.sfx.miss();
        }
      } else if (!s.moving && speed >= REGRAB_SPEED) {
        s.moving = true;
        s.flightVaultMin = Infinity;
      }
    }
  }

  private wallFX(s: Seat): void {
    if (this.rng.next() < 0.5) this.juice.burst(s.pos.x, s.pos.y, s.player.color, { count: 3, speed: 50, life: 0.2, gravity: 0 });
  }

  private updateCollisions(): void {
    for (let i = 0; i < this.seats.length; i++) {
      for (let j = i + 1; j < this.seats.length; j++) {
        this.collide(this.seats[i]!, this.seats[j]!, i, j);
      }
    }
  }

  private collide(a: Seat, b: Seat, ia: number, ib: number): void {
    const hit = resolveCollision(a, b, { aHeld: a.grabbed, bHeld: b.grabbed, aShield: a.shielded, bShield: b.shielded });
    if (hit.force <= 0) return;
    this.impactFX(a, b, hit.force);
    if (hit.shieldPopped) {
      const owner = hit.shieldPopped === "a" ? a : b;
      owner.shielded = false;
      this.popup(owner.pos.x, owner.pos.y - owner.radius - 18, "BLOCKED", PU_COLORS.SHIELD ?? "#44bbff", 14);
    } else if (hit.attacker) {
      const att = hit.attacker === "a" ? a : b;
      const vic = hit.attacker === "a" ? b : a;
      const vicIdx = hit.attacker === "a" ? ib : ia;
      this.steal(att, vic, vicIdx, hit.force);
    }
    if (a.grabbed && vlen(a.vel) > 60) this.releaseGrab(a);
    if (b.grabbed && vlen(b.vel) > 60) this.releaseGrab(b);
  }

  private steal(att: Seat, vic: Seat, vicIdx: number, force: number): void {
    const crowned = vicIdx === this.leader;
    const stolen = stealAmount(vic.pouch, crowned);
    if (stolen > 0) {
      vic.pouch -= stolen;
      att.pouch += stolen;
      att.totalStolen += stolen;
      vic.hitFlash = 0.4;
      this.popup(att.pos.x, att.pos.y - att.radius - 18, "+" + stolen + " STOLEN", att.player.color, 15);
      this.popup(vic.pos.x, vic.pos.y + vic.radius + 16, "-" + stolen, "#ff6666", 14);
      this.juice.burst(vic.pos.x, vic.pos.y, GOLD, { count: Math.min(16, 4 + stolen), speed: 160, life: 0.45, gravity: 300 });
      if (stolen >= FAT_POUCH) { this.juice.hitStop(0.05); this.juice.shake(0.35); }
      if (crowned) { this.callouts.show("CROWN HIT!", GOLD, { size: 54, life: 1 }); this.sfx.streak(4); }
      if (att.player.kind === "bot" && this.rng.next() < 0.35) {
        this.popup(att.pos.x, att.pos.y - att.radius - 36, this.rng.pick(TAUNTS_STEAL), att.player.color, 12);
      }
    }
    this.dropCoins(vic, vicIdx, spillCount(force));
  }

  private releaseGrab(seat: Seat): void {
    seat.grabbed = false;
    seat.aim = null;
    for (const [pid, idx] of this.grabs) {
      if (this.seats[idx] === seat) { this.grabs.delete(pid); break; }
    }
  }

  private impactFX(a: Seat, b: Seat, force: number): void {
    const mid = v2((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2);
    this.juice.burst(mid.x, mid.y, [a.player.color, b.player.color, "#fff"], {
      count: Math.min(14, Math.floor(force / 40) * 3 + 3), speed: force * 0.35, life: 0.3, gravity: 0,
    });
    this.sfx.hit();
    this.juice.shake(Math.min(0.5, force * 0.0015));
  }

  // ── Coins ──
  private randomSpot(inset: number): Vec2 {
    return v2(
      this.rng.float(this.bounds.x0 + inset, this.bounds.x1 - inset),
      this.rng.float(this.bounds.y0 + inset, this.bounds.y1 - inset),
    );
  }

  private spawnCoin(type: string, at?: Vec2, vel: Vec2 = v2()): void {
    if (this.coins.length >= MAX_COINS) return;
    const pos = at ?? this.randomSpot(40);
    const life = COIN_LIFE_S[type] ?? 9;
    this.coins.push({
      pos, vel, type, value: COIN_VALUES[type] ?? 1,
      radius: type === "diamond" ? this.coinR * 1.8 : type === "gold" ? this.coinR * 1.4 : type === "silver" ? this.coinR * 1.2 : this.coinR,
      life, maxLife: life, bob: this.rng.float(0, 6),
      dropImmunity: -1, droppedBy: -1,
    });
  }

  private dropCoins(seat: Seat, idx: number, count: number): void {
    for (let i = 0; i < count; i++) {
      if (seat.pouch <= 0) break;
      seat.pouch--;
      const a = this.rng.float(0, Math.PI * 2);
      const s = 120 + this.rng.float(0, 140);
      this.coins.push({
        pos: { ...seat.pos }, vel: v2(Math.cos(a) * s, Math.sin(a) * s), type: "dropped", value: 1,
        radius: this.coinR * 0.9, life: 7, maxLife: 7, bob: this.rng.float(0, 6),
        dropImmunity: 0.5, droppedBy: idx,
      });
    }
  }

  private updateCoins(dt: number): void {
    this.coinTimer -= dt;
    if (this.coinTimer <= 0) {
      const n = 4;
      for (let i = 0; i < n; i++) this.spawnCoin("bronze");
      this.coinTimer = coinWaveInterval(this.elapsed, this.heist) * (0.8 + this.rng.float(0, 0.5));
    }
    this.silverTimer -= dt;
    if (this.silverTimer <= 0) { this.spawnCoin("silver"); this.silverTimer = (this.heist ? 2.5 : 5) + this.rng.float(0, 2); }
    this.goldTimer -= dt;
    if (this.goldTimer <= 0) { this.spawnCoin("gold"); this.goldTimer = (this.heist ? 4 : 11) + this.rng.float(0, 3); }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i]!;
      c.life -= dt;
      if (c.life <= 0) { this.coins.splice(i, 1); continue; }
      if (c.dropImmunity > 0) c.dropImmunity -= dt;
      if (vlen(c.vel) > 1) {
        c.vel = applyFriction(c.vel, dt, COIN_FRICTION_PER_S);
        stepBody({ pos: c.pos, vel: c.vel, radius: c.radius, mass: 1 }, dt, this.bounds, 0.5);
      }
    }
  }

  private collectCoins(dt: number): void {
    this.seats.forEach((s, seatIdx) => {
      if (s.comboTimer > 0) { s.comboTimer -= dt; if (s.comboTimer <= 0) s.combo = 0; }
      if (s.magnetTimer > 0) {
        s.magnetTimer -= dt;
        for (const c of this.coins) {
          if (c.dropImmunity > 0 && c.droppedBy === seatIdx) continue;
          const d = vdist(s.pos, c.pos);
          if (d < 140 && d > 5) { const pull = vnorm(vsub(s.pos, c.pos)); c.vel = vadd(c.vel, vmul(pull, 450 * dt)); }
        }
      }
      for (let i = this.coins.length - 1; i >= 0; i--) {
        const c = this.coins[i]!;
        if (c.dropImmunity > 0 && c.droppedBy === seatIdx) continue;
        if (vdist(s.pos, c.pos) < s.radius + c.radius) {
          const mult = comboMultiplier(s.combo);
          const dbl = this.doubleTime > 0 ? 2 : 1;
          const pts = c.value * mult * dbl;
          s.pouch += pts; s.coinsCollected++;
          s.combo++; s.comboTimer = COMBO_WINDOW_S;
          const col = COIN_COLORS[c.type] ?? "#ffb020";
          this.popup(c.pos.x, c.pos.y - 10, "+" + pts, c.type === "bronze" || c.type === "dropped" ? "#ffb020" : col, c.value >= 5 ? 16 : 13);
          this.juice.burst(c.pos.x, c.pos.y, col, { count: c.value >= 5 ? 10 : 4, speed: 70, life: 0.25, gravity: 0 });
          if (c.type === "gold" || c.type === "diamond") this.sfx.streak(3); else if (mult > 1) this.sfx.streak(mult); else this.sfx.collect();
          this.coins.splice(i, 1);
        }
      }
    });
  }

  // ── Vault ──
  private updateVault(dt: number): void {
    const v = this.vault;
    v.spin += dt * (this.heist ? 2.2 : 1);
    if (v.flash > 0) v.flash -= dt;
    v.radius = vaultRadius(this.ballR, this.elapsed);
    v.moveTimer -= dt;
    if (v.moveTimer <= 0) this.relocateVault(null);
    this.seats.forEach((s, i) => {
      if (vdist(s.pos, v.pos) >= v.radius + s.radius * 0.2) return;
      if (s.pouch <= 0) return;
      this.bank(s, i);
    });
  }

  private bank(s: Seat, idx: number): void {
    const opts = { underdog: idx === this.underdog, heist: this.heist };
    const mult = bankMultiplier(s.pouch, opts);
    const payout = bankPayout(s.pouch, opts);
    s.score += payout;
    s.banks++;
    s.bestBank = Math.max(s.bestBank, payout);
    s.pouch = 0;
    s.bankFlash = 0.6;
    this.vault.flash = 0.5;
    this.vault.arrivals++;
    this.popup(s.pos.x, s.pos.y - s.radius - 20, `+${payout} BANKED` + (mult > 1 ? ` x${mult}` : ""), GOLD, mult >= 3 ? 20 : 16);
    this.juice.burst(this.vault.pos.x, this.vault.pos.y, [GOLD, "#fff", s.player.color], { count: 14 + mult * 6, speed: 220, life: 0.6, gravity: 260 });
    this.sfx.streak(Math.min(6, 2 + mult));
    this.juice.shake(Math.min(0.5, 0.1 + payout * 0.01));
    if (payout >= BIG_BANK) {
      this.callouts.show(`BIG BANK +${payout}`, GOLD, { size: 58, life: 1.1, y: 0.36 });
      this.juice.hitStop(0.04);
    }
    if (s.player.kind === "human" && saveBest(fling.id, payout, BEST_KEY)) {
      this.callouts.show("NEW RECORD", "#B8FF3D", { size: 48, y: 0.44, life: 1.4 });
      this.sfx.win();
    }
    if (s.player.kind === "bot" && this.rng.next() < 0.4) {
      this.popup(s.pos.x, s.pos.y - s.radius - 40, this.rng.pick(TAUNTS_BANK), s.player.color, 12);
    }
    this.relocateVault(s);
  }

  private relocateVault(banker: Seat | null): void {
    const v = this.vault;
    const old = { ...v.pos };
    const avoid = banker ? [banker.pos] : this.seats.map((s) => s.pos);
    const minDist = banker ? Math.min(this.W, this.H) * 0.45 : this.ballR * 6;
    v.pos = nextVaultPos(this.rng, this.bounds, avoid, v.radius, minDist);
    v.moveTimer = this.heist ? VAULT_MOVE_HEIST_S : VAULT_MOVE_S;
    const dir = vnorm(vsub(v.pos, old));
    this.juice.burst(old.x, old.y, GOLD, { count: 10, speed: 160, life: 0.4, gravity: 0, angle: Math.atan2(dir.y, dir.x), spread: 0.6 });
    this.juice.burst(v.pos.x, v.pos.y, GOLD, { count: 10, speed: 120, life: 0.4, gravity: 0 });
    if (!banker) this.popup(v.pos.x, v.pos.y - v.radius - 14, "VAULT MOVED", GOLD, 13);
    this.sfx.tick();
  }

  // ── Mystery Boxes ──
  private updateBoxes(dt: number): void {
    this.boxTimer -= dt;
    if (this.boxTimer <= 0 && this.boxes.length < 2) {
      this.boxes.push({ pos: this.randomSpot(60), radius: this.ballR * 0.7, life: 12, bob: this.rng.float(0, 6), spin: 0 });
      this.boxTimer = (this.heist ? 5 : 9) + this.rng.float(0, 4);
    }
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i]!;
      b.life -= dt; b.spin += dt * 2;
      if (b.life <= 0) { this.boxes.splice(i, 1); continue; }
      for (const s of this.seats) {
        if (vdist(s.pos, b.pos) < s.radius + b.radius) {
          this.applyPU(s);
          this.juice.burst(b.pos.x, b.pos.y, "#fff", { count: 12, speed: 100, life: 0.3, gravity: 0 });
          this.sfx.collect();
          this.boxes.splice(i, 1);
          break;
        }
      }
    }
  }

  private applyPU(s: Seat): void {
    const t = this.rng.pick(PU_NAMES);
    this.popup(s.pos.x, s.pos.y - s.radius - 22, t, PU_COLORS[t] ?? "#fff", 15);
    if (t === "MAGNET") { s.magnetTimer = 6; }
    else if (t === "MEGA") {
      s.activePU = "MEGA"; s.puTimer = 7; s.radius = this.ballR * 1.55; s.mass = 2;
    } else if (t === "SHIELD") { s.shielded = true; }
    else if (t === "TURBO") { s.turboReady = true; }
    else if (t === "DOUBLE") { this.doubleTime = Math.max(this.doubleTime, 8); }
  }

  // ── Events ──
  private updateEvents(dt: number): void {
    this.eventTimer -= dt;
    if (this.eventTimer <= 0 && this.timeLeft > 4) {
      const ev = this.rng.pick(EVENT_LIST);
      this.runEvent(ev);
      this.callouts.show(ev + "!", EVENT_COLORS[ev] ?? "#fff", { size: 56, life: 1.1, y: 0.2 });
      this.eventTimer = (this.heist ? 5 : EVENT_INTERVAL_BASE) + this.rng.float(0, 3);
      this.sfx.countdown();
    }
    if (this.doubleTime > 0) this.doubleTime -= dt;
    for (let i = this.bumpers.length - 1; i >= 0; i--) {
      const bmp = this.bumpers[i]!;
      bmp.life -= dt;
      if (bmp.life <= 0) { this.bumpers.splice(i, 1); continue; }
      for (const s of this.seats) {
        if (vdist(s.pos, bmp.pos) < s.radius + bmp.radius) {
          const n = vnorm(vsub(s.pos, bmp.pos));
          s.vel = vadd(s.vel, vmul(n, 520));
          s.pos = vadd(bmp.pos, vmul(n, s.radius + bmp.radius + 1));
          if (s.grabbed) this.releaseGrab(s);
          this.juice.burst(bmp.pos.x, bmp.pos.y, "#ff4444", { count: 6, speed: 110, life: 0.25, gravity: 0 });
          this.sfx.hit();
          this.juice.shake(0.2);
        }
      }
    }
  }

  private shove(s: Seat, dir: Vec2, amount: number): void {
    s.vel = vadd(s.vel, vmul(dir, amount));
    if (s.grabbed) this.releaseGrab(s);
  }

  private runEvent(ev: string): void {
    const centre = v2((this.bounds.x0 + this.bounds.x1) / 2, (this.bounds.y0 + this.bounds.y1) / 2);
    switch (ev) {
      case "COIN RAIN":
        for (let i = 0; i < (this.heist ? 18 : 12); i++) this.spawnCoin(this.rng.next() < 0.2 ? "silver" : "bronze");
        break;
      case "QUAKE":
        for (const s of this.seats) {
          const a = this.rng.float(0, Math.PI * 2);
          this.shove(s, v2(Math.cos(a), Math.sin(a)), 420);
        }
        this.juice.shake(0.6);
        break;
      case "JACKPOT":
        this.spawnCoin("diamond");
        break;
      case "SHUFFLE": {
        const positions = this.seats.map((s) => ({ ...s.pos }));
        for (let i = positions.length - 1; i > 0; i--) {
          const j = this.rng.int(0, i);
          [positions[i], positions[j]] = [positions[j]!, positions[i]!];
        }
        this.seats.forEach((s, i) => {
          this.juice.burst(s.pos.x, s.pos.y, s.player.color, { count: 8, speed: 120, life: 0.3, gravity: 0 });
          s.pos = positions[i]!;
          s.vel = v2();
          if (s.grabbed) this.releaseGrab(s);
        });
        this.juice.shake(0.4);
        break;
      }
      case "SCATTER":
        for (const s of this.seats) this.shove(s, vnorm(vsub(s.pos, centre)), 560);
        this.juice.shake(0.5);
        break;
      case "GRAVITY":
        for (const s of this.seats) this.shove(s, vnorm(vsub(centre, s.pos)), 460);
        for (const c of this.coins) c.vel = vadd(c.vel, vmul(vnorm(vsub(centre, c.pos)), 220));
        this.juice.shake(0.3);
        break;
      case "BONUS TIME":
        this.doubleTime = Math.max(this.doubleTime, 8);
        break;
      case "BUMPERS":
        this.bumpers.length = 0;
        for (let i = 0; i < 5; i++) this.bumpers.push({ pos: this.randomSpot(70), radius: this.ballR * 1.2, life: 10 });
        break;
    }
  }

  private startHeist(): void {
    this.heist = true;
    this.callouts.show("FINAL HEIST!", HEIST_PINK, { size: 76, life: 1.6 });
    this.callouts.show("VAULT BONUS +1x", GOLD, { size: 40, y: 0.44, life: 1.6 });
    this.sfx.go();
    this.juice.shake(0.6);
    this.juice.slowMo(0.5, 0.4);
    const centre = v2((this.bounds.x0 + this.bounds.x1) / 2, (this.bounds.y0 + this.bounds.y1) / 2);
    const old = { ...this.vault.pos };
    this.vault.pos = centre;
    this.vault.moveTimer = VAULT_MOVE_HEIST_S;
    this.juice.burst(old.x, old.y, GOLD, { count: 12, speed: 150, life: 0.4, gravity: 0 });
    this.juice.burst(centre.x, centre.y, [GOLD, HEIST_PINK], { count: 30, speed: 260, life: 0.7, gravity: 0 });
    for (let i = 0; i < 6; i++) this.spawnCoin(this.rng.next() < 0.3 ? "silver" : "bronze");
  }

  private popup(x: number, y: number, text: string, color: string, size = 14): void {
    this.popups.push({ x, y, text, color, size, life: 1, maxLife: 1, vy: -55 });
  }

  // ── Update ──
  update(realDt: number): void {
    this.callouts.update(realDt);
    this.clock += realDt;
    const dt = this.juice.update(realDt);
    if (this.done) return;
    this.timeLeft -= dt;
    this.elapsed += dt;
    if (!this.heist && isHeist(this.timeLeft)) this.startHeist();
    const tick = Math.ceil(this.timeLeft);
    if (tick <= 5 && tick >= 1 && tick !== this.lastTick) { this.lastTick = tick; this.sfx.tick(); }
    if (this.timeLeft <= 0) {
      this.done = true;
      this.sfx.win();
      this.callouts.show("TIME!", "#F4F7FB", { size: 72 });
      return;
    }
    const standing = crownAndUnderdog(this.seats.map((s) => s.score));
    if (standing.leader !== this.leader && standing.leader >= 0) {
      const s = this.seats[standing.leader]!;
      this.popup(s.pos.x, s.pos.y - s.radius - 34, "CROWN", GOLD, 13);
    }
    this.leader = standing.leader;
    this.underdog = standing.underdog;
    for (const s of this.seats) this.aiUpdate(s, dt);
    this.updatePhysics(dt);
    this.updateCollisions();
    this.updateCoins(dt);
    this.collectCoins(dt);
    this.updateVault(dt);
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
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (const s of this.seats) {
      stats.push({ playerId: s.player.id, label: "Banked", value: String(s.banks) });
      stats.push({ playerId: s.player.id, label: "Best bank", value: String(s.bestBank) });
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
    const W = this.W; const H = this.H; const t = this.clock;
    fillArena(g, W, H);
    this.juice.begin(g);

    // Grid and arena frame
    g.strokeStyle = "rgba(255,255,255,0.025)"; g.lineWidth = 1;
    const step = Math.max(30, W / 20);
    for (let x = 0; x <= W; x += step) { g.beginPath(); g.moveTo(x, HUD_H); g.lineTo(x, H); g.stroke(); }
    for (let y = HUD_H; y <= H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    if (this.heist) {
      const pulse = 0.25 + Math.sin(t * 9) * 0.2;
      const grad = g.createLinearGradient(0, HUD_H, 0, H);
      grad.addColorStop(0, `rgba(255,61,122,${pulse * 0.35})`); grad.addColorStop(0.5, "rgba(255,61,122,0)"); grad.addColorStop(1, `rgba(255,61,122,${pulse * 0.35})`);
      g.fillStyle = grad; g.fillRect(0, HUD_H, W, H - HUD_H);
    }
    const borderColor = this.heist ? `rgba(255,61,122,${0.5 + Math.sin(t * 8) * 0.3})`
      : this.doubleTime > 0 ? "rgba(102,255,170,0.45)" : "rgba(62,224,255,0.16)";
    g.strokeStyle = borderColor; g.lineWidth = 3;
    g.strokeRect(1.5, HUD_H + 1.5, W - 3, H - HUD_H - 3);

    // Bumpers
    for (const b of this.bumpers) {
      const pulse = 0.8 + Math.sin(t * 6) * 0.2;
      g.globalAlpha = Math.min(1, b.life / 2) * pulse;
      g.beginPath(); g.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,50,50,0.3)"; g.fill();
      g.strokeStyle = "#ff4444"; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;
    }

    this.drawVault(g, t);

    // Coins
    for (const c of this.coins) {
      const bob = Math.sin(t * 5 + c.bob) * 1.5;
      const cx = c.pos.x; const cy = c.pos.y + bob;
      const fade = c.life < 2 ? c.life / 2 : 1;
      g.globalAlpha = fade * (c.type === "dropped" ? 0.8 : 1);
      if (c.type === "gold" || c.type === "diamond") {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, c.radius * 2.5);
        gr.addColorStop(0, COIN_COLORS[c.type]!); gr.addColorStop(1, "transparent");
        g.globalAlpha = fade * 0.2;
        g.beginPath(); g.arc(cx, cy, c.radius * 2.5, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
        g.globalAlpha = fade;
      }
      g.beginPath(); g.arc(cx, cy, c.radius, 0, Math.PI * 2);
      g.fillStyle = c.type === "diamond" ? `hsl(${(t * 200) % 360},80%,65%)` : COIN_COLORS[c.type] ?? "#cd7f32";
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1; g.stroke();
      const sparkle = Math.sin(t * 10 + c.bob * 3);
      if (sparkle > 0.7) {
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.beginPath(); g.arc(cx - c.radius * 0.3, cy - c.radius * 0.3, c.radius * 0.25, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }

    // Boxes
    for (const b of this.boxes) {
      const fade = b.life < 2 ? b.life / 2 : 1;
      g.globalAlpha = fade;
      g.save(); g.translate(b.pos.x, b.pos.y + Math.sin(t * 4 + b.bob) * 2); g.rotate(b.spin);
      const s = b.radius * 1.5;
      g.fillStyle = "rgba(255,255,255,0.1)"; g.fillRect(-s, -s, s * 2, s * 2);
      g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(-s, -s, s * 2, s * 2);
      g.fillStyle = "#ffb020"; g.font = `700 ${b.radius * 1.6}px Outfit, sans-serif`;
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
      g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 2; g.setLineDash([6, 6]); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(aim.x, aim.y, 7, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,0.18)"; g.fill();
      if (dist < MIN_DRAG) continue;
      const launchDir = vnorm(vmul(drag, -1));
      const power = launchPower(s.pos, aim);
      const arrowLen = 24 + power * 70;
      const end = vadd(s.pos, vmul(launchDir, arrowLen + s.radius));
      g.beginPath(); g.moveTo(s.pos.x + launchDir.x * s.radius, s.pos.y + launchDir.y * s.radius);
      g.lineTo(end.x, end.y); g.strokeStyle = s.player.color; g.lineWidth = 3 + power * 3; g.globalAlpha = 0.8; g.stroke(); g.globalAlpha = 1;
      const angle = Math.atan2(launchDir.y, launchDir.x); const hs = 10 + power * 6;
      g.beginPath(); g.moveTo(end.x, end.y);
      g.lineTo(end.x - hs * Math.cos(angle - 0.45), end.y - hs * Math.sin(angle - 0.45));
      g.lineTo(end.x - hs * Math.cos(angle + 0.45), end.y - hs * Math.sin(angle + 0.45));
      g.closePath(); g.fillStyle = s.player.color; g.fill();
    }

    // Players
    this.seats.forEach((s, i) => this.drawSeat(g, s, i, t));

    this.juice.end(g);

    // Popups (unshaken HUD layer)
    for (const p of this.popups) {
      const k = 1 - p.life / p.maxLife;
      const pop = k < 0.15 ? 0.7 + (k / 0.15) * 0.4 : 1.1 - Math.min(0.1, (k - 0.15) * 0.3);
      g.globalAlpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.4)));
      g.font = `800 ${Math.round(p.size * pop)}px Outfit, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 4; g.strokeStyle = "rgba(7,11,20,0.85)"; g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.color; g.fillText(p.text, p.x, p.y);
    }
    g.globalAlpha = 1;

    this.drawHud(g, t);
    this.callouts.draw(g, W, H);
  }

  private drawVault(g: CanvasRenderingContext2D, t: number): void {
    const v = this.vault;
    const r = v.radius;
    const col = this.heist ? HEIST_PINK : GOLD;
    const pulse = 1 + Math.sin(t * (this.heist ? 7 : 3)) * 0.05 + v.flash * 0.4;
    g.save();
    g.translate(v.pos.x, v.pos.y);
    // Glow
    const gr = g.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.6);
    gr.addColorStop(0, this.heist ? "rgba(255,61,122,0.35)" : "rgba(255,215,0,0.28)");
    gr.addColorStop(1, "transparent");
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 2.6 * pulse, 0, Math.PI * 2); g.fill();
    // Disc
    g.beginPath(); g.arc(0, 0, r * pulse, 0, Math.PI * 2);
    g.fillStyle = this.heist ? "rgba(90,20,45,0.85)" : "rgba(60,45,10,0.85)"; g.fill();
    g.lineWidth = 4; g.strokeStyle = col; g.stroke();
    // Spinning dashes
    g.save(); g.rotate(v.spin);
    g.beginPath(); g.arc(0, 0, r * pulse + 9, 0, Math.PI * 2);
    g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = col; g.globalAlpha = 0.7; g.stroke(); g.setLineDash([]);
    g.restore();
    // Move timer arc
    const limit = this.heist ? VAULT_MOVE_HEIST_S : VAULT_MOVE_S;
    const frac = Math.max(0, Math.min(1, v.moveTimer / limit));
    g.globalAlpha = 0.9; g.lineWidth = 5; g.strokeStyle = frac < 0.3 ? "#fff" : col;
    g.beginPath(); g.arc(0, 0, r * pulse - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke();
    g.globalAlpha = 1;
    // Label
    g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `800 ${Math.round(r * 0.5)}px Outfit, sans-serif`;
    g.fillText("VAULT", 0, this.heist ? -r * 0.18 : 0);
    if (this.heist) {
      g.fillStyle = "#fff"; g.font = `800 ${Math.round(r * 0.42)}px Outfit, sans-serif`;
      g.fillText("+1x", 0, r * 0.3);
    }
    g.restore();
  }

  private drawSeat(g: CanvasRenderingContext2D, s: Seat, i: number, t: number): void {
    const { x, y } = s.pos;
    // Loot halo: everyone can see a fat pouch.
    if (s.pouch > 0) {
      const k = Math.min(1, s.pouch / (BANK_STEP * 3));
      g.beginPath(); g.arc(x, y, s.radius + 6 + k * 10 + Math.sin(t * 6) * 2, 0, Math.PI * 2);
      g.strokeStyle = GOLD; g.lineWidth = 2 + k * 4; g.globalAlpha = 0.25 + k * 0.5; g.stroke(); g.globalAlpha = 1;
    }
    if (s.grabbed) {
      g.beginPath(); g.arc(x, y, s.radius + 8, 0, Math.PI * 2);
      g.strokeStyle = s.player.color; g.lineWidth = 2;
      g.globalAlpha = 0.4 + Math.sin(t * 8) * 0.2; g.stroke(); g.globalAlpha = 1;
    }
    if (s.shielded) {
      g.beginPath(); g.arc(x, y, s.radius + 5, 0, Math.PI * 2);
      g.strokeStyle = "rgba(68,187,255,0.7)"; g.lineWidth = 2.5; g.setLineDash([5, 5]); g.stroke(); g.setLineDash([]);
    }
    if (s.turboReady) {
      g.beginPath(); g.arc(x, y, s.radius + 4, 0, Math.PI * 2);
      g.strokeStyle = "rgba(255,204,0,0.6)"; g.lineWidth = 2.5; g.stroke();
    }
    if (s.magnetTimer > 0) {
      g.beginPath(); g.arc(x, y, s.radius + 12, 0, Math.PI * 2);
      g.strokeStyle = "rgba(255,102,136,0.4)"; g.lineWidth = 1.5; g.setLineDash([3, 6]); g.stroke(); g.setLineDash([]);
    }
    // Squash on launch / stretch on hit.
    g.save();
    const speed = vlen(s.vel);
    if (speed > 200) {
      const a = Math.atan2(s.vel.y, s.vel.x);
      const k = Math.min(0.18, (speed - 200) / 4000);
      g.translate(x, y); g.rotate(a); g.scale(1 + k, 1 - k); g.rotate(-a); g.translate(-x, -y);
    }
    drawPlayerOrb(g, x, y, s.radius, s.player, { stunned: s.hitFlash > 0 && Math.floor(t * 20) % 2 === 0 });
    g.restore();
    if (s.bankFlash > 0) {
      g.beginPath(); g.arc(x, y, s.radius + 4 + (0.6 - s.bankFlash) * 60, 0, Math.PI * 2);
      g.strokeStyle = GOLD; g.lineWidth = 3; g.globalAlpha = s.bankFlash / 0.6; g.stroke(); g.globalAlpha = 1;
    }
    // Crown on the leader
    if (i === this.leader) this.drawCrown(g, x, y - s.radius - 11, s.radius * 0.5);
    // Pouch readout
    g.textAlign = "center"; g.textBaseline = "middle";
    const top = y - s.radius - (i === this.leader ? 26 : 13);
    if (s.pouch > 0) {
      const mult = bankMultiplier(s.pouch, { underdog: i === this.underdog, heist: this.heist });
      g.font = "800 15px Outfit, sans-serif";
      g.lineWidth = 3; g.strokeStyle = "rgba(7,11,20,0.85)";
      const label = `+${s.pouch}` + (mult > 1 ? ` x${mult}` : "");
      g.strokeText(label, x, top); g.fillStyle = GOLD; g.fillText(label, x, top);
    }
    if (i === this.underdog) {
      g.font = "800 10px Outfit, sans-serif"; g.fillStyle = "#B8FF3D";
      g.lineWidth = 3; g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText("UNDERDOG +1x", x, y + s.radius + 11); g.fillText("UNDERDOG +1x", x, y + s.radius + 11);
    }
    if (s.combo >= 3) {
      g.font = "800 11px Outfit, sans-serif"; g.fillStyle = "#FFB020";
      g.fillText("x" + comboMultiplier(s.combo), x + s.radius + 12, y - s.radius);
    }
  }

  private drawCrown(g: CanvasRenderingContext2D, cx: number, cy: number, w: number): void {
    const h = w * 0.8;
    g.save();
    g.translate(cx, cy);
    g.beginPath();
    g.moveTo(-w, h / 2); g.lineTo(-w, -h * 0.2); g.lineTo(-w * 0.5, h * 0.1); g.lineTo(0, -h / 2);
    g.lineTo(w * 0.5, h * 0.1); g.lineTo(w, -h * 0.2); g.lineTo(w, h / 2); g.closePath();
    g.fillStyle = GOLD; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "rgba(7,11,20,0.8)"; g.stroke();
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D, t: number): void {
    const W = this.W;
    g.fillStyle = "rgba(7,11,20,0.72)"; g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = this.heist ? HEIST_PINK : "rgba(62,224,255,0.35)"; g.fillRect(0, HUD_H - 2, W, 2);
    const timerW = Math.min(64, W * 0.12);
    const chipW = (W - timerW) / this.seats.length;
    // Shrink the chip text on narrow phones so four seats still fit.
    const fs = Math.max(0.65, Math.min(1, chipW / 130));
    const y = HUD_H - 18;
    g.textBaseline = "middle";
    this.seats.forEach((s, i) => {
      const x0 = chipW * i;
      const cx = x0 + 12 * fs;
      if (i === this.underdog) {
        g.fillStyle = "rgba(184,255,61,0.12)"; g.fillRect(x0 + 2, HUD_H - 30, chipW - 4, 26);
      }
      g.beginPath(); g.arc(cx, y, 6 * fs, 0, Math.PI * 2); g.fillStyle = s.player.color; g.fill();
      if (i === this.leader) this.drawCrown(g, cx, y - 11 * fs, 6 * fs);
      g.font = `800 ${Math.round(18 * fs)}px Outfit, sans-serif`; g.textAlign = "left";
      g.fillStyle = i === this.leader ? GOLD : "#e6ebf5";
      g.fillText(String(s.score), cx + 12 * fs, y);
      const scoreW = g.measureText(String(s.score)).width;
      if (s.pouch > 0) {
        g.font = `700 ${Math.round(12 * fs)}px Outfit, sans-serif`; g.fillStyle = GOLD; g.globalAlpha = 0.9;
        g.fillText(`+${s.pouch}`, cx + 16 * fs + scoreW, y + 1); g.globalAlpha = 1;
      }
    });
    const tl = Math.max(0, this.timeLeft); const secs = Math.ceil(tl);
    g.font = `800 ${Math.round(18 * fs)}px Outfit, sans-serif`; g.textAlign = "right";
    g.fillStyle = this.heist ? HEIST_PINK : tl < 25 ? "#FFB020" : "#9aa3c7";
    g.fillText(String(secs), W - 12, y);
    const tag = this.heist ? "HEIST +1x" : this.doubleTime > 0 ? "2X COINS" : null;
    if (tag && fs >= 0.9) {
      g.font = "800 12px Outfit, sans-serif";
      g.fillStyle = this.heist ? `rgba(255,61,122,${0.6 + Math.sin(t * 8) * 0.4})` : "rgba(102,255,170,0.9)";
      g.fillText(tag, W - 44, y);
    }
  }
}
