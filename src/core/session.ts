import type { Player, RankedResult, SessionStanding } from "./types";

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

/** Scoring is just wins: every game won is 1 point. The winner picks the next game. */
export class Session {
  players: Player[];
  standings: SessionStanding[];
  lastResults: RankedResult[] = [];
  gamesPlayed = 0;
  /** Who chooses the next minigame. Null before the first game. */
  pickerId: string | null = null;

  constructor(players: Player[]) {
    this.players = players;
    this.standings = players.map((player) => ({ playerId: player.id, wins: 0 }));
  }

  applyResults(scores: { playerId: string; score: number }[]): RankedResult[] {
    const ranked = rankResults(scores);
    this.lastResults = ranked;
    this.gamesPlayed += 1;

    for (const result of ranked) {
      if (!result.won) continue;
      const standing = this.standingFor(result.playerId);
      if (standing) standing.wins += 1;
    }
    // On a tie for first, the first listed winner picks.
    this.pickerId = ranked.find((result) => result.won)?.playerId ?? null;

    this.standings.sort((a, b) => b.wins - a.wins);
    return ranked;
  }

  standingFor(playerId: string): SessionStanding | undefined {
    return this.standings.find((item) => item.playerId === playerId);
  }

  leader(): SessionStanding | undefined {
    return this.standings[0];
  }

  picker(): Player | undefined {
    return this.players.find((player) => player.id === this.pickerId);
  }
}
