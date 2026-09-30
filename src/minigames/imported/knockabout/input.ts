import type { Disc } from "./types";
import { TUNING } from "./types";
import { GAME_WIDTH, GAME_HEIGHT } from "../../../core/types";

export interface PointerInfo {
  id: number;
  x: number;
  y: number;
}

export class KnockaboutInput {
  private pointers = new Map<number, { disc: Disc; sx: number; sy: number; cx: number; cy: number }>();
  private rect: DOMRect | null = null;
  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;
  private readonly onCancel: (e: PointerEvent) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly toWorld: (lx: number, ly: number) => { x: number; y: number },
    private readonly findDisc: (wx: number, wy: number, pointerId: number) => Disc | null,
  ) {
    this.onDown = this._onDown.bind(this);
    this.onMove = this._onMove.bind(this);
    this.onUp = this._onUp.bind(this);
    this.onCancel = this._onCancel.bind(this);

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.style.touchAction = "none";
  }

  private cssToLogical(e: PointerEvent): { lx: number; ly: number } {
    if (!this.rect || this.rect.width === 0) this.rect = this.canvas.getBoundingClientRect();
    const lx = ((e.clientX - this.rect.left) / this.rect.width) * GAME_WIDTH;
    const ly = ((e.clientY - this.rect.top) / this.rect.height) * GAME_HEIGHT;
    return { lx, ly };
  }

  private _onDown(e: PointerEvent): void {
    const { lx, ly } = this.cssToLogical(e);
    const w = this.toWorld(lx, ly);
    const disc = this.findDisc(w.x, w.y, e.pointerId);
    if (!disc) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch {}
    disc.grab = e.pointerId;
    this.pointers.set(e.pointerId, { disc, sx: w.x, sy: w.y, cx: w.x, cy: w.y });
  }

  private _onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const { lx, ly } = this.cssToLogical(e);
    const w = this.toWorld(lx, ly);
    p.cx = w.x;
    p.cy = w.y;
    this.updateAim(p.disc, p.sx, p.sy, p.cx, p.cy);
  }

  private _onUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    p.disc.grab = null;
  }

  private _onCancel(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    p.disc.grab = null;
    p.disc.aim = null;
  }

  private updateAim(disc: Disc, sx: number, sy: number, cx: number, cy: number): void {
    const dx = sx - cx;
    const dy = sy - cy;
    const pull = Math.hypot(dx, dy);
    if (pull < 0.01) {
      disc.aim = null;
      return;
    }
    const power = Math.min(1, pull / TUNING.maxPull);
    const len = Math.hypot(dx, dy) || 1;
    disc.aim = {
      dx: dx / len,
      dy: dy / len,
      power,
      px: cx,
      py: cy,
    };
  }

  refreshRect(): void {
    this.rect = this.canvas.getBoundingClientRect();
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
  }
}
