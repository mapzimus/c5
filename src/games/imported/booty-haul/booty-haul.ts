import { GAME_HEIGHT, GAME_WIDTH, type GameContext, type GameDefinition, type GameInstance, type GameStat, type Player } from "../../../core/types";
import { PLAYER_BINDS } from "../../../core/input";
import { Callouts, Juice, saveBest } from "../../../fx/juice";
import { drawTimerBar } from "../../../core/draw";
import { buildLanes, DOORS, globeProject, globeRangeCircle, globeUnproject, lerpLatLng, makeGlobe, type Door, type Globe, type Lane, type LatLng } from "./geo";
import { LAND } from "./land";
import {
  advanceShips,
  botPickSpot,
  captureShips,
  FLEET_SIZE,
  GAME_DURATION_S,
  HAUL_LOCK_S,
  HIGH_TIDE_S,
  holdMultiplier,
  haulValue,
  HUNT_FIRST_S,
  HUNT_WARNING_S,
  huntGap,
  isUnderdog,
  laneLabel,
  LAST_CALL_S,
  MAX_MULT,
  maybeStartGoldRush,
  MOVE_RECHARGE_S,
  netValue,
  pickHuntTarget,
  prizeInRange,
  RAID_COOLDOWN_S,
  REPARK_COUNT,
  scoreShipsInRange,
  shipPos,
  SHIP_TYPES,
  spawnConvoyPack,
  spawnFleet,
  spawnGoldRushShips,
  spawnPrize,
  SPOT_RANGE_KM,
  tideSpeed,
  type GoldRush,
  type Prize,
  type Ship,
} from "./rules";

const GAME_ID = "booty-haul";
/** Records: hold-and-haul ruleset. Old passive-tick bests stay under the unversioned key. */
const BEST_VERSION = "v2-haul";
const GLOBE_CX = 480;
const GLOBE_CY = 340;
const GLOBE_R_DEFAULT = 300;
const GLOBE_R_MIN = 200;
const GLOBE_R_MAX = 500;
const SPIN_SPEED = 8;
const PANEL_X = 800;
const PANEL_W = 470;
const PANEL_TOP = 62;
const HUMAN_PANEL_H = 150;
const BOT_PANEL_H = 64;
const PANEL_GAP = 8;
const DOOR_SNAP_PX = 30;
const NAVY_RED = "#ef4444";
const GOLD = "#fbbf24";

export const bootyHaul: GameDefinition = {
  id: GAME_ID,
  name: "Booty Haul",
  tagline: "Net the shipping lanes, fill your hold, haul home before the Navy comes.",
  description:
    "Drag your anchor onto the globe where the ships sail. RAID takes every vessel in your net " +
    "(cargo 2, tanker 5, treasure 15, convoy 30) into your hold and sends them onward. Each raid grows your hold " +
    "multiplier, but only HAUL HOME banks it. The Navy hunts whoever carries the richest hold: haul before it lands " +
    "or your loot is seized and dumped at a far chokepoint as a prize anyone can grab. High tide at 50s. 75 seconds.",
  durationMs: GAME_DURATION_S * 1000,
  controls: "Drag anchor onto globe · RAID / HAUL HOME buttons · Seat keys: action = raid, down = haul · Scroll to zoom",
  create: (ctx) => new BootyHaulGame(ctx),
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Seat {
  player: Player;
  parked: boolean;
  ll: LatLng;
  score: number;
  displayScore: number;
  hold: number;
  raidsSinceHaul: number;
  reparks: number;
  moveCharge: number;
  raidCooldown: number;
  haulLock: number;
  /** Placing mode: the next tap on the globe drops this seat's anchor. */
  armed: boolean;
  flash: number;
  quip: string;
  quipLife: number;
  // stats
  raids: number;
  biggestHaul: number;
  seized: number;
  prizes: number;
  // bot brain
  botThreshold: number;
  botParkAt: number;
  botHuntReact: number;
  botLowSince: number;
  lastRaidAt: number;
  // layout
  panel: Box;
  raidBtn: Box;
  haulBtn: Box;
  anchorBtn: Box;
}

interface Hunt {
  targetId: string;
  remaining: number;
  from: LatLng;
}

interface Drag {
  seat: Seat;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
}

const BOT_QUIPS = {
  raid: ["Arr, mine!", "Easy pickings", "Ha-haar!", "Hold's fillin'"],
  haul: ["Bankin' it", "Safe an' sound", "Counted!"],
  seized: ["Blast!", "Curse the Navy!", "Nooo!"],
  prize: ["Finders keepers", "Thanks, matey"],
  move: ["New waters", "Chasin' traffic"],
} as const;

class BootyHaulGame implements GameInstance {
  private readonly lanes: Lane[];
  private readonly ships: Ship[];
  private readonly seats: Seat[] = [];
  private readonly playerStates: Map<string, Seat> = new Map();
  private readonly juice: Juice;
  private readonly callouts: Callouts;
  private readonly popups: ScorePopup[] = [];
  private readonly stars: Star[] = [];
  private readonly drags: Map<number, Drag> = new Map();
  private camLat = 20;
  private camLng = 0;
  private targetLat = 20;
  private targetLng = 0;
  private elapsed = 0;
  private done = false;
  private tickAccum = 0;
  private globeRadius = GLOBE_R_DEFAULT;
  private goldRush: GoldRush | null = null;
  private goldRushSpawnCooldown = 0;
  private convoyTimer = 0;
  private hunt: Hunt | null = null;
  private nextHuntAt = HUNT_FIRST_S;
  private prize: Prize | null = null;
  private highTide = false;
  private lastCallShown = false;
  private hoverDoor: Door | null = null;
  /** Ocean, land and lanes are static until the camera moves; cached at device resolution. */
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = "";
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
    ctx.canvas.style.touchAction = "none";
    ctx.canvas.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    ctx.canvas.addEventListener("pointermove", this.onPointerMove, { passive: false });
    ctx.canvas.addEventListener("pointerup", this.onPointerUp);
    ctx.canvas.addEventListener("pointercancel", this.onPointerCancel);

    for (let i = 0; i < 120; i++) {
      this.stars.push({
        x: ctx.rng.next() * GAME_WIDTH,
        y: ctx.rng.next() * GAME_HEIGHT,
        brightness: 0.15 + ctx.rng.next() * 0.5,
        size: 0.5 + ctx.rng.next() * 1.2,
      });
    }

    const humans = ctx.players.filter((p) => p.kind === "human").length;
    for (const p of ctx.players) {
      const seat: Seat = {
        player: p, parked: false, ll: [0, 0], score: 0, displayScore: 0, hold: 0, raidsSinceHaul: 0,
        reparks: REPARK_COUNT, moveCharge: 0, raidCooldown: 0, haulLock: 0,
        armed: humans === 1 && p.kind === "human", flash: 0, quip: "", quipLife: 0,
        raids: 0, biggestHaul: 0, seized: 0, prizes: 0,
        botThreshold: 12 + ctx.rng.next() * 18, botParkAt: 0.8 + ctx.rng.next() * 1.5,
        botHuntReact: 1, botLowSince: 0, lastRaidAt: 0,
        panel: { x: 0, y: 0, w: 0, h: 0 }, raidBtn: { x: 0, y: 0, w: 0, h: 0 },
        haulBtn: { x: 0, y: 0, w: 0, h: 0 }, anchorBtn: { x: 0, y: 0, w: 0, h: 0 },
      };
      this.seats.push(seat);
      this.playerStates.set(p.id, seat);
    }
    this.layoutPanels();

    ctx.sfx.countdown();
  }

  private layoutPanels(): void {
    const minTap = Math.max(44, this.ctx.minTap ?? 44);
    const btnH = Math.max(56, Math.min(minTap, 64));
    let y = PANEL_TOP;
    for (const seat of this.seats) {
      const human = seat.player.kind === "human";
      const h = human ? HUMAN_PANEL_H : BOT_PANEL_H;
      seat.panel = { x: PANEL_X, y, w: PANEL_W, h };
      if (human) {
        const by = y + h - btnH - 10;
        seat.anchorBtn = { x: PANEL_X + 12, y: by, w: 76, h: btnH };
        seat.raidBtn = { x: PANEL_X + 98, y: by, w: 196, h: btnH };
        seat.haulBtn = { x: PANEL_X + 304, y: by, w: PANEL_W - 316, h: btnH };
      }
      y += h + PANEL_GAP;
    }
  }

  private globe(): Globe {
    return makeGlobe(GLOBE_CX, GLOBE_CY, this.globeRadius, this.camLat, this.camLng);
  }

  // ---- pointer input (multi-touch by pointerId) -------------------------

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / (rect.width || 1)) * GAME_WIDTH,
      y: ((e.clientY - rect.top) / (rect.height || 1)) * GAME_HEIGHT,
    };
  }

  private inBox(p: { x: number; y: number }, b: Box): boolean {
    const minTap = Math.max(44, this.ctx.minTap ?? 44);
    const padX = Math.max(0, (minTap - b.w) / 2);
    const padY = Math.max(0, (minTap - b.h) / 2);
    return p.x >= b.x - padX && p.x <= b.x + b.w + padX && p.y >= b.y - padY && p.y <= b.y + b.h + padY;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.done) return;
    const p = this.toLogical(e);
    for (const seat of this.seats) {
      if (seat.player.kind !== "human") continue;
      if (this.inBox(p, seat.raidBtn)) { e.preventDefault(); this.raid(seat.player.id); return; }
      if (this.inBox(p, seat.haulBtn)) { e.preventDefault(); this.haul(seat.player.id); return; }
      if (this.inBox(p, seat.anchorBtn)) {
        e.preventDefault();
        try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
        this.drags.set(e.pointerId, { seat, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: false });
        return;
      }
    }
    // A bare tap on the globe parks whichever seat is armed (the only human is always armed).
    const armed = this.seats.filter((s) => s.player.kind === "human" && s.armed);
    if (armed.length === 1) {
      const ll = this.pickSpot(p.x, p.y);
      if (ll) {
        e.preventDefault();
        this.park(armed[0]!.player.id, ll);
      }
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drags.get(e.pointerId);
    if (!d) return;
    e.preventDefault();
    const p = this.toLogical(e);
    d.x = p.x;
    d.y = p.y;
    if (Math.hypot(p.x - d.startX, p.y - d.startY) > 8) d.moved = true;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const d = this.drags.get(e.pointerId);
    if (!d) return;
    this.drags.delete(e.pointerId);
    if (d.moved) {
      const ll = this.pickSpot(d.x, d.y);
      if (ll) this.park(d.seat.player.id, ll);
      else this.ctx.sfx.tick();
      return;
    }
    // Tap on the anchor: arm placement, and look at your anchor if it is down.
    const humans = this.seats.filter((s) => s.player.kind === "human");
    if (humans.length > 1) {
      const wasArmed = d.seat.armed;
      for (const s of humans) s.armed = false;
      d.seat.armed = !wasArmed;
    }
    if (d.seat.parked) {
      this.targetLat = d.seat.ll[0];
      this.targetLng = d.seat.ll[1];
    }
    this.ctx.sfx.select();
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.drags.delete(e.pointerId);
  };

  /** Globe point under the pointer, snapped to a chokepoint when close. Null off the globe. */
  private pickSpot(x: number, y: number): LatLng | null {
    const globe = this.globe();
    for (const door of DOORS) {
      const dp = globeProject(door.ll, globe);
      if (dp.z > 0 && Math.hypot(x - dp.x, y - dp.y) < DOOR_SNAP_PX) return door.ll;
    }
    return globeUnproject(x, y, globe);
  }

  // ---- update -----------------------------------------------------------

  update(dt: number): void {
    if (this.done) return;
    const gdt = this.juice.update(dt);
    this.callouts.update(dt);
    this.elapsed += gdt;

    for (const p of this.popups) p.life -= dt;
    this.popups.splice(0, this.popups.length, ...this.popups.filter((p) => p.life > 0));

    if (!this.highTide && this.elapsed >= HIGH_TIDE_S) {
      this.highTide = true;
      this.callouts.show("HIGH TIDE! TRAFFIC SURGE", GOLD, { life: 1.6, size: 60 });
      this.ctx.sfx.whoosh();
      this.juice.shake(0.3);
      for (let i = 0; i < 2; i++) this.ships.push(...spawnConvoyPack(this.ctx.rng, this.lanes));
    }

    advanceShips(this.ships, this.lanes, gdt, this.ctx.rng, tideSpeed(this.elapsed));

    const anyParked = this.seats.some((s) => s.parked);
    if (!anyParked) {
      this.camLng += SPIN_SPEED * gdt;
      this.targetLng = this.camLng;
    } else {
      this.camLat += (this.targetLat - this.camLat) * Math.min(1, dt * 3);
      this.camLng += (this.targetLng - this.camLng) * Math.min(1, dt * 3);
      if (Math.abs(this.targetLat - this.camLat) < 0.01) this.camLat = this.targetLat;
      if (Math.abs(this.targetLng - this.camLng) < 0.01) this.camLng = this.targetLng;
    }

    this.convoyTimer += gdt;
    const convoyEvery = this.highTide ? 10 : 15;
    if (this.convoyTimer >= convoyEvery) {
      this.convoyTimer -= convoyEvery;
      this.ships.push(...spawnConvoyPack(this.ctx.rng, this.lanes));
    }

    this.tickAccum += gdt;
    const TICK = 0.4;
    while (this.tickAccum >= TICK) {
      this.tickAccum -= TICK;
      const before = this.goldRush;
      this.goldRush = maybeStartGoldRush(this.ctx.rng, this.lanes, this.goldRush);
      if (this.goldRush && this.goldRush !== before) {
        this.callouts.show(`GOLD RUSH ${laneLabel(this.lanes[this.goldRush.laneIdx]!).toUpperCase()}`, GOLD, { life: 1.4, size: 44, y: 0.2 });
        this.ctx.sfx.streak(2);
      }
      if (this.goldRush) {
        this.goldRush.remaining -= TICK;
        this.goldRushSpawnCooldown -= TICK;
        if (this.goldRushSpawnCooldown <= 0) {
          this.ships.push(...spawnGoldRushShips(this.ctx.rng, this.lanes, this.goldRush.laneIdx));
          this.goldRushSpawnCooldown = 2;
        }
        if (this.goldRush.remaining <= 0) this.goldRush = null;
      }
    }

    if (this.prize) {
      this.prize.remaining -= gdt;
      if (this.prize.remaining <= 0) {
        this.prize = null;
        this.callouts.show("PRIZE SANK", "#94a3b8", { life: 0.8, size: 34, y: 0.2 });
      }
    }

    this.updateHunt(gdt);

    const totals = this.seats.map((s) => ({ id: s.player.id, total: s.score + haulValue(s.hold, s.raidsSinceHaul) }));
    for (const seat of this.seats) {
      seat.raidCooldown = Math.max(0, seat.raidCooldown - gdt);
      seat.haulLock = Math.max(0, seat.haulLock - gdt);
      seat.flash = Math.max(0, seat.flash - dt);
      seat.quipLife = Math.max(0, seat.quipLife - dt);
      if (seat.reparks < REPARK_COUNT) {
        seat.moveCharge += gdt * (isUnderdog(seat.player.id, totals) ? 2 : 1);
        if (seat.moveCharge >= MOVE_RECHARGE_S) { seat.reparks++; seat.moveCharge -= MOVE_RECHARGE_S; }
      } else seat.moveCharge = 0;
      if (seat.displayScore < seat.score) {
        seat.displayScore += Math.ceil((seat.score - seat.displayScore) * Math.min(1, dt * 8));
        if (seat.displayScore > seat.score) seat.displayScore = seat.score;
      }
    }

    const remaining = GAME_DURATION_S - this.elapsed;
    if (!this.lastCallShown && remaining <= LAST_CALL_S) {
      this.lastCallShown = true;
      this.callouts.show("LAST CALL — HAUL HOME!", "#FF3D7A", { life: 1.6, size: 56 });
      this.ctx.sfx.countdown();
    }

    this.handleKeys();
    this.handleBots(gdt);

    if (this.elapsed >= GAME_DURATION_S) {
      this.done = true;
      for (const seat of this.seats) {
        // Time's up: whatever is still in the hold banks at face value, no multiplier.
        if (seat.hold > 0) {
          seat.score += seat.hold;
          seat.hold = 0;
          seat.raidsSinceHaul = 0;
        }
        seat.displayScore = seat.score;
      }
      this.checkBest();
      this.ctx.sfx.win();
    }
  }

  private updateHunt(gdt: number): void {
    if (!this.hunt) {
      if (this.elapsed < this.nextHuntAt) return;
      const targetId = pickHuntTarget(this.seats.map((s) => ({ id: s.player.id, hold: s.hold, raidsSinceHaul: s.raidsSinceHaul })));
      if (!targetId) {
        this.nextHuntAt = this.elapsed + 3;
        return;
      }
      const seat = this.playerStates.get(targetId)!;
      const bearing = this.ctx.rng.next() * Math.PI * 2;
      const from: LatLng = [
        Math.max(-70, Math.min(70, seat.ll[0] + Math.cos(bearing) * 22)),
        seat.ll[1] + Math.sin(bearing) * 22,
      ];
      this.hunt = { targetId, remaining: HUNT_WARNING_S, from };
      seat.flash = HUNT_WARNING_S;
      seat.botHuntReact = this.ctx.rng.next() < 0.25 ? -1 : 0.4 + this.ctx.rng.next() * 2.4;
      this.callouts.show(`NAVY HUNTING ${seat.player.name.toUpperCase()}!`, NAVY_RED, { life: 1.3, size: 52, y: 0.2 });
      this.ctx.sfx.hit();
      this.juice.shake(0.2);
      return;
    }
    this.hunt.remaining -= gdt;
    if (this.hunt.remaining > 0) return;
    const seat = this.playerStates.get(this.hunt.targetId)!;
    const p = globeProject(seat.ll, this.globe());
    if (seat.hold > 0) {
      const lost = seat.hold;
      seat.hold = 0;
      seat.raidsSinceHaul = 0;
      seat.seized++;
      this.prize = spawnPrize(this.ctx.rng, DOORS, seat.ll, lost);
      this.callouts.show(`SEIZED! ${lost} LOOT DUMPED AT ${this.prize.name.toUpperCase()}`, NAVY_RED, { life: 1.8, size: 44, y: 0.2 });
      if (p.z > 0) {
        this.juice.burst(p.x, p.y, [NAVY_RED, "#fca5a5", GOLD], { count: 40, speed: 320, gravity: 60, life: 0.9 });
        this.popups.push({ x: p.x, y: p.y - 30, text: `-${lost}`, color: NAVY_RED, life: 1, maxLife: 1, size: 26 });
      }
      this.juice.shake(0.5);
      this.juice.hitStop(0.08);
      this.ctx.sfx.hit();
      this.ctx.sfx.miss();
      if (seat.player.kind === "bot") this.quip(seat, BOT_QUIPS.seized);
    } else {
      this.callouts.show(`${seat.player.name.toUpperCase()} SLIPPED AWAY`, "#94a3b8", { life: 0.9, size: 34, y: 0.2 });
    }
    this.hunt = null;
    this.nextHuntAt = this.elapsed + huntGap(this.elapsed) + this.ctx.rng.next() * 3;
  }

  private handleKeys(): void {
    const input = this.ctx.input;
    for (const seat of this.seats) {
      if (seat.player.kind !== "human") continue;
      const bind = PLAYER_BINDS[seat.player.slot];
      if (!bind) continue;
      if (input.justPressed(bind.action)) this.raid(seat.player.id);
      if (input.justPressed(bind.down)) this.haul(seat.player.id);
    }
  }

  private quip(seat: Seat, pool: readonly string[]): void {
    seat.quip = this.ctx.rng.pick(pool) ?? "";
    seat.quipLife = 1.6;
  }

  private raid(playerId: string): void {
    const seat = this.playerStates.get(playerId)!;
    if (!seat.parked || seat.raidCooldown > 0 || seat.haulLock > 0) return;
    const prizeHit = prizeInRange(this.prize, seat.ll);
    const cap = captureShips(this.ships, seat.ll, this.lanes, this.ctx.rng);
    if (cap.count === 0 && !prizeHit) {
      seat.raidCooldown = 0.6;
      if (seat.player.kind === "human") {
        this.callouts.show("EMPTY NET — MOVE TO THE LANES", "#94a3b8", { size: 30, life: 0.8, y: 0.2 });
        this.ctx.sfx.miss();
      }
      return;
    }
    let value = cap.value;
    const globe = this.globe();
    const p = globeProject(seat.ll, globe);
    const color = seat.player.color;
    if (prizeHit && this.prize) {
      value += this.prize.value;
      seat.prizes++;
      this.callouts.show(`${seat.player.name.toUpperCase()} GRABS THE PRIZE +${this.prize.value}`, GOLD, { life: 1.4, size: 46, y: 0.2 });
      this.ctx.sfx.streak(3);
      this.juice.shake(0.3);
      this.prize = null;
      if (seat.player.kind === "bot") this.quip(seat, BOT_QUIPS.prize);
    }
    const multBefore = holdMultiplier(seat.raidsSinceHaul);
    seat.hold += value;
    seat.raidsSinceHaul++;
    seat.raids++;
    seat.lastRaidAt = this.elapsed;
    seat.raidCooldown = RAID_COOLDOWN_S;
    const multAfter = holdMultiplier(seat.raidsSinceHaul);
    if (p.z > 0) {
      for (const from of cap.from.slice(0, 14)) {
        const fp = globeProject(from, globe);
        if (fp.z <= 0) continue;
        const angle = Math.atan2(p.y - fp.y, p.x - fp.x);
        this.juice.burst(fp.x, fp.y, [color, GOLD], { count: 4, speed: 220, gravity: 0, life: 0.45, angle, spread: 0.5, size: 3 });
      }
      this.juice.burst(p.x, p.y, [color, GOLD], { count: 18 + Math.min(24, cap.count * 2), speed: 240, gravity: 0, life: 0.6 });
      this.popups.push({ x: p.x, y: p.y - 26, text: `+${value}`, color, life: 0.9, maxLife: 0.9, size: 22 });
    }
    this.juice.shake(Math.min(0.4, 0.12 + value / 300));
    this.juice.hitStop(value >= 60 ? 0.05 : 0.02);
    this.ctx.sfx.collect();
    if (cap.hadConvoy) {
      this.callouts.show("CONVOY CAPTURED!", "#22d3ee", { life: 0.9, size: 40, y: 0.2 });
      this.ctx.sfx.streak(2);
    }
    if (multAfter > multBefore && Number.isInteger(multAfter)) {
      const label = multAfter >= MAX_MULT ? `MAX x${multAfter}` : `x${multAfter}`;
      this.callouts.show(label, multAfter >= MAX_MULT ? "#FF3D7A" : GOLD, { life: 0.7, size: 48, y: 0.45 });
      this.ctx.sfx.streak(Math.round(multAfter));
    }
    if (seat.player.kind === "bot" && value >= 25) this.quip(seat, BOT_QUIPS.raid);
  }

  private haul(playerId: string): void {
    const seat = this.playerStates.get(playerId)!;
    if (seat.hold <= 0 || seat.haulLock > 0) return;
    const mult = holdMultiplier(seat.raidsSinceHaul);
    const banked = haulValue(seat.hold, seat.raidsSinceHaul);
    seat.score += banked;
    seat.biggestHaul = Math.max(seat.biggestHaul, banked);
    seat.hold = 0;
    seat.raidsSinceHaul = 0;
    seat.haulLock = HAUL_LOCK_S;
    const hunted = this.hunt && this.hunt.targetId === playerId;
    if (hunted && this.hunt!.remaining < 0.8) {
      this.callouts.show("CLOSE CALL!", GOLD, { life: 1, size: 58 });
      this.ctx.sfx.streak(3);
      this.juice.hitStop(0.06);
    }
    const px = seat.panel.x + seat.panel.w - 40;
    const py = seat.panel.y + 26;
    this.juice.burst(px, py, [GOLD, seat.player.color, "#fff7cc"], { count: 26, speed: 200, gravity: 300, life: 0.7 });
    this.popups.push({
      x: px - 60, y: py + 6, text: mult > 1 ? `+${banked} x${mult}` : `+${banked}`,
      color: GOLD, life: 1, maxLife: 1, size: 24,
    });
    this.juice.shake(Math.min(0.35, 0.1 + banked / 600));
    this.ctx.sfx.streak(Math.min(3, Math.ceil(mult)));
    if (seat.player.kind === "bot") this.quip(seat, BOT_QUIPS.haul);
  }

  private park(playerId: string, ll: LatLng): void {
    const seat = this.playerStates.get(playerId)!;
    if (seat.parked && seat.reparks <= 0) {
      if (seat.player.kind === "human") {
        this.callouts.show("NO MOVES — RECHARGING", "#94a3b8", { size: 30, life: 0.7, y: 0.2 });
        this.ctx.sfx.miss();
      }
      return;
    }
    if (seat.parked) seat.reparks--;
    seat.parked = true;
    seat.ll = ll;
    seat.botLowSince = 0;
    if (seat.player.kind === "human") {
      this.targetLat = ll[0];
      this.targetLng = ll[1];
      const humans = this.seats.filter((s) => s.player.kind === "human");
      if (humans.length > 1) seat.armed = false;
    }
    this.ctx.sfx.go();
    this.juice.shake(0.25);
    this.juice.hitStop(0.04);
    const p = globeProject(ll, this.globe());
    if (p.z > 0) this.juice.burst(p.x, p.y, seat.player.color, { count: 20, speed: 220, life: 0.6, gravity: 200 });
  }

  private handleBots(dt: number): void {
    const rng = this.ctx.rng;
    for (const seat of this.seats) {
      if (seat.player.kind !== "bot") continue;
      if (!seat.parked) {
        if (this.elapsed > seat.botParkAt) this.botMove(seat);
        continue;
      }
      const value = netValue(this.ships, seat.ll, this.lanes, this.prize);

      // Haul decisions: the hunt horn, a fat multiplier, or the final seconds.
      const hunted = this.hunt && this.hunt.targetId === seat.player.id;
      if (seat.hold > 0 && seat.haulLock === 0) {
        if (hunted && seat.botHuntReact >= 0 && this.hunt!.remaining <= seat.botHuntReact) this.haul(seat.player.id);
        else if (!hunted && seat.raidsSinceHaul >= 4 && rng.next() < dt * 0.35) this.haul(seat.player.id);
        else if (GAME_DURATION_S - this.elapsed < 2.5 && rng.next() < dt * 2) this.haul(seat.player.id);
      }

      // Raid when the net is worth it; bots hesitate instead of firing on the frame.
      if (seat.raidCooldown === 0 && seat.haulLock === 0 && value > 0) {
        const eager = value >= seat.botThreshold || this.elapsed - seat.lastRaidAt > 7;
        if (eager && rng.next() < dt * 2.2) {
          this.raid(seat.player.id);
          seat.botThreshold = 10 + rng.next() * 22;
        }
      }

      // Move when the water has gone quiet, or to chase a juicy prize.
      if (value < 8) seat.botLowSince += dt; else seat.botLowSince = 0;
      if (seat.reparks > 0) {
        if (seat.botLowSince > 4 + rng.next() * 2) this.botMove(seat);
        else if (this.prize && this.prize.value >= 50 && !prizeInRange(this.prize, seat.ll) && rng.next() < dt * 0.2) {
          this.park(seat.player.id, this.prize.ll);
          this.quip(seat, BOT_QUIPS.prize);
        }
      }
    }
  }

  private botMove(seat: Seat): void {
    const taken = this.seats
      .filter((s) => s.parked && s !== seat)
      .map((s) => ({ ll: s.ll, parked: s.parked, score: s.score }));
    this.park(seat.player.id, botPickSpot(this.ctx.rng, this.ships, this.lanes, DOORS, taken, this.prize));
    if (seat.raids > 0) this.quip(seat, BOT_QUIPS.move);
  }

  private checkBest(): void {
    const humanScores = this.seats.filter((s) => s.player.kind === "human").map((s) => s.score);
    if (humanScores.length === 0) return;
    const topScore = Math.max(0, ...humanScores);
    if (topScore > 0 && saveBest(GAME_ID, topScore, BEST_VERSION)) {
      this.callouts.show("NEW RECORD!", GOLD, { life: 2 });
    }
  }

  // ---- render -----------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const globe = this.globe();
    this.hoverDoor = null;
    for (const d of this.drags.values()) {
      for (const door of DOORS) {
        const dp = globeProject(door.ll, globe);
        if (dp.z > 0 && Math.hypot(d.x - dp.x, d.y - dp.y) < DOOR_SNAP_PX) { this.hoverDoor = door; break; }
      }
    }
    this.drawBackground(g);
    this.juice.begin(g);
    this.drawGlobe(g, globe);
    this.juice.end(g);
    this.drawHUD(g, globe);
    this.drawDrags(g, globe);
    this.drawPopups(g);
    // Callouts sit over the globe, clear of the seat panels.
    this.callouts.draw(g, GLOBE_CX * 2, GAME_HEIGHT);
  }

  private drawBackground(g: CanvasRenderingContext2D): void {
    g.fillStyle = this.highTide ? "#060a14" : "#030810";
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    for (const star of this.stars) {
      const twinkle = star.brightness * (0.7 + Math.sin(this.elapsed * 2 + star.x) * 0.3);
      g.globalAlpha = twinkle;
      g.fillStyle = "#c8d6e5";
      g.fillRect(star.x - star.size, star.y - star.size, star.size * 2, star.size * 2);
    }
    g.globalAlpha = 1;
    if (this.hunt) {
      const t = 0.5 + Math.sin(this.elapsed * 10) * 0.5;
      g.fillStyle = `rgba(239,68,68,${0.04 + t * 0.05})`;
      g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
  }

  private drawGlobe(g: CanvasRenderingContext2D, globe: Globe): void {
    const R = this.globeRadius;
    const atmo = g.createRadialGradient(GLOBE_CX, GLOBE_CY, R * 0.95, GLOBE_CX, GLOBE_CY, R * 1.15);
    atmo.addColorStop(0, this.highTide ? "rgba(220,170,60,0.14)" : "rgba(56,130,220,0.12)");
    atmo.addColorStop(1, "rgba(56,130,220,0)");
    g.fillStyle = atmo;
    g.fillRect(GLOBE_CX - R * 1.2, GLOBE_CY - R * 1.2, R * 2.4, R * 2.4);

    const layer = this.staticGlobeLayer(g, globe);
    if (layer) g.drawImage(layer, 0, 0, GAME_WIDTH, GAME_HEIGHT);

    g.save();
    g.beginPath();
    g.arc(GLOBE_CX, GLOBE_CY, R, 0, Math.PI * 2);
    g.clip();
    if (!layer) this.drawStaticClipped(g, globe);
    if (this.goldRush) this.drawRushLaneClipped(g, globe);
    this.drawDoorsClipped(g, globe);
    this.drawShipsClipped(g, globe);
    this.drawPrizeClipped(g, globe);
    this.drawRangeRingsClipped(g, globe);
    this.drawPlayersClipped(g, globe);
    this.drawHuntClipped(g, globe);
    g.restore();

    g.beginPath();
    g.arc(GLOBE_CX, GLOBE_CY, R, 0, Math.PI * 2);
    g.strokeStyle = "rgba(100,160,220,0.15)";
    g.lineWidth = 2;
    g.stroke();
  }

  /** Ocean, graticule, land and lanes, redrawn only when the camera or zoom changes. */
  private staticGlobeLayer(g: CanvasRenderingContext2D, globe: Globe): HTMLCanvasElement | null {
    const key = `${globe.lat.toFixed(3)}|${globe.lng.toFixed(3)}|${globe.radius}|${this.highTide ? 1 : 0}`;
    if (this.staticLayer && key === this.staticKey) return this.staticLayer;
    if (!this.staticLayer) {
      if (typeof document === "undefined") return null;
      this.staticLayer = document.createElement("canvas");
    }
    const scale = Math.max(1, Math.min(3, g.canvas.width / GAME_WIDTH || 1));
    const w = Math.round(GAME_WIDTH * scale);
    const h = Math.round(GAME_HEIGHT * scale);
    if (this.staticLayer.width !== w || this.staticLayer.height !== h) {
      this.staticLayer.width = w;
      this.staticLayer.height = h;
    }
    const lg = this.staticLayer.getContext("2d");
    if (!lg) return null;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.clearRect(0, 0, w, h);
    lg.scale(scale, scale);
    lg.beginPath();
    lg.arc(GLOBE_CX, GLOBE_CY, globe.radius, 0, Math.PI * 2);
    lg.clip();
    this.drawStaticClipped(lg, globe);
    this.staticKey = key;
    return this.staticLayer;
  }

  private drawStaticClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    const R = globe.radius;
    const ocean = g.createRadialGradient(GLOBE_CX - 60, GLOBE_CY - 80, 0, GLOBE_CX, GLOBE_CY, R);
    ocean.addColorStop(0, this.highTide ? "#13304f" : "#0f2847");
    ocean.addColorStop(1, "#071428");
    g.fillStyle = ocean;
    g.fillRect(GLOBE_CX - R, GLOBE_CY - R, R * 2, R * 2);
    this.drawGraticulesClipped(g, globe);
    this.drawLandClipped(g, globe);
    this.drawLanesClipped(g, globe);
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

  /**
   * Land rings that dip behind the globe are closed along the horizon circle
   * instead of with a straight chord, so Siberia never fills the North Atlantic.
   */
  private drawLandClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    g.fillStyle = "#132e1c";
    g.strokeStyle = "#1f5a2e";
    g.lineWidth = 0.6;
    const R = globe.radius;
    const horizon = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
      const dz = b.z - a.z;
      const t = dz !== 0 ? -a.z / dz : 0;
      let hx = a.x + (b.x - a.x) * t - globe.cx;
      let hy = a.y + (b.y - a.y) * t - globe.cy;
      const len = Math.hypot(hx, hy) || 1;
      hx = (hx / len) * R;
      hy = (hy / len) * R;
      return { x: globe.cx + hx, y: globe.cy + hy, ang: Math.atan2(hy, hx) };
    };
    const arcBetween = (from: number, to: number) => {
      let delta = (to - from) % (Math.PI * 2);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      g.arc(globe.cx, globe.cy, R, from, to, delta < 0);
    };
    for (const ring of LAND) {
      const pts: { x: number; y: number; z: number }[] = [];
      let visCount = 0;
      let start = -1;
      for (let i = 0; i < ring.length; i += 2) {
        const p = globeProject([ring[i + 1]!, ring[i]!], globe);
        pts.push(p);
        if (p.z >= 0) visCount++;
        else if (start < 0) start = pts.length - 1;
      }
      if (visCount === 0) continue;
      const n = pts.length;
      g.beginPath();
      if (start < 0) {
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < n; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
        g.closePath();
        g.fill();
        g.stroke();
        continue;
      }
      let firstEntry: number | null = null;
      let lastExit: number | null = null;
      for (let k = 1; k <= n; k++) {
        const i = (start + k) % n;
        const curr = pts[i]!;
        const prev = pts[(i + n - 1) % n]!;
        if (curr.z >= 0) {
          if (prev.z < 0) {
            const h = horizon(prev, curr);
            if (lastExit === null) { g.moveTo(h.x, h.y); firstEntry = h.ang; }
            else arcBetween(lastExit, h.ang);
          }
          g.lineTo(curr.x, curr.y);
        } else if (prev.z >= 0) {
          const h = horizon(curr, prev);
          g.lineTo(h.x, h.y);
          lastExit = h.ang;
        }
      }
      if (lastExit !== null && firstEntry !== null) arcBetween(lastExit, firstEntry);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  private drawLanesClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    g.strokeStyle = "rgba(80,140,200,0.1)";
    g.lineWidth = 0.8;
    for (const lane of this.lanes) this.strokeLane(g, globe, lane);
  }

  private drawRushLaneClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    if (!this.goldRush) return;
    const pulse = 0.5 + Math.sin(this.elapsed * 8) * 0.3;
    g.strokeStyle = `rgba(251,191,36,${pulse})`;
    g.lineWidth = 3;
    this.strokeLane(g, globe, this.lanes[this.goldRush.laneIdx]!);
  }

  private strokeLane(g: CanvasRenderingContext2D, globe: Globe, lane: Lane): void {
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

  private drawDoorsClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    const dragging = this.drags.size > 0;
    for (const door of DOORS) {
      const dp = globeProject(door.ll, globe);
      if (dp.z < 0.1) continue;
      const hovered = this.hoverDoor === door;
      const pulse = 1 + Math.sin(this.elapsed * 3.5) * 0.2;
      const r = (hovered ? 11 : dragging ? 8 : 6) * pulse;

      if (dragging) {
        g.beginPath();
        g.arc(dp.x, dp.y, DOOR_SNAP_PX, 0, Math.PI * 2);
        g.strokeStyle = hovered ? "rgba(252,211,77,0.9)" : "rgba(252,211,77,0.3)";
        g.lineWidth = hovered ? 2 : 1;
        g.setLineDash([4, 4]);
        g.stroke();
        g.setLineDash([]);
      }

      g.beginPath();
      g.arc(dp.x, dp.y, r + 3, 0, Math.PI * 2);
      g.fillStyle = hovered ? "rgba(255,200,60,0.2)" : "rgba(255,200,60,0.06)";
      g.fill();

      g.beginPath();
      g.arc(dp.x, dp.y, r, 0, Math.PI * 2);
      g.fillStyle = hovered ? "#fcd34d" : "rgba(252,211,77,0.5)";
      g.fill();

      g.font = "600 13px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillStyle = hovered ? "#fef3c7" : "rgba(252,211,77,0.65)";
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

  private drawPrizeClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    if (!this.prize) return;
    const pp = globeProject(this.prize.ll, globe);
    if (pp.z < 0) return;
    const pulse = 1 + Math.sin(this.elapsed * 6) * 0.15;
    g.beginPath();
    g.arc(pp.x, pp.y, 22 * pulse, 0, Math.PI * 2);
    g.strokeStyle = GOLD;
    g.globalAlpha = 0.6;
    g.lineWidth = 2;
    g.setLineDash([5, 5]);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    // chest
    g.fillStyle = "#b45309";
    g.fillRect(pp.x - 10, pp.y - 6, 20, 13);
    g.fillStyle = GOLD;
    g.fillRect(pp.x - 10, pp.y - 9, 20, 5);
    g.fillStyle = "#030810";
    g.fillRect(pp.x - 2, pp.y - 3, 4, 4);
    g.font = "700 14px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(3,8,16,0.8)";
    const label = `PRIZE ${this.prize.value} · ${Math.ceil(this.prize.remaining)}s`;
    g.strokeText(label, pp.x, pp.y + 12);
    g.fillStyle = GOLD;
    g.fillText(label, pp.x, pp.y + 12);
  }

  private drawPlayersClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const seat of this.seats) {
      if (!seat.parked) continue;
      const pp = globeProject(seat.ll, globe);
      if (pp.z < 0) continue;
      const p = seat.player;
      const hunted = this.hunt !== null && this.hunt.targetId === p.id;

      const pulse = 1 + Math.sin(this.elapsed * 5 + this.seats.indexOf(seat) * 1.5) * 0.15;
      g.beginPath();
      g.arc(pp.x, pp.y, 14 * pulse, 0, Math.PI * 2);
      g.fillStyle = hunted ? NAVY_RED : p.color;
      g.globalAlpha = hunted ? 0.35 : 0.15;
      g.fill();
      g.globalAlpha = 1;

      this.drawAnchor(g, pp.x, pp.y, 9, p.color);

      g.font = "700 11px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = p.color;
      g.fillText(p.name, pp.x + 13, pp.y - 8);
      if (seat.hold > 0) {
        g.font = "700 13px Bebas Neue, Impact, sans-serif";
        g.fillStyle = GOLD;
        g.fillText(`${seat.hold} x${holdMultiplier(seat.raidsSinceHaul)}`, pp.x + 13, pp.y + 6);
      }
    }
  }

  private drawAnchor(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
    g.save();
    g.translate(x, y);
    g.strokeStyle = "#030810";
    g.lineWidth = s * 0.55;
    g.lineCap = "round";
    this.anchorPath(g, s);
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = s * 0.3;
    this.anchorPath(g, s);
    g.stroke();
    g.restore();
  }

  private anchorPath(g: CanvasRenderingContext2D, s: number): void {
    g.beginPath();
    g.arc(0, -s * 0.75, s * 0.25, 0, Math.PI * 2);
    g.moveTo(0, -s * 0.5);
    g.lineTo(0, s * 0.85);
    g.moveTo(-s * 0.55, -s * 0.2);
    g.lineTo(s * 0.55, -s * 0.2);
    g.moveTo(-s * 0.8, s * 0.25);
    g.arc(0, s * 0.25, s * 0.8, Math.PI, 0, true);
  }

  private drawRangeRingsClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const seat of this.seats) {
      if (!seat.parked) continue;
      this.drawRing(g, globe, seat.ll, seat.player.color, seat.raidCooldown === 0 && seat.haulLock === 0 ? 0.35 : 0.18);
    }
  }

  private drawRing(g: CanvasRenderingContext2D, globe: Globe, ll: LatLng, color: string, alpha: number): void {
    const ring = globeRangeCircle(ll, SPOT_RANGE_KM, globe);
    const visible = ring.filter((pt) => pt.z > 0);
    if (visible.length < 3) return;

    g.beginPath();
    let started = false;
    for (const pt of ring) {
      if (pt.z > 0) {
        if (!started) { g.moveTo(pt.x, pt.y); started = true; }
        else g.lineTo(pt.x, pt.y);
      } else { started = false; }
    }
    if (ring[0]!.z > 0 && ring[ring.length - 1]!.z > 0) g.closePath();
    g.strokeStyle = color;
    g.globalAlpha = alpha;
    g.lineWidth = 1.5;
    g.setLineDash([6, 4]);
    g.stroke();
    g.setLineDash([]);

    g.globalAlpha = 0.05;
    g.fillStyle = color;
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

  private drawHuntClipped(g: CanvasRenderingContext2D, globe: Globe): void {
    if (!this.hunt) return;
    const seat = this.playerStates.get(this.hunt.targetId)!;
    const t = 1 - Math.max(0, this.hunt.remaining) / HUNT_WARNING_S;
    const ll = lerpLatLng(this.hunt.from, seat.ll, t);
    const pp = globeProject(ll, globe);
    const tp = globeProject(seat.ll, globe);
    if (pp.z < 0) return;
    const angle = Math.atan2(tp.y - pp.y, tp.x - pp.x);
    const pulse = 1 + Math.sin(this.elapsed * 12) * 0.2;
    g.beginPath();
    g.arc(pp.x, pp.y, 16 * pulse, 0, Math.PI * 2);
    g.strokeStyle = NAVY_RED;
    g.globalAlpha = 0.6;
    g.lineWidth = 2;
    g.stroke();
    g.globalAlpha = 1;
    // frigate: a wedge pointing at its target, with a wake
    g.save();
    g.translate(pp.x, pp.y);
    g.rotate(angle);
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(-9, -7);
    g.lineTo(-5, 0);
    g.lineTo(-9, 7);
    g.closePath();
    g.fillStyle = NAVY_RED;
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 1.2;
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.moveTo(-10, -3);
    g.lineTo(-26, -8);
    g.moveTo(-10, 3);
    g.lineTo(-26, 8);
    g.stroke();
    g.restore();
    g.font = "700 12px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillStyle = NAVY_RED;
    g.fillText(`NAVY ${Math.max(0, this.hunt.remaining).toFixed(1)}s`, pp.x, pp.y - 18);
  }

  // ---- HUD ----------------------------------------------------------------

  private drawHUD(g: CanvasRenderingContext2D, globe: Globe): void {
    const remaining = Math.max(0, GAME_DURATION_S - this.elapsed);
    drawTimerBar(g, GAME_WIDTH, remaining, GAME_DURATION_S);

    g.font = "700 28px Bebas Neue, Impact, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "alphabetic";
    g.fillStyle = remaining < LAST_CALL_S ? "#FF3D7A" : "#94a3b8";
    g.fillText(`${Math.ceil(remaining)}`, GAME_WIDTH - 18, 48);
    g.font = "400 11px Outfit, sans-serif";
    g.fillText("sec", GAME_WIDTH - 18, 60);

    // Event line above the globe.
    g.textAlign = "center";
    g.textBaseline = "top";
    if (this.hunt) {
      const seat = this.playerStates.get(this.hunt.targetId)!;
      const pulse = 0.7 + Math.sin(this.elapsed * 10) * 0.3;
      g.globalAlpha = pulse;
      g.fillStyle = NAVY_RED;
      g.font = "700 15px Outfit, sans-serif";
      g.fillText(`NAVY HUNTING ${seat.player.name.toUpperCase()} · ${Math.max(0, this.hunt.remaining).toFixed(1)}s · HAUL HOME!`, GLOBE_CX, 36);
      g.globalAlpha = 1;
    } else if (this.goldRush) {
      const pulse = 0.7 + Math.sin(this.elapsed * 6) * 0.3;
      g.globalAlpha = pulse;
      g.fillStyle = GOLD;
      g.font = "700 14px Outfit, sans-serif";
      g.fillText(`GOLD RUSH ${laneLabel(this.lanes[this.goldRush.laneIdx]!)} · ${Math.ceil(this.goldRush.remaining)}s`, GLOBE_CX, 36);
      g.globalAlpha = 1;
    } else if (this.prize) {
      g.fillStyle = GOLD;
      g.font = "700 14px Outfit, sans-serif";
      g.fillText(`PRIZE ${this.prize.value} at ${this.prize.name} · first net over it wins · ${Math.ceil(this.prize.remaining)}s`, GLOBE_CX, 36);
    } else if (this.highTide) {
      g.fillStyle = "rgba(251,191,36,0.7)";
      g.font = "700 14px Outfit, sans-serif";
      g.fillText("HIGH TIDE · traffic surging · Navy hunting faster", GLOBE_CX, 36);
    }

    const totals = this.seats.map((s) => ({ id: s.player.id, total: s.score + haulValue(s.hold, s.raidsSinceHaul) }));
    const leader = Math.max(...totals.map((t) => t.total));
    for (const seat of this.seats) {
      if (seat.player.kind === "human") this.drawHumanPanel(g, seat, totals, leader);
      else this.drawBotPanel(g, seat, totals, leader);
    }

    // Legend
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

    // Prompt for humans who have not dropped anchor yet.
    const waiting = this.seats.filter((s) => s.player.kind === "human" && !s.parked);
    if (waiting.length > 0 && this.drags.size === 0) {
      const promptY = Math.min(GLOBE_CY + this.globeRadius + 14, GAME_HEIGHT - 52);
      g.fillStyle = "rgba(3,8,16,0.7)";
      g.beginPath();
      g.roundRect(GLOBE_CX - 230, promptY, 460, 36, 8);
      g.fill();
      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = waiting[0]!.player.color;
      const single = this.seats.filter((s) => s.player.kind === "human").length === 1;
      g.fillText(single ? "Tap the globe or drag your anchor where the ships sail" : `${waiting.map((s) => s.player.name).join(", ")}: drag your anchor onto the globe`, GLOBE_CX, promptY + 18);
    }

    if (this.globeRadius !== GLOBE_R_DEFAULT) {
      const zoomPct = Math.round((this.globeRadius / GLOBE_R_DEFAULT) * 100);
      g.font = "600 11px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = "rgba(148,163,184,0.6)";
      g.fillText(`Zoom ${zoomPct}%`, 14, 34);
    }
    void globe;
  }

  private panelBase(g: CanvasRenderingContext2D, seat: Seat, totals: { id: string; total: number }[], leader: number): void {
    const { x, y, w, h } = seat.panel;
    const hunted = this.hunt !== null && this.hunt.targetId === seat.player.id;
    g.fillStyle = "rgba(3,8,16,0.78)";
    g.beginPath();
    g.roundRect(x, y, w, h, 12);
    g.fill();
    if (hunted) {
      const pulse = 0.4 + Math.sin(this.elapsed * 12) * 0.4;
      g.strokeStyle = `rgba(239,68,68,${pulse})`;
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 11);
      g.stroke();
    } else if (seat.flash > 0) {
      g.strokeStyle = `rgba(251,191,36,${Math.min(1, seat.flash)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(x + 1, y + 1, w - 2, h - 2, 11);
      g.stroke();
    }

    g.beginPath();
    g.arc(x + 22, y + 22, 7, 0, Math.PI * 2);
    g.fillStyle = seat.player.color;
    g.fill();

    g.font = "600 15px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = "#e2e8f0";
    g.fillText(seat.player.name, x + 38, y + 22);
    let tagX = x + 38 + g.measureText(seat.player.name).width + 8;
    const total = totals.find((t) => t.id === seat.player.id)?.total ?? 0;
    if (total === leader && leader > 0 && totals.filter((t) => t.total === leader).length === 1) {
      g.font = "700 10px Outfit, sans-serif";
      g.fillStyle = GOLD;
      g.fillText("LEADER", tagX, y + 22);
      tagX += g.measureText("LEADER").width + 10;
    } else if (isUnderdog(seat.player.id, totals)) {
      g.font = "700 10px Outfit, sans-serif";
      g.fillStyle = "#B8FF3D";
      g.fillText("UNDERDOG · 2x MOVE RECHARGE", tagX, y + 22);
      tagX += g.measureText("UNDERDOG · 2x MOVE RECHARGE").width + 10;
    }
    if (seat.quipLife > 0) {
      g.globalAlpha = Math.min(1, seat.quipLife / 0.4);
      g.font = "italic 500 12px Outfit, sans-serif";
      g.fillStyle = "rgba(226,232,240,0.8)";
      g.fillText(`"${seat.quip}"`, tagX, y + 22);
      g.globalAlpha = 1;
    }

    g.font = "700 30px Bebas Neue, Impact, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillStyle = seat.player.color;
    g.fillText(String(seat.displayScore), x + w - 16, y + 24);
  }

  private drawHoldLine(g: CanvasRenderingContext2D, seat: Seat, y: number): void {
    const { x, w } = seat.panel;
    const mult = holdMultiplier(seat.raidsSinceHaul);
    const hunted = this.hunt !== null && this.hunt.targetId === seat.player.id;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = "700 11px Outfit, sans-serif";
    g.fillStyle = "rgba(148,163,184,0.7)";
    g.fillText("HOLD", x + 14, y);
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.fillStyle = seat.hold > 0 ? (hunted ? NAVY_RED : GOLD) : "rgba(148,163,184,0.5)";
    g.fillText(String(seat.hold), x + 52, y + 1);
    const holdW = g.measureText(String(seat.hold)).width;
    // multiplier chip
    const chipX = x + 60 + holdW;
    g.fillStyle = mult >= MAX_MULT ? "#FF3D7A" : mult >= 2 ? GOLD : "rgba(148,163,184,0.25)";
    g.beginPath();
    g.roundRect(chipX, y - 10, 40, 20, 6);
    g.fill();
    g.font = "700 13px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillStyle = mult >= 2 ? "#030810" : "#e2e8f0";
    g.fillText(`x${mult}`, chipX + 20, y + 1);
    // progress to next multiplier
    const barX = chipX + 48;
    const barW = 70;
    g.fillStyle = "rgba(148,163,184,0.15)";
    g.fillRect(barX, y - 3, barW, 6);
    if (mult < MAX_MULT) {
      g.fillStyle = GOLD;
      g.fillRect(barX, y - 3, barW * ((seat.raidsSinceHaul % 2) / 2), 6);
    } else {
      g.fillStyle = "#FF3D7A";
      g.fillRect(barX, y - 3, barW, 6);
    }
    g.font = "400 10px Outfit, sans-serif";
    g.textAlign = "left";
    g.fillStyle = "rgba(148,163,184,0.6)";
    const banked = haulValue(seat.hold, seat.raidsSinceHaul);
    g.fillText(seat.hold > 0 ? `haul = ${banked}` : "raid to fill", barX + barW + 8, y);
    // moves on the right
    g.textAlign = "right";
    g.font = "600 11px Outfit, sans-serif";
    g.fillStyle = seat.reparks > 0 ? "#e2e8f0" : "rgba(148,163,184,0.5)";
    const movesLabel = seat.reparks >= REPARK_COUNT
      ? `${seat.reparks} moves`
      : `${seat.reparks} move${seat.reparks === 1 ? "" : "s"} · +1 in ${Math.ceil(MOVE_RECHARGE_S - seat.moveCharge)}s`;
    g.fillText(movesLabel, x + w - 16, y);
  }

  private drawHumanPanel(g: CanvasRenderingContext2D, seat: Seat, totals: { id: string; total: number }[], leader: number): void {
    this.panelBase(g, seat, totals, leader);
    const { x, y } = seat.panel;
    this.drawHoldLine(g, seat, y + 54);

    // Net readout
    const net = seat.parked ? scoreShipsInRange(this.ships, seat.ll, this.lanes) : 0;
    const prizeHere = seat.parked && prizeInRange(this.prize, seat.ll);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = "600 11px Outfit, sans-serif";
    g.fillStyle = "rgba(148,163,184,0.7)";
    const netY = y + 76;
    if (!seat.parked) {
      g.fillText(seat.armed ? "ARMED · tap the globe to drop anchor" : "Not anchored · drag the anchor onto the globe", x + 14, netY);
    } else {
      g.fillText("IN NET", x + 14, netY);
      g.font = "700 16px Bebas Neue, Impact, sans-serif";
      g.fillStyle = net > 0 || prizeHere ? "#e2e8f0" : "rgba(148,163,184,0.5)";
      g.fillText(prizeHere && this.prize ? `${net} + PRIZE ${this.prize.value}` : String(net), x + 60, netY + 1);
      if (seat.armed) {
        g.font = "600 11px Outfit, sans-serif";
        g.fillStyle = seat.player.color;
        g.fillText("ARMED · tap the globe to move", x + 160, netY);
      }
    }

    // Buttons
    const ready = seat.parked && seat.raidCooldown === 0 && seat.haulLock === 0;
    const b = seat.raidBtn;
    const hot = ready && (net >= 20 || prizeHere);
    g.fillStyle = ready ? (hot ? GOLD : "#164e63") : "#182334";
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, 10);
    g.fill();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = hot ? "#030810" : ready ? "#F4F7FB" : "rgba(244,247,251,0.45)";
    g.font = "700 24px Bebas Neue, Impact, sans-serif";
    const raidLabel = !seat.parked ? "RAID" : seat.haulLock > 0 ? `COUNTING ${seat.haulLock.toFixed(1)}s` : seat.raidCooldown > 0 ? `RELOAD ${seat.raidCooldown.toFixed(1)}s` : hot ? "RAID NOW!" : "RAID";
    g.fillText(raidLabel, b.x + b.w / 2, b.y + b.h / 2 - (ready ? 6 : 0));
    if (ready) {
      g.font = "400 10px Outfit, sans-serif";
      g.fillStyle = hot ? "rgba(3,8,16,0.7)" : "rgba(244,247,251,0.6)";
      g.fillText(`take ${net + (prizeHere && this.prize ? this.prize.value : 0)} into hold`, b.x + b.w / 2, b.y + b.h / 2 + 14);
    }
    if (seat.raidCooldown > 0 && seat.parked) {
      g.fillStyle = "rgba(251,191,36,0.6)";
      g.fillRect(b.x + 8, b.y + b.h - 5, (b.w - 16) * (1 - seat.raidCooldown / RAID_COOLDOWN_S), 3);
    }

    const hb = seat.haulBtn;
    const canHaul = seat.hold > 0 && seat.haulLock === 0;
    const hunted = this.hunt !== null && this.hunt.targetId === seat.player.id;
    g.fillStyle = canHaul ? (hunted ? NAVY_RED : "#7c2d12") : "#182334";
    g.beginPath();
    g.roundRect(hb.x, hb.y, hb.w, hb.h, 10);
    g.fill();
    g.fillStyle = canHaul ? "#F4F7FB" : "rgba(244,247,251,0.45)";
    g.font = "700 24px Bebas Neue, Impact, sans-serif";
    g.fillText(hunted && canHaul ? "HAUL NOW!" : "HAUL HOME", hb.x + hb.w / 2, hb.y + hb.h / 2 - (canHaul ? 6 : 0));
    if (canHaul) {
      g.font = "400 10px Outfit, sans-serif";
      g.fillStyle = "rgba(244,247,251,0.7)";
      g.fillText(`bank ${haulValue(seat.hold, seat.raidsSinceHaul)}`, hb.x + hb.w / 2, hb.y + hb.h / 2 + 14);
    }

    const ab = seat.anchorBtn;
    const anchorHot = seat.armed || this.drags.size > 0 && [...this.drags.values()].some((d) => d.seat === seat);
    g.fillStyle = anchorHot ? seat.player.color : "#182334";
    g.beginPath();
    g.roundRect(ab.x, ab.y, ab.w, ab.h, 10);
    g.fill();
    this.drawAnchor(g, ab.x + ab.w / 2, ab.y + ab.h / 2 - 4, 13, anchorHot ? "#030810" : seat.player.color);
    g.font = "600 9px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillStyle = anchorHot ? "#030810" : "rgba(244,247,251,0.6)";
    g.fillText(seat.parked ? `DRAG · ${seat.reparks}` : "DRAG ME", ab.x + ab.w / 2, ab.y + ab.h - 8);
  }

  private drawBotPanel(g: CanvasRenderingContext2D, seat: Seat, totals: { id: string; total: number }[], leader: number): void {
    this.panelBase(g, seat, totals, leader);
    this.drawHoldLine(g, seat, seat.panel.y + 46);
  }

  private drawDrags(g: CanvasRenderingContext2D, globe: Globe): void {
    for (const d of this.drags.values()) {
      if (!d.moved) continue;
      const ll = this.pickSpot(d.x, d.y);
      if (ll) {
        const net = netValue(this.ships, ll, this.lanes, this.prize);
        g.save();
        g.beginPath();
        g.arc(GLOBE_CX, GLOBE_CY, this.globeRadius, 0, Math.PI * 2);
        g.clip();
        this.drawRing(g, globe, ll, d.seat.player.color, 0.8);
        g.restore();
        g.font = "700 16px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.lineWidth = 4;
        g.strokeStyle = "rgba(3,8,16,0.8)";
        const label = this.hoverDoor ? `${this.hoverDoor.name.toUpperCase()} · NET ${net}` : `NET ${net}`;
        g.strokeText(label, d.x, d.y - 22);
        g.fillStyle = net >= 20 ? GOLD : "#e2e8f0";
        g.fillText(label, d.x, d.y - 22);
      }
      this.drawAnchor(g, d.x, d.y, 16, ll ? d.seat.player.color : "rgba(148,163,184,0.6)");
    }
  }

  private drawPopups(g: CanvasRenderingContext2D): void {
    for (const p of this.popups) {
      const t = 1 - p.life / p.maxLife;
      g.globalAlpha = Math.min(1, p.life / 0.25);
      g.font = `700 ${p.size}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(3,8,16,0.7)";
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
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Raids", value: String(s.raids) });
      out.push({ playerId: s.player.id, label: "Biggest haul", value: String(s.biggestHaul) });
      if (s.seized > 0) out.push({ playerId: s.player.id, label: "Seized", value: String(s.seized) });
      if (s.prizes > 0) out.push({ playerId: s.player.id, label: "Prizes", value: String(s.prizes) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("wheel", this.wheelHandler);
    c.removeEventListener("touchstart", this.touchStartHandler);
    c.removeEventListener("touchmove", this.touchMoveHandler);
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerCancel);
    this.drags.clear();
  }
}
