import { WebSocket } from "ws";
import assert from "node:assert/strict";
const url = process.env.LOAD_URL ?? "ws://localhost:3000/ws";
const clients: WebSocket[] = [],
  states: any[] = [],
  ids: string[] = [];
let interval: ReturnType<typeof setInterval> | undefined;
function waitFor(ws: WebSocket, type: string) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", listener);
      reject(Error("Timed out: " + type));
    }, 6000);
    const listener = (d: unknown) => {
      const m = JSON.parse(String(d));
      if (m.type === "error") {
        clearTimeout(timer);
        ws.off("message", listener);
        reject(Error(m.data.message));
      } else if (m.type === type) {
        clearTimeout(timer);
        ws.off("message", listener);
        resolve(m.data);
      }
    };
    ws.on("message", listener);
  });
}
try {
  for (let i = 0; i < 20; i++) {
    const ws = new WebSocket(url);
    clients.push(ws);
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "state") states[i] = m.data;
    });
    await new Promise((r) => ws.once("open", r));
    if (i < 12) {
      const response = waitFor(ws, "identity");
      ws.send(
        JSON.stringify({
          type: "join",
          data: { name: `Load ${i}`, team: i < 6 ? "LEADERS" : "WORKERS" },
        }),
      );
      ids.push((await response).id);
    }
  }
  const host = clients[12],
    ready = waitFor(host, "host_ready");
  host.send(JSON.stringify({ type: "host", data: {} }));
  await ready;
  host.send(JSON.stringify({ type: "command", data: { action: "start" } }));
  await new Promise((r) => setTimeout(r, 4500));
  interval = setInterval(
    () =>
      clients.slice(0, 12).forEach((ws, i) =>
        ws.send(
          JSON.stringify({
            type: "input",
            data: {
              x: Math.sin(Date.now() / 800 + i),
              y: Math.cos(Date.now() / 800 + i),
              action: Math.sin(Date.now() / 500) > 0,
              dash: Math.sin(Date.now() / 600) > 0.95,
            },
          }),
        ),
      ),
    50,
  );
  await new Promise((r) => setTimeout(r, 5000));
  assert.equal(states.length, 20);
  assert.ok(states.every((s) => s.players.length === 12));
  assert.ok(states.every((s) => s.remaining < 180));
  assert.ok(
    states.every(
      (s) =>
        s.phase === "PLAYING" ||
        s.phase === "GOAL" ||
        s.phase === "KICKOFF_COUNTDOWN",
    ),
  );
  assert.ok(
    Math.max(...states.map((s) => s.remaining)) -
      Math.min(...states.map((s) => s.remaining)) <
      0.2,
  );
  console.log(
    "PASS: 20 connections, 12 simultaneous players, synchronized snapshots.",
  );
} finally {
  if (interval) clearInterval(interval);
  for (const ws of clients) ws.close();
}
