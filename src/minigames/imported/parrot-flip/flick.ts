/** Gesture → launch velocity. Port of Whydah-Unit parrot-flip/js/flick.js. */

export const MIN_DRAG = 22;
export const SNAP_MS = 90;
export const TOUCH_GAIN = 1.25;
export const CANCEL_MIN_UP = 400;

export interface FlickSample {
  t: number;
  x: number;
  y: number;
}

export interface FlickGesture {
  samples: FlickSample[];
  pointerType: string;
  peakVx: number;
  peakVy: number;
  peakSpeed: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

export function snapVelocity(samples: FlickSample[]): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const b = samples[samples.length - 1]!;
  const t0 = b.t - SNAP_MS;
  let a = samples[0]!;
  for (const sample of samples) {
    if (sample.t <= t0) a = sample;
  }
  const dt = Math.max((b.t - a.t) / 1000, 0.016);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}

export function velocityFromGesture(gesture: FlickGesture): { vx: number; vy: number } | null {
  const dx = gesture.curX - gesture.startX;
  const dy = gesture.curY - gesture.startY;
  const dist = Math.hypot(dx, dy);
  if (dist < MIN_DRAG) return null;

  if (gesture.pointerType === "touch" || gesture.pointerType === "pen") {
    const snap = snapVelocity(gesture.samples);
    return { vx: snap.vx * TOUCH_GAIN, vy: snap.vy * TOUCH_GAIN };
  }

  let vx = gesture.peakVx;
  let vy = gesture.peakVy;
  if (gesture.peakSpeed < 80) {
    vx = dx * 10;
    vy = dy * 10;
  }
  return { vx, vy };
}

export function shouldCommitCancel(gesture: FlickGesture): boolean {
  const velocity = velocityFromGesture(gesture);
  if (!velocity) return false;
  return -velocity.vy >= CANCEL_MIN_UP;
}
