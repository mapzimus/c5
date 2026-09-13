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
  partyPoints: number;
}

export interface MinigameContext {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  players: Player[];
  input: import("./input").InputManager;
  rng: import("./rng").Rng;
  sfx: import("./audio").Sfx;
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
  create(ctx: MinigameContext): MinigameInstance;
}

export interface SessionStanding {
  playerId: string;
  points: number;
  wins: number;
}

export const PLAYER_COLORS = ["#3EE0FF", "#FF3D7A", "#FFB020", "#B8FF3D"] as const;

export const DEFAULT_NAMES = ["Gale", "Surge", "Squall", "Tempest"] as const;

export const PARTY_POINTS_BY_RANK = [0, 5, 3, 2, 1] as const;

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
