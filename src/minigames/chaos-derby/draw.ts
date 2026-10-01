import type { Extra, Hat, RacerSpec } from "./rules";
import type { Mood } from "./world";

/** Everything needed to draw one racer, in the racer's own frame (origin = body centre). */
export interface RacerLook {
  spec: RacerSpec;
  w: number;
  h: number;
  lane: number;
  mood: Mood;
  dir: 1 | -1;
  stride: number;
  /** "run" uses the runner's gait, "air" tucked, "flail" kicking, "limp" lying still, "idle" standing. */
  legs: "run" | "air" | "flail" | "limp" | "idle";
  /** "swing" uses the runner's gait, "up" both up, "flail", "wave" one arm waving, "limp". */
  arms: "swing" | "up" | "flail" | "wave" | "limp";
  time: number;
  boost: boolean;
  charred: boolean;
  /** Vertical speed, for googly pupils and hop stretch. */
  vy: number;
  /** 0..1 squash after a landing. */
  squash: number;
  /** Face full of cream pie. */
  pie?: boolean;
  /** Strapped into a jetpack. */
  jet?: boolean;
}

const INK = "#131a2a";
const OUTLINE = "rgba(10,14,24,0.7)";

/** A version of a runner's colour that reads on the dark UI (names, markers). */
export function labelColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.42 ? shade(hex, lum < 0.2 ? 0.7 : 0.45) : hex;
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c + amount * (amount > 0 ? 255 - c : c))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

interface Frame {
  top: number;
  bottom: number;
  hw: number;
  bh: number;
  legLen: number;
}

interface Eye {
  x: number;
  y: number;
  r: number;
}

function frameOf(spec: RacerSpec): Frame {
  const share = spec.gait === "float" ? 0.12 : spec.legs === "long" ? 0.4 : spec.legs === "stubby" ? 0.2 : 0.3;
  const legLen = spec.h * share;
  const top = -spec.h / 2;
  const bottom = spec.h / 2 - legLen;
  return { top, bottom, hw: spec.w / 2, bh: bottom - top, legLen };
}

function hash(text: string, i: number): number {
  let x = i * 374761393;
  for (let k = 0; k < text.length; k += 1) x = Math.imul(x ^ text.charCodeAt(k), 668265263);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

function blobPath(g: CanvasRenderingContext2D, spec: RacerSpec, f: Frame, time: number): void {
  const { top, bottom, hw, bh } = f;
  g.beginPath();
  switch (spec.shape) {
    case "ball":
      g.ellipse(0, (top + bottom) / 2, hw, bh / 2, 0, 0, Math.PI * 2);
      return;
    case "noodle":
    case "pickle":
      g.roundRect(-hw, top, hw * 2, bh, hw);
      return;
    case "cube":
      g.roundRect(-hw, top, hw * 2, bh, 5);
      return;
    case "wide":
      g.roundRect(-hw, top, hw * 2, bh, bh * 0.45);
      return;
    case "pear":
      g.moveTo(0, top);
      g.bezierCurveTo(hw * 0.8, top, hw * 0.55, top + bh * 0.4, hw, top + bh * 0.72);
      g.bezierCurveTo(hw * 1.12, bottom, hw * 0.3, bottom, 0, bottom);
      g.bezierCurveTo(-hw * 0.3, bottom, -hw * 1.12, bottom, -hw, top + bh * 0.72);
      g.bezierCurveTo(-hw * 0.55, top + bh * 0.4, -hw * 0.8, top, 0, top);
      g.closePath();
      return;
    case "jelly": {
      const mid = top + bh * 0.5;
      g.moveTo(-hw, mid);
      g.ellipse(0, mid, hw, bh * 0.5, 0, Math.PI, 0);
      g.lineTo(hw, bottom - 2);
      for (let i = 0; i <= 6; i += 1) {
        const x = hw - (hw * 2 * i) / 6;
        g.lineTo(x, bottom - 2 + Math.sin(time * 9 + i * 1.3) * 2.5);
      }
      g.closePath();
      return;
    }
    case "egg":
      g.moveTo(0, top);
      g.bezierCurveTo(hw * 0.85, top, hw * 1.05, top + bh * 0.55, hw * 0.95, top + bh * 0.75);
      g.bezierCurveTo(hw * 0.85, bottom, hw * 0.35, bottom, 0, bottom);
      g.bezierCurveTo(-hw * 0.35, bottom, -hw * 0.85, bottom, -hw * 0.95, top + bh * 0.75);
      g.bezierCurveTo(-hw * 1.05, top + bh * 0.55, -hw * 0.85, top, 0, top);
      g.closePath();
      return;
    case "ghost": {
      const mid = top + hw;
      g.moveTo(-hw, mid);
      g.arc(0, mid, hw, Math.PI, 0);
      g.lineTo(hw, bottom);
      for (let i = 0; i <= 8; i += 1) {
        const x = hw - (hw * 2 * i) / 8;
        g.lineTo(x, bottom + (i % 2 ? -6 : 2) + Math.sin(time * 7 + i) * 2.5);
      }
      g.closePath();
      return;
    }
    case "slug":
      g.moveTo(hw, bottom);
      g.lineTo(-hw * 0.7, bottom);
      g.quadraticCurveTo(-hw * 1.05, bottom, -hw, bottom - bh * 0.25);
      g.quadraticCurveTo(-hw * 0.5, top + bh * 0.25, hw * 0.35, top);
      g.quadraticCurveTo(hw * 1.05, top - 2, hw, bottom - bh * 0.35);
      g.closePath();
      return;
    case "taco":
      g.moveTo(-hw, top + bh * 0.32);
      g.ellipse(0, top + bh * 0.32, hw, bh * 0.68, 0, Math.PI, 0, true);
      g.closePath();
      return;
    case "cone":
      g.moveTo(-hw * 0.12, top + 3);
      g.lineTo(-hw, bottom - 5);
      g.quadraticCurveTo(-hw, bottom, -hw + 6, bottom);
      g.lineTo(hw - 6, bottom);
      g.quadraticCurveTo(hw, bottom, hw, bottom - 5);
      g.lineTo(hw * 0.12, top + 3);
      g.quadraticCurveTo(0, top - 3, -hw * 0.12, top + 3);
      g.closePath();
      return;
    case "bean":
      g.roundRect(-hw, top, hw * 2, bh, hw * 0.95);
  }
}

/** Draw a racer centred on the origin, facing right unless `dir` is -1. */
export function drawRacer(g: CanvasRenderingContext2D, look: RacerLook): void {
  const { spec, time } = look;
  const f = frameOf(spec);
  const color = look.charred ? "#3b3b3b" : spec.color;
  const running = look.legs === "run";
  const phase = (look.stride / (f.legLen * 3.4 + 12)) * Math.PI * 2;

  g.save();
  if (look.dir === -1) g.scale(-1, 1);

  // whole-body squash, sway and bob, pivoting on the feet
  const feet = spec.h / 2;
  g.translate(0, feet);
  if (look.squash > 0) g.scale(1 + look.squash * 0.35, 1 - look.squash * 0.3);
  if (spec.gait === "hop" && look.vy < -1.5) g.scale(0.88, 1.14);
  if (running && spec.gait === "waddle") g.rotate(Math.sin(phase) * 0.16);
  if (running && spec.gait === "shuffle") g.rotate(0.14 + Math.sin(phase) * 0.03);
  if (running && spec.gait === "skip") g.translate(0, -Math.abs(Math.sin(phase)) * spec.h * 0.1);
  else if (running && spec.gait !== "hop") g.translate(0, -Math.abs(Math.sin(phase)) * spec.h * 0.035);
  if (spec.gait === "float") g.translate(0, Math.sin(time * 3.2 + look.lane) * 3 - 4);
  g.translate(0, -feet);

  const extras = new Set<Extra>(spec.extras);
  if (look.boost) drawFlames(g, f, time);
  if (extras.has("cape")) drawCape(g, f, time, look.legs === "run");
  if (look.jet) drawJetpack(g, f, time);
  if (spec.shape === "taco") drawTacoFilling(g, f, time);

  drawArm(g, look, f, phase + Math.PI, true);
  if (spec.gait === "scuttle") {
    for (let i = 0; i < 3; i += 1) drawLeg(g, look, f, phase * 1.6 + i * 2.1 + Math.PI, -f.hw * 0.55 + i * f.hw * 0.5, true);
    for (let i = 0; i < 3; i += 1) drawLeg(g, look, f, phase * 1.6 + i * 2.1, -f.hw * 0.45 + i * f.hw * 0.5, false);
  } else if (spec.gait !== "float") {
    drawLeg(g, look, f, phase + Math.PI, -f.hw * 0.25, true);
    drawLeg(g, look, f, phase, f.hw * 0.2, false);
  }

  blobPath(g, spec, f, time);
  g.fillStyle = color;
  g.fill();

  g.save();
  blobPath(g, spec, f, time);
  g.clip();
  drawPattern(g, spec, f, color);
  g.fillStyle = "rgba(255,255,255,0.2)";
  g.beginPath();
  g.ellipse(f.hw * 0.3, f.top + f.bh * 0.3, f.hw * 0.45, f.bh * 0.18, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.16)";
  g.fillRect(-f.hw * 1.2, f.top - 4, f.hw * 0.55, f.bh + 8);
  g.restore();

  blobPath(g, spec, f, time);
  g.lineWidth = 2.5;
  g.strokeStyle = OUTLINE;
  g.stroke();

  drawBib(g, look, f);
  drawFace(g, look, f, color, phase);
  if (look.pie) drawPie(g, look, f, time);
  drawHat(g, spec.hat, f, time, look.vy);
  drawArm(g, look, f, phase, false);
  if (look.charred) drawSmoke(g, f, time);
  g.restore();
}

function drawCape(g: CanvasRenderingContext2D, f: Frame, time: number, running: boolean): void {
  const flap = Math.sin(time * (running ? 14 : 4));
  const y0 = f.top + f.bh * 0.18;
  const len = f.bh + f.legLen * 0.6;
  g.fillStyle = "#b91c1c";
  g.strokeStyle = "#111827";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(f.hw * 0.1, y0);
  g.quadraticCurveTo(-f.hw - 14 - flap * 6, y0 + len * 0.3, -f.hw - 22 - flap * 10, y0 + len * 0.95);
  for (let i = 0; i <= 3; i += 1) g.lineTo(-f.hw - 22 + i * 7 - flap * (10 - i * 3), y0 + len * (0.95 + (i % 2 ? -0.08 : 0)));
  g.quadraticCurveTo(-f.hw * 0.4, y0 + len * 0.5, -f.hw * 0.2, y0);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "#111827";
  g.fillRect(-f.hw * 0.7, y0 - 3, f.hw * 1.1, 5);
}

function drawJetpack(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  const x = -f.hw - 9;
  const y = f.top + f.bh * 0.25;
  for (let i = 0; i < 2; i += 1) {
    g.fillStyle = i ? "#94a3b8" : "#64748b";
    g.beginPath();
    g.roundRect(x - i * 7, y, 9, f.bh * 0.6, 4);
    g.fill();
    for (let k = 0; k < 3; k += 1) {
      g.fillStyle = ["#fde047", "#fb923c", "#ef4444"][k]!;
      g.beginPath();
      g.ellipse(x - i * 7 + 4.5, y + f.bh * 0.6 + 6 + k * 5, 4 - k, 7 + Math.sin(time * 40 + i + k) * 3, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawTacoFilling(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  const y = f.top + f.bh * 0.32;
  g.fillStyle = "#7c2d12";
  g.beginPath();
  g.ellipse(0, y - 2, f.hw * 0.85, 7, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = "#4ade80";
  g.beginPath();
  g.moveTo(-f.hw * 0.95, y);
  for (let i = 0; i <= 10; i += 1) g.lineTo(-f.hw * 0.95 + (f.hw * 1.9 * i) / 10, y - 6 - (i % 2) * 6 - Math.sin(time * 6 + i) * 1.5);
  g.lineTo(f.hw * 0.95, y + 2);
  g.closePath();
  g.fill();
  g.fillStyle = "#ef4444";
  for (const dx of [-0.5, 0.05, 0.55]) {
    g.beginPath();
    g.arc(f.hw * dx, y - 6, 4.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#fde047";
  for (const dx of [-0.25, 0.3]) g.fillRect(f.hw * dx, y - 11, 3, 8);
}

function drawPie(g: CanvasRenderingContext2D, look: RacerLook, f: Frame, time: number): void {
  const eyes = eyesOf(look.spec, f);
  const cx = eyes.reduce((s, e) => s + e.x, 0) / eyes.length + 2;
  const cy = eyes[0]!.y + 4;
  const r = Math.max(10, f.hw * 0.75);
  g.fillStyle = "#fffbeb";
  g.beginPath();
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const rr = r * (i % 2 ? 0.8 : 1.05);
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85);
  }
  g.closePath();
  g.fill();
  for (let i = 0; i < 3; i += 1) {
    const drip = ((time * 0.5 + i * 0.3) % 1) * 10;
    g.beginPath();
    g.ellipse(cx - r * 0.5 + i * r * 0.5, cy + r * 0.7 + drip * 0.5, 2.5, 4 + drip * 0.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#ef4444";
  g.beginPath();
  g.arc(cx + r * 0.2, cy - r * 0.35, 3.5, 0, Math.PI * 2);
  g.fill();
}

function drawPattern(g: CanvasRenderingContext2D, spec: RacerSpec, f: Frame, color: string): void {
  switch (spec.pattern) {
    case "stripes":
      g.fillStyle = "rgba(255,255,255,0.82)";
      for (let y = f.top + f.bh * 0.45; y < f.bottom; y += 10) g.fillRect(-f.hw * 1.2, y, f.hw * 2.4, 3.5);
      return;
    case "spots":
      g.fillStyle = spec.shape === "pickle" ? shade(color, 0.3) : shade(color, -0.3);
      for (let i = 0; i < 9; i += 1) {
        const x = (hash(spec.id, i) * 2 - 1) * f.hw * 0.9;
        const y = f.top + f.bh * (0.2 + hash(spec.id, i + 20) * 0.75);
        g.beginPath();
        g.arc(x, y, 1.8 + hash(spec.id, i + 40) * 3.2, 0, Math.PI * 2);
        g.fill();
      }
      return;
    case "belly":
      g.fillStyle = shade(color, 0.45);
      g.beginPath();
      g.ellipse(f.hw * 0.25, f.top + f.bh * 0.7, f.hw * 0.6, f.bh * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      return;
    case "none":
      return;
  }
}

function drawFlames(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  const cy = (f.top + f.bottom) / 2 + 6;
  for (let i = 0; i < 3; i += 1) {
    const len = 22 + Math.sin(time * 40 + i * 2) * 8 + i * 6;
    g.fillStyle = ["#fde047", "#fb923c", "#ef4444"][i]!;
    g.globalAlpha = 0.85 - i * 0.2;
    g.beginPath();
    g.moveTo(-f.hw + 4, cy - 9 + i * 2);
    g.quadraticCurveTo(-f.hw - len * 0.6, cy - 12, -f.hw - len, cy + Math.sin(time * 30 + i) * 4);
    g.quadraticCurveTo(-f.hw - len * 0.6, cy + 12, -f.hw + 4, cy + 9 - i * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function legAngles(look: RacerLook, phase: number, back: boolean): [number, number] {
  const gait = look.spec.gait;
  switch (look.legs) {
    case "run":
      if (gait === "flail") {
        const a = Math.sin(phase) * 1.1;
        return [a, a - Math.max(0, Math.cos(phase)) * 1.9];
      }
      if (gait === "waddle") {
        const a = Math.sin(phase) * 0.4;
        return [a, a];
      }
      if (gait === "hop") return back ? [0.35, -0.5] : [0.45, -0.55];
      if (gait === "powerwalk") {
        const a = Math.sin(phase) * 0.6;
        return [a, a + 0.05];
      }
      if (gait === "shuffle") {
        const a = Math.sin(phase) * 0.25;
        return [a + 0.1, a + 0.1];
      }
      if (gait === "skip") {
        const a = Math.sin(phase) * 0.7;
        return [a, a - Math.max(0, Math.sin(phase * 2)) * 1.5];
      }
      if (gait === "scuttle") {
        const a = Math.sin(phase) * 0.7;
        return [a, a - 0.4];
      }
      {
        const a = Math.sin(phase) * 0.85;
        return [a, a - Math.max(0, Math.cos(phase)) * 1.3];
      }
    case "air":
      if (gait === "hop") return back ? [0.05, 0.1] : [0.12, 0.15];
      return back ? [0.2, -0.9] : [0.9, -0.5];
    case "flail": {
      const a = Math.sin(look.time * 22 + (back ? 0 : 2)) * 1.2;
      return [a, a + Math.sin(look.time * 17 + (back ? 1 : 3)) * 0.9];
    }
    case "limp":
      return back ? [0.35, 0.15] : [0.15, -0.05];
    case "idle":
      return back ? [-0.08, -0.08] : [0.08, 0.08];
  }
}

function drawLeg(g: CanvasRenderingContext2D, look: RacerLook, f: Frame, phase: number, hipX: number, back: boolean): void {
  const hipY = f.bottom - 3;
  const thigh = f.legLen * 0.56;
  const shin = f.legLen * 0.56;
  const [a1, a2] = legAngles(look, phase, back);
  const kx = hipX + Math.sin(a1) * thigh;
  const ky = hipY + Math.cos(a1) * thigh;
  const fx = kx + Math.sin(a2) * shin;
  const fy = ky + Math.cos(a2) * shin;
  const color = look.charred ? "#3b3b3b" : look.spec.color;
  g.strokeStyle = back ? "#0b1020" : INK;
  g.lineWidth = Math.max(3.5, Math.min(7, f.hw * 0.28));
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(hipX, hipY);
  g.lineTo(kx, ky);
  g.lineTo(fx, fy);
  g.stroke();
  switch (look.spec.feet) {
    case "clown":
      g.fillStyle = back ? "#b91c1c" : "#ef4444";
      g.beginPath();
      g.ellipse(fx + 7, fy, Math.max(10, f.hw * 0.55), 5.5, a2 * 0.25, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = OUTLINE;
      g.lineWidth = 1.5;
      g.stroke();
      return;
    case "bare":
      g.fillStyle = back ? shade(color, -0.35) : color;
      g.beginPath();
      g.ellipse(fx + 3, fy, 5.5, 3.2, a2 * 0.3, 0, Math.PI * 2);
      g.fill();
      return;
    case "sneaker":
      g.fillStyle = back ? "#cbd5e1" : "#f8fafc";
      g.beginPath();
      g.ellipse(fx + 4, fy, Math.max(5.5, f.hw * 0.34), 3.6, a2 * 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.fillRect(fx, fy + 1, Math.max(5, f.hw * 0.34), 2);
  }
}

function drawArm(g: CanvasRenderingContext2D, look: RacerLook, f: Frame, phase: number, back: boolean): void {
  const { spec, time } = look;
  const sx = back ? -f.hw * 0.15 : f.hw * 0.05;
  const sy = f.top + f.bh * 0.58;
  const kind = spec.arms;
  const len = kind === "noodle" ? f.bh * 0.9 + 14 : kind === "stubby" ? Math.max(9, f.bh * 0.28) : Math.max(15, f.bh * 0.5);
  let a = 0;
  let bend = 0.6;
  switch (look.arms) {
    case "swing":
      switch (spec.gait) {
        case "flail":
          a = time * 15 + (back ? Math.PI : 0);
          bend = 0.2;
          break;
        case "waddle":
          a = -0.9 + Math.sin(time * 16 + (back ? 1 : 0)) * 0.55;
          bend = 0.1;
          break;
        case "hop":
          a = 1.35 + Math.sin(time * 9) * 0.15;
          bend = 1.1;
          break;
        case "powerwalk":
          a = -Math.sin(phase) * 1.3;
          bend = 1.6;
          break;
        case "float":
          a = 1.45 + Math.sin(time * 4 + (back ? 1 : 0)) * 0.25;
          bend = 0.2;
          break;
        case "scuttle":
          a = 0.8 + Math.sin(time * 20 + (back ? 1.5 : 0)) * 0.6;
          bend = 0.4;
          break;
        case "skip":
          a = Math.PI - 0.6 + Math.sin(phase + (back ? Math.PI : 0)) * 0.8;
          bend = -0.2;
          break;
        case "shuffle":
          a = -0.55;
          bend = 0.9;
          break;
        default:
          a = -Math.sin(phase) * 1.1;
          bend = 1.1;
      }
      break;
    case "up":
      a = Math.PI + (back ? -0.4 : 0.4) + Math.sin(time * 10) * 0.2;
      bend = -0.3;
      break;
    case "flail":
      a = Math.PI * (back ? 0.8 : 1.2) + Math.sin(time * 24 + (back ? 0 : 1.7)) * 1;
      bend = Math.sin(time * 19) * 0.8;
      break;
    case "wave":
      a = back ? 0.2 : Math.PI + 0.3;
      bend = back ? 0.3 : Math.sin(time * 14) * 0.9;
      break;
    case "limp":
      a = 0.5;
      bend = 0.2;
  }
  const color = look.charred ? "#3b3b3b" : spec.color;
  g.strokeStyle = back ? shade(color, -0.45) : shade(color, -0.22);
  g.lineWidth = Math.max(3.5, Math.min(6.5, f.hw * 0.22));
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(sx, sy);
  let hx: number;
  let hy: number;
  if (kind === "normal") {
    const ex = sx + Math.sin(a) * len * 0.5;
    const ey = sy + Math.cos(a) * len * 0.5;
    hx = ex + Math.sin(a + bend) * len * 0.5;
    hy = ey + Math.cos(a + bend) * len * 0.5;
    g.lineTo(ex, ey);
    g.lineTo(hx, hy);
  } else {
    hx = sx + Math.sin(a + bend * 0.3) * len;
    hy = sy + Math.cos(a + bend * 0.3) * len;
    const wob = kind === "noodle" ? Math.sin(time * 11 + (back ? 2 : 0)) * len * 0.35 : 0;
    const mx = (sx + hx) / 2 + Math.cos(a) * wob;
    const my = (sy + hy) / 2 - Math.sin(a) * wob;
    g.quadraticCurveTo(mx, my, hx, hy);
  }
  g.stroke();
  g.fillStyle = back ? shade(color, -0.35) : color;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(hx, hy, Math.max(3.2, Math.min(5.5, f.hw * 0.17)), 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

function drawBib(g: CanvasRenderingContext2D, look: RacerLook, f: Frame): void {
  const bh = Math.min(15, f.bh * 0.28);
  const bw = bh * 1.15;
  const x = -f.hw * 0.4 - bw / 2;
  const y = f.bottom - bh - f.bh * 0.12;
  g.fillStyle = "#f8fafc";
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x, y, bw, bh, 2);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.font = `700 ${Math.round(bh * 0.85)}px Bebas Neue, Impact, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(look.lane + 1), x + bw / 2, y + bh / 2 + 1);
}

function eyesOf(spec: RacerSpec, f: Frame): Eye[] {
  const base = Math.max(4.5, Math.min(9.5, Math.min(f.hw * 0.36, f.bh * 0.17)));
  const er = spec.shape === "noodle" ? 6.5 : base;
  const fx = f.hw * 0.25;
  const rows: Partial<Record<RacerSpec["shape"], number>> = { noodle: 0.16, cube: 0.26, cone: 0.5, taco: 0.58, egg: 0.38, ghost: 0.34 };
  const ey = f.top + f.bh * (rows[spec.shape] ?? 0.3);
  switch (spec.eyes) {
    case "stalks":
      return [
        { x: f.hw * 0.42, y: f.top - 12, r: 6 },
        { x: f.hw * 0.78, y: f.top - 17, r: 6 },
      ];
    case "cyclops":
      return [{ x: fx * 0.6, y: ey + er * 0.2, r: er * 1.75 }];
    case "three":
      return [
        { x: fx - er * 1.45, y: ey + er * 0.2, r: er * 0.78 },
        { x: fx, y: ey - er * 0.35, r: er * 0.78 },
        { x: fx + er * 1.45, y: ey + er * 0.2, r: er * 0.78 },
      ];
    case "mismatch":
      return [
        { x: fx - er * 0.7, y: ey, r: er * 1.35 },
        { x: fx + er * 1.35, y: ey + er * 0.35, r: er * 0.7 },
      ];
    case "hollow":
    case "two":
      return [
        { x: fx - er * 0.85, y: ey, r: er },
        { x: fx + er * 0.85, y: ey, r: er },
      ];
  }
}

type MouthKind = "line" | "grin" | "o" | "frown" | "smirk" | "wavy" | "tongue" | "teeth" | "small-o";

function drawFace(g: CanvasRenderingContext2D, look: RacerLook, f: Frame, color: string, phase: number): void {
  const { spec, mood, time } = look;
  const extras = new Set<Extra>(spec.extras);
  const eyes = eyesOf(spec, f);
  const cx = eyes.reduce((s, e) => s + e.x, 0) / eyes.length;
  const lowest = Math.max(...eyes.map((e) => e.y + e.r));
  const unit = Math.max(...eyes.map((e) => e.r)) / (spec.eyes === "cyclops" ? 1.75 : spec.eyes === "mismatch" ? 1.35 : spec.eyes === "three" ? 0.78 : 1);
  const stalks = spec.eyes === "stalks";
  const hollow = spec.eyes === "hollow";
  const mx = stalks ? f.hw * 0.68 : cx + unit * 0.4;
  const my = stalks ? f.top + f.bh * 0.55 : lowest + unit * (extras.has("nose") ? 1.5 : 0.9);
  if (stalks) {
    g.strokeStyle = shade(color, -0.25);
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    for (const e of eyes) {
      g.moveTo(e.x - 4, f.top + 8);
      g.quadraticCurveTo(e.x - 6 + Math.sin(time * 5 + e.x) * 3, (f.top + e.y) / 2, e.x, e.y);
    }
    g.stroke();
  }
  const blink = (time + look.lane * 1.37) % 4.3 < 0.12;
  const googly = Math.max(-0.4, Math.min(0.4, -look.vy * 0.05)) + (look.legs === "run" ? Math.sin(phase * 2) * 0.12 : 0);

  const whites = (scale = 1): void => {
    for (const e of eyes) {
      g.fillStyle = hollow ? INK : "#fff";
      g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(e.x, e.y, e.r * scale, e.r * scale * 1.1, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  };
  const pupils = (dx: number, dy: number, size = 0.5): void => {
    for (const e of eyes) {
      const px = e.x + dx * e.r;
      const py = e.y + (dy + googly) * e.r;
      g.fillStyle = INK;
      g.beginPath();
      if (!hollow) g.arc(px, py, e.r * size, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(px + e.r * 0.15, py - e.r * 0.18, e.r * size * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  };
  const lids = (cover: number): void => {
    for (const e of eyes) {
      g.save();
      g.beginPath();
      g.ellipse(e.x, e.y, e.r + 0.8, e.r * 1.1 + 0.8, 0, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = color;
      g.fillRect(e.x - e.r - 2, e.y - e.r * 1.2 - 2, e.r * 2 + 4, e.r * 2.3 * cover + 2);
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(e.x - e.r, e.y - e.r * 1.15 + e.r * 2.3 * cover);
      g.lineTo(e.x + e.r, e.y - e.r * 1.15 + e.r * 2.3 * cover);
      g.stroke();
    }
  };
  const closed = (up: boolean): void => {
    g.strokeStyle = INK;
    g.lineWidth = 2;
    for (const e of eyes) {
      g.beginPath();
      if (up) g.arc(e.x, e.y + e.r * 0.4, e.r * 0.75, Math.PI * 1.15, Math.PI * 1.85);
      else g.arc(e.x, e.y - e.r * 0.2, e.r * 0.75, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
  };
  /** inner/outer: how far each end of a brow drops, in eye radii (negative = up). */
  const brows = (inner: number, outer: number, lift = 0): void => {
    const pts: [number, number][] = [];
    for (const e of eyes) {
      const y = e.y - e.r * 1.4 - lift * e.r;
      if (eyes.length === 1) {
        pts.push([e.x - e.r, y + outer * e.r], [e.x, y + inner * e.r], [e.x + e.r, y + outer * e.r]);
      } else {
        const left = e.x < cx ? outer : inner;
        const right = e.x < cx ? inner : outer;
        pts.push([e.x - e.r * 0.85, y + left * e.r], [e.x + e.r * 0.85, y + right * e.r]);
      }
    }
    g.strokeStyle = INK;
    g.lineWidth = Math.max(2, unit * (extras.has("unibrow") ? 0.55 : 0.35));
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    if (extras.has("unibrow") || eyes.length === 1) {
      pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    } else {
      for (let i = 0; i < pts.length; i += 2) {
        g.moveTo(...pts[i]!);
        g.lineTo(...pts[i + 1]!);
      }
    }
    g.stroke();
  };
  const mouth = (kind: MouthKind): void => {
    const lip = extras.has("lipstick");
    g.strokeStyle = lip ? "#e11d48" : INK;
    g.fillStyle = "#3b0d16";
    g.lineWidth = lip ? 3.5 : 2;
    g.lineCap = "round";
    const er = unit;
    const mw = er * 1.3;
    g.beginPath();
    switch (kind) {
      case "line":
        g.moveTo(mx - mw * 0.5, my);
        g.lineTo(mx + mw * 0.5, my - 1);
        g.stroke();
        break;
      case "grin":
        g.moveTo(mx - mw, my - er * 0.2);
        g.quadraticCurveTo(mx, my + er * 1.8, mx + mw, my - er * 0.2);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = "#f472b6";
        g.beginPath();
        g.ellipse(mx, my + er * 0.55, mw * 0.45, er * 0.3, 0, 0, Math.PI * 2);
        g.fill();
        break;
      case "o":
        g.ellipse(mx, my + er * 0.3, er * 0.55, er * 0.75, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        break;
      case "small-o":
        g.ellipse(mx, my, er * 0.28, er * 0.32, 0, 0, Math.PI * 2);
        g.fill();
        break;
      case "frown":
        g.moveTo(mx - mw * 0.6, my + er * 0.4);
        g.quadraticCurveTo(mx, my - er * 0.5, mx + mw * 0.6, my + er * 0.4);
        g.stroke();
        break;
      case "smirk":
        g.moveTo(mx - mw * 0.5, my + er * 0.1);
        g.quadraticCurveTo(mx + mw * 0.2, my + er * 0.4, mx + mw * 0.7, my - er * 0.5);
        g.stroke();
        break;
      case "wavy":
        g.moveTo(mx - mw * 0.7, my);
        for (let i = 1; i <= 6; i += 1) g.lineTo(mx - mw * 0.7 + (mw * 1.4 * i) / 6, my + (i % 2 ? -er * 0.25 : er * 0.25));
        g.stroke();
        break;
      case "tongue":
        g.ellipse(mx, my + er * 0.2, er * 0.6, er * 0.45, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#f472b6";
        g.beginPath();
        g.ellipse(mx + er * 0.2, my + er * 0.75, er * 0.35, er * 0.55, 0.3, 0, Math.PI * 2);
        g.fill();
        break;
      case "teeth":
        g.roundRect(mx - mw * 0.6, my - er * 0.3, mw * 1.2, er * 0.75, 2);
        g.fillStyle = "#fff";
        g.fill();
        g.stroke();
        g.beginPath();
        g.moveTo(mx - mw * 0.6, my + er * 0.07);
        g.lineTo(mx + mw * 0.6, my + er * 0.07);
        for (let i = 1; i < 4; i += 1) {
          g.moveTo(mx - mw * 0.6 + (mw * 1.2 * i) / 4, my - er * 0.3);
          g.lineTo(mx - mw * 0.6 + (mw * 1.2 * i) / 4, my + er * 0.45);
        }
        g.lineWidth = 1;
        g.stroke();
    }
    if (extras.has("bucktooth") && kind !== "teeth" && kind !== "small-o") {
      g.fillStyle = "#fff";
      g.strokeStyle = INK;
      g.lineWidth = 1;
      g.beginPath();
      g.rect(mx - er * 0.42, my, er * 0.4, er * 0.55);
      g.rect(mx + 0.5, my, er * 0.4, er * 0.55);
      g.fill();
      g.stroke();
    }
    if (extras.has("tongue") && kind !== "tongue" && mood !== "sleep") {
      const flap = Math.sin(time * 16) * 0.5;
      g.fillStyle = "#f472b6";
      g.strokeStyle = "#be185d";
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(mx + mw * 0.5, my + er * 0.55, er * 0.35, er * 0.7, 0.4 + flap, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  };

  let mouthKind: MouthKind = "line";
  switch (mood) {
    case "focused":
      whites();
      if (blink) lids(1);
      else pupils(0.35, 0.05);
      brows(0.45, -0.1);
      mouthKind = "line";
      break;
    case "smug":
      whites();
      pupils(0.35, 0.15);
      lids(0.5);
      brows(0.1, 0.1, 0.1);
      mouthKind = "smirk";
      break;
    case "happy":
      whites();
      if (blink) lids(1);
      else pupils(0.25, -0.1, 0.55);
      brows(-0.3, 0, 0.4);
      mouthKind = "grin";
      break;
    case "panic": {
      whites(1.3);
      const j = Math.sin(time * 50) * 0.12;
      pupils(j, j, 0.28);
      brows(-0.6, 0.1, 0.9);
      mouthKind = "o";
      break;
    }
    case "dizzy":
      whites();
      drawSpirals(g, eyes, time);
      mouthKind = "wavy";
      drawStars(g, f, time);
      break;
    case "angry":
      whites();
      pupils(0.3, 0.2, 0.45);
      lids(0.25);
      brows(0.9, -0.35);
      mouthKind = "teeth";
      break;
    case "tired":
      whites();
      pupils(0.2, 0.3, 0.45);
      lids(0.55);
      brows(-0.2, 0.25);
      mouthKind = "tongue";
      drawSweat(g, f, time);
      break;
    case "sleep":
      whites();
      lids(1);
      mouthKind = "small-o";
      break;
    case "confused":
      whites();
      pupils(-0.4, -0.1);
      brows(0.2, -0.5, 0.3);
      mouthKind = "wavy";
      break;
    case "pain":
      whites();
      lids(0.6);
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.beginPath();
      for (const e of eyes) {
        g.moveTo(e.x - e.r * 0.5, e.y - e.r * 0.2);
        g.lineTo(e.x + e.r * 0.3, e.y + e.r * 0.3);
        g.lineTo(e.x - e.r * 0.5, e.y + e.r * 0.7);
      }
      g.stroke();
      brows(-0.5, 0.3);
      mouthKind = "teeth";
      break;
    case "win":
      closed(true);
      brows(-0.3, 0, 0.6);
      mouthKind = "grin";
      break;
    case "sad":
      whites();
      pupils(0.1, 0.45, 0.45);
      brows(-0.55, 0.35);
      mouthKind = "frown";
  }

  if (extras.has("lashes") && mood !== "win") {
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    for (const e of eyes) {
      for (let k = -1; k <= 1; k += 1) {
        const a = -Math.PI / 2 + k * 0.5;
        g.moveTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r * 1.1);
        g.lineTo(e.x + Math.cos(a) * e.r * 1.5, e.y + Math.sin(a) * e.r * 1.55);
      }
    }
    g.stroke();
  }
  if (extras.has("glasses")) {
    g.strokeStyle = "#e5e7eb";
    g.lineWidth = 1.8;
    g.beginPath();
    for (const e of eyes) g.ellipse(e.x, e.y, e.r * 1.3, e.r * 1.3, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(eyes[0]!.x + eyes[0]!.r * 1.3, eyes[0]!.y);
    g.lineTo(eyes[eyes.length - 1]!.x - eyes[eyes.length - 1]!.r * 1.3, eyes[eyes.length - 1]!.y);
    g.stroke();
  }
  if (extras.has("monocle")) {
    const e = eyes[eyes.length - 1]!;
    g.strokeStyle = "#fbbf24";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(e.x, e.y, e.r * 1.35, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(e.x + e.r * 0.9, e.y + e.r);
    g.quadraticCurveTo(e.x + e.r * 2, e.y + e.r * 4, e.x - e.r * 0.5, e.y + e.r * 5 + Math.sin(time * 8) * 2);
    g.stroke();
  }
  if (extras.has("shades")) {
    const x0 = Math.min(...eyes.map((e) => e.x - e.r)) - 3;
    const x1 = Math.max(...eyes.map((e) => e.x + e.r)) + 3;
    const y = eyes[0]!.y;
    g.fillStyle = "#0b0f19";
    g.beginPath();
    g.roundRect(x0, y - unit * 0.75, x1 - x0, unit * 1.5, unit * 0.6);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(x0 + 3, y - unit * 0.45, (x1 - x0) * 0.25, 2);
    g.strokeStyle = "#0b0f19";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(-f.hw, y - 2);
    g.stroke();
  }
  if (extras.has("nose")) {
    const nx = cx + unit * 1.2;
    const ny = lowest + unit * 0.35;
    g.fillStyle = color === "#f4f4f5" ? "#fda4af" : shade(color, 0.4);
    g.strokeStyle = OUTLINE;
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(nx, ny, unit * 0.75, unit * 0.6, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.beginPath();
    g.arc(nx + unit * 0.2, ny - unit * 0.2, unit * 0.18, 0, Math.PI * 2);
    g.fill();
  }
  mouth(mouthKind);
  if (extras.has("blush") || extras.has("freckles")) {
    for (const [i, e] of [eyes[0]!, eyes[eyes.length - 1]!].entries()) {
      const bx = e.x + (i === 0 ? -unit * 0.6 : unit * 0.6);
      const by = e.y + e.r + unit * 0.55;
      if (extras.has("blush")) {
        g.fillStyle = "rgba(244,114,182,0.6)";
        g.beginPath();
        g.ellipse(bx, by, unit * 0.65, unit * 0.35, 0, 0, Math.PI * 2);
        g.fill();
      }
      if (extras.has("freckles")) {
        g.fillStyle = "rgba(120,53,15,0.75)";
        for (let k = 0; k < 3; k += 1) {
          g.beginPath();
          g.arc(bx - unit * 0.4 + k * unit * 0.4, by + (k % 2) * 2, 1.2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
  if (extras.has("eyepatch")) {
    const e = eyes[0]!;
    g.strokeStyle = "#0b0f19";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-f.hw, e.y - e.r * 1.6);
    g.lineTo(e.x + e.r * 1.5, e.y - e.r * 0.2);
    g.stroke();
    g.fillStyle = "#0b0f19";
    g.beginPath();
    g.ellipse(e.x, e.y, e.r * 1.15, e.r * 1.2, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (extras.has("beard") || extras.has("gingerbeard")) {
    const top = my - unit * 0.3;
    const w = Math.max(unit * 2.4, f.hw * 0.95);
    g.fillStyle = extras.has("beard") ? "#f1f5f9" : "#c2410c";
    g.beginPath();
    g.moveTo(mx - w * 0.6, top);
    for (let i = 0; i <= 6; i += 1) {
      const t = i / 6;
      g.lineTo(mx - w * 0.6 + w * 1.2 * t, top + unit * 1.8 + Math.sin(t * Math.PI) * unit * 1.4 + (i % 2) * 3);
    }
    g.lineTo(mx + w * 0.6, top);
    g.closePath();
    g.fill();
    g.fillStyle = "#3b0d16";
    g.beginPath();
    g.ellipse(mx, my + unit * 0.2, unit * 0.45, unit * 0.25, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (extras.has("fangs")) {
    g.fillStyle = "#fff";
    g.strokeStyle = INK;
    g.lineWidth = 1;
    for (const dx of [-0.45, 0.45]) {
      g.beginPath();
      g.moveTo(mx + dx * unit - unit * 0.22, my);
      g.lineTo(mx + dx * unit + unit * 0.22, my);
      g.lineTo(mx + dx * unit, my + unit * 0.75);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
  if (extras.has("mustache")) {
    const y = my - unit * 0.35;
    g.fillStyle = "#3f2a14";
    g.beginPath();
    g.ellipse(mx - unit * 0.55, y, unit * 0.75, unit * 0.32, 0.25, 0, Math.PI * 2);
    g.ellipse(mx + unit * 0.55, y, unit * 0.75, unit * 0.32, -0.25, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#3f2a14";
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(mx - unit * 1.3, y - unit * 0.2, unit * 0.3, 0, Math.PI * 1.2);
    g.arc(mx + unit * 1.3, y - unit * 0.2, unit * 0.3, Math.PI * 1.8, Math.PI, true);
    g.stroke();
  }
}

function drawSpirals(g: CanvasRenderingContext2D, eyes: Eye[], time: number): void {
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  for (const e of eyes) {
    g.beginPath();
    for (let t = 0; t < 12; t += 0.4) {
      const r = (t / 12) * e.r * 0.9;
      const a = t + time * 8;
      const x = e.x + Math.cos(a) * r;
      const y = e.y + Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

function drawStars(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  for (let i = 0; i < 3; i += 1) {
    const a = time * 4 + (i * Math.PI * 2) / 3;
    const x = Math.cos(a) * (f.hw + 8);
    const y = f.top - 12 + Math.sin(a) * 5;
    g.fillStyle = "#fde047";
    g.beginPath();
    for (let k = 0; k < 10; k += 1) {
      const r = k % 2 === 0 ? 5 : 2.2;
      const ang = (k * Math.PI) / 5 - Math.PI / 2;
      g.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
    }
    g.closePath();
    g.fill();
  }
}

function drawSweat(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  const t = (time * 1.4) % 1;
  g.fillStyle = "rgba(125,211,252,0.9)";
  g.beginPath();
  const x = -f.hw * 0.6;
  const y = f.top + 6 + t * 14;
  g.moveTo(x, y - 5);
  g.quadraticCurveTo(x + 4, y + 2, x, y + 3);
  g.quadraticCurveTo(x - 4, y + 2, x, y - 5);
  g.fill();
}

function drawSmoke(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  for (let i = 0; i < 3; i += 1) {
    const t = (time * 0.9 + i / 3) % 1;
    g.fillStyle = `rgba(148,163,184,${0.5 * (1 - t)})`;
    g.beginPath();
    g.arc(Math.sin(t * 6 + i) * 6, f.top - t * 30, 4 + t * 7, 0, Math.PI * 2);
    g.fill();
  }
}

function drawHat(g: CanvasRenderingContext2D, hat: Hat, f: Frame, time: number, vy: number): void {
  const top = f.top;
  const hw = f.hw;
  switch (hat) {
    case "cap":
      g.fillStyle = "#1d4ed8";
      g.beginPath();
      g.ellipse(0, top + 5, Math.min(hw * 0.9, 18), 8, 0, Math.PI, 0);
      g.fill();
      g.fillRect(0, top + 3, Math.min(hw * 1.3, 24), 3.5);
      g.fillStyle = "#f8fafc";
      g.beginPath();
      g.arc(0, top - 3, 2, 0, Math.PI * 2);
      g.fill();
      return;
    case "bow":
      g.fillStyle = "#fde047";
      g.strokeStyle = OUTLINE;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(-2, top + 1);
      g.lineTo(-13, top - 8);
      g.lineTo(-13, top + 8);
      g.closePath();
      g.moveTo(2, top + 1);
      g.lineTo(13, top - 8);
      g.lineTo(13, top + 8);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0, top + 1, 3.5, 0, Math.PI * 2);
      g.fill();
      return;
    case "antenna":
      for (const side of [-1, 1]) {
        const sway = Math.sin(time * 7 + side) * 5 - vy * 0.8;
        g.strokeStyle = INK;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(side * 3, top + 2);
        g.quadraticCurveTo(side * 6 + sway * 0.4, top - 12, side * 9 + sway, top - 22);
        g.stroke();
        g.fillStyle = "#ff4fb3";
        g.beginPath();
        g.arc(side * 9 + sway, top - 23, 4, 0, Math.PI * 2);
        g.fill();
      }
      return;
    case "tophat":
      g.fillStyle = "#111827";
      g.fillRect(-hw * 0.6, top - 20, hw * 1.2, 22);
      g.fillRect(-hw * 0.9, top, hw * 1.8, 4);
      g.fillStyle = "#dc2626";
      g.fillRect(-hw * 0.6, top - 5, hw * 1.2, 3);
      return;
    case "mohawk":
      g.fillStyle = "#ff4fb3";
      g.beginPath();
      g.moveTo(-hw * 0.6, top + 5);
      for (let i = 0; i <= 4; i += 1) {
        const x = -hw * 0.6 + (hw * 1.2 * i) / 4;
        g.lineTo(x + hw * 0.12, top - 12 - (i % 2) * 4 + Math.sin(time * 12 + i) * 1.5);
        g.lineTo(x + hw * 0.25, top + 4);
      }
      g.closePath();
      g.fill();
      return;
    case "headband": {
      const y = top + f.bh * 0.1;
      g.fillStyle = "#f8fafc";
      g.fillRect(-hw * 1.02, y, hw * 2.04, 5);
      g.fillStyle = "#ef4444";
      g.fillRect(-hw * 1.02, y + 2, hw * 2.04, 1.5);
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-hw, y + 2);
      g.lineTo(-hw - 11, y + 5 + Math.sin(time * 12) * 3);
      g.moveTo(-hw, y + 3);
      g.lineTo(-hw - 9, y + 9 + Math.sin(time * 12 + 1) * 3);
      g.stroke();
      return;
    }
    case "bun":
      g.fillStyle = "#d1d5db";
      g.strokeStyle = OUTLINE;
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(0, top + 3, hw * 0.95, 7, 0, Math.PI, 0);
      g.fill();
      g.beginPath();
      g.arc(-hw * 0.35, top - 6, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = "#9ca3af";
      g.beginPath();
      g.arc(-hw * 0.35, top - 6, 3.5, 0, Math.PI * 1.5);
      g.stroke();
      return;
    case "sprout":
      g.strokeStyle = "#166534";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, top + 2);
      g.lineTo(0, top - 10);
      g.stroke();
      for (const side of [-1, 1]) {
        g.fillStyle = side < 0 ? "#15803d" : "#22c55e";
        g.beginPath();
        g.ellipse(side * 6, top - 12 + Math.sin(time * 6 + side) * 1.5, 7, 3.5, side * -0.5, 0, Math.PI * 2);
        g.fill();
      }
      return;
    case "propeller": {
      const colors = ["#ef2b2b", "#ffe14d", "#2f6bff", "#9eff3d"];
      for (let i = 0; i < 4; i += 1) {
        g.fillStyle = colors[i]!;
        g.beginPath();
        g.moveTo(0, top + 5);
        g.ellipse(0, top + 5, hw * 0.75, 10, 0, Math.PI + (i * Math.PI) / 4, Math.PI + ((i + 1) * Math.PI) / 4);
        g.closePath();
        g.fill();
      }
      g.fillStyle = INK;
      g.fillRect(-1, top - 9, 2, 5);
      const spin = Math.cos(time * 30);
      g.fillStyle = "#e5e7eb";
      g.beginPath();
      g.ellipse(0, top - 10, 13 * Math.abs(spin) + 1, 2.2, 0, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case "crown":
      g.fillStyle = "#fbbf24";
      g.strokeStyle = "#92400e";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-hw * 0.55, top + 4);
      g.lineTo(-hw * 0.55, top - 10);
      g.lineTo(-hw * 0.28, top - 3);
      g.lineTo(0, top - 14);
      g.lineTo(hw * 0.28, top - 3);
      g.lineTo(hw * 0.55, top - 10);
      g.lineTo(hw * 0.55, top + 4);
      g.closePath();
      g.fill();
      g.stroke();
      for (const [x, c] of [[-0.3, "#ef4444"], [0, "#3b82f6"], [0.3, "#22c55e"]] as const) {
        g.fillStyle = c;
        g.beginPath();
        g.arc(hw * x, top + 0.5, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      return;
    case "slick":
      g.fillStyle = "#0b0f19";
      g.beginPath();
      g.moveTo(-hw * 1.02, top + f.bh * 0.28);
      g.quadraticCurveTo(-hw * 1.05, top - 4, 0, top - 3);
      g.quadraticCurveTo(hw * 1.05, top - 4, hw * 1.02, top + f.bh * 0.18);
      g.lineTo(hw * 0.45, top + f.bh * 0.08);
      g.lineTo(hw * 0.2, top + f.bh * 0.2);
      g.lineTo(-hw * 0.1, top + f.bh * 0.08);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(-hw * 0.5, top, hw * 0.6, 2);
      return;
    case "pirate":
      g.fillStyle = "#111827";
      g.beginPath();
      g.moveTo(-hw * 1.1, top + 4);
      g.quadraticCurveTo(-hw * 0.6, top - 16, 0, top - 12);
      g.quadraticCurveTo(hw * 0.6, top - 16, hw * 1.1, top + 4);
      g.quadraticCurveTo(0, top - 3, -hw * 1.1, top + 4);
      g.fill();
      g.fillStyle = "#f8fafc";
      g.beginPath();
      g.arc(0, top - 6, 3, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-3.5, top - 2.5, 7, 1.2);
      return;
    case "party": {
      const stripes = ["#3b82f6", "#facc15", "#22c55e"];
      g.save();
      g.beginPath();
      g.moveTo(-8, top + 2);
      g.lineTo(2, top - 26);
      g.lineTo(9, top + 2);
      g.closePath();
      g.clip();
      for (let i = 0; i < 6; i += 1) {
        g.fillStyle = stripes[i % 3]!;
        g.fillRect(-10, top + 2 - i * 5, 22, 5);
      }
      g.restore();
      g.fillStyle = "#f472b6";
      g.beginPath();
      g.arc(2, top - 27, 4, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case "flatcap":
      g.fillStyle = "#57534e";
      g.beginPath();
      g.ellipse(-1, top + 3, hw * 0.95, 7, 0, Math.PI, 0);
      g.fill();
      g.beginPath();
      g.ellipse(hw * 0.65, top + 3, hw * 0.45, 3, 0.1, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#78716c";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-hw * 0.6, top - 1);
      g.lineTo(hw * 0.5, top - 1);
      g.stroke();
      return;
    case "none":
  }
}
