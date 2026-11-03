import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/reorg-browser",
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3108/healthz",
    env: {
      PORT: "3108",
      HOST_PIN: "reorg-test-pin",
      MATCH_DURATION_SECONDS: "126",
    },
    reuseExistingServer: false,
  },
  use: { ...base.use, baseURL: "http://127.0.0.1:3108" },
});
