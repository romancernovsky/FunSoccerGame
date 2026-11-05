import { test, expect, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import { Game } from "../../server/game";
import type { Snapshot } from "../../src/shared";
test.use({ viewport: { width: 800, height: 600 } });

async function hostControl() {
  const ws = new WebSocket("ws://127.0.0.1:3100/ws");
  let state: Snapshot | undefined;
  ws.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.type === "state") state = message.data;
  });
  await new Promise((resolve) => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "host", data: {} }));
  await expect.poll(() => !!state).toBe(true);
  const command = (action: string) =>
    ws.send(
      JSON.stringify({ type: "command", data: { action, confirm: true } }),
    );
  if (state!.phase !== "WAITING" && state!.phase !== "FINISHED") {
    command("end");
    await expect.poll(() => state?.phase).toBe("FINISHED");
  }
  command(state!.phase === "FINISHED" ? "new" : "reset");
  await expect
    .poll(() => state?.phase === "WAITING" && !state.players.length)
    .toBe(true);
  return { command, state: () => state!, close: () => ws.close() };
}

/** Measures real Web Audio output before the physical device. No fake samples. */
async function probe(page: Page) {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as any).__contexts = [];
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      value: { type: "auto" },
    });
    window.AudioContext = class extends Native {
      peak = 0;
      starts = 0;
      startedBuffers: (AudioBuffer | null)[] = [];
      master: GainNode | null = null;
      constructor() {
        super();
        (window as any).__contexts.push(this);
      }
      createGain() {
        const gain = super.createGain();
        if (!this.master) {
          this.master = gain;
        }
        return gain;
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source);
        source.start = (
          ...args: Parameters<AudioBufferSourceNode["start"]>
        ) => {
          this.starts++;
          this.startedBuffers.push(source.buffer);
          start(...args);
        };
        return source;
      }
    };
  });
}
async function startMeter(page: Page) {
  await page.evaluate(async () => {
    const context = (window as any).__contexts.at(-1);
    const code = `registerProcessor('signal-meter', class extends AudioWorkletProcessor {
      peak = 0; frames = 0;
      process(inputs) {
        for (const channel of inputs[0] || []) for (const sample of channel)
          this.peak = Math.max(this.peak, Math.abs(sample));
        if (++this.frames % 8 === 0) { this.port.postMessage({ peak: this.peak, time: currentTime }); this.peak = 0; }
        return true;
      }
    });`;
    const url = URL.createObjectURL(
      new Blob([code], { type: "application/javascript" }),
    );
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const meter = new AudioWorkletNode(context, "signal-meter");
    meter.port.onmessage = (event) => {
      if (event.data.time >= (context.measureFrom ?? 0))
        context.peak = Math.max(context.peak, event.data.peak);
    };
    // The meter's output is zero, so the probe adds no sound to the destination.
    context.master.connect(meter).connect(context.destination);
  });
}
async function setVolume(page: Page, amount: "0" | "0.8") {
  await page.locator("#volume").focus();
  await page.keyboard.press(amount === "0" ? "Home" : "End");
  if (amount === "0.8")
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
}
const peak = (page: Page) =>
  page.evaluate(() => (window as any).__contexts.at(-1)?.peak ?? 0);
const resetPeak = (page: Page) =>
  page.evaluate(() => {
    for (const ctx of (window as any).__contexts) {
      ctx.peak = 0;
      ctx.measureFrom = ctx.currentTime;
    }
  });

test("host start unlocks sound, background broadcast stays audible, pauses are quiet and mute is respected", async ({
  page,
}) => {
  const host = await hostControl();
  const players: WebSocket[] = [];
  await probe(page);
  try {
    // Two idle real clients keep the ball untouched, so ongoing audio must be
    // stadium ambience rather than a bot's incidental pass/shot.
    for (const [name, team] of [
      ["Avery", "BLUE"],
      ["Morgan", "ORANGE"],
    ]) {
      const ws = new WebSocket("ws://127.0.0.1:3100/ws");
      players.push(ws);
      await new Promise((resolve) => ws.once("open", resolve));
      ws.send(JSON.stringify({ type: "join", data: { name, team } }));
    }
    await expect.poll(() => host.state().players.length).toBe(2);
    await page.goto("/host");
    await expect(page.locator('[data-command="start"]')).toBeEnabled();
    await page.locator('[data-command="start"]').click();
    await expect(page.locator("dialog")).toBeVisible();
    // Opening an incomplete-team confirmation must not start audio/the match.
    expect(await page.evaluate(() => (window as any).__contexts.length)).toBe(
      0,
    );
    await page.locator("#confirm").click();
    const panel = page.locator(".audio-panel");
    await expect(panel).toHaveAttribute("data-status", "on");
    await startMeter(page);
    await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
    await expect.poll(() => host.state().phase).toBe("PLAYING");
    await page.waitForTimeout(1000); // Let the kickoff whistle finish.
    await resetPeak(page);
    await expect.poll(() => peak(page)).toBeGreaterThan(0.0005);

    // Simulate the visibility signal produced when a presenter switches tabs;
    // all samples still come from the real Web Audio graph/audio thread.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => (window as any).__background ?? false,
      });
      (window as any).__background = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(panel).toHaveAttribute("data-status", "on");
    await resetPeak(page);
    await expect.poll(() => peak(page)).toBeGreaterThan(0.0005);
    host.command("pause");
    await expect.poll(() => host.state().phase).toBe("PAUSED");
    await page.waitForTimeout(700); // Ambience fades out; no ongoing effects.
    await resetPeak(page);
    await page.waitForTimeout(300);
    expect(await peak(page)).toBeLessThan(0.0001);
    host.command("end");
    await expect.poll(() => host.state().phase).toBe("FINISHED");
    await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
    await page.evaluate(() => {
      (window as any).__background = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // An explicit mute wins over starting another match or broadcast mode.
    await page.locator("#sound").click();
    await expect(panel).toHaveAttribute("data-status", "off");
    const contexts = await page.evaluate(
      () => (window as any).__contexts.length,
    );
    host.command("rematch_lobby");
    await expect.poll(() => host.state().phase).toBe("WAITING");
    await page.locator('[data-command="start"]').click();
    await page.locator("#confirm").click();
    await expect.poll(() => host.state().phase).toBe("COUNTDOWN");
    await page.locator("#broadcast-mode").click();
    await expect(page.locator("body")).toHaveClass(/broadcast-view/);
    await expect(panel).toHaveAttribute("data-status", "off");
    expect(await page.evaluate(() => (window as any).__contexts.length)).toBe(
      contexts,
    );
    await page.locator("#sound").click();
    await expect(panel).toHaveAttribute("data-status", "on");
  } finally {
    if (!["WAITING", "FINISHED"].includes(host.state().phase))
      host.command("end");
    for (const ws of players) ws.close();
    host.close();
  }
});

test("broadcast audio: host/projector unlock, real signal, live volume, mute and official cues", async ({
  page,
}) => {
  const host = await hostControl();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await probe(page);
  try {
    for (const route of ["/screen", "/host"]) {
      await page.goto(route);
      const panel = page.getByRole("region", { name: "Match audio" });
      await expect(panel).toHaveAttribute("data-status", "off");
      expect(await page.evaluate(() => (window as any).__contexts.length)).toBe(
        0,
      );
      // A single explicit Test sound click also unlocks playback.
      await page.locator("#test-sound").click();
      await expect(panel).toHaveAttribute("data-status", "on");
      await startMeter(page);
      await page.locator("#test-sound").click();
      await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
      expect(
        await page.evaluate(() => (navigator as any).audioSession.type),
      ).toBe("playback");
      await setVolume(page, "0");
      await expect(page.locator("#audio-status")).toContainText("Volume is 0%");
      await page.waitForTimeout(250); // Let the short gain ramp reach silence.
      await resetPeak(page);
      await page.locator("#test-sound").click();
      await page.waitForTimeout(500);
      expect(await peak(page)).toBeLessThan(0.0001);
      await setVolume(page, "0.8");
      await expect(page.locator("#audio-status")).toContainText("80%");
      await resetPeak(page);
      host.command("bots");
      await expect.poll(() => host.state().players.length).toBe(12);
      host.command("start");
      await expect.poll(() => host.state().phase).toBe("COUNTDOWN");
      await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
      await expect.poll(() => host.state().phase).toBe("PLAYING");
      if (route === "/host") {
        host.command("pause");
        await expect.poll(() => host.state().phase).toBe("PAUSED");
        await expect(page.locator("#arena-overlay")).toContainText("PAUSED");
        await page.screenshot({
          path: "artifacts/audio/host-controls.png",
          fullPage: true,
        });
        await expect(page.locator("#sound")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await page.locator("#sound").click();
        await expect(panel).toHaveAttribute("data-status", "off");
        await page.locator("#sound").click();
        await expect(panel).toHaveAttribute("data-status", "on");
        await startMeter(page);
      }
      await resetPeak(page);
      host.command("end");
      await expect.poll(() => host.state().phase).toBe("FINISHED");
      await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
      // Muting must stop already scheduled fanfare/cheering, not just new notes.
      await page.locator("#sound").click();
      await expect(panel).toHaveAttribute("data-status", "off");
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__contexts.at(-1).state),
        )
        .toBe("closed");
      expect(
        await page.evaluate(() => (navigator as any).audioSession.type),
      ).toBe("auto");
      host.command("rematch_lobby");
      await expect.poll(() => host.state().phase).toBe("WAITING");
      await expect(panel).toHaveAttribute("data-status", "off");
    }
    expect(errors).toEqual([]);
  } finally {
    if (!["WAITING", "FINISHED"].includes(host.state().phase))
      host.command("end");
    host.close();
  }
});

for (const failure of ["reject", "pending", "interrupted"] as const) {
  test(`broadcast audio: ${failure} resume never claims success and a fresh gesture recovers`, async ({
    page,
  }) => {
    await probe(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((mode) => {
      (window as any).__resumeFailure = mode;
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        get state(): AudioContextState {
          return (window as any).__resumeFailure ? "suspended" : super.state;
        }
        resume() {
          const failure = (window as any).__resumeFailure;
          if (failure === "reject")
            return Promise.reject(
              new DOMException("Not allowed", "NotAllowedError"),
            );
          if (failure === "pending") return new Promise<void>(() => {});
          if (failure === "interrupted") return Promise.resolve();
          return super.resume();
        }
      };
    }, failure);
    await page.goto("/screen");
    await page.locator("#sound").click();
    await expect(page.locator(".audio-panel")).toHaveAttribute(
      "data-status",
      "blocked",
    );
    await expect(page.locator("#sound")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      await page.evaluate(() => (window as any).__contexts.at(-1).starts),
    ).toBe(0);
    await page.evaluate(() => {
      (window as any).__resumeFailure = null;
    });
    await page
      .getByRole("button", { name: "Resume sound", exact: true })
      .click();
    await expect(page.locator(".audio-panel")).toHaveAttribute(
      "data-status",
      "on",
    );
    await startMeter(page);
    await page.locator("#test-sound").click();
    await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
    expect(await page.evaluate(() => (window as any).__contexts[0].state)).toBe(
      "closed",
    );
    // A suspended context recovers on the next return to the page.
    await page.evaluate(async () => {
      await (window as any).__contexts.at(-1).suspend();
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).__contexts.at(-1).state))
      .toBe("running");
    await page.locator("#sound").click();
    await expect(page.locator(".audio-panel")).toHaveAttribute(
      "data-status",
      "off",
    );
    expect(errors).toEqual([]);
  });
}

test("every recorded cue produces finite audio without clipping", async ({
  page,
}) => {
  await page.goto("/bet");
  const levels = await page.evaluate(async () => {
    const url = "/src/recorded-audio.ts";
    const {
      EFFECTS,
      loadRecordings,
      playRecordedEffect,
      createBroadcastMaster,
    } = (await import(url)) as typeof import("../../src/recorded-audio");
    const required = [
      "match_started",
      "go",
      "match_paused",
      "match_resumed",
      "goal_scored",
      "team_goal",
      "final_minute",
      "balls_dropped",
      "ball_landed",
      "last_seconds",
      "golden_goal_started",
      "match_finished",
      "match_ended",
    ];
    if (required.some((kind) => !EFFECTS[kind]?.length))
      throw Error("Missing a match transition cue");
    const result: Record<string, { peak: number; rms: number }> = {};
    for (const kind of Object.keys(EFFECTS)) {
      const context = new OfflineAudioContext(2, 288000, 48000);
      const bank = await loadRecordings(context);
      playRecordedEffect(context, createBroadcastMaster(context), kind, bank);
      const data = (await context.startRendering()).getChannelData(0);
      let peak = 0,
        energy = 0;
      for (const sample of data) {
        if (!Number.isFinite(sample)) throw Error(kind);
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      result[kind] = { peak, rms: Math.sqrt(energy / data.length) };
    }
    return result;
  });
  expect(Object.keys(levels).length).toBeGreaterThan(20);
  for (const [kind, { peak, rms }] of Object.entries(levels)) {
    expect(peak, kind).toBeGreaterThan(0.005);
    expect(peak, kind).toBeLessThan(1);
    expect(rms, kind).toBeGreaterThan(0.0003);
  }
});

test("recorded cues preserve action batches, skip stale history and sound every match transition", async ({
  page,
}) => {
  await probe(page);
  const g = new Game({ duration: 66, maxTeamSize: 6, grace: 20, dev: false });
  const a = g.join("Alex", "BLUE", 1000);
  g.join("Sam", "ORANGE", 1000);
  const initial = structuredClone(g.snapshot(1000));
  const frames: Snapshot[] = [];
  const capture = (now: number) =>
    frames.push(structuredClone(g.snapshot(now)));
  g.command("start", { confirm: true }, 1000);
  capture(1000);
  g.tick(0, 5000);
  capture(5000);
  g.ball.owner = a.id;
  g.input(a.id, { x: 1, y: 0, action: true, dash: true }, 5100);
  g.input(a.id, { x: 1, y: 0, action: false, dash: false }, 5200);
  capture(5200);
  g.command("pause", {}, 5300);
  capture(5300);
  g.command("resume", {}, 5400);
  capture(5400);
  Object.assign(g.ball, { x: 600, y: 350, vx: 0, vy: 0, owner: null });
  g.tick(6, 11400);
  capture(11400);
  expect(g.snapshot(11400).phase).toBe("RULES_COUNTDOWN");
  let now = 11400;
  for (let second = 0; second < 7; second++) {
    now += 1000;
    g.tick(0, now);
    capture(now);
  }
  expect(g.phase).toBe("PLAYING");
  expect(g.balls.length).toBe(3);
  for (let i = 0; i < 45; i++) {
    now += 1000 / 30;
    g.tick(1 / 30, now);
    capture(now);
  }
  g.possessionTeam = "BLUE";
  g.passes = 3;
  for (const ball of g.balls) {
    now += 100;
    g.goal("BLUE", now, ball);
    capture(now);
  }
  expect(g.phase).toBe("GOAL");
  now = g.deadline;
  g.tick(0, now);
  capture(now);
  now = g.deadline;
  g.tick(0, now);
  capture(now);
  g.score.ORANGE = g.score.BLUE;
  g.remaining = 0.01;
  now += 34;
  g.tick(0.02, now);
  capture(now);
  expect(g.snapshot(now).phase).toBe("GOLDEN_GOAL");
  now += 100;
  g.goal("ORANGE", now);
  capture(now);
  now = g.deadline;
  g.tick(0, now);
  capture(now);
  g.command("rematch", {}, now + 100);
  capture(now + 100);
  g.command("end", { confirm: true }, now + 200);
  capture(now + 200);
  await page.goto("/bet");
  await page.evaluate(async (initial) => {
    const url = "/src/audio.ts";
    const { MatchAudio } = (await import(
      url
    )) as typeof import("../../src/audio");
    const engine = new MatchAudio(() => {});
    (window as any).__engine = engine;
    (window as any).__played = [];
    const play = engine.play.bind(engine);
    engine.play = (kind: string) => {
      (window as any).__played.push(kind);
      play(kind);
    };
    engine.observe(initial);
    const button = document.createElement("button");
    button.id = "enable-fixture-audio";
    button.textContent = "Enable fixture audio";
    button.onclick = () => engine.toggle();
    document.body.append(button);
  }, initial);
  await page.locator("#enable-fixture-audio").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__engine.ready))
    .toBe(true);
  await startMeter(page);
  await page.waitForTimeout(650);
  await resetPeak(page);
  const result = await page.evaluate(
    ({ frames, initial }) => {
      const engine = (window as any).__engine;
      // A freshly opened screen baselines existing cues instead of replaying them.
      engine.observe(initial);
      (window as any).__played = [];
      for (const frame of frames) engine.observe(frame);
      const played = [...(window as any).__played] as string[];
      const last = frames.at(-1)!;
      engine.observe(last);
      engine.observe(last);
      const duplicateCount = (window as any).__played.length - played.length;
      const freshId =
        Math.max(last.event.id, ...(last.events ?? []).map((e) => e.id)) + 1;
      engine.observe({
        ...last,
        now: last.now + 5001,
        event: { id: freshId, kind: "goal_scored" },
        events: [{ id: freshId, kind: "goal_scored", at: last.now }],
      });
      const staleCount = (window as any).__played.length - played.length;
      // The last-ten-seconds clap follows official remaining time and deduplicates.
      for (let n = 10; n >= 1; n--) {
        const frame = {
          ...last,
          phase: "PLAYING",
          ended: false,
          golden: false,
          remaining: n,
          events: [],
          event: { id: freshId, kind: "ready" },
        };
        engine.observe(frame);
        engine.observe(frame);
      }
      return {
        played,
        duplicateCount,
        staleCount,
        ticks: (window as any).__played.filter(
          (k: string) => k === "last_seconds",
        ).length,
      };
    },
    { frames, initial },
  );
  for (const kind of [
    "match_started",
    "go",
    "shot_charge",
    "dash",
    "pass",
    "match_paused",
    "match_resumed",
    "final_minute",
    "balls_dropped",
    "ball_landed",
    "goal_scored",
    "team_goal",
    "golden_goal_started",
    "match_finished",
    "match_ended",
  ])
    expect(result.played, kind).toContain(kind);
  expect(result.duplicateCount).toBe(0);
  expect(result.staleCount).toBe(0);
  expect(result.ticks).toBe(10);
  await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
  await page.evaluate(() => (window as any).__engine.mute());
});

async function fixtureAudio(page: Page, initial: Snapshot) {
  await probe(page);
  await page.goto("/bet");
  await page.evaluate(async (initial) => {
    const path = "/src/audio.ts";
    const { MatchAudio } = await import(path);
    const engine = new MatchAudio(() => {});
    (window as any).__engine = engine;
    engine.observe(initial);
    const button = document.createElement("button");
    button.id = "fixture-enable";
    button.textContent = "Enable audio";
    button.onclick = () => engine.toggle();
    document.body.append(button);
  }, initial);
  await page.locator("#fixture-enable").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__engine.ready))
    .toBe(true);
  await startMeter(page);
  await page.waitForTimeout(650);
}
function goalFixture() {
  const game = new Game();
  game.join("Alex", "BLUE", 1000);
  game.join("Sam", "ORANGE", 1000);
  game.command("start", { confirm: true }, 1000);
  game.tick(0, 5000);
  const before = structuredClone(game.snapshot(5100));
  game.goal("BLUE", 5200);
  return { game, before, goal: structuredClone(game.snapshot(5200)) };
}
test("goal cheering cannot be dropped when gameplay fills the audio voice limit", async ({
  page,
}) => {
  const { before, goal } = goalFixture();
  await fixtureAudio(page, before);
  const result = await page.evaluate((goal) => {
    const engine = (window as any).__engine,
      context = (window as any).__contexts.at(-1);
    engine.stopVoices();
    for (let i = 0; i < 60; i++) engine.play("shot");
    const busy = engine.voices.size;
    const before = context.startedBuffers.filter(
      (b: AudioBuffer) => b === engine.bank.cheer,
    ).length;
    engine.observe(goal);
    const cheers =
      context.startedBuffers.filter((b: AudioBuffer) => b === engine.bank.cheer)
        .length - before;
    engine.observe(goal);
    const repeat =
      context.startedBuffers.filter((b: AudioBuffer) => b === engine.bank.cheer)
        .length - before;
    return { busy, cheers, repeat, ready: engine.ready };
  }, goal);
  expect(result.busy).toBeGreaterThan(20);
  expect(result.ready).toBe(true);
  expect(result.cheers).toBe(1);
  expect(result.repeat).toBe(1);
  await page.evaluate(() => (window as any).__engine.mute());
});
test("a goal delayed past 1.5 seconds still cheers during the celebration without replaying on a new screen", async ({
  page,
}) => {
  const { game, before } = goalFixture();
  const delayed = structuredClone(game.snapshot(7000));
  await fixtureAudio(page, before);
  const result = await page.evaluate(
    async ({ delayed }) => {
      const engine = (window as any).__engine,
        context = (window as any).__contexts.at(-1);
      engine.stopVoices();
      const start = context.startedBuffers.filter(
        (b: AudioBuffer) => b === engine.bank.cheer,
      ).length;
      engine.observe(delayed);
      engine.observe(delayed);
      const cheers =
        context.startedBuffers.filter(
          (b: AudioBuffer) => b === engine.bank.cheer,
        ).length - start;
      const path = "/src/audio.ts";
      const { MatchAudio } = await import(path);
      const refreshed = new MatchAudio(() => {});
      let replays = 0;
      refreshed.play = () => replays++;
      refreshed.observe(delayed);
      return { cheers, replays };
    },
    { delayed },
  );
  expect(result.cheers).toBe(1);
  expect(result.replays).toBe(0);
  await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
  await page.evaluate(() => (window as any).__engine.mute());
});

test("every sound produces real browser audio through the unlocked match mixer", async ({
  page,
}) => {
  await fixtureAudio(page, structuredClone(new Game().snapshot(1000)));
  const kinds: string[] = await page.evaluate(async () => {
    const path = "/src/recorded-audio.ts";
    return Object.keys((await import(path)).EFFECTS);
  });
  const levels: Record<string, number> = {};
  for (const kind of kinds) {
    const scheduled = await page.evaluate(async (kind) => {
      const engine = (window as any).__engine,
        context = (window as any).__contexts.at(-1);
      engine.stopVoices();
      context.peak = 0;
      context.measureFrom = context.currentTime;
      const before = context.startedBuffers.length;
      engine.play(kind);
      const path = "/src/recorded-audio.ts";
      const { EFFECTS } = await import(path);
      return {
        count: context.startedBuffers.length - before,
        expected: EFFECTS[kind].length,
      };
    }, kind);
    expect(scheduled.count, kind).toBe(scheduled.expected);
    await expect
      .poll(() => peak(page), { message: kind, timeout: 4000 })
      .toBeGreaterThan(0.005);
    levels[kind] = await peak(page);
  }
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("artifacts/audio", { recursive: true });
  await writeFile(
    "artifacts/audio/validated-cues.json",
    JSON.stringify(levels, null, 2),
  );
  await page.evaluate(() => (window as any).__engine.mute());
});
test("a goal from a live twelve-player match starts the recorded cheer on the host", async ({
  page,
}) => {
  const host = await hostControl();
  await probe(page);
  try {
    host.command("bots");
    await expect.poll(() => host.state().players.length).toBe(12);
    await page.goto("/host");
    await page.locator('[data-command="start"]').click();
    await expect(page.locator(".audio-panel")).toHaveAttribute(
      "data-status",
      "on",
    );
    await startMeter(page);
    await expect
      .poll(() => host.state().score.BLUE + host.state().score.ORANGE, {
        timeout: 45000,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__contexts
              .at(-1)
              .startedBuffers.filter(
                (b: AudioBuffer) => b && b.duration > 5 && b.duration < 7,
              ).length,
        ),
      )
      .toBeGreaterThan(0);
    await expect.poll(() => peak(page)).toBeGreaterThan(0.005);
  } finally {
    if (!["WAITING", "FINISHED"].includes(host.state().phase))
      host.command("end");
    host.close();
  }
});

test("an open host hears new goals after a backend restart resets event numbers", async ({
  page,
}) => {
  const old = goalFixture();
  for (let i = 0; i < 90; i++) old.game.emit("pass");
  await fixtureAudio(page, structuredClone(old.game.snapshot(5200)));
  const fresh = goalFixture();
  const result = await page.evaluate(
    ({ before, goal }) => {
      const engine = (window as any).__engine,
        context = (window as any).__contexts.at(-1);
      engine.stopVoices();
      const start = context.startedBuffers.filter(
        (b: AudioBuffer) => b === engine.bank.cheer,
      ).length;
      engine.observe(before);
      engine.observe(goal);
      engine.observe(goal);
      return (
        context.startedBuffers.filter(
          (b: AudioBuffer) => b === engine.bank.cheer,
        ).length - start
      );
    },
    { before: fresh.before, goal: fresh.goal },
  );
  expect(result).toBe(1);
  await page.evaluate(() => (window as any).__engine.mute());
});
