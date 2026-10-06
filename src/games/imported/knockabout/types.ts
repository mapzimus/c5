import type { Vec } from "../../../core/vec";

export interface Disc {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseR: number;
  mass: number;
  baseMass: number;
  /** Who last launched this disc (for KO credit). null = nobody yet. */
  inst: number | null;
  aim: Aim | null;
  /** Pointer ID currently dragging this disc, or null. */
  grab: number | null;
  falling: boolean;
  fallT: number;
  dead: boolean;
  /** 0..1 spawn animation progress. */
  spawnT: number;
  /** Direction the eyes face (radians). */
  look: number;
  /** Turns remaining for giant power-up. */
  giant: number;
  turbo: boolean;
  bomb: boolean;
  life: boolean;
  saveT: number;
  /** Perk IDs applied to this disc's owner. */
  perks: string[];
}

export interface Aim {
  dx: number;
  dy: number;
  power: number;
  /** Pull point in world coords. */
  px: number;
  py: number;
}

export interface Solid {
  t: "c" | "r";
  x: number;
  y: number;
  r?: number;
  hw?: number;
  hh?: number;
  cr?: number;
}

export interface Hole {
  x: number;
  y: number;
  r: number;
}

export interface Bumper {
  x: number;
  y: number;
  r: number;
  hitT: number;
  gone: boolean;
  fade: number;
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
  gone: boolean;
  fade: number;
  hitT: number;
}

export interface Arena {
  kind: string;
  name: string;
  ax: number;
  ay: number;
  solids: Solid[];
  holes: Hole[];
  bumpers: Bumper[];
  walls: Wall[];
  scale: number;
  spawnAxis: boolean;
}

export interface PowerUp {
  x: number;
  y: number;
  type: PowerUpType;
  r: number;
  t: number;
  gone: boolean;
}

export type PowerUpType = "bomb" | "turbo" | "giant" | "life" | "clone";

export type GamePhase =
  | "intro"
  | "plan"
  | "aim"
  | "sim"
  | "shrink"
  | "roundEnd"
  | "matchEnd"
  | "draft"
  | "modeSelect";

export interface MatchPlayer {
  id: number;
  name: string;
  color: string;
  light: string;
  wins: number;
  kos: number;
  ownGoals: number;
  ready: boolean;
  dir: Vec;
  perks: string[];
  kind: "human" | "bot";
  slot: number;
}

export interface HitEvent {
  a: Disc;
  b: Disc;
  strength: number;
  cx: number;
  cy: number;
}

export interface FallEvent {
  disc: Disc;
  killer: number | null;
  selfKill: boolean;
  lastAlive: boolean;
}

export const TUNING = {
  discRadius: 0.072,
  maxPull: 0.55,
  maxLaunchSpeed: 4.3,
  drag: 1.5,
  slide: 0.6,
  restitution: 0.92,
  bumperKick: 1.6,
  shrinkPerTurn: 0.055,
  minArenaScale: 0.42,
  bombRadius: 0.8,
  bombForce: 4.4,
  turboMul: 1.65,
  powerupChance: 0.75,
  maxPowerups: 3,
  hurrySeconds: 8,
  physicsStep: 1 / 180,
  maxSubSteps: 10,
} as const;
