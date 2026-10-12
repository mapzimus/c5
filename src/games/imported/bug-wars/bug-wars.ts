import { fillArena } from "../../../core/draw";
import { Callouts, Juice, saveBest } from "../../../fx/juice";
import { GAME_HEIGHT, GAME_WIDTH, type GameContext, type GameDefinition, type GameInstance, type GameStat } from "../../../core/types";
import {
  MAX_BUGS,
  NO_OWNER,
  STOMP_SECONDS,
  SURGE_MAX,
  SURGE_MIN_BUGS,
  TURN_SECONDS,
  UNDERDOG_INCOME,
  type AttackChoice,
  type Battle,
  type Board,
  type Species,
  aliveSeats,
  apFor,
  applyBattle,
  applyMarch,
  attackChance,
  botPickAttack,
  botPickMarch,
  botPickStomp,
  botPickSurge,
  canAttack,
  canMarch,
  endTurnIncome,
  gameOver,
  generateBoard,
  hasAnyAction,
  isAlive,
  isFinalRound,
  marchTargets,
  revertTile,
  rollBattle,
  roundsFor,
  speciesFor,
  stompTile,
  targetsFrom,
  tilesOwned,
  underdogSeat,
} from "./rules";

/** Records are per ruleset: the surge rules changed what a capture count means. */
const BEST_VERSION = "v2-captures";

const HEX_R = 44;
const HEX_W = HEX_R * Math.sqrt(3);
const HEX_H = HEX_R * 2;

const DICE_ROLL = 0.26;
const DICE_SETTLE = 0.27;
const REINFORCE_PACE = 0.03;

const BTN_X = GAME_WIDTH / 2;
const BTN_Y = GAME_HEIGHT - 42;
const BTN_HW = 124;
const HINT_Y = GAME_HEIGHT - 100;
const DICE_Y = GAME_HEIGHT - 118;

/** Callouts sit in the empty band between the HUD and the top hex row. */
const CALL_Y = 0.165;
const SUB_Y = 0.235;
const SURGE_COLOR = "#FF8A2B";
const GHOST_COLOR = "#C7D2FE";
const WIN_TAUNTS = ["CHOMP!", "MINE!", "NOM NOM", "TOO EASY", "SNACK"] as const;
const LOSS_TAUNTS = ["OOPS", "UNLUCKY", "HMPH", "NEXT TIME"] as const;

type Phase = "intro" | "pick" | "target" | "surge" | "rolling" | "resolve" | "reinforce" | "bot" | "stomp" | "pause" | "done";

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

/** A swarm that just captured a tile and may press on. `level` = presses already made in this chain. */
interface Surge {
  from: number;
  prevOwner: number;
  level: number;
}

interface StompFx {
  x: number;
  y: number;
  life: number;
}

class BugWarsGame implements GameInstance {
  private board: Board;
  private readonly n: number;
  private readonly maxRounds: number;
  private readonly stash: number[];
  private readonly attacks: number[];
  private readonly captures: number[];
  private readonly bestSurge: number[];
  private readonly stomps: number[];
  private readonly eliminatedRound: number[];
  private readonly stomped: boolean[];
  private readonly tilePop: number[];
  private readonly newBest = new Set<number>();
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly floaters: Floater[] = [];
  private time = 0;
  private phase: Phase = "intro";
  private introTimer = 1.5;
  private doneTimer = 0;
  private currentSeat = 0;
  private round = 1;
  private selected = -1;
  private ap = 0;
  private turnClock = 0;
  private stompClock = 0;
  private underdog = -1;
  private surge: Surge | null = null;
  private diceAnim: DiceAnim | null = null;
  private reinforceAnim: ReinforceAnim | null = null;
  private stompFx: StompFx | null = null;
  private botDelay = 0;
  private botPlan: AttackChoice | null = null;
  private pauseTimer = 0;
  private pauseNext: (() => void) | null = null;
  private hint = "";
  private battleNote = "";
  private hexCenters: { x: number; y: number }[] = [];

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice();
    this.n = ctx.players.length;
    this.maxRounds = roundsFor(this.n);
    this.board = generateBoard(ctx.rng, this.n);
    this.stash = ctx.players.map(() => 0);
    this.attacks = ctx.players.map(() => 0);
    this.captures = ctx.players.map(() => 0);
    this.bestSurge = ctx.players.map(() => 0);
    this.stomps = ctx.players.map(() => 0);
    this.eliminatedRound = ctx.players.map(() => -1);
    this.stomped = ctx.players.map(() => false);
    this.tilePop = this.board.tiles.map(() => 0);
    this.computeHexLayout();
    this.callouts.show("BUG WARS", "#B8FF3D", { size: 72, life: 1.5, y: CALL_Y });
    this.callouts.show("3 ACTIONS A TURN · CAPTURE, THEN SURGE", "#F4F7FB", { size: 28, life: 1.5, y: SUB_Y });
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
    const offsetY = (GAME_HEIGHT - gridH) / 2 + HEX_R + 2;

    this.hexCenters = new Array(tileCount);
    for (const tile of this.board.tiles) {
      const x = offsetX + (tile.col - minCol) * HEX_W + (tile.row % 2 === 1 ? HEX_W * 0.5 : 0);
      const y = offsetY + (tile.row - minRow) * HEX_H * 0.75;
      this.hexCenters[tile.id] = { x, y };
    }
  }

  // ---------------------------------------------------------------- update

  update(realDt: number): void {
    const dt = this.juice.update(realDt);
    this.callouts.update(realDt);
    this.time += realDt;
    this.updateFloaters(dt);
    for (let i = 0; i < this.tilePop.length; i += 1) {
      const pop = this.tilePop[i]!;
      if (pop !== 0) this.tilePop[i] = Math.abs(pop) < 0.04 ? 0 : pop - Math.sign(pop) * dt * 3.2;
    }
    if (this.stompFx) {
      this.stompFx.life -= realDt;
      if (this.stompFx.life <= 0) this.stompFx = null;
    }

    switch (this.phase) {
      case "done":
        this.doneTimer += realDt;
        return;
      case "intro":
        this.introTimer -= dt;
        if (this.introTimer <= 0) {
          this.ctx.sfx.go();
          this.beginTurn(0);
        }
        return;
      case "pause":
        this.pauseTimer -= dt;
        if (this.pauseTimer <= 0) {
          const next = this.pauseNext;
          this.pauseNext = null;
          next?.();
        }
        return;
      case "rolling":
        this.updateDiceAnim(dt);
        return;
      case "resolve":
        this.resolveAfterBattle();
        return;
      case "reinforce":
        this.updateReinforce(dt);
        return;
      case "bot":
        this.updateBot(dt);
        return;
      case "stomp":
        this.updateStomp(dt);
        return;
      case "pick":
      case "target":
      case "surge":
        this.updateHuman(dt);
        return;
    }
  }

  private isHuman(seat: number): boolean {
    return this.ctx.players[seat]?.kind === "human";
  }

  private seatName(seat: number): string {
    return this.ctx.players[seat]?.name ?? "?";
  }

  private seatColor(seat: number): string {
    return this.ctx.players[seat]?.color ?? "#94a3b8";
  }

  private pause(seconds: number, next: () => void): void {
    this.phase = "pause";
    this.pauseTimer = seconds;
    this.pauseNext = next;
  }

  private inButton(x: number, y: number): boolean {
    const hh = this.buttonHalfHeight();
    return x >= BTN_X - BTN_HW && x <= BTN_X + BTN_HW && y >= BTN_Y - hh && y <= BTN_Y + hh;
  }

  private buttonHalfHeight(): number {
    return Math.max(30, this.ctx.minTap / 2 + 2);
  }

  private selectable(tileId: number): boolean {
    const tile = this.board.tiles[tileId];
    if (!tile || tile.owner !== this.currentSeat || tile.bugs < 2) return false;
    return targetsFrom(this.board, tileId).length > 0 || marchTargets(this.board, tileId).length > 0;
  }

  private updateHuman(dt: number): void {
    this.turnClock -= dt;
    if (this.turnClock <= 0) {
      if (this.phase === "surge") this.endSurge();
      else this.endTurn();
      return;
    }
    if (this.phase !== "surge" && (this.ap <= 0 || !hasAnyAction(this.board, this.currentSeat))) {
      if (this.ap > 0) this.callouts.show("NO MOVES · REINFORCING", "#94a3b8", { size: 34, life: 0.9, y: CALL_Y });
      this.endTurn();
      return;
    }

    const passKey = this.ctx.input.justPressed("Space") || this.ctx.input.justPressed("Enter");
    const click = this.ctx.input.consumeClick();
    if (passKey || (click && this.inButton(click.x, click.y))) {
      if (this.phase === "surge") this.endSurge();
      else this.endTurn();
      return;
    }
    if (!click) return;

    const tileId = this.hitTile(click.x, click.y);
    if (tileId === null) return;

    if (this.phase === "surge" && this.surge) {
      if (tileId === this.surge.from) {
        this.endSurge();
        return;
      }
      const bonus = this.surge.level + 1;
      if (canAttack(this.board, this.surge.from, tileId, this.currentSeat)) {
        this.launchAttack(this.surge.from, tileId, bonus);
      }
      return;
    }

    if (this.phase === "pick") {
      if (this.selectable(tileId)) {
        this.selected = tileId;
        this.phase = "target";
        this.hint = "Tap an enemy neighbour to attack, a friendly one to march";
        this.ctx.sfx.select();
      }
      return;
    }

    // target phase
    if (tileId === this.selected) {
      this.selected = -1;
      this.phase = "pick";
      this.hint = "Tap one of your stacks (2+ bugs)";
      return;
    }
    if (canAttack(this.board, this.selected, tileId, this.currentSeat)) {
      this.launchAttack(this.selected, tileId, 0);
      return;
    }
    if (canMarch(this.board, this.selected, tileId, this.currentSeat)) {
      this.doMarch(this.selected, tileId);
      return;
    }
    if (this.selectable(tileId)) {
      this.selected = tileId;
      this.ctx.sfx.select();
    }
  }

  private launchAttack(from: number, to: number, surgeLevel: number): void {
    const tiesWin = this.currentSeat === this.underdog;
    const battle = rollBattle(this.board, from, to, this.ctx.rng, { bonusDice: surgeLevel, tiesWin, surge: surgeLevel });
    this.diceAnim = {
      battle,
      timer: 0,
      settled: false,
      attackShown: battle.attackRolls.map(() => 0),
      defendShown: battle.defendRolls.map(() => 0),
    };
    this.battleNote = surgeLevel > 0 ? `SURGE +${surgeLevel} ${surgeLevel === 1 ? "DIE" : "DICE"}` : tiesWin ? "UNDERDOG: TIES WIN" : "";
    this.phase = "rolling";
    this.selected = -1;
    this.attacks[this.currentSeat] = (this.attacks[this.currentSeat] ?? 0) + 1;
    if (surgeLevel === 0) this.ap -= 1;
    this.ctx.sfx.whoosh();
  }

  private doMarch(from: number, to: number): void {
    const moved = applyMarch(this.board, from, to);
    this.ap -= 1;
    this.selected = -1;
    const a = this.hexCenters[from]!;
    const b = this.hexCenters[to]!;
    this.tilePop[to] = 0.8;
    this.juice.burst((a.x + b.x) / 2, (a.y + b.y) / 2, this.seatColor(this.currentSeat), { count: 10, speed: 160, gravity: 200, size: 3 });
    this.floaters.push({ text: `MARCH +${moved}`, x: b.x, y: b.y - 40, life: 0.9, max: 0.9, color: this.seatColor(this.currentSeat), size: 18 });
    this.ctx.sfx.whoosh();
    this.afterAction();
  }

  /** Back to choosing (or on to the next seat when the actions are spent). */
  private afterAction(): void {
    this.surge = null;
    this.selected = -1;
    this.underdog = underdogSeat(this.board, this.n);
    if (this.ap <= 0 || !hasAnyAction(this.board, this.currentSeat)) {
      this.pause(0.25, () => this.endTurn());
      return;
    }
    if (this.isHuman(this.currentSeat)) {
      this.phase = "pick";
      this.hint = "Tap one of your stacks (2+ bugs)";
    } else {
      this.phase = "bot";
      this.botPlan = null;
      this.botDelay = this.ctx.rng.float(0.1, 0.25);
    }
  }

  private endSurge(): void {
    if (this.surge) {
      const c = this.hexCenters[this.surge.from]!;
      this.floaters.push({ text: "DUG IN", x: c.x, y: c.y - 40, life: 0.8, max: 0.8, color: "#94a3b8", size: 16 });
    }
    this.ctx.sfx.tick();
    this.afterAction();
  }

  private updateDiceAnim(dt: number): void {
    if (!this.diceAnim) return;
    this.diceAnim.timer += dt;

    if (this.diceAnim.timer < DICE_ROLL) {
      for (let i = 0; i < this.diceAnim.attackShown.length; i++) this.diceAnim.attackShown[i] = this.ctx.rng.int(1, 6);
      for (let i = 0; i < this.diceAnim.defendShown.length; i++) this.diceAnim.defendShown[i] = this.ctx.rng.int(1, 6);
    } else if (!this.diceAnim.settled) {
      this.diceAnim.settled = true;
      this.diceAnim.attackShown = [...this.diceAnim.battle.attackRolls];
      this.diceAnim.defendShown = [...this.diceAnim.battle.defendRolls];
      const battle = this.diceAnim.battle;
      if (battle.captured) {
        this.ctx.sfx.hit();
        this.juice.shake(0.3 + 0.12 * battle.surge);
        this.juice.hitStop(battle.surge > 0 ? 0.1 : 0.06);
      } else {
        this.ctx.sfx.miss();
        this.juice.shake(battle.surge > 0 ? 0.45 : 0.15);
      }
    }

    if (this.diceAnim.timer > DICE_ROLL + DICE_SETTLE) this.phase = "resolve";
  }

  private resolveAfterBattle(): void {
    if (!this.diceAnim) return;
    const battle = this.diceAnim.battle;
    const seat = battle.attacker;
    const color = this.seatColor(seat);
    const center = this.hexCenters[battle.to]!;
    applyBattle(this.board, battle);

    if (battle.captured) {
      this.captures[seat] = (this.captures[seat] ?? 0) + 1;
      this.bestSurge[seat] = Math.max(this.bestSurge[seat] ?? 0, battle.surge);
      this.tilePop[battle.to] = 1;
      const label = battle.surge === 0 ? "CAPTURED!" : battle.surge === 1 ? "SURGE!" : battle.surge === 2 ? "SURGE x2!" : "RAMPAGE!";
      this.callouts.show(label, battle.surge > 0 ? SURGE_COLOR : color, { size: 50 + battle.surge * 8, life: 0.8, y: CALL_Y });
      this.juice.burst(center.x, center.y, battle.surge > 0 ? [color, SURGE_COLOR, "#FFD54A"] : color, { count: 18 + battle.surge * 10, speed: 280 + battle.surge * 60, gravity: 400 });
      if (battle.surge >= 2) this.ctx.sfx.streak(battle.surge + 1);
      const margin = battle.attackSum - battle.defendSum;
      this.floaters.push({ text: margin >= 10 ? "CRUSHED" : "CONQUERED", x: center.x, y: center.y - 34, life: 1, max: 1, color, size: 20 });
      if (!this.isHuman(seat) && this.ctx.rng.next() < 0.35) this.taunt(seat, this.ctx.rng.pick(WIN_TAUNTS), battle.from);
      if (battle.defender !== NO_OWNER && !isAlive(this.board, battle.defender)) this.eliminate(battle.defender);
    } else {
      const from = this.hexCenters[battle.from]!;
      if (battle.surge > 0 && this.surge) {
        // A wiped-out owner does not come back from the dead: the tile goes feral instead.
        const back = this.surge.prevOwner !== NO_OWNER && isAlive(this.board, this.surge.prevOwner) ? this.surge.prevOwner : NO_OWNER;
        revertTile(this.board, battle.from, back);
        this.tilePop[battle.from] = -1;
        this.callouts.show("ROUTED!", "#FF3D7A", { size: 56, life: 0.9, y: CALL_Y });
        this.floaters.push({ text: "TILE LOST", x: from.x, y: from.y - 34, life: 1.1, max: 1.1, color: "#FF3D7A", size: 20 });
        this.juice.burst(from.x, from.y, ["#FF3D7A", "#64748b"], { count: 22, speed: 240, gravity: 500 });
      }
      const gap = battle.defendSum - battle.attackSum;
      const nearMiss = gap <= 1;
      this.floaters.push({ text: nearMiss ? "SO CLOSE" : "DEFENDED", x: center.x, y: center.y - 34, life: 1, max: 1, color: nearMiss ? "#FFD54A" : this.seatColor(battle.defender), size: nearMiss ? 22 : 20 });
      if (!this.isHuman(seat) && this.ctx.rng.next() < 0.3) this.taunt(seat, this.ctx.rng.pick(LOSS_TAUNTS), battle.from);
    }

    this.diceAnim = null;
    this.battleNote = "";

    const end = gameOver(this.board, this.n, this.round, this.maxRounds);
    if (end) {
      this.finish(end);
      return;
    }

    if (battle.captured) {
      const tile = this.board.tiles[battle.to]!;
      const nextLevel = battle.surge + 1;
      if (nextLevel <= SURGE_MAX && tile.bugs >= SURGE_MIN_BUGS && targetsFrom(this.board, battle.to).length > 0) {
        this.surge = { from: battle.to, prevOwner: battle.defender, level: battle.surge };
        this.selected = battle.to;
        if (this.isHuman(seat)) {
          this.phase = "surge";
          this.hint = `SURGE: press on with +${nextLevel} ${nextLevel === 1 ? "die" : "dice"}, free · lose and this tile is lost`;
        } else {
          this.phase = "bot";
          this.botPlan = null;
          this.botDelay = this.ctx.rng.float(0.2, 0.35);
        }
        return;
      }
    }

    this.afterAction();
  }

  private taunt(seat: number, text: string, tileId: number): void {
    const c = this.hexCenters[tileId];
    if (!c) return;
    this.floaters.push({ text, x: c.x, y: c.y + 2, life: 1.1, max: 1.1, color: this.seatColor(seat), size: 17 });
  }

  private eliminate(seat: number): void {
    this.eliminatedRound[seat] = this.round;
    this.callouts.show(`${this.seatName(seat).toUpperCase()} WIPED OUT`, this.seatColor(seat), { size: 46, life: 1.3, y: CALL_Y });
    if (this.n > 2) this.callouts.show("BACK AS A GHOST WITH A BOOT", GHOST_COLOR, { size: 26, life: 1.3, y: SUB_Y });
    this.ctx.sfx.miss();
  }

  private endTurn(): void {
    this.surge = null;
    this.selected = -1;
    const seat = this.currentSeat;
    const bonus = seat === this.underdog ? UNDERDOG_INCOME : 0;
    const income = endTurnIncome(this.board, seat, this.stash[seat]!, this.ctx.rng, bonus);
    this.stash[seat] = income.stash;
    const chip = this.chipCenter(seat);
    if (income.income > 0) this.floaters.push({ text: `+${income.income}`, x: chip.x, y: chip.y + 26, life: 1.1, max: 1.1, color: this.seatColor(seat), size: 22 });
    if (bonus > 0) this.floaters.push({ text: `UNDERDOG +${bonus}`, x: chip.x, y: chip.y + 46, life: 1.2, max: 1.2, color: "#FFD54A", size: 14 });

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
    while (this.reinforceAnim.index < this.reinforceAnim.tiles.length && this.reinforceAnim.timer >= REINFORCE_PACE) {
      this.reinforceAnim.timer -= REINFORCE_PACE;
      const id = this.reinforceAnim.tiles[this.reinforceAnim.index]!;
      this.reinforceAnim.index++;
      this.tilePop[id] = Math.max(this.tilePop[id] ?? 0, 0.5);
      const c = this.hexCenters[id]!;
      this.juice.burst(c.x, c.y - 10, this.seatColor(this.currentSeat), { count: 3, speed: 90, gravity: 300, size: 3, life: 0.4 });
      this.ctx.sfx.tick();
    }
    if (this.reinforceAnim.index >= this.reinforceAnim.tiles.length) {
      this.reinforceAnim = null;
      this.goToNextSeat();
    }
  }

  private goToNextSeat(): void {
    if (aliveSeats(this.board, this.n).length <= 1) {
      this.finish("conquered");
      return;
    }
    const seat = (this.currentSeat + 1) % this.n;
    if (seat <= this.currentSeat) {
      this.round += 1;
      this.stomped.fill(false);
      if (this.round > this.maxRounds) {
        this.finish("rounds");
        return;
      }
      if (isFinalRound(this.round, this.maxRounds)) {
        this.callouts.show("FINAL ROUND", "#FFB020", { size: 64, life: 1.6, y: CALL_Y });
        this.callouts.show("4 ACTIONS · GO WILD", "#F4F7FB", { size: 28, life: 1.6, y: SUB_Y });
        this.ctx.sfx.streak(4);
      } else {
        this.callouts.show(`ROUND ${this.round}`, "#94a3b8", { size: 36, life: 0.7, y: CALL_Y });
      }
    }
    this.beginTurn(seat);
  }

  private beginTurn(seat: number): void {
    this.currentSeat = seat;
    this.selected = -1;
    this.surge = null;
    this.underdog = underdogSeat(this.board, this.n);

    if (!isAlive(this.board, seat)) {
      if (!this.stomped[seat]) {
        this.phase = "stomp";
        this.stompClock = STOMP_SECONDS;
        this.botDelay = this.ctx.rng.float(0.7, 1.1);
        this.callouts.show(`${this.seatName(seat).toUpperCase()} HAUNTS THE GARDEN`, GHOST_COLOR, { size: 40, life: 1, y: CALL_Y });
        this.hint = this.isHuman(seat) ? "GHOST STOMP: tap any stack to squash half of it" : "";
        this.ctx.sfx.countdown();
        return;
      }
      this.goToNextSeat();
      return;
    }

    this.ap = apFor(this.round, this.maxRounds);
    this.turnClock = TURN_SECONDS;
    if (this.isHuman(seat)) {
      this.phase = "pick";
      this.hint = "Tap one of your stacks (2+ bugs)";
      this.callouts.show(`${this.seatName(seat)}'s turn`, this.seatColor(seat), { size: 46, life: 0.7, y: CALL_Y });
      if (seat === this.underdog) this.callouts.show("UNDERDOG: TIES WIN, +2 INCOME", "#FFD54A", { size: 24, life: 1, y: SUB_Y });
    } else {
      this.phase = "bot";
      this.hint = "";
      this.botPlan = null;
      this.botDelay = this.ctx.rng.float(0.3, 0.5);
    }
  }

  private updateBot(dt: number): void {
    this.botDelay -= dt;
    if (this.botDelay > 0) return;
    const seat = this.currentSeat;
    const tiesWin = seat === this.underdog;
    const final = isFinalRound(this.round, this.maxRounds);

    if (this.surge) {
      const bonus = this.surge.level + 1;
      // Bots get more cautious the deeper the chain goes: a rout costs the whole tile.
      // Bigger tables keep bot chains a little shorter so nobody waits long for their turn.
      const threshold = 0.64 + 0.06 * this.surge.level + (this.n >= 4 ? 0.06 : 0) - (final ? 0.08 : 0) - (tiesWin ? 0.04 : 0) - this.ctx.rng.float(0, 0.06);
      const pick = botPickSurge(this.board, this.surge.from, bonus, tiesWin, threshold);
      if (pick) this.launchAttack(this.surge.from, pick.to, bonus);
      else this.endSurge();
      return;
    }

    if (this.ap <= 0 || !hasAnyAction(this.board, seat)) {
      this.endTurn();
      return;
    }

    if (this.botPlan) {
      const plan = this.botPlan;
      this.botPlan = null;
      if (canAttack(this.board, plan.from, plan.to, seat)) {
        this.launchAttack(plan.from, plan.to, 0);
        return;
      }
    }

    const choice = botPickAttack(this.board, seat, this.ctx.rng, { mistakeChance: 0.12, tiesWin, minChance: final ? 0.5 : 0.55 });
    if (choice) {
      // Show the pick for a beat so the table can follow what the bot is doing.
      this.botPlan = choice;
      this.selected = choice.from;
      this.botDelay = 0.18;
      this.ctx.sfx.select();
      return;
    }

    const march = botPickMarch(this.board, seat);
    if (march && this.ctx.rng.next() < 0.7) {
      this.doMarch(march.from, march.to);
      return;
    }
    this.endTurn();
  }

  private updateStomp(dt: number): void {
    const seat = this.currentSeat;
    if (this.isHuman(seat)) {
      this.stompClock -= dt;
      const click = this.ctx.input.consumeClick();
      if (click) {
        const tileId = this.hitTile(click.x, click.y);
        if (tileId !== null && this.board.tiles[tileId]!.bugs >= 2) {
          this.doStomp(tileId);
          return;
        }
      }
      if (this.stompClock <= 0) this.doStomp(botPickStomp(this.board, this.n, this.ctx.rng));
      return;
    }
    this.botDelay -= dt;
    if (this.botDelay <= 0) this.doStomp(botPickStomp(this.board, this.n, this.ctx.rng));
  }

  private doStomp(tileId: number | null): void {
    const seat = this.currentSeat;
    this.stomped[seat] = true;
    this.hint = "";
    if (tileId === null) {
      this.goToNextSeat();
      return;
    }
    const victim = this.board.tiles[tileId]!.owner;
    const lost = stompTile(this.board, tileId);
    this.stomps[seat] = (this.stomps[seat] ?? 0) + 1;
    const c = this.hexCenters[tileId]!;
    this.stompFx = { x: c.x, y: c.y, life: 0.55 };
    this.tilePop[tileId] = -1;
    this.juice.hitStop(0.12);
    this.juice.shake(0.8);
    this.juice.burst(c.x, c.y + 10, ["#a8a29e", "#78716c", this.seatColor(victim)], { count: 28, speed: 260, gravity: 600, size: 5 });
    this.callouts.show("STOMP!", GHOST_COLOR, { size: 60, life: 0.8, y: CALL_Y });
    this.floaters.push({ text: `-${lost}`, x: c.x, y: c.y - 34, life: 1.1, max: 1.1, color: "#FF3D7A", size: 26 });
    this.ctx.sfx.hit();
    this.pause(0.7, () => this.goToNextSeat());
  }

  private finish(reason: "conquered" | "rounds"): void {
    this.phase = "done";
    this.doneTimer = 0;
    this.surge = null;
    this.selected = -1;
    this.hint = "";
    const scores = this.ctx.players.map((_, i) => tilesOwned(this.board, i));
    const top = Math.max(...scores);
    const winners = scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
    const headline = reason === "conquered" ? "TOTAL CONQUEST" : "GARDEN CLAIMED";
    this.callouts.show(headline, "#FFB020", { size: 64, life: 2.4 });
    if (winners.length === 1) {
      const w = winners[0]!;
      this.callouts.show(`${this.seatName(w).toUpperCase()} HOLDS ${top} TILES`, this.seatColor(w), { size: 30, life: 2.4, y: 0.42 });
    } else {
      this.callouts.show("SHARED GARDEN", "#F4F7FB", { size: 30, life: 2.4, y: 0.42 });
    }
    for (let i = 0; i < this.n; i += 1) {
      if (!this.isHuman(i)) continue;
      const caps = this.captures[i] ?? 0;
      if (caps > 0 && saveBest(bugWars.id, caps, BEST_VERSION)) {
        this.newBest.add(i);
        this.callouts.show(`NEW RECORD ${this.seatName(i).toUpperCase()}: ${caps} CAPTURES`, "#B8FF3D", { size: 28, life: 2.6, y: 0.5 });
      }
    }
    this.ctx.sfx.win();
  }

  private hitTile(x: number, y: number): number | null {
    let best = -1;
    let bestDist = HEX_R * 1.05;
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

  // ---------------------------------------------------------------- render

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    this.drawHUD(g);
    this.juice.begin(g);
    this.drawBoard(g);
    this.drawStompFx(g);
    this.juice.end(g);
    this.drawBottomBar(g);
    this.drawDiceOverlay(g);
    this.drawFloaters(g);
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
  }

  private chipCenter(seat: number): { x: number; y: number } {
    const chipW = 150;
    const gap = 8;
    const total = this.n * chipW + (this.n - 1) * gap;
    const x0 = GAME_WIDTH - 36 - total;
    return { x: x0 + seat * (chipW + gap) + chipW / 2, y: 36 };
  }

  private drawHUD(g: CanvasRenderingContext2D): void {
    const final = isFinalRound(this.round, this.maxRounds) && this.phase !== "done";
    g.font = "600 15px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#94a3b8";
    g.fillText(`Bug Wars  ·  Round ${Math.min(this.round, this.maxRounds)}/${this.maxRounds}`, 40, 28);
    if (final) {
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 6);
      g.font = "700 22px Bebas Neue, sans-serif";
      g.fillStyle = `rgba(255, 176, 32, ${pulse})`;
      g.fillText("FINAL ROUND · FRENZY", 40, 54);
    }

    const chipW = 150;
    const chipH = 36;
    const gap = 8;
    const total = this.n * chipW + (this.n - 1) * gap;
    let x = GAME_WIDTH - 36 - total;
    for (let i = 0; i < this.n; i++) {
      const player = this.ctx.players[i]!;
      const alive = isAlive(this.board, i);
      const active = i === this.currentSeat && this.phase !== "done" && this.phase !== "intro";
      const tiles = tilesOwned(this.board, i);

      g.save();
      if (!alive) g.globalAlpha = 0.6;
      g.beginPath();
      roundRect(g, x, 18, chipW, chipH, 16);
      g.fillStyle = active ? player.color : "rgba(15, 23, 42, 0.82)";
      g.fill();
      if (!active) {
        g.strokeStyle = player.color;
        g.lineWidth = 1.5;
        g.stroke();
      }

      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillStyle = active ? "#071018" : player.color;
      const emoji = speciesEmoji(speciesFor(player.slot));
      g.fillText(`${emoji} ${player.name}`, x + 10, 41);

      g.textAlign = "right";
      g.font = "700 20px Bebas Neue, sans-serif";
      g.fillText(alive ? String(tiles) : "GHOST", x + chipW - 10, 42);
      g.restore();

      let tag = "";
      let tagColor = "#94a3b8";
      if (!alive) {
        tag = this.stomped[i] ? "boot used" : "boot ready";
        tagColor = GHOST_COLOR;
      } else if (i === this.underdog) {
        tag = "UNDERDOG · ties win";
        tagColor = "#FFD54A";
      } else if ((this.stash[i] ?? 0) > 0) {
        tag = `nest +${this.stash[i]}`;
      }
      if (tag) {
        g.font = "600 11px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillStyle = tagColor;
        g.fillText(tag, x + chipW / 2, 68);
      }
      x += chipW + gap;
    }
    g.textAlign = "left";
  }

  private drawBoard(g: CanvasRenderingContext2D): void {
    const hover = this.ctx.input.hover;
    const hoverId = hover ? this.hitTile(hover.x, hover.y) : null;
    const human = this.isHuman(this.currentSeat);
    const surgeOn = this.phase === "surge" && this.surge !== null;
    const targeting = (this.phase === "target" || surgeOn) && this.selected >= 0;
    const bonus = surgeOn && this.surge ? this.surge.level + 1 : 0;
    const tiesWin = this.currentSeat === this.underdog;
    const stomping = this.phase === "stomp" && human;

    for (let i = 0; i < this.board.tiles.length; i++) {
      const tile = this.board.tiles[i]!;
      const center = this.hexCenters[i]!;
      const isSelected = tile.id === this.selected;
      const isTarget = targeting && canAttack(this.board, this.selected, tile.id, this.currentSeat);
      const isMarch = this.phase === "target" && canMarch(this.board, this.selected, tile.id, this.currentSeat);
      const isHovered = hoverId === i;
      const attackable = this.phase === "pick" && human && this.selectable(tile.id);
      const stompable = stomping && tile.bugs >= 2;
      const chance = isTarget ? attackChance(this.board, this.selected, tile.id, { bonusDice: bonus, tiesWin }) : -1;
      this.drawHex(g, center.x, center.y, tile, { isSelected, isTarget, isMarch, isHovered, attackable, stompable, surge: surgeOn, chance });
    }
  }

  private drawHex(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tile: { owner: number; bugs: number; id: number },
    flags: { isSelected: boolean; isTarget: boolean; isMarch: boolean; isHovered: boolean; attackable: boolean; stompable: boolean; surge: boolean; chance: number },
  ): void {
    const player = tile.owner !== NO_OWNER ? this.ctx.players[tile.owner] : null;
    const baseColor = player?.color ?? "#334155";
    const species = tile.owner !== NO_OWNER ? speciesFor(this.ctx.players[tile.owner]?.slot ?? 0) : "ants";
    const pop = this.tilePop[tile.id] ?? 0;

    g.save();

    hexPath(g, cx, cy, HEX_R - 2);
    if (tile.owner !== NO_OWNER) {
      g.fillStyle = hexDimColor(baseColor, flags.isSelected ? 0.55 : 0.35);
      g.fill();
    } else {
      g.fillStyle = "rgba(30, 41, 59, 0.5)";
      g.fill();
    }

    const pulse = 0.5 + 0.5 * Math.sin(this.time * 8);
    if (flags.isSelected) {
      const glow = flags.surge ? SURGE_COLOR : "#FFD54A";
      g.strokeStyle = hexDimColor(glow, 0.35);
      g.lineWidth = 10;
      g.stroke();
      g.strokeStyle = glow;
      g.lineWidth = 3.5;
      g.stroke();
    } else if (flags.isTarget) {
      g.strokeStyle = flags.surge ? `rgba(255, 138, 43, ${0.6 + 0.4 * pulse})` : `rgba(255, 61, 122, ${0.5 + 0.5 * pulse})`;
      g.lineWidth = 3;
      g.stroke();
    } else if (flags.isMarch) {
      g.setLineDash([6, 5]);
      g.strokeStyle = `rgba(184, 255, 61, ${0.5 + 0.4 * pulse})`;
      g.lineWidth = 2.5;
      g.stroke();
      g.setLineDash([]);
    } else if (flags.stompable) {
      g.strokeStyle = flags.isHovered ? GHOST_COLOR : `rgba(199, 210, 254, ${0.25 + 0.3 * pulse})`;
      g.lineWidth = flags.isHovered ? 3 : 1.5;
      g.stroke();
    } else if (flags.attackable) {
      g.strokeStyle = flags.isHovered ? baseColor : hexDimColor(baseColor, 0.7);
      g.lineWidth = flags.isHovered ? 3 : 2;
      g.stroke();
    } else {
      g.strokeStyle = "rgba(148, 163, 184, 0.2)";
      g.lineWidth = 1;
      g.stroke();
    }

    if (tile.owner !== NO_OWNER) {
      g.save();
      g.translate(cx, cy - 4);
      if (pop > 0) g.scale(1 + 0.35 * pop, 1 + 0.35 * pop);
      else if (pop < 0) g.scale(1 + 0.3 * -pop, 1 - 0.5 * -pop);
      drawBugSprite(g, 0, 0, species, baseColor, HEX_R * 0.42, this.time, tile.id);
      g.restore();

      g.font = "700 17px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 3;
      g.strokeStyle = "rgba(7,11,20,0.75)";
      g.strokeText(String(tile.bugs), cx, cy + HEX_R * 0.52);
      g.fillStyle = "#F4F7FB";
      g.fillText(String(tile.bugs), cx, cy + HEX_R * 0.52);

      if (tile.bugs >= MAX_BUGS) {
        g.font = "600 9px Outfit, sans-serif";
        g.fillStyle = "#FFB020";
        g.fillText("MAX", cx, cy + HEX_R * 0.78);
      }
    } else {
      g.font = "700 17px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#94a3b8";
      g.fillText(String(tile.bugs), cx, cy + HEX_R * 0.52);
      g.font = "600 9px Outfit, sans-serif";
      g.fillText("FERAL", cx, cy - 8);
    }

    if (flags.chance >= 0) {
      const pct = Math.round(flags.chance * 100);
      const label = `${pct}%`;
      g.font = "700 15px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const w = g.measureText(label).width + 14;
      const y = cy - HEX_R + 4;
      roundRect(g, cx - w / 2, y - 10, w, 20, 10);
      g.fillStyle = pct >= 65 ? "#B8FF3D" : pct >= 45 ? "#FFD54A" : "#FF3D7A";
      g.fill();
      g.fillStyle = "#071018";
      g.fillText(label, cx, y + 1);
    }

    g.restore();
  }

  private drawStompFx(g: CanvasRenderingContext2D): void {
    const fx = this.stompFx;
    if (!fx) return;
    const t = 1 - fx.life / 0.55;
    const drop = Math.max(0, 1 - t * 4);
    const scale = 1 + drop * 1.6;
    g.save();
    g.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
    g.translate(fx.x, fx.y - drop * 120);
    g.scale(scale, scale);
    drawBoot(g, GHOST_COLOR);
    g.restore();
  }

  private drawBottomBar(g: CanvasRenderingContext2D): void {
    if (this.phase === "intro" || this.phase === "done") return;
    const seat = this.currentSeat;
    const color = this.seatColor(seat);
    const alive = isAlive(this.board, seat);
    const human = this.isHuman(seat);

    if (alive) {
      // Action pips for whoever is up, humans and bots alike.
      const total = apFor(this.round, this.maxRounds);
      const px = BTN_X - BTN_HW - 40 - total * 24;
      g.font = "600 12px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = "#94a3b8";
      g.fillText(`${this.seatName(seat).toUpperCase()} · ACTIONS`, px, BTN_Y - 18);
      for (let i = 0; i < total; i += 1) {
        g.beginPath();
        g.arc(px + 10 + i * 24, BTN_Y + 8, 9, 0, Math.PI * 2);
        if (i < this.ap) {
          g.fillStyle = color;
          g.fill();
        } else {
          g.strokeStyle = hexDimColor(color, 0.5);
          g.lineWidth = 2;
          g.stroke();
        }
      }
    }

    const choosing = human && (this.phase === "pick" || this.phase === "target" || this.phase === "surge");
    if (choosing) {
      const hh = this.buttonHalfHeight();
      const hover = this.ctx.input.hover;
      const hovered = !!hover && this.inButton(hover.x, hover.y);
      const surge = this.phase === "surge";
      g.beginPath();
      roundRect(g, BTN_X - BTN_HW, BTN_Y - hh, BTN_HW * 2, hh * 2, 14);
      g.fillStyle = surge ? (hovered ? "rgba(255,138,43,0.35)" : "rgba(255,138,43,0.18)") : hovered ? "rgba(100,116,139,0.4)" : "rgba(100,116,139,0.18)";
      g.fill();
      g.strokeStyle = surge ? SURGE_COLOR : "#94a3b8";
      g.lineWidth = 1.5;
      g.stroke();

      g.font = "700 24px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = surge ? "#FFE1C2" : hovered ? "#F4F7FB" : "#cbd5e1";
      g.fillText(surge ? "HOLD · DIG IN" : "END TURN", BTN_X, BTN_Y - 4);
      g.font = "500 11px Outfit, sans-serif";
      g.fillStyle = "#94a3b8";
      g.fillText("Space / Enter", BTN_X, BTN_Y + 14);

      // Turn clock along the bottom edge of the button.
      const t = Math.max(0, this.turnClock / TURN_SECONDS);
      g.fillStyle = t < 0.25 ? "#FF3D7A" : color;
      roundRect(g, BTN_X - BTN_HW + 10, BTN_Y + hh - 7, (BTN_HW * 2 - 20) * t, 4, 2);
      g.fill();
      if (t < 0.34) {
        g.font = "700 16px Bebas Neue, sans-serif";
        g.fillStyle = "#FF3D7A";
        g.textAlign = "left";
        g.fillText(`${Math.ceil(this.turnClock)}s`, BTN_X + BTN_HW + 12, BTN_Y);
      }
    }

    if (this.phase === "stomp" && human) {
      const t = Math.max(0, this.stompClock / STOMP_SECONDS);
      g.font = "700 22px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = GHOST_COLOR;
      g.fillText("GHOST STOMP · TAP A STACK", BTN_X, BTN_Y - 10);
      g.fillStyle = "rgba(7,11,20,0.6)";
      roundRect(g, BTN_X - 120, BTN_Y + 8, 240, 6, 3);
      g.fill();
      g.fillStyle = t < 0.3 ? "#FF3D7A" : GHOST_COLOR;
      roundRect(g, BTN_X - 120, BTN_Y + 8, 240 * t, 6, 3);
      g.fill();
      const hover = this.ctx.input.hover;
      if (hover) {
        g.save();
        g.globalAlpha = 0.85;
        g.translate(hover.x, hover.y - 20);
        g.scale(0.7, 0.7);
        drawBoot(g, GHOST_COLOR);
        g.restore();
      }
    }

    // Hint line above the controls (hidden while dice are on screen).
    if (!this.diceAnim && this.hint && (choosing || (this.phase === "stomp" && human))) {
      g.font = "500 15px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = this.phase === "surge" ? "#FFE1C2" : "#cbd5e1";
      g.fillText(this.hint, GAME_WIDTH / 2, HINT_Y);
    }
  }

  private drawDiceOverlay(g: CanvasRenderingContext2D): void {
    if (!this.diceAnim) return;
    const battle = this.diceAnim.battle;
    const centerX = GAME_WIDTH / 2;
    const y = DICE_Y;
    const half = 330;

    g.save();
    g.fillStyle = "rgba(7, 11, 20, 0.82)";
    roundRect(g, centerX - half, y - 42, half * 2, 80, 12);
    g.fill();
    if (battle.surge > 0) {
      g.strokeStyle = SURGE_COLOR;
      g.lineWidth = 1.5;
      g.stroke();
    }

    const attackColor = this.seatColor(battle.attacker);
    const defendColor = battle.defender === NO_OWNER ? "#64748b" : this.seatColor(battle.defender);
    const attackDice = this.diceAnim.settled ? battle.attackRolls : this.diceAnim.attackShown;
    const defendDice = this.diceAnim.settled ? battle.defendRolls : this.diceAnim.defendShown;

    // Attack dice grow leftwards from the VS, defend dice rightwards; sums sit on the outside.
    const attackLeft = this.drawDiceRow(g, centerX - 44, y, attackDice, attackColor, battle.bonusDice, -1);
    const defendRight = this.drawDiceRow(g, centerX + 44, y, defendDice, defendColor, 0, 1);
    g.font = "700 24px Bebas Neue, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#94a3b8";
    g.fillText("VS", centerX, y);

    if (this.battleNote) {
      g.font = "700 14px Bebas Neue, sans-serif";
      g.fillStyle = battle.surge > 0 ? SURGE_COLOR : "#FFD54A";
      g.textAlign = "center";
      g.fillText(this.battleNote, centerX, y - 28);
    }

    if (this.diceAnim.settled) {
      g.font = "700 26px Bebas Neue, sans-serif";
      g.fillStyle = attackColor;
      g.textAlign = "right";
      g.fillText(String(battle.attackSum), attackLeft - 12, y);
      g.fillStyle = defendColor;
      g.textAlign = "left";
      g.fillText(String(battle.defendSum), defendRight + 12, y);
      g.font = "700 16px Bebas Neue, sans-serif";
      g.textAlign = "center";
      g.fillStyle = battle.captured ? attackColor : defendColor;
      g.fillText(battle.captured ? "ATTACKER WINS" : battle.attackSum === battle.defendSum ? "TIE · DEFENDER HOLDS" : "DEFENDER HOLDS", centerX, y + 26);
    }
    g.restore();
  }

  /** Draws a dice row from `edgeX` outward in `dir` (-1 left, +1 right). Returns the far edge x. */
  private drawDiceRow(g: CanvasRenderingContext2D, edgeX: number, cy: number, dice: number[], color: string, bonus: number, dir: -1 | 1): number {
    const size = 22;
    const step = size + 4;
    const maxShow = Math.min(dice.length, 9);
    const firstBonus = dice.length - bonus;
    for (let i = 0; i < maxShow; i++) {
      const x = edgeX + dir * (size / 2 + i * step);
      const isBonus = i >= firstBonus;
      g.fillStyle = isBonus ? "#FFD54A" : color;
      roundRect(g, x - size / 2, cy - size / 2, size, size, 4);
      g.fill();
      g.font = "700 14px Bebas Neue, sans-serif";
      g.fillStyle = "#071018";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(dice[i] ?? 0), x, cy);
    }
    let far = edgeX + dir * maxShow * step;
    if (dice.length > maxShow) {
      g.font = "600 12px Outfit, sans-serif";
      g.fillStyle = "#94a3b8";
      g.textAlign = dir < 0 ? "right" : "left";
      g.fillText(`+${dice.length - maxShow}`, far, cy);
      far += dir * 22;
    }
    return far;
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    for (const f of this.floaters) {
      const t = f.life / f.max;
      g.globalAlpha = Math.min(1, t * 2);
      g.fillStyle = f.color;
      g.font = `700 ${f.size}px Bebas Neue, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.7)";
      g.strokeText(f.text, f.x, f.y);
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  isFinished(): boolean {
    return this.phase === "done" && this.doneTimer > 2.4;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((player, i) => ({
      playerId: player.id,
      score: tilesOwned(this.board, i),
    }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (let i = 0; i < this.n; i++) {
      const id = this.ctx.players[i]!.id;
      const atk = this.attacks[i] ?? 0;
      const cap = this.captures[i] ?? 0;
      const surge = this.bestSurge[i] ?? 0;
      const stomps = this.stomps[i] ?? 0;
      if (atk > 0) stats.push({ playerId: id, label: "Attacks", value: String(atk) });
      if (cap > 0) stats.push({ playerId: id, label: "Captured", value: this.newBest.has(i) ? `${cap} (record)` : String(cap) });
      if (surge > 0) stats.push({ playerId: id, label: "Best surge", value: `x${surge}` });
      if (stomps > 0) stats.push({ playerId: id, label: "Ghost stomps", value: String(stomps) });
    }
    return stats;
  }

  destroy(): void {}
}

/** A chunky gardener's boot, sole down, centred on the origin. */
function drawBoot(g: CanvasRenderingContext2D, color: string): void {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = "rgba(7,11,20,0.8)";
  g.lineWidth = 2;
  g.beginPath();
  roundRect(g, -14, -46, 26, 40, 6);
  g.fill();
  g.stroke();
  g.beginPath();
  roundRect(g, -16, -14, 46, 18, 7);
  g.fill();
  g.stroke();
  g.fillStyle = "rgba(7,11,20,0.55)";
  g.beginPath();
  roundRect(g, -16, -2, 46, 6, 3);
  g.fill();
  g.restore();
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
  g.beginPath();
  for (const side of [-1, 1]) {
    for (let i = 0; i < legCount; i++) {
      const lx = (-0.3 + i * (isSpider ? 0.3 : 0.38)) * r;
      const sway = Math.sin(phase + i) * 0.15 * side;
      g.moveTo(lx, side * r * 0.2);
      g.quadraticCurveTo(lx + 0.2 * r, side * r * 0.8, lx + (0.15 + sway) * r * 1.4, side * r * (isSpider ? 1.2 : 1.0));
    }
  }
  g.stroke();

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
    g.fillStyle = "rgba(26, 18, 6, 0.8)";
    for (const dx of [-0.9, -0.6, -0.3]) {
      fillEllipse(g, dx * r, 0, 0.07 * r, 0.36 * r);
    }
  }

  g.restore();
}

function fillEllipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  g.fill();
}

export const bugWars: GameDefinition = {
  id: "bug-wars",
  name: "Bug Wars",
  tagline: "Three actions. Capture, then surge.",
  description:
    "A hex garden split between bug factions. Every seat gets three actions a turn: attack a neighbouring enemy with dice (more bugs, more dice) or march a stack to the front. Capture a tile and the swarm may SURGE on for free with bonus dice, but a lost surge hands the tile straight back. The underdog wins ties, wiped-out players return as ghosts with a boot, and the final round is a four-action frenzy. Most tiles when the rounds run out wins.",
  durationMs: 0,
  controls: "Tap a stack, then an enemy to attack or a friendly neighbour to march. Tap END TURN (or Space) to bank reinforcements.",
  create: (ctx) => new BugWarsGame(ctx),
};
