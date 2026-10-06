import type { Arena, Solid, Wall } from "./types";

const ARENA_KINDS = ["rink", "slab", "donut", "twin", "cross", "cheese", "pinball", "bunker", "clover"] as const;
export type ArenaKind = (typeof ARENA_KINDS)[number];
export { ARENA_KINDS };

function rr(x: number, y: number, hw: number, hh: number, cr: number): Solid {
  return { t: "r", x, y, hw, hh, cr: Math.min(cr, hw, hh) };
}

function ci(x: number, y: number, r: number): Solid {
  return { t: "c", x, y, r };
}

export function sdfSolids(a: Arena, x: number, y: number, sc: number): number {
  let m = 1e9;
  const ix = x / sc;
  const iy = y / sc;
  for (const s of a.solids) {
    let d: number;
    if (s.t === "c") {
      d = Math.hypot(ix - s.x!, iy - s.y!) - s.r!;
    } else {
      const qx = Math.abs(ix - s.x!) - (s.hw! - s.cr!);
      const qy = Math.abs(iy - s.y!) - (s.hh! - s.cr!);
      d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.cr!;
    }
    if (d < m) m = d;
  }
  return m * sc;
}

export function sdf(a: Arena, x: number, y: number, sc = a.scale): number {
  let d = sdfSolids(a, x, y, sc);
  for (const h of a.holes) {
    const hd = h.r - Math.hypot(x - h.x, y - h.y);
    if (hd > d) d = hd;
  }
  return d;
}

export function segDist(w: Wall, x: number, y: number): { d: number; px: number; py: number } {
  const vx = w.x2 - w.x1;
  const vy = w.y2 - w.y1;
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - w.x1) * vx + (y - w.y1) * vy) / l2));
  const px = w.x1 + vx * t;
  const py = w.y1 + vy * t;
  return { d: Math.hypot(x - px, y - py), px, py };
}

export function clearOfObstacles(a: Arena, x: number, y: number, r: number): boolean {
  for (const b of a.bumpers) {
    if (!b.gone && Math.hypot(x - b.x, y - b.y) < b.r + r) return false;
  }
  for (const w of a.walls) {
    if (!w.gone && segDist(w, x, y).d < w.r + r) return false;
  }
  return true;
}

export function buildArena(kind: ArenaKind, ax: number, ay: number, random: () => number): Arena {
  const horiz = ax >= ay;
  const L = Math.max(ax, ay);
  const a: Arena = { kind, name: "", ax, ay, solids: [], holes: [], bumpers: [], walls: [], scale: 1, spawnAxis: false };

  const bump = (x: number, y: number, r = 0.1): void => {
    a.bumpers.push({ x, y, r, hitT: 0, gone: false, fade: 1 });
  };
  const o = (u: number, v: number) => (horiz ? { x: u, y: v } : { x: v, y: u });
  const sym = (fn: () => boolean): void => {
    for (let tries = 0; tries < 60; tries++) if (fn()) return;
  };

  switch (kind) {
    case "rink":
      a.name = "THE RINK";
      a.solids.push(rr(0, 0, ax, ay, Math.min(ax, ay)));
      if (random() < 0.6) {
        const p = o(L * 0.32, 0);
        bump(p.x, p.y);
        bump(-p.x, -p.y);
      }
      break;
    case "slab":
      a.name = "THE SLAB";
      a.solids.push(rr(0, 0, ax, ay, 0.14));
      if (random() < 0.5) bump(0, 0, 0.13);
      break;
    case "donut":
      a.name = "THE DONUT";
      a.solids.push(rr(0, 0, ax, ay, Math.min(ax, ay)));
      a.holes.push({ x: 0, y: 0, r: 0.34 });
      break;
    case "twin": {
      a.name = "TWIN ISLANDS";
      const r = Math.min(0.92, L * 0.62);
      const off = L - r;
      const c1 = o(off, 0);
      const br = o(off, 0.24);
      a.solids.push(ci(c1.x, c1.y, r), ci(-c1.x, -c1.y, r), rr(0, 0, Math.max(br.x, 0.24), Math.max(br.y, 0.24), 0.1));
      break;
    }
    case "cross":
      a.name = "CROSSROADS";
      a.spawnAxis = true;
      a.solids.push(rr(0, 0, ax, 0.4, 0.16), rr(0, 0, 0.4, ay, 0.16), ci(0, 0, 0.66));
      bump(0, 0, 0.12);
      break;
    case "cheese": {
      a.name = "SWISS CHEESE";
      a.solids.push(rr(0, 0, ax, ay, 0.3));
      const n = 2 + (random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++)
        sym(() => {
          const x = (random() * 2 - 1) * ax * 0.7;
          const y = (random() * 2 - 1) * ay * 0.7;
          const r = 0.13 + random() * 0.07;
          if (Math.hypot(x, y) < r + 0.2) return false;
          for (const h of a.holes) {
            if (Math.hypot(x - h.x, y - h.y) < r + h.r + 0.3) return false;
            if (Math.hypot(-x - h.x, -y - h.y) < r + h.r + 0.3) return false;
          }
          a.holes.push({ x, y, r }, { x: -x, y: -y, r });
          return true;
        });
      break;
    }
    case "pinball": {
      a.name = "PINBALL";
      a.solids.push(rr(0, 0, ax, ay, Math.min(ax, ay) * 0.8));
      bump(0, 0, 0.13);
      for (let i = 0; i < 3; i++)
        sym(() => {
          const x = (random() * 2 - 1) * ax * 0.62;
          const y = (random() * 2 - 1) * ay * 0.62;
          if (Math.hypot(x, y) < 0.4) return false;
          for (const b of a.bumpers) {
            if (Math.hypot(x - b.x, y - b.y) < 0.45) return false;
            if (Math.hypot(-x - b.x, -y - b.y) < 0.45) return false;
          }
          bump(x, y);
          bump(-x, -y);
          return true;
        });
      break;
    }
    case "bunker": {
      a.name = "THE BUNKER";
      a.solids.push(rr(0, 0, ax, ay, 0.2));
      const u = L * 0.34;
      const v = 0.42;
      const len = 0.26;
      const add = (p: { x: number; y: number }, q: { x: number; y: number }): void => {
        a.walls.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, r: 0.035, gone: false, fade: 1, hitT: 0 });
      };
      for (const su of [-1, 1])
        for (const sv of [-1, 1]) {
          add(o(su * u, sv * v), o(su * (u - len), sv * v));
          add(o(su * u, sv * v), o(su * u, sv * (v - len)));
        }
      break;
    }
    case "clover": {
      a.name = "CLOVER";
      const r = 0.6;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) a.solids.push(ci(sx * (ax - r), sy * (ay - r), r));
      a.solids.push(rr(0, 0, ax - r, ay - r, 0.1));
      break;
    }
  }
  return a;
}
