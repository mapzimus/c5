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
  name: "Bonk",
  tagline: "Bonk them before they hide.",
  description:
    "Critters pop out of holes in your zone. Tap them before they duck back down. " +
    "Hit 8 in a row to fill your combo meter and start FEVER: double points and more targets for a few seconds. " +
    "Gold critters are worth 10 but only show up for a blink. " +
    "Don't tap the bombs: they cost 5 points and wipe your combo. " +
    "Everyone plays at once on the same screen.",
  durationMs: 45_000,
  controls: "Tap critters in your zone. Avoid bombs.",
  create: (ctx) => new WhackGame(ctx),
};

const HOLE_RADIUS = 38;
const MOLE_UP_TIME = 1.4;
const MOLE_UP_MIN = 0.6;
const GOLDEN_UP_TIME = 0.55;
const BOMB_UP_TIME = 1.2;
const SPAWN_INTERVAL = 0.9;
const SPAWN_MIN = 0.45;

const GOLDEN_CHANCE = 0.04;
const BOMB_CHANCE = 0.1;
const NORMAL_POINTS = 1;
const GOLDEN_POINTS = 10;
const BOMB_PENALTY = 5;
/** Consecutive hits needed to fill the combo meter and trigger FEVER. */
export const COMBO_TO_FEVER = 8;
export const FEVER_TIME = 5;
const FEVER_SPAWN_SCALE = 0.4;
/** Per-frame odds a bot slaps a bomb that's been up a while. Small on purpose. */
const BOT_BOMB_SLIP = 0.006;

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
  points: number;
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
  combo: number;
  fever: number;
  fevers: number;
  feverFlash: number;
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
        combo: 0,
        fever: 0,
        fevers: 0,
        feverFlash: 0,
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
              seat.combo = 0;
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

      if (seat.fever > 0) seat.fever = Math.max(0, seat.fever - dt);
      if (seat.feverFlash > 0) seat.feverFlash = Math.max(0, seat.feverFlash - dt);

      seat.spawnTimer -= dt;
      if (seat.spawnTimer <= 0) {
        const scale = seat.fever > 0 ? FEVER_SPAWN_SCALE : 1;
        seat.spawnTimer = (spawnInterval + this.ctx.rng.float(-0.15, 0.15)) * scale;
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
    // Fewer bombs during FEVER so it feels like a reward, not a trap.
    const bombChance = seat.fever > 0 ? BOMB_CHANCE * 0.5 : BOMB_CHANCE;
    if (roll < bombChance) {
      kind = "bomb";
      life = BOMB_UP_TIME;
    } else if (roll < bombChance + GOLDEN_CHANCE) {
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
      points: 0,
    });
  }

  private botTick(seat: Seat, _dt: number): void {
    const target = seat.moles.find(
      (m) => !m.whacked && m.kind !== "bomb" && m.life < m.maxLife * 0.7,
    );
    if (target && this.ctx.rng.next() < 0.12) {
      this.whackMole(seat, target);
      return;
    }
    // Bots mostly read bombs correctly, but sometimes slap one anyway.
    const bomb = seat.moles.find(
      (m) => !m.whacked && m.kind === "bomb" && m.life < m.maxLife * 0.7,
    );
    if (bomb && this.ctx.rng.next() < BOT_BOMB_SLIP) {
      this.whackMole(seat, bomb);
    }
  }

  private startFever(seat: Seat, mole: Mole): void {
    seat.fever = FEVER_TIME;
    seat.feverFlash = 0.5;
    seat.fevers++;
    seat.combo = 0;
    this.callouts.show(`${seat.player.name} FEVER!`, seat.player.color, {
      size: 64,
      life: 1.1,
      y: 0.45,
    });
    this.ctx.sfx.streak(4);
    this.juice.shake(0.35);
    this.juice.hitStop(0.06);
    this.juice.burst(mole.x, mole.y, ["#FFD700", "#FF3D7A", "#3EE0FF", seat.player.color], {
      count: 50,
      speed: 420,
      gravity: 200,
      life: 0.8,
    });
  }

  private whackMole(seat: Seat, mole: Mole): void {
    mole.whacked = true;
    mole.whackFlash = 0.3;
    mole.whackedBy = seat.player.id;

    if (mole.kind === "bomb") {
      const lost = Math.min(seat.score, BOMB_PENALTY);
      seat.score -= lost;
      mole.points = -BOMB_PENALTY;
      seat.bombHits++;
      seat.streak = 0;
      seat.combo = 0;
      seat.fever = 0;
      this.ctx.sfx.miss();
      this.juice.shake(0.45);
      this.juice.burst(mole.x, mole.y, ["#FF3D7A", "#FF4136", "#FF6B35"], {
        count: 24,
        speed: 300,
        gravity: 400,
        life: 0.5,
      });
    } else {
      const base = mole.kind === "golden" ? GOLDEN_POINTS : NORMAL_POINTS;
      const points = seat.fever > 0 ? base * 2 : base;
      mole.points = points;
      seat.score += points;
      seat.streak++;
      seat.bestStreak = Math.max(seat.bestStreak, seat.streak);
      seat.hits++;
      if (mole.kind === "golden") {
        seat.goldenHits++;
        this.juice.shake(0.25);
        this.callouts.show(`GOLD +${points}`, "#FFD700", { size: 44, life: 0.7, y: 0.55 });
      }

      // The meter only fills outside FEVER, so FEVER can't chain forever.
      if (seat.fever <= 0) seat.combo++;
      if (seat.fever <= 0 && seat.combo >= COMBO_TO_FEVER) {
        this.startFever(seat, mole);
      } else if (mole.kind === "golden") {
        this.ctx.sfx.streak(3);
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
    if (s.fever > 0) {
      const pulse = 0.12 + 0.08 * Math.sin(this.time * 14);
      g.save();
      g.globalAlpha = pulse + s.feverFlash * 0.6;
      g.fillStyle = player.color;
      g.fillRect(zx + 1, zy, zw - 2, zh);
      g.restore();
      g.save();
      g.strokeStyle = "#FFD700";
      g.lineWidth = 4;
      g.globalAlpha = 0.5 + 0.5 * Math.sin(this.time * 20);
      g.strokeRect(zx + 3, zy + 2, zw - 6, zh - 4);
      g.restore();
    }
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
    this.drawMeter(g, s);

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
        const pts = mole.points < 0 ? String(mole.points) : `+${mole.points}`;
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
        g.shadowBlur = mole.kind === "golden" ? 20 + 12 * Math.sin(this.time * 30) : 10;
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

        if (mole.kind === "golden") {
          // Shrinking ring shows how little time is left.
          g.beginPath();
          g.arc(0, -r * 0.3, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (mole.life / mole.maxLife));
          g.strokeStyle = "#FFF6C0";
          g.lineWidth = 3;
          g.stroke();
        }
      }
      g.restore();
    }
  }

  private drawMeter(g: CanvasRenderingContext2D, s: Seat): void {
    const w = Math.min(160, s.zoneW * 0.5);
    const h = 8;
    const x = s.zoneX + s.zoneW / 2 - w / 2;
    const y = s.zoneY + 58;
    const fill = s.fever > 0 ? s.fever / FEVER_TIME : s.combo / COMBO_TO_FEVER;
    g.fillStyle = "rgba(244,247,251,0.12)";
    g.fillRect(x, y, w, h);
    g.fillStyle = s.fever > 0 ? "#FFD700" : s.player.color;
    g.fillRect(x, y, w * fill, h);
    if (s.fever > 0) {
      g.save();
      g.fillStyle = "#FFD700";
      g.font = "700 18px Bebas Neue, Impact, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText("FEVER x2", x + w + 8, y + h / 2);
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
        out.push({ playerId: id, label: "Gold hits", value: String(s.goldenHits) });
      if (s.fevers > 0)
        out.push({ playerId: id, label: "Fevers", value: String(s.fevers) });
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
