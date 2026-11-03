import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  timeout: 90000,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const base = process.env.CAPTURE_URL || "http://127.0.0.1:3106",
  out = process.env.CAPTURE_OUT || "artifacts/visual-review";
try {
  const desktop = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    mobile = await browser.newContext({
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
  const host = await desktop.newPage(),
    screen = await desktop.newPage(),
    player = await mobile.newPage();
  await host.goto(base + "/host");
  await host.getByText("Run the show.").waitFor();
  await host.waitForTimeout(700);
  if (await host.locator('[data-command="end"]').count()) {
    await host.locator('[data-command="end"]').click();
    await host.locator("#confirm").click();
    await host.locator('[data-command="new"]').waitFor();
  }
  if (await host.locator('[data-command="new"]').count()) {
    await host.locator('[data-command="new"]').click();
    await host.locator("#confirm").click();
    await host.locator('[data-command="start"]').waitFor();
  } else if (await host.locator(".player-label").count()) {
    await host.locator('[data-command="reset"]').click();
    await host.locator("#confirm").click();
  }
  await player.goto(base + "/join");
  await player.locator("#name").fill("Maya");
  await player.getByRole("button", { name: /JOIN GAME/ }).click();
  await player.getByText("YOU ARE IN").waitFor();
  await host.locator('[data-command="bots"]').click();
  await host.waitForTimeout(300);
  await host.locator('[data-action="keeper"]').nth(1).click();
  await host.locator('[data-action="keeper"]').nth(6).click();
  await screen.goto(base + "/screen");
  await screen.evaluate(() => document.fonts.ready);
  await screen.waitForTimeout(700);
  await screen.screenshot({ path: out + "/lobby.png", fullPage: true });
  await screen.close();
  await host.locator('[data-command="start"]').click();
  await host.waitForTimeout(8000);
  await host.locator("#host-watch").waitFor({ timeout: 90000 });
  await host.screenshot({
    clip: await host.locator(".arena-wrap").boundingBox(),
    timeout: 90000,
    animations: "disabled",
    path: out + "/arena.png",
  });
  await host.screenshot({
    clip: await host.locator("#host-watch").boundingBox(),
    timeout: 90000,
    animations: "disabled",
    path: out + "/host.png",
  });
  await player.screenshot({ path: out + "/mobile.png" });
  await host.locator("#broadcast-mode").click();
  await host.mouse.move(0, 0);
  await host.waitForTimeout(1000);
  await host.screenshot({ path: out + "/broadcast.png" });
  await player.locator("#shoot").hover();
  await player.mouse.down();
  await player.waitForTimeout(650);
  await player.screenshot({ path: out + "/mobile-charge.png" });
  await player.mouse.up();
  await desktop.close();
  await mobile.close();
} finally {
  await browser.close();
}
