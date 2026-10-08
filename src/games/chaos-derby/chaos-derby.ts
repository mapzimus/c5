import { drawPlayerOrb } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import { GAME_HEIGHT, GAME_WIDTH, type GameContext, type GameDefinition, type GameInstance, type GameStat, type Player } from "../../core/types";
import { drawRacer, labelColor, shade, type RacerLook } from "./draw";
import { RACER_COUNT, backersOf, draftRacers, placings, scoreBets } from "./rules";
import { DerbyWorld, FINISH_X, STEP, type DerbyEvent, type Runner } from "./world";
import { CupDerby } from "./cup";
import { ModePicker } from "../mode-picker";

export const chaosDerby: GameDefinition = {
  id: "chaos-derby",
  name: "Chaos Derby",
  tagline: "Bet on a runner. Watch it all go wrong.",
  description:
    "Six runners, a long track full of hurdles, crates, bananas and mud, and zero skill. Pick who you think wins, then watch them trip, nap, sneeze, get flattened by boulders and run the wrong way. Whoever backed the best finisher takes the point.",
  durationMs: 0,
  controls: "Click a runner or press 1–6 to bet. Then yell at the screen.",
  create: (ctx) =>
    new ModePicker(
      ctx,
      "CHAOS DERBY",
      [
        {
          title: "SINGLE RACE",
          line1: "One race, one bet,",
          line2: "one winner.",
          color: "#FFB020",
          create: (c) => new ChaosDerby(c),
        },
        {
          title: "3-RACE CUP",
          line1: "Three heats, escalating chaos.",
          line2: "Your pick races them all.",
          color: "#ef4444",
          create: (c) => new CupDerby(c),
        },
      ],
      ctx.players.every((p) => p.kind === "bot"),
    ),
};

const LANE_DY = 20;
const GROUND_SY = 585;
const ZOOM_MIN = 0.85;
const ZOOM_MAX = 1.45;
const READY_S = 3;
const AFTER_WIN_S = 12;
const RESULTS_S = 5;
const PLACE = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH"];
const ADS = ["BEANS", "NAP CO.", "SOCKS 4 LESS", "BANANA INSURANCE", "DAVE'S CRATES", "HORSE? NO.", "SNACKS", "C5"];
const CARD_W = 188;
const CARD_H = 330;
const CARD_GAP = 14;
const CARD_Y = 150;

type Phase = "bet" | "ready" | "race" | "done";

interface Pop {
  lane: number;
  text: string;
  life: number;
  max: number;
  color: string;
  tilt: number;
}

interface Dust {
  lane: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

const laneDy = (lane: number): number => (lane - 2.5) * LANE_DY;

class ChaosDerby implements GameInstance {
  private readonly world: DerbyWorld;
  private readonly bets = new Map<string, number>();
  private readonly juice = new Juice(() => this.ctx.rng.next());
  private readonly callouts = new Callouts();
  private readonly pops: Pop[] = [];
  private readonly dust: Dust[] = [];
  private phase: Phase = "bet";
  private time = 0;
  private phaseT = 0;
  private acc = 0;
  private botWait: number;
  private camX = 260;
  private zoom = ZOOM_MAX;
  private leaderLane = -1;
  private lastLeadCall = -10;
  private winnerAt = -1;
  private lastTick = 0;
  private finished = false;
  private readonly crowd: string[] = [];

  constructor(private readonly ctx: GameContext) {
    this.world = new DerbyWorld(draftRacers(ctx.rng), ctx.rng);
    this.botWait = ctx.rng.float(0.7, 1.5);
    const palette = ["#f87171", "#fbbf24", "#60a5fa", "#a78bfa", "#34d399", "#f472b6", "#e2e8f0", "#fb923c", "#94a3b8"];
    for (let i = 0; i < 97; i += 1) this.crowd.push(palette[(i * 7 + (i >> 2)) % palette.length]!);
  }

  private get bettor(): Player | undefined {
    return this.ctx.players.find((p) => !this.bets.has(p.id));
  }

  // ------------------------------------------------------------------ update

  update(realDt: number): void {
    const dt = this.juice.update(realDt);
    this.callouts.update(realDt);
    this.time += realDt;
    this.phaseT += realDt;
    this.updateFx(dt);

    switch (this.phase) {
      case "bet":
        this.updateBets(realDt);
        break;
      case "ready":
        this.updateReady();
        break;
      case "race":
        this.updateRace(dt);
        break;
      case "done": {
        const click = this.ctx.input.consumeClick();
        const skip = this.phaseT > 1.2 && (click || this.ctx.input.justPressed("Space") || this.ctx.input.justPressed("Enter"));
        if (skip || this.phaseT >= RESULTS_S) this.finished = true;
        this.acc += dt;
        while (this.acc >= STEP) {
          this.world.step();
          this.acc -= STEP;
        }
      }
    }
    if (this.phase === "race" || this.phase === "done") this.updateCamera(realDt);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseT = 0;
  }

  private updateBets(dt: number): void {
    const player = this.bettor;
    if (!player) {
      this.setPhase("ready");
      return;
    }
    if (player.kind === "bot") {
      this.botWait -= dt;
      if (this.botWait <= 0) {
        this.placeBet(player, this.ctx.rng.int(0, RACER_COUNT - 1));
        this.botWait = this.ctx.rng.float(0.7, 1.5);
      }
      return;
    }
    const input = this.ctx.input;
    const click = input.consumeClick();
    if (click) {
      const lane = cardAt(click.x, click.y);
      if (lane !== null) this.placeBet(player, lane);
      return;
    }
    for (let i = 0; i < RACER_COUNT; i += 1) {
      if (input.justPressed(`Digit${i + 1}`) || input.justPressed(`Numpad${i + 1}`)) {
        this.placeBet(player, i);
        return;
      }
    }
  }

  private placeBet(player: Player, lane: number): void {
    this.bets.set(player.id, lane);
    this.ctx.sfx.collect();
    const x = cardX(lane) + CARD_W / 2;
    this.juice.burst(x, CARD_Y + CARD_H - 30, player.color, { count: 16, speed: 180, gravity: 260, life: 0.55 });
  }

  private updateReady(): void {
    const tick = Math.ceil(READY_S - this.phaseT);
    if (tick >= 1 && tick !== this.lastTick) {
      this.lastTick = tick;
      this.callouts.show(String(tick), "#F4F7FB", { life: 0.8, size: 120, y: 0.36 });
      this.ctx.sfx.countdown();
    }
    if (this.phaseT >= READY_S) {
      this.callouts.show("GO!", "#FFB020", { life: 0.9, size: 130, y: 0.36 });
      this.ctx.sfx.go();
      this.setPhase("race");
    }
  }

  private updateRace(dt: number): void {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      for (const event of this.world.step()) this.onEvent(event);
      this.acc -= STEP;
      steps += 1;
    }
    if (steps === 5) this.acc = 0;

    const order = this.world.order();
    const lead = order[0]!;
    if (!lead.finished && lead.lane !== this.leaderLane) {
      if (this.leaderLane >= 0 && this.world.time > 4 && this.world.time - this.lastLeadCall > 4) {
        this.callouts.show(`#${lead.lane + 1} ${lead.spec.name.toUpperCase()} TAKES THE LEAD`, labelColor(lead.spec.color), { life: 1.6, size: 34, y: 0.2 });
        this.lastLeadCall = this.world.time;
      }
      this.leaderLane = lead.lane;
    }

    // photo-finish slow-mo
    const [a, b] = order;
    if (a && b && !a.finished && a.x > FINISH_X - 180 && a.x - b.x < 50) this.juice.slowMo(0.1, 0.35);

    const cutoff = this.winnerAt >= 0 && this.world.time - this.winnerAt > AFTER_WIN_S;
    if (this.world.over([...this.bets.values()]) || cutoff) {
      this.setPhase("done");
      this.ctx.sfx.win();
    }
  }

  private onEvent(event: DerbyEvent): void {
    const r = event.lane === null ? undefined : this.world.runners.find((x) => x.lane === event.lane);
    const sfx = this.ctx.sfx;
    switch (event.sound) {
      case "hit":
        sfx.hit();
        break;
      case "tick":
        sfx.tick();
        break;
      case "boost":
        sfx.streak(2);
        break;
      case "miss":
        sfx.miss();
        break;
      case "big":
        sfx.hit();
        sfx.streak(3);
    }
    if (event.shake) this.juice.shake(event.shake);
    if (event.callout) this.callouts.show(event.callout, "#FFB020", { life: 1.5, size: 64, y: 0.3 });
    if (r && event.pop) {
      const good = ["BOING", "ZOOM", "SECOND WIND", "HUP", "JETPACK", "KABOOM", "MEGA", "TA-DA", "YOINK"].includes(event.pop);
      this.pops.push({ lane: r.lane, text: event.pop, life: 1.3, max: 1.3, color: good ? "#B8FF3D" : "#FFE066", tilt: this.ctx.rng.float(-0.18, 0.18) });
    }
    if (r && event.kind === "fall") this.puff(r, 8, "#d6c3a5");
    if (r && event.kind === "banana") this.puff(r, 5, "#fde047");
    if (r && event.kind === "flattened") this.puff(r, 12, "#94a3b8");
    if (r && event.kind === "anvil") this.puff(r, 16, "#cbd5e1");
    if (r && event.kind === "cannon") this.puff(r, 14, "#475569");
    if (r && (event.kind === "hole" || event.kind === "popout")) this.puff(r, 12, "#7c5a34");
    if (r && event.kind === "mega") this.puff(r, 10, "#fde047");
    if (r && event.kind === "finish") this.onFinish(r);
  }

  private onFinish(r: Runner): void {
    this.puff(r, 10, r.spec.color);
    if (r.place === 1) {
      this.winnerAt = this.world.time;
      this.juice.shake(0.4);
      this.juice.slowMo(0.9, 0.3);
      this.juice.burst(GAME_WIDTH / 2, 120, [r.spec.color, "#F4F7FB", "#FFB020", "#3EE0FF"], { count: 90, speed: 520, gravity: 420, life: 1.6, size: 6 });
      const names = backersOf(r.lane, this.bets).map((id) => this.ctx.players.find((p) => p.id === id)?.name ?? "?");
      this.callouts.show(`${r.spec.name.toUpperCase()} WINS!`, labelColor(r.spec.color), { life: 2.6, size: 88, y: 0.28 });
      this.callouts.show(names.length ? `${names.join(" & ")} called it` : "Nobody backed that", "#F4F7FB", { life: 2.6, size: 36, y: 0.39 });
    } else if (r.place === 2 && r.finishTime - this.winnerAt < 0.3) {
      this.callouts.show("PHOTO FINISH!", "#3EE0FF", { life: 1.6, size: 48, y: 0.48 });
    }
  }

  private puff(r: Runner, count: number, color: string): void {
    const b = r.body;
    for (let i = 0; i < count; i += 1) {
      const life = this.ctx.rng.float(0.35, 0.8);
      this.dust.push({
        lane: r.lane,
        x: b.position.x + this.ctx.rng.float(-r.w / 2, r.w / 2),
        y: b.bounds.max.y - 4,
        vx: this.ctx.rng.float(-90, 90),
        vy: this.ctx.rng.float(-120, -20),
        life,
        max: life,
        size: this.ctx.rng.float(3, 7),
        color,
      });
    }
  }

  private updateFx(dt: number): void {
    for (const p of this.pops) p.life -= dt;
    remove(this.pops, (p) => p.life <= 0);
    for (const d of this.dust) {
      d.life -= dt;
      d.vy += 260 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.y = Math.min(d.y, 0);
    }
    remove(this.dust, (d) => d.life <= 0);
    if (this.phase !== "race") return;
    for (const r of this.world.runners) {
      if (r.mudded && r.mode === "run" && this.ctx.rng.next() < 0.3) this.puff(r, 1, "#6b4f2a");
      if (r.boostT > 0 && this.ctx.rng.next() < 0.4) this.puff(r, 1, "#fb923c");
    }
  }

  /** Frame the leader and every runner with money on it; anyone else can fall off-screen. */
  private updateCamera(dt: number): void {
    const racers = this.world.runners;
    const lead = Math.max(...racers.map((r) => r.x));
    const bet = new Set(this.bets.values());
    const watched = racers.filter((r) => !r.finished && bet.has(r.lane));
    const tail = watched.length ? Math.min(...watched.map((r) => r.x)) : lead;
    const span = Math.max(1, lead - tail) + 360;
    const targetZoom = clamp(GAME_WIDTH / span, ZOOM_MIN, ZOOM_MAX);
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 1.2);
    const view = GAME_WIDTH / this.zoom;
    let target = (lead + tail) / 2 + 40;
    if (span > view) target = lead - view / 2 + 200 / this.zoom;
    target = Math.min(target, FINISH_X + 250);
    this.camX += (target - this.camX) * Math.min(1, dt * 2.5);
  }

  // ------------------------------------------------------------------ render

  private sx(x: number): number {
    return (x - this.camX) * this.zoom + GAME_WIDTH / 2;
  }

  private sy(y: number, lane: number): number {
    return GROUND_SY + (y + laneDy(lane)) * this.zoom;
  }

  render(g: CanvasRenderingContext2D): void {
    this.juice.begin(g);
    this.drawStadium(g);
    if (this.world.lowGravT > 0) this.drawLowGravity(g);
    this.drawTrack(g);
    if (this.world.iceT > 0) this.drawIce(g);
    for (let lane = 0; lane < RACER_COUNT; lane += 1) {
      this.drawLane(g, lane);
      if (lane === 2) this.drawBoulders(g);
    }
    this.drawPops(g);
    this.juice.end(g);

    if (this.phase === "bet") this.drawBetting(g);
    else {
      this.drawHud(g);
      this.drawOffscreen(g);
    }
    if (this.phase === "done") this.drawResults(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawStadium(g: CanvasRenderingContext2D): void {
    const sky = g.createLinearGradient(0, 0, 0, GROUND_SY);
    sky.addColorStop(0, "#0a1224");
    sky.addColorStop(0.6, "#16284a");
    sky.addColorStop(1, "#27406b");
    g.fillStyle = sky;
    g.fillRect(-40, -40, GAME_WIDTH + 80, GAME_HEIGHT + 80);

    // floodlights
    const lightPar = 0.15;
    for (let i = -1; i < 4; i += 1) {
      const base = Math.floor((this.camX * lightPar) / 520) + i;
      const x = base * 520 - this.camX * lightPar + 180;
      g.fillStyle = "#0b1325";
      g.fillRect(x - 3, 70, 6, 240);
      g.fillStyle = "#e2e8f0";
      g.fillRect(x - 26, 58, 52, 16);
      const glow = g.createRadialGradient(x, 66, 4, x, 66, 110);
      glow.addColorStop(0, "rgba(255,248,220,0.55)");
      glow.addColorStop(1, "rgba(255,248,220,0)");
      g.fillStyle = glow;
      g.fillRect(x - 110, -44, 220, 220);
    }

    // stands and crowd
    const trackTop = this.sy(0, 0) - 18 * this.zoom;
    const standTop = trackTop - 170;
    g.fillStyle = "#101b33";
    g.fillRect(-40, standTop, GAME_WIDTH + 80, trackTop - standTop);
    const par = 0.4;
    const excite = this.phase === "race" ? 1 : 0.4;
    for (let row = 0; row < 8; row += 1) {
      const y = standTop + 14 + row * 17;
      const off = (this.camX * par) % 13;
      for (let i = -1; i < GAME_WIDTH / 13 + 2; i += 1) {
        const idx = i + Math.floor((this.camX * par) / 13);
        const color = this.crowd[(((idx * 31 + row * 17) % 97) + 97) % 97]!;
        const bob = Math.max(0, Math.sin(this.time * (6 + (idx % 5)) + idx * 1.7 + row)) * 3 * excite;
        g.fillStyle = shade(color, -0.35 - row * 0.02);
        g.beginPath();
        g.arc(i * 13 - off, y - bob, 5, 0, Math.PI * 2);
        g.fill();
      }
    }

    // ad boards on the barrier (move with the track)
    const boardH = 22 * this.zoom + 8;
    const boardY = trackTop - boardH;
    const boardW = 300;
    const first = Math.floor((this.camX - GAME_WIDTH / this.zoom) / boardW);
    for (let k = first; k < first + Math.ceil(GAME_WIDTH / this.zoom / boardW) * 2 + 3; k += 1) {
      const x0 = this.sx(k * boardW);
      const x1 = this.sx((k + 1) * boardW);
      if (x1 < -10 || x0 > GAME_WIDTH + 10) continue;
      const colors = ["#1d4ed8", "#be123c", "#047857", "#7c3aed", "#b45309"];
      g.fillStyle = colors[((k % colors.length) + colors.length) % colors.length]!;
      g.fillRect(x0, boardY, x1 - x0 - 3, boardH);
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.font = `700 ${Math.round(boardH * 0.7)}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const meters = k * boardW;
      const label = meters > 0 && meters < FINISH_X && meters % 1200 === 0 ? `${Math.round((FINISH_X - meters) / 10)}M TO GO` : ADS[((k % ADS.length) + ADS.length) % ADS.length]!;
      g.fillText(label, (x0 + x1) / 2, boardY + boardH / 2 + 1);
    }
  }

  private drawTrack(g: CanvasRenderingContext2D): void {
    const top = this.sy(0, 0) - 12 * this.zoom;
    const bottom = this.sy(0, 5) + 12 * this.zoom;
    g.fillStyle = "#1f5f3a";
    g.fillRect(-40, bottom, GAME_WIDTH + 80, GAME_HEIGHT - bottom + 40);
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = -1; i < 30; i += 1) {
      const x = this.sx(Math.floor(this.camX / 160) * 160 + (i - 12) * 160);
      g.fillRect(x, bottom, 80 * this.zoom, GAME_HEIGHT - bottom);
    }
    g.fillStyle = "#b24f38";
    g.fillRect(-40, top, GAME_WIDTH + 80, bottom - top);
    g.fillStyle = "#c65d44";
    g.fillRect(-40, top, GAME_WIDTH + 80, 3);
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 1.5;
    for (let lane = 0; lane <= RACER_COUNT; lane += 1) {
      const y = this.sy(0, lane) - (LANE_DY / 2) * this.zoom;
      g.beginPath();
      g.moveTo(-40, y);
      g.lineTo(GAME_WIDTH + 40, y);
      g.stroke();
    }
    // start and finish
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.fillRect(this.sx(0) - 2, top, 4, bottom - top);
    const fx = this.sx(FINISH_X);
    const sq = 8 * this.zoom;
    for (let y = top, i = 0; y < bottom; y += sq, i += 1) {
      for (let c = 0; c < 2; c += 1) {
        g.fillStyle = (i + c) % 2 === 0 ? "#f8fafc" : "#111827";
        g.fillRect(fx + c * sq - sq, y, sq, Math.min(sq, bottom - y));
      }
    }
    // finish gantry
    const postTop = top - 190 * this.zoom;
    g.fillStyle = "#e2e8f0";
    g.fillRect(fx - 3, postTop, 6, top - postTop);
    g.fillStyle = "#111827";
    g.fillRect(fx - 70 * this.zoom, postTop - 4, 140 * this.zoom, 34 * this.zoom);
    g.fillStyle = "#FFB020";
    g.font = `700 ${Math.round(28 * this.zoom)}px Bebas Neue, Impact, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("FINISH", fx, postTop - 4 + 17 * this.zoom);
  }

  private drawLowGravity(g: CanvasRenderingContext2D): void {
    const a = Math.min(1, this.world.lowGravT / 0.6);
    g.fillStyle = `rgba(124,58,237,${0.2 * a})`;
    g.fillRect(-40, -40, GAME_WIDTH + 80, GROUND_SY);
    g.fillStyle = `rgba(233,213,255,${0.7 * a})`;
    for (let i = 0; i < 40; i += 1) {
      const x = (i * 137.5 - this.camX * 0.3) % (GAME_WIDTH + 40);
      const y = GROUND_SY - ((this.time * (20 + (i % 7) * 6) + i * 53) % GROUND_SY);
      g.beginPath();
      g.arc(x < 0 ? x + GAME_WIDTH + 40 : x, y, 1.5 + (i % 3), 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawIce(g: CanvasRenderingContext2D): void {
    const a = Math.min(1, this.world.iceT / 0.6);
    const top = this.sy(0, 0) - 12 * this.zoom;
    const bottom = this.sy(0, 5) + 12 * this.zoom;
    g.fillStyle = `rgba(186,230,253,${0.55 * a})`;
    g.fillRect(-40, top, GAME_WIDTH + 80, bottom - top);
    g.strokeStyle = `rgba(255,255,255,${0.7 * a})`;
    g.lineWidth = 2;
    for (let i = 0; i < 18; i += 1) {
      const x = ((i * 211 - this.camX * this.zoom) % (GAME_WIDTH + 200) + GAME_WIDTH + 200) % (GAME_WIDTH + 200) - 100;
      const y = top + ((i * 37) % (bottom - top));
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 40, y - 6);
      g.stroke();
    }
  }

  private drawProps(g: CanvasRenderingContext2D, lane: number): void {
    const z = this.zoom;
    for (const prop of this.world.props) {
      if (prop.lane !== lane || !this.visible(prop.x)) continue;
      const x = this.sx(prop.x);
      const y = this.sy(-this.world.heightAt(prop.x), lane);
      const t = 1 - prop.life / prop.max;
      if (prop.kind === "hole") {
        const open = Math.min(1, t * 6, prop.life * 3);
        g.fillStyle = "#7c5a34";
        g.beginPath();
        g.ellipse(x, y, 28 * z * open, 7 * z * open, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#0b0f19";
        g.beginPath();
        g.ellipse(x, y, 22 * z * open, 5 * z * open, 0, 0, Math.PI * 2);
        g.fill();
      } else if (prop.kind === "cannon") {
        g.save();
        g.globalAlpha = Math.min(1, prop.life * 2);
        g.translate(x, y - 12 * z);
        g.scale(z, z);
        g.rotate(-0.75);
        g.fillStyle = "#1f2937";
        g.beginPath();
        g.roundRect(-10, -12, 52, 24, 8);
        g.fill();
        g.fillStyle = "#374151";
        g.fillRect(36, -14, 10, 28);
        g.restore();
        g.fillStyle = "#78350f";
        g.beginPath();
        g.arc(x - 6 * z, y - 6 * z, 10 * z, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = `rgba(241,245,249,${0.9 * (1 - t)})`;
        for (let i = 0; i < 7; i += 1) {
          const a = (i / 7) * Math.PI * 2;
          g.beginPath();
          g.arc(x + Math.cos(a) * 28 * t * z, y - 30 * z + Math.sin(a) * 22 * t * z, (10 + 8 * t) * z, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    for (const fish of this.world.fish) {
      if (fish.lane !== lane || !this.visible(fish.body.position.x)) continue;
      const b = fish.body;
      g.save();
      g.globalAlpha = Math.min(1, fish.life);
      g.translate(this.sx(b.position.x), this.sy(b.position.y, lane));
      g.scale(z, z);
      g.rotate(b.angle);
      g.fillStyle = fish.lane % 2 ? "#fb923c" : "#cbd5e1";
      g.beginPath();
      g.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-10, 0);
      g.lineTo(-18, -6);
      g.lineTo(-18, 6);
      g.closePath();
      g.fill();
      g.fillStyle = "#0b0f19";
      g.beginPath();
      g.arc(6, -1.5, 1.6, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private visible(x: number, pad = 120): boolean {
    const s = this.sx(x);
    return s > -pad && s < GAME_WIDTH + pad;
  }

  private drawLane(g: CanvasRenderingContext2D, lane: number): void {
    const z = this.zoom;
    for (const hill of this.world.hills) {
      if (!this.visible(hill.x0, 800) && !this.visible(hill.x1, 800)) continue;
      g.beginPath();
      hill.body.vertices.forEach((v, i) => {
        const x = this.sx(v.x);
        const y = this.sy(Math.min(v.y, 0), lane);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.fillStyle = lane % 2 === 0 ? "#a84a35" : "#b9533c";
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = 1.5;
      g.stroke();
    }

    for (const p of this.world.patches) {
      if (p.lane !== lane || !this.visible(p.x)) continue;
      const x = this.sx(p.x);
      const y = this.sy(-this.world.heightAt(p.x), lane);
      if (p.kind === "mud") {
        g.fillStyle = "#5b4023";
        g.beginPath();
        g.ellipse(x, y + 2 * z, (p.w / 2) * z, 3.5 * z, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.beginPath();
        g.ellipse(x - p.w * 0.15 * z, y - 1, p.w * 0.12 * z, 2 * z, 0, 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === "banana" && !p.used) {
        g.strokeStyle = "#facc15";
        g.lineWidth = 5 * z;
        g.lineCap = "round";
        g.beginPath();
        g.arc(x, y - 10 * z, 9 * z, Math.PI * 0.15, Math.PI * 0.85);
        g.stroke();
        g.strokeStyle = "#713f12";
        g.lineWidth = 2 * z;
        g.beginPath();
        g.moveTo(x + 7 * z, y - 5 * z);
        g.lineTo(x + 10 * z, y - 8 * z);
        g.stroke();
      } else if (p.kind === "spring") {
        g.strokeStyle = "#cbd5e1";
        g.lineWidth = 2.5 * z;
        g.beginPath();
        for (let i = 0; i <= 6; i += 1) g.lineTo(x + (i % 2 ? 10 : -10) * z, y - i * 2.4 * z);
        g.stroke();
        g.fillStyle = "#ef4444";
        g.fillRect(x - 18 * z, y - 18 * z, 36 * z, 5 * z);
      }
    }

    for (const item of this.world.items) {
      if (item.lane !== lane || !this.visible(item.body.position.x)) continue;
      const b = item.body;
      g.save();
      g.translate(this.sx(b.position.x), this.sy(b.position.y, lane));
      g.scale(z, z);
      g.rotate(b.angle);
      if (item.kind === "hurdle") {
        for (let i = 0; i < 4; i += 1) {
          g.fillStyle = i % 2 ? "#ef4444" : "#f8fafc";
          g.fillRect(-item.w / 2, -item.h / 2 + (i * item.h) / 4, item.w, item.h / 4);
        }
        g.fillStyle = "#f8fafc";
        g.fillRect(-11, -item.h / 2 - 3, 22, 5);
        g.fillStyle = "#1e293b";
        g.fillRect(-9, item.h / 2 - 3, 18, 3);
      } else {
        g.fillStyle = "#a16207";
        g.fillRect(-item.w / 2, -item.h / 2, item.w, item.h);
        g.strokeStyle = "#713f12";
        g.lineWidth = 2.5;
        g.strokeRect(-item.w / 2 + 1.5, -item.h / 2 + 1.5, item.w - 3, item.h - 3);
        g.beginPath();
        g.moveTo(-item.w / 2 + 3, -item.h / 2 + 3);
        g.lineTo(item.w / 2 - 3, item.h / 2 - 3);
        g.stroke();
      }
      g.restore();
    }

    for (const d of this.dust) {
      if (d.lane !== lane) continue;
      g.globalAlpha = Math.max(0, d.life / d.max) * 0.8;
      g.fillStyle = d.color;
      g.beginPath();
      g.arc(this.sx(d.x), this.sy(d.y, lane), d.size * z, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    this.drawProps(g, lane);
    const r = this.world.runners.find((x) => x.lane === lane);
    if (r) this.drawRunner(g, r);
  }

  private drawBoulders(g: CanvasRenderingContext2D): void {
    for (const boulder of this.world.boulders) {
      const b = boulder.body;
      if (!this.visible(b.position.x, 200)) continue;
      g.save();
      g.translate(this.sx(b.position.x), this.sy(b.position.y, 2.5));
      g.scale(this.zoom, this.zoom);
      g.rotate(b.angle);
      g.fillStyle = "#78716c";
      g.beginPath();
      g.arc(0, 0, boulder.r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#57534e";
      g.beginPath();
      g.arc(-boulder.r * 0.3, boulder.r * 0.2, boulder.r * 0.35, 0, Math.PI * 2);
      g.arc(boulder.r * 0.35, -boulder.r * 0.3, boulder.r * 0.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#44403c";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-boulder.r * 0.1, -boulder.r * 0.9);
      g.lineTo(boulder.r * 0.1, -boulder.r * 0.3);
      g.lineTo(-boulder.r * 0.2, 0);
      g.stroke();
      g.restore();
    }
  }

  private lookOf(r: Runner): RacerLook {
    const b = r.body;
    let legs: RacerLook["legs"] = "run";
    let arms: RacerLook["arms"] = "swing";
    let stride = r.stride;
    if (r.mode === "ride") {
      const kind = r.ride?.kind;
      legs = kind === "balloon" ? "air" : kind === "hole" ? "idle" : "flail";
      arms = kind === "balloon" || kind === "hole" ? "up" : "flail";
    } else if (r.jetT > 0 && r.mode === "run") {
      legs = "air";
      arms = "up";
    } else if (r.danceT > 0 && r.mode === "run") {
      legs = "run";
      arms = "up";
      stride = this.time * 260;
    } else if (r.mode === "fallen") {
      const flail = !r.sleeping && r.modeT < 0.9;
      legs = flail ? "flail" : "limp";
      arms = flail ? "flail" : "limp";
    } else if (r.mode === "getup") {
      legs = "idle";
      arms = "limp";
    } else if (!r.grounded) {
      legs = "air";
      arms = r.mood === "panic" ? "flail" : "up";
    } else if (r.stopT > 0) {
      legs = "idle";
      arms = "wave";
    } else if (r.mode === "finished" && Math.abs(b.velocity.x) < 0.4) {
      legs = "idle";
      arms = r.place === 1 ? "up" : "limp";
    }
    if (r.mood === "win") arms = "up";
    return {
      spec: r.spec,
      w: r.w,
      h: r.h,
      lane: r.lane,
      mood: r.mood,
      dir: r.dir,
      stride,
      legs,
      arms,
      time: this.time,
      boost: r.boostT > 0,
      charred: r.charT > 0,
      vy: b.velocity.y,
      squash: r.landT / 0.22,
      pie: r.pieT > 0,
      jet: r.jetT > 0 && r.mode === "run",
    };
  }

  private drawRunner(g: CanvasRenderingContext2D, r: Runner): void {
    const b = r.body;
    if (!this.visible(b.position.x, 160)) return;
    const z = this.zoom;
    const ride = r.ride;
    const ground = -this.world.heightAt(b.position.x);
    const lift = Math.max(0, ground - b.bounds.max.y);
    const groundY = this.sy(ground, r.lane);
    if (ride?.kind !== "hole") {
      g.fillStyle = `rgba(0,0,0,${0.3 * Math.max(0.2, 1 - lift / 200)})`;
      g.beginPath();
      g.ellipse(this.sx(b.position.x), groundY, (r.w * r.scale * 0.6 + 6) * z * Math.max(0.4, 1 - lift / 300), 4 * z, 0, 0, Math.PI * 2);
      g.fill();
    }

    const x = this.sx(b.position.x);
    const y = this.sy(b.position.y, r.lane);
    const h = r.h * r.scale;
    if (ride?.kind === "ufo") this.drawUfo(g, x, y, h, true);
    if (ride?.kind === "balloon") this.drawBalloons(g, x, y, h, r.lane);

    g.save();
    if (ride?.kind === "hole") {
      g.beginPath();
      g.rect(-40, -1000, GAME_WIDTH + 80, groundY + 1000);
      g.clip();
    }
    g.translate(x, y);
    g.scale(z * r.scale, z * r.scale);
    g.rotate(b.angle);
    if (r.danceT > 0 && r.mode === "run") g.rotate(Math.sin(this.time * 10) * 0.22);
    if (r.flatT > 0) {
      g.translate(0, r.h / 2);
      g.scale(1.5, 0.3);
      g.translate(0, -r.h / 2);
    }
    drawRacer(g, this.lookOf(r));
    g.restore();

    if (ride?.kind === "hole" && b.position.y > ground - (r.h * r.scale) / 4) {
      g.fillStyle = "#7c5a34";
      g.beginPath();
      g.ellipse(x, groundY, 20 * z, 9 * z, 0, Math.PI, 0);
      g.fill();
    }
    if (ride?.kind === "eagle") this.drawEagle(g, x, y - (h / 2 + 16) * z);
    if (ride?.kind === "ufo") this.drawUfo(g, x, y, h, false);
    if (r.flatT > 0) this.drawAnvil(g, x, groundY - r.h * 0.3 * z, 2.4 - r.flatT);

    const headY = y - (h / 2 + 14) * z;
    if (r.mood === "sleep") {
      g.fillStyle = "#e2e8f0";
      g.font = `700 ${Math.round(18 * z + 4)}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      for (let i = 0; i < 3; i += 1) {
        const t = (this.time * 0.8 + i / 3) % 1;
        g.globalAlpha = 1 - t;
        g.fillText("z", x + (10 + t * 26) * z, y - (10 + t * 40) * z);
      }
      g.globalAlpha = 1;
    }
    if (r.mood === "confused") {
      g.fillStyle = "#FFE066";
      g.font = `700 ${Math.round(26 * z + 6)}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.fillText("?", x, headY - Math.abs(Math.sin(this.time * 6)) * 5);
    }
    if (r.finished && r.place <= 3) {
      g.fillStyle = r.place === 1 ? "#FFB020" : "#cbd5e1";
      g.font = `700 ${Math.round(22 * z + 4)}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.fillText(PLACE[r.place - 1]!, x, headY - 16 * z);
    }
    let ox = x - (backersOf(r.lane, this.bets).length - 1) * 9;
    for (const id of backersOf(r.lane, this.bets)) {
      const player = this.ctx.players.find((p) => p.id === id);
      if (!player) continue;
      drawPlayerOrb(g, ox, headY, 8, player);
      ox += 18;
    }
  }

  private drawEagle(g: CanvasRenderingContext2D, x: number, y: number): void {
    const z = this.zoom;
    const flap = Math.sin(this.time * 14);
    g.save();
    g.translate(x, y);
    g.scale(z, z);
    g.strokeStyle = "#f59e0b";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-6, 6);
    g.lineTo(-8, 18);
    g.moveTo(6, 6);
    g.lineTo(8, 18);
    g.stroke();
    g.fillStyle = "#6b3f1d";
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(side * 8, -6);
      g.quadraticCurveTo(side * 40, -30 - flap * 22, side * 70, -10 - flap * 30);
      g.quadraticCurveTo(side * 40, -4, side * 8, 4);
      g.fill();
    }
    g.beginPath();
    g.ellipse(0, -2, 16, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f8fafc";
    g.beginPath();
    g.arc(14, -12, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f59e0b";
    g.beginPath();
    g.moveTo(21, -14);
    g.lineTo(31, -9);
    g.lineTo(21, -7);
    g.fill();
    g.fillStyle = "#0b0f19";
    g.beginPath();
    g.arc(16, -14, 1.8, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Saucer above the runner; the beam goes behind them, the saucer in front. */
  private drawUfo(g: CanvasRenderingContext2D, x: number, y: number, h: number, beam: boolean): void {
    const z = this.zoom;
    const sy = y - (h / 2 + 62) * z + Math.sin(this.time * 3) * 4;
    if (beam) {
      const grad = g.createLinearGradient(0, sy, 0, y + (h / 2) * z);
      grad.addColorStop(0, "rgba(190,242,100,0.55)");
      grad.addColorStop(1, "rgba(190,242,100,0.05)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - 18 * z, sy);
      g.lineTo(x + 18 * z, sy);
      g.lineTo(x + 46 * z, y + (h / 2) * z);
      g.lineTo(x - 46 * z, y + (h / 2) * z);
      g.closePath();
      g.fill();
      return;
    }
    g.save();
    g.translate(x, sy);
    g.scale(z, z);
    g.fillStyle = "rgba(125,211,252,0.7)";
    g.beginPath();
    g.ellipse(0, -8, 18, 15, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = "#94a3b8";
    g.beginPath();
    g.ellipse(0, 0, 48, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#475569";
    g.beginPath();
    g.ellipse(0, 4, 30, 6, 0, 0, Math.PI);
    g.fill();
    for (let i = 0; i < 5; i += 1) {
      g.fillStyle = (Math.floor(this.time * 8) + i) % 2 ? "#fde047" : "#f472b6";
      g.beginPath();
      g.arc(-32 + i * 16, 1, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawBalloons(g: CanvasRenderingContext2D, x: number, y: number, h: number, lane: number): void {
    const z = this.zoom;
    const colors = ["#ef4444", "#3b82f6", "#facc15"];
    const handY = y - (h / 2) * z;
    colors.forEach((c, i) => {
      const bx = x + (i - 1) * 16 * z + Math.sin(this.time * 2 + i + lane) * 5 * z;
      const by = handY - (62 + (i % 2) * 12) * z;
      g.strokeStyle = "rgba(226,232,240,0.8)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, handY);
      g.lineTo(bx, by + 14 * z);
      g.stroke();
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(bx, by, 11 * z, 14 * z, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.beginPath();
      g.ellipse(bx - 4 * z, by - 5 * z, 3 * z, 4 * z, -0.4, 0, Math.PI * 2);
      g.fill();
    });
  }

  private drawAnvil(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    const z = this.zoom;
    const drop = t < 0.18 ? (1 - t / 0.18) * 320 * z : 0;
    g.save();
    g.translate(x, y - drop);
    g.scale(z, z);
    g.fillStyle = "#374151";
    g.beginPath();
    g.moveTo(-26, -24);
    g.lineTo(30, -24);
    g.quadraticCurveTo(30, -14, 14, -12);
    g.lineTo(10, -4);
    g.lineTo(18, 0);
    g.lineTo(-16, 0);
    g.lineTo(-8, -4);
    g.lineTo(-12, -12);
    g.quadraticCurveTo(-34, -14, -26, -24);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(-20, -22, 40, 3);
    g.restore();
  }

  private drawPops(g: CanvasRenderingContext2D): void {
    for (const p of this.pops) {
      const r = this.world.runners.find((x) => x.lane === p.lane);
      if (!r) continue;
      const t = 1 - p.life / p.max;
      const pop = t < 0.12 ? 0.5 + (t / 0.12) * 0.7 : t < 0.22 ? 1.2 - ((t - 0.12) / 0.1) * 0.2 : 1;
      g.save();
      g.globalAlpha = Math.min(1, p.life / 0.35);
      g.translate(this.sx(r.body.position.x) + 28 * this.zoom, this.sy(r.body.position.y, r.lane) - (r.h * 0.8 + 30 + t * 26) * this.zoom);
      g.rotate(p.tilt);
      g.scale(pop, pop);
      g.font = `700 ${Math.round(24 + 8 * this.zoom)}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 6;
      g.strokeStyle = "#0b1020";
      g.strokeText(p.text, 0, 0);
      g.fillStyle = p.color;
      g.fillText(p.text, 0, 0);
      g.restore();
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const x0 = 250;
    const x1 = 1030;
    const y = 40;
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.beginPath();
    g.roundRect(x0 - 30, y - 24, x1 - x0 + 70, 48, 24);
    g.fill();
    g.strokeStyle = "rgba(244,247,251,0.35)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    for (let i = 0; i < 3; i += 1) {
      g.fillStyle = i % 2 ? "#111827" : "#f8fafc";
      g.fillRect(x1 + 4, y - 9 + i * 6, 12, 6);
    }
    const order = this.world.order();
    for (const r of [...order].reverse()) {
      const t = clamp(r.x / FINISH_X, 0, 1);
      const mx = x0 + (x1 - x0) * t;
      const my = y + (r.lane - 2.5) * 2.5;
      const backers = backersOf(r.lane, this.bets);
      g.fillStyle = r.spec.color;
      g.strokeStyle = backers.length ? (this.ctx.players.find((p) => p.id === backers[0])?.color ?? "#fff") : "#0b1020";
      g.lineWidth = backers.length ? 3 : 1.5;
      g.beginPath();
      g.arc(mx, my, 11, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = labelColor(r.spec.color) === r.spec.color ? "#0b1020" : "#f8fafc";
      g.font = "700 15px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(r.lane + 1), mx, my + 1);
    }
    g.textAlign = "left";
    g.fillStyle = "#94a3b8";
    g.font = "600 14px Outfit, sans-serif";
    g.fillText(this.phase === "ready" ? "ON YOUR MARKS" : `${this.world.time.toFixed(1)}s`, 24, y + 1);
  }

  private drawOffscreen(g: CanvasRenderingContext2D): void {
    // stack the markers so runners left behind together don't pile up on one spot
    const behind = this.world.runners
      .filter((r) => this.sx(r.body.position.x) <= -10)
      .map((r) => ({ r, y: this.sy(r.body.position.y, r.lane) }))
      .sort((a, b) => a.y - b.y);
    for (let n = 1; n < behind.length; n += 1) behind[n]!.y = Math.max(behind[n]!.y, behind[n - 1]!.y + 36);
    for (const { r, y } of behind) {
      g.fillStyle = "rgba(7,11,20,0.75)";
      g.beginPath();
      g.roundRect(8, y - 16, 86, 32, 16);
      g.fill();
      g.fillStyle = r.spec.color;
      g.beginPath();
      g.arc(26, y, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = labelColor(r.spec.color) === r.spec.color ? "#0b1020" : "#f8fafc";
      g.font = "700 15px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(r.lane + 1), 26, y + 1);
      g.fillStyle = "#F4F7FB";
      g.font = "600 13px Outfit, sans-serif";
      g.fillText(`◀ ${Math.round((this.camX - GAME_WIDTH / 2 / this.zoom - r.x) / 10)}m`, 62, y + 1);
    }
  }

  private drawBetting(g: CanvasRenderingContext2D): void {
    g.fillStyle = "rgba(7,11,20,0.62)";
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const player = this.bettor;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#F4F7FB";
    g.font = "700 64px Bebas Neue, Impact, sans-serif";
    g.fillText("PLACE YOUR BETS", GAME_WIDTH / 2, 78);
    if (player) {
      g.fillStyle = player.color;
      g.font = "600 24px Outfit, sans-serif";
      g.fillText(player.kind === "bot" ? `${player.name} is squinting at the runners…` : `${player.name}, who's winning this?`, GAME_WIDTH / 2, 116);
    }
    const hover = this.ctx.input.hover;
    const hoverLane = hover && player?.kind === "human" ? cardAt(hover.x, hover.y) : null;
    for (const r of this.world.runners) {
      const x = cardX(r.lane);
      const hot = hoverLane === r.lane;
      g.fillStyle = hot ? "rgba(30,41,59,0.95)" : "rgba(15,23,42,0.9)";
      g.strokeStyle = hot ? (player?.color ?? r.spec.color) : shade(r.spec.color, -0.3);
      g.lineWidth = hot ? 4 : 2;
      g.beginPath();
      g.roundRect(x, CARD_Y, CARD_W, CARD_H, 18);
      g.fill();
      g.stroke();
      g.fillStyle = "#64748b";
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "left";
      g.fillText(`#${r.lane + 1}`, x + 14, CARD_Y + 30);
      g.textAlign = "right";
      g.fillStyle = "#94a3b8";
      g.font = "600 14px Outfit, sans-serif";
      g.fillText(r.odds, x + CARD_W - 14, CARD_Y + 28);

      g.save();
      g.beginPath();
      g.roundRect(x, CARD_Y, CARD_W, CARD_H, 18);
      g.clip();
      g.fillStyle = "#b24f38";
      g.fillRect(x, CARD_Y + 200, CARD_W, 34);
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.fillRect(x, CARD_Y + 200, CARD_W, 2);
      g.fillRect(x, CARD_Y + 232, CARD_W, 2);
      g.restore();
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.ellipse(x + CARD_W / 2, CARD_Y + 214, 40, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.save();
      const scale = 2;
      const bob = hot ? Math.abs(Math.sin(this.time * 9)) * -8 : 0;
      g.translate(x + CARD_W / 2, CARD_Y + 214 - (r.h / 2) * scale + bob);
      g.scale(scale, scale);
      const look = this.lookOf(r);
      look.legs = hot ? "run" : "idle";
      look.arms = hot ? "swing" : "limp";
      look.stride = hot ? this.time * 160 : 0;
      look.mood = hot ? "happy" : (["focused", "smug", "tired", "focused", "confused", "happy"] as const)[(r.lane + r.spec.id.length) % 6]!;
      drawRacer(g, look);
      g.restore();

      g.textAlign = "center";
      g.fillStyle = labelColor(r.spec.color);
      g.font = "700 34px Bebas Neue, Impact, sans-serif";
      g.fillText(r.spec.name.toUpperCase(), x + CARD_W / 2, CARD_Y + 262);
      let ox = x + CARD_W / 2 - (backersOf(r.lane, this.bets).length - 1) * 15;
      for (const id of backersOf(r.lane, this.bets)) {
        const p = this.ctx.players.find((pl) => pl.id === id);
        if (!p) continue;
        drawPlayerOrb(g, ox, CARD_Y + 298, 12, p);
        ox += 30;
      }
    }
    g.fillStyle = "#64748b";
    g.font = "600 15px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillText("Click a runner or press 1–6 · the odds are made up · nobody knows anything", GAME_WIDTH / 2, CARD_Y + CARD_H + 40);
  }

  private drawResults(g: CanvasRenderingContext2D): void {
    if (this.phaseT < 0.6) return;
    const order = placings(this.world.runners);
    const scores = scoreBets(order, this.bets);
    const rows = this.ctx.players.map((p) => {
      const lane = this.bets.get(p.id);
      const runner = lane === undefined ? null : this.world.runners.find((r) => r.lane === lane)!;
      return { p, runner, place: runner ? order.indexOf(runner) : -1, score: scores.get(p.id) ?? 0 };
    });
    const w = 560;
    const h = 96 + rows.length * 38;
    const x = (GAME_WIDTH - w) / 2;
    const y = GAME_HEIGHT * 0.62 - h / 2;
    g.fillStyle = "rgba(7,11,20,0.9)";
    g.strokeStyle = "rgba(244,247,251,0.25)";
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x, y, w, h, 18);
    g.fill();
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#94a3b8";
    g.font = "600 16px Outfit, sans-serif";
    g.fillText("Where the money went", GAME_WIDTH / 2, y + 30);
    const best = Math.max(...rows.map((r) => r.score));
    rows.forEach((row, i) => {
      const ry = y + 72 + i * 38;
      drawPlayerOrb(g, x + 40, ry, 13, row.p);
      g.textAlign = "left";
      g.fillStyle = row.score === best ? "#FFB020" : "#F4F7FB";
      g.font = "600 20px Outfit, sans-serif";
      const label = row.runner ? `#${row.runner.lane + 1} ${row.runner.spec.name} · ${row.runner.finished ? PLACE[row.place] : "still out there"}` : "no bet";
      g.fillText(`${row.p.name} → ${label}`, x + 66, ry);
      g.textAlign = "right";
      g.fillText(row.score === best ? "WIN" : "", x + w - 30, ry);
    });
    g.textAlign = "center";
    g.fillStyle = "#475569";
    g.font = "600 13px Outfit, sans-serif";
    g.fillText("click to continue", GAME_WIDTH / 2, y + h - 16);
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    const scores = scoreBets(placings(this.world.runners), this.bets);
    return this.ctx.players.map((p) => ({ playerId: p.id, score: scores.get(p.id) ?? 0 }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    const order = placings(this.world.runners);
    for (const p of this.ctx.players) {
      const lane = this.bets.get(p.id);
      if (lane === undefined) continue;
      const runner = this.world.runners.find((r) => r.lane === lane);
      if (!runner) continue;
      const place = order.indexOf(runner) + 1;
      stats.push({ playerId: p.id, label: "Backed", value: `#${lane + 1} ${runner.spec.name}` });
      stats.push({ playerId: p.id, label: "Finish", value: runner.finished ? PLACE[place - 1]! : "DNF" });
    }
    const top2 = order.filter((r) => r.finished).slice(0, 2);
    if (top2.length === 2) {
      const margin = Math.abs(top2[0]!.finishTime - top2[1]!.finishTime);
      if (margin < 0.5) {
        for (const p of this.ctx.players) {
          const lane = this.bets.get(p.id);
          if (lane === top2[0]!.lane || lane === top2[1]!.lane) {
            stats.push({ playerId: p.id, label: "Photo finish", value: `${margin.toFixed(2)}s gap` });
          }
        }
      }
    }
    return stats;
  }

  destroy(): void {
    this.world.destroy();
  }
}

function cardX(lane: number): number {
  const total = RACER_COUNT * CARD_W + (RACER_COUNT - 1) * CARD_GAP;
  return (GAME_WIDTH - total) / 2 + lane * (CARD_W + CARD_GAP);
}

function cardAt(x: number, y: number): number | null {
  if (y < CARD_Y || y > CARD_Y + CARD_H) return null;
  for (let lane = 0; lane < RACER_COUNT; lane += 1) {
    if (x >= cardX(lane) && x <= cardX(lane) + CARD_W) return lane;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function remove<T>(list: T[], dead: (item: T) => boolean): void {
  for (let i = list.length - 1; i >= 0; i -= 1) if (dead(list[i]!)) list.splice(i, 1);
}
