import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "../../../core/types";
import { ParrotPhysics } from "./physics";
import { FlickPointer } from "./pointer";
import { ParrotScene, preloadParrots } from "./renderer";
import {
  TOSSES_EACH,
  allDone,
  botFlick,
  dealSeats,
  nextTurnIndex,
  recordToss,
  scoresFromSeats,
  type FlipSeat,
} from "./rules";

type Phase = "ready" | "flight" | "result";

const RESULT_MS = 1200;
const HUD_INSET = 8;

class ParrotFlipGame implements MinigameInstance {
  private readonly physics: ParrotPhysics;
  private readonly scene = new ParrotScene();
  private readonly pointer: FlickPointer;
  private seats: FlipSeat[];
  private turn = 0;
  private phase: Phase = "ready";
  private result: "MAKE" | "MISS" | null = null;
  private resultTimer = 0;
  private resultAlpha = 0;
  private showGlow = false;
  private botWait = 0;
  private streak = 0;
  private done = false;

  constructor(private readonly ctx: MinigameContext) {
    this.physics = new ParrotPhysics(() => this.ctx.rng.next());
    this.seats = dealSeats(this.ctx.players.map((player) => player.id));
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
      isOnFire: this.streak >= 3,
      liquidColor: player?.color ?? "#d62828",
    });
    this.drawHud(g);
  }

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    return scoresFromSeats(this.seats);
  }

  destroy(): void {
    this.pointer.destroy();
    this.physics.destroy();
  }

  private current() {
    return this.ctx.players[this.turn];
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
    this.seats[this.turn] = recordToss(this.seats[this.turn]!, made);
    this.result = landing;
    this.showGlow = made;
    this.streak = made ? this.streak + 1 : 0;
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
    if (made) this.ctx.sfx.collect();
    else this.ctx.sfx.miss();
  }

  private advance(): void {
    this.showGlow = false;
    this.resultAlpha = 0;
    if (allDone(this.seats)) {
      this.done = true;
      this.pointer.disable();
      return;
    }
    const next = nextTurnIndex(this.seats, this.turn);
    if (next < 0) {
      this.done = true;
      this.pointer.disable();
      return;
    }
    if (next !== this.turn) this.streak = 0;
    this.turn = next;
    this.beginTurn();
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const player = this.current();
    const seat = this.seats[this.turn];
    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    g.fillStyle = "#94a3b8";
    g.fillText(`Parrot Flip  ·  ${TOSSES_EACH} tosses each`, 40, 28);
    g.font = "700 26px Bebas Neue, sans-serif";
    g.fillStyle = player?.color ?? "#F4F7FB";
    const remain = seat ? Math.max(0, TOSSES_EACH - seat.tosses) : 0;
    let hint = "";
    if (this.phase === "ready" && player?.kind === "human") hint = "  ·  Flick UP";
    if (this.phase === "ready" && player?.kind === "bot") hint = "  ·  lining up…";
    g.fillText(`${player?.name ?? "Player"}'s toss (${remain} left)${hint}`, 40, 54);

    this.ctx.players.forEach((seatPlayer, index) => {
      const row = this.seats[index];
      const x = 40 + index * 220;
      g.fillStyle = index === this.turn ? seatPlayer.color : "#64748b";
      g.font = "600 16px Outfit, sans-serif";
      g.fillText(`${seatPlayer.name}  ${row?.makes ?? 0} make · ${row?.tosses ?? 0}/${TOSSES_EACH}`, x, 82);
    });
  }
}

export const parrotFlip: MinigameDefinition = {
  id: "parrot-flip",
  name: "Parrot Flip",
  tagline: "Flick the pirate parrot upright.",
  description: "Take turns flicking a pirate macaw. Land it standing for a make. Four tosses each — most makes wins.",
  durationMs: 0,
  controls: "Flick up on the parrot. Harder snap = more spin.",
  create: (ctx) => new ParrotFlipGame(ctx),
};
