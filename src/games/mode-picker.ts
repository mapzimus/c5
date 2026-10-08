import { GAME_HEIGHT, GAME_WIDTH, type GameContext, type GameInstance, type GameStat } from "../core/types";

export interface GameMode {
  title: string;
  line1: string;
  line2: string;
  color: string;
  create: (ctx: GameContext) => GameInstance;
}

const Y = 230;
const W = 340;
const H = 300;

/**
 * Opens a game on a two-mode choice (tap a card, or press 1 / 2), then hands
 * everything to the chosen mode. Skips straight to the first mode when `skip` is true
 * (e.g. an all-bot table).
 */
export class ModePicker implements GameInstance {
  private inner: GameInstance | null = null;
  private time = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly heading: string,
    private readonly modes: readonly [GameMode, GameMode],
    skip = false,
  ) {
    if (skip) this.inner = modes[0].create(ctx);
  }

  private x(i: number): number {
    return i === 0 ? 250 : 690;
  }

  update(dt: number): void {
    if (this.inner) {
      this.inner.update(dt);
      return;
    }
    this.time += dt;
    const input = this.ctx.input;
    const click = input.consumeClick();
    let pick = -1;
    if (input.justPressed("Digit1")) pick = 0;
    if (input.justPressed("Digit2")) pick = 1;
    if (click) {
      this.modes.forEach((_, i) => {
        if (click.x >= this.x(i) && click.x <= this.x(i) + W && click.y >= Y && click.y <= Y + H) pick = i;
      });
    }
    if (pick >= 0) {
      this.ctx.sfx.go();
      this.inner = this.modes[pick]!.create(this.ctx);
    }
  }

  render(g: CanvasRenderingContext2D): void {
    if (this.inner) {
      this.inner.render(g);
      return;
    }
    const bg = g.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    bg.addColorStop(0, "#0c1628");
    bg.addColorStop(1, "#1d3a4f");
    g.fillStyle = bg;
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#F4F7FB";
    g.font = "700 64px Bebas Neue, Impact, sans-serif";
    g.fillText(this.heading, GAME_WIDTH / 2, 110);
    g.font = "600 20px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText("Tap a mode", GAME_WIDTH / 2, 150);
    this.modes.forEach((mode, i) => {
      const pulse = 1 + Math.sin(this.time * 3 + i * 1.6) * 0.015;
      g.save();
      g.translate(this.x(i) + W / 2, Y + H / 2);
      g.scale(pulse, pulse);
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.strokeStyle = mode.color;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(-W / 2, -H / 2, W, H, 24);
      g.fill();
      g.stroke();
      g.fillStyle = mode.color;
      g.font = "700 64px Bebas Neue, Impact, sans-serif";
      g.fillText(mode.title, 0, -20);
      g.fillStyle = "#F4F7FB";
      g.font = "600 20px Outfit, sans-serif";
      g.fillText(mode.line1, 0, 40);
      g.fillText(mode.line2, 0, 68);
      g.fillStyle = "#64748b";
      g.font = "600 14px Outfit, sans-serif";
      g.fillText(`or press ${i + 1}`, 0, 120);
      g.restore();
    });
  }

  isFinished(): boolean {
    return this.inner?.isFinished() ?? false;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.inner?.getScores() ?? this.ctx.players.map((p) => ({ playerId: p.id, score: 0 }));
  }

  getStats(): GameStat[] {
    return this.inner?.getStats?.() ?? [];
  }

  destroy(): void {
    this.inner?.destroy();
  }
}
