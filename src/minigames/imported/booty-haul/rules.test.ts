import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import { buildLanes, DOORS } from "./geo";
import {
  advanceShips,
  botPickSpot,
  FLEET_SIZE,
  scoreShipsInRange,
  shipPos,
  SHIP_TYPES,
  spawnFleet,
  spawnShip,
} from "./rules";

const lanes = buildLanes();
const rng = () => new Rng(42);

describe("Park Your Pirate rules", () => {
  it("spawns a ship on a valid lane", () => {
    const ship = spawnShip(rng(), lanes);
    expect(ship.laneIdx).toBeGreaterThanOrEqual(0);
    expect(ship.laneIdx).toBeLessThan(lanes.length);
    expect(ship.alive).toBe(true);
  });

  it("spawns a full fleet", () => {
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

  it("advances ships along lanes", () => {
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

  it("bot picks a door to park at", () => {
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
});
