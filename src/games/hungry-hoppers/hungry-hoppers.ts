import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
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
  DIGEST_TIME,
  DURATION_S,
  FRENZY_COUNT,
  FRENZY_TIMES,
  MARBLE_R,
  MASH_RECOVER,
  MAX_LIVE,
  MAX_MULT,
  MOUTH_R,
  OVERDRIVE_AT,
  OVERDRIVE_GOLD,
  OVERDRIVE_MULT,
  OVERDRIVE_SPAWN_INTERVAL,
  OVERDRIVE_SPEED,
  SPAWN_INTERVAL,
  STUN_TIME,
  applyEat,
  barfMarbles,
  bellyMultiplier,
  botDecide,
  botRead,
  buzzerValue,
  chompExtension,
  marblesInMouth,
  mouthCenter,
  nearMiss,
  rollKind,
  seatAngles,
  spawnMarble,
  stepMarbles,
  tiltFor,
  zoneFor,
  BELLY_STEP,
  type Marble,
  type MarbleKind,
  type Tilt,
} from "./logic";

export const hungryHoppers: GameDefinition = {
  id: "hungry-hoppers",
  name: "Chomp",
  tagline: "Eat. Hold still to gulp. Bombs make you barf it all.",
  description:
    "Marbles roll around the bowl. Tap to lunge and chomp. Everything you eat sits in your belly: " +
    "the fuller it gets, the more each marble is worth (up to x4), but a bomb makes you BARF the whole " +
    "belly back into the bowl for everyone else. Hold still for a moment to GULP it into your score. " +
    "The bowl tilts toward whoever is losing. OVERDRIVE at the end doubles everything. Gulp before the buzzer!",
  durationMs: DURATION_S * 1000,
  controls: "Tap your side of the screen to chomp. Stop tapping to gulp. Mash to shake off a bomb.",
  create: (ctx) => new Chomp(ctx),
};

const BODY_OUT = 62;
const BODY_R = 62;
const BEST_KEY = "v2";

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
  /** Food in the belly (unbanked), in the order it was eaten. */
  belly: MarbleKind[];
  /** Points the belly is worth right now. */
  bellyPts: number;
  /** Seconds spent holding still with a full belly. */
  digestT: number;
  gulpT: number;
  barfT: number;
  wobbleT: number;
  biggestGulp: number;
  barfed: number;
  /** What the current chomp has eaten so far. */
  chompFood: boolean;
  chompBomb: boolean;
  /** Seconds left on the red "whiff" flash. */
  whiffT: number;
  mashHint: boolean;
  botDelay: number;
  botBankAt: number;
  best: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

/** Fixed spots inside the body where swallowed marbles rattle around (unit circle). */
const BELLY_SPOTS: readonly { x: number; y: number }[] = Array.from({ length: 24 }, (_, i) => {
  const a = i * 2.399963; // golden angle: an even spread without randomness
  const r = 0.14 + 0.5 * Math.sqrt((i + 0.5) / 24);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
});

class Chomp implements GameInstance {
  private readonly hoppers: Hopper[];
  private readonly marbles: Marble[] = [];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly floaters: Floater[] = [];
  private readonly rand: () => number;
  /** Simulation time (pauses during hit-stop). */
  private time = 0;
  /** Wall clock in sync with the engine's timer. */
  private clock = 0;
  private spawnT = 0;
  private frenzyIdx = 0;
  /** Seconds left on the frenzy banner. */
  private frenzyT = 0;
  private overdrive = false;
  private tilt: Tilt = { seat: -1, strength: 0, gx: 0, gy: 0 };
  private over = false;
  private gulpNowShown = false;
  private lastTick = 99;

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
      belly: [],
      bellyPts: 0,
      digestT: 0,
      gulpT: 0,
      barfT: 0,
      wobbleT: 0,
      biggestGulp: 0,
      barfed: 0,
      chompFood: false,
      chompBomb: false,
      whiffT: 0,
      mashHint: false,
      botDelay: -1,
      botBankAt: 5 + Math.floor(this.rand() * 7),
      best: player.kind === "human" ? loadBest(hungryHoppers.id, BEST_KEY) : 0,
    }));
    for (let i = 0; i < 8; i++) this.marbles.push(spawnMarble(this.rand));
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 38 * realDt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i]!.life <= 0) this.floaters.splice(i, 1);
    const dt = this.juice.update(realDt);
    if (this.over) return;
    this.time += dt;
    this.clock += realDt;
    const timeLeft = DURATION_S - this.clock;

    if (timeLeft <= 0) {
      this.buzzer();
      return;
    }
    if (timeLeft <= 2.6 && !this.gulpNowShown) {
      this.gulpNowShown = true;
      this.callouts.show("GULP NOW!", "#FFB020", { size: 80, life: 1.4, y: 0.5 });
    }
    const sec = Math.ceil(timeLeft);
    if (sec <= 5 && sec < this.lastTick) {
      this.lastTick = sec;
      this.ctx.sfx.tick();
    }

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = this.overdrive ? OVERDRIVE_SPAWN_INTERVAL : SPAWN_INTERVAL;
      if (this.marbles.length < MAX_LIVE) {
        const kind = this.overdrive ? rollKind(this.rand(), OVERDRIVE_GOLD, 0.12) : rollKind(this.rand());
        this.marbles.push(spawnMarble(this.rand, kind));
      }
    }

    if (this.frenzyT > 0) this.frenzyT -= dt;
    const nextFrenzy = FRENZY_TIMES[this.frenzyIdx];
    if (nextFrenzy !== undefined && this.clock >= nextFrenzy) {
      this.frenzyIdx++;
      this.frenzyT = 2.2;
      this.wave(1);
      this.callouts.show("FRENZY!", "#FFB020", { size: 96, life: 1.6 });
      this.juice.shake(0.4);
      this.juice.burst(ARENA_X, ARENA_Y, ["#FFB020", "#F4F7FB", "#3EE0FF"], { count: 50, speed: 420, gravity: 0 });
      this.ctx.sfx.streak(3);
    }
    if (!this.overdrive && this.clock >= OVERDRIVE_AT) {
      this.overdrive = true;
      this.wave(2);
      this.callouts.show("OVERDRIVE!", "#FF3D7A", { size: 104, life: 1.8 });
      this.callouts.show("DOUBLE POINTS", "#F4F7FB", { size: 40, life: 1.8, y: 0.44 });
      this.juice.shake(0.6);
      this.juice.hitStop(0.1);
      this.juice.burst(ARENA_X, ARENA_Y, ["#FF3D7A", "#FFD54A", "#F4F7FB"], { count: 70, speed: 520, gravity: 0, life: 0.9 });
      this.ctx.sfx.go();
    }

    this.tilt = tiltFor(this.hoppers.map((h) => h.score), this.hoppers.map((h) => h.angle));
    stepMarbles(this.marbles, dt, { gx: this.tilt.gx, gy: this.tilt.gy, speedScale: this.overdrive ? OVERDRIVE_SPEED : 1 });

    for (const h of this.hoppers) {
      if (h.stunT > 0) h.stunT -= dt;
      if (h.whiffT > 0) h.whiffT -= dt;
      if (h.gulpT > 0) h.gulpT -= dt;
      if (h.barfT > 0) h.barfT -= dt;
      if (h.wobbleT > 0) h.wobbleT -= dt;
      if (h.chompT >= 0) {
        h.chompT += dt;
        if (h.chompT >= CHOMP_TIME) this.endChomp(h);
        else this.eat(h);
      }
      if (h.chompT < 0 && h.stunT <= 0 && h.belly.length > 0) {
        h.digestT += dt;
        if (h.digestT >= DIGEST_TIME) this.gulp(h);
      } else {
        h.digestT = 0;
      }
      if (h.player.kind === "bot") this.botTick(h, dt, timeLeft);
    }
  }

  /** Flood the bowl; frenzies carry a guaranteed gold, OVERDRIVE two. */
  private wave(golds: number): void {
    for (let i = 0; i < FRENZY_COUNT; i++) this.marbles.push(spawnMarble(this.rand));
    for (let i = 0; i < golds; i++) this.marbles.push(spawnMarble(this.rand, "gold"));
  }

  /** Time's up: half of every belly still counts, personal bests for human seats. */
  private buzzer(): void {
    this.over = true;
    let record: Hopper | null = null;
    for (const h of this.hoppers) {
      if (h.bellyPts > 0) {
        const half = buzzerValue(h.bellyPts);
        h.score += half;
        const p = this.labelPos(h, 44);
        this.float(p.x, p.y, `+${half} (HALF)`, "#FFB020", 30, 1.6);
        h.belly = [];
        h.bellyPts = 0;
      }
      h.chompT = -1;
      if (h.player.kind === "human" && h.score > 0 && saveBest(hungryHoppers.id, h.score, BEST_KEY)) {
        if (!record || h.score > record.score) record = h;
      }
    }
    if (record) {
      const r: Hopper = record;
      this.callouts.show(`${r.player.name}: NEW RECORD ${r.score}`, r.player.color, { size: 56, life: 2.5, y: 0.5 });
      this.juice.burst(ARENA_X, ARENA_Y, [r.player.color, "#FFD54A", "#F4F7FB"], { count: 60, speed: 480, gravity: 0, life: 1 });
    }
  }

  private bodyPos(h: Hopper): { x: number; y: number } {
    return { x: ARENA_X + Math.cos(h.angle) * (ARENA_R + BODY_OUT), y: ARENA_Y + Math.sin(h.angle) * (ARENA_R + BODY_OUT) };
  }

  private float(x: number, y: number, text: string, color: string, size = 28, life = 0.9): void {
    this.floaters.push({ x, y, text, color, life, maxLife: life, size });
  }

  /** Where a monster's own labels go: above the body, or below it for seats along the top edge. */
  private labelPos(h: Hopper, gap = 36): { x: number; y: number } {
    const b = this.bodyPos(h);
    const below = Math.sin(h.angle) < -0.1;
    return { x: b.x, y: below ? b.y + BODY_R + gap : b.y - BODY_R - gap };
  }

  private taunt(h: Hopper, text: string): void {
    // Sits one row beyond the GULP/BARF floaters so the two don't overlap.
    const p = this.labelPos(h, 74);
    this.float(p.x, p.y, text, h.player.color, 26, 1.1);
  }

  private eat(h: Hopper): void {
    const m = mouthCenter(h.angle, chompExtension(h.chompT));
    const idx = marblesInMouth(this.marbles, m.x, m.y);
    if (idx.length === 0) return;
    const kinds: MarbleKind[] = idx.map((i) => this.marbles[i]!.kind);
    for (let k = idx.length - 1; k >= 0; k--) this.marbles.splice(idx[k]!, 1);
    const before = bellyMultiplier(h.belly.length);
    const r = applyEat(kinds, before, this.overdrive ? OVERDRIVE_MULT : 1);
    h.eaten += r.eaten;
    h.golds += r.golds;
    h.bombs += r.bombs;
    if (r.food.length > 0) {
      h.chompFood = true;
      h.belly.push(...r.food);
      h.bellyPts += r.pts;
      const after = bellyMultiplier(h.belly.length);
      if (r.golds > 0) {
        this.callouts.show(`GOLD! +${r.pts}`, "#FFD54A", { size: 80, life: 1.1 });
        this.juice.shake(0.25);
        this.juice.hitStop(0.05);
        this.juice.burst(m.x, m.y, ["#FFD54A", "#FFF3B0", "#FFFFFF"], { count: 40, speed: 380, gravity: 0 });
        this.ctx.sfx.streak(2);
      } else {
        this.float(m.x, m.y - 20, `+${r.pts}`, before > 1 ? "#FFD54A" : "#F4F7FB", 24 + before * 4, 0.7);
        this.ctx.sfx.collect();
      }
      if (after > before) {
        const p = this.labelPos(h);
        this.float(p.x, p.y, `x${after}${after === MAX_MULT ? " MAX" : ""}`, "#FFD54A", 44, 1);
        this.ctx.sfx.streak(after);
      }
    }
    if (r.stunned) {
      this.barf(h, m);
    } else {
      this.juice.burst(m.x, m.y, r.golds > 0 ? ["#FFD54A", "#FFF3B0"] : [h.player.color, "#F4F7FB"], {
        count: 8 + r.eaten * 4,
        speed: 200,
        gravity: 0,
        life: 0.4,
      });
    }
  }

  /** A bomb: the whole belly sprays back into the bowl and the monster is stunned (mash to recover). */
  private barf(h: Hopper, mouth: { x: number; y: number }): void {
    const lost = h.bellyPts;
    const out = barfMarbles(h.belly, mouth.x, mouth.y, h.angle, this.rand);
    this.marbles.push(...out);
    h.barfed += lost;
    h.belly = [];
    h.bellyPts = 0;
    h.digestT = 0;
    h.stunT = STUN_TIME;
    h.chompBomb = true;
    h.barfT = 0.5;
    h.mashHint = false;
    this.endChomp(h);
    const p = this.labelPos(h, 40);
    if (lost > 0) {
      this.float(p.x, p.y, `BARF! -${lost}`, "#FF3D7A", 44, 1.3);
      this.juice.shake(0.5);
      this.juice.hitStop(0.08);
      this.ctx.sfx.hit();
      this.ctx.sfx.miss();
      // A rival bot gloats over the free lunch.
      const rivals = this.hoppers.filter((o) => o !== h && o.player.kind === "bot" && o.stunT <= 0);
      const gloat = rivals[Math.floor(this.rand() * rivals.length)];
      if (gloat && this.rand() < 0.6) this.taunt(gloat, out.length > 6 ? "FREE LUNCH!" : "MINE!");
    } else {
      this.float(p.x, p.y, "BOMB!", "#FF3D7A", 34, 1);
      this.juice.shake(0.35);
      this.ctx.sfx.hit();
    }
    this.juice.burst(mouth.x, mouth.y, ["#FF3D7A", "#FFB020", "#2a2a3a"], { count: 30, speed: 320, gravity: 200 });
  }

  /** Held still long enough: the belly is banked. */
  private gulp(h: Hopper): void {
    const pts = h.bellyPts;
    const count = h.belly.length;
    h.score += pts;
    h.biggestGulp = Math.max(h.biggestGulp, pts);
    h.belly = [];
    h.bellyPts = 0;
    h.digestT = 0;
    h.gulpT = 0.35;
    h.botBankAt = 5 + Math.floor(this.rand() * 7);
    const b = this.bodyPos(h);
    const p = this.labelPos(h);
    this.float(p.x, p.y, `GULP +${pts}`, h.player.color, pts >= 30 ? 48 : 34, 1.1);
    this.juice.burst(b.x, b.y, [h.player.color, "#F4F7FB"], { count: 10 + count, speed: 180, gravity: 0, life: 0.5 });
    this.ctx.sfx.streak(Math.min(6, 1 + Math.floor(pts / 10)));
    if (pts >= 40) {
      this.callouts.show(`${h.player.name} BIG GULP +${pts}`, h.player.color, { size: 56, life: 1.2, y: 0.2 });
      this.juice.shake(0.2);
    }
    if (h.player.kind === "bot" && pts >= 20 && this.rand() < 0.5) this.taunt(h, "YUM!");
  }

  /** Close out a chomp. A whiff flashes red and may earn a "SO CLOSE". */
  private endChomp(h: Hopper): void {
    h.chompT = -1;
    if (!h.chompFood && !h.chompBomb) {
      h.whiffT = 0.4;
      const m = mouthCenter(h.angle, 1);
      if (nearMiss(this.marbles, h.angle)) this.float(m.x, m.y - 30, "SO CLOSE", "#FFB020", 26, 0.8);
      this.ctx.sfx.miss();
    }
    h.chompFood = false;
    h.chompBomb = false;
  }

  private chomp(h: Hopper): void {
    if (h.chompT >= 0) return;
    if (h.stunT > 0) {
      // Mash to shake off the stun.
      h.stunT -= MASH_RECOVER;
      h.wobbleT = 0.12;
      this.ctx.sfx.tick();
      if (!h.mashHint) {
        h.mashHint = true;
        const p = this.labelPos(h, 24);
        this.float(p.x, p.y, "MASH!", "#FFB020", 26, 0.8);
      }
      return;
    }
    h.chompT = 0;
    h.digestT = 0;
    this.ctx.sfx.whoosh();
  }

  private botTick(h: Hopper, dt: number, timeLeft: number): void {
    if (h.chompT >= 0) {
      h.botDelay = -1;
      return;
    }
    if (h.stunT > 0) {
      // Bots mash too, about four taps a second.
      if (this.rand() < dt * 4) this.chomp(h);
      h.botDelay = -1;
      return;
    }
    if (h.botDelay >= 0) {
      h.botDelay -= dt;
      if (h.botDelay < 0) this.chomp(h);
      return;
    }
    const decision = botDecide({
      read: botRead(this.marbles, h.angle),
      belly: h.belly.length,
      bankAt: h.botBankAt,
      timeLeft,
      roll: this.rand(),
    });
    if (decision === "chomp") {
      // Reaction delay, with the odd hesitation.
      h.botDelay = 0.08 + this.rand() * 0.22 + (this.rand() < 0.12 ? 0.25 : 0);
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
    if (this.over) return;
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

    this.drawBowl(g);
    for (const m of this.marbles) this.drawMarble(g, m);
    for (const h of this.hoppers) this.drawMonster(g, h);

    this.juice.end(g);
    for (const h of this.hoppers) this.drawScore(g, h);
    if (this.frenzyT > 0) this.drawBanner(g, "#FFB020", "FRENZY WAVE  -  EAT EVERYTHING");
    else if (this.overdrive && !this.over) this.drawBanner(g, "#FF3D7A", "OVERDRIVE  -  DOUBLE POINTS  -  GULP BEFORE THE BUZZER");
    this.drawFloaters(g);
    this.callouts.draw(g, width, height);
  }

  private drawBowl(g: CanvasRenderingContext2D): void {
    const frenzy = this.frenzyT > 0;
    const t = this.tilt;
    g.beginPath();
    g.arc(ARENA_X, ARENA_Y, ARENA_R, 0, Math.PI * 2);
    g.fillStyle = frenzy ? "#2a1f3a" : this.overdrive ? "#2a1526" : "#14243a";
    g.fill();
    if (t.strength > 0) {
      // Downhill shading + chevrons rolling toward the trailing player.
      const ca = Math.cos(Math.atan2(t.gy, t.gx));
      const sa = Math.sin(Math.atan2(t.gy, t.gx));
      const grad = g.createLinearGradient(
        ARENA_X - ca * ARENA_R, ARENA_Y - sa * ARENA_R,
        ARENA_X + ca * ARENA_R, ARENA_Y + sa * ARENA_R,
      );
      grad.addColorStop(0, `rgba(244,247,251,${0.09 * t.strength})`);
      grad.addColorStop(0.5, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${0.45 * t.strength})`);
      g.fillStyle = grad;
      g.fill();
      const low = this.hoppers[t.seat];
      g.save();
      g.beginPath();
      g.arc(ARENA_X, ARENA_Y, ARENA_R - 6, 0, Math.PI * 2);
      g.clip();
      g.strokeStyle = low ? low.player.color : "#F4F7FB";
      g.globalAlpha = 0.18 + 0.3 * t.strength;
      g.lineWidth = 3;
      g.lineCap = "round";
      const px = -sa;
      const py = ca;
      const speed = 90 + 90 * t.strength;
      for (let lane = -2; lane <= 2; lane++) {
        for (let k = 0; k < 4; k++) {
          const along = (((this.time * speed + k * 170 + lane * 40) % 680) + 680) % 680 - 340;
          const cx = ARENA_X + ca * along + px * lane * 95;
          const cy = ARENA_Y + sa * along + py * lane * 95;
          g.beginPath();
          g.moveTo(cx - ca * 12 - px * 12, cy - sa * 12 - py * 12);
          g.lineTo(cx + ca * 6, cy + sa * 6);
          g.lineTo(cx - ca * 12 + px * 12, cy - sa * 12 + py * 12);
          g.stroke();
        }
      }
      g.restore();
      if (low) {
        const b = this.bodyPos(low);
        g.font = "700 20px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = low.player.color;
        g.globalAlpha = 0.5 + 0.5 * t.strength;
        g.fillText("TILT", ARENA_X + (b.x - ARENA_X) * 0.4, ARENA_Y + (b.y - ARENA_Y) * 0.4);
        g.globalAlpha = 1;
      }
    }
    g.lineWidth = 10;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 14);
    g.strokeStyle = frenzy ? "#FFB020" : this.overdrive ? `rgba(255,61,122,${0.55 + 0.45 * pulse})` : "#2b4664";
    g.beginPath();
    g.arc(ARENA_X, ARENA_Y, ARENA_R, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(ARENA_X, ARENA_Y, 40, 0, Math.PI * 2);
    g.fillStyle = "rgba(244,247,251,0.05)";
    g.fill();
  }

  private drawBanner(g: CanvasRenderingContext2D, color: string, text: string): void {
    const { width } = this.ctx;
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 18);
    g.save();
    g.globalAlpha = 0.85 * pulse;
    g.fillStyle = color;
    g.fillRect(0, 32, width, 34);
    g.restore();
    g.fillStyle = "#070b14";
    g.font = "700 26px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, width / 2, 50);
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const f of this.floaters) {
      const t = 1 - f.life / f.maxLife;
      const pop = t < 0.15 ? 0.7 + (t / 0.15) * 0.4 : 1.1 - (t - 0.15) * 0.12;
      g.save();
      g.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.35));
      g.translate(f.x, f.y);
      g.scale(pop, pop);
      g.font = `700 ${f.size}px Bebas Neue, Impact, sans-serif`;
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
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

  /** A round one-eyed monster on the rim; its mouth lunges in on a stretchy neck; its belly shows what it ate. */
  private drawMonster(g: CanvasRenderingContext2D, h: Hopper): void {
    const stunned = h.stunT > 0;
    const color = stunned ? "#6b6f7a" : h.whiffT > 0 ? "#FF3D7A" : h.player.color;
    const ext = h.chompT >= 0 ? chompExtension(h.chompT) : 0;
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const b = this.bodyPos(h);
    const bx = b.x + (h.wobbleT > 0 ? Math.sin(this.time * 60) * 6 : 0);
    const by = b.y + (h.wobbleT > 0 ? Math.cos(this.time * 50) * 4 : 0);
    const mouth = mouthCenter(h.angle, ext);
    const count = h.belly.length;
    // Belly swells with every marble; a gulp squeezes it, a barf deflates it with a wobble.
    let bodyR = BODY_R * (1 + Math.min(24, count) * 0.016);
    if (h.gulpT > 0) bodyR *= 1 + 0.22 * Math.sin((h.gulpT / 0.35) * Math.PI);
    if (h.barfT > 0) bodyR *= 1 - 0.12 * Math.sin((h.barfT / 0.5) * Math.PI);
    const squash = 1 - 0.14 * ext;

    // Stretchy neck
    g.lineCap = "round";
    g.lineWidth = 40;
    g.strokeStyle = color;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(mouth.x, mouth.y);
    g.stroke();

    // Body in a local frame: +x points away from the bowl.
    g.save();
    g.translate(bx, by);
    g.rotate(h.angle);
    g.scale(squash, 2 - squash);

    // Two stubby horns on the outer side
    g.fillStyle = "#F4F7FB";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(bodyR * 0.65, s * (bodyR * 0.58 + 12));
      g.lineTo(bodyR * 0.65, s * (bodyR * 0.58 - 12));
      g.lineTo(bodyR * 0.65 + 30, s * bodyR * 0.58);
      g.closePath();
      g.fill();
    }

    g.beginPath();
    g.arc(0, 0, bodyR, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();

    // Swallowed marbles rattling inside the belly
    if (count > 0) {
      g.save();
      g.beginPath();
      g.arc(0, 0, bodyR - 4, 0, Math.PI * 2);
      g.clip();
      for (let i = 0; i < Math.min(count, BELLY_SPOTS.length); i++) {
        const s = BELLY_SPOTS[i]!;
        const kind = h.belly[i] ?? "normal";
        const jx = Math.sin(this.time * 9 + i * 1.7) * 3;
        const jy = Math.cos(this.time * 7 + i * 2.3) * 3;
        g.beginPath();
        g.arc(s.x * bodyR + jx, s.y * bodyR + jy, 8, 0, Math.PI * 2);
        g.fillStyle = kind === "gold" ? "rgba(255,213,74,0.85)" : "rgba(244,247,251,0.55)";
        g.fill();
      }
      g.restore();
      // Digest ring: fills while the monster holds still, then GULP.
      if (h.digestT > 0) {
        g.beginPath();
        g.arc(0, 0, bodyR + 10, -Math.PI / 2, -Math.PI / 2 + (h.digestT / DIGEST_TIME) * Math.PI * 2);
        g.lineWidth = 6;
        g.strokeStyle = "#FFD54A";
        g.stroke();
      }
    }

    // One big eye, pupil toward the bowl
    g.beginPath();
    g.arc(6, 0, 24, 0, Math.PI * 2);
    g.fillStyle = "#F4F7FB";
    g.fill();
    if (stunned) {
      g.lineWidth = 4;
      g.strokeStyle = "#070b14";
      g.beginPath();
      g.moveTo(-3, -9);
      g.lineTo(15, 9);
      g.moveTo(15, -9);
      g.lineTo(-3, 9);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(-3, 0, 10, 0, Math.PI * 2);
      g.fillStyle = "#070b14";
      g.fill();
    }
    g.restore();

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
      g.fillText("@#!", bx - ca * 40, by - sa * 40);
    }
  }

  private drawScore(g: CanvasRenderingContext2D, h: Hopper): void {
    const { width, height } = this.ctx;
    const n = this.hoppers.length;
    let x: number;
    let y: number;
    if (n <= 2) {
      x = h.seat === 0 ? 100 : width - 100;
      y = height / 2 - 170;
    } else {
      x = h.seat % 2 === 0 ? 100 : width - 100;
      y = h.seat < 2 ? 96 : height - 130;
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = h.player.color;
    g.font = "700 24px Bebas Neue, Impact, sans-serif";
    g.fillText(h.player.name, x, y);
    g.fillStyle = "#F4F7FB";
    g.font = "700 48px Bebas Neue, Impact, sans-serif";
    g.fillText(String(h.score), x, y + 38);
    const count = h.belly.length;
    const mult = bellyMultiplier(count);
    const barW = 128;
    const barY = y + 70;
    if (count > 0) {
      g.fillStyle = mult > 1 ? "#FFD54A" : "rgba(244,247,251,0.75)";
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.fillText(`BELLY +${h.bellyPts}   x${mult}`, x, barY);
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.fillRect(x - barW / 2, barY + 16, barW, 8);
      const frac = mult >= MAX_MULT ? 1 : (count % BELLY_STEP) / BELLY_STEP;
      g.fillStyle = mult >= MAX_MULT ? "#FF3D7A" : "#FFD54A";
      g.fillRect(x - barW / 2, barY + 16, barW * frac, 8);
    } else if (h.player.kind === "human" && h.best > 0) {
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = "700 20px Bebas Neue, Impact, sans-serif";
      g.fillText(`BEST ${h.best}`, x, barY);
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
      out.push({ playerId: h.player.id, label: "Biggest gulp", value: String(h.biggestGulp) });
      out.push({ playerId: h.player.id, label: "Barfed away", value: String(h.barfed) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
