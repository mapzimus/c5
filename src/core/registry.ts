import type { GameDefinition } from "./types";

export class GameRegistry {
  private readonly games = new Map<string, GameDefinition>();

  register(game: GameDefinition): void {
    if (this.games.has(game.id)) {
      throw new Error(`Game already registered: ${game.id}`);
    }
    this.games.set(game.id, game);
  }

  get(id: string): GameDefinition {
    const game = this.games.get(id);
    if (!game) throw new Error(`Unknown game: ${id}`);
    return game;
  }

  list(): GameDefinition[] {
    return [...this.games.values()];
  }

  ids(): string[] {
    return [...this.games.keys()];
  }
}
