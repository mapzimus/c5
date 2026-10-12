import type { Rng } from "../../../core/rng";
import { DOORS, haversineKm, lanePos, lanesFromPort, type Lane, type LatLng, PORTS } from "./geo";

export const SPOT_RANGE_KM = 200;
export const SHIP_SPEED_KM_S = 75;
export const FLEET_SIZE = 300;
export const DRIFT_MAX = 0.8;
export const DRIFT_FADE_KM = 300;
export const GAME_DURATION_S = 75;
export const REPARK_COUNT = 2;
/** Seconds to recharge one move (halved for the underdog). */
export const MOVE_RECHARGE_S = 6;
export const RAID_COOLDOWN_S = 3;
/** After hauling home the crew is busy counting: no raids for this long. */
export const HAUL_LOCK_S = 2.5;
export const MAX_MULT = 4;
/** The Navy announces a hunt this long before it lands. */
export const HUNT_WARNING_S = 3.5;
export const HUNT_FIRST_S = 14;
export const HUNT_GAP_S = 11;
export const HUNT_GAP_TIDE_S = 8;
/** Final third: traffic surges and hunts come faster. */
export const HIGH_TIDE_S = 50;
export const HIGH_TIDE_SPEED = 1.45;
export const PRIZE_LIFE_S = 25;
export const PRIZE_MIN_KM = 900;
export const LAST_CALL_S = 10;
/** Ships sent onward after a capture respawn at least this far from the net. */
const ONWARD_MIN_KM = SPOT_RANGE_KM * 3;

export interface ShipType {
  key: string;
  label: string;
  points: number;
  weight: number;
  color: string;
  size: number;
}

export const SHIP_TYPES: readonly ShipType[] = [
  { key: "cargo",    label: "Cargo",    points: 2,   weight: 0.55, color: "#64748b", size: 3 },
  { key: "tanker",   label: "Tanker",   points: 5,   weight: 0.25, color: "#f59e0b", size: 4 },
  { key: "treasure", label: "Treasure", points: 15,  weight: 0.12, color: "#a855f7", size: 5 },
  { key: "convoy",   label: "Convoy",   points: 30,  weight: 0.08, color: "#22d3ee", size: 6 },
];

function pickType(rng: Rng): ShipType {
  const r = rng.next();
  let cum = 0;
  for (const t of SHIP_TYPES) {
    cum += t.weight;
    if (r < cum) return t;
  }
  return SHIP_TYPES[0]!;
}

export interface Ship {
  id: number;
  type: ShipType;
  laneIdx: number;
  dir: 1 | -1;
  km: number;
  driftLat: number;
  driftLng: number;
  alive: boolean;
  speedMult: number;
}

let nextId = 0;

function randomSpeedMult(rng: Rng): number {
  return 0.7 + rng.next() * 0.6;
}

export function spawnShip(rng: Rng, lanes: readonly Lane[]): Ship {
  const portIdx = rng.int(0, PORTS.length - 1);
  const port = PORTS[portIdx]!;
  const exits = lanesFromPort(lanes, port.ll);
  if (exits.length === 0) {
    const laneIdx = rng.int(0, lanes.length - 1);
    const lane = lanes[laneIdx]!;
    return {
      id: nextId++,
      type: pickType(rng),
      laneIdx,
      dir: rng.next() < 0.5 ? 1 : -1,
      km: rng.next() * lane.lengthKm,
      driftLat: (rng.next() - 0.5) * DRIFT_MAX * 2,
      driftLng: (rng.next() - 0.5) * DRIFT_MAX * 2,
      alive: true,
      speedMult: randomSpeedMult(rng),
    };
  }
  const exit = rng.pick(exits)!;
  return {
    id: nextId++,
    type: pickType(rng),
    laneIdx: exit.lane,
    dir: exit.dir,
    km: exit.dir === 1 ? 0 : lanes[exit.lane]!.lengthKm,
    driftLat: (rng.next() - 0.5) * DRIFT_MAX * 2,
    driftLng: (rng.next() - 0.5) * DRIFT_MAX * 2,
    alive: true,
    speedMult: randomSpeedMult(rng),
  };
}

export function spawnFleet(rng: Rng, lanes: readonly Lane[], count: number): Ship[] {
  const fleet: Ship[] = [];
  for (let i = 0; i < count; i++) {
    const ship = spawnShip(rng, lanes);
    ship.km = rng.next() * lanes[ship.laneIdx]!.lengthKm;
    fleet.push(ship);
  }
  return fleet;
}

export function shipPos(ship: Ship, lanes: readonly Lane[]): LatLng {
  const lane = lanes[ship.laneIdx]!;
  const base = lanePos(lane, ship.km);
  const endDist = Math.min(ship.km, lane.lengthKm - ship.km);
  const fade = Math.min(1, endDist / DRIFT_FADE_KM);
  return [base[0] + ship.driftLat * fade, base[1] + ship.driftLng * fade];
}

export function advanceShips(
  ships: Ship[],
  lanes: readonly Lane[],
  dt: number,
  rng: Rng,
  speedScale = 1,
): void {
  for (const ship of ships) {
    if (!ship.alive) continue;
    ship.km += SHIP_SPEED_KM_S * ship.speedMult * speedScale * dt * ship.dir;
    const lane = lanes[ship.laneIdx]!;
    if (ship.km < 0 || ship.km > lane.lengthKm) {
      reoutfit(ship, lanes, rng);
    }
  }
}

function reoutfit(ship: Ship, lanes: readonly Lane[], rng: Rng): void {
  const lane = lanes[ship.laneIdx]!;
  const endPt = ship.dir === 1 ? lane.pts[lane.pts.length - 1]! : lane.pts[0]!;
  const exits = lanesFromPort(lanes, endPt);
  if (exits.length === 0) {
    ship.dir = (ship.dir * -1) as 1 | -1;
    ship.km = Math.max(0, Math.min(ship.km, lane.lengthKm));
    return;
  }
  const exit = rng.pick(exits)!;
  ship.laneIdx = exit.lane;
  ship.dir = exit.dir;
  ship.km = exit.dir === 1 ? 0 : lanes[exit.lane]!.lengthKm;
  ship.type = pickType(rng);
  ship.driftLat = (rng.next() - 0.5) * DRIFT_MAX * 2;
  ship.driftLng = (rng.next() - 0.5) * DRIFT_MAX * 2;
  ship.speedMult = randomSpeedMult(rng);
}

/**
 * A captured vessel sails on from a port well away from the net, reflagged
 * with a fresh cargo, so a raid actually empties the water it covered.
 */
export function sendOnward(ship: Ship, lanes: readonly Lane[], rng: Rng, avoid: LatLng): void {
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = PORTS[rng.int(0, PORTS.length - 1)]!;
    if (haversineKm(port.ll, avoid) < ONWARD_MIN_KM) continue;
    const exits = lanesFromPort(lanes, port.ll);
    if (exits.length === 0) continue;
    const exit = rng.pick(exits)!;
    ship.laneIdx = exit.lane;
    ship.dir = exit.dir;
    ship.km = exit.dir === 1 ? 0 : lanes[exit.lane]!.lengthKm;
    ship.type = pickType(rng);
    ship.driftLat = (rng.next() - 0.5) * DRIFT_MAX * 2;
    ship.driftLng = (rng.next() - 0.5) * DRIFT_MAX * 2;
    ship.speedMult = randomSpeedMult(rng);
    return;
  }
  // No distant port found (should not happen): drop it on a random far lane point.
  for (let attempt = 0; attempt < 8; attempt++) {
    const laneIdx = rng.int(0, lanes.length - 1);
    const lane = lanes[laneIdx]!;
    const km = rng.next() * lane.lengthKm;
    if (haversineKm(lanePos(lane, km), avoid) < ONWARD_MIN_KM) continue;
    ship.laneIdx = laneIdx;
    ship.km = km;
    ship.type = pickType(rng);
    return;
  }
}

export function shipsInRange(
  ships: readonly Ship[],
  pos: LatLng,
  lanes: readonly Lane[],
): { ship: Ship; dist: number }[] {
  const hits: { ship: Ship; dist: number }[] = [];
  for (const ship of ships) {
    if (!ship.alive) continue;
    const sp = shipPos(ship, lanes);
    const d = haversineKm(pos, sp);
    if (d <= SPOT_RANGE_KM) hits.push({ ship, dist: d });
  }
  return hits;
}

export function scoreShipsInRange(
  ships: readonly Ship[],
  pos: LatLng,
  lanes: readonly Lane[],
): number {
  let total = 0;
  for (const ship of ships) {
    if (!ship.alive) continue;
    const sp = shipPos(ship, lanes);
    if (haversineKm(pos, sp) <= SPOT_RANGE_KM) total += ship.type.points;
  }
  return total;
}

export interface Capture {
  value: number;
  count: number;
  /** Positions the captured vessels were taken from, for the suction effect. */
  from: LatLng[];
  hadConvoy: boolean;
}

/** Raid: take every vessel in the net and send it onward. The water is empty afterwards. */
export function captureShips(ships: Ship[], pos: LatLng, lanes: readonly Lane[], rng: Rng): Capture {
  const cap: Capture = { value: 0, count: 0, from: [], hadConvoy: false };
  for (const ship of ships) {
    if (!ship.alive) continue;
    const sp = shipPos(ship, lanes);
    if (haversineKm(pos, sp) > SPOT_RANGE_KM) continue;
    cap.value += ship.type.points;
    cap.count++;
    cap.from.push(sp);
    if (ship.type.key === "convoy") cap.hadConvoy = true;
    sendOnward(ship, lanes, rng, pos);
  }
  return cap;
}

// ---- hold, haul and the Navy ----------------------------------------------

/** Every raid since the last haul adds half a multiplier, up to x4 (six raids). */
export function holdMultiplier(raidsSinceHaul: number): number {
  return Math.min(MAX_MULT, 1 + 0.5 * Math.max(0, raidsSinceHaul));
}

export function haulValue(hold: number, raidsSinceHaul: number): number {
  return Math.round(hold * holdMultiplier(raidsSinceHaul));
}

export interface HoldInfo {
  id: string;
  hold: number;
  raidsSinceHaul: number;
}

/** The Navy hunts the richest unbanked hold. Null when nobody carries loot. */
export function pickHuntTarget(holds: readonly HoldInfo[]): string | null {
  let best: string | null = null;
  let bestValue = 0;
  for (const h of holds) {
    const v = haulValue(h.hold, h.raidsSinceHaul);
    if (v > bestValue) {
      bestValue = v;
      best = h.id;
    }
  }
  return best;
}

export function huntGap(elapsed: number): number {
  return elapsed >= HIGH_TIDE_S ? HUNT_GAP_TIDE_S : HUNT_GAP_S;
}

export function tideSpeed(elapsed: number): number {
  return elapsed >= HIGH_TIDE_S ? HIGH_TIDE_SPEED : 1;
}

export interface Prize {
  ll: LatLng;
  value: number;
  remaining: number;
  name: string;
}

/** Seized loot is dumped at a chokepoint far from the victim: first net over it wins it. */
export function spawnPrize(
  rng: Rng,
  doors: readonly { ll: LatLng; name: string }[],
  avoid: LatLng,
  value: number,
): Prize {
  const far = doors.filter((d) => haversineKm(d.ll, avoid) >= PRIZE_MIN_KM);
  const pool = far.length > 0 ? far : doors;
  const door = rng.pick(pool) ?? doors[0]!;
  return { ll: door.ll, value: Math.max(20, Math.round(value)), remaining: PRIZE_LIFE_S, name: door.name };
}

export function prizeInRange(prize: Prize | null, pos: LatLng): boolean {
  return prize !== null && haversineKm(prize.ll, pos) <= SPOT_RANGE_KM;
}

/** What a raid from `pos` would take right now: vessels plus any prize sitting in the net. */
export function netValue(ships: readonly Ship[], pos: LatLng, lanes: readonly Lane[], prize: Prize | null): number {
  return scoreShipsInRange(ships, pos, lanes) + (prizeInRange(prize, pos) ? prize!.value : 0);
}

/** The underdog tag only means something once the leader has real loot. */
export const UNDERDOG_MIN_LEAD = 60;

/** Last place, clearly behind the leader: moves recharge twice as fast. */
export function isUnderdog(id: string, totals: readonly { id: string; total: number }[]): boolean {
  if (totals.length < 2) return false;
  let lead = -Infinity;
  let low = Infinity;
  let lowId: string | null = null;
  for (const t of totals) {
    if (t.total > lead) lead = t.total;
    if (t.total < low) {
      low = t.total;
      lowId = t.id;
    }
  }
  return lowId === id && lead >= UNDERDOG_MIN_LEAD && low < lead * 0.75;
}

/** "near Malacca": the chokepoint or port closest to the middle of a lane. */
export function laneLabel(lane: Lane): string {
  const mid = lanePos(lane, lane.lengthKm / 2);
  let bestName = "open ocean";
  let bestKm = Infinity;
  for (const d of DOORS) {
    const km = haversineKm(d.ll, mid);
    if (km < bestKm) { bestKm = km; bestName = d.name; }
  }
  for (const p of PORTS) {
    const km = haversineKm(p.ll, mid);
    if (km < bestKm) { bestKm = km; bestName = p.name; }
  }
  return `near ${bestName}`;
}

/** Spawn a convoy pack: 3-5 ships on the same lane near the same km position. */
export function spawnConvoyPack(rng: Rng, lanes: readonly Lane[]): Ship[] {
  const count = rng.int(3, 5);
  const laneIdx = rng.int(0, lanes.length - 1);
  const lane = lanes[laneIdx]!;
  const baseKm = rng.next() * lane.lengthKm;
  const dir: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
  const pack: Ship[] = [];
  for (let i = 0; i < count; i++) {
    const km = Math.max(0, Math.min(lane.lengthKm, baseKm + (rng.next() - 0.5) * 200));
    pack.push({
      id: nextId++,
      type: pickType(rng),
      laneIdx,
      dir,
      km,
      driftLat: (rng.next() - 0.5) * DRIFT_MAX * 2,
      driftLng: (rng.next() - 0.5) * DRIFT_MAX * 2,
      alive: true,
      speedMult: randomSpeedMult(rng),
    });
  }
  return pack;
}

/** Gold rush event state. */
export interface GoldRush {
  laneIdx: number;
  remaining: number;
}

/** Maybe start a gold rush on a random lane. */
export function maybeStartGoldRush(rng: Rng, lanes: readonly Lane[], current: GoldRush | null): GoldRush | null {
  if (current && current.remaining > 0) return current;
  // ~2% chance per tick (0.4s ticks, so roughly every ~20s on average)
  if (rng.next() < 0.02) {
    return { laneIdx: rng.int(0, lanes.length - 1), remaining: 10 };
  }
  return null;
}

/** Spawn extra treasure/convoy ships for a gold rush lane. */
export function spawnGoldRushShips(rng: Rng, lanes: readonly Lane[], laneIdx: number): Ship[] {
  const lane = lanes[laneIdx]!;
  const count = rng.int(2, 4);
  const ships: Ship[] = [];
  const treasureTypes = SHIP_TYPES.filter((t) => t.key === "treasure" || t.key === "convoy");
  for (let i = 0; i < count; i++) {
    ships.push({
      id: nextId++,
      type: rng.pick(treasureTypes)!,
      laneIdx,
      dir: rng.next() < 0.5 ? 1 : -1,
      km: rng.next() * lane.lengthKm,
      driftLat: (rng.next() - 0.5) * DRIFT_MAX * 2,
      driftLng: (rng.next() - 0.5) * DRIFT_MAX * 2,
      alive: true,
      speedMult: randomSpeedMult(rng),
    });
  }
  return ships;
}

export interface ParkingSpot {
  ll: LatLng;
  parked: boolean;
  score: number;
}

export function botPickSpot(
  rng: Rng,
  ships: readonly Ship[],
  lanes: readonly Lane[],
  doors: readonly { ll: LatLng }[],
  takenSpots: readonly ParkingSpot[],
  prize: Prize | null = null,
): LatLng {
  let bestScore = -1;
  let bestLL = doors[0]!.ll;
  // Build candidates from doors + random lane positions
  const candidates: LatLng[] = doors.map((d) => d.ll);
  if (prize) candidates.push(prize.ll);
  // Add some random lane positions so bots don't only pick doors
  for (let i = 0; i < 6; i++) {
    const li = rng.int(0, lanes.length - 1);
    const lane = lanes[li]!;
    const km = rng.next() * lane.lengthKm;
    candidates.push(lanePos(lane, km));
  }
  for (const c of candidates) {
    const taken = takenSpots.some(
      (s) => s.parked && haversineKm(s.ll, c) < 100,
    );
    if (taken) continue;
    const score = netValue(ships, c, lanes, prize);
    const jitter = rng.next() * 0.5;
    if (score + jitter > bestScore) {
      bestScore = score + jitter;
      bestLL = c;
    }
  }
  return bestLL;
}
