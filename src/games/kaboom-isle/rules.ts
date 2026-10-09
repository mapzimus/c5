import type { Rng } from "../../core/rng";
import type { Fighter } from "./world";

/** Pure match rules: bounty, underdog luck, mid-match events and the announcer. */

/** Points-ish standing used for the bounty: health plus a fat bonus per KO. */
export function standing(f: Fighter): number {
  return Math.max(0, f.hp) + f.kos * 40;
}

/**
 * The runaway leader wears a bounty: hitting them heals the shooter.
 * Needs 3+ blobs alive, or a clear lead (15+) with 2.
 */
export function bountyTarget(fighters: readonly Fighter[]): number | null {
  const alive = fighters.filter((f) => f.alive).sort((a, b) => standing(b) - standing(a));
  if (alive.length < 2) return null;
  const lead = standing(alive[0]!) - standing(alive[1]!);
  return lead >= 15 ? alive[0]!.index : null;
}

/** HP the shooter steals for hitting the bounty (KOs pay extra). */
export function bountyReward(damage: number, ko: boolean): number {
  return Math.round(damage * 0.5) + (ko ? 25 : 0);
}

/** 0..1 slot-machine luck: the weakest blob (when clearly behind) gets juicier rolls. */
export function underdogLuck(fighters: readonly Fighter[], index: number): number {
  const alive = fighters.filter((f) => f.alive);
  const me = fighters[index];
  if (!me || !me.alive || alive.length < 2) return 0;
  const best = Math.max(...alive.map(standing));
  const gap = best - standing(me);
  if (gap < 25) return 0;
  return Math.min(1, gap / 80);
}

export type EventId = "meteors" | "quake" | "split" | "lowgrav" | "storm" | "supply";

export const EVENTS: Record<EventId, { title: string; sub: string; color: string }> = {
  meteors: { title: "METEOR SHOWER!", sub: "Look up.", color: "#FF7A2F" },
  quake: { title: "EARTHQUAKE!", sub: "Hold onto something", color: "#C08A4A" },
  split: { title: "THE ISLAND SPLITS!", sub: "Mind the gap", color: "#FF5A1F" },
  lowgrav: { title: "LOW GRAVITY!", sub: "Everything floats this round", color: "#B98CFF" },
  storm: { title: "WIND STORM!", sub: "Wind x2.5 this round", color: "#3EE0FF" },
  supply: { title: "SUPPLY DROP!", sub: "Shoot or grab the crates", color: "#B8FF3D" },
};

/** Roll a mid-match event at the start of a round (none in the first two rounds). */
export function pickEvent(rng: Rng, round: number, last: EventId | null): EventId | null {
  if (round < 3) return null;
  if (rng.next() > 0.5) return null;
  const pool = (Object.keys(EVENTS) as EventId[]).filter((e) => e !== last);
  return rng.pick(pool);
}

export interface KoContext {
  shooter: number | null;
  victim: number;
  /** KOs the shooter has scored this turn, including this one. */
  koThisTurn: number;
  firstBlood: boolean;
  /** Victim was the last one to hit the shooter. */
  revenge: boolean;
  bounty: boolean;
}

/** Announcer lines for a knockout, loudest first. */
export function koCallouts(k: KoContext): string[] {
  const lines: string[] = [];
  if (k.shooter !== null && k.shooter === k.victim) lines.push("SELF-OWN!");
  else if (k.koThisTurn >= 3) lines.push("TRIPLE KILL!");
  else if (k.koThisTurn === 2) lines.push("DOUBLE KILL!");
  if (k.shooter !== k.victim && k.shooter !== null) {
    if (k.bounty) lines.push("BOUNTY CLAIMED!");
    if (k.revenge) lines.push("REVENGE!");
    if (k.firstBlood) lines.push("FIRST BLOOD!");
  }
  return lines;
}

/** Announcer line for a single big hit on someone else. */
export function hitCallout(damage: number): string | null {
  if (damage >= 55) return "OBLITERATED!";
  if (damage >= 40) return "DIRECT HIT!";
  return null;
}

/** Turns before the lava starts climbing: six rounds, but never more than ~24 turns. */
export function suddenDeathTurn(players: number): number {
  return Math.min(6 * players, 24);
}
