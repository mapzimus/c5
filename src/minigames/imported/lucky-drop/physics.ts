/** 1 through 2048. 2048 is the top orb and does not merge further. */
export const RADII = [17, 23, 30, 38, 47, 57, 68, 80, 92, 104, 116, 128] as const;
/** Making 128 pays this bonus. */
export const BONUS_TIER = 7;
export const COLORS = ["#c9f65b", "#6ee7b7", "#74cefa", "#b6a2ff", "#f5adce", "#ffb478", "#ffe071", "#f1b4ee", "#ff7a7a", "#7aa2ff", "#4fd1c5", "#ffcf33"] as const;
export const BOARD = { width: 480, height: 630, left: 8, right: 472, floor: 620, danger: 105 } as const;

export interface Orb {
  id: number;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  born: number;
}

export type DropEvent =
  | { type: "merge"; x: number; y: number; tier: number; points: number; chain: number }
  | { type: "burst"; x: number; y: number }
  | { type: "over" };

/** The original Lucky Drop circle solver, independent of canvas and C5's lifecycle. */
export class DropWorld {
  balls: Orb[] = [];
  score = 0;
  charge = 0;
  chain = 0;
  maxChain = 0;
  merges = 0;
  drops = 0;
  time = 0;
  lastMerge = -10;
  lastDrop = -10;
  danger = 0;
  over = false;
  next: number;
  queued: number;
  events: DropEvent[] = [];
  private id = 0;

  constructor(
    private readonly random: () => number,
    private readonly shakeRandom: () => number = random,
  ) {
    this.next = this.roll();
    this.queued = this.roll();
  }

  private roll(): number {
    const n = this.random();
    return n < 0.65 ? 0 : n < 0.9 ? 1 : 2;
  }

  add(tier: number, x: number, y: number, vx = 0, vy = 0): Orb {
    const ball = { id: ++this.id, tier, x, y, vx, vy, radius: RADII[tier], born: this.time };
    this.balls.push(ball);
    return ball;
  }

  clampAim(x: number): number {
    const radius = RADII[this.next];
    return Math.max(BOARD.left + radius, Math.min(BOARD.right - radius, x));
  }

  drop(x: number): boolean {
    if (this.over || this.time - this.lastDrop < 0.48) return false;
    this.add(this.next, this.clampAim(x), 45);
    this.next = this.queued;
    this.queued = this.roll();
    this.lastDrop = this.time;
    this.drops++;
    return true;
  }

  shake(): boolean {
    if (this.charge < 6 || this.over) return false;
    this.charge = 0;
    for (const ball of this.balls) {
      ball.vx += (this.shakeRandom() - 0.5) * 420;
      ball.vy = -220 - this.shakeRandom() * 160;
    }
    this.danger = 0;
    return true;
  }

  /** Call at a fixed 120 Hz; the adapter owns accumulated real time. */
  step(dt: number): void {
    if (this.over) return;
    this.time += dt;
    for (const ball of this.balls) {
      ball.vy += 1150 * dt;
      ball.vx *= Math.pow(0.993, dt * 120);
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
    }

    const pairs: [Orb, Orb][] = [];
    const used = new Set<number>();
    for (let pass = 0; pass < 5; pass++) {
      for (const ball of this.balls) this.confine(ball);
      for (let i = 0; i < this.balls.length; i++) {
        for (let j = i + 1; j < this.balls.length; j++) {
          const a = this.balls[i], b = this.balls[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const min = a.radius + b.radius;
          let distance = Math.hypot(dx, dy);
          if (distance > min + 0.2) continue;
          if (pass === 0 && a.tier === b.tier && a.tier < RADII.length - 1 && this.time - a.born > 0.17 &&
            this.time - b.born > 0.17 && !used.has(a.id) && !used.has(b.id)) {
            used.add(a.id);
            used.add(b.id);
            pairs.push([a, b]);
            continue;
          }
          if (distance < 0.001) {
            dx = 0.01;
            dy = -0.01;
            distance = Math.hypot(dx, dy);
          }
          const nx = dx / distance, ny = dy / distance;
          const ia = 1 / (a.radius * a.radius), ib = 1 / (b.radius * b.radius), sum = ia + ib;
          const overlap = Math.max(0, min - distance);
          a.x -= nx * overlap * ia / sum * 0.85;
          a.y -= ny * overlap * ia / sum * 0.85;
          b.x += nx * overlap * ib / sum * 0.85;
          b.y += ny * overlap * ib / sum * 0.85;
          const velocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (velocity < 0) {
            const impulse = -(1 + (Math.abs(velocity) > 60 ? 0.22 : 0)) * velocity / sum;
            a.vx -= impulse * ia * nx;
            a.vy -= impulse * ia * ny;
            b.vx += impulse * ib * nx;
            b.vy += impulse * ib * ny;
          }
        }
      }
    }

    if (pairs.length) {
      this.balls = this.balls.filter(ball => !used.has(ball.id));
      for (const [a, b] of pairs) {
        this.chain = this.time - this.lastMerge < 1.5 ? Math.min(5, this.chain + 1) : 1;
        this.lastMerge = this.time;
        this.maxChain = Math.max(this.maxChain, this.chain);
        this.merges++;
        this.charge = Math.min(6, this.charge + 1);
        const tier = a.tier + 1, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        const points = 2 ** tier * 10 * this.chain;
        this.score += points;
        this.events.push({ type: "merge", x, y, tier, points, chain: this.chain });
        // 128 pays a bonus with fanfare; the orb stays and keeps merging up to 2048.
        if (tier === BONUS_TIER) {
          this.score += 1000;
          this.events.push({ type: "burst", x, y });
        }
        this.add(tier, x, y, (a.vx + b.vx) * 0.35, Math.min(-35, (a.vy + b.vy) * 0.2));
      }
    }

    const high = this.balls.some(ball => ball.y - ball.radius < BOARD.danger &&
      this.time - ball.born > 1.7 && Math.abs(ball.vy) < 75);
    this.danger = high ? this.danger + dt : Math.max(0, this.danger - dt * 2);
    if (this.danger >= 3) {
      this.over = true;
      this.events.push({ type: "over" });
    }
  }

  private confine(ball: Orb): void {
    if (ball.x - ball.radius < BOARD.left) {
      ball.x = BOARD.left + ball.radius;
      ball.vx = Math.abs(ball.vx) * 0.38;
    }
    if (ball.x + ball.radius > BOARD.right) {
      ball.x = BOARD.right - ball.radius;
      ball.vx = -Math.abs(ball.vx) * 0.38;
    }
    if (ball.y + ball.radius > BOARD.floor) {
      ball.y = BOARD.floor - ball.radius;
      ball.vy = ball.vy > 35 ? -ball.vy * 0.22 : 0;
      ball.vx *= 0.92;
    }
  }
}
