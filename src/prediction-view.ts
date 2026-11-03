import type { Team, PredictionSummary } from "./shared";

export function predictionMark(team: Team) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${team === "LEADERS" ? "M5 19 19 5M5 5h14v14" : "M12 2v20M2 12h20M5 5l14 14M5 19 19 5"}"/></svg>`;
}

export function predictionSummary(p: PredictionSummary) {
  const leaders = p.total ? Math.round((p.totals.LEADERS / p.total) * 100) : 50;
  return `<section class="crowd-card" aria-label="Audience predictions"><div class="crowd-heading"><span class="eyebrow">THE CROWD HAS A SAY</span><strong>${p.total} audience ${p.total === 1 ? "pick" : "picks"}</strong><span class="crowd-lock">${p.open ? "OPEN UNTIL HOST STARTS" : p.outcome === "VOID" ? "NO RESULT" : p.outcome === "SETTLED" ? `${p.winner} WIN` : "PICKS LOCKED"}</span></div><div class="crowd-labels"><span>LEADERS <b>${p.total ? leaders + "%" : "—"}</b><small>${p.totals.LEADERS} ${p.totals.LEADERS === 1 ? "pick" : "picks"}</small></span><span>WORKERS <b>${p.total ? 100 - leaders + "%" : "—"}</b><small>${p.totals.WORKERS} ${p.totals.WORKERS === 1 ? "pick" : "picks"}</small></span></div><div class="crowd-track ${p.total ? "" : "empty"}" aria-hidden="true"><i style="width:${leaders}%"></i></div>${p.outcome === "SETTLED" ? `<p class="crowd-result">${p.totals[p.winner!]} audience ${p.totals[p.winner!] === 1 ? "member called" : "members called"} the winner!</p>` : ""}</section>`;
}
