import { MinigameRegistry } from "../core/registry";
import type { MinigameDefinition } from "../core/types";
import { pairs } from "./pairs";
import { castleSiege } from "./castle-siege/castle-siege";
import { parrotFlip } from "./imported/parrot-flip/parrot-flip";
import { luckyDrop } from "./imported/lucky-drop/lucky-drop";

/** Playable games. Add an export here and a card appears on the main menu. */
export const allMinigames: MinigameDefinition[] = [pairs, parrotFlip, castleSiege, luckyDrop];

export function createRegistry(): MinigameRegistry {
  const registry = new MinigameRegistry();
  for (const game of allMinigames) registry.register(game);
  return registry;
}
