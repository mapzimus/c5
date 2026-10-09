import { fillArena, drawTimerBar } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";

export const whack: GameDefinition = {
  id: "whack",
  name: "Whack-a-Mole",
  tagline: "Tap fast. Score big.",
  description:
    "Moles pop up across your zone — tap them before they dive back down. " +
    "Regular moles score 1, golden moles score 3 but vanish faster. " +
    "Hit a bomb and lose 2 points. Speed streaks earn bonus points. " +
    "Built for multi-touch: everyone plays at once on the same screen.",
  durationMs: 45_000,
  controls: "Tap moles in your zone",
  create: (ctx) => new WhackGame(ctx),
};

const HOLE_RADIUS = 38;
const MOLE_UP_TIME = 1.4;
const MOLE_UP_MIN = 0.6;
const GOLDEN_UP_TIME = 0.7;
const BOMB_UP_TIME = 1.2;
const SPAWN_INTERVAL = 0.9;
const SPAWN_MIN = 0.45;

type MoleKind = "normal" | "golden" | "bomb";

interface Mole {
  x: number;
  y: number;
  kind: MoleKind;
  life: number;
  maxLife: number;
  whacked: boolean;
  whackFlash: number;
  whackedBy: string | null;
}

interface Seat {
  player: Player;
  zoneX: number;
  zoneY: number;
  zoneW: number;
  zoneH: number;
  holes: { x: number; y: number }[];
  moles: Mole[];
  spawnTimer: number;
  score: number;
  streak: number;
  bestStreak: number;
  hits: number;
  goldenHits: number;
  bombHits: number;
  misses: number;
}

class WhackGame implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private time = 0;
  private elapsed = 0;
  private readonly duration: number;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.duration = ctx.width > 0 ? 45 : 45;

    const n = ctx.players.length;
    const cols = n <= 2 ? n : 2;
    const rows = n <= 2 ? 1 : 2;
    const zW = ctx.width / cols;
    const zH = ctx.height / rows;

    this.seats = ctx.players.map((player, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const zx = col * zW;
      const zy = row * zH;

      const holesPerRow = 3;
      const holesRows = 3;
      const holes: { x: number; y: number }[] = [];
      const padTop = 50;
      const availH = zH - padTop - 20;
      const availW = zW - 40;
      for (let r = 0; r < holesRows; r++) {
        for (let c = 0; c < holesPerRow; c++) {
          holes.push({
            x: zx + 20 + (c + 0.5) * (availW / holesPerRow),
            y: zy + padTop + (r + 0.5) * (availH / holesRows),
          });
        }
      }

      return {
        player,
        zoneX: zx,
        zoneY: zy,
        zoneW: zW,
        zoneH: zH,
        holes,
        moles: [],
        spawnTimer: ctx.rng.float(0.3, 0.8),
        score: 0,
        streak: 0,
        bestStreak: 0,
        hits: 0,
        goldenHits: 0,
        bombHits: 0,
        misses: 0,
      };
    });

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    this.elapsed += realDt;

    const progress = Math.min(1, this.elapsed / this.duration);
    const spawnInterval = SPAWN_INTERVAL - (SPAWN_INTERVAL - SPAWN_MIN) * progress;
    const upTime = MOLE_UP_TIME - (MOLE_UP_TIME - MOLE_UP_MIN) * progress;

    for (const seat of this.seats) {
      for (const mole of seat.moles) {
        if (!mole.whacked) {
          mole.life -= dt;
          if (mole.life <= 0) {
            mole.whacked = true;
            mole.whackFlash = 0;
            if (mole.kind !== "bomb") {
              seat.streak = 0;
              seat.misses++;
            }
          }
        } else {
          mole.whackFlash -= dt;
        }
      }
      seat.moles = seat.moles.filter(
        (m) => !m.whacked || m.whackFlash > 0,
      );

      seat.spawnTimer -= dt;
      if (seat.spawnTimer <= 0) {
        seat.spawnTimer = spawnInterval + this.ctx.rng.float(-0.15, 0.15);
        this.spawnMole(seat, upTime);
      }

      if (seat.player.kind === "bot") this.botTick(seat, dt);
    }
  }

  private spawnMole(seat: Seat, upTime: number): void {
    const occupied = new Set(
      seat.moles.filter((m) => !m.whacked).map((m) => `${m.x},${m.y}`),
    );
    const free = seat.holes.filter((h) => !occupied.has(`${h.x},${h.y}`));
    if (free.length === 0) return;

    const hole = this.ctx.rng.pick(free);
    const roll = this.ctx.rng.next();
    let kind: MoleKind = "normal";
    let life = upTime;
    if (roll < 0.08) {
      kind = "bomb";
      life = BOMB_UP_TIME;
    } else if (roll < 0.2) {
      kind = "golden";
      life = GOLDEN_UP_TIME;
    }

    seat.moles.push({
      x: hole.x,
      y: hole.y,
      kind,
      life,
      maxLife: life,
      whacked: false,
      whackFlash: 0,
      whackedBy: null,
    });
  }

  private botTick(seat: Seat, _dt: number): void {
    const target = seat.moles.find(
      (m) => !m.whacked && m.kind !== "bomb" && m.life < m.maxLife * 0.7,
    );
    if (target && this.ctx.rng.next() < 0.12) {
      this.whackMole(seat, target);
    }
  }

  private whackMole(seat: Seat, mole: Mole): void {
    mole.whacked = true;
    mole.whackFlash = 0.3;
    mole.whackedBy = seat.player.id;

    if (mole.kind === "bomb") {
      seat.score = Math.max(0, seat.score - 2);
      seat.bombHits++;
      seat.streak = 0;
      this.ctx.sfx.miss();
      this.juice.shake(0.2);
      this.juice.burst(mole.x, mole.y, ["#FF3D7A", "#FF4136", "#FF6B35"], {
        count: 24,
        speed: 300,
        gravity: 400,
        life: 0.5,
      });
    } else {
      const points = mole.kind === "golden" ? 3 : 1;
      seat.score += points;
      seat.streak++;
      seat.bestStreak = Math.max(seat.bestStreak, seat.streak);
      seat.hits++;
      if (mole.kind === "golden") seat.goldenHits++;

      if (seat.streak > 0 && seat.streak % 5 === 0) {
        seat.score += 2;
        this.callouts.show(
          `${seat.player.name} x${seat.streak}!`,
          seat.player.color,
          { size: 48, life: 0.8, y: 0.5 },
        );
        this.ctx.sfx.streak(seat.streak / 5);
      } else {
        this.ctx.sfx.collect();
      }

      const color =
        mole.kind === "golden"
          ? ["#FFD700", "#FFA500", seat.player.color]
          : [seat.player.color, "#ffffff"];
      this.juice.burst(mole.x, mole.y, color, {
        count: mole.kind === "golden" ? 20 : 10,
        speed: 200,
        gravity: 300,
        life: 0.4,
      });
    }
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
    for (const seat of this.seats) {
      if (seat.player.kind !== "human") continue;
      if (
        p.x < seat.zoneX ||
        p.x > seat.zoneX + seat.zoneW ||
        p.y < seat.zoneY ||
        p.y > seat.zoneY + seat.zoneH
      )
        continue;

      let best: Mole | null = null;
      let bestDist = HOLE_RADIUS * 1.5;
      for (const mole of seat.moles) {
        if (mole.whacked) continue;
        const d = Math.hypot(p.x - mole.x, p.y - mole.y);
        if (d < bestDist) {
          best = mole;
          bestDist = d;
        }
      }
      if (best) {
        e.preventDefault();
        this.whackMole(seat, best);
      }
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    for (const seat of this.seats) this.drawZone(g, seat);

    this.juice.end(g);

    drawTimerBar(g, width, Math.max(0, this.duration - this.elapsed), this.duration);
    this.callouts.draw(g, width, height);
  }

  private drawZone(g: CanvasRenderingContext2D, s: Seat): void {
    const { zoneX: zx, zoneY: zy, zoneW: zw, zoneH: zh, player } = s;

    g.fillStyle = "rgba(244,247,251,0.02)";
    g.fillRect(zx + 1, zy, zw - 2, zh);
    g.strokeStyle = "rgba(244,247,251,0.08)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(zx + zw, zy);
    g.lineTo(zx + zw, zy + zh);
    g.stroke();

    g.fillStyle = player.color;
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillText(player.name, zx + zw / 2, zy + 6);

    g.fillStyle = "#F4F7FB";
    g.font = "700 32px Bebas Neue, Impact, sans-serif";
    g.fillText(String(s.score), zx + zw / 2, zy + 24);

    for (const hole of s.holes) {
      g.beginPath();
      g.ellipse(hole.x, hole.y, HOLE_RADIUS, HOLE_RADIUS * 0.5, 0, 0, Math.PI * 2);
      g.fillStyle = "#0a1020";
      g.fill();
      g.strokeStyle = "rgba(244,247,251,0.1)";
      g.lineWidth = 2;
      g.stroke();
    }

    for (const mole of s.moles) {
      if (mole.whacked && mole.whackFlash > 0) {
        g.save();
        g.globalAlpha = mole.whackFlash / 0.3;
        g.fillStyle = mole.kind === "bomb" ? "#FF3D7A" : "#FFD700";
        g.font = "700 28px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        const pts =
          mole.kind === "bomb" ? "-2" : mole.kind === "golden" ? "+3" : "+1";
        g.fillText(pts, mole.x, mole.y - HOLE_RADIUS - 10);
        g.restore();
        continue;
      }
      if (mole.whacked) continue;

      const rise = Math.min(1, (mole.maxLife - mole.life) / 0.15);
      const drop = mole.life < 0.2 ? mole.life / 0.2 : 1;
      const show = Math.min(rise, drop);

      g.save();
      g.translate(mole.x, mole.y);

      if (mole.kind === "bomb") {
        const r = HOLE_RADIUS * 0.7 * show;
        g.shadowColor = "#FF3D7A";
        g.shadowBlur = 16;
        g.beginPath();
        g.arc(0, -r * 0.3, r, 0, Math.PI * 2);
        g.fillStyle = "#1a1a2e";
        g.fill();
        g.shadowBlur = 0;
        g.strokeStyle = "#FF3D7A";
        g.lineWidth = 3;
        g.stroke();
        g.fillStyle = "#FF3D7A";
        g.font = `700 ${Math.round(r * 1.1)}px Bebas Neue, Impact, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("X", 0, -r * 0.3);
      } else {
        const r = HOLE_RADIUS * 0.75 * show;
        const col = mole.kind === "golden" ? "#FFD700" : "#8B6914";
        g.shadowColor = mole.kind === "golden" ? "#FFD700" : "#B8860B";
        g.shadowBlur = mole.kind === "golden" ? 20 : 10;
        g.beginPath();
        g.arc(0, -r * 0.3, r, 0, Math.PI * 2);
        g.fillStyle = col;
        g.fill();
        g.shadowBlur = 0;

        g.beginPath();
        g.arc(-r * 0.25, -r * 0.5, r * 0.15, 0, Math.PI * 2);
        g.fillStyle = "#070b14";
        g.fill();
        g.beginPath();
        g.arc(r * 0.25, -r * 0.5, r * 0.15, 0, Math.PI * 2);
        g.fillStyle = "#070b14";
        g.fill();

        g.beginPath();
        g.ellipse(0, -r * 0.2, r * 0.2, r * 0.1, 0, 0, Math.PI);
        g.fillStyle = "rgba(255,255,255,0.2)";
        g.fill();
      }
      g.restore();
    }
  }

  isFinished(): boolean {
    return this.elapsed >= this.duration;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({
      playerId: s.player.id,
      score: s.score,
    }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      const id = s.player.id;
      out.push({ playerId: id, label: "Hits", value: String(s.hits) });
      if (s.goldenHits > 0)
        out.push({ playerId: id, label: "Golden moles", value: String(s.goldenHits) });
      if (s.bombHits > 0)
        out.push({ playerId: id, label: "Bombs hit", value: String(s.bombHits) });
      if (s.bestStreak > 1)
        out.push({ playerId: id, label: "Best streak", value: String(s.bestStreak) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
