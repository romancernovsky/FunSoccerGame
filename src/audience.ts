import { publicHeader } from "./public-header";
import {
  TEAMS,
  teamName,
  teamClass,
  type AudienceState,
  type Team,
} from "./shared";
import { predictionSummary } from "./prediction-view";

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
    if (p.outcome === "VOID") return "MATCH ENDED";
    if (p.winner) return `${teamName(p.winner)} WINS!`;
    return (
      (
        {
          WAITING: "WAITING FOR THE HOST",
          COUNTDOWN: "GET READY",
          RULES_COUNTDOWN: "NEW RULES. SAME TEAMS. PLAY ON.",
          PAUSED: "MATCH PAUSED",
          GOAL: "GOOOAL!",
          KICKOFF_COUNTDOWN: "KICKOFF",
          GOLDEN_GOAL: "GOLDEN GOAL · NEXT GOAL WINS",
        } as Record<string, string>
      )[state.phase] ?? "LIVE"
    );
  };
  function render() {
    if (!state) {
      app.innerHTML = `<main class="audience-main public-content"><h1>Bet</h1><p role="status">${escape(error || "Connecting…")}</p></main>`;
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
          ? "Match ended. No result."
          : p.winner
            ? state.pick === p.winner
              ? "Your bet won!"
              : `${teamName(p.winner)} wins`
            : state.pick
              ? `Your bet: ${teamName(state.pick)}`
              : p.open
                ? "Choose a team"
                : "Bets closed";
      app.innerHTML = `${publicHeader("bet", online)}<main class="audience-main public-content simple-panel"><h1>Bet on the winner</h1><p class="bet-note">For fun. No money.</p>${state.phase !== "WAITING" ? `<section class="audience-match"><div class="audience-status" role="status">${status()}</div><div class="audience-score"><span>BLUE TEAM</span><strong>${state.score.BLUE}<i>:</i>${state.score.ORANGE}</strong><span>ORANGE TEAM</span></div><div class="audience-clock" id="audience-clock"></div></section>` : ""}<section class="prediction-pick"><p id="your-prediction" role="status">${result}</p><div class="prediction-options">${TEAMS.map((team) => `<button class="prediction-option ${teamClass(team)} ${state!.pick === team ? "is-picked" : ""}" data-predict="${team}" aria-pressed="${state!.pick === team}" ${!p.open || saving || !online ? "disabled" : ""}><strong>${teamName(team)}</strong><small>${state!.pick === team ? "✓ Your bet" : p.open ? "Bet" : "Closed"}</small></button>`).join("")}</div>${p.open ? '<p class="prediction-note">Bets stay open until full time.</p>' : ""}<div class="prediction-error" role="alert">${escape(error)}</div></section>${predictionSummary(p)}${!online ? '<p class="audience-connection" role="status">Reconnecting…</p>' : ""}</main>`;
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
      throw Error(data.message || "Couldn't save your bet. Try again.");
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
        error = "Couldn't save your bet. Reconnecting…";
      } else error = e instanceof Error ? e.message : "Couldn't save your bet.";
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
