export type CardState = "down" | "up" | "matched";

export interface PairCard {
  id: number;
  face: string;
  state: CardState;
}

export function shuffleInPlace<T>(items: T[], pickIndex: (maxExclusive: number) => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1);
    const a = items[i]!;
    items[i] = items[j]!;
    items[j] = a;
  }
  return items;
}

export function pickFaces(
  pool: readonly string[],
  count: number,
  pickIndex: (maxExclusive: number) => number,
): string[] {
  return shuffleInPlace([...pool], pickIndex).slice(0, Math.min(count, pool.length));
}

export function dealPairs(faces: readonly string[], pickIndex: (maxExclusive: number) => number): PairCard[] {
  const deck: PairCard[] = faces.flatMap((face, index) => [
    { id: index * 2, face, state: "down" },
    { id: index * 2 + 1, face, state: "down" },
  ]);
  return shuffleInPlace(deck, pickIndex);
}

export function canFlip(card: PairCard | undefined): boolean {
  return card?.state === "down";
}

export function nextTurnIndex(current: number, playerCount: number, matched: boolean): number {
  if (matched || playerCount <= 1) return current;
  return (current + 1) % playerCount;
}

export function remember(memory: Map<string, number[]>, index: number, face: string): void {
  const known = memory.get(face) ?? [];
  if (!known.includes(index)) known.push(index);
  memory.set(face, known);
}

export function forget(memory: Map<string, number[]>, index: number): void {
  for (const [face, indices] of memory) {
    const next = indices.filter((item) => item !== index);
    if (next.length === 0) memory.delete(face);
    else memory.set(face, next);
  }
}

export const BOT_MEMORY_LIMIT = 8;
export const CLOSER_BONUS = 2;

/** Consecutive matches in one turn are worth 1, then 2, then 3… Last pair adds a closer bonus. */
export function pointsForMatch(streak: number, remainingPairsAfter: number): number {
  const combo = Math.max(1, streak);
  return combo + (remainingPairsAfter === 0 ? CLOSER_BONUS : 0);
}

export function nextStreak(current: number, matched: boolean): number {
  return matched ? current + 1 : 0;
}

export function remainingPairs(cards: readonly PairCard[]): number {
  return cards.filter((card) => card.state !== "matched").length / 2;
}

/** Remember a sighting, then drop the oldest cards so the bot is fallible. */
export function rememberCard(
  memory: Map<string, number[]>,
  recency: number[],
  index: number,
  face: string,
  limit = BOT_MEMORY_LIMIT,
): void {
  remember(memory, index, face);
  const existing = recency.indexOf(index);
  if (existing >= 0) recency.splice(existing, 1);
  recency.push(index);
  while (recency.length > limit) {
    const dropped = recency.shift();
    if (dropped !== undefined) forget(memory, dropped);
  }
}

export function glimpseIndices(
  count: number,
  take: number,
  pickIndex: (maxExclusive: number) => number,
): number[] {
  const order = shuffleInPlace(
    Array.from({ length: count }, (_, index) => index),
    pickIndex,
  );
  return order.slice(0, Math.min(take, count));
}

export function stepCursor(
  index: number,
  dx: number,
  dy: number,
  cols: number,
  rows: number,
  open: (next: number) => boolean,
): number {
  if (dx === 0 && dy === 0) return index;
  let col = index % cols;
  let row = Math.floor(index / cols);
  for (let step = 0; step < cols * rows; step += 1) {
    col = (col + dx + cols) % cols;
    row = (row + dy + rows) % rows;
    const next = row * cols + col;
    if (open(next)) return next;
  }
  return index;
}

/** First known pair, or the mate of the card just flipped, or -1 to pick at random. */
export function pickKnownIndex(
  cards: readonly PairCard[],
  memory: Map<string, number[]>,
  firstIndex: number | null,
): number {
  if (firstIndex !== null) {
    const face = cards[firstIndex]?.face;
    if (!face) return -1;
    const mate = (memory.get(face) ?? []).find((index) => index !== firstIndex && cards[index]?.state === "down");
    return mate ?? -1;
  }

  for (const [, indices] of memory) {
    const live = indices.filter((index) => cards[index]?.state === "down");
    if (live.length >= 2) return live[0]!;
  }
  return -1;
}
