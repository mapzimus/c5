import type { MinigameContext } from "../core/types";
import type { Player } from "../core/types";
import { clamp, dist, type Vec } from "../core/vec";
import { drawPlayerOrb } from "../core/draw";

export interface Actor {
  player: Player;
  pos: Vec;
  vel: Vec;
  radius: number;
  stunned: number;
  alive: boolean;
  score: number;
}

export function spawnActors(ctx: MinigameContext, y = ctx.height * 0.62): Actor[] {
  const gap = ctx.width / (ctx.players.length + 1);
  return ctx.players.map((player, index) => ({
    player,
    pos: { x: gap * (index + 1), y },
    vel: { x: 0, y: 0 },
    radius: 22,
    stunned: 0,
    alive: true,
    score: 0,
  }));
}

export function steerActor(
  actor: Actor,
  ctx: MinigameContext,
  dt: number,
  speed: number,
  desired?: { x: number; y: number },
): void {
  if (!actor.alive) return;
  actor.stunned = Math.max(0, actor.stunned - dt);
  if (actor.stunned > 0) return;

  let axis = desired ?? { x: 0, y: 0 };
  if (actor.player.kind === "human") {
    axis = ctx.input.axis(actor.player.slot);
  }

  const mag = Math.hypot(axis.x, axis.y);
  if (mag > 0) {
    axis = { x: axis.x / mag, y: axis.y / mag };
  }
  actor.vel.x = axis.x * speed;
  actor.vel.y = axis.y * speed;
  actor.pos.x = clamp(actor.pos.x + actor.vel.x * dt, actor.radius + 8, ctx.width - actor.radius - 8);
  actor.pos.y = clamp(actor.pos.y + actor.vel.y * dt, actor.radius + 36, ctx.height - actor.radius - 8);
}

export function separateActors(actors: Actor[], padding = 2): void {
  for (let i = 0; i < actors.length; i += 1) {
    for (let j = i + 1; j < actors.length; j += 1) {
      const a = actors[i]!;
      const b = actors[j]!;
      if (!a.alive || !b.alive) continue;
      const d = dist(a.pos, b.pos);
      const min = a.radius + b.radius + padding;
      if (d === 0 || d >= min) continue;
      const push = (min - d) / 2;
      const nx = (b.pos.x - a.pos.x) / d;
      const ny = (b.pos.y - a.pos.y) / d;
      a.pos.x -= nx * push;
      a.pos.y -= ny * push;
      b.pos.x += nx * push;
      b.pos.y += ny * push;
    }
  }
}

export function renderActors(ctx: CanvasRenderingContext2D, actors: Actor[]): void {
  for (const actor of actors) {
    if (!actor.alive) continue;
    drawPlayerOrb(ctx, actor.pos.x, actor.pos.y, actor.radius, actor.player, {
      stunned: actor.stunned > 0,
    });
  }
}

export function scoresFromActors(actors: Actor[]): { playerId: string; score: number }[] {
  return actors.map((actor) => ({ playerId: actor.player.id, score: Math.round(actor.score) }));
}
