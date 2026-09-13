import type { MinigameDefinition } from "./types";

export class MinigameRegistry {
  private readonly games = new Map<string, MinigameDefinition>();

  register(game: MinigameDefinition): void {
    if (this.games.has(game.id)) {
      throw new Error(`Minigame already registered: ${game.id}`);
    }
    this.games.set(game.id, game);
  }

  get(id: string): MinigameDefinition {
    const game = this.games.get(id);
    if (!game) throw new Error(`Unknown minigame: ${id}`);
    return game;
  }

  list(): MinigameDefinition[] {
    return [...this.games.values()];
  }

  ids(): string[] {
    return [...this.games.keys()];
  }
}
