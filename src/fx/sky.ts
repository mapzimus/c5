interface Drop {
  x: number;
  y: number;
  z: number;
  len: number;
}

export class Sky {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly drops: Drop[] = [];
  private flash = 0;
  private angle = 0;
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is required");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", this.resize);
    for (let i = 0; i < 140; i += 1) {
      this.drops.push({
        x: Math.random(),
        y: Math.random(),
        z: 0.4 + Math.random() * 0.8,
        len: 8 + Math.random() * 16,
      });
    }
  }

  readonly resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly tick = (now: number): void => {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.angle += dt * 0.18;
    this.flash = Math.max(0, this.flash - dt);
    if (Math.random() < 0.004) this.flash = 0.35 + Math.random() * 0.4;
    this.draw(dt);
    if (this.running) this.raf = requestAnimationFrame(this.tick);
  };

  private draw(dt: number): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#09111d");
    g.addColorStop(1, "#05070c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w * 0.72, h * 0.18);
    ctx.rotate(this.angle);
    for (let i = 6; i >= 1; i -= 1) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(62,224,255,${0.04 + i * 0.015})`;
      ctx.lineWidth = 10 - i;
      ctx.arc(0, 0, 40 + i * 42, i * 0.4, i * 0.4 + Math.PI * 1.3);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(170,210,255,0.35)";
    ctx.lineWidth = 1;
    for (const drop of this.drops) {
      drop.y += dt * (0.55 + drop.z * 0.9);
      drop.x += dt * 0.08 * drop.z;
      if (drop.y > 1.1) {
        drop.y = -0.05;
        drop.x = Math.random();
      }
      const x = drop.x * w;
      const y = drop.y * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 4 * drop.z, y + drop.len * drop.z);
      ctx.stroke();
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(210,230,255,${this.flash * 0.28})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.resize);
  }
}
