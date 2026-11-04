import { test, expect } from "@playwright/test";
import { Game } from "../../server/game";
import type { Snapshot } from "../../src/shared";

test("eyes turn rigidly with the head and team hair updates after Reorg", async ({
  page,
}) => {
  const game = new Game({
    duration: 66,
    maxTeamSize: 6,
    grace: 20,
    dev: false,
  });
  const local = game.join("TEST Alex", "LEADERS", 0);
  const rival = game.join("TEST Sam", "WORKERS", 0);
  game.command("start", { confirm: true }, 0);
  let now = 0;
  const tick = () => {
    now += 1000 / 30;
    game.tick(1 / 30, now);
  };
  // Match the network's serialization boundary: snapshots contain live Player
  // references until serialized, so keep an independent copy of every frame.
  const snapshot = () => structuredClone(game.snapshot(now));
  while (game.phase !== "PLAYING") tick();
  const stages: { name: string; frames: Snapshot[] }[] = [];
  for (const [name, x, y] of [
    ["right", 1, 0],
    ["front", 0, 1],
    ["left", -1, 0],
    ["back", 0, -1],
    ["up-right", 1, -1],
    ["up-left", -1, -1],
    ["down-left", -1, 1],
    ["down-right", 1, 1],
    ["angle boundary right", 0.01, -1],
    ["angle boundary left", -0.01, -1],
  ] as const) {
    const frames: Snapshot[] = [],
      length = Math.hypot(x, y);
    for (let i = 0; i < 16; i++) {
      game.input(
        local.id,
        { x: x / length, y: y / length, action: false, dash: false },
        now,
      );
      tick();
      frames.push(snapshot());
    }
    stages.push({ name, frames });
  }
  while (game.phase === "PLAYING") tick();
  expect(snapshot().phase).toBe("REORG");
  expect(game.players.get(local.id)!.team).toBe("WORKERS");
  expect(game.players.get(rival.id)!.team).toBe("LEADERS");
  const reveal: Snapshot[] = [];
  for (let i = 0; i < 16; i++) {
    tick();
    reveal.push(snapshot());
  }
  stages.push({ name: "reassigned", frames: reveal });
  while (game.phase !== "PLAYING") tick();
  const dark: Snapshot[] = [];
  for (let i = 0; i < 16; i++) {
    game.input(local.id, { x: 0, y: 1, action: false, dash: false }, now);
    tick();
    dark.push(snapshot());
  }
  stages.push({ name: "dark-front", frames: dark });

  // The audience page has no existing 3D scene. Inspect the real renderer's eye
  // positions/normals, not just the parent head's rotation property.
  await page.goto("/bet");
  const result = await page.evaluate(
    async ({ stages, localId }) => {
      const url = "/src/renderer3d.ts";
      const { Arena3D } = (await import(
        url
      )) as typeof import("../../src/renderer3d");
      const arena = new Arena3D();
      let minGazeAlignment = 1,
        minSurfaceAlignment = 1,
        maxOffsetError = 0;
      const samples: {
        name: string;
        player: string;
        team: string;
        hair: string;
        facing: number;
      }[] = [];
      const captures: Record<string, string> = {};
      for (const stage of stages) {
        for (const snapshot of stage.frames) {
          const local = snapshot.players.find((p) => p.id === localId)!;
          arena.render(
            snapshot,
            snapshot.now,
            1 / 30,
            { x: local.x + 60, y: local.y + 50, zoom: 4 },
            localId,
            640,
            400,
          );
          for (const player of snapshot.players) {
            const actor = (arena as any).actors.get(player.id);
            const heading = actor.head.getWorldDirection(
              actor.head.position.clone(),
            );
            for (const side of ["left", "right"]) {
              const eye = actor.head.getObjectByName(`${side}-eye`)!;
              const white = eye.getObjectByName("white")!,
                pupil = eye.getObjectByName("pupil")!;
              const eyeCenter = white.getWorldPosition(white.position.clone());
              const gaze = pupil
                .getWorldPosition(pupil.position.clone())
                .sub(eyeCenter);
              maxOffsetError = Math.max(
                maxOffsetError,
                Math.abs(gaze.length() - 0.026),
              );
              minGazeAlignment = Math.min(
                minGazeAlignment,
                gaze.normalize().dot(heading),
              );
              minSurfaceAlignment = Math.min(
                minSurfaceAlignment,
                pupil.getWorldDirection(pupil.position.clone()).dot(heading),
                white.getWorldDirection(white.position.clone()).dot(heading),
              );
            }
          }
        }
        const state = stage.frames.at(-1)!;
        for (const player of state.players) {
          const actor = (arena as any).actors.get(player.id);
          const forward = actor.head.getWorldDirection(
            actor.head.position.clone(),
          );
          const wanted = forward.clone().set(player.fx, 0, player.fy);
          samples.push({
            name: stage.name,
            player: player.id,
            team: player.team,
            hair: actor.head
              .getObjectByName("hair")
              .children[0].material.color.getHexString(),
            facing: forward.dot(wanted),
          });
        }
        if (["right", "front", "left", "dark-front"].includes(stage.name))
          captures[stage.name] =
            arena.renderer.domElement.toDataURL("image/png");
      }
      arena.renderer.dispose();
      return {
        minGazeAlignment,
        minSurfaceAlignment,
        maxOffsetError,
        samples,
        captures,
      };
    },
    { stages, localId: local.id },
  );
  expect(result.minGazeAlignment).toBeGreaterThan(0.999999);
  expect(result.minSurfaceAlignment).toBeGreaterThan(0.999999);
  expect(result.maxOffsetError).toBeLessThan(0.000001);
  expect(
    result.samples.find((s) => s.name === "front" && s.player === local.id)
      ?.team,
  ).toBe("LEADERS");
  expect(
    result.samples.find((s) => s.name === "reassigned" && s.player === local.id)
      ?.team,
  ).toBe("WORKERS");
  for (const sample of result.samples) {
    expect(sample.facing, sample.name).toBeGreaterThan(0.999);
    const rgb = sample.hair.match(/../g)!.map((hex) => parseInt(hex, 16));
    if (sample.team === "LEADERS") {
      expect(rgb[0]).toBeGreaterThan(200);
      expect(rgb[1]).toBeGreaterThan(150);
      expect(rgb[2]).toBeLessThan(190);
    } else expect(Math.max(...rgb)).toBeLessThan(100);
  }
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("artifacts/avatar-rig", { recursive: true });
  for (const [name, png] of Object.entries(result.captures))
    await writeFile(
      `artifacts/avatar-rig/${name}.png`,
      Buffer.from(png.split(",")[1], "base64"),
    );
  const { captures, ...metrics } = result;
  await writeFile(
    "artifacts/avatar-rig/checks.json",
    JSON.stringify(metrics, null, 2),
  );
});
