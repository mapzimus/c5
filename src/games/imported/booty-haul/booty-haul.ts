import { GAME_HEIGHT, GAME_WIDTH, type GameContext, type GameDefinition, type GameInstance, type GameStat, type Player } from "../../../core/types";
import { PLAYER_BINDS } from "../../../core/input";
import { Callouts, Juice, saveBest } from "../../../fx/juice";
import { drawTimerBar } from "../../../core/draw";
import { buildLanes, DOORS, globeProject, globeRangeCircle, globeUnproject, haversineKm, lanePos, makeGlobe, type Door, type Globe, type Lane, type LatLng } from "./geo";
import { LAND } from "./land";
import {
  advanceShips,
  botPickSpot,
  FLEET_SIZE,
  GAME_DURATION_S,
  REPARK_COUNT,
  respawnShip,
  scoreShipsInRange,
  shipPos,
  SHIP_SPEED_KM_S,
  SHIP_TYPES,
  SPOT_RANGE_KM,
  spawnFleet,
  spawnConvoyPack,
  maybeStartGoldRush,
  spawnGoldRushShips,
  STREAK_THRESHOLD,
  type Ship,
  type GoldRush,
} from "./rules";
import {
  advanceGhost,
  assignPersonas,
  bark,
  type BarkKey,
  BOARD_RANGE_KM,
  BOARD_SHIELD_S,
  boardingSteal,
  botBoardTarget,
  canStartEvent,
  type Chest,
  collectChests,
  cursedRaid,
  EVENT_DURATION_S,
  type EventKind,
  FINAL_STRETCH_S,
  findBoardingVictim,
  FIRST_EVENT_S,
  type GhostShip,
  ghostClaimant,
  ghostPos,
  GHOST_SPEED_MULT,
  GHOST_VALUE,
  inFinalStretch,
  inRadius,
  KRAKEN_RADIUS_KM,
  KRAKEN_WARN_S,
  krakenTarget,
  krakenToll,
  krakenVictims,
  nextEventGap,
  type Anchorage,
  type Persona,
  pickEvent,
  REVENGE_WINDOW_S,
  spawnChests,
  spawnGhost,
  stretchMultiplier,
  wantedId,
} from "./chaos";

const GAME_ID = "booty-haul";
const GLOBE_CX = 480;
const GLOBE_CY = 340;
const GLOBE_R_DEFAULT = 300;
const GLOBE_R_MIN = 200;
const GLOBE_R_MAX = 500;
const SPIN_SPEED = 8;
const MOVE_RECHARGE_S = 6;

const RAID_BTN = { x: 850, y: 368, w: 380, h: 92 } as const;
const HELM_Y = 470;
const HELM_H = 48;
const LOG_Y = 532;

const EVENT_STYLE: Record<EventKind, { label: string; color: string }> = {
  kraken: { label: "KRAKEN!", color: "#FF3D7A" },
  "treasure-rain": { label: "TREASURE RAIN!", color: "#FFB020" },
  "ghost-ship": { label: "GHOST SHIP!", color: "#7CFFCB" },
  "cursed-gold": { label: "CURSED GOLD!", color: "#C084FC" },
};

export const bootyHaul: GameDefinition = {
  id: GAME_ID,
  name: "Booty Haul",
  tagline: "Drop anchor, rob your mates, dodge the kraken. 75 seconds of piracy.",
  description:
    "Tap the globe to drop anchor. Every vessel within 200 km pays out: cargo 2, tanker 5, treasure 15, convoy 30, and streaks multiply it up to x4. " +
    "Drop anchor ON a rival to BOARD them and steal 12% of their booty (25% if they're WANTED for leading by a mile, and extra if it's revenge). " +
    "Raid on the gold flash for a burst. Every ~10s the sea goes mad: a kraken surfaces next to the leader, treasure rains from the sky, a ghost ship worth 150 races past, or cursed gold makes raids triple-or-nothing. " +
    "The last 15 seconds are LAST CALL: everything pays double. Moves recharge every six seconds.",
  durationMs: GAME_DURATION_S * 1000,
  controls: "Tap/click the globe to anchor (tap a rival to board) · RAID button or your action key (Space / Enter / R-Shift / Y) · Tap your helm button or Tab to switch captain · 1–9 landmarks · Scroll/pinch zoom",
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
  moveCharge: number;
  raidCooldown: number;
  shield: number;
  lastBoardedBy: string | null;
  lastBoardedAt: number;
  bubble: { text: string; life: number } | null;
  stolen: number;
  boards: number;
  lost: number;
  loot: number;
}

interface BotBrain {
  persona: Persona;
  think: number;
  firstPark: number;
  willRaid: boolean;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
}

interface SeaEvent {
  kind: EventKind;
  t: number;
  dur: number;
  center: LatLng;
  struck: boolean;
}

interface LogLine {
  text: string;
  color: string;
  age: number;
}

interface BoardFx {
  from: LatLng;
  to: LatLng;
  color: string;
  life: number;
}

class ParkYourPirateGame implements GameInstance {
  private readonly lanes: Lane[];
  private readonly ships: Ship[];
  private readonly playerStates: Map<string, PlayerState> = new Map();
  private readonly brains: Map<string, BotBrain> = new Map();
  private readonly juice: Juice;
  private readonly callouts: Callouts;
  private popups: ScorePopup[] = [];
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
  private activeHumanIdx = 0;
  private event: SeaEvent | null = null;
  private lastEvent: EventKind | null = null;
  private nextEventAt = FIRST_EVENT_S;
  private chests: Chest[] = [];
  private ghost: GhostShip | null = null;
  private ghostTrail: LatLng[] = [];
  private sunk: Ship[] = [];
  private wanted: string | null = null;
  private lastCallShown = false;
  private lastCountdown = -1;
  private log: LogLine[] = [];
  private boardFx: BoardFx[] = [];
  private flash = { color: "#fff", life: 0 };
  private readonly wheelHandler: (e: WheelEvent) => void;
  private readonly touchStartHandler: (e: TouchEvent) => void;
  private readonly touchMoveHandler: (e: TouchEvent) => void;
  private pinchDist = 0;

  constructor(private readonly ctx: GameContext) {
    this.lanes = buildLanes();
    this.ships = spawnFleet(ctx.rng, this.lanes, FLEET_SIZE);
    this.juice = new Juice(() => ctx.rng.next());
    this.callouts = new Callouts();

    for (let i = 0; i < 3; i++) {
      this.ships.push(...spawnConvoyPack(ctx.rng, this.lanes));
    }

    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * 20;
      this.globeRadius = Math.max(GLOBE_R_MIN, Math.min(GLOBE_R_MAX, this.globeRadius + delta));
    };
    ctx.canvas.addEventListener("wheel", this.wheelHandler, { passive: false });

    this.touchStartHandler = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
        const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
        this.pinchDist = Math.hypot(dx, dy);
      }
    };
    this.touchMoveHandler = (e: TouchEvent) => {
      if (e.touches.length === 2 && this.pinchDist > 0) {
        e.preventDefault();
        const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
        const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
        const dist = Math.hypot(dx, dy);
        const delta = (dist - this.pinchDist) * 0.8;
        this.globeRadius = Math.max(GLOBE_R_MIN, Math.min(GLOBE_R_MAX, this.globeRadius + delta));
        this.pinchDist = dist;
      }
    };
    ctx.canvas.addEventListener("touchstart", this.touchStartHandler, { passive: true });
    ctx.canvas.addEventListener("touchmove", this.touchMoveHandler, { passive: false });

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
        reparks: REPARK_COUNT, streak: 0, multiplier: 1, dryTicks: 0, moveCharge: 0, raidCooldown: 0,
        shield: 0, lastBoardedBy: null, lastBoardedAt: -99, bubble: null,
        stolen: 0, boards: 0, lost: 0, loot: 0,
      });
    }
    const bots = ctx.players.filter((p) => p.kind === "bot");
    const personas = assignPersonas(ctx.rng, bots.length);
    bots.forEach((p, i) => {
      this.brains.set(p.id, { persona: personas[i]!, think: 1 + ctx.rng.next(), firstPark: 0.8 + ctx.rng.next() * 1.5, willRaid: true });
    });

    this.addLog("Hoist the colours! Tap the globe to drop anchor.", "#94a3b8");
    ctx.sfx.countdown();
  }

  private globe(): Globe {
    return makeGlobe(GLOBE_CX, GLOBE_CY, this.globeRadius, this.camLat, this.camLng);
  }

  private player(id: string): Player | undefined {
    return this.ctx.players.find((p) => p.id === id);
  }

  private anchorages(): Anchorage[] {
    return this.ctx.players.map((p) => {
      const s = this.playerStates.get(p.id)!;
      return { id: p.id, parked: s.parked, ll: s.ll, score: s.score, shield: s.shield };
    });
  }

  private addLog(text: string, color: string): void {
    this.log.unshift({ text, color, age: 0 });
    if (this.log.length > 5) this.log.length = 5;
  }

  private say(id: string, key: BarkKey, a = "", b = ""): void {
    const s = this.playerStates.get(id);
    if (s) s.bubble = { text: bark(this.ctx.rng, key, a, b), life: 2.2 };
  }

  private popupAt(ll: LatLng, text: string, color: string, size = 18): void {
    const p = globeProject(ll, this.globe());
    if (p.z > 0) this.popups.push({ x: p.x, y: p.y - 24, text, color, life: 0.9, size });
  }

  update(dt: number): void {
    if (this.done) return;
    const gdt = this.juice.update(dt);
    this.callouts.update(dt);
    this.elapsed += gdt;

    for (const p of this.popups) p.life -= dt;
    this.popups = this.popups.filter((p) => p.life > 0);
    for (const l of this.log) l.age += dt;
    for (const f of this.boardFx) f.life -= dt;
    this.boardFx = this.boardFx.filter((f) => f.life > 0);
    this.flash.life = Math.max(0, this.flash.life - dt);

    advanceShips(this.ships, this.lanes, gdt, this.ctx.rng);

    const anyParked = [...this.playerStates.values()].some((s) => s.parked);
    if (!anyParked) {
      this.camLng += SPIN_SPEED * gdt;
      this.targetLng = this.camLng;
    } else {
      this.camLat += (this.targetLat - this.camLat) * Math.min(1, dt * 3);
      this.camLng += (this.targetLng - this.camLng) * Math.min(1, dt * 3);
    }

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

    this.updateEvent(gdt);

    for (const [, state] of this.playerStates) {
      state.raidCooldown = Math.max(0, state.raidCooldown - gdt);
      state.shield = Math.max(0, state.shield - gdt);
      if (state.bubble) {
        state.bubble.life -= dt;
        if (state.bubble.life <= 0) state.bubble = null;
      }
      if (state.reparks < REPARK_COUNT) {
        state.moveCharge += gdt;
        if (state.moveCharge >= MOVE_RECHARGE_S) { state.reparks++; state.moveCharge -= MOVE_RECHARGE_S; }
      } else state.moveCharge = 0;
      const diff = state.score - state.displayScore;
      if (diff !== 0) {
        const step = Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 8)));
        state.displayScore = Math.abs(step) >= Math.abs(diff) ? state.score : state.displayScore + step;
      }
    }

    this.updateWanted();
    this.updateFinalStretch();

    this.handleInput();
    this.handleBots(gdt);

    if (this.elapsed >= GAME_DURATION_S) {
      this.done = true;
      this.checkBest();
      this.ctx.sfx.win();
    }
  }

  // ---- scoring -------------------------------------------------------------

  private scoreAllPlayers(): void {
    const globe = this.globe();
    const stretch = stretchMultiplier(this.elapsed);
    for (const [id, state] of this.playerStates) {
      if (!state.parked) continue;
      const raw = scoreShipsInRange(this.ships, state.ll, this.lanes);
      if (raw > 0) {
        state.streak++;
        state.dryTicks = 0;
        state.multiplier = Math.min(4, 1 + Math.floor(state.streak / STREAK_THRESHOLD));
        const pts = raw * state.multiplier * stretch;
        state.score += pts;
        const p = globeProject(state.ll, globe);
        if (p.z > 0) {
          const player = this.player(id);
          const label = state.multiplier * stretch > 1 ? `+${pts} x${state.multiplier * stretch}` : `+${pts}`;
          this.popups.push({ x: p.x, y: p.y - 24, text: label, color: player?.color ?? "#fff", life: 0.7, size: 16 });
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
          this.callouts.show(`${this.player(id)?.name ?? ""} MAX x4`.trim(), "#FF3D7A", { life: 0.8, size: 52 });
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

  private raid(playerId: string): void {
    const state = this.playerStates.get(playerId)!;
    if (!state.parked || state.raidCooldown > 0) return;
    const player = this.player(playerId);
    const raw = scoreShipsInRange(this.ships, state.ll, this.lanes);
    if (raw === 0) {
      if (player?.kind === "human") this.callouts.show("NO SHIPS IN RANGE — CHASE THE LANES", "#94a3b8", { size: 30 });
      return;
    }
    const perfect = this.elapsed % 4 < 1;
    const base = raw * state.multiplier * (perfect ? 8 : 4) * stretchMultiplier(this.elapsed);
    let points = base;
    let cursed = false;
    if (this.event?.kind === "cursed-gold") {
      const res = cursedRaid(this.ctx.rng, base);
      cursed = res.cursed;
      points = cursed ? -Math.min(state.score, base) : res.delta;
    }
    state.score = Math.max(0, state.score + points);
    state.raidCooldown = 3;
    const p = globeProject(state.ll, this.globe());
    const color = player?.color ?? "#fff";
    const name = player?.name ?? "";
    if (cursed) {
      state.lost += -points;
      this.juice.burst(p.x, p.y, ["#C084FC", "#6b21a8", "#e9d5ff"], { count: 40, speed: 300, gravity: 300 });
      this.juice.shake(0.45);
      this.ctx.sfx.hit();
      this.flash = { color: "#7e22ce", life: 0.35 };
      this.callouts.show(`CURSED! ${name} ${points}`, "#C084FC", { size: 46, life: 1 });
      this.addLog(bark(this.ctx.rng, "curseHit", name), "#C084FC");
      this.say(playerId, "boarded");
      return;
    }
    state.loot += points;
    this.juice.burst(p.x, p.y, [color, "#fbbf24"], { count: 32, speed: 260, gravity: 0 });
    this.juice.shake(perfect ? 0.35 : 0.15);
    this.ctx.sfx.streak(perfect ? 3 : 1);
    if (this.event?.kind === "cursed-gold") {
      this.callouts.show(`${name} BEATS THE CURSE +${points}`, "#C084FC", { size: 40, life: 0.9 });
      this.addLog(bark(this.ctx.rng, "curseWin", name), "#C084FC");
    } else {
      this.callouts.show(`${perfect ? "PERFECT RAID" : "RAID"} +${points}`, color, { size: 44, life: 0.8 });
    }
    if (perfect && this.ctx.rng.next() < 0.35) this.say(playerId, "raid");
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
    const player = this.player(playerId);
    if (player?.kind === "human") {
      this.targetLat = ll[0];
      this.targetLng = ll[1];
    }
    this.ctx.sfx.go();
    this.juice.shake(0.3);
    this.juice.hitStop(0.06);
    const p = globeProject(ll, this.globe());
    this.juice.burst(p.x, p.y, player?.color ?? "#fff", { count: 20, speed: 220, life: 0.6, gravity: 200 });

    const victim = findBoardingVictim(playerId, ll, this.anchorages());
    if (victim) this.board(playerId, victim.id);
  }

  // ---- boarding ------------------------------------------------------------

  private board(boarderId: string, victimId: string): void {
    const bs = this.playerStates.get(boarderId)!;
    const vs = this.playerStates.get(victimId)!;
    const boarder = this.player(boarderId)!;
    const victim = this.player(victimId)!;
    const isWanted = victimId === this.wanted;
    const revenge = bs.lastBoardedBy === victimId && this.elapsed - bs.lastBoardedAt < REVENGE_WINDOW_S;
    const steal = boardingSteal(vs.score, isWanted, revenge);

    vs.score -= steal;
    vs.lost += steal;
    bs.score += steal;
    bs.stolen += steal;
    bs.boards++;
    vs.streak = 0;
    vs.multiplier = 1;
    vs.dryTicks = 0;
    vs.shield = BOARD_SHIELD_S;
    vs.reparks = Math.min(REPARK_COUNT, vs.reparks + 1);
    vs.lastBoardedBy = boarderId;
    vs.lastBoardedAt = this.elapsed;
    if (revenge) bs.lastBoardedBy = null;

    const globe = this.globe();
    const from = globeProject(vs.ll, globe);
    const to = globeProject(bs.ll, globe);
    this.boardFx.push({ from: vs.ll, to: bs.ll, color: boarder.color, life: 0.8 });
    const ang = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI;
    this.juice.burst(from.x, from.y, ["#fbbf24", "#fde68a", boarder.color], { count: steal > 0 ? 46 : 14, speed: 360, angle: ang, spread: 2.4, gravity: 260, size: 5 });
    this.juice.shake(0.5);
    this.juice.hitStop(0.08);
    this.juice.slowMo(0.5, 0.35);
    this.ctx.sfx.hit();
    this.ctx.sfx.collect();
    this.flash = { color: boarder.color, life: 0.25 };

    if (steal > 0) {
      this.popupAt(vs.ll, `-${steal}`, "#FF3D7A", 24);
      const title = revenge ? "REVENGE!" : isWanted ? "BOUNTY CLAIMED!" : "BOARDED!";
      this.callouts.show(`${title} ${boarder.name} +${steal}`, boarder.color, { size: 50, life: 1.3, y: 0.24 });
      this.addLog(bark(this.ctx.rng, revenge ? "revenge" : "board", boarder.name, victim.name), boarder.color);
      this.say(victimId, "boarded");
    } else {
      this.callouts.show("EMPTY HOLD!", "#94a3b8", { size: 44, life: 1, y: 0.24 });
      this.addLog(bark(this.ctx.rng, "empty", boarder.name, victim.name), "#94a3b8");
    }
  }

  private updateWanted(): void {
    const next = wantedId(this.ctx.players.map((p) => ({ id: p.id, score: this.playerStates.get(p.id)!.score })));
    if (next !== this.wanted) {
      this.wanted = next;
      if (next) {
        const name = this.player(next)?.name ?? "";
        this.callouts.show(`${name} IS WANTED!`, "#FF3D7A", { size: 40, life: 1.1, y: 0.16 });
        this.addLog(bark(this.ctx.rng, "wanted", name), "#FF3D7A");
        this.ctx.sfx.select();
      }
    }
  }

  private updateFinalStretch(): void {
    if (inFinalStretch(this.elapsed) && !this.lastCallShown) {
      this.lastCallShown = true;
      this.callouts.show("LAST CALL! DOUBLE BOOTY!", "#FFB020", { size: 66, life: 1.8, y: 0.3 });
      this.addLog(bark(this.ctx.rng, "lastCall"), "#FFB020");
      this.juice.shake(0.4);
      this.ctx.sfx.go();
      this.flash = { color: "#FFB020", life: 0.4 };
    }
    const remaining = GAME_DURATION_S - this.elapsed;
    const sec = Math.ceil(remaining);
    if (remaining <= 5 && remaining > 0 && sec !== this.lastCountdown) {
      this.lastCountdown = sec;
      this.ctx.sfx.countdown();
      this.callouts.show(String(sec), sec <= 3 ? "#FF3D7A" : "#F4F7FB", { size: 110, life: 0.9, y: 0.5 });
      this.juice.shake(0.08 * (6 - sec));
    }
  }

  // ---- sea events ----------------------------------------------------------

  private updateEvent(gdt: number): void {
    if (!this.event && this.elapsed >= this.nextEventAt && canStartEvent(this.elapsed)) {
      this.startEvent(pickEvent(this.ctx.rng, this.lastEvent));
    }
    const ev = this.event;
    if (!ev) return;
    ev.t += gdt;
    const stretch = stretchMultiplier(this.elapsed);

    if (ev.kind === "kraken" && !ev.struck && ev.t >= KRAKEN_WARN_S) {
      ev.struck = true;
      this.krakenStrike(ev.center);
    }
    if (ev.kind === "treasure-rain") {
      for (const c of this.chests) c.age += gdt;
      for (const { chest, playerId } of collectChests(this.chests, this.anchorages())) {
        const s = this.playerStates.get(playerId)!;
        const player = this.player(playerId)!;
        const value = chest.value * stretch;
        s.score += value;
        s.loot += value;
        const p = globeProject(chest.ll, this.globe());
        this.juice.burst(p.x, p.y, ["#fbbf24", "#fde68a", "#fff7cc"], { count: 36, speed: 280, gravity: 120 });
        this.popupAt(chest.ll, `+${value}`, "#FFB020", 26);
        this.ctx.sfx.collect();
        this.juice.shake(0.2);
        if (chest.value >= 100) {
          this.callouts.show(`MEGA CHEST! ${player.name} +${value}`, "#FFB020", { size: 48, life: 1.1, y: 0.24 });
          this.addLog(`${player.name} hauls the MEGA chest!`, player.color);
        } else {
          this.addLog(`${player.name} snags a chest (+${value})`, player.color);
        }
      }
      if (this.chests.every((c) => !c.alive)) ev.t = Math.max(ev.t, ev.dur);
    }
    if (ev.kind === "ghost-ship" && this.ghost?.alive) {
      advanceGhost(this.ghost, this.lanes, gdt);
      const gp = ghostPos(this.ghost, this.lanes);
      this.ghostTrail.unshift(gp);
      if (this.ghostTrail.length > 14) this.ghostTrail.length = 14;
      const claimant = ghostClaimant(gp, this.anchorages());
      if (claimant) {
        const s = this.playerStates.get(claimant)!;
        const player = this.player(claimant)!;
        const value = GHOST_VALUE * stretch;
        s.score += value;
        s.loot += value;
        this.ghost.alive = false;
        const p = globeProject(gp, this.globe());
        this.juice.burst(p.x, p.y, ["#7CFFCB", "#e0fff4", "#fbbf24"], { count: 60, speed: 340, gravity: 80, size: 5 });
        this.juice.shake(0.5);
        this.juice.slowMo(0.6, 0.3);
        this.ctx.sfx.win();
        this.popupAt(gp, `+${value}`, "#7CFFCB", 28);
        this.callouts.show(`${player.name} PLUNDERS THE GHOST! +${value}`, "#7CFFCB", { size: 46, life: 1.4, y: 0.24 });
        this.addLog(`${player.name} robbed a ghost. Spooky rich!`, player.color);
        this.say(claimant, "raid");
        ev.t = Math.max(ev.t, ev.dur);
      }
    }
    if (ev.t >= ev.dur) this.endEvent();
  }

  private startEvent(kind: EventKind): void {
    const style = EVENT_STYLE[kind];
    const near: LatLng = [this.camLat, this.camLng];
    this.event = { kind, t: 0, dur: EVENT_DURATION_S[kind], center: near, struck: false };
    this.lastEvent = kind;
    this.callouts.show(style.label, style.color, { size: 72, life: 1.5, y: 0.3 });
    this.flash = { color: style.color, life: 0.3 };
    if (kind === "kraken") {
      const center = krakenTarget(this.ctx.rng, this.anchorages(), this.wanted, near);
      this.event.center = center;
      let nearest: Player | null = null;
      let best = Infinity;
      for (const p of this.ctx.players) {
        const s = this.playerStates.get(p.id)!;
        if (!s.parked) continue;
        const km = haversineKm(s.ll, center);
        if (km < best) { best = km; nearest = p; }
      }
      this.addLog(bark(this.ctx.rng, "kraken", nearest?.name ?? "someone"), style.color);
      this.ctx.sfx.hit();
      this.juice.shake(0.25);
    } else if (kind === "treasure-rain") {
      this.chests = spawnChests(this.ctx.rng, this.lanes, 5, near);
      this.addLog(bark(this.ctx.rng, "chest"), style.color);
      this.ctx.sfx.win();
    } else if (kind === "ghost-ship") {
      this.ghost = spawnGhost(this.ctx.rng, this.lanes, near);
      this.ghostTrail = [];
      this.addLog(bark(this.ctx.rng, "ghost"), style.color);
      this.ctx.sfx.whoosh();
    } else {
      this.addLog(bark(this.ctx.rng, "cursed"), style.color);
      this.ctx.sfx.countdown();
    }
  }

  private endEvent(): void {
    const ev = this.event;
    if (!ev) return;
    if (ev.kind === "ghost-ship" && this.ghost?.alive) this.addLog(bark(this.ctx.rng, "ghostGone"), "#7CFFCB");
    for (const ship of this.sunk) respawnShip(ship, this.ctx.rng, this.lanes);
    this.sunk = [];
    this.chests = [];
    this.ghost = null;
    this.ghostTrail = [];
    this.event = null;
    this.nextEventAt = this.elapsed + nextEventGap(this.ctx.rng);
  }

  private krakenStrike(center: LatLng): void {
    const victims = krakenVictims(center, this.anchorages());
    for (const v of victims) {
      const s = this.playerStates.get(v.id)!;
      const toll = krakenToll(s.score);
      s.score -= toll;
      s.lost += toll;
      s.streak = 0;
      s.multiplier = 1;
      s.dryTicks = 0;
      this.popupAt(s.ll, toll > 0 ? `-${toll}` : "SPLASH", "#FF3D7A", 26);
      this.say(v.id, "boarded");
      this.addLog(bark(this.ctx.rng, "krakenHit", this.player(v.id)?.name ?? ""), "#FF3D7A");
    }
    for (const ship of this.ships) {
      if (ship.alive && inRadius(shipPos(ship, this.lanes), center, KRAKEN_RADIUS_KM * 0.6)) {
        ship.alive = false;
        this.sunk.push(ship);
      }
    }
    const p = globeProject(center, this.globe());
    this.juice.burst(p.x, p.y, ["#a855f7", "#38bdf8", "#e0f2fe", "#FF3D7A"], { count: 70, speed: 380, gravity: 400, size: 6 });
    this.juice.shake(victims.length > 0 ? 0.8 : 0.45);
    this.juice.hitStop(0.1);
    this.juice.slowMo(0.7, 0.3);
    this.ctx.sfx.hit();
    this.flash = { color: "#FF3D7A", life: 0.4 };
    if (victims.length > 0) {
      this.callouts.show("KRAKEN STRIKES!", "#FF3D7A", { size: 64, life: 1.3, y: 0.3 });
    } else {
      this.callouts.show("KRAKEN MISSED!", "#94a3b8", { size: 54, life: 1.1, y: 0.3 });
      this.addLog(bark(this.ctx.rng, "krakenMiss"), "#94a3b8");
    }
  }

  // ---- input -----------------------------------------------------------------

  private humans(): Player[] {
    return this.ctx.players.filter((p) => p.kind === "human");
  }

  private helmRect(i: number, n: number): { x: number; y: number; w: number; h: number } {
    const gap = 8;
    const w = (RAID_BTN.w - gap * (n - 1)) / n;
    return { x: RAID_BTN.x + i * (w + gap), y: HELM_Y, w, h: HELM_H };
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

    const humans = this.humans();
    if (humans.length === 0) return;

    // Each human's own action key raids for them (Space, Enter, R-Shift, Y).
    for (const h of humans) {
      const key = PLAYER_BINDS[h.slot]?.action;
      if (key && input.justPressed(key)) this.raid(h.id);
    }

    if (humans.length > 1 && input.justPressed("Tab")) {
      this.activeHumanIdx = (this.activeHumanIdx + 1) % humans.length;
      this.ctx.sfx.select();
    }
    if (this.activeHumanIdx >= humans.length) this.activeHumanIdx = 0;

    if (click && humans.length > 1) {
      for (let i = 0; i < humans.length; i++) {
        const r = this.helmRect(i, humans.length);
        if (click.x >= r.x && click.x <= r.x + r.w && click.y >= r.y - 4 && click.y <= r.y + r.h + 4) {
          this.activeHumanIdx = i;
          this.ctx.sfx.select();
          return;
        }
      }
    }
    const human = humans[this.activeHumanIdx]!;

    for (let i = 0; i < DOORS.length && i < 9; i++) {
      if (input.justPressed(`Digit${i + 1}`)) {
        this.park(human.id, DOORS[i]!.ll);
        return;
      }
    }

    if (click && click.x >= RAID_BTN.x && click.x <= RAID_BTN.x + RAID_BTN.w && click.y >= RAID_BTN.y && click.y <= RAID_BTN.y + RAID_BTN.h) {
      this.raid(human.id);
      return;
    }
    if (click) {
      // Tapping right on a rival's anchor snaps to it so boarding is easy on a phone.
      for (const p of this.ctx.players) {
        if (p.id === human.id) continue;
        const s = this.playerStates.get(p.id)!;
        if (!s.parked) continue;
        const pp = globeProject(s.ll, globe);
        if (pp.z > 0 && Math.hypot(click.x - pp.x, click.y - pp.y) < Math.max(22, this.ctx.minTap / 2)) {
          this.park(human.id, s.ll);
          return;
        }
      }
      const ll = globeUnproject(click.x, click.y, globe);
      if (ll) this.park(human.id, ll);
    }
  }

  // ---- bots ------------------------------------------------------------------

  private botSpot(selfId: string, avoid: LatLng | null): LatLng {
    const taken = [...this.playerStates.entries()]
      .filter(([id, s]) => s.parked && id !== selfId)
      .map(([, s]) => ({ ll: s.ll, parked: true, score: s.score }));
    let spot = botPickSpot(this.ctx.rng, this.ships, this.lanes, DOORS, taken, BOARD_RANGE_KM + 20);
    for (let i = 0; i < 4 && avoid && inRadius(spot, avoid, KRAKEN_RADIUS_KM + 80); i++) {
      spot = botPickSpot(this.ctx.rng, this.ships, this.lanes, DOORS, taken, BOARD_RANGE_KM + 20);
    }
    return spot;
  }

  private handleBots(dt: number): void {
    const rng = this.ctx.rng;
    for (const p of this.ctx.players) {
      if (p.kind !== "bot") continue;
      const state = this.playerStates.get(p.id)!;
      const brain = this.brains.get(p.id)!;
      const persona = brain.persona;

      if (!state.parked) {
        if (this.elapsed > brain.firstPark) this.park(p.id, this.botSpot(p.id, null));
        continue;
      }

      const beatPhase = this.elapsed % 4;
      if (brain.willRaid && beatPhase < 1.4 && rng.next() < 0.35) this.raid(p.id);

      brain.think -= dt;
      if (brain.think > 0) continue;
      brain.think = persona.think * (0.7 + rng.next() * 0.6);
      brain.willRaid = this.event?.kind !== "cursed-gold" || rng.next() < persona.gamble;
      if (state.reparks <= 0) continue;

      const ev = this.event;
      if (ev?.kind === "kraken" && !ev.struck && inRadius(state.ll, ev.center, KRAKEN_RADIUS_KM + 60)) {
        if (rng.next() < persona.flee) {
          this.park(p.id, this.botSpot(p.id, ev.center));
          this.say(p.id, "flee");
        }
        continue;
      }
      const liveChests = this.chests.filter((c) => c.alive);
      if (liveChests.length > 0 && rng.next() < persona.chase) {
        const target = liveChests.reduce((best, c) =>
          haversineKm(c.ll, state.ll) < haversineKm(best.ll, state.ll) ? c : best);
        this.park(p.id, target.ll);
        continue;
      }
      if (this.ghost?.alive && rng.next() < persona.chase * 0.7) {
        // Lead the target: anchor where the ghost will be in ~1.5s.
        const lane = this.lanes[this.ghost.laneIdx]!;
        const ahead = this.ghost.km + this.ghost.dir * SHIP_SPEED_KM_S * GHOST_SPEED_MULT * 1.5;
        this.park(p.id, lanePos(lane, Math.max(0, Math.min(lane.lengthKm, ahead))));
        continue;
      }
      const boardOdds = persona.board * (this.wanted && this.wanted !== p.id ? 1.8 : 1);
      if (this.elapsed > 5 && rng.next() < boardOdds) {
        const target = botBoardTarget(p.id, this.anchorages(), this.wanted);
        if (target) {
          this.park(p.id, target.ll);
          continue;
        }
      }
      if (this.elapsed > GAME_DURATION_S * 0.4 && rng.next() < 0.1) {
        this.park(p.id, this.botSpot(p.id, null));
      }
    }
  }

  private checkBest(): void {
    const humanScores = this.humans().map((p) => this.playerStates.get(p.id)!.score);
    const topScore = Math.max(0, ...humanScores);
    if (saveBest(GAME_ID, topScore)) {
      this.callouts.show("NEW BEST!", "#FFB020", { life: 2 });
    }
  }

  // ---- render ----------------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const globe = this.globe();
    this.drawBackground(g);
    this.juice.begin(g);
    this.drawGlobe(g, globe);
    this.drawBoardFx(g, globe);
    this.juice.end(g);
    this.drawBubbles(g, globe);
    this.drawOverlay(g);
    this.drawHUD(g);
    this.drawPopups(g);
    this.callouts.draw(g, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawBackground(g: CanvasRenderingContext2D): void {
    g.fillStyle = this.event?.kind === "cursed-gold" ? "#0d0618" : "#030810";
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
    const cursed = this.event?.kind === "cursed-gold";
    atmo.addColorStop(0, cursed ? "rgba(168,85,247,0.25)" : "rgba(56,130,220,0.12)");
    atmo.addColorStop(1, "rgba(56,130,220,0)");
    g.fillStyle = atmo;
    g.fillRect(GLOBE_CX - R * 1.2, GLOBE_CY - R * 1.2, R * 2.4, R * 2.4);

    g.save();
    g.beginPath();
    g.arc(GLOBE_CX, GLOBE_CY, R, 0, Math.PI * 2);
    g.clip();

    const ocean = g.createRadialGradient(GLOBE_CX - 60, GLOBE_CY - 80, 0, GLOBE_CX, GLOBE_CY, R);
    ocean.addColorStop(0, cursed ? "#2a1450" : "#0f2847");
    ocean.addColorStop(1, cursed ? "#120726" : "#071428");
    g.fillStyle = ocean;
    g.fillRect(GLOBE_CX - R, GLOBE_CY - R, R * 2, R * 2);

    this.drawGraticulesClipped(g, globe);
    this.drawLandClipped(g, globe);
    this.drawLanesClipped(g, globe);
    this.drawDoorsClipped(g, globe);
    this.drawShipsClipped(g, globe);
    this.drawEventClipped(g, globe);
    this.drawRangeRingsClipped(g, globe);
    this.drawPlayersClipped(g, globe);

    g.restore();

    g.beginPath();
    g.arc(GLOBE_CX, GLOBE_CY, R, 0, Math.PI * 2);
    g.strokeStyle = cursed ? "rgba(192,132,252,0.4)" : "rgba(100,160,220,0.15)";
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
      const r = (hovered ? 10 : 6) * pulse;

      g.beginPath();
      g.arc(dp.x, dp.y, r + 3, 0, Math.PI * 2);
      g.fillStyle = hovered ? "rgba(255,200,60,0.15)" : "rgba(255,200,60,0.06)";
      g.fill();

      g.beginPath();
      g.arc(dp.x, dp.y, r, 0, Math.PI * 2);
      g.fillStyle = hovered ? "#fcd34d" : "rgba(252,211,77,0.5)";
      g.fill();

      g.font = "600 13px Outfit, sans-serif";
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


  private traceRing(g: CanvasRenderingContext2D, ring: readonly { x: number; y: number; z: number }[]): void {
    g.beginPath();
    let started = false;
    for (const pt of ring) {
      if (pt.z > 0) {
        if (!started) { g.moveTo(pt.x, pt.y); started = true; }
        else g.lineTo(pt.x, pt.y);
      } else { started = false; }
    }
    if (ring[0]!.z > 0 && ring[ring.length - 1]!.z > 0) g.closePath();
  }

  private drawEventClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    const ev = this.event;
    if (!ev) return;
    const k = this.globeRadius / GLOBE_R_DEFAULT;

    if (ev.kind === "kraken") {
      const ring = globeRangeCircle(ev.center, KRAKEN_RADIUS_KM, globe, 64);
      const p = globeProject(ev.center, globe);
      if (!ev.struck) {
        const pulse = 0.5 + Math.sin(ev.t * 14) * 0.5;
        this.traceRing(g, ring);
        g.fillStyle = `rgba(255,61,122,${0.08 + pulse * 0.12})`;
        g.fill();
        g.strokeStyle = "#FF3D7A";
        g.lineWidth = 2.5;
        g.setLineDash([10, 6]);
        g.lineDashOffset = -ev.t * 40;
        g.stroke();
        g.setLineDash([]);
        g.lineDashOffset = 0;
        if (p.z > 0) {
          // Bubbles rising from the deep.
          for (let i = 0; i < 6; i++) {
            const ph = (ev.t * 1.5 + i / 6) % 1;
            g.globalAlpha = 1 - ph;
            g.strokeStyle = "#e0f2fe";
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(p.x + Math.sin(i * 2.3) * 22 * k, p.y - ph * 30 * k, (2 + i % 3) * k, 0, Math.PI * 2);
            g.stroke();
          }
          g.globalAlpha = 1;
          g.font = `700 ${Math.round(44 * k)}px Bebas Neue, Impact, sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.lineWidth = 6;
          g.strokeStyle = "rgba(7,11,20,0.8)";
          const n = String(Math.max(1, Math.ceil(KRAKEN_WARN_S - ev.t)));
          g.strokeText(n, p.x, p.y);
          g.fillStyle = "#FF3D7A";
          g.fillText(n, p.x, p.y);
        }
      } else if (p.z > 0) {
        const st = ev.t - KRAKEN_WARN_S;
        const rise = Math.min(1, st * 4) * Math.max(0, 1 - Math.max(0, st - 1.3) / 0.8);
        if (rise > 0) {
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2 + 0.3;
            const bx = p.x + Math.cos(a) * 30 * k;
            const by = p.y + Math.sin(a) * 16 * k;
            g.beginPath();
            g.moveTo(bx, by);
            for (let j = 1; j <= 12; j++) {
              const f = j / 12;
              g.lineTo(
                bx + Math.cos(a) * f * 24 * k + Math.sin(f * 5 + this.elapsed * 9 + i) * 10 * k * f,
                by - f * 90 * k * rise,
              );
            }
            g.strokeStyle = "#7c3aed";
            g.lineWidth = 9 * k;
            g.lineCap = "round";
            g.stroke();
            g.strokeStyle = "#c4b5fd";
            g.lineWidth = 3 * k;
            g.stroke();
          }
          g.lineCap = "butt";
        }
      }
    }

    if (ev.kind === "treasure-rain") {
      for (const c of this.chests) {
        if (!c.alive) continue;
        const p = globeProject(c.ll, globe);
        if (p.z < 0.05) continue;
        const drop = (1 - Math.min(1, c.age / 0.5)) * 90;
        const mega = c.value >= 100;
        const w = (mega ? 20 : 13) * k;
        const h = w * 0.7;
        const y = p.y - drop;
        const pulse = 1 + Math.sin(this.elapsed * 6 + c.ll[1]) * 0.15;
        g.beginPath();
        g.arc(p.x, p.y, 16 * k * pulse, 0, Math.PI * 2);
        g.fillStyle = "rgba(255,176,32,0.18)";
        g.fill();
        g.fillStyle = "#92400e";
        g.fillRect(p.x - w / 2, y - h / 2, w, h);
        g.fillStyle = "#fbbf24";
        g.fillRect(p.x - w / 2, y - h / 2, w, h * 0.35);
        g.fillRect(p.x - 1.5 * k, y - h / 2, 3 * k, h);
        g.font = `700 ${Math.round((mega ? 16 : 12) * k)}px Bebas Neue, Impact, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillStyle = "#fde68a";
        g.fillText(`${c.value}`, p.x, y - h / 2 - 2);
      }
    }

    if (ev.kind === "ghost-ship" && this.ghost?.alive) {
      this.ghostTrail.forEach((ll, i) => {
        const p = globeProject(ll, globe);
        if (p.z < 0.05) return;
        g.globalAlpha = 0.4 * (1 - i / this.ghostTrail.length);
        g.fillStyle = "#7CFFCB";
        g.beginPath();
        g.arc(p.x, p.y, (6 - i * 0.3) * k, 0, Math.PI * 2);
        g.fill();
      });
      g.globalAlpha = 1;
      const p = globeProject(ghostPos(this.ghost, this.lanes), globe);
      if (p.z > 0.05) {
        const bob = Math.sin(this.elapsed * 5) * 3;
        const glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30 * k);
        glow.addColorStop(0, "rgba(124,255,203,0.5)");
        glow.addColorStop(1, "rgba(124,255,203,0)");
        g.fillStyle = glow;
        g.fillRect(p.x - 30 * k, p.y - 30 * k, 60 * k, 60 * k);
        g.fillStyle = "#d1fae5";
        g.beginPath();
        g.moveTo(p.x - 10 * k, p.y + bob);
        g.lineTo(p.x + 10 * k, p.y + bob);
        g.lineTo(p.x + 6 * k, p.y + 5 * k + bob);
        g.lineTo(p.x - 6 * k, p.y + 5 * k + bob);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(p.x, p.y - 16 * k + bob);
        g.lineTo(p.x + 8 * k, p.y - 2 * k + bob);
        g.lineTo(p.x, p.y - 2 * k + bob);
        g.closePath();
        g.fillStyle = "rgba(224,255,244,0.85)";
        g.fill();
        g.font = `700 ${Math.round(13 * k)}px Bebas Neue, Impact, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillStyle = "#7CFFCB";
        g.fillText(`GHOST ${GHOST_VALUE}`, p.x, p.y - 18 * k + bob);
      }
    }
  }

  private drawPlayersClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    this.ctx.players.forEach((p, idx) => {
      const state = this.playerStates.get(p.id)!;
      if (!state.parked) return;
      const pp = globeProject(state.ll, globe);
      if (pp.z < 0) return;

      const pulse = 1 + Math.sin(this.elapsed * 5 + idx * 1.5) * 0.15;
      g.beginPath();
      g.arc(pp.x, pp.y, 14 * pulse, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.globalAlpha = 0.15;
      g.fill();
      g.globalAlpha = 1;

      if (state.shield > 0) {
        g.beginPath();
        g.arc(pp.x, pp.y, 13, 0, Math.PI * 2);
        g.strokeStyle = `rgba(226,232,240,${0.4 + Math.sin(this.elapsed * 12) * 0.3})`;
        g.lineWidth = 2;
        g.stroke();
      }

      g.beginPath();
      g.arc(pp.x, pp.y, 7, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.fill();
      g.strokeStyle = "#030810";
      g.lineWidth = 2;
      g.stroke();

      g.font = "700 12px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillStyle = p.color;
      g.fillText(p.name, pp.x, pp.y - 18);
      if (this.wanted === p.id) {
        const w = 1 + Math.sin(this.elapsed * 8) * 0.08;
        g.save();
        g.translate(pp.x, pp.y - 36);
        g.scale(w, w);
        g.fillStyle = "#FF3D7A";
        g.beginPath();
        g.roundRect(-30, -10, 60, 18, 4);
        g.fill();
        g.font = "700 14px Bebas Neue, Impact, sans-serif";
        g.textBaseline = "middle";
        g.fillStyle = "#fff";
        g.fillText("WANTED", 0, 0);
        g.restore();
      }
    });
  }

  private drawRangeRingsClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const p of this.ctx.players) {
      const state = this.playerStates.get(p.id)!;
      if (!state.parked) continue;
      const ring = globeRangeCircle(state.ll, SPOT_RANGE_KM, globe);
      const visible = ring.filter((pt) => pt.z > 0);
      if (visible.length < 3) continue;

      this.traceRing(g, ring);
      g.strokeStyle = p.color;
      g.globalAlpha = 0.35;
      g.lineWidth = 1.5;
      g.setLineDash([6, 4]);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 0.05;
      g.fillStyle = p.color;
      g.fill();
      g.globalAlpha = 1;
    }
  }

  private drawBoardFx(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const f of this.boardFx) {
      const a = globeProject(f.from, globe);
      const b = globeProject(f.to, globe);
      if (a.z < 0 || b.z < 0) continue;
      const t = f.life / 0.8;
      g.globalAlpha = t;
      g.strokeStyle = f.color;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 50, b.x, b.y);
      g.stroke();
      g.beginPath();
      g.arc(a.x, a.y, 30 * (1 - t) + 8, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  private drawBubbles(g: CanvasRenderingContext2D, globe: Globe): void {
    g.font = "700 13px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of this.ctx.players) {
      const s = this.playerStates.get(p.id)!;
      if (!s.bubble || !s.parked) continue;
      const pp = globeProject(s.ll, globe);
      if (pp.z < 0.05) continue;
      const w = g.measureText(s.bubble.text).width + 16;
      const x = Math.max(w / 2 + 4, Math.min(GAME_WIDTH - w / 2 - 4, pp.x + 24 + w / 2));
      const y = pp.y - 44;
      g.globalAlpha = Math.min(1, s.bubble.life / 0.3);
      g.fillStyle = "#F4F7FB";
      g.beginPath();
      g.roundRect(x - w / 2, y - 12, w, 24, 10);
      g.fill();
      g.beginPath();
      g.moveTo(x - w / 2 + 8, y + 10);
      g.lineTo(pp.x + 6, pp.y - 10);
      g.lineTo(x - w / 2 + 20, y + 10);
      g.fill();
      g.strokeStyle = p.color;
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(x - w / 2, y - 12, w, 24, 10);
      g.stroke();
      g.fillStyle = "#0b1220";
      g.fillText(s.bubble.text, x, y + 1);
    }
    g.globalAlpha = 1;
  }

  private drawOverlay(g: CanvasRenderingContext2D): void {
    if (this.flash.life > 0) {
      g.globalAlpha = Math.min(0.35, this.flash.life);
      g.fillStyle = this.flash.color;
      g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      g.globalAlpha = 1;
    }
    if (inFinalStretch(this.elapsed)) {
      const remaining = GAME_DURATION_S - this.elapsed;
      const beat = Math.pow(Math.max(0, Math.sin(this.elapsed * Math.PI * (remaining < 5 ? 4 : 2))), 4);
      const vig = g.createRadialGradient(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.45, GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 0.7);
      vig.addColorStop(0, "rgba(255,61,122,0)");
      vig.addColorStop(1, `rgba(255,61,122,${0.12 + beat * 0.22})`);
      g.fillStyle = vig;
      g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
  }

  private fitText(g: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (g.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  }

  private drawHUD(g: CanvasRenderingContext2D): void {
    const remaining = Math.max(0, GAME_DURATION_S - this.elapsed);
    drawTimerBar(g, GAME_WIDTH, remaining, GAME_DURATION_S);
    const finalStretch = inFinalStretch(this.elapsed);

    g.textBaseline = "alphabetic";
    g.font = `700 ${finalStretch ? 36 : 28}px Bebas Neue, Impact, sans-serif`;
    g.textAlign = "right";
    g.fillStyle = remaining < FINAL_STRETCH_S ? "#FF3D7A" : "#94a3b8";
    g.fillText(`${Math.ceil(remaining)}`, GAME_WIDTH - 18, 38);
    g.font = "400 11px Outfit, sans-serif";
    g.fillText("sec", GAME_WIDTH - 18, 52);
    if (finalStretch) {
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.fillStyle = "#FFB020";
      g.fillText("LAST CALL · ALL BOOTY x2", GAME_WIDTH - 58, 52);
    }

    const sorted = [...this.ctx.players].sort((a, b) => this.playerStates.get(b.id)!.score - this.playerStates.get(a.id)!.score);
    const panelX = 830;
    const panelW = 430;
    g.fillStyle = "rgba(3,8,16,0.78)";
    g.beginPath();
    g.roundRect(panelX, 64, panelW, sorted.length * 56 + 12, 12);
    g.fill();

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!;
      const state = this.playerStates.get(p.id)!;
      const y = 84 + i * 56;
      const brain = this.brains.get(p.id);

      g.beginPath();
      g.arc(panelX + 24, y + 10, 7, 0, Math.PI * 2);
      g.fillStyle = p.color;
      g.fill();
      if (i === 0 && state.score > 0) {
        g.font = "700 12px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.fillStyle = "#FFB020";
        g.fillText("1ST", panelX + 24, y - 2);
      }

      g.textAlign = "left";
      g.font = "600 15px Outfit, sans-serif";
      g.fillStyle = "#e2e8f0";
      g.fillText(p.name, panelX + 40, y + 14);
      let tx = panelX + 40 + g.measureText(p.name).width + 8;
      if (brain) {
        g.font = "italic 400 11px Outfit, sans-serif";
        g.fillStyle = "rgba(148,163,184,0.75)";
        g.fillText(brain.persona.title, tx, y + 14);
        tx += g.measureText(brain.persona.title).width + 8;
      }
      g.font = "700 12px Outfit, sans-serif";
      if (state.multiplier > 1) {
        g.fillStyle = state.multiplier >= 4 ? "#FF3D7A" : state.multiplier >= 3 ? "#FFB020" : "#3EE0FF";
        g.fillText(`x${state.multiplier}`, tx, y + 14);
        tx += 26;
      }
      if (this.wanted === p.id) {
        g.fillStyle = "#FF3D7A";
        g.fillText("WANTED", tx, y + 14);
        tx += 58;
      }
      if (state.shield > 0) {
        g.fillStyle = "#cbd5e1";
        g.fillText(`SHIELD ${Math.ceil(state.shield)}`, tx, y + 14);
      }

      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.textAlign = "right";
      g.fillStyle = p.color;
      g.fillText(String(state.displayScore), panelX + panelW - 20, y + 20);

      // Moves pips + streak bar.
      for (let m = 0; m < REPARK_COUNT; m++) {
        g.beginPath();
        g.arc(panelX + 44 + m * 12, y + 30, 4, 0, Math.PI * 2);
        g.fillStyle = m < state.reparks ? "#3EE0FF" : "rgba(148,163,184,0.25)";
        g.fill();
      }
      if (state.streak > 0) {
        const barW = (state.streak % STREAK_THRESHOLD) / STREAK_THRESHOLD * (panelW - 200);
        g.fillStyle = state.multiplier >= 4 ? "rgba(255,61,122,0.5)" : "rgba(62,224,255,0.35)";
        g.fillRect(panelX + 76, y + 28, state.multiplier >= 4 ? panelW - 200 : barW, 4);
      }
    }

    // Event banner.
    const ev = this.event;
    if (ev) {
      const style = EVENT_STYLE[ev.kind];
      const by = 64 + sorted.length * 56 + 22;
      g.fillStyle = "rgba(3,8,16,0.78)";
      g.beginPath();
      g.roundRect(panelX, by, panelW, 40, 10);
      g.fill();
      const hint = ev.kind === "kraken" ? (ev.struck ? "It struck!" : "Get out of the red circle!")
        : ev.kind === "treasure-rain" ? "Anchor beside a chest to grab it"
        : ev.kind === "ghost-ship" ? `Catch it in range: +${GHOST_VALUE}`
        : "Raids: x3 or LOSE it (30%)";
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "left";
      g.fillStyle = style.color;
      g.fillText(style.label, panelX + 14, by + 27);
      g.font = "600 13px Outfit, sans-serif";
      g.fillStyle = "#e2e8f0";
      g.textAlign = "right";
      g.fillText(hint, panelX + panelW - 14, by + 25);
      g.fillStyle = style.color;
      g.fillRect(panelX + 10, by + 35, (panelW - 20) * Math.max(0, 1 - ev.t / ev.dur), 3);
    }

    const humans = this.humans();
    const human = humans[Math.min(this.activeHumanIdx, humans.length - 1)];

    if (human) {
      const state = this.playerStates.get(human.id)!;
      const perfect = this.elapsed % 4 < 1;
      const ready = state.parked && state.raidCooldown === 0;
      const cursed = this.event?.kind === "cursed-gold";
      g.fillStyle = ready ? (cursed ? "#6b21a8" : perfect ? "#fbbf24" : "#164e63") : "#182334";
      g.beginPath();
      g.roundRect(RAID_BTN.x, RAID_BTN.y, RAID_BTN.w, RAID_BTN.h, 14);
      g.fill();
      g.strokeStyle = human.color;
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = ready && perfect && !cursed ? "#030810" : "#F4F7FB";
      g.textAlign = "center";
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      const label = !state.parked ? "DROP ANCHOR FIRST"
        : state.raidCooldown > 0 ? `RELOADING ${state.raidCooldown.toFixed(1)}s`
        : cursed ? "CURSED RAID: x3 OR BUST"
        : perfect ? "RAID NOW! DOUBLE GOLD" : `${human.name.toUpperCase()}: RAID`;
      g.fillText(label, RAID_BTN.x + RAID_BTN.w / 2, RAID_BTN.y + 42);
      g.font = "400 13px Outfit, sans-serif";
      g.fillText("Raid on the gold flash · tap a rival to board them", RAID_BTN.x + RAID_BTN.w / 2, RAID_BTN.y + 70);
      g.fillStyle = "#fbbf24";
      g.fillRect(RAID_BTN.x + 10, RAID_BTN.y + RAID_BTN.h - 8, (RAID_BTN.w - 20) * ((this.elapsed % 4) / 4), 4);
    }

    if (humans.length > 1) {
      humans.forEach((h, i) => {
        const r = this.helmRect(i, humans.length);
        const active = h === human;
        g.fillStyle = active ? h.color : "rgba(24,35,52,0.9)";
        g.beginPath();
        g.roundRect(r.x, r.y, r.w, r.h, 10);
        g.fill();
        g.strokeStyle = h.color;
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = active ? "#030810" : h.color;
        g.font = "700 20px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.fillText(this.fitText(g, active ? `AT THE HELM: ${h.name}` : h.name, r.w - 10), r.x + r.w / 2, r.y + 23);
        g.font = "400 11px Outfit, sans-serif";
        const bind = ["Space", "Enter", "R-Shift", "Y"][h.slot] ?? "";
        g.fillText(this.fitText(g, active ? "taps steer this ship" : `tap to steer · raid: ${bind}`, r.w - 10), r.x + r.w / 2, r.y + 39);
      });
    }

    // Captain's log.
    const logTop = humans.length > 1 ? LOG_Y : HELM_Y;
    g.fillStyle = "rgba(3,8,16,0.7)";
    g.beginPath();
    g.roundRect(RAID_BTN.x, logTop, RAID_BTN.w, GAME_HEIGHT - logTop - 34, 10);
    g.fill();
    g.font = "700 14px Bebas Neue, Impact, sans-serif";
    g.textAlign = "left";
    g.fillStyle = "rgba(148,163,184,0.7)";
    g.fillText("CAPTAIN'S LOG", RAID_BTN.x + 12, logTop + 18);
    g.font = "600 13px Outfit, sans-serif";
    const lineH = 22;
    const maxLines = Math.floor((GAME_HEIGHT - logTop - 34 - 26) / lineH);
    this.log.slice(0, maxLines).forEach((line, i) => {
      g.globalAlpha = Math.max(0.35, 1 - i * 0.16);
      g.fillStyle = line.color;
      const pop = line.age < 0.25 ? 1 + (0.25 - line.age) * 0.6 : 1;
      g.save();
      g.translate(RAID_BTN.x + 12, logTop + 40 + i * lineH);
      g.scale(pop, pop);
      g.fillText(this.fitText(g, line.text, RAID_BTN.w - 24), 0, 0);
      g.restore();
    });
    g.globalAlpha = 1;

    // Legend.
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
    g.textBaseline = "alphabetic";

    if (human) {
      const hState = this.playerStates.get(human.id)!;
      if (!hState.parked) {
        const promptY = Math.min(GLOBE_CY + this.globeRadius + 16, GAME_HEIGHT - 50);
        g.fillStyle = "rgba(3,8,16,0.7)";
        g.beginPath();
        g.roundRect(GLOBE_CX - 220, promptY, 440, 40, 8);
        g.fill();
        g.font = "600 15px Outfit, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = human.color;
        g.fillText(`${human.name}: tap the globe to drop anchor`, GLOBE_CX, promptY + 20);
        g.textBaseline = "alphabetic";
      } else {
        g.font = "400 12px Outfit, sans-serif";
        g.textAlign = "center";
        g.fillStyle = "rgba(148,163,184,0.7)";
        const next = hState.reparks < REPARK_COUNT ? ` • next in ${Math.ceil(MOVE_RECHARGE_S - hState.moveCharge)}s` : "";
        g.fillText(`${human.name}: ${hState.reparks} moves ready${next}`, GLOBE_CX, GAME_HEIGHT - 8);
      }
    }

    if (this.globeRadius !== GLOBE_R_DEFAULT) {
      const zoomPct = Math.round((this.globeRadius / GLOBE_R_DEFAULT) * 100);
      g.font = "600 11px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = "rgba(148,163,184,0.6)";
      g.fillText(`Zoom ${zoomPct}%`, 14, 34);
      g.textBaseline = "alphabetic";
    }

    if (this.goldRush) {
      const pulse = 0.7 + Math.sin(this.elapsed * 6) * 0.3;
      g.globalAlpha = pulse;
      g.fillStyle = "#fbbf24";
      g.font = "700 13px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(`GOLD RUSH on lane ${this.goldRush.laneIdx + 1} (${Math.ceil(this.goldRush.remaining)}s)`, GLOBE_CX, 36);
      g.globalAlpha = 1;
      g.textBaseline = "alphabetic";
    }
  }

  private drawPopups(g: CanvasRenderingContext2D): void {
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    for (const p of this.popups) {
      const t = 1 - p.life / 0.9;
      g.globalAlpha = Math.min(1, p.life / 0.2);
      g.font = `700 ${p.size}px Bebas Neue, Impact, sans-serif`;
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.7)";
      g.strokeText(p.text, p.x, p.y - t * 30);
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, p.y - t * 30);
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

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (const p of this.ctx.players) {
      const s = this.playerStates.get(p.id)!;
      stats.push({ playerId: p.id, label: "Plundered from rivals", value: `${s.stolen} (${s.boards} boardings)` });
      stats.push({ playerId: p.id, label: "Lost to pirates, kraken & curses", value: String(s.lost) });
    }
    return stats;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("wheel", this.wheelHandler);
    this.ctx.canvas.removeEventListener("touchstart", this.touchStartHandler);
    this.ctx.canvas.removeEventListener("touchmove", this.touchMoveHandler);
  }
}
