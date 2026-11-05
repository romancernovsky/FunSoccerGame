import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
import { FIELD, TEAMS, type Ball } from "../src/shared";
const now = 100000;
function match(blue = 1, orange = 1, duration = 180) {
  const events: string[] = [];
  const g = new Game(
    { duration, maxTeamSize: 6, grace: 20, dev: false },
    (kind) => events.push(kind),
  );
  const identities = [];
  for (const [team, size] of [
    ["BLUE", blue],
    ["ORANGE", orange],
  ] as const)
    for (let i = 0; i < size; i++)
      identities.push(g.join(`${team} ${i}`, team, now));
  g.command("start", { confirm: true }, now);
  g.tick(0, now + 4000);
  return { g, events, identities };
}
function surprise(g: Game) {
  g.remaining = 60.01;
  g.tick(0.02, now + 5000);
  assert.equal(g.phase, "RULES_COUNTDOWN");
  assert.equal(g.remaining, 60);
}
function threeBalls(g: Game) {
  surprise(g);
  g.tick(0, g.deadline);
  assert.equal(g.phase, "PLAYING");
  assert.equal(g.balls.length, 3);
}
function ground(g: Game) {
  for (const b of g.balls) Object.assign(b, { height: 0, vz: 0 });
}
function score(g: Game, ball: Ball, left = false, at = now + 13000) {
  Object.assign(ball, {
    height: 0,
    vz: 0,
    owner: null,
    x: left ? -10 : 1210,
    y: 350,
    vx: 0,
    vy: 0,
  });
  g.tick(1 / 30, at);
}
function circle(g: Game) {
  for (const p of g.players.values())
    if (!p.keeper) {
      assert.ok(
        Math.abs(Math.hypot(p.x - 600, p.y - 350) - FIELD.centerCircleRadius) <
          1e-6,
      );
      assert.equal(p.input.x, 0);
      assert.equal(p.chargeAt, 0);
    }
}

test("01:00 freezes play at exactly sixty seconds, resets the circle and announces new rules once", () => {
  const { g, identities, events } = match(6, 6);
  g.command("pause", {}, now + 4100);
  g.command("resume", {}, now + 4200);
  const teams = [...g.players.values()].map((p) => [p.id, p.team, p.keeper]);
  const p = g.players.get(identities[0].id)!;
  Object.assign(p, {
    x: 300,
    y: 200,
    chargeAt: now + 4300,
    dashUntil: now + 6000,
  });
  g.score.BLUE = 2;
  surprise(g);
  circle(g);
  assert.deepEqual(
    [...g.players.values()].map((p) => [p.id, p.team, p.keeper]),
    teams,
  );
  assert.equal(g.score.BLUE, 2);
  assert.equal(g.balls.length, 1);
  assert.equal(g.ball.owner, null);
  assert.equal(g.deadline, now + 12000);
  g.input(p.id, { x: 1, y: 0, action: true, dash: true }, now + 6000);
  g.tick(6, now + 11999);
  circle(g);
  assert.equal(g.remaining, 60);
  assert.equal(g.phase, "RULES_COUNTDOWN");
  assert.equal(events.filter((e) => e === "final_minute").length, 1);
  assert.ok(!events.some((e) => e.startsWith("reorg")));
  assert.ok(!("reorg" in g.snapshot(now + 6000)));
});

test("seven-second countdown adds two genuinely airborne balls; landing and pause are server-owned", () => {
  const { g, events } = match();
  threeBalls(g);
  assert.equal(g.remaining, 60);
  assert.deepEqual(
    g.balls.map((b) => b.height),
    [0, 300, 300],
  );
  assert.equal(new Set(g.balls.map((b) => b.id)).size, 3);
  assert.ok(
    g.balls.every(
      (b) => Math.hypot(b.x - 600, b.y - 350) < FIELD.centerCircleRadius,
    ),
  );
  g.tick(0.1, now + 12100);
  assert.ok(g.balls[1].height < 300 && g.balls[1].height > 0);
  const height = g.balls[1].height;
  g.command("pause", {}, now + 12100);
  g.tick(5, now + 17100);
  assert.equal(g.balls[1].height, height);
  g.command("resume", {}, now + 17100);
  for (let i = 1; i <= 45; i++) g.tick(1 / 30, now + 17100 + (i * 1000) / 30);
  assert.ok(g.balls.every((b) => b.height === 0 && b.vz === 0));
  assert.ok(events.includes("balls_dropped"));
  assert.ok(
    g.snapshot(now + 18600).events!.some((e) => e.kind === "ball_landed"),
  );
});

test("host pause/resume preserves the remaining new-rules countdown across refresh/reconnect", () => {
  const { g, identities } = match();
  surprise(g);
  g.command("pause", {}, now + 7000);
  const remaining = g.remaining;
  g.tick(8, now + 15000);
  g.disconnect(identities[0].id, now + 15000);
  assert.equal(g.reconnect(identities[0].token, now + 16000), identities[0].id);
  g.command("resume", {}, now + 16000);
  assert.equal(g.deadline, now + 21000);
  g.tick(0, now + 20999);
  assert.equal(g.phase, "RULES_COUNTDOWN");
  assert.equal(g.remaining, remaining);
  g.tick(0, now + 21000);
  assert.equal(g.phase, "PLAYING");
  assert.equal(g.balls.length, 3);
});

for (const [blue, orange] of [
  [1, 1],
  [6, 4],
  [3, 5],
  [6, 6],
]) {
  test(`${blue}v${orange}: original teams and goalkeeper roles survive the surprise and reconnection`, () => {
    const { g, identities } = match(blue, orange);
    // Roles are ordinary host decisions made before a real restart.
    g.command("end", { confirm: true }, now + 4100);
    g.command("rematch_lobby", {}, now + 4200);
    for (const team of TEAMS) {
      const p = [...g.players.values()].find((p) => p.team === team)!;
      g.command("keeper", { id: p.id }, now + 4200);
    }
    const teams = [...g.players.values()].map((p) => [p.id, p.team, p.keeper]);
    g.command("start", { confirm: true }, now + 4300);
    g.tick(0, g.deadline);
    threeBalls(g);
    g.disconnect(identities[0].id, now + 13000);
    assert.equal(
      g.reconnect(identities[0].token, now + 14000),
      identities[0].id,
    );
    assert.deepEqual(
      [...g.players.values()].map((p) => [p.id, p.team, p.keeper]),
      teams,
    );
    assert.equal(g.count("BLUE"), blue);
    assert.equal(g.count("ORANGE"), orange);
  });
}

test("the first two scored balls leave play; only the third freezes play and starts another three-ball kickoff", () => {
  const { g } = match();
  threeBalls(g);
  ground(g);
  const [a, b, c] = g.balls;
  const p = [...g.players.values()][0];
  Object.assign(p, { x: 200, y: 150 });
  a.lastTouch = p.id;
  a.possessionTeam = "BLUE";
  a.passes = 3;
  const initial = g.remaining;
  score(g, a);
  assert.equal(g.score.BLUE, 1);
  assert.equal(g.celebration?.passes, 3);
  assert.equal(g.celebration?.scorer, p.name);
  assert.equal(g.phase, "PLAYING");
  assert.equal(p.x, 200);
  assert.equal(g.balls.filter((b) => !b.scored).length, 2);
  assert.ok(g.remaining < initial);
  g.goal("BLUE", now + 13001, a);
  assert.equal(g.score.BLUE, 1, "a retired ball cannot score twice");
  score(g, b, true, now + 13100);
  assert.equal(g.score.ORANGE, 1);
  assert.equal(g.phase, "PLAYING");
  assert.equal(g.balls.filter((b) => !b.scored).length, 1);
  score(g, c, false, now + 13200);
  assert.equal(g.phase, "GOAL");
  assert.equal(g.score.BLUE, 2);
  const frozen = g.remaining;
  g.tick(2, now + 15200);
  assert.equal(g.remaining, frozen);
  g.tick(0, g.deadline);
  assert.equal(g.phase, "KICKOFF_COUNTDOWN");
  circle(g);
  g.tick(0, g.deadline);
  assert.equal(g.phase, "PLAYING");
  assert.equal(g.balls.length, 3);
  assert.ok(g.balls.every((b) => !b.scored));
  assert.deepEqual(
    g.balls.map((b) => b.height),
    [0, 300, 300],
  );
});

test("all three goals in the same tick are counted once before resetting", () => {
  const { g } = match();
  threeBalls(g);
  ground(g);
  for (const b of g.balls) Object.assign(b, { x: 1210, y: 350 });
  g.tick(1 / 30, now + 13000);
  assert.equal(g.score.BLUE, 3);
  assert.equal(g.phase, "GOAL");
  g.tick(1 / 30, now + 13034);
  assert.equal(g.score.BLUE, 3);
});

test("each owned ball moves independently and a player can control only one ball", () => {
  const { g, identities } = match();
  threeBalls(g);
  ground(g);
  const p = g.players.get(identities[0].id)!;
  const q = g.players.get(identities[1].id)!;
  Object.assign(p, { x: 300, y: 250 });
  Object.assign(q, { x: 900, y: 450 });
  Object.assign(g.balls[0], {
    x: 329,
    y: 250,
    owner: p.id,
    heldAt: now + 12000,
  });
  Object.assign(g.balls[1], {
    x: 871,
    y: 450,
    owner: q.id,
    heldAt: now + 12000,
  });
  Object.assign(g.balls[2], { x: 300, y: 250 });
  g.tick(1 / 30, now + 12100);
  assert.equal(g.balls[0].owner, p.id);
  assert.equal(
    g.balls[1].owner,
    q.id,
    "simulation must not return after the first owner's ball",
  );
  assert.equal(g.balls[2].owner, null);
  g.input(q.id, { x: 0, y: 0, action: true, dash: false }, now + 12200);
  g.input(q.id, { x: 0, y: 0, action: false, dash: false }, now + 13200);
  assert.equal(g.balls[0].owner, p.id);
  assert.equal(g.balls[1].owner, null);
  assert.ok(g.balls[1].vx < -1000, "shoot the player's own additional ball");
});

test("falling balls cannot be collected or score before landing", () => {
  const { g } = match();
  threeBalls(g);
  const p = [...g.players.values()][0];
  const b = g.balls[1];
  Object.assign(p, { x: b.x, y: b.y });
  g.tick(1 / 30, now + 12034);
  assert.equal(b.owner, null);
  Object.assign(b, { x: 1210, y: 350 });
  g.tick(1 / 30, now + 12068);
  assert.equal(g.score.BLUE, 0);
});

test("additional balls use full crossing detection, player deflections and independent pass sequences", () => {
  const { g, identities } = match();
  threeBalls(g);
  ground(g);
  const p = g.players.get(identities[1].id)!;
  Object.assign(p, { x: 600, y: 350 });
  Object.assign(g.balls[0], {
    x: 100,
    y: 100,
    possessionTeam: "BLUE",
    passes: 3,
  });
  const b = g.balls[1];
  Object.assign(b, { x: 550, y: 350, vx: 1090 });
  g.tick(0.05, now + 12050);
  assert.ok(b.vx < 0);
  assert.equal(b.lastTouch, p.id);
  assert.equal(b.possessionTeam, "ORANGE");
  assert.equal(g.balls[0].passes, 3);
  Object.assign(b, { x: 1208, y: 350, vx: 0, vy: 0 });
  g.tick(1 / 30, now + 13000);
  assert.equal(g.score.BLUE, 0);
  b.x = 1210;
  g.tick(1 / 30, now + 13034);
  assert.equal(g.score.BLUE, 1);
  assert.equal(
    g.celebration?.passes,
    0,
    "another ball's passes cannot make a Team Goal",
  );
});

test("regulation still ends at zero with balls left; Golden Goal ends on the very next ball", () => {
  const { g } = match();
  threeBalls(g);
  ground(g);
  g.score.BLUE = 1;
  g.remaining = 0.01;
  g.tick(0.02, now + 13000);
  assert.equal(g.phase, "FINISHED");
  const { g: tied } = match();
  threeBalls(tied);
  ground(tied);
  tied.remaining = 0.01;
  tied.tick(0.02, now + 13000);
  assert.equal(tied.phase, "GOLDEN_GOAL");
  Object.assign(tied.balls[0], { x: -10, y: 350 });
  Object.assign(tied.balls[1], { x: 1210, y: 350 });
  tied.tick(1 / 30, now + 13100);
  assert.equal(tied.score.ORANGE, 1);
  assert.equal(tied.score.BLUE, 0);
  assert.equal(tied.phase, "GOAL");
  tied.tick(0, tied.deadline);
  assert.equal(tied.phase, "FINISHED");
});

test("three minutes include 180 active seconds plus the seven-second rules countdown", () => {
  const { g, events } = match();
  g.score.BLUE = 1;
  let at = now + 4000;
  for (let active = 1; active <= 180; active++) {
    at += 1000;
    g.tick(1, at);
    assert.equal(g.remaining, 180 - active);
    if (active === 120) {
      for (let frozen = 0; frozen < 7; frozen++) {
        at += 1000;
        g.tick(1, at);
        assert.equal(g.remaining, 60);
      }
      assert.equal(g.phase, "PLAYING");
    }
  }
  assert.equal(g.phase, "FINISHED");
  assert.equal(events.filter((e) => e === "final_minute").length, 1);
});

test("restart/rematch rearm the surprise and restore one ball; new match clears everything", () => {
  const { g, events } = match();
  threeBalls(g);
  const teams = [...g.players.values()].map((p) => [p.id, p.team, p.keeper]);
  g.command("restart", { confirm: true }, now + 13000);
  assert.equal(g.multiball, false);
  assert.equal(g.balls.length, 1);
  assert.equal(g.remaining, 180);
  g.tick(0, g.deadline);
  threeBalls(g);
  assert.equal(events.filter((e) => e === "final_minute").length, 2);
  g.command("end", { confirm: true }, now + 20000);
  g.command("rematch", {}, now + 21000);
  assert.equal(g.multiball, false);
  assert.equal(g.balls.length, 1);
  assert.deepEqual(
    [...g.players.values()].map((p) => [p.id, p.team, p.keeper]),
    teams,
  );
  g.command("end", { confirm: true }, now + 22000);
  g.command("new", {}, now + 23000);
  assert.equal(g.players.size, 0);
  assert.equal(g.multiball, false);
});

test("custom matches of sixty seconds or less keep ordinary football rules", () => {
  const { g } = match(1, 1, 60);
  g.tick(0.1, now + 4100);
  assert.equal(g.phase, "PLAYING");
  assert.equal(g.multiball, false);
  assert.equal(g.balls.length, 1);
});

test("goalkeeper hold limits apply to an additional ball without releasing another player's ball", () => {
  const { g, identities } = match();
  threeBalls(g);
  ground(g);
  const keeper = g.players.get(identities[0].id)!;
  const field = g.players.get(identities[1].id)!;
  Object.assign(keeper, { keeper: true, x: 65, y: 350 });
  Object.assign(field, { x: 800, y: 500 });
  Object.assign(g.balls[0], {
    x: 771,
    y: 500,
    owner: field.id,
    heldAt: now + 14000,
  });
  Object.assign(g.balls[1], {
    x: 94,
    y: 350,
    owner: keeper.id,
    heldAt: now + 12000,
  });
  g.tick(1 / 30, now + 14034);
  assert.equal(g.balls[1].owner, null);
  assert.ok(g.balls[1].vx > 0);
  assert.equal(g.balls[0].owner, field.id);
});

test("twelve simulated players complete repeated three-ball rounds without invalid or duplicate possession", () => {
  const g = new Game({ duration: 180, maxTeamSize: 6, grace: 20, dev: true });
  g.command("bots", {}, 1000);
  g.command("start", {}, 1000);
  g.tick(0, 5000);
  g.remaining = 60.01;
  g.tick(0.02, 5034);
  g.tick(0, g.deadline);
  let at = g.deadline;
  const liveCounts = new Set<number>();
  for (let i = 0; i < 2700; i++) {
    at += 1000 / 30;
    g.tick(1 / 30, at);
    liveCounts.add(g.balls.filter((b) => !b.scored).length);
    const owners = g.balls
      .filter((b) => !b.scored && b.owner)
      .map((b) => b.owner);
    assert.equal(owners.length, new Set(owners).size);
    assert.ok(
      g.balls.every((b) =>
        [b.x, b.y, b.vx, b.vy, b.height].every(Number.isFinite),
      ),
    );
  }
  assert.deepEqual([...liveCounts].sort(), [0, 1, 2, 3]);
  assert.ok(
    g.score.BLUE + g.score.ORANGE >= 6,
    "at least two complete multiball rounds",
  );
  assert.equal(g.phase, "FINISHED");
  assert.equal(g.players.size, 12);
});

test("the new-rules countdown ends with a fresh centred kickoff and neutral movement, charge and dash", () => {
  const { g, identities } = match(6, 6);
  const p = g.players.get(identities[0].id)!;
  Object.assign(p, {
    x: 800,
    y: 500,
    fx: -1,
    fy: 0,
    chargeAt: now + 4500,
    dashUntil: now + 15000,
  });
  Object.assign(g.ball, {
    x: 771,
    y: 500,
    owner: p.id,
    lastTouch: p.id,
    possessionTeam: p.team,
    passes: 3,
  });
  surprise(g);
  const countdownBall = g.ball.id;
  g.input(p.id, { x: 1, y: 0, action: true, dash: true }, g.deadline - 1);
  g.tick(0, g.deadline);
  assert.equal(g.phase, "PLAYING");
  assert.equal(g.remaining, 60);
  circle(g);
  assert.equal(g.balls.length, 3);
  assert.notEqual(g.ball.id, countdownBall);
  assert.deepEqual([g.ball.x, g.ball.y], [600, 350]);
  assert.ok(g.balls.every((b) => !b.owner && !b.lastTouch && b.passes === 0));
  assert.ok(
    [...g.players.values()].every(
      (p) =>
        !p.input.x &&
        !p.input.y &&
        !p.input.action &&
        !p.input.dash &&
        !p.chargeAt &&
        !p.dashUntil,
    ),
  );
});
