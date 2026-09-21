import Matter from "matter-js";

export type LandingResult = "MAKE" | "MISS";

export interface LandingInfo {
  result: LandingResult;
  tilt: number | null;
  perfect: boolean;
  reason: string;
}

export interface LiquidState {
  slosh: number;
  vel: number;
  settleTimer: number;
  renderOffset(): number;
  isSettled(): boolean;
  reset(): void;
  update(bottleAngVel: number, dt: number): void;
}

const { Engine, Bodies, Body, World } = Matter;

const SPIN_BASE = 0.14;
const SPIN_RANGE = 0.1;
const POWER_SPEED = 4000;
const WALL_INSET = 14;

const SETTLE_FRAMES = 22;
const SETTLE_RANGE = 0.03;
const PERFECT_ANGLE = 0.16;
const MISS_CAP_FRAMES = 300;

const FEEL = { makeAngle: 0.62, fallenAngle: 1.16, spinJitter: 0.28, launchJitter: 0.14, kickScale: 1.15 };

/**
 * Matter.js bottle-flip world from Whydah-Unit parrot-flip.
 * Same body, spin, landing, and liquid kick — painted as a parrot in the renderer.
 */
export class ParrotPhysics {
  private engine: Matter.Engine | null = null;
  private world: Matter.World | null = null;
  private bottle: Matter.Body | null = null;
  private ground: Matter.Body | null = null;
  private leftWall: Matter.Body | null = null;
  private rightWall: Matter.Body | null = null;
  private canvasW = 0;
  private canvasH = 0;
  private groundY = 0;
  private wallsOn = true;
  private groundedFrames = 0;
  private angleWin: number[] = [];
  private totalRotation = 0;
  private hasFlipped = false;
  private launchAngle = 0;
  private hasLanded = false;
  private lastLandingInfo: LandingInfo | null = null;
  private lastFlickInfo: { upSpeed: number; power: number; vx: number; vy: number } | null = null;

  readonly liquid: LiquidState = {
    slosh: 0,
    vel: 0,
    settleTimer: 0,
    renderOffset() {
      return this.slosh * 13;
    },
    isSettled() {
      return this.settleTimer > 0.25;
    },
    reset() {
      this.slosh = 0;
      this.vel = 0;
      this.settleTimer = 0;
    },
    update(bottleAngVel: number, dt: number) {
      const spring = -0.1 * this.slosh;
      const drive = 0.4 * bottleAngVel;
      const damping = -0.08 * this.vel;
      this.vel += (spring + drive + damping) * dt;
      this.slosh += this.vel * dt;
      this.slosh = Math.max(-1, Math.min(1, this.slosh));
      this.settleTimer = Math.abs(this.vel) < 0.1 ? this.settleTimer + dt : 0;
    },
  };

  constructor(private readonly rand: () => number = Math.random) {}

  init(w: number, h: number, bottomInset = 0): void {
    this.canvasW = w;
    this.canvasH = h;
    this.groundY = h - 30 - bottomInset;
    this.rebuildEngine(1.5);

    this.ground = Bodies.rectangle(w / 2, this.groundY + 25, w * 6, 50, {
      isStatic: true,
      label: "ground",
      friction: 0.9,
      restitution: 0.01,
    });

    const wallOpts = { isStatic: true, label: "wall", friction: 0, restitution: 0 };
    this.leftWall = Bodies.rectangle(WALL_INSET - 20, h / 2, 40, h * 3, wallOpts);
    this.rightWall = Bodies.rectangle(w - WALL_INSET + 20, h / 2, 40, h * 3, wallOpts);

    World.add(this.world!, [this.ground, this.leftWall, this.rightWall]);
    this.placeWalls(w, h);
    this.resetBottle();
  }

  reflow(w: number, h: number, bottomInset = 0): void {
    if (!this.engine) return;
    this.canvasW = w;
    this.canvasH = h;
    this.groundY = h - 30 - bottomInset;
    if (!this.ground) return;
    Body.setPosition(this.ground, { x: w / 2, y: this.groundY + 25 });
    this.placeWalls(w, h);
    if (this.bottle && this.bottle.position.y > this.groundY - 20) {
      const pad = this.wallsOn ? WALL_INSET + 40 : 40;
      Body.setPosition(this.bottle, {
        x: Math.max(pad, Math.min(w - pad, this.bottle.position.x)),
        y: this.groundY - 76,
      });
      Body.setVelocity(this.bottle, { x: 0, y: 0 });
      Body.setAngularVelocity(this.bottle, 0);
    }
  }

  setSideWalls(on: boolean): void {
    this.wallsOn = !!on;
    if (this.engine) this.placeWalls(this.canvasW, this.canvasH);
  }

  resetBottle(): void {
    if (this.bottle && this.world) World.remove(this.world, this.bottle);
    this.groundedFrames = 0;
    this.angleWin = [];
    this.totalRotation = 0;
    this.hasFlipped = false;
    this.launchAngle = 0;
    this.hasLanded = false;
    this.lastLandingInfo = null;
    this.lastFlickInfo = null;
    this.liquid.reset();
    this.bottle = this.createBottle();
    World.add(this.world!, this.bottle);
  }

  applyFlick(vx: number, vy: number): void {
    if (!this.bottle) return;
    const upSpeed = Math.max(0, -vy);
    const power = Math.min(upSpeed / POWER_SPEED, 1);
    this.lastFlickInfo = { upSpeed, power, vx, vy };

    const jSpin = 1 + (this.rand() - 0.5) * FEEL.spinJitter;
    const jLaunch = 1 + (this.rand() - 0.5) * FEEL.launchJitter;
    const jDrift = (this.rand() - 0.5) * 3.8;

    const launchY = this.launchImpulse(power) * jLaunch;
    const launchX = Math.max(-6, Math.min(6, vx / 280)) + jDrift;
    const dir = vx >= 0 ? 1 : -1;
    const spin = dir * (SPIN_BASE + power * SPIN_RANGE) * jSpin;

    this.launchAngle = this.bottle.angle;
    Body.setVelocity(this.bottle, { x: launchX, y: launchY });
    Body.setAngularVelocity(this.bottle, spin);
  }

  step(dt: number): void {
    if (!this.engine || !this.bottle) return;
    Engine.update(this.engine, dt * 1000);
    if (!this.hasFlipped) {
      this.totalRotation = Math.abs(this.bottle.angle - this.launchAngle);
      if (this.totalRotation >= 5.6) this.hasFlipped = true;
    }
    if (
      this.hasFlipped &&
      !this.hasLanded &&
      this.bottle.velocity.y > 0 &&
      this.bottle.position.y >= this.groundY - 55
    ) {
      this.hasLanded = true;
      const kick = (this.liquid.vel * 0.06 + (this.rand() - 0.5) * 0.16) * FEEL.kickScale;
      Body.setAngularVelocity(this.bottle, this.bottle.angularVelocity + kick);
    }
    this.liquid.update(this.bottle.angularVelocity, dt);
  }

  checkLanding(): LandingResult | null {
    if (!this.bottle) return null;
    const angVel = Math.abs(this.bottle.angularVelocity);
    const linSpeed = Math.hypot(this.bottle.velocity.x, this.bottle.velocity.y);
    const restY = this.groundY - 76;
    const grounded = this.bottle.position.y >= restY - 12;

    if (!grounded) {
      this.groundedFrames = 0;
      this.angleWin = [];
      return null;
    }

    this.groundedFrames += 1;
    if (this.groundedFrames > MISS_CAP_FRAMES) return this.recordLanding("MISS", null, "timeout");

    if (angVel < 0.01 && linSpeed < 7) {
      this.angleWin.push(this.bottle.angle);
      if (this.angleWin.length > SETTLE_FRAMES) this.angleWin.shift();
      let lo = Infinity;
      let hi = -Infinity;
      for (const a of this.angleWin) {
        if (a < lo) lo = a;
        if (a > hi) hi = a;
      }
      if (this.angleWin.length >= SETTLE_FRAMES && hi - lo < SETTLE_RANGE) {
        if (!this.hasFlipped) return this.recordLanding("MISS", null, "underrotated");
        let angle = ((this.bottle.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (angle > Math.PI) angle -= 2 * Math.PI;
        const tilt = Math.abs(angle);
        if (tilt < FEEL.makeAngle) return this.recordLanding("MAKE", tilt, "upright");
        if (tilt >= FEEL.fallenAngle) return this.recordLanding("MISS", tilt, "fallen");
      }
    } else {
      this.angleWin = [];
    }
    return null;
  }

  getBottle(): Matter.Body | null {
    return this.bottle;
  }

  getGroundY(): number {
    return this.groundY;
  }

  getLastLandingInfo(): LandingInfo | null {
    return this.lastLandingInfo;
  }

  getLastFlickInfo(): { upSpeed: number; power: number; vx: number; vy: number } | null {
    return this.lastFlickInfo;
  }

  destroy(): void {
    if (this.engine) {
      try {
        World.clear(this.engine.world, false);
        Engine.clear(this.engine);
      } catch {
        /* already torn down */
      }
    }
    this.engine = this.world = this.bottle = this.ground = this.leftWall = this.rightWall = null;
  }

  private placeWalls(w: number, h: number): void {
    if (!this.leftWall || !this.rightWall) return;
    if (this.wallsOn) {
      Body.setPosition(this.leftWall, { x: WALL_INSET - 20, y: h / 2 });
      Body.setPosition(this.rightWall, { x: w - WALL_INSET + 20, y: h / 2 });
    } else {
      Body.setPosition(this.leftWall, { x: -50000, y: h / 2 });
      Body.setPosition(this.rightWall, { x: 50000, y: h / 2 });
    }
  }

  private createBottle(): Matter.Body {
    const cx = this.canvasW / 2;
    const cy = this.groundY - 76;
    const liq = Bodies.rectangle(cx, cy + 38, 74, 70, { density: 0.018 });
    const body = Bodies.rectangle(cx, cy - 18, 70, 50, { density: 0.0015 });
    const neck = Bodies.rectangle(cx, cy - 62, 44, 36, { density: 0.0004 });
    return Body.create({
      parts: [liq, body, neck],
      frictionAir: 0.025,
      friction: 0.85,
      restitution: 0.02,
      label: "bottle",
    });
  }

  private launchImpulse(power: number): number {
    const startY = this.bottle ? this.bottle.position.y : 400;
    const sky = Math.max(180, startY - 56);
    const peak = sky * (0.62 + power * 0.18);
    return -(8.8 + 0.043 * peak);
  }

  private recordLanding(result: LandingResult, tilt: number | null, reason: string): LandingResult {
    this.lastLandingInfo = {
      result,
      tilt,
      perfect: result === "MAKE" && tilt != null && tilt <= PERFECT_ANGLE,
      reason,
    };
    return result;
  }

  private rebuildEngine(gravityY: number): void {
    if (this.engine) {
      try {
        World.clear(this.engine.world, false);
        Engine.clear(this.engine);
      } catch {
        /* first init */
      }
    }
    this.bottle = this.ground = this.leftWall = this.rightWall = null;
    this.engine = Engine.create({ gravity: { x: 0, y: gravityY, scale: 0.001 } });
    this.world = this.engine.world;
    this.engine.gravity.y = gravityY;
    this.engine.gravity.scale = 0.001;
  }
}
