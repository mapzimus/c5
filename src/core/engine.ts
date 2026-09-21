import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "./types";
import type { InputManager } from "./input";
import type { Sfx } from "./audio";
import type { Player } from "./types";
import { Rng } from "./rng";
import { layoutLogicalSize, viewSize } from "./viewport";

export type EnginePhase = "countdown" | "playing" | "finished";

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  phase: EnginePhase = "countdown";
  remaining = 0;
  elapsed = 0;
  private instance: MinigameInstance | null = null;
  private definition: MinigameDefinition | null = null;
  private context: MinigameContext | null = null;
  private logical = { width: GAME_WIDTH, height: GAME_HEIGHT };
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
    window.visualViewport?.addEventListener("resize", this.fit);
  }

  readonly fit = (): void => {
    const view = viewSize(this.canvas.parentElement);
    this.logical = layoutLogicalSize(view.width, view.height);
    if (this.context) {
      this.context.width = this.logical.width;
      this.context.height = this.logical.height;
    }
    this.input.setLogical(this.logical.width, this.logical.height);
    const scale = Math.min(view.width / this.logical.width, view.height / this.logical.height);
    const width = Math.max(1, Math.floor(this.logical.width * scale));
    const height = Math.max(1, Math.floor(this.logical.height * scale));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.floor(this.logical.width * dpr);
    this.canvas.height = Math.floor(this.logical.height * dpr);
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
    this.fit();
    const context: MinigameContext = {
      canvas: this.canvas,
      width: this.logical.width,
      height: this.logical.height,
      players,
      input: this.input,
      rng: new Rng(),
      sfx: this.sfx,
    };
    this.context = context;
    this.instance = definition.create(context);
    this.input.bindPointer(this.canvas, this.logical.width, this.logical.height);
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
      ctx.fillRect(0, 0, this.logical.width, this.logical.height);
      ctx.fillStyle = "#F4F7FB";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 140px Bebas Neue, Impact, sans-serif";
      const n = Math.max(1, Math.ceil(this.countdown));
      ctx.fillText(String(n), this.logical.width / 2, this.logical.height / 2);
      ctx.font = "600 28px Outfit, sans-serif";
      ctx.fillStyle = "#3EE0FF";
      ctx.fillText(this.definition?.name ?? "", this.logical.width / 2, this.logical.height / 2 + 110);
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
    this.context = null;
    this.input.unbindPointer();
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.fit);
    window.visualViewport?.removeEventListener("resize", this.fit);
  }
}
