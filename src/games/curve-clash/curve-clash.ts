import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  PICKUPS,
  PICKUP_KINDS,
  TrailGrid,
  arenaInset,
  botSteer,
  findPickupSpot,
  matchWinner,
  pickSpawns,
  skimDistance,
  skimPoints,
  wrapPoint,
  type Pickup,
} from "./curve-clash-logic";

export const curveClash: GameDefinition = {
  id: "curve-clash",
  name: "Curve Clash",
  tagline: "Draw the line. Don't touch one.",
  description:
    "You're a line that never stops. Steer. Hit a wall or any line and you're out. " +
    "Grab power-ups: WIPE clears every line, PORTAL turns the walls into wraparounds, " +
    "GHOST lets you pass through lines. Skim past a line without touching it for bonus points. " +
    "Late in each round the walls close in. Last line alive takes the round. " +
    "First to 3 rounds (2 with 3+ players) wins.",
  durationMs: 0,
  controls: "Hold ◀ / ▶ in your corner to turn. Keys: your left/right. Drive over power-ups to grab them.",
  create: (ctx) => new CurveClash(ctx),
};

const SPEED = 130;
const SPEED_RAMP = 0.015; // +1.5% per second of round, keeps rounds short
const SPEED_RAMP_MAX = 0.7;
const TURN_RATE = 3.2; // rad/s
const LINE_W = 5;
const SELF_IGNORE_PX = 22;
const GAP_EVERY_MIN = 2;
const GAP_EVERY_MAX = 3;
const GAP_LEN_PX = 26;
const COUNTDOWN = 2.4;
const ROUND_OVER = 1.8;
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
const OUTLAST_PTS = 10;

interface Floater {
  x: number;
  y: number;
  text: string;
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
  skims: number;
  grabs: number;
}

class CurveClash implements GameInstance {
  private readonly snakes: Snake[];
  private readonly grid: TrailGrid;
  private readonly trail: HTMLCanvasElement;
  private readonly trailG: CanvasRenderingContext2D | null;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly held = new Map<number, { snake: Snake; dir: -1 | 1 }>();
  private readonly target: number;
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

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.grid = new TrailGrid(ctx.width, ctx.height);
    this.trail = document.createElement("canvas");
    this.trail.width = ctx.width;
    this.trail.height = ctx.height;
    this.trailG = this.trail.getContext("2d");
    this.target = ctx.players.length >= 3 ? 2 : 3;

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
      skims: 0,
      grabs: 0,
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

  private startRound(): void {
    this.round++;
    this.grid.clear();
    this.grid.inset = 0;
    this.pickups = [];
    this.pickupIn = PICKUP_FIRST;
    this.wrap = 0;
    this.shrinkWarned = false;
    this.trailG?.clearRect(0, 0, this.ctx.width, this.ctx.height);
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
    const dt = this.juice.update(realDt);
    if (this.finished) return;

    if (this.phase === "countdown") {
      this.phaseTime -= realDt;
      const n = Math.ceil((this.phaseTime / COUNTDOWN) * 3);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.ctx.sfx.countdown();
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
    const speed = SPEED * (1 + Math.min(SPEED_RAMP_MAX, this.roundTime * SPEED_RAMP));
    const ignore = SELF_IGNORE_PX / speed;
    const t = this.roundTime;
    const { width, height } = this.ctx;

    // Shrinking arena.
    const inset = arenaInset(t, width, height);
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
        );
        if (spot) this.pickups.push({ kind: this.ctx.rng.pick(PICKUP_KINDS), ...spot });
      }
    }

    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (s.player.kind === "bot") {
        s.botTimer -= dt;
        if (s.botTimer <= 0) {
          s.botTimer = BOT_THINK;
          s.steer = botSteer(this.grid, s.x, s.y, s.angle, s.idx, t, ignore, 170, this.botTarget(s));
        }
      } else {
        s.steer = this.humanSteer(s);
      }
    }

    const dist = speed * dt;
    const subs = Math.max(1, Math.ceil(dist / 2));
    const sdt = dt / subs;
    const dying: Snake[] = [];
    const g = this.trailG;

    for (let k = 0; k < subs; k++) {
      for (const s of this.snakes) {
        if (!s.alive || dying.includes(s)) continue;
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
        const hit = s.ghost > 0
          ? !this.grid.inBounds(probeX, probeY)
          : this.grid.blocked(probeX, probeY, s.idx, t, ignore);
        if (hit) {
          dying.push(s);
          continue;
        }

        this.grabPickups(s);

        if (s.ghost > 0) {
          s.ghost -= sdt;
          // Never drop out of ghost while sitting on a line.
          if (s.ghost <= 0 && this.grid.trailAt(s.x, s.y, s.idx, t, ignore)) s.ghost = 0.01;
        } else if (s.gapLeft <= 0) {
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

    for (const s of this.snakes) {
      if (!s.alive || dying.includes(s)) continue;
      this.checkSkim(s, dt, t, ignore);
    }

    if (dying.length > 0) {
      const survivors = this.snakes.filter((s) => s.alive && !dying.includes(s));
      for (const s of dying) {
        s.alive = false;
        s.skimPending = 0;
        // Everyone already out is outlasted by this one.
        s.outlasted += this.snakes.length - 1 - survivors.length - (dying.length - 1);
        this.juice.burst(s.x, s.y, [s.player.color, "#ffffff"], {
          count: 26,
          speed: 260,
          gravity: 0,
          life: 0.5,
        });
      }
      this.juice.shake(0.3);
      this.ctx.sfx.hit();
      this.checkRoundEnd(survivors);
    }
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
      this.pickups.splice(i, 1);
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
        this.grid.clear();
        this.trailG?.clearRect(0, 0, this.ctx.width, this.ctx.height);
        this.juice.shake(0.35);
        this.juice.hitStop(0.06);
      } else if (p.kind === "wrap") {
        this.wrap = WRAP_SECS;
        this.juice.shake(0.15);
      } else {
        s.ghost = GHOST_SECS;
        s.gapLeft = 0;
      }
    }
  }

  /** Near-miss bonus: edge-triggered when a line comes within a few px, banked if you live. */
  private checkSkim(s: Snake, dt: number, t: number, ignore: number): void {
    s.skimCool = Math.max(0, s.skimCool - dt);
    if (s.skimPending > 0) {
      s.skimTimer -= dt;
      if (s.skimTimer <= 0) {
        const pts = s.skimPending;
        s.skimPending = 0;
        s.skimPts += pts;
        s.skims++;
        const tight = pts >= 3;
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
    const d = skimDistance(this.grid, s.x, s.y, s.angle, s.idx, t, ignore);
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

    if (alive.length === 1) {
      const w = alive[0]!;
      w.roundWins++;
      w.outlasted += this.snakes.length - 1;
    }

    const champ = matchWinner(
      this.snakes.map((s) => s.roundWins),
      this.target,
    );
    if (champ >= 0 || solo) {
      this.phase = "matchOver";
      this.phaseTime = 2.2;
      const w = champ >= 0 ? this.snakes[champ]! : this.snakes[0]!;
      this.callouts.show(`${w.player.name} WINS!`, w.player.color, { size: 72, life: 2 });
      this.ctx.sfx.win();
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
      this.ctx.sfx.collect();
    } else {
      this.callouts.show("DRAW!", "#FF3D7A", { size: 64, life: 1.5 });
      this.ctx.sfx.miss();
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
    this.juice.begin(g);

    g.drawImage(this.trail, 0, 0);
    this.drawWalls(g);
    this.drawPickups(g);

    for (const s of this.snakes) {
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
    }

    this.callouts.draw(g, width, height);
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
      g.strokeStyle = "rgba(244,247,251,0.35)";
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
      for (const pad of s.pads) {
        let pressed = false;
        for (const h of this.held.values()) {
          if (h.snake === s && h.dir === pad.dir) pressed = true;
        }
        g.save();
        g.globalAlpha = s.alive ? (pressed ? 0.55 : 0.22) : 0.08;
        g.fillStyle = s.player.color;
        g.beginPath();
        g.roundRect(pad.x, pad.y, pad.w, pad.h, 18);
        g.fill();
        g.globalAlpha = s.alive ? 0.9 : 0.25;
        g.fillStyle = "#F4F7FB";
        g.font = "700 44px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(pad.dir < 0 ? "◀" : "▶", pad.x + pad.w / 2, pad.y + pad.h / 2);
        g.restore();
      }
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const parts = this.snakes.length;
    const slotW = 170;
    const x0 = this.ctx.width / 2 - (parts * slotW) / 2;
    g.save();
    g.textBaseline = "top";
    g.textAlign = "center";
    this.snakes.forEach((s, i) => {
      const cx = x0 + slotW * i + slotW / 2;
      g.globalAlpha = s.alive ? 1 : 0.45;
      g.fillStyle = s.player.color;
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.fillText(s.player.name, cx, 8);
      for (let k = 0; k < this.target; k++) {
        const px = cx + (k - (this.target - 1) / 2) * 18;
        g.beginPath();
        g.arc(px, 40, 6, 0, Math.PI * 2);
        if (k < s.roundWins) g.fill();
        else {
          g.strokeStyle = s.player.color;
          g.lineWidth = 2;
          g.stroke();
        }
      }
    });
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.snakes.map((s) => ({
      playerId: s.player.id,
      score: s.roundWins * 100 + s.outlasted * OUTLAST_PTS + s.skimPts,
    }));
  }

  getStats(): GameStat[] {
    return this.snakes.flatMap((s) => [
      { playerId: s.player.id, label: "Rounds won", value: String(s.roundWins) },
      { playerId: s.player.id, label: "Near misses", value: String(s.skims) },
      { playerId: s.player.id, label: "Power-ups", value: String(s.grabs) },
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
