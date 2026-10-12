import { fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  EMPTY,
  FENCE_PTS,
  HAUNT_PTS,
  INK_BASE,
  INK_SECS,
  MIN_CLAIM_FRAC,
  OUTLAST_PTS,
  PICKUPS,
  PICKUP_KINDS,
  ROUNDS,
  ROUND_WIN_PTS,
  SHRINK_START,
  SHRINK_START_FINAL,
  TERRITORY_BASE,
  TRAP_PTS,
  TrailGrid,
  arenaInset,
  botCurl,
  botSteer,
  CLAIM_PTS_PER_PCT,
  claimPercent,
  findPickupSpot,
  isInk,
  isTerritory,
  loopStart,
  matchWinner,
  pickSpawns,
  pointInPolygon,
  polygonArea,
  roundMultiplier,
  skimDistance,
  skimPoints,
  wraithSteer,
  wrapPoint,
  type Pickup,
  type Point,
} from "./curve-clash-logic";

export const curveClash: GameDefinition = {
  id: "curve-clash",
  name: "Curve Clash",
  tagline: "Draw the line. Close the loop.",
  description:
    "You're a line that never stops. Rival lines and walls kill you, but crossing your OWN line " +
    "closes a loop: everything inside becomes your ground, lines inside vanish and any rival caught " +
    "inside is TRAPPED. Die and you come back as a wraith laying deadly ink in the survivors' way. " +
    "Power-ups, near-miss points and closing walls. Three rounds, the last one counts double. " +
    "Most points wins.",
  durationMs: 0,
  controls:
    "Hold ◀ / ▶ in your corner to turn. Keys: your left/right. Cross your own line to claim the loop. " +
    "Dead? Steer your wraith into the survivors' path.",
  create: (ctx) => new CurveClash(ctx),
};

const BEST_VERSION = "v2-loops";
const SPEED = 130;
const FINAL_SPEED = 1.2;
const SPEED_RAMP = 0.015; // +1.5% per second of round, keeps rounds short
const SPEED_RAMP_MAX = 0.7;
const TURN_RATE = 3.2; // rad/s
const LINE_W = 5;
const SELF_IGNORE_PX = 22;
const LOOP_SKIP_PX = 34;
const PATH_STEP = 3;
const GAP_EVERY_MIN = 2;
const GAP_EVERY_MAX = 3;
const GAP_LEN_PX = 26;
const COUNTDOWN = 2.4;
const ROUND_OVER = 1.9;
const BOT_THINK = 0.08;
const BOT_PICKUP_RANGE = 420;
const PICKUP_R = 16;
const PICKUP_FIRST = 3.5;
const PICKUP_EVERY_MIN = 4.5;
const PICKUP_EVERY_MAX = 7;
const PICKUP_MAX = 2;
const WRAP_SECS = 5;
const GHOST_SECS = 3;
const SKIM_CONFIRM = 0.25; // must survive this long after a skim to bank it
const SKIM_COOLDOWN = 0.6;
const CLAIM_COOLDOWN = 0.45;
const WRAITH_DELAY = 1.0;
const WRAITH_SPEED = 0.9;
const WRAITH_TURN = 1.25;
const WRAITH_THINK = 0.14;
const WRAITH_LEAD = 0.9;
const INK_ON = 1.4;
const INK_OFF = 0.9;
const INK_W = 5;

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface InkSeg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

interface Flash {
  poly: Point[];
  color: string;
  life: number;
}

type Phase = "countdown" | "play" | "roundOver" | "matchOver";

interface Pad {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: -1 | 1;
}

interface Snake {
  idx: number;
  player: Player;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  gapIn: number;
  gapLeft: number;
  steer: -1 | 0 | 1;
  botTimer: number;
  roundWins: number;
  outlasted: number;
  pads: Pad[];
  /** Seconds of ghost left: no trail, passes through lines. */
  ghost: number;
  skimming: boolean;
  skimCool: number;
  /** A skim waiting to be banked (cancelled if the line dies first). */
  skimPending: number;
  skimTimer: number;
  skimPts: number;
  grabs: number;
  /** Points this match. */
  score: number;
  /** Percent of the board claimed, summed over the match. */
  area: number;
  /** Rivals trapped, haunted or fenced. */
  kills: number;
  /** The line since the last claim/reset, for closing loops. */
  path: Point[];
  claimCool: number;
  /** Bot loop intent. */
  curlTimer: number;
  curlLeft: number;
  curlDir: -1 | 1;
  /** Dead and back as a wraith. */
  wraith: boolean;
  respawnIn: number;
  inkTimer: number;
  inkOn: boolean;
}

/** Why a line died, for scoring. */
interface Death {
  s: Snake;
  /** Grid owner code that killed it, EMPTY for walls/traps. */
  code: number;
  trappedBy?: Snake;
}

class CurveClash implements GameInstance {
  private readonly snakes: Snake[];
  private readonly grid: TrailGrid;
  private readonly trail: HTMLCanvasElement;
  private readonly trailG: CanvasRenderingContext2D | null;
  private readonly floor: HTMLCanvasElement;
  private readonly floorG: CanvasRenderingContext2D | null;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly held = new Map<number, { snake: Snake; dir: -1 | 1 }>();
  private phase: Phase = "countdown";
  private phaseTime = COUNTDOWN;
  private lastCount = 0;
  private roundTime = 0;
  private round = 0;
  private finished = false;
  private pickups: Pickup[] = [];
  private pickupIn = PICKUP_FIRST;
  /** Seconds left of portal walls (shared by everyone). */
  private wrap = 0;
  private shrinkWarned = false;
  private readonly floaters: Floater[] = [];
  private ink: InkSeg[] = [];
  private flashes: Flash[] = [];
  private bestShown = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.grid = new TrailGrid(ctx.width, ctx.height);
    this.trail = document.createElement("canvas");
    this.trail.width = ctx.width;
    this.trail.height = ctx.height;
    this.trailG = this.trail.getContext("2d");
    this.floor = document.createElement("canvas");
    this.floor.width = ctx.width;
    this.floor.height = ctx.height;
    this.floorG = this.floor.getContext("2d");

    this.snakes = ctx.players.map((player, idx) => ({
      idx,
      player,
      x: 0,
      y: 0,
      angle: 0,
      alive: true,
      gapIn: 0,
      gapLeft: 0,
      steer: 0,
      botTimer: 0,
      roundWins: 0,
      outlasted: 0,
      pads: player.kind === "human" ? this.makePads(idx) : [],
      ghost: 0,
      skimming: false,
      skimCool: 0,
      skimPending: 0,
      skimTimer: 0,
      skimPts: 0,
      grabs: 0,
      score: 0,
      area: 0,
      kills: 0,
      path: [],
      claimCool: 0,
      curlTimer: 0,
      curlLeft: 0,
      curlDir: 1,
      wraith: false,
      respawnIn: 0,
      inkTimer: 0,
      inkOn: false,
    }));

    this.startRound();

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  /** Two big buttons in this player's corner: 0 BL, 1 BR, 2 TL, 3 TR. */
  private makePads(idx: number): Pad[] {
    const { width, height, minTap } = this.ctx;
    const w = Math.max(120, minTap * 1.6);
    const h = Math.max(100, minTap * 1.4);
    const m = 12;
    const gap = 10;
    const right = idx % 2 === 1;
    const top = idx >= 2;
    const x0 = right ? width - m - w * 2 - gap : m;
    const y = top ? m : height - m - h;
    return [
      { x: x0, y, w, h, dir: -1 },
      { x: x0 + w + gap, y, w, h, dir: 1 },
    ];
  }

  private get final(): boolean {
    return this.round >= ROUNDS;
  }

  private startRound(): void {
    this.round++;
    this.grid.clear();
    this.grid.inset = 0;
    this.pickups = [];
    this.pickupIn = PICKUP_FIRST;
    this.wrap = 0;
    this.shrinkWarned = false;
    this.ink = [];
    this.flashes = [];
    this.trailG?.clearRect(0, 0, this.ctx.width, this.ctx.height);
    this.floorG?.clearRect(0, 0, this.ctx.width, this.ctx.height);
    const spawns = pickSpawns(this.snakes.length, this.ctx.width, this.ctx.height, () =>
      this.ctx.rng.next(),
    );
    this.snakes.forEach((s, i) => {
      const sp = spawns[i]!;
      s.x = sp.x;
      s.y = sp.y;
      s.angle = sp.angle;
      s.alive = true;
      s.gapIn = this.ctx.rng.float(GAP_EVERY_MIN, GAP_EVERY_MAX);
      s.gapLeft = 0;
      s.steer = 0;
      s.ghost = 0;
      s.skimming = false;
      s.skimCool = 0;
      s.skimPending = 0;
      s.path = [{ x: s.x, y: s.y }];
      s.claimCool = 0;
      s.curlTimer = this.ctx.rng.float(2, 5);
      s.curlLeft = 0;
      s.wraith = false;
      s.respawnIn = 0;
      s.inkTimer = 0;
      s.inkOn = false;
    });
    this.phase = "countdown";
    this.phaseTime = COUNTDOWN;
    this.lastCount = 0;
    this.roundTime = 0;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 40 * realDt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      if (this.floaters[i]!.life <= 0) this.floaters.splice(i, 1);
    }
    for (const f of this.flashes) f.life -= realDt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    const dt = this.juice.update(realDt);
    if (this.finished) return;

    if (this.phase === "countdown") {
      this.phaseTime -= realDt;
      const n = Math.ceil((this.phaseTime / COUNTDOWN) * 3);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.ctx.sfx.countdown();
        if (n === 3 && this.final) {
          this.callouts.show("FINAL ROUND · DOUBLE POINTS", "#FFE45C", { size: 54, life: 2.2, y: 0.22 });
        }
      }
      if (this.phaseTime <= 0) {
        this.phase = "play";
        this.ctx.sfx.go();
        this.callouts.show("GO!", "#F4F7FB", { size: 72, life: 0.6 });
      }
      return;
    }

    if (this.phase === "roundOver" || this.phase === "matchOver") {
      this.phaseTime -= realDt;
      if (this.phaseTime <= 0) {
        if (this.phase === "matchOver") this.finished = true;
        else this.startRound();
      }
      return;
    }

    this.step(dt);
  }

  private step(dt: number): void {
    this.roundTime += dt;
    const speed =
      SPEED * (this.final ? FINAL_SPEED : 1) * (1 + Math.min(SPEED_RAMP_MAX, this.roundTime * SPEED_RAMP));
    const ignore = SELF_IGNORE_PX / speed;
    const t = this.roundTime;
    const { width, height } = this.ctx;

    // Shrinking arena.
    const inset = arenaInset(t, width, height, this.final ? SHRINK_START_FINAL : SHRINK_START);
    if (inset > 0 && !this.shrinkWarned) {
      this.shrinkWarned = true;
      this.callouts.show("WALLS CLOSING IN!", "#FF3D7A", { size: 56, life: 1.4 });
      this.ctx.sfx.countdown();
      this.juice.shake(0.2);
    }
    this.grid.inset = inset;
    this.pickups = this.pickups.filter(
      (p) => p.x - PICKUP_R > inset && p.y - PICKUP_R > inset &&
        p.x + PICKUP_R < width - inset && p.y + PICKUP_R < height - inset,
    );
    if (this.wrap > 0) this.wrap = Math.max(0, this.wrap - dt);
    this.ink = this.ink.filter((seg) => t - seg.t < INK_SECS);

    // Pickup spawns.
    this.pickupIn -= dt;
    if (this.pickupIn <= 0) {
      this.pickupIn = this.ctx.rng.float(PICKUP_EVERY_MIN, PICKUP_EVERY_MAX);
      if (this.pickups.length < PICKUP_MAX) {
        const spot = findPickupSpot(
          this.grid,
          () => this.ctx.rng.next(),
          this.snakes.filter((s) => s.alive),
          this.pickups,
          60,
          90,
          26,
          t,
        );
        if (spot) this.pickups.push({ kind: this.ctx.rng.pick(PICKUP_KINDS), ...spot });
      }
    }

    const living = this.snakes.filter((s) => s.alive);

    for (const s of this.snakes) {
      if (s.alive) {
        if (s.player.kind === "bot") this.botThink(s, dt, t, ignore);
        else s.steer = this.humanSteer(s);
      } else if (s.wraith) {
        if (s.player.kind === "bot") this.wraithThink(s, dt, living, speed);
        else s.steer = this.humanSteer(s);
        s.inkTimer -= dt;
        if (s.inkTimer <= 0) {
          s.inkOn = !s.inkOn;
          s.inkTimer = s.inkOn ? INK_ON : INK_OFF;
        }
      } else if (s.respawnIn > 0) {
        s.respawnIn -= dt;
        if (s.respawnIn <= 0 && living.length >= 2) this.riseAsWraith(s);
      }
    }

    const dist = speed * dt;
    const subs = Math.max(1, Math.ceil(dist / 2));
    const sdt = dt / subs;
    const dying: Death[] = [];
    const g = this.trailG;

    for (let k = 0; k < subs; k++) {
      for (const s of this.snakes) {
        if (s.wraith) {
          this.moveWraith(s, speed * WRAITH_SPEED, sdt, t, inset);
          continue;
        }
        if (!s.alive || dying.some((d) => d.s === s)) continue;
        let px = s.x;
        let py = s.y;
        s.angle += s.steer * TURN_RATE * sdt;
        s.x += Math.cos(s.angle) * speed * sdt;
        s.y += Math.sin(s.angle) * speed * sdt;
        if (this.wrap > 0 && !this.grid.inBounds(s.x, s.y)) {
          const w = wrapPoint(s.x, s.y, width, height, inset);
          s.x = w.x;
          s.y = w.y;
          px = s.x;
          py = s.y;
          s.path = [{ x: s.x, y: s.y }];
        }

        // Gap timer.
        if (s.gapLeft > 0) {
          s.gapLeft -= speed * sdt;
        } else {
          s.gapIn -= sdt;
          if (s.gapIn <= 0) {
            s.gapLeft = GAP_LEN_PX;
            s.gapIn = this.ctx.rng.float(GAP_EVERY_MIN, GAP_EVERY_MAX);
          }
        }

        let probeX = s.x + Math.cos(s.angle) * (LINE_W / 2 + 1);
        let probeY = s.y + Math.sin(s.angle) * (LINE_W / 2 + 1);
        if (this.wrap > 0) ({ x: probeX, y: probeY } = wrapPoint(probeX, probeY, width, height, inset));
        if (!this.grid.inBounds(probeX, probeY)) {
          dying.push({ s, code: EMPTY });
          continue;
        }
        if (s.ghost <= 0) {
          const code = this.grid.hazardAt(probeX, probeY, s.idx, t);
          if (code !== EMPTY) {
            dying.push({ s, code });
            continue;
          }
          s.claimCool = Math.max(0, s.claimCool - sdt);
          if (s.claimCool <= 0 && this.grid.ownTrailAt(probeX, probeY, s.idx, t, ignore)) {
            this.tryClaim(s, dying);
          }
        }

        this.grabPickups(s);

        if (s.ghost > 0) {
          s.ghost -= sdt;
          // Never drop out of ghost while sitting on a line.
          if (s.ghost <= 0 && this.grid.trailAt(s.x, s.y, s.idx, t)) s.ghost = 0.01;
          if (s.ghost <= 0) s.path = [{ x: s.x, y: s.y }];
        } else {
          const last = s.path[s.path.length - 1];
          if (!last || Math.hypot(last.x - s.x, last.y - s.y) >= PATH_STEP) s.path.push({ x: s.x, y: s.y });
          if (s.gapLeft <= 0) {
            this.grid.paint(s.x, s.y, LINE_W / 2, s.idx, t);
            if (g) {
              g.strokeStyle = s.player.color;
              g.lineWidth = LINE_W;
              g.lineCap = "round";
              g.beginPath();
              g.moveTo(px, py);
              g.lineTo(s.x, s.y);
              g.stroke();
            }
          }
        }
      }
    }

    for (const s of this.snakes) {
      if (!s.alive || dying.some((d) => d.s === s)) continue;
      this.checkSkim(s, dt, t);
    }

    if (dying.length > 0) this.resolveDeaths(dying);
  }

  private botThink(s: Snake, dt: number, t: number, ignore: number): void {
    if (s.curlLeft > 0) s.curlLeft -= dt;
    else {
      s.curlTimer -= dt;
      if (s.curlTimer <= 0) {
        s.curlTimer = this.ctx.rng.float(3, 6);
        s.curlLeft = this.ctx.rng.float(1.2, 2.6);
        s.curlDir = this.ctx.rng.sign() < 0 ? -1 : 1;
      }
    }
    s.botTimer -= dt;
    if (s.botTimer > 0) return;
    s.botTimer = BOT_THINK;
    const base = botSteer(this.grid, s.x, s.y, s.angle, s.idx, t, ignore, 170, this.botTarget(s));
    s.steer = s.curlLeft > 0 && s.ghost <= 0
      ? botCurl(this.grid, s.x, s.y, s.angle, s.idx, t, s.curlDir, base)
      : base;
  }

  private wraithThink(s: Snake, dt: number, living: Snake[], speed: number): void {
    s.botTimer -= dt;
    if (s.botTimer > 0) return;
    s.botTimer = WRAITH_THINK;
    let target: Snake | undefined;
    let bestD = Infinity;
    for (const o of living) {
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < bestD) {
        bestD = d;
        target = o;
      }
    }
    // Hesitate now and then, like a human fumbling the chase.
    if (!target || this.ctx.rng.next() < 0.12) {
      s.steer = this.ctx.rng.pick([-1, 0, 1] as const);
      return;
    }
    s.steer = wraithSteer(s.x, s.y, s.angle, target, speed, WRAITH_LEAD);
  }

  private riseAsWraith(s: Snake): void {
    s.wraith = true;
    s.angle = this.ctx.rng.float(-Math.PI, Math.PI);
    s.inkOn = false;
    s.inkTimer = 0.6;
    s.steer = 0;
    this.callouts.show(`${s.player.name} HAUNTS!`, "#C9D2E3", { size: 44, life: 1.1, y: 0.22 });
    this.juice.burst(s.x, s.y, ["#C9D2E3", "#ffffff"], { count: 18, speed: 140, gravity: -60, life: 0.6 });
    this.ctx.sfx.whoosh();
  }

  private moveWraith(s: Snake, speed: number, sdt: number, t: number, inset: number): void {
    const px = s.x;
    const py = s.y;
    s.angle += s.steer * TURN_RATE * WRAITH_TURN * sdt;
    s.x += Math.cos(s.angle) * speed * sdt;
    s.y += Math.sin(s.angle) * speed * sdt;
    const lo = inset + 6;
    const { width, height } = this.ctx;
    if (s.x < lo || s.x > width - lo) {
      s.x = Math.min(width - lo, Math.max(lo, s.x));
      s.angle = Math.PI - s.angle;
    }
    if (s.y < lo || s.y > height - lo) {
      s.y = Math.min(height - lo, Math.max(lo, s.y));
      s.angle = -s.angle;
    }
    if (s.inkOn) {
      this.grid.paint(s.x, s.y, INK_W / 2, INK_BASE + s.idx, t);
      this.ink.push({ x0: px, y0: py, x1: s.x, y1: s.y, t });
    }
  }

  /** The head just touched its own older line: claim the loop it closes. */
  private tryClaim(s: Snake, dying: Death[]): void {
    s.claimCool = CLAIM_COOLDOWN;
    const head = { x: s.x, y: s.y };
    const start = loopStart(s.path, head, LOOP_SKIP_PX, LINE_W * 2.5);
    if (start < 0) return;
    const poly = s.path.slice(start);
    poly.push(head);
    const { width, height } = this.ctx;
    if (poly.length < 3 || polygonArea(poly) < MIN_CLAIM_FRAC * width * height) return;

    const code = TERRITORY_BASE + s.idx;
    const cells = this.grid.fillPolygon(poly, code);
    for (const p of poly) this.grid.stampGround(p.x, p.y, LINE_W / 2 + 1, code);
    const pct = claimPercent(cells, this.grid.cellCount);
    const mult = roundMultiplier(this.round);

    // Canvases: lines inside vanish, the floor takes the claimant's colour.
    const tg = this.trailG;
    if (tg) {
      tg.save();
      tg.globalCompositeOperation = "destination-out";
      this.tracePoly(tg, poly);
      tg.fill();
      tg.lineWidth = LINE_W + 3;
      tg.lineJoin = "round";
      tg.stroke();
      tg.restore();
    }
    const fg = this.floorG;
    if (fg) {
      fg.save();
      fg.globalCompositeOperation = "destination-out";
      this.tracePoly(fg, poly);
      fg.fill();
      fg.lineWidth = LINE_W + 3;
      fg.lineJoin = "round";
      fg.stroke();
      fg.globalCompositeOperation = "source-over";
      fg.globalAlpha = 0.3;
      fg.fillStyle = s.player.color;
      fg.fill();
      fg.globalAlpha = 0.85;
      fg.strokeStyle = s.player.color;
      fg.lineWidth = 2;
      fg.stroke();
      fg.restore();
    }

    // Trapped rivals and swallowed power-ups.
    let traps = 0;
    for (const o of this.snakes) {
      if (o === s || !o.alive || o.ghost > 0 || dying.some((d) => d.s === o)) continue;
      if (pointInPolygon(poly, o.x, o.y)) {
        dying.push({ s: o, code: EMPTY, trappedBy: s });
        traps++;
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      if (pointInPolygon(poly, p.x, p.y)) this.applyPickup(s, p, i);
    }

    const pts = pct * CLAIM_PTS_PER_PCT * mult;
    s.score += pts;
    s.area += pct;
    this.flashes.push({ poly, color: s.player.color, life: 0.6 });
    this.floaters.push({ x: s.x, y: s.y - 18, text: `+${pts}`, color: s.player.color, life: 1 });
    if (pct >= 4 || traps > 0) {
      this.callouts.show(`${s.player.name} CLAIMS ${pct}%`, s.player.color, {
        size: traps > 0 ? 40 : 48,
        life: 1.1,
        y: traps > 0 ? 0.44 : 0.32,
      });
    }
    this.juice.shake(Math.min(0.5, 0.1 + pct * 0.015));
    for (let i = 0; i < poly.length; i += Math.max(1, Math.floor(poly.length / 12))) {
      const p = poly[i]!;
      this.juice.burst(p.x, p.y, [s.player.color, "#ffffff"], { count: 3, speed: 120, gravity: 0, life: 0.4, size: 3 });
    }
    this.ctx.sfx.streak(Math.min(6, 1 + Math.floor(pct / 4)));
    s.path = [head];
  }

  private tracePoly(g: CanvasRenderingContext2D, poly: readonly Point[]): void {
    g.beginPath();
    const first = poly[0]!;
    g.moveTo(first.x, first.y);
    for (let i = 1; i < poly.length; i++) g.lineTo(poly[i]!.x, poly[i]!.y);
    g.closePath();
  }

  private resolveDeaths(dying: Death[]): void {
    const survivors = this.snakes.filter((s) => s.alive && !dying.some((d) => d.s === s));
    const mult = roundMultiplier(this.round);
    let trapped = false;
    for (const d of dying) {
      const s = d.s;
      s.alive = false;
      s.skimPending = 0;
      s.path = [];
      // Everyone already out is outlasted by this one.
      s.outlasted += this.snakes.length - 1 - survivors.length - (dying.length - 1);
      this.juice.burst(s.x, s.y, [s.player.color, "#ffffff"], {
        count: 26,
        speed: 260,
        gravity: 0,
        life: 0.5,
      });
      if (survivors.length >= 2) s.respawnIn = WRAITH_DELAY;

      if (d.trappedBy) {
        trapped = true;
        const k = d.trappedBy;
        k.score += TRAP_PTS * mult;
        k.kills++;
        this.callouts.show(`${s.player.name} TRAPPED!`, k.player.color, { size: 64, life: 1.3 });
        this.floaters.push({ x: s.x, y: s.y - 24, text: `+${TRAP_PTS * mult}`, color: k.player.color, life: 1 });
      } else if (isInk(d.code)) {
        const k = this.snakes[d.code - INK_BASE];
        if (k) {
          k.score += HAUNT_PTS * mult;
          k.kills++;
          this.callouts.show(`${k.player.name} HAUNTED ${s.player.name}!`, "#C9D2E3", { size: 46, life: 1.2 });
          this.floaters.push({ x: s.x, y: s.y - 24, text: `+${HAUNT_PTS * mult}`, color: "#C9D2E3", life: 1 });
        }
      } else if (isTerritory(d.code)) {
        const k = this.snakes[d.code - TERRITORY_BASE];
        if (k) {
          k.score += FENCE_PTS * mult;
          k.kills++;
          this.floaters.push({ x: s.x, y: s.y - 24, text: `FENCED +${FENCE_PTS * mult}`, color: k.player.color, life: 1 });
        }
      }
    }
    this.juice.shake(trapped ? 0.5 : 0.3);
    if (trapped) this.juice.hitStop(0.1);
    this.ctx.sfx.hit();
    this.checkRoundEnd(survivors);
  }

  /** Nearest pickup a bot should chase, or undefined. */
  private botTarget(s: Snake): Pickup | undefined {
    let best: Pickup | undefined;
    let bestD = BOT_PICKUP_RANGE;
    for (const p of this.pickups) {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private grabPickups(s: Snake): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      if (Math.hypot(p.x - s.x, p.y - s.y) > PICKUP_R + LINE_W) continue;
      this.applyPickup(s, p, i);
    }
  }

  private applyPickup(s: Snake, p: Pickup, index: number): void {
    this.pickups.splice(index, 1);
    s.grabs++;
    const info = PICKUPS[p.kind];
    this.callouts.show(info.shout, info.color, { size: 52, life: 1.1, y: 0.22 });
    this.juice.burst(p.x, p.y, [info.color, s.player.color, "#ffffff"], {
      count: 30,
      speed: 300,
      gravity: 0,
      life: 0.55,
    });
    this.ctx.sfx.collect();
    if (p.kind === "eraser") {
      this.grid.clearTrails();
      this.trailG?.clearRect(0, 0, this.ctx.width, this.ctx.height);
      for (const o of this.snakes) if (o.alive) o.path = [{ x: o.x, y: o.y }];
      this.juice.shake(0.35);
      this.juice.hitStop(0.06);
    } else if (p.kind === "wrap") {
      this.wrap = WRAP_SECS;
      this.juice.shake(0.15);
    } else {
      s.ghost = GHOST_SECS;
      s.gapLeft = 0;
      s.path = [];
    }
  }

  /** Near-miss bonus: edge-triggered when a line comes within a few px, banked if you live. */
  private checkSkim(s: Snake, dt: number, t: number): void {
    s.skimCool = Math.max(0, s.skimCool - dt);
    if (s.skimPending > 0) {
      s.skimTimer -= dt;
      if (s.skimTimer <= 0) {
        const tight = s.skimPending >= 3;
        const pts = s.skimPending * roundMultiplier(this.round);
        s.skimPending = 0;
        s.skimPts += pts;
        s.score += pts;
        this.floaters.push({
          x: s.x,
          y: s.y - 18,
          text: tight ? `RAZOR! +${pts}` : `CLOSE +${pts}`,
          color: tight ? "#FFE45C" : "#F4F7FB",
          life: 0.9,
        });
        this.juice.burst(s.x, s.y, [s.player.color, "#FFE45C"], {
          count: tight ? 14 : 8,
          speed: 160,
          gravity: 0,
          life: 0.35,
          size: 3,
        });
        if (tight) this.juice.shake(0.08);
        this.ctx.sfx.collect();
      }
    }
    if (s.ghost > 0) {
      s.skimming = false;
      return;
    }
    const d = skimDistance(this.grid, s.x, s.y, s.angle, s.idx, t);
    const near = Number.isFinite(d);
    if (near && !s.skimming && s.skimCool <= 0 && s.skimPending <= 0) {
      s.skimPending = skimPoints(d);
      s.skimTimer = SKIM_CONFIRM;
      s.skimCool = SKIM_COOLDOWN;
    }
    s.skimming = near;
  }

  private checkRoundEnd(alive: Snake[]): void {
    const solo = this.snakes.length === 1;
    if (alive.length > (solo ? 0 : 1)) return;

    const mult = roundMultiplier(this.round);
    if (alive.length === 1) {
      const w = alive[0]!;
      w.roundWins++;
      w.outlasted += this.snakes.length - 1;
      w.score += ROUND_WIN_PTS * mult;
    }
    for (const s of this.snakes) {
      s.score += s.outlasted * OUTLAST_PTS * mult;
      s.outlasted = 0;
      s.wraith = false;
      s.respawnIn = 0;
    }

    if (this.round >= ROUNDS || solo) {
      this.phase = "matchOver";
      this.phaseTime = 2.4;
      const champ = matchWinner(
        this.snakes.map((s) => s.score),
        this.snakes.map((s) => s.roundWins),
      );
      const w = this.snakes[Math.max(0, champ)]!;
      this.callouts.show(`${w.player.name} WINS!`, w.player.color, { size: 72, life: 2.2 });
      this.ctx.sfx.win();
      this.recordBests();
      return;
    }

    this.phase = "roundOver";
    this.phaseTime = ROUND_OVER;
    if (alive.length === 1) {
      const w = alive[0]!;
      this.callouts.show(`${w.player.name} takes round ${this.round}`, w.player.color, {
        size: 56,
        life: 1.5,
      });
      this.floaters.push({ x: w.x, y: w.y - 24, text: `+${ROUND_WIN_PTS * mult}`, color: w.player.color, life: 1.2 });
      this.ctx.sfx.collect();
    } else {
      this.callouts.show("DRAW!", "#FF3D7A", { size: 64, life: 1.5 });
      this.ctx.sfx.miss();
    }
  }

  private recordBests(): void {
    if (this.bestShown) return;
    this.bestShown = true;
    let record: Snake | null = null;
    for (const s of this.snakes) {
      if (s.player.kind !== "human") continue;
      if (saveBest(curveClash.id, s.score, BEST_VERSION)) record = record && record.score >= s.score ? record : s;
    }
    if (record) {
      this.callouts.show(`NEW RECORD · ${record.score}`, "#FFE45C", { size: 44, life: 2.2, y: 0.46 });
    }
  }

  private humanSteer(s: Snake): -1 | 0 | 1 {
    let v = this.ctx.input.axis(s.player.slot).x;
    for (const h of this.held.values()) if (h.snake === s) v += h.dir;
    return v < 0 ? -1 : v > 0 ? 1 : 0;
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (const s of this.snakes) {
      for (const pad of s.pads) {
        if (p.x >= pad.x && p.x < pad.x + pad.w && p.y >= pad.y && p.y < pad.y + pad.h) {
          if (e.cancelable) e.preventDefault();
          this.held.set(e.pointerId, { snake: s, dir: pad.dir });
          try {
            this.ctx.canvas.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          return;
        }
      }
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.held.delete(e.pointerId);
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    if (this.final) {
      g.fillStyle = "rgba(255,228,92,0.045)";
      g.fillRect(0, 0, width, height);
    }
    this.juice.begin(g);

    g.drawImage(this.floor, 0, 0);
    g.drawImage(this.trail, 0, 0);
    this.drawInk(g);
    this.drawWalls(g);
    this.drawPickups(g);
    this.drawFlashes(g);

    for (const s of this.snakes) {
      if (s.wraith) {
        this.drawWraith(g, s);
        continue;
      }
      if (!s.alive) continue;
      g.save();
      g.shadowColor = s.player.color;
      g.shadowBlur = 12;
      g.fillStyle = s.gapLeft > 0 ? "#F4F7FB" : s.player.color;
      if (s.ghost > 0) {
        // Blink faster in the last second so you know it's ending.
        const rate = s.ghost < 1 ? 14 : 5;
        g.globalAlpha = 0.45 + 0.35 * Math.sin(this.roundTime * rate);
        g.strokeStyle = PICKUPS.ghost.color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(s.x, s.y, LINE_W * 2.4, 0, Math.PI * 2);
        g.stroke();
      }
      g.beginPath();
      g.arc(s.x, s.y, LINE_W, 0, Math.PI * 2);
      g.fill();
      g.restore();

      if (this.phase === "countdown") {
        const len = 34;
        const ex = s.x + Math.cos(s.angle) * len;
        const ey = s.y + Math.sin(s.angle) * len;
        g.strokeStyle = s.player.color;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(ex, ey);
        g.stroke();
        g.fillStyle = s.player.color;
        g.font = "700 22px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillText(s.player.name, s.x, s.y - 12);
      }
    }

    this.drawFloaters(g);
    this.juice.end(g);

    this.drawPads(g);
    this.drawHud(g);

    if (this.phase === "countdown") {
      const n = Math.max(1, Math.ceil((this.phaseTime / COUNTDOWN) * 3));
      g.fillStyle = "#F4F7FB";
      g.font = "700 120px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.globalAlpha = 0.85;
      g.fillText(String(n), width / 2, height / 2);
      g.globalAlpha = 1;
      if (this.round === 1) {
        g.font = "700 26px Bebas Neue, Impact, sans-serif";
        g.fillStyle = "rgba(244,247,251,0.8)";
        g.fillText("CROSS YOUR OWN LINE TO CLAIM THE LOOP · TRAP RIVALS INSIDE", width / 2, height / 2 + 86);
      }
    }

    this.callouts.draw(g, width, height);
  }

  private drawInk(g: CanvasRenderingContext2D): void {
    if (this.ink.length === 0) return;
    g.save();
    g.lineCap = "round";
    g.lineWidth = INK_W;
    for (const seg of this.ink) {
      const age = (this.roundTime - seg.t) / INK_SECS;
      g.globalAlpha = Math.max(0, 0.9 - age * 0.9);
      g.strokeStyle = age < 0.7 ? "#D7DEEA" : "#8893A8";
      g.beginPath();
      g.moveTo(seg.x0, seg.y0);
      g.lineTo(seg.x1, seg.y1);
      g.stroke();
    }
    g.restore();
  }

  private drawWraith(g: CanvasRenderingContext2D, s: Snake): void {
    const pulse = 1 + 0.18 * Math.sin(this.roundTime * 9 + s.idx);
    g.save();
    g.translate(s.x, s.y);
    g.shadowColor = "#D7DEEA";
    g.shadowBlur = s.inkOn ? 18 : 8;
    g.globalAlpha = s.inkOn ? 0.95 : 0.55;
    g.fillStyle = "#E6EBF5";
    g.beginPath();
    g.arc(0, 0, LINE_W * 1.4 * pulse, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = s.player.color;
    g.lineWidth = 2;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.arc(0, 0, LINE_W * 2.6 * pulse, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = s.player.color;
    g.font = "700 16px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText(s.player.name, 0, -LINE_W * 3);
    g.restore();
  }

  private drawFlashes(g: CanvasRenderingContext2D): void {
    for (const f of this.flashes) {
      g.save();
      g.globalAlpha = Math.min(0.55, f.life) * 0.9;
      g.fillStyle = "#ffffff";
      this.tracePoly(g, f.poly);
      g.fill();
      g.globalAlpha = Math.min(1, f.life * 2);
      g.strokeStyle = f.color;
      g.lineWidth = 4 + (0.6 - f.life) * 6;
      g.lineJoin = "round";
      g.stroke();
      g.restore();
    }
  }

  private drawWalls(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const m = this.grid.inset;
    if (m > 0) {
      // Dead zone outside the closing walls.
      g.save();
      g.fillStyle = "rgba(7,11,20,0.72)";
      g.fillRect(0, 0, width, m);
      g.fillRect(0, height - m, width, m);
      g.fillRect(0, m, m, height - m * 2);
      g.fillRect(width - m, m, m, height - m * 2);
      g.restore();
    }
    g.save();
    if (this.wrap > 0) {
      g.strokeStyle = PICKUPS.wrap.color;
      g.lineWidth = 4;
      g.setLineDash([14, 10]);
      g.lineDashOffset = -this.roundTime * 60;
      g.globalAlpha = this.wrap < 1 ? 0.5 + 0.5 * Math.sin(this.roundTime * 16) : 1;
    } else if (m > 0) {
      g.strokeStyle = "#FF3D7A";
      g.lineWidth = 5;
      g.globalAlpha = 0.7 + 0.3 * Math.sin(this.roundTime * 8);
    } else {
      g.strokeStyle = this.final ? "rgba(255,228,92,0.5)" : "rgba(244,247,251,0.35)";
      g.lineWidth = 4;
    }
    g.strokeRect(m + 2, m + 2, width - m * 2 - 4, height - m * 2 - 4);
    g.restore();
  }

  private drawPickups(g: CanvasRenderingContext2D): void {
    const pulse = 1 + 0.12 * Math.sin(this.roundTime * 6);
    for (const p of this.pickups) {
      const info = PICKUPS[p.kind];
      g.save();
      g.shadowColor = info.color;
      g.shadowBlur = 16;
      g.fillStyle = "rgba(7,11,20,0.85)";
      g.beginPath();
      g.arc(p.x, p.y, PICKUP_R * pulse, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = info.color;
      g.lineWidth = 3;
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = info.color;
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(info.glyph, p.x, p.y + 1);
      g.font = "700 15px Bebas Neue, Impact, sans-serif";
      g.textBaseline = "top";
      g.fillText(info.label, p.x, p.y + PICKUP_R + 4);
      g.restore();
    }
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.save();
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.lineWidth = 4;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    for (const f of this.floaters) {
      g.globalAlpha = Math.min(1, f.life / 0.4);
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.restore();
  }

  private drawPads(g: CanvasRenderingContext2D): void {
    for (const s of this.snakes) {
      const active = s.alive || s.wraith;
      for (const pad of s.pads) {
        let pressed = false;
        for (const h of this.held.values()) {
          if (h.snake === s && h.dir === pad.dir) pressed = true;
        }
        g.save();
        g.globalAlpha = active ? (pressed ? 0.55 : 0.22) : 0.08;
        g.fillStyle = s.wraith ? "#C9D2E3" : s.player.color;
        g.beginPath();
        g.roundRect(pad.x, pad.y, pad.w, pad.h, 18);
        g.fill();
        g.globalAlpha = active ? 0.9 : 0.25;
        g.fillStyle = "#F4F7FB";
        g.font = "700 44px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(pad.dir < 0 ? "◀" : "▶", pad.x + pad.w / 2, pad.y + pad.h / 2);
        g.restore();
      }
      if (s.wraith && s.pads.length > 0) {
        const p0 = s.pads[0]!;
        const top = p0.y < this.ctx.height / 2;
        g.save();
        g.fillStyle = "#C9D2E3";
        g.font = "700 18px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = top ? "top" : "bottom";
        g.fillText("WRAITH · HAUNT THEM", p0.x + p0.w + 5, top ? p0.y + p0.h + 4 : p0.y - 4);
        g.restore();
      }
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const parts = this.snakes.length;
    const slotW = parts >= 4 ? 160 : 190;
    const x0 = width / 2 - (parts * slotW) / 2;
    g.save();
    g.textBaseline = "top";
    g.textAlign = "center";
    this.snakes.forEach((s, i) => {
      const cx = x0 + slotW * i + slotW / 2;
      const out = !s.alive && !s.wraith;
      g.globalAlpha = out ? 0.45 : 1;
      g.fillStyle = s.player.color;
      g.font = "700 20px Bebas Neue, Impact, sans-serif";
      g.fillText(s.wraith ? `${s.player.name} · WRAITH` : s.player.name, cx, 6);
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillStyle = "#F4F7FB";
      g.fillText(String(s.score), cx, 24);
      for (let k = 0; k < ROUNDS; k++) {
        const px = cx + (k - (ROUNDS - 1) / 2) * 18;
        g.beginPath();
        g.arc(px, 64, 5, 0, Math.PI * 2);
        g.fillStyle = s.player.color;
        if (k < s.roundWins) g.fill();
        else {
          g.strokeStyle = s.player.color;
          g.lineWidth = 2;
          g.stroke();
        }
      }
    });
    g.globalAlpha = 1;
    g.textBaseline = "bottom";
    if (this.final) {
      g.fillStyle = "#FFE45C";
      g.globalAlpha = 0.75 + 0.25 * Math.sin(this.roundTime * 6);
      g.font = "700 24px Bebas Neue, Impact, sans-serif";
      g.fillText("FINAL ROUND · DOUBLE POINTS", width / 2, height - 10);
    } else {
      g.fillStyle = "rgba(244,247,251,0.6)";
      g.font = "700 20px Bebas Neue, Impact, sans-serif";
      g.fillText(`ROUND ${this.round} OF ${ROUNDS}`, width / 2, height - 10);
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.snakes.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    return this.snakes.flatMap((s) => [
      { playerId: s.player.id, label: "Rounds won", value: String(s.roundWins) },
      { playerId: s.player.id, label: "Claimed", value: `${s.area}%` },
      { playerId: s.player.id, label: "Kills", value: String(s.kills) },
    ]);
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    this.held.clear();
  }
}
