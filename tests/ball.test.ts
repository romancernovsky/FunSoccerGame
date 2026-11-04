import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
import { FIELD, type Team } from "../src/shared";

const now = 100000;
function setup(defenderTeam: Team = "WORKERS") {
  const g = new Game({ duration: 180, maxTeamSize: 6, grace: 20, dev: false });
  const a = g.join("Alex", "LEADERS", now);
  const b = g.join("Sam", "WORKERS", now);
  const target = defenderTeam === "LEADERS" ? g.join("Lee", "LEADERS", now) : b;
  g.command("start", { confirm: true }, now);
  g.tick(0, now + 4000);
  for (const p of g.players.values()) Object.assign(p, { x: 100, y: 100 });
  const shooter = g.players.get(a.id)!;
  const defender = g.players.get(target.id)!;
  Object.assign(shooter, { x: 500, y: 350, fx: 1, fy: 0 });
  Object.assign(defender, { x: 600, y: 350 });
  return { g, shooter, defender };
}

for (const team of ["WORKERS", "LEADERS"] as const) {
  test(`a charged shot rebounds off a ${team} player during the kick pickup lock`, () => {
    const { g, shooter, defender } = setup(team);
    Object.assign(g.ball, { owner: shooter.id, x: 529, y: 350 });
    g.release(1, now + 4100);
    g.tick(1 / 20, now + 4150);
    assert.equal(g.ball.owner, null);
    assert.ok(g.ball.vx < 0);
    assert.ok(Math.abs(g.ball.vx) < 1090);
    assert.equal(g.ball.lastTouch, defender.id);
    assert.ok(g.ball.x < defender.x - FIELD.radius - FIELD.ballRadius);
    const x = g.ball.x;
    g.tick(1 / 30, now + 4184);
    assert.ok(g.ball.x < x);
    assert.ok(g.ball.vx < 0, "outgoing balls must not repeatedly reverse");
    assert.equal(g.ball.owner, null);
  });
}
test("a glancing hit deflects sideways rather than passing through the body", () => {
  const { g, defender } = setup();
  Object.assign(g.ball, { x: 550, y: defender.y + 20, vx: 1090, vy: 0 });
  g.tick(1 / 20, now + 4150);
  assert.equal(g.ball.lastTouch, defender.id);
  assert.ok(g.ball.vy > 0);
  assert.equal(g.ball.owner, null);
  assert.ok(Math.hypot(g.ball.x - defender.x, g.ball.y - defender.y) >= 26);
});
test("a player can block a shot before it crosses the goal line", () => {
  const { g, defender } = setup();
  defender.x = 1183;
  Object.assign(g.ball, { x: 1130, y: 350, vx: 1090, vy: 0 });
  g.tick(0.1, now + 4200);
  assert.equal(g.score.LEADERS, 0);
  assert.equal(g.phase, "PLAYING");
  assert.ok(g.ball.vx < 0);
});
test("a disconnected player neither blocks nor collects the ball", () => {
  const { g, defender } = setup();
  g.disconnect(defender.id, now + 4100);
  Object.assign(g.ball, { x: 565, y: 350, vx: 1090, vy: 0 });
  g.tick(1 / 20, now + 4150);
  assert.ok(g.ball.x > defender.x);
  assert.ok(g.ball.vx > 0);
  assert.equal(g.ball.owner, null);
});
test("slow loose balls remain controllable after a rebound's brief pickup lock", () => {
  const { g, defender } = setup();
  Object.assign(g.ball, {
    x: 575,
    y: 350,
    vx: -80,
    vy: 0,
    lockUntil: now + 4300,
  });
  g.tick(1 / 30, now + 4200);
  assert.equal(g.ball.owner, null);
  Object.assign(g.ball, { x: 575, y: 350, vx: 0, vy: 0 });
  g.tick(1 / 30, now + 4400);
  assert.equal(g.ball.owner, defender.id);
});
test("goalkeepers deflect fast shots and retain their larger slow-ball collection area", () => {
  const { g, defender } = setup();
  Object.assign(defender, { keeper: true, x: 1120 });
  Object.assign(g.ball, { x: 1050, y: 350, vx: 1090, vy: 0 });
  g.tick(1 / 20, now + 4150);
  assert.ok(g.ball.vx < 0);
  assert.equal(g.ball.owner, null);
  Object.assign(g.ball, { x: 1070, y: 350, vx: 0, vy: 0 });
  g.tick(1 / 30, now + 4500);
  assert.equal(g.ball.owner, defender.id);
});
