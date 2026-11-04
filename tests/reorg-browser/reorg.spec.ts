import { test, expect } from "@playwright/test";
import { WebSocket } from "ws";
import type { Snapshot } from "../../src/shared";
test("01:00 Reorg changes teams and kits, survives refresh/pause, then kicks off with control restored", async ({
  browser,
}) => {
  const admin = new WebSocket("ws://127.0.0.1:3108/ws"),
    opponent = new WebSocket("ws://127.0.0.1:3108/ws");
  let state: Snapshot | undefined;
  const phases: string[] = [];
  admin.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === "state") {
      state = m.data;
      if (phases.at(-1) !== m.data.phase) phases.push(m.data.phase);
    }
  });
  const request = (ws: WebSocket, type: string, data: unknown, reply: string) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Reply timeout " + reply)),
        5000,
      );
      const read = (raw: unknown) => {
        const m = JSON.parse(String(raw));
        if (m.type === reply || m.type === "error") {
          clearTimeout(timer);
          ws.off("message", read);
          m.type === "error" ? reject(Error(m.data.message)) : resolve(m.data);
        }
      };
      ws.on("message", read);
      ws.send(JSON.stringify({ type, data }));
    });
  const command = (action: string) =>
    admin.send(
      JSON.stringify({ type: "command", data: { action, confirm: true } }),
    );
  const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  try {
    await Promise.all([
      new Promise((r) =>
        admin.readyState === WebSocket.OPEN ? r(null) : admin.once("open", r),
      ),
      new Promise((r) =>
        opponent.readyState === WebSocket.OPEN
          ? r(null)
          : opponent.once("open", r),
      ),
    ]);
    await request(admin, "host", {}, "host_ready");
    await request(
      opponent,
      "join",
      { name: "Alex", team: "LEADERS" },
      "identity",
    );
    await page.goto("/join");
    await page.locator("#name").fill("Maya");
    await page.locator('[data-team="WORKERS"]').click();
    await page.getByRole("button", { name: /^Play$/ }).click();
    await expect(page.getByText("You’re in")).toBeVisible();
    const id = state!.players.find((p) => p.name === "Maya")!.id;
    command("start");
    await expect(page.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await expect(page.locator("#arena")).toHaveAttribute(
      "aria-label",
      /orange \(WORKERS\)/,
    );
    await expect.poll(() => phases.includes("PLAYING")).toBe(true);
    await expect.poll(() => state?.phase, { timeout: 15000 }).toBe("REORG");
    expect(state!.remaining).toBe(60);
    const assignments = structuredClone(state!.reorg!.assignments);
    expect(state!.players.find((p) => p.id === id)?.team).toBe("LEADERS");
    await expect(page.locator("#arena")).toHaveAttribute(
      "aria-label",
      /blue \(LEADERS\)/,
    );
    await expect(page.locator(".reorg-board")).toBeVisible();
    const revealBounds = await page.evaluate(() => ({
      field: document
        .querySelector(".arena-wrap")!
        .getBoundingClientRect()
        .toJSON(),
      game: document
        .querySelector(".player-game")!
        .getBoundingClientRect()
        .toJSON(),
    }));
    expect(revealBounds.field.x).toBe(revealBounds.game.x);
    expect(revealBounds.field.y).toBe(revealBounds.game.y);
    expect(revealBounds.field.width).toBe(revealBounds.game.width);
    expect(revealBounds.field.height).toBe(revealBounds.game.height);
    await page.screenshot({ path: "artifacts/mobile-hud/final-reorg.png" });
    await expect(page.locator(".reorg-local")).toContainText("LEADERS");
    await expect(page.locator(".reorg-team.leaders li.is-you")).toContainText(
      "Maya",
    );
    await expect(page.locator(".reorg-team.workers")).toContainText("Alex");
    await expect(page.locator("#joystick")).toBeHidden();
    await page.keyboard.down("d");
    await page.keyboard.up("d");
    const position = state!.players.find((p) => p.id === id)!.x;
    await page.waitForTimeout(250);
    expect(state!.players.find((p) => p.id === id)!.x).toBe(position);
    expect(state!.remaining).toBe(60);
    command("pause");
    await expect.poll(() => state?.phase).toBe("PAUSED");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#arena")).toHaveAttribute(
      "aria-label",
      /blue \(LEADERS\)/,
    );
    expect(state!.players.find((p) => p.id === id)?.name).toBe("Maya");
    expect(state!.reorg!.assignments).toEqual(assignments);
    command("resume");
    await expect(page.locator(".reorg-board")).toBeVisible();
    await expect
      .poll(() => phases.includes("KICKOFF_COUNTDOWN"), { timeout: 15000 })
      .toBe(true);
    await expect
      .poll(() => phases.filter((p) => p === "PLAYING").length)
      .toBe(2);
    expect(state!.ball.x).toBe(600);
    expect(state!.ball.owner).toBe(null);
    expect(state!.remaining).toBeLessThanOrEqual(60);
    await expect(page.locator("#joystick")).toBeVisible();
    const box = (await page.locator("#joystick").boundingBox())!,
      x = state!.players.find((p) => p.id === id)!.x;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
    await expect
      .poll(() => state!.players.find((p) => p.id === id)!.x)
      .toBeGreaterThan(x + 20);
    await page.mouse.up();
    expect(state!.reorg!.assignments).toEqual(assignments);
  } finally {
    admin.close();
    opponent.close();
    await context.close();
  }
});
