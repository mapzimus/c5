import { Sfx } from "./core/audio";
import { Engine } from "./core/engine";
import { InputManager } from "./core/input";
import { GameRegistry } from "./core/registry";
import { rankResults } from "./core/session";
import { PLAYER_COLORS, type GameDefinition, type GameStat, type Player } from "./core/types";
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
  private players: Player[];
  private selected: GameDefinition | null = null;
  private engine: Engine | null = null;
  private sky: Sky | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.registry = createRegistry();
    this.players = [makePlayer(0), makePlayer(1)];
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
    const head = el("header", { class: "menu-head" },
      el("h1", { class: "wordmark", text: "Category Five" }),
    );
    screen.append(head, this.matchup(), this.gameCards());
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
        el("span", { class: "card-num", text: String(index + 1).padStart(2, "0") }),
        el("h3", { text: game.name }),
        el("p", { text: game.tagline }),
        el("span", { class: "tag", text: game.durationMs > 0 ? `${game.durationMs / 1000} sec` : "Turns" }),
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
          el("h3", { text: "No games yet" }),
          el("p", { text: "Register a game and it will land here." }),
        ),
      );
    }
    return cards;
  }

  /** "YOU vs BOT" header. Tap a name to rename, tap the tag to swap Human / Bot. */
  private matchup(): HTMLElement {
    const row = el("div", { class: "matchup" });
    this.players.forEach((player, index) => {
      if (index > 0) row.append(el("span", { class: "vs", text: "vs" }));
      row.append(this.fighter(player, index));
    });
    if (this.players.length < 4) {
      const add = el("button", { class: "add-fighter", text: "+", "aria-label": "Add player", title: "Add player" });
      add.addEventListener("click", () => {
        this.players.push(makePlayer(this.players.length as 0 | 1 | 2 | 3));
        this.rerenderMenu();
      });
      row.append(add);
    }
    return row;
  }

  private fighter(player: Player, index: number): HTMLElement {
    const box = el("div", { class: "fighter", style: `--accent:${player.color}` });
    const name = el("input", {
      class: "fighter-name",
      type: "text",
      value: player.name,
      maxlength: "10",
      spellcheck: "false",
      "aria-label": `Player ${index + 1} name`,
    });
    name.style.width = `${Math.max(3, player.name.length) + 0.5}ch`;
    name.addEventListener("input", () => {
      name.style.width = `${Math.max(3, name.value.length) + 0.5}ch`;
      player.name = name.value.slice(0, 10) || defaultName(index, player.kind);
    });

    const isBot = player.kind === "bot";
    const kind = el("button", { class: "fighter-kind", text: isBot ? "Bot" : "Human", title: "Switch Human / Bot" });
    kind.addEventListener("click", () => {
      const nextKind = isBot ? "human" : "bot";
      if (player.name === defaultName(index, player.kind)) player.name = defaultName(index, nextKind);
      player.kind = nextKind;
      this.rerenderMenu();
    });
    const meta = el("div", { class: "fighter-meta" }, kind);

    if (this.players.length > 2) {
      const remove = el("button", { class: "fighter-x", text: "Remove", "aria-label": `Remove ${player.name}` });
      remove.addEventListener("click", () => {
        this.players.splice(index, 1);
        this.players.forEach((item, slot) => {
          item.slot = slot as 0 | 1 | 2 | 3;
        });
        this.rerenderMenu();
      });
      meta.append(remove);
    }
    box.append(name, meta);
    return box;
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
    const game = this.selected;
    const ranked = rankResults(scores);
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
      );
      const playerStats = stats.filter((s) => s.playerId === result.playerId);
      if (playerStats.length > 0) {
        const statLine = playerStats.map((s) => `${s.label}: ${s.value}`).join("  ·  ");
        row.append(el("span", { class: "stat-line", text: statLine }));
      }
      list.append(row);
    }

    const winners = ranked.filter((r) => r.won).map((r) => this.players.find((p) => p.id === r.playerId)).filter(Boolean) as Player[];
    const top = winners.length === 1 ? winners[0]! : null;
    const headline = top ? (top.name === "You" ? "You win" : `${top.name} wins`) : "Tie";
    const actions = el("div", { class: "row" });
    if (game) {
      actions.append(button("Play again", () => {
        this.sfx.unlock();
        this.sfx.select();
        this.startPlay(game);
        this.show("play");
      }));
    }
    actions.append(ghost("Menu", () => this.rerenderMenu()));

    screen.append(
      el("p", { class: "brand", text: game?.name ?? "Results" }),
      el("h2", { class: "display", text: headline, style: top ? `color:${top.color}` : "" }),
      list,
      actions,
    );
    this.show("results");
  }
}

const ACCENTS = ["#3EE0FF", "#FF3D7A", "#FFB020", "#B8FF3D", "#A78BFA", "#FF8A3D"] as const;

function makePlayer(index: 0 | 1 | 2 | 3): Player {
  return {
    id: `p${index + 1}`,
    name: defaultName(index, index === 0 ? "human" : "bot"),
    color: PLAYER_COLORS[index]!,
    kind: index === 0 ? "human" : "bot",
    slot: index,
  };
}

/** "You" for the first seat, "Bot" / "Bot 2" for bots, "Player 3" for added humans. */
function defaultName(index: number, kind: Player["kind"]): string {
  if (kind === "bot") return index <= 1 ? "Bot" : `Bot ${index}`;
  return index === 0 ? "You" : `Player ${index + 1}`;
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
