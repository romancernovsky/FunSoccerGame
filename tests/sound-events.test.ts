import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";

function setup() {
  const g = new Game();
  const a = g.join("Alex", "BLUE", 1000);
  g.join("Sam", "ORANGE", 1000);
  g.command("start", { confirm: true }, 1000);
  g.tick(0, 5000);
  return { g, a };
}
test("simultaneous real dash, charge and pass cues survive in one snapshot", () => {
  const { g, a } = setup();
  g.ball.owner = a.id;
  g.input(a.id, { x: 1, y: 0, action: true, dash: true }, 5100);
  g.input(a.id, { x: 1, y: 0, action: false, dash: false }, 5200);
  const events = g.snapshot(5200).events!;
  assert.deepEqual(
    events.filter((e) => e.at >= 5100).map((e) => e.kind),
    ["shot_charge", "dash", "pass"],
  );
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  g.input(a.id, { x: 1, y: 0, action: false, dash: true }, 5300);
  assert.equal(
    g.snapshot(5300).events!.filter((e) => e.kind === "dash").length,
    1,
  );
});
test("cue history is bounded, expires and is omitted from player snapshots", () => {
  const { g } = setup();
  for (let i = 0; i < 50; i++) g.emit("test");
  assert.equal(g.snapshot(5000).events!.length, 32);
  assert.equal(g.snapshot(6501).events!.length, 0);
  assert.equal(g.snapshot(5000, false).events, undefined);
  g.command("end", { confirm: true }, 6600);
  g.command("new", {}, 6700);
  assert.equal(g.snapshot(6700).events!.length, 0);
});
test("a successful steal emits a tackle cue, kickoff reset does not", () => {
  const { g, a } = setup();
  const p = g.players.get(a.id)!;
  const q = [...g.players.values()].find((p) => p.team === "ORANGE")!;
  Object.assign(p, { x: 500, y: 350 });
  Object.assign(q, { x: 544, y: 350 });
  Object.assign(g.ball, {
    owner: p.id,
    lastTouch: p.id,
    heldAt: 5000,
    x: 529,
    y: 350,
  });
  g.tick(1 / 30, 5600);
  assert.equal(g.ball.owner, q.id);
  assert.ok(g.snapshot(5600).events!.some((e) => e.kind === "tackle"));
  g.goal("BLUE", 6000);
  g.tick(0, 9000);
  assert.ok(!g.snapshot(9000).events!.some((e) => e.kind === "tackle"));
});
