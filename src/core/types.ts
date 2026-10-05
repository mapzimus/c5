export type PlayerKind = "human" | "bot";

export interface Player {
  id: string;
  name: string;
  color: string;
  kind: PlayerKind;
  slot: 0 | 1 | 2 | 3;
}

export interface RankedResult {
  playerId: string;
  score: number;
  rank: number;
  /** Rank 1 (ties included). Each win is worth 1 point. */
  won: boolean;
}

export interface MinigameContext {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  players: Player[];
  input: import("./input").InputManager;
  rng: import("./rng").Rng;
  sfx: import("./audio").Sfx;
  /** Minimum interactive element size in game coords to reach 44 CSS px. */
  minTap: number;
}

export interface MinigameInstance {
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  isFinished(): boolean;
  getScores(): { playerId: string; score: number }[];
  destroy(): void;
}

export interface MinigameDefinition {
  id: string;
  name: string;
  tagline: string;
  description: string;
  durationMs: number;
  controls: string;
  /** Match the phone viewport instead of letterboxing a 16:9 board. */
  fillsScreen?: boolean;
  create(ctx: MinigameContext): MinigameInstance;
}

export interface SessionStanding {
  playerId: string;
  /** Games won. This is the whole score: 1 point per win. */
  wins: number;
}

export const PLAYER_COLORS = ["#3EE0FF", "#FF3D7A", "#FFB020", "#B8FF3D"] as const;

export const DEFAULT_NAMES = ["Ace", "Blitz", "Clash", "Dash"] as const;

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
