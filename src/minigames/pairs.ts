import { fillArena } from "../core/draw";
import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, MinigameDefinition, MinigameInstance } from "../core/types";
import { CRESTS, PAIR_FACES } from "./crests";
import { canFlip, dealPairs, nextTurnIndex, pickKnownIndex, remember, type PairCard } from "./pairs-logic";

const COLS = 6;
const ROWS = 6;
const CARD_W = 102;
const CARD_H = 96;
const GAP = 8;

class PairsGame implements MinigameInstance {
  private readonly cards: PairCard[];
  private readonly scores: number[];
  private readonly memory = new Map<string, number[]>();
  private readonly logos = new Map<string, HTMLImageElement>();
  private turn = 0;
  private flipped: number[] = [];
  private lock = 0;
  private botWait = 0;
  private done = false;
  private readonly board = layoutBoard();

  constructor(private readonly ctx: MinigameContext) {
    this.cards = dealPairs(PAIR_FACES, (max) => this.ctx.rng.int(0, max - 1));
    this.scores = this.ctx.players.map(() => 0);
    this.preloadLogos();
  }

  private preloadLogos(): void {
    const base = import.meta.env.BASE_URL;
    for (const crest of CRESTS) {
      const img = new Image();
      img.src = `${base}crests/${crest.file}`;
      this.logos.set(crest.id, img);
    }
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
      this.drawCard(g, slot.x, slot.y, card, hoverIndex === index && card.state === "down");
    });
  }

  private drawCard(g: CanvasRenderingContext2D, x: number, y: number, card: PairCard, hover: boolean): void {
    g.save();
    roundRect(g, x, y, CARD_W, CARD_H, 12);
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
      g.fillStyle = card.state === "matched" ? "#d1fae5" : "#f8fafc";
      g.fill();
      g.strokeStyle = card.state === "matched" ? "#34d399" : "#cbd5e1";
      g.lineWidth = 2;
      g.stroke();
      this.drawLogo(g, x, y, card.face);
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
      g.fillText(face, cx, cy);
      return;
    }
    const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    g.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
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
  tagline: "Match the club crests.",
  description: "Take turns flipping two cards. A matching soccer crest stays and you go again. A miss flips them back and play moves on.",
  durationMs: 0,
  controls: "Click two face-down cards.",
  create: (ctx) => new PairsGame(ctx),
};
