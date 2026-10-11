// Plays every game bot-vs-bot in headless Chromium and saves a mid-game
// snapshot of the canvas to public/thumbs/<id>.jpg for the menu cards.
//   npm run dev            (in another terminal)
//   node scripts/capture-thumbs.mjs [baseUrl] [gameId ...]
// Needs Playwright (npm i -D playwright, or a global install).
import { mkdirSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [baseUrl = "http://localhost:5173/", ...only] = process.argv.slice(2);
const OUT = new URL("../public/thumbs/", import.meta.url);
mkdirSync(OUT, { recursive: true });

/** Seconds into the game to take the shot. Tuned so something is happening on screen. */
const DELAY = {
  default: 6,
  pairs: 22,
  whack: 14,
  fling: 16,
  "connect-four": 22,
  "curve-clash": 12,
  "tower-topple": 16,
  "quick-draw": 4.2,
  "rope-skip": 6.5,
  "hot-tiles": 7,
  "sumo-rings": 9,
  "mash-dash": 8,
  "stampede": 12,
  "slot-cars": 10,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(baseUrl);
await page.waitForSelector(".card[data-game]");
// Keep the in-game Menu button out of the shots.
await page.addStyleTag({ content: ".hud-bar, .rotate-hint { visibility: hidden !important; }" });

// Make seat 1 a bot so every seat plays itself.
await page.locator(".fighter-kind").first().click();
const ids = await page.$$eval(".card[data-game]", (cards) => cards.map((c) => c.dataset.game));

for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  await page.locator(`.card[data-game="${id}"]`).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout((DELAY[id] ?? DELAY.default) * 1000);
  const path = new URL(`${id}.jpg`, OUT).pathname;
  await page.locator("#game").screenshot({ path, type: "jpeg", quality: 72 });
  console.log("saved", path);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#screen-menu.active");
}
await browser.close();
