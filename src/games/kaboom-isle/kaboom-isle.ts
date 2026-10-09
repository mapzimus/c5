import { PLAYER_BINDS } from "../../core/input";
import type { GameContext, GameDefinition, GameInstance, GameStat } from "../../core/types";
import { Callouts, Juice } from "../../fx/juice";
import { FIGHTER_R, TILE, WEAPONS, World, rollWeapon, type Blast, type CrateKind, type Weapon } from "./world";

const CRATE_LABEL: Record<CrateKind, { text: string; color: string }> = {
  medkit: { text: "+35 HP", color: "#B8FF3D" },
  double: { text: "DOUBLE DAMAGE", color: "#FF3D7A" },
  shield: { text: "SHIELD", color: "#3EE0FF" },
};

type Phase = "roulette" | "aim" | "power" | "flight" | "between" | "over";

const ROULETTE_S = 1.4;
const AIM_TIMEOUT = 7;
const POWER_TIMEOUT = 5;
const SUDDEN_DEATH_ROUNDS = 6;
const LAVA_RISE = 30;
const MAX_TURNS = 80;
const AIM_MIN = 0.1;
const AIM_MAX = Math.PI - 0.1;

/**
 * Kaboom Isle: Worms-style artillery played only with taps.
 * Luck picks your weapon (slot roll), the wind and the bounces. Skill is timing:
 * tap to stop the swinging aim needle, tap again to stop the power meter.
 */
export class KaboomIsle implements GameInstance {
  readonly world: World;
  phase: Phase = "between";
  current = -1;
  turn = 0;
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
  private readonly floaters: { text: string; x: number; y: number; life: number; color: string }[] = [];
  private terrainCache: HTMLCanvasElement | null = null;
  private cachedVersion = -1;
  private suddenDeath = false;

  constructor(private readonly ctx: GameContext) {
    this.world = new World(ctx.width, ctx.height, ctx.rng, ctx.players.length);
    this.juice = new Juice(() => ctx.rng.next());
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
    this.current = next;
    this.turn++;
    // A supply crate parachutes in most rounds.
    if (this.turn % n === 1 && this.world.crates.length < 3 && this.ctx.rng.next() < 0.75) this.world.spawnCrate();
    if (this.turn > SUDDEN_DEATH_ROUNDS * n) {
      if (!this.suddenDeath) this.callouts.show("SUDDEN DEATH", "#FF5A1F", { size: 72 });
      this.suddenDeath = true;
      this.world.lava -= LAVA_RISE;
      // The lava may have just swallowed someone.
      for (const f of this.world.fighters) if (f.alive && f.y + FIGHTER_R > this.world.lava) this.world.kill(f, this.turn, null);
      if (this.world.alive().length <= 1) {
        this.endMatch();
        return;
      }
      if (!this.world.fighters[this.current]!.alive) {
        this.nextTurn();
        return;
      }
    }
    this.world.rollWind();
    this.weapon = rollWeapon(this.ctx.rng);
    this.phase = "roulette";
    this.phaseT = ROULETTE_S;
    this.botTarget = null;
    this.angle = Math.PI / 2;
    this.power = 0;
    this.ctx.sfx.select();
  }

  private endMatch(): void {
    this.phase = "over";
    this.phaseT = 4.5;
    const alive = this.world.alive();
    if (alive.length === 1) {
      const p = this.ctx.players[alive[0]!.index]!;
      this.callouts.show(`${p.name.toUpperCase()} WINS`, p.color, { size: 80, life: 4 });
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

  update(dt: number): void {
    const realDt = dt;
    dt = this.juice.update(dt);
    this.callouts.update(realDt);
    this.clock += realDt;
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 40 * realDt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i]!.life <= 0) this.floaters.splice(i, 1);

    const tap = this.tapped();
    const human = this.isHumanTurn;

    // Physics always runs so knockback settles between turns too.
    const before = this.world.fighters.map((f) => f.alive);
    const blasts = this.world.step(dt, this.turn);
    for (const b of blasts) this.onBlast(b);
    for (const e of this.world.events.splice(0)) {
      if (e.type === "crate") {
        const label = CRATE_LABEL[e.kind];
        this.floaters.push({ text: label.text, x: e.x, y: e.y - 20, life: 1.6, color: label.color });
        this.juice.burst(e.x, e.y, [label.color, "#F4F7FB"], { count: 20, speed: 240, size: 5 });
        this.ctx.sfx.collect();
      } else if (e.type === "teleport") {
        this.juice.burst(e.x, e.y, ["#22d3ee", "#F4F7FB"], { count: 24, speed: 260, size: 5, gravity: 0 });
        this.ctx.sfx.go();
      } else {
        const f = this.world.fighters[e.index]!;
        this.floaters.push({ text: "BLOCKED", x: f.x, y: f.y - 50, life: 1.1, color: "#3EE0FF" });
      }
    }
    this.world.fighters.forEach((f, i) => {
      if (before[i] && !f.alive) this.onKo(i);
    });

    switch (this.phase) {
      case "between":
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.nextTurn();
        break;
      case "roulette":
        this.phaseT -= dt;
        this.rouletteFace += dt * (4 + 26 * Math.max(0, this.phaseT / ROULETTE_S));
        if (this.phaseT <= 0) {
          this.phase = "aim";
          this.aimT = this.ctx.rng.float(0, 6);
          this.phaseT = 0;
          if (this.weapon.id === "nuke") this.callouts.show("JACKPOT! MEGA NUKE", "#FF5A1F", { size: 60 });
          else this.ctx.sfx.tick();
          if (!human) this.botTarget = this.planBot();
        }
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
        if (fire) {
          this.world.fire(this.current, this.angle, this.power, this.weapon);
          this.ctx.sfx.whoosh();
          this.phase = "flight";
          this.phaseT = 0;
        }
        break;
      }
      case "flight":
        this.phaseT += dt;
        if ((this.world.settled() && this.phaseT > 0.5) || this.phaseT > 14) {
          this.phase = "between";
          this.phaseT = 0.8;
        }
        break;
      case "over":
        this.phaseT -= realDt;
        if (this.phaseT <= 0 || (tap && this.phaseT < 3)) this.done = true;
        break;
    }
  }

  private onBlast(b: Blast): void {
    if (b.splash) {
      this.juice.burst(b.x, b.y, ["#FF5A1F", "#FFB020"], { count: 10, speed: 200, angle: -Math.PI / 2, spread: 1.2 });
      return;
    }
    if (b.weapon.id === "chicken") {
      this.ctx.sfx.miss();
      this.floaters.push({ text: "SQUEAK", x: b.x, y: b.y - 20, life: 1.2, color: "#FFE14D" });
      if (b.hits.length === 0) this.callouts.show("DUD!", "#FFE14D");
    } else {
      this.ctx.sfx.hit();
      this.juice.shake(Math.min(1, b.radius / 110));
      if (b.radius > 90) this.juice.hitStop(0.08);
      this.juice.burst(b.x, b.y, ["#FFB020", "#FF5A1F", "#F4F7FB", b.weapon.color], { count: Math.round(b.radius / 2), speed: b.radius * 6, size: 6 });
      this.juice.burst(b.x, b.y, ["#5b3a22", "#3d6b2a"], { count: 12, speed: 320, size: 5 });
    }
    for (const hit of b.hits) {
      const f = this.world.fighters[hit.index]!;
      this.floaters.push({ text: `-${hit.damage}`, x: f.x, y: f.y - 34, life: 1.1, color: "#FF3D7A" });
    }
  }

  private onKo(index: number): void {
    const f = this.world.fighters[index]!;
    const p = this.ctx.players[index]!;
    this.callouts.show(`${p.name.toUpperCase()} IS OUT`, p.color);
    this.juice.burst(f.x, Math.min(f.y, this.world.lava), [p.color, "#FF5A1F", "#FFB020"], { count: 40, speed: 420, size: 7 });
    this.juice.shake(0.5);
    this.juice.slowMo(0.6);
    this.ctx.sfx.streak(3);
  }

  /** Search angles/powers for a landing spot near an enemy, then fumble it a bit. */
  private planBot(): { angle: number; power: number } {
    const me = this.world.fighters[this.current]!;
    const enemies = this.world.alive().filter((f) => f.index !== me.index);
    let best = { angle: Math.PI / 2, power: 0.5, score: Infinity };
    for (let a = AIM_MIN + 0.05; a < AIM_MAX - 0.05; a += 0.06) {
      for (let p = 0.2; p <= 1; p += 0.05) {
        const land = this.world.predict(me.index, a, p);
        let score = Math.min(...enemies.map((e) => Math.hypot(e.x - land.x, e.y - land.y)));
        if (Math.hypot(me.x - land.x, me.y - land.y) < this.weapon.radius + 10) score += 400;
        if (score < best.score) best = { angle: a, power: p, score };
      }
    }
    const rng = this.ctx.rng;
    return {
      angle: Math.min(AIM_MAX, Math.max(AIM_MIN, best.angle + rng.float(-0.07, 0.07))),
      power: Math.min(1, Math.max(0.02, best.power + rng.float(-0.06, 0.06))),
    };
  }

  // ---------- render ----------

  render(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#1a0f2e");
    sky.addColorStop(0.6, "#3a1530");
    sky.addColorStop(1, "#6b1d1d");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    this.juice.begin(g);
    this.drawTerrain(g);
    this.drawLava(g);
    this.drawGhost(g);
    this.drawCrates(g);
    this.drawVortices(g);
    this.drawAim(g);
    for (const f of this.world.fighters) this.drawFighter(g, f.index);
    this.drawShots(g);
    for (const f of this.floaters) {
      g.globalAlpha = Math.min(1, f.life * 2);
      g.font = "700 26px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
    this.juice.end(g);

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
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, top + Math.sin(x * 0.03 + this.clock * 2.4) * 5);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,176,32,0.5)";
    for (let x = 0; x <= w; x += 16) g.fillRect(x, top + Math.sin(x * 0.03 + this.clock * 2.4) * 5, 16, 4);
  }

  private drawFighter(g: CanvasRenderingContext2D, index: number): void {
    const f = this.world.fighters[index]!;
    if (!f.alive) return;
    const p = this.ctx.players[index]!;
    const active = index === this.current && this.phase !== "over";
    g.save();
    g.translate(f.x, f.y);
    const squash = f.grounded ? 1 + Math.sin(this.clock * 6 + index) * 0.04 : 1;
    g.scale(1 / squash, squash);
    g.fillStyle = f.hurt > 0 && Math.floor(this.clock * 20) % 2 === 0 ? "#ffffff" : p.color;
    g.shadowColor = p.color;
    g.shadowBlur = active ? 20 : 8;
    g.beginPath();
    g.arc(0, 0, FIGHTER_R, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    // Eyes look along the aim on your turn, toward the middle otherwise.
    const look = active && (this.phase === "aim" || this.phase === "power") ? this.angle : f.x < this.ctx.width / 2 ? 0.2 : Math.PI - 0.2;
    for (const ex of [-5, 5]) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(ex, -3, 4.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#070b14";
      g.beginPath();
      g.arc(ex + Math.cos(look) * 2, -3 - Math.sin(look) * 2, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // HP bar + name
    const bw = 40;
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(f.x - bw / 2, f.y - FIGHTER_R - 14, bw, 6);
    g.fillStyle = f.hp > 50 ? "#B8FF3D" : f.hp > 25 ? "#FFB020" : "#FF3D7A";
    g.fillRect(f.x - bw / 2, f.y - FIGHTER_R - 14, (bw * Math.min(100, Math.max(0, f.hp))) / 100, 6);
    if (f.hp > 100) {
      g.fillStyle = "#3EE0FF";
      g.fillRect(f.x - bw / 2, f.y - FIGHTER_R - 14, (bw * (f.hp - 100)) / 100, 6);
    }
    if (f.shield) {
      g.strokeStyle = "rgba(62,224,255,0.7)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(f.x, f.y, FIGHTER_R + 5, 0, Math.PI * 2);
      g.stroke();
    }
    if (f.doubleDamage) {
      g.fillStyle = "#FF3D7A";
      g.font = "700 12px Outfit, sans-serif";
      g.textAlign = "center";
      g.fillText("2x", f.x + bw / 2 + 10, f.y - FIGHTER_R - 8);
    }
    g.font = "600 14px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillStyle = "#F4F7FB";
    g.fillText(p.name, f.x, f.y - FIGHTER_R - 20);
    if (active) {
      const bob = Math.sin(this.clock * 6) * 4;
      g.fillStyle = p.color;
      g.beginPath();
      g.moveTo(f.x - 8, f.y - FIGHTER_R - 48 + bob);
      g.lineTo(f.x + 8, f.y - FIGHTER_R - 48 + bob);
      g.lineTo(f.x, f.y - FIGHTER_R - 38 + bob);
      g.closePath();
      g.fill();
    }
  }

  private drawGhost(g: CanvasRenderingContext2D): void {
    if (this.phase !== "aim" && this.phase !== "power") return;
    const path = this.world.ghosts[this.current];
    if (!path || path.length < 2) return;
    g.save();
    g.setLineDash([6, 8]);
    g.strokeStyle = "rgba(244,247,251,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    path.forEach((pt, i) => (i === 0 ? g.moveTo(pt.x, pt.y) : g.lineTo(pt.x, pt.y)));
    g.stroke();
    const end = path[path.length - 1]!;
    g.setLineDash([]);
    g.strokeStyle = "rgba(244,247,251,0.5)";
    g.beginPath();
    g.moveTo(end.x - 6, end.y - 6);
    g.lineTo(end.x + 6, end.y + 6);
    g.moveTo(end.x + 6, end.y - 6);
    g.lineTo(end.x - 6, end.y + 6);
    g.stroke();
    g.restore();
  }

  private drawCrates(g: CanvasRenderingContext2D): void {
    for (const c of this.world.crates) {
      const label = CRATE_LABEL[c.kind];
      if (!c.landed) {
        // Parachute
        g.strokeStyle = "rgba(244,247,251,0.6)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(c.x - 10, c.y - 8);
        g.lineTo(c.x - 18, c.y - 34);
        g.moveTo(c.x + 10, c.y - 8);
        g.lineTo(c.x + 18, c.y - 34);
        g.stroke();
        g.fillStyle = "#F4F7FB";
        g.beginPath();
        g.arc(c.x, c.y - 34, 20, Math.PI, 0);
        g.fill();
      }
      g.fillStyle = "#8b5a2b";
      g.fillRect(c.x - 11, c.y - 10, 22, 22);
      g.strokeStyle = label.color;
      g.lineWidth = 3;
      g.strokeRect(c.x - 11, c.y - 10, 22, 22);
      g.fillStyle = label.color;
      g.font = "700 14px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(c.kind === "medkit" ? "+" : c.kind === "double" ? "2x" : "◆", c.x, c.y + 1);
      g.textBaseline = "alphabetic";
    }
  }

  private drawVortices(g: CanvasRenderingContext2D): void {
    for (const v of this.world.vortices) {
      for (let i = 0; i < 4; i++) {
        const r = ((this.clock * 120 + i * 40) % 160) + 8;
        g.strokeStyle = `rgba(168,85,247,${0.6 * (1 - r / 170)})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(v.x, v.y, 168 - r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = "#070b14";
      g.beginPath();
      g.arc(v.x, v.y, 14 + Math.sin(this.clock * 20) * 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#a855f7";
      g.lineWidth = 2;
      g.stroke();
    }
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
      g.strokeStyle = "rgba(244,247,251,0.25)";
      g.lineWidth = 2;
      g.beginPath();
      s.trail.forEach((pt, i) => (i === 0 ? g.moveTo(pt.x, pt.y) : g.lineTo(pt.x, pt.y)));
      g.stroke();
      const r = s.mini ? 4 : s.weapon.id === "nuke" ? 10 : 6;
      if (s.weapon.id === "drill") {
        const a = Math.atan2(s.vy, s.vx);
        g.save();
        g.translate(s.x, s.y);
        g.rotate(a);
        g.fillStyle = s.drilling > 0 ? "#FFB020" : "#94a3b8";
        g.beginPath();
        g.moveTo(12, 0);
        g.lineTo(-8, -6);
        g.lineTo(-8, 6);
        g.closePath();
        g.fill();
        g.restore();
        if (s.drilling > 0 && Math.random() < 0.5) this.juice.burst(s.x, s.y, ["#8b5a2b", "#5b3a22"], { count: 2, speed: 160, size: 4 });
        continue;
      }
      g.fillStyle = s.weapon.id === "bomb" ? "#1f2937" : s.weapon.color;
      g.beginPath();
      g.arc(s.x, s.y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = s.weapon.color;
      g.lineWidth = 2;
      g.stroke();
      if (s.weapon.fuse !== undefined) {
        g.fillStyle = "#F4F7FB";
        g.font = "700 14px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillText(Math.max(0, s.weapon.fuse - s.age).toFixed(1), s.x, s.y - 12);
      }
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    g.textBaseline = "middle";
    // Wind
    const wind = this.world.wind;
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(w - 200, 14, 180, 40);
    g.fillStyle = "#F4F7FB";
    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    g.fillText("WIND", w - 190, 34);
    g.fillStyle = "#3EE0FF";
    const cx = w - 90;
    g.fillRect(wind < 0 ? cx + wind * 60 : cx, 30, Math.abs(wind) * 60, 8);
    g.fillStyle = "#F4F7FB";
    g.fillRect(cx - 1, 24, 2, 20);

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
      const shown = this.phase === "roulette" ? WEAPONS[Math.floor(this.rouletteFace) % WEAPONS.length]! : this.weapon;
      const cardW = 300;
      const x = w / 2 - cardW / 2;
      g.fillStyle = "rgba(7,11,20,0.75)";
      g.fillRect(x, 12, cardW, 58);
      g.strokeStyle = shown.color;
      g.lineWidth = 3;
      g.strokeRect(x, 12, cardW, 58);
      g.textAlign = "center";
      g.fillStyle = shown.color;
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillText(shown.name, w / 2, 34);
      g.fillStyle = "#cbd5e1";
      g.font = "500 14px Outfit, sans-serif";
      g.fillText(this.phase === "roulette" ? "spinning…" : shown.blurb, w / 2, 56);

      if (this.isHumanTurn && (this.phase === "aim" || this.phase === "power")) {
        const msg = this.phase === "aim" ? "TAP TO LOCK AIM" : "TAP TO FIRE";
        const pulse = 0.75 + 0.25 * Math.sin(this.clock * 8);
        g.globalAlpha = pulse;
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
  tagline: "Tap-timed artillery. Lucky weapons. Lava below.",
  description:
    "Blobs on crumbling floating islands over lava. Each turn a slot spins your weapon: bomb, bouncer, cluster, triple shot, airstrike, drill, black hole, teleporter, boxing glove, the jackpot Mega Nuke, or a useless rubber chicken. Supply crates parachute in: grab one by touching it or blasting it for HP, double damage or a shield. A ghost of your last shot shows while you aim. Tap to stop the swinging aim needle, tap again to stop the power meter. Wind changes every turn. Blasts carve the ground and fling fighters; 0 HP or a dip in the lava and you're out. After six rounds the lava starts rising. Last blob standing wins.",
  durationMs: 0,
  controls: "Tap to lock aim · tap again to fire (or any action key)",
  create: (ctx) => new KaboomIsle(ctx),
};
