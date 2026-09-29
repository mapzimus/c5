import { describe, expect, it } from "vitest";
import { Juice } from "./juice";

describe("Juice", () => {
  it("hit-stop freezes game time but effects keep running", () => {
    const juice = new Juice(() => 0.5);
    juice.burst(0, 0, "#fff", { count: 3 });
    juice.hitStop(0.1);
    expect(juice.update(0.05)).toBe(0);
    expect(juice.particles[0]!.x).not.toBe(0);
    expect(juice.update(0.06)).toBe(0);
    expect(juice.update(0.05)).toBe(0.05);
  });

  it("slow-mo scales game time, shake decays to rest", () => {
    const juice = new Juice();
    juice.slowMo(0.2, 0.25);
    expect(juice.update(0.1)).toBeCloseTo(0.025);
    juice.shake(1);
    juice.update(0.016);
    expect(Math.abs(juice.offsetX) + Math.abs(juice.offsetY)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i += 1) juice.update(0.016);
    expect(juice.offsetX).toBe(0);
  });

  it("particles expire", () => {
    const juice = new Juice();
    juice.burst(10, 10, ["#f00", "#0f0"], { count: 10, life: 0.3 });
    expect(juice.particles).toHaveLength(10);
    juice.update(0.5);
    expect(juice.particles).toHaveLength(0);
  });
});
