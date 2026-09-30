import type { Sfx } from "../../../core/audio";
import type { HitEvent, FallEvent } from "./types";

export class KnockaboutAudio {
  constructor(private readonly sfx: Sfx) {}

  onCountdown(): void {
    this.sfx.countdown();
  }

  onGo(): void {
    this.sfx.go();
  }

  onHit(event: HitEvent): void {
    if (event.strength > 0.6) {
      this.sfx.hit();
    }
  }

  onFall(_event: FallEvent): void {
    this.sfx.miss();
  }

  onBumperHit(): void {
    this.sfx.tick();
  }

  onPowerUp(): void {
    this.sfx.collect();
  }

  onExplode(): void {
    this.sfx.hit();
  }

  onRoundEnd(): void {
    this.sfx.streak(3);
  }

  onMatchEnd(): void {
    this.sfx.win();
  }

  onDraftPick(): void {
    this.sfx.go();
  }
}
