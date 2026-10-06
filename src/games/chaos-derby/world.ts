import Matter from "matter-js";
import type { Rng } from "../../core/rng";
import { type Placeable, type RacerEntry, type RacerSpec, type RacerStats } from "./rules";

const { Engine, Bodies, Body, Composite, Events } = Matter;

/**
 * The race as a matter-js world. Every racer is a real body on a side-on track:
 * they run, jump, clip hurdles, get flattened by boulders and tumble over.
 * Lanes are separate collision layers so racers never block each other, but
 * hills, boulders and earthquakes hit everyone.
 */

export const FINISH_X = 7400;
export const STEP = 1 / 60;
/** Race time after which the game gives up and ranks by distance. */
export const MAX_RACE_S = 120;

const GROUND = 0x0001;
const BOULDER = 0x0100;
const laneBit = (lane: number): number => 0x0002 << lane;
const ALL_LANES = 0x007e;

const FALL_ANGLE = 0.95;
const GETUP_S = 0.45;

export type Mood =
  | "focused"
  | "smug"
  | "happy"
  | "panic"
  | "dizzy"
  | "angry"
  | "tired"
  | "sleep"
  | "confused"
  | "pain"
  | "win"
  | "sad";

export type RunnerMode = "run" | "fallen" | "getup" | "finished";

export interface Runner extends Placeable {
  spec: RacerSpec;
  odds: string;
  stats: RacerStats;
  body: Matter.Body;
  w: number;
  h: number;
  mode: RunnerMode;
  modeT: number;
  grounded: boolean;
  /** 1 = towards the finish, -1 = wrong way. */
  dir: 1 | -1;
  /** Distance the feet have covered, drives the leg cycle. */
  stride: number;
  stamina: number;
  pace: number;
  paceT: number;
  getUpAt: number;
  sleeping: boolean;
  wrongT: number;
  boostT: number;
  slowT: number;
  stopT: number;
  dizzyT: number;
  charT: number;
  mudded: boolean;
  springT: number;
  finishTime: number;
  falls: number;
  stuckT: number;
  /** Seconds a flattened racer can't be hit by a boulder again. */
  immuneT: number;
  /** Counts down after a hard landing; drives the squash in the drawing. */
  landT: number;
  hopT: number;
  wasGrounded: boolean;
  mood: Mood;
  decisions: Map<number, number>;
}

export type ItemKind = "hurdle" | "crate";

export interface Item {
  id: number;
  kind: ItemKind;
  lane: number;
  body: Matter.Body;
  w: number;
  h: number;
}

export interface Patch {
  kind: "banana" | "spring" | "mud";
  lane: number;
  x: number;
  w: number;
  used: boolean;
}

export interface Hill {
  body: Matter.Body;
  x0: number;
  x1: number;
  top0: number;
  top1: number;
  height: number;
}

export interface Boulder {
  body: Matter.Body;
  r: number;
  life: number;
}

export interface DerbyEvent {
  kind: string;
  /** Lane it happened in, or null for the whole field. */
  lane: number | null;
  /** Comic text over the racer. */
  pop?: string;
  /** Big centre-screen text. */
  callout?: string;
  shake?: number;
  sound: "hit" | "tick" | "boost" | "miss" | "big" | "none";
}

const BAD_EVENTS = ["trip", "sneeze", "nap", "wrongway", "distracted", "cramp", "lightning"] as const;
const GOOD_EVENTS = ["boost", "secondwind"] as const;
const FIELD_EVENTS = ["boulder", "quake", "gust", "crates"] as const;

export class DerbyWorld {
  readonly engine: Matter.Engine;
  readonly runners: Runner[];
  readonly items: Item[] = [];
  readonly patches: Patch[] = [];
  readonly hills: Hill[] = [];
  readonly boulders: Boulder[] = [];
  time = 0;
  finishedCount = 0;
  gust = 0;
  gustT = 0;
  private nextEvent: number;
  private nextId = 1;
  private readonly hits: Matter.Pair[] = [];
  private readonly out: DerbyEvent[] = [];
  private readonly onCollide = (e: Matter.IEventCollision<Matter.Engine>): void => {
    for (const pair of e.pairs) this.hits.push(pair);
  };

  /** `events: false` turns off random events (for tests). */
  constructor(
    entries: readonly RacerEntry[],
    private readonly rng: Rng,
    private readonly opts: { events?: boolean } = {},
  ) {
    this.engine = Engine.create({ gravity: { x: 0, y: 1.3, scale: 0.001 }, enableSleeping: true });
    const ground = Bodies.rectangle(FINISH_X / 2, 200, FINISH_X + 8000, 400, {
      isStatic: true,
      friction: 0.8,
      label: "ground",
      collisionFilter: { category: GROUND, mask: 0xffff },
    });
    const walls = [-420, FINISH_X + 1100].map((x) =>
      Bodies.rectangle(x, -300, 40, 800, { isStatic: true, label: "wall", collisionFilter: { category: GROUND, mask: 0xffff } }),
    );
    Composite.add(this.engine.world, [ground, ...walls]);
    this.buildTrack();
    this.runners = entries.map((entry, i) => this.makeRunner(entry, i));
    this.nextEvent = rng.float(1.5, 2.5);
    Events.on(this.engine, "collisionStart", this.onCollide);
  }

  // ---------------------------------------------------------------- track

  private buildTrack(): void {
    const rng = this.rng;
    let x = rng.float(900, 1500);
    while (x < FINISH_X - 900) {
      const width = rng.float(380, 640);
      const height = rng.float(24, 58);
      const slope = rng.float(0.55, 0.85);
      const body = Bodies.trapezoid(x + width / 2, 0, width, height, slope, {
        isStatic: true,
        friction: 0.8,
        label: "hill",
        collisionFilter: { category: GROUND, mask: 0xffff },
      });
      Body.setPosition(body, { x: body.position.x, y: body.position.y - body.bounds.max.y });
      const ramp = (width * slope) / 2;
      this.hills.push({ body, x0: x, x1: x + width, top0: x + ramp, top1: x + width - ramp, height });
      x += width + rng.float(1100, 2200);
    }

    x = 520;
    while (x < FINISH_X - 260) {
      if (this.hills.some((h) => x > h.x0 - 90 && x < h.x1 + 90)) {
        x += 120;
        continue;
      }
      const roll = rng.float(0, 100);
      if (roll < 36) this.hurdleRow(x);
      else if (roll < 50) this.crates(x, rng.int(1, 3));
      else if (roll < 68) this.scatter("banana", x, rng.int(1, 3), 18);
      else if (roll < 77) this.scatter("spring", x, rng.int(1, 2), 44);
      else this.mud(x, rng.float(140, 260));
      x += rng.float(240, 520);
    }
  }

  private lanesPicked(count: number): number[] {
    const lanes = [0, 1, 2, 3, 4, 5];
    const picked: number[] = [];
    for (let i = 0; i < count; i += 1) picked.push(lanes.splice(this.rng.int(0, lanes.length - 1), 1)[0]!);
    return picked;
  }

  private hurdleRow(x: number): void {
    for (let lane = 0; lane < 6; lane += 1) {
      const w = 6;
      const h = 34;
      const body = Bodies.rectangle(x, -h / 2, w, h, {
        density: 0.0028,
        friction: 0.9,
        frictionStatic: 1,
        label: "hurdle",
        collisionFilter: { category: laneBit(lane), mask: GROUND | laneBit(lane) | BOULDER },
      });
      this.items.push({ id: this.nextId++, kind: "hurdle", lane, body, w, h });
      Composite.add(this.engine.world, body);
    }
  }

  private crates(x: number, lanes: number, dropFrom = 0): void {
    for (const lane of this.lanesPicked(lanes)) {
      const stack = this.rng.int(1, 2);
      for (let s = 0; s < stack; s += 1) {
        const size = this.rng.float(26, 36);
        const body = Bodies.rectangle(x + this.rng.float(-10, 10), -size / 2 - s * size - dropFrom, size, size, {
          density: 0.0012,
          friction: 0.7,
          label: "crate",
          collisionFilter: { category: laneBit(lane), mask: GROUND | laneBit(lane) | BOULDER },
        });
        this.items.push({ id: this.nextId++, kind: "crate", lane, body, w: size, h: size });
        Composite.add(this.engine.world, body);
      }
    }
  }

  private scatter(kind: "banana" | "spring", x: number, lanes: number, w: number): void {
    for (const lane of this.lanesPicked(lanes)) {
      this.patches.push({ kind, lane, x: x + this.rng.float(-30, 30), w, used: false });
    }
  }

  private mud(x: number, w: number): void {
    for (let lane = 0; lane < 6; lane += 1) this.patches.push({ kind: "mud", lane, x, w, used: false });
  }

  /** Height of the track surface at x (positive = up). */
  heightAt(x: number): number {
    for (const h of this.hills) {
      if (x <= h.x0 || x >= h.x1) continue;
      if (x < h.top0) return (h.height * (x - h.x0)) / (h.top0 - h.x0);
      if (x > h.top1) return (h.height * (h.x1 - x)) / (h.x1 - h.top1);
      return h.height;
    }
    return 0;
  }

  // ---------------------------------------------------------------- racers

  private makeRunner(entry: RacerEntry, i: number): Runner {
    const { w, h } = entry.spec;
    const body = Bodies.rectangle(0, -h / 2, w, h, {
      chamfer: { radius: Math.min(w, h) * 0.32 },
      density: 0.002,
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0.008,
      restitution: 0.08,
      label: "racer",
      collisionFilter: { category: laneBit(entry.lane), mask: GROUND | laneBit(entry.lane) | BOULDER },
    });
    body.sleepThreshold = Infinity;
    Composite.add(this.engine.world, body);
    return {
      spec: entry.spec,
      lane: entry.lane,
      odds: entry.odds,
      stats: entry.stats,
      body,
      w,
      h,
      x: 0,
      finished: false,
      place: 0,
      mode: "run",
      modeT: 0,
      grounded: true,
      dir: 1,
      stride: i * 13,
      stamina: 1,
      pace: 1,
      paceT: 0,
      getUpAt: 1,
      sleeping: false,
      wrongT: 0,
      boostT: 0,
      slowT: 0,
      stopT: 0,
      dizzyT: 0,
      charT: 0,
      mudded: false,
      springT: 0,
      finishTime: 0,
      falls: 0,
      stuckT: 0,
      immuneT: 0,
      landT: 0,
      hopT: 0,
      wasGrounded: true,
      mood: "focused",
      decisions: new Map(),
    };
  }

  private runnerOf(body: Matter.Body): Runner | undefined {
    return this.runners.find((r) => r.body === body);
  }

  /** Current running order, leader first. */
  order(): Runner[] {
    return [...this.runners].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.place - b.place;
      return b.x - a.x;
    });
  }

  // ---------------------------------------------------------------- stepping

  /** Advance one fixed step (1/60 s). Returns what happened, for sound and effects. */
  step(): DerbyEvent[] {
    this.out.length = 0;
    const dt = STEP;
    this.time += dt;

    this.nextEvent -= dt;
    if (this.nextEvent <= 0 && this.opts.events !== false) {
      this.randomEvent();
      this.nextEvent = this.rng.float(1.0, 2.3);
    }
    this.gustT = Math.max(0, this.gustT - dt);
    if (this.gustT <= 0) this.gust = 0;

    for (const r of this.runners) this.control(r, dt);

    this.hits.length = 0;
    Engine.update(this.engine, 1000 / 60);
    this.readContacts();
    this.handleHits();

    for (const r of this.runners) this.afterStep(r, dt);
    this.updateBoulders(dt);
    return [...this.out];
  }

  private control(r: Runner, dt: number): void {
    const b = r.body;
    r.modeT += dt;
    for (const key of ["wrongT", "boostT", "slowT", "stopT", "dizzyT", "charT", "springT", "immuneT", "landT", "hopT"] as const) {
      r[key] = Math.max(0, r[key] - dt);
    }
    const mask = GROUND | laneBit(r.lane) | (r.immuneT > 0 ? 0 : BOULDER);
    if (b.collisionFilter.mask !== mask) b.collisionFilter.mask = mask;
    if (r.wrongT <= 0 && r.dir === -1) r.dir = 1;
    const ang = wrap(b.angle);
    const vx = b.velocity.x;

    if (r.mode === "run") {
      r.paceT -= dt;
      if (r.paceT <= 0) {
        r.pace = this.rng.float(0.86, 1.1);
        r.paceT = this.rng.float(0.7, 2);
      }
      r.stamina = Math.max(0.25, r.stamina - r.stats.fatigue * dt);
      if (Math.abs(ang) > FALL_ANGLE) {
        this.fall(r, 0, 0, 0, "OOF");
        return;
      }
      let target = (r.stats.topSpeed / 60) * (0.72 + 0.28 * r.stamina) * r.pace;
      if (r.boostT > 0) target *= 1.7;
      if (r.slowT > 0) target *= 0.5;
      if (r.mudded) target *= 0.42;
      if (r.stopT > 0) target = 0;
      target = target * r.dir + this.gust;
      // hoppers keep driving through their own little hops
      const driving = r.grounded || (r.spec.gait === "hop" && r.hopT > 0.08);
      if (driving) {
        const k = Math.min(1, r.stats.accel * dt);
        Body.setVelocity(b, { x: vx + (target - vx) * k, y: b.velocity.y });
      }
      const wobble = r.dizzyT > 0 ? Math.sin(this.time * 9 + r.lane) * 0.35 : 0;
      const lean = Math.max(-0.2, Math.min(0.2, target * 0.035)) + wobble;
      const stiff = (driving ? 0.11 : 0.02) * r.stats.balance;
      Body.setAngularVelocity(b, b.angularVelocity * 0.82 - (ang - lean) * stiff);
      const pushing = Math.abs(target) > 1.5 && r.grounded && Math.abs(b.velocity.x) < 1.2;
      r.stuckT = pushing ? r.stuckT + dt : 0;
      if (r.stuckT > 0.7) {
        r.stuckT = 0;
        Body.setVelocity(b, { x: b.velocity.x + r.dir * 1.5, y: -8 });
      }
      this.maybeJump(r);
      if (r.spec.gait === "hop" && r.grounded && r.hopT <= 0 && r.stopT <= 0 && Math.abs(target) > 1) {
        r.hopT = this.rng.float(0.32, 0.42);
        Body.setVelocity(b, { x: b.velocity.x, y: -3.2 });
      }
      return;
    }

    if (r.mode === "fallen") {
      const still = Math.hypot(b.velocity.x, b.velocity.y) < 1.4;
      if ((r.modeT > r.getUpAt && still && r.grounded) || r.modeT > r.getUpAt + 4) this.startGetUp(r);
      return;
    }

    if (r.mode === "getup") {
      const t = Math.min(1, r.modeT / GETUP_S);
      const standY = -this.heightAt(b.position.x) - r.h / 2 - 1;
      Body.setAngle(b, ang * (1 - t) * 0.85);
      Body.setAngularVelocity(b, 0);
      Body.setPosition(b, { x: b.position.x, y: b.position.y + (standY - b.position.y) * Math.min(1, t * 1.5) });
      Body.setVelocity(b, { x: 0, y: 0 });
      if (t >= 1) {
        Body.setAngle(b, 0);
        grip(b, false);
        this.setMode(r, "run");
      }
      return;
    }

    // finished: jog to a stop, winner bounces
    const k = Math.min(1, 2 * dt);
    if (r.grounded) Body.setVelocity(b, { x: vx * (1 - k), y: b.velocity.y });
    Body.setAngularVelocity(b, b.angularVelocity * 0.8 - ang * 0.1);
    if (r.place === 1 && r.grounded && r.modeT > 0.8 && this.rng.next() < 0.03) {
      Body.setVelocity(b, { x: b.velocity.x, y: -6.5 });
    }
  }

  private maybeJump(r: Runner): void {
    if (!r.grounded || r.stopT > 0) return;
    const b = r.body;
    for (const boulder of this.boulders) {
      const gap = boulder.body.position.x - b.position.x - boulder.r - r.w / 2;
      if (gap < 0 || gap > 170 || boulder.body.position.y < -boulder.r - 20) continue;
      const key = -boulder.body.id;
      if (!r.decisions.has(key)) {
        const sees = this.rng.next() < r.stats.jumpSkill * 0.8;
        r.decisions.set(key, sees ? this.rng.float(30, 110) : -1);
      }
      const plan = r.decisions.get(key)!;
      if (plan > 0 && gap <= plan) {
        r.decisions.set(key, -1);
        Body.setVelocity(b, { x: b.velocity.x, y: -this.rng.float(9, 10.5) });
        this.emit({ kind: "jump", lane: r.lane, pop: "HUP", sound: "none" });
        return;
      }
    }
    for (const item of this.items) {
      if (item.lane !== r.lane) continue;
      const d = (item.body.position.x - b.position.x) * r.dir - r.w / 2 - item.w / 2;
      if (d < 0 || d > 150) continue;
      if (item.kind === "hurdle" && Math.abs(wrap(item.body.angle)) > 0.6) continue;
      let plan = r.decisions.get(item.id);
      if (d < 8 && Math.abs(b.velocity.x) < 1.5) plan = 8;
      if (plan === undefined) {
        const sees = this.rng.next() < r.stats.jumpSkill * (0.75 + 0.25 * r.stamina) * (r.boostT > 0 ? 0.6 : 1);
        plan = sees ? this.rng.float(8, 70) : -1;
        r.decisions.set(item.id, plan);
      }
      if (plan > 0 && d <= plan) {
        r.decisions.set(item.id, -1);
        Body.setVelocity(b, { x: b.velocity.x, y: -this.rng.float(6.6, 8.4) });
        this.emit({ kind: "jump", lane: r.lane, sound: "none" });
      }
      return;
    }
  }

  private readContacts(): void {
    for (const r of this.runners) r.grounded = false;
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive || pair.isSensor) continue;
      for (const [self, other] of [
        [pair.bodyA, pair.bodyB],
        [pair.bodyB, pair.bodyA],
      ] as const) {
        const r = this.runnerOf(self);
        if (!r || other.label === "wall") continue;
        const supports = (pair.collision as unknown as { supports: Matter.Vector[] }).supports;
        if (supports.some((s) => s.y > self.position.y + 3)) r.grounded = true;
      }
    }
  }

  private handleHits(): void {
    for (const pair of this.hits) {
      for (const [self, other] of [
        [pair.bodyA, pair.bodyB],
        [pair.bodyB, pair.bodyA],
      ] as const) {
        const r = this.runnerOf(self);
        if (!r) continue;
        if (other.label === "boulder") r.immuneT = 3;
        if (r.mode !== "run") continue;
        const speed = Math.abs(self.velocity.x - other.velocity.x);
        if (other.label === "boulder") {
          Body.setVelocity(self, { x: -1.5, y: -3 });
          this.fall(r, 0, -3, -0.35, "SPLAT");
          r.dizzyT = 2.2;
          this.emit({ kind: "flattened", lane: r.lane, sound: "hit", shake: 0.35 });
        } else if (other.label === "hurdle" && speed > 1.5) {
          const trip = this.rng.next() < 0.25 + 0.6 * (1 - r.stats.balance);
          if (trip) this.fall(r, 0, -2.5, 0.3 * r.dir, "BONK");
          else this.emit({ kind: "clip", lane: r.lane, sound: "tick" });
        } else if (other.label === "crate" && speed > 2.5 && this.rng.next() < 0.35) {
          this.fall(r, 0, -2, 0.25 * r.dir, "OOF");
        }
      }
    }
  }

  private afterStep(r: Runner, dt: number): void {
    const b = r.body;
    if (r.grounded && !r.wasGrounded && r.mode !== "fallen") r.landT = 0.22;
    r.wasGrounded = r.grounded;
    const prevX = r.x;
    r.x = b.position.x;
    if (r.grounded && (r.mode === "run" || r.mode === "finished")) r.stride += Math.abs(r.x - prevX);
    if (r.mode === "fallen" && r.grounded) r.stride += dt * 60 * 3;

    const surface = -this.heightAt(b.position.x);
    if (b.position.y > surface + 30) {
      Body.setPosition(b, { x: b.position.x, y: surface - r.h / 2 - 2 });
      Body.setVelocity(b, { x: b.velocity.x, y: 0 });
    }

    r.mudded = false;
    const feetDown = b.bounds.max.y > surface - 10;
    for (const p of this.patches) {
      if (p.lane !== r.lane || p.used) continue;
      if (Math.abs(b.position.x - p.x) > p.w / 2 + r.w / 2 - 8) continue;
      if (p.kind === "mud" && feetDown) r.mudded = true;
      if (!feetDown || r.mode !== "run") continue;
      if (p.kind === "banana" && Math.abs(b.velocity.x) > 1.5) {
        p.used = true;
        this.fall(r, b.velocity.x * 0.6, -5.5, -0.42 * r.dir, "WHOOPS");
        this.emit({ kind: "banana", lane: r.lane, sound: "miss" });
      } else if (p.kind === "spring" && r.springT <= 0) {
        r.springT = 1;
        Body.setVelocity(b, { x: b.velocity.x + 2.5 * r.dir, y: -12.5 });
        this.emit({ kind: "spring", lane: r.lane, pop: "BOING", sound: "boost" });
      }
    }

    if (!r.finished && r.x >= FINISH_X) {
      r.finished = true;
      this.finishedCount += 1;
      r.place = this.finishedCount;
      r.finishTime = this.time;
      if (r.mode === "run") this.setMode(r, "finished");
      this.emit({ kind: "finish", lane: r.lane, sound: r.place === 1 ? "big" : "tick" });
    }
    if (r.finished && r.mode === "run") this.setMode(r, "finished");
    r.mood = this.moodOf(r);
  }

  private moodOf(r: Runner): Mood {
    if (r.finished && r.mode === "finished") return r.place === 1 ? "win" : r.place <= 3 ? "happy" : "sad";
    if (r.mode === "fallen") {
      if (r.sleeping) return "sleep";
      if (r.modeT < 0.7) return "panic";
      return r.dizzyT > 0 || r.charT > 0 ? "dizzy" : "angry";
    }
    if (r.mode === "getup") return "angry";
    if (r.charT > 0 || r.dizzyT > 0) return "dizzy";
    if (r.dir === -1) return "confused";
    if (r.springT > 0 || r.boostT > 0 || r.stopT > 0) return "happy";
    if (!r.grounded && r.body.velocity.y > 2) return "panic";
    if (r.slowT > 0 || r.mudded) return "pain";
    if (r.stamina < 0.5) return "tired";
    if (this.order()[0] === r) return "smug";
    return "focused";
  }

  private setMode(r: Runner, mode: RunnerMode): void {
    r.mode = mode;
    r.modeT = 0;
  }

  private fall(r: Runner, kickX: number, kickY: number, spin: number, pop: string): void {
    if (r.mode !== "run") return;
    const b = r.body;
    this.setMode(r, "fallen");
    r.falls += 1;
    r.getUpAt = r.stats.getUp * this.rng.float(0.8, 1.5);
    grip(b, true);
    Body.setVelocity(b, { x: b.velocity.x + kickX, y: b.velocity.y + kickY });
    Body.setAngularVelocity(b, b.angularVelocity + spin);
    this.emit({ kind: "fall", lane: r.lane, pop, sound: "hit" });
  }

  private startGetUp(r: Runner): void {
    r.sleeping = false;
    this.setMode(r, "getup");
  }

  // ---------------------------------------------------------------- random events

  private randomEvent(): void {
    const running = this.order().filter((r) => !r.finished);
    if (running.length === 0) return;
    const roll = this.rng.next();
    if (roll < 0.16) {
      const kinds = this.time < 8 ? FIELD_EVENTS.filter((k) => k !== "boulder") : FIELD_EVENTS;
      this.fieldEvent(this.rng.pick(kinds), running);
      return;
    }
    const good = roll > 0.8;
    // Bad luck finds the leaders, good luck finds the stragglers: upsets are the point.
    const weights = running.map((_, i) => {
      const fromFront = i / Math.max(1, running.length - 1);
      return good ? 0.6 + fromFront * 2.4 : 3 - fromFront * 2.2;
    });
    const target = weightedPick(this.rng, running, weights);
    if (target.mode !== "run") return;
    if (good) this.goodEvent(this.rng.pick(GOOD_EVENTS), target, running);
    else this.badEvent(this.rng.pick(BAD_EVENTS), target);
  }

  private badEvent(kind: (typeof BAD_EVENTS)[number], r: Runner): void {
    const b = r.body;
    switch (kind) {
      case "trip":
        this.fall(r, b.velocity.x * 0.3, -3, 0.34 * r.dir, "WHOA");
        return;
      case "sneeze":
        this.fall(r, -3.5 * r.dir, -4.5, -0.3 * r.dir, "ACHOO");
        return;
      case "nap":
        this.fall(r, 0, 0, -0.1 * r.dir, "ZZZ");
        r.sleeping = true;
        r.getUpAt = this.rng.float(2.2, 3.8);
        return;
      case "wrongway":
        r.dir = -1;
        r.wrongT = this.rng.float(1.2, 2.4);
        this.emit({ kind, lane: r.lane, pop: "WAIT WHAT", sound: "miss" });
        return;
      case "distracted":
        r.stopT = this.rng.float(1.2, 2.2);
        this.emit({ kind, lane: r.lane, pop: this.rng.pick(["HI MOM!", "OOH, A COIN", "IS THAT A DOG?", "*waves*"]), sound: "tick" });
        return;
      case "cramp":
        r.slowT = this.rng.float(2, 3.2);
        this.emit({ kind, lane: r.lane, pop: "CRAMP", sound: "miss" });
        return;
      case "lightning":
        r.charT = 2.5;
        this.fall(r, 0, -11, 0.45 * r.dir, "ZAP");
        this.emit({ kind, lane: r.lane, callout: "LIGHTNING!", sound: "big", shake: 0.5 });
    }
  }

  private goodEvent(kind: (typeof GOOD_EVENTS)[number], r: Runner, running: Runner[]): void {
    if (kind === "secondwind") {
      const last = running[running.length - 1]!;
      if (last.mode !== "run") return;
      last.stamina = 1;
      last.boostT = this.rng.float(2.5, 4);
      this.emit({ kind, lane: last.lane, pop: "SECOND WIND", sound: "boost" });
      return;
    }
    r.boostT = this.rng.float(2, 3.2);
    this.emit({ kind, lane: r.lane, pop: "ZOOM", sound: "boost" });
  }

  private fieldEvent(kind: (typeof FIELD_EVENTS)[number], running: Runner[]): void {
    const leadX = running[0]!.x;
    switch (kind) {
      case "boulder": {
        const r = this.rng.float(30, 46);
        const body = Bodies.circle(leadX + this.rng.float(520, 820), -420, r, {
          density: 0.0025,
          friction: 0.05,
          restitution: 0.35,
          label: "boulder",
          collisionFilter: { category: BOULDER, mask: GROUND | ALL_LANES },
        });
        body.sleepThreshold = Infinity;
        Body.setVelocity(body, { x: -this.rng.float(4.5, 6.5), y: 0 });
        Composite.add(this.engine.world, body);
        this.boulders.push({ body, r, life: 12 });
        this.emit({ kind, lane: null, callout: "BOULDER!", sound: "big" });
        return;
      }
      case "quake":
        for (const r of running) {
          if (r.mode !== "run") continue;
          Body.setVelocity(r.body, { x: r.body.velocity.x, y: -this.rng.float(3, 7) });
          Body.setAngularVelocity(r.body, this.rng.float(-0.28, 0.28));
        }
        for (const item of this.items) {
          if (Math.abs(item.body.position.x - leadX) > 1600) continue;
          Matter.Sleeping.set(item.body, false);
          Body.setVelocity(item.body, { x: this.rng.float(-1, 1), y: -this.rng.float(2, 6) });
        }
        this.emit({ kind, lane: null, callout: "EARTHQUAKE!", sound: "big", shake: 0.9 });
        return;
      case "gust": {
        const tail = this.rng.next() < 0.5;
        this.gust = tail ? 2.6 : -2.2;
        this.gustT = this.rng.float(1.8, 2.8);
        this.emit({ kind, lane: null, callout: tail ? "TAILWIND!" : "HEADWIND!", sound: "tick" });
        return;
      }
      case "crates":
        this.crates(leadX + this.rng.float(300, 600), this.rng.int(2, 4), 520);
        this.emit({ kind, lane: null, callout: "INCOMING!", sound: "big" });
    }
  }

  private updateBoulders(dt: number): void {
    const lastX = Math.min(...this.runners.map((r) => r.x));
    for (let i = this.boulders.length - 1; i >= 0; i -= 1) {
      const boulder = this.boulders[i]!;
      boulder.life -= dt;
      // keep it rolling back through the field
      if (boulder.body.velocity.x > -4) Body.setVelocity(boulder.body, { x: boulder.body.velocity.x - 0.08, y: boulder.body.velocity.y });
      if (boulder.life <= 0 || boulder.body.position.x < Math.max(60, lastX - 250)) {
        Composite.remove(this.engine.world, boulder.body);
        this.boulders.splice(i, 1);
      }
    }
  }

  private emit(event: DerbyEvent): void {
    this.out.push(event);
  }

  /** Over once every racer with money on it has crossed, everyone has, or time is up. */
  over(betLanes: readonly number[]): boolean {
    if (this.time >= MAX_RACE_S) return true;
    if (this.runners.every((r) => r.finished)) return true;
    const watched = new Set(betLanes);
    if (watched.size === 0) return false;
    return this.runners.every((r) => !watched.has(r.lane) || r.finished);
  }

  destroy(): void {
    Events.off(this.engine, "collisionStart", this.onCollide);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}

/** Running racers slide on zero friction (the controller drives them); fallen ones grip and stop. */
function grip(b: Matter.Body, on: boolean): void {
  b.friction = on ? 0.9 : 0;
  b.frictionStatic = on ? 0.6 : 0;
}

export function wrap(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function weightedPick<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.float(0, total);
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i]!;
    if (roll <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
