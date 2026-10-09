import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import { buildLanes, DOORS, haversineKm } from "./geo";
import {
  advanceShips,
  botPickSpot,
  BOT_SPREAD_KM,
  FLEET_SIZE,
  PLUNDER_COOLDOWN_S,
  plunderShipsInRange,
  raidValue,
  richestShipInRange,
  scoreShipsInRange,
  shipPos,
  SHIP_TYPES,
  spawnFleet,
  spawnShip,
  spawnConvoyPack,
  spawnGoldRushShips,
  type ParkingSpot,
} from "./rules";

const lanes = buildLanes();
const rng = () => new Rng(42);

describe("Park Your Pirate rules", () => {
  it("spawns a ship on a valid lane with speedMult", () => {
    const ship = spawnShip(rng(), lanes);
    expect(ship.laneIdx).toBeGreaterThanOrEqual(0);
    expect(ship.laneIdx).toBeLessThan(lanes.length);
    expect(ship.alive).toBe(true);
    expect(ship.speedMult).toBeGreaterThanOrEqual(0.7);
    expect(ship.speedMult).toBeLessThanOrEqual(1.3);
  });

  it("spawns a full fleet of 300", () => {
    expect(FLEET_SIZE).toBe(300);
    const fleet = spawnFleet(rng(), lanes, FLEET_SIZE);
    expect(fleet).toHaveLength(FLEET_SIZE);
    for (const ship of fleet) {
      expect(ship.km).toBeGreaterThanOrEqual(0);
      expect(ship.km).toBeLessThanOrEqual(lanes[ship.laneIdx]!.lengthKm);
    }
  });

  it("ship types have correct weights summing to 1", () => {
    const sum = SHIP_TYPES.reduce((a, t) => a + t.weight, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("advances ships along lanes using speedMult", () => {
    const fleet = spawnFleet(rng(), lanes, 10);
    const before = fleet.map((s) => s.km);
    advanceShips(fleet, lanes, 1, rng());
    const moved = fleet.some((s, i) => s.km !== before[i]);
    expect(moved).toBe(true);
  });

  it("shipPos returns valid lat/lng", () => {
    const ship = spawnShip(rng(), lanes);
    const pos = shipPos(ship, lanes);
    expect(pos[0]).toBeGreaterThan(-90);
    expect(pos[0]).toBeLessThan(90);
    expect(pos[1]).toBeGreaterThanOrEqual(-180);
    expect(pos[1]).toBeLessThanOrEqual(180);
  });

  it("scores ships within spotting range", () => {
    const fleet = spawnFleet(rng(), lanes, FLEET_SIZE);
    const door = DOORS[0]!;
    const score = scoreShipsInRange(fleet, door.ll, lanes);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("bot picks a spot to park at (doors or lane points)", () => {
    const fleet = spawnFleet(rng(), lanes, FLEET_SIZE);
    const ll = botPickSpot(rng(), fleet, lanes, DOORS, []);
    expect(ll[0]).toBeGreaterThan(-90);
    expect(ll[0]).toBeLessThan(90);
  });

  it("ships that reach lane end get re-outfitted", () => {
    const r = rng();
    const ship = spawnShip(r, lanes);
    ship.km = lanes[ship.laneIdx]!.lengthKm - 1;
    ship.dir = 1;
    advanceShips([ship], lanes, 100, r);
    expect(ship.alive).toBe(true);
  });

  it("spawns convoy packs of 3-5 ships on same lane", () => {
    const pack = spawnConvoyPack(rng(), lanes);
    expect(pack.length).toBeGreaterThanOrEqual(3);
    expect(pack.length).toBeLessThanOrEqual(5);
    const laneIdx = pack[0]!.laneIdx;
    for (const ship of pack) {
      expect(ship.laneIdx).toBe(laneIdx);
      expect(ship.speedMult).toBeGreaterThanOrEqual(0.7);
      expect(ship.speedMult).toBeLessThanOrEqual(1.3);
    }
  });

  it("gold rush spawns treasure/convoy ships on target lane", () => {
    const r = rng();
    const laneIdx = 0;
    const ships = spawnGoldRushShips(r, lanes, laneIdx);
    expect(ships.length).toBeGreaterThanOrEqual(2);
    expect(ships.length).toBeLessThanOrEqual(4);
    for (const ship of ships) {
      expect(ship.laneIdx).toBe(laneIdx);
      expect(["treasure", "convoy"]).toContain(ship.type.key);
    }
  });

  it("ship values are small and readable", () => {
    expect(SHIP_TYPES.map((t) => t.points)).toEqual([1, 2, 5, 10]);
  });

  it("each passing ship pays its listed value once, not every tick", () => {
    const ship = spawnShip(rng(), lanes);
    const pos = shipPos(ship, lanes);
    const plundered = new Map<number, number>();
    expect(plunderShipsInRange([ship], pos, lanes, plundered, 0)).toEqual({ points: ship.type.points, count: 1 });
    expect(plunderShipsInRange([ship], pos, lanes, plundered, 0.4).points).toBe(0);
    expect(plunderShipsInRange([ship], pos, lanes, plundered, PLUNDER_COOLDOWN_S + 1).points).toBe(ship.type.points);
  });

  it("raids rob the richest ship in range for 2x (3x on the beat)", () => {
    const fleet = spawnFleet(rng(), lanes, 3);
    const pos = shipPos(fleet[0]!, lanes);
    expect(richestShipInRange(fleet, pos, lanes)).toBeGreaterThanOrEqual(fleet[0]!.type.points);
    expect(raidValue(10, false)).toBe(20);
    expect(raidValue(10, true)).toBe(30);
  });

  it("bots fan out instead of stacking on the same spot", () => {
    const r = new Rng(7);
    const fleet = spawnFleet(r, lanes, FLEET_SIZE);
    const taken: ParkingSpot[] = [];
    for (let i = 0; i < 3; i++) {
      const ll = botPickSpot(r, fleet, lanes, DOORS, taken);
      for (const t of taken) expect(haversineKm(t.ll, ll)).toBeGreaterThanOrEqual(BOT_SPREAD_KM);
      taken.push({ ll, parked: true, score: 0 });
    }
  });
});
