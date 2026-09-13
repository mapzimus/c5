import type { Player } from "./types";

export function fillArena(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#0c1628");
  sky.addColorStop(0.55, "#101a30");
  sky.addColorStop(1, "#071018");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
}

export function drawPlayerOrb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  player: Player,
  options: { stunned?: boolean; label?: string } = {},
): void {
  ctx.save();
  ctx.translate(x, y);

  ctx.shadowColor = player.color;
  ctx.shadowBlur = options.stunned ? 6 : 18;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = options.stunned ? "#6b7280" : player.color;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(-radius * 0.22, -radius * 0.28, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();

  ctx.fillStyle = "#070b14";
  ctx.font = `700 ${Math.max(12, radius)}px Outfit, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(options.label ?? player.name[0] ?? "?", 0, 1);
  ctx.restore();
}

export function drawTimerBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  remaining: number,
  total: number,
): void {
  const t = Math.max(0, remaining / total);
  ctx.fillStyle = "rgba(7,11,20,0.55)";
  ctx.fillRect(40, 18, width - 80, 10);
  ctx.fillStyle = t < 0.2 ? "#FF3D7A" : "#3EE0FF";
  ctx.fillRect(40, 18, (width - 80) * t, 10);
}

export function drawWindStreaks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dir: number,
  strength: number,
  time: number,
): void {
  if (strength <= 0.05) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.35, strength * 0.45);
  ctx.strokeStyle = "#9ad9ff";
  ctx.lineWidth = 2;
  const count = 18;
  for (let i = 0; i < count; i += 1) {
    const y = ((i * 73 + time * 80) % height);
    const x = ((i * 140 + time * 420 * dir) % (width + 200)) - 100;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 70 * dir, y + Math.sin(time + i) * 6);
    ctx.stroke();
  }
  ctx.restore();
}
