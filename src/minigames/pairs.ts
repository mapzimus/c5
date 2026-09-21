import { fillArena } from "../core/draw";
import { PLAYER_BINDS } from "../core/input";
import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, MinigameDefinition, MinigameInstance } from "../core/types";
import { CRESTS, PAIR_COUNT } from "./crests";
import {
  BOT_MEMORY_LIMIT,
  canFlip,
  dealPairs,
  glimpseIndices,
  nextStreak,
  nextTurnIndex,
  pickFaces,
  pickKnownIndex,
  pointsForMatch,
  remainingPairs,
  rememberCard,
  stepCursor,
  type CardState,
  type PairCard,
} from "./pairs-logic";

const COLS = 6;
const ROWS = 6;
const CARD_W = 102;
const CARD_H = 96;
const GAP = 8;
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
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  r: number;
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

class PairsGame implements MinigameInstance {
  private readonly cards: PairCard[];
  private readonly scores: number[];
  private readonly memory = new Map<string, number[]>();
  private readonly recency: number[] = [];
  private readonly logos = new Map<string, HTMLImageElement>();
  private readonly names = new Map<string, string>();
  private readonly visuals: Visual[];
  private readonly sparks: Spark[] = [];
  private readonly floaters: Floater[] = [];
  private turn = 0;
  private streak = 0;
  private flipped: number[] = [];
  private lock = 0;
  private botWait = 0;
  private phase: Phase = "peek";
  private peekLeft = PEEK_SECONDS;
  private cursor = 0;
  private readonly board = layoutBoard();

  constructor(private readonly ctx: MinigameContext) {
    const faces = pickFaces(
      CRESTS.map((crest) => crest.id),
      PAIR_COUNT,
      (max) => this.ctx.rng.int(0, max - 1),
    );
    this.cards = dealPairs(faces, (max) => this.ctx.rng.int(0, max - 1));
    this.scores = this.ctx.players.map(() => 0);
    this.visuals = this.cards.map(() => ({
      flipT: 0,
      from: "up",
      to: "up",
      bounce: 0,
    }));
    this.preloadLogos(new Set(faces));
    for (const index of glimpseIndices(this.cards.length, BOT_MEMORY_LIMIT, (max) => this.ctx.rng.int(0, max - 1))) {
      const card = this.cards[index];
      if (card) rememberCard(this.memory, this.recency, index, card.face);
    }
  }

  private preloadLogos(faces: Set<string>): void {
    const base = import.meta.env.BASE_URL;
    for (const crest of CRESTS) {
      if (!faces.has(crest.id)) continue;
      const img = new Image();
      img.src = `${base}crests/${crest.file}`;
      this.logos.set(crest.id, img);
      this.names.set(crest.id, crest.name);
    }
  }

  update(dt: number): void {
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
      const index = hitCard(this.board, click.x, click.y);
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
    if (left) this.moveCursor(-1, 0);
    else if (right) this.moveCursor(1, 0);
    else if (up) this.moveCursor(0, -1);
    else if (down) this.moveCursor(0, 1);

    if (
      this.ctx.input.actionPressed(slot) ||
      this.ctx.input.justPressed("Space") ||
      this.ctx.input.justPressed("Enter")
    ) {
      this.tryFlip(this.cursor);
    }
  }

  private pressed(slot: 0 | 1 | 2 | 3, dir: "left" | "right" | "up" | "down"): boolean {
    return this.ctx.input.justPressed(PLAYER_BINDS[slot]![dir]);
  }

  private moveCursor(dx: number, dy: number): void {
    this.cursor = stepCursor(this.cursor, dx, dy, COLS, ROWS, (index) => canFlip(this.cards[index]));
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
    this.streak = nextStreak(this.streak, matched);

    if (matched) {
      a.state = "matched";
      b.state = "matched";
      this.visuals[aIndex]!.bounce = 1;
      this.visuals[bIndex]!.bounce = 1;
      this.visuals[aIndex]!.to = "matched";
      this.visuals[bIndex]!.to = "matched";
      const points = pointsForMatch(this.streak, remainingPairs(this.cards));
      this.scores[this.turn] = (this.scores[this.turn] ?? 0) + points;
      this.burst(aIndex, bIndex, points, a.face);
      if (this.streak >= 2) this.ctx.sfx.streak(this.streak);
      else this.ctx.sfx.collect();
      this.lock = MATCH_LOCK;
    } else {
      a.state = "down";
      b.state = "down";
      this.startFlip(aIndex, "up", "down");
      this.startFlip(bIndex, "up", "down");
      this.ctx.sfx.miss();
      this.lock = MISS_LOCK;
    }
    this.turn = nextTurnIndex(this.turn, this.ctx.players.length, matched);
    this.flipped = [];
    this.parkCursor();
  }

  private burst(aIndex: number, bIndex: number, points: number, face: string): void {
    const player = this.ctx.players[this.turn];
    const color = player?.color ?? "#3EE0FF";
    const mid = midpoint(this.board[aIndex]!, this.board[bIndex]!);
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
      this.floaters.push({
        text: `STREAK ×${this.streak}`,
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
    for (const slot of [this.board[aIndex]!, this.board[bIndex]!]) {
      const cx = slot.x + CARD_W / 2;
      const cy = slot.y + CARD_H / 2;
      for (let i = 0; i < 10; i += 1) {
        const angle = this.ctx.rng.float(0, Math.PI * 2);
        const speed = this.ctx.rng.float(40, 160);
        this.sparks.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 30,
          life: this.ctx.rng.float(0.35, 0.7),
          max: 0.7,
          color,
          r: this.ctx.rng.float(2, 4.5),
        });
      }
    }
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
    }
  }

  private updateFx(dt: number): void {
    for (const spark of this.sparks) {
      spark.life -= dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vy += 220 * dt;
    }
    this.sparks.splice(0, this.sparks.length, ...this.sparks.filter((spark) => spark.life > 0));
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
    fillArena(g, this.ctx.width, this.ctx.height);
    const hover = this.ctx.input.hover;
    const hoverIndex = hover ? hitCard(this.board, hover.x, hover.y) : null;
    const player = this.ctx.players[this.turn];
    const left = remainingPairs(this.cards);
    const humanTurn = player?.kind === "human" && this.phase === "play";

    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.font = "600 15px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText(this.phase === "peek" || this.phase === "closing" ? "Pairs FC  ·  memorize" : `Pairs FC  ·  ${left} left`, 40, 26);

    g.font = "700 30px Bebas Neue, sans-serif";
    if (this.phase === "peek" || this.phase === "closing") {
      g.fillStyle = "#FFB020";
      g.fillText("Memorize the crests", 40, 56);
      if (this.phase === "peek") {
        g.font = "600 14px Outfit, sans-serif";
        g.fillStyle = "#64748b";
        g.fillText("Click or Space to skip", 40, 78);
      }
    } else {
      g.fillStyle = player?.color ?? "#F4F7FB";
      g.fillText(`${player?.name ?? "Player"}'s turn`, 40, 56);
      if (this.streak >= 2) {
        g.font = "700 16px Outfit, sans-serif";
        g.fillStyle = "#FFB020";
        g.fillText(`Streak ×${this.streak}`, 40, 78);
      }
    }

    this.drawScores(g);

    this.cards.forEach((card, index) => {
      const slot = this.board[index]!;
      const selected = humanTurn && this.cursor === index && card.state === "down";
      const hovered = hoverIndex === index && card.state === "down" && this.phase === "play";
      this.drawCard(g, slot.x, slot.y, card, index, hovered || selected, selected);
    });

    this.drawSparks(g);
    this.drawFloaters(g);
  }

  private drawScores(g: CanvasRenderingContext2D): void {
    const chipW = 158;
    const chipH = 36;
    const gap = 10;
    const total = this.ctx.players.length * chipW + (this.ctx.players.length - 1) * gap;
    let x = GAME_WIDTH - 36 - total;
    this.ctx.players.forEach((seat, index) => {
      const active = index === this.turn && this.phase === "play";
      roundRect(g, x, 22, chipW, chipH, 18);
      g.fillStyle = active ? seat.color : "rgba(15, 23, 42, 0.82)";
      g.fill();
      g.strokeStyle = seat.color;
      g.lineWidth = active ? 0 : 1.5;
      if (!active) g.stroke();
      g.font = "600 16px Outfit, sans-serif";
      g.textAlign = "left";
      g.fillStyle = active ? "#071018" : seat.color;
      g.fillText(`${seat.name}`, x + 14, 45);
      g.textAlign = "right";
      g.font = "700 20px Bebas Neue, sans-serif";
      g.fillText(String(this.scores[index] ?? 0), x + chipW - 14, 46);
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

    g.save();
    g.translate(x + CARD_W / 2, y + CARD_H / 2 + lift);
    g.scale(Math.max(0.06, flipScale) * bounce, bounce);
    g.translate(-CARD_W / 2, -CARD_H / 2);

    roundRect(g, 0, 0, CARD_W, CARD_H, 12);
    if (shown === "down") {
      g.fillStyle = hover ? "#1d4e63" : "#122033";
      g.fill();
      g.strokeStyle = selected ? (this.ctx.players[this.turn]?.color ?? "#3EE0FF") : hover ? "#3EE0FF" : "#234";
      g.lineWidth = selected ? 3 : 2;
      g.stroke();
      g.fillStyle = "#3EE0FF";
      g.font = "700 20px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("C5", CARD_W / 2, CARD_H / 2);
    } else {
      g.fillStyle = shown === "matched" ? "#d1fae5" : "#f8fafc";
      g.fill();
      g.strokeStyle = shown === "matched" ? "#34d399" : "#cbd5e1";
      g.lineWidth = 2;
      g.stroke();
      this.drawLogo(g, 0, 0, card.face);
    }
    g.restore();
  }

  private drawLogo(g: CanvasRenderingContext2D, x: number, y: number, face: string): void {
    const img = this.logos.get(face);
    const pad = 10;
    const boxW = CARD_W - pad * 2;
    const boxH = CARD_H - pad * 2;
    const cx = x + CARD_W / 2;
    const cy = y + CARD_H / 2;
    if (!img || !img.complete || img.naturalWidth === 0) {
      g.fillStyle = "#94a3b8";
      g.font = "600 11px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(this.names.get(face) ?? face, cx, cy);
      return;
    }
    const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    g.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  private drawSparks(g: CanvasRenderingContext2D): void {
    for (const spark of this.sparks) {
      g.globalAlpha = Math.max(0, spark.life / spark.max);
      g.fillStyle = spark.color;
      g.beginPath();
      g.arc(spark.x, spark.y, spark.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
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

interface Slot {
  x: number;
  y: number;
}

function layoutBoard(): Slot[] {
  const width = COLS * CARD_W + (COLS - 1) * GAP;
  const height = ROWS * CARD_H + (ROWS - 1) * GAP;
  const left = (GAME_WIDTH - width) / 2;
  const top = GAME_HEIGHT - height - 20;
  const slots: Slot[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      slots.push({
        x: left + col * (CARD_W + GAP),
        y: top + row * (CARD_H + GAP),
      });
    }
  }
  return slots;
}

function hitCard(board: Slot[], x: number, y: number): number | null {
  const index = board.findIndex(
    (slot) => x >= slot.x && x <= slot.x + CARD_W && y >= slot.y && y <= slot.y + CARD_H,
  );
  return index >= 0 ? index : null;
}

function midpoint(a: Slot, b: Slot): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2 + CARD_W / 2,
    y: (a.y + b.y) / 2 + CARD_H / 2,
  };
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

export const pairs: MinigameDefinition = {
  id: "pairs",
  name: "Pairs FC",
  tagline: "Match crests. Stack a streak.",
  description:
    "A short peek (click or Space to skip), then take turns flipping two cards. A match stays and you go again — streaks score bigger, and the last pair is worth extra. A miss flips them back and play moves on.",
  durationMs: 0,
  controls: "Click two face-down cards, or WASD / arrows and Space / Enter.",
  create: (ctx) => new PairsGame(ctx),
};
