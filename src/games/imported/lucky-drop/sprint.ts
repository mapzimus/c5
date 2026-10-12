import { PLAYER_BINDS } from "../../../core/input";
import { Rng } from "../../../core/rng";
import type { GameContext, GameInstance, GameStat, Player } from "../../../core/types";
import { Callouts, Juice, loadBest, saveBest } from "../../../fx/juice";
import { fillArena } from "../../../core/draw";
import { UI, display, drawOrb, label } from "./draw";
import { BOARD, COLORS, DropWorld, RADII } from "./physics";
import {
  SPRINT, STAGES, SharedDeck, beatLength, botBeat, botWantsShake, bustPenalty, clockText, isOverdrive, layout,
  shakeCost, stageIndex, type Layout,
} from "./sprint-rules";

const GAME_ID = "lucky-drop";
const LIME = UI.lime;

interface Floater { x: number; y: number; text: string; color: string; life: number; size: number }

interface Pane {
  readonly index: number;
  readonly player: Player;
  readonly shakes: Rng;
  world: DropWorld;
  /** Points kept from boards that busted. Total = banked + world.score. */
  banked: number;
  busts: number;
  bestChain: number;
  topTier: number;
  aim: number;
  accumulator: number;
  /** Dropped during the current beat. */
  dropped: boolean;
  pointerId: number | null;
  pendingDrop: boolean;
  botPlanned: boolean;
  botWait: number;
  botAim: number;
  pulse: number;
  bustFlash: number;
  worstDanger: number;
  floaters: Floater[];
}

/**
 * Lucky Drop Sprint: the party mode. Every seat plays at once on its own board for
 * 90 seconds. One shared deck, one shared beat: each beat, everyone gets the same orb
 * and chooses where it goes; when the beat ends the undecided drop where they aim.
 * Overflow is a BUST (−25% of that board, fresh board, keep playing). The last 20
 * seconds are OVERDRIVE at ×2. Three seconds of settling after the last beat, then
 * the highest total wins.
 */
export class LuckyDropSprint implements GameInstance {
  private readonly seed: number;
  private readonly deck: SharedDeck;
  private readonly bots: Rng;
  private readonly panes: Pane[];
  private readonly lay: Layout;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: "play" | "settle" | "final" | "done" = "play";
  /** Sprint seconds elapsed. */
  private t = 0;
  private beatElapsed = 0;
  private beatIndex = 0;
  private beatPulse = 0;
  private settleLeft = 0;
  private stage = 0;
  private flash = 0;
  private lastTick = -1;
  private leader: Pane | null = null;
  private leadAnnounced = -10;
  private best = 0;
  private readonly records = new Set<string>();
  private readonly oldTouchAction: string;

  constructor(private readonly ctx: GameContext) {
    this.seed = ctx.rng.int(1, 0x7fffffff);
    const deckRng = new Rng(this.seed);
    this.deck = new SharedDeck(() => deckRng.next(), () => this.t);
    this.bots = new Rng(this.seed ^ 0x2545f491);
    this.juice = new Juice(() => this.bots.next());
    this.lay = layout(ctx.players.length, ctx.width, ctx.height, ctx.minTap);
    this.panes = ctx.players.map((player, index) => this.makePane(player, index));
    this.best = loadBest(GAME_ID, SPRINT.bestVersion);
    this.oldTouchAction = ctx.canvas.style.touchAction;
    ctx.canvas.style.touchAction = "none";
    ctx.canvas.addEventListener("pointerdown", this.pointerDown);
    ctx.canvas.addEventListener("pointermove", this.pointerMove);
    ctx.canvas.addEventListener("pointerup", this.pointerUp);
    ctx.canvas.addEventListener("pointercancel", this.pointerUp);
    this.callouts.show("SAME ORBS · SAME BEAT · 90 SECONDS", LIME, { size: 44, y: 0.5, life: 2 });
  }

  private makePane(player: Player, index: number): Pane {
    const shakes = new Rng(this.seed ^ ((index + 1) * 0x9e3779b9));
    const pane: Pane = {
      index, player, shakes, world: null as unknown as DropWorld, banked: 0, busts: 0, bestChain: 0, topTier: 0,
      aim: 240, accumulator: 0, dropped: false, pointerId: null, pendingDrop: false, botPlanned: false, botWait: 1,
      botAim: 240, pulse: 0, bustFlash: 0, worstDanger: 0, floaters: [],
    };
    pane.world = this.newWorld(pane, 0);
    return pane;
  }

  /** A board fed from the shared deck, starting at deck index `base`. */
  private newWorld(pane: Pane, base: number): DropWorld {
    const world = new DropWorld(() => 0.5, () => pane.shakes.next(), i => this.deck.at(base + i));
    world.dangerLimit = SPRINT.dangerLimit;
    world.dangerLine = SPRINT.dangerLine;
    world.multiplier = STAGES[this.stage]!.multiplier;
    return world;
  }

  private total(pane: Pane): number {
    return pane.banked + pane.world.score;
  }

  private leaderScore(): number {
    return Math.max(...this.panes.map(p => this.total(p)));
  }

  private cost(pane: Pane): number {
    return shakeCost(this.total(pane), this.leaderScore());
  }

  // ---- input -------------------------------------------------------------

  private point(event: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * this.ctx.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * this.ctx.height / Math.max(1, rect.height) };
  }

  private paneAt(p: { x: number; y: number }): Pane | undefined {
    const { xs, boardW, top, boardY, boardH, footerH } = this.lay;
    return this.panes.find(pane => p.x >= xs[pane.index]! && p.x <= xs[pane.index]! + boardW && p.y >= top && p.y <= boardY + boardH + footerH);
  }

  private onShake(p: { x: number; y: number }): boolean {
    return p.y >= this.lay.boardY + this.lay.boardH + 6;
  }

  private boardX(pane: Pane, x: number): number {
    return pane.world.clampAim((x - this.lay.xs[pane.index]!) / this.lay.scale);
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (this.phase !== "play") return;
    const p = this.point(event);
    const pane = this.paneAt(p);
    if (!pane || pane.player.kind !== "human") return;
    event.preventDefault();
    if (this.onShake(p)) { this.shake(pane); return; }
    if (pane.pointerId !== null) return;
    pane.pointerId = event.pointerId;
    pane.aim = this.boardX(pane, p.x);
    try { this.ctx.canvas.setPointerCapture(event.pointerId); } catch { /* optional */ }
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    const pane = this.panes.find(p => p.pointerId === event.pointerId);
    if (pane) pane.aim = this.boardX(pane, this.point(event).x);
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    const pane = this.panes.find(p => p.pointerId === event.pointerId);
    if (!pane) return;
    pane.pointerId = null;
    if (event.type === "pointerup") {
      pane.aim = this.boardX(pane, this.point(event).x);
      pane.pendingDrop = true;
    }
  };

  // ---- loop --------------------------------------------------------------

  update(dt: number): void {
    if (this.phase === "done") return;
    dt = Math.min(dt, 0.05);
    const simDt = this.juice.update(dt);
    this.callouts.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.beatPulse = Math.max(0, this.beatPulse - dt * 5);
    for (const pane of this.panes) {
      pane.pulse = Math.max(0, pane.pulse - dt * 4);
      pane.bustFlash = Math.max(0, pane.bustFlash - dt * 1.5);
      for (const f of pane.floaters) { f.life -= dt; f.y -= dt * 26; }
      pane.floaters = pane.floaters.filter(f => f.life > 0);
    }

    if (this.phase === "play") {
      this.t += dt;
      const stage = stageIndex(this.t);
      if (stage > this.stage) this.stageUp(stage);
      const left = SPRINT.duration - this.t;
      const whole = Math.ceil(left);
      if (left <= 5 && whole !== this.lastTick) { this.lastTick = whole; this.ctx.sfx.countdown(); }
      if (this.t >= 80 && this.t - dt < 80) this.callouts.show("10 SECONDS", UI.warn, { size: 48, y: 0.5, life: 1 });
      this.beatElapsed += dt;
      for (const pane of this.panes) this.seatInput(pane, dt);
      if (this.t >= SPRINT.duration) {
        this.endBeat();
        this.phase = "settle";
        this.settleLeft = SPRINT.settle;
        for (const pane of this.panes) pane.pointerId = null;
        this.callouts.show("TIME! SETTLING…", LIME, { size: 56, y: 0.5, life: 1.6 });
        this.ctx.sfx.go();
      } else if (this.beatElapsed >= beatLength(this.t) ||
        (this.beatElapsed >= SPRINT.minBeat && this.panes.every(p => p.dropped))) {
        this.endBeat();
      }
    } else if (this.phase === "settle") {
      this.settleLeft -= dt;
      if (this.settleLeft <= 0) this.finish();
    } else {
      // A beat for the winner and any new record before C5 takes over.
      this.settleLeft -= dt;
      if (this.settleLeft <= 0) { this.phase = "done"; return; }
    }

    for (const pane of this.panes) this.simulate(pane, simDt);
    this.trackLead();
  }

  private seatInput(pane: Pane, dt: number): void {
    const { player, world } = pane;
    if (player.kind === "bot") {
      pane.pendingDrop = false;
      if (!pane.botPlanned) {
        const plan = botBeat(world, this.t, () => this.bots.next());
        pane.botPlanned = true;
        pane.botWait = plan.wait;
        pane.botAim = plan.aim;
      }
      // Slide toward the planned spot so the bot visibly "thinks".
      pane.aim += (pane.botAim - pane.aim) * Math.min(1, dt * 7);
      if (!pane.dropped && this.beatElapsed >= pane.botWait) {
        pane.aim = pane.botAim;
        if (botWantsShake(world, this.cost(pane), () => this.bots.next())) this.shake(pane);
        this.drop(pane);
      }
      return;
    }
    const input = this.ctx.input;
    const bind = PLAYER_BINDS[player.slot]!;
    const axis = input.axis(player.slot).x;
    if (axis) pane.aim = world.clampAim(pane.aim + axis * dt * 300);
    if (pane.pendingDrop || input.actionPressed(player.slot)) this.drop(pane);
    if (input.justPressed(bind.down)) this.shake(pane);
    pane.pendingDrop = false;
  }

  /** Everyone who has not dropped drops where they aim; the next beat starts at once. */
  private endBeat(): void {
    for (const pane of this.panes) if (!pane.dropped) this.drop(pane);
    this.beatIndex++;
    this.beatElapsed = 0;
    this.beatPulse = 1;
    for (const pane of this.panes) { pane.dropped = false; pane.botPlanned = false; }
  }

  private drop(pane: Pane): void {
    if (pane.dropped || !pane.world.drop(pane.aim)) return;
    pane.dropped = true;
    this.ctx.sfx.tick();
  }

  private shake(pane: Pane): void {
    if (!pane.world.shake(this.cost(pane))) return;
    this.ctx.sfx.hit();
    this.juice.shake(0.15);
    pane.floaters.push({ x: 240, y: 200, text: "SHAKE!", color: pane.player.color, life: 0.8, size: 36 });
  }

  private stageUp(stage: number): void {
    this.stage = stage;
    const next = STAGES[stage]!;
    for (const pane of this.panes) pane.world.multiplier = next.multiplier;
    const hot = next.multiplier > 1;
    this.callouts.show(hot ? "OVERDRIVE ×2" : next.name, hot ? UI.hot : LIME, { size: hot ? 72 : 56, y: 0.42, life: 1.8 });
    if (next.news) this.callouts.show(next.news, "#ffb478", { size: 30, y: 0.52, life: 1.8 });
    this.flash = 1;
    this.juice.shake(hot ? 0.45 : 0.25);
    this.ctx.sfx.win();
  }

  private simulate(pane: Pane, simDt: number): void {
    const { world, player } = pane;
    const sx = (x: number) => this.lay.xs[pane.index]! + x * this.lay.scale;
    const sy = (y: number) => this.lay.boardY + y * this.lay.scale;
    pane.accumulator += simDt;
    while (pane.accumulator >= 1 / 120) {
      world.step(1 / 120);
      pane.accumulator -= 1 / 120;
    }
    for (const event of world.events) {
      if (event.type === "merge") {
        const color = COLORS[event.tier];
        pane.floaters.push({ x: event.x, y: event.y, text: `+${event.points}`, color, life: 1, size: 30 });
        this.ctx.sfx.streak(event.chain);
        const t = event.tier;
        this.juice.burst(sx(event.x), sy(event.y), [color, "#ffffff"], { count: 6 + t * 3, speed: (140 + t * 28) * this.lay.scale, size: 3 + t * 0.5, life: 0.45 + t * 0.04, gravity: 380 });
        if (t >= 7) this.juice.shake(0.2 + (t - 7) * 0.06);
        if (event.chain === 3) pane.floaters.push({ x: 240, y: 250, text: "CHAIN ×3!", color: UI.warn, life: 0.9, size: 44 });
        else if (event.chain === 5) this.callouts.show(`${player.name}: MAX CHAIN ×5!`, COLORS[8], { size: 56, y: 0.45, life: 1.2 });
        if (player.kind === "bot" && event.chain === 3) pane.floaters.push({ x: 240, y: 150, text: "ha!", color: player.color, life: 1, size: 26 });
      } else if (event.type === "burst") {
        pane.floaters.push({ x: 240, y: 300, text: `${2 ** event.tier}! +${event.bonus.toLocaleString()}`, color: COLORS[event.tier], life: 2, size: 36 });
        this.callouts.show(`${player.name} MAKES ${2 ** event.tier}!`, COLORS[event.tier], { size: 56, y: 0.45, life: 1.4 });
        this.juice.burst(sx(event.x), sy(event.y), [COLORS[event.tier], LIME, "#ffffff"], { count: 40 + (event.tier - 7) * 10, speed: 420 * this.lay.scale, size: 7, life: 1.1 });
        this.juice.shake(0.4);
        this.juice.hitStop(0.05);
        this.ctx.sfx.win();
      }
    }
    world.events = [];
    pane.bestChain = Math.max(pane.bestChain, world.maxChain);
    pane.topTier = Math.max(pane.topTier, world.topTier);

    // Heartbeat while an orb sits above the line; "SO CLOSE" when it recovers.
    if (world.danger > 0.1 && Math.floor(world.time * 3) !== Math.floor((world.time - simDt) * 3)) { pane.pulse = 1; this.ctx.sfx.tick(); }
    pane.worstDanger = Math.max(pane.worstDanger, world.danger);
    if (pane.worstDanger >= 1.4 && world.danger <= 0.05 && !world.over) {
      pane.worstDanger = 0;
      pane.floaters.push({ x: 240, y: 180, text: "SO CLOSE!", color: LIME, life: 1.1, size: 40 });
      this.ctx.sfx.collect();
    }
    if (world.over && this.phase === "play") this.bust(pane);
  }

  /** Overflow in Sprint: lose a quarter of this board's points, start over, keep playing. */
  private bust(pane: Pane): void {
    const { world, player } = pane;
    const penalty = bustPenalty(world.score);
    pane.banked += world.score - penalty;
    pane.busts++;
    const sx = (x: number) => this.lay.xs[pane.index]! + x * this.lay.scale;
    const sy = (y: number) => this.lay.boardY + y * this.lay.scale;
    for (const ball of world.balls) {
      this.juice.burst(sx(ball.x), sy(ball.y), [COLORS[ball.tier], UI.hot], { count: 3 + ball.tier * 2, speed: 320 * this.lay.scale, size: 4 + ball.tier, life: 0.9 });
    }
    this.juice.shake(0.5);
    this.juice.hitStop(0.06);
    this.ctx.sfx.miss();
    pane.bustFlash = 1;
    pane.worstDanger = 0;
    pane.floaters.push({ x: 240, y: 300, text: `BUST −${penalty.toLocaleString()}`, color: UI.hot, life: 2, size: 46 });
    if (player.kind === "bot") pane.floaters.push({ x: 240, y: 360, text: "oops", color: player.color, life: 1.5, size: 26 });
    this.callouts.show(`${player.name} BUSTS!`, UI.hot, { size: 48, y: 0.5, life: 1.1 });
    pane.world = this.newWorld(pane, world.drops);
    pane.accumulator = 0;
  }

  private trackLead(): void {
    if (this.panes.length < 2 || this.t < 8) return;
    const top = this.leaderScore();
    const leaders = this.panes.filter(p => this.total(p) === top);
    const lead = leaders.length === 1 ? leaders[0]! : null;
    if (lead && lead !== this.leader && top > 0) {
      if (this.leader && this.t - this.leadAnnounced > 6 && this.phase === "play") {
        this.leadAnnounced = this.t;
        this.callouts.show(`${lead.player.name} TAKES THE LEAD`, lead.player.color, { size: 40, y: 0.56, life: 1 });
        if (lead.player.kind === "bot") lead.floaters.push({ x: 240, y: 150, text: "mine!", color: lead.player.color, life: 1, size: 26 });
      }
      this.leader = lead;
    }
  }

  private finish(): void {
    this.phase = "final";
    this.settleLeft = 1.4;
    const top = this.leaderScore();
    const winners = this.panes.filter(pane => this.total(pane) === top);
    if (this.panes.length > 1) {
      const winner = winners.length === 1 ? winners[0]! : null;
      this.callouts.show(winner ? `${winner.player.name} WINS` : "TIE!", winner?.player.color ?? LIME, { size: 72, y: 0.42, life: 1.4 });
      if (winner) {
        const cx = this.lay.xs[winner.index]! + this.lay.boardW / 2, cy = this.lay.boardY + this.lay.boardH / 2;
        this.juice.burst(cx, cy, [winner.player.color, LIME, "#ffffff"], { count: 70, speed: 460, size: 7, life: 1.2 });
      }
      this.ctx.sfx.win();
    }
    for (const pane of this.panes) {
      if (pane.player.kind !== "human") continue;
      const score = this.total(pane);
      if (score > 0 && saveBest(GAME_ID, score, SPRINT.bestVersion) && this.best > 0) {
        this.records.add(pane.player.id);
        this.callouts.show(`NEW RECORD · ${pane.player.name}`, LIME, { size: 48, y: 0.56, life: 1.4 });
        this.ctx.sfx.win();
      }
    }
  }

  isFinished(): boolean { return this.phase === "done"; }

  getScores(): { playerId: string; score: number }[] {
    return this.panes.map(pane => ({ playerId: pane.player.id, score: this.total(pane) }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const pane of this.panes) {
      out.push({ playerId: pane.player.id, label: "Biggest orb", value: String(2 ** pane.topTier) });
      out.push({ playerId: pane.player.id, label: "Longest chain", value: `×${pane.bestChain}` });
      out.push({ playerId: pane.player.id, label: "Busts", value: String(pane.busts) });
      if (this.records.has(pane.player.id)) out.push({ playerId: pane.player.id, label: "Record", value: "NEW BEST" });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.ctx.canvas.removeEventListener("pointermove", this.pointerMove);
    this.ctx.canvas.removeEventListener("pointerup", this.pointerUp);
    this.ctx.canvas.removeEventListener("pointercancel", this.pointerUp);
    this.ctx.canvas.style.touchAction = this.oldTouchAction;
  }

  // ---- drawing -----------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    g.save();
    fillArena(g, this.ctx.width, this.ctx.height);
    g.translate(this.juice.offsetX, this.juice.offsetY);
    for (const pane of this.panes) this.drawPane(g, pane);
    this.juice.drawParticles(g);
    g.restore();
    this.drawStrip(g);
    if (this.flash > 0) {
      const hot = isOverdrive(this.t);
      g.fillStyle = hot ? `rgba(255,61,122,${(0.22 * this.flash).toFixed(3)})` : `rgba(184,255,61,${(0.22 * this.flash).toFixed(3)})`;
      g.fillRect(0, 0, this.ctx.width, this.ctx.height);
    }
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
  }

  /** Shared strip: sprint clock with stage markers, the on-deck orb and the beat ring. */
  private drawStrip(g: CanvasRenderingContext2D): void {
    const W = this.ctx.width;
    const hot = isOverdrive(this.t);
    const left = Math.max(0, SPRINT.duration - this.t);
    // Progress bar with stage markers: the curve is visible from the start.
    g.fillStyle = UI.line; g.fillRect(40, 8, W - 80, 6);
    g.fillStyle = hot ? UI.hot : LIME; g.fillRect(40, 8, (W - 80) * Math.min(1, this.t / SPRINT.duration), 6);
    for (const stage of STAGES.slice(1)) {
      const x = 40 + (W - 80) * stage.at / SPRINT.duration;
      g.fillStyle = stage.multiplier > 1 ? UI.hot : UI.muted;
      g.fillRect(x - 1, 4, 2, 14);
    }
    display(g, "SPRINT", 40, 54, 30, LIME);
    label(g, this.phase !== "play" ? "SETTLING" : hot ? "OVERDRIVE · EVERY MERGE ×2" : STAGES[this.stage]!.name, 40, 78, 15, hot ? UI.hot : UI.muted);
    // Clock.
    const urgent = left <= 10 && this.phase === "play";
    const size = urgent ? 62 + 8 * Math.abs(Math.sin(this.t * 6)) : 62;
    display(g, this.phase === "play" ? clockText(left) : "0:00", W / 2, 72, size, urgent || hot ? UI.hot : UI.text, "center");
    // On deck: the same orb for everyone, with the beat ring draining around it.
    const ox = W / 2 + 200, oy = 56;
    label(g, "ON DECK · SAME FOR ALL", ox + 40, 32, 12, UI.muted);
    if (this.phase === "play") {
      const beat = beatLength(this.t);
      const frac = Math.max(0, 1 - this.beatElapsed / beat);
      g.strokeStyle = UI.line; g.lineWidth = 4;
      g.beginPath(); g.arc(ox, oy, 30, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = frac < 0.25 ? UI.hot : hot ? UI.hot : LIME;
      g.lineWidth = 4 + this.beatPulse * 4;
      g.beginPath(); g.arc(ox, oy, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke();
      drawOrb(g, ox, oy, this.deck.at(this.beatIndex), 1, 22 + this.beatPulse * 4, false);
      const radii = [14, 12, 10];
      radii.forEach((r, i) => drawOrb(g, ox + 60 + i * 40, oy + 8, this.deck.at(this.beatIndex + 1 + i), 0.75 - i * 0.2, r, false));
    }
    const bestText = this.best > 0 ? `BEST ${this.best.toLocaleString()}` : "FIRST SPRINT";
    label(g, bestText, W - 40, 54, 15, UI.muted, "right");
    label(g, `BEAT ${this.beatIndex + 1}`, W - 40, 78, 13, UI.dim, "right");
  }

  private drawPane(g: CanvasRenderingContext2D, pane: Pane): void {
    const { world, player } = pane;
    const { xs, boardW, boardH, top, headerH, footerH, boardY, scale } = this.lay;
    const x = xs[pane.index]!;
    const total = this.total(pane);
    const leading = this.panes.length > 1 && total > 0 && total === this.leaderScore() && this.panes.filter(p => this.total(p) === total).length === 1;
    const small = scale < 0.7;

    // Header: name and running total.
    g.save();
    g.translate(x, top);
    display(g, player.name.toUpperCase(), 6, 30, small ? 20 : 24, player.color);
    display(g, total.toLocaleString(), boardW - 6, headerH - 8, small ? 26 : 32, leading ? LIME : UI.text, "right");
    if (leading && !small) label(g, "LEAD", boardW - 6, 12, 11, LIME, "right");
    if (world.time - world.lastMerge < 1.5 && world.chain > 1) {
      const chain = world.chain;
      display(g, `×${chain}`, boardW / 2, headerH - 8, 24 + chain * 3, chain >= 5 ? COLORS[8] : chain >= 3 ? UI.warn : LIME, "center");
    }
    g.restore();

    // Board (scaled).
    g.save();
    g.translate(x, boardY);
    g.scale(scale, scale);
    g.fillStyle = UI.panel;
    g.beginPath(); g.roundRect(0, 0, BOARD.width, BOARD.height, 18 / scale); g.fill();
    g.strokeStyle = player.color + "66"; g.lineWidth = 2 / scale; g.stroke();
    g.save();
    g.clip();
    const danger = world.danger > 0.1 && !world.over;
    const line = world.dangerLine;
    // The bust zone is always faintly marked; it throbs red while an orb sits in it.
    g.fillStyle = danger ? `rgba(255,61,122,${(0.12 + 0.18 * pane.pulse).toFixed(3)})` : "rgba(255,61,122,0.05)";
    g.fillRect(0, 0, BOARD.width, line);
    g.strokeStyle = danger ? UI.hot : UI.line;
    g.lineWidth = danger ? 2 + pane.pulse * 3 : 2;
    g.setLineDash([6, 8]);
    g.beginPath(); g.moveTo(14, line); g.lineTo(466, line); g.stroke();
    g.setLineDash([]);
    g.lineWidth = 1;
    label(g, "BUST LINE", 460, line - 8, 13, danger ? UI.hot : UI.dim, "right");
    if (this.phase === "play") {
      const ax = world.clampAim(pane.aim);
      let bottom = BOARD.floor - RADII[world.next];
      for (const ball of world.balls) {
        const dx = Math.abs(ax - ball.x), radius = ball.radius + RADII[world.next];
        if (dx < radius) bottom = Math.min(bottom, ball.y - Math.sqrt(radius * radius - dx * dx));
      }
      g.strokeStyle = COLORS[world.next] + (pane.dropped ? "28" : "50");
      g.setLineDash([3, 8]);
      g.beginPath(); g.moveTo(ax, 72); g.lineTo(ax, Math.max(76, bottom)); g.stroke();
      g.setLineDash([]);
      drawOrb(g, ax, 45, world.next, pane.dropped ? 0.3 : 0.85, RADII[world.next], false);
      // Beat bar: how long until this orb drops on its own; a thin line once dropped.
      const frac = Math.max(0, 1 - this.beatElapsed / beatLength(this.t));
      g.fillStyle = UI.line; g.fillRect(14, 8, 452, 6);
      if (!pane.dropped) { g.fillStyle = frac < 0.25 ? UI.hot : player.color; g.fillRect(14, 8, 452 * frac, 6); }
      else { g.fillStyle = player.color + "88"; g.fillRect(14, 8, 452, 6); }
    }
    for (const ball of world.balls) drawOrb(g, ball.x, ball.y, ball.tier, 1, ball.radius, false);
    for (const f of pane.floaters) {
      g.globalAlpha = Math.min(1, f.life * 2);
      display(g, f.text, f.x, f.y, f.size, f.color, "center");
    }
    g.globalAlpha = 1;
    if (!world.drops && !pane.banked && player.kind === "human") label(g, "Drag, then let go", 240, 320, 22, UI.muted, "center");
    if (pane.bustFlash > 0) {
      g.fillStyle = `rgba(255,61,122,${(0.35 * pane.bustFlash).toFixed(3)})`;
      g.fillRect(0, 0, BOARD.width, BOARD.height);
    }
    g.restore();
    g.restore();

    // Footer: the shake button, full board width, with cost pips.
    const cost = this.cost(pane);
    const ready = world.charge >= cost && this.phase === "play";
    const fy = boardY + boardH + 6, fh = footerH - 6;
    g.fillStyle = ready ? player.color : UI.panel;
    g.strokeStyle = ready ? player.color : UI.line;
    g.lineWidth = 2;
    g.beginPath(); g.roundRect(x, fy, boardW, fh, 12); g.fill(); g.stroke();
    const underdog = cost < SPRINT.shakeCost;
    display(g, underdog ? "UNDERDOG SHAKE" : "SHAKE", x + 12, fy + fh / 2 + 8, small ? 20 : 24, ready ? "#070b14" : underdog ? UI.warn : UI.dim);
    for (let i = 0; i < cost; i++) {
      g.beginPath();
      g.arc(x + boardW - 14 - (cost - 1 - i) * 16, fy + fh / 2, 5, 0, Math.PI * 2);
      g.fillStyle = i < world.charge ? (ready ? "#070b14" : player.color) : UI.line;
      g.fill();
    }
  }
}
