import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";

export const nerve: GameDefinition = {
  id: "nerve",
  name: "Nerve",
  tagline: "Simon says... but weirder.",
  description:
    "Watch the sequence light up, then race to tap it back on your pads. " +
    "Each round adds a step and might throw a curveball: reversed, scrambled, " +
    "blacked-out, doubled, or the dreaded Simon Says filter. " +
    "First to nail it gets a speed bonus. Wrong tap? You're out for the round.",
  durationMs: 75_000,
  controls: "Tap coloured pads in sequence order",
  create: (ctx) => new NerveGame(ctx),
};

const PAD_COLORS = ["#FF4136", "#0074D9", "#2ECC40", "#FFDC00"] as const;
const PAD_LABELS = ["R", "B", "G", "Y"] as const;
const PAD_RADIUS = 58;

type Phase = "showing" | "go" | "playing" | "result";

interface Modifier {
  id: string;
  name: string;
  tag: string;
  color: string;
}

const MODIFIERS: readonly Modifier[] = [
  { id: "scramble", name: "SCRAMBLE!", tag: "Pads shuffled", color: "#FF3D7A" },
  { id: "reverse", name: "REVERSE!", tag: "Tap it backwards", color: "#FFB020" },
  { id: "blackout", name: "BLACKOUT!", tag: "Colours hidden", color: "#9F7AEA" },
  { id: "double", name: "DOUBLE TAP!", tag: "Every step twice", color: "#3EE0FF" },
  { id: "speed", name: "SPEED DEMON!", tag: "Blink and you'll miss it", color: "#FF3D7A" },
  { id: "simon", name: "SIMON SAYS!", tag: "Only tap the real ones", color: "#B8FF3D" },
  { id: "mirror", name: "MIRROR!", tag: "Pads flipped", color: "#FFB020" },
];

interface Seat {
  player: Player;
  zoneX: number;
  zoneY: number;
  zoneW: number;
  zoneH: number;
  padOrder: number[];
  padPositions: { x: number; y: number }[];
  input: number[];
  done: boolean;
  failed: boolean;
  roundScore: number;
  total: number;
  streak: number;
  bestStreak: number;
  perfects: number;
  speedBonuses: number;
  fails: number;
  padFlash: number[];
  botNext: number;
}

class NerveGame implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();

  private phase: Phase = "showing";
  private timer = 0;
  private time = 0;

  private sequence: number[] = [];
  private round = 0;
  private showIdx = 0;
  private showTimer = 0;
  private lit = -1;
  private modifier: Modifier | null = null;
  private simonFlags: boolean[] = [];

  private first: string | null = null;

  private readonly SHOW_STEP = 0.5;
  private readonly SHOW_GAP = 0.18;
  private readonly GO_TIME = 0.5;
  private readonly RESULT_TIME = 1.6;
  private readonly ROUND_LIMIT = 8;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());

    const n = ctx.players.length;
    const top = 95;
    const zH = ctx.height - top - 24;
    const zW = ctx.width / n;

    this.seats = ctx.players.map((player, i) => {
      const zx = i * zW;
      const cx = zx + zW / 2;
      const cy = top + zH / 2;
      const sx = Math.min(zW * 0.3, 80);
      const sy = Math.min(zH * 0.26, 88);
      return {
        player,
        zoneX: zx,
        zoneY: top,
        zoneW: zW,
        zoneH: zH,
        padOrder: [0, 1, 2, 3],
        padPositions: [
          { x: cx - sx, y: cy - sy },
          { x: cx + sx, y: cy - sy },
          { x: cx - sx, y: cy + sy },
          { x: cx + sx, y: cy + sy },
        ],
        input: [],
        done: false,
        failed: false,
        roundScore: 0,
        total: 0,
        streak: 0,
        bestStreak: 0,
        perfects: 0,
        speedBonuses: 0,
        fails: 0,
        padFlash: [0, 0, 0, 0],
        botNext: 0,
      };
    });

    this.nextRound();

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private nextRound(): void {
    this.round++;
    this.phase = "showing";
    this.showIdx = 0;
    this.showTimer = 0.35;
    this.lit = -1;
    this.first = null;

    this.sequence.push(this.ctx.rng.int(0, 3));

    if (this.round >= 3) {
      this.modifier = this.ctx.rng.pick(MODIFIERS);
      this.callouts.show(this.modifier.name, this.modifier.color, {
        size: 72,
        life: 1.4,
      });
      if (this.modifier.id === "scramble") {
        for (const s of this.seats) s.padOrder = this.shuffle([0, 1, 2, 3]);
      }
      if (this.modifier.id === "mirror") {
        for (const s of this.seats) {
          const o = s.padOrder;
          s.padOrder = [o[1]!, o[0]!, o[3]!, o[2]!];
        }
      }
      if (this.modifier.id === "simon") {
        this.simonFlags = this.sequence.map(
          (_, i) => i === this.sequence.length - 1 || this.ctx.rng.next() < 0.6,
        );
        let trues = this.simonFlags.filter(Boolean).length;
        if (trues === 0) this.simonFlags[this.sequence.length - 1] = true;
      } else {
        this.simonFlags = [];
      }
    } else {
      this.modifier = null;
      this.simonFlags = [];
    }

    for (const s of this.seats) {
      s.input = [];
      s.done = false;
      s.failed = false;
      s.roundScore = 0;
      s.botNext = 0;
    }
  }

  private shuffle(arr: number[]): number[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.ctx.rng.int(0, i);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  private target(): number[] {
    let seq = [...this.sequence];
    if (this.modifier?.id === "simon") {
      seq = seq.filter((_, i) => this.simonFlags[i]);
    }
    if (this.modifier?.id === "reverse") seq.reverse();
    if (this.modifier?.id === "double") {
      const d: number[] = [];
      for (const v of seq) d.push(v, v);
      seq = d;
    }
    return seq;
  }

  private stepDur(): number {
    return this.modifier?.id === "speed" ? this.SHOW_STEP * 0.45 : this.SHOW_STEP;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    for (const s of this.seats)
      for (let i = 0; i < 4; i++) s.padFlash[i] = Math.max(0, s.padFlash[i]! - dt);

    if (this.phase === "showing") this.tickShow(dt);
    else if (this.phase === "go") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "playing";
        this.timer = this.ROUND_LIMIT;
        this.ctx.sfx.go();
      }
    } else if (this.phase === "playing") this.tickPlay(dt);
    else if (this.phase === "result") {
      this.timer -= dt;
      if (this.timer <= 0) this.nextRound();
    }
  }

  private tickShow(dt: number): void {
    this.showTimer -= dt;
    if (this.showTimer > 0) return;
    if (this.lit >= 0) {
      this.lit = -1;
      this.showTimer = this.SHOW_GAP;
      this.showIdx++;
      if (this.showIdx >= this.sequence.length) {
        this.phase = "go";
        this.timer = this.GO_TIME;
        this.callouts.show("GO!", "#B8FF3D", { size: 96, life: 0.45, y: 0.42 });
      }
    } else {
      this.lit = this.sequence[this.showIdx]!;
      this.showTimer = this.stepDur();
      this.ctx.sfx.tick();
    }
  }

  private tickPlay(dt: number): void {
    this.timer -= dt;
    for (const s of this.seats) {
      if (s.player.kind === "bot" && !s.done && !s.failed) this.botTick(s, dt);
    }
    if (this.seats.every((s) => s.done || s.failed) || this.timer <= 0) {
      this.scoreRound();
      this.phase = "result";
      this.timer = this.RESULT_TIME;
    }
  }

  private botTick(seat: Seat, dt: number): void {
    const tgt = this.target();
    const idx = seat.input.length;
    if (idx >= tgt.length) return;
    seat.botNext += dt;
    if (seat.botNext < 0.35 + idx * 0.28) return;
    const correct = this.ctx.rng.next() < 0.82;
    this.tap(seat, correct ? tgt[idx]! : (tgt[idx]! + this.ctx.rng.int(1, 3)) % 4);
  }

  private scoreRound(): void {
    for (const s of this.seats) {
      if (s.done) {
        const base = 100 + (this.round - 1) * 25;
        const speed = s.player.id === this.first ? 50 : 0;
        s.roundScore = base + speed;
        s.total += s.roundScore;
        s.streak++;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        s.perfects++;
        if (speed > 0) s.speedBonuses++;
      } else {
        s.roundScore = s.failed ? -25 : 0;
        s.total = Math.max(0, s.total + s.roundScore);
        s.streak = 0;
        if (s.failed) s.fails++;
      }
    }
    const w = this.seats
      .filter((s) => s.done)
      .sort((a, b) => b.roundScore - a.roundScore)[0];
    if (w) {
      this.callouts.show(`${w.player.name} NAILS IT!`, w.player.color, { size: 56 });
      this.juice.shake(0.18);
      this.ctx.sfx.collect();
    } else {
      this.callouts.show("EVERYONE CHOKED!", "#FF3D7A", { size: 48 });
      this.ctx.sfx.miss();
    }
  }

  private tap(seat: Seat, color: number): void {
    if (seat.done || seat.failed) return;
    const tgt = this.target();
    const expected = tgt[seat.input.length];
    const pos = seat.padOrder.indexOf(color);
    if (pos >= 0) seat.padFlash[pos] = 0.18;
    seat.input.push(color);

    if (color !== expected) {
      seat.failed = true;
      this.ctx.sfx.miss();
      this.juice.shake(0.12);
      this.juice.burst(
        seat.zoneX + seat.zoneW / 2,
        seat.zoneY + seat.zoneH / 2,
        ["#FF4136", "#FF3D7A"],
        { count: 16, speed: 200, gravity: 0, life: 0.4 },
      );
      return;
    }
    this.ctx.sfx.tick();
    if (seat.input.length === tgt.length) {
      seat.done = true;
      if (!this.first) this.first = seat.player.id;
      this.ctx.sfx.collect();
      this.juice.burst(
        seat.zoneX + seat.zoneW / 2,
        seat.zoneY + seat.zoneH / 2,
        [seat.player.color, "#ffffff"],
        { count: 28, speed: 280, gravity: 0, life: 0.5 },
      );
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
    if (this.phase !== "playing") return;
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
      for (let i = 0; i < 4; i++) {
        const pad = seat.padPositions[i]!;
        if (Math.hypot(p.x - pad.x, p.y - pad.y) <= PAD_RADIUS * 1.35) {
          e.preventDefault();
          this.tap(seat, seat.padOrder[i]!);
          return;
        }
      }
    }
  };

  // -- rendering --------------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    for (const seat of this.seats) this.drawZone(g, seat);
    this.drawHeader(g);
    if (this.phase === "playing") this.drawPlayTimer(g);
    if (this.phase === "result") this.drawResultScores(g);

    this.juice.end(g);
    this.callouts.draw(g, width, height);
  }

  private drawHeader(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const y = 42;

    g.fillStyle = "#F4F7FB";
    g.font = "700 26px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";

    if (this.phase === "showing")
      g.fillText("WATCH...", width / 2, y - 20);
    else if (this.phase === "go")
      g.fillText("GET READY", width / 2, y - 20);
    else if (this.phase === "playing")
      g.fillText("TAP IT!", width / 2, y - 20);
    else g.fillText(`ROUND ${this.round} DONE`, width / 2, y - 20);

    const seq = this.sequence;
    const dot = Math.min(18, Math.max(10, 300 / seq.length));
    const gap = Math.min(10, Math.max(4, 150 / seq.length));
    const tw = seq.length * (dot * 2 + gap) - gap;
    const sx = width / 2 - tw / 2;

    for (let i = 0; i < seq.length; i++) {
      const cx = sx + i * (dot * 2 + gap) + dot;
      const cy = y + 10;
      const c = seq[i]!;
      const active =
        this.phase === "showing" && i === this.showIdx && this.lit >= 0;
      const past = this.phase === "showing" && i < this.showIdx;
      const revealed = this.phase !== "showing" || past || active;

      g.beginPath();
      g.arc(cx, cy, active ? dot * 1.4 : dot, 0, Math.PI * 2);

      if (active) {
        g.shadowColor = PAD_COLORS[c]!;
        g.shadowBlur = 22;
        g.fillStyle = PAD_COLORS[c]!;
      } else if (revealed) {
        g.shadowBlur = 0;
        g.fillStyle = PAD_COLORS[c]! + "70";
      } else {
        g.shadowBlur = 0;
        g.fillStyle = "rgba(244,247,251,0.12)";
      }
      g.fill();
      g.shadowBlur = 0;

      if (
        this.modifier?.id === "simon" &&
        this.simonFlags.length > i &&
        revealed
      ) {
        g.fillStyle = this.simonFlags[i] ? "#2ECC40" : "#FF4136";
        g.font = `700 ${Math.max(9, dot)}px Outfit, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(this.simonFlags[i] ? "S" : "X", cx, cy);
      }
    }

    if (this.modifier) {
      g.fillStyle = this.modifier.color + "30";
      g.fillRect(0, 72, width, 20);
      g.fillStyle = this.modifier.color;
      g.font = "600 13px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(
        `${this.modifier.name}  ${this.modifier.tag}`,
        width / 2,
        82,
      );
    }
  }

  private drawPlayTimer(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const t = Math.max(0, this.timer / this.ROUND_LIMIT);
    const barY = 68;
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(width / 2 - 120, barY, 240, 6);
    g.fillStyle = t < 0.25 ? "#FF3D7A" : "#3EE0FF";
    g.fillRect(width / 2 - 120, barY, 240 * t, 6);
  }

  private drawZone(g: CanvasRenderingContext2D, s: Seat): void {
    const { zoneX: zx, zoneY: zy, zoneW: zw, zoneH: zh, player } = s;

    g.fillStyle = "rgba(244,247,251,0.025)";
    g.fillRect(zx + 1, zy, zw - 2, zh);
    g.strokeStyle = "rgba(244,247,251,0.08)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(zx + zw, zy);
    g.lineTo(zx + zw, zy + zh);
    g.stroke();

    g.fillStyle = player.color;
    g.font = "700 26px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillText(player.name, zx + zw / 2, zy + 6);

    g.fillStyle = "#F4F7FB";
    g.font = "600 20px Outfit, sans-serif";
    g.fillText(String(s.total), zx + zw / 2, zy + 32);

    if (s.streak >= 3) {
      g.fillStyle = "#FFB020";
      g.font = "600 13px Outfit, sans-serif";
      g.fillText(`streak ${s.streak}`, zx + zw / 2, zy + 54);
    }

    const blackout =
      this.modifier?.id === "blackout" && this.phase === "playing";

    for (let i = 0; i < 4; i++) {
      const pad = s.padPositions[i]!;
      const ci = s.padOrder[i]!;
      const col = PAD_COLORS[ci]!;
      const flash = s.padFlash[i]!;

      const isShowLit =
        this.phase === "showing" && this.lit === ci && this.lit >= 0;

      g.save();
      g.beginPath();
      g.arc(pad.x, pad.y, isShowLit ? PAD_RADIUS * 1.12 : PAD_RADIUS, 0, Math.PI * 2);

      if (flash > 0) {
        g.shadowColor = "#ffffff";
        g.shadowBlur = 28;
        g.fillStyle = "#ffffff";
        g.fill();
      } else if (isShowLit) {
        g.shadowColor = col;
        g.shadowBlur = 30;
        g.fillStyle = col;
        g.fill();
      } else if (blackout) {
        g.fillStyle = "rgba(7,11,20,0.75)";
        g.fill();
        g.strokeStyle = "rgba(244,247,251,0.22)";
        g.lineWidth = 3;
        g.stroke();
      } else {
        g.shadowColor = col;
        g.shadowBlur = 10;
        g.fillStyle = col + "CC";
        g.fill();
        g.shadowBlur = 0;
        g.beginPath();
        g.arc(
          pad.x - PAD_RADIUS * 0.15,
          pad.y - PAD_RADIUS * 0.22,
          PAD_RADIUS * 0.45,
          0,
          Math.PI * 2,
        );
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.fill();
      }
      g.shadowBlur = 0;

      if (!blackout && !isShowLit && flash <= 0) {
        g.fillStyle = "rgba(7,11,20,0.55)";
        g.font = "700 18px Outfit, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(PAD_LABELS[ci]!, pad.x, pad.y);
      }
      g.restore();
    }

    if (this.phase === "playing" && !s.done && !s.failed) {
      const tgt = this.target();
      const prog = s.input.length;
      const dotY = zy + zh - 16;
      const dg = 13;
      const dx = zx + zw / 2 - ((tgt.length - 1) * dg) / 2;
      for (let i = 0; i < tgt.length; i++) {
        g.beginPath();
        g.arc(dx + i * dg, dotY, 4, 0, Math.PI * 2);
        g.fillStyle =
          i < prog ? player.color : "rgba(244,247,251,0.18)";
        g.fill();
      }
    }

    if (s.done) {
      g.fillStyle = "rgba(46,204,64,0.08)";
      g.fillRect(zx + 1, zy + 70, zw - 2, zh - 70);
      g.fillStyle = "#2ECC40";
      g.font = "700 52px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("✓", zx + zw / 2, zy + zh / 2 + 40);
    } else if (s.failed) {
      g.fillStyle = "rgba(255,65,54,0.08)";
      g.fillRect(zx + 1, zy + 70, zw - 2, zh - 70);
      g.fillStyle = "#FF4136";
      g.font = "700 52px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("✗", zx + zw / 2, zy + zh / 2 + 40);
    }
  }

  private drawResultScores(g: CanvasRenderingContext2D): void {
    for (const s of this.seats) {
      if (s.roundScore === 0) continue;
      const sign = s.roundScore > 0 ? "+" : "";
      g.fillStyle = s.roundScore > 0 ? "#B8FF3D" : "#FF3D7A";
      g.font = "700 36px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(
        `${sign}${s.roundScore}`,
        s.zoneX + s.zoneW / 2,
        s.zoneY + s.zoneH / 2 + 40,
      );
    }

    const { width, height } = this.ctx;
    g.fillStyle = "rgba(244,247,251,0.4)";
    g.font = "600 15px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText(
      `Round ${this.round}  •  Sequence: ${this.target().length} steps`,
      width / 2,
      height - 4,
    );
  }

  isFinished(): boolean {
    return false;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({
      playerId: s.player.id,
      score: s.total,
    }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      const id = s.player.id;
      if (s.perfects > 0)
        out.push({ playerId: id, label: "Perfect rounds", value: String(s.perfects) });
      if (s.speedBonuses > 0)
        out.push({ playerId: id, label: "Speed bonuses", value: String(s.speedBonuses) });
      if (s.bestStreak > 1)
        out.push({ playerId: id, label: "Best streak", value: String(s.bestStreak) });
      if (s.fails > 0)
        out.push({ playerId: id, label: "Chokes", value: String(s.fails) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
