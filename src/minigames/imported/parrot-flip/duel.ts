import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameInstance, type Player } from "../../../core/types";
import { Callouts, Juice } from "../../../fx/juice";
import { ParrotPhysics } from "./physics";
import { FlickPointer } from "./pointer";
import { ParrotScene, preloadParrots } from "./renderer";
import {
  advanceDuel,
  botFlick,
  dealDuel,
  duelMissWouldEliminate,
  isOver,
  resolveDuelRound,
  rollGolden,
  scoresFromTable,
  suddenDeathLevel,
  type Duel,
  type DuelRound,
} from "./rules";

const HALF = GAME_WIDTH / 2;
const HUD_INSET = 8;
const RESULT_S = 1.6;
const GOLD = "#f2c14e";
const FLAMES = ["#ff3d00", "#ff6d00", "#ff9100", "#ffd600"];

interface Side {
  readonly index: 0 | 1;
  readonly offset: number;
  readonly physics: ParrotPhysics;
  readonly scene: ParrotScene;
  readonly pointer: FlickPointer;
  phase: "ready" | "flight" | "landed";
  landing: "MAKE" | "MISS" | null;
  perfect: boolean;
  golden: boolean;
  botWait: number;
}

/**
 * Split-screen Parrot Flip: both duelists flick at the same time on their own half.
 * A round resolves when both parrots have landed. Rules live in rules.ts (resolveDuelRound).
 */
export class ParrotDuelGame implements MinigameInstance {
  private readonly duel: Duel;
  private readonly sides: [Side, Side];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private round: DuelRound | null = null;
  private resultLeft = 0;
  private done = false;

  constructor(private readonly ctx: MinigameContext) {
    this.duel = dealDuel(ctx.players.map((p) => p.id));
    this.juice = new Juice(() => ctx.rng.next());
    preloadParrots([...ctx.players.map((p) => p.color), GOLD]);
    this.sides = [this.makeSide(0), this.makeSide(1)];
    this.beginRound();
  }

  private makeSide(index: 0 | 1): Side {
    const physics = new ParrotPhysics(() => this.ctx.rng.next());
    physics.init(HALF, GAME_HEIGHT, HUD_INSET);
    physics.setSideWalls(true);
    const offset = index * HALF;
    const side: Side = {
      index,
      offset,
      physics,
      scene: new ParrotScene(),
      pointer: new FlickPointer(
        this.ctx.canvas,
        { w: GAME_WIDTH, h: GAME_HEIGHT },
        (vx, vy) => this.flick(side, vx, vy),
        (x) => x >= offset && x < offset + HALF,
      ),
      phase: "ready",
      landing: null,
      perfect: false,
      golden: false,
      botWait: 0,
    };
    return side;
  }

  private player(side: Side): Player | undefined {
    return this.ctx.players[this.duel.sides[side.index]];
  }

  private beginRound(): void {
    this.round = null;
    for (const side of this.sides) {
      side.physics.resetBottle();
      side.phase = "ready";
      side.landing = null;
      side.perfect = false;
      side.golden = false;
      side.botWait = 0.5 + this.ctx.rng.float(0, 0.9);
      if (this.player(side)?.kind === "human") side.pointer.enable();
      else side.pointer.disable();
    }
    const risky = ([0, 1] as const).filter((i) => duelMissWouldEliminate(this.duel, i));
    if (risky.length) {
      const names = risky.map((i) => this.player(this.sides[i])?.name ?? "").join(" & ");
      this.callouts.show(`${names}: MAKE IT OR YOU'RE OUT`, "#FF3D7A", { life: 1.8, y: 0.2, size: 44 });
      this.ctx.sfx.tick();
    }
  }

  private flick(side: Side, vx: number, vy: number): void {
    if (this.done || side.phase !== "ready") return;
    side.pointer.disable();
    side.physics.applyFlick(vx, vy);
    side.phase = "flight";
    side.golden = rollGolden(this.ctx.rng);
    this.ctx.sfx.hit();
    if (side.golden) {
      this.callouts.show(`GOLDEN FLIP · ${this.player(side)?.name ?? ""}`, GOLD, { life: 1.1, y: 0.2, size: 48 });
      this.ctx.sfx.streak(2);
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    if (this.done) return;

    for (const side of this.sides) {
      side.physics.step(dt);
      if (side.phase === "flight") {
        const landing = side.physics.checkLanding();
        if (landing) {
          side.phase = "landed";
          side.landing = landing;
          side.perfect = landing === "MAKE" && !!side.physics.getLastLandingInfo()?.perfect;
          if (landing === "MAKE") this.ctx.sfx.collect();
          else this.ctx.sfx.miss();
        }
      } else if (side.phase === "ready" && this.player(side)?.kind === "bot") {
        side.botWait -= dt;
        if (side.botWait <= 0) {
          const f = botFlick(this.ctx.rng);
          this.flick(side, f.vx, f.vy);
        }
      }
    }

    if (!this.round && this.sides.every((s) => s.phase === "landed")) {
      this.resolveRound();
      return;
    }
    if (this.round) {
      this.resultLeft -= realDt;
      if (this.resultLeft <= 0) this.nextRound();
    }
  }

  private resolveRound(): void {
    const [a, b] = this.sides;
    const round = resolveDuelRound(
      this.duel,
      [a.landing === "MAKE", b.landing === "MAKE"],
      [{ golden: a.golden }, { golden: b.golden }],
    );
    this.round = round;
    this.resultLeft = RESULT_S;

    for (const side of this.sides) {
      const out = round.sides[side.index];
      const bottle = side.physics.getBottle();
      const x = side.offset + (bottle?.position.x ?? HALF / 2);
      const y = (bottle?.position.y ?? GAME_HEIGHT * 0.7) - 40;
      const color = this.player(side)?.color ?? "#69f0ae";
      if (bottle && side.landing) side.scene.kick(side.landing, bottle.position.x, bottle.position.y, color, side.perfect);
      if (out.made) {
        this.juice.burst(x, y, [color, "#ffffff"], { count: 18, speed: 260, angle: -Math.PI / 2, spread: 2.4 });
        if (side.perfect) this.juice.burst(x, y, [color, "#ffffff", "#B8FF3D"], { count: 30, speed: 440, size: 5 });
        if (out.golden) this.juice.burst(x, y, [GOLD, "#fff3b0", "#ffffff"], { count: 44, speed: 500, size: 5 });
      }
      if (out.justIgnited) {
        this.juice.burst(x, y, FLAMES, { count: 70, speed: 540, size: 6, life: 0.9, gravity: -120, angle: -Math.PI / 2, spread: 2.2 });
        this.juice.shake(0.45);
        this.callouts.show(`${this.player(side)?.name ?? ""} ON FIRE!`, "#FF6D00", { life: 1.5, y: 0.2, size: 70 });
        this.ctx.sfx.streak(3);
      }
      if (out.penalty > 0) this.juice.shake(Math.min(0.6, 0.12 + out.penalty * 0.05));
    }

    const [oa, ob] = round.sides;
    if (round.doubleKo) {
      this.juice.shake(1);
      this.juice.hitStop(0.14);
      this.callouts.show("DOUBLE KO! 1 LIFE EACH", "#FF3D7A", { life: 1.8, y: 0.38, size: 64 });
      this.ctx.sfx.hit();
    } else if (oa.eliminated || ob.eliminated) {
      const out = oa.eliminated ? this.sides[0] : this.sides[1];
      this.juice.shake(1);
      this.juice.hitStop(0.14);
      this.callouts.show(`${this.player(out)?.name ?? ""} IS OUT`, "#FF3D7A", { life: 1.6, y: 0.38, size: 64 });
      this.ctx.sfx.hit();
    } else if (oa.made && ob.made) {
      this.callouts.show(`BOTH MAKE · STAKE ${this.duel.table.stake}`, "#B8FF3D", { life: 1.2, y: 0.38, size: 48 });
    } else if (!oa.made && !ob.made && round.stakePaid > 0) {
      this.callouts.show(`BOTH MISS · BOTH PAY ${round.stakePaid}`, "#FF3D7A", { life: 1.2, y: 0.38, size: 48 });
    }
  }

  private nextRound(): void {
    if (isOver(this.duel.table)) {
      this.done = true;
      for (const side of this.sides) side.pointer.disable();
      return;
    }
    for (const index of advanceDuel(this.duel)) {
      const p = this.player(this.sides[index]);
      this.callouts.show(`${p?.name ?? ""} STEPS IN`, p?.color ?? "#F4F7FB", { life: 1.4, y: 0.38, size: 56 });
    }
    this.beginRound();
  }

  render(g: CanvasRenderingContext2D): void {
    this.juice.begin(g);
    for (const side of this.sides) {
      const p = this.player(side);
      const seat = this.duel.table.seats[this.duel.sides[side.index]];
      const out = this.round?.sides[side.index];
      const drag = side.phase === "ready" ? side.pointer.getDrag() : null;
      g.save();
      g.translate(side.offset, 0);
      g.beginPath();
      g.rect(0, 0, HALF, GAME_HEIGHT);
      g.clip();
      side.scene.frame(g, 1 / 60, HALF, GAME_HEIGHT, {
        bottle: side.physics.getBottle(),
        liquid: side.physics.liquid,
        groundY: side.physics.getGroundY(),
        drag: drag && { startX: drag.startX - side.offset, startY: drag.startY, curX: drag.curX - side.offset, curY: drag.curY },
        result: this.round ? side.landing : null,
        resultAlpha: this.round ? Math.min(1, (RESULT_S - this.resultLeft) / 0.25, this.resultLeft / 0.3) : 0,
        showGlow: !!out?.made,
        isOnFire: !!seat?.onFire,
        liquidColor: side.golden ? GOLD : (p?.color ?? "#d62828"),
        golden: side.golden,
      });
      g.restore();
    }
    this.juice.end(g);

    // Divider
    g.fillStyle = "rgba(7,11,20,0.85)";
    g.fillRect(HALF - 3, 0, 6, GAME_HEIGHT);
    for (const side of this.sides) this.drawSideHud(g, side);
    this.drawCenterHud(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawSideHud(g: CanvasRenderingContext2D, side: Side): void {
    const p = this.player(side);
    const seat = this.duel.table.seats[this.duel.sides[side.index]];
    if (!p || !seat) return;
    const left = side.index === 0;
    const x = left ? 28 : GAME_WIDTH - 28;
    g.textAlign = left ? "left" : "right";
    g.fillStyle = p.color;
    g.font = "700 30px Bebas Neue, sans-serif";
    const tag = seat.onFire ? " 🔥" : seat.heatingUp ? " ♨" : "";
    g.fillText(`${p.name}${tag}`, x, 44);
    g.font = "600 17px Outfit, sans-serif";
    const hearts = `${"♥".repeat(Math.min(seat.lives, 10))}${seat.lives > 10 ? `+${seat.lives - 10}` : ""}`;
    g.fillText(hearts || "—", x, 68);

    g.font = "600 15px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    let status = "";
    if (side.phase === "ready") status = p.kind === "human" ? "Flick UP on your side" : "lining up…";
    else if (side.phase === "flight") status = "…";
    else if (!this.round) status = "waiting for the other flip";
    if (seat.onFire && side.phase === "ready") status = "ON FIRE: makes +1 life, miss is free";
    g.fillText(status, x, 92);

    const out = this.round?.sides[side.index];
    if (out) {
      let line = "";
      if (out.eliminated) line = "OUT";
      else if (out.justIgnited) line = "ON FIRE!";
      else if (out.fireGain > 0) line = `+${out.fireGain} ${out.fireGain === 1 ? "life" : "lives"}`;
      else if (out.fireEnded) line = "Fire's out. Free miss.";
      else if (out.penalty > 0) line = `-${out.penalty} ${out.penalty === 1 ? "life" : "lives"}`;
      else if (out.made) line = out.golden ? "GOLDEN +2" : "+1 stake";
      if (line) {
        g.textAlign = "center";
        g.font = "700 38px Bebas Neue, sans-serif";
        g.fillStyle = out.made ? "#B8FF3D" : "#FF3D7A";
        g.fillText(line, side.offset + HALF / 2, GAME_HEIGHT * 0.3);
      }
    }
  }

  private drawCenterHud(g: CanvasRenderingContext2D): void {
    const { table, queue } = this.duel;
    const sd = suddenDeathLevel(table.flips + 2);
    g.textAlign = "center";
    g.fillStyle = "rgba(7,11,20,0.75)";
    g.beginPath();
    g.roundRect(HALF - 90, 8, 180, 74, 14);
    g.fill();
    g.font = "700 40px Bebas Neue, sans-serif";
    const risky = duelMissWouldEliminate(this.duel, 0) || duelMissWouldEliminate(this.duel, 1);
    g.fillStyle = risky ? "#FF3D7A" : "#FFB020";
    g.fillText(`STAKE ${table.stake + sd}`, HALF, 48);
    g.font = "600 13px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText(sd ? `SUDDEN DEATH +${sd}` : "a miss pays the stake", HALF, 70);
    if (queue.length) {
      const names = queue.map((i) => this.ctx.players[i]?.name).join(", ");
      g.fillText(`Up next: ${names}`, HALF, GAME_HEIGHT - 14);
    }
  }

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    return scoresFromTable(this.duel.table);
  }

  destroy(): void {
    for (const side of this.sides) {
      side.pointer.destroy();
      side.physics.destroy();
    }
  }
}
