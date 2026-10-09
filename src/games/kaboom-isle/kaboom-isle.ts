import { PLAYER_BINDS } from "../../core/input";
import type { GameContext, GameDefinition, GameInstance, GameStat } from "../../core/types";
import { Callouts, Juice } from "../../fx/juice";
import {
  FIGHTER_R, GRAVITY, PERKS, TILE, WEAPONS, World, perkCount, rollWeapon,
  type Blast, type CrateKind, type Perk, type PerkId, type Weapon, type WeaponId,
} from "./world";

const CRATE_LABEL: Record<CrateKind, { text: string; color: string }> = {
  medkit: { text: "+35 HP", color: "#B8FF3D" },
  double: { text: "DOUBLE DAMAGE", color: "#FF3D7A" },
  shield: { text: "SHIELD", color: "#3EE0FF" },
};

type ChaosId = "lowgrav" | "hurricane" | "meteors" | "craterain" | "bouncy" | "quake" | "surge" | "double" | "jackpot";

interface Chaos {
  id: ChaosId;
  name: string;
  blurb: string;
  color: string;
}

const CHAOS: readonly Chaos[] = [
  { id: "lowgrav", name: "LOW GRAVITY", blurb: "Everything floats. Blasts fling twice as far.", color: "#c084fc" },
  { id: "hurricane", name: "HURRICANE", blurb: "Triple wind this round.", color: "#3EE0FF" },
  { id: "meteors", name: "METEOR SHOWER", blurb: "Rocks are falling. Good luck.", color: "#FF5A1F" },
  { id: "craterain", name: "CRATE RAIN", blurb: "Three supply crates drop in.", color: "#B8FF3D" },
  { id: "bouncy", name: "BOUNCY WORLD", blurb: "Every shot bounces on a fuse.", color: "#B8FF3D" },
  { id: "quake", name: "EARTHQUAKE", blurb: "The ground cracks. Everyone hops.", color: "#FFB020" },
  { id: "surge", name: "LAVA SURGE", blurb: "The lava jumps up.", color: "#FF3D7A" },
  { id: "double", name: "DOUBLE TROUBLE", blurb: "Two shots each this round.", color: "#FFE14D" },
  { id: "jackpot", name: "JACKPOT ROUND", blurb: "Only rare weapons on offer.", color: "#FFB020" },
];

const RARES: readonly WeaponId[] = ["nuke", "blackhole", "airstrike", "cluster", "triple", "drill"];

/** Rough "how good is this pick" for bots choosing a card. */
const BOT_VALUE: Record<WeaponId, number> = {
  nuke: 10, blackhole: 7, airstrike: 7, cluster: 6, triple: 6, grenade: 5, drill: 5, bomb: 4, glove: 4, teleport: 2, chicken: 0,
};

type Phase = "chaos" | "pick" | "aim" | "power" | "flight" | "between" | "islandOver" | "draft" | "over";

const WINS_NEEDED = 2;
const MAX_ISLANDS = 5;
const PICK_TIMEOUT = 6;
const AIM_TIMEOUT = 7;
const POWER_TIMEOUT = 5;
const SUDDEN_DEATH_ROUNDS = 5;
const LAVA_RISE = 40;
const MAX_TURNS = 40;
const AIM_MIN = 0.1;
const AIM_MAX = Math.PI - 0.1;

interface Totals {
  damage: number;
  kos: number;
  best: number;
}

/**
 * Kaboom Isle: Worms-style artillery played only with taps.
 * A match is several islands; first to win two takes it. Every round draws a chaos card,
 * every turn you pick one of three random weapons, and between islands you draft perks.
 * Skill is timing: tap to stop the swinging aim needle, tap again to stop the power meter.
 */
export class KaboomIsle implements GameInstance {
  world: World;
  phase: Phase = "between";
  current = -1;
  turn = 0;
  round = 0;
  island = 1;
  readonly wins: number[];
  readonly perks: PerkId[][];
  private readonly totals: Totals[];
  private phaseT = 0.6;
  private clock = 0;
  private aimT = 0;
  private powerT = 0;
  angle = Math.PI / 2;
  power = 0;
  weapon: Weapon = WEAPONS[0]!;
  choices: Weapon[] = [];
  chaos: Chaos | null = null;
  shotsLeft = 0;
  draftQueue: number[] = [];
  draftOptions: Perk[] = [];
  private shotsPerTurn = 1;
  private jackpot = false;
  private fireFrom = { x: 0, y: 0 };
  private botTarget: { angle: number; power: number } | null = null;
  private done = false;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly floaters: { text: string; x: number; y: number; life: number; color: string }[] = [];
  private terrainCache: HTMLCanvasElement | null = null;
  private cachedVersion = -1;
  private suddenDeath = false;

  constructor(private readonly ctx: GameContext) {
    const n = ctx.players.length;
    this.wins = Array.from({ length: n }, () => 0);
    this.perks = Array.from({ length: n }, () => []);
    this.totals = Array.from({ length: n }, () => ({ damage: 0, kos: 0, best: 0 }));
    this.world = new World(ctx.width, ctx.height, ctx.rng, n, this.perks);
    this.juice = new Juice(() => ctx.rng.next());
    this.callouts.show("ISLAND 1", "#F4F7FB", { size: 72 });
  }

  // ---------- flow ----------

  private nextTurn(): void {
    const alive = this.world.alive();
    if (alive.length <= 1 || this.turn >= MAX_TURNS) {
      this.endIsland();
      return;
    }
    const n = this.world.fighters.length;
    let next = this.current;
    for (let i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (this.world.fighters[next]!.alive) break;
    }
    const newRound = this.current < 0 || next <= this.current;
    this.current = next;
    this.turn++;
    this.world.rollWind();
    if (newRound) {
      this.startRound();
      if (this.phase === "islandOver" || this.phase === "over") return;
      if (!this.world.fighters[this.current]!.alive) {
        this.nextTurn();
        return;
      }
      if (this.chaos) {
        this.phase = "chaos";
        this.phaseT = 0;
        this.ctx.sfx.streak(2);
        return;
      }
    }
    this.startTurn();
  }

  private startRound(): void {
    this.round++;
    const w = this.world;
    // Reset last round's chaos.
    w.gravity = GRAVITY;
    w.windMul = 1;
    w.bouncy = false;
    this.shotsPerTurn = 1;
    this.jackpot = false;
    this.chaos = null;
    if (w.crates.length < 3 && this.ctx.rng.next() < 0.6) w.spawnCrate();
    if (this.round > SUDDEN_DEATH_ROUNDS) {
      if (!this.suddenDeath) this.callouts.show("SUDDEN DEATH", "#FF5A1F", { size: 72 });
      this.suddenDeath = true;
      w.lava -= LAVA_RISE;
      this.lavaCheck();
    }
    if (this.round >= 2) {
      const chaos = this.ctx.rng.pick(CHAOS);
      this.chaos = chaos;
      switch (chaos.id) {
        case "lowgrav": w.gravity = GRAVITY * 0.45; break;
        case "hurricane": w.windMul = 3; break;
        case "meteors": for (let i = 0; i < 6; i++) w.meteor(this.ctx.rng.float(60, this.ctx.width - 60)); break;
        case "craterain": for (let i = 0; i < 3; i++) w.spawnCrate(); break;
        case "bouncy": w.bouncy = true; break;
        case "quake": w.quake(this.turn); this.juice.shake(1); break;
        case "surge": w.lava -= 45; this.lavaCheck(); break;
        case "double": this.shotsPerTurn = 2; break;
        case "jackpot": this.jackpot = true; break;
      }
    }
    if (w.alive().length <= 1) this.endIsland();
  }

  private lavaCheck(): void {
    for (const f of this.world.fighters) {
      if (f.alive && f.y + FIGHTER_R > this.world.lava) {
        if (f.fireproofLeft > 0) {
          f.fireproofLeft--;
          f.y = this.world.lava - 60;
          f.vy = -700;
        } else this.world.kill(f, this.turn, null);
      }
    }
  }

  private startTurn(): void {
    this.shotsLeft = this.shotsPerTurn;
    this.startPick();
  }

  private startPick(): void {
    const me = this.world.fighters[this.current]!;
    const count = 3 + Math.min(1, perkCount(me, "lucky"));
    const lucky = perkCount(me, "lucky") > 0;
    const pool = this.jackpot ? WEAPONS.filter((w) => RARES.includes(w.id)) : WEAPONS;
    const choices: Weapon[] = [];
    for (let tries = 0; choices.length < count && tries < 60; tries++) {
      let w = this.jackpot ? this.ctx.rng.pick(pool) : rollWeapon(this.ctx.rng);
      // Lucky: one reroll toward a rare.
      if (lucky && !RARES.includes(w.id)) w = rollWeapon(this.ctx.rng);
      if (!choices.some((c) => c.id === w.id)) choices.push(w);
    }
    this.choices = choices;
    this.phase = "pick";
    this.phaseT = 0;
    this.botTarget = null;
    this.angle = Math.PI / 2;
    this.power = 0;
    this.ctx.sfx.select();
  }

  private choose(index: number): void {
    const w = this.choices[index];
    if (!w) return;
    this.weapon = w;
    this.phase = "aim";
    this.aimT = this.ctx.rng.float(0, 6);
    this.phaseT = 0;
    if (w.id === "nuke") this.callouts.show("MEGA NUKE", "#FF5A1F", { size: 60 });
    else this.ctx.sfx.tick();
    if (!this.isHumanTurn) this.botTarget = this.planBot();
  }

  private endIsland(): void {
    const alive = this.world.alive();
    let winner: number | null = null;
    if (alive.length === 1) winner = alive[0]!.index;
    else if (alive.length > 1) {
      const top = Math.max(...alive.map((f) => f.hp));
      const leaders = alive.filter((f) => f.hp === top);
      if (leaders.length === 1) winner = leaders[0]!.index;
    }
    for (const f of this.world.fighters) {
      const t = this.totals[f.index]!;
      t.damage += f.damageDealt;
      t.kos += f.kos;
      t.best = Math.max(t.best, f.bestHit);
    }
    if (winner !== null) {
      this.wins[winner]!++;
      const p = this.ctx.players[winner]!;
      this.callouts.show(`${p.name.toUpperCase()} TAKES ISLAND ${this.island}`, p.color, { size: 64, life: 2.6 });
    } else {
      this.callouts.show(`ISLAND ${this.island}: NO SURVIVORS`, "#F4F7FB", { size: 60, life: 2.6 });
    }
    this.ctx.sfx.win();
    this.chaos = null;
    this.phase = "islandOver";
    this.phaseT = 2.8;
  }

  private afterIsland(): void {
    const best = Math.max(...this.wins);
    if (best >= WINS_NEEDED || this.island >= MAX_ISLANDS) {
      this.phase = "over";
      this.phaseT = 4.5;
      const leaders = this.wins.map((w, i) => (w === best ? i : -1)).filter((i) => i >= 0);
      const text = leaders.length === 1 ? `${this.ctx.players[leaders[0]!]!.name.toUpperCase()} WINS THE MATCH` : "IT'S A TIE";
      this.callouts.show(text, leaders.length === 1 ? this.ctx.players[leaders[0]!]!.color : "#F4F7FB", { size: 72, life: 4 });
      return;
    }
    // Losers draft first.
    this.draftQueue = this.ctx.players.map((_, i) => i).sort((a, b) => this.wins[a]! - this.wins[b]! || a - b);
    this.startDraftFor();
  }

  private startDraftFor(): void {
    if (this.draftQueue.length === 0) {
      this.newIsland();
      return;
    }
    const opts: Perk[] = [];
    while (opts.length < 3) {
      const k = this.ctx.rng.pick(PERKS);
      if (!opts.includes(k)) opts.push(k);
    }
    this.draftOptions = opts;
    this.phase = "draft";
    this.phaseT = 0;
    this.ctx.sfx.select();
  }

  private draft(index: number): void {
    const who = this.draftQueue.shift();
    const perk = this.draftOptions[index];
    if (who === undefined || !perk) return;
    this.perks[who]!.push(perk.id);
    this.ctx.sfx.collect();
    this.startDraftFor();
  }

  private newIsland(): void {
    this.island++;
    this.world = new World(this.ctx.width, this.ctx.height, this.ctx.rng, this.ctx.players.length, this.perks);
    this.cachedVersion = -1;
    this.current = -1;
    this.turn = 0;
    this.round = 0;
    this.suddenDeath = false;
    this.chaos = null;
    this.phase = "between";
    this.phaseT = 1;
    this.callouts.show(`ISLAND ${this.island}`, "#F4F7FB", { size: 72 });
  }

  private get isHumanTurn(): boolean {
    return this.ctx.players[this.current]?.kind === "human";
  }

  /** Tap position (null for a key press) or false when nothing was pressed. */
  private readInput(): { x: number; y: number } | null | false {
    const click = this.ctx.input.consumeClick();
    if (click) return click;
    if (this.ctx.input.justPressed("Space")) return null;
    for (const bind of PLAYER_BINDS) if (this.ctx.input.justPressed(bind.action)) return null;
    return false;
  }

  private cardAt(pt: { x: number; y: number } | null, count: number): number {
    if (!pt) return 0;
    return this.cardRects(count).findIndex((r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h);
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

    const input = this.readInput();
    const tap = input !== false;
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
      } else if (e.type === "fireproof") {
        this.floaters.push({ text: "FIREPROOF!", x: e.x, y: e.y - 30, life: 1.4, color: "#FFB020" });
        this.juice.burst(e.x, e.y, ["#FF5A1F", "#FFB020"], { count: 24, speed: 300, size: 6, angle: -Math.PI / 2, spread: 1.4 });
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
      case "chaos":
        this.phaseT += realDt;
        if (this.phaseT > 1.8 || (tap && this.phaseT > 0.4)) this.startTurn();
        break;
      case "pick": {
        this.phaseT += realDt;
        if (human) {
          if (tap && this.phaseT > 0.25) {
            const i = this.cardAt(input, this.choices.length);
            if (i >= 0) this.choose(i);
          } else if (this.phaseT > PICK_TIMEOUT) this.choose(0);
        } else if (this.phaseT > 0.7) {
          let best = 0;
          this.choices.forEach((c, i) => {
            if (BOT_VALUE[c.id] + this.ctx.rng.float(0, 2.5) > BOT_VALUE[this.choices[best]!.id]) best = i;
          });
          this.choose(best);
        }
        break;
      }
      case "aim": {
        this.phaseT += dt;
        this.aimT += dt;
        this.angle = Math.PI / 2 + (AIM_MAX - Math.PI / 2) * Math.sin(this.aimT * 1.9);
        const lock = human
          ? (tap && this.phaseT > 0.12) || this.phaseT > AIM_TIMEOUT
          : this.phaseT > 0.35 && (Math.abs(this.angle - this.botTarget!.angle) < 0.05 || this.phaseT > AIM_TIMEOUT);
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
          : this.phaseT > 0.25 && (Math.abs(this.power - this.botTarget!.power) < 0.03 || this.phaseT > POWER_TIMEOUT);
        if (fire) {
          const me = this.world.fighters[this.current]!;
          this.fireFrom = { x: me.x, y: me.y };
          this.world.fire(this.current, this.angle, this.power, this.weapon);
          this.shotsLeft--;
          this.ctx.sfx.whoosh();
          this.phase = "flight";
          this.phaseT = 0;
        }
        break;
      }
      case "flight":
        this.phaseT += dt;
        if ((this.world.settled() && this.phaseT > 0.35) || this.phaseT > 14) {
          const me = this.world.fighters[this.current]!;
          if (this.shotsLeft > 0 && me.alive && this.world.alive().length > 1) this.startPick();
          else {
            this.phase = "between";
            this.phaseT = 0.5;
          }
        }
        break;
      case "islandOver":
        this.phaseT -= realDt;
        if (this.phaseT <= 0) this.afterIsland();
        break;
      case "draft": {
        this.phaseT += realDt;
        const who = this.draftQueue[0]!;
        if (this.ctx.players[who]!.kind === "human") {
          if (tap && this.phaseT > 0.3) {
            const i = this.cardAt(input, this.draftOptions.length);
            if (i >= 0) this.draft(i);
          } else if (this.phaseT > 12) this.draft(0);
        } else if (this.phaseT > 0.9) {
          this.draft(this.ctx.rng.int(0, this.draftOptions.length - 1));
        }
        break;
      }
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
    // Trick-shot callouts for the shooter.
    const enemies = b.hits.filter((h) => h.index !== this.current);
    if (this.phase === "flight" && enemies.length >= 2) this.callouts.show("MULTI-HIT!", "#FFE14D", { size: 52 });
    else if (this.phase === "flight" && enemies.length > 0 && Math.hypot(b.x - this.fireFrom.x, b.y - this.fireFrom.y) > 650) {
      this.callouts.show("SNIPE!", "#3EE0FF", { size: 52 });
    } else if (this.phase === "flight" && enemies.some((h) => h.damage >= 45)) this.callouts.show("CRUSHED!", "#FF3D7A", { size: 52 });
  }

  private onKo(index: number): void {
    const f = this.world.fighters[index]!;
    const p = this.ctx.players[index]!;
    this.callouts.show(f.hp > 0 ? `${p.name.toUpperCase()} GOT LAVA'D` : `${p.name.toUpperCase()} IS OUT`, p.color);
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
    if (this.phase === "pick") this.drawPick(g);
    if (this.phase === "draft") this.drawDraft(g);
    if (this.phase === "chaos") this.drawChaos(g);
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
    const active = index === this.current && this.phase !== "over" && this.phase !== "islandOver" && this.phase !== "draft";
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
    g.fillRect(f.x - bw / 2, f.y - FIGHTER_R - 14, (bw * Math.min(f.maxHp, Math.max(0, f.hp))) / f.maxHp, 6);
    if (f.hp > f.maxHp) {
      g.fillStyle = "#3EE0FF";
      g.fillRect(f.x - bw / 2, f.y - FIGHTER_R - 14, (bw * (f.hp - f.maxHp)) / f.maxHp, 6);
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
      if (s.fuse !== undefined) {
        g.fillStyle = "#F4F7FB";
        g.font = "700 14px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillText(Math.max(0, s.fuse - s.age).toFixed(1), s.x, s.y - 12);
      }
    }
  }

  private cardRects(count: number): { x: number; y: number; w: number; h: number }[] {
    const { width: w, height: h } = this.ctx;
    const cw = count > 3 ? 210 : 240;
    const ch = 150;
    const gap = 18;
    const total = count * cw + (count - 1) * gap;
    return Array.from({ length: count }, (_, i) => ({ x: w / 2 - total / 2 + i * (cw + gap), y: h * 0.36, w: cw, h: ch }));
  }

  private drawCards(g: CanvasRenderingContext2D, title: string, titleColor: string, cards: { name: string; blurb: string; color: string; tag?: string }[]): void {
    const { width: w, height: h } = this.ctx;
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(0, 0, w, h);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 46px Bebas Neue, Impact, sans-serif";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.9)";
    g.strokeText(title, w / 2, h * 0.27);
    g.fillStyle = titleColor;
    g.fillText(title, w / 2, h * 0.27);
    const pop = Math.min(1, this.phaseT * 5);
    this.cardRects(cards.length).forEach((r, i) => {
      const c = cards[i]!;
      g.save();
      g.translate(r.x + r.w / 2, r.y + r.h / 2);
      g.scale(pop, pop);
      g.fillStyle = "#0f1626";
      g.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      g.strokeStyle = c.color;
      g.lineWidth = 4;
      g.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
      g.fillStyle = c.color;
      g.font = "700 32px Bebas Neue, Impact, sans-serif";
      g.fillText(c.name, 0, -r.h / 2 + 44, r.w - 16);
      g.fillStyle = "#cbd5e1";
      g.font = "500 15px Outfit, sans-serif";
      wrap(g, c.blurb, 0, 6, r.w - 28, 19);
      if (c.tag) {
        g.fillStyle = c.color;
        g.font = "700 13px Outfit, sans-serif";
        g.fillText(c.tag, 0, r.h / 2 - 16);
      }
      g.restore();
    });
    g.textBaseline = "alphabetic";
  }

  private drawPick(g: CanvasRenderingContext2D): void {
    const p = this.ctx.players[this.current]!;
    this.drawCards(g, `${p.name.toUpperCase()}: PICK YOUR WEAPON`, p.color, this.choices.map((c) => ({
      name: c.name, blurb: c.blurb, color: c.color, tag: c.weight <= 6 ? "RARE" : "",
    })));
  }

  private drawDraft(g: CanvasRenderingContext2D): void {
    const who = this.draftQueue[0];
    if (who === undefined) return;
    const p = this.ctx.players[who]!;
    this.drawCards(g, `${p.name.toUpperCase()}: PICK A PERK`, p.color, this.draftOptions.map((k) => ({
      name: k.name, blurb: k.blurb, color: k.color, tag: this.perks[who]!.includes(k.id) ? "STACKS" : "",
    })));
  }

  private drawChaos(g: CanvasRenderingContext2D): void {
    if (!this.chaos) return;
    const { width: w, height: h } = this.ctx;
    const t = Math.min(1, this.phaseT * 4);
    g.save();
    g.translate(w / 2, h * 0.45);
    g.rotate((1 - t) * 0.6);
    g.scale(t, t);
    g.fillStyle = "#0f1626";
    g.fillRect(-230, -90, 460, 180);
    g.strokeStyle = this.chaos.color;
    g.lineWidth = 6;
    g.strokeRect(-230, -90, 460, 180);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#94a3b8";
    g.font = "700 18px Outfit, sans-serif";
    g.fillText(`ROUND ${this.round} CHAOS CARD`, 0, -58);
    g.fillStyle = this.chaos.color;
    g.font = "700 56px Bebas Neue, Impact, sans-serif";
    g.fillText(this.chaos.name, 0, -6);
    g.fillStyle = "#F4F7FB";
    g.font = "500 18px Outfit, sans-serif";
    g.fillText(this.chaos.blurb, 0, 48);
    g.restore();
    g.textBaseline = "alphabetic";
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
    // Island wins
    g.textAlign = "left";
    this.ctx.players.forEach((pl, i) => {
      const y = 92 + i * 22;
      g.fillStyle = pl.color;
      g.font = "600 14px Outfit, sans-serif";
      g.fillText(pl.name, 24, y);
      for (let k = 0; k < WINS_NEEDED; k++) {
        g.beginPath();
        g.arc(100 + k * 16, y, 5, 0, Math.PI * 2);
        if (k < this.wins[i]!) g.fill();
        else {
          g.strokeStyle = pl.color;
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
    });
    if (this.chaos) {
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.fillRect(w - 200, 60, 180, 30);
      g.fillStyle = this.chaos.color;
      g.font = "700 18px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.fillText(this.chaos.name, w - 110, 76);
    }
    if (this.current >= 0 && this.phase !== "over" && this.phase !== "draft" && this.phase !== "islandOver") {
      const p = this.ctx.players[this.current]!;
      g.textAlign = "left";
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillStyle = p.color;
      g.fillText(`${p.name.toUpperCase()}'S TURN`, 24, 34);
      g.font = "700 20px Bebas Neue, Impact, sans-serif";
      g.fillStyle = this.suddenDeath ? "#FF5A1F" : "#cbd5e1";
      g.fillText(`ISLAND ${this.island} · ROUND ${this.round}${this.suddenDeath ? " · LAVA RISING" : ""}`, 24, 62);
      if (this.phase === "aim" || this.phase === "power" || this.phase === "flight") {
        const shown = this.weapon;
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
        g.fillText(this.shotsLeft > 1 ? `${shown.blurb} · ${this.shotsLeft} shots left` : shown.blurb, w / 2, 56);
      }
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
    return this.ctx.players.map((player, i) => ({ playerId: player.id, score: this.wins[i]! * 10000 + this.totals[i]!.damage }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    this.ctx.players.forEach((player, i) => {
      const t = this.totals[i]!;
      stats.push({ playerId: player.id, label: "Islands", value: String(this.wins[i]) });
      stats.push({ playerId: player.id, label: "Damage", value: String(t.damage) });
      stats.push({ playerId: player.id, label: "KOs", value: String(t.kos) });
      if (t.best > 0) stats.push({ playerId: player.id, label: "Best hit", value: String(t.best) });
      if (this.perks[i]!.length > 0) {
        stats.push({ playerId: player.id, label: "Perks", value: this.perks[i]!.map((id) => PERKS.find((k) => k.id === id)!.name).join(", ") });
      }
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

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => g.fillText(l, x, y + (i - (lines.length - 1) / 2) * lineH));
}

export const kaboomIsle: GameDefinition = {
  id: "kaboom-isle",
  name: "Kaboom Isle",
  tagline: "Tap-timed artillery. Chaos cards. Perk drafts. Lava below.",
  description:
    "Blobs on crumbling floating islands over lava. First to win two islands takes the match. Every turn pick one of three random weapons (bomb, bouncer, cluster, triple, airstrike, drill, black hole, teleporter, boxing glove, the rare Mega Nuke, or a rubber chicken), then tap to stop the swinging aim needle and tap again to stop the power meter. Every round flips a chaos card: low gravity, hurricane, meteor shower, crate rain, bouncy world, earthquake, lava surge, double trouble or a jackpot round. Between islands everyone drafts a perk (losers first) and perks stack. Crates give HP, double damage or a shield. 0 HP or lava and you're out; after five rounds the lava rises.",
  durationMs: 0,
  controls: "Tap a card to pick · tap to lock aim · tap again to fire",
  create: (ctx) => new KaboomIsle(ctx),
};
