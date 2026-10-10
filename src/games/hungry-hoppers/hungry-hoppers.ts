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
  ARENA_R,
  ARENA_X,
  ARENA_Y,
  CHOMP_TIME,
  FRENZY_AT,
  FRENZY_COUNT,
  MARBLE_R,
  MAX_LIVE,
  MOUTH_R,
  SPAWN_INTERVAL,
  STUN_TIME,
  applyEat,
  botRead,
  chompExtension,
  marblesInMouth,
  mouthCenter,
  seatAngles,
  spawnMarble,
  stepMarbles,
  zoneFor,
  type Marble,
  type MarbleKind,
} from "./logic";

export const hungryHoppers: GameDefinition = {
  id: "hungry-hoppers",
  name: "Hungry Hoppers",
  tagline: "Tap to chomp. Eat the most marbles.",
  description:
    "Marbles pour into the pond and bounce around. Tap your side to make your big-mouthed hopper " +
    "lunge and gulp every marble in reach. Normal = 1, gold = 3, bombs stun you and cost 2. " +
    "With 20 seconds left a FRENZY dumps 40 marbles at once. Most points wins.",
  durationMs: 45_000,
  controls: "Tap your half / corner to chomp",
  create: (ctx) => new HungryHoppers(ctx),
};

const BODY_OUT = 62;

interface Hopper {
  player: Player;
  seat: number;
  angle: number;
  /** Seconds since chomp started, or -1 when idle. */
  chompT: number;
  stunT: number;
  score: number;
  eaten: number;
  golds: number;
  bombs: number;
  botDelay: number;
}

class HungryHoppers implements GameInstance {
  private readonly hoppers: Hopper[];
  private readonly marbles: Marble[] = [];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly rand: () => number;
  private time = 0;
  private spawnT = 0;
  private frenzyDone = false;

  constructor(private readonly ctx: GameContext) {
    this.rand = () => ctx.rng.next();
    this.juice = new Juice(this.rand);
    const angles = seatAngles(ctx.players.length);
    this.hoppers = ctx.players.map((player, seat) => ({
      player,
      seat,
      angle: angles[seat] ?? 0,
      chompT: -1,
      stunT: 0,
      score: 0,
      eaten: 0,
      golds: 0,
      bombs: 0,
      botDelay: -1,
    }));
    for (let i = 0; i < 8; i++) this.marbles.push(spawnMarble(this.rand));
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = SPAWN_INTERVAL;
      if (this.marbles.length < MAX_LIVE) this.marbles.push(spawnMarble(this.rand));
    }

    if (!this.frenzyDone && this.time >= FRENZY_AT) {
      this.frenzyDone = true;
      for (let i = 0; i < FRENZY_COUNT; i++) this.marbles.push(spawnMarble(this.rand));
      this.callouts.show("FRENZY!", "#FFB020", { size: 96, life: 1.6 });
      this.juice.shake(0.4);
      this.juice.burst(ARENA_X, ARENA_Y, ["#FFB020", "#F4F7FB", "#3EE0FF"], { count: 50, speed: 420, gravity: 0 });
      this.ctx.sfx.streak(3);
    }

    stepMarbles(this.marbles, dt);

    for (const h of this.hoppers) {
      if (h.stunT > 0) h.stunT -= dt;
      if (h.chompT >= 0) {
        h.chompT += dt;
        if (h.chompT >= CHOMP_TIME) h.chompT = -1;
        else this.eat(h);
      }
      if (h.player.kind === "bot") this.botTick(h, dt);
    }
  }

  private eat(h: Hopper): void {
    const m = mouthCenter(h.angle, chompExtension(h.chompT));
    const idx = marblesInMouth(this.marbles, m.x, m.y);
    if (idx.length === 0) return;
    const kinds: MarbleKind[] = idx.map((i) => this.marbles[i]!.kind);
    for (let k = idx.length - 1; k >= 0; k--) this.marbles.splice(idx[k]!, 1);
    const r = applyEat(h.score, kinds);
    h.score = r.score;
    h.eaten += r.eaten;
    h.golds += r.golds;
    h.bombs += r.bombs;
    if (r.stunned) {
      h.stunT = STUN_TIME;
      h.chompT = -1;
      this.juice.shake(0.35);
      this.juice.burst(m.x, m.y, ["#FF3D7A", "#FFB020", "#2a2a3a"], { count: 30, speed: 320, gravity: 200 });
      this.ctx.sfx.hit();
    } else {
      this.juice.burst(m.x, m.y, r.golds > 0 ? ["#FFD54A", "#FFF3B0"] : [h.player.color, "#F4F7FB"], {
        count: 8 + r.eaten * 4,
        speed: 200,
        gravity: 0,
        life: 0.4,
      });
      if (r.golds > 0) this.ctx.sfx.streak(1);
      else this.ctx.sfx.collect();
    }
  }

  private chomp(h: Hopper): void {
    if (h.chompT >= 0 || h.stunT > 0) return;
    h.chompT = 0;
    this.ctx.sfx.whoosh();
  }

  private botTick(h: Hopper, dt: number): void {
    if (h.chompT >= 0 || h.stunT > 0) {
      h.botDelay = -1;
      return;
    }
    if (h.botDelay >= 0) {
      h.botDelay -= dt;
      if (h.botDelay < 0) this.chomp(h);
      return;
    }
    const read = botRead(this.marbles, h.angle);
    if (read === "go" || (read === "risky" && this.rand() < 0.04)) {
      h.botDelay = 0.08 + this.rand() * 0.22;
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
    const seat = zoneFor(p.x, p.y, this.hoppers.length, this.ctx.width, this.ctx.height);
    const h = this.hoppers[seat];
    if (!h || h.player.kind !== "human") return;
    e.preventDefault();
    this.chomp(h);
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    // Pond
    g.beginPath();
    g.arc(ARENA_X, ARENA_Y, ARENA_R, 0, Math.PI * 2);
    g.fillStyle = "#0f2a3a";
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = "#1d4a5e";
    g.stroke();
    g.beginPath();
    g.arc(ARENA_X, ARENA_Y, 40, 0, Math.PI * 2);
    g.fillStyle = "rgba(244,247,251,0.05)";
    g.fill();

    for (const m of this.marbles) this.drawMarble(g, m);
    for (const h of this.hoppers) this.drawHopper(g, h);

    this.juice.end(g);
    for (const h of this.hoppers) this.drawScore(g, h);
    this.callouts.draw(g, width, height);
  }

  private drawMarble(g: CanvasRenderingContext2D, m: Marble): void {
    g.beginPath();
    g.arc(m.x, m.y, MARBLE_R, 0, Math.PI * 2);
    g.fillStyle = m.kind === "gold" ? "#FFD54A" : m.kind === "bomb" ? "#1a1a24" : "#DDE6F0";
    g.fill();
    if (m.kind === "bomb") {
      g.lineWidth = 2;
      g.strokeStyle = "#FF3D7A";
      g.stroke();
      g.fillStyle = "#FF3D7A";
      g.fillRect(m.x - 2, m.y - MARBLE_R - 4, 4, 5);
    } else if (m.kind === "gold") {
      g.lineWidth = 2;
      g.strokeStyle = "#FFF3B0";
      g.stroke();
    }
    g.beginPath();
    g.arc(m.x - 3, m.y - 3, 3, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fill();
  }

  private drawHopper(g: CanvasRenderingContext2D, h: Hopper): void {
    const stunned = h.stunT > 0;
    const color = stunned ? "#6b6f7a" : h.player.color;
    const ext = h.chompT >= 0 ? chompExtension(h.chompT) : 0;
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const bx = ARENA_X + ca * (ARENA_R + BODY_OUT);
    const by = ARENA_Y + sa * (ARENA_R + BODY_OUT);
    const mouth = mouthCenter(h.angle, ext);

    // Neck / stretch
    g.lineCap = "round";
    g.lineWidth = 46;
    g.strokeStyle = color;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(mouth.x, mouth.y);
    g.stroke();

    // Body
    g.beginPath();
    g.arc(bx, by, 62, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();

    // Eyes (bulging, on the far side of the head)
    const px = -sa;
    const py = ca;
    for (const s of [-1, 1]) {
      const ex = bx + px * s * 34 - ca * 18;
      const ey = by + py * s * 34 - sa * 18;
      g.beginPath();
      g.arc(ex, ey, 16, 0, Math.PI * 2);
      g.fillStyle = "#F4F7FB";
      g.fill();
      g.beginPath();
      if (stunned) {
        g.lineWidth = 3;
        g.strokeStyle = "#070b14";
        g.moveTo(ex - 6, ey - 6);
        g.lineTo(ex + 6, ey + 6);
        g.moveTo(ex + 6, ey - 6);
        g.lineTo(ex - 6, ey + 6);
        g.stroke();
      } else {
        g.arc(ex - ca * 5, ey - sa * 5, 7, 0, Math.PI * 2);
        g.fillStyle = "#070b14";
        g.fill();
      }
    }

    // Head + jaws facing the centre
    const open = 0.25 + ext * 0.75;
    const face = h.angle + Math.PI;
    g.beginPath();
    g.arc(mouth.x, mouth.y, MOUTH_R * 0.8, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.beginPath();
    g.moveTo(mouth.x, mouth.y);
    g.arc(mouth.x, mouth.y, MOUTH_R * 0.8, face - open, face + open);
    g.closePath();
    g.fillStyle = "#3a0d1c";
    g.fill();

    if (stunned) {
      g.fillStyle = "#FFB020";
      g.font = "700 26px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("@#!", bx, by);
    }
  }

  private drawScore(g: CanvasRenderingContext2D, h: Hopper): void {
    const { width, height } = this.ctx;
    const n = this.hoppers.length;
    let x: number;
    let y: number;
    if (n <= 2) {
      x = h.seat === 0 ? 90 : width - 90;
      y = height / 2 - 150;
    } else {
      x = h.seat % 2 === 0 ? 90 : width - 90;
      y = h.seat < 2 ? 70 : height - 90;
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = h.player.color;
    g.font = "700 24px Bebas Neue, Impact, sans-serif";
    g.fillText(h.player.name, x, y);
    g.fillStyle = "#F4F7FB";
    g.font = "700 48px Bebas Neue, Impact, sans-serif";
    g.fillText(String(h.score), x, y + 38);
  }

  isFinished(): boolean {
    return false; // timed: the engine ends it at durationMs
  }

  getScores(): { playerId: string; score: number }[] {
    return this.hoppers.map((h) => ({ playerId: h.player.id, score: h.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const h of this.hoppers) {
      out.push({ playerId: h.player.id, label: "Marbles eaten", value: String(h.eaten) });
      out.push({ playerId: h.player.id, label: "Golds", value: String(h.golds) });
      out.push({ playerId: h.player.id, label: "Bombs", value: String(h.bombs) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
