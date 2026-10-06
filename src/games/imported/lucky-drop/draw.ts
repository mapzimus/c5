import { COLORS, RADII } from "./physics";

/** C5's own palette (matches the rest of the suite). */
export const UI = {
  text: "#F4F7FB",
  muted: "#94a3b8",
  dim: "#64748b",
  panel: "rgba(7,11,20,0.55)",
  line: "rgba(244,247,251,0.12)",
  lime: "#B8FF3D",
  hot: "#FF3D7A",
  warn: "#FFB020",
} as const;

/** Big numbers and headings in the suite's display face. */
export function display(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number,
  color: string = UI.text, align: CanvasTextAlign = "left"): void {
  g.fillStyle = color;
  g.font = `700 ${size}px Bebas Neue, Impact, sans-serif`;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(text, x, y);
}

export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number,
  color: string = UI.text, align: CanvasTextAlign = "left"): void {
  g.fillStyle = color;
  g.font = `600 ${size}px Outfit, sans-serif`;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(text, x, y);
}

export function drawOrb(g: CanvasRenderingContext2D, x: number, y: number, tier: number, alpha = 1, radius: number = RADII[tier]): void {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = COLORS[tier];
  g.shadowColor = "#0b160943";
  g.shadowBlur = 8;
  g.shadowOffsetY = 5;
  g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.fill();
  g.shadowColor = "transparent";
  g.strokeStyle = "#ffffff32";
  g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, radius - 4, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#183021";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = String(2 ** tier);
  g.font = `700 ${Math.max(15, Math.min(radius * 0.78, (radius * 2.6) / text.length))}px Outfit, sans-serif`;
  g.fillText(text, x, y + 1);
  g.restore();
}
