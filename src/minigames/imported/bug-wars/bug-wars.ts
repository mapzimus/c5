import { fillArena } from "../../../core/draw";
import { Callouts, Juice } from "../../../fx/juice";
import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "../../../core/types";
import {
  MAX_BUGS,
  MAX_ROUNDS,
  NO_OWNER,
  type Battle,
  type Board,
  type Species,
  applyBattle,
  botPickAttack,
  canAttack,
  endTurnIncome,
  gameOver,
  generateBoard,
  hasAnyAttack,
  nextSeat,
  rollBattle,
  speciesFor,
  targetsFrom,
  tilesOwned,
} from "./rules";

const HEX_R = 38;
const HEX_W = HEX_R * Math.sqrt(3);
const HEX_H = HEX_R * 2;

type Phase = "intro" | "pick" | "target" | "rolling" | "resolve" | "reinforce" | "bot" | "done";

interface DiceAnim {
  battle: Battle;
  timer: number;
  settled: boolean;
  attackShown: number[];
  defendShown: number[];
}

interface ReinforceAnim {
  tiles: number[];
  timer: number;
  index: number;
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

class BugWarsGame implements MinigameInstance {
  private board: Board;
  private readonly stash: number[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly floaters: Floater[] = [];
  private time = 0;
  private phase: Phase = "intro";
  private introTimer = 1.8;
  private currentSeat = 0;
  private round = 1;
  private selected = -1;
  private diceAnim: DiceAnim | null = null;
  private reinforceAnim: ReinforceAnim | null = null;
  private botDelay = 0;
  private botAttacksLeft = 0;
  private hexCenters: { x: number; y: number }[] = [];

  constructor(private readonly ctx: MinigameContext) {
    this.juice = new Juice();
    this.board = generateBoard(ctx.rng, ctx.players.length);
    this.stash = ctx.players.map(() => 0);
    this.computeHexLayout();
    this.callouts.show("BUG WARS", "#B8FF3D", { size: 72, life: 1.4 });
    ctx.sfx.countdown();
  }

  private computeHexLayout(): void {
    const tileCount = this.board.tiles.length;
    const minCol = Math.min(...this.board.tiles.map((t) => t.col));
    const maxCol = Math.max(...this.board.tiles.map((t) => t.col));
    const minRow = Math.min(...this.board.tiles.map((t) => t.row));
    const maxRow = Math.max(...this.board.tiles.map((t) => t.row));
    const gridW = (maxCol - minCol + 1) * HEX_W + HEX_W * 0.5;
    const gridH = (maxRow - minRow + 1) * HEX_H * 0.75 + HEX_H * 0.25;
    const offsetX = (GAME_WIDTH - gridW) / 2 + HEX_W * 0.5;
    const offsetY = (GAME_HEIGHT - gridH) / 2 + HEX_R + 30;

    this.hexCenters = new Array(tileCount);
    for (const tile of this.board.tiles) {
      const x = offsetX + (tile.col - minCol) * HEX_W + (tile.row % 2 === 1 ? HEX_W * 0.5 : 0);
      const y = offsetY + (tile.row - minRow) * HEX_H * 0.75;
      this.hexCenters[tile.id] = { x, y };
    }
  }

  update(realDt: number): void {
    const dt = this.juice.update(realDt);
    this.callouts.update(realDt);
    this.time += realDt;
    this.updateFloaters(dt);

    if (this.phase === "done") return;

    if (this.phase === "intro") {
      this.introTimer -= dt;
      if (this.introTimer <= 0) {
        this.phase = this.isHuman(this.currentSeat) ? "pick" : "bot";
        this.botDelay = 0.6;
        this.botAttacksLeft = 3;
        this.ctx.sfx.go();
      }
      return;
    }

    if (this.phase === "rolling") {
      this.updateDiceAnim(dt);
      return;
    }

    if (this.phase === "resolve") {
      this.resolveAfterBattle();
      return;
    }

    if (this.phase === "reinforce") {
      this.updateReinforce(dt);
      return;
    }

    if (this.phase === "bot") {
      this.updateBot(dt);
      return;
    }

    if (this.phase === "pick" || this.phase === "target") {
      this.handleHumanInput();
    }
  }

  private isHuman(seat: number): boolean {
    return this.ctx.players[seat]?.kind === "human";
  }

  private handleHumanInput(): void {
    const click = this.ctx.input.consumeClick();
    if (!click) return;

    const tileId = this.hitTile(click.x, click.y);
    if (tileId === null) return;

    if (this.phase === "pick") {
      const tile = this.board.tiles[tileId];
      if (tile && tile.owner === this.currentSeat && tile.bugs >= 2 && targetsFrom(this.board, tileId).length > 0) {
        this.selected = tileId;
        this.phase = "target";
        this.ctx.sfx.tick();
      }
    } else if (this.phase === "target") {
      if (tileId === this.selected) {
        this.selected = -1;
        this.phase = "pick";
        return;
      }
      const tile = this.board.tiles[tileId];
      if (tile && tile.owner === this.currentSeat && tile.bugs >= 2 && targetsFrom(this.board, tileId).length > 0) {
        this.selected = tileId;
        this.ctx.sfx.tick();
        return;
      }
      if (canAttack(this.board, this.selected, tileId, this.currentSeat)) {
        this.launchAttack(this.selected, tileId);
      }
    }
  }

  private handlePassInput(): boolean {
    if (this.ctx.input.justPressed("Space") || this.ctx.input.justPressed("Enter")) {
      return true;
    }
    return false;
  }

  private launchAttack(from: number, to: number): void {
    const battle = rollBattle(this.board, from, to, this.ctx.rng);
    this.diceAnim = {
      battle,
      timer: 0,
      settled: false,
      attackShown: battle.attackRolls.map(() => 0),
      defendShown: battle.defendRolls.map(() => 0),
    };
    this.phase = "rolling";
    this.selected = -1;
  }

  private updateDiceAnim(dt: number): void {
    if (!this.diceAnim) return;
    this.diceAnim.timer += dt;

    const rollDur = 0.6;
    const settleDur = 0.4;

    if (this.diceAnim.timer < rollDur) {
      for (let i = 0; i < this.diceAnim.attackShown.length; i++) {
        this.diceAnim.attackShown[i] = this.ctx.rng.int(1, 6);
      }
      for (let i = 0; i < this.diceAnim.defendShown.length; i++) {
        this.diceAnim.defendShown[i] = this.ctx.rng.int(1, 6);
      }
    } else if (!this.diceAnim.settled) {
      this.diceAnim.settled = true;
      this.diceAnim.attackShown = [...this.diceAnim.battle.attackRolls];
      this.diceAnim.defendShown = [...this.diceAnim.battle.defendRolls];
      if (this.diceAnim.battle.captured) {
        this.ctx.sfx.hit();
        this.juice.shake(0.4);
      } else {
        this.ctx.sfx.miss();
        this.juice.shake(0.15);
      }
    }

    if (this.diceAnim.timer > rollDur + settleDur) {
      this.phase = "resolve";
    }
  }

  private resolveAfterBattle(): void {
    if (!this.diceAnim) return;
    const battle = this.diceAnim.battle;
    applyBattle(this.board, battle);

    const center = this.hexCenters[battle.to]!;
    if (battle.captured) {
      this.callouts.show("CAPTURED!", this.ctx.players[battle.attacker]?.color ?? "#3EE0FF", { size: 52, life: 0.8 });
      this.juice.burst(center.x, center.y, this.ctx.players[battle.attacker]?.color ?? "#3EE0FF", { count: 20, speed: 280, gravity: 400 });
      this.floaters.push({
        text: "CONQUERED",
        x: center.x,
        y: center.y - 30,
        life: 1,
        max: 1,
        color: this.ctx.players[battle.attacker]?.color ?? "#3EE0FF",
        size: 20,
      });
    } else {
      this.floaters.push({
        text: "DEFENDED",
        x: center.x,
        y: center.y - 30,
        life: 1,
        max: 1,
        color: this.ctx.players[battle.defender]?.color ?? "#FF3D7A",
        size: 20,
      });
    }

    this.diceAnim = null;

    const end = gameOver(this.board, this.ctx.players.length, this.round);
    if (end) {
      this.phase = "done";
      this.ctx.sfx.win();
      this.callouts.show(end === "conquered" ? "TOTAL CONQUEST" : "GARDEN CLAIMED", "#FFB020", { size: 64, life: 2 });
      return;
    }

    if (this.isHuman(this.currentSeat)) {
      if (hasAnyAttack(this.board, this.currentSeat)) {
        this.phase = "pick";
      } else {
        this.advanceTurn();
      }
    } else {
      this.phase = "bot";
      this.botDelay = 0.5;
    }
  }

  private advanceTurn(): void {
    const income = endTurnIncome(this.board, this.currentSeat, this.stash[this.currentSeat]!, this.ctx.rng);
    this.stash[this.currentSeat] = income.stash;

    if (income.placed.length > 0) {
      this.reinforceAnim = { tiles: income.placed, timer: 0, index: 0 };
      this.phase = "reinforce";
      return;
    }

    this.goToNextSeat();
  }

  private updateReinforce(dt: number): void {
    if (!this.reinforceAnim) return;
    this.reinforceAnim.timer += dt;
    const pace = 0.06;
    while (this.reinforceAnim.index < this.reinforceAnim.tiles.length && this.reinforceAnim.timer >= pace) {
      this.reinforceAnim.timer -= pace;
      this.reinforceAnim.index++;
      this.ctx.sfx.tick();
    }
    if (this.reinforceAnim.index >= this.reinforceAnim.tiles.length) {
      this.reinforceAnim = null;
      this.goToNextSeat();
    }
  }

  private goToNextSeat(): void {
    const next = nextSeat(this.board, this.ctx.players.length, this.currentSeat);
    if (!next) {
      this.phase = "done";
      this.ctx.sfx.win();
      this.callouts.show("TOTAL CONQUEST", "#FFB020", { size: 64, life: 2 });
      return;
    }

    if (next.wrapped) {
      this.round++;
      const end = gameOver(this.board, this.ctx.players.length, this.round);
      if (end) {
        this.phase = "done";
        this.ctx.sfx.win();
        this.callouts.show("GARDEN CLAIMED", "#FFB020", { size: 64, life: 2 });
        return;
      }
    }

    this.currentSeat = next.seat;
    this.selected = -1;

    if (this.isHuman(this.currentSeat)) {
      this.phase = "pick";
      this.callouts.show(`${this.ctx.players[this.currentSeat]!.name}'s turn`, this.ctx.players[this.currentSeat]!.color, { size: 48, life: 0.7, y: 0.25 });
    } else {
      this.phase = "bot";
      this.botDelay = 0.6;
      this.botAttacksLeft = 3;
    }
  }

  private updateBot(dt: number): void {
    this.botDelay -= dt;
    if (this.botDelay > 0) return;

    if (this.botAttacksLeft <= 0 || !hasAnyAttack(this.board, this.currentSeat)) {
      this.advanceTurn();
      return;
    }

    const choice = botPickAttack(this.board, this.currentSeat, this.ctx.rng);
    if (!choice) {
      this.advanceTurn();
      return;
    }

    this.botAttacksLeft--;
    this.launchAttack(choice.from, choice.to);
  }

  private hitTile(x: number, y: number): number | null {
    let best = -1;
    let bestDist = HEX_R * 1.1;
    for (let i = 0; i < this.hexCenters.length; i++) {
      const center = this.hexCenters[i]!;
      const dx = x - center.x;
      const dy = y - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  private updateFloaters(dt: number): void {
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 22 * dt;
    }
    this.floaters.splice(0, this.floaters.length, ...this.floaters.filter((f) => f.life > 0));
  }

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    this.drawHUD(g);
    this.juice.begin(g);
    this.drawBoard(g);
    this.juice.end(g);
    this.drawDiceOverlay(g);
    this.drawFloaters(g);
    this.callouts.draw(g, this.ctx.width, this.ctx.height);

    if (this.phase === "pick" && this.isHuman(this.currentSeat)) {
      this.drawPassHint(g);
    }
  }

  private drawHUD(g: CanvasRenderingContext2D): void {
    g.font = "600 15px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#94a3b8";
    g.fillText(`Bug Wars  ·  Round ${this.round}/${MAX_ROUNDS}`, 40, 26);

    const chipW = 140;
    const chipH = 34;
    const gap = 8;
    const total = this.ctx.players.length * chipW + (this.ctx.players.length - 1) * gap;
    let x = GAME_WIDTH - 36 - total;
    for (let i = 0; i < this.ctx.players.length; i++) {
      const player = this.ctx.players[i]!;
      const active = i === this.currentSeat && this.phase !== "done";
      const tiles = tilesOwned(this.board, i);

      g.beginPath();
      roundRect(g, x, 16, chipW, chipH, 16);
      g.fillStyle = active ? player.color : "rgba(15, 23, 42, 0.82)";
      g.fill();
      if (!active) {
        g.strokeStyle = player.color;
        g.lineWidth = 1.5;
        g.stroke();
      }

      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "left";
      g.fillStyle = active ? "#071018" : player.color;
      const emoji = speciesEmoji(speciesFor(player.slot));
      g.fillText(`${emoji} ${player.name}`, x + 10, 38);

      g.textAlign = "right";
      g.font = "700 18px Bebas Neue, sans-serif";
      g.fillText(String(tiles), x + chipW - 10, 39);

      x += chipW + gap;
    }
    g.textAlign = "left";
  }

  private drawBoard(g: CanvasRenderingContext2D): void {
    const hover = this.ctx.input.hover;
    const hoverId = hover ? this.hitTile(hover.x, hover.y) : null;

    for (let i = 0; i < this.board.tiles.length; i++) {
      const tile = this.board.tiles[i]!;
      const center = this.hexCenters[i]!;
      const isSelected = tile.id === this.selected;
      const isTarget = this.phase === "target" && canAttack(this.board, this.selected, tile.id, this.currentSeat);
      const isHovered = hoverId === i;
      const isAttackable = this.phase === "pick" && tile.owner === this.currentSeat && tile.bugs >= 2 && targetsFrom(this.board, tile.id).length > 0;

      this.drawHex(g, center.x, center.y, tile, isSelected, isTarget, isHovered, isAttackable);
    }
  }

  private drawHex(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tile: { owner: number; bugs: number; id: number },
    selected: boolean,
    isTarget: boolean,
    hovered: boolean,
    attackable: boolean,
  ): void {
    const player = tile.owner !== NO_OWNER ? this.ctx.players[tile.owner] : null;
    const baseColor = player?.color ?? "#334155";
    const species = tile.owner !== NO_OWNER ? speciesFor(this.ctx.players[tile.owner]?.slot ?? 0) : "ants";

    g.save();

    hexPath(g, cx, cy, HEX_R - 2);
    if (tile.owner !== NO_OWNER) {
      g.fillStyle = hexDimColor(baseColor, 0.35);
      g.fill();
    } else {
      g.fillStyle = "rgba(30, 41, 59, 0.5)";
      g.fill();
    }

    if (selected) {
      g.strokeStyle = "#FFD54A";
      g.lineWidth = 3;
      g.shadowColor = "#FFD54A";
      g.shadowBlur = 12;
      g.stroke();
      g.shadowBlur = 0;
    } else if (isTarget) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 8);
      g.strokeStyle = `rgba(255, 61, 122, ${0.5 + 0.5 * pulse})`;
      g.lineWidth = 2.5;
      g.stroke();
    } else if (hovered && attackable) {
      g.strokeStyle = baseColor;
      g.lineWidth = 2.5;
      g.stroke();
    } else {
      g.strokeStyle = "rgba(148, 163, 184, 0.2)";
      g.lineWidth = 1;
      g.stroke();
    }

    if (tile.owner !== NO_OWNER) {
      drawBugSprite(g, cx, cy - 4, species, baseColor, HEX_R * 0.42, this.time, tile.id);

      g.font = "700 16px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#F4F7FB";
      g.shadowColor = "rgba(0,0,0,0.7)";
      g.shadowBlur = 3;
      g.fillText(String(tile.bugs), cx, cy + HEX_R * 0.52);
      g.shadowBlur = 0;

      if (tile.bugs >= MAX_BUGS) {
        g.font = "600 9px Outfit, sans-serif";
        g.fillStyle = "#FFB020";
        g.fillText("MAX", cx, cy + HEX_R * 0.78);
      }
    }

    g.restore();
  }

  private drawDiceOverlay(g: CanvasRenderingContext2D): void {
    if (!this.diceAnim) return;
    const battle = this.diceAnim.battle;
    const centerX = GAME_WIDTH / 2;
    const y = GAME_HEIGHT - 90;

    g.save();
    g.fillStyle = "rgba(7, 11, 20, 0.75)";
    roundRect(g, centerX - 220, y - 40, 440, 70, 12);
    g.fill();

    const attackColor = this.ctx.players[battle.attacker]?.color ?? "#3EE0FF";
    const defendColor = this.ctx.players[battle.defender]?.color ?? "#FF3D7A";

    const attackDice = this.diceAnim.settled ? this.diceAnim.battle.attackRolls : this.diceAnim.attackShown;
    const defendDice = this.diceAnim.settled ? this.diceAnim.battle.defendRolls : this.diceAnim.defendShown;

    this.drawDiceRow(g, centerX - 140, y, attackDice, attackColor);
    g.font = "700 24px Bebas Neue, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#94a3b8";
    g.fillText("VS", centerX, y);
    this.drawDiceRow(g, centerX + 60, y, defendDice, defendColor);

    if (this.diceAnim.settled) {
      const aSum = this.diceAnim.battle.attackSum;
      const dSum = this.diceAnim.battle.defendSum;
      g.font = "700 18px Bebas Neue, sans-serif";
      g.fillStyle = attackColor;
      g.textAlign = "right";
      g.fillText(String(aSum), centerX - 20, y);
      g.fillStyle = defendColor;
      g.textAlign = "left";
      g.fillText(String(dSum), centerX + 20, y);
    }
    g.restore();
  }

  private drawDiceRow(g: CanvasRenderingContext2D, startX: number, cy: number, dice: number[], color: string): void {
    const size = 22;
    const gap = 4;
    const maxShow = Math.min(dice.length, 6);
    for (let i = 0; i < maxShow; i++) {
      const x = startX + i * (size + gap);
      g.fillStyle = color;
      roundRect(g, x - size / 2, cy - size / 2, size, size, 4);
      g.fill();
      g.font = "700 14px Bebas Neue, sans-serif";
      g.fillStyle = "#071018";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(dice[i] ?? 0), x, cy);
    }
    if (dice.length > maxShow) {
      g.font = "600 12px Outfit, sans-serif";
      g.fillStyle = "#94a3b8";
      g.textAlign = "left";
      g.fillText(`+${dice.length - maxShow}`, startX + maxShow * (size + gap), cy);
    }
  }

  private drawPassHint(g: CanvasRenderingContext2D): void {
    if (!hasAnyAttack(this.board, this.currentSeat)) {
      this.advanceTurn();
      return;
    }

    this.ctx.input.consumeClick();
    if (this.handlePassInput()) {
      this.advanceTurn();
      return;
    }

    g.font = "600 13px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#64748b";
    g.fillText("Click a tile to attack  ·  Space to end turn", GAME_WIDTH / 2, GAME_HEIGHT - 20);
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    for (const f of this.floaters) {
      const t = f.life / f.max;
      g.globalAlpha = Math.min(1, t * 2);
      g.fillStyle = f.color;
      g.font = `700 ${f.size}px Bebas Neue, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  isFinished(): boolean {
    return this.phase === "done" && this.time > 3;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((player, i) => ({
      playerId: player.id,
      score: tilesOwned(this.board, i),
    }));
  }

  destroy(): void {}
}

function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
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

function hexDimColor(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const gg = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${gg},${b},${alpha})`;
}

function speciesEmoji(species: Species): string {
  switch (species) {
    case "ants": return "\u{1F41C}";
    case "bees": return "\u{1F41D}";
    case "beetles": return "\u{1F41E}";
    case "spiders": return "\u{1F577}\u{FE0F}";
  }
}

function drawBugSprite(g: CanvasRenderingContext2D, cx: number, cy: number, species: Species, color: string, r: number, time: number, id: number): void {
  g.save();
  g.translate(cx, cy);

  const isBee = species === "bees";
  const isBeetle = species === "beetles";
  const isSpider = species === "spiders";

  const legCount = isSpider ? 4 : 3;
  g.strokeStyle = "rgba(18, 14, 10, 0.7)";
  g.lineWidth = Math.max(1, r * 0.14);
  g.lineCap = "round";
  const phase = time * (isBeetle ? 5 : 7) + id * 1.3;
  for (const side of [-1, 1]) {
    for (let i = 0; i < legCount; i++) {
      const lx = (-0.3 + i * (isSpider ? 0.3 : 0.38)) * r;
      const sway = Math.sin(phase + i) * 0.15 * side;
      g.beginPath();
      g.moveTo(lx, side * r * 0.2);
      g.quadraticCurveTo(lx + 0.2 * r, side * r * 0.8, lx + (0.15 + sway) * r * 1.4, side * r * (isSpider ? 1.2 : 1.0));
      g.stroke();
    }
  }

  if (isBee) {
    const wf = Math.sin(time * 28 + id) * 0.35;
    g.fillStyle = "rgba(225, 238, 255, 0.35)";
    for (const side of [-1, 1]) {
      g.save();
      g.translate(0, side * 0.28 * r);
      g.rotate(side * (0.5 + wf));
      g.beginPath();
      g.ellipse(-0.3 * r, 0, 0.5 * r, 0.2 * r, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  if (!isSpider) {
    g.strokeStyle = "rgba(18, 14, 10, 0.7)";
    g.lineWidth = Math.max(1, r * 0.12);
    const al = isBeetle ? 1.1 : 1.4;
    g.beginPath();
    g.moveTo(r * 0.8, -r * 0.15);
    g.lineTo(r * al, -r * 0.38);
    g.moveTo(r * 0.8, r * 0.15);
    g.lineTo(r * al, r * 0.38);
    g.stroke();
  }

  g.fillStyle = color;
  const abdX = isBeetle ? -0.5 : isSpider ? -0.55 : -0.65;

  if (isBeetle) {
    fillEllipse(g, abdX * r, 0, 0.85 * r, 0.6 * r);
    fillEllipse(g, 0.3 * r, 0, 0.35 * r, 0.38 * r);
    fillEllipse(g, 0.7 * r, 0, 0.3 * r, 0.28 * r);
    g.strokeStyle = "rgba(20, 14, 8, 0.5)";
    g.lineWidth = Math.max(1, r * 0.1);
    g.beginPath();
    g.moveTo(0.2 * r, 0);
    g.lineTo((abdX - 0.8) * r, 0);
    g.stroke();
  } else if (isSpider) {
    fillEllipse(g, abdX * r, 0, 0.75 * r, 0.58 * r);
    fillEllipse(g, 0.35 * r, 0, 0.42 * r, 0.38 * r);
  } else {
    fillEllipse(g, abdX * r, 0, 0.65 * r, 0.48 * r);
    fillEllipse(g, 0.04 * r, 0, 0.38 * r, 0.34 * r);
    fillEllipse(g, 0.65 * r, 0, 0.4 * r, 0.38 * r);
  }

  if (isBee) {
    g.save();
    g.beginPath();
    g.ellipse(abdX * r, 0, 0.65 * r, 0.48 * r, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "rgba(26, 18, 6, 0.8)";
    for (const dx of [-0.9, -0.6, -0.3]) {
      fillEllipse(g, dx * r, 0, 0.08 * r, 0.55 * r);
    }
    g.restore();
  }

  g.restore();
}

function fillEllipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  g.fill();
}

export const bugWars: MinigameDefinition = {
  id: "bug-wars",
  name: "Bug Wars",
  tagline: "Roll dice. Conquer the garden.",
  description:
    "A hex garden split between bug factions. On your turn, attack an adjacent enemy tile by rolling dice — more bugs means more dice, and strictly higher wins. Capture the whole garden or hold the most tiles when the rounds run out. End your turn early for reinforcements from your largest connected region.",
  durationMs: 0,
  controls: "Click a tile to select, click an enemy neighbour to attack. Space to end your turn.",
  create: (ctx) => new BugWarsGame(ctx),
};
