import { PLAYER_BINDS } from "../../core/input";
import type { GameContext, GameDefinition, GameInstance, GameStat } from "../../core/types";
import { Callouts, Juice } from "../../fx/juice";
import { AIM_MAX, AIM_MIN, chooseTarget, planShot } from "./bots";
import { PERSONAS, personaFor, quip, type Persona, type QuipKind } from "./quips";
import { EVENTS, bountyReward, bountyTarget, hitCallout, koCallouts, pickEvent, suddenDeathTurn, underdogLuck, type EventId } from "./rules";
import { CRATE_R, FIGHTER_R, MAX_HP, TILE, WEAPONS, World, rollWeapon, type Blast, type Fighter, type Pickup, type Shot, type Weapon } from "./world";

type Phase = "roulette" | "aim" | "power" | "flight" | "between" | "event" | "over";

const ROULETTE_S = 1.4;
const AIM_TIMEOUT = 7;
const POWER_TIMEOUT = 5;
const LAVA_RISE = 30;
const MAX_TURNS = 80;
const KILLCAM_S = 1.5;
const JACKPOT = WEAPONS.filter((w) => w.rare);

interface Bubble {
  index: number;
  text: string;
  life: number;
  /** Fixed spot once the speaker is gone (last words). */
  x?: number;
  y?: number;
}

/**
 * Kaboom Isle: Worms-style artillery played only with taps.
 * Luck picks your weapon (slot roll), the wind, the crates and the chaos events.
 * Skill is timing: tap to stop the swinging aim needle, tap again to stop the power meter.
 */
export class KaboomIsle implements GameInstance {
  readonly world: World;
  phase: Phase = "between";
  current = -1;
  turn = 0;
  round = 0;
  private phaseT = 0.6;
  private clock = 0;
  private aimT = 0;
  private powerT = 0;
  angle = Math.PI / 2;
  power = 0;
  weapon: Weapon = WEAPONS[0]!;
  private rouletteFace = 0;
  private botTarget: { angle: number; power: number } | null = null;
  private done = false;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly floaters: { text: string; x: number; y: number; life: number; color: string; size: number }[] = [];
  private bubbles: Bubble[] = [];
  private ghosts: { x: number; y: number; color: string; life: number }[] = [];
  private terrainCache: HTMLCanvasElement | null = null;
  private cachedVersion = -1;
  private suddenDeath = false;
  private readonly personas: (Persona | null)[];
  private readonly bonusWeapon: (Weapon | null)[];
  bounty: number | null = null;
  private luckRoll = 0;
  private event: EventId | null = null;
  private lastEvent: EventId | null = null;
  private eventApplied = false;
  private firstBlood = false;
  private kosThisTurn = new Map<number, number>();
  private hitEnemyThisTurn = false;
  private killcam = 0;
  private cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0 };
  private flash = 0;

  constructor(private readonly ctx: GameContext) {
    this.world = new World(ctx.width, ctx.height, ctx.rng, ctx.players.length);
    this.juice = new Juice(() => ctx.rng.next());
    this.personas = ctx.players.map((p) => (p.kind === "bot" ? personaFor(p.slot) : null));
    this.bonusWeapon = ctx.players.map(() => null);
    this.cam.x = this.cam.tx = ctx.width / 2;
    this.cam.y = this.cam.ty = ctx.height / 2;
  }

  // ---------- flow ----------

  private nextTurn(): void {
    const alive = this.world.alive();
    if (alive.length <= 1 || this.turn >= MAX_TURNS) {
      this.endMatch();
      return;
    }
    const n = this.world.fighters.length;
    let next = this.current;
    for (let i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (this.world.fighters[next]!.alive) break;
    }
    const wrapped = this.current < 0 || next <= this.current;
    this.current = next;
    this.turn++;
    this.kosThisTurn.clear();
    this.hitEnemyThisTurn = false;
    if (this.turn > suddenDeathTurn(n)) {
      if (!this.suddenDeath) {
        this.callouts.show("SUDDEN DEATH", "#FF5A1F", { size: 72 });
        this.juice.shake(0.4);
      }
      this.suddenDeath = true;
      this.world.lava -= LAVA_RISE;
      // The lava may have just swallowed someone.
      for (const f of this.world.fighters) {
        if (f.alive && f.y + FIGHTER_R > this.world.lava) {
          this.world.kill(f, this.turn, null);
          this.onKo(f.index);
        }
      }
      if (this.world.alive().length <= 1) {
        this.endMatch();
        return;
      }
      if (!this.world.fighters[this.current]!.alive) {
        this.nextTurn();
        return;
      }
    }
    if (wrapped && this.startRound()) return;
    this.beginTurn();
  }

  /** New round: reset modifiers, maybe drop a crate, maybe roll a chaos event. Returns true if an event plays first. */
  private startRound(): boolean {
    this.round++;
    this.world.gravityScale = 1;
    this.world.windScale = 1;
    const rng = this.ctx.rng;
    if (this.round >= 2 && rng.next() < 0.55) {
      this.world.dropCrate();
      this.floaters.push({ text: "CRATE INBOUND!", x: this.ctx.width / 2, y: 110, life: 1.6, color: "#B8FF3D", size: 26 });
    }
    const ev = pickEvent(rng, this.round, this.lastEvent);
    if (!ev) return false;
    this.event = ev;
    this.lastEvent = ev;
    this.eventApplied = false;
    this.phase = "event";
    this.phaseT = 0;
    const info = EVENTS[ev];
    this.callouts.show(info.title, info.color, { size: 70, life: 1.8 });
    this.callouts.show(info.sub, "#F4F7FB", { size: 30, life: 1.8, y: 0.42 });
    this.ctx.sfx.streak(4);
    return true;
  }

  private applyEvent(ev: EventId): void {
    const w = this.world;
    switch (ev) {
      case "meteors":
        w.meteorShower(4 + w.fighters.length);
        break;
      case "quake":
        w.quake();
        this.juice.shake(1);
        this.ctx.sfx.hit();
        for (const f of w.alive()) if (this.ctx.rng.next() < 0.5) this.say(f.index, "flying");
        break;
      case "split": {
        const x = w.split();
        this.juice.shake(0.8);
        this.ctx.sfx.hit();
        if (x !== null) this.juice.burst(x, w.surfaceY(x - 20) ?? this.ctx.height / 2, ["#5b3a22", "#FF5A1F", "#FFB020"], { count: 40, speed: 380, size: 6 });
        break;
      }
      case "lowgrav":
        w.gravityScale = 0.45;
        this.ctx.sfx.whoosh();
        break;
      case "storm":
        w.windScale = 2.5;
        this.ctx.sfx.whoosh();
        break;
      case "supply":
        for (let i = 0; i < 3; i++) w.dropCrate(undefined, ((i + 0.5) / 3) * this.ctx.width + this.ctx.rng.float(-80, 80));
        break;
    }
  }

  private beginTurn(): void {
    const i = this.current;
    this.world.rollWind();
    this.bounty = bountyTarget(this.world.fighters);
    const bonus = this.bonusWeapon[i];
    this.luckRoll = bonus ? 0 : underdogLuck(this.world.fighters, i);
    this.weapon = bonus ?? rollWeapon(this.ctx.rng, this.luckRoll);
    this.bonusWeapon[i] = null;
    this.phase = "roulette";
    this.phaseT = ROULETTE_S;
    this.botTarget = null;
    this.angle = Math.PI / 2;
    this.power = 0;
    this.ctx.sfx.select();
    const persona = this.personas[i];
    if (persona && this.ctx.rng.next() < 0.6) this.sayText(i, this.ctx.rng.pick(PERSONAS[persona].turnLines));
  }

  private endMatch(): void {
    this.phase = "over";
    this.phaseT = 4.5;
    const alive = this.world.alive();
    if (alive.length === 1) {
      const p = this.ctx.players[alive[0]!.index]!;
      this.callouts.show(`${p.name.toUpperCase()} WINS`, p.color, { size: 80, life: 4 });
      this.say(alive[0]!.index, "win", 4);
      this.juice.burst(alive[0]!.x, alive[0]!.y, [p.color, "#FFE14D", "#F4F7FB"], { count: 60, speed: 520, size: 6, angle: -Math.PI / 2, spread: 1.6 });
    } else if (alive.length === 0) {
      this.callouts.show("NOBODY SURVIVED", "#F4F7FB", { size: 72, life: 4 });
    } else {
      this.callouts.show("TIME! MOST HP WINS", "#FFB020", { size: 64, life: 4 });
    }
    this.ctx.sfx.win();
  }

  private get isHumanTurn(): boolean {
    return this.ctx.players[this.current]?.kind === "human";
  }

  private tapped(): boolean {
    let tap = this.ctx.input.consumeClick() !== null;
    if (this.ctx.input.justPressed("Space")) tap = true;
    for (const bind of PLAYER_BINDS) if (this.ctx.input.justPressed(bind.action)) tap = true;
    return tap;
  }

  // ---------- chatter ----------

  private sayText(index: number, text: string, life = 1.9): void {
    const f = this.world.fighters[index];
    if (!f) return;
    this.bubbles = this.bubbles.filter((b) => b.index !== index || b.x !== undefined);
    this.bubbles.push(f.alive ? { index, text, life } : { index, text, life, x: f.x, y: Math.min(f.y, this.world.lava - 10) });
  }

  private say(index: number, kind: QuipKind, life = 1.9): void {
    this.sayText(index, quip(kind, this.ctx.rng), life);
  }

  private others(index: number): Fighter[] {
    return this.world.alive().filter((f) => f.index !== index);
  }

  // ---------- update ----------

  update(dt: number): void {
    const realDt = dt;
    dt = this.juice.update(dt);
    this.callouts.update(realDt);
    this.clock += realDt;
    this.flash = Math.max(0, this.flash - realDt * 3);
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 40 * realDt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i]!.life <= 0) this.floaters.splice(i, 1);
    for (const b of this.bubbles) b.life -= realDt;
    this.bubbles = this.bubbles.filter((b) => b.life > 0 && (b.x !== undefined || this.world.fighters[b.index]?.alive));
    for (const gh of this.ghosts) {
      gh.life -= realDt;
      gh.y -= 50 * realDt;
    }
    this.ghosts = this.ghosts.filter((gh) => gh.life > 0);
    this.updateCamera(realDt);

    const tap = this.tapped();
    const human = this.isHumanTurn;

    // Physics always runs so knockback settles between turns too.
    const before = this.world.fighters.map((f) => f.alive);
    const blasts = this.world.step(dt, this.turn);
    for (const b of blasts) this.onBlast(b);
    for (const p of this.world.pickups.splice(0)) this.onPickup(p);
    this.world.fighters.forEach((f, i) => {
      if (before[i] && !f.alive) this.onKo(i);
    });
    // Screaming while airborne after a big hit.
    for (const f of this.world.alive()) {
      if (!f.grounded && Math.hypot(f.vx, f.vy) > 700 && this.ctx.rng.next() < dt * 2 && !this.bubbles.some((b) => b.index === f.index)) this.say(f.index, "flying", 1);
    }

    switch (this.phase) {
      case "between":
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.nextTurn();
        break;
      case "event":
        this.phaseT += dt;
        if (!this.eventApplied && this.phaseT > 0.9) {
          this.eventApplied = true;
          this.applyEvent(this.event!);
        }
        if (this.eventApplied && ((this.world.settled() && this.phaseT > 2.2) || this.phaseT > 10)) {
          if (this.world.alive().length <= 1) this.endMatch();
          else if (!this.world.fighters[this.current]!.alive) this.nextTurn();
          else this.beginTurn();
        }
        break;
      case "roulette":
        this.phaseT -= dt;
        this.rouletteFace += dt * (4 + 26 * Math.max(0, this.phaseT / ROULETTE_S));
        if (this.phaseT <= 0) this.revealWeapon(human);
        break;
      case "aim": {
        this.phaseT += dt;
        this.aimT += dt;
        this.angle = Math.PI / 2 + (AIM_MAX - Math.PI / 2) * Math.sin(this.aimT * 1.9);
        const lock = human
          ? tap || this.phaseT > AIM_TIMEOUT
          : this.phaseT > 0.7 && (Math.abs(this.angle - this.botTarget!.angle) < 0.05 || this.phaseT > AIM_TIMEOUT);
        if (lock) {
          this.phase = "power";
          this.phaseT = 0;
          this.powerT = 0;
          this.ctx.sfx.tick();
        }
        break;
      }
      case "power": {
        this.phaseT += dt;
        this.powerT += dt;
        this.power = 0.5 - 0.5 * Math.cos(this.powerT * 3.4);
        const fire = human
          ? (tap && this.phaseT > 0.12) || this.phaseT > POWER_TIMEOUT
          : this.phaseT > 0.4 && (Math.abs(this.power - this.botTarget!.power) < 0.03 || this.phaseT > POWER_TIMEOUT);
        if (fire) this.fire();
        break;
      }
      case "flight":
        this.phaseT += dt;
        if ((this.world.settled() && this.phaseT > 0.5) || this.phaseT > 14) this.endFlight();
        break;
      case "over":
        this.phaseT -= realDt;
        if (this.phaseT <= 0 || (tap && this.phaseT < 3)) this.done = true;
        break;
    }
  }

  private revealWeapon(human: boolean): void {
    this.phase = "aim";
    this.aimT = this.ctx.rng.float(0, 6);
    this.phaseT = 0;
    const w = this.weapon;
    if (w.id === "nuke") {
      this.callouts.show("JACKPOT! MEGA NUKE", "#FF5A1F", { size: 60 });
      this.ctx.sfx.win();
      for (const f of this.others(this.current)) if (this.ctx.rng.next() < 0.6) this.say(f.index, "nuke");
    } else if (w.rare) {
      this.callouts.show(w.name + "!", w.color, { size: 52, life: 1 });
      this.ctx.sfx.streak(2);
    } else if (w.id === "chicken") {
      const o = this.others(this.current);
      if (o.length > 0) this.say(this.ctx.rng.pick(o).index, "laugh");
      this.ctx.sfx.miss();
    } else this.ctx.sfx.tick();
    if (this.luckRoll >= 0.3) this.floaters.push({ text: "UNDERDOG LUCK!", x: this.ctx.width / 2, y: 100, life: 1.4, color: "#B8FF3D", size: 24 });
    if (!human) {
      const persona = this.personas[this.current] ?? "hothead";
      const me = this.world.fighters[this.current]!;
      const target = chooseTarget(persona, me, this.world, { nemesis: this.world.lastHitBy[me.index] ?? null, bounty: this.bounty }, this.ctx.rng);
      this.botTarget = planShot(this.world, me, w, target, persona, this.ctx.rng, this.round <= 1 ? 1.8 : 1);
    }
  }

  private fire(): void {
    this.world.fire(this.current, this.angle, this.power, this.weapon);
    this.ctx.sfx.whoosh();
    this.phase = "flight";
    this.phaseT = 0;
    if (this.weapon.id === "sheep") {
      const o = this.others(this.current);
      if (o.length > 0) this.say(this.ctx.rng.pick(o).index, "sheep");
    }
    if (this.power > 0.97) this.floaters.push({ text: "MAX POWER!", x: this.world.fighters[this.current]!.x, y: this.world.fighters[this.current]!.y - 70, life: 1, color: "#FF3D7A", size: 24 });
  }

  private endFlight(): void {
    const w = this.weapon;
    if (!this.hitEnemyThisTurn && w.damage > 0 && this.world.fighters[this.current]?.alive && this.ctx.rng.next() < 0.55) {
      const o = this.others(this.current);
      if (o.length > 0) this.say(this.ctx.rng.pick(o).index, "phew");
    }
    this.phase = "between";
    this.phaseT = 0.8;
  }

  private onBlast(b: Blast): void {
    const fighters = this.world.fighters;
    if (b.teleport) {
      const t = b.teleport;
      this.juice.burst(t.fromX, t.fromY, ["#B98CFF", "#F4F7FB"], { count: 24, speed: 260, size: 5, gravity: -200 });
      this.juice.burst(b.x, b.y, ["#B98CFF", "#F4F7FB"], { count: 30, speed: 300, size: 5, gravity: -200 });
      this.ctx.sfx.streak(2);
      this.flash = 0.4;
      if (t.lava) this.callouts.show("TELEPORTED INTO LAVA", "#FF5A1F", { size: 54 });
      else if (t.swapped !== null) {
        this.callouts.show("SWAP!", "#B98CFF", { size: 60, life: 1 });
        this.say(t.swapped, "swap");
      } else this.say(b.owner, "teleport");
      return;
    }
    if (b.splash) {
      this.juice.burst(b.x, b.y, ["#FF5A1F", "#FFB020"], { count: 10, speed: 200, angle: -Math.PI / 2, spread: 1.2 });
      return;
    }
    if (b.flare) {
      this.juice.burst(b.x, b.y, ["#FF3D7A", "#FF8A3D"], { count: 16, speed: 180, angle: -Math.PI / 2, spread: 0.8, gravity: -100 });
      this.callouts.show("AIRSTRIKE INCOMING!", "#FF8A3D", { size: 48, life: 1.2 });
      this.ctx.sfx.go();
      for (const f of this.world.alive()) if (Math.abs(f.x - b.x) < 160 && f.index !== b.owner) this.sayText(f.index, "INCOMING!!", 1.4);
      return;
    }
    if (b.weapon.id === "chicken") {
      this.ctx.sfx.miss();
      this.floaters.push({ text: "SQUEAK", x: b.x, y: b.y - 20, life: 1.2, color: "#FFE14D", size: 26 });
      if (b.hits.length === 0) this.callouts.show("DUD!", "#FFE14D");
      if (b.owner >= 0 && fighters[b.owner]?.alive) this.say(b.owner, "chicken");
    } else {
      this.ctx.sfx.hit();
      this.juice.shake(Math.min(1, b.radius / 110));
      if (b.radius > 90) {
        this.juice.hitStop(0.1);
        this.flash = 1;
      }
      this.juice.burst(b.x, b.y, ["#FFB020", "#FF5A1F", "#F4F7FB", b.weapon.color], { count: Math.round(b.radius / 2), speed: b.radius * 6, size: 6 });
      this.juice.burst(b.x, b.y, ["#5b3a22", "#3d6b2a"], { count: 12, speed: 320, size: 5 });
      if (b.weapon.id === "trap") this.callouts.show("BOOBY TRAP!", "#FF3D7A", { size: 56, life: 1.1 });
      if (b.weapon.id === "sheep") this.floaters.push({ text: "BAAA!", x: b.x, y: b.y - 30, life: 1.2, color: "#FFFFFF", size: 30 });
    }
    let best = 0;
    for (const hit of b.hits) {
      const f = fighters[hit.index]!;
      this.floaters.push({ text: `-${hit.damage}`, x: f.x, y: f.y - 34, life: 1.1, color: "#FF3D7A", size: 20 + Math.min(20, hit.damage / 2) });
      const enemyHit = b.owner >= 0 && hit.index !== b.owner;
      if (enemyHit) {
        this.hitEnemyThisTurn = true;
        best = Math.max(best, hit.damage);
      }
      if (f.alive) {
        if (hit.index === b.owner) this.say(hit.index, "selfOwn");
        else this.say(hit.index, hit.damage >= 40 ? "bigOuch" : "ouch", 1.4);
      }
      // Bounty: chunk the leader, steal some health.
      if (enemyHit && hit.index === this.bounty) {
        const shooter = fighters[b.owner]!;
        if (shooter.alive) {
          const gain = Math.min(MAX_HP - shooter.hp, bountyReward(hit.damage, false));
          if (gain > 0) {
            shooter.hp += gain;
            this.floaters.push({ text: `+${gain} BOUNTY`, x: shooter.x, y: shooter.y - 50, life: 1.4, color: "#FFE14D", size: 24 });
          }
        }
      }
    }
    const line = hitCallout(best);
    if (line) {
      this.callouts.show(line, "#FFB020", { size: 50, life: 1, y: 0.22 });
      this.ctx.sfx.streak(2);
    }
  }

  private onPickup(p: Pickup): void {
    const c = p.crate;
    this.juice.burst(c.x, c.y, ["#c58b4a", "#FFE14D", "#F4F7FB"], { count: 20, speed: 260, size: 5 });
    if (c.kind === "trap") {
      if (p.by !== null && this.world.fighters[p.by]?.alive) this.say(p.by, "trap");
      return;
    }
    if (p.by === null) return;
    const f = this.world.fighters[p.by]!;
    const player = this.ctx.players[p.by]!;
    this.ctx.sfx.collect();
    if (c.kind === "health") {
      this.floaters.push({ text: "+35 HP", x: c.x, y: c.y - 20, life: 1.4, color: "#B8FF3D", size: 28 });
    } else {
      const w = this.ctx.rng.pick(JACKPOT);
      this.bonusWeapon[p.by] = w;
      this.callouts.show(`${player.name.toUpperCase()} GOT A ${w.name}`, w.color, { size: 40, life: 1.6, y: 0.2 });
    }
    if (f.alive) this.say(p.by, "crate");
  }

  private onKo(index: number): void {
    const f = this.world.fighters[index]!;
    const p = this.ctx.players[index]!;
    const inFlight = this.phase === "flight";
    const selfOwn = inFlight && index === this.current && (f.killedBy === null || f.killedBy === index);
    const killer = selfOwn ? index : f.killedBy;
    let koThisTurn = 0;
    if (killer !== null && killer !== index) {
      koThisTurn = (this.kosThisTurn.get(killer) ?? 0) + 1;
      this.kosThisTurn.set(killer, koThisTurn);
    }
    const lines = koCallouts({
      shooter: killer,
      victim: index,
      koThisTurn,
      firstBlood: !this.firstBlood,
      revenge: killer !== null && this.world.lastHitBy[killer] === index,
      bounty: index === this.bounty,
    });
    if (killer !== null && killer !== index) this.firstBlood = true;

    this.callouts.show(`${p.name.toUpperCase()} IS OUT`, p.color, { life: 1.6 });
    lines.forEach((line, i) => this.callouts.show(line, i === 0 ? "#FFE14D" : "#FF3D7A", { size: 54 - i * 6, life: 1.8, y: 0.45 + i * 0.09 }));

    // Last words, a ghost, and some gloating.
    const lava = f.y + FIGHTER_R >= this.world.lava - 4;
    this.say(index, lava && this.ctx.rng.next() < 0.5 ? "lavaWords" : "lastWords", 2.4);
    this.ghosts.push({ x: f.x, y: Math.min(f.y, this.world.lava - 10), color: p.color, life: 2.2 });
    if (selfOwn) {
      const o = this.others(index);
      if (o.length > 0) this.say(this.ctx.rng.pick(o).index, "laugh");
    } else if (killer !== null && this.world.fighters[killer]?.alive) {
      this.say(killer, "gloat");
      if (index === this.bounty) {
        const k = this.world.fighters[killer]!;
        const gain = Math.min(MAX_HP - k.hp, bountyReward(0, true));
        if (gain > 0) {
          k.hp += gain;
          this.floaters.push({ text: `+${gain} BOUNTY`, x: k.x, y: k.y - 50, life: 1.6, color: "#FFE14D", size: 26 });
        }
      }
    }
    if (index === this.bounty) this.bounty = null;

    this.juice.burst(f.x, Math.min(f.y, this.world.lava), [p.color, "#FF5A1F", "#FFB020"], { count: 40, speed: 420, size: 7 });
    this.juice.shake(0.5);
    // Slow-mo killcam on the victim.
    this.juice.slowMo(1.2, 0.3);
    this.killcam = KILLCAM_S;
    this.cam.tx = f.x;
    this.cam.ty = Math.min(f.y, this.world.lava - 40);
    this.ctx.sfx.streak(koThisTurn >= 2 ? 6 : 3);
  }

  private updateCamera(dt: number): void {
    this.killcam = Math.max(0, this.killcam - dt);
    const { width: w, height: h } = this.ctx;
    const zoomTarget = this.killcam > 0 && this.phase !== "over" ? 1.6 : 1;
    const tx = this.killcam > 0 ? this.cam.tx : w / 2;
    const ty = this.killcam > 0 ? this.cam.ty : h / 2;
    const k = 1 - Math.pow(0.004, dt);
    this.cam.zoom += (zoomTarget - this.cam.zoom) * k;
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  // ---------- render ----------

  render(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    const sky = g.createLinearGradient(0, 0, 0, h);
    const low = this.world.gravityScale < 1;
    sky.addColorStop(0, low ? "#0d0a26" : "#1a0f2e");
    sky.addColorStop(0.6, low ? "#24184a" : "#3a1530");
    sky.addColorStop(1, this.suddenDeath ? "#8a2412" : "#6b1d1d");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(244,247,251,0.5)";
    for (let i = 0; i < 40; i++) {
      const sx = (i * 197.3) % w;
      const sy = (i * 83.7) % (h * 0.5);
      const tw = 1 + ((i + Math.floor(this.clock * 2)) % 3 === 0 ? 1 : 0);
      g.fillRect(sx, sy, tw, tw);
    }

    this.juice.begin(g);
    g.save();
    const z = this.cam.zoom;
    const cx = Math.min(w - w / (2 * z), Math.max(w / (2 * z), this.cam.x));
    const cy = Math.min(h - h / (2 * z), Math.max(h / (2 * z), this.cam.y));
    g.translate(w / 2, h / 2);
    g.scale(z, z);
    g.translate(-cx, -cy);

    this.drawTerrain(g);
    this.drawCrates(g);
    this.drawLava(g);
    this.drawAim(g);
    for (const f of this.world.fighters) this.drawFighter(g, f.index);
    this.drawShots(g);
    this.drawGhosts(g);
    this.juice.drawParticles(g);
    for (const f of this.floaters) {
      g.globalAlpha = Math.min(1, f.life * 2);
      g.font = `700 ${f.size}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
    this.drawBubbles(g);
    g.restore();
    g.restore();

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,244,214,${Math.min(0.7, this.flash * 0.7)})`;
      g.fillRect(0, 0, w, h);
    }
    if (z > 1.05) {
      // Killcam letterbox.
      const bar = (z - 1) * 90;
      g.fillStyle = "#05070d";
      g.fillRect(0, 0, w, bar);
      g.fillRect(0, h - bar, w, bar);
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "left";
      g.fillStyle = "#FF3D7A";
      if (Math.floor(this.clock * 3) % 2 === 0) g.fillText("● KO CAM", 24, h - bar / 2 + 7);
    }
    this.drawHud(g);
    this.callouts.draw(g, w, h);
  }

  private drawTerrain(g: CanvasRenderingContext2D): void {
    const world = this.world;
    if (typeof document === "undefined") return;
    if (!this.terrainCache) {
      this.terrainCache = document.createElement("canvas");
      this.terrainCache.width = world.cols * TILE;
      this.terrainCache.height = world.rows * TILE;
    }
    if (this.cachedVersion !== world.version) {
      const t = this.terrainCache.getContext("2d")!;
      t.clearRect(0, 0, this.terrainCache.width, this.terrainCache.height);
      for (let r = 0; r < world.rows; r++) {
        for (let c = 0; c < world.cols; c++) {
          if (world.tiles[r * world.cols + c] !== 1) continue;
          const top = r === 0 || world.tiles[(r - 1) * world.cols + c] !== 1;
          const shade = ((c * 7 + r * 13) % 5) * 4;
          t.fillStyle = top ? "#5fcf4a" : `rgb(${110 + shade},${70 + shade / 2},${42})`;
          t.fillRect(c * TILE, r * TILE, TILE, top ? TILE + 2 : TILE);
        }
      }
      this.cachedVersion = world.version;
    }
    g.drawImage(this.terrainCache, 0, 0);
  }

  private drawLava(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    const top = this.world.lava;
    g.fillStyle = "#c2260f";
    g.beginPath();
    g.moveTo(0, h + 200);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, top + Math.sin(x * 0.03 + this.clock * 2.4) * 5);
    g.lineTo(w, h + 200);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,176,32,0.5)";
    for (let x = 0; x <= w; x += 16) g.fillRect(x, top + Math.sin(x * 0.03 + this.clock * 2.4) * 5, 16, 4);
    // Bubbles popping.
    g.fillStyle = "rgba(255,210,80,0.7)";
    for (let i = 0; i < 8; i++) {
      const t = (this.clock * 0.7 + i * 0.37) % 1;
      const bx = (i * 173 + 40) % w;
      g.beginPath();
      g.arc(bx, top + 14 - t * 10, 3 + t * 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawCrates(g: CanvasRenderingContext2D): void {
    for (const c of this.world.crates) {
      g.save();
      g.translate(c.x, c.y);
      if (!c.landed) {
        g.rotate(Math.sin(c.sway * 1.7) * 0.15);
        g.strokeStyle = "rgba(244,247,251,0.7)";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(-CRATE_R, -CRATE_R);
        g.lineTo(-22, -38);
        g.moveTo(CRATE_R, -CRATE_R);
        g.lineTo(22, -38);
        g.stroke();
        g.fillStyle = "#FF3D7A";
        g.beginPath();
        g.arc(0, -38, 24, Math.PI, 0);
        g.fill();
        g.fillStyle = "#F4F7FB";
        g.fillRect(-4, -62, 8, 24);
      }
      g.fillStyle = "#b07a3f";
      g.fillRect(-CRATE_R, -CRATE_R, CRATE_R * 2, CRATE_R * 2);
      g.strokeStyle = "#5b3a22";
      g.lineWidth = 2;
      g.strokeRect(-CRATE_R, -CRATE_R, CRATE_R * 2, CRATE_R * 2);
      g.fillStyle = "#FFE14D";
      g.font = "700 16px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("?", 0, 1);
      g.textBaseline = "alphabetic";
      g.restore();
    }
  }

  private drawFighter(g: CanvasRenderingContext2D, index: number): void {
    const f = this.world.fighters[index]!;
    if (!f.alive) return;
    const p = this.ctx.players[index]!;
    const persona = this.personas[index];
    const active = index === this.current && this.phase !== "over";
    const aiming = active && (this.phase === "aim" || this.phase === "power");
    const speed = Math.hypot(f.vx, f.vy);
    const flying = !f.grounded && speed > 260;
    g.save();
    g.translate(f.x, f.y);
    const squash = f.grounded ? 1 + Math.sin(this.clock * 6 + index) * 0.04 : 1 + Math.min(0.25, speed / 3000);
    g.scale(1 / squash, squash);
    g.fillStyle = f.hurt > 0 && Math.floor(this.clock * 20) % 2 === 0 ? "#ffffff" : p.color;
    g.shadowColor = p.color;
    g.shadowBlur = active ? 20 : 8;
    g.beginPath();
    g.arc(0, 0, FIGHTER_R, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;

    // Face
    const look = aiming ? this.angle : f.x < this.ctx.width / 2 ? 0.2 : Math.PI - 0.2;
    const blink = !aiming && (this.clock * 0.7 + index * 0.31) % 3 < 0.08;
    g.strokeStyle = "#070b14";
    g.fillStyle = "#070b14";
    g.lineWidth = 2;
    if (f.hurt > 0) {
      // >_< squint
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 8, -6);
        g.lineTo(s * 3, -3);
        g.lineTo(s * 8, 0);
        g.stroke();
      }
    } else if (blink) {
      for (const ex of [-5, 5]) {
        g.beginPath();
        g.moveTo(ex - 3, -3);
        g.lineTo(ex + 3, -3);
        g.stroke();
      }
    } else {
      const eyeR = flying ? 5.5 : 4.5;
      for (const ex of [-5, 5]) {
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(ex, -3, eyeR, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#070b14";
        g.beginPath();
        g.arc(ex + Math.cos(look) * 2, -3 - Math.sin(look) * 2, flying ? 1.6 : 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Brows by personality.
    g.strokeStyle = "#070b14";
    g.lineWidth = 2;
    if (persona === "hothead" || (aiming && !persona)) {
      g.beginPath();
      g.moveTo(-9, -10);
      g.lineTo(-2, -7);
      g.moveTo(9, -10);
      g.lineTo(2, -7);
      g.stroke();
    } else if (persona === "grudge") {
      g.beginPath();
      g.moveTo(-9, -9);
      g.lineTo(9, -9);
      g.stroke();
    }
    // Mouth
    g.fillStyle = "#070b14";
    if (f.hurt > 0 || flying) {
      g.beginPath();
      g.ellipse(0, 7, 3.5, flying ? 4.5 : 3, 0, 0, Math.PI * 2);
      g.fill();
    } else if (f.hp < 30) {
      g.beginPath();
      g.moveTo(-5, 7);
      for (let i = 0; i <= 4; i++) g.lineTo(-5 + i * 2.5, 7 + (i % 2 === 0 ? 0 : -2));
      g.stroke();
    } else if (aiming) {
      g.beginPath();
      g.arc(0, 4, 5, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      g.fillStyle = "#FF6B9A";
      g.beginPath();
      g.arc(3, 8, 2.4, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.arc(0, 4, 4.5, 0.2 * Math.PI, 0.8 * Math.PI);
      g.stroke();
    }
    if (persona === "clown") {
      g.fillStyle = "#FF2D2D";
      g.beginPath();
      g.arc(0, 2, 3, 0, Math.PI * 2);
      g.fill();
    } else if (persona === "sniper") {
      g.fillStyle = "#1f2937";
      g.fillRect(-FIGHTER_R + 1, -13, FIGHTER_R * 2 - 2, 3);
      g.fillRect(FIGHTER_R - 2, -14, 7, 2);
    }
    if (f.hp < 30) {
      // Sweat drop.
      g.fillStyle = "#7fd4ff";
      g.beginPath();
      g.arc(11, -9 + ((this.clock * 20) % 6), 2.5, 0, Math.PI * 2);
      g.fill();
    }
    if (index === this.bounty) {
      // Gold crown for the leader with a price on their head.
      g.fillStyle = "#FFD23F";
      g.beginPath();
      g.moveTo(-9, -FIGHTER_R + 1);
      g.lineTo(-9, -FIGHTER_R - 9);
      g.lineTo(-4.5, -FIGHTER_R - 4);
      g.lineTo(0, -FIGHTER_R - 11);
      g.lineTo(4.5, -FIGHTER_R - 4);
      g.lineTo(9, -FIGHTER_R - 9);
      g.lineTo(9, -FIGHTER_R + 1);
      g.closePath();
      g.fill();
    }
    g.restore();

    // HP bar + name
    const bw = 40;
    const top = f.y - FIGHTER_R - (index === this.bounty ? 22 : 14);
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(f.x - bw / 2, top, bw, 6);
    g.fillStyle = f.hp > 50 ? "#B8FF3D" : f.hp > 25 ? "#FFB020" : "#FF3D7A";
    g.fillRect(f.x - bw / 2, top, (bw * Math.max(0, f.hp)) / MAX_HP, 6);
    g.font = "600 14px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillStyle = "#F4F7FB";
    g.fillText(p.name, f.x, top - 6);
    if (active) {
      const bob = Math.sin(this.clock * 6) * 4;
      g.fillStyle = p.color;
      g.beginPath();
      g.moveTo(f.x - 8, top - 34 + bob);
      g.lineTo(f.x + 8, top - 34 + bob);
      g.lineTo(f.x, top - 24 + bob);
      g.closePath();
      g.fill();
    }
  }

  private drawGhosts(g: CanvasRenderingContext2D): void {
    for (const gh of this.ghosts) {
      g.globalAlpha = Math.min(0.75, gh.life / 2);
      const wob = Math.sin(this.clock * 5 + gh.x) * 6;
      g.fillStyle = "#F4F7FB";
      g.beginPath();
      g.arc(gh.x + wob, gh.y, 12, Math.PI, 0);
      g.lineTo(gh.x + wob + 12, gh.y + 14);
      for (let i = 0; i < 4; i++) g.lineTo(gh.x + wob + 12 - (i + 0.5) * 6, gh.y + (i % 2 === 0 ? 9 : 14));
      g.lineTo(gh.x + wob - 12, gh.y + 14);
      g.closePath();
      g.fill();
      g.fillStyle = gh.color;
      g.fillRect(gh.x + wob - 6, gh.y - 3, 3, 4);
      g.fillRect(gh.x + wob + 3, gh.y - 3, 3, 4);
    }
    g.globalAlpha = 1;
  }

  private drawBubbles(g: CanvasRenderingContext2D): void {
    g.font = "700 15px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const b of this.bubbles) {
      const f = this.world.fighters[b.index]!;
      const x0 = b.x ?? f.x;
      const y0 = (b.y ?? f.y) - 64;
      const tw = g.measureText(b.text).width + 16;
      const x = Math.min(this.ctx.width - tw / 2 - 4, Math.max(tw / 2 + 4, x0));
      const y = Math.max(18, y0);
      g.globalAlpha = Math.min(1, b.life * 3);
      g.fillStyle = "#F4F7FB";
      g.beginPath();
      g.roundRect(x - tw / 2, y - 12, tw, 24, 8);
      g.moveTo(x0 - 5, y + 11);
      g.lineTo(x0, y + 20);
      g.lineTo(x0 + 5, y + 11);
      g.fill();
      g.strokeStyle = this.ctx.players[b.index]?.color ?? "#070b14";
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "#070b14";
      g.fillText(b.text, x, y + 1);
    }
    g.globalAlpha = 1;
    g.textBaseline = "alphabetic";
  }

  private drawAim(g: CanvasRenderingContext2D): void {
    if (this.phase !== "aim" && this.phase !== "power") return;
    const f = this.world.fighters[this.current]!;
    const p = this.ctx.players[this.current]!;
    const len = this.phase === "power" ? 40 + this.power * 90 : 90;
    const ex = f.x + Math.cos(this.angle) * len;
    const ey = f.y - Math.sin(this.angle) * len;
    // Swing arc
    g.strokeStyle = "rgba(244,247,251,0.15)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(f.x, f.y, 90, -AIM_MAX, -AIM_MIN);
    g.stroke();
    g.strokeStyle = this.phase === "power" ? powerColor(this.power) : p.color;
    g.lineWidth = 5;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(f.x, f.y);
    g.lineTo(ex, ey);
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.beginPath();
    g.arc(ex, ey, 7, 0, Math.PI * 2);
    g.fill();
    if (this.phase === "power") {
      // Power meter beside the fighter
      const bx = f.x + (f.x < this.ctx.width - 80 ? 34 : -46);
      const by = f.y - 60;
      g.fillStyle = "rgba(7,11,20,0.75)";
      g.fillRect(bx, by, 12, 70);
      g.fillStyle = powerColor(this.power);
      g.fillRect(bx, by + 70 * (1 - this.power), 12, 70 * this.power);
    }
  }

  private drawShots(g: CanvasRenderingContext2D): void {
    for (const s of this.world.shots) {
      const fiery = s.weapon.id === "meteor";
      g.strokeStyle = fiery ? "rgba(255,138,61,0.55)" : s.weapon.id === "teleport" ? "rgba(185,140,255,0.5)" : "rgba(244,247,251,0.25)";
      g.lineWidth = fiery ? 6 : 2;
      g.beginPath();
      s.trail.forEach((pt, i) => (i === 0 ? g.moveTo(pt.x, pt.y) : g.lineTo(pt.x, pt.y)));
      g.stroke();
      this.drawShot(g, s);
    }
  }

  private drawShot(g: CanvasRenderingContext2D, s: Shot): void {
    const id = s.weapon.id;
    g.save();
    g.translate(s.x, s.y);
    const heading = Math.atan2(s.vy, s.vx);
    if (id === "sheep") {
      g.scale(s.vx < 0 ? -1 : 1, 1);
      g.fillStyle = "#FFFFFF";
      for (const [ox, oy] of [[-5, 0], [0, -3], [5, 0], [0, 3]] as const) {
        g.beginPath();
        g.arc(ox, oy, 6, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#1f2937";
      g.beginPath();
      g.ellipse(10, -2, 4.5, 3.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-6, 6, 2, 5);
      g.fillRect(4, 6, 2, 5);
    } else if (id === "banana") {
      g.rotate(this.clock * 8);
      g.strokeStyle = "#FFE14D";
      g.lineWidth = s.mini ? 4 : 6;
      g.lineCap = "round";
      g.beginPath();
      g.arc(0, -4, s.mini ? 6 : 9, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else if (id === "drill") {
      g.rotate(heading);
      g.fillStyle = "#C0C8D8";
      g.beginPath();
      g.moveTo(12, 0);
      g.lineTo(-6, -6);
      g.lineTo(-6, 6);
      g.closePath();
      g.fill();
      g.strokeStyle = "#5b6475";
      g.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const xx = -3 + i * 4 + ((this.clock * 30) % 4);
        g.beginPath();
        g.moveTo(xx, -5 + i * 1.2);
        g.lineTo(xx + 2, 5 - i * 1.2);
        g.stroke();
      }
    } else if (id === "meteor") {
      g.fillStyle = "#FFB020";
      g.beginPath();
      g.arc(0, 0, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#5b3a22";
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
    } else if (id === "teleport") {
      g.fillStyle = "#B98CFF";
      g.shadowColor = "#B98CFF";
      g.shadowBlur = 16;
      g.beginPath();
      g.arc(0, 0, 7 + Math.sin(this.clock * 20) * 2, 0, Math.PI * 2);
      g.fill();
    } else {
      const r = s.mini ? 4 : id === "nuke" ? 10 : 6;
      g.fillStyle = id === "bomb" || (id === "airstrike" && s.mini) ? "#1f2937" : s.weapon.color;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = s.weapon.color;
      g.lineWidth = 2;
      g.stroke();
    }
    g.restore();
    if (s.weapon.fuse !== undefined && !s.mini) {
      g.fillStyle = "#F4F7FB";
      g.font = "700 14px Outfit, sans-serif";
      g.textAlign = "center";
      g.fillText(Math.max(0, s.weapon.fuse - s.age).toFixed(1), s.x, s.y - 14);
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    g.textBaseline = "middle";
    // Wind + round
    const wind = this.world.wind * this.world.windScale;
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(w - 200, 14, 180, 40);
    g.fillStyle = "#F4F7FB";
    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    g.fillText("WIND", w - 190, 34);
    g.fillStyle = this.world.windScale > 1 ? "#FF3D7A" : "#3EE0FF";
    const cx = w - 90;
    const bar = Math.max(-1.2, Math.min(1.2, wind / 1.5)) * 60;
    g.fillRect(bar < 0 ? cx + bar : cx, 30, Math.abs(bar), 8);
    g.fillStyle = "#F4F7FB";
    g.fillRect(cx - 1, 24, 2, 20);
    g.textAlign = "right";
    g.font = "700 18px Bebas Neue, Impact, sans-serif";
    g.fillStyle = "#cbd5e1";
    const mods: string[] = [`ROUND ${Math.max(1, this.round)}`];
    if (this.world.gravityScale < 1) mods.push("LOW GRAVITY");
    if (this.world.windScale > 1) mods.push("WIND STORM");
    g.fillText(mods.join(" · "), w - 22, 68);

    // Roster
    g.textAlign = "left";
    this.ctx.players.forEach((pl, i) => {
      const f = this.world.fighters[i]!;
      const y = 96 + i * 24;
      g.globalAlpha = f.alive ? 1 : 0.4;
      g.fillStyle = pl.color;
      g.beginPath();
      g.arc(32, y, 7, 0, Math.PI * 2);
      g.fill();
      g.font = "600 15px Outfit, sans-serif";
      g.fillStyle = "#F4F7FB";
      const persona = this.personas[i];
      const tag = persona ? ` (${PERSONAS[persona].tag})` : "";
      const status = f.alive ? `${Math.max(0, Math.round(f.hp))} HP` : "OUT";
      let label = `${pl.name}${tag}  ${status}${f.kos ? `  KO ${f.kos}` : ""}`;
      g.fillText(label, 46, y + 1);
      let tx = 46 + g.measureText(label).width;
      if (i === this.bounty) {
        label = "  BOUNTY";
        g.fillStyle = "#FFD23F";
        g.fillText(label, tx, y + 1);
        tx += g.measureText(label).width;
      }
      const bonus = this.bonusWeapon[i];
      if (bonus) {
        g.fillStyle = bonus.color;
        g.fillText(`  NEXT: ${bonus.name}`, tx, y + 1);
      }
    });
    g.globalAlpha = 1;

    // Turn + weapon card
    if (this.current >= 0 && this.phase !== "over") {
      const p = this.ctx.players[this.current]!;
      g.textAlign = "left";
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillStyle = p.color;
      g.fillText(`${p.name.toUpperCase()}'S TURN`, 24, 34);
      if (this.suddenDeath) {
        g.fillStyle = "#FF5A1F";
        g.font = "700 20px Bebas Neue, Impact, sans-serif";
        g.fillText("SUDDEN DEATH · LAVA RISING", 24, 62);
      }
      if (this.phase !== "event") {
        const shown = this.phase === "roulette" ? WEAPONS[Math.floor(this.rouletteFace) % WEAPONS.length]! : this.weapon;
        const cardW = 300;
        const x = w / 2 - cardW / 2;
        g.fillStyle = "rgba(7,11,20,0.75)";
        g.fillRect(x, 12, cardW, 58);
        g.strokeStyle = shown.color;
        g.lineWidth = shown.rare && this.phase !== "roulette" ? 3 + Math.sin(this.clock * 10) * 1.5 : 3;
        g.strokeRect(x, 12, cardW, 58);
        g.textAlign = "center";
        g.fillStyle = shown.color;
        g.font = "700 30px Bebas Neue, Impact, sans-serif";
        g.fillText(shown.name, w / 2, 34);
        g.fillStyle = "#cbd5e1";
        g.font = "500 14px Outfit, sans-serif";
        g.fillText(this.phase === "roulette" ? "spinning…" : shown.blurb, w / 2, 56);
      }

      if (this.isHumanTurn && (this.phase === "aim" || this.phase === "power")) {
        const msg = this.phase === "aim" ? "TAP TO LOCK AIM" : "TAP TO FIRE";
        const pulse = 0.75 + 0.25 * Math.sin(this.clock * 8);
        g.globalAlpha = pulse;
        g.textAlign = "center";
        g.font = "700 40px Bebas Neue, Impact, sans-serif";
        g.lineWidth = 6;
        g.strokeStyle = "rgba(7,11,20,0.8)";
        g.strokeText(msg, w / 2, h - 30);
        g.fillStyle = "#F4F7FB";
        g.fillText(msg, w / 2, h - 30);
        g.globalAlpha = 1;
      }
    }
    g.textBaseline = "alphabetic";
  }

  // ---------- lifecycle ----------

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((player, i) => {
      const f = this.world.fighters[i]!;
      return { playerId: player.id, score: f.alive ? 1000 + f.hp : f.diedOnTurn };
    });
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    this.ctx.players.forEach((player, i) => {
      const f = this.world.fighters[i]!;
      stats.push({ playerId: player.id, label: "Damage", value: String(f.damageDealt) });
      stats.push({ playerId: player.id, label: "KOs", value: String(f.kos) });
      if (f.bestHit > 0) stats.push({ playerId: player.id, label: "Best hit", value: String(f.bestHit) });
      if (f.crates > 0) stats.push({ playerId: player.id, label: "Crates", value: String(f.crates) });
    });
    return stats;
  }

  destroy(): void {
    this.terrainCache = null;
  }
}

function powerColor(p: number): string {
  return p > 0.8 ? "#FF3D7A" : p > 0.5 ? "#FFB020" : "#B8FF3D";
}

export const kaboomIsle: GameDefinition = {
  id: "kaboom-isle",
  name: "Kaboom Isle",
  tagline: "Tap-timed artillery. Banana bombs. Homing sheep. Lava below.",
  description:
    "Blobs with opinions on crumbling floating islands over lava. Each turn a slot spins your weapon: bomb, bouncer, cluster, triple, boxing glove, drill, teleporter, or the jackpot tier (homing sheep, airstrike, banana bomb, Mega Nuke)... or a rubber chicken. Tap to stop the swinging aim needle, tap again to stop the power meter. Crates parachute in (health, jackpot weapons, or booby traps), chaos events hit mid-match (meteor showers, earthquakes, the island splitting, low gravity, wind storms), the leader wears a bounty that heals whoever hits them, and losing blobs get luckier rolls. KOs play in slow-mo with an announcer. After six rounds the lava rises. Last blob standing wins.",
  durationMs: 0,
  controls: "Tap to lock aim · tap again to fire (or any action key)",
  create: (ctx) => new KaboomIsle(ctx),
};
