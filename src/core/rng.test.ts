import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("stays in range", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 50; i += 1) {
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      const f = rng.float(1, 2);
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThan(2);
    }
  });
});
