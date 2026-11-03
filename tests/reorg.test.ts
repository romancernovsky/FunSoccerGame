import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
import { REORG, TEAMS } from "../src/shared";
const now = 100000;
function match(leaders = 6, workers = 6, duration = 300) {
  const g = new Game({ duration, maxTeamSize: 6, grace: 20, dev: true }),
    identities = [];
  for (const [team, n] of [
    ["LEADERS", leaders],
    ["WORKERS", workers],
  ] as const)
    for (let i = 0; i < n; i++)
      identities.push(g.join(`${team[0]}${i}`, team, now));
  g.command("start", { confirm: true }, now);
  g.tick(0, now + 4000);
  return { g, identities };
}
function trigger(g: Game, t = now + 5000) {
  g.remaining = 120.01;
  g.tick(0.02, t);
}
test("Reorg triggers once at exactly 02:00, freezes clock and physics, preserves score", () => {
  const { g } = match();
  g.score = { LEADERS: 2, WORKERS: 3 };
  g.ball.vx = 700;
  trigger(g);
  assert.equal(g.phase, "REORG");
  assert.equal(g.remaining, 120);
  assert.deepEqual(g.score, { LEADERS: 2, WORKERS: 3 });
  assert.equal(g.ball.x, 600);
  assert.equal(g.ball.vx, 0);
  assert.equal(g.ball.owner, null);
  const positions = [...g.players.values()].map((p) => [p.x, p.y]);
  g.tick(4, now + 6000);
  assert.equal(g.remaining, 120);
  assert.deepEqual(
    [...g.players.values()].map((p) => [p.x, p.y]),
    positions,
  );
  assert.equal(g.reorgDone, true);
  g.tick(0, now + 5000 + REORG.revealSeconds * 1000);
  assert.equal(g.phase, "KICKOFF_COUNTDOWN");
  assert.equal(g.remaining, 120);
  g.tick(0, g.deadline);
  assert.equal(g.phase, "PLAYING");
  g.tick(0.1, g.deadline + 100);
  assert.ok(g.remaining < 120);
  assert.equal(g.reorg?.assignments.length, 12);
  g.remaining = 121;
  g.tick(2, g.deadline + 200);
  assert.equal(g.phase, "PLAYING");
});
test("random remix preserves team sizes and capacity, and never leaves everyone unchanged", () => {
  for (let run = 0; run < 60; run++) {
    const { g } = match(6, 4),
      before = new Map([...g.players.values()].map((p) => [p.id, p.team]));
    trigger(g);
    assert.equal(g.count("LEADERS"), 6);
    assert.equal(g.count("WORKERS"), 4);
    assert.ok([...g.players.values()].some((p) => before.get(p.id) !== p.team));
    assert.equal(g.reorg!.assignments.length, 10);
    for (const a of g.reorg!.assignments) {
      assert.equal(a.fromTeam, before.get(a.id));
      assert.equal(a.team, g.players.get(a.id)!.team);
    }
  }
});
test("1v1 exchanges sides and session tokens reconnect to the same identity in the new team", () => {
  const {
    g,
    identities: [a, b],
  } = match(1, 1);
  trigger(g);
  assert.equal(g.players.get(a.id)!.team, "WORKERS");
  assert.equal(g.players.get(b.id)!.team, "LEADERS");
  g.disconnect(a.id, now + 5100);
  assert.equal(g.reconnect(a.token, now + 6000), a.id);
  assert.equal(g.players.get(a.id)!.team, "WORKERS");
  assert.equal(
    g.snapshot(now + 6000).reorg!.assignments.find((p) => p.id === a.id)!.team,
    "WORKERS",
  );
  assert.equal(g.players.size, 2);
});
test("existing goalkeeper slots are preserved with at most one keeper per new team", () => {
  for (let run = 0; run < 25; run++) {
    const { g } = match(),
      players = [...g.players.values()];
    players[0].keeper = true;
    players[6].keeper = true;
    trigger(g);
    for (const team of TEAMS)
      assert.equal(
        [...g.players.values()].filter((p) => p.team === team && p.keeper)
          .length,
        1,
      );
  }
  const { g } = match();
  [...g.players.values()][0].keeper = true;
  trigger(g);
  assert.equal(
    [...g.players.values()].filter((p) => p.team === "LEADERS" && p.keeper)
      .length,
    1,
  );
  assert.equal(
    [...g.players.values()].filter((p) => p.team === "WORKERS" && p.keeper)
      .length,
    0,
  );
  const noKeeper = match().g;
  trigger(noKeeper);
  assert.ok([...noKeeper.players.values()].every((p) => !p.keeper));
});
test("both connected sides remain playable despite reserved disconnected slots", () => {
  for (let run = 0; run < 50; run++) {
    const { g } = match();
    for (const team of TEAMS) {
      const ps = [...g.players.values()].filter((p) => p.team === team);
      ps.slice(1).forEach((p) => g.disconnect(p.id, now + 4500));
    }
    trigger(g);
    assert.ok(g.count("LEADERS", true) > 0);
    assert.ok(g.count("WORKERS", true) > 0);
    assert.equal(g.players.size, 12);
  }
});
test("host pause and resume preserve the remaining reveal time and cannot retrigger Reorg", () => {
  const { g } = match(1, 1);
  trigger(g);
  g.command("pause", {}, now + 8000);
  assert.equal(g.phase, "PAUSED");
  g.tick(10, now + 18000);
  assert.equal(g.remaining, 120);
  g.command("resume", {}, now + 18000);
  assert.equal(g.phase, "REORG");
  assert.equal(g.deadline, now + 27000);
  g.tick(0, now + 26999);
  assert.equal(g.phase, "REORG");
  g.tick(0, now + 27000);
  assert.equal(g.phase, "KICKOFF_COUNTDOWN");
});
test("Reorg blocks player input and administrative roster edits while preserving identities", () => {
  const {
    g,
    identities: [a],
  } = match(1, 1);
  g.possessionTeam = "LEADERS";
  g.passes = 4;
  g.passFrom = a.id;
  g.players.get(a.id)!.chargeAt = now;
  trigger(g);
  g.input(a.id, { x: 1, y: 1, action: true, dash: true }, now + 5200);
  assert.deepEqual(g.players.get(a.id)!.input, {
    x: 0,
    y: 0,
    action: false,
    dash: false,
  });
  assert.equal(g.players.get(a.id)!.chargeAt, 0);
  assert.equal(g.passes, 0);
  assert.equal(g.passFrom, null);
  assert.equal(g.possessionTeam, null);
  assert.throws(() => g.join("Late", "LEADERS", now + 5200), /PROGRESS/);
  assert.throws(() => g.command("move", { id: a.id }, now + 5200), /lobby/);
  assert.equal(g.players.get(a.id)!.name, "L0");
});
test("new matches, restarts and rematches reset the surprise; Golden Goal and short matches skip it", () => {
  const { g } = match(1, 1);
  trigger(g);
  g.command("restart", { confirm: true }, now + 6000);
  assert.equal(g.reorgDone, false);
  assert.equal(g.reorg, null);
  assert.equal(g.remaining, 300);
  g.tick(0, g.deadline);
  trigger(g, now + 12000);
  g.command("end", { confirm: true }, now + 13000);
  g.command("rematch", {}, now + 14000);
  assert.equal(g.reorgDone, false);
  assert.equal(g.reorg, null);
  g.command("end", { confirm: true }, now + 15000);
  g.command("new", {}, now + 16000);
  assert.equal(g.reorg, null);
  assert.equal(g.players.size, 0);
  const short = match(1, 1, 120).g;
  short.tick(0.1, now + 5000);
  assert.equal(short.phase, "PLAYING");
  assert.equal(short.reorg, null);
  const golden = match(1, 1).g;
  golden.phase = "GOLDEN_GOAL";
  golden.golden = true;
  golden.remaining = 121;
  golden.tick(2, now + 5000);
  assert.equal(golden.phase, "GOLDEN_GOAL");
  assert.equal(golden.reorg, null);
});
