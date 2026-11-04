import { test, expect } from "@playwright/test";
import { WebSocket } from "ws";
import type { Snapshot } from "../../src/shared";

test("a full lobby welcomes audience picks, locks on host start and reopens for rematch", async ({
  browser,
}) => {
  const host = new WebSocket("ws://127.0.0.1:3100/ws");
  let state: Snapshot | undefined;
  host.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === "state") state = m.data;
  });
  await new Promise((resolve) => host.once("open", resolve));
  const command = (action: string) =>
    host.send(
      JSON.stringify({ type: "command", data: { action, confirm: true } }),
    );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  let gameSockets = 0;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/ws") gameSockets++;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    host.send(JSON.stringify({ type: "host", data: {} }));
    await expect.poll(() => !!state).toBe(true);
    if (!["WAITING", "FINISHED"].includes(state!.phase)) {
      command("end");
      await expect.poll(() => state?.phase).toBe("FINISHED");
    }
    command(state!.phase === "FINISHED" ? "new" : "reset");
    await expect.poll(() => state?.phase).toBe("WAITING");
    command("bots");
    await expect.poll(() => state?.players.length).toBe(12);
    await page.goto("/join");
    await expect(page.getByText("Teams full.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Play$/ })).toBeDisabled();
    await page.getByRole("link", { name: "Bet", exact: true }).click();
    await expect(page).toHaveURL(/\/bet$/);
    // Only the join view used a game socket; the audience page uses HTTP summaries.
    const socketsBeforePrediction = gameSockets;
    const leaders = page.locator('[data-predict="LEADERS"]');
    const workers = page.locator('[data-predict="WORKERS"]');
    await leaders.tap();
    await expect(leaders).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#your-prediction")).toHaveText(
      "Your bet: LEADERS",
    );
    await page.reload();
    await expect(leaders).toHaveAttribute("aria-pressed", "true");
    await workers.tap();
    await expect(workers).toHaveAttribute("aria-pressed", "true");
    await context.setOffline(true);
    await expect(page.locator(".audience-connection")).toContainText(
      "Reconnecting",
    );
    await expect(workers).toBeDisabled();
    await context.setOffline(false);
    await expect(workers).toBeEnabled();
    await expect(workers).toHaveAttribute("aria-pressed", "true");
    const other = await browser.newContext();
    try {
      const api = await other.request.get("http://127.0.0.1:3100/api/audience");
      const roundId = (await api.json()).predictions.roundId;
      await other.request.post("http://127.0.0.1:3100/api/audience", {
        data: { team: "LEADERS", roundId },
      });
      await expect(page.locator(".crowd-heading > strong")).toHaveText(
        "2 bets",
      );
    } finally {
      await other.close();
    }
    await page.screenshot({
      path: "artifacts/audience/mobile-pick.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: "artifacts/audience/desktop-pick.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(state!.players.length).toBe(12);
    expect(state!.phase).toBe("WAITING");
    const cookie = (await context.cookies()).find(
      (c) => c.name === "lvw-audience",
    )!;
    expect(cookie.httpOnly).toBe(true);
    command("start");
    await expect.poll(() => state?.phase !== "WAITING").toBe(true);
    await expect(leaders).toBeDisabled();
    await expect(workers).toBeDisabled();
    await expect(page.locator(".crowd-lock")).toHaveText("Bets locked");
    const locked = await context.request.post(
      "http://127.0.0.1:3100/api/audience",
      { data: { team: "LEADERS", roundId: state!.predictions.roundId } },
    );
    expect(locked.status()).toBe(409);
    command("end");
    await expect(page.locator("#your-prediction")).toContainText("No result");
    command("rematch_lobby");
    await expect(leaders).toBeEnabled();
    await expect(workers).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".crowd-heading > strong")).toHaveText("0 bets");
    expect(state!.players.length).toBe(12);
    expect(state!.phase).toBe("WAITING");
    expect(gameSockets).toBe(socketsBeforePrediction);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
  } finally {
    if (state && !["WAITING", "FINISHED"].includes(state.phase)) command("end");
    host.close();
    await context.close();
  }
});
