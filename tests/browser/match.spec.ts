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
    expect(host.state!.remaining).toBeLessThan(300);
  } finally {
    await ctx.close();
  }
});

test("mobile: fullscreen fallback, team choice, landscape joystick, action and dash", async ({
  browser,
}) => {
  const host = await (await wire()).asHost(),
    rival = await wire();
  await rival.request("join", { name: "Alex", team: "LEADERS" }, "identity");
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      value: undefined,
    });
  });
  try {
    await page.goto("/join");
    await expect(page.locator("#name")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    await page.locator("#name").fill("Mobile");
    await page.locator('[data-team="WORKERS"]').click();
    await page.getByRole("button", { name: /JOIN GAME/ }).click();
    await expect(page.getByText("YOU ARE IN")).toBeVisible();
    expect(host.state?.players.find((p) => p.name === "Mobile")?.team).toBe(
      "WORKERS",
    );
    host.command("start");
    await expect(page.getByText("Rotate your phone to play")).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByText("Rotate your phone to play")).toBeHidden();
    await expect(page.locator("#arena")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    await expect.poll(() => host.state?.phase).toBe("PLAYING");
    const visible = await page.evaluate(() => ({
      width: visualViewport!.width,
      height: visualViewport!.height,
    }));
    const fullscreenButton = (await page
      .locator("#player-fullscreen")
      .boundingBox())!;
    expect(fullscreenButton.x + fullscreenButton.width).toBeLessThanOrEqual(
      visible.width + 1,
    );
    await page.getByRole("button", { name: "Enter full screen" }).tap();
    await expect(page.locator("body")).toHaveClass(/player-fullscreen/);
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    for (const selector of [
      "#player-fullscreen",
      "#joystick",
      "#shoot",
      "#dash",
    ]) {
      const bounds = (await page.locator(selector).boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(844);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(390);
    }
    await expect(
      page.locator(".mobile-identity, #possession-hint"),
    ).toHaveCount(0);
    const field = (await page.locator(".arena-wrap").boundingBox())!;
    const score = (await page.locator(".player-scoreboard").boundingBox())!;
    expect(score.height).toBeLessThanOrEqual(28);
    expect(score.y + score.height).toBeLessThanOrEqual(field.y);
    const leftControl = (await page.locator("#joystick").boundingBox())!;
    expect(leftControl.x + leftControl.width).toBeLessThanOrEqual(field.x);
    for (const selector of ["#shoot", "#dash"]) {
      const control = (await page.locator(selector).boundingBox())!;
      expect(control.x).toBeGreaterThanOrEqual(field.x + field.width);
      expect(control.width).toBeGreaterThanOrEqual(48);
    }
    const x = host.state!.players.find((p) => p.name === "Mobile")!.x,
      box = (await page.locator("#joystick").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
    await expect
      .poll(() => host.state!.players.find((p) => p.name === "Mobile")!.x)
      .toBeGreaterThan(x + 20);
    await page.mouse.up();
    await page.locator("#shoot").tap();
    await page.locator("#dash").tap();
    await expect
      .poll(
        () => host.state!.players.find((p) => p.name === "Mobile")!.dashReady,
      )
      .toBeGreaterThan(0);
    for (const width of [740, 568]) {
      await page.setViewportSize({ width, height: 320 });
      const pitch = (await page.locator(".arena-wrap").boundingBox())!;
      const viewport = await page.evaluate(() => ({
        width: visualViewport!.width,
        height: visualViewport!.height,
      }));
      expect(pitch.width).toBeGreaterThanOrEqual(
        viewport.width - (width === 568 ? 1 : 192),
      );
      for (const selector of ["#joystick", "#shoot", "#dash"]) {
        const control = (await page.locator(selector).boundingBox())!;
        expect(control.x).toBeGreaterThanOrEqual(0);
        expect(control.y).toBeGreaterThanOrEqual(0);
        expect(control.x + control.width).toBeLessThanOrEqual(
          viewport.width + 1,
        );
        expect(control.y + control.height).toBeLessThanOrEqual(
          viewport.height + 1,
        );
        expect(Math.min(control.width, control.height)).toBeGreaterThanOrEqual(
          48,
        );
      }
    }
    const smallStick = (await page.locator("#joystick").boundingBox())!;
    const beforeSmallMove = host.state!.players.find(
      (p) => p.name === "Mobile",
    )!.x;
    await page.mouse.move(
      smallStick.x + smallStick.width / 2,
      smallStick.y + smallStick.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      smallStick.x + 3,
      smallStick.y + smallStick.height / 2,
    );
    await expect
      .poll(() => host.state!.players.find((p) => p.name === "Mobile")!.x)
      .toBeLessThan(beforeSmallMove - 20);
    const knob = (await page.locator("#stick").boundingBox())!;
    expect(knob.x).toBeGreaterThanOrEqual(smallStick.x);
    expect(knob.x + knob.width).toBeLessThanOrEqual(
      smallStick.x + smallStick.width,
    );
    await page.mouse.up();
    await page.getByRole("button", { name: "Exit full screen" }).tap();
    await expect(page.locator("body")).not.toHaveClass(/player-fullscreen/);
    // A browser that exposes fullscreen but rejects the request stays playable.
    await page.evaluate(() => {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
        value: () => Promise.reject(new Error("Fullscreen unavailable")),
        configurable: true,
      });
    });
    await page.getByRole("button", { name: "Enter full screen" }).tap();
    await expect(page.locator("body")).toHaveClass(/player-fullscreen/);
    host.command("end");
    await expect.poll(() => host.state?.phase).toBe("FINISHED");
    host.command("new");
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/player-fullscreen/);
  } finally {
    await ctx.close();
  }
});
