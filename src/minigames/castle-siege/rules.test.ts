import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import {
  SHOTS_PER_TEAM,
  WIND_MAX,
  baseCount,
  countTotal,
  drawPieces,
  nextShooter,
  outcome,
  rollWind,
  teamOf,
} from "./rules";
import { CANNONS, GROUND_Y, SiegeWorld, ZONES, makePieceBody } from "./world";

describe("castle siege rules", () => {
  it("draws exactly the game size, same seed same pieces", () => {
    expect(countTotal(drawPieces(new Rng(7), 20))).toBe(20);
    expect(countTotal(drawPieces(new Rng(7), 40))).toBe(40);
    expect(drawPieces(new Rng(7), 40)).toEqual(drawPieces(new Rng(7), 40));
  });

  it("uses 2 base pieces for 20 and 4 for 40", () => {
    expect(baseCount(20)).toBe(2);
    expect(baseCount(40)).toBe(4);
  });

  it("keeps wind whole and inside ±max, centered near zero", () => {
    const rng = new Rng(3);
    const winds = Array.from({ length: 2000 }, () => rollWind(rng));
    expect(winds.every((w) => Number.isInteger(w) && Math.abs(w) <= WIND_MAX)).toBe(true);
    const mean = winds.reduce((a, b) => a + b, 0) / winds.length;
    expect(Math.abs(mean)).toBeLessThan(1);
  });

  it("alternates seats into teams", () => {
    expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1]);
  });

  it("fewest standing loses", () => {
    expect(outcome([3, 5])).toBe(1);
    expect(outcome([4, 0])).toBe(0);
    expect(outcome([2, 2])).toBe("draw");
  });

  it("alternates shooters until both are out of shots", () => {
    expect(nextShooter([1, 0], 0)).toBe(1);
    expect(nextShooter([SHOTS_PER_TEAM, SHOTS_PER_TEAM - 1], 1)).toBe(1);
    expect(nextShooter([SHOTS_PER_TEAM, SHOTS_PER_TEAM], 1)).toBeNull();
  });
});

describe("castle siege world", () => {
  it("keeps pieces resting on a base and removes pieces on the ground", () => {
    const world = new SiegeWorld();
    const cx = (ZONES[0].x0 + ZONES[0].x1) / 2;
    const base = makePieceBody("block", cx, 0, 0, 0, true);
    world.snapToGround(base);
    world.addPiece({ body: base, team: 0, kind: "block", base: true });
    const onTop = makePieceBody("cube", cx, 0, 0, 0, false);
    expect(world.dropFromTop(onTop)).toBe(true);
    world.addPiece({ body: onTop, team: 0, kind: "cube", base: false });
    const loose = makePieceBody("cube", ZONES[0].x0 + 30, GROUND_Y - 22, 0, 0, false);
    world.addPiece({ body: loose, team: 0, kind: "cube", base: false });
    for (let i = 0; i < 180; i += 1) world.step(1 / 60);
    expect(world.eliminateGrounded()).toEqual([1, 0]);
    expect(world.standing(0)).toBe(1);
    world.destroy();
  });

  it("records drift in the direction the wind blows", () => {
    const world = new SiegeWorld();
    world.wind = 10;
    world.fire(0, 11, -11);
    for (let i = 0; i < 300 && world.shotPending(); i += 1) world.step(1 / 60);
    expect(world.shots).toHaveLength(1);
    expect(world.shots[0]!.drift).toBeGreaterThan(0);
    expect(CANNONS[0].x).toBeLessThan(ZONES[0].x0);
    world.destroy();
  });
});
