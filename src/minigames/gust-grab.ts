import { drawTimerBar, drawWindStreaks, fillArena } from "../core/draw";
import type { MinigameContext, MinigameDefinition, MinigameInstance } from "../core/types";
import { dist } from "../core/vec";
import { renderActors, scoresFromActors, separateActors, spawnActors, steerActor, type Actor } from "./actors";

type LootKind = "crate" | "star" | "bolt";

interface Loot {
  kind: LootKind;
  x: number;
  y: number;
  r: number;
  vx: number;
}

const VALUE: Record<LootKind, number> = { crate: 10, star: 25, bolt: 0 };

class GustGrabGame implements MinigameInstance {
  private readonly actors: Actor[];
  private readonly loot: Loot[] = [];
  private wind = 1;
  private time = 0;
  private spawnAcc = 0;

  constructor(private readonly ctx: MinigameContext) {
    this.actors = spawnActors(ctx, ctx.height * 0.5);
  }

  update(dt: number): void {
    this.time += dt;
    if (Math.floor(this.time / 8) !== Math.floor((this.time - dt) / 8)) {
      this.wind *= -1;
    }
    this.spawnAcc += dt;
    const interval = 0.55;
    while (this.spawnAcc >= interval) {
      this.spawnAcc -= interval;
      this.spawnLoot();
    }

    for (const item of this.loot) {
      item.x += (item.vx + this.wind * 140) * dt;
      item.y += Math.sin((this.time + item.y) * 2) * 10 * dt;
    }
    this.loot.splice(
      0,
      this.loot.length,
      ...this.loot.filter((item) => item.x > -60 && item.x < this.ctx.width + 60),
    );

    for (const actor of this.actors) {
      const desired = actor.player.kind === "bot" ? this.botSteer(actor) : undefined;
      steerActor(actor, this.ctx, dt, 310, desired);
      for (let i = this.loot.length - 1; i >= 0; i -= 1) {
        const item = this.loot[i]!;
        if (dist(actor.pos, item) > actor.radius + item.r) continue;
        this.loot.splice(i, 1);
        if (item.kind === "bolt") {
          actor.stunned = 0.7;
          this.ctx.sfx.hit();
        } else {
          actor.score += VALUE[item.kind];
          this.ctx.sfx.collect();
        }
      }
    }
    separateActors(this.actors);
  }

  private spawnLoot(): void {
    const kind = this.ctx.rng.pick<LootKind>(["crate", "crate", "star", "bolt"]);
    const fromLeft = this.wind > 0;
    this.loot.push({
      kind,
      x: fromLeft ? -30 : this.ctx.width + 30,
      y: this.ctx.rng.float(80, this.ctx.height - 40),
      r: kind === "star" ? 14 : 16,
      vx: fromLeft ? this.ctx.rng.float(20, 70) : -this.ctx.rng.float(20, 70),
    });
  }

  private botSteer(actor: Actor): { x: number; y: number } {
    let best: Loot | null = null;
    let bestDist = Infinity;
    for (const item of this.loot) {
      if (item.kind === "bolt") continue;
      const d = dist(actor.pos, item);
      if (d < bestDist) {
        best = item;
        bestDist = d;
      }
    }
    for (const item of this.loot) {
      if (item.kind === "bolt" && dist(actor.pos, item) < 70) {
        return { x: actor.pos.x - item.x, y: actor.pos.y - item.y };
      }
    }
    if (!best) return { x: 0, y: 0 };
    return { x: best.x - actor.pos.x, y: best.y - actor.pos.y };
  }

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    drawWindStreaks(g, this.ctx.width, this.ctx.height, this.wind, 0.9, this.time);
    drawTimerBar(g, this.ctx.width, Math.max(0, 40 - this.time), 40);

    for (const item of this.loot) {
      g.save();
      g.translate(item.x, item.y);
      if (item.kind === "crate") {
        g.fillStyle = "#c4a484";
        g.fillRect(-14, -14, 28, 28);
        g.strokeStyle = "#5c4033";
        g.strokeRect(-14, -14, 28, 28);
      } else if (item.kind === "star") {
        g.fillStyle = "#FFE566";
        g.beginPath();
        for (let i = 0; i < 10; i += 1) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 === 0 ? 16 : 7;
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
      } else {
        g.strokeStyle = "#FFE566";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-4, -16);
        g.lineTo(6, -2);
        g.lineTo(-2, 0);
        g.lineTo(8, 16);
        g.stroke();
      }
      g.restore();
    }

    renderActors(g, this.actors);
    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    let row = 44;
    for (const actor of this.actors) {
      g.fillStyle = actor.player.color;
      g.fillText(`${actor.player.name}  ${Math.round(actor.score)}`, 48, row);
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

export const gustGrab: MinigameDefinition = {
  id: "gust-grab",
  name: "Gust Grab",
  tagline: "Loot on the wind",
  description: "Snatch crates and stars as they blow across the map. Lightning stuns you. The wind will flip — be ready.",
  durationMs: 40_000,
  controls: "Move into crates (+10) and stars (+25). Avoid lightning.",
  create: (ctx) => new GustGrabGame(ctx),
};
