import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraTarget, overview, smoothCamera } from "../src/camera";
import { Game } from "../server/game";
test("broadcast follows ball, widens for shots and never frames outside arena", () => {
  const g = new Game();
  g.phase = "PLAYING";
  for (const x of [0, 300, 600, 900, 1200])
    for (const y of [0, 350, 700]) {
      g.ball.x = x;
      g.ball.y = y;
      const c = cameraTarget(g.snapshot(0), true);
      assert.ok(c.zoom > 1 && c.zoom <= 1.48);
      assert.ok(
        c.x - 660 / c.zoom >= -1e-6 && c.x + 660 / c.zoom <= 1320 + 1e-6,
      );
      assert.ok(
        c.y - 400 / c.zoom >= -1e-6 && c.y + 400 / c.zoom <= 800 + 1e-6,
      );
      assert.ok(
        Math.abs(x + 60 - c.x) <= 660 / c.zoom &&
          Math.abs(y + 50 - c.y) <= 400 / c.zoom,
      );
    }
  g.ball.x = 1000;
  g.ball.y = 350;
  const slow = cameraTarget(g.snapshot(0), true);
  g.ball.vx = 1000;
  const fast = cameraTarget(g.snapshot(0), true);
  assert.ok(fast.zoom < slow.zoom);
  assert.ok(slow.x > overview().x);
});
test("camera returns to full field for pauses, countdowns and celebrations", () => {
  const g = new Game();
  for (const phase of [
    "WAITING",
    "COUNTDOWN",
    "PAUSED",
    "GOAL",
    "REORG",
    "KICKOFF_COUNTDOWN",
    "FINISHED",
  ] as const) {
    g.phase = phase;
    assert.deepEqual(cameraTarget(g.snapshot(0), true), overview());
  }
  g.phase = "PLAYING";
  assert.deepEqual(cameraTarget(g.snapshot(0), false), overview());
});
test("camera pans and zooms smoothly while keeping frame bounded", () => {
  const target = { x: 850, y: 450, zoom: 1.4 };
  let c = overview();
  const first = smoothCamera(c, target, 1 / 60);
  assert.ok(first.zoom > 1 && first.zoom < 1.4);
  assert.ok(first.x > c.x && first.x < target.x);
  for (let i = 0; i < 300; i++) {
    c = smoothCamera(c, target, 1 / 60);
    assert.ok(c.x - 660 / c.zoom >= -1e-6);
    assert.ok(c.y - 400 / c.zoom >= -1e-6);
  }
  assert.ok(Math.abs(c.zoom - target.zoom) < 0.001);
});
