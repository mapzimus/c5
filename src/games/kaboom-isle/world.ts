import type { Rng } from "../../core/rng";

/** Destructible tile terrain, fighters and projectiles. DOM-free so it can be tested. */

export const TILE = 8;
export const GRAVITY = 620;
export const FIGHTER_R = 14;
export const MAX_SPEED = 980;

export type WeaponId = "bomb" | "grenade" | "cluster" | "nuke" | "glove" | "chicken" | "triple" | "airstrike" | "drill" | "teleport" | "blackhole";

export interface Weapon {
  id: WeaponId;
  name: string;
  blurb: string;
  color: string;
  weight: number;
  radius: number;
  damage: number;
  knock: number;
  /** Seconds before it blows on its own. Bouncers ignore contact until then. */
  fuse?: number;
  bounces?: boolean;
  carves: boolean;
}

export const WEAPONS: readonly Weapon[] = [
  { id: "bomb", name: "BOMB", blurb: "Boom on contact", color: "#F4F7FB", weight: 26, radius: 52, damage: 34, knock: 520, carves: true },
  { id: "grenade", name: "BOUNCER", blurb: "Bounces, 2.5s fuse", color: "#B8FF3D", weight: 15, radius: 58, damage: 40, knock: 560, fuse: 2.5, bounces: true, carves: true },
  { id: "cluster", name: "CLUSTER", blurb: "Splits into 5", color: "#FFB020", weight: 11, radius: 36, damage: 18, knock: 380, carves: true },
  { id: "triple", name: "TRIPLE", blurb: "Three bombs, spread", color: "#3EE0FF", weight: 7, radius: 40, damage: 22, knock: 420, carves: true },
  { id: "glove", name: "BOXING GLOVE", blurb: "Tiny damage, HUGE shove", color: "#FF3D7A", weight: 10, radius: 48, damage: 8, knock: 1250, carves: false },
  { id: "nuke", name: "MEGA NUKE", blurb: "Jackpot.", color: "#FF5A1F", weight: 4, radius: 115, damage: 62, knock: 900, carves: true },
  { id: "chicken", name: "RUBBER CHICKEN", blurb: "...it squeaks", color: "#FFE14D", weight: 8, radius: 30, damage: 0, knock: 160, carves: false },
  { id: "airstrike", name: "AIRSTRIKE", blurb: "Marks a spot. Sky rains bombs.", color: "#c084fc", weight: 7, radius: 38, damage: 20, knock: 420, carves: true },
  { id: "drill", name: "DRILL", blurb: "Bores through ground, then pops", color: "#94a3b8", weight: 8, radius: 50, damage: 36, knock: 520, carves: true },
  { id: "teleport", name: "TELEPORTER", blurb: "You warp to where it lands", color: "#22d3ee", weight: 5, radius: 0, damage: 0, knock: 0, carves: false },
  { id: "blackhole", name: "BLACK HOLE", blurb: "Sucks everyone in. Then pops.", color: "#a855f7", weight: 6, radius: 64, damage: 30, knock: 700, carves: true },
];

export function rollWeapon(rng: Rng): Weapon {
  const total = WEAPONS.reduce((s, w) => s + w.weight, 0);
  let r = rng.float(0, total);
  for (const w of WEAPONS) {
    r -= w.weight;
    if (r <= 0) return w;
  }
  return WEAPONS[0]!;
}

export interface Fighter {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  alive: boolean;
  grounded: boolean;
  /** Turn number the fighter went down on (ties share it). */
  diedOnTurn: number;
  damageDealt: number;
  kos: number;
  bestHit: number;
  hurt: number;
  /** Crate buffs, spent on the next shot / next hit. */
  doubleDamage: boolean;
  shield: boolean;
}

export type CrateKind = "medkit" | "double" | "shield";

export interface Crate {
  x: number;
  y: number;
  kind: CrateKind;
  landed: boolean;
  dead: boolean;
}

export interface Vortex {
  x: number;
  y: number;
  life: number;
  owner: number;
  dmgMul: number;
}

export type WorldEvent =
  | { type: "crate"; index: number; kind: CrateKind; x: number; y: number }
  | { type: "teleport"; index: number; x: number; y: number }
  | { type: "shielded"; index: number };

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  weapon: Weapon;
  owner: number;
  age: number;
  /** Mini bomblets from a cluster use reduced stats. */
  mini: boolean;
  dead: boolean;
  trail: { x: number; y: number }[];
  /** Damage multiplier from a Double Damage crate. */
  dmgMul: number;
  /** Seconds left boring through terrain (drill only). */
  drilling: number;
  /** Full flight path of the lead shot, kept as next turn's ghost. */
  path?: { x: number; y: number }[] | undefined;
}

export interface Blast {
  x: number;
  y: number;
  radius: number;
  weapon: Weapon;
  /** Fighters this blast hit, with damage dealt. */
  hits: { index: number; damage: number }[];
  splash?: boolean;
}

export class World {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: Uint8Array;
  fighters: Fighter[] = [];
  shots: Shot[] = [];
  crates: Crate[] = [];
  vortices: Vortex[] = [];
  events: WorldEvent[] = [];
  /** Each fighter's last shot path, drawn faintly while they aim. */
  ghosts: ({ x: number; y: number }[] | undefined)[] = [];
  lava: number;
  wind = 0;
  /** Bumped whenever tiles change so the renderer can re-cache. */
  version = 0;

  constructor(readonly width: number, readonly height: number, private readonly rng: Rng, players: number) {
    this.cols = Math.ceil(width / TILE);
    this.rows = Math.ceil(height / TILE);
    this.tiles = new Uint8Array(this.cols * this.rows);
    this.lava = height - 56;
    this.generate();
    this.spawn(players);
  }

  solidAt(x: number, y: number): boolean {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
    return this.tiles[r * this.cols + c] === 1;
  }

  private generate(): void {
    const rng = this.rng;
    // Three-ish islands with gaps between them.
    const gaps = [rng.float(0.27, 0.35), rng.float(0.62, 0.72)];
    const gapHalf = rng.float(0.025, 0.045);
    const p1 = rng.float(0, Math.PI * 2);
    const p2 = rng.float(0, Math.PI * 2);
    for (let c = 0; c < this.cols; c++) {
      const u = c / this.cols;
      if (u < 0.04 || u > 0.96) continue;
      if (gaps.some((g) => Math.abs(u - g) < gapHalf)) continue;
      const top = this.height * (0.52 + 0.1 * Math.sin(u * 9 + p1) + 0.05 * Math.sin(u * 23 + p2));
      // Islands taper underneath so they float over the lava.
      const edge = Math.min(...gaps.map((g) => Math.abs(u - g) - gapHalf), u - 0.04, 0.96 - u);
      const depth = Math.min(200, 40 + edge * 1600);
      for (let r = Math.floor(top / TILE); r < Math.floor((top + depth) / TILE) && r < this.rows; r++) {
        this.tiles[r * this.cols + c] = 1;
      }
    }
    // A couple of floating ledges for cover.
    for (let i = 0; i < 3; i++) {
      const cx = Math.floor(rng.float(0.15, 0.85) * this.cols);
      const ry = Math.floor(rng.float(0.22, 0.36) * this.rows);
      const w = rng.int(6, 12);
      for (let c = cx - w; c <= cx + w; c++) {
        for (let r = ry; r < ry + 2; r++) if (c >= 0 && c < this.cols) this.tiles[r * this.cols + c] = 1;
      }
    }
    this.version++;
  }

  surfaceY(x: number): number | null {
    for (let y = 0; y < this.lava; y += 2) if (this.solidAt(x, y)) return y;
    return null;
  }

  /** Solid, flat-ish island ground (not a thin ledge or a cliff edge). */
  private goodSpawn(x: number): boolean {
    const y = this.surfaceY(x);
    if (y === null) return false;
    for (const dx of [-16, -8, 8, 16]) {
      const yy = this.surfaceY(x + dx);
      if (yy === null || Math.abs(yy - y) > 10) return false;
    }
    return this.solidAt(x, y + 48);
  }

  private spawn(players: number): void {
    const slots: number[] = [];
    for (let i = 0; i < players; i++) slots.push((i + 0.5) / players);
    // Shuffle so seat 1 isn't always far left.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [slots[i], slots[j]] = [slots[j]!, slots[i]!];
    }
    this.fighters = slots.map((u, index) => {
      let x = 80 + u * (this.width - 160);
      // Walk to the nearest column with ground.
      const base = x;
      for (let step = 1; step < 300 && !this.goodSpawn(x); step++) x = base + (step % 2 === 0 ? step : -step) * 2;
      const sy = this.surfaceY(x) ?? this.height * 0.5;
      return {
        index, x, y: sy - FIGHTER_R - 1, vx: 0, vy: 0, hp: 100, alive: true, grounded: true,
        diedOnTurn: -1, damageDealt: 0, kos: 0, bestHit: 0, hurt: 0, doubleDamage: false, shield: false,
      };
    });
  }

  rollWind(): void {
    this.wind = Math.round(this.rng.float(-1, 1) * 10) / 10;
  }

  windAccel(): number {
    return this.wind * 140;
  }

  fire(owner: number, angle: number, power: number, weapon: Weapon): void {
    const f = this.fighters[owner]!;
    const speed = MAX_SPEED * (0.15 + power * 0.85);
    const angles = weapon.id === "triple" ? [angle - 0.09, angle, angle + 0.09] : [angle];
    const dmgMul = f.doubleDamage ? 2 : 1;
    f.doubleDamage = false;
    for (const [i, a] of angles.entries()) {
      const vx = Math.cos(a) * speed;
      const vy = -Math.sin(a) * speed;
      this.shots.push({
        x: f.x + Math.cos(a) * (FIGHTER_R + 6), y: f.y - Math.sin(a) * (FIGHTER_R + 6),
        vx, vy, weapon, owner, age: 0, mini: false, dead: false, trail: [], dmgMul, drilling: 0,
        path: i === Math.floor(angles.length / 2) ? [] : undefined,
      });
    }
  }

  /** Advance everything; returns blasts that happened this step. */
  step(dt: number, turn: number): Blast[] {
    const blasts: Blast[] = [];
    const sub = 4;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const shot of this.shots) if (!shot.dead) this.stepShot(shot, h, blasts, turn);
      for (const v of this.vortices) this.pull(v, h);
      for (const f of this.fighters) if (f.alive) this.stepFighter(f, h, turn);
    }
    for (const v of this.vortices) {
      v.life -= dt;
      if (v.life <= 0) {
        const w = WEAPONS.find((x) => x.id === "blackhole")!;
        blasts.push(this.blast(v.x, v.y, w.radius, w.damage * v.dmgMul, w.knock, w, v.owner, turn));
      }
    }
    this.vortices = this.vortices.filter((v) => v.life > 0);
    for (const shot of this.shots) if (shot.dead && shot.path) this.ghosts[shot.owner] = shot.path;
    this.shots = this.shots.filter((s) => !s.dead);
    this.stepCrates(dt);
    return blasts;
  }

  private stepShot(shot: Shot, h: number, blasts: Blast[], turn: number): void {
    shot.age += h;
    shot.vy += GRAVITY * h;
    shot.vx += this.windAccel() * h;
    const nx = shot.x + shot.vx * h;
    const ny = shot.y + shot.vy * h;
    if (shot.path && (shot.path.length === 0 || Math.hypot(nx - shot.path[shot.path.length - 1]!.x, ny - shot.path[shot.path.length - 1]!.y) > 12)) {
      shot.path.push({ x: nx, y: ny });
    }
    if (shot.drilling > 0) {
      shot.drilling -= h;
      shot.vy -= GRAVITY * h * 0.8;
      shot.x = nx;
      shot.y = ny;
      this.carve(nx, ny, 13);
      const hitF = this.fighters.some((f) => f.alive && f.index !== shot.owner && Math.hypot(f.x - nx, f.y - ny) < FIGHTER_R + 5);
      if (shot.drilling <= 0 || hitF || ny > this.lava) this.explode(shot, blasts, turn);
      return;
    }
    if (shot.trail.length === 0 || Math.hypot(nx - shot.trail[shot.trail.length - 1]!.x, ny - shot.trail[shot.trail.length - 1]!.y) > 10) {
      shot.trail.push({ x: nx, y: ny });
      if (shot.trail.length > 24) shot.trail.shift();
    }
    const fuse = shot.weapon.fuse;
    if (nx < -200 || nx > this.width + 200 || ny > this.lava || shot.age > 9) {
      shot.dead = true;
      if (ny > this.lava && nx > 0 && nx < this.width) {
        blasts.push({ x: nx, y: this.lava, radius: 24, weapon: shot.weapon, hits: [], splash: true });
      }
      return;
    }
    if (fuse !== undefined && shot.age >= fuse) {
      shot.x = nx;
      shot.y = ny;
      this.explode(shot, blasts, turn);
      return;
    }
    const hitFighter = this.fighters.some((f) => f.alive && (f.index !== shot.owner || shot.age > 0.25) && Math.hypot(f.x - nx, f.y - ny) < FIGHTER_R + 5);
    if (this.solidAt(nx, ny) || hitFighter) {
      if (shot.weapon.id === "drill" && !hitFighter) {
        shot.drilling = 0.65;
        shot.x = nx;
        shot.y = ny;
        return;
      }
      if (shot.weapon.bounces && !shot.mini) {
        // Reflect on whichever axis is blocked.
        const blockX = this.solidAt(nx, shot.y);
        const blockY = this.solidAt(shot.x, ny);
        if (blockX || hitFighter) shot.vx *= -0.55;
        if (blockY || (!blockX && !hitFighter)) shot.vy *= -0.55;
        shot.vx *= 0.9;
        return;
      }
      shot.x = nx;
      shot.y = ny;
      this.explode(shot, blasts, turn);
      return;
    }
    shot.x = nx;
    shot.y = ny;
  }

  private explode(shot: Shot, blasts: Blast[], turn: number): void {
    shot.dead = true;
    const w = shot.weapon;
    const mini = (x: number, y: number, vx: number, vy: number): void => {
      this.shots.push({ x, y, vx, vy, weapon: w, owner: shot.owner, age: 0.3, mini: true, dead: false, trail: [], dmgMul: shot.dmgMul, drilling: 0 });
    };
    if (w.id === "cluster" && !shot.mini) {
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.38;
        mini(shot.x, shot.y - 6, Math.cos(a) * 260 + this.rng.float(-40, 40), Math.sin(a) * 300);
      }
    }
    if (w.id === "airstrike" && !shot.mini) {
      // Just a flare: the bombs come from above.
      for (let i = 0; i < 5; i++) mini(shot.x + (i - 2) * 46 + this.rng.float(-10, 10), -30 - i * 40, 0, 260);
      blasts.push({ x: shot.x, y: shot.y, radius: 18, weapon: w, hits: [], splash: true });
      return;
    }
    if (w.id === "teleport") {
      this.teleport(shot.owner, shot.x, shot.y);
      return;
    }
    if (w.id === "blackhole") {
      this.vortices.push({ x: shot.x, y: shot.y, life: 1.6, owner: shot.owner, dmgMul: shot.dmgMul });
      return;
    }
    const scale = shot.mini ? 1 : w.id === "cluster" ? 0.8 : 1;
    blasts.push(this.blast(shot.x, shot.y, w.radius * scale, w.damage * scale * shot.dmgMul, w.knock * scale, w, shot.owner, turn));
  }

  blast(x: number, y: number, radius: number, damage: number, knock: number, weapon: Weapon, owner: number, turn: number): Blast {
    if (weapon.carves) this.carve(x, y, radius * 0.8);
    const hits: Blast["hits"] = [];
    const shooter = this.fighters[owner];
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius + FIGHTER_R) continue;
      const falloff = 1 - Math.min(1, Math.max(0, d - FIGHTER_R) / radius);
      let dmg = Math.round(damage * (0.35 + 0.65 * falloff));
      if (dmg > 0 && f.shield) {
        dmg = Math.ceil(dmg / 2);
        f.shield = false;
        this.events.push({ type: "shielded", index: f.index });
      }
      const nx = d > 0.01 ? dx / d : 0;
      const ny = d > 0.01 ? dy / d : -1;
      const k = knock * (0.4 + 0.6 * falloff);
      f.vx += nx * k;
      f.vy += ny * k - k * 0.45;
      f.grounded = false;
      if (owner !== f.index) this.lastHitBy[f.index] = owner;
      if (dmg > 0) {
        f.hp -= dmg;
        f.hurt = 0.5;
        hits.push({ index: f.index, damage: dmg });
        if (shooter && shooter.index !== f.index) {
          shooter.damageDealt += dmg;
          shooter.bestHit = Math.max(shooter.bestHit, dmg);
        }
      }
      if (f.hp <= 0) this.kill(f, turn, owner);
    }
    for (const c of this.crates) {
      if (!c.dead && Math.hypot(c.x - x, c.y - y) < radius + 12 && shooter?.alive) this.grab(c, shooter);
    }
    return { x, y, radius, weapon, hits };
  }

  private carve(x: number, y: number, radius: number): void {
    const c0 = Math.floor((x - radius) / TILE);
    const c1 = Math.floor((x + radius) / TILE);
    const r0 = Math.floor((y - radius) / TILE);
    const r1 = Math.floor((y + radius) / TILE);
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
        const cx = c * TILE + TILE / 2;
        const cy = r * TILE + TILE / 2;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= radius * radius) this.tiles[r * this.cols + c] = 0;
      }
    }
    this.version++;
  }

  kill(f: Fighter, turn: number, by: number | null): void {
    if (!f.alive) return;
    f.alive = false;
    f.hp = Math.max(0, f.hp);
    f.diedOnTurn = turn;
    if (by !== null && by !== f.index) this.fighters[by]!.kos++;
  }

  /** Who last hit each fighter, so lava KOs credit the shooter. */
  lastHitBy: (number | null)[] = [];

  private stepFighter(f: Fighter, h: number, turn: number): void {
    f.hurt = Math.max(0, f.hurt - h);
    f.vy += GRAVITY * h;
    f.vx = Math.max(-1400, Math.min(1400, f.vx));
    f.vy = Math.max(-1400, Math.min(1400, f.vy));
    f.x += f.vx * h;
    f.y += f.vy * h;
    const r = FIGHTER_R;
    f.grounded = false;
    // Floor: push up out of the ground.
    if (f.vy >= 0) {
      let pushes = 0;
      while (pushes < 12 && (this.solidAt(f.x, f.y + r) || this.solidAt(f.x - r * 0.6, f.y + r * 0.8) || this.solidAt(f.x + r * 0.6, f.y + r * 0.8))) {
        f.y -= 1;
        pushes++;
      }
      if (pushes > 0 || this.solidAt(f.x, f.y + r + 1)) {
        if (pushes >= 12) {
          // Too deep, it's a wall; bounce off sideways.
          f.y += pushes;
          f.x -= f.vx * h;
          f.vx *= -0.3;
        } else {
          f.vy = f.vy > 260 ? -f.vy * 0.25 : 0;
          f.grounded = f.vy === 0;
          f.vx *= Math.pow(0.02, h);
        }
      }
    } else if (this.solidAt(f.x, f.y - r)) {
      f.y += 2;
      f.vy = 0;
    }
    // Walls
    if (this.solidAt(f.x + r, f.y - 2) && f.vx > 0) {
      f.x -= 2;
      f.vx *= -0.3;
    }
    if (this.solidAt(f.x - r, f.y - 2) && f.vx < 0) {
      f.x += 2;
      f.vx *= -0.3;
    }
    if (f.grounded && Math.abs(f.vx) < 6) f.vx = 0;
    if (f.y - r > this.lava || f.x < -60 || f.x > this.width + 60 || f.y > this.height + 60) {
      this.kill(f, turn, this.lastHitBy[f.index] ?? null);
    }
  }

  private teleport(index: number, x: number, y: number): void {
    const f = this.fighters[index]!;
    if (!f.alive) return;
    this.events.push({ type: "teleport", index, x: f.x, y: f.y });
    f.x = Math.max(FIGHTER_R, Math.min(this.width - FIGHTER_R, x));
    f.y = y - FIGHTER_R - 2;
    for (let i = 0; i < 80 && this.solidAt(f.x, f.y + FIGHTER_R * 0.5); i++) f.y -= 2;
    f.vx = 0;
    f.vy = 0;
    f.grounded = false;
    this.events.push({ type: "teleport", index, x: f.x, y: f.y });
  }

  private pull(v: Vortex, h: number): void {
    const range = 280;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const dx = v.x - f.x;
      const dy = v.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 1) continue;
      const a = 2600 * (1 - d / range);
      f.vx += (dx / d) * a * h;
      f.vy += (dy / d) * a * h - GRAVITY * h * 0.6;
      f.grounded = false;
    }
  }

  spawnCrate(): void {
    for (let tries = 0; tries < 40; tries++) {
      const x = this.rng.float(60, this.width - 60);
      if (!this.goodSpawn(x)) continue;
      const kind = this.rng.pick<CrateKind>(["medkit", "medkit", "double", "shield"]);
      this.crates.push({ x, y: -30, kind, landed: false, dead: false });
      return;
    }
  }

  private stepCrates(dt: number): void {
    for (const c of this.crates) {
      if (c.dead) continue;
      if (!this.solidAt(c.x, c.y + 12)) {
        c.landed = false;
        c.y += 110 * dt;
      } else {
        c.landed = true;
      }
      if (c.y > this.lava || c.y > this.height) c.dead = true;
      for (const f of this.fighters) {
        if (!c.dead && f.alive && Math.hypot(f.x - c.x, f.y - c.y) < FIGHTER_R + 16) this.grab(c, f);
      }
    }
    this.crates = this.crates.filter((c) => !c.dead);
  }

  private grab(c: Crate, f: Fighter): void {
    c.dead = true;
    if (c.kind === "medkit") f.hp = Math.min(125, f.hp + 35);
    if (c.kind === "double") f.doubleDamage = true;
    if (c.kind === "shield") f.shield = true;
    this.events.push({ type: "crate", index: f.index, kind: c.kind, x: c.x, y: c.y });
  }

  settled(): boolean {
    if (this.shots.length > 0 || this.vortices.length > 0) return false;
    return this.fighters.every((f) => !f.alive || (f.grounded && Math.abs(f.vx) < 8));
  }

  alive(): Fighter[] {
    return this.fighters.filter((f) => f.alive);
  }

  /** Cheap trajectory preview for bots: where does this shot first land? */
  predict(owner: number, angle: number, power: number): { x: number; y: number } {
    const f = this.fighters[owner]!;
    const speed = MAX_SPEED * (0.15 + power * 0.85);
    let x = f.x + Math.cos(angle) * (FIGHTER_R + 6);
    let y = f.y - Math.sin(angle) * (FIGHTER_R + 6);
    let vx = Math.cos(angle) * speed;
    let vy = -Math.sin(angle) * speed;
    const h = 1 / 120;
    for (let t = 0; t < 6; t += h) {
      vy += GRAVITY * h;
      vx += this.windAccel() * h;
      x += vx * h;
      y += vy * h;
      if (y > this.lava || x < -100 || x > this.width + 100) return { x, y };
      if (this.solidAt(x, y)) return { x, y };
      if (t > 0.25 && this.fighters.some((o) => o.alive && Math.hypot(o.x - x, o.y - y) < FIGHTER_R + 5)) return { x, y };
    }
    return { x, y };
  }
}
