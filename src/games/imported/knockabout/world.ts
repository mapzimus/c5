import { buildArena, clearOfObstacles, sdf, sdfSolids, segDist, type ArenaKind } from "./arena";
import type { Arena, Disc, FallEvent, HitEvent, MatchPlayer, PowerUp, PowerUpType } from "./types";
import { TUNING } from "./types";

export interface WorldEvents {
  onHit(event: HitEvent): void;
  onFall(event: FallEvent): void;
  onBumperHit(disc: Disc, bumperX: number, bumperY: number): void;
  onWallHit(disc: Disc): void;
  onPowerUp(disc: Disc, type: PowerUpType): void;
  onExplode(disc: Disc): void;
}

const TAU = Math.PI * 2;

export class World {
  discs: Disc[] = [];
  arena!: Arena;
  powerups: PowerUp[] = [];
  private nextId = 1;

  constructor(
    private readonly random: () => number,
    private readonly events: WorldEvents,
  ) {}

  buildArena(kind: ArenaKind, ax: number, ay: number): void {
    this.arena = buildArena(kind, ax, ay, this.random);
    this.discs = [];
    this.powerups = [];
    this.nextId = 1;
  }

  makeDisc(owner: number, x: number, y: number, player: MatchPlayer, delay = 0): Disc {
    const r = TUNING.discRadius;
    const d: Disc = {
      id: this.nextId++,
      owner,
      x, y,
      vx: 0, vy: 0,
      r, baseR: r,
      mass: 1,
      inst: null,
      aim: null,
      grab: null,
      falling: false,
      fallT: 0,
      dead: false,
      spawnT: -delay * 3,
      look: Math.atan2(-player.dir.y, -player.dir.x),
      giant: 0,
      turbo: false,
      bomb: false,
      life: false,
      saveT: 0,
      perks: [],
    };
    this.discs.push(d);
    return d;
  }

  spawnDiscs(players: MatchPlayer[], discsPerPlayer: number): void {
    const a = this.arena;
    const r = TUNING.discRadius;
    const cands: { x: number; y: number; sd: number; nx: number; ny: number }[] = [];
    const st = 0.05;
    for (let x = -a.ax; x <= a.ax; x += st) {
      for (let y = -a.ay; y <= a.ay; y += st) {
        const sd = sdf(a, x, y, 1);
        if (sd < -r * 1.3 && clearOfObstacles(a, x, y, r * 1.5)) {
          cands.push({ x, y, sd, nx: x / a.ax, ny: y / a.ay });
        }
      }
    }

    const N = players.length;
    const chosen: { x: number; y: number }[] = [];
    const dirs = players.map((p) => {
      if (a.spawnAxis && N === 4) {
        const ang = Math.PI + (TAU * p.id) / 4;
        return { x: Math.cos(ang), y: Math.sin(ang) };
      }
      return p.dir;
    });

    for (let k = 0; k < discsPerPlayer; k++) {
      for (let i = 0; i < N; i++) {
        const d = dirs[i]!;
        let best: { x: number; y: number } | null = null;
        let bs = -1e9;
        for (const margin of [3.6, 2.6, 1.9, 1.3]) {
          if (best) break;
          for (const c of cands) {
            if (c.sd > -r * margin) continue;
            const along = c.nx * d.x + c.ny * d.y;
            const side = Math.abs(c.nx * -d.y + c.ny * d.x);
            const sc = along - 0.6 * side;
            if (sc <= bs) continue;
            let ok = true;
            for (const q of chosen) {
              if (Math.hypot(q.x - c.x, q.y - c.y) < r * 2.7) { ok = false; break; }
            }
            if (ok) { bs = sc; best = c; }
          }
        }
        if (best) {
          chosen.push(best);
          this.makeDisc(i, best.x, best.y, players[i]!, 0.15 + k * 0.08 + i * 0.05);
        }
      }
    }
  }

  aliveDiscs(owner?: number): Disc[] {
    return this.discs.filter((d) => !d.dead && !d.falling && (owner === undefined || d.owner === owner));
  }

  aliveOwners(): Set<number> {
    const s = new Set<number>();
    for (const d of this.discs) if (!d.dead && !d.falling) s.add(d.owner);
    return s;
  }

  step(h: number): void {
    const a = this.arena;
    if (!a) return;
    const T = TUNING;
    const e = Math.min(1.15, T.restitution);
    const ds = this.discs;

    for (const d of ds) {
      if (d.dead) continue;
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > 0) {
        let ns = Math.max(0, sp - T.slide * h) * Math.exp(-T.drag * h);
        if (ns < 0.012) ns = 0;
        const k = ns / sp;
        d.vx *= k;
        d.vy *= k;
        d.x += d.vx * h;
        d.y += d.vy * h;
      }
      if (d.falling) {
        d.fallT += h / 0.6;
        if (d.fallT >= 1) d.dead = true;
      }
    }

    // disc-disc collisions
    for (let i = 0; i < ds.length; i++) {
      const A = ds[i]!;
      if (A.dead || A.falling) continue;
      for (let j = i + 1; j < ds.length; j++) {
        const B = ds[j]!;
        if (B.dead || B.falling) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const rs = A.r + B.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rs * rs) continue;
        let dist = Math.sqrt(d2);
        let nx: number, ny: number;
        if (dist < 1e-6) { nx = 1; ny = 0; dist = 0; } else { nx = dx / dist; ny = dy / dist; }
        const ov = rs - dist;
        const im = 1 / A.mass;
        const jm = 1 / B.mass;
        const tm = im + jm;
        A.x -= nx * ov * im / tm;
        A.y -= ny * ov * im / tm;
        B.x += nx * ov * jm / tm;
        B.y += ny * ov * jm / tm;
        const vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (vn < 0) {
          const sa = Math.hypot(A.vx, A.vy);
          const sb = Math.hypot(B.vx, B.vy);
          const jimp = -(1 + e) * vn / tm;
          A.vx -= jimp * im * nx;
          A.vy -= jimp * im * ny;
          B.vx += jimp * jm * nx;
          B.vy += jimp * jm * ny;
          if (sa >= sb) { if (A.inst != null) B.inst = A.inst; }
          else if (B.inst != null) A.inst = B.inst;
          this.events.onHit({ a: A, b: B, strength: -vn, cx: A.x + nx * A.r, cy: A.y + ny * A.r });
          if (-vn > 0.4 && A.owner !== B.owner) {
            if (A.bomb) this.explode(A);
            if (B.bomb) this.explode(B);
          }
        }
      }
    }

    // bumper collisions
    for (const d of ds) {
      if (d.dead || d.falling) continue;
      for (const b of a.bumpers) {
        if (b.gone) continue;
        const dx = d.x - b.x;
        const dy = d.y - b.y;
        const rs = d.r + b.r;
        const dist = Math.hypot(dx, dy);
        if (dist >= rs) continue;
        const nx = dist > 1e-6 ? dx / dist : 1;
        const ny = dist > 1e-6 ? dy / dist : 0;
        d.x = b.x + nx * rs;
        d.y = b.y + ny * rs;
        const vn = d.vx * nx + d.vy * ny;
        if (vn < 0) {
          d.vx -= 2 * vn * nx;
          d.vy -= 2 * vn * ny;
          if (vn < -0.3) {
            d.vx += nx * T.bumperKick;
            d.vy += ny * T.bumperKick;
            b.hitT = 1;
            this.events.onBumperHit(d, b.x, b.y);
          }
        }
      }

      // wall collisions
      for (const w of a.walls) {
        if (w.gone) continue;
        const sd = segDist(w, d.x, d.y);
        const rs = d.r + w.r;
        if (sd.d >= rs) continue;
        const nx = sd.d > 1e-6 ? (d.x - sd.px) / sd.d : 1;
        const ny = sd.d > 1e-6 ? (d.y - sd.py) / sd.d : 0;
        d.x = sd.px + nx * rs;
        d.y = sd.py + ny * rs;
        const vn = d.vx * nx + d.vy * ny;
        if (vn < 0) {
          d.vx -= 1.8 * vn * nx;
          d.vy -= 1.8 * vn * ny;
          if (vn < -0.4) {
            w.hitT = 1;
            this.events.onWallHit(d);
          }
        }
      }

      // power-up collection
      for (const pu of this.powerups) {
        if (!pu.gone && Math.hypot(d.x - pu.x, d.y - pu.y) < d.r + pu.r) {
          this.applyPower(d, pu);
        }
      }

      // edge fall detection
      if (d.spawnT >= 1 && sdf(a, d.x, d.y) > 0) {
        this.startFall(d);
      }
    }
  }

  private startFall(d: Disc): void {
    const a = this.arena;
    if (d.life) {
      const e = 0.01;
      let gx = sdf(a, d.x + e, d.y) - sdf(a, d.x - e, d.y);
      let gy = sdf(a, d.x, d.y + e) - sdf(a, d.x, d.y - e);
      let gl = Math.hypot(gx, gy);
      if (gl < 1e-6) { gx = d.x; gy = d.y; gl = Math.hypot(gx, gy) || 1; }
      gx /= gl;
      gy /= gl;
      const v = sdf(a, d.x, d.y);
      d.x -= gx * (v + 0.04);
      d.y -= gy * (v + 0.04);
      const vn = d.vx * gx + d.vy * gy;
      if (vn > 0) { d.vx -= 2 * vn * gx; d.vy -= 2 * vn * gy; }
      d.vx -= gx * 1.3;
      d.vy -= gy * 1.3;
      d.life = false;
      d.saveT = 1;
      if (sdf(a, d.x, d.y) <= 0) return;
    }

    d.falling = true;
    d.fallT = 0;
    d.vx *= 0.55;
    d.vy *= 0.55;
    d.aim = null;
    if (d.grab != null) d.grab = null;

    const lastAlive = this.aliveDiscs(d.owner).length === 0;
    this.events.onFall({
      disc: d,
      killer: d.inst != null && d.inst !== d.owner ? d.inst : null,
      selfKill: d.inst === d.owner,
      lastAlive,
    });
  }

  private explode(src: Disc): void {
    src.bomb = false;
    this.events.onExplode(src);
    const T = TUNING;
    for (const d of this.discs) {
      if (d === src || d.dead || d.falling) continue;
      const dx = d.x - src.x;
      const dy = d.y - src.y;
      const ds = Math.hypot(dx, dy) || 1e-6;
      if (ds > T.bombRadius) continue;
      const f = (1 - ds / T.bombRadius) * T.bombForce / d.mass;
      d.vx += (dx / ds) * f;
      d.vy += (dy / ds) * f;
      d.inst = src.owner;
    }
  }

  private applyPower(d: Disc, pu: PowerUp): void {
    pu.gone = true;
    this.events.onPowerUp(d, pu.type);
    switch (pu.type) {
      case "bomb": d.bomb = true; break;
      case "turbo": d.turbo = true; break;
      case "life": d.life = true; break;
      case "giant": d.giant = 7; break;
      case "clone": {
        const a = this.arena;
        let sx = d.x, sy = d.y;
        for (let k = 0; k < 10; k++) {
          const ang = (k / 10) * TAU;
          const x = d.x + Math.cos(ang) * d.r * 2.2;
          const y = d.y + Math.sin(ang) * d.r * 2.2;
          if (sdf(a, x, y) < -d.baseR && clearOfObstacles(a, x, y, d.baseR)) { sx = x; sy = y; break; }
        }
        const n: Disc = {
          id: this.nextId++, owner: d.owner, x: sx, y: sy,
          vx: d.vx * 0.3, vy: d.vy * 0.3,
          r: d.baseR, baseR: d.baseR, mass: 1,
          inst: d.inst, aim: null, grab: null,
          falling: false, fallT: 0, dead: false, spawnT: 0,
          look: d.look, giant: 0, turbo: false, bomb: false, life: false, saveT: 0,
          perks: [],
        };
        this.discs.push(n);
        break;
      }
    }
  }

  spawnPowerup(): void {
    const a = this.arena;
    const sc = Math.max(TUNING.minArenaScale, this.shrinkTarget() - 0.05);
    let best: { x: number; y: number } | null = null;
    let bs = -1e9;
    for (let i = 0; i < 60; i++) {
      const x = (this.random() * 2 - 1) * a.ax;
      const y = (this.random() * 2 - 1) * a.ay;
      if (sdf(a, x, y, sc) > -0.14 || !clearOfObstacles(a, x, y, 0.12)) continue;
      let near = false;
      const per: Record<number, number> = {};
      for (const d of this.discs) {
        if (d.dead || d.falling) continue;
        const ds = Math.hypot(d.x - x, d.y - y);
        if (ds < 0.22) { near = true; break; }
        per[d.owner] = Math.min(per[d.owner] ?? 9, ds);
      }
      if (near) continue;
      for (const p of this.powerups) if (Math.hypot(p.x - x, p.y - y) < 0.3) near = true;
      if (near) continue;
      const v = Object.values(per);
      const score = v.length ? -(Math.max(...v) - Math.min(...v)) : 0;
      if (score > bs) { bs = score; best = { x, y }; }
    }
    if (!best) return;
    const types: PowerUpType[] = ["bomb", "turbo", "giant", "life", "clone"];
    this.powerups.push({ x: best.x, y: best.y, type: types[Math.floor(this.random() * types.length)]!, r: 0.085, t: 0, gone: false });
  }

  shrinkTarget(turn?: number): number {
    const t = turn ?? 0;
    const n = Math.max(1, this.aliveOwners().size);
    if (t <= 0 || this.arena.scale <= TUNING.minArenaScale + 1e-4) return this.arena.scale;
    return Math.max(TUNING.minArenaScale, this.arena.scale - TUNING.shrinkPerTurn / n);
  }

  settled(): boolean {
    for (const d of this.discs) {
      if (d.dead) continue;
      if (d.falling) return false;
      if (Math.hypot(d.vx, d.vy) > 0.03) return false;
    }
    for (const d of this.discs) { d.vx = 0; d.vy = 0; }
    return true;
  }

  cleanDead(): void {
    this.discs = this.discs.filter((d) => !d.dead);
    this.powerups = this.powerups.filter((p) => !p.gone);
  }

  updateVisuals(dt: number): void {
    const a = this.arena;
    for (const d of this.discs) {
      if (d.spawnT < 1) d.spawnT = Math.min(1, d.spawnT + dt * 3);
      const rT = d.baseR * (d.giant > 0 ? 1.42 : 1);
      d.r = d.r + (rT - d.r) * Math.min(1, dt * 8);
      d.mass = d.giant > 0 ? 2.6 : 1;
      if (d.saveT > 0) d.saveT -= dt * 2;
      const sp = Math.hypot(d.vx, d.vy);
      if (d.aim) d.look = Math.atan2(d.aim.dy, d.aim.dx);
      else if (sp > 0.25) d.look = Math.atan2(d.vy, d.vx);
    }
    for (const b of a.bumpers) {
      b.hitT = Math.max(0, b.hitT - dt * 4);
      if (!b.gone && sdfSolids(a, b.x, b.y, a.scale) > -b.r * 0.4) b.gone = true;
      if (b.gone) b.fade = Math.max(0, b.fade - dt * 3);
    }
    for (const w of a.walls) {
      w.hitT = Math.max(0, w.hitT - dt * 4);
      if (!w.gone && (sdfSolids(a, w.x1, w.y1, a.scale) > -0.02 || sdfSolids(a, w.x2, w.y2, a.scale) > -0.02)) w.gone = true;
      if (w.gone) w.fade = Math.max(0, w.fade - dt * 3);
    }
    for (const pu of this.powerups) {
      pu.t += dt;
      if (!pu.gone && sdf(a, pu.x, pu.y) > -0.03) pu.gone = true;
    }
  }

  launchDisc(d: Disc): number {
    if (!d.aim) return 0;
    const pw = d.aim.power;
    const sp = TUNING.maxLaunchSpeed * pw * (d.turbo ? TUNING.turboMul : 1);
    d.vx = d.aim.dx * sp;
    d.vy = d.aim.dy * sp;
    d.inst = d.owner;
    if (d.turbo) d.turbo = false;
    d.aim = null;
    d.grab = null;
    return pw;
  }

  /** Predict how far a disc will slide from a given speed. */
  stopDistance(v0: number): number {
    let sp = v0;
    let dist = 0;
    const h = 1 / 60;
    for (let i = 0; i < 600 && sp > 0.02; i++) {
      sp = Math.max(0, sp - TUNING.slide * h) * Math.exp(-TUNING.drag * h);
      dist += sp * h;
    }
    return dist;
  }
}
