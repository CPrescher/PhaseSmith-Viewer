import { addResizeEdges, resizedRect } from "./panel-resize.js";

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
export function focusLauncher(opener) {
  const group = opener?.closest(".launcher-choices");
  const trigger = group && document.querySelector(`[aria-controls="${group.id}"]`);
  const target = [opener, trigger, document.getElementById("tools-menu")].find(el => el?.getClientRects().length);
  target?.focus({ preventScroll: true });
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
  const front = () => {
    const index = windows.indexOf(win);
    if (index >= 0) windows.splice(index, 1);
    windows.push(win);
    windows.forEach((dialog, i) => (dialog.style.zIndex = 1000 + i));
    placeToolsMenu();
  };
  function windowBounds() {
    const rail = document.getElementById("tool-rail");
    return {
      left: 8,
      top: innerWidth >= 1000 && innerHeight > 600
        ? document.querySelector("#app > header").getBoundingClientRect().bottom + 8 : 8,
      right: document.getElementById("app").dataset.launcher === "rail"
        ? rail.getBoundingClientRect().left - 8 : innerWidth - 8,
      bottom: innerHeight - 8,
    };
  }
  function clamp() {
    const r = win.getBoundingClientRect();
    const bounds = windowBounds();
    win.style.left = Math.max(bounds.left, Math.min(r.left, bounds.right - r.width)) + "px";
    let maxHeight = bounds.bottom - bounds.top;
    if (innerWidth >= 1000 && innerHeight > 600 && !win.style.height && !win.dataset.userMoved && win.id !== "detector-options") {
      const bottom = document.querySelector(".view-bottom").getBoundingClientRect().top;
      maxHeight = Math.min(maxHeight, Math.max(300, bottom - r.top - 12));
    }
    win.style.maxHeight = `${maxHeight}px`;
    win.style.top = Math.max(bounds.top, Math.min(r.top, bounds.bottom - win.offsetHeight)) + "px";
  }
  let resize = null;
  let drag = null;
  addResizeEdges(win, (event, edge) => {
    if (resize || drag) return;
    event.preventDefault();
    const r = win.getBoundingClientRect();
    const style = getComputedStyle(win);
    resize = {
      edge, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bounds: windowBounds(),
      x: event.clientX, y: event.clientY, id: event.pointerId,
      minWidth: parseFloat(style.minWidth) || 240,
      minHeight: Math.max(handle.offsetHeight + 40, parseFloat(style.minHeight) || 0),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  win.addEventListener("pointermove", event => {
    if (resize?.id !== event.pointerId) return;
    const r = resizedRect(resize.rect, resize.edge, event.clientX - resize.x, event.clientY - resize.y, resize.bounds, resize.minWidth, resize.minHeight);
    if (win.classList.contains("showing-crystal")) {
      win.dataset.linkedResized = "true";
      for (const [key, value] of Object.entries(r)) win.style.setProperty(`--linked-${key}`, `${value}px`);
    } else {
      win.dataset.userMoved = "true";
      win.style.maxHeight = `${resize.bounds.bottom - resize.bounds.top}px`;
      Object.assign(win.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    }
  });
  win.addEventListener("lostpointercapture", event => {
    if (resize?.id === event.pointerId) resize = null;
  });
  handle.onpointerdown = (event) => {
    if (drag || resize || !event.isPrimary || event.button !== 0 || event.target.closest("button")) return;
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
        win.style.left = "12px";
        win.style.top = "184px";
      } else if (win.id === "reflection-explorer" && innerWidth > 900 && innerHeight > 600) {
        const top = document.querySelector("#app > header").getBoundingClientRect().bottom + 8;
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
