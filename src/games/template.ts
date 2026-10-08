import { fillArena } from "../core/draw";
import type { GameContext, GameDefinition, GameInstance } from "../core/types";

/**
 * Copy this file, rename it, then add the export to `allGames` in index.ts.
 * The template is not registered and will not show up in the hub.
 */
export const yourGame: GameDefinition = {
  id: "your-game",
  name: "Your game",
  tagline: "One line pitch",
  description: "What happens, how you win, why it's chaotic.",
  durationMs: 30_000,
  controls: "Move / action",
  create: (ctx) => new YourGame(ctx),
};

class YourGame implements GameInstance {
  constructor(private readonly ctx: GameContext) {}

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
