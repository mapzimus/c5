import { fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  AGAIN_MS, blowUp, BOMBS, botJinxChance, bounty, canJinx, FUSE_MS, isFinalBomb, matchOver, newMatch,
  planBotAgain, planBotPress, press, PLUNGERS, randomPlunger, scores, stop, SURVIVE_BONUS, tension, TURN_MS,
  underdogs, unpressed, useJinx, FINAL_MULT, type BotPlan, type MatchState,
} from "./logic";

export const bigBlast: GameDefinition = {
  id: "big-blast",
  name: "Big Blast",
  tagline: "Press again, bank it, or get JINXED.",
  description:
    "A giant bomb, five plungers, one of them live. Every dud you press pays a bounty that climbs " +
    "with the danger, but it only counts once the bomb goes off: get toasted and your stake burns. " +
    "After each dud choose: press AGAIN for more, or STOP and hand the hot seat on. Whoever got " +
    "toasted last holds a JINX that cancels one STOP. Four bombs, the last pays double. Most coins wins.",
  durationMs: 0,
  controls: "On your turn tap a plunger. After a dud: tap another, or STOP. Hold the JINX? Tap it when someone stops.",
  create: (ctx) => new BigBlast(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 1.4;
const STOP_S = 1.0;
const RESULT_S = 2.0;
const FINAL_S = 2.4;
const BEST_VERSION = "v2";
const GOLD = "#FFD84D";
const JINX = "#C084FC";
const DANGER = "#FF3D7A";
const BOOM_COLORS = ["#FFE14D", "#FFB020", "#FF5A1F", "#ffffff"] as const;
const GUTS_TAUNTS = ["GUTS!", "NO FEAR", "WATCH THIS", "EASY MONEY", "ONE MORE"] as const;
const STOP_TAUNTS = ["YOUR PROBLEM NOW", "I'M GOOD", "ENJOY!", "NOPE"] as const;

type Phase = "intro" | "turn" | "stopping" | "fuse" | "boom" | "final";

interface Seat {
  player: Player;
  index: number;
  /** Bot greed, 0 timid .. 1 reckless. */
  nerve: number;
}

interface Plunger {
  x: number;
  y: number;
  wobble: number;
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

interface Box { x: number; y: number; w: number; h: number }

class BigBlast implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private match: MatchState;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private turnT = 0;
  private time = 0;
  private finished = false;
  private plungers: Plunger[] = [];
  private floaters: Floater[] = [];
  private botPlan: BotPlan | null = null;
  private botStopAt: number | null = null;
  private botTauntAt: number | null = null;
  private botJinxAt: number | null = null;
  private hoverDone = 0;
  private cursor = { x: 0, y: 0, tx: 0, ty: 0, press: 0, shown: false };
  private flash = 0;
  private swell = 0;
  private twitch = 0;
  private twitchT = 0;
  private hissT = 0;
  private sparkT = 0;
  private exploded = false;
  private victim: number | null = null;
  private stopper = 0;
  /** Jinxed: the current seat must press again and cannot stop. */
  private mustPress = false;
  private jinxFlash = 0;
  private taunt: { text: string; color: string; life: number } | null = null;
  private newBest = new Set<number>();
  private readonly s: number;
  private readonly bombX: number;
  private readonly bombY: number;
  private readonly bombR: number;
  private readonly slotW: number;
  private readonly rowY: number;
  private readonly stopBox: Box;
  private readonly jinxBox: Box;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.seats = ctx.players.map((player, index) => ({ player, index, nerve: ctx.rng.float(0.15, 0.95) }));
    this.match = newMatch(this.seats.length, ctx.rng);
    this.s = Math.min(1, ctx.height / 720);
    const s = this.s;
    this.bombX = ctx.width / 2;
    this.bombY = ctx.height * 0.37;
    this.bombR = 108 * s;
    this.slotW = Math.min(210 * s, ctx.width / 5.4);
    this.rowY = ctx.height * 0.82;
    const bw = Math.max(ctx.minTap * 3, 230 * s);
    const bh = Math.max(ctx.minTap * 1.5, 84 * s);
    this.stopBox = { x: ctx.width * 0.81 - bw / 2, y: this.bombY + 30 * s, w: bw, h: bh };
    this.jinxBox = { x: ctx.width * 0.81 - bw / 2, y: this.bombY + 30 * s, w: bw, h: bh };
    this.buildPlungers();
    this.cursor.x = this.cursor.tx = this.bombX;
    this.cursor.y = this.cursor.ty = this.rowY - 160 * s;
    this.showIntro();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private buildPlungers(): void {
    this.plungers = [];
    for (let i = 0; i < PLUNGERS; i++) {
      this.plungers.push({ x: this.bombX + (i - (PLUNGERS - 1) / 2) * this.slotW, y: this.rowY, wobble: 0 });
    }
  }

  private get active(): Seat {
    return this.seats[this.match.turn]!;
  }

  /** Seat the screen is framed for. */
  private get shown(): Seat {
    const i = this.phase === "stopping" ? this.stopper
      : this.phase === "boom" || this.phase === "fuse" ? (this.victim ?? this.match.turn)
      : this.match.turn;
    return this.seats[i]!;
  }

  private get jinxHolder(): Seat | null {
    const j = this.match.jinx;
    return j === null ? null : (this.seats[j] ?? null);
  }

  // ---- flow ----------------------------------------------------------------

  private showIntro(): void {
    const m = this.match;
    if (isFinalBomb(m)) {
      this.callouts.show("FINAL BOMB", DANGER, { size: 92, life: INTRO_S, y: 0.28 });
      this.callouts.show("DOUBLE STAKES!", GOLD, { size: 50, life: INTRO_S, y: 0.42 });
    } else {
      this.callouts.show(`BOMB ${m.round} OF ${BOMBS}`, "#F4F7FB", { size: 84, life: INTRO_S, y: 0.3 });
    }
    const holder = this.jinxHolder;
    if (holder) {
      this.callouts.show(`${holder.player.name.toUpperCase()} HOLDS THE JINX`, JINX, { size: 36, life: INTRO_S, y: 0.56 });
    }
  }

  private startTurn(): void {
    this.phase = "turn";
    this.turnT = 0;
    this.hoverDone = 0;
    this.botPlan = null;
    this.botStopAt = null;
    this.botTauntAt = null;
    this.mustPress = false;
    this.taunt = null;
    this.cursor.shown = false;
    this.cursor.press = 0;
    const seat = this.active;
    if (seat.player.kind === "bot") {
      this.botPlan = planBotPress(this.match.bomb, this.ctx.rng);
      this.cursor.shown = true;
      this.cursor.x = this.cursor.tx = this.bombX + (this.ctx.rng.next() - 0.5) * 200 * this.s;
      this.cursor.y = this.cursor.ty = this.rowY - 220 * this.s;
    }
    if (unpressed(this.match.bomb).length === 1) {
      this.callouts.show("NO ESCAPE!", DANGER, { size: 64, life: 1.1, y: 0.56 });
    }
    this.ctx.sfx.select();
  }

  private pressPlunger(plunger: number, forced = false): void {
    if (this.phase !== "turn") return;
    const seat = this.active;
    const open = unpressed(this.match.bomb).length;
    const pay = bounty(this.match, seat.index);
    const res = press(this.match, seat.index, plunger);
    if (res === "ignored") return;
    const p = this.plungers[plunger]!;
    this.cursor.press = 1;
    this.cursor.tx = p.x;
    this.cursor.ty = p.y - 110 * this.s;
    this.juice.burst(p.x, p.y - 70 * this.s, [seat.player.color, "#F4F7FB"], {
      count: 8, speed: 160, gravity: 500, size: 4, life: 0.4, angle: -Math.PI / 2, spread: 1.6,
    });
    if (forced) this.callouts.show("TIME'S UP!", DANGER, { size: 48, life: 0.9, y: 0.56 });

    if (res === "dud") {
      const chain = this.match.chain;
      this.juice.shake(0.1 + Math.min(0.2, chain * 0.05));
      this.ctx.sfx.streak(chain);
      this.sparkBurst(14, 260);
      this.floaters.push({
        x: p.x, y: p.y - 150 * this.s, text: `+${pay.total}`, color: GOLD, life: 1.1, maxLife: 1.1, size: 44 * this.s,
      });
      if (open === 2) this.callouts.show("SO CLOSE!", GOLD, { size: 60, life: 0.9, y: 0.56 });
      else if (chain >= 2) this.callouts.show(`CHAIN x${chain}`, seat.player.color, { size: 48, life: 0.8, y: 0.56 });
      this.turnT = 0;
      this.mustPress = false;
      this.botPlan = null;
      this.hoverDone = 0;
      if (seat.player.kind === "bot") this.planBotAfterDud(seat);
      else if (unpressed(this.match.bomb).length === 1) this.autoStop();
    } else {
      this.phase = "fuse";
      this.timer = FUSE_MS / 1000;
      this.swell = 0;
      this.hissT = 0;
      this.victim = seat.index;
      this.ctx.sfx.whoosh();
    }
  }

  /** A human who leaves exactly one plunger has nothing to decide: bank at once. */
  private autoStop(): void {
    this.doStop();
  }

  private planBotAfterDud(seat: Seat): void {
    const open = unpressed(this.match.bomb).length;
    const decide = planBotAgain(this.match, seat.index, seat.nerve, this.ctx.rng);
    if (decide.again) {
      const plan = planBotPress(this.match.bomb, this.ctx.rng, 0.35);
      plan.atMs += decide.atMs;
      for (const h of plan.hovers) h.atMs += decide.atMs;
      this.botPlan = plan;
      if (open <= 3) this.botTauntAt = decide.atMs;
    } else {
      this.botStopAt = decide.atMs;
      if (open <= 2) this.botTauntAt = decide.atMs - 150;
    }
  }

  private doStop(): void {
    if (this.phase !== "turn" || this.match.chain === 0 || this.mustPress) return;
    const seat = this.active;
    this.stopper = seat.index;
    this.phase = "stopping";
    this.timer = STOP_S;
    this.botJinxAt = null;
    this.cursor.shown = false;
    this.ctx.sfx.collect();
    this.callouts.show(`${seat.player.name.toUpperCase()} STOPS`, seat.player.color, { size: 50, life: STOP_S, y: 0.56 });
    const holder = this.jinxHolder;
    if (holder && holder.player.kind === "bot" && canJinx(this.match, holder.index, seat.index)) {
      if (this.ctx.rng.next() < botJinxChance(this.match, seat.index)) {
        this.botJinxAt = this.ctx.rng.float(0.25, 0.65);
      }
    }
  }

  private finishStop(): void {
    stop(this.match, this.stopper);
    this.startTurn();
  }

  private castJinx(holder: Seat): void {
    if (this.phase !== "stopping") return;
    if (!useJinx(this.match, holder.index, this.stopper)) return;
    const seat = this.seats[this.stopper]!;
    this.phase = "turn";
    this.turnT = 0;
    this.mustPress = true;
    this.botPlan = null;
    this.botStopAt = null;
    this.botTauntAt = null;
    this.hoverDone = 0;
    this.jinxFlash = 1;
    this.juice.shake(0.35);
    this.juice.hitStop(0.08);
    this.ctx.sfx.miss();
    this.ctx.sfx.whoosh();
    this.juice.burst(this.bombX, this.bombY, [JINX, "#ffffff"], { count: 40, speed: 500, gravity: 200, size: 7, life: 0.8 });
    this.callouts.show("JINXED!", JINX, { size: 110, life: 1.0, y: 0.36 });
    this.callouts.show(`${holder.player.name.toUpperCase()}: PRESS AGAIN, ${seat.player.name.toUpperCase()}!`, JINX, {
      size: 40, life: 1.3, y: 0.56,
    });
    if (seat.player.kind === "bot") {
      const plan = planBotPress(this.match.bomb, this.ctx.rng, 0.3);
      plan.atMs += 700;
      for (const h of plan.hovers) h.atMs += 700;
      this.botPlan = plan;
      this.cursor.shown = true;
    }
  }

  private detonate(): void {
    const seat = this.seats[this.victim ?? this.match.turn]!;
    const m = this.match;
    const burned = m.stake[seat.index] ?? 0;
    this.phase = "boom";
    this.timer = RESULT_S;
    this.exploded = true;
    this.flash = 1;
    this.swell = 0;
    this.juice.shake(1);
    this.juice.hitStop(0.14);
    this.juice.burst(this.bombX, this.bombY, BOOM_COLORS, { count: 90, speed: 900, gravity: 300, size: 10, life: 1.1 });
    this.juice.burst(this.bombX, this.bombY, [seat.player.color, "#ffffff"], { count: 40, speed: 700, gravity: 500, size: 7, life: 1 });
    this.juice.burst(this.bombX, this.bombY, ["#1b1f2a", "#3a3f4b", "#5a5f6b"], { count: 50, speed: 300, gravity: -120, size: 18, life: 1.6 });
    for (const p of this.plungers) p.wobble = 1;
    this.ctx.sfx.hit();
    this.ctx.sfx.whoosh();
    this.ctx.sfx.hit();
    this.callouts.show("KABOOM!", "#FFB020", { size: 150, life: 1.1, y: 0.38 });
    this.callouts.show(`${seat.player.name.toUpperCase()} IS TOAST!`, seat.player.color, { size: 60, life: RESULT_S, y: 0.58 });
    if (burned > 0) {
      this.callouts.show(`STAKE BURNED  -${burned}`, DANGER, { size: 40, life: RESULT_S, y: 0.68 });
    }
    const bonus = SURVIVE_BONUS * (isFinalBomb(m) ? FINAL_MULT : 1);
    for (const other of this.seats) {
      if (other.index === seat.index) continue;
      const gain = (m.stake[other.index] ?? 0) + bonus;
      const pos = this.orbPos(other.index);
      this.floaters.push({ x: pos.x, y: pos.y + 40 * this.s, text: `+${gain}`, color: GOLD, life: 1.6, maxLife: 1.6, size: 34 * this.s });
    }
    blowUp(m, seat.index, this.ctx.rng);
  }

  private afterBoom(): void {
    if (matchOver(this.match)) {
      this.phase = "final";
      this.timer = FINAL_S + RESULT_S;
      const sc = scores(this.match);
      const top = Math.max(...sc);
      const winners = this.seats.filter((seat) => sc[seat.index] === top);
      const winner = winners.length === 1 ? winners[0]! : null;
      this.callouts.show(winner ? `${winner.player.name.toUpperCase()} WINS!` : "IT'S A TIE!", winner?.player.color ?? "#F4F7FB", {
        size: 84, life: FINAL_S + RESULT_S, y: 0.3,
      });
      this.callouts.show(`${top} COINS`, GOLD, { size: 48, life: FINAL_S + RESULT_S, y: 0.44 });
      for (const seat of this.seats) {
        if (seat.player.kind !== "human") continue;
        const coins = sc[seat.index] ?? 0;
        if (coins > 0 && saveBest(bigBlast.id, coins, BEST_VERSION)) {
          this.newBest.add(seat.index);
          this.callouts.show(`NEW RECORD ${seat.player.name.toUpperCase()}: ${coins}`, "#B8FF3D", { size: 40, life: FINAL_S + RESULT_S, y: 0.58 });
        }
      }
      this.ctx.sfx.win();
      return;
    }
    this.exploded = false;
    this.victim = null;
    this.buildPlungers();
    this.phase = "intro";
    this.timer = INTRO_S;
    this.showIntro();
    this.ctx.sfx.countdown();
  }

  // ---- update --------------------------------------------------------------

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.stepProps(realDt);
    if (this.finished) return;

    switch (this.phase) {
      case "intro":
        this.timer -= dt;
        if (this.timer <= 0) this.startTurn();
        return;
      case "turn":
        this.stepTurn(dt);
        return;
      case "stopping":
        this.timer -= dt;
        if (this.botJinxAt !== null && STOP_S - this.timer >= this.botJinxAt) {
          this.botJinxAt = null;
          const holder = this.jinxHolder;
          if (holder) this.castJinx(holder);
          return;
        }
        if (this.timer <= 0) this.finishStop();
        return;
      case "fuse":
        this.timer -= dt;
        this.swell = 1 - Math.max(0, this.timer) / (FUSE_MS / 1000);
        this.hissT += dt;
        if (this.hissT >= 0.07) {
          this.hissT = 0;
          this.ctx.sfx.tick();
          this.sparkBurst(6, 320);
        }
        this.juice.shake(dt * 1.2);
        if (this.timer <= 0) this.detonate();
        return;
      case "boom":
        this.timer -= dt;
        if (this.timer <= 0) this.afterBoom();
        return;
      case "final":
        this.timer -= dt;
        if (this.timer <= 0) this.finished = true;
        return;
    }
  }

  private get turnLimit(): number {
    return this.match.chain > 0 && !this.mustPress ? AGAIN_MS : TURN_MS;
  }

  private stepTurn(dt: number): void {
    this.turnT += dt * 1000;
    const seat = this.active;
    if (this.botTauntAt !== null && this.turnT >= this.botTauntAt) {
      this.botTauntAt = null;
      const pool = this.botStopAt !== null ? STOP_TAUNTS : GUTS_TAUNTS;
      this.taunt = { text: `"${this.ctx.rng.pick(pool)}"`, color: seat.player.color, life: 1.6 };
    }
    if (this.botStopAt !== null && this.turnT >= this.botStopAt) {
      this.botStopAt = null;
      this.doStop();
      return;
    }
    const plan = this.botPlan;
    if (plan) {
      this.cursor.shown = true;
      while (this.hoverDone < plan.hovers.length && this.turnT >= plan.hovers[this.hoverDone]!.atMs) {
        const h = plan.hovers[this.hoverDone]!;
        this.hoverDone += 1;
        const p = this.plungers[h.plunger]!;
        this.cursor.tx = p.x + (this.ctx.rng.next() - 0.5) * 20;
        this.cursor.ty = p.y - 130 * this.s;
        p.wobble = 1;
        this.ctx.sfx.tick();
      }
      if (this.turnT >= plan.atMs) {
        this.pressPlunger(plan.target);
        return;
      }
      if (this.hoverDone === plan.hovers.length && this.turnT >= plan.atMs - 260) {
        const p = this.plungers[plan.target]!;
        this.cursor.tx = p.x;
        this.cursor.ty = p.y - 130 * this.s;
      }
    }
    if (this.turnT >= this.turnLimit) {
      if (this.match.chain > 0 && !this.mustPress) this.doStop();
      else this.pressPlunger(randomPlunger(this.match.bomb, this.ctx.rng), true);
    }
  }

  private stepProps(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.jinxFlash = Math.max(0, this.jinxFlash - dt * 1.6);
    const c = this.cursor;
    const k = Math.min(1, dt * 9);
    c.x += (c.tx - c.x) * k;
    c.y += (c.ty - c.y) * k;
    c.press = Math.max(0, c.press - dt * 3);
    for (const p of this.plungers) p.wobble = Math.max(0, p.wobble - dt * 2.5);
    for (const f of this.floaters) { f.life -= dt; f.y -= 40 * this.s * dt; }
    if (this.taunt) { this.taunt.life -= dt; if (this.taunt.life <= 0) this.taunt = null; }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    // Nervous bomb: twitches and sparks more the fewer plungers remain.
    const t = this.exploded ? 0 : tension(this.match.bomb);
    this.twitch = Math.max(0, this.twitch - dt * 6);
    if (!this.exploded && (this.phase === "turn" || this.phase === "stopping")) {
      this.twitchT += dt;
      if (this.twitchT >= 1.4 - t * 1.0) {
        this.twitchT = 0;
        this.twitch = 0.5 + t * 0.8;
        if (t > 0.5) this.ctx.sfx.tick();
      }
      this.sparkT += dt;
      const gap = 1 / (3 + t * 28);
      if (this.sparkT >= gap) {
        this.sparkT = 0;
        this.sparkBurst(1 + Math.round(t * 3), 120 + t * 160);
      }
    }
  }

  private fuseTip(): { x: number; y: number } {
    const r = this.bombR * (1 + this.swell * 0.35);
    return { x: this.bombX + r * 0.25, y: this.bombY - r - 48 * this.s };
  }

  private sparkBurst(count: number, speed: number): void {
    const tip = this.fuseTip();
    this.juice.burst(tip.x, tip.y, ["#FFE14D", "#FFB020", "#ffffff"], {
      count, speed, gravity: 350, size: 4, life: 0.4,
    });
  }

  // ---- input ---------------------------------------------------------------

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    if (this.phase === "stopping") {
      const holder = this.jinxHolder;
      if (holder && holder.player.kind === "human" && canJinx(this.match, holder.index, this.stopper) && inBox(p, this.jinxBox, this.ctx.minTap)) {
        e.preventDefault();
        this.castJinx(holder);
      }
      return;
    }
    if (this.phase !== "turn" || this.active.player.kind !== "human") return;
    if (this.match.chain > 0 && !this.mustPress && inBox(p, this.stopBox, this.ctx.minTap)) {
      e.preventDefault();
      this.doStop();
      return;
    }
    const halfW = Math.max(this.ctx.minTap, this.slotW) / 2;
    const top = this.rowY - Math.max(this.ctx.minTap, 150 * this.s);
    const bottom = this.rowY + 60 * this.s;
    if (p.y < top || p.y > bottom) return;
    for (let i = 0; i < this.plungers.length; i++) {
      const pl = this.plungers[i]!;
      if (this.match.bomb.pressed[i] || Math.abs(p.x - pl.x) > halfW) continue;
      e.preventDefault();
      this.pressPlunger(i);
      return;
    }
  };

  // ---- render --------------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.drawFloor(g);
    this.juice.begin(g);
    if (this.exploded) this.drawCrater(g);
    else this.drawBomb(g);
    this.drawPlungers(g);
    if (this.cursor.shown && this.phase === "turn") this.drawHand(g);
    this.juice.end(g);
    this.drawFrame(g);
    this.drawHud(g);
    this.drawPanels(g);
    this.drawFloaters(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,240,200,${Math.min(1, this.flash) * 0.85})`;
      g.fillRect(0, 0, width, height);
    }
    if (this.jinxFlash > 0) {
      g.fillStyle = `rgba(192,132,252,${Math.min(1, this.jinxFlash) * 0.35})`;
      g.fillRect(0, 0, width, height);
    }
    this.callouts.draw(g, width, height);
  }

  private drawFloor(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    g.fillStyle = "rgba(60,48,40,0.5)";
    g.fillRect(0, this.rowY, width, height - this.rowY);
    g.fillStyle = "rgba(244,247,251,0.08)";
    g.fillRect(0, this.rowY, width, 3);
  }

  private drawBomb(g: CanvasRenderingContext2D): void {
    const s = this.s;
    const t = tension(this.match.bomb);
    const final = isFinalBomb(this.match);
    const scale = 1 + this.swell * 0.35 + (this.phase === "fuse" ? Math.sin(this.time * 60) * 0.03 : 0);
    const jx = this.twitch * (this.ctx.rng.next() - 0.5) * 16 * s;
    const jy = this.twitch * (this.ctx.rng.next() - 0.5) * 10 * s;
    g.save();
    g.translate(this.bombX + jx, this.bombY + jy);
    g.rotate(this.twitch * Math.sin(this.time * 40) * 0.08);
    g.scale(scale, scale);
    const r = this.bombR;

    // Glow builds with tension; red-hot during the fuse; angry red on the final bomb.
    const glowA = 0.15 + t * 0.35 + this.swell * 0.5;
    const glow = this.phase === "fuse" ? "#FF5A1F" : final ? DANGER : "#FFB020";
    g.shadowColor = glow;
    g.shadowBlur = (20 + t * 30 + this.swell * 60) * s;
    g.fillStyle = this.phase === "fuse" ? `rgb(${40 + this.swell * 160},${20 + this.swell * 30},${30})` : final ? "#241018" : "#161a24";
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.globalAlpha = glowA * 0.5;
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    // Shine.
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.ellipse(-r * 0.35, -r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
    g.fill();

    // Cap and fuse.
    g.fillStyle = "#8a8f9a";
    g.fillRect(-r * 0.2, -r - 22 * s, r * 0.4, 30 * s);
    g.strokeStyle = "#c9a26b";
    g.lineWidth = 6 * s;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, -r - 20 * s);
    g.quadraticCurveTo(r * 0.05, -r - 60 * s, r * 0.25, -r - 48 * s);
    g.stroke();
    const sparkR = (6 + t * 6 + this.swell * 10) * s * (0.8 + 0.4 * Math.abs(Math.sin(this.time * 30)));
    g.fillStyle = "#FFE14D";
    g.shadowColor = "#FFB020";
    g.shadowBlur = 20 * s;
    g.beginPath();
    g.arc(r * 0.25, -r - 48 * s, sparkR, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;

    // A worried face. Eyes widen as tension climbs; a wicked grin when jinxing.
    const grin = this.jinxFlash > 0;
    const ey = -r * 0.1;
    const er = r * (0.09 + t * 0.06);
    g.fillStyle = "#F4F7FB";
    for (const dx of [-0.3, 0.3]) {
      g.beginPath();
      g.ellipse(r * dx, ey, er, er * 1.25, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#070b14";
    for (const dx of [-0.3, 0.3]) {
      g.beginPath();
      g.arc(r * dx + (this.twitch * 4 * s), ey + er * 0.2, er * 0.45, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "#F4F7FB";
    g.lineWidth = 5 * s;
    g.beginPath();
    if (this.phase === "fuse") {
      g.ellipse(0, r * 0.32, r * 0.16, r * (0.1 + this.swell * 0.15), 0, 0, Math.PI * 2);
    } else if (grin) {
      g.moveTo(-r * 0.3, r * 0.25);
      g.quadraticCurveTo(0, r * 0.6, r * 0.3, r * 0.25);
    } else {
      g.moveTo(-r * 0.2, r * 0.35 + t * r * 0.05);
      g.quadraticCurveTo(0, r * (0.2 + t * 0.3), r * 0.2, r * 0.35 + t * r * 0.05);
    }
    g.stroke();
    g.restore();
  }

  private drawCrater(g: CanvasRenderingContext2D): void {
    const r = this.bombR;
    g.save();
    g.translate(this.bombX, this.bombY + r * 0.6);
    g.fillStyle = "rgba(10,8,8,0.8)";
    g.beginPath();
    g.ellipse(0, 0, r * 1.5, r * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,90,31,0.35)";
    g.lineWidth = 4;
    g.stroke();
    g.restore();
  }

  private drawPlungers(g: CanvasRenderingContext2D): void {
    const s = this.s;
    const bomb = this.match.bomb;
    const active = this.active;
    const myTurn = this.phase === "turn";
    const boxW = this.slotW * 0.62;
    const boxH = 54 * s;
    const rod = 62 * s;
    for (let i = 0; i < this.plungers.length; i++) {
      const p = this.plungers[i]!;
      const pressed = bomb.pressed[i] ?? false;
      const open = !pressed && !this.exploded;
      const wob = p.wobble * Math.sin(this.time * 28) * 0.08;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(wob);
      if (!open) g.globalAlpha = 0.55;

      // Base box.
      g.fillStyle = "#2a2f3c";
      g.fillRect(-boxW / 2, -boxH, boxW, boxH);
      g.fillStyle = pressed ? "#4b5160" : active.player.color;
      if (!myTurn) g.fillStyle = pressed ? "#4b5160" : "#8a8f9a";
      g.fillRect(-boxW / 2, -boxH, boxW, 8 * s);
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.lineWidth = 3 * s;
      g.strokeRect(-boxW / 2, -boxH, boxW, boxH);

      // Rod and T-handle.
      const sink = pressed ? 1 : 0;
      const rodH = rod * (1 - sink * 0.85);
      g.fillStyle = "#b9bec9";
      g.fillRect(-7 * s, -boxH - rodH, 14 * s, rodH);
      g.fillStyle = pressed ? "#5a2a2a" : this.mustPress && myTurn ? JINX : "#c0392b";
      const hy = -boxH - rodH - 16 * s;
      g.beginPath();
      g.roundRect(-boxW * 0.42, hy, boxW * 0.84, 18 * s, 8 * s);
      g.fill();
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.stroke();

      if (open && myTurn) {
        // Pulsing ring so the live tap targets are obvious.
        const pulse = 0.4 + 0.3 * Math.sin(this.time * 6 + i);
        g.strokeStyle = this.mustPress ? JINX : active.player.color;
        g.globalAlpha = pulse;
        g.lineWidth = 4 * s;
        g.beginPath();
        g.roundRect(-this.slotW * 0.45, -boxH - rod - 30 * s, this.slotW * 0.9, boxH + rod + 44 * s, 14 * s);
        g.stroke();
        g.globalAlpha = 1;
      }
      // Number label.
      g.fillStyle = pressed ? "rgba(244,247,251,0.3)" : "#F4F7FB";
      g.font = `700 ${Math.round(26 * s)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(i + 1), 0, -boxH / 2 + 4 * s);
      g.restore();
    }
  }

  private drawHand(g: CanvasRenderingContext2D): void {
    const s = this.s;
    const c = this.cursor;
    const color = this.active.player.color;
    g.save();
    g.translate(c.x, c.y + c.press * 50 * s + Math.sin(this.time * 5) * 4 * s);
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 10 * s;
    g.fillStyle = color;
    g.strokeStyle = "#070b14";
    g.lineWidth = 4 * s;
    // Palm.
    g.beginPath();
    g.roundRect(-26 * s, -8 * s, 52 * s, 50 * s, 16 * s);
    g.fill();
    g.stroke();
    // Pointing finger (down toward the plungers).
    g.beginPath();
    g.roundRect(-9 * s, 20 * s, 18 * s, 48 * s, 9 * s);
    g.fill();
    g.stroke();
    // Thumb.
    g.beginPath();
    g.roundRect(-40 * s, 0, 22 * s, 16 * s, 8 * s);
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawFrame(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    if (this.phase === "intro" || this.phase === "final") return;
    const seat = this.shown;
    const color = this.mustPress && this.phase === "turn" ? JINX : seat.player.color;
    const pulse = 0.65 + 0.35 * Math.sin(this.time * (this.phase === "fuse" ? 30 : 5));
    g.save();
    g.lineWidth = 22 * this.s;
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 30 * this.s;
    g.globalAlpha = 0.55 + 0.45 * pulse;
    g.strokeRect(0, 0, width, height);
    g.restore();
    const grad = g.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.95);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, hexAlpha(color, 0.22 * pulse));
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  private orbPos(index: number): { x: number; y: number } {
    const s = this.s;
    const orbR = 24 * s;
    return { x: 30 * s + orbR + index * (orbR * 2 + 54 * s), y: 30 * s + orbR };
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const s = this.s;
    const m = this.match;
    const dogs = underdogs(m);
    const orbR = 24 * s;
    const inPlay = this.phase === "turn" || this.phase === "stopping" || this.phase === "fuse";
    // Roster: orb, banked coins under it, live stake beside it.
    for (const seat of this.seats) {
      const { x, y } = this.orbPos(seat.index);
      g.save();
      if (inPlay && seat.index === this.shown.index) {
        g.strokeStyle = "#F4F7FB";
        g.lineWidth = 4 * s;
        g.beginPath();
        g.arc(x, y, orbR + 6 * s, 0, Math.PI * 2);
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, orbR, 0, Math.PI * 2);
      g.fillStyle = seat.player.color;
      g.fill();
      g.fillStyle = "#070b14";
      g.font = `700 ${Math.round(orbR)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(seat.player.name[0] ?? "?", x, y + 1);
      // Jinx badge.
      if (m.jinx === seat.index) {
        g.fillStyle = JINX;
        g.beginPath();
        g.arc(x + orbR * 0.75, y - orbR * 0.75, 11 * s, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#070b14";
        g.font = `700 ${Math.round(14 * s)}px ${FONT}`;
        g.fillText("J", x + orbR * 0.75, y - orbR * 0.75 + 1);
      }
      // Underdog badge.
      if (dogs.includes(seat.index)) {
        g.fillStyle = GOLD;
        g.beginPath();
        g.arc(x - orbR * 0.75, y - orbR * 0.75, 11 * s, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#070b14";
        g.font = `700 ${Math.round(13 * s)}px ${FONT}`;
        g.fillText("x2", x - orbR * 0.75, y - orbR * 0.75 + 1);
      }
      // Coins and stake.
      g.font = `700 ${Math.round(24 * s)}px ${FONT}`;
      g.fillStyle = "#F4F7FB";
      g.textBaseline = "top";
      g.fillText(String(m.coins[seat.index] ?? 0), x, y + orbR + 4 * s);
      const stake = m.stake[seat.index] ?? 0;
      if (stake > 0) {
        g.fillStyle = GOLD;
        g.font = `700 ${Math.round(20 * s)}px ${FONT}`;
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(`+${stake}`, x + orbR + 6 * s, y);
      }
      g.restore();
    }

    // Bomb counter, bottom right.
    g.save();
    g.textAlign = "right";
    g.textBaseline = "bottom";
    g.font = `700 ${Math.round(30 * s)}px ${FONT}`;
    const final = isFinalBomb(m);
    g.fillStyle = final ? DANGER : "rgba(244,247,251,0.6)";
    g.fillText(final ? "FINAL BOMB  x2" : `BOMB ${Math.min(m.round, BOMBS)} / ${BOMBS}`, width - 28 * s, height - 18 * s);
    g.restore();

    // Whose turn, and the turn clock.
    if (inPlay) {
      const seat = this.shown;
      g.save();
      g.textAlign = "center";
      g.textBaseline = "top";
      g.font = `700 ${Math.round(54 * s)}px ${FONT}`;
      g.lineWidth = 8 * s;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const label = this.phase === "fuse" ? "UH OH..."
        : this.phase === "stopping" ? `${seat.player.name.toUpperCase()} BANKS`
        : this.mustPress ? `${seat.player.name.toUpperCase()} IS JINXED`
        : m.chain > 0 ? `${seat.player.name.toUpperCase()}: AGAIN OR STOP?`
        : `${possessive(seat.player.name)} TURN`;
      g.strokeText(label, width / 2, 22 * s);
      g.fillStyle = this.mustPress && this.phase === "turn" ? JINX : seat.player.color;
      g.fillText(label, width / 2, 22 * s);
      if (this.phase === "turn") {
        const left = Math.max(0, this.turnLimit - this.turnT) / this.turnLimit;
        const bw = 320 * s;
        const by = 88 * s;
        g.fillStyle = "rgba(7,11,20,0.55)";
        g.fillRect(width / 2 - bw / 2, by, bw, 12 * s);
        g.fillStyle = left < 0.25 ? DANGER : seat.player.color;
        g.fillRect(width / 2 - bw / 2, by, bw * left, 12 * s);
        if (seat.player.kind === "human") {
          g.font = `700 ${Math.round(24 * s)}px ${FONT}`;
          g.fillStyle = "rgba(244,247,251,0.65)";
          const hint = this.mustPress ? "YOU MUST PRESS A PLUNGER" : m.chain > 0 ? "TAP A PLUNGER, OR STOP TO BANK" : "TAP A PLUNGER";
          g.fillText(hint, width / 2, by + 20 * s);
        }
      }
      g.restore();
    }
  }

  /** Left: what the next dud pays. Right: the current stake plus the STOP / JINX button. */
  private drawPanels(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const s = this.s;
    const m = this.match;
    if (this.phase !== "turn" && this.phase !== "stopping") return;
    const seat = this.phase === "stopping" ? this.seats[this.stopper]! : this.active;
    const open = unpressed(m.bomb).length;
    const pay = bounty(m, seat.index);
    const lx = width * 0.19;
    const ly = this.bombY;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6 * s;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    // Left panel.
    g.font = `700 ${Math.round(26 * s)}px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.fillText("NEXT DUD PAYS", lx, ly - 54 * s);
    g.font = `700 ${Math.round(76 * s)}px ${FONT}`;
    const payText = open <= 1 ? "BOOM" : `+${pay.total}`;
    g.strokeText(payText, lx, ly);
    g.fillStyle = open <= 1 ? DANGER : GOLD;
    g.fillText(payText, lx, ly);
    g.font = `700 ${Math.round(28 * s)}px ${FONT}`;
    g.fillStyle = open <= 2 ? DANGER : "rgba(244,247,251,0.6)";
    g.fillText(open === 1 ? "NEXT PRESS GOES BOOM" : `1 IN ${open} GOES BOOM`, lx, ly + 54 * s);
    if (pay.mult > 1 && open > 1) {
      g.font = `700 ${Math.round(24 * s)}px ${FONT}`;
      const tags: string[] = [];
      if (isFinalBomb(m)) tags.push("FINAL x2");
      if (underdogs(m).includes(seat.index)) tags.push("UNDERDOG x2");
      g.fillStyle = isFinalBomb(m) ? DANGER : GOLD;
      g.fillText(tags.join("  "), lx, ly + 88 * s);
    }

    // Right panel: stake.
    const rx = width * 0.81;
    const stake = m.stake[seat.index] ?? 0;
    g.font = `700 ${Math.round(26 * s)}px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.fillText(`${possessive(seat.player.name)} STAKE`, rx, ly - 54 * s);
    g.font = `700 ${Math.round(56 * s)}px ${FONT}`;
    g.strokeText(String(stake), rx, ly - 10 * s);
    g.fillStyle = stake > 0 ? GOLD : "rgba(244,247,251,0.5)";
    g.fillText(String(stake), rx, ly - 10 * s);

    const holder = this.jinxHolder;
    if (this.phase === "turn" && m.chain > 0 && !this.mustPress && seat.player.kind === "human") {
      this.drawButton(g, this.stopBox, seat.player.color, "STOP", `bank +${stake}`, "#070b14");
    } else if (this.taunt && seat.player.kind === "bot") {
      g.font = `700 ${Math.round(34 * s)}px ${FONT}`;
      g.globalAlpha = Math.min(1, this.taunt.life * 2);
      g.strokeText(this.taunt.text, rx, this.stopBox.y + this.stopBox.h / 2);
      g.fillStyle = this.taunt.color;
      g.fillText(this.taunt.text, rx, this.stopBox.y + this.stopBox.h / 2);
      g.globalAlpha = 1;
    } else if (this.phase === "turn" && m.chain > 0 && !this.mustPress && seat.player.kind === "bot") {
      g.font = `700 ${Math.round(24 * s)}px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.fillText("THINKING...", rx, this.stopBox.y + this.stopBox.h / 2);
    } else if (this.phase === "stopping" && holder && canJinx(m, holder.index, this.stopper)) {
      const human = holder.player.kind === "human";
      this.drawButton(g, this.jinxBox, JINX, "JINX!", human ? `${holder.player.name}: cancel the stop` : `${holder.player.name} may jinx...`, "#070b14", human);
    }
    g.restore();
  }

  private drawButton(g: CanvasRenderingContext2D, b: Box, color: string, title: string, sub: string, ink: string, pulse = true): void {
    const s = this.s;
    const k = pulse ? 1 + 0.03 * Math.sin(this.time * 7) : 1;
    g.save();
    g.translate(b.x + b.w / 2, b.y + b.h / 2);
    g.scale(k, k);
    g.shadowColor = color;
    g.shadowBlur = 24 * s;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, 18 * s);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    g.lineWidth = 4 * s;
    g.stroke();
    g.fillStyle = ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(44 * s)}px ${FONT}`;
    g.fillText(title, 0, -10 * s);
    g.font = `700 ${Math.round(18 * s)}px ${FONT}`;
    g.fillText(sub.toUpperCase(), 0, 22 * s);
    g.restore();
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const f of this.floaters) {
      const t = f.life / f.maxLife;
      g.globalAlpha = Math.min(1, t * 2);
      g.font = `700 ${Math.round(f.size)}px ${FONT}`;
      g.lineWidth = 6 * this.s;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.restore();
  }

  // ---- lifecycle -----------------------------------------------------------

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    const sc = scores(this.match);
    return this.seats.map((seat) => ({ playerId: seat.player.id, score: sc[seat.index] ?? 0 }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const seat of this.seats) {
      out.push({ playerId: seat.player.id, label: "Longest chain", value: String(this.match.bestChain[seat.index] ?? 0) });
      out.push({ playerId: seat.player.id, label: "Toasted", value: String(this.match.toasted[seat.index] ?? 0) });
      if (this.newBest.has(seat.index)) out.push({ playerId: seat.player.id, label: "Record", value: "NEW BEST" });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

function inBox(p: { x: number; y: number }, b: Box, minTap: number): boolean {
  const padX = Math.max(0, (minTap - b.w) / 2);
  const padY = Math.max(0, (minTap - b.h) / 2);
  return p.x >= b.x - padX && p.x <= b.x + b.w + padX && p.y >= b.y - padY && p.y <= b.y + b.h + padY;
}

/** "BOT 2'S", or "YOUR" for the default human name. */
function possessive(name: string): string {
  return name.trim().toLowerCase() === "you" ? "YOUR" : `${name.toUpperCase()}'S`;
}

/** "#RRGGBB" to "rgba(r,g,b,a)". Non-hex colours pass through unchanged. */
function hexAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
