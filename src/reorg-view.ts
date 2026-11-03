import { TEAMS, type Snapshot } from "./shared";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** A single roster reveal shared by host, projector and player views. */
export function reorgView(state: Snapshot, localId: string | null) {
  const local = state.players.find((p) => p.id === localId);
  return `<div class="reorg-intro"><span class="eyebrow">A MESSAGE FROM THE ORGANIZATION</span><div class="reorg-symbol"><svg width="110" height="65" viewBox="0 0 110 65" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="#88d8ff" d="M12 18H98M81 5l17 13-17 13"/><path stroke="#ffc38a" d="M98 47H12m17-13L12 47l17 13"/></svg></div><strong>REORG!</strong><p>The org chart just changed.</p></div>
 <section class="reorg-board"><div class="reorg-heading"><span class="eyebrow">THE REORG HAS HIT</span><h2>MEET YOUR NEW TEAM</h2><p>One minute. A whole new org chart.</p></div>
 ${local ? `<div class="reorg-local ${local.team.toLowerCase()}" role="status" aria-live="assertive">YOUR NEW TEAM <strong>${local.team}</strong></div>` : ""}
 <div class="reorg-teams">${TEAMS.map(
   (team) =>
     `<section class="reorg-team ${team.toLowerCase()}"><h3><span>${team === "LEADERS" ? '<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>' : "✳"}</span>${team}<small>${state.players.filter((p) => p.team === team).length} PLAYERS</small></h3><ul>${
       state.players
         .filter((p) => p.team === team)
         .map((p) => {
           const before = state.reorg?.assignments.find((a) => a.id === p.id);
           const moved = before && before.fromTeam !== p.team;
           return `<li class="${p.id === localId ? "is-you" : ""}"><span class="reorg-avatar">${escape(p.name.slice(0, 2).toUpperCase())}</span><strong>${escape(p.name)}${p.keeper ? ' <span class="reorg-glove" title="Goalkeeper">🧤</span>' : ""}</strong><small>${p.id === localId ? "YOU" : !p.connected ? "RECONNECTING" : moved ? `FROM ${before.fromTeam}` : "SAME SIDE"}</small>${moved ? "<i>⇄</i>" : ""}</li>`;
         })
         .join("") || '<li class="reorg-empty">No players on this team</li>'
     }</ul></section>`,
 ).join("")}</div>
 <div class="reorg-resume"><span>NEW KITS. FRESH KICKOFF.</span><span>Countdown begins in <b id="reorg-seconds">10</b>s</span></div></section>`;
}
