/** Two public choices. The host's stream is kept out of player navigation. */
export function publicHeader(active: "play" | "bet" | null, online: boolean) {
  return `<header class="public-header"><a class="brand" href="/" aria-label="Leaders vs Workers">LEADERS <span>vs</span> WORKERS</a><nav aria-label="Main navigation">${(
    [
      ["play", "/join", "Play"],
      ["bet", "/bet", "Bet"],
    ] as const
  )
    .map(
      ([key, url, label]) =>
        `<a href="${url}" class="${active === key ? "current" : ""}" ${active === key ? 'aria-current="page"' : ""}>${label}</a>`,
    )
    .join(
      "",
    )}</nav>${online ? "" : '<span class="public-offline" role="status">Reconnecting…</span>'}</header>`;
}
