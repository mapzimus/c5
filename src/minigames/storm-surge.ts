import { drawTimerBar, drawWindStreaks, fillArena } from "../core/draw";
import type { MinigameDefinition, MinigameInstance, MinigameContext } from "../core/types";
import { dist } from "../core/vec";
import { renderActors, scoresFromActors, separateActors, spawnActors, steerActor, type Actor } from "./actors";

interface Debris {
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  rot: number;
  spin: number;
  color: string;
}

class StormSurgeGame implements MinigameInstance {
  private readonly actors: Actor[];
  private readonly debris: Debris[] = [];
  private wind = 0;
  private windTarget = 0;
  private time = 0;
  private spawnAcc = 0;
  private finished = false;

  constructor(private readonly ctx: MinigameContext) {
    this.actors = spawnActors(ctx, ctx.height * 0.7);
    for (const actor of this.actors) actor.score = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.spawnAcc += dt;
    if (this.time % 4 < dt) {
      this.windTarget = this.ctx.rng.float(-1, 1) * 220;
    }
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 2.2);

    const interval = Math.max(0.22, 0.7 - this.time * 0.012);
    while (this.spawnAcc >= interval) {
      this.spawnAcc -= interval;
      this.spawnDebris();
    }

    for (const hunk of this.debris) {
      hunk.y += hunk.vy * dt;
      hunk.x += this.wind * dt * 0.35;
      hunk.rot += hunk.spin * dt;
    }
    this.debris.splice(0, this.debris.length, ...this.debris.filter((hunk) => hunk.y < this.ctx.height + 80));

    for (const actor of this.actors) {
      if (!actor.alive) continue;
      const desired = actor.player.kind === "bot" ? this.botSteer(actor) : undefined;
      steerActor(actor, this.ctx, dt, 280, desired);
      actor.pos.x = Math.max(
        actor.radius + 8,
        Math.min(this.ctx.width - actor.radius - 8, actor.pos.x + this.wind * dt * 0.18),
      );
      actor.score += dt * 10;
      for (const hunk of this.debris) {
        if (this.hits(actor, hunk)) {
          actor.alive = false;
          this.ctx.sfx.hit();
          break;
        }
      }
    }
    separateActors(this.actors);
    this.finished = this.actors.every((actor) => !actor.alive);
  }

  private spawnDebris(): void {
    const w = this.ctx.rng.float(22, 54);
    const h = this.ctx.rng.float(16, 40);
    this.debris.push({
      x: this.ctx.rng.float(20, this.ctx.width - 20),
      y: -40,
      w,
      h,
      vy: this.ctx.rng.float(180, 340) + this.time * 4,
      rot: this.ctx.rng.float(0, Math.PI),
      spin: this.ctx.rng.float(-4, 4),
      color: this.ctx.rng.pick(["#8b5a2b", "#6b7280", "#334155", "#a16207"]),
    });
  }

  private hits(actor: Actor, hunk: Debris): boolean {
    const nearestX = Math.max(hunk.x - hunk.w / 2, Math.min(actor.pos.x, hunk.x + hunk.w / 2));
    const nearestY = Math.max(hunk.y - hunk.h / 2, Math.min(actor.pos.y, hunk.y + hunk.h / 2));
    return dist(actor.pos, { x: nearestX, y: nearestY }) < actor.radius - 2;
  }

  private botSteer(actor: Actor): { x: number; y: number } {
    let dangerX = 0;
    let dangerY = 0;
    for (const hunk of this.debris) {
      const d = dist(actor.pos, { x: hunk.x, y: hunk.y });
      if (d < 160 && hunk.y < actor.pos.y + 20) {
        dangerX += (actor.pos.x - hunk.x) / (d + 1);
        dangerY += (actor.pos.y - hunk.y) / (d + 1);
      }
    }
    return { x: dangerX - this.wind * 0.004, y: dangerY * 0.4 };
  }

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    drawWindStreaks(g, this.ctx.width, this.ctx.height, Math.sign(this.wind) || 1, Math.abs(this.wind) / 220, this.time);
    drawTimerBar(g, this.ctx.width, Math.max(0, 45 - this.time), 45);

    for (const hunk of this.debris) {
      g.save();
      g.translate(hunk.x, hunk.y);
      g.rotate(hunk.rot);
      g.fillStyle = hunk.color;
      g.fillRect(-hunk.w / 2, -hunk.h / 2, hunk.w, hunk.h);
      g.restore();
    }

    renderActors(g, this.actors);
    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    let row = 44;
    for (const actor of this.actors) {
      g.fillStyle = actor.alive ? actor.player.color : "#64748b";
      g.fillText(`${actor.player.name}  ${Math.round(actor.score)}`, 48, row);
      row += 20;
    }
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return scoresFromActors(this.actors);
  }

  destroy(): void {}
}

export const stormSurge: MinigameDefinition = {
  id: "storm-surge",
  name: "Storm Surge",
  tagline: "Don't get flattened",
  description: "Dodge the falling wreckage while the wind shoves you around. Last one standing — or the longest survivor — takes the crown.",
  durationMs: 45_000,
  controls: "Move to dodge debris. Wind will shove everyone sideways.",
  create: (ctx) => new StormSurgeGame(ctx),
};
