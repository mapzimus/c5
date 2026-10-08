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

export type RunnerMode = "run" | "fallen" | "getup" | "finished" | "ride";

/** Something has hold of a runner (or they're underground): the world moves them, not physics. */
export interface Ride {
  kind: "eagle" | "ufo" | "balloon" | "hole";
  t: number;
  dur: number;
  x0: number;
  y0: number;
  x1: number;
  /** Balloon drift in px per frame. */
  drift: number;
}

/** Short-lived scenery for effects: holes in the track, a cannon, a puff of smoke. */
export interface Prop {
  kind: "hole" | "cannon" | "poof";
  lane: number;
  x: number;
  life: number;
  max: number;
}

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
  stuckX: number;
  /** Seconds a flattened racer can't be hit by a boulder again. */
  immuneT: number;
  /** Counts down after a hard landing; drives the squash in the drawing. */
  landT: number;
  hopT: number;
  wasGrounded: boolean;
  ride: Ride | null;
  /** Seconds left squashed flat under an anvil. */
  flatT: number;
  pieT: number;
  danceT: number;
  jetT: number;
  /** Size multiplier (MEGA / tiny) and how long it lasts. */
  scale: number;
  scaleT: number;
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
  /** For bad luck: the victim's running position when it struck (0 = leader). */
  position?: number;
  /** For bad luck: 0 mild, 1 medium, 2 severe. */
  severity?: Severity;
}

type BadEvent =
  | "trip" | "sneeze" | "nap" | "wrongway" | "distracted" | "cramp" | "lightning"
  | "eagle" | "anvil" | "ufo" | "swap" | "balloon" | "hole" | "pie" | "dance" | "shrink";
export type Severity = 0 | 1 | 2;
/** Bad luck by how much it hurts: a wave to the crowd, a faceplant, or a lightning strike. */
const BAD_BY_SEVERITY: readonly (readonly BadEvent[])[] = [
  ["distracted", "cramp", "pie", "dance", "shrink"],
  ["trip", "wrongway", "sneeze", "balloon", "hole"],
  ["nap", "lightning", "eagle", "anvil", "ufo", "swap"],
];

/**
 * Odds of [mild, medium, severe] bad luck for a runner in `position` (0 = leader) of a
 * `field`-runner race. The higher up the order, the likelier it's severe; a leader who's
 * pulling away (`leadGap` px clear of second) gets a little extra on top.
 */
export function severityOdds(position: number, field: number, leadGap = 0): [number, number, number] {
  const standing = field <= 1 ? 1 : 1 - position / (field - 1);
  const runaway = position === 0 ? Math.min(0.2, Math.max(0, leadGap) / 1500) : 0;
  const severe = 0.05 + 0.55 * standing * standing + runaway;
  const mild = Math.min(1 - severe, 0.1 + 0.5 * (1 - standing));
  return [mild, Math.max(0, 1 - severe - mild), severe];
}
const GOOD_EVENTS = ["boost", "secondwind", "jetpack", "cannon", "mega"] as const;
const FIELD_EVENTS = ["boulder", "quake", "gust", "crates", "lowgrav", "fish", "reverse", "ice"] as const;
const GRAVITY = 1.3;

export class DerbyWorld {
  readonly engine: Matter.Engine;
  readonly runners: Runner[];
  readonly items: Item[] = [];
  readonly patches: Patch[] = [];
  readonly hills: Hill[] = [];
  readonly boulders: Boulder[] = [];
  readonly fish: { body: Matter.Body; lane: number; life: number }[] = [];
  readonly props: Prop[] = [];
  time = 0;
  /** Seconds left of low gravity / black ice. */
  lowGravT = 0;
  iceT = 0;
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
    private readonly opts: { events?: boolean; obstacleMul?: number; eventMul?: number } = {},
  ) {
    this.engine = Engine.create({ gravity: { x: 0, y: GRAVITY, scale: 0.001 }, enableSleeping: true });
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

    const om = this.opts.obstacleMul ?? 1;
    x = 520;
    while (x < FINISH_X - 260) {
      if (this.hills.some((h) => x > h.x0 - 90 && x < h.x1 + 90)) {
        x += 120;
        continue;
      }
      const roll = rng.float(0, 100);
      if (roll < 36) this.hurdleRow(x);
      else if (roll < 50) this.crates(x, rng.int(1, 3));
      else if (roll < 68) this.scatter("banana", x, rng.int(1, Math.ceil(3 * om)), 18);
      else if (roll < 77) this.scatter("spring", x, rng.int(1, 2), 44);
      else this.mud(x, rng.float(140, 260) * om);
      x += rng.float(240, 520) / om;
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
          density: 0.0009,
          friction: 0.15,
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
      stuckX: 0,
      immuneT: 0,
      landT: 0,
      hopT: 0,
      wasGrounded: true,
      ride: null,
      flatT: 0,
      pieT: 0,
      danceT: 0,
      jetT: 0,
      scale: 1,
      scaleT: 0,
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
      // fewer runners left, fewer events: stragglers shouldn't get all the chaos to themselves
      const left = Math.max(1, this.runners.filter((r) => !r.finished).length);
      this.nextEvent = this.rng.float(0.85, 1.9) * Math.sqrt(this.runners.length / left) / (this.opts.eventMul ?? 1);
    }
    this.gustT = Math.max(0, this.gustT - dt);
    if (this.gustT <= 0) this.gust = 0;
    this.iceT = Math.max(0, this.iceT - dt);
    if (this.lowGravT > 0) {
      this.lowGravT = Math.max(0, this.lowGravT - dt);
      this.engine.gravity.y = this.lowGravT > 0 ? 0.42 : GRAVITY;
    }
    for (const prop of this.props) prop.life -= dt;
    for (let i = this.props.length - 1; i >= 0; i -= 1) if (this.props[i]!.life <= 0) this.props.splice(i, 1);

    for (const r of this.runners) this.control(r, dt);

    this.hits.length = 0;
    Engine.update(this.engine, 1000 / 60);
    this.readContacts();
    this.handleHits();

    for (const r of this.runners) this.afterStep(r, dt);
    this.layDownHurdles();
    this.updateBoulders(dt);
    this.updateFish(dt);
    return [...this.out];
  }

  private control(r: Runner, dt: number): void {
    const b = r.body;
    r.modeT += dt;
    for (const key of ["wrongT", "boostT", "slowT", "stopT", "dizzyT", "charT", "springT", "immuneT", "landT", "hopT", "flatT", "pieT", "danceT", "jetT", "scaleT"] as const) {
      r[key] = Math.max(0, r[key] - dt);
    }
    if (r.scale !== 1 && r.scaleT <= 0) this.setScale(r, 1, 0);
    const mask = r.mode === "ride" ? 0 : GROUND | laneBit(r.lane) | (r.immuneT > 0 ? 0 : BOULDER);
    if (b.collisionFilter.mask !== mask) b.collisionFilter.mask = mask;
    if (r.wrongT <= 0 && r.dir === -1) r.dir = 1;
    const ang = wrap(b.angle);
    const vx = b.velocity.x;

    if (r.mode === "ride") {
      this.steerRide(r, dt);
      return;
    }

    if (r.mode === "run" && r.jetT > 0) {
      const wantY = -this.heightAt(b.position.x) - 150 - r.h / 2;
      const jetSpeed = (r.stats.topSpeed / 60) * r.spec.pace * 1.9 * r.dir;
      Body.setVelocity(b, { x: vx + (jetSpeed - vx) * 0.08, y: (wantY - b.position.y) * 0.06 });
      Body.setAngularVelocity(b, b.angularVelocity * 0.7 - (ang - 0.25 * r.dir) * 0.15);
      return;
    }

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
      let target = (r.stats.topSpeed / 60) * r.spec.pace * (0.72 + 0.28 * r.stamina) * r.pace;
      if (r.boostT > 0) target *= 1.7;
      if (r.slowT > 0) target *= 0.5;
      if (r.mudded) target *= 0.42;
      if (r.scale > 1) target *= 1.3;
      if (r.scale < 1) target *= 0.75;
      if (r.stopT > 0) target = 0;
      target = target * r.dir + this.gust;
      // hoppers keep driving through their own little hops
      const driving = r.grounded || (r.spec.gait === "hop" && r.hopT > 0.08);
      if (driving) {
        const k = Math.min(1, r.stats.accel * dt * (this.iceT > 0 ? 0.12 : 1));
        Body.setVelocity(b, { x: vx + (target - vx) * k, y: b.velocity.y });
      }
      const wobble = r.dizzyT > 0 ? Math.sin(this.time * 9 + r.lane) * 0.35 : 0;
      const lean = Math.max(-0.2, Math.min(0.2, target * 0.035)) + wobble;
      const stiff = (driving ? 0.11 : 0.02) * r.stats.balance * (this.iceT > 0 ? 0.55 : 1);
      Body.setAngularVelocity(b, b.angularVelocity * 0.82 - (ang - lean) * stiff);
      // Every second, check they actually got somewhere; if not, big leap over whatever's in the way.
      if (Math.abs(target) > 1.5 && r.stopT <= 0 && r.wrongT <= 0 && this.iceT <= 0) {
        r.stuckT += dt;
        if (r.stuckT >= 0.9) {
          if ((b.position.x - r.stuckX) * r.dir < 25) {
            Body.setVelocity(b, { x: b.velocity.x + r.dir * 2, y: -9.5 });
            this.emit({ kind: "unstick", lane: r.lane, sound: "none" });
          }
          r.stuckT = 0;
          r.stuckX = b.position.x;
        }
      } else {
        r.stuckT = 0;
        r.stuckX = b.position.x;
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
      const standY = -this.heightAt(b.position.x) - (r.h * r.scale) / 2 - 1;
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
        } else if (other.label === "fish" && this.rng.next() < 0.3) {
          this.fall(r, 0, -2, 0.3 * r.dir, "SLAP");
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
    if (r.mode !== "ride" && b.position.y > surface + 30) {
      Body.setPosition(b, { x: b.position.x, y: surface - r.h / 2 - 2 });
      Body.setVelocity(b, { x: b.velocity.x, y: 0 });
    }

    r.mudded = false;
    // generous so hoppers bouncing along still land in the mud and on the bananas
    const feetDown = b.bounds.max.y > surface - 24;
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
    if (r.ride) return r.ride.kind === "balloon" ? "happy" : r.ride.kind === "hole" ? "confused" : "panic";
    if (r.jetT > 0 || r.danceT > 0) return "happy";
    if (r.pieT > 0 && r.mode === "run") return "angry";
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
    // restart the stuck check from wherever they are now
    r.stuckT = 0;
    r.stuckX = r.body.position.x;
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
    const order = this.order();
    const running = order.filter((r) => !r.finished);
    if (running.length === 0) return;
    const roll = this.rng.next();
    if (roll < 0.2) {
      const kinds = this.time < 8 ? FIELD_EVENTS.filter((k) => k !== "boulder") : FIELD_EVENTS;
      this.fieldEvent(this.rng.pick(kinds), running);
      return;
    }
    const good = roll > 0.8;
    // Bad luck finds the leaders, good luck finds the stragglers: upsets are the point.
    // Positions count finished runners too, so a lone straggler is still last, not "leading".
    const weights = running.map((r) => {
      const fromFront = order.indexOf(r) / Math.max(1, order.length - 1);
      return good ? 0.6 + fromFront * 2.4 : 3 - fromFront * 2.2;
    });
    const target = weightedPick(this.rng, running, weights);
    if (target.mode !== "run") return;
    if (good) {
      this.goodEvent(this.rng.pick(GOOD_EVENTS), target, running);
      return;
    }
    const position = order.indexOf(target);
    const leadGap = position === 0 && running.length > 1 ? running[0]!.x - running[1]!.x : 0;
    const odds = severityOdds(position, order.length, leadGap);
    const severity = weightedPick(this.rng, [0, 1, 2] as const, odds);
    const before = this.out.length;
    this.badEvent(this.rng.pick(BAD_BY_SEVERITY[severity]!), target);
    for (const event of this.out.slice(before)) {
      event.position = position;
      event.severity = severity;
    }
  }

  private badEvent(kind: BadEvent, r: Runner): void {
    const b = r.body;
    const order = this.order();
    const runningX = order.filter((o) => !o.finished).map((o) => o.x);
    const tailX = Math.min(...runningX);
    switch (kind) {
      case "eagle": {
        const back = this.rng.float(300, 560);
        this.startRide(r, "eagle", 2.4, Math.max(40, r.x - back * r.dir));
        this.emit({ kind, lane: r.lane, pop: "PUT ME DOWN", callout: "EAGLE!", sound: "big", shake: 0.2 });
        return;
      }
      case "ufo": {
        const to = this.rng.float(Math.max(40, tailX - 150), Math.max(60, r.x - 250));
        this.startRide(r, "ufo", 3, to);
        this.emit({ kind, lane: r.lane, pop: "NOOOO", callout: "ABDUCTED!", sound: "big" });
        return;
      }
      case "balloon":
        this.startRide(r, "balloon", this.rng.float(2.6, 3.4), r.x, this.rng.float(-1.3, 1.6));
        this.emit({ kind, lane: r.lane, pop: "WHEEE", sound: "boost" });
        return;
      case "hole":
        this.startRide(r, "hole", 1.5, r.x + this.rng.float(-380, 260));
        this.emit({ kind, lane: r.lane, pop: "WHERE'D I GO", sound: "miss" });
        return;
      case "anvil":
        this.fall(r, -b.velocity.x, 3, 0, "CLONK");
        Body.setAngle(b, 0);
        Body.setAngularVelocity(b, 0);
        r.flatT = 2.4;
        r.dizzyT = 3;
        r.getUpAt = 2.4;
        this.emit({ kind, lane: r.lane, callout: "ANVIL!", sound: "big", shake: 0.6 });
        return;
      case "swap": {
        const behind = order.filter((o) => !o.finished && o.mode === "run" && o !== r && o.x < r.x - 150);
        if (behind.length === 0) {
          this.fall(r, b.velocity.x * 0.3, -3, 0.34 * r.dir, "WHOA");
          return;
        }
        const other = behind[behind.length - 1 - this.rng.int(0, Math.min(1, behind.length - 1))]!;
        const [ax, bx] = [r.x, other.x];
        for (const [who, from, to] of [[r, ax, bx], [other, bx, ax]] as const) {
          Body.setPosition(who.body, { x: to, y: -this.heightAt(to) - (who.h * who.scale) / 2 - 2 });
          who.x = to;
          who.stuckX = to;
          who.dizzyT = 1.6;
          this.props.push({ kind: "poof", lane: who.lane, x: from, life: 0.6, max: 0.6 });
          this.props.push({ kind: "poof", lane: who.lane, x: to, life: 0.6, max: 0.6 });
        }
        this.emit({ kind, lane: r.lane, pop: "HUH?", callout: `SWAP! #${r.lane + 1} ⇄ #${other.lane + 1}`, sound: "big", shake: 0.3 });
        this.emit({ kind: "swapped", lane: other.lane, pop: "YOINK", sound: "none" });
        return;
      }
      case "pie":
        r.stopT = 1.4;
        r.pieT = 2.8;
        this.emit({ kind, lane: r.lane, pop: "PIE'D", sound: "miss" });
        return;
      case "dance":
        r.stopT = 2;
        r.danceT = 2;
        this.emit({ kind, lane: r.lane, pop: this.rng.pick(["DANCE BREAK", "THIS IS MY SONG", "*grooves*"]), sound: "tick" });
        return;
      case "shrink":
        this.setScale(r, 0.6, 4.5);
        this.emit({ kind, lane: r.lane, pop: "tiny", sound: "miss" });
        return;
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
    if (kind === "jetpack") {
      r.jetT = this.rng.float(2.2, 3);
      this.emit({ kind, lane: r.lane, pop: "JETPACK", sound: "boost" });
      return;
    }
    if (kind === "cannon") {
      this.props.push({ kind: "cannon", lane: r.lane, x: r.x - 30 * r.dir, life: 1.4, max: 1.4 });
      Body.setVelocity(r.body, { x: 11 * r.dir, y: -12 });
      r.springT = 1.6;
      this.emit({ kind, lane: r.lane, pop: "KABOOM", sound: "big", shake: 0.35 });
      return;
    }
    if (kind === "mega") {
      this.setScale(r, 1.55, 4);
      this.emit({ kind, lane: r.lane, pop: "MEGA", sound: "boost", shake: 0.2 });
      return;
    }
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
        return;
      case "lowgrav":
        this.lowGravT = this.rng.float(5, 7);
        this.engine.gravity.y = 0.42;
        this.emit({ kind, lane: null, callout: "LOW GRAVITY!", sound: "big" });
        return;
      case "ice":
        this.iceT = this.rng.float(4, 6);
        this.emit({ kind, lane: null, callout: "BLACK ICE!", sound: "big" });
        return;
      case "reverse":
        for (const r of running) {
          if (r.mode !== "run") continue;
          r.dir = -1;
          r.wrongT = this.rng.float(1.3, 2.1);
        }
        this.emit({ kind, lane: null, callout: "EVERYBODY BACK!", sound: "big" });
        return;
      case "fish": {
        const tailX = running[running.length - 1]!.x;
        for (let i = 0; i < 16; i += 1) {
          const lane = this.rng.int(0, 5);
          const body = Bodies.rectangle(this.rng.float(tailX - 100, leadX + 700), -this.rng.float(450, 1100), 24, 11, {
            density: 0.0012,
            restitution: 0.55,
            friction: 0.3,
            label: "fish",
            collisionFilter: { category: laneBit(lane), mask: GROUND | laneBit(lane) },
          });
          body.sleepThreshold = Infinity;
          Body.setAngularVelocity(body, this.rng.float(-0.3, 0.3));
          Composite.add(this.engine.world, body);
          this.fish.push({ body, lane, life: this.rng.float(5, 8) });
        }
        this.emit({ kind, lane: null, callout: "IT'S RAINING FISH!", sound: "big" });
      }
    }
  }

  private startRide(r: Runner, kind: Ride["kind"], dur: number, x1: number, drift = 0): void {
    const b = r.body;
    r.ride = { kind, t: 0, dur, x0: b.position.x, y0: b.position.y, x1: Math.min(FINISH_X - 60, Math.max(20, x1)), drift };
    this.setMode(r, "ride");
    Body.setAngle(b, 0);
    if (kind === "hole") {
      this.props.push({ kind: "hole", lane: r.lane, x: r.ride.x0, life: dur + 0.6, max: dur + 0.6 });
      this.props.push({ kind: "hole", lane: r.lane, x: r.ride.x1, life: dur + 0.6, max: dur + 0.6 });
    }
  }

  /** Move a runner along whatever has hold of them; let go at the end. */
  private steerRide(r: Runner, dt: number): void {
    const ride = r.ride!;
    const b = r.body;
    ride.t += dt;
    const u = Math.min(1, ride.t / ride.dur);
    const ground = (x: number): number => -this.heightAt(x) - (r.h * r.scale) / 2;
    const ease = (v: number): number => v * v * (3 - 2 * v);
    const seg = (a: number, z: number): number => ease(Math.max(0, Math.min(1, (u - a) / (z - a))));
    let x = ride.x0;
    let y = ride.y0;
    switch (ride.kind) {
      case "eagle":
        x = ride.x0 + (ride.x1 - ride.x0) * seg(0.2, 0.85);
        y = ground(x) - 150 * seg(0, 0.2) + Math.sin(ride.t * 9) * 6;
        break;
      case "ufo":
        x = ride.x0 + (ride.x1 - ride.x0) * seg(0.3, 0.75);
        y = ground(x) - 185 * seg(0, 0.3);
        break;
      case "balloon":
        x = b.position.x + ride.drift * (u > 0.25 ? 1 : 0);
        y = ground(x) - 170 * seg(0, 0.3) + Math.sin(ride.t * 3) * 8;
        break;
      case "hole": {
        x = ride.x0 + (ride.x1 - ride.x0) * seg(0.25, 0.75);
        const down = u < 0.25 ? seg(0, 0.25) : u > 0.75 ? 1 - seg(0.75, 1) : 1;
        y = ground(x) + (r.h * r.scale + 10) * down;
      }
    }
    x = Math.min(FINISH_X - 40, Math.max(20, x));
    Body.setPosition(b, { x, y });
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngle(b, ride.kind === "eagle" || ride.kind === "ufo" ? Math.sin(ride.t * 5) * 0.25 : 0);
    Body.setAngularVelocity(b, 0);
    if (u < 1) return;
    r.ride = null;
    b.collisionFilter.mask = GROUND | laneBit(r.lane) | BOULDER;
    this.setMode(r, "run");
    if (ride.kind === "hole") {
      Body.setVelocity(b, { x: 2 * r.dir, y: -8 });
      this.emit({ kind: "popout", lane: r.lane, pop: "TA-DA", sound: "tick" });
    } else {
      this.fall(r, 0, 0, this.rng.float(-0.2, 0.2), ride.kind === "balloon" ? "POP" : "AAAA");
    }
  }

  /** Grow or shrink a runner, lifting them so they don't sink into the track. */
  private setScale(r: Runner, scale: number, dur: number): void {
    const b = r.body;
    const k = scale / r.scale;
    if (k !== 1) {
      Body.scale(b, k, k);
      Body.setPosition(b, { x: b.position.x, y: b.position.y - ((scale - r.scale) * r.h) / 2 - 2 });
    }
    r.scale = scale;
    r.scaleT = dur;
  }

  private updateFish(dt: number): void {
    for (let i = this.fish.length - 1; i >= 0; i -= 1) {
      const f = this.fish[i]!;
      f.life -= dt;
      // once a fish has landed it's scenery: only falling fish can bonk anyone
      if (f.body.position.y > -this.heightAt(f.body.position.x) - 16 && f.body.collisionFilter.mask !== GROUND) f.body.collisionFilter.mask = GROUND;
      if (f.life <= 0) {
        Composite.remove(this.engine.world, f.body);
        this.fish.splice(i, 1);
      }
    }
  }

  /**
   * A knocked-over hurdle just lies in the lane as scenery. Left solid, runners would
   * shove it along the ground, and bigger bodies lost far more time to that than small ones.
   */
  private layDownHurdles(): void {
    for (const item of this.items) {
      if (item.kind !== "hurdle" || item.body.collisionFilter.mask === GROUND) continue;
      if (Math.abs(wrap(item.body.angle)) > 0.9) item.body.collisionFilter.mask = GROUND;
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

  /** Every event the race can throw, by name. */
  static readonly EVENTS: readonly string[] = [...BAD_BY_SEVERITY.flat(), ...GOOD_EVENTS, ...FIELD_EVENTS];

  /** Fire a named event at a lane (or the whole field) right now. For tests and tinkering. */
  fire(kind: string, lane = 0): DerbyEvent[] {
    const before = this.out.length;
    const order = this.order();
    const running = order.filter((r) => !r.finished);
    const target = this.runners.find((r) => r.lane === lane);
    if (!target || running.length === 0) return [];
    if ((GOOD_EVENTS as readonly string[]).includes(kind)) this.goodEvent(kind as (typeof GOOD_EVENTS)[number], target, running);
    else if ((FIELD_EVENTS as readonly string[]).includes(kind)) this.fieldEvent(kind as (typeof FIELD_EVENTS)[number], running);
    else if (BAD_BY_SEVERITY.flat().includes(kind as BadEvent)) this.badEvent(kind as BadEvent, target);
    return this.out.splice(before);
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
