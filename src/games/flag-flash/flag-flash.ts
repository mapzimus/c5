import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  advanceRound,
  bank,
  FEINT_MS,
  FLASH_MS,
  HECKLE_COOLDOWN_MS,
  heckle,
  HOT_STREAK,
  isFinalHeat,
  MAX_CALLS,
  newRound,
  planBotBank,
  planBotCall,
  planBotFeint,
  planBotHeckle,
  secondWind,
  SHOWDOWN_CALLS,
  SWAP_MS,
  tap,
  type BotTap,
  type Half,
  type RoundEvent,
  type RoundState,
} from "./logic";

export const flagFlash: GameDefinition = {
  id: "flag-flash",
  name: "Flag Flash",
  tagline: "RED! BLUE! BOTH! ...GOTCHA!",
  description:
    "A caller waves a red flag and a blue flag. On RED tap your red half, on BLUE your blue half, " +
    "on BOTH tap both (two fingers), on NONE keep still. Every answer scores; fall and you become a " +
    "HECKLER who baits the survivors with fake flag twitches. Last one standing faces a SHOWDOWN: " +
    "bank the growing pot or lose it all. Three heats, the last one in OVERDRIVE for double points.",
  durationMs: 0,
  controls: "Tap the called half. Out? Tap FEINT! to heckle.",
  create: (ctx) => new FlagFlash(ctx),
};

const INTRO_S = 1.4;
const RESULT_S = 2.0;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";
const RED = "#FF3B3B";
const BLUE = "#3E8BFF";
const BOTH_COLOR = "#E6A6FF";
const NONE_COLOR = "#B7BEC9";
const HOT = "#FFB020";
const GOLD = "#FFD84A";
const PINK = "#FF3D7A";
const BAND = 0.34;
const CENTER_Y = 0.6;
const OUT_Y = 0.525;
const FEINT_Y = 0.73;
const LABEL_Y = 0.76;
const BANK_Y = 0.9;
const RECORD_KEY = "v2-fast";
/** Fastest responses are stored as 10000 - ms so the shared "higher is better" record helper works. */
const RECORD_BASE = 10000;

type GamePhase = "intro" | "round" | "result" | "final";

interface Seat {
  player: Player;
  x: number;
  w: number;
  score: number;
  knockouts: number;
  best: number | null;
  bites: number;
  banked: number;
  botTaps: BotTap[];
  botBiteAt: number | null;
  botHeckleAt: number | null;
  botBankAt: number | null;
  /** Calls of swap confusion left for a bot. */
  swapDaze: number;
  flashLeft: number;
  flashRight: number;
  outFlash: number;
  shieldPop: number;
  hitLabel: string;
  hitLabelColor: string;
  hitLabelT: number;
  scorePop: string;
  scorePopColor: string;
  scorePopT: number;
  hotGlow: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

class FlagFlash implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: GamePhase = "intro";
  private timer = INTRO_S;
  private heat = 0;
  private round: RoundState;
  private lastPhase: RoundState["phase"] = "gap";
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private armRed = 0;
  private armBlue = 0;
  private swapAnim = 0;
  private flash = 0;
  private flashColor = "244,247,251";
  private time = 0;
  private recordShown = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player, x: i * w, w, score: 0, knockouts: 0, best: null, bites: 0, banked: 0,
      botTaps: [], botBiteAt: null, botHeckleAt: null, botBankAt: null, swapDaze: 0,
      flashLeft: 0, flashRight: 0, outFlash: 0, shieldPop: 0,
      hitLabel: "", hitLabelColor: "#F4F7FB", hitLabelT: 0,
      scorePop: "", scorePopColor: "#F4F7FB", scorePopT: 0, hotGlow: 0,
    }));
    this.round = newRound(this.seats.length, 0, ctx.rng);
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private startHeat(): void {
    const shields = this.heat === 0 ? [] : secondWind(this.seats.map((s) => s.score));
    this.round = newRound(this.seats.length, this.heat, this.ctx.rng, shields, isFinalHeat(this.heat, this.time * 1000));
    this.lastPhase = "gap";
    this.swapAnim = 0;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      s.botTaps = [];
      s.botBiteAt = null;
      s.botHeckleAt = null;
      s.botBankAt = null;
      s.swapDaze = 0;
      s.hitLabel = "";
      s.hitLabelT = 0;
      if (shields[i]) {
        s.shieldPop = 1;
        this.label(i, "SECOND WIND", GOLD, 2.2);
      }
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.stepFx(realDt);
    this.animateArms(realDt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "round";
        this.ctx.sfx.countdown();
      }
      return;
    }
    if (this.phase === "result" || this.phase === "final") {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.phase === "final") {
        this.finished = true;
        return;
      }
      this.heat += 1;
      this.startHeat();
      this.phase = "intro";
      this.timer = INTRO_S;
      const cfg = this.round.cfg;
      if (cfg.overdrive) {
        this.callouts.show("FINAL HEAT: OVERDRIVE", PINK, { size: 60, life: INTRO_S + 0.6, y: 0.3 });
        this.juice.shake(0.3);
        this.ctx.sfx.whoosh();
      }
      return;
    }

    const r = this.round;
    const events = advanceRound(r, dt * 1000, this.ctx.rng);
    for (const ev of events) this.onEvent(ev);
    if (r.phase === "gap" && this.lastPhase !== "gap") this.planGapBots();
    this.lastPhase = r.phase;
    this.stepBots();
  }

  // Events from the pure rules.

  private onEvent(ev: RoundEvent): void {
    const r = this.round;
    switch (ev.type) {
      case "call":
        this.onCall();
        break;
      case "feint":
        for (const s of this.seats) {
          // Bots get jumpier as the heat wears on.
          const bite = 0.15 + 0.1 * Math.min(1, r.callIndex / 8);
          s.botBiteAt = s.player.kind === "bot" ? planBotFeint(this.ctx.rng, bite) : null;
        }
        this.ctx.sfx.tick();
        break;
      case "swap":
        this.callouts.show("SWAP!", "#F4F7FB", { size: 64, life: 0.9, y: 0.3 });
        this.ctx.sfx.whoosh();
        this.juice.shake(0.15);
        for (const s of this.seats) if (s.player.kind === "bot") s.swapDaze = 2;
        break;
      case "resolved":
        break;
      case "showdown": {
        const seat = this.seats[ev.seat]!;
        this.callouts.show(`SHOWDOWN: ${seat.player.name.toUpperCase()}`, seat.player.color, { size: 58, life: 1.4, y: 0.3 });
        this.juice.slowMo(0.35, 0.45);
        this.ctx.sfx.go();
        break;
      }
      case "knockout":
        this.knockout(ev.seat, ev.by);
        break;
      case "shield": {
        const s = this.seats[ev.seat]!;
        s.shieldPop = 1;
        this.label(ev.seat, "SHIELD SAVED YOU", GOLD, 1.4);
        this.juice.burst(s.x + s.w / 2, this.ctx.height * 0.55, [GOLD, "#ffffff"], { count: 22, speed: 320, size: 5 });
        this.ctx.sfx.streak(2);
        break;
      }
      case "score": {
        const s = this.seats[ev.seat]!;
        s.score += ev.points;
        const color = ev.why === "hot" ? HOT : ev.why === "bite" ? PINK : ev.why === "bank" ? GOLD : ev.why === "share" ? NONE_COLOR : "#F4F7FB";
        s.scorePop = `+${ev.points}`;
        s.scorePopColor = color;
        s.scorePopT = 1;
        if (ev.why === "hot") {
          s.hotGlow = 1;
          this.ctx.sfx.streak(Math.min(6, r.seats[ev.seat]!.streak - HOT_STREAK + 1));
        } else if (ev.why === "bite") {
          s.bites += 1;
          this.label(ev.seat, `GOTCHA! +${ev.points}`, PINK, 1.6);
          this.callouts.show("GOTCHA!", PINK, { size: 56, life: 0.9, y: 0.3 });
          this.juice.burst(s.x + s.w / 2, this.ctx.height * 0.62, [PINK, "#ffffff"], { count: 18, speed: 300, size: 5 });
        } else if (ev.why === "bank") {
          s.banked += ev.points;
        } else if (ev.why === "share") {
          this.label(ev.seat, `SHARED +${ev.points}`, NONE_COLOR, 1.6);
        }
        break;
      }
      case "pot": {
        this.label(ev.seat, `POT ${ev.pot}`, GOLD, 1.2);
        this.ctx.sfx.collect();
        if (r.showdown && r.showdown.calls >= SHOWDOWN_CALLS - 1) this.callouts.show("LAST CALL!", GOLD, { size: 50, life: 0.8, y: 0.3 });
        break;
      }
      case "potlost": {
        const s = this.seats[ev.seat]!;
        this.callouts.show(`POT LOST: ${ev.pot}`, PINK, { size: 60, life: 1.6, y: 0.3 });
        this.juice.burst(s.x + s.w / 2, this.ctx.height * 0.55, [GOLD, "#5b6373"], { count: 30, speed: 380, size: 6 });
        this.juice.hitStop(0.1);
        break;
      }
      case "done":
        this.endHeat();
        break;
    }
  }

  private onCall(): void {
    const r = this.round;
    this.flash = 0.6;
    this.flashColor = r.call === "RED" ? "255,59,59" : r.call === "BLUE" ? "62,139,255" : r.call === "BOTH" ? "230,166,255" : "183,190,201";
    this.juice.shake(r.cfg.overdrive ? 0.18 : 0.12);
    if (r.call === "NONE") this.ctx.sfx.countdown();
    else this.ctx.sfx.go();
    for (const s of this.seats) {
      if (s.player.kind === "bot" && r.call) {
        s.botTaps = planBotCall(r.call, r.windowMs, r.cfg, r.swapped, this.ctx.rng, 0.08, s.swapDaze > 0 ? 0.25 : 0);
        if (s.swapDaze > 0) s.swapDaze -= 1;
      } else {
        s.botTaps = [];
      }
    }
  }

  /** Bots decide what to do with a fresh gap: heckle, or bank the pot. */
  private planGapBots(): void {
    const r = this.round;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "bot") continue;
      const st = r.seats[i]!;
      s.botHeckleAt = !st.alive && st.heckleCooldown <= 0 && !st.heckleArmed ? planBotHeckle(this.ctx.rng) : null;
      s.botBankAt = r.showdown && r.showdown.seat === i && planBotBank(r.showdown.calls, this.ctx.rng)
        ? Math.round(this.ctx.rng.float(150, 500))
        : null;
    }
  }

  private stepBots(): void {
    const r = this.round;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "bot") continue;
      if (r.phase === "feint" && s.botBiteAt !== null && r.t >= s.botBiteAt) {
        s.botBiteAt = null;
        this.press(i, this.ctx.rng.next() < 0.5 ? "left" : "right");
      }
      if (r.phase === "gap") {
        if (s.botHeckleAt !== null && r.t >= s.botHeckleAt) {
          s.botHeckleAt = null;
          this.doHeckle(i);
        }
        if (s.botBankAt !== null && r.t >= s.botBankAt) {
          s.botBankAt = null;
          this.doBank(i);
        }
      }
      if (r.phase === "call") {
        while (s.botTaps.length > 0 && r.t >= s.botTaps[0]!.atMs) {
          const t = s.botTaps.shift()!;
          this.press(i, t.half);
        }
      } else if (r.phase !== "gap") {
        s.botTaps = [];
      }
    }
  }

  private knockout(i: number, by: number | null): void {
    const s = this.seats[i]!;
    s.knockouts += 1;
    s.outFlash = 1;
    s.hitLabel = "";
    s.hitLabelT = 0;
    this.juice.shake(0.3);
    this.juice.hitStop(0.06);
    this.juice.burst(s.x + s.w / 2, this.ctx.height * 0.6, ["#9aa3b2", "#5b6373", by === null ? "#9aa3b2" : PINK], { count: 18, speed: 280, size: 5 });
    this.ctx.sfx.miss();
    this.ctx.sfx.hit();
  }

  private label(i: number, text: string, color: string, life: number): void {
    const s = this.seats[i]!;
    s.hitLabel = text;
    s.hitLabelColor = color;
    s.hitLabelT = life;
  }

  private press(i: number, half: Half): void {
    if (this.phase !== "round") return;
    const seat = this.seats[i]!;
    const res = tap(this.round, i, half);
    const h = this.ctx.height;
    const hx = seat.x + (half === "left" ? seat.w * 0.25 : seat.w * 0.75);
    if (half === "left") seat.flashLeft = 1; else seat.flashRight = 1;
    const sideColor = this.halfColor(half);
    if (res === "hit" || res === "pending") {
      this.juice.burst(hx, h * 0.62, [sideColor, "#ffffff"], { count: 10, speed: 220, size: 4, gravity: 300 });
      if (res === "hit") {
        const ms = this.round.seats[i]!.hitMs ?? 0;
        if (seat.best === null || ms < seat.best) seat.best = ms;
        if (ms <= FLASH_MS) {
          this.label(i, `FLASH! ${ms} ms`, HOT, 1.2);
          this.juice.burst(seat.x + seat.w / 2, h * 0.5, [HOT, "#ffffff"], { count: 16, speed: 300, size: 4 });
        } else {
          this.label(i, `${ms} ms`, "#F4F7FB", 1.2);
        }
        if (seat.player.kind === "human" && saveBest(flagFlash.id, RECORD_BASE - ms, RECORD_KEY) && !this.recordShown) {
          this.recordShown = true;
          this.callouts.show(`NEW RECORD: ${ms} ms`, GOLD, { size: 56, life: 1.6, y: 0.3 });
          this.ctx.sfx.win();
        }
        this.ctx.sfx.collect();
      } else {
        this.ctx.sfx.tick();
      }
    } else if (res === "late") {
      this.label(i, "SO CLOSE!", PINK, 1.0);
      this.ctx.sfx.miss();
    } else if (res === "saved") {
      // The shield event already did the fireworks.
    }
    // Knockouts arrive as events on the next advance.
  }

  private doHeckle(i: number): void {
    if (this.phase !== "round") return;
    const res = heckle(this.round, i);
    const s = this.seats[i]!;
    if (res === "armed") {
      this.label(i, s.player.kind === "bot" ? "HEH HEH..." : "ARMED!", NONE_COLOR, 1.0);
      this.ctx.sfx.select();
    } else if (res === "cooling") {
      this.ctx.sfx.tick();
    }
  }

  private doBank(i: number): void {
    if (this.phase !== "round") return;
    const before = this.round.showdown?.pot ?? 0;
    if (bank(this.round, i) === "banked") {
      const s = this.seats[i]!;
      this.juice.burst(s.x + s.w / 2, this.ctx.height * 0.5, [GOLD, "#ffffff", s.player.color], { count: 40, speed: 420, size: 6 });
      this.callouts.show(`BANKED +${before}`, GOLD, { size: 64, life: 1.5, y: 0.3 });
      this.ctx.sfx.win();
      for (const ev of advanceRound(this.round, 0, this.ctx.rng)) this.onEvent(ev);
    }
  }

  private endHeat(): void {
    if (this.phase !== "round") return;
    const r = this.round;
    if (r.winner !== null) {
      const seat = this.seats[r.winner]!;
      this.resultText = `${seat.player.name} banks the pot!`;
      this.resultColor = seat.player.color;
      this.juice.shake(0.35);
    } else if (r.showdown) {
      const seat = this.seats[r.showdown.seat]!;
      this.resultText = `${seat.player.name} got greedy. Pot lost!`;
      this.resultColor = PINK;
    } else if (r.callIndex >= MAX_CALLS && r.seats.some((x) => x.alive)) {
      this.resultText = "Stalemate. Survivors share.";
      this.resultColor = NONE_COLOR;
    } else {
      this.resultText = "Everyone fumbled!";
      this.resultColor = PINK;
    }
    for (const s of this.seats) {
      s.botTaps = [];
      s.botHeckleAt = null;
      s.botBankAt = null;
    }
    if (r.cfg.overdrive) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...this.seats.map((s) => s.score));
      const leaders = this.seats.filter((s) => s.score === top);
      this.resultText = leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.resultColor = leaders.length === 1 ? leaders[0]!.player.color : "#F4F7FB";
      for (const s of leaders) {
        this.juice.burst(s.x + s.w / 2, this.ctx.height * 0.5, [s.player.color, "#ffffff", RED, BLUE], { count: 40, speed: 420, size: 6 });
      }
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
    }
  }

  private stepFx(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 3);
    for (const s of this.seats) {
      s.flashLeft = Math.max(0, s.flashLeft - dt * 5);
      s.flashRight = Math.max(0, s.flashRight - dt * 5);
      s.outFlash = Math.max(0, s.outFlash - dt * 2);
      s.shieldPop = Math.max(0, s.shieldPop - dt * 1.5);
      s.hitLabelT = Math.max(0, s.hitLabelT - dt);
      s.scorePopT = Math.max(0, s.scorePopT - dt * 1.1);
      s.hotGlow = Math.max(0, s.hotGlow - dt * 1.5);
    }
    const target = this.round.swapped ? 1 : 0;
    const k = Math.min(1, dt * (1000 / SWAP_MS) * 1.6);
    this.swapAnim += (target - this.swapAnim) * k;
  }

  private animateArms(dt: number): void {
    const r = this.round;
    let red = 0;
    let blue = 0;
    if (r.phase === "call" || r.phase === "resolve") {
      red = r.call === "RED" || r.call === "BOTH" ? 1 : 0;
      blue = r.call === "BLUE" || r.call === "BOTH" ? 1 : 0;
    } else if (r.phase === "feint") {
      const tw = 0.28 * Math.sin(Math.min(1, r.t / FEINT_MS) * Math.PI);
      if (r.feintFlag === "RED") red = tw; else blue = tw;
    }
    const k = Math.min(1, dt * 16);
    this.armRed += (red - this.armRed) * k;
    this.armBlue += (blue - this.armBlue) * k;
  }

  // Input.

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private inRect(p: { x: number; y: number }, r: Rect): boolean {
    return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  }

  private feintButton(s: Seat): Rect {
    const h = this.ctx.height;
    const w = Math.min(250, s.w - 36);
    const bh = Math.max(this.ctx.minTap, 96);
    return { x: s.x + s.w / 2 - w / 2, y: h * FEINT_Y - bh / 2, w, h: bh };
  }

  private bankButton(s: Seat): Rect {
    const h = this.ctx.height;
    const w = Math.min(220, s.w - 36);
    const bh = Math.max(this.ctx.minTap, 64);
    return { x: s.x + s.w / 2 - w / 2, y: h * BANK_Y - bh / 2, w, h: bh };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    if (p.y < this.ctx.height * BAND) return;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (p.x < s.x || p.x >= s.x + s.w) continue;
      if (s.player.kind !== "human") return;
      e.preventDefault();
      const r = this.round;
      const st = r.seats[i];
      if (this.phase !== "round" || !st) return;
      if (!st.alive) {
        if (this.inRect(p, this.feintButton(s))) this.doHeckle(i);
        return;
      }
      if (r.showdown && r.showdown.seat === i && this.inRect(p, this.bankButton(s))) {
        this.doBank(i);
        return;
      }
      this.press(i, p.x < s.x + s.w / 2 ? "left" : "right");
      return;
    }
  };

  // Rendering.

  private halfColor(half: Half): string {
    const redOnLeft = this.swapAnim < 0.5;
    return (half === "left") === redOnLeft ? RED : BLUE;
  }

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    const r = this.round;
    if (r.cfg.overdrive && this.phase !== "intro") {
      const pulse = 0.08 + 0.05 * Math.sin(this.time * 6);
      g.fillStyle = `rgba(255,61,122,${pulse})`;
      g.fillRect(0, 0, width, height * BAND);
    }
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawSeat(g, i);
    this.drawCaller(g);
    this.juice.end(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(${this.flashColor},${this.flash * 0.25})`;
      g.fillRect(0, 0, width, height);
    }
    if (this.phase === "round" && r.phase === "call") drawTimerBar(g, width, Math.max(0, r.windowMs - r.t), r.windowMs);
    this.drawHud(g);
    this.drawCenter(g);
    this.callouts.draw(g, width, height);
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const r = this.round;
    g.save();
    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = `700 26px ${FONT}`;
    g.fillStyle = r.cfg.overdrive ? PINK : "rgba(244,247,251,0.6)";
    g.fillText(r.cfg.overdrive ? "FINAL HEAT  ·  OVERDRIVE  ·  x2" : `HEAT ${this.heat + 1}`, 40, 36);
    if (r.showdown && this.phase === "round") {
      g.textAlign = "right";
      g.fillStyle = GOLD;
      g.fillText(`SHOWDOWN  ·  POT ${r.showdown.pot}  ·  ${SHOWDOWN_CALLS - r.showdown.calls} CALLS LEFT`, this.ctx.width - 40, 36);
    }
    g.restore();
  }

  private drawSeat(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const top = h * BAND;
    const r = this.round;
    const st = r.seats[i]!;
    const out = !st.alive && this.phase !== "intro";
    const survivor = r.showdown !== null && r.showdown.seat === i && st.alive;
    const cx = s.x + s.w / 2;
    const half = s.w / 2;
    const redX = s.x + this.swapAnim * half;
    const blueX = s.x + (1 - this.swapAnim) * half;
    const leftFlash = this.swapAnim < 0.5 ? s.flashLeft : s.flashRight;
    const rightFlash = this.swapAnim < 0.5 ? s.flashRight : s.flashLeft;

    g.save();
    // Red and blue halves (they slide across each other on a swap).
    g.globalAlpha = out ? 0.06 : 0.16 + rightFlash * 0.4;
    g.fillStyle = BLUE;
    g.fillRect(blueX, top, half, h - top);
    g.globalAlpha = out ? 0.06 : 0.16 + leftFlash * 0.4;
    g.fillStyle = RED;
    g.fillRect(redX, top, half, h - top);
    g.globalAlpha = 1;
    if (survivor) {
      g.globalAlpha = 0.12 + 0.06 * Math.sin(this.time * 5);
      g.fillStyle = GOLD;
      g.fillRect(s.x, top, s.w, h - top);
      g.globalAlpha = 1;
    }
    if (s.hotGlow > 0 || st.streak >= HOT_STREAK) {
      g.globalAlpha = 0.03 + s.hotGlow * 0.1;
      g.fillStyle = HOT;
      g.fillRect(s.x, top, s.w, h - top);
      g.globalAlpha = 1;
    }
    // Seat separator and half divider.
    g.strokeStyle = "rgba(244,247,251,0.18)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(s.x + s.w, 0);
    g.lineTo(s.x + s.w, h);
    g.stroke();
    g.strokeStyle = "rgba(7,11,20,0.5)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx, h);
    g.stroke();
    // Colored header strip for the seat.
    g.fillStyle = s.player.color;
    g.globalAlpha = out ? 0.25 : 0.9;
    g.fillRect(s.x, top, s.w, 6);
    g.globalAlpha = 1;

    // Half labels (hidden for the showdown survivor, whose BANK button lives there, and for hecklers).
    if (!survivor && !out) {
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.min(64, half * 0.5)}px ${FONT}`;
      g.globalAlpha = 0.35;
      g.fillStyle = RED;
      g.fillText("RED", redX + half / 2, h * 0.9);
      g.fillStyle = BLUE;
      g.fillText("BLUE", blueX + half / 2, h * 0.9);
      g.globalAlpha = 1;
    }

    // Name, score and streak meter.
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = out ? "#8d94a0" : s.player.color;
    g.font = `700 ${Math.min(28, s.w * 0.11)}px ${FONT}`;
    g.fillText(s.player.name, cx, top + 10);
    if (st.shield || s.shieldPop > 0) {
      g.strokeStyle = GOLD;
      g.lineWidth = 3;
      g.globalAlpha = st.shield ? 0.9 : s.shieldPop;
      g.beginPath();
      g.arc(cx, top + 58, 33 + (1 - (st.shield ? 1 : s.shieldPop)) * 20, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.fillStyle = out ? "#aab1bd" : "#F4F7FB";
    g.font = `700 46px ${FONT}`;
    g.fillText(String(s.score), cx, top + 36);
    if (s.scorePopT > 0) {
      const t = 1 - s.scorePopT;
      g.globalAlpha = Math.min(1, s.scorePopT * 2);
      g.fillStyle = s.scorePopColor;
      g.font = `700 ${36 + t * 10}px ${FONT}`;
      g.fillText(s.scorePop, cx + Math.min(70, s.w * 0.28), top + 34 - t * 30);
      g.globalAlpha = 1;
    }
    // Streak pips.
    const hot = st.streak >= HOT_STREAK;
    if (!out) {
      for (let k = 0; k < HOT_STREAK; k++) {
        g.beginPath();
        g.arc(cx + (k - (HOT_STREAK - 1) / 2) * 26, top + 102, 7, 0, Math.PI * 2);
        g.fillStyle = k < st.streak && st.alive ? HOT : "rgba(244,247,251,0.15)";
        g.fill();
      }
      if (hot && st.alive) {
        g.fillStyle = HOT;
        g.font = `700 22px ${FONT}`;
        g.fillText(`HOT x${st.streak}`, cx, top + 114);
      }
    }

    g.textBaseline = "middle";
    if (out) {
      this.drawHeckler(g, i);
    } else {
      if (s.hitLabelT > 0 && s.hitLabel) {
        g.globalAlpha = Math.min(1, s.hitLabelT * 2);
        this.labelText(g, s.hitLabel, cx, h * LABEL_Y, Math.min(44, s.w * 0.16), s.hitLabelColor);
        g.globalAlpha = 1;
      } else if (s.player.kind === "human" && this.phase === "round" && !survivor) {
        g.fillStyle = "rgba(244,247,251,0.35)";
        g.font = `700 22px ${FONT}`;
        g.fillText("TAP THE CALLED COLOUR", cx, h * LABEL_Y);
      }
      if (survivor) this.drawBank(g, s);
    }
    g.restore();
  }

  private drawHeckler(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const st = this.round.seats[i]!;
    const h = this.ctx.height;
    const top = h * BAND;
    const cx = s.x + s.w / 2;
    const half = s.w / 2;
    g.fillStyle = `rgba(60,66,80,${0.5 + s.outFlash * 0.2})`;
    g.fillRect(s.x, top, s.w, h - top);
    // OUT pop and why.
    const pop = 1 + s.outFlash * 0.35;
    const reason = st.outReason === "jumped" ? "JUMPED!" : st.outReason === "wrong" ? "WRONG!" : st.outReason === "slow" ? "TOO SLOW!" : "DON'T TAP!";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(244,247,251,0.55)";
    g.font = `700 20px ${FONT}`;
    g.fillText("OUT", cx, h * (OUT_Y - 0.052));
    g.save();
    g.translate(cx, h * OUT_Y);
    g.scale(pop, pop);
    this.labelText(g, reason, 0, 0, Math.min(46, half * 0.4), "#F4F7FB");
    g.restore();
    // FEINT! button with cooldown fill.
    const b = this.feintButton(s);
    const ready = st.heckleCooldown <= 0 && !st.heckleArmed && this.phase === "round";
    const cool = 1 - Math.min(1, st.heckleCooldown / HECKLE_COOLDOWN_MS);
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(b.x, b.y, b.w, b.h);
    g.fillStyle = st.heckleArmed ? PINK : ready ? "rgba(255,61,122,0.85)" : "rgba(255,61,122,0.3)";
    g.fillRect(b.x, b.y, b.w * (st.heckleArmed ? 1 : cool), b.h);
    g.strokeStyle = st.heckleArmed ? "#ffffff" : "rgba(244,247,251,0.6)";
    g.lineWidth = 3;
    g.strokeRect(b.x, b.y, b.w, b.h);
    g.fillStyle = "#F4F7FB";
    g.font = `700 ${Math.min(44, b.w * 0.2)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const wobble = st.heckleArmed ? Math.sin(this.time * 20) * 2 : 0;
    g.fillText(st.heckleArmed ? "ARMED" : ready ? "FEINT!" : "RELOADING", cx + wobble, b.y + b.h / 2 - 10);
    g.font = `700 ${Math.min(20, b.w * 0.1)}px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.75)";
    g.fillText(st.heckleArmed ? "the caller twitches next gap" : "fake a flag · +2 if they bite", cx, b.y + b.h / 2 + 24);
    if (s.hitLabelT > 0 && s.hitLabel) {
      g.globalAlpha = Math.min(1, s.hitLabelT * 2);
      this.labelText(g, s.hitLabel, cx, h * 0.88, Math.min(40, s.w * 0.15), s.hitLabelColor);
      g.globalAlpha = 1;
    } else {
      g.fillStyle = "rgba(244,247,251,0.45)";
      g.font = `700 22px ${FONT}`;
      g.fillText(`HECKLER  ·  ${st.bites} ${st.bites === 1 ? "BITE" : "BITES"}`, cx, h * 0.88);
    }
  }

  /** Centered label on a dark pill: cheaper than stroked text and just as readable over the halves. */
  private labelText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const w = g.measureText(text).width + size * 0.6;
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(x - w / 2, y - size * 0.55, w, size * 1.1);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  private drawBank(g: CanvasRenderingContext2D, s: Seat): void {
    const sd = this.round.showdown;
    if (!sd) return;
    const b = this.bankButton(s);
    const open = this.round.phase !== "resolve" && this.phase === "round";
    const pulse = 1 + 0.03 * Math.sin(this.time * 8);
    g.save();
    g.translate(b.x + b.w / 2, b.y + b.h / 2);
    g.scale(pulse, pulse);
    g.fillStyle = open ? GOLD : "rgba(255,216,74,0.4)";
    g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    g.fillStyle = "#1b1400";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.min(40, b.w * 0.2)}px ${FONT}`;
    g.fillText(`BANK +${sd.pot}`, 0, -6);
    g.font = `700 16px ${FONT}`;
    g.fillText(s.player.kind === "human" ? "tap to cash out · fall and it's gone" : "thinking about it...", 0, 20);
    g.restore();
  }

  private drawCaller(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const groundY = height * BAND - 8;
    const sc = Math.min(1, height / 720) * 0.95;
    const bob = Math.sin(this.time * 2.2) * 3;
    const r = this.round;
    g.save();
    g.translate(width / 2, groundY);
    g.scale(sc, sc);
    // Stage.
    g.fillStyle = r.cfg.overdrive ? "rgba(255,61,122,0.25)" : "rgba(244,247,251,0.08)";
    g.fillRect(-140, -6, 280, 12);
    // The caller spins round on a swap, so the flags change hands.
    const spin = this.swapAnim;
    const faceX = Math.cos(spin * Math.PI);
    g.scale(Math.max(0.08, Math.abs(faceX)) * (faceX < 0 ? -1 : 1), 1);
    g.translate(0, bob);
    // Robe.
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.moveTo(-34, -150);
    g.lineTo(34, -150);
    g.lineTo(52, -6);
    g.lineTo(-52, -6);
    g.closePath();
    g.fill();
    g.fillStyle = r.cfg.overdrive ? PINK : "#1b2740";
    g.fillRect(-52, -40, 104, 10);
    // Head.
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.arc(0, -180, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1b2740";
    g.beginPath();
    g.arc(-11, -186, 4, 0, Math.PI * 2);
    g.arc(11, -186, 4, 0, Math.PI * 2);
    g.fill();
    const shout = this.phase === "round" && (r.phase === "call" || r.phase === "resolve");
    const grin = this.phase === "round" && r.phase === "feint";
    g.beginPath();
    if (shout) g.arc(0, -168, 8, 0, Math.PI * 2);
    else if (grin) g.arc(0, -174, 9, 0.2, Math.PI - 0.2);
    else g.rect(-7, -170, 14, 3);
    g.fill();
    // Arms with flags: red in the left hand, blue in the right.
    this.drawArm(g, -1, this.armRed, RED);
    this.drawArm(g, 1, this.armBlue, BLUE);
    g.restore();
  }

  /** side -1 = left arm (red), 1 = right arm (blue). raise 0 = down, 1 = straight up. */
  private drawArm(g: CanvasRenderingContext2D, side: number, raise: number, color: string): void {
    const sx = side * 34;
    const sy = -140;
    const a = 0.35 + raise * 2.5; // angle from straight down, rotating outward
    const dx = side * Math.sin(a);
    const dy = Math.cos(a);
    const hx = sx + dx * 70;
    const hy = sy + dy * 70;
    g.strokeStyle = "#F4F7FB";
    g.lineWidth = 14;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(hx, hy);
    g.stroke();
    // Pole continues past the hand.
    const px = hx + dx * 95;
    const py = hy + dy * 95;
    g.strokeStyle = "#c9ced6";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(hx - dx * 20, hy - dy * 20);
    g.lineTo(px, py);
    g.stroke();
    // Pennant waving outward from the pole top.
    const ox = side * Math.abs(dy) + dx * 0.2;
    const oy = -Math.abs(dx) * 0.6 + dy * 0.2;
    const wave = Math.sin(this.time * 9 + side) * 6;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + ox * 70 + wave, py + oy * 70 - 10);
    g.lineTo(px - dx * 46, py - dy * 46);
    g.closePath();
    g.fill();
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const r = this.round;
    let text = "";
    let color = "#F4F7FB";
    let size = 64;
    if (this.phase === "intro") {
      text = r.cfg.overdrive ? "OVERDRIVE" : `HEAT ${this.heat + 1}`;
      color = r.cfg.overdrive ? PINK : "#F4F7FB";
      size = 72;
    } else if (this.phase === "round") {
      if (r.phase === "call" || r.phase === "resolve") {
        text = `${r.call}!`;
        color = r.call === "RED" ? RED : r.call === "BLUE" ? BLUE : r.call === "BOTH" ? BOTH_COLOR : NONE_COLOR;
        size = 120;
      } else if (r.phase === "swap") {
        text = "sides swap!";
        color = "rgba(244,247,251,0.7)";
        size = 44;
      } else {
        text = "watch the flags...";
        color = "rgba(244,247,251,0.45)";
        size = 40;
      }
    } else if (this.phase === "result") {
      text = this.resultText;
      color = this.resultColor;
      size = 56;
    } else if (this.phase === "final") {
      text = this.resultText;
      color = this.resultColor;
      size = 76;
    }
    if (!text) return;
    g.save();
    const y = height * CENTER_Y;
    if (this.phase !== "round") {
      // A dark band keeps announcements legible over the booths and buttons.
      g.fillStyle = "rgba(7,11,20,0.72)";
      g.fillRect(0, y - size * 0.75, width, size * 1.5);
    }
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    g.strokeText(text, width / 2, y);
    g.fillStyle = color;
    g.fillText(text, width / 2, y);
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Fastest response", value: s.best === null ? "-" : `${s.best} ms` });
      out.push({ playerId: s.player.id, label: "Pots banked", value: String(s.banked) });
      out.push({ playerId: s.player.id, label: "Heckle bites", value: String(s.bites) });
    }
    const best = loadBest(flagFlash.id, RECORD_KEY);
    const human = this.seats.find((s) => s.player.kind === "human");
    if (best > 0 && human) out.push({ playerId: human.player.id, label: "Record response", value: `${RECORD_BASE - best} ms` });
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
