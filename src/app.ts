import { Sfx } from "./core/audio";
import { Engine } from "./core/engine";
import { BIND_LABELS, InputManager } from "./core/input";
import { MinigameRegistry } from "./core/registry";
import { Session } from "./core/session";
import { DEFAULT_NAMES, PLAYER_COLORS, type MinigameDefinition, type Player } from "./core/types";
import { Sky } from "./fx/sky";
import { createRegistry } from "./minigames";
import { clear, el } from "./ui/dom";

type ScreenName = "title" | "roster" | "hub" | "briefing" | "play" | "results";

export class App {
  private readonly root: HTMLElement;
  private readonly registry: MinigameRegistry;
  private readonly input = new InputManager();
  private readonly sfx = new Sfx();
  private readonly screens = new Map<ScreenName, HTMLElement>();
  private session: Session;
  private players: Player[];
  private selected: MinigameDefinition | null = null;
  private circuitMode = false;
  private engine: Engine | null = null;
  private sky: Sky | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.registry = createRegistry();
    this.players = defaultPlayers();
    this.session = new Session(this.players);
  }

  start(): void {
    this.root.replaceChildren();
    const sky = el("canvas", { id: "sky" });
    const shell = el("div", { id: "shell" });
    this.root.append(sky, shell);
    this.sky = new Sky(sky);
    this.sky.start();

    for (const name of ["title", "roster", "hub", "briefing", "play", "results"] as const) {
      const screen = el("section", { class: "screen", id: `screen-${name}` });
      this.screens.set(name, screen);
      shell.append(screen);
    }

    this.renderTitle();
    this.renderRoster();
    this.renderHub();
    this.show("title");

    window.addEventListener("keydown", this.onGlobalKey);
  }

  private readonly onGlobalKey = (event: KeyboardEvent): void => {
    if (event.code === "Escape" && this.screens.get("play")?.classList.contains("active")) {
      this.engine?.abort();
      this.circuitMode = false;
      this.show("hub");
    }
  };

  private show(name: ScreenName): void {
    for (const [key, node] of this.screens) {
      node.classList.toggle("active", key === name);
    }
  }

  private renderTitle(): void {
    const screen = this.screens.get("title")!;
    clear(screen);
    screen.classList.add("title-screen");
    screen.append(
      el("p", { class: "kicker", text: "C5" }),
      el("h1", { class: "display", text: "Category Five" }),
      el("p", {
        class: "lede",
        text: "A growing pile of chaotic party minigames. The board comes later. The storm is now.",
      }),
      el("div", { class: "row" },
        button("Enter the storm", () => {
          this.sfx.unlock();
          this.show("roster");
        }),
        ghost("Skip to hub", () => {
          this.sfx.unlock();
          this.resetSession();
          this.renderHub();
          this.show("hub");
        }),
      ),
    );
  }

  private renderRoster(): void {
    const screen = this.screens.get("roster")!;
    clear(screen);
    screen.append(
      el("p", { class: "brand", text: "The crew" }),
      el("h2", { class: "display", text: "Who's playing?" }),
      el("p", {
        class: "lede",
        text: "One to four local players. Empty seats can stay as bots so a solo run still feels like a party.",
      }),
    );

    const roster = el("div", { class: "roster" });
    this.players.forEach((player, index) => {
      const name = el("input", {
        type: "text",
        value: player.name,
        maxlength: "12",
        "aria-label": `Player ${index + 1} name`,
      });
      name.addEventListener("input", () => {
        player.name = name.value.slice(0, 12) || DEFAULT_NAMES[index]!;
      });
      const toggle = button(player.kind === "human" ? "Human" : "Bot", () => {
        player.kind = player.kind === "human" ? "bot" : "human";
        this.renderRoster();
        this.show("roster");
      });
      toggle.classList.toggle("ghost", player.kind === "bot");
      const seat = el("div", { class: "seat" });
      seat.append(
        el("div", { class: "row" },
          el("span", { class: "swatch", style: `background:${player.color}` }),
          el("strong", { text: `P${index + 1}` }),
          el("span", { class: "hint", text: BIND_LABELS[index]! }),
        ),
        name,
        toggle,
      );
      roster.append(seat);
    });

    screen.append(
      roster,
      el("div", { class: "row" },
        button("To the hub", () => {
          this.resetSession();
          this.renderHub();
          this.show("hub");
        }),
        ghost("Back", () => this.show("title")),
      ),
    );
  }

  private renderHub(): void {
    const screen = this.screens.get("hub")!;
    clear(screen);
    screen.append(
      el("p", { class: "brand", text: "Minigame collection" }),
      el("h2", { class: "display", text: "Pick your chaos" }),
      el("p", {
        class: "lede",
        text: "Play any game on its own, or run the Chaos Circuit and pile up party points. The board game layer will sit on top of this later.",
      }),
      this.standingRow(),
    );

    const cards = el("div", { class: "grid cards" });
    const circuit = el("button", { class: "card" });
    circuit.append(
      el("span", { class: "tag", text: "Marathon" }),
      el("h3", { text: "Chaos Circuit" }),
      el("p", { text: "Play every minigame back-to-back. Highest party points wins the storm." }),
    );
    circuit.addEventListener("click", () => this.startCircuit());
    cards.append(circuit);

    for (const game of this.registry.list()) {
      const card = el("button", { class: "card" });
      card.append(
        el("span", { class: "tag", text: `${game.durationMs / 1000}s` }),
        el("h3", { text: game.name }),
        el("p", { text: game.tagline }),
      );
      card.addEventListener("click", () => this.openBriefing(game, false));
      cards.append(card);
    }
    screen.append(
      cards,
      el("footer", { class: "fine" },
        document.createTextNode("Esc quits a live game · Party points: 5 / 3 / 2 / 1"),
      ),
    );
  }

  private standingRow(): HTMLElement {
    const row = el("div", { class: "standings" });
    if (this.session.gamesPlayed === 0) {
      row.append(el("span", { class: "chip", text: "No games yet" }));
      return row;
    }
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

  private openBriefing(game: MinigameDefinition, circuit: boolean): void {
    this.selected = game;
    this.circuitMode = circuit;
    const screen = this.screens.get("briefing")!;
    clear(screen);
    const controls = el("div", { class: "results" });
    this.players.forEach((player, index) => {
      const line = el("div", { class: "result" });
      line.append(
        el("span", { class: "swatch", style: `background:${player.color}` }),
        el("strong", { text: player.name }),
        el("span", { class: "hint", text: player.kind === "bot" ? "CPU" : BIND_LABELS[index]! }),
        el("span", { text: game.id === "pressure-drop" ? "Action" : "Move" }),
      );
      controls.append(line);
    });
    screen.append(
      el("p", { class: "brand", text: circuit ? "Chaos Circuit" : "Now serving" }),
      el("h2", { class: "display", text: game.name }),
      el("p", { class: "lede", text: game.description }),
      el("p", { class: "hint", text: game.controls }),
      controls,
      el("div", { class: "row" },
        button("Start", () => this.launch(game)),
        ghost("Back", () => {
          this.circuitMode = false;
          this.show("hub");
        }),
      ),
    );
    this.show("briefing");
  }

  private startCircuit(): void {
    this.session.startCircuit(this.registry.ids());
    const first = this.registry.get(this.session.currentCircuitId()!);
    this.openBriefing(first, true);
  }

  private launch(game: MinigameDefinition): void {
    const screen = this.screens.get("play")!;
    clear(screen);
    const bar = el("div", { class: "hud-bar" });
    bar.append(
      el("strong", { text: game.name }),
      ghost("Abort", () => {
        this.engine?.abort();
        this.circuitMode = false;
        this.renderHub();
        this.show("hub");
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

    const nextId = this.circuitMode ? this.session.advanceCircuit() : undefined;
    const actions = el("div", { class: "row" });
    if (nextId) {
      actions.append(
        button("Next storm", () => this.openBriefing(this.registry.get(nextId), true)),
      );
    } else if (this.circuitMode) {
      this.circuitMode = false;
      const leader = this.session.leader();
      const champ = this.players.find((item) => item.id === leader?.playerId);
      screen.append(el("p", { class: "kicker", text: `${champ?.name ?? "Someone"} rules the circuit` }));
    }

    actions.append(
      button("Hub", () => {
        this.renderHub();
        this.show("hub");
      }, "magenta"),
    );

    screen.append(
      el("p", { class: "brand", text: this.selected?.name ?? "Results" }),
      el("h2", { class: "display", text: "Storm report" }),
      list,
      this.standingRow(),
      actions,
    );
    this.show("results");
  }

  private resetSession(): void {
    this.session = new Session(this.players);
    this.circuitMode = false;
  }
}

function defaultPlayers(): Player[] {
  return DEFAULT_NAMES.map((name, index) => ({
    id: `p${index + 1}`,
    name,
    color: PLAYER_COLORS[index]!,
    kind: index === 0 ? "human" : "bot",
    slot: index as 0 | 1 | 2 | 3,
  }));
}

function button(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const node = el("button", { class: extraClass ? `btn ${extraClass}` : "btn", text: label });
  node.addEventListener("click", onClick);
  return node;
}

function ghost(label: string, onClick: () => void): HTMLButtonElement {
  return button(label, onClick, "ghost");
}
