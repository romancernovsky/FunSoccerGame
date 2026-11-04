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
const shareIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 9H5v12h14V9h-3M12 15V2m-4 4 4-4 4 4"/></svg>`;
const homeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M12 7v10m-5-5h10"/></svg>`;

/** A guide only: iOS provides no API to create a Home Screen shortcut. */
function homeScreenSteps() {
  return `<ol class="install-steps">
    <li><span class="install-step-visual" aria-hidden="true">${shareIcon}<b>1</b></span><div><strong>Tap Share in Safari</strong><p>Look for this icon near the address bar. If it’s hidden, open Safari’s Page Menu first.</p></div></li>
    <li><span class="install-step-visual" aria-hidden="true">${homeIcon}<b>2</b></span><div><strong>Add to Home Screen</strong><p>Scroll the Share menu to find it. Keep <strong>Open as Web App</strong> on, if shown, then tap <strong>Add</strong>.</p></div></li>
    <li><span class="install-step-visual install-app-icon" aria-hidden="true"><img src="/icons/arena-192.png" alt="" width="44" height="44"><b>3</b></span><div><strong>Open Office Arena</strong><p>Leave Safari and tap this icon on your Home Screen. Join there <strong>before the host starts</strong>.</p></div></li>
  </ol>`;
}

export function showDisplayHelp(appleTouch: boolean, alreadyJoined = true) {
  document.querySelector("#display-help")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "display-help";
  dialog.setAttribute("aria-labelledby", "display-help-title");
  dialog.setAttribute("aria-describedby", "display-help-intro");
  dialog.innerHTML = appleTouch
    ? `<h2 id="display-help-title">Add Office Arena.</h2><p id="display-help-intro">${alreadyJoined ? "Safari cannot hide its bars from this page. Set up a Home Screen shortcut for your next match." : "Add a shortcut for full screen. Complete these steps in Safari."}</p>${homeScreenSteps()}${alreadyJoined ? '<p class="display-help-note">Already joined? Stay in this tab for this match. Your player session may not transfer from Safari.</p>' : ""}<button class="secondary" id="close-display-help">${alreadyJoined ? "KEEP PLAYING HERE" : "PLAY IN BROWSER"}</button>`
    : `<h2 id="display-help-title">Fullscreen is unavailable here.</h2><p id="display-help-intro">Your browser did not allow native fullscreen. The game still fills the available page. Try your browser’s fullscreen command or open the game in a browser that supports it.</p><button class="primary" id="close-display-help">KEEP PLAYING</button>`;
  const toolbar = document.createElement("div");
  toolbar.className = "display-help-toolbar";
  toolbar.innerHTML = `<span class="eyebrow">${appleTouch ? "HOME SCREEN SETUP" : "SCREEN OPTIONS"}</span><button id="dismiss-display-help" aria-label="Close screen help" autofocus><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
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
