import { test, expect } from "@playwright/test";
import { WebSocket } from "ws";
import type { Snapshot } from "../../src/shared";

test("a full lobby and live match accept new and changed bets until full time", async ({
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
    const blue = page.locator('[data-predict="BLUE"]');
    const orange = page.locator('[data-predict="ORANGE"]');
    await blue.tap();
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#your-prediction")).toHaveText(
      "Your bet: Blue Team",
    );
    await page.reload();
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    await orange.tap();
    await expect(orange).toHaveAttribute("aria-pressed", "true");
    await context.setOffline(true);
    await expect(page.locator(".audience-connection")).toContainText(
      "Reconnecting",
    );
    await expect(orange).toBeDisabled();
    await context.setOffline(false);
    await expect(orange).toBeEnabled();
    await expect(orange).toHaveAttribute("aria-pressed", "true");
    const other = await browser.newContext();
    try {
      const api = await other.request.get("http://127.0.0.1:3100/api/audience");
      const roundId = (await api.json()).predictions.roundId;
      await other.request.post("http://127.0.0.1:3100/api/audience", {
        data: { team: "BLUE", roundId },
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
    await expect(blue).toBeEnabled();
    await expect(orange).toBeEnabled();
    await expect(page.locator(".crowd-lock")).toHaveText("Open");
    await expect(page.locator(".prediction-note")).toHaveText(
      "Bets stay open until full time.",
    );
    await expect.poll(() => state?.phase).toBe("PLAYING");
    await blue.tap();
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    const late = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const visitor = await late.newPage();
      await visitor.goto("/bet");
      const pick = visitor.locator('[data-predict="ORANGE"]');
      await expect(pick).toBeEnabled();
      await pick.tap();
      await expect(pick).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".crowd-heading > strong")).toHaveText(
        "3 bets",
      );
      await visitor.screenshot({
        path: "artifacts/audience/mobile-live-bet.png",
        fullPage: true,
      });
    } finally {
      await late.close();
    }
    command("pause");
    await expect.poll(() => state?.phase).toBe("PAUSED");
    await orange.tap();
    await expect(orange).toHaveAttribute("aria-pressed", "true");
    command("resume");
    await expect.poll(() => state?.phase).toBe("PLAYING");
    command("end");
    await expect(page.locator("#your-prediction")).toContainText("No result");
    await expect(blue).toBeDisabled();
    await expect(orange).toBeDisabled();
    const closed = await context.request.post(
      "http://127.0.0.1:3100/api/audience",
      { data: { team: "BLUE", roundId: state!.predictions.roundId } },
    );
    expect(closed.status()).toBe(409);
    command("rematch_lobby");
    await expect(blue).toBeEnabled();
    await expect(orange).toHaveAttribute("aria-pressed", "false");
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

test("live bet updates preserve a held player joystick and the host broadcast canvas", async ({
  browser,
}) => {
  const admin = new WebSocket("ws://127.0.0.1:3100/ws"),
    rival = new WebSocket("ws://127.0.0.1:3100/ws");
  let state: Snapshot | undefined;
  admin.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === "state") state = m.data;
  });
  const request = (ws: WebSocket, type: string, data: unknown, reply: string) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Reply timeout")), 5000);
      const read = (raw: unknown) => {
        const m = JSON.parse(String(raw));
        if (m.type !== reply && m.type !== "error") return;
        clearTimeout(timer);
        ws.off("message", read);
        if (m.type === "error") reject(Error(m.data.message));
        else resolve(m.data);
      };
      ws.on("message", read);
      ws.send(JSON.stringify({ type, data }));
    });
  const command = (action: string) =>
    admin.send(
      JSON.stringify({ type: "command", data: { action, confirm: true } }),
    );
  const mobile = await browser.newContext({
    viewport: { width: 740, height: 260 },
    isMobile: true,
    hasTouch: true,
  });
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 820 },
  });
  const betting = await browser.newContext(),
    lateBetting = await browser.newContext();
  const phone = await mobile.newPage(),
    host = await desktop.newPage();
  try {
    await Promise.all(
      [admin, rival].map(
        (ws) =>
          new Promise((resolve) =>
            ws.readyState === WebSocket.OPEN
              ? resolve(null)
              : ws.once("open", resolve),
          ),
      ),
    );
    await request(admin, "host", {}, "host_ready");
    await expect.poll(() => !!state).toBe(true);
    if (!["WAITING", "FINISHED"].includes(state!.phase)) {
      command("end");
      await expect.poll(() => state?.phase).toBe("FINISHED");
    }
    command(state!.phase === "FINISHED" ? "new" : "reset");
    await expect.poll(() => state?.phase).toBe("WAITING");
    await request(rival, "join", { name: "Sam", team: "ORANGE" }, "identity");
    await phone.goto("/join");
    await phone.locator("#name").fill("Tess");
    await phone.getByRole("button", { name: "Play", exact: true }).click();
    await expect(phone.locator(".joined-identity")).toContainText("Tess");
    await host.goto("/host");
    await expect(host.locator(".host-actions")).toBeVisible();
    command("start");
    await expect.poll(() => state?.phase).toBe("PLAYING");
    await expect(phone.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await expect(host.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await expect(phone.locator("#arena-overlay")).toHaveClass(/playing/);
    await expect(host.locator("#arena-overlay")).toHaveClass(/playing/);
    await phone.evaluate(() => {
      (window as any).__heldStick = document.querySelector("#joystick");
      (window as any).__playerArena = document.querySelector("#arena");
    });
    await host.evaluate(() => {
      (window as any).__broadcastArena = document.querySelector("#arena");
    });
    const id = state!.players.find((p) => p.name === "Tess")!.id;
    const box = (await phone.locator("#joystick").boundingBox())!;
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await phone.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2);
    await expect
      .poll(() => state!.players.find((p) => p.id === id)!.input.x)
      .toBeGreaterThan(0.25);
    const get = await betting.request.get("http://127.0.0.1:3100/api/audience");
    const roundId = (await get.json()).predictions.roundId;
    await lateBetting.request.get("http://127.0.0.1:3100/api/audience");
    const before = state!.players.find((p) => p.id === id)!.x;
    for (const [context, team] of [
      [betting, "BLUE"],
      [lateBetting, "ORANGE"],
      [betting, "ORANGE"],
    ] as const) {
      const response = await context.request.post(
        "http://127.0.0.1:3100/api/audience",
        { data: { team, roundId } },
      );
      expect(response.status()).toBe(200);
      const totals = (await response.json()).predictions.totals;
      await expect
        .poll(() => JSON.stringify(state?.predictions.totals))
        .toBe(JSON.stringify(totals));
      expect(
        await phone.evaluate(
          () =>
            document.querySelector("#joystick") ===
              (window as any).__heldStick &&
            document.querySelector("#arena") === (window as any).__playerArena,
        ),
      ).toBe(true);
      expect(
        await host.evaluate(
          () =>
            document.querySelector("#arena") ===
            (window as any).__broadcastArena,
        ),
      ).toBe(true);
      // The server may briefly freeze stale inputs during a slow browser frame.
      // The same held pointer must resume without any new press.
      await expect
        .poll(() => state!.players.find((p) => p.id === id)!.input.x)
        .toBeGreaterThan(0.25);
    }
    await expect(host.locator(".crowd-live")).toContainText("100% ORANGE TEAM");
    await expect(host.locator("#host-bets .crowd-heading > strong")).toHaveText(
      "2 bets",
    );
    await expect
      .poll(() => state!.players.find((p) => p.id === id)!.x)
      .toBeGreaterThan(before + 10);
    await phone.mouse.up();
    await expect
      .poll(() => state!.players.find((p) => p.id === id)!.input.x)
      .toBe(0);
  } finally {
    await phone.mouse.up().catch(() => {});
    if (state && !["WAITING", "FINISHED"].includes(state.phase)) command("end");
    admin.close();
    rival.close();
    await Promise.all([
      mobile.close(),
      desktop.close(),
      betting.close(),
      lateBetting.close(),
    ]);
  }
});
