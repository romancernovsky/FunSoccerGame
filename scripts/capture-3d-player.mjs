import { chromium } from "@playwright/test";
import { WebSocket } from "ws";
const host = new WebSocket("ws://localhost:3106/ws");
let state;
host.on("message", (r) => {
  const m = JSON.parse(String(r));
  if (m.type === "state") state = m.data;
});
const wait = async (fn, timeout = 15000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout)
      throw Error("Timed out waiting for match state");
    await new Promise((r) => setTimeout(r, 50));
  }
};
const send = (action, confirm = true) =>
  host.send(JSON.stringify({ type: "command", data: { action, confirm } }));
await new Promise((r) => host.once("open", r));
const ready = new Promise((resolve, reject) => {
  host.on("message", (r) => {
    const m = JSON.parse(String(r));
    if (m.type === "host_ready") resolve();
    if (m.type === "error") console.log(m.data.message);
  });
});
host.send(JSON.stringify({ type: "host", data: {} }));
await ready;
await wait(() => state);
if (!["WAITING", "FINISHED"].includes(state.phase)) {
  send("end");
  await wait(() => state.phase === "FINISHED");
}
if (state.phase === "FINISHED") {
  send("new");
  await wait(() => state.phase === "WAITING" && state.players.length === 0);
} else if (state.players.length) {
  send("reset");
  await wait(() => state.players.length === 0);
}
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
let rival;
try {
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const p = await ctx.newPage();
  let goalFrozen = false;
  await p.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    let last = false;
    route.onMessage((message) => {
      const m = JSON.parse(String(message));
      if (m.type === "input" && m.data.action !== last) {
        last = m.data.action;
        console.log("ACTION", last, m.data.x, m.data.y);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const m = JSON.parse(String(message));
      if (m.type === "state") {
        if (goalFrozen) return;
        if (m.data.phase === "GOAL") goalFrozen = true;
      }
      route.send(message);
    });
  });
  p.on("pageerror", (e) => console.log("page error", e.message));
  await p.goto("http://localhost:3106/join");
  await p.locator("#name").fill("Maya");
  await p.getByRole("button", { name: /^Play$/ }).click();
  await p.getByText("You’re in").waitFor();
  rival = new WebSocket("ws://localhost:3106/ws");
  await new Promise((r) => rival.once("open", r));
  rival.send(
    JSON.stringify({ type: "join", data: { name: "Alex", team: "WORKERS" } }),
  );
  await wait(() => state.players.length === 2);
  send("start");
  await wait(() => state.phase === "PLAYING");
  console.log("playing");
  await p.locator("#joystick").waitFor({ state: "visible", timeout: 60000 });
  const joy = await p.locator("#joystick").boundingBox(),
    cx = joy.x + joy.width / 2,
    cy = joy.y + joy.height / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  for (let i = 0; i < 140; i++) {
    const me = state.players.find((p) => p.name === "Maya");
    if (state.ball.owner === me.id) break;
    const dx = state.ball.x - me.x,
      dy = state.ball.y - me.y,
      d = Math.hypot(dx, dy) || 1;
    await p.mouse.move(cx + (42 * dx) / d, cy + (42 * dy) / d);
    await p.waitForTimeout(50);
  }
  await p.mouse.up();
  const me = state.players.find((p) => p.name === "Maya");
  if (state.ball.owner !== me.id) throw Error("No possession");
  console.log("possession");
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx + 42, cy);
  await wait(() => {
    const v = state.players.find((p) => p.name === "Maya");
    return v.fx > 0.99 && Math.abs(v.fy) < 0.01;
  });
  await p.waitForTimeout(250);
  await p.mouse.up();
  console.log(
    "aim",
    state.players.find((p) => p.name === "Maya").fx,
    state.players.find((p) => p.name === "Maya").fy,
  );
  await p.screenshot({ path: "artifacts/3d-final/mobile-possession.png" });
  const btn = await p.locator("#shoot").boundingBox();
  await p.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.screenshot({ path: "artifacts/3d-final/mobile-charge.png" });
  await p.mouse.up();
  console.log(
    "AFTER RELEASE",
    state.players.find((p) => p.name === "Maya"),
    state.ball,
  );
  await wait(() => goalFrozen);
  await p.locator("#arena-overlay .goal-word").waitFor();
  await p.screenshot({
    path: "artifacts/3d-final/mobile-goal.png",
    animations: "disabled",
  });
  console.log(
    "captured official goal snapshot; opacity",
    await p.locator(".goal-word").evaluate((e) => getComputedStyle(e).opacity),
  );
  await ctx.close();
} catch (e) {
  console.log(e.message);
  console.log(
    await browser.contexts()[0]?.pages()[0]?.locator("body").innerText(),
  );
  await browser
    .contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: "artifacts/3d-capture-failure.png" });
  throw e;
} finally {
  host.close();
  rival?.close();
  await browser.close();
}
