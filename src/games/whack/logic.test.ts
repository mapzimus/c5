import { describe, expect, it } from "vitest";
import {
  BOMB_PENALTY,
  CLUTCH_BONUS,
  MAX_STAGE,
  OVERDRIVE_STAGE_TIME,
  STAGE_TIME,
  THIEF_STEAL,
  bombLoss,
  botWantsBonk,
  duckTime,
  feverMultiplier,
  hitValue,
  makeBrain,
  raidChance,
  raidTarget,
  rollKind,
  spawnInterval,
  stageAt,
  stageValue,
  stealAmount,
  whiffCombo,
} from "./logic";

describe("fatten", () => {
  it("pays 1, 2, 3, 5 by stage and more in OVERDRIVE", () => {
    expect([0, 1, 2, 3].map((s) => stageValue(s, false))).toEqual([1, 2, 3, 5]);
    expect([0, 1, 2, 3].map((s) => stageValue(s, true))).toEqual([2, 3, 5, 8]);
    expect(stageValue(-1, false)).toBe(1);
    expect(stageValue(99, false)).toBe(5);
  });

  it("climbs a stage every STAGE_TIME and caps at the fat stage", () => {
    expect(stageAt(0, false)).toBe(0);
    expect(stageAt(STAGE_TIME * 1.01, false)).toBe(1);
    expect(stageAt(STAGE_TIME * 3.5, false)).toBe(MAX_STAGE);
    expect(stageAt(STAGE_TIME * 9, false)).toBe(MAX_STAGE);
    expect(stageAt(OVERDRIVE_STAGE_TIME * 3.01, true)).toBe(MAX_STAGE);
  });

  it("a fat critter is reachable but not guaranteed, and the window shrinks as the match ramps", () => {
    const fatAt = STAGE_TIME * MAX_STAGE;
    const early = [...Array(100)].map((_, i) => duckTime(i / 100, 0)).filter((t) => t > fatAt).length;
    const late = [...Array(100)].map((_, i) => duckTime(i / 100, 1)).filter((t) => t > fatAt).length;
    expect(early).toBeGreaterThan(40);
    expect(early).toBeLessThan(70);
    expect(late).toBeGreaterThan(10);
    expect(late).toBeLessThan(early);
    expect(duckTime(0, 0)).toBeGreaterThanOrEqual(0.55);
  });

  it("values hits: stage, clutch bonus, golden, raider, nothing for bombs and thieves", () => {
    expect(hitValue("normal", 3, 1, false)).toEqual({ points: 5, clutch: false });
    expect(hitValue("normal", 0, 0.05, false)).toEqual({ points: 1 + CLUTCH_BONUS, clutch: true });
    expect(hitValue("golden", 0, 1, false).points).toBe(10);
    expect(hitValue("raider", 0, 1, false).points).toBe(1);
    expect(hitValue("bomb", 0, 1, false).points).toBe(0);
    expect(hitValue("thief", 0, 1, false).points).toBe(0);
    expect(feverMultiplier(2)).toBe(2);
    expect(feverMultiplier(0)).toBe(1);
  });

  it("spawns speed up over the match", () => {
    expect(spawnInterval(1)).toBeLessThan(spawnInterval(0));
    expect(spawnInterval(2)).toBe(spawnInterval(1));
  });
});

describe("raids", () => {
  it("only players behind the leader get raiders, the sole last place the most", () => {
    expect(raidChance(0, [20, 10, 5])).toBe(0);
    expect(raidChance(0, [10, 10])).toBe(0);
    expect(raidChance(1, [20, 10, 5])).toBeCloseTo(0.07);
    expect(raidChance(2, [20, 10, 5])).toBeCloseTo(0.14);
    expect(raidChance(1, [12, 10])).toBeCloseTo(0.035);
    expect(raidChance(1, [12, 10, 10])).toBeCloseTo(0.035);
    expect(raidChance(0, [5])).toBe(0);
  });

  it("targets the highest other score, lowest seat on ties", () => {
    expect(raidTarget(2, [20, 10, 5])).toBe(0);
    expect(raidTarget(0, [20, 10, 5])).toBe(1);
    expect(raidTarget(1, [7, 3, 7])).toBe(0);
    expect(raidTarget(0, [3])).toBeNull();
  });

  it("a thief takes 5 but never more than the victim has", () => {
    expect(stealAmount(20)).toBe(THIEF_STEAL);
    expect(stealAmount(3)).toBe(3);
    expect(stealAmount(0)).toBe(0);
  });
});

describe("penalties and spawns", () => {
  it("bombs cost up to 5, whiffs cost two combo steps", () => {
    expect(bombLoss(12)).toBe(BOMB_PENALTY);
    expect(bombLoss(2)).toBe(2);
    expect(whiffCombo(5)).toBe(3);
    expect(whiffCombo(1)).toBe(0);
  });

  it("rolls bombs, gold, raiders then normals; fewer bombs in FEVER", () => {
    expect(rollKind(0.05, { fever: false, raid: 0 })).toBe("bomb");
    expect(rollKind(0.04, { fever: true, raid: 0 })).toBe("bomb");
    expect(rollKind(0.06, { fever: true, raid: 0 })).toBe("golden");
    expect(rollKind(0.08, { fever: true, raid: 0 })).toBe("golden");
    expect(rollKind(0.12, { fever: false, raid: 0 })).toBe("golden");
    expect(rollKind(0.2, { fever: false, raid: 0.14 })).toBe("raider");
    expect(rollKind(0.2, { fever: false, raid: 0 })).toBe("normal");
    expect(rollKind(0.9, { fever: false, raid: 0.14 })).toBe("normal");
  });
});

describe("bots", () => {
  const brain = { greed: 2, twitch: 8, tellRead: 0.6, bombSlip: 0.1 };

  it("wait for the stage they are greedy for, unless the critter wobbles", () => {
    const thin = { kind: "normal" as const, stage: 0, upFor: 0.3, lifeLeft: 1 };
    expect(botWantsBonk(brain, thin, 1 / 60, 0)).toBe(false);
    const fat = { ...thin, stage: 2 };
    expect(botWantsBonk(brain, fat, 1 / 60, 0)).toBe(true);
    expect(botWantsBonk(brain, fat, 1 / 60, 0.99)).toBe(false);
    const wobbling = { ...thin, lifeLeft: 0.1 };
    expect(botWantsBonk(brain, wobbling, 1 / 60, 0)).toBe(true);
    expect(botWantsBonk(brain, { ...fat, upFor: 0.05 }, 1 / 60, 0)).toBe(false);
  });

  it("rarely slap bombs, block thieves, grab gold fast", () => {
    expect(botWantsBonk(brain, { kind: "bomb", stage: 0, upFor: 0.8, lifeLeft: 0.4 }, 1 / 60, 0.0001)).toBe(true);
    expect(botWantsBonk(brain, { kind: "bomb", stage: 0, upFor: 0.8, lifeLeft: 0.4 }, 1 / 60, 0.01)).toBe(false);
    expect(botWantsBonk(brain, { kind: "thief", stage: 0, upFor: 0.5, lifeLeft: 0.8 }, 1 / 60, 0.1)).toBe(true);
    expect(botWantsBonk(brain, { kind: "golden", stage: 0, upFor: 0.2, lifeLeft: 0.3 }, 1 / 60, 0.3)).toBe(true);
  });

  it("have personalities drawn from the rng", () => {
    let i = 0;
    const seq = [0.1, 0.5, 0.5, 0.5, 0.9, 0.5, 0.5, 0.5];
    const rand = () => seq[i++ % seq.length] ?? 0.5;
    const a = makeBrain(rand);
    const b = makeBrain(rand);
    expect(a.greed).toBe(1);
    expect(b.greed).toBe(3);
    expect(a.twitch).toBeGreaterThan(0);
    expect(a.bombSlip).toBeLessThan(0.2);
  });
});
