import { drawTimerBar, fillArena } from "../core/draw";
import type { MinigameContext, MinigameDefinition, MinigameInstance } from "../core/types";
import { clamp } from "../core/vec";
import { scoresFromActors, spawnActors, type Actor } from "./actors";
import { drawPlayerOrb } from "../core/draw";

class PressureDropGame implements MinigameInstance {
  private readonly actors: Actor[];
  private needle = 0.2;
  private vel = 0.8;
  private time = 0;
  private readonly lockout: number[];
  private readonly flashes: number[];
  private readonly botDelay: number[];

  constructor(private readonly ctx: MinigameContext) {
    this.actors = spawnActors(ctx);
    this.lockout = this.actors.map(() => 0);
    this.flashes = this.actors.map(() => 0);
    this.botDelay = this.actors.map((actor) => (actor.player.kind === "bot" ? ctx.rng.float(0.08, 0.22) : 0));
  }

  private inZone(): boolean {
    return this.needle >= 0.78 && this.needle <= 0.92;
  }

  update(dt: number): void {
    this.time += dt;
    this.vel += this.ctx.rng.float(-2.8, 2.8) * dt * 6;
    this.vel = clamp(this.vel, -1.6, 1.6);
    this.needle += this.vel * dt * 0.55;
    if (this.needle < 0.05 || this.needle > 0.98) {
      this.vel *= -1;
      this.needle = clamp(this.needle, 0.05, 0.98);
    }

    for (let i = 0; i < this.actors.length; i += 1) {
      const actor = this.actors[i]!;
      this.lockout[i] = Math.max(0, (this.lockout[i] ?? 0) - dt);
      this.flashes[i] = Math.max(0, (this.flashes[i] ?? 0) - dt);

      let pressed = false;
      if (actor.player.kind === "human") {
        pressed = this.ctx.input.actionPressed(actor.player.slot);
      } else if (this.inZone() && (this.lockout[i] ?? 0) <= 0) {
        this.botDelay[i] = (this.botDelay[i] ?? 0) - dt;
        if ((this.botDelay[i] ?? 0) <= 0) {
          pressed = true;
          this.botDelay[i] = this.ctx.rng.float(0.12, 0.28);
        }
      }

      if (!pressed || (this.lockout[i] ?? 0) > 0) continue;
      if (this.inZone()) {
        actor.score += 1;
        this.flashes[i] = 0.25;
        this.lockout[i] = 0.28;
        this.ctx.sfx.collect();
      } else {
        this.lockout[i] = 0.7;
        this.flashes[i] = 0.2;
        this.ctx.sfx.miss();
      }
    }
  }

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    drawTimerBar(g, this.ctx.width, Math.max(0, 25 - this.time), 25);

    const cx = this.ctx.width / 2;
    const cy = this.ctx.height / 2 - 20;
    const radius = 210;

    g.beginPath();
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.arc(cx, cy, radius + 18, 0, Math.PI * 2);
    g.fill();

    g.lineWidth = 26;
    g.beginPath();
    g.strokeStyle = "#1e293b";
    g.arc(cx, cy, radius, Math.PI * 0.85, Math.PI * 0.15);
    g.stroke();
    g.beginPath();
    g.strokeStyle = "#FF3D7A";
    g.arc(cx, cy, radius, Math.PI * (0.85 + 0.78 * 1.3), Math.PI * (0.85 + 0.92 * 1.3));
    g.stroke();

    const angle = Math.PI * 0.85 + this.needle * Math.PI * 1.3;
    g.strokeStyle = this.inZone() ? "#FFE566" : "#F4F7FB";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(angle) * (radius - 16), cy + Math.sin(angle) * (radius - 16));
    g.stroke();
    g.beginPath();
    g.fillStyle = "#3EE0FF";
    g.arc(cx, cy, 10, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = this.inZone() ? "#FFE566" : "#94a3b8";
    g.font = "700 42px Bebas Neue, sans-serif";
    g.textAlign = "center";
    g.fillText(this.inZone() ? "CATEGORY 5 — HIT IT" : "WAIT", cx, cy + 70);

    const gap = this.ctx.width / (this.actors.length + 1);
    this.actors.forEach((actor, i) => {
      const x = gap * (i + 1);
      const y = this.ctx.height - 92;
      drawPlayerOrb(g, x, y, 26, actor.player, { stunned: (this.lockout[i] ?? 0) > 0.3 });
      g.fillStyle = (this.flashes[i] ?? 0) > 0 && this.inZone() ? "#FFE566" : actor.player.color;
      g.font = "700 28px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.fillText(String(actor.score), x, y + 52);
      g.font = "500 13px Outfit, sans-serif";
      g.fillStyle = "#cbd5e1";
      g.fillText(actor.player.name, x, y + 70);
    });
  }

  isFinished(): boolean {
    return false;
  }

  getScores(): { playerId: string; score: number }[] {
    return scoresFromActors(this.actors);
  }

  destroy(): void {}
}

export const pressureDrop: MinigameDefinition = {
  id: "pressure-drop",
  name: "Pressure Drop",
  tagline: "Smash the red zone",
  description: "The barometer is possessed. Slap the action button only when the needle kisses Category 5. Early swings lock you out.",
  durationMs: 25_000,
  controls: "Action when the needle is in the red band. Don't mash.",
  create: (ctx) => new PressureDropGame(ctx),
};
