import { test, expect } from "@playwright/test";
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
  async auth() {
    await this.request("auth", { pin: "browser-test-pin" }, "authenticated");
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
  const w = await (await wire()).auth();
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
  try {
    await screen.goto("/screen");
    await expect(screen.getByText("Business as unusual.")).toBeVisible();
    await host.goto("/host");
    await host.locator("#pin").fill("wrong");
    await host.getByRole("button", { name: /UNLOCK/ }).click();
    await expect(host.locator("#error")).toContainText("Invalid host PIN");
    const login = async () => {
      await host.locator("#pin").fill("browser-test-pin");
      await host.getByRole("button", { name: /UNLOCK/ }).click();
      await expect(host.getByText("Run the show.")).toBeVisible();
    };
    await login();
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
    await host.keyboard.press("Escape");
    await expect(host.locator("body")).not.toHaveClass(/broadcast-view/);
    await click("pause");
    await expect.poll(() => control.state?.phase).toBe("PAUSED");
    await screen.bringToFront();
    await expect(screen.locator("#arena-overlay")).toContainText("PAUSED");
    await host.bringToFront();
    await host.reload({ waitUntil: "domcontentloaded" });
    await login();
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

test("desktop player: keyboard movement and refresh restore the same 3D character", async ({
  browser,
}) => {
  const host = await (await wire()).auth(),
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

test("mobile: team choice, portrait guidance, landscape joystick, action and dash", async ({
  browser,
}) => {
  const host = await (await wire()).auth(),
    rival = await wire();
  await rival.request("join", { name: "Alex", team: "LEADERS" }, "identity");
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await ctx.newPage();
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
  } finally {
    await ctx.close();
  }
});
