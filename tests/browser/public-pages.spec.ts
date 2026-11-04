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

test("public pages: readable phone layouts, compact lobby and unchanged host scope", async ({
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

    // No zooming or horizontal panning is needed on narrow phones or landscape.
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 740, height: 320 },
    ]) {
      await page.setViewportSize(viewport);
      for (const path of ["/join", "/predict", "/screen"]) {
        await page.goto(path);
        await expect(page.locator(".public-header nav a")).toHaveCount(3);
        await page.evaluate(() => document.fonts.ready);
        for (const link of await page.locator(".public-header nav a").all()) {
          await readable(link, 16);
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        if (path === "/join") {
          await readable(page.locator("#name"), 18);
          await readable(page.locator(".team-option small").first(), 14);
          expect(
            await page
              .locator(".join-layout")
              .evaluate((el) => el.getBoundingClientRect().top),
          ).toBeLessThan(
            await page
              .locator(".audience-entry")
              .evaluate((el) => el.getBoundingClientRect().top),
          );
        } else if (path === "/predict") {
          await readable(page.locator(".audience-intro"), 16);
          await readable(page.locator(".prediction-option small").first(), 14);
        } else {
          await expect(page.locator(".phone-join")).toBeVisible();
          await expect(page.locator(".roster-row.empty")).toHaveCount(12);
          await expect(page.locator(".roster-row.empty").first()).toBeHidden();
          await readable(page.locator(".roster-empty-message").first(), 16);
        }
        await fits(page);
        if (viewport.width === 390)
          await page.screenshot({
            path: `artifacts/mobile-pages/${path.slice(1)}-390.png`,
            fullPage: true,
          });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/join");
    await page.locator("#name").fill("Roman");
    await page.getByRole("button", { name: /JOIN GAME/ }).tap();
    await expect(page.locator(".waiting-layout")).toBeVisible();
    await expect(page.locator(".public-header nav")).toBeHidden();
    for (const width of [320, 390, 430, 740]) {
      await page.setViewportSize({ width, height: width === 740 ? 320 : 844 });
      await readable(page.locator(".waiting-pill"), 16);
      await readable(page.locator(".lobby-note"), 16);
      await readable(page.locator(".player-label"), 16);
      await readable(page.locator(".player-label small"), 14);
      for (const instruction of await page
        .locator(".lobby-control small")
        .all())
        await readable(instruction, 14);
      await expect(page.locator(".roster-row.empty").first()).toBeHidden();
      await expect(page.locator(".team-footer")).toContainText(
        "5 spots available",
      );
      await fits(page);
      if (width === 390 || width === 320)
        await page.screenshot({
          path: `artifacts/mobile-pages/waiting-${width}.png`,
          fullPage: true,
        });
    }

    // Public mobile rules never apply to the host's administration page.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/host");
    await expect(page.locator(".host-actions")).toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/public-page/);
    await expect(page.locator("main")).not.toHaveClass(/public-content/);
    await expect(page.locator(".roster-row.empty").first()).toBeVisible();
    await expect(page.locator(".team-footer").first()).toContainText(
      "OPEN FOR BUSINESS",
    );
    const hostNameSize = await page
      .locator(".player-label")
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(hostNameSize).toBe("11px");
    await page.screenshot({
      path: "artifacts/mobile-pages/host-desktop.png",
      fullPage: true,
    });
    // A phone that didn't join can still read the in-progress page and watch.
    await page.goto("/predict");
    await page.evaluate(() => localStorage.removeItem("lvw-session"));
    command("bots");
    await expect.poll(() => state?.players.length).toBe(12);
    command("start");
    await expect.poll(() => state?.phase !== "WAITING").toBe(true);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/join");
    await expect(
      page.getByRole("heading", { name: /Match in progress/ }),
    ).toBeVisible();
    await readable(page.locator(".pin-panel p"), 16);
    for (const link of await page.locator(".pin-panel > a").all()) {
      await readable(link, 16);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await fits(page);
    await page.screenshot({
      path: "artifacts/mobile-pages/in-progress-320.png",
      fullPage: true,
    });
    await page.goto("/screen");
    await expect(page.locator(".match-heading")).toBeVisible();
    await readable(page.locator(".score-team").first(), 22);
    await fits(page);
    command("end");
    await expect(page.locator("#arena-overlay")).toContainText(
      "MATCH ENDED BY HOST",
    );
    await readable(page.locator("#arena-overlay .eyebrow"), 14);
    await fits(page);
    await page.screenshot({
      path: "artifacts/mobile-pages/finished-320.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    if (state && !["WAITING", "FINISHED"].includes(state.phase)) command("end");
    host.close();
    await context.close();
  }
});
