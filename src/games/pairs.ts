import { fillArena } from "../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../fx/juice";
import { PLAYER_BINDS } from "../core/input";
import { type GameContext, GameDefinition, GameInstance, type GameStat } from "../core/types";
import { FLAGS, PAIR_COUNT } from "./flags";
import {
  hitCard,
  hitChip,
  layoutChips,
  layoutPairBoard,
  midpoint,
  type BoardLayout,
  type ChipLayout,
} from "./pairs-layout";
import {
  BOT_MEMORY_LIMIT,
  GOLDEN_FACTOR,
  SHAKE_COUNT,
  SNAP_PENALTY,
  applyPenalty,
  bestHumanScore,
  forgetCards,
  hatTrick,
  isUnderdog,
  lastCall,
  missesUntilShake,
  pickBotSnap,
  pickDownIndices,
  pickShakeIndices,
  shakeDue,
  shakeUp,
  feverMultiplier,
  inFever,
  scoreMatch,
  scoreSnap,
  canFlip,
  dealPairs,
  glimpseIndices,
  nextStreak,
  nextTurnIndex,
  pickFaces,
  pickKnownIndex,
  remainingPairs,
  rememberCard,
  stepCursor,
  type CardState,
  type PairCard,
} from "./pairs-logic";

const BEST_VERSION = "v2-snap";
const PEEK_SECONDS = 5;
const FLIP_SECONDS = 0.22;
const HOLD_SECONDS = 0.38;
const MATCH_LOCK = 0.3;
const MISS_LOCK = 0.22;
const SHAKE_SECONDS = 0.7;
/** Shot clock per flip for human seats. Bots are always quick. */
const TURN_SECONDS = 8;
const SNAP_FAIL_HOLD = 0.65;
const SNAP_LOCKOUT = 5;
/** After lifting a finger from a badge, a card tap still counts as that seat's snap for this long. */
const ARM_GRACE = 1.4;
const PEEK_GLINT = 0.95;

type Phase = "peek" | "closing" | "play" | "done";

interface Visual {
  flipT: number;
  from: CardState;
  to: CardState;
  bounce: number;
  miss: number;
  /** 1 → 0 while the card slides in from `slideFrom` during a shake-up. */
  slide: number;
  slideFrom: number;
  /** Seconds left of an underdog peek showing this face-down card. */
  glint: number;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Armed {
  seat: number;
  /** Real time until which a lifted finger still counts (tap badge, then tap card). */
  until: number;
  /** Pointers currently holding the badge (hold badge, tap card with another finger). */
  pointers: Set<number>;
}

class PairsGame implements GameInstance {
  private readonly cards: PairCard[];
  private readonly scores: number[];
  /** One memory per seat (bots only): what each bot noticed, capped by its own attention span. */
  private readonly memories: Map<string, number[]>[];
  private readonly recencies: number[][];
  private readonly attention: number[];
  private readonly memLimit: number[];
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly names = new Map<string, string>();
  private readonly visuals: Visual[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly goldenFace: string;
  private best: number;
  private beatBest = false;
  private readonly startBest: number;
  private time = 0;
  private readonly matches: number[];
  private readonly snaps: number[];
  private readonly bestStreak: number[];
  private readonly snapLock: number[];
  private readonly botSnapTimer: number[];
  private readonly floaters: Floater[] = [];
  private turn = 0;
  private streak = 0;
  private misses = 0;
  private shakePending = false;
  private shakeFlash = 0;
  private flipped: number[] = [];
  private snapBack: number[] = [];
  private armed: Armed | null = null;
  private pendingSnap: { seat: number; index: number } | null = null;
  private lock = 0;
  private botWait = 0;
  private turnClock = TURN_SECONDS;
  private lastCallShown = false;
  private lastCallFlash = 0;
  private phase: Phase = "peek";
  private peekLeft = PEEK_SECONDS;
  private cursor = 0;
  private useCursor = false;
  private layout: BoardLayout = layoutPairBoard(1280, 720, 2);
  private chips: ChipLayout[] = [];

  constructor(private readonly ctx: GameContext) {
    this.best = loadBest("pairs", BEST_VERSION);
    this.startBest = this.best;
    const faces = pickFaces(
      FLAGS.map((flag) => flag.id),
      PAIR_COUNT,
      (max) => this.ctx.rng.int(0, max - 1),
    );
    this.cards = dealPairs(faces, (max) => this.ctx.rng.int(0, max - 1));
    this.goldenFace = this.ctx.rng.pick(faces) ?? faces[0] ?? "";
    this.juice = new Juice();
    this.scores = this.ctx.players.map(() => 0);
    this.matches = this.ctx.players.map(() => 0);
    this.snaps = this.ctx.players.map(() => 0);
    this.bestStreak = this.ctx.players.map(() => 0);
    this.snapLock = this.ctx.players.map(() => 0);
    this.botSnapTimer = this.ctx.players.map(() => Infinity);
    this.memories = this.ctx.players.map(() => new Map<string, number[]>());
    this.recencies = this.ctx.players.map(() => []);
    // Bots differ: some watch closely and remember more, some drift and miss flips.
    this.attention = this.ctx.players.map(() => 0.72 + this.ctx.rng.next() * 0.2);
    this.memLimit = this.ctx.players.map(() => BOT_MEMORY_LIMIT - 2 + this.ctx.rng.int(0, 3));
    this.visuals = this.cards.map(() => ({
      flipT: 0,
      from: "up",
      to: "up",
      bounce: 0,
      miss: 0,
      slide: 0,
      slideFrom: 0,
      glint: 0,
    }));
    this.loadFlags(new Set(faces));
    this.ctx.players.forEach((player, seat) => {
      if (player.kind !== "bot") return;
      const limit = this.memLimit[seat] ?? BOT_MEMORY_LIMIT;
      for (const index of glimpseIndices(this.cards.length, limit, (max) => this.ctx.rng.int(0, max - 1))) {
        const card = this.cards[index];
        if (card) rememberCard(this.memories[seat]!, this.recencies[seat]!, index, card.face, limit);
      }
    });
    this.syncLayout();
    const canvas = this.ctx.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  private syncLayout(): void {
    this.layout = layoutPairBoard(this.ctx.width, this.ctx.height, this.ctx.players.length);
    this.chips = layoutChips(this.ctx.width, this.ctx.players.length, this.layout.narrow, this.ctx.minTap);
  }

  /** Every bot watches every flip, but only the seat that flipped is guaranteed to remember it. */
  private observe(index: number, face: string, bySeat: number | null): void {
    this.ctx.players.forEach((player, seat) => {
      if (player.kind !== "bot") return;
      if (seat !== bySeat && this.ctx.rng.next() > (this.attention[seat] ?? 1)) return;
      rememberCard(this.memories[seat]!, this.recencies[seat]!, index, face, this.memLimit[seat] ?? BOT_MEMORY_LIMIT);
    });
  }

  private memoryOf(seat: number): Map<string, number[]> {
    return this.memories[seat] ?? new Map<string, number[]>();
  }

  private loadFlags(faces: Set<string>): void {
    const base = import.meta.env.BASE_URL;
    for (const flag of FLAGS) {
      if (!faces.has(flag.id)) continue;
      const img = new Image();
      img.src = `${base}flags/${flag.file}`;
      this.images.set(flag.id, img);
      this.names.set(flag.id, flag.name);
    }
  }

  // ---- sideline SNAP input (multi-touch, by pointerId) ----

  private toLogical(event: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / (rect.width || 1)) * this.ctx.width,
      y: ((event.clientY - rect.top) / (rect.height || 1)) * this.ctx.height,
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.phase !== "play") return;
    const p = this.toLogical(event);
    const chip = hitChip(this.chips, p.x, p.y);
    if (chip !== null) {
      const seat = this.ctx.players[chip];
      if (seat?.kind === "human" && chip !== this.turn) this.arm(chip, event.pointerId);
      return;
    }
    const index = hitCard(this.layout, p.x, p.y);
    if (index === null || !this.armed || this.armed.seat === this.turn) return;
    if (this.armed.pointers.size === 0 && this.armed.until <= this.time) return;
    this.pendingSnap = { seat: this.armed.seat, index };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.armed || !this.armed.pointers.has(event.pointerId)) return;
    this.armed.pointers.delete(event.pointerId);
    if (this.armed.pointers.size === 0) this.armed.until = this.time + ARM_GRACE;
  };

  private arm(seat: number, pointerId: number | null): void {
    if (!this.armed || this.armed.seat !== seat) {
      this.armed = { seat, until: this.time + ARM_GRACE, pointers: new Set() };
      this.ctx.sfx.select();
    }
    this.armed.until = this.time + ARM_GRACE;
    if (pointerId !== null) this.armed.pointers.add(pointerId);
  }

  private armedSeat(): number | null {
    if (!this.armed) return null;
    if (this.armed.pointers.size === 0 && this.armed.until <= this.time) return null;
    return this.armed.seat;
  }

  private snapWindowOpen(): boolean {
    return (
      this.phase === "play" &&
      this.flipped.length === 1 &&
      this.lock <= 0 &&
      this.snapBack.length === 0 &&
      !this.shakePending
    );
  }

  private canSnap(seat: number): boolean {
    return seat !== this.turn && (this.snapLock[seat] ?? 0) <= this.time;
  }

  // ---- update ----

  update(realDt: number): void {
    this.syncLayout();
    const dt = this.juice.update(realDt);
    this.callouts.update(realDt);
    this.time += realDt;
    this.updateVisuals(dt);
    this.updateFx(dt);
    if (this.phase === "done") return;

    if (this.phase === "peek") {
      this.peekLeft -= dt;
      const click = this.ctx.input.consumeClick();
      const skipped =
        this.peekLeft < PEEK_SECONDS - 0.55 &&
        (Boolean(click) || this.ctx.input.justPressed("Space") || this.ctx.input.justPressed("Enter"));
      if (this.peekLeft <= 0 || skipped) this.beginClose();
      return;
    }

    if (this.phase === "closing") {
      if (this.visuals.every((visual) => visual.flipT <= 0)) {
        this.phase = "play";
        this.setTurn(0, true);
      }
      return;
    }

    this.lock = Math.max(0, this.lock - dt);
    if (this.lock > 0) {
      this.pendingSnap = null;
      this.ctx.input.consumeClick();
      return;
    }

    if (this.snapBack.length > 0) {
      for (const index of this.snapBack) {
        const card = this.cards[index];
        if (card && card.state === "up") {
          card.state = "down";
          this.startFlip(index, "up", "down");
        }
      }
      this.snapBack = [];
      this.lock = FLIP_SECONDS;
      return;
    }

    if (this.flipped.length === 2) {
      this.resolvePair();
      return;
    }

    if (this.shakePending) {
      this.shakePending = false;
      this.runShakeUp();
      return;
    }

    if (this.allMatched()) {
      this.phase = "done";
      return;
    }

    if (this.handleSnaps(dt)) return;

    const player = this.ctx.players[this.turn];
    if (player?.kind === "bot") {
      this.botWait -= dt;
      if (this.botWait <= 0) {
        const index = this.chooseBotIndex();
        this.tryFlip(index);
        this.botWait = this.botThinkTime();
      }
      return;
    }

    this.botWait = 0.4;
    this.turnClock -= dt;
    if (this.turnClock <= 0) {
      this.timeOut();
      return;
    }
    this.handleHumanInput(player?.slot ?? 0);
  }

  /** Sideline snaps from humans (badge + card) and bots. Returns true when one resolved this frame. */
  private handleSnaps(dt: number): boolean {
    const open = this.snapWindowOpen();
    // Keyboard arming: a sideline seat presses its own action key.
    this.ctx.players.forEach((seat, index) => {
      if (seat.kind !== "human" || index === this.turn) return;
      if (this.ctx.input.actionPressed(seat.slot)) this.arm(index, null);
    });

    const pending = this.pendingSnap;
    this.pendingSnap = null;
    if (pending) {
      this.ctx.input.consumeClick();
      if (open && this.canSnap(pending.seat)) {
        this.resolveSnap(pending.seat, pending.index);
        return true;
      }
    }

    if (!open) return false;
    const first = this.flipped[0];
    if (first === undefined) return false;
    for (let seat = 0; seat < this.ctx.players.length; seat += 1) {
      const player = this.ctx.players[seat];
      if (player?.kind !== "bot" || !this.canSnap(seat)) continue;
      const timer = (this.botSnapTimer[seat] ?? Infinity) - dt;
      this.botSnapTimer[seat] = timer;
      if (timer > 0) continue;
      this.botSnapTimer[seat] = Infinity;
      const index = pickBotSnap(this.cards, this.memoryOf(seat), first, this.ctx.rng.next(), (max) =>
        this.ctx.rng.int(0, max - 1),
      );
      if (index >= 0 && index !== first && canFlip(this.cards[index])) {
        this.resolveSnap(seat, index);
        return true;
      }
    }
    return false;
  }

  /** Sideline bots wake up a beat after the first card shows; trailing bots are hungrier. */
  private openSnapWindow(): void {
    this.ctx.players.forEach((player, seat) => {
      if (player.kind !== "bot" || seat === this.turn) {
        this.botSnapTimer[seat] = Infinity;
        return;
      }
      const trailing = (this.scores[seat] ?? 0) < (this.scores[this.turn] ?? 0);
      this.botSnapTimer[seat] = (trailing ? 0.35 : 0.5) + this.ctx.rng.next() * 0.6;
    });
  }

  private botThinkTime(): number {
    const first = this.flipped[0];
    if (first === undefined || this.flipped.length !== 1) return 0.4;
    const knowsMate = pickKnownIndex(this.cards, this.memoryOf(this.turn), first) >= 0;
    // Knowing the mate: snap it fast. Guessing: hesitate, which is the sideline's chance.
    return knowsMate ? 0.32 + this.ctx.rng.next() * 0.15 : 0.8 + this.ctx.rng.next() * 0.5;
  }

  private beginClose(): void {
    this.phase = "closing";
    this.cards.forEach((card, index) => {
      this.startFlip(index, "up", "down");
      card.state = "down";
    });
  }

  private setTurn(next: number, force = false): void {
    const changed = next !== this.turn;
    this.turn = next;
    this.turnClock = TURN_SECONDS;
    this.botWait = 0.4;
    if (this.armed?.seat === next) this.armed = null;
    if (changed || force) this.onTurnStart();
  }

  /** Comeback edge: a seat that is clearly last gets a flash of two hidden cards. */
  private onTurnStart(): void {
    if (this.shakePending || !isUnderdog(this.scores, this.turn) || remainingPairs(this.cards) < 2) return;
    const indices = pickDownIndices(this.cards, 2, (max) => this.ctx.rng.int(0, max - 1));
    if (indices.length < 2) return;
    const player = this.ctx.players[this.turn];
    for (const index of indices) {
      const visual = this.visuals[index];
      const card = this.cards[index];
      if (!visual || !card) continue;
      visual.glint = PEEK_GLINT;
      if (player?.kind === "bot") this.observe(index, card.face, this.turn);
    }
    this.callouts.show("UNDERDOG PEEK", player?.color ?? "#3EE0FF", { y: 0.2, size: 40, life: 1 });
    this.ctx.sfx.select();
    this.lock = 0.4;
  }

  private handleHumanInput(slot: 0 | 1 | 2 | 3): void {
    const click = this.ctx.input.consumeClick();
    if (click) {
      this.useCursor = false;
      const index = hitCard(this.layout, click.x, click.y);
      if (index !== null) {
        this.cursor = index;
        this.tryFlip(index);
        this.parkCursor();
      }
      return;
    }

    const left = this.pressed(slot, "left") || this.ctx.input.justPressed("ArrowLeft") || this.ctx.input.justPressed("KeyA");
    const right = this.pressed(slot, "right") || this.ctx.input.justPressed("ArrowRight") || this.ctx.input.justPressed("KeyD");
    const up = this.pressed(slot, "up") || this.ctx.input.justPressed("ArrowUp") || this.ctx.input.justPressed("KeyW");
    const down = this.pressed(slot, "down") || this.ctx.input.justPressed("ArrowDown") || this.ctx.input.justPressed("KeyS");
    if (left || right || up || down) this.useCursor = true;
    if (left) this.moveCursor(-1, 0);
    else if (right) this.moveCursor(1, 0);
    else if (up) this.moveCursor(0, -1);
    else if (down) this.moveCursor(0, 1);

    // Space/Enter are generic flip keys unless a sideline human owns them as its SNAP key.
    const sidelineKeys = new Set(
      this.ctx.players
        .filter((seat, index) => seat.kind === "human" && index !== this.turn)
        .map((seat) => PLAYER_BINDS[seat.slot]!.action),
    );
    const generic = ["Space", "Enter"].some((code) => !sidelineKeys.has(code) && this.ctx.input.justPressed(code));
    if (this.ctx.input.actionPressed(slot) || generic) {
      this.useCursor = true;
      this.tryFlip(this.cursor);
    }
  }

  private pressed(slot: 0 | 1 | 2 | 3, dir: "left" | "right" | "up" | "down"): boolean {
    return this.ctx.input.justPressed(PLAYER_BINDS[slot]![dir]);
  }

  private moveCursor(dx: number, dy: number): void {
    this.cursor = stepCursor(this.cursor, dx, dy, this.layout.cols, this.layout.rows, (index) => canFlip(this.cards[index]));
  }

  private parkCursor(): void {
    if (canFlip(this.cards[this.cursor])) return;
    const next = this.cards.findIndex((card) => canFlip(card));
    if (next >= 0) this.cursor = next;
  }

  private tryFlip(index: number): void {
    const card = this.cards[index];
    if (!canFlip(card) || this.flipped.includes(index)) return;
    card.state = "up";
    this.flipped.push(index);
    this.startFlip(index, "down", "up");
    this.observe(index, card.face, this.turn);
    this.ctx.sfx.tick();
    this.turnClock = TURN_SECONDS;
    if (this.flipped.length === 2) this.lock = FLIP_SECONDS + HOLD_SECONDS;
    else this.openSnapWindow();
  }

  /** Human shot clock ran out: the open card closes, it counts as a miss, the turn moves on. */
  private timeOut(): void {
    const first = this.flipped[0];
    if (first !== undefined) {
      const card = this.cards[first]!;
      card.state = "down";
      this.startFlip(first, "up", "down");
      this.visuals[first]!.miss = 1;
    }
    this.flipped = [];
    this.streak = 0;
    this.misses += 1;
    if (shakeDue(this.misses)) this.shakePending = true;
    const player = this.ctx.players[this.turn];
    this.callouts.show("TOO SLOW", player?.color ?? "#94a3b8", { size: 56, life: 1 });
    this.ctx.sfx.miss();
    this.juice.shake(0.18);
    this.lock = MISS_LOCK;
    this.setTurn(nextTurnIndex(this.turn, this.ctx.players.length, false));
    this.parkCursor();
  }

  private resolvePair(): void {
    const aIndex = this.flipped[0]!;
    const bIndex = this.flipped[1]!;
    const a = this.cards[aIndex]!;
    const b = this.cards[bIndex]!;
    const matched = a.face === b.face;
    const wasFever = inFever(this.streak);
    this.streak = nextStreak(this.streak, matched);

    if (matched) {
      a.state = "matched";
      b.state = "matched";
      this.visuals[aIndex]!.bounce = 1;
      this.visuals[bIndex]!.bounce = 1;
      this.visuals[aIndex]!.to = "matched";
      this.visuals[bIndex]!.to = "matched";
      const golden = a.face === this.goldenFace;
      const points = scoreMatch(this.streak, remainingPairs(this.cards), golden);
      this.scores[this.turn] = (this.scores[this.turn] ?? 0) + points;
      this.matches[this.turn] = (this.matches[this.turn] ?? 0) + 1;
      if (this.streak > (this.bestStreak[this.turn] ?? 0)) this.bestStreak[this.turn] = this.streak;
      this.burst(aIndex, bIndex, points, a.face, golden, this.turn, false);
      if (this.streak >= 2) this.ctx.sfx.streak(this.streak);
      else this.ctx.sfx.collect();
      this.matchCallouts(golden);
      this.checkBest();
      this.checkLastCall();
      this.lock = MATCH_LOCK;
    } else {
      a.state = "down";
      b.state = "down";
      this.startFlip(aIndex, "up", "down");
      this.startFlip(bIndex, "up", "down");
      this.visuals[aIndex]!.miss = 1;
      this.visuals[bIndex]!.miss = 1;
      this.ctx.sfx.miss();
      if (wasFever) {
        this.juice.shake(0.3);
        this.callouts.show("FEVER OVER", "#94a3b8", { size: 44, life: 0.9 });
      } else {
        this.juice.shake(0.12);
      }
      this.lock = MISS_LOCK;
      this.misses += 1;
      if (shakeDue(this.misses)) this.shakePending = true;
    }
    const next = nextTurnIndex(this.turn, this.ctx.players.length, matched, this.streak);
    if (matched && hatTrick(this.streak) && next !== this.turn) {
      this.callouts.show("HAT-TRICK  ·  PASS IT ON", "#FFB020", { y: 0.42, size: 46, life: 1.3 });
      this.streak = 0;
    }
    this.flipped = [];
    this.setTurn(next);
    this.parkCursor();
  }

  /** A sideline seat snaps `index` as the mate of the face-up card. Right: steal. Wrong: pay. */
  private resolveSnap(seat: number, index: number): void {
    const firstIndex = this.flipped[0];
    if (firstIndex === undefined || index === firstIndex) return;
    const first = this.cards[firstIndex];
    const card = this.cards[index];
    if (!first || !canFlip(card)) return;
    const player = this.ctx.players[seat];
    const color = player?.color ?? "#F4F7FB";
    card.state = "up";
    this.startFlip(index, "down", "up");
    this.observe(index, card.face, seat);
    this.armed = null;

    if (card.face === first.face) {
      first.state = "matched";
      card.state = "matched";
      this.visuals[firstIndex]!.to = "matched";
      this.visuals[index]!.to = "matched";
      this.visuals[firstIndex]!.bounce = 1;
      this.visuals[index]!.bounce = 1;
      const golden = card.face === this.goldenFace;
      const points = scoreSnap(remainingPairs(this.cards), golden);
      this.scores[seat] = (this.scores[seat] ?? 0) + points;
      this.matches[seat] = (this.matches[seat] ?? 0) + 1;
      this.snaps[seat] = (this.snaps[seat] ?? 0) + 1;
      this.streak = 0;
      this.flipped = [];
      this.burst(firstIndex, index, points, card.face, golden, seat, true);
      this.callouts.show(`${player?.name ?? "Someone"} SNAPS IT!`, color, { size: 66, life: 1.3 });
      this.juice.hitStop(golden ? 0.14 : 0.09);
      this.juice.shake(0.45);
      if (golden) {
        this.callouts.show(`GOLDEN SNAP  x${GOLDEN_FACTOR}`, "#FFD54A", { y: 0.46, size: 52, life: 1.4 });
        this.ctx.sfx.win();
      } else {
        this.ctx.sfx.streak(4);
      }
      this.checkBest();
      this.checkLastCall();
      this.lock = MATCH_LOCK + 0.25;
      this.turnClock = TURN_SECONDS;
      this.parkCursor();
      return;
    }

    // Wrong card: everyone sees it, the snapper pays and sits out for a bit, the turn carries on.
    this.scores[seat] = applyPenalty(this.scores[seat] ?? 0);
    this.snapLock[seat] = this.time + SNAP_LOCKOUT;
    this.snapBack = [index];
    this.visuals[index]!.miss = 1;
    this.lock = SNAP_FAIL_HOLD;
    this.callouts.show("SNAP FAIL", color, { size: 54, life: 1 });
    const slot = this.layout.slots[index]!;
    this.floaters.push({
      text: `-${SNAP_PENALTY}`,
      x: slot.x + this.layout.cardW / 2,
      y: slot.y + this.layout.cardH / 2 - 10,
      life: 1,
      max: 1,
      color,
      size: 30,
    });
    this.ctx.sfx.miss();
    this.juice.shake(0.2);
  }

  /** Rotate a few face-down tiles so nobody (bots included) can coast on old memories. */
  private runShakeUp(): void {
    const indices = pickShakeIndices(this.cards, SHAKE_COUNT, (max) => this.ctx.rng.int(0, max - 1));
    const moves = shakeUp(this.cards, indices);
    if (moves.length === 0) return;
    this.ctx.players.forEach((_, seat) => forgetCards(this.memories[seat]!, this.recencies[seat]!, indices));
    for (const move of moves) {
      const visual = this.visuals[move.to]!;
      visual.slide = 1;
      visual.slideFrom = move.from;
      visual.miss = 0;
      visual.bounce = 0;
      visual.glint = 0;
    }
    this.shakeFlash = 1;
    this.lock = SHAKE_SECONDS;
    this.ctx.sfx.whoosh();
    this.juice.shake(0.35);
    this.callouts.show("SHAKE-UP!", "#3EE0FF", { size: 64, life: 1.1 });
    this.parkCursor();
  }

  private matchCallouts(golden: boolean): void {
    const mult = feverMultiplier(this.streak);
    if (golden) {
      this.callouts.show(`GOLDEN PAIR  x${mult * GOLDEN_FACTOR}`, "#FFD54A", { size: 76, life: 1.5 });
      this.juice.hitStop(0.12);
      this.ctx.sfx.win();
    } else if (inFever(this.streak)) {
      this.callouts.show(`FEVER x${mult}`, "#FF4FD8", { size: 68 });
    }
  }

  private checkLastCall(): void {
    if (this.lastCallShown || !lastCall(remainingPairs(this.cards))) return;
    this.lastCallShown = true;
    this.lastCallFlash = 1;
    this.callouts.show("LAST CALL  ·  x2 STAKES", "#FF6A3D", { y: 0.5, size: 60, life: 1.6 });
    this.ctx.sfx.go();
    this.juice.shake(0.3);
  }

  private checkBest(): void {
    const top = bestHumanScore(this.ctx.players, this.scores);
    if (top === null || top <= this.best) return;
    this.best = top;
    saveBest("pairs", top, BEST_VERSION);
    if (!this.beatBest && this.startBest > 0) {
      this.beatBest = true;
      this.callouts.show("NEW BEST", "#B8FF3D", { y: 0.58, size: 60, life: 1.5 });
      this.ctx.sfx.win();
    }
  }

  private burst(
    aIndex: number,
    bIndex: number,
    points: number,
    face: string,
    golden: boolean,
    seat: number,
    snapped: boolean,
  ): void {
    const player = this.ctx.players[seat];
    const color = player?.color ?? "#3EE0FF";
    const mid = midpoint(this.layout, aIndex, bIndex);
    this.floaters.push({
      text: snapped ? `SNAP  +${points}` : `+${points}`,
      x: mid.x,
      y: mid.y - 18,
      life: 1.1,
      max: 1.1,
      color,
      size: snapped ? 40 : 36,
    });
    this.floaters.push({
      text: this.names.get(face) ?? face,
      x: mid.x,
      y: mid.y + 16,
      life: 1.15,
      max: 1.15,
      color: "#F4F7FB",
      size: 18,
    });
    if (!snapped && this.streak >= 2) {
      const mult = feverMultiplier(this.streak);
      this.floaters.push({
        text: mult > 1 ? `FEVER x${mult}  ·  STREAK ${this.streak}` : `STREAK ×${this.streak}`,
        x: mid.x,
        y: mid.y - 52,
        life: 1.2,
        max: 1.2,
        color: "#FFB020",
        size: 22,
      });
    }
    if (remainingPairs(this.cards) === 0) {
      this.floaters.push({
        text: "CLOSER",
        x: mid.x,
        y: mid.y - 78,
        life: 1.3,
        max: 1.3,
        color: "#B8FF3D",
        size: 20,
      });
    }
    const fever = !snapped && inFever(this.streak);
    const chip = this.chips[seat];
    for (const slot of [this.layout.slots[aIndex]!, this.layout.slots[bIndex]!]) {
      const cx = slot.x + this.layout.cardW / 2;
      const cy = slot.y + this.layout.cardH / 2;
      this.juice.burst(cx, cy, color, { count: 14, speed: 220, gravity: 300 });
      if (snapped) {
        this.juice.burst(cx, cy, [color, "#F4F7FB"], { count: 22, speed: 380, size: 5, life: 0.8 });
        if (chip) {
          // A streak of sparks flies toward the snapper's badge.
          const tx = chip.x + chip.w / 2;
          const ty = chip.y + chip.h / 2;
          const angle = Math.atan2(ty - cy, tx - cx);
          this.juice.burst(cx, cy, color, { count: 16, speed: 700, size: 4, gravity: 0, angle, spread: 0.25, life: 0.9 });
        }
      }
      if (fever) this.juice.burst(cx, cy, ["#FFB020", "#FF4FD8", "#F4F7FB"], { count: 12 + this.streak * 2, speed: 340, size: 5 });
      if (golden) {
        this.juice.burst(cx, cy, ["#FFD54A", "#FFF3B0", "#FFB020"], { count: 48, speed: 480, size: 6, life: 1.1 });
        this.juice.burst(cx, cy, ["#FFF3B0", "#F4F7FB"], { count: 18, speed: 160, size: 3, gravity: -60, life: 1.4 });
      }
    }
    this.juice.shake(golden ? 0.45 : fever ? 0.22 : 0.12);
  }

  private startFlip(index: number, from: CardState, to: CardState): void {
    const visual = this.visuals[index];
    if (!visual) return;
    visual.from = from;
    visual.to = to;
    visual.flipT = 0.001;
    visual.glint = 0;
  }

  private updateVisuals(dt: number): void {
    for (const visual of this.visuals) {
      if (visual.flipT > 0) {
        visual.flipT += dt / FLIP_SECONDS;
        if (visual.flipT >= 1) visual.flipT = 0;
      }
      if (visual.bounce > 0) visual.bounce = Math.max(0, visual.bounce - dt * 2.6);
      if (visual.miss > 0) visual.miss = Math.max(0, visual.miss - dt * 2.4);
      if (visual.slide > 0) visual.slide = Math.max(0, visual.slide - dt / SHAKE_SECONDS);
      if (visual.glint > 0) visual.glint = Math.max(0, visual.glint - dt);
    }
    if (this.shakeFlash > 0) this.shakeFlash = Math.max(0, this.shakeFlash - dt * 1.6);
    if (this.lastCallFlash > 0) this.lastCallFlash = Math.max(0, this.lastCallFlash - dt * 0.8);
  }

  private updateFx(dt: number): void {
    for (const floater of this.floaters) {
      floater.life -= dt;
      floater.y -= 28 * dt;
    }
    this.floaters.splice(0, this.floaters.length, ...this.floaters.filter((floater) => floater.life > 0));
  }

  private chooseBotIndex(): number {
    const known = pickKnownIndex(this.cards, this.memoryOf(this.turn), this.flipped[0] ?? null);
    if (known >= 0) return known;
    const down = this.cards
      .map((card, index) => ({ card, index }))
      .filter(({ card, index }) => canFlip(card) && !this.flipped.includes(index));
    const pick = this.ctx.rng.pick(down);
    return pick?.index ?? 0;
  }

  private allMatched(): boolean {
    return this.cards.every((card) => card.state === "matched");
  }

  // ---- render ----

  render(g: CanvasRenderingContext2D): void {
    this.syncLayout();
    fillArena(g, this.ctx.width, this.ctx.height);
    const hover = this.ctx.input.hover;
    const hoverIndex = hover ? hitCard(this.layout, hover.x, hover.y) : null;
    const player = this.ctx.players[this.turn];
    const left = remainingPairs(this.cards);
    const humanTurn = player?.kind === "human" && this.phase === "play";
    const narrow = this.layout.narrow;
    const inset = narrow ? 16 : 40;
    const finale = this.lastCallShown && this.phase === "play";

    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.font = narrow ? "600 13px Outfit, sans-serif" : "600 15px Outfit, sans-serif";
    g.fillStyle = finale ? "#FF6A3D" : "#94a3b8";
    const shakeIn = missesUntilShake(this.misses);
    g.fillText(
      this.phase === "peek" || this.phase === "closing"
        ? "Flag Snap  ·  memorize"
        : finale
          ? `Flag Snap  ·  LAST CALL  ·  ${left} left  ·  x2 stakes`
          : `Flag Snap  ·  ${left} left  ·  shake-up in ${shakeIn} ${shakeIn === 1 ? "miss" : "misses"}`,
      inset,
      narrow ? 122 : 26,
    );

    g.font = narrow ? "700 26px Bebas Neue, sans-serif" : "700 30px Bebas Neue, sans-serif";
    if (this.phase === "peek" || this.phase === "closing") {
      g.fillStyle = "#FFB020";
      g.fillText("Memorize the flags", inset, narrow ? 148 : 56);
      if (this.phase === "peek") {
        g.font = "600 14px Outfit, sans-serif";
        g.fillStyle = "#64748b";
        g.fillText(narrow ? "Tap to skip" : "Click or Space to skip", inset, narrow ? 170 : 78);
      }
    } else {
      g.fillStyle = player?.color ?? "#F4F7FB";
      const label = `${player?.name ?? "Player"}'s turn`;
      g.fillText(label, inset, narrow ? 148 : 56);
      if (humanTurn) this.drawShotClock(g, inset + g.measureText(label).width + 18, narrow ? 139 : 46);
      g.font = narrow ? "600 13px Outfit, sans-serif" : "600 15px Outfit, sans-serif";
      if (this.streak >= 2) {
        const mult = feverMultiplier(this.streak);
        const pulse = 1 + 0.08 * Math.sin(this.time * 12);
        g.save();
        g.translate(inset, narrow ? 162 : 78);
        if (mult > 1) g.scale(pulse, pulse);
        g.font = mult > 1 ? "700 22px Bebas Neue, sans-serif" : "600 15px Outfit, sans-serif";
        g.fillStyle = mult >= 3 ? "#FF4FD8" : "#FFB020";
        g.fillText(mult > 1 ? `FEVER x${mult}` : `Streak ×${this.streak}  ·  one more = HAT-TRICK x2`, 0, 0);
        g.restore();
      } else if (!narrow) {
        g.fillStyle = "#64748b";
        g.fillText(
          this.snapWindowOpen() ? "SNAP: hold your badge, tap the mate" : "Not your turn? Hold your badge, tap the mate to SNAP",
          inset,
          78,
        );
      }
    }

    this.drawScores(g);
    this.drawBest(g);

    this.juice.begin(g);
    this.drawBoardGlow(g);
    const open = this.snapWindowOpen();
    this.cards.forEach((card, index) => {
      const slot = this.slidePos(index);
      const selected = humanTurn && this.useCursor && this.cursor === index && card.state === "down";
      const hovered = hoverIndex === index && card.state === "down" && this.phase === "play";
      const snappable = open && this.flipped[0] === index;
      this.drawCard(g, slot.x, slot.y, card, index, hovered || selected, selected, snappable);
    });

    this.juice.end(g);
    this.drawFloaters(g);
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
  }

  private drawShotClock(g: CanvasRenderingContext2D, x: number, y: number): void {
    const t = Math.max(0, this.turnClock / TURN_SECONDS);
    const r = this.layout.narrow ? 11 : 12;
    const urgent = this.turnClock < 2.5;
    g.save();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(148, 163, 184, 0.25)";
    g.beginPath();
    g.arc(x + r, y, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = urgent ? "#FF3D7A" : "#3EE0FF";
    if (urgent) g.lineWidth = 3 + Math.sin(this.time * 18) * 1.2;
    g.beginPath();
    g.arc(x + r, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
    g.stroke();
    if (urgent) {
      g.fillStyle = "#FF3D7A";
      g.font = "700 14px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(Math.ceil(this.turnClock)), x + r, y + 1);
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
    }
    g.restore();
  }

  /** Card position, eased along an arc from its old slot while a shake-up slide plays. */
  private slidePos(index: number): { x: number; y: number } {
    const slot = this.layout.slots[index]!;
    const visual = this.visuals[index]!;
    if (visual.slide <= 0) return slot;
    const from = this.layout.slots[visual.slideFrom] ?? slot;
    const t = 1 - visual.slide;
    const ease = t * t * (3 - 2 * t);
    const arc = Math.sin(t * Math.PI) * this.layout.cardH * 0.35;
    return { x: from.x + (slot.x - from.x) * ease, y: from.y + (slot.y - from.y) * ease - arc };
  }

  private drawBest(g: CanvasRenderingContext2D): void {
    if (bestHumanScore(this.ctx.players, this.scores) === null) return;
    g.font = "700 18px Bebas Neue, sans-serif";
    g.textAlign = "right";
    g.fillStyle = this.beatBest ? "#B8FF3D" : "#64748b";
    const right = this.layout.narrow ? this.ctx.width - 16 : this.ctx.width - 36;
    g.fillText(`BEST ${this.best}`, right, this.layout.narrow ? 122 : 100);
    g.textAlign = "left";
  }

  /** Board frame: fever glow while a run is hot, ember glow during LAST CALL. */
  private drawBoardGlow(g: CanvasRenderingContext2D): void {
    if (this.phase !== "play") return;
    const fever = inFever(this.streak);
    const finale = this.lastCallShown;
    if (!fever && !finale) return;
    const first = this.layout.slots[0]!;
    const last = this.layout.slots[this.layout.slots.length - 1]!;
    const color = fever ? "#FF4FD8" : "#FF6A3D";
    const pulse = 0.55 + 0.45 * Math.sin(this.time * (fever ? 6 : 3.5));
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 18 + 14 * pulse + this.lastCallFlash * 30;
    g.strokeStyle = color;
    g.globalAlpha = 0.45 + 0.4 * pulse;
    g.lineWidth = fever ? 5 : 4;
    roundRect(g, first.x - 10, first.y - 10, last.x + this.layout.cardW - first.x + 20, last.y + this.layout.cardH - first.y + 20, 18);
    g.stroke();
    g.restore();
  }

  private drawScores(g: CanvasRenderingContext2D): void {
    const narrow = this.layout.narrow;
    const open = this.snapWindowOpen();
    const armed = this.armedSeat();
    this.ctx.players.forEach((seat, index) => {
      const chip = this.chips[index];
      if (!chip) return;
      const active = index === this.turn && this.phase === "play";
      const lockedFor = (this.snapLock[index] ?? 0) - this.time;
      const locked = lockedFor > 0 && this.phase === "play";
      const canSnapNow = open && seat.kind === "human" && !active && !locked;
      const isArmed = armed === index && !active;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);

      g.save();
      roundRect(g, chip.x, chip.y, chip.w, chip.h, 16);
      if (isArmed) {
        g.shadowColor = seat.color;
        g.shadowBlur = 22;
      }
      g.fillStyle = active ? seat.color : isArmed ? "rgba(30, 41, 59, 0.95)" : "rgba(15, 23, 42, 0.82)";
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = locked ? "#64748b" : seat.color;
      g.lineWidth = active ? 0 : isArmed ? 3.5 : canSnapNow ? 2 + 1.5 * pulse : 1.5;
      if (!active) g.stroke();
      g.restore();

      const textY = chip.y + chip.h / 2;
      g.textBaseline = "middle";
      g.font = narrow ? "600 14px Outfit, sans-serif" : "600 16px Outfit, sans-serif";
      g.textAlign = "left";
      g.fillStyle = active ? "#071018" : locked ? "#94a3b8" : seat.color;
      g.fillText(seat.name, chip.x + 10, textY);
      g.textAlign = "right";
      g.font = "700 20px Bebas Neue, sans-serif";
      g.fillText(String(this.scores[index] ?? 0), chip.x + chip.w - 10, textY);

      // Sideline status tag under the name: SNAP! while a steal is possible, a lockout countdown after a fail.
      if (!active && this.phase === "play" && seat.kind === "human" && chip.h >= 52) {
        g.textAlign = "left";
        g.font = "700 13px Bebas Neue, sans-serif";
        if (locked) {
          g.fillStyle = "#94a3b8";
          g.fillText(`SIT OUT ${Math.ceil(lockedFor)}`, chip.x + 10, chip.y + chip.h - 12);
        } else if (isArmed) {
          g.fillStyle = seat.color;
          g.fillText("ARMED · tap the mate", chip.x + 10, chip.y + chip.h - 12);
        } else if (canSnapNow) {
          g.fillStyle = `rgba(244, 247, 251, ${0.6 + 0.4 * pulse})`;
          g.fillText("SNAP!", chip.x + 10, chip.y + chip.h - 12);
        }
      }
      g.textBaseline = "alphabetic";
    });
    g.textAlign = "left";
  }

  private drawCard(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    card: PairCard,
    index: number,
    hover: boolean,
    selected: boolean,
    snappable: boolean,
  ): void {
    const visual = this.visuals[index]!;
    const peeking = this.phase === "peek";
    const glinting = visual.glint > 0 && card.state === "down" && visual.flipT <= 0;
    const shown = peeking ? "up" : glinting ? "up" : shownFace(visual, card.state);
    const flipScale = peeking ? 1 : flipScaleX(visual.flipT);
    const lifted = visual.slide > 0 ? Math.sin(visual.slide * Math.PI) * 0.12 : 0;
    const bounce = 1 + visual.bounce * 0.16 + lifted;
    const lift = hover && shown === "down" ? -3 : 0;
    const wobble = visual.miss > 0 ? Math.sin(visual.miss * 28) * 6 * visual.miss : 0;
    const cardW = this.layout.cardW;
    const cardH = this.layout.cardH;
    const radius = Math.max(8, Math.round(cardW * 0.12));

    g.save();
    g.translate(x + cardW / 2 + wobble, y + cardH / 2 + lift);
    g.scale(Math.max(0.06, flipScale) * bounce, bounce);
    g.translate(-cardW / 2, -cardH / 2);

    roundRect(g, 0, 0, cardW, cardH, radius);
    if (shown === "down") {
      g.fillStyle = hover ? "#1d4e63" : "#122033";
      g.fill();
      const sliding = visual.slide > 0;
      if (sliding) {
        g.shadowColor = "#3EE0FF";
        g.shadowBlur = 22 * visual.slide;
      }
      g.strokeStyle = selected
        ? (this.ctx.players[this.turn]?.color ?? "#3EE0FF")
        : hover || sliding
          ? "#3EE0FF"
          : "#234";
      g.lineWidth = selected || sliding ? 3 : 2;
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = "#3EE0FF";
      g.font = `700 ${Math.max(16, Math.round(cardW * 0.2))}px Bebas Neue, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("C5", cardW / 2, cardH / 2);
    } else {
      g.fillStyle = shown === "matched" ? "#d1fae5" : "#f8fafc";
      g.fill();
      if (snappable) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 10);
        g.shadowColor = "#F4F7FB";
        g.shadowBlur = 10 + 16 * pulse;
        g.strokeStyle = `rgba(244, 247, 251, ${0.55 + 0.45 * pulse})`;
        g.lineWidth = 4;
      } else if (glinting) {
        g.shadowColor = "#3EE0FF";
        g.shadowBlur = 24;
        g.strokeStyle = "#3EE0FF";
        g.lineWidth = 4;
      } else {
        g.strokeStyle = shown === "matched" ? "#34d399" : "#cbd5e1";
        g.lineWidth = 2;
      }
      g.stroke();
      g.shadowBlur = 0;
      this.drawFlag(g, 0, 0, card.face, cardW, cardH);
      if (!peeking && card.face === this.goldenFace) this.drawShimmer(g, cardW, cardH);
      if (glinting) {
        roundRect(g, 0, 0, cardW, cardH, radius);
        g.fillStyle = `rgba(62, 224, 255, ${0.12 + 0.18 * Math.min(1, visual.glint / 0.3)})`;
        g.fill();
      }
    }
    if (visual.miss > 0) {
      roundRect(g, 0, 0, cardW, cardH, radius);
      g.fillStyle = `rgba(255, 70, 90, ${0.45 * visual.miss})`;
      g.fill();
    }
    g.restore();
  }

  private drawFlag(g: CanvasRenderingContext2D, x: number, y: number, face: string, cardW: number, cardH: number): void {
    const cx = x + cardW / 2;
    const cy = y + cardH / 2;
    const img = this.images.get(face);
    const pad = Math.max(6, Math.round(Math.min(cardW, cardH) * 0.08));
    const boxW = cardW - pad * 2;
    const boxH = cardH - pad * 2;
    if (!img || !img.complete || img.naturalWidth === 0) {
      g.fillStyle = "#94a3b8";
      g.font = "600 12px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(this.names.get(face) ?? face, cx, cy);
      return;
    }
    const aspect = img.naturalWidth / img.naturalHeight;
    let dw = boxW;
    let dh = dw / aspect;
    if (dh > boxH) {
      dh = boxH;
      dw = dh * aspect;
    }
    const dx = cx - dw / 2;
    const dy = cy - dh / 2;
    g.save();
    roundRect(g, dx, dy, dw, dh, Math.max(4, Math.round(Math.min(dw, dh) * 0.06)));
    g.clip();
    g.drawImage(img, dx, dy, dw, dh);
    g.restore();
  }

  /** Gold border + sweeping sheen, drawn in card-local space on a face-up golden card. */
  private drawShimmer(g: CanvasRenderingContext2D, cardW: number, cardH: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 7);
    g.save();
    roundRect(g, 0, 0, cardW, cardH, Math.max(8, Math.round(cardW * 0.12)));
    g.shadowColor = "#FFD54A";
    g.shadowBlur = 10 + 10 * pulse;
    g.strokeStyle = "#FFC21A";
    g.lineWidth = 4;
    g.stroke();
    g.clip();
    const sweep = ((this.time * 0.9) % 1.6) * (cardW + 80) - 60;
    const grad = g.createLinearGradient(sweep - 30, 0, sweep + 30, cardH);
    grad.addColorStop(0, "rgba(255, 230, 120, 0)");
    grad.addColorStop(0.5, "rgba(255, 240, 160, 0.55)");
    grad.addColorStop(1, "rgba(255, 230, 120, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, cardW, cardH);
    g.restore();
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    for (const floater of this.floaters) {
      const t = floater.life / floater.max;
      g.globalAlpha = Math.min(1, t * 1.6);
      g.fillStyle = floater.color;
      g.font = `700 ${floater.size}px Bebas Neue, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(floater.text, floater.x, floater.y);
    }
    g.globalAlpha = 1;
  }

  isFinished(): boolean {
    return this.phase === "done";
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((player, index) => ({
      playerId: player.id,
      score: this.scores[index] ?? 0,
    }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (let i = 0; i < this.ctx.players.length; i++) {
      const id = this.ctx.players[i]!.id;
      stats.push({ playerId: id, label: "Matches", value: String(this.matches[i] ?? 0) });
      const snaps = this.snaps[i] ?? 0;
      if (snaps > 0) stats.push({ playerId: id, label: "Snaps", value: String(snaps) });
      const streak = this.bestStreak[i] ?? 0;
      if (streak >= 2) stats.push({ playerId: id, label: "Best streak", value: String(streak) });
    }
    return stats;
  }

  destroy(): void {
    const canvas = this.ctx.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
  }
}

function shownFace(visual: Visual, state: CardState): CardState {
  if (visual.flipT > 0 && visual.flipT < 1) {
    return visual.flipT < 0.5 ? visual.from : visual.to;
  }
  return state;
}

function flipScaleX(flipT: number): number {
  if (flipT <= 0) return 1;
  return Math.abs(Math.cos(Math.min(1, flipT) * Math.PI));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export const pairs: GameDefinition = {
  id: "pairs",
  name: "Flag Snap",
  tagline: "Match flags on your turn. Snap them from the sidelines.",
  description:
    "A 5s peek, then 12 pairs of flags flip over. On your turn, flip two: match and go again (three in a row is a HAT-TRICK for double points, then the turn passes). While someone else has one card up, hold your badge and tap its mate to SNAP the pair for yourself; a wrong snap costs a point and benches you. One pair is golden and pays triple, the last three pairs pay double, and whoever is clearly last gets a flash of two hidden cards. Every 4 misses, a shake-up slides 4 hidden cards around.",
  durationMs: 0,
  controls:
    "Your turn: tap two cards (8s per flip). Not your turn: hold your badge, tap the mate to SNAP. Keyboard: arrows or WASD to move, your action key to flip or arm a snap.",
  fillsScreen: true,
  create: (ctx) => new PairsGame(ctx),
};
