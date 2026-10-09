/**
 * Pure rules for the chaos layer of Booty Haul: boarding rivals, the WANTED
 * bounty, random sea events (kraken, treasure rain, ghost ship, cursed gold),
 * the last-call double-booty stretch, pirate barks and bot personalities.
 * No canvas, no DOM: everything here is unit-tested.
 */
import type { Rng } from "../../../core/rng";
import { haversineKm, lanePos, type Lane, type LatLng } from "./geo";
import { GAME_DURATION_S, SHIP_SPEED_KM_S, SPOT_RANGE_KM } from "./rules";

// ---- boarding -------------------------------------------------------------

/** Drop anchor this close to a rival and you board them. */
export const BOARD_RANGE_KM = 260;
export const BOARD_STEAL_FRAC = 0.12;
/** Boarding the WANTED leader pays a fat bounty. */
export const WANTED_STEAL_FRAC = 0.25;
/** Boarding the captain who just boarded you (within the revenge window). */
export const REVENGE_MULT = 1.5;
export const REVENGE_WINDOW_S = 15;
export const BOARD_MIN_STEAL = 10;
/** A freshly boarded ship can't be boarded again for this long. */
export const BOARD_SHIELD_S = 5;

export interface Anchorage {
  id: string;
  parked: boolean;
  ll: LatLng;
  score: number;
  shield: number;
}

/** How much booty a boarding takes. Never more than the victim has. */
export function boardingSteal(victimScore: number, wanted: boolean, revenge = false): number {
  if (victimScore <= 0) return 0;
  const frac = wanted ? WANTED_STEAL_FRAC : BOARD_STEAL_FRAC;
  const base = Math.max(BOARD_MIN_STEAL, Math.floor(victimScore * frac));
  return Math.min(victimScore, Math.floor(base * (revenge ? REVENGE_MULT : 1)));
}

/** The nearest unshielded, anchored rival within boarding range of `ll`. */
export function findBoardingVictim(
  boarderId: string,
  ll: LatLng,
  fleet: readonly Anchorage[],
): Anchorage | null {
  let best: Anchorage | null = null;
  let bestKm = BOARD_RANGE_KM;
  for (const a of fleet) {
    if (a.id === boarderId || !a.parked || a.shield > 0) continue;
    const km = haversineKm(ll, a.ll);
    if (km <= bestKm) {
      bestKm = km;
      best = a;
    }
  }
  return best;
}

// ---- WANTED (catch-up) ----------------------------------------------------

export const WANTED_LEAD = 60;

/**
 * The runaway leader gets a bounty on their head once their lead is big:
 * at least WANTED_LEAD and at least 30% over second place.
 */
export function wantedId(scores: readonly { id: string; score: number }[]): string | null {
  if (scores.length < 2) return null;
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const lead = sorted[0]!.score - sorted[1]!.score;
  if (lead >= Math.max(WANTED_LEAD, sorted[1]!.score * 0.3)) return sorted[0]!.id;
  return null;
}

/** The bot's favourite boarding target: the WANTED captain, else the richest rival. */
export function botBoardTarget(
  selfId: string,
  fleet: readonly Anchorage[],
  wanted: string | null,
): Anchorage | null {
  const rivals = fleet.filter((a) => a.id !== selfId && a.parked && a.shield <= 0 && a.score > 0);
  if (rivals.length === 0) return null;
  const w = rivals.find((a) => a.id === wanted);
  if (w) return w;
  return rivals.reduce((best, a) => (a.score > best.score ? a : best));
}

// ---- final stretch --------------------------------------------------------

export const FINAL_STRETCH_S = 15;

export function inFinalStretch(elapsed: number): boolean {
  return elapsed >= GAME_DURATION_S - FINAL_STRETCH_S && elapsed < GAME_DURATION_S;
}

/** Everything pays double during LAST CALL. */
export function stretchMultiplier(elapsed: number): number {
  return inFinalStretch(elapsed) ? 2 : 1;
}

// ---- sea events -----------------------------------------------------------

export type EventKind = "kraken" | "treasure-rain" | "ghost-ship" | "cursed-gold";
export const EVENT_KINDS: readonly EventKind[] = ["kraken", "treasure-rain", "ghost-ship", "cursed-gold"];
export const FIRST_EVENT_S = 9;
/** No new events start this close to the end (LAST CALL is chaos enough). */
export const EVENT_CUTOFF_S = 6;

export const EVENT_DURATION_S: Record<EventKind, number> = {
  kraken: 5,
  "treasure-rain": 10,
  "ghost-ship": 12,
  "cursed-gold": 8,
};

export function pickEvent(rng: Rng, last: EventKind | null): EventKind {
  const options = EVENT_KINDS.filter((k) => k !== last);
  return rng.pick(options);
}

export function nextEventGap(rng: Rng): number {
  return 8 + rng.next() * 5;
}

export function canStartEvent(elapsed: number): boolean {
  return elapsed < GAME_DURATION_S - EVENT_CUTOFF_S;
}

export function inRadius(ll: LatLng, center: LatLng, km: number): boolean {
  return haversineKm(ll, center) <= km;
}

// Kraken: warns, then strikes everyone anchored in the circle.
export const KRAKEN_WARN_S = 3;
export const KRAKEN_RADIUS_KM = 450;
export const KRAKEN_TAKE_FRAC = 0.15;

/** The kraken smells gold: it surfaces beside the WANTED captain, else a random anchored one. */
export function krakenTarget(rng: Rng, fleet: readonly Anchorage[], wanted: string | null, fallback: LatLng): LatLng {
  const parked = fleet.filter((a) => a.parked);
  const victim = parked.find((a) => a.id === wanted) ?? (parked.length > 0 ? rng.pick(parked) : null);
  const base = victim ? victim.ll : fallback;
  // Jitter a few hundred km so it is dodgeable and not always dead-centre.
  const lat = Math.max(-75, Math.min(75, base[0] + (rng.next() - 0.5) * 4));
  let lng = base[1] + (rng.next() - 0.5) * 4;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return [lat, lng];
}

export function krakenToll(score: number): number {
  return Math.max(0, Math.floor(score * KRAKEN_TAKE_FRAC));
}

/** Everyone anchored inside the strike circle. */
export function krakenVictims(center: LatLng, fleet: readonly Anchorage[]): Anchorage[] {
  return fleet.filter((a) => a.parked && inRadius(a.ll, center, KRAKEN_RADIUS_KM));
}

// Treasure rain: chests splash down; the nearest anchor in range grabs each.
export const CHEST_GRAB_KM = SPOT_RANGE_KM + 20;

export interface Chest {
  ll: LatLng;
  value: number;
  alive: boolean;
  /** Seconds since splashdown (for the drop animation). */
  age: number;
}

/** Chests land on shipping lanes, preferring the side of the globe people are looking at. */
export function spawnChests(rng: Rng, lanes: readonly Lane[], count: number, near: LatLng, maxKm = 5500): Chest[] {
  const chests: Chest[] = [];
  for (let i = 0; i < count; i++) {
    let ll: LatLng = near;
    for (let tries = 0; tries < 30; tries++) {
      const lane = lanes[rng.int(0, lanes.length - 1)]!;
      ll = lanePos(lane, rng.next() * lane.lengthKm);
      if (haversineKm(ll, near) <= maxKm) break;
    }
    const mega = i === 0;
    chests.push({ ll, value: mega ? 120 : 30 + rng.int(0, 5) * 10, alive: true, age: 0 });
  }
  return chests;
}

/** Each live chest goes to the nearest anchored captain within grab range. Mutates `alive`. */
export function collectChests(chests: Chest[], fleet: readonly Anchorage[]): { chest: Chest; playerId: string }[] {
  const out: { chest: Chest; playerId: string }[] = [];
  for (const chest of chests) {
    if (!chest.alive) continue;
    let best: Anchorage | null = null;
    let bestKm = CHEST_GRAB_KM;
    for (const a of fleet) {
      if (!a.parked) continue;
      const km = haversineKm(a.ll, chest.ll);
      if (km <= bestKm) {
        bestKm = km;
        best = a;
      }
    }
    if (best) {
      chest.alive = false;
      out.push({ chest, playerId: best.id });
    }
  }
  return out;
}

// Ghost ship: a fast spectral galleon worth a fortune to the first captain in range.
export const GHOST_VALUE = 150;
export const GHOST_SPEED_MULT = 3.2;

export interface GhostShip {
  laneIdx: number;
  km: number;
  dir: 1 | -1;
  alive: boolean;
}

export function spawnGhost(rng: Rng, lanes: readonly Lane[], near: LatLng, maxKm = 5000): GhostShip {
  let laneIdx = rng.int(0, lanes.length - 1);
  let km = rng.next() * lanes[laneIdx]!.lengthKm;
  for (let tries = 0; tries < 30; tries++) {
    const li = rng.int(0, lanes.length - 1);
    const k = rng.next() * lanes[li]!.lengthKm;
    laneIdx = li;
    km = k;
    if (haversineKm(lanePos(lanes[li]!, k), near) <= maxKm) break;
  }
  return { laneIdx, km, dir: rng.next() < 0.5 ? 1 : -1, alive: true };
}

/** Sails the ghost; it bounces off lane ends instead of hopping lanes. */
export function advanceGhost(ghost: GhostShip, lanes: readonly Lane[], dt: number): void {
  const lane = lanes[ghost.laneIdx]!;
  ghost.km += SHIP_SPEED_KM_S * GHOST_SPEED_MULT * dt * ghost.dir;
  if (ghost.km < 0) {
    ghost.km = 0;
    ghost.dir = 1;
  } else if (ghost.km > lane.lengthKm) {
    ghost.km = lane.lengthKm;
    ghost.dir = -1;
  }
}

export function ghostPos(ghost: GhostShip, lanes: readonly Lane[]): LatLng {
  return lanePos(lanes[ghost.laneIdx]!, ghost.km);
}

/** Nearest anchored captain within spotting range of the ghost, or null. */
export function ghostClaimant(ghostLL: LatLng, fleet: readonly Anchorage[]): string | null {
  let best: string | null = null;
  let bestKm = SPOT_RANGE_KM;
  for (const a of fleet) {
    if (!a.parked) continue;
    const km = haversineKm(a.ll, ghostLL);
    if (km <= bestKm) {
      bestKm = km;
      best = a.id;
    }
  }
  return best;
}

// Cursed gold: raids pay triple... unless the curse bites.
export const CURSE_CHANCE = 0.3;
export const CURSED_RAID_MULT = 3;

/** Resolve a raid during cursed gold. A curse costs the raid's base value instead of paying it. */
export function cursedRaid(rng: Rng, base: number): { delta: number; cursed: boolean } {
  if (rng.next() < CURSE_CHANCE) return { delta: -base, cursed: true };
  return { delta: base * CURSED_RAID_MULT, cursed: false };
}

// ---- barks ----------------------------------------------------------------

export type BarkKey =
  | "board" | "boarded" | "empty" | "revenge" | "wanted" | "kraken" | "krakenHit" | "krakenMiss"
  | "chest" | "ghost" | "ghostGone" | "cursed" | "curseHit" | "curseWin" | "lastCall" | "raid" | "flee";

export const BARKS: Record<BarkKey, readonly string[]> = {
  board: [
    "{a} boards {b}! Mind the parrot!",
    "{a} swings aboard {b}'s ship. Rude!",
    "{a} to {b}: \"Yer gold or yer dignity!\"",
    "{a} pillages {b}. Classic.",
    "{a} rams {b} and helps themselves.",
  ],
  boarded: ["Me doubloons!", "Oi! That's mine!", "Not the treasure!", "I'll remember this!", "Blast yer barnacles!"],
  empty: ["{a} boards {b}... and finds only socks.", "{a} raids {b}'s hold. It's empty. Awkward."],
  revenge: ["REVENGE! {a} takes it back from {b}!", "{a} returns the favour to {b}. With interest!"],
  wanted: ["{a} is WANTED! Bounty on their head!", "Poster's up: {a}, dead or richer!", "{a} is too rich. Get 'em!"],
  kraken: ["Something big stirs below {a}...", "The kraken is hungry. And it smells {a}.", "Tentacles near {a}! Move or be calamari!"],
  krakenHit: ["{a} gets slapped by a tentacle!", "The kraken eats {a}'s gold. Burp.", "{a} is now kraken lunch money."],
  krakenMiss: ["The kraken grabs... nothing. Sulks.", "Kraken whiffs! Big wet miss."],
  chest: ["Treasure falls from the sky! Grab it!", "It's raining chests! Hallelujah!", "Free gold! Move yer hulls!"],
  ghost: ["A GHOST SHIP! Chase it down!", "Spooky galleon, full of loot. Wooo!", "The Flying Dutchman! It's loaded!"],
  ghostGone: ["The ghost ship fades away. Boo.", "Nobody caught the ghost. It laughs at ye."],
  cursed: ["CURSED GOLD! Raids pay triple... maybe.", "The gold glows purple. Feeling lucky?"],
  curseHit: ["{a}'s gold turns to sand!", "Cursed! {a} raided a box of angry crabs.", "{a} should not have touched that."],
  curseWin: ["{a} beats the curse! Triple loot!", "{a} laughs at curses!"],
  lastCall: ["LAST CALL! Every coin pays double!", "Fifteen seconds! Grab everything!"],
  raid: ["Yo ho ho!", "Plunder!", "Arrr!", "Shiny!", "Mine mine mine!"],
  flee: ["Nope nope nope!", "Run away!", "Full sail, ye dogs!"],
};

export function bark(rng: Rng, key: BarkKey, a = "", b = ""): string {
  return rng.pick(BARKS[key]).replace(/\{a\}/g, a).replace(/\{b\}/g, b);
}

// ---- bot personalities ----------------------------------------------------

export type PersonaKey = "greedy" | "coward" | "gambler" | "brute";

export interface Persona {
  key: PersonaKey;
  title: string;
  /** Chance per think to board a rival when a move is ready. */
  board: number;
  /** Chance per think to flee a kraken warning. */
  flee: number;
  /** Chance per think to chase a chest or ghost. */
  chase: number;
  /** Chance per think to raid during cursed gold. */
  gamble: number;
  /** Seconds between thinks. */
  think: number;
}

export const PERSONAS: readonly Persona[] = [
  { key: "greedy", title: "the Greedy", board: 0.15, flee: 0.5, chase: 0.7, gamble: 0.6, think: 1.0 },
  { key: "coward", title: "the Yellow", board: 0.05, flee: 0.95, chase: 0.6, gamble: 0.15, think: 0.8 },
  { key: "gambler", title: "the Reckless", board: 0.1, flee: 0.25, chase: 0.5, gamble: 1, think: 1.2 },
  { key: "brute", title: "the Rammer", board: 0.28, flee: 0.4, chase: 0.35, gamble: 0.5, think: 1.1 },
];

/** Give each bot a different personality while there are personalities left. */
export function assignPersonas(rng: Rng, count: number): Persona[] {
  const pool = [...PERSONAS];
  const out: Persona[] = [];
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) pool.push(...PERSONAS);
    const idx = rng.int(0, pool.length - 1);
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}
