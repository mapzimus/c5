import { describe, expect, it } from "vitest";
import { shouldCommitCancel, velocityFromGesture, type FlickGesture } from "./flick";

function pathUp({ px, ms, holdMs = 0, steps = 6 }: { px: number; ms: number; holdMs?: number; steps?: number }) {
  const samples = [];
  const y0 = 520;
  if (holdMs) samples.push({ t: 0, x: 200, y: y0 });
  const t0 = holdMs;
  for (let i = 0; i <= steps; i += 1) {
    const t = t0 + (ms * i) / steps;
    const y = y0 - (px * i) / steps;
    samples.push({ t, x: 200, y });
  }
  const last = samples[samples.length - 1]!;
  return {
    samples,
    startX: 200,
    startY: y0,
    curX: last.x,
    curY: last.y,
  };
}

function upSpeed(opts: { px: number; ms: number; holdMs?: number; pointerType?: string; peakVy?: number }): number {
  const g = pathUp(opts);
  const v = velocityFromGesture({
    ...g,
    pointerType: opts.pointerType ?? "touch",
    peakVx: 0,
    peakVy: opts.peakVy ?? -9000,
    peakSpeed: Math.abs(opts.peakVy ?? 9000),
  });
  return v ? -v.vy : 0;
}

describe("flick velocity", () => {
  it("puts a typical 140px / 90ms finger toss in the make window", () => {
    const typical = upSpeed({ px: 140, ms: 90, peakVy: -9000 });
    expect(typical).toBeGreaterThanOrEqual(1800);
    expect(typical).toBeLessThanOrEqual(2500);
  });

  it("does not treat a noisy 12k peak as max-power", () => {
    expect(upSpeed({ px: 140, ms: 90, peakVy: -12000 })).toBeLessThan(3200);
  });

  it("does not dilute a press-and-hold then snap", () => {
    const hesitate = upSpeed({ px: 140, ms: 90, holdMs: 320, peakVy: -6000 });
    expect(hesitate).toBeGreaterThanOrEqual(1800);
    expect(hesitate).toBeLessThanOrEqual(2500);
  });

  it("keeps a tiny toss below the make window", () => {
    expect(upSpeed({ px: 50, ms: 140, peakVy: -2000 })).toBeLessThan(1600);
  });

  it("uses peak velocity for mouse", () => {
    const mouse = velocityFromGesture({
      ...pathUp({ px: 220, ms: 110 }),
      pointerType: "mouse",
      peakVx: 40,
      peakVy: -2100,
      peakSpeed: 2100,
    });
    expect(mouse).not.toBeNull();
    expect(Math.abs(-mouse!.vy - 2100)).toBeLessThan(1);
  });

  it("commits a real snap on pointercancel", () => {
    const gesture: FlickGesture = {
      ...pathUp({ px: 140, ms: 90 }),
      pointerType: "touch",
      peakVx: 0,
      peakVy: -5000,
      peakSpeed: 5000,
    };
    expect(shouldCommitCancel(gesture)).toBe(true);
  });

  it("ignores a tiny wiggle on cancel", () => {
    expect(
      shouldCommitCancel({
        samples: [
          { t: 0, x: 10, y: 10 },
          { t: 20, x: 12, y: 11 },
        ],
        pointerType: "touch",
        startX: 10,
        startY: 10,
        curX: 12,
        curY: 11,
        peakVx: 100,
        peakVy: -80,
        peakSpeed: 120,
      }),
    ).toBe(false);
  });
});
