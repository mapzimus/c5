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

export const FEVER_STREAK = 3;
export const GOLDEN_FACTOR = 3;

/** Fever multiplier from the current consecutive-match streak: x1, then x2 at 3, x3 at 5+. */
export function feverMultiplier(streak: number): number {
  if (streak >= 5) return 3;
  if (streak >= FEVER_STREAK) return 2;
  return 1;
}

export function inFever(streak: number): boolean {
  return streak >= FEVER_STREAK;
}

/** Full match score: combo points (with closer bonus) × fever multiplier, tripled for the golden pair. */
export function scoreMatch(streak: number, remainingPairsAfter: number, golden: boolean): number {
  const base = pointsForMatch(streak, remainingPairsAfter) * feverMultiplier(streak);
  return golden ? base * GOLDEN_FACTOR : base;
}

/** Best score among human seats, or null when no human is playing. */
export function bestHumanScore(
  players: readonly { kind: string }[],
  scores: readonly number[],
): number | null {
  let best: number | null = null;
  players.forEach((player, index) => {
    if (player.kind !== "human") return;
    const score = scores[index] ?? 0;
    if (best === null || score > best) best = score;
  });
  return best;
}

export const SHAKE_EVERY = 4;
export const SHAKE_COUNT = 4;

/** A shake-up fires on every SHAKE_EVERY-th miss (4, 8, 12…), counted across all players. */
export function shakeDue(totalMisses: number, every = SHAKE_EVERY): boolean {
  return totalMisses > 0 && every > 0 && totalMisses % every === 0;
}

/** Misses left until the next shake-up (never 0: right after one fires it reads a full cycle). */
export function missesUntilShake(totalMisses: number, every = SHAKE_EVERY): number {
  return every - (Math.max(0, totalMisses) % every);
}

/** Up to `take` random face-down tiles to shuffle. Fewer than 2 candidates means no shake-up. */
export function pickShakeIndices(
  cards: readonly PairCard[],
  take: number,
  pickIndex: (maxExclusive: number) => number,
): number[] {
  const open = cards.flatMap((card, index) => (card.state === "down" ? [index] : []));
  if (open.length < 2) return [];
  return shuffleInPlace(open, pickIndex).slice(0, Math.min(take, open.length));
}

export interface ShakeMove {
  /** Slot the card left. */
  from: number;
  /** Slot the card landed in. */
  to: number;
}

/**
 * Rotate the cards at `indices` one step (the card at indices[i] moves to indices[i+1]),
 * so every chosen tile changes place. Returns the moves for animation.
 */
export function shakeUp(cards: PairCard[], indices: readonly number[]): ShakeMove[] {
  if (indices.length < 2) return [];
  const moved = indices.map((index) => cards[index]!);
  const moves: ShakeMove[] = [];
  indices.forEach((from, i) => {
    const to = indices[(i + 1) % indices.length]!;
    cards[to] = moved[i]!;
    moves.push({ from, to });
  });
  return moves;
}

/** Wipe tiles from bot memory (and its recency queue) after they have been moved. */
export function forgetCards(memory: Map<string, number[]>, recency: number[], indices: readonly number[]): void {
  for (const index of indices) {
    forget(memory, index);
    const at = recency.indexOf(index);
    if (at >= 0) recency.splice(at, 1);
  }
}
