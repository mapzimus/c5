export const PAIR_FACES = ["bolt", "swirl", "star", "drop", "flame", "moon", "gem", "eye"] as const;

export type PairFace = (typeof PAIR_FACES)[number];
export type CardState = "down" | "up" | "matched";

export interface PairCard {
  id: number;
  face: PairFace;
  state: CardState;
}

export function dealPairs(faces: readonly PairFace[], pickIndex: (maxExclusive: number) => number): PairCard[] {
  const deck: PairCard[] = faces.flatMap((face, index) => [
    { id: index * 2, face, state: "down" },
    { id: index * 2 + 1, face, state: "down" },
  ]);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1);
    const a = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = a;
  }
  return deck;
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
    memory.set(face, indices.filter((item) => item !== index));
  }
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
