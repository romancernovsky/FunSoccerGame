import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
import { FIELD } from "../src/shared";

function circle(g: Game) {
  const field = [...g.players.values()].filter((p) => !p.keeper);
  for (const p of field) {
    assert.ok(
      Math.abs(
        Math.hypot(p.x - FIELD.width / 2, p.y - FIELD.height / 2) -
          FIELD.centerCircleRadius,
      ) < 0.000001,
    );
    assert.ok(
      p.team === "BLUE" ? p.x < FIELD.width / 2 : p.x > FIELD.width / 2,
    );
    assert.equal(p.fx, p.team === "BLUE" ? 1 : -1);
  }
  for (let i = 0; i < field.length; i++)
    for (let j = i + 1; j < field.length; j++)
      assert.ok(
        Math.hypot(field[i].x - field[j].x, field[i].y - field[j].y) >= 44,
      );
}
for (const size of [1, 3, 6]) {
  test(`${size} vs ${size} starts on the circle edge with no overlapping players`, () => {
    const g = new Game();
    for (let i = 0; i < size; i++) {
      g.join(`Leader ${i}`, "BLUE", 1000);
      g.join(`Worker ${i}`, "ORANGE", 1000);
    }
    g.command("start", { confirm: true }, 1000);
    circle(g);
    g.tick(0, 5000);
    g.tick(1 / 30, 5034);
    circle(g);
    assert.equal(g.ball.owner, null);
    assert.equal(g.ball.x, FIELD.width / 2);
  });
}
test("keepers stay in goal and kickoff after goals and rematches restores the circle", () => {
  const g = new Game();
  const a = g.join("Alex", "BLUE", 1000);
  const b = g.join("Sam", "ORANGE", 1000);
  g.join("Lee", "BLUE", 1000);
  g.command("keeper", { id: a.id }, 1000);
  g.command("start", { confirm: true }, 1000);
  circle(g);
  assert.deepEqual([g.players.get(a.id)!.x, g.players.get(a.id)!.y], [70, 350]);
  g.tick(0, 5000);
  g.players.get(b.id)!.x = 1000;
  g.goal("BLUE", 5100);
  g.tick(0, 8100);
  assert.equal(g.phase, "KICKOFF_COUNTDOWN");
  circle(g);
  g.command("end", { confirm: true }, 8200);
  g.command("rematch", {}, 8300);
  circle(g);
});
