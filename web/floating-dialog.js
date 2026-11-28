import { addResizeEdges, resizedRect } from "./panel-resize.js";

// Modeless science windows share focus order, dragging, and Escape.
const windows = [];
let settingsInFront = false;
export function bringToFront(el) {
  if (!el) return;
  const index = windows.indexOf(el);
  if (index >= 0) windows.splice(index, 1);
  windows.push(el);
  windows.forEach((w, i) => (w.style.zIndex = 1000 + i));
  if (settingsInFront) setSettingsInFront(false);
  else placeToolsMenu();
}
export function frontScienceWindow() {
  if (settingsInFront) return null;
  return windows.filter(w => w.open || (w.id === "xrd-workspace" && !w.hidden)).at(-1) ?? null;
}
export function isFrontDialog(win) {
  return frontScienceWindow() === win;
}
export function setSettingsInFront(active) {
  if (settingsInFront === active) return;
  settingsInFront = active;
  document.getElementById("tool-layer").classList.toggle("in-front", active);
  placeToolsMenu();
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
    ? (settingsInFront ? null : windows.filter(dialog => dialog.open).at(-1)) : null;
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
export function attachEdgeResizers(
  win,
  {
    minW = 280,
    minH = 220,
    margin = 8,
    canResize = () => true,
    getBounds = null,
    getRect = null,
    onResize = null,
    onEnd = null,
  } = {},
) {
  if (!win) return { destroy() {} };
  let active = null;
  const resolveBounds = () => {
    if (typeof getBounds === "function") return getBounds();
    const parent = win.offsetParent || document.documentElement;
    const w = parent.clientWidth || innerWidth;
    const h = parent.clientHeight || innerHeight;
    return { left: margin, top: margin, right: Math.max(margin + minW, w - margin), bottom: Math.max(margin + minH, h - margin) };
  };
  const resolveRect = () => {
    if (typeof getRect === "function") return getRect();
    const r = win.getBoundingClientRect();
    const parent = win.offsetParent;
    const pr = parent && parent !== document.body && parent !== document.documentElement ? parent.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height };
  };
  const layer = addResizeEdges(win, (event, edge) => {
    if (active || !canResize()) return;
    event.preventDefault();
    event.stopPropagation();
    const style = getComputedStyle(win);
    active = {
      edge,
      rect: resolveRect(),
      bounds: resolveBounds(),
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      minWidth: Math.max(minW, parseFloat(style.minWidth) || 0),
      minHeight: Math.max(minH, parseFloat(style.minHeight) || 0),
      target: event.currentTarget,
    };
    active.target.setPointerCapture?.(event.pointerId);
  });
  for (const handle of layer.querySelectorAll("[data-edge]")) {
    handle.classList.add("win-edge", `win-edge-${handle.dataset.edge}`);
  }
  const onMove = (event) => {
    if (active?.id !== event.pointerId) return;
    const next = resizedRect(
      active.rect,
      active.edge,
      event.clientX - active.x,
      event.clientY - active.y,
      active.bounds,
      active.minWidth,
      active.minHeight,
    );
    if (typeof onResize === "function") onResize(next);
    else {
      Object.assign(win.style, {
        left: `${Math.round(next.x)}px`,
        top: `${Math.round(next.y)}px`,
        width: `${Math.round(next.w)}px`,
        height: `${Math.round(next.h)}px`,
      });
    }
  };
  const onDone = (event) => {
    if (active?.id !== event.pointerId) return;
    const finished = active;
    active = null;
    if (finished.target.hasPointerCapture?.(finished.id)) finished.target.releasePointerCapture(finished.id);
    onEnd?.();
  };
  win.addEventListener("pointermove", onMove);
  win.addEventListener("pointerup", onDone);
  win.addEventListener("pointercancel", onDone);
  win.addEventListener("lostpointercapture", onDone);
  return {
    destroy() {
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onDone);
      win.removeEventListener("pointercancel", onDone);
      win.removeEventListener("lostpointercapture", onDone);
      layer.remove();
    },
  };
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
    if (settingsInFront) setSettingsInFront(false);
    else placeToolsMenu();
  };
  function windowBounds() {
    const rail = document.getElementById("tool-rail");
    return {
      left: 8,
      top: innerHeight > 600
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
    drag = { x: event.clientX - r.left, y: event.clientY - r.top, height: r.height };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  handle.onpointermove = (event) => {
    if (!drag) return;
    if (!win.dataset.userMoved) win.style.height = drag.height + "px";
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
        isFrontDialog(win) &&
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
