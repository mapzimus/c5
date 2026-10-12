import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import { BOARD, DropWorld } from "./physics";
import {
  SPRINT, STAGES, SharedDeck, beatLength, botBeat, botWantsShake, bustPenalty, clockText, isOverdrive, layout,
  rollSprintTier, shakeCost, stageIndex,
} from "./sprint-rules";

describe("Lucky Drop sprint rules", () => {
  it("stages escalate: odds sum to 100, beats only get faster, OVERDRIVE is last and doubles", () => {
    for (const stage of STAGES) expect(stage.odds.reduce((a, b) => a + b, 0)).toBe(100);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i]!.at).toBeGreaterThan(STAGES[i - 1]!.at);
      expect(STAGES[i]!.beat).toBeLessThan(STAGES[i - 1]!.beat);
    }
    expect(STAGES.at(-1)!.multiplier).toBe(2);
    expect(STAGES.slice(0, -1).every(stage => stage.multiplier === 1)).toBe(true);
    expect(STAGES.at(-1)!.at).toBeLessThan(SPRINT.duration);
  });

  it("maps sprint seconds to stages and beat lengths", () => {
    expect(stageIndex(0)).toBe(0);
    expect(stageIndex(24.9)).toBe(0);
    expect(stageIndex(25)).toBe(1);
    expect(stageIndex(70)).toBe(3);
    expect(isOverdrive(69.9)).toBe(false);
    expect(isOverdrive(70)).toBe(true);
    expect(beatLength(0)).toBe(STAGES[0]!.beat);
    expect(beatLength(89)).toBe(STAGES[3]!.beat);
    expect(beatLength(0)).toBeGreaterThan(SPRINT.minBeat);
  });

  it("rolls only 1/2/4 at the start and adds 8s, then 16s, by time rather than score", () => {
    expect([0, 0.6499, 0.65, 0.8999, 0.9, 0.9999].map(n => rollSprintTier(n, 0))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(rollSprintTier(0.99, 24)).toBe(2);
    expect(rollSprintTier(0.99, 25)).toBe(3);
    expect(rollSprintTier(0.99, 50)).toBe(4);
  });

  it("a shared deck hands every board the same orb at each index, whatever their scores", () => {
    let clock = 0;
    const rng = new Rng(9);
    const deck = new SharedDeck(() => rng.next(), () => clock);
    const rich = new DropWorld(() => 0.5, () => 0.5, i => deck.at(i));
    const poor = new DropWorld(() => 0.5, () => 0.5, i => deck.at(i));
    rich.score = 50_000;
    for (let beat = 0; beat < 40; beat++) {
      clock = beat * 2.2;
      expect([rich.next, rich.queued]).toEqual([poor.next, poor.queued]);
      rich.balls = []; poor.balls = [];
      rich.time += 1; poor.time += 1;
      expect(rich.drop(240)).toBe(true);
      expect(poor.drop(100)).toBe(true);
    }
    // A fresh board after a bust resumes at the same index as everyone else.
    const reborn = new DropWorld(() => 0.5, () => 0.5, i => deck.at(rich.drops + i));
    expect([reborn.next, reborn.queued]).toEqual([poor.next, poor.queued]);
    expect(deck.rolled).toBe(42);
    expect(deck.at(30)).toBeGreaterThanOrEqual(0);
  });

  it("busting costs a quarter, rounded to tens, and never the banked points", () => {
    expect(bustPenalty(0)).toBe(0);
    expect(bustPenalty(1_000)).toBe(250);
    expect(bustPenalty(1_234)).toBe(310);
    expect(SPRINT.dangerLimit).toBeLessThan(3);
    expect(SPRINT.dangerLine).toBeGreaterThan(BOARD.danger);
    // A settled orb just under the sprint line is safe in classic but busts in sprint.
    const world = new DropWorld(() => 0.1);
    world.dangerLine = SPRINT.dangerLine;
    world.dangerLimit = SPRINT.dangerLimit;
    const ball = world.add(0, 240, SPRINT.dangerLine);
    ball.born = -10;
    for (let i = 0; i < Math.round(SPRINT.dangerLimit * 120) + 2; i++) { ball.y = SPRINT.dangerLine; ball.vy = 0; world.step(1 / 120); }
    expect(world.over).toBe(true);
  });

  it("the underdog charges a shake in four merges, the leader in six", () => {
    expect(shakeCost(100, 500)).toBe(SPRINT.underdogShakeCost);
    expect(shakeCost(500, 500)).toBe(SPRINT.shakeCost);
    expect(shakeCost(900, 500)).toBe(SPRINT.shakeCost);
    const world = new DropWorld(() => 0.1);
    world.charge = 4;
    expect(world.shake(6)).toBe(false);
    expect(world.shake(4)).toBe(true);
    expect(world.charge).toBe(0);
  });

  it("OVERDRIVE doubles merge points and milestone bonuses", () => {
    const world = new DropWorld(() => 0.1);
    world.multiplier = 2;
    world.add(6, 170, 550);
    world.add(6, 303, 550);
    for (let i = 0; i < 120; i++) world.step(1 / 120);
    expect(world.score).toBe((1280 + 1000) * 2);
    expect(world.topTier).toBe(7);
  });

  it("lays 1–4 boards side by side under the strip, inside the canvas, with a tappable shake button", () => {
    for (const n of [1, 2, 3, 4]) {
      const lay = layout(n, 1280, 720, 44);
      expect(lay.xs).toHaveLength(n);
      expect(lay.xs[0]!).toBeGreaterThanOrEqual(0);
      expect(lay.xs[n - 1]! + lay.boardW).toBeLessThanOrEqual(1280);
      expect(lay.boardY + lay.boardH + lay.footerH).toBeLessThanOrEqual(720);
      expect(lay.footerH - 6).toBeGreaterThanOrEqual(44);
      for (let i = 1; i < n; i++) expect(lay.xs[i]! - (lay.xs[i - 1]! + lay.boardW)).toBeCloseTo(lay.gap);
    }
    expect(layout(4, 1280, 720, 44).scale).toBeLessThan(layout(2, 1280, 720, 44).scale);
    expect(layout(2, 1280, 720, 90).footerH).toBeGreaterThanOrEqual(90);
  });

  it("formats the clock", () => {
    expect(clockText(90)).toBe("1:30");
    expect(clockText(9.2)).toBe("0:10");
    expect(clockText(0)).toBe("0:00");
    expect(clockText(-1)).toBe("0:00");
  });

  it("bots hesitate inside the beat, aim on the board, and are sometimes sloppy", () => {
    const rng = new Rng(3);
    const world = new DropWorld(() => 0.1);
    world.add(0, 240, 603).born = -10;
    const plans = Array.from({ length: 200 }, () => botBeat(world, 0, () => rng.next()));
    for (const plan of plans) {
      expect(plan.wait).toBeGreaterThanOrEqual(SPRINT.minBeat);
      expect(plan.wait).toBeLessThan(beatLength(0));
      expect(plan.aim).toBe(world.clampAim(plan.aim));
    }
    // The careful plan lands beside the lone 1 (an exposed match); sloppy ones go anywhere.
    const sloppy = plans.filter(plan => Math.abs(plan.aim - 240) > 40).length;
    expect(sloppy).toBeGreaterThan(4);
    expect(sloppy).toBeLessThan(60);
  });

  it("bots only shake when charged and the stack is tall", () => {
    const low = new DropWorld(() => 0.1);
    low.add(0, 240, 603);
    low.charge = 6;
    expect(botWantsShake(low, 6, () => 0)).toBe(false);
    const tall = new DropWorld(() => 0.1);
    tall.add(4, 240, 180);
    tall.charge = 4;
    expect(botWantsShake(tall, 6, () => 0)).toBe(false);
    expect(botWantsShake(tall, 4, () => 0)).toBe(true);
    expect(botWantsShake(tall, 4, () => 0.99)).toBe(false);
  });
});
