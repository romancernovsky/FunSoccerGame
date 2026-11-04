import { test, expect, type WebSocketRoute } from "@playwright/test";
import { WebSocket } from "ws";
import type { Snapshot } from "../../src/shared";
class Wire {
  ws: WebSocket;
  state: Snapshot | undefined;
  phases: string[] = [];
  constructor() {
    this.ws = new WebSocket("ws://127.0.0.1:3100/ws");
    this.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "state") {
        this.state = m.data;
        if (this.phases.at(-1) !== m.data.phase) this.phases.push(m.data.phase);
      }
    });
  }
  async open() {
    await new Promise<void>((r, j) => {
      this.ws.once("open", () => r());
      this.ws.once("error", j);
    });
    return this;
  }
  request(type: string, data: unknown, response: string) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.off("message", read);
        reject(Error("Response timeout: " + response));
      }, 5000);
      const read = (raw: unknown) => {
        const m = JSON.parse(String(raw));
        if (m.type === response || m.type === "error") {
          clearTimeout(timer);
          this.ws.off("message", read);
          if (m.type === "error") reject(Error(m.data.message));
          else resolve(m.data);
        }
      };
      this.ws.on("message", read);
      this.ws.send(JSON.stringify({ type, data }));
    });
  }
  async asHost() {
    await this.request("host", {}, "host_ready");
    return this;
  }
  command(action: string) {
    this.ws.send(
      JSON.stringify({ type: "command", data: { action, confirm: true } }),
    );
  }
  close() {
    this.ws.close();
  }
}
const clients: Wire[] = [];
async function wire() {
  const w = await new Wire().open();
  clients.push(w);
  return w;
}
test.beforeEach(async () => {
  const w = await (await wire()).asHost();
  await expect.poll(() => !!w.state).toBe(true);
  if (!["WAITING", "FINISHED"].includes(w.state!.phase)) {
    w.command("end");
    await expect.poll(() => w.state?.phase).toBe("FINISHED");
  }
  if (w.state!.phase === "FINISHED") {
    w.command("new");
    await expect.poll(() => w.state?.phase).toBe("WAITING");
  } else if (w.state!.players.length) {
    w.command("reset");
    await expect.poll(() => w.state?.players.length).toBe(0);
  }
  w.close();
});
test.afterEach(() => {
  for (const w of clients) w.close();
  clients.length = 0;
});

test("host and projector: actual 3D, broadcast, pause, refresh, rematch and reset", async ({
  browser,
}) => {
  const control = await wire(),
    a = await wire(),
    b = await wire();
  await a.request("join", { name: "Alex", team: "LEADERS" }, "identity");
  await b.request("join", { name: "Sam", team: "WORKERS" }, "identity");
  const ctx = await browser.newContext({
    viewport: { width: 960, height: 640 },
  });
  const host = await ctx.newPage(),
    screen = await ctx.newPage();
  let hostSocket: WebSocketRoute | undefined;
  await host.routeWebSocket("**/ws", (socket) => {
    hostSocket = socket;
    socket.connectToServer();
  });
  try {
    await screen.goto("/screen");
    await expect(screen.getByText("Business as unusual.")).toBeVisible();
    await host.goto("/host");
    const expectHost = async () => {
      await expect(host.getByText("Run the show.")).toBeVisible();
      await expect(host.locator('input[type="password"]')).toHaveCount(0);
    };
    await expectHost();
    await expect(screen.locator('a[href="/host"]')).toHaveCount(0);
    const click = async (action: string) => {
      await host.bringToFront();
      await host.locator(`[data-command="${action}"]`).click();
    };
    await click("start");
    await expect(host.getByRole("dialog")).toContainText(
      "Teams are incomplete",
    );
    await host.locator("#confirm").click();
    await expect.poll(() => control.phases.includes("COUNTDOWN")).toBe(true);
    await host.bringToFront();
    await expect(host.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await expect.poll(() => control.state?.phase).toBe("PLAYING");
    await host.locator("#camera-mode").click();
    await expect(host.locator("#camera-mode")).toHaveText("▣ Full field");
    await host.locator("#camera-mode").click();
    await host.locator("#broadcast-mode").click();
    await expect(host.locator("body")).toHaveClass(/broadcast-view/);
    await expect(host.locator('[data-command="pause"]')).toBeHidden();
    const previousSocket = hostSocket;
    await hostSocket!.close({ code: 1012, reason: "Test reconnect" });
    await expect.poll(() => hostSocket !== previousSocket).toBe(true);
    await expect(host.locator(".connection")).toContainText("LIVE CONNECTION");
    await expect(host.locator("body")).toHaveClass(/broadcast-view/);

    await host.keyboard.press("Escape");
    await expect(host.locator("body")).not.toHaveClass(/broadcast-view/);
    await click("pause");
    await expect.poll(() => control.state?.phase).toBe("PAUSED");
    await screen.bringToFront();
    await expect(screen.locator("#arena-overlay")).toContainText("PAUSED");
    await host.bringToFront();
    await host.reload({ waitUntil: "domcontentloaded" });
    await expectHost();
    await expect.poll(() => control.state?.phase).toBe("PAUSED");
    await expect(host.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await click("resume");
    await expect.poll(() => control.state?.phase).toBe("PLAYING");
    await click("end");
    await host.locator("#confirm").click();
    await expect.poll(() => control.state?.phase).toBe("FINISHED");
    await screen.bringToFront();
    await expect(screen.locator("#arena-overlay")).toContainText(
      "MATCH ENDED BY HOST",
    );
    const count = control.phases.filter((p) => p === "COUNTDOWN").length;
    await click("rematch");
    await expect
      .poll(() => control.phases.filter((p) => p === "COUNTDOWN").length)
      .toBeGreaterThan(count);
    await click("end");
    await host.locator("#confirm").click();
    await click("new");
    await host.locator("#confirm").click();
    await expect.poll(() => control.state?.players.length).toBe(0);
    await expect.poll(() => control.state?.phase).toBe("WAITING");
  } finally {
    await ctx.close();
  }
});

test("desktop player: fullscreen, keyboard movement and refresh restore the same 3D character", async ({
  browser,
}) => {
  const host = await (await wire()).asHost(),
    rival = await wire();
  await rival.request("join", { name: "Sam", team: "WORKERS" }, "identity");
  const ctx = await browser.newContext({
      viewport: { width: 960, height: 640 },
    }),
    page = await ctx.newPage();
  try {
    await page.goto("/join");
    await page.locator("#name").fill("Alex");
    await page.getByRole("button", { name: /JOIN GAME/ }).click();
    await expect(page.getByText("YOU ARE IN")).toBeVisible();
    host.command("start");
    await expect.poll(() => host.state?.phase).toBe("PLAYING");
    await expect(page.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await page.getByRole("button", { name: "Enter full screen" }).click();
    await expect(page.locator("body")).toHaveClass(/player-fullscreen/);
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await expect(page.locator("header")).toBeHidden();
    expect(
      await page.evaluate(() => {
        const r = document.querySelector(".game-main")!.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        };
      }),
    ).toMatchObject({
      width: 960,
      height: 640,
      viewportWidth: 960,
      viewportHeight: 640,
    });
    const player = host.state!.players.find((p) => p.name === "Alex")!,
      id = player.id,
      x = player.x;
    await page.keyboard.down("d");
    await expect
      .poll(() => host.state!.players.find((p) => p.id === id)?.x)
      .toBeGreaterThan(x + 20);
    await page.keyboard.up("d");
    await page.keyboard.press("Shift");
    await expect
      .poll(() => host.state!.players.find((p) => p.id === id)?.dashReady)
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect(page.locator("body")).not.toHaveClass(/player-fullscreen/);
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(false);
    await expect(page.locator("header")).toBeVisible();
    await page.getByRole("button", { name: "Enter full screen" }).click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    // Exiting from browser chrome must restore the normal game layout too.
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator("body")).not.toHaveClass(/player-fullscreen/);
    await page.getByRole("button", { name: "Enter full screen" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/player-fullscreen/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await expect
      .poll(() =>
        host.state!.players.filter((p) => p.name === "Alex").map((p) => p.id),
      )
      .toEqual([id]);
    expect(host.state!.remaining).toBeLessThan(180);
  } finally {
    await ctx.close();
  }
});

test("mobile: short iPhone viewport, readable ball, player camera, honest fullscreen and touch controls", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const host = await (await wire()).asHost(),
    rival = await wire();
  await rival.request("join", { name: "Alex", team: "LEADERS" }, "identity");
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(document, "fullscreenEnabled", {
      value: false,
      configurable: true,
    });
  });
  try {
    await page.goto("/join");
    await expect(page.locator("#fullscreen-guide")).toBeVisible();
    await expect(page.locator("#fullscreen-guide")).toHaveAttribute(
      "aria-label",
      "Add to Home Screen: show setup guide",
    );
    await page.screenshot({
      path: "artifacts/install-guide/iphone-join.png",
      fullPage: true,
    });
    await page.locator("#name").fill("Mobile");
    await page.locator("#fullscreen-guide").click();
    const setupGuide = page.getByRole("dialog", { name: "Add Office Arena." });
    await expect(setupGuide).toContainText("Add to Home Screen");
    await expect(setupGuide).toContainText("Open as Web App");
    await expect(setupGuide).toContainText("before the host starts");
    for (const description of await setupGuide
      .locator(".install-steps p")
      .all())
      expect(
        await description.evaluate((el) =>
          parseFloat(getComputedStyle(el).fontSize),
        ),
      ).toBeGreaterThanOrEqual(14);
    await page.screenshot({ path: "artifacts/install-guide/iphone-390.png" });
    await page.setViewportSize({ width: 320, height: 568 });
    expect(
      await setupGuide.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: "artifacts/install-guide/iphone-320.png" });
    // Setup only provides guidance; it never joins a player or claims installation.
    expect(host.state!.players).toHaveLength(1);
    expect(host.state!.phase).toBe("WAITING");
    await page
      .getByRole("button", { name: "PLAY IN BROWSER", exact: true })
      .click();
    await expect(setupGuide).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#name")).toHaveValue("Mobile");
    await page.locator('[data-team="WORKERS"]').click();
    await page.getByRole("button", { name: /JOIN GAME/ }).click();
    await expect(page.getByText("YOU ARE IN")).toBeVisible();
    host.command("start");
    await expect(page.getByText("Rotate your phone to play")).toBeVisible();
    await page.setViewportSize({ width: 568, height: 240 });
    await expect(page.getByText("Rotate your phone to play")).toBeHidden();
    await expect(page.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await expect.poll(() => host.state?.phase).toBe("PLAYING");
    await expect(page.locator("#arena-fx")).toHaveAttribute(
      "data-camera-mode",
      "player",
    );
    await expect
      .poll(async () =>
        Number(
          await page.locator("#arena-fx").getAttribute("data-camera-zoom"),
        ),
      )
      .toBeGreaterThan(1.9);
    await expect(page.locator("#arena-fx")).toHaveAttribute(
      "data-ball-core-pixels",
      "14",
    );
    const field = (await page.locator(".arena-wrap").boundingBox())!;
    const visibleWidth = await page.evaluate(() => visualViewport!.width);
    expect(field.width).toBeGreaterThanOrEqual(visibleWidth - 1);
    await expect(page.locator(".attack-direction")).toHaveAttribute(
      "aria-label",
      "Attack left",
    );
    await page.getByRole("button", { name: "Play without Safari bars" }).tap();
    await expect(page.locator("body")).not.toHaveClass(/player-fullscreen/);
    const guide = page.getByRole("dialog");
    await expect(guide).toContainText("Safari cannot hide");
    await expect(guide).toContainText("session may not transfer");
    const close = page.getByRole("button", { name: "Close screen help" });
    const closeBounds = (await close.boundingBox())!;
    expect(closeBounds.height).toBeGreaterThanOrEqual(44);
    expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(240);
    const beforeGuideKey = host.state!.players.find(
      (p) => p.name === "Mobile",
    )!.x;
    await page.keyboard.down("d");
    await page.waitForTimeout(250);
    await page.keyboard.up("d");
    expect(host.state!.players.find((p) => p.name === "Mobile")!.x).toBe(
      beforeGuideKey,
    );
    await close.focus();
    await page.keyboard.press("Space");
    await expect(guide).toBeHidden();
    expect(host.state!.players.find((p) => p.name === "Mobile")!.chargeAt).toBe(
      0,
    );
    await page.getByRole("button", { name: "Show full field" }).tap();
    await expect(page.locator("#arena-fx")).toHaveAttribute(
      "data-camera-mode",
      "field",
    );
    await expect
      .poll(async () =>
        Number(
          await page.locator("#arena-fx").getAttribute("data-camera-zoom"),
        ),
      )
      .toBeLessThan(1.05);
    await page.getByRole("button", { name: "Follow my player" }).tap();
    await expect
      .poll(async () =>
        Number(
          await page.locator("#arena-fx").getAttribute("data-camera-zoom"),
        ),
      )
      .toBeGreaterThan(1.9);
    for (const selector of ["#joystick", "#shoot", "#dash"]) {
      const rect = (await page.locator(selector).boundingBox())!;
      expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(48);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(568);
      expect(rect.y + rect.height).toBeLessThanOrEqual(240);
    }
    const beforeMove = host.state!.players.find((p) => p.name === "Mobile")!.x;
    const stick = (await page.locator("#joystick").boundingBox())!;
    await page.mouse.move(
      stick.x + stick.width / 2,
      stick.y + stick.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(stick.x + 3, stick.y + stick.height / 2);
    await expect
      .poll(() => host.state!.players.find((p) => p.name === "Mobile")!.x)
      .toBeLessThan(beforeMove - 20);
    const knob = (await page.locator("#stick").boundingBox())!;
    expect(knob.x).toBeGreaterThanOrEqual(stick.x);
    await page.mouse.up();
    await page.locator("#dash").tap();
    await expect
      .poll(
        () => host.state!.players.find((p) => p.name === "Mobile")!.dashReady,
      )
      .toBeGreaterThan(0);
    const shoot = (await page.locator("#shoot").boundingBox())!;
    await page.mouse.move(
      shoot.x + shoot.width / 2,
      shoot.y + shoot.height / 2,
    );
    await page.mouse.down();
    await expect
      .poll(
        () => host.state!.players.find((p) => p.name === "Mobile")!.chargeAt,
      )
      .toBeGreaterThan(0);
    await expect(page.locator("#shoot small")).toHaveText("RELEASE");
    await page.mouse.up();
    await expect
      .poll(
        () =>
          host.state!.players.find((p) => p.name === "Mobile")!.input.action,
      )
      .toBe(false);
    await page.setViewportSize({ width: 740, height: 260 });
    await expect(page.locator("#arena-fx")).toHaveAttribute(
      "data-ball-core-pixels",
      "14",
    );
    // Exposed-but-rejected native APIs must not leave a fake fullscreen state.
    await page.evaluate(() => {
      Object.defineProperty(document, "fullscreenEnabled", {
        value: true,
        configurable: true,
      });
      Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: () => Promise.reject(new Error("Denied")),
        configurable: true,
      });
    });
    await page.locator("#player-fullscreen").tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/player-fullscreen/);
    await page.getByRole("button", { name: "Close screen help" }).click();
    // This checks capability handling; actual iOS installation still needs a phone rehearsal.
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "standalone", { value: true }),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", {
        name: "Home Screen app: browser bars hidden",
      }),
    ).toBeDisabled();
    expect(host.state!.players.filter((p) => p.name === "Mobile")).toHaveLength(
      1,
    );
  } finally {
    await ctx.close();
  }
});
