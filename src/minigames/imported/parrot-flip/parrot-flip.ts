import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "../../../core/types";
import { Callouts, Juice, loadBest, saveBest } from "../../../fx/juice";
import { ParrotPhysics } from "./physics";
import { FlickPointer } from "./pointer";
import { ParrotScene, preloadParrots } from "./renderer";
import {
  STARTING_LIVES,
  advanceTurn,
  botFlick,
  dealTable,
  isOver,
  missWouldEliminate,
  resolveFlip,
  rollGolden,
  scoresFromTable,
  suddenDeathLevel,
  type FlipOutcome,
  type FlipTable,
} from "./rules";

type Phase = "ready" | "flight" | "result";

const RESULT_MS = 1200;
const HUD_INSET = 8;
const GOLD = "#f2c14e";
const FLAMES = ["#ff3d00", "#ff6d00", "#ff9100", "#ffd600"];
const BEST_KEY = "parrot-flip-fire";
/** Start the make-or-break slow-mo when the falling parrot is this close to the ground. */
const DRAMA_SLOWMO_PX = 240;

class ParrotFlipGame implements MinigameInstance {
  private readonly physics: ParrotPhysics;
  private readonly scene = new ParrotScene();
  private readonly pointer: FlickPointer;
  private readonly table: FlipTable;
  private lastOutcome: FlipOutcome | null = null;
  private phase: Phase = "ready";
  private result: "MAKE" | "MISS" | null = null;
  private resultTimer = 0;
  private resultAlpha = 0;
  private showGlow = false;
  private botWait = 0;
  private done = false;
  private readonly juice = new Juice();
  private readonly callouts = new Callouts();
  /** This flick rolled a golden flip (1 in 150, like flipgame). */
  private golden = false;
  /** A miss on this flip knocks the flipper out. */
  private dramatic = false;
  private slowMoFired = false;
  /** Lives gained in the current ON FIRE run (humans only count toward the best). */
  private fireRun = 0;
  private bestFire = loadBest(BEST_KEY);
  private bestAnnounced = false;

  constructor(private readonly ctx: MinigameContext) {
    this.physics = new ParrotPhysics(() => this.ctx.rng.next());
    this.table = dealTable(this.ctx.players.map((player) => player.id));
    preloadParrots([...this.ctx.players.map((player) => player.color), GOLD]);
    this.physics.init(GAME_WIDTH, GAME_HEIGHT, HUD_INSET);
    this.physics.setSideWalls(true);
    this.pointer = new FlickPointer(this.ctx.canvas, { w: GAME_WIDTH, h: GAME_HEIGHT }, (vx, vy) => {
      this.tryFlick(vx, vy);
    });
    this.beginTurn();
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    if (this.done) return;

    const botShot = this.phase === "flight" && this.current()?.kind === "bot";
    this.physics.step(dt);
    if (botShot) this.physics.step(dt);

    if (this.phase === "flight") {
      this.maybeSlowMo();
      const landing = this.physics.checkLanding();
      if (landing) this.resolve(landing);
      return;
    }

    if (this.phase === "result") {
      const speed = this.current()?.kind === "bot" ? 2 : 1;
      this.resultTimer -= dt * 1000 * speed;
      if (this.resultTimer > RESULT_MS - 280) this.resultAlpha = (RESULT_MS - this.resultTimer) / 280;
      else if (this.resultTimer < 320) this.resultAlpha = this.resultTimer / 320;
      else this.resultAlpha = 1;
      if (this.resultTimer <= 0) this.advance();
      return;
    }

    const player = this.current();
    if (!player) return;
    if (player.kind === "bot") {
      this.botWait -= dt;
      if (this.botWait <= 0) {
        const flick = botFlick(this.ctx.rng);
        this.tryFlick(flick.vx, flick.vy);
      }
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const player = this.current();
    this.juice.begin(g);
    this.scene.frame(g, 1 / 60, GAME_WIDTH, GAME_HEIGHT, {
      bottle: this.physics.getBottle(),
      liquid: this.physics.liquid,
      groundY: this.physics.getGroundY(),
      drag: this.phase === "ready" ? this.pointer.getDrag() : null,
      result: this.phase === "result" ? this.result : null,
      resultAlpha: this.resultAlpha,
      showGlow: this.showGlow,
      isOnFire: !!this.table.seats[this.table.turn]?.onFire,
      liquidColor: this.golden ? GOLD : (player?.color ?? "#d62828"),
      golden: this.golden,
    });
    this.juice.end(g);
    this.drawHud(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    return scoresFromTable(this.table);
  }

  destroy(): void {
    this.pointer.destroy();
    this.physics.destroy();
  }

  private current() {
    return this.ctx.players[this.table.turn];
  }

  private beginTurn(): void {
    this.phase = "ready";
    this.result = null;
    this.resultAlpha = 0;
    this.showGlow = false;
    this.golden = false;
    this.slowMoFired = false;
    this.physics.resetBottle();
    const player = this.current();
    this.dramatic = missWouldEliminate(this.table);
    if (this.dramatic) {
      this.callouts.show("MAKE IT OR YOU'RE OUT", "#FF3D7A", { life: 1.8, y: 0.2, size: 58 });
      this.ctx.sfx.tick();
    }
    if (player?.kind === "bot") {
      this.pointer.disable();
      this.botWait = 0.45 + this.ctx.rng.float(0, 0.25);
    } else {
      this.pointer.enable();
      this.botWait = 0.55;
    }
  }

  private tryFlick(vx: number, vy: number): void {
    if (this.phase !== "ready" || this.done) return;
    this.pointer.disable();
    this.physics.applyFlick(vx, vy);
    this.phase = "flight";
    this.golden = rollGolden(this.ctx.rng);
    this.ctx.sfx.hit();
    if (this.golden) {
      this.callouts.show("GOLDEN FLIP", GOLD, { life: 1.1, y: 0.2, size: 56 });
      this.ctx.sfx.streak(2);
    }
  }

  private resolve(landing: "MAKE" | "MISS"): void {
    const made = landing === "MAKE";
    const seat = this.table.seats[this.table.turn];
    const wasOnFire = !!seat?.onFire;
    this.lastOutcome = resolveFlip(this.table, made, { golden: this.golden });
    this.result = landing;
    this.showGlow = made;
    this.phase = "result";
    this.resultTimer = RESULT_MS;
    this.resultAlpha = 0;
    const perfect = made && !!this.physics.getLastLandingInfo()?.perfect;
    const bottle = this.physics.getBottle();
    const x = bottle?.position.x ?? GAME_WIDTH / 2;
    const y = (bottle?.position.y ?? GAME_HEIGHT * 0.7) - 40;
    if (bottle) {
      this.scene.kick(landing, bottle.position.x, bottle.position.y, this.current()?.color ?? "#69f0ae", perfect);
    }
    const outcome = this.lastOutcome;
    this.juiceResult(outcome, perfect, wasOnFire, x, y);
    if (outcome.justIgnited) this.ctx.sfx.streak(3);
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

  private juiceResult(o: FlipOutcome, perfect: boolean, wasOnFire: boolean, x: number, y: number): void {
    const player = this.current();
    const color = player?.color ?? "#69f0ae";

    if (o.made) {
      this.juice.burst(x, y, [color, "#ffffff"], { count: 18, speed: 260, angle: -Math.PI / 2, spread: 2.4 });
      this.juice.shake(0.12);
      if (perfect) {
        this.juice.burst(x, y, [color, "#ffffff", "#B8FF3D"], { count: 36, speed: 460, size: 5 });
        this.juice.shake(0.2);
        this.juice.hitStop(0.05);
        this.callouts.show("PERFECT", "#7DF9FF", { life: 1, y: 0.2, size: 60 });
      }
      if (o.golden) {
        this.juice.burst(x, y, [GOLD, "#fff3b0", "#ffffff"], { count: 50, speed: 520, size: 5 });
        this.juice.shake(0.3);
        this.callouts.show(wasOnFire ? "GOLDEN! +2 LIVES" : "GOLDEN! STAKE +2", GOLD, { life: 1.3, y: 0.13, size: 50 });
      }
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
        this.juice.burst(x, y, ["#B8FF3D", "#ffffff", color], { count: 60, speed: 600, size: 6 });
        this.juice.shake(0.6);
        this.callouts.show("STILL ALIVE!", "#B8FF3D", { life: 1.4, y: 0.13, size: 54 });
      } else {
        this.juice.burst(x, y, ["#FF3D7A", "#64748b", "#ffffff"], { count: 60, speed: 600, size: 6 });
      }
    }

    if (o.eliminated) {
      this.juice.shake(1);
      this.juice.hitStop(0.14);
      this.juice.burst(x, y, ["#FF3D7A", "#94a3b8"], { count: 40, speed: 420, size: 5 });
    }

    // Personal best: longest ON FIRE run (lives gained), humans only.
    if (o.fireGain > 0 && player?.kind === "human") {
      this.fireRun += o.fireGain;
      if (this.fireRun > this.bestFire) {
        const hadBest = this.bestFire > 0;
        this.bestFire = this.fireRun;
        saveBest(BEST_KEY, this.fireRun);
        if (!this.bestAnnounced && hadBest) {
          this.bestAnnounced = true;
          this.callouts.show("NEW BEST!", "#FFD600", { life: 1.4, y: 0.5, size: 64 });
          this.ctx.sfx.win();
        }
      }
    }
    if (o.fireEnded || (wasOnFire && !this.table.seats[this.table.turn]?.onFire)) {
      this.fireRun = 0;
      this.bestAnnounced = false;
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
    advanceTurn(this.table);
    this.lastOutcome = null;
    this.beginTurn();
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { table } = this;
    const player = this.current();
    const seat = table.seats[table.turn];
    const sd = suddenDeathLevel(table.flips + 1);

    g.textAlign = "left";
    g.font = "600 16px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText(sd ? `SUDDEN DEATH ${sd}  ·  misses cost +${sd}` : `Parrot Flip  ·  last one standing`, 40, 28);

    g.font = "700 26px Bebas Neue, sans-serif";
    g.fillStyle = player?.color ?? "#F4F7FB";
    let status = "";
    if (seat?.onFire) status = "  ·  ON FIRE: makes +1 life, miss is free";
    else if (seat?.heatingUp) status = "  ·  Heating up";
    let hint = "";
    if (this.phase === "ready" && player?.kind === "human") hint = "  ·  Flick UP";
    if (this.phase === "ready" && player?.kind === "bot") hint = "  ·  lining up…";
    g.fillText(`${player?.name ?? "Player"}'s flip${status}${hint}`, 40, 54);

    // Stake: what the current flipper loses on a miss.
    g.textAlign = "right";
    g.font = "700 44px Bebas Neue, sans-serif";
    const risk = seat?.onFire ? sd : table.stake + sd;
    g.fillStyle = missWouldEliminate(table) ? "#FF3D7A" : "#FFB020";
    g.fillText(`STAKE ${risk}`, GAME_WIDTH - 40, 50);
    g.font = "600 14px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText(missWouldEliminate(table) ? "make it or you're out" : "lives lost on a miss", GAME_WIDTH - 40, 70);

    g.font = "600 14px Outfit, sans-serif";
    g.fillStyle = "#FFB020";
    const runBit = seat?.onFire && player?.kind === "human" ? `Fire run +${this.fireRun}  ·  ` : "";
    g.fillText(`${runBit}Best fire run +${this.bestFire}`, GAME_WIDTH - 40, 112);

    const o = this.lastOutcome;
    if (this.phase === "result" && o) {
      let line = "";
      if (o.eliminated) line = `${player?.name ?? "Player"} is OUT`;
      else if (o.justIgnited) line = "ON FIRE!";
      else if (o.fireGain > 0) line = `+${o.fireGain} life`;
      else if (o.fireEnded) line = "Fire's out. No penalty.";
      else if (o.penalty > 0) line = `-${o.penalty} ${o.penalty === 1 ? "life" : "lives"}`;
      else if (o.made) line = `Stake up to ${table.stake}`;
      if (line) {
        g.globalAlpha = this.resultAlpha;
        g.textAlign = "center";
        g.font = "700 40px Bebas Neue, sans-serif";
        g.fillStyle = o.made ? "#B8FF3D" : "#FF3D7A";
        g.fillText(line, GAME_WIDTH / 2, GAME_HEIGHT * 0.3);
        g.globalAlpha = 1;
      }
    }

    g.textAlign = "left";
    this.ctx.players.forEach((seatPlayer, index) => {
      const row = table.seats[index];
      const x = 40 + index * 220;
      g.globalAlpha = row?.eliminated ? 0.35 : 1;
      g.fillStyle = index === table.turn ? seatPlayer.color : "#64748b";
      g.font = "600 16px Outfit, sans-serif";
      const tag = row?.eliminated ? "OUT" : row?.onFire ? "🔥" : row?.heatingUp ? "♨" : "";
      g.fillText(`${seatPlayer.name}  ${"♥".repeat(Math.min(row?.lives ?? 0, 10))}${(row?.lives ?? 0) > 10 ? `+${row!.lives - 10}` : ""} ${tag}`, x, 90);
      g.globalAlpha = 1;
    });
  }
}

export const parrotFlip: MinigameDefinition = {
  id: "parrot-flip",
  name: "Parrot Flip",
  tagline: "Flick the pirate parrot upright.",
  description: `Real bottle-game rules. ${STARTING_LIVES} lives each. Every make raises the shared stake; miss and you lose that many lives. Three in a row = ON FIRE: keep flipping for bonus lives, miss for free. Last one standing wins.`,
  durationMs: 0,
  controls: "Flick up on the parrot. Harder snap = more spin.",
  create: (ctx) => new ParrotFlipGame(ctx),
};
