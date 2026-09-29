import Matter from "matter-js";
import { PIECE_SPECS, type PieceKind, type Team } from "./rules";

const { Engine, Bodies, Body, Composite, Query } = Matter;

export const GROUND_Y = 590;
export const TOP_Y = 96;
export const ZONES = [
  { x0: 80, x1: 600 },
  { x0: 680, x1: 1200 },
] as const;
export const CANNONS = [
  { x: 36, y: GROUND_Y - 22 },
  { x: 1244, y: GROUND_Y - 22 },
] as const;

const STEP_MS = 1000 / 60;
/** Matter velocity is px per step; gravity adds this much vy each step. */
export const GRAVITY_PER_STEP = 0.001 * STEP_MS * STEP_MS;
/** Horizontal accel (px/step²) per 1 unit of wind. */
export const WIND_ACCEL = 0.0024;
export const MAX_SHOT_SPEED = 26;
const BALL_RADIUS = 15;

const CAT_GROUND = 0x1;
const CAT_TEAM = [0x2, 0x4] as const;
const CAT_BALL = [0x8, 0x10] as const;
const CAT_GHOST = 0x20;

export interface Piece {
  body: Matter.Body;
  team: Team;
  kind: PieceKind;
  base: boolean;
}

export interface ShotRecord {
  team: Team;
  wind: number;
  /** How far the wind pushed the shot sideways by the time it fell back to launch height (px). */
  drift: number;
}

interface Ghosts {
  calm: Matter.Body;
  windy: Matter.Body;
  team: Team;
  wind: number;
  steps: number;
}

function pieceFilter(team: Team): Matter.ICollisionFilter {
  const enemyBall = CAT_BALL[team === 0 ? 1 : 0];
  return { category: CAT_TEAM[team], mask: CAT_GROUND | CAT_TEAM[0] | CAT_TEAM[1] | enemyBall, group: 0 };
}

export function makePieceBody(kind: PieceKind, x: number, y: number, angle: number, team: Team, base: boolean): Matter.Body {
  const spec = PIECE_SPECS[kind];
  const options: Matter.IChamferableBodyDefinition = {
    friction: 0.9,
    frictionStatic: 1.2,
    restitution: 0.02,
    density: 0.002,
    isStatic: base,
    collisionFilter: pieceFilter(team),
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
  ball: Matter.Body | null = null;
  ballTeam: Team = 0;
  wind = 0;
  readonly shots: ShotRecord[] = [];
  private ghosts: Ghosts | null = null;
  private acc = 0;

  constructor() {
    this.ground = Bodies.rectangle(640, GROUND_Y + 200, 1800, 400, {
      isStatic: true,
      friction: 1,
      collisionFilter: { category: CAT_GROUND, mask: 0xffff, group: 0 },
    });
    Composite.add(this.engine.world, this.ground);
  }

  step(dt: number): void {
    this.acc = Math.min(this.acc + dt * 1000, STEP_MS * 5);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      this.applyWind(this.ball);
      if (this.ghosts) this.applyWind(this.ghosts.windy);
      Engine.update(this.engine, STEP_MS);
      this.trackGhosts();
    }
  }

  private applyWind(body: Matter.Body | null): void {
    if (!body || !this.wind) return;
    const force = (body.mass * this.wind * WIND_ACCEL) / (STEP_MS * STEP_MS);
    Body.applyForce(body, body.position, { x: force, y: 0 });
  }

  /** True if the body is inside the team zone and overlaps no other piece. */
  fits(body: Matter.Body, team: Team): boolean {
    const zone = ZONES[team];
    const b = body.bounds;
    if (b.min.x < zone.x0 || b.max.x > zone.x1 || b.min.y < TOP_Y || b.max.y > GROUND_Y + 0.5) return false;
    return Query.collides(body, this.pieces.map((piece) => piece.body)).length === 0;
  }

  /** Base pieces snap down so their bottom sits on the ground. */
  snapToGround(body: Matter.Body): void {
    Body.setPosition(body, { x: body.position.x, y: body.position.y + (GROUND_Y - body.bounds.max.y) });
  }

  /** Slide a body straight down from the top until it would touch something. Returns false if nothing but ground is below. */
  dropFromTop(body: Matter.Body): boolean {
    Body.setPosition(body, { x: body.position.x, y: body.position.y + (TOP_Y - body.bounds.min.y) });
    const others = [...this.pieces.map((piece) => piece.body), this.ground];
    for (let i = 0; i < 200; i += 1) {
      Body.setPosition(body, { x: body.position.x, y: body.position.y + 3 });
      const hits = Query.collides(body, others);
      if (hits.length > 0) {
        Body.setPosition(body, { x: body.position.x, y: body.position.y - 3 });
        return !hits.some((hit) => hit.bodyA === this.ground || hit.bodyB === this.ground);
      }
    }
    return false;
  }

  addPiece(piece: Piece): void {
    this.pieces.push(piece);
    Composite.add(this.engine.world, piece.body);
  }

  standing(team: Team): number {
    return this.pieces.filter((piece) => piece.team === team && !piece.base).length;
  }

  /** Remove every non-base piece touching the ground or gone off-screen. Returns how many per team. */
  eliminateGrounded(): [number, number] {
    const removed: [number, number] = [0, 0];
    const grounded = new Set<Matter.Body>();
    for (const hit of Query.collides(this.ground, this.pieces.map((piece) => piece.body))) {
      grounded.add(hit.bodyA === this.ground ? hit.bodyB : hit.bodyA);
    }
    this.pieces = this.pieces.filter((piece) => {
      if (piece.base) return true;
      const p = piece.body.position;
      const gone = grounded.has(piece.body) || p.y > GROUND_Y + 60 || p.x < -80 || p.x > 1360;
      if (gone) {
        removed[piece.team] += 1;
        Composite.remove(this.engine.world, piece.body);
      }
      return !gone;
    });
    return removed;
  }

  maxPieceSpeed(): number {
    return this.pieces.reduce((max, piece) => Math.max(max, piece.body.speed), 0);
  }

  fire(team: Team, vx: number, vy: number): void {
    this.clearBall();
    const cannon = CANNONS[team];
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SHOT_SPEED) {
      vx = (vx / speed) * MAX_SHOT_SPEED;
      vy = (vy / speed) * MAX_SHOT_SPEED;
    }
    const make = (filter: Matter.ICollisionFilter) => {
      const body = Bodies.circle(cannon.x, cannon.y, BALL_RADIUS, {
        density: 0.012,
        frictionAir: 0,
        restitution: 0.2,
        collisionFilter: filter,
      });
      Body.setVelocity(body, { x: vx, y: vy });
      Composite.add(this.engine.world, body);
      return body;
    };
    this.ballTeam = team;
    this.ball = make({ category: CAT_BALL[team], mask: CAT_GROUND | CAT_TEAM[team === 0 ? 1 : 0], group: 0 });
    const ghost = { category: CAT_GHOST, mask: 0, group: 0 };
    this.ghosts = { calm: make(ghost), windy: make(ghost), team, wind: this.wind, steps: 0 };
  }

  private trackGhosts(): void {
    const g = this.ghosts;
    if (!g) return;
    g.steps += 1;
    const falling = g.calm.velocity.y > 0;
    if ((falling && g.calm.position.y >= CANNONS[g.team].y) || g.steps > 1200) {
      this.shots.push({ team: g.team, wind: g.wind, drift: Math.round(g.windy.position.x - g.calm.position.x) });
      Composite.remove(this.engine.world, [g.calm, g.windy]);
      this.ghosts = null;
    }
  }

  ballOut(): boolean {
    const b = this.ball;
    if (!b) return true;
    return b.position.x < -60 || b.position.x > 1340 || b.position.y > GROUND_Y + 100;
  }

  clearBall(): void {
    if (this.ball) Composite.remove(this.engine.world, this.ball);
    this.ball = null;
  }

  shotPending(): boolean {
    return this.ghosts !== null;
  }

  destroy(): void {
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}

/** Point-mass sim matching the Matter step, for bots aiming. Returns y when x reaches targetX. */
export function simulateShot(
  from: { x: number; y: number },
  vx: number,
  vy: number,
  wind: number,
  targetX: number,
): number | null {
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
