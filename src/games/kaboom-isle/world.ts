import type { Rng } from "../../core/rng";

/** Destructible tile terrain, fighters, projectiles and crates. DOM-free so it can be tested. */

export const TILE = 8;
export const GRAVITY = 620;
export const FIGHTER_R = 14;
export const CRATE_R = 11;
export const MAX_SPEED = 980;
export const MAX_HP = 100;
/** Owner id for blasts nobody fired (meteors, booby traps). */
export const ENV = -1;

export type WeaponId =
  | "bomb" | "grenade" | "cluster" | "nuke" | "glove" | "chicken" | "triple"
  | "banana" | "sheep" | "airstrike" | "teleport" | "drill" | "meteor" | "trap";

export interface ChildStats {
  count: number;
  radius: number;
  damage: number;
  knock: number;
}

export interface Weapon {
  id: WeaponId;
  name: string;
  blurb: string;
  color: string;
  /** Slot-machine weight. 0 = never rolled (meteors, traps). */
  weight: number;
  radius: number;
  damage: number;
  knock: number;
  /** Seconds before it blows on its own. Bouncers ignore contact until then. */
  fuse?: number;
  bounces?: boolean;
  carves: boolean;
  /** Spawns these bomblets when it goes off (cluster, banana) or from the sky (airstrike). */
  child?: ChildStats;
  /** Jackpot-tier: boosted by underdog luck and weapon crates. */
  rare?: boolean;
}

export const WEAPONS: readonly Weapon[] = [
  { id: "bomb", name: "BOMB", blurb: "Boom on contact", color: "#F4F7FB", weight: 24, radius: 52, damage: 34, knock: 520, carves: true },
  { id: "grenade", name: "BOUNCER", blurb: "Bounces, 2.5s fuse", color: "#B8FF3D", weight: 14, radius: 58, damage: 40, knock: 560, fuse: 2.5, bounces: true, carves: true },
  { id: "cluster", name: "CLUSTER", blurb: "Splits into 5", color: "#FFB020", weight: 11, radius: 36, damage: 18, knock: 380, carves: true, child: { count: 5, radius: 36, damage: 18, knock: 380 } },
  { id: "triple", name: "TRIPLE", blurb: "Three bombs, spread", color: "#3EE0FF", weight: 8, radius: 40, damage: 22, knock: 420, carves: true },
  { id: "glove", name: "BOXING GLOVE", blurb: "Tiny damage, HUGE shove", color: "#FF3D7A", weight: 10, radius: 48, damage: 8, knock: 1250, carves: false },
  { id: "drill", name: "DRILL", blurb: "Burrows in, then blows", color: "#C0C8D8", weight: 8, radius: 54, damage: 36, knock: 540, carves: true },
  { id: "teleport", name: "TELEPORTER", blurb: "Beam yourself where it lands", color: "#B98CFF", weight: 6, radius: 0, damage: 0, knock: 0, carves: false },
  { id: "sheep", name: "HOMING SHEEP", blurb: "Baaa. Hunts the nearest blob", color: "#FFFFFF", weight: 6, radius: 58, damage: 38, knock: 620, carves: true, rare: true },
  { id: "airstrike", name: "AIRSTRIKE", blurb: "Flare calls in 5 bombs", color: "#FF8A3D", weight: 5, radius: 0, damage: 0, knock: 0, carves: false, rare: true, child: { count: 5, radius: 40, damage: 20, knock: 430 } },
  { id: "banana", name: "BANANA BOMB", blurb: "Bounces, then 5 more bananas", color: "#FFE14D", weight: 4, radius: 50, damage: 30, knock: 520, fuse: 2.2, bounces: true, carves: true, rare: true, child: { count: 5, radius: 44, damage: 24, knock: 470 } },
  { id: "nuke", name: "MEGA NUKE", blurb: "Jackpot.", color: "#FF5A1F", weight: 4, radius: 115, damage: 62, knock: 900, carves: true, rare: true },
  { id: "chicken", name: "RUBBER CHICKEN", blurb: "...it squeaks", color: "#FFE14D", weight: 8, radius: 30, damage: 0, knock: 160, carves: false },
];

export const METEOR: Weapon = { id: "meteor", name: "METEOR", blurb: "", color: "#FF7A2F", weight: 0, radius: 44, damage: 18, knock: 400, carves: true };
export const TRAP: Weapon = { id: "trap", name: "BOOBY TRAP", blurb: "", color: "#FF3D7A", weight: 0, radius: 64, damage: 26, knock: 620, carves: true };

export function weaponById(id: WeaponId): Weapon {
  return WEAPONS.find((w) => w.id === id) ?? (id === "meteor" ? METEOR : id === "trap" ? TRAP : WEAPONS[0]!);
}

/**
 * Spin the slot. `luck` 0..1 tilts the odds toward the jackpot tier (and away from
 * the rubber chicken), so whoever is losing gets juicier rolls.
 */
export function rollWeapon(rng: Rng, luck = 0): Weapon {
  const weight = (w: Weapon) => w.weight * (w.rare ? 1 + luck * 2 : 1) * (w.id === "chicken" ? 1 - luck * 0.7 : 1);
  const total = WEAPONS.reduce((s, w) => s + weight(w), 0);
  let r = rng.float(0, total);
  for (const w of WEAPONS) {
    r -= weight(w);
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
  /** Who got the KO (null = nobody / environment). */
  killedBy: number | null;
  damageDealt: number;
  kos: number;
  bestHit: number;
  hurt: number;
  crates: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  weapon: Weapon;
  owner: number;
  age: number;
  /** Bomblets from a cluster/banana/airstrike use the weapon's child stats. */
  mini: boolean;
  dead: boolean;
  trail: { x: number; y: number }[];
  /** Seconds of drilling left once a drill bites into the ground. */
  drilling?: number;
}

export interface Blast {
  x: number;
  y: number;
  radius: number;
  weapon: Weapon;
  owner: number;
  /** Fighters this blast hit, with damage dealt. */
  hits: { index: number; damage: number }[];
  splash?: boolean;
  flare?: boolean;
  /** A teleporter arrived: where the owner came from (and who got swapped, if anyone). */
  teleport?: { fromX: number; fromY: number; swapped: number | null; lava: boolean };
}

export type CrateKind = "health" | "weapon" | "trap";

export interface Crate {
  id: number;
  x: number;
  y: number;
  vy: number;
  kind: CrateKind;
  landed: boolean;
  dead: boolean;
  sway: number;
}

export interface Pickup {
  crate: Crate;
  /** Fighter that gets it (null when nobody, e.g. a meteor popped it). */
  by: number | null;
}

export class World {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: Uint8Array;
  fighters: Fighter[] = [];
  shots: Shot[] = [];
  crates: Crate[] = [];
  /** Crates opened since the game last drained this. */
  pickups: Pickup[] = [];
  lava: number;
  wind = 0;
  /** Event modifiers: low gravity and wind storms. */
  gravityScale = 1;
  windScale = 1;
  /** Bumped whenever tiles change so the renderer can re-cache. */
  version = 0;
  /** Who last hit each fighter, so lava KOs credit the shooter. */
  lastHitBy: (number | null)[] = [];
  private out: Blast[] = [];
  private turn = 0;
  private crateIds = 0;

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
        index, x, y: sy - FIGHTER_R - 1, vx: 0, vy: 0, hp: MAX_HP, alive: true, grounded: true,
        diedOnTurn: -1, killedBy: null, damageDealt: 0, kos: 0, bestHit: 0, hurt: 0, crates: 0,
      };
    });
  }

  rollWind(): void {
    this.wind = Math.round(this.rng.float(-1, 1) * 10) / 10;
  }

  windAccel(): number {
    return this.wind * 140 * this.windScale;
  }

  fire(owner: number, angle: number, power: number, weapon: Weapon): void {
    const f = this.fighters[owner]!;
    const speed = MAX_SPEED * (0.15 + power * 0.85);
    const angles = weapon.id === "triple" ? [angle - 0.09, angle, angle + 0.09] : [angle];
    for (const a of angles) {
      this.shots.push({
        x: f.x + Math.cos(a) * (FIGHTER_R + 6), y: f.y - Math.sin(a) * (FIGHTER_R + 6),
        vx: Math.cos(a) * speed, vy: -Math.sin(a) * speed, weapon, owner, age: 0, mini: false, dead: false, trail: [],
      });
    }
  }

  /** Drop meteors from the sky (an event). Nobody owns them. */
  meteorShower(count: number): void {
    for (let i = 0; i < count; i++) {
      const x = this.rng.float(0.08, 0.92) * this.width;
      this.shots.push({
        x, y: -40 - i * 70, vx: this.rng.float(-120, 120), vy: this.rng.float(120, 260),
        weapon: METEOR, owner: ENV, age: 0.3, mini: false, dead: false, trail: [],
      });
    }
  }

  /** Earthquake: blobs hop, the ground crumbles in spots. */
  quake(): void {
    for (const f of this.fighters) {
      if (!f.alive) continue;
      f.vy -= this.rng.float(180, 340);
      f.vx += this.rng.float(-160, 160);
      f.grounded = false;
    }
    for (let i = 0; i < 9; i++) {
      const x = this.rng.float(0.06, 0.94) * this.width;
      const y = this.surfaceY(x);
      if (y !== null) this.carve(x, y + this.rng.float(0, 14), this.rng.float(12, 24));
    }
  }

  /** Carve a crevasse straight down to the lava, away from every blob. Returns its x or null. */
  split(): number | null {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = this.rng.float(0.18, 0.82) * this.width;
      if (this.fighters.some((f) => f.alive && Math.abs(f.x - x) < 70)) continue;
      if (this.surfaceY(x) === null) continue;
      const half = 14;
      for (let r = 0; r < this.rows; r++) {
        for (let c = Math.floor((x - half) / TILE); c <= Math.floor((x + half) / TILE); c++) {
          if (c >= 0 && c < this.cols) this.tiles[r * this.cols + c] = 0;
        }
      }
      this.version++;
      return x;
    }
    return null;
  }

  /** Parachute a crate in at x (random if omitted). */
  dropCrate(kind?: CrateKind, x?: number): Crate {
    const roll = this.rng.next();
    const crate: Crate = {
      id: ++this.crateIds,
      x: x ?? this.rng.float(0.08, 0.92) * this.width,
      y: -30,
      vy: 70,
      kind: kind ?? (roll < 0.4 ? "health" : roll < 0.75 ? "weapon" : "trap"),
      landed: false,
      dead: false,
      sway: this.rng.float(0, 6),
    };
    this.crates.push(crate);
    return crate;
  }

  /** Advance everything; returns blasts that happened this step. */
  step(dt: number, turn: number): Blast[] {
    this.out = [];
    this.turn = turn;
    const sub = 4;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const shot of this.shots) if (!shot.dead) this.stepShot(shot, h);
      for (const f of this.fighters) if (f.alive) this.stepFighter(f, h);
      for (const c of this.crates) if (!c.dead) this.stepCrate(c, h);
    }
    this.shots = this.shots.filter((s) => !s.dead);
    this.crates = this.crates.filter((c) => !c.dead);
    return this.out;
  }

  private nearestEnemy(x: number, y: number, owner: number): Fighter | null {
    let best: Fighter | null = null;
    let bd = Infinity;
    for (const f of this.fighters) {
      if (!f.alive || f.index === owner) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private stepShot(shot: Shot, h: number): void {
    shot.age += h;
    const w = shot.weapon;
    const homing = w.id === "sheep" && shot.age > 0.55 ? this.nearestEnemy(shot.x, shot.y, shot.owner) : null;
    if (shot.drilling !== undefined) {
      shot.drilling -= h;
      this.carve(shot.x, shot.y, 13);
    } else if (homing) {
      const want = Math.atan2(homing.y - shot.y, homing.x - shot.x);
      const cur = Math.atan2(shot.vy, shot.vx);
      let diff = want - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-3.4 * h, Math.min(3.4 * h, diff));
      const speed = Math.hypot(shot.vx, shot.vy) * (1 - h) + 400 * h;
      shot.vx = Math.cos(cur + turn) * speed;
      shot.vy = Math.sin(cur + turn) * speed;
    } else {
      shot.vy += GRAVITY * this.gravityScale * h;
      shot.vx += this.windAccel() * h;
    }
    const nx = shot.x + shot.vx * h;
    const ny = shot.y + shot.vy * h;
    const last = shot.trail[shot.trail.length - 1];
    if (!last || Math.hypot(nx - last.x, ny - last.y) > 10) {
      shot.trail.push({ x: nx, y: ny });
      if (shot.trail.length > 24) shot.trail.shift();
    }
    if (nx < -200 || nx > this.width + 200 || ny > this.lava || (ny > this.height + 40)) {
      shot.dead = true;
      if (ny > this.lava && nx > 0 && nx < this.width) {
        if (w.id === "teleport" && !shot.mini) {
          const f = this.fighters[shot.owner];
          const from = f ? { fromX: f.x, fromY: f.y } : { fromX: nx, fromY: ny };
          if (f?.alive) {
            f.x = nx;
            f.y = this.lava + FIGHTER_R + 2;
            this.kill(f, this.turn, null);
          }
          this.out.push({ x: nx, y: this.lava, radius: 30, weapon: w, owner: shot.owner, hits: [], splash: true, teleport: { ...from, swapped: null, lava: true } });
        } else {
          this.out.push({ x: nx, y: this.lava, radius: 24, weapon: w, owner: shot.owner, hits: [], splash: true });
        }
      }
      return;
    }
    if (shot.age > 9 || (w.id === "sheep" && shot.age > 6) || (shot.drilling !== undefined && shot.drilling <= 0)) {
      shot.x = nx;
      shot.y = ny;
      this.explode(shot);
      return;
    }
    if (w.fuse !== undefined && !shot.mini && shot.age >= w.fuse) {
      shot.x = nx;
      shot.y = ny;
      this.explode(shot);
      return;
    }
    const victim = this.fighters.find((f) => f.alive && (f.index !== shot.owner || shot.age > 0.25) && Math.hypot(f.x - nx, f.y - ny) < FIGHTER_R + 5);
    const solid = this.solidAt(nx, ny);
    if (shot.drilling !== undefined && !victim) {
      shot.x = nx;
      shot.y = ny;
      return;
    }
    if (solid || victim) {
      if (w.id === "teleport" && !shot.mini) {
        shot.dead = true;
        this.teleport(shot.owner, nx, ny, victim && victim.index !== shot.owner ? victim : null);
        return;
      }
      if (w.id === "drill" && !shot.mini && solid && !victim) {
        const speed = Math.max(1, Math.hypot(shot.vx, shot.vy));
        shot.vx = (shot.vx / speed) * 300;
        shot.vy = (shot.vy / speed) * 300;
        shot.drilling = 0.75;
        shot.x = nx;
        shot.y = ny;
        return;
      }
      if (w.bounces && !shot.mini) {
        // Reflect on whichever axis is blocked.
        const blockX = this.solidAt(nx, shot.y);
        const blockY = this.solidAt(shot.x, ny);
        if (blockX || victim) shot.vx *= -0.55;
        if (blockY || (!blockX && !victim)) shot.vy *= -0.55;
        shot.vx *= 0.9;
        return;
      }
      shot.x = nx;
      shot.y = ny;
      this.explode(shot);
      return;
    }
    shot.x = nx;
    shot.y = ny;
  }

  private teleport(owner: number, x: number, y: number, victim: Fighter | null): void {
    const f = this.fighters[owner];
    if (!f || !f.alive) return;
    const fromX = f.x;
    const fromY = f.y;
    if (victim) {
      // Landed on someone: swap places.
      f.x = victim.x;
      f.y = victim.y;
      victim.x = fromX;
      victim.y = fromY;
      victim.vx = victim.vy = 0;
    } else {
      f.x = x;
      f.y = y - FIGHTER_R - 2;
      for (let i = 0; i < 60 && (this.solidAt(f.x, f.y + FIGHTER_R - 2) || this.solidAt(f.x, f.y)); i++) f.y -= 2;
    }
    f.vx = 0;
    f.vy = 0;
    f.grounded = false;
    this.out.push({ x: f.x, y: f.y, radius: 26, weapon: weaponById("teleport"), owner, hits: [], teleport: { fromX, fromY, swapped: victim?.index ?? null, lava: false } });
  }

  private explode(shot: Shot): void {
    shot.dead = true;
    const w = shot.weapon;
    const child = w.child;
    if (shot.mini && child) {
      this.out.push(this.blast(shot.x, shot.y, child.radius, child.damage, child.knock, w, shot.owner, this.turn));
      return;
    }
    if (child && w.id === "airstrike") {
      // The flare marks the spot; bombers drop a line of bombs across it.
      for (let i = 0; i < child.count; i++) {
        this.shots.push({
          x: shot.x + (i - (child.count - 1) / 2) * 44, y: -30 - i * 26, vx: 0, vy: 240,
          weapon: w, owner: shot.owner, age: 0.3, mini: true, dead: false, trail: [],
        });
      }
      this.out.push({ x: shot.x, y: shot.y, radius: 18, weapon: w, owner: shot.owner, hits: [], flare: true });
      return;
    }
    if (child) {
      for (let i = 0; i < child.count; i++) {
        const a = -Math.PI / 2 + (i - (child.count - 1) / 2) * 0.38;
        this.shots.push({
          x: shot.x, y: shot.y - 6, vx: Math.cos(a) * 260 + this.rng.float(-40, 40), vy: Math.sin(a) * 300,
          weapon: w, owner: shot.owner, age: 0.3, mini: true, dead: false, trail: [],
        });
      }
    }
    const scale = w.id === "cluster" ? 0.8 : 1;
    this.out.push(this.blast(shot.x, shot.y, w.radius * scale, w.damage * scale, w.knock * scale, w, shot.owner, this.turn));
  }

  blast(x: number, y: number, radius: number, damage: number, knock: number, weapon: Weapon, owner: number, turn: number): Blast {
    if (weapon.carves) this.carve(x, y, radius * 0.8);
    const hits: Blast["hits"] = [];
    const shooter = owner >= 0 ? this.fighters[owner] : undefined;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius + FIGHTER_R) continue;
      const falloff = 1 - Math.min(1, Math.max(0, d - FIGHTER_R) / radius);
      const dmg = Math.round(damage * (0.35 + 0.65 * falloff));
      const nx = d > 0.01 ? dx / d : 0;
      const ny = d > 0.01 ? dy / d : -1;
      const k = knock * (0.4 + 0.6 * falloff);
      f.vx += nx * k;
      f.vy += ny * k - k * 0.45;
      f.grounded = false;
      if (owner >= 0 && owner !== f.index) this.lastHitBy[f.index] = owner;
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
    // Blasts pop crates open for whoever fired.
    for (const c of this.crates) {
      if (!c.dead && Math.hypot(c.x - x, c.y - y) < Math.max(radius, 20) + CRATE_R) this.openCrate(c, owner >= 0 ? owner : null);
    }
    return { x, y, radius, weapon, owner, hits };
  }

  private openCrate(c: Crate, by: number | null): void {
    if (c.dead) return;
    c.dead = true;
    this.pickups.push({ crate: c, by });
    if (c.kind === "trap") {
      this.out.push(this.blast(c.x, c.y, TRAP.radius, TRAP.damage, TRAP.knock, TRAP, ENV, this.turn));
      return;
    }
    const f = by !== null ? this.fighters[by] : undefined;
    if (!f || !f.alive) return;
    f.crates++;
    if (c.kind === "health") f.hp = Math.min(MAX_HP, f.hp + 35);
  }

  private stepCrate(c: Crate, h: number): void {
    c.sway += h;
    if (!c.landed) {
      c.y += c.vy * h;
      c.x += Math.sin(c.sway * 1.7) * 14 * h + this.windAccel() * 0.08 * h;
      if (this.solidAt(c.x, c.y + CRATE_R)) {
        c.landed = true;
        c.vy = 0;
        while (this.solidAt(c.x, c.y + CRATE_R - 1)) c.y -= 1;
      }
    } else if (!this.solidAt(c.x, c.y + CRATE_R + 1)) {
      // Ground blown away: tumble without the chute.
      c.vy += GRAVITY * h;
      c.y += c.vy * h;
      if (this.solidAt(c.x, c.y + CRATE_R)) {
        c.vy = 0;
        while (this.solidAt(c.x, c.y + CRATE_R - 1)) c.y -= 1;
      }
    }
    if (c.y > this.lava || c.x < -40 || c.x > this.width + 40) {
      c.dead = true;
      return;
    }
    for (const f of this.fighters) {
      if (f.alive && Math.hypot(f.x - c.x, f.y - c.y) < FIGHTER_R + CRATE_R + 2) {
        this.openCrate(c, f.index);
        return;
      }
    }
  }

  private carve(x: number, y: number, radius: number): void {
    const c0 = Math.floor((x - radius) / TILE);
    const c1 = Math.floor((x + radius) / TILE);
    const r0 = Math.floor((y - radius) / TILE);
    const r1 = Math.floor((y + radius) / TILE);
    let changed = false;
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
        const cx = c * TILE + TILE / 2;
        const cy = r * TILE + TILE / 2;
        const i = r * this.cols + c;
        if (this.tiles[i] === 1 && (cx - x) ** 2 + (cy - y) ** 2 <= radius * radius) {
          this.tiles[i] = 0;
          changed = true;
        }
      }
    }
    if (changed) this.version++;
  }

  kill(f: Fighter, turn: number, by: number | null): void {
    if (!f.alive) return;
    f.alive = false;
    f.hp = Math.max(0, f.hp);
    f.diedOnTurn = turn;
    f.killedBy = by !== null && by >= 0 ? by : null;
    if (by !== null && by >= 0 && by !== f.index) this.fighters[by]!.kos++;
  }

  private stepFighter(f: Fighter, h: number): void {
    f.hurt = Math.max(0, f.hurt - h);
    f.vy += GRAVITY * this.gravityScale * h;
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
      this.kill(f, this.turn, this.lastHitBy[f.index] ?? null);
    }
  }

  settled(): boolean {
    if (this.shots.length > 0) return false;
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
      vy += GRAVITY * this.gravityScale * h;
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
