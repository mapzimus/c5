import { botAim } from "./rules";
import { BOARD, RADII, type DropWorld } from "./physics";

/**
 * Sprint: everyone plays at once on their own board for 90 seconds, in lockstep.
 * One shared deck of orbs; one shared beat. Each beat every board gets the same orb,
 * and anyone who has not dropped when the beat ends drops where they are aiming.
 * Overflowing is a BUST (lose a quarter of the board's points, get a fresh board),
 * never an elimination. The last 20 seconds are OVERDRIVE: every merge pays double.
 */
export const SPRINT = {
  /** Seconds of beats. */
  duration: 90,
  /** Seconds the boards keep simulating after the last beat so late merges count. */
  settle: 3,
  /** Fraction of a board's points lost on a bust. */
  bustPenalty: 0.25,
  /** A settled orb above the line for this long busts the board (classic waits 3s). */
  dangerLimit: 2.5,
  /** The bust line sits lower than classic's 105: the usable board is about 360 tall. */
  dangerLine: 260,
  shakeCost: 6,
  /** Anyone behind the leader charges a shake faster. */
  underdogShakeCost: 4,
  /** A beat may end early once everyone has dropped, but never before this. */
  minBeat: 0.6,
  /** Versioned record key: sprint scores are not comparable with endless runs. */
  bestVersion: "sprint-v1",
} as const;

export interface Stage {
  /** Sprint second this stage starts at. */
  at: number;
  name: string;
  /** Drop odds for 1/2/4/8/16 in percent; sums to 100. */
  odds: readonly [number, number, number, number, number];
  /** Seconds per beat. */
  beat: number;
  /** Score multiplier for every merge and bonus. */
  multiplier: number;
  /** What changed, shown on the stage callout. */
  news: string;
}

export const STAGES: readonly Stage[] = [
  { at: 0, name: "STAGE 1", odds: [65, 25, 10, 0, 0], beat: 2.3, multiplier: 1, news: "" },
  { at: 25, name: "STAGE 2", odds: [52, 27, 14, 7, 0], beat: 2.0, multiplier: 1, news: "8s NOW DROP" },
  { at: 50, name: "STAGE 3", odds: [42, 26, 17, 10, 5], beat: 1.7, multiplier: 1, news: "16s NOW DROP · FASTER BEAT" },
  { at: 70, name: "OVERDRIVE", odds: [36, 26, 18, 12, 8], beat: 1.4, multiplier: 2, news: "EVERY MERGE ×2" },
];

export function stageIndex(t: number): number {
  let index = 0;
  for (let i = 0; i < STAGES.length; i++) if (t >= STAGES[i]!.at) index = i;
  return index;
}

export function stageAt(t: number): Stage {
  return STAGES[stageIndex(t)]!;
}

export function isOverdrive(t: number): boolean {
  return stageAt(t).multiplier > 1;
}

export function beatLength(t: number): number {
  return stageAt(t).beat;
}

/** Map a uniform roll in [0, 1) to a drop tier using the odds at sprint second `t`. */
export function rollSprintTier(n: number, t: number): number {
  const { odds } = stageAt(t);
  let edge = 0;
  for (let tier = 0; tier < odds.length; tier++) {
    edge += odds[tier]! / 100;
    if (n < edge) return tier;
  }
  return 0;
}

/** Points lost when a board overflows; rounded to tens so it reads cleanly. */
export function bustPenalty(score: number): number {
  return Math.round(score * SPRINT.bustPenalty / 10) * 10;
}

/** Merges needed for a shake: four when behind the leader, six in front (or tied). */
export function shakeCost(score: number, leader: number): number {
  return score < leader ? SPRINT.underdogShakeCost : SPRINT.shakeCost;
}

/**
 * The shared deck: tier `i` is rolled the first time anyone asks for it, with the odds
 * of the sprint second it was asked at. Since every board is in lockstep, each board
 * gets exactly the same orbs no matter how its score compares.
 */
export class SharedDeck {
  private readonly tiers: number[] = [];

  constructor(private readonly random: () => number, private readonly clock: () => number) {}

  at(index: number): number {
    while (this.tiers.length <= index) this.tiers.push(rollSprintTier(this.random(), this.clock()));
    return this.tiers[index]!;
  }

  get rolled(): number {
    return this.tiers.length;
  }
}

export interface Layout {
  /** Board scale (1 = the classic 480×630). */
  scale: number;
  boardW: number;
  boardH: number;
  /** Top of the per-board headers; the shared strip sits above. */
  top: number;
  headerH: number;
  footerH: number;
  gap: number;
  /** Left edge of each board. */
  xs: number[];
  /** Top of the boards themselves. */
  boardY: number;
}

/** Side-by-side boards for 1–4 players, scaled to fit under the shared strip. */
export function layout(count: number, width: number, height: number, minTap: number): Layout {
  const top = 92, headerH = 46, gap = 16, footerH = Math.max(58, minTap) + 6;
  const n = Math.max(1, count);
  const scaleW = (width - gap * (n + 1)) / (BOARD.width * n);
  const scaleH = (height - top - headerH - footerH - 10) / BOARD.height;
  const scale = Math.min(1, scaleW, scaleH);
  const boardW = BOARD.width * scale, boardH = BOARD.height * scale;
  const total = n * boardW + (n - 1) * gap;
  const x0 = (width - total) / 2;
  const xs = Array.from({ length: n }, (_, i) => x0 + i * (boardW + gap));
  return { scale, boardW, boardH, top, headerH, footerH, gap, xs, boardY: top + headerH };
}

/** Format sprint seconds left as m:ss. */
export function clockText(left: number): string {
  const s = Math.max(0, Math.ceil(left));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A bot's plan for one beat: when in the beat it drops (it hesitates longer early and
 * snaps faster in OVERDRIVE) and where. Roughly one drop in eight is a sloppy one so
 * bots are beatable; a few go wide on purpose when the middle is tall.
 */
export function botBeat(world: DropWorld, t: number, random: () => number): { wait: number; aim: number } {
  const beat = beatLength(t);
  const wait = SPRINT.minBeat + random() * Math.max(0.2, beat - SPRINT.minBeat - 0.35);
  const sloppy = random() < 0.12;
  const aim = sloppy ? world.clampAim(BOARD.left + random() * (BOARD.right - BOARD.left)) : botAim(world);
  return { wait, aim };
}

/** Bots shake when charged and the stack is getting tall, but sometimes forget. */
export function botWantsShake(world: DropWorld, cost: number, random: () => number): boolean {
  if (world.charge < cost || world.over) return false;
  const tall = world.balls.some(ball => ball.y - ball.radius < world.dangerLine + RADII[4] * 2);
  return tall && random() < 0.75;
}
