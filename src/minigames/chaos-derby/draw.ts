import type { Build, Hat, RacerSpec } from "./rules";
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
  /** "run" legs, "air" tucked, "flail" kicking, "limp" lying still, "idle" standing. */
  legs: "run" | "air" | "flail" | "limp" | "idle";
  /** "swing" running arms, "up" both up, "flail", "wave" one arm waving, "limp". */
  arms: "swing" | "up" | "flail" | "wave" | "limp";
  time: number;
  boost: boolean;
  charred: boolean;
}

const INK = "#131a2a";
const SKIN_LINE = "rgba(19,26,42,0.55)";

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c + amount * (amount > 0 ? 255 - c : c))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

interface Frame {
  /** Blob (head+torso) box, local coords. */
  top: number;
  bottom: number;
  halfW: number;
  legLen: number;
}

function frameOf(build: Build, w: number, h: number): Frame {
  const legShare = build === "tall" ? 0.36 : build === "wide" ? 0.26 : build === "tiny" ? 0.3 : 0.3;
  const legLen = h * legShare;
  return { top: -h / 2, bottom: h / 2 - legLen, halfW: w / 2, legLen };
}

function blobPath(g: CanvasRenderingContext2D, build: Build, f: Frame): void {
  const cx = 0;
  const cy = (f.top + f.bottom) / 2;
  const rh = (f.bottom - f.top) / 2;
  g.beginPath();
  if (build === "round" || build === "tiny") {
    g.ellipse(cx, cy, f.halfW, rh, 0, 0, Math.PI * 2);
  } else {
    const r = build === "wide" ? rh * 0.9 : f.halfW * 0.95;
    g.roundRect(-f.halfW, f.top, f.halfW * 2, f.bottom - f.top, r);
  }
}

/** Draw a racer centred on the origin, facing right unless `dir` is -1. */
export function drawRacer(g: CanvasRenderingContext2D, look: RacerLook): void {
  const { spec, w, h, time } = look;
  const f = frameOf(spec.build, w, h);
  const color = look.charred ? "#3b3b3b" : spec.color;
  g.save();
  if (look.dir === -1) g.scale(-1, 1);

  if (look.boost) drawFlames(g, f, time);

  const phase = (look.stride / Math.max(28, h * 0.62)) * Math.PI * 2;
  drawArm(g, look, f, phase + Math.PI, true);
  drawLeg(g, look, f, phase + Math.PI, -f.halfW * 0.22, true);
  drawLeg(g, look, f, phase, f.halfW * 0.18, false);

  blobPath(g, spec.build, f);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = SKIN_LINE;
  g.stroke();

  // belly light and back shade
  g.save();
  blobPath(g, spec.build, f);
  g.clip();
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.beginPath();
  g.ellipse(f.halfW * 0.25, (f.top + f.bottom) / 2 + 4, f.halfW * 0.55, (f.bottom - f.top) * 0.32, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.14)";
  g.fillRect(-f.halfW, f.top, f.halfW * 0.45, f.bottom - f.top);
  g.restore();

  drawBib(g, look, f);
  drawFace(g, look, f);
  drawHat(g, spec.hat, f, color, time);
  drawArm(g, look, f, phase, false);
  if (look.charred) drawSmoke(g, f, time);
  g.restore();
}

function drawFlames(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  const cy = (f.top + f.bottom) / 2 + 6;
  for (let i = 0; i < 3; i += 1) {
    const len = 22 + Math.sin(time * 40 + i * 2) * 8 + i * 6;
    g.fillStyle = ["#fde047", "#fb923c", "#ef4444"][i]!;
    g.globalAlpha = 0.85 - i * 0.2;
    g.beginPath();
    g.moveTo(-f.halfW + 4, cy - 9 + i * 2);
    g.quadraticCurveTo(-f.halfW - len * 0.6, cy - 12, -f.halfW - len, cy + Math.sin(time * 30 + i) * 4);
    g.quadraticCurveTo(-f.halfW - len * 0.6, cy + 12, -f.halfW + 4, cy + 9 - i * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawLeg(g: CanvasRenderingContext2D, look: RacerLook, f: Frame, phase: number, hipX: number, back: boolean): void {
  const hipY = f.bottom - 3;
  const thigh = f.legLen * 0.55;
  const shin = f.legLen * 0.55;
  let a1 = 0;
  let a2 = 0;
  switch (look.legs) {
    case "run":
      a1 = Math.sin(phase) * 0.85;
      a2 = a1 - Math.max(0, Math.cos(phase)) * 1.3;
      break;
    case "air":
      a1 = back ? 0.2 : 0.9;
      a2 = back ? -0.9 : -0.5;
      break;
    case "flail":
      a1 = Math.sin(look.time * 22 + (back ? 0 : 2)) * 1.1;
      a2 = a1 + Math.sin(look.time * 17 + (back ? 1 : 3)) * 0.8;
      break;
    case "limp":
      a1 = back ? 0.35 : 0.15;
      a2 = a1 - 0.2;
      break;
    case "idle":
      a1 = back ? -0.08 : 0.08;
      a2 = a1;
  }
  const kx = hipX + Math.sin(a1) * thigh;
  const ky = hipY + Math.cos(a1) * thigh;
  const fx = kx + Math.sin(a2) * shin;
  const fy = ky + Math.cos(a2) * shin;
  g.strokeStyle = back ? "#0b1020" : INK;
  g.lineWidth = Math.max(4, f.halfW * 0.26);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(hipX, hipY);
  g.lineTo(kx, ky);
  g.lineTo(fx, fy);
  g.stroke();
  // sneaker
  g.fillStyle = back ? "#cbd5e1" : "#f8fafc";
  g.beginPath();
  g.ellipse(fx + 4, fy, Math.max(5, f.halfW * 0.34), Math.max(3, f.halfW * 0.18), a2 * 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = look.spec.color;
  g.fillRect(fx, fy + 1, Math.max(5, f.halfW * 0.34), 2);
}

function drawArm(g: CanvasRenderingContext2D, look: RacerLook, f: Frame, phase: number, back: boolean): void {
  const sx = back ? -f.halfW * 0.1 : f.halfW * 0.05;
  const sy = f.top + (f.bottom - f.top) * 0.55;
  const len = Math.max(14, (f.bottom - f.top) * 0.45);
  let a = 0;
  let bend = 0.6;
  switch (look.arms) {
    case "swing":
      a = -Math.sin(phase) * 1.1;
      bend = 1.1;
      break;
    case "up":
      a = Math.PI + (back ? -0.35 : 0.35) + Math.sin(look.time * 10) * 0.15;
      bend = -0.3;
      break;
    case "flail":
      a = Math.PI * (back ? 0.8 : 1.2) + Math.sin(look.time * 24 + (back ? 0 : 1.7)) * 0.9;
      bend = Math.sin(look.time * 19) * 0.8;
      break;
    case "wave":
      a = back ? 0.2 : Math.PI + 0.3;
      bend = back ? 0.3 : Math.sin(look.time * 14) * 0.9;
      break;
    case "limp":
      a = 0.5;
      bend = 0.2;
  }
  const ex = sx + Math.sin(a) * len * 0.5;
  const ey = sy + Math.cos(a) * len * 0.5;
  const hx = ex + Math.sin(a + bend) * len * 0.5;
  const hy = ey + Math.cos(a + bend) * len * 0.5;
  g.strokeStyle = back ? shade(look.spec.color, -0.45) : shade(look.spec.color, -0.2);
  if (look.charred) g.strokeStyle = back ? "#222" : "#2d2d2d";
  g.lineWidth = Math.max(4, f.halfW * 0.22);
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(ex, ey);
  g.lineTo(hx, hy);
  g.stroke();
  g.fillStyle = back ? shade(look.spec.color, -0.35) : look.spec.color;
  g.beginPath();
  g.arc(hx, hy, Math.max(3, f.halfW * 0.16), 0, Math.PI * 2);
  g.fill();
}

function drawBib(g: CanvasRenderingContext2D, look: RacerLook, f: Frame): void {
  const bh = Math.min(16, (f.bottom - f.top) * 0.3);
  const bw = bh * 1.15;
  const x = -f.halfW * 0.35 - bw / 2;
  const y = f.bottom - bh - (f.bottom - f.top) * 0.1;
  g.fillStyle = "#f8fafc";
  g.strokeStyle = SKIN_LINE;
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

function drawFace(g: CanvasRenderingContext2D, look: RacerLook, f: Frame): void {
  const { mood, time } = look;
  const bodyH = f.bottom - f.top;
  const er = Math.max(4.5, Math.min(f.halfW * 0.3, bodyH * 0.17));
  const ey = f.top + bodyH * (look.spec.build === "wide" ? 0.34 : 0.3);
  const ex1 = f.halfW * 0.1;
  const ex2 = f.halfW * 0.1 + er * 1.7;
  const blink = (time + look.lane * 1.37) % 4.3 < 0.12;
  const mx = f.halfW * 0.1 + er * 0.9;
  const my = ey + er * 2.1;

  const eyes = (scale = 1): void => {
    for (const ex of [ex1, ex2]) {
      g.fillStyle = "#fff";
      g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(ex, ey, er * scale, er * scale * 1.12, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  };
  const pupils = (dx: number, dy: number, size = 0.5): void => {
    g.fillStyle = INK;
    for (const ex of [ex1, ex2]) {
      g.beginPath();
      g.arc(ex + dx * er, ey + dy * er, er * size, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#fff";
    for (const ex of [ex1, ex2]) {
      g.beginPath();
      g.arc(ex + dx * er + er * 0.15, ey + dy * er - er * 0.18, er * size * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  };
  const closed = (up: boolean): void => {
    g.strokeStyle = INK;
    g.lineWidth = 2;
    for (const ex of [ex1, ex2]) {
      g.beginPath();
      if (up) g.arc(ex, ey + er * 0.4, er * 0.75, Math.PI * 1.15, Math.PI * 1.85);
      else g.arc(ex, ey - er * 0.2, er * 0.75, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
  };
  const lids = (cover: number): void => {
    g.fillStyle = look.charred ? "#3b3b3b" : look.spec.color;
    for (const ex of [ex1, ex2]) {
      g.save();
      g.beginPath();
      g.ellipse(ex, ey, er + 0.8, er * 1.12 + 0.8, 0, 0, Math.PI * 2);
      g.clip();
      g.fillRect(ex - er - 2, ey - er * 1.2 - 2, er * 2 + 4, er * 2.3 * cover + 2);
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(ex - er, ey - er * 1.15 + er * 2.3 * cover);
      g.lineTo(ex + er, ey - er * 1.15 + er * 2.3 * cover);
      g.stroke();
    }
  };
  const brows = (inner: number, outer: number, lift = 0): void => {
    g.strokeStyle = INK;
    g.lineWidth = Math.max(2, er * 0.35);
    g.lineCap = "round";
    const by = ey - er * 1.45 - lift * er;
    g.beginPath();
    g.moveTo(ex1 - er * 0.8, by + outer * er);
    g.lineTo(ex1 + er * 0.6, by + inner * er);
    g.moveTo(ex2 - er * 0.6, by + inner * er);
    g.lineTo(ex2 + er * 0.8, by + outer * er);
    g.stroke();
  };
  const mouth = (kind: "line" | "grin" | "o" | "frown" | "smirk" | "wavy" | "tongue" | "teeth" | "small-o"): void => {
    g.strokeStyle = INK;
    g.fillStyle = "#3b0d16";
    g.lineWidth = 2;
    g.lineCap = "round";
    const mw = er * 1.3;
    g.beginPath();
    switch (kind) {
      case "line":
        g.moveTo(mx - mw * 0.5, my);
        g.lineTo(mx + mw * 0.5, my - 1);
        g.stroke();
        return;
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
        return;
      case "o":
        g.ellipse(mx, my + er * 0.3, er * 0.55, er * 0.75, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        return;
      case "small-o":
        g.ellipse(mx, my, er * 0.28, er * 0.32, 0, 0, Math.PI * 2);
        g.fill();
        return;
      case "frown":
        g.moveTo(mx - mw * 0.6, my + er * 0.4);
        g.quadraticCurveTo(mx, my - er * 0.5, mx + mw * 0.6, my + er * 0.4);
        g.stroke();
        return;
      case "smirk":
        g.moveTo(mx - mw * 0.5, my + er * 0.1);
        g.quadraticCurveTo(mx + mw * 0.2, my + er * 0.4, mx + mw * 0.7, my - er * 0.5);
        g.stroke();
        return;
      case "wavy":
        g.moveTo(mx - mw * 0.7, my);
        for (let i = 1; i <= 6; i += 1) g.lineTo(mx - mw * 0.7 + (mw * 1.4 * i) / 6, my + (i % 2 ? -er * 0.25 : er * 0.25));
        g.stroke();
        return;
      case "tongue":
        g.ellipse(mx, my + er * 0.2, er * 0.6, er * 0.45, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#f472b6";
        g.beginPath();
        g.ellipse(mx + er * 0.2, my + er * 0.75, er * 0.35, er * 0.55, 0.3, 0, Math.PI * 2);
        g.fill();
        return;
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
  };

  switch (mood) {
    case "focused":
      eyes();
      if (blink) lids(1);
      else pupils(0.35, 0.05);
      brows(0.45, -0.1);
      mouth("line");
      break;
    case "smug":
      eyes();
      pupils(0.35, 0.15);
      lids(0.5);
      brows(0.1, 0.1, 0.1);
      mouth("smirk");
      break;
    case "happy":
      eyes();
      if (blink) lids(1);
      else pupils(0.25, -0.1, 0.55);
      brows(-0.3, 0, 0.4);
      mouth("grin");
      break;
    case "panic": {
      eyes(1.3);
      const j = Math.sin(time * 50) * 0.12;
      pupils(j, j, 0.28);
      brows(-0.6, 0.1, 0.9);
      mouth("o");
      break;
    }
    case "dizzy":
      eyes();
      drawSpirals(g, [ex1, ex2], ey, er, time);
      mouth("wavy");
      drawStars(g, f, time);
      break;
    case "angry":
      eyes();
      pupils(0.3, 0.2, 0.45);
      lids(0.25);
      brows(0.9, -0.35);
      mouth("teeth");
      break;
    case "tired":
      eyes();
      pupils(0.2, 0.3, 0.45);
      lids(0.55);
      brows(-0.2, 0.25);
      mouth("tongue");
      drawSweat(g, f, time);
      break;
    case "sleep":
      eyes();
      lids(1);
      mouth("small-o");
      break;
    case "confused":
      eyes();
      pupils(-0.4, -0.1);
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ex1 - er * 0.8, ey - er * 1.4);
      g.lineTo(ex1 + er * 0.6, ey - er * 1.4);
      g.moveTo(ex2 - er * 0.6, ey - er * 2.1);
      g.quadraticCurveTo(ex2, ey - er * 2.6, ex2 + er * 0.8, ey - er * 2);
      g.stroke();
      mouth("wavy");
      break;
    case "pain":
      eyes();
      lids(0.6);
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.beginPath();
      for (const ex of [ex1, ex2]) {
        g.moveTo(ex - er * 0.5, ey - er * 0.2);
        g.lineTo(ex + er * 0.3, ey + er * 0.3);
        g.lineTo(ex - er * 0.5, ey + er * 0.7);
      }
      g.stroke();
      brows(-0.5, 0.3);
      mouth("teeth");
      break;
    case "win":
      closed(true);
      brows(-0.3, 0, 0.6);
      mouth("grin");
      break;
    case "sad":
      eyes();
      pupils(0.1, 0.45, 0.45);
      brows(-0.55, 0.35);
      mouth("frown");
  }
}

function drawSpirals(g: CanvasRenderingContext2D, xs: number[], ey: number, er: number, time: number): void {
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  for (const ex of xs) {
    g.beginPath();
    for (let t = 0; t < 12; t += 0.4) {
      const r = (t / 12) * er * 0.9;
      const a = t + time * 8;
      const x = ex + Math.cos(a) * r;
      const y = ey + Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

function drawStars(g: CanvasRenderingContext2D, f: Frame, time: number): void {
  for (let i = 0; i < 3; i += 1) {
    const a = time * 4 + (i * Math.PI * 2) / 3;
    const x = Math.cos(a) * f.halfW * 1.1;
    const y = f.top - 10 + Math.sin(a) * 5;
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
  const x = -f.halfW * 0.6;
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

function drawHat(g: CanvasRenderingContext2D, hat: Hat, f: Frame, color: string, time: number): void {
  const top = f.top;
  switch (hat) {
    case "cap":
      g.fillStyle = shade(color, -0.45);
      g.beginPath();
      g.ellipse(0, top + 5, f.halfW * 0.85, 8, 0, Math.PI, 0);
      g.fill();
      g.fillRect(0, top + 3, f.halfW * 1.25, 3.5);
      return;
    case "bow":
      g.fillStyle = "#f43f5e";
      g.beginPath();
      g.moveTo(-2, top + 1);
      g.lineTo(-12, top - 7);
      g.lineTo(-12, top + 7);
      g.closePath();
      g.moveTo(2, top + 1);
      g.lineTo(12, top - 7);
      g.lineTo(12, top + 7);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(0, top + 1, 3.5, 0, Math.PI * 2);
      g.fill();
      return;
    case "antenna": {
      const sway = Math.sin(time * 7) * 4;
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, top + 2);
      g.quadraticCurveTo(sway * 0.4, top - 10, sway, top - 18);
      g.stroke();
      g.fillStyle = "#fde047";
      g.beginPath();
      g.arc(sway, top - 19, 4, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case "tophat":
      g.fillStyle = "#111827";
      g.fillRect(-f.halfW * 0.55, top - 18, f.halfW * 1.1, 20);
      g.fillRect(-f.halfW * 0.8, top, f.halfW * 1.6, 4);
      g.fillStyle = "#dc2626";
      g.fillRect(-f.halfW * 0.55, top - 4, f.halfW * 1.1, 3);
      return;
    case "mohawk":
      g.fillStyle = "#22d3ee";
      g.beginPath();
      g.moveTo(-f.halfW * 0.6, top + 5);
      for (let i = 0; i <= 4; i += 1) {
        const x = -f.halfW * 0.6 + (f.halfW * 1.2 * i) / 4;
        g.lineTo(x + f.halfW * 0.12, top - 10 - (i % 2) * 3);
        g.lineTo(x + f.halfW * 0.25, top + 4);
      }
      g.closePath();
      g.fill();
      return;
    case "headband":
      g.fillStyle = "#f8fafc";
      g.fillRect(-f.halfW * 0.98, top + (f.bottom - top) * 0.1, f.halfW * 1.96, 5);
      g.fillStyle = "#ef4444";
      g.fillRect(-f.halfW * 0.98, top + (f.bottom - top) * 0.1 + 2, f.halfW * 1.96, 1.5);
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-f.halfW, top + (f.bottom - top) * 0.12);
      g.lineTo(-f.halfW - 9, top + (f.bottom - top) * 0.12 + 4 + Math.sin(time * 12) * 3);
      g.stroke();
      return;
    case "none":
      return;
  }
}
