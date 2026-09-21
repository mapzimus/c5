/** Tiny Web Audio synth so the repo stays asset-free. */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  unlock(): void {
    this.ensure();
  }

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain = 0.08, when = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + duration);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(ctx.currentTime + when);
    osc.stop(ctx.currentTime + when + duration);
  }

  countdown(): void {
    this.tone(440, 0.12, "square", 0.06);
  }

  go(): void {
    this.tone(660, 0.18, "square", 0.08);
    this.tone(880, 0.18, "triangle", 0.05, 0.02);
  }

  collect(): void {
    this.tone(720, 0.08, "triangle", 0.06);
    this.tone(980, 0.1, "sine", 0.04, 0.04);
  }

  streak(level: number): void {
    const base = 720 + Math.min(6, Math.max(1, level)) * 90;
    this.tone(base, 0.09, "triangle", 0.07);
    this.tone(base + 240, 0.12, "sine", 0.05, 0.05);
    if (level >= 3) this.tone(base + 420, 0.14, "square", 0.03, 0.08);
  }

  hit(): void {
    this.tone(140, 0.16, "sawtooth", 0.07);
  }

  miss(): void {
    this.tone(180, 0.1, "square", 0.04);
  }

  win(): void {
    this.tone(523, 0.12, "triangle", 0.07);
    this.tone(659, 0.12, "triangle", 0.07, 0.1);
    this.tone(784, 0.22, "triangle", 0.08, 0.2);
  }

  tick(): void {
    this.tone(320, 0.04, "square", 0.03);
  }
}
