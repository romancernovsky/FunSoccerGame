import { test, expect, type Page, type Locator } from "@playwright/test";
import { WebSocket } from "ws";
import type { Snapshot } from "../../src/shared";

async function readable(locator: Locator, size: number) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(size);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => innerWidth),
  );
}

test("minimal Play/Bet pages fit phones; joining and host streaming stay focused", async ({
  browser,
}) => {
  const host = new WebSocket("ws://127.0.0.1:3100/ws");
  let state: Snapshot | undefined;
  host.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === "state") state = m.data;
  });
  await new Promise((r) => host.once("open", r));
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
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    host.send(JSON.stringify({ type: "host", data: {} }));
    await expect.poll(() => !!state).toBe(true);
    if (!["WAITING", "FINISHED"].includes(state!.phase)) {
      command("end");
      await expect.poll(() => state?.phase).toBe("FINISHED");
    }
    command(state!.phase === "FINISHED" ? "new" : "reset");
    await expect
      .poll(() => state?.phase === "WAITING" && state.players.length === 0)
      .toBe(true);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 740, height: 320 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/join", "/bet"]) {
        await page.goto(path);
        const nav = page.getByRole("navigation", { name: "Main navigation" });
        await expect(nav.getByRole("link")).toHaveText(["Play", "Bet"]);
        for (const link of await nav.getByRole("link").all()) {
          await readable(link, 16);
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await expect(
          page.locator(
            'a[href="/screen"], a[href="/predict"], a[href="/host"]',
          ),
        ).toHaveCount(0);
        await expect(
          page.locator(
            "footer, .join-intro, .audience-entry, .form-note, .ios-launch-tip",
          ),
        ).toHaveCount(0);
        if (path === "/bet") {
          await expect(
            page.getByRole("heading", { name: "Bet on the winner" }),
          ).toBeVisible();
          await readable(page.locator(".prediction-option small").first(), 14);
          await expect(
            page.locator("canvas, #name, .audience-score"),
          ).toHaveCount(0);
        } else {
          await expect(
            page.getByRole("heading", { name: "Play", exact: true }),
          ).toBeVisible();
          await expect(page.locator("form input")).toHaveCount(1);
          await expect(page.locator("form button")).toHaveCount(3);
          await readable(page.locator("#name"), 18);
          await readable(page.locator(".team-option small").first(), 14);
          await page.locator('[data-team="WORKERS"]').click();
          await expect(page.locator('[data-team="WORKERS"]')).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await expect(page.locator('[data-team="LEADERS"]')).toHaveAttribute(
            "aria-pressed",
            "false",
          );
        }
        await fits(page);
        if (viewport.width === 390 || viewport.width === 1280)
          await page.screenshot({
            path: `artifacts/minimal-pages/${path === "/" ? "home" : path.slice(1)}-${viewport.width}.png`,
            fullPage: true,
          });
      }
    }
    await page.goto("/predict");
    await expect(page).toHaveURL(/\/bet$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/join");
    await page.locator("#name").fill("Roman");
    await page.getByRole("button", { name: "Play", exact: true }).tap();
    await expect(
      page.getByRole("heading", { name: "You’re in" }),
    ).toBeVisible();
    await readable(page.locator(".waiting-pill"), 16);
    await expect(page.locator(".joined-identity")).toContainText("Roman");
    await expect(page.locator(".waiting-team li")).toHaveText(["Roman"]);
    await expect(
      page.locator("nav, .how-to, .roster-row.empty, .scoreboard"),
    ).toHaveCount(0);
    await fits(page);
    await page.screenshot({
      path: "artifacts/minimal-pages/waiting-390.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/host");
    await expect(page.locator(".host-actions")).toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/public-page/);
    await expect(
      page.locator("header nav, footer, a[href='/screen']"),
    ).toHaveCount(0);
    await expect(page.locator(".roster-row.empty")).toHaveCount(0);
    await expect(page.locator(".roster-empty-message")).toBeVisible();
    await readable(page.locator(".player-label"), 22);
    await page.screenshot({
      path: "artifacts/minimal-pages/host-1280.png",
      fullPage: true,
    });
    await page.evaluate(() => localStorage.removeItem("lvw-session"));
    command("bots");
    await expect.poll(() => state?.players.length).toBe(12);
    command("start");
    await expect.poll(() => state?.phase !== "WAITING").toBe(true);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/join");
    await expect(
      page.getByRole("heading", { name: "Match in progress" }),
    ).toBeVisible();
    await expect(page.locator("#join-form, a[href='/screen']")).toHaveCount(0);
    await expect(
      page
        .locator(".join-unavailable")
        .getByRole("link", { name: "Bet", exact: true }),
    ).toBeVisible();
    await fits(page);
    expect(errors).toEqual([]);
  } finally {
    if (state && !["WAITING", "FINISHED"].includes(state.phase)) command("end");
    host.close();
    await context.close();
  }
});
