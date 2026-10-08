import type { FallEvent, MatchPlayer } from "./types";
import { TUNING } from "./types";
import type { World } from "./world";

export interface Objective {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  onRoundStart(world: World, players: MatchPlayer[]): void;
  onTurnEnd(world: World, players: MatchPlayer[], turn: number): void;
  onFall(event: FallEvent, players: MatchPlayer[]): void;
  isRoundOver(world: World, players: MatchPlayer[]): boolean;
  roundScores(players: MatchPlayer[]): number[];
  roundWinner(players: MatchPlayer[]): number | null;
  shouldShrink(turn: number): boolean;
}

export class Showdown implements Objective {
  readonly id = "showdown";
  readonly name = "SHOWDOWN";
  readonly description = "Last disc standing wins. The arena crumbles each turn.";
  private eliminated: number[] = [];
  private finishOrder: { player: number; step: number }[] = [];

  onRoundStart(_world: World, _players: MatchPlayer[]): void {
    this.eliminated = [];
    this.finishOrder = [];
  }

  onTurnEnd(world: World, _players: MatchPlayer[], turn: number): void {
    if (this.shouldShrink(turn)) {
      world.arena.scale = Math.max(TUNING.minArenaScale, world.arena.scale - TUNING.shrinkPerTurn / Math.max(1, world.aliveOwners().size));
    }
  }

  onFall(event: FallEvent, players: MatchPlayer[]): void {
    if (event.lastAlive && !this.eliminated.includes(event.disc.owner)) {
      this.eliminated.push(event.disc.owner);
      this.finishOrder.push({ player: event.disc.owner, step: event.step });
    }
    if (event.killer != null && event.killer !== event.disc.owner) {
      players[event.killer]!.kos++;
    }
    if (event.selfKill) {
      players[event.disc.owner]!.ownGoals++;
    }
  }

  isRoundOver(world: World, _players: MatchPlayer[]): boolean {
    const alive = world.aliveOwners();
    return alive.size <= 1;
  }

  roundScores(players: MatchPlayer[]): number[] {
    const n = players.length;
    const scores = new Array<number>(n).fill(n);
    const eliminated = this.finishOrder.map((f) => f.player);

    let rank = 1;
    let i = 0;
    while (i < this.finishOrder.length) {
      const step = this.finishOrder[i]!.step;
      let j = i;
      while (j < this.finishOrder.length && this.finishOrder[j]!.step === step) j++;
      for (let k = i; k < j; k++) {
        scores[this.finishOrder[k]!.player] = rank;
      }
      rank = j + 1;
      i = j;
    }

    for (let p = 0; p < n; p++) {
      if (!eliminated.includes(p)) scores[p] = n;
    }
    return scores;
  }

  roundWinner(players: MatchPlayer[]): number | null {
    const scores = this.roundScores(players);
    let bestScore = -1;
    for (const s of scores) {
      if (s > bestScore) bestScore = s;
    }
    const winners = scores.reduce<number[]>((acc, s, idx) => { if (s === bestScore) acc.push(idx); return acc; }, []);
    return winners.length === 1 ? winners[0]! : null;
  }

  shouldShrink(turn: number): boolean {
    return turn >= 2;
  }
}

export function createObjective(id: string): Objective {
  switch (id) {
    case "showdown": return new Showdown();
    default: return new Showdown();
  }
}
