import { chromium } from "@playwright/test";
import { WebSocket } from "ws";
const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const base = "http://127.0.0.1:3106",
  out = process.env.CAPTURE_OUT || "artifacts/visual-review-3";
let rival;
try {
  const desktop = await b.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    mobile = await b.newContext({
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
  const host = await desktop.newPage(),
    player = await mobile.newPage();
  await host.goto(base + "/host");
  await host.getByRole("heading", { name: "Host", exact: true }).waitFor();
  await host.locator("#host-watch").waitFor();
  // Record an actual bot goal if one arrives before starting the controlled two-player demonstration.
  try {
    await host
      .locator("#arena-overlay")
      .filter({ hasText: "GOOOAL!" })
      .waitFor({ timeout: 35000 });
    await host
      .locator("#host-watch")
      .screenshot({ path: out + "/goal-12-players.png" });
  } catch {}
  await host.locator('[data-command="end"]').click();
  await host.locator("#confirm").click();
  await host.locator('[data-command="new"]').waitFor();
  await host.locator('[data-command="new"]').click();
  await host.locator("#confirm").click();
  await host.locator('[data-command="start"]').waitFor();
  let snapshot, id;
  player.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      const m = JSON.parse(String(f.payload));
      if (m.type === "state") snapshot = m.data;
      if (m.type === "identity") id = m.data.id;
    }),
  );
  await player.goto(base + "/join");
  await player.locator("#name").fill("Maya");
  await player.getByRole("button", { name: /^Play$/ }).click();
  await player.getByText("You’re in").waitFor();
  rival = new WebSocket("ws://127.0.0.1:3106/ws");
  await new Promise((r) => rival.once("open", r));
  rival.send(
    JSON.stringify({ type: "join", data: { name: "Alex", team: "ORANGE" } }),
  );
  await host.locator('[data-command="start"]').waitFor({ state: "visible" });
  await host.waitForTimeout(300);
  await host.locator('[data-command="start"]').click();
  await host.locator("#confirm").click();
  await player.waitForTimeout(4500);
  // Actual joystick input: chase the authoritative ball until possession, with no state injection.
  const joy = await player.locator("#joystick").boundingBox();
  const cx = joy.x + joy.width / 2,
    cy = joy.y + joy.height / 2;
  await player.mouse.move(cx, cy);
  await player.mouse.down();
  for (let i = 0; i < 70; i++) {
    const p = snapshot?.players.find((p) => p.id === id);
    if (snapshot?.ball.owner === id) break;
    if (p) {
      const dx = snapshot.ball.x - p.x,
        dy = snapshot.ball.y - p.y,
        d = Math.hypot(dx, dy) || 1;
      await player.mouse.move(cx + (dx / d) * 42, cy + (dy / d) * 42);
    }
    await player.waitForTimeout(50);
  }
  await player.mouse.up();
  if (snapshot.ball.owner !== id)
    throw Error("Player did not acquire the ball");
  // Face the opposing goal using a short real movement press, then charge and score.
  await player.keyboard.down("d");
  await player.waitForTimeout(120);
  await player.keyboard.up("d");
  await player.screenshot({ path: out + "/mobile-possession.png" });
  const shoot = await player.locator("#shoot").boundingBox();
  await player.mouse.move(
    shoot.x + shoot.width / 2,
    shoot.y + shoot.height / 2,
  );
  await player.mouse.down();
  await player.waitForTimeout(720);
  await player.screenshot({ path: out + "/mobile-charge.png" });
  await player.mouse.up();
  await host
    .locator("#arena-overlay")
    .filter({ hasText: "GOOOAL!" })
    .waitFor({ timeout: 20000 });
  await player.waitForTimeout(650);
  await player.screenshot({
    path: out + "/mobile-goal.png",
    animations: "disabled",
  });
  await host.screenshot({
    clip: await host.locator(".arena-wrap").boundingBox(),
    path: out + "/goal.png",
    animations: "disabled",
  });
  await desktop.close();
  await mobile.close();
} finally {
  rival?.close();
  await b.close();
}
