import { MinigameRegistry } from "../core/registry";
import { eyeOfTheStorm } from "./eye-of-the-storm";
import { gustGrab } from "./gust-grab";
import { pressureDrop } from "./pressure-drop";
import { stormSurge } from "./storm-surge";

export const allMinigames = [stormSurge, eyeOfTheStorm, gustGrab, pressureDrop];

export function createRegistry(): MinigameRegistry {
  const registry = new MinigameRegistry();
  for (const game of allMinigames) registry.register(game);
  return registry;
}
