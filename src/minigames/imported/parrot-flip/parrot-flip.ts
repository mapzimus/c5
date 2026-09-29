import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "../../../core/types";
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
  scoresFromTable,
  suddenDeathLevel,
  type FlipOutcome,
  type FlipTable,
} from "./rules";

type Phase = "ready" | "flight" | "result";

const RESULT_MS = 1200;
const HUD_INSET = 8;

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

  constructor(private readonly ctx: MinigameContext) {
    this.physics = new ParrotPhysics(() => this.ctx.rng.next());
    this.table = dealTable(this.ctx.players.map((player) => player.id));
    preloadParrots(this.ctx.players.map((player) => player.color));
    this.physics.init(GAME_WIDTH, GAME_HEIGHT, HUD_INSET);
    this.physics.setSideWalls(true);
    this.pointer = new FlickPointer(this.ctx.canvas, { w: GAME_WIDTH, h: GAME_HEIGHT }, (vx, vy) => {
      this.tryFlick(vx, vy);
    });
    this.beginTurn();
  }

  update(dt: number): void {
    if (this.done) return;

    const botShot = this.phase === "flight" && this.current()?.kind === "bot";
    this.physics.step(dt);
    if (botShot) this.physics.step(dt);

    if (this.phase === "flight") {
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
    this.scene.frame(g, 1 / 60, GAME_WIDTH, GAME_HEIGHT, {
      bottle: this.physics.getBottle(),
      liquid: this.physics.liquid,
      groundY: this.physics.getGroundY(),
      drag: this.phase === "ready" ? this.pointer.getDrag() : null,
      result: this.phase === "result" ? this.result : null,
      resultAlpha: this.resultAlpha,
      showGlow: this.showGlow,
      isOnFire: !!this.table.seats[this.table.turn]?.onFire,
      liquidColor: player?.color ?? "#d62828",
    });
    this.drawHud(g);
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
    this.physics.resetBottle();
    const player = this.current();
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
    this.ctx.sfx.hit();
  }

  private resolve(landing: "MAKE" | "MISS"): void {
    const made = landing === "MAKE";
    this.lastOutcome = resolveFlip(this.table, made);
    this.result = landing;
    this.showGlow = made;
    this.phase = "result";
    this.resultTimer = RESULT_MS;
    this.resultAlpha = 0;
    const bottle = this.physics.getBottle();
    if (bottle) {
      this.scene.kick(
        landing,
        bottle.position.x,
        bottle.position.y,
        this.current()?.color ?? "#69f0ae",
        made && !!this.physics.getLastLandingInfo()?.perfect,
      );
    }
    const outcome = this.lastOutcome;
    if (outcome.justIgnited) this.ctx.sfx.streak(3);
    else if (made) this.ctx.sfx.collect();
    else if (outcome.eliminated) this.ctx.sfx.hit();
    else this.ctx.sfx.miss();
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
