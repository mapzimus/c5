import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  bankOut, botChoice, BOUNTY, buildHive, cashOut, canRelease, cornered, hiddenRisk, HIVE_SPECS, HIVES, leaders,
  newHive, releaseWasp, take, TURN_MS, underdog, UNDERDOG_BONUS, VISIBLE,
  type Choice, type HiveState, type Item,
} from "./logic";

export const hiveHeist: GameDefinition = {
  id: "hive-heist",
  name: "Hive Heist",
  tagline: "Bite, shove, bank. Spill nothing.",
  description:
    "One hungry bear, one honeycomb conveyor, three hives of rising stakes. On your turn take 1 or 2 combs, " +
    "or BANK your paws and leave. Honey stays in your paws until you bank it: get cornered by a wasp and you " +
    "spill the lot. Count the combs to shove wasps onto the richest paws. Out of the hive? You join the swarm " +
    "and release your own wasp into the hidden combs for a bounty. Most banked honey wins.",
  durationMs: 0,
  controls: "On your turn tap TAKE 1, TAKE 2 or BANK. In the swarm, tap your card to release a wasp",
  create: (ctx) => new HiveHeist(ctx),
};

const BEST_KEY = "hive-heist";
const BEST_VERSION = "v2";
const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 1.5;
const CHOMP_S = 0.45;
const STING_S = 1.3;
const BANK_S = 0.7;
const CORNERED_S = 1.0;
const HIVE_END_S = 1.6;
const FINAL_S = 2.4;
const FLY_S = 0.4;
const HONEY = "#FFB020";
const HONEY_LIGHT = "#FFE08A";
const WASP_YELLOW = "#F5D020";
const DANGER = "#FF3D7A";
const LIME = "#B8FF3D";
const INK = "#070b14";
const PALE = "#F4F7FB";

type Phase = "intro" | "turn" | "cornered" | "chomp" | "hiveEnd" | "final";

interface Seat {
  player: Player;
  banked: number;
  bestHaul: number;
  stings: number;
  /** Bot personality: < 1 banks early, > 1 pushes its luck. */
  nerve: number;
  /** Bot swarm member: seconds until it drops its wasp. */
  releaseAt: number | null;
  /** Card pop when the banked total changes. */
  pop: number;
}

interface Flyer {
  item: Item;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  /** Released wasps fly into the fog rather than into the bear. */
  release: boolean;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
  size: number;
}

interface Btn {
  choice: Choice;
  x: number;
  y: number;
  w: number;
  h: number;
}

class HiveHeist implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private hiveIndex = 0;
  private hive: HiveState;
  /** Seat whose turn is being played or resolved (hive.turn moves on as soon as an action lands). */
  private active = 0;
  private underdogSeat: number | null = null;
  private turnLeft = TURN_MS / 1000;
  private botAt: number | null = null;
  private slide = 0;
  private chomp = 0;
  private stingFlash = 0;
  private bankFlash = 0;
  private time = 0;
  private flyers: Flyer[] = [];
  private floaters: Floater[] = [];
  private lastLine = "";
  private lastColor = PALE;
  private seenWasps = 0;
  private finished = false;
  private readonly pressed = new Map<number, Choice | `card${number}`>();
  private readonly buttons: Btn[];
  private readonly cell: number;
  private readonly queueX: number;
  private readonly laneY: number;
  private readonly bearX: number;
  private readonly cardH: number;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.seats = ctx.players.map((player) => ({
      player, banked: 0, bestHaul: 0, stings: 0, nerve: ctx.rng.float(0.5, 1.2), releaseAt: null, pop: 0,
    }));
    const { width: w, height: h } = ctx;
    this.cell = Math.min(w * 0.072, 92);
    this.bearX = w * 0.11;
    this.queueX = w * 0.26;
    this.laneY = h * 0.41;
    this.cardH = Math.max(88, ctx.minTap);
    const bh = Math.max(ctx.minTap * 2, h * 0.24);
    const by = h * 0.70;
    const bw = w * 0.29;
    this.buttons = [
      { choice: "take1", x: w * 0.04, y: by, w: bw, h: bh },
      { choice: "take2", x: w * 0.355, y: by, w: bw, h: bh },
      { choice: "bank", x: w * 0.67, y: by, w: bw, h: bh },
    ];
    this.hive = this.startHive();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private startHive(): HiveState {
    const spec = HIVE_SPECS[this.hiveIndex]!;
    const queue = buildHive(this.hiveIndex, this.ctx.rng, this.seats.length);
    this.slide = 0;
    this.flyers = [];
    this.botAt = null;
    this.lastLine = "";
    this.phase = "intro";
    this.timer = INTRO_S;
    for (const s of this.seats) s.releaseAt = null;
    const last = this.hiveIndex === HIVES - 1;
    this.callouts.show(last ? `FINAL: ${spec.name}` : spec.name, last ? DANGER : HONEY, {
      size: 84, life: INTRO_S, y: 0.3,
    });
    const line = spec.crown > 0 ? `${spec.wasps} WASPS HIDDEN · CROWN WORTH ${spec.crown}` : `${spec.wasps} WASPS HIDDEN`;
    this.callouts.show(line, PALE, { size: 42, life: INTRO_S, y: 0.43 });
    this.underdogSeat = this.hiveIndex === 0 ? null : underdog(this.seats.map((s) => s.banked));
    if (this.underdogSeat !== null) {
      const seat = this.seats[this.underdogSeat]!;
      this.callouts.show(`${seat.player.name} IS THE UNDERDOG: SEES ${VISIBLE + UNDERDOG_BONUS}`, seat.player.color, {
        size: 36, life: INTRO_S, y: 0.56,
      });
    }
    this.ctx.sfx.countdown();
    const hive = newHive(queue, this.seats.length, this.hiveIndex);
    this.active = hive.turn;
    this.seenWasps = this.visibleWasps(hive, VISIBLE);
    return hive;
  }

  private windowFor(seat: number): number {
    return VISIBLE + (seat === this.underdogSeat ? UNDERDOG_BONUS : 0);
  }

  private visibleWasps(hive: HiveState, window: number): number {
    return hive.queue.slice(0, window).filter((it) => it.kind === "wasp").length;
  }

  private hiveLive(): boolean {
    return (this.phase === "turn" || this.phase === "cornered" || this.phase === "chomp") && !this.hive.done;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.stepFx(realDt);
    if (this.finished) return;
    if (this.hiveLive()) this.stepSwarm(dt);

    switch (this.phase) {
      case "intro":
        this.timer -= dt;
        if (this.timer <= 0) this.beginTurn();
        return;
      case "turn":
        this.turnLeft -= dt;
        if (this.botAt !== null) {
          this.botAt -= dt;
          if (this.botAt <= 0) {
            this.botAt = null;
            const seat = this.seats[this.active]!;
            this.act(botChoice(this.hive, this.active, this.ctx.rng, {
              nerve: seat.nerve, window: this.windowFor(this.active),
            }));
            return;
          }
        }
        // Dithering costs you: the bear eats one anyway.
        if (this.turnLeft <= 0) this.act("take1");
        return;
      case "cornered":
        this.timer -= dt;
        if (this.timer <= 0) this.resolve("take1");
        return;
      case "chomp":
        this.timer -= dt;
        if (this.timer > 0) return;
        if (this.hive.done) this.endHive();
        else this.beginTurn();
        return;
      case "hiveEnd":
        this.timer -= dt;
        if (this.timer > 0) return;
        this.hiveIndex += 1;
        if (this.hiveIndex < HIVES) this.hive = this.startHive();
        else this.finish();
        return;
      case "final":
        this.timer -= dt;
        if (this.timer <= 0) this.finished = true;
        return;
    }
  }

  private beginTurn(): void {
    this.active = this.hive.turn;
    const seat = this.seats[this.active]!;
    if (cornered(this.hive)) {
      this.phase = "cornered";
      this.timer = CORNERED_S;
      this.botAt = null;
      this.callouts.show(`${seat.player.name} CORNERED!`, DANGER, { size: 72, life: CORNERED_S + 0.3, y: 0.56 });
      this.lastLine = "";
      this.juice.shake(0.2);
      this.ctx.sfx.miss();
      return;
    }
    this.phase = "turn";
    this.turnLeft = TURN_MS / 1000;
    if (seat.player.kind === "bot") {
      const waspInView = this.visibleWasps(this.hive, this.windowFor(this.active)) > 0;
      const hesitate = waspInView && this.ctx.rng.next() < 0.3;
      this.botAt = hesitate ? this.ctx.rng.float(1.0, 1.8) : this.ctx.rng.float(0.4, 1.1);
    } else this.botAt = null;
    this.ctx.sfx.select();
  }

  /** Player or bot action during their turn. */
  private act(choice: Choice): void {
    if (this.phase !== "turn") return;
    if (choice === "take2" && this.hive.queue.length < 2) choice = "take1";
    if (choice === "bank" && (this.hive.paws[this.active] ?? 0) <= 0) return;
    this.resolve(choice);
  }

  private resolve(choice: Choice): void {
    const seatIndex = this.hive.turn;
    const seat = this.seats[seatIndex]!;
    const card = this.cardCenter(seatIndex);
    const name = seat.player.name;
    this.botAt = null;
    this.lastColor = seat.player.color;

    if (choice === "bank") {
      const waspInView = this.visibleWasps(this.hive, this.windowFor(seatIndex)) > 0;
      const { banked } = bankOut(this.hive);
      this.credit(seatIndex, banked);
      this.floaters.push({ text: `BANKED +${banked}`, x: card.x, y: card.y + 50, color: LIME, life: 1.2, size: 36 });
      this.lastLine = `${name} banks ${banked} and joins the swarm`;
      if (waspInView) this.callouts.show("CLEAN GETAWAY!", LIME, { size: 56, life: 1.0, y: 0.56 });
      this.bankFlash = 1;
      this.juice.burst(card.x, card.y, [HONEY, HONEY_LIGHT, LIME], { count: 26, speed: 260, gravity: 380, size: 5 });
      this.ctx.sfx.whoosh();
      this.joinSwarm(seatIndex);
      this.timer = BANK_S;
      this.phase = "chomp";
      return;
    }

    const n = choice === "take2" ? 2 : 1;
    const mouth = this.bearMouth();
    const res = take(this.hive, n);
    res.taken.forEach((item, i) => {
      const wasp = item.kind === "wasp";
      this.flyers.push({
        item, x0: this.queueX + i * this.cell, y0: this.laneY,
        x1: wasp ? card.x : mouth.x, y1: wasp ? card.y : mouth.y, t: 0, release: false,
      });
    });
    this.slide = res.taken.length * this.cell;
    const crown = res.taken.some((it) => it.kind === "honey" && it.crown);
    if (res.stung) {
      seat.stings += 1;
      if (res.spilled > 0) {
        this.floaters.push({ text: `SPILLED -${res.spilled}`, x: card.x, y: card.y + 54, color: DANGER, life: 1.4, size: 40 });
        this.juice.burst(card.x, card.y + 20, [HONEY, HONEY_LIGHT], { count: 30, speed: 300, gravity: 520, size: 5 });
      }
      this.callouts.show(`${name} STUNG!`, DANGER, { size: 76, life: STING_S, y: 0.56 });
      this.lastLine = res.spilled > 0 ? `${name} spills ${res.spilled} honey!` : `${name} is stung with empty paws`;
      if (res.bounty !== null) {
        const owner = this.seats[res.bounty]!;
        this.credit(res.bounty, BOUNTY);
        const oc = this.cardCenter(res.bounty);
        this.floaters.push({ text: `BOUNTY +${BOUNTY}`, x: oc.x, y: oc.y + 50, color: LIME, life: 1.4, size: 34 });
        this.lastLine = `${owner.player.name}'s wasp got ${name}!`;
        this.lastColor = owner.player.color;
      }
      this.juice.hitStop(0.12);
      this.juice.shake(0.7);
      this.stingFlash = 1;
      this.ctx.sfx.miss();
      this.joinSwarm(seatIndex);
      this.timer = STING_S;
    } else {
      const paws = this.hive.paws[seatIndex] ?? 0;
      this.floaters.push({ text: `+${res.honey}`, x: card.x, y: card.y + 50, color: HONEY, life: 1.0, size: 40 });
      this.chomp = 1;
      if (crown) {
        this.callouts.show(`${name} TAKES THE CROWN!`, HONEY_LIGHT, { size: 64, life: 1.2, y: 0.56 });
        this.juice.burst(mouth.x, mouth.y, [HONEY_LIGHT, PALE, HONEY], { count: 40, speed: 380, gravity: 300, size: 6 });
        this.juice.shake(0.35);
        this.ctx.sfx.streak(6);
      } else if (paws >= 3) this.ctx.sfx.streak(Math.min(6, Math.floor(paws / 3)));
      else this.ctx.sfx.collect();
      const next = this.hive.done ? null : this.hive.turn;
      if (next !== null && cornered(this.hive)) {
        const victim = this.seats[next]!;
        this.lastLine = `${name} shoves the wasp onto ${victim.player.name}!`;
      } else this.lastLine = `${name} grabs ${res.honey} · ${paws} in paws`;
      this.juice.shake(0.12);
      this.timer = CHOMP_S;
    }
    this.buzzCheck();
    if (this.hive.done && this.hive.queue.length === 0) this.timer = Math.max(this.timer, CHOMP_S);
    this.phase = "chomp";
  }

  private credit(seatIndex: number, amount: number): void {
    const seat = this.seats[seatIndex]!;
    seat.banked += amount;
    seat.bestHaul = Math.max(seat.bestHaul, amount);
    seat.pop = 1;
  }

  private joinSwarm(seatIndex: number): void {
    const seat = this.seats[seatIndex]!;
    if (seat.player.kind === "bot") seat.releaseAt = this.ctx.rng.float(1.5, 7);
  }

  /** A wasp coming into view gets a buzz so the table looks up. */
  private buzzCheck(): void {
    const now = this.visibleWasps(this.hive, VISIBLE);
    if (now > this.seenWasps) {
      const idx = this.hive.queue.findIndex((it, i) => i < VISIBLE && it.kind === "wasp");
      if (idx >= 0) {
        this.floaters.push({
          text: "BZZZ", x: this.queueX + idx * this.cell, y: this.laneY - this.cell * 0.8, color: WASP_YELLOW, life: 0.8, size: 28,
        });
      }
      this.ctx.sfx.tick();
    }
    this.seenWasps = now;
  }

  private stepSwarm(dt: number): void {
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i]!;
      if (seat.releaseAt === null) continue;
      seat.releaseAt -= dt;
      if (seat.releaseAt > 0) continue;
      if (canRelease(this.hive, i) && this.hive.queue.length >= 2) {
        seat.releaseAt = null;
        this.release(i);
      } else seat.releaseAt = canRelease(this.hive, i) ? 0.8 : null;
    }
  }

  private release(seatIndex: number): void {
    const idx = releaseWasp(this.hive, seatIndex, this.ctx.rng);
    if (idx === null) return;
    const seat = this.seats[seatIndex]!;
    const card = this.cardCenter(seatIndex);
    const x1 = Math.min(this.ctx.width - this.cell, this.queueX + idx * this.cell);
    this.flyers.push({ item: { kind: "wasp", owner: seatIndex }, x0: card.x, y0: card.y, x1, y1: this.laneY, t: 0, release: true });
    this.callouts.show(`${seat.player.name} RELEASES A WASP!`, WASP_YELLOW, { size: 52, life: 1.1, y: 0.56 });
    this.juice.shake(0.15);
    this.ctx.sfx.hit();
    this.buzzCheck();
  }

  private endHive(): void {
    this.phase = "hiveEnd";
    this.timer = HIVE_END_S;
    const empty = this.hive.queue.length === 0;
    const payouts = cashOut(this.hive);
    for (const p of payouts) {
      this.credit(p.seat, p.banked);
      const c = this.cardCenter(p.seat);
      this.floaters.push({ text: `BANKED +${p.banked}`, x: c.x, y: c.y + 50, color: LIME, life: 1.4, size: 36 });
      this.juice.burst(c.x, c.y, [HONEY, LIME], { count: 18, speed: 220, gravity: 380, size: 4 });
    }
    this.callouts.show(empty ? "HIVE EMPTY!" : "EVERYONE OUT!", empty ? HONEY : DANGER, {
      size: 78, life: HIVE_END_S, y: 0.43,
    });
    this.lastLine = "";
    this.ctx.sfx.whoosh();
  }

  private finish(): void {
    this.phase = "final";
    this.timer = FINAL_S;
    const lead = leaders(this.seats.map((s) => s.banked));
    const names = lead.map((i) => this.seats[i]!.player.name).join(" & ");
    const color = lead.length === 1 ? this.seats[lead[0]!]!.player.color : PALE;
    this.callouts.show(`${names} WINS!`, color, { size: 84, life: FINAL_S, y: 0.43 });
    for (const s of this.seats) {
      if (s.player.kind !== "human" || s.banked <= 0) continue;
      if (saveBest(BEST_KEY, s.banked, BEST_VERSION)) {
        this.callouts.show(`${s.player.name} NEW RECORD ${s.banked}`, LIME, { size: 50, life: FINAL_S, y: 0.58 });
        break;
      }
    }
    this.ctx.sfx.win();
  }

  private stepFx(dt: number): void {
    this.chomp = Math.max(0, this.chomp - dt * 2.2);
    this.stingFlash = Math.max(0, this.stingFlash - dt * 2.5);
    this.bankFlash = Math.max(0, this.bankFlash - dt * 2.5);
    for (const s of this.seats) s.pop = Math.max(0, s.pop - dt * 3);
    this.slide *= Math.pow(0.002, dt / 0.4);
    if (this.slide < 0.5) this.slide = 0;

    for (const f of this.flyers) f.t += dt / FLY_S;
    const landed = this.flyers.filter((f) => f.t >= 1);
    this.flyers = this.flyers.filter((f) => f.t < 1);
    for (const f of landed) {
      if (f.item.kind === "wasp") {
        const colors = f.release ? [WASP_YELLOW, "#15120a", PALE] : [DANGER, WASP_YELLOW, "#15120a"];
        this.juice.burst(f.x1, f.y1, colors, { count: f.release ? 16 : 24, speed: 320, gravity: 300, size: 5 });
        if (!f.release) this.ctx.sfx.hit();
      } else {
        this.juice.burst(f.x1, f.y1, [HONEY, HONEY_LIGHT], { count: 10, speed: 170, gravity: 420, size: 4, life: 0.5 });
      }
    }

    for (const fl of this.floaters) {
      fl.y -= 42 * dt;
      fl.life -= dt;
    }
    this.floaters = this.floaters.filter((fl) => fl.life > 0);
  }

  // ---- input ----

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private hitButton(p: { x: number; y: number }): Btn | null {
    return this.buttons.find((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) ?? null;
  }

  private hitCard(p: { x: number; y: number }): number | null {
    for (let i = 0; i < this.seats.length; i++) {
      const c = this.cardRect(i);
      if (p.x >= c.x && p.x < c.x + c.w && p.y >= c.y && p.y < c.y + c.h) return i;
    }
    return null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    const b = this.hitButton(p);
    if (b) {
      e.preventDefault();
      this.pressed.set(e.pointerId, b.choice);
      if (this.phase !== "turn") return;
      if (this.seats[this.active]!.player.kind !== "human") return;
      if (b.choice === "take2" && this.hive.queue.length < 2) return;
      this.act(b.choice);
      return;
    }
    const card = this.hitCard(p);
    if (card === null) return;
    e.preventDefault();
    this.pressed.set(e.pointerId, `card${card}`);
    const seat = this.seats[card]!;
    if (seat.player.kind !== "human" || !this.hiveLive() || !canRelease(this.hive, card)) return;
    if (this.hive.queue.length < 2) return;
    this.release(card);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pressed.delete(e.pointerId);
  };

  // ---- render ----

  private activeSeat(): Seat | null {
    return this.phase === "turn" || this.phase === "chomp" || this.phase === "cornered"
      ? this.seats[this.active] ?? null
      : null;
  }

  render(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    fillArena(g, w, h);
    const active = this.activeSeat();
    if (active) {
      g.save();
      g.globalAlpha = 0.14;
      g.fillStyle = active.player.color;
      g.fillRect(0, 0, w, h);
      g.restore();
    }
    this.juice.begin(g);
    this.drawConveyor(g);
    this.drawBear(g);
    this.drawFlyers(g);
    this.juice.end(g);
    if (this.stingFlash > 0) {
      g.fillStyle = `rgba(255,61,122,${this.stingFlash * 0.35})`;
      g.fillRect(0, 0, w, h);
    }
    if (this.bankFlash > 0) {
      g.fillStyle = `rgba(184,255,61,${this.bankFlash * 0.18})`;
      g.fillRect(0, 0, w, h);
    }
    this.drawScoreboard(g);
    this.drawButtons(g);
    this.drawPrompt(g);
    this.drawFloaters(g);
    if (this.phase === "turn") drawTimerBar(g, w, this.turnLeft, TURN_MS / 1000);
    this.callouts.draw(g, w, h);
  }

  private drawHex(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string, lw = 3): void {
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
  }

  private drawCrown(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    g.beginPath();
    g.moveTo(x - r, y + r * 0.6);
    g.lineTo(x - r, y - r * 0.4);
    g.lineTo(x - r * 0.5, y + r * 0.05);
    g.lineTo(x, y - r * 0.8);
    g.lineTo(x + r * 0.5, y + r * 0.05);
    g.lineTo(x + r, y - r * 0.4);
    g.lineTo(x + r, y + r * 0.6);
    g.closePath();
    g.fillStyle = HONEY_LIGHT;
    g.fill();
    g.strokeStyle = "#8a5200";
    g.lineWidth = 2;
    g.stroke();
  }

  private drawConveyor(g: CanvasRenderingContext2D): void {
    const { width: w } = this.ctx;
    const y = this.laneY;
    const cell = this.cell;
    const r = cell * 0.5;
    const q = this.hive.queue;
    const live = this.phase === "turn" || this.phase === "cornered" || this.phase === "chomp";
    const window = live ? this.windowFor(this.active) : VISIBLE;
    const activeColor = this.activeSeat()?.player.color ?? PALE;
    g.save();
    // Belt.
    g.fillStyle = "rgba(255,176,32,0.07)";
    g.fillRect(this.queueX - cell, y - r * 1.3, w, r * 2.6);
    g.fillStyle = "rgba(255,176,32,0.18)";
    g.fillRect(this.queueX - cell, y + r * 1.3, w, 4);
    // Comb cells, front first. Hidden ones are dark with a "?", except the crown which is always marked.
    for (let i = 0; i < q.length; i++) {
      const x = this.queueX + i * cell + this.slide;
      if (x > w + cell) break;
      const item = q[i]!;
      const revealed = i < window;
      const nose = revealed && i >= VISIBLE;
      const crownHidden = !revealed && item.kind === "honey" && item.crown === true;
      if (crownHidden) {
        const glow = 0.6 + Math.sin(this.time * 5) * 0.4;
        this.drawHex(g, x, y, r * 1.08, `rgba(255,224,138,${0.12 * glow})`, `rgba(255,224,138,${0.35 * glow})`, 2);
        this.drawHex(g, x, y, r * 0.96, "rgba(255,224,138,0.18)", HONEY_LIGHT, 3);
        this.drawCrown(g, x, y - r * 0.15, r * 0.42);
        g.fillStyle = HONEY_LIGHT;
        g.font = `700 ${Math.round(r * 0.6)}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(item.value), x, y + r * 0.55);
        continue;
      }
      this.drawHex(
        g, x, y, r * 0.96,
        revealed ? (nose ? "rgba(244,247,251,0.12)" : "rgba(255,176,32,0.2)") : "rgba(244,247,251,0.05)",
        revealed ? (nose ? activeColor : HONEY) : "rgba(244,247,251,0.2)",
        nose ? 4 : 3,
      );
      if (revealed) {
        this.drawItem(g, item, x, y, r * 0.6);
        if (nose) {
          g.fillStyle = activeColor;
          g.font = `700 16px ${FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText("NOSE", x, y - r * 1.05);
        }
      } else {
        g.fillStyle = "rgba(244,247,251,0.4)";
        g.font = `700 ${Math.round(r * 1.1)}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("?", x, y + 2);
      }
    }
    // Fog over the unknown.
    const fogX = this.queueX + cell * (window - 0.5);
    const fog = g.createLinearGradient(fogX, 0, fogX + cell * 2, 0);
    fog.addColorStop(0, "rgba(12,22,40,0)");
    fog.addColorStop(1, "rgba(12,22,40,0.45)");
    g.fillStyle = fog;
    g.fillRect(fogX, y - r * 1.3, w, r * 2.6);

    // Count on the left, risk meter on the right.
    const top = y - r * 1.45;
    g.textBaseline = "bottom";
    g.textAlign = "left";
    g.fillStyle = "rgba(244,247,251,0.55)";
    g.font = `700 24px ${FONT}`;
    const spec = HIVE_SPECS[this.hiveIndex] ?? HIVE_SPECS[HIVES - 1]!;
    g.fillText(`${spec.name} ${this.hiveIndex + 1}/${HIVES} · ${q.length} IN THE HIVE`, this.queueX - r, top);
    const { wasps, hidden, risk } = hiddenRisk(q, window);
    const meterW = 220;
    const mx = w - 40 - meterW;
    const label = hidden === 0 ? "NOTHING HIDDEN" : `${wasps} WASP${wasps === 1 ? "" : "S"} IN ${hidden} HIDDEN`;
    g.textAlign = "right";
    g.fillStyle = risk >= 0.34 ? DANGER : risk > 0 ? WASP_YELLOW : "rgba(244,247,251,0.55)";
    g.font = `700 24px ${FONT}`;
    g.fillText(label, w - 40, top - 12);
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(mx, top - 8, meterW, 6);
    const pulse = risk >= 0.34 ? 0.8 + Math.sin(this.time * 10) * 0.2 : 1;
    g.globalAlpha = pulse;
    g.fillStyle = risk >= 0.34 ? DANGER : risk >= 0.18 ? WASP_YELLOW : LIME;
    g.fillRect(mx, top - 8, meterW * Math.min(1, risk * 2), 6);
    g.restore();
  }

  private drawItem(g: CanvasRenderingContext2D, item: Item, x: number, y: number, r: number): void {
    if (item.kind === "honey") {
      this.drawHoney(g, x, y, r, item.value);
      if (item.crown) this.drawCrown(g, x, y - r * 1.35, r * 0.5);
    } else this.drawWasp(g, x, y, r);
  }

  private drawHoney(g: CanvasRenderingContext2D, x: number, y: number, r: number, value: number): void {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.moveTo(0, -r * 1.25);
    g.quadraticCurveTo(r * 0.95, -r * 0.25, r * 0.72, r * 0.35);
    g.arc(0, r * 0.35, r * 0.72, 0, Math.PI, false);
    g.quadraticCurveTo(-r * 0.95, -r * 0.25, 0, -r * 1.25);
    g.closePath();
    const grad = g.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, HONEY_LIGHT);
    grad.addColorStop(1, "#D98A00");
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = "#8a5200";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.beginPath();
    g.ellipse(-r * 0.28, 0, r * 0.14, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.font = `700 ${Math.round(r * 1.1)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(value), r * 0.08, r * 0.38);
    g.restore();
  }

  private drawWasp(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    g.save();
    g.translate(x, y + Math.sin(this.time * 22 + x) * 2.5);
    const flap = Math.sin(this.time * 40 + x) * 0.25;
    // Wings.
    g.fillStyle = "rgba(244,247,251,0.55)";
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(side * r * 0.25, -r * 0.7, r * 0.55, r * 0.26, side * (0.5 + flap), 0, Math.PI * 2);
      g.fill();
    }
    // Striped body.
    g.beginPath();
    g.ellipse(r * 0.1, 0, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
    g.fillStyle = WASP_YELLOW;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "#15120a";
    for (let k = -1; k <= 1; k++) g.fillRect(k * r * 0.5 - r * 0.1, -r, r * 0.22, r * 2);
    g.restore();
    // Stinger (points away from the bear).
    g.fillStyle = "#15120a";
    g.beginPath();
    g.moveTo(r * 1.0, -r * 0.1);
    g.lineTo(r * 1.45, 0);
    g.lineTo(r * 1.0, r * 0.1);
    g.closePath();
    g.fill();
    // Head with angry red eyes.
    g.beginPath();
    g.arc(-r * 0.95, 0, r * 0.38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = DANGER;
    g.beginPath();
    g.arc(-r * 1.08, -r * 0.12, r * 0.11, 0, Math.PI * 2);
    g.arc(-r * 0.86, -r * 0.12, r * 0.11, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private bearScale(): number {
    return this.cell / 96;
  }

  private bearMouth(): { x: number; y: number } {
    const s = this.bearScale();
    return { x: this.bearX + 30 * s, y: this.laneY + 28 * s };
  }

  private drawBear(g: CanvasRenderingContext2D): void {
    const s = this.bearScale();
    const open = this.chomp;
    const worried = this.phase === "cornered" || this.stingFlash > 0.4;
    g.save();
    g.translate(this.bearX, this.laneY - open * 6 * s);
    // Squash on the chomp.
    g.scale(s * (1 + open * 0.08), s * (1 - open * 0.08));
    const fur = "#7a4a22";
    const muzzle = "#c9955a";
    // Body.
    g.fillStyle = fur;
    g.beginPath();
    g.ellipse(0, 78, 72, 62, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = muzzle;
    g.beginPath();
    g.ellipse(8, 86, 36, 38, 0, 0, Math.PI * 2);
    g.fill();
    // Ears.
    for (const side of [-1, 1]) {
      g.fillStyle = fur;
      g.beginPath();
      g.arc(side * 46, -62, 21, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = muzzle;
      g.beginPath();
      g.arc(side * 46, -62, 10, 0, Math.PI * 2);
      g.fill();
    }
    // Head.
    g.fillStyle = fur;
    g.beginPath();
    g.arc(0, -10, 62, 0, Math.PI * 2);
    g.fill();
    // Muzzle, facing the conveyor.
    g.fillStyle = muzzle;
    g.beginPath();
    g.ellipse(22, 16, 38, 30, 0, 0, Math.PI * 2);
    g.fill();
    // Mouth opens on a chomp, puckers when worried.
    g.fillStyle = "#2a0e0e";
    g.beginPath();
    if (worried) g.ellipse(30, 30, 8, 9, 0, 0, Math.PI * 2);
    else g.ellipse(30, 28, 16 + open * 8, 4 + open * 18, 0, 0, Math.PI * 2);
    g.fill();
    if (open > 0.3) {
      g.fillStyle = PALE;
      g.fillRect(20, 20 + open * 4, 7, 7);
      g.fillRect(34, 20 + open * 4, 7, 7);
    }
    // Nose.
    g.fillStyle = "#1a0d08";
    g.beginPath();
    g.ellipse(40, 2, 12, 8, 0, 0, Math.PI * 2);
    g.fill();
    // Eyes (wide when worried).
    for (const ex of [-14, 24]) {
      g.fillStyle = "#1a0d08";
      g.beginPath();
      g.arc(ex, -26, worried ? 8.5 : 6.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PALE;
      g.beginPath();
      g.arc(ex + 2, -28, worried ? 3 : 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawFlyers(g: CanvasRenderingContext2D): void {
    for (const f of this.flyers) {
      const t = Math.min(1, f.t);
      const e = 1 - (1 - t) * (1 - t);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(t * Math.PI) * 90;
      const r = this.cell * 0.3 * (f.release ? 1 : 1 - t * 0.5);
      this.drawItem(g, f.item, x, y, r);
    }
  }

  private cardRect(i: number): { x: number; y: number; w: number; h: number } {
    const n = this.seats.length;
    const gap = 12;
    const cw = (this.ctx.width - 80 - (n - 1) * gap) / n;
    return { x: 40 + i * (cw + gap), y: 36, w: cw, h: this.cardH };
  }

  private cardCenter(i: number): { x: number; y: number } {
    const c = this.cardRect(i);
    return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  }

  private drawScoreboard(g: CanvasRenderingContext2D): void {
    const four = this.seats.length >= 4;
    g.save();
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const c = this.cardRect(i);
      const isActive = this.activeSeat() === s;
      const status = this.hive.status[i] ?? "in";
      const paws = this.hive.paws[i] ?? 0;
      const ready = this.hiveLive() && canRelease(this.hive, i);
      const held = [...this.pressed.values()].includes(`card${i}`);
      const pop = 1 + s.pop * 0.06 - (held ? 0.03 : 0);
      g.save();
      g.translate(c.x + c.w / 2, c.y + c.h / 2);
      g.scale(pop, pop);
      g.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
      g.globalAlpha = status !== "in" && !ready ? 0.6 : 1;
      g.fillStyle = "rgba(7,11,20,0.6)";
      this.roundRect(g, c.x, c.y, c.w, c.h, 14);
      g.fill();
      if (isActive) {
        g.strokeStyle = s.player.color;
        g.lineWidth = 4 + Math.sin(this.time * 8) * 1.5;
        this.roundRect(g, c.x, c.y, c.w, c.h, 14);
        g.stroke();
      } else if (ready) {
        g.strokeStyle = WASP_YELLOW;
        g.lineWidth = 3 + Math.sin(this.time * 6) * 1;
        this.roundRect(g, c.x, c.y, c.w, c.h, 14);
        g.stroke();
      }
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillStyle = s.player.color;
      g.font = `700 ${four ? 24 : 28}px ${FONT}`;
      g.fillText(s.player.name, c.x + 14, c.y + 22);
      if (i === this.underdogSeat && this.phase !== "hiveEnd") {
        const nx = c.x + 14 + g.measureText(s.player.name).width + 10;
        g.fillStyle = "rgba(244,247,251,0.75)";
        g.font = `700 14px ${FONT}`;
        g.fillText("UNDERDOG", nx, c.y + 23);
      }
      // Second line: paws in the hive, or the swarm state.
      const ly = c.y + c.h - 24;
      g.font = `700 ${four ? 17 : 19}px ${FONT}`;
      if (status === "in") {
        if (paws > 0) {
          const hot = paws >= 8;
          const scale = hot ? 1 + Math.sin(this.time * 9) * 0.05 : 1;
          const text = `${paws} IN PAWS`;
          const tw = g.measureText(text).width + 20;
          g.save();
          g.translate(c.x + 14 + tw / 2, ly);
          g.scale(scale, scale);
          g.fillStyle = hot ? DANGER : HONEY;
          this.roundRect(g, -tw / 2, -13, tw, 26, 13);
          g.fill();
          g.fillStyle = INK;
          g.textAlign = "center";
          g.fillText(text, 0, 1);
          g.restore();
        } else {
          g.fillStyle = "rgba(244,247,251,0.5)";
          g.fillText("EMPTY PAWS", c.x + 14, ly);
        }
      } else if (ready) {
        this.drawWasp(g, c.x + 26, ly, 9);
        g.fillStyle = WASP_YELLOW;
        g.fillText(s.player.kind === "human" ? "TAP: RELEASE WASP" : "WASP READY", c.x + 46, ly);
      } else {
        g.fillStyle = status === "stung" ? DANGER : LIME;
        g.fillText(status === "stung" ? "STUNG · IN THE SWARM" : "BANKED · IN THE SWARM", c.x + 14, ly);
      }
      g.textAlign = "right";
      g.fillStyle = HONEY;
      g.font = `700 ${four ? 40 : 44}px ${FONT}`;
      g.fillText(String(s.banked), c.x + c.w - 14, c.y + c.h / 2 + 2);
      g.restore();
    }
    g.restore();
  }

  private roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  private drawButtons(g: CanvasRenderingContext2D): void {
    const active = this.activeSeat();
    const live = this.phase === "turn" && active !== null && active.player.kind === "human";
    const paws = this.hive.paws[this.active] ?? 0;
    g.save();
    for (const b of this.buttons) {
      const can = b.choice === "take1" || (b.choice === "take2" ? this.hive.queue.length >= 2 : paws > 0);
      const held = [...this.pressed.values()].includes(b.choice);
      const sc = held ? 0.96 : 1;
      const bank = b.choice === "bank";
      g.save();
      g.translate(b.x + b.w / 2, b.y + b.h / 2);
      g.scale(sc, sc);
      g.globalAlpha = live && can ? 1 : 0.28;
      const color = active ? active.player.color : "rgba(244,247,251,0.3)";
      if (bank) {
        g.fillStyle = "rgba(7,11,20,0.55)";
        this.roundRect(g, -b.w / 2, -b.h / 2, b.w, b.h, 22);
        g.fill();
        g.strokeStyle = HONEY;
        g.lineWidth = 5;
        this.roundRect(g, -b.w / 2 + 3, -b.h / 2 + 3, b.w - 6, b.h - 6, 20);
        g.stroke();
        g.fillStyle = HONEY;
      } else {
        g.fillStyle = color;
        this.roundRect(g, -b.w / 2, -b.h / 2, b.w, b.h, 22);
        g.fill();
        g.fillStyle = INK;
      }
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.round(b.h * 0.44)}px ${FONT}`;
      const title = b.choice === "take1" ? "TAKE 1" : b.choice === "take2" ? "TAKE 2" : `BANK ${paws}`;
      g.fillText(title, 0, -b.h * 0.08);
      g.font = `700 ${Math.round(b.h * 0.15)}px ${FONT}`;
      g.globalAlpha *= 0.75;
      const sub = b.choice === "take1" ? "THE NEXT ONE" : b.choice === "take2" ? "THE NEXT TWO" : "LEAVE WITH YOUR PAWS";
      g.fillText(sub, 0, b.h * 0.26);
      g.restore();
    }
    g.restore();
  }

  private drawPrompt(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    const active = this.activeSeat();
    let text = "";
    let color = PALE;
    if (this.phase === "turn" && active) {
      text = active.player.kind === "human" ? `${active.player.name}: BITE OR BANK?` : `${active.player.name} IS COUNTING...`;
      color = active.player.color;
    } else if (this.phase === "cornered" && active) {
      text = "A WASP IN FRONT: NO WAY OUT";
      color = DANGER;
    } else if (this.phase === "chomp") {
      text = this.lastLine;
      color = this.lastColor;
    }
    if (!text) return;
    g.save();
    g.font = `700 38px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    g.strokeText(text, w / 2, h * 0.635);
    g.fillStyle = color;
    g.fillText(text, w / 2, h * 0.635);
    g.restore();
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const fl of this.floaters) {
      g.font = `700 ${fl.size}px ${FONT}`;
      g.globalAlpha = Math.min(1, fl.life / 0.4);
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(fl.text, fl.x, fl.y);
      g.fillStyle = fl.color;
      g.fillText(fl.text, fl.x, fl.y);
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.banked }));
  }

  getStats(): GameStat[] {
    return this.seats.map((s) => ({ playerId: s.player.id, label: "Best haul", value: String(s.bestHaul) }));
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
  }
}
