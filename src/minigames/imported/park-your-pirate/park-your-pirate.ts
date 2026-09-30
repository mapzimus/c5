import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "../../../core/types";
import { Callouts, Juice, saveBest } from "../../../fx/juice";
import { drawTimerBar } from "../../../core/draw";
import { buildLanes, DOORS, kmToPx, makeView, project, unproject, type Door, type Lane, type LatLng, type View } from "./geo";
import { LAND } from "./land";
import {
  advanceShips,
  botPickSpot,
  FLEET_SIZE,
  GAME_DURATION_S,
  scoreShipsInRange,
  shipPos,
  SHIP_TYPES,
  spawnFleet,
  SPOT_RANGE_KM,
  type Ship,
} from "./rules";

const GAME_ID = "park-your-pirate";

export const parkYourPirate: MinigameDefinition = {
  id: GAME_ID,
  name: "Park Your Pirate",
  tagline: "Drop anchor where the ships sail. Score every hull in range.",
  description:
    "Park your pirate on the world map — near a chokepoint, a busy lane, anywhere you think " +
    "ships will sail through. Every vessel within 200 km of your anchor scores: cargo 1 pt, " +
    "tanker 2 pts, treasure ship 5 pts. Points accumulate the whole round. " +
    "Repark once mid-game to chase the traffic. Highest score wins.",
  durationMs: GAME_DURATION_S * 1000,
  controls: "Click/tap to park · One repark allowed · Keyboard: 1–4 to quick-park at a door",
  create: (ctx) => new ParkYourPirateGame(ctx),
};

const OCEAN_TOP = "#0c1628";
const OCEAN_BOT = "#0f2233";
const LAND_FILL = "#1a2d1e";
const LAND_STROKE = "#2a4a30";

interface PlayerState {
  parked: boolean;
  ll: LatLng;
  score: number;
  reparks: number;
  lastPopup: number;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

class ParkYourPirateGame implements MinigameInstance {
  private readonly view: View;
  private readonly lanes: Lane[];
  private readonly ships: Ship[];
  private readonly playerStates: Map<string, PlayerState> = new Map();
  private readonly juice: Juice;
  private readonly callouts: Callouts;
  private readonly popups: ScorePopup[] = [];
  private elapsed = 0;
  private done = false;
  private tickAccum = 0;
  private hoveredDoor: Door | null = null;

  constructor(private readonly ctx: MinigameContext) {
    this.view = makeView(GAME_WIDTH, GAME_HEIGHT);
    this.lanes = buildLanes();
    this.ships = spawnFleet(ctx.rng, this.lanes, FLEET_SIZE);
    this.juice = new Juice(() => ctx.rng.next());
    this.callouts = new Callouts();
    for (const p of ctx.players) {
      this.playerStates.set(p.id, {
        parked: false,
        ll: [0, 0],
        score: 0,
        reparks: 1,
        lastPopup: 0,
      });
    }

    ctx.sfx.countdown();
  }

  update(dt: number): void {
    if (this.done) return;
    const gdt = this.juice.update(dt);
    this.callouts.update(dt);
    this.elapsed += gdt;

    for (const p of this.popups) p.life -= dt;
    this.popups.splice(0, this.popups.length, ...this.popups.filter((p) => p.life > 0));

    advanceShips(this.ships, this.lanes, gdt, this.ctx.rng);

    this.tickAccum += gdt;
    const TICK = 0.5;
    while (this.tickAccum >= TICK) {
      this.tickAccum -= TICK;
      this.scoreAllPlayers();
    }

    this.handleInput();
    this.handleBots();

    if (this.elapsed >= GAME_DURATION_S) {
      this.done = true;
      this.checkBest();
      this.ctx.sfx.win();
    }
  }

  private scoreAllPlayers(): void {
    for (const [id, state] of this.playerStates) {
      if (!state.parked) continue;
      const pts = scoreShipsInRange(this.ships, state.ll, this.lanes);
      if (pts > 0) {
        const prev = state.score;
        state.score += pts;
        if (state.score - state.lastPopup >= 5) {
          state.lastPopup = state.score;
          const p = project(state.ll, this.view);
          const player = this.ctx.players.find((pl) => pl.id === id);
          this.popups.push({
            x: p.x,
            y: p.y - 20,
            text: `+${state.score - prev}`,
            color: player?.color ?? "#fff",
            life: 0.8,
          });
        }
      }
    }
  }

  private handleInput(): void {
    const input = this.ctx.input;
    const click = input.consumeClick();

    this.hoveredDoor = null;
    if (input.hover) {
      for (const door of DOORS) {
        const dp = project(door.ll, this.view);
        if (Math.hypot(input.hover.x - dp.x, input.hover.y - dp.y) < 18) {
          this.hoveredDoor = door;
          break;
        }
      }
    }

    const humans = this.ctx.players.filter((p) => p.kind === "human");
    if (humans.length === 0) return;
    const human = humans[0]!;

    for (let i = 0; i < DOORS.length && i < 9; i++) {
      if (input.justPressed(`Digit${i + 1}` as `Digit${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`)) {
        this.park(human.id, DOORS[i]!.ll);
        return;
      }
    }

    if (click) {
      const ll = unproject({ x: click.x, y: click.y }, this.view);
      if (ll[0] > -60 && ll[0] < 75) {
        this.park(human.id, ll);
      }
    }
  }

  private park(playerId: string, ll: LatLng): void {
    const state = this.playerStates.get(playerId)!;
    if (state.parked && state.reparks <= 0) return;
    if (state.parked) state.reparks--;
    state.parked = true;
    state.ll = ll;
    this.ctx.sfx.go();
    this.juice.shake(0.25);
    const p = project(ll, this.view);
    const player = this.ctx.players.find((pl) => pl.id === playerId);
    this.juice.burst(p.x, p.y, player?.color ?? "#fff", { count: 12, speed: 180, life: 0.5 });
  }

  private handleBots(): void {
    for (const p of this.ctx.players) {
      if (p.kind !== "bot") continue;
      const state = this.playerStates.get(p.id)!;
      if (!state.parked && this.elapsed > 1 + this.ctx.rng.next() * 2) {
        const takenSpots = [...this.playerStates.values()]
          .filter((s) => s.parked)
          .map((s) => ({ ll: s.ll, parked: s.parked, score: s.score }));
        const ll = botPickSpot(this.ctx.rng, this.ships, this.lanes, DOORS, takenSpots);
        this.park(p.id, ll);
      } else if (
        state.parked &&
        state.reparks > 0 &&
        this.elapsed > GAME_DURATION_S * 0.55 &&
        this.ctx.rng.next() < 0.02
      ) {
        const takenSpots = [...this.playerStates.values()]
          .filter((s) => s.parked && s !== state)
          .map((s) => ({ ll: s.ll, parked: s.parked, score: s.score }));
        const ll = botPickSpot(this.ctx.rng, this.ships, this.lanes, DOORS, takenSpots);
        this.park(p.id, ll);
      }
    }
  }

  private checkBest(): void {
    const humanScores = this.ctx.players
      .filter((p) => p.kind === "human")
      .map((p) => this.playerStates.get(p.id)!.score);
    const topScore = Math.max(0, ...humanScores);
    if (saveBest(GAME_ID, topScore)) {
      this.callouts.show("NEW BEST!", "#FFB020", { life: 2 });
    }
  }

  render(g: CanvasRenderingContext2D): void {
    this.juice.begin(g);
    this.drawOcean(g);
    this.drawLand(g);
    this.drawLanes(g);
    this.drawDoors(g);
    this.drawShips(g);
    this.drawPlayers(g);
    this.drawRangeRings(g);
    this.juice.end(g);
    this.drawHUD(g);
    this.drawPopups(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawOcean(g: CanvasRenderingContext2D): void {
    const grad = g.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    grad.addColorStop(0, OCEAN_TOP);
    grad.addColorStop(1, OCEAN_BOT);
    g.fillStyle = grad;
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawLand(g: CanvasRenderingContext2D): void {
    g.fillStyle = LAND_FILL;
    g.strokeStyle = LAND_STROKE;
    g.lineWidth = 0.8;
    for (const ring of LAND) {
      g.beginPath();
      for (let i = 0; i < ring.length; i += 2) {
        const lng = ring[i]!;
        const lat = ring[i + 1]!;
        const p = project([lat, lng], this.view);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  private drawLanes(g: CanvasRenderingContext2D): void {
    g.strokeStyle = "rgba(100,150,200,0.08)";
    g.lineWidth = 1;
    for (const lane of this.lanes) {
      g.beginPath();
      for (let i = 0; i < lane.pts.length; i++) {
        const p = project(lane.pts[i]!, this.view);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
  }

  private drawDoors(g: CanvasRenderingContext2D): void {
    for (const door of DOORS) {
      const dp = project(door.ll, this.view);
      const hovered = this.hoveredDoor === door;
      const pulse = 1 + Math.sin(this.elapsed * 3) * 0.15;

      g.beginPath();
      g.arc(dp.x, dp.y, (hovered ? 8 : 5) * pulse, 0, Math.PI * 2);
      g.fillStyle = hovered ? "rgba(255,200,60,0.6)" : "rgba(255,200,60,0.3)";
      g.fill();

      g.font = "600 11px Outfit, sans-serif";
      g.textAlign = door.align;
      g.textBaseline = "middle";
      g.fillStyle = hovered ? "#fcd34d" : "rgba(252,211,77,0.6)";
      g.fillText(door.name, dp.x + door.dx, dp.y + door.dy);

      if (hovered) {
        g.font = "400 10px Outfit, sans-serif";
        g.fillStyle = "rgba(255,255,255,0.6)";
        const blurbY = dp.y + door.dy + (door.dy > 0 ? 14 : -14);
        g.fillText(door.blurb.slice(0, 55) + (door.blurb.length > 55 ? "..." : ""), dp.x + door.dx, blurbY);
      }
    }
  }

  private drawShips(g: CanvasRenderingContext2D): void {
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      const sp = shipPos(ship, this.lanes);
      const pp = project(sp, this.view);
      g.fillStyle = ship.type.color;
      g.globalAlpha = 0.7;
      g.fillRect(pp.x - ship.type.size / 2, pp.y - ship.type.size / 2, ship.type.size, ship.type.size);
    }
    g.globalAlpha = 1;
  }

  private drawPlayers(g: CanvasRenderingContext2D): void {
    for (const p of this.ctx.players) {
      const state = this.playerStates.get(p.id)!;
      if (!state.parked) continue;
      const pp = project(state.ll, this.view);

      const glow = 1 + Math.sin(this.elapsed * 4 + this.ctx.players.indexOf(p) * 1.5) * 0.12;
      g.beginPath();
      g.arc(pp.x, pp.y, 10 * glow, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.globalAlpha = 0.3;
      g.fill();
      g.globalAlpha = 1;

      g.beginPath();
      g.arc(pp.x, pp.y, 5, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.fill();
      g.strokeStyle = "#0c1628";
      g.lineWidth = 2;
      g.stroke();

      g.font = "700 11px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillStyle = p.color;
      g.fillText(p.name, pp.x, pp.y - 14);
    }
  }

  private drawRangeRings(g: CanvasRenderingContext2D): void {
    for (const p of this.ctx.players) {
      const state = this.playerStates.get(p.id)!;
      if (!state.parked) continue;
      const pp = project(state.ll, this.view);
      const r = kmToPx(SPOT_RANGE_KM, state.ll[0], this.view);
      g.beginPath();
      g.arc(pp.x, pp.y, r, 0, Math.PI * 2);
      g.strokeStyle = p.color;
      g.globalAlpha = 0.25;
      g.lineWidth = 1.5;
      g.setLineDash([4, 4]);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  private drawHUD(g: CanvasRenderingContext2D): void {
    const remaining = Math.max(0, GAME_DURATION_S - this.elapsed);
    drawTimerBar(g, GAME_WIDTH, remaining, GAME_DURATION_S);

    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(0, GAME_HEIGHT - 56, GAME_WIDTH, 56);

    g.font = "700 42px Bebas Neue, Impact, sans-serif";
    g.textBaseline = "middle";
    const hudY = GAME_HEIGHT - 28;

    const sorted = [...this.ctx.players].sort((a, b) => {
      const sa = this.playerStates.get(a.id)!.score;
      const sb = this.playerStates.get(b.id)!.score;
      return sb - sa;
    });

    const spacing = Math.min(280, GAME_WIDTH / sorted.length);
    const startX = (GAME_WIDTH - spacing * (sorted.length - 1)) / 2;

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!;
      const state = this.playerStates.get(p.id)!;
      const x = startX + i * spacing;
      g.textAlign = "center";
      g.fillStyle = p.color;
      g.fillText(String(state.score), x, hudY);

      g.font = "600 13px Outfit, sans-serif";
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillText(p.name, x, hudY - 22);
      g.font = "700 42px Bebas Neue, Impact, sans-serif";
    }

    if (!this.done) {
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "right";
      g.fillStyle = remaining < 10 ? "#FF3D7A" : "#F4F7FB";
      g.fillText(`${Math.ceil(remaining)}s`, GAME_WIDTH - 16, 32);
    }

    const legend = SHIP_TYPES;
    g.font = "600 11px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    let lx = 12;
    const ly = 8;
    for (const t of legend) {
      g.fillStyle = t.color;
      g.fillRect(lx, ly, 8, 8);
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillText(`${t.label} ${t.points}pt`, lx + 12, ly - 1);
      lx += g.measureText(`${t.label} ${t.points}pt`).width + 24;
    }

    const human = this.ctx.players.find((p) => p.kind === "human");
    if (human) {
      const hState = this.playerStates.get(human.id)!;
      if (!hState.parked) {
        g.font = "600 16px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillStyle = "#94a3b8";
        g.fillText("Click anywhere on the map to park your pirate", GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10);
        g.font = "400 13px Outfit, sans-serif";
        g.fillText("or press 1-9 to park at a door", GAME_WIDTH / 2, GAME_HEIGHT / 2 + 14);
      } else if (hState.reparks > 0) {
        g.font = "400 11px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillStyle = "rgba(148,163,184,0.6)";
        g.fillText(`${hState.reparks} repark left — click to move`, GAME_WIDTH / 2, GAME_HEIGHT - 62);
      }
    }
  }

  private drawPopups(g: CanvasRenderingContext2D): void {
    for (const p of this.popups) {
      g.globalAlpha = Math.min(1, p.life / 0.3);
      g.font = "700 18px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, p.y - (1 - p.life) * 30);
    }
    g.globalAlpha = 1;
  }

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((p) => ({
      playerId: p.id,
      score: this.playerStates.get(p.id)!.score,
    }));
  }

  destroy(): void {}
}
