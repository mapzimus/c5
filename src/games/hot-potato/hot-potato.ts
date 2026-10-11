import { fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  AIM_HOLD_S,
  AIM_SWEEP_RAD_PER_S,
  FLIGHT_S,
  FREEZE_IMMUNE_S,
  FREEZE_S,
  GLUE_AT_S,
  HAUNT_COOLDOWN_S,
  SPLIT_AT_S,
  STICKY_AT_S,
  WIGGLE_S,
  bombOdds,
  botAimTarget,
  canFreeze,
  chargeFill,
  chargeSeconds,
  chargeTier,
  eliminationScores,
  formatNerve,
  heartsFor,
  inZone,
  isNearMiss,
  isSuddenDeath,
  nerveTenths,
  pickTarget,
  planBomb,
  planBotHaunt,
  planBotHold,
  pointedSeat,
  seatLayout,
  spookEarned,
  stickFor,
  type BombKind,
  type ChargeTier,
  type SeatZone,
} from "./logic";

export const hotPotato: GameDefinition = {
  id: "hot-potato",
  name: "Hold It!",
  tagline: "Hold it longer. Stick it harder.",
  description:
    "A lit bomb with a hidden fuse lands in someone's hands. Tap to lob it at a random player, or " +
    "hold to aim: the longer you dare to hold, the stickier your throw. A sticky throw glues the " +
    "catcher's hands shut for a second, a GLUE throw for two. Lose all your hearts and you come back " +
    "as a ghost that can freeze the living with a tap. Last one with a heart wins.",
  durationMs: 0,
  controls: "Tap your zone to pass. Hold to aim and charge: 1.5s = sticky, 3s = glue. Ghosts tap to haunt.",
  create: (ctx) => new HotPotato(ctx),
};

const INTRO_S = 1.0;
const RESULT_HEART_S = 1.4;
const RESULT_OUT_S = 1.9;
const FINAL_S = 3.6;
const RESPAWN_S = 0.8;
const BEAM_S = 0.5;
const BEST_VERSION = "v2";
const FONT = "Bebas Neue, Impact, sans-serif";
const STICKY_COLOR = "#FFB020";
const GLUE_COLOR = "#FF3D7A";
const ICE_COLOR = "#9ad9ff";
const GOO_COLOR = "#B8FF3D";

type Phase = "intro" | "round" | "result" | "final";

interface Bomb {
  kind: BombKind;
  fuseS: number;
  /** Seconds since lit. */
  t: number;
  /** Seat holding it, or the seat it is flying to. */
  holder: number;
  flight: { from: number; to: number; t: number } | null;
  /** Seconds in the current holder's hands. */
  heldT: number;
  botThrowAt: number | null;
  botTarget: number | null;
  botIntent: "quick" | "sticky" | "glue" | "blunder" | null;
  /** Charge tier the current flight was thrown with. */
  stickTier: ChargeTier;
  thrower: number;
  sinceThrow: number;
  splitDone: boolean;
  hissT: number;
  spin: number;
}

interface Press {
  seat: number;
  t: number;
  aiming: boolean;
  aimAngle: number;
}

interface Seat {
  player: Player;
  zone: SeatZone;
  alive: boolean;
  hearts: number;
  passes: number;
  /** Longest single hold (seconds) that was thrown before it blew. */
  nerve: number;
  spooks: number;
  /** Soot/wobble effects after an explosion. */
  hit: number;
  catchPop: number;
  /** Seconds the hands stay glued after catching a charged throw. */
  stuckT: number;
  stuckMax: number;
  /** Seconds the hands stay frozen after a ghost haunt. */
  frozenT: number;
  immuneT: number;
  sinceThaw: number;
  hauntedBy: number;
  /** Ghost haunt cooldown. */
  hauntCd: number;
  botHauntAt: number;
  beam: { to: number; t: number } | null;
  say: { text: string; life: number } | null;
  heartFlash: number;
  wiggle: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

class HotPotato implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private blast = 0;
  private suddenDeath = false;
  private bombs: Bomb[] = [];
  private respawnTimer = 0;
  private forceLive = false;
  private readonly order: number[] = [];
  private readonly presses = new Map<number, Press>();
  private pops: Pop[] = [];
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private time = 0;
  private flash = 0;
  private freezeFlash = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const zones = seatLayout(ctx.players.length, ctx.width, ctx.height);
    const hearts = heartsFor(ctx.players.length);
    this.seats = ctx.players.map((player, i) => ({
      player, zone: zones[i] ?? zones[0]!, alive: true, hearts, passes: 0, nerve: 0, spooks: 0,
      hit: 0, catchPop: 0, stuckT: 0, stuckMax: 1, frozenT: 0, immuneT: 0, sinceThaw: 99, hauntedBy: -1,
      hauntCd: 0, botHauntAt: 0, beam: null, say: null, heartFlash: 0, wiggle: 0,
    }));
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onCancel);
  }

  // ---------------------------------------------------------------- state

  private get alive(): boolean[] {
    return this.seats.map((s) => s.alive);
  }

  private get hearts(): number[] {
    return this.seats.map((s) => s.hearts);
  }

  private aliveCount(): number {
    return this.seats.filter((s) => s.alive).length;
  }

  private canThrow(seat: Seat): boolean {
    return seat.alive && seat.stuckT <= 0 && seat.frozenT <= 0;
  }

  private pop(x: number, y: number, text: string, color: string, size = 34, life = 1.0): void {
    this.pops.push({ x, y, text, color, life, maxLife: life, size });
  }

  private say(seat: Seat, text: string, life = 1.3): void {
    seat.say = { text, life };
  }

  private spawnBomb(): void {
    const living = this.seats.map((s, i) => (s.alive ? i : -1)).filter((i) => i >= 0);
    if (living.length === 0) return;
    const holder = this.ctx.rng.pick(living);
    const plan = planBomb(this.ctx.rng, bombOdds(this.blast, this.suddenDeath), {
      allowDud: !this.forceLive, allowSplit: living.length > 2,
    });
    this.forceLive = false;
    const bomb = this.makeBomb(plan.kind, plan.fuseS, holder);
    this.onLanded(bomb);
    this.bombs.push(bomb);
    this.ctx.sfx.go();
    const z = this.seats[holder]!.zone;
    this.juice.burst(z.cx, z.cy - 40, ["#FFB020", "#ffffff"], { count: 10, speed: 160, gravity: 0, life: 0.3, size: 4 });
  }

  private makeBomb(kind: BombKind, fuseS: number, holder: number): Bomb {
    return {
      kind, fuseS, t: 0, holder, flight: null, heldT: 0, botThrowAt: null, botTarget: null, botIntent: null,
      stickTier: 0, thrower: -1, sinceThrow: 99, splitDone: false, hissT: 0, spin: 0,
    };
  }

  private onLanded(bomb: Bomb): void {
    bomb.heldT = 0;
    const seat = this.seats[bomb.holder]!;
    seat.catchPop = 1;
    // A charged throw glues the catcher's hands.
    const stick = stickFor(bomb.stickTier);
    if (stick > 0) {
      seat.stuckT = Math.max(seat.stuckT, stick);
      seat.stuckMax = stick;
      const glue = bomb.stickTier === 2;
      this.pop(seat.zone.cx, seat.zone.cy - 110, glue ? "GLUED!" : "STUCK!", glue ? GLUE_COLOR : STICKY_COLOR, glue ? 48 : 40);
      this.juice.burst(seat.zone.cx, seat.zone.cy - 44, [GOO_COLOR, glue ? GLUE_COLOR : STICKY_COLOR], {
        count: glue ? 22 : 12, speed: 150, gravity: 420, life: 0.6, size: 6,
      });
      this.juice.shake(glue ? 0.3 : 0.15);
      this.ctx.sfx.streak(glue ? 4 : 2);
      const thrower = bomb.thrower >= 0 ? this.seats[bomb.thrower] : undefined;
      if (thrower && thrower.player.kind === "bot") this.say(thrower, this.ctx.rng.pick(["heh heh", "stick it!", "enjoy!"]));
    }
    bomb.stickTier = 0;
    if (seat.player.kind === "bot") {
      const plan = planBotHold(this.ctx.rng, bomb.t, seat.hearts === 1);
      bomb.botThrowAt = plan.holdS;
      bomb.botIntent = plan.intent;
      bomb.botTarget = botAimTarget(this.alive, bomb.holder, this.hearts, this.ctx.rng);
      if (bomb.t > 5 && this.ctx.rng.next() < 0.5) this.say(seat, this.ctx.rng.pick(["TOO HOT!", "nope nope", "yikes"]), 0.8);
    } else {
      bomb.botThrowAt = null;
      bomb.botTarget = null;
      bomb.botIntent = null;
    }
  }

  /** Throw the bomb `seat` has held the longest. Returns false if they hold nothing throwable. */
  private throwFrom(seat: number, target: number, tier: ChargeTier): boolean {
    if (this.phase !== "round") return false;
    const s = this.seats[seat]!;
    if (!this.canThrow(s)) return false;
    const held = this.bombs.filter((b) => b.flight === null && b.holder === seat);
    if (held.length === 0) return false;
    if (target < 0 || target === seat || !this.seats[target]?.alive) {
      target = pickTarget(this.alive, seat, this.ctx.rng);
      if (target < 0) return false;
    }
    held.sort((a, b) => b.heldT - a.heldT);
    const bomb = held[0]!;
    const heldFor = bomb.heldT;
    bomb.flight = { from: seat, to: target, t: 0 };
    bomb.holder = target;
    bomb.botThrowAt = null;
    bomb.stickTier = tier;
    bomb.thrower = seat;
    bomb.sinceThrow = 0;
    s.passes += 1;
    this.ctx.sfx.whoosh();
    this.juice.burst(s.zone.cx, s.zone.cy - 40, [s.player.color, "rgba(244,247,251,0.6)"], {
      count: 6, speed: 120, gravity: 200, life: 0.3, size: 3,
    });
    if (tier > 0) {
      this.pop(s.zone.cx, s.zone.cy - 104, tier === 2 ? "GLUE THROW!" : "STICKY THROW", tier === 2 ? GLUE_COLOR : STICKY_COLOR, 30, 0.8);
    }
    // Nerve: the longest hold you got away with. Humans chase a saved record.
    if (heldFor > s.nerve) {
      s.nerve = heldFor;
      if (s.player.kind === "human" && heldFor >= 2 && saveBest(hotPotato.id, nerveTenths(heldFor), BEST_VERSION)) {
        this.callouts.show(`NEW RECORD ${formatNerve(heldFor)} NERVE`, s.player.color, { size: 50, life: 1.4, y: 0.42 });
        this.ctx.sfx.collect();
      }
    }
    return true;
  }

  private haunt(ghostIdx: number, target: number): void {
    const ghost = this.seats[ghostIdx]!;
    if (ghost.alive || ghost.hauntCd > 0 || this.phase !== "round") return;
    if (target < 0 || !this.seats[target]?.alive) {
      target = pickTarget(this.alive, ghostIdx, this.ctx.rng);
      if (target < 0) return;
    }
    const victim = this.seats[target]!;
    if (!canFreeze(victim.frozenT, victim.immuneT)) {
      ghost.hauntCd = 1;
      this.pop(victim.zone.cx, victim.zone.cy - 110, "IMMUNE", "rgba(244,247,251,0.6)", 26, 0.6);
      this.ctx.sfx.miss();
      return;
    }
    ghost.hauntCd = HAUNT_COOLDOWN_S;
    ghost.beam = { to: target, t: 0 };
    victim.frozenT = FREEZE_S;
    victim.hauntedBy = ghostIdx;
    victim.sinceThaw = 99;
    this.freezeFlash = 1;
    this.pop(victim.zone.cx, victim.zone.cy - 110, "BOO!", ICE_COLOR, 46);
    this.say(ghost, "BOO!", 0.8);
    this.juice.burst(victim.zone.cx, victim.zone.cy - 44, [ICE_COLOR, "#ffffff", ghost.player.color], {
      count: 16, speed: 170, gravity: 60, life: 0.6, size: 5,
    });
    this.juice.shake(0.15);
    this.ctx.sfx.select();
    this.ctx.sfx.hit();
  }

  // ---------------------------------------------------------------- update

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.flash = Math.max(0, this.flash - realDt * 3);
    this.freezeFlash = Math.max(0, this.freezeFlash - realDt * 4);
    for (const p of this.pops) {
      p.life -= realDt;
      p.y -= realDt * 26;
    }
    this.pops = this.pops.filter((p) => p.life > 0);
    for (const s of this.seats) {
      s.hit = Math.max(0, s.hit - realDt * 1.2);
      s.catchPop = Math.max(0, s.catchPop - realDt * 5);
      s.heartFlash = Math.max(0, s.heartFlash - realDt * 1.5);
      s.wiggle = Math.max(0, s.wiggle - realDt * 6);
      if (s.beam) {
        s.beam.t += realDt;
        if (s.beam.t >= BEAM_S) s.beam = null;
      }
      if (s.say) {
        s.say.life -= realDt;
        if (s.say.life <= 0) s.say = null;
      }
    }
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) this.startRound();
      return;
    }
    if (this.phase === "result" || this.phase === "final") {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.phase === "final") {
        this.finished = true;
        return;
      }
      this.blast += 1;
      this.phase = "intro";
      this.timer = INTRO_S;
      return;
    }

    this.stepSeats(dt);
    this.stepPresses(dt);
    this.stepBombs(dt);

    if (this.bombs.length === 0 && this.phase === "round") {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.spawnBomb();
    }
  }

  private startRound(): void {
    if (this.aliveCount() <= 1) {
      this.endMatch();
      return;
    }
    this.suddenDeath = isSuddenDeath(this.hearts);
    this.phase = "round";
    this.bombs = [];
    this.presses.clear();
    this.forceLive = false;
    for (const s of this.seats) {
      s.stuckT = 0;
      s.frozenT = 0;
      s.immuneT = 0;
      s.hauntedBy = -1;
      s.sinceThaw = 99;
      if (!s.alive) {
        s.hauntCd = Math.min(s.hauntCd, 1.5);
        s.botHauntAt = planBotHaunt(this.ctx.rng);
      }
    }
    if (this.suddenDeath) {
      this.callouts.show("SUDDEN DEATH!", GLUE_COLOR, { size: 72, life: 1.3, y: 0.5 });
      this.ctx.sfx.countdown();
      this.juice.shake(0.3);
    }
    this.spawnBomb();
  }

  private stepSeats(dt: number): void {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.stuckT > 0) s.stuckT = Math.max(0, s.stuckT - dt);
      if (s.immuneT > 0) s.immuneT = Math.max(0, s.immuneT - dt);
      if (s.frozenT > 0) {
        s.frozenT -= dt;
        if (s.frozenT <= 0) {
          s.frozenT = 0;
          s.immuneT = FREEZE_IMMUNE_S;
          s.sinceThaw = 0;
        }
      } else if (s.sinceThaw < 99) s.sinceThaw += dt;
      if (!s.alive) {
        s.hauntCd = Math.max(0, s.hauntCd - dt);
        if (s.player.kind === "bot") {
          s.botHauntAt -= dt;
          if (s.botHauntAt <= 0 && s.hauntCd <= 0) {
            s.botHauntAt = planBotHaunt(this.ctx.rng);
            const leader = botAimTarget(this.alive, i, this.hearts, this.ctx.rng, 0.6);
            this.haunt(i, leader ?? -1);
          }
        }
      }
    }
  }

  private stepPresses(dt: number): void {
    for (const p of this.presses.values()) {
      p.t += dt;
      if (!p.aiming && p.t >= AIM_HOLD_S) {
        p.aiming = true;
        p.aimAngle = this.seats[p.seat]!.zone.angle + Math.PI;
        this.ctx.sfx.select();
      }
      if (p.aiming) p.aimAngle += AIM_SWEEP_RAD_PER_S * dt;
    }
  }

  /** Charge tier a human press would throw with right now (hold time capped by time holding the bomb). */
  private pressTier(p: Press): ChargeTier {
    const s = this.seats[p.seat]!;
    const bomb = this.heldBy(p.seat);
    if (!bomb) return 0;
    return chargeTier(chargeSeconds(Math.min(p.t, bomb.heldT), s.hearts === 1));
  }

  private stepBombs(dt: number): void {
    for (const bomb of [...this.bombs]) {
      if (!this.bombs.includes(bomb)) continue;
      bomb.t += dt;
      bomb.spin += dt * 9;
      bomb.sinceThrow += dt;
      if (bomb.flight) {
        bomb.flight.t += dt;
        if (bomb.flight.t >= FLIGHT_S) {
          bomb.flight = null;
          this.ctx.sfx.select();
          this.onLanded(bomb);
        }
      } else {
        const wasTier = chargeTier(chargeSeconds(bomb.heldT, this.seats[bomb.holder]!.hearts === 1));
        bomb.heldT += dt;
        const holder = this.seats[bomb.holder]!;
        const tier = chargeTier(chargeSeconds(bomb.heldT, holder.hearts === 1));
        if (tier > wasTier) {
          this.ctx.sfx.streak(tier === 2 ? 5 : 2);
          this.juice.burst(holder.zone.cx, holder.zone.cy - 52, [tier === 2 ? GLUE_COLOR : STICKY_COLOR, "#ffffff"], {
            count: 12, speed: 140, gravity: 0, life: 0.35, size: 4,
          });
        }
        if (bomb.botIntent === "blunder" && bomb.heldT > 1.8 && !holder.say) this.say(holder, "uh oh...", 0.9);
      }

      // Split: a second live bomb flies off to someone else.
      if (bomb.kind === "split" && !bomb.splitDone && bomb.t >= SPLIT_AT_S) {
        bomb.splitDone = true;
        const from = bomb.holder;
        const to = pickTarget(this.alive, from, this.ctx.rng);
        if (to >= 0) {
          const odds = bombOdds(this.blast, this.suddenDeath);
          const twin = this.makeBomb("live", this.ctx.rng.float(odds.fuseMin, odds.fuseMax), to);
          twin.flight = { from, to, t: 0 };
          this.bombs.push(twin);
          const z = this.seats[from]!.zone;
          this.callouts.show("IT SPLIT!", "#FFB020", { size: 60, life: 1.1, y: 0.5 });
          this.ctx.sfx.streak(2);
          this.juice.shake(0.25);
          this.juice.burst(z.cx, z.cy - 40, ["#FFB020", "#FF3D7A", "#ffffff"], { count: 20, speed: 260, gravity: 300, life: 0.5 });
        }
      }

      // Hiss gets faster as the fuse burns down.
      const heat = Math.min(1, bomb.t / bomb.fuseS);
      bomb.hissT += dt;
      const hissPeriod = 0.55 - heat * heat * 0.47;
      if (bomb.hissT >= hissPeriod) {
        bomb.hissT = 0;
        this.ctx.sfx.tick();
      }

      // Bots throw after their planned hold (or as soon as their hands come unstuck).
      if (bomb.flight === null && bomb.botThrowAt !== null && bomb.heldT >= bomb.botThrowAt) {
        const holder = this.seats[bomb.holder]!;
        if (this.canThrow(holder)) {
          const tier = chargeTier(chargeSeconds(bomb.heldT, holder.hearts === 1));
          this.throwFrom(bomb.holder, bomb.botTarget ?? -1, tier);
        }
      }

      if (bomb.t >= bomb.fuseS) {
        if (bomb.kind === "dud") this.fizzle(bomb);
        else this.explode(bomb);
      }
    }
  }

  private bombPos(bomb: Bomb): { x: number; y: number } {
    const to = this.seats[bomb.holder]!.zone;
    if (!bomb.flight) {
      const shake = Math.pow(Math.min(1, bomb.t / bomb.fuseS), 2) * 7;
      return { x: to.cx + Math.sin(this.time * 61) * shake, y: to.cy - 52 + Math.cos(this.time * 47) * shake };
    }
    const from = this.seats[bomb.flight.from]!.zone;
    const p = Math.min(1, bomb.flight.t / FLIGHT_S);
    return {
      x: from.cx + (to.cx - from.cx) * p,
      y: from.cy - 52 + (to.cy - from.cy) * p - Math.sin(p * Math.PI) * 150,
    };
  }

  private fizzle(bomb: Bomb): void {
    const pos = this.bombPos(bomb);
    this.bombs = this.bombs.filter((b) => b !== bomb);
    this.juice.burst(pos.x, pos.y, ["#8a8f99", "#c9ced6", "rgba(244,247,251,0.5)"], {
      count: 22, speed: 90, gravity: -60, life: 0.9, size: 7,
    });
    this.callouts.show("PFFFT... A DUD!", "#c9ced6", { size: 62, life: 1.3, y: 0.5 });
    this.ctx.sfx.miss();
    this.juice.shake(0.1);
    const holder = this.seats[bomb.holder]!;
    if (holder.player.kind === "bot" && !bomb.flight) this.say(holder, "phew!", 1);
    if (this.bombs.length === 0) {
      this.forceLive = true;
      this.respawnTimer = RESPAWN_S;
    }
  }

  private explode(bomb: Bomb): void {
    const victimIdx = bomb.holder;
    const victim = this.seats[victimIdx]!;
    const pos = this.bombPos(bomb);
    this.bombs = [];
    victim.hearts = Math.max(0, victim.hearts - 1);
    victim.hit = 1;
    victim.heartFlash = 1;
    this.flash = 1;
    this.juice.hitStop(0.1);
    this.juice.shake(0.9);
    this.juice.burst(pos.x, pos.y, ["#FFB020", "#FF3D7A", "#ffffff", "#ff6a00"], { count: 46, speed: 520, gravity: 300, life: 0.8, size: 7 });
    this.juice.burst(pos.x, pos.y, ["#1a1a22", "#3a3a44", "#55555f"], { count: 30, speed: 220, gravity: -40, life: 1.3, size: 10 });
    this.juice.burst(victim.zone.x + 40, victim.zone.y + 52, [GLUE_COLOR, "#ffffff"], { count: 14, speed: 180, gravity: 300, life: 0.7, size: 5 });
    this.ctx.sfx.hit();
    this.presses.clear();

    // Near miss: whoever threw it a moment ago gets the adrenaline callout.
    if (bomb.thrower >= 0 && bomb.thrower !== victimIdx && isNearMiss(bomb.sinceThrow)) {
      const t = this.seats[bomb.thrower]!;
      this.pop(t.zone.cx, t.zone.cy - 104, "SO CLOSE!", t.player.color, 44, 1.4);
      this.ctx.sfx.streak(3);
      if (t.player.kind === "bot") this.say(t, "phew!", 1.2);
    }
    // Spook: a ghost whose haunt led to this blast gets the credit.
    let spookLine = "";
    if (victim.hauntedBy >= 0 && spookEarned(victim.frozenT, victim.sinceThaw)) {
      const ghost = this.seats[victim.hauntedBy]!;
      ghost.spooks += 1;
      spookLine = `SPOOKED BY ${ghost.player.name}!`;
      this.say(ghost, "gotcha!", 1.5);
    }
    victim.hauntedBy = -1;

    if (victim.hearts <= 0) {
      victim.alive = false;
      this.order.push(victimIdx);
      this.callouts.show(`${victim.player.name} IS OUT!`, victim.player.color, { size: 76, life: RESULT_OUT_S, y: 0.5 });
      this.resultText = spookLine || (this.aliveCount() > 1 ? "...and comes back as a GHOST" : `${victim.player.name} went KABOOM`);
      this.resultColor = spookLine ? ICE_COLOR : victim.player.color;
      victim.hauntCd = 1.5;
      victim.botHauntAt = planBotHaunt(this.ctx.rng);
      if (this.aliveCount() <= 1) {
        this.juice.slowMo(0.5, 0.3);
        this.endMatch();
        return;
      }
      this.phase = "result";
      this.timer = RESULT_OUT_S;
    } else {
      this.callouts.show(`${victim.player.name} LOSES A HEART`, victim.player.color, { size: 62, life: RESULT_HEART_S, y: 0.5 });
      if (victim.hearts === 1) {
        this.resultText = spookLine || "LAST HEART: HOT HANDS (charges faster)";
        this.resultColor = spookLine ? ICE_COLOR : STICKY_COLOR;
        if (victim.player.kind === "bot") this.say(victim, "not done yet!", 1.4);
      } else {
        this.resultText = spookLine || `${victim.hearts} hearts left`;
        this.resultColor = spookLine ? ICE_COLOR : "rgba(244,247,251,0.8)";
      }
      this.phase = "result";
      this.timer = RESULT_HEART_S;
    }
  }

  private endMatch(): void {
    this.phase = "final";
    this.timer = FINAL_S;
    this.bombs = [];
    const survivors = this.seats.filter((s) => s.alive);
    const text = survivors.length === 1 ? `${survivors[0]!.player.name} WINS!` : "NOBODY WINS";
    this.callouts.show(text, survivors.length === 1 ? survivors[0]!.player.color : "#F4F7FB", {
      size: 84, life: FINAL_S, y: 0.22,
    });
    this.resultText = "";
    this.ctx.sfx.win();
    for (const s of survivors) {
      this.juice.burst(s.zone.cx, s.zone.cy - 40, [s.player.color, "#FFB020", "#ffffff"], { count: 36, speed: 360, gravity: 350, life: 1 });
      if (s.player.kind === "bot") this.say(s, "too easy", 2);
    }
  }

  // ---------------------------------------------------------------- input

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human") continue;
      if (!inZone(s.zone, p.x, p.y)) continue;
      e.preventDefault();
      try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
      // Mashing while stuck or frozen wiggles you free a little faster.
      if (s.alive && (s.stuckT > 0 || s.frozenT > 0)) {
        if (s.stuckT > 0) s.stuckT = Math.max(0, s.stuckT - WIGGLE_S);
        if (s.frozenT > 0) s.frozenT = Math.max(0, s.frozenT - WIGGLE_S);
        s.wiggle = 1;
        this.ctx.sfx.tick();
      }
      this.presses.set(e.pointerId, { seat: i, t: 0, aiming: false, aimAngle: 0 });
      return;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const press = this.presses.get(e.pointerId);
    if (!press) return;
    this.presses.delete(e.pointerId);
    e.preventDefault();
    const s = this.seats[press.seat]!;
    const angles = this.seats.map((z) => z.zone.angle);
    const target = press.aiming ? pointedSeat(press.aimAngle, angles, this.alive, press.seat) : -1;
    if (s.alive) this.throwFrom(press.seat, target, this.pressTier(press));
    else this.haunt(press.seat, target);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.presses.delete(e.pointerId);
  };

  // ---------------------------------------------------------------- render

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (const s of this.seats) this.drawZone(g, s);
    this.drawRing(g);
    for (const s of this.seats) this.drawBeam(g, s);
    for (const s of this.seats) this.drawCharacter(g, s);
    for (const s of this.seats) this.drawCharge(g, s);
    this.drawAim(g);
    for (const b of this.bombs) this.drawBomb(g, b);
    this.juice.end(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,220,160,${this.flash * 0.45})`;
      g.fillRect(0, 0, width, height);
    }
    if (this.freezeFlash > 0) {
      g.fillStyle = `rgba(154,217,255,${this.freezeFlash * 0.18})`;
      g.fillRect(0, 0, width, height);
    }
    if (this.suddenDeath && this.phase === "round") this.drawVignette(g);
    for (const s of this.seats) this.drawLabels(g, s);
    for (const s of this.seats) this.drawSpeech(g, s);
    this.drawPops(g);
    if (this.phase !== "round") {
      // A dark band keeps the round text legible over the zone labels at the screen's midline.
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.fillRect(0, height * 0.4, width, height * (this.phase === "intro" ? 0.2 : 0.29));
    }
    this.drawCenter(g);
    this.callouts.draw(g, width, height);
  }

  private heldBy(seat: number): Bomb | undefined {
    return this.bombs.find((b) => b.flight === null && b.holder === seat);
  }

  private drawZone(g: CanvasRenderingContext2D, s: Seat): void {
    const z = s.zone;
    const held = this.heldBy(this.seats.indexOf(s));
    let alpha = s.alive ? 0.08 : 0.03;
    if (held && s.alive) {
      const heat = Math.min(1, held.t / held.fuseS);
      alpha = 0.16 + heat * 0.12 + Math.sin(this.time * (6 + heat * 18)) * 0.05;
    }
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = s.alive ? s.player.color : "#6b7280";
    g.fillRect(z.x, z.y, z.w, z.h);
    if (!s.alive && s.hauntCd <= 0 && this.phase === "round") {
      // A ready ghost's lair breathes icy blue.
      g.globalAlpha = 0.05 + Math.sin(this.time * 4) * 0.03;
      g.fillStyle = ICE_COLOR;
      g.fillRect(z.x, z.y, z.w, z.h);
    }
    g.restore();
    g.strokeStyle = "rgba(244,247,251,0.1)";
    g.lineWidth = 2;
    g.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
  }

  private drawRing(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    g.save();
    g.setLineDash([14, 12]);
    g.lineDashOffset = -this.time * 40;
    g.strokeStyle = this.suddenDeath ? "rgba(255,61,122,0.35)" : "rgba(244,247,251,0.12)";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(width / 2, height / 2, width * 0.22, height * 0.24, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private drawVignette(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const pulse = 0.18 + Math.sin(this.time * 5) * 0.08;
    const grad = g.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.85);
    grad.addColorStop(0, "rgba(255,61,122,0)");
    grad.addColorStop(1, `rgba(255,61,122,${pulse})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  private drawBeam(g: CanvasRenderingContext2D, s: Seat): void {
    if (!s.beam) return;
    const to = this.seats[s.beam.to]!.zone;
    const p = s.beam.t / BEAM_S;
    g.save();
    g.globalAlpha = 1 - p;
    g.strokeStyle = ICE_COLOR;
    g.lineWidth = 6;
    g.setLineDash([18, 10]);
    g.lineDashOffset = -this.time * 300;
    g.beginPath();
    g.moveTo(s.zone.cx, s.zone.cy - 10);
    g.lineTo(to.cx, to.cy - 30);
    g.stroke();
    g.restore();
  }

  private drawCharacter(g: CanvasRenderingContext2D, s: Seat): void {
    const z = s.zone;
    const sc = Math.min(1, this.ctx.height / 720);
    const idx = this.seats.indexOf(s);
    const held = this.heldBy(idx);
    const heat = held ? Math.min(1, held.t / held.fuseS) : 0;
    const bound = s.stuckT > 0 || s.frozenT > 0;
    g.save();
    g.translate(z.cx, z.cy);
    g.scale(sc, sc);
    if (!s.alive) {
      this.drawGhost(g, s, idx);
      g.restore();
      return;
    }
    if (held) g.translate(Math.sin(this.time * 55) * heat * heat * 6, 0);
    if (s.hit > 0) g.rotate(Math.sin(this.time * 30) * s.hit * 0.25);
    if (s.wiggle > 0) g.rotate(Math.sin(this.time * 60) * s.wiggle * 0.12);
    const pop = 1 + s.catchPop * 0.12;
    g.scale(pop, 1 / pop);

    const body = s.player.color;
    // Legs.
    g.strokeStyle = body;
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-12, 30); g.lineTo(-16, 58);
    g.moveTo(12, 30); g.lineTo(16, 58);
    g.stroke();
    // Body blob with a cheap halo (a translucent ring instead of a shadow blur).
    g.globalAlpha = 0.28;
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 0, 46, 50, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.ellipse(0, 0, 38, 42, 0, 0, Math.PI * 2);
    g.fill();
    // Soot smudges linger after a blast.
    if (s.hit > 0) {
      g.fillStyle = `rgba(10,10,14,${0.55 * s.hit})`;
      for (const [x, y, r] of [[-16, -10, 11], [14, 6, 13], [-4, 22, 9]] as const) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Last-heart flame: a little fire on the head.
    if (s.hearts === 1 && this.aliveCount() > 1) {
      const fl = 1 + Math.sin(this.time * 18 + idx) * 0.15;
      g.fillStyle = STICKY_COLOR;
      g.beginPath();
      g.moveTo(-9, -40);
      g.quadraticCurveTo(-14, -58 * fl, 0, -72 * fl);
      g.quadraticCurveTo(14, -58 * fl, 9, -40);
      g.closePath();
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.moveTo(-4, -42);
      g.quadraticCurveTo(-6, -52 * fl, 0, -60 * fl);
      g.quadraticCurveTo(6, -52 * fl, 4, -42);
      g.closePath();
      g.fill();
    }
    // Eyes.
    const eyeW = held ? 7 + heat * 3 : 6;
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.ellipse(-13, -10, eyeW, eyeW + 2, 0, 0, Math.PI * 2);
    g.ellipse(13, -10, eyeW, eyeW + 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#070b14";
    const look = held ? 0 : Math.sin(this.time * 2 + idx) * 2;
    g.beginPath();
    g.arc(-13 + look, -9, 3, 0, Math.PI * 2);
    g.arc(13 + look, -9, 3, 0, Math.PI * 2);
    g.fill();
    // Mouth: wide "O" of panic when holding, grimace when bound, smile otherwise.
    g.strokeStyle = "#070b14";
    g.lineWidth = 3;
    g.beginPath();
    if (held) g.ellipse(0, 12, 6 + heat * 5, 8 + heat * 6, 0, 0, Math.PI * 2);
    else if (bound) { g.moveTo(-10, 12); g.lineTo(10, 12); }
    else g.arc(0, 8, 10, 0.2, Math.PI - 0.2);
    g.stroke();
    // Hands: raised up to hold the bomb, otherwise at the sides.
    g.fillStyle = body;
    g.strokeStyle = body;
    g.lineWidth = 8;
    if (held) {
      g.beginPath();
      g.moveTo(-30, -6); g.lineTo(-20, -44);
      g.moveTo(30, -6); g.lineTo(20, -44);
      g.stroke();
      g.beginPath();
      g.arc(-20, -46, 8, 0, Math.PI * 2);
      g.arc(20, -46, 8, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(-34, 0); g.lineTo(-46, 26);
      g.moveTo(34, 0); g.lineTo(46, 26);
      g.stroke();
    }
    // Glue on the hands or an ice block over them.
    if (s.stuckT > 0) {
      g.fillStyle = GOO_COLOR;
      g.globalAlpha = 0.85;
      const drip = Math.min(1, 1 - s.stuckT / Math.max(0.01, s.stuckMax));
      for (const hx of [-24, 24]) {
        g.beginPath();
        g.ellipse(hx, -30, 16, 12, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(hx + 5, -12 + drip * 20, 5, 9 + drip * 6, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (s.frozenT > 0) {
      g.fillStyle = "rgba(154,217,255,0.55)";
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(-40, -64, 80, 46, 8);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(-20, -60); g.lineTo(-8, -44); g.lineTo(-14, -28);
      g.moveTo(18, -62); g.lineTo(10, -46); g.lineTo(22, -30);
      g.stroke();
    }
    g.restore();
  }

  private drawGhost(g: CanvasRenderingContext2D, s: Seat, idx: number): void {
    const bob = Math.sin(this.time * 3 + idx) * 6;
    const ready = s.hauntCd <= 0;
    g.translate(0, bob - 6);
    if (ready) {
      g.globalAlpha = 0.18 + Math.sin(this.time * 6) * 0.08;
      g.fillStyle = ICE_COLOR;
      g.beginPath();
      g.arc(0, 4, 52, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.6 + (ready ? Math.sin(this.time * 6) * 0.15 : 0);
    g.fillStyle = s.player.color;
    g.beginPath();
    g.arc(0, -8, 38, Math.PI, 0);
    g.lineTo(38, 30);
    for (let k = 0; k < 4; k++) {
      const x0 = 38 - k * 19;
      g.quadraticCurveTo(x0 - 9.5, 30 + Math.sin(this.time * 8 + k) * 8 + 14, x0 - 19, 30);
    }
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.globalAlpha = 0.9;
    g.fillStyle = "#070b14";
    for (const [ex, ey, rx, ry] of [[-13, -12, 6, 9], [13, -12, 6, 9], [0, 10, 7, ready ? 9 : 4]] as const) {
      g.beginPath();
      g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Haunt cooldown ring.
    g.globalAlpha = 1;
    g.lineWidth = 5;
    g.strokeStyle = "rgba(244,247,251,0.15)";
    g.beginPath();
    g.arc(0, 0, 58, 0, Math.PI * 2);
    g.stroke();
    const frac = 1 - Math.min(1, s.hauntCd / HAUNT_COOLDOWN_S);
    g.strokeStyle = ready ? ICE_COLOR : "rgba(154,217,255,0.5)";
    g.beginPath();
    g.arc(0, 0, 58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    g.stroke();
  }

  /** Charge arc around whoever holds a bomb: fills toward STICKY then GLUE. */
  private drawCharge(g: CanvasRenderingContext2D, s: Seat): void {
    const idx = this.seats.indexOf(s);
    const bomb = this.heldBy(idx);
    if (!bomb || !s.alive || this.phase !== "round") return;
    const lastHeart = s.hearts === 1;
    let heldS = bomb.heldT;
    if (s.player.kind === "human") {
      // Only the time the finger has been down counts toward the throw.
      let pressT = 0;
      for (const p of this.presses.values()) if (p.seat === idx) pressT = Math.max(pressT, p.t);
      heldS = Math.min(pressT, bomb.heldT);
    }
    const charge = chargeSeconds(heldS, lastHeart);
    const fill = chargeFill(charge);
    const tier = chargeTier(charge);
    const z = s.zone;
    const sc = Math.min(1, this.ctx.height / 720);
    const r = 74 * sc;
    const a0 = -Math.PI / 2;
    g.save();
    g.translate(z.cx, z.cy - 8 * sc);
    g.lineCap = "round";
    g.lineWidth = 7;
    g.strokeStyle = "rgba(244,247,251,0.14)";
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
    if (fill > 0) {
      g.strokeStyle = tier === 2 ? GLUE_COLOR : tier === 1 ? STICKY_COLOR : "rgba(244,247,251,0.7)";
      g.lineWidth = tier > 0 ? 9 : 7;
      g.beginPath();
      g.arc(0, 0, r, a0, a0 + Math.PI * 2 * fill);
      g.stroke();
    }
    // Tier ticks.
    for (const [at, col] of [[STICKY_AT_S / GLUE_AT_S, STICKY_COLOR], [1, GLUE_COLOR]] as const) {
      const a = a0 + Math.PI * 2 * at - (at === 1 ? 0.001 : 0);
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(Math.cos(a) * (r - 9), Math.sin(a) * (r - 9));
      g.lineTo(Math.cos(a) * (r + 9), Math.sin(a) * (r + 9));
      g.stroke();
    }
    if (tier > 0) {
      const pulse = 1 + Math.sin(this.time * 14) * 0.06;
      g.scale(pulse, pulse);
      g.font = `700 ${Math.round(28 * sc)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "top";
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.fillStyle = tier === 2 ? GLUE_COLOR : STICKY_COLOR;
      const label = tier === 2 ? "GLUE!" : "STICKY";
      g.strokeText(label, 0, r + 6);
      g.fillText(label, 0, r + 6);
    }
    g.restore();
  }

  private drawAim(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const angles = this.seats.map((s) => s.zone.angle);
    for (const p of this.presses.values()) {
      if (!p.aiming) continue;
      const s = this.seats[p.seat]!;
      const target = pointedSeat(p.aimAngle, angles, this.alive, p.seat);
      const color = s.alive ? s.player.color : ICE_COLOR;
      g.save();
      // Sweeping needle at the centre of the ring.
      g.translate(width / 2, height / 2);
      g.rotate(p.aimAngle);
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = 6;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(-20, 0);
      g.lineTo(width * 0.18, 0);
      g.stroke();
      g.beginPath();
      g.moveTo(width * 0.18 + 26, 0);
      g.lineTo(width * 0.18 - 4, -16);
      g.lineTo(width * 0.18 - 4, 16);
      g.closePath();
      g.fill();
      g.restore();
      if (target >= 0) {
        const tz = this.seats[target]!.zone;
        g.save();
        g.strokeStyle = color;
        g.lineWidth = 5;
        g.setLineDash([10, 8]);
        g.lineDashOffset = -this.time * 60;
        g.beginPath();
        g.arc(tz.cx, tz.cy - 10, 68 + Math.sin(this.time * 10) * 4, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }
  }

  private drawBomb(g: CanvasRenderingContext2D, bomb: Bomb): void {
    const pos = this.bombPos(bomb);
    const heat = Math.min(1, bomb.t / bomb.fuseS);
    const sc = Math.min(1, this.ctx.height / 720);
    g.save();
    g.translate(pos.x, pos.y);
    g.scale(sc, sc);
    if (bomb.flight) g.rotate(bomb.spin);
    // Heat glow.
    const glowR = 40 + heat * 60;
    const glow = g.createRadialGradient(0, 0, 10, 0, 0, glowR);
    const gg = Math.round(170 - heat * 130);
    glow.addColorStop(0, `rgba(255,${gg},40,${0.15 + heat * 0.5})`);
    glow.addColorStop(1, `rgba(255,${gg},40,0)`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, glowR, 0, Math.PI * 2);
    g.fill();
    // Goo trail on a charged throw.
    if (bomb.flight && bomb.stickTier > 0) {
      g.fillStyle = bomb.stickTier === 2 ? GLUE_COLOR : GOO_COLOR;
      g.globalAlpha = 0.7;
      for (let k = 1; k <= 3; k++) {
        g.beginPath();
        g.arc(-k * 14, k * 6, 9 - k * 2, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // Body.
    g.fillStyle = "#16161e";
    g.strokeStyle = `rgb(255,${Math.round(190 - heat * 150)},60)`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 26, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.arc(-9, -10, 9, 0, Math.PI * 2);
    g.fill();
    // Cap and fuse.
    g.fillStyle = "#5a5f6b";
    g.fillRect(-7, -34, 14, 10);
    g.strokeStyle = "#c9a26b";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -34);
    g.quadraticCurveTo(10, -50, 4, -58);
    g.stroke();
    // Spark: brighter and bigger as it burns down.
    const sparkR = 5 + heat * 6 + Math.sin(this.time * 40) * 2;
    g.fillStyle = "rgba(255,176,32,0.35)";
    g.beginPath();
    g.arc(4, -58, sparkR * (1.8 + heat), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#FFB020";
    g.beginPath();
    g.arc(4, -58, sparkR, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(4, -58, sparkR * 0.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawHeart(g: CanvasRenderingContext2D, x: number, y: number, r: number, filled: boolean, color: string): void {
    g.beginPath();
    g.moveTo(x, y + r);
    g.bezierCurveTo(x - r * 1.3, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.4);
    g.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.3, y - r * 0.1, x, y + r);
    g.closePath();
    if (filled) {
      g.fillStyle = color;
      g.fill();
    } else {
      g.strokeStyle = "rgba(244,247,251,0.3)";
      g.lineWidth = 2;
      g.stroke();
    }
  }

  private drawLabels(g: CanvasRenderingContext2D, s: Seat): void {
    const z = s.zone;
    const idx = this.seats.indexOf(s);
    const maxHearts = heartsFor(this.seats.length);
    g.save();
    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = `700 30px ${FONT}`;
    g.fillStyle = s.alive ? s.player.color : "rgba(244,247,251,0.5)";
    g.fillText(s.alive ? s.player.name : `${s.player.name} - GHOST`, z.x + 16, z.y + 10);
    // Hearts row.
    for (let h = 0; h < maxHearts; h++) {
      const flashing = s.heartFlash > 0 && h === s.hearts;
      const r = 9 + (flashing ? Math.sin(this.time * 30) * 3 : 0);
      this.drawHeart(g, z.x + 26 + h * 26, z.y + 56, r, h < s.hearts, flashing ? GLUE_COLOR : s.player.color);
    }
    g.font = `700 20px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.55)";
    const spooks = s.spooks > 0 ? `   Spooks ${s.spooks}` : "";
    g.fillText(`Nerve ${formatNerve(s.nerve)}${spooks}`, z.x + 16, z.y + 72);
    // Hint line at the bottom of the zone for human seats.
    if (s.player.kind === "human" && this.phase === "round") {
      g.textAlign = "center";
      g.textBaseline = "bottom";
      let hint = "tap to pass - hold to aim & charge";
      let color = "rgba(244,247,251,0.3)";
      let size = 22;
      if (!s.alive) {
        hint = s.hauntCd > 0 ? `haunt ready in ${s.hauntCd.toFixed(1)}s` : "TAP: HAUNT   HOLD: AIM";
        color = s.hauntCd > 0 ? "rgba(154,217,255,0.4)" : ICE_COLOR;
        size = s.hauntCd > 0 ? 22 : 28;
      } else if (s.frozenT > 0) {
        hint = "FROZEN! MASH TO THAW";
        color = ICE_COLOR;
        size = 28;
      } else if (s.stuckT > 0) {
        hint = "STUCK! MASH TO WIGGLE FREE";
        color = GOO_COLOR;
        size = 28;
      } else if (this.heldBy(idx)) {
        hint = "TAP: PASS   HOLD: AIM + CHARGE";
        color = STICKY_COLOR;
        size = 28;
      }
      g.fillStyle = color;
      g.font = `700 ${size}px ${FONT}`;
      g.fillText(hint, z.x + z.w / 2, z.y + z.h - 12);
    }
    g.restore();
  }

  private drawSpeech(g: CanvasRenderingContext2D, s: Seat): void {
    if (!s.say) return;
    const z = s.zone;
    const sc = Math.min(1, this.ctx.height / 720);
    const x = z.cx + 54 * sc;
    const y = z.cy - 78 * sc;
    g.save();
    g.globalAlpha = Math.min(1, s.say.life / 0.3);
    g.font = `700 22px ${FONT}`;
    const w = g.measureText(s.say.text).width + 20;
    g.fillStyle = "rgba(244,247,251,0.92)";
    g.beginPath();
    g.roundRect(x, y - 16, w, 32, 10);
    g.fill();
    g.beginPath();
    g.moveTo(x + 6, y + 14);
    g.lineTo(x - 6, y + 26);
    g.lineTo(x + 20, y + 16);
    g.closePath();
    g.fill();
    g.fillStyle = "#070b14";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(s.say.text, x + 10, y + 1);
    g.restore();
  }

  private drawPops(g: CanvasRenderingContext2D): void {
    for (const p of this.pops) {
      const t = 1 - p.life / p.maxLife;
      const scale = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1 - Math.min(0.1, (t - 0.15) * 0.5);
      g.save();
      g.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.35));
      g.translate(p.x, p.y);
      g.scale(scale, scale);
      g.font = `700 ${p.size}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 7;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(p.text, 0, 0);
      g.fillStyle = p.color;
      g.fillText(p.text, 0, 0);
      g.restore();
    }
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    let text = "";
    let color = "#F4F7FB";
    let size = 72;
    if (this.phase === "intro") {
      if (this.blast === 0) text = "ROUND 1 - HOLD IT!";
      else if (isSuddenDeath(this.hearts)) text = "SUDDEN DEATH";
      else text = `ROUND ${this.blast + 1}`;
      if (isSuddenDeath(this.hearts)) color = GLUE_COLOR;
    } else if (this.phase === "result") {
      text = this.resultText;
      color = this.resultColor;
      size = 44;
    } else return;
    if (!text) return;
    g.save();
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const y = height * (this.phase === "result" ? 0.63 : 0.5);
    g.strokeText(text, width / 2, y);
    g.fillStyle = color;
    g.fillText(text, width / 2, y);
    if (this.phase === "intro" && this.blast === 0) {
      g.font = `700 26px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.75)";
      g.lineWidth = 6;
      g.strokeText("HOLD LONGER = STICKIER THROW", width / 2, y + 54);
      g.fillText("HOLD LONGER = STICKIER THROW", width / 2, y + 54);
    }
    g.restore();
  }

  // ---------------------------------------------------------------- results

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    const scores = eliminationScores(this.order, this.seats.length);
    return this.seats.map((s, i) => ({ playerId: s.player.id, score: scores[i] ?? 0 }));
  }

  getStats(): GameStat[] {
    return this.seats.map((s) => ({
      playerId: s.player.id,
      label: "Nerve",
      value: s.spooks > 0 ? `${formatNerve(s.nerve)} +${s.spooks} spook${s.spooks === 1 ? "" : "s"}` : formatNerve(s.nerve),
    }));
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
    this.presses.clear();
  }
}
