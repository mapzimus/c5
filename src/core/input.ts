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

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
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

  beginFrame(): void {
    this.pressed.clear();
    this.released.clear();
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
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
