import { fillArena } from "../core/draw";
import type { MinigameContext, MinigameDefinition, MinigameInstance } from "../core/types";

/**
 * Copy this file, rename it, then add the export to `allMinigames` in index.ts.
 * The template is not registered and will not show up in the hub.
 */
export const yourGame: MinigameDefinition = {
  id: "your-game",
  name: "Your game",
  tagline: "One line pitch",
  description: "What happens, how you win, why it's chaotic.",
  durationMs: 30_000,
  controls: "Move / action",
  create: (ctx) => new YourGame(ctx),
};

class YourGame implements MinigameInstance {
  constructor(private readonly ctx: MinigameContext) {}

  update(_dt: number): void {}

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
  }

  isFinished(): boolean {
    return false;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((player) => ({ playerId: player.id, score: 0 }));
  }

  destroy(): void {}
}
