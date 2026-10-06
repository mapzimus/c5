interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: number;
}

export class Sky {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly motes: Mote[] = [];
  private raf = 0;
  private last = 0;
  private running = false;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is required");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", this.resize);
    const hues = [190, 340, 40, 80];
    for (let i = 0; i < 60; i += 1) {
      this.motes.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.02,
        vy: (Math.random() - 0.5) * 0.02,
        size: 2 + Math.random() * 4,
        alpha: 0.15 + Math.random() * 0.35,
        hue: hues[i % hues.length]!,
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
    this.time += dt;
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

    for (const mote of this.motes) {
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      if (mote.x < -0.05) mote.x = 1.05;
      if (mote.x > 1.05) mote.x = -0.05;
      if (mote.y < -0.05) mote.y = 1.05;
      if (mote.y > 1.05) mote.y = -0.05;
      const pulse = mote.alpha + Math.sin(this.time * 1.2 + mote.x * 10) * 0.1;
      ctx.beginPath();
      ctx.arc(mote.x * w, mote.y * h, mote.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${mote.hue}, 80%, 65%, ${pulse})`;
      ctx.fill();
    }

    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = "#3ee0ff";
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i += 1) {
      const cx = w * (0.15 + (i % 4) * 0.22);
      const cy = h * (i < 4 ? 0.3 : 0.7);
      const r = 60 + Math.sin(this.time * 0.5 + i) * 20;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.resize);
  }
}
