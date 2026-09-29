import { fillArena } from "../../core/draw";
import type { MinigameContext, MinigameDefinition, MinigameInstance, Player } from "../../core/types";
import { PUCK_RADIUS, isResting, stepWorld, type Puck, type World } from "./physics";
import {
  MAX_PULL,
  PAD_RADIUS,
  PUCKS_EACH,
  RELOAD_S,
  RINGS,
  botRelease,
  launchVelocity,
  padPositions,
  scatterPegs,
  scoreBoard,
  type Point,
} from "./rules";

export const eyeOfTheStorm: MinigameDefinition = {
  id: "eye-of-the-storm",
  name: "Eye of the Storm",
  tagline: "Everyone fires at once. Land in the eye.",
  description:
    "Slingshot six pucks each from your corner into the eye. Center 10, middle 5, outer 2. The swirl bends shots and flips direction, pegs move every game, and anyone can knock you out. Built for a big multi-touch screen: all players shoot at the same time.",
  durationMs: 60_000,
  controls: "Drag back from your corner pad, release to fire",
  create: (ctx) => new EyeOfTheStorm(ctx),
};

interface Seat {
  player: Player;
  pad: Point;
  left: number;
  reload: number;
  botWait: number;
  /** Where the active finger/mouse is while aiming. */
  aim: Point | null;
}

const SWIRL_FLIP_MIN = 4;
const SWIRL_FLIP_MAX = 8;
const SETTLE_GRACE_S = 0.8;

class EyeOfTheStorm implements MinigameInstance {
  private readonly world: World;
  private readonly seats: Seat[];
  private readonly center: Point;
  /** pointerId -> seat index, so several fingers can aim at once. */
  private readonly grabs = new Map<number, number>();
  private nextId = 1;
  private swirlTimer: number;
  private flash = 0;
  private settled = 0;
  private time = 0;
  private scores = new Map<string, number>();

  constructor(private readonly ctx: MinigameContext) {
    const { width, height, rng } = ctx;
    this.center = { x: width / 2, y: height / 2 };
    const pads = padPositions(width, height);
    this.seats = ctx.players.map((player, i) => ({
      player,
      pad: pads[i % pads.length]!,
      left: PUCKS_EACH,
      reload: 0,
      botWait: rng.float(1, 2.5),
      aim: null,
    }));
    this.world = {
      width,
      height,
      pucks: [],
      pegs: scatterPegs(rng, width, height, pads),
      swirl: { ...this.center, radius: 300, spin: rng.sign() * rng.float(1.2, 2) },
    };
    this.swirlTimer = rng.float(SWIRL_FLIP_MIN, SWIRL_FLIP_MAX);

    const canvas = ctx.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt);

    this.swirlTimer -= dt;
    if (this.swirlTimer <= 0) {
      const { rng } = this.ctx;
      this.world.swirl.spin = -Math.sign(this.world.swirl.spin) * rng.float(1.2, 2.2);
      this.swirlTimer = rng.float(SWIRL_FLIP_MIN, SWIRL_FLIP_MAX);
      this.flash = 0.5;
      this.ctx.sfx.countdown();
    }

    for (const seat of this.seats) {
      seat.reload = Math.max(0, seat.reload - dt);
      if (seat.player.kind === "bot" && seat.left > 0 && seat.reload === 0) {
        seat.botWait -= dt;
        if (seat.botWait <= 0) {
          this.fire(seat, botRelease(this.ctx.rng, seat.pad, this.center));
          seat.botWait = this.ctx.rng.float(1.2, 3.2);
        }
      }
    }

    const events = stepWorld(this.world, dt, () => this.ctx.rng.float(-1, 1));
    if (events.puckHits > 0) this.ctx.sfx.hit();
    else if (events.pegHits > 0) this.ctx.sfx.tick();

    this.scores = scoreBoard(
      this.world.pucks,
      this.seats.map((s) => s.player.id),
      this.center,
    );

    const allOut = this.seats.every((s) => s.left === 0);
    const still = this.world.pucks.every(isResting);
    this.settled = allOut && still ? this.settled + dt : 0;
  }

  isFinished(): boolean {
    return this.settled >= SETTLE_GRACE_S;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: this.scores.get(s.player.id) ?? 0 }));
  }

  destroy(): void {
    const canvas = this.ctx.canvas;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onCancel);
  }

  private fire(seat: Seat, release: Point): void {
    if (seat.left <= 0 || seat.reload > 0) return;
    const v = launchVelocity(seat.pad, release);
    if (!v) return;
    const puck: Puck = { id: this.nextId++, owner: seat.player.id, x: seat.pad.x, y: seat.pad.y, r: PUCK_RADIUS, ...v };
    this.world.pucks.push(puck);
    seat.left -= 1;
    seat.reload = RELOAD_S;
    this.ctx.sfx.go();
  }

  // ---- multi-touch -------------------------------------------------------

  private toLogical(event: PointerEvent): Point {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / (rect.width || 1)) * this.ctx.width,
      y: ((event.clientY - rect.top) / (rect.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (event: PointerEvent): void => {
    const p = this.toLogical(event);
    let best = -1;
    let bestDist = PAD_RADIUS * 1.6;
    this.seats.forEach((seat, i) => {
      if (seat.player.kind !== "human" || seat.aim) return;
      const d = Math.hypot(p.x - seat.pad.x, p.y - seat.pad.y);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best < 0) return;
    event.preventDefault();
    this.grabs.set(event.pointerId, best);
    this.seats[best]!.aim = p;
    try {
      this.ctx.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* capture is optional */
    }
  };

  private readonly onMove = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    event.preventDefault();
    this.seats[i]!.aim = this.toLogical(event);
  };

  private readonly onUp = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    const seat = this.seats[i]!;
    seat.aim = null;
    this.fire(seat, this.toLogical(event));
  };

  private readonly onCancel = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    this.seats[i]!.aim = null;
  };

  // ---- drawing -----------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.drawSwirl(g);
    this.drawRings(g);
    for (const peg of this.world.pegs) {
      g.beginPath();
      g.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      g.fillStyle = "#1d2b45";
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = "#9ad9ff";
      g.stroke();
    }
    for (const seat of this.seats) this.drawPad(g, seat);
    for (const puck of this.world.pucks) this.drawPuck(g, puck);
    for (const seat of this.seats) if (seat.aim) this.drawAim(g, seat);
  }

  private drawSwirl(g: CanvasRenderingContext2D): void {
    const { swirl } = this.world;
    const dir = Math.sign(swirl.spin);
    g.save();
    g.translate(swirl.x, swirl.y);
    g.rotate(this.time * swirl.spin * 0.35);
    g.lineWidth = 3;
    const alpha = 0.16 + this.flash * 0.8;
    g.strokeStyle = `rgba(154,217,255,${alpha})`;
    for (let arm = 0; arm < 6; arm += 1) {
      g.beginPath();
      for (let t = 0; t <= 1; t += 0.05) {
        const r = 60 + t * (swirl.radius - 60);
        const a = (arm / 6) * Math.PI * 2 + dir * t * 2.2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }

  private drawRings(g: CanvasRenderingContext2D): void {
    const fills = ["rgba(255,61,122,0.30)", "rgba(255,176,32,0.18)", "rgba(62,224,255,0.10)"];
    for (let i = RINGS.length - 1; i >= 0; i -= 1) {
      const ring = RINGS[i]!;
      g.beginPath();
      g.arc(this.center.x, this.center.y, ring.radius, 0, Math.PI * 2);
      g.fillStyle = fills[i]!;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "rgba(244,247,251,0.35)";
      g.stroke();
      g.fillStyle = "rgba(244,247,251,0.45)";
      g.font = "600 16px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const labelY = i === 0 ? this.center.y : this.center.y - (ring.radius + RINGS[i - 1]!.radius) / 2;
      g.fillText(String(ring.points), this.center.x, labelY);
    }
  }

  private drawPad(g: CanvasRenderingContext2D, seat: Seat): void {
    const { pad, player } = seat;
    const ready = seat.left > 0 && seat.reload === 0;
    g.save();
    g.beginPath();
    g.arc(pad.x, pad.y, PAD_RADIUS, 0, Math.PI * 2);
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fill();
    g.lineWidth = ready ? 5 : 2;
    g.strokeStyle = player.color;
    g.globalAlpha = ready ? 1 : 0.5;
    g.stroke();
    g.globalAlpha = 1;

    // Remaining pucks as pips around the pad.
    for (let i = 0; i < PUCKS_EACH; i += 1) {
      const a = -Math.PI / 2 + (i / PUCKS_EACH) * Math.PI * 2;
      g.beginPath();
      g.arc(pad.x + Math.cos(a) * (PAD_RADIUS + 14), pad.y + Math.sin(a) * (PAD_RADIUS + 14), 6, 0, Math.PI * 2);
      g.fillStyle = i < seat.left ? player.color : "rgba(244,247,251,0.12)";
      g.fill();
    }

    // Text faces the table centre so each corner reads it the right way up.
    g.translate(pad.x, pad.y);
    g.rotate(Math.atan2(this.center.y - pad.y, this.center.x - pad.x) - Math.PI / 2 + Math.PI);
    g.fillStyle = "#F4F7FB";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 40px Bebas Neue, Impact, sans-serif";
    g.fillText(String(this.scores.get(player.id) ?? 0), 0, -6);
    g.font = "600 15px Outfit, sans-serif";
    g.fillStyle = player.color;
    g.fillText(player.name, 0, 24);
    g.restore();
  }

  private drawPuck(g: CanvasRenderingContext2D, puck: Puck): void {
    const seat = this.seats.find((s) => s.player.id === puck.owner);
    const color = seat?.player.color ?? "#ffffff";
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.beginPath();
    g.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.shadowBlur = 0;
    g.beginPath();
    g.arc(puck.x, puck.y, puck.r * 0.5, 0, Math.PI * 2);
    g.fillStyle = "rgba(7,11,20,0.35)";
    g.fill();
    g.restore();
  }

  private drawAim(g: CanvasRenderingContext2D, seat: Seat): void {
    const aim = seat.aim!;
    const { pad } = seat;
    const dx = pad.x - aim.x;
    const dy = pad.y - aim.y;
    const pull = Math.min(Math.hypot(dx, dy), MAX_PULL);
    const len = Math.hypot(dx, dy) || 1;
    g.save();
    g.strokeStyle = seat.player.color;
    g.lineWidth = 4;
    g.setLineDash([2, 10]);
    g.lineCap = "round";
    // Direction preview only — the swirl and pegs decide the rest.
    g.beginPath();
    g.moveTo(pad.x, pad.y);
    g.lineTo(pad.x + (dx / len) * pull * 2.2, pad.y + (dy / len) * pull * 2.2);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(pad.x, pad.y);
    g.lineTo(pad.x - (dx / len) * pull, pad.y - (dy / len) * pull);
    g.lineWidth = 6;
    g.globalAlpha = 0.5;
    g.stroke();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(pad.x - (dx / len) * pull, pad.y - (dy / len) * pull, PUCK_RADIUS, 0, Math.PI * 2);
    g.fillStyle = seat.left > 0 ? seat.player.color : "rgba(244,247,251,0.2)";
    g.fill();
    g.restore();
  }
}
