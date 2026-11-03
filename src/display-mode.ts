export type DisplayCapabilities = {
  native: boolean;
  appleTouch: boolean;
  standalone: boolean;
};
export function displayCapabilities(): DisplayCapabilities {
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  const nav = navigator as Navigator & { standalone?: boolean };
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: unknown;
  };
  return {
    native: !!(
      (doc.fullscreenEnabled && root.requestFullscreen) ||
      (doc.webkitFullscreenEnabled && root.webkitRequestFullscreen)
    ),
    appleTouch:
      /iPhone|iPad|iPod/.test(nav.userAgent) ||
      (nav.platform === "MacIntel" && nav.maxTouchPoints > 1),
    standalone:
      nav.standalone === true ||
      matchMedia("(display-mode: standalone)").matches,
  };
}
export function showDisplayHelp(appleTouch: boolean) {
  document.querySelector("#display-help")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "display-help";
  dialog.innerHTML = appleTouch
    ? `<span class="eyebrow">MORE ROOM TO PLAY</span><h2>Play without Safari bars.</h2><p>Safari cannot hide its address and tab bars from this page. Use a Home Screen web app for a standalone game view.</p><ol><li>In Safari, tap <strong>Share</strong>.</li><li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>. If shown, keep <strong>Open as Web App</strong> enabled.</li><li>Launch the new <strong>Office Arena</strong> icon and join there <strong>before the host starts</strong>.</li></ol><p class="display-help-note">Your player session may not transfer from Safari. If you already joined, keep playing here for this match; use the Home Screen app next time.</p><button class="primary" id="close-display-help">KEEP PLAYING HERE</button>`
    : `<span class="eyebrow">GAME DISPLAY</span><h2>Fullscreen is unavailable here.</h2><p>Your browser did not allow native fullscreen. The game still fills the available page. Try your browser’s fullscreen command or open the game in a browser that supports it.</p><button class="primary" id="close-display-help">KEEP PLAYING</button>`;
  dialog.querySelector(".eyebrow")?.remove();
  const toolbar = document.createElement("div");
  toolbar.className = "display-help-toolbar";
  toolbar.innerHTML =
    '<span class="eyebrow">SCREEN OPTIONS</span><button id="dismiss-display-help" aria-label="Close screen help" autofocus><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
  dialog.prepend(toolbar);
  toolbar
    .querySelector("button")!
    .addEventListener("click", () => dialog.close());
  document.body.append(dialog);
  dialog
    .querySelector("#close-display-help")!
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  dialog.scrollTop = 0;
}
