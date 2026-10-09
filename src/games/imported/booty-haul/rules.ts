import type { Rng } from "../../../core/rng";
import { haversineKm, lanePos, lanesFromPort, type Lane, type LatLng, PORTS } from "./geo";

export const SPOT_RANGE_KM = 200;
export const SHIP_SPEED_KM_S = 75;
export const FLEET_SIZE = 300;
export const DRIFT_MAX = 0.8;
export const DRIFT_FADE_KM = 300;
export const GAME_DURATION_S = 75;
export const REPARK_COUNT = 2;
export const STREAK_THRESHOLD = 3;

export interface ShipType {
  key: string;
  label: string;
  points: number;
  weight: number;
  color: string;
  size: number;
}

export const SHIP_TYPES: readonly ShipType[] = [
  { key: "cargo",    label: "Cargo",    points: 1,   weight: 0.55, color: "#64748b", size: 3 },
  { key: "tanker",   label: "Tanker",   points: 2,   weight: 0.25, color: "#f59e0b", size: 4 },
  { key: "treasure", label: "Treasure", points: 5,   weight: 0.12, color: "#a855f7", size: 5 },
  { key: "convoy",   label: "Convoy",   points: 10,  weight: 0.08, color: "#22d3ee", size: 6 },
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
): void {
  for (const ship of ships) {
    if (!ship.alive) continue;
    ship.km += SHIP_SPEED_KM_S * ship.speedMult * dt * ship.dir;
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

/**
 * Each passing vessel pays its listed value ONCE per captain: after a ship pays
 * you it is marked plundered (by id) for this long, which comfortably outlasts
 * the time it spends inside your 200 km spyglass.
 */
export const PLUNDER_COOLDOWN_S = 10;

/**
 * Sum the listed values of ships in range that have not paid this captain
 * recently, and mark them plundered. `plundered` maps ship id -> time paid.
 */
export function plunderShipsInRange(
  ships: readonly Ship[],
  pos: LatLng,
  lanes: readonly Lane[],
  plundered: Map<number, number>,
  now: number,
): { points: number; count: number } {
  let points = 0;
  let count = 0;
  for (const ship of ships) {
    if (!ship.alive) continue;
    const last = plundered.get(ship.id);
    if (last !== undefined && now - last < PLUNDER_COOLDOWN_S) continue;
    if (haversineKm(pos, shipPos(ship, lanes)) > SPOT_RANGE_KM) continue;
    plundered.set(ship.id, now);
    points += ship.type.points;
    count++;
  }
  return { points, count };
}

/** Listed value of the richest live ship inside the spyglass (0 if none). */
export function richestShipInRange(ships: readonly Ship[], pos: LatLng, lanes: readonly Lane[]): number {
  let best = 0;
  for (const ship of ships) {
    if (!ship.alive || ship.type.points <= best) continue;
    if (haversineKm(pos, shipPos(ship, lanes)) <= SPOT_RANGE_KM) best = ship.type.points;
  }
  return best;
}

/** A raid robs one ship for double its listed value, triple on the gold flash. */
export function raidValue(shipPoints: number, perfect: boolean): number {
  return shipPoints * (perfect ? 3 : 2);
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

/** Re-launch a sunk ship from a random port with a fresh cargo (keeps its id). */
export function respawnShip(ship: Ship, rng: Rng, lanes: readonly Lane[]): void {
  const fresh = spawnShip(rng, lanes);
  ship.type = fresh.type;
  ship.laneIdx = fresh.laneIdx;
  ship.dir = fresh.dir;
  ship.km = fresh.km;
  ship.driftLat = fresh.driftLat;
  ship.driftLng = fresh.driftLng;
  ship.speedMult = fresh.speedMult;
  ship.alive = true;
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

/** Bots keep at least this far from every other anchored captain when picking a spot. */
export const BOT_SPREAD_KM = 700;

/**
 * Pick a bot anchorage. Candidates are the landmark doors plus random lane
 * points; anything within `avoidKm` of another captain is skipped (with a
 * fallback to the least crowded spots), and the bot takes a random pick from
 * the top few, so a table of bots fans out instead of stacking on one door.
 */
export function botPickSpot(
  rng: Rng,
  ships: readonly Ship[],
  lanes: readonly Lane[],
  doors: readonly { ll: LatLng }[],
  takenSpots: readonly ParkingSpot[],
  avoidKm = BOT_SPREAD_KM,
): LatLng {
  const candidates: LatLng[] = doors.map((d) => d.ll);
  for (let i = 0; i < 10; i++) {
    const lane = lanes[rng.int(0, lanes.length - 1)]!;
    candidates.push(lanePos(lane, rng.next() * lane.lengthKm));
  }
  const parked = takenSpots.filter((s) => s.parked);
  const scored = candidates.map((ll) => {
    const nearest = parked.reduce((m, s) => Math.min(m, haversineKm(s.ll, ll)), Infinity);
    return { ll, nearest, value: scoreShipsInRange(ships, ll, lanes) + rng.next() * 3 };
  });
  let pool = scored.filter((c) => c.nearest >= avoidKm);
  if (pool.length === 0) {
    // Crowded sea: fall back to the roomiest third of the candidates.
    pool = [...scored].sort((a, b) => b.nearest - a.nearest).slice(0, Math.max(1, Math.ceil(scored.length / 3)));
  }
  pool.sort((a, b) => b.value - a.value);
  const top = pool.slice(0, Math.min(3, pool.length));
  return rng.pick(top).ll;
}
