import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  activeDecoy,
  activeFake,
  advanceRound,
  botBiteDecoy,
  botProfile,
  botWantsDouble,
  heckle,
  isMatchPoint,
  matchOver,
  newRound,
  planBotHeckles,
  planBotTap,
  planRound,
  settleRound,
  tap,
  tickDone,
  underdogs,
  FAKE_SHOW_MS,
  HECKLE_WORDS,
  ROUNDS,
  SO_CLOSE_MS,
  WINS_NEEDED,
  type BotProfile,
  type RoundState,
} from "./logic";

export const quickDraw: GameDefinition = {
  id: "quick-draw",
  name: "High Noon",
  tagline: "Double down. Wait for it... DRAW!",
  description:
    "A standoff with stakes. Wait for DRAW! then tap your zone first. Tap early (fakes like DRUM! " +
    "count) and you're out, but you get two bottles to throw and heckle the others into jumping. " +
    "Between rounds, tap to DOUBLE DOWN: a win pays 2 notches, a false start costs 1. Underdogs " +
    "double for free. First to 4 notches wins.",
  durationMs: 0,
  controls: "Tap your zone on DRAW! Tap between rounds to double down.",
  create: (ctx) => new QuickDraw(ctx),
};

const INTRO_S = 1.6;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
/** Taps between rounds count as a double-down only after the late-draw window has closed. */
const DOUBLE_OPENS_S = 0.6;
/** Taps in the last part of the intro are swallowed so a double-down tap can't become a false start. */
const DOUBLE_CLOSES_BEFORE_S = 0.3;
const FONT = "Bebas Neue, Impact, sans-serif";
const GOLD = "#FFB020";
const PINK = "#FF3D7A";
const WHITE = "#F4F7FB";

type Phase = "intro" | "round" | "result" | "final";

interface Bullet {
  x: number;
  prevX: number;
  y: number;
  vx: number;
  life: number;
  color: string;
}

interface Hat {
  seat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  bounces: number;
  band: string;
}

interface Bottle {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  seat: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

const HAT_W = 84;
const BULLET_SPEED = 2600;
const BEST_KEY = "quick-draw-ms";

interface Seat {
  player: Player;
  x: number;
  w: number;
  wins: number;
  falseStarts: number;
  heckleHits: number;
  best: number | null;
  botTapAt: number | null;
  botHeckleAt: number[];
  /** Seconds into the between-round window at which this bot raises, if it does. */
  botDoubleAt: number | null;
  profile: BotProfile | null;
  doubled: boolean;
  free: boolean;
  wonLast: boolean;
  soClose: boolean;
}

class QuickDraw implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private round: RoundState;
  private resultText = "";
  private resultColor = WHITE;
  private finished = false;
  private lastFake: number | null = null;
  private drawShown = false;
  private bullets: Bullet[] = [];
  private hats: Hat[] = [];
  private bottles: Bottle[] = [];
  private floaters: Floater[] = [];
  private flash = 0;
  private heartbeat = 0;
  private beatT = 0;
  private time = 0;
  /** Seconds since the between-round window (result + intro) opened. */
  private betweenT = DOUBLE_OPENS_S;
  private recoil: number[];
  private readonly best: number;
  private newBest = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player, x: i * w, w, wins: 0, falseStarts: 0, heckleHits: 0, best: null, botTapAt: null, botHeckleAt: [],
      botDoubleAt: null, profile: player.kind === "bot" ? botProfile(ctx.rng) : null,
      doubled: false, free: false, wonLast: false, soClose: false,
    }));
    this.recoil = this.seats.map(() => 0);
    this.best = loadBest(BEST_KEY);
    this.round = this.startRound();
    this.planBotDoubles();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private startRound(): RoundState {
    const plan = planRound(this.roundIndex, this.ctx.rng);
    for (const s of this.seats) {
      s.botTapAt = s.profile ? planBotTap(plan, this.ctx.rng, 0.15, s.profile) : null;
      s.botHeckleAt = [];
      s.soClose = false;
    }
    this.lastFake = null;
    this.drawShown = false;
    this.hats = [];
    this.bullets = [];
    this.bottles = [];
    this.beatT = 0;
    return newRound(plan, this.seats.length);
  }

  /** Bots decide whether to raise for the coming round, and when (visibly) to slap the chip. */
  private planBotDoubles(): void {
    const wins = this.seats.map((s) => s.wins);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      s.botDoubleAt = null;
      if (!s.profile || s.doubled) continue;
      if (botWantsDouble(wins, i, s.free, s.wonLast, this.ctx.rng)) {
        s.botDoubleAt = DOUBLE_OPENS_S + this.ctx.rng.float(0.2, 2.2);
      }
    }
  }

  private get matchPoint(): boolean {
    return isMatchPoint(this.seats.map((s) => s.wins), this.seats.map((s) => s.doubled));
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    this.time += realDt;
    const dt = this.juice.update(realDt);
    this.stepProps(realDt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      this.betweenT += dt;
      this.stepBotDoubles();
      if (this.timer <= 0) this.phase = "round";
      return;
    }
    if (this.phase === "result" || this.phase === "final") {
      this.timer -= dt;
      this.betweenT += dt;
      tickDone(this.round, dt * 1000);
      // Bots that were still drawing when the winner fired show how late they were.
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i]!;
        if (s.botTapAt !== null && this.round.t >= s.botTapAt) {
          s.botTapAt = null;
          this.lateTap(i);
        }
      }
      if (this.phase === "result") this.stepBotDoubles();
      if (this.timer > 0) return;
      if (this.phase === "final") {
        this.finished = true;
        return;
      }
      this.roundIndex += 1;
      this.round = this.startRound();
      this.phase = "intro";
      this.timer = INTRO_S;
      return;
    }

    const r = this.round;
    advanceRound(r, dt * 1000);

    // Heartbeat: the longer the wait, the faster it thumps; match point thumps faster still.
    if (r.phase === "wait") {
      const tension = Math.min(1, r.t / r.plan.waitMs);
      const period = (1.1 - tension * 0.7) * (this.matchPoint ? 0.85 : 1);
      this.beatT += dt;
      if (this.beatT >= period) {
        this.beatT = 0;
        this.heartbeat = 1;
        this.ctx.sfx.tick();
      }
    }

    const fake = activeFake(r);
    if (fake && fake.atMs !== this.lastFake) {
      this.lastFake = fake.atMs;
      if (fake.kind === "tumbleweed") this.ctx.sfx.whoosh();
      else this.ctx.sfx.countdown();
    }
    if (!this.drawShown && r.t >= r.plan.waitMs) {
      this.drawShown = true;
      this.flash = 1;
      this.juice.shake(0.2);
      this.ctx.sfx.go();
    }

    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.botTapAt !== null && r.t >= s.botTapAt) {
        s.botTapAt = null;
        this.press(i);
      }
      const next = s.botHeckleAt[0];
      if (next !== undefined && r.t >= next) {
        s.botHeckleAt.shift();
        this.throwBottle(i);
      }
    }

    if (r.phase === "done") this.endRound();
  }

  private stepBotDoubles(): void {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.botDoubleAt !== null && this.betweenT >= s.botDoubleAt) {
        s.botDoubleAt = null;
        this.doubleDown(i);
      }
    }
  }

  /** Whether a tap right now is a double-down (between rounds, outside the late-draw and dead zones). */
  private doubleWindowOpen(): boolean {
    if (this.phase === "result") return this.betweenT >= DOUBLE_OPENS_S;
    if (this.phase === "intro") return this.betweenT >= DOUBLE_OPENS_S && this.timer > DOUBLE_CLOSES_BEFORE_S;
    return false;
  }

  private doubleDown(i: number): void {
    const s = this.seats[i]!;
    if (s.doubled) return;
    s.doubled = true;
    s.botDoubleAt = null;
    const cx = s.x + s.w / 2;
    this.floaters.push({ x: cx, y: 150, text: s.free ? "FREE ×2!" : "×2!", color: GOLD, life: 1.1, maxLife: 1.1, size: 48 });
    this.juice.burst(cx + 70, 64, [GOLD, "#fff2c2"], { count: 14, speed: 200, gravity: 300, size: 4, life: 0.5 });
    this.ctx.sfx.streak(2);
  }

  private press(i: number): void {
    if (this.phase !== "round") {
      if (this.phase === "result" && this.betweenT < DOUBLE_OPENS_S) this.lateTap(i);
      else if (this.doubleWindowOpen()) this.doubleDown(i);
      return;
    }
    const r = this.round;
    advanceRound(r, 0);
    const seat = this.seats[i]!;
    if (r.out[i]) {
      this.throwBottle(i);
      return;
    }
    const res = tap(r, i);
    const cx = seat.x + seat.w / 2;
    const h = this.ctx.height;
    if (res === "false-start") {
      seat.falseStarts += 1;
      this.recoil[i] = 1;
      // Fires into the dirt: dust and a dropped hat.
      this.juice.burst(cx + 30, h * 0.86, ["#b8925a", "rgba(244,247,251,0.5)"], {
        count: 16, speed: 220, angle: -Math.PI / 2, spread: 1.4, gravity: 600, size: 5,
      });
      this.popHat(i, (this.ctx.rng.next() - 0.5) * 120, -260);
      this.ctx.sfx.miss();
      this.juice.shake(0.2);
      if (seat.profile) seat.botHeckleAt = planBotHeckles(r.t, this.ctx.rng);
      const by = r.baitedBy[i];
      if (by !== null && by !== undefined) {
        const heckler = this.seats[by]!;
        heckler.heckleHits += 1;
        this.floaters.push({
          x: heckler.x + heckler.w / 2, y: h * 0.5, text: "GOTCHA!", color: heckler.player.color, life: 1.2, maxLife: 1.2, size: 52,
        });
        this.ctx.sfx.collect();
      }
    } else if (res === "win") {
      this.recoil[i] = 1;
      this.juice.hitStop(0.08);
      this.juice.shake(0.45);
      this.flash = 0.8;
      // Muzzle flash.
      this.juice.burst(cx + 70, h * 0.86 - 185, [GOLD, "#ffffff"], { count: 18, speed: 380, life: 0.3, gravity: 0, size: 6 });
      // One bullet each way so everyone else's hat gets hit.
      for (const dir of [-1, 1]) {
        const x = cx + dir * 70;
        this.bullets.push({ x, prevX: x, y: h * 0.86 - 190, vx: dir * BULLET_SPEED, life: 1, color: seat.player.color });
      }
      this.ctx.sfx.hit();
    }
    if (r.phase === "done") this.endRound();
  }

  /** A draw after the winner's: show the gap. Within SO_CLOSE_MS it stings. */
  private lateTap(i: number): void {
    const r = this.round;
    if (tap(r, i) !== "late") return;
    const seat = this.seats[i]!;
    this.recoil[i] = 0.6;
    const gap = (r.lateMs[i] ?? 0) - (r.reactionMs ?? 0);
    if (gap <= SO_CLOSE_MS) {
      seat.soClose = true;
      this.floaters.push({ x: seat.x + seat.w / 2, y: this.ctx.height * 0.5, text: "SO CLOSE", color: PINK, life: 1.3, maxLife: 1.3, size: 50 });
      this.ctx.sfx.miss();
    } else {
      this.ctx.sfx.tick();
    }
  }

  /** A false-starter throws a bottle across the street and yells a decoy call. */
  private throwBottle(i: number): void {
    const r = this.round;
    const seat = this.seats[i]!;
    const decoy = heckle(r, i, this.ctx.rng.pick(HECKLE_WORDS));
    if (!decoy) return;
    const live = this.seats.filter((_, k) => !r.out[k] && k !== i);
    const target = live.length > 0 ? this.ctx.rng.pick(live) : null;
    const sc = Math.min(1, this.ctx.height / 720);
    const groundY = this.ctx.height * 0.86;
    const x1 = target ? target.x + target.w * this.ctx.rng.float(0.25, 0.75) : this.ctx.width / 2;
    this.bottles.push({ x0: seat.x + seat.w / 2 + 30 * sc, y0: groundY - 150 * sc, x1, y1: groundY, t: 0, dur: 0.55, seat: i });
    this.recoil[i] = 0.5;
    this.ctx.sfx.whoosh();
    // Live bots may bite on the decoy like a human would.
    for (let k = 0; k < this.seats.length; k++) {
      const s = this.seats[k]!;
      if (k === i || r.out[k] || s.botTapAt === null) continue;
      const bite = botBiteDecoy(decoy.atMs, this.ctx.rng);
      // A flinch that would land after DRAW is just a held breath, not a lucky 90ms draw.
      if (bite !== null && bite < s.botTapAt && bite < r.plan.waitMs) s.botTapAt = bite;
    }
  }

  private endRound(): void {
    if (this.phase !== "round") return;
    const r = this.round;
    const h = this.ctx.height;
    const settled = settleRound(this.seats.map((s) => s.wins), r, this.seats.map((s) => s.doubled), this.seats.map((s) => s.free));
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const delta = settled.deltas[i] ?? 0;
      const cx = s.x + s.w / 2;
      if (delta > 0) {
        for (let k = s.wins; k < Math.min(WINS_NEEDED, s.wins + delta); k++) {
          this.juice.burst(cx + (k - (WINS_NEEDED - 1) / 2) * 26, 64, [s.player.color, "#ffffff"], { count: 10, speed: 160, gravity: 200, size: 3, life: 0.5 });
        }
        if (delta > 1) {
          this.floaters.push({ x: cx, y: 150, text: "+2 ×2!", color: GOLD, life: 1.4, maxLife: 1.4, size: 48 });
          this.ctx.sfx.streak(3);
        }
      } else if (delta < 0) {
        const k = s.wins - 1;
        this.juice.burst(cx + (k - (WINS_NEEDED - 1) / 2) * 26, 64, [s.player.color, PINK], { count: 14, speed: 220, gravity: 500, size: 4, life: 0.7 });
        this.floaters.push({ x: cx, y: 150, text: "−1 NOTCH", color: PINK, life: 1.4, maxLife: 1.4, size: 44 });
      }
      s.wins = settled.wins[i] ?? s.wins;
      s.wonLast = r.winner === i;
    }
    if (r.winner !== null) {
      const seat = this.seats[r.winner]!;
      const ms = r.reactionMs ?? 0;
      if (seat.best === null || ms < seat.best) seat.best = ms;
      this.resultText = `${seat.player.name} wins in ${ms} ms${seat.doubled ? "  ×2" : ""}`;
      this.resultColor = seat.player.color;
      if (seat.player.kind === "human" && ms > 0) {
        // Stored inverted (higher = better) so saveBest keeps the fastest time.
        const bestMs = this.best > 0 ? 100000 - this.best : 0;
        const record = bestMs === 0 || ms < bestMs;
        if (record && saveBest(BEST_KEY, 100000 - ms)) {
          this.newBest = true;
          this.callouts.show(`NEW RECORD ${ms} ms`, "#B8FF3D", { size: 56, y: 0.55, life: 1.8 });
          this.ctx.sfx.streak(4);
        } else if (ms < 200) {
          this.callouts.show("LIGHTNING!", GOLD, { size: 56, y: 0.55, life: 1.4 });
        }
      }
      this.ctx.sfx.collect();
    } else {
      const baited = r.baitedBy.some((b) => b !== null);
      this.resultText = r.out.every(Boolean)
        ? (baited ? "Heckled into the dirt! No point." : "Everyone jumped the gun! No point.")
        : "Nobody drew. No point.";
      this.resultColor = PINK;
    }
    const wins = this.seats.map((s) => s.wins);
    this.betweenT = 0;
    const free = underdogs(wins);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      s.doubled = false;
      s.free = free[i] ?? false;
    }
    if (matchOver(wins, this.roundIndex + 1)) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...wins);
      const leaders = this.seats.filter((s) => s.wins === top);
      const text = top === 0 ? "NO WINNER" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(text, leaders.length === 1 && top > 0 ? leaders[0]!.player.color : WHITE, {
        size: 72, life: RESULT_S + FINAL_S, y: 0.2,
      });
      this.juice.burst(this.ctx.width / 2, h * 0.2, leaders.map((s) => s.player.color).concat([GOLD, "#ffffff"]), {
        count: 60, speed: 420, gravity: 350, size: 6, life: 1.4,
      });
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
      this.planBotDoubles();
    }
  }

  private popHat(seat: number, vx: number, vy: number): void {
    if (this.hats.some((h) => h.seat === seat)) return;
    const s = this.seats[seat]!;
    const sc = Math.min(1, this.ctx.height / 720);
    const groundY = this.ctx.height * 0.86;
    this.hats.push({
      seat, x: s.x + s.w / 2, y: groundY - 228 * sc, vx, vy,
      rot: 0, vr: (this.ctx.rng.next() - 0.5) * 14, bounces: 0, band: s.doubled ? GOLD : s.player.color,
    });
  }

  private stepProps(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 4);
    this.heartbeat = Math.max(0, this.heartbeat - dt * 5);
    for (let i = 0; i < this.recoil.length; i++) this.recoil[i] = Math.max(0, this.recoil[i]! - dt * 6);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 28 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    const groundY = this.ctx.height * 0.86;
    const hatH = 40 * Math.min(1, this.ctx.height / 720);
    for (const b of this.bullets) {
      b.prevX = b.x;
      b.x += b.vx * dt;
      b.life -= dt;
      const lo = Math.min(b.prevX, b.x) - 40;
      const hi = Math.max(b.prevX, b.x) + 40;
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i]!;
        if (i === this.round.winner || this.hats.some((h) => h.seat === i)) continue;
        const cx = s.x + s.w / 2;
        if (cx >= lo && cx <= hi) {
          this.popHat(i, Math.sign(b.vx) * 320 + (this.ctx.rng.next() - 0.5) * 100, -520);
          this.juice.burst(cx, groundY - 230, ["#3b2a1a", s.player.color], { count: 12, speed: 240, gravity: 500, size: 4 });
          this.juice.shake(0.15);
          this.ctx.sfx.tick();
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0 && b.x > -100 && b.x < this.ctx.width + 100);

    for (const bt of this.bottles) {
      bt.t += dt;
      if (bt.t >= bt.dur) {
        this.juice.burst(bt.x1, bt.y1 - 4, ["#5fb36a", "#bfe8c4", "#ffffff"], {
          count: 16, speed: 260, angle: -Math.PI / 2, spread: 1.6, gravity: 700, size: 4, life: 0.5,
        });
        this.juice.shake(0.08);
        this.ctx.sfx.tick();
      }
    }
    this.bottles = this.bottles.filter((bt) => bt.t < bt.dur);

    this.hats = this.hats.filter((h) => h.x > -HAT_W * 2 && h.x < this.ctx.width + HAT_W * 2);
    for (const h of this.hats) {
      h.vy += 1500 * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
      if (h.y >= groundY - hatH / 2 && h.vy > 0) {
        h.y = groundY - hatH / 2;
        h.bounces++;
        h.vy = -h.vy * 0.4;
        h.vx *= 0.6;
        h.vr *= 0.5;
        if (h.bounces >= 3 || Math.abs(h.vy) < 80) {
          h.vy = 0;
          h.vx = 0;
          h.vr = 0;
          h.rot = Math.round(h.rot / Math.PI) * Math.PI + (this.ctx.rng.next() - 0.5) * 0.4;
        } else {
          this.juice.burst(h.x, groundY, "#b8925a", { count: 5, speed: 80, gravity: 300, size: 3, life: 0.35, angle: -Math.PI / 2, spread: 2 });
        }
      }
    }
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human") continue;
      if (p.x >= s.x && p.x < s.x + s.w) {
        e.preventDefault();
        this.press(i);
        return;
      }
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawSeat(g, i);
    this.drawTumbleweed(g);
    this.drawBottles(g);
    this.drawBullets(g);
    this.drawHats(g);
    this.juice.end(g);
    if (this.heartbeat > 0 && this.phase === "round") {
      const rgb = this.matchPoint ? "255,176,32" : "255,61,122";
      const grad = g.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.9);
      grad.addColorStop(0, `rgba(${rgb},0)`);
      grad.addColorStop(1, `rgba(${rgb},${this.heartbeat * 0.28})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
    }
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,235,180,${this.flash * 0.35})`;
      g.fillRect(0, 0, width, height);
    }
    this.drawCenter(g);
    this.drawFloaters(g);
    this.callouts.draw(g, width, height);
  }

  private drawSeat(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const r = this.round;
    const out = r.out[i] ?? false;
    const won = r.winner === i;
    const late = r.lateMs[i];
    const cx = s.x + s.w / 2;
    const between = this.phase === "result" || this.phase === "intro";
    const human = s.player.kind === "human";

    g.save();
    g.globalAlpha = out ? 0.08 : won ? 0.22 : 0.1;
    g.fillStyle = s.player.color;
    g.fillRect(s.x, 0, s.w, h);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x + s.w, 0);
    g.lineTo(s.x + s.w, h);
    g.stroke();

    // Ground line.
    g.fillStyle = "rgba(160,110,60,0.35)";
    g.fillRect(s.x, h * 0.86, s.w, h * 0.14);

    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = s.player.color;
    g.font = `700 34px ${FONT}`;
    g.fillText(s.player.name, cx, 14);

    // Notches (round wins).
    for (let k = 0; k < WINS_NEEDED; k++) {
      g.beginPath();
      g.arc(cx + (k - (WINS_NEEDED - 1) / 2) * 26, 64, 9, 0, Math.PI * 2);
      g.fillStyle = k < s.wins ? s.player.color : "rgba(244,247,251,0.15)";
      g.fill();
    }
    if (s.doubled) this.drawChip(g, cx + 72, 64, "×2", GOLD, "#1a1206", 20);

    this.drawGunslinger(g, cx, h * 0.86, s.player.color, out, won, this.hats.some((hat) => hat.seat === i), this.recoil[i]!, s.doubled);

    // Footer: what happened to this seat, then what they can do now.
    g.textBaseline = "middle";
    let line1 = "";
    let color1 = WHITE;
    let line2 = "";
    let color2 = "rgba(244,247,251,0.4)";
    if (out) {
      line1 = "TOO EARLY!";
      color1 = PINK;
      const left = r.bottles[i] ?? 0;
      if (this.phase === "round") {
        line2 = human ? (left > 0 ? `TAP: HECKLE (${left} LEFT)` : "OUT OF BOTTLES") : (left > 0 ? "HECKLING..." : "");
        color2 = left > 0 ? s.player.color : color2;
      }
    } else if (won) {
      line1 = `${r.reactionMs} ms`;
      color1 = s.doubled ? GOLD : WHITE;
    } else if (late !== null && late !== undefined) {
      line1 = `+${late - (r.reactionMs ?? 0)} ms`;
      color1 = s.soClose ? PINK : "rgba(244,247,251,0.7)";
    } else if (human && this.phase === "round") {
      line2 = "TAP HERE";
    }
    if (between && this.phase !== "final") {
      if (s.doubled) {
        line2 = s.free ? "DOUBLED (FREE)" : "DOUBLED ×2";
        color2 = GOLD;
      } else if (human && this.doubleWindowOpen()) {
        line2 = s.free ? "TAP: FREE DOUBLE" : "TAP: DOUBLE DOWN";
        color2 = GOLD;
      }
    }
    if (line1) {
      g.fillStyle = color1;
      g.font = `700 36px ${FONT}`;
      g.fillText(line1, cx, h * 0.905);
    }
    if (line2) {
      const pulse = color2 === GOLD && !s.doubled ? 0.75 + 0.25 * Math.sin(this.time * 7) : 1;
      g.globalAlpha = pulse;
      g.fillStyle = color2;
      g.font = `700 24px ${FONT}`;
      g.fillText(line2, cx, h * 0.957);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  private drawChip(g: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string, size: number): void {
    g.save();
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const w = g.measureText(text).width + 16;
    const hh = size + 6;
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(x - w / 2, y - hh / 2, w, hh, 6);
    g.fill();
    g.fillStyle = ink;
    g.fillText(text, x, y + 1);
    g.restore();
  }

  private drawGunslinger(
    g: CanvasRenderingContext2D, x: number, groundY: number, color: string, out: boolean, won: boolean,
    hatless: boolean, recoil: number, doubled: boolean,
  ): void {
    const s = Math.min(1, this.ctx.height / 720);
    g.save();
    g.translate(x, groundY);
    g.scale(s, s);
    if (out) g.rotate(0.35);
    if (recoil > 0) {
      g.translate(-recoil * 10, 0);
      g.rotate(-recoil * 0.08);
      // Squash on the kick.
      g.scale(1 + recoil * 0.08, 1 - recoil * 0.08);
    }
    g.globalAlpha = out ? 0.45 : 1;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 10;
    g.lineCap = "round";
    // Legs.
    g.beginPath();
    g.moveTo(0, -90); g.lineTo(-22, 0);
    g.moveTo(0, -90); g.lineTo(22, 0);
    g.stroke();
    // Body.
    g.fillRect(-22, -170, 44, 85);
    // Arm: holstered, or raised pointing up/forward when this seat won.
    g.beginPath();
    g.moveTo(18, -155);
    if (won) {
      g.lineTo(70, -185);
      g.stroke();
      g.fillStyle = "#c9ced6";
      g.fillRect(64, -200, 34, 12);
    } else {
      g.lineTo(30, -100);
      g.stroke();
      g.fillStyle = "#6b4a2b";
      g.fillRect(24, -110, 16, 28);
    }
    g.beginPath();
    g.moveTo(-18, -155); g.lineTo(-30, -100);
    g.strokeStyle = color;
    g.stroke();
    // Head.
    g.fillStyle = "#e8c39e";
    g.beginPath();
    g.arc(0, -195, 24, 0, Math.PI * 2);
    g.fill();
    if (!hatless) {
      this.drawHat(g, doubled ? GOLD : color);
    } else {
      // Bare head: a tuft of hair.
      g.fillStyle = "#3b2a1a";
      g.fillRect(-16, -224, 32, 8);
    }
    g.restore();
  }

  /** Hat drawn with its brim centered at (0, -213) in gunslinger space. */
  private drawHat(g: CanvasRenderingContext2D, band: string): void {
    g.fillStyle = "#3b2a1a";
    g.fillRect(-42, -218, 84, 10);
    g.fillRect(-24, -250, 48, 34);
    g.fillStyle = band;
    g.fillRect(-24, -224, 48, 6);
    if (band === GOLD) {
      g.fillStyle = "#ffffff";
      g.fillRect(-24, -230, 48, 3);
    }
  }

  private drawHats(g: CanvasRenderingContext2D): void {
    const s = Math.min(1, this.ctx.height / 720);
    for (const h of this.hats) {
      g.save();
      g.translate(h.x, h.y);
      g.rotate(h.rot);
      g.scale(s, s);
      g.translate(0, 232);
      this.drawHat(g, h.band);
      g.restore();
    }
  }

  private drawBottles(g: CanvasRenderingContext2D): void {
    for (const bt of this.bottles) {
      const p = Math.min(1, bt.t / bt.dur);
      const x = bt.x0 + (bt.x1 - bt.x0) * p;
      const arc = Math.max(120, Math.abs(bt.x1 - bt.x0) * 0.35);
      const y = bt.y0 + (bt.y1 - bt.y0) * p - Math.sin(p * Math.PI) * arc;
      g.save();
      g.translate(x, y);
      g.rotate(p * 9 * Math.sign(bt.x1 - bt.x0 || 1));
      g.fillStyle = "#5fb36a";
      g.fillRect(-6, -11, 12, 22);
      g.fillRect(-3, -19, 6, 9);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(-4, -8, 3, 14);
      g.restore();
    }
  }

  private drawBullets(g: CanvasRenderingContext2D): void {
    for (const b of this.bullets) {
      const len = Math.sign(b.vx) * 90;
      const grad = g.createLinearGradient(b.x - len, b.y, b.x, b.y);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, b.color);
      g.strokeStyle = grad;
      g.lineWidth = 5;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(b.x - len, b.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(b.x, b.y, 4, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawTumbleweed(g: CanvasRenderingContext2D): void {
    const fake = activeFake(this.round);
    if (!fake || fake.kind !== "tumbleweed") return;
    const p = (this.round.t - fake.atMs) / FAKE_SHOW_MS;
    const x = -60 + p * (this.ctx.width + 120);
    const y = this.ctx.height * 0.82 - Math.abs(Math.sin(p * Math.PI * 3)) * 40;
    g.save();
    g.translate(x, y);
    g.rotate(p * 12);
    g.strokeStyle = "#b8925a";
    g.lineWidth = 4;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.ellipse(0, 0, 38, 18 + k * 3, (k * Math.PI) / 6, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    for (const f of this.floaters) {
      const t = 1 - f.life / f.maxLife;
      const pop = t < 0.15 ? 0.7 + (t / 0.15) * 0.4 : 1.1 - Math.min(0.1, (t - 0.15) * 0.5);
      g.save();
      g.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.35));
      g.translate(f.x, f.y);
      g.scale(pop, pop);
      g.font = `700 ${f.size}px ${FONT}`;
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
    g.restore();
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const r = this.round;
    let text = "";
    let color = WHITE;
    let size = 64;
    let sub = "";
    let subColor = GOLD;
    let tilt = 0;
    let pop = 1;
    if (this.phase === "intro") {
      text = `ROUND ${this.roundIndex + 1}`;
      size = 72;
      if (this.roundIndex === ROUNDS - 1) sub = "LAST CALL";
      else if (this.matchPoint) sub = "MATCH POINT";
      else if (this.roundIndex === 0 && this.seats.some((s) => s.player.kind === "human")) {
        sub = "TAP YOUR ZONE TO DOUBLE DOWN";
        subColor = "rgba(255,176,32,0.8)";
      }
    } else if (this.phase === "round") {
      const fake = activeFake(r);
      const decoy = activeDecoy(r);
      if (r.phase === "draw" || (r.phase === "done" && r.t >= r.plan.waitMs)) {
        text = "DRAW!";
        color = GOLD;
        size = 170;
        const since = (r.t - r.plan.waitMs) / 1000;
        pop = 1 + 0.3 * Math.max(0, 1 - since / 0.14);
      } else if (fake && fake.kind !== "tumbleweed") {
        text = fake.kind;
        color = GOLD;
        size = 150;
      } else if (decoy) {
        // A heckler's call: their colour, a drunken tilt, never the gold of the real thing.
        text = decoy.word;
        color = this.seats[decoy.seat]!.player.color;
        size = 130;
        tilt = (decoy.seat % 2 === 0 ? -1 : 1) * 0.07;
        pop = 1 + 0.2 * Math.max(0, 1 - (r.t - decoy.atMs) / 120);
      } else {
        text = "steady...";
        color = "rgba(244,247,251,0.5)";
        size = 48;
      }
    } else {
      text = this.resultText;
      color = this.resultColor;
      size = 56;
      if (this.phase === "result" && this.matchPoint) sub = "MATCH POINT NEXT";
    }
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const y = height * 0.36;
    g.save();
    g.translate(width / 2, y);
    g.rotate(tilt);
    g.scale(pop, pop);
    g.font = `700 ${size}px ${FONT}`;
    g.strokeText(text, 0, 0);
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
    if (sub) {
      g.font = `700 36px ${FONT}`;
      g.lineWidth = 6;
      g.strokeText(sub, width / 2, height * 0.46);
      g.fillStyle = subColor;
      g.fillText(sub, width / 2, height * 0.46);
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.wins }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Fastest draw", value: s.best === null ? "-" : `${s.best} ms` });
      out.push({ playerId: s.player.id, label: "False starts", value: String(s.falseStarts) });
      if (s.heckleHits > 0) out.push({ playerId: s.player.id, label: "Heckle hits", value: String(s.heckleHits) });
      if (s.player.kind === "human" && this.newBest) out.push({ playerId: s.player.id, label: "Record", value: "NEW BEST" });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
