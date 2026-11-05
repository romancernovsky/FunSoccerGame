/** Two public choices. The host's stream is kept out of player navigation. */
export function publicHeader(active: "play" | "bet" | null, online: boolean) {
  return `<header class="public-header"><a class="brand" href="/" aria-label="Blue Team vs Orange Team">BLUE TEAM <span>vs</span> ORANGE TEAM</a><nav aria-label="Main navigation">${(
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
