export const PAIR_COLS = 6;
export const PAIR_ROWS = 6;

export interface Slot {
  x: number;
  y: number;
}

export interface BoardLayout {
  slots: Slot[];
  cardW: number;
  cardH: number;
  gap: number;
  hudHeight: number;
  narrow: boolean;
}

export function layoutPairBoard(width: number, height: number, playerCount: number): BoardLayout {
  const narrow = width < 920;
  const hudHeight = narrow ? (playerCount > 2 ? 172 : 150) : 96;
  const padX = narrow ? 12 : 24;
  const padBottom = narrow ? 12 : 18;
  const availW = Math.max(120, width - padX * 2);
  const availH = Math.max(120, height - hudHeight - padBottom);
  const gap = Math.max(4, Math.min(narrow ? 7 : 10, Math.floor(availW * 0.014)));
  const cell = Math.max(
    36,
    Math.floor(Math.min((availW - gap * (PAIR_COLS - 1)) / PAIR_COLS, (availH - gap * (PAIR_ROWS - 1)) / PAIR_ROWS)),
  );
  const boardW = cell * PAIR_COLS + gap * (PAIR_COLS - 1);
  const boardH = cell * PAIR_ROWS + gap * (PAIR_ROWS - 1);
  const left = (width - boardW) / 2;
  const top = hudHeight + Math.max(0, (availH - boardH) / 2);
  const slots: Slot[] = [];
  for (let row = 0; row < PAIR_ROWS; row += 1) {
    for (let col = 0; col < PAIR_COLS; col += 1) {
      slots.push({
        x: left + col * (cell + gap),
        y: top + row * (cell + gap),
      });
    }
  }
  return { slots, cardW: cell, cardH: cell, gap, hudHeight, narrow };
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
