import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
const now = 100000;
const game = () =>
  new Game({ duration: 180, maxTeamSize: 6, grace: 20, dev: true });
function pair(g = game()) {
  const a = g.join("Alex", "BLUE", now),
    b = g.join("Sam", "ORANGE", now);
  return { g, a, b };
}
function playing() {
  const x = pair();
  x.g.command("start", { confirm: true }, now);
  x.g.tick(0, now + 4000);
  return x;
}
test("validates names, duplicate normalization, team and maximum size", () => {
  const g = game();
  for (const n of ["", "   ", "<script>", "a".repeat(13)])
    assert.throws(() => g.join(n, "BLUE", now));
  g.join("Alex", "BLUE", now);
  assert.throws(() => g.join(" alex ", "ORANGE", now), /taken/);
  assert.throws(() => g.join("OK", "OTHER", now));
  for (let i = 0; i < 5; i++) g.join(`Player ${i}`, "BLUE", now);
  assert.throws(() => g.join("Seventh", "BLUE", now), /full/);
  assert.equal(g.phase, "WAITING");
});
test("empty side blocks start even with override", () => {
  const g = game();
  g.join("Alex", "BLUE", now);
  assert.throws(() => g.command("start", { confirm: true }, now), /Both teams/);
});
test("incomplete and uneven teams require explicit override", () => {
  const { g } = pair();
  g.join("Lee", "BLUE", now);
  assert.throws(() => g.command("start", {}, now), /incomplete/);
  g.command("start", { confirm: true }, now);
  assert.equal(g.phase, "COUNTDOWN");
  assert.throws(() => g.join("Late", "ORANGE", now), /PROGRESS/);
});
test("full teams start without confirmation and never auto-start", () => {
  const g = game();
  g.command("bots", {}, now);
  assert.equal(g.players.size, 12);
  assert.equal(g.phase, "WAITING");
  g.command("start", {}, now);
  assert.equal(g.phase, "COUNTDOWN");
});
test("goalkeeper is optional, unique per team, transferable and toggleable", () => {
  const { g, a } = pair();
  const c = g.join("Lee", "BLUE", now);
  g.command("keeper", { id: a.id }, now);
  g.command("keeper", { id: c.id }, now);
  assert.equal(g.players.get(a.id)!.keeper, false);
  assert.equal(g.players.get(c.id)!.keeper, true);
  g.command("move", { id: c.id }, now);
  assert.equal(g.players.get(c.id)!.keeper, false);
  g.command("start", { confirm: true }, now);
  assert.equal(g.phase, "COUNTDOWN");
});
test("team movement cannot exceed capacity", () => {
  const { g, a } = pair();
  for (let i = 0; i < 5; i++) g.join(`W${i}`, "ORANGE", now);
  assert.throws(() => g.command("move", { id: a.id }, now), /full/);
});
test("server countdown, timer and pause freeze simulation", () => {
  const { g, a } = playing();
  g.input(a.id, { x: 1, y: 0, action: false, dash: false }, now + 4000);
  g.tick(0.1, now + 4100);
  assert.equal(g.remaining, g.config.duration - 0.1);
  const x = g.players.get(a.id)!.x;
  g.command("pause", {}, now + 4100);
  g.tick(5, now + 9100);
  assert.equal(g.remaining, g.config.duration - 0.1);
  assert.equal(g.players.get(a.id)!.x, x);
  g.command("resume", {}, now + 9100);
  g.tick(0.1, now + 9200);
  assert.ok(Math.abs(g.remaining - (g.config.duration - 0.2)) < 0.0001);
});
test("goals require entire ball to cross within opening; celebration freezes clock", () => {
  const { g } = playing();
  Object.assign(g.ball, { x: 1208, y: 350, vx: 0 });
  g.tick(0.01, now + 4100);
  assert.equal(g.score.BLUE, 0);
  g.ball.x = 1210;
  g.tick(0.01, now + 4200);
  assert.equal(g.score.BLUE, 1);
  assert.equal(g.phase, "GOAL");
  const remaining = g.remaining;
  g.tick(1, now + 5000);
  assert.equal(g.remaining, remaining);
  g.tick(0, now + 7200);
  assert.equal(g.phase, "KICKOFF_COUNTDOWN");
  assert.equal(g.ball.x, 600);
  g.tick(0, now + 10200);
  assert.equal(g.phase, "PLAYING");
});
test("ball bounces outside goal mouth", () => {
  const { g } = playing();
  Object.assign(g.ball, { x: 1198, y: 100, vx: 200 });
  g.tick(0.1, now + 4100);
  assert.equal(g.score.BLUE, 0);
  assert.ok(g.ball.vx < 0);
});
test("tie becomes Golden Goal and next goal finishes", () => {
  const { g } = playing();
  g.remaining = 0.01;
  g.tick(0.02, now + 4100);
  assert.equal(g.phase, "GOLDEN_GOAL");
  Object.assign(g.ball, { x: -10, y: 350, vx: 0 });
  g.tick(0.01, now + 4200);
  assert.equal(g.phase, "GOAL");
  assert.equal(g.score.ORANGE, 1);
  g.tick(0, now + 7200);
  assert.equal(g.phase, "FINISHED");
});
test("non-tie finishes at regulation time", () => {
  const { g } = playing();
  g.score.BLUE = 1;
  g.remaining = 0.01;
  g.tick(0.02, now + 4100);
  assert.equal(g.phase, "FINISHED");
});
test("reconnection restores identity within grace and expires after", () => {
  const { g, a } = pair();
  g.disconnect(a.id, now);
  assert.equal(g.reconnect(a.token, now + 19000), a.id);
  g.disconnect(a.id, now + 20000);
  g.tick(0, now + 41001);
  assert.equal(g.reconnect(a.token, now + 41001), null);
  assert.equal(g.players.has(a.id), false);
});
test("stale input and disconnects stop player motion", () => {
  const { g, a } = playing();
  g.input(a.id, { x: 1, y: 0, action: false, dash: false }, now + 4000);
  const p = g.players.get(a.id)!,
    x = p.x;
  g.tick(0.1, now + 4500);
  assert.equal(p.x, x);
  g.disconnect(a.id, now + 4600);
  g.tick(0.1, now + 4700);
  assert.equal(p.x, x);
});
test("rematch keeps names and roles, new match clears them", () => {
  const { g, a } = pair();
  g.command("keeper", { id: a.id }, now);
  g.command("start", { confirm: true }, now);
  g.score.BLUE = 3;
  g.command("end", { confirm: true }, now);
  g.command("rematch", {}, now);
  assert.equal(g.players.size, 2);
  assert.equal(g.players.get(a.id)!.keeper, true);
  assert.equal(g.score.BLUE, 0);
  assert.equal(g.remaining, 180);
  g.command("end", { confirm: true }, now);
  g.command("new", {}, now);
  assert.equal(g.players.size, 0);
  assert.equal(g.sessions.size, 0);
  assert.equal(g.phase, "WAITING");
});
test("invalid inputs cannot move players or manufacture charge", () => {
  const { g, a } = playing();
  g.input(a.id, { x: 999, y: NaN, action: true, dash: true }, now + 4000);
  assert.equal(g.players.get(a.id)!.input.x, 0);
  assert.equal(g.players.get(a.id)!.chargeAt, 0);
});
test("three real teammate passes qualify for Team Goal", () => {
  const { g, a } = pair();
  const c = g.join("Lee", "BLUE", now);
  g.command("start", { confirm: true }, now);
  g.tick(0, now + 4000);
  const p = g.players.get(a.id)!,
    q = g.players.get(c.id)!;
  Object.assign(p, { x: 300, y: 350, fx: 1, fy: 0 });
  Object.assign(q, { x: 500, y: 350, fx: -1, fy: 0 });
  g.possessionTeam = "BLUE";
  g.ball.owner = p.id;
  let time = now + 4100;
  for (let i = 0; i < 3; i++) {
    const passer = i % 2 === 0 ? p : q,
      receiver = i % 2 === 0 ? q : p;
    Object.assign(p, { x: 300, y: 350, fx: 1, fy: 0 });
    Object.assign(q, { x: 500, y: 350, fx: -1, fy: 0 });
    g.input(passer.id, { x: 0, y: 0, action: false, dash: false }, time);
    g.ball.owner = passer.id;
    g.ball.x = passer.x + passer.fx * 29;
    g.ball.y = 350;
    g.release(0.1, time);
    // The receiver runs onto the real pass, controls its rebound and keeps the
    // sequence alive. Do not teleport a fast ball into automatic possession.
    for (let tick = 0; tick < 120 && g.ball.owner !== receiver.id; tick++) {
      time += 1000 / 30;
      const dx = g.ball.x - receiver.x,
        dy = g.ball.y - receiver.y,
        distance = Math.max(30, Math.hypot(dx, dy));
      g.input(
        receiver.id,
        { x: dx / distance, y: dy / distance, action: false, dash: false },
        time,
      );
      g.tick(1 / 30, time);
    }
    assert.equal(g.ball.owner, receiver.id);
  }
  assert.equal(g.passes, 3);
  g.ball.owner = null;
  g.ball.x = 1210;
  g.ball.y = 350;
  g.ball.lastTouch = q.id;
  g.tick(0.01, now + 7500);
  assert.equal(g.celebration?.passes, 3);
  assert.equal(g.celebration?.scorer, "Lee");
});
test("pass, charged shot and dash are calculated by server", () => {
  const { g, a } = playing();
  const p = g.players.get(a.id)!;
  g.ball.owner = p.id;
  g.ball.x = p.x + 29;
  g.input(a.id, { x: 0, y: 0, action: true, dash: true }, now + 4100);
  assert.equal(p.dashReady, now + 6600);
  g.input(a.id, { x: 0, y: 0, action: false, dash: false }, now + 4200);
  const passSpeed = Math.hypot(g.ball.vx, g.ball.vy);
  assert.equal(g.ball.owner, null);
  g.ball.owner = p.id;
  g.input(a.id, { x: 0, y: 0, action: true, dash: true }, now + 4300);
  assert.equal(p.dashReady, now + 6600);
  g.input(a.id, { x: 0, y: 0, action: false, dash: false }, now + 5300);
  assert.ok(Math.hypot(g.ball.vx, g.ball.vy) > passSpeed);
});
test("keeper auto-releases after two seconds inside goal area", () => {
  const { g, a } = playing();
  const p = g.players.get(a.id)!;
  Object.assign(p, { keeper: true, x: 65, y: 350 });
  Object.assign(g.ball, { owner: p.id, x: 94, y: 350, heldAt: now + 4000 });
  g.tick(0.01, now + 6010);
  assert.equal(g.ball.owner, null);
  assert.ok(g.ball.vx > 0);
});
test("contact gives a brief pickup grace then transfers possession without wall pinning", () => {
  const { g, a, b } = playing();
  const p = g.players.get(a.id)!,
    q = g.players.get(b.id)!;
  Object.assign(p, { x: 500, y: 350 });
  Object.assign(q, { x: 542, y: 350 });
  Object.assign(g.ball, {
    owner: a.id,
    lastTouch: a.id,
    heldAt: now + 4000,
    x: 529,
    y: 350,
  });
  g.possessionTeam = "BLUE";
  g.passes = 3;
  g.tick(0.01, now + 4200);
  assert.equal(g.ball.owner, a.id);
  g.tick(0.01, now + 4600);
  assert.equal(g.ball.owner, b.id);
  assert.equal(g.ball.lastTouch, b.id);
  assert.equal(g.passes, 0);
  assert.equal(g.ball.vx, 0);
});
test("test players keep support lanes and can produce real goals", () => {
  const g = game();
  g.command("bots", {}, now);
  g.command("start", {}, now);
  for (let i = 0; i < 1800; i++) g.tick(1 / 30, now + 4000 + (i * 1000) / 30);
  assert.ok(g.score.BLUE + g.score.ORANGE > 0);
  const ys = [...g.players.values()].map((p) => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 200);
});
test("a stalled input freezes movement without dropping an explicit shot release", () => {
  const { g, a } = playing(),
    p = g.players.get(a.id)!;
  g.ball.owner = a.id;
  g.ball.heldAt = now + 4000;
  g.input(a.id, { x: 1, y: 0, action: true, dash: false }, now + 4100);
  const x = p.x;
  g.tick(0.1, now + 5300);
  assert.equal(p.x, x);
  assert.equal(g.ball.owner, a.id);
  assert.ok(p.chargeAt > 0);
  g.input(a.id, { x: 0, y: 0, action: false, dash: false }, now + 5400);
  assert.equal(g.ball.owner, null);
  assert.ok(g.ball.vx > 1000);
});
