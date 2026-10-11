import { drawPlayerOrb, drawTimerBar } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  activeColor,
  activeHotSpot,
  applyFalls,
  botTarget,
  botFreezeChance,
  botWrongChance,
  canCurse,
  canRevive,
  cashEmbers,
  curseArmS,
  fallers,
  finalColor,
  finalScores,
  gridShape,
  hotSpotClaimant,
  matchOver,
  MAX_PLAYS,
  nearMiss,
  OVERDRIVE_ROUND,
  planBot,
  planGhost,
  planRound,
  resolveShoves,
  safeTiles,
  shuffle,
  startingLives,
  stepFuse,
  tileAtPoint,
  tileCenter,
  tileRect,
  TILE_COLORS,
  TILE_COUNT,
  type BotPlan,
  type GhostPlan,
  type GridLayout,
  type RoundPlan,
  type Standing,
} from "./logic";

export const hotTiles: GameDefinition = {
  id: "hot-tiles",
  name: "Hot Tiles",
  tagline: "Get on the colour. Fear the ghosts.",
  description:
    "Twenty coloured tiles float over lava. A colour is called: drag your token onto a tile of that " +
    "colour before the window closes, because every other tile drops into the lava. Stand on the gold " +
    "Hot Spot at the close to earn embers (three embers = an extra life). Later calls can SWITCH colour " +
    "mid-window, and anyone who burns through their lives comes back as a ghost: drag it onto a tile to " +
    "curse it so it drops too, called colour or not. Haunt two players and you climb back out of the lava.",
  durationMs: 0,
  controls: "Drag your token onto a tile of the called colour. Ghosts: drag onto a tile to curse it.",
  fillsScreen: true,
  create: (ctx) => new HotTiles(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 0.8;
const WAIT_S = 1.0;
const DROP_S = 1.0;
const RESULT_S = 1.1;
const FINAL_S = 2.2;
const RISE_S = 0.5;
const SAVE_SNAPSHOT_MS = 350;
const BEST_VERSION = "v2-lives";
const LAVA_COLORS = ["#FF6A00", "#FFB020", "#FF3D1F", "#FFE28A"] as const;
const GOLD = "#FFD21F";
const GHOST_TINT = "#C9F0FF";

type Phase = "intro" | "wait" | "call" | "drop" | "result" | "final";

interface Token {
  player: Player;
  x: number;
  y: number;
  alive: boolean;
  lives: number;
  embers: number;
  embersTotal: number;
  hauntings: number;
  revived: boolean;
  rank: number;
  /** Seconds since this token started falling, or -1. */
  fall: number;
  splashed: boolean;
  /** Fell this round but still has a life: respawns next round. */
  singed: boolean;
  bot: BotPlan | null;
  botReplanAt: number;
  ghost: GhostPlan | null;
  ghostSpent: boolean;
  ghostAge: number;
  aimX: number;
  aimY: number;
  heldBy: number | null;
  survived: number;
  safeEarly: boolean;
  newBest: boolean;
}

class HotTiles implements GameInstance {
  private readonly tokens: Token[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly layout: GridLayout;
  private readonly radius: number;
  private readonly botSpeed: number;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private time = 0;
  private roundIndex = 0;
  private plays = 0;
  private plan: RoundPlan;
  private callT = 0;
  private switched = false;
  private switchFlash = 0;
  private riseT = 0;
  private dropT = 0;
  private readonly dropDelay: number[] = [];
  private readonly fuse: number[] = [];
  private readonly cursedBy: number[] = [];
  private readonly cracks: { x: number; y: number }[][] = [];
  private dropping = false;
  private eliminated = 0;
  private replay = false;
  private snapshotDone = false;
  private overdriveShown = false;
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private lavaCache: HTMLCanvasElement | null = null;
  private tileSprites: HTMLCanvasElement[] | null = null;
  private readonly drags = new Map<number, number>();

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const { width, height } = ctx;
    const { cols, rows } = gridShape(width, height);
    const hud = Math.round(Math.min(width, height) * 0.12);
    const pad = Math.round(Math.min(width, height) * 0.04);
    this.layout = {
      x: pad, y: hud, w: width - pad * 2, h: height - hud - pad, cols, rows,
      gap: Math.max(6, Math.round(Math.min(width, height) * 0.014)),
    };
    const tile = tileRect(this.layout, 0);
    const tileMin = Math.min(tile.w, tile.h);
    this.radius = Math.max(ctx.minTap * 0.55, Math.min(tileMin * 0.24, tileMin * 0.4));
    this.botSpeed = Math.hypot(this.layout.w, this.layout.h) / 1.25;

    const lives = startingLives(ctx.players.length);
    const spots = shuffle(Array.from({ length: TILE_COUNT }, (_, i) => i), ctx.rng);
    this.tokens = ctx.players.map((player, i) => {
      const c = tileCenter(this.layout, spots[i % spots.length]!);
      return {
        player, x: c.x, y: c.y, alive: true, lives, embers: 0, embersTotal: 0, hauntings: 0, revived: false, rank: 0,
        fall: -1, splashed: false, singed: false, bot: null, botReplanAt: -1, ghost: null, ghostSpent: false, ghostAge: 0,
        aimX: 0, aimY: 0, heldBy: null, survived: 0, safeEarly: false, newBest: false,
      };
    });
    for (let i = 0; i < TILE_COUNT; i++) {
      this.fuse[i] = 0;
      this.cursedBy[i] = -1;
      this.dropDelay[i] = 0;
      // Three jagged crack lines per tile, drawn when a ghost curses it.
      const lines: { x: number; y: number }[] = [];
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + ctx.rng.float(-0.5, 0.5);
        let px = 0;
        let py = 0;
        lines.push({ x: px, y: py });
        for (let s = 1; s <= 4; s++) {
          const len = Math.min(tile.w, tile.h) * 0.14;
          px += Math.cos(a + ctx.rng.float(-0.7, 0.7)) * len;
          py += Math.sin(a + ctx.rng.float(-0.7, 0.7)) * len * 0.75;
          lines.push({ x: px, y: py });
        }
        lines.push({ x: NaN, y: NaN });
      }
      this.cracks[i] = lines;
    }
    this.plan = planRound(0, ctx.rng);
    this.callouts.show("ROUND 1", "#F4F7FB", { size: 72, life: INTRO_S, y: 0.45 });

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  // ---------------------------------------------------------------- update

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.switchFlash = Math.max(0, this.switchFlash - realDt);
    this.stepFalls(realDt);
    for (const t of this.tokens) if (!t.alive && t.fall < 0) t.ghostAge += realDt;
    if (this.finished) return;

    switch (this.phase) {
      case "intro":
        this.riseT = Math.min(RISE_S, this.riseT + dt);
        this.timer -= dt;
        this.clampGhosts();
        if (this.timer <= 0) {
          this.phase = "wait";
          this.timer = WAIT_S;
          this.ctx.sfx.tick();
        }
        break;
      case "wait":
        this.riseT = Math.min(RISE_S, this.riseT + dt);
        this.timer -= dt;
        this.stalk(dt);
        this.shove();
        this.clampGhosts();
        if (this.timer <= 0) this.startCall();
        break;
      case "call":
        this.callT += dt;
        if (!this.switched && this.plan.switchAtMs >= 0 && this.callT * 1000 >= this.plan.switchAtMs) this.doSwitch();
        this.stepBots(dt);
        this.stepGhosts(dt);
        this.stepFuses(dt);
        this.shove();
        this.clampGhosts();
        if (!this.snapshotDone && this.callT * 1000 >= this.plan.windowMs - SAVE_SNAPSHOT_MS) {
          this.snapshotDone = true;
          for (const t of this.tokens) t.safeEarly = this.onSafe(t);
        }
        if (this.callT * 1000 >= this.plan.windowMs) this.closeWindow();
        break;
      case "drop":
        this.dropT += dt;
        if (this.dropT >= DROP_S) this.afterDrop();
        break;
      case "result":
        this.timer -= dt;
        if (this.timer <= 0) this.nextRound();
        break;
      case "final":
        this.timer -= dt;
        if (this.timer <= 0) this.finished = true;
        break;
    }
  }

  private cursedFlags(): boolean[] {
    return this.cursedBy.map((b) => b >= 0);
  }

  /** Tiles a bot should steer clear of: cursed, or a ghost is most of the way to cursing it. */
  private dangerFlags(): boolean[] {
    return this.fuse.map((f, i) => (this.cursedBy[i] ?? -1) >= 0 || f >= 0.5);
  }

  private distancesFrom(t: Token): number[] {
    const out: number[] = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      const c = tileCenter(this.layout, i);
      out.push(Math.hypot(c.x - t.x, c.y - t.y));
    }
    return out;
  }

  private startCall(): void {
    this.phase = "call";
    this.callT = 0;
    this.switched = false;
    this.snapshotDone = false;
    const tile = tileRect(this.layout, 0);
    for (const t of this.tokens) {
      t.botReplanAt = -1;
      if (t.player.kind !== "bot") continue;
      if (t.alive) {
        t.bot = planBot(this.plan, this.ctx.rng, {
          distances: this.distancesFrom(t), hotSpot: this.plan.hotSpot, hotSpotChance: 0.35,
          wrongChance: botWrongChance(this.roundIndex), freezeChance: botFreezeChance(this.roundIndex),
        });
        t.aimX = (this.ctx.rng.next() - 0.5) * tile.w * 0.3;
        t.aimY = (this.ctx.rng.next() - 0.5) * tile.h * 0.3;
      } else if (t.fall < 0) {
        t.ghost = planGhost(this.plan, this.ctx.rng, this.preyWeights(this.plan.color, this.plan.hotSpot), this.cursedFlags());
      }
    }
    this.juice.shake(0.25);
    this.ctx.sfx.go();
  }

  /** How tempting each tile is for a ghost: tokens standing on it, the Hot Spot, tokens close by. */
  private preyWeights(color: number, hotSpot: number): number[] {
    const w: number[] = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      let v = this.plan.tiles[i] === color ? 0.1 : 0;
      if (i === hotSpot) v += 0.8;
      const c = tileCenter(this.layout, i);
      for (const t of this.tokens) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x - c.x, t.y - c.y);
        if (tileAtPoint(this.layout, t.x, t.y) === i) v += 1.2;
        else if (d < this.layout.w * 0.3) v += 0.3 * (1 - d / (this.layout.w * 0.3));
        if (t.lives === 1) v += 0.15;
      }
      w.push(v);
    }
    return w;
  }

  private doSwitch(): void {
    this.switched = true;
    this.switchFlash = 0.6;
    const col = TILE_COLORS[this.plan.switchColor]!;
    this.callouts.show("SWITCH!", "#F4F7FB", { size: 54, life: 0.8, y: 0.24 });
    this.juice.hitStop(0.05);
    this.juice.shake(0.45);
    this.juice.burst(this.ctx.width / 2, this.ctx.height / 2, [col.hex, "#F4F7FB"], { count: 30, speed: 420, size: 7, life: 0.7, gravity: 300 });
    this.ctx.sfx.streak(4);
    const from = this.callT * 1000;
    for (const t of this.tokens) {
      if (t.player.kind !== "bot") continue;
      if (t.alive) {
        t.bot = planBot(this.plan, this.ctx.rng, {
          color: this.plan.switchColor, fromMs: from, quick: true, distances: this.distancesFrom(t),
          avoid: this.dangerFlags(), hotSpot: this.plan.switchHotSpot,
        });
        t.botReplanAt = -1;
      } else if (t.fall < 0 && !t.ghostSpent) {
        t.ghost = planGhost(this.plan, this.ctx.rng, this.preyWeights(this.plan.switchColor, this.plan.switchHotSpot), this.cursedFlags(), from);
      }
    }
  }

  private stepBots(dt: number): void {
    const danger = this.dangerFlags();
    const nowMs = this.callT * 1000;
    for (const t of this.tokens) {
      if (!t.alive || t.bot === null) continue;
      const target = botTarget(t.bot, nowMs);
      // A ghost is cursing the tile this bot wants: most bots notice after a beat and pick another,
      // some never look down (-2 = oblivious this round).
      if (danger[t.bot.target] && t.botReplanAt === -1) {
        t.botReplanAt = this.ctx.rng.next() < 0.7 ? this.callT + this.ctx.rng.float(0.35, 0.8) : -2;
      }
      if (t.botReplanAt >= 0 && this.callT >= t.botReplanAt) {
        t.botReplanAt = -1;
        t.bot = planBot(this.plan, this.ctx.rng, {
          color: activeColor(this.plan, nowMs), fromMs: nowMs, quick: true, distances: this.distancesFrom(t),
          avoid: danger, hotSpot: activeHotSpot(this.plan, nowMs), hotSpotChance: 0.2,
        });
        continue;
      }
      if (target === null) continue;
      const c = tileCenter(this.layout, target);
      this.moveToward(t, c.x + t.aimX, c.y + t.aimY, this.botSpeed * dt);
    }
  }

  private stepGhosts(dt: number): void {
    const nowMs = this.callT * 1000;
    for (const t of this.tokens) {
      if (t.alive || t.fall >= 0 || t.ghost === null || t.ghostSpent || t.heldBy !== null) continue;
      if (nowMs < t.ghost.delayMs) continue;
      // Late in the window, a ghost sitting on an empty tile drifts to where the prey is.
      if (nowMs > this.plan.windowMs * 0.5 && this.fuse[t.ghost.target] === 0) {
        const weights = this.preyWeights(activeColor(this.plan, nowMs), activeHotSpot(this.plan, nowMs));
        const next = planGhost(this.plan, this.ctx.rng, weights, this.cursedFlags(), nowMs);
        if (next && next.target !== t.ghost.target) t.ghost = { delayMs: nowMs, target: next.target };
      }
      const c = tileCenter(this.layout, t.ghost.target);
      this.moveToward(t, c.x, c.y, this.botSpeed * 0.8 * dt);
    }
  }

  /** Before the call, bot ghosts drift after the weakest nearby player so they're close when it comes. */
  private stalk(dt: number): void {
    for (const t of this.tokens) {
      if (t.alive || t.fall >= 0 || t.player.kind !== "bot" || t.heldBy !== null) continue;
      let prey: Token | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const o of this.tokens) {
        if (!o.alive) continue;
        const score = Math.hypot(o.x - t.x, o.y - t.y) + o.lives * this.layout.w * 0.2;
        if (score < bestScore) {
          bestScore = score;
          prey = o;
        }
      }
      if (prey) this.moveToward(t, prey.x, prey.y - this.radius * 1.5, this.botSpeed * 0.45 * dt);
    }
  }

  private moveToward(t: Token, x: number, y: number, step: number): void {
    const dx = x - t.x;
    const dy = y - t.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      t.x = x;
      t.y = y;
    } else {
      t.x += (dx / d) * step;
      t.y += (dy / d) * step;
    }
  }

  private stepFuses(dt: number): void {
    const cursed = this.cursedFlags();
    const color = activeColor(this.plan, this.callT * 1000);
    const holder: number[] = [];
    for (let i = 0; i < TILE_COUNT; i++) holder[i] = -1;
    this.tokens.forEach((t, i) => {
      if (t.alive || t.fall >= 0 || t.ghostSpent) return;
      const tile = tileAtPoint(this.layout, t.x, t.y);
      // Only tiles of the colour on call can be cursed (the others drop anyway).
      if (tile >= 0 && this.plan.tiles[tile] === color && (holder[tile] ?? -1) < 0 && canCurse(this.plan, cursed, tile)) holder[tile] = i;
    });
    for (let i = 0; i < TILE_COUNT; i++) {
      if ((this.cursedBy[i] ?? -1) >= 0) continue;
      const h = holder[i] ?? -1;
      const before = this.fuse[i] ?? 0;
      const after = stepFuse(before, h >= 0, dt, curseArmS(this.plan.windowMs));
      this.fuse[i] = after;
      if (h >= 0 && after >= 1 && before < 1) {
        this.cursedBy[i] = h;
        const ghost = this.tokens[h]!;
        ghost.ghostSpent = true;
        const c = tileCenter(this.layout, i);
        this.juice.burst(c.x, c.y, [ghost.player.color, GHOST_TINT, "#2a0a2a"], { count: 22, speed: 260, size: 6, life: 0.6, gravity: 200 });
        this.juice.shake(0.3);
        this.ctx.sfx.hit();
      }
    }
  }

  private shove(): void {
    const live = this.tokens.filter((t) => t.alive);
    resolveShoves(live, this.radius, live.map((t) => t.heldBy !== null));
    const { width, height } = this.ctx;
    for (const t of live) {
      t.x = Math.max(this.radius, Math.min(width - this.radius, t.x));
      t.y = Math.max(this.layout.y, Math.min(height - this.radius, t.y));
    }
  }

  private clampGhosts(): void {
    const { width, height } = this.ctx;
    for (const t of this.tokens) {
      if (t.alive) continue;
      t.x = Math.max(this.radius, Math.min(width - this.radius, t.x));
      t.y = Math.max(this.layout.y * 0.6, Math.min(height - this.radius, t.y));
    }
  }

  private onSafe(t: Token): boolean {
    const tile = tileAtPoint(this.layout, t.x, t.y);
    return tile >= 0 && this.plan.tiles[tile] === finalColor(this.plan) && (this.cursedBy[tile] ?? -1) < 0;
  }

  private closeWindow(): void {
    this.phase = "drop";
    this.dropT = 0;
    this.dropping = true;
    this.drags.clear();
    for (const t of this.tokens) t.heldBy = null;
    for (let i = 0; i < TILE_COUNT; i++) this.dropDelay[i] = this.ctx.rng.float(0, 0.22);

    const cursed = this.cursedFlags();
    const safe = safeTiles(this.plan, cursed);
    const hot = activeHotSpot(this.plan, this.plan.windowMs);
    const tileOf = this.tokens.map((t) => tileAtPoint(this.layout, t.x, t.y));
    const alive = this.tokens.map((t) => t.alive);
    const lives = this.tokens.map((t) => t.lives);
    const ranks = this.tokens.map((t) => t.rank);
    const fell = fallers(tileOf, this.plan, alive, cursed);
    const claimant = hot >= 0 && !cursed[hot]
      ? hotSpotClaimant(this.tokens, alive, tileOf, hot, tileCenter(this.layout, hot))
      : -1;
    const res = applyFalls(alive, lives, ranks, fell, this.eliminated);
    this.replay = res.outcome === "replay";
    this.eliminated = res.eliminated;

    let slot = 0;
    const small = (text: string, color: string): void => {
      if (slot >= 3) return;
      this.callouts.show(text, color, { size: 40, life: 1.1 + slot * 0.1, y: 0.64 + slot * 0.09 });
      slot += 1;
    };

    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      t.bot = null;
      t.ghost = null;
      if (fell.includes(i)) {
        t.fall = 0;
        t.splashed = false;
        const tile = tileOf[i]!;
        const by = tile >= 0 ? (this.cursedBy[tile] ?? -1) : -1;
        if (by >= 0) {
          const ghost = this.tokens[by]!;
          ghost.hauntings += 1;
          small(`${ghost.player.name} HAUNTED ${t.player.name}!`, ghost.player.color);
          if (ghost.player.kind === "bot" && slot < 3) small(`${ghost.player.name}: GOTCHA!`, ghost.player.color);
        } else if (nearMiss(this.layout, t.x, t.y, safe, this.radius * 0.9)) {
          small("SO CLOSE!", t.player.color);
        }
        if (!this.replay) {
          t.lives = lives[i]!;
          t.alive = alive[i]!;
          t.rank = ranks[i]!;
          t.singed = t.alive;
          if (!t.alive) {
            t.ghostAge = 0;
            t.ghostSpent = false;
          }
        }
      } else if (t.alive) {
        t.survived += 1;
        if (i === claimant) {
          t.embers += 1;
          t.embersTotal += 1;
          const cash = cashEmbers(t.lives, t.embers);
          t.lives = cash.lives;
          t.embers = cash.embers;
          const c = tileCenter(this.layout, hot);
          this.juice.burst(c.x, c.y, [GOLD, "#FFF3B0", "#FF9A1F"], { count: 24, speed: 300, size: 6, life: 0.7, gravity: 350 });
          this.ctx.sfx.streak(t.embers + 1);
          if (cash.gained) this.callouts.show(`${t.player.name} +1 LIFE!`, GOLD, { size: 60, life: 1.4, y: 0.3 });
          else small(`${t.player.name} HOT SPOT +1`, GOLD);
        }
        if (!t.safeEarly) {
          small(t.player.kind === "bot" ? `${t.player.name}: PHEW!` : "CLOSE!", t.player.color);
        }
      }
    }

    const names = fell.map((i) => this.tokens[i]!.player.name);
    const outNames = res.knockedOut.map((i) => this.tokens[i]!.player.name);
    if (this.replay) {
      this.resultText = "EVERYONE FELL! AGAIN!";
      this.resultColor = "#FFB020";
    } else if (fell.length === 0) {
      this.resultText = "ALL SAFE!";
      this.resultColor = "#B8FF3D";
    } else if (outNames.length > 0) {
      this.resultText = `${outNames.join(" & ")} ${outNames.length > 1 ? "ARE" : "IS"} TOAST!`;
      this.resultColor = "#FF3D7A";
    } else {
      this.resultText = `${names.join(" & ")} SINGED!`;
      this.resultColor = "#FF8A3D";
    }
    this.juice.hitStop(0.06);
    this.juice.shake(0.6);
    if (res.knockedOut.length > 0) this.juice.slowMo(0.35, 0.45);
    this.ctx.sfx.hit();
  }

  private afterDrop(): void {
    this.plays += 1;
    const alive = this.tokens.map((t) => t.alive);
    if ((!this.replay && matchOver(alive, this.plays)) || this.plays >= MAX_PLAYS) {
      this.endMatch();
      return;
    }
    this.phase = "result";
    this.timer = RESULT_S;
    this.callouts.show(this.resultText, this.resultColor, { size: 56, life: RESULT_S, y: 0.45 });
    if (this.replay) this.ctx.sfx.miss();
    else this.ctx.sfx.collect();
  }

  private standings(): Standing[] {
    return this.tokens.map((t) => ({ alive: t.alive, lives: t.lives, embers: t.embers, hauntings: t.hauntings, rank: t.rank }));
  }

  /** Survivors share the win (a lone survivor, or the one with the most lives and embers, takes it outright). */
  private endMatch(): void {
    const scores = finalScores(this.standings());
    const top = Math.max(...scores);
    const winners = this.tokens.filter((_, i) => scores[i] === top && this.tokens[i]!.alive);
    const text = winners.length === 0
      ? "NOBODY SURVIVED"
      : winners.length === 1 ? `${winners[0]!.player.name} WINS!` : winners.map((t) => t.player.name).join(" & ") + " SHARE IT!";
    this.callouts.show(text, winners.length === 1 ? winners[0]!.player.color : "#F4F7FB", {
      size: 72, life: FINAL_S + 0.5, y: 0.45,
    });
    for (const t of this.tokens) {
      if (t.player.kind !== "human" || t.survived <= 0) continue;
      if (saveBest(hotTiles.id, t.survived, BEST_VERSION)) {
        t.newBest = true;
        this.callouts.show(`${t.player.name} NEW RECORD: ${t.survived} ROUNDS`, "#B8FF3D", { size: 44, life: FINAL_S + 0.3, y: 0.62 });
      }
    }
    this.phase = "final";
    this.timer = FINAL_S;
    this.ctx.sfx.win();
  }

  /** Random free tiles for tokens that need a fresh spot. */
  private respawn(tokens: Token[]): void {
    const spots = shuffle(Array.from({ length: TILE_COUNT }, (_, i) => i), this.ctx.rng);
    const taken = new Set(this.tokens.filter((t) => t.alive && !tokens.includes(t)).map((t) => tileAtPoint(this.layout, t.x, t.y)));
    for (const t of tokens) {
      const spot = spots.find((s) => !taken.has(s)) ?? spots[0]!;
      taken.add(spot);
      const c = tileCenter(this.layout, spot);
      t.x = c.x;
      t.y = c.y;
      t.fall = -1;
      t.singed = false;
    }
  }

  private nextRound(): void {
    if (this.replay) {
      // Same difficulty, the survivors from before get back up on random tiles.
      this.respawn(this.tokens.filter((t) => t.alive));
    } else {
      this.roundIndex += 1;
      const back: Token[] = [];
      for (const t of this.tokens) {
        if (t.alive && t.singed) back.push(t);
        else if (!t.alive && canRevive(t.hauntings, t.revived, this.plays)) {
          t.alive = true;
          t.revived = true;
          t.lives = 1;
          t.embers = 0;
          back.push(t);
          this.callouts.show(`${t.player.name} RISES FROM THE LAVA!`, t.player.color, { size: 52, life: 1.6, y: 0.62 });
          this.ctx.sfx.streak(6);
        }
      }
      this.respawn(back);
      for (const t of back) {
        this.juice.burst(t.x, t.y, [t.player.color, ...LAVA_COLORS], { count: 18, speed: 240, size: 5, life: 0.6, gravity: 400 });
      }
    }
    this.plan = planRound(this.roundIndex, this.ctx.rng);
    this.dropping = false;
    this.riseT = 0;
    this.phase = "intro";
    this.timer = INTRO_S;
    for (let i = 0; i < TILE_COUNT; i++) {
      this.fuse[i] = 0;
      this.cursedBy[i] = -1;
    }
    for (const t of this.tokens) {
      t.safeEarly = false;
      t.ghostSpent = false;
      t.ghost = null;
    }
    if (this.plays >= MAX_PLAYS - 1) {
      this.callouts.show("LAST ROUND!", "#FF3D7A", { size: 80, life: INTRO_S + 0.3, y: 0.45 });
    } else if (this.roundIndex >= OVERDRIVE_ROUND && !this.overdriveShown) {
      this.overdriveShown = true;
      this.callouts.show("OVERDRIVE!", "#FF6A00", { size: 84, life: INTRO_S + 0.4, y: 0.45 });
      this.juice.shake(0.5);
    } else {
      this.callouts.show(`ROUND ${this.roundIndex + 1}`, "#F4F7FB", { size: 72, life: INTRO_S, y: 0.45 });
    }
    this.ctx.sfx.whoosh();
  }

  private stepFalls(dt: number): void {
    for (const t of this.tokens) {
      if (t.fall < 0) continue;
      t.fall += dt;
      if (!t.splashed && t.fall >= 0.38) {
        t.splashed = true;
        const y = t.y + this.fallOffset(t.fall);
        this.juice.burst(t.x, y, LAVA_COLORS, { count: 26, speed: 320, angle: -Math.PI / 2, spread: 1.6, gravity: 700, size: 6, life: 0.8 });
        this.juice.shake(0.25);
        this.ctx.sfx.miss();
      }
      if (t.fall > 1.4) {
        t.fall = -1;
        if (!t.alive) {
          t.ghostAge = 0;
          this.juice.burst(t.x, t.y, [GHOST_TINT, t.player.color], { count: 14, speed: 120, angle: -Math.PI / 2, spread: 1.2, gravity: -80, size: 5, life: 0.9 });
        }
      }
    }
  }

  private fallOffset(fall: number): number {
    const f = Math.min(fall, 0.38) / 0.38;
    return f * f * this.ctx.height * 0.12;
  }

  // ---------------------------------------------------------------- input

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private get draggable(): boolean {
    return this.phase === "wait" || this.phase === "call" || this.phase === "intro";
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.draggable) return;
    const p = this.toLogical(e);
    const grab = Math.max(this.ctx.minTap, this.radius * 2.2);
    let best = -1;
    let bestD = grab;
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (t.player.kind !== "human" || t.heldBy !== null || t.fall >= 0) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    e.preventDefault();
    this.drags.set(e.pointerId, best);
    this.tokens[best]!.heldBy = e.pointerId;
    try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
    this.ctx.sfx.select();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const i = this.drags.get(e.pointerId);
    if (i === undefined) return;
    const t = this.tokens[i]!;
    if (t.fall >= 0 || !this.draggable) return;
    e.preventDefault();
    const p = this.toLogical(e);
    t.x = p.x;
    t.y = p.y;
  };

  private readonly onUp = (e: PointerEvent): void => {
    const i = this.drags.get(e.pointerId);
    if (i === undefined) return;
    this.drags.delete(e.pointerId);
    const t = this.tokens[i]!;
    if (t.heldBy === e.pointerId) t.heldBy = null;
  };

  // ---------------------------------------------------------------- render

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    this.drawLava(g, width, height);
    this.juice.begin(g);
    this.drawTiles(g);
    this.drawTokens(g);
    this.drawGhosts(g);
    this.juice.end(g);
    this.drawBorder(g, width, height);
    this.drawHud(g, width);
    if (this.phase === "wait") this.drawDots(g, width, height);
    if (this.phase === "call") this.drawCall(g, width, height);
    this.callouts.draw(g, width, height);
  }

  /** The lava base is static, so it's painted once into an offscreen canvas; only bubbles and two glows move. */
  private drawLava(g: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.lavaCache) {
      try {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const cg = c.getContext("2d");
        if (cg) {
          const base = cg.createLinearGradient(0, 0, 0, height);
          base.addColorStop(0, "#4a0d06");
          base.addColorStop(0.5, "#7a1c08");
          base.addColorStop(1, "#3a0804");
          cg.fillStyle = base;
          cg.fillRect(0, 0, width, height);
          const r = Math.min(width, height) * 0.32;
          for (let k = 0; k < 7; k++) {
            const x = width * (0.5 + 0.48 * Math.sin(k * 1.9));
            const y = height * (0.5 + 0.46 * Math.cos(k * 2.4));
            const grad = cg.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, "rgba(255,150,30,0.45)");
            grad.addColorStop(0.5, "rgba(255,80,10,0.22)");
            grad.addColorStop(1, "rgba(255,60,0,0)");
            cg.fillStyle = grad;
            cg.fillRect(x - r, y - r, r * 2, r * 2);
          }
          this.lavaCache = c;
        }
      } catch {
        this.lavaCache = null;
      }
    }
    if (this.lavaCache) {
      g.drawImage(this.lavaCache, 0, 0);
    } else {
      g.fillStyle = "#6a1806";
      g.fillRect(0, 0, width, height);
    }
    // Two drifting glows keep the lava alive without repainting seven gradients a frame.
    const r = Math.min(width, height) * 0.2;
    const hot = this.roundIndex >= OVERDRIVE_ROUND ? 0.5 : 0.3;
    for (let k = 0; k < 2; k++) {
      const x = width * (0.5 + 0.42 * Math.sin(this.time * 0.35 + k * 2.6));
      const y = height * (0.5 + 0.4 * Math.cos(this.time * 0.27 + k * 1.7));
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,170,40,${hot})`);
      grad.addColorStop(1, "rgba(255,80,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = "rgba(255,210,90,0.5)";
    for (let k = 0; k < 10; k++) {
      const p = (this.time * 0.5 + k * 0.37) % 1;
      const x = ((k * 191) % width) + Math.sin(this.time + k) * 12;
      const y = height * (1 - p);
      g.globalAlpha = (1 - p) * 0.6;
      g.beginPath();
      g.arc(x, y, 3 + (k % 3) * 2, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr);
    g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
  }

  /** A tile face with its thickness underneath (painted once per colour into a sprite). */
  private paintTile(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hex: string): void {
    g.fillStyle = "rgba(20,5,0,0.55)";
    this.roundRect(g, x, y + 10, w, h, 14);
    g.fill();
    g.fillStyle = hex;
    this.roundRect(g, x, y, w, h, 14);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.18)";
    this.roundRect(g, x + 6, y + 6, w - 12, h * 0.3, 10);
    g.fill();
  }

  /** Twenty rounded-rect fills a frame are slow on a software canvas, so each colour is blitted from a sprite. */
  private ensureTileSprites(): HTMLCanvasElement[] | null {
    if (this.tileSprites) return this.tileSprites;
    try {
      const rect = tileRect(this.layout, 0);
      const w = Math.ceil(rect.w);
      const h = Math.ceil(rect.h);
      const out: HTMLCanvasElement[] = [];
      for (const col of TILE_COLORS) {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h + 10;
        const cg = c.getContext("2d");
        if (!cg) return null;
        this.paintTile(cg, 0, 0, rect.w, rect.h, col.hex);
        out.push(c);
      }
      this.tileSprites = out;
    } catch {
      return null;
    }
    return this.tileSprites;
  }

  private drawTiles(g: CanvasRenderingContext2D): void {
    const sprites = this.ensureTileSprites();
    const rise = this.riseT / RISE_S;
    const nowMs = this.phase === "call" ? this.callT * 1000 : this.phase === "intro" || this.phase === "wait" ? -1 : Number.POSITIVE_INFINITY;
    const called = nowMs >= 0;
    const color = called ? activeColor(this.plan, nowMs) : -1;
    const hot = called ? activeHotSpot(this.plan, nowMs) : -1;
    const labelSize = Math.max(12, Math.round(this.radius * 0.6));
    for (let i = 0; i < TILE_COUNT; i++) {
      const rect = tileRect(this.layout, i);
      const colorIdx = this.plan.tiles[i] ?? 0;
      const col = TILE_COLORS[colorIdx]!;
      const cursed = (this.cursedBy[i] ?? -1) >= 0;
      const matching = colorIdx === color && !cursed;
      let alpha = 1;
      let dy = 0;
      let scale = 1;
      if (this.dropping && (colorIdx !== finalColor(this.plan) || cursed)) {
        const t = Math.max(0, Math.min(1, (this.dropT - (this.dropDelay[i] ?? 0)) / 0.7));
        if (t >= 1) continue;
        alpha = 1 - t;
        dy = t * t * this.ctx.height * 0.5;
        scale = 1 - t * 0.35;
      } else if (rise < 1) {
        const e = 1 - (1 - rise) * (1 - rise);
        alpha = e;
        dy = (1 - e) * 160;
      }
      const fuse = this.fuse[i] ?? 0;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2 + dy;
      g.save();
      g.globalAlpha = alpha;
      g.translate(cx, cy);
      if (cursed && !this.dropping) {
        const j = Math.sin(this.time * 60) * 1.5;
        g.translate(j, -j);
      }
      g.scale(scale, scale);
      const sprite = sprites?.[colorIdx];
      if (sprite) g.drawImage(sprite, -rect.w / 2, -rect.h / 2);
      else this.paintTile(g, -rect.w / 2, -rect.h / 2, rect.w, rect.h, col.hex);
      if (called && matching) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 14);
        g.lineWidth = 6;
        g.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.55})`;
        this.roundRect(g, -rect.w / 2 + 3, -rect.h / 2 + 3, rect.w - 6, rect.h - 6, 12);
        g.stroke();
      }
      if (i === hot && !cursed) this.drawHotSpot(g, rect, labelSize);
      if (fuse > 0 || cursed) this.drawCracks(g, i, rect, cursed ? 1 : fuse, cursed, labelSize);
      g.restore();
    }
  }

  private drawHotSpot(g: CanvasRenderingContext2D, rect: { w: number; h: number }, labelSize: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    g.lineWidth = 7;
    g.strokeStyle = GOLD;
    this.roundRect(g, -rect.w / 2 + 8, -rect.h / 2 + 8, rect.w - 16, rect.h - 16, 10);
    g.stroke();
    g.globalAlpha *= 0.6 + pulse * 0.4;
    g.lineWidth = 3;
    g.strokeStyle = "#FFF3B0";
    this.roundRect(g, -rect.w / 2 + 14, -rect.h / 2 + 14, rect.w - 28, rect.h - 28, 8);
    g.stroke();
    // Three sparks orbit the rim.
    g.fillStyle = "#FFF3B0";
    for (let k = 0; k < 3; k++) {
      const a = this.time * 3 + (k * Math.PI * 2) / 3;
      const sx = Math.cos(a) * (rect.w / 2 - 10);
      const sy = Math.sin(a) * (rect.h / 2 - 10);
      g.beginPath();
      g.arc(sx, sy, 4 + pulse * 2, 0, Math.PI * 2);
      g.fill();
    }
    g.font = `700 ${labelSize}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 4;
    g.strokeStyle = "rgba(7,11,20,0.75)";
    g.strokeText("HOT SPOT", 0, rect.h / 2 - labelSize * 0.9);
    g.fillStyle = GOLD;
    g.fillText("HOT SPOT", 0, rect.h / 2 - labelSize * 0.9);
  }

  private drawCracks(g: CanvasRenderingContext2D, i: number, rect: { w: number; h: number }, amount: number, armed: boolean, labelSize: number): void {
    g.fillStyle = `rgba(20,0,30,${amount * 0.45})`;
    this.roundRect(g, -rect.w / 2, -rect.h / 2, rect.w, rect.h, 14);
    g.fill();
    const lines = this.cracks[i] ?? [];
    const reach = amount;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const pass of [0, 1]) {
      g.lineWidth = pass === 0 ? 7 : 3;
      g.strokeStyle = pass === 0 ? "rgba(10,0,15,0.8)" : armed ? `rgba(255,${120 + Math.round(80 * Math.abs(Math.sin(this.time * 12)))},40,1)` : "rgba(230,200,255,0.9)";
      g.beginPath();
      let k = 0;
      let pen = false;
      for (const p of lines) {
        if (Number.isNaN(p.x)) {
          pen = false;
          k = 0;
          continue;
        }
        if (k / 4 > reach) {
          k += 1;
          continue;
        }
        if (!pen) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
        pen = true;
        k += 1;
      }
      g.stroke();
    }
    if (armed) {
      g.font = `700 ${labelSize}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.75)";
      g.strokeText("CURSED", 0, -rect.h / 2 + labelSize * 0.9);
      g.fillStyle = "#FF8A3D";
      g.fillText("CURSED", 0, -rect.h / 2 + labelSize * 0.9);
    }
  }

  private drawLifePips(g: CanvasRenderingContext2D, x: number, y: number, lives: number, embers: number, r: number): void {
    const gap = r * 2.4;
    const start = x - ((lives - 1) * gap) / 2;
    for (let k = 0; k < lives; k++) {
      const px = start + k * gap;
      g.fillStyle = "#FF6A00";
      g.beginPath();
      g.moveTo(px, y - r * 1.3);
      g.quadraticCurveTo(px + r * 1.1, y - r * 0.2, px, y + r);
      g.quadraticCurveTo(px - r * 1.1, y - r * 0.2, px, y - r * 1.3);
      g.fill();
      g.fillStyle = "#FFE28A";
      g.beginPath();
      g.arc(px, y + r * 0.25, r * 0.4, 0, Math.PI * 2);
      g.fill();
    }
    if (embers > 0) {
      g.fillStyle = GOLD;
      for (let k = 0; k < embers; k++) {
        g.beginPath();
        g.arc(x + (k - (embers - 1) / 2) * r * 1.6, y + r * 2.2, r * 0.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawTokens(g: CanvasRenderingContext2D): void {
    for (const t of this.tokens) {
      if (!t.alive && t.fall < 0) continue;
      let scale = t.heldBy !== null ? 1.12 : 1;
      let alpha = 1;
      let dy = 0;
      let sink = 0;
      if (t.fall >= 0) {
        dy = this.fallOffset(t.fall);
        if (t.fall > 0.38) {
          sink = Math.min(1, (t.fall - 0.38) / 0.7);
          scale = 1 - sink * 0.8;
          alpha = 1 - sink;
        }
      }
      g.save();
      g.globalAlpha = alpha;
      g.translate(t.x, t.y + dy);
      g.scale(scale, scale);
      // Shadow on the tile.
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath();
      g.ellipse(0, this.radius * 0.9, this.radius * 1.05, this.radius * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      // Contrast ring so tokens read on every tile colour.
      g.lineWidth = 5;
      g.strokeStyle = t.lives === 1 && t.alive ? "#FF3D7A" : "#F4F7FB";
      g.beginPath();
      g.arc(0, 0, this.radius + 3, 0, Math.PI * 2);
      g.stroke();
      drawPlayerOrb(g, 0, 0, this.radius, t.player);
      if (t.fall < 0) this.drawLifePips(g, 0, -this.radius - this.radius * 0.55, t.lives, t.embers, this.radius * 0.26);
      if (sink > 0) {
        g.fillStyle = `rgba(255,120,20,${sink * 0.8})`;
        g.beginPath();
        g.arc(0, 0, this.radius + 4, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  private drawGhostShape(g: CanvasRenderingContext2D, r: number, color: string, alpha: number): void {
    g.save();
    g.globalAlpha *= alpha;
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, -r * 0.1, r, Math.PI, 0);
    g.lineTo(r, r * 0.8);
    for (let k = 0; k < 3; k++) {
      const x1 = r - (k + 0.5) * (r * 2 / 3);
      const x2 = r - (k + 1) * (r * 2 / 3);
      g.quadraticCurveTo(x1, r * 1.25, x2, r * 0.8);
    }
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.arc(-r * 0.3, -r * 0.4, r * 0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1a0a24";
    g.beginPath();
    g.ellipse(-r * 0.32, -r * 0.1, r * 0.17, r * 0.26, 0, 0, Math.PI * 2);
    g.ellipse(r * 0.32, -r * 0.1, r * 0.17, r * 0.26, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawGhosts(g: CanvasRenderingContext2D): void {
    for (const t of this.tokens) {
      if (t.alive || t.fall >= 0) continue;
      const bob = Math.sin(this.time * 3 + t.player.slot) * this.radius * 0.12;
      const appear = Math.min(1, t.ghostAge / 0.5);
      const r = this.radius * (0.7 + 0.4 * appear) * (t.heldBy !== null ? 1.12 : 1);
      g.save();
      g.translate(t.x, t.y + bob - (1 - appear) * 30);
      g.lineWidth = 3;
      g.strokeStyle = `rgba(201,240,255,${0.5 * appear})`;
      g.beginPath();
      g.arc(0, -r * 0.1, r + 4, 0, Math.PI * 2);
      g.stroke();
      this.drawGhostShape(g, r, t.ghostSpent ? "#8a8fa3" : t.player.color, (t.ghostSpent ? 0.4 : 0.75) * appear);
      // Fuse ring while cursing.
      const tile = tileAtPoint(this.layout, t.x, t.y);
      const fuse = tile >= 0 ? (this.fuse[tile] ?? 0) : 0;
      if (!t.ghostSpent && fuse > 0 && fuse < 1) {
        g.lineWidth = 6;
        g.strokeStyle = "#FF8A3D";
        g.beginPath();
        g.arc(0, -r * 0.1, r + 9, -Math.PI / 2, -Math.PI / 2 + fuse * Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }

  private drawBorder(g: CanvasRenderingContext2D, width: number, height: number): void {
    const overdrive = this.roundIndex >= OVERDRIVE_ROUND;
    const calling = this.phase === "call" || this.phase === "drop";
    if (!calling && !overdrive) return;
    const nowMs = this.phase === "call" ? this.callT * 1000 : Number.POSITIVE_INFINITY;
    const col = calling ? TILE_COLORS[activeColor(this.plan, nowMs)]!.hex : "#FF6A00";
    const flash = this.phase === "call"
      ? 0.45 + 0.55 * Math.abs(Math.sin(this.time * 16))
      : overdrive && !calling ? 0.25 + 0.2 * Math.abs(Math.sin(this.time * 6)) : 0.4;
    const lw = Math.round(Math.min(width, height) * 0.035);
    g.save();
    g.strokeStyle = col;
    // Layered strokes instead of shadowBlur: the same glow at a fraction of the cost.
    for (const [mul, a] of [[2.4, 0.12], [1.7, 0.2], [1, 0.9]] as const) {
      g.globalAlpha = flash * a;
      g.lineWidth = lw * mul;
      g.strokeRect(lw / 2, lw / 2, width - lw, height - lw);
    }
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D, width: number): void {
    const hud = this.layout.y;
    g.save();
    if (this.phase === "call") drawTimerBar(g, width, this.plan.windowMs - this.callT * 1000, this.plan.windowMs);
    g.font = `700 ${Math.round(hud * 0.42)}px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    const overdrive = this.roundIndex >= OVERDRIVE_ROUND;
    const label = `ROUND ${this.roundIndex + 1}${overdrive ? "  OVERDRIVE" : ""}`;
    g.strokeText(label, 20, hud * 0.56);
    g.fillStyle = overdrive ? "#FF8A3D" : "#F4F7FB";
    g.fillText(label, 20, hud * 0.56);

    const r = Math.max(10, hud * 0.2);
    let x = width - 20 - r;
    const cy = hud * 0.42;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i]!;
      if (t.alive) {
        drawPlayerOrb(g, x, cy, r, t.player);
        this.drawLifePips(g, x, cy + r * 1.8, t.lives, t.embers, r * 0.3);
      } else {
        g.save();
        g.translate(x, cy);
        this.drawGhostShape(g, r, t.player.color, 0.7);
        g.restore();
        if (t.hauntings > 0) {
          g.font = `700 ${Math.round(r * 1.1)}px ${FONT}`;
          g.textAlign = "center";
          g.fillStyle = GHOST_TINT;
          g.fillText(`${t.hauntings}/2`, x, cy + r * 1.9);
        }
      }
      x -= r * 2.8;
    }
    g.restore();
  }

  private drawDots(g: CanvasRenderingContext2D, width: number, height: number): void {
    const n = 1 + Math.floor(((WAIT_S - this.timer) / WAIT_S) * 3);
    g.save();
    g.font = `700 ${Math.round(Math.min(width, height) * 0.2)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const text = ".".repeat(Math.max(1, Math.min(3, n)));
    g.strokeText(text, width / 2, height * 0.5);
    g.fillStyle = "#F4F7FB";
    g.fillText(text, width / 2, height * 0.5);
    g.restore();
  }

  /** The called colour, drawn by the game (not Callouts) so a switch can replace it mid-window. */
  private drawCall(g: CanvasRenderingContext2D, width: number, height: number): void {
    const nowMs = this.callT * 1000;
    const col = TILE_COLORS[activeColor(this.plan, nowMs)]!;
    const since = this.switched ? (nowMs - this.plan.switchAtMs) / 1000 : this.callT;
    const pop = since < 0.12 ? 0.6 + (since / 0.12) * 0.55 : since < 0.22 ? 1.15 - ((since - 0.12) / 0.1) * 0.15 : 1;
    const left = (this.plan.windowMs - nowMs) / 1000;
    const alpha = Math.min(1, left / 0.3);
    const size = Math.round(Math.min(width, height) * 0.21);
    g.save();
    g.globalAlpha = alpha;
    g.translate(width / 2, height * 0.5);
    g.scale(pop, pop);
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const text = `${col.name}!`;
    const tw = g.measureText(text).width;
    // Dark pill behind the word so it reads on tiles of its own colour.
    g.fillStyle = "rgba(7,11,20,0.62)";
    this.roundRect(g, -tw / 2 - size * 0.25, -size * 0.5, tw + size * 0.5, size, size * 0.3);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.9)";
    g.strokeText(text, 0, 0);
    g.fillStyle = col.hex;
    g.fillText(text, 0, 0);
    g.restore();
    if (this.switchFlash > 0) {
      g.save();
      g.globalAlpha = this.switchFlash * 0.5;
      g.fillStyle = "#F4F7FB";
      g.fillRect(0, 0, width, height);
      g.restore();
    }
  }

  // ---------------------------------------------------------------- lifecycle

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    const scores = finalScores(this.standings());
    return this.tokens.map((t, i) => ({ playerId: t.player.id, score: scores[i]! }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const t of this.tokens) {
      out.push({ playerId: t.player.id, label: "Rounds survived", value: t.newBest ? `${t.survived} (new best)` : String(t.survived) });
      out.push({ playerId: t.player.id, label: "Hot Spots", value: String(t.embersTotal) });
      out.push({ playerId: t.player.id, label: "Hauntings", value: String(t.hauntings) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    this.drags.clear();
  }
}
