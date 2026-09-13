import { Sfx } from "./core/audio";
import { Engine } from "./core/engine";
import { InputManager } from "./core/input";
import { MinigameRegistry } from "./core/registry";
import { Session } from "./core/session";
import { DEFAULT_NAMES, PLAYER_COLORS, type MinigameDefinition, type Player } from "./core/types";
import { Sky } from "./fx/sky";
import { createRegistry } from "./minigames";
import { clear, el } from "./ui/dom";

type ScreenName = "menu" | "play" | "results";

export class App {
  private readonly root: HTMLElement;
  private readonly registry: MinigameRegistry;
  private readonly input = new InputManager();
  private readonly sfx = new Sfx();
  private readonly screens = new Map<ScreenName, HTMLElement>();
  private session: Session;
  private players: Player[];
  private selected: MinigameDefinition | null = null;
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
      el("p", { class: "brand", text: "Category Five" }),
      el("h1", { class: "display", text: "Minigames" }),
      el("p", { class: "lede", text: "Pick a game. More cards show up here as they get added." }),
    );

    const seats = el("div", { class: "seats" });
    this.players.forEach((player, index) => {
      seats.append(this.seatCard(player, index));
    });
    if (this.players.length < 4) {
      const add = button("Add player", () => {
        this.players.push(makePlayer(this.players.length as 0 | 1 | 2 | 3));
        this.resetSession();
        this.renderMenu();
        this.show("menu");
      }, "ghost");
      seats.append(add);
    }
    screen.append(seats);

    if (this.session.gamesPlayed > 0) screen.append(this.standingRow());

    const cards = el("div", { class: "grid cards" });
    for (const game of games) {
      const card = el("button", { class: "card" });
      card.append(
        el("span", { class: "tag", text: game.durationMs > 0 ? `${game.durationMs / 1000}s` : "Turns" }),
        el("h3", { text: game.name }),
        el("p", { text: game.tagline }),
      );
      card.addEventListener("click", () => {
        this.sfx.unlock();
        this.launch(game);
      });
      cards.append(card);
    }
    if (games.length === 0) {
      cards.append(
        el("div", { class: "card empty-card" },
          el("span", { class: "tag", text: "Soon" }),
          el("h3", { text: "No games yet" }),
          el("p", { text: "Register a minigame and it will land here." }),
        ),
      );
    }
    screen.append(cards);
  }

  private seatCard(player: Player, index: number): HTMLElement {
    const name = el("input", {
      type: "text",
      value: player.name,
      maxlength: "12",
      "aria-label": `Player ${index + 1} name`,
    });
    name.addEventListener("input", () => {
      player.name = name.value.slice(0, 12) || DEFAULT_NAMES[index]!;
    });
    const kind = button(player.kind === "human" ? "Human" : "Bot", () => {
      player.kind = player.kind === "human" ? "bot" : "human";
      this.renderMenu();
      this.show("menu");
    });
    kind.classList.toggle("ghost", player.kind === "bot");
    const seat = el("div", { class: "seat" });
    seat.append(
      el("div", { class: "row" },
        el("span", { class: "swatch", style: `background:${player.color}` }),
        el("strong", { text: `P${index + 1}` }),
      ),
      name,
    );
    const actions = el("div", { class: "row" });
    actions.append(kind);
    if (this.players.length > 1) {
      actions.append(ghost("Remove", () => {
        this.players.splice(index, 1);
        this.players.forEach((item, slot) => {
          item.slot = slot as 0 | 1 | 2 | 3;
        });
        this.resetSession();
        this.renderMenu();
        this.show("menu");
      }));
    }
    seat.append(actions);
    return seat;
  }

  private standingRow(): HTMLElement {
    const row = el("div", { class: "standings" });
    for (const standing of this.session.standings) {
      const player = this.players.find((item) => item.id === standing.playerId);
      if (!player) continue;
      row.append(
        el("span", {
          class: "chip",
          text: `${player.name}  ${standing.points} pts · ${standing.wins}W`,
          style: `border-color:${player.color}`,
        }),
      );
    }
    return row;
  }

  private launch(game: MinigameDefinition): void {
    this.selected = game;
    const screen = this.screens.get("play")!;
    clear(screen);
    const bar = el("div", { class: "hud-bar" });
    bar.append(
      el("strong", { text: game.name }),
      ghost("Menu", () => {
        this.engine?.abort();
        this.renderMenu();
        this.show("menu");
      }),
    );
    const wrap = el("div", { class: "play-wrap" });
    const canvas = el("canvas", { id: "game" });
    wrap.append(canvas);
    screen.append(bar, wrap);
    this.show("play");
    this.engine?.destroy();
    this.engine = new Engine(canvas, this.input, this.sfx);
    this.engine.start(game, this.players, (scores) => this.finishGame(scores));
  }

  private finishGame(scores: { playerId: string; score: number }[]): void {
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
        el("span", { class: "hint", text: `+${result.partyPoints} pts` }),
      );
      list.append(row);
    }
    screen.append(
      el("p", { class: "brand", text: this.selected?.name ?? "Results" }),
      el("h2", { class: "display", text: "Results" }),
      list,
      this.standingRow(),
      el("div", { class: "row" },
        button("Menu", () => {
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
