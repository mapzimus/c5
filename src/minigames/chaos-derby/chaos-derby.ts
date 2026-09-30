import { drawPlayerOrb, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance, type Player } from "../../core/types";
import {
  RACER_COUNT,
  backersOf,
  createRace,
  draftRacers,
  placings,
  raceOver,
  racerVelocity,
  scoreBets,
  stepRace,
  type RaceEvent,
  type RaceState,
  type Racer,
} from "./rules";

export const chaosDerby: MinigameDefinition = {
  id: "chaos-derby",
  name: "Chaos Derby",
  tagline: "Bet on a racer. Watch it all go wrong.",
  description:
    "Six racers, one finish line, zero skill. Pick who you think wins, then bananas, rockets, naps, lightning and tornadoes decide it for you. Whoever backed the best-finishing racer takes the point.",
  durationMs: 0,
  controls: "Click a lane or press 1–6 to bet. Then pray.",
  create: (ctx) => new ChaosDerby(ctx),
};

const GUTTER_W = 176;
const START_X = 196;
const FINISH_X = 1150;
const TRACK_LEN = FINISH_X - START_X;
const LANE_TOP = 118;
const LANE_H = 86;
const TICKER_Y = LANE_TOP + LANE_H * RACER_COUNT + 14;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const OFF_HOLD_S = 1.1;
const STRAGGLER_S = 8;
const RESULTS_S = 4;
const PLACE_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

type Phase = "bet" | "off" | "race" | "done";

interface Floater {
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
}

class ChaosDerby implements MinigameInstance {
  private readonly race: RaceState;
  private readonly bets = new Map<string, number>();
  private readonly juice = new Juice(() => this.ctx.rng.next());
  private readonly callouts = new Callouts();
  private readonly ticker: { text: string; life: number }[] = [];
  private readonly floaters: Floater[] = [];
  private phase: Phase = "bet";
  private time = 0;
  private hold = 0;
  private botWait = 0;
  private firstFinishAt = -1;
  private doneAt = 0;
  private finished = false;

  constructor(private readonly ctx: MinigameContext) {
    this.race = createRace(draftRacers(ctx.rng), TRACK_LEN, ctx.rng);
    this.botWait = ctx.rng.float(0.6, 1.4);
  }

  private get bettor(): Player | undefined {
    return this.ctx.players.find((p) => !this.bets.has(p.id));
  }

  update(realDt: number): void {
    const dt = this.juice.update(realDt);
    this.callouts.update(realDt);
    this.time += realDt;
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 28 * realDt;
    }
    this.floaters.splice(0, this.floaters.length, ...this.floaters.filter((f) => f.life > 0));
    for (const line of this.ticker) line.life -= realDt;

    switch (this.phase) {
      case "bet":
        this.updateBets(dt);
        return;
      case "off":
        this.hold -= dt;
        if (this.hold <= 0) {
          this.phase = "race";
          this.ctx.sfx.go();
        }
        return;
      case "race":
        this.updateRace(dt);
        return;
      case "done": {
        const click = this.ctx.input.consumeClick();
        const skip = this.time - this.doneAt > 1 && (click || this.ctx.input.justPressed("Space") || this.ctx.input.justPressed("Enter"));
        if (skip || this.time - this.doneAt >= RESULTS_S) this.finished = true;
      }
    }
  }

  private updateBets(dt: number): void {
    const player = this.bettor;
    if (!player) {
      this.phase = "off";
      this.hold = OFF_HOLD_S;
      this.callouts.show("AND THEY'RE OFF!", "#FFB020", { life: OFF_HOLD_S + 0.4, size: 84 });
      this.ctx.sfx.countdown();
      return;
    }
    if (player.kind === "bot") {
      this.botWait -= dt;
      if (this.botWait <= 0) {
        this.placeBet(player, this.ctx.rng.int(0, RACER_COUNT - 1));
        this.botWait = this.ctx.rng.float(0.6, 1.4);
      }
      return;
    }
    const input = this.ctx.input;
    const click = input.consumeClick();
    if (click) {
      const lane = laneAt(click.y);
      if (lane !== null && click.x > 0 && click.x < GAME_WIDTH) this.placeBet(player, lane);
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
    const racer = this.race.racers[lane]!;
    this.ctx.sfx.collect();
    this.juice.burst(GUTTER_W / 2, laneCenter(lane), player.color, { count: 14, speed: 160, gravity: 200, life: 0.5 });
    this.floaters.push({ text: `${player.name} → ${racer.spec.name}`, x: START_X + 120, y: laneCenter(lane) - 10, life: 1.4, color: player.color });
  }

  private updateRace(dt: number): void {
    const before = this.race.finishedCount;
    const events = stepRace(this.race, dt, this.ctx.rng);
    for (const event of events) this.onEvent(event);

    if (this.race.finishedCount > before) {
      for (const r of this.race.racers) {
        if (!r.finished || r.place <= before) continue;
        this.juice.burst(FINISH_X, laneCenter(r.lane), [r.spec.color, "#F4F7FB", "#FFB020"], { count: r.place === 1 ? 60 : 20, speed: 320 });
        if (r.place === 1) {
          this.firstFinishAt = this.race.time;
          this.juice.shake(0.45);
          this.juice.slowMo(0.5, 0.3);
          this.ctx.sfx.win();
          const names = backersOf(r.lane, this.bets).map((id) => this.ctx.players.find((p) => p.id === id)?.name ?? "?");
          this.callouts.show(`${r.spec.emoji} ${r.spec.name.toUpperCase()} WINS!`, r.spec.color, { life: 2.2, size: 80 });
          this.callouts.show(names.length ? `${names.join(" & ")} called it!` : "Nobody saw that coming.", "#F4F7FB", {
            life: 2.2,
            size: 40,
            y: 0.44,
          });
        } else {
          this.ctx.sfx.collect();
        }
      }
    }

    const stragglers = this.firstFinishAt >= 0 && this.race.time - this.firstFinishAt > STRAGGLER_S;
    if (raceOver(this.race, [...this.bets.values()]) || stragglers) {
      this.phase = "done";
      this.doneAt = this.time;
    }
  }

  private onEvent(event: RaceEvent): void {
    this.ticker.unshift({ text: event.text, life: 6 });
    this.ticker.splice(4);
    const sfx = this.ctx.sfx;
    switch (event.kind) {
      case "rocket":
      case "underdog":
      case "shortcut":
        sfx.streak(2);
        break;
      case "lightning":
      case "tornado":
      case "wormhole":
        sfx.hit();
        this.juice.shake(event.kind === "tornado" ? 0.6 : 0.3);
        break;
      case "banana":
      case "tripped":
      case "moonwalk":
        sfx.miss();
        break;
      default:
        sfx.tick();
    }
    if (event.big) {
      this.callouts.show(event.text, "#FFB020", { life: 1.6, size: 44, y: 0.5 });
      return;
    }
    const icon = event.text.split(" ")[0] ?? "!";
    for (const lane of event.lanes) {
      const r = this.race.racers[lane]!;
      const color = event.kind === "rocket" || event.kind === "underdog" || event.kind === "shortcut" ? "#B8FF3D" : "#FF3D7A";
      this.floaters.push({ text: icon, x: START_X + r.x, y: laneCenter(lane) - 38, life: 1.1, color });
      this.juice.burst(START_X + r.x, laneCenter(lane), [color, "#F4F7FB"], { count: 10, speed: 140, gravity: 240, life: 0.45, size: 3 });
    }
  }

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, this.ctx.width, this.ctx.height);
    this.drawHeader(g);
    this.juice.begin(g);
    this.drawTrack(g);
    for (const r of this.race.racers) this.drawGutter(g, r);
    for (const r of this.race.racers) this.drawRacer(g, r);
    this.drawFloaters(g);
    this.juice.end(g);
    this.drawTicker(g);
    if (this.phase === "done") this.drawResults(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawHeader(g: CanvasRenderingContext2D): void {
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#F4F7FB";
    g.font = "700 46px Bebas Neue, Impact, sans-serif";
    g.fillText("CHAOS DERBY", GAME_WIDTH / 2, 54);
    g.font = "600 22px Outfit, sans-serif";
    const player = this.bettor;
    if (this.phase === "bet" && player) {
      g.fillStyle = player.color;
      g.fillText(player.kind === "bot" ? `${player.name} is thinking…` : `${player.name}, pick your racer`, GAME_WIDTH / 2, 88);
      g.fillStyle = "#64748b";
      g.font = "600 15px Outfit, sans-serif";
      g.fillText("Click a lane or press 1–6 · the odds are made up", GAME_WIDTH / 2, 108);
    } else if (this.phase === "race") {
      g.fillStyle = "#94a3b8";
      g.fillText("No skill involved. Sit back.", GAME_WIDTH / 2, 88);
    }
  }

  private drawTrack(g: CanvasRenderingContext2D): void {
    const hoverLane = this.phase === "bet" && this.bettor?.kind === "human" && this.ctx.input.hover ? laneAt(this.ctx.input.hover.y) : null;
    for (let lane = 0; lane < RACER_COUNT; lane += 1) {
      const y = LANE_TOP + lane * LANE_H;
      g.fillStyle = lane % 2 === 0 ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.02)";
      g.fillRect(0, y, GAME_WIDTH, LANE_H);
      if (hoverLane === lane) {
        g.fillStyle = `${this.bettor?.color ?? "#fff"}22`;
        g.fillRect(0, y, GAME_WIDTH, LANE_H);
      }
      g.strokeStyle = "rgba(148,163,184,0.18)";
      g.setLineDash([14, 12]);
      g.beginPath();
      g.moveTo(START_X, y + LANE_H);
      g.lineTo(FINISH_X, y + LANE_H);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = "rgba(244,247,251,0.5)";
    g.fillRect(START_X - 2, LANE_TOP, 3, LANE_H * RACER_COUNT);
    const bottom = LANE_TOP + LANE_H * RACER_COUNT;
    for (let y = LANE_TOP, i = 0; y < bottom; y += 16, i += 1) {
      g.fillStyle = i % 2 === 0 ? "#F4F7FB" : "#0c1628";
      g.fillRect(FINISH_X, y, 12, Math.min(16, bottom - y));
      g.fillStyle = i % 2 === 0 ? "#0c1628" : "#F4F7FB";
      g.fillRect(FINISH_X + 12, y, 12, Math.min(16, bottom - y));
    }
  }

  private drawGutter(g: CanvasRenderingContext2D, r: Racer): void {
    const cy = laneCenter(r.lane);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = "#64748b";
    g.font = "700 15px Outfit, sans-serif";
    g.fillText(String(r.lane + 1), 14, cy - 12);
    g.fillStyle = r.spec.color;
    g.font = "600 17px Outfit, sans-serif";
    g.fillText(r.spec.name, 34, cy - 12);
    g.fillStyle = "#475569";
    g.font = "600 13px Outfit, sans-serif";
    g.fillText(r.odds, 34, cy + 10);
    let ox = 96;
    for (const id of backersOf(r.lane, this.bets)) {
      const player = this.ctx.players.find((p) => p.id === id);
      if (!player) continue;
      drawPlayerOrb(g, ox, cy + 11, 11, player);
      ox += 26;
    }
    if (r.finished) {
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = r.place === 1 ? "#FFB020" : "#94a3b8";
      g.font = `700 ${r.place === 1 ? 34 : 24}px Bebas Neue, Impact, sans-serif`;
      g.fillText(PLACE_LABELS[r.place - 1] ?? String(r.place), FINISH_X + 40, cy);
    }
  }

  private drawRacer(g: CanvasRenderingContext2D, r: Racer): void {
    const x = START_X + r.x;
    const cy = laneCenter(r.lane) + 4;
    const v = this.phase === "race" && !r.finished ? racerVelocity(r) : 0;
    const bob = v !== 0 ? Math.sin(this.time * 18 + r.lane * 1.3) * 3 : 0;
    g.save();
    g.translate(x, cy + bob);
    if (r.stun > 0) g.rotate(this.time * 14);
    if (r.reverse > 0) g.scale(-1, 1);
    if (r.boost > 0) {
      g.font = `30px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("🔥", -34, 6);
    }
    g.font = `46px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = r.spec.color;
    g.shadowBlur = r.finished && r.place === 1 ? 26 : 10;
    g.fillText(r.spec.emoji, 0, 0);
    g.restore();
    if (r.sleep > 0) {
      g.font = `22px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("💤", x + 26, cy - 26 + Math.sin(this.time * 4) * 3);
    }
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const f of this.floaters) {
      g.globalAlpha = Math.min(1, f.life / 0.4);
      g.font = f.text.length <= 2 ? `28px ${EMOJI_FONT}` : "700 18px Outfit, sans-serif";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  private drawTicker(g: CanvasRenderingContext2D): void {
    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = "600 16px Outfit, sans-serif";
    this.ticker.forEach((line, i) => {
      g.globalAlpha = Math.max(0, Math.min(1, line.life / 1.5)) * (1 - i * 0.22);
      g.fillStyle = i === 0 ? "#F4F7FB" : "#94a3b8";
      g.fillText(line.text, 24, TICKER_Y + i * 18);
    });
    g.globalAlpha = 1;
  }

  private drawResults(g: CanvasRenderingContext2D): void {
    const order = placings(this.race);
    const scores = scoreBets(order, this.bets);
    const rows = this.ctx.players.map((p) => {
      const lane = this.bets.get(p.id);
      const racer = lane === undefined ? null : this.race.racers[lane]!;
      const place = racer ? order.indexOf(racer) : -1;
      return { p, racer, place, score: scores.get(p.id) ?? 0 };
    });
    const w = 520;
    const h = 96 + rows.length * 36;
    const x = (GAME_WIDTH - w) / 2;
    const y = GAME_HEIGHT * 0.6 - h / 2;
    g.fillStyle = "rgba(7,11,20,0.86)";
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
      const ry = y + 70 + i * 36;
      drawPlayerOrb(g, x + 40, ry, 13, row.p);
      g.textAlign = "left";
      g.fillStyle = row.score === best ? "#FFB020" : "#F4F7FB";
      g.font = "600 20px Outfit, sans-serif";
      const label = row.racer ? `${row.racer.spec.emoji} ${row.racer.spec.name} · ${PLACE_LABELS[row.place] ?? "DNF"}` : "no bet";
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
    const scores = scoreBets(placings(this.race), this.bets);
    return this.ctx.players.map((p) => ({ playerId: p.id, score: scores.get(p.id) ?? 0 }));
  }

  destroy(): void {}
}

function laneCenter(lane: number): number {
  return LANE_TOP + lane * LANE_H + LANE_H / 2;
}

function laneAt(y: number): number | null {
  const lane = Math.floor((y - LANE_TOP) / LANE_H);
  return lane >= 0 && lane < RACER_COUNT ? lane : null;
}
