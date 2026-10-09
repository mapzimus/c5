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
export const GOLDEN_FACTOR = 2;

/** Fever multiplier from the current consecutive-match streak: x1, then x2 at 3, x3 at 5+. */
export function feverMultiplier(streak: number): number {
  if (streak >= 5) return 3;
  if (streak >= FEVER_STREAK) return 2;
  return 1;
}

export function inFever(streak: number): boolean {
  return streak >= FEVER_STREAK;
}

/** Full match score: combo points (with closer bonus) × fever multiplier, doubled again for the golden pair. */
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

/* ------------------------------------------------------------------ */
/* Trick cards, tension, catch-up and table talk                       */
/* ------------------------------------------------------------------ */

/**
 * Single trick cards shuffled in with the flags. Flipping one fires it at once
 * and does not use up one of your two flips (except the bomb, which ends the turn).
 */
export type TrickKind = "peek" | "bomb" | "thief" | "swap" | "jackpot";

export interface TrickCard extends PairCard {
  trick?: TrickKind;
}

/** 16 flag pairs + 4 trick cards fill the 6×6 board. */
export const FLAG_PAIRS = 16;
export const TRICK_FACE_PREFIX = "trick:";
export const PEEK_REVEAL_COUNT = 4;
export const JACKPOT_POINTS = 5;
export const FRENZY_PAIRS = 3;
export const FRENZY_FACTOR = 2;
export const SNIPE_BONUS = 1;

export const TRICK_INFO: Record<TrickKind, { label: string; blurb: string; color: string; glyph: string }> = {
  peek: { label: "X-RAY", blurb: "4 cards flash face-up", color: "#3EE0FF", glyph: "◉" },
  bomb: { label: "BOMB", blurb: "Shuffles the board, turn over", color: "#FF5A3D", glyph: "✸" },
  thief: { label: "THIEF", blurb: "Steal from the leader", color: "#B8FF3D", glyph: "$" },
  swap: { label: "SWAP", blurb: "Trade scores with the leader", color: "#FF4FD8", glyph: "⇄" },
  jackpot: { label: "JACKPOT", blurb: "+5 points", color: "#FFD54A", glyph: "★" },
};

/** Trick lineup for the table: solo games get no-opponent tricks. */
export function tricksFor(playerCount: number): TrickKind[] {
  if (playerCount <= 1) return ["peek", "bomb", "jackpot", "peek"];
  return ["peek", "bomb", "thief", "swap"];
}

/** Deal flag pairs plus single trick cards, shuffled together. */
export function dealBoard(
  faces: readonly string[],
  tricks: readonly TrickKind[],
  pickIndex: (maxExclusive: number) => number,
): TrickCard[] {
  const deck: TrickCard[] = faces.flatMap((face, index) => [
    { id: index * 2, face, state: "down" as CardState },
    { id: index * 2 + 1, face, state: "down" as CardState },
  ]);
  tricks.forEach((trick, index) => {
    deck.push({ id: faces.length * 2 + index, face: `${TRICK_FACE_PREFIX}${trick}`, state: "down", trick });
  });
  return shuffleInPlace(deck, pickIndex);
}

/** Unmatched flag pairs (tricks never count). */
export function flagPairsLeft(cards: readonly TrickCard[]): number {
  return cards.filter((card) => !card.trick && card.state !== "matched").length / 2;
}

/** The round is over once every flag pair is matched; leftover tricks don't matter. */
export function allFlagsMatched(cards: readonly TrickCard[]): boolean {
  return cards.every((card) => card.trick !== undefined || card.state === "matched");
}

/**
 * Bomb: shuffle every face-down card into the face-down slots. Returns the new
 * order (indices into the old array) so visuals can follow. Mutates `cards`.
 */
export function reshuffleDown(cards: TrickCard[], pickIndex: (maxExclusive: number) => number): void {
  const slots: number[] = [];
  cards.forEach((card, index) => {
    if (card.state === "down") slots.push(index);
  });
  const moved = shuffleInPlace(
    slots.map((index) => cards[index]!),
    pickIndex,
  );
  slots.forEach((slot, i) => {
    cards[slot] = moved[i]!;
  });
}

/** Leader among everyone but `self` (first index on ties), or -1. */
export function leaderExcept(scores: readonly number[], self: number): number {
  let best = -1;
  scores.forEach((score, index) => {
    if (index === self) return;
    if (best < 0 || score > scores[best]!) best = index;
  });
  return best;
}

/** Lowest score among everyone but `self`, or -1. */
export function trailerExcept(scores: readonly number[], self: number): number {
  let worst = -1;
  scores.forEach((score, index) => {
    if (index === self) return;
    if (worst < 0 || score < scores[worst]!) worst = index;
  });
  return worst;
}

/** Thief: a quarter of the victim's points, at least 3 (never more than they have). */
export function stealAmount(victimScore: number): number {
  if (victimScore <= 0) return 0;
  return Math.min(victimScore, Math.max(3, Math.ceil(victimScore * 0.25)));
}

export interface TrickOutcome {
  scores: number[];
  /** Who got hit (-1 for none). */
  target: number;
  /** Points moved or earned by the flipper (may be negative for a backfired swap). */
  delta: number;
}

/**
 * Score side of a trick. The swap trades with the leader — unless you ARE the
 * leader, in which case it backfires and trades with last place.
 */
export function applyTrickScores(kind: TrickKind, scores: readonly number[], self: number): TrickOutcome {
  const next = [...scores];
  const mine = next[self] ?? 0;
  if (kind === "jackpot") {
    next[self] = mine + JACKPOT_POINTS;
    return { scores: next, target: -1, delta: JACKPOT_POINTS };
  }
  if (kind === "thief") {
    const target = leaderExcept(next, self);
    if (target < 0) return { scores: next, target: -1, delta: 0 };
    const amount = stealAmount(next[target] ?? 0);
    next[target] = (next[target] ?? 0) - amount;
    next[self] = mine + amount;
    return { scores: next, target, delta: amount };
  }
  if (kind === "swap") {
    const leader = leaderExcept(next, self);
    if (leader < 0) return { scores: next, target: -1, delta: 0 };
    const target = (next[leader] ?? 0) > mine ? leader : trailerExcept(next, self);
    const theirs = next[target] ?? 0;
    next[target] = mine;
    next[self] = theirs;
    return { scores: next, target, delta: theirs - mine };
  }
  return { scores: next, target: -1, delta: 0 };
}

/** Catch-up: trailing the leader by 5+ pays +1 per match, 10+ pays +2. */
export function underdogBonus(scores: readonly number[], self: number): number {
  const leader = leaderExcept(scores, self);
  if (leader < 0) return 0;
  const gap = (scores[leader] ?? 0) - (scores[self] ?? 0);
  if (gap >= 10) return 2;
  if (gap >= 5) return 1;
  return 0;
}

/** Final frenzy: the last few pairs on the board pay double. */
export function inFrenzy(pairsLeftBeforeMatch: number): boolean {
  return pairsLeftBeforeMatch > 0 && pairsLeftBeforeMatch <= FRENZY_PAIRS;
}

/** Tip-off: matching a face your opponent just showed everyone on their miss. */
export function snipeBonus(lastMissFaces: readonly string[], lastMisser: number, face: string, matcher: number): number {
  return lastMisser >= 0 && lastMisser !== matcher && lastMissFaces.includes(face) ? SNIPE_BONUS : 0;
}

export interface MatchBonuses {
  frenzy: boolean;
  underdog: number;
  snipe: number;
}

/** Everything on one match: combo × fever × golden × frenzy, plus flat catch-up bonuses. */
export function totalMatchPoints(
  streak: number,
  remainingPairsAfter: number,
  golden: boolean,
  bonuses: MatchBonuses,
): number {
  const core = scoreMatch(streak, remainingPairsAfter, golden) * (bonuses.frenzy ? FRENZY_FACTOR : 1);
  return core + bonuses.underdog + bonuses.snipe;
}

/** Shot clock per flip for humans: 9s on a full board, tightening to 4s at the end. */
export function turnClockSeconds(pairsLeft: number, totalPairs = FLAG_PAIRS): number {
  const t = Math.max(0, Math.min(1, pairsLeft / Math.max(1, totalPairs)));
  return Math.round((4 + 5 * t) * 10) / 10;
}

/**
 * "It was RIGHT THERE": the mate of a missed card had already been shown
 * face-up somewhere else and was still on the board.
 */
export function missedObvious(
  cards: readonly TrickCard[],
  seen: ReadonlySet<number>,
  firstIndex: number,
  secondIndex: number,
): boolean {
  const face = cards[firstIndex]?.face;
  if (!face) return false;
  return cards.some(
    (card, index) =>
      index !== firstIndex && index !== secondIndex && card.face === face && card.state !== "matched" && seen.has(index),
  );
}

/* --------------------------- bot personalities --------------------------- */

export interface BotPersona {
  id: string;
  label: string;
  /** How many card sightings it can hold. */
  memory: number;
  /** Seconds it "thinks" before each flip. */
  think: number;
  /** Chance to ignore what it knows and flip something random. */
  yolo: number;
  match: readonly string[];
  miss: readonly string[];
}

export const BOT_PERSONAS: readonly BotPersona[] = [
  {
    id: "shark",
    label: "SHARK",
    memory: 12,
    think: 0.32,
    yolo: 0,
    match: ["Smells like points.", "Too easy.", "Chomp.", "I never forget a flag."],
    miss: ["...that was a test.", "Calculated. Mostly.", "The ocean is vast."],
  },
  {
    id: "goldfish",
    label: "GOLDFISH",
    memory: 3,
    think: 0.6,
    yolo: 0.1,
    match: ["Wait, I did that?!", "Ooh, shiny!", "Blub blub YES!"],
    miss: ["What were we doing?", "Hi! Who are you?", "I forgot I forgot.", "Blub."],
  },
  {
    id: "gambler",
    label: "GAMBLER",
    memory: 7,
    think: 0.45,
    yolo: 0.3,
    match: ["Let it RIDE!", "Feeling lucky!", "House always wins."],
    miss: ["Double or nothing.", "Rigged deck!", "I'll win it back."],
  },
  {
    id: "professor",
    label: "PROFESSOR",
    memory: 9,
    think: 0.9,
    yolo: 0,
    match: ["Elementary.", "As my research predicted.", "Quod erat demonstrandum."],
    miss: ["Fascinating. Wrong, but fascinating.", "Peer review pending.", "Hmm. Recalculating."],
  },
];

/** Hand out personas to bot seats (distinct while they last). */
export function assignPersonas(botCount: number, pickIndex: (maxExclusive: number) => number): BotPersona[] {
  const order = shuffleInPlace([...BOT_PERSONAS], pickIndex);
  return Array.from({ length: botCount }, (_, i) => order[i % order.length]!);
}

/* ------------------------------- announcer ------------------------------- */

export const QUIPS = {
  miss: [
    "Swing and a miss!",
    "Nope.",
    "Not even close, {name}.",
    "{name} is just flipping for fun now.",
    "The flags are judging you.",
    "Bold strategy, {name}.",
  ],
  obvious: [
    "IT WAS RIGHT THERE, {name}!",
    "{name}, we ALL saw that one.",
    "Goldfish energy from {name}.",
    "The crowd groans at {name}.",
  ],
  streak: ["{name} is cooking!", "Somebody stop {name}!", "{name} has the hot hand!", "Is {name} cheating?!"],
  fever: ["FEVER! {name} can't miss!", "{name} is ON FIRE!"],
  feverOver: ["Fever broken! {name} cools off.", "And {name} chokes!", "The streak dies with {name}."],
  timeout: ["Too slow, {name}! Picked one for you.", "Tick tock, {name}!", "{name} fell asleep."],
  snipe: ["Thanks for the tip, {victim}!", "{name} snipes {victim}'s flag!", "{victim} set it up, {name} cashed it in."],
  underdog: ["Underdog bonus for {name}!", "{name} claws back!"],
  thief: ["{name} pickpockets {victim} for {n}!", "Yoink! {name} robs {victim}!"],
  thiefEmpty: ["{name} tries to rob {victim}... their pockets are empty."],
  swap: ["{name} swaps scores with {victim}! Chaos!", "Identity theft! {name} ⇄ {victim}!"],
  swapBackfire: ["BACKFIRE! Leader {name} swaps with {victim}!", "{name} was winning... WAS."],
  bomb: ["KABOOM! {name} scrambles the board!", "{name} blew it up. Literally."],
  peek: ["X-RAY! Memorize fast!", "{name} peeks behind the curtain!"],
  jackpot: ["JACKPOT! +5 for {name}!"],
  frenzy: ["FINAL FRENZY! Every pair pays double!"],
  golden: ["GOLDEN PAIR! {name} strikes gold!"],
} as const;

export type QuipKind = keyof typeof QUIPS;

/** Fill `{name}`-style holes in an announcer line. */
export function fillLine(line: string, vars: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

export function pickLine(kind: QuipKind, vars: Record<string, string | number>, pickIndex: (maxExclusive: number) => number): string {
  const lines = QUIPS[kind];
  return fillLine(lines[pickIndex(lines.length)] ?? lines[0]!, vars);
}
