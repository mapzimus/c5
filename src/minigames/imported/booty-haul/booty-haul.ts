import { GAME_HEIGHT, GAME_WIDTH, type MinigameContext, type MinigameDefinition, type MinigameInstance } from "../../../core/types";
import { Callouts, Juice, saveBest } from "../../../fx/juice";
import { drawTimerBar } from "../../../core/draw";
import { buildLanes, DOORS, globeProject, globeRangeCircle, globeUnproject, makeGlobe, type Door, type Globe, type Lane, type LatLng } from "./geo";
import { LAND } from "./land";
import {
  advanceShips,
  botPickSpot,
  FLEET_SIZE,
  GAME_DURATION_S,
  REPARK_COUNT,
  scoreShipsInRange,
  shipPos,
  SHIP_TYPES,
  spawnFleet,
  spawnConvoyPack,
  maybeStartGoldRush,
  spawnGoldRushShips,
  STREAK_THRESHOLD,
  type Ship,
  type GoldRush,
} from "./rules";

const GAME_ID = "booty-haul";
const GLOBE_CX = 480;
const GLOBE_CY = 340;
const GLOBE_R_DEFAULT = 300;
const GLOBE_R_MIN = 200;
const GLOBE_R_MAX = 500;
const SPIN_SPEED = 8;

export const bootyHaul: MinigameDefinition = {
  id: GAME_ID,
  name: "Booty Haul",
  tagline: "Drop anchor where the ships sail. Score every hull in range.",
  description:
    "Click anywhere on the globe to drop anchor. " +
    "Every vessel within 200 km scores: cargo 2, tanker 5, treasure 15, convoy 30. " +
    "Build a streak for multiplied points. Two reparks to chase the traffic. " +
    "Watch for gold rush events on busy lanes. Scroll to zoom. 75 seconds.",
  durationMs: GAME_DURATION_S * 1000,
  controls: "Click anywhere on the globe · Scroll to zoom · Two reparks · 1–9 keys for landmarks",
  create: (ctx) => new ParkYourPirateGame(ctx),
};

interface PlayerState {
  parked: boolean;
  ll: LatLng;
  score: number;
  displayScore: number;
  reparks: number;
  streak: number;
  multiplier: number;
  dryTicks: number;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
}

class ParkYourPirateGame implements MinigameInstance {
  private readonly lanes: Lane[];
  private readonly ships: Ship[];
  private readonly playerStates: Map<string, PlayerState> = new Map();
  private readonly juice: Juice;
  private readonly callouts: Callouts;
  private readonly popups: ScorePopup[] = [];
  private readonly stars: Star[] = [];
  private camLat = 20;
  private camLng = 0;
  private targetLat = 20;
  private targetLng = 0;
  private elapsed = 0;
  private done = false;
  private tickAccum = 0;
  private hoveredDoor: Door | null = null;
  private globeRadius = GLOBE_R_DEFAULT;
  private goldRush: GoldRush | null = null;
  private goldRushSpawnCooldown = 0;
  private convoyTimer = 0;
  private readonly wheelHandler: (e: WheelEvent) => void;

  constructor(private readonly ctx: MinigameContext) {
    this.lanes = buildLanes();
    this.ships = spawnFleet(ctx.rng, this.lanes, FLEET_SIZE);
    this.juice = new Juice(() => ctx.rng.next());
    this.callouts = new Callouts();

    // Spawn a few initial convoy packs
    for (let i = 0; i < 3; i++) {
      this.ships.push(...spawnConvoyPack(ctx.rng, this.lanes));
    }

    // Mouse wheel zoom
    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * 20;
      this.globeRadius = Math.max(GLOBE_R_MIN, Math.min(GLOBE_R_MAX, this.globeRadius + delta));
    };
    ctx.canvas.addEventListener("wheel", this.wheelHandler, { passive: false });

    for (let i = 0; i < 120; i++) {
      this.stars.push({
        x: ctx.rng.next() * GAME_WIDTH,
        y: ctx.rng.next() * GAME_HEIGHT,
        brightness: 0.15 + ctx.rng.next() * 0.5,
        size: 0.5 + ctx.rng.next() * 1.2,
      });
    }

    for (const p of ctx.players) {
      this.playerStates.set(p.id, {
        parked: false, ll: [0, 0], score: 0, displayScore: 0,
        reparks: REPARK_COUNT, streak: 0, multiplier: 1, dryTicks: 0,
      });
    }

    ctx.sfx.countdown();
  }

  private globe(): Globe {
    return makeGlobe(GLOBE_CX, GLOBE_CY, this.globeRadius, this.camLat, this.camLng);
  }

  update(dt: number): void {
    if (this.done) return;
    const gdt = this.juice.update(dt);
    this.callouts.update(dt);
    this.elapsed += gdt;

    for (const p of this.popups) p.life -= dt;
    this.popups.splice(0, this.popups.length, ...this.popups.filter((p) => p.life > 0));

    advanceShips(this.ships, this.lanes, gdt, this.ctx.rng);

    const anyParked = [...this.playerStates.values()].some((s) => s.parked);
    if (!anyParked) {
      this.camLng += SPIN_SPEED * gdt;
      this.targetLng = this.camLng;
    } else {
      this.camLat += (this.targetLat - this.camLat) * Math.min(1, dt * 3);
      this.camLng += (this.targetLng - this.camLng) * Math.min(1, dt * 3);
    }

    // Convoy pack spawning every ~15 seconds
    this.convoyTimer += gdt;
    if (this.convoyTimer >= 15) {
      this.convoyTimer -= 15;
      this.ships.push(...spawnConvoyPack(this.ctx.rng, this.lanes));
    }

    this.tickAccum += gdt;
    const TICK = 0.4;
    while (this.tickAccum >= TICK) {
      this.tickAccum -= TICK;
      this.scoreAllPlayers();

      // Gold rush logic
      this.goldRush = maybeStartGoldRush(this.ctx.rng, this.lanes, this.goldRush);
      if (this.goldRush) {
        this.goldRush.remaining -= TICK;
        this.goldRushSpawnCooldown -= TICK;
        if (this.goldRushSpawnCooldown <= 0) {
          this.ships.push(...spawnGoldRushShips(this.ctx.rng, this.lanes, this.goldRush.laneIdx));
          this.goldRushSpawnCooldown = 2;
        }
        if (this.goldRush.remaining <= 0) {
          this.goldRush = null;
        }
      }
    }

    for (const [, state] of this.playerStates) {
      if (state.displayScore < state.score) {
        state.displayScore += Math.ceil((state.score - state.displayScore) * Math.min(1, dt * 8));
        if (state.displayScore > state.score) state.displayScore = state.score;
      }
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
    const globe = this.globe();
    for (const [id, state] of this.playerStates) {
      if (!state.parked) continue;
      const raw = scoreShipsInRange(this.ships, state.ll, this.lanes);
      if (raw > 0) {
        state.streak++;
        state.dryTicks = 0;
        state.multiplier = Math.min(4, 1 + Math.floor(state.streak / STREAK_THRESHOLD));
        const pts = raw * state.multiplier;
        state.score += pts;
        const p = globeProject(state.ll, globe);
        if (p.z > 0) {
          const player = this.ctx.players.find((pl) => pl.id === id);
          const label = state.multiplier > 1 ? `+${pts} x${state.multiplier}` : `+${pts}`;
          this.popups.push({ x: p.x, y: p.y - 24, text: label, color: player?.color ?? "#fff", life: 0.7 });
        }
        if (state.streak === STREAK_THRESHOLD) {
          this.ctx.sfx.streak(1);
          this.juice.shake(0.15);
        } else if (state.streak === STREAK_THRESHOLD * 2) {
          this.ctx.sfx.streak(2);
          this.juice.shake(0.2);
          this.callouts.show("x3", "#FFB020", { life: 0.6, size: 48 });
        } else if (state.streak === STREAK_THRESHOLD * 3) {
          this.ctx.sfx.streak(3);
          this.juice.shake(0.3);
          this.callouts.show("MAX x4", "#FF3D7A", { life: 0.8, size: 56 });
        }
      } else {
        state.dryTicks++;
        if (state.dryTicks >= 3) {
          state.streak = 0;
          state.multiplier = 1;
          state.dryTicks = 0;
        }
      }
    }
  }

  private handleInput(): void {
    const input = this.ctx.input;
    const click = input.consumeClick();
    const globe = this.globe();

    this.hoveredDoor = null;
    if (input.hover) {
      for (const door of DOORS) {
        const dp = globeProject(door.ll, globe);
        if (dp.z > 0 && Math.hypot(input.hover.x - dp.x, input.hover.y - dp.y) < 16) {
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
      const ll = globeUnproject(click.x, click.y, globe);
      if (ll) this.park(human.id, ll);
    }
  }

  private park(playerId: string, ll: LatLng): void {
    const state = this.playerStates.get(playerId)!;
    if (state.parked && state.reparks <= 0) return;
    if (state.parked) {
      state.reparks--;
      state.streak = 0;
      state.multiplier = 1;
    }
    state.parked = true;
    state.ll = ll;
    this.targetLat = ll[0];
    this.targetLng = ll[1];
    this.ctx.sfx.go();
    this.juice.shake(0.3);
    this.juice.hitStop(0.06);
    const globe = this.globe();
    const p = globeProject(ll, globe);
    const player = this.ctx.players.find((pl) => pl.id === playerId);
    this.juice.burst(p.x, p.y, player?.color ?? "#fff", { count: 20, speed: 220, life: 0.6, gravity: 200 });
  }

  private handleBots(): void {
    for (const p of this.ctx.players) {
      if (p.kind !== "bot") continue;
      const state = this.playerStates.get(p.id)!;
      if (!state.parked && this.elapsed > 0.8 + this.ctx.rng.next() * 1.5) {
        const takenSpots = [...this.playerStates.values()]
          .filter((s) => s.parked)
          .map((s) => ({ ll: s.ll, parked: s.parked, score: s.score }));
        this.park(p.id, botPickSpot(this.ctx.rng, this.ships, this.lanes, DOORS, takenSpots));
      } else if (state.parked && state.reparks > 0 && this.elapsed > GAME_DURATION_S * 0.5 && this.ctx.rng.next() < 0.015) {
        const takenSpots = [...this.playerStates.values()]
          .filter((s) => s.parked && s !== state)
          .map((s) => ({ ll: s.ll, parked: s.parked, score: s.score }));
        this.park(p.id, botPickSpot(this.ctx.rng, this.ships, this.lanes, DOORS, takenSpots));
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
    const globe = this.globe();
    this.drawBackground(g);
    this.juice.begin(g);
    this.drawGlobe(g, globe);
    this.juice.end(g);
    this.drawHUD(g, globe);
    this.drawPopups(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawBackground(g: CanvasRenderingContext2D): void {
    g.fillStyle = "#030810";
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    for (const star of this.stars) {
      const twinkle = star.brightness * (0.7 + Math.sin(this.elapsed * 2 + star.x) * 0.3);
      g.globalAlpha = twinkle;
      g.fillStyle = "#c8d6e5";
      g.beginPath();
      g.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawGlobe(g: CanvasRenderingContext2D, globe: Globe): void {
    const R = this.globeRadius;
    const atmo = g.createRadialGradient(GLOBE_CX, GLOBE_CY, R * 0.95, GLOBE_CX, GLOBE_CY, R * 1.15);
    atmo.addColorStop(0, "rgba(56,130,220,0.12)");
    atmo.addColorStop(1, "rgba(56,130,220,0)");
    g.fillStyle = atmo;
    g.fillRect(GLOBE_CX - R * 1.2, GLOBE_CY - R * 1.2, R * 2.4, R * 2.4);

    g.save();
    g.beginPath();
    g.arc(GLOBE_CX, GLOBE_CY, R, 0, Math.PI * 2);
    g.clip();

    const ocean = g.createRadialGradient(GLOBE_CX - 60, GLOBE_CY - 80, 0, GLOBE_CX, GLOBE_CY, R);
    ocean.addColorStop(0, "#0f2847");
    ocean.addColorStop(1, "#071428");
    g.fillStyle = ocean;
    g.fillRect(GLOBE_CX - R, GLOBE_CY - R, R * 2, R * 2);

    this.drawGraticulesClipped(g, globe);
    this.drawLandClipped(g, globe);
    this.drawLanesClipped(g, globe);
    this.drawDoorsClipped(g, globe);
    this.drawShipsClipped(g, globe);
    this.drawPlayersClipped(g, globe);
    this.drawRangeRingsClipped(g, globe);

    g.restore();

    g.beginPath();
    g.arc(GLOBE_CX, GLOBE_CY, R, 0, Math.PI * 2);
    g.strokeStyle = "rgba(100,160,220,0.15)";
    g.lineWidth = 2;
    g.stroke();
  }

  private drawGraticulesClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    g.strokeStyle = "rgba(80,120,180,0.06)";
    g.lineWidth = 0.5;
    for (let lat = -60; lat <= 60; lat += 30) {
      g.beginPath();
      let started = false;
      for (let lng = -180; lng <= 180; lng += 5) {
        const p = globeProject([lat, lng], globe);
        if (p.z > 0) {
          if (!started) { g.moveTo(p.x, p.y); started = true; }
          else g.lineTo(p.x, p.y);
        } else { started = false; }
      }
      g.stroke();
    }
    for (let lng = -180; lng < 180; lng += 30) {
      g.beginPath();
      let started = false;
      for (let lat = -80; lat <= 80; lat += 5) {
        const p = globeProject([lat, lng], globe);
        if (p.z > 0) {
          if (!started) { g.moveTo(p.x, p.y); started = true; }
          else g.lineTo(p.x, p.y);
        } else { started = false; }
      }
      g.stroke();
    }
  }

  private drawLandClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    g.fillStyle = "#132e1c";
    g.strokeStyle = "#1f5a2e";
    g.lineWidth = 0.6;
    for (const ring of LAND) {
      let visCount = 0;
      const pts: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i < ring.length; i += 2) {
        const p = globeProject([ring[i + 1]!, ring[i]!], globe);
        pts.push(p);
        if (p.z > 0) visCount++;
      }
      if (visCount === 0) continue;

      g.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const curr = pts[i]!;
        const prev = pts[(i + pts.length - 1) % pts.length]!;
        if (curr.z >= 0) {
          if (!started || prev.z < 0) {
            if (prev.z < 0 && curr.z >= 0) {
              // Interpolate from behind-globe to visible at the z=0 horizon
              const dz = curr.z - prev.z;
              const t = dz > 0 ? -prev.z / dz : 0;
              g.moveTo(prev.x + (curr.x - prev.x) * t, prev.y + (curr.y - prev.y) * t);
              g.lineTo(curr.x, curr.y);
            } else {
              g.moveTo(curr.x, curr.y);
            }
            started = true;
          } else {
            g.lineTo(curr.x, curr.y);
          }
        } else if (started && prev.z >= 0) {
          // Interpolate from visible to behind-globe at the z=0 horizon
          const dz = prev.z - curr.z;
          const t = dz > 0 ? prev.z / dz : 0;
          g.lineTo(prev.x + (curr.x - prev.x) * t, prev.y + (curr.y - prev.y) * t);
        }
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  private drawLanesClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    g.strokeStyle = "rgba(80,140,200,0.1)";
    g.lineWidth = 0.8;
    for (const lane of this.lanes) {
      g.beginPath();
      let started = false;
      for (const pt of lane.pts) {
        const p = globeProject(pt, globe);
        if (p.z > 0) {
          if (!started) { g.moveTo(p.x, p.y); started = true; }
          else g.lineTo(p.x, p.y);
        } else { started = false; }
      }
      g.stroke();
    }
  }

  private drawDoorsClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const door of DOORS) {
      const dp = globeProject(door.ll, globe);
      if (dp.z < 0.1) continue;
      const hovered = this.hoveredDoor === door;
      const pulse = 1 + Math.sin(this.elapsed * 3.5) * 0.2;
      const r = (hovered ? 7 : 4) * pulse;

      g.beginPath();
      g.arc(dp.x, dp.y, r + 3, 0, Math.PI * 2);
      g.fillStyle = hovered ? "rgba(255,200,60,0.15)" : "rgba(255,200,60,0.06)";
      g.fill();

      g.beginPath();
      g.arc(dp.x, dp.y, r, 0, Math.PI * 2);
      g.fillStyle = hovered ? "#fcd34d" : "rgba(252,211,77,0.5)";
      g.fill();

      g.font = "600 10px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillStyle = hovered ? "#fef3c7" : "rgba(252,211,77,0.6)";
      g.fillText(door.name, dp.x, dp.y - r - 3);
    }
  }

  private drawShipsClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      const sp = shipPos(ship, this.lanes);
      const pp = globeProject(sp, globe);
      if (pp.z < 0.05) continue;

      const alpha = Math.min(0.85, pp.z * 1.2);
      g.globalAlpha = alpha;

      if (ship.type.key === "convoy" || ship.type.key === "treasure") {
        g.beginPath();
        g.arc(pp.x, pp.y, ship.type.size + 2, 0, Math.PI * 2);
        g.fillStyle = ship.type.key === "convoy" ? "rgba(34,211,238,0.12)" : "rgba(168,85,247,0.12)";
        g.fill();
      }

      g.beginPath();
      g.arc(pp.x, pp.y, ship.type.size * 0.6, 0, Math.PI * 2);
      g.fillStyle = ship.type.color;
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawPlayersClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const p of this.ctx.players) {
      const state = this.playerStates.get(p.id)!;
      if (!state.parked) continue;
      const pp = globeProject(state.ll, globe);
      if (pp.z < 0) continue;

      const pulse = 1 + Math.sin(this.elapsed * 5 + this.ctx.players.indexOf(p) * 1.5) * 0.15;
      g.beginPath();
      g.arc(pp.x, pp.y, 14 * pulse, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.globalAlpha = 0.15;
      g.fill();

      g.globalAlpha = 1;
      g.beginPath();
      g.arc(pp.x, pp.y, 6, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.fill();
      g.strokeStyle = "#030810";
      g.lineWidth = 2;
      g.stroke();

      g.font = "700 11px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillStyle = p.color;
      g.fillText(p.name, pp.x, pp.y - 18);
    }
  }

  private drawRangeRingsClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const p of this.ctx.players) {
      const state = this.playerStates.get(p.id)!;
      if (!state.parked) continue;
      const ring = globeRangeCircle(state.ll, 200, globe);
      const visible = ring.filter((pt) => pt.z > 0);
      if (visible.length < 3) continue;

      g.beginPath();
      let started = false;
      for (const pt of ring) {
        if (pt.z > 0) {
          if (!started) { g.moveTo(pt.x, pt.y); started = true; }
          else g.lineTo(pt.x, pt.y);
        } else { started = false; }
      }
      if (ring[0]!.z > 0 && ring[ring.length - 1]!.z > 0) g.closePath();
      g.strokeStyle = p.color;
      g.globalAlpha = 0.3;
      g.lineWidth = 1.5;
      g.setLineDash([6, 4]);
      g.stroke();
      g.setLineDash([]);

      g.globalAlpha = 0.04;
      g.fillStyle = p.color;
      g.beginPath();
      started = false;
      for (const pt of ring) {
        if (pt.z > 0) {
          if (!started) { g.moveTo(pt.x, pt.y); started = true; }
          else g.lineTo(pt.x, pt.y);
        }
      }
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
  }

  private drawHUD(g: CanvasRenderingContext2D, _globe: Globe): void {
    const remaining = Math.max(0, GAME_DURATION_S - this.elapsed);
    drawTimerBar(g, GAME_WIDTH, remaining, GAME_DURATION_S);

    g.font = "700 28px Bebas Neue, Impact, sans-serif";
    g.textAlign = "right";
    g.fillStyle = remaining < 10 ? "#FF3D7A" : "#94a3b8";
    g.fillText(`${Math.ceil(remaining)}`, GAME_WIDTH - 18, 34);
    g.font = "400 11px Outfit, sans-serif";
    g.fillText("sec", GAME_WIDTH - 18, 48);

    const sorted = [...this.ctx.players].sort((a, b) => {
      return this.playerStates.get(b.id)!.score - this.playerStates.get(a.id)!.score;
    });

    const panelX = 830;
    const panelW = 430;
    g.fillStyle = "rgba(3,8,16,0.75)";
    g.beginPath();
    g.roundRect(panelX, 70, panelW, sorted.length * 56 + 16, 12);
    g.fill();

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!;
      const state = this.playerStates.get(p.id)!;
      const y = 92 + i * 56;

      g.beginPath();
      g.arc(panelX + 24, y + 14, 6, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.fill();

      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "left";
      g.fillStyle = "#e2e8f0";
      g.fillText(p.name, panelX + 38, y + 10);

      if (state.multiplier > 1) {
        g.font = "700 12px Outfit, sans-serif";
        g.fillStyle = state.multiplier >= 4 ? "#FF3D7A" : state.multiplier >= 3 ? "#FFB020" : "#3EE0FF";
        g.fillText(`x${state.multiplier}`, panelX + 38 + g.measureText(p.name).width + 8, y + 10);
      }

      g.font = "700 28px Bebas Neue, Impact, sans-serif";
      g.textAlign = "right";
      g.fillStyle = p.color;
      g.fillText(String(state.displayScore), panelX + panelW - 20, y + 18);

      if (state.streak > 0) {
        const barW = Math.min(panelW - 60, (state.streak % STREAK_THRESHOLD) / STREAK_THRESHOLD * (panelW - 60));
        const nextMult = Math.min(4, state.multiplier + 1);
        g.fillStyle = state.multiplier >= 4 ? "rgba(255,61,122,0.25)" : "rgba(62,224,255,0.15)";
        g.fillRect(panelX + 38, y + 30, barW, 3);
        if (state.multiplier < 4) {
          g.font = "400 9px Outfit, sans-serif";
          g.textAlign = "left";
          g.fillStyle = "rgba(148,163,184,0.5)";
          g.fillText(`→ x${nextMult}`, panelX + 42 + barW, y + 34);
        }
      }
    }

    g.font = "600 10px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    let lx = 14;
    const ly = GAME_HEIGHT - 22;
    for (const t of SHIP_TYPES) {
      g.beginPath();
      g.arc(lx + 4, ly + 4, 3, 0, Math.PI * 2);
      g.fillStyle = t.color;
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.4)";
      const label = `${t.label} ${t.points}`;
      g.fillText(label, lx + 10, ly);
      lx += g.measureText(label).width + 22;
    }

    const human = this.ctx.players.find((p) => p.kind === "human");
    if (human) {
      const hState = this.playerStates.get(human.id)!;
      if (!hState.parked) {
        const promptY = Math.min(GLOBE_CY + this.globeRadius + 16, GAME_HEIGHT - 50);
        g.fillStyle = "rgba(3,8,16,0.6)";
        g.beginPath();
        g.roundRect(GLOBE_CX - 170, promptY, 340, 40, 8);
        g.fill();
        g.font = "600 14px Outfit, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "#94a3b8";
        g.fillText("Click anywhere on the globe to drop anchor", GLOBE_CX, promptY + 20);
      } else if (hState.reparks > 0) {
        g.font = "400 11px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillStyle = "rgba(148,163,184,0.5)";
        g.fillText(`${hState.reparks} repark${hState.reparks > 1 ? "s" : ""} left`, GLOBE_CX, GAME_HEIGHT - 8);
      }
    }

    // Zoom level indicator
    if (this.globeRadius !== GLOBE_R_DEFAULT) {
      const zoomPct = Math.round((this.globeRadius / GLOBE_R_DEFAULT) * 100);
      g.font = "600 11px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = "rgba(148,163,184,0.6)";
      g.fillText(`Zoom ${zoomPct}%`, 14, 14);
    }

    // Gold rush indicator
    if (this.goldRush) {
      const rushY = 56;
      const pulse = 0.7 + Math.sin(this.elapsed * 6) * 0.3;
      g.globalAlpha = pulse;
      g.fillStyle = "#fbbf24";
      g.font = "700 13px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(`GOLD RUSH! Lane ${this.goldRush.laneIdx + 1} (${Math.ceil(this.goldRush.remaining)}s)`, GLOBE_CX, rushY);
      g.globalAlpha = 1;
    }
  }

  private drawPopups(g: CanvasRenderingContext2D): void {
    for (const p of this.popups) {
      const t = 1 - p.life / 0.7;
      g.globalAlpha = Math.min(1, p.life / 0.2);
      g.font = "700 16px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, p.y - t * 28);
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

  destroy(): void {
    this.ctx.canvas.removeEventListener("wheel", this.wheelHandler);
  }
}
