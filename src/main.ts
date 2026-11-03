import { reorgView } from "./reorg-view";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-900.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import { Arena3D } from "./renderer3d";
import { drawCelebration } from "./visuals";
import { cameraTarget, smoothCamera, overview, type Camera } from "./camera";
import QRCode from "qrcode";
import {
  FIELD as F,
  REORG,
  TEAMS,
  type Snapshot,
  type Team,
  type Input,
  type Player,
} from "./shared";
import "./style.css";
const arrow =
  '<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
const app = document.querySelector<HTMLDivElement>("#app")!;
const route = location.pathname;
const host = route === "/host",
  join = route === "/join";
let state: Snapshot | null = null,
  ws: WebSocket | null = null,
  connected = false,
  hostReady = false,
  identity: string | null = null,
  token = localStorage.getItem("lvw-session"),
  selected: Team = "LEADERS",
  signature = "",
  error = "",
  notice = "",
  retry = 0,
  replaced = false;
let serverOffset = 0,
  lastEvent = 0,
  audio: AudioContext | null = null,
  sound = false,
  volume = 0.35,
  charging = false,
  chargeStarted = 0;
const input: Input = { x: 0, y: 0, action: false, dash: false };
let keys = new Set<string>();
let joystick = { x: 0, y: 0 };
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const count = (t: Team) =>
  state?.players.filter((p) => p.team === t).length ?? 0;
const me = () => state?.players.find((p) => p.id === identity);
const active = () => !!state && state.phase !== "WAITING";
const clock = () =>
  state?.golden
    ? "∞"
    : `${Math.floor(Math.ceil(state?.remaining ?? 300) / 60)
        .toString()
        .padStart(
          2,
          "0",
        )}:${(Math.ceil(state?.remaining ?? 300) % 60).toString().padStart(2, "0")}`;
function send(type: string, data: unknown) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type, data }));
}
function connect() {
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  ws.onopen = () => {
    connected = true;
    retry = 0;
    if (token && join) send("reconnect", { token });
    if (host) send("host", {});
    signature = "";
    render();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case "state":
        if (
          state &&
          state.phase !== msg.data.phase &&
          !["PLAYING", "GOLDEN_GOAL"].includes(msg.data.phase)
        )
          stopInput();
        state = msg.data;
        serverOffset = state!.now - Date.now();
        if (state!.event.id !== lastEvent) {
          if (lastEvent && sound) playSound(state!.event.kind);
          lastEvent = state!.event.id;
        }
        render();
        break;
      case "identity":
        identity = msg.data.id;
        token = msg.data.token;
        localStorage.setItem("lvw-session", token!);
        error = "";
        signature = "";
        render();
        break;
      case "host_ready":
        hostReady = true;
        error = "";
        signature = "";
        render();
        break;
      case "error":
        error = msg.data.message;
        const el = document.querySelector("#error");
        if (el) el.textContent = error;
        else {
          signature = "";
          render();
        }
        break;
      case "session_expired":
        identity = null;
        token = null;
        localStorage.removeItem("lvw-session");
        signature = "";
        render();
        break;
      case "replaced":
        replaced = true;
        identity = null;
        token = null;
        localStorage.removeItem("lvw-session");
        notice = "This player session is open in another tab.";
        break;
    }
  };
  ws.onclose = () => {
    connected = false;
    // Keep the broadcast visible while the next socket reselects its host role.
    stopInput();
    signature = "";
    render();
    if (!replaced) setTimeout(connect, Math.min(5000, 500 + retry++ * 500));
  };
  ws.onerror = () => ws?.close();
}
function header() {
  return `<header><a class="brand" href="/"><span class="brand-icon">✦</span><span>OFFICE<span class="brand-light"> / </span>ARENA<small>LEADERS VS WORKERS</small></span></a><nav><a class="${!host && !join ? "current" : ""}" href="/screen">Spectator</a><a class="${join ? "current" : ""}" href="/join">Join game <span>↗</span></a>${host ? '<a class="current" href="/host">Host console</a>' : ""}</nav><div class="connection"><i class="${connected ? "" : "offline"}"></i>${connected ? "LIVE CONNECTION" : "RECONNECTING"}</div></header>`;
}
function teamCard(team: Team, manage = false) {
  const ps = state?.players.filter((p) => p.team === team) ?? [];
  return `<section class="team-card ${team.toLowerCase()}"><div class="team-title"><span class="team-emblem">${team === "LEADERS" ? arrow : "✳"}</span><div><span class="eyebrow">${team === "LEADERS" ? "THE BIG IDEAS" : "THE REAL MVPs"}</span><h2>${team}</h2></div><span class="capacity">${ps.length}<small> / ${state?.maxTeamSize ?? 6}</small></span></div><div class="roster">${Array.from(
    { length: state?.maxTeamSize ?? 6 },
    (_, i) => {
      const p = ps[i];
      return p
        ? `<div class="roster-row"><span class="avatar">${esc(p.name.slice(0, 2).toUpperCase())}</span><span class="player-label">${esc(p.name)} ${p.keeper ? "🧤" : ""}<small>${p.bot ? "TEST PLAYER · " : ""}${p.connected ? "Connected" : Date.now() + serverOffset - p.disconnectedAt < 10000 ? "Reconnecting" : "Disconnected"}</small></span>${manage && state?.phase === "WAITING" ? `<div class="player-actions"><button title="${p.keeper ? "Remove" : "Assign"} goalkeeper" data-player="${p.id}" data-action="keeper">🧤</button><button title="Move team" data-player="${p.id}" data-action="move">⇄</button><button title="Remove player" data-player="${p.id}" data-action="remove">×</button></div>` : `<span class="player-dot ${p.connected ? "" : "away"}"></span>`}</div>`
        : `<div class="roster-row empty"><span class="empty-avatar">+</span><span>Waiting for player<span class="slot">0${i + 1}</span></span></div>`;
    },
  ).join(
    "",
  )}</div><div class="team-footer">${ps.length === (state?.maxTeamSize ?? 6) ? "TEAM FULL" : "OPEN FOR BUSINESS"}<span>${ps.filter((p) => p.connected).length} connected</span></div></section>`;
}
function qrCard() {
  return `<div class="join-card"><span class="eyebrow">YOUR NEXT TEAM MEETING, UPGRADED</span><h2>Less talk.<br>More football.</h2><p>Pick a side. Rally your team.<br>Settle it on the pitch.</p><div class="qr-wrap"><canvas id="qr"></canvas><span class="qr-corner">${arrow}</span></div><strong>Scan to join the match</strong><a class="join-link" href="/join">${esc(location.host)}/join ↗</a><div class="quick-facts"><span>◷ 5 minutes</span><span>♙ 12 players</span><span>▣ Any browser</span></div></div>`;
}
function scoreboard() {
  return `<div class="scoreboard"><div class="score-team blue"><span>${arrow}</span> LEADERS</div><div class="score"><b id="score-l">${state?.score.LEADERS ?? 0}</b><span>:</span><b id="score-w">${state?.score.WORKERS ?? 0}</b></div><div class="score-team orange">WORKERS <span>✳</span></div><div class="clock-wrap"><small id="clock-label">${state?.golden ? "NEXT GOAL WINS" : active() ? "MATCH TIME" : "MATCH DURATION"}</small><strong id="clock">${clock()}</strong></div></div>`;
}
function arena() {
  return `<div class="arena-wrap"><canvas id="arena" aria-label="Live 3D football arena"></canvas><canvas id="arena-fx" aria-hidden="true"></canvas><div id="arena-overlay" class="arena-overlay"></div><span class="pitch-label">OFFICE ARENA / ${state?.phase === "WAITING" ? "PRE-MATCH" : "LIVE MATCH"}</span><span class="pitch-watermark">EASY TO PLAY. FUN TO WATCH.</span></div>`;
}
function controls() {
  return `<div class="mobile-identity"><i></i><span>${esc(me()?.name ?? "")}<small>YOU · ${me()?.team ?? ""}</small></span></div><div id="possession-hint" class="possession-hint"></div><div class="mobile-controls"><div id="joystick" class="joystick"><span id="stick"></span><small>MOVE</small></div><div class="action-controls"><button id="dash" class="dash">↯<small>DASH</small></button><button id="shoot" class="shoot">◉<small>PASS / SHOOT</small><span id="charge-bar"></span></button></div></div><div class="rotate"><span>↻</span><h2>Rotate your phone to play</h2><p>The whole pitch looks better in landscape.</p></div>`;
}
function updateGameViewport() {
  const viewport = window.visualViewport;
  const style = document.documentElement.style;
  style.setProperty(
    "--game-viewport-width",
    `${viewport?.width ?? innerWidth}px`,
  );
  style.setProperty(
    "--game-viewport-height",
    `${viewport?.height ?? innerHeight}px`,
  );
  style.setProperty("--game-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
  style.setProperty("--game-viewport-top", `${viewport?.offsetTop ?? 0}px`);
}
window.visualViewport?.addEventListener("resize", updateGameViewport);
window.visualViewport?.addEventListener("scroll", updateGameViewport);
window.addEventListener("resize", updateGameViewport);
updateGameViewport();
let playerFullscreen = false;
let broadcast = false;
let followCamera = true;
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => void | Promise<void>;
};
type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};
const fullscreenElement = () =>
  document.fullscreenElement ??
  (document as FullscreenDocument).webkitFullscreenElement;
function exitBrowserFullscreen() {
  const doc = document as FullscreenDocument;
  if (!fullscreenElement()) return;
  try {
    void Promise.resolve(
      (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc),
    ).catch(() => {});
  } catch {
    // The viewport layout still exits if the browser rejects the API request.
  }
}
function setPlayerFullscreen(enabled: boolean, requestBrowser = true) {
  stopInput();
  playerFullscreen = enabled;
  signature = "";
  render();
  if (!requestBrowser) return;
  if (!enabled) {
    exitBrowserFullscreen();
    return;
  }
  const root = document.documentElement as FullscreenRoot;
  if (fullscreenElement()) return;
  try {
    // iPhone browsers without element fullscreen still get the viewport layout.
    void Promise.resolve(
      (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root),
    )
      .then(() => {
        if (!playerFullscreen) exitBrowserFullscreen();
      })
      .catch(() => {});
  } catch {
    // Keep the playable viewport layout when native fullscreen is unavailable.
  }
}
function playerToolbar() {
  return `<div class="player-toolbar"><button class="secondary compact" id="player-fullscreen" aria-label="${playerFullscreen ? "Exit" : "Enter"} full screen" aria-pressed="${playerFullscreen}"><b aria-hidden="true">${playerFullscreen ? "↙" : "⛶"}</b><span>${playerFullscreen ? "Exit full screen" : "Full screen"}</span></button></div>`;
}
function watchToolbar() {
  return `<div class="watch-toolbar"><span class="eyebrow"><i class="live-dot"></i> LIVE BROADCAST</span><div><button class="secondary compact" id="watch-sound">${sound ? "◖ Sound on" : "◖ Enable sound"}</button><button class="secondary compact" id="camera-mode" aria-pressed="${followCamera}">${followCamera ? "◎ Ball-follow camera" : "▣ Full field"}</button><button class="primary compact" id="broadcast-mode" aria-pressed="${broadcast}">${broadcast ? "↙ Exit broadcast" : "⛶ Broadcast mode"}</button></div></div>`;
}
function hostPanel() {
  if (!hostReady)
    return `<section class="pin-panel"><span class="eyebrow">MATCH CONTROL</span><h1>Connecting to the control room…</h1><p>Your host console will open automatically.</p><div id="error" role="alert">${esc(error)}</div></section>`;
  return `<div class="section-top host-console-heading"><div><span class="eyebrow">THE CONTROL ROOM</span><h1>Run the show<span class="accent">.</span></h1></div><a class="text-link" href="/screen" target="_blank">Open projector ↗</a></div>${active() ? `<section id="host-watch" class="host-watch">${watchToolbar()}${scoreboard()}${arena()}${!connected ? '<div class="watch-disconnected">Reconnecting to the live match…</div>' : ""}</section>` : scoreboard()}<div class="host-actions">${state?.phase === "WAITING" ? `<button class="primary" data-command="start" ${TEAMS.some((t) => !state?.players.some((p) => p.team === t && p.connected)) ? "disabled" : ""}>▶ START MATCH</button>${state?.dev ? '<button class="secondary" data-command="bots">＋ Fill with Test Players</button>' : ""}<button class="secondary" data-command="reset">Reset lobby</button>` : state?.phase === "FINISHED" ? '<button class="primary" data-command="rematch">↻ REMATCH</button><button class="secondary" data-command="new">NEW MATCH</button>' : `<button class="primary" data-command="${state?.phase === "PAUSED" ? "resume" : "pause"}">${state?.phase === "PAUSED" ? "▶ RESUME" : "Ⅱ PAUSE"}</button><button class="secondary" data-command="restart">↻ RESTART MATCH</button><button class="danger" data-command="end">END MATCH</button>`}</div><p class="host-warning">${state?.phase === "WAITING" ? (TEAMS.some((t) => !state?.players.some((p) => p.team === t && p.connected)) ? "Both teams need at least one connected player." : count("LEADERS") !== count("WORKERS") ? "⚠ Teams are uneven. The host decides when to start." : "Ready when you are. The match never starts automatically.") : `${state?.phase.replaceAll("_", " ")} · Official server timer`}</p><div id="error" role="alert">${esc(error)}</div><div class="teams-grid">${TEAMS.map((t) => teamCard(t, true)).join("")}</div>`;
}
function joinPanel() {
  const p = me();
  if (p) {
    if (active())
      return `<div class="player-game">${playerToolbar()}${scoreboard()}${arena()}${controls()}${!connected ? '<div class="network-banner">Reconnecting… Your place is reserved.</div>' : ""}<div class="player-help"><span class="you-chip ${p.team.toLowerCase()}">● YOU: ${esc(p.name)} ${p.keeper ? "🧤" : ""}</span><span>WASD / ARROWS <i>Move</i> &nbsp; SPACE <i>Tap to pass · Hold to shoot</i> &nbsp; SHIFT <i>Dash</i></span></div></div>`;
    return `<div class="waiting-layout"><section class="joined-card"><div class="check-mark">✓</div><span class="eyebrow">YOU ARE IN</span><h1>TEAM<br><span class="${p.team === "LEADERS" ? "blue" : "orange"}">${p.team}</span></h1><p>Welcome, <strong>${esc(p.name)}</strong>.<br>Get your game face on.</p><div class="waiting-pill"><i></i>Waiting for host…</div><div class="how-to"><span><b>↔</b>MOVE<small>Joystick / WASD</small></span><span><b>◉</b>PASS<small>Tap</small></span><span><b>↗</b>SHOOT<small>Hold & release</small></span><span><b>ϟ</b>DASH<small>Button / Shift</small></span></div></section>${teamCard(p.team)}</div>`;
  }
  if (active())
    return `<section class="pin-panel"><span class="eyebrow">THE PITCH IS BUSY</span><h1>Match in progress<span class="accent">.</span></h1><p>Please wait for the next game.</p><a class="primary" href="/screen">WATCH THE MATCH ↗</a></section>`;
  return `<div class="join-layout"><section class="join-intro"><span class="eyebrow"><i class="live-dot"></i> ONE MEETING. TWO TEAMS. NO EXCUSES.</span><h1>Pick a side.<br>Make some<br><em>noise.</em></h1><p>The five-minute showdown your<br>calendar didn't see coming.</p><div class="intro-bottom">LEADERS <span>VS</span> WORKERS <small>EASY TO PLAY. HARD TO COORDINATE. FUN TO WATCH.</small></div></section><section class="join-form-card"><span class="eyebrow">YOUR SPOT ON THE PITCH</span><h2>Let's play.</h2><form id="join-form"><label for="name">YOUR NAME <small>Keep it short. Make it yours.</small></label><input id="name" autocomplete="off" maxlength="12" placeholder="e.g. Alex" required><label>CHOOSE YOUR TEAM</label><div class="team-options">${TEAMS.map((t) => `<button type="button" class="team-option ${t.toLowerCase()} ${selected === t ? "selected" : ""}" data-team="${t}" ${count(t) >= (state?.maxTeamSize ?? 6) ? "disabled" : ""}><span>${t === "LEADERS" ? arrow : "✳"}</span><strong>${t}</strong><small>${count(t)} / ${state?.maxTeamSize ?? 6} ${count(t) >= (state?.maxTeamSize ?? 6) ? "· FULL" : "players"}</small></button>`).join("")}</div><div id="error" role="alert">${esc(error)}</div><button class="primary" ${!connected ? "disabled" : ""}>JOIN GAME <span>↗</span></button><p class="form-note">No account. No downloads. Just a little friendly rivalry.</p></form></section></div>`;
}
function spectator() {
  if (active())
    return `<div class="match-heading"><span class="eyebrow"><i class="live-dot"></i> ${state?.golden ? "GOLDEN GOAL" : "LIVE FROM THE OFFICE ARENA"}</span><button class="secondary compact" id="fullscreen">⛶ Full screen</button></div>${scoreboard()}${arena()}<div class="match-bottom"><span><i class="live-dot"></i> ${state?.players.filter((p) => p.connected).length} PLAYERS ON THE PITCH</span><span>BIG IDEAS. BIGGER GOALS.</span></div>`;
  return `<div class="section-top"><div><span class="eyebrow"><i class="live-dot"></i> THE ALL-HANDS SHOWDOWN</span><h1>Business as <em>unusual.</em></h1><p>The meeting can wait. The match is almost on.</p></div><div class="lobby-status"><span class="status-pill">PRE-MATCH LOBBY</span><strong>${count("LEADERS") + count("WORKERS")} <span>/ ${(state?.maxTeamSize ?? 6) * 2} PLAYERS JOINED</span></strong><small>Waiting for host to start</small></div></div><div class="lobby-layout"><div class="lobby-main">${scoreboard()}${arena()}<div class="teams-grid">${TEAMS.map((t) => teamCard(t)).join("")}</div></div>${qrCard()}</div><div class="rules-strip"><span><b>01</b> SCAN & PICK A TEAM</span><i>→</i><span><b>02</b> WAIT FOR THE WHISTLE</span><i>→</i><span><b>03</b> GIVE THE OFFICE SOMETHING TO TALK ABOUT</span></div>`;
}
function render() {
  if (!state) return;
  if (!hostReady || !active()) broadcast = false;
  document.body.classList.toggle("broadcast-view", host && broadcast);
  if (playerFullscreen && !(join && active() && me())) {
    playerFullscreen = false;
    exitBrowserFullscreen();
  }
  document.body.classList.toggle("player-fullscreen", playerFullscreen);
  const sig = JSON.stringify([
    connected,
    hostReady,
    identity,
    state.phase,
    state.players.map((p) => [p.id, p.name, p.team, p.keeper, p.connected]),
    state.dev,
    broadcast,
    playerFullscreen,
    followCamera,
  ]);
  if (sig !== signature) {
    const name =
      (document.querySelector("#name") as HTMLInputElement)?.value ?? "";
    signature = sig;
    app.innerHTML =
      header() +
      `<main class="${join && active() && me() ? "game-main" : ""}">${host ? hostPanel() : join ? joinPanel() : spectator()}</main><footer><span>OFFICE ARENA <i>© 2026</i></span><span>A LITTLE RIVALRY. A LOT OF TEAM SPIRIT.</span><div>${!join ? `<button id="sound">${sound ? "◖ SOUND ON" : "◖ ENABLE SOUND"}</button><input id="volume" aria-label="Master volume" type="range" min="0" max="1" step="0.05" value="${volume}">` : ""}<span>BUILT FOR THE TEAM.</span></div></footer>${notice ? `<div class="toast">${esc(notice)}</div>` : ""}`;
    const n = document.querySelector<HTMLInputElement>("#name");
    if (n) n.value = name;
    bind();
    const qr = document.querySelector<HTMLCanvasElement>("#qr");
    if (qr)
      QRCode.toCanvas(qr, `${location.origin}/join`, {
        width: 190,
        margin: 1,
        color: { dark: "#14241e", light: "#ffffff" },
      });
  }
  warmArena();
  const l = document.querySelector("#score-l"),
    w = document.querySelector("#score-w"),
    t = document.querySelector("#clock");
  if (l) l.textContent = String(state.score.LEADERS);
  if (w) w.textContent = String(state.score.WORKERS);
  if (t) {
    t.textContent = clock();
    t.classList.toggle(
      "urgent",
      state.remaining <= 10 && !state.golden && active(),
    );
  }
}
function command(action: string, confirm = false) {
  error = "";
  send("command", { action, confirm });
}
function confirmCommand(action: string) {
  let title = "",
    body = "";
  if (action === "start" && TEAMS.some((t) => count(t) < state!.maxTeamSize)) {
    title = "Teams are incomplete";
    body = `LEADERS: ${count("LEADERS")} / ${state!.maxTeamSize} · WORKERS: ${count("WORKERS")} / ${state!.maxTeamSize}. ${count("LEADERS") !== count("WORKERS") ? "Teams are uneven. " : ""}Start anyway?`;
  } else if (["restart", "end", "new", "reset"].includes(action)) {
    title = {
      restart: "Restart this match?",
      end: "End this match?",
      new: "Start a new lobby?",
      reset: "Reset the lobby?",
    }[action]!;
    body =
      action === "new" || action === "reset"
        ? "All players and assignments will be cleared."
        : "This stops the current game. " +
          (action === "restart"
            ? "Players and roles will be kept."
            : "The final score will be shown.");
  } else {
    command(action);
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<span class="eyebrow">HOST CONTROL</span><h2>${title}</h2><p>${body}</p><div><button class="secondary" id="cancel">CANCEL</button><button class="primary" id="confirm">${action === "start" ? "START MATCH" : "CONFIRM"}</button></div>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog
    .querySelector("#cancel")!
    .addEventListener("click", () => dialog.remove());
  dialog.querySelector("#confirm")!.addEventListener("click", () => {
    command(action, true);
    dialog.remove();
  });
  dialog.addEventListener("cancel", () => dialog.remove());
}
function bind() {
  document
    .querySelector("#player-fullscreen")
    ?.addEventListener("click", () => {
      setPlayerFullscreen(!playerFullscreen);
    });
  document
    .querySelector("#watch-sound")
    ?.addEventListener("click", () =>
      document.querySelector<HTMLButtonElement>("#sound")?.click(),
    );
  document.querySelector("#camera-mode")?.addEventListener("click", () => {
    followCamera = !followCamera;
    signature = "";
    render();
  });
  document.querySelector("#broadcast-mode")?.addEventListener("click", () => {
    broadcast = !broadcast;
    signature = "";
    render();
    if (broadcast && !document.fullscreenElement)
      void document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!broadcast && document.fullscreenElement)
      void document.exitFullscreen?.().catch(() => {});
  });
  document.querySelector("#join-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    send("join", {
      name: (document.querySelector("#name") as HTMLInputElement).value,
      team: selected,
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-team]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.team as Team;
        document
          .querySelectorAll("[data-team]")
          .forEach((t) =>
            t.classList.toggle(
              "selected",
              (t as HTMLElement).dataset.team === selected,
            ),
          );
      }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-command]")
    .forEach((b) => (b.onclick = () => confirmCommand(b.dataset.command!)));
  document
    .querySelectorAll<HTMLButtonElement>("[data-player]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          send("command", { action: b.dataset.action, id: b.dataset.player })),
    );
  document.querySelector("#fullscreen")?.addEventListener("click", () => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  document.querySelector("#sound")?.addEventListener("click", () => {
    audio ??= new AudioContext();
    void audio.resume();
    sound = !sound;
    signature = "";
    render();
    if (sound) playSound("go");
  });
  document
    .querySelector("#volume")
    ?.addEventListener(
      "input",
      (e) => (volume = Number((e.target as HTMLInputElement).value)),
    );
  const stick = document.querySelector<HTMLElement>("#joystick");
  if (stick) {
    let pointer = -1;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const r = stick.getBoundingClientRect(),
        dx = e.clientX - r.x - r.width / 2,
        dy = e.clientY - r.y - r.height / 2,
        d = Math.max(40, Math.hypot(dx, dy));
      joystick = { x: dx / d, y: dy / d };
      const knob = stick.querySelector<HTMLElement>("#stick")!;
      knob.style.transform = `translate(${joystick.x * 35}px,${joystick.y * 35}px)`;
    };
    stick.onpointerdown = (e) => {
      pointer = e.pointerId;
      stick.setPointerCapture(pointer);
      move(e);
    };
    stick.onpointermove = move;
    stick.onpointerup = stick.onpointercancel = () => {
      joystick = { x: 0, y: 0 };
      stick.querySelector<HTMLElement>("#stick")!.style.transform = "";
      pointer = -1;
    };
  }
  const shoot = document.querySelector<HTMLElement>("#shoot");
  if (shoot) {
    shoot.onpointerdown = (e) => {
      shoot.setPointerCapture(e.pointerId);
      setAction(true);
    };
    shoot.onpointerup = shoot.onpointercancel = () => setAction(false);
  }
  const dash = document.querySelector<HTMLElement>("#dash");
  if (dash) {
    dash.onpointerdown = (e) => {
      dash.setPointerCapture(e.pointerId);
      input.dash = true;
      send("input", input);
    };
    dash.onpointerup = dash.onpointercancel = () => {
      input.dash = false;
      send("input", input);
    };
  }
}
function setAction(value: boolean) {
  if (value && !input.action) chargeStarted = performance.now();
  charging = value;
  input.action = value;
  send("input", input);
}
function stopInput() {
  keys.clear();
  joystick = { x: 0, y: 0 };
  Object.assign(input, { x: 0, y: 0, action: false, dash: false });
  charging = false;
  send("input", input);
}
window.addEventListener("keydown", (e) => {
  if (
    !join ||
    !me() ||
    !state ||
    !["PLAYING", "GOLDEN_GOAL"].includes(state.phase) ||
    (e.target as HTMLElement).matches("input")
  )
    return;
  if (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      " ",
      "Shift",
      "w",
      "a",
      "s",
      "d",
    ].includes(e.key)
  ) {
    e.preventDefault();
    keys.add(e.key.toLowerCase());
    if (e.key === " " && !e.repeat) setAction(true);
    if (e.key === "Shift" && !e.repeat) {
      input.dash = true;
      send("input", input);
    }
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
  if (e.key === " ") setAction(false);
  if (e.key === "Shift") {
    input.dash = false;
    if (join && identity) send("input", input);
  }
});
window.addEventListener("blur", stopInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopInput();
});
setInterval(() => {
  if (!identity || !join) return;
  input.x = Math.max(
    -1,
    Math.min(
      1,
      joystick.x +
        (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
        (keys.has("a") || keys.has("arrowleft") ? 1 : 0),
    ),
  );
  input.y = Math.max(
    -1,
    Math.min(
      1,
      joystick.y +
        (keys.has("s") || keys.has("arrowdown") ? 1 : 0) -
        (keys.has("w") || keys.has("arrowup") ? 1 : 0),
    ),
  );
  const dash = input.dash;
  input.dash = dash || keys.has("shift");
  send("input", input);
  if (!dash) input.dash = false;
}, 50);
function playSound(kind: string) {
  if (!audio || !sound) return;
  const pitches: Record<string, number[]> = {
    pass: [280],
    shot: [140, 90],
    go: [440, 660, 880],
    goal_scored: [523, 659, 784, 1047, 784, 1047],
    match_finished: [784, 659, 523, 1047],
    final_minute: [440, 440, 660],
    golden_goal_started: [330, 660, 990],
    reorg_started: [220, 165, 330, 440, 660, 880],
    reorg_kickoff: [440, 660],
  };
  const notes = pitches[kind];
  if (!notes) return;
  notes.forEach((freq, i) => {
    const o = audio!.createOscillator(),
      g = audio!.createGain(),
      at = audio!.currentTime + i * 0.12;
    o.type = kind === "goal_scored" ? "triangle" : "sine";
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(volume * 0.25, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    o.connect(g).connect(audio!.destination);
    o.start(at);
    o.stop(at + 0.32);
  });
  if (kind === "match_finished" || kind === "go") {
    const whistle = audio.createOscillator(),
      gain = audio.createGain(),
      at = audio.currentTime;
    whistle.frequency.setValueAtTime(2700, at);
    whistle.frequency.linearRampToValueAtTime(2350, at + 0.35);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume * 0.08, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
    whistle.connect(gain).connect(audio.destination);
    whistle.start(at);
    whistle.stop(at + 0.42);
  }
  if (kind === "goal_scored" || kind === "match_finished") {
    const buffer = audio.createBuffer(
        1,
        audio.sampleRate * 1.5,
        audio.sampleRate,
      ),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = audio.createBufferSource(),
      filter = audio.createBiquadFilter(),
      g = audio.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 900;
    g.gain.value = volume * 0.25;
    source.connect(filter).connect(g).connect(audio.destination);
    source.start();
  }
}
let world3d: Arena3D | null = null;
let graphicsFailed = false;
let graphicsPaused = false;
let warmingArena = false;
function warmArena() {
  if (
    world3d ||
    warmingArena ||
    graphicsFailed ||
    !state ||
    state.phase !== "WAITING" ||
    !((host && hostReady) || (join && identity))
  )
    return;
  warmingArena = true;
  setTimeout(() => {
    try {
      if (!state || world3d) return;
      world3d = new Arena3D();
      world3d.render(
        state,
        performance.now(),
        1 / 30,
        overview(),
        identity,
        8,
        8,
      );
    } catch (e) {
      console.error("3D warmup failed", e);
    } finally {
      warmingArena = false;
    }
  }, 0);
}
let prev = performance.now();
let countdownNote = -1;
let overlayHtml = "";
let overlayElement: HTMLElement | null = null;
let camera: Camera = overview();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && playerFullscreen) {
    setPlayerFullscreen(false);
  }
  if (e.key === "Escape" && broadcast) {
    broadcast = false;
    signature = "";
    render();
  }
});
function onFullscreenChange() {
  if (fullscreenElement()) return;
  if (playerFullscreen) setPlayerFullscreen(false, false);
  if (broadcast) {
    broadcast = false;
    signature = "";
    render();
  }
}
document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);
function draw(time: number) {
  requestAnimationFrame(draw);
  if (time - prev < 1000 / 30) return;
  const dt = Math.min(0.1, (time - prev) / 1000);
  prev = time;
  const canvas = document.querySelector<HTMLCanvasElement>("#arena");
  if (!canvas || !state) return;
  if (graphicsFailed) return;
  try {
    world3d ??= new Arena3D();
  } catch (e) {
    graphicsFailed = true;
    const overlay = document.querySelector("#arena-overlay");
    if (overlay)
      overlay.innerHTML =
        "<strong>3D graphics unavailable</strong><p>Enable WebGL in your browser and reload to play.</p>";
    console.error(e);
    return;
  }
  if (world3d.renderer.domElement.dataset.contextLost === "true") {
    if (!graphicsPaused) {
      stopInput();
      graphicsPaused = true;
    }
    const message = document.querySelector("#arena-overlay");
    if (message)
      message.innerHTML =
        "<strong>Restoring 3D…</strong><p>Your controls are stopped while graphics reconnect.</p>";
    return;
  }
  graphicsPaused = false;
  if (canvas !== world3d.renderer.domElement)
    canvas.replaceWith(world3d.renderer.domElement);
  const target = world3d.renderer.domElement,
    r = target.getBoundingClientRect();
  if (!r.width || !r.height) return;
  camera = smoothCamera(
    camera,
    cameraTarget(state, host && hostReady && followCamera),
    dt,
  );
  world3d.render(state, time, dt, camera, identity, r.width, r.height);
  const fx = document.querySelector<HTMLCanvasElement>("#arena-fx")!,
    ctx = fx.getContext("2d")!;
  const dpr = Math.min(2, devicePixelRatio);
  if (
    fx.width !== Math.round(r.width * dpr) ||
    fx.height !== Math.round(r.height * dpr)
  ) {
    fx.width = Math.round(r.width * dpr);
    fx.height = Math.round(r.height * dpr);
  }
  ctx.setTransform(fx.width / 1320, 0, 0, fx.height / 800, 0, 0);
  ctx.clearRect(0, 0, 1320, 800);
  world3d.drawLabels(
    ctx,
    state,
    identity,
    join && matchMedia("(pointer:coarse)").matches,
  );
  if (host && hostReady && followCamera) drawOverview(ctx, camera);
  const overlay = document.querySelector<HTMLElement>("#arena-overlay")!;
  const phase = state.phase;
  let html = "";
  if (["COUNTDOWN", "KICKOFF_COUNTDOWN"].includes(phase)) {
    const n = Math.max(
      1,
      Math.ceil((state.deadline - (Date.now() + serverOffset)) / 1000),
    );
    html = `<span class="eyebrow">${n > 3 ? "GET READY" : "GET SET"}</span><strong>${n > 3 ? "GET READY" : n}</strong><p>MOVE · Joystick &nbsp; PASS · Tap &nbsp; SHOOT · Hold &nbsp; DASH · Button</p>`;
    if (n !== countdownNote && sound) {
      playSound("go");
      countdownNote = n;
    }
  } else countdownNote = -1;
  if (phase === "REORG") {
    html = reorgView(state, identity);
    drawCelebration(ctx, time, true);
  }
  if (phase === "WAITING")
    html = `<span class="pitch-lobby-badge"><i></i> THE STAGE IS SET</span><span class="pitch-vs"><b>LEADERS</b><i>VS</i><b>WORKERS</b></span><span class="pitch-subtitle">BRING YOUR TEAM. LEAVE YOUR JOB TITLE.</span>`;
  if (phase === "PAUSED")
    html =
      '<span class="eyebrow">TAKE A BREATHER</span><strong>PAUSED</strong><p>Waiting for the host to resume</p>';
  if (phase === "GOAL" && state.celebration) {
    const c = state.celebration;
    html = `<span class="eyebrow">${c.team}</span><strong class="goal-word">GOOOAL!</strong><p>⚽ ${esc(c.scorer)}</p>${c.passes >= 3 ? `<div class="team-goal">🤝 TEAM GOAL · ${c.passes} PASSES</div>` : ""}`;
    drawConfetti(ctx, time);
  }
  if (phase === "FINISHED") {
    const winner =
      state.score.LEADERS === state.score.WORKERS
        ? "A MATCH TO REMEMBER"
        : `${state.score.LEADERS > state.score.WORKERS ? "LEADERS" : "WORKERS"} WIN!`;
    html = `<span class="eyebrow">${state.ended ? "MATCH ENDED BY HOST" : "FULL TIME"}</span><strong>${state.score.LEADERS} — ${state.score.WORKERS}</strong><h2>🏆 ${winner}</h2><p>Same office. New bragging rights.</p>`;
    drawConfetti(ctx, time);
  }
  if (phase === "GOLDEN_GOAL")
    html =
      '<span class="golden-banner">✦ GOLDEN GOAL · NEXT GOAL WINS ✦</span>';
  if (phase === "PLAYING" && Date.now() + serverOffset - state.deadline < 700)
    html = "<strong>GO!</strong>";
  if (phase === "PLAYING" && state.remaining <= 10)
    html = `<strong class="final-count">${Math.ceil(state.remaining)}</strong>`;
  if (phase === "PLAYING" && state.remaining <= 60 && state.remaining > 56)
    html = '<span class="golden-banner">🔥 FINAL MINUTE 🔥</span>';
  if (overlayElement !== overlay || overlayHtml !== html) {
    overlay.innerHTML = html;
    overlayHtml = html;
    overlayElement = overlay;
  }
  const overlayClass = `arena-overlay ${["PLAYING", "GOLDEN_GOAL"].includes(phase) ? "playing" : phase.toLowerCase()}`;
  const revealed =
    phase === "REORG" &&
    state.deadline - (Date.now() + serverOffset) <=
      (REORG.revealSeconds - REORG.introSeconds) * 1000;
  const finalOverlayClass = overlayClass + (revealed ? " reorg-revealed" : "");
  if (overlay.className !== finalOverlayClass)
    overlay.className = finalOverlayClass;
  const reorgSeconds = document.querySelector("#reorg-seconds");
  if (reorgSeconds)
    reorgSeconds.textContent = String(
      Math.max(
        0,
        Math.ceil((state.deadline - Date.now() - serverOffset) / 1000),
      ),
    );
  const bar = document.querySelector<HTMLElement>("#charge-bar");
  if (bar)
    bar.style.width = charging
      ? `${Math.min(100, (time - chargeStarted) / 10)}%`
      : "0%";
  const hint = document.querySelector<HTMLElement>("#possession-hint");
  if (hint) {
    const own = state.ball.owner === identity;
    hint.classList.toggle("has-ball", own);
    hint.textContent = own
      ? charging
        ? "◉ CHARGING SHOT… RELEASE TO SHOOT"
        : "● YOUR BALL · TAP PASS / HOLD SHOOT"
      : "◎ CHASE THE BALL";
  }
  const shoot = document.querySelector<HTMLButtonElement>("#shoot");
  if (shoot) {
    const charge = charging ? Math.min(100, (time - chargeStarted) / 10) : 0;
    shoot.style.setProperty("--charge", `${charge}%`);
    const text = shoot.querySelector("small");
    if (text) text.textContent = charging ? "RELEASE TO SHOOT" : "PASS / SHOOT";
  }
  const dash = document.querySelector<HTMLButtonElement>("#dash");
  if (dash) {
    const p = me();
    const cooldown = p
      ? Math.max(0, (p.dashReady - Date.now() - serverOffset) / 1000)
      : 0;
    dash.style.opacity = cooldown > 0 ? ".65" : "1";
    const label = dash.querySelector("small");
    if (label)
      label.textContent = cooldown > 0 ? `${cooldown.toFixed(1)}s` : "DASH";
  }
}
function drawOverview(c: CanvasRenderingContext2D, view: Camera) {
  if (!state) return;
  c.save();
  c.translate(1060, 625);
  c.fillStyle = "#0b1b16ed";
  c.strokeStyle = "#cfe4b344";
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(-10, -25, 240, 165, 8);
  c.fill();
  c.stroke();
  c.fillStyle = "#cadcb8";
  c.font = "10px sans-serif";
  c.textAlign = "left";
  c.fillText("FULL FIELD", 0, -9);
  c.scale(220 / 1200, 120 / 700);
  c.fillStyle = "#294f3b";
  c.fillRect(0, 0, 1200, 700);
  c.strokeStyle = "#b9cbb366";
  c.lineWidth = 5;
  c.strokeRect(0, 0, 1200, 700);
  c.beginPath();
  c.moveTo(600, 0);
  c.lineTo(600, 700);
  c.stroke();
  c.beginPath();
  c.rect(0, 0, 1200, 700);
  c.clip();
  for (const p of state.players) {
    c.fillStyle = p.team === "LEADERS" ? "#72b2f0" : "#f7aa70";
    c.beginPath();
    c.arc(p.x, p.y, 16, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = "#fffce1";
  c.beginPath();
  c.arc(state.ball.x, state.ball.y, 16, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#dbf995";
  c.lineWidth = 7;
  c.strokeRect(
    view.x - 660 / view.zoom - 60,
    view.y - 400 / view.zoom - 50,
    1320 / view.zoom,
    800 / view.zoom,
  );
  c.restore();
}
function drawConfetti(c: CanvasRenderingContext2D, t: number) {
  drawCelebration(c, t, state?.celebration?.team === "LEADERS");
}

app.innerHTML =
  header() +
  '<main class="loading"><span class="eyebrow">OFFICE ARENA</span><h1>Warming up the pitch…</h1></main>';
connect();
requestAnimationFrame(draw);
