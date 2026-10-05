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
  const hudHeight = narrow ? (playerCount > 2 ? 168 : 148) : 108;
  const padX = narrow ? 12 : 28;
  const padBottom = narrow ? 28 : 16;
  const availW = Math.max(120, width - padX * 2);
  const availH = Math.max(120, height - hudHeight - padBottom);
  const gap = Math.max(4, Math.min(narrow ? 8 : 10, Math.floor(availW * 0.012)));
  let cardW = Math.max(36, Math.floor((availW - gap * (PAIR_COLS - 1)) / PAIR_COLS));
  let cardH = Math.max(36, Math.floor((availH - gap * (PAIR_ROWS - 1)) / PAIR_ROWS));
  if (!narrow) {
    const cell = Math.min(cardW, cardH);
    cardW = cell;
    cardH = cell;
  }
  const boardW = cardW * PAIR_COLS + gap * (PAIR_COLS - 1);
  const boardH = cardH * PAIR_ROWS + gap * (PAIR_ROWS - 1);
  const left = (width - boardW) / 2;
  const slack = Math.max(0, availH - boardH);
  const top = hudHeight + slack * (narrow ? 0.5 : 0.15);
  const slots: Slot[] = [];
  for (let row = 0; row < PAIR_ROWS; row += 1) {
    for (let col = 0; col < PAIR_COLS; col += 1) {
      slots.push({
        x: left + col * (cardW + gap),
        y: top + row * (cardH + gap),
      });
    }
  }
  return { slots, cardW, cardH, gap, hudHeight, narrow };
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
