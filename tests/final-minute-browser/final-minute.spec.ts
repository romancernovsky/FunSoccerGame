import { test, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { Game } from "../../server/game";
import { FIELD, type Snapshot } from "../../src/shared";

test("seven-second new rules event preserves teams, refreshes safely, drops two balls and restores mobile play", async ({
  browser,
}) => {
  const admin = new WebSocket("ws://127.0.0.1:3108/ws");
  const rival = new WebSocket("ws://127.0.0.1:3108/ws");
  let state: Snapshot | undefined;
  const phases: string[] = [];
  const minuteCues = new Set<number>();
  const drops = new Set<number>();
  const heights: number[] = [];
  admin.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type !== "state") return;
    state = m.data;
    if (phases.at(-1) !== state!.phase) phases.push(state!.phase);
    for (const e of state!.events ?? []) {
      if (e.kind === "final_minute") minuteCues.add(e.id);
      if (e.kind === "balls_dropped") drops.add(e.id);
    }
    if (state!.balls.length === 3) heights.push(state!.balls[1].height);
  });
  const request = (ws: WebSocket, type: string, data: unknown, reply: string) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Reply timeout")), 5000);
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
    viewport: { width: 740, height: 260 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const hostContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
  });
  const host = await hostContext.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  host.on("pageerror", (e) => errors.push(e.message));
  try {
    await Promise.all(
      [admin, rival].map(
        (ws) =>
          new Promise((r) =>
            ws.readyState === WebSocket.OPEN ? r(null) : ws.once("open", r),
          ),
      ),
    );
    await request(admin, "host", {}, "host_ready");
    await request(rival, "join", { name: "Alex", team: "BLUE" }, "identity");
    await page.goto("/join");
    await expect(page.locator(".team-option strong")).toHaveText([
      "Blue Team",
      "Orange Team",
    ]);
    await page.locator("#name").fill("Maya");
    await page.locator('[data-team="ORANGE"]').click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".joined-identity")).toContainText("Orange Team");
    await expect.poll(() => state?.players.length).toBe(2);
    const id = state!.players.find((p) => p.name === "Maya")!.id;
    const teams = state!.players.map((p) => [p.id, p.team, p.keeper]);
    await host.goto("/host");
    await host.getByRole("button", { name: /START MATCH/ }).click();
    await host.locator("dialog #confirm").click();
    await expect.poll(() => state?.phase).toBe("PLAYING");
    await expect
      .poll(() => state?.phase, { timeout: 15000 })
      .toBe("RULES_COUNTDOWN");
    await expect(page.locator(".new-rules h2")).toHaveText(
      "NEW RULES. SAME TEAMS. PLAY ON.",
    );
    await expect(host.locator(".new-rules h2")).toHaveText(
      "NEW RULES. SAME TEAMS. PLAY ON.",
    );
    expect(state!.remaining).toBe(60);
    expect(state!.deadline - state!.now).toBeLessThanOrEqual(7000);
    expect(state!.deadline - state!.now).toBeGreaterThan(5000);
    expect(state!.players.map((p) => [p.id, p.team, p.keeper])).toEqual(teams);
    for (const p of state!.players)
      expect(Math.hypot(p.x - 600, p.y - 350)).toBeCloseTo(
        FIELD.centerCircleRadius,
        4,
      );
    await expect(page.locator("#joystick")).toBeHidden();
    await page.screenshot({
      path: "artifacts/final-minute/phone-new-rules.png",
    });
    command("pause");
    await expect.poll(() => state?.phase).toBe("PAUSED");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#arena")).toHaveAttribute(
      "aria-label",
      /orange \(Orange Team\)/,
    );
    await page.waitForTimeout(350);
    expect(state!.remaining).toBe(60);
    expect(state!.players.find((p) => p.id === id)?.team).toBe("ORANGE");
    command("resume");
    await expect.poll(() => state?.phase).toBe("RULES_COUNTDOWN");
    await expect(page.locator(".new-rules")).toBeVisible();
    await expect.poll(() => state?.phase, { timeout: 15000 }).toBe("PLAYING");
    expect(state!.balls).toHaveLength(3);
    await expect(page.locator("#arena")).toHaveAttribute(
      "data-live-balls",
      "3",
    );
    await expect(page.locator("#balls-remaining")).toHaveText("3 / 3 BALLS");
    await expect(page.locator("#joystick")).toBeVisible();
    await page.screenshot({
      path: "artifacts/final-minute/phone-ball-drop.png",
    });
    await expect.poll(() => heights.some((h) => h === 0)).toBe(true);
    expect(heights.some((h) => h > 150)).toBe(true);
    expect(heights.some((h) => h > 0 && h < 150)).toBe(true);
    await expect(page.locator("#arena-fx")).toHaveAttribute(
      "data-live-balls",
      "3",
    );
    const x = state!.players.find((p) => p.id === id)!.x;
    await page.keyboard.down("d");
    await expect
      .poll(() => state!.players.find((p) => p.id === id)!.x)
      .toBeGreaterThan(x + 20);
    await page.keyboard.up("d");
    expect(state!.players.map((p) => [p.id, p.team, p.keeper])).toEqual(teams);
    expect(minuteCues.size).toBe(1);
    expect(drops.size).toBe(1);
    expect(phases.filter((p) => p === "COUNTDOWN")).toHaveLength(1);
    expect(phases).not.toContain("REORG");
    await page.screenshot({
      path: "artifacts/final-minute/phone-three-balls.png",
    });
    await host.screenshot({
      path: "artifacts/final-minute/host-three-balls.png",
    });
    expect(errors).toEqual([]);
  } finally {
    if (state && !["WAITING", "FINISHED"].includes(state.phase)) command("end");
    admin.close();
    rival.close();
    await context.close();
    await hostContext.close();
  }
});

test("3D renderer removes scored balls, keeps all mobile markers and follows the player's own additional ball", async ({
  page,
}) => {
  const game = new Game();
  for (let i = 0; i < 6; i++) {
    game.join(`Blue ${i}`, "BLUE", 1000);
    game.join(`Orange ${i}`, "ORANGE", 1000);
  }
  const localId = [...game.players.keys()][0];
  game.command("start", {}, 1000);
  game.tick(0, 5000);
  game.remaining = 60.01;
  game.tick(0.02, 5100);
  game.tick(0, game.deadline);
  const drop = structuredClone(game.snapshot(game.deadline));
  for (const ball of game.balls) Object.assign(ball, { height: 0, vz: 0 });
  const three = structuredClone(game.snapshot(13000));
  game.goal("BLUE", 13100, game.balls[0]);
  const two = structuredClone(game.snapshot(13100));
  game.goal("ORANGE", 13200, game.balls[1]);
  const one = structuredClone(game.snapshot(13200));
  game.goal("BLUE", 13300, game.balls[2]);
  const zero = structuredClone(game.snapshot(13300));
  await page.setViewportSize({ width: 740, height: 260 });
  await page.goto("/bet");
  const result = await page.evaluate(
    async ({ frames, localId }) => {
      const rendererPath = "/src/renderer3d.ts",
        cameraPath = "/src/camera.ts";
      const { Arena3D } = await import(rendererPath);
      const { cameraTarget, cameraFocus } = await import(cameraPath);
      const arena = new Arena3D();
      const canvas = document.createElement("canvas");
      canvas.width = 740;
      canvas.height = 232;
      const ctx = canvas.getContext("2d")!;
      const seen: number[] = [],
        markers: number[] = [];
      let time = 100;
      for (const state of frames) {
        const view = cameraTarget(
          state,
          true,
          { width: 740, height: 232 },
          localId,
        );
        arena.render(state, (time += 34), 1 / 30, view, localId, 740, 232);
        arena.drawMobileBall(ctx, localId);
        seen.push(Number(arena.renderer.domElement.dataset.liveBalls));
        markers.push(Number(canvas.dataset.liveBalls));
      }
      const state = structuredClone(frames[1]);
      const local = state.players.find((p: any) => p.id === localId)!;
      Object.assign(state.balls[2], { x: 1100, y: 100, owner: localId });
      const focus = cameraFocus(state, localId);
      const camera = cameraTarget(
        state,
        true,
        { width: 740, height: 232 },
        localId,
      );
      arena.renderer.dispose();
      return { seen, markers, focus, camera };
    },
    { frames: [drop, three, two, one, zero], localId },
  );
  expect(result.seen).toEqual([3, 3, 2, 1, 0]);
  expect(result.markers).toEqual([3, 3, 2, 1, 0]);
  expect(result.focus.x).toBe(1100);
  expect(result.camera.x).toBeGreaterThan(900);
});
