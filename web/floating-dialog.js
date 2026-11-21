// Modeless science windows share focus order, dragging, and Escape.
const windows = [];
export function isFrontDialog(win) {
  return windows.filter(dialog => dialog.open).at(-1) === win;
}
let menuHome;
function placeToolsMenu() {
  const menu = document.getElementById("tools-menu");
  if (!menu) return;
  if (!menuHome) {
    menuHome = document.createComment("Tools launcher home");
    menu.before(menuHome);
    new MutationObserver(placeToolsMenu).observe(document.getElementById("app"), {
      attributes: true, attributeFilter: ["data-launcher"],
    });
  }
  const active = document.getElementById("app")?.dataset.launcher === "menu"
    ? windows.filter(dialog => dialog.open).at(-1) : null;
  menu.classList.toggle("in-science", !!active);
  if (active) {
    const head = active.querySelector("header");
    if (menu.parentElement !== head) head.insertBefore(menu, head.lastElementChild);
  } else if (menu.previousSibling !== menuHome) menuHome.after(menu);
}
export function floatingDialog(win, opener, handle, close) {
  const files = document.createElement("button");
  files.type = "button";
  files.className = "window-button science-file";
  files.textContent = "⋯";
  files.title = "Project and session menu";
  files.setAttribute("aria-label", files.title);
  files.setAttribute("popovertarget", "file-menu");
  handle.insertBefore(files, handle.lastElementChild);
  let grip = win.querySelector("#detector-resize-left");
  if (!grip) {
    grip = document.createElement("div");
    win.append(grip);
  }
  grip.classList.add("science-resize-left");
  grip.title = "Resize from bottom left";
  grip.setAttribute("aria-hidden", "true");
  resizeFromLowerLeft(win, grip);
  const front = () => {
    const index = windows.indexOf(win);
    if (index >= 0) windows.splice(index, 1);
    windows.push(win);
    windows.forEach((dialog, i) => (dialog.style.zIndex = 1000 + i));
    placeToolsMenu();
  };
  function clamp() {
    const r = win.getBoundingClientRect();
    const rail = document.getElementById("tool-rail");
    const right = document.getElementById("app")?.dataset.launcher === "rail"
      ? rail.getBoundingClientRect().left - 8 : innerWidth - 8;
    win.style.left = Math.max(8, Math.min(r.left, right - r.width)) + "px";
    const headerBottom = innerWidth >= 1000 && innerHeight > 600
      ? document.querySelector("#app > header").getBoundingClientRect().bottom + 8 : 8;
    win.style.maxHeight = `${innerHeight - headerBottom - 8}px`;
    win.style.top = Math.max(headerBottom, Math.min(r.top, innerHeight - win.offsetHeight - 8)) + "px";
  }
  let drag = null;
  handle.onpointerdown = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const r = win.getBoundingClientRect();
    drag = { x: event.clientX - r.left, y: event.clientY - r.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  handle.onpointermove = (event) => {
    if (!drag) return;
    win.dataset.userMoved = "true";
    win.style.left = event.clientX - drag.x + "px";
    win.style.top = event.clientY - drag.y + "px";
    clamp();
  };
  handle.onpointerup =
    handle.onpointercancel =
    handle.onlostpointercapture =
      () => {
        drag = null;
      };
  win.addEventListener("pointerdown", front, true);
  win.addEventListener("focusin", front);
  new ResizeObserver(() => { if (win.open) clamp(); }).observe(win);
  win.addEventListener("close", placeToolsMenu);
  // Native close events are queued; restore the launcher before the user's
  // next input instead of leaving it briefly inside a closed dialog.
  new MutationObserver(placeToolsMenu).observe(win, { attributes: true, attributeFilter: ["open"] });
  window.addEventListener("resize", () => {
    if (win.open) clamp();
    requestAnimationFrame(placeToolsMenu);
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        win.open &&
        !document.getElementById("tool-rail")?.classList.contains("menu-open") &&
        !document.querySelector(":popover-open") &&
        windows.filter((dialog) => dialog.open).at(-1) === win &&
        !document.querySelector("dialog:modal")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    },
    true,
  );
  return function show() {
    if (!win.open) win.show();
    front();
    opener.setAttribute("aria-expanded", "true");
    if (!win.style.left) {
      if (innerWidth >= 1000 && innerHeight > 600 && ["analysis-window", "detector-window"].includes(win.id)) {
        // Wide screens have room for a scientific inspector beside the
        // centered crystal. Only the window changes; the camera stays fixed.
        win.style.width = Math.max(360, Math.min(520, Math.round(innerWidth * 0.32))) + "px";
        const controlsTop = document.querySelector(".view-bottom")?.getBoundingClientRect().top || innerHeight - 80;
        win.style.height = Math.min(win.offsetHeight, Math.max(300, controlsTop - 196)) + "px";
        win.style.left = "12px";
        win.style.top = "184px";
      } else if (win.id === "reflection-explorer" && innerWidth > 900 && innerHeight > 600) {
        const top = document.querySelector("#app > header").getBoundingClientRect().bottom + 8;
        const bottom = document.querySelector(".view-bottom")?.getBoundingClientRect().top || innerHeight;
        win.style.height = Math.max(360, Math.min(innerHeight, bottom) - top - 12) + "px";
        win.style.left = Math.max(8, (innerWidth - win.offsetWidth) / 2) + "px";
        win.style.top = top + "px";
      } else {
        win.style.left = Math.max(8, (innerWidth - win.offsetWidth) / 2) + "px";
        win.style.top = Math.max(8, (innerHeight - win.offsetHeight) / 2) + "px";
      }
    }
    clamp();
  };
}

export function resizeFromLowerLeft(win, handle) {
  let start;
  handle.onpointerdown = (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    start = { rect: win.getBoundingClientRect(), x: e.clientX, y: e.clientY };
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove = (e) => {
    if (!start || !handle.hasPointerCapture(e.pointerId)) return;
    win.dataset.userMoved = "true";
    const { rect, x, y } = start;
    win.style.width = Math.max(0, Math.min(rect.right - 8, rect.width + x - e.clientX)) + "px";
    win.style.height = Math.max(0, Math.min(innerHeight - rect.top - 8, rect.height + e.clientY - y)) + "px";
    win.style.left = rect.right - win.getBoundingClientRect().width + "px";
  };
  handle.onlostpointercapture = () => {
    start = null;
  };
}
