import { describe, it, expect } from "vitest";
import { ALL_PERKS, applyPerk, getPlayerPerks, applyLaunchPerks, createDraft, startDraft, getPerk } from "../perks";
import type { Disc, MatchPlayer } from "../types";
import { TUNING } from "../types";

function makePlayer(id = 0): MatchPlayer {
  return {
    id,
    name: "Test",
    color: "#fff",
    light: "#fff",
    wins: 0,
    kos: 0,
    ownGoals: 0,
    ready: false,
    dir: { x: 0, y: -1 },
    perks: [],
    kind: "human",
    slot: id,
  };
}

function makeDisc(owner = 0): Disc {
  return {
    id: 1, owner, x: 0, y: 0, vx: 0, vy: 0,
    r: TUNING.discRadius, baseR: TUNING.discRadius, mass: 1,
    inst: null, aim: null, grab: null,
    falling: false, fallT: 0, dead: false, spawnT: 1,
    look: 0, giant: 0, turbo: false, bomb: false, life: false, saveT: 0,
    perks: [],
  };
}

describe("Perks", () => {
  it("has 12 perks defined for v1", () => {
    expect(ALL_PERKS.length).toBe(12);
  });

  it("each perk has a unique id", () => {
    const ids = ALL_PERKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("applyPerk adds perk id to player", () => {
    const player = makePlayer();
    applyPerk("heavy-hitter", player);
    expect(player.perks).toContain("heavy-hitter");
  });

  it("applyPerk does not duplicate", () => {
    const player = makePlayer();
    applyPerk("heavy-hitter", player);
    applyPerk("heavy-hitter", player);
    expect(player.perks.filter((p) => p === "heavy-hitter")).toHaveLength(1);
  });

  it("heavy-hitter gives 30% speed boost on launch", () => {
    const player = makePlayer();
    applyPerk("heavy-hitter", player);
    const disc = makeDisc();
    const mods = applyLaunchPerks(disc, player);
    expect(mods.speedMul).toBeCloseTo(1.3);
  });

  it("startDraft offers 3 choices excluding owned perks", () => {
    const player = makePlayer();
    applyPerk("heavy-hitter", player);
    const draft = createDraft();
    let i = 0;
    startDraft(draft, 0, [player], () => { i++; return (i * 0.37) % 1; });
    expect(draft.active).toBe(true);
    expect(draft.choices.length).toBeLessThanOrEqual(3);
    expect(draft.choices.every((c) => c.id !== "heavy-hitter")).toBe(true);
  });

  it("getPerk returns perk by id", () => {
    const p = getPerk("iron-wall");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Iron Wall");
  });

  it("getPlayerPerks resolves perk objects", () => {
    const player = makePlayer();
    applyPerk("ghost-step", player);
    applyPerk("chaos-orb", player);
    const perks = getPlayerPerks(player);
    expect(perks).toHaveLength(2);
    expect(perks[0]!.id).toBe("ghost-step");
  });
});
