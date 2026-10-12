import { PLAYER_BINDS } from "../../../core/input";
import { GAME_HEIGHT, GAME_WIDTH, type GameContext, type GameDefinition, type GameInstance, type GameStat } from "../../../core/types";
import { Callouts, Juice, loadBest, saveBest } from "../../../fx/juice";
import { ParrotDuelGame } from "./duel";
import { ParrotPhysics } from "./physics";
import { FlickPointer } from "./pointer";
import { ParrotScene, preloadParrots } from "./renderer";
import {
  DUO_LIVES,
  RETURN_STREAK,
  STARTING_LIVES,
  advanceTurn,
  botBet,
  botFlick,
  dealTable,
  ghostSeats,
  isFinalRound,
  isOver,
  isOverdrive,
  missCue,
  missPenalty,
  missWouldEliminate,
  onPerch,
  perchFor,
  placeBet,
  resolveFlip,
  rollPerch,
  scoresFromTable,
  settleBets,
  underdogSeat,
  type Bet,
  type BetResult,
  type FlipOutcome,
  type FlipTable,
  type Perch,
} from "./rules";

type Phase = "ready" | "flight" | "result";

const RESULT_MS = 1000;
const HUD_INSET = 8;
const GOLD = "#f2c14e";
const LIME = "#B8FF3D";
const PINK = "#FF3D7A";
const FLAMES = ["#ff3d00", "#ff6d00", "#ff9100", "#ffd600"];
const BEST_KEY = "parrot-flip-fire";
/** Records are versioned by ruleset: v2 = perch rules, 6 lives, round cap. */
const BEST_VERSION = "v2-perch";
/** Start the make-or-break slow-mo when the falling parrot is this close to the ground. */
const DRAMA_SLOWMO_PX = 240;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GhostPanel {
  seat: number;
  box: Rect;
  make: Rect;
  miss: Rect;
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Classic Parrot Flip: take turns flicking the parrot; land on the moving perch
 * for a golden flip; knocked-out players bet on every flip as ghosts.
 */
class ParrotFlipGame implements GameInstance {
  private readonly physics: ParrotPhysics;
  private readonly scene = new ParrotScene();
  private readonly pointer: FlickPointer;
  private readonly table: FlipTable;
  private perch: Perch;
  private lastOutcome: FlipOutcome | null = null;
  private lastBets: BetResult[] = [];
  private lastCue: { text: string; close: boolean } | null = null;
  private phase: Phase = "ready";
  private result: "MAKE" | "MISS" | null = null;
  private resultTimer = 0;
  private resultAlpha = 0;
  private showGlow = false;
  private botWait = 0;
  private botAim: { dx: number; skill: number } | null = null;
  private readonly ghostWait = new Map<number, number>();
  private done = false;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  /** This flip landed on the perch (golden, worth 2). */
  private golden = false;
  private perfect = false;
  /** A miss on this flip knocks the flipper out. */
  private dramatic = false;
  private slowMoFired = false;
  /** Lives gained in the current ON FIRE run (humans only count toward the best). */
  private fireRun = 0;
  private bestFire = loadBest(BEST_KEY, BEST_VERSION);
  private bestAnnounced = false;
  private announcedRound = 0;
  private time = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => this.ctx.rng.next());
    this.physics = new ParrotPhysics(() => this.ctx.rng.next());
    this.table = dealTable(this.ctx.players.map((player) => player.id));
    preloadParrots([...this.ctx.players.map((player) => player.color), GOLD]);
    this.physics.init(GAME_WIDTH, GAME_HEIGHT, HUD_INSET);
    this.physics.setSideWalls(true);
    this.perch = rollPerch(this.ctx.rng, GAME_WIDTH);
    this.pointer = new FlickPointer(
      this.ctx.canvas,
      { w: GAME_WIDTH, h: GAME_HEIGHT },
      (vx, vy) => this.tryFlick(vx, vy),
      (x, y) => !this.ghostButtonAt(x, y),
    );
    this.announceRound();
    this.beginTurn();
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    this.time += realDt;
    const dt = this.juice.update(realDt);
    if (this.done) return;

    this.pollGhosts(dt);

    // Bot flights run at real speed so everyone can watch the perch landing.
    this.physics.step(dt);

    if (this.phase === "flight") {
      this.maybeSlowMo();
      const landing = this.physics.checkLanding();
      if (landing) this.resolve(landing);
      return;
    }

    if (this.phase === "result") {
      const speed = this.current()?.kind === "bot" ? 2.5 : 1;
      this.resultTimer -= dt * 1000 * speed;
      if (this.resultTimer > RESULT_MS - 240) this.resultAlpha = (RESULT_MS - this.resultTimer) / 240;
      else if (this.resultTimer < 300) this.resultAlpha = this.resultTimer / 300;
      else this.resultAlpha = 1;
      if (this.resultTimer <= 0) this.advance();
      return;
    }

    const player = this.current();
    if (!player) return;
    if (player.kind === "bot") {
      this.botWait -= dt;
      if (this.botWait <= 0) {
        const flick = botFlick(this.ctx.rng, this.botAim);
        this.tryFlick(flick.vx, flick.vy);
      }
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const player = this.current();
    const seat = this.table.seats[this.table.turn];
    this.juice.begin(g);
    const made = this.result === "MAKE";
    const view = perchFor(this.table, this.perch, this.table.turn);
    const wide = view.halfWidth > this.perch.halfWidth;
    this.scene.frame(g, 1 / 60, GAME_WIDTH, GAME_HEIGHT, {
      bottle: this.physics.getBottle(),
      liquid: this.physics.liquid,
      groundY: this.physics.getGroundY(),
      drag: this.phase === "ready" ? this.pointer.getDrag() : null,
      result: this.phase === "result" ? this.result : null,
      resultText: this.phase === "result" ? (this.golden ? "GOLDEN!" : this.perfect ? "PERFECT!" : made ? "MAKE!" : "MISS") : null,
      resultAlpha: this.resultAlpha,
      showGlow: this.showGlow,
      isOnFire: !!seat?.onFire,
      liquidColor: this.golden ? GOLD : (player?.color ?? "#d62828"),
      golden: this.golden,
      aim: this.aimAngle(),
      showHint: this.phase === "ready" && player?.kind === "human",
      perch: {
        x: view.x,
        halfWidth: view.halfWidth,
        label: wide ? "UNDERDOG PERCH ×2" : "PERCH ×2",
        wide,
        hot: this.phase === "flight",
      },
    });
    this.juice.end(g);
    this.drawHud(g);
    this.drawGhosts(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    return scoresFromTable(this.table);
  }

  getStats(): GameStat[] {
    return this.table.seats.map((seat) => ({
      playerId: seat.playerId,
      label: seat.eliminated ? "Ghost calls" : "Flips",
      value: seat.eliminated
        ? `${seat.doubloons} doubloon${seat.doubloons === 1 ? "" : "s"} · ${seat.makes}/${seat.attempts} made`
        : `${seat.makes}/${seat.attempts} made · ${seat.perches} on the perch`,
    }));
  }

  destroy(): void {
    this.pointer.destroy();
    this.physics.destroy();
  }

  private current() {
    return this.ctx.players[this.table.turn];
  }

  private aimAngle(): number {
    if (this.phase !== "ready") return 0;
    const drag = this.pointer.getDrag();
    if (!drag) return 0;
    const dx = drag.curX - drag.startX;
    const dy = drag.curY - drag.startY;
    if (Math.hypot(dx, dy) < 12) return 0;
    return Math.max(-0.55, Math.min(0.55, dx / 240 - dy / 700));
  }

  // ---- Turn flow -------------------------------------------------------------------

  private announceRound(): void {
    const { table } = this;
    if (this.announcedRound === table.round) return;
    this.announcedRound = table.round;
    if (isFinalRound(table)) {
      this.callouts.show("FINAL ROUND!", PINK, { life: 1.5, y: 0.42, size: 84 });
      this.ctx.sfx.go();
    } else if (isOverdrive(table) && table.round === table.rounds - 1) {
      this.callouts.show("OVERDRIVE!", "#FF6A00", { life: 1.5, y: 0.42, size: 84 });
      this.callouts.show("misses cost +1 · the stake never resets", "#F4F7FB", { life: 1.6, y: 0.52, size: 26 });
      this.ctx.sfx.go();
    } else if (table.round === 1) {
      this.callouts.show("LAND ON THE PERCH FOR ×2", GOLD, { life: 1.6, y: 0.42, size: 48 });
      this.ctx.sfx.countdown();
    } else {
      this.callouts.show(`ROUND ${table.round} / ${table.rounds}`, "#F4F7FB", { life: 1.0, y: 0.42, size: 56 });
      this.ctx.sfx.countdown();
    }
  }

  private beginTurn(): void {
    this.phase = "ready";
    this.result = null;
    this.resultAlpha = 0;
    this.showGlow = false;
    this.golden = false;
    this.perfect = false;
    this.slowMoFired = false;
    this.lastCue = null;
    this.lastBets = [];
    this.physics.resetBottle();
    this.perch = rollPerch(this.ctx.rng, GAME_WIDTH, this.perch);
    const player = this.current();
    this.dramatic = missWouldEliminate(this.table);
    if (this.dramatic) {
      this.callouts.show("MAKE IT OR YOU'RE OUT", PINK, { life: 1.8, y: 0.2, size: 58 });
      this.ctx.sfx.tick();
    }
    for (const seat of ghostSeats(this.table)) {
      if (this.ctx.players[seat]?.kind === "bot") this.ghostWait.set(seat, 0.5 + this.ctx.rng.float(0, 1.4));
    }
    if (player?.kind === "bot") {
      this.pointer.disable();
      // Bots hesitate on a must-make flip and sometimes just send it without aiming.
      this.botWait = (this.dramatic ? 0.8 : 0.3) + this.ctx.rng.float(0, 0.3);
      const underdog = underdogSeat(this.table) === this.table.turn;
      const aims = this.ctx.rng.next() < (underdog ? 0.8 : 0.45);
      const view = perchFor(this.table, this.perch, this.table.turn);
      this.botAim = aims ? { dx: view.x - GAME_WIDTH / 2, skill: this.ctx.rng.float(0.2, 0.8) } : null;
    } else {
      this.pointer.enable();
      this.botAim = null;
    }
  }

  private tryFlick(vx: number, vy: number): void {
    if (this.phase !== "ready" || this.done) return;
    this.pointer.disable();
    this.physics.applyFlick(vx, vy);
    this.phase = "flight";
    this.ctx.sfx.whoosh();
  }

  private betsOpen(): boolean {
    return !this.done && (this.phase === "ready" || (this.phase === "flight" && !this.physics.hasTouchedDown()));
  }

  private resolve(landing: "MAKE" | "MISS"): void {
    const made = landing === "MAKE";
    const seat = this.table.seats[this.table.turn];
    const wasOnFire = !!seat?.onFire;
    const info = this.physics.getLastLandingInfo();
    const view = perchFor(this.table, this.perch, this.table.turn);
    this.golden = made && !!info && onPerch(view, info.x);
    this.perfect = made && !!info?.perfect;
    this.lastOutcome = resolveFlip(this.table, made, { golden: this.golden });
    this.lastBets = settleBets(this.table, made);
    this.lastCue = !made && info ? missCue(info) : null;
    this.result = landing;
    this.showGlow = made;
    this.phase = "result";
    this.resultTimer = RESULT_MS;
    this.resultAlpha = 0;
    const bottle = this.physics.getBottle();
    const x = bottle?.position.x ?? GAME_WIDTH / 2;
    const y = (bottle?.position.y ?? GAME_HEIGHT * 0.7) - 40;
    if (bottle) {
      this.scene.kick(landing, bottle.position.x, bottle.position.y, this.current()?.color ?? "#69f0ae", this.golden || this.perfect);
    }
    const outcome = this.lastOutcome;
    this.juiceResult(outcome, wasOnFire, x, y);
    this.juiceBets(x, y);
    if (outcome.justIgnited) this.ctx.sfx.streak(3);
    else if (outcome.golden) this.ctx.sfx.streak(this.perfect ? 4 : 2);
    else if (made) this.ctx.sfx.collect();
    else if (outcome.eliminated) this.ctx.sfx.hit();
    else this.ctx.sfx.miss();
  }

  /** Slow the fall right before touchdown when a miss would knock the flipper out. */
  private maybeSlowMo(): void {
    if (!this.dramatic || this.slowMoFired) return;
    const bottle = this.physics.getBottle();
    if (!bottle || bottle.velocity.y <= 0) return;
    if (bottle.position.y < this.physics.getGroundY() - DRAMA_SLOWMO_PX) return;
    this.slowMoFired = true;
    this.juice.slowMo(0.9, 0.3);
  }

  private juiceResult(o: FlipOutcome, wasOnFire: boolean, x: number, y: number): void {
    const player = this.current();
    const color = player?.color ?? "#69f0ae";

    if (o.made) {
      this.juice.burst(x, y, [color, "#ffffff"], { count: 18, speed: 260, angle: -Math.PI / 2, spread: 2.4 });
      this.juice.shake(0.12);
      if (this.perfect && !o.golden) {
        this.juice.burst(x, y, [color, "#ffffff", LIME], { count: 36, speed: 460, size: 5 });
        this.juice.shake(0.2);
        this.juice.hitStop(0.05);
        this.callouts.show("PERFECT", "#7DF9FF", { life: 1, y: 0.2, size: 60 });
      }
      if (o.golden) {
        this.juice.burst(x, y, [GOLD, "#fff3b0", "#ffffff"], { count: this.perfect ? 70 : 50, speed: 520, size: 5 });
        this.juice.shake(this.perfect ? 0.4 : 0.3);
        this.juice.hitStop(this.perfect ? 0.07 : 0.04);
        const what = wasOnFire ? `+${o.fireGain} LIVES` : `STAKE +${o.worth}`;
        this.callouts.show(this.perfect ? `PERFECT PERCH! ${what}` : `ON THE PERCH! ${what}`, GOLD, { life: 1.3, y: 0.13, size: 50 });
      }
    } else if (this.lastCue?.close) {
      this.callouts.show("SO CLOSE!", "#FFB020", { life: 1.1, y: 0.2, size: 60 });
      this.juice.shake(0.15);
    }

    if (o.justIgnited) {
      this.juice.burst(x, y, FLAMES, { count: 80, speed: 560, size: 6, life: 0.9, gravity: -120, angle: -Math.PI / 2, spread: 2.2 });
      this.juice.shake(0.55);
      this.juice.hitStop(0.08);
      this.callouts.show("ON FIRE!", "#FF6D00", { life: 1.6, y: 0.2, size: 96 });
      this.fireRun = 0;
      this.bestAnnounced = false;
    }

    if (this.dramatic) {
      if (o.made) {
        this.juice.burst(x, y, [LIME, "#ffffff", color], { count: 60, speed: 600, size: 6 });
        this.juice.shake(0.6);
        this.callouts.show("STILL ALIVE!", LIME, { life: 1.4, y: 0.13, size: 54 });
      } else {
        this.juice.burst(x, y, [PINK, "#64748b", "#ffffff"], { count: 60, speed: 600, size: 6 });
      }
    }

    if (o.eliminated) {
      this.juice.shake(1);
      this.juice.hitStop(0.14);
      this.juice.burst(x, y, [PINK, "#94a3b8"], { count: 40, speed: 420, size: 5 });
      if (this.table.seats.filter((seat) => !seat.eliminated).length >= 2) {
        this.callouts.show(`${player?.name ?? "Player"} IS OUT · NOW A GHOST`, PINK, { life: 1.6, y: 0.5, size: 44 });
      }
    }

    // Personal best: longest ON FIRE run (lives gained), humans only.
    if (o.fireGain > 0 && player?.kind === "human") {
      this.fireRun += o.fireGain;
      if (this.fireRun > this.bestFire) {
        const hadBest = this.bestFire > 0;
        this.bestFire = this.fireRun;
        saveBest(BEST_KEY, this.fireRun, BEST_VERSION);
        if (!this.bestAnnounced && hadBest) {
          this.bestAnnounced = true;
          this.callouts.show("NEW RECORD!", "#FFD600", { life: 1.4, y: 0.5, size: 64 });
          this.ctx.sfx.win();
        }
      }
    }
    if (o.fireEnded || (wasOnFire && !this.table.seats[this.table.turn]?.onFire)) {
      this.fireRun = 0;
      this.bestAnnounced = false;
    }
  }

  private juiceBets(x: number, y: number): void {
    let row = 0;
    for (const bet of this.lastBets) {
      const p = this.ctx.players[bet.seat];
      if (!p) continue;
      if (bet.returned) {
        this.juice.burst(x, y, [p.color, "#ffffff", LIME], { count: 70, speed: 600, size: 6 });
        this.juice.shake(0.7);
        this.juice.hitStop(0.1);
        this.callouts.show(`${p.name} IS BACK FROM THE DEEP!`, p.color, { life: 1.9, y: 0.58 + row * 0.07, size: 50 });
        this.ctx.sfx.win();
        row += 1;
      } else if (bet.hit) {
        const taunt = bet.bet === "MISS" ? (p.kind === "bot" ? `${p.name}: "JINXED YA!" +1` : `${p.name} jinxed it +1`) : `${p.name} called it +1`;
        this.callouts.show(taunt, p.color, { life: 1.1, y: 0.62 + row * 0.06, size: 28 });
        row += 1;
      }
    }
  }

  private advance(): void {
    this.showGlow = false;
    this.resultAlpha = 0;
    if (isOver(this.table)) {
      this.done = true;
      this.pointer.disable();
      return;
    }
    const newRound = advanceTurn(this.table);
    if (isOver(this.table)) {
      this.done = true;
      this.pointer.disable();
      return;
    }
    if (newRound) this.announceRound();
    this.lastOutcome = null;
    this.beginTurn();
  }

  // ---- Ghosts ------------------------------------------------------------------------

  private ghostPanels(): GhostPanel[] {
    const bw = Math.max(100, this.ctx.minTap);
    const bh = Math.max(50, this.ctx.minTap);
    const pw = Math.max(250, bw * 2 + 36);
    const ph = 50 + bh + 30;
    const slots: { x: number; y: number }[] = [
      { x: 24, y: 236 },
      { x: GAME_WIDTH - 24 - pw, y: 236 },
      { x: 24, y: 236 + ph + 14 },
    ];
    return ghostSeats(this.table).slice(0, slots.length).map((seat, i) => {
      const slot = slots[i]!;
      const box = { x: slot.x, y: slot.y, w: pw, h: ph };
      return {
        seat,
        box,
        make: { x: box.x + 12, y: box.y + 44, w: bw, h: bh },
        miss: { x: box.x + pw - 12 - bw, y: box.y + 44, w: bw, h: bh },
      };
    });
  }

  private ghostButtonAt(x: number, y: number): { seat: number; bet: Bet } | null {
    for (const panel of this.ghostPanels()) {
      if (inRect(panel.make, x, y)) return { seat: panel.seat, bet: "MAKE" };
      if (inRect(panel.miss, x, y)) return { seat: panel.seat, bet: "MISS" };
    }
    return null;
  }

  private pollGhosts(dt: number): void {
    const ghosts = ghostSeats(this.table);
    if (ghosts.length === 0) return;
    const open = this.betsOpen();
    const click = this.ctx.input.consumeClick();
    if (click && open) {
      const hit = this.ghostButtonAt(click.x, click.y);
      if (hit && this.ctx.players[hit.seat]?.kind === "human") this.bet(hit.seat, hit.bet);
    }
    for (const seat of ghosts) {
      const p = this.ctx.players[seat];
      if (!p) continue;
      if (p.kind === "human") {
        if (!open) continue;
        const bind = PLAYER_BINDS[p.slot];
        if (bind && this.ctx.input.justPressed(bind.up)) this.bet(seat, "MAKE");
        else if (bind && this.ctx.input.justPressed(bind.down)) this.bet(seat, "MISS");
        continue;
      }
      const wait = this.ghostWait.get(seat);
      if (wait === undefined) continue;
      const left = wait - dt;
      this.ghostWait.set(seat, left);
      if (left <= 0) {
        this.ghostWait.delete(seat);
        if (open) this.bet(seat, botBet(this.ctx.rng, this.table));
      }
    }
  }

  private bet(seat: number, bet: Bet): void {
    const seatState = this.table.seats[seat];
    const changed = seatState?.bet !== bet;
    if (placeBet(this.table, seat, bet) && changed) this.ctx.sfx.select();
  }

  private drawGhosts(g: CanvasRenderingContext2D): void {
    const open = this.betsOpen();
    for (const panel of this.ghostPanels()) {
      const p = this.ctx.players[panel.seat];
      const seat = this.table.seats[panel.seat];
      if (!p || !seat) continue;
      const { box } = panel;
      g.fillStyle = "rgba(7,11,20,0.72)";
      g.strokeStyle = p.color;
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(box.x, box.y, box.w, box.h, 14);
      g.fill();
      g.stroke();

      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.font = "700 22px Bebas Neue, sans-serif";
      g.fillStyle = p.color;
      g.fillText(`☠ ${p.name}`, box.x + 12, box.y + 26);
      g.textAlign = "right";
      g.font = "600 14px Outfit, sans-serif";
      g.fillStyle = GOLD;
      g.fillText(`${seat.doubloons} doubloon${seat.doubloons === 1 ? "" : "s"}`, box.x + box.w - 12, box.y + 26);

      for (const [rect, label] of [[panel.make, "MAKE"], [panel.miss, "MISS"]] as const) {
        const picked = seat.bet === label;
        const accent = label === "MAKE" ? LIME : PINK;
        g.fillStyle = picked ? accent : "rgba(255,255,255,0.08)";
        g.strokeStyle = accent;
        g.lineWidth = picked ? 0 : 2;
        g.globalAlpha = open || picked ? 1 : 0.4;
        g.beginPath();
        g.roundRect(rect.x, rect.y, rect.w, rect.h, 10);
        g.fill();
        if (!picked) g.stroke();
        g.fillStyle = picked ? "#070b14" : accent;
        g.font = "700 24px Bebas Neue, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        g.globalAlpha = 1;
      }
      g.textBaseline = "alphabetic";

      // Streak dots toward the return.
      const dotY = box.y + box.h - 14;
      for (let i = 0; i < RETURN_STREAK; i += 1) {
        g.fillStyle = i < seat.betStreak ? LIME : "rgba(255,255,255,0.18)";
        g.beginPath();
        g.arc(box.x + 20 + i * 18, dotY, 5, 0, Math.PI * 2);
        g.fill();
      }
      g.textAlign = "left";
      g.font = "600 12px Outfit, sans-serif";
      g.fillStyle = "#94a3b8";
      let hint = seat.returned ? "already came back once" : `${RETURN_STREAK} in a row = back with 1 life`;
      if (!open && seat.bet) hint = "locked in";
      else if (!open) hint = "no call";
      else if (p.kind === "human" && !seat.bet) hint = "call the flip!";
      g.fillText(hint, box.x + 20 + RETURN_STREAK * 18, dotY + 4);
    }
  }

  // ---- HUD ---------------------------------------------------------------------------

  private drawHud(g: CanvasRenderingContext2D): void {
    const { table } = this;
    const player = this.current();
    const seat = table.seats[table.turn];
    const overdrive = isOverdrive(table);

    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.font = "600 16px Outfit, sans-serif";
    g.fillStyle = overdrive ? "#FF6A00" : "#94a3b8";
    const roundText = isFinalRound(table) ? "FINAL ROUND" : `ROUND ${table.round} / ${table.rounds}`;
    g.fillText(overdrive ? `${roundText}  ·  OVERDRIVE: misses +1, stake never resets` : `Parrot Flip  ·  ${roundText}`, 40, 28);

    g.font = "700 26px Bebas Neue, sans-serif";
    g.fillStyle = player?.color ?? "#F4F7FB";
    let status = "";
    if (seat?.onFire) status = "  ·  ON FIRE: makes +1 life, miss is free";
    else if (seat?.heatingUp) status = "  ·  Heating up";
    let hint = "";
    if (this.phase === "ready" && player?.kind === "human") hint = "  ·  Flick UP, aim for the perch";
    if (this.phase === "ready" && player?.kind === "bot") hint = "  ·  lining up…";
    g.fillText(`${player?.name ?? "Player"}'s flip${status}${hint}`, 40, 54);

    // Round pips.
    const pipW = 14;
    const pipGap = 6;
    const pipX0 = GAME_WIDTH / 2 - (table.rounds * (pipW + pipGap)) / 2;
    for (let i = 0; i < table.rounds; i += 1) {
      const hot = i >= table.rounds - 2;
      const doneRound = i + 1 < table.round;
      const live = i + 1 === table.round;
      g.fillStyle = live ? (hot ? "#FF6A00" : "#F4F7FB") : doneRound ? "rgba(244,247,251,0.35)" : hot ? "rgba(255,106,0,0.35)" : "rgba(244,247,251,0.14)";
      g.beginPath();
      g.roundRect(pipX0 + i * (pipW + pipGap), 20, pipW, live ? 10 : 6, 3);
      g.fill();
    }

    // Stake: what the current flipper loses on a miss.
    g.textAlign = "right";
    g.font = "700 44px Bebas Neue, sans-serif";
    const risk = missPenalty(table);
    g.fillStyle = missWouldEliminate(table) ? PINK : "#FFB020";
    g.fillText(`STAKE ${risk}`, GAME_WIDTH - 40, 50);
    g.font = "600 14px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText(missWouldEliminate(table) ? "make it or you're out" : "lives lost on a miss", GAME_WIDTH - 40, 70);

    g.font = "600 14px Outfit, sans-serif";
    g.fillStyle = "#FFB020";
    const runBit = seat?.onFire && player?.kind === "human" ? `Fire run +${this.fireRun}  ·  ` : "";
    g.fillText(`${runBit}Best fire run +${this.bestFire}`, GAME_WIDTH - 40, 112);
    if (player?.kind === "human" && seat && seat.recent.length > 0) {
      const made = seat.recent.filter(Boolean).length;
      g.fillStyle = "#94a3b8";
      g.fillText(`Last ${seat.recent.length}: ${made} made`, GAME_WIDTH - 40, 132);
    }

    const o = this.lastOutcome;
    if (this.phase === "result" && o) {
      let line = "";
      const cue = this.lastCue && !this.lastCue.close ? `  ·  ${this.lastCue.text}` : "";
      if (o.eliminated) line = `${player?.name ?? "Player"} is OUT${cue}`;
      else if (o.justIgnited) line = "ON FIRE!";
      else if (o.fireGain > 0) line = `+${o.fireGain} ${o.fireGain === 1 ? "life" : "lives"}`;
      else if (o.fireEnded) line = `Fire's out.${o.penalty ? ` -${o.penalty} life` : " No penalty."}${cue}`;
      else if (o.penalty > 0) line = `-${o.penalty} ${o.penalty === 1 ? "life" : "lives"}${cue}${o.overdrive ? "  ·  stake stays" : ""}`;
      else if (o.made) line = `Stake up to ${table.stake}`;
      if (line) {
        g.globalAlpha = this.resultAlpha;
        g.textAlign = "center";
        g.font = "700 40px Bebas Neue, sans-serif";
        g.fillStyle = o.made ? LIME : PINK;
        g.fillText(line, GAME_WIDTH / 2, GAME_HEIGHT * 0.3);
        g.globalAlpha = 1;
      }
    }

    g.textAlign = "left";
    const underdog = underdogSeat(table);
    this.ctx.players.forEach((seatPlayer, index) => {
      const row = table.seats[index];
      const x = 40 + index * 300;
      g.globalAlpha = row?.eliminated ? 0.55 : 1;
      g.fillStyle = index === table.turn ? seatPlayer.color : "#94a3b8";
      g.font = "600 16px Outfit, sans-serif";
      let tag = row?.eliminated ? `☠ ${row.doubloons} doubloon${row.doubloons === 1 ? "" : "s"}` : row?.onFire ? "🔥" : row?.heatingUp ? "♨" : "";
      if (!row?.eliminated && underdog === index) tag += "  UNDERDOG";
      const hearts = row?.eliminated ? "" : `${"♥".repeat(Math.min(row?.lives ?? 0, 8))}${(row?.lives ?? 0) > 8 ? `+${row!.lives - 8}` : ""} `;
      g.fillText(`${seatPlayer.name}  ${hearts}${tag}`, x, 90);
      g.globalAlpha = 1;
    });
  }
}

const MODES = [
  { id: "classic", title: "CLASSIC", line1: "Take turns, land on the perch.", line2: "Knocked out? Bet on every flip.", x: 250, color: "#3EE0FF" },
  { id: "duel", title: "DUEL", line1: "Two players flip at once,", line2: "split screen. Winner stays on.", x: 690, color: "#FF3D7A" },
] as const;
const MODE_Y = 230;
const MODE_W = 340;
const MODE_H = 300;

/** Parrot Flip opens on a Classic / Duel choice. An all-bot table goes straight to Classic. */
class ParrotFlipLauncher implements GameInstance {
  private inner: GameInstance | null = null;
  private time = 0;

  constructor(private readonly ctx: GameContext) {
    const humans = ctx.players.filter((p) => p.kind === "human").length;
    if (humans === 0 || ctx.players.length < 2) this.inner = new ParrotFlipGame(ctx);
  }

  update(dt: number): void {
    if (this.inner) {
      this.inner.update(dt);
      return;
    }
    this.time += dt;
    const input = this.ctx.input;
    const click = input.consumeClick();
    let pick: "classic" | "duel" | null = null;
    if (input.justPressed("Digit1") || input.justPressed("KeyC")) pick = "classic";
    if (input.justPressed("Digit2") || input.justPressed("KeyD")) pick = "duel";
    if (click) {
      for (const mode of MODES) {
        if (click.x >= mode.x && click.x <= mode.x + MODE_W && click.y >= MODE_Y && click.y <= MODE_Y + MODE_H) pick = mode.id;
      }
    }
    if (pick) {
      this.ctx.sfx.go();
      this.inner = pick === "duel" ? new ParrotDuelGame(this.ctx) : new ParrotFlipGame(this.ctx);
    }
  }

  render(g: CanvasRenderingContext2D): void {
    if (this.inner) {
      this.inner.render(g);
      return;
    }
    const bg = g.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    bg.addColorStop(0, "#0c1628");
    bg.addColorStop(1, "#1d3a4f");
    g.fillStyle = bg;
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.textAlign = "center";
    g.fillStyle = "#F4F7FB";
    g.font = "700 64px Bebas Neue, Impact, sans-serif";
    g.fillText("PARROT FLIP", GAME_WIDTH / 2, 110);
    g.font = "600 20px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText("Tap a mode", GAME_WIDTH / 2, 150);
    MODES.forEach((mode, i) => {
      const pulse = 1 + Math.sin(this.time * 3 + i * 1.6) * 0.015;
      g.save();
      g.translate(mode.x + MODE_W / 2, MODE_Y + MODE_H / 2);
      g.scale(pulse, pulse);
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.strokeStyle = mode.color;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(-MODE_W / 2, -MODE_H / 2, MODE_W, MODE_H, 24);
      g.fill();
      g.stroke();
      g.fillStyle = mode.color;
      g.font = "700 72px Bebas Neue, Impact, sans-serif";
      g.fillText(mode.title, 0, -20);
      g.fillStyle = "#F4F7FB";
      g.font = "600 20px Outfit, sans-serif";
      g.fillText(mode.line1, 0, 40);
      g.fillText(mode.line2, 0, 68);
      g.fillStyle = "#64748b";
      g.font = "600 14px Outfit, sans-serif";
      g.fillText(`or press ${i + 1}`, 0, 120);
      g.restore();
    });
  }

  isFinished(): boolean {
    return this.inner?.isFinished() ?? false;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.inner?.getScores() ?? this.ctx.players.map((p) => ({ playerId: p.id, score: 0 }));
  }

  destroy(): void {
    this.inner?.destroy();
  }
}

export const parrotFlip: GameDefinition = {
  id: "parrot-flip",
  name: "Parrot Flip",
  tagline: "Flick the pirate parrot onto the perch.",
  description: `Bottle-game rules with a moving target. ${STARTING_LIVES} lives each (${DUO_LIVES} head to head). Every make raises the shared stake; miss and you lose that many lives. Land on the glowing PERCH and the make counts double. Three in a row = ON FIRE. Knocked out? Bet MAKE or MISS on every flip as a ghost: three right in a row and you're back. Last two rounds are OVERDRIVE. Duel mode: two players flip at once on a split screen.`,
  durationMs: 0,
  controls: "Pick Classic or Duel, then flick up on the parrot; flick sideways to aim at the perch. Ghosts tap MAKE or MISS.",
  create: (ctx) => new ParrotFlipLauncher(ctx),
};
