import { MinigameRegistry } from "../core/registry";
import type { MinigameDefinition } from "../core/types";

/** Playable games you write or import. Leave empty until a game is ready. */
export const allMinigames: MinigameDefinition[] = [];

export function createRegistry(): MinigameRegistry {
  const registry = new MinigameRegistry();
  for (const game of allMinigames) registry.register(game);
  return registry;
}
