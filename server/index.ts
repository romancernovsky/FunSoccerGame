import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { PredictionError } from "./predictions.js";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Game } from "./game.js";
import { DEFAULT_MATCH_DURATION_SECONDS } from "../src/shared.js";
const production = process.env.NODE_ENV === "production";
function numberEnv(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw Error(`Invalid ${name}`);
  return n;
}
const log = (event: string, data?: unknown) =>
  console.log(
    JSON.stringify({
      severity: "INFO",
      event,
      data,
      time: new Date().toISOString(),
    }),
  );
const game = new Game(
  {
    duration: numberEnv(
      "MATCH_DURATION_SECONDS",
      DEFAULT_MATCH_DURATION_SECONDS,
      1,
      3600,
    ),
    maxTeamSize: numberEnv("MAX_TEAM_SIZE", 6, 1, 6),
    grace: numberEnv("RECONNECT_GRACE_SECONDS", 20, 5, 120),
    dev: !production,
  },
  log,
);
const vite = !production
  ? await (
      await import("vite")
    ).createServer({
      server: {
        middlewareMode: true,
        hmr: { port: Number(process.env.PORT ?? 3000) + 1 },
      },
      appType: "spa",
    })
  : null;
const root = resolve("dist/public");
function audienceState(token: string) {
  return {
    now: Date.now(),
    phase: game.phase,
    remaining: game.remaining,
    golden: game.golden,
    score: { ...game.score },
    predictions: game.predictions.summary(game.phase, game.score, game.ended),
    pick: game.predictions.pick(token),
  };
}
async function audienceRequest(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!["GET", "POST"].includes(req.method ?? "")) {
      res.setHeader("Allow", "GET, POST");
      throw new PredictionError("Method not allowed.", 405);
    }
    if (
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      throw new PredictionError("Open bets on the game website.", 403);
    const cookie = req.headers.cookie?.match(
      /(?:^|;\s*)lvw-audience=([a-f0-9]{48})(?:;|$)/,
    )?.[1];
    const token = cookie ?? randomBytes(24).toString("hex");
    if (req.method === "POST") {
      if (
        req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
      )
        throw new PredictionError("Send a JSON bet.", 415);
      if (Number(req.headers["content-length"]) > 512) {
        req.resume();
        throw new PredictionError("Bet message is too large.", 413);
      }
      let body = "",
        size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size <= 512) body += chunk.toString();
      }
      if (size > 512)
        throw new PredictionError("Bet message is too large.", 413);
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new PredictionError("Invalid bet message.");
      }
      game.predictions.choose(
        token,
        data?.team,
        data?.roundId,
        Date.now(),
        game.phase,
      );
    }
    if (!cookie)
      res.setHeader(
        "Set-Cookie",
        `lvw-audience=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`,
      );
    res.writeHead(200);
    res.end(JSON.stringify(audienceState(token)));
  } catch (error) {
    res.writeHead(error instanceof PredictionError ? error.status : 400);
    res.end(
      JSON.stringify({
        message:
          error instanceof PredictionError
            ? error.message
            : "Invalid bet request.",
      }),
    );
  }
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (req.url?.split("?")[0] === "/api/audience") {
    await audienceRequest(req, res);
    return;
  }
  if (vite) {
    vite.middlewares(req, res);
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://local").pathname,
    );
    const file = resolve(root, "." + pathname);
    if (!file.startsWith(root + "/") && file !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    const target = [
      "/",
      "/join",
      "/host",
      "/screen",
      "/bet",
      "/predict",
    ].includes(pathname)
      ? resolve(root, "index.html")
      : file;
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type":
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".webmanifest": "application/manifest+json",
            ".png": "image/png",
            ".ico": "image/x-icon",
            ".mp3": "audio/mpeg",
          } as Record<string, string>
        )[extname(target)] ?? "application/octet-stream",
      "Cache-Control":
        extname(target) === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
type Client = {
  ws: WebSocket;
  id: string | null;
  host: boolean;
  count: number;
  window: number;
  alive: boolean;
};
const clients = new Set<Client>();
const send = (c: Client, type: string, data: unknown) => {
  if (c.ws.readyState === WebSocket.OPEN)
    c.ws.send(JSON.stringify({ type, data }));
};
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    if (!vite) socket.destroy();
    return;
  } // Vite handles its own upgrade.
  try {
    if (
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    ) {
      socket.destroy();
      return;
    }
  } catch {
    socket.destroy();
    return;
  }
  if (clients.size >= 64) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (ws) => {
  const c: Client = {
    ws,
    id: null,
    host: false,
    count: 0,
    window: Date.now(),
    alive: true,
  };
  clients.add(c);
  log("websocket_connected");
  send(c, "state", game.snapshot(Date.now()));
  ws.on("pong", () => (c.alive = true));
  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - c.window >= 1000) {
      c.count = 0;
      c.window = now;
    }
    if (++c.count > 80) {
      ws.close(1008, "Rate limit");
      return;
    }
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string")
        throw Error("Invalid message.");
      const d = msg.data;
      switch (msg.type) {
        case "join": {
          if (c.id) throw Error("Already joined.");
          const result = game.join(d?.name, d?.team, now);
          c.id = result.id;
          send(c, "identity", result);
          break;
        }
        case "reconnect": {
          if (typeof d?.token !== "string" || d.token.length > 100)
            throw Error("Invalid session.");
          const id = game.reconnect(d.token, now);
          if (!id) {
            send(c, "session_expired", {});
            break;
          }
          for (const other of clients)
            if (other !== c && other.id === id) {
              other.id = null;
              send(other, "replaced", {});
              other.ws.close(1000, "Session opened elsewhere");
            }
          c.id = id;
          send(c, "identity", { id, token: d.token });
          break;
        }
        // The event host opens /host directly. This role separates controls from
        // player inputs; it is intentionally not an authentication boundary.
        case "host":
          c.host = true;
          send(c, "host_ready", {});
          break;
        case "command":
          if (!c.host)
            throw Error("Open the host console to control the match.");
          if (!d || typeof d.action !== "string")
            throw Error("Invalid command.");
          game.command(d.action, d, now);
          break;
        case "input":
          if (c.id) game.input(c.id, d, now);
          break;
        default:
          throw Error("Unknown message.");
      }
    } catch (error) {
      send(c, "error", {
        message: error instanceof Error ? error.message : "Invalid message.",
      });
    }
  });
  ws.on("close", () => {
    clients.delete(c);
    if (c.id) game.disconnect(c.id, Date.now());
  });
  ws.on("error", (e) => log("websocket_error", { message: e.message }));
});
const rate = numberEnv("GAME_TICK_RATE", 30, 20, 30);
let last = performance.now(),
  accumulator = 0;
const simulation = setInterval(() => {
  const t = performance.now(),
    dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  accumulator += dt;
  try {
    while (accumulator >= 1 / rate) {
      game.tick(1 / rate, Date.now());
      accumulator -= 1 / rate;
    }
    for (const c of clients) {
      if (c.id && !game.players.has(c.id)) {
        c.id = null;
        send(c, "session_expired", {});
      }
      if (c.ws.bufferedAmount > 256000) {
        c.ws.terminate();
        continue;
      }
      send(c, "state", game.snapshot(Date.now(), !c.id));
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        event: "server_error",
        message: String(e),
      }),
    );
  }
}, 1000 / rate);
const heartbeat = setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 10000);
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
  log("backend_started", { port: process.env.PORT ?? 3000, dev: !production }),
);
process.on("SIGTERM", () => {
  clearInterval(simulation);
  clearInterval(heartbeat);
  for (const c of clients) c.ws.close(1012, "Server restarting");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
