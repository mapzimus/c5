import type { RankedResult } from "./types";

export function rankResults(
  scores: { playerId: string; score: number }[],
): RankedResult[] {
  const sorted = [...scores].sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
  let lastScore = Number.POSITIVE_INFINITY;
  let lastRank = 0;

  return sorted.map((entry, index) => {
    const rank = entry.score === lastScore ? lastRank : index + 1;
    lastScore = entry.score;
    lastRank = rank;
    return { ...entry, rank, won: rank === 1 };
  });
}
