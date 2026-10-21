import { describe, expect, it } from "vitest";
import { gameIdFromSearch, searchWithGame } from "./deeplink";

const IDS = ["pairs", "castle-siege", "micro-mayhem"];

describe("gameIdFromSearch", () => {
  it("finds a registered game", () => {
    expect(gameIdFromSearch("?game=castle-siege", IDS)).toBe("castle-siege");
  });

  it("ignores case and surrounding space", () => {
    expect(gameIdFromSearch("?game=%20Castle-Siege%20", IDS)).toBe("castle-siege");
  });

  it("returns null for unknown, empty, or missing games", () => {
    expect(gameIdFromSearch("?game=nope", IDS)).toBeNull();
    expect(gameIdFromSearch("?game=", IDS)).toBeNull();
    expect(gameIdFromSearch("", IDS)).toBeNull();
    expect(gameIdFromSearch("?other=pairs", IDS)).toBeNull();
  });

  it("reads the game alongside other params", () => {
    expect(gameIdFromSearch("?utm_source=mapzimus&game=pairs", IDS)).toBe("pairs");
  });
});

describe("searchWithGame", () => {
  it("sets the game", () => {
    expect(searchWithGame("", "pairs")).toBe("?game=pairs");
  });

  it("replaces an existing game and keeps other params", () => {
    expect(searchWithGame("?ref=x&game=pairs", "micro-mayhem")).toBe("?ref=x&game=micro-mayhem");
  });

  it("removes the game", () => {
    expect(searchWithGame("?game=pairs", null)).toBe("");
    expect(searchWithGame("?ref=x&game=pairs", null)).toBe("?ref=x");
  });

  it("round-trips through gameIdFromSearch", () => {
    for (const id of IDS) {
      expect(gameIdFromSearch(searchWithGame("?ref=x", id), IDS)).toBe(id);
    }
  });
});
