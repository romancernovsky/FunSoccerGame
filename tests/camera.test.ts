import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraTarget,
  cameraFrustum,
  visibleHalfExtents,
  overview,
  smoothCamera,
  CAMERA_ELEVATION,
} from "../src/camera";
import { Game } from "../server/game";
const screens = [
  { width: 568, height: 212 },
  { width: 740, height: 232 },
  { width: 844, height: 362 },
  { width: 1320, height: 800 },
];

test("overhead ball camera crops to the action at phone and projector aspect ratios", () => {
  const game = new Game();
  game.phase = "PLAYING";
  assert.ok((CAMERA_ELEVATION * 180) / Math.PI > 65);
  for (const viewport of screens)
    for (const x of [9, 300, 600, 900, 1191])
      for (const y of [9, 350, 691]) {
        Object.assign(game.ball, { x, y });
        const view = cameraTarget(game.snapshot(0), true, viewport),
          half = visibleHalfExtents(view, viewport);
        assert.ok(
          half.x * 2 >= 749 && half.x * 2 <= 901,
          "show only the action, even on a very wide phone",
        );
        assert.ok(
          Math.abs(x + 60 - view.x) < half.x * 0.75,
          "ball stays away from horizontal edges",
        );
        assert.ok(
          Math.abs(y + 50 - view.y) < half.y * 0.6,
          "ball stays away from top/bottom controls",
        );
        assert.equal(half.x * view.zoom, cameraFrustum(viewport).halfWidth);
      }
});

test("fast shots widen slightly and lead the ball without pulling back to the whole pitch", () => {
  const game = new Game();
  game.phase = "PLAYING";
  for (const viewport of screens) {
    const slow = cameraTarget(game.snapshot(0), true, viewport);
    Object.assign(game.ball, { vx: 1200, vy: 450 });
    const fast = cameraTarget(game.snapshot(0), true, viewport);
    assert.ok(fast.zoom < slow.zoom);
    assert.ok(fast.x > slow.x);
    assert.ok(visibleHalfExtents(fast, viewport).x * 2 < 901);
    Object.assign(game.ball, { vx: 0, vy: 0 });
  }
});

test("ball remains the focus when the local player is on the opposite side", () => {
  const game = new Game();
  const { id } = game.join("Alex", "BLUE", 0);
  Object.assign(game.players.get(id)!, { x: 17, y: 17 });
  game.phase = "PLAYING";
  Object.assign(game.ball, { x: 1183, y: 683 });
  for (const viewport of screens) {
    const view = cameraTarget(game.snapshot(0), true, viewport);
    const half = visibleHalfExtents(view, viewport);
    assert.ok(view.x > 1000);
    assert.ok(Math.abs(game.ball.x + 60 - view.x) < half.x * 0.75);
    assert.ok(
      Math.abs(77 - view.x) > half.x,
      "a distant local player cannot pull the camera off the action",
    );
  }
});

test("kickoffs, goals and pauses retain close framing; rosters, lobby and full time use overview", () => {
  const game = new Game();
  for (const phase of [
    "COUNTDOWN",
    "KICKOFF_COUNTDOWN",
    "PLAYING",
    "GOLDEN_GOAL",
    "GOAL",
    "PAUSED",
  ] as const) {
    game.phase = phase;
    assert.ok(cameraTarget(game.snapshot(0), true).zoom > 1);
    assert.deepEqual(cameraTarget(game.snapshot(0), false), overview());
  }
  for (const phase of ["WAITING", "FINISHED"] as const) {
    game.phase = phase;
    assert.deepEqual(cameraTarget(game.snapshot(0), true), overview());
  }
});

test("camera eases predictably and keeps fast ball corrections inside the visible frame", () => {
  const game = new Game();
  game.phase = "PLAYING";
  for (const viewport of screens) {
    let view = overview();
    const target = cameraTarget(game.snapshot(0), true, viewport);
    const first = smoothCamera(view, target, 1 / 60, viewport);
    assert.ok(first.zoom > 1 && first.zoom < target.zoom);
    for (let i = 0; i < 300; i++)
      view = smoothCamera(view, target, 1 / 60, viewport);
    assert.ok(Math.abs(view.zoom - target.zoom) < 0.001);
    for (const x of [1191, 9, 1100, 100])
      for (const y of [691, 9]) {
        Object.assign(game.ball, {
          x,
          y,
          vx: x > 600 ? 1400 : -1400,
          vy: y > 350 ? 900 : -900,
        });
        const target = cameraTarget(game.snapshot(0), true, viewport);
        view = smoothCamera(view, target, 1 / 30, viewport, {
          x: x + 60,
          y: y + 50,
        });
        const half = visibleHalfExtents(view, viewport);
        assert.ok(Math.abs(x + 60 - view.x) < half.x * 0.76);
        assert.ok(Math.abs(y + 50 - view.y) < half.y * 0.61);
      }
  }
});

test("three-ball broadcasts frame every remaining ball while phones stay close to their owned ball", () => {
  const g = new Game();
  const local = g.join("Alex", "BLUE", 0);
  g.join("Sam", "ORANGE", 0);
  g.phase = "PLAYING";
  g.multiball = true;
  g.balls = [g.newBall(), g.newBall(), g.newBall()];
  Object.assign(g.balls[0], { x: 35, y: 45 });
  Object.assign(g.balls[1], { x: 1160, y: 650 });
  Object.assign(g.balls[2], { x: 1000, y: 250, owner: local.id });
  const viewport = { width: 1280, height: 720 };
  const broadcast = cameraTarget(g.snapshot(0), true, viewport);
  const half = visibleHalfExtents(broadcast, viewport);
  for (const ball of g.balls) {
    assert.ok(Math.abs(ball.x + 60 - broadcast.x) < half.x);
    assert.ok(Math.abs(ball.y + 50 - broadcast.y) < half.y);
  }
  const phone = { width: 740, height: 260 };
  const view = cameraTarget(g.snapshot(0), true, phone, local.id);
  assert.ok(view.x > 900);
  assert.ok(visibleHalfExtents(view, phone).x * 2 < 901);
  // Retired balls must never drag a camera away from the remaining action.
  g.balls[0].scored = g.balls[1].scored = true;
  const last = cameraTarget(g.snapshot(0), true, viewport);
  assert.ok(last.x > 900);
});
