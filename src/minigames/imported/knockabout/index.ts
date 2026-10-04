import type { MinigameContext, MinigameDefinition, MinigameInstance } from "../../../core/types";
import { GAME_WIDTH, GAME_HEIGHT, PLAYER_COLORS } from "../../../core/types";
import { Juice, Callouts } from "../../../fx/juice";
import { ModePicker, type GameMode } from "../../mode-picker";
import { World, type WorldEvents } from "./world";
import { KnockaboutInput } from "./input";
import { KnockaboutAudio } from "./audio";
import { createObjective, type Objective } from "./objectives";
import { createDraft, startDraft, applyPerk, drawDraftUI, applyLaunchPerks, applyPerksToDiscs, type DraftState } from "./perks";
import { botChooseShot, type BotDifficulty } from "./bot";
import { ARENA_KINDS } from "./arena";
import type { Disc, GamePhase, MatchPlayer } from "./types";
import { TUNING } from "./types";
import {
  drawBackground, drawArena, drawDisc, drawAim, drawPowerups,
  drawHUD, drawBanner, screenToWorld,
} from "./render";

function lighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 0.4;
  return `rgb(${Math.min(255, Math.floor(r + (255 - r) * f))},${Math.min(255, Math.floor(g + (255 - g) * f))},${Math.min(255, Math.floor(b + (255 - b) * f))})`;
}

const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

export class KnockaboutGame implements MinigameInstance {
  private phase: GamePhase = "intro";
  private phaseT = 0;
  private time = 0;

  private players: MatchPlayer[];
  private world: World;
  private input: KnockaboutInput;
  private audio: KnockaboutAudio;
  private juice: Juice;
  private callouts: Callouts;
  private objective: Objective;
  private draft: DraftState;

  private round = 0;
  private totalRounds: number;
  private turn = 0;
  private currentPlayer = 0;
  private readyCount = 0;
  private hurryTimer: number | null = null;
  private roundOverTimer = 0;
  private matchOver = false;
  private draftHover = -1;

  private accumulator = 0;

  constructor(private readonly ctx: MinigameContext, totalRounds: number) {
    this.totalRounds = totalRounds;

    this.players = ctx.players.map((p, i) => ({
      id: i,
      name: p.name,
      color: PLAYER_COLORS[i] ?? "#888",
      light: lighten(PLAYER_COLORS[i] ?? "#888"),
      wins: 0,
      kos: 0,
      ownGoals: 0,
      ready: false,
      dir: DIRS[i] ?? { x: 0, y: -1 },
      perks: [],
      kind: p.kind,
      slot: p.slot,
    }));

    this.juice = new Juice();
    this.callouts = new Callouts();
    this.objective = createObjective("showdown");
    this.draft = createDraft();
    this.audio = new KnockaboutAudio(ctx.sfx);

    const events: WorldEvents = {
      onHit: (e) => {
        this.audio.onHit(e);
        if (e.strength > 1.0) this.juice.shake(Math.min(1, e.strength * 0.3));
        if (e.strength > 2.0) this.juice.hitStop(0.04);
      },
      onFall: (e) => {
        this.audio.onFall(e);
        this.objective.onFall(e, this.players);
        this.juice.shake(0.6);
        if (e.killer != null && e.killer !== e.disc.owner) {
          this.callouts.show("KO!", this.players[e.killer]!.color, { life: 1.5 });
        }
      },
      onBumperHit: () => { this.audio.onBumperHit(); },
      onWallHit: () => {},
      onPowerUp: () => { this.audio.onPowerUp(); },
      onExplode: () => {
        this.audio.onExplode();
        this.juice.shake(0.8);
      },
    };

    this.world = new World(() => ctx.rng.next(), events);
    this.input = new KnockaboutInput(
      ctx.canvas,
      (lx, ly) => screenToWorld(this.world.arena, lx, ly),
      (wx, wy, _pointerId) => this.findGrabbableDisc(wx, wy),
    );

    this.startRound();
  }

  private startRound(): void {
    this.round++;
    const kind = ARENA_KINDS[this.ctx.rng.int(0, ARENA_KINDS.length - 1)]!;
    this.world.buildArena(kind, 1.1, 0.75);
    this.objective.onRoundStart(this.world, this.players);
    this.world.spawnDiscs(this.players, 2);
    for (const p of this.players) {
      applyPerksToDiscs(this.world.aliveDiscs(), p);
    }
    this.turn = 0;
    this.currentPlayer = 0;
    this.readyCount = 0;
    this.hurryTimer = null;
    this.phase = "intro";
    this.phaseT = 0;
    this.callouts.show(this.world.arena.name, "#F4F7FB", { life: 2 });
    this.input.refreshRect();
  }

  private findGrabbableDisc(wx: number, wy: number): Disc | null {
    if (this.phase !== "plan") return null;
    const discs = this.world.aliveDiscs().filter((d) => this.players[d.owner]!.kind === "human");
    let best: Disc | null = null;
    let bd = Infinity;
    for (const d of discs) {
      if (d.grab != null) continue;
      const dist = Math.hypot(d.x - wx, d.y - wy);
      if (dist < d.r * 4 && dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  update(dt: number): void {
    this.time += dt;
    const jdt = this.juice.update(dt);
    this.callouts.update(jdt);

    switch (this.phase) {
      case "intro":
        this.phaseT += jdt;
        this.world.updateVisuals(jdt);
        if (this.phaseT > 1.1) {
          this.phase = "plan";
          this.phaseT = 0;
          this.startTurn();
        }
        break;

      case "plan":
        this.phaseT += jdt;
        this.world.updateVisuals(jdt);
        this.handleBotAim(jdt);
        this.hurryTimer = Math.max(0, 8 - this.phaseT);
        if (this.allReady() || this.hurryTimer === 0) {
          this.phase = "aim";
          this.phaseT = 0;
          this.hurryTimer = 0.7;
          this.callouts.show("LOCKED IN!", "#FFB020", { life: 0.7 });
        }
        break;

      case "aim":
        this.phaseT += jdt;
        this.world.updateVisuals(jdt);
        this.handleBotAim(jdt);
        if (this.hurryTimer != null) {
          this.hurryTimer -= jdt;
          if (this.hurryTimer <= 0) {
            this.launchAll();
            this.phase = "sim";
            this.phaseT = 0;
          }
        }
        break;

      case "sim":
        this.phaseT += jdt;
        this.accumulator += jdt;
        for (let i = 0; i < TUNING.maxSubSteps && this.accumulator >= TUNING.physicsStep; i++) {
          this.world.step(TUNING.physicsStep);
          this.accumulator -= TUNING.physicsStep;
        }
        this.accumulator = Math.min(this.accumulator, TUNING.physicsStep * 2);
        this.world.updateVisuals(jdt);
        this.world.cleanDead();

        if (this.objective.isRoundOver(this.world, this.players)) {
          this.phase = "roundEnd";
          this.phaseT = 0;
          this.endRound();
        } else if (this.world.settled()) {
          this.objective.onTurnEnd(this.world, this.players, this.turn);
          this.phase = "shrink";
          this.phaseT = 0;
        }
        break;

      case "shrink":
        this.phaseT += jdt;
        this.world.updateVisuals(jdt);
        if (this.phaseT > 0.5) {
          if (this.objective.isRoundOver(this.world, this.players)) {
            this.phase = "roundEnd";
            this.phaseT = 0;
            this.endRound();
          } else {
            this.phase = "plan";
            this.phaseT = 0;
            this.advancePlayer();
            this.startTurn();
          }
        }
        break;

      case "roundEnd":
        this.phaseT += jdt;
        this.roundOverTimer -= jdt;
        if (this.roundOverTimer <= 0) {
          if (this.round >= this.totalRounds) {
            this.phase = "matchEnd";
            this.phaseT = 0;
            this.matchOver = true;
            this.audio.onMatchEnd();
          } else {
            this.startDraftOrNextRound();
          }
        }
        break;

      case "draft":
        this.phaseT += jdt;
        this.draft.timer -= jdt;
        this.handleDraftInput();
        if (this.draft.timer <= 0 && this.draft.active) {
          this.autoDraft();
        }
        break;

      case "matchEnd":
        this.phaseT += jdt;
        break;
    }
  }

  private startTurn(): void {
    this.turn++;
    this.input.reset();
    this.accumulator = 0;
    for (const p of this.players) p.ready = false;
    this.readyCount = 0;
    this.hurryTimer = 8;

    if (this.ctx.rng.next() < TUNING.powerupChance && this.world.powerups.filter((p) => !p.gone).length < TUNING.maxPowerups) {
      this.world.spawnPowerup();
    }
  }

  private advancePlayer(): void {
    const alive = this.world.aliveOwners();
    let next = (this.currentPlayer + 1) % this.players.length;
    for (let i = 0; i < this.players.length; i++) {
      if (alive.has(next)) { this.currentPlayer = next; return; }
      next = (next + 1) % this.players.length;
    }
  }

  private handleBotAim(_dt: number): void {
    for (const p of this.players) {
      if (p.kind !== "bot" || p.ready) continue;
      const discs = this.world.aliveDiscs(p.id);
      if (discs.length === 0) { p.ready = true; this.readyCount++; continue; }

      for (const d of discs) {
        if (d.aim) continue;
        const diff: BotDifficulty = this.ctx.rng.next() < 0.33 ? "easy" : this.ctx.rng.next() < 0.5 ? "normal" : "hard";
        const shot = botChooseShot(this.world, d, this.players, diff, () => this.ctx.rng.next());
        if (shot) {
          d.aim = { dx: shot.dx, dy: shot.dy, power: shot.power, px: d.x, py: d.y };

        }
      }
      p.ready = true;
      this.readyCount++;
    }
  }

  private allReady(): boolean {
    return this.world.aliveDiscs().every((d) => d.aim != null && d.grab == null);
  }

  private launchAll(): void {
    for (const d of this.world.aliveDiscs()) {
      if (d.aim) {
        const p = this.players[d.owner]!;
        const mods = applyLaunchPerks(d, p);
        d.aim.power *= mods.speedMul;
        this.world.launchDisc(d);
      }
    }
    this.input.reset();
  }

  private endRound(): void {
    const winner = this.objective.roundWinner(this.players);
    if (winner != null) {
      this.players[winner]!.wins++;
      this.callouts.show(`${this.players[winner]!.name} WINS!`, this.players[winner]!.color, { life: 2 });
    }
    this.audio.onRoundEnd();
    this.roundOverTimer = 2.5;
  }

  private startDraftOrNextRound(): void {
    const loser = this.findLoser();
    if (loser != null && this.players[loser]!.perks.length < 6) {
      startDraft(this.draft, loser, this.players, () => this.ctx.rng.next());
      this.phase = "draft";
      this.phaseT = 0;
      this.draftHover = -1;
    } else {
      this.startRound();
    }
  }

  private findLoser(): number | null {
    let minWins = Infinity;
    for (const p of this.players) {
      if (p.wins < minWins) minWins = p.wins;
    }
    const tied = this.players.filter((p) => p.wins === minWins);
    if (tied.length === 0) return null;
    return tied[this.round % tied.length]!.id;
  }

  private handleDraftInput(): void {
    if (!this.draft.active) return;
    const click = this.ctx.input.consumeClick();
    if (click) {
      const n = this.draft.choices.length;
      const cardW = 220;
      const gap = 40;
      const totalW = n * cardW + (n - 1) * gap;
      const startX = 640 - totalW / 2;
      for (let i = 0; i < n; i++) {
        const x = startX + i * (cardW + gap);
        if (click.x >= x && click.x <= x + cardW && click.y >= 200 && click.y <= 480) {
          this.pickDraft(i);
          return;
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      if (this.ctx.input.justPressed(`Digit${i + 1}`)) {
        if (i < this.draft.choices.length) this.pickDraft(i);
        return;
      }
    }

    // Bot auto-pick
    if (this.players[this.draft.draftingPlayer]?.kind === "bot") {
      this.pickDraft(Math.floor(this.ctx.rng.next() * this.draft.choices.length));
    }
  }

  private pickDraft(index: number): void {
    const perk = this.draft.choices[index];
    if (!perk) return;
    applyPerk(perk.id, this.players[this.draft.draftingPlayer]!);
    this.draft.active = false;
    this.audio.onDraftPick();
    this.startRound();
  }

  private autoDraft(): void {
    this.pickDraft(0);
  }

  render(g: CanvasRenderingContext2D): void {
    drawBackground(g);
    this.juice.begin(g);

    if (this.phase === "draft") {
      drawDraftUI(g, this.draft, this.players, this.draftHover);
      this.juice.end(g);
      return;
    }

    if (this.phase === "matchEnd") {
      this.renderMatchEnd(g);
      this.juice.end(g);
      return;
    }

    drawArena(g, this.world.arena);
    drawPowerups(g, this.world.powerups, this.world.arena, this.time);

    const hiddenAim = this.phase === "plan" || this.phase === "aim";
    for (const d of this.world.discs) {
      const p = this.players[d.owner]!;
      drawDisc(g, d, this.world.arena, p.color, p.light);
      drawAim(g, d, this.world.arena, this.world, p.color, hiddenAim && this.players[d.owner]!.kind === "bot");
    }

    drawHUD(g, this.players, this.round, this.totalRounds, this.phase, this.turn, this.currentPlayer, this.hurryTimer);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);

    if (this.phase === "intro") {
      drawBanner(g, this.world.arena.name, this.objective.name, "#F4F7FB");
    }
    if (this.phase === "roundEnd") {
      const w = this.objective.roundWinner(this.players);
      const name = w != null ? this.players[w]!.name : "Draw";
      const color = w != null ? this.players[w]!.color : "#94a3b8";
      drawBanner(g, `${name} wins the round!`, `Round ${this.round} / ${this.totalRounds}`, color);
    }

    if (this.phase === "plan") {
      g.fillStyle = "#F4F7FB";
      g.font = "600 18px Outfit, sans-serif";
      g.textAlign = "center";
      g.fillText("AIM BOTH DISCS • EVERYONE FIRES TOGETHER", GAME_WIDTH / 2, GAME_HEIGHT - 28);
    }
    this.juice.end(g);
  }

  private renderMatchEnd(g: CanvasRenderingContext2D): void {
    const sorted = [...this.players].sort((a, b) => b.wins - a.wins || b.kos - a.kos);
    const winner = sorted[0]!;

    g.fillStyle = winner.color;
    g.font = "700 64px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`${winner.name} WINS!`, GAME_WIDTH / 2, 160);

    g.fillStyle = "#F4F7FB";
    g.font = "600 24px Outfit, sans-serif";
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!;
      const y = 260 + i * 50;
      g.fillStyle = p.color;
      g.textAlign = "left";
      g.fillText(`${i + 1}. ${p.name}`, 400, y);
      g.fillStyle = "#94a3b8";
      g.textAlign = "right";
      g.fillText(`${p.wins}W  ${p.kos}KO`, 880, y);
    }
  }

  isFinished(): boolean {
    return this.matchOver && this.phaseT > 4;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((p, i) => ({
      playerId: p.id,
      score: this.players[i]!.wins * 1000 + this.players[i]!.kos * 10,
    }));
  }

  destroy(): void {
    this.input.destroy();
  }
}

function createQuick(ctx: MinigameContext): MinigameInstance {
  return new KnockaboutGame(ctx, 3);
}

function createFull(ctx: MinigameContext): MinigameInstance {
  return new KnockaboutGame(ctx, 5);
}

const modes: readonly [GameMode, GameMode] = [
  { title: "QUICK 3", line1: "3 rounds", line2: "Fast match", color: "#3EE0FF", create: createQuick },
  { title: "FULL 5", line1: "5 rounds", line2: "Full experience", color: "#FFB020", create: createFull },
];

const allBots = (ctx: MinigameContext): boolean => ctx.players.every((p) => p.kind === "bot");

const knockabout: MinigameDefinition = {
  id: "knockabout",
  name: "Knockabout",
  tagline: "Flick to survive",
  description: "Pull back and launch your discs to knock opponents off the platform. Last player standing wins!",
  durationMs: 0,
  controls: "Drag both discs to lock in · Everyone launches together after 8 seconds",
  create(ctx) {
    return new ModePicker(ctx, "KNOCKABOUT", modes, allBots(ctx));
  },
};

export default knockabout;
