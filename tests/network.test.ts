import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
test(
  "WebSocket host authorization, production bot restriction, session recovery and malformed messages",
  { timeout: 20000 },
  async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "server/index.ts"],
      {
        env: {
          ...process.env,
          PORT: "3102",
          HOST_PIN: "integration-pin",
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
      const request = (type: string, data: unknown, expected: string) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.off("message", listener);
            reject(Error("Timeout " + expected));
          }, 2000);
          const listener = (raw: unknown) => {
            const m = JSON.parse(String(raw));
            if (m.type === expected) {
              clearTimeout(timer);
              ws.off("message", listener);
              resolve(m.data);
            }
          };
          ws.on("message", listener);
          ws.send(JSON.stringify({ type, data }));
        });
      assert.match(
        (await request("command", { action: "start", confirm: true }, "error"))
          .message,
        /authorization/,
      );
      assert.match(
        (await request("auth", { pin: "wrong" }, "error")).message,
        /Invalid/,
      );
      await request("auth", { pin: "integration-pin" }, "authenticated");
      assert.match(
        (await request("command", { action: "bots" }, "error")).message,
        /disabled in production/,
      );
      const identity = await request(
        "join",
        { name: "Alex", team: "LEADERS" },
        "identity",
      );
      assert.equal(identity.token.length, 48);
      const same = await request(
        "reconnect",
        { token: identity.token },
        "identity",
      );
      assert.equal(same.id, identity.id);
      assert.match((await request("nonsense", {}, "error")).message, /Unknown/);
    } finally {
      for (const ws of clients) ws.terminate();
      child.kill("SIGTERM");
    }
  },
);
