import { fillArena } from "../core/draw";
import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, MinigameDefinition, MinigameInstance } from "../core/types";
import {
  canFlip,
  dealPairs,
  nextTurnIndex,
  PAIR_FACES,
  pickKnownIndex,
  remember,
  type PairCard,
  type PairFace,
} from "./pairs-logic";

const COLS = 6;
const ROWS = 6;
const CARD_W = 108;
const CARD_H = 88;
const GAP = 10;

class PairsGame implements MinigameInstance {
  private readonly cards: PairCard[];
  private readonly scores: number[];
  private readonly memory = new Map<string, number[]>();
  private turn = 0;
  private flipped: number[] = [];
  private lock = 0;
  private botWait = 0;
  private done = false;
  private readonly board = layoutBoard();

  constructor(private readonly ctx: MinigameContext) {
    this.cards = dealPairs(PAIR_FACES, (max) => this.ctx.rng.int(0, max - 1));
    this.scores = this.ctx.players.map(() => 0);
  }

  update(dt: number): void {
    if (this.done) return;
    this.lock = Math.max(0, this.lock - dt);
    if (this.lock > 0) return;

    if (this.flipped.length === 2) {
      this.resolvePair();
      return;
    }

    if (this.allMatched()) {
      this.done = true;
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
    const click = this.ctx.input.consumeClick();
    if (!click) return;
    const index = hitCard(this.board, click.x, click.y);
    if (index !== null) this.tryFlip(index);
  }

  private tryFlip(index: number): void {
    const card = this.cards[index];
    if (!canFlip(card) || this.flipped.includes(index)) return;
    card.state = "up";
    this.flipped.push(index);
    remember(this.memory, index, card.face);
    this.ctx.sfx.tick();
    if (this.flipped.length === 2) this.lock = 0.75;
  }

  private resolvePair(): void {
    const a = this.cards[this.flipped[0]!]!;
    const b = this.cards[this.flipped[1]!]!;
    const matched = a.face === b.face;
    if (matched) {
      a.state = "matched";
      b.state = "matched";
      this.scores[this.turn] = (this.scores[this.turn] ?? 0) + 1;
      this.ctx.sfx.collect();
      this.lock = 0.25;
    } else {
      a.state = "down";
      b.state = "down";
      this.ctx.sfx.miss();
      this.lock = 0.2;
    }
    this.turn = nextTurnIndex(this.turn, this.ctx.players.length, matched);
    this.flipped = [];
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

    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    g.fillStyle = "#94a3b8";
    g.fillText("Pairs  6×6", 40, 28);
    g.font = "700 26px Bebas Neue, sans-serif";
    g.fillStyle = player?.color ?? "#F4F7FB";
    g.fillText(`${player?.name ?? "Player"}'s turn`, 40, 54);

    this.ctx.players.forEach((seat, index) => {
      const x = 360 + index * 180;
      g.fillStyle = index === this.turn ? seat.color : "#64748b";
      g.font = "600 16px Outfit, sans-serif";
      g.fillText(`${seat.name}  ${this.scores[index] ?? 0}`, x, 48);
    });

    this.cards.forEach((card, index) => {
      const slot = this.board[index]!;
      drawCard(g, slot.x, slot.y, card, hoverIndex === index && card.state === "down");
    });
  }

  isFinished(): boolean {
    return this.done;
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
  const top = GAME_HEIGHT - height - 24;
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

function drawCard(g: CanvasRenderingContext2D, x: number, y: number, card: PairCard, hover: boolean): void {
  g.save();
  roundRect(g, x, y, CARD_W, CARD_H, 14);
  if (card.state === "down") {
    g.fillStyle = hover ? "#1d4e63" : "#122033";
    g.fill();
    g.strokeStyle = hover ? "#3EE0FF" : "#234";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#3EE0FF";
    g.font = "700 20px Bebas Neue, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("C5", x + CARD_W / 2, y + CARD_H / 2);
  } else {
    g.fillStyle = card.state === "matched" ? "#163024" : "#f4f7fb";
    g.fill();
    g.strokeStyle = card.state === "matched" ? "#3dd68c" : "#cbd5e1";
    g.lineWidth = 2;
    g.stroke();
    drawFace(g, x + CARD_W / 2, y + CARD_H / 2, card.face, card.state === "matched");
  }
  g.restore();
}

function drawFace(g: CanvasRenderingContext2D, cx: number, cy: number, face: PairFace, dim: boolean): void {
  g.save();
  g.translate(cx, cy);
  g.scale(0.62, 0.62);
  g.strokeStyle = dim ? "#86efac" : "#0f172a";
  g.fillStyle = dim ? "#86efac" : "#0f172a";
  g.lineWidth = 4;
  g.lineJoin = "round";
  switch (face) {
    case "bolt":
      g.beginPath();
      g.moveTo(-8, -28);
      g.lineTo(10, -4);
      g.lineTo(-2, 0);
      g.lineTo(12, 28);
      g.lineTo(-10, 2);
      g.lineTo(2, -2);
      g.closePath();
      g.fill();
      break;
    case "swirl":
      g.beginPath();
      g.arc(0, 0, 22, 0.2, Math.PI * 1.7);
      g.stroke();
      g.beginPath();
      g.arc(4, -2, 10, Math.PI, Math.PI * 1.8);
      g.stroke();
      break;
    case "star":
      g.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 24 : 10;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      break;
    case "drop":
      g.beginPath();
      g.moveTo(0, -26);
      g.quadraticCurveTo(22, 8, 0, 24);
      g.quadraticCurveTo(-22, 8, 0, -26);
      g.fill();
      break;
    case "flame":
      g.beginPath();
      g.moveTo(0, 24);
      g.bezierCurveTo(22, 10, 16, -8, 0, -26);
      g.bezierCurveTo(-4, -4, -20, 0, 0, 24);
      g.fill();
      break;
    case "moon":
      g.beginPath();
      g.arc(0, 0, 22, 0.45, Math.PI * 2 - 0.45);
      g.bezierCurveTo(8, 16, 8, -16, Math.cos(0.45) * 22, Math.sin(-0.45) * 22);
      g.closePath();
      g.fill();
      break;
    case "gem":
      g.beginPath();
      g.moveTo(0, -24);
      g.lineTo(20, -4);
      g.lineTo(0, 26);
      g.lineTo(-20, -4);
      g.closePath();
      g.fill();
      break;
    case "eye":
      g.beginPath();
      g.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 6, 0, Math.PI * 2);
      g.fill();
      break;
    case "heart":
      g.beginPath();
      g.moveTo(0, 22);
      g.bezierCurveTo(-28, 4, -24, -22, 0, -8);
      g.bezierCurveTo(24, -22, 28, 4, 0, 22);
      g.fill();
      break;
    case "sun":
      g.beginPath();
      g.arc(0, 0, 12, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 8; i += 1) {
        const a = (i * Math.PI) / 4;
        g.beginPath();
        g.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
        g.lineTo(Math.cos(a) * 26, Math.sin(a) * 26);
        g.stroke();
      }
      break;
    case "plus":
      g.fillRect(-7, -24, 14, 48);
      g.fillRect(-24, -7, 48, 14);
      break;
    case "ring":
      g.beginPath();
      g.arc(0, 0, 22, 0, Math.PI * 2);
      g.stroke();
      break;
    case "triangle":
      g.beginPath();
      g.moveTo(0, -24);
      g.lineTo(24, 20);
      g.lineTo(-24, 20);
      g.closePath();
      g.fill();
      break;
    case "square":
      g.fillRect(-20, -20, 40, 40);
      break;
    case "hex":
      g.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 6) + (i * Math.PI) / 3;
        g.lineTo(Math.cos(a) * 24, Math.sin(a) * 24);
      }
      g.closePath();
      g.fill();
      break;
    case "arrow":
      g.beginPath();
      g.moveTo(0, -26);
      g.lineTo(18, -4);
      g.lineTo(8, -4);
      g.lineTo(8, 26);
      g.lineTo(-8, 26);
      g.lineTo(-8, -4);
      g.lineTo(-18, -4);
      g.closePath();
      g.fill();
      break;
    case "cross":
      g.beginPath();
      g.moveTo(-20, -20);
      g.lineTo(20, 20);
      g.moveTo(20, -20);
      g.lineTo(-20, 20);
      g.stroke();
      break;
    case "leaf":
      g.beginPath();
      g.moveTo(0, 24);
      g.quadraticCurveTo(28, 0, 0, -26);
      g.quadraticCurveTo(-28, 0, 0, 24);
      g.fill();
      g.beginPath();
      g.moveTo(0, 20);
      g.lineTo(0, -16);
      g.stroke();
      break;
  }
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

export const pairs: MinigameDefinition = {
  id: "pairs",
  name: "Pairs",
  tagline: "Cards face down. Draw two. Make a match.",
  description: "Take turns flipping two cards. A pair stays in front of you and you go again. A miss flips them back and play moves on.",
  durationMs: 0,
  controls: "Click two face-down cards.",
  create: (ctx) => new PairsGame(ctx),
};
