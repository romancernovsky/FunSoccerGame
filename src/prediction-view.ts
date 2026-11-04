import type { Team, PredictionSummary } from "./shared";

export function predictionMark(team: Team) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${team === "LEADERS" ? "M5 19 19 5M5 5h14v14" : "M12 2v20M2 12h20M5 5l14 14M5 19 19 5"}"/></svg>`;
}

export function predictionSummary(p: PredictionSummary) {
  const leaders = p.total ? Math.round((p.totals.LEADERS / p.total) * 100) : 50;
  return `<section class="crowd-card" aria-label="Bets"><div class="crowd-heading"><strong>${p.total} ${p.total === 1 ? "bet" : "bets"}</strong><span class="crowd-lock">${p.open ? "Open" : p.outcome === "VOID" ? "No result" : p.outcome === "SETTLED" ? `${p.winner} win` : "Bets locked"}</span></div><div class="crowd-labels"><span>LEADERS <b>${p.total ? leaders + "%" : "—"}</b></span><span>WORKERS <b>${p.total ? 100 - leaders + "%" : "—"}</b></span></div><div class="crowd-track ${p.total ? "" : "empty"}" aria-hidden="true"><i style="width:${leaders}%"></i></div></section>`;
}
