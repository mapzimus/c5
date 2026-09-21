import type { LiquidState } from "./physics";

export interface Pose {
  position: { x: number; y: number };
  angle: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  color: string;
  fire?: boolean;
  coin?: boolean;
}

interface SpriteEntry {
  body: HTMLImageElement;
  wing: HTMLImageElement;
  loaded: number;
  ready: boolean;
}

const VIEW_W = 300;
const VIEW_H = 420;
const GROUND_SVG = 376;
const GROUND_LOCAL = 32;
const SCALE = 0.93;
const DEST_W = VIEW_W * SCALE;
const DEST_H = VIEW_H * SCALE;
const DEST_X = -DEST_W / 2;
const DEST_Y = GROUND_LOCAL - GROUND_SVG * SCALE;
const PIV_X = (132 - VIEW_W / 2) * SCALE;
const PIV_Y = (150 - GROUND_SVG) * SCALE + GROUND_LOCAL;
const GROUND_SHADOW_REST = 39;

const ANAT = {
  beakHi: "#f7efdf",
  beakLo: "#d9c7a3",
  beakEdge: "#8f7d5c",
  mandible: "#3c3733",
  nostril: "#77664c",
  face: "#f4efe3",
  iris: "#e3c584",
  pupil: "#17110c",
  eyeRing: "#9c8a6a",
  legNear: "#8d8577",
  legFar: "#6e6759",
  claw: "#4a443c",
  patch: "#1b1b1b",
  strap: "#141414",
};

const spriteCache = new Map<string, SpriteEntry>();

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    Math.round(A[0] + (B[0] - A[0]) * t),
    Math.round(A[1] + (B[1] - A[1]) * t),
    Math.round(A[2] + (B[2] - A[2]) * t),
  );
}

function shadeHex(hex: string, t: number): string {
  return t >= 0 ? mixHex(hex, "#ffffff", t) : mixHex(hex, "#000000", -t);
}

function hexToRgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function parrotPalette(base: string) {
  return {
    base,
    crown: shadeHex(base, 0.1),
    chest: shadeHex(base, 0.18),
    deep: shadeHex(base, -0.3),
    wing: shadeHex(base, -0.1),
    wingLn: shadeHex(base, -0.26),
    covert: mixHex(base, "#e9c46a", 0.55),
    covertEdge: shadeHex(mixHex(base, "#e9c46a", 0.55), -0.25),
    prim: mixHex(base, "#1f3a5f", 0.6),
    primHi: shadeHex(mixHex(base, "#1f3a5f", 0.6), 0.25),
    tail: mixHex(base, "#1f3a5f", 0.38),
    line: shadeHex(base, -0.52),
  };
}

function parrotBodySVG(p: ReturnType<typeof parrotPalette>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">
<defs>
<linearGradient id="gB" x1="0" y1="60" x2="0" y2="345" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${p.crown}"/><stop offset="0.45" stop-color="${p.base}"/><stop offset="1" stop-color="${p.deep}"/>
</linearGradient>
<linearGradient id="gK" x1="222" y1="56" x2="266" y2="140" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${ANAT.beakHi}"/><stop offset="1" stop-color="${ANAT.beakLo}"/>
</linearGradient>
</defs>
<g stroke-linecap="round" stroke-linejoin="round">
<path d="M 118 312 C 92 350 66 378 50 404 C 62 407 78 396 91 372 C 103 350 113 331 121 317 Z" fill="${p.tail}"/>
<path d="M 118 312 C 95 346 72 374 56 398" fill="none" stroke="${p.primHi}" stroke-width="2" opacity="0.55"/>
<path d="M 127 316 C 109 348 93 372 82 391 C 94 391 107 374 117 352 C 123 340 127 328 129 318 Z" fill="${p.prim}"/>
<path d="M 134 318 C 124 340 113 357 106 367 C 117 365 127 350 135 331 Z" fill="${p.deep}"/>
<path d="M 148 336 L 146 365" fill="none" stroke="${ANAT.legFar}" stroke-width="9"/>
<path d="M 146 365 L 127 375 M 146 365 L 145 377 M 146 365 L 161 375" fill="none" stroke="${ANAT.legFar}" stroke-width="6"/>
<path d="M 168 106 C 136 118 116 140 112 168 C 106 208 96 252 100 292 C 102 318 118 334 142 340 C 168 346 190 338 202 318 C 218 292 228 250 230 210 C 232 178 224 148 208 128 C 196 114 182 106 168 106 Z" fill="url(#gB)" stroke="${p.line}" stroke-width="1.5" opacity="0.98"/>
<ellipse cx="214" cy="212" rx="24" ry="66" fill="${p.chest}" opacity="0.32" transform="rotate(-7 214 212)"/>
<circle cx="195" cy="88" r="44" fill="${p.crown}"/>
<path d="M 153 66 A 44 44 0 0 1 233 72" fill="none" stroke="${p.line}" stroke-width="1.5"/>
<path d="M 224 58 C 200 52 178 58 170 74 C 164 88 166 104 176 114 C 188 124 206 126 218 120 L 220 118 C 214 98 216 76 224 58 Z" fill="${ANAT.face}" stroke="${p.line}" stroke-width="1" opacity="0.96"/>
<path d="M 176 72 C 190 66 204 64 216 64 M 172 86 C 188 82 204 82 218 84 M 174 100 C 188 100 202 102 214 106" fill="none" stroke="${p.base}" stroke-width="1.6" opacity="0.8"/>
<path d="M 222 54 C 244 52 262 62 268 80 C 274 100 268 126 252 146 C 248 130 240 122 228 116 L 224 112 C 230 94 228 72 222 54 Z" fill="url(#gK)" stroke="${ANAT.beakEdge}" stroke-width="1.2"/>
<path d="M 226 58 C 244 58 258 68 263 82" fill="none" stroke="#fbf6ea" stroke-width="2" opacity="0.7"/>
<path d="M 224 112 C 236 116 246 128 252 144" fill="none" stroke="${ANAT.beakEdge}" stroke-width="1.5" opacity="0.8"/>
<path d="M 220 116 C 228 120 238 128 244 138 C 236 142 224 142 214 136 C 210 130 212 122 220 116 Z" fill="${ANAT.mandible}"/>
<ellipse cx="233" cy="64" rx="3" ry="2.4" fill="${ANAT.nostril}" transform="rotate(15 233 64)"/>
<circle cx="190" cy="84" r="8" fill="${ANAT.iris}" stroke="${ANAT.eyeRing}" stroke-width="1"/>
<circle cx="190" cy="84" r="4.4" fill="${ANAT.pupil}"/>
<circle cx="192" cy="81" r="1.8" fill="#ffffff"/>
<path d="M 214 56 C 196 60 178 64 162 72 C 152 78 146 86 142 96" fill="none" stroke="${ANAT.strap}" stroke-width="3.5"/>
<g transform="rotate(-16 173 67)">
<rect x="159" y="57" width="28" height="20" rx="6" fill="${ANAT.patch}"/>
<path d="M 164 62 C 169 59 177 58 182 60" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
</g>
<path d="M 176 332 L 174 363" fill="none" stroke="${ANAT.legNear}" stroke-width="10"/>
<path d="M 174 363 L 152 375 M 174 363 L 172 377 M 174 363 L 192 373" fill="none" stroke="${ANAT.legNear}" stroke-width="7"/>
<path d="M 152 375 L 147 378 M 172 377 L 171 381 M 192 373 L 196 377" fill="none" stroke="${ANAT.claw}" stroke-width="3"/>
</g>
</svg>`;
}

function parrotWingSVG(p: ReturnType<typeof parrotPalette>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">
<defs>
<linearGradient id="gW" x1="0" y1="150" x2="0" y2="350" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${p.wing}"/><stop offset="1" stop-color="${p.deep}"/>
</linearGradient>
</defs>
<g stroke-linecap="round" stroke-linejoin="round">
<path d="M 130 148 C 104 162 90 192 92 226 C 94 262 104 300 126 330 C 138 344 154 350 166 340 C 176 330 178 310 172 280 C 165 242 158 200 148 172 C 144 158 138 150 130 148 Z" fill="url(#gW)" stroke="${p.line}" stroke-width="1.5" opacity="0.98"/>
<path d="M 106 192 C 116 200 128 204 138 202 M 116 172 C 126 180 138 184 148 182 M 100 216 C 112 226 128 230 142 228" fill="none" stroke="${p.wingLn}" stroke-width="1.8" opacity="0.7"/>
<path d="M 100 242 C 116 256 138 262 158 256" fill="none" stroke="${p.covert}" stroke-width="12" opacity="0.95"/>
<path d="M 101 248 C 117 262 139 268 157 262" fill="none" stroke="${p.covertEdge}" stroke-width="2.5" opacity="0.8"/>
<path d="M 104 260 C 114 292 130 318 152 338 L 162 341 C 142 318 126 288 116 258 Z" fill="${p.prim}"/>
<path d="M 118 258 C 128 288 144 314 164 332 L 169 326 C 152 306 138 280 130 254 Z" fill="${p.prim}" opacity="0.85"/>
<path d="M 104 260 C 116 294 134 322 158 340 M 118 256 C 130 288 146 314 166 330" fill="none" stroke="${p.primHi}" stroke-width="1.6" opacity="0.6"/>
</g>
</svg>`;
}

function getParrotSprite(color: string): SpriteEntry {
  let entry = spriteCache.get(color);
  if (entry) return entry;
  const p = parrotPalette(color);
  entry = { body: new Image(), wing: new Image(), loaded: 0, ready: false };
  const arm = (img: HTMLImageElement, svg: string) => {
    img.onload = () => {
      entry!.loaded += 1;
      if (entry!.loaded === 2) entry!.ready = true;
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  arm(entry.body, parrotBodySVG(p));
  arm(entry.wing, parrotWingSVG(p));
  spriteCache.set(color, entry);
  return entry;
}

export function preloadParrots(colors: readonly string[]): void {
  for (const color of colors) getParrotSprite(color);
}

function fillEllipse(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  if (!(rx > 0) || !(ry > 0)) return;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

export class ParrotScene {
  private readonly particles: Particle[] = [];
  private shakeAmp = 0;
  private shakeDecay = 0;
  private fireFrame = 0;
  private shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  private bgKey = "";
  private sky: CanvasGradient | null = null;
  private haze: CanvasGradient | null = null;
  private wallL: CanvasGradient | null = null;
  private wallR: CanvasGradient | null = null;

  kick(type: "MAKE" | "MISS", x: number, y: number, color: string, coins: boolean): void {
    if (type === "MAKE") {
      this.spawnSplash(x, y - 30, 26, color || "#69f0ae");
      if (coins) this.spawnCoins(x, y - 40, 14);
    } else {
      this.shakeAmp = 12;
      this.shakeDecay = 12 / 0.22;
    }
  }

  frame(
    g: CanvasRenderingContext2D,
    dt: number,
    width: number,
    height: number,
    state: {
      bottle: Pose | null;
      liquid: LiquidState;
      groundY: number;
      drag: { startX: number; startY: number; curX: number; curY: number } | null;
      result: "MAKE" | "MISS" | null;
      resultAlpha: number;
      showGlow: boolean;
      isOnFire: boolean;
      liquidColor: string;
    },
  ): void {
    this.updateParticles(dt);
    if (!state.isOnFire) {
      if (!this.shooting && Math.random() < dt * 0.07) {
        this.shooting = {
          x: Math.random() * width * 0.6,
          y: 18 + Math.random() * 70,
          vx: 220 + Math.random() * 140,
          vy: 50 + Math.random() * 40,
          life: 0.55,
        };
      }
      if (this.shooting) {
        this.shooting.x += this.shooting.vx * dt;
        this.shooting.y += this.shooting.vy * dt;
        this.shooting.life -= dt;
        if (this.shooting.life <= 0 || this.shooting.y > state.groundY - 80) this.shooting = null;
      }
    } else {
      this.shooting = null;
    }

    let sx = 0;
    let sy = 0;
    if (this.shakeAmp > 0.2) {
      sx = (Math.random() - 0.5) * 2 * this.shakeAmp;
      sy = (Math.random() - 0.5) * 2 * this.shakeAmp;
      this.shakeAmp = Math.max(0, this.shakeAmp - this.shakeDecay * dt);
    }

    g.save();
    g.translate(sx, sy);
    this.drawBackground(g, width, height, state.groundY, state.isOnFire);
    this.drawWalls(g, width, state.groundY, state.isOnFire);
    if (this.shooting) {
      g.strokeStyle = `rgba(244,239,227,${Math.max(0, this.shooting.life * 1.4)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(this.shooting.x, this.shooting.y);
      g.lineTo(this.shooting.x - this.shooting.vx * 0.12, this.shooting.y - this.shooting.vy * 0.12);
      g.stroke();
    }
    this.drawFlickIndicator(g, state.drag, state.bottle);
    if (state.showGlow && state.bottle) this.drawLandingGlow(g, state.bottle, state.groundY);
    this.drawBottle(g, state.bottle, state.liquid, state.isOnFire, state.liquidColor, state.groundY);
    this.drawParticles(g);
    if (state.result) {
      const color = state.result === "MAKE" ? "#7dcea0" : "#c23b22";
      this.drawResult(g, width, height, state.result === "MAKE" ? "MAKE!" : "MISS", color, state.resultAlpha);
    }
    g.restore();
  }

  private ensureBg(g: CanvasRenderingContext2D, w: number, h: number, groundY: number, isOnFire: boolean): void {
    const key = `${w}|${h}|${groundY}|${isOnFire ? 1 : 0}`;
    if (this.bgKey === key && this.sky) return;
    const sky = g.createLinearGradient(0, 0, 0, groundY);
    if (isOnFire) {
      sky.addColorStop(0, "#1a0a04");
      sky.addColorStop(0.55, "#3a1408");
      sky.addColorStop(1, "#5a220c");
    } else {
      sky.addColorStop(0, "#071018");
      sky.addColorStop(0.45, "#0f2438");
      sky.addColorStop(1, "#16324a");
    }
    const haze = g.createLinearGradient(0, groundY - 90, 0, groundY);
    haze.addColorStop(0, "rgba(40, 90, 120, 0)");
    haze.addColorStop(1, isOnFire ? "rgba(120, 50, 20, 0.35)" : "rgba(50, 110, 140, 0.28)");
    const WALL = 14;
    const wallL = g.createLinearGradient(0, 0, WALL, 0);
    wallL.addColorStop(0, "rgba(42,28,18,0.95)");
    wallL.addColorStop(1, "rgba(90,60,36,0.75)");
    const wallR = g.createLinearGradient(w - WALL, 0, w, 0);
    wallR.addColorStop(0, "rgba(90,60,36,0.75)");
    wallR.addColorStop(1, "rgba(42,28,18,0.95)");
    this.bgKey = key;
    this.sky = sky;
    this.haze = haze;
    this.wallL = wallL;
    this.wallR = wallR;
  }

  private drawBackground(g: CanvasRenderingContext2D, w: number, h: number, groundY: number, isOnFire: boolean): void {
    this.ensureBg(g, w, h, groundY, isOnFire);
    g.fillStyle = this.sky!;
    g.fillRect(0, 0, w, groundY);
    g.fillStyle = this.haze!;
    g.fillRect(0, groundY - 90, w, 90);

    if (!isOnFire) {
      g.fillStyle = "rgba(244, 239, 227, 0.55)";
      for (let i = 0; i < 28; i += 1) {
        const sx = (i * 97) % w;
        const sy = 18 + ((i * 53) % Math.max(40, groundY - 120));
        g.beginPath();
        g.arc(sx, sy, i % 3 === 0 ? 1.4 : 0.9, 0, Math.PI * 2);
        g.fill();
      }
      const moonR = 14;
      const mx = w * 0.82;
      const my = Math.max(36, groundY * 0.18);
      g.fillStyle = "rgba(244,239,227,0.45)";
      g.beginPath();
      g.arc(mx, my, moonR, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(7,16,24,0.35)";
      g.beginPath();
      g.arc(mx + moonR * 0.35, my - moonR * 0.1, moonR * 0.85, 0, Math.PI * 2);
      g.fill();
    }

    g.fillStyle = "#3a2418";
    g.fillRect(0, groundY, w, h - groundY);
    g.strokeStyle = "rgba(0,0,0,0.28)";
    g.lineWidth = 1;
    for (let y = groundY + 18; y < h; y += 22) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.fillStyle = "rgba(197,154,74,0.18)";
    for (let x = 24; x < w; x += 64) {
      for (let y = groundY + 10; y < h; y += 22) {
        g.fillRect(x, y, 2, 2);
      }
    }
    g.fillStyle = "#5a3a24";
    g.fillRect(0, groundY - 4, w, 5);
    g.fillStyle = "rgba(197,154,74,0.35)";
    g.fillRect(0, groundY - 4, w, 1);
  }

  private drawWalls(g: CanvasRenderingContext2D, w: number, groundY: number, isOnFire: boolean): void {
    const WALL = 14;
    this.ensureBg(g, w, groundY + 40, groundY, isOnFire);
    g.fillStyle = this.wallL!;
    g.fillRect(0, 0, WALL, groundY);
    g.fillStyle = this.wallR!;
    g.fillRect(w - WALL, 0, WALL, groundY);
    g.fillStyle = "rgba(197,154,74,0.28)";
    g.fillRect(WALL - 2, 0, 2, groundY);
    g.fillRect(w - WALL, 0, 2, groundY);
  }

  private drawBottle(
    g: CanvasRenderingContext2D,
    bottle: Pose | null,
    liquid: LiquidState,
    isOnFire: boolean,
    liquidColor: string,
    groundY: number,
  ): void {
    if (!bottle) return;
    const { x, y } = bottle.position;
    const angle = bottle.angle;
    const flap = Math.max(-0.45, Math.min(0.45, (liquid.slosh || 0) * 0.55));
    const spr = getParrotSprite(liquidColor);

    if (isOnFire) {
      const glow = g.createRadialGradient(x, y, 10, x, y, 95);
      glow.addColorStop(0, "rgba(255,100,0,0.30)");
      glow.addColorStop(1, "rgba(255,60,0,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(x, y, 95, 0, Math.PI * 2);
      g.fill();
      if (++this.fireFrame % 3 === 0) this.spawnFire(x, y - 100);
    }

    const d = groundY - y;
    const a = Math.max(0, Math.min(1, 1 - (d - GROUND_SHADOW_REST) / 190));
    const rx = 44 + d * 0.08;
    const ry = 10 + d * 0.015;
    if (a > 0.02 && rx > 0 && ry > 0) {
      g.fillStyle = `rgba(0,0,0,${(0.34 * a).toFixed(3)})`;
      fillEllipse(g, x, groundY + 5, rx, ry);
    }

    g.save();
    g.translate(x, y);
    g.rotate(angle);
    if (spr.ready) {
      g.drawImage(spr.body, DEST_X, DEST_Y, DEST_W, DEST_H);
      g.save();
      g.translate(PIV_X, PIV_Y);
      g.rotate(flap * 0.5);
      g.translate(-PIV_X, -PIV_Y);
      g.drawImage(spr.wing, DEST_X, DEST_Y, DEST_W, DEST_H);
      g.restore();
    } else {
      g.fillStyle = liquidColor;
      fillEllipse(g, 0, -12, 30, 52);
      g.beginPath();
      g.arc(14, -72, 22, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    if (Math.abs(liquid.vel) > 1.6) {
      this.spawnSplash(x, y - 30, 2, hexToRgba(liquidColor, 0.85));
    }
  }

  private drawLandingGlow(g: CanvasRenderingContext2D, bottle: Pose, groundY: number): void {
    const cx = bottle.position.x;
    const glow = g.createRadialGradient(cx, groundY, 0, cx, groundY, 55);
    glow.addColorStop(0, "rgba(90, 255, 110, 0.50)");
    glow.addColorStop(1, "rgba(90, 255, 110, 0)");
    g.fillStyle = glow;
    fillEllipse(g, cx, groundY, 55, 16);
  }

  private drawFlickIndicator(
    g: CanvasRenderingContext2D,
    drag: { startX: number; startY: number; curX: number; curY: number } | null,
    bottle: Pose | null,
  ): void {
    if (!drag || !bottle) return;
    const dx = drag.curX - drag.startX;
    const dy = drag.curY - drag.startY;
    const len = Math.hypot(dx, dy);
    if (len < 18) return;
    const strength = Math.min(len / 220, 1);
    const ux = dx / len;
    const uy = dy / len;
    const reach = 28 + strength * 64;
    const ox = bottle.position.x;
    const oy = bottle.position.y - 40;
    const ex = ox + ux * reach;
    const ey = oy + uy * reach;
    const color = `hsl(${190 - strength * 150}, 95%, 62%)`;
    g.save();
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.lineCap = "round";
    g.globalAlpha = 0.88;
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(ex, ey);
    g.stroke();
    const a = Math.atan2(uy, ux);
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(ex - 14 * Math.cos(a - 0.45), ey - 14 * Math.sin(a - 0.45));
    g.moveTo(ex, ey);
    g.lineTo(ex - 14 * Math.cos(a + 0.45), ey - 14 * Math.sin(a + 0.45));
    g.stroke();
    g.restore();
  }

  private drawResult(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    text: string,
    color: string,
    alpha: number,
  ): void {
    const pop = 1 + 0.18 * Math.sin(Math.min(alpha, 1) * Math.PI);
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = color;
    g.shadowBlur = 36;
    g.translate(w / 2, h / 2 - 60);
    g.scale(pop, pop);
    g.font = `bold ${text.length > 10 ? 48 : 76}px Georgia, "Times New Roman", serif`;
    g.fillText(text, 0, 0);
    g.restore();
  }

  private spawnSplash(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 180,
        vy: -Math.random() * 160 - 30,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        r: 2.5 + Math.random() * 2.5,
        color,
      });
    }
  }

  private spawnFire(x: number, y: number): void {
    for (let i = 0; i < 2; i += 1) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 28,
        y,
        vx: (Math.random() - 0.5) * 50,
        vy: -70 - Math.random() * 100,
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.6,
        r: 5 + Math.random() * 5,
        color: Math.random() > 0.45 ? "#ff6600" : "#ffcc00",
        fire: true,
      });
    }
  }

  private spawnCoins(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 220,
        vy: -Math.random() * 200 - 40,
        life: 0.55 + Math.random() * 0.35,
        maxLife: 0.9,
        r: 3 + Math.random() * 2,
        color: Math.random() > 0.4 ? "#ffd54a" : "#c59a4a",
        coin: true,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i]!;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      g.globalAlpha = a * 0.9;
      g.fillStyle = p.color;
      if (p.coin) fillEllipse(g, p.x, p.y, p.r, p.r * 0.7);
      else {
        g.beginPath();
        g.arc(p.x, p.y, p.r * (0.4 + 0.6 * a), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
}
