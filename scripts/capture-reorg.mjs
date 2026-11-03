// Isolated development capture only. Resets the configured lobby; all participants are labeled TEST.
import { chromium } from "@playwright/test";
import { WebSocket } from "ws";
import { mkdir } from "node:fs/promises";
const base = "http://127.0.0.1:3109",
  url = "ws://127.0.0.1:3109/ws",
  out = "artifacts/reorg";
await mkdir(out, { recursive: true });
const wait = async (fn, ms = 20000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw Error("Timed out");
    await new Promise((r) => setTimeout(r, 30));
  }
};
async function socket() {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.once("open", r));
  return ws;
}
function request(ws, type, data, reply) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(reply + " timeout")), 5000);
    const read = (raw) => {
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
}
const admin = await socket();
let state;
admin.on("message", (r) => {
  const m = JSON.parse(String(r));
  if (m.type === "state") state = m.data;
});
await request(admin, "host", {}, "host_ready");
await wait(() => state);
const command = (action, id) =>
  admin.send(
    JSON.stringify({ type: "command", data: { action, id, confirm: true } }),
  );
const names = [
  "TEST Maya",
  "TEST Alex",
  "TEST Ava",
  "TEST Liam",
  "TEST Noah",
  "TEST Sophia",
  "TEST Zoe",
  "TEST Arjun",
  "TEST Max",
  "TEST Ivy",
  "TEST Theo",
  "TEST Nora",
];
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const mode of ["broadcast", "mobile"]) {
    if (!["WAITING", "FINISHED"].includes(state.phase)) {
      command("end");
      await wait(() => state.phase === "FINISHED");
    }
    if (state.phase === "FINISHED") {
      command("new");
      await wait(() => state.phase === "WAITING" && state.players.length === 0);
    } else if (state.players.length) {
      command("reset");
      await wait(() => state.players.length === 0);
    }
    const sockets = [],
      context = await browser.newContext(
        mode === "mobile"
          ? {
              viewport: { width: 844, height: 390 },
              isMobile: true,
              hasTouch: true,
            }
          : { viewport: { width: 1440, height: 1000 } },
      ),
      page = await context.newPage();
    let frozen = false;
    // Preserve the genuine REORG snapshot only while taking still artifacts; never modify assignments or score.
    await page.routeWebSocket("**/ws", (route) => {
      const server = route.connectToServer();
      route.onMessage((m) => server.send(m));
      server.onMessage((message) => {
        const m = JSON.parse(String(message));
        if (m.type === "state") {
          if (frozen) return;
          if (m.data.phase === "REORG") frozen = true;
        }
        route.send(message);
      });
    });
    try {
      if (mode === "mobile") {
        await page.goto(base + "/join");
        await page.locator("#name").fill(names[0]);
        await page.getByRole("button", { name: /JOIN GAME/ }).click();
        await page.getByText("YOU ARE IN").waitFor();
      }
      for (let i = mode === "mobile" ? 1 : 0; i < 12; i++) {
        const ws = await socket();
        sockets.push(ws);
        await request(
          ws,
          "join",
          { name: names[i], team: i < 6 ? "LEADERS" : "WORKERS" },
          "identity",
        );
      }
      await wait(() => state.players.length === 12);
      command("keeper", state.players.find((p) => p.name === names[1]).id);
      command("keeper", state.players.find((p) => p.name === names[7]).id);
      if (mode === "broadcast") {
        await page.goto(base + "/host");
        await page.locator('[data-command="start"]').waitFor();
      }
      command("start");
      if (mode === "broadcast") {
        await page.locator("#broadcast-mode").click();
        await page.mouse.move(0, 0);
      }
      await wait(() => frozen);
      await page.locator(".reorg-board").waitFor({ state: "visible" });
      await page.screenshot({
        path: out + "/" + mode + "-teams.png",
        animations: "disabled",
      });
      if (mode === "mobile") {
        for (const viewport of [
          { width: 844, height: 320 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await page.screenshot({
            path: out + `/mobile-${viewport.width}x${viewport.height}.png`,
            animations: "disabled",
          });
          const fit = await page.locator(".reorg-board").evaluate((el) => {
            const b = el.getBoundingClientRect(),
              a = el.closest(".arena-wrap").getBoundingClientRect();
            return {
              bottom: b.bottom,
              arena: a.bottom,
              width: el.scrollWidth,
              client: el.clientWidth,
            };
          });
          console.log("roster fit", viewport, fit);
          if (fit.bottom > fit.arena + 1 || fit.width > fit.client + 1)
            throw Error("Roster overflow");
        }
      }
    } finally {
      await context.close();
      sockets.forEach((ws) => ws.close());
    }
  }
} finally {
  admin.close();
  await browser.close();
}
