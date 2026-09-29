/**
 * Difficulty climbs with score. Each level sets the drop odds for 1/2/4/8/16
 * (percent, sums to 100) and the shot clock: seconds before the orb drops on its own.
 */
export interface Level {
  score: number;
  odds: readonly [number, number, number, number, number];
  shot: number;
}

export const LEVELS: readonly Level[] = [
  { score: 0, odds: [65, 25, 10, 0, 0], shot: 8 },
  { score: 2_000, odds: [55, 27, 13, 5, 0], shot: 6.5 },
  { score: 6_000, odds: [46, 27, 16, 8, 3], shot: 5 },
  { score: 15_000, odds: [38, 27, 18, 11, 6], shot: 4 },
  { score: 30_000, odds: [32, 26, 20, 14, 8], shot: 3 },
];

export function levelIndex(score: number): number {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (score >= LEVELS[i]!.score) index = i;
  return index;
}

export function levelFor(score: number): Level {
  return LEVELS[levelIndex(score)]!;
}

/** Map a uniform roll in [0, 1) to a drop tier using the odds at this score. */
export function rollTier(n: number, score: number): number {
  const { odds } = levelFor(score);
  let edge = 0;
  for (let tier = 0; tier < odds.length; tier++) {
    edge += odds[tier]! / 100;
    if (n < edge) return tier;
  }
  return 0;
}

export function shotClock(score: number): number {
  return levelFor(score).shot;
}
