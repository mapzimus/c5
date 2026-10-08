/**
 * Shared "juice" for games: screen shake, particle bursts, hit-stop and
 * per-game personal bests. Everything here is DOM-free except bests (localStorage,
 * wrapped so it never throws).
 *
 * Typical use inside a GameInstance:
 *   update(dt) { dt = this.juice.update(dt); ...step the game with dt... }
 *   render(g)  { this.juice.begin(g); ...draw world...; this.juice.end(g); ...draw HUD... }
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

export interface BurstOptions {
  count?: number;
  speed?: number;
  size?: number;
  life?: number;
  gravity?: number;
  spread?: number;
  /** Direction in radians the burst aims at (with `spread`). Omit for a full circle. */
  angle?: number;
}

export class Juice {
  private trauma = 0;
  private stop = 0;
  private slow = 0;
  private slowScale = 1;
  private time = 0;
  particles: Particle[] = [];
  offsetX = 0;
  offsetY = 0;

  constructor(private readonly random: () => number = Math.random) {}

  /** Add screen shake. 0.2 = nudge, 0.5 = big hit, 1 = earthquake. Stacks, capped at 1. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Freeze gameplay for a few frames on a big impact. Particles and shake keep moving. */
  hitStop(seconds: number): void {
    this.stop = Math.max(this.stop, seconds);
  }

  /** Run gameplay at `scale` speed for `seconds` of real time (dramatic slow-mo). */
  slowMo(seconds: number, scale = 0.35): void {
    this.slow = Math.max(this.slow, seconds);
    this.slowScale = scale;
  }

  get slowing(): boolean {
    return this.slow > 0;
  }

  burst(x: number, y: number, color: string | readonly string[], options: BurstOptions = {}): void {
    const count = options.count ?? 18;
    const speed = options.speed ?? 260;
    const colors = typeof color === "string" ? [color] : color;
    for (let i = 0; i < count; i += 1) {
      const a = options.angle === undefined
        ? this.random() * Math.PI * 2
        : options.angle + (this.random() - 0.5) * (options.spread ?? 1);
      const v = speed * (0.35 + this.random() * 0.65);
      const life = (options.life ?? 0.7) * (0.6 + this.random() * 0.4);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        maxLife: life,
        size: (options.size ?? 4) * (0.6 + this.random() * 0.8),
        color: colors[Math.floor(this.random() * colors.length)] ?? "#fff",
        gravity: options.gravity ?? 500,
      });
    }
  }

  /** Advance effects by real `dt`. Returns the dt the game should simulate with (0 during hit-stop). */
  update(dt: number): number {
    this.time += dt;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(0.2, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const power = this.trauma * this.trauma * 18;
    this.offsetX = power * Math.sin(this.time * 71.3);
    this.offsetY = power * Math.cos(this.time * 53.7);

    if (this.stop > 0) {
      this.stop -= dt;
      return 0;
    }
    if (this.slow > 0) {
      this.slow -= dt;
      return dt * this.slowScale;
    }
    return dt;
  }

  /** Start drawing the shaken world. Pair with `end`. */
  begin(g: CanvasRenderingContext2D): void {
    g.save();
    g.translate(this.offsetX, this.offsetY);
  }

  /** Draw particles (still shaken), then restore. */
  end(g: CanvasRenderingContext2D): void {
    this.drawParticles(g);
    g.restore();
  }

  drawParticles(g: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, p.life / p.maxLife);
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
  }
}

/** Big centered callout text that pops in and fades ("KNOCKOUT!", "NEW BEST"). */
export class Callouts {
  private items: { text: string; color: string; life: number; maxLife: number; y: number; size: number }[] = [];

  show(text: string, color = "#F4F7FB", options: { life?: number; y?: number; size?: number } = {}): void {
    const life = options.life ?? 1.2;
    this.items.push({ text, color, life, maxLife: life, y: options.y ?? 0.32, size: options.size ?? 64 });
  }

  update(dt: number): void {
    for (const item of this.items) item.life -= dt;
    this.items = this.items.filter((item) => item.life > 0);
  }

  draw(g: CanvasRenderingContext2D, width: number, height: number): void {
    for (const item of this.items) {
      const t = 1 - item.life / item.maxLife;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : t < 0.22 ? 1.15 - ((t - 0.12) / 0.1) * 0.15 : 1;
      g.save();
      g.globalAlpha = Math.min(1, item.life / (item.maxLife * 0.3));
      g.translate(width / 2, height * item.y);
      g.scale(pop, pop);
      g.font = `700 ${item.size}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 8;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(item.text, 0, 0);
      g.fillStyle = item.color;
      g.fillText(item.text, 0, 0);
      g.restore();
    }
  }
}

/** Per-game personal best, stored in localStorage under `c5-best-<gameId>`. Never throws. */
export function loadBest(gameId: string, version?: string): number {
  try {
    const key = version ? `c5-best-${gameId}-${version}` : `c5-best-${gameId}`;
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

/** Save if higher. Returns true when this is a new best. */
export function saveBest(gameId: string, score: number, version?: string): boolean {
  if (score <= loadBest(gameId, version)) return false;
  try {
    const key = version ? `c5-best-${gameId}-${version}` : `c5-best-${gameId}`;
    localStorage.setItem(key, String(score));
  } catch {
    /* storage is optional */
  }
  return true;
}
