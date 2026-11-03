import { TEAMS, type AudienceState, type Team } from "./shared";
import { predictionSummary, predictionMark } from "./prediction-view";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Audience phones poll a small summary; no player socket or 3D scene is created. */
export function startAudience(app: HTMLElement) {
  let state: AudienceState | null = null,
    saving = false,
    error = "",
    online = true;
  let revision = 0,
    polling = false;
  let signature = "",
    timer: ReturnType<typeof setTimeout> | undefined;
  const status = () => {
    if (!state) return "CONNECTING";
    const p = state.predictions;
    if (p.outcome === "VOID") return "MATCH ENDED · NO PREDICTION RESULT";
    if (p.winner) return `${p.winner} WIN!`;
    return (
      (
        {
          WAITING: "WAITING FOR THE HOST",
          COUNTDOWN: "GET READY",
          PAUSED: "MATCH PAUSED",
          GOAL: "GOOOAL!",
          REORG: "THE REORG · SAME TEAMS, NEW FACES",
          KICKOFF_COUNTDOWN: "KICKOFF",
          GOLDEN_GOAL: "GOLDEN GOAL · NEXT GOAL WINS",
        } as Record<string, string>
      )[state.phase] ?? "LIVE FROM OFFICE ARENA"
    );
  };
  function render() {
    if (!state) {
      app.innerHTML = `<main class="audience-main"><span class="eyebrow">OFFICE / ARENA</span><h1>Joining the crowd…</h1><p role="status">${escape(error || "Getting the latest match.")}</p></main>`;
      return;
    }
    const p = state.predictions;
    const sig = JSON.stringify([
      p,
      state.pick,
      state.phase,
      state.score,
      saving,
      error,
      online,
    ]);
    if (sig !== signature) {
      signature = sig;
      const result =
        p.outcome === "VOID"
          ? "No result this time. The host ended the match."
          : p.winner
            ? state.pick
              ? state.pick === p.winner
                ? "YOU CALLED IT!"
                : "WHAT A MATCH. NEXT ONE IS YOURS."
              : "THE ROOM HAS ITS WINNER."
            : state.pick
              ? `YOU'RE BACKING ${state.pick}`
              : p.open
                ? "WHO TAKES THE WIN?"
                : "PICKS ARE LOCKED. THE SHOW IS ON.";
      app.innerHTML = `<header class="audience-header"><a class="brand" href="/screen"><span class="brand-icon">✦</span><span>OFFICE / ARENA<small>THE CROWD IS PART OF THE GAME</small></span></a><a class="text-link" href="/join">Play instead</a></header><main class="audience-main"><span class="eyebrow">${p.open ? "YOUR SEAT IN THE STANDS" : "YOU'RE PART OF THE SHOW"}</span><h1>${p.open ? "Off the pitch.<br><em>Still in the game.</em>" : "Back your team.<br><em>Feel every goal.</em>"}</h1><p class="audience-intro">${p.open ? "Pick the team you think will win. One pick per browser. Change your mind until the host starts." : "Follow the match on the big screen. Your pick is locked in—now cheer them on!"}</p><section class="audience-match"><div class="audience-status" role="status">${status()}</div><div class="audience-score"><span>LEADERS</span><strong>${state.score.LEADERS}<i>:</i>${state.score.WORKERS}</strong><span>WORKERS</span></div><div class="audience-clock" id="audience-clock"></div></section><section class="prediction-pick"><div class="eyebrow" id="your-prediction">${result}</div><div class="prediction-options">${TEAMS.map((team) => `<button class="prediction-option ${team.toLowerCase()} ${state!.pick === team ? "is-picked" : ""}" data-predict="${team}" aria-pressed="${state!.pick === team}" ${!p.open || saving || !online ? "disabled" : ""}><span aria-hidden="true">${predictionMark(team)}</span><strong>${team}</strong><small>${state!.pick === team ? "✓ YOUR PICK" : p.open ? "PICK TO WIN" : "PICKS CLOSED"}</small></button>`).join("")}</div><p class="prediction-note">${p.open ? "Locks when the host starts · No money, just bragging rights" : state.pick ? "Your pick is locked in. Make some noise for your side!" : "You can make a pick when the next prediction lobby opens."}</p><div class="prediction-error" role="alert">${escape(error)}</div></section>${predictionSummary(p)}<p class="audience-connection" role="status">${online ? "● LIVE MATCH UPDATES" : "Reconnecting… Showing the last update."}</p><p class="prediction-fineprint">No accounts. No stakes. Just a room full of opinions.</p></main>`;
      app
        .querySelectorAll<HTMLButtonElement>("[data-predict]")
        .forEach((button) =>
          button.addEventListener(
            "click",
            () => void choose(button.dataset.predict as Team),
          ),
        );
    }
    const clock = app.querySelector("#audience-clock");
    if (clock) {
      const remaining = Math.ceil(state.remaining);
      clock.textContent = state.golden
        ? "∞ GOLDEN GOAL"
        : `${Math.floor(remaining / 60)
            .toString()
            .padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
    }
  }
  async function response(res: Response) {
    const data = await res.json();
    if (!res.ok)
      throw Error(data.message || "Couldn't save your pick. Try again.");
    return data as AudienceState;
  }
  async function refresh() {
    if (saving) return;
    const version = revision;
    try {
      const data = await response(
        await fetch("/api/audience", {
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.timeout(8000),
        }),
      );
      if (!saving && version === revision) {
        if (!online) error = "";
        state = data;
        online = true;
      }
    } catch {
      if (!saving && version === revision) {
        online = false;
        if (!state) error = "Connection interrupted. Retrying automatically…";
      }
    }
    render();
  }
  async function choose(team: Team) {
    if (!state?.predictions.open || saving || !online) return;
    const roundId = state.predictions.roundId;
    revision++;
    saving = true;
    error = "";
    render();
    try {
      state = await response(
        await fetch("/api/audience", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team, roundId }),
          signal: AbortSignal.timeout(8000),
        }),
      );
      online = true;
    } catch (e) {
      if (e instanceof TypeError || e instanceof DOMException) {
        online = false;
        error = "Couldn't save your pick. Reconnecting…";
      } else
        error = e instanceof Error ? e.message : "Couldn't save your pick.";
    } finally {
      saving = false;
      render();
      await refresh();
    }
  }
  async function poll() {
    if (polling) return;
    polling = true;
    await refresh();
    polling = false;
    timer = setTimeout(poll, document.hidden ? 10000 : 2000);
  }
  window.addEventListener("pageshow", () => {
    if (timer) {
      clearTimeout(timer);
      void poll();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && timer) {
      clearTimeout(timer);
      void poll();
    }
  });
  render();
  void poll();
}
