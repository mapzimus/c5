import { fillArena, drawTimerBar } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  BOMB_UP_TIME,
  COMBO_TO_FEVER,
  DURATION,
  FEVER_SPAWN_SCALE,
  FEVER_TIME,
  GOLDEN_UP_TIME,
  MAX_STAGE,
  OVERDRIVE_AT,
  OVERDRIVE_SPAWN_SCALE,
  RAIDER_UP_TIME,
  TELL_TIME,
  THIEF_UP_TIME,
  type BotBrain,
  type MoleKind,
  bombLoss,
  botWantsBonk,
  duckTime,
  feverMultiplier,
  hitValue,
  makeBrain,
  raidChance,
  raidTarget,
  rollKind,
  spawnInterval,
  stageAt,
  stageValue,
  stealAmount,
  whiffCombo,
} from "./logic";

export { COMBO_TO_FEVER, FEVER_TIME } from "./logic";

export const whack: GameDefinition = {
  id: "whack",
  name: "Bonk",
  tagline: "Wait for the fat one. Or don't.",
  description:
    "Critters pop out of holes in your zone and FATTEN the longer you leave them: 1, 2, 3, then 5. " +
    "They duck without warning (watch for the wobble), so every critter is a bet: bonk now or wait for the fat one. " +
    "Six hits in a row starts FEVER (double points). Bombs cost 5 and wipe your combo. " +
    "Fall behind and purple RAIDERS show up: bonk one to send a thief into the leader's zone. " +
    "They must bonk it in time or lose 5 points to you. The last 12 seconds are OVERDRIVE: everything is fatter.",
  durationMs: DURATION * 1000,
  controls: "Tap critters in your zone. Avoid bombs. Bonk thieves fast.",
  create: (ctx) => new WhackGame(ctx),
};

const HOLE_RADIUS = 38;
const BEST_KEY = "v2-fatten";
const TAUNTS = ["FAT ONE!", "TOO EASY", "MINE", "CHUNKY", "BONK!"];

interface Mole {
  x: number;
  y: number;
  kind: MoleKind;
  /** Seconds until it ducks. */
  life: number;
  maxLife: number;
  /** Seconds it has been up. */
  upFor: number;
  /** Fatten stage for normal critters. */
  stage: number;
  whacked: boolean;
  whackFlash: number;
  whackedBy: string | null;
  points: number;
  /** Seat index that sent this thief. */
  from: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

interface Seat {
  index: number;
  player: Player;
  zoneX: number;
  zoneY: number;
  zoneW: number;
  zoneH: number;
  holes: { x: number; y: number }[];
  moles: Mole[];
  spawnTimer: number;
  score: number;
  streak: number;
  bestStreak: number;
  hits: number;
  fatHits: number;
  goldenHits: number;
  bombHits: number;
  misses: number;
  combo: number;
  fever: number;
  fevers: number;
  feverFlash: number;
  stolen: number;
  robbed: number;
  raidsSent: number;
  pendingThieves: number[];
  brain: BotBrain;
  botPause: number;
  best: number;
  recordShown: boolean;
  hurtFlash: number;
}

class WhackGame implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private floaters: Floater[] = [];
  private time = 0;
  private elapsed = 0;
  private overdrive = false;
  private tauntCooldown = 2;
  private saved = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());

    const n = ctx.players.length;
    const cols = n <= 2 ? n : 2;
    const rows = n <= 2 ? 1 : 2;
    const zW = ctx.width / cols;
    const zH = ctx.height / rows;

    this.seats = ctx.players.map((player, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const zx = col * zW;
      const zy = row * zH;

      const holesPerRow = 3;
      const holesRows = 3;
      const holes: { x: number; y: number }[] = [];
      const padTop = 92;
      const availH = zH - padTop - 16;
      const availW = zW - 40;
      for (let r = 0; r < holesRows; r++) {
        for (let c = 0; c < holesPerRow; c++) {
          holes.push({
            x: zx + 20 + (c + 0.5) * (availW / holesPerRow),
            y: zy + padTop + (r + 0.5) * (availH / holesRows),
          });
        }
      }

      return {
        index: i,
        player,
        zoneX: zx,
        zoneY: zy,
        zoneW: zW,
        zoneH: zH,
        holes,
        moles: [],
        spawnTimer: ctx.rng.float(0.3, 0.8),
        score: 0,
        streak: 0,
        bestStreak: 0,
        hits: 0,
        fatHits: 0,
        goldenHits: 0,
        bombHits: 0,
        misses: 0,
        combo: 0,
        fever: 0,
        fevers: 0,
        feverFlash: 0,
        stolen: 0,
        robbed: 0,
        raidsSent: 0,
        pendingThieves: [],
        brain: makeBrain(() => ctx.rng.next()),
        botPause: 0,
        best: player.kind === "human" ? loadBest(whack.id, BEST_KEY) : 0,
        recordShown: false,
        hurtFlash: 0,
      };
    });

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private get remaining(): number {
    return Math.max(0, DURATION - this.elapsed);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    this.elapsed += realDt;
    this.tauntCooldown = Math.max(0, this.tauntCooldown - realDt);

    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 18 * realDt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    if (!this.overdrive && this.remaining <= OVERDRIVE_AT) this.startOverdrive();

    const progress = Math.min(1, this.elapsed / DURATION);
    const interval = spawnInterval(progress);
    const scores = this.seats.map((s) => s.score);

    for (const seat of this.seats) {
      for (const mole of seat.moles) {
        if (mole.whacked) {
          mole.whackFlash -= dt;
          continue;
        }
        mole.life -= dt;
        mole.upFor += dt;
        if (mole.kind === "normal") mole.stage = stageAt(mole.upFor, this.overdrive);
        if (mole.life <= 0) this.escape(seat, mole);
      }
      seat.moles = seat.moles.filter((m) => !m.whacked || m.whackFlash > 0);

      if (seat.fever > 0) seat.fever = Math.max(0, seat.fever - dt);
      if (seat.feverFlash > 0) seat.feverFlash = Math.max(0, seat.feverFlash - dt);
      if (seat.hurtFlash > 0) seat.hurtFlash = Math.max(0, seat.hurtFlash - dt);

      // Thieves land as soon as a hole is free in the victim's zone.
      while (seat.pendingThieves.length > 0) {
        const from = seat.pendingThieves[0];
        if (from === undefined || !this.spawnThief(seat, from)) break;
        seat.pendingThieves.shift();
      }

      seat.spawnTimer -= dt;
      if (seat.spawnTimer <= 0) {
        let scale = seat.fever > 0 ? FEVER_SPAWN_SCALE : 1;
        if (this.overdrive) scale *= OVERDRIVE_SPAWN_SCALE;
        seat.spawnTimer = (interval + this.ctx.rng.float(-0.15, 0.15)) * scale;
        this.spawnMole(seat, progress, raidChance(seat.index, scores));
      }

      if (seat.player.kind === "bot") this.botTick(seat, dt);
    }
  }

  private startOverdrive(): void {
    this.overdrive = true;
    this.callouts.show("OVERDRIVE!", "#FF6B35", { size: 72, life: 1.3, y: 0.42 });
    this.callouts.show("everything is fatter", "#FFD700", { size: 30, life: 1.3, y: 0.52 });
    this.ctx.sfx.go();
    this.juice.shake(0.4);
    this.juice.hitStop(0.05);
  }

  private freeHole(seat: Seat): { x: number; y: number } | null {
    const occupied = new Set(
      seat.moles.filter((m) => !m.whacked).map((m) => `${m.x},${m.y}`),
    );
    const free = seat.holes.filter((h) => !occupied.has(`${h.x},${h.y}`));
    if (free.length === 0) return null;
    return this.ctx.rng.pick(free);
  }

  private makeMole(hole: { x: number; y: number }, kind: MoleKind, life: number, from = -1): Mole {
    return {
      x: hole.x,
      y: hole.y,
      kind,
      life,
      maxLife: life,
      upFor: 0,
      stage: 0,
      whacked: false,
      whackFlash: 0,
      whackedBy: null,
      points: 0,
      from,
    };
  }

  private spawnMole(seat: Seat, progress: number, raid: number): void {
    const hole = this.freeHole(seat);
    if (!hole) return;
    const kind = rollKind(this.ctx.rng.next(), { fever: seat.fever > 0, raid });
    let life: number;
    switch (kind) {
      case "bomb":
        life = BOMB_UP_TIME;
        break;
      case "golden":
        life = GOLDEN_UP_TIME;
        break;
      case "raider":
        life = RAIDER_UP_TIME;
        break;
      default:
        life = duckTime(this.ctx.rng.next(), progress);
    }
    seat.moles.push(this.makeMole(hole, kind, life));
  }

  private spawnThief(victim: Seat, from: number): boolean {
    const hole = this.freeHole(victim);
    if (!hole) return false;
    victim.moles.push(this.makeMole(hole, "thief", THIEF_UP_TIME, from));
    this.ctx.sfx.whoosh();
    this.juice.burst(hole.x, hole.y, ["#B266FF", "#7A3DFF"], {
      count: 14,
      speed: 160,
      gravity: 200,
      life: 0.4,
    });
    return true;
  }

  private escape(seat: Seat, mole: Mole): void {
    mole.whacked = true;
    mole.whackFlash = 0;
    switch (mole.kind) {
      case "bomb":
        return;
      case "thief":
        this.steal(seat, mole);
        return;
      case "normal":
        if (mole.stage >= MAX_STAGE) {
          mole.whackFlash = 0.5;
          mole.points = 0;
          this.float(mole.x, mole.y - HOLE_RADIUS - 12, "SO CLOSE", "#FF6B35", 26, 0.7);
          this.ctx.sfx.miss();
        }
        break;
      default:
        break;
    }
    seat.streak = 0;
    seat.combo = 0;
    seat.misses++;
  }

  private steal(victim: Seat, mole: Mole): void {
    const sender = this.seats[mole.from];
    const amount = stealAmount(victim.score);
    if (!sender || sender === victim || amount <= 0) return;
    victim.score -= amount;
    victim.robbed += amount;
    sender.score += amount;
    sender.stolen += amount;
    victim.hurtFlash = 0.5;
    mole.whackFlash = 0.5;
    mole.points = -amount;
    this.callouts.show(`${sender.player.name} RAIDS ${victim.player.name} +${amount}`, "#B266FF", {
      size: 46,
      life: 1.1,
      y: 0.48,
    });
    this.float(sender.zoneX + sender.zoneW / 2, sender.zoneY + 92, `+${amount}`, "#B266FF", 30, 0.9);
    this.ctx.sfx.hit();
    this.juice.shake(0.4);
    this.juice.burst(mole.x, mole.y, ["#B266FF", victim.player.color, "#ffffff"], {
      count: 30,
      speed: 300,
      gravity: 300,
      life: 0.6,
    });
    this.checkRecord(sender);
  }

  private botTick(seat: Seat, dt: number): void {
    if (seat.botPause > 0) {
      seat.botPause -= dt;
      return;
    }
    // Attention lapses: every few seconds a bot just stares for a moment, like anyone would.
    if (this.ctx.rng.next() < 0.4 * dt) {
      seat.botPause = this.ctx.rng.float(0.35, 0.9);
      return;
    }
    // Thieves first: bots know a steal when they see one.
    const order = [...seat.moles].sort((a, b) => (a.kind === "thief" ? -1 : 0) - (b.kind === "thief" ? -1 : 0));
    for (const m of order) {
      if (m.whacked) continue;
      const view = { kind: m.kind, stage: m.stage, upFor: m.upFor, lifeLeft: m.life };
      if (botWantsBonk(seat.brain, view, dt, this.ctx.rng.next())) {
        this.whackMole(seat, m);
        seat.botPause = this.ctx.rng.float(0.2, 0.6);
        return;
      }
    }
  }

  private startFever(seat: Seat, mole: Mole): void {
    seat.fever = FEVER_TIME;
    seat.feverFlash = 0.5;
    seat.fevers++;
    seat.combo = 0;
    this.callouts.show(`${seat.player.name} FEVER!`, seat.player.color, {
      size: 64,
      life: 1.1,
      y: 0.45,
    });
    this.ctx.sfx.streak(4);
    this.juice.shake(0.35);
    this.juice.hitStop(0.06);
    this.juice.burst(mole.x, mole.y, ["#FFD700", "#FF3D7A", "#3EE0FF", seat.player.color], {
      count: 50,
      speed: 420,
      gravity: 200,
      life: 0.8,
    });
  }

  private float(x: number, y: number, text: string, color: string, size = 26, life = 0.7): void {
    this.floaters.push({ x, y, text, color, life, maxLife: life, size });
  }

  private checkRecord(seat: Seat): void {
    if (seat.player.kind !== "human" || seat.recordShown || seat.best <= 0) return;
    if (seat.score > seat.best) {
      seat.recordShown = true;
      this.callouts.show(`${seat.player.name} NEW RECORD`, "#FFD700", { size: 54, life: 1.2, y: 0.38 });
      this.ctx.sfx.win();
      this.juice.shake(0.2);
    }
  }

  private taunt(seat: Seat): void {
    if (seat.player.kind !== "bot" || this.tauntCooldown > 0) return;
    if (this.ctx.rng.next() > 0.3) return;
    this.tauntCooldown = 4;
    const line = this.ctx.rng.pick(TAUNTS);
    this.float(seat.zoneX + seat.zoneW / 2, seat.zoneY + 116, `${seat.player.name}: ${line}`, seat.player.color, 22, 0.9);
  }

  private whackMole(seat: Seat, mole: Mole): void {
    mole.whacked = true;
    mole.whackFlash = 0.35;
    mole.whackedBy = seat.player.id;

    if (mole.kind === "bomb") {
      const lost = bombLoss(seat.score);
      seat.score -= lost;
      mole.points = -lost;
      seat.bombHits++;
      seat.streak = 0;
      seat.combo = 0;
      seat.fever = 0;
      seat.hurtFlash = 0.4;
      this.ctx.sfx.miss();
      this.juice.shake(0.45);
      this.juice.hitStop(0.04);
      this.juice.burst(mole.x, mole.y, ["#FF3D7A", "#FF4136", "#FF6B35"], {
        count: 24,
        speed: 300,
        gravity: 400,
        life: 0.5,
      });
      return;
    }

    if (mole.kind === "thief") {
      // Blocked: no points either way, combo untouched.
      mole.points = 0;
      this.float(mole.x, mole.y - HOLE_RADIUS - 12, "BLOCKED", "#3EE0FF", 24, 0.6);
      this.ctx.sfx.hit();
      this.juice.shake(0.15);
      this.juice.burst(mole.x, mole.y, ["#B266FF", "#3EE0FF"], { count: 14, speed: 220, gravity: 300, life: 0.4 });
      return;
    }

    const { points: base, clutch } = hitValue(mole.kind, mole.stage, mole.life, this.overdrive);
    const points = base * feverMultiplier(seat.fever);
    mole.points = points;
    seat.score += points;
    seat.streak++;
    seat.bestStreak = Math.max(seat.bestStreak, seat.streak);
    seat.hits++;

    const fat = mole.kind === "normal" && mole.stage >= MAX_STAGE;
    if (fat) seat.fatHits++;
    if (clutch) this.float(mole.x, mole.y - HOLE_RADIUS - 34, "CLUTCH!", "#3EE0FF", 22, 0.7);
    if (mole.kind === "golden") {
      seat.goldenHits++;
      this.juice.shake(0.25);
      this.callouts.show(`GOLD +${points}`, "#FFD700", { size: 44, life: 0.7, y: 0.55 });
    }
    if (mole.kind === "raider") this.launchRaid(seat, mole);

    // The meter only fills outside FEVER, so FEVER can't chain forever.
    if (seat.fever <= 0) seat.combo++;
    if (seat.fever <= 0 && seat.combo >= COMBO_TO_FEVER) {
      this.startFever(seat, mole);
    } else if (mole.kind === "golden" || fat) {
      this.ctx.sfx.streak(fat ? 3 + mole.stage : 3);
      if (fat) {
        this.juice.shake(0.2);
        this.juice.hitStop(0.03);
      }
    } else {
      this.ctx.sfx.streak(Math.min(3, 1 + mole.stage));
    }

    const color =
      mole.kind === "golden" || fat
        ? ["#FFD700", "#FFA500", seat.player.color]
        : mole.kind === "raider"
          ? ["#B266FF", "#ffffff"]
          : [seat.player.color, "#ffffff"];
    this.juice.burst(mole.x, mole.y, color, {
      count: mole.kind === "golden" ? 20 : 8 + mole.stage * 5,
      speed: 180 + mole.stage * 40,
      gravity: 300,
      life: 0.4,
    });
    if (fat) this.taunt(seat);
    this.checkRecord(seat);
  }

  private launchRaid(seat: Seat, mole: Mole): void {
    const target = raidTarget(seat.index, this.seats.map((s) => s.score));
    const victim = target === null ? undefined : this.seats[target];
    if (!victim) return;
    seat.raidsSent++;
    victim.pendingThieves.push(seat.index);
    this.float(mole.x, mole.y - HOLE_RADIUS - 12, `RAID ${victim.player.name}`, "#B266FF", 24, 0.8);
    this.ctx.sfx.whoosh();
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  /** Each pointer (finger) is one tap; taps are stateless so no per-pointerId tracking is needed. */
  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    this.tap(p.x, p.y, e);
  };

  private tap(x: number, y: number, e?: PointerEvent): void {
    const hitR = Math.max(HOLE_RADIUS * 1.5, this.ctx.minTap);
    for (const seat of this.seats) {
      if (seat.player.kind !== "human") continue;
      if (x < seat.zoneX || x > seat.zoneX + seat.zoneW || y < seat.zoneY || y > seat.zoneY + seat.zoneH) continue;

      let best: Mole | null = null;
      let bestDist = hitR;
      let nearJustWhacked = false;
      for (const mole of seat.moles) {
        const d = Math.hypot(x - mole.x, y - mole.y);
        if (mole.whacked) {
          if (d < hitR && mole.whackFlash > 0.15) nearJustWhacked = true;
          continue;
        }
        if (d < bestDist) {
          best = mole;
          bestDist = d;
        }
      }
      if (best) {
        e?.preventDefault();
        this.whackMole(seat, best);
        return;
      }
      // Empty hole? That's a whiff: it costs combo, so spam-tapping doesn't pay.
      if (!nearJustWhacked && seat.holes.some((h) => Math.hypot(x - h.x, y - h.y) < hitR)) {
        e?.preventDefault();
        this.whiff(seat, x, y);
      }
      return;
    }
  }

  private whiff(seat: Seat, x: number, y: number): void {
    const before = seat.combo;
    seat.combo = whiffCombo(seat.combo);
    this.ctx.sfx.tick();
    this.juice.burst(x, y, ["rgba(244,247,251,0.5)"], { count: 6, speed: 90, gravity: 150, life: 0.3, size: 3 });
    if (before > seat.combo) this.float(x, y - 30, "whiff", "rgba(244,247,251,0.6)", 18, 0.5);
  }

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    for (const seat of this.seats) this.drawZone(g, seat);
    this.drawFloaters(g);

    this.juice.end(g);

    if (this.overdrive) {
      g.save();
      g.strokeStyle = "#FF6B35";
      g.lineWidth = 6;
      g.globalAlpha = 0.5 + 0.3 * Math.sin(this.time * 12);
      g.strokeRect(3, 3, width - 6, height - 6);
      g.restore();
    }

    drawTimerBar(g, width, this.remaining, DURATION);
    this.callouts.draw(g, width, height);
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    for (const f of this.floaters) {
      g.save();
      g.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.4));
      g.font = `700 ${f.size}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
      g.restore();
    }
  }

  private drawZone(g: CanvasRenderingContext2D, s: Seat): void {
    const { zoneX: zx, zoneY: zy, zoneW: zw, zoneH: zh, player } = s;

    g.fillStyle = "rgba(244,247,251,0.02)";
    g.fillRect(zx + 1, zy, zw - 2, zh);
    if (s.fever > 0) {
      const pulse = 0.12 + 0.08 * Math.sin(this.time * 14);
      g.save();
      g.globalAlpha = pulse + s.feverFlash * 0.6;
      g.fillStyle = player.color;
      g.fillRect(zx + 1, zy, zw - 2, zh);
      g.restore();
      g.save();
      g.strokeStyle = "#FFD700";
      g.lineWidth = 4;
      g.globalAlpha = 0.5 + 0.5 * Math.sin(this.time * 20);
      g.strokeRect(zx + 3, zy + 2, zw - 6, zh - 4);
      g.restore();
    }
    if (s.hurtFlash > 0) {
      g.save();
      g.globalAlpha = s.hurtFlash * 0.5;
      g.fillStyle = "#FF3D7A";
      g.fillRect(zx + 1, zy, zw - 2, zh);
      g.restore();
    }
    g.strokeStyle = "rgba(244,247,251,0.08)";
    g.lineWidth = 1;
    g.strokeRect(zx + 0.5, zy + 0.5, zw - 1, zh - 1);

    // HUD: name left of centre, score right of centre, meter underneath.
    const cx = zx + zw / 2;
    const hudY = zy + 34;
    g.textBaseline = "top";
    g.fillStyle = player.color;
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.textAlign = "right";
    g.fillText(player.name, cx - 10, hudY + 8);
    g.fillStyle = s.hurtFlash > 0 ? "#FF3D7A" : "#F4F7FB";
    g.font = "700 34px Bebas Neue, Impact, sans-serif";
    g.textAlign = "left";
    g.fillText(String(s.score), cx + 10, hudY - 2);
    this.drawMeter(g, s);

    for (const hole of s.holes) {
      g.beginPath();
      g.ellipse(hole.x, hole.y, HOLE_RADIUS, HOLE_RADIUS * 0.5, 0, 0, Math.PI * 2);
      g.fillStyle = "#0a1020";
      g.fill();
      g.strokeStyle = "rgba(244,247,251,0.1)";
      g.lineWidth = 2;
      g.stroke();
    }

    for (const mole of s.moles) {
      if (mole.whacked) {
        this.drawWhacked(g, mole);
        continue;
      }
      this.drawMole(g, mole, s);
    }
  }

  private drawWhacked(g: CanvasRenderingContext2D, mole: Mole): void {
    if (mole.whackFlash <= 0) return;
    const t = 0.35 - mole.whackFlash;
    g.save();
    if (mole.points !== 0 && t < 0.14) {
      // Squash: a flattened disc for a few frames.
      const sq = 1 - t / 0.14;
      g.translate(mole.x, mole.y);
      g.scale(1 + 0.5 * sq, Math.max(0.12, 1 - 0.8 * sq));
      g.beginPath();
      g.arc(0, 0, HOLE_RADIUS * 0.6, 0, Math.PI * 2);
      g.fillStyle =
        mole.kind === "bomb" ? "#FF3D7A" : mole.kind === "thief" || mole.kind === "raider" ? "#B266FF" : mole.kind === "golden" ? "#FFD700" : "#8B6914";
      g.fill();
      g.restore();
      g.save();
    }
    if (mole.points !== 0) {
      g.globalAlpha = Math.min(1, mole.whackFlash / 0.25);
      const big = mole.points >= 5 || mole.points <= -5;
      g.fillStyle = mole.points < 0 ? "#FF3D7A" : big ? "#FFD700" : "#F4F7FB";
      g.font = `700 ${big ? 36 : 28}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      const pts = mole.points < 0 ? String(mole.points) : `+${mole.points}`;
      const y = mole.y - HOLE_RADIUS - 10 - t * 40;
      g.strokeText(pts, mole.x, y);
      g.fillText(pts, mole.x, y);
    }
    g.restore();
  }

  private drawMole(g: CanvasRenderingContext2D, mole: Mole, s: Seat): void {
    const rise = Math.min(1, mole.upFor / 0.15);
    const drop = mole.life < 0.12 ? mole.life / 0.12 : 1;
    const show = Math.min(rise, drop);
    const tell = mole.kind === "normal" && mole.life <= TELL_TIME;

    g.save();
    g.translate(mole.x, mole.y);
    if (tell) g.translate(Math.sin(this.time * 70) * 4, 0);

    if (mole.kind === "bomb") {
      const r = HOLE_RADIUS * 0.7 * show;
      g.shadowColor = "#FF3D7A";
      g.shadowBlur = 16;
      g.beginPath();
      g.arc(0, -r * 0.3, r, 0, Math.PI * 2);
      g.fillStyle = "#1a1a2e";
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "#FF3D7A";
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = "#FF3D7A";
      g.font = `700 ${Math.round(r * 1.1)}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("X", 0, -r * 0.3);
      g.restore();
      return;
    }

    const purple = mole.kind === "raider" || mole.kind === "thief";
    const fatScale = mole.kind === "normal" ? 1 + 0.15 * mole.stage : 1;
    const r = HOLE_RADIUS * 0.72 * show * fatScale;
    const col = mole.kind === "golden" ? "#FFD700" : purple ? "#8A4DFF" : mole.stage >= MAX_STAGE ? "#C58A1E" : "#8B6914";
    g.shadowColor = mole.kind === "golden" ? "#FFD700" : purple ? "#B266FF" : mole.stage >= MAX_STAGE ? "#FFD700" : "#B8860B";
    g.shadowBlur =
      mole.kind === "golden" || mole.stage >= MAX_STAGE ? 20 + 12 * Math.sin(this.time * 30) : purple ? 16 : 8;
    g.beginPath();
    g.arc(0, -r * 0.3, r, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
    g.shadowBlur = 0;

    // Eyes (a mask band for the purple ones).
    if (purple) {
      g.fillStyle = "#1a1030";
      g.fillRect(-r * 0.6, -r * 0.65, r * 1.2, r * 0.32);
      g.fillStyle = "#F4F7FB";
    } else {
      g.fillStyle = "#070b14";
    }
    g.beginPath();
    g.arc(-r * 0.25, -r * 0.5, r * 0.14, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(r * 0.25, -r * 0.5, r * 0.14, 0, Math.PI * 2);
    g.fill();

    g.textAlign = "center";
    g.textBaseline = "middle";
    if (mole.kind === "normal") {
      // The number on the belly is what it pays right now.
      const v = stageValue(mole.stage, this.overdrive);
      g.fillStyle = mole.stage >= MAX_STAGE ? "#FFF6C0" : "rgba(255,255,255,0.85)";
      g.font = `700 ${Math.round(r * 0.9)}px Bebas Neue, Impact, sans-serif`;
      g.fillText(String(v), 0, r * 0.05);
      if (tell && show >= 1) {
        // Sweat drop: it's about to duck.
        g.fillStyle = "#9ad9ff";
        g.beginPath();
        g.ellipse(r * 0.95, -r * 0.6 - Math.abs(Math.sin(this.time * 20)) * 6, 4, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
    } else if (mole.kind === "golden") {
      g.fillStyle = "#5a3a00";
      g.font = `700 ${Math.round(r * 0.8)}px Bebas Neue, Impact, sans-serif`;
      g.fillText("10", 0, r * 0.05);
    } else if (mole.kind === "raider") {
      g.fillStyle = "#B266FF";
      g.font = "700 18px Bebas Neue, Impact, sans-serif";
      g.fillText("RAID", 0, -r - 14);
    } else if (mole.kind === "thief") {
      // Sack in the victim's colour: that's your points it's holding.
      g.fillStyle = s.player.color;
      g.beginPath();
      g.arc(r * 0.8, r * 0.1, r * 0.38, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#1a1030";
      g.font = `700 ${Math.round(r * 0.5)}px Bebas Neue, Impact, sans-serif`;
      g.fillText("5", r * 0.8, r * 0.12);
      g.fillStyle = "#B266FF";
      g.font = "700 20px Bebas Neue, Impact, sans-serif";
      g.fillText("THIEF!", 0, -r - 16);
    }

    if (mole.kind === "golden" || mole.kind === "thief") {
      // Shrinking ring shows how little time is left.
      g.beginPath();
      g.arc(0, -r * 0.3, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (mole.life / mole.maxLife));
      g.strokeStyle = mole.kind === "thief" ? "#B266FF" : "#FFF6C0";
      g.lineWidth = 3;
      g.stroke();
    }
    g.restore();
  }

  private drawMeter(g: CanvasRenderingContext2D, s: Seat): void {
    const w = Math.min(160, s.zoneW * 0.5);
    const h = 8;
    const x = s.zoneX + s.zoneW / 2 - w / 2;
    const y = s.zoneY + 72;
    const fill = s.fever > 0 ? s.fever / FEVER_TIME : s.combo / COMBO_TO_FEVER;
    g.fillStyle = "rgba(244,247,251,0.12)";
    g.fillRect(x, y, w, h);
    g.fillStyle = s.fever > 0 ? "#FFD700" : s.player.color;
    g.fillRect(x, y, w * fill, h);
    g.save();
    g.font = "700 18px Bebas Neue, Impact, sans-serif";
    g.textBaseline = "middle";
    if (s.fever > 0) {
      g.fillStyle = "#FFD700";
      g.textAlign = "left";
      g.fillText("FEVER x2", x + w + 8, y + h / 2);
    }
    const scores = this.seats.map((t) => t.score);
    if (raidChance(s.index, scores) >= 0.07) {
      g.fillStyle = "#B266FF";
      g.textAlign = "right";
      g.fillText("UNDERDOG", x - 8, y + h / 2);
    }
    g.restore();
  }

  isFinished(): boolean {
    const done = this.elapsed >= DURATION;
    if (done && !this.saved) {
      this.saved = true;
      for (const s of this.seats) {
        if (s.player.kind === "human") saveBest(whack.id, s.score, BEST_KEY);
      }
    }
    return done;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({
      playerId: s.player.id,
      score: s.score,
    }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      const id = s.player.id;
      out.push({ playerId: id, label: "Hits", value: String(s.hits) });
      if (s.fatHits > 0) out.push({ playerId: id, label: "Fat bonks", value: String(s.fatHits) });
      if (s.stolen > 0) out.push({ playerId: id, label: "Stolen", value: String(s.stolen) });
      if (s.fevers > 0) out.push({ playerId: id, label: "Fevers", value: String(s.fevers) });
      if (s.bombHits > 0) out.push({ playerId: id, label: "Bombs hit", value: String(s.bombHits) });
      if (s.goldenHits > 0) out.push({ playerId: id, label: "Gold", value: String(s.goldenHits) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}
