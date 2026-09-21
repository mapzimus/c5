import {
  shouldCommitCancel,
  velocityFromGesture,
  type FlickGesture,
  type FlickSample,
} from "./flick";

/** Phone-height the original flick was tuned against (parrot-flip on a tall handset). */
export const FEEL_HEIGHT = 844;

export interface DragState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

/**
 * Pointer flick on the game canvas.
 * Velocity is measured in CSS pixels then scaled to the original phone feel.
 */
export class FlickPointer {
  private dragging = false;
  private enabled = false;
  private activePointerId: number | null = null;
  private pointerType = "mouse";
  private startX = 0;
  private startY = 0;
  private curX = 0;
  private curY = 0;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private peakSpeed = 0;
  private peakVx = 0;
  private peakVy = 0;
  private samples: FlickSample[] = [];
  private rect: DOMRect | null = null;
  private cssH = FEEL_HEIGHT;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly logical: { w: number; h: number },
    private readonly onFlick: (vx: number, vy: number) => void,
  ) {
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.style.touchAction = "none";
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.dragging = false;
    this.activePointerId = null;
  }

  getDrag(): DragState | null {
    if (!this.dragging || !this.rect || this.rect.width === 0 || this.rect.height === 0) return null;
    return {
      startX: this.toLogicalX(this.startX),
      startY: this.toLogicalY(this.startY),
      curX: this.toLogicalX(this.curX),
      curY: this.toLogicalY(this.curY),
    };
  }

  destroy(): void {
    this.disable();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (!this.enabled || this.dragging) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.pointerType = event.pointerType || "mouse";
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* capture is optional */
    }
    this.dragging = true;
    this.rect = this.canvas.getBoundingClientRect();
    this.cssH = this.rect.height || FEEL_HEIGHT;
    this.startX = this.curX = this.lastX = event.clientX - this.rect.left;
    this.startY = this.curY = this.lastY = event.clientY - this.rect.top;
    this.lastT = performance.now();
    this.peakSpeed = this.peakVx = this.peakVy = 0;
    this.samples = [{ t: this.lastT, x: this.startX, y: this.startY }];
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.dragging || !this.rect || event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    this.curX = event.clientX - this.rect.left;
    this.curY = event.clientY - this.rect.top;
    const now = performance.now();
    const dt = Math.max((now - this.lastT) / 1000, 0.001);
    const ivx = (this.curX - this.lastX) / dt;
    const ivy = (this.curY - this.lastY) / dt;
    const spd = Math.hypot(ivx, ivy);
    if (spd > this.peakSpeed) {
      this.peakSpeed = spd;
      this.peakVx = ivx;
      this.peakVy = ivy;
    }
    this.lastX = this.curX;
    this.lastY = this.curY;
    this.lastT = now;
    this.samples.push({ t: now, x: this.curX, y: this.curY });
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.dragging || !this.enabled || event.pointerId !== this.activePointerId) return;
    this.dragging = false;
    this.activePointerId = null;
    this.fireIfFlick();
  };

  private readonly onCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    const commit = this.dragging && this.enabled && shouldCommitCancel(this.gesture());
    this.dragging = false;
    this.activePointerId = null;
    if (commit) this.fireIfFlick();
  };

  private gesture(): FlickGesture {
    return {
      samples: this.samples,
      pointerType: this.pointerType,
      peakVx: this.peakVx,
      peakVy: this.peakVy,
      peakSpeed: this.peakSpeed,
      startX: this.startX,
      startY: this.startY,
      curX: this.curX,
      curY: this.curY,
    };
  }

  private fireIfFlick(): void {
    const velocity = velocityFromGesture(this.gesture());
    if (!velocity) return;
    const scale = FEEL_HEIGHT / Math.max(this.cssH, 1);
    this.onFlick(velocity.vx * scale, velocity.vy * scale);
  }

  private toLogicalX(cssX: number): number {
    const width = this.rect?.width || this.logical.w;
    return (cssX / width) * this.logical.w;
  }

  private toLogicalY(cssY: number): number {
    const height = this.rect?.height || this.logical.h;
    return (cssY / height) * this.logical.h;
  }
}
