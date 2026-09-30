import type { Disc, MatchPlayer } from "./types";
import { TUNING } from "./types";
import { sdf } from "./arena";
import type { World } from "./world";

export type BotDifficulty = "easy" | "normal" | "hard";

interface ShotCandidate {
  dx: number;
  dy: number;
  power: number;
  score: number;
}

const CANDIDATES: Record<BotDifficulty, number> = { easy: 5, normal: 15, hard: 30 };
const NOISE: Record<BotDifficulty, number> = { easy: 0.35, normal: 0.15, hard: 0.05 };

export function botChooseShot(
  world: World,
  disc: Disc,
  players: MatchPlayer[],
  difficulty: BotDifficulty,
  random: () => number,
): { dx: number; dy: number; power: number } | null {
  const alive = world.aliveDiscs();
  if (alive.length < 2) return null;

  const n = CANDIDATES[difficulty];
  const noise = NOISE[difficulty];
  const best: ShotCandidate[] = [];

  for (let i = 0; i < n; i++) {
    const angle = random() * Math.PI * 2;
    const power = 0.3 + random() * 0.7;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const score = evaluateShot(world, disc, dx, dy, power, players, random);
    best.push({ dx, dy, power, score });
  }

  best.sort((a, b) => b.score - a.score);

  const pick = best[0];
  if (!pick) return null;

  return {
    dx: pick.dx + (random() - 0.5) * noise,
    dy: pick.dy + (random() - 0.5) * noise,
    power: Math.min(1, Math.max(0.2, pick.power + (random() - 0.5) * noise)),
  };
}

function evaluateShot(
  world: World,
  disc: Disc,
  dx: number,
  dy: number,
  power: number,
  _players: MatchPlayer[],
  _random: () => number,
): number {
  const a = world.arena;
  const speed = TUNING.maxLaunchSpeed * power * (disc.turbo ? TUNING.turboMul : 1);
  let vx = dx * speed;
  let vy = dy * speed;
  let x = disc.x;
  let y = disc.y;

  const h = 1 / 60;
  let score = 0;
  const enemies = world.aliveDiscs().filter((d) => d.owner !== disc.owner && !d.dead && !d.falling);
  const allies = world.aliveDiscs().filter((d) => d.owner === disc.owner && d !== disc && !d.dead && !d.falling);

  for (let step = 0; step < 120; step++) {
    const sp = Math.hypot(vx, vy);
    if (sp < 0.02) break;
    let ns = Math.max(0, sp - TUNING.slide * h) * Math.exp(-TUNING.drag * h);
    if (ns < 0.012) ns = 0;
    const k = ns / sp;
    vx *= k;
    vy *= k;
    x += vx * h;
    y += vy * h;

    if (sdf(a, x, y) > 0) {
      score -= 50;
      break;
    }

    for (const e of enemies) {
      const d = Math.hypot(x - e.x, y - e.y);
      if (d < disc.r + e.r + 0.02) {
        const edgeDist = -sdf(a, e.x, e.y);
        const nearEdge = edgeDist < 0.15;
        score += nearEdge ? 30 : 15;
        const pushDir = Math.hypot(x - e.x, y - e.y);
        if (pushDir > 0) {
          const ex2 = e.x + (e.x - x) / pushDir * 0.2;
          const ey2 = e.y + (e.y - y) / pushDir * 0.2;
          if (sdf(a, ex2, ey2) > 0) score += 25;
        }
      }
    }

    for (const al of allies) {
      if (Math.hypot(x - al.x, y - al.y) < disc.r + al.r + 0.02) {
        score -= 10;
      }
    }
  }

  const finalEdge = -sdf(a, x, y);
  if (finalEdge < 0.1) score -= 20;
  else score += finalEdge * 5;

  return score;
}
