import { GameRegistry } from "../core/registry";
import type { GameDefinition } from "../core/types";
import { pairs } from "./pairs";
import { castleSiege } from "./castle-siege/castle-siege";
import { parrotFlip } from "./imported/parrot-flip/parrot-flip";
import { luckyDrop } from "./imported/lucky-drop/lucky-drop";
import { eyeOfTheStorm } from "./eye-of-the-storm/eye-of-the-storm";
import { bootyHaul } from "./imported/booty-haul/booty-haul";
import { chaosDerby } from "./chaos-derby/chaos-derby";
import { bugWars } from "./imported/bug-wars/bug-wars";
import { kaboomIsle } from "./kaboom-isle/kaboom-isle";
import { nerve } from "./nerve/nerve";
import { fling } from "./fling/fling";
import { whack } from "./whack/whack";
import { flappyRace } from "./flappy/flappy";
import { connectFour } from "./connect-four/connect-four";
import { curveClash } from "./curve-clash/curve-clash";
import { towerTopple } from "./tower-topple/tower-topple";
import { quickDraw } from "./quick-draw/quick-draw";
import { ropeSkip } from "./rope-skip/rope-skip";
import { hungryHoppers } from "./hungry-hoppers/hungry-hoppers";

/** Playable games. Add an export here and a card appears on the main menu. */
export const allGames: GameDefinition[] = [pairs, parrotFlip, castleSiege, luckyDrop, eyeOfTheStorm, bootyHaul, chaosDerby, bugWars, kaboomIsle, nerve, fling, whack, flappyRace, connectFour, curveClash, towerTopple, quickDraw, ropeSkip, hungryHoppers];

export function createRegistry(): GameRegistry {
  const registry = new GameRegistry();
  for (const game of allGames) registry.register(game);
  return registry;
}
