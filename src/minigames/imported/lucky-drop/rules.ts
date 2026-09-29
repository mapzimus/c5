import { DropWorld, RADII } from "./physics";

/** Aim at an exposed match; otherwise choose the lowest reachable landing. */
export function botAim(world: DropWorld): number {
  let best = 240, bestValue = -Infinity;
  for (let x = 32; x <= 448; x += 16) {
    let landing = 620 - RADII[world.next];
    let match = false;
    for (const ball of world.balls) {
      const distance = Math.abs(x - ball.x), radius = ball.radius + RADII[world.next];
      if (distance >= radius) continue;
      const y = ball.y - Math.sqrt(radius * radius - distance * distance);
      if (y < landing) {
        landing = y;
        match = ball.tier === world.next;
      }
    }
    const value = landing + (match ? 160 : 0) - Math.abs(x - 240) * 0.01;
    if (value > bestValue) { bestValue = value; best = x; }
  }
  return world.clampAim(best);
}
