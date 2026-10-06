import { describe, expect, it } from "vitest";
import { DESIGN_SHORT_SIDE, layoutLogicalSize } from "./viewport";

describe("layoutLogicalSize", () => {
  it("keeps a 16:9 desktop canvas landscape", () => {
    const size = layoutLogicalSize(1280, 720);
    expect(size.height).toBe(DESIGN_SHORT_SIDE);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  });

  it("makes a portrait phone taller than it is wide", () => {
    const size = layoutLogicalSize(390, 844);
    expect(size.width).toBe(DESIGN_SHORT_SIDE);
    expect(size.height).toBeGreaterThan(size.width);
    expect(size.width / size.height).toBeCloseTo(390 / 844, 2);
  });
});
