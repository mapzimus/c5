import type { Disc, HitEvent, FallEvent, MatchPlayer } from "./types";

export interface Perk {
  id: string;
  name: string;
  description: string;
  category: "launch" | "defense" | "tactical" | "chaos";
  icon: string;
  /** False or absent = perk has no implemented behavior and is hidden from the draft pool. */
  ready?: boolean;
  onApply?(disc: Disc, player: MatchPlayer): void;
  onLaunch?(disc: Disc, player: MatchPlayer): { speedMul?: number; massMul?: number };
  onHit?(event: HitEvent, disc: Disc, player: MatchPlayer): void;
  onFall?(event: FallEvent, player: MatchPlayer): void;
  onTurnStart?(disc: Disc, player: MatchPlayer): void;
}

export const ALL_PERKS: Perk[] = [
  {
    id: "heavy-hitter",
    name: "Heavy Hitter",
    description: "+30% launch speed",
    category: "launch",
    icon: "HH",
    ready: true,
    onLaunch: () => ({ speedMul: 1.3 }),
  },
  {
    id: "featherweight",
    name: "Featherweight",
    description: "Lower mass, harder to push but easier to fall",
    category: "defense",
    icon: "FW",
    ready: true,
    onApply: (d) => { d.baseMass *= 0.6; d.mass = d.baseMass; },
  },
  {
    id: "rubber-bumper",
    name: "Rubber Bumper",
    description: "+40% bounce on collisions",
    category: "defense",
    icon: "RB",
  },
  {
    id: "iron-wall",
    name: "Iron Wall",
    description: "+60% mass, harder to knock off",
    category: "defense",
    icon: "IW",
    ready: true,
    onApply: (d) => { d.baseMass *= 1.6; d.mass = d.baseMass; },
  },
  {
    id: "ghost-step",
    name: "Ghost Step",
    description: "Phase through first collision each turn",
    category: "tactical",
    icon: "GS",
  },
  {
    id: "magnet-pull",
    name: "Magnet Pull",
    description: "Disc curves slightly toward nearest enemy",
    category: "tactical",
    icon: "MP",
  },
  {
    id: "quick-draw",
    name: "Quick Draw",
    description: "Aim appears 0.5s faster",
    category: "launch",
    icon: "QD",
  },
  {
    id: "lucky-bounce",
    name: "Lucky Bounce",
    description: "20% chance to survive a fall",
    category: "chaos",
    icon: "LB",
  },
  {
    id: "aftershock",
    name: "Aftershock",
    description: "On hit, small knockback pulse to nearby discs",
    category: "chaos",
    icon: "AS",
  },
  {
    id: "shield-bash",
    name: "Shield Bash",
    description: "First hit each turn deals 2x knockback",
    category: "defense",
    icon: "SB",
  },
  {
    id: "boomerang",
    name: "Boomerang",
    description: "Disc curves back toward start after stopping",
    category: "tactical",
    icon: "BM",
  },
  {
    id: "chaos-orb",
    name: "Chaos Orb",
    description: "Random power-up on launch",
    category: "chaos",
    icon: "CO",
  },
];

export interface DraftState {
  active: boolean;
  draftingPlayer: number;
  choices: Perk[];
  timer: number;
}

export function createDraft(): DraftState {
  return { active: false, draftingPlayer: -1, choices: [], timer: 0 };
}

export function startDraft(state: DraftState, loser: number, players: MatchPlayer[], random: () => number): void {
  state.active = true;
  state.draftingPlayer = loser;
  const owned = new Set(players[loser]!.perks);
  const available = ALL_PERKS.filter((p) => p.ready && !owned.has(p.id));
  const shuffled = available.sort(() => random() - 0.5);
  state.choices = shuffled.slice(0, Math.min(3, shuffled.length));
  state.timer = 15;
}

export function applyPerk(perkId: string, player: MatchPlayer): void {
  if (!player.perks.includes(perkId)) {
    player.perks.push(perkId);
  }
}

export function getPerk(id: string): Perk | undefined {
  return ALL_PERKS.find((p) => p.id === id);
}

export function getPlayerPerks(player: MatchPlayer): Perk[] {
  return player.perks.map((id) => getPerk(id)).filter((p): p is Perk => p != null);
}

export function applyPerksToDiscs(discs: Disc[], player: MatchPlayer): void {
  const perks = getPlayerPerks(player);
  for (const d of discs) {
    if (d.owner === player.id) {
      d.perks = [...player.perks];
      for (const perk of perks) {
        perk.onApply?.(d, player);
      }
    }
  }
}

export function firePerkHooks(
  hook: "onHit" | "onFall" | "onTurnStart",
  event: HitEvent | FallEvent | Disc,
  playersOrPlayer: MatchPlayer[] | MatchPlayer,
): void {
  if (hook === "onHit") {
    const e = event as HitEvent;
    const players = playersOrPlayer as MatchPlayer[];
    for (const d of [e.a, e.b]) {
      const p = players[d.owner];
      if (!p) continue;
      for (const perk of getPlayerPerks(p)) {
        perk.onHit?.(e, d, p);
      }
    }
  } else if (hook === "onFall") {
    const e = event as FallEvent;
    const players = playersOrPlayer as MatchPlayer[];
    const p = players[e.disc.owner];
    if (p) {
      for (const perk of getPlayerPerks(p)) {
        perk.onFall?.(e, p);
      }
    }
  } else if (hook === "onTurnStart") {
    const d = event as Disc;
    const p = playersOrPlayer as MatchPlayer;
    for (const perk of getPlayerPerks(p)) {
      perk.onTurnStart?.(d, p);
    }
  }
}

export function applyLaunchPerks(disc: Disc, player: MatchPlayer): { speedMul: number; massMul: number } {
  let speedMul = 1;
  let massMul = 1;
  for (const perk of getPlayerPerks(player)) {
    if (perk.onLaunch) {
      const mod = perk.onLaunch(disc, player);
      if (mod.speedMul) speedMul *= mod.speedMul;
      if (mod.massMul) massMul *= mod.massMul;
    }
  }
  return { speedMul, massMul };
}

export function drawDraftUI(
  g: CanvasRenderingContext2D,
  draft: DraftState,
  players: MatchPlayer[],
  hoverIndex: number,
): void {
  if (!draft.active || draft.choices.length === 0) return;
  const player = players[draft.draftingPlayer]!;

  g.fillStyle = "rgba(0,0,0,0.7)";
  g.fillRect(0, 0, 1280, 720);

  g.fillStyle = "#F4F7FB";
  g.font = "700 40px Bebas Neue, Impact, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(`${player.name} — PICK A PERK`, 640, 120);

  const cardW = 220;
  const cardH = 280;
  const gap = 40;
  const totalW = draft.choices.length * cardW + (draft.choices.length - 1) * gap;
  const startX = 640 - totalW / 2;

  for (let i = 0; i < draft.choices.length; i++) {
    const perk = draft.choices[i]!;
    const x = startX + i * (cardW + gap);
    const y = 200;
    const hover = i === hoverIndex;

    g.save();
    if (hover) {
      g.translate(x + cardW / 2, y + cardH / 2);
      g.scale(1.05, 1.05);
      g.translate(-(x + cardW / 2), -(y + cardH / 2));
    }

    g.fillStyle = "rgba(20,30,50,0.9)";
    g.strokeStyle = hover ? player.color : "#475569";
    g.lineWidth = hover ? 3 : 2;
    g.beginPath();
    g.roundRect(x, y, cardW, cardH, 16);
    g.fill();
    g.stroke();

    const catColor: Record<string, string> = {
      launch: "#ffcc00",
      defense: "#3399ff",
      tactical: "#cc66ff",
      chaos: "#ff6633",
    };

    g.fillStyle = catColor[perk.category] ?? "#999";
    g.font = "700 36px monospace";
    g.textAlign = "center";
    g.fillText(perk.icon, x + cardW / 2, y + 60);

    g.fillStyle = "#F4F7FB";
    g.font = "700 18px Outfit, sans-serif";
    g.fillText(perk.name, x + cardW / 2, y + 120);

    g.fillStyle = "#94a3b8";
    g.font = "400 14px Outfit, sans-serif";
    wrapText(g, perk.description, x + cardW / 2, y + 160, cardW - 20, 18);

    g.fillStyle = catColor[perk.category] ?? "#999";
    g.font = "600 12px Outfit, sans-serif";
    g.fillText(perk.category.toUpperCase(), x + cardW / 2, y + cardH - 20);

    g.restore();
  }

  // timer
  g.fillStyle = draft.timer < 5 ? "#ff3333" : "#94a3b8";
  g.font = "600 20px Outfit, sans-serif";
  g.textAlign = "center";
  g.fillText(`${Math.ceil(draft.timer)}s`, 640, 540);
}

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, cy);
      line = word;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) g.fillText(line, x, cy);
}
