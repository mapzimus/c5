import { drawTimerBar, fillArena } from "../core/draw";
import type { MinigameContext, MinigameDefinition, MinigameInstance } from "../core/types";
import { clamp, dist } from "../core/vec";
import { renderActors, scoresFromActors, separateActors, spawnActors, steerActor, type Actor } from "./actors";

class EyeOfTheStormGame implements MinigameInstance {
  private readonly actors: Actor[];
  private eye = { x: 640, y: 360, vx: 90, vy: 40, r: 170 };
  private time = 0;

  constructor(private readonly ctx: MinigameContext) {
    this.actors = spawnActors(ctx, ctx.height * 0.55);
    this.eye.x = ctx.width / 2;
    this.eye.y = ctx.height / 2;
    this.eye.vx = ctx.rng.float(70, 130) * ctx.rng.sign();
    this.eye.vy = ctx.rng.float(50, 110) * ctx.rng.sign();
  }

  update(dt: number): void {
    this.time += dt;
    this.eye.r = clamp(170 - this.time * 2.2, 72, 170);
    if (this.ctx.rng.next() < dt * 0.35) {
      this.eye.vx += this.ctx.rng.float(-80, 80);
      this.eye.vy += this.ctx.rng.float(-80, 80);
    }
    this.eye.x += this.eye.vx * dt;
    this.eye.y += this.eye.vy * dt;
    if (this.eye.x < 120 || this.eye.x > this.ctx.width - 120) this.eye.vx *= -1;
    if (this.eye.y < 120 || this.eye.y > this.ctx.height - 100) this.eye.vy *= -1;
    this.eye.x = clamp(this.eye.x, 120, this.ctx.width - 120);
    this.eye.y = clamp(this.eye.y, 120, this.ctx.height - 100);

    for (const actor of this.actors) {
      const desired = actor.player.kind === "bot" ? this.botSteer(actor) : undefined;
      steerActor(actor, this.ctx, dt, 300, desired);
      if (dist(actor.pos, this.eye) < this.eye.r - 8) {
        actor.score += dt * 12;
      }
    }
    separateActors(this.actors);
  }

  private botSteer(actor: Actor): { x: number; y: number } {
    return { x: this.eye.x - actor.pos.x, y: this.eye.y - actor.pos.y };
  }

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    drawTimerBar(g, this.ctx.width, Math.max(0, 40 - this.time), 40);

    const swirl = g.createRadialGradient(this.eye.x, this.eye.y, 8, this.eye.x, this.eye.y, this.eye.r * 2.1);
    swirl.addColorStop(0, "rgba(12, 24, 40, 0.15)");
    swirl.addColorStop(0.35, "rgba(62, 224, 255, 0.08)");
    swirl.addColorStop(0.7, "rgba(255, 61, 122, 0.16)");
    swirl.addColorStop(1, "rgba(7, 11, 20, 0.55)");
    g.fillStyle = swirl;
    g.fillRect(0, 0, this.ctx.width, this.ctx.height);

    g.beginPath();
    g.strokeStyle = "rgba(244,247,251,0.75)";
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.arc(this.eye.x, this.eye.y, this.eye.r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.fillStyle = "rgba(244,247,251,0.08)";
    g.arc(this.eye.x, this.eye.y, this.eye.r, 0, Math.PI * 2);
    g.fill();

    renderActors(g, this.actors);

    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    let row = 44;
    for (const actor of this.actors) {
      const inside = dist(actor.pos, this.eye) < this.eye.r - 8;
      g.fillStyle = actor.player.color;
      g.fillText(`${actor.player.name}  ${Math.round(actor.score)}${inside ? "  ●" : ""}`, 48, row);
      row += 20;
    }
  }

  isFinished(): boolean {
    return false;
  }

  getScores(): { playerId: string; score: number }[] {
    return scoresFromActors(this.actors);
  }

  destroy(): void {}
}

export const eyeOfTheStorm: MinigameDefinition = {
  id: "eye-of-the-storm",
  name: "Eye of the Storm",
  tagline: "Stay in the calm",
  description: "The safe eye drifts and shrinks. Camp inside it to score. Get greedy on the edge and the wall will spit you out.",
  durationMs: 40_000,
  controls: "Move to stay inside the glowing ring.",
  create: (ctx) => new EyeOfTheStormGame(ctx),
};
