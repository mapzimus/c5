import { MinigameRegistry } from "../core/registry";
import type { MinigameDefinition } from "../core/types";
import { pairs } from "./pairs";
import { castleSiege } from "./castle-siege/castle-siege";
import { parrotFlip } from "./imported/parrot-flip/parrot-flip";
import { luckyDrop } from "./imported/lucky-drop/lucky-drop";
import { eyeOfTheStorm } from "./eye-of-the-storm/eye-of-the-storm";
import { bootyHaul } from "./imported/booty-haul/booty-haul";
import { chaosDerby } from "./chaos-derby/chaos-derby";

/** Playable games. Add an export here and a card appears on the main menu. */
export const allMinigames: MinigameDefinition[] = [pairs, parrotFlip, castleSiege, luckyDrop, eyeOfTheStorm, bootyHaul, chaosDerby];

export function createRegistry(): MinigameRegistry {
  const registry = new MinigameRegistry();
  for (const game of allMinigames) registry.register(game);
  return registry;
}
