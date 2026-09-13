import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "./types";
import type { InputManager } from "./input";
import type { Sfx } from "./audio";
import type { Player } from "./types";
import { Rng } from "./rng";

export type EnginePhase = "countdown" | "playing" | "finished";

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  phase: EnginePhase = "countdown";
  remaining = 0;
  elapsed = 0;
  private instance: MinigameInstance | null = null;
  private definition: MinigameDefinition | null = null;
  private raf = 0;
  private last = 0;
  private countdown = 3;
  private onDone: ((scores: { playerId: string; score: number }[]) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly input: InputManager,
    private readonly sfx: Sfx,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is required");
    this.ctx = ctx;
    this.fit();
    window.addEventListener("resize", this.fit);
  }

  readonly fit = (): void => {
    const parent = this.canvas.parentElement;
    const cssWidth = parent?.clientWidth || window.innerWidth;
    const cssHeight = parent?.clientHeight || window.innerHeight;
    const scale = Math.min(cssWidth / GAME_WIDTH, cssHeight / GAME_HEIGHT);
    const width = Math.floor(GAME_WIDTH * scale);
    const height = Math.floor(GAME_HEIGHT * scale);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.floor(GAME_WIDTH * dpr);
    this.canvas.height = Math.floor(GAME_HEIGHT * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  start(
    definition: MinigameDefinition,
    players: Player[],
    onDone: (scores: { playerId: string; score: number }[]) => void,
  ): void {
    this.stop();
    this.definition = definition;
    this.onDone = onDone;
    this.phase = "countdown";
    this.countdown = 3;
    this.elapsed = 0;
    this.remaining = definition.durationMs / 1000;
    const context: MinigameContext = {
      canvas: this.canvas,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      players,
      input: this.input,
      rng: new Rng(),
      sfx: this.sfx,
    };
    this.instance = definition.create(context);
    this.input.bindPointer(this.canvas, GAME_WIDTH, GAME_HEIGHT);
    this.last = performance.now();
    if (definition.durationMs <= 0) {
      this.phase = "playing";
      this.remaining = Number.POSITIVE_INFINITY;
    } else {
      this.sfx.countdown();
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(raw, 0.05);

    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = "playing";
        this.sfx.go();
      } else if (this.countdown <= 2 && this.countdown + dt > 2) {
        this.sfx.countdown();
      } else if (this.countdown <= 1 && this.countdown + dt > 1) {
        this.sfx.countdown();
      }
    } else if (this.phase === "playing" && this.instance && this.definition) {
      this.elapsed += dt;
      if (this.definition.durationMs > 0) {
        this.remaining = Math.max(0, this.definition.durationMs / 1000 - this.elapsed);
      }
      this.instance.update(dt);
      const timedOut = this.definition.durationMs > 0 && this.remaining <= 0;
      if (timedOut || this.instance.isFinished()) {
        this.finish();
      }
    }

    this.instance?.render(this.ctx);
    this.drawOverlay();
    this.input.endFrame();
    if (this.phase !== "finished") {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private drawOverlay(): void {
    const ctx = this.ctx;
    if (this.phase === "countdown") {
      ctx.fillStyle = "rgba(7,11,20,0.45)";
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      ctx.fillStyle = "#F4F7FB";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 140px Bebas Neue, Impact, sans-serif";
      const n = Math.max(1, Math.ceil(this.countdown));
      ctx.fillText(String(n), GAME_WIDTH / 2, GAME_HEIGHT / 2);
      ctx.font = "600 28px Outfit, sans-serif";
      ctx.fillStyle = "#3EE0FF";
      ctx.fillText(this.definition?.name ?? "", GAME_WIDTH / 2, GAME_HEIGHT / 2 + 110);
    }
  }

  private finish(): void {
    if (this.phase === "finished") return;
    this.phase = "finished";
    const scores = this.instance?.getScores() ?? [];
    this.sfx.win();
    this.onDone?.(scores);
  }

  abort(): void {
    this.phase = "finished";
    this.stop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.instance?.destroy();
    this.instance = null;
    this.input.unbindPointer();
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.fit);
  }
}
