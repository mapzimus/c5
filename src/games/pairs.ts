import { fillArena } from "../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../fx/juice";
import { PLAYER_BINDS } from "../core/input";
import { type GameContext, GameDefinition, GameInstance, type GameStat } from "../core/types";
import { FLAGS } from "./flags";
import { hitCard, layoutPairBoard, midpoint, PAIR_COLS, PAIR_ROWS, type BoardLayout } from "./pairs-layout";
import {
  allFlagsMatched,
  applyTrickScores,
  assignPersonas,
  bestHumanScore,
  canFlip,
  dealBoard,
  FLAG_PAIRS,
  flagPairsLeft,
  feverMultiplier,
  glimpseIndices,
  inFever,
  inFrenzy,
  missedObvious,
  nextStreak,
  nextTurnIndex,
  pickFaces,
  pickKnownIndex,
  pickLine,
  PEEK_REVEAL_COUNT,
  rememberCard,
  reshuffleDown,
  snipeBonus,
  stepCursor,
  totalMatchPoints,
  TRICK_INFO,
  tricksFor,
  turnClockSeconds,
  underdogBonus,
  type BotPersona,
  type CardState,
  type QuipKind,
  type TrickCard,
  type TrickKind,
} from "./pairs-logic";

const PEEK_SECONDS = 5;
const FLIP_SECONDS = 0.22;
const HOLD_SECONDS = 0.5;
const MATCH_LOCK = 0.34;
const MISS_LOCK = 0.24;
const TRICK_REVEAL = 0.6;
const XRAY_SECONDS = 1.7;
const FINALE_SECONDS = 2.8;
/** Safety net: no round lasts longer than this, whatever happens. */
const HARD_CAP_SECONDS = 900;

type Phase = "peek" | "closing" | "play" | "finale" | "done";

interface Visual {
  flipT: number;
  from: CardState;
  to: CardState;
  bounce: number;
  miss: number;
  reveal: number;
  shuffle: number;
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

interface BotBrain {
  persona: BotPersona;
  memory: Map<string, number[]>;
  recency: number[];
}

interface Quip {
  text: string;
  color: string;
  life: number;
  max: number;
}

interface Firework {
  t: number;
  x: number;
  y: number;
  colors: readonly string[];
}

const FIREWORK_COLORS = ["#FFB020", "#FF4FD8", "#3EE0FF", "#B8FF3D", "#F4F7FB", "#FFD54A"] as const;

class PairsGame implements GameInstance {
  private cards: TrickCard[];
  private scores: number[];
  private readonly shownScores: number[];
  private readonly chipBump: number[];
  private readonly brains: (BotBrain | null)[];
  private readonly seen = new Set<number>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly names = new Map<string, string>();
  private visuals: Visual[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly goldenFace: string;
  private best: number;
  private beatBest = false;
  private readonly startBest: number;
  private time = 0;
  private readonly matches: number[];
  private readonly bestStreak: number[];
  private readonly tricksHit: number[];
  private readonly snipes: number[];
  private readonly floaters: Floater[] = [];
  private readonly fireworks: Firework[] = [];
  private quip: Quip | null = null;
  private flash: { color: string; life: number } | null = null;
  private turn = 0;
  private streak = 0;
  private flipped: number[] = [];
  private lock = 0;
  private pendingTrick: { kind: TrickKind; index: number } | null = null;
  private botWait = 0;
  private botTarget: number | null = null;
  private clock = 0;
  private clockMax = 0;
  private lastTick = 0;
  /** Consecutive shot-clock timeouts per seat: AFK players get a short leash. */
  private readonly idle: number[];
  private lastMissFaces: string[] = [];
  private lastMisser = -1;
  private frenzyAnnounced = false;
  private phase: Phase = "peek";
  private peekLeft = PEEK_SECONDS;
  private finaleLeft = FINALE_SECONDS;
  private cursor = 0;
  private useCursor = false;
  private layout: BoardLayout = layoutPairBoard(1280, 720, 2);

  constructor(private readonly ctx: GameContext) {
    this.best = loadBest("pairs");
    this.startBest = this.best;
    const pick = (max: number): number => this.ctx.rng.int(0, max - 1);
    const faces = pickFaces(
      FLAGS.map((flag) => flag.id),
      FLAG_PAIRS,
      pick,
    );
    this.cards = dealBoard(faces, tricksFor(this.ctx.players.length), pick);
    this.goldenFace = this.ctx.rng.pick(faces) ?? faces[0] ?? "";
    this.juice = new Juice(() => this.ctx.rng.next());
    const zeros = (): number[] => this.ctx.players.map(() => 0);
    this.scores = zeros();
    this.shownScores = zeros();
    this.chipBump = zeros();
    this.matches = zeros();
    this.bestStreak = zeros();
    this.tricksHit = zeros();
    this.snipes = zeros();
    this.idle = zeros();
    this.visuals = this.cards.map(() => freshVisual("up"));
    this.loadFlags(new Set(faces));

    const personas = assignPersonas(
      this.ctx.players.filter((player) => player.kind === "bot").length,
      pick,
    );
    let next = 0;
    this.brains = this.ctx.players.map((player) => {
      if (player.kind !== "bot") return null;
      const persona = personas[next++]!;
      const brain: BotBrain = { persona, memory: new Map(), recency: [] };
      // Each bot catches a few flags during the opening peek (never the tricks).
      for (const index of glimpseIndices(this.cards.length, persona.memory, pick)) {
        const card = this.cards[index];
        if (card && !card.trick) rememberCard(brain.memory, brain.recency, index, card.face, persona.memory);
      }
      return brain;
    });
    this.syncLayout();
  }

  private syncLayout(): void {
    this.layout = layoutPairBoard(this.ctx.width, this.ctx.height, this.ctx.players.length);
  }

  private loadFlags(faces: Set<string>): void {
    const base = import.meta.env?.BASE_URL ?? "/";
    for (const flag of FLAGS) {
      if (!faces.has(flag.id)) continue;
      this.names.set(flag.id, flag.name);
      if (typeof Image === "undefined") continue;
      const img = new Image();
      img.src = `${base}flags/${flag.file}`;
      this.images.set(flag.id, img);
    }
  }

  /* ------------------------------------------------------------------ */
  /* update                                                              */
  /* ------------------------------------------------------------------ */

  update(realDt: number): void {
    this.syncLayout();
    const dt = this.juice.update(realDt);
    this.callouts.update(realDt);
    this.time += realDt;
    this.updateVisuals(dt);
    this.updateFx(realDt);
    if (this.phase === "done") return;
    if (this.time > HARD_CAP_SECONDS) {
      this.phase = "done";
      return;
    }

    if (this.phase === "finale") {
      this.finaleLeft -= realDt;
      if (this.ctx.rng.next() < realDt * 5) this.launchFirework();
      if (this.finaleLeft <= 0) this.phase = "done";
      return;
    }

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
        this.ctx.sfx.go();
        this.resetClock();
      }
      return;
    }

    this.lock = Math.max(0, this.lock - dt);
    if (this.lock > 0) {
      this.ctx.input.consumeClick();
      return;
    }

    if (this.pendingTrick) {
      const trick = this.pendingTrick;
      this.pendingTrick = null;
      this.resolveTrick(trick.kind, trick.index);
      return;
    }

    if (this.flipped.length === 2) {
      this.resolvePair();
      return;
    }

    if (allFlagsMatched(this.cards)) {
      this.beginFinale();
      return;
    }

    this.checkFrenzy();

    const player = this.ctx.players[this.turn];
    if (player?.kind === "bot") {
      this.ctx.input.consumeClick();
      this.updateBot(dt);
      return;
    }

    this.botTarget = null;
    this.updateClock(dt);
    if (this.lock > 0 || this.flipped.length === 2) return;
    this.handleHumanInput(player?.slot ?? 0);
  }

  private beginClose(): void {
    this.phase = "closing";
    this.cards.forEach((card, index) => {
      // Tricks stayed hidden during the peek; don't flash them on the way down.
      if (!card.trick) this.startFlip(index, "up", "down");
      card.state = "down";
    });
  }

  private beginFinale(): void {
    this.phase = "finale";
    this.finaleLeft = FINALE_SECONDS;
    const top = Math.max(...this.scores);
    const winners = this.ctx.players.filter((_, index) => this.scores[index] === top);
    const text =
      this.ctx.players.length <= 1
        ? `FINAL SCORE ${top}`
        : winners.length > 1
          ? "DEAD HEAT!"
          : `${winners[0]?.name ?? "Somebody"} WINS!`;
    this.callouts.show(text, winners.length === 1 ? (winners[0]?.color ?? "#FFD54A") : "#FFD54A", {
      y: 0.45,
      size: 84,
      life: FINALE_SECONDS,
    });
    this.juice.slowMo(0.5, 0.4);
    this.juice.shake(0.5);
    this.ctx.sfx.win();
    for (let i = 0; i < 5; i += 1) this.launchFirework(i * 0.15);
  }

  private checkFrenzy(): void {
    if (this.frenzyAnnounced || this.ctx.players.length < 1) return;
    if (!inFrenzy(flagPairsLeft(this.cards))) return;
    this.frenzyAnnounced = true;
    this.callouts.show("FINAL FRENZY  x2", "#FF5A3D", { size: 70, life: 1.6, y: 0.4 });
    this.say("frenzy", {}, "#FF5A3D");
    this.juice.shake(0.35);
    this.flash = { color: "rgba(255, 90, 61, 0.28)", life: 0.4 };
    this.ctx.sfx.go();
  }

  /* ------------------------------ bots ------------------------------ */

  private updateBot(dt: number): void {
    const brain = this.brains[this.turn];
    if (this.botTarget === null || !canFlip(this.cards[this.botTarget])) {
      this.botTarget = this.chooseBotIndex(brain);
      this.botWait = (brain?.persona.think ?? 0.45) * (0.75 + this.ctx.rng.next() * 0.5);
    }
    this.botWait -= dt;
    if (this.botWait <= 0) {
      const target = this.botTarget;
      this.botTarget = null;
      this.tryFlip(target);
    }
  }

  private chooseBotIndex(brain: BotBrain | null | undefined): number {
    const first = this.flipped[0] ?? null;
    const yolo = brain && this.ctx.rng.next() < brain.persona.yolo;
    if (brain && !yolo) {
      const known = pickKnownIndex(this.cards, brain.memory, first);
      if (known >= 0 && !this.flipped.includes(known)) return known;
    }
    return this.randomOpenIndex();
  }

  private randomOpenIndex(): number {
    const down = this.cards
      .map((card, index) => ({ card, index }))
      .filter(({ card, index }) => canFlip(card) && !this.flipped.includes(index));
    if (down.length === 0) return 0;
    return this.ctx.rng.pick(down).index;
  }

  /** Every bot watches every flip, within the limits of its own memory. */
  private observe(index: number): void {
    const card = this.cards[index];
    if (!card || card.trick) return;
    this.seen.add(index);
    for (const brain of this.brains) {
      if (brain) rememberCard(brain.memory, brain.recency, index, card.face, brain.persona.memory);
    }
  }

  /* ------------------------------ humans ------------------------------ */

  private resetClock(): void {
    const afk = (this.idle[this.turn] ?? 0) >= 2;
    this.clockMax = afk ? 2.5 : turnClockSeconds(flagPairsLeft(this.cards));
    this.clock = this.clockMax;
    this.lastTick = Math.ceil(this.clock);
  }

  private updateClock(dt: number): void {
    this.clock -= dt;
    const whole = Math.ceil(this.clock);
    if (whole < this.lastTick) {
      this.lastTick = whole;
      if (whole <= 3 && whole > 0) {
        this.ctx.sfx.tick();
        if (whole === 3) this.floatAtBoardCenter("HURRY!", "#FF5A3D", 30);
      }
    }
    if (this.clock > 0) return;
    const name = this.ctx.players[this.turn]?.name ?? "Player";
    this.say("timeout", { name }, "#94a3b8");
    this.juice.shake(0.15);
    this.idle[this.turn] = (this.idle[this.turn] ?? 0) + 1;
    this.tryFlip(this.randomOpenIndex());
  }

  private handleHumanInput(slot: 0 | 1 | 2 | 3): void {
    const click = this.ctx.input.consumeClick();
    if (click) {
      this.idle[this.turn] = 0;
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
    if (left || right || up || down) {
      this.useCursor = true;
      this.idle[this.turn] = 0;
    }
    if (left) this.moveCursor(-1, 0);
    else if (right) this.moveCursor(1, 0);
    else if (up) this.moveCursor(0, -1);
    else if (down) this.moveCursor(0, 1);

    if (
      this.ctx.input.actionPressed(slot) ||
      this.ctx.input.justPressed("Space") ||
      this.ctx.input.justPressed("Enter")
    ) {
      this.useCursor = true;
      this.idle[this.turn] = 0;
      this.tryFlip(this.cursor);
    }
  }

  private pressed(slot: 0 | 1 | 2 | 3, dir: "left" | "right" | "up" | "down"): boolean {
    return this.ctx.input.justPressed(PLAYER_BINDS[slot]![dir]);
  }

  private moveCursor(dx: number, dy: number): void {
    this.cursor = stepCursor(this.cursor, dx, dy, PAIR_COLS, PAIR_ROWS, (index) => canFlip(this.cards[index]));
  }

  private parkCursor(): void {
    if (canFlip(this.cards[this.cursor]) && !this.flipped.includes(this.cursor)) return;
    const next = this.cards.findIndex((card, index) => canFlip(card) && !this.flipped.includes(index));
    if (next >= 0) this.cursor = next;
  }

  /* ------------------------------ flips ------------------------------ */

  private tryFlip(index: number): void {
    const card = this.cards[index];
    if (!card || !canFlip(card) || this.flipped.includes(index)) return;
    this.startFlip(index, "down", "up");
    this.resetClock();

    if (card.trick) {
      card.state = "matched";
      this.visuals[index]!.to = "matched";
      this.visuals[index]!.bounce = 1;
      this.pendingTrick = { kind: card.trick, index };
      this.lock = TRICK_REVEAL;
      this.tricksHit[this.turn] = (this.tricksHit[this.turn] ?? 0) + 1;
      this.ctx.sfx.whoosh();
      this.juice.shake(0.12);
      const slot = this.layout.slots[index]!;
      this.floaters.push({
        text: TRICK_INFO[card.trick].label,
        x: slot.x + this.layout.cardW / 2,
        y: slot.y - 6,
        life: 1,
        max: 1,
        color: TRICK_INFO[card.trick].color,
        size: 30,
      });
      return;
    }

    card.state = "up";
    this.flipped.push(index);
    this.observe(index);
    this.ctx.sfx.tick();
    if (this.flipped.length === 2) this.lock = FLIP_SECONDS + HOLD_SECONDS;
  }

  private resolveTrick(kind: TrickKind, index: number): void {
    const flipper = this.turn;
    const name = this.ctx.players[flipper]?.name ?? "Player";
    const slot = this.layout.slots[index]!;
    const cx = slot.x + this.layout.cardW / 2;
    const cy = slot.y + this.layout.cardH / 2;
    const info = TRICK_INFO[kind];
    this.juice.burst(cx, cy, [info.color, "#F4F7FB"], { count: 30, speed: 380, size: 5 });
    this.botTarget = null;

    if (kind === "peek") {
      const pool = this.cards
        .map((card, i) => ({ card, i }))
        .filter(({ card, i }) => canFlip(card) && !card.trick && !this.flipped.includes(i))
        .map(({ i }) => i);
      const order = glimpseIndices(pool.length, PEEK_REVEAL_COUNT, (max) => this.ctx.rng.int(0, max - 1));
      for (const pick of order) {
        const target = pool[pick]!;
        this.visuals[target]!.reveal = XRAY_SECONDS;
        this.observe(target);
      }
      this.callouts.show("X-RAY!", info.color, { size: 64, life: 1 });
      this.say("peek", { name }, info.color);
      this.ctx.sfx.collect();
      this.lock = 0.25;
    } else if (kind === "bomb") {
      for (const up of this.flipped) {
        const card = this.cards[up]!;
        card.state = "down";
        this.startFlip(up, "up", "down");
      }
      this.flipped = [];
      reshuffleDown(this.cards, (max) => this.ctx.rng.int(0, max - 1));
      this.visuals = this.cards.map((card, i) => {
        const old = this.visuals[i]!;
        return card.state === "down" ? { ...freshVisual("down"), shuffle: 1 } : old;
      });
      for (const brain of this.brains) {
        brain?.memory.clear();
        if (brain) brain.recency.length = 0;
      }
      this.seen.clear();
      this.lastMissFaces = [];
      this.lastMisser = -1;
      this.callouts.show("KABOOM!", info.color, { size: 92, life: 1.2 });
      this.say("bomb", { name }, info.color);
      this.flash = { color: "rgba(255, 140, 60, 0.55)", life: 0.45 };
      this.juice.shake(0.8);
      this.juice.hitStop(0.12);
      this.juice.burst(cx, cy, ["#FF5A3D", "#FFB020", "#2b2b2b"], { count: 60, speed: 620, size: 7, life: 1 });
      this.ctx.sfx.hit();
      this.ctx.sfx.whoosh();
      this.streak = 0;
      this.turn = nextTurnIndex(this.turn, this.ctx.players.length, false);
      this.parkCursor();
      this.lock = 0.7;
    } else {
      const before = [...this.scores];
      const outcome = applyTrickScores(kind, this.scores, flipper);
      this.scores = outcome.scores;
      const victim = outcome.target >= 0 ? (this.ctx.players[outcome.target]?.name ?? "them") : "nobody";
      if (kind === "jackpot") {
        this.callouts.show("JACKPOT +5", info.color, { size: 72 });
        this.say("jackpot", { name }, info.color);
        this.ctx.sfx.win();
        for (let i = 0; i < 3; i += 1) this.launchFirework(i * 0.12);
      } else if (kind === "thief") {
        if (outcome.delta > 0) {
          this.callouts.show(`STOLEN  +${outcome.delta}`, info.color, { size: 70 });
          this.say("thief", { name, victim, n: outcome.delta }, info.color);
          this.ctx.sfx.collect();
        } else {
          this.callouts.show("EMPTY POCKETS", "#94a3b8", { size: 56 });
          this.say("thiefEmpty", { name, victim }, "#94a3b8");
          this.ctx.sfx.miss();
        }
      } else if (kind === "swap") {
        const backfire = outcome.delta < 0;
        this.callouts.show(backfire ? "BACKFIRE!" : "SCORE SWAP!", backfire ? "#FF5A3D" : info.color, { size: 76 });
        this.say(backfire ? "swapBackfire" : "swap", { name, victim }, info.color);
        this.juice.slowMo(0.6, 0.4);
        this.flash = { color: "rgba(255, 79, 216, 0.3)", life: 0.4 };
        if (backfire) this.ctx.sfx.hit();
        else this.ctx.sfx.streak(3);
      }
      this.juice.shake(0.35);
      this.bumpChanged(before);
      this.checkBest();
      this.lock = 0.5;
    }
    this.resetClock();
  }

  private resolvePair(): void {
    const aIndex = this.flipped[0]!;
    const bIndex = this.flipped[1]!;
    const a = this.cards[aIndex]!;
    const b = this.cards[bIndex]!;
    const matched = a.face === b.face;
    const wasFever = inFever(this.streak);
    const wasStreak = this.streak;
    const player = this.ctx.players[this.turn];
    const name = player?.name ?? "Player";
    this.streak = nextStreak(this.streak, matched);

    if (matched) {
      const pairsBefore = flagPairsLeft(this.cards);
      a.state = "matched";
      b.state = "matched";
      this.visuals[aIndex]!.bounce = 1;
      this.visuals[bIndex]!.bounce = 1;
      this.visuals[aIndex]!.to = "matched";
      this.visuals[bIndex]!.to = "matched";
      const golden = a.face === this.goldenFace;
      const frenzy = inFrenzy(pairsBefore);
      const underdog = underdogBonus(this.scores, this.turn);
      const snipe = snipeBonus(this.lastMissFaces, this.lastMisser, a.face, this.turn);
      const after = flagPairsLeft(this.cards);
      const points = totalMatchPoints(this.streak, after, golden, { frenzy, underdog, snipe });
      const before = [...this.scores];
      this.scores[this.turn] = (this.scores[this.turn] ?? 0) + points;
      this.bumpChanged(before);
      this.matches[this.turn] = (this.matches[this.turn] ?? 0) + 1;
      if (this.streak > (this.bestStreak[this.turn] ?? 0)) this.bestStreak[this.turn] = this.streak;
      if (snipe > 0) this.snipes[this.turn] = (this.snipes[this.turn] ?? 0) + 1;
      this.burst(aIndex, bIndex, points, a.face, golden, { frenzy, underdog, snipe });
      if (this.streak >= 2) this.ctx.sfx.streak(this.streak);
      else this.ctx.sfx.collect();
      this.matchCallouts(golden, frenzy);
      this.matchChatter(golden, snipe > 0, underdog > 0);
      if (snipe > 0) this.lastMissFaces = [];
      if (after === 0) {
        this.juice.hitStop(0.12);
        this.juice.slowMo(0.7, 0.3);
      }
      this.checkBest();
      this.lock = MATCH_LOCK;
    } else {
      const obvious = missedObvious(this.cards, this.seen, aIndex, bIndex) || missedObvious(this.cards, this.seen, bIndex, aIndex);
      a.state = "down";
      b.state = "down";
      this.startFlip(aIndex, "up", "down");
      this.startFlip(bIndex, "up", "down");
      this.visuals[aIndex]!.miss = 1;
      this.visuals[bIndex]!.miss = 1;
      this.ctx.sfx.miss();
      if (wasFever) {
        this.juice.shake(0.35);
        this.callouts.show("FEVER OVER", "#94a3b8", { size: 48, life: 1 });
        this.say("feverOver", { name }, "#94a3b8");
      } else if (obvious) {
        this.juice.shake(0.28);
        this.callouts.show("OOF!", "#FF5A3D", { size: 60, life: 0.9 });
        this.say("obvious", { name }, "#FF5A3D");
        this.ctx.sfx.hit();
      } else {
        this.juice.shake(0.12);
        this.botOrAnnouncer("miss", name, false);
      }
      if (wasStreak >= 2 && !wasFever) this.floatAtBoardCenter(`STREAK OF ${wasStreak} ENDS`, "#94a3b8", 22);
      this.lastMissFaces = [a.face, b.face];
      this.lastMisser = this.turn;
      this.lock = MISS_LOCK;
    }
    const nextTurn = nextTurnIndex(this.turn, this.ctx.players.length, matched);
    if (nextTurn !== this.turn) this.botTarget = null;
    this.turn = nextTurn;
    this.flipped = [];
    this.parkCursor();
    this.resetClock();
  }

  /* ------------------------------ chatter ------------------------------ */

  private say(kind: QuipKind, vars: Record<string, string | number>, color: string): void {
    const text = pickLine(kind, vars, (max) => this.ctx.rng.int(0, max - 1));
    this.quip = { text, color, life: 2.4, max: 2.4 };
  }

  /** Bots talk trash in their own voice; humans get the announcer. */
  private botOrAnnouncer(kind: "miss" | "streak", name: string, matched: boolean): void {
    const brain = this.brains[this.turn];
    const color = this.ctx.players[this.turn]?.color ?? "#F4F7FB";
    if (brain && this.ctx.rng.next() < 0.7) {
      const lines = matched ? brain.persona.match : brain.persona.miss;
      const line = lines[this.ctx.rng.int(0, lines.length - 1)] ?? "";
      this.quip = { text: `${name}: "${line}"`, color, life: 2.4, max: 2.4 };
      return;
    }
    this.say(kind, { name }, kind === "miss" ? "#94a3b8" : color);
  }

  private matchChatter(golden: boolean, sniped: boolean, underdog: boolean): void {
    const name = this.ctx.players[this.turn]?.name ?? "Player";
    const color = this.ctx.players[this.turn]?.color ?? "#F4F7FB";
    if (golden) this.say("golden", { name }, "#FFD54A");
    else if (sniped) this.say("snipe", { name, victim: this.ctx.players[this.lastMisser]?.name ?? "them" }, color);
    else if (this.streak === 3 || this.streak === 5) this.say("fever", { name }, color);
    else if (this.streak >= 2) this.botOrAnnouncer("streak", name, true);
    else if (underdog) this.say("underdog", { name }, color);
    else if (this.brains[this.turn] && this.ctx.rng.next() < 0.4) this.botOrAnnouncer("streak", name, true);
  }

  private matchCallouts(golden: boolean, frenzy: boolean): void {
    const mult = feverMultiplier(this.streak) * (frenzy ? 2 : 1);
    if (golden) {
      this.callouts.show(`GOLDEN PAIR  x${mult * 2}`, "#FFD54A", { size: 72, life: 1.4 });
      this.juice.hitStop(0.08);
      for (let i = 0; i < 3; i += 1) this.launchFirework(i * 0.1);
    } else if (this.streak === 3 || this.streak === 5) {
      this.callouts.show(`FEVER x${feverMultiplier(this.streak)}`, this.streak >= 5 ? "#FF4FD8" : "#FFB020", { size: 68 });
    }
    if (this.streak >= 3) {
      for (let i = 0; i < Math.min(6, this.streak - 1); i += 1) this.launchFirework(0.08 + i * 0.13);
    }
  }

  private checkBest(): void {
    const top = bestHumanScore(this.ctx.players, this.scores);
    if (top === null || top <= this.best) return;
    this.best = top;
    saveBest("pairs", top);
    if (!this.beatBest && this.startBest > 0) {
      this.beatBest = true;
      this.callouts.show("NEW BEST", "#B8FF3D", { y: 0.5, size: 60, life: 1.5 });
      this.ctx.sfx.win();
    }
  }

  private bumpChanged(before: readonly number[]): void {
    this.scores.forEach((score, index) => {
      if (score !== before[index]) this.chipBump[index] = 1;
    });
  }

  /* ------------------------------ fx ------------------------------ */

  private burst(
    aIndex: number,
    bIndex: number,
    points: number,
    face: string,
    golden: boolean,
    bonus: { frenzy: boolean; underdog: number; snipe: number },
  ): void {
    const player = this.ctx.players[this.turn];
    const color = player?.color ?? "#3EE0FF";
    const mid = midpoint(this.layout, aIndex, bIndex);
    this.floaters.push({ text: `+${points}`, x: mid.x, y: mid.y - 18, life: 1.1, max: 1.1, color, size: 40 });
    this.floaters.push({
      text: this.names.get(face) ?? face,
      x: mid.x,
      y: mid.y + 16,
      life: 1.15,
      max: 1.15,
      color: "#F4F7FB",
      size: 18,
    });
    const tags: string[] = [];
    if (this.streak >= 2) {
      const mult = feverMultiplier(this.streak);
      tags.push(mult > 1 ? `FEVER x${mult}` : `STREAK ${this.streak}`);
    }
    if (bonus.frenzy) tags.push("FRENZY x2");
    if (bonus.snipe) tags.push("SNIPE +1");
    if (bonus.underdog) tags.push(`UNDERDOG +${bonus.underdog}`);
    if (flagPairsLeft(this.cards) === 0) tags.push("CLOSER");
    tags.forEach((tag, i) => {
      this.floaters.push({ text: tag, x: mid.x, y: mid.y - 52 - i * 24, life: 1.25, max: 1.25, color: "#FFB020", size: 22 });
    });
    const fever = inFever(this.streak);
    for (const slot of [this.layout.slots[aIndex]!, this.layout.slots[bIndex]!]) {
      const cx = slot.x + this.layout.cardW / 2;
      const cy = slot.y + this.layout.cardH / 2;
      this.juice.burst(cx, cy, color, { count: 14, speed: 220, gravity: 300 });
      if (fever) this.juice.burst(cx, cy, ["#FFB020", "#FF4FD8", "#F4F7FB"], { count: 12 + this.streak * 2, speed: 340, size: 5 });
      if (golden) this.juice.burst(cx, cy, ["#FFD54A", "#FFF3B0", "#FFB020"], { count: 40, speed: 460, size: 6, life: 1 });
      if (bonus.frenzy) this.juice.burst(cx, cy, ["#FF5A3D", "#FFB020"], { count: 16, speed: 300, size: 5 });
    }
    this.juice.shake(golden ? 0.45 : fever || bonus.frenzy ? 0.24 : 0.12);
  }

  private launchFirework(delay = 0): void {
    const first = this.layout.slots[0]!;
    const boardW = this.layout.cardW * PAIR_COLS + this.layout.gap * (PAIR_COLS - 1);
    const boardH = this.layout.cardH * PAIR_ROWS + this.layout.gap * (PAIR_ROWS - 1);
    const rng = this.ctx.rng;
    const a = rng.int(0, FIREWORK_COLORS.length - 1);
    this.fireworks.push({
      t: delay,
      x: first.x + rng.next() * boardW,
      y: first.y + rng.next() * boardH * 0.7,
      colors: [FIREWORK_COLORS[a]!, FIREWORK_COLORS[(a + 2) % FIREWORK_COLORS.length]!, "#F4F7FB"],
    });
  }

  private floatAtBoardCenter(text: string, color: string, size: number): void {
    const first = this.layout.slots[0]!;
    const last = this.layout.slots[this.layout.slots.length - 1]!;
    this.floaters.push({
      text,
      x: (first.x + last.x + this.layout.cardW) / 2,
      y: (first.y + last.y + this.layout.cardH) / 2,
      life: 1,
      max: 1,
      color,
      size,
    });
  }

  private startFlip(index: number, from: CardState, to: CardState): void {
    const visual = this.visuals[index];
    if (!visual) return;
    visual.from = from;
    visual.to = to;
    visual.flipT = 0.001;
  }

  private updateVisuals(dt: number): void {
    for (const visual of this.visuals) {
      if (visual.flipT > 0) {
        visual.flipT += dt / FLIP_SECONDS;
        if (visual.flipT >= 1) visual.flipT = 0;
      }
      if (visual.bounce > 0) visual.bounce = Math.max(0, visual.bounce - dt * 2.6);
      if (visual.miss > 0) visual.miss = Math.max(0, visual.miss - dt * 2.4);
      if (visual.reveal > 0) visual.reveal = Math.max(0, visual.reveal - dt);
      if (visual.shuffle > 0) visual.shuffle = Math.max(0, visual.shuffle - dt * 1.6);
    }
  }

  private updateFx(dt: number): void {
    for (const floater of this.floaters) {
      floater.life -= dt;
      floater.y -= 28 * dt;
    }
    this.floaters.splice(0, this.floaters.length, ...this.floaters.filter((floater) => floater.life > 0));
    for (const fw of this.fireworks) {
      fw.t -= dt;
      if (fw.t <= 0) {
        this.juice.burst(fw.x, fw.y, fw.colors, { count: 34, speed: 420, size: 5, gravity: 220, life: 1.1 });
        this.ctx.sfx.select();
      }
    }
    this.fireworks.splice(0, this.fireworks.length, ...this.fireworks.filter((fw) => fw.t > 0));
    if (this.quip) {
      this.quip.life -= dt;
      if (this.quip.life <= 0) this.quip = null;
    }
    if (this.flash) {
      this.flash.life -= dt;
      if (this.flash.life <= 0) this.flash = null;
    }
    this.scores.forEach((score, index) => {
      const shown = this.shownScores[index] ?? 0;
      const step = Math.max(1, Math.abs(score - shown) * 8 * dt);
      this.shownScores[index] = Math.abs(score - shown) <= step ? score : shown + Math.sign(score - shown) * step;
      this.chipBump[index] = Math.max(0, (this.chipBump[index] ?? 0) - dt * 2.5);
    });
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */

  render(g: CanvasRenderingContext2D): void {
    this.syncLayout();
    fillArena(g, this.ctx.width, this.ctx.height);
    const hover = this.ctx.input.hover;
    const hoverIndex = hover ? hitCard(this.layout, hover.x, hover.y) : null;
    const player = this.ctx.players[this.turn];
    const left = flagPairsLeft(this.cards);
    const humanTurn = player?.kind === "human" && this.phase === "play";
    const narrow = this.layout.narrow;
    const inset = narrow ? 16 : 40;
    const memorizing = this.phase === "peek" || this.phase === "closing";

    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.font = narrow ? "600 13px Outfit, sans-serif" : "600 15px Outfit, sans-serif";
    g.fillStyle = inFrenzy(left) && !memorizing ? "#FF5A3D" : "#94a3b8";
    const tricksLeft = this.cards.filter((card) => card.trick && card.state === "down").length;
    g.fillText(
      memorizing
        ? "Pairs  ·  memorize"
        : `Pairs  ·  ${left} left${tricksLeft ? `  ·  ${tricksLeft} trick${tricksLeft > 1 ? "s" : ""} hidden` : ""}${inFrenzy(left) ? "  ·  FRENZY x2" : ""}`,
      inset,
      narrow ? 122 : 26,
    );

    g.font = narrow ? "700 26px Bebas Neue, sans-serif" : "700 30px Bebas Neue, sans-serif";
    if (memorizing) {
      g.fillStyle = "#FFB020";
      g.fillText("Memorize the flags", inset, narrow ? 148 : 56);
      if (this.phase === "peek") {
        g.font = "600 14px Outfit, sans-serif";
        g.fillStyle = "#64748b";
        const names = tricksFor(this.ctx.players.length).map((kind) => TRICK_INFO[kind].label);
        g.fillText(
          `${narrow ? "Tap to skip" : "Click or Space to skip"}  ·  ? = trick: ${[...new Set(names)].join(" ")}`,
          inset,
          narrow ? 170 : 78,
        );
      }
    } else {
      g.fillStyle = player?.color ?? "#F4F7FB";
      const persona = this.brains[this.turn]?.persona.label;
      const label = this.phase === "finale" ? "Final tally" : `${player?.name ?? "Player"}'s turn${persona ? `  ·  ${persona}` : ""}`;
      g.fillText(label, inset, narrow ? 148 : 56);
      if (this.streak >= 2 && this.phase === "play") {
        const mult = feverMultiplier(this.streak);
        const pulse = 1 + 0.08 * Math.sin(this.time * 12);
        g.save();
        g.translate(inset, narrow ? 170 : 80);
        if (mult > 1) g.scale(pulse, pulse);
        g.font = mult > 1 ? "700 22px Bebas Neue, sans-serif" : "700 16px Outfit, sans-serif";
        g.fillStyle = mult >= 3 ? "#FF4FD8" : "#FFB020";
        g.fillText(mult > 1 ? `FEVER x${mult}  ·  streak ${this.streak}` : `Streak ×${this.streak}`, 0, 0);
        g.restore();
      }
    }

    this.drawScores(g);
    this.drawBest(g);

    this.juice.begin(g);
    this.drawBoardGlow(g);
    const botColor = player?.kind === "bot" ? player.color : null;
    this.cards.forEach((card, index) => {
      const slot = this.layout.slots[index]!;
      const selected = humanTurn && this.useCursor && this.cursor === index && card.state === "down";
      const hovered = hoverIndex === index && card.state === "down" && this.phase === "play";
      const botAim = botColor !== null && this.botTarget === index && this.phase === "play" && this.lock <= 0;
      this.drawCard(g, slot.x, slot.y, card, index, hovered || selected || botAim, selected || botAim, botAim ? botColor : null);
    });

    this.juice.end(g);
    this.drawFloaters(g);
    this.drawQuip(g);
    if (this.flash) {
      g.save();
      g.globalAlpha = Math.min(1, this.flash.life / 0.3);
      g.fillStyle = this.flash.color;
      g.fillRect(0, 0, this.ctx.width, this.ctx.height);
      g.restore();
    }
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
  }

  private drawBest(g: CanvasRenderingContext2D): void {
    if (bestHumanScore(this.ctx.players, this.scores) === null) return;
    g.font = "700 18px Bebas Neue, sans-serif";
    g.textAlign = "right";
    g.fillStyle = this.beatBest ? "#B8FF3D" : "#64748b";
    const right = this.layout.narrow ? this.ctx.width - 16 : this.ctx.width - 36;
    g.fillText(`BEST ${this.best}`, right, this.layout.narrow ? 122 : 88);
    g.textAlign = "left";
  }

  private drawBoardGlow(g: CanvasRenderingContext2D): void {
    if (this.phase !== "play") return;
    const frenzy = inFrenzy(flagPairsLeft(this.cards));
    const fever = inFever(this.streak);
    if (!frenzy && !fever) return;
    const first = this.layout.slots[0]!;
    const last = this.layout.slots[this.layout.slots.length - 1]!;
    const mult = feverMultiplier(this.streak);
    const color = frenzy ? "#FF5A3D" : mult >= 3 ? "#FF4FD8" : "#FFB020";
    const speed = frenzy ? 9 : 6;
    const pulse = 0.55 + 0.45 * Math.sin(this.time * speed);
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 18 + 14 * pulse + Math.max(0, mult - 2) * 10 + (frenzy ? 10 : 0);
    g.strokeStyle = color;
    g.globalAlpha = 0.5 + 0.4 * pulse;
    g.lineWidth = 3 + mult + (frenzy ? 2 : 0);
    roundRect(g, first.x - 10, first.y - 10, last.x + this.layout.cardW - first.x + 20, last.y + this.layout.cardH - first.y + 20, 18);
    g.stroke();
    g.restore();
  }

  private chipRect(index: number): { x: number; y: number; w: number; h: number } {
    const count = this.ctx.players.length;
    const narrow = this.layout.narrow;
    const gap = narrow ? 8 : 10;
    const h = narrow ? 32 : 36;
    const inset = narrow ? 16 : 36;
    const w = narrow ? Math.min(160, (this.ctx.width - inset * 2 - gap * (count - 1)) / count) : 158;
    const x0 = narrow ? inset : this.ctx.width - inset - (count * w + (count - 1) * gap);
    return { x: x0 + index * (w + gap), y: narrow ? 186 : 22, w, h };
  }

  private drawScores(g: CanvasRenderingContext2D): void {
    const narrow = this.layout.narrow;
    const top = Math.max(...this.scores);
    const showCrown = top > 0 && this.ctx.players.length > 1;
    this.ctx.players.forEach((seat, index) => {
      const { x, y, w, h } = this.chipRect(index);
      const active = index === this.turn && this.phase === "play";
      const bump = 1 + (this.chipBump[index] ?? 0) * 0.14;
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.scale(bump, bump);
      g.translate(-w / 2, -h / 2);
      roundRect(g, 0, 0, w, h, 16);
      g.fillStyle = active ? seat.color : "rgba(15, 23, 42, 0.82)";
      g.fill();
      g.strokeStyle = seat.color;
      g.lineWidth = active ? 0 : 1.5;
      if (!active) g.stroke();
      g.font = narrow ? "600 13px Outfit, sans-serif" : "600 16px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillStyle = active ? "#071018" : seat.color;
      g.fillText(`${seat.name}`, 10, 21);
      g.textAlign = "right";
      g.font = "700 18px Bebas Neue, sans-serif";
      g.fillText(String(Math.round(this.shownScores[index] ?? 0)), w - 10, 22);
      g.restore();

      if (showCrown && this.scores[index] === top) drawCrown(g, x + 14, y - 3, "#FFD54A");

      // Shot clock under the active human's chip.
      if (active && seat.kind === "human" && this.clockMax > 0 && this.lock <= 0) {
        const t = Math.max(0, Math.min(1, this.clock / this.clockMax));
        const urgent = this.clock <= 3;
        g.fillStyle = "rgba(148, 163, 184, 0.25)";
        g.fillRect(x + 6, y + h + 4, w - 12, 4);
        g.fillStyle = urgent ? (Math.sin(this.time * 20) > 0 ? "#FF5A3D" : "#FFB020") : seat.color;
        g.fillRect(x + 6, y + h + 4, (w - 12) * t, 4);
      }
    });
    g.textAlign = "left";
  }

  private drawQuip(g: CanvasRenderingContext2D): void {
    if (!this.quip) return;
    const t = this.quip.life / this.quip.max;
    const last = this.layout.slots[this.layout.slots.length - 1]!;
    const first = this.layout.slots[0]!;
    const size = this.layout.narrow ? 22 : 24;
    const boardBottom = last.y + this.layout.cardH;
    const below = this.ctx.height - boardBottom;
    let cx = (first.x + last.x + this.layout.cardW) / 2;
    let cy = Math.min(this.ctx.height - 26, boardBottom - 6);
    let maxW = this.ctx.width - 24;
    if (below >= size * 2 + 16) {
      // Tall phones: use the empty strip under the board so no card gets covered.
      cy = boardBottom + Math.min(below / 2, size * 1.5 + 14);
    } else if (first.x >= 240) {
      // Wide screens: park the announcer in the left margin beside the board.
      cx = first.x / 2;
      cy = (first.y + boardBottom) / 2;
      maxW = first.x - 32;
    }
    g.save();
    g.globalAlpha = Math.min(1, t * 4, (1 - t) * 12);
    g.font = `700 ${size}px Outfit, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const lines = wrapLines(g, this.quip.text, maxW - 36);
    const lineH = size * 1.2;
    const width = Math.min(maxW, Math.max(...lines.map((line) => g.measureText(line).width)) + 36);
    const height = size * 0.7 + lineH * lines.length;
    const pop = 1 + Math.max(0, (t - 0.9) * 2.5);
    g.translate(cx, cy);
    g.scale(pop, pop);
    roundRect(g, -width / 2, -height / 2, width, height, Math.min(size * 0.95, height / 2));
    g.fillStyle = "rgba(7, 11, 20, 0.88)";
    g.fill();
    g.strokeStyle = this.quip.color;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = this.quip.color;
    lines.forEach((line, i) => g.fillText(line, 0, 1 + (i - (lines.length - 1) / 2) * lineH, width - 20));
    g.restore();
  }

  private drawCard(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    card: TrickCard,
    index: number,
    hover: boolean,
    selected: boolean,
    aimColor: string | null,
  ): void {
    const visual = this.visuals[index]!;
    const peeking = this.phase === "peek";
    const xray = visual.reveal > 0 && card.state === "down";
    let shown: CardState = peeking ? (card.trick ? "down" : "up") : shownFace(visual, card.state);
    if (xray && visual.flipT <= 0) shown = "up";
    const flipScale = peeking ? 1 : flipScaleX(visual.flipT);
    const bounce = 1 + visual.bounce * 0.16;
    const lift = hover && shown === "down" ? -3 : 0;
    const wobble = visual.miss > 0 ? Math.sin(visual.miss * 28) * 6 * visual.miss : 0;
    const spin = visual.shuffle > 0 ? Math.sin(visual.shuffle * 18 + index) * 0.25 * visual.shuffle : 0;
    const cardW = this.layout.cardW;
    const cardH = this.layout.cardH;
    const radius = Math.max(8, Math.round(cardW * 0.12));
    const spentTrick = card.trick && card.state === "matched" && visual.flipT <= 0 && visual.bounce <= 0;

    g.save();
    g.translate(x + cardW / 2 + wobble, y + cardH / 2 + lift);
    if (spin) g.rotate(spin);
    g.scale(Math.max(0.06, flipScale) * bounce, bounce);
    g.translate(-cardW / 2, -cardH / 2);
    if (spentTrick) g.globalAlpha = 0.28;

    roundRect(g, 0, 0, cardW, cardH, radius);
    if (shown === "down") {
      g.fillStyle = hover ? "#1d4e63" : "#122033";
      g.fill();
      g.strokeStyle = aimColor ?? (selected ? (this.ctx.players[this.turn]?.color ?? "#3EE0FF") : hover ? "#3EE0FF" : "#234");
      g.lineWidth = selected ? 3 + (aimColor ? Math.sin(this.time * 14) * 1.5 + 1.5 : 0) : 2;
      g.stroke();
      g.fillStyle = "#3EE0FF";
      g.font = `700 ${Math.max(16, Math.round(cardW * 0.2))}px Bebas Neue, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(peeking && card.trick ? "?" : "C5", cardW / 2, cardH / 2);
    } else if (card.trick) {
      this.drawTrickFace(g, card.trick, cardW, cardH, radius);
    } else {
      g.fillStyle = shown === "matched" ? "#d1fae5" : "#f8fafc";
      g.fill();
      g.strokeStyle = xray ? "#3EE0FF" : shown === "matched" ? "#34d399" : "#cbd5e1";
      g.lineWidth = xray ? 4 : 2;
      g.stroke();
      this.drawFlag(g, 0, 0, card.face, cardW, cardH);
      if (!peeking && card.face === this.goldenFace) this.drawShimmer(g, cardW, cardH);
      if (xray) {
        roundRect(g, 0, 0, cardW, cardH, radius);
        g.fillStyle = `rgba(62, 224, 255, ${0.15 + 0.1 * Math.sin(this.time * 16)})`;
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

  private drawTrickFace(g: CanvasRenderingContext2D, kind: TrickKind, cardW: number, cardH: number, radius: number): void {
    const info = TRICK_INFO[kind];
    const grad = g.createLinearGradient(0, 0, cardW, cardH);
    grad.addColorStop(0, "#1a1033");
    grad.addColorStop(1, "#0b1424");
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = info.color;
    g.lineWidth = 3;
    g.stroke();
    g.save();
    roundRect(g, 0, 0, cardW, cardH, radius);
    g.clip();
    g.shadowColor = info.color;
    g.shadowBlur = 16;
    g.fillStyle = info.color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(cardW * 0.42)}px sans-serif`;
    g.fillText(info.glyph, cardW / 2, cardH * 0.42);
    g.shadowBlur = 0;
    g.font = `700 ${Math.max(12, Math.round(cardW * 0.17))}px Bebas Neue, sans-serif`;
    g.fillText(info.label, cardW / 2, cardH * 0.8, cardW - 8);
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
      g.font = `700 ${floater.size}px Bebas Neue, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7, 11, 20, 0.7)";
      g.strokeText(floater.text, floater.x, floater.y);
      g.fillStyle = floater.color;
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
      const streak = this.bestStreak[i] ?? 0;
      if (streak >= 2) stats.push({ playerId: id, label: "Best streak", value: String(streak) });
      if ((this.tricksHit[i] ?? 0) > 0) stats.push({ playerId: id, label: "Tricks", value: String(this.tricksHit[i]) });
      if ((this.snipes[i] ?? 0) > 0) stats.push({ playerId: id, label: "Snipes", value: String(this.snipes[i]) });
      const persona = this.brains[i]?.persona.label;
      if (persona) stats.push({ playerId: id, label: "Persona", value: persona });
    }
    return stats;
  }

  destroy(): void {
    this.floaters.length = 0;
    this.fireworks.length = 0;
  }
}

function freshVisual(state: CardState): Visual {
  return { flipT: 0, from: state, to: state, bounce: 0, miss: 0, reveal: 0, shuffle: 0 };
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

function drawCrown(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.save();
  g.beginPath();
  g.moveTo(x - 9, y);
  g.lineTo(x - 9, y - 9);
  g.lineTo(x - 4.5, y - 4);
  g.lineTo(x, y - 11);
  g.lineTo(x + 4.5, y - 4);
  g.lineTo(x + 9, y - 9);
  g.lineTo(x + 9, y);
  g.closePath();
  g.fillStyle = color;
  g.strokeStyle = "rgba(7, 11, 20, 0.85)";
  g.lineWidth = 2;
  g.stroke();
  g.fill();
  g.restore();
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
  name: "Pairs",
  tagline: "Match flags. Steal points. Blow it up.",
  description:
    "A short peek (tap or Space to skip), then take turns flipping two cards on a shot clock. A match stays and you go again — 3 in a row starts FEVER (x2, then x3 at 5), one secret golden pair pays double, and the last 3 pairs are a FINAL FRENZY at double points. Four hidden trick cards: X-RAY flashes cards, BOMB reshuffles the board, THIEF robs the leader, SWAP trades scores with the leader (backfires if you lead). Trailing players get underdog bonuses, and matching a flag your rival just missed is a SNIPE.",
  durationMs: 0,
  controls: "Tap two face-down cards, or use WASD / arrows and Space / Enter. Beat the shot clock.",
  fillsScreen: true,
  create: (ctx) => new PairsGame(ctx),
};

/** Greedy word wrap for the announcer bubble (at most three lines). */
function wrapLines(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 3 ? [...lines.slice(0, 2), lines.slice(2).join(" ")] : lines;
}
