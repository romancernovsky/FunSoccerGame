import { MatchAudio } from "./audio";
import "./audio.css";
import { publicHeader } from "./public-header";
import { displayCapabilities, showDisplayHelp } from "./display-mode";
import { startAudience } from "./audience";
import { predictionSummary } from "./prediction-view";
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
import {
  cameraTarget,
  visibleHalfExtents,
  type Viewport,
  smoothCamera,
  overview,
  type Camera,
} from "./camera";
import QRCode from "qrcode";
import {
  DEFAULT_MATCH_DURATION_SECONDS,
  FIELD as F,
  REORG,
  TEAMS,
  type Snapshot,
  type Team,
  type Input,
  type Player,
} from "./shared";
import "./style.css";
import "./mobile-game.css";
import "./mobile-pages.css";
const arrow =
  '<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
const app = document.querySelector<HTMLDivElement>("#app")!;
const route = location.pathname;
const host = route === "/host",
  join = route === "/join";
document.body.classList.toggle("public-page", !host);
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
  charging = false,
  chargeStarted = 0;
const matchAudio =
  !join && route !== "/predict" ? new MatchAudio(updateAudioUI) : null;
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
    : `${Math.floor(
        Math.ceil(state?.remaining ?? DEFAULT_MATCH_DURATION_SECONDS) / 60,
      )
        .toString()
        .padStart(
          2,
          "0",
        )}:${(Math.ceil(state?.remaining ?? DEFAULT_MATCH_DURATION_SECONDS) % 60).toString().padStart(2, "0")}`;
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
        matchAudio?.observe(state!);
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
  if (!host) return publicHeader(join ? "play" : "watch", connected);
  return `<header><a class="brand" href="/"><span class="brand-icon">✦</span><span>OFFICE<span class="brand-light"> / </span>ARENA<small>LEADERS VS WORKERS</small></span></a><nav><a class="${!host && !join ? "current" : ""}" href="/screen">Spectator</a><a class="${join ? "current" : ""}" href="/join">Join game <span>↗</span></a><a href="/predict">Predict the winner</a>${host ? '<a class="current" href="/host">Host console</a>' : ""}</nav><div class="connection"><i class="${connected ? "" : "offline"}"></i>${connected ? "LIVE CONNECTION" : "RECONNECTING"}</div></header>`;
}
function teamCard(team: Team, manage = false) {
  const ps = state?.players.filter((p) => p.team === team) ?? [];
  const emptyMessage =
    !manage && !ps.length
      ? '<div class="roster-empty-message">No players yet. There’s room on this team.</div>'
      : "";
  const spots = (state?.maxTeamSize ?? 6) - ps.length;
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
  )}${emptyMessage}</div><div class="team-footer">${ps.length === (state?.maxTeamSize ?? 6) ? "TEAM FULL" : manage ? "OPEN FOR BUSINESS" : `${spots} ${spots === 1 ? "spot" : "spots"} available`}<span>${ps.filter((p) => p.connected).length} connected</span></div></section>`;
}
function qrCard() {
  return `<div class="join-card"><span class="eyebrow">YOUR NEXT TEAM MEETING, UPGRADED</span><h2>Less talk.<br>More football.</h2><p>Pick a side. Rally your team.<br>Settle it on the pitch.</p><div class="qr-wrap"><canvas id="qr"></canvas><span class="qr-corner">${arrow}</span></div><strong>Scan to play or predict</strong><a class="primary phone-join" href="/join">PLAY OR PREDICT</a><a class="join-link" href="/join">${esc(location.host)}/join</a><div class="quick-facts"><span>◷ 3 minutes</span><span>♙ 12 players</span><span>▣ Any browser</span></div></div>`;
}
function scoreboard(player = false) {
  return `<div class="scoreboard${player ? " player-scoreboard" : ""}"><div class="score-team blue"><span>${arrow}</span> LEADERS</div><div class="score"><b id="score-l">${state?.score.LEADERS ?? 0}</b><span>:</span><b id="score-w">${state?.score.WORKERS ?? 0}</b></div><div class="score-team orange">WORKERS <span>✳</span></div><div class="clock-wrap"><small id="clock-label">${state?.golden ? "NEXT GOAL WINS" : active() ? "MATCH TIME" : "MATCH DURATION"}</small><strong id="clock">${clock()}</strong></div></div>`;
}
function arena() {
  const predictions = state?.predictions;
  const leaders = predictions?.total
    ? Math.round((predictions.totals.LEADERS / predictions.total) * 100)
    : 0;
  return `<div class="arena-wrap"><canvas id="arena" aria-label="Live 3D football arena"></canvas><canvas id="arena-fx" aria-hidden="true"></canvas><div id="arena-overlay" class="arena-overlay"></div><span class="pitch-label">OFFICE ARENA / ${state?.phase === "WAITING" ? "PRE-MATCH" : "LIVE MATCH"}</span><span class="pitch-watermark">EASY TO PLAY. FUN TO WATCH.</span>${!join && state?.predictions.total && ["WAITING", "PLAYING", "GOLDEN_GOAL"].includes(state.phase) ? `<div class="crowd-live"><span>AUDIENCE PICKS</span><b>${leaders}% LEADERS</b><b>${100 - leaders}% WORKERS</b></div>` : ""}</div>`;
}
function controls() {
  return `<div class="mobile-controls"><div id="joystick" class="joystick" aria-label="Movement joystick"><span id="stick"></span><small>MOVE</small></div><div class="action-controls"><button id="dash" class="dash" aria-label="Dash"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m10 5 7 7-7 7M3 12h14M17 5l5 7-5 7"/></svg><small>DASH</small></button><button id="shoot" class="shoot" aria-label="Pass or shoot: tap to pass, hold and release to shoot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m12 8 4 3-1.5 4h-5L8 11zM12 4v4M20 10l-4 1M17 19l-2.5-4M7 19l2.5-4M4 10l4 1"/></svg><small>PASS / SHOOT</small><span id="charge-bar"></span></button></div></div><div class="rotate"><span>↻</span><h2>Rotate your phone to play</h2><p>Turn sideways to follow the action.</p></div>`;
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
let playerOverview = false;
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
  if (enabled && requestBrowser) {
    const capabilities = displayCapabilities();
    if (!capabilities.native) {
      showDisplayHelp(capabilities.appleTouch);
      return;
    }
  }
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
    // Native fullscreen is requested only when the browser advertises support.
    void Promise.resolve(
      (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root),
    )
      .then(() => {
        if (!playerFullscreen) exitBrowserFullscreen();
      })
      .catch(() => {
        setPlayerFullscreen(false, false);
        showDisplayHelp(displayCapabilities().appleTouch);
      });
  } catch {
    setPlayerFullscreen(false, false);
    showDisplayHelp(displayCapabilities().appleTouch);
  }
}
function playerToolbar() {
  const capabilities = displayCapabilities();
  const help = !capabilities.native && !capabilities.standalone;
  const label = capabilities.standalone
    ? "Home Screen app: browser bars hidden"
    : help
      ? capabilities.appleTouch
        ? "Play without Safari bars"
        : "Fullscreen options"
      : `${playerFullscreen ? "Exit" : "Enter"} full screen`;
  const attackRight = me()?.team !== "WORKERS";
  return `<div class="player-view-tools"><button id="player-camera" class="secondary compact" aria-label="${playerOverview ? "Follow the ball" : "Show full field"}" aria-pressed="${playerOverview}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 5v14"/><circle cx="12" cy="12" r="3"/></svg><span>${playerOverview ? "BALL" : "FIELD"}</span></button><span class="attack-direction ${me()?.team.toLowerCase() ?? ""}" aria-label="Attack ${attackRight ? "right" : "left"}">${attackRight ? "ATTACK →" : "← ATTACK"}</span></div><div class="player-toolbar"><button class="secondary compact" id="player-fullscreen" aria-label="${label}" aria-pressed="${playerFullscreen}" ${capabilities.standalone ? "disabled" : ""}><b aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${playerFullscreen ? "M3 8h5V3M16 3v5h5M3 16h5v5M16 21v-5h5" : "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"}"/></svg></b><span>${capabilities.standalone ? "App view" : help ? "Screen options" : playerFullscreen ? "Exit full screen" : "Full screen"}</span></button></div>`;
}
function audioLabel() {
  return {
    off: "Enable sound",
    enabling: "Enabling…",
    on: "Sound on",
    blocked: "Resume sound",
    unavailable: "Sound unavailable",
  }[matchAudio?.status ?? "off"];
}
function audioPanel() {
  if (!matchAudio) return "";
  return `<section class="audio-panel" aria-label="Match audio"><div class="audio-description"><strong>Match sound</strong><span id="audio-status" role="status"></span></div><div class="audio-actions"><button id="sound" class="primary compact" data-audio-action="toggle" aria-pressed="${matchAudio.ready}">${audioLabel()}</button><button id="test-sound" class="secondary compact" data-audio-action="test">Test sound</button><label>Volume<input id="volume" data-audio-volume aria-label="Master volume" type="range" min="0" max="1" step="0.05" value="${matchAudio.volume}"></label></div></section>`;
}
function updateAudioUI() {
  if (!matchAudio) return;
  const { status, volume } = matchAudio;
  document
    .querySelectorAll<HTMLButtonElement>('[data-audio-action="toggle"]')
    .forEach((button) => {
      button.textContent = audioLabel();
      button.setAttribute("aria-pressed", String(matchAudio.ready));
      button.disabled = status === "unavailable";
    });
  document
    .querySelectorAll<HTMLButtonElement>('[data-audio-action="test"]')
    .forEach((button) => {
      button.disabled = status === "enabling" || status === "unavailable";
    });
  document
    .querySelectorAll<HTMLInputElement>("[data-audio-volume]")
    .forEach((slider) => {
      slider.value = String(volume);
    });
  const panel = document.querySelector<HTMLElement>(".audio-panel");
  if (panel) panel.dataset.status = status;
  const message = document.querySelector("#audio-status");
  if (message)
    message.textContent = {
      off: "Enable sound on the display or tab you will broadcast.",
      enabling: "Waiting for browser audio…",
      on:
        volume === 0
          ? "Volume is 0%. Raise the volume to hear the match."
          : `Sound enabled · ${Math.round(volume * 100)}% volume. Test your speakers before starting.`,
      blocked:
        "Audio was blocked or interrupted. Tap Resume sound. Check device volume if it stays silent.",
      unavailable:
        "This browser could not start audio. Try Safari, Chrome or Edge.",
    }[status];
}
function watchToolbar() {
  return `<div class="watch-toolbar"><span class="eyebrow"><i class="live-dot"></i> LIVE BROADCAST</span><div><button class="secondary compact" id="watch-sound" data-audio-action="toggle" aria-pressed="${matchAudio?.ready ?? false}">${audioLabel()}</button><button class="secondary compact" data-audio-action="test">Test sound</button><label class="watch-volume">Volume<input id="watch-volume" data-audio-volume aria-label="Broadcast volume" type="range" min="0" max="1" step="0.05" value="${matchAudio?.volume ?? 0.6}"></label><button class="secondary compact" id="camera-mode" aria-pressed="${followCamera}">${followCamera ? "◎ Ball-follow camera" : "▣ Full field"}</button><button class="primary compact" id="broadcast-mode" aria-pressed="${broadcast}">${broadcast ? "↙ Exit broadcast" : "⛶ Broadcast mode"}</button></div></div>`;
}
function hostPanel() {
  if (!hostReady)
    return `<section class="pin-panel"><span class="eyebrow">MATCH CONTROL</span><h1>Connecting to the control room…</h1><p>Your host console will open automatically.</p><div id="error" role="alert">${esc(error)}</div></section>`;
  return `<div class="section-top host-console-heading"><div><span class="eyebrow">THE CONTROL ROOM</span><h1>Run the show<span class="accent">.</span></h1></div><a class="text-link" href="/screen" target="_blank">Open projector ↗</a></div>${active() ? `<section id="host-watch" class="host-watch">${watchToolbar()}${scoreboard()}${arena()}${!connected ? '<div class="watch-disconnected">Reconnecting to the live match…</div>' : ""}</section>` : scoreboard()}<div class="host-actions">${state?.phase === "WAITING" ? `<button class="primary" data-command="start" ${TEAMS.some((t) => !state?.players.some((p) => p.team === t && p.connected)) ? "disabled" : ""}>▶ START MATCH</button>${state?.dev ? '<button class="secondary" data-command="bots">＋ Fill with Test Players</button>' : ""}<button class="secondary" data-command="reset">Reset lobby</button>` : state?.phase === "FINISHED" ? '<button class="primary" data-command="rematch">↻ REMATCH</button><button class="secondary" data-command="rematch_lobby" title="Keep teams and reopen audience predictions; start manually">REMATCH LOBBY</button><button class="secondary" data-command="new">NEW MATCH</button>' : `<button class="primary" data-command="${state?.phase === "PAUSED" ? "resume" : "pause"}">${state?.phase === "PAUSED" ? "▶ RESUME" : "Ⅱ PAUSE"}</button><button class="secondary" data-command="restart">↻ RESTART MATCH</button><button class="danger" data-command="end">END MATCH</button>`}</div><p class="host-warning">${state?.phase === "WAITING" ? (TEAMS.some((t) => !state?.players.some((p) => p.team === t && p.connected)) ? "Both teams need at least one connected player." : count("LEADERS") !== count("WORKERS") ? "⚠ Teams are uneven. The host decides when to start." : "Ready when you are. The match never starts automatically.") : `${state?.phase.replaceAll("_", " ")} · Official server timer`}</p><div id="error" role="alert">${esc(error)}</div>${state ? predictionSummary(state.predictions) : ""}<div class="teams-grid">${TEAMS.map((t) => teamCard(t, true)).join("")}</div>`;
}
function joinPanel() {
  const p = me();
  if (p) {
    if (active())
      return `<div class="player-game">${playerToolbar()}${scoreboard(true)}${arena()}${controls()}${!connected ? '<div class="network-banner">Reconnecting… Your place is reserved.</div>' : ""}<div class="player-help"><span class="you-chip ${p.team.toLowerCase()}">● YOU: ${esc(p.name)} ${p.keeper ? "🧤" : ""}</span><span>WASD / ARROWS <i>Move</i> &nbsp; SPACE <i>Tap to pass · Hold to shoot</i> &nbsp; SHIFT <i>Dash</i></span></div></div>`;
    return `<div class="waiting-layout"><section class="joined-card"><div class="joined-top"><span class="eyebrow">YOU ARE IN</span><div class="check-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6"/></svg></div></div><h1><small>TEAM</small><span class="${p.team === "LEADERS" ? "blue" : "orange"}">${p.team}</span></h1><p>Welcome, <strong>${esc(p.name)}</strong>.</p><div class="waiting-pill" role="status"><i></i>Waiting for host…</div><p class="lobby-note">Keep this page open. You’ll enter the pitch when the host starts.</p><div class="how-to"><span class="lobby-control"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg><span><strong>Move</strong><small><span class="touch-hint">Left joystick</span><span class="keyboard-hint">WASD / arrow keys</span></small></span></span><span class="lobby-control"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="6" cy="12" r="3"/><path d="M11 12h10m-5-5 5 5-5 5"/></svg><span><strong>Pass</strong><small><span class="touch-hint">Tap the ball button</span><span class="keyboard-hint">Tap Space</span></small></span></span><span class="lobby-control"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="6" cy="18" r="3"/><path d="M10 14 21 3M13 3h8v8"/></svg><span><strong>Shoot</strong><small>Hold, then release</small></span></span><span class="lobby-control"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m4 5 7 7-7 7M12 5l7 7-7 7"/></svg><span><strong>Dash</strong><small><span class="touch-hint">Tap DASH</span><span class="keyboard-hint">Press Shift</span></small></span></span></div></section>${teamCard(p.team)}</div>`;
  }
  if (active())
    return `<section class="pin-panel"><span class="eyebrow">THE PITCH IS BUSY</span><h1>Match in progress<span class="accent">.</span></h1><p>Please wait for the next game.</p><a class="primary" href="/predict">FOLLOW AUDIENCE PICKS ${arrow}</a><a class="text-link" href="/screen">Watch the match ${arrow}</a></section>`;
  const display = displayCapabilities();
  const launchTip =
    display.appleTouch && !display.native && !display.standalone
      ? '<aside class="ios-launch-tip"><div class="install-pitch"><img src="/icons/arena-192.png" alt="" width="44" height="44"><p><strong>Play without Safari bars.</strong><br>Add a shortcut before joining.</p></div><button id="fullscreen-guide" class="secondary compact" aria-haspopup="dialog" aria-label="Add to Home Screen: show setup guide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 9H5v12h14V9h-3M12 15V2m-4 4 4-4 4 4"/></svg>ADD TO HOME SCREEN</button></aside>'
      : "";
  return `${launchTip}<aside class="audience-entry"><div><span class="eyebrow">${TEAMS.every((t) => count(t) >= (state?.maxTeamSize ?? 6)) ? "TEAMS FULL · YOUR MOMENT ISN’T OVER" : "MORE OF A SIDELINE STRATEGIST?"}</span><h2>Pick a winner. Bring the noise.</h2><p>No spot needed. Predict the winning team before the host starts.</p></div><a class="primary" href="/predict">PREDICT THE WINNER ${arrow}</a></aside><div class="join-layout"><section class="join-intro"><span class="eyebrow"><i class="live-dot"></i> ONE MEETING. TWO TEAMS. NO EXCUSES.</span><h1>Pick a side.<br> Make some<br> <em>noise.</em></h1><p>The three-minute showdown your<br>calendar didn't see coming.</p><div class="intro-bottom">LEADERS <span>VS</span> WORKERS <small>EASY TO PLAY. HARD TO COORDINATE. FUN TO WATCH.</small></div></section><section class="join-form-card"><span class="eyebrow">YOUR SPOT ON THE PITCH</span><h2>Let's play.</h2><form id="join-form"><label for="name">YOUR NAME <small>Keep it short. Make it yours.</small></label><input id="name" autocomplete="off" maxlength="12" placeholder="e.g. Alex" required><label>CHOOSE YOUR TEAM</label><div class="team-options">${TEAMS.map((t) => `<button type="button" class="team-option ${t.toLowerCase()} ${selected === t ? "selected" : ""}" data-team="${t}" aria-pressed="${selected === t}" ${count(t) >= (state?.maxTeamSize ?? 6) ? "disabled" : ""}><span>${t === "LEADERS" ? arrow : "✳"}</span><strong>${t}</strong><small>${count(t)} / ${state?.maxTeamSize ?? 6} ${count(t) >= (state?.maxTeamSize ?? 6) ? "· FULL" : "players"}</small></button>`).join("")}</div><div id="error" role="alert">${esc(error)}</div><button class="primary" ${!connected || TEAMS.every((t) => count(t) >= (state?.maxTeamSize ?? 6)) ? "disabled" : ""}>JOIN GAME ${arrow}</button><p class="form-note">No account. No downloads. Just a little friendly rivalry.</p></form></section></div>`;
}
function spectator() {
  if (active())
    return `<div class="match-heading"><span class="eyebrow"><i class="live-dot"></i> ${state?.golden ? "GOLDEN GOAL" : "LIVE FROM THE OFFICE ARENA"}</span><div class="spectator-view-tools"><button class="secondary compact" id="camera-mode" aria-pressed="${followCamera}" aria-label="${followCamera ? "Show full field" : "Follow the ball"}">${followCamera ? "◎ Ball-follow camera" : "▣ Full field"}</button><button class="secondary compact" id="fullscreen">⛶ Full screen</button></div></div>${scoreboard()}${arena()}${state ? predictionSummary(state.predictions) : ""}<div class="match-bottom"><span><i class="live-dot"></i> ${state?.players.filter((p) => p.connected).length} PLAYERS ON THE PITCH</span><span>BIG IDEAS. BIGGER GOALS.</span></div>`;
  return `<div class="section-top"><div><span class="eyebrow"><i class="live-dot"></i> THE ALL-HANDS SHOWDOWN</span><h1>Business as <em>unusual.</em></h1><p>The meeting can wait. The match is almost on.</p></div><div class="lobby-status"><span class="status-pill">PRE-MATCH LOBBY</span><strong>${count("LEADERS") + count("WORKERS")} <span>/ ${(state?.maxTeamSize ?? 6) * 2} PLAYERS JOINED</span></strong><small>Waiting for host to start</small></div></div><div class="lobby-layout"><div class="lobby-main">${scoreboard()}${arena()}<div class="teams-grid">${TEAMS.map((t) => teamCard(t)).join("")}</div></div>${qrCard()}</div>${state ? predictionSummary(state.predictions) : ""}<div class="rules-strip"><span><b>01</b> SCAN & PICK A TEAM</span><i>→</i><span><b>02</b> WAIT FOR THE WHISTLE</span><i>→</i><span><b>03</b> GIVE THE OFFICE SOMETHING TO TALK ABOUT</span></div>`;
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
    playerOverview,
    state.predictions,
    followCamera,
  ]);
  if (sig !== signature) {
    const name =
      (document.querySelector("#name") as HTMLInputElement)?.value ?? "";
    signature = sig;
    app.innerHTML =
      header() +
      audioPanel() +
      `<main class="${join && active() && me() ? "game-main" : host ? "" : "public-content"}">${host ? hostPanel() : join ? joinPanel() : spectator()}</main><footer><span>OFFICE ARENA <i>© 2026</i></span><span>A LITTLE RIVALRY. A LOT OF TEAM SPIRIT.</span><div><span>BUILT FOR THE TEAM.</span></div></footer>${notice ? `<div class="toast">${esc(notice)}</div>` : ""}`;
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
    .querySelector("#fullscreen-guide")
    ?.addEventListener("click", () => showDisplayHelp(true, false));
  document.querySelector("#player-camera")?.addEventListener("click", () => {
    stopInput();
    playerOverview = !playerOverview;
    signature = "";
    render();
  });
  document
    .querySelector("#player-fullscreen")
    ?.addEventListener("click", () => {
      setPlayerFullscreen(!playerFullscreen);
    });
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
  document
    .querySelectorAll<HTMLButtonElement>("[data-audio-action]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.audioAction === "test") matchAudio?.test();
        else matchAudio?.toggle();
      });
    });
  document
    .querySelectorAll<HTMLInputElement>("[data-audio-volume]")
    .forEach((slider) => {
      slider.addEventListener("input", () =>
        matchAudio?.setVolume(Number(slider.value)),
      );
    });
  updateAudioUI();
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
      const travel = Math.max(
        0,
        (Math.min(r.width, r.height) - knob.offsetWidth) / 2 - 3,
      );
      knob.style.transform = `translate(${joystick.x * travel}px,${joystick.y * travel}px)`;
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
    (e.target as HTMLElement).matches("input") ||
    !!document.querySelector("dialog[open]")
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
  if (document.querySelector("dialog[open]")) return;
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
  const phonePlayer =
    join && !!identity && matchMedia("(pointer: coarse)").matches;
  const viewport = { width: r.width, height: r.height };
  const follow = join && identity ? !playerOverview : followCamera;
  const framingTarget = cameraTarget(state, follow, viewport);
  camera = smoothCamera(
    camera,
    framingTarget,
    dt,
    viewport,
    framingTarget.zoom > 1
      ? { x: state.ball.x + 60, y: state.ball.y + 50 }
      : undefined,
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
  if (phonePlayer) {
    world3d.drawMobileBall(ctx, identity!);
  }
  if (join && identity) world3d.drawPlayerLocation(ctx, identity, phonePlayer);
  fx.dataset.cameraZoom = camera.zoom.toFixed(2);
  fx.dataset.cameraMode = follow ? "ball" : "field";
  if (host && hostReady && followCamera) drawOverview(ctx, camera, viewport);
  const overlay = document.querySelector<HTMLElement>("#arena-overlay")!;
  const phase = state.phase;
  let html = "";
  if (["COUNTDOWN", "KICKOFF_COUNTDOWN"].includes(phase)) {
    const n = Math.max(
      1,
      Math.ceil((state.deadline - (Date.now() + serverOffset)) / 1000),
    );
    html = `<span class="eyebrow">${n > 3 ? "GET READY" : "GET SET"}</span><strong>${n > 3 ? "GET READY" : n}</strong><p>MOVE · Joystick &nbsp; PASS · Tap &nbsp; SHOOT · Hold &nbsp; DASH · Button</p>`;
  }
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
    const winner = state.ended
      ? "THANKS FOR PLAYING"
      : state.score.LEADERS === state.score.WORKERS
        ? "A MATCH TO REMEMBER"
        : `${state.score.LEADERS > state.score.WORKERS ? "LEADERS" : "WORKERS"} WIN!`;
    html = `<span class="eyebrow">${state.ended ? "MATCH ENDED BY HOST" : "FULL TIME"}</span><strong>${state.score.LEADERS} — ${state.score.WORKERS}</strong><h2>${state.ended ? "" : "🏆 "}${winner}</h2><p>Same office. New bragging rights.</p>${!join && state.predictions.winner && state.predictions.total ? `<div class="audience-final">${state.predictions.totals[state.predictions.winner]} OF ${state.predictions.total} AUDIENCE MEMBERS CALLED IT!</div>` : ""}`;
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
  const shoot = document.querySelector<HTMLButtonElement>("#shoot");
  if (shoot) {
    const charge = charging ? Math.min(100, (time - chargeStarted) / 10) : 0;
    shoot.style.setProperty("--charge", `${charge}%`);
    shoot.classList.toggle("has-ball", state.ball.owner === identity);
    const text = shoot.querySelector("small");
    if (text) text.textContent = charging ? "RELEASE" : "PASS / SHOOT";
  }
  const dash = document.querySelector<HTMLButtonElement>("#dash");
  if (dash) {
    const p = me();
    const cooldown = p
      ? Math.max(0, (p.dashReady - Date.now() - serverOffset) / 1000)
      : 0;
    dash.style.opacity = "1";
    dash.classList.toggle("on-cooldown", cooldown > 0);
    const label = dash.querySelector("small");
    if (label)
      label.textContent = cooldown > 0 ? `${cooldown.toFixed(1)}s` : "DASH";
  }
}
function drawOverview(
  c: CanvasRenderingContext2D,
  view: Camera,
  viewport: Viewport,
) {
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
  const half = visibleHalfExtents(view, viewport);
  c.strokeRect(
    view.x - half.x - 60,
    view.y - half.y - 50,
    half.x * 2,
    half.y * 2,
  );
  c.restore();
}
function drawConfetti(c: CanvasRenderingContext2D, t: number) {
  drawCelebration(c, t, state?.celebration?.team === "LEADERS");
}

app.innerHTML =
  header() +
  '<main class="loading"><span class="eyebrow">OFFICE ARENA</span><h1>Warming up the pitch…</h1></main>';
if (route === "/predict") startAudience(app);
else {
  connect();
  requestAnimationFrame(draw);
}
