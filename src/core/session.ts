import { PARTY_POINTS_BY_RANK, type Player, type RankedResult, type SessionStanding } from "./types";

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
    const partyPoints = PARTY_POINTS_BY_RANK[rank] ?? 1;
    return { ...entry, rank, partyPoints };
  });
}

export class Session {
  players: Player[];
  standings: SessionStanding[];
  lastResults: RankedResult[] = [];
  circuit: string[] = [];
  circuitIndex = 0;
  gamesPlayed = 0;

  constructor(players: Player[]) {
    this.players = players;
    this.standings = players.map((player) => ({
      playerId: player.id,
      points: 0,
      wins: 0,
    }));
  }

  applyResults(scores: { playerId: string; score: number }[]): RankedResult[] {
    const ranked = rankResults(scores);
    this.lastResults = ranked;
    this.gamesPlayed += 1;

    for (const result of ranked) {
      const standing = this.standings.find((item) => item.playerId === result.playerId);
      if (!standing) continue;
      standing.points += result.partyPoints;
      if (result.rank === 1) standing.wins += 1;
    }

    this.standings.sort((a, b) => b.points - a.points || b.wins - a.wins);
    return ranked;
  }

  standingFor(playerId: string): SessionStanding | undefined {
    return this.standings.find((item) => item.playerId === playerId);
  }

  leader(): SessionStanding | undefined {
    return this.standings[0];
  }

  startCircuit(ids: string[]): void {
    this.circuit = ids;
    this.circuitIndex = 0;
  }

  currentCircuitId(): string | undefined {
    return this.circuit[this.circuitIndex];
  }

  advanceCircuit(): string | undefined {
    this.circuitIndex += 1;
    return this.currentCircuitId();
  }

  circuitDone(): boolean {
    return this.circuit.length > 0 && this.circuitIndex >= this.circuit.length;
  }
}
