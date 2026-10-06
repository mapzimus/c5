import { fillArena } from "../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../fx/juice";
import { PLAYER_BINDS } from "../core/input";
import { type GameContext, GameDefinition, GameInstance } from "../core/types";
import { FLAGS, PAIR_COUNT } from "./flags";
import { hitCard, layoutPairBoard, midpoint, PAIR_COLS, PAIR_ROWS, type BoardLayout } from "./pairs-layout";
import {
  BOT_MEMORY_LIMIT,
  bestHumanScore,
  feverMultiplier,
  inFever,
  scoreMatch,
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

const PEEK_SECONDS = 5;
const FLIP_SECONDS = 0.22;
const HOLD_SECONDS = 0.5;
const MATCH_LOCK = 0.34;
const MISS_LOCK = 0.24;

type Phase = "peek" | "closing" | "play" | "done";

interface Visual {
  flipT: number;
  from: CardState;
  to: CardState;
  bounce: number;
  miss: number;
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

class PairsGame implements GameInstance {
  private readonly cards: PairCard[];
  private readonly scores: number[];
  private readonly memory = new Map<string, number[]>();
  private readonly recency: number[] = [];
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
  private readonly floaters: Floater[] = [];
  private turn = 0;
  private streak = 0;
  private flipped: number[] = [];
  private lock = 0;
  private botWait = 0;
  private phase: Phase = "peek";
  private peekLeft = PEEK_SECONDS;
  private cursor = 0;
  private useCursor = false;
  private layout: BoardLayout = layoutPairBoard(1280, 720, 2);

  constructor(private readonly ctx: GameContext) {
    this.best = loadBest("pairs");
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
    this.visuals = this.cards.map(() => ({
      flipT: 0,
      from: "up",
      to: "up",
      bounce: 0,
      miss: 0,
    }));
    this.loadFlags(new Set(faces));
    for (const index of glimpseIndices(this.cards.length, BOT_MEMORY_LIMIT, (max) => this.ctx.rng.int(0, max - 1))) {
      const card = this.cards[index];
      if (card) rememberCard(this.memory, this.recency, index, card.face);
    }
    this.syncLayout();
  }

  private syncLayout(): void {
    this.layout = layoutPairBoard(this.ctx.width, this.ctx.height, this.ctx.players.length);
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
      if (this.visuals.every((visual) => visual.flipT <= 0)) this.phase = "play";
      return;
    }

    this.lock = Math.max(0, this.lock - dt);
    if (this.lock > 0) return;

    if (this.flipped.length === 2) {
      this.resolvePair();
      return;
    }

    if (this.allMatched()) {
      this.phase = "done";
      return;
    }

    const player = this.ctx.players[this.turn];
    if (player?.kind === "bot") {
      this.botWait -= dt;
      if (this.botWait <= 0) {
        this.tryFlip(this.chooseBotIndex());
        this.botWait = 0.45;
      }
      return;
    }

    this.botWait = 0.55;
    this.handleHumanInput(player?.slot ?? 0);
  }

  private beginClose(): void {
    this.phase = "closing";
    this.cards.forEach((card, index) => {
      this.startFlip(index, "up", "down");
      card.state = "down";
    });
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

    if (
      this.ctx.input.actionPressed(slot) ||
      this.ctx.input.justPressed("Space") ||
      this.ctx.input.justPressed("Enter")
    ) {
      this.useCursor = true;
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
    rememberCard(this.memory, this.recency, index, card.face);
    this.ctx.sfx.tick();
    if (this.flipped.length === 2) this.lock = FLIP_SECONDS + HOLD_SECONDS;
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
      this.burst(aIndex, bIndex, points, a.face, golden);
      if (this.streak >= 2) this.ctx.sfx.streak(this.streak);
      else this.ctx.sfx.collect();
      this.matchCallouts(golden);
      this.checkBest();
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
    }
    this.turn = nextTurnIndex(this.turn, this.ctx.players.length, matched);
    this.flipped = [];
    this.parkCursor();
  }

  private matchCallouts(golden: boolean): void {
    const mult = feverMultiplier(this.streak);
    if (golden) {
      this.callouts.show(mult > 1 ? `GOLDEN PAIR  x${mult * 2}` : "GOLDEN PAIR  x2", "#FFD54A", { size: 72, life: 1.4 });
      this.juice.hitStop(0.08);
    } else if (this.streak === 3 || this.streak === 5) {
      this.callouts.show(`FEVER x${mult}`, mult >= 3 ? "#FF4FD8" : "#FFB020", { size: 68 });
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

  private burst(aIndex: number, bIndex: number, points: number, face: string, golden: boolean): void {
    const player = this.ctx.players[this.turn];
    const color = player?.color ?? "#3EE0FF";
    const mid = midpoint(this.layout, aIndex, bIndex);
    this.floaters.push({
      text: `+${points}`,
      x: mid.x,
      y: mid.y - 18,
      life: 1.1,
      max: 1.1,
      color,
      size: 36,
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
    if (this.streak >= 2) {
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
    const fever = inFever(this.streak);
    for (const slot of [this.layout.slots[aIndex]!, this.layout.slots[bIndex]!]) {
      const cx = slot.x + this.layout.cardW / 2;
      const cy = slot.y + this.layout.cardH / 2;
      this.juice.burst(cx, cy, color, { count: 14, speed: 220, gravity: 300 });
      if (fever) this.juice.burst(cx, cy, ["#FFB020", "#FF4FD8", "#F4F7FB"], { count: 12 + this.streak * 2, speed: 340, size: 5 });
      if (golden) this.juice.burst(cx, cy, ["#FFD54A", "#FFF3B0", "#FFB020"], { count: 40, speed: 460, size: 6, life: 1 });
    }
    this.juice.shake(golden ? 0.45 : fever ? 0.22 : 0.12);
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
    }
  }

  private updateFx(dt: number): void {
    for (const floater of this.floaters) {
      floater.life -= dt;
      floater.y -= 28 * dt;
    }
    this.floaters.splice(0, this.floaters.length, ...this.floaters.filter((floater) => floater.life > 0));
  }

  private chooseBotIndex(): number {
    const known = pickKnownIndex(this.cards, this.memory, this.flipped[0] ?? null);
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

    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.font = narrow ? "600 13px Outfit, sans-serif" : "600 15px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText(this.phase === "peek" || this.phase === "closing" ? "Pairs  ·  memorize" : `Pairs  ·  ${left} left`, inset, narrow ? 122 : 26);

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
      g.fillText(`${player?.name ?? "Player"}'s turn`, inset, narrow ? 148 : 56);
      if (this.streak >= 2) {
        const mult = feverMultiplier(this.streak);
        const pulse = 1 + 0.08 * Math.sin(this.time * 12);
        g.save();
        g.translate(inset, narrow ? 170 : 78);
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
    this.drawFeverGlow(g);
    this.cards.forEach((card, index) => {
      const slot = this.layout.slots[index]!;
      const selected = humanTurn && this.useCursor && this.cursor === index && card.state === "down";
      const hovered = hoverIndex === index && card.state === "down" && this.phase === "play";
      this.drawCard(g, slot.x, slot.y, card, index, hovered || selected, selected);
    });

    this.juice.end(g);
    this.drawFloaters(g);
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
  }

  private drawBest(g: CanvasRenderingContext2D): void {
    if (bestHumanScore(this.ctx.players, this.scores) === null) return;
    g.font = "700 18px Bebas Neue, sans-serif";
    g.textAlign = "right";
    g.fillStyle = this.beatBest ? "#B8FF3D" : "#64748b";
    const right = this.layout.narrow ? this.ctx.width - 16 : this.ctx.width - 36;
    g.fillText(`BEST ${this.best}`, right, this.layout.narrow ? 122 : 78);
    g.textAlign = "left";
  }

  private drawFeverGlow(g: CanvasRenderingContext2D): void {
    if (this.phase !== "play" || !inFever(this.streak)) return;
    const first = this.layout.slots[0]!;
    const last = this.layout.slots[this.layout.slots.length - 1]!;
    const mult = feverMultiplier(this.streak);
    const color = mult >= 3 ? "#FF4FD8" : "#FFB020";
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 18 + 14 * pulse + (mult - 2) * 10;
    g.strokeStyle = color;
    g.globalAlpha = 0.5 + 0.4 * pulse;
    g.lineWidth = 3 + mult;
    roundRect(g, first.x - 10, first.y - 10, last.x + this.layout.cardW - first.x + 20, last.y + this.layout.cardH - first.y + 20, 18);
    g.stroke();
    g.restore();
  }

  private drawScores(g: CanvasRenderingContext2D): void {
    const count = this.ctx.players.length;
    const narrow = this.layout.narrow;
    const gap = narrow ? 8 : 10;
    const chipH = narrow ? 32 : 36;
    const inset = narrow ? 16 : 36;
    const chipW = narrow
      ? Math.min(160, (this.ctx.width - inset * 2 - gap * (count - 1)) / count)
      : 158;
    let x = narrow ? inset : this.ctx.width - inset - (count * chipW + (count - 1) * gap);
    const y = narrow ? 186 : 22;
    this.ctx.players.forEach((seat, index) => {
      const active = index === this.turn && this.phase === "play";
      roundRect(g, x, y, chipW, chipH, 16);
      g.fillStyle = active ? seat.color : "rgba(15, 23, 42, 0.82)";
      g.fill();
      g.strokeStyle = seat.color;
      g.lineWidth = active ? 0 : 1.5;
      if (!active) g.stroke();
      g.font = narrow ? "600 13px Outfit, sans-serif" : "600 16px Outfit, sans-serif";
      g.textAlign = "left";
      g.fillStyle = active ? "#071018" : seat.color;
      g.fillText(`${seat.name}`, x + 10, y + 21);
      g.textAlign = "right";
      g.font = "700 18px Bebas Neue, sans-serif";
      g.fillText(String(this.scores[index] ?? 0), x + chipW - 10, y + 22);
      x += chipW + gap;
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
  ): void {
    const visual = this.visuals[index]!;
    const peeking = this.phase === "peek";
    const shown = peeking ? "up" : shownFace(visual, card.state);
    const flipScale = peeking ? 1 : flipScaleX(visual.flipT);
    const bounce = 1 + visual.bounce * 0.16;
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
      g.strokeStyle = selected ? (this.ctx.players[this.turn]?.color ?? "#3EE0FF") : hover ? "#3EE0FF" : "#234";
      g.lineWidth = selected ? 3 : 2;
      g.stroke();
      g.fillStyle = "#3EE0FF";
      g.font = `700 ${Math.max(16, Math.round(cardW * 0.2))}px Bebas Neue, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("C5", cardW / 2, cardH / 2);
    } else {
      g.fillStyle = shown === "matched" ? "#d1fae5" : "#f8fafc";
      g.fill();
      g.strokeStyle = shown === "matched" ? "#34d399" : "#cbd5e1";
      g.lineWidth = 2;
      g.stroke();
      this.drawFlag(g, 0, 0, card.face, cardW, cardH);
      if (!peeking && card.face === this.goldenFace) this.drawShimmer(g, cardW, cardH);
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

  destroy(): void {}
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
  name: "Pairs",
  tagline: "Match flags. Stack a streak.",
  description:
    "A short peek (tap or Space to skip), then take turns flipping two cards. A match stays and you go again — streaks score bigger, 3 in a row starts FEVER (x2, then x3 at 5), one secret golden pair pays double, and the last pair is worth extra. A miss flips them back and play moves on.",
  durationMs: 0,
  controls: "Tap two face-down cards, or use WASD / arrows and Space / Enter.",
  fillsScreen: true,
  create: (ctx) => new PairsGame(ctx),
};

