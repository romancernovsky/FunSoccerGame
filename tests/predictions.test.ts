import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
import { Predictions, PredictionError } from "../server/predictions";
const now = 100000;
function match() {
  const g = new Game({ duration: 180, maxTeamSize: 6, grace: 20, dev: true });
  g.join("Alex", "BLUE", now);
  g.join("Sam", "ORANGE", now);
  return g;
}
function choose(g: Game, token = "audience", team = "BLUE", at = now) {
  g.predictions.choose(token, team, g.predictions.roundId, at, g.phase);
}
function summary(g: Game) {
  return g.snapshot(now).predictions;
}

test("audience can pick with full teams, without taking a slot or starting the game", () => {
  const g = match();
  g.command("bots", {}, now);
  for (let i = 0; i < 100; i++)
    choose(g, `viewer${i}`, i % 2 ? "BLUE" : "ORANGE");
  assert.equal(g.players.size, 12);
  assert.equal(g.phase, "WAITING");
  assert.deepEqual(summary(g).totals, { BLUE: 50, ORANGE: 50 });
  assert.equal(summary(g).open, true);
  assert.equal(JSON.stringify(g.snapshot(now)).includes("viewer1"), false);
});
test("one pick per identity, repeat is idempotent, changes replace and malformed picks fail", () => {
  const g = match();
  choose(g);
  choose(g);
  assert.equal(summary(g).total, 1);
  choose(g, "audience", "ORANGE", now + 1);
  choose(g, "audience", "BLUE", now + 2);
  choose(g, "audience", "ORANGE", now + 3);
  choose(g, "audience", "BLUE", now + 4);
  assert.throws(
    () => choose(g, "audience", "ORANGE", now + 5),
    (e: unknown) => e instanceof PredictionError && e.status === 429,
  );
  choose(g, "audience", "ORANGE", now + 1001);
  assert.equal(g.predictions.pick("audience"), "ORANGE");
  assert.deepEqual(summary(g).totals, { BLUE: 0, ORANGE: 1 });
  for (const bad of [null, {}, "DRAW", "<script>", 1])
    assert.throws(() =>
      g.predictions.choose("other", bad, g.predictions.roundId, now, g.phase),
    );
  assert.throws(
    () => g.predictions.choose("other", "BLUE", "old-round", now, g.phase),
    /new betting round/,
  );
});
test("only successful host start locks picks; pause and restart cannot reopen them", () => {
  const g = match();
  choose(g);
  assert.throws(() => g.command("start", {}, now), /incomplete/);
  assert.equal(summary(g).open, true);
  g.command("start", { confirm: true }, now);
  assert.equal(summary(g).open, false);
  assert.throws(() => choose(g, "late"), /locked/);
  g.command("pause", {}, now + 100);
  assert.throws(() => choose(g, "late"), /locked/);
  g.command("resume", {}, now + 200);
  g.command("restart", { confirm: true }, now + 300);
  assert.equal(g.predictions.pick("audience"), "BLUE");
  assert.equal(summary(g).open, false);
});
test("final minute keeps team bets unchanged; Golden Goal stays pending until full time", () => {
  const g = match();
  choose(g);
  g.command("start", { confirm: true }, now);
  g.tick(0, now + 4000);
  g.remaining = 60.01;
  g.tick(0.02, now + 4020);
  assert.equal(g.phase, "RULES_COUNTDOWN");
  g.tick(0, g.deadline);
  assert.equal(g.balls.length, 3);
  assert.equal(g.predictions.pick("audience"), "BLUE");
  assert.equal(summary(g).total, 1);
  g.phase = "GOLDEN_GOAL";
  g.golden = true;
  assert.equal(summary(g).outcome, "PENDING");
  g.goal("BLUE", now + 5000);
  assert.equal(summary(g).outcome, "PENDING");
  g.tick(0, now + 8001);
  assert.equal(g.phase, "FINISHED");
  assert.equal(summary(g).winner, "BLUE");
  assert.equal(summary(g).outcome, "SETTLED");
});
test("host-ended match has no prediction winners even if a team leads", () => {
  const g = match();
  choose(g);
  g.command("start", { confirm: true }, now);
  g.score.BLUE = 2;
  g.command("end", { confirm: true }, now + 1);
  assert.equal(summary(g).outcome, "VOID");
  assert.equal(summary(g).winner, null);
});
test("rematch lobby retains players and roles, clears picks and waits for the host", () => {
  const g = match();
  const keeper = [...g.players.keys()][0];
  g.command("keeper", { id: keeper }, now);
  choose(g);
  g.command("start", { confirm: true }, now);
  g.score.BLUE = 1;
  g.finish();
  const oldRound = summary(g).roundId;
  g.command("rematch_lobby", {}, now + 10);
  assert.equal(g.phase, "WAITING");
  assert.equal(g.players.size, 2);
  assert.equal(g.players.get(keeper)!.keeper, true);
  assert.equal(summary(g).total, 0);
  assert.equal(summary(g).open, true);
  assert.notEqual(summary(g).roundId, oldRound);
  assert.deepEqual(g.score, { BLUE: 0, ORANGE: 0 });
  choose(g, "audience", "ORANGE");
  assert.equal(summary(g).total, 1);
  assert.throws(() => g.command("rematch_lobby", {}, now), /Finish/);
});
test("new match and lobby reset clear picks; quick rematch retains locked team picks", () => {
  const g = match();
  choose(g);
  const original = summary(g).roundId;
  g.command("start", { confirm: true }, now);
  g.finish();
  g.command("rematch", {}, now + 1);
  assert.equal(g.predictions.pick("audience"), "BLUE");
  assert.equal(summary(g).open, false);
  g.finish();
  g.command("new", {}, now + 2);
  assert.equal(g.players.size, 0);
  assert.equal(summary(g).total, 0);
  assert.notEqual(summary(g).roundId, original);
  assert.equal(summary(g).open, true);
  choose(g);
  g.command("reset", {}, now + 3);
  assert.equal(summary(g).total, 0);
});
test("temporary prediction memory is bounded and existing viewers can still change picks", () => {
  const p = new Predictions();
  for (let i = 0; i < 5000; i++)
    p.choose(`v${i}`, "BLUE", p.roundId, now, "WAITING");
  assert.throws(
    () => p.choose("overflow", "BLUE", p.roundId, now, "WAITING"),
    (e: unknown) => e instanceof PredictionError && e.status === 503,
  );
  p.choose("v0", "ORANGE", p.roundId, now + 501, "WAITING");
  assert.equal(p.summary("WAITING", { BLUE: 0, ORANGE: 0 }, false).total, 5000);
});
