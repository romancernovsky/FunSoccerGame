import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
test(
  "PIN-free production startup, host roles, production bot restriction and session recovery",
  { timeout: 20000 },
  async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "server/index.ts"],
      {
        env: {
          ...process.env,
          PORT: "3102",
          HOST_PIN: undefined,
          MATCH_DURATION_SECONDS: undefined,
          NODE_ENV: "production",
        },
        stdio: "pipe",
      },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const clients: WebSocket[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setInterval(() => {
          if (output.includes("backend_started")) {
            clearInterval(t);
            resolve();
          } else if (child.exitCode !== null) {
            clearInterval(t);
            reject(Error(output));
          }
        }, 30);
        setTimeout(() => {
          clearInterval(t);
          reject(Error("Server startup timeout " + output));
        }, 10000).unref();
      });
      const ws = new WebSocket("ws://127.0.0.1:3102/ws");
      clients.push(ws);
      await new Promise((r) => ws.once("open", r));
      const request = (
        type: string,
        data: unknown,
        expected: string,
        client = ws,
      ) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => {
            client.off("message", listener);
            reject(Error("Timeout " + expected));
          }, 2000);
          const listener = (raw: unknown) => {
            const m = JSON.parse(String(raw));
            if (m.type === expected) {
              clearTimeout(timer);
              client.off("message", listener);
              resolve(m.data);
            }
          };
          client.on("message", listener);
          client.send(JSON.stringify({ type, data }));
        });
      assert.match(
        (await request("command", { action: "start", confirm: true }, "error"))
          .message,
        /host console/,
      );
      await request("host", {}, "host_ready");
      assert.equal((await fetch("http://127.0.0.1:3102/healthz")).status, 200);
      assert.equal((await fetch("http://127.0.0.1:3102/host")).status, 200);
      const audio = await fetch("http://127.0.0.1:3102/audio/whistle.mp3");
      assert.equal(audio.status, 200);
      assert.equal(audio.headers.get("content-type"), "audio/mpeg");
      assert.ok((await audio.arrayBuffer()).byteLength > 1000);
      assert.match(
        (await request("command", { action: "bots" }, "error")).message,
        /disabled in production/,
      );
      const identity = await request(
        "join",
        { name: "Alex", team: "BLUE" },
        "identity",
      );
      assert.equal(identity.token.length, 48);
      const same = await request(
        "reconnect",
        { token: identity.token },
        "identity",
      );
      assert.equal(same.id, identity.id);
      const nextState = (check: (state: any) => boolean) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.off("message", read);
            reject(Error("Audio subscription state timeout"));
          }, 2000);
          const read = (raw: unknown) => {
            const message = JSON.parse(String(raw));
            if (message.type === "state" && check(message.data)) {
              clearTimeout(timer);
              ws.off("message", read);
              resolve(message.data);
            }
          };
          ws.on("message", read);
        });
      assert.equal(
        (await nextState((state) => !state.events)).events,
        undefined,
      );
      assert.equal(
        (await request("audio", { enabled: true }, "audio_ready")).enabled,
        true,
      );
      assert.ok(
        Array.isArray(
          (await nextState((state) => Array.isArray(state.events))).events,
        ),
      );
      assert.equal(
        (await request("audio", { enabled: false }, "audio_ready")).enabled,
        false,
      );
      assert.equal(
        (await nextState((state) => !state.events)).events,
        undefined,
      );
      assert.match(
        (await request("audio", { enabled: "yes" }, "error")).message,
        /Invalid audio/,
      );
      // Another connection does not inherit the first host's control role.
      const refreshedHost = new WebSocket("ws://127.0.0.1:3102/ws");
      clients.push(refreshedHost);
      await new Promise((r) => refreshedHost.once("open", r));
      await request("audio", { enabled: true }, "audio_ready", refreshedHost);
      assert.match(
        (
          await request(
            "command",
            { action: "reset", confirm: true },
            "error",
            refreshedHost,
          )
        ).message,
        /host console/,
      );
      await request("host", {}, "host_ready", refreshedHost);
      assert.match(
        (await request("command", { action: "bots" }, "error", refreshedHost))
          .message,
        /disabled in production/,
      );
      const manifestResponse = await fetch(
        "http://127.0.0.1:3102/manifest.webmanifest",
      );
      assert.match(
        manifestResponse.headers.get("content-type")!,
        /application\/manifest\+json/,
      );
      const manifest = (await manifestResponse.json()) as any;
      assert.equal(manifest.display, "standalone");
      assert.equal(manifest.start_url, "/join");
      for (const icon of manifest.icons) {
        const image = await fetch("http://127.0.0.1:3102" + icon.src);
        assert.equal(image.status, 200);
        assert.match(image.headers.get("content-type")!, /image\/png/);
      }
      const audience = await fetch("http://127.0.0.1:3102/api/audience");
      assert.equal(audience.headers.get("cache-control"), "no-store");
      assert.match(audience.headers.get("set-cookie")!, /HttpOnly/);
      const cookie = audience.headers.get("set-cookie")!.split(";")[0];
      const before = (await audience.json()) as any;
      assert.equal(before.players, undefined);
      assert.equal(before.pick, null);
      assert.equal(before.remaining, 180);
      const pick = (team: unknown, extra = {}, headers = {}) =>
        fetch("http://127.0.0.1:3102/api/audience", {
          method: "POST",
          headers: { "content-type": "application/json", cookie, ...headers },
          body: JSON.stringify({
            team,
            roundId: before.predictions.roundId,
            ...extra,
          }),
        });
      assert.equal((await fetch("http://127.0.0.1:3102/bet")).status, 200);
      assert.equal((await fetch("http://127.0.0.1:3102/predict")).status, 200);
      assert.equal((await pick("BLUE")).status, 200);
      const repeated = (await (await pick("BLUE")).json()) as any;
      assert.equal(repeated.predictions.total, 1);
      assert.equal(repeated.pick, "BLUE");
      assert.equal((await pick("INVALID")).status, 400);
      assert.equal((await pick("ORANGE")).status, 200);
      assert.equal(
        (await pick("BLUE", {}, { origin: "https://elsewhere.example" }))
          .status,
        403,
      );
      assert.equal(
        (await pick("BLUE", { text: "x".repeat(1000) })).status,
        413,
      );
      const recovered = (await (
        await fetch("http://127.0.0.1:3102/api/audience", {
          headers: { cookie },
        })
      ).json()) as any;
      assert.equal(recovered.pick, "ORANGE");
      // HTTP bets remain open before and after a successful start, then close at match end.
      assert.match(
        (await request("command", { action: "start", confirm: true }, "error"))
          .message,
        /Both teams/,
      );
      assert.equal(
        (
          (await (
            await fetch("http://127.0.0.1:3102/api/audience")
          ).json()) as any
        ).predictions.open,
        true,
      );
      await request(
        "join",
        { name: "Sam", team: "ORANGE" },
        "identity",
        refreshedHost,
      );
      await request("command", { action: "start", confirm: true }, "state");
      assert.equal((await pick("BLUE")).status, 200);
      const live = (await (
        await fetch("http://127.0.0.1:3102/api/audience", {
          headers: { cookie },
        })
      ).json()) as any;
      assert.equal(live.pick, "BLUE");
      assert.equal(live.predictions.open, true);
      await request("command", { action: "end", confirm: true }, "state");
      assert.equal((await pick("ORANGE")).status, 409);
      assert.match((await request("nonsense", {}, "error")).message, /Unknown/);
    } finally {
      for (const ws of clients) ws.terminate();
      child.kill("SIGTERM");
    }
  },
);
