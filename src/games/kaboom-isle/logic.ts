/** Pure, DOM-free helpers for Kaboom Isle's round flow and seat panels. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PANEL_H = 104;
export const HEAT_STEP = 0.25;
export const HEAT_CAP = 2.2;
export const OVERDRIVE_ROUND = 5;
export const LAVA_ROUND = 4;
export const MAX_ROUNDS = 7;
export const WINS_NEEDED = 2;

/** Two players get a best-of-three; bigger tables play two islands so nobody waits through a third. */
export function maxIslands(players: number): number {
  return players > 2 ? 2 : 3;
}

/** Damage multiplier for a round: the island heats up 20% every round. */
export function heatFor(round: number, final = false): number {
  // The deciding island starts hot so it cannot drag.
  const base = final ? 2 : 0;
  return Math.min(HEAT_CAP, 1 + HEAT_STEP * Math.max(0, round - 1 + base));
}

/** Does the lava rise at the start of this round? */
export function lavaRises(round: number, final = false): boolean {
  return round >= (final ? LAVA_ROUND - 1 : LAVA_ROUND);
}

/** One control panel per seat along the bottom edge. */
export function panelRects(width: number, height: number, seats: number): Rect[] {
  const w = width / seats;
  return Array.from({ length: seats }, (_, i) => ({ x: i * w, y: height - PANEL_H, w, h: PANEL_H }));
}

/** Weapon choice cards inside a seat panel. */
export function panelCards(panel: Rect, count: number): Rect[] {
  const gap = 6;
  const pad = 8;
  const w = (panel.w - pad * 2 - gap * (count - 1)) / count;
  const y = panel.y + 30;
  const h = panel.h - 36;
  return Array.from({ length: count }, (_, i) => ({ x: panel.x + pad + i * (w + gap), y, w, h }));
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function seatAt(panels: readonly Rect[], x: number, y: number): number {
  return panels.findIndex((r) => inRect(r, x, y));
}

/** Highest HP among survivors wins a timed-out island; a tie means nobody takes it. */
export function islandWinner(fighters: readonly { index: number; alive: boolean; hp: number }[]): number | null {
  const alive = fighters.filter((f) => f.alive);
  if (alive.length === 1) return alive[0]!.index;
  if (alive.length === 0) return null;
  const top = Math.max(...alive.map((f) => f.hp));
  const leaders = alive.filter((f) => f.hp === top);
  return leaders.length === 1 ? leaders[0]!.index : null;
}

/**
 * Is the match decided? Returns the winners or null if more islands are needed.
 * When the islands run out, most island wins takes it, then most damage dealt; a dead heat shares the win.
 */
export function matchResult(wins: readonly number[], islandsPlayed: number, islandsMax: number, damage: readonly number[] = []): { winners: number[]; onDamage: boolean } | null {
  const best = Math.max(...wins);
  if (best < WINS_NEEDED && islandsPlayed < islandsMax) return null;
  const leaders = wins.map((w, i) => (w === best ? i : -1)).filter((i) => i >= 0);
  if (leaders.length <= 1 || damage.length === 0) return { winners: leaders, onDamage: false };
  const topDamage = Math.max(...leaders.map((i) => damage[i] ?? 0));
  const byDamage = leaders.filter((i) => (damage[i] ?? 0) === topDamage);
  return { winners: byDamage, onDamage: byDamage.length < leaders.length };
}

/** Draft order between islands: fewest island wins first, then seat order. */
export function draftOrder(wins: readonly number[]): number[] {
  return wins.map((_, i) => i).sort((a, b) => wins[a]! - wins[b]! || a - b);
}

/** Bot swat odds: nukes and boosted shots are worth the one charge; chickens are not. */
export function botSwatChance(damage: number, dmgMul: number, swatsLeft: number): number {
  if (swatsLeft <= 0 || damage <= 0) return 0;
  const threat = damage * dmgMul;
  if (threat >= 50) return 0.85;
  if (threat >= 30) return 0.5;
  return 0.22;
}

/** Which way a bot ghost blows: push the wind further from calm, with a little whimsy. */
export function botGustDir(wind: number, whim: number): number {
  if (Math.abs(wind) < 0.05) return whim < 0.5 ? -1 : 1;
  return whim < 0.8 ? Math.sign(wind) : -Math.sign(wind);
}
