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
  FRENZY_COUNT,
  FRENZY_TIMES,
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
  nextStreak,
  POINTS,
  streakMultiplier,
  seatAngles,
  spawnMarble,
  stepMarbles,
  zoneFor,
  type Marble,
  type MarbleKind,
} from "./logic";

export const hungryHoppers: GameDefinition = {
  id: "hungry-hoppers",
  name: "Chomp",
  tagline: "Tap to chomp. Time it right. Eat the most.",
  description:
    "Marbles roll around the bowl. Tap to make your monster lunge and gulp everything in reach. " +
    "White = 1, gold = 8 (rare and fast). Bombs cost 2 and stun you. Chomp food in a row to build " +
    "a multiplier, up to x4. Chomp on nothing and it resets, so don't spam. Watch for FRENZY waves. " +
    "Most points wins.",
  durationMs: 45_000,
  controls: "Tap your side of the screen to chomp",
  create: (ctx) => new Chomp(ctx),
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
  /** Good chomps in a row. */
  streak: number;
  bestStreak: number;
  /** What the current chomp has eaten so far. */
  chompFood: boolean;
  chompBomb: boolean;
  /** Seconds left on the red "whiff" flash. */
  whiffT: number;
  botDelay: number;
}

class Chomp implements GameInstance {
  private readonly hoppers: Hopper[];
  private readonly marbles: Marble[] = [];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly rand: () => number;
  private time = 0;
  private spawnT = 0;
  private frenzyIdx = 0;
  /** Seconds left on the frenzy banner. */
  private frenzyT = 0;

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
      streak: 0,
      bestStreak: 0,
      chompFood: false,
      chompBomb: false,
      whiffT: 0,
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

    if (this.frenzyT > 0) this.frenzyT -= dt;
    const nextFrenzy = FRENZY_TIMES[this.frenzyIdx];
    if (nextFrenzy !== undefined && this.time >= nextFrenzy) {
      this.frenzyIdx++;
      this.frenzyT = 2.2;
      for (let i = 0; i < FRENZY_COUNT; i++) this.marbles.push(spawnMarble(this.rand));
      // Every frenzy carries at least one gold to fight over.
      this.marbles.push(spawnMarble(this.rand, "gold"));
      this.callouts.show("FRENZY!", "#FFB020", { size: 96, life: 1.6 });
      this.juice.shake(0.4);
      this.juice.burst(ARENA_X, ARENA_Y, ["#FFB020", "#F4F7FB", "#3EE0FF"], { count: 50, speed: 420, gravity: 0 });
      this.ctx.sfx.streak(3);
    }

    stepMarbles(this.marbles, dt);

    for (const h of this.hoppers) {
      if (h.stunT > 0) h.stunT -= dt;
      if (h.whiffT > 0) h.whiffT -= dt;
      if (h.chompT >= 0) {
        h.chompT += dt;
        if (h.chompT >= CHOMP_TIME) this.endChomp(h);
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
    const mult = streakMultiplier(h.streak);
    const r = applyEat(h.score, kinds, mult);
    if (r.eaten > r.bombs) h.chompFood = true;
    h.score = r.score;
    h.eaten += r.eaten;
    h.golds += r.golds;
    h.bombs += r.bombs;
    if (r.golds > 0) {
      this.callouts.show(`GOLD! +${POINTS.gold * mult * r.golds}`, "#FFD54A", { size: 88, life: 1.3 });
      this.juice.shake(0.25);
      this.juice.burst(m.x, m.y, ["#FFD54A", "#FFF3B0", "#FFFFFF"], { count: 40, speed: 380, gravity: 0 });
    }
    if (r.stunned) {
      h.stunT = STUN_TIME;
      h.chompBomb = true;
      this.endChomp(h);
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
      if (r.golds > 0) this.ctx.sfx.streak(2);
      else this.ctx.sfx.collect();
    }
  }

  /** Close out a chomp: extend the streak on food, reset it on a whiff or a bomb. */
  private endChomp(h: Hopper): void {
    h.chompT = -1;
    const before = streakMultiplier(h.streak);
    const hadStreak = h.streak;
    h.streak = nextStreak(h.streak, h.chompFood, h.chompBomb);
    h.bestStreak = Math.max(h.bestStreak, h.streak);
    if (!h.chompFood && !h.chompBomb) {
      h.whiffT = 0.4;
      if (hadStreak >= 3) this.callouts.show(`${h.player.name} WHIFFED`, "#FF3D7A", { size: 40, life: 0.9, y: 0.8 });
    }
    const after = streakMultiplier(h.streak);
    if (after > before) {
      this.callouts.show(`${h.player.name} x${after}!`, h.player.color, { size: 56, life: 1, y: 0.2 });
      this.ctx.sfx.streak(after);
    }
    h.chompFood = false;
    h.chompBomb = false;
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
    // Bots mostly dodge bombs, but greed gets them sometimes.
    if (read === "go" || (read === "risky" && this.rand() < 0.05)) {
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

    // Bowl (glows warm during a frenzy)
    const frenzy = this.frenzyT > 0;
    g.beginPath();
    g.arc(ARENA_X, ARENA_Y, ARENA_R, 0, Math.PI * 2);
    g.fillStyle = frenzy ? "#2a1f3a" : "#14243a";
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = frenzy ? "#FFB020" : "#2b4664";
    g.stroke();
    g.beginPath();
    g.arc(ARENA_X, ARENA_Y, 40, 0, Math.PI * 2);
    g.fillStyle = "rgba(244,247,251,0.05)";
    g.fill();

    for (const m of this.marbles) this.drawMarble(g, m);
    for (const h of this.hoppers) this.drawMonster(g, h);

    this.juice.end(g);
    for (const h of this.hoppers) this.drawScore(g, h);
    if (frenzy) this.drawFrenzyBanner(g);
    this.callouts.draw(g, width, height);
  }

  private drawFrenzyBanner(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 18);
    g.fillStyle = `rgba(255,176,32,${0.85 * pulse})`;
    g.fillRect(0, 14, width, 46);
    g.fillStyle = "#070b14";
    g.font = "700 34px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("FRENZY WAVE  -  EAT EVERYTHING", width / 2, 38);
  }

  private drawMarble(g: CanvasRenderingContext2D, m: Marble): void {
    if (m.kind === "gold") {
      // Halo + spinning glint so it pops out of the crowd.
      g.beginPath();
      g.arc(m.x, m.y, MARBLE_R + 7, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,213,74,0.25)";
      g.fill();
    }
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
      // Flickering fuse spark
      if (Math.sin(this.time * 30 + m.x) > 0) {
        g.fillStyle = "#FFB020";
        g.fillRect(m.x - 1.5, m.y - MARBLE_R - 8, 3, 3);
      }
    } else if (m.kind === "gold") {
      g.lineWidth = 2;
      g.strokeStyle = "#FFF3B0";
      g.stroke();
      const a = this.time * 6;
      const len = MARBLE_R + 9;
      g.strokeStyle = "#FFFFFF";
      g.lineWidth = 2;
      g.beginPath();
      for (const off of [0, Math.PI / 2]) {
        const ca = Math.cos(a + off) * len;
        const sa = Math.sin(a + off) * len;
        g.moveTo(m.x - ca, m.y - sa);
        g.lineTo(m.x + ca, m.y + sa);
      }
      g.stroke();
    }
    g.beginPath();
    g.arc(m.x - 3, m.y - 3, 3, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fill();
  }

  /** A round one-eyed monster on the rim; its mouth lunges in on a stretchy neck. */
  private drawMonster(g: CanvasRenderingContext2D, h: Hopper): void {
    const stunned = h.stunT > 0;
    const color = stunned ? "#6b6f7a" : h.whiffT > 0 ? "#FF3D7A" : h.player.color;
    const ext = h.chompT >= 0 ? chompExtension(h.chompT) : 0;
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const px = -sa;
    const py = ca;
    const bx = ARENA_X + ca * (ARENA_R + BODY_OUT);
    const by = ARENA_Y + sa * (ARENA_R + BODY_OUT);
    const mouth = mouthCenter(h.angle, ext);

    // Stretchy neck
    g.lineCap = "round";
    g.lineWidth = 40;
    g.strokeStyle = color;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(mouth.x, mouth.y);
    g.stroke();

    // Two stubby horns on the outer side
    g.fillStyle = "#F4F7FB";
    for (const s of [-1, 1]) {
      const hx = bx + px * s * 36 + ca * 40;
      const hy = by + py * s * 36 + sa * 40;
      g.beginPath();
      g.moveTo(hx + px * s * 12, hy + py * s * 12);
      g.lineTo(hx - px * s * 12, hy - py * s * 12);
      g.lineTo(hx + ca * 30, hy + sa * 30);
      g.closePath();
      g.fill();
    }

    // Round body
    g.beginPath();
    g.arc(bx, by, 62, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();

    // One big eye
    const ex = bx + ca * 6;
    const ey = by + sa * 6;
    g.beginPath();
    g.arc(ex, ey, 24, 0, Math.PI * 2);
    g.fillStyle = "#F4F7FB";
    g.fill();
    if (stunned) {
      g.lineWidth = 4;
      g.strokeStyle = "#070b14";
      g.beginPath();
      g.moveTo(ex - 9, ey - 9);
      g.lineTo(ex + 9, ey + 9);
      g.moveTo(ex + 9, ey - 9);
      g.lineTo(ex - 9, ey + 9);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(ex - ca * 9, ey - sa * 9, 10, 0, Math.PI * 2);
      g.fillStyle = "#070b14";
      g.fill();
    }

    // Head: a big round mouth with teeth, facing the centre
    const open = 0.3 + ext * 0.8;
    const face = h.angle + Math.PI;
    const r = MOUTH_R * 0.8;
    g.beginPath();
    g.arc(mouth.x, mouth.y, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.beginPath();
    g.moveTo(mouth.x, mouth.y);
    g.arc(mouth.x, mouth.y, r, face - open, face + open);
    g.closePath();
    g.fillStyle = "#3a0d1c";
    g.fill();
    // Teeth on each jaw
    g.fillStyle = "#F4F7FB";
    for (const s of [-1, 1]) {
      const ja = face + s * open;
      for (const t of [0.45, 0.8]) {
        const tx = mouth.x + Math.cos(ja) * r * t;
        const ty = mouth.y + Math.sin(ja) * r * t;
        const inA = ja - s * Math.PI / 2;
        g.beginPath();
        g.moveTo(tx + Math.cos(ja) * 5, ty + Math.sin(ja) * 5);
        g.lineTo(tx - Math.cos(ja) * 5, ty - Math.sin(ja) * 5);
        g.lineTo(tx + Math.cos(inA) * 9, ty + Math.sin(inA) * 9);
        g.closePath();
        g.fill();
      }
    }

    if (stunned) {
      g.fillStyle = "#FFB020";
      g.font = "700 26px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("@#!", bx - ca * 40, by - sa * 40 + 0);
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
      y = h.seat < 2 ? 90 : height - 110;
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = h.player.color;
    g.font = "700 24px Bebas Neue, Impact, sans-serif";
    g.fillText(h.player.name, x, y);
    g.fillStyle = "#F4F7FB";
    g.font = "700 48px Bebas Neue, Impact, sans-serif";
    g.fillText(String(h.score), x, y + 38);
    const mult = streakMultiplier(h.streak);
    if (h.streak > 0) {
      g.fillStyle = mult > 1 ? "#FFD54A" : "rgba(244,247,251,0.6)";
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.fillText(mult > 1 ? `x${mult}  STREAK ${h.streak}` : `STREAK ${h.streak}`, x, y + 74);
    }
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
      out.push({ playerId: h.player.id, label: "Best streak", value: String(h.bestStreak) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
