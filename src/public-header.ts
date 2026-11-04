/** Shared navigation for player, audience and spectator pages; host stays separate. */
export function publicHeader(
  active: "play" | "watch" | "predict",
  online: boolean,
) {
  return `<header class="public-header"><a class="brand" href="/screen" aria-label="Office Arena"><span class="brand-icon" aria-hidden="true">✦</span><span>OFFICE<span class="brand-light"> / </span>ARENA<small>LEADERS VS WORKERS</small></span></a><nav aria-label="Main navigation">${(
    [
      ["watch", "/screen", "Watch"],
      ["play", "/join", "Play"],
      ["predict", "/predict", "Predict"],
    ] as const
  )
    .map(
      ([key, url, label]) =>
        `<a href="${url}" class="${active === key ? "current" : ""}" ${active === key ? 'aria-current="page"' : ""}>${label}</a>`,
    )
    .join(
      "",
    )}</nav><div class="connection" role="status"><i class="${online ? "" : "offline"}"></i>${online ? "Connected" : "Reconnecting…"}</div></header>`;
}
