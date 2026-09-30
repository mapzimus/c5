import type { Arena, Disc, MatchPlayer, PowerUp } from "./types";
import { TUNING } from "./types";
import { GAME_WIDTH, GAME_HEIGHT } from "../../../core/types";
import { sdf, sdfSolids } from "./arena";
import type { World } from "./world";

const TAU = Math.PI * 2;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

export function worldScale(_arena: Arena): number {
  return Math.min(GAME_WIDTH, GAME_HEIGHT) * 0.42;
}

export function worldToScreen(arena: Arena, wx: number, wy: number): { sx: number; sy: number } {
  const s = worldScale(arena);
  return { sx: CX + wx * s, sy: CY + wy * s };
}

export function screenToWorld(arena: Arena, sx: number, sy: number): { x: number; y: number } {
  const s = worldScale(arena);
  return { x: (sx - CX) / s, y: (sy - CY) / s };
}

export function drawBackground(g: CanvasRenderingContext2D): void {
  const bg = g.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  bg.addColorStop(0, "#0c1628");
  bg.addColorStop(1, "#1d3a4f");
  g.fillStyle = bg;
  g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
}

export function drawArena(g: CanvasRenderingContext2D, arena: Arena): void {
  const s = worldScale(arena);
  const res = 3;
  const x0 = Math.floor(CX - arena.ax * s - 20);
  const y0 = Math.floor(CY - arena.ay * s - 20);
  const x1 = Math.ceil(CX + arena.ax * s + 20);
  const y1 = Math.ceil(CY + arena.ay * s + 20);

  for (let py = y0; py < y1; py += res) {
    for (let px = x0; px < x1; px += res) {
      const wx = (px - CX) / s;
      const wy = (py - CY) / s;
      const d = sdf(arena, wx, wy);
      if (d < 0) {
        const edge = Math.min(1, -d * s / 8);
        const sd = sdfSolids(arena, wx, wy, arena.scale);
        const rim = sd < 0.03 && sd > -0.04 ? 0.3 : 0;
        const bright = 0.18 + edge * 0.12 + rim;
        g.fillStyle = `rgba(${Math.floor(80 + bright * 60)},${Math.floor(120 + bright * 80)},${Math.floor(160 + bright * 100)},1)`;
        g.fillRect(px, py, res, res);
      }
    }
  }

  // bumpers
  for (const b of arena.bumpers) {
    if (b.fade <= 0) continue;
    const { sx, sy } = worldToScreen(arena, b.x, b.y);
    const r = b.r * s;
    const pulse = 1 + b.hitT * 0.3;
    g.globalAlpha = b.fade;
    g.beginPath();
    g.arc(sx, sy, r * pulse, 0, TAU);
    g.fillStyle = b.hitT > 0 ? "#ff6b3d" : "#5e7f9e";
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.stroke();
    g.globalAlpha = 1;
  }

  // walls
  for (const w of arena.walls) {
    if (w.fade <= 0) continue;
    const p1 = worldToScreen(arena, w.x1, w.y1);
    const p2 = worldToScreen(arena, w.x2, w.y2);
    g.globalAlpha = w.fade;
    g.beginPath();
    g.moveTo(p1.sx, p1.sy);
    g.lineTo(p2.sx, p2.sy);
    g.strokeStyle = w.hitT > 0 ? "#ff6b3d" : "#7ea8c4";
    g.lineWidth = w.r * s * 2;
    g.lineCap = "round";
    g.stroke();
    g.globalAlpha = 1;
  }
}

export function drawDisc(g: CanvasRenderingContext2D, d: Disc, arena: Arena, color: string, light: string): void {
  if (d.dead) return;
  const s = worldScale(arena);
  const { sx, sy } = worldToScreen(arena, d.x, d.y);
  const r = d.r * s;

  if (d.falling) {
    const t = d.fallT;
    const scale = 1 - t * 0.6;
    g.globalAlpha = 1 - t;
    g.save();
    g.translate(sx, sy);
    g.scale(scale, scale);
    drawDiscBody(g, 0, 0, r, d, color, light);
    g.restore();
    g.globalAlpha = 1;
    return;
  }

  const spawn = d.spawnT < 1 ? d.spawnT : 1;
  if (spawn <= 0) return;
  g.globalAlpha = spawn;
  g.save();
  g.translate(sx, sy);
  g.scale(spawn, spawn);
  drawDiscBody(g, 0, 0, r, d, color, light);
  g.restore();
  g.globalAlpha = 1;
}

function drawDiscBody(g: CanvasRenderingContext2D, x: number, y: number, r: number, d: Disc, color: string, light: string): void {
  // save ring
  if (d.saveT > 0) {
    g.beginPath();
    g.arc(x, y, r + 4, 0, TAU);
    g.strokeStyle = "#7fff7f";
    g.lineWidth = 3;
    g.globalAlpha *= Math.min(1, d.saveT);
    g.stroke();
    g.globalAlpha = 1;
  }

  // body
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, light);
  grad.addColorStop(1, color);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.4)";
  g.lineWidth = 2;
  g.stroke();

  // power-up indicators
  if (d.bomb) {
    g.beginPath();
    g.arc(x, y, r + 3, 0, TAU);
    g.strokeStyle = "#ff3333";
    g.lineWidth = 2;
    g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
  }
  if (d.turbo) {
    g.beginPath();
    g.arc(x, y, r + 3, 0, TAU);
    g.strokeStyle = "#ffcc00";
    g.lineWidth = 2;
    g.stroke();
  }
  if (d.life) {
    g.beginPath();
    g.arc(x, y, r + 3, 0, TAU);
    g.strokeStyle = "#33ff66";
    g.lineWidth = 2;
    g.stroke();
  }

  // googly eyes
  const ex = Math.cos(d.look) * r * 0.3;
  const ey = Math.sin(d.look) * r * 0.3;
  const er = r * 0.26;
  const pr = er * 0.55;
  for (const side of [-1, 1]) {
    const px = x + Math.cos(d.look + side * 0.5) * r * 0.32;
    const py = y + Math.sin(d.look + side * 0.5) * r * 0.32;
    g.beginPath();
    g.arc(px, py, er, 0, TAU);
    g.fillStyle = "#fff";
    g.fill();
    g.beginPath();
    g.arc(px + ex * 0.25, py + ey * 0.25, pr, 0, TAU);
    g.fillStyle = "#111";
    g.fill();
  }
}

export function drawAim(g: CanvasRenderingContext2D, d: Disc, arena: Arena, world: World, color: string, hidden: boolean): void {
  if (!d.aim || d.dead || d.falling) return;
  if (hidden) return;

  const s = worldScale(arena);
  const { sx, sy } = worldToScreen(arena, d.x, d.y);
  const pw = d.aim.power;
  const speed = TUNING.maxLaunchSpeed * pw * (d.turbo ? TUNING.turboMul : 1);
  const stopDist = world.stopDistance(speed);

  const ex = sx + d.aim.dx * stopDist * s;
  const ey = sy + d.aim.dy * stopDist * s;

  g.setLineDash([6, 6]);
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(ex, ey);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.globalAlpha = 0.5 + pw * 0.5;
  g.stroke();
  g.setLineDash([]);

  // power indicator circle at disc
  g.beginPath();
  g.arc(sx, sy, d.r * s + 6, -Math.PI / 2, -Math.PI / 2 + TAU * pw);
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.stroke();
  g.globalAlpha = 1;
}

export function drawPowerups(g: CanvasRenderingContext2D, powerups: PowerUp[], arena: Arena, time: number): void {
  const s = worldScale(arena);
  for (const pu of powerups) {
    if (pu.gone) continue;
    const { sx, sy } = worldToScreen(arena, pu.x, pu.y);
    const r = pu.r * s;
    const bob = Math.sin(time * 3 + pu.x * 7) * 3;
    const pulse = 1 + Math.sin(time * 5) * 0.08;

    const colors: Record<string, string> = {
      bomb: "#ff3333",
      turbo: "#ffcc00",
      giant: "#cc66ff",
      life: "#33ff66",
      clone: "#33ccff",
    };

    g.save();
    g.translate(sx, sy + bob);
    g.scale(pulse, pulse);
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fillStyle = colors[pu.type] ?? "#fff";
    g.globalAlpha = 0.85;
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.stroke();
    g.globalAlpha = 1;

    // icon letter
    g.fillStyle = "#000";
    g.font = `bold ${Math.floor(r * 1.2)}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const letters: Record<string, string> = { bomb: "B", turbo: "T", giant: "G", life: "L", clone: "C" };
    g.fillText(letters[pu.type] ?? "?", 0, 1);
    g.restore();
  }
}

export function drawHUD(
  g: CanvasRenderingContext2D,
  players: MatchPlayer[],
  round: number,
  totalRounds: number,
  phase: string,
  turn: number,
  currentPlayer: number,
  hurryTimer: number | null,
): void {
  // round indicator
  g.fillStyle = "#94a3b8";
  g.font = "600 18px Outfit, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "top";
  g.fillText(`Round ${round} / ${totalRounds}`, CX, 12);

  // arena name (shown during intro)
  if (phase === "intro") return;

  // player score strip
  const stripW = Math.min(600, players.length * 150);
  const startX = CX - stripW / 2;
  const itemW = stripW / players.length;

  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const px = startX + i * itemW + itemW / 2;
    const py = GAME_HEIGHT - 44;

    g.fillStyle = p.color;
    g.font = "700 16px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(p.name, px, py);

    g.fillStyle = "#F4F7FB";
    g.font = "600 14px Outfit, sans-serif";
    g.fillText(`W: ${p.wins}  KO: ${p.kos}`, px, py + 18);

    if (i === currentPlayer && (phase === "plan" || phase === "aim")) {
      g.strokeStyle = p.color;
      g.lineWidth = 2;
      g.strokeRect(px - itemW / 2 + 4, py - 14, itemW - 8, 42);
    }
  }

  // hurry timer
  if (hurryTimer != null && hurryTimer > 0) {
    g.fillStyle = hurryTimer < 3 ? "#ff3333" : "#ffcc00";
    g.font = "700 28px Outfit, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "top";
    g.fillText(`${Math.ceil(hurryTimer)}`, GAME_WIDTH - 20, 12);
  }

  // turn indicator
  if (phase === "plan" || phase === "aim") {
    g.fillStyle = "#94a3b8";
    g.font = "600 14px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(`Turn ${turn}`, 20, 12);
  }
}

export function drawBanner(g: CanvasRenderingContext2D, text: string, sub: string, color: string): void {
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.fillRect(0, GAME_HEIGHT / 2 - 60, GAME_WIDTH, 120);
  g.fillStyle = color;
  g.font = "700 56px Bebas Neue, Impact, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, CX, GAME_HEIGHT / 2 - 10);
  if (sub) {
    g.fillStyle = "#F4F7FB";
    g.font = "600 22px Outfit, sans-serif";
    g.fillText(sub, CX, GAME_HEIGHT / 2 + 30);
  }
}
