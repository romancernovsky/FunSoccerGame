import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3100/healthz",
    env: { PORT: "3100", HOST_PIN: "browser-test-pin" },
    reuseExistingServer: false,
  },
});
