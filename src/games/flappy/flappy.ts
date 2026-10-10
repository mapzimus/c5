import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";

export const flappyRace: GameDefinition = {
  id: "flappy-race",
  name: "Sky Dash",
  tagline: "Tap to climb. Thread the gates. Outlast everyone.",
  description:
    "Everyone flies a jet in their own lane. Tap to climb, let go to drop. " +
    "Fly through the gaps in the neon gates. Touch a gate, the floor or the ceiling and you're out. " +
    "Grab coins for points, skim a gate edge for a bonus, and snag power-ups: " +
    "a shield takes one hit for you, a ghost lets you fly through gates for a few seconds. " +
    "It gets faster the longer you last. Last jet flying wins.",
  durationMs: 0,
  controls: "Tap your lane to climb",
  create: (ctx) => new FlappyRace(ctx),
};

const JET_RADIUS = 16;
const GRAVITY = 900;
const FLAP_VEL = -320;
const GATE_WIDTH = 52;
const GATE_GAP_START = 180;
const GATE_GAP_MIN = 120;
const GATE_GAP_FLOOR = 108;
const SPEED_START = 180;
const SPEED_MAX = 340;
/** After the first minute the speed keeps creeping up, to this hard cap. */
const SPEED_OVERDRIVE = 460;
const SPEED_OVERDRIVE_RATE = 3;
const GATE_INTERVAL_START = 1.8;
const GATE_INTERVAL_MIN = 1.0;
const TOP_PAD = 40;
const COIN_RADIUS = 10;
const PICKUP_RADIUS = 14;
const COIN_CHANCE = 0.6;
const PICKUP_CHANCE = 0.12;
/** Clearance (px) between jet edge and gate edge that counts as a skim. */
const NEAR_MISS = 9;
const GHOST_TIME = 3;
const SHIELD_GRACE = 1;
const POINTS_GATE = 1;
const POINTS_COIN = 2;
const POINTS_SKIM = 3;
const SPEED_STEP = 20;

type ItemKind = "coin" | "shield" | "ghost";

interface Gate {
  x: number;
  gapY: number;
  gapH: number;
  scored: boolean;
  /** Smallest clearance to a gap edge while the jet was inside this gate. */
  minClear: number;
  /** Jet phased through or was shielded on this gate (no skim bonus). */
  touched: boolean;
}

interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  taken: boolean;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface Lane {
  player: Player;
  x: number;
  y: number;
  width: number;
  bird: { y: number; vy: number };
  pipes: Gate[];
  items: Item[];
  alive: boolean;
  deathTime: number;
  score: number;
  gates: number;
  coins: number;
  skims: number;
  shield: boolean;
  ghost: number;
  grace: number;
  pipeTimer: number;
  flapCount: number;
  botTimer: number;
}

class FlappyRace implements GameInstance {
  private readonly lanes: Lane[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private floaters: Floater[] = [];
  private time = 0;
  private speed = SPEED_START;
  private speedStep = 0;
  private finished = false;
  private finishTimer = 0;
  private aliveCount: number;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    const laneW = ctx.width / n;

    this.lanes = ctx.players.map((player, i) => ({
      player,
      x: i * laneW,
      y: TOP_PAD,
      width: laneW,
      bird: { y: (ctx.height - TOP_PAD) / 2 + TOP_PAD, vy: 0 },
      pipes: [],
      items: [],
      alive: true,
      deathTime: 0,
      score: 0,
      gates: 0,
      coins: 0,
      skims: 0,
      shield: false,
      ghost: 0,
      grace: 0,
      pipeTimer: 1.5,
      flapCount: 0,
      botTimer: 0,
    }));

    this.aliveCount = n;

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 40 * realDt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    const dt = this.juice.update(realDt);
    this.time += dt;

    if (this.finished) {
      this.finishTimer -= realDt;
      return;
    }

    const progress = Math.min(1, this.time / 60);
    const overdrive = Math.max(0, this.time - 60);
    this.speed = Math.min(
      SPEED_OVERDRIVE,
      SPEED_START + (SPEED_MAX - SPEED_START) * progress + overdrive * SPEED_OVERDRIVE_RATE,
    );
    const gap = Math.max(
      GATE_GAP_FLOOR,
      GATE_GAP_START - (GATE_GAP_START - GATE_GAP_MIN) * progress - overdrive * 0.2,
    );
    const interval = GATE_INTERVAL_START - (GATE_INTERVAL_START - GATE_INTERVAL_MIN) * progress;

    // Tell everyone when it gets faster.
    const step = Math.floor((this.speed - SPEED_START) / SPEED_STEP / 2);
    if (step > this.speedStep) {
      this.speedStep = step;
      this.callouts.show("SPEED UP!", "#3EE0FF", { size: 40, life: 0.9, y: 0.18 });
      this.ctx.sfx.go();
    }

    for (const lane of this.lanes) {
      if (!lane.alive) continue;
      const jetX = lane.x + lane.width * 0.3;

      lane.ghost = Math.max(0, lane.ghost - dt);
      lane.grace = Math.max(0, lane.grace - dt);

      lane.bird.vy += GRAVITY * dt;
      lane.bird.y += lane.bird.vy * dt;

      const top = TOP_PAD + JET_RADIUS;
      const bottom = this.ctx.height - JET_RADIUS;
      if (lane.bird.y < top || lane.bird.y > bottom) {
        if (lane.grace > 0 || lane.shield) {
          // Shield bounces you off the edge instead of ending the run.
          if (lane.grace <= 0) this.breakShield(lane, jetX);
          const hitFloor = lane.bird.y > bottom;
          lane.bird.y = hitFloor ? bottom : top;
          lane.bird.vy = hitFloor ? FLAP_VEL : 60;
        } else {
          this.killBird(lane);
          continue;
        }
      }

      lane.pipeTimer -= dt;
      if (lane.pipeTimer <= 0) {
        lane.pipeTimer = interval + this.ctx.rng.float(-0.2, 0.2);
        this.spawnGate(lane, gap);
      }

      for (const gate of lane.pipes) {
        gate.x -= this.speed * dt;

        const inside = jetX + JET_RADIUS > gate.x && jetX - JET_RADIUS < gate.x + GATE_WIDTH;
        if (inside) {
          const y = lane.bird.y;
          const clearTop = y - JET_RADIUS - (gate.gapY - gate.gapH / 2);
          const clearBot = gate.gapY + gate.gapH / 2 - (y + JET_RADIUS);
          const clear = Math.min(clearTop, clearBot);
          if (clear < 0) {
            if (lane.ghost > 0 || lane.grace > 0) {
              gate.touched = true;
            } else if (lane.shield) {
              gate.touched = true;
              this.breakShield(lane, jetX);
            } else {
              this.killBird(lane);
              break;
            }
          } else {
            gate.minClear = Math.min(gate.minClear, clear);
          }
        }

        if (!gate.scored && gate.x + GATE_WIDTH < jetX - JET_RADIUS) {
          gate.scored = true;
          lane.gates++;
          lane.score += POINTS_GATE;
          if (!gate.touched && gate.minClear < NEAR_MISS) {
            lane.skims++;
            lane.score += POINTS_SKIM;
            this.floater(jetX, lane.bird.y - 28, `SKIM +${POINTS_SKIM}`, "#FF3D7A");
            this.juice.burst(jetX, lane.bird.y, ["#FF3D7A", "#ffffff"], {
              count: 10, speed: 180, gravity: 0, life: 0.35, size: 3,
            });
            this.juice.shake(0.08);
            this.ctx.sfx.streak(Math.min(6, 1 + Math.floor(lane.skims / 3)));
          } else if (lane.gates % 10 === 0) {
            this.ctx.sfx.streak(lane.gates / 10);
          } else {
            this.ctx.sfx.tick();
          }
        }
      }
      if (!lane.alive) continue;

      for (const item of lane.items) {
        item.x -= this.speed * dt;
        if (item.taken) continue;
        const r = item.kind === "coin" ? COIN_RADIUS : PICKUP_RADIUS;
        const dx = item.x - jetX;
        const dy = item.y - lane.bird.y;
        if (dx * dx + dy * dy < (r + JET_RADIUS) * (r + JET_RADIUS)) {
          item.taken = true;
          this.collect(lane, item);
        }
      }

      lane.pipes = lane.pipes.filter((p) => p.x + GATE_WIDTH > lane.x - 20);
      lane.items = lane.items.filter((it) => !it.taken && it.x > lane.x - 20);

      if (lane.player.kind === "bot") this.botTick(lane, dt);
    }

    const alive = this.lanes.filter((l) => l.alive);
    this.aliveCount = alive.length;
    if (this.aliveCount <= (this.lanes.length === 1 ? 0 : 1)) {
      this.finished = true;
      this.finishTimer = 1.5;
      if (alive.length === 1) {
        this.callouts.show(
          `${alive[0]!.player.name} WINS!`,
          alive[0]!.player.color,
          { size: 64 },
        );
        this.ctx.sfx.win();
      } else {
        this.callouts.show("WIPEOUT!", "#FF3D7A", { size: 64 });
        this.ctx.sfx.miss();
      }
    }
  }

  private spawnGate(lane: Lane, gap: number): void {
    const rng = this.ctx.rng;
    const minY = TOP_PAD + gap / 2 + 30;
    const maxY = this.ctx.height - gap / 2 - 30;
    const gate: Gate = {
      x: lane.x + lane.width + GATE_WIDTH,
      gapY: rng.float(minY, maxY),
      gapH: gap,
      scored: false,
      minClear: Infinity,
      touched: false,
    };
    lane.pipes.push(gate);

    const roll = rng.next();
    const cx = gate.x + GATE_WIDTH / 2;
    if (roll < PICKUP_CHANCE) {
      // Power-ups sit a bit ahead of the gate, in the middle of the gap.
      const kind: ItemKind = rng.next() < 0.5 ? "shield" : "ghost";
      lane.items.push({ kind, x: cx - 110, y: gate.gapY, taken: false });
    } else if (roll < PICKUP_CHANCE + COIN_CHANCE) {
      // Coins sit off-center in the gap, so grabbing one means flying closer to an edge.
      const off = gate.gapH / 2 - JET_RADIUS - 4;
      lane.items.push({ kind: "coin", x: cx, y: gate.gapY + rng.float(-off, off), taken: false });
    }
  }

  private collect(lane: Lane, item: Item): void {
    const jetX = lane.x + lane.width * 0.3;
    if (item.kind === "coin") {
      lane.coins++;
      lane.score += POINTS_COIN;
      this.floater(item.x, item.y - 18, `+${POINTS_COIN}`, "#FFB020");
      this.juice.burst(item.x, item.y, ["#FFB020", "#FFE38A"], {
        count: 8, speed: 140, gravity: 0, life: 0.3, size: 3,
      });
      this.ctx.sfx.collect();
    } else if (item.kind === "shield") {
      lane.shield = true;
      this.floater(jetX, lane.bird.y - 28, "SHIELD", "#3EE0FF");
      this.juice.burst(jetX, lane.bird.y, "#3EE0FF", { count: 14, speed: 200, gravity: 0, life: 0.4 });
      this.ctx.sfx.select();
    } else {
      lane.ghost = GHOST_TIME;
      this.floater(jetX, lane.bird.y - 28, "GHOST", "#C9B8FF");
      this.juice.burst(jetX, lane.bird.y, "#C9B8FF", { count: 14, speed: 200, gravity: 0, life: 0.4 });
      this.ctx.sfx.select();
    }
  }

  private breakShield(lane: Lane, jetX: number): void {
    lane.shield = false;
    lane.grace = SHIELD_GRACE;
    this.juice.shake(0.25);
    this.juice.burst(jetX, lane.bird.y, ["#3EE0FF", "#ffffff"], {
      count: 22, speed: 260, gravity: 200, life: 0.5,
    });
    this.floater(jetX, lane.bird.y - 28, "SAVED!", "#3EE0FF");
    this.ctx.sfx.hit();
  }

  private floater(x: number, y: number, text: string, color: string): void {
    this.floaters.push({ x, y, text, color, life: 0.8 });
  }

  private killBird(lane: Lane): void {
    lane.alive = false;
    lane.deathTime = this.time;
    this.juice.shake(0.3);
    this.juice.burst(
      lane.x + lane.width * 0.3,
      lane.bird.y,
      [lane.player.color, "#FF3D7A", "#ffffff"],
      { count: 30, speed: 300, gravity: 500, life: 0.6 },
    );
    this.ctx.sfx.hit();
    this.callouts.show(
      `${lane.player.name} OUT!`,
      "#FF3D7A",
      { size: 48, life: 0.8 },
    );
  }

  private botTick(lane: Lane, dt: number): void {
    lane.botTimer += dt;
    if (lane.botTimer < 0.06) return;
    lane.botTimer = 0;

    const jetX = lane.x + lane.width * 0.3;
    const nextGate = lane.pipes.find(
      (p) => p.x + GATE_WIDTH > jetX - JET_RADIUS,
    );
    let targetY = this.ctx.height * 0.55;
    if (nextGate) {
      // A flap lifts ~57px, so the lowest safe point sits ~78px under the gap top.
      const lo = nextGate.gapY - nextGate.gapH / 2 + 78;
      const hi = nextGate.gapY + nextGate.gapH / 2 - 22;
      targetY = Math.min(hi, Math.max(lo, nextGate.gapY + 18));
      // Drift toward a coin or power-up when it's reachable inside that safe band.
      const item = lane.items.find((it) => !it.taken && it.x > jetX && it.x < nextGate.x + GATE_WIDTH);
      if (item) targetY = Math.min(hi, Math.max(lo, item.y + 18));
    }
    // Bots get sloppier as the speed climbs, so races still end.
    const sloppy = 0.01 + 0.08 * ((this.speed - SPEED_START) / (SPEED_OVERDRIVE - SPEED_START));
    if (this.ctx.rng.next() < sloppy) return;
    // A flap always lifts ~57px, so only flap once we've dropped to the target.
    if (lane.bird.y > targetY && lane.bird.vy > -40) this.flap(lane);
  }

  private flap(lane: Lane): void {
    if (!lane.alive) return;
    lane.bird.vy = FLAP_VEL;
    lane.flapCount++;
    this.ctx.sfx.whoosh();
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
    for (const lane of this.lanes) {
      if (lane.player.kind !== "human") continue;
      if (p.x >= lane.x && p.x < lane.x + lane.width) {
        e.preventDefault();
        this.flap(lane);
        return;
      }
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    for (const lane of this.lanes) this.drawLane(g, lane);

    this.juice.end(g);

    for (const f of this.floaters) {
      g.save();
      g.globalAlpha = Math.min(1, f.life / 0.3);
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
      g.restore();
    }

    this.callouts.draw(g, width, height);
  }

  private drawLane(g: CanvasRenderingContext2D, lane: Lane): void {
    const { player, x: lx, y: ly, width: lw } = lane;
    const h = this.ctx.height;

    g.save();
    g.beginPath();
    g.rect(lx, 0, lw, h);
    g.clip();

    g.fillStyle = "rgba(244,247,251,0.015)";
    g.fillRect(lx, 0, lw, h);

    // Speed streaks: more visible as the race speeds up.
    if (lane.alive) {
      const fast = (this.speed - SPEED_START) / (SPEED_OVERDRIVE - SPEED_START);
      g.strokeStyle = `rgba(244,247,251,${0.04 + fast * 0.1})`;
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const sy = ly + ((i * 97.3) % (h - ly));
        const sx = lx + lw - ((this.time * this.speed * (0.6 + (i % 3) * 0.2) + i * 173) % (lw + 80));
        g.moveTo(sx, sy);
        g.lineTo(sx + 30 + fast * 50, sy);
      }
      g.stroke();
    }

    g.strokeStyle = "rgba(244,247,251,0.06)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(lx + lw, 0);
    g.lineTo(lx + lw, h);
    g.stroke();

    // Neon gates: dark slabs with glowing rims on the gap.
    const rim = lane.alive ? (lane.ghost > 0 ? "rgba(201,184,255,0.5)" : "#B45CFF") : "#3a3a4a";
    const slab = lane.alive ? "#1b1030" : "#22222e";
    for (const gate of lane.pipes) {
      const gapTop = gate.gapY - gate.gapH / 2;
      const gapBot = gate.gapY + gate.gapH / 2;

      g.fillStyle = slab;
      g.fillRect(gate.x, ly, GATE_WIDTH, gapTop - ly);
      g.fillRect(gate.x, gapBot, GATE_WIDTH, h - gapBot);

      g.fillStyle = rim;
      g.fillRect(gate.x, ly, 3, gapTop - ly);
      g.fillRect(gate.x, gapBot, 3, h - gapBot);
      g.globalAlpha = 0.25;
      g.fillRect(gate.x - 4, gapTop - 10, GATE_WIDTH + 8, 10);
      g.fillRect(gate.x - 4, gapBot, GATE_WIDTH + 8, 10);
      g.globalAlpha = 1;
      g.fillRect(gate.x - 2, gapTop - 4, GATE_WIDTH + 4, 4);
      g.fillRect(gate.x - 2, gapBot, GATE_WIDTH + 4, 4);
    }

    for (const item of lane.items) this.drawItem(g, item);

    const jetX = lx + lw * 0.3;
    if (lane.alive) {
      const angle = Math.min(0.5, Math.max(-0.4, lane.bird.vy / 600));
      const r = JET_RADIUS;
      g.save();
      g.translate(jetX, lane.bird.y);

      // Exhaust flame flickers behind the jet.
      const flame = 0.7 + 0.3 * Math.sin(this.time * 40);
      g.save();
      g.rotate(angle);
      g.beginPath();
      g.moveTo(-r * 0.7, -r * 0.25);
      g.lineTo(-r * (1.3 + flame * 0.6), 0);
      g.lineTo(-r * 0.7, r * 0.25);
      g.closePath();
      g.fillStyle = "#FFB020";
      g.fill();

      if (lane.ghost > 0) {
        g.globalAlpha = lane.ghost < 0.8 && Math.floor(this.time * 12) % 2 === 0 ? 0.2 : 0.45;
      } else if (lane.grace > 0 && Math.floor(this.time * 14) % 2 === 0) {
        g.globalAlpha = 0.4;
      }

      // Dart-shaped jet body.
      g.beginPath();
      g.moveTo(r * 1.15, 0);
      g.lineTo(-r * 0.8, -r * 0.85);
      g.lineTo(-r * 0.45, 0);
      g.lineTo(-r * 0.8, r * 0.85);
      g.closePath();
      g.fillStyle = player.color;
      g.fill();
      g.beginPath();
      g.moveTo(r * 1.15, 0);
      g.lineTo(-r * 0.45, 0);
      g.lineTo(-r * 0.8, r * 0.85);
      g.closePath();
      g.fillStyle = "rgba(7,11,20,0.25)";
      g.fill();
      g.beginPath();
      g.arc(r * 0.25, -r * 0.12, r * 0.18, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,0.8)";
      g.fill();
      g.restore();

      if (lane.shield) {
        g.beginPath();
        g.arc(0, 0, r + 7, 0, Math.PI * 2);
        g.strokeStyle = "#3EE0FF";
        g.lineWidth = 3;
        g.globalAlpha = 0.6 + 0.3 * Math.sin(this.time * 6);
        g.stroke();
        g.globalAlpha = 1;
      }

      g.restore();
    } else {
      g.save();
      g.globalAlpha = 0.3;
      g.fillStyle = player.color;
      g.font = "700 28px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("OUT", jetX, h / 2);
      g.restore();
    }

    g.fillStyle = player.color;
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillText(player.name, lx + lw / 2, 6);

    g.fillStyle = "#F4F7FB";
    g.font = "700 28px Bebas Neue, Impact, sans-serif";
    g.fillText(String(lane.score), lx + lw / 2, 24);

    g.restore();
  }

  private drawItem(g: CanvasRenderingContext2D, item: Item): void {
    if (item.taken) return;
    const bob = Math.sin(this.time * 5 + item.x * 0.05) * 3;
    const y = item.y + bob;
    if (item.kind === "coin") {
      const squash = Math.abs(Math.cos(this.time * 4 + item.x * 0.03));
      g.beginPath();
      g.ellipse(item.x, y, COIN_RADIUS * (0.35 + 0.65 * squash), COIN_RADIUS, 0, 0, Math.PI * 2);
      g.fillStyle = "#FFB020";
      g.fill();
      g.strokeStyle = "#FFE38A";
      g.lineWidth = 2;
      g.stroke();
      return;
    }
    const color = item.kind === "shield" ? "#3EE0FF" : "#C9B8FF";
    g.beginPath();
    g.arc(item.x, y, PICKUP_RADIUS, 0, Math.PI * 2);
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = color;
    g.font = "700 18px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(item.kind === "shield" ? "S" : "G", item.x, y + 1);
  }

  isFinished(): boolean {
    return this.finished && this.finishTimer <= 0;
  }

  getScores(): { playerId: string; score: number }[] {
    const sorted = [...this.lanes].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (!a.alive && !b.alive) return b.deathTime - a.deathTime;
      return b.score - a.score;
    });
    // Survival decides the order; points break nothing but show who flew best.
    return sorted.map((lane, i) => ({
      playerId: lane.player.id,
      score: (sorted.length - i) * 10000 + lane.score,
    }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const lane of this.lanes) {
      out.push({ playerId: lane.player.id, label: "Gates cleared", value: String(lane.gates) });
      out.push({ playerId: lane.player.id, label: "Coins", value: String(lane.coins) });
      out.push({ playerId: lane.player.id, label: "Skims", value: String(lane.skims) });
      out.push({ playerId: lane.player.id, label: "Taps", value: String(lane.flapCount) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
