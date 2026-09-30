import type { Rng } from "../../../core/rng";
import { haversineKm, lanePos, lanesFromPort, type Lane, type LatLng, PORTS } from "./geo";

export const SPOT_RANGE_KM = 200;
export const SHIP_SPEED_KM_S = 60;
export const VOYAGE_SECONDS = 60;
export const FLEET_SIZE = 120;
export const DRIFT_MAX = 0.4;
export const DRIFT_FADE_KM = 300;
export const GAME_DURATION_S = 90;

export interface ShipType {
  key: string;
  label: string;
  points: number;
  weight: number;
  color: string;
  size: number;
}

export const SHIP_TYPES: readonly ShipType[] = [
  { key: "cargo",    label: "Cargo",    points: 1,  weight: 0.68, color: "#64748b", size: 4 },
  { key: "tanker",   label: "Tanker",   points: 2,  weight: 0.24, color: "#f59e0b", size: 5 },
  { key: "treasure", label: "Treasure", points: 5,  weight: 0.08, color: "#a855f7", size: 6 },
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
}

let nextId = 0;

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
    ship.km += SHIP_SPEED_KM_S * dt * ship.dir;
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
): LatLng {
  let bestScore = -1;
  let bestLL = doors[0]!.ll;
  const candidates = doors.map((d) => d.ll);
  for (const c of candidates) {
    const taken = takenSpots.some(
      (s) => s.parked && haversineKm(s.ll, c) < 100,
    );
    if (taken) continue;
    const score = scoreShipsInRange(ships, c, lanes);
    const jitter = rng.next() * 0.5;
    if (score + jitter > bestScore) {
      bestScore = score + jitter;
      bestLL = c;
    }
  }
  return bestLL;
}
