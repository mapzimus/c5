import { MinigameRegistry } from "../core/registry";
import type { MinigameDefinition } from "../core/types";
import { pairs } from "./pairs";
import { parrotFlip } from "./imported/parrot-flip/parrot-flip";

/** Playable games. Add an export here and a card appears on the main menu. */
export const allMinigames: MinigameDefinition[] = [pairs, parrotFlip];

export function createRegistry(): MinigameRegistry {
  const registry = new MinigameRegistry();
  for (const game of allMinigames) registry.register(game);
  return registry;
}
