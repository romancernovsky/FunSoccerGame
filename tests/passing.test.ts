import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
import type { Ball, Team } from "../src/shared";
const start = 100000;
const idle = { x: 0, y: 0, action: false, dash: false };
function setup(team: Team = "BLUE", distance = 160) {
  const g = new Game();
  const sender = g.join("Alex", team, start);
  const recipient = g.join("Sam", team, start);
  const opponent = g.join("Lee", team === "BLUE" ? "ORANGE" : "BLUE", start);
  g.command("start", { confirm: true }, start);
  g.tick(0, start + 4000);
  const p = g.players.get(sender.id)!,
    q = g.players.get(recipient.id)!,
    defender = g.players.get(opponent.id)!;
  const direction = team === "BLUE" ? 1 : -1;
  Object.assign(p, {
    x: direction === 1 ? 300 : 900,
    y: 350,
    fx: direction,
    fy: 0,
  });
  Object.assign(q, {
    x: p.x + direction * distance,
    y: 350,
    fx: -direction,
    fy: 0,
  });
  Object.assign(defender, { x: 900, y: 100 });
  Object.assign(g.ball, { x: p.x + direction * 24, y: 350 });
  g.tick(0, start + 4100);
  assert.equal(g.ball.owner, p.id);
  return { g, p, q, defender };
}
function tap(g: Game, id: string, at: number) {
  g.input(id, { ...idle, action: true }, at - 80);
  g.input(id, idle, at);
}
function receive(g: Game, ball: Ball, id: string, at: number, hz = 30) {
  let steps = 0;
  while (ball.owner !== id && steps < hz * 2) {
    at += 1000 / hz;
    g.tick(1 / hz, at);
    steps++;
  }
  assert.equal(
    ball.owner,
    id,
    "a teammate must control the traveling pass without chasing its rebound",
  );
  return at;
}
for (const team of ["BLUE", "ORANGE"] as const)
  for (const hz of [20, 30]) {
    test(`${team} teammates receive short and long tap passes at ${hz} Hz`, () => {
      for (const distance of [90, 280]) {
        const { g, p, q } = setup(team, distance);
        const ball = g.ball,
          at = start + 4300;
        tap(g, p.id, at);
        assert.equal(ball.owner, null);
        const receivedAt = receive(g, ball, q.id, at, hz);
        assert.equal(ball.passes, 1);
        assert.equal(ball.possessionTeam, team);
        assert.equal(ball.passFrom, null);
        assert.equal(ball.vx, 0);
        assert.equal(ball.vy, 0);
        assert.equal(ball.heldAt, receivedAt);
        const cues = g.snapshot(receivedAt).events!.map((e) => e.kind);
        assert.ok(cues.includes("pass_completed"));
        assert.ok(!cues.includes("ball_bounce"));
        if (distance === 90)
          assert.ok(
            receivedAt < at + 220,
            "short passes must bypass the passer-only pickup lock",
          );
      }
    });
  }

test("a nearby off-axis teammate receives the assisted pass instead of a deflection", () => {
  const { g, p, q } = setup();
  q.y += 45;
  const at = start + 4300;
  tap(g, p.id, at);
  assert.ok(g.ball.vy > 0);
  receive(g, g.ball, q.id, at);
  assert.equal(g.ball.passes, 1);
});

test("a pass still cannot be recollected instantly by its sender", () => {
  const { g, p } = setup();
  const at = start + 4300;
  tap(g, p.id, at);
  g.tick(0, at + 1);
  assert.equal(g.ball.owner, null);
  assert.equal(g.ball.passFrom, p.id);
  assert.ok(g.ball.vx > 0);
});

test("opponents still block passes before a teammate behind them can receive", () => {
  const { g, p, q, defender } = setup("BLUE", 260);
  Object.assign(defender, { x: 420, y: 350 });
  const at = start + 4300;
  tap(g, p.id, at);
  let time = at;
  for (let i = 0; i < 12 && g.ball.lastTouch !== defender.id; i++) {
    time += 1000 / 30;
    g.tick(1 / 30, time);
  }
  assert.equal(g.ball.lastTouch, defender.id);
  assert.ok(g.ball.vx < 0);
  assert.notEqual(g.ball.owner, q.id);
  assert.equal(g.ball.passFrom, null);
  assert.equal(g.ball.passes, 0);
});

test("a disconnected teammate cannot receive a pass", () => {
  const { g, p, q } = setup("BLUE", 90);
  const at = start + 4300;
  g.disconnect(q.id, at);
  tap(g, p.id, at);
  for (let i = 1; i <= 15; i++) g.tick(1 / 30, at + (i * 1000) / 30);
  assert.equal(g.ball.owner, null);
  assert.ok(g.ball.x > q.x);
  assert.equal(g.ball.passes, 0);
});

test("a teammate with another ball cannot receive a second one", () => {
  const { g, p, q } = setup("BLUE", 160);
  g.multiball = true;
  const held = g.newBall();
  Object.assign(held, {
    x: q.x + q.fx * 29,
    y: q.y,
    owner: q.id,
    heldAt: start + 4300,
  });
  g.balls.push(held);
  const ball = g.balls[0],
    at = start + 4300;
  tap(g, p.id, at);
  for (let i = 1; i <= 10; i++) g.tick(1 / 30, at + (i * 1000) / 30);
  assert.equal(held.owner, q.id);
  assert.notEqual(ball.owner, q.id);
  assert.equal(ball.passes, 0);
});

test("a pass from an additional ball receives and counts independently", () => {
  const { g, p, q } = setup();
  const ball = g.ball;
  const other = g.newBall();
  Object.assign(other, { x: 950, y: 600, possessionTeam: "ORANGE", passes: 2 });
  g.balls = [other, ball];
  g.multiball = true;
  const at = start + 4300;
  tap(g, p.id, at);
  receive(g, ball, q.id, at);
  assert.equal(ball.passes, 1);
  assert.equal(other.passes, 2);
  assert.equal(other.owner, null);
});

test("a goalkeeper receives a friendly pass and gets a fresh two-second hold", () => {
  const { g, p, q } = setup();
  Object.assign(p, { x: 220, y: 350, fx: -1 });
  Object.assign(q, { x: 65, y: 350, fx: 1, keeper: true });
  Object.assign(g.ball, { x: 191, y: 350 });
  const at = start + 4300;
  tap(g, p.id, at);
  const receivedAt = receive(g, g.ball, q.id, at);
  g.tick(1 / 30, receivedAt + 1900);
  assert.equal(g.ball.owner, q.id);
  g.tick(1 / 30, receivedAt + 2034);
  assert.equal(g.ball.owner, null);
  assert.ok(g.ball.vx > 0);
});
