import { PAIR_COUNT } from "./flags";

/** Landscape deals 6 columns; a phone in portrait turns the board to 4 columns. */
export const PAIR_COLS = 6;
export const PAIR_ROWS = (PAIR_COUNT * 2) / PAIR_COLS;

export interface Slot {
  x: number;
  y: number;
}

export interface BoardLayout {
  slots: Slot[];
  cols: number;
  rows: number;
  cardW: number;
  cardH: number;
  gap: number;
  hudHeight: number;
  narrow: boolean;
}

export function boardShape(narrow: boolean): { cols: number; rows: number } {
  return narrow ? { cols: PAIR_ROWS, rows: PAIR_COLS } : { cols: PAIR_COLS, rows: PAIR_ROWS };
}

export function layoutPairBoard(width: number, height: number, playerCount: number): BoardLayout {
  const narrow = width < 920;
  const { cols, rows } = boardShape(narrow);
  const hudHeight = narrow ? (playerCount > 2 ? 268 : 262) : 112;
  const padX = narrow ? 12 : 28;
  const padBottom = narrow ? 28 : 16;
  const availW = Math.max(120, width - padX * 2);
  const availH = Math.max(120, height - hudHeight - padBottom);
  const gap = Math.max(4, Math.min(narrow ? 10 : 12, Math.floor(availW * 0.012)));
  const cell = Math.max(
    36,
    Math.floor(Math.min((availW - gap * (cols - 1)) / cols, (availH - gap * (rows - 1)) / rows)),
  );
  const cardW = cell;
  const cardH = cell;
  const boardW = cardW * cols + gap * (cols - 1);
  const boardH = cardH * rows + gap * (rows - 1);
  const left = (width - boardW) / 2;
  const slack = Math.max(0, availH - boardH);
  const top = hudHeight + slack * (narrow ? 0.5 : 0.25);
  const slots: Slot[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      slots.push({
        x: left + col * (cardW + gap),
        y: top + row * (cardH + gap),
      });
    }
  }
  return { slots, cols, rows, cardW, cardH, gap, hudHeight, narrow };
}

export function hitCard(layout: BoardLayout, x: number, y: number): number | null {
  const index = layout.slots.findIndex(
    (slot) => x >= slot.x && x <= slot.x + layout.cardW && y >= slot.y && y <= slot.y + layout.cardH,
  );
  return index >= 0 ? index : null;
}

export function midpoint(layout: BoardLayout, a: number, b: number): { x: number; y: number } {
  const left = layout.slots[a]!;
  const right = layout.slots[b]!;
  return {
    x: (left.x + right.x) / 2 + layout.cardW / 2,
    y: (left.y + right.y) / 2 + layout.cardH / 2,
  };
}

export interface ChipLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Score chips double as SNAP buttons, so they are sized to the tap minimum. */
export function layoutChips(
  width: number,
  playerCount: number,
  narrow: boolean,
  minTap: number,
): ChipLayout[] {
  const gap = narrow ? 8 : 10;
  const inset = narrow ? 16 : 36;
  const h = Math.max(narrow ? 40 : 44, Math.min(narrow ? 84 : 60, minTap));
  const w = narrow ? Math.floor((width - inset * 2 - gap * (playerCount - 1)) / playerCount) : 164;
  const startX = narrow ? inset : width - inset - (playerCount * w + (playerCount - 1) * gap);
  const y = narrow ? 166 : 20;
  return Array.from({ length: playerCount }, (_, index) => ({
    x: startX + index * (w + gap),
    y,
    w,
    h,
  }));
}

export function hitChip(chips: readonly ChipLayout[], x: number, y: number): number | null {
  const index = chips.findIndex((chip) => x >= chip.x && x <= chip.x + chip.w && y >= chip.y && y <= chip.y + chip.h);
  return index >= 0 ? index : null;
}
