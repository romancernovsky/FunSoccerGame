import { test, expect, type Page } from "@playwright/test";
import { WebSocket } from "ws";
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
      createOscillator() {
        const source = super.createOscillator(),
          start = source.start.bind(source);
        source.start = (time) => {
          this.starts++;
          start(time);
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
      ["Avery", "LEADERS"],
      ["Morgan", "WORKERS"],
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

test("original pass, shot, countdown, goal, victory and Reorg effects produce finite audio", async ({
  page,
}) => {
  await page.goto("/bet");
  const levels = await page.evaluate(async () => {
    const url = "/src/audio.ts";
    const { synthesizeEffect } = (await import(
      url
    )) as typeof import("../../src/audio");
    const result: Record<string, { peak: number; rms: number }> = {};
    for (const kind of [
      "test",
      "countdown",
      "pass",
      "shot",
      "ball_bounce",
      "go",
      "goal_scored",
      "match_finished",
      "final_minute",
      "golden_goal_started",
      "reorg_started",
      "reorg_kickoff",
    ]) {
      const context = new OfflineAudioContext(1, 96000, 48000);
      synthesizeEffect(context, context.destination, kind);
      const data = (await context.startRendering()).getChannelData(0);
      let peak = 0,
        energy = 0;
      for (const sample of data) {
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      result[kind] = { peak, rms: Math.sqrt(energy / data.length) };
    }
    return result;
  });
  for (const [kind, { peak, rms }] of Object.entries(levels)) {
    expect(peak, kind).toBeGreaterThan(0.005);
    expect(peak, kind).toBeLessThan(1);
    expect(rms, kind).toBeGreaterThan(0.001);
  }
});
