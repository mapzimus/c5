import Matter from "matter-js";
import { GOLDEN_BONUS, KING_HP, PIECE_SPECS, impactDamage, isHeavy, type Ammo, type PieceKind, type Team } from "./rules";

const { Engine, Events, Bodies, Body, Composite, Query } = Matter;

export const GROUND_Y = 600;
export const TOP_Y = 150;
export const ZONES = [
  { x0: 90, x1: 590 },
  { x0: 690, x1: 1190 },
] as const;
export const CANNONS = [
  { x: 40, y: GROUND_Y - 26 },
  { x: 1240, y: GROUND_Y - 26 },
] as const;

const STEP_MS = 1000 / 60;
/** Matter velocity is px per step; gravity adds this much vy each step. */
export const GRAVITY_PER_STEP = 0.001 * STEP_MS * STEP_MS;
/** Horizontal accel (px/step²) per 1 unit of wind. */
export const WIND_ACCEL = 0.0024;
export const MAX_SHOT_SPEED = 27;
const KING_SIZE = 34;
const BOMB_RADIUS = 150;
const DROP_GAP = 36;

const CAT_GROUND = 0x1;
const CAT_TEAM = [0x2, 0x4] as const;
const CAT_BALL = [0x8, 0x10] as const;

export interface Piece {
  body: Matter.Body;
  team: Team;
  kind: PieceKind | "king";
  hp: number;
  maxHp: number;
  cooldown: number;
}

export interface Ball {
  body: Matter.Body;
  team: Team;
  ammo: Ammo;
  exploded: boolean;
  touched: boolean;
  /** Seconds since fired. */
  age: number;
}

export type WorldEvent =
  | { type: "hit"; x: number; y: number; team: Team; damage: number; king: boolean }
  | { type: "break"; x: number; y: number; team: Team; kind: PieceKind; angle: number }
  | { type: "boom"; x: number; y: number }
  | { type: "kingDown"; x: number; y: number; team: Team }
  | { type: "thud"; x: number; y: number; speed: number };

function teamFilter(team: Team): Matter.ICollisionFilter {
  return { category: CAT_TEAM[team], mask: CAT_GROUND | CAT_TEAM[0] | CAT_TEAM[1] | CAT_BALL[team === 0 ? 1 : 0], group: 0 };
}

export function makePieceBody(kind: PieceKind, x: number, y: number, angle: number, team: Team): Matter.Body {
  const spec = PIECE_SPECS[kind];
  const options: Matter.IChamferableBodyDefinition = {
    friction: 0.9,
    frictionStatic: 1.2,
    restitution: 0.05,
    density: 0.002,
    collisionFilter: teamFilter(team),
  };
  const body =
    spec.shape === "wedge"
      ? Bodies.fromVertices(x, y, [[{ x: 0, y: spec.h }, { x: spec.w, y: spec.h }, { x: 0, y: 0 }]], options)
      : Bodies.rectangle(x, y, spec.w, spec.h, options);
  if (angle) Body.setAngle(body, angle);
  return body;
}

export class SiegeWorld {
  readonly engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
  readonly ground: Matter.Body;
  pieces: Piece[] = [];
  kings: [Piece | null, Piece | null] = [null, null];
  balls: Ball[] = [];
  wind = 0;
  /** Damage is off while building so dropping pieces never hurts. */
  damageOn = false;
  events: WorldEvent[] = [];
  private acc = 0;

  constructor() {
    this.ground = Bodies.rectangle(640, GROUND_Y + 200, 1900, 400, {
      isStatic: true,
      friction: 1,
      collisionFilter: { category: CAT_GROUND, mask: 0xffff, group: 0 },
    });
    Composite.add(this.engine.world, this.ground);
    Events.on(this.engine, "collisionStart", this.onCollision);
  }

  step(dt: number): void {
    this.acc = Math.min(this.acc + dt * 1000, STEP_MS * 5);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      for (const ball of this.balls) {
        this.applyWind(ball.body);
        ball.age += STEP_MS / 1000;
      }
      Engine.update(this.engine, STEP_MS);
      for (const piece of this.pieces) piece.cooldown = Math.max(0, piece.cooldown - STEP_MS / 1000);
      for (const ball of this.balls) if (ball.ammo === "bomb" && ball.touched && !ball.exploded) this.explode(ball);
      this.checkOffscreen();
    }
  }

  private applyWind(body: Matter.Body): void {
    if (!this.wind) return;
    const force = (body.mass * this.wind * WIND_ACCEL) / (STEP_MS * STEP_MS);
    Body.applyForce(body, body.position, { x: force, y: 0 });
  }

  private pieceOf(body: Matter.Body): Piece | undefined {
    const root = body.parent ?? body;
    return this.pieces.find((piece) => piece.body === root);
  }

  private ballOf(body: Matter.Body): Ball | undefined {
    const root = body.parent ?? body;
    return this.balls.find((ball) => ball.body === root);
  }

  private readonly onCollision = (event: Matter.IEventCollision<Matter.Engine>): void => {
    for (const pair of event.pairs) {
      const a = pair.bodyA.parent ?? pair.bodyA;
      const b = pair.bodyB.parent ?? pair.bodyB;
      const speed = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      const ballA = this.ballOf(a);
      const ballB = this.ballOf(b);
      for (const ball of [ballA, ballB]) if (ball) ball.touched = true;
      const contact = pair.collision.supports?.[0] ?? a.position;
      if (speed > 6) this.events.push({ type: "thud", x: contact.x, y: contact.y, speed });
      if (!this.damageOn) continue;
      const hitter = (ballA ?? ballB)?.ammo;
      const heavy = isHeavy(hitter);
      const golden = hitter === "golden";
      const hitByBall = Boolean(ballA || ballB);
      for (const body of [a, b]) {
        const piece = this.pieceOf(body);
        if (!piece || piece.cooldown > 0) continue;
        // Kings are tougher to scratch: only real hits count.
        const damage = piece.kind === "king" ? (speed > 5 ? (speed > 12 || heavy ? 2 : 1) : 0) : impactDamage(speed, heavy && hitByBall);
        if (damage > 0) this.damage(piece, damage + (golden && piece.kind !== "king" ? GOLDEN_BONUS : 0));
      }
    }
  };

  damage(piece: Piece, amount: number): void {
    if (piece.hp <= 0) return;
    piece.hp -= amount;
    piece.cooldown = 0.2;
    const { x, y } = piece.body.position;
    const king = piece.kind === "king";
    this.events.push({ type: "hit", x, y, team: piece.team, damage: amount, king });
    if (piece.hp <= 0) this.destroy(piece);
  }

  private destroy(piece: Piece): void {
    const { x, y } = piece.body.position;
    Composite.remove(this.engine.world, piece.body);
    this.pieces = this.pieces.filter((p) => p !== piece);
    if (piece.kind === "king") {
      this.kings[piece.team] = null;
      this.events.push({ type: "kingDown", x, y, team: piece.team });
    } else {
      this.events.push({ type: "break", x, y, team: piece.team, kind: piece.kind, angle: piece.body.angle });
    }
  }

  private explode(ball: Ball): void {
    ball.exploded = true;
    const center = { ...ball.body.position };
    Composite.remove(this.engine.world, ball.body);
    this.balls = this.balls.filter((b) => b !== ball);
    this.events.push({ type: "boom", x: center.x, y: center.y });
    for (const piece of [...this.pieces]) {
      const dx = piece.body.position.x - center.x;
      const dy = piece.body.position.y - center.y;
      const d = Math.hypot(dx, dy);
      if (d > BOMB_RADIUS) continue;
      const falloff = 1 - d / BOMB_RADIUS;
      const push = 14 * falloff;
      Body.setVelocity(piece.body, {
        x: piece.body.velocity.x + (dx / (d || 1)) * push,
        y: piece.body.velocity.y + (dy / (d || 1)) * push - 3 * falloff,
      });
      Body.setAngularVelocity(piece.body, piece.body.angularVelocity + (Math.random() - 0.5) * 0.3 * falloff);
      if (piece.team !== ball.team) {
        piece.cooldown = 0;
        this.damage(piece, piece.kind === "king" ? (d < 70 ? 2 : 1) : Math.ceil(3 * falloff));
      }
    }
  }

  private checkOffscreen(): void {
    for (const piece of [...this.pieces]) {
      const p = piece.body.position;
      if (p.y > GROUND_Y + 80 || p.x < -120 || p.x > 1400) {
        piece.hp = 0;
        this.destroy(piece);
      }
    }
  }

  /** Where a piece dropped at x would appear: just above whatever is below it. Null if the column is stacked too high. */
  dropBody(kind: PieceKind, x: number, team: Team, rotation: number): Matter.Body | null {
    const body = makePieceBody(kind, x, 0, (rotation * Math.PI) / 2, team);
    const zone = ZONES[team];
    const half = (body.bounds.max.x - body.bounds.min.x) / 2;
    const cx = Math.max(zone.x0 + half, Math.min(zone.x1 - half, x));
    const others = this.pieces.map((piece) => piece.body);
    Body.setPosition(body, { x: cx, y: TOP_Y - body.bounds.min.y + body.position.y - 60 });
    if (Query.collides(body, others).length > 0) return null;
    // Slide down to whatever is below, then back off a little so it lands with a short, satisfying drop.
    const startY = body.position.y;
    for (let i = 0; i < 200; i += 1) {
      Body.setPosition(body, { x: cx, y: body.position.y + 4 });
      if (body.bounds.max.y > GROUND_Y || Query.collides(body, others).length > 0) break;
    }
    Body.setPosition(body, { x: cx, y: Math.max(startY, body.position.y - DROP_GAP) });
    return body;
  }

  spawnPiece(kind: PieceKind, x: number, team: Team, rotation: number): boolean {
    const body = this.dropBody(kind, x, team, rotation);
    if (!body) return false;
    const hp = PIECE_SPECS[kind].hp;
    this.pieces.push({ body, team, kind, hp, maxHp: hp, cooldown: 0 });
    Composite.add(this.engine.world, body);
    return true;
  }

  placeKing(team: Team, x: number): Piece {
    const zone = ZONES[team];
    const cx = Math.max(zone.x0 + KING_SIZE, Math.min(zone.x1 - KING_SIZE, x));
    const body = Bodies.rectangle(cx, GROUND_Y - KING_SIZE / 2, KING_SIZE, KING_SIZE, {
      friction: 0.9,
      density: 0.003,
      chamfer: { radius: 6 },
      collisionFilter: teamFilter(team),
    });
    const king: Piece = { body, team, kind: "king", hp: KING_HP, maxHp: KING_HP, cooldown: 0 };
    this.pieces.push(king);
    this.kings[team] = king;
    Composite.add(this.engine.world, body);
    return king;
  }

  fire(team: Team, ammo: Ammo, vx: number, vy: number): void {
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SHOT_SPEED) {
      vx = (vx / speed) * MAX_SHOT_SPEED;
      vy = (vy / speed) * MAX_SHOT_SPEED;
    }
    const cannon = CANNONS[team];
    const spreads = ammo === "triple" ? [-0.09, 0, 0.09] : [0];
    for (const spread of spreads) {
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const radius = ammo === "boulder" ? 26 : ammo === "golden" ? 20 : ammo === "bomb" ? 16 : ammo === "triple" ? 11 : 15;
      const body = Bodies.circle(cannon.x, cannon.y, radius, {
        density: ammo === "golden" ? 0.03 : ammo === "boulder" ? 0.02 : 0.012,
        frictionAir: 0,
        restitution: 0.25,
        collisionFilter: { category: CAT_BALL[team], mask: CAT_GROUND | CAT_TEAM[team === 0 ? 1 : 0], group: 0 },
      });
      Body.setVelocity(body, { x: vx * cos - vy * sin, y: vx * sin + vy * cos });
      Composite.add(this.engine.world, body);
      this.balls.push({ body, team, ammo, exploded: false, touched: false, age: 0 });
    }
  }

  ballsSettled(): boolean {
    return this.balls.every((ball) => {
      const p = ball.body.position;
      return p.x < -60 || p.x > 1340 || p.y > GROUND_Y + 100 || (ball.touched && ball.body.speed < 0.5);
    });
  }

  /** Real-time mode: retire balls one at a time once they're off-screen, resting, or stale. */
  pruneBalls(maxAge = 7): void {
    this.balls = this.balls.filter((ball) => {
      const p = ball.body.position;
      const done = p.x < -60 || p.x > 1340 || p.y > GROUND_Y + 100 || (ball.touched && ball.body.speed < 0.5) || ball.age > maxAge;
      if (done) Composite.remove(this.engine.world, ball.body);
      return !done;
    });
  }

  clearBalls(): void {
    for (const ball of this.balls) Composite.remove(this.engine.world, ball.body);
    this.balls = [];
  }

  maxPieceSpeed(): number {
    return this.pieces.reduce((max, piece) => Math.max(max, piece.body.speed), 0);
  }

  /** Wipe the board for a new round. */
  reset(): void {
    for (const piece of this.pieces) Composite.remove(this.engine.world, piece.body);
    this.clearBalls();
    this.pieces = [];
    this.kings = [null, null];
    this.events = [];
    this.damageOn = false;
  }

  drainEvents(): WorldEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  destroyWorld(): void {
    Events.off(this.engine, "collisionStart", this.onCollision);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}

/** Preview arc (no wind): points every few steps from the cannon. */
export function previewArc(from: { x: number; y: number }, vx: number, vy: number, points = 22, every = 3): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = from.x;
  let y = from.y;
  for (let i = 1; i <= points * every; i += 1) {
    vy += GRAVITY_PER_STEP;
    x += vx;
    y += vy;
    if (i % every === 0) out.push({ x, y });
    if (y > GROUND_Y) break;
  }
  return out;
}

/** Point-mass sim matching the Matter step, for bots aiming. Returns y when x reaches targetX. */
export function simulateShot(from: { x: number; y: number }, vx: number, vy: number, wind: number, targetX: number): number | null {
  let x = from.x;
  let y = from.y;
  for (let i = 0; i < 600; i += 1) {
    vx += wind * WIND_ACCEL;
    vy += GRAVITY_PER_STEP;
    x += vx;
    y += vy;
    if ((vx > 0 && x >= targetX) || (vx < 0 && x <= targetX)) return y;
    if (y > GROUND_Y + 200) return null;
  }
  return null;
}
