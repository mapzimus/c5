import { fillArena } from "../../../core/draw";
import { Callouts, Juice } from "../../../fx/juice";
import { GAME_HEIGHT, GAME_WIDTH, type GameContext, type GameDefinition, type GameInstance, type GameStat } from "../../../core/types";
import {
  MAX_BUGS,
  maxRounds,
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
  isAlive,
  nextSeat,
  playbackSpeed,
  rollBattle,
  speciesFor,
  targetsFrom,
  tilesOwned,
  winChance,
} from "./rules";
import {
  CHAOS_INFO,
  ITEM_INFO,
  type ChaosKind,
  type ChaosPlan,
  type ChaosResult,
  type Persona,
  addStash,
  applyChaos,
  attackBonuses,
  bark,
  battleHeadline,
  isFinalRound,
  leaderSeat,
  personaFor,
  personaOptions,
  pickChaos,
  planChaos,
  spawnItems,
  triggerItem,
  underdogBonus,
} from "./chaos";

const PASS_BTN = { x: GAME_WIDTH / 2, y: GAME_HEIGHT - 34, hw: 130, hh: 28 };

const HEX_R = 46;
const HEX_W = HEX_R * Math.sqrt(3);
const HEX_H = HEX_R * 2;
/** Seconds a human gets per turn before the garden moves on without them. */
const TURN_SECONDS = 30;
const CHAOS_WARN = 1.2;
const CHAOS_TOTAL = 2.3;
const ROLL_ATTACK = 0.55;
const ROLL_DEFEND = 0.85;
const ROLL_END = 1.5;
/** Pause before a bot's first attack, and between its attacks (scaled by playback speed). */
const BOT_START_DELAY = 0.5;
/** Chaos events normally play at full length (everyone should see the shoe); a tap speeds them up. */
const SKIP_CHAOS_SPEED = 3;
const BOT_NEXT_DELAY = 0.35;

type Phase = "intro" | "chaos" | "pick" | "target" | "rolling" | "reinforce" | "bot" | "done";

interface DiceAnim {
  battle: Battle;
  timer: number;
  /** Playback speed: bot-vs-bot fights roll faster so humans aren't kept waiting. */
  speed: number;
  attackSettled: boolean;
  defendSettled: boolean;
  attackShown: number[];
  defendShown: number[];
  labels: string[];
  headline: string | null;
  attackBugs: number;
  defendBugs: number;
}

interface ReinforceAnim {
  tiles: number[];
  timer: number;
  index: number;
}

interface ChaosAnim {
  plan: ChaosPlan;
  timer: number;
  result: ChaosResult | null;
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

interface Bubble {
  tile: number;
  text: string;
  color: string;
  life: number;
  max: number;
}

interface Swarm {
  from: { x: number; y: number };
  to: { x: number; y: number };
  t: number;
  dur: number;
  color: string;
  count: number;
  seed: number;
}

class BugWarsGame implements GameInstance {
  private board: Board;
  private readonly n: number;
  private readonly stash: number[];
  private readonly pepper: number[];
  /** grudge[seat] = the seat that last captured one of seat's tiles. */
  private readonly grudge: number[];
  private readonly personas: Persona[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly floaters: Floater[] = [];
  private readonly bubbles: Bubble[] = [];
  private readonly swarms: Swarm[] = [];
  private readonly pulse: number[];
  private readonly pending: number[];
  private time = 0;
  private phase: Phase = "intro";
  private introTimer = 2.2;
  private doneTimer = 0;
  private currentSeat = 0;
  private readonly lastRound: number;
  private round = 1;
  private selected = -1;
  private cursor = -1;
  private turnTimer = TURN_SECONDS;
  private lastTickSecond = -1;
  private diceAnim: DiceAnim | null = null;
  private reinforceAnim: ReinforceAnim | null = null;
  private chaosAnim: ChaosAnim | null = null;
  private lastChaos: ChaosKind | null = null;
  private botDelay = 0;
  private botAttacksLeft = 0;
  private botTaunted = false;
  /** A human tapped while the bots were playing: fast-forward until a human's turn. */
  private skipping = false;
  /** This bot turn's tally, shown as a one-line recap when it ends. */
  private turnAttacks = 0;
  private turnCaptures = 0;
  private winnerSeat = -1;
  private hexCenters: { x: number; y: number }[] = [];
  private readonly attacks: number[];
  private readonly captures: number[];
  private readonly snacks: number[];
  private readonly revenges: number[];
  private readonly upsets: number[];

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice();
    this.n = ctx.players.length;
    this.lastRound = maxRounds(this.n);
    this.board = generateBoard(ctx.rng, this.n);
    spawnItems(this.board, ctx.rng, 2);
    const zeros = () => ctx.players.map(() => 0);
    this.stash = zeros();
    this.pepper = zeros();
    this.grudge = ctx.players.map(() => -1);
    this.attacks = zeros();
    this.captures = zeros();
    this.snacks = zeros();
    this.revenges = zeros();
    this.upsets = zeros();
    this.pulse = this.board.tiles.map(() => 0);
    this.pending = this.board.tiles.map(() => 0);
    const shift = ctx.rng.int(0, 3);
    this.personas = ctx.players.map((p) => personaFor(p.slot, shift));
    this.computeHexLayout();
    this.callouts.show("BUG WARS", "#B8FF3D", { size: 84, life: 1.6 });
    this.callouts.show("Grab snacks · Get revenge · Dodge the shoe", "#F4F7FB", { size: 26, life: 2, y: 0.42 });
    ctx.sfx.countdown();
  }

  private computeHexLayout(): void {
    const minCol = Math.min(...this.board.tiles.map((t) => t.col));
    const maxCol = Math.max(...this.board.tiles.map((t) => t.col));
    const minRow = Math.min(...this.board.tiles.map((t) => t.row));
    const maxRow = Math.max(...this.board.tiles.map((t) => t.row));
    const gridW = (maxCol - minCol + 1) * HEX_W + HEX_W * 0.5;
    const gridH = (maxRow - minRow + 1) * HEX_H * 0.75 + HEX_H * 0.25;
    const offsetX = (GAME_WIDTH - gridW) / 2 + HEX_W * 0.5;
    const offsetY = (GAME_HEIGHT - gridH) / 2 + HEX_R + 18;
    this.hexCenters = new Array(this.board.tiles.length);
    for (const tile of this.board.tiles) {
      const x = offsetX + (tile.col - minCol) * HEX_W + (tile.row % 2 === 1 ? HEX_W * 0.5 : 0);
      const y = offsetY + (tile.row - minRow) * HEX_H * 0.75;
      this.hexCenters[tile.id] = { x, y };
    }
  }

  // ------------------------------------------------------------ update

  update(realDt: number): void {
    const dt = this.juice.update(realDt);
    this.callouts.update(realDt);
    this.time += realDt;
    this.updateEffects(dt);

    if (this.phase === "done") {
      this.doneTimer += realDt;
      if (this.doneTimer < 2.5 && this.ctx.rng.next() < realDt * 6) {
        const c = this.ctx.players[this.winnerSeat]?.color ?? "#FFB020";
        this.juice.burst(this.ctx.rng.float(200, GAME_WIDTH - 200), this.ctx.rng.float(120, 400), [c, "#FFB020", "#F4F7FB"], { count: 24, speed: 340 });
      }
      return;
    }

    const botsPlaying = !this.isHuman(this.currentSeat) && this.phase !== "intro";
    if (botsPlaying || this.phase === "chaos") this.checkSkip();
    // Everything animated outside a human's own turn plays back faster.
    const fast = this.phase === "chaos" ? (this.skipping ? SKIP_CHAOS_SPEED : 1) : this.pace();
    const pdt = dt * fast;

    switch (this.phase) {
      case "intro":
        this.introTimer -= dt;
        if (this.introTimer <= 0) {
          this.ctx.sfx.go();
          this.beginSeatTurn();
        }
        return;
      case "chaos":
        this.updateChaos(pdt);
        return;
      case "rolling":
        this.updateDiceAnim(dt);
        return;
      case "reinforce":
        this.updateReinforce(pdt);
        return;
      case "bot":
        this.updateBot(pdt);
        return;
      case "pick":
      case "target":
        this.updateHuman(dt);
        return;
    }
  }

  private updateEffects(dt: number): void {
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 22 * dt;
    }
    removeDead(this.floaters);
    for (const b of this.bubbles) b.life -= dt;
    removeDead(this.bubbles);
    for (const s of this.swarms) s.t += dt;
    for (let i = this.swarms.length - 1; i >= 0; i--) if (this.swarms[i]!.t >= this.swarms[i]!.dur) this.swarms.splice(i, 1);
    for (let i = 0; i < this.pulse.length; i++) this.pulse[i] = Math.max(0, this.pulse[i]! - dt * 2.5);
  }

  /** Playback speed for the current seat's turn (1 for a human's own turn). */
  private pace(): number {
    return playbackSpeed({ humanTurn: this.isHuman(this.currentSeat), skipping: this.skipping });
  }

  /** Any tap / key while the bots are playing fast-forwards to the next human turn. */
  private checkSkip(): void {
    if (!this.ctx.players.some((p) => p.kind === "human")) return;
    const input = this.ctx.input;
    const tapped = input.consumeClick() !== null || input.justPressed("Space") || input.justPressed("Enter");
    if (tapped && !this.skipping) {
      this.skipping = true;
      this.ctx.sfx.whoosh();
      this.floatAtTop("FAST-FORWARD ▶▶", "#94a3b8");
    }
  }

  private isHuman(seat: number): boolean {
    return this.ctx.players[seat]?.kind === "human";
  }

  private color(seat: number): string {
    return this.ctx.players[seat]?.color ?? "#94a3b8";
  }

  private beginSeatTurn(): void {
    const seat = this.currentSeat;
    const player = this.ctx.players[seat]!;
    this.selected = -1;
    this.turnTimer = TURN_SECONDS;
    this.lastTickSecond = -1;
    this.turnAttacks = 0;
    this.turnCaptures = 0;
    this.callouts.show(`${player.name}'s turn`, player.color, { size: 46, life: this.isHuman(seat) ? 0.9 : 0.6, y: 0.22 });
    if (this.isHuman(seat)) {
      this.skipping = false;
      this.phase = "pick";
      if (this.cursor >= 0 && this.board.tiles[this.cursor]?.owner !== seat) this.cursor = -1;
    } else {
      this.phase = "bot";
      this.botDelay = BOT_START_DELAY;
      this.botAttacksLeft = this.personas[seat]!.maxAttacks;
      this.botTaunted = false;
    }
  }

  // ------------------------------------------------------------ human

  private updateHuman(dt: number): void {
    const seat = this.currentSeat;
    if (!hasAnyAttack(this.board, seat)) {
      this.floatAtTop("NO MOVES LEFT", this.color(seat));
      this.advanceTurn();
      return;
    }
    this.turnTimer -= dt;
    const secs = Math.ceil(this.turnTimer);
    if (secs <= 5 && secs !== this.lastTickSecond && secs > 0) {
      this.lastTickSecond = secs;
      this.ctx.sfx.tick();
    }
    if (this.turnTimer <= 0) {
      this.callouts.show("TOO SLOW!", "#FF3D7A", { size: 56, life: 0.9 });
      this.advanceTurn();
      return;
    }

    const input = this.ctx.input;
    if (input.justPressed("Space")) {
      this.advanceTurn();
      return;
    }
    if (input.justPressed("Escape")) {
      this.selected = -1;
      this.phase = "pick";
    }
    const dir = keyDirection(input);
    if (dir) this.moveCursor(dir.x, dir.y);
    if ((input.justPressed("Enter") || input.justPressed("KeyE")) && this.cursor >= 0) {
      this.tapTile(this.cursor);
      return;
    }

    const click = input.consumeClick();
    if (!click) return;
    if (Math.abs(click.x - PASS_BTN.x) <= PASS_BTN.hw && Math.abs(click.y - PASS_BTN.y) <= PASS_BTN.hh) {
      this.advanceTurn();
      return;
    }
    const tileId = this.hitTile(click.x, click.y);
    if (tileId !== null) {
      this.cursor = -1;
      this.tapTile(tileId);
    }
  }

  private canLaunchFrom(tileId: number): boolean {
    const tile = this.board.tiles[tileId];
    return !!tile && tile.owner === this.currentSeat && tile.bugs >= 2 && targetsFrom(this.board, tileId).length > 0;
  }

  /** One tap handler for mouse, touch and keyboard. */
  private tapTile(tileId: number): void {
    const seat = this.currentSeat;
    const tile = this.board.tiles[tileId]!;
    if (this.phase === "target" && tileId === this.selected) {
      this.selected = -1;
      this.phase = "pick";
      return;
    }
    if (this.canLaunchFrom(tileId)) {
      this.selected = tileId;
      this.phase = "target";
      this.ctx.sfx.select();
      return;
    }
    if (this.phase === "target" && canAttack(this.board, this.selected, tileId, seat)) {
      this.launchAttack(this.selected, tileId);
      return;
    }
    if (tile.owner !== seat) {
      // Tapped an enemy first: pick the beefiest neighbour that can reach it.
      const from = (this.board.adjacency[tileId] ?? [])
        .filter((id) => canAttack(this.board, id, tileId, seat))
        .sort((a, b) => this.board.tiles[b]!.bugs - this.board.tiles[a]!.bugs)[0];
      if (from !== undefined) {
        this.selected = from;
        this.phase = "target";
        this.ctx.sfx.select();
      }
    }
  }

  private moveCursor(dx: number, dy: number): void {
    if (this.cursor < 0) {
      const own = this.board.tiles.find((t) => this.canLaunchFrom(t.id)) ?? this.board.tiles.find((t) => t.owner === this.currentSeat);
      this.cursor = own?.id ?? 0;
      this.ctx.sfx.tick();
      return;
    }
    const here = this.hexCenters[this.cursor]!;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.hexCenters.length; i++) {
      if (i === this.cursor) continue;
      const c = this.hexCenters[i]!;
      const vx = c.x - here.x;
      const vy = c.y - here.y;
      const dist = Math.hypot(vx, vy);
      const along = (vx * dx + vy * dy) / dist;
      if (along < 0.45) continue;
      const score = dist * (2 - along);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) {
      this.cursor = best;
      this.ctx.sfx.tick();
    }
  }

  // ------------------------------------------------------------ battles

  private launchAttack(from: number, to: number): void {
    const seat = this.currentSeat;
    const bonus = attackBonuses(this.board, from, to, { grudge: this.grudge[seat]!, pepper: this.pepper[seat]!, round: this.round, lastRound: this.lastRound });
    const target = this.board.tiles[to]!;
    if (this.grudge[seat]! >= 0 && target.owner === this.grudge[seat]) {
      this.grudge[seat] = -1;
      this.revenges[seat] = (this.revenges[seat] ?? 0) + 1;
    }
    this.pepper[seat] = 0;
    const battle = rollBattle(this.board, from, to, this.ctx.rng, { attackDice: bonus.attackDice, defendDice: bonus.defendDice });
    const humanDefending = target.owner >= 0 && this.isHuman(target.owner);
    this.diceAnim = {
      battle,
      timer: 0,
      speed: playbackSpeed({ humanTurn: this.isHuman(seat), humanDefending, skipping: this.skipping }),
      attackSettled: false,
      defendSettled: false,
      attackShown: battle.attackRolls.map(() => 1),
      defendShown: battle.defendRolls.map(() => 1),
      labels: bonus.labels,
      headline: null,
      attackBugs: this.board.tiles[from]!.bugs,
      defendBugs: target.bugs,
    };
    this.phase = "rolling";
    this.selected = -1;
    this.ctx.sfx.whoosh();
    this.pulse[from] = 1;
    if (battle.attackRolls.length >= 8) this.juice.shake(0.15);
  }

  private updateDiceAnim(dt: number): void {
    const anim = this.diceAnim;
    if (!anim) return;
    // A tap mid-roll speeds up the rest of this battle too.
    if (this.skipping && !this.isHuman(this.currentSeat)) anim.speed = Math.max(anim.speed, this.pace());
    anim.timer += dt * anim.speed;
    const rng = this.ctx.rng;
    if (!anim.attackSettled) {
      if (anim.timer < ROLL_ATTACK) for (let i = 0; i < anim.attackShown.length; i++) anim.attackShown[i] = rng.int(1, 6);
      else {
        anim.attackSettled = true;
        anim.attackShown = [...anim.battle.attackRolls];
        this.ctx.sfx.tick();
      }
    }
    if (!anim.defendSettled) {
      if (anim.timer < ROLL_DEFEND) for (let i = 0; i < anim.defendShown.length; i++) anim.defendShown[i] = rng.int(1, 6);
      else {
        anim.defendSettled = true;
        anim.defendShown = [...anim.battle.defendRolls];
        this.revealBattle(anim);
      }
    }
    if (anim.timer > ROLL_END) this.resolveBattle(anim);
  }

  private revealBattle(anim: DiceAnim): void {
    const b = anim.battle;
    const margin = b.attackSum - b.defendSum;
    anim.headline = battleHeadline(anim.attackBugs, anim.defendBugs, b.captured, b.jackpot, margin);
    const center = this.hexCenters[b.to]!;
    if (b.captured) {
      this.ctx.sfx.hit();
      this.juice.shake(0.35 + Math.min(0.4, b.attackRolls.length * 0.03));
      this.juice.hitStop(0.07);
    } else {
      this.ctx.sfx.miss();
      this.juice.shake(0.15);
      this.juice.burst(center.x, center.y, ["#94a3b8", this.color(b.defender)], { count: 10, speed: 160 });
    }
    if (anim.headline) {
      const big = anim.headline === "UPSET!" || b.jackpot;
      this.callouts.show(anim.headline, big ? "#FFD54A" : "#F4F7FB", { size: big ? 70 : 50, life: 1.2, y: 0.3 });
      // Slow-mo is for fights a human is in; bot-vs-bot upsets just flash by.
      if (big && anim.speed <= 1.5) {
        this.juice.slowMo(0.6, 0.35);
        this.ctx.sfx.streak(4);
      }
    }
  }

  private resolveBattle(anim: DiceAnim): void {
    const b = anim.battle;
    this.diceAnim = null;
    const fromC = this.hexCenters[b.from]!;
    const toC = this.hexCenters[b.to]!;
    const movers = this.board.tiles[b.from]!.bugs - 1;
    applyBattle(this.board, b);
    this.attacks[b.attacker] = (this.attacks[b.attacker] ?? 0) + 1;
    this.turnAttacks++;
    if (b.captured) this.turnCaptures++;
    this.pulse[b.to] = 1;

    if (b.captured) {
      this.captures[b.attacker] = (this.captures[b.attacker] ?? 0) + 1;
      this.grudge[b.defender] = b.attacker;
      if (anim.attackBugs < anim.defendBugs) this.upsets[b.attacker] = (this.upsets[b.attacker] ?? 0) + 1;
      this.swarms.push({ from: fromC, to: toC, t: 0, dur: 0.4, color: this.color(b.attacker), count: Math.min(10, movers + 2), seed: this.ctx.rng.next() * 100 });
      this.juice.burst(toC.x, toC.y, [this.color(b.attacker), "#F4F7FB", this.color(b.defender)], { count: 26, speed: 300, gravity: 420 });
      this.say(b.to, bark(anim.headline === "UPSET!" ? "upset" : "capture", this.ctx.rng), this.color(b.attacker));
      if (this.ctx.rng.next() < 0.5) this.say(b.from, bark("ouch", this.ctx.rng), this.color(b.defender), 1.3, true);
      this.triggerItemAt(b.to, b.attacker);
      if (!isAlive(this.board, b.defender)) {
        const name = this.ctx.players[b.defender]?.name ?? "Bug";
        this.callouts.show(`${name} ${bark("wipe", this.ctx.rng)}`, this.color(b.attacker), { size: 60, life: 1.8, y: 0.4 });
        this.juice.slowMo(0.8, 0.3);
        this.juice.shake(0.7);
        this.ctx.sfx.win();
      }
    } else {
      this.say(b.to, bark("defend", this.ctx.rng), this.color(b.defender));
      this.floaters.push({ text: "DEFENDED", x: toC.x, y: toC.y - 34, life: 1, max: 1, color: this.color(b.defender), size: 22 });
    }

    if (this.checkGameOver()) return;

    if (this.isHuman(this.currentSeat)) {
      if (hasAnyAttack(this.board, this.currentSeat)) this.phase = "pick";
      else this.advanceTurn();
    } else {
      this.phase = "bot";
      this.botDelay = BOT_NEXT_DELAY;
    }
  }

  private triggerItemAt(tileId: number, seat: number): void {
    const effect = triggerItem(this.board, tileId, seat);
    if (!effect) return;
    const info = ITEM_INFO[effect.kind];
    const c = this.hexCenters[tileId]!;
    this.snacks[seat] = (this.snacks[seat] ?? 0) + 1;
    this.stash[seat] = addStash(this.stash[seat]!, effect.stashGain);
    this.pepper[seat] = (this.pepper[seat] ?? 0) + effect.pepperDice;
    for (const id of effect.touched) this.pulse[id] = 1;
    this.floaters.push({ text: `${info.emoji} ${info.name}`, x: c.x, y: c.y - 58, life: 1.6, max: 1.6, color: effect.kind === "trap" ? "#FF3D7A" : "#FFD54A", size: 26 });
    if (effect.kind === "firecracker") {
      this.juice.shake(0.5);
      this.juice.burst(c.x, c.y, ["#FFB020", "#FF3D7A", "#FFD54A"], { count: 50, speed: 460 });
      for (const id of effect.touched) {
        const t = this.hexCenters[id]!;
        this.juice.burst(t.x, t.y, ["#FFB020", "#475569"], { count: 12, speed: 200 });
      }
      this.ctx.sfx.hit();
    } else if (effect.kind === "trap") {
      this.say(tileId, "...it's sticky", this.color(seat));
      this.ctx.sfx.miss();
    } else {
      this.juice.burst(c.x, c.y, ["#FFD54A", "#B8FF3D", "#F4F7FB"], { count: 22, speed: 240, gravity: -60 });
      this.ctx.sfx.collect();
    }
  }

  // ------------------------------------------------------------ turns & rounds

  private advanceTurn(): void {
    const seat = this.currentSeat;
    this.selected = -1;
    if (!this.isHuman(seat)) {
      // One-line recap so a fast bot turn is still easy to follow.
      const name = this.ctx.players[seat]?.name ?? "Bot";
      this.floatAtTop(this.turnAttacks === 0 ? `${name} waits` : `${name}: ${this.turnCaptures}/${this.turnAttacks} attacks won`, this.color(seat));
    }
    const underdog = underdogBonus(this.board, seat, this.n);
    const income = endTurnIncome(this.board, seat, this.stash[seat]!, this.ctx.rng, underdog);
    this.stash[seat] = income.stash;
    if (underdog > 0) this.floatAtTop(`UNDERDOG BONUS +${underdog}`, this.color(seat));
    if (income.placed.length > 0) {
      for (const id of income.placed) this.pending[id] = (this.pending[id] ?? 0) + 1;
      this.reinforceAnim = { tiles: income.placed, timer: 0, index: 0 };
      this.phase = "reinforce";
      return;
    }
    this.goToNextSeat();
  }

  private updateReinforce(dt: number): void {
    const anim = this.reinforceAnim;
    if (!anim) return;
    anim.timer += dt;
    const pace = Math.min(0.055, 0.9 / Math.max(1, anim.tiles.length));
    while (anim.index < anim.tiles.length && anim.timer >= pace) {
      anim.timer -= pace;
      const id = anim.tiles[anim.index]!;
      this.pending[id] = Math.max(0, (this.pending[id] ?? 0) - 1);
      this.pulse[id] = 1;
      const c = this.hexCenters[id]!;
      this.juice.burst(c.x, c.y - 10, this.color(this.currentSeat), { count: 4, speed: 90, gravity: 200, size: 3 });
      anim.index++;
      if (anim.index % 2 === 0) this.ctx.sfx.tick();
    }
    if (anim.index >= anim.tiles.length) {
      this.reinforceAnim = null;
      this.pending.fill(0);
      this.goToNextSeat();
    }
  }

  private goToNextSeat(): void {
    const next = nextSeat(this.board, this.n, this.currentSeat);
    if (!next) {
      this.finish();
      return;
    }
    this.currentSeat = next.seat;
    if (next.wrapped) {
      this.round++;
      if (this.checkGameOver()) return;
      this.startChaos();
      return;
    }
    this.beginSeatTurn();
  }

  private startChaos(): void {
    const kind = pickChaos(this.ctx.rng, this.lastChaos);
    this.lastChaos = kind;
    const plan = planChaos(this.board, this.n, kind, this.ctx.rng);
    this.chaosAnim = { plan, timer: 0, result: null };
    this.phase = "chaos";
    const info = CHAOS_INFO[kind];
    this.callouts.show(`ROUND ${this.round}`, "#94a3b8", { size: 34, life: 1, y: 0.16 });
    this.callouts.show(`${info.emoji} ${info.name}`, "#FFD54A", { size: 64, life: CHAOS_TOTAL, y: 0.3 });
    this.callouts.show(info.blurb, "#F4F7FB", { size: 26, life: CHAOS_TOTAL, y: 0.39 });
    this.ctx.sfx.countdown();
  }

  private updateChaos(dt: number): void {
    const anim = this.chaosAnim;
    if (!anim) return;
    anim.timer += dt;
    if (!anim.result && anim.timer >= CHAOS_WARN) {
      anim.result = applyChaos(this.board, anim.plan, this.ctx.rng);
      this.chaosImpact(anim.plan, anim.result);
    }
    if (anim.timer >= CHAOS_TOTAL) {
      this.chaosAnim = null;
      if (isFinalRound(this.round, this.lastRound)) {
        this.callouts.show("FINAL ROUND!", "#FF3D7A", { size: 80, life: 1.6, y: 0.3 });
        this.callouts.show("FRENZY: +1 attack die for everyone", "#FFD54A", { size: 26, life: 1.8, y: 0.4 });
        this.juice.shake(0.4);
        this.ctx.sfx.streak(5);
      }
      this.beginSeatTurn();
    }
  }

  private chaosImpact(plan: ChaosPlan, result: ChaosResult): void {
    for (const id of plan.tiles) {
      this.pulse[id] = 1;
      const c = this.hexCenters[id]!;
      const colors = plan.kind === "spray" ? ["#86efac", "#4ade80", "#d9f99d"] : plan.kind === "picnic" || plan.kind === "ladybug" ? ["#FFD54A", "#FF3D7A", "#F4F7FB"] : ["#78350f", "#a16207", "#F4F7FB"];
      this.juice.burst(c.x, c.y, colors, { count: 14, speed: 220 });
    }
    switch (plan.kind) {
      case "shoe":
        this.juice.shake(0.9);
        this.juice.hitStop(0.12);
        this.ctx.sfx.hit();
        if (plan.tiles[0] !== undefined) this.say(plan.tiles[0], bark("stomp", this.ctx.rng), "#F4F7FB");
        break;
      case "frog":
        this.juice.shake(0.4);
        this.ctx.sfx.whoosh();
        if (plan.tiles[0] !== undefined) this.say(plan.tiles[0], "SLUUURP", "#4ade80");
        break;
      case "spray":
      case "mower":
        this.juice.shake(0.5);
        this.ctx.sfx.hit();
        if (plan.tiles.length > 0) this.say(this.ctx.rng.pick(plan.tiles), plan.kind === "spray" ? "*cough cough*" : "MY LEGS!", "#F4F7FB");
        break;
      case "picnic":
        this.ctx.sfx.collect();
        break;
      case "ladybug":
        this.ctx.sfx.streak(3);
        if (plan.tiles.length > 0) this.say(this.ctx.rng.pick(plan.tiles), "We're back, baby!", this.color(plan.seat));
        break;
    }
    if (result.squashed > 0) this.floatAtTop(`${result.squashed} BUGS SQUASHED`, "#FF3D7A");
    if (result.added > 0) this.floatAtTop(`+${result.added} BUGS`, this.color(plan.seat));
    // Snacks keep showing up even without a picnic.
    if (plan.kind !== "picnic") spawnItems(this.board, this.ctx.rng, 1);
  }

  private checkGameOver(): boolean {
    const end = gameOver(this.board, this.n, this.round);
    if (!end) return false;
    this.finish();
    return true;
  }

  private finish(): void {
    this.phase = "done";
    this.doneTimer = 0;
    this.winnerSeat = leaderSeat(this.board, this.n);
    const winner = this.ctx.players[this.winnerSeat];
    this.ctx.sfx.win();
    this.juice.shake(0.6);
    this.juice.slowMo(0.9, 0.4);
    this.callouts.show(gameOver(this.board, this.n, this.round) === "conquered" ? "TOTAL CONQUEST!" : "TIME'S UP!", "#FFB020", { size: 70, life: 3, y: 0.3 });
    if (winner) this.callouts.show(`${winner.name} rules the garden`, winner.color, { size: 40, life: 3, y: 0.42 });
  }

  // ------------------------------------------------------------ bots

  private updateBot(dt: number): void {
    this.botDelay -= dt;
    if (this.botDelay > 0) return;
    const seat = this.currentSeat;
    const persona = this.personas[seat]!;
    if (this.botAttacksLeft <= 0 || !hasAnyAttack(this.board, seat)) {
      this.advanceTurn();
      return;
    }
    const context = { grudge: this.grudge[seat]!, pepper: this.pepper[seat]!, round: this.round, lastRound: this.lastRound };
    const choice = botPickAttack(this.board, seat, this.ctx.rng, personaOptions(this.board, seat, this.n, persona, context));
    if (!choice) {
      if (this.ctx.rng.next() < 0.3) this.say(this.biggestOwned(seat), "...I'll wait.", this.color(seat));
      this.advanceTurn();
      return;
    }
    if (!this.botTaunted && this.ctx.rng.next() < 0.55) {
      this.botTaunted = true;
      this.say(choice.from, this.ctx.rng.pick(persona.taunts), this.color(seat));
    }
    this.botAttacksLeft--;
    this.selected = choice.from;
    this.launchAttack(choice.from, choice.to);
  }

  private biggestOwned(seat: number): number {
    let best = 0;
    for (const t of this.board.tiles) if (t.owner === seat && (this.board.tiles[best]!.owner !== seat || t.bugs > this.board.tiles[best]!.bugs)) best = t.id;
    return best;
  }

  // ------------------------------------------------------------ helpers

  private say(tile: number, text: string, color: string, life = 1.5, quiet = false): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) if (this.bubbles[i]!.tile === tile) this.bubbles.splice(i, 1);
    this.bubbles.push({ tile, text, color, life, max: life });
    if (!quiet && this.bubbles.length > 4) this.bubbles.shift();
  }

  private floatAtTop(text: string, color: string): void {
    this.floaters.push({ text, x: GAME_WIDTH / 2, y: 92 + (this.floaters.length % 3) * 26, life: 1.4, max: 1.4, color, size: 26 });
  }

  private hitTile(x: number, y: number): number | null {
    let best = -1;
    let bestDist = HEX_R * 1.05;
    for (let i = 0; i < this.hexCenters.length; i++) {
      const c = this.hexCenters[i]!;
      const dist = Math.hypot(x - c.x, y - c.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  private shownBugs(id: number): number {
    return Math.max(1, this.board.tiles[id]!.bugs - (this.pending[id] ?? 0));
  }

  // ------------------------------------------------------------ render

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    this.drawGarden(g);
    this.juice.begin(g);
    this.drawBoard(g);
    this.drawSwarms(g);
    this.drawChaos(g);
    this.drawBubbles(g);
    this.juice.end(g);
    this.drawHUD(g);
    this.drawDiceOverlay(g);
    this.drawFloaters(g);
    if (isFinalRound(this.round, this.lastRound) && this.phase !== "done") this.drawFrenzyVignette(g);
    if (this.phase === "done") {
      g.fillStyle = `rgba(7,11,20,${Math.min(0.45, this.doneTimer * 0.3)})`;
      g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
    if ((this.phase === "pick" || this.phase === "target") && this.isHuman(this.currentSeat)) this.drawPassButton(g);
    else if (this.phase !== "intro" && this.phase !== "done" && !this.isHuman(this.currentSeat) && this.ctx.players.some((p) => p.kind === "human")) this.drawSkipHint(g);
  }

  private drawSkipHint(g: CanvasRenderingContext2D): void {
    g.save();
    g.font = "600 20px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = this.skipping ? "#B8FF3D" : "rgba(203,213,225,0.8)";
    g.fillText(this.skipping ? "▶▶ Fast-forwarding to your turn" : "Tap to fast-forward the bots", PASS_BTN.x, PASS_BTN.y);
    g.restore();
  }

  private drawGarden(g: CanvasRenderingContext2D): void {
    const glow = g.createRadialGradient(GAME_WIDTH / 2, GAME_HEIGHT / 2, 60, GAME_WIDTH / 2, GAME_HEIGHT / 2, 640);
    glow.addColorStop(0, "rgba(74, 222, 128, 0.13)");
    glow.addColorStop(1, "rgba(74, 222, 128, 0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.strokeStyle = "rgba(74, 222, 128, 0.12)";
    g.lineWidth = 2;
    for (let i = 0; i < 46; i++) {
      const x = (i * 97.3) % GAME_WIDTH;
      const y = GAME_HEIGHT - 6 - ((i * 37) % 30);
      const sway = Math.sin(this.time * 1.6 + i) * 4;
      g.beginPath();
      g.moveTo(x, GAME_HEIGHT);
      g.quadraticCurveTo(x + sway * 0.5, y + 12, x + sway, y - 14);
      g.stroke();
    }
  }

  private drawHUD(g: CanvasRenderingContext2D): void {
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    const final = isFinalRound(this.round, this.lastRound);
    g.fillStyle = final ? "#FF3D7A" : "#94a3b8";
    g.fillText(final ? `FINAL ROUND ${this.round}/${this.lastRound}` : `BUG WARS · ROUND ${Math.min(this.round, this.lastRound)}/${this.lastRound}`, 28, 32);

    const chipW = 168;
    const chipH = 50;
    const gap = 8;
    const total = this.n * chipW + (this.n - 1) * gap;
    let x = GAME_WIDTH - 24 - total;
    if (x < 260) x = (GAME_WIDTH - total) / 2;
    const y = x < 260 ? 44 : 12;
    const leader = leaderSeat(this.board, this.n);
    for (let i = 0; i < this.n; i++) {
      const player = this.ctx.players[i]!;
      const active = i === this.currentSeat && this.phase !== "done";
      const alive = isAlive(this.board, i);
      g.globalAlpha = alive ? 1 : 0.4;
      roundRect(g, x, y, chipW, chipH, 14);
      g.fillStyle = active ? player.color : "rgba(15, 23, 42, 0.85)";
      g.fill();
      g.strokeStyle = player.color;
      g.lineWidth = active ? 3 : 1.5;
      g.stroke();
      const ink = active ? "#071018" : player.color;
      g.font = "600 15px Outfit, sans-serif";
      g.textAlign = "left";
      g.fillStyle = ink;
      const crown = i === leader && alive ? "\u{1F451}" : speciesEmoji(speciesFor(player.slot));
      g.fillText(`${crown} ${truncate(player.name, 9)}`, x + 10, y + 21);
      g.font = "500 11px Outfit, sans-serif";
      const extras: string[] = [];
      if (player.kind === "bot") extras.push(this.personas[i]!.label);
      if (!alive) extras.push("\u{1F480} squashed");
      if (this.stash[i]! > 0) extras.push(`\u{1F95A}${this.stash[i]}`);
      if (this.pepper[i]! > 0) extras.push("\u{1F336}\u{FE0F}");
      if (this.grudge[i]! >= 0 && isAlive(this.board, this.grudge[i]!)) extras.push(`\u{1F4A2}${truncate(this.ctx.players[this.grudge[i]!]!.name, 5)}`);
      g.fillText(extras.join(" "), x + 10, y + 40);
      g.textAlign = "right";
      g.font = "700 26px Bebas Neue, Impact, sans-serif";
      g.fillText(String(tilesOwned(this.board, i)), x + chipW - 10, y + 32);
      g.globalAlpha = 1;
      x += chipW + gap;
    }
    g.textAlign = "left";
  }

  private drawBoard(g: CanvasRenderingContext2D): void {
    const hover = this.ctx.input.hover ?? null;
    const hoverId = hover ? this.hitTile(hover.x, hover.y) : null;
    const humanTurn = (this.phase === "pick" || this.phase === "target") && this.isHuman(this.currentSeat);
    for (const tile of this.board.tiles) {
      const c = this.hexCenters[tile.id]!;
      const isSelected = tile.id === this.selected;
      const isTarget = this.selected >= 0 && (this.phase === "target" || this.phase === "bot") && canAttack(this.board, this.selected, tile.id, this.currentSeat);
      const attackable = humanTurn && this.phase === "pick" && this.canLaunchFrom(tile.id);
      const focus = (hoverId === tile.id || this.cursor === tile.id) && humanTurn;
      this.drawHex(g, c.x, c.y, tile.id, isSelected, isTarget, focus, attackable);
    }
    if (this.diceAnim) {
      const a = this.hexCenters[this.diceAnim.battle.from]!;
      const b = this.hexCenters[this.diceAnim.battle.to]!;
      g.save();
      g.strokeStyle = this.color(this.diceAnim.battle.attacker);
      g.lineWidth = 5;
      g.setLineDash([10, 8]);
      g.lineDashOffset = -this.time * 60;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.restore();
    }
  }

  private drawHex(g: CanvasRenderingContext2D, cx: number, cy: number, id: number, selected: boolean, isTarget: boolean, focus: boolean, attackable: boolean): void {
    const tile = this.board.tiles[id]!;
    const player = tile.owner !== NO_OWNER ? this.ctx.players[tile.owner] : null;
    const baseColor = player?.color ?? "#334155";
    const species = speciesFor(player?.slot ?? 0);
    const pulse = this.pulse[id] ?? 0;
    const scale = 1 + pulse * 0.12;
    const bugs = this.shownBugs(id);

    g.save();
    g.translate(cx, cy);
    g.scale(scale, scale);

    hexPath(g, 0, 0, HEX_R - 2);
    g.fillStyle = hexDimColor(baseColor, 0.28 + bugs * 0.03 + pulse * 0.3);
    g.fill();

    if (selected) {
      g.strokeStyle = "#FFD54A";
      g.lineWidth = 4;
      g.shadowColor = "#FFD54A";
      g.shadowBlur = 16;
      g.stroke();
      g.shadowBlur = 0;
    } else if (isTarget) {
      const p = 0.5 + 0.5 * Math.sin(this.time * 8);
      g.strokeStyle = `rgba(255, 61, 122, ${0.55 + 0.45 * p})`;
      g.lineWidth = 3.5;
      g.stroke();
    } else if (focus) {
      g.strokeStyle = "#F4F7FB";
      g.lineWidth = 3;
      g.stroke();
    } else if (attackable) {
      g.strokeStyle = hexDimColor(baseColor, 0.6 + 0.3 * Math.sin(this.time * 4 + id));
      g.lineWidth = 2.5;
      g.stroke();
    } else {
      g.strokeStyle = "rgba(148, 163, 184, 0.22)";
      g.lineWidth = 1;
      g.stroke();
    }

    if (tile.owner !== NO_OWNER) {
      // A crowd of bugs: one big leader plus a little swarm that grows with the stack.
      const extra = Math.min(bugs - 1, 5);
      for (let k = 0; k < extra; k++) {
        const a = (k / 5) * Math.PI * 2 + id;
        const rr = HEX_R * 0.5;
        drawBugSprite(g, Math.cos(a) * rr, Math.sin(a) * rr * 0.75 - 4, species, baseColor, HEX_R * 0.17, this.time, id * 7 + k);
      }
      drawBugSprite(g, 0, -4, species, baseColor, HEX_R * (0.34 + bugs * 0.015), this.time, id);

      g.font = "700 20px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(String(bugs), 0, HEX_R * 0.55);
      g.fillStyle = bugs >= MAX_BUGS ? "#FFB020" : "#F4F7FB";
      g.fillText(String(bugs), 0, HEX_R * 0.55);
    }

    if (tile.item) {
      const bob = Math.sin(this.time * 3 + id) * 3;
      g.font = "22px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(ITEM_INFO[tile.item].emoji, HEX_R * 0.5, -HEX_R * 0.5 + bob);
    }

    if (isTarget && this.phase === "target" && this.selected >= 0) {
      const seat = this.currentSeat;
      const bonus = attackBonuses(this.board, this.selected, id, { grudge: this.grudge[seat]!, pepper: this.pepper[seat]!, round: this.round, lastRound: this.lastRound });
      const chance = winChance(this.board.tiles[this.selected]!.bugs + bonus.attackDice, tile.bugs + bonus.defendDice);
      const pct = Math.round(chance * 100);
      g.font = "700 15px Outfit, sans-serif";
      g.textAlign = "center";
      roundRect(g, -24, -HEX_R * 0.95, 48, 20, 8);
      g.fillStyle = pct >= 60 ? "#16a34a" : pct >= 35 ? "#ca8a04" : "#dc2626";
      g.fill();
      g.fillStyle = "#F4F7FB";
      g.fillText(`${pct}%`, 0, -HEX_R * 0.95 + 11);
    }

    g.restore();
  }

  private drawSwarms(g: CanvasRenderingContext2D): void {
    for (const s of this.swarms) {
      const t = s.t / s.dur;
      for (let k = 0; k < s.count; k++) {
        const lag = k * 0.05;
        const u = Math.max(0, Math.min(1, (t - lag) / (1 - lag * 0.5)));
        const jitter = Math.sin(s.seed + k * 2.3) * 14;
        const x = s.from.x + (s.to.x - s.from.x) * u + jitter * Math.sin(u * Math.PI);
        const y = s.from.y + (s.to.y - s.from.y) * u - Math.sin(u * Math.PI) * 30 + Math.cos(s.seed + k) * 8;
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawChaos(g: CanvasRenderingContext2D): void {
    const anim = this.chaosAnim;
    if (!anim) return;
    const { plan, timer } = anim;
    const warn = Math.min(1, timer / CHAOS_WARN);
    const info = CHAOS_INFO[plan.kind];
    const hostile = plan.kind !== "picnic" && plan.kind !== "ladybug";
    for (const id of plan.tiles) {
      const c = this.hexCenters[id]!;
      if (!anim.result) {
        g.fillStyle = hostile ? `rgba(0,0,0,${0.15 + warn * 0.4})` : `rgba(255,213,74,${0.1 + warn * 0.25})`;
        g.beginPath();
        g.ellipse(c.x, c.y, HEX_R * (0.4 + warn * 0.6), HEX_R * (0.3 + warn * 0.45), 0, 0, Math.PI * 2);
        g.fill();
        hexPath(g, c.x, c.y, HEX_R - 2);
        g.strokeStyle = hostile ? `rgba(255,61,122,${0.4 + 0.6 * Math.abs(Math.sin(timer * 12))})` : "rgba(255,213,74,0.8)";
        g.lineWidth = 3;
        g.stroke();
      }
    }
    if (plan.tiles.length === 0) return;
    // The culprit swoops toward the first tile, then hangs around.
    const first = this.hexCenters[plan.tiles[0]!]!;
    let cx = first.x;
    let cy = first.y;
    if (plan.kind === "mower") {
      const xs = plan.tiles.map((id) => this.hexCenters[id]!.x);
      const left = Math.min(...xs) - 120;
      const right = Math.max(...xs) + 120;
      cx = left + (right - left) * Math.min(1, timer / CHAOS_TOTAL);
    } else if (plan.kind === "spray") {
      cy -= 30;
    }
    const drop = anim.result ? 0 : (1 - warn * warn) * -260;
    const size = plan.kind === "shoe" ? 120 : 72;
    g.save();
    g.globalAlpha = timer > CHAOS_TOTAL - 0.4 ? Math.max(0, (CHAOS_TOTAL - timer) / 0.4) : 1;
    g.font = `${size}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (plan.kind === "picnic" || plan.kind === "ladybug") {
      for (const id of plan.tiles.slice(0, 6)) {
        const c = this.hexCenters[id]!;
        g.font = "40px sans-serif";
        g.fillText(info.emoji, c.x, c.y + drop * 0.6 - 10);
      }
    } else if (plan.kind === "spray") {
      for (const id of plan.tiles) {
        const c = this.hexCenters[id]!;
        g.fillStyle = `rgba(134, 239, 172, ${0.25 * warn})`;
        g.beginPath();
        g.arc(c.x + Math.sin(timer * 3 + id) * 8, c.y, HEX_R * 0.9 * warn, 0, Math.PI * 2);
        g.fill();
      }
      g.fillText(info.emoji, cx - 80, cy - 60);
    } else {
      g.fillText(info.emoji, cx, cy + drop - (plan.kind === "shoe" ? 30 : 0));
      if (plan.kind === "frog" && anim.result) {
        g.strokeStyle = "#f472b6";
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(cx, cy - 40);
        g.lineTo(cx + Math.sin(timer * 20) * 20, cy);
        g.stroke();
      }
    }
    g.restore();
  }

  private drawBubbles(g: CanvasRenderingContext2D): void {
    // Neighbouring tiles often bark at once: nudge later bubbles up so none overlap.
    g.font = "700 15px Outfit, sans-serif";
    const placed: { x: number; y: number; w: number }[] = [];
    for (const b of this.bubbles) {
      const c = this.hexCenters[b.tile];
      if (!c) continue;
      const w = g.measureText(b.text).width + 18;
      let y = c.y - HEX_R - 14;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((p) => Math.abs(p.x - c.x) < (p.w + w) / 2 + 4 && Math.abs(p.y - y) < 30);
        if (!hit) break;
        y = hit.y - 32;
      }
      placed.push({ x: c.x, y, w });
      const t = 1 - b.life / b.max;
      const pop = t < 0.1 ? 0.5 + t * 5 : 1;
      const tail = c.y - HEX_R - 14 - y;
      g.save();
      g.globalAlpha = Math.min(1, b.life / 0.3);
      g.translate(c.x, y);
      g.scale(pop, pop);
      g.font = "700 15px Outfit, sans-serif";
      roundRect(g, -w / 2, -16, w, 26, 10);
      g.fillStyle = "#F4F7FB";
      g.fill();
      g.strokeStyle = b.color;
      g.lineWidth = 2.5;
      g.stroke();
      g.beginPath();
      g.moveTo(-6, 10);
      g.lineTo(0, 20 + tail);
      g.lineTo(6, 10);
      g.closePath();
      g.fillStyle = "#F4F7FB";
      g.fill();
      g.fillStyle = "#071018";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(b.text, 0, -3);
      g.restore();
    }
  }

  private drawDiceOverlay(g: CanvasRenderingContext2D): void {
    const anim = this.diceAnim;
    if (!anim) return;
    const b = anim.battle;
    const cx = GAME_WIDTH / 2;
    const y = GAME_HEIGHT - 92;
    const attackColor = this.color(b.attacker);
    const defendColor = this.color(b.defender);
    const panelW = 760;

    g.save();
    roundRect(g, cx - panelW / 2, y - 44, panelW, anim.labels.length > 0 ? 104 : 84, 16);
    g.fillStyle = "rgba(7, 11, 20, 0.88)";
    g.fill();
    g.strokeStyle = "rgba(148,163,184,0.3)";
    g.lineWidth = 1.5;
    g.stroke();

    this.drawDiceRow(g, cx - 60, y, anim.attackShown, attackColor, -1, anim.attackSettled);
    this.drawDiceRow(g, cx + 60, y, anim.defendShown, defendColor, 1, anim.defendSettled);

    g.font = "700 30px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#94a3b8";
    g.fillText("VS", cx, y);
    if (anim.attackSettled) {
      g.fillStyle = attackColor;
      g.fillText(String(b.attackSum), cx - 34, y + 30);
    }
    if (anim.defendSettled) {
      g.fillStyle = defendColor;
      g.fillText(String(b.defendSum), cx + 34, y + 30);
    }
    if (anim.labels.length > 0) {
      g.font = "700 14px Outfit, sans-serif";
      g.fillStyle = "#FFD54A";
      g.fillText(anim.labels.join("   "), cx, y + 50);
    }
    g.restore();
  }

  private drawDiceRow(g: CanvasRenderingContext2D, edgeX: number, cy: number, dice: number[], color: string, side: -1 | 1, settled: boolean): void {
    const size = dice.length > 9 ? 22 : 30;
    const gap = 5;
    const maxShow = Math.min(dice.length, 10);
    for (let i = 0; i < maxShow; i++) {
      const x = edgeX + side * (i * (size + gap) + size / 2);
      const wob = settled ? 0 : Math.sin(this.time * 40 + i) * 0.3;
      g.save();
      g.translate(x, cy + (settled ? 0 : Math.sin(this.time * 30 + i * 2) * 3));
      g.rotate(wob);
      roundRect(g, -size / 2, -size / 2, size, size, 6);
      g.fillStyle = color;
      g.fill();
      g.font = `700 ${Math.round(size * 0.66)}px Bebas Neue, Impact, sans-serif`;
      g.fillStyle = "#071018";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(dice[i] ?? 0), 0, 1);
      g.restore();
    }
    if (dice.length > maxShow) {
      g.font = "600 14px Outfit, sans-serif";
      g.fillStyle = "#94a3b8";
      g.textAlign = "center";
      g.fillText(`+${dice.length - maxShow}`, edgeX + side * (maxShow * (size + gap) + 12), cy);
    }
  }

  private drawFrenzyVignette(g: CanvasRenderingContext2D): void {
    const a = 0.18 + 0.1 * Math.sin(this.time * 5);
    const grad = g.createRadialGradient(GAME_WIDTH / 2, GAME_HEIGHT / 2, 300, GAME_WIDTH / 2, GAME_HEIGHT / 2, 760);
    grad.addColorStop(0, "rgba(255,61,122,0)");
    grad.addColorStop(1, `rgba(255,61,122,${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawPassButton(g: CanvasRenderingContext2D): void {
    const hover = this.ctx.input.hover ?? null;
    const hovered = !!hover && Math.abs(hover.x - PASS_BTN.x) <= PASS_BTN.hw && Math.abs(hover.y - PASS_BTN.y) <= PASS_BTN.hh;
    const color = this.color(this.currentSeat);
    const frac = Math.max(0, this.turnTimer / TURN_SECONDS);
    const urgent = this.turnTimer <= 5;
    const x = PASS_BTN.x - PASS_BTN.hw;
    const y = PASS_BTN.y - PASS_BTN.hh;
    const w = PASS_BTN.hw * 2;
    const h = PASS_BTN.hh * 2;

    roundRect(g, x, y, w, h, 14);
    g.fillStyle = hovered ? "rgba(30,41,59,0.95)" : "rgba(15,23,42,0.9)";
    g.fill();
    g.save();
    roundRect(g, x, y, w, h, 14);
    g.clip();
    g.fillStyle = urgent ? `rgba(255,61,122,${0.35 + 0.25 * Math.sin(this.time * 14)})` : hexDimColor(color, 0.3);
    g.fillRect(x, y, w * frac, h);
    g.restore();
    roundRect(g, x, y, w, h, 14);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();

    g.font = "700 24px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#F4F7FB";
    g.fillText(`END TURN · ${Math.ceil(this.turnTimer)}s`, PASS_BTN.x, PASS_BTN.y + 1);

    // Big enough to read on a phone, where the 1280-wide board is scaled down ~2x.
    g.font = "600 18px Outfit, sans-serif";
    g.fillStyle = "#cbd5e1";
    const hint = this.phase === "target" ? "Tap an enemy with a pulsing red outline · tap your stack to cancel" : "Tap one of your stacks (2+ bugs), then an enemy next to it";
    g.fillText(hint, PASS_BTN.x, PASS_BTN.y - PASS_BTN.hh - 12);
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    for (const f of this.floaters) {
      g.globalAlpha = Math.min(1, (f.life / f.max) * 2);
      g.font = `700 ${f.size}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------ GameInstance

  isFinished(): boolean {
    return this.phase === "done" && this.doneTimer > 3.2;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((player, i) => ({ playerId: player.id, score: tilesOwned(this.board, i) }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    this.ctx.players.forEach((player, i) => {
      const add = (label: string, value: number) => {
        if (value > 0) stats.push({ playerId: player.id, label, value: String(value) });
      };
      add("Attacks", this.attacks[i] ?? 0);
      add("Captured", this.captures[i] ?? 0);
      add("Snacks", this.snacks[i] ?? 0);
      add("Revenge", this.revenges[i] ?? 0);
      add("Upsets", this.upsets[i] ?? 0);
    });
    return stats;
  }

  destroy(): void {}
}

function removeDead<T extends { life: number }>(items: T[]): void {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.life <= 0) items.splice(i, 1);
}

function keyDirection(input: GameContext["input"]): { x: number; y: number } | null {
  if (input.justPressed("ArrowLeft") || input.justPressed("KeyA")) return { x: -1, y: 0 };
  if (input.justPressed("ArrowRight") || input.justPressed("KeyD")) return { x: 1, y: 0 };
  if (input.justPressed("ArrowUp") || input.justPressed("KeyW")) return { x: 0, y: -1 };
  if (input.justPressed("ArrowDown") || input.justPressed("KeyS")) return { x: 0, y: 1 };
  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
  return `rgba(${r},${gg},${b},${Math.max(0, Math.min(1, alpha))})`;
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
  g.rotate(Math.sin(time * 1.3 + id) * 0.25);

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
  let headX = 0.65;
  if (isBeetle) {
    fillEllipse(g, abdX * r, 0, 0.85 * r, 0.6 * r);
    fillEllipse(g, 0.3 * r, 0, 0.35 * r, 0.38 * r);
    fillEllipse(g, 0.7 * r, 0, 0.3 * r, 0.28 * r);
    headX = 0.7;
    g.strokeStyle = "rgba(20, 14, 8, 0.5)";
    g.lineWidth = Math.max(1, r * 0.1);
    g.beginPath();
    g.moveTo(0.2 * r, 0);
    g.lineTo((abdX - 0.8) * r, 0);
    g.stroke();
  } else if (isSpider) {
    fillEllipse(g, abdX * r, 0, 0.75 * r, 0.58 * r);
    fillEllipse(g, 0.35 * r, 0, 0.42 * r, 0.38 * r);
    headX = 0.35;
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
    for (const dx of [-0.9, -0.6, -0.3]) fillEllipse(g, dx * r, 0, 0.08 * r, 0.55 * r);
    g.restore();
  }

  // Googly eyes: the single most important feature of any bug army.
  if (r > 8) {
    const look = Math.sin(time * 2 + id * 3) * 0.06 * r;
    for (const side of [-1, 1]) {
      g.fillStyle = "#F4F7FB";
      fillEllipse(g, (headX + 0.12) * r, side * 0.16 * r, 0.14 * r, 0.14 * r);
      g.fillStyle = "#071018";
      fillEllipse(g, (headX + 0.16) * r + look, side * 0.16 * r, 0.07 * r, 0.07 * r);
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
  tagline: "Roll dice. Grab snacks. Dodge the shoe.",
  description:
    "A hex garden split between bug armies. Attack a neighbouring enemy tile and roll dice: more bugs, more dice, strictly higher wins (3+ matching dice is a JACKPOT). Capture tiles with snacks for power-ups, take REVENGE on whoever hit you last for +1 die, and survive backyard chaos every round: giant shoes, bug spray, lawnmowers and hungry frogs that love to pick on the leader. Last round is a FRENZY. Most tiles wins.",
  durationMs: 0,
  controls: "Tap your stack, then a red enemy tile (or tap an enemy, then confirm). Arrows/WASD + Enter on keyboard. Space or the button ends your turn (30s clock).",
  create: (ctx) => new BugWarsGame(ctx),
};
