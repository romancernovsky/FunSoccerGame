import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/final-minute-browser",
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3108/healthz",
    env: { PORT: "3108", MATCH_DURATION_SECONDS: "66" },
    reuseExistingServer: false,
  },
  use: { ...base.use, baseURL: "http://127.0.0.1:3108" },
});
