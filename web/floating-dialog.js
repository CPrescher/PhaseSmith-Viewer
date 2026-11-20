// Modeless science windows share focus order, dragging, and Escape.
const windows = [];
export function floatingDialog(win, opener, handle, close) {
  const front = () => {
    const index = windows.indexOf(win);
    if (index >= 0) windows.splice(index, 1);
    windows.push(win);
    windows.forEach((dialog, i) => (dialog.style.zIndex = 1000 + i));
  };
  function clamp() {
    const r = win.getBoundingClientRect();
    win.style.left = Math.max(8, Math.min(r.left, innerWidth - r.width - 8)) + "px";
    win.style.top = Math.max(8, Math.min(r.top, innerHeight - r.height - 8)) + "px";
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
  window.addEventListener("resize", () => {
    if (win.open) clamp();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        win.open &&
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
      win.style.left = Math.max(8, (innerWidth - win.offsetWidth) / 2) + "px";
      win.style.top = Math.max(8, (innerHeight - win.offsetHeight) / 2) + "px";
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
    const { rect, x, y } = start;
    win.style.width = Math.max(0, Math.min(rect.right - 8, rect.width + x - e.clientX)) + "px";
    win.style.height = Math.max(0, Math.min(innerHeight - rect.top - 8, rect.height + e.clientY - y)) + "px";
    win.style.left = rect.right - win.getBoundingClientRect().width + "px";
  };
  handle.onlostpointercapture = () => {
    start = null;
  };
}
