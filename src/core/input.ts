export interface KeyBind {
  up: string;
  down: string;
  left: string;
  right: string;
  action: string;
}

export const PLAYER_BINDS: readonly KeyBind[] = [
  { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", action: "Space" },
  { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", action: "Enter" },
  { up: "KeyI", down: "KeyK", left: "KeyJ", right: "KeyL", action: "ShiftRight" },
  { up: "KeyT", down: "KeyG", left: "KeyF", right: "KeyH", action: "KeyY" },
];

export const BIND_LABELS = [
  "WASD · Space",
  "Arrows · Enter",
  "IJKL · R-Shift",
  "TFGH · Y",
] as const;

export class InputManager {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private canvas: HTMLCanvasElement | null = null;
  private logical = { w: 1280, h: 720 };
  private click: { x: number; y: number } | null = null;
  hover: { x: number; y: number } | null = null;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  setLogical(width: number, height: number): void {
    this.logical = { w: width, h: height };
  }

  bindPointer(canvas: HTMLCanvasElement, width: number, height: number): void {
    this.unbindPointer();
    this.canvas = canvas;
    this.logical = { w: width, h: height };
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", this.onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  unbindPointer(): void {
    this.canvas?.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas?.removeEventListener("pointermove", this.onPointerMove);
    this.canvas?.removeEventListener("pointerup", this.onPointerUp);
    this.canvas?.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas?.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas = null;
    this.click = null;
    this.hover = null;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.cancelable) event.preventDefault();
    this.click = this.pointOnCanvas(event);
    this.hover = this.click;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && event.cancelable) event.preventDefault();
    this.hover = this.pointOnCanvas(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === "touch") this.hover = null;
  };

  private readonly onPointerLeave = (): void => {
    this.hover = null;
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private pointOnCanvas(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.logical.w,
      y: ((event.clientY - rect.top) / rect.height) * this.logical.h,
    };
  }

  consumeClick(): { x: number; y: number } | null {
    const click = this.click;
    this.click = null;
    return click;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === "Space") event.preventDefault();
    this.down.add(event.code);
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
    this.released.add(event.code);
  };

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.click = null;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  axis(slot: 0 | 1 | 2 | 3): { x: number; y: number } {
    const bind = PLAYER_BINDS[slot]!;
    const x = (this.isDown(bind.right) ? 1 : 0) - (this.isDown(bind.left) ? 1 : 0);
    const y = (this.isDown(bind.down) ? 1 : 0) - (this.isDown(bind.up) ? 1 : 0);
    return { x, y };
  }

  actionPressed(slot: 0 | 1 | 2 | 3): boolean {
    return this.justPressed(PLAYER_BINDS[slot]!.action);
  }

  actionDown(slot: 0 | 1 | 2 | 3): boolean {
    return this.isDown(PLAYER_BINDS[slot]!.action);
  }

  destroy(): void {
    this.unbindPointer();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
