import { describe, expect, it } from "vitest";
import {
  HEAT_CAP, LAVA_ROUND, PANEL_H, botGustDir, botSwatChance, draftOrder, heatFor, inRect, islandWinner, lavaRises, matchResult, maxIslands,
  panelCards, panelRects, seatAt,
} from "./logic";

describe("Kaboom Isle logic", () => {
  it("heat climbs 25% a round, starts hot on the final island and caps", () => {
    expect(heatFor(1)).toBe(1);
    expect(heatFor(2)).toBeCloseTo(1.25);
    expect(heatFor(1, true)).toBeCloseTo(1.5);
    expect(heatFor(40)).toBe(HEAT_CAP);
    expect(lavaRises(LAVA_ROUND - 1)).toBe(false);
    expect(lavaRises(LAVA_ROUND)).toBe(true);
    expect(lavaRises(LAVA_ROUND - 1, true)).toBe(true);
  });

  it("two players get three islands, bigger tables two", () => {
    expect(maxIslands(2)).toBe(3);
    expect(maxIslands(3)).toBe(2);
    expect(maxIslands(4)).toBe(2);
  });

  it("seat panels tile the bottom edge and cards fit inside their panel", () => {
    const panels = panelRects(1280, 720, 4);
    expect(panels).toHaveLength(4);
    expect(panels[0]!.y).toBe(720 - PANEL_H);
    expect(panels[3]!.x + panels[3]!.w).toBe(1280);
    expect(seatAt(panels, 100, 700)).toBe(0);
    expect(seatAt(panels, 1000, 700)).toBe(3);
    expect(seatAt(panels, 1000, 100)).toBe(-1);
    const cards = panelCards(panels[1]!, 3);
    for (const c of cards) {
      expect(c.x).toBeGreaterThanOrEqual(panels[1]!.x);
      expect(c.x + c.w).toBeLessThanOrEqual(panels[1]!.x + panels[1]!.w);
      expect(c.h).toBeGreaterThanOrEqual(60);
    }
    expect(inRect(cards[2]!, cards[2]!.x + 1, cards[2]!.y + 1)).toBe(true);
  });

  it("an island goes to the last survivor, else the top HP, else nobody", () => {
    expect(islandWinner([{ index: 0, alive: false, hp: 0 }, { index: 1, alive: true, hp: 5 }])).toBe(1);
    expect(islandWinner([{ index: 0, alive: true, hp: 40 }, { index: 1, alive: true, hp: 70 }])).toBe(1);
    expect(islandWinner([{ index: 0, alive: true, hp: 70 }, { index: 1, alive: true, hp: 70 }])).toBeNull();
    expect(islandWinner([{ index: 0, alive: false, hp: 0 }])).toBeNull();
  });

  it("the match ends on two wins or when the islands run out, breaking ties on damage", () => {
    expect(matchResult([1, 0, 0, 0], 1, 2)).toBeNull();
    expect(matchResult([2, 0], 2, 3)).toEqual({ winners: [0], onDamage: false });
    expect(matchResult([1, 1, 0, 0], 2, 2, [50, 120, 0, 0])).toEqual({ winners: [1], onDamage: true });
    expect(matchResult([1, 1, 0, 0], 2, 2, [80, 80, 0, 0])).toEqual({ winners: [0, 1], onDamage: false });
    expect(matchResult([0, 0], 3, 3)).toEqual({ winners: [0, 1], onDamage: false });
  });

  it("losers draft first", () => {
    expect(draftOrder([1, 0, 1, 0])).toEqual([1, 3, 0, 2]);
  });

  it("bots swat nukes and boosted shots far more than chickens", () => {
    expect(botSwatChance(0, 1, 1)).toBe(0);
    expect(botSwatChance(34, 1, 0)).toBe(0);
    expect(botSwatChance(62, 1, 1)).toBeGreaterThan(botSwatChance(34, 1, 1));
    expect(botSwatChance(34, 2, 1)).toBeGreaterThan(botSwatChance(34, 1, 1));
    expect(botSwatChance(8, 1, 1)).toBeGreaterThan(0);
  });

  it("bot ghosts usually push the wind further from calm", () => {
    expect(botGustDir(0.5, 0.1)).toBe(1);
    expect(botGustDir(-0.5, 0.1)).toBe(-1);
    expect(botGustDir(0.5, 0.95)).toBe(-1);
    expect([-1, 1]).toContain(botGustDir(0, 0.3));
  });
});
