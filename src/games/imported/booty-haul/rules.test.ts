import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import { buildLanes, DOORS } from "./geo";
import {
  advanceShips,
  botPickSpot,
  captureShips,
  FLEET_SIZE,
  haulValue,
  HIGH_TIDE_S,
  HIGH_TIDE_SPEED,
  holdMultiplier,
  huntGap,
  HUNT_GAP_S,
  HUNT_GAP_TIDE_S,
  isUnderdog,
  laneLabel,
  MAX_MULT,
  netValue,
  pickHuntTarget,
  PRIZE_MIN_KM,
  prizeInRange,
  scoreShipsInRange,
  sendOnward,
  shipPos,
  SHIP_TYPES,
  spawnFleet,
  spawnShip,
  spawnConvoyPack,
  spawnGoldRushShips,
  spawnPrize,
  SPOT_RANGE_KM,
  tideSpeed,
} from "./rules";
import { haversineKm } from "./geo";

const lanes = buildLanes();
const rng = () => new Rng(42);

describe("Booty Haul rules", () => {
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

  it("a raid captures every vessel in the net and empties the water", () => {
    const r = rng();
    const fleet = spawnFleet(r, lanes, FLEET_SIZE);
    const pos = shipPos(fleet[0]!, lanes);
    const before = scoreShipsInRange(fleet, pos, lanes);
    expect(before).toBeGreaterThan(0);
    const cap = captureShips(fleet, pos, lanes, r);
    expect(cap.value).toBe(before);
    expect(cap.count).toBeGreaterThan(0);
    expect(cap.from).toHaveLength(cap.count);
    expect(scoreShipsInRange(fleet, pos, lanes)).toBe(0);
    expect(fleet).toHaveLength(FLEET_SIZE);
    for (const ship of fleet) expect(ship.alive).toBe(true);
  });

  it("captured vessels respawn well away from the net", () => {
    const r = rng();
    const ship = spawnShip(r, lanes);
    const pos = shipPos(ship, lanes);
    for (let i = 0; i < 20; i++) {
      sendOnward(ship, lanes, r, pos);
      expect(haversineKm(shipPos(ship, lanes), pos)).toBeGreaterThan(SPOT_RANGE_KM * 2);
    }
  });

  it("hold multiplier climbs half a step per raid and caps at x4", () => {
    expect(holdMultiplier(0)).toBe(1);
    expect(holdMultiplier(1)).toBe(1.5);
    expect(holdMultiplier(2)).toBe(2);
    expect(holdMultiplier(6)).toBe(MAX_MULT);
    expect(holdMultiplier(40)).toBe(MAX_MULT);
    expect(haulValue(100, 2)).toBe(200);
    expect(haulValue(0, 6)).toBe(0);
  });

  it("the Navy hunts the richest hold, counting the multiplier, and nobody when holds are empty", () => {
    expect(pickHuntTarget([{ id: "a", hold: 0, raidsSinceHaul: 0 }, { id: "b", hold: 0, raidsSinceHaul: 3 }])).toBeNull();
    expect(pickHuntTarget([{ id: "a", hold: 50, raidsSinceHaul: 0 }, { id: "b", hold: 30, raidsSinceHaul: 2 }])).toBe("b");
    expect(pickHuntTarget([{ id: "a", hold: 50, raidsSinceHaul: 0 }, { id: "b", hold: 10, raidsSinceHaul: 1 }])).toBe("a");
  });

  it("seized loot becomes a prize at a chokepoint far from the victim", () => {
    const victim = DOORS[0]!.ll;
    for (let i = 0; i < 10; i++) {
      const prize = spawnPrize(new Rng(i), DOORS, victim, 137.4);
      expect(haversineKm(prize.ll, victim)).toBeGreaterThanOrEqual(PRIZE_MIN_KM);
      expect(prize.value).toBe(137);
      expect(prize.remaining).toBeGreaterThan(0);
      expect(DOORS.some((d) => d.name === prize.name)).toBe(true);
    }
    expect(spawnPrize(rng(), DOORS, victim, 3).value).toBe(20);
  });

  it("a prize in the net counts toward what a raid would take", () => {
    const fleet = spawnFleet(rng(), lanes, 0);
    const door = DOORS[2]!;
    const prize = { ll: door.ll, value: 80, remaining: 10, name: door.name };
    expect(prizeInRange(prize, door.ll)).toBe(true);
    expect(prizeInRange(prize, DOORS[5]!.ll)).toBe(false);
    expect(prizeInRange(null, door.ll)).toBe(false);
    expect(netValue(fleet, door.ll, lanes, prize)).toBe(80);
    expect(netValue(fleet, DOORS[5]!.ll, lanes, prize)).toBe(0);
  });

  it("bots consider the prize when picking a spot", () => {
    const fleet = spawnFleet(rng(), lanes, 0);
    const door = DOORS[4]!;
    const prize = { ll: door.ll, value: 500, remaining: 10, name: door.name };
    const ll = botPickSpot(rng(), fleet, lanes, DOORS, [], prize);
    expect(haversineKm(ll, door.ll)).toBeLessThan(1);
  });

  it("high tide speeds the traffic and the hunts", () => {
    expect(tideSpeed(0)).toBe(1);
    expect(tideSpeed(HIGH_TIDE_S)).toBe(HIGH_TIDE_SPEED);
    expect(huntGap(0)).toBe(HUNT_GAP_S);
    expect(huntGap(HIGH_TIDE_S + 1)).toBe(HUNT_GAP_TIDE_S);
    const r = rng();
    const slow = spawnShip(r, lanes);
    const fast = { ...slow };
    slow.km = fast.km = 1000;
    advanceShips([slow], lanes, 1, r, 1);
    advanceShips([fast], lanes, 1, r, HIGH_TIDE_SPEED);
    expect(Math.abs(fast.km - 1000)).toBeCloseTo(Math.abs(slow.km - 1000) * HIGH_TIDE_SPEED, 5);
  });

  it("only a clearly trailing last place is the underdog", () => {
    const totals = [{ id: "a", total: 100 }, { id: "b", total: 40 }, { id: "c", total: 90 }];
    expect(isUnderdog("b", totals)).toBe(true);
    expect(isUnderdog("a", totals)).toBe(false);
    expect(isUnderdog("c", totals)).toBe(false);
    expect(isUnderdog("b", [{ id: "a", total: 100 }, { id: "b", total: 80 }])).toBe(false);
    expect(isUnderdog("b", [{ id: "a", total: 0 }, { id: "b", total: 0 }])).toBe(false);
    expect(isUnderdog("b", [{ id: "a", total: 30 }, { id: "b", total: 0 }])).toBe(false);
    expect(isUnderdog("a", [{ id: "a", total: 0 }])).toBe(false);
  });

  it("names a gold rush lane by the nearest chokepoint or port", () => {
    expect(laneLabel(lanes[5]!)).toBe("near Boston");
    for (const lane of lanes) expect(laneLabel(lane)).toMatch(/^near /);
  });
});
