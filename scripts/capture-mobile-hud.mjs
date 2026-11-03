import { chromium } from "@playwright/test";
import { WebSocket } from "ws";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.HUD_CAPTURE_URL || "http://127.0.0.1:3110";
const tag = process.env.HUD_CAPTURE_TAG || "after";
const out = "artifacts/mobile-hud";
const skills = process.env.HUD_CAPTURE_SKILLS === "1";
const admin = new WebSocket(base.replace(/^http/, "ws") + "/ws");
let state;
admin.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === "state") state = m.data;
});
const wait = async (predicate, timeout = 30000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout)
      throw Error("Timed out waiting for development match");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const command = (action) =>
  admin.send(
    JSON.stringify({ type: "command", data: { action, confirm: true } }),
  );
let browser;
try {
  await new Promise((resolve, reject) => {
    admin.once("open", resolve);
    admin.once("error", reject);
  });
  await wait(() => state);
  if (!state.dev)
    throw Error(
      "Capture requires an isolated development server with test players.",
    );
  admin.send(JSON.stringify({ type: "host", data: {} }));
  if (!["WAITING", "FINISHED"].includes(state.phase)) {
    command("end");
    await wait(() => state.phase === "FINISHED");
  }
  command(state.phase === "FINISHED" ? "new" : "reset");
  await wait(() => state.phase === "WAITING" && state.players.length === 0);
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      value: undefined,
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      value: undefined,
    });
  });
  let frozen = null;
  let freezeCharge = false;
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    server.onMessage((message) => {
      const m = JSON.parse(String(message));
      if (m.type === "state") {
        if (frozen) return;
        // Hold a genuine server snapshot for still review, without changing gameplay.
        if (!skills && m.data.phase === "PLAYING" && m.data.remaining < 297)
          frozen = m.data;
        const local = m.data.players.find((p) => p.name === "TEST Maya");
        if (
          skills &&
          freezeCharge &&
          local?.chargeAt &&
          m.data.now - local.chargeAt >= 400
        )
          frozen = m.data;
      }
      route.send(message);
    });
  });
  await page.goto(base + "/join");
  await page.locator("#name").fill("TEST Maya");
  await page.getByRole("button", { name: /JOIN GAME/ }).click();
  await page.getByText("YOU ARE IN").waitFor();
  if (skills) {
    admin.send(
      JSON.stringify({
        type: "join",
        data: { name: "TEST Rival", team: "WORKERS" },
      }),
    );
    await wait(() => state.players.length === 2);
  } else {
    command("bots");
    await wait(() => state.players.length === 12);
  }
  command("start");
  await wait(() => (skills ? state.phase === "PLAYING" : frozen));
  await page.locator('#arena[data-renderer="webgl"]').waitFor();
  if (skills) {
    const local = () => state.players.find((p) => p.name === "TEST Maya");
    const stick = await page.locator("#joystick").boundingBox();
    const cx = stick.x + stick.width / 2,
      cy = stick.y + stick.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 100 && state.ball.owner !== local().id; i++) {
      const dx = state.ball.x - local().x,
        dy = state.ball.y - local().y;
      const distance = Math.hypot(dx, dy) || 1;
      await page.mouse.move(
        cx + (38 * dx) / distance,
        cy + (38 * dy) / distance,
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    await page.mouse.up();
    await wait(() => state.ball.owner === local().id);
    await page.locator("#shoot.has-ball").waitFor();
    await page.screenshot({ path: `${out}/${tag}-possession.png` });
    await page.locator("#dash").tap();
    await wait(() => local().dashReady > state.now);
    const dashSnapshot = { now: state.now, ready: local().dashReady };
    await page.screenshot({ path: `${out}/${tag}-cooldown.png` });
    const button = await page.locator("#shoot").boundingBox();
    await page.mouse.move(
      button.x + button.width / 2,
      button.y + button.height / 2,
    );
    freezeCharge = true;
    await page.mouse.down();
    await wait(() => frozen);
    await page.screenshot({ path: `${out}/${tag}-charge.png` });
    await page.mouse.up();
    await writeFile(
      `${out}/${tag}-skills.json`,
      JSON.stringify(
        {
          playerCount: frozen.players.length,
          dashSnapshot,
          chargeSnapshot: {
            now: frozen.now,
            ballOwner: frozen.ball.owner,
            player: frozen.players.find((p) => p.name === "TEST Maya"),
          },
          provenance:
            "Real joystick movement acquired possession; real dash and action-button hold. The genuine charging server snapshot is held only for its still capture. No positions, goals, possession or match phase were injected.",
        },
        null,
        2,
      ),
    );
    console.log(
      "Captured genuine possession, dash cooldown and charged shot from a two-player TEST match.",
    );
  } else {
    const metrics = [];
    for (const [label, width, height] of [
      ["wide", 844, 390],
      ["short", 740, 320],
      ["small", 568, 320],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.screenshot({ path: `${out}/${tag}-${label}.png` });
      metrics.push(
        await page.evaluate(
          (label) => ({
            label,
            viewport: { width: innerWidth, height: innerHeight },
            field: document
              .querySelector(".arena-wrap")
              .getBoundingClientRect()
              .toJSON(),
            controls: [
              ...document.querySelectorAll("#joystick, #shoot, #dash"),
            ].map((e) => ({
              id: e.id,
              rect: e.getBoundingClientRect().toJSON(),
            })),
          }),
          label,
        ),
      );
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole("button", { name: "Enter full screen" }).tap();
    await page.screenshot({ path: `${out}/${tag}-fullscreen.png` });
    await writeFile(
      `${out}/${tag}-metrics.json`,
      JSON.stringify(
        {
          frozenAt: frozen.now,
          phase: frozen.phase,
          playerCount: frozen.players.length,
          metrics,
        },
        null,
        2,
      ),
    );
    console.log(
      `Captured ${tag} mobile HUD at 844×390, 740×320, 568×320 and fullscreen. Genuine PLAYING snapshot with ${frozen.players.length} TEST participants held for stills.`,
    );
  }
} finally {
  admin.close();
  await browser?.close();
}
