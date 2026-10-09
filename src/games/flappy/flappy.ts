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
  name: "Flappy Race",
  tagline: "Tap to flap. Last bird wins.",
  description:
    "Each player controls a bird in their own lane. Tap your zone to flap upward. " +
    "Pipes scroll from the right — hit one and you're out. " +
    "Last bird alive wins. If everyone dies, whoever lasted longest scores highest. " +
    "Pipes get faster and gaps get tighter as the race goes on.",
  durationMs: 0,
  controls: "Tap your lane to flap",
  create: (ctx) => new FlappyRace(ctx),
};

const BIRD_RADIUS = 16;
const GRAVITY = 900;
const FLAP_VEL = -320;
const PIPE_WIDTH = 52;
const PIPE_GAP_START = 180;
const PIPE_GAP_MIN = 120;
const PIPE_SPEED_START = 180;
const PIPE_SPEED_MAX = 340;
const PIPE_INTERVAL_START = 1.8;
const PIPE_INTERVAL_MIN = 1.0;
const TOP_PAD = 40;

interface Pipe {
  x: number;
  gapY: number;
  gapH: number;
  scored: boolean;
}

interface Lane {
  player: Player;
  x: number;
  y: number;
  width: number;
  bird: { y: number; vy: number };
  pipes: Pipe[];
  alive: boolean;
  deathTime: number;
  score: number;
  pipeTimer: number;
  flapCount: number;
  botTimer: number;
}

class FlappyRace implements GameInstance {
  private readonly lanes: Lane[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private time = 0;
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
      alive: true,
      deathTime: 0,
      score: 0,
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
    const dt = this.juice.update(realDt);
    this.time += dt;

    if (this.finished) {
      this.finishTimer -= realDt;
      return;
    }

    const progress = Math.min(1, this.time / 60);
    const speed = PIPE_SPEED_START + (PIPE_SPEED_MAX - PIPE_SPEED_START) * progress;
    const gap = PIPE_GAP_START - (PIPE_GAP_START - PIPE_GAP_MIN) * progress;
    const interval = PIPE_INTERVAL_START - (PIPE_INTERVAL_START - PIPE_INTERVAL_MIN) * progress;

    for (const lane of this.lanes) {
      if (!lane.alive) continue;

      lane.bird.vy += GRAVITY * dt;
      lane.bird.y += lane.bird.vy * dt;

      if (lane.bird.y < TOP_PAD + BIRD_RADIUS || lane.bird.y > this.ctx.height - BIRD_RADIUS) {
        this.killBird(lane);
        continue;
      }

      lane.pipeTimer -= dt;
      if (lane.pipeTimer <= 0) {
        lane.pipeTimer = interval + this.ctx.rng.float(-0.2, 0.2);
        const minY = TOP_PAD + gap / 2 + 30;
        const maxY = this.ctx.height - gap / 2 - 30;
        lane.pipes.push({
          x: lane.x + lane.width + PIPE_WIDTH,
          gapY: this.ctx.rng.float(minY, maxY),
          gapH: gap,
          scored: false,
        });
      }

      for (const pipe of lane.pipes) {
        pipe.x -= speed * dt;

        const birdX = lane.x + lane.width * 0.3;
        if (!pipe.scored && pipe.x + PIPE_WIDTH < birdX) {
          pipe.scored = true;
          lane.score++;
          if (lane.score % 10 === 0) {
            this.ctx.sfx.streak(lane.score / 10);
          } else {
            this.ctx.sfx.tick();
          }
        }

        if (
          birdX + BIRD_RADIUS > pipe.x &&
          birdX - BIRD_RADIUS < pipe.x + PIPE_WIDTH
        ) {
          const birdY = lane.bird.y;
          if (
            birdY - BIRD_RADIUS < pipe.gapY - pipe.gapH / 2 ||
            birdY + BIRD_RADIUS > pipe.gapY + pipe.gapH / 2
          ) {
            this.killBird(lane);
          }
        }
      }

      lane.pipes = lane.pipes.filter((p) => p.x + PIPE_WIDTH > lane.x - 20);

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
    if (lane.botTimer < 0.12) return;
    lane.botTimer = 0;

    const nextPipe = lane.pipes.find(
      (p) => p.x + PIPE_WIDTH > lane.x + lane.width * 0.3,
    );
    if (nextPipe) {
      const targetY = nextPipe.gapY - nextPipe.gapH * 0.15;
      if (lane.bird.y > targetY || lane.bird.vy > 120) {
        this.flap(lane);
      }
    } else if (lane.bird.y > this.ctx.height * 0.55) {
      this.flap(lane);
    }
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

    g.strokeStyle = "rgba(244,247,251,0.06)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(lx + lw, 0);
    g.lineTo(lx + lw, h);
    g.stroke();

    for (const pipe of lane.pipes) {
      const gapTop = pipe.gapY - pipe.gapH / 2;
      const gapBot = pipe.gapY + pipe.gapH / 2;

      g.fillStyle = lane.alive ? "#1a6b3a" : "#2a2a3a";
      g.fillRect(pipe.x, ly, PIPE_WIDTH, gapTop - ly);
      g.fillRect(pipe.x, gapBot, PIPE_WIDTH, h - gapBot);

      g.fillStyle = lane.alive ? "#2ecc40" : "#3a3a4a";
      g.fillRect(pipe.x - 4, gapTop - 16, PIPE_WIDTH + 8, 16);
      g.fillRect(pipe.x - 4, gapBot, PIPE_WIDTH + 8, 16);
    }

    const birdX = lx + lw * 0.3;
    if (lane.alive) {
      const angle = Math.min(0.5, Math.max(-0.4, lane.bird.vy / 600));
      g.save();
      g.translate(birdX, lane.bird.y);
      g.rotate(angle);

      g.shadowColor = player.color;
      g.shadowBlur = 14;
      g.beginPath();
      g.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
      g.fillStyle = player.color;
      g.fill();
      g.shadowBlur = 0;

      g.beginPath();
      g.arc(-BIRD_RADIUS * 0.2, -BIRD_RADIUS * 0.2, BIRD_RADIUS * 0.5, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.fill();

      g.beginPath();
      g.arc(BIRD_RADIUS * 0.3, -BIRD_RADIUS * 0.15, BIRD_RADIUS * 0.22, 0, Math.PI * 2);
      g.fillStyle = "#070b14";
      g.fill();

      g.beginPath();
      g.moveTo(BIRD_RADIUS * 0.7, 0);
      g.lineTo(BIRD_RADIUS * 1.2, -BIRD_RADIUS * 0.15);
      g.lineTo(BIRD_RADIUS * 1.2, BIRD_RADIUS * 0.15);
      g.closePath();
      g.fillStyle = "#FFB020";
      g.fill();

      g.restore();
    } else {
      g.save();
      g.globalAlpha = 0.3;
      g.fillStyle = player.color;
      g.font = "700 28px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("OUT", birdX, h / 2);
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

  isFinished(): boolean {
    return this.finished && this.finishTimer <= 0;
  }

  getScores(): { playerId: string; score: number }[] {
    const sorted = [...this.lanes].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (!a.alive && !b.alive) return b.deathTime - a.deathTime;
      return b.score - a.score;
    });
    return sorted.map((lane, i) => ({
      playerId: lane.player.id,
      score: (sorted.length - i) * 100 + lane.score,
    }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const lane of this.lanes) {
      out.push({
        playerId: lane.player.id,
        label: "Pipes cleared",
        value: String(lane.score),
      });
      out.push({
        playerId: lane.player.id,
        label: "Flaps",
        value: String(lane.flapCount),
      });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
