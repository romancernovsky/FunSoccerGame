import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import type { Input, Snapshot } from "../src/shared";
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(check: () => boolean, message: string, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error(message);
    await delay(20);
  }
}
test(
  "real multiplayer clients complete three tap passes with synchronized possession and Team Goal eligibility",
  { timeout: 20000 },
  async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "server/index.ts"],
      {
        env: {
          ...process.env,
          PORT: "3113",
          NODE_ENV: "production",
          MATCH_DURATION_SECONDS: "180",
        },
        stdio: "pipe",
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    const clients: { ws: WebSocket; state?: Snapshot }[] = [];
    const send = (ws: WebSocket, type: string, data: unknown) =>
      ws.send(JSON.stringify({ type, data }));
    const request = (
      ws: WebSocket,
      type: string,
      data: unknown,
      reply: string,
    ) =>
      new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off("message", read);
          reject(Error(`No ${reply} response`));
        }, 3000);
        const read = (raw: unknown) => {
          const msg = JSON.parse(String(raw));
          if (msg.type !== reply && msg.type !== "error") return;
          clearTimeout(timer);
          ws.off("message", read);
          if (msg.type === "error") reject(Error(msg.data.message));
          else resolve(msg.data);
        };
        ws.on("message", read);
        send(ws, type, data);
      });
    try {
      await until(
        () => {
          if (child.exitCode !== null) throw Error(output);
          return output.includes("backend_started");
        },
        "server did not start",
        8000,
      );
      for (let i = 0; i < 4; i++) {
        const ws = new WebSocket("ws://127.0.0.1:3113/ws");
        const client: { ws: WebSocket; state?: Snapshot } = { ws };
        clients.push(client);
        ws.on("message", (raw) => {
          const msg = JSON.parse(String(raw));
          if (msg.type === "state") client.state = msg.data;
        });
        await new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
      }
      const [host, sender, receiver, opponent] = clients;
      await request(host.ws, "host", {}, "host_ready");
      const a = await request(
        sender.ws,
        "join",
        { name: "Alex", team: "BLUE" },
        "identity",
      );
      const b = await request(
        receiver.ws,
        "join",
        { name: "Sam", team: "BLUE" },
        "identity",
      );
      await request(
        opponent.ws,
        "join",
        { name: "Lee", team: "ORANGE" },
        "identity",
      );
      send(host.ws, "command", { action: "start", confirm: true });
      await until(
        () => host.state?.phase === "PLAYING",
        "match did not start",
        6000,
      );
      const idle: Input = { x: 0, y: 0, action: false, dash: false };
      const input = (ws: WebSocket, data: Input) => send(ws, "input", data);
      // Reach the genuine centre ball using movement only; never inject positions or possession.
      const chaseUntil = Date.now() + 3000;
      while (host.state!.ball.owner !== a.id) {
        assert.ok(
          Date.now() < chaseUntil,
          "sender failed to collect the kickoff ball",
        );
        const state = host.state!,
          p = state.players.find((p) => p.id === a.id)!;
        const dx = state.ball.x - p.x,
          dy = state.ball.y - p.y,
          distance = Math.max(1, Math.hypot(dx, dy));
        input(sender.ws, { ...idle, x: dx / distance, y: dy / distance });
        await delay(50);
      }
      input(sender.ws, idle);
      for (let pass = 0; pass < 3; pass++) {
        const from = pass % 2 === 0 ? a.id : b.id,
          to = pass % 2 === 0 ? b.id : a.id;
        const ws = pass % 2 === 0 ? sender.ws : receiver.ws;
        const state = host.state!,
          p = state.players.find((p) => p.id === from)!,
          q = state.players.find((p) => p.id === to)!;
        const dx = q.x - p.x,
          dy = q.y - p.y,
          distance = Math.hypot(dx, dy);
        input(ws, {
          ...idle,
          x: dx / distance,
          y: dy / distance,
          action: true,
        });
        await delay(80);
        input(ws, idle);
        await until(
          () => clients.every((client) => client.state?.ball.owner === to),
          `pass ${pass + 1} bounced instead of reaching the teammate`,
        );
        assert.ok(
          clients.every((client) => client.state!.ball.passes === pass + 1),
        );
        assert.ok(
          clients.every(
            (client) =>
              client.state!.ball.vx === 0 && client.state!.ball.vy === 0,
          ),
        );
      }
      assert.equal(host.state!.ball.passes, 3);
      assert.ok(host.state!.events!.some((e) => e.kind === "pass_completed"));
      assert.equal(host.state!.phase, "PLAYING");
      assert.equal(host.state!.ball.possessionTeam, "BLUE");
    } finally {
      for (const client of clients) client.ws.terminate();
      child.kill("SIGTERM");
    }
  },
);
