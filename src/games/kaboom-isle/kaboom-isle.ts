import { PLAYER_BINDS } from "../../core/input";
import type { GameContext, GameDefinition, GameInstance, GameStat } from "../../core/types";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import {
  LAVA_ROUND, MAX_ROUNDS, OVERDRIVE_ROUND, PANEL_H, WINS_NEEDED, botGustDir, botSwatChance, draftOrder, heatFor, inRect, islandWinner,
  lavaRises, matchResult, maxIslands, panelCards, panelRects, seatAt, type Rect,
} from "./logic";
import {
  FIGHTER_R, GRAVITY, PERKS, SWAT_RANGE, SWAT_WINDOW, TILE, WEAPONS, World, perkCount, rollWeapon,
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

const BOT_TAUNTS_HIT = ["heh heh", "BOOM!", "gotcha", "too easy"];
const BOT_TAUNTS_MISS = ["oops", "wind...", "hmm", "next time"];
const BOT_TAUNTS_GHOST = ["BOO!", "whoosh", "hehe", "blow!"];

type Phase = "between" | "chaos" | "volley" | "islandOver" | "draft" | "over";
type Stage = "idle" | "pick" | "aim" | "power" | "done";

const PICK_TIMEOUT = 5;
const AIM_TIMEOUT = 5;
const POWER_TIMEOUT = 3.5;
const VOLLEY_MAX = 9;
const LAVA_RISE = 50;
const AIM_MIN = 0.1;
const AIM_MAX = Math.PI - 0.1;
const AIM_SPEED = 2.5;
const POWER_SPEED = 4.2;
const GUST_COOLDOWN = 1.1;
const BEST_VERSION = "v2-volley";

interface Totals {
  damage: number;
  kos: number;
  best: number;
  haunts: number;
  returns: number;
}

/** Everything one seat is doing during a volley. */
interface Seat {
  stage: Stage;
  t: number;
  aimT: number;
  powerT: number;
  angle: number;
  power: number;
  weapon: Weapon;
  choices: Weapon[];
  shotsLeft: number;
  botTarget: { angle: number; power: number } | null;
  botDelay: number;
  botSwatAt: number;
  gustCd: number;
  botGhostT: number;
  fireFrom: { x: number; y: number };
  flash: number;
  taunt: { text: string; life: number } | null;
}

interface Tap {
  x: number;
  y: number;
  /** Keyboard presses carry the seat and a kind instead of a position. */
  seat?: number;
  kind?: "action" | "swat" | "left" | "right";
}

/**
 * Kaboom Isle: tap-timed artillery where everybody fires at once.
 * Each volley every survivor picks a weapon from their own bottom panel, taps to stop the swinging
 * aim needle and taps again to stop the power meter, all at the same time. The island heats up every
 * round, ghosts of the fallen blow the wind around, and one SWAT per island bats a bomb back at its owner.
 */
export class KaboomIsle implements GameInstance {
  world: World;
  phase: Phase = "between";
  round = 0;
  island = 1;
  readonly wins: number[];
  readonly perks: PerkId[][];
  readonly seats: Seat[];
  private readonly totals: Totals[];
  private readonly panels: Rect[];
  private phaseT = 0.8;
  private clock = 0;
  private volleyT = 0;
  chaos: Chaos | null = null;
  draftQueue: number[] = [];
  draftOptions: Perk[] = [];
  heat = 1;
  private shotsPerTurn = 1;
  private jackpot = false;
  private done = false;
  private overdrive = false;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly floaters: { text: string; x: number; y: number; life: number; color: string }[] = [];
  private readonly taps: Tap[] = [];
  private terrainCache: HTMLCanvasElement | null = null;
  private cachedVersion = -1;
  private gustPuff = { dir: 0, life: 0, color: "#fff" };
  private readonly worldH: number;
  private readonly islandsMax: number;

  constructor(private readonly ctx: GameContext) {
    const n = ctx.players.length;
    this.islandsMax = maxIslands(n);
    this.wins = Array.from({ length: n }, () => 0);
    this.perks = Array.from({ length: n }, () => []);
    this.totals = Array.from({ length: n }, () => ({ damage: 0, kos: 0, best: 0, haunts: 0, returns: 0 }));
    this.seats = Array.from({ length: n }, () => this.freshSeat());
    this.panels = panelRects(ctx.width, ctx.height, n);
    this.worldH = ctx.height - PANEL_H;
    this.world = new World(ctx.width, this.worldH, ctx.rng, n, this.perks);
    this.juice = new Juice(() => ctx.rng.next());
    this.callouts.show("ISLAND 1", "#F4F7FB", { size: 72 });
    ctx.canvas.style.touchAction = "none";
    ctx.canvas.addEventListener("pointerdown", this.onDown, { passive: false });
  }

  private freshSeat(): Seat {
    return {
      stage: "idle", t: 0, aimT: 0, powerT: 0, angle: Math.PI / 2, power: 0, weapon: WEAPONS[0]!, choices: [], shotsLeft: 0,
      botTarget: null, botDelay: 0, botSwatAt: -1, gustCd: 0, botGhostT: 1, fireFrom: { x: 0, y: 0 }, flash: 0, taunt: null,
    };
  }

  // ---------- flow ----------

  private startRound(): void {
    const w = this.world;
    if (w.alive().length <= 1 || this.round >= MAX_ROUNDS) {
      this.endIsland();
      return;
    }
    this.round++;
    w.gravity = GRAVITY;
    w.windMul = 1;
    w.bouncy = false;
    this.shotsPerTurn = 1;
    this.jackpot = false;
    this.chaos = null;
    w.rollWind();
    const final = this.island >= this.islandsMax;
    this.heat = heatFor(this.round, final);
    w.damageMul = this.heat;
    if (w.crates.length < 3 && this.ctx.rng.next() < 0.6) w.spawnCrate();
    if (lavaRises(this.round, final)) {
      w.lava -= LAVA_RISE;
      this.lavaCheck();
      if (!this.overdrive && this.round >= OVERDRIVE_ROUND) {
        this.overdrive = true;
        this.callouts.show("OVERDRIVE", "#FF5A1F", { size: 76, life: 1.6 });
        this.juice.shake(0.5);
      } else this.callouts.show("LAVA RISING", "#FF5A1F", { size: 48, life: 1, y: 0.2 });
    }
    const dog = w.markUnderdog();
    if (dog !== null) {
      const f = w.fighters[dog]!;
      this.floaters.push({ text: "UNDERDOG +30%", x: f.x, y: f.y - 56, life: 1.6, color: "#FFE14D" });
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
        case "quake": w.quake(this.round); this.juice.shake(1); break;
        case "surge": w.lava -= 45; this.lavaCheck(); break;
        case "double": this.shotsPerTurn = 2; break;
        case "jackpot": this.jackpot = true; break;
      }
      if (w.alive().length <= 1) {
        this.endIsland();
        return;
      }
      this.phase = "chaos";
      this.phaseT = 0;
      this.ctx.sfx.streak(2);
      return;
    }
    this.startVolley();
  }

  private lavaCheck(): void {
    for (const f of this.world.fighters) {
      if (f.alive && f.y + FIGHTER_R > this.world.lava) {
        if (f.fireproofLeft > 0) {
          f.fireproofLeft--;
          f.y = this.world.lava - 60;
          f.vy = -700;
        } else this.world.kill(f, this.round, null);
      }
    }
  }

  private startVolley(): void {
    this.phase = "volley";
    this.phaseT = 0;
    this.volleyT = 0;
    this.world.fighters.forEach((f, i) => {
      const s = this.seats[i]!;
      if (!f.alive) {
        s.stage = "idle";
        return;
      }
      s.shotsLeft = this.shotsPerTurn;
      this.startPick(i);
    });
    this.ctx.sfx.select();
  }

  private startPick(i: number): void {
    const me = this.world.fighters[i]!;
    const s = this.seats[i]!;
    const count = 3 + Math.min(1, perkCount(me, "lucky") + (me.underdog ? 1 : 0));
    const lucky = perkCount(me, "lucky") > 0;
    const pool = this.jackpot ? WEAPONS.filter((w) => RARES.includes(w.id)) : WEAPONS;
    const choices: Weapon[] = [];
    for (let tries = 0; choices.length < count && tries < 60; tries++) {
      let w = this.jackpot ? this.ctx.rng.pick(pool) : rollWeapon(this.ctx.rng);
      if (lucky && !RARES.includes(w.id)) w = rollWeapon(this.ctx.rng);
      if (!choices.some((c) => c.id === w.id)) choices.push(w);
    }
    s.choices = choices;
    s.stage = "pick";
    s.t = 0;
    s.botTarget = null;
    s.botDelay = this.ctx.rng.float(0.35, 1.1);
    s.angle = Math.PI / 2;
    s.power = 0;
  }

  private choose(i: number, index: number): void {
    const s = this.seats[i]!;
    const w = s.choices[index];
    if (!w) return;
    s.weapon = w;
    s.stage = "aim";
    s.aimT = this.ctx.rng.float(0, 6);
    s.t = 0;
    s.flash = 0.3;
    if (w.id === "nuke") this.callouts.show(`${this.ctx.players[i]!.name.toUpperCase()} HAS THE NUKE`, "#FF5A1F", { size: 54, life: 1.1 });
    else this.ctx.sfx.tick();
    if (!this.isHuman(i)) s.botTarget = this.planBot(i, w);
  }

  private lockAim(i: number): void {
    const s = this.seats[i]!;
    s.stage = "power";
    s.t = 0;
    s.powerT = 0;
    s.flash = 0.3;
    this.ctx.sfx.tick();
  }

  private fire(i: number): void {
    const s = this.seats[i]!;
    const me = this.world.fighters[i]!;
    s.fireFrom = { x: me.x, y: me.y };
    this.world.fire(i, s.angle, s.power, s.weapon);
    s.shotsLeft--;
    s.stage = "done";
    s.t = 0;
    s.flash = 0.4;
    this.ctx.sfx.whoosh();
    this.juice.burst(me.x + Math.cos(s.angle) * 20, me.y - Math.sin(s.angle) * 20, ["#F4F7FB", s.weapon.color], { count: 8, speed: 200, size: 4, angle: -s.angle, spread: 0.8, gravity: 0 });
  }

  private volleyDone(): boolean {
    return this.world.fighters.every((f, i) => {
      const s = this.seats[i]!;
      return !f.alive || (s.stage === "done" && s.shotsLeft <= 0) || s.stage === "idle";
    });
  }

  private endIsland(): void {
    const winner = islandWinner(this.world.fighters);
    for (const f of this.world.fighters) {
      const t = this.totals[f.index]!;
      t.damage += f.damageDealt;
      t.kos += f.kos;
      t.best = Math.max(t.best, f.bestHit);
      t.haunts += f.haunts;
      t.returns += f.returns;
    }
    if (winner !== null) {
      this.wins[winner]!++;
      const p = this.ctx.players[winner]!;
      this.callouts.show(`${p.name.toUpperCase()} TAKES ISLAND ${this.island}`, p.color, { size: 64, life: 2.4 });
      const f = this.world.fighters[winner]!;
      if (f.alive) this.juice.burst(f.x, f.y, [p.color, "#F4F7FB", "#FFE14D"], { count: 40, speed: 380, size: 6, gravity: 300 });
    } else {
      this.callouts.show(`ISLAND ${this.island}: NO SURVIVORS`, "#F4F7FB", { size: 60, life: 2.4 });
    }
    this.ctx.sfx.win();
    this.chaos = null;
    for (const s of this.seats) s.stage = "idle";
    this.phase = "islandOver";
    this.phaseT = 2;
  }

  private afterIsland(): void {
    const result = matchResult(this.wins, this.island, this.islandsMax, this.totals.map((t) => t.damage));
    if (result) {
      this.phase = "over";
      this.phaseT = 3.2;
      const one = result.winners.length === 1 ? this.ctx.players[result.winners[0]!]! : null;
      const text = one ? `${one.name.toUpperCase()} WINS${result.onDamage ? " ON DAMAGE" : " THE MATCH"}` : "IT'S A TIE";
      this.callouts.show(text, one ? one.color : "#F4F7FB", { size: 72, life: 4 });
      return;
    }
    this.draftQueue = draftOrder(this.wins);
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
    this.world = new World(this.ctx.width, this.worldH, this.ctx.rng, this.ctx.players.length, this.perks);
    this.cachedVersion = -1;
    this.round = 0;
    this.overdrive = false;
    this.chaos = null;
    this.heat = 1;
    for (let i = 0; i < this.seats.length; i++) this.seats[i] = this.freshSeat();
    this.phase = "between";
    this.phaseT = 0.9;
    const final = this.island >= this.islandsMax;
    this.callouts.show(final ? "FINAL ISLAND" : `ISLAND ${this.island}`, final ? "#FF5A1F" : "#F4F7FB", { size: 72 });
  }

  private isHuman(i: number): boolean {
    return this.ctx.players[i]?.kind === "human";
  }

  // ---------- input ----------

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.cancelable) e.preventDefault();
    const p = this.toLogical(e);
    this.taps.push({ x: p.x, y: p.y });
  };

  /** Collect this frame's taps: pointer taps carry a position, key presses a seat and a kind. */
  private readTaps(): Tap[] {
    const taps = this.taps.splice(0);
    const click = this.ctx.input.consumeClick();
    void click; // our own pointerdown listener already queued it
    this.ctx.players.forEach((pl, i) => {
      if (pl.kind !== "human") return;
      const bind = PLAYER_BINDS[pl.slot] ?? PLAYER_BINDS[i]!;
      if (this.ctx.input.justPressed(bind.action)) taps.push({ x: -1, y: -1, seat: i, kind: "action" });
      if (this.ctx.input.justPressed(bind.up)) taps.push({ x: -1, y: -1, seat: i, kind: "swat" });
      if (this.ctx.input.justPressed(bind.left)) taps.push({ x: -1, y: -1, seat: i, kind: "left" });
      if (this.ctx.input.justPressed(bind.right)) taps.push({ x: -1, y: -1, seat: i, kind: "right" });
    });
    return taps;
  }

  /** Route a tap to a seat action during a volley. */
  private handleVolleyTap(tap: Tap): void {
    // Tap on (or near) your own blob while the SWAT ring is up: bat the bomb away.
    if (tap.seat === undefined) {
      for (const f of this.world.fighters) {
        if (!f.alive || !this.isHuman(f.index) || f.swatWindow <= 0) continue;
        if (Math.hypot(f.x - tap.x, f.y - tap.y) < SWAT_RANGE) {
          this.trySwat(f.index);
          return;
        }
      }
    }
    const i = tap.seat ?? seatAt(this.panels, tap.x, tap.y);
    if (i < 0 || !this.isHuman(i)) return;
    const f = this.world.fighters[i]!;
    const s = this.seats[i]!;
    const panel = this.panels[i]!;
    if (!f.alive) {
      // Ghost: left half blows left, right half blows right.
      const dir = tap.kind === "left" ? -1 : tap.kind === "right" ? 1 : tap.kind ? 0 : tap.x < panel.x + panel.w / 2 ? -1 : 1;
      if (dir !== 0) this.tryGust(i, dir);
      return;
    }
    if (tap.kind === "swat") {
      this.trySwat(i);
      return;
    }
    if (tap.kind === "left" || tap.kind === "right") return;
    switch (s.stage) {
      case "pick": {
        if (s.t < 0.15) return;
        const idx = tap.seat !== undefined ? 0 : panelCards(panel, s.choices.length).findIndex((r) => inRect(r, tap.x, tap.y));
        if (idx >= 0) this.choose(i, idx);
        break;
      }
      case "aim":
        if (s.t > 0.12) this.lockAim(i);
        break;
      case "power":
        if (s.t > 0.12) this.fire(i);
        break;
      default:
        // Not aiming: the panel doubles as the SWAT button.
        if (f.swatWindow > 0) this.trySwat(i);
    }
  }

  private trySwat(i: number): void {
    const f = this.world.fighters[i]!;
    if (f.swatWindow <= 0 || f.swats <= 0) return;
    const shot = this.world.swat(i);
    if (!shot) return;
    const p = this.ctx.players[i]!;
    this.callouts.show("SWAT!", p.color, { size: 64, life: 0.9, y: 0.25 });
    this.juice.hitStop(0.07);
    this.juice.shake(0.35);
    this.juice.burst(f.x, f.y, [p.color, "#F4F7FB", "#FFE14D"], { count: 26, speed: 380, size: 6, gravity: 200 });
    this.seats[i]!.flash = 0.5;
    this.ctx.sfx.streak(4);
  }

  private tryGust(i: number, dir: number): void {
    const s = this.seats[i]!;
    if (s.gustCd > 0) return;
    if (!this.world.gust(i, dir)) return;
    s.gustCd = GUST_COOLDOWN;
    s.flash = 0.35;
    const p = this.ctx.players[i]!;
    this.gustPuff = { dir, life: 0.8, color: p.color };
    this.ctx.sfx.whoosh();
    const panel = this.panels[i]!;
    this.juice.burst(panel.x + panel.w / 2, panel.y - 10, [p.color, "#F4F7FB"], { count: 14, speed: 420, size: 5, angle: dir > 0 ? 0 : Math.PI, spread: 0.5, gravity: -40 });
  }

  // ---------- update ----------

  update(dt: number): void {
    const realDt = dt;
    dt = this.juice.update(dt);
    this.callouts.update(realDt);
    this.clock += realDt;
    this.gustPuff.life = Math.max(0, this.gustPuff.life - realDt);
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 40 * realDt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i]!.life <= 0) this.floaters.splice(i, 1);
    for (const s of this.seats) {
      s.flash = Math.max(0, s.flash - realDt);
      s.gustCd = Math.max(0, s.gustCd - realDt);
      if (s.taunt) {
        s.taunt.life -= realDt;
        if (s.taunt.life <= 0) s.taunt = null;
      }
    }

    const taps = this.readTaps();
    const anyTap = taps.length > 0;

    // Physics always runs so knockback settles between volleys too.
    const before = this.world.fighters.map((f) => f.alive);
    const blasts = this.world.step(dt, this.round);
    for (const b of blasts) this.onBlast(b);
    this.drainEvents();
    this.world.fighters.forEach((f, i) => {
      if (before[i] && !f.alive) this.onKo(i);
    });

    switch (this.phase) {
      case "between":
        this.phaseT -= realDt;
        if (this.phaseT <= 0) this.startRound();
        break;
      case "chaos":
        this.phaseT += realDt;
        if (this.phaseT > 1.4 || (anyTap && this.phaseT > 0.3)) this.startVolley();
        break;
      case "volley":
        this.phaseT += realDt;
        for (const tap of taps) this.handleVolleyTap(tap);
        this.world.fighters.forEach((f, i) => this.stepSeat(i, f.alive, dt, realDt));
        if (this.volleyDone() || this.world.alive().length <= 1) {
          this.volleyT += realDt;
          if ((this.world.settled() && this.volleyT > 0.45) || this.volleyT > VOLLEY_MAX) {
            this.phase = "between";
            this.phaseT = 0.35;
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
        if (this.isHuman(who)) {
          const tap = taps.find((t) => t.seat === undefined || t.seat === who);
          if (tap && this.phaseT > 0.3) {
            const i = tap.seat !== undefined ? 0 : this.cardAt(tap, this.draftOptions.length);
            if (i >= 0) this.draft(i);
          } else if (this.phaseT > 8) this.draft(0);
        } else if (this.phaseT > 0.55) {
          this.draft(this.ctx.rng.int(0, this.draftOptions.length - 1));
        }
        break;
      }
      case "over":
        this.phaseT -= realDt;
        if (this.phaseT <= 0 || (anyTap && this.phaseT < 3)) this.done = true;
        break;
    }
  }

  /** Advance one seat's pick/aim/power machine (or its ghost/bot timers). */
  private stepSeat(i: number, alive: boolean, dt: number, realDt: number): void {
    const s = this.seats[i]!;
    const f = this.world.fighters[i]!;
    const human = this.isHuman(i);
    if (!alive) {
      s.stage = "idle";
      if (!human) {
        s.botGhostT -= realDt;
        if (s.botGhostT <= 0 && this.world.shots.length > 0) {
          this.tryGust(i, botGustDir(this.world.wind, this.ctx.rng.next()));
          s.taunt = { text: this.ctx.rng.pick(BOT_TAUNTS_GHOST), life: 1 };
          s.botGhostT = this.ctx.rng.float(1.1, 2.4);
        }
      }
      return;
    }
    // Bot swat: decide when the window opens, then react a beat later (sometimes too late).
    if (!human && s.botSwatAt >= 0) {
      s.botSwatAt -= dt;
      if (s.botSwatAt <= 0) {
        s.botSwatAt = -1;
        this.trySwat(i);
      }
    }
    s.t += dt;
    switch (s.stage) {
      case "pick":
        if (human) {
          if (s.t > PICK_TIMEOUT) this.choose(i, 0);
        } else if (s.t > s.botDelay) {
          let best = 0;
          s.choices.forEach((c, k) => {
            if (BOT_VALUE[c.id] + this.ctx.rng.float(0, 2.5) > BOT_VALUE[s.choices[best]!.id]) best = k;
          });
          this.choose(i, best);
        }
        break;
      case "aim": {
        s.aimT += dt;
        s.angle = Math.PI / 2 + (AIM_MAX - Math.PI / 2) * Math.sin(s.aimT * AIM_SPEED);
        const lock = human
          ? s.t > AIM_TIMEOUT
          : s.t > 0.25 && (Math.abs(s.angle - s.botTarget!.angle) < 0.05 || s.t > AIM_TIMEOUT);
        if (lock) this.lockAim(i);
        break;
      }
      case "power": {
        s.powerT += dt;
        s.power = 0.5 - 0.5 * Math.cos(s.powerT * POWER_SPEED);
        const fire = human
          ? s.t > POWER_TIMEOUT
          : s.t > 0.2 && (Math.abs(s.power - s.botTarget!.power) < 0.03 || s.t > POWER_TIMEOUT);
        if (fire) this.fire(i);
        break;
      }
      case "done":
        if (s.shotsLeft > 0 && s.t > 0.35 && f.alive) {
          if (this.world.alive().length > 1) this.startPick(i);
          else s.shotsLeft = 0;
        }
        break;
      default:
        break;
    }
  }

  private drainEvents(): void {
    for (const e of this.world.events.splice(0)) {
      switch (e.type) {
        case "crate": {
          const label = CRATE_LABEL[e.kind];
          this.floaters.push({ text: label.text, x: e.x, y: e.y - 20, life: 1.6, color: label.color });
          this.juice.burst(e.x, e.y, [label.color, "#F4F7FB"], { count: 20, speed: 240, size: 5 });
          this.ctx.sfx.collect();
          break;
        }
        case "teleport":
          this.juice.burst(e.x, e.y, ["#22d3ee", "#F4F7FB"], { count: 24, speed: 260, size: 5, gravity: 0 });
          this.ctx.sfx.go();
          break;
        case "fireproof":
          this.floaters.push({ text: "FIREPROOF!", x: e.x, y: e.y - 30, life: 1.4, color: "#FFB020" });
          this.juice.burst(e.x, e.y, ["#FF5A1F", "#FFB020"], { count: 24, speed: 300, size: 6, angle: -Math.PI / 2, spread: 1.4 });
          break;
        case "shielded": {
          const f = this.world.fighters[e.index]!;
          this.floaters.push({ text: "BLOCKED", x: f.x, y: f.y - 50, life: 1.1, color: "#3EE0FF" });
          break;
        }
        case "swatWindow": {
          const s = this.seats[e.index]!;
          if (this.isHuman(e.index)) {
            this.juice.slowMo(0.55, 0.35);
            this.ctx.sfx.tick();
            s.flash = 0.6;
          } else {
            const shot = this.world.swatTarget(e.index);
            const chance = botSwatChance(shot?.weapon.damage ?? 0, shot?.dmgMul ?? 1, this.world.fighters[e.index]!.swats);
            if (this.ctx.rng.next() < chance) s.botSwatAt = this.ctx.rng.float(0.08, 0.6);
          }
          break;
        }
        case "swat": {
          const p = this.ctx.players[e.index]!;
          const victim = e.owner >= 0 ? this.ctx.players[e.owner] : undefined;
          this.floaters.push({ text: victim ? `RETURN TO ${victim.name.toUpperCase()}` : "RETURNED!", x: e.x, y: e.y - 50, life: 1.3, color: p.color });
          break;
        }
        case "gust":
          break;
        case "haunt": {
          const p = this.ctx.players[e.index]!;
          this.floaters.push({ text: `HAUNTED BY ${p.name.toUpperCase()}`, x: e.x, y: e.y - 62, life: 1.4, color: p.color });
          this.ctx.sfx.streak(2);
          break;
        }
      }
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
    } else {
      this.ctx.sfx.hit();
      this.juice.shake(Math.min(1, b.radius / 110));
      const big = b.hits.some((h) => h.damage >= 40);
      if (b.radius > 90 || big) this.juice.hitStop(b.radius > 90 ? 0.08 : 0.05);
      this.juice.burst(b.x, b.y, ["#FFB020", "#FF5A1F", "#F4F7FB", b.weapon.color], { count: Math.round(b.radius / 2), speed: b.radius * 6, size: 6 });
      this.juice.burst(b.x, b.y, ["#5b3a22", "#3d6b2a"], { count: 12, speed: 320, size: 5 });
    }
    for (const hit of b.hits) {
      const f = this.world.fighters[hit.index]!;
      this.floaters.push({ text: `-${hit.damage}`, x: f.x, y: f.y - 34, life: 1.1, color: b.swatted ? "#FFE14D" : "#FF3D7A" });
    }
    const shooter = b.owner >= 0 && b.owner < this.seats.length ? b.owner : null;
    if (shooter === null) return;
    const s = this.seats[shooter]!;
    const p = this.ctx.players[shooter]!;
    const enemies = b.hits.filter((h) => h.index !== shooter);
    if (b.swatted && enemies.length > 0) this.callouts.show("RETURN TO SENDER!", "#FFE14D", { size: 56, life: 1.2 });
    else if (enemies.length >= 2) this.callouts.show("MULTI-HIT!", "#FFE14D", { size: 52 });
    else if (enemies.length > 0 && Math.hypot(b.x - s.fireFrom.x, b.y - s.fireFrom.y) > 650) this.callouts.show("SNIPE!", "#3EE0FF", { size: 52 });
    else if (enemies.some((h) => h.damage >= 45)) this.callouts.show("CRUSHED!", "#FF3D7A", { size: 52 });
    const bestEnemyHit = Math.max(0, ...enemies.map((h) => h.damage));
    if (bestEnemyHit > 0 && this.isHuman(shooter) && saveBest(kaboomIsle.id, bestEnemyHit, BEST_VERSION)) {
      this.callouts.show(`NEW RECORD ${bestEnemyHit} HIT`, p.color, { size: 50, life: 1.4, y: 0.42 });
      this.ctx.sfx.collect();
    }
    if (enemies.length === 0 && b.weapon.id !== "chicken") {
      // Near miss: an enemy just outside the blast.
      const near = this.world.alive().filter((f) => f.index !== shooter && Math.hypot(f.x - b.x, f.y - b.y) < b.radius + FIGHTER_R + 45);
      if (near.length > 0) this.floaters.push({ text: "SO CLOSE", x: b.x, y: b.y - 40, life: 1.1, color: "#F4F7FB" });
      if (!this.isHuman(shooter) && this.ctx.rng.next() < 0.5) s.taunt = { text: this.ctx.rng.pick(BOT_TAUNTS_MISS), life: 1.3 };
    } else if (!this.isHuman(shooter) && bestEnemyHit >= 25 && this.ctx.rng.next() < 0.6) {
      s.taunt = { text: this.ctx.rng.pick(BOT_TAUNTS_HIT), life: 1.3 };
    }
  }

  private onKo(index: number): void {
    const f = this.world.fighters[index]!;
    const p = this.ctx.players[index]!;
    this.callouts.show(f.hp > 0 ? `${p.name.toUpperCase()} GOT LAVA'D` : `${p.name.toUpperCase()} IS OUT`, p.color);
    this.juice.burst(f.x, Math.min(f.y, this.world.lava), [p.color, "#FF5A1F", "#FFB020"], { count: 40, speed: 420, size: 7 });
    this.juice.shake(0.5);
    this.juice.slowMo(0.5);
    this.ctx.sfx.streak(3);
    const s = this.seats[index]!;
    s.stage = "idle";
    s.botGhostT = this.ctx.rng.float(0.8, 1.6);
    if (this.world.alive().length > 1) this.floaters.push({ text: "GHOST: BLOW THE WIND", x: f.x, y: f.y - 60, life: 1.6, color: p.color });
  }

  /** Search angles/powers for a landing spot near an enemy, then fumble it a bit. */
  private planBot(i: number, weapon: Weapon): { angle: number; power: number } {
    const me = this.world.fighters[i]!;
    const enemies = this.world.alive().filter((f) => f.index !== me.index);
    let best = { angle: Math.PI / 2, power: 0.5, score: Infinity };
    for (let a = AIM_MIN + 0.05; a < AIM_MAX - 0.05; a += 0.07) {
      for (let p = 0.2; p <= 1; p += 0.06) {
        const land = this.world.predict(me.index, a, p);
        let score = Math.min(...enemies.map((e) => Math.hypot(e.x - land.x, e.y - land.y)));
        if (Math.hypot(me.x - land.x, me.y - land.y) < weapon.radius + 10) score += 400;
        if (score < best.score) best = { angle: a, power: p, score };
      }
    }
    const rng = this.ctx.rng;
    const wobble = this.ctx.players.length > 2 ? 0.08 : 0.07;
    return {
      angle: Math.min(AIM_MAX, Math.max(AIM_MIN, best.angle + rng.float(-wobble, wobble))),
      power: Math.min(1, Math.max(0.02, best.power + rng.float(-0.06, 0.06))),
    };
  }

  // ---------- render ----------

  render(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    const sky = g.createLinearGradient(0, 0, 0, h);
    const hot = Math.min(1, (this.heat - 1) / 1.2);
    sky.addColorStop(0, hot > 0.6 ? "#2a0f1e" : "#1a0f2e");
    sky.addColorStop(0.6, `rgb(${58 + hot * 60},${21},${48 - hot * 20})`);
    sky.addColorStop(1, "#6b1d1d");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    this.juice.begin(g);
    this.drawTerrain(g);
    this.drawLava(g);
    this.drawGhostPaths(g);
    this.drawCrates(g);
    this.drawVortices(g);
    this.drawAims(g);
    for (const f of this.world.fighters) this.drawFighter(g, f.index);
    this.drawShots(g);
    this.drawSwatRings(g);
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

    this.drawPanels(g);
    this.drawHud(g);
    if (this.phase === "draft") this.drawDraft(g);
    if (this.phase === "chaos") this.drawChaos(g);
    this.callouts.draw(g, w, h - PANEL_H);
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
    const glow = this.overdrive ? 0.35 + 0.15 * Math.sin(this.clock * 6) : 0;
    if (glow > 0) {
      g.fillStyle = `rgba(255,90,31,${glow * 0.35})`;
      g.fillRect(0, top - 40, w, 40);
    }
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
    const s = this.seats[index]!;
    const aiming = this.phase === "volley" && (s.stage === "aim" || s.stage === "power");
    g.save();
    g.translate(f.x, f.y);
    const squash = f.grounded ? 1 + Math.sin(this.clock * 6 + index) * 0.04 : 1;
    g.scale(1 / squash, squash);
    g.fillStyle = f.hurt > 0 && Math.floor(this.clock * 20) % 2 === 0 ? "#ffffff" : p.color;
    g.shadowColor = p.color;
    g.shadowBlur = aiming ? 20 : 8;
    g.beginPath();
    g.arc(0, 0, FIGHTER_R, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    const look = aiming ? s.angle : f.x < this.ctx.width / 2 ? 0.2 : Math.PI - 0.2;
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
    g.font = "700 12px Outfit, sans-serif";
    g.textAlign = "center";
    if (f.doubleDamage) {
      g.fillStyle = "#FF3D7A";
      g.fillText("2x", f.x + bw / 2 + 10, f.y - FIGHTER_R - 8);
    }
    if (f.underdog) {
      g.fillStyle = "#FFE14D";
      g.fillText("UNDERDOG", f.x, f.y + FIGHTER_R + 14);
    }
    g.font = "600 14px Outfit, sans-serif";
    g.fillStyle = "#F4F7FB";
    g.fillText(p.name, f.x, f.y - FIGHTER_R - 20);
    if (aiming) {
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

  private drawSwatRings(g: CanvasRenderingContext2D): void {
    for (const f of this.world.fighters) {
      if (!f.alive || f.swatWindow <= 0 || f.swats <= 0) continue;
      const p = this.ctx.players[f.index]!;
      const t = f.swatWindow / SWAT_WINDOW;
      g.save();
      g.strokeStyle = p.color;
      g.lineWidth = 4;
      g.globalAlpha = 0.5 + 0.5 * t;
      g.setLineDash([10, 8]);
      g.lineDashOffset = -this.clock * 60;
      g.beginPath();
      g.arc(f.x, f.y, SWAT_RANGE * (0.55 + 0.45 * t), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      if (this.isHuman(f.index)) {
        g.font = "700 30px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.lineWidth = 6;
        g.strokeStyle = "rgba(7,11,20,0.85)";
        g.strokeText("SWAT!", f.x, f.y - 62);
        g.fillStyle = "#FFE14D";
        g.fillText("SWAT!", f.x, f.y - 62);
      }
      g.restore();
    }
  }

  private drawGhostPaths(g: CanvasRenderingContext2D): void {
    if (this.phase !== "volley") return;
    for (const f of this.world.fighters) {
      const s = this.seats[f.index]!;
      if (!f.alive || (s.stage !== "aim" && s.stage !== "power")) continue;
      const path = this.world.ghosts[f.index];
      if (!path || path.length < 2) continue;
      g.save();
      g.setLineDash([6, 8]);
      g.strokeStyle = "rgba(244,247,251,0.3)";
      g.lineWidth = 2;
      g.beginPath();
      path.forEach((pt, i) => (i === 0 ? g.moveTo(pt.x, pt.y) : g.lineTo(pt.x, pt.y)));
      g.stroke();
      g.restore();
    }
  }

  private drawCrates(g: CanvasRenderingContext2D): void {
    for (const c of this.world.crates) {
      const label = CRATE_LABEL[c.kind];
      if (!c.landed) {
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

  private drawAims(g: CanvasRenderingContext2D): void {
    if (this.phase !== "volley") return;
    for (const f of this.world.fighters) {
      const s = this.seats[f.index]!;
      if (!f.alive || (s.stage !== "aim" && s.stage !== "power")) continue;
      const p = this.ctx.players[f.index]!;
      const len = s.stage === "power" ? 40 + s.power * 90 : 90;
      const ex = f.x + Math.cos(s.angle) * len;
      const ey = f.y - Math.sin(s.angle) * len;
      g.strokeStyle = "rgba(244,247,251,0.15)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(f.x, f.y, 90, -AIM_MAX, -AIM_MIN);
      g.stroke();
      g.strokeStyle = s.stage === "power" ? powerColor(s.power) : p.color;
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
      if (s.stage === "power") {
        const bx = f.x + (f.x < this.ctx.width - 80 ? 34 : -46);
        const by = f.y - 60;
        g.fillStyle = "rgba(7,11,20,0.75)";
        g.fillRect(bx, by, 12, 70);
        g.fillStyle = powerColor(s.power);
        g.fillRect(bx, by + 70 * (1 - s.power), 12, 70 * s.power);
      }
    }
  }

  private drawShots(g: CanvasRenderingContext2D): void {
    for (const s of this.world.shots) {
      g.strokeStyle = s.swatted ? "rgba(255,225,77,0.5)" : "rgba(244,247,251,0.25)";
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
        if (s.drilling > 0 && this.ctx.rng.next() < 0.5) this.juice.burst(s.x, s.y, ["#8b5a2b", "#5b3a22"], { count: 2, speed: 160, size: 4 });
        continue;
      }
      g.fillStyle = s.weapon.id === "bomb" ? "#1f2937" : s.weapon.color;
      g.beginPath();
      g.arc(s.x, s.y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = s.swatted ? "#FFE14D" : s.weapon.color;
      g.lineWidth = s.swatted ? 3 : 2;
      g.stroke();
      if (s.gusted !== undefined) {
        g.strokeStyle = this.ctx.players[s.gusted]?.color ?? "#fff";
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
        g.stroke();
      }
      if (s.fuse !== undefined) {
        g.fillStyle = "#F4F7FB";
        g.font = "700 14px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillText(Math.max(0, s.fuse - s.age).toFixed(1), s.x, s.y - 12);
      }
    }
  }

  // ---------- seat panels ----------

  private drawPanels(g: CanvasRenderingContext2D): void {
    g.save();
    g.textBaseline = "middle";
    this.panels.forEach((panel, i) => {
      const p = this.ctx.players[i]!;
      const f = this.world.fighters[i]!;
      const s = this.seats[i]!;
      const human = this.isHuman(i);
      const needsTap = human && this.phase === "volley" && f.alive && (s.stage === "pick" || s.stage === "aim" || s.stage === "power");
      g.fillStyle = f.alive ? "rgba(7,11,20,0.88)" : "rgba(20,16,36,0.88)";
      g.fillRect(panel.x, panel.y, panel.w, panel.h);
      if (s.flash > 0) {
        g.globalAlpha = s.flash;
        g.fillStyle = p.color;
        g.fillRect(panel.x, panel.y, panel.w, panel.h);
        g.globalAlpha = 1;
      }
      const pulse = needsTap ? 0.6 + 0.4 * Math.sin(this.clock * 7) : 0.35;
      g.strokeStyle = p.color;
      g.globalAlpha = f.alive ? pulse : 0.4;
      g.lineWidth = needsTap ? 4 : 2;
      g.strokeRect(panel.x + 2, panel.y + 2, panel.w - 4, panel.h - 4);
      g.globalAlpha = 1;

      // Header row: name, HP, swat charge, wins.
      g.textAlign = "left";
      g.font = "700 18px Bebas Neue, Impact, sans-serif";
      g.fillStyle = p.color;
      g.fillText(f.alive ? p.name.toUpperCase() : `${p.name.toUpperCase()} (GHOST)`, panel.x + 10, panel.y + 16);
      let x = panel.x + 10 + g.measureText(f.alive ? p.name.toUpperCase() : `${p.name.toUpperCase()} (GHOST)`).width + 10;
      if (f.alive) {
        g.fillStyle = f.hp > 50 ? "#B8FF3D" : f.hp > 25 ? "#FFB020" : "#FF3D7A";
        g.font = "700 16px Outfit, sans-serif";
        g.fillText(`${Math.max(0, Math.round(f.hp))} HP`, x, panel.y + 16);
        x += g.measureText(`${Math.max(0, Math.round(f.hp))} HP`).width + 10;
        g.fillStyle = f.swats > 0 ? "#FFE14D" : "rgba(244,247,251,0.3)";
        g.font = "700 13px Outfit, sans-serif";
        g.fillText(f.swats > 0 ? "SWAT ●" : "SWAT ○", x, panel.y + 16);
      }
      g.textAlign = "right";
      for (let k = 0; k < WINS_NEEDED; k++) {
        g.beginPath();
        g.arc(panel.x + panel.w - 14 - k * 16, panel.y + 16, 5, 0, Math.PI * 2);
        g.fillStyle = p.color;
        if (k < this.wins[i]!) g.fill();
        else {
          g.strokeStyle = p.color;
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      if (s.taunt) {
        g.fillStyle = "#F4F7FB";
        g.font = "italic 600 14px Outfit, sans-serif";
        g.textAlign = "right";
        g.globalAlpha = Math.min(1, s.taunt.life * 2);
        g.fillText(`"${s.taunt.text}"`, panel.x + panel.w - 14 - WINS_NEEDED * 16 - 6, panel.y + 16);
        g.globalAlpha = 1;
      }

      // Body
      const cx = panel.x + panel.w / 2;
      const cy = panel.y + 30 + (panel.h - 36) / 2;
      g.textAlign = "center";
      if (!f.alive) {
        this.drawGhostPanel(g, panel, i);
      } else if (this.phase === "volley" && s.stage === "pick") {
        this.drawPanelCards(g, panel, s);
      } else if (this.phase === "volley" && (s.stage === "aim" || s.stage === "power")) {
        g.fillStyle = s.weapon.color;
        g.font = "700 22px Bebas Neue, Impact, sans-serif";
        g.fillText(s.weapon.name, cx, panel.y + 42, panel.w - 16);
        if (human) {
          g.globalAlpha = 0.7 + 0.3 * Math.sin(this.clock * 9);
          g.fillStyle = "#F4F7FB";
          g.font = "700 30px Bebas Neue, Impact, sans-serif";
          g.fillText(s.stage === "aim" ? "TAP: LOCK AIM" : "TAP: FIRE!", cx, panel.y + 74, panel.w - 16);
          g.globalAlpha = 1;
        } else {
          g.fillStyle = "#94a3b8";
          g.font = "600 15px Outfit, sans-serif";
          g.fillText(s.stage === "aim" ? "aiming..." : "charging...", cx, panel.y + 74);
        }
        if (s.stage === "power") {
          g.fillStyle = "rgba(244,247,251,0.15)";
          g.fillRect(panel.x + 10, panel.y + panel.h - 10, panel.w - 20, 5);
          g.fillStyle = powerColor(s.power);
          g.fillRect(panel.x + 10, panel.y + panel.h - 10, (panel.w - 20) * s.power, 5);
        }
      } else if (this.phase === "volley" && s.stage === "done") {
        g.fillStyle = s.weapon.color;
        g.font = "700 22px Bebas Neue, Impact, sans-serif";
        g.fillText(`${s.weapon.name} AWAY`, cx, panel.y + 42, panel.w - 16);
        g.fillStyle = f.swatWindow > 0 && f.swats > 0 ? "#FFE14D" : "#94a3b8";
        g.font = f.swatWindow > 0 && f.swats > 0 ? "700 28px Bebas Neue, Impact, sans-serif" : "600 15px Outfit, sans-serif";
        g.fillText(f.swatWindow > 0 && f.swats > 0 ? "TAP: SWAT!" : s.shotsLeft > 0 ? "one more shot..." : human ? "tap your blob to SWAT a bomb" : "watching", cx, panel.y + 74, panel.w - 16);
      } else {
        g.fillStyle = "#94a3b8";
        g.font = "600 15px Outfit, sans-serif";
        const perks = this.perks[i]!.map((id) => PERKS.find((k) => k.id === id)!.name).join(" · ");
        g.fillText(perks || (this.phase === "between" || this.phase === "chaos" ? "get ready" : ""), cx, cy, panel.w - 16);
      }
    });
    g.restore();
    g.textBaseline = "alphabetic";
  }

  private drawPanelCards(g: CanvasRenderingContext2D, panel: Rect, s: Seat): void {
    const rects = panelCards(panel, s.choices.length);
    const pop = Math.min(1, s.t * 6);
    rects.forEach((r, k) => {
      const c = s.choices[k]!;
      g.save();
      g.translate(r.x + r.w / 2, r.y + r.h / 2);
      g.scale(pop, pop);
      g.fillStyle = "#0f1626";
      g.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      g.strokeStyle = c.color;
      g.lineWidth = 3;
      g.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
      g.fillStyle = c.color;
      g.font = `700 ${r.w < 110 ? 18 : 24}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.fillText(c.name, 0, -r.h / 2 + 18, r.w - 8);
      g.fillStyle = "#cbd5e1";
      g.font = `500 ${r.w < 110 ? 11 : 13}px Outfit, sans-serif`;
      wrap(g, c.blurb, 0, 8, r.w - 10, r.w < 110 ? 12 : 15);
      if (c.weight <= 6) {
        g.fillStyle = c.color;
        g.font = "700 11px Outfit, sans-serif";
        g.fillText("RARE", 0, r.h / 2 - 9);
      }
      g.restore();
    });
  }

  private drawGhostPanel(g: CanvasRenderingContext2D, panel: Rect, i: number): void {
    const p = this.ctx.players[i]!;
    const s = this.seats[i]!;
    const human = this.isHuman(i);
    const cy = panel.y + 30 + (panel.h - 36) / 2;
    const ready = s.gustCd <= 0;
    if (this.phase !== "volley" || this.world.alive().length <= 1) {
      g.fillStyle = "#94a3b8";
      g.font = "600 15px Outfit, sans-serif";
      g.fillText(this.totals[i]!.haunts + this.world.fighters[i]!.haunts > 0 ? `haunts: ${this.totals[i]!.haunts + this.world.fighters[i]!.haunts}` : "ghost", panel.x + panel.w / 2, cy);
      return;
    }
    for (const dir of [-1, 1]) {
      const x = panel.x + (dir < 0 ? panel.w * 0.25 : panel.w * 0.75);
      g.globalAlpha = ready ? 0.9 : 0.35;
      g.fillStyle = p.color;
      g.font = "700 34px Bebas Neue, Impact, sans-serif";
      g.fillText(dir < 0 ? "◀ BLOW" : "BLOW ▶", x, cy - 6, panel.w / 2 - 10);
      g.globalAlpha = 1;
    }
    g.fillStyle = "#94a3b8";
    g.font = "600 12px Outfit, sans-serif";
    g.fillText(human ? "ghost: tap to gust the wind" : "ghost bot", panel.x + panel.w / 2, panel.y + panel.h - 14);
    if (!ready) {
      g.fillStyle = p.color;
      g.fillRect(panel.x + 10, panel.y + panel.h - 7, (panel.w - 20) * (1 - s.gustCd / GUST_COOLDOWN), 3);
    }
  }

  // ---------- overlays ----------

  private cardRects(count: number): Rect[] {
    const { width: w, height: h } = this.ctx;
    const cw = count > 3 ? 210 : 240;
    const ch = 150;
    const gap = 18;
    const total = count * cw + (count - 1) * gap;
    return Array.from({ length: count }, (_, i) => ({ x: w / 2 - total / 2 + i * (cw + gap), y: (h - PANEL_H) * 0.36, w: cw, h: ch }));
  }

  private cardAt(pt: { x: number; y: number }, count: number): number {
    return this.cardRects(count).findIndex((r) => inRect(r, pt.x, pt.y));
  }

  private drawDraft(g: CanvasRenderingContext2D): void {
    const who = this.draftQueue[0];
    if (who === undefined) return;
    const p = this.ctx.players[who]!;
    const { width: w, height: h } = this.ctx;
    const cards = this.draftOptions.map((k) => ({ name: k.name, blurb: k.blurb, color: k.color, tag: this.perks[who]!.includes(k.id) ? "STACKS" : "" }));
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(0, 0, w, h - PANEL_H);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 46px Bebas Neue, Impact, sans-serif";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.9)";
    const title = `${p.name.toUpperCase()}: PICK A PERK`;
    g.strokeText(title, w / 2, (h - PANEL_H) * 0.25);
    g.fillStyle = p.color;
    g.fillText(title, w / 2, (h - PANEL_H) * 0.25);
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

  private drawChaos(g: CanvasRenderingContext2D): void {
    if (!this.chaos) return;
    const { width: w, height: h } = this.ctx;
    const t = Math.min(1, this.phaseT * 4);
    g.save();
    g.translate(w / 2, (h - PANEL_H) * 0.45);
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
    const { width: w } = this.ctx;
    g.textBaseline = "middle";
    // Wind + gust puff
    const wind = this.world.wind;
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(w - 220, 14, 200, 40);
    g.fillStyle = "#F4F7FB";
    g.font = "600 16px Outfit, sans-serif";
    g.textAlign = "left";
    g.fillText("WIND", w - 210, 34);
    const cx = w - 100;
    g.fillStyle = Math.abs(wind) > 1 ? "#FF3D7A" : "#3EE0FF";
    const len = Math.min(1.6, Math.abs(wind)) * 50;
    g.fillRect(wind < 0 ? cx - len : cx, 30, len, 8);
    g.fillStyle = "#F4F7FB";
    g.fillRect(cx - 1, 24, 2, 20);
    if (this.gustPuff.life > 0) {
      g.globalAlpha = this.gustPuff.life;
      g.fillStyle = this.gustPuff.color;
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.fillText(this.gustPuff.dir < 0 ? "◀ GUST" : "GUST ▶", cx, 34 - (0.8 - this.gustPuff.life) * 20);
      g.globalAlpha = 1;
    }
    if (this.chaos) {
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.fillRect(w - 220, 60, 200, 30);
      g.fillStyle = this.chaos.color;
      g.font = "700 18px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.fillText(this.chaos.name, w - 120, 76);
    }
    // Island / round / heat
    g.textAlign = "left";
    g.font = "700 30px Bebas Neue, Impact, sans-serif";
    g.fillStyle = "#F4F7FB";
    g.fillText(`ISLAND ${this.island}`, 24, 34);
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.fillStyle = this.overdrive ? "#FF5A1F" : "#cbd5e1";
    g.fillText(this.round > 0 ? `ROUND ${this.round}${this.overdrive ? " · OVERDRIVE" : this.round >= LAVA_ROUND ? " · LAVA RISING" : ""}` : "", 24, 62);
    // Heat meter
    const hx = 24;
    const hy = 82;
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(hx, hy, 150, 14);
    const hot = Math.min(1, (this.heat - 1) / 1.2);
    g.fillStyle = hot > 0.6 ? "#FF5A1F" : hot > 0.3 ? "#FFB020" : "#B8FF3D";
    g.fillRect(hx, hy, 150 * Math.max(0.04, hot), 14);
    g.fillStyle = "#F4F7FB";
    g.font = "700 13px Outfit, sans-serif";
    g.fillText(`HEAT x${this.heat.toFixed(1)}`, hx + 156, hy + 7);
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
      if (t.returns > 0) stats.push({ playerId: player.id, label: "Swats landed", value: String(t.returns) });
      if (t.haunts > 0) stats.push({ playerId: player.id, label: "Haunts", value: String(t.haunts) });
      if (this.perks[i]!.length > 0) {
        stats.push({ playerId: player.id, label: "Perks", value: this.perks[i]!.map((id) => PERKS.find((k) => k.id === id)!.name).join(", ") });
      }
    });
    return stats;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
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
  tagline: "Everybody fires at once. Ghosts blow the wind. One SWAT each.",
  description:
    "Tap-timed artillery on crumbling islands over lava, but every survivor shoots in the same volley from their own panel: pick one of three random weapons, tap to stop the swinging aim needle, tap again to stop the power meter. The island heats up every round (damage x1.2, x1.4...) until OVERDRIVE and rising lava. Get knocked out and you come back as a ghost who blows the wind around mid-flight. Once per island you can SWAT: when a bomb gets close, time slows and a tap bats it back at its owner at 1.5x. Chaos cards every round, perk drafts between islands (losers first), underdog bonus for whoever is lowest. First to two islands.",
  durationMs: 0,
  controls: "Your bottom panel: tap a card · tap to lock aim · tap to fire · tap your blob to SWAT · ghosts tap ◀ ▶ to gust",
  create: (ctx) => new KaboomIsle(ctx),
};
