// Fullscreen the document so dialogs and the exit button stay available.
// Older iPad Safari exposes only the prefixed version of the API.
export function createFullscreenSwitch({ button, status, nativeWindow }) {
  const doc = button.ownerDocument;
  // Include both the app and its sibling dialogs in the fullscreen element.
  const root = doc.body;
  const standard = typeof root.requestFullscreen === "function" &&
    typeof doc.exitFullscreen === "function" && doc.fullscreenEnabled !== false;
  const prefixed = typeof root.webkitRequestFullscreen === "function" &&
    typeof doc.webkitExitFullscreen === "function" && doc.webkitFullscreenEnabled !== false;
  if (!standard && !prefixed && !nativeWindow) return;
  let nativeFull = false;

  const active = () => nativeWindow ? nativeFull : Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  function sync() {
    const full = active();
    button.setAttribute("aria-pressed", String(full));
    button.title = full ? "Exit full screen" : "Enter full screen";
    button.setAttribute("aria-label", button.title);
    button.querySelector("[data-fullscreen-enter]").toggleAttribute("hidden", full);
    button.querySelector("[data-fullscreen-exit]").toggleAttribute("hidden", !full);
  }
  function reportError() {
    sync();
    status.textContent = active()
      ? "Could not exit full screen. Use your browser’s exit control and try again."
      : "Full screen is unavailable right now. Try opening the viewer in a separate browser tab.";
    status.hidden = false;
  }
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    status.hidden = true;
    button.disabled = true;
    try {
      // Call immediately in the tap/click handler: user activation is required.
      if (nativeWindow) {
        nativeFull = !(await nativeWindow.isFullscreen());
        await nativeWindow.setFullscreen(nativeFull);
      } else if (active()) {
        if (doc.fullscreenElement) await doc.exitFullscreen();
        else await doc.webkitExitFullscreen();
      } else if (standard) await root.requestFullscreen();
      else await root.webkitRequestFullscreen();
    } catch {
      reportError();
    } finally {
      button.disabled = false;
      sync();
    }
  });
  for (const event of ["fullscreenchange", "webkitfullscreenchange"])
    doc.addEventListener(event, () => {
      // Some embedded browsers emit the state change before their request
      // promise settles. The exit action must be available immediately.
      button.disabled = false;
      status.hidden = true;
      sync();
    });
  for (const event of ["fullscreenerror", "webkitfullscreenerror"])
    doc.addEventListener(event, reportError);
  if (nativeWindow) {
    const syncWindow = async () => {
      nativeFull = await nativeWindow.isFullscreen();
      sync();
    };
    nativeWindow.onResized(syncWindow);
    syncWindow();
    doc.addEventListener("keydown", event => {
      if (event.key === "Escape" && nativeFull && !event.defaultPrevented &&
          !doc.querySelector("dialog[open], :popover-open")) button.click();
    });
  }
  button.hidden = false;
  sync();
}
