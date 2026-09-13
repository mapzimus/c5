import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/c5/" : "/",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
