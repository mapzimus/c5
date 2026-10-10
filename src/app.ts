import { Sfx } from "./core/audio";
import { Engine } from "./core/engine";
import { InputManager } from "./core/input";
import { GameRegistry } from "./core/registry";
import { Session } from "./core/session";
import { DEFAULT_NAMES, PLAYER_COLORS, type GameDefinition, type GameStat, type Player } from "./core/types";
import { Sky } from "./fx/sky";
import { createRegistry } from "./games";
import { clear, el } from "./ui/dom";

type ScreenName = "menu" | "play" | "results";

export class App {
  private readonly root: HTMLElement;
  private readonly registry: GameRegistry;
  private readonly input = new InputManager();
  private readonly sfx = new Sfx();
  private readonly screens = new Map<ScreenName, HTMLElement>();
  private session: Session;
  private players: Player[];
  private selected: GameDefinition | null = null;
  private engine: Engine | null = null;
  private sky: Sky | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.registry = createRegistry();
    this.players = [makePlayer(0), makePlayer(1)];
    this.session = new Session(this.players);
  }

  start(): void {
    this.root.replaceChildren();
    const sky = el("canvas", { id: "sky" });
    const shell = el("div", { id: "shell" });
    this.root.append(sky, shell);
    this.sky = new Sky(sky);
    this.sky.start();

    for (const name of ["menu", "play", "results"] as const) {
      const screen = el("section", { class: "screen", id: `screen-${name}` });
      this.screens.set(name, screen);
      shell.append(screen);
    }

    this.renderMenu();
    this.show("menu");
    window.addEventListener("keydown", this.onGlobalKey);
  }

  private readonly onGlobalKey = (event: KeyboardEvent): void => {
    if (event.code === "Escape" && this.screens.get("play")?.classList.contains("active")) {
      this.engine?.abort();
      this.renderMenu();
      this.show("menu");
    }
  };

  private show(name: ScreenName): void {
    for (const [key, node] of this.screens) {
      node.classList.toggle("active", key === name);
    }
  }

  private renderMenu(): void {
    const screen = this.screens.get("menu")!;
    clear(screen);
    const games = this.registry.list();
    screen.append(
      el("header", { class: "menu-head" },
        el("p", { class: "brand", text: "Category Five" }),
        el("h1", { class: "display", text: "Pick a game" }),
        el("p", { class: "lede", text: this.pickPrompt() ?? "Win it and you pick the next one." }),
      ),
      el("div", { class: "section-label", text: "Players" }),
      this.playerBar(),
      el("div", { class: "section-label", text: `${games.length} games` }),
      this.gameCards(),
    );
  }

  /** Who picks next, e.g. "Gale won, Gale picks next". Null before the first game. */
  private pickPrompt(): string | null {
    const picker = this.session.picker();
    return picker ? `${picker.name} won. ${picker.name} picks the next game.` : null;
  }

  private rerenderMenu(): void {
    this.renderMenu();
    this.show("menu");
  }

  private gameCards(): HTMLElement {
    const games = this.registry.list();
    const cards = el("div", { class: "cards" });
    games.forEach((game, index) => {
      const accent = ACCENTS[index % ACCENTS.length]!;
      const card = el("button", { class: "card", style: `--accent:${accent}` });
      card.append(
        el("span", { class: "card-icon", text: GAME_ICONS[game.id] ?? "🎲", "aria-hidden": "true" }),
        el("span", { class: "tag", text: game.durationMs > 0 ? `${game.durationMs / 1000}s` : "Turns" }),
        el("h3", { text: game.name }),
        el("p", { text: game.tagline }),
      );
      card.addEventListener("click", () => {
        this.sfx.unlock();
        this.sfx.select();
        this.launch(game);
      });
      cards.append(card);
    });
    if (games.length === 0) {
      cards.append(
        el("div", { class: "card empty-card" },
          el("span", { class: "tag", text: "Soon" }),
          el("h3", { text: "No games yet" }),
          el("p", { text: "Register a game and it will land here." }),
        ),
      );
    }
    return cards;
  }

  private playerBar(): HTMLElement {
    const bar = el("div", { class: "players" });
    this.players.forEach((player, index) => bar.append(this.playerPill(player, index)));
    if (this.players.length < 4) {
      const add = el("button", { class: "pill add-pill", text: "+ Add player" });
      add.addEventListener("click", () => {
        this.players.push(makePlayer(this.players.length as 0 | 1 | 2 | 3));
        this.resetSession();
        this.rerenderMenu();
      });
      bar.append(add);
    }
    return bar;
  }

  private playerPill(player: Player, index: number): HTMLElement {
    const pill = el("div", { class: "pill", style: `--accent:${player.color}` });
    const name = el("input", {
      type: "text",
      value: player.name,
      maxlength: "12",
      size: "7",
      "aria-label": `Player ${index + 1} name`,
    });
    name.addEventListener("input", () => {
      player.name = name.value.slice(0, 12) || DEFAULT_NAMES[index]!;
    });
    const isBot = player.kind === "bot";
    const kind = el("button", {
      class: `pill-kind${isBot ? " bot" : ""}`,
      text: isBot ? "🤖 Bot" : "🙂 Human",
      title: "Switch Human / Bot",
    });
    kind.addEventListener("click", () => {
      player.kind = isBot ? "human" : "bot";
      this.rerenderMenu();
    });
    pill.append(el("span", { class: "swatch" }), name, kind);

    const wins = this.session.standings.find((s) => s.playerId === player.id)?.wins ?? 0;
    if (this.session.gamesPlayed > 0) {
      pill.append(el("span", { class: "pill-pts", text: `${wins} ${wins === 1 ? "pt" : "pts"}` }));
    }
    if (this.players.length > 1) {
      const remove = el("button", { class: "pill-x", text: "×", "aria-label": `Remove ${player.name}` });
      remove.addEventListener("click", () => {
        this.players.splice(index, 1);
        this.players.forEach((item, slot) => {
          item.slot = slot as 0 | 1 | 2 | 3;
        });
        this.resetSession();
        this.rerenderMenu();
      });
      pill.append(remove);
    }
    return pill;
  }

  private standingRow(): HTMLElement {
    const row = el("div", { class: "standings" });
    for (const standing of this.session.standings) {
      const player = this.players.find((item) => item.id === standing.playerId);
      if (!player) continue;
      row.append(
        el("span", {
          class: "chip",
          text: `${player.name}  ${standing.wins} ${standing.wins === 1 ? "pt" : "pts"}`,
          style: `border-color:${player.color}`,
        }),
      );
    }
    return row;
  }

  private launch(game: GameDefinition): void {
    this.selected = game;
    const screen = this.screens.get("play")!;
    clear(screen);

    const info = el("div", { class: "pregame" });
    info.append(
      el("p", { class: "brand", text: game.durationMs > 0 ? `${game.durationMs / 1000}s` : "Turn-based" }),
      el("h2", { class: "display", text: game.name }),
      el("p", { class: "lede", text: game.description }),
      el("p", { class: "controls-hint", text: game.controls }),
      el("div", { class: "row" },
        button("Play", () => { this.sfx.select(); this.startPlay(game); }),
        ghost("Back", () => { this.renderMenu(); this.show("menu"); }),
      ),
    );
    screen.append(info);
    this.show("play");
  }

  private startPlay(game: GameDefinition): void {
    const screen = this.screens.get("play")!;
    clear(screen);
    const bar = el("div", { class: "hud-bar" });
    bar.append(
      el("strong", { text: game.name }),
      ghost("Menu", () => {
        this.engine?.abort();
        exitFullscreen();
        this.renderMenu();
        this.show("menu");
      }),
    );
    const wrap = el("div", { class: "play-wrap" });
    const canvas = el("canvas", { id: "game" });
    wrap.append(canvas);
    screen.append(bar, wrap);
    if (!game.fillsScreen) {
      screen.append(el("p", { class: "rotate-hint", text: "Turn your phone sideways for a bigger board" }));
      enterLandscape();
    }
    this.engine?.destroy();
    this.engine = new Engine(canvas, this.input, this.sfx);
    this.engine.start(game, this.players, (scores, stats) => this.finishGame(scores, stats));
    requestAnimationFrame(() => this.engine?.fit());
  }

  private finishGame(scores: { playerId: string; score: number }[], stats: GameStat[] = []): void {
    const ranked = this.session.applyResults(scores);
    const screen = this.screens.get("results")!;
    clear(screen);
    const list = el("div", { class: "results" });
    for (const result of ranked) {
      const player = this.players.find((item) => item.id === result.playerId);
      if (!player) continue;
      const row = el("div", { class: "result" });
      row.append(
        el("span", { class: "rank", text: `${result.rank}`, style: `color:${player.color}` }),
        el("strong", { text: player.name }),
        el("span", { text: `${result.score}` }),
        el("span", { class: "hint", text: result.won ? "+1 pt" : "" }),
      );
      const playerStats = stats.filter((s) => s.playerId === result.playerId);
      if (playerStats.length > 0) {
        const statLine = playerStats.map((s) => `${s.label}: ${s.value}`).join("  ·  ");
        row.append(el("span", { class: "stat-line", text: statLine }));
      }
      list.append(row);
    }
    const picker = this.session.picker();
    const next = el("div", { class: "pick-next" });
    if (picker?.kind === "bot") {
      // Bots don't tap screens: pick for them and let a human start it.
      const games = this.registry.list();
      const choice = games[Math.floor(Math.random() * games.length)];
      if (choice) {
        next.append(
          el("h3", { text: `${picker.name} picks ${choice.name}`, style: `color:${picker.color}` }),
          el("div", { class: "row" }, button(`Play ${choice.name}`, () => {
            this.sfx.unlock();
            this.launch(choice);
          })),
        );
      }
    } else if (picker) {
      next.append(el("h3", { text: `${picker.name}, pick the next game`, style: `color:${picker.color}` }), this.gameCards());
    }
    screen.append(
      el("p", { class: "brand", text: this.selected?.name ?? "Results" }),
      el("h2", { class: "display", text: "Results" }),
      list,
      this.standingRow(),
      next,
      el("div", { class: "row" },
        ghost("Menu", () => {
          this.renderMenu();
          this.show("menu");
        }),
      ),
    );
    this.show("results");
  }

  private resetSession(): void {
    this.session = new Session(this.players);
  }
}

const ACCENTS = ["#3EE0FF", "#FF3D7A", "#FFB020", "#B8FF3D", "#A78BFA", "#FF8A3D"] as const;

const GAME_ICONS: Record<string, string> = {
  pairs: "🃏",
  "parrot-flip": "🦜",
  "castle-siege": "🏰",
  "lucky-drop": "🍀",
  "eye-of-the-storm": "🎯",
  "booty-haul": "🏴‍☠️",
  "chaos-derby": "🏇",
  "bug-wars": "🐞",
  "kaboom-isle": "💣",
  nerve: "🧠",
  fling: "🪀",
  whack: "🔨",
  "flappy-race": "🐦",
  "connect-four": "🔴",
};

function makePlayer(index: 0 | 1 | 2 | 3): Player {
  return {
    id: `p${index + 1}`,
    name: DEFAULT_NAMES[index]!,
    color: PLAYER_COLORS[index]!,
    kind: index === 0 ? "human" : "bot",
    slot: index,
  };
}

function button(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const node = el("button", { class: extraClass ? `btn ${extraClass}` : "btn", text: label });
  node.addEventListener("click", onClick);
  return node;
}

function ghost(label: string, onClick: () => void): HTMLButtonElement {
  return button(label, onClick, "ghost");
}

const coarse = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;

/** On phones and tablets: go fullscreen and try to lock landscape. Browsers that refuse just keep the normal layout. */
function enterLandscape(): void {
  if (!coarse() || document.fullscreenElement) return;
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  document.documentElement
    .requestFullscreen?.()
    .then(() => orientation.lock?.("landscape"))
    .catch(() => {});
}

function exitFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
